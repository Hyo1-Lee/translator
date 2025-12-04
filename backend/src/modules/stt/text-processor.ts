/**
 * STT Text Processor
 * 최소한의 후처리만 수행 - Deepgram 결과를 거의 그대로 사용
 */

/**
 * Korean sentence ending patterns (문장 완성 판단용)
 */
const KOREAN_SENTENCE_ENDINGS = /(?:니다|세요|에요|어요|아요|네요|군요|죠|지요|래요|대요|거든요|잖아요|다고요|라고요|냐고요|다니까요|다면서요|ㄴ데요|는데요|은데요|든데요|걸요|나요|냐요|가요|줘요|봐요|해요|니까|으니까|거든|잖아|다고|라고|냐고|다니까|다면서|ㄴ데|는데|은데|든데|구요|군|지|냐|나|걸|가|다|요|네|래|봐)[\s]*$/;

/**
 * Process transcript text
 * Deepgram 결과를 그대로 사용 (trim만)
 */
export function processTranscript(text: string): string {
  if (!text) return '';
  return text.trim();
}

/**
 * Check if text is a complete sentence
 */
export function isCompleteSentence(text: string): boolean {
  if (!text || text.trim().length < 3) {
    return false;
  }

  const trimmed = text.trim();

  // Check for punctuation endings
  if (/[.!?。！？]$/.test(trimmed)) {
    return true;
  }

  // Check for Korean sentence endings
  if (KOREAN_SENTENCE_ENDINGS.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Format text for display
 */
export function formatForDisplay(text: string): string {
  if (!text) return '';
  return text.trim();
}
