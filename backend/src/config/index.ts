import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  // App
  app: {
    name: 'Translator Backend',
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
    isDev: (process.env.NODE_ENV || 'development') === 'development',
    isProd: process.env.NODE_ENV === 'production',
  },

  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || 'translator_db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-this',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-change-this',
    expiry: (process.env.JWT_EXPIRY || '1h') as string | number,
    refreshExpiry: (process.env.JWT_REFRESH_EXPIRY || '7d') as string | number,
  },

  // Email
  email: {
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
    },
    from: process.env.EMAIL_FROM || 'noreply@translator.com',
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },

  // Socket.io
  socket: {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
  },
};
