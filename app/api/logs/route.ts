import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 타입 정의
interface ChatLog {
  timestamp: string;
  type: 'certification' | 'consulting';
  question: string;
  answer: string;
  isFallback: boolean;
}

interface LogsResponse {
  logs: ChatLog[];
}

// GET 요청 핸들러
export async function GET(request: NextRequest) {
  try {
    // 쿼리 파라미터 추출
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') as 'certification' | 'consulting' | null;
    const from = searchParams.get('from'); // 예: 2025-01-01
    const to = searchParams.get('to'); // 예: 2025-12-31
    const fallbackParam = searchParams.get('fallback'); // 예: true

    // 로그 파일 읽기
    const logsFile = path.join(process.cwd(), 'logs', 'chat-logs.json');
    let logs: ChatLog[] = [];

    if (fs.existsSync(logsFile)) {
      try {
        logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
      } catch (error) {
        console.error('로그 파일 읽기 오류:', error);
        logs = [];
      }
    }

    // 필터링
    let filteredLogs = logs;

    // type 필터링
    if (type) {
      filteredLogs = filteredLogs.filter(log => log.type === type);
    }

    // from 날짜 필터링
    if (from) {
      const fromDate = new Date(from);
      filteredLogs = filteredLogs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= fromDate;
      });
    }

    // to 날짜 필터링
    if (to) {
      const toDate = new Date(to);
      // to 날짜의 끝(23:59:59)까지 포함
      toDate.setHours(23, 59, 59, 999);
      filteredLogs = filteredLogs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate <= toDate;
      });
    }

    // fallback 필터링
    if (fallbackParam !== null) {
      const fallbackValue = fallbackParam === 'true';
      filteredLogs = filteredLogs.filter(log => log.isFallback === fallbackValue);
    }

    // 응답 반환 (최신순 정렬)
    const response: LogsResponse = {
      logs: filteredLogs.sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Logs API 오류:', error);
    return NextResponse.json(
      { error: '로그 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
