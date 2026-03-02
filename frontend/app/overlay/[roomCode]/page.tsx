"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import io from "socket.io-client";
import styles from "./overlay.module.css";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

interface SubtitleLine {
  korean: string;
  translation: string;
  timestamp: number;
}

export default function OverlayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomCode = (params.roomCode as string)?.toUpperCase();

  const lang = searchParams.get("lang") || "en";
  const fontSize = parseInt(searchParams.get("fontSize") || "32", 10);
  const showOriginal = searchParams.get("showOriginal") === "true";

  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", {
        roomId: roomCode,
        name: "OBS Overlay",
      });
    });

    socket.on("segment", (data: any) => {
      const translation = data.translations?.[lang] || "";
      if (!translation) return;

      setLines((prev) => [
        ...prev.slice(-2),
        {
          korean: data.korean || "",
          translation,
          timestamp: data.timestamp || Date.now(),
        },
      ]);
    });

    socket.on("translation-batch", (data: any) => {
      if (data.isHistory) return;
      const translation = data.translations?.[lang] || data.english || "";
      if (!translation) return;

      setLines((prev) => [
        ...prev.slice(-2),
        {
          korean: data.korean || "",
          translation,
          timestamp: data.timestamp || Date.now(),
        },
      ]);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode, lang]);

  const displayLines = lines.slice(-3);

  return (
    <div className={styles.overlay}>
      <div className={styles.subtitleArea}>
        {displayLines.map((line, i) => {
          const fromEnd = displayLines.length - 1 - i;
          const opClass =
            fromEnd === 0
              ? styles.line0
              : fromEnd === 1
                ? styles.line1
                : styles.line2;

          return (
            <div
              key={line.timestamp}
              className={`${styles.line} ${opClass}`}
            >
              {showOriginal && line.korean && (
                <div
                  className={styles.original}
                  style={{ fontSize: `${Math.round(fontSize * 0.75)}px` }}
                >
                  {line.korean}
                </div>
              )}
              <div
                className={styles.translated}
                style={{ fontSize: `${fontSize}px` }}
              >
                {line.translation}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
