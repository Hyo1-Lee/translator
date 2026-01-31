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
    environment: 'This is a sermon or religious talk from The Church of Jesus Christ of Latter-day Saints (LDS/Mormon Church). Maintain religious context and translate incomplete sentences naturally based on context.',
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
      '증거하다': 'testify',
      '성신': 'Holy Ghost',
      '성령': 'Holy Spirit',
      '권능': 'authority',
      '회개': 'repentance',
      '복음': 'gospel',

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
      '지방부': 'stake',
      '장로': 'elder',
      '자매': 'sister',
      '형제': 'brother',
      '선교부': 'mission',

      // 의식 및 모임
      '성전': 'temple',
      '성찬': 'sacrament',
      '성찬식': 'sacrament meeting',
      '침례': 'baptism',
      '확인': 'confirmation',
      '신권': 'priesthood',
      '멜기세덱': 'Melchizedek',
      '아론': 'Aaronic',
      '간증회': 'testimony meeting',
    },
    tone: 'formal and reverent, maintaining LDS-specific expressions and religious context',
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
 * 언어 코드 → 언어 이름 (영어)
 */
function getLanguageName(code: string): string {
  const languageNames: Record<string, string> = {
    ko: 'Korean',
    en: 'English',
    ja: 'Japanese',
    zh: 'Simplified Chinese',
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
    ur: 'Urdu',
  };

  return languageNames[code] || code;
}

/**
 * 언어 코드 → 네이티브 이름 (해당 언어로)
 */
function getNativeLanguageName(code: string): string {
  const nativeNames: Record<string, string> = {
    ko: '한국어',
    en: 'English',
    ja: '日本語',
    zh: '简体中文',
    'zh-TW': '繁體中文',
    es: 'español',
    fr: 'français',
    de: 'Deutsch',
    ru: 'русский',
    ar: 'العربية',
    pt: 'português',
    vi: 'tiếng Việt',
    th: 'ภาษาไทย',
    id: 'bahasa Indonesia',
    hi: 'हिन्दी',
    ur: 'اردو',
  };

  return nativeNames[code] || code;
}

/**
 * 언어별 종교 용어 매핑 (LDS 교회)
 * 주요 종교 용어의 각 언어별 공식/적절한 번역
 */
const LDS_TERMS_BY_LANGUAGE: Record<string, Record<string, string>> = {
  en: {
    'Savior': 'Savior',
    'Atonement': 'Atonement',
    'prophet': 'prophet',
    'apostle': 'apostle',
    'testimony': 'testimony',
    'Holy Ghost': 'Holy Ghost',
    'temple': 'temple',
    'priesthood': 'priesthood',
    'repentance': 'repentance',
    'authority': 'authority',
    'sinner': 'sinner',
    'gospel': 'gospel',
    'chapter': 'chapter',
    'verse': 'verse',
  },
  ja: {
    'Savior': '救い主',
    'Atonement': '贖い',
    'prophet': '預言者',
    'apostle': '使徒',
    'testimony': '証',
    'Holy Ghost': '聖霊',
    'temple': '神殿',
    'priesthood': '神権',
    'repentance': '悔い改め',
    'authority': '権能',
    'sinner': '罪人',
    'gospel': '福音',
    'chapter': '章',
    'verse': '節',
  },
  zh: {
    'Savior': '救主',
    'Atonement': '赎罪',
    'prophet': '先知',
    'apostle': '使徒',
    'testimony': '见证',
    'Holy Ghost': '圣灵',
    'temple': '圣殿',
    'priesthood': '圣职',
    'repentance': '悔改',
    'authority': '权柄',
    'sinner': '罪人',
    'gospel': '福音',
    'chapter': '章',
    'verse': '节',
  },
  'zh-TW': {
    'Savior': '救主',
    'Atonement': '贖罪',
    'prophet': '先知',
    'apostle': '使徒',
    'testimony': '見證',
    'Holy Ghost': '聖靈',
    'temple': '聖殿',
    'priesthood': '聖職',
    'repentance': '悔改',
    'authority': '權柄',
    'sinner': '罪人',
    'gospel': '福音',
    'chapter': '章',
    'verse': '節',
  },
  es: {
    'Savior': 'Salvador',
    'Atonement': 'Expiación',
    'prophet': 'profeta',
    'apostle': 'apóstol',
    'testimony': 'testimonio',
    'Holy Ghost': 'Espíritu Santo',
    'temple': 'templo',
    'priesthood': 'sacerdocio',
    'repentance': 'arrepentimiento',
    'authority': 'autoridad',
    'sinner': 'pecador',
    'gospel': 'evangelio',
    'chapter': 'capítulo',
    'verse': 'versículo',
  },
  fr: {
    'Savior': 'Sauveur',
    'Atonement': 'Expiation',
    'prophet': 'prophète',
    'apostle': 'apôtre',
    'testimony': 'témoignage',
    'Holy Ghost': 'Saint-Esprit',
    'temple': 'temple',
    'priesthood': 'prêtrise',
    'repentance': 'repentir',
    'authority': 'autorité',
    'sinner': 'pécheur',
    'gospel': 'Évangile',
    'chapter': 'chapitre',
    'verse': 'verset',
  },
  de: {
    'Savior': 'Erretter',
    'Atonement': 'Sühnopfer',
    'prophet': 'Prophet',
    'apostle': 'Apostel',
    'testimony': 'Zeugnis',
    'Holy Ghost': 'Heiliger Geist',
    'temple': 'Tempel',
    'priesthood': 'Priestertum',
    'repentance': 'Umkehr',
    'authority': 'Vollmacht',
    'sinner': 'Sünder',
    'gospel': 'Evangelium',
    'chapter': 'Kapitel',
    'verse': 'Vers',
  },
  ru: {
    'Savior': 'Спаситель',
    'Atonement': 'Искупление',
    'prophet': 'пророк',
    'apostle': 'Апостол',
    'testimony': 'свидетельство',
    'Holy Ghost': 'Святой Дух',
    'temple': 'храм',
    'priesthood': 'священство',
    'repentance': 'покаяние',
    'authority': 'власть',
    'sinner': 'грешник',
    'gospel': 'Евангелие',
    'chapter': 'глава',
    'verse': 'стих',
  },
  ar: {
    'Savior': 'المُخَلِّص',
    'Atonement': 'الكفارة',
    'prophet': 'نبي',
    'apostle': 'رسول',
    'testimony': 'شهادة',
    'Holy Ghost': 'الروح القدس',
    'temple': 'الهيكل',
    'priesthood': 'الكهنوت',
    'repentance': 'التوبة',
    'authority': 'السلطة',
    'sinner': 'خاطئ',
    'gospel': 'الإنجيل',
    'chapter': 'الفصل',
    'verse': 'الآية',
  },
  pt: {
    'Savior': 'Salvador',
    'Atonement': 'Expiação',
    'prophet': 'profeta',
    'apostle': 'apóstolo',
    'testimony': 'testemunho',
    'Holy Ghost': 'Espírito Santo',
    'temple': 'templo',
    'priesthood': 'sacerdócio',
    'repentance': 'arrependimento',
    'authority': 'autoridade',
    'sinner': 'pecador',
    'gospel': 'evangelho',
    'chapter': 'capítulo',
    'verse': 'versículo',
  },
  vi: {
    'Savior': 'Đấng Cứu Rỗi',
    'Atonement': 'Sự Chuộc Tội',
    'prophet': 'tiên tri',
    'apostle': 'sứ đồ',
    'testimony': 'chứng ngôn',
    'Holy Ghost': 'Đức Thánh Linh',
    'temple': 'đền thờ',
    'priesthood': 'chức tư tế',
    'repentance': 'sự hối cải',
    'authority': 'thẩm quyền',
    'sinner': 'tội nhân',
    'gospel': 'phúc âm',
    'chapter': 'chương',
    'verse': 'câu',
  },
  th: {
    'Savior': 'พระผู้ช่วยให้รอด',
    'Atonement': 'การชดใช้',
    'prophet': 'ศาสดาพยากรณ์',
    'apostle': 'อัครสาวก',
    'testimony': 'ประจักษ์พยาน',
    'Holy Ghost': 'พระวิญญาณบริสุทธิ์',
    'temple': 'พระวิหาร',
    'priesthood': 'ฐานะปุโรหิต',
    'repentance': 'การกลับใจ',
    'authority': 'สิทธิอำนาจ',
    'sinner': 'คนบาป',
    'gospel': 'พระกิตติคุณ',
    'chapter': 'บท',
    'verse': 'ข้อ',
  },
  id: {
    'Savior': 'Juruselamat',
    'Atonement': 'Penebusan',
    'prophet': 'nabi',
    'apostle': 'rasul',
    'testimony': 'kesaksian',
    'Holy Ghost': 'Roh Kudus',
    'temple': 'bait suci',
    'priesthood': 'imamat',
    'repentance': 'pertobatan',
    'authority': 'wewenang',
    'sinner': 'pendosa',
    'gospel': 'Injil',
    'chapter': 'pasal',
    'verse': 'ayat',
  },
  hi: {
    'Savior': 'उद्धारकर्ता',
    'Atonement': 'प्रायश्चित',
    'prophet': 'भविष्यवक्ता',
    'apostle': 'प्रेरित',
    'testimony': 'गवाही',
    'Holy Ghost': 'पवित्र आत्मा',
    'temple': 'मंदिर',
    'priesthood': 'याजकपद',
    'repentance': 'पश्चाताप',
    'authority': 'अधिकार',
    'sinner': 'पापी',
    'gospel': 'सुसमाचार',
    'chapter': 'अध्याय',
    'verse': 'पद',
  },
  ur: {
    'Savior': 'نجات دہندہ',
    'Atonement': 'کفارہ',
    'prophet': 'نبی',
    'apostle': 'رسول',
    'testimony': 'گواہی',
    'Holy Ghost': 'روح القدس',
    'temple': 'ہیکل',
    'priesthood': 'کہانت',
    'repentance': 'توبہ',
    'authority': 'اختیار',
    'sinner': 'گناہگار',
    'gospel': 'انجیل',
    'chapter': 'باب',
    'verse': 'آیت',
  },
};

/**
 * 해당 언어의 종교 용어 매핑 생성
 */
function getReligiousTermsForLanguage(targetLang: string): string {
  const terms = LDS_TERMS_BY_LANGUAGE[targetLang];
  if (!terms) return '';

  return Object.entries(terms)
    .map(([en, local]) => `${en}=${local}`)
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
  const nativeTargetName = getNativeLanguageName(targetLanguage);

  // LDS Church 특화 프롬프트
  if (preset === 'church') {
    const religiousTerms = getReligiousTermsForLanguage(targetLanguage);

    return `You are an expert translator for The Church of Jesus Christ of Latter-day Saints.
Translate ${sourceLangName} to ${targetLangName} (${nativeTargetName}).

CONTEXT: LDS sermon/religious talk (sacrament meeting, testimony meeting, etc.)

${Object.keys(glossary).length > 0 ? `KOREAN→ENGLISH TERMS:\n${formatGlossary(glossary)}\n` : ''}
${religiousTerms ? `ENGLISH→${targetLangName.toUpperCase()} TERMS:\n${religiousTerms}\n` : ''}
STT ERRORS TO FIX: 주작스미스→Joseph Smith, 몰멍평→Book of Mormon, 고주/구주→Savior, 성심/성차→성찬, 간정→간증

RULES:
1. Output ONLY in ${nativeTargetName} - NO Korean, English, or other languages mixed in
2. Translate ALL words including names (Jesus=appropriate translation in ${targetLangName})
3. Use religious terms from the mapping above
4. Fix obvious STT errors, translate literally if uncertain
5. NO notes, explanations, or parenthetical comments
6. Maintain sentence flow - don't artificially end incomplete sentences
7. IMPORTANT: Even if the input is incomplete, translate naturally based on context
8. Maintain the reverent, formal tone of LDS religious discourse

CONTEXT FOR CONTINUITY:
Summary: {summary}
Recent Korean: {recentContext}
Previous translation: {previousTranslation}

TRANSLATE TO ${targetLangName.toUpperCase()}:
{currentText}

OUTPUT (${nativeTargetName} only):`;
  }

  // 일반 프롬프트
  return `Translate ${sourceLangName} to ${targetLangName} (${nativeTargetName}).

CONTEXT: ${environment}

${Object.keys(glossary).length > 0 ? `KEY TERMS: ${formatGlossary(glossary)}\n` : ''}
RULES:
1. Output ONLY in ${nativeTargetName} - NO source language or other languages
2. Translate ALL words completely
3. Fix obvious STT errors, translate literally if uncertain
4. Maintain ${tone} tone
5. NO notes or explanations
6. Preserve sentence flow

CONTEXT:
Summary: {summary}
Recent: {recentContext}
Previous: {previousTranslation}

TRANSLATE:
{currentText}

OUTPUT (${nativeTargetName} only):`;
}

/**
 * Few-shot 예제 (언어별)
 * 품질 향상의 핵심 - LLM이 정확한 번역 패턴을 학습
 */
export const FEW_SHOT_EXAMPLES: Record<string, Array<{ korean: string; translation: string }>> = {
  en: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'The Savior said in Alma chapter 9 that sinners can also be saved through mercy.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'The prophet Joseph Smith testified by the power of the Holy Ghost.' },
  ],
  ja: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: '救い主はアルマ書第9章で、罪人も憐れみによって救われると言われました。' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: '預言者ジョセフ・スミスは聖霊の力によって証しました。' },
  ],
  zh: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: '救主在阿尔玛书第9章说，罪人也可以通过慈悲得救。' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: '先知约瑟·斯密以圣灵的能力作见证。' },
  ],
  'zh-TW': [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: '救主在阿爾瑪書第9章說，罪人也可以通過慈悲得救。' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: '先知約瑟·斯密以聖靈的能力作見證。' },
  ],
  ur: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'نجات دہندہ نے المہ باب 9 میں فرمایا کہ گناہگار بھی رحم سے بچائے جا سکتے ہیں۔' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'نبی جوزف سمتھ نے روح القدس کی طاقت سے گواہی دی۔' },
  ],
  ar: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'قال المُخَلِّص في ألما الفصل 9 أن الخاطئين يمكن أن يخلصوا أيضًا بالرحمة.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'شهد النبي جوزيف سميث بقوة الروح القدس.' },
  ],
  hi: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'उद्धारकर्ता ने अलमा अध्याय 9 में कहा कि पापी भी दया से बचाए जा सकते हैं।' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'भविष्यवक्ता जोसेफ स्मिथ ने पवित्र आत्मा की शक्ति से गवाही दी।' },
  ],
  es: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'El Salvador dijo en Alma capítulo 9 que los pecadores también pueden ser salvados por la misericordia.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'El profeta José Smith testificó por el poder del Espíritu Santo.' },
  ],
  fr: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'Le Sauveur a dit dans Alma chapitre 9 que les pécheurs peuvent aussi être sauvés par la miséricorde.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'Le prophète Joseph Smith a témoigné par le pouvoir du Saint-Esprit.' },
  ],
  de: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'Der Erretter sagte in Alma Kapitel 9, dass Sünder auch durch Barmherzigkeit gerettet werden können.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'Der Prophet Joseph Smith gab durch die Macht des Heiligen Geistes Zeugnis.' },
  ],
  ru: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'Спаситель сказал в Алме глава 9, что грешники тоже могут быть спасены через милость.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'Пророк Джозеф Смит свидетельствовал силой Святого Духа.' },
  ],
  pt: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'O Salvador disse em Alma capítulo 9 que os pecadores também podem ser salvos pela misericórdia.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'O profeta Joseph Smith testificou pelo poder do Espírito Santo.' },
  ],
  vi: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'Đấng Cứu Rỗi đã nói trong An Ma chương 9 rằng tội nhân cũng có thể được cứu bởi lòng thương xót.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'Tiên tri Joseph Smith đã làm chứng bởi quyền năng của Đức Thánh Linh.' },
  ],
  th: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'พระผู้ช่วยให้รอดตรัสในแอลมาบท 9 ว่าคนบาปก็สามารถได้รับการช่วยให้รอดโดยความเมตตา' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'ศาสดาพยากรณ์โจเซฟ สมิธเป็นพยานโดยอำนาจของพระวิญญาณบริสุทธิ์' },
  ],
  id: [
    { korean: '구주께서는 앨마서 9장에서 죄인들도 자비로 구원받을 수 있다고 말씀하셨습니다.', translation: 'Juruselamat berkata dalam Alma pasal 9 bahwa orang berdosa juga dapat diselamatkan melalui belas kasihan.' },
    { korean: '선지자 조셉 스미스는 성신의 권능으로 간증했습니다.', translation: 'Nabi Joseph Smith bersaksi dengan kuasa Roh Kudus.' },
  ],
};

/**
 * 시스템 프롬프트 (역할 정의)
 * user 메시지와 분리하여 더 나은 성능
 */
export function buildSystemPrompt(
  targetLanguage: string,
  preset: EnvironmentPreset
): string {
  const targetLangName = getLanguageName(targetLanguage);
  const nativeTargetName = getNativeLanguageName(targetLanguage);
  const religiousTerms = getReligiousTermsForLanguage(targetLanguage);

  if (preset === 'church') {
    return `You are an expert translator for The Church of Jesus Christ of Latter-day Saints.
Your task: Translate Korean to ${targetLangName} (${nativeTargetName}).

ABSOLUTE RULES:
1. Output ONLY in ${nativeTargetName} - ZERO tolerance for Korean/English/other languages
2. Translate EVERY word including proper names
3. Use these religious terms: ${religiousTerms}
4. Fix STT errors (주작스미스→Joseph Smith, 몰멍평→Book of Mormon, 고주→Savior, 성차→성찬, 간정→간증)
5. NO explanations, notes, or parenthetical comments
6. Output the translation directly, nothing else
7. Even for incomplete sentences, translate naturally based on religious context
8. Maintain the reverent, formal tone of LDS discourse`;
  }

  return `You are a professional translator.
Your task: Translate Korean to ${targetLangName} (${nativeTargetName}).

RULES:
1. Output ONLY in ${nativeTargetName} - no source language
2. Translate ALL words completely
3. NO notes or explanations
4. Output the translation directly`;
}

/**
 * 사용자 프롬프트 (번역할 내용)
 */
export function buildUserPrompt(
  currentText: string,
  targetLanguage: string,
  summary?: string,
  recentContext?: string,
  previousTranslation?: string
): string {
  const examples = FEW_SHOT_EXAMPLES[targetLanguage] || FEW_SHOT_EXAMPLES['en'];
  const nativeTargetName = getNativeLanguageName(targetLanguage);

  let prompt = '';

  // Few-shot 예제 추가
  if (examples && examples.length > 0) {
    prompt += `EXAMPLES:\n`;
    examples.forEach((ex, i) => {
      prompt += `Korean: ${ex.korean}\n${nativeTargetName}: ${ex.translation}\n\n`;
    });
  }

  // 컨텍스트 (있을 경우에만)
  if (summary || recentContext || previousTranslation) {
    prompt += `CONTEXT:\n`;
    if (summary) prompt += `Topic: ${summary}\n`;
    if (previousTranslation) prompt += `Previous: ${previousTranslation}\n`;
    prompt += `\n`;
  }

  // 번역할 텍스트
  prompt += `NOW TRANSLATE THIS:\nKorean: ${currentText}\n${nativeTargetName}:`;

  return prompt;
}

/**
 * 힌디어→우르두어 문자 변환 맵
 * 힌디어와 우르두어는 동일 언어의 다른 문자 체계 (데바나가리 vs 아랍 문자)
 */
const HINDI_TO_URDU_MAP: Record<string, string> = {
  // 종교 용어
  'सचाई': 'سچائی',         // 진리
  'सच्चाई': 'سچائی',       // 진리 (변형)
  'भगवान': 'خدا',          // 신
  'प्रभु': 'خداوند',        // 주님
  'ईश्वर': 'خدا',          // 신 (변형)
  'प्रार्थना': 'دعا',       // 기도
  'आशीर्वाद': 'برکت',      // 축복
  'पाप': 'گناہ',           // 죄
  'पापी': 'گناہگار',        // 죄인
  'क्षमा': 'معافی',         // 용서
  'दया': 'رحم',            // 자비
  'विश्वास': 'ایمان',       // 믿음
  'आत्मा': 'روح',          // 영혼
  'स्वर्ग': 'جنت',         // 천국
  'नरक': 'جہنم',           // 지옥
  'पवित्र': 'مقدس',        // 성스러운
  'शांति': 'امن',          // 평화
  'प्रेम': 'محبت',          // 사랑
  'सेवा': 'خدمت',          // 봉사
  'धर्म': 'مذہب',          // 종교
  // LDS 특화 용어
  'उद्धारकर्ता': 'نجات دہندہ',  // 구주
  'प्रायश्चित': 'کفارہ',       // 속죄
  'भविष्यवक्ता': 'نبی',        // 선지자
  'प्रेरित': 'رسول',           // 사도
  'गवाही': 'گواہی',            // 간증
  'पवित्र आत्मा': 'روح القدس', // 성신
  'मंदिर': 'ہیکل',             // 성전
  'याजकपद': 'کہانت',          // 신권
  'पश्चाताप': 'توبہ',          // 회개
  'अधिकार': 'اختیار',          // 권능
  'सुसमाचार': 'انجیل',         // 복음
  'अध्याय': 'باب',             // 장
  'पद': 'آیت',                 // 절
};

/**
 * 힌디어 문자를 우르두어 문자로 변환
 * @param text 힌디어가 포함된 텍스트
 * @returns 우르두어로 변환된 텍스트
 */
export function convertHindiToUrdu(text: string): string {
  let result = text;
  for (const [hindi, urdu] of Object.entries(HINDI_TO_URDU_MAP)) {
    result = result.replace(new RegExp(hindi, 'g'), urdu);
  }
  return result;
}

/**
 * 혼합 언어 감지 (후처리용)
 * 한국어/일본어/중국어 문자가 부적절하게 남아있는지 확인
 */
export function detectMixedLanguage(
  text: string,
  targetLanguage: string
): { hasMixedLanguage: boolean; detectedPatterns: string[] } {
  const detectedPatterns: string[] = [];

  // 한글 감지 (모든 비한국어 타겟에서)
  if (targetLanguage !== 'ko') {
    const koreanPattern = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g;
    const koreanMatches = text.match(koreanPattern);
    if (koreanMatches && koreanMatches.length > 0) {
      detectedPatterns.push(`Korean: ${koreanMatches.slice(0, 5).join('')}`);
    }
  }

  // 영어 단어 감지 (비라틴 문자 타겟에서)
  const nonLatinTargets = ['ja', 'zh', 'zh-TW', 'ar', 'hi', 'ur', 'th', 'ru'];
  if (nonLatinTargets.includes(targetLanguage)) {
    // 일반 영어 단어 (종교 고유명사 제외)
    const englishPattern = /\b(?!(?:Joseph|Smith|Alma|Nephi|Moroni|Jesus|Christ|LDS|Mormon)\b)[A-Za-z]{4,}\b/g;
    const englishMatches = text.match(englishPattern);
    if (englishMatches && englishMatches.length > 0) {
      detectedPatterns.push(`English: ${englishMatches.slice(0, 3).join(', ')}`);
    }
  }

  // 일본어/중국어 문자 감지 (해당 언어가 아닌 경우)
  if (!['ja', 'zh', 'zh-TW'].includes(targetLanguage)) {
    // 히라가나/가타카나 (일본어 전용)
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF]/g;
    const japaneseMatches = text.match(japanesePattern);
    if (japaneseMatches && japaneseMatches.length > 2) {
      detectedPatterns.push(`Japanese: ${japaneseMatches.slice(0, 5).join('')}`);
    }
  }

  // 데바나가리 문자 감지 (우르두어 타겟에서 - 힌디어 문자가 잘못 포함된 경우)
  if (targetLanguage === 'ur') {
    const devanagariPattern = /[\u0900-\u097F]/g;
    const devanagariMatches = text.match(devanagariPattern);
    if (devanagariMatches && devanagariMatches.length > 0) {
      detectedPatterns.push(`Hindi: ${devanagariMatches.slice(0, 5).join('')}`);
    }
  }

  // 아랍 문자 감지 (힌디어 타겟에서 - 우르두어/아랍 문자가 잘못 포함된 경우)
  if (targetLanguage === 'hi') {
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F]/g;
    const arabicMatches = text.match(arabicPattern);
    if (arabicMatches && arabicMatches.length > 0) {
      detectedPatterns.push(`Arabic/Urdu: ${arabicMatches.slice(0, 5).join('')}`);
    }
  }

  return {
    hasMixedLanguage: detectedPatterns.length > 0,
    detectedPatterns
  };
}
