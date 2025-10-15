'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import styles from './login.module.css';

type Step = 'email' | 'password' | 'verify' | 'terms' | 'signup';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');

  const router = useRouter();
  const { login } = useAuth();

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        if (data.data.exists && data.data.hasPassword) {
          setStep('password');
        } else {
          await sendVerificationCode();
        }
      } else {
        setError(data.message || 'Failed to check email');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const sendVerificationCode = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStep('verify');
      } else {
        setError(data.message || 'Failed to send verification code');
      }
    } catch (err) {
      setError('Failed to send verification code');
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setVerifiedEmail(data.data.email);
        setStep('terms');
      } else {
        setError(data.message || 'Invalid verification code');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTermsAccept = () => {
    if (termsAccepted && privacyAccepted) {
      setStep('signup');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifiedEmail, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        login(data.data.tokens.accessToken, data.data.tokens.refreshToken, data.data.user);
        router.push('/dashboard');
      } else {
        setError(data.message || 'Signup failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        login(data.data.tokens.accessToken, data.data.tokens.refreshToken, data.data.user);
        router.push('/dashboard');
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Animated Background */}
      <div className={styles.background}>
        <div className={styles.gradientOrb1}></div>
        <div className={styles.gradientOrb2}></div>
        <div className={styles.gradientOrb3}></div>
      </div>

      <div className={styles.content}>
        {/* Logo/Brand */}
        <div className={styles.brand}>
          <div className={styles.logoIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="url(#gradient)" opacity="0.2"/>
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" stroke="url(#gradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="12" r="4" fill="url(#gradient)"/>
              <defs>
                <linearGradient id="gradient" x1="2" y1="2" x2="22" y2="22">
                  <stop offset="0%" stopColor="#3b82f6"/>
                  <stop offset="100%" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className={styles.brandName}>ECHO</h1>
          <p className={styles.brandTagline}>Real-time Translation Service</p>
        </div>

        {/* Auth Card */}
        <div className={styles.card}>
          {/* Email Step */}
          {step === 'email' && (
            <form onSubmit={handleEmailSubmit} className={styles.form}>
              <h2 className={styles.title}>Welcome</h2>
              <p className={styles.subtitle}>Enter your email to continue</p>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={styles.input}
                  placeholder="you@example.com"
                />
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="submit"
                disabled={isLoading}
                className={styles.button}
              >
                {isLoading ? 'Checking...' : 'Continue'}
              </button>

              <div className={styles.divider}>
                <span>Or continue with</span>
              </div>

              <div className={styles.socialButtons}>
                <button type="button" disabled className={styles.socialButton}>
                  <svg className={styles.socialIcon} viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </button>
                <button type="button" disabled className={styles.socialButton}>
                  <svg className={styles.socialIcon} viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#FEE500" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                    <path fill="#3C1E1E" d="M10 8.5c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5v1c0 .28-.22.5-.5.5h-3c-.28 0-.5-.22-.5-.5v-1zm4.5 7h-5c-.28 0-.5-.22-.5-.5v-1c0-.28.22-.5.5-.5h5c.28 0 .5.22.5.5v1c0 .28-.22.5-.5.5z"/>
                  </svg>
                  Kakao
                </button>
              </div>

              <button
                type="button"
                onClick={() => router.push('/')}
                className={styles.backLink}
              >
                ← Back to Home
              </button>
            </form>
          )}

          {/* Password Login Step */}
          {step === 'password' && (
            <form onSubmit={handlePasswordLogin} className={styles.form}>
              <h2 className={styles.title}>Welcome back!</h2>
              <p className={styles.subtitle}>{email}</p>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={styles.input}
                />
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="submit"
                disabled={isLoading}
                className={styles.button}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>

              <button
                type="button"
                onClick={() => setStep('email')}
                className={styles.backLink}
              >
                ← Back
              </button>
            </form>
          )}

          {/* Verification Step */}
          {step === 'verify' && (
            <form onSubmit={handleVerifyCode} className={styles.form}>
              <div className={styles.iconContainer}>
                <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className={styles.title}>Check your email</h2>
              <p className={styles.subtitle}>
                We sent a 6-digit code to<br/><strong>{email}</strong>
              </p>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Verification Code</label>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  maxLength={6}
                  className={`${styles.input} ${styles.codeInput}`}
                  placeholder="000000"
                />
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="submit"
                disabled={isLoading || verificationCode.length !== 6}
                className={styles.button}
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={() => setStep('email')}
                className={styles.backLink}
              >
                ← Back
              </button>
            </form>
          )}

          {/* Terms Step */}
          {step === 'terms' && (
            <div className={styles.form}>
              <div className={styles.iconContainer}>
                <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className={styles.title}>Welcome to ECHO!</h2>
              <p className={styles.subtitle}>Please review and accept our policies</p>

              <div className={styles.checkboxGroup}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                  />
                  <span>I agree to the <a href="#" onClick={(e) => e.preventDefault()}>Terms of Service</a></span>
                </label>

                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  />
                  <span>I agree to the <a href="#" onClick={(e) => e.preventDefault()}>Privacy Policy</a></span>
                </label>
              </div>

              <button
                onClick={handleTermsAccept}
                disabled={!termsAccepted || !privacyAccepted}
                className={styles.button}
              >
                Continue
              </button>
            </div>
          )}

          {/* Signup Step */}
          {step === 'signup' && (
            <form onSubmit={handleSignup} className={styles.form}>
              <h2 className={styles.title}>Set Your Password</h2>
              <p className={styles.subtitle}>Create a secure password for your account</p>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={styles.input}
                  placeholder="At least 8 characters"
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className={styles.input}
                />
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="submit"
                disabled={isLoading}
                className={styles.button}
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
