import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { QAItem, GuidelineChunk } from '@/lib/types';
import { loadAllQAData, loadGuidelineChunks, loadEmbeddings } from '@/lib/data-loader';
import { generateEmbedding, findSimilarByEmbedding } from '@/lib/embeddings';
import { saveLog, type ChatLog } from '@/lib/kv-logger';
import { loadAllUploadedData } from '@/lib/kv-data';

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

// 동의어 매핑
const SYNONYMS: Record<string, string[]> = {
  // 기관명 동의어
  '컨설팅기관': ['기술지원기관', '컨설팅사'],
  '기술지원기관': ['컨설팅기관', '컨설팅사'],
  '컨설팅사': ['기술지원기관', '컨설팅기관'],
  '컨설팅': ['기술지원'],
  '기술지원': ['컨설팅'],
  // 역할/업무 동의어
  '역할': ['업무범위', '업무', '담당업무', '하는일'],
  '업무범위': ['역할', '업무', '담당업무'],
  '업무': ['역할', '업무범위'],
  // 비용 동의어
  '비용': ['수수료', '요금', '금액'],
  '수수료': ['비용', '요금', '금액'],
  // 절차 동의어
  '절차': ['과정', '프로세스', '순서', '단계'],
  '과정': ['절차', '프로세스', '순서'],
  // 자격 동의어
  '자격': ['요건', '조건', '기준'],
  '요건': ['자격', '조건', '기준'],
};

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

// 키워드에 동의어를 확장하여 반환
function expandWithSynonyms(keywords: string[]): string[] {
  const expanded = [...keywords];
  for (const kw of keywords) {
    // 정확히 일치하는 동의어
    if (SYNONYMS[kw]) {
      expanded.push(...SYNONYMS[kw]);
    }
    // 키워드가 동의어를 포함하는 경우 (예: "컨설팅기관의" → "컨설팅기관" 매칭)
    for (const [term, synonyms] of Object.entries(SYNONYMS)) {
      if (kw.includes(term)) {
        for (const syn of synonyms) {
          expanded.push(kw.replace(term, syn));
        }
      }
    }
  }
  return [...new Set(expanded)];
}

// 조사 제거된 키워드 추출 (chunk 매칭용)
function extractCoreKeywords(text: string): string[] {
  const keywords = extractKeywords(text);
  return keywords.map(kw => stripParticles(kw)).filter(kw => kw.length >= 2);
}

// 키워드 매칭 점수 계산 (부분 매칭 + 동의어 지원)
function calculateMatchScore(userQuestion: string, qaItem: QAItem): number {
  const userKeywords = expandWithSynonyms(extractKeywords(userQuestion));
  const qaQuestion = qaItem.question.replace(/[()（）\[\]?!.,]/g, ' ').toLowerCase();
  const qaAnswer = qaItem.answer.replace(/[()（）\[\]?!.,]/g, ' ').toLowerCase();

  let score = 0;
  const scored = new Set<string>(); // 동의어 중복 점수 방지

  for (const keyword of userKeywords) {
    const kw = keyword.toLowerCase();
    if (scored.has(kw)) continue;

    if (qaQuestion.includes(kw)) {
      score += 3;
      scored.add(kw);
    } else if (qaAnswer.includes(kw)) {
      score += 1;
      scored.add(kw);
    } else {
      const qaKeywords = extractKeywords(qaItem.question);
      for (const qk of qaKeywords) {
        if (kw.includes(qk.toLowerCase()) || qk.toLowerCase().includes(kw)) {
          score += 2;
          scored.add(kw);
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
    .slice(0, 5)
    .map(item => item.qa);

  return { qas: filtered, topScore };
}

// 지침 chunk 매칭 점수 계산 (조사 제거 + 부분 매칭 + 동의어)
function calculateChunkScore(userQuestion: string, chunk: GuidelineChunk): number {
  const userKeywords = expandWithSynonyms(extractCoreKeywords(userQuestion));
  const content = chunk.content.toLowerCase();

  let score = 0;
  const scored = new Set<string>();
  for (const keyword of userKeywords) {
    const kw = keyword.toLowerCase();
    if (scored.has(kw)) continue;
    if (content.includes(kw)) {
      score += 2;
      scored.add(kw);
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

// 시스템 프롬프트 생성
function getSystemPrompt(type: 'certification' | 'consulting', hasGuidelines: boolean): string {
  const institutionType = type === 'certification'
    ? '인증기관'
    : '컨설팅(기술지원)기관';

  let prompt = `당신은 탄소중립건축인증(ZCB인증) ${institutionType} 전용 AI 상담원 Chat-ZCB입니다.

[답변 규칙]
1. 반드시 [참고 답변]과 [지침서 참고 내용]에 있는 정보만 사용하여 답변하세요.
2. 사용자의 질문 의도를 정확히 파악하세요. 예를 들어 "역할"을 물으면 "역할/업무범위"에 대해 답하고, "어디인가요"를 물으면 "기관 목록"을 답하세요.
3. 참고 자료에 여러 Q&A가 제공되더라도, 사용자 질문과 가장 관련 있는 내용만 선별하여 답변하세요.
4. 참고 자료에 해당 내용이 없으면 "해당 내용은 현재 제공된 자료에 포함되어 있지 않습니다."라고 답하세요.
5. 참고 자료에 없는 내용을 추측하거나 만들어내지 마세요.
6. "기술지원기관"과 "컨설팅기관"은 동일한 기관을 의미합니다.

[답변 형식]
- 격식체(~입니다, ~바랍니다)를 사용합니다.
- 항목이 여러 개인 경우 번호를 매겨 나열합니다.
- 답변은 간결하되 핵심 정보를 빠뜨리지 마세요.`;

  if (hasGuidelines) {
    prompt += `\n- [지침서 참고 내용]을 활용한 경우, 답변 마지막에 "(참고: {출처 지침서명})" 형태로 출처를 표기합니다.`;
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

// 임베딩 기반 Q&A 검색 (정적 + 업로드 임베딩 병합)
async function findRelevantQAsByEmbedding(
  queryVec: number[],
  qaData: QAItem[],
  uploadedEmbeddings: { id: number; vector: number[] }[] = []
): Promise<{ qas: QAItem[]; topScore: number }> {
  const embeddingData = loadEmbeddings();

  // 정적 임베딩 + 업로드 임베딩 병합
  const allEmbeddings: { id: number | string; vector: number[] }[] = [
    ...(embeddingData?.qaEmbeddings || []),
    ...uploadedEmbeddings,
  ];

  if (allEmbeddings.length === 0) {
    return { qas: [], topScore: 0 };
  }

  const qaMap = new Map(qaData.map(qa => [qa.id, qa]));
  const matches = findSimilarByEmbedding(queryVec, allEmbeddings, 5, 0.5);
  const topScore = matches[0]?.score || 0;
  const qas = matches
    .map(m => qaMap.get(m.id as number))
    .filter((qa): qa is QAItem => qa !== undefined);

  return { qas, topScore };
}

// 임베딩 기반 지침 chunk 검색
function findRelevantChunksByEmbedding(
  queryVec: number[],
  chunks: GuidelineChunk[]
): GuidelineChunk[] {
  const embeddingData = loadEmbeddings();
  if (!embeddingData || embeddingData.chunkEmbeddings.length === 0) {
    return [];
  }

  const chunkMap = new Map(chunks.map(c => [c.id, c]));
  const matches = findSimilarByEmbedding(queryVec, embeddingData.chunkEmbeddings, 5, 0.5);

  // 중복 내용 제거
  const selected: GuidelineChunk[] = [];
  const seenContent = new Set<string>();

  for (const match of matches) {
    const chunk = chunkMap.get(match.id as string);
    if (!chunk) continue;
    const contentKey = chunk.content.substring(0, 100).replace(/\s+/g, '');
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);
    selected.push(chunk);
  }

  return selected;
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

    // 1. 데이터 로드 (정적 + 업로드 병합)
    const staticQA = loadAllQAData(type);
    const allChunks = loadGuidelineChunks();
    const embeddingData = loadEmbeddings();

    // 업로드된 데이터 (Redis)
    let uploadedData = { items: [] as QAItem[], embeddings: [] as { id: number; vector: number[] }[] };
    try {
      uploadedData = await loadAllUploadedData();
    } catch (err) {
      console.error('업로드 데이터 로드 실패:', err);
    }

    // 병합
    const qaData = [...staticQA, ...uploadedData.items];

    let relevantQAs: QAItem[] = [];
    let relevantChunks: GuidelineChunk[] = [];
    let searchMethod: 'embedding' | 'keyword' = 'keyword';

    // 2. 임베딩 기반 검색 (primary)
    if (embeddingData || uploadedData.embeddings.length > 0) {
      try {
        const queryVec = await generateEmbedding(message);
        const embQAs = await findRelevantQAsByEmbedding(queryVec, qaData, uploadedData.embeddings);
        const embChunks = findRelevantChunksByEmbedding(queryVec, allChunks);

        if (embQAs.qas.length > 0 || embChunks.length > 0) {
          relevantQAs = embQAs.qas;
          relevantChunks = embChunks;
          searchMethod = 'embedding';

          // Q&A 유사도가 높으면 chunk는 보충용 1개로 제한
          if (embQAs.topScore >= 0.75 && relevantChunks.length > 0) {
            relevantChunks = relevantChunks.slice(0, 1);
          }
        }
      } catch (err) {
        console.error('임베딩 검색 실패, 키워드 검색으로 fallback:', err);
      }
    }

    // 3. 키워드 매칭 (fallback)
    if (searchMethod === 'keyword') {
      const { qas, topScore } = findRelevantQAs(message, qaData);
      relevantQAs = qas;
      relevantChunks = findRelevantChunks(message, allChunks);

      if (topScore >= 8 && relevantChunks.length > 0) {
        relevantChunks = relevantChunks.slice(0, 1);
      }
    }

    // 4. 결과 없으면 폴백
    if (relevantQAs.length === 0 && relevantChunks.length === 0) {
      const log: ChatLog = {
        timestamp: new Date().toISOString(),
        type,
        question: message,
        answer: FALLBACK_MESSAGE,
        isFallback: true
      };
      await saveLog(log);
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
        temperature: 0.1,
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

    await saveLog(log);

    return NextResponse.json({ answer, isFallback });

  } catch (error) {
    console.error('Chat API 오류:', error);
    return NextResponse.json(
      { error: '챗봇 응답 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
