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
      // 경전
      '몰몬경': 'Book of Mormon',
      '교리와 성약': 'Doctrine and Covenants',
      '값진 진주': 'Pearl of Great Price',

      // 현대 선지자 및 지도자 (매우 중요! STT 오류 빈번)
      '조셉 스미스': 'Joseph Smith',
      '주작 스미스': 'Joseph Smith',  // 흔한 STT 오류
      '조섭 스미스': 'Joseph Smith',  // 흔한 STT 오류
      '브리검 영': 'Brigham Young',
      '러셀 엠 넬슨': 'Russell M. Nelson',
      '러셀 넬슨': 'Russell M. Nelson',
      '토마스 에스 몬슨': 'Thomas S. Monson',
      '고든 비 힝클리': 'Gordon B. Hinckley',
      '스펜서 더블유 킴볼': 'Spencer W. Kimball',
      '제프리 알 홀런드': 'Jeffrey R. Holland',
      '데일린 에이치 옥스': 'Dallin H. Oaks',
      '헨리 비 아이어링': 'Henry B. Eyring',
      '디이터 에프 우흐트도르프': 'Dieter F. Uchtdorf',

      // 경전 인물
      '니파이': 'Nephi',
      '앨마': 'Alma',
      '앰율레크': 'Amulek',
      '베냐민 왕': 'King Benjamin',
      '베냐민': 'Benjamin',
      '리하이': 'Lehi',
      '모로나이': 'Moroni',
      '이더': 'Ether',
      '힐라맨': 'Helaman',
      '노파이': 'Nephi',  // STT 오류

      // 핵심 교리
      '구주': 'Savior',
      '속죄': 'Atonement',
      '부활': 'Resurrection',
      '자비': 'mercy',
      '공의': 'justice',
      '간증': 'testimony',
      '성신': 'Holy Ghost',
      '성령': 'Holy Spirit',
      '권능': 'authority',
      '회개': 'repentance',

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

  // LDS Church 특화 프롬프트 (간소화 + 고품질 유지)
  if (preset === 'church') {
    return `You are an expert ${sourceLangName}-to-${targetLangName} interpreter for The Church of Jesus Christ of Latter-day Saints (LDS/Mormon Church).

🏛️ YOUR EXPERTISE: You deeply understand LDS doctrine, scriptures (Book of Mormon, D&C, Pearl of Great Price), prophets (Joseph Smith to Russell M. Nelson), and sacred terminology (Atonement, priesthood, temple, sacrament).

⚠️ CRITICAL: STT constantly errors LDS names/terms. Fix them aggressively using LDS context.

${Object.keys(glossary).length > 0 ? `🔑 KEY TERMS:\n${formatGlossary(glossary)}\n` : ''}

🚨 COMMON STT ERRORS - FIX INSTANTLY:
- "주작/조섭 스미스" → "Joseph Smith" (founder)
- "앨몬/엘마" → "Alma" (prophet)
- "몰멍평/몰몸경" → "Book of Mormon"
- "고주/구주" → "Savior"
- "성심" → "Holy Ghost" (NOT "heart")
- "성전" → "temple" (NOT "castle")
- ANY garbled prophet/scripture → Use LDS knowledge to fix

📖 PROCESS:
1. Read as LDS member
2. Identify STT errors using LDS context
3. Fix using glossary + doctrine
4. Translate naturally (${tone})
5. Output ONLY translation

🎯 EXAMPLES:

"선지자주작스미스" → "prophet Joseph Smith" ✅ (NOT "Zechariah" ❌)
"몰멍평의앨몬이" → "Alma in the Book of Mormon" ✅

💡 RULE: If garbled + religious → Use LDS context. Never translate literally. Fix first, then translate.

CONTEXT:
Summary: {summary}
Recent: {recentContext}

CURRENT (fix STT errors):
{currentText}

TRANSLATION:`;
  }

  // 일반 프롬프트 (다른 preset들)
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
