import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { Room, RoomStatus } from '../../models/Room';
import { RoomSettings } from '../../models/RoomSettings';
import { Listener } from '../../models/Listener';

export interface CreateRoomOptions {
  speakerName: string;
  speakerId: string;
  userId?: string;
  roomTitle?: string;
  password?: string;
  promptTemplate?: string;
  customPrompt?: string;
  targetLanguages?: string[];
  maxListeners?: number;
}

export class RoomService {

  // Generate unique room code
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // Create a new room
  async createRoom(options: CreateRoomOptions): Promise<any> {
    let roomCode: string;
    let attempts = 0;

    // Generate unique room code
    do {
      roomCode = this.generateRoomCode();
      const existing = await Room.findOne({
        where: { roomCode }
      });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new Error('Failed to generate unique room code');
    }

    // Hash password if provided
    let hashedPassword: string | undefined;
    if (options.password) {
      hashedPassword = await bcrypt.hash(options.password, 10);
    }

    // Prepare target languages
    const targetLanguagesArray = options.targetLanguages || ['en'];
    const targetLanguages = targetLanguagesArray.join(',');

    // Create room
    const room = await Room.create({
      roomCode,
      speakerName: options.speakerName,
      speakerId: options.speakerId,
      userId: options.userId,
      password: hashedPassword,
      status: RoomStatus.ACTIVE,
    });

    // Create room settings
    await RoomSettings.create({
      roomId: room.id,
      roomTitle: options.roomTitle || null,
      targetLanguages,
      targetLanguagesArray,
      promptTemplate: options.promptTemplate || 'general',
      customPrompt: options.customPrompt,
      enableTranslation: true,
      enableAutoScroll: true,
      maxListeners: options.maxListeners || 100
    });

    // Fetch room with settings
    const roomWithSettings = await Room.findByPk(room.id, {
      include: [RoomSettings]
    });

    return roomWithSettings;
  }

  // Get room by code
  async getRoom(roomCode: string): Promise<any> {
    return await Room.findOne({
      where: { roomCode },
      include: [
        RoomSettings,
        {
          model: Listener,
          where: { leftAt: null },
          required: false
        }
      ]
    });
  }

  // Verify room password
  async verifyRoomPassword(roomCode: string, password: string): Promise<boolean> {
    const room = await Room.findOne({
      where: { roomCode },
      attributes: ['password']
    });

    if (!room) {
      throw new Error('Room not found');
    }

    // If room has no password, allow access
    if (!room.password) {
      return true;
    }

    // Compare password
    return await bcrypt.compare(password, room.password);
  }

  // Check if room requires password
  async isPasswordProtected(roomCode: string): Promise<boolean> {
    const room = await Room.findOne({
      where: { roomCode },
      attributes: ['password']
    });

    return room?.password ? true : false;
  }

  // Get room by speaker ID
  async getRoomBySpeakerId(speakerId: string): Promise<any> {
    return await Room.findOne({
      where: {
        speakerId,
        status: RoomStatus.ACTIVE
      },
      include: [RoomSettings]
    });
  }

  // Update room status
  async updateRoomStatus(roomCode: string, status: string): Promise<any> {
    const updateData: any = { status };
    if (status === 'ENDED') {
      updateData.endedAt = new Date();
    }

    await Room.update(updateData, {
      where: { roomCode }
    });

    return await Room.findOne({ where: { roomCode } });
  }

  // Add listener to room
  async addListener(roomCode: string, socketId: string, name?: string): Promise<any> {
    // Get room to connect
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) {
      throw new Error('Room not found');
    }

    // Use upsert directly to handle race conditions (e.g., duplicate join-room events on reload)
    // This avoids the race condition between findOne and create
    const [listener, created] = await Listener.upsert({
      socketId,
      name: name || 'Guest',
      roomId: room.id,
      leftAt: null
    }, {
      returning: true
    });

    console.log(`[Room] Listener ${created ? 'created' : 'updated'}: ${socketId}`);
    return listener;
  }

  // Remove listener
  async removeListener(socketId: string): Promise<void> {
    await Listener.update(
      { leftAt: new Date() },
      { where: { socketId } }
    ).catch(() => {
      // Listener might not exist
    });
  }

  // Get active listener count
  async getListenerCount(roomCode: string): Promise<number> {
    return await Listener.count({
      include: [{
        model: Room,
        where: { roomCode },
        required: true
      }],
      where: {
        leftAt: null
      }
    });
  }

  // Handle disconnect (speaker or listener)
  async handleDisconnect(socketId: string): Promise<void> {
    // Check if it's a speaker
    const room = await Room.findOne({
      where: {
        speakerId: socketId,
        status: RoomStatus.ACTIVE
      }
    });

    if (room) {
      // Speaker disconnected - pause room
      await this.updateRoomStatus(room.roomCode, 'PAUSED');
    } else {
      // Listener disconnected
      await this.removeListener(socketId);
    }
  }

  // Reconnect speaker
  async reconnectSpeaker(speakerId: string, newSocketId: string): Promise<any> {
    const room = await Room.findOne({
      where: {
        speakerId,
        status: { [Op.in]: [RoomStatus.ACTIVE, RoomStatus.PAUSED, RoomStatus.ENDED] }
      }
    });

    if (room) {
      // For ENDED rooms, only update socket ID (keep status as ENDED for read-only access)
      if (room.status === RoomStatus.ENDED) {
        await room.update({
          speakerId: newSocketId
          // Don't change status - keep it as ENDED
        });
      } else {
        // Update speaker socket ID and reactivate room
        await room.update({
          speakerId: newSocketId,
          status: RoomStatus.ACTIVE
        });
      }

      return await Room.findByPk(room.id, {
        include: [RoomSettings]
      });
    }

    return null;
  }

  // Reconnect speaker by room code (for re-joining existing rooms)
  async reconnectSpeakerByRoomCode(roomCode: string, newSocketId: string): Promise<any> {
    const room = await Room.findOne({
      where: {
        roomCode,
        status: { [Op.in]: [RoomStatus.ACTIVE, RoomStatus.PAUSED, RoomStatus.ENDED] }
      }
    });

    if (room) {
      // For ENDED rooms, only update socket ID (keep status as ENDED for read-only access)
      if (room.status === RoomStatus.ENDED) {
        await room.update({
          speakerId: newSocketId
          // Don't change status - keep it as ENDED
        });
      } else {
        // Update speaker socket ID and reactivate room
        await room.update({
          speakerId: newSocketId,
          status: RoomStatus.ACTIVE
        });
      }

      return await Room.findByPk(room.id, {
        include: [RoomSettings]
      });
    }

    return null;
  }

  // Get recent rooms
  async getRecentRooms(limit: number = 10): Promise<any[]> {
    return await Room.findAll({
      order: [['createdAt', 'DESC']],
      limit,
      include: [RoomSettings]
    });
  }

  // Update room settings
  async updateRoomSettings(
    roomCode: string,
    settings: {
      roomTitle?: string;
      promptTemplate?: string;
      customPrompt?: string;
      targetLanguages?: string[];
      targetLanguagesArray?: string[];
      maxListeners?: number;
      enableTranslation?: boolean;
      enableAutoScroll?: boolean;
      sourceLanguage?: string;
      environmentPreset?: string;
      customEnvironmentDescription?: string;
      customGlossary?: Record<string, string> | null;
      enableStreaming?: boolean;
    }
  ): Promise<any> {
    const room = await Room.findOne({
      where: { roomCode },
      include: [RoomSettings]
    });

    if (!room || !room.roomSettings) {
      throw new Error('Room or settings not found');
    }

    const updateData: any = {};

    if (settings.roomTitle !== undefined) {
      updateData.roomTitle = settings.roomTitle;
    }
    if (settings.promptTemplate !== undefined) {
      updateData.promptTemplate = settings.promptTemplate;
    }
    if (settings.customPrompt !== undefined) {
      updateData.customPrompt = settings.customPrompt;
    }
    if (settings.targetLanguages !== undefined) {
      updateData.targetLanguages = settings.targetLanguages.join(',');
      updateData.targetLanguagesArray = settings.targetLanguages;
    }
    if (settings.targetLanguagesArray !== undefined) {
      updateData.targetLanguagesArray = settings.targetLanguagesArray;
      updateData.targetLanguages = settings.targetLanguagesArray.join(',');
    }
    if (settings.maxListeners !== undefined) {
      updateData.maxListeners = settings.maxListeners;
    }
    if (settings.enableTranslation !== undefined) {
      updateData.enableTranslation = settings.enableTranslation;
    }
    if (settings.enableAutoScroll !== undefined) {
      updateData.enableAutoScroll = settings.enableAutoScroll;
    }
    if (settings.sourceLanguage !== undefined) {
      updateData.sourceLanguage = settings.sourceLanguage;
    }
    if (settings.environmentPreset !== undefined) {
      updateData.environmentPreset = settings.environmentPreset;
    }
    if (settings.customEnvironmentDescription !== undefined) {
      updateData.customEnvironmentDescription = settings.customEnvironmentDescription;
    }
    if (settings.customGlossary !== undefined) {
      updateData.customGlossary = settings.customGlossary;
    }
    if (settings.enableStreaming !== undefined) {
      updateData.enableStreaming = settings.enableStreaming;
    }

    return await room.roomSettings.update(updateData);
  }

  // Update room password
  async updateRoomPassword(roomCode: string, password: string | null): Promise<void> {
    let hashedPassword: string | null = null;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    await Room.update(
      { password: hashedPassword },
      { where: { roomCode } }
    );
  }

  // Clean up old rooms
  async cleanupOldRooms(hoursOld: number = 24): Promise<number> {
    const cutoffDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000);

    const [affectedCount] = await Room.update(
      {
        status: RoomStatus.ENDED,
        endedAt: new Date()
      },
      {
        where: {
          createdAt: { [Op.lt]: cutoffDate },
          status: { [Op.ne]: RoomStatus.ENDED }
        }
      }
    );

    return affectedCount;
  }
}