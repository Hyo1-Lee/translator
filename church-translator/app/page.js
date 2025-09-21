'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  const [roomId, setRoomId] = useState('');

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>실시간 번역</h1>
          <p className={styles.subtitle}>한국어 → English</p>
        </div>

        <div className={styles.cards}>
          <Link href="/speaker" className={styles.speakerCard}>
            <h2>연사</h2>
            <p>새 방 만들기</p>
          </Link>

          <div className={styles.listenerCard}>
            <h2>청중</h2>
            <input
              type="text"
              placeholder="방 코드"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className={styles.input}
              maxLength={10}
            />
            {roomId && (
              <Link
                href={`/listener?room=${roomId}`}
                className={styles.joinButton}
              >
                참가
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}