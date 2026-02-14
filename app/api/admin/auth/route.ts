import { NextRequest, NextResponse } from 'next/server';

// 타입 정의
interface AuthRequest {
  password: string;
}

interface AuthResponse {
  success: boolean;
  message?: string;
}

// POST 요청 핸들러
export async function POST(request: NextRequest) {
  try {
    // 요청 본문 파싱
    const body = await request.json() as AuthRequest;
    const { password } = body;

    // 입력 검증
    if (!password) {
      return NextResponse.json(
        { success: false, message: '비밀번호를 입력해 주세요.' } as AuthResponse,
        { status: 400 }
      );
    }

    // 환경변수에서 관리자 비밀번호 가져오기
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
      return NextResponse.json(
        { success: false, message: '서버 설정 오류가 발생했습니다.' } as AuthResponse,
        { status: 500 }
      );
    }

    // 비밀번호 비교
    if (password === adminPassword) {
      return NextResponse.json(
        { success: true } as AuthResponse
      );
    } else {
      return NextResponse.json(
        { success: false, message: '비밀번호가 올바르지 않습니다.' } as AuthResponse,
        { status: 401 }
      );
    }

  } catch (error) {
    console.error('Admin Auth API 오류:', error);
    return NextResponse.json(
      { success: false, message: '인증 처리 중 오류가 발생했습니다.' } as AuthResponse,
      { status: 500 }
    );
  }
}
