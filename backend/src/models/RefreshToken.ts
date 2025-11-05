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
import { User } from './User';

@Table({
  tableName: 'refresh_tokens',
  timestamps: false,
  underscored: true,
})
export class RefreshToken extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Unique
  @Column(DataType.STRING)
  declare token: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  declare userId: string;

  @Column(DataType.DATE)
  declare expiresAt: Date;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  // Relations
  @BelongsTo(() => User)
  declare user: User;
}
