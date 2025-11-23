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
        DB_PASSWORD: process.env.DB_PASS,

        // Frontend
        FRONTEND_URL: process.env.FRONTEND_URL,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,

        // API Keys
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        RTZR_CLIENT_ID: process.env.RTZR_CLIENT_ID,
        RTZR_CLIENT_SECRET: process.env.RTZR_CLIENT_SECRET,
        RTZR_API_URL: process.env.RTZR_API_URL,

        // STT
        STT_PROVIDER: process.env.STT_PROVIDER,
        STT_PROMPT_TEMPLATE: process.env.STT_PROMPT_TEMPLATE,

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
