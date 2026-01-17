"use client";

import styles from "../speaker.module.css";

interface AudioLevelMeterProps {
  audioLevel: number;
  activeMicLabel: string | null;
  micMismatch: boolean;
  isRecording: boolean;
}

export default function AudioLevelMeter({
  audioLevel,
  activeMicLabel,
  micMismatch,
  isRecording,
}: AudioLevelMeterProps) {
  if (!isRecording) return null;

  const displayLabel = activeMicLabel
    ? activeMicLabel.length > 25
      ? activeMicLabel.substring(0, 25) + "..."
      : activeMicLabel
    : "마이크";

  return (
    <div className={styles.audioLevel}>
      <div className={styles.audioLevelHeader}>
        <span
          className={styles.audioLevelLabel}
          style={micMismatch ? { color: "#f59e0b" } : undefined}
        >
          {micMismatch ? "⚠️ " : "🎤 "}
          {displayLabel}
        </span>
        <span className={styles.audioLevelPercent}>{audioLevel}%</span>
      </div>
      <div className={styles.audioLevelBar}>
        <div
          className={styles.audioLevelFill}
          style={{
            width: `${audioLevel}%`,
            backgroundColor:
              audioLevel > 70
                ? "#ef4444"
                : audioLevel > 30
                ? "#22c55e"
                : "#64748b",
          }}
        />
      </div>
    </div>
  );
}
