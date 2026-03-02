import OpenAI from 'openai';

/**
 * 번역 결과
 */
export interface TranslationResult {
  korean: string;              // 보정된 한국어
  translations: Record<string, string>;  // {en: "...", ja: "...", zh: "..."}
}

interface TranslationConfig {
  apiKey: string;
  model?: string;
  provider?: 'openai' | 'groq';
  groqApiKey?: string;
  groqModel?: string;
}

/**
 * 언어 이름 매핑
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  ar: 'Arabic',
  pt: 'Portuguese (Brazilian)',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  hi: 'Hindi',
  ur: 'Urdu',
};

/**
 * 핵심 STT 오류 보정 사전 (20개 핵심 패턴만)
 * 나머지는 LLM이 문맥 기반으로 보정
 */
const STT_CORRECTIONS: Record<string, string> = {
  // 경전 (가장 빈번)
  '몰멍평': '몰몬경',
  '몰몸경': '몰몬경',
  '몰몽경': '몰몬경',
  '몰문경': '몰몬경',
  '모몬경': '몰몬경',

  // 선지자 이름 (가장 중요)
  '주작 스미스': '조셉 스미스',
  '주작스미스': '조셉 스미스',
  '조섭 스미스': '조셉 스미스',
  '조섭스미스': '조셉 스미스',
  '죠셉 스미스': '조셉 스미스',

  // 핵심 교리 용어
  '고주': '구주',
  '구쥬': '구주',
  '석죄': '속죄',
  '속주': '속죄',
  '간정': '간증',
  '반중': '간증',
  '간중': '간증',
  '선지차': '선지자',
  '성심': '성신',
  '성차식': '성찬식',
  '성교사': '선교사',
};

/**
 * TranslationService - 단일 translate 메서드로 모든 언어를 한 번에 번역
 */
export class TranslationService {
  private openai: OpenAI;
  private groq?: OpenAI;
  private model: string;
  private provider: 'openai' | 'groq';

  constructor(config: TranslationConfig) {
    this.provider = config.provider || 'openai';

    this.openai = new OpenAI({
      apiKey: config.apiKey
    });
    this.model = config.model || 'gpt-5-nano';

    if (this.provider === 'groq' && config.groqApiKey) {
      this.groq = new OpenAI({
        apiKey: config.groqApiKey,
        baseURL: 'https://api.groq.com/openai/v1'
      });
      this.model = config.groqModel || 'llama-3.3-70b-versatile';
    }
  }

  private getClient(): OpenAI {
    return this.provider === 'groq' && this.groq ? this.groq : this.openai;
  }

  /**
   * STT 오류 보정 (사전 기반, 빠름)
   */
  private correctSttErrors(text: string): string {
    let corrected = text;
    for (const [error, correction] of Object.entries(STT_CORRECTIONS)) {
      corrected = corrected.replace(new RegExp(error, 'gi'), correction);
    }
    return corrected;
  }

  /**
   * 단일 번역 메서드 - 모든 언어를 한 번의 LLM 호출로
   *
   * @param text - 한국어 원문
   * @param targetLanguages - 번역할 언어 목록
   * @param context - 번역 문맥 (요약, 최근 문장, 이전 번역 등)
   */
  async translate(
    text: string,
    targetLanguages: string[],
    context: {
      summary?: string;
      recentKorean?: string;
      previousTranslations?: Record<string, string>;
      glossary?: Record<string, string>;
    } = {}
  ): Promise<TranslationResult | null> {
    try {
      if (!text || text.trim().length === 0) return null;

      // STT 오류 보정
      const correctedText = this.correctSttErrors(text);

      // 한국어만 요청된 경우
      if (targetLanguages.length === 0) {
        return { korean: correctedText, translations: {} };
      }

      const langList = targetLanguages
        .map(code => `${code} (${LANGUAGE_NAMES[code] || code})`)
        .join(', ');

      const langKeys = targetLanguages.map(code => `"${code}"`).join(', ');

      // 시스템 프롬프트 (세션 시작 시 1회 전송 개념이지만, stateless이므로 매번)
      const systemPrompt = this.buildSystemPrompt(langKeys, langList, context.glossary);

      // 유저 프롬프트
      const userPrompt = this.buildUserPrompt(correctedText, context);

      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1200,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        console.error('[TranslationService] Empty response');
        return null;
      }

      // JSON 파싱
      const translations = this.parseTranslations(content, targetLanguages);

      // 우르두어 후처리
      if (translations['ur']) {
        translations['ur'] = this.convertHindiToUrdu(translations['ur']);
      }

      return {
        korean: correctedText,
        translations,
      };

    } catch (error) {
      console.error('[TranslationService] Translation error:', error);
      return null;
    }
  }

  /**
   * 시스템 프롬프트 구축
   */
  private buildSystemPrompt(
    langKeys: string,
    langList: string,
    glossary?: Record<string, string>
  ): string {
    let prompt = `You are a real-time LDS sermon translator. Translate Korean speech to multiple languages simultaneously.

OUTPUT FORMAT: JSON object with keys: ${langKeys}
Example: {${langKeys.split(', ').map(k => `${k}: "translated text"`).join(', ')}}

RULES:
- Fix STT recognition errors using context (garbled religious terms → correct terms)
- Maintain formal, reverent tone appropriate for religious discourse
- Output ONLY the JSON object, no explanations
- Each value must be PURELY in the target language (no mixing)
- Preserve meaning, not word-for-word translation
- Use proper religious terminology for each language`;

    // 용어집
    if (glossary && Object.keys(glossary).length > 0) {
      const terms = Object.entries(glossary).slice(0, 20)
        .map(([ko, en]) => `${ko} = ${en}`)
        .join('\n');
      prompt += `\n\nKEY TERMINOLOGY:\n${terms}`;
    } else {
      // 기본 LDS 용어
      prompt += `\n\nKEY LDS TERMINOLOGY:
몰몬경 = Book of Mormon
조셉 스미스 = Joseph Smith
구주 = Savior
속죄 = Atonement
간증 = testimony
성신 = Holy Ghost
성전 = temple
와드 = ward
스테이크 = stake
제일회장단 = First Presidency
선지자 = prophet
침례 = baptism
신권 = priesthood
앨마 = Alma
니파이 = Nephi
모로나이 = Moroni`;
    }

    return prompt;
  }

  /**
   * 유저 프롬프트 구축
   */
  private buildUserPrompt(
    text: string,
    context: {
      summary?: string;
      recentKorean?: string;
      previousTranslations?: Record<string, string>;
    }
  ): string {
    const parts: string[] = [];

    if (context.summary) {
      parts.push(`Summary: ${context.summary}`);
    }

    if (context.recentKorean) {
      parts.push(`Recent Korean: ${context.recentKorean}`);
    }

    if (context.previousTranslations && Object.keys(context.previousTranslations).length > 0) {
      const prevParts = Object.entries(context.previousTranslations)
        .map(([lang, text]) => `${lang}: ${text}`)
        .join('\n');
      parts.push(`Previous translations:\n${prevParts}`);
    }

    parts.push(`Translate: "${text}"`);

    return parts.join('\n\n');
  }

  /**
   * JSON 응답 파싱
   */
  private parseTranslations(content: string, targetLanguages: string[]): Record<string, string> {
    const translations: Record<string, string> = {};

    try {
      // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // { 로 시작하는 부분 찾기
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd !== -1) {
        jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);

      for (const lang of targetLanguages) {
        if (parsed[lang] && typeof parsed[lang] === 'string') {
          translations[lang] = parsed[lang].trim();
        }
      }
    } catch (e) {
      // JSON 파싱 실패 시 단일 언어 fallback
      console.warn('[TranslationService] JSON parse failed, attempting fallback:', e);

      if (targetLanguages.length === 1) {
        // 단일 언어면 전체 텍스트를 번역으로 사용
        const cleaned = content.replace(/^[^a-zA-Z\u3000-\u9FFF\u0600-\u06FF\uAC00-\uD7AF]*/g, '').trim();
        if (cleaned) {
          translations[targetLanguages[0]] = cleaned;
        }
      }
    }

    return translations;
  }

  /**
   * 요약 생성 (Tier 2: 증분 요약)
   */
  async generateSummary(recentText: string, previousSummary: string = ''): Promise<string | null> {
    try {
      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation in Korean. Keep under 80 words, focus on main topics, Bible verses, key points.
${previousSummary ? `Previous: ${previousSummary}\n` : ''}
Recent:
${recentText}

Summary (Korean, <80 words):`
          }
        ],
        max_completion_tokens: 300,
        temperature: 0.5
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('[TranslationService] Summary generation error:', error);
      return null;
    }
  }

  /**
   * 우르두어 변환 (힌디어 문자 → 우르두어)
   */
  private convertHindiToUrdu(text: string): string {
    const hindiToUrduMap: Record<string, string> = {
      'अ': 'ا', 'आ': 'آ', 'इ': 'ا', 'ई': 'ای', 'उ': 'ا', 'ऊ': 'او',
      'ए': 'ے', 'ऐ': 'ای', 'ओ': 'او', 'औ': 'او',
      'क': 'ک', 'ख': 'کھ', 'ग': 'گ', 'घ': 'گھ',
      'च': 'چ', 'छ': 'چھ', 'ज': 'ج', 'झ': 'جھ',
      'ट': 'ٹ', 'ठ': 'ٹھ', 'ड': 'ڈ', 'ढ': 'ڈھ',
      'त': 'ت', 'थ': 'تھ', 'द': 'د', 'ध': 'دھ',
      'न': 'ن', 'प': 'پ', 'फ': 'پھ', 'ब': 'ب', 'भ': 'بھ',
      'म': 'م', 'य': 'ی', 'र': 'ر', 'ल': 'ل', 'व': 'و',
      'श': 'ش', 'ष': 'ش', 'स': 'س', 'ह': 'ہ',
      'ं': 'ں', 'ा': 'ا', 'ि': '', 'ी': 'ی',
      'ु': '', 'ू': 'و', 'े': 'ے', 'ै': 'ای',
      'ो': 'و', 'ौ': 'او', '्': '',
      '।': '۔', '॥': '۔',
    };

    // 힌디어 문자가 있는지 확인
    if (!/[\u0900-\u097F]/.test(text)) return text;

    let result = text;
    for (const [hindi, urdu] of Object.entries(hindiToUrduMap)) {
      result = result.replace(new RegExp(hindi, 'g'), urdu);
    }
    return result;
  }
}
