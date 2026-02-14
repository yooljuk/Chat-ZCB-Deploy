/**
 * 캐시된 데이터 로더
 * - data/qa-*.json 전부 자동 로드 (새 Excel 변환 파일 포함)
 * - data/guidelines/chunks.json 로드
 * - 모듈 레벨 캐시 (1분 TTL)
 */

import fs from 'fs';
import path from 'path';
import type { QAItem, GuidelineChunk } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const GUIDELINES_CHUNKS_PATH = path.join(DATA_DIR, 'guidelines', 'chunks.json');

const CACHE_TTL = 60 * 1000; // 1분

// ─── 캐시 ──────────────────────────────────────────────

interface Cache<T> {
  data: T;
  timestamp: number;
}

let qaCache: Cache<QAItem[]> | null = null;
let guidelineCache: Cache<GuidelineChunk[]> | null = null;

function isCacheValid<T>(cache: Cache<T> | null): cache is Cache<T> {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL;
}

// ─── Q&A 데이터 로드 ──────────────────────────────────

export function loadAllQAData(type: 'certification' | 'consulting'): QAItem[] {
  if (isCacheValid(qaCache)) {
    return filterByType(qaCache.data, type);
  }

  const allQA: QAItem[] = [];

  // data/ 디렉토리의 모든 qa-*.json 파일 로드
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('qa-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QAItem[];
      allQA.push(...data);
    } catch (err) {
      console.error(`Q&A 파일 로드 실패: ${file}`, err);
    }
  }

  qaCache = { data: allQA, timestamp: Date.now() };
  return filterByType(allQA, type);
}

function filterByType(qaData: QAItem[], type: 'certification' | 'consulting'): QAItem[] {
  // 기존 qa-common.json, qa-certification.json, qa-consulting.json은 파일명으로 구분
  // Excel에서 변환된 qa-excel-*.json은 전부 포함 (type 구분 없음)
  // 하지만 기존 구조에서는 loadQAData가 common + type-specific만 로드했으므로
  // 동일 로직 유지: 모든 Q&A를 반환 (Excel 변환 파일은 공통으로 취급)
  return qaData;
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
