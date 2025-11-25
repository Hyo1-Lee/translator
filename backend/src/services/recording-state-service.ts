import { Room } from '../models/Room';
import { Server } from 'socket.io';
import { sessionManager } from './session-manager';

/**
 * RecordingStateService
 *
 * Manages recording state across multiple devices
 * - Persists recording state in DB for multi-device sync
 * - Broadcasts state changes to all connected speaker sockets
 * - Ensures consistency when speaker controls recording from different devices
 */
export class RecordingStateService {
  private io: Server | null = null;

  /**
   * Initialize the service with Socket.IO instance for broadcasting
   */
  setSocketIO(io: Server): void {
    this.io = io;
  }

  /**
   * Start recording for a room
   * Broadcasts to all connected speaker devices
   */
  async startRecording(roomId: string): Promise<void> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    if (room.isRecording) {
      console.log(`[RecordingState] ⚠️ Room ${roomId} is already recording`);
      return;
    }

    await room.update({
      isRecording: true,
      lastHeartbeat: new Date(),
    });

    console.log(`[RecordingState] ▶️ Started recording for room ${roomId}`);

    // Broadcast to all speaker sockets
    await this.broadcastRecordingState(roomId, true);
  }

  /**
   * Stop recording for a room
   * Broadcasts to all connected speaker devices
   */
  async stopRecording(roomId: string): Promise<void> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    if (!room.isRecording) {
      console.log(`[RecordingState] ⚠️ Room ${roomId} is not recording`);
      return;
    }

    await room.update({
      isRecording: false,
      lastHeartbeat: new Date(),
    });

    console.log(`[RecordingState] ⏹️ Stopped recording for room ${roomId}`);

    // Broadcast to all speaker sockets
    await this.broadcastRecordingState(roomId, false);
  }

  /**
   * Toggle recording state for a room
   * Returns the new state
   */
  async toggleRecording(roomId: string): Promise<boolean> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    const newState = !room.isRecording;

    await room.update({
      isRecording: newState,
      lastHeartbeat: new Date(),
    });

    console.log(
      `[RecordingState] ${newState ? '▶️' : '⏹️'} Toggled recording for room ${roomId} to ${newState}`
    );

    // Broadcast to all speaker sockets
    await this.broadcastRecordingState(roomId, newState);

    return newState;
  }

  /**
   * Get current recording state for a room
   */
  async getRecordingState(roomId: string): Promise<boolean> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      return false;
    }

    return room.isRecording;
  }

  /**
   * Broadcast recording state change to all active speaker sockets
   * This enables multi-device synchronization
   */
  private async broadcastRecordingState(roomId: string, isRecording: boolean): Promise<void> {
    if (!this.io) {
      console.warn('[RecordingState] ⚠️ Socket.IO not initialized, cannot broadcast');
      return;
    }

    // Get all active speaker sockets for this room
    const speakerSockets = await sessionManager.getActiveSpeakerSockets(roomId);

    if (speakerSockets.length === 0) {
      console.log(`[RecordingState] ℹ️ No active speaker sockets for room ${roomId}`);
      return;
    }

    // Emit to each speaker socket
    speakerSockets.forEach(socketId => {
      this.io?.to(socketId).emit('recording-state-changed', {
        roomId,
        isRecording,
        timestamp: new Date().toISOString(),
      });
    });

    console.log(
      `[RecordingState] 📡 Broadcasted state ${isRecording} to ${speakerSockets.length} speaker socket(s)`
    );
  }

  /**
   * Sync recording state for a newly connected speaker
   * Sends current state when speaker reconnects or joins from new device
   */
  async syncRecordingState(roomId: string, socketId: string): Promise<void> {
    if (!this.io) {
      console.warn('[RecordingState] ⚠️ Socket.IO not initialized, cannot sync');
      return;
    }

    const room = await Room.findByPk(roomId);
    if (!room) {
      return;
    }

    // Send current state to the specific socket
    this.io.to(socketId).emit('recording-state-synced', {
      roomId,
      isRecording: room.isRecording,
      timestamp: new Date().toISOString(),
    });

    console.log(`[RecordingState] 🔄 Synced state ${room.isRecording} to socket ${socketId}`);
  }

  /**
   * Pause recording when speaker disconnects temporarily
   * Useful for app switching or reconnection scenarios
   */
  async pauseOnDisconnect(roomId: string): Promise<void> {
    const speakerSockets = await sessionManager.getActiveSpeakerSockets(roomId);

    // Only pause if no speaker sockets are active
    if (speakerSockets.length === 0) {
      const room = await Room.findByPk(roomId);
      if (room && room.isRecording) {
        await room.update({
          isRecording: false,
        });
        console.log(`[RecordingState] ⏸️ Auto-paused recording for room ${roomId} (no active speakers)`);
      }
    }
  }
}

export const recordingStateService = new RecordingStateService();
