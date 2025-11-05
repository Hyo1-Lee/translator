import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Unique,
  Default,
  CreatedAt,
  UpdatedAt,
  HasMany,
} from 'sequelize-typescript';
import { Room } from './Room';
import { SavedTranscript } from './SavedTranscript';
import { RefreshToken } from './RefreshToken';
import { VerificationCode } from './VerificationCode';

@Table({
  tableName: 'users',
  timestamps: true,
  underscored: true,
})
export class User extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Unique
  @Column(DataType.STRING)
  declare email: string;

  @Column(DataType.STRING)
  declare password: string | null;

  @Column(DataType.STRING)
  declare name: string | null;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare isEmailVerified: boolean;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @Column(DataType.DATE)
  declare lastLoginAt: Date | null;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;

  // Relations
  @HasMany(() => Room)
  declare rooms: Room[];

  @HasMany(() => SavedTranscript)
  declare savedTranscripts: SavedTranscript[];

  @HasMany(() => RefreshToken)
  declare refreshTokens: RefreshToken[];

  @HasMany(() => VerificationCode)
  declare verificationCodes: VerificationCode[];
}
