'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import Header from '@/components/Header';
import styles from './page.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

interface Transcript {
  korean: string;
  english: string;
  translations: Record<string, string>;
  timestamp: number;
}

interface Recording {
  id: string;
  roomCode: string;
  roomName: string;
  duration: number;
  transcripts: Transcript[];
  createdAt: string;
}

const LANGUAGES = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'pt', name: 'Português' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'hi', name: 'हिन्दी' },
];

export default function RecordingDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, accessToken, isLoading } = useAuth();
  const toast = useToast();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user && accessToken && params.id) {
      fetchRecording();
    }
  }, [user, accessToken, params.id]);

  const fetchRecording = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/${params.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();
      if (data.success) {
        setRecording(data.data);
        setEditedName(data.data.roomName);
      } else {
        toast.error('녹음을 찾을 수 없습니다');
        router.push('/recordings');
      }
    } catch (error) {
      console.error('Failed to fetch recording:', error);
      toast.error('녹음을 불러오는데 실패했습니다');
      router.push('/recordings');
    } finally {
      setLoading(false);
    }
  };

  const updateRecordingName = async () => {
    if (!editedName.trim() || editedName === recording?.roomName) {
      setIsEditing(false);
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/recordings/${params.id}/name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ roomName: editedName })
      });

      const data = await response.json();
      if (data.success) {
        setRecording(prev => prev ? { ...prev, roomName: editedName } : null);
        toast.success('이름이 변경되었습니다');
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Failed to update recording name:', error);
      toast.error('이름 변경에 실패했습니다');
    }
  };

  const exportRecording = (format: 'txt' | 'json') => {
    if (!recording) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'txt') {
      content = `${recording.roomName}\n`;
      content += `Room Code: ${recording.roomCode}\n`;
      content += `Date: ${new Date(recording.createdAt).toLocaleString()}\n`;
      content += `Duration: ${formatDuration(recording.duration)}\n\n`;
      content += `=== Transcripts ===\n\n`;

      recording.transcripts.forEach((t, index) => {
        const timestamp = formatTimestamp(t.timestamp - recording.transcripts[0].timestamp);
        content += `[${timestamp}]\n`;
        content += `Korean: ${t.korean}\n`;
        if (selectedLanguage === 'en') {
          content += `English: ${t.english}\n`;
        } else if (t.translations && t.translations[selectedLanguage]) {
          const langName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage;
          content += `${langName}: ${t.translations[selectedLanguage]}\n`;
        }
        content += `\n`;
      });

      filename = `${recording.roomName}_${recording.roomCode}.txt`;
      mimeType = 'text/plain';
    } else {
      content = JSON.stringify(recording, null, 2);
      filename = `${recording.roomName}_${recording.roomCode}.json`;
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`${format.toUpperCase()} 파일로 내보냈습니다`);
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

  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

  if (!recording) {
    return (
      <>
        <Header />
        <main className={styles.main}>
          <div className={styles.error}>녹음을 찾을 수 없습니다</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.container}>
          {/* Header Section */}
          <div className={styles.recordingHeader}>
            <button onClick={() => router.push('/recordings')} className={styles.backButton}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              뒤로 가기
            </button>

            <div className={styles.titleSection}>
              {isEditing ? (
                <div className={styles.editTitle}>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className={styles.titleInput}
                    autoFocus
                  />
                  <button onClick={updateRecordingName} className={styles.saveBtn}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </button>
                  <button onClick={() => { setIsEditing(false); setEditedName(recording.roomName); }} className={styles.cancelBtn}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <div className={styles.titleDisplay}>
                  <h1 className={styles.title}>{recording.roomName}</h1>
                  <button onClick={() => setIsEditing(true)} className={styles.editBtn}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                </div>
              )}

              <div className={styles.metadata}>
                <span className={styles.roomCode}>{recording.roomCode}</span>
                <span className={styles.metaItem}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {formatDuration(recording.duration)}
                </span>
                <span className={styles.metaItem}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {new Date(recording.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className={styles.actions}>
              <button onClick={() => exportRecording('txt')} className={styles.exportButton}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                TXT
              </button>
              <button onClick={() => exportRecording('json')} className={styles.exportButton}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                JSON
              </button>
            </div>
          </div>

          {/* Language Selector */}
          <div className={styles.languageSelector}>
            <label className={styles.languageLabel}>번역 언어:</label>
            <div className={styles.languageGrid}>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang.code)}
                  className={selectedLanguage === lang.code ? styles.langButtonActive : styles.langButton}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </div>

          {/* Transcripts */}
          <div className={styles.transcriptsSection}>
            <h2 className={styles.sectionTitle}>
              대화 기록 ({recording.transcripts.length}개)
            </h2>

            {recording.transcripts.length === 0 ? (
              <div className={styles.emptyTranscripts}>
                대화 기록이 없습니다
              </div>
            ) : (
              <div className={styles.transcriptsList}>
                {recording.transcripts.map((transcript, index) => {
                  const relativeTime = index === 0 ? 0 : transcript.timestamp - recording.transcripts[0].timestamp;
                  const translation = selectedLanguage === 'ko'
                    ? transcript.korean
                    : selectedLanguage === 'en'
                    ? transcript.english
                    : transcript.translations?.[selectedLanguage] || transcript.english;

                  return (
                    <div key={index} className={styles.transcriptCard}>
                      <div className={styles.transcriptHeader}>
                        <span className={styles.transcriptTime}>
                          {formatTimestamp(relativeTime)}
                        </span>
                        <span className={styles.transcriptIndex}>#{index + 1}</span>
                      </div>

                      {selectedLanguage === 'ko' ? (
                        <div className={styles.transcriptContent}>
                          <div className={styles.originalText}>{transcript.korean}</div>
                        </div>
                      ) : (
                        <div className={styles.transcriptContent}>
                          <div className={styles.originalText}>{transcript.korean}</div>
                          <div className={styles.divider}></div>
                          <div className={styles.translatedText}>{translation}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
