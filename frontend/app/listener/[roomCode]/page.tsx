"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useI18n } from "@/contexts/I18nContext";
import io from "socket.io-client";
import { getDisplayText } from "@/lib/text-display";
import styles from "./listener.module.css";
import { PasswordModal, ListenerMenu, LanguageSelector } from "./components";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

// All supported languages for listeners
const LANGUAGE_MAP: Record<string, string> = {
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
  ur: "اردو",
};

// Note: availableLanguages state is now used instead of static ALL_LANGUAGES
// to dynamically show only speaker-selected languages

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
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [showOriginal, setShowOriginal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>(["en"]);

  // Password state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const isJoinedRef = useRef(false);
  const roomPasswordRef = useRef<string>("");
  const isNearBottomRef = useRef(true); // Track if user is near bottom

  // Format timestamp
  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, []);

  // Auto scroll - only scroll if autoScroll is ON AND user is near the bottom
  useEffect(() => {
    if (autoScroll && isNearBottomRef.current && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, autoScroll]);

  // Scroll detection - track if user is near bottom (separate from autoScroll toggle)
  const handleScroll = useCallback(() => {
    if (!transcriptContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = transcriptContainerRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    isNearBottomRef.current = nearBottom;
  }, []);

  // 필터링 최적화: useMemo로 매 렌더링마다 필터링 방지
  const filteredTranscripts = useMemo(() => {
    return transcripts.filter((item) => {
      if (item.type !== "translation") return false;
      if (item.isPartial) return false;
      // segment/batch 모드: translations에 선택된 언어가 있으면 표시
      if (item.translations) {
        return !!item.translations[selectedLanguage];
      }
      // targetLanguage 모드 (레거시 호환)
      if (item.targetLanguage) {
        return item.targetLanguage === selectedLanguage;
      }
      return true;
    });
  }, [transcripts, selectedLanguage]);

  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showMenu && !target.closest(`.${styles.menuContainer}`)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showMenu]);

  // Page Visibility API - reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (socketRef.current) {
          const isSocketConnected = socketRef.current.connected;
          if (!isSocketConnected) {
            socketRef.current.connect();
          } else if (isJoinedRef.current) {
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
      setIsConnected(true);
    });

    socketRef.current.on("disconnect", () => {
      setIsConnected(false);
    });

    socketRef.current.on("reconnect", () => {
      setIsConnected(true);
      if (isJoinedRef.current && socketRef.current) {
        socketRef.current.emit("join-room", {
          roomId: roomCode,
          name: "Guest",
          password: roomPasswordRef.current || undefined,
        });
      }
    });

    socketRef.current.on("reconnect_failed", () => {
      toast.error("서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.");
    });

    socketRef.current.on("password-required", () => {
      setNeedsPassword(true);
      setPasswordError("");
    });

    socketRef.current.on("room-joined", (data: SocketData) => {
      setSpeakerName(data.speakerName || "");
      const title = data.roomSettings?.roomTitle || `${data.speakerName || "Speaker"}의 세션`;
      setSessionTitle(title);
      setIsJoined(true);
      isJoinedRef.current = true;
      setNeedsPassword(false);
      setPasswordError("");
      setPassword("");

      // Set available languages from room settings (speaker's selection)
      const roomLangs = data.roomSettings?.targetLanguagesArray
        || (typeof data.roomSettings?.targetLanguages === 'string'
            ? data.roomSettings.targetLanguages.split(',')
            : data.roomSettings?.targetLanguages)
        || ['en'];
      setAvailableLanguages(roomLangs);

      // If current selected language is not available, switch to first available
      if (!roomLangs.includes(selectedLanguage)) {
        setSelectedLanguage(roomLangs[0] || 'en');
      }
    });

    // New segment event (primary)
    socketRef.current.on("segment", (data: any) => {
      const newTranscript: Transcript = {
        type: "translation",
        korean: data.korean,
        translations: data.translations || {},
        timestamp: String(data.timestamp),
        isHistory: false,
        batchId: data.id,
      };
      setTranscripts((prev) => [...prev.slice(-99), newTranscript]);
    });

    // Backward compat: translation-batch (also sent by server for history)
    socketRef.current.on("translation-batch", (data: SocketData) => {
      const newTranscript: Transcript = {
        type: "translation",
        korean: data.korean,
        english: data.english,
        translations: data.translations || (data.english ? { en: data.english } : {}),
        timestamp: data.timestamp,
        isHistory: data.isHistory || false,
        batchId: data.batchId,
      };
      setTranscripts((prev) => [...prev.slice(-99), newTranscript]);
    });

    socketRef.current.on("error", (data: SocketData) => {
      if (data.message === "Incorrect password") {
        setPasswordError("비밀번호가 올바르지 않습니다.");
        setNeedsPassword(true);
      } else if (data.message === "Room not found") {
        toast.error("방을 찾을 수 없습니다.");
        router.push("/");
      } else {
        toast.error(data.message || "오류가 발생했습니다.");
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomCode, router, toast]);

  // Join room
  const joinRoom = useCallback(
    (pwd?: string) => {
      const name = user?.name || "Guest";
      const finalPassword = pwd !== undefined ? pwd : password;
      if (finalPassword) {
        roomPasswordRef.current = finalPassword;
      }
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

  // Save recording
  const saveRecording = async () => {
    if (!user || !accessToken) {
      toast.error("로그인이 필요합니다");
      router.push("/login");
      return;
    }
    if (!roomCode || transcripts.length === 0) {
      toast.error("저장할 내용이 없습니다");
      return;
    }
    const roomName = prompt("세션 이름을 입력하세요", sessionTitle || `Session ${roomCode}`);
    if (!roomName) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ roomCode, roomName }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success("세션이 저장되었습니다");
      } else {
        toast.error(data.message || "저장에 실패했습니다");
      }
    } catch {
      toast.error("저장 중 오류가 발생했습니다");
    }
  };

  // Export transcripts
  const exportTranscripts = () => {
    const langName = LANGUAGE_MAP[selectedLanguage] || selectedLanguage;
    let data = `Session: ${sessionTitle || speakerName}\nRoom: ${roomCode}\nLanguage: ${langName}\nDate: ${new Date().toLocaleString()}\n\n`;

    transcripts.forEach((item) => {
      if (item.type === "translation") {
        const timestamp = item.timestamp
          ? typeof item.timestamp === "string" ? parseInt(item.timestamp) : item.timestamp
          : Date.now();
        data += `[${formatTime(timestamp)}]\n`;

        if (item.targetLanguage) {
          if (item.targetLanguage === selectedLanguage && !item.isPartial) {
            if (showOriginal && item.originalText) {
              data += `원문: ${item.originalText}\n`;
            }
            data += `${langName}: ${item.text}\n\n`;
          }
        } else {
          if (showOriginal) {
            data += `한국어: ${item.korean}\n`;
          }
          const translation = item.translations?.[selectedLanguage] || item.translations?.en || item.english || "";
          data += `${langName}: ${translation}\n\n`;
        }
      }
    });

    const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript_${roomCode}_${selectedLanguage}_${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Password modal
  if (needsPassword && !isJoined) {
    return (
      <PasswordModal
        roomCode={roomCode}
        onSubmit={(pwd) => joinRoom(pwd)}
        error={passwordError}
      />
    );
  }

  // Main UI
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <button onClick={() => router.push("/")} className={styles.iconBtn} aria-label={t("common.back")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div className={styles.headerCenter}>
            <span className={styles.roomCodeTitle}>{roomCode}</span>
            <span className={`${styles.statusDot} ${isConnected ? styles.online : styles.offline}`} />
          </div>

          <div className={styles.headerActions}>
            {/* Language Selector - Primary Action */}
            <LanguageSelector
              selectedLanguage={selectedLanguage}
              availableLanguages={availableLanguages}
              languageMap={LANGUAGE_MAP}
              onLanguageChange={setSelectedLanguage}
            />

            {/* Show Original Toggle Button */}
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className={`${styles.iconBtn} ${showOriginal ? styles.active : ''}`}
              aria-label={showOriginal ? "원문 숨기기" : "원문 보기"}
              title={showOriginal ? "원문 숨기기" : "원문 보기"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {showOriginal ? (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                ) : (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                )}
              </svg>
            </button>

            {/* Menu Button */}
            <div className={styles.menuContainer}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className={`${styles.iconBtn} ${showMenu ? styles.active : ''}`}
                aria-label="메뉴"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              <ListenerMenu
                isOpen={showMenu}
                fontSize={fontSize}
                autoScroll={autoScroll}
                showSaveButton={!!user}
                hasTrans={transcripts.length > 0}
                onFontSizeChange={setFontSize}
                onAutoScrollChange={setAutoScroll}
                onExport={exportTranscripts}
                onSave={saveRecording}
              />
            </div>
          </div>
        </header>

        {/* Transcripts */}
        <div ref={transcriptContainerRef} className={`${styles.transcriptContainer} ${styles[fontSize]}`}>
          {filteredTranscripts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIconWrapper}>
                <div className={styles.emptyIconPulse} />
                <div className={styles.emptyIcon}>🎧</div>
              </div>
              <p className={styles.emptyTitle}>{t("listener.noTranscripts")}</p>
              <p className={styles.emptyText}>{t("listener.noTranscriptsDesc")}</p>
              <div className={styles.currentLangBadge}>
                <span className={styles.badgeLabel}>번역 언어</span>
                <span className={styles.badgeLang}>{LANGUAGE_MAP[selectedLanguage] || selectedLanguage}</span>
              </div>
            </div>
          ) : (
            <>
              {filteredTranscripts.map((item, index) => (
                  <div key={index} className={styles.transcriptCard}>
                    <div className={styles.timestamp}>
                      {formatTime(
                        item.timestamp
                          ? typeof item.timestamp === "string" ? parseInt(item.timestamp) : item.timestamp
                          : Date.now()
                      )}
                    </div>
                    {item.targetLanguage ? (
                      <>
                        {showOriginal && item.originalText && (
                          <>
                            <div className={styles.originalText}>{getDisplayText(item.originalText)}</div>
                            <div className={styles.divider}></div>
                          </>
                        )}
                        <div className={styles.translatedText}>{getDisplayText(item.text || "")}</div>
                      </>
                    ) : (
                      <>
                        {showOriginal && item.korean && (
                          <>
                            <div className={styles.originalText}>{getDisplayText(item.korean)}</div>
                            <div className={styles.divider}></div>
                          </>
                        )}
                        <div className={styles.translatedText}>
                          {getDisplayText(
                            item.translations?.[selectedLanguage] || item.translations?.en || item.english || ""
                          )}
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
