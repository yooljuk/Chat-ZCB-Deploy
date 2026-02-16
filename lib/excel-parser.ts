/**
 * Excel 파싱 유틸리티 (재사용 가능 모듈)
 * - process-data.ts의 Excel 파싱 로직을 서버 런타임에서도 사용 가능하도록 분리
 * - detectColumnsFromArray(): 헤더 행에서 질문/답변/구분 컬럼 감지
 * - parseExcelBuffer(): Excel 버퍼 → QAItem[] 변환
 */

import type { QAItem } from './types';

/** 헤더 행에서 구분/질문/답변 컬럼 인덱스를 감지 */
export function detectColumnsFromArray(
  row: unknown[]
): { categoryIdx: number; questionIdx: number; answerIdx: number } | null {
  let categoryIdx = -1;
  let questionIdx = -1;
  let answerIdx = -1;

  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] || '').replace(/\s+/g, '').toLowerCase();

    if (categoryIdx < 0 && (
      cell.includes('구분') || cell.includes('카테고리') || cell.includes('category') || cell.includes('분류')
    )) {
      categoryIdx = i;
    }

    if (questionIdx < 0 && (
      cell.includes('질문') || cell.includes('question') || cell.includes('문의')
    )) {
      questionIdx = i;
    }

    if (answerIdx < 0 && (
      cell.includes('답변') || cell.includes('answer') || cell.includes('응답') || cell.includes('회신')
    )) {
      answerIdx = i;
    }
  }

  if (questionIdx < 0 || answerIdx < 0) return null;
  return { categoryIdx, questionIdx, answerIdx };
}

/** Excel 버퍼(ArrayBuffer/Buffer)를 파싱하여 QAItem[] 반환 */
export function parseExcelBuffer(
  buffer: ArrayBuffer | Buffer,
  filename: string
): QAItem[] {
  // xlsx를 dynamic import 대신 require로 사용 (서버 사이드)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const allItems: QAItem[] = [];
  let globalId = 1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

    if (rawRows.length < 2) continue;

    // 헤더 행 찾기 (처음 5행 내에서)
    let headerRowIdx = -1;
    let colMapping: { categoryIdx: number; questionIdx: number; answerIdx: number } | null = null;

    for (let i = 0; i < Math.min(5, rawRows.length); i++) {
      const mapping = detectColumnsFromArray(rawRows[i]);
      if (mapping) {
        headerRowIdx = i;
        colMapping = mapping;
        break;
      }
    }

    if (!colMapping || headerRowIdx < 0) {
      console.log(`[excel-parser] ${filename}/${sheetName}: 질문/답변 컬럼을 찾을 수 없음`);
      continue;
    }

    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i] as string[];
      const question = String(row[colMapping.questionIdx] || '').trim();
      const answer = String(row[colMapping.answerIdx] || '').trim();

      if (!question || !answer) continue;

      const category = colMapping.categoryIdx >= 0
        ? String(row[colMapping.categoryIdx] || '').trim()
        : '일반';

      allItems.push({
        id: globalId++,
        category: category || '일반',
        question,
        answer,
      });
    }
  }

  return allItems;
}
