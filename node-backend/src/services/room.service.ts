import { PrismaClient, Room } from '@prisma/client';
import { generateRoomCode } from '../utils/helpers';

export class RoomService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 방 생성
   */
  async createRoom(speakerName: string, socketId: string): Promise<Room> {
    const roomCode = await this.generateUniqueRoomCode();

    const room = await this.prisma.room.create({
      data: {
        roomCode,
        speakerName,
        status: 'ACTIVE',
      },
    });

    // Store speaker socket ID in memory (or Redis for production)
    // For now, we'll handle this in Socket.IO memory

    return room;
  }

  /**
   * 방 조회
   */
  async getRoom(roomCode: string): Promise<Room | null> {
    return await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        listeners: {
          where: {
            leftAt: null, // Only active listeners
          },
        },
      },
    });
  }

  /**
   * 리스너 추가
   */
  async addListener(roomCode: string, socketId: string, name?: string) {
    const room = await this.getRoom(roomCode);
    if (!room) {
      throw new Error('Room not found');
    }

    // Check if listener already exists
    const existingListener = await this.prisma.listener.findUnique({
      where: { socketId },
    });

    if (existingListener) {
      // Update existing listener
      return await this.prisma.listener.update({
        where: { socketId },
        data: {
          roomId: room.id,
          leftAt: null,
        },
      });
    }

    // Create new listener
    return await this.prisma.listener.create({
      data: {
        socketId,
        roomId: room.id,
        name: name || 'Anonymous',
      },
    });
  }

  /**
   * 리스너 수 조회
   */
  async getListenerCount(roomCode: string): Promise<number> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        listeners: {
          where: {
            leftAt: null,
          },
        },
      },
    });

    return room?.listeners.length || 0;
  }

  /**
   * 연결 끊김 처리
   */
  async handleDisconnect(socketId: string) {
    // Check if speaker
    const roomsAsSpeaker = await this.prisma.room.findMany({
      where: {
        status: 'ACTIVE',
        // In production, you'd check against a speaker_socket_id field
      },
    });

    // For now, we'll handle speaker disconnect in Socket.IO memory

    // Check if listener
    const listener = await this.prisma.listener.findUnique({
      where: { socketId },
    });

    if (listener && !listener.leftAt) {
      await this.prisma.listener.update({
        where: { socketId },
        data: {
          leftAt: new Date(),
        },
      });
    }
  }

  /**
   * 방 종료
   */
  async closeRoom(roomCode: string) {
    await this.prisma.room.update({
      where: { roomCode },
      data: {
        status: 'INACTIVE',
      },
    });
  }

  /**
   * 고유한 방 코드 생성
   */
  private async generateUniqueRoomCode(): Promise<string> {
    let code: string;
    let exists: boolean;

    do {
      code = generateRoomCode();
      const room = await this.prisma.room.findUnique({
        where: { roomCode: code },
      });
      exists = !!room;
    } while (exists);

    return code;
  }

  /**
   * 번역 기록 저장
   */
  async saveTranscript(roomCode: string, korean: string, english: string, batchId?: string) {
    const room = await this.getRoom(roomCode);
    if (!room) {
      throw new Error('Room not found');
    }

    return await this.prisma.transcript.create({
      data: {
        roomId: room.id,
        korean,
        english,
        batchId,
      },
    });
  }

  /**
   * 활성 방 목록 조회
   */
  async getActiveRooms() {
    return await this.prisma.room.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        _count: {
          select: {
            listeners: {
              where: {
                leftAt: null,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}