/**
 * STT Text Processor
 * 최소한의 후처리만 수행 - Deepgram 결과를 거의 그대로 사용
 */

/**
 * 최소 문장 길이 (한글 기준 약 5-7단어)
 * 너무 짧은 문장 분리 방지
 */
const MIN_SENTENCE_LENGTH = 15;

/**
 * Korean sentence ending patterns (문장 완성 판단용)
 * 확장된 종결 어미 패턴
 */
const KOREAN_SENTENCE_ENDINGS = /(?:니다|습니다|ㅂ니다|세요|에요|어요|아요|네요|군요|죠|지요|래요|대요|거든요|잖아요|다고요|라고요|냐고요|다니까요|다면서요|ㄴ데요|는데요|은데요|든데요|걸요|나요|냐요|가요|줘요|봐요|해요|할게요|할께요|줄게요|줄께요|니까|으니까|거든|잖아|다고|라고|냐고|다니까|다면서|ㄴ데|는데|은데|든데|구요|군|지|냐|나|걸|가|다|요|네|래|봐|았다|었다|였다|겠다|ㄴ다|는다|한다|된다|인다)[\s]*$/;

/**
 * Incomplete sentence patterns (불완전 문장 패턴)
 * 이 패턴으로 끝나면 문장이 아직 완성되지 않은 것
 */
const INCOMPLETE_PATTERNS = /(?:그리고|하지만|그런데|그래서|만약|또는|그러면|그러나|그렇지만|왜냐하면|따라서|그러므로|즉|예를 들어|예를들어|다시 말해|다시말해|뿐만 아니라|때문에|에서|으로|에게|한테|께서|이나|이랑|랑|와|과|의|은|는|이|가|을|를|에|도|만|까지)[\s]*$/;

/**
 * 연결 표현 패턴 (문장이 이어질 가능성이 높은 표현)
 * 이 패턴으로 끝나면 다음 단어와 합쳐서 처리
 */
const CONTINUATION_PATTERNS = /(?:그리고|또한|그래서|그러나|하지만|그런데|또|그리고서|그러면|만약|왜냐하면|따라서|그러므로)[\s]*$/;

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
 * 개선: 최소 길이 + 종결 어미 조합 검사
 */
export function isCompleteSentence(text: string): boolean {
  if (!text || text.trim().length < MIN_SENTENCE_LENGTH) {
    return false;
  }

  const trimmed = text.trim();

  // Check for incomplete patterns first (접속사, 조사로 끝나면 불완전)
  if (INCOMPLETE_PATTERNS.test(trimmed)) {
    return false;
  }

  // Check for continuation patterns (연결 표현으로 끝나면 대기)
  if (CONTINUATION_PATTERNS.test(trimmed)) {
    return false;
  }

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
 * Check if text should wait for more content
 * 연결 표현으로 끝나는 경우 다음 내용을 기다림
 */
export function shouldWaitForMore(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();

  // 최소 길이 미달
  if (trimmed.length < MIN_SENTENCE_LENGTH) {
    return true;
  }

  // 연결 표현으로 끝남
  if (CONTINUATION_PATTERNS.test(trimmed)) {
    return true;
  }

  // 불완전 패턴으로 끝남
  if (INCOMPLETE_PATTERNS.test(trimmed)) {
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
