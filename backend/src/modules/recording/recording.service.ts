import { PrismaClient } from '@prisma/client';

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
  constructor(private prisma: PrismaClient) {}

  // Save current session as recording
  async saveRecording(options: SaveRecordingOptions): Promise<any> {
    const { userId, roomCode, roomName } = options;

    // Get room and all transcripts
    const room = await this.prisma.room.findUnique({
      where: { roomCode },
      include: {
        transcripts: {
          orderBy: { timestamp: 'asc' }
        },
        roomSettings: true
      }
    });

    if (!room) {
      throw new Error('Room not found');
    }

    // Format transcripts
    const formattedTranscripts = room.transcripts.map((t: any) => ({
      korean: t.korean,
      english: t.english,
      translations: t.translations ? JSON.parse(t.translations) : { en: t.english },
      timestamp: t.timestamp.getTime()
    }));

    // Save to database
    const savedTranscript = await this.prisma.savedTranscript.create({
      data: {
        userId,
        roomCode,
        roomName: roomName || `Session ${roomCode}`,
        transcripts: JSON.stringify(formattedTranscripts)
      }
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
    const savedTranscripts = await this.prisma.savedTranscript.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
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
    const savedTranscript = await this.prisma.savedTranscript.findFirst({
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
    const result = await this.prisma.savedTranscript.deleteMany({
      where: {
        id: recordingId,
        userId
      }
    });

    return result.count > 0;
  }

  // Update recording name
  async updateRecordingName(recordingId: string, userId: string, newName: string): Promise<boolean> {
    const result = await this.prisma.savedTranscript.updateMany({
      where: {
        id: recordingId,
        userId
      },
      data: {
        roomName: newName
      }
    });

    return result.count > 0;
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
