import { Room } from '../../models/Room';
import { Transcript } from '../../models/Transcript';
import { SavedTranscript } from '../../models/SavedTranscript';
import { RoomSettings } from '../../models/RoomSettings';

export interface SaveRecordingOptions {
  userId: string;
  roomCode: string;
  roomName?: string;
}

export interface Recording {
  id: string;
  roomCode: string;
  roomName: string;
  transcripts: any[];
  duration: number;
  createdAt: Date;
}

export class RecordingService {
  constructor() {}

  // Save current session as recording
  async saveRecording(options: SaveRecordingOptions): Promise<any> {
    const { userId, roomCode, roomName } = options;

    // Get room and all transcripts
    const room = await Room.findOne({
      where: { roomCode },
      include: [
        {
          model: Transcript,
          as: 'transcripts',
          order: [['timestamp', 'ASC']]
        },
        {
          model: RoomSettings,
          as: 'roomSettings'
        }
      ]
    });

    if (!room) {
      throw new Error('Room not found');
    }

    // Format transcripts
    const transcripts = room.transcripts || [];
    const formattedTranscripts = transcripts.map((t: any) => ({
      korean: t.korean,
      english: t.english,
      translations: t.translations ? JSON.parse(t.translations) : { en: t.english },
      timestamp: t.timestamp.getTime()
    }));

    // Save to database
    const savedTranscript = await SavedTranscript.create({
      userId,
      roomCode,
      roomName: roomName || `Session ${roomCode}`,
      transcripts: JSON.stringify(formattedTranscripts)
    });

    return {
      id: savedTranscript.id,
      roomCode: savedTranscript.roomCode,
      roomName: savedTranscript.roomName,
      transcriptCount: formattedTranscripts.length,
      createdAt: savedTranscript.createdAt
    };
  }

  // Get all recordings for a user
  async getUserRecordings(userId: string): Promise<Recording[]> {
    const savedTranscripts = await SavedTranscript.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });

    return savedTranscripts.map((st: any) => {
      const transcripts = JSON.parse(st.transcripts);
      const duration = transcripts.length > 0
        ? Math.floor((transcripts[transcripts.length - 1].timestamp - transcripts[0].timestamp) / 1000)
        : 0;

      return {
        id: st.id,
        roomCode: st.roomCode,
        roomName: st.roomName || `Session ${st.roomCode}`,
        transcripts,
        duration,
        createdAt: st.createdAt
      };
    });
  }

  // Get single recording
  async getRecording(recordingId: string, userId: string): Promise<Recording | null> {
    const savedTranscript = await SavedTranscript.findOne({
      where: {
        id: recordingId,
        userId
      }
    });

    if (!savedTranscript) {
      return null;
    }

    const transcripts = JSON.parse(savedTranscript.transcripts);
    const duration = transcripts.length > 0
      ? Math.floor((transcripts[transcripts.length - 1].timestamp - transcripts[0].timestamp) / 1000)
      : 0;

    return {
      id: savedTranscript.id,
      roomCode: savedTranscript.roomCode,
      roomName: savedTranscript.roomName || `Session ${savedTranscript.roomCode}`,
      transcripts,
      duration,
      createdAt: savedTranscript.createdAt
    };
  }

  // Delete recording
  async deleteRecording(recordingId: string, userId: string): Promise<boolean> {
    const result = await SavedTranscript.destroy({
      where: {
        id: recordingId,
        userId
      }
    });

    return result > 0;
  }

  // Update recording name
  async updateRecordingName(recordingId: string, userId: string, newName: string): Promise<boolean> {
    const [result] = await SavedTranscript.update(
      { roomName: newName },
      {
        where: {
          id: recordingId,
          userId
        }
      }
    );

    return result > 0;
  }

  // Get recording stats for user
  async getUserStats(userId: string): Promise<{
    totalRecordings: number;
    totalDuration: number;
    totalTranscripts: number;
  }> {
    const recordings = await this.getUserRecordings(userId);

    const totalDuration = recordings.reduce((sum, r) => sum + r.duration, 0);
    const totalTranscripts = recordings.reduce((sum, r) => sum + r.transcripts.length, 0);

    return {
      totalRecordings: recordings.length,
      totalDuration,
      totalTranscripts
    };
  }
}
