"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import io from "socket.io-client";
import styles from "./listener.module.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const STORAGE_KEY = "listener_preferences";

const LANGUAGE_MAP: Record<string, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
  "zh-TW": "繁體中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  ar: "العربية",
  pt: "Português",
  vi: "Tiếng Việt",
  th: "ไทย",
  id: "Bahasa Indonesia",
  hi: "हिन्दी",
};

export default function ListenerRoom() {
  const params = useParams();
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const roomCode = (params.roomCode as string)?.toUpperCase();

  // State
  const [isJoined, setIsJoined] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fontSize, setFontSize] = useState("medium");
  const [availableLanguages, setAvailableLanguages] = useState<string[]>(['en']);
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  // Password state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const socketRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Format timestamp
  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, []);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, autoScroll]);

  // Initialize socket
  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
    });

    socketRef.current.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
    });

    socketRef.current.on("password-required", () => {
      console.log("Password required");
      setNeedsPassword(true);
    });

    socketRef.current.on("room-joined", (data: any) => {
      console.log("Room joined:", data);
      setSpeakerName(data.speakerName);
      setIsJoined(true);
      setNeedsPassword(false);
      setPasswordError("");

      // Set available languages from room settings
      if (data.roomSettings?.targetLanguages && data.roomSettings.targetLanguages.length > 0) {
        setAvailableLanguages(data.roomSettings.targetLanguages);
        setSelectedLanguage(data.roomSettings.targetLanguages[0]);
      }
    });

    socketRef.current.on("translation-batch", (data: any) => {
      setTranscripts((prev) => [
        ...prev.slice(-99),
        {
          type: "translation",
          korean: data.korean,
          translations: data.translations || { en: data.english },
          timestamp: data.timestamp,
          isHistory: data.isHistory,
        },
      ]);
    });

    socketRef.current.on("error", (data: any) => {
      console.error("Socket error:", data);
      if (data.message === "Incorrect password") {
        setPasswordError("비밀번호가 올바르지 않습니다.");
      } else if (data.message === "Room not found") {
        alert("방을 찾을 수 없습니다.");
        router.push("/");
      } else {
        alert(data.message);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomCode, router]);

  // Join room
  const joinRoom = useCallback(
    (pwd?: string) => {
      const name = user?.name || "Guest";

      socketRef.current.emit("join-room", {
        roomId: roomCode,
        name,
        password: pwd || password,
      });
    },
    [roomCode, user, password]
  );

  // Auto-join on mount
  useEffect(() => {
    if (isConnected && !isJoined && !needsPassword) {
      joinRoom();
    }
  }, [isConnected, isJoined, needsPassword, joinRoom]);

  // Handle password submit
  const handlePasswordSubmit = () => {
    if (!password.trim()) {
      setPasswordError("비밀번호를 입력해주세요.");
      return;
    }
    setPasswordError("");
    joinRoom(password);
  };

  // Export transcripts
  const exportTranscripts = () => {
    let data = `Room: ${roomCode}\nSpeaker: ${speakerName}\nDate: ${new Date().toLocaleString()}\n\n`;

    transcripts.forEach((item) => {
      if (item.type === "translation") {
        data += `[${formatTime(item.timestamp)}]\n`;
        data += `한국어: ${item.korean}\n`;
        const translation = item.translations?.[selectedLanguage] || item.translations?.en || "";
        data += `${LANGUAGE_MAP[selectedLanguage] || selectedLanguage}: ${translation}\n\n`;
      }
    });

    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript_${roomCode}_${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Password modal
  if (needsPassword && !isJoined) {
    return (
      <main className={styles.main}>
        <div className={styles.modalOverlay}>
          <div className={styles.modalBox}>
            <h2>🔒 비밀번호 필요</h2>
            <p>이 방은 비밀번호로 보호되어 있습니다</p>
            <div className={styles.roomCodeBadge}>
              방 코드: <strong>{roomCode}</strong>
            </div>
            <input
              type="password"
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError("");
              }}
              onKeyPress={(e) => e.key === "Enter" && handlePasswordSubmit()}
              className={styles.input}
            />
            {passwordError && <p className={styles.error}>{passwordError}</p>}
            <div className={styles.modalActions}>
              <button onClick={() => router.push("/")} className={styles.cancelBtn}>
                취소
              </button>
              <button onClick={handlePasswordSubmit} className={styles.submitBtn}>
                입장
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Main UI
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button onClick={() => router.push("/")} className={styles.backBtn}>
              ← 나가기
            </button>
            <div className={styles.roomInfo}>
              <span className={styles.roomLabel}>방:</span>
              <span className={styles.roomCode}>{roomCode}</span>
              {speakerName && <span className={styles.speaker}>| {speakerName}</span>}
            </div>
          </div>
          <div className={styles.statusBadge}>
            <span className={isConnected ? styles.connected : styles.disconnected}>
              {isConnected ? "● 연결됨" : "○ 연결 끊김"}
            </span>
          </div>
        </header>

        {/* Controls */}
        <div className={styles.controls}>
          <div className={styles.controlItem}>
            <label className={styles.label}>글자 크기</label>
            <div className={styles.fontButtons}>
              <button
                onClick={() => setFontSize("small")}
                className={`${styles.fontBtn} ${fontSize === "small" ? styles.active : ""}`}
              >
                작게
              </button>
              <button
                onClick={() => setFontSize("medium")}
                className={`${styles.fontBtn} ${fontSize === "medium" ? styles.active : ""}`}
              >
                보통
              </button>
              <button
                onClick={() => setFontSize("large")}
                className={`${styles.fontBtn} ${fontSize === "large" ? styles.active : ""}`}
              >
                크게
              </button>
            </div>
          </div>

          {availableLanguages.length > 1 && (
            <div className={styles.controlItem}>
              <label className={styles.label}>번역 언어</label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className={styles.languageSelect}
              >
                {availableLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_MAP[lang] || lang}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className={styles.checkbox}>
            <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll(!autoScroll)} />
            <span>자동 스크롤</span>
          </label>

          <button onClick={exportTranscripts} className={styles.exportBtn}>
            📥 내보내기
          </button>
        </div>

        {/* Transcripts */}
        <div className={`${styles.transcriptContainer} ${styles[fontSize]}`}>
          {transcripts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>💬</div>
              <p className={styles.emptyTitle}>아직 번역 내용이 없습니다</p>
              <p className={styles.emptyText}>연사가 발언을 시작하면 여기에 실시간으로 표시됩니다</p>
            </div>
          ) : (
            <>
              {transcripts.map((item, index) => (
                <div key={index} className={styles.transcriptCard}>
                  {item.type === "translation" && (
                    <>
                      <div className={styles.timestamp}>{formatTime(item.timestamp)}</div>
                      <div className={styles.korean}>{item.korean}</div>
                      <div className={styles.divider}></div>
                      <div className={styles.english}>
                        {item.translations?.[selectedLanguage] || item.translations?.en || ""}
                      </div>
                    </>
                  )}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
