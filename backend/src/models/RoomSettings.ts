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

  @Default('en')
  @Column(DataType.STRING)
  declare targetLanguages: string;

  @Default('general')
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

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;
}
