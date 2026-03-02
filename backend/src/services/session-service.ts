/**
 * SessionService - 인메모리 세션 관리 (번역 문맥)
 *
 * TranslationManager가 하던 문맥 관리를 대체.
 * 룸별 인메모리 상태를 유지하여 번역 품질 향상.
 */

export interface RoomSession {
  contextWindow: string[];                      // 최근 5 한국어 세그먼트
  summary: string;                              // 현재 요약
  segmentSequence: number;                      // 순서 카운터
  previousTranslations: Record<string, string>; // 언어별 마지막 번역
  translationInFlight: boolean;                 // 동시 번역 방지
  transcriptCount: number;                      // 요약 재생성 주기 계산용
}

export class SessionService {
  private sessions: Map<string, RoomSession> = new Map();

  /**
   * 룸 세션 가져오기 (없으면 생성)
   */
  getSession(roomCode: string): RoomSession {
    let session = this.sessions.get(roomCode);
    if (!session) {
      session = {
        contextWindow: [],
        summary: '',
        segmentSequence: 0,
        previousTranslations: {},
        translationInFlight: false,
        transcriptCount: 0,
      };
      this.sessions.set(roomCode, session);
    }
    return session;
  }

  /**
   * 한국어 세그먼트 추가 (슬라이딩 윈도우)
   */
  addSegment(roomCode: string, koreanText: string): number {
    const session = this.getSession(roomCode);
    session.contextWindow.push(koreanText);

    // Tier 1: 최근 5문장 유지
    if (session.contextWindow.length > 5) {
      session.contextWindow.shift();
    }

    session.segmentSequence++;
    session.transcriptCount++;

    return session.segmentSequence;
  }

  /**
   * 최근 컨텍스트 조회 (최근 3문장)
   */
  getRecentContext(roomCode: string): string {
    const session = this.getSession(roomCode);
    return session.contextWindow.slice(-3).join('\n');
  }

  /**
   * 전체 컨텍스트 윈도우 텍스트
   */
  getFullContext(roomCode: string): string {
    const session = this.getSession(roomCode);
    return session.contextWindow.join('\n');
  }

  /**
   * 요약 업데이트
   */
  updateSummary(roomCode: string, summary: string): void {
    const session = this.getSession(roomCode);
    session.summary = summary;
  }

  /**
   * 요약 조회
   */
  getSummary(roomCode: string): string {
    const session = this.getSession(roomCode);
    return session.summary;
  }

  /**
   * 이전 번역 저장
   */
  updatePreviousTranslations(roomCode: string, translations: Record<string, string>): void {
    const session = this.getSession(roomCode);
    session.previousTranslations = { ...session.previousTranslations, ...translations };
  }

  /**
   * 이전 번역 조회
   */
  getPreviousTranslations(roomCode: string): Record<string, string> {
    const session = this.getSession(roomCode);
    return session.previousTranslations;
  }

  /**
   * 요약 재생성 필요 여부 (10 세그먼트마다)
   */
  shouldRegenerateSummary(roomCode: string): boolean {
    const session = this.getSession(roomCode);
    return session.transcriptCount % 10 === 0 && session.transcriptCount > 0;
  }

  /**
   * 번역 진행 중 상태
   */
  setTranslationInFlight(roomCode: string, inFlight: boolean): void {
    const session = this.getSession(roomCode);
    session.translationInFlight = inFlight;
  }

  isTranslationInFlight(roomCode: string): boolean {
    const session = this.getSession(roomCode);
    return session.translationInFlight;
  }

  /**
   * 시퀀스 번호 조회
   */
  getSequence(roomCode: string): number {
    const session = this.getSession(roomCode);
    return session.segmentSequence;
  }

  /**
   * 세션 삭제
   */
  removeSession(roomCode: string): void {
    this.sessions.delete(roomCode);
  }

  /**
   * 세션 존재 여부
   */
  hasSession(roomCode: string): boolean {
    return this.sessions.has(roomCode);
  }
}

// Singleton instance
export const sessionService = new SessionService();
