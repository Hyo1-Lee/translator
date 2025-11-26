import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  Unique,
  CreatedAt,
  UpdatedAt,
  ForeignKey,
  BelongsTo,
  HasMany,
  HasOne,
} from 'sequelize-typescript';
import { User } from './User';
import { Listener } from './Listener';
import { Transcript } from './Transcript';
import { SttText } from './SttText';
import { RoomSettings } from './RoomSettings';

export enum RoomStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
}

@Table({
  tableName: 'rooms',
  timestamps: true,
  underscored: true,
})
export class Room extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({
    type: DataType.STRING,
    unique: 'roomCode_unique'
  })
  declare roomCode: string;

  @Column(DataType.STRING)
  declare speakerId: string;

  @Default('Speaker')
  @Column(DataType.STRING)
  declare speakerName: string;

  @Default(RoomStatus.ACTIVE)
  @Column(DataType.ENUM(...Object.values(RoomStatus)))
  declare status: RoomStatus;

  @Column(DataType.STRING)
  declare password: string | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  declare userId: string | null;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @Column(DataType.DATE)
  declare endedAt: Date | null;

  // Recording state fields (Phase 1)
  @Default(false)
  @Column(DataType.BOOLEAN)
  declare isRecording: boolean;

  @Default('[]')
  @Column(DataType.JSON)
  declare activeSpeakerSockets: string[];

  @Column(DataType.DATE)
  declare lastHeartbeat: Date | null;

  // Relations
  @BelongsTo(() => User)
  declare user: User | null;

  @HasMany(() => Listener)
  declare listeners: Listener[];

  @HasMany(() => Transcript)
  declare transcripts: Transcript[];

  @HasMany(() => SttText)
  declare sttTexts: SttText[];

  @HasOne(() => RoomSettings)
  declare roomSettings: RoomSettings;
}
