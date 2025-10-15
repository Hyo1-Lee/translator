import OpenAI from 'openai';

interface TranslationConfig {
  apiKey: string;
  model?: string;
}

export class TranslationService {
  private openai: OpenAI;
  private model: string;

  constructor(config: TranslationConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey
    });
    this.model = config.model || 'gpt-5-nano';
  }

  // Translate text
  async translate(text: string, targetLanguage: string = 'en'): Promise<string | null> {
    try {
      // First, correct any STT errors
      const correctedText = await this.correctSttErrors(text);
      const prompt = this.getTranslationPrompt(correctedText, targetLanguage);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional real-time speech translator. Translate the given Korean text to English accurately and naturally.

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
          {
            role: 'user',
            content: prompt
          }
        ],
        max_completion_tokens: 3000
      });

      const translation = response.choices[0]?.message?.content?.trim();
      return translation || null;
    } catch (error) {
      console.error('[Translation] Error:', error);
      return null;
    }
  }

  // Batch translate multiple texts
  async batchTranslate(texts: string[], targetLanguage: string = 'en'): Promise<string[]> {
    const translations = await Promise.all(
      texts.map(text => this.translate(text, targetLanguage))
    );
    return translations.filter(t => t !== null) as string[];
  }

  // Translate with context for better accuracy
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
4. If a sentence seems nonsensical, reconstruct it based on religious context
5. Preserve scriptural language style and dignity

IMPORTANT:
- Fix ALL obvious speech recognition errors
- Reconstruct damaged religious terminology
- Maintain the reverent, formal tone of religious speech
- Use proper capitalization for deity and religious titles`
          },
          {
            role: 'user',
            content: `Translate this current segment (use context for clarity but translate ONLY this text):\n\n${correctedText}`
          }
        ],
        max_completion_tokens: 3000
      });

      const translation = response.choices[0]?.message?.content?.trim();
      console.log('[Translation] Context translation completed:', translation ? 'Success' : 'Failed');
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
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Create a brief summary of the conversation in Korean.

Keep the summary:
- Under 100 words
- Focused on main topics and key points
- Useful as context for future translations`
          },
          {
            role: 'user',
            content: `${previousSummary ? `Previous summary: ${previousSummary}\n\n` : ''}Recent conversation:\n${recentText}\n\nCreate an updated summary:`
          }
        ],
        max_completion_tokens: 3000
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('[Translation] Summary generation error:', error);
      return null;
    }
  }

  // Get translation prompt
  private getTranslationPrompt(text: string, targetLanguage: string): string {
    const langMap: Record<string, string> = {
      'en': 'English',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German'
    };

    const targetLangName = langMap[targetLanguage] || 'English';
    return `Translate the following Korean text to ${targetLangName}:\n\n${text}`;
  }

  // Correct STT errors in Korean text with religious context
  private async correctSttErrors(text: string): Promise<string> {
    try {
      // Religious terminology corrections (LDS/Mormon specific)
      const religiousCorrections: Record<string, string> = {
        '몰멍평': '몰몬경',
        '몰몸경': '몰몬경',
        '몰몽경': '몰몬경',
        '앨몬': '앨마',
        '엘마': '앨마',
        '에뮬레크': '앰율레크',
        '배념민': '베냐민',
        '크리스토': '그리스도',
        '예수크리스토': '예수 그리스도',
        '고주': '구주',
        '잡비': '자비',
        '속주': '속죄',
        '성심': '성신',
        '성전': '성전',
        '선지차': '선지자',
        '제일회장단': '제일회장단',
        '사도': '사도',
        '감독': '감독',
        '와드': '와드',
        '스테이크': '스테이크',
        '반중': '간증',
        '간중': '간증'
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
      const response = await this.openai.chat.completions.create({
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
        max_completion_tokens: 3000
      });

      return response.choices[0]?.message?.content?.trim() || basicCorrected;
    } catch (error) {
      console.error('[Translation] Text correction error:', error);
      return text;
    }
  }
}