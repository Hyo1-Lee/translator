-- Migration: Reset database for development (DESTRUCTIVE!)
-- Date: 2025-11-06
-- Description: Drops and recreates all tables with correct schema
-- WARNING: This will delete all data! Only use in development!

USE translator_db;

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- Drop all tables
DROP TABLE IF EXISTS saved_transcripts;
DROP TABLE IF EXISTS transcripts;
DROP TABLE IF EXISTS stt_texts;
DROP TABLE IF EXISTS listeners;
DROP TABLE IF EXISTS room_settings;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS verification_codes;
DROP TABLE IF EXISTS users;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

SELECT '✅ All tables dropped successfully!' AS status;
SELECT '⚠️  Now restart the backend server to recreate tables with correct schema' AS instruction;
