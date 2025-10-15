import axios from 'axios';

/**
 * Google Translate API Service
 *
 * Uses Google Cloud Translation API (v2) for cost-effective translation
 * English -> Multiple languages
 */

export interface TranslationResult {
  language: string;
  text: string;
}

export class GoogleTranslateService {
  private apiKey: string;
  private baseUrl = 'https://translation.googleapis.com/language/translate/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Translate English text to multiple target languages
   */
  async translateToMultipleLanguages(
    englishText: string,
    targetLanguages: string[]
  ): Promise<Record<string, string>> {
    if (!this.apiKey) {
      console.warn('[GoogleTranslate] API key not configured, skipping translation');
      return {};
    }

    if (!englishText || targetLanguages.length === 0) {
      return {};
    }

    const results: Record<string, string> = {};

    try {
      // Translate to each language
      const promises = targetLanguages.map(async (lang) => {
        try {
          const response = await axios.post(
            this.baseUrl,
            null,
            {
              params: {
                key: this.apiKey,
                q: englishText,
                source: 'en',
                target: lang,
                format: 'text',
              },
            }
          );

          if (response.data?.data?.translations?.[0]?.translatedText) {
            results[lang] = response.data.data.translations[0].translatedText;
          }
        } catch (error: any) {
          console.error(`[GoogleTranslate] Failed to translate to ${lang}:`, error.message);
          // Don't throw, just skip this language
        }
      });

      await Promise.all(promises);

      return results;
    } catch (error: any) {
      console.error('[GoogleTranslate] Translation error:', error.message);
      return {};
    }
  }

  /**
   * Translate to a single language
   */
  async translateToLanguage(
    englishText: string,
    targetLanguage: string
  ): Promise<string | null> {
    const results = await this.translateToMultipleLanguages(englishText, [targetLanguage]);
    return results[targetLanguage] || null;
  }
}

/**
 * Supported language codes
 * Common languages for international meetings/conferences
 */
export const SUPPORTED_LANGUAGES = {
  en: 'English',
  ja: '日本語 (Japanese)',
  zh: '中文 (Chinese Simplified)',
  'zh-TW': '中文 (Chinese Traditional)',
  es: 'Español (Spanish)',
  fr: 'Français (French)',
  de: 'Deutsch (German)',
  ru: 'Русский (Russian)',
  ar: 'العربية (Arabic)',
  pt: 'Português (Portuguese)',
  vi: 'Tiếng Việt (Vietnamese)',
  th: 'ไทย (Thai)',
  id: 'Bahasa Indonesia (Indonesian)',
  hi: 'हिन्दी (Hindi)',
};

/**
 * Parse comma-separated language codes from settings
 */
export function parseTargetLanguages(languageString: string): string[] {
  return languageString
    .split(',')
    .map(lang => lang.trim())
    .filter(lang => lang && lang !== 'en') // Filter out English (already translated by OpenAI)
    .filter(lang => lang in SUPPORTED_LANGUAGES);
}
