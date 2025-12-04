/**
 * Background Session Manager
 *
 * Keeps the session alive when:
 * - Screen is turned off
 * - App is in background
 * - User switches to another app
 *
 * Techniques used:
 * 1. Wake Lock API - Prevents screen from turning off
 * 2. Silent Audio - Plays inaudible audio to keep browser active
 * 3. Visibility API - Detects when app goes to background and reconnects
 */

interface BackgroundSessionOptions {
  onVisibilityChange?: (isVisible: boolean) => void;
  onWakeLockError?: (error: Error) => void;
  onReconnectNeeded?: () => void;
}

export class BackgroundSessionManager {
  private wakeLock: WakeLockSentinel | null = null;
  private silentAudioContext: AudioContext | null = null;
  private silentOscillator: OscillatorNode | null = null;
  private silentGain: GainNode | null = null;
  private isActive: boolean = false;
  private options: BackgroundSessionOptions;
  private lastActiveTime: number = Date.now();
  private visibilityHandler: (() => void) | null = null;
  private reconnectCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: BackgroundSessionOptions = {}) {
    this.options = options;
  }

  /**
   * Start background session management
   */
  async start(): Promise<void> {
    if (this.isActive) return;
    this.isActive = true;

    // 1. Request Wake Lock
    await this.requestWakeLock();

    // 2. Start silent audio (for mobile background)
    this.startSilentAudio();

    // 3. Listen for visibility changes
    this.setupVisibilityListener();

    // 4. Start periodic reconnect check
    this.startReconnectCheck();

    console.log('[BackgroundSession] Started');
  }

  /**
   * Stop background session management
   */
  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;

    // Release Wake Lock
    this.releaseWakeLock();

    // Stop silent audio
    this.stopSilentAudio();

    // Remove visibility listener
    this.removeVisibilityListener();

    // Stop reconnect check
    this.stopReconnectCheck();

    console.log('[BackgroundSession] Stopped');
  }

  /**
   * Request Wake Lock to prevent screen from turning off
   */
  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      console.warn('[WakeLock] Wake Lock API not supported');
      return;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');

      this.wakeLock.addEventListener('release', () => {
        console.log('[WakeLock] Released');
        // Try to re-acquire if still active
        if (this.isActive) {
          this.requestWakeLock();
        }
      });

      console.log('[WakeLock] Acquired');
    } catch (error) {
      console.error('[WakeLock] Failed to acquire:', error);
      this.options.onWakeLockError?.(error as Error);
    }
  }

  /**
   * Release Wake Lock
   */
  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        console.log('[WakeLock] Released manually');
      } catch (error) {
        console.error('[WakeLock] Failed to release:', error);
      }
    }
  }

  /**
   * Start playing silent audio to keep browser active in background
   * This is a common technique used by audio apps to prevent suspension
   */
  private startSilentAudio(): void {
    try {
      // Create audio context
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[SilentAudio] AudioContext not supported');
        return;
      }

      this.silentAudioContext = new AudioContextClass();

      // Create oscillator with inaudible frequency
      this.silentOscillator = this.silentAudioContext.createOscillator();
      this.silentOscillator.frequency.setValueAtTime(1, this.silentAudioContext.currentTime); // 1Hz - inaudible

      // Create gain node with zero volume
      this.silentGain = this.silentAudioContext.createGain();
      this.silentGain.gain.setValueAtTime(0.001, this.silentAudioContext.currentTime); // Nearly silent

      // Connect: oscillator -> gain -> destination
      this.silentOscillator.connect(this.silentGain);
      this.silentGain.connect(this.silentAudioContext.destination);

      // Start oscillator
      this.silentOscillator.start();

      console.log('[SilentAudio] Started');
    } catch (error) {
      console.error('[SilentAudio] Failed to start:', error);
    }
  }

  /**
   * Stop silent audio
   */
  private stopSilentAudio(): void {
    try {
      if (this.silentOscillator) {
        this.silentOscillator.stop();
        this.silentOscillator.disconnect();
        this.silentOscillator = null;
      }

      if (this.silentGain) {
        this.silentGain.disconnect();
        this.silentGain = null;
      }

      if (this.silentAudioContext) {
        this.silentAudioContext.close();
        this.silentAudioContext = null;
      }

      console.log('[SilentAudio] Stopped');
    } catch (error) {
      console.error('[SilentAudio] Failed to stop:', error);
    }
  }

  /**
   * Setup visibility change listener
   */
  private setupVisibilityListener(): void {
    this.visibilityHandler = () => {
      const isVisible = document.visibilityState === 'visible';
      console.log(`[Visibility] ${isVisible ? 'Visible' : 'Hidden'}`);

      this.options.onVisibilityChange?.(isVisible);

      if (isVisible) {
        // App became visible - check if reconnect is needed
        const timeSinceActive = Date.now() - this.lastActiveTime;
        if (timeSinceActive > 5000) {
          // More than 5 seconds in background - trigger reconnect
          console.log('[Visibility] Was in background for', timeSinceActive, 'ms, triggering reconnect');
          this.options.onReconnectNeeded?.();
        }

        // Re-acquire wake lock (it gets released when page is hidden)
        this.requestWakeLock();
      } else {
        // App going to background
        this.lastActiveTime = Date.now();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Remove visibility listener
   */
  private removeVisibilityListener(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /**
   * Start periodic check to ensure session is still alive
   */
  private startReconnectCheck(): void {
    this.reconnectCheckInterval = setInterval(() => {
      // This interval itself helps keep the JS engine active
      this.lastActiveTime = Date.now();
    }, 10000); // Every 10 seconds
  }

  /**
   * Stop reconnect check
   */
  private stopReconnectCheck(): void {
    if (this.reconnectCheckInterval) {
      clearInterval(this.reconnectCheckInterval);
      this.reconnectCheckInterval = null;
    }
  }

  /**
   * Resume audio context (call after user interaction)
   */
  async resumeAudioContext(): Promise<void> {
    if (this.silentAudioContext && this.silentAudioContext.state === 'suspended') {
      await this.silentAudioContext.resume();
      console.log('[SilentAudio] Resumed');
    }
  }

  /**
   * Check if Wake Lock is currently held
   */
  get hasWakeLock(): boolean {
    return this.wakeLock !== null;
  }

  /**
   * Check if background session is active
   */
  get active(): boolean {
    return this.isActive;
  }
}

/**
 * React hook for background session management
 */
export function useBackgroundSession() {
  const managerRef = { current: null as BackgroundSessionManager | null };

  const start = async (options?: BackgroundSessionOptions) => {
    if (!managerRef.current) {
      managerRef.current = new BackgroundSessionManager(options);
    }
    await managerRef.current.start();
    return managerRef.current;
  };

  const stop = () => {
    managerRef.current?.stop();
  };

  const resumeAudio = async () => {
    await managerRef.current?.resumeAudioContext();
  };

  return { start, stop, resumeAudio, manager: managerRef };
}
