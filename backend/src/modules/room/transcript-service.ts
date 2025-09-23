import { PrismaClient } from '@prisma/client';

export class TranscriptService {
  constructor(private prisma: PrismaClient) {}

  // Save STT text
  async saveSttText(roomCode: string, text: string, confidence?: number): Promise<any> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }

    return await this.prisma.sttText.create({
      data: {
        roomId: room.id,
        text,
        confidence
      }
    });
  }

  // Save translation
  async saveTranslation(
    roomCode: string,
    korean: string,
    english: string,
    batchId?: string
  ): Promise<any> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }

    return await this.prisma.transcript.create({
      data: {
        roomId: room.id,
        korean,
        english,
        batchId
      }
    });
  }

  // Get recent STT texts
  async getRecentSttTexts(roomCode: string, limit: number = 100): Promise<any[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) return [];

    return await this.prisma.sttText.findMany({
      where: { roomId: room.id },
      orderBy: { timestamp: 'desc' },
      take: limit
    });
  }

  // Get recent translations
  async getRecentTranslations(roomCode: string, limit: number = 30): Promise<any[]> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) return [];

    return await this.prisma.transcript.findMany({
      where: { roomId: room.id },
      orderBy: { timestamp: 'desc' },
      take: limit
    });
  }

  // Get all transcripts for export
  async getAllTranscripts(roomCode: string): Promise<{
    sttTexts: any[],
    translations: any[]
  }> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        sttTexts: {
          orderBy: { timestamp: 'asc' }
        },
        transcripts: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });

    if (!room) {
      return { sttTexts: [], translations: [] };
    }

    return {
      sttTexts: room.sttTexts,
      translations: room.transcripts
    };
  }

  // Clean up old transcripts
  async cleanupOldTranscripts(daysOld: number = 7): Promise<{
    sttTexts: number,
    translations: number
  }> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const sttResult = await this.prisma.sttText.deleteMany({
      where: {
        timestamp: { lt: cutoffDate }
      }
    });

    const translationResult = await this.prisma.transcript.deleteMany({
      where: {
        timestamp: { lt: cutoffDate }
      }
    });

    return {
      sttTexts: sttResult.count,
      translations: translationResult.count
    };
  }

  // Get transcript statistics
  async getStats(roomCode: string): Promise<{
    totalSttTexts: number,
    totalTranslations: number,
    totalDuration: number,
    averageConfidence: number
  }> {
    const room = await this.prisma.room.findUnique({
      where: { roomCode }
    });

    if (!room) {
      return {
        totalSttTexts: 0,
        totalTranslations: 0,
        totalDuration: 0,
        averageConfidence: 0
      };
    }

    const [sttCount, translationCount, avgConfidence] = await Promise.all([
      this.prisma.sttText.count({
        where: { roomId: room.id }
      }),
      this.prisma.transcript.count({
        where: { roomId: room.id }
      }),
      this.prisma.sttText.aggregate({
        where: { roomId: room.id },
        _avg: { confidence: true }
      })
    ]);

    const duration = room.endedAt
      ? Math.floor((room.endedAt.getTime() - room.createdAt.getTime()) / 1000)
      : Math.floor((Date.now() - room.createdAt.getTime()) / 1000);

    return {
      totalSttTexts: sttCount,
      totalTranslations: translationCount,
      totalDuration: duration,
      averageConfidence: avgConfidence._avg.confidence || 0
    };
  }
}