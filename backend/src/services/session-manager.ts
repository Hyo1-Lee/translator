import { Room } from '../models/Room';
import { Op } from 'sequelize';

/**
 * SessionManager
 *
 * Handles speaker authentication and session management
 * - Validates speaker access using userId instead of volatile socket.id
 * - Manages active speaker socket connections for multi-device support
 * - Tracks session heartbeats for cleanup
 */
export class SessionManager {
  /**
   * Validates if a user is authorized to act as the speaker for a room
   * Uses userId for persistent authentication across reconnections
   */
  async validateSpeaker(roomId: string, userId: string | null): Promise<boolean> {
    if (!userId) {
      console.warn(`[SessionManager] ❌ No userId provided for room ${roomId}`);
      return false;
    }

    const room = await Room.findByPk(roomId);
    if (!room) {
      console.warn(`[SessionManager] ❌ Room not found: ${roomId}`);
      return false;
    }

    if (room.userId !== userId) {
      console.warn(
        `[SessionManager] ❌ Unauthorized speaker attempt (expected: ${room.userId}, got: ${userId})`
      );
      return false;
    }

    return true;
  }

  /**
   * Registers a new speaker socket connection
   * Supports multiple devices connected as the same speaker
   */
  async registerSpeakerSocket(roomId: string, socketId: string): Promise<void> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    const currentSockets = Array.isArray(room.activeSpeakerSockets)
      ? room.activeSpeakerSockets
      : [];

    if (!currentSockets.includes(socketId)) {
      await room.update({
        activeSpeakerSockets: [...currentSockets, socketId],
        lastHeartbeat: new Date(),
      });
      console.log(`[SessionManager] ✅ Registered speaker socket ${socketId} for room ${roomId}`);
    }
  }

  /**
   * Unregisters a speaker socket connection (on disconnect)
   */
  async unregisterSpeakerSocket(roomId: string, socketId: string): Promise<void> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      return;
    }

    const currentSockets = Array.isArray(room.activeSpeakerSockets)
      ? room.activeSpeakerSockets
      : [];

    const updatedSockets = currentSockets.filter(id => id !== socketId);

    await room.update({
      activeSpeakerSockets: updatedSockets,
      lastHeartbeat: updatedSockets.length > 0 ? new Date() : null,
    });

    console.log(`[SessionManager] ✅ Unregistered speaker socket ${socketId} from room ${roomId}`);
  }

  /**
   * Gets all active speaker sockets for a room
   * Used for broadcasting recording state changes to all speaker devices
   */
  async getActiveSpeakerSockets(roomId: string): Promise<string[]> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      return [];
    }

    return Array.isArray(room.activeSpeakerSockets)
      ? room.activeSpeakerSockets
      : [];
  }

  /**
   * Updates heartbeat timestamp for active sessions
   * Should be called periodically (e.g., every 30 seconds)
   */
  async updateHeartbeat(roomId: string): Promise<void> {
    const room = await Room.findByPk(roomId);
    if (!room) {
      return;
    }

    const currentSockets = Array.isArray(room.activeSpeakerSockets)
      ? room.activeSpeakerSockets
      : [];

    if (currentSockets.length > 0) {
      await room.update({
        lastHeartbeat: new Date(),
      });
    }
  }

  /**
   * Cleanup stale sessions (no heartbeat for > threshold)
   * Should be run periodically as a background job
   */
  async cleanupStaleSessions(thresholdMinutes: number = 10): Promise<number> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const staleRooms = await Room.findAll({
      where: {
        lastHeartbeat: {
          [Op.lt]: threshold,
        },
        status: 'ACTIVE',
      },
    });

    let cleaned = 0;
    for (const room of staleRooms) {
      await room.update({
        activeSpeakerSockets: [],
        isRecording: false,
        lastHeartbeat: null,
      });
      cleaned++;
    }

    if (cleaned > 0) {
      console.log(`[SessionManager] 🧹 Cleaned up ${cleaned} stale sessions`);
    }

    return cleaned;
  }

  /**
   * Gets the room ID associated with a speaker socket
   * Used for reverse lookup on disconnect events
   */
  async getRoomBySocket(socketId: string): Promise<Room | null> {
    const rooms = await Room.findAll({
      where: {
        activeSpeakerSockets: {
          [Op.like]: `%${socketId}%`,
        },
      },
    });

    return rooms.length > 0 ? rooms[0] : null;
  }
}

export const sessionManager = new SessionManager();
