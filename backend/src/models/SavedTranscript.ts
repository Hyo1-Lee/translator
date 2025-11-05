import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  CreatedAt,
  UpdatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from './User';

@Table({
  tableName: 'saved_transcripts',
  timestamps: true,
  underscored: true,
})
export class SavedTranscript extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  declare userId: string;

  @Column(DataType.STRING)
  declare roomCode: string;

  @Column(DataType.STRING)
  declare roomName: string | null;

  @Column(DataType.TEXT)
  declare transcripts: string;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;

  // Relations
  @BelongsTo(() => User)
  declare user: User;
}
