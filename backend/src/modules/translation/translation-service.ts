import OpenAI from 'openai';
import { SOURCE_LANGUAGE_NAMES, SOURCE_SCRIPT_REGEX } from '../../config/language-config';

/**
 * 번역 결과
 */
export interface TranslationResult {
  sourceText: string;                    // LLM이 보정한 소스 텍스트
  translations: Record<string, string>;  // {en: "...", ja: "...", ...}
}

/**
 * 보정 + 완성 여부 판별 결과
 */
export interface CorrectionResult {
  corrected: string;
  isComplete: boolean;
}

interface TranslationConfig {
  apiKey: string;
  model?: string;
  correctionModel?: string;
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
 * TranslationService — 2-pass architecture
 *
 * Pass 1: correctKorean (gpt-4.1-nano) — STT 오류 보정 전용
 * Pass 2: translateCorrected (gpt-4.1-mini) — 깨끗한 한국어 → 다국어 번역
 */
export class TranslationService {
  private openai: OpenAI;
  private model: string;
  private correctionModel: string;

  constructor(config: TranslationConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey
    });
    this.model = config.model || 'gpt-4.1-mini';
    this.correctionModel = config.correctionModel || 'gpt-4.1-nano';
  }

  /**
   * Pass 1: STT 보정 + 문장 완성 여부 판별 (gpt-4.1-nano)
   */
  async correctAndCheck(
    text: string,
    sourceLanguage: string,
    context: { summary?: string; recentSourceText?: string; environmentDescription?: string }
  ): Promise<CorrectionResult> {
    try {
      const langName = SOURCE_LANGUAGE_NAMES[sourceLanguage] || 'Korean';

      let systemPrompt = `You are a ${langName} speech-to-text error correction specialist.

INPUT: Raw ${langName} text from a speech recognition system, along with topic context.
OUTPUT: JSON object with exactly two fields:
- "corrected": The corrected ${langName} text
- "isComplete": true if the text ends with a grammatically complete sentence, false if it ends mid-sentence or mid-phrase

CORRECTION RULES:
1. Use [Context], [Topic summary], and [Recent speech] to resolve ambiguities. The domain is your strongest clue.
2. Fix common STT errors: misrecognized words, wrong spacing, missing/wrong punctuation.
3. Do NOT add, remove, or rephrase content. Only fix errors.`;

      // Korean-specific correction rules
      if (sourceLanguage === 'ko') {
        systemPrompt += `
4. Common Korean STT errors to watch for:
   - 구조→구주, 진액→진흙, 성욕/상욕→성역, 이기적→이 기적, 구습→구속, 창조 축→창조주 (religious context)
   - Wrong spacing: compound words split, or separate words merged
   - Missing/wrong particles
5. If the domain is religious/spiritual, prefer religious vocabulary (구주, 성역, 구속, 성전, etc.) over secular homophones.`;
      }

      systemPrompt += `\n\nOutput ONLY the JSON object, no explanation.`;

      const parts: string[] = [];
      if (context.environmentDescription) {
        parts.push(`[Context]\n${context.environmentDescription}`);
      }
      if (context.summary) {
        parts.push(`[Topic summary]\n${context.summary}`);
      }
      if (context.recentSourceText) {
        parts.push(`[Recent speech]\n${context.recentSourceText}`);
      }
      parts.push(`[Correct this STT output]\n${text}`);

      const response = await this.openai.chat.completions.create({
        model: this.correctionModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: parts.join('\n\n') }
        ],
        max_completion_tokens: 600,
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return { corrected: text, isComplete: true };

      return this.parseCorrectionResponse(content, text);
    } catch (error) {
      console.error('[TranslationService] STT correction error:', error);
      return { corrected: text, isComplete: true };
    }
  }

  /**
   * 보정 JSON 파싱 (fallback: plain text → isComplete=true)
   */
  private parseCorrectionResponse(content: string, originalText: string): CorrectionResult {
    try {
      // JSON 추출
      let jsonStr = content;
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd !== -1) {
        jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);
      return {
        corrected: (parsed.corrected || originalText).trim(),
        isComplete: parsed.isComplete !== false, // default true
      };
    } catch {
      // JSON 파싱 실패 → plain text로 취급, 완성으로 간주
      return { corrected: content || originalText, isComplete: true };
    }
  }

  /**
   * Pass 2: 보정된 소스 텍스트 → 다국어 번역 (gpt-4.1-mini)
   */
  async translateText(
    correctedSourceText: string,
    targetLanguages: string[],
    sourceLanguage: string,
    context: {
      summary?: string;
      recentTranslationHistory?: Record<string, string>[];
      glossary?: Record<string, string>;
      environmentDescription?: string;
    }
  ): Promise<Record<string, string>> {
    try {
      const langList = targetLanguages
        .map(code => `${code} (${LANGUAGE_NAMES[code] || code})`)
        .join(', ');

      const langKeys = targetLanguages.map(code => `"${code}"`).join(', ');

      const systemPrompt = this.buildTranslationSystemPrompt(langKeys, langList, sourceLanguage, context.glossary, context.environmentDescription);
      const userPrompt = this.buildTranslationUserPrompt(correctedSourceText, sourceLanguage, context);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 2000,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        console.error('[TranslationService] Empty translation response');
        return {};
      }

      return this.parseTranslationResponse(content, targetLanguages, sourceLanguage);
    } catch (error) {
      console.error('[TranslationService] Translation error:', error);
      return {};
    }
  }

  /**
   * 번역 — 2-pass: STT 보정 → 번역
   */
  async translate(
    text: string,
    targetLanguages: string[],
    sourceLanguage: string = 'ko',
    context: {
      summary?: string;
      recentSourceText?: string;
      recentTranslationHistory?: Record<string, string>[];
      glossary?: Record<string, string>;
    } = {}
  ): Promise<TranslationResult | null> {
    try {
      if (!text || text.trim().length === 0) return null;

      if (targetLanguages.length === 0) {
        return { sourceText: text, translations: {} };
      }

      // Pass 1: STT 보정
      const { corrected } = await this.correctAndCheck(text, sourceLanguage, {
        summary: context.summary,
        recentSourceText: context.recentSourceText,
      });

      // Pass 2: 보정된 텍스트 → 다국어 번역
      const translations = await this.translateText(corrected, targetLanguages, sourceLanguage, {
        summary: context.summary,
        recentTranslationHistory: context.recentTranslationHistory,
        glossary: context.glossary,
      });

      return {
        sourceText: corrected,
        translations,
      };

    } catch (error) {
      console.error('[TranslationService] Translation error:', error);
      return null;
    }
  }

  /**
   * 번역 시스템 프롬프트 — 번역 전용 (보정된 소스 텍스트 입력)
   */
  private buildTranslationSystemPrompt(
    langKeys: string,
    langList: string,
    sourceLanguage: string,
    glossary?: Record<string, string>,
    environmentDescription?: string,
  ): string {
    const langName = SOURCE_LANGUAGE_NAMES[sourceLanguage] || 'Korean';
    let prompt = `You are a professional ${langName}-to-multilingual translator. You receive clean, corrected ${langName} text and must produce accurate translations.`;

    if (environmentDescription) {
      prompt += `\n\nCONTEXT: ${environmentDescription}
Use domain-appropriate terminology and tone for this context.`;
    }

    prompt += `

OUTPUT FORMAT: JSON object with keys: ${langKeys}
- ${langList}: Accurate translation in each target language

Example: {${langKeys.split(', ').map(k => `${k}: "translated text."`).join(', ')}}

CRITICAL RULES:
1. Translate ONLY the given ${langName} text — do NOT add, predict, or generate content beyond what is provided
2. Your translations continue a flowing paragraph — write as a natural continuation of previous translations
3. Do NOT repeat content from previous translations
4. Preserve the speaker's tone and register
5. Each value must be purely in its target language script (Urdu in Perso-Arabic, Arabic in Arabic script, etc.)
6. Output ONLY the JSON object — no explanations, no markdown
7. Translate meaning, not word-for-word
8. Use natural sentence structure and punctuation for the target language`;

    if (glossary && Object.keys(glossary).length > 0) {
      const terms = Object.entries(glossary).slice(0, 30)
        .map(([ko, en]) => `${ko} = ${en}`)
        .join('\n');
      prompt += `\n\nDOMAIN TERMINOLOGY (always use these translations):\n${terms}`;
    }

    return prompt;
  }

  /**
   * 번역 유저 프롬프트
   */
  private buildTranslationUserPrompt(
    correctedSourceText: string,
    sourceLanguage: string,
    context: {
      summary?: string;
      recentTranslationHistory?: Record<string, string>[];
    }
  ): string {
    const langName = SOURCE_LANGUAGE_NAMES[sourceLanguage] || 'Korean';
    const parts: string[] = [];

    if (context.summary) {
      parts.push(`[Topic summary]\n${context.summary}`);
    }

    if (context.recentTranslationHistory && context.recentTranslationHistory.length > 0) {
      const historyLines = context.recentTranslationHistory.map((translations, i) => {
        const entries = Object.entries(translations)
          .map(([lang, text]) => `  ${lang}: ${text}`)
          .join('\n');
        return `[${i + 1}]\n${entries}`;
      }).join('\n');
      parts.push(`[Previous translations — your output continues after these]\n${historyLines}`);
    }

    parts.push(`[Translate this ${langName} text]\n${correctedSourceText}`);

    return parts.join('\n\n');
  }

  /**
   * 번역 JSON 응답 파싱
   */
  private parseTranslationResponse(
    content: string,
    targetLanguages: string[],
    sourceLanguage: string = 'ko',
  ): Record<string, string> {
    const translations: Record<string, string> = {};

    try {
      let jsonStr = content;

      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd !== -1) {
        jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);
      const scriptRegex = SOURCE_SCRIPT_REGEX[sourceLanguage];

      for (const lang of targetLanguages) {
        if (parsed[lang] && typeof parsed[lang] === 'string') {
          const value = parsed[lang].trim();
          // 소스 언어 스크립트 오염 검사 (CJK만 — Latin 스크립트는 스킵)
          if (scriptRegex && lang !== sourceLanguage && scriptRegex.test(value)) {
            const cleanRegex = new RegExp(scriptRegex.source, 'g');
            const cleaned = value.replace(cleanRegex, '').replace(/\s{2,}/g, ' ').trim();
            if (cleaned.length > 0) {
              translations[lang] = cleaned;
              console.warn(`[TranslationService] Source language chars removed from ${lang} translation`);
            }
          } else {
            translations[lang] = value;
          }
        }
      }
    } catch (e) {
      console.warn('[TranslationService] JSON parse failed, attempting fallback:', e);

      if (targetLanguages.length === 1) {
        const cleaned = content.replace(/^[^a-zA-Z\u3000-\u9FFF\u0600-\u06FF\uAC00-\uD7AF]*/g, '').trim();
        if (cleaned) {
          translations[targetLanguages[0]] = cleaned;
        }
      }
    }

    return translations;
  }

  /**
   * 비동기 번역 개선 — 앞뒤 문맥으로 이전 세그먼트 번역 보정
   */
  async refineTranslation(
    prevSourceText: string,
    currentSourceText: string,
    nextSourceText: string,
    currentTranslation: Record<string, string>,
    targetLanguages: string[],
    sourceLanguage: string = 'ko',
    environmentDescription?: string,
  ): Promise<Record<string, string> | null> {
    try {
      const langName = SOURCE_LANGUAGE_NAMES[sourceLanguage] || 'Korean';
      const langKeys = targetLanguages.map(code => `"${code}"`).join(', ');
      const translationStr = JSON.stringify(currentTranslation);

      let systemContent = `You refine translations using surrounding ${langName} context. Output improved JSON ({${langKeys}}) or exactly "OK" if no improvement needed. No explanation.`;
      if (environmentDescription) {
        systemContent = `Context: ${environmentDescription}\n\n${systemContent}`;
      }

      const response = await this.openai.chat.completions.create({
        model: this.correctionModel,
        messages: [
          {
            role: 'system',
            content: systemContent
          },
          {
            role: 'user',
            content: `${prevSourceText ? `[Before] ${prevSourceText}\n` : ''}[Current] ${currentSourceText}\n[After] ${nextSourceText}\n\nCurrent translation:\n${translationStr}`
          }
        ],
        max_completion_tokens: 500,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content || content === 'OK' || content === '"OK"') return null;

      const improved = this.parseTranslationResponse(content, targetLanguages, sourceLanguage);
      if (Object.keys(improved).length === 0) return null;

      // 실제로 변경된 경우만 반환
      const hasChange = targetLanguages.some(
        lang => improved[lang] && improved[lang] !== currentTranslation[lang]
      );
      return hasChange ? improved : null;
    } catch (error) {
      console.error('[TranslationService] Refinement error:', error);
      return null;
    }
  }

  /**
   * 요약 생성 (Tier 2: 증분 요약)
   */
  async generateSummary(recentText: string, previousSummary: string = '', sourceLanguage: string = 'ko'): Promise<string | null> {
    try {
      const langName = SOURCE_LANGUAGE_NAMES[sourceLanguage] || 'Korean';
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation in ${langName}. Keep under 80 words, focus on main topics, key points, and any specialized terminology used.
${previousSummary ? `Previous: ${previousSummary}\n` : ''}
Recent:
${recentText}

Summary (${langName}, <80 words):`
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
}
