"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import io from "socket.io-client";
import styles from "./speaker.module.css";

// Constants
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const STORAGE_KEY = "speaker_room_info";

export default function Speaker() {
  // State management
  const [roomId, setRoomId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [status, setStatus] = useState("준비");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [transcripts, setTranscripts] = useState([]);

  // Refs
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const router = useRouter();

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
  const saveRoomInfo = useCallback((roomCode, name) => {
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

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to server");
      setIsConnected(true);
      setStatus("연결됨");

      // Check for saved room
      const savedRoom = loadSavedRoom();
      if (savedRoom && savedRoom.roomCode) {
        // Try to rejoin existing room
        const name =
          savedRoom.speakerName ||
          prompt("연사 이름을 입력하세요:") ||
          "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", {
          name,
          existingRoomCode: savedRoom.roomCode,
        });
      } else {
        // Create new room
        const name = prompt("연사 이름을 입력하세요:") || "Speaker";
        setSpeakerName(name);
        socketRef.current.emit("create-room", { name });
      }
    });

    socketRef.current.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
      setStatus("연결 끊김");
    });

    socketRef.current.on("room-created", (data) => {
      setRoomId(data.roomId);
      saveRoomInfo(data.roomId, speakerName);
      if (data.isRejoined) {
        setStatus("방 재입장");
      } else {
        setStatus("방 생성됨");
      }
    });

    socketRef.current.on("room-rejoined", (data) => {
      setRoomId(data.roomId);
      setStatus("방 재연결됨");
    });

    socketRef.current.on("listener-count", (data) => {
      setListenerCount(data.count);
    });

    // Listen for transcripts
    socketRef.current.on("stt-text", (data) => {
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

    socketRef.current.on("translation-batch", (data) => {
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

    socketRef.current.on("error", (data) => {
      console.error("Socket error:", data);
      setStatus(`오류: ${data.message}`);
    });

    return () => {
      stopRecording();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [speakerName, loadSavedRoom, saveRoomInfo]);

  // Start recording
  const startRecording = async () => {
    try {
      setStatus("마이크 요청 중...");

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      // Create audio context
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = audioContextRef.current.createMediaStreamSource(stream);

      // Create analyser for audio level
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Create script processor for streaming
      const bufferSize = 2048;
      processorRef.current = audioContextRef.current.createScriptProcessor(
        bufferSize,
        1,
        1
      );

      let isProcessing = true;

      processorRef.current.onaudioprocess = (e) => {
        if (!isProcessing || !socketRef.current || !roomId) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Check audio level
        let maxLevel = 0;
        for (let i = 0; i < inputData.length; i++) {
          maxLevel = Math.max(maxLevel, Math.abs(inputData[i]));
        }

        // Send audio if not silent
        if (maxLevel > 0.001) {
          // Convert to Int16Array
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Encode to base64 and send
          const base64Audio = btoa(
            String.fromCharCode(...new Uint8Array(int16Data.buffer))
          );

          socketRef.current.emit("audio-stream", {
            roomId,
            audio: base64Audio,
          });
        }
      };

      // Store processing state
      processorRef.current.isProcessing = isProcessing;

      analyserRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      // Start audio level monitoring
      const updateAudioLevel = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);

        // Calculate RMS
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
      const name =
        prompt("연사 이름을 입력하세요:") || speakerName || "Speaker";
      setSpeakerName(name);
      socketRef.current.emit("create-room", { name });
    }
  };

  // Copy room code to clipboard
  const copyRoomCode = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      alert("방 코드가 복사되었습니다.");
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <button
            onClick={() => router.push("/")}
            className={styles.backButton}
          >
            ← 돌아가기
          </button>
          <div className={styles.connectionStatus}>
            <span
              className={isConnected ? styles.connected : styles.disconnected}
            >
              {isConnected ? "● 연결됨" : "○ 연결 끊김"}
            </span>
          </div>
        </div>

        <div className={styles.roomInfo}>
          <h2>{speakerName || "Speaker"}</h2>
          {roomId && (
            <div className={styles.roomCode}>
              <p className={styles.label}>방 코드</p>
              <div className={styles.codeContainer}>
                <p className={styles.code}>{roomId}</p>
                <button onClick={copyRoomCode} className={styles.copyButton}>
                  복사
                </button>
              </div>
              <button onClick={createNewRoom} className={styles.newRoomButton}>
                새 방 만들기
              </button>
            </div>
          )}
        </div>

        <div className={styles.stats}>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>청취자</span>
            <span className={styles.statusValue}>{listenerCount}명</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>상태</span>
            <span className={styles.statusValue}>{status}</span>
          </div>
        </div>

        {/* Audio level meter */}
        {isRecording && (
          <div className={styles.audioLevel}>
            <span className={styles.audioLabelText}>마이크 레벨</span>
            <div className={styles.audioMeter}>
              <div
                className={styles.audioBar}
                style={{
                  width: `${audioLevel}%`,
                  backgroundColor:
                    audioLevel > 70
                      ? "#ff6b6b"
                      : audioLevel > 30
                      ? "#51cf66"
                      : "#868e96",
                }}
              />
            </div>
            <span className={styles.audioPercent}>{audioLevel}%</span>
          </div>
        )}

        <div className={styles.controls}>
          {!isRecording ? (
            <button
              onClick={startRecording}
              className={styles.startButton}
              disabled={!roomId || !isConnected}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: "#ef4444",
                  marginRight: "8px",
                }}
              ></span>
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
              {transcripts.slice(-3).map((item, index) => (
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
    </main>
  );
}
