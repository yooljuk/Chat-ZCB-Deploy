/**
 * 캐시된 데이터 로더
 * - data/qa-*.json 전부 자동 로드 (새 Excel 변환 파일 포함)
 * - 파일명 기반 scope 분류: common / certification / consulting
 * - data/guidelines/chunks.json 로드
 * - 모듈 레벨 캐시 (1분 TTL)
 */

import fs from 'fs';
import path from 'path';
import type { QAItem, GuidelineChunk, EmbeddingData } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const GUIDELINES_CHUNKS_PATH = path.join(DATA_DIR, 'guidelines', 'chunks.json');
const EMBEDDINGS_PATH = path.join(DATA_DIR, 'embeddings.json');

const CACHE_TTL = 60 * 1000; // 1분

// ─── 타입 ──────────────────────────────────────────────

type QAScope = 'common' | 'certification' | 'consulting';

interface ScopedQAFile {
  scope: QAScope;
  items: QAItem[];
}

// ─── 캐시 ──────────────────────────────────────────────

interface Cache<T> {
  data: T;
  timestamp: number;
}

let qaCache: Cache<ScopedQAFile[]> | null = null;
let guidelineCache: Cache<GuidelineChunk[]> | null = null;
let embeddingCache: Cache<EmbeddingData | null> | null = null;

function isCacheValid<T>(cache: Cache<T> | null): cache is Cache<T> {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL;
}

// ─── 파일명 → scope 판별 ──────────────────────────────

function detectScope(filename: string): QAScope {
  const lower = filename.toLowerCase();
  // 인증기관 전용
  if (lower.includes('certification') || lower.includes('인증기관')) {
    return 'certification';
  }
  // 기술지원(컨설팅)기관 전용
  if (lower.includes('consulting') || lower.includes('컨설팅') || lower.includes('기술지원')) {
    return 'consulting';
  }
  // 전반적 질문 (common)
  return 'common';
}

// ─── Q&A 데이터 로드 ──────────────────────────────────

export function loadAllQAData(type: 'certification' | 'consulting'): QAItem[] {
  if (isCacheValid(qaCache)) {
    return filterByType(qaCache.data, type);
  }

  const scopedFiles: ScopedQAFile[] = [];

  // data/ 디렉토리의 모든 qa-*.json 파일 로드
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('qa-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QAItem[];
      const scope = detectScope(file);
      scopedFiles.push({ scope, items: data });
    } catch (err) {
      console.error(`Q&A 파일 로드 실패: ${file}`, err);
    }
  }

  qaCache = { data: scopedFiles, timestamp: Date.now() };
  return filterByType(scopedFiles, type);
}

function filterByType(scopedFiles: ScopedQAFile[], type: 'certification' | 'consulting'): QAItem[] {
  // ── 현재 설정: 모든 Q&A 통합 (두 챗봇 모두 전체 데이터 접근) ──
  // 아래 주석 해제 시 타입별 분리 가능:
  //   const result: QAItem[] = [];
  //   for (const { scope, items } of scopedFiles) {
  //     if (scope === 'common' || scope === type) {
  //       result.push(...items);
  //     }
  //   }
  // ────────────────────────────────────────────────────────
  const result: QAItem[] = [];
  for (const { items } of scopedFiles) {
    result.push(...items);
  }

  // 중복 제거 (동일 질문이 여러 파일에 존재하는 경우)
  const seen = new Set<string>();
  return result.filter(qa => {
    const key = qa.question.replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── 지침 Chunks 로드 ────────────────────────────────

export function loadGuidelineChunks(): GuidelineChunk[] {
  if (isCacheValid(guidelineCache)) {
    return guidelineCache.data;
  }

  if (!fs.existsSync(GUIDELINES_CHUNKS_PATH)) {
    guidelineCache = { data: [], timestamp: Date.now() };
    return [];
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(GUIDELINES_CHUNKS_PATH, 'utf-8')
    ) as GuidelineChunk[];

    guidelineCache = { data, timestamp: Date.now() };
    return data;
  } catch (err) {
    console.error('지침 chunks 로드 실패:', err);
    guidelineCache = { data: [], timestamp: Date.now() };
    return [];
  }
}

// ─── 임베딩 데이터 로드 ──────────────────────────────

export function loadEmbeddings(): EmbeddingData | null {
  if (isCacheValid(embeddingCache)) {
    return embeddingCache.data;
  }

  if (!fs.existsSync(EMBEDDINGS_PATH)) {
    embeddingCache = { data: null, timestamp: Date.now() };
    return null;
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(EMBEDDINGS_PATH, 'utf-8')
    ) as EmbeddingData;

    embeddingCache = { data, timestamp: Date.now() };
    return data;
  } catch (err) {
    console.error('임베딩 데이터 로드 실패:', err);
    embeddingCache = { data: null, timestamp: Date.now() };
    return null;
  }
}
