import { NextResponse } from 'next/server';
import { getStats } from '@/lib/kv-logger';

// GET 요청 핸들러
export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats);

  } catch (error) {
    console.error('Stats API 오류:', error);
    return NextResponse.json(
      { error: '통계 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
