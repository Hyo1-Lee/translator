import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
  Unique,
} from 'sequelize-typescript';
import { Room } from './Room';

@Table({
  tableName: 'room_settings',
  timestamps: false,
  underscored: true,
})
export class RoomSettings extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column({
    type: DataType.UUID,
    unique: 'roomId_unique'
  })
  declare roomId: string;

  @Column(DataType.STRING)
  declare roomTitle: string | null;

  // 기존 필드 (하위 호환성 유지)
  @Default('en')
  @Column(DataType.STRING)
  declare targetLanguages: string;

  @Default('church')
  @Column(DataType.STRING)
  declare promptTemplate: string;

  @Column(DataType.TEXT)
  declare customPrompt: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enableTranslation: boolean;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enableAutoScroll: boolean;

  @Default(100)
  @Column(DataType.INTEGER)
  declare maxListeners: number;

  // 새로운 번역 기능 필드
  @Default('ko')
  @Column(DataType.STRING(10))
  declare sourceLanguage: string;

  @Default('church')
  @Column(DataType.STRING(20))
  declare environmentPreset: string;

  @Column(DataType.TEXT)
  declare customEnvironmentDescription: string | null;

  @Column(DataType.JSON)
  declare customGlossary: Record<string, string> | null;

  @Column(DataType.JSON)
  declare targetLanguagesArray: string[] | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enableStreaming: boolean;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;
}
