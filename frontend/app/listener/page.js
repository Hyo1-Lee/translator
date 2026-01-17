'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import io from 'socket.io-client';
import styles from './listener.module.css';

// Constants
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
const STORAGE_KEY = 'listener_preferences';

function ListenerContent() {
  // State management
  const [roomCode, setRoomCode] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [speakerName, setSpeakerName] = useState('');
  const [listenerName, setListenerName] = useState('');
  const [sttChunks, setSttChunks] = useState([]);
  const [translationChunks, setTranslationChunks] = useState([]);
  const [currentSttText, setCurrentSttText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
  const [fontSize, setFontSize] = useState('medium');

  // Refs
  const socketRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Get room from URL if provided
  const urlRoom = searchParams.get('room');

  // Load preferences
  const loadPreferences = useCallback(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const prefs = JSON.parse(saved);
          setListenerName(prefs.listenerName || '');
          setAutoScroll(prefs.autoScroll !== false);
          setShowTranslation(prefs.showTranslation !== false);
          setFontSize(prefs.fontSize || 'medium');
          return prefs;
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }
    return null;
  }, []);

  // Save preferences
  const savePreferences = useCallback((prefs) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sttChunks, translationChunks, currentSttText, autoScroll]);

  // Initialize socket connection
  useEffect(() => {
    // Load preferences
    const prefs = loadPreferences();

    // Set room code from URL if provided
    if (urlRoom) {
      setRoomCode(urlRoom.toUpperCase());
    } else if (prefs?.lastRoomCode) {
      setRoomCode(prefs.lastRoomCode);
    }

    socketRef.current = io(BACKEND_URL, {
      transports: ['websocket', 'polling']
    });

    socketRef.current.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);

      // Auto-join if room code is from URL
      if (urlRoom && !isJoined) {
        const name = prefs?.listenerName || 'Guest';
        setListenerName(name);
        socketRef.current.emit('join-room', {
          roomId: urlRoom.toUpperCase(),
          name
        });
      }
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    socketRef.current.on('room-joined', (data) => {
      console.log('[Listener] Room joined:', data);
      setSpeakerName(data.speakerName);
      setIsJoined(true);
    });

    // Listen for STT texts - continuous text stream
    socketRef.current.on('stt-text', (data) => {
      console.log('[Listener] Received stt-text:', data);
      // Only append new texts, ignore history (history comes from translation-batch)
      if (!data.isHistory) {
        setCurrentSttText(prev => prev ? prev + ' ' + data.text : data.text);
      }
    });

    // Listen for translations - creates chunks
    socketRef.current.on('translation-batch', (data) => {
      console.log('[Listener] Received translation-batch:', data);

      if (data.isHistory) {
        // For history, add the batch Korean text as a chunk (already combined)
        setSttChunks(prev => [...prev, {
          id: `stt-${data.batchId || Date.now()}-${Math.random()}`,
          text: data.korean,
          timestamp: data.timestamp,
          isHistory: true
        }]);
      }
      // Note: For real-time, we don't create STT chunks here anymore
      // The STT text is already being displayed via currentSttText

      // Add translation chunk (English only)
      setTranslationChunks(prev => [...prev, {
        id: `trans-${data.batchId || Date.now()}-${Math.random()}`,
        text: data.english,
        timestamp: data.timestamp,
        isHistory: data.isHistory || false
      }]);
    });

    socketRef.current.on('error', (data) => {
      console.error('Socket error:', data);
      toast.error(data.message || '오류가 발생했습니다.');
      if (data.message === 'Room not found') {
        setIsJoined(false);
        setRoomCode('');
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRoom]);

  // Join room
  const joinRoom = () => {
    if (!roomCode.trim()) {
      toast.error('방 코드를 입력해주세요.');
      return;
    }

    const name = listenerName || prompt('이름을 입력하세요 (선택사항):') || 'Guest';
    setListenerName(name);

    // Save preferences
    savePreferences({
      listenerName: name,
      autoScroll,
      showTranslation,
      fontSize,
      lastRoomCode: roomCode
    });

    socketRef.current.emit('join-room', {
      roomId: roomCode.toUpperCase(),
      name
    });
  };

  // Leave room
  const leaveRoom = () => {
    setIsJoined(false);
    setSpeakerName('');
    setSttChunks([]);
    setTranslationChunks([]);
    setCurrentSttText('');
    setRoomCode('');

    // Remove room from URL if present
    if (urlRoom) {
      router.push('/listener');
    }

    socketRef.current.disconnect();
    socketRef.current = io(BACKEND_URL, {
      transports: ['websocket', 'polling']
    });
  };

  // Export transcripts
  const exportTranscripts = () => {
    let data = '';

    // Combine chunks with their translations
    for (let i = 0; i < Math.max(sttChunks.length, translationChunks.length); i++) {
      if (sttChunks[i]) {
        data += `[Korean] ${sttChunks[i].text}\n`;
      }
      if (translationChunks[i]) {
        data += `[English] ${translationChunks[i].text}\n`;
      }
      data += '\n';
    }

    // Add current text if exists
    if (currentSttText) {
      data += `\n[Current] ${currentSttText}`;
    }

    const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${roomCode}_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear transcripts
  const clearTranscripts = () => {
    if (confirm('모든 기록을 삭제하시겠습니까?')) {
      setSttChunks([]);
      setTranslationChunks([]);
      setCurrentSttText('');
    }
  };

  // Toggle settings
  const toggleAutoScroll = () => {
    setAutoScroll(!autoScroll);
    savePreferences({
      listenerName,
      autoScroll: !autoScroll,
      showTranslation,
      fontSize
    });
  };

  const toggleShowTranslation = () => {
    setShowTranslation(!showTranslation);
    savePreferences({
      listenerName,
      autoScroll,
      showTranslation: !showTranslation,
      fontSize
    });
  };

  const changeFontSize = (size) => {
    setFontSize(size);
    savePreferences({
      listenerName,
      autoScroll,
      showTranslation,
      fontSize: size
    });
  };

  if (!isJoined) {
    return (
      <main className={styles.main}>
        <div className={styles.joinContainer}>
          <button onClick={() => router.push('/')} className={styles.backButton}>
            ← 돌아가기
          </button>

          <div className={styles.joinBox}>
            <h1>청취자 모드</h1>
            <p>방 코드를 입력하여 실시간 번역을 확인하세요</p>

            <div className={styles.connectionStatus}>
              <span className={isConnected ? styles.connected : styles.disconnected}>
                {isConnected ? '● 서버 연결됨' : '○ 서버 연결 중...'}
              </span>
            </div>

            <input
              type="text"
              placeholder="방 코드 입력 (예: ABC123)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
              className={styles.input}
              maxLength={6}
            />

            <button
              onClick={joinRoom}
              disabled={!isConnected || !roomCode.trim()}
              className={styles.joinButton}
            >
              입장하기
            </button>

            <div className={styles.tips}>
              <h3>💡 사용 팁</h3>
              <ul>
                <li>연사로부터 6자리 방 코드를 받으세요</li>
                <li>입장 후 실시간으로 번역된 내용을 확인할 수 있습니다</li>
                <li>번역 내용은 텍스트 파일로 내보낼 수 있습니다</li>
                <li>자동 스크롤, 글꼴 크기 등을 조정할 수 있습니다</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={leaveRoom} className={styles.leaveButton}>
            ← 나가기
          </button>
          <div className={styles.roomInfo}>
            <span className={styles.speakerName}>{speakerName}</span>
            <span className={styles.roomCodeDisplay}>방 코드: {roomCode}</span>
          </div>
          <div className={styles.connectionStatus}>
            <span className={isConnected ? styles.connected : styles.disconnected}>
              {isConnected ? '● 연결됨' : '○ 연결 끊김'}
            </span>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button
              onClick={toggleAutoScroll}
              className={autoScroll ? styles.toolButtonActive : styles.toolButton}
            >
              {autoScroll ? '📜 자동 스크롤' : '📜 수동 스크롤'}
            </button>
            <button
              onClick={toggleShowTranslation}
              className={showTranslation ? styles.toolButtonActive : styles.toolButton}
            >
              {showTranslation ? '🌐 번역 표시' : '🇰🇷 원문만'}
            </button>
            <select
              value={fontSize}
              onChange={(e) => changeFontSize(e.target.value)}
              className={styles.fontSizeSelector}
            >
              <option value="small">글꼴: 작게</option>
              <option value="medium">글꼴: 보통</option>
              <option value="large">글꼴: 크게</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <button onClick={clearTranscripts} className={styles.toolButton}>
              🗑️ 초기화
            </button>
            <button
              onClick={exportTranscripts}
              className={styles.exportButton}
              disabled={sttChunks.length === 0 && !currentSttText}
            >
              💾 내보내기
            </button>
          </div>
        </div>

        <div className={styles.contentArea}>
          {/* Left: STT real-time continuous text */}
          <div className={styles.sttSection}>
            <div className={styles.sectionHeader}>🎤 실시간 음성인식</div>
            <div className={`${styles.sttContainer} ${styles[`fontSize-${fontSize}`]}`}>
              {sttChunks.length === 0 && !currentSttText ? (
                <div className={styles.emptyState}>
                  <p>음성 인식 대기 중...</p>
                  <p>연사가 말을 시작하면 여기에 표시됩니다</p>
                </div>
              ) : (
                <div className={styles.continuousText}>
                  {/* Show completed chunks */}
                  {sttChunks.map((chunk) => (
                    <div key={chunk.id} className={styles.textChunk}>
                      {chunk.text}
                    </div>
                  ))}
                  {/* Show current ongoing text */}
                  {currentSttText && (
                    <span className={styles.currentText}>
                      {currentSttText}
                      <span className={styles.cursor}>|</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: English Translation only */}
          {showTranslation && (
            <div className={styles.translationSection}>
              <div className={styles.sectionHeader}>🌐 English Translation</div>
              <div className={`${styles.translationsContainer} ${styles[`fontSize-${fontSize}`]}`}>
                {translationChunks.length === 0 ? (
                  <div className={styles.emptyState}>
                    <p>Waiting for translation...</p>
                    <p>Translation will appear after speech is recognized</p>
                  </div>
                ) : (
                  <div className={styles.continuousText}>
                    {translationChunks.map((chunk) => (
                      <span key={chunk.id} className={styles.translationChunk}>
                        {chunk.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={transcriptEndRef} />
      </div>
    </main>
  );
}

export default function Listener() {
  return (
    <Suspense fallback={
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    }>
      <ListenerContent />
    </Suspense>
  );
}