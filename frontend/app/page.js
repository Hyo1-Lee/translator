'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const router = useRouter();

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId.trim()) {
      router.push(`/listener?room=${roomId.trim().toUpperCase()}`);
    }
  };

  const handleRoomIdChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setRoomId(value);
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>ECHO</h1>
          <p className={styles.subtitle}>실시간 음성 번역 서비스</p>
        </div>

        <div className={styles.cards}>
          <Link href="/speaker" className={styles.speakerCard}>
            <div className={styles.cardContent}>
              <div className={styles.cardIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 19v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2>연사</h2>
              <p className={styles.cardDescription}>방송 시작하기</p>
            </div>
          </Link>

          <div className={styles.listenerCard}>
            <div className={styles.cardContent}>
              <div className={styles.cardIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2>청중</h2>
              <p className={styles.cardDescription}>세션 참여하기</p>
              <form onSubmit={handleJoinRoom} className={styles.joinForm}>
                <input
                  type="text"
                  placeholder="방 코드 입력"
                  value={roomId}
                  onChange={handleRoomIdChange}
                  className={styles.input}
                  maxLength={6}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className={styles.joinButton}
                  disabled={!roomId.trim()}
                >
                  {roomId.trim() ? '입장하기' : '코드 입력'}
                </button>
              </form>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}