import OpenAI from 'openai';
import { buildTranslationPrompt, EnvironmentPreset } from './presets';

interface TranslationConfig {
  apiKey: string;
  model?: string;
  provider?: 'openai' | 'groq';
  groqApiKey?: string;
  groqModel?: string;
  enableSmartBatch?: boolean;
  batchSize?: number;
}

export class TranslationService {
  private openai: OpenAI;
  private groq?: OpenAI;
  private model: string;
  private provider: 'openai' | 'groq';
  private enableSmartBatch: boolean;
  private batchSize: number;

  constructor(config: TranslationConfig) {
    this.provider = config.provider || 'openai';
    this.enableSmartBatch = config.enableSmartBatch ?? false;
    this.batchSize = config.batchSize || 3;

    // OpenAI client
    this.openai = new OpenAI({
      apiKey: config.apiKey
    });
    this.model = config.model || 'gpt-5-nano';

    // Groq client (OpenAI SDK compatible)
    if (this.provider === 'groq' && config.groqApiKey) {
      this.groq = new OpenAI({
        apiKey: config.groqApiKey,
        baseURL: 'https://api.groq.com/openai/v1'
      });
      this.model = config.groqModel || 'llama-3.3-70b-versatile';
      console.log(`[TranslationService] 🚀 Groq enabled with model: ${this.model}`);
      console.log(`[TranslationService] 📦 Smart batch: ${this.enableSmartBatch ? `enabled (${this.batchSize} items)` : 'disabled'}`);
    }
  }

  /**
   * Get active client based on provider
   */
  private getClient(): OpenAI {
    return this.provider === 'groq' && this.groq ? this.groq : this.openai;
  }

  // Translate text
  async translate(text: string, targetLanguage: string = 'en'): Promise<string | null> {
    try {
      // First, correct any STT errors
      const correctedText = await this.correctSttErrors(text);

      // If target language is Korean, just return the corrected text
      if (targetLanguage === 'ko') {
        return correctedText;
      }

      const { langName, systemPrompt } = this.getLanguageConfig(targetLanguage);
      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Translate the following Korean text to ${langName}:\n\n${correctedText}`
          }
        ],
        max_completion_tokens: 1500,  // 최적화: 3000 → 1500
        temperature: 0.3
      });

      const translation = response.choices[0]?.message?.content?.trim();
      return translation || null;
    } catch (error) {
      console.error('[Translation] Error:', error);
      return null;
    }
  }

  /**
   * 🚀 스마트 배치 번역 (여러 문장을 한 번에)
   * - API 호출 횟수 대폭 감소 (3개 → 1개)
   * - Groq의 초고속 처리로 전체 시간 단축
   */
  async translateBatch(
    texts: Array<{ text: string; confidence?: number }>,
    recentContext: string,
    summary: string,
    sourceLanguage: string,
    targetLanguage: string,
    environmentPreset: EnvironmentPreset,
    customEnvironmentDescription?: string,
    customGlossary?: Record<string, string>
  ): Promise<Array<{ originalText: string; translatedText: string; confidence?: number }> | null> {
    try {
      if (texts.length === 0) return [];

      const startTime = Date.now();
      console.log(`[TranslationService] 📦 Batch translating ${texts.length} items with ${this.provider}...`);

      // ⚡ STT 오류 사전 보정 (모든 텍스트에 적용)
      const correctedTexts = await Promise.all(
        texts.map(async (item) => ({
          ...item,
          text: await this.correctSttErrors(item.text),
          originalText: item.text  // 원본 보존
        }))
      );

      // Build prompt
      const systemPrompt = buildTranslationPrompt(
        sourceLanguage,
        targetLanguage,
        environmentPreset,
        customEnvironmentDescription,
        customGlossary
      );

      // Format: [1] 문장1\n[2] 문장2\n[3] 문장3 (corrected 텍스트 사용)
      const numberedTexts = correctedTexts.map((item, i) => `[${i + 1}] ${item.text}`).join('\n');

      const userPrompt = systemPrompt
        .replace('{summary}', summary || '(No summary yet)')
        .replace('{recentContext}', recentContext || '(No recent context)')
        .replace('{currentText}', `TRANSLATE EACH OF THE FOLLOWING ${texts.length} SENTENCES SEPARATELY. Keep the numbering format [1], [2], [3] etc in your response:\n\n${numberedTexts}`);

      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_completion_tokens: 2500,  // 최적화: 5000 → 2500 (배치당 ~800 토큰이면 충분)
        temperature: 0.3
      });

      const fullResponse = response.choices[0]?.message?.content?.trim();
      if (!fullResponse) {
        console.error('[TranslationService] ❌ Empty batch response');
        return null;
      }

      const elapsed = Date.now() - startTime;
      console.log(`[TranslationService] ⚡ Batch completed in ${elapsed}ms (${Math.round(correctedTexts.length * 1000 / elapsed)} items/sec)`);

      // Parse response: [1] Translation1\n[2] Translation2\n[3] Translation3
      const results: Array<{ originalText: string; translatedText: string; confidence?: number }> = [];

      for (let i = 0; i < correctedTexts.length; i++) {
        const num = i + 1;
        // Try multiple patterns to extract translation
        const patterns = [
          new RegExp(`\\[${num}\\]\\s*([^\\[]+?)(?=\\[${num + 1}\\]|$)`, 's'),
          new RegExp(`${num}\\.?\\s*([^\\d]+?)(?=${num + 1}\\.|$)`, 's'),
        ];

        let translation = '';
        for (const pattern of patterns) {
          const match = fullResponse.match(pattern);
          if (match) {
            translation = match[1].trim();
            break;
          }
        }

        // Fallback: if parsing fails, split by lines
        if (!translation && i < correctedTexts.length) {
          const lines = fullResponse.split('\n').filter(l => l.trim());
          if (lines[i]) {
            translation = lines[i].replace(/^\[\d+\]\s*/, '').replace(/^\d+\.\s*/, '').trim();
          }
        }

        results.push({
          originalText: correctedTexts[i].originalText,  // 원본 텍스트 사용
          translatedText: translation || `[Translation failed for item ${num}]`,
          confidence: correctedTexts[i].confidence
        });
      }

      return results;
    } catch (error) {
      console.error('[TranslationService] ❌ Batch translation error:', error);
      return null;
    }
  }

  // Translate to multiple languages at once
  async translateToMultipleLanguages(text: string, targetLanguages: string[]): Promise<Record<string, string>> {
    try {
      const translations = await Promise.all(
        targetLanguages.map(async (lang) => {
          const translation = await this.translate(text, lang);
          return { lang, translation };
        })
      );

      const result: Record<string, string> = {};
      translations.forEach(({ lang, translation }) => {
        if (translation) {
          result[lang] = translation;
        }
      });

      return result;
    } catch (error) {
      console.error('[Translation] Multi-language translation error:', error);
      return {};
    }
  }

  // Batch translate multiple texts
  async batchTranslate(texts: string[], targetLanguage: string = 'en'): Promise<string[]> {
    const translations = await Promise.all(
      texts.map(text => this.translate(text, targetLanguage))
    );
    return translations.filter(t => t !== null) as string[];
  }

  /**
   * 프리셋 기반 문맥 번역 (신규)
   * - 슬라이딩 윈도우 + 요약 기반
   * - 프리셋 시스템 활용
   */
  async translateWithPreset(
    currentText: string,
    recentContext: string,
    summary: string,
    sourceLanguage: string,
    targetLanguage: string,
    environmentPreset: EnvironmentPreset,
    customEnvironmentDescription?: string,
    customGlossary?: Record<string, string>
  ): Promise<string | null> {
    try {
      // ⚡ STT 오류 사전 보정 (LLM 호출 전에 정규식으로 빠르게 처리)
      const correctedText = await this.correctSttErrors(currentText);

      // 프리셋 기반 프롬프트 생성
      const systemPrompt = buildTranslationPrompt(
        sourceLanguage,
        targetLanguage,
        environmentPreset,
        customEnvironmentDescription,
        customGlossary
      );

      // 컨텍스트 변수 치환 (correctedText 사용!)
      const userPrompt = systemPrompt
        .replace('{summary}', summary || '(No summary yet)')
        .replace('{recentContext}', recentContext || '(No recent context)')
        .replace('{currentText}', correctedText);

      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_completion_tokens: 1500,  // 최적화: 3000 → 1500 (단일 문장에 충분)
        temperature: 0.3  // 일관성 있는 번역을 위해 낮은 temperature
      });

      const translation = response.choices[0]?.message?.content?.trim();
      return translation || null;
    } catch (error) {
      console.error('[Translation] Preset-based translation error:', error);
      return null;
    }
  }

  /**
   * 스트리밍 번역 (신규)
   * - 점진적 번역 표시
   */
  async translateWithStreaming(
    currentText: string,
    recentContext: string,
    summary: string,
    sourceLanguage: string,
    targetLanguage: string,
    environmentPreset: EnvironmentPreset,
    customEnvironmentDescription?: string,
    customGlossary?: Record<string, string>,
    onChunk?: (chunk: string) => void
  ): Promise<string | null> {
    try {
      // ⚡ STT 오류 사전 보정
      const correctedText = await this.correctSttErrors(currentText);

      const systemPrompt = buildTranslationPrompt(
        sourceLanguage,
        targetLanguage,
        environmentPreset,
        customEnvironmentDescription,
        customGlossary
      );

      const userPrompt = systemPrompt
        .replace('{summary}', summary || '(No summary yet)')
        .replace('{recentContext}', recentContext || '(No recent context)')
        .replace('{currentText}', correctedText);

      const client = this.getClient();

      const stream = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_completion_tokens: 1500,  // 최적화: 3000 → 1500
        temperature: 0.3,
        stream: true
      });

      let fullTranslation = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullTranslation += content;
          if (onChunk) {
            onChunk(content);
          }
        }
      }

      return fullTranslation.trim() || null;
    } catch (error) {
      console.error('[Translation] Streaming translation error:', error);
      return null;
    }
  }

  // Translate with context for better accuracy (기존 함수 - 하위 호환성 유지)
  async translateWithContext(
    currentText: string,
    fullContext: string,
    summary: string,
    targetLanguage: string = 'en'
  ): Promise<string | null> {
    try {
      // First, correct any STT errors
      const correctedText = await this.correctSttErrors(currentText);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in religious speeches from The Church of Jesus Christ of Latter-day Saints (LDS/Mormon Church).

SOURCE LANGUAGE: Korean (한국어)
TARGET LANGUAGE: ${targetLanguage === 'en' ? 'English' : targetLanguage}

CONTEXT: This is a religious discourse/sermon in a formal LDS church setting.

CONTEXT-AWARE TRANSLATION:
${summary ? `Conversation Summary: ${summary}` : ''}
Recent context: ${fullContext}

CRITICAL RELIGIOUS TERMINOLOGY (DO NOT TRANSLATE, USE AS-IS):
- 몰몬경 = Book of Mormon
- 앨마 = Alma (prophet name)
- 앰율레크 = Amulek (prophet name)
- 베냐민 왕 = King Benjamin
- 리하이 = Lehi (prophet name)
- 니파이 = Nephi (prophet name)
- 모로나이 = Moroni (prophet name)
- 이더 = Ether (prophet name)

COMMON LDS TERMS:
- 구주 = Savior
- 속죄 = Atonement
- 자비 = mercy
- 공의 = justice
- 부활 = resurrection
- 간증 = testimony
- 성신 = Holy Ghost
- 성전 = temple
- 와드 = ward
- 스테이크 = stake
- 제일회장단 = First Presidency
- 선지자 = prophet
- 사도 = apostle
- 감독 = bishop

TRANSLATION APPROACH:
1. AGGRESSIVELY correct STT errors - the text likely contains many misrecognized religious terms
2. When you see garbled text that sounds like religious terms, correct it boldly
3. Maintain formal, reverent tone appropriate for religious discourse
4. If a sentence seems nonsensical, reconstruct it based on religious context and the provided summary
5. Preserve scriptural language style and dignity
6. Use previous context to maintain consistency in terminology and style

IMPORTANT:
- Fix ALL obvious speech recognition errors
- Reconstruct damaged religious terminology
- Maintain the reverent, formal tone of religious speech
- Use proper capitalization for deity and religious titles
- Ensure smooth flow with previous segments using the context provided

OUTPUT REQUIREMENTS:
- Return ONLY the translated text
- Do NOT include explanations, notes, or meta-commentary
- Ensure the translation reads naturally and maintains continuity with previous segments`
          },
          {
            role: 'user',
            content: `Translate this current segment (use context for clarity but translate ONLY this text):\n\n${correctedText}`
          }
        ],
        max_completion_tokens: 1500,  // 최적화: 3000 → 1500
        temperature: 0.3
      });

      const translation = response.choices[0]?.message?.content?.trim();
      return translation || null;
    } catch (error) {
      console.error('[Translation] Context translation error:', error);
      // Fallback to regular translation
      return this.translate(currentText, targetLanguage);
    }
  }

  // Generate conversation summary
  async generateSummary(recentText: string, previousSummary: string = ''): Promise<string | null> {
    try {
      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation in Korean. Keep under 80 words, focus on main topics.
${previousSummary ? `Previous: ${previousSummary}\n` : ''}
Recent:
${recentText}

Summary (Korean, <80 words):`
          }
        ],
        max_completion_tokens: 300,  // 최적화: 3000 → 300 (80단어 요약에 충분)
        temperature: 0.5
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('[Translation] Summary generation error:', error);
      return null;
    }
  }

  // Get language configuration with system prompt
  private getLanguageConfig(targetLanguage: string): { langName: string; systemPrompt: string } {
    const configs: Record<string, { langName: string; systemPrompt: string }> = {
      'en': {
        langName: 'English',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to English accurately and naturally.

IMPORTANT CONTEXT: This text comes from real-time speech recognition and may have errors or informal speech patterns.

Translation guidelines:
- Fix obvious speech recognition errors before translating
- Handle incomplete sentences gracefully
- Maintain the speaker's intended meaning even if the Korean text has minor errors
- Remove filler words (um, uh, 음, 어) unless they convey hesitation
- Keep the natural flow of spoken language

Specific terminology:
- "제일회장단" → "First Presidency"
- "성전" → "temple"
- "와드" → "ward"
- "스테이크" → "stake"
- "감독" → "bishop"
- "회장" → "president"
- Maintain proper capitalization for religious and organizational terms
- Preserve the formal or informal tone of the original speech`
      },
      'ja': {
        langName: 'Japanese',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Japanese accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate honorifics (敬語) based on the formality of the Korean text
- Fix obvious speech recognition errors before translating
- Maintain natural Japanese sentence structure
- Use kanji appropriately (balance readability with formality)
- Preserve the speaker's tone and intent`
      },
      'zh': {
        langName: 'Simplified Chinese',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Simplified Chinese (简体中文) accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use Simplified Chinese characters (简体字)
- Fix obvious speech recognition errors before translating
- Maintain natural Chinese sentence structure
- Preserve the formal or informal tone appropriately
- Use proper measure words and particles`
      },
      'zh-TW': {
        langName: 'Traditional Chinese',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Traditional Chinese (繁體中文) accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use Traditional Chinese characters (繁體字)
- Fix obvious speech recognition errors before translating
- Maintain natural Chinese sentence structure
- Preserve the formal or informal tone appropriately
- Use proper measure words and particles`
      },
      'es': {
        langName: 'Spanish',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Spanish accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate formal/informal address (tú/usted) based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Spanish sentence flow
- Use proper gender agreement
- Preserve the speaker's tone and intent`
      },
      'fr': {
        langName: 'French',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to French accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate formal/informal address (tu/vous) based on context
- Fix obvious speech recognition errors before translating
- Maintain natural French sentence structure
- Use proper gender and number agreement
- Preserve the speaker's tone and intent`
      },
      'de': {
        langName: 'German',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to German accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate formal/informal address (Sie/du) based on context
- Fix obvious speech recognition errors before translating
- Maintain proper German case system (Nominativ, Akkusativ, Dativ, Genitiv)
- Use proper noun capitalization
- Preserve the speaker's tone and intent`
      },
      'ru': {
        langName: 'Russian',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Russian accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate formal/informal address (вы/ты) based on context
- Fix obvious speech recognition errors before translating
- Maintain proper Russian case system
- Use proper aspect (perfective/imperfective) for verbs
- Preserve the speaker's tone and intent`
      },
      'ar': {
        langName: 'Arabic',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Modern Standard Arabic accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use Modern Standard Arabic (الفصحى)
- Fix obvious speech recognition errors before translating
- Maintain proper Arabic grammar and syntax
- Use appropriate formal register
- Preserve the speaker's tone and intent
- Use proper diacritics when necessary for clarity`
      },
      'pt': {
        langName: 'Portuguese',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Portuguese (Brazilian) accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use Brazilian Portuguese conventions
- Use appropriate formal/informal address (você/tu) based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Portuguese sentence flow
- Preserve the speaker's tone and intent`
      },
      'vi': {
        langName: 'Vietnamese',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Vietnamese accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use proper Vietnamese diacritics (dấu)
- Use appropriate formal/informal address based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Vietnamese sentence structure
- Preserve the speaker's tone and intent`
      },
      'th': {
        langName: 'Thai',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Thai accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use appropriate Thai script and tone marks
- Use appropriate formal/informal language (ภาษาพูด/ภาษาเขียน) based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Thai sentence structure
- Preserve the speaker's tone and intent`
      },
      'id': {
        langName: 'Indonesian',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Indonesian accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use standard Indonesian (Bahasa Indonesia)
- Use appropriate formal/informal register based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Indonesian sentence structure
- Preserve the speaker's tone and intent`
      },
      'hi': {
        langName: 'Hindi',
        systemPrompt: `You are a professional real-time speech translator. Translate the given Korean text to Hindi accurately and naturally.

IMPORTANT: This text comes from real-time speech recognition and may contain errors.

Translation guidelines:
- Use Devanagari script (देवनागरी)
- Use appropriate formal/informal address (आप/तुम) based on context
- Fix obvious speech recognition errors before translating
- Maintain natural Hindi sentence structure
- Preserve the speaker's tone and intent
- Use proper gender agreement`
      }
    };

    return configs[targetLanguage] || configs['en'];
  }

  // Correct STT errors in Korean text with religious context
  private async correctSttErrors(text: string): Promise<string> {
    try {
      // Religious terminology corrections (LDS/Mormon specific)
      // 확장된 STT 오류 보정 사전 - LLM 의존도 감소
      const religiousCorrections: Record<string, string> = {
        // 경전
        '몰멍평': '몰몬경',
        '몰몸경': '몰몬경',
        '몰몽경': '몰몬경',
        '몰문경': '몰몬경',
        '모몬경': '몰몬경',
        '교리와성약': '교리와 성약',
        '교리 와 성약': '교리와 성약',
        '값진진주': '값진 진주',

        // 현대 선지자 (매우 중요! 자주 틀림)
        '주작스미스': '조셉 스미스',
        '주작 스미스': '조셉 스미스',
        '조섭스미스': '조셉 스미스',
        '조섭 스미스': '조셉 스미스',
        '조셉스미스': '조셉 스미스',
        '죠셉 스미스': '조셉 스미스',
        '브리검영': '브리검 영',
        '브리검 용': '브리검 영',
        '러셀넬슨': '러셀 엠 넬슨',
        '러셀엠넬슨': '러셀 엠 넬슨',
        '러셀 넬슨': '러셀 엠 넬슨',
        '토마스몬슨': '토마스 에스 몬슨',
        '토마스 몬슨': '토마스 에스 몬슨',
        '제프리홀런드': '제프리 알 홀런드',
        '제프리 홀랜드': '제프리 알 홀런드',
        '데일린옥스': '데일린 에이치 옥스',
        '데일린 옥스': '데일린 에이치 옥스',
        '헨리아이어링': '헨리 비 아이어링',
        '헨리 아이어링': '헨리 비 아이어링',
        '우흐트도르프': '디이터 에프 우흐트도르프',

        // 경전 인물
        '앨몬': '앨마',
        '엘마': '앨마',
        '알마': '앨마',
        '에뮬레크': '앰율레크',
        '앰뮬레크': '앰율레크',
        '배념민': '베냐민',
        '베념민왕': '베냐민 왕',
        '베냐민왕': '베냐민 왕',
        '노파이': '니파이',
        '네파이': '니파이',
        '리하이': '리하이',
        '힐라맨': '힐라맨',
        '헬라만': '힐라맨',
        '모로나이': '모로나이',
        '모로니': '모로나이',
        '이드': '이더',

        // 교리 용어
        '크리스토': '그리스도',
        '예수크리스토': '예수 그리스도',
        '예수 크리스토': '예수 그리스도',
        '고주': '구주',
        '구쥬': '구주',
        '잡비': '자비',
        '자부': '자비',
        '속주': '속죄',
        '석죄': '속죄',
        '성심': '성신',
        '성령': '성신',
        '선지차': '선지자',
        '선지가': '선지자',
        '반중': '간증',
        '간중': '간증',
        '감증': '간증',
        '권한': '권능',
        '권눙': '권능',
        '회계': '회개',
        '복음': '복음',
        '보금': '복음',
        '부활': '부활',
        '부할': '부활',
        '천국': '천국',
        '천극': '천국',
        '영생': '영생',
        '용생': '영생',

        // 조직 및 직책
        '제일회장단': '제일회장단',
        '제일 회장단': '제일회장단',
        '십이사도': '십이사도',
        '12사도': '십이사도',
        '와드': '와드',
        '워드': '와드',
        '스테이크': '스테이크',
        '스테잌': '스테이크',
        '감독': '감독',
        '감돡': '감독',
        '장로': '장로',
        '잔로': '장로',
        '집사': '집사',
        '짒사': '집사',
        '선교사': '선교사',
        '성교사': '선교사',

        // 의식
        '성전': '성전',
        '승전': '성전',
        '성찬': '성찬',
        '성참': '성찬',
        '침례': '침례',
        '침레': '침례',
        '신권': '신권',
        '신관': '신권',
        '멜기세덱': '멜기세덱',
        '멜기 세덱': '멜기세덱',
        '아론': '아론',
        '아롱': '아론'
      };

      // Common STT error patterns
      const commonCorrections: Record<string, string> = {
        '질상': '지상',
        '부하라고': '부활하고',
        '원천한': '완전한',
        '공유의': '공의의',
        '모리를': '우리를',
        '자이로': '자비로',
        '권한': '관한',
        '무제한': '무지한',
        '벙한': '범한',
        '하려하며': '하려 함이요',
        '존재하은': '존재함은',
        '예컨대': '요컨대',
        '평온': '평안'
      };

      let corrected = text;

      // Apply religious corrections first (more specific)
      for (const [error, correction] of Object.entries(religiousCorrections)) {
        corrected = corrected.replace(new RegExp(error, 'gi'), correction);
      }

      // Then apply common corrections
      for (const [error, correction] of Object.entries(commonCorrections)) {
        corrected = corrected.replace(new RegExp(error, 'gi'), correction);
      }

      return corrected;
    } catch (error) {
      console.error('[Translation] STT error correction failed:', error);
      return text;
    }
  }

  // Correct/enhance text (for STT output) with aggressive religious context correction
  async correctText(text: string): Promise<string> {
    try {
      // First apply basic corrections
      const basicCorrected = await this.correctSttErrors(text);

      // Then use LLM for more sophisticated corrections
      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a Korean text editor specializing in religious speech recognition errors, particularly for LDS/Mormon church speeches.

CONTEXT: This is likely a religious sermon or scripture reading from The Church of Jesus Christ of Latter-day Saints.

COMMON MISRECOGNIZED RELIGIOUS TERMS TO CORRECT:
- 몰멍평/몰몸경/몰몽경 → 몰몬경 (Book of Mormon)
- 앨몬/엘마 → 앨마 (Alma)
- 에뮬레크 → 앰율레크 (Amulek)
- 배념민/베념민 → 베냐민 (Benjamin)
- 크리스토 → 그리스도 (Christ)
- 고주 → 구주 (Savior)
- 잡비 → 자비 (mercy)
- 공유 → 공의 (justice)
- 속주 → 속죄 (atonement)
- 부하/부화 → 부활 (resurrection)
- 반중/간중 → 간증 (testimony)
- 성심 → 성신 (Holy Ghost)
- 선지차 → 선지자 (prophet)

AGGRESSIVE CORRECTION RULES:
1. If a word sounds similar to a religious term, BOLDLY correct it
2. Fix ALL garbled religious names and terms
3. Restore proper religious terminology even if uncertain
4. Add appropriate punctuation for formal speech
5. Maintain reverent, formal tone

DO:
- Aggressively fix religious terminology
- Restore scriptural language patterns
- Fix obvious STT errors in religious context
- Maintain formal religious speech tone

DO NOT:
- Leave garbled religious terms uncorrected
- Be overly cautious about corrections`
          },
          {
            role: 'user',
            content: `Correct this religious speech STT output:\n${basicCorrected}`
          }
        ],
        max_completion_tokens: 1500,  // 최적화: 3000 → 1500
        temperature: 0.3
      });

      return response.choices[0]?.message?.content?.trim() || basicCorrected;
    } catch (error) {
      console.error('[Translation] Text correction error:', error);
      return text;
    }
  }
}