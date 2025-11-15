-- Migration: Add is_email_verified column to users table
-- Date: 2025-11-06
-- Description: Adds email verification tracking column

USE translator_db;

-- Check if column exists before adding
SET @col_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'translator_db'
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'is_email_verified'
);

-- Add column if it doesn't exist
SET @query = IF(
    @col_exists = 0,
    'ALTER TABLE users ADD COLUMN is_email_verified TINYINT(1) DEFAULT 0 NOT NULL AFTER password',
    'SELECT "Column is_email_verified already exists" AS message'
);

PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the change
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'translator_db'
AND TABLE_NAME = 'users'
AND COLUMN_NAME = 'is_email_verified';

SELECT '✅ Migration completed successfully!' AS status;
