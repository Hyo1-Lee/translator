import axios from 'axios';

/**
 * Azure Translator API Service
 *
 * Uses Microsoft Azure Cognitive Services Translator API
 * Key advantage: Single API call for multiple target languages
 */

export interface AzureTranslateConfig {
  subscriptionKey: string;
  region: string;
}

export interface TranslationResult {
  language: string;
  text: string;
}

// Language code mapping: internal code -> Azure code
const AZURE_LANGUAGE_MAP: Record<string, string> = {
  'zh': 'zh-Hans',      // Chinese Simplified
  'zh-TW': 'zh-Hant',   // Chinese Traditional
  // All other codes are the same
};

// Reverse mapping: Azure code -> internal code
const INTERNAL_LANGUAGE_MAP: Record<string, string> = {
  'zh-Hans': 'zh',
  'zh-Hant': 'zh-TW',
};

export class AzureTranslateService {
  private subscriptionKey: string;
  private region: string;
  private endpoint = 'https://api.cognitive.microsofttranslator.com';

  constructor(config: AzureTranslateConfig) {
    this.subscriptionKey = config.subscriptionKey;
    this.region = config.region;

    if (this.subscriptionKey && this.region) {
      console.log(`[AzureTranslate] initialized (region: ${this.region})`);
    } else {
      console.warn('[AzureTranslate] API key or region not configured');
    }
  }

  /**
   * Convert internal language code to Azure language code
   */
  private toAzureCode(langCode: string): string {
    return AZURE_LANGUAGE_MAP[langCode] || langCode;
  }

  /**
   * Convert Azure language code to internal language code
   */
  private toInternalCode(azureCode: string): string {
    return INTERNAL_LANGUAGE_MAP[azureCode] || azureCode;
  }

  /**
   * Translate English text to multiple target languages in a single API call
   * Azure's key advantage: batch translation to multiple languages at once
   */
  async translateToMultipleLanguages(
    englishText: string,
    targetLanguages: string[]
  ): Promise<Record<string, string>> {
    if (!this.subscriptionKey || !this.region) {
      console.warn('[AzureTranslate] API key or region not configured, skipping translation');
      return {};
    }

    if (!englishText || targetLanguages.length === 0) {
      return {};
    }

    const results: Record<string, string> = {};

    try {
      // Convert language codes to Azure format
      const azureTargetLangs = targetLanguages.map(lang => this.toAzureCode(lang));

      // Build the URL with multiple 'to' parameters (Azure's batch translation feature)
      const toParams = azureTargetLangs.map(lang => `to=${lang}`).join('&');
      const url = `${this.endpoint}/translate?api-version=3.0&from=en&${toParams}`;

      const response = await axios.post(
        url,
        [{ text: englishText }],
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Ocp-Apim-Subscription-Region': this.region,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        }
      );

      // Parse response - Azure returns translations for all languages in one response
      if (response.data && response.data[0] && response.data[0].translations) {
        for (const translation of response.data[0].translations) {
          const internalCode = this.toInternalCode(translation.to);
          results[internalCode] = translation.text;
        }
      }

      // Log success
      const langCount = Object.keys(results).length;
      if (langCount > 0) {
        console.log(`[AzureTranslate] Translated to ${langCount} languages in single API call`);
      }

      return results;
    } catch (error: any) {
      if (error.response) {
        console.error('[AzureTranslate] API error:', {
          status: error.response.status,
          message: error.response.data?.error?.message || error.message,
        });
      } else {
        console.error('[AzureTranslate] Translation error:', error.message);
      }
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
 * 15 languages including Urdu for international meetings/conferences
 */
export const SUPPORTED_LANGUAGES = {
  en: 'English',
  ja: '日本語 (Japanese)',
  zh: '中文 (Chinese Simplified)',
  'zh-TW': '繁體中文 (Chinese Traditional)',
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
  ur: 'اردو (Urdu)',  // New: Urdu (Pakistan)
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
