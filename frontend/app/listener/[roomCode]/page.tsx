"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useI18n } from "@/contexts/I18nContext";
import io from "socket.io-client";
import { getDisplayText } from "@/lib/text-display";
import styles from "./listener.module.css";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

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

interface Transcript {
  type?: string;
  text?: string;
  translations?: Record<string, string>;
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  isHistory?: boolean;
  korean?: string;
  english?: string;
  batchId?: string;
}

interface SocketData {
  roomId?: string;
  message?: string;
  speakerName?: string;
  sessionTitle?: string;
  availableLanguages?: string[];
  transcripts?: Transcript[];
  text?: string;
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  contextSummary?: string;
  isHistory?: boolean;
  korean?: string;
  english?: string;
  translations?: Record<string, string>;
  batchId?: string;
  roomSettings?: {
    roomTitle?: string;
    targetLanguagesArray?: string[];
    targetLanguages?: string | string[];
  };
}

export default function ListenerRoom() {
  const params = useParams();
  const router = useRouter();
  const { user, accessToken } = useAuth();
  const toast = useToast();
  const { t } = useI18n();

  const roomCode = (params.roomCode as string)?.toUpperCase();

  // State
  const [isJoined, setIsJoined] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fontSize, setFontSize] = useState("medium");
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([
    "en",
  ]);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);

  // Password state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const isJoinedRef = useRef(false);
  const roomPasswordRef = useRef<string>("");

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

  // Scroll detection - auto-pause when user scrolls up, resume when at bottom
  const handleScroll = useCallback(() => {
    if (!transcriptContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = transcriptContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    setAutoScroll(isNearBottom);
  }, []);

  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // ESC key to exit fullscreen
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleEscKey);
    return () => window.removeEventListener("keydown", handleEscKey);
  }, [isFullscreen]);

  // Page Visibility API - reconnect when tab becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("👁️ Page became visible, checking connection...");

        if (socketRef.current) {
          const isSocketConnected = socketRef.current.connected;
          console.log("🔌 Socket connected:", isSocketConnected, "isJoinedRef:", isJoinedRef.current);

          if (!isSocketConnected) {
            console.log("🔄 Socket disconnected, attempting to reconnect...");
            socketRef.current.connect();
          } else if (isJoinedRef.current) {
            // Socket is connected but we might have missed events, rejoin to be safe
            console.log("🔄 Rejoining room to ensure sync...");
            socketRef.current.emit("join-room", {
              roomId: roomCode,
              name: "Guest",
              password: roomPasswordRef.current || undefined,
            });
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [roomCode]);

  // Initialize socket
  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
      // join-room is handled by the useEffect below to avoid duplicate calls
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("Disconnected from server:", reason);
      setIsConnected(false);
    });

    socketRef.current.on("reconnect", (attemptNumber) => {
      console.log("Reconnected to server after", attemptNumber, "attempts");
      setIsConnected(true);

      // Rejoin room after reconnection - use ref to get current value
      if (isJoinedRef.current && socketRef.current) {
        console.log("🔄 Rejoining room after reconnection...");
        socketRef.current.emit("join-room", {
          roomId: roomCode,
          name: "Guest", // User name might not be available here
          password: roomPasswordRef.current || undefined,
        });
      }
    });

    socketRef.current.on("reconnect_attempt", (attemptNumber) => {
      console.log("Reconnection attempt:", attemptNumber);
    });

    socketRef.current.on("reconnect_failed", () => {
      console.log("Reconnection failed");
      alert("서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.");
    });

    socketRef.current.on("password-required", (data: SocketData) => {
      console.log("Password required for room:", data?.roomId || roomCode);
      setNeedsPassword(true);
      setPasswordError(""); // Clear any previous errors
    });

    socketRef.current.on("room-joined", (data: SocketData) => {
      console.log("✅ Room joined successfully:", data);
      setSpeakerName(data.speakerName || "");

      // Set session title (use roomTitle if available, otherwise use speakerName)
      const title =
        data.roomSettings?.roomTitle ||
        `${data.speakerName || "Speaker"}의 세션`;
      setSessionTitle(title);

      setIsJoined(true);
      isJoinedRef.current = true; // Update ref for reconnection handler
      setNeedsPassword(false);
      setPasswordError("");
      setPassword(""); // Clear password after successful join

      // Set available languages from room settings
      const targetLanguages =
        data.roomSettings?.targetLanguagesArray ||
        data.roomSettings?.targetLanguages;
      if (targetLanguages) {
        // targetLanguages might be a comma-separated string or an array
        let languages: string[];
        if (typeof targetLanguages === "string") {
          languages = targetLanguages
            .split(",")
            .map((lang: string) => lang.trim());
          console.log("📋 Parsed languages from string:", languages);
        } else if (Array.isArray(targetLanguages)) {
          languages = targetLanguages;
          console.log("📋 Using languages array:", languages);
        } else {
          languages = ["en"];
          console.warn(
            "⚠️ Invalid targetLanguages format, defaulting to ['en']"
          );
        }

        if (languages.length > 0) {
          setAvailableLanguages(languages);
          setSelectedLanguage(languages[0]);
        }
      }
    });

    // Listen for STT text - ULTRA SIMPLE
    socketRef.current.on("stt-text", (data: SocketData) => {
      setTranscripts((prev) => {
        const newTranscript = {
          type: "stt",
          text: data.text,
          timestamp: data.timestamp,
          isFinal: data.isFinal !== false,
        };

        // Partial: update last item if it's also partial
        if (!newTranscript.isFinal && prev.length > 0) {
          const lastItem = prev[prev.length - 1];
          if (lastItem.type === "stt" && !lastItem.isFinal) {
            return [...prev.slice(0, -1), newTranscript];
          }
        }

        // Final: replace last partial if exists, otherwise add new
        if (newTranscript.isFinal && prev.length > 0) {
          const lastItem = prev[prev.length - 1];
          if (lastItem.type === "stt" && !lastItem.isFinal) {
            return [...prev.slice(0, -1), newTranscript];
          }
        }

        // Add new transcript
        return [...prev, newTranscript];
      });
    });

    // Listen for translation-text (new system)
    socketRef.current.on("translation-text", (data: SocketData) => {
      // console.log(`[Listener] 🌐 Translation received:`, {
      //   language: data.targetLanguage,
      //   text: (data.text || "").substring(0, 50) + "...",
      //   isPartial: data.isPartial,
      //   isHistory: data.isHistory,
      // });

      setTranscripts((prev) => {
        const newTranscript = {
          type: "translation",
          targetLanguage: data.targetLanguage,
          text: data.text,
          originalText: data.originalText,
          isPartial: data.isPartial || false,
          contextSummary: data.contextSummary,
          timestamp: data.timestamp,
          isHistory: data.isHistory || false,
        };

        // Handle partial vs final translations
        if (newTranscript.isPartial) {
          // Update last partial translation for this language
          const lastIndex = prev.length - 1;
          if (
            lastIndex >= 0 &&
            prev[lastIndex].type === "translation" &&
            prev[lastIndex].targetLanguage === data.targetLanguage &&
            prev[lastIndex].isPartial
          ) {
            return [...prev.slice(0, -1), newTranscript];
          }
          return [...prev, newTranscript];
        } else {
          // Final translation: replace last partial if exists
          const lastIndex = prev.length - 1;
          if (
            lastIndex >= 0 &&
            prev[lastIndex].type === "translation" &&
            prev[lastIndex].targetLanguage === data.targetLanguage &&
            prev[lastIndex].isPartial
          ) {
            return [...prev.slice(0, -1), newTranscript];
          }
          return [...prev, newTranscript];
        }
      });
    });

    // Keep old translation-batch for backwards compatibility
    socketRef.current.on("translation-batch", (data: SocketData) => {
      // Don't split into sentences - keep as a single batch for better readability
      const newTranscript: Transcript = {
        type: "translation",
        korean: data.korean,
        english: data.english,
        translations:
          data.translations || (data.english ? { en: data.english } : {}),
        timestamp: data.timestamp,
        isHistory: data.isHistory || false,
        batchId: data.batchId,
      };

      setTranscripts((prev) => [...prev.slice(-99), newTranscript]);
    });

    socketRef.current.on("error", (data: SocketData) => {
      console.error("❌ Socket error:", data);
      if (data.message === "Incorrect password") {
        console.log("🔒 Incorrect password entered");
        setPasswordError("비밀번호가 올바르지 않습니다.");
        setNeedsPassword(true); // Show password modal again
      } else if (data.message === "Room not found") {
        console.log("⚠️ Room not found:", roomCode);
        alert("방을 찾을 수 없습니다.");
        router.push("/");
      } else {
        console.log("⚠️ Other error:", data.message);
        alert(data.message);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, router]);

  // Join room
  const joinRoom = useCallback(
    (pwd?: string) => {
      const name = user?.name || "Guest";
      const finalPassword = pwd !== undefined ? pwd : password;

      // Save password for reconnection
      if (finalPassword) {
        roomPasswordRef.current = finalPassword;
      }

      console.log("🔑 Attempting to join room:", {
        roomCode,
        name,
        hasPassword: !!finalPassword,
      });

      if (socketRef.current) {
        socketRef.current.emit("join-room", {
          roomId: roomCode,
          name,
          password: finalPassword,
        });
      }
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
  const handlePasswordSubmit = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    console.log("🔐 handlePasswordSubmit called");
    console.log("🔐 Password value:", password ? "***" : "(empty)");
    console.log("🔐 Socket connected:", !!socketRef.current);
    console.log("🔐 isConnected:", isConnected);

    if (!password.trim()) {
      console.log("❌ Password is empty");
      setPasswordError("비밀번호를 입력해주세요.");
      return;
    }

    console.log("🔐 Submitting password for room:", roomCode);
    setPasswordError("");
    joinRoom(password);
  };

  // Save recording
  const saveRecording = async () => {
    if (!user || !accessToken) {
      toast.error("로그인이 필요합니다");
      router.push("/login");
      return;
    }

    if (!roomCode) {
      toast.error("저장할 세션이 없습니다");
      return;
    }

    if (transcripts.length === 0) {
      toast.error("저장할 번역 내용이 없습니다");
      return;
    }

    const roomName = prompt(
      "세션 이름을 입력하세요",
      sessionTitle || `Session ${roomCode}`
    );
    if (!roomName) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          roomCode: roomCode,
          roomName,
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success("세션이 저장되었습니다");
      } else {
        toast.error(data.message || "저장에 실패했습니다");
      }
    } catch (error) {
      console.error("Save recording error:", error);
      toast.error("저장 중 오류가 발생했습니다");
    }
  };

  // Export transcripts
  const exportTranscripts = () => {
    const langName = LANGUAGE_MAP[selectedLanguage] || selectedLanguage;
    let data = `Session: ${
      sessionTitle || speakerName
    }\nRoom: ${roomCode}\nSpeaker: ${speakerName}\nLanguage: ${langName}\nDate: ${new Date().toLocaleString()}\n\n`;

    transcripts.forEach((item) => {
      if (item.type === "translation") {
        const timestamp = item.timestamp
          ? typeof item.timestamp === "string"
            ? parseInt(item.timestamp)
            : item.timestamp
          : Date.now();
        data += `[${formatTime(timestamp)}]\n`;

        // New translation-text format
        if (item.targetLanguage) {
          if (item.targetLanguage === selectedLanguage && !item.isPartial) {
            if (item.originalText) {
              data += `원문: ${item.originalText}\n`;
            }
            data += `${langName}: ${item.text}\n\n`;
          }
        } else {
          // Old translation-batch format
          data += `한국어: ${item.korean}\n`;
          const translation =
            item.translations?.[selectedLanguage] ||
            item.translations?.en ||
            item.english ||
            "";
          data += `${langName}: ${translation}\n\n`;
        }
      }
    });

    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript_${roomCode}_${selectedLanguage}_${
      new Date().toISOString().split("T")[0]
    }.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Password modal
  if (needsPassword && !isJoined) {
    console.log("🔒 Rendering password modal for room:", roomCode);
    console.log("🔒 Current password state:", password ? "***" : "(empty)");
    console.log(
      "🔒 Socket connected:",
      !!socketRef.current,
      "isConnected:",
      isConnected
    );

    return (
      <main className={styles.main}>
        <div
          className={styles.modalOverlay}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h2>🔒 {t("listener.passwordRequired")}</h2>
            <p>{t("listener.passwordRequiredDesc")}</p>
            <div className={styles.roomCodeBadge}>
              {t("listener.room")}: <strong>{roomCode}</strong>
            </div>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                placeholder={t("listener.passwordPlaceholder")}
                value={password}
                onChange={(e) => {
                  console.log("🔐 Password input changed");
                  setPassword(e.target.value);
                  setPasswordError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    console.log("🔐 Enter key pressed");
                    e.preventDefault();
                    handlePasswordSubmit(e);
                  }
                }}
                className={styles.input}
                autoFocus
              />
              {passwordError && <p className={styles.error}>{passwordError}</p>}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={(e) => {
                    console.log("❌ Cancel button clicked");
                    e.preventDefault();
                    router.push("/");
                  }}
                  className={styles.cancelBtn}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  onClick={(e) => {
                    console.log("✅ Submit button clicked");
                    handlePasswordSubmit(e);
                  }}
                  className={styles.submitBtn}
                >
                  {t("listener.enter")}
                </button>
              </div>
            </form>
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
              ← {t("common.back")}
            </button>
            <div className={styles.sessionInfo}>
              {sessionTitle && (
                <h1 className={styles.sessionTitle}>{sessionTitle}</h1>
              )}
              <div className={styles.roomInfo}>
                <span className={styles.roomLabel}>{t("listener.room")}:</span>
                <span className={styles.roomCode}>{roomCode}</span>
                {speakerName && (
                  <span className={styles.speaker}>| {speakerName}</span>
                )}
              </div>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.statusBadge}>
              <span
                className={isConnected ? styles.connected : styles.disconnected}
              >
                {isConnected ? `● ${t("common.connected")}` : `○ ${t("common.disconnected")}`}
              </span>
            </div>
          </div>
        </header>

        {/* Controls */}
        <div className={styles.controls}>
          <div className={styles.controlItem}>
            <label className={styles.label}>{t("listener.fontSize")}</label>
            <div className={styles.fontButtons}>
              <button
                onClick={() => setFontSize("small")}
                className={`${styles.fontBtn} ${
                  fontSize === "small" ? styles.active : ""
                }`}
              >
                {t("listener.fontSmall")}
              </button>
              <button
                onClick={() => setFontSize("medium")}
                className={`${styles.fontBtn} ${
                  fontSize === "medium" ? styles.active : ""
                }`}
              >
                {t("listener.fontMedium")}
              </button>
              <button
                onClick={() => setFontSize("large")}
                className={`${styles.fontBtn} ${
                  fontSize === "large" ? styles.active : ""
                }`}
              >
                {t("listener.fontLarge")}
              </button>
            </div>
          </div>

          {availableLanguages.length > 1 && (
            <div className={styles.controlItem}>
              <label className={styles.label}>{t("listener.language")}</label>
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
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={() => setAutoScroll(!autoScroll)}
            />
            <span>{t("listener.autoScroll")}</span>
          </label>

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={() => setShowOriginal(!showOriginal)}
            />
            <span>{t("listener.showOriginal")}</span>
          </label>

          <div className={styles.actionButtons}>
            {user && (
              <button
                onClick={saveRecording}
                className={styles.saveBtn}
                disabled={transcripts.length === 0}
                title={
                  transcripts.length === 0
                    ? t("listener.noContentToSave")
                    : t("listener.saveTranscript")
                }
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {t("common.save")}
              </button>
            )}

            <button onClick={exportTranscripts} className={styles.exportBtn}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("common.export")}
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={styles.fullscreenBtn}
              title={isFullscreen ? t("listener.exitFullscreen") : t("listener.fullscreen")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {isFullscreen ? (
                  <>
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Fullscreen exit button - Outside of transcript container */}
        {isFullscreen && (
          <button
            onClick={() => setIsFullscreen(false)}
            className={styles.fullscreenExitBtn}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
            {t("listener.exitFullscreen")}
          </button>
        )}

        {/* Transcripts */}
        <div
          ref={transcriptContainerRef}
          className={`${styles.transcriptContainer} ${styles[fontSize]} ${
            isFullscreen ? styles.fullscreen : ""
          }`}
        >
          {transcripts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>💬</div>
              <p className={styles.emptyTitle}>{t("listener.noTranscripts")}</p>
              <p className={styles.emptyText}>
                {t("listener.noTranscriptsDesc")}
              </p>
            </div>
          ) : (
            <>
              {transcripts
                .filter((item) => {
                  // Hide STT blocks - only show translations
                  if (item.type === "stt") return false;

                  // Hide partial translations
                  if (item.type === "translation" && item.isPartial)
                    return false;

                  // Filter by selected language (for new translation-text format)
                  if (item.type === "translation" && item.targetLanguage) {
                    return item.targetLanguage === selectedLanguage;
                  }

                  // Old translation-batch format - always show
                  return true;
                })
                .map((item, index) => (
                  <div key={index} className={styles.transcriptCard}>
                    {item.type === "translation" ? (
                      <>
                        <div className={styles.timestamp}>
                          {formatTime(
                            item.timestamp
                              ? typeof item.timestamp === "string"
                                ? parseInt(item.timestamp)
                                : item.timestamp
                              : Date.now()
                          )}
                        </div>
                        {/* New translation-text format */}
                        {item.targetLanguage ? (
                          <>
                            {showOriginal && item.originalText && (
                              <>
                                <div className={styles.korean}>
                                  {getDisplayText(item.originalText)}
                                </div>
                                <div className={styles.divider}></div>
                              </>
                            )}
                            <div className={styles.english}>
                              {getDisplayText(item.text || "")}
                            </div>
                          </>
                        ) : (
                          /* Old translation-batch format */
                          <>
                            {showOriginal && (
                              <>
                                <div className={styles.korean}>
                                  {getDisplayText(item.korean || "")}
                                </div>
                                <div className={styles.divider}></div>
                              </>
                            )}
                            <div className={styles.english}>
                              {getDisplayText(
                                item.translations?.[selectedLanguage] ||
                                  item.translations?.en ||
                                  item.english ||
                                  ""
                              )}
                            </div>
                          </>
                        )}
                      </>
                    ) : null}
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
