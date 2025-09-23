import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

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
  async createRoom(speakerName: string, speakerId: string): Promise<any> {
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

    // Create room with settings
    const room = await this.prisma.room.create({
      data: {
        roomCode,
        speakerName,
        speakerId,
        status: 'ACTIVE',
        roomSettings: {
          create: {
            targetLanguage: 'en',
            enableTranslation: true,
            enableAutoScroll: true,
            maxListeners: 100
          }
        }
      },
      include: {
        roomSettings: true
      }
    });

    console.log(`[Room] Created: ${roomCode} for ${speakerName}`);
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
    // Check if listener already exists
    const existing = await this.prisma.listener.findUnique({
      where: { socketId }
    });

    if (existing) {
      // Update existing listener
      return await this.prisma.listener.update({
        where: { socketId },
        data: {
          roomId: roomCode,
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
        room: {
          connect: { roomCode }
        }
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