import WebSocket from 'ws';
import axios from 'axios';
import { STTProvider, TranscriptResult } from './stt-provider.interface';

interface RTZRConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

interface RTZRToken {
  accessToken: string;
  expiresAt: number;
}

export class RTZRClient extends STTProvider {
  private config: RTZRConfig;
  private token: RTZRToken | null = null;
  private ws: WebSocket | null = null;
  private pendingAudioBuffer: Buffer[] = [];
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private isManualDisconnect: boolean = false;

  constructor(roomId: string, config: RTZRConfig) {
    super(roomId);
    this.config = config;
  }

  // Get access token from RTZR API
  private async getToken(): Promise<string | null> {
    try {
      // Check if token is still valid
      if (this.token && this.token.expiresAt > Date.now()) {
        return this.token.accessToken;
      }

      // Request new token - RTZR uses form data, not JSON
      const params = new URLSearchParams();
      params.append('client_id', this.config.clientId);
      params.append('client_secret', this.config.clientSecret);

      const response = await axios.post(
        `${this.config.apiUrl}/v1/authenticate`,
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.status !== 200) {
        console.error(`[STT] Failed to get token: ${response.status}`);
        return null;
      }

      // Store token with expiration
      this.token = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (23 * 60 * 60 * 1000) // 23 hours
      };

      console.log(`[STT][${this.roomId}] Token obtained successfully`);
      return this.token.accessToken;
    } catch (error) {
      console.error(`[STT][${this.roomId}] Failed to get token:`, error);
      return null;
    }
  }

  // Connect to WebSocket
  async connect(): Promise<void> {
    // Reset manual disconnect flag when reconnecting
    this.isManualDisconnect = false;

    const token = await this.getToken();
    if (!token) {
      throw new Error('Failed to obtain access token');
    }

    // WebSocket connection parameters - using only confirmed parameters
    const params = new URLSearchParams({
      sample_rate: '24000', // 8000 ~ 48000 (changed to 24000 to match frontend and OpenAI)
      encoding: 'LINEAR16', // LINEAR16, FLAC, MULAW, ALAW, AMR, AMR_WB, OGG_OPUS, OPUS
      model_name: 'sommers_ko', // sommers_ko, whisper
      domain: 'MEETING', // CALL, MEETING
      use_itn: 'false', // 영어/숫자/단위 변환
      use_disfluency_filter: 'true',
      use_profanity_filter: 'false',
      use_punctuation: 'true',
      // language: 'ko' // whisper인 경우
    });

    const wsUrl = `wss://openapi.vito.ai/v1/transcribe:streaming?${params.toString()}`;

    // Create WebSocket connection
    this.ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `bearer ${token}`
      }
    });

    // WebSocket event handlers
    this.ws.on('open', () => {
      console.log(`[STT][${this.roomId}] WebSocket connected`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');

      // Process pending audio
      this.processPendingAudio();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`[STT][${this.roomId}] 📨 Received message from VITO:`, JSON.stringify(message));
        this.handleMessage(message);
      } catch (error) {
        console.error(`[STT][${this.roomId}] Failed to parse message:`, error);
        console.error(`[STT][${this.roomId}] Raw message:`, data.toString());
      }
    });

    this.ws.on('error', (error) => {
      console.error(`[STT][${this.roomId}] WebSocket error:`, error);
      this.emit('error', error);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[STT][${this.roomId}] WebSocket closed: ${code} - ${reason}`);
      this.isConnected = false;
      this.ws = null;
      this.emit('disconnected');

      // Auto-reconnect logic (only if not manually disconnected)
      if (!this.isManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[STT][${this.roomId}] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), 2000);
      } else if (this.isManualDisconnect) {
        console.log(`[STT][${this.roomId}] Manual disconnect - not reconnecting`);
      }
    });
  }

  // Handle incoming messages
  private handleMessage(message: any): void {
    // Check for error
    if (message.error) {
      console.error(`[STT][${this.roomId}] ❌ Error from server:`, message.error);
      this.emit('error', message.error);
      return;
    }

    // Process transcript
    if (message.alternatives && message.alternatives.length > 0) {
      const alternative = message.alternatives[0];
      const text = alternative.text?.trim();

      console.log(`[STT][${this.roomId}] 📝 Transcript received:`, {
        text,
        confidence: alternative.confidence,
        final: message.final || false
      });

      if (text) {
        const result: TranscriptResult = {
          text,
          confidence: alternative.confidence,
          final: message.final || false
        };

        // Emit both partial and final transcripts for real-time display
        if (result.final) {
          console.log(`[STT][${this.roomId}] ✅ Emitting FINAL transcript: "${text}"`);
        } else {
          console.log(`[STT][${this.roomId}] ⏳ Emitting PARTIAL transcript: "${text}"`);
        }
        this.emit('transcript', result);
      }
    } else {
      console.log(`[STT][${this.roomId}] 🤔 Message has no alternatives:`, message);
    }
  }

  // Send audio data
  sendAudio(audioData: Buffer): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
      // Log first few audio sends for debugging
      const sendCount = (this as any)._audioSendCount || 0;
      (this as any)._audioSendCount = sendCount + 1;
      if (sendCount < 3) {
        console.log(`[STT][${this.roomId}] 🎤 Sent audio chunk #${sendCount + 1} (${audioData.length} bytes)`);
      }
    } else {
      // Buffer audio if not connected
      console.warn(`[STT][${this.roomId}] ⚠️  WebSocket not ready, buffering audio (state: ${this.ws?.readyState})`);
      this.pendingAudioBuffer.push(audioData);

      // Limit buffer size to prevent memory issues
      if (this.pendingAudioBuffer.length > 100) {
        this.pendingAudioBuffer.shift(); // Remove oldest
      }
    }
  }

  // Process pending audio buffer
  private processPendingAudio(): void {
    if (this.pendingAudioBuffer.length > 0) {
      console.log(`[STT][${this.roomId}] Processing ${this.pendingAudioBuffer.length} pending audio chunks`);

      for (const audio of this.pendingAudioBuffer) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(audio);
        }
      }

      this.pendingAudioBuffer = [];
    }
  }

  // End of stream
  endStream(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send('EOS');
    }
  }

  // Disconnect
  disconnect(): void {
    console.log(`[STT][${this.roomId}] Disconnecting client...`);
    this.isManualDisconnect = true;

    if (this.ws) {
      // Remove all event listeners to prevent any reconnection attempts
      this.ws.removeAllListeners();

      // Close the connection
      try {
        this.endStream();
        this.ws.close();
      } catch (error) {
        console.error(`[STT][${this.roomId}] Error closing WebSocket:`, error);
      }

      this.ws = null;
      this.isConnected = false;
    }

    // Clear pending audio buffer
    this.pendingAudioBuffer = [];
    this.reconnectAttempts = 0;
  }

  // Check connection status
  isActive(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // Get provider name
  getProviderName(): string {
    return 'rtzr-vito';
  }
}