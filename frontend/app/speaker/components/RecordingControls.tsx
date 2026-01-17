"use client";

import { RecordingState } from "../types";
import styles from "../speaker.module.css";

interface RecordingControlsProps {
  recordingState: RecordingState;
  roomId: string;
  isConnected: boolean;
  isReadOnly: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export default function RecordingControls({
  recordingState,
  roomId,
  isConnected,
  isReadOnly,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordingControlsProps) {
  if (isReadOnly) {
    return (
      <div className={styles.readOnlyBadge}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        기록 보기 모드 (종료된 세션)
      </div>
    );
  }

  return (
    <div className={styles.recordingControls}>
      {recordingState === "idle" ? (
        <button
          onClick={onStart}
          className={styles.recordButton}
          disabled={!roomId || !isConnected}
          title="녹음 시작"
        >
          <span className={styles.recordIcon}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </span>
          녹음 시작
        </button>
      ) : recordingState === "recording" ? (
        <div className={styles.recordingActive}>
          <span className={styles.recordingIndicator}>
            <span className={styles.recordingDot} />
            녹음 중
          </span>
          <div className={styles.recordingButtons}>
            <button onClick={onPause} className={styles.pauseBtn} title="일시정지">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
            <button onClick={onStop} className={styles.stopBtn} title="정지">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.recordingActive}>
          <span className={styles.recordingIndicator}>
            <span className={styles.pausedDot} />
            일시정지
          </span>
          <div className={styles.recordingButtons}>
            <button onClick={onResume} className={styles.resumeBtn} title="재개">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button onClick={onStop} className={styles.stopBtn} title="정지">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
