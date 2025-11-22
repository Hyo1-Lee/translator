const mysql = require("mysql2/promise");
require("dotenv").config();

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
  });

  try {
    await connection.query(
      "CREATE DATABASE IF NOT EXISTS translator_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
  } catch (error) {
    console.error("❌ Error creating database:", error.message);
  } finally {
    await connection.end();
  }
}

createDatabase();
