import { NextRequest, NextResponse } from 'next/server';
import { getLogs, deleteLogsBefore, deleteAllLogs } from '@/lib/kv-logger';

// GET 요청 핸들러
export async function GET(request: NextRequest) {
  try {
    // 쿼리 파라미터 추출
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') as 'certification' | 'consulting' | null;
    const from = searchParams.get('from'); // 예: 2025-01-01
    const to = searchParams.get('to'); // 예: 2025-12-31
    const fallbackParam = searchParams.get('fallback'); // 예: true

    const logs = await getLogs({
      type,
      from,
      to,
      fallback: fallbackParam !== null ? fallbackParam === 'true' : null,
    });

    return NextResponse.json({ logs });

  } catch (error) {
    console.error('Logs API 오류:', error);
    return NextResponse.json(
      { error: '로그 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// DELETE 요청 핸들러 — 로그 삭제
export async function DELETE(request: NextRequest) {
  try {
    // 관리자 인증 확인
    const body = await request.json();
    const { password, before } = body;

    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: '인증에 실패했습니다.' },
        { status: 401 }
      );
    }

    let deletedCount: number;

    if (before) {
      // 특정 날짜 이전 로그 삭제
      deletedCount = await deleteLogsBefore(before);
    } else {
      // 전체 삭제
      deletedCount = await deleteAllLogs();
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `${deletedCount}건의 로그가 삭제되었습니다.`,
    });

  } catch (error) {
    console.error('Logs DELETE API 오류:', error);
    return NextResponse.json(
      { error: '로그 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
