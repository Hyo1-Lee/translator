'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import Header from '@/components/Header';
import styles from './page.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

interface Transcript {
  id: string;
  timestamp: string;
  korean: string;
  english: string;
}

interface Recording {
  id: string;
  roomCode: string;
  roomName: string;
  duration: number;
  transcripts: Transcript[];
  createdAt: string;
}

export default function RecordingsPage() {
  const router = useRouter();
  const { user, accessToken, isLoading } = useAuth();
  const toast = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecordings = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/list`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();
      if (data.success) {
        setRecordings(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch recordings:', error);
      toast.error('녹음 목록을 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  }, [accessToken, toast]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user && accessToken) {
      fetchRecordings();
    }
  }, [user, accessToken, fetchRecordings]);

  const deleteRecording = async (id: string) => {
    if (!confirm('이 녹음을 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();
      if (data.success) {
        toast.success('녹음이 삭제되었습니다');
        fetchRecordings();
      }
    } catch (error) {
      console.error('Failed to delete recording:', error);
      toast.error('녹음 삭제에 실패했습니다');
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading || loading) {
    return (
      <>
        <Header />
        <main className={styles.main}>
          <div className={styles.loading}>로딩 중...</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.title}>저장된 녹음</h1>

          {recordings.length === 0 ? (
            <div className={styles.empty}>
              <p>저장된 녹음이 없습니다</p>
              <button onClick={() => router.push('/speaker')} className={styles.createButton}>
                새 세션 시작하기
              </button>
            </div>
          ) : (
            <div className={styles.grid}>
              {recordings.map((recording) => (
                <div key={recording.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <h3>{recording.roomName}</h3>
                    <span className={styles.roomCode}>{recording.roomCode}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.stat}>
                      <span className={styles.label}>길이:</span>
                      <span className={styles.value}>{formatDuration(recording.duration)}</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.label}>번역:</span>
                      <span className={styles.value}>{recording.transcripts.length}개</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.label}>날짜:</span>
                      <span className={styles.value}>
                        {new Date(recording.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      onClick={() => router.push(`/recordings/${recording.id}`)}
                      className={styles.viewButton}
                    >
                      보기
                    </button>
                    <button
                      onClick={() => deleteRecording(recording.id)}
                      className={styles.deleteButton}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
