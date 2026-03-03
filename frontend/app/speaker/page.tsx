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
  attemptMicrophoneReconnect,
  MicrophoneDevice,
} from "@/lib/microphone-manager";
import { getDisplayText } from "@/lib/text-display";
import styles from "./speaker.module.css";
import {
  RoomSettings,
  Transcript,
  SocketData,
  TARGET_LANGUAGES,
  BACKEND_URL,
  FRONTEND_URL,
  STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "./types";
import { SettingsModal, QRModal, MicrophoneModal, AudioLevelMeter, MicSelectButton, RecordingControls } from "./components";

function SpeakerContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();

  // State management
  const [roomId, setRoomId] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused">("idle");
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
  const [activeMicLabel, setActiveMicLabel] = useState<string | null>(null);  // 실제 사용 중인 마이크
  const [micMismatch, setMicMismatch] = useState(false);  // 요청한 마이크와 다른 경우

  const [roomSettings, setRoomSettings] = useState<RoomSettings>({
    roomTitle: "",
    sessionType: "church", // Default: church (primary target)
    sourceLanguage: "ko",
    targetLanguages: ["en"],
    maxListeners: 100,
    enableStreaming: true,
  });

  // New UX states
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [, setHasDefaultSettings] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const isNearBottomRef = useRef(true); // Track if user is near bottom (separate from toggle)

  // Menu dropdown state
  const [showMenu, setShowMenu] = useState(false);

  // Refs
  const socketRef = useRef<
    (ReturnType<typeof io> & { __resumeRecording?: boolean }) | null
  >(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const translationListRef = useRef<HTMLDivElement>(null);
  const backgroundSessionRef = useRef<BackgroundSessionManager | null>(null);
  const roomIdRef = useRef<string>("");
  const seenSegmentIds = useRef<Set<string>>(new Set());

  // Debug audio recording refs
  const debugMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const debugAudioChunksRef = useRef<Blob[]>([]);
  const [debugAudioUrl, setDebugAudioUrl] = useState<string | null>(null);
  const [, setIsDebugRecording] = useState(false);

  // Keep roomIdRef in sync with roomId state
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // Auto-scroll to latest translation - only when autoScroll is ON AND user is near bottom
  useEffect(() => {
    if (autoScroll && isNearBottomRef.current && translationListRef.current) {
      translationListRef.current.scrollTop =
        translationListRef.current.scrollHeight;
    }
  }, [transcripts, autoScroll]);

  // Scroll detection - track if user is near bottom
  const handleTranslationScroll = useCallback(() => {
    if (!translationListRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = translationListRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    isNearBottomRef.current = nearBottom;
  }, []);

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


  // Load microphone devices
  const loadMicDevices = useCallback(async () => {
    try {
      const devices = await getMicrophoneDevices();
      setMicDevices(devices);

      // Auto-select external mic if available and no previous selection
      if (!selectedMicId && devices.length > 0) {
        const externalMic = devices.find((d) => d.isExternal);
        if (externalMic) {
          setSelectedMicId(externalMic.deviceId);
          setUseExternalMicMode(true);
          setCurrentMicLabel(externalMic.label);
          saveMicrophoneSettings({
            deviceId: externalMic.deviceId,
            deviceLabel: externalMic.label,
            useExternalMicMode: true,
          });
          toast.info(`외부 마이크 감지: ${externalMic.label}`);
        }
      }
    } catch {
      // Silent fail - mic devices will be loaded on retry
    }
  }, [selectedMicId, toast]);

  // Handle microphone selection
  const handleMicSelect = useCallback((device: MicrophoneDevice) => {
    setSelectedMicId(device.deviceId);
    setCurrentMicLabel(device.label);

    // Auto-enable external mic mode for external devices
    const newExternalMode = device.isExternal;
    setUseExternalMicMode(newExternalMode);

    // Save settings (deviceLabel도 저장 - deviceId 변경 시 자동 재연결용)
    saveMicrophoneSettings({
      deviceId: device.deviceId,
      deviceLabel: device.label,
      useExternalMicMode: newExternalMode,
    });

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

  // ★ 페이지 로드/장치 변경 시 마이크 검증 및 자동 재연결
  useEffect(() => {
    const validateAndReconnectMic = async () => {
      if (micDevices.length === 0) return;

      const savedSettings = loadMicrophoneSettings();
      if (!savedSettings || !savedSettings.deviceId) {
        // 저장된 설정이 없으면 기본 마이크 사용
        setCurrentMicLabel("기본 마이크");
        return;
      }

      // 저장된 deviceId로 장치 찾기
      const selectedDevice = micDevices.find((d) => d.deviceId === savedSettings.deviceId);

      if (selectedDevice) {
        // deviceId가 유효함 - 정상
        setSelectedMicId(selectedDevice.deviceId);
        setCurrentMicLabel(selectedDevice.label);
      } else {
        // deviceId가 유효하지 않음 - 자동 재연결 시도
        const reconnectResult = await attemptMicrophoneReconnect(savedSettings);

        if (reconnectResult.device) {
          // 재연결 성공
          setSelectedMicId(reconnectResult.device.deviceId);
          setCurrentMicLabel(reconnectResult.device.label);
          setUseExternalMicMode(reconnectResult.device.isExternal);

          // 설정 업데이트
          saveMicrophoneSettings({
            deviceId: reconnectResult.device.deviceId,
            deviceLabel: reconnectResult.device.label,
            useExternalMicMode: reconnectResult.device.isExternal,
          });

          if (reconnectResult.reconnected) {
            toast.info(`🔄 ${reconnectResult.message}`, { duration: 5000 });
          }
        } else {
          // 재연결 실패 - 기본 마이크 사용
          setSelectedMicId(null);
          setCurrentMicLabel("기본 마이크");
          toast.error(`⚠️ ${reconnectResult.message}`, { duration: 5000 });
        }
      }
    };

    validateAndReconnectMic();
  }, [micDevices, toast]);

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

  // Load default settings from localStorage
  const loadDefaultSettings = useCallback(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        try {
          const settings = JSON.parse(saved);
          setHasDefaultSettings(true);
          return settings;
        } catch {
          localStorage.removeItem(SETTINGS_STORAGE_KEY);
        }
      }
    }
    setHasDefaultSettings(false);
    return null;
  }, []);

  // Save default settings to localStorage
  const saveDefaultSettings = useCallback((settings: RoomSettings) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      setHasDefaultSettings(true);
    }
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

    // Save as default if checkbox is checked
    if (saveAsDefault) {
      saveDefaultSettings(roomSettings);
    }

    // Map sessionType to backend-compatible fields
    const dataToSend = {
      name,
      userId: user?.id,
      roomTitle: roomSettings.roomTitle,
      // Backend compatibility: use sessionType for both
      promptTemplate: roomSettings.sessionType,
      environmentPreset: roomSettings.sessionType,
      maxListeners: roomSettings.maxListeners,
      // Translation always enabled (simplified UX)
      enableTranslation: true,
      sourceLanguage: roomSettings.sourceLanguage,
      targetLanguagesArray: roomSettings.targetLanguages,
      enableStreaming: roomSettings.enableStreaming,
      // Optional fields
      password: "",
      customPrompt: "",
      customEnvironmentDescription: roomSettings.customEnvironmentDescription || "",
      customGlossary: null,
    };

    socketRef.current.emit("create-room", dataToSend);

    setShowSettingsModal(false);
  }, [user, speakerName, roomSettings, saveAsDefault, saveDefaultSettings]);

  // Update room settings (without changing room code)
  const updateRoomSettings = useCallback(() => {
    if (!socketRef.current || !roomId) return;

    // Map to backend-compatible format
    const settingsToSend = {
      roomTitle: roomSettings.roomTitle,
      promptTemplate: roomSettings.sessionType,
      environmentPreset: roomSettings.sessionType,
      sourceLanguage: roomSettings.sourceLanguage,
      targetLanguages: roomSettings.targetLanguages,
      maxListeners: roomSettings.maxListeners,
      enableTranslation: true,
      enableStreaming: roomSettings.enableStreaming,
      customEnvironmentDescription: roomSettings.customEnvironmentDescription || "",
    };

    socketRef.current.emit("update-settings", {
      roomId,
      settings: settingsToSend,
    });

    setShowSettingsModal(false);
    toast.success("설정이 업데이트되었습니다");
  }, [roomId, roomSettings, toast]);

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
      setIsConnected(true);
      setStatus("연결됨");

      // Check URL parameters
      const roomParam = searchParams.get("room");
      const forceNew = searchParams.get("forceNew");

      // Force new room - clear localStorage and show settings modal
      if (forceNew === "true") {
        clearRoomInfo();
        // Load default settings if available
        const defaultSettings = loadDefaultSettings();
        if (defaultSettings) {
          setRoomSettings(defaultSettings);
        }
        setShowSettingsModal(true);
        // Clear URL parameter
        router.replace("/speaker");
        return;
      }

      // Rejoin specific room from URL parameter (from dashboard)
      if (roomParam && socketRef.current) {
        const name = user?.name || "Speaker";
        setSpeakerName(name);
        const defaultSettings = loadDefaultSettings();
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: roomParam,
          promptTemplate: defaultSettings?.sessionType || "church",
          environmentPreset: defaultSettings?.sessionType || "church",
          sourceLanguage: defaultSettings?.sourceLanguage || "ko",
          targetLanguagesArray: defaultSettings?.targetLanguages || ["en"],
          maxListeners: defaultSettings?.maxListeners || 100,
          enableTranslation: true,
          enableStreaming: defaultSettings?.enableStreaming ?? true,
          customEnvironmentDescription: defaultSettings?.customEnvironmentDescription || "",
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
        const defaultSettings = loadDefaultSettings();
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: savedRoom.roomCode,
          promptTemplate: defaultSettings?.sessionType || "church",
          environmentPreset: defaultSettings?.sessionType || "church",
          sourceLanguage: defaultSettings?.sourceLanguage || "ko",
          targetLanguagesArray: defaultSettings?.targetLanguages || ["en"],
          maxListeners: defaultSettings?.maxListeners || 100,
          enableTranslation: true,
          enableStreaming: defaultSettings?.enableStreaming ?? true,
          customEnvironmentDescription: defaultSettings?.customEnvironmentDescription || "",
        });
        // Don't show settings modal when rejoining
        setShowSettingsModal(false);
      } else {
        // NEW: One-click start if default settings exist
        const defaultSettings = loadDefaultSettings();
        if (defaultSettings && socketRef.current) {
          const name = user?.name || "Speaker";
          setSpeakerName(name);
          setRoomSettings(defaultSettings);

          socketRef.current.emit("create-room", {
            name,
            userId: user?.id,
            roomTitle: defaultSettings.roomTitle || "",
            promptTemplate: defaultSettings.sessionType,
            environmentPreset: defaultSettings.sessionType,
            sourceLanguage: defaultSettings.sourceLanguage,
            targetLanguagesArray: defaultSettings.targetLanguages,
            maxListeners: defaultSettings.maxListeners,
            enableTranslation: true,
            enableStreaming: defaultSettings.enableStreaming,
            customEnvironmentDescription: defaultSettings.customEnvironmentDescription || "",
          });
          // Don't show modal - direct start!
          setShowSettingsModal(false);
        } else {
          // First time: show settings modal
          setShowSettingsModal(true);
        }
      }
    });

    // Recording state synchronization (Phase 1)
    socketRef.current.on(
      "recording-state-changed",
      (data: { roomId: string; isRecording: boolean; timestamp: string }) => {
        // 다른 디바이스에서 녹음 상태가 변경된 경우 UI 동기화
        if (data.roomId === roomId) {
          if (!data.isRecording && recordingState !== "idle") {
            // 다른 디바이스에서 녹음 중지
            audioRecorderRef.current?.stop();
            setRecordingState("idle");
            setAudioLevel(0);
          }
        }
      }
    );

    socketRef.current.on(
      "recording-state-synced",
      (_data: { roomId: string; isRecording: boolean; timestamp: string }) => {
        // 재연결/새 디바이스 연결 시 현재 상태 동기화
        // TODO: 필요시 UI 상태만 업데이트
      }
    );

    socketRef.current.on("disconnect", () => {
      setIsConnected(false);
      setStatus("연결 끊김");

      // Stop recording on disconnect
      if (recordingState !== "idle") {
        stopRecording();
      }
    });

    socketRef.current.on("reconnect", () => {
      setIsConnected(true);
      setStatus("재연결됨");

      // Stop recording temporarily to prevent unauthorized audio stream
      const wasRecording = recordingState !== "idle";
      if (wasRecording) {
        audioRecorderRef.current?.stop();
        setRecordingState("idle");
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
          // Set a flag or use state to resume recording
          if (socketRef.current) {
            socketRef.current.__resumeRecording = true;
          }
        }
      }
    });

    socketRef.current.on("reconnect_attempt", (attemptNumber) => {
      setStatus(`재연결 시도 중 (${attemptNumber}/10)`);
    });

    socketRef.current.on("reconnect_failed", () => {
      setStatus("재연결 실패");
      toast.error("서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.");
    });

    socketRef.current.on("room-created", (data: SocketData) => {
      setRoomId(data.roomId || "");
      // Also update ref immediately for startRecording to use
      roomIdRef.current = data.roomId || "";
      saveRoomInfo(data.roomId || "", speakerName);
      generateQRCode(data.roomId || "");

      // Check if room is in read-only mode (ENDED status)
      const readOnly = data.roomStatus === "ENDED";
      setIsReadOnly(readOnly);

      // Update roomSettings from server response
      if (data.roomSettings) {
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || "",
          sessionType: data.roomSettings.promptTemplate || data.roomSettings.environmentPreset || "church",
          sourceLanguage: data.roomSettings.sourceLanguage || "ko",
          targetLanguages: data.roomSettings.targetLanguagesArray || ["en"],
          maxListeners: data.roomSettings.maxListeners || 100,
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
        socketRef.current.__resumeRecording = false;
        // Wait a bit for socket to stabilize
        setTimeout(() => {
          startRecording();
        }, 500);
      }
    });

    socketRef.current.on("room-rejoined", (data: SocketData) => {
      setRoomId(data.roomId || "");
      // Also update ref immediately for startRecording to use
      roomIdRef.current = data.roomId || "";
      saveRoomInfo(data.roomId || "", speakerName); // Save to localStorage
      generateQRCode(data.roomId || "");

      // Check if room is in read-only mode (ENDED status)
      const readOnly = data.roomStatus === "ENDED";
      setIsReadOnly(readOnly);

      // Update roomSettings from server response
      if (data.roomSettings) {
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || "",
          sessionType: data.roomSettings.promptTemplate || data.roomSettings.environmentPreset || "church",
          sourceLanguage: data.roomSettings.sourceLanguage || "ko",
          targetLanguages: data.roomSettings.targetLanguagesArray || ["en"],
          maxListeners: data.roomSettings.maxListeners || 100,
          enableStreaming: data.roomSettings.enableStreaming ?? true,
        });
      }

      setStatus(readOnly ? "기록 보기 모드" : "방 재연결됨");

      // Resume recording if needed (after reconnection)
      if (socketRef.current && socketRef.current.__resumeRecording) {
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
      setTranscripts((prev) => {
        const displayText = getDisplayText(data.text || "");
        const newTranscript = {
          type: "stt",
          text: displayText,
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
      setTranscripts((prev) => {
        const newTranscript = {
          type: "translation",
          targetLanguage: data.targetLanguage,
          text: data.text,
          originalText: data.originalText,
          isPartial: data.isPartial || false,
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

    // New segment event (primary pipeline)
    socketRef.current.on("segment", (data: any) => {
      // Dedup by segment ID
      const segmentId = data.id;
      if (segmentId && seenSegmentIds.current.has(segmentId)) return;
      if (segmentId) seenSegmentIds.current.add(segmentId);

      setTranscripts((prev) => {
        const newTranscript: Transcript = {
          type: "translation",
          korean: data.korean,
          translations: data.translations || {},
          timestamp: String(data.timestamp),
          segmentId,
          isHistory: data.isHistory || false,
        };
        if (data.isHistory) return [...prev, newTranscript];
        return [...prev.slice(-49), newTranscript];
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
  }, [user, loadSavedRoom, loadDefaultSettings, saveRoomInfo, generateQRCode]);

  // Start recording
  const startRecording = async () => {
    // Wait for roomId if not ready yet (can happen on first load)
    let waitAttempts = 0;
    while (!roomIdRef.current && waitAttempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 200));
      waitAttempts++;
    }

    if (!roomIdRef.current) {
      toast.error("방이 아직 생성되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    // ★ 녹음 시작 전 마이크 유효성 검증 및 자동 재연결
    let effectiveMicId: string | null = selectedMicId;
    let effectiveExternalMode = useExternalMicMode;

    const savedSettings = loadMicrophoneSettings();
    if (savedSettings && savedSettings.deviceId) {
      const reconnectResult = await attemptMicrophoneReconnect(savedSettings);

      if (!reconnectResult.device) {
        // 마이크를 전혀 찾을 수 없음
        toast.error(`❌ ${reconnectResult.message}`, { duration: 5000 });
        setShowMicModal(true);
        return;
      }

      if (reconnectResult.reconnected) {
        // 자동 재연결됨 - 설정 업데이트
        setSelectedMicId(reconnectResult.device.deviceId);
        setCurrentMicLabel(reconnectResult.device.label);
        setUseExternalMicMode(reconnectResult.device.isExternal);

        // 새 설정 저장
        saveMicrophoneSettings({
          deviceId: reconnectResult.device.deviceId,
          deviceLabel: reconnectResult.device.label,
          useExternalMicMode: reconnectResult.device.isExternal,
        });

        toast.info(`🔄 ${reconnectResult.message}`, { duration: 5000 });
      }

      // 재연결된 deviceId 사용
      effectiveMicId = reconnectResult.device.deviceId;
      effectiveExternalMode = reconnectResult.device.isExternal;
    }

    try {
      setStatus("마이크 요청 중...");

      // Create audio recorder with effective microphone (자동 재연결 적용됨)
      audioRecorderRef.current = new AudioRecorder({
        deviceId: effectiveMicId || undefined,
        useExternalMicMode: effectiveExternalMode,
        onAudioData: (base64Audio) => {
          // Use roomIdRef.current to always get the latest roomId (avoid closure capture issue)
          const currentRoomId = roomIdRef.current;
          if (socketRef.current?.connected && currentRoomId) {
            socketRef.current.emit("audio-stream", {
              roomId: currentRoomId,
              audio: base64Audio,
            });
          }
        },
        onAudioLevel: (level) => {
          setAudioLevel(level);
        },
        onError: () => {
          setStatus("마이크 오류");
          toast.error("마이크 접근 권한이 필요합니다.");
        },
        onDeviceSelected: (deviceInfo) => {
          setActiveMicLabel(deviceInfo.label);

          // Check if different from requested
          if (selectedMicId && deviceInfo.deviceId !== selectedMicId) {
            setMicMismatch(true);
            toast.error(`⚠️ 요청한 마이크와 다른 마이크가 선택됨: ${deviceInfo.label}`, { duration: 8000 });
          } else {
            setMicMismatch(false);
          }
        },
        onMicrophoneFallback: (reason) => {
          toast.error(reason, { duration: 10000 });
          setMicMismatch(true);
        },
      });

      // 1. Request STT creation FIRST
      const currentRoomId = roomIdRef.current;
      if (socketRef.current && currentRoomId) {
        socketRef.current.emit("start-recording", { roomId: currentRoomId });

        // 2. Wait for STT ready confirmation
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("STT 준비 시간 초과")), 10000);
          socketRef.current!.once("recording-ready", () => { clearTimeout(timeout); resolve(); });
          socketRef.current!.once("recording-error", (d: any) => { clearTimeout(timeout); reject(new Error(d?.message || "STT 오류")); });
        });
      }

      // 3. Start audio recording AFTER STT is ready
      await audioRecorderRef.current.start();
      setRecordingState("recording");

      // Start background session AFTER recording started (to avoid AudioContext conflict)
      if (!backgroundSessionRef.current) {
        backgroundSessionRef.current = new BackgroundSessionManager({
          onVisibilityChange: () => {},
          onReconnectNeeded: () => {
            if (socketRef.current && !socketRef.current.connected) {
              socketRef.current.connect();
            }
          },
          onWakeLockError: () => {
            toast.info("화면이 꺼지면 녹음이 중단될 수 있습니다. 화면을 켜둔 상태로 유지해주세요.");
          },
        });
      }
      await backgroundSessionRef.current.start();

      // Resume background audio context (for iOS compatibility)
      await backgroundSessionRef.current.resumeAudioContext();

      setStatus("녹음 중");

      // 디버그 녹음도 자동으로 시작 (원본 오디오 확인용)
      startDebugRecording();
    } catch {
      setStatus("마이크 오류");
      toast.error("녹음을 시작할 수 없습니다.");
    }
  };

  // Pause recording
  const pauseRecording = () => {
    audioRecorderRef.current?.pause();

    // 디버그 녹음도 일시정지
    if (debugMediaRecorderRef.current && debugMediaRecorderRef.current.state === 'recording') {
      debugMediaRecorderRef.current.pause();
    }

    setRecordingState("paused");
    setStatus("일시정지");
  };

  // Resume recording
  const resumeRecording = () => {
    audioRecorderRef.current?.resume();

    // 디버그 녹음도 재개
    if (debugMediaRecorderRef.current && debugMediaRecorderRef.current.state === 'paused') {
      debugMediaRecorderRef.current.resume();
    }

    setRecordingState("recording");
    setStatus("녹음 중");
  };

  // Stop recording
  const stopRecording = () => {
    // Stop audio recorder
    audioRecorderRef.current?.stop();

    // Stop background session
    backgroundSessionRef.current?.stop();

    // 디버그 녹음도 자동으로 중지
    stopDebugRecording();

    setRecordingState("idle");
    setStatus("정지");
    setAudioLevel(0);
    setActiveMicLabel(null);
    setMicMismatch(false);

    // Notify server to close STT client
    if (socketRef.current && roomId) {
      socketRef.current.emit("stop-recording", { roomId });
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

  // Save recording
  const saveRecording = async () => {
    if (!user || !accessToken) {
      toast.error("로그인이 필요합니다");
      router.push("/login");
      return;
    }

    if (!roomId) {
      toast.error("저장할 세션이 없습니다");
      return;
    }

    if (transcripts.length === 0) {
      toast.error("저장할 번역 내용이 없습니다");
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
        toast.success("세션이 저장되었습니다");
      } else {
        toast.error(data.message || "저장에 실패했습니다");
      }
    } catch (error) {
      console.error("Save recording error:", error);
      toast.error("저장 중 오류가 발생했습니다");
    }
  };

  // Debug audio recording - 원본 마이크 입력 녹음
  // ★ IMPORTANT: AudioRecorder가 이미 생성한 스트림을 재사용해야 함!
  const startDebugRecording = async () => {
    try {
      // AudioRecorder의 스트림을 가져옴 (같은 마이크 사용 보장)
      const stream = (audioRecorderRef.current as unknown as { stream?: MediaStream })?.stream;

      if (!stream) {
        toast.error('녹음 스트림을 찾을 수 없습니다');
        return;
      }

      debugAudioChunksRef.current = [];

      // 이전 URL 해제
      if (debugAudioUrl) {
        URL.revokeObjectURL(debugAudioUrl);
        setDebugAudioUrl(null);
      }

      // MediaRecorder 시작 (AudioRecorder와 동일한 스트림 사용)
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          debugAudioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(debugAudioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setDebugAudioUrl(url);
      };

      debugMediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // 1초마다 데이터 수집
      setIsDebugRecording(true);
      toast.success('디버그 녹음 시작 (선택된 마이크 사용)');
    } catch (error) {
      console.error('[Debug Recording] Error:', error);
      toast.error('디버그 녹음 실패');
    }
  };

  const stopDebugRecording = () => {
    if (debugMediaRecorderRef.current && debugMediaRecorderRef.current.state !== 'inactive') {
      debugMediaRecorderRef.current.stop();
    }
    // ★ 스트림을 공유하므로 여기서 종료하면 안 됨! (AudioRecorder가 종료할 것)
    setIsDebugRecording(false);
    toast.success('디버그 녹음 완료');
  };

  const downloadDebugAudio = () => {
    if (!debugAudioUrl) return;

    const a = document.createElement('a');
    a.href = debugAudioUrl;
    a.download = `debug-audio-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('오디오 다운로드 완료');
  };

  // Copy to clipboard
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}이(가) 복사되었습니다.`);
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

  // Helper for mic select button click
  const handleMicButtonClick = useCallback(() => {
    loadMicDevices();
    setShowMicModal(true);
  }, [loadMicDevices]);

  // Check if selected mic is external
  const hasExternalMic = micDevices.find((d) => d.deviceId === selectedMicId)?.isExternal ?? false;

  return (
    <main className={styles.main}>
      {/* ========== MOBILE LAYOUT (< 1024px) ========== */}
      <div className={styles.mobileLayout}>
        {/* Mobile Header */}
        <header className={styles.mobileHeader}>
          <button onClick={() => router.push(user ? "/dashboard" : "/")} className={styles.iconBtn}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div className={styles.headerCenter}>
            {roomId ? (
              <>
                <span className={styles.roomCodeTitle}>{roomId}</span>
                <span className={styles.listenerBadge}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                  {listenerCount}
                </span>
              </>
            ) : (
              <span className={styles.roomCodeTitle}>새 세션</span>
            )}
            <span className={`${styles.statusDot} ${isConnected ? styles.online : styles.offline}`} />
          </div>

          <div className={styles.menuContainer}>
            <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} className={`${styles.iconBtn} ${showMenu ? styles.active : ''}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {showMenu && (
              <div className={styles.dropdownMenu}>
                {roomId && (
                  <>
                    <button onClick={() => { setShowQRModal(true); setShowMenu(false); }} className={styles.menuAction}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                      QR 코드
                    </button>
                    <button onClick={() => { shareRoom(); setShowMenu(false); }} className={styles.menuAction}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      공유
                    </button>
                    <button onClick={() => { copyToClipboard(roomId, "방 코드"); setShowMenu(false); }} className={styles.menuAction}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      복사
                    </button>
                    <div className={styles.menuDivider} />
                  </>
                )}
                <button onClick={() => { setShowSettingsModal(true); setShowMenu(false); }} className={styles.menuAction}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  설정
                </button>
                {user && (
                  <button onClick={() => { saveRecording(); setShowMenu(false); }} className={styles.menuAction} disabled={transcripts.length === 0}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                    </svg>
                    저장
                  </button>
                )}
                <button onClick={() => { createNewRoom(); setShowMenu(false); }} className={styles.menuAction}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  새 방
                </button>
                {debugAudioUrl && (
                  <>
                    <div className={styles.menuDivider} />
                    <button onClick={() => { downloadDebugAudio(); setShowMenu(false); }} className={styles.menuAction}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      오디오
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Mobile Content */}
        <div className={styles.mobileContent}>
          <div className={styles.mobileControls}>
            <MicSelectButton
              currentMicLabel={currentMicLabel}
              hasExternalMic={hasExternalMic}
              isRecording={recordingState === "recording"}
              onClick={handleMicButtonClick}
            />
            <RecordingControls
              recordingState={recordingState}
              roomId={roomId}
              isConnected={isConnected}
              isReadOnly={isReadOnly}
              onStart={startRecording}
              onPause={pauseRecording}
              onResume={resumeRecording}
              onStop={stopRecording}
            />
            <AudioLevelMeter
              audioLevel={audioLevel}
              activeMicLabel={activeMicLabel}
              micMismatch={micMismatch}
              isRecording={recordingState === "recording"}
            />
          </div>
          <div className={styles.mobileTranslation}>
            <div className={styles.translationHeader}>
              <h3>실시간 번역</h3>
              <div className={styles.translationHeaderRight}>
                <span className={styles.translationCount}>{transcripts.length}</span>
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`${styles.autoScrollBtn} ${autoScroll ? styles.active : ''}`}
                  title={autoScroll ? "자동 스크롤 끄기" : "자동 스크롤 켜기"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
                  </svg>
                </button>
              </div>
            </div>
            {roomSettings.enableTranslation && roomSettings.targetLanguages.length > 0 && (
              <div className={styles.languageTabs}>
                <button className={`${styles.languageTab} ${selectedLanguage === null ? styles.active : ""}`} onClick={() => setSelectedLanguage(null)}>전체</button>
                {roomSettings.targetLanguages.map((langCode) => {
                  const lang = TARGET_LANGUAGES.find((l) => l.code === langCode);
                  return <button key={langCode} className={`${styles.languageTab} ${selectedLanguage === langCode ? styles.active : ""}`} onClick={() => setSelectedLanguage(langCode)}>{lang?.name || langCode}</button>;
                })}
              </div>
            )}
            <div className={styles.translationContent} ref={translationListRef} onScroll={handleTranslationScroll}>
              {transcripts.length === 0 ? (
                <div className={styles.emptyState}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <p>녹음을 시작하면<br/>실시간 번역이 표시됩니다</p>
                </div>
              ) : (
                <div className={styles.translationList}>
                  {transcripts.filter((item) => {
                    if (item.type === "stt") return false;
                    if (item.type === "translation" && item.isPartial) return false;
                    if (selectedLanguage === null) return true;
                    if (item.translations) return !!item.translations[selectedLanguage];
                    if (item.targetLanguage) return item.targetLanguage === selectedLanguage;
                    return true;
                  }).map((item, index) => (
                    <div key={index} className={styles.translationCard}>
                      <div className={styles.translationCardContent}>
                        {item.korean && <p className={styles.originalText}>{getDisplayText(item.korean)}</p>}
                        {!item.korean && item.originalText && <p className={styles.originalText}>{getDisplayText(item.originalText)}</p>}
                        <p className={styles.translatedText}>
                          {getDisplayText(
                            item.translations?.[selectedLanguage || "en"] || item.text || ""
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========== DESKTOP LAYOUT (>= 1024px) ========== */}
      <div className={styles.desktopLayout}>
        {/* Desktop Header */}
        <header className={styles.desktopHeader}>
          <button onClick={() => router.push(user ? "/dashboard" : "/")} className={styles.backButton}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {user ? "대시보드" : "홈"}
          </button>
          <div className={styles.connectionStatus}>
            <span className={`${styles.statusDot} ${isConnected ? styles.online : styles.offline}`} />
            {isConnected ? "연결됨" : "연결 끊김"}
          </div>
        </header>

        {/* Desktop Two-Column Layout */}
        <div className={styles.twoColumnLayout}>
          {/* Left Panel */}
          <div className={styles.leftPanel}>
            {/* Room Info */}
            <div className={styles.roomInfoCard}>
              <div className={styles.roomInfoHeader}>
                <h2 className={styles.roomTitle}>{roomSettings.roomTitle || speakerName || "Speaker"}</h2>
                {roomId && (
                  <span className={styles.listenerCount}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    </svg>
                    {listenerCount}
                  </span>
                )}
              </div>
              {roomId && (
                <>
                  <div className={styles.roomCode}>
                    <span className={styles.roomCodeLabel}>방 코드</span>
                    <span className={styles.roomCodeValue}>{roomId}</span>
                  </div>
                  <div className={styles.roomActions}>
                    <button onClick={() => copyToClipboard(roomId, "방 코드")} className={styles.actionIconBtn} title="복사">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button onClick={() => setShowQRModal(true)} className={styles.actionIconBtn} title="QR 코드">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </button>
                    <button onClick={() => copyToClipboard(`${FRONTEND_URL}/overlay/${roomId}?lang=en&fontSize=32`, "OBS URL")} className={styles.actionIconBtn} title="OBS URL 복사">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </button>
                    <button onClick={shareRoom} className={styles.actionIconBtn} title="공유">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Mic & Recording */}
            <MicSelectButton
              currentMicLabel={currentMicLabel}
              hasExternalMic={hasExternalMic}
              isRecording={recordingState === "recording"}
              onClick={handleMicButtonClick}
            />
            <RecordingControls
              recordingState={recordingState}
              roomId={roomId}
              isConnected={isConnected}
              isReadOnly={isReadOnly}
              onStart={startRecording}
              onPause={pauseRecording}
              onResume={resumeRecording}
              onStop={stopRecording}
            />
            <AudioLevelMeter
              audioLevel={audioLevel}
              activeMicLabel={activeMicLabel}
              micMismatch={micMismatch}
              isRecording={recordingState === "recording"}
            />

            {/* Action Buttons */}
            <div className={styles.actionButtons}>
              <button onClick={() => setShowSettingsModal(true)} className={styles.actionButton}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                설정
              </button>
              <button onClick={saveRecording} className={styles.actionButton} disabled={!user || transcripts.length === 0}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
                저장
              </button>
              <button onClick={createNewRoom} className={styles.actionButton}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                새 방
              </button>
              {debugAudioUrl && (
                <button onClick={downloadDebugAudio} className={`${styles.actionButton} ${styles.hasAudio}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  오디오
                </button>
              )}
            </div>
          </div>

          {/* Right Panel - Translation */}
          <div className={styles.rightPanel}>
            <div className={styles.translationHeader}>
              <h3>실시간 번역</h3>
              <div className={styles.translationHeaderRight}>
                <span className={styles.translationCount}>{transcripts.length}</span>
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`${styles.autoScrollBtn} ${autoScroll ? styles.active : ''}`}
                  title={autoScroll ? "자동 스크롤 끄기" : "자동 스크롤 켜기"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
                  </svg>
                </button>
              </div>
            </div>
            {roomSettings.enableTranslation && roomSettings.targetLanguages.length > 0 && (
              <div className={styles.languageTabs}>
                <button className={`${styles.languageTab} ${selectedLanguage === null ? styles.active : ""}`} onClick={() => setSelectedLanguage(null)}>전체</button>
                {roomSettings.targetLanguages.map((langCode) => {
                  const lang = TARGET_LANGUAGES.find((l) => l.code === langCode);
                  return <button key={langCode} className={`${styles.languageTab} ${selectedLanguage === langCode ? styles.active : ""}`} onClick={() => setSelectedLanguage(langCode)}>{lang?.name || langCode}</button>;
                })}
              </div>
            )}
            <div className={styles.translationContent} ref={translationListRef} onScroll={handleTranslationScroll}>
              {transcripts.length === 0 ? (
                <div className={styles.emptyState}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <p>녹음을 시작하면<br/>실시간 번역이 여기에 표시됩니다</p>
                </div>
              ) : (
                <div className={styles.translationList}>
                  {transcripts.filter((item) => {
                    if (item.type === "stt") return false;
                    if (item.type === "translation" && item.isPartial) return false;
                    if (selectedLanguage === null) return true;
                    if (item.translations) return !!item.translations[selectedLanguage];
                    if (item.targetLanguage) return item.targetLanguage === selectedLanguage;
                    return true;
                  }).map((item, index) => (
                    <div key={index} className={styles.translationCard}>
                      <div className={styles.translationCardContent}>
                        {item.korean && <p className={styles.originalText}>{getDisplayText(item.korean)}</p>}
                        {!item.korean && item.originalText && <p className={styles.originalText}>{getDisplayText(item.originalText)}</p>}
                        <p className={styles.translatedText}>
                          {getDisplayText(
                            item.translations?.[selectedLanguage || "en"] || item.text || ""
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        roomId={roomId}
        roomSettings={roomSettings}
        onSettingsChange={setRoomSettings}
        onSave={updateRoomSettings}
        onCreate={createRoom}
        showAdvancedSettings={showAdvancedSettings}
        onToggleAdvanced={() => setShowAdvancedSettings(!showAdvancedSettings)}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />

      {/* QR Code Modal */}
      <QRModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        roomId={roomId}
        roomTitle={roomSettings.roomTitle}
        qrCodeUrl={qrCodeUrl}
      />

      {/* Microphone Selection Modal */}
      <MicrophoneModal
        isOpen={showMicModal}
        onClose={() => setShowMicModal(false)}
        micDevices={micDevices}
        selectedMicId={selectedMicId || ""}
        currentMicLabel={currentMicLabel}
        useExternalMicMode={useExternalMicMode}
        onExternalMicModeChange={(enabled) => {
          setUseExternalMicMode(enabled);
          saveMicrophoneSettings({
            deviceId: selectedMicId,
            deviceLabel: currentMicLabel,
            useExternalMicMode: enabled,
          });
        }}
        onMicSelect={handleMicSelect}
        onRefresh={loadMicDevices}
      />
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
