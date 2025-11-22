'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import Header from '@/components/Header';
import styles from './page.module.css';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      const code = roomId.trim().toUpperCase();
      console.log("🚪 Joining room with code:", code);
      router.push(`/listener/${code}`);
    }
  };

  const handleRoomIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setRoomId(value);
  };

  return (
    <>
      <Header />
      <main className={styles.main}>
        {/* Animated Background */}
        <div className={styles.background}>
          <div className={styles.gradientOrb1}></div>
          <div className={styles.gradientOrb2}></div>
          <div className={styles.gradientOrb3}></div>
          <div className={styles.grid}></div>
        </div>

        <div className={styles.container}>
          {/* Hero Section */}
          <div className={styles.hero}>
            <div className={styles.badge}>
              <span className={styles.badgeDot}></span>
              {t('home.badge')}
            </div>
            <h1 className={styles.title}>
              {t('home.title')} <br />
              <span className={styles.titleGradient}>{t('home.titleHighlight')}</span>
            </h1>
            <p className={styles.subtitle}>
              {t('home.subtitle')}
            </p>
          </div>

          {/* Action Cards */}
          <div className={styles.cards}>
            {/* Speaker Card */}
            <Link href={user ? "/speaker" : "/login"} className={styles.card}>
              <div className={styles.cardGlow}></div>
              <div className={styles.cardContent}>
                <div className={styles.cardIcon}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
                      stroke="url(#speakerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M19 10v2a7 7 0 0 1-14 0v-2"
                      stroke="url(#speakerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 19v4"
                      stroke="url(#speakerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 23h8"
                      stroke="url(#speakerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <defs>
                      <linearGradient id="speakerGradient" x1="0" y1="0" x2="24" y2="24">
                        <stop offset="0%" stopColor="#60a5fa"/>
                        <stop offset="100%" stopColor="#3b82f6"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <h2 className={styles.cardTitle}>{t('home.speakerMode')}</h2>
                <p className={styles.cardDescription}>
                  {t('home.speakerDesc')}
                </p>
                <div className={styles.cardFeatures}>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.speakerFeature1')}
                  </div>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.speakerFeature2')}
                  </div>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.speakerFeature3')}
                  </div>
                </div>
                <div className={styles.cardButton}>
                  {user ? t('home.startSpeaking') : t('common.login')}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </div>
              </div>
            </Link>

            {/* Listener Card */}
            <div className={styles.card}>
              <div className={styles.cardGlow}></div>
              <div className={styles.cardContent}>
                <div className={styles.cardIcon}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 18v-6a9 9 0 0 1 18 0v6"
                      stroke="url(#listenerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"
                      stroke="url(#listenerGradient)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <defs>
                      <linearGradient id="listenerGradient" x1="0" y1="0" x2="24" y2="24">
                        <stop offset="0%" stopColor="#3b82f6"/>
                        <stop offset="100%" stopColor="#06b6d4"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <h2 className={styles.cardTitle}>{t('home.listenerMode')}</h2>
                <p className={styles.cardDescription}>
                  {t('home.listenerDesc')}
                </p>
                <div className={styles.cardFeatures}>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.listenerFeature1')}
                  </div>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.listenerFeature2')}
                  </div>
                  <div className={styles.feature}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {t('home.listenerFeature3')}
                  </div>
                </div>
                <form onSubmit={handleJoinRoom} className={styles.joinForm}>
                  <input
                    type="text"
                    placeholder={t('speaker.roomCode')}
                    value={roomId}
                    onChange={handleRoomIdChange}
                    className={styles.input}
                    maxLength={6}
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className={styles.cardButton}
                    disabled={!roomId.trim()}
                  >
                    {roomId.trim() ? t('home.joinSession') : t('speaker.roomCode')}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Features Section */}
          <div className={styles.features}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h3 className={styles.featureTitle}>{t('home.features.realtime')}</h3>
              <p className={styles.featureText}>
                {t('home.features.realtimeDesc')}
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <h3 className={styles.featureTitle}>{t('home.features.multilang')}</h3>
              <p className={styles.featureText}>
                {t('home.features.multilangDesc')}
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <h3 className={styles.featureTitle}>{t('home.features.secure')}</h3>
              <p className={styles.featureText}>
                {t('home.features.secureDesc')}
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <h3 className={styles.featureTitle}>{t('home.features.save')}</h3>
              <p className={styles.featureText}>
                {t('home.features.saveDesc')}
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
