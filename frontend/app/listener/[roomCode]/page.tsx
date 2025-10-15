"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import io from "socket.io-client";
import styles from "../listener.module.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const STORAGE_KEY = "listener_preferences";

// Target languages
const TARGET_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文 (简体)" },
  { code: "zh-TW", name: "中文 (繁體)" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية" },
  { code: "pt", name: "Português" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ภาษาไทย" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "hi", name: "हिन्दी" }
];

export default function ListenerRoom() {
  const params = useParams();
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const roomCode = (params.roomCode as string)?.toUpperCase();

  // State
  const [isJoined, setIsJoined] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [listenerName, setListenerName] = useState("");
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fontSize, setFontSize] = useState("medium");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);

  // Password state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const socketRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Load preferences
  const loadPreferences = useCallback(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }
    return {};
  }, []);

  // Save preferences
  const savePreferences = useCallback((prefs: any) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  }, []);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, autoScroll]);

  // Initialize socket
  useEffect(() => {
    const prefs = loadPreferences();
    setListenerName(prefs.listenerName || "");
    setAutoScroll(prefs.autoScroll !== false);
    setFontSize(prefs.fontSize || "medium");
    setSelectedLanguage(prefs.selectedLanguage || "en");

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
    });

    socketRef.current.on("stt-text", (data: any) => {
      if (!data.isHistory) {
        setTranscripts((prev) => [
          ...prev.slice(-99),
          {
            type: "stt",
            text: data.text,
            timestamp: data.timestamp,
          },
        ]);
      }
    });

    socketRef.current.on("translation-batch", (data: any) => {
      setTranscripts((prev) => [
        ...prev.slice(-99),
        {
          type: "translation",
          korean: data.korean,
          english: data.english,
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
        router.push("/listener");
      } else {
        alert(data.message);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomCode, router, loadPreferences]);

  // Join room
  const joinRoom = useCallback((pwd?: string) => {
    const name = listenerName || user?.name || "Guest";
    setListenerName(name);

    const prefs = loadPreferences();
    savePreferences({
      ...prefs,
      listenerName: name,
      autoScroll,
      fontSize,
      selectedLanguage,
    });

    socketRef.current.emit("join-room", {
      roomId: roomCode,
      name,
      password: pwd || password,
    });
  }, [roomCode, listenerName, user, password, autoScroll, fontSize, selectedLanguage, loadPreferences, savePreferences]);

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

  // Save transcript
  const saveTranscript = async () => {
    if (!user) {
      if (confirm("스크립트를 저장하려면 로그인이 필요합니다. 로그인 페이지로 이동하시겠습니까?")) {
        router.push("/login");
      }
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/dashboard/transcripts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          roomCode,
          title: `${speakerName} - ${new Date().toLocaleDateString()}`,
          content: JSON.stringify(transcripts),
        }),
      });

      if (response.ok) {
        alert("스크립트가 저장되었습니다!");
      } else {
        alert("스크립트 저장에 실패했습니다.");
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("스크립트 저장 중 오류가 발생했습니다.");
    }
  };

  // Export transcripts
  const exportTranscripts = () => {
    let data = `Room: ${roomCode}\nSpeaker: ${speakerName}\nDate: ${new Date().toLocaleString()}\n\n`;

    transcripts.forEach((item) => {
      if (item.type === "translation") {
        data += `[Korean] ${item.korean}\n[English] ${item.english}\n\n`;
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

  // Change language
  const changeLanguage = (code: string) => {
    setSelectedLanguage(code);
    const prefs = loadPreferences();
    savePreferences({ ...prefs, selectedLanguage: code });
    setShowLanguageMenu(false);
  };

  // Password modal
  if (needsPassword && !isJoined) {
    return (
      <main className={styles.main}>
        <div className={styles.passwordModal}>
          <div className={styles.passwordBox}>
            <h2>비밀번호가 필요합니다</h2>
            <p>이 방은 비밀번호로 보호되어 있습니다</p>
            <div className={styles.roomCodeDisplay}>
              <span>방 코드:</span>
              <strong>{roomCode}</strong>
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
            <div className={styles.passwordActions}>
              <button onClick={() => router.push("/listener")} className={styles.cancelButton}>
                취소
              </button>
              <button onClick={handlePasswordSubmit} className={styles.submitButton}>
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
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button onClick={() => router.push(user ? "/dashboard" : "/")} className={styles.backButton}>
              ← {user ? "대시보드" : "홈"}
            </button>
            <div className={styles.roomInfo}>
              <span className={styles.roomLabel}>방:</span>
              <span className={styles.roomCodeText}>{roomCode}</span>
              <span className={styles.speakerLabel}>{speakerName}</span>
            </div>
          </div>
          <div className={styles.connectionStatus}>
            <span className={isConnected ? styles.connected : styles.disconnected}>
              {isConnected ? "● 연결됨" : "○ 연결 끊김"}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>언어:</label>
            <div className={styles.languageSelector}>
              <button onClick={() => setShowLanguageMenu(!showLanguageMenu)} className={styles.languageButton}>
                {TARGET_LANGUAGES.find((l) => l.code === selectedLanguage)?.name || "English"}
                <span className={styles.arrow}>▼</span>
              </button>
              {showLanguageMenu && (
                <div className={styles.languageMenu}>
                  {TARGET_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => changeLanguage(lang.code)}
                      className={`${styles.languageOption} ${selectedLanguage === lang.code ? styles.active : ""}`}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>글자 크기:</label>
            <div className={styles.fontSizeButtons}>
              {["small", "medium", "large"].map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={`${styles.fontSizeButton} ${fontSize === size ? styles.active : ""}`}
                >
                  {size === "small" ? "A" : size === "medium" ? "A+" : "A++"}
                </button>
              ))}
            </div>
          </div>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll(!autoScroll)} />
            자동 스크롤
          </label>

          <div className={styles.actionButtons}>
            <button onClick={exportTranscripts} className={styles.exportButton}>
              📥 내보내기
            </button>
            <button onClick={saveTranscript} className={styles.saveButton}>
              💾 저장
            </button>
          </div>
        </div>

        {/* Transcripts */}
        <div className={`${styles.transcriptContainer} ${styles[fontSize]}`}>
          {transcripts.length === 0 ? (
            <div className={styles.emptyState}>
              <p>아직 번역 내용이 없습니다.</p>
              <p>연사가 발언을 시작하면 여기에 표시됩니다.</p>
            </div>
          ) : (
            transcripts.map((item, index) => (
              <div key={index} className={styles.transcriptItem}>
                {item.type === "translation" && (
                  <>
                    <div className={styles.originalText}>{item.korean}</div>
                    <div className={styles.translatedText}>
                      {selectedLanguage === "en" ? item.english : `[${selectedLanguage}] ${item.english}`}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </main>
  );
}
