"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import io from "socket.io-client";
import QRCode from "qrcode";
import styles from "./speaker.module.css";

// Constants
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";
const STORAGE_KEY = "speaker_room_info";

// Prompt template options
const PROMPT_TEMPLATES = [
  { value: "general", label: "일반 대화" },
  { value: "church", label: "교회/예배" },
  { value: "lecture", label: "강의/강연" },
  { value: "meeting", label: "회의/비즈니스" },
  { value: "medical", label: "의료/건강" },
  { value: "legal", label: "법률/계약" },
  { value: "education", label: "교육/학습" },
  { value: "tech", label: "기술/IT" },
  { value: "custom", label: "사용자 지정" }
];

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

interface RoomSettings {
  roomTitle: string;
  promptTemplate: string;
  customPrompt: string;
  targetLanguages: string[];
  password: string;
  maxListeners: number;
}

export default function Speaker() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // State management
  const [roomId, setRoomId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [status, setStatus] = useState("준비");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [roomSettings, setRoomSettings] = useState<RoomSettings>({
    roomTitle: "",
    promptTemplate: "general",
    customPrompt: "",
    targetLanguages: ["en"],
    password: "",
    maxListeners: 100
  });

  // Refs
  const socketRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Generate QR code
  const generateQRCode = useCallback(async (roomCode: string) => {
    const url = `${FRONTEND_URL}/listener/${roomCode}`;
    try {
      const qrUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: "#1e293b",
          light: "#ffffff"
        }
      });
      setQrCodeUrl(qrUrl);
    } catch (error) {
      console.error("QR code generation error:", error);
    }
  }, []);

  // Load saved room info from localStorage
  const loadSavedRoom = useCallback(() => {
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
    return null;
  }, []);

  // Save room info to localStorage
  const saveRoomInfo = useCallback((roomCode: string, name: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          roomCode,
          speakerName: name,
          timestamp: Date.now(),
        })
      );
    }
  }, []);

  // Clear saved room info
  const clearRoomInfo = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Create room with settings
  const createRoom = useCallback(() => {
    if (!socketRef.current) return;

    const name = user?.name || speakerName || "Speaker";
    setSpeakerName(name);

    socketRef.current.emit("create-room", {
      name,
      userId: user?.id,
      ...roomSettings
    });

    setShowSettingsModal(false);
  }, [user, speakerName, roomSettings]);

  // Update room settings (without changing room code)
  const updateRoomSettings = useCallback(() => {
    if (!socketRef.current || !roomId) return;

    socketRef.current.emit("update-settings", {
      roomId,
      settings: roomSettings
    });

    setShowSettingsModal(false);
    alert("설정이 업데이트되었습니다!");
  }, [roomId, roomSettings]);

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
      setStatus("연결됨");

      // Check URL parameters
      const roomParam = searchParams.get("room");
      const forceNew = searchParams.get("forceNew");

      // Force new room - clear localStorage and show settings modal
      if (forceNew === "true") {
        clearRoomInfo();
        setShowSettingsModal(true);
        // Clear URL parameter
        router.replace("/speaker");
        return;
      }

      // Rejoin specific room from URL parameter (from dashboard)
      if (roomParam) {
        const name = user?.name || "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: roomParam,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100
        });
        // Clear URL parameter after processing
        router.replace("/speaker");
        return;
      }

      // Check for saved room in localStorage
      const savedRoom = loadSavedRoom();
      if (savedRoom && savedRoom.roomCode) {
        // Try to rejoin existing room
        const name = savedRoom.speakerName || user?.name || "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: savedRoom.roomCode,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100
        });
      } else {
        // Show settings modal for new room
        setShowSettingsModal(true);
      }
    });

    socketRef.current.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
      setStatus("연결 끊김");
    });

    socketRef.current.on("room-created", (data: any) => {
      setRoomId(data.roomId);
      saveRoomInfo(data.roomId, speakerName);
      generateQRCode(data.roomId);
      if (data.isRejoined) {
        setStatus("방 재입장");
      } else {
        setStatus("방 생성됨");
      }
    });

    socketRef.current.on("room-rejoined", (data: any) => {
      setRoomId(data.roomId);
      generateQRCode(data.roomId);
      setStatus("방 재연결됨");
    });

    socketRef.current.on("listener-count", (data: any) => {
      setListenerCount(data.count);
    });

    // Listen for transcripts
    socketRef.current.on("stt-text", (data: any) => {
      if (!data.isHistory) {
        setTranscripts((prev) => [
          ...prev.slice(-19),
          {
            type: "stt",
            text: data.text,
            timestamp: data.timestamp,
          },
        ]);
      }
    });

    socketRef.current.on("translation-batch", (data: any) => {
      if (!data.isHistory) {
        setTranscripts((prev) => [
          ...prev.slice(-19),
          {
            type: "translation",
            korean: data.korean,
            english: data.english,
            timestamp: data.timestamp,
          },
        ]);
      }
    });

    socketRef.current.on("error", (data: any) => {
      console.error("Socket error:", data);
      setStatus(`오류: ${data.message}`);
    });

    return () => {
      stopRecording();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [user, loadSavedRoom, saveRoomInfo, generateQRCode]);

  // Start recording
  const startRecording = async () => {
    try {
      setStatus("마이크 요청 중...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      // Log actual sample rate (browsers may not honor requested rate)
      console.log(`[Audio] Requested: 24000 Hz, Actual: ${audioContextRef.current.sampleRate} Hz`);

      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      const bufferSize = 4096;
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);

      let isProcessing = true;
      let audioChunksSent = 0;

      processorRef.current.onaudioprocess = (e: any) => {
        if (!isProcessing || !socketRef.current || !roomId) {
          if (!roomId && audioChunksSent === 0) {
            console.warn("[Audio] Cannot send audio: roomId is missing");
          }
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        let maxLevel = 0;
        for (let i = 0; i < inputData.length; i++) {
          maxLevel = Math.max(maxLevel, Math.abs(inputData[i]));
        }

        if (maxLevel > 0.0005) {
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            const amplified = s * 1.2;
            const clamped = Math.max(-1, Math.min(1, amplified));
            int16Data[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
          }

          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));

          socketRef.current.emit("audio-stream", {
            roomId,
            audio: base64Audio,
          });

          audioChunksSent++;
          if (audioChunksSent === 1 || audioChunksSent % 100 === 0) {
            console.log(`[Audio] Sent ${audioChunksSent} chunks to server (roomId: ${roomId})`);
          }
        }
      };

      processorRef.current.isProcessing = isProcessing;

      analyserRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      const updateAudioLevel = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, Math.round(rms * 300));
        setAudioLevel(level);

        animationRef.current = requestAnimationFrame(updateAudioLevel);
      };
      updateAudioLevel();

      setIsRecording(true);
      setStatus("녹음 중");
    } catch (error) {
      console.error("Recording error:", error);
      setStatus("마이크 오류");
      alert("마이크 접근 권한이 필요합니다.");
    }
  };

  // Stop recording
  const stopRecording = () => {
    setIsRecording(false);
    setStatus("정지");
    setAudioLevel(0);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (processorRef.current) {
      if (processorRef.current.isProcessing !== undefined) {
        processorRef.current.isProcessing = false;
      }
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Create new room
  const createNewRoom = () => {
    if (confirm("현재 방을 나가고 새 방을 만드시겠습니까?")) {
      clearRoomInfo();
      stopRecording();
      setRoomId("");
      setTranscripts([]);
      setQrCodeUrl("");

      // Disconnect socket to ensure clean state
      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      // Navigate with forceNew parameter
      router.push("/speaker?forceNew=true");
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label}이(가) 복사되었습니다.`);
  };

  // Share room URL
  const shareRoom = () => {
    const url = `${FRONTEND_URL}/listener/${roomId}`;
    if (navigator.share) {
      navigator.share({
        title: "번역 세션 초대",
        text: `방 코드: ${roomId}`,
        url: url
      }).catch(console.error);
    } else {
      copyToClipboard(url, "방 URL");
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <button onClick={() => router.push(user ? "/dashboard" : "/")} className={styles.backButton}>
            ← {user ? "대시보드" : "홈"}
          </button>
          <div className={styles.connectionStatus}>
            <span className={isConnected ? styles.connected : styles.disconnected}>
              {isConnected ? "● 연결됨" : "○ 연결 끊김"}
            </span>
          </div>
        </div>

        {/* Room Info */}
        <div className={styles.roomInfo}>
          <div className={styles.titleSection}>
            <h2>{roomSettings.roomTitle || speakerName || "Speaker"}</h2>
          </div>
          {roomId && (
            <div className={styles.roomCodeSection}>
              <div className={styles.roomCode}>
                <p className={styles.label}>방 코드</p>
                <div className={styles.codeContainer}>
                  <p className={styles.code}>{roomId}</p>
                  <button onClick={() => copyToClipboard(roomId, "방 코드")} className={styles.copyButton}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    복사
                  </button>
                </div>
              </div>

              {/* QR Code */}
              {qrCodeUrl && (
                <div className={styles.qrCodeSection}>
                  <p className={styles.label}>QR 코드로 입장</p>
                  <div className={styles.qrCode} onClick={() => setShowQRModal(true)} style={{ cursor: 'pointer' }}>
                    <img src={qrCodeUrl} alt="Room QR Code" />
                  </div>
                  <div className={styles.qrButtons}>
                    <button onClick={() => setShowQRModal(true)} className={styles.fullscreenButton}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                      전체화면
                    </button>
                    <button onClick={shareRoom} className={styles.shareButton}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      공유
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.actionButtons}>
                <button onClick={() => setShowSettingsModal(true)} className={styles.settingsButtonNew}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
                  </svg>
                  방 설정
                </button>
                <button onClick={createNewRoom} className={styles.newRoomButton}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  새 방 만들기
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{listenerCount}</span>
            <span className={styles.statLabel}>청취자</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{status}</span>
            <span className={styles.statLabel}>상태</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{roomSettings.targetLanguages.length}</span>
            <span className={styles.statLabel}>번역 언어</span>
          </div>
        </div>

        {/* Audio level meter */}
        {isRecording && (
          <div className={styles.audioLevel}>
            <span className={styles.audioLabel}>마이크 레벨</span>
            <div className={styles.audioMeter}>
              <div
                className={styles.audioBar}
                style={{
                  width: `${audioLevel}%`,
                  backgroundColor: audioLevel > 70 ? "#ef4444" : audioLevel > 30 ? "#22c55e" : "#64748b",
                }}
              />
            </div>
            <span className={styles.audioPercent}>{audioLevel}%</span>
          </div>
        )}

        {/* Controls */}
        <div className={styles.controls}>
          {!isRecording ? (
            <button
              onClick={startRecording}
              className={styles.startButton}
              disabled={!roomId || !isConnected}
            >
              <span className={styles.recordDot}></span>
              시작
            </button>
          ) : (
            <button onClick={stopRecording} className={styles.stopButton}>
              ⏹ 녹음 중지
            </button>
          )}
        </div>

        {/* Recent transcripts preview */}
        {transcripts.length > 0 && (
          <div className={styles.transcriptPreview}>
            <h3>최근 변환 내역</h3>
            <div className={styles.transcriptList}>
              {transcripts.slice(-5).map((item, index) => (
                <div key={index} className={styles.transcriptItem}>
                  {item.type === "stt" ? (
                    <p className={styles.sttText}>{item.text}</p>
                  ) : (
                    <>
                      <p className={styles.koreanText}>{item.korean}</p>
                      <p className={styles.englishText}>{item.english}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className={styles.modalOverlay} onClick={() => setShowSettingsModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>{roomId ? '방 설정 변경' : '방 설정'}</h2>

            {/* Room Title */}
            <div className={styles.settingGroup}>
              <label>방 제목 (선택)</label>
              <input
                type="text"
                value={roomSettings.roomTitle}
                onChange={(e) => setRoomSettings({ ...roomSettings, roomTitle: e.target.value })}
                className={styles.input}
                placeholder="방 제목을 입력하세요"
              />
            </div>

            {/* Prompt Template */}
            <div className={styles.settingGroup}>
              <label>음성 인식 유형</label>
              <select
                value={roomSettings.promptTemplate}
                onChange={(e) => setRoomSettings({ ...roomSettings, promptTemplate: e.target.value })}
                className={styles.select}
              >
                {PROMPT_TEMPLATES.map((template) => (
                  <option key={template.value} value={template.value}>
                    {template.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Prompt */}
            {roomSettings.promptTemplate === "custom" && (
              <div className={styles.settingGroup}>
                <label>사용자 지정 프롬프트</label>
                <textarea
                  value={roomSettings.customPrompt}
                  onChange={(e) => setRoomSettings({ ...roomSettings, customPrompt: e.target.value })}
                  className={styles.textarea}
                  placeholder="음성 인식을 위한 사용자 지정 프롬프트를 입력하세요..."
                  rows={4}
                />
              </div>
            )}

            {/* Target Languages */}
            <div className={styles.settingGroup}>
              <label>번역 언어 (다중 선택)</label>
              <div className={styles.languageGrid}>
                {TARGET_LANGUAGES.map((lang) => (
                  <label key={lang.code} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={roomSettings.targetLanguages.includes(lang.code)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRoomSettings({
                            ...roomSettings,
                            targetLanguages: [...roomSettings.targetLanguages, lang.code],
                          });
                        } else {
                          setRoomSettings({
                            ...roomSettings,
                            targetLanguages: roomSettings.targetLanguages.filter((l) => l !== lang.code),
                          });
                        }
                      }}
                    />
                    <span>{lang.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Password */}
            <div className={styles.settingGroup}>
              <label>비밀번호 (선택)</label>
              <input
                type="password"
                value={roomSettings.password}
                onChange={(e) => setRoomSettings({ ...roomSettings, password: e.target.value })}
                className={styles.input}
                placeholder="비밀번호를 설정하지 않으면 누구나 입장 가능"
              />
            </div>

            {/* Max Listeners */}
            <div className={styles.settingGroup}>
              <label>최대 청취자 수</label>
              <input
                type="number"
                value={roomSettings.maxListeners}
                onChange={(e) => setRoomSettings({ ...roomSettings, maxListeners: parseInt(e.target.value) || 100 })}
                className={styles.input}
                min="1"
                max="1000"
              />
            </div>

            {/* Actions */}
            <div className={styles.modalActions}>
              <button onClick={() => setShowSettingsModal(false)} className={styles.cancelButton}>
                {roomId ? '닫기' : '취소'}
              </button>
              <button onClick={roomId ? updateRoomSettings : createRoom} className={styles.createButton}>
                {roomId ? '설정 저장' : '방 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Fullscreen Modal */}
      {showQRModal && (
        <div className={styles.qrModalOverlay} onClick={() => setShowQRModal(false)}>
          <div className={styles.qrModalContent} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowQRModal(false)} className={styles.closeButton}>
              ✕
            </button>
            <div className={styles.qrFullscreen}>
              <h1>{roomSettings.roomTitle || "번역 세션"}</h1>
              <p className={styles.roomCodeLarge}>{roomId}</p>
              <img src={qrCodeUrl} alt="Room QR Code" />
              <p className={styles.instruction}>QR 코드를 스캔하여 세션에 참여하세요</p>
              <p className={styles.urlText}>{`${FRONTEND_URL}/listener/${roomId}`}</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
