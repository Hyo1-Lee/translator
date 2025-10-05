import WebSocket from 'ws';
import { STTProvider, TranscriptResult } from './stt-provider.interface';
import { PromptTemplate, getPromptTemplate } from './prompts/prompt-templates';

/**
 * OpenAI Realtime API Configuration
 */
interface OpenAIRealtimeConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  temperature?: number;
  maxOutputTokens?: number | 'inf';
  vadThreshold?: number;
  vadSilenceDuration?: number;
  prefixPadding?: number;
  turnDetection?: 'server_vad' | 'disabled';
}

/**
 * Session Configuration for Realtime API
 */
interface SessionConfig {
  modalities: string[];
  instructions: string;
  voice: string;
  input_audio_format: string;
  output_audio_format: string;
  input_audio_transcription: {
    model: string;
  } | null;
  turn_detection: {
    type: string;
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  } | null;
  temperature: number;
  max_response_output_tokens?: number | 'inf';
}

/**
 * Audio Configuration
 */
interface AudioConfig {
  sampleRate: number;
  channels: number;
  encoding: string;
}

/**
 * Session State
 */
enum SessionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  READY = 'ready',
  ERROR = 'error'
}

/**
 * Production-grade OpenAI Realtime API Client
 *
 * Features:
 * - WebSocket-based real-time audio streaming
 * - Low-latency transcription using gpt-4o-realtime-preview
 * - Advanced prompt engineering for domain-specific accuracy
 * - Robust error handling and automatic reconnection
 * - Session state management
 * - Audio buffer management with backpressure handling
 * - Graceful degradation and recovery
 */
export class OpenAIRealtimeClient extends STTProvider {
  // Configuration
  private config: OpenAIRealtimeConfig;
  private audioConfig: AudioConfig;
  private promptTemplate: PromptTemplate;

  // WebSocket connection
  private ws: WebSocket | null = null;
  private sessionState: SessionState = SessionState.DISCONNECTED;
  private sessionId: string | null = null;

  // Reconnection logic
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000; // Start with 1 second
  private maxReconnectDelay: number = 30000; // Max 30 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Audio buffering
  private audioQueue: Buffer[] = [];
  private isProcessingAudio: boolean = false;
  private maxQueueSize: number = 100;

  // Session management
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private sessionTimeout: number = 60000; // 60 seconds

  // Performance metrics
  private metrics = {
    messagesReceived: 0,
    transcriptionsReceived: 0,
    audioBytesSent: 0,
    errors: 0,
    reconnections: 0,
    averageLatency: 0,
    lastLatencies: [] as number[]
  };

  constructor(
    roomId: string,
    config: OpenAIRealtimeConfig,
    promptTemplateName: string = 'church'
  ) {
    super(roomId);

    this.config = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'alloy',
      temperature: 0.8,
      maxOutputTokens: 4096,
      vadThreshold: 0.5,
      vadSilenceDuration: 500,
      prefixPadding: 300,
      turnDetection: 'server_vad',
      ...config
    };

    this.audioConfig = {
      sampleRate: 24000, // Realtime API uses 24kHz
      channels: 1,
      encoding: 'pcm16'
    };

    this.promptTemplate = getPromptTemplate(promptTemplateName);
  }

  /**
   * Connect to OpenAI Realtime API via WebSocket
   */
  async connect(): Promise<void> {
    if (this.sessionState === SessionState.CONNECTING ||
        this.sessionState === SessionState.CONNECTED) {
      console.log(`[STT][OpenAI][${this.roomId}] Already connecting or connected`);
      return;
    }

    try {
      this.sessionState = SessionState.CONNECTING;
      console.log(`[STT][OpenAI][${this.roomId}] ========================================`);
      console.log(`[STT][OpenAI][${this.roomId}] 🔌 Connecting to Realtime API...`);
      console.log(`[STT][OpenAI][${this.roomId}] 🤖 Model: ${this.config.model}`);
      console.log(`[STT][OpenAI][${this.roomId}] 📝 Prompt Template: ${this.promptTemplate.name}`);
      console.log(`[STT][OpenAI][${this.roomId}] 🎵 Audio: PCM16 @ 24kHz mono`);

      const url = 'wss://api.openai.com/v1/realtime?model=' + this.config.model;
      console.log(`[STT][OpenAI][${this.roomId}] 🌐 URL: ${url}`);

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey.substring(0, 10)}...`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.setupWebSocketHandlers();

      // Wait for connection with timeout
      await this.waitForConnection(10000);

    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] ❌ Connection failed:`, error);
      if (error instanceof Error) {
        console.error(`[STT][OpenAI][${this.roomId}] 💥 Error message: ${error.message}`);
        console.error(`[STT][OpenAI][${this.roomId}] 📋 Stack trace:`, error.stack);
      }
      this.sessionState = SessionState.ERROR;
      await this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log(`[STT][OpenAI][${this.roomId}] ✅ WebSocket connected successfully`);
      this.sessionState = SessionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.startHeartbeat();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        this.handleMessage(data);
        this.lastActivityTime = Date.now();
        this.metrics.messagesReceived++;
      } catch (error) {
        console.error(`[STT][OpenAI][${this.roomId}] ❌ Error handling message:`, error);
        if (error instanceof Error) {
          console.error(`[STT][OpenAI][${this.roomId}] Error details: ${error.message}`);
        }
      }
    });

    this.ws.on('error', (error) => {
      console.error(`[STT][OpenAI][${this.roomId}] ❌ WebSocket error:`, error);
      if (error instanceof Error) {
        console.error(`[STT][OpenAI][${this.roomId}] Error message: ${error.message}`);
      }
      this.metrics.errors++;
      this.emit('error', error);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[STT][OpenAI][${this.roomId}] 🔌 WebSocket closed: ${code} - ${reason}`);
      this.handleDisconnection(code, reason.toString());
    });
  }

  /**
   * Wait for WebSocket connection
   */
  private waitForConnection(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeout);

      const checkConnection = () => {
        if (this.sessionState === SessionState.READY) {
          clearTimeout(timeoutId);
          resolve();
        } else if (this.sessionState === SessionState.ERROR) {
          clearTimeout(timeoutId);
          reject(new Error('Connection failed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      console.log(`[STT][OpenAI][${this.roomId}] 📨 Received: ${message.type}`);

      switch (message.type) {
        case 'session.created':
          this.handleSessionCreated(message);
          break;

        case 'session.updated':
          this.handleSessionUpdated(message);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.handleTranscriptionCompleted(message);
          break;

        case 'input_audio_buffer.speech_started':
          this.handleSpeechStarted(message);
          break;

        case 'input_audio_buffer.speech_stopped':
          this.handleSpeechStopped(message);
          break;

        case 'error':
          this.handleError(message);
          break;

        case 'response.done':
        case 'response.audio.delta':
        case 'response.audio_transcript.delta':
          // Handle response events if needed
          console.log(`[STT][OpenAI][${this.roomId}] 📢 Response event: ${message.type}`);
          break;

        default:
          // Log unknown message types for debugging
          console.log(`[STT][OpenAI][${this.roomId}] ⚠️  Unknown message type: ${message.type}`);
          console.log(`[STT][OpenAI][${this.roomId}] Message data:`, JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] ❌ Failed to parse message:`, error);
      this.metrics.errors++;
    }
  }

  /**
   * Handle session.created event
   */
  private handleSessionCreated(message: any): void {
    this.sessionId = message.session.id;
    console.log(`[STT][OpenAI][${this.roomId}] ✅ Session created: ${this.sessionId}`);
    console.log(`[STT][OpenAI][${this.roomId}] Session details:`, JSON.stringify(message.session, null, 2));

    // Update session with our configuration
    this.updateSession();
  }

  /**
   * Update session configuration
   */
  private updateSession(): void {
    const sessionConfig: SessionConfig = {
      modalities: ['text', 'audio'],
      instructions: this.promptTemplate.instructions,
      voice: this.config.voice!,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: this.config.turnDetection === 'server_vad' ? {
        type: 'server_vad',
        threshold: this.config.vadThreshold,
        prefix_padding_ms: this.config.prefixPadding,
        silence_duration_ms: this.config.vadSilenceDuration
      } : null,
      temperature: this.config.temperature!,
      max_response_output_tokens: this.config.maxOutputTokens
    };

    console.log(`[STT][OpenAI][${this.roomId}] 📤 Sending session configuration...`);
    console.log(`[STT][OpenAI][${this.roomId}] Config:`, JSON.stringify(sessionConfig, null, 2));

    this.sendMessage({
      type: 'session.update',
      session: sessionConfig
    });
  }

  /**
   * Handle session.updated event
   */
  private handleSessionUpdated(message: any): void {
    console.log(`[STT][OpenAI][${this.roomId}] ✅ Session updated successfully`);
    console.log(`[STT][OpenAI][${this.roomId}] 🎉 Client is now READY for audio streaming`);
    console.log(`[STT][OpenAI][${this.roomId}] ========================================`);
    this.sessionState = SessionState.READY;
    this.isConnected = true;
    this.emit('connected');

    // Process any queued audio
    if (this.audioQueue.length > 0) {
      console.log(`[STT][OpenAI][${this.roomId}] 📦 Processing ${this.audioQueue.length} queued audio chunks...`);
    }
    this.processAudioQueue();
  }

  /**
   * Handle transcription completed event
   */
  private handleTranscriptionCompleted(message: any): void {
    console.log(`[STT][OpenAI][${this.roomId}] 📝 Transcription completed event received`);
    console.log(`[STT][OpenAI][${this.roomId}] Full message:`, JSON.stringify(message, null, 2));

    const transcript = message.transcript?.trim();

    if (!transcript) {
      console.warn(`[STT][OpenAI][${this.roomId}] ⚠️  Empty transcript received`);
      return;
    }

    const result: TranscriptResult = {
      text: transcript,
      confidence: 0.95, // Realtime API doesn't provide confidence scores
      final: true
    };

    this.metrics.transcriptionsReceived++;

    // Calculate latency if item_id has timestamp
    if (message.item_id) {
      this.updateLatencyMetrics();
    }

    this.emit('transcript', result);

    console.log(`[STT][OpenAI][${this.roomId}] ✅ Transcription: "${transcript}"`);
    console.log(`[STT][OpenAI][${this.roomId}] 📊 Total transcriptions: ${this.metrics.transcriptionsReceived}`);
  }

  /**
   * Handle speech started event
   */
  private handleSpeechStarted(message: any): void {
    console.log(`[STT][OpenAI][${this.roomId}] Speech detected`);
    this.emit('speech_started');
  }

  /**
   * Handle speech stopped event
   */
  private handleSpeechStopped(message: any): void {
    console.log(`[STT][OpenAI][${this.roomId}] Speech ended`);
    this.emit('speech_stopped');
  }

  /**
   * Handle error event
   */
  private handleError(message: any): void {
    const error = message.error;
    console.error(`[STT][OpenAI][${this.roomId}] API Error:`, error);
    this.metrics.errors++;
    this.emit('error', new Error(error.message || 'Unknown error'));
  }

  /**
   * Send audio data to the API
   */
  sendAudio(audioData: Buffer): void {
    if (this.sessionState !== SessionState.READY) {
      // Queue audio if not ready
      if (this.audioQueue.length < this.maxQueueSize) {
        this.audioQueue.push(audioData);
        console.log(`[STT][OpenAI][${this.roomId}] 📦 Queued audio (state: ${this.sessionState}, queue: ${this.audioQueue.length}/${this.maxQueueSize})`);
      } else {
        console.warn(`[STT][OpenAI][${this.roomId}] ⚠️  Audio queue full (${this.maxQueueSize}), dropping packet`);
      }
      return;
    }

    this.sendAudioToAPI(audioData);
  }

  /**
   * Send audio directly to API
   */
  private sendAudioToAPI(audioData: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[STT][OpenAI][${this.roomId}] ⚠️  WebSocket not ready (state: ${this.ws?.readyState})`);
      return;
    }

    // Convert to base64 as required by Realtime API
    const base64Audio = audioData.toString('base64');

    console.log(`[STT][OpenAI][${this.roomId}] 🎵 Sending ${audioData.length} bytes (${base64Audio.length} base64 chars)`);

    try {
      this.sendMessage({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      });

      this.metrics.audioBytesSent += audioData.length;
      console.log(`[STT][OpenAI][${this.roomId}] 📊 Total audio sent: ${this.metrics.audioBytesSent} bytes`);
    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] ❌ Failed to send audio:`, error);
      if (error instanceof Error) {
        console.error(`[STT][OpenAI][${this.roomId}] Error message: ${error.message}`);
      }
    }
  }

  /**
   * Process queued audio
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioQueue.length === 0) {
      return;
    }

    this.isProcessingAudio = true;

    while (this.audioQueue.length > 0 && this.sessionState === SessionState.READY) {
      const audioData = this.audioQueue.shift();
      if (audioData) {
        this.sendAudioToAPI(audioData);
      }
      // Small delay to prevent overwhelming the API
      await this.sleep(10);
    }

    this.isProcessingAudio = false;
  }

  /**
   * Commit audio buffer (end of speech segment)
   */
  endStream(): void {
    if (this.sessionState === SessionState.READY && this.ws) {
      this.sendMessage({
        type: 'input_audio_buffer.commit'
      });
      console.log(`[STT][OpenAI][${this.roomId}] Audio buffer committed`);
    }
  }

  /**
   * Send a message to the WebSocket
   */
  private sendMessage(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[STT][OpenAI][${this.roomId}] Cannot send message, WebSocket not open`);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[STT][OpenAI][${this.roomId}] Failed to send message:`, error);
      this.metrics.errors++;
    }
  }

  /**
   * Disconnect from the API
   */
  disconnect(): void {
    console.log(`[STT][OpenAI][${this.roomId}] Disconnecting...`);

    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Normal closure');
      }
      this.ws = null;
    }

    this.sessionState = SessionState.DISCONNECTED;
    this.sessionId = null;
    this.isConnected = false;
    this.audioQueue = [];

    this.emit('disconnected');
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(code: number, reason: string): void {
    this.sessionState = SessionState.DISCONNECTED;
    this.isConnected = false;
    this.stopHeartbeat();
    this.emit('disconnected');

    // Attempt reconnection for non-permanent errors
    if (code !== 1000 && code !== 1001 && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnection();
    }
  }

  /**
   * Handle connection error
   */
  private async handleConnectionError(error: any): Promise<void> {
    this.metrics.errors++;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      await this.attemptReconnection();
    } else {
      console.error(`[STT][OpenAI][${this.roomId}] Max reconnection attempts reached`);
      this.emit('error', new Error('Failed to connect after maximum attempts'));
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++;
    this.metrics.reconnections++;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(
      `[STT][OpenAI][${this.roomId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error(`[STT][OpenAI][${this.roomId}] Reconnection failed:`, error);
      }
    }, delay);
  }

  /**
   * Start heartbeat to detect stale connections
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;

      if (timeSinceActivity > this.sessionTimeout) {
        console.warn(`[STT][OpenAI][${this.roomId}] Session timeout, reconnecting...`);
        this.disconnect();
        this.connect();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Check if client is active
   */
  isActive(): boolean {
    return this.isConnected &&
           this.sessionState === SessionState.READY &&
           this.ws !== null &&
           this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'openai-realtime';
  }

  /**
   * Update prompt template dynamically
   */
  setPromptTemplate(templateName: string): void {
    this.promptTemplate = getPromptTemplate(templateName);

    if (this.sessionState === SessionState.READY) {
      this.updateSession();
      console.log(`[STT][OpenAI][${this.roomId}] Prompt template updated to: ${templateName}`);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      sessionState: this.sessionState,
      queueSize: this.audioQueue.length,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Update latency metrics
   */
  private updateLatencyMetrics(): void {
    const latency = Date.now() - this.lastActivityTime;
    this.metrics.lastLatencies.push(latency);

    if (this.metrics.lastLatencies.length > 10) {
      this.metrics.lastLatencies.shift();
    }

    this.metrics.averageLatency =
      this.metrics.lastLatencies.reduce((a, b) => a + b, 0) /
      this.metrics.lastLatencies.length;
  }

  /**
   * Utility: sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
