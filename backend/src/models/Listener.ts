import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  Unique,
  CreatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Room } from './Room';

@Table({
  tableName: 'listeners',
  timestamps: false,
  underscored: true,
})
export class Listener extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Unique
  @Column(DataType.STRING)
  declare socketId: string;

  @ForeignKey(() => Room)
  @Column(DataType.UUID)
  declare roomId: string;

  @Default('Guest')
  @Column(DataType.STRING)
  declare name: string;

  @CreatedAt
  @Column(DataType.DATE)
  declare joinedAt: Date;

  @Column(DataType.DATE)
  declare leftAt: Date | null;

  // Relations
  @BelongsTo(() => Room)
  declare room: Room;
}
