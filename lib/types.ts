// Q&A 데이터 항목
export interface QAItem {
  id: number;
  category: string;
  question: string;
  answer: string;
}

// 지침서 텍스트 청크
export interface GuidelineChunk {
  id: string;
  source: string;       // 원본 파일명
  section: string;       // 섹션/장 제목
  content: string;       // 청크 텍스트
  pageStart: number;     // 시작 페이지 (추정)
}

// 임베딩 데이터 (사전 생성된 벡터)
export interface EmbeddingData {
  qaEmbeddings: { id: number; vector: number[] }[];
  chunkEmbeddings: { id: string; vector: number[] }[];
  model: string;
  dimensions: number;
  generatedAt: string;
}

// 데이터 처리 매니페스트 (변경 감지용)
export interface ProcessingManifest {
  lastProcessed: string; // ISO datetime
  files: {
    [filePath: string]: {
      mtime: string;     // 파일 수정일
      size: number;      // 파일 크기
      type: 'pdf' | 'xlsx';
    };
  };
}
