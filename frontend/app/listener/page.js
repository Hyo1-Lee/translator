'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import io from 'socket.io-client';
import styles from './listener.module.css';

function ListenerContent() {
  const [connected, setConnected] = useState(false);
  const [sttBatches, setSttBatches] = useState([]);  // STT 텍스트 배치별로 저장
  const [currentBatch, setCurrentBatch] = useState('');  // 현재 모아지고 있는 배치
  const [translations, setTranslations] = useState([]);  // 번역된 텍스트 배치

  const socketRef = useRef(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get('room');

  useEffect(() => {
    if (!roomId) {
      router.push('/');
      return;
    }

    socketRef.current = io('http://localhost:5000'); // Node.js 백엔드로 변경!

    socketRef.current.on('connect', () => {
      socketRef.current.emit('join-room', { roomId });
    });

    socketRef.current.on('room-joined', () => {
      setConnected(true);
    });

    // STT 원문 수신 (실시간)
    socketRef.current.on('stt-text', (data) => {
      setCurrentBatch(prev => {
        // 현재 배치에 텍스트 추가
        return prev ? prev + ' ' + data.text : data.text;
      });
    });

    // 번역 배치 수신 (4-5문장씩)
    socketRef.current.on('translation-batch', (data) => {
      // 번역 시작 시 현재 배치를 완성된 배치로 이동
      if (data.english === '번역 중...' && currentBatch) {
        setSttBatches(prev => [...prev, currentBatch]);
        setCurrentBatch('');
      }

      setTranslations(prev => {
        // 같은 배치 ID가 있으면 업데이트, 없으면 추가
        const existingIndex = prev.findIndex(item => item.batchId === data.batchId);

        if (existingIndex !== -1) {
          // 기존 배치 업데이트 (번역 완료)
          const updated = [...prev];
          updated[existingIndex] = data;
          return updated;
        } else {
          // 새 배치 추가 (영어만 저장)
          return [...prev, {
            batchId: data.batchId,
            english: data.english,
            timestamp: data.timestamp
          }];
        }
      });
    });

    socketRef.current.on('speaker-disconnected', () => {
      alert('연사가 연결을 끊었습니다.');
      router.push('/');
    });

    socketRef.current.on('error', (error) => {
      alert(error.message || '연결 오류');
      router.push('/');
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomId, router]);

  // 자동 스크롤을 위한 ref
  const sttEndRef = useRef(null);
  const translationEndRef = useRef(null);

  // STT 텍스트 추가 시 자동 스크롤
  useEffect(() => {
    sttEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sttBatches, currentBatch]);

  // 번역 추가 시 자동 스크롤
  useEffect(() => {
    translationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [translations]);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => router.push('/')} className={styles.backButton}>
            ← 나가기
          </button>
          <span className={styles.connectionStatus}>
            {connected ? '연결됨' : '연결 중...'}
          </span>
        </div>

        <div className={styles.contentArea}>
          {/* 왼쪽: STT 실시간 텍스트 */}
          <div className={styles.sttSection}>
            <div className={styles.sectionHeader}>실시간 음성 인식</div>
            <div className={styles.sttContainer}>
              {sttBatches.length === 0 && !currentBatch ? (
                <div className={styles.emptyState}>
                  <p>음성 인식 대기 중...</p>
                </div>
              ) : (
                <>
                  {/* 완성된 배치들 (문단처럼 표시) */}
                  {sttBatches.map((batch, index) => (
                    <div key={index} className={styles.textParagraph}>
                      {batch}
                    </div>
                  ))}
                  {/* 현재 진행 중인 배치 */}
                  {currentBatch && (
                    <div className={styles.textParagraphCurrent}>
                      {currentBatch}
                    </div>
                  )}
                  <div ref={sttEndRef} />
                </>
              )}
            </div>
          </div>

          {/* 오른쪽: 번역된 텍스트 (배치) */}
          <div className={styles.translationSection}>
            <div className={styles.sectionHeader}>번역</div>
            <div className={styles.translationsContainer}>
              {translations.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>번역 대기 중...</p>
                </div>
              ) : (
                <>
                  {translations.map((batch, index) => (
                    <div key={batch.batchId || index} className={styles.textParagraph}>
                      {batch.english === '번역 중...' ? (
                        <span className={styles.translating}>번역 중...</span>
                      ) : (
                        batch.english
                      )}
                    </div>
                  ))}
                  <div ref={translationEndRef} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Listener() {
  return (
    <Suspense fallback={<div style={{ padding: '20px' }}>Loading...</div>}>
      <ListenerContent />
    </Suspense>
  );
}