/**
 * PDF 파싱 유틸리티 (서버 런타임용)
 *
 * scripts/process-data.ts의 PDF 처리 로직을 런타임에서도 사용할 수 있도록 추출.
 * - cleanPdfText: PDF 텍스트 정리 (세로 레이아웃 잔해, 페이지 번호 제거)
 * - splitIntoChunks: ~500자 단위 chunk 분할
 * - parsePdfBuffer: Buffer → pdf-parse → clean → chunk → 반환
 */

import type { GuidelineChunk } from './types';

// pdf-parse/lib/pdf-parse.js를 직접 임포트 (index.js의 테스트 코드 회피)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

/** PDF 텍스트 정리: 세로 레이아웃 잔해 및 불필요한 줄 제거 */
export function cleanPdfText(text: string): string {
  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 한 글자만 있는 줄이 연속되면 세로 텍스트 → 건너뛰기
    if (line.length === 1 && i + 1 < lines.length && lines[i + 1].trim().length === 1) {
      continue;
    }
    if (line.length === 1 && i > 0 && lines[i - 1].trim().length === 1) {
      continue;
    }

    // 페이지 번호만 있는 줄 제거
    if (/^\d+$/.test(line)) continue;

    // Ÿ 등 PDF 특수 마커 정리
    const cleanedLine = line.replace(/^[Ÿ·•]+\s*/, '- ');

    cleaned.push(cleanedLine);
  }

  return cleaned.join('\n');
}

/** 텍스트를 ~500자 단위 chunk로 분할 */
export function splitIntoChunks(
  text: string,
  source: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): GuidelineChunk[] {
  const chunks: GuidelineChunk[] = [];

  const cleanedText = cleanPdfText(text);

  // 빈 줄 기준으로 단락 분리
  const paragraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let currentChunk = '';
  let chunkIndex = 0;
  let currentSection = source;

  // 확장자 제거한 basename
  const baseName = source.replace(/\.[^.]+$/, '');

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();

    // 섹션 제목 감지 (숫자.숫자 또는 제N장 패턴)
    const sectionMatch = trimmed.match(/^(\d+\.\d+[\.\d]*\s+.+|제\s*\d+\s*[장절조].*)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].substring(0, 100);
    }

    // 현재 청크에 추가했을 때 크기 초과하면 저장
    if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `${baseName}_chunk_${chunkIndex}`,
        source,
        section: currentSection,
        content: currentChunk.trim(),
        pageStart: Math.floor(chunkIndex * chunkSize / 2000) + 1,
      });
      chunkIndex++;

      // 오버랩: 마지막 부분 유지
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + '\n' + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + trimmed;
    }
  }

  // 마지막 청크
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `${baseName}_chunk_${chunkIndex}`,
      source,
      section: currentSection,
      content: currentChunk.trim(),
      pageStart: Math.floor(chunkIndex * chunkSize / 2000) + 1,
    });
  }

  return chunks;
}

/** Buffer → pdf-parse → clean → chunk → 반환 */
export async function parsePdfBuffer(
  buffer: Buffer,
  filename: string
): Promise<{ chunks: GuidelineChunk[]; pageCount: number; textLength: number }> {
  const data = await pdfParse(buffer);
  const text: string = data.text;

  const chunks = splitIntoChunks(text, filename);

  return {
    chunks,
    pageCount: data.numpages,
    textLength: text.length,
  };
}
