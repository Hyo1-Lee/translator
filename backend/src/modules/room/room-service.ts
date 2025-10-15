import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

export interface CreateRoomOptions {
  speakerName: string;
  speakerId: string;
  userId?: string;
  password?: string;
  promptTemplate?: string;
  customPrompt?: string;
  targetLanguages?: string[];
  maxListeners?: number;
}

export class RoomService {
  constructor(private prisma: PrismaClient) {}

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
      const existing = await this.prisma.room.findUnique({
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

    // Prepare target languages (comma-separated string)
    const targetLanguages = options.targetLanguages?.join(',') || 'en';

    // Create room with settings
    const room = await this.prisma.room.create({
      data: {
        roomCode,
        speakerName: options.speakerName,
        speakerId: options.speakerId,
        userId: options.userId,
        password: hashedPassword,
        status: 'ACTIVE',
        roomSettings: {
          create: {
            targetLanguages,
            promptTemplate: options.promptTemplate || 'general',
            customPrompt: options.customPrompt,
            enableTranslation: true,
            enableAutoScroll: true,
            maxListeners: options.maxListeners || 100
          }
        }
      },
      include: {
        roomSettings: true
      }
    });

    console.log(`[Room] Created: ${roomCode} for ${options.speakerName}`);
    return room;
  }

  // Get room by code
  async getRoom(roomCode: string): Promise<any> {
    return await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        roomSettings: true,
        listeners: {
          where: { leftAt: null }
        }
      }
    });
  }

  // Verify room password
  async verifyRoomPassword(roomCode: string, password: string): Promise<boolean> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      select: { password: true }
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
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      select: { password: true }
    });

    return room?.password ? true : false;
  }

  // Get room by speaker ID
  async getRoomBySpeakerId(speakerId: string): Promise<any> {
    return await this.prisma.room.findFirst({
      where: {
        speakerId,
        status: 'ACTIVE'
      },
      include: {
        roomSettings: true
      }
    });
  }

  // Update room status
  async updateRoomStatus(roomCode: string, status: string): Promise<any> {
    const updateData: any = { status };
    if (status === 'ENDED') {
      updateData.endedAt = new Date();
    }

    return await this.prisma.room.update({
      where: { roomCode },
      data: updateData
    });
  }

  // Add listener to room
  async addListener(roomCode: string, socketId: string, name?: string): Promise<any> {
    // Get room to connect
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      throw new Error('Room not found');
    }

    // Check if listener already exists with this socket ID
    const existing = await this.prisma.listener.findUnique({
      where: { socketId }
    });

    if (existing) {
      // Update existing listener - rejoin room
      return await this.prisma.listener.update({
        where: { socketId },
        data: {
          roomId: room.id,
          name: name || existing.name,
          leftAt: null
        }
      });
    }

    // Create new listener
    return await this.prisma.listener.create({
      data: {
        socketId,
        name: name || 'Guest',
        roomId: room.id
      }
    });
  }

  // Remove listener
  async removeListener(socketId: string): Promise<void> {
    await this.prisma.listener.update({
      where: { socketId },
      data: { leftAt: new Date() }
    }).catch(() => {
      // Listener might not exist
    });
  }

  // Get active listener count
  async getListenerCount(roomCode: string): Promise<number> {
    return await this.prisma.listener.count({
      where: {
        room: { roomCode },
        leftAt: null
      }
    });
  }

  // Handle disconnect (speaker or listener)
  async handleDisconnect(socketId: string): Promise<void> {
    // Check if it's a speaker
    const room = await this.prisma.room.findFirst({
      where: {
        speakerId: socketId,
        status: 'ACTIVE'
      }
    });

    if (room) {
      // Speaker disconnected - pause room
      await this.updateRoomStatus(room.roomCode, 'PAUSED');
      console.log(`[Room] Speaker disconnected: ${room.roomCode}`);
    } else {
      // Listener disconnected
      await this.removeListener(socketId);
    }
  }

  // Reconnect speaker
  async reconnectSpeaker(speakerId: string, newSocketId: string): Promise<any> {
    const room = await this.prisma.room.findFirst({
      where: {
        speakerId,
        status: { in: ['ACTIVE', 'PAUSED'] }
      }
    });

    if (room) {
      // Update speaker socket ID and reactivate room
      return await this.prisma.room.update({
        where: { id: room.id },
        data: {
          speakerId: newSocketId,
          status: 'ACTIVE'
        }
      });
    }

    return null;
  }

  // Get recent rooms
  async getRecentRooms(limit: number = 10): Promise<any[]> {
    return await this.prisma.room.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        roomSettings: true,
        _count: {
          select: {
            listeners: true,
            transcripts: true
          }
        }
      }
    });
  }

  // Update room settings
  async updateRoomSettings(
    roomCode: string,
    settings: {
      promptTemplate?: string;
      customPrompt?: string;
      targetLanguages?: string[];
      maxListeners?: number;
      enableTranslation?: boolean;
      enableAutoScroll?: boolean;
    }
  ): Promise<any> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: { roomSettings: true }
    });

    if (!room || !room.roomSettings) {
      throw new Error('Room or settings not found');
    }

    const updateData: any = {};

    if (settings.promptTemplate !== undefined) {
      updateData.promptTemplate = settings.promptTemplate;
    }
    if (settings.customPrompt !== undefined) {
      updateData.customPrompt = settings.customPrompt;
    }
    if (settings.targetLanguages !== undefined) {
      updateData.targetLanguages = settings.targetLanguages.join(',');
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

    return await this.prisma.roomSettings.update({
      where: { id: room.roomSettings.id },
      data: updateData
    });
  }

  // Update room password
  async updateRoomPassword(roomCode: string, password: string | null): Promise<void> {
    let hashedPassword: string | null = null;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    await this.prisma.room.update({
      where: { roomCode },
      data: { password: hashedPassword }
    });
  }

  // Clean up old rooms
  async cleanupOldRooms(hoursOld: number = 24): Promise<number> {
    const cutoffDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000);

    const result = await this.prisma.room.updateMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { not: 'ENDED' }
      },
      data: {
        status: 'ENDED',
        endedAt: new Date()
      }
    });

    return result.count;
  }
}