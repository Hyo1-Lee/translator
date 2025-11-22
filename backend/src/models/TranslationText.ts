import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Room } from './Room';
import { SttText } from './SttText';

/**
 * TranslationText 모델
 *
 * 번역된 텍스트를 저장합니다.
 * - 한국어 → 영어 (GPT)
 * - 영어 → 다국어 (Google Translate)
 */
@Table({
  tableName: 'translation_texts',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      name: 'idx_translation_room_lang',
      fields: ['room_id', 'target_language']
    },
    {
      name: 'idx_translation_timestamp',
      fields: ['timestamp']
    }
  ]
})
export class TranslationText extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @ForeignKey(() => SttText)
  @Column(DataType.UUID)
  declare sttTextId: string | null;

  @Column(DataType.STRING(10))
  declare targetLanguage: string;

  @Column(DataType.TEXT)
  declare translatedText: string;

  @Column(DataType.TEXT)
  declare originalText: string;

  @Column(DataType.TEXT)
  declare contextSummary: string | null;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare isPartial: boolean;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare timestamp: Date;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;

  @BelongsTo(() => SttText)
  declare sttText: SttText | null;
}
