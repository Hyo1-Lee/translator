"use client";

import styles from "./StatusIndicator.module.css";

interface StatusIndicatorProps {
  isOnline: boolean;
  showLabel?: boolean;
  size?: "small" | "medium";
}

/**
 * Connection status indicator (green/gray dot with optional label).
 */
export default function StatusIndicator({
  isOnline,
  showLabel = false,
  size = "small",
}: StatusIndicatorProps) {
  return (
    <span className={`${styles.statusIndicator} ${styles[size]}`}>
      <span
        className={`${styles.dot} ${isOnline ? styles.online : styles.offline}`}
      />
      {showLabel && (
        <span className={styles.label}>
          {isOnline ? "연결됨" : "연결 끊김"}
        </span>
      )}
    </span>
  );
}
