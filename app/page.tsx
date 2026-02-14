import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center">
        {/* 로고/서비스명 */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-[#2E7D32] mb-4">
            Chat-ZCB
          </h1>
          <div className="h-1 w-24 bg-[#2E7D32] mx-auto"></div>
        </div>

        {/* 인사말 텍스트 */}
        <div className="mb-16">
          <p className="text-2xl text-[#333] leading-relaxed">
            안녕하세요.<br />
            탄소중립건축인증(ZCB인증)에 대해<br />
            궁금한 내용이 있다면,<br />
            저 Chat-ZCB에게 물어봐 주세요!
          </p>
        </div>

        {/* 기관 선택 버튼 */}
        <div className="flex flex-col sm:flex-row gap-6 justify-center">
          <Link
            href="/chat/certification"
            className="bg-[#2E7D32] text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-[#1B5E20] transition-colors shadow-md"
          >
            인증기관 전용
          </Link>
          <Link
            href="/chat/consulting"
            className="bg-[#2E7D32] text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-[#1B5E20] transition-colors shadow-md"
          >
            컨설팅(기술지원)기관 전용
          </Link>
        </div>

        {/* 추가 정보 */}
        <div className="mt-16 text-sm text-[#666]">
          <p>탄소중립건축인증 AI 질의응답 챗봇</p>
        </div>
      </div>
    </div>
  );
}
