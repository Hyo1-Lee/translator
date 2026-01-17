"use client";

import { getDisplayText } from "@/lib/text-display";
import styles from "./TranscriptCard.module.css";

interface TranscriptCardProps {
  originalText?: string;
  translatedText: string;
  timestamp?: number;
  showOriginal?: boolean;
  showTimestamp?: boolean;
}

/**
 * Card component for displaying translation entries.
 * Used in both Speaker and Listener pages.
 */
export default function TranscriptCard({
  originalText,
  translatedText,
  timestamp,
  showOriginal = false,
  showTimestamp = true,
}: TranscriptCardProps) {
  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className={styles.transcriptCard}>
      {showTimestamp && timestamp && (
        <div className={styles.timestamp}>{formatTime(timestamp)}</div>
      )}
      {showOriginal && originalText && (
        <>
          <div className={styles.originalText}>{getDisplayText(originalText)}</div>
          <div className={styles.divider} />
        </>
      )}
      <div className={styles.translatedText}>{getDisplayText(translatedText)}</div>
    </div>
  );
}
