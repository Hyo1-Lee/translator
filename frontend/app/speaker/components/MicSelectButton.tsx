"use client";

import styles from "../speaker.module.css";

interface MicSelectButtonProps {
  currentMicLabel: string;
  hasExternalMic: boolean;
  isRecording: boolean;
  onClick: () => void;
}

export default function MicSelectButton({
  currentMicLabel,
  hasExternalMic,
  isRecording,
  onClick,
}: MicSelectButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`${styles.micSelectButton} ${hasExternalMic ? styles.hasExternal : ""}`}
      disabled={isRecording}
    >
      <span className={styles.micSelectButtonIcon}>
        <svg
          width="18"
          height="18"
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
      <span className={styles.micSelectButtonText}>{currentMicLabel}</span>
      <span className={styles.micSelectButtonArrow}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </button>
  );
}
