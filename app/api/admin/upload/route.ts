/**
 * 관리자 Excel 업로드 API
 *
 * POST   — Excel 업로드 → 파싱 → 임베딩 생성 → Redis 저장
 * GET    — 업로드된 파일 목록 조회
 * DELETE — 특정 파일 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseExcelBuffer } from '@/lib/excel-parser';
import { generateBatchEmbeddings } from '@/lib/embeddings';
import {
  saveUploadedQA,
  getUploadedFiles,
  deleteUploadedFile,
} from '@/lib/kv-data';

function isAuthorized(password: string): boolean {
  return password === process.env.ADMIN_PASSWORD;
}

// ─── POST: Excel 업로드 처리 ─────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const password = formData.get('password') as string;
    const file = formData.get('file') as File | null;

    if (!isAuthorized(password)) {
      return NextResponse.json({ error: '인증 실패' }, { status: 401 });
    }

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const filename = file.name;
    if (!/\.(xlsx|xls)$/i.test(filename)) {
      return NextResponse.json(
        { error: 'Excel 파일(.xlsx, .xls)만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    // 1. Excel 파싱
    const buffer = Buffer.from(await file.arrayBuffer());
    const items = parseExcelBuffer(buffer, filename);

    if (items.length === 0) {
      return NextResponse.json(
        { error: '파일에서 Q&A 데이터를 찾을 수 없습니다. 질문/답변 컬럼이 있는지 확인하세요.' },
        { status: 400 }
      );
    }

    // 2. 임베딩 생성
    const texts = items.map(item => `${item.question} ${item.answer}`);
    const vectors = await generateBatchEmbeddings(texts);
    const embeddings = items.map((item, idx) => ({
      id: item.id,
      vector: vectors[idx],
    }));

    // 3. Redis 저장
    await saveUploadedQA(filename, items, embeddings);

    return NextResponse.json({
      success: true,
      message: `${filename} 업로드 완료`,
      itemCount: items.length,
    });
  } catch (error) {
    console.error('[upload] POST 오류:', error);
    return NextResponse.json(
      { error: '업로드 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// ─── GET: 업로드 파일 목록 ───────────────────────────────

export async function GET() {
  try {
    const files = await getUploadedFiles();
    return NextResponse.json({ files });
  } catch (error) {
    console.error('[upload] GET 오류:', error);
    return NextResponse.json(
      { error: '파일 목록 조회 실패' },
      { status: 500 }
    );
  }
}

// ─── DELETE: 파일 삭제 ───────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { password, filename } = body;

    if (!isAuthorized(password)) {
      return NextResponse.json({ error: '인증 실패' }, { status: 401 });
    }

    if (!filename) {
      return NextResponse.json({ error: '파일명이 필요합니다.' }, { status: 400 });
    }

    const deleted = await deleteUploadedFile(filename);

    return NextResponse.json({
      success: deleted,
      message: deleted ? `${filename} 삭제 완료` : '삭제 실패',
    });
  } catch (error) {
    console.error('[upload] DELETE 오류:', error);
    return NextResponse.json(
      { error: '삭제 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
