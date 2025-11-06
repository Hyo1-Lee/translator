-- Migration: Fix foreign key type incompatibility
-- Date: 2025-11-06
-- Description: Fixes UUID column types to be compatible for foreign keys

USE translator_db;

-- Drop existing foreign key constraints if they exist
SET @drop_fk_refresh = (
    SELECT CONCAT('ALTER TABLE refresh_tokens DROP FOREIGN KEY ', CONSTRAINT_NAME, ';')
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'translator_db'
    AND TABLE_NAME = 'refresh_tokens'
    AND REFERENCED_TABLE_NAME = 'users'
    LIMIT 1
);

SET @drop_fk_refresh = IFNULL(@drop_fk_refresh, 'SELECT "No FK constraint to drop on refresh_tokens" AS message;');
PREPARE stmt FROM @drop_fk_refresh;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop similar FKs for other tables
SET @drop_fk_rooms = (
    SELECT CONCAT('ALTER TABLE rooms DROP FOREIGN KEY ', CONSTRAINT_NAME, ';')
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'translator_db'
    AND TABLE_NAME = 'rooms'
    AND REFERENCED_TABLE_NAME = 'users'
    LIMIT 1
);

SET @drop_fk_rooms = IFNULL(@drop_fk_rooms, 'SELECT "No FK constraint to drop on rooms" AS message;');
PREPARE stmt FROM @drop_fk_rooms;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_fk_saved = (
    SELECT CONCAT('ALTER TABLE saved_transcripts DROP FOREIGN KEY ', CONSTRAINT_NAME, ';')
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'translator_db'
    AND TABLE_NAME = 'saved_transcripts'
    AND REFERENCED_TABLE_NAME = 'users'
    LIMIT 1
);

SET @drop_fk_saved = IFNULL(@drop_fk_saved, 'SELECT "No FK constraint to drop on saved_transcripts" AS message;');
PREPARE stmt FROM @drop_fk_saved;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure users.id is CHAR(36) for UUID string format
ALTER TABLE users MODIFY COLUMN id CHAR(36) NOT NULL;

-- Ensure all user_id columns match the users.id type
ALTER TABLE refresh_tokens MODIFY COLUMN user_id CHAR(36) NOT NULL;
ALTER TABLE rooms MODIFY COLUMN user_id CHAR(36) NULL;
ALTER TABLE saved_transcripts MODIFY COLUMN user_id CHAR(36) NOT NULL;

-- Recreate foreign key constraints
ALTER TABLE refresh_tokens
ADD CONSTRAINT fk_refresh_tokens_user_id
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE rooms
ADD CONSTRAINT fk_rooms_user_id
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE saved_transcripts
ADD CONSTRAINT fk_saved_transcripts_user_id
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE;

-- Verify the changes
SELECT '✅ users.id column type:' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'translator_db'
AND TABLE_NAME = 'users'
AND COLUMN_NAME = 'id';

SELECT '✅ Foreign key columns:' AS info;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'translator_db'
AND COLUMN_NAME = 'user_id'
ORDER BY TABLE_NAME;

SELECT '✅ Foreign key constraints:' AS info;
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'translator_db'
AND REFERENCED_TABLE_NAME = 'users'
ORDER BY TABLE_NAME;

SELECT '✅ Migration completed successfully!' AS status;
