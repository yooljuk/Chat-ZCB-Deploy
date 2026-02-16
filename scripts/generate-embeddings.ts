/**
 * 임베딩 사전 생성 스크립트
 * - 모든 Q&A 질문+답변, 지침 chunk를 배치 임베딩
 * - data/embeddings.json에 저장
 *
 * 실행: npm run generate-embeddings
 */

import fs from 'fs';
import path from 'path';
import { generateBatchEmbeddings, EMBEDDING_MODEL, DIMENSIONS, TaskType } from '../lib/embeddings';
import type { QAItem, GuidelineChunk, EmbeddingData } from '../lib/types';

// dotenv 대신 .env.local 직접 파싱 (tsx 스크립트용)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'embeddings.json');

function loadAllQAs(): QAItem[] {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('qa-') && f.endsWith('.json'));

  const allItems: QAItem[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as QAItem[];
    for (const item of data) {
      const key = item.question.replace(/\s+/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        allItems.push(item);
      }
    }
  }

  return allItems;
}

function loadChunks(): GuidelineChunk[] {
  const chunksPath = path.join(DATA_DIR, 'guidelines', 'chunks.json');
  if (!fs.existsSync(chunksPath)) return [];
  return JSON.parse(fs.readFileSync(chunksPath, 'utf-8')) as GuidelineChunk[];
}

async function main() {
  console.log('=== 임베딩 생성 시작 ===');
  console.log(`모델: ${EMBEDDING_MODEL}, 차원: ${DIMENSIONS}`);

  // 1. 데이터 로드
  const qaItems = loadAllQAs();
  const chunks = loadChunks();
  console.log(`Q&A: ${qaItems.length}개, 지침 chunks: ${chunks.length}개`);

  // 2. Q&A 임베딩 생성 (질문 + 답변 결합)
  console.log('\n[1/2] Q&A 임베딩 생성 중...');
  const qaTexts = qaItems.map(qa => `${qa.question}\n${qa.answer}`);
  const qaVectors = await generateBatchEmbeddings(qaTexts, TaskType.RETRIEVAL_DOCUMENT);
  console.log(`  → ${qaVectors.length}개 완료`);

  // 3. 지침 chunk 임베딩 생성
  console.log('\n[2/2] 지침 chunk 임베딩 생성 중...');
  const chunkTexts = chunks.map(c => c.content);
  const chunkVectors = await generateBatchEmbeddings(chunkTexts, TaskType.RETRIEVAL_DOCUMENT);
  console.log(`  → ${chunkVectors.length}개 완료`);

  // 4. 저장
  const embeddingData: EmbeddingData = {
    qaEmbeddings: qaItems.map((qa, i) => ({
      id: qa.id,
      vector: qaVectors[i],
    })),
    chunkEmbeddings: chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: chunkVectors[i],
    })),
    model: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(embeddingData), 'utf-8');

  const fileSizeMB = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\n=== 완료 ===`);
  console.log(`저장: ${OUTPUT_PATH} (${fileSizeMB} MB)`);
  console.log(`Q&A 임베딩: ${embeddingData.qaEmbeddings.length}개`);
  console.log(`Chunk 임베딩: ${embeddingData.chunkEmbeddings.length}개`);
}

main().catch(err => {
  console.error('임베딩 생성 실패:', err);
  process.exit(1);
});
