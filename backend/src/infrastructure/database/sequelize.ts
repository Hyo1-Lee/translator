import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import { config } from '../../config';
import {
  User,
  RefreshToken,
  VerificationCode,
  Room,
  RoomSettings,
  Listener,
  SttText,
  TranslationText,
  Transcript,
  SavedTranscript,
} from '../../models';

// Sequelize instance
const sequelize = new Sequelize({
  database: config.database.name,
  username: config.database.user,
  password: config.database.password,
  host: config.database.host,
  port: config.database.port,
  dialect: 'mysql',
  logging: false,

  // Connection pool settings
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  // Timezone settings
  timezone: '+09:00',

  // Define options
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: false,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
});

// Add models
sequelize.addModels([
  User,
  RefreshToken,
  VerificationCode,
  Room,
  RoomSettings,
  Listener,
  SttText,
  TranslationText,
  Transcript,
  SavedTranscript,
]);

export const connectDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();

    // Sync models (development only)
    if (config.app.isDev) {
      // Use alter: true to update tables without deleting data
      await sequelize.sync({ alter: true });
    }
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    process.exit(1);
  }
};

export const closeDatabase = async (): Promise<void> => {
  await sequelize.close();
};

export default sequelize;
