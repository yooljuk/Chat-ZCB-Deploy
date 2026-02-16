/**
 * Redis(Upstash KV) 기반 업로드 데이터 관리 유틸리티
 *
 * 키 구조:
 *   qa-uploaded:{filename}  → { items: QAItem[], embeddings: {id,vector}[], uploadedAt: string }
 *   qa-uploaded-index       → string[] (업로드된 파일명 목록)
 *
 * ID 충돌 방지:
 *   정적 파일 QA: 기존 ID (1~N)
 *   업로드 QA: (fileIndex+1) * 100000 + localId
 */

import { Redis } from '@upstash/redis';
import type { QAItem } from './types';

export interface UploadedQAData {
  items: QAItem[];
  embeddings: { id: number; vector: number[] }[];
  uploadedAt: string;
}

export interface MergedUploadData {
  items: QAItem[];
  embeddings: { id: number; vector: number[] }[];
}

// Redis 클라이언트 (kv-logger.ts와 별도 인스턴스)
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

const KEY_PREFIX = 'qa-uploaded:';
const INDEX_KEY = 'qa-uploaded-index';

/** QA + 임베딩을 Redis에 저장 */
export async function saveUploadedQA(
  filename: string,
  items: QAItem[],
  embeddings: { id: number; vector: number[] }[]
): Promise<void> {
  if (!isKVConfigured()) {
    console.warn('[kv-data] KV 미설정 — 저장 생략');
    return;
  }

  const kv = getRedis();
  const data: UploadedQAData = {
    items,
    embeddings,
    uploadedAt: new Date().toISOString(),
  };

  await kv.set(`${KEY_PREFIX}${filename}`, data);

  // 인덱스에 파일명 추가 (중복 방지)
  const index: string[] = (await kv.get<string[]>(INDEX_KEY)) || [];
  if (!index.includes(filename)) {
    index.push(filename);
    await kv.set(INDEX_KEY, index);
  }
}

/** 모든 업로드 데이터 로드 (offset ID 적용) */
export async function loadAllUploadedData(): Promise<MergedUploadData> {
  if (!isKVConfigured()) {
    return { items: [], embeddings: [] };
  }

  const kv = getRedis();
  const index: string[] = (await kv.get<string[]>(INDEX_KEY)) || [];

  if (index.length === 0) {
    return { items: [], embeddings: [] };
  }

  const allItems: QAItem[] = [];
  const allEmbeddings: { id: number; vector: number[] }[] = [];

  for (let fileIdx = 0; fileIdx < index.length; fileIdx++) {
    const filename = index[fileIdx];
    const data = await kv.get<UploadedQAData>(`${KEY_PREFIX}${filename}`);
    if (!data) continue;

    const offset = (fileIdx + 1) * 100000;

    // ID에 offset 적용
    for (const item of data.items) {
      allItems.push({
        ...item,
        id: offset + item.id,
      });
    }

    for (const emb of data.embeddings) {
      allEmbeddings.push({
        id: offset + emb.id,
        vector: emb.vector,
      });
    }
  }

  return { items: allItems, embeddings: allEmbeddings };
}

/** 업로드 파일 목록 조회 (메타정보 포함) */
export async function getUploadedFiles(): Promise<
  { filename: string; uploadedAt: string; itemCount: number }[]
> {
  if (!isKVConfigured()) {
    return [];
  }

  const kv = getRedis();
  const index: string[] = (await kv.get<string[]>(INDEX_KEY)) || [];

  if (index.length === 0) return [];

  const files: { filename: string; uploadedAt: string; itemCount: number }[] = [];

  for (const filename of index) {
    const data = await kv.get<UploadedQAData>(`${KEY_PREFIX}${filename}`);
    if (data) {
      files.push({
        filename,
        uploadedAt: data.uploadedAt,
        itemCount: data.items.length,
      });
    }
  }

  return files;
}

/** 특정 파일 삭제 */
export async function deleteUploadedFile(filename: string): Promise<boolean> {
  if (!isKVConfigured()) return false;

  const kv = getRedis();

  // 데이터 삭제
  await kv.del(`${KEY_PREFIX}${filename}`);

  // 인덱스에서 제거
  const index: string[] = (await kv.get<string[]>(INDEX_KEY)) || [];
  const newIndex = index.filter(f => f !== filename);
  await kv.set(INDEX_KEY, newIndex);

  return true;
}
