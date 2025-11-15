# Database Migrations

This directory contains SQL migration scripts for the translator database.

## Migration Scripts

### 1. `add_is_email_verified.sql`
**Purpose**: Adds the `is_email_verified` column to the `users` table.

**Issue**: Login error "Unknown column 'is_email_verified' in 'field list'"

**Usage**:
```bash
mysql -u root -p translator_db < migrations/add_is_email_verified.sql
```

---

### 2. `fix_foreign_key_types.sql`
**Purpose**: Fixes UUID column type incompatibilities for foreign keys.

**Issue**: "Referencing column 'user_id' and referenced column 'id' in foreign key constraint are incompatible"

**What it does**:
- Drops existing foreign key constraints
- Ensures all UUID columns use `CHAR(36)` type consistently
- Recreates foreign key constraints with proper types
- Applies to: `users.id`, `refresh_tokens.user_id`, `rooms.user_id`, `saved_transcripts.user_id`

**Usage**:
```bash
mysql -u root -p translator_db < migrations/fix_foreign_key_types.sql
```

---

### 3. `reset_database_dev.sql` ⚠️ DESTRUCTIVE
**Purpose**: Completely resets the database (drops all tables).

**WARNING**: This will delete all data! Only use in development!

**When to use**:
- When migrations fail or schema is too broken
- When you want a clean slate
- Development environment only

**Usage**:
```bash
# 1. Run reset script
mysql -u root -p translator_db < migrations/reset_database_dev.sql

# 2. Restart backend server to recreate tables
cd backend
npm run dev
```

The backend server (in development mode) will automatically recreate all tables with the correct schema using Sequelize sync.

---

## Recommended Order

For a fresh setup with existing database:

```bash
# Option A: Incremental fixes (preserves data)
mysql -u root -p translator_db < migrations/add_is_email_verified.sql
mysql -u root -p translator_db < migrations/fix_foreign_key_types.sql

# Option B: Full reset (fastest, loses data)
mysql -u root -p translator_db < migrations/reset_database_dev.sql
# Then restart backend: npm run dev
```

---

## Alternative: Automatic Sync

Instead of running migrations manually, you can rely on Sequelize's automatic sync in development mode:

1. Start MySQL server
2. Run backend: `npm run dev`
3. Sequelize will automatically create/update tables

This is configured in `src/infrastructure/database/sequelize.ts`:
```typescript
if (config.app.isDev) {
  await sequelize.sync({ alter: true });
}
```

---

## Troubleshooting

### "Table doesn't exist"
→ Run `reset_database_dev.sql` and restart backend

### "Column doesn't exist"
→ Run `add_is_email_verified.sql`

### "Foreign key constraint incompatible"
→ Run `fix_foreign_key_types.sql`

### "Access denied"
→ Check your MySQL credentials in `.env`:
```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=translator_db
DB_USER=root
DB_PASSWORD=your_password
```

---

## Production Notes

⚠️ **Never use `reset_database_dev.sql` in production!**

For production deployments, use proper migration tools like:
- [Sequelize Migrations](https://sequelize.org/docs/v6/other-topics/migrations/)
- [TypeORM Migrations](https://typeorm.io/migrations)
- [Prisma Migrate](https://www.prisma.io/docs/concepts/components/prisma-migrate)

These tools allow you to:
- Version control your schema changes
- Rollback migrations if needed
- Preserve production data
- Track migration history
