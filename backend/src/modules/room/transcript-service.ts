import { Op, fn, col } from 'sequelize';
import { Room } from '../../models/Room';
import { SttText } from '../../models/SttText';
import { Transcript } from '../../models/Transcript';

export class TranscriptService {

  // Save STT text
  async saveSttText(roomCode: string, text: string, confidence?: number): Promise<any> {
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }

    return await SttText.create({
      roomId: room.id,
      text,
      confidence
    });
  }

  // Save translation
  async saveTranslation(
    roomCode: string,
    korean: string,
    english: string,
    batchId?: string,
    translations?: string | null
  ): Promise<any> {
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }

    return await Transcript.create({
      roomId: room.id,
      korean,
      english,
      batchId,
      translations
    });
  }

  // Get recent STT texts
  async getRecentSttTexts(roomCode: string, limit: number = 100): Promise<any[]> {
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) return [];

    return await SttText.findAll({
      where: { roomId: room.id },
      order: [['timestamp', 'DESC']],
      limit
    });
  }

  // Get recent translations
  async getRecentTranslations(roomCode: string, limit: number = 30): Promise<any[]> {
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) return [];

    return await Transcript.findAll({
      where: { roomId: room.id },
      order: [['timestamp', 'DESC']],
      limit
    });
  }

  // Get all transcripts for export
  async getAllTranscripts(roomCode: string): Promise<{
    sttTexts: any[],
    translations: any[]
  }> {
    const room = await Room.findOne({
      where: { roomCode },
      include: [
        {
          model: SttText,
          as: 'sttTexts'
        },
        {
          model: Transcript,
          as: 'transcripts'
        }
      ],
      order: [
        [{ model: SttText, as: 'sttTexts' }, 'timestamp', 'ASC'],
        [{ model: Transcript, as: 'transcripts' }, 'timestamp', 'ASC']
      ]
    });

    if (!room) {
      return { sttTexts: [], translations: [] };
    }

    return {
      sttTexts: room.sttTexts || [],
      translations: room.transcripts || []
    };
  }

  // Clean up old transcripts
  async cleanupOldTranscripts(daysOld: number = 7): Promise<{
    sttTexts: number,
    translations: number
  }> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const sttResult = await SttText.destroy({
      where: {
        timestamp: { [Op.lt]: cutoffDate }
      }
    });

    const translationResult = await Transcript.destroy({
      where: {
        timestamp: { [Op.lt]: cutoffDate }
      }
    });

    return {
      sttTexts: sttResult,
      translations: translationResult
    };
  }

  // Get transcript statistics
  async getStats(roomCode: string): Promise<{
    totalSttTexts: number,
    totalTranslations: number,
    totalDuration: number,
    averageConfidence: number
  }> {
    const room = await Room.findOne({
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

    const [sttCount, translationCount, avgResult] = await Promise.all([
      SttText.count({
        where: { roomId: room.id }
      }),
      Transcript.count({
        where: { roomId: room.id }
      }),
      SttText.findOne({
        where: { roomId: room.id },
        attributes: [[fn('AVG', col('confidence')), 'avgConfidence']],
        raw: true
      })
    ]);

    const duration = room.endedAt
      ? Math.floor((room.endedAt.getTime() - room.createdAt.getTime()) / 1000)
      : Math.floor((Date.now() - room.createdAt.getTime()) / 1000);

    return {
      totalSttTexts: sttCount,
      totalTranslations: translationCount,
      totalDuration: duration,
      averageConfidence: (avgResult as any)?.avgConfidence || 0
    };
  }
}