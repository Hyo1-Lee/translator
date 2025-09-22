'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import io from 'socket.io-client';
import styles from './speaker.module.css';

export default function Speaker() {
  const [roomId, setRoomId] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [status, setStatus] = useState('준비');
  const [audioLevel, setAudioLevel] = useState(0);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    socketRef.current = io('http://localhost:5000'); // Node.js 백엔드로 변경!

    socketRef.current.on('connect', () => {
      socketRef.current.emit('create-room', { name: '연사' });
    });

    socketRef.current.on('room-created', (data) => {
      setRoomId(data.roomId);
    });

    socketRef.current.on('listener-count', (data) => {
      setListenerCount(data.count);
    });

    return () => {
      stopRecording();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const startRecording = async () => {
    try {
      setStatus('시작 중...');

      // 마이크 권한 요청
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // AudioContext 설정
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });

      const source = audioContextRef.current.createMediaStreamSource(stream);

      // 오디오 레벨 분석을 위한 Analyser 노드 추가
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // ScriptProcessor로 오디오 처리 (실시간 스트리밍)
      const bufferSize = 2048;
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);

      let streamCount = 0;
      let localIsRecording = true; // 로컬 변수 사용

      processorRef.current.onaudioprocess = (e) => {
        if (!localIsRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // 오디오 레벨 체크
        let maxLevel = 0;
        for (let i = 0; i < inputData.length; i++) {
          maxLevel = Math.max(maxLevel, Math.abs(inputData[i]));
        }

        // 무음이 아닌 경우에만 전송 (감도를 더 민감하게)
        if (maxLevel > 0.0003) {
          // Float32Array를 Int16Array로 변환
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Base64로 인코딩하여 서버로 전송
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));

          if (socketRef.current && roomId) {
            socketRef.current.emit('audio-stream', {
              roomId,
              audio: base64Audio
            });
            streamCount++;
          }
        }
      };

      // 나중에 stop 시 사용하기 위해 저장
      processorRef.current.localIsRecording = localIsRecording;

      analyserRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      // 오디오 레벨 모니터링 시작
      const updateAudioLevel = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);

        // RMS (Root Mean Square) 계산
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, Math.round(rms * 300)); // 0-100 범위로 정규화
        setAudioLevel(level);

        animationRef.current = requestAnimationFrame(updateAudioLevel);
      };
      updateAudioLevel();

      setIsRecording(true);
      setStatus('듣는 중');
    } catch (error) {
      console.error('Recording error:', error);
      setStatus('마이크 오류');
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setStatus('정지');
    setAudioLevel(0);

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (processorRef.current) {
      // 오디오 처리 중지
      if (processorRef.current.localIsRecording !== undefined) {
        processorRef.current.localIsRecording = false;
      }
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <button onClick={() => router.push('/')} className={styles.backButton}>
          ← 돌아가기
        </button>

        {roomId && (
          <div className={styles.roomCode}>
            <p className={styles.label}>방 코드</p>
            <p className={styles.code}>{roomId}</p>
          </div>
        )}

        <div className={styles.status}>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>청취자</span>
            <span className={styles.statusValue}>{listenerCount}</span>
          </div>
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>상태</span>
            <span className={styles.statusValue}>{status}</span>
          </div>
        </div>

        {/* 마이크 레벨 표시 */}
        <div className={styles.audioLevel}>
          <span className={styles.audioLabelText}>마이크 레벨</span>
          <div className={styles.audioMeter}>
            <div
              className={styles.audioBar}
              style={{
                width: `${audioLevel}%`,
                backgroundColor: audioLevel > 70 ? '#ff6b6b' : audioLevel > 30 ? '#51cf66' : '#868e96'
              }}
            />
          </div>
          <span className={styles.audioPercent}>{audioLevel}%</span>
        </div>

        <div className={styles.controls}>
          {!isRecording ? (
            <button
              onClick={startRecording}
              className={styles.startButton}
              disabled={!roomId}
            >
              시작
            </button>
          ) : (
            <button onClick={stopRecording} className={styles.stopButton}>
              정지
            </button>
          )}
        </div>
      </div>
    </main>
  );
}