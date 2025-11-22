/**
 * Translation Environment Presets
 *
 * 도메인별 번역 환경 프리셋 정의
 * - 환경 설명 (environment): GPT에게 컨텍스트 제공
 * - 용어집 (glossary): 도메인 특화 전문 용어
 * - 톤 (tone): 번역 스타일 지정
 */

export type EnvironmentPreset = 'church' | 'medical' | 'legal' | 'business' | 'general' | 'custom';

export interface PresetConfig {
  name: string;
  environment: string;
  glossary: Record<string, string>;
  tone: string;
  description: string;
}

/**
 * 프리셋 정의
 */
export const PRESETS: Record<Exclude<EnvironmentPreset, 'custom'>, PresetConfig> = {
  /**
   * LDS Church (예수 그리스도 후기성도 교회)
   * - MVP 테스트 대상
   * - 종교 용어 특화
   */
  church: {
    name: 'LDS Church',
    environment: 'This is a sermon or religious talk from The Church of Jesus Christ of Latter-day Saints (LDS/Mormon Church)',
    glossary: {
      // 경전 및 인물
      '몰몬경': 'Book of Mormon',
      '니파이': 'Nephi',
      '앨마': 'Alma',
      '앰율레크': 'Amulek',
      '베냐민': 'Benjamin',
      '리하이': 'Lehi',
      '모로나이': 'Moroni',
      '이더': 'Ether',

      // 핵심 교리
      '구주': 'Savior',
      '속죄': 'Atonement',
      '부활': 'Resurrection',
      '자비': 'mercy',
      '공의': 'justice',
      '간증': 'testimony',
      '성신': 'Holy Ghost',
      '성령': 'Holy Spirit',

      // 조직 및 직책
      '제일회장단': 'First Presidency',
      '십이사도': 'Quorum of the Twelve Apostles',
      '선지자': 'prophet',
      '사도': 'apostle',
      '감독': 'bishop',
      '스테이크 회장': 'stake president',
      '와드': 'ward',
      '스테이크': 'stake',
      '지부': 'branch',

      // 의식 및 모임
      '성전': 'temple',
      '성찬': 'sacrament',
      '침례': 'baptism',
      '확인': 'confirmation',
      '신권': 'priesthood',
      '멜기세덱': 'Melchizedek',
      '아론': 'Aaronic',
    },
    tone: 'formal and reverent',
    description: '예수 그리스도 후기성도 교회 설교 및 종교 강연'
  },

  /**
   * Medical (의료)
   * - 의료 컨퍼런스, 임상 논의
   */
  medical: {
    name: 'Medical',
    environment: 'This is a medical conference, clinical discussion, or healthcare presentation',
    glossary: {
      '진단': 'diagnosis',
      '치료': 'treatment',
      '환자': 'patient',
      '증상': 'symptoms',
      '처방': 'prescription',
      '수술': 'surgery',
      '검사': 'examination',
      '질병': 'disease',
      '감염': 'infection',
      '합병증': 'complication',
      '예후': 'prognosis',
      '투약': 'medication',
      '부작용': 'side effect',
      '임상': 'clinical',
      '병리': 'pathology',
    },
    tone: 'professional and precise',
    description: '의료 컨퍼런스 및 임상 논의'
  },

  /**
   * Legal (법률)
   * - 법정 심리, 법률 상담
   */
  legal: {
    name: 'Legal',
    environment: 'This is a legal proceeding, court hearing, or legal consultation',
    glossary: {
      '피고인': 'defendant',
      '원고': 'plaintiff',
      '판사': 'judge',
      '검사': 'prosecutor',
      '변호사': 'attorney',
      '증거': 'evidence',
      '증인': 'witness',
      '판결': 'verdict',
      '선고': 'sentence',
      '항소': 'appeal',
      '소송': 'lawsuit',
      '계약': 'contract',
      '법률': 'law',
      '조항': 'clause',
      '합의': 'settlement',
    },
    tone: 'formal and precise',
    description: '법정 심리 및 법률 절차'
  },

  /**
   * Business (비즈니스)
   * - 회의, 프레젠테이션
   */
  business: {
    name: 'Business',
    environment: 'This is a business meeting, corporate presentation, or professional discussion',
    glossary: {
      '매출': 'revenue',
      '이익': 'profit',
      '손실': 'loss',
      '전략': 'strategy',
      '시장': 'market',
      '경쟁사': 'competitor',
      '고객': 'customer',
      '투자': 'investment',
      '주주': 'shareholder',
      '분기': 'quarter',
      '성장률': 'growth rate',
      '점유율': 'market share',
      '브랜드': 'brand',
      '마케팅': 'marketing',
      '영업': 'sales',
    },
    tone: 'professional and concise',
    description: '비즈니스 회의 및 기업 프레젠테이션'
  },

  /**
   * General (일반)
   * - 범용 번역
   */
  general: {
    name: 'General',
    environment: 'This is a general conversation or presentation',
    glossary: {},
    tone: 'natural and conversational',
    description: '일반 대화 및 프레젠테이션'
  },
};

/**
 * 프리셋 목록 조회
 */
export function getPresetList(): Array<{ value: EnvironmentPreset; label: string; description: string }> {
  return [
    ...Object.entries(PRESETS).map(([key, config]) => ({
      value: key as EnvironmentPreset,
      label: config.name,
      description: config.description,
    })),
    {
      value: 'custom' as EnvironmentPreset,
      label: 'Custom',
      description: '사용자 정의 환경 및 용어집',
    },
  ];
}

/**
 * 프리셋 설정 조회
 */
export function getPresetConfig(preset: EnvironmentPreset): PresetConfig | null {
  if (preset === 'custom') {
    return null;
  }
  return PRESETS[preset] || PRESETS.general;
}

/**
 * 용어집 포맷팅 (프롬프트용)
 */
export function formatGlossary(glossary: Record<string, string>): string {
  if (!glossary || Object.keys(glossary).length === 0) {
    return '';
  }

  return Object.entries(glossary)
    .map(([source, target]) => `${source} = ${target}`)
    .join(', ');
}

/**
 * 동적 프롬프트 생성
 */
export function buildTranslationPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  preset: EnvironmentPreset,
  customEnvironment?: string,
  customGlossary?: Record<string, string>
): string {
  const config = preset === 'custom' ? null : getPresetConfig(preset);

  const environment = preset === 'custom'
    ? customEnvironment || 'General conversation or presentation'
    : config?.environment || 'General conversation or presentation';

  const glossary = preset === 'custom'
    ? customGlossary || {}
    : config?.glossary || {};

  const tone = preset === 'custom'
    ? 'appropriate for the context'
    : config?.tone || 'natural';

  const sourceLangName = getLanguageName(sourceLanguage);
  const targetLangName = getLanguageName(targetLanguage);

  return `You are an expert ${sourceLangName}-to-${targetLangName} interpreter.

CONTEXT: ${environment}

TASK: Translate the current segment, fixing STT errors and maintaining context.

${Object.keys(glossary).length > 0 ? `KEY TERMS:\n${formatGlossary(glossary)}\n` : ''}
RULES:
1. Fix obvious STT errors using context
2. Maintain ${tone} tone
3. Translate concisely
4. Output ONLY the translation, no explanations

CONTEXT:
Summary: {summary}
Recent: {recentContext}

CURRENT: {currentText}

OUTPUT: [translation only]`;
}

/**
 * 언어 코드 → 언어 이름
 */
function getLanguageName(code: string): string {
  const languageNames: Record<string, string> = {
    ko: 'Korean',
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese',
    'zh-TW': 'Traditional Chinese',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ru: 'Russian',
    ar: 'Arabic',
    pt: 'Portuguese',
    vi: 'Vietnamese',
    th: 'Thai',
    id: 'Indonesian',
    hi: 'Hindi',
  };

  return languageNames[code] || code;
}
