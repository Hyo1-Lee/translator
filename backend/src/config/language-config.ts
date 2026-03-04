/**
 * Language configuration for multi-source language support
 * Supported source languages: Korean, English, Spanish, Japanese
 */

/** Sentence ending patterns for TextAccumulator (buffer flush trigger) */
export const SENTENCE_ENDINGS: Record<string, RegExp> = {
  ko: /[다요죠까오니]\s*[.?!。]?\s*$/,
  en: /[.?!]\s*$/,
  es: /[.?!]\s*$/,
  ja: /[。！？.?!]\s*$/,
};

/** Sentence split patterns for findLastSentenceEnd (buffer overflow split) */
export const SENTENCE_SPLIT_PATTERNS: Record<string, RegExp> = {
  ko: /[다요죠까오니]\s*[.?!。]?\s+/g,
  en: /[.?!]\s+/g,
  es: /[.?!]\s+/g,
  ja: /[。！？]\s*/g,
};

/** Human-readable language names */
export const SOURCE_LANGUAGE_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
};

/**
 * Script detection regex for source language contamination check.
 * null = skip check (Latin-script languages can't be reliably distinguished)
 */
export const SOURCE_SCRIPT_REGEX: Record<string, RegExp | null> = {
  ko: /[\uAC00-\uD7AF\u3131-\u3163]/g,
  ja: /[\u3040-\u309F\u30A0-\u30FF]/g,
  en: null,
  es: null,
};
