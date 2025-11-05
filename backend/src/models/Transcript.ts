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
  tableName: 'transcripts',
  timestamps: false,
  underscored: true,
})
export class Transcript extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @Column(DataType.TEXT)
  declare korean: string;

  @Column(DataType.TEXT)
  declare english: string;

  @Column(DataType.TEXT)
  declare translations: string | null;

  @Column(DataType.STRING)
  declare batchId: string | null;

  @CreatedAt
  @Column(DataType.DATE)
  declare timestamp: Date;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;
}
