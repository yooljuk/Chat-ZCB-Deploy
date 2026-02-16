/**
 * Vercel KV (Upstash Redis) 기반 채팅 로그 유틸리티
 *
 * 키 구조:
 *   chat-logs:{timestamp} → ChatLog 객체
 *   chat-logs-index       → timestamp[] (최신순 정렬 인덱스)
 */

import { Redis } from '@upstash/redis';

export interface ChatLog {
  timestamp: string;
  type: 'certification' | 'consulting';
  question: string;
  answer: string;
  isFallback: boolean;
}

interface LogFilter {
  type?: 'certification' | 'consulting' | null;
  from?: string | null; // YYYY-MM-DD
  to?: string | null;   // YYYY-MM-DD
  fallback?: boolean | null;
}

// Redis 클라이언트 (lazy init)
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
  }
  return redis;
}

function isKVConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

const LOG_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1년
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24시간마다 자동 정리

// ─── 로그 저장 ──────────────────────────────────────────

export async function saveLog(log: ChatLog): Promise<void> {
  if (!isKVConfigured()) {
    console.warn('[KV] KV 미설정 — 로그 저장 생략');
    return;
  }

  const kv = getRedis();
  const key = `chat-logs:${log.timestamp}`;

  // 로그 저장 + 인덱스에 timestamp 추가
  await kv.set(key, log);
  await kv.lpush('chat-logs-index', log.timestamp);

  // 자동 정리: 마지막 정리로부터 24시간 경과 시 실행
  try {
    const lastCleanup = await kv.get<number>('chat-logs-last-cleanup');
    if (!lastCleanup || Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
      await cleanupOldLogs();
    }
  } catch (err) {
    console.error('[KV] 자동 정리 확인 실패:', err);
  }
}

// ─── 오래된 로그 자동 정리 (1년 초과) ────────────────────

async function cleanupOldLogs(): Promise<number> {
  const kv = getRedis();
  const cutoff = new Date(Date.now() - LOG_MAX_AGE_MS);

  const timestamps: string[] = await kv.lrange('chat-logs-index', 0, -1);
  const toDelete: string[] = [];

  for (const ts of timestamps) {
    if (new Date(ts) < cutoff) {
      toDelete.push(ts);
    }
  }

  if (toDelete.length > 0) {
    const pipeline = kv.pipeline();
    for (const ts of toDelete) {
      pipeline.del(`chat-logs:${ts}`);
      pipeline.lrem('chat-logs-index', 0, ts);
    }
    await pipeline.exec();
    console.log(`[KV] 자동 정리: ${toDelete.length}건 삭제 (1년 초과)`);
  }

  // 마지막 정리 시각 기록
  await kv.set('chat-logs-last-cleanup', Date.now());

  return toDelete.length;
}

// ─── 수동 로그 삭제 ──────────────────────────────────────

export async function deleteLogsBefore(beforeDate: string): Promise<number> {
  if (!isKVConfigured()) return 0;

  const kv = getRedis();
  const cutoff = new Date(beforeDate);
  cutoff.setHours(23, 59, 59, 999);

  const timestamps: string[] = await kv.lrange('chat-logs-index', 0, -1);
  const toDelete = timestamps.filter(ts => new Date(ts) <= cutoff);

  if (toDelete.length === 0) return 0;

  const pipeline = kv.pipeline();
  for (const ts of toDelete) {
    pipeline.del(`chat-logs:${ts}`);
    pipeline.lrem('chat-logs-index', 0, ts);
  }
  await pipeline.exec();

  return toDelete.length;
}

export async function deleteAllLogs(): Promise<number> {
  if (!isKVConfigured()) return 0;

  const kv = getRedis();
  const timestamps: string[] = await kv.lrange('chat-logs-index', 0, -1);

  if (timestamps.length === 0) return 0;

  const pipeline = kv.pipeline();
  for (const ts of timestamps) {
    pipeline.del(`chat-logs:${ts}`);
  }
  pipeline.del('chat-logs-index');
  await pipeline.exec();

  return timestamps.length;
}

// ─── 로그 조회 (필터 포함) ──────────────────────────────

export async function getLogs(filter: LogFilter = {}): Promise<ChatLog[]> {
  if (!isKVConfigured()) {
    return [];
  }

  const kv = getRedis();

  // 인덱스에서 모든 timestamp 가져오기
  const timestamps: string[] = await kv.lrange('chat-logs-index', 0, -1);

  if (timestamps.length === 0) return [];

  // 각 로그 가져오기 (pipeline 사용)
  const pipeline = kv.pipeline();
  for (const ts of timestamps) {
    pipeline.get(`chat-logs:${ts}`);
  }
  const results = await pipeline.exec<(ChatLog | null)[]>();

  let logs = results.filter((log): log is ChatLog => log !== null);

  // 필터 적용
  if (filter.type) {
    logs = logs.filter(log => log.type === filter.type);
  }

  if (filter.from) {
    const fromDate = new Date(filter.from);
    logs = logs.filter(log => new Date(log.timestamp) >= fromDate);
  }

  if (filter.to) {
    const toDate = new Date(filter.to);
    toDate.setHours(23, 59, 59, 999);
    logs = logs.filter(log => new Date(log.timestamp) <= toDate);
  }

  if (filter.fallback !== null && filter.fallback !== undefined) {
    logs = logs.filter(log => log.isFallback === filter.fallback);
  }

  // 최신순 정렬
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return logs;
}

// ─── 통계 계산 ──────────────────────────────────────────

interface StatsResponse {
  totalQuestions: number;
  fallbackCount: number;
  fallbackRate: number;
  byType: {
    certification: number;
    consulting: number;
  };
  byCategory: Record<string, number>;
  recentDays: {
    date: string;
    count: number;
  }[];
}

function estimateCategory(question: string): string {
  const keywords: Record<string, string[]> = {
    '인증절차': ['절차', '신청', '접수', '단계', '프로세스'],
    '서류제출': ['서류', '제출', '문서', '양식', '첨부'],
    '평가방법': ['평가', '계산', '측정', '산정', '방법'],
    '인증기준': ['기준', '요건', '조건', '자격'],
    '수수료': ['수수료', '비용', '금액', '요금'],
  };

  for (const [category, keywordList] of Object.entries(keywords)) {
    for (const keyword of keywordList) {
      if (question.includes(keyword)) {
        return category;
      }
    }
  }

  return '기타';
}

export async function getStats(): Promise<StatsResponse> {
  const logs = await getLogs();

  const totalQuestions = logs.length;
  const fallbackCount = logs.filter(log => log.isFallback).length;
  const fallbackRate = totalQuestions > 0
    ? Math.round((fallbackCount / totalQuestions) * 100 * 100) / 100
    : 0;

  const byType = {
    certification: logs.filter(log => log.type === 'certification').length,
    consulting: logs.filter(log => log.type === 'consulting').length,
  };

  const categoryMap: Record<string, number> = {};
  logs.forEach(log => {
    const category = estimateCategory(log.question);
    categoryMap[category] = (categoryMap[category] || 0) + 1;
  });

  const today = new Date();
  const recentDays: { date: string; count: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    const dateString = targetDate.toISOString().split('T')[0];

    const count = logs.filter(log => {
      const logDate = new Date(log.timestamp).toISOString().split('T')[0];
      return logDate === dateString;
    }).length;

    recentDays.push({ date: dateString, count });
  }

  return {
    totalQuestions,
    fallbackCount,
    fallbackRate,
    byType,
    byCategory: categoryMap,
    recentDays,
  };
}
