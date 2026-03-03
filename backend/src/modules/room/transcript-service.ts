import { Op } from 'sequelize';
import { Room } from '../../models/Room';
import { SttText } from '../../models/SttText';
import { TranslationText } from '../../models/TranslationText';
import { Segment } from '../../models/Segment';

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

  // Clean up old data
  async cleanupOldData(daysOld: number = 7): Promise<{
    sttTexts: number,
    translationTexts: number,
    segments: number,
  }> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const translationTextsResult = await TranslationText.destroy({
      where: { timestamp: { [Op.lt]: cutoffDate } }
    });

    const sttResult = await SttText.destroy({
      where: { timestamp: { [Op.lt]: cutoffDate } }
    });

    const segmentResult = await Segment.destroy({
      where: { timestamp: { [Op.lt]: cutoffDate } }
    });

    return {
      sttTexts: sttResult,
      translationTexts: translationTextsResult,
      segments: segmentResult,
    };
  }

  /**
   * 번역되지 않은 STT 텍스트 조회
   * TranslationText에 English 번역이 없는 SttText 찾기
   */
  async getUntranslatedSttTexts(roomCode: string): Promise<any[]> {
    const room = await Room.findOne({
      where: { roomCode }
    });

    if (!room) return [];

    // 모든 STT 텍스트 가져오기
    const allSttTexts = await SttText.findAll({
      where: { roomId: room.id },
      order: [['timestamp', 'ASC']]
    });

    if (allSttTexts.length === 0) return [];

    // 이미 번역된 sttTextId 목록 가져오기 (English 기준)
    const translatedSttIds = await TranslationText.findAll({
      where: {
        roomId: room.id,
        targetLanguage: 'en',
        isPartial: false,
        sttTextId: { [Op.ne]: null }
      },
      attributes: ['sttTextId']
    });

    const translatedIds = new Set(translatedSttIds.map(t => t.sttTextId));

    // 번역되지 않은 STT 텍스트 필터링
    const untranslated = allSttTexts.filter(stt => !translatedIds.has(stt.id));

    console.log(`[TranscriptService][${roomCode}] Found ${untranslated.length} untranslated STT texts out of ${allSttTexts.length} total`);

    return untranslated;
  }

  // ── Segment-based methods ──────────────────────────────────

  async saveSegment(
    roomCode: string,
    sequence: number,
    koreanOriginal: string,
    koreanCorrected: string,
    translations: Record<string, string>,
    latencyMs?: number,
    contextSummary?: string
  ): Promise<any> {
    const room = await Room.findOne({ where: { roomCode } });
    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }

    return await Segment.create({
      roomId: room.id,
      sequence,
      koreanOriginal,
      koreanCorrected,
      translations,
      latencyMs: latencyMs || null,
      contextSummary: contextSummary || null,
    });
  }

  async updateSegmentTranslations(
    roomCode: string,
    sequence: number,
    translations: Record<string, string>
  ): Promise<void> {
    const room = await Room.findOne({ where: { roomCode } });
    if (!room) return;

    await Segment.update(
      { translations },
      { where: { roomId: room.id, sequence } }
    );
  }

  async getRecentSegments(roomCode: string, limit: number = 50): Promise<any[]> {
    const room = await Room.findOne({ where: { roomCode } });
    if (!room) return [];

    return await Segment.findAll({
      where: { roomId: room.id },
      order: [['sequence', 'DESC']],
      limit,
    });
  }

  async getAllSegments(roomCode: string): Promise<any[]> {
    const room = await Room.findOne({ where: { roomCode } });
    if (!room) return [];

    return await Segment.findAll({
      where: { roomId: room.id },
      order: [['sequence', 'ASC']],
    });
  }

}