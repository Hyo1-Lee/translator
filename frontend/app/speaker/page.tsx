"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
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
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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

  // Split text into sentences
  const splitIntoSentences = useCallback((text: string): string[] => {
    if (!text || text.trim() === '') return [];

    // More sophisticated sentence splitting for Korean and English
    // Split on sentence-ending punctuation followed by space or end of string
    const sentences = text.split(/([.!?]+(?:\s+|$))/g);

    const result: string[] = [];
    let currentSentence = '';

    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];

      // Skip empty parts
      if (!part || part.trim() === '') continue;

      // If this is punctuation, add to current sentence and finalize
      if (/^[.!?]+(?:\s+|$)/.test(part)) {
        currentSentence += part.replace(/\s+$/, ''); // Remove trailing space from punctuation
        if (currentSentence.trim().length > 0) {
          result.push(currentSentence.trim());
        }
        currentSentence = '';
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

    const dataToSend = {
      name,
      userId: user?.id,
      ...roomSettings
    };

    console.log("🏗️ Creating room with settings:");
    console.log("  - roomTitle:", roomSettings.roomTitle);
    console.log("  - password:", roomSettings.password ? "***" : "(none)");
    console.log("  - targetLanguages:", roomSettings.targetLanguages);
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
      fullSettings: roomSettings
    });

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
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
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

      // Try to rejoin room if we have saved room info
      const savedRoom = loadSavedRoom();
      if (savedRoom && savedRoom.roomCode && roomId) {
        const name = savedRoom.speakerName || user?.name || "Speaker";
        socketRef.current.emit("create-room", {
          name,
          userId: user?.id,
          existingRoomCode: savedRoom.roomCode,
          promptTemplate: "general",
          targetLanguages: ["en"],
          maxListeners: 100
        });
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

    socketRef.current.on("room-created", (data: any) => {
      console.log("[Room] Room created:", data.roomId);
      setRoomId(data.roomId);
      saveRoomInfo(data.roomId, speakerName);
      generateQRCode(data.roomId);

      // Update roomSettings from server response
      if (data.roomSettings) {
        console.log("📋 Received room settings from server:", data.roomSettings);
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || '',
          promptTemplate: data.roomSettings.promptTemplate || 'general',
          customPrompt: data.roomSettings.customPrompt || '',
          targetLanguages: Array.isArray(data.roomSettings.targetLanguages)
            ? data.roomSettings.targetLanguages
            : ['en'],
          password: '', // Don't set password for security
          maxListeners: data.roomSettings.maxListeners || 100
        });
      }

      if (data.isRejoined) {
        setStatus("방 재입장");
      } else {
        setStatus("방 생성됨");
      }
    });

    socketRef.current.on("room-rejoined", (data: any) => {
      setRoomId(data.roomId);
      generateQRCode(data.roomId);

      // Update roomSettings from server response
      if (data.roomSettings) {
        console.log("📋 Received room settings from server (rejoined):", data.roomSettings);
        setRoomSettings({
          roomTitle: data.roomSettings.roomTitle || '',
          promptTemplate: data.roomSettings.promptTemplate || 'general',
          customPrompt: data.roomSettings.customPrompt || '',
          targetLanguages: Array.isArray(data.roomSettings.targetLanguages)
            ? data.roomSettings.targetLanguages
            : ['en'],
          password: '', // Don't set password for security
          maxListeners: data.roomSettings.maxListeners || 100
        });
      }

      setStatus("방 재연결됨");
    });

    socketRef.current.on("listener-count", (data: any) => {
      setListenerCount(data.count);
    });

    // Listen for transcripts - ULTRA SIMPLE
    socketRef.current.on("stt-text", (data: any) => {
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

    socketRef.current.on("translation-batch", (data: any) => {
      setTranscripts((prev) => {
        // Don't split into sentences - keep as a single batch for better readability
        const newTranscript = {
          type: "translation",
          korean: data.korean,
          english: data.english,
          translations: data.translations || { en: data.english },
          timestamp: data.timestamp,
          isHistory: data.isHistory || false,
          batchId: data.batchId
        };

        // If it's history, add at the end; otherwise add at the end (keep last 50)
        if (data.isHistory) {
          return [...prev, newTranscript];
        } else {
          return [...prev.slice(-49), newTranscript];
        }
      });
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
  }, [user, loadSavedRoom, saveRoomInfo, generateQRCode, splitIntoSentences]);

  // Start recording
  const startRecording = async () => {
    try {
      console.log("[Recording] 🎤 Starting recording...");
      console.log("[Recording] RoomId:", roomId);
      console.log("[Recording] Socket connected:", socketRef.current?.connected);
      console.log("[Recording] Socket ID:", socketRef.current?.id);

      setStatus("마이크 요청 중...");

      // Test microphone access first
      console.log("[Recording] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: false,  // Disable for higher sensitivity
          autoGainControl: false,    // Disable to control gain manually
        },
      });

      console.log("[Recording] ✅ Microphone access granted!");
      console.log("[Recording] Stream info:", {
        active: stream.active,
        tracks: stream.getTracks().length,
        audioTracks: stream.getAudioTracks().map(t => ({
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          settings: t.getSettings()
        }))
      });

      streamRef.current = stream;

      // Start MediaRecorder for local recording
      // Check supported mime types
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
      ];

      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          console.log(`[Recording] Using mime type: ${mimeType}`);
          break;
        }
      }

      if (!selectedMimeType) {
        console.error("[Recording] No supported mime type found!");
        selectedMimeType = 'audio/webm'; // Fallback
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(`[Recording] Chunk received: ${event.data.size} bytes (total chunks: ${recordedChunksRef.current.length})`);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("[Recording] MediaRecorder error:", event);
      };

      mediaRecorder.onstart = () => {
        console.log("[Recording] ✅ MediaRecorder started successfully");
        recordedChunksRef.current = []; // Clear previous recordings
      };

      mediaRecorder.onstop = () => {
        console.log(`[Recording] ✅ MediaRecorder stopped (total chunks: ${recordedChunksRef.current.length})`);

        // Calculate total recording duration
        const totalSize = recordedChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log(`[Recording] Total size: ${totalSize} bytes`);
      };

      try {
        // Use timeslice to continuously record chunks
        mediaRecorder.start(100); // Record in 100ms chunks for smoother recording
        mediaRecorderRef.current = mediaRecorder;
        console.log(`[Recording] MediaRecorder state: ${mediaRecorder.state}`);
      } catch (error) {
        console.error("[Recording] Failed to start MediaRecorder:", error);
      }

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      // Log actual sample rate (browsers may not honor requested rate)
      console.log(`[Audio] 🔧 AudioContext created`);
      console.log(`[Audio] Requested: 24000 Hz, Actual: ${audioContextRef.current.sampleRate} Hz`);
      console.log(`[Audio] State: ${audioContextRef.current.state}`);

      const source = audioContextRef.current.createMediaStreamSource(stream);
      console.log(`[Audio] ✅ Media stream source created`);

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      console.log(`[Audio] ✅ Analyser connected`);

      // Optimized buffer size - 2048 for lower latency
      const bufferSize = 2048;
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
      console.log(`[Audio] ✅ ScriptProcessor created (buffer size: ${bufferSize})`);

      let isProcessing = true;
      let frameCount = 0;
      const SEND_EVERY_N_FRAMES = 2; // Send every 2 frames to reduce CPU load
      let audioChunksSent = 0;
      let audioProcessCallCount = 0;

      processorRef.current.onaudioprocess = (e: any) => {
        audioProcessCallCount++;

        // Log first few calls to confirm the processor is running
        if (audioProcessCallCount <= 5) {
          console.log(`[Audio] 📢 onaudioprocess called #${audioProcessCallCount}`);
        }

        // Comprehensive validation with detailed logging
        if (!isProcessing) {
          if (audioChunksSent === 0) {
            console.warn("[Audio] ❌ Cannot send audio: not processing");
          }
          return;
        }

        if (!socketRef.current || !socketRef.current.connected) {
          if (audioChunksSent === 0) {
            console.error("[Audio] ❌ Cannot send audio: socket not connected");
            console.log("[Audio] Socket state:", {
              exists: !!socketRef.current,
              connected: socketRef.current?.connected,
              disconnected: socketRef.current?.disconnected
            });
          }
          return;
        }

        if (!roomId) {
          if (audioChunksSent === 0) {
            console.error("[Audio] ❌ Cannot send audio: roomId is missing");
          }
          return;
        }

        // Skip frames to reduce CPU usage
        frameCount++;
        if (frameCount % SEND_EVERY_N_FRAMES !== 0) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Calculate RMS for better noise detection
        let sum = 0;
        let maxSample = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
          maxSample = Math.max(maxSample, Math.abs(inputData[i]));
        }
        const rms = Math.sqrt(sum / inputData.length);

        // Detailed logging for first few chunks
        if (audioChunksSent < 10) {
          console.log(`[Audio] 🔊 Frame #${frameCount}: RMS=${rms.toFixed(6)}, Max=${maxSample.toFixed(6)}, threshold=0.002`);
        }

        // Lower threshold for higher sensitivity - SEND EVERYTHING for debugging
        if (rms > 0.001) {  // Very low threshold for testing
          const int16Data = new Int16Array(inputData.length);

          // High amplification for better sensitivity
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            const amplified = s * 3.5; // Increased from 3.0 to 3.5 for higher gain
            const clamped = Math.max(-1, Math.min(1, amplified));
            int16Data[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
          }

          // Convert to base64 efficiently
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));

          socketRef.current.emit("audio-stream", {
            roomId,
            audio: base64Audio,
          });

          audioChunksSent++;
          if (audioChunksSent <= 5 || audioChunksSent % 50 === 0) {
            console.log(`[Audio] ✅ Sent chunk #${audioChunksSent} to server (roomId: ${roomId}, size: ${int16Data.length * 2} bytes, RMS: ${rms.toFixed(6)})`);
          }
        } else if (audioChunksSent < 10) {
          console.log(`[Audio] 🔇 Audio too quiet, skipping (RMS=${rms.toFixed(6)})`);
        }
      };

      processorRef.current.isProcessing = isProcessing;

      analyserRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      console.log(`[Audio] ✅ Audio chain connected: Source -> Analyser -> Processor -> Destination`);

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
        const level = Math.min(100, Math.round(rms * 500)); // Increased from 300 to 500 for more sensitive meter
        setAudioLevel(level);

        animationRef.current = requestAnimationFrame(updateAudioLevel);
      };
      updateAudioLevel();

      setIsRecording(true);
      setStatus("녹음 중");

      console.log(`[Recording] ✅ Recording started successfully!`);
      console.log(`[Recording] Summary:`, {
        roomId,
        socketConnected: socketRef.current?.connected,
        streamActive: stream.active,
        audioContextState: audioContextRef.current.state,
        mediaRecorderState: mediaRecorderRef.current?.state
      });
    } catch (error) {
      console.error("[Recording] ❌ Recording error:", error);
      if (error instanceof Error) {
        console.error("[Recording] Error details:", error.message);
        console.error("[Recording] Stack trace:", error.stack);
      }
      setStatus("마이크 오류");
      alert("마이크 접근 권한이 필요합니다.");
    }
  };

  // Stop recording
  const stopRecording = () => {
    console.log("[Recording] Stopping recording...");
    setIsRecording(false);
    setStatus("정지");
    setAudioLevel(0);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    // Stop MediaRecorder with proper error handling
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          console.log(`[Recording] Stopping MediaRecorder (state: ${mediaRecorderRef.current.state})`);
          mediaRecorderRef.current.stop();
        }
      } catch (error) {
        console.error("[Recording] Error stopping MediaRecorder:", error);
      }
      mediaRecorderRef.current = null;
    }

    if (processorRef.current) {
      try {
        if (processorRef.current.isProcessing !== undefined) {
          processorRef.current.isProcessing = false;
        }
        processorRef.current.disconnect();
      } catch (error) {
        console.error("[Recording] Error disconnecting processor:", error);
      }
      processorRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch (error) {
        console.error("[Recording] Error disconnecting analyser:", error);
      }
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.error("[Recording] Error closing audio context:", error);
      }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          console.log(`[Recording] Stopping track: ${track.kind} (${track.label})`);
          track.stop();
        });
      } catch (error) {
        console.error("[Recording] Error stopping tracks:", error);
      }
      streamRef.current = null;
    }

    console.log(`[Recording] ✅ Recording stopped. Total chunks recorded: ${recordedChunksRef.current.length}`);
  };

  // Download recording
  const downloadRecording = () => {
    if (recordedChunksRef.current.length === 0) {
      alert("녹음된 내용이 없습니다.");
      return;
    }

    console.log(`[Recording] Creating download blob from ${recordedChunksRef.current.length} chunks`);

    // Calculate total size
    const totalSize = recordedChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
    console.log(`[Recording] Total recording size: ${totalSize} bytes`);

    const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording_${roomId}_${new Date().toISOString().replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[Recording] ✅ Download initiated`);
    if (addToast) {
      addToast('녹음 파일이 다운로드되었습니다', 'success');
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
      alert('로그인이 필요합니다');
      router.push('/login');
      return;
    }

    if (!roomId) {
      alert('저장할 세션이 없습니다');
      return;
    }

    if (transcripts.length === 0) {
      alert('저장할 번역 내용이 없습니다');
      return;
    }

    const roomName = prompt('세션 이름을 입력하세요', roomSettings.roomTitle || `Session ${roomId}`);
    if (!roomName) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          roomCode: roomId,
          roomName
        })
      });

      const data = await response.json();
      if (data.success) {
        alert('세션이 저장되었습니다');
      } else {
        alert(data.message || '저장에 실패했습니다');
      }
    } catch (error) {
      console.error('Save recording error:', error);
      alert('저장 중 오류가 발생했습니다');
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

        {/* Room Info - Compact Version */}
        <div className={styles.roomInfo}>
          <div className={styles.titleSection}>
            <h2>{roomSettings.roomTitle || speakerName || "Speaker"}</h2>
          </div>
          {roomId && (
            <div className={styles.roomCodeSection}>
              {/* Compact Room Code */}
              <div className={styles.roomCodeCompact}>
                <div className={styles.codeDisplay}>
                  <span className={styles.codeLabel}>방 코드</span>
                  <span className={styles.codeValue}>{roomId}</span>
                </div>
                <div className={styles.codeActions}>
                  <button onClick={() => copyToClipboard(roomId, "방 코드")} className={styles.iconButton} title="복사">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                  <button onClick={() => setShowQRModal(true)} className={styles.iconButton} title="QR 코드 보기">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1"/>
                      <rect x="14" y="3" width="7" height="7" rx="1"/>
                      <rect x="3" y="14" width="7" height="7" rx="1"/>
                      <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                  </button>
                  <button onClick={shareRoom} className={styles.iconButton} title="공유">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="18" cy="5" r="3"/>
                      <circle cx="6" cy="12" r="3"/>
                      <circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className={styles.actionButtons}>
                <button
                  onClick={downloadRecording}
                  className={styles.saveButton}
                  disabled={recordedChunksRef.current.length === 0}
                  title="녹음 파일 다운로드"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  녹음 다운로드
                </button>
                <button
                  onClick={saveRecording}
                  className={styles.saveButton}
                  disabled={!user || transcripts.length === 0}
                  title={!user ? "로그인이 필요합니다" : transcripts.length === 0 ? "저장할 내용이 없습니다" : "세션 저장"}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                    <polyline points="7 3 7 8 15 8"/>
                  </svg>
                  세션 저장
                </button>
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
            <h3>실시간 음성 인식</h3>
            <div className={styles.transcriptList}>
              {transcripts.slice(-10).map((item, index) => (
                <div key={index} className={styles.transcriptItem}>
                  {item.type === "stt" ? (
                    <p className={`${styles.sttText} ${!(item as any).isFinal ? styles.partialText : ''}`}>
                      {item.text}
                      {!(item as any).isFinal && <span className={styles.partialIndicator}> ...</span>}
                    </p>
                  ) : (
                    <div className={styles.translationContainer}>
                      <span className={styles.translationLabel}>🌐 번역</span>
                      <p className={styles.koreanText}>{item.korean}</p>
                      <p className={styles.englishText}>{item.english}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
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
              <label>번역 언어 (영어만 지원)</label>
              <div className={styles.languageGrid}>
                {TARGET_LANGUAGES.map((lang) => {
                  const isEnglish = lang.code === "en";
                  const isDisabled = !isEnglish;
                  return (
                    <label
                      key={lang.code}
                      className={`${styles.checkbox} ${isDisabled ? styles.disabled : ''}`}
                      title={isDisabled ? "현재 영어만 지원됩니다" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={roomSettings.targetLanguages.includes(lang.code)}
                        disabled={isDisabled}
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
                  );
                })}
              </div>
            </div>

            {/* Password */}
            <div className={styles.settingGroup}>
              <label>
                비밀번호 (선택)
                {roomSettings.password && (
                  <span style={{ marginLeft: '0.5rem', color: '#4ade80', fontSize: '0.875rem' }}>
                    ✓ 설정됨
                  </span>
                )}
              </label>
              <input
                type="password"
                value={roomSettings.password}
                onChange={(e) => setRoomSettings({ ...roomSettings, password: e.target.value })}
                className={styles.input}
                placeholder={roomId ? "비밀번호 변경 (공백으로 두면 제거)" : "비밀번호를 설정하지 않으면 누구나 입장 가능"}
              />
              {roomSettings.password && (
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8', marginTop: '0.5rem' }}>
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
        <div className={styles.qrModalOverlay}>
          <div className={styles.qrModalContent}>
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
