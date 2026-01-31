/**
 * Deepgram Keywords/Keyterms Configuration
 *
 * Purpose: Manage domain-specific terminology for accurate transcription
 *
 * Nova-3: Uses keyterms (max 500 tokens, 20-50 recommended)
 * Enhanced: Uses keywords with intensifiers (max 100 keywords)
 */

export interface KeywordConfig {
  term: string;
  intensifier?: number; // 1-5 for Enhanced model (default: 1)
}

/**
 * Church service keywords (Korean LDS)
 * Optimized for religious terminology and proper nouns
 * Intensifier 조정: 핵심 용어는 높은 값 (4-5), 일반 용어는 중간 값 (2-3)
 */
export const CHURCH_KEYWORDS: KeywordConfig[] = [
  // Core religious terms - highest priority
  { term: '예수그리스도', intensifier: 5 },
  { term: '후기성도', intensifier: 5 },
  { term: '하나님', intensifier: 5 },
  { term: '성령', intensifier: 4 },
  { term: '성신', intensifier: 4 },

  // LDS 핵심 용어 (intensifier 상향)
  { term: '성찬', intensifier: 5 },
  { term: '성찬식', intensifier: 5 },
  { term: '간증', intensifier: 5 },
  { term: '간증하다', intensifier: 4 },
  { term: '몰몬경', intensifier: 5 },
  { term: '교리와 성약', intensifier: 5 },
  { term: '값진 진주', intensifier: 4 },
  { term: '선지자', intensifier: 5 },
  { term: '속죄', intensifier: 5 },
  { term: '침례', intensifier: 5 },
  { term: '신권', intensifier: 4 },

  // 경전 인물
  { term: '니파이', intensifier: 4 },
  { term: '앨마', intensifier: 4 },
  { term: '앰율레크', intensifier: 4 },
  { term: '베냐민', intensifier: 4 },
  { term: '리하이', intensifier: 4 },
  { term: '모로나이', intensifier: 4 },
  { term: '힐라맨', intensifier: 3 },
  { term: '이더', intensifier: 3 },

  // 현대 선지자
  { term: '조셉 스미스', intensifier: 5 },
  { term: '브리검 영', intensifier: 4 },
  { term: '러셀 넬슨', intensifier: 4 },
  { term: '넬슨 회장', intensifier: 4 },

  // Common church terms
  { term: '교회', intensifier: 4 },
  { term: '성경', intensifier: 4 },
  { term: '기도', intensifier: 3 },
  { term: '찬양', intensifier: 3 },
  { term: '축복', intensifier: 3 },
  { term: '은혜', intensifier: 3 },

  // Religious concepts
  { term: '구원', intensifier: 4 },
  { term: '구주', intensifier: 5 },
  { term: '영생', intensifier: 4 },
  { term: '천국', intensifier: 3 },
  { term: '신앙', intensifier: 3 },
  { term: '안식일', intensifier: 3 },
  { term: '회개', intensifier: 4 },
  { term: '자비', intensifier: 4 },
  { term: '공의', intensifier: 4 },
  { term: '부활', intensifier: 4 },
  { term: '권능', intensifier: 3 },

  // Church organization
  { term: '감독', intensifier: 3 },
  { term: '장로', intensifier: 3 },
  { term: '집사', intensifier: 2 },
  { term: '선교사', intensifier: 3 },
  { term: '선교부', intensifier: 3 },
  { term: '와드', intensifier: 3 },
  { term: '스테이크', intensifier: 3 },
  { term: '지부', intensifier: 2 },
  { term: '제일회장단', intensifier: 4 },
  { term: '십이사도', intensifier: 4 },
  { term: '사도', intensifier: 3 },

  // 의식
  { term: '성전', intensifier: 4 },
  { term: '확인', intensifier: 2 },
  { term: '멜기세덱', intensifier: 3 },
  { term: '아론', intensifier: 3 },
];

/**
 * Medical consultation keywords
 */
export const MEDICAL_KEYWORDS: KeywordConfig[] = [
  { term: '진단', intensifier: 4 },
  { term: '치료', intensifier: 4 },
  { term: '증상', intensifier: 4 },
  { term: '처방', intensifier: 3 },
  { term: '검사', intensifier: 3 },
  { term: '수술', intensifier: 3 },
  { term: '약물', intensifier: 3 },
  { term: '환자', intensifier: 2 },
  { term: '병원', intensifier: 2 },
];

/**
 * Legal consultation keywords
 */
export const LEGAL_KEYWORDS: KeywordConfig[] = [
  { term: '법률', intensifier: 4 },
  { term: '조항', intensifier: 4 },
  { term: '계약', intensifier: 4 },
  { term: '소송', intensifier: 3 },
  { term: '판례', intensifier: 3 },
  { term: '변호사', intensifier: 3 },
  { term: '검사', intensifier: 3 },
  { term: '판사', intensifier: 3 },
  { term: '법원', intensifier: 2 },
  { term: '민법', intensifier: 2 },
  { term: '형법', intensifier: 2 },
];

/**
 * Business meeting keywords
 */
export const BUSINESS_KEYWORDS: KeywordConfig[] = [
  { term: '매출', intensifier: 4 },
  { term: '전략', intensifier: 4 },
  { term: '계획', intensifier: 3 },
  { term: '목표', intensifier: 3 },
  { term: '성과', intensifier: 3 },
  { term: '회의', intensifier: 2 },
  { term: '보고', intensifier: 2 },
];

/**
 * Technical/IT discussion keywords
 */
export const TECH_KEYWORDS: KeywordConfig[] = [
  { term: '개발', intensifier: 4 },
  { term: '프로그래밍', intensifier: 3 },
  { term: '알고리즘', intensifier: 3 },
  { term: '데이터베이스', intensifier: 3 },
  { term: '서버', intensifier: 3 },
  { term: '클라이언트', intensifier: 2 },
  { term: '배포', intensifier: 2 },
];

/**
 * Education/Lecture keywords
 */
export const EDUCATION_KEYWORDS: KeywordConfig[] = [
  { term: '강의', intensifier: 4 },
  { term: '학습', intensifier: 3 },
  { term: '교육', intensifier: 3 },
  { term: '수업', intensifier: 3 },
  { term: '과제', intensifier: 2 },
  { term: '시험', intensifier: 2 },
];

/**
 * General conversation keywords (minimal)
 */
export const GENERAL_KEYWORDS: KeywordConfig[] = [];

/**
 * Keyword registry by template name
 */
export const KEYWORD_REGISTRY: Record<string, KeywordConfig[]> = {
  church: CHURCH_KEYWORDS,
  medical: MEDICAL_KEYWORDS,
  legal: LEGAL_KEYWORDS,
  business: BUSINESS_KEYWORDS,
  tech: TECH_KEYWORDS,
  education: EDUCATION_KEYWORDS,
  general: GENERAL_KEYWORDS,
};

/**
 * Get keywords for a specific template
 */
export function getKeywords(templateName: string): KeywordConfig[] {
  return KEYWORD_REGISTRY[templateName] || GENERAL_KEYWORDS;
}

/**
 * Convert keywords to Nova-3 keyterms format (no intensifiers)
 * Recommended: 20-50 terms, max 500 tokens
 */
export function toKeyterms(keywords: KeywordConfig[]): string[] {
  // Sort by intensifier (highest first) and take top 50
  return keywords
    .sort((a, b) => (b.intensifier || 1) - (a.intensifier || 1))
    .slice(0, 50)
    .map(k => k.term);
}

/**
 * Convert keywords to Enhanced model format with intensifiers
 * Max 100 keywords
 */
export function toKeywordsWithIntensifiers(keywords: KeywordConfig[]): string[] {
  return keywords
    .slice(0, 100)
    .map(k => k.intensifier ? `${k.term}:${k.intensifier}` : k.term);
}
