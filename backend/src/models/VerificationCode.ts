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
import { User } from './User';

@Table({
  tableName: 'verification_codes',
  timestamps: false,
  underscored: true,
})
export class VerificationCode extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare email: string;

  @Column(DataType.STRING)
  declare code: string;

  @Column(DataType.DATE)
  declare expiresAt: Date;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare isUsed: boolean;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  declare userId: string | null;

  // Relations
  @BelongsTo(() => User)
  declare user: User | null;
}
