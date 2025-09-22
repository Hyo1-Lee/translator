import { PrismaClient, Transcript, SttText } from '@prisma/client';

export class TranscriptService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Save a transcript to database
   */
  async saveTranscript(
    roomId: string,
    korean: string,
    english: string,
    batchId?: string
  ): Promise<Transcript> {
    // First check if room exists by roomCode
    const room = await this.prisma.room.findUnique({
      where: { roomCode: roomId }
    });

    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    return this.prisma.transcript.create({
      data: {
        roomId: room.id,  // Use the actual room ID
        korean,
        english,
        batchId
      }
    });
  }

  /**
   * Get all transcripts for a room
   */
  async getTranscriptsByRoomCode(roomCode: string): Promise<Transcript[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        transcripts: {
          orderBy: {
            timestamp: 'asc'
          }
        }
      }
    });

    return room?.transcripts || [];
  }

  /**
   * Get recent transcripts for a room
   */
  async getRecentTranscripts(
    roomCode: string,
    limit: number = 50
  ): Promise<Transcript[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      return [];
    }

    return this.prisma.transcript.findMany({
      where: { roomId: room.id },
      orderBy: {
        timestamp: 'desc'
      },
      take: limit
    });
  }

  /**
   * Delete old transcripts
   */
  async deleteOldTranscripts(days: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.transcript.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    return result.count;
  }

  /**
   * Save STT raw text to database
   */
  async saveSttText(
    roomId: string,
    text: string
  ): Promise<SttText> {
    // First check if room exists by roomCode
    const room = await this.prisma.room.findUnique({
      where: { roomCode: roomId }
    });

    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    return this.prisma.sttText.create({
      data: {
        roomId: room.id,  // Use the actual room ID
        text
      }
    });
  }

  /**
   * Get all STT texts for a room
   */
  async getSttTextsByRoomCode(roomCode: string): Promise<SttText[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        sttTexts: {
          orderBy: {
            timestamp: 'asc'
          }
        }
      }
    });

    return room?.sttTexts || [];
  }

  /**
   * Get recent STT texts for a room
   */
  async getRecentSttTexts(
    roomCode: string,
    limit: number = 100
  ): Promise<SttText[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      return [];
    }

    return this.prisma.sttText.findMany({
      where: { roomId: room.id },
      orderBy: {
        timestamp: 'desc'
      },
      take: limit
    });
  }
}