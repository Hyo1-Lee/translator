/**
 * SessionService - 인메모리 세션 관리 (번역 문맥)
 *
 * 룸별 인메모리 상태를 유지하여 번역 품질 향상.
 */

export interface RoomSession {
  contextWindow: string[];                                // 최근 4 한국어 세그먼트
  summary: string;                                        // 현재 요약
  segmentSequence: number;                                // 순서 카운터
  recentTranslationHistory: Record<string, string>[];     // 최근 3개 번역 (언어별)
  transcriptCount: number;                                // 요약 재생성 주기 계산용
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
        recentTranslationHistory: [],
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

    // 최근 4문장 유지
    if (session.contextWindow.length > 4) {
      session.contextWindow.shift();
    }

    session.segmentSequence++;
    session.transcriptCount++;

    return session.segmentSequence;
  }

  /**
   * 보정된 한국어로 마지막 세그먼트 교체
   */
  updateCorrectedSegment(roomCode: string, correctedKorean: string): void {
    const session = this.getSession(roomCode);
    if (session.contextWindow.length > 0) {
      session.contextWindow[session.contextWindow.length - 1] = correctedKorean;
    }
  }

  /**
   * 최근 컨텍스트 조회 (최근 4문장)
   */
  getRecentContext(roomCode: string): string {
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
   * 번역 히스토리 추가 (최근 3개 유지)
   */
  addTranslationHistory(roomCode: string, translations: Record<string, string>): void {
    const session = this.getSession(roomCode);
    session.recentTranslationHistory.push(translations);
    if (session.recentTranslationHistory.length > 3) {
      session.recentTranslationHistory.shift();
    }
  }

  /**
   * 최근 번역 히스토리 조회 (최근 3개)
   */
  getRecentTranslationHistory(roomCode: string): Record<string, string>[] {
    const session = this.getSession(roomCode);
    return session.recentTranslationHistory;
  }

  /**
   * 요약 재생성 필요 여부 (15 세그먼트마다)
   */
  shouldRegenerateSummary(roomCode: string): boolean {
    const session = this.getSession(roomCode);
    return session.transcriptCount % 15 === 0 && session.transcriptCount > 0;
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
