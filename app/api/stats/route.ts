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

interface StatsResponse {
  totalQuestions: number;
  fallbackCount: number;
  fallbackRate: number;
  byType: {
    certification: number;
    consulting: number;
  };
  byCategory: Record<string, number>;
  recentDays: {
    date: string;
    count: number;
  }[];
}

// 카테고리 추정 함수 (간단한 키워드 매칭)
function estimateCategory(question: string): string {
  const keywords: Record<string, string[]> = {
    '인증절차': ['절차', '신청', '접수', '단계', '프로세스'],
    '서류제출': ['서류', '제출', '문서', '양식', '첨부'],
    '평가방법': ['평가', '계산', '측정', '산정', '방법'],
    '인증기준': ['기준', '요건', '조건', '자격'],
    '수수료': ['수수료', '비용', '금액', '요금'],
    '기타': []
  };

  for (const [category, keywordList] of Object.entries(keywords)) {
    for (const keyword of keywordList) {
      if (question.includes(keyword)) {
        return category;
      }
    }
  }

  return '기타';
}

// GET 요청 핸들러
export async function GET(request: NextRequest) {
  try {
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

    // 1. 총 질문 수
    const totalQuestions = logs.length;

    // 2. 폴백 발생 수
    const fallbackCount = logs.filter(log => log.isFallback).length;

    // 3. 폴백 비율 (%)
    const fallbackRate = totalQuestions > 0
      ? Math.round((fallbackCount / totalQuestions) * 100 * 100) / 100
      : 0;

    // 4. 기관 유형별 질문 수
    const byType = {
      certification: logs.filter(log => log.type === 'certification').length,
      consulting: logs.filter(log => log.type === 'consulting').length
    };

    // 5. 카테고리별 질문 수
    const categoryMap: Record<string, number> = {};
    logs.forEach(log => {
      const category = estimateCategory(log.question);
      categoryMap[category] = (categoryMap[category] || 0) + 1;
    });

    // 6. 최근 7일간 일별 질문 수
    const today = new Date();
    const recentDays: { date: string; count: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() - i);
      const dateString = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

      const count = logs.filter(log => {
        const logDate = new Date(log.timestamp).toISOString().split('T')[0];
        return logDate === dateString;
      }).length;

      recentDays.push({
        date: dateString,
        count
      });
    }

    // 응답 반환
    const response: StatsResponse = {
      totalQuestions,
      fallbackCount,
      fallbackRate,
      byType,
      byCategory: categoryMap,
      recentDays
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Stats API 오류:', error);
    return NextResponse.json(
      { error: '통계 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
