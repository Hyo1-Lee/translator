import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
  Index,
} from 'sequelize-typescript';
import { Room } from './Room';

@Table({
  tableName: 'segments',
  timestamps: false,
  underscored: true,
  indexes: [
    { fields: ['room_id', 'sequence'] },
    { fields: ['timestamp'] },
  ],
})
export class Segment extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @Column(DataType.INTEGER)
  declare sequence: number;

  @Column(DataType.TEXT)
  declare koreanOriginal: string;

  @Column(DataType.TEXT)
  declare koreanCorrected: string;

  @Column(DataType.JSON)
  declare translations: Record<string, string>;

  @Column(DataType.TEXT)
  declare contextSummary: string | null;

  @Column(DataType.INTEGER)
  declare latencyMs: number | null;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare timestamp: Date;

  @BelongsTo(() => Room)
  declare room: Room;
}
