import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  CreatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Room } from './Room';

@Table({
  tableName: 'stt_texts',
  timestamps: false,
  underscored: true,
})
export class SttText extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @Column(DataType.TEXT)
  declare text: string;

  @Column(DataType.FLOAT)
  declare confidence: number | null;

  @CreatedAt
  @Column(DataType.DATE)
  declare timestamp: Date;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;
}
