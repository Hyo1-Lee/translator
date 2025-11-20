import WebSocket from "ws";
import axios from "axios";
import { STTProvider } from "./stt-provider.interface";

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
  private lastAudioTime: number = 0;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private firstAudioSentTime: number = 0;
  private audioChunkCount: number = 0;

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
      params.append("client_id", this.config.clientId);
      params.append("client_secret", this.config.clientSecret);

      const response = await axios.post(
        `${this.config.apiUrl}/v1/authenticate`,
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      if (response.status !== 200) {
        console.error(`[STT] Failed to get token: ${response.status}`);
        return null;
      }

      // Store token with expiration
      this.token = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + 23 * 60 * 60 * 1000, // 23 hours
      };

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
      throw new Error("Failed to obtain access token");
    }

    // WebSocket connection parameters - WHISPER for better accuracy
    const params = new URLSearchParams({
      sample_rate: "24000",
      encoding: "LINEAR16",
      // model_name: "whisper",
      language: "ko",
      use_itn: "true",
      use_disfluency_filter: "true",
      use_profanity_filter: "false",
      use_punctuation: "true",
    });

    const wsUrl = `wss://openapi.vito.ai/v1/transcribe:streaming?${params.toString()}`;

    // Create WebSocket connection
    this.ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `bearer ${token}`,
      },
    });

    // WebSocket event handlers
    this.ws.on("open", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.lastAudioTime = Date.now();
      this.emit("connected");
      this.processPendingAudio();
      this.startKeepAlive();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.error(`[STT][${this.roomId}] Parse error:`, error);
      }
    });

    this.ws.on("error", (error) => {
      console.error(`[STT][${this.roomId}] WebSocket error:`, error);
      this.emit("error", error);
    });

    this.ws.on("close", (code, reason) => {
      this.isConnected = false;
      this.ws = null;
      this.emit("disconnected");
      this.stopKeepAlive();

      // Auto-reconnect
      if (
        !this.isManualDisconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 2000);
      }
    });
  }

  // Handle incoming messages - OPTIMIZED with latency tracking
  private handleMessage(message: any): void {
    if (message.error) {
      console.error(`[STT][${this.roomId}] Error:`, message.error);
      this.emit("error", message.error);
      return;
    }

    if (message.alternatives && message.alternatives.length > 0) {
      const text = message.alternatives[0].text?.trim();
      if (text) {
        // Calculate latency from first audio to first result
        if (this.firstAudioSentTime > 0) {
          const latency = Date.now() - this.firstAudioSentTime;
          const isFinal = message.final || false;

          // Reset after final result
          if (isFinal) {
            this.firstAudioSentTime = 0;
            this.audioChunkCount = 0;
          }
        }

        this.emit("transcript", {
          text,
          confidence: message.alternatives[0].confidence,
          final: message.final || false,
        });
      }
    }
  }

  // Send audio data - FAST PATH with timing
  sendAudio(audioData: Buffer): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
      this.lastAudioTime = Date.now();

      // Track first audio sent for latency measurement
      this.audioChunkCount++;
      if (this.audioChunkCount === 1) {
        this.firstAudioSentTime = Date.now();
      } 
    } else {
      if (this.pendingAudioBuffer.length === 0) {
        console.warn(
          `[STT][${this.roomId}] ⚠️  WebSocket not ready, buffering audio. ` +
          `Connected: ${this.isConnected}, WS state: ${this.ws?.readyState}`
        );
      }
      this.pendingAudioBuffer.push(audioData);
      if (this.pendingAudioBuffer.length > 100) {
        this.pendingAudioBuffer.shift();
      }
    }
  }

  // Start keep-alive to prevent stream timeout
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (Date.now() - this.lastAudioTime > 3000) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(Buffer.alloc(4096, 0));
          this.lastAudioTime = Date.now();
        }
      }
    }, 2000);
  }

  // Stop keep-alive
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  // Process pending audio buffer
  private processPendingAudio(): void {
    if (this.pendingAudioBuffer.length > 0) {
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
      this.ws.send("EOS");
    }
  }

  // Disconnect
  disconnect(): void {
    this.isManualDisconnect = true;
    this.stopKeepAlive();

    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.endStream();
        this.ws.close();
      } catch (error) {
        console.error(`[STT][${this.roomId}] Close error:`, error);
      }
      this.ws = null;
      this.isConnected = false;
    }

    this.pendingAudioBuffer = [];
    this.reconnectAttempts = 0;
  }

  // Check connection status
  isActive(): boolean {
    return (
      this.isConnected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  // Get provider name
  getProviderName(): string {
    return "rtzr-vito";
  }
}
