/**
 * Text Display Utilities
 * 최소한의 포맷팅만 수행
 */

/**
 * Get display-ready text
 */
export function getDisplayText(text: string): string {
  if (!text) return '';
  return text.trim();
}
