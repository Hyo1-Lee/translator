-- Migration: Add Translation Features
-- Date: 2025-11-22
-- Description: 프리셋 시스템 및 실시간 문맥 유지 번역 기능 추가

-- =============================================
-- 1. room_settings 테이블 확장
-- =============================================

-- 출발 언어 (기본: 한국어)
ALTER TABLE room_settings
ADD COLUMN source_language VARCHAR(10) DEFAULT 'ko' AFTER max_listeners;

-- 환경 프리셋 (church, medical, legal, business, general, custom)
ALTER TABLE room_settings
ADD COLUMN environment_preset VARCHAR(20) DEFAULT 'general' AFTER source_language;

-- 커스텀 환경 설명
ALTER TABLE room_settings
ADD COLUMN custom_environment_description TEXT NULL AFTER environment_preset;

-- 커스텀 용어집 (JSON)
ALTER TABLE room_settings
ADD COLUMN custom_glossary JSON NULL AFTER custom_environment_description;

-- 번역 대상 언어 배열 (JSON)
ALTER TABLE room_settings
ADD COLUMN target_languages_array JSON NULL AFTER custom_glossary;

-- 스트리밍 번역 활성화 여부
ALTER TABLE room_settings
ADD COLUMN enable_streaming BOOLEAN DEFAULT TRUE AFTER target_languages_array;

-- =============================================
-- 2. translation_texts 테이블 생성
-- =============================================

CREATE TABLE IF NOT EXISTS translation_texts (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  room_id CHAR(36) NOT NULL,
  stt_text_id CHAR(36) NULL,
  target_language VARCHAR(10) NOT NULL,
  translated_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  context_summary TEXT NULL,
  is_partial BOOLEAN DEFAULT FALSE,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Foreign Keys
  CONSTRAINT fk_translation_room
    FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_translation_stt_text
    FOREIGN KEY (stt_text_id) REFERENCES stt_texts(id)
    ON DELETE SET NULL,

  -- Indexes
  INDEX idx_translation_room_lang (room_id, target_language),
  INDEX idx_translation_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- 마이그레이션 완료
-- =============================================
