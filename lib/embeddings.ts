/**
 * Gemini Embedding API 유틸리티
 * - gemini-embedding-001 모델 사용 (768차원)
 * - 단일/배치 임베딩 생성
 * - 코사인 유사도 기반 검색
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const BATCH_SIZE = 100; // API 배치 제한

function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }
  return new GoogleGenerativeAI(apiKey);
}

/** 단일 텍스트 → 벡터 변환 */
export async function generateEmbedding(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_QUERY
): Promise<number[]> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    taskType,
  });

  return result.embedding.values;
}

/** 배치 임베딩 생성 */
export async function generateBatchEmbeddings(
  texts: string[],
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[][]> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requests = batch.map(text => ({
      content: { role: 'user' as const, parts: [{ text }] },
      taskType,
    }));

    const result = await model.batchEmbedContents({ requests });
    for (const embedding of result.embeddings) {
      allVectors.push(embedding.values);
    }
  }

  return allVectors;
}

/** 코사인 유사도 계산 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 유사 항목 검색 */
export function findSimilarByEmbedding(
  queryVec: number[],
  storedVecs: { id: number | string; vector: number[] }[],
  topK: number = 5,
  threshold: number = 0.5
): { id: number | string; score: number }[] {
  const scored = storedVecs.map(item => ({
    id: item.id,
    score: cosineSimilarity(queryVec, item.vector),
  }));

  return scored
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export { EMBEDDING_MODEL, DIMENSIONS, TaskType };
