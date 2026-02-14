/**
 * 빌드 타임 데이터 처리 스크립트
 * - data/ 상위 폴더의 PDF, Excel 파일을 스캔
 * - PDF → 텍스트 추출 → ~500자 단위 chunk 분할 → data/guidelines/chunks.json
 * - Excel → Q&A 변환 → data/qa-excel-{파일명}.json
 * - _manifest.json으로 변경 감지, 변경된 파일만 재처리
 *
 * 실행: npx tsx scripts/process-data.ts
 */

import fs from 'fs';
import path from 'path';
import type { QAItem, GuidelineChunk, ProcessingManifest } from '../lib/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx');
const DATA_DIR = path.join(process.cwd(), '..', 'data');
const OUTPUT_DIR = path.join(process.cwd(), 'data');
const GUIDELINES_DIR = path.join(OUTPUT_DIR, 'guidelines');
const MANIFEST_PATH = path.join(OUTPUT_DIR, '_manifest.json');

const CHUNK_SIZE = 500; // 청크 크기 (글자 수)
const CHUNK_OVERLAP = 50; // 청크 간 중복 (글자 수)

// ─── 유틸리티 ──────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadManifest(): ProcessingManifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    } catch {
      // 파싱 실패 시 새로 생성
    }
  }
  return { lastProcessed: '', files: {} };
}

function saveManifest(manifest: ProcessingManifest): void {
  manifest.lastProcessed = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
}

function isFileChanged(filePath: string, manifest: ProcessingManifest): boolean {
  const stat = fs.statSync(filePath);
  const existing = manifest.files[filePath];
  if (!existing) return true;
  return existing.mtime !== stat.mtime.toISOString() || existing.size !== stat.size;
}

function updateManifestEntry(
  filePath: string,
  type: 'pdf' | 'xlsx',
  manifest: ProcessingManifest
): void {
  const stat = fs.statSync(filePath);
  manifest.files[filePath] = {
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    type,
  };
}

// ─── PDF 처리 ──────────────────────────────────────────

// PDF 텍스트 정리: 세로 레이아웃 잔해 및 불필요한 줄 제거
function cleanPdfText(text: string): string {
  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 한 글자만 있는 줄이 연속되면 세로 텍스트 → 건너뛰기
    if (line.length === 1 && i + 1 < lines.length && lines[i + 1].trim().length === 1) {
      continue;
    }
    // 이전 줄도 한 글자였고 이 줄도 한 글자면 건너뛰기
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

function splitIntoChunks(
  text: string,
  source: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): GuidelineChunk[] {
  const chunks: GuidelineChunk[] = [];

  // PDF 텍스트 정리
  const cleanedText = cleanPdfText(text);

  // 빈 줄 기준으로 단락 분리
  const paragraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let currentChunk = '';
  let chunkIndex = 0;
  let currentSection = source;

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
        id: `${path.basename(source, path.extname(source))}_chunk_${chunkIndex}`,
        source: path.basename(source),
        section: currentSection,
        content: currentChunk.trim(),
        pageStart: Math.floor(chunkIndex * chunkSize / 2000) + 1, // 대략적 페이지 추정
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
      id: `${path.basename(source, path.extname(source))}_chunk_${chunkIndex}`,
      source: path.basename(source),
      section: currentSection,
      content: currentChunk.trim(),
      pageStart: Math.floor(chunkIndex * chunkSize / 2000) + 1,
    });
  }

  return chunks;
}

async function processPDFs(manifest: ProcessingManifest): Promise<GuidelineChunk[]> {
  const pdfFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.log('  PDF 파일 없음');
    return [];
  }

  // 기존 chunks 로드 (변경 안 된 파일의 chunks 유지)
  let existingChunks: GuidelineChunk[] = [];
  const chunksPath = path.join(GUIDELINES_DIR, 'chunks.json');
  if (fs.existsSync(chunksPath)) {
    try {
      existingChunks = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
    } catch {
      existingChunks = [];
    }
  }

  const allChunks: GuidelineChunk[] = [];
  const changedSources = new Set<string>();

  for (const file of pdfFiles) {
    const filePath = path.join(DATA_DIR, file);

    if (!isFileChanged(filePath, manifest)) {
      console.log(`  [스킵] ${file} (변경 없음)`);
      // 기존 chunks에서 해당 파일 것 유지
      const kept = existingChunks.filter(c => c.source === file);
      allChunks.push(...kept);
      continue;
    }

    console.log(`  [처리] ${file}`);
    changedSources.add(file);

    try {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      const text = data.text;

      console.log(`    텍스트 추출: ${text.length}자, ${data.numpages}페이지`);

      const chunks = splitIntoChunks(text, file);
      console.log(`    청크 분할: ${chunks.length}개`);

      allChunks.push(...chunks);
      updateManifestEntry(filePath, 'pdf', manifest);
    } catch (err) {
      console.error(`    [오류] ${file} 처리 실패:`, err);
    }
  }

  // 변경 안 된 파일의 기존 chunks 보존 (changedSources에 없는 것)
  if (changedSources.size === 0 && existingChunks.length > 0) {
    return existingChunks;
  }

  return allChunks;
}

// ─── Excel 처리 ────────────────────────────────────────

async function processExcels(manifest: ProcessingManifest): Promise<void> {
  const xlsxFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.toLowerCase().endsWith('.xlsx') || f.toLowerCase().endsWith('.xls'));

  if (xlsxFiles.length === 0) {
    console.log('  Excel 파일 없음');
    return;
  }

  for (const file of xlsxFiles) {
    const filePath = path.join(DATA_DIR, file);

    if (!isFileChanged(filePath, manifest)) {
      console.log(`  [스킵] ${file} (변경 없음)`);
      continue;
    }

    console.log(`  [처리] ${file}`);

    try {
      const workbook = XLSX.readFile(filePath);

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        // raw array 모드로 읽어서 헤더 행을 직접 찾기
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

        if (rawRows.length < 2) continue;

        // 헤더 행 찾기: "질문" 또는 "예상 질문" 등이 포함된 행
        let headerRowIdx = -1;
        let colMapping: { categoryIdx: number; questionIdx: number; answerIdx: number } | null = null;

        for (let i = 0; i < Math.min(5, rawRows.length); i++) {
          const row = rawRows[i] as string[];
          const mapping = detectColumnsFromArray(row);
          if (mapping) {
            headerRowIdx = i;
            colMapping = mapping;
            break;
          }
        }

        if (!colMapping || headerRowIdx < 0) {
          console.log(`    [주의] ${sheetName}: 질문/답변 컬럼을 찾을 수 없음`);
          continue;
        }

        const qaItems: QAItem[] = [];
        let id = 1;

        for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
          const row = rawRows[i] as string[];
          const question = String(row[colMapping.questionIdx] || '').trim();
          const answer = String(row[colMapping.answerIdx] || '').trim();

          if (!question || !answer) continue;

          const category = colMapping.categoryIdx >= 0
            ? String(row[colMapping.categoryIdx] || '').trim()
            : '일반';

          qaItems.push({ id: id++, category: category || '일반', question, answer });
        }

        if (qaItems.length > 0) {
          const safeFileName = file
            .replace(/\.(xlsx|xls)$/i, '')
            .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
            .substring(0, 30);
          const safeSheetName = sheetName
            .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
            .substring(0, 20);

          const outputFile = `qa-excel-${safeFileName}-${safeSheetName}.json`;
          const outputPath = path.join(OUTPUT_DIR, outputFile);

          fs.writeFileSync(outputPath, JSON.stringify(qaItems, null, 2), 'utf-8');
          console.log(`    → ${outputFile}: ${qaItems.length}건 저장`);
        }
      }

      updateManifestEntry(filePath, 'xlsx', manifest);
    } catch (err) {
      console.error(`    [오류] ${file} 처리 실패:`, err);
    }
  }
}

function detectColumnsFromArray(
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

// ─── 메인 ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Chat-ZCB 데이터 처리 시작 ===');
  console.log(`데이터 소스: ${DATA_DIR}`);
  console.log(`출력 디렉토리: ${OUTPUT_DIR}`);

  // 소스 디렉토리 존재 확인
  if (!fs.existsSync(DATA_DIR)) {
    console.log(`[경고] 데이터 소스 디렉토리가 없습니다: ${DATA_DIR}`);
    console.log('PDF/Excel 파일이 없으므로 처리를 건너뜁니다.');
    return;
  }

  ensureDir(GUIDELINES_DIR);

  const manifest = loadManifest();

  // PDF 처리
  console.log('\n[1/2] PDF 지침서 처리...');
  const chunks = await processPDFs(manifest);

  if (chunks.length > 0) {
    const chunksPath = path.join(GUIDELINES_DIR, 'chunks.json');
    fs.writeFileSync(chunksPath, JSON.stringify(chunks, null, 2), 'utf-8');
    console.log(`→ chunks.json 저장: 총 ${chunks.length}개 청크`);
  }

  // Excel 처리
  console.log('\n[2/2] Excel Q&A 처리...');
  await processExcels(manifest);

  // 매니페스트 저장
  saveManifest(manifest);

  console.log('\n=== 데이터 처리 완료 ===');
}

main().catch(err => {
  console.error('데이터 처리 중 오류 발생:', err);
  process.exit(1);
});
