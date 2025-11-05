const mysql = require('mysql2/promise');

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'GYzz001020!!',
  });

  try {
    console.log('🔄 Creating database...');
    await connection.query('CREATE DATABASE IF NOT EXISTS translator_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('✅ Database translator_db created successfully');
  } catch (error) {
    console.error('❌ Error creating database:', error.message);
  } finally {
    await connection.end();
  }
}

createDatabase();
