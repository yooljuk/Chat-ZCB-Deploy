import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import type { QAItem, GuidelineChunk } from '@/lib/types';
import { loadAllQAData, loadGuidelineChunks } from '@/lib/data-loader';

interface ChatLog {
  timestamp: string;
  type: 'certification' | 'consulting';
  question: string;
  answer: string;
  isFallback: boolean;
}

// 폴백 메시지 상수
const FALLBACK_MESSAGE = `해당 내용은 Chat-ZCB에서 안내드리기 어려운 사항입니다.
아래 담당자에게 직접 문의하여 주시기 바랍니다.
▶ 담당자: 성진호 연구원
▶ 전화: 031-436-8075
▶ 이메일: susb30@susb.co.kr`;

// 불용어 (조사, 어미 등)
const STOPWORDS = new Set([
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '로', '도',
  '에서', '으로', '하는', '있는', '되는', '대해', '대한', '어떻게', '무엇',
  '어떤', '위해', '통해', '관련', '경우', '있나요', '인가요', '되나요',
  '하나요', '건가요', '볼까요', '무엇인가요', '무엇이', '알려주세요',
  '설명해', '어떻게', '궁금합니다',
]);

// 한국어 조사 제거
const PARTICLES = [
  '에서는', '으로는', '이라는', '에서', '으로', '이란', '이라',
  '에는', '에게', '까지', '부터', '처럼', '만큼',
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '로', '도', '만', '란',
];

function stripParticles(word: string): string {
  for (const p of PARTICLES) {
    if (word.length > p.length + 1 && word.endsWith(p)) {
      return word.slice(0, -p.length);
    }
  }
  return word;
}

// 텍스트에서 핵심 키워드 추출 (2글자 이상 의미 단위)
function extractKeywords(text: string): string[] {
  const cleaned = text.replace(/[()（）\[\]?!.,·▶]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(t => t.length >= 2);
  return tokens.filter(t => !STOPWORDS.has(t));
}

// 조사 제거된 키워드 추출 (chunk 매칭용)
function extractCoreKeywords(text: string): string[] {
  const keywords = extractKeywords(text);
  return keywords.map(kw => stripParticles(kw)).filter(kw => kw.length >= 2);
}

// 키워드 매칭 점수 계산 (부분 매칭 지원)
function calculateMatchScore(userQuestion: string, qaItem: QAItem): number {
  const userKeywords = extractKeywords(userQuestion);
  const qaQuestion = qaItem.question.replace(/[()（）\[\]?!.,]/g, ' ').toLowerCase();
  const qaAnswer = qaItem.answer.replace(/[()（）\[\]?!.,]/g, ' ').toLowerCase();

  let score = 0;

  for (const keyword of userKeywords) {
    const kw = keyword.toLowerCase();

    if (qaQuestion.includes(kw)) {
      score += 3;
    } else if (qaAnswer.includes(kw)) {
      score += 1;
    } else {
      const qaKeywords = extractKeywords(qaItem.question);
      for (const qk of qaKeywords) {
        if (kw.includes(qk.toLowerCase()) || qk.toLowerCase().includes(kw)) {
          score += 2;
          break;
        }
      }
    }
  }

  return score;
}

// 관련 Q&A 추출
function findRelevantQAs(question: string, qaData: QAItem[]): { qas: QAItem[]; topScore: number } {
  const scoredQAs = qaData.map(qa => ({
    qa,
    score: calculateMatchScore(question, qa)
  }));

  const sorted = scoredQAs.sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score || 0;

  const filtered = sorted
    .filter(item => item.score >= 2)
    .slice(0, 3)
    .map(item => item.qa);

  return { qas: filtered, topScore };
}

// 지침 chunk 매칭 점수 계산 (조사 제거 + 부분 매칭)
function calculateChunkScore(userQuestion: string, chunk: GuidelineChunk): number {
  const userKeywords = extractCoreKeywords(userQuestion);
  const content = chunk.content.toLowerCase();

  let score = 0;
  for (const keyword of userKeywords) {
    const kw = keyword.toLowerCase();
    if (content.includes(kw)) {
      score += 2;
    }
  }

  return score;
}

// 관련 지침 chunks 추출
function findRelevantChunks(
  question: string,
  chunks: GuidelineChunk[]
): GuidelineChunk[] {
  if (chunks.length === 0) return [];

  const scored = chunks.map(chunk => ({
    chunk,
    score: calculateChunkScore(question, chunk)
  }));

  const sorted = scored
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  // 중복 내용 제거: 비슷한 내용의 chunk는 1개만 유지
  const selected: GuidelineChunk[] = [];
  const seenContent = new Set<string>();

  for (const item of sorted) {
    // 앞부분 100자로 유사도 판단
    const contentKey = item.chunk.content.substring(0, 100).replace(/\s+/g, '');
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);
    selected.push(item.chunk);
    if (selected.length >= 5) break;
  }

  return selected;
}

// 시스템 프롬프트 생성 (지침 참고 시 출처 표기 지시 추가)
function getSystemPrompt(type: 'certification' | 'consulting', hasGuidelines: boolean): string {
  const institutionType = type === 'certification'
    ? '인증기관'
    : '컨설팅(기술지원)기관';

  let prompt = `당신은 탄소중립건축인증(ZCB인증) ${institutionType} 전용 AI 상담원 Chat-ZCB입니다.
아래 [참고 답변]의 내용을 활용하여 사용자 질문에 격식체(~입니다, ~바랍니다)로 답변해 주세요.
참고 답변의 내용만 활용하고, 없는 내용을 만들어내지 마세요.`;

  if (hasGuidelines) {
    prompt += `\n[지침서 참고 내용]이 포함된 경우, 해당 내용을 활용하여 답변하되 답변 마지막에 "(참고: {출처 지침서명})" 형태로 출처를 표기해 주세요.`;
  }

  return prompt;
}

// 사용자 메시지 생성 (Q&A + 지침 chunks 결합)
function getUserMessage(
  question: string,
  relevantQAs: QAItem[],
  relevantChunks: GuidelineChunk[]
): string {
  let message = '';

  if (relevantQAs.length > 0) {
    message += '[참고 답변]\n';
    for (const qa of relevantQAs) {
      message += `질문: ${qa.question}\n`;
      message += `답변: ${qa.answer}\n\n`;
    }
  }

  if (relevantChunks.length > 0) {
    message += '[지침서 참고 내용]\n';
    for (const chunk of relevantChunks) {
      message += `출처: ${chunk.source}\n`;
      message += `내용: ${chunk.content}\n\n`;
    }
  }

  message += `[사용자의 질문]\n${question}`;

  return message;
}

// 폴백 여부 확인
function isFallbackResponse(answer: string): boolean {
  return answer.includes('안내드리기 어려운') || answer.includes('담당자에게')
    || answer.includes('답변할 수 없습니다') || answer.includes('답변이 어렵')
    || answer.includes('포함되어 있지 않습니다') || answer.includes('정보가 없습니다');
}

// 로그 저장
function saveLog(log: ChatLog): void {
  const logsDir = path.join(process.cwd(), 'logs');
  const logsFile = path.join(logsDir, 'chat-logs.json');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  let logs: ChatLog[] = [];
  if (fs.existsSync(logsFile)) {
    try {
      logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
    } catch {
      logs = [];
    }
  }

  logs.push(log);
  fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2), 'utf-8');
}

// POST 요청 핸들러
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, type } = body;

    if (!message || !type) {
      return NextResponse.json(
        { error: 'message와 type은 필수 입력값입니다.' },
        { status: 400 }
      );
    }

    if (type !== 'certification' && type !== 'consulting') {
      return NextResponse.json(
        { error: 'type은 certification 또는 consulting이어야 합니다.' },
        { status: 400 }
      );
    }

    // 1. Q&A 데이터 로드 (data-loader 사용, 캐시 적용)
    const qaData = loadAllQAData(type);

    // 2. 관련 Q&A 추출
    const { qas: relevantQAs, topScore } = findRelevantQAs(message, qaData);

    // 3. 지침 chunks 검색 (항상 검색, Q&A 보충)
    const allChunks = loadGuidelineChunks();
    let relevantChunks = findRelevantChunks(message, allChunks);

    // Q&A 점수가 충분히 높고 chunk가 보충 역할만 하면 상위 1개
    if (topScore >= 8 && relevantChunks.length > 0) {
      relevantChunks = relevantChunks.slice(0, 1);
    }

    // 4. Q&A와 지침 모두 결과 없으면 폴백
    if (relevantQAs.length === 0 && relevantChunks.length === 0) {
      const log: ChatLog = {
        timestamp: new Date().toISOString(),
        type,
        question: message,
        answer: FALLBACK_MESSAGE,
        isFallback: true
      };
      saveLog(log);
      return NextResponse.json({ answer: FALLBACK_MESSAGE, isFallback: true });
    }

    // 5. Gemini API 호출
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const systemPrompt = getSystemPrompt(type, relevantChunks.length > 0);
    const userMessage = getUserMessage(message, relevantQAs, relevantChunks);
    const fullPrompt = `${systemPrompt}\n\n${userMessage}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
      }
    });

    const rawAnswer = result.response.text();

    // 6. 폴백 여부 확인 및 표준 폴백 메시지 적용
    const isFallback = isFallbackResponse(rawAnswer);
    const answer = isFallback ? FALLBACK_MESSAGE : rawAnswer;

    // 7. 로그 저장
    const log: ChatLog = {
      timestamp: new Date().toISOString(),
      type,
      question: message,
      answer,
      isFallback
    };

    saveLog(log);

    return NextResponse.json({ answer, isFallback });

  } catch (error) {
    console.error('Chat API 오류:', error);
    return NextResponse.json(
      { error: '챗봇 응답 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
