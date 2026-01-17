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
      <div className={styles.recordingControls}>
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
      </div>
    );
  }

  return (
    <div className={styles.recordingControls}>
      {recordingState === "idle" ? (
        <button
          onClick={onStart}
          className={styles.playButton}
          disabled={!roomId || !isConnected}
          title="녹음 시작"
          aria-label="녹음 시작"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      ) : recordingState === "recording" ? (
        <>
          <button
            onClick={onPause}
            className={styles.pauseButton}
            title="일시정지"
            aria-label="녹음 일시정지"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
          <button
            onClick={onStop}
            className={styles.stopButton}
            title="정지"
            aria-label="녹음 정지"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
            </svg>
          </button>
        </>
      ) : (
        <>
          <button
            onClick={onResume}
            className={styles.playButton}
            title="재개"
            aria-label="녹음 재개"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            onClick={onStop}
            className={styles.stopButton}
            title="정지"
            aria-label="녹음 정지"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
