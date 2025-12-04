"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import io from "socket.io-client";
import QRCode from "qrcode";
import { AudioRecorder } from "@/lib/audio-recorder";
import { BackgroundSessionManager } from "@/lib/background-session";
import {
  getMicrophoneDevices,
  saveMicrophoneSettings,
  loadMicrophoneSettings,
  onDeviceChange,
  MicrophoneDevice,
} from "@/lib/microphone-manager";
import styles from "./speaker.module.css";

// Constants
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const FRONTEND_URL =
  process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";
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
  { value: "custom", label: "사용자 지정" },
];

// Target languages
const TARGET_LANGUAGES = [
  { code: "ko", name: "한국어" },
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
  { code: "hi", name: "हिन्दी" },
];

// Source languages (commonly used)
const SOURCE_LANGUAGES = [
  { code: "ko", name: "한국어" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
];

// Environment presets
const ENVIRONMENT_PRESETS = [
  { value: "general", label: "일반 대화" },
  { value: "church", label: "종교/교회" },
  { value: "medical", label: "의료/건강" },
  { value: "legal", label: "법률/계약" },
  { value: "business", label: "비즈니스/회의" },
  { value: "custom", label: "사용자 지정" },
];

interface RoomSettings {
  roomTitle: string;
  speakerName: string;
  promptTemplate: string;
  customPrompt: string;
  targetLanguages: string[];
  password: string;
  maxListeners: number;
  // Translation settings
  enableTranslation: boolean;
  sourceLanguage: string;
  environmentPreset: string;
  customEnvironmentDescription: string;
  customGlossary: Record<string, string> | null;
  enableStreaming: boolean;
}

interface Transcript {
  id?: string;
  type?: string;
  text?: string;
  translations?: Record<string, string>;
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  contextSummary?: string;
  isHistory?: boolean;
  korean?: string;
  english?: string;
  batchId?: string;
}

interface SocketData {
  roomId?: string;
  roomCode?: string;
  roomStatus?: string;
  message?: string;
  count?: number;
  text?: string;
  language?: string;
  translations?: Record<string, string>;
  transcripts?: Transcript[];
  isRejoined?: boolean;
  roomSettings?: {
    roomTitle?: string;
    promptTemplate?: string;
    customPrompt?: string;
    targetLanguagesArray?: string[];
    maxListeners?: number;
    enableTranslation?: boolean;
    sourceLanguage?: string;
    environmentPreset?: string;
    customEnvironmentDescription?: string;
    customGlossary?: Record<string, string> | null;
    enableStreaming?: boolean;
  };
  timestamp?: string;
  isFinal?: boolean;
  targetLanguage?: string;
  originalText?: string;
  isPartial?: boolean;
  contextSummary?: string;
  isHistory?: boolean;
  korean?: string;
  english?: string;
  batchId?: string;
}

function SpeakerContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();

  // State management
  const [roomId, setRoomId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  // Status for debugging - not currently displayed in UI
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_status, setStatus] = useState("준비");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  // Microphone selection
  const [showMicModal, setShowMicModal] = useState(false);
  const [micDevices, setMicDevices] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [useExternalMicMode, setUseExternalMicMode] = useState(false);
  const [currentMicLabel, setCurrentMicLabel] = useState<string>("기본 마이크");

  const [roomSettings, setRoomSettings] = useState<RoomSettings>({
    roomTitle: "",
    speakerName: "",
    promptTemplate: "church",
    customPrompt: "",
    targetLanguages: ["en"],
    password: "",
    maxListeners: 100,
    // Translation settings (Default: LDS Church optimized)
    enableTranslation: true,
    sourceLanguage: "ko",
    environmentPreset: "church",
    customEnvironmentDescription: "",
    customGlossary: null,
    enableStreaming: true,
  });

  // Refs
  const socketRef = useRef<
    (ReturnType<typeof io> & { __resumeRecording?: boolean }) | null
  >(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const translationListRef = useRef<HTMLDivElement>(null);
  const backgroundSessionRef = useRef<BackgroundSessionManager | null>(null);

  // Auto-scroll to latest translation
  useEffect(() => {
    if (translationListRef.current) {
      translationListRef.current.scrollTop =
        translationListRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Generate QR code
  const generateQRCode = useCallback(async (roomCode: string) => {
    const url = `${FRONTEND_URL}/listener/${roomCode}`;
    try {
      const qrUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: "#1e293b",
          light: "#ffffff",
        },
      });
      setQrCodeUrl(qrUrl);
    } catch (error) {
      console.error("QR code generation error:", error);
    }
  }, []);

  // Split text into sentences
  const splitIntoSentences = useCallback((text: string): string[] => {
    if (!text || text.trim() === "") return [];

    // More sophisticated sentence splitting for Korean and English
    // Split on sentence-ending punctuation followed by space or end of string
    const sentences = text.split(/([.!?]+(?:\s+|$))/g);

    const result: string[] = [];
    let currentSentence = "";

    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];

      // Skip empty parts
      if (!part || part.trim() === "") continue;

      // If this is punctuation, add to current sentence and finalize
      if (/^[.!?]+(?:\s+|$)/.test(part)) {
        currentSentence += part.replace(/\s+$/, ""); // Remove trailing space from punctuation
        if (currentSentence.trim().length > 0) {
          result.push(currentSentence.trim());
        }
        currentSentence = "";
      } else {
        // Regular text - accumulate
        currentSentence += part;
      }
    }

    // Add any remaining text as a sentence
    if (currentSentence.trim().length > 0) {
      result.push(currentSentence.trim());
    }

    // If no sentences found, return the whole text
    return result.length > 0 ? result : [text.trim()];
  }, []);

  // Load microphone devices
  const loadMicDevices = useCallback(async () => {
    try {
      const devices = await getMicrophoneDevices();
      setMicDevices(devices);
      console.log("[Microphone] Devices loaded:", devices.length);

      // Auto-select external mic if available and no previous selection
      if (!selectedMicId && devices.length > 0) {
        const externalMic = devices.find((d) => d.isExternal);
        if (externalMic) {
          setSelectedMicId(externalMic.deviceId);
          setUseExternalMicMode(true);
          setCurrentMicLabel(externalMic.label);
          saveMicrophoneSettings({
            deviceId: externalMic.deviceId,
            useExternalMicMode: true,
          });
          console.log("[Microphone] Auto-selected external mic:", externalMic.label);
          toast.info(`외부 마이크 감지: ${externalMic.label}`);
        }
      }
    } catch (error) {
      console.error("[Microphone] Error loading devices:", error);
    }
  }, [selectedMicId, toast]);

  // Handle microphone selection
  const handleMicSelect = useCallback((device: MicrophoneDevice) => {
    setSelectedMicId(device.deviceId);
    setCurrentMicLabel(device.label);

    // Auto-enable external mic mode for external devices
    const newExternalMode = device.isExternal;
    setUseExternalMicMode(newExternalMode);

    // Save settings
    saveMicrophoneSettings({
      deviceId: device.deviceId,
      useExternalMicMode: newExternalMode,
    });

    console.log("[Microphone] Selected:", device.label, "External mode:", newExternalMode);
    setShowMicModal(false);
  }, []);

  // Initialize microphone settings on mount
  useEffect(() => {
    // Load saved settings
    const savedSettings = loadMicrophoneSettings();
    if (savedSettings) {
      setSelectedMicId(savedSettings.deviceId);
      setUseExternalMicMode(savedSettings.useExternalMicMode);
    }

    // Load devices
    loadMicDevices();

    // Listen for device changes
    const cleanup = onDeviceChange(() => {
      loadMicDevices();
    });

    return cleanup;
  }, [loadMicDevices]);

  // Update current mic label when devices change
  useEffect(() => {
    if (selectedMicId && micDevices.length > 0) {
      const selectedDevice = micDevices.find((d) => d.deviceId === selectedMicId);
      if (selectedDevice) {
        setCurrentMicLabel(selectedDevice.label);
      } else {
        // Selected device no longer available
        setSelectedMicId(null);
        setCurrentMicLabel("기본 마이크");
        toast.info("선택한 마이크가 연결 해제되었습니다");
      }
    }
  }, [micDevices, selectedMicId, toast]);

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

    const name =
      user?.name || roomSettings.speakerName || speakerName || "Speaker";
    setSpeakerName(name);

    const dataToSend = {
      name,
      userId: user?.id,
      roomTitle: roomSettings.roomTitle,
      password: roomSettings.password,
      promptTemplate: roomSettings.promptTemplate,
      customPrompt: roomSettings.customPrompt,
      maxListeners: roomSettings.maxListeners,
      // Translation settings
      enableTranslation: roomSettings.enableTranslation,
      sourceLanguage: roomSettings.sourceLanguage,
      targetLanguagesArray: roomSettings.targetLanguages,
      environmentPreset: roomSettings.environmentPreset,
      customEnvironmentDescription: roomSettings.customEnvironmentDescription,
      customGlossary: roomSettings.customGlossary,
      enableStreaming: roomSettings.enableStreaming,
    };

    console.log("🏗️ Creating room with settings:");
    console.log("  - roomTitle:", roomSettings.roomTitle);
    console.log("  - password:", roomSettings.password ? "***" : "(none)");
    console.log("  - enableTranslation:", roomSettings.enableTranslation);
    console.log("  - sourceLanguage:", roomSettings.sourceLanguage);
    console.log("  - targetLanguages:", roomSettings.targetLanguages);
    console.log("  - environmentPreset:", roomSettings.environmentPreset);
    console.log("  - Full data:", dataToSend);

    socketRef.current.emit("create-room", dataToSend);

    setShowSettingsModal(false);
  }, [user, speakerName, roomSettings]);

  // Update room settings (without changing room code)
  const updateRoomSettings = useCallback(() => {
    if (!socketRef.current || !roomId) return;

    console.log("⚙️ Updating room settings:", {
      roomId,
      roomTitle: roomSettings.roomTitle,
      hasPassword: !!roomSettings.password,
      targetLanguages: roomSettings.targetLanguages,
      fullSettings: roomSettings,
    });

    socketRef.current.emit("update-settings", {
      roomId,
      settings: roomSettings,
    });

    setShowSettingsModal(false);
    alert("설정이 업데이트되었습니다!");
  }, [roomId, roomSettings]);

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: {
        userId: user?.id || null,
      },
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
      if (roomParam && socketRef.current) {
        const name = user?.name || "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: roomParam,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100,
        });
        // Clear URL parameter after processing
        router.replace("/speaker");
        return;
      }

      // Check for saved room in localStorage
      const savedRoom = loadSavedRoom();
      if (savedRoom && savedRoom.roomCode && socketRef.current) {
        // Try to rejoin existing room
        const name = savedRoom.speakerName || user?.name || "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: savedRoom.roomCode,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100,
        });
        // Don't show settings modal when rejoining
        setShowSettingsModal(false);
      } else {
        // Show settings modal for new room
        setShowSettingsModal(true);
      }
    });

    // Recording state synchronization (Phase 1)
    socketRef.current.on(
      "recording-state-changed",
      (data: { roomId: string; isRecording: boolean; timestamp: string }) => {
        console.log(`[Phase1] Recording state changed: ${data.isRecording}`);

        // 다른 디바이스에서 녹음 상태가 변경된 경우 UI 동기화
        if (data.roomId === roomId) {
          if (data.isRecording && !isRecording) {
            // 다른 디바이스에서 녹음 시작
            console.log(
              "[Phase1] Another device started recording, syncing..."
            );
            // TODO: 필요시 녹음 시작 로직
          } else if (!data.isRecording && isRecording) {
            // 다른 디바이스에서 녹음 중지
            console.log(
              "[Phase1] Another device stopped recording, syncing..."
            );
            audioRecorderRef.current?.stop();
            setIsRecording(false);
            setAudioLevel(0);
          }
        }
      }
    );

    socketRef.current.on(
      "recording-state-synced",
      (data: { roomId: string; isRecording: boolean; timestamp: string }) => {
        console.log(`[Phase1] Recording state synced: ${data.isRecording}`);

        // 재연결/새 디바이스 연결 시 현재 상태 동기화
        if (data.isRecording && !isRecording) {
          console.log("[Phase1] Syncing to recording state...");
          // TODO: 필요시 UI 상태만 업데이트 (실제 녹음은 시작하지 않음)
        }
      }
    );

    socketRef.current.on("disconnect", (reason) => {
      console.log("Disconnected from server:", reason);
      setIsConnected(false);
      setStatus("연결 끊김");

      // Stop recording on disconnect
      if (isRecording) {
        stopRecording();
      }
    });

    socketRef.current.on("reconnect", (attemptNumber) => {
      console.log("Reconnected to server after", attemptNumber, "attempts");
      setIsConnected(true);
      setStatus("재연결됨");

      // Stop recording temporarily to prevent unauthorized audio stream
      const wasRecording = isRecording;
      if (wasRecording) {
        console.log("[Reconnect] ⏸️  Pausing recording during reconnection...");
        audioRecorderRef.current?.stop();
        setIsRecording(false);
        setAudioLevel(0);
      }

      // Try to rejoin room if we have saved room info
      const savedRoom = loadSavedRoom();
      if (savedRoom && savedRoom.roomCode && roomId && socketRef.current) {
        const name = savedRoom.speakerName || user?.name || "Speaker";
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: savedRoom.roomCode,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100,
        });

        // Resume recording after room is re-established
        if (wasRecording) {
          console.log(
            "[Reconnect] ▶️  Will resume recording after room-created..."
          );
          // Set a flag or use state to resume recording
          if (socketRef.current) {
            socketRef.current.__resumeRecording = true;
          }
        }
      }
    });

    socketRef.current.on("reconnect_attempt", (attemptNumber) => {
      console.log("Reconnection attempt:", attemptNumber);
      setStatus(`재연결 시도 중 (${attemptNumber}/10)`);
    });

    socketRef.current.on("reconnect_failed", () => {
      console.log("Reconnection failed");
      setStatus("재연결 실패");
      alert("서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.");
    });

    socketRef.current.on("room-created", (data: SocketData) => {
      console.log(
        "[Room] Room created:",
        data.roomId,
        "status:",
        data.roomStatus
      );
      setRoomId(data.roomId || "");
      saveRoomInfo(data.roomId || "", speakerName);
      generateQRCode(data.roomId || "");

      // Check if room is in read-only mode (ENDED status)
      const readOnly = data.roomStatus === "ENDED";
      setIsReadOnly(readOnly);
      if (readOnly) {
        console.log("[Room] 📖 Read-only mode (ended session)");
      }

      // Update roomSettings from server response
      if (data.roomSettings) {
        console.log(
          "📋 Received room settings from server:",
          data.roomSettings
        );
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || "",
          speakerName: speakerName,
          promptTemplate: data.roomSettings.promptTemplate || "general",
          customPrompt: data.roomSettings.customPrompt || "",
          targetLanguages: data.roomSettings.targetLanguagesArray || ["en"],
          password: "", // Don't set password for security
          maxListeners: data.roomSettings.maxListeners || 100,
          // Translation settings
          enableTranslation: data.roomSettings.enableTranslation ?? true,
          sourceLanguage: data.roomSettings.sourceLanguage || "ko",
          environmentPreset: data.roomSettings.environmentPreset || "general",
          customEnvironmentDescription:
            data.roomSettings.customEnvironmentDescription || "",
          customGlossary: data.roomSettings.customGlossary || null,
          enableStreaming: data.roomSettings.enableStreaming ?? true,
        });
      }

      if (readOnly) {
        setStatus("기록 보기 모드");
      } else if (data.isRejoined) {
        setStatus("방 재입장");
      } else {
        setStatus("방 생성됨");
      }

      // Resume recording if needed (after reconnection)
      if (socketRef.current && socketRef.current.__resumeRecording) {
        console.log("[Reconnect] ▶️  Resuming recording...");
        socketRef.current.__resumeRecording = false;
        // Wait a bit for socket to stabilize
        setTimeout(() => {
          startRecording();
        }, 500);
      }
    });

    socketRef.current.on("room-rejoined", (data: SocketData) => {
      console.log(
        "[Room] Room rejoined:",
        data.roomId,
        "status:",
        data.roomStatus
      );
      setRoomId(data.roomId || "");
      saveRoomInfo(data.roomId || "", speakerName); // Save to localStorage
      generateQRCode(data.roomId || "");

      // Check if room is in read-only mode (ENDED status)
      const readOnly = data.roomStatus === "ENDED";
      setIsReadOnly(readOnly);
      if (readOnly) {
        console.log("[Room] 📖 Read-only mode (ended session)");
      }

      // Update roomSettings from server response
      if (data.roomSettings) {
        console.log(
          "📋 Received room settings from server (rejoined):",
          data.roomSettings
        );
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || "",
          speakerName: speakerName,
          promptTemplate: data.roomSettings.promptTemplate || "general",
          customPrompt: data.roomSettings.customPrompt || "",
          targetLanguages: data.roomSettings.targetLanguagesArray || ["en"],
          password: "", // Don't set password for security
          maxListeners: data.roomSettings.maxListeners || 100,
          // Translation settings
          enableTranslation: data.roomSettings.enableTranslation ?? true,
          sourceLanguage: data.roomSettings.sourceLanguage || "ko",
          environmentPreset: data.roomSettings.environmentPreset || "general",
          customEnvironmentDescription:
            data.roomSettings.customEnvironmentDescription || "",
          customGlossary: data.roomSettings.customGlossary || null,
          enableStreaming: data.roomSettings.enableStreaming ?? true,
        });
      }

      setStatus(readOnly ? "기록 보기 모드" : "방 재연결됨");

      // Resume recording if needed (after reconnection)
      if (socketRef.current && socketRef.current.__resumeRecording) {
        console.log("[Reconnect] ▶️  Resuming recording...");
        socketRef.current.__resumeRecording = false;
        // Wait a bit for socket to stabilize
        setTimeout(() => {
          startRecording();
        }, 500);
      }
    });

    socketRef.current.on("listener-count", (data: SocketData) => {
      setListenerCount(data.count || 0);
    });

    // Listen for transcripts
    socketRef.current.on("stt-text", (data: SocketData) => {
      // Log final transcripts only
      if (data.isFinal !== false) {
        console.log(`[Frontend] ✅ Received: "${data.text}"`);
      }

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
      console.log(`[Frontend] 🌐 Translation received:`, {
        language: data.targetLanguage,
        text: (data.text || "").substring(0, 50) + "...",
        isPartial: data.isPartial,
        isHistory: data.isHistory,
      });

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
      setTranscripts((prev) => {
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

        // If it's history, add at the end; otherwise add at the end (keep last 50)
        if (data.isHistory) {
          return [...prev, newTranscript];
        } else {
          return [...prev.slice(-49), newTranscript];
        }
      });
    });

    socketRef.current.on("error", (data: SocketData) => {
      console.error("Socket error:", data);
      setStatus(`오류: ${data.message || "Unknown error"}`);
    });

    return () => {
      stopRecording();
      backgroundSessionRef.current?.stop();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadSavedRoom, saveRoomInfo, generateQRCode, splitIntoSentences]);

  // Start recording
  const startRecording = async () => {
    try {
      setStatus("마이크 요청 중...");

      // Create audio recorder with selected microphone
      audioRecorderRef.current = new AudioRecorder({
        deviceId: selectedMicId || undefined,
        useExternalMicMode: useExternalMicMode,
        onAudioData: (base64Audio) => {
          if (socketRef.current?.connected && roomId) {
            socketRef.current.emit("audio-stream", {
              roomId,
              audio: base64Audio,
            });
          }
        },
        onAudioLevel: (level) => {
          setAudioLevel(level);
        },
        onError: (error) => {
          console.error("[Recording] ❌ Error:", error);
          setStatus("마이크 오류");
          alert("마이크 접근 권한이 필요합니다.");
        },
      });

      console.log("[Recording] Using microphone:", currentMicLabel, "External mode:", useExternalMicMode);

      // Start recording BEFORE background session (AudioContext priority)
      await audioRecorderRef.current.start();

      // Start background session AFTER recording started (to avoid AudioContext conflict)
      if (!backgroundSessionRef.current) {
        backgroundSessionRef.current = new BackgroundSessionManager({
          onVisibilityChange: (isVisible) => {
            console.log(`[BackgroundSession] Visibility: ${isVisible}`);
          },
          onReconnectNeeded: () => {
            console.log("[BackgroundSession] Reconnect needed");
            if (socketRef.current && !socketRef.current.connected) {
              socketRef.current.connect();
            }
          },
          onWakeLockError: (error) => {
            console.warn("[BackgroundSession] Wake Lock error:", error.message);
            toast.info("화면이 꺼지면 녹음이 중단될 수 있습니다. 화면을 켜둔 상태로 유지해주세요.");
          },
        });
      }
      await backgroundSessionRef.current.start();

      // Resume background audio context (for iOS compatibility)
      await backgroundSessionRef.current.resumeAudioContext();

      setIsRecording(true);
      setStatus("녹음 중");
      console.log("[Recording] ✅ Started");

      // Notify server to create STT client
      if (socketRef.current && roomId) {
        socketRef.current.emit("start-recording", { roomId });
        console.log("[Recording] 📤 Server notified");
      }
    } catch (error) {
      console.error("[Recording] ❌ Start failed:", error);
      setStatus("마이크 오류");
    }
  };

  // Stop recording
  const stopRecording = () => {
    console.log("[Recording] ⏹️ Stopping...");

    // Stop audio recorder
    audioRecorderRef.current?.stop();

    // Stop background session
    backgroundSessionRef.current?.stop();

    setIsRecording(false);
    setStatus("정지");
    setAudioLevel(0);

    // Notify server to close STT client
    if (socketRef.current && roomId) {
      socketRef.current.emit("stop-recording", { roomId });
      console.log("[Recording] 📤 Server notified");
    }

    console.log("[Recording] ✅ Stopped");
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

  // Save recording
  const saveRecording = async () => {
    if (!user || !accessToken) {
      alert("로그인이 필요합니다");
      router.push("/login");
      return;
    }

    if (!roomId) {
      alert("저장할 세션이 없습니다");
      return;
    }

    if (transcripts.length === 0) {
      alert("저장할 번역 내용이 없습니다");
      return;
    }

    const roomName = prompt(
      "세션 이름을 입력하세요",
      roomSettings.roomTitle || `Session ${roomId}`
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
          roomCode: roomId,
          roomName,
        }),
      });

      const data = await response.json();
      if (data.success) {
        alert("세션이 저장되었습니다");
      } else {
        alert(data.message || "저장에 실패했습니다");
      }
    } catch (error) {
      console.error("Save recording error:", error);
      alert("저장 중 오류가 발생했습니다");
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
      navigator
        .share({
          title: "번역 세션 초대",
          text: `방 코드: ${roomId}`,
          url: url,
        })
        .catch(console.error);
    } else {
      copyToClipboard(url, "방 URL");
    }
  };

  return (
    <main className={styles.main}>
      {/* Header */}
      <div className={styles.header}>
        <button
          onClick={() => router.push(user ? "/dashboard" : "/")}
          className={styles.backButton}
        >
          ← {user ? "대시보드" : "홈"}
        </button>
        <div className={styles.connectionStatus}>
          <span
            className={isConnected ? styles.connected : styles.disconnected}
          >
            {isConnected ? "● 연결됨" : "○ 연결 끊김"}
          </span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className={styles.twoColumnLayout}>
        {/* Left Panel - Controls */}
        <div className={styles.leftPanel}>
          {/* Room Info - Compact */}
          <div className={styles.compactRoomInfo}>
            <div className={styles.compactHeader}>
              <h2 className={styles.compactTitle}>
                {roomSettings.roomTitle || speakerName || "Speaker"}
              </h2>
              {roomId && (
                <div className={styles.compactListenerBadge}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>{listenerCount}</span>
                </div>
              )}
            </div>
            {roomId && (
              <>
                <div className={styles.compactRoomCode}>
                  <span className={styles.compactCodeLabel}>방 코드</span>
                  <span className={styles.compactCodeValue}>{roomId}</span>
                </div>
                <div className={styles.compactActions}>
                  <button
                    onClick={() => copyToClipboard(roomId, "방 코드")}
                    className={styles.compactIconButton}
                    title="복사"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowQRModal(true)}
                    className={styles.compactIconButton}
                    title="QR 코드"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                  <button
                    onClick={shareRoom}
                    className={styles.compactIconButton}
                    title="공유"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Microphone Selection Button */}
          <button
            onClick={() => {
              loadMicDevices();
              setShowMicModal(true);
            }}
            className={`${styles.micSelectButton} ${
              micDevices.find((d) => d.deviceId === selectedMicId)?.isExternal
                ? styles.hasExternal
                : ""
            }`}
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

          {/* Controls */}
          <div className={styles.compactControls}>
            {isReadOnly ? (
              <div className={styles.readOnlyBadge}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                기록 보기 모드 (종료된 세션)
              </div>
            ) : !isRecording ? (
              <button
                onClick={startRecording}
                className={styles.compactStartButton}
                disabled={!roomId || !isConnected}
              >
                <span className={styles.recordDot}></span>
                녹음 시작
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className={styles.compactStopButton}
              >
                ⏹ 녹음 중지
              </button>
            )}
          </div>

          {/* Audio level meter */}
          {isRecording && (
            <div className={styles.compactAudioLevel}>
              <div className={styles.compactAudioHeader}>
                <span className={styles.compactAudioLabel}>마이크</span>
                <span className={styles.compactAudioPercent}>
                  {audioLevel}%
                </span>
              </div>
              <div className={styles.compactAudioMeter}>
                <div
                  className={styles.audioBar}
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
          )}

          {/* Action Buttons - Compact */}
          <div className={styles.compactActionButtons}>
            <button
              onClick={() => setShowSettingsModal(true)}
              className={styles.compactActionButton}
              title="방 설정"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
              </svg>
              설정
            </button>
            <button
              onClick={saveRecording}
              className={styles.compactActionButton}
              disabled={!user || transcripts.length === 0}
              title="세션 저장"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              저장
            </button>
            <button
              onClick={createNewRoom}
              className={styles.compactActionButton}
              title="새 방"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              새 방
            </button>
          </div>
        </div>

        {/* Right Panel - Real-time Translation */}
        <div className={styles.rightPanel}>
          <div className={styles.translationHeader}>
            <h3>실시간 번역</h3>
            <span className={styles.translationCount}>
              {transcripts.length} 항목
            </span>
          </div>

          {/* Language Filter Tabs */}
          {roomSettings.enableTranslation &&
            roomSettings.targetLanguages.length > 0 && (
              <div className={styles.languageTabs}>
                <button
                  className={`${styles.languageTab} ${
                    selectedLanguage === null ? styles.active : ""
                  }`}
                  onClick={() => setSelectedLanguage(null)}
                >
                  전체
                </button>
                {roomSettings.targetLanguages.map((langCode) => {
                  const lang = TARGET_LANGUAGES.find(
                    (l) => l.code === langCode
                  );
                  return (
                    <button
                      key={langCode}
                      className={`${styles.languageTab} ${
                        selectedLanguage === langCode ? styles.active : ""
                      }`}
                      onClick={() => setSelectedLanguage(langCode)}
                    >
                      {lang?.name || langCode}
                    </button>
                  );
                })}
              </div>
            )}

          <div className={styles.translationContent} ref={translationListRef}>
            {transcripts.length === 0 ? (
              <div className={styles.emptyState}>
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p>{`녹음을 시작하면 \n실시간 번역이 여기에 표시됩니다`}</p>
              </div>
            ) : (
              <div className={styles.translationList}>
                {transcripts
                  .filter((item) => {
                    // Hide STT blocks - only show translations
                    if (item.type === "stt") return false;

                    // Hide partial translations
                    if (item.type === "translation" && item.isPartial)
                      return false;

                    // Filter by selected language
                    if (selectedLanguage === null) return true;
                    if (item.type === "translation" && item.targetLanguage) {
                      return item.targetLanguage === selectedLanguage;
                    }
                    // Old translation-batch format
                    return true;
                  })
                  .map((item, index) => (
                    <div key={index} className={styles.translationCard}>
                      {item.targetLanguage ? (
                        // New translation-text format
                        <div className={styles.translationCardContent}>
                          {item.isPartial && (
                            <div className={styles.translationBadge}>
                              진행 중...
                            </div>
                          )}

                          <div className={styles.translationTexts}>
                            {item.originalText && (
                              <>
                                <p className={styles.koreanTextLarge}>
                                  {item.originalText}
                                </p>
                                <div className={styles.divider}></div>
                              </>
                            )}
                            <p
                              className={`${styles.englishTextLarge} ${
                                item.isPartial ? styles.partialText : ""
                              }`}
                            >
                              {item.text}
                              {item.isPartial && (
                                <span className={styles.partialIndicator}>
                                  {" "}
                                  ...
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      ) : (
                        // Old translation-batch format
                        <div className={styles.translationCardContent}>
                          <div className={styles.translationBadge}>번역</div>
                          <div className={styles.translationTexts}>
                            <p className={styles.koreanTextLarge}>
                              {item.korean}
                            </p>
                            <div className={styles.divider}></div>
                            <p className={styles.englishTextLarge}>
                              {item.english}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{roomId ? "방 설정 변경" : "방 설정"}</h2>
              <button
                onClick={() => setShowSettingsModal(false)}
                className={styles.closeModalButton}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Room Title */}
              <div className={styles.settingGroup}>
                <label>방 제목 (선택)</label>
                <input
                  type="text"
                  value={roomSettings.roomTitle}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      roomTitle: e.target.value,
                    })
                  }
                  className={styles.input}
                  placeholder="예: 주일 예배"
                />
              </div>

              {/* Speaker Name */}
              <div className={styles.settingGroup}>
                <label>발표자 이름 (선택)</label>
                <input
                  type="text"
                  value={roomSettings.speakerName}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      speakerName: e.target.value,
                    })
                  }
                  className={styles.input}
                  placeholder="예: 홍길동 목사"
                  autoComplete="off"
                  data-form-type="other"
                />
              </div>

              {/* Prompt Template */}
              <div className={styles.settingGroup}>
                <label>음성 인식 유형</label>
                <select
                  value={roomSettings.promptTemplate}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      promptTemplate: e.target.value,
                    })
                  }
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
                    onChange={(e) =>
                      setRoomSettings({
                        ...roomSettings,
                        customPrompt: e.target.value,
                      })
                    }
                    className={styles.textarea}
                    placeholder="음성 인식을 위한 사용자 지정 프롬프트를 입력하세요..."
                    rows={4}
                  />
                </div>
              )}

              {/* ===== Translation Settings ===== */}
              <div className={styles.settingGroup}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={roomSettings.enableTranslation}
                    onChange={(e) =>
                      setRoomSettings({
                        ...roomSettings,
                        enableTranslation: e.target.checked,
                      })
                    }
                  />
                  <span style={{ fontWeight: "bold" }}>실시간 번역 활성화</span>
                </label>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "#94a3b8",
                    marginTop: "0.5rem",
                  }}
                >
                  💡 GPT + Google Translate를 사용한 고품질 다국어 번역
                </p>
              </div>

              {roomSettings.enableTranslation && (
                <>
                  {/* Source Language */}
                  <div className={styles.settingGroup}>
                    <label>출발 언어</label>
                    <select
                      value={roomSettings.sourceLanguage}
                      onChange={(e) =>
                        setRoomSettings({
                          ...roomSettings,
                          sourceLanguage: e.target.value,
                        })
                      }
                      className={styles.select}
                    >
                      {SOURCE_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Environment Preset */}
                  <div className={styles.settingGroup}>
                    <label>번역 환경</label>
                    <select
                      value={roomSettings.environmentPreset}
                      onChange={(e) =>
                        setRoomSettings({
                          ...roomSettings,
                          environmentPreset: e.target.value,
                        })
                      }
                      className={styles.select}
                    >
                      {ENVIRONMENT_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        color: "#94a3b8",
                        marginTop: "0.5rem",
                      }}
                    >
                      💡 환경에 맞는 전문 용어와 맥락을 적용합니다
                    </p>
                  </div>

                  {/* Custom Environment Description */}
                  {roomSettings.environmentPreset === "custom" && (
                    <div className={styles.settingGroup}>
                      <label>사용자 지정 환경 설명</label>
                      <textarea
                        value={roomSettings.customEnvironmentDescription}
                        onChange={(e) =>
                          setRoomSettings({
                            ...roomSettings,
                            customEnvironmentDescription: e.target.value,
                          })
                        }
                        className={styles.textarea}
                        placeholder="예: 스타트업 투자 발표회, 의학 세미나, 법률 상담 등..."
                        rows={3}
                      />
                    </div>
                  )}

                  {/* Target Languages */}
                  <div className={styles.settingGroup}>
                    <label>번역 언어 선택</label>
                    <div className={styles.languageGrid}>
                      {TARGET_LANGUAGES.map((lang) => {
                        // Only allow English for now, disable others
                        const isSourceLang =
                          lang.code === roomSettings.sourceLanguage;
                        const isOnlyEnglishAllowed = lang.code !== "en";
                        const isDisabled = isSourceLang || isOnlyEnglishAllowed;
                        return (
                          <label
                            key={lang.code}
                            className={`${styles.checkbox} ${
                              isDisabled ? styles.disabled : ""
                            }`}
                            title={
                              isSourceLang
                                ? "출발 언어는 번역 대상에서 제외됩니다"
                                : isOnlyEnglishAllowed
                                ? "현재 영어만 지원됩니다"
                                : ""
                            }
                          >
                            <input
                              type="checkbox"
                              checked={roomSettings.targetLanguages.includes(
                                lang.code
                              )}
                              disabled={isDisabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setRoomSettings({
                                    ...roomSettings,
                                    targetLanguages: [
                                      ...roomSettings.targetLanguages,
                                      lang.code,
                                    ],
                                  });
                                } else {
                                  setRoomSettings({
                                    ...roomSettings,
                                    targetLanguages:
                                      roomSettings.targetLanguages.filter(
                                        (l) => l !== lang.code
                                      ),
                                  });
                                }
                              }}
                            />
                            <span>{lang.name}</span>
                            {isOnlyEnglishAllowed && (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#64748b",
                                  marginLeft: "0.25rem",
                                }}
                              >
                                (준비중)
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        color: "#94a3b8",
                        marginTop: "0.5rem",
                      }}
                    >
                      💡 현재 영어 번역만 지원됩니다. 다른 언어는 추후 지원
                      예정입니다.
                    </p>
                  </div>

                  {/* Streaming */}
                  <div className={styles.settingGroup}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={roomSettings.enableStreaming}
                        onChange={(e) =>
                          setRoomSettings({
                            ...roomSettings,
                            enableStreaming: e.target.checked,
                          })
                        }
                      />
                      <span>스트리밍 번역 (점진적 표시)</span>
                    </label>
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        color: "#94a3b8",
                        marginTop: "0.5rem",
                      }}
                    >
                      💡 번역이 완성되기 전에 중간 결과를 실시간으로 보여줍니다
                    </p>
                  </div>
                </>
              )}

              {/* Password */}
              <div className={styles.settingGroup}>
                <label>
                  비밀번호 (선택)
                  {roomSettings.password && (
                    <span
                      style={{
                        marginLeft: "0.5rem",
                        color: "#4ade80",
                        fontSize: "0.875rem",
                      }}
                    >
                      ✓ 설정됨
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={roomSettings.password}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      password: e.target.value,
                    })
                  }
                  className={styles.input}
                  placeholder={
                    roomId
                      ? "비밀번호 변경 (공백으로 두면 제거)"
                      : "비밀번호를 설정하지 않으면 누구나 입장 가능"
                  }
                  autoComplete="new-password"
                  data-form-type="other"
                />
                {roomSettings.password && (
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      color: "#94a3b8",
                      marginTop: "0.5rem",
                    }}
                  >
                    💡 청취자는 방 입장 시 이 비밀번호를 입력해야 합니다
                  </p>
                )}
              </div>

              {/* Max Listeners */}
              <div className={styles.settingGroup}>
                <label>최대 청취자 수</label>
                <input
                  type="number"
                  value={roomSettings.maxListeners}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      maxListeners: parseInt(e.target.value) || 100,
                    })
                  }
                  className={styles.input}
                  min="1"
                  max="1000"
                />
              </div>

              {/* Actions */}
              <div className={styles.modalActions}>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className={styles.cancelButton}
                >
                  {roomId ? "닫기" : "취소"}
                </button>
                <button
                  onClick={roomId ? updateRoomSettings : createRoom}
                  className={styles.createButton}
                >
                  {roomId ? "설정 저장" : "방 만들기"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Fullscreen Modal */}
      {showQRModal && (
        <div className={styles.qrModalOverlay}>
          <div className={styles.qrModalContent}>
            <button
              onClick={() => setShowQRModal(false)}
              className={styles.closeButton}
            >
              ✕
            </button>
            <div className={styles.qrFullscreen}>
              <h1>{roomSettings.roomTitle || "번역 세션"}</h1>
              <p className={styles.roomCodeLarge}>{roomId}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCodeUrl} alt="Room QR Code" />
              <p className={styles.instruction}>
                QR 코드를 스캔하여 세션에 참여하세요
              </p>
              <p
                className={styles.urlText}
              >{`${FRONTEND_URL}/listener/${roomId}`}</p>
            </div>
          </div>
        </div>
      )}

      {/* Microphone Selection Modal */}
      {showMicModal && (
        <div
          className={styles.micModalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMicModal(false);
          }}
        >
          <div className={styles.micModal}>
            {/* Handle bar for mobile */}
            <div className={styles.micModalHandle}>
              <div className={styles.micModalHandleBar}></div>
            </div>

            <div className={styles.micModalHeader}>
              <div className={styles.micModalTitle}>
                <svg
                  width="24"
                  height="24"
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
                <h3>마이크 선택</h3>
              </div>
              <button
                onClick={() => setShowMicModal(false)}
                className={styles.micModalCloseButton}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className={styles.micModalBody}>
              {/* Current Mic Info */}
              <div className={styles.currentMicInfo}>
                <div className={styles.currentMicIcon}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                </div>
                <div className={styles.currentMicDetails}>
                  <div className={styles.currentMicLabel}>현재 선택</div>
                  <div className={styles.currentMicName}>{currentMicLabel}</div>
                </div>
              </div>

              {/* External Mic Mode Toggle */}
              <div className={styles.externalMicModeSection}>
                <div
                  className={styles.externalMicModeToggle}
                  onClick={() => {
                    const newMode = !useExternalMicMode;
                    setUseExternalMicMode(newMode);
                    saveMicrophoneSettings({
                      deviceId: selectedMicId,
                      useExternalMicMode: newMode,
                    });
                  }}
                >
                  <div
                    className={`${styles.toggleSwitch} ${
                      useExternalMicMode ? styles.active : ""
                    }`}
                  ></div>
                  <div className={styles.externalMicModeInfo}>
                    <div className={styles.externalMicModeLabel}>
                      외부 마이크 모드
                    </div>
                    <div className={styles.externalMicModeDesc}>
                      핀마이크/블루투스 사용 시 켜주세요. 에코 제거와 노이즈
                      억제를 비활성화하여 더 선명한 음질을 제공합니다.
                    </div>
                  </div>
                </div>
              </div>

              {/* Mic List */}
              <div className={styles.micListSection}>
                <div className={styles.micListLabel}>사용 가능한 마이크</div>
                <div className={styles.micList}>
                  {micDevices.length === 0 ? (
                    <div className={styles.emptyMicList}>
                      <svg
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      <p>마이크를 찾을 수 없습니다</p>
                      <span>마이크 권한을 허용하거나 장치를 연결해주세요</span>
                    </div>
                  ) : (
                    micDevices.map((device) => (
                      <button
                        key={device.deviceId}
                        className={`${styles.micItem} ${
                          selectedMicId === device.deviceId ? styles.selected : ""
                        } ${device.isExternal ? styles.external : ""}`}
                        onClick={() => handleMicSelect(device)}
                      >
                        <div className={styles.micItemIcon}>
                          {device.isExternal ? (
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                              <circle cx="18" cy="5" r="3" />
                            </svg>
                          ) : (
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            </svg>
                          )}
                        </div>
                        <div className={styles.micItemInfo}>
                          <div className={styles.micItemName}>{device.label}</div>
                          <div className={styles.micItemBadges}>
                            {device.isDefault && (
                              <span className={`${styles.micBadge} ${styles.default}`}>
                                기본
                              </span>
                            )}
                            {device.isExternal && (
                              <span className={`${styles.micBadge} ${styles.external}`}>
                                외부
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={styles.micItemCheck}>
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Refresh Button */}
              <button onClick={loadMicDevices} className={styles.micRefreshButton}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                마이크 목록 새로고침
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Speaker() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SpeakerContent />
    </Suspense>
  );
}
