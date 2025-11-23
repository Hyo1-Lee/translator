const dotenv = require("dotenv");
const path = require("path");

// Load .env file
dotenv.config({ path: path.resolve(__dirname, ".env") });

module.exports = {
  apps: [
    {
      name: "ts-backend",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,

        // Database
        DB_HOST: process.env.DB_HOST,
        DB_PORT: process.env.DB_PORT,
        DB_NAME: process.env.DB_NAME,
        DB_USER: process.env.DB_USER,
        DB_PASSWORD: process.env.DB_PASSWORD,

        // Frontend
        FRONTEND_URL: process.env.FRONTEND_URL,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,

        // Groq API (LDS Church Translation)
        GROQ_API_KEY: process.env.GROQ_API_KEY,
        GROQ_MODEL: process.env.GROQ_MODEL,

        // Translation Provider
        TRANSLATION_PROVIDER: process.env.TRANSLATION_PROVIDER,
        ENABLE_SMART_BATCH: process.env.ENABLE_SMART_BATCH,
        BATCH_SIZE: process.env.BATCH_SIZE,

        // OpenAI API (Fallback)
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL,

        // Google Translate API
        GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY,

        // STT Configuration
        STT_PROVIDER: process.env.STT_PROVIDER,
        STT_PROMPT_TEMPLATE: process.env.STT_PROMPT_TEMPLATE,

        // Deepgram STT
        DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
        DEEPGRAM_MODEL: process.env.DEEPGRAM_MODEL,
        DEEPGRAM_LANGUAGE: process.env.DEEPGRAM_LANGUAGE,
        DEEPGRAM_SMART_FORMAT: process.env.DEEPGRAM_SMART_FORMAT,
        DEEPGRAM_PUNCTUATE: process.env.DEEPGRAM_PUNCTUATE,
        DEEPGRAM_DIARIZE: process.env.DEEPGRAM_DIARIZE,

        // ReturnZero STT (Legacy)
        RTZR_CLIENT_ID: process.env.RTZR_CLIENT_ID,
        RTZR_CLIENT_SECRET: process.env.RTZR_CLIENT_SECRET,
        RTZR_API_URL: process.env.RTZR_API_URL,

        // JWT
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
        JWT_EXPIRY: process.env.JWT_EXPIRY,
        JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY,

        // Email
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_file: "logs/combined.log",
      time: true,
    },
  ],
};
