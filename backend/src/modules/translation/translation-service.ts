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
    this.model = config.model || 'gpt-4o-mini';
  }

  // Translate text
  async translate(text: string, targetLanguage: string = 'en'): Promise<string | null> {
    try {
      const prompt = this.getTranslationPrompt(text, targetLanguage);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the given Korean text to English accurately and naturally. Maintain the context and tone of the original text.

Important translation guidelines:
- "제일회장단" → "First Presidency"
- "성전" → "temple"
- "와드" → "ward"
- "스테이크" → "stake"
- "감독" → "bishop"
- "회장" → "president"
- Maintain proper capitalization for religious and organizational terms
- Preserve the formal or informal tone of the original text`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
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

  // Correct/enhance text (for STT output)
  async correctText(text: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a text editor. Correct any grammar or spelling mistakes in the Korean text while preserving its original meaning. Add appropriate punctuation if missing.'
          },
          {
            role: 'user',
            content: `Correct this text: ${text}`
          }
        ],
        temperature: 0.2,
        max_tokens: 200
      });

      return response.choices[0]?.message?.content?.trim() || text;
    } catch (error) {
      console.error('[Translation] Text correction error:', error);
      return text;
    }
  }
}