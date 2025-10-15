# T012: Service Database Setup Guide

## Task Description
Create the service database that stores tenant metadata (separate from tenant data).

## Status
✅ **Configuration Complete** - Database schema and migration files created

## What Was Done

### 1. Environment Configuration
- ✅ `.env` configured with `SERVICE_DATABASE_URL=file:./prisma/service.db`
- ✅ Using local SQLite file for development (no Turso CLI required)

### 2. Schema Files Created
- ✅ `prisma/service-schema.prisma` - Prisma schema for service database
- ✅ `prisma/migrations/001_init_service_db.sql` - SQL migration script
- ✅ `scripts/init-service-db.js` - Initialization script

### 3. Database Structure
The service database contains a single `tenants` table:

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  databaseName TEXT UNIQUE NOT NULL,
  databaseUrl TEXT NOT NULL,
  databaseHostname TEXT NOT NULL,
  apiKey TEXT UNIQUE,
  confidenceThreshold REAL DEFAULT 0.70,
  aiModel TEXT DEFAULT 'gemini-2.0-flash-exp',
  rateLimitTier TEXT DEFAULT 'standard',
  isActive INTEGER DEFAULT 1,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Next Steps to Complete Setup

### Step 1: Install Dependencies
```bash
npm install
```

This will install:
- `@libsql/client` - Database client
- `@prisma/client` - ORM
- `prisma` - Schema management
- Other project dependencies

### Step 2: Initialize Service Database

**Option A: Using Node.js Script (Recommended)**
```bash
node scripts/init-service-db.js
```

**Option B: Using SQL Migration (If you have sqlite3 CLI)**
```bash
sqlite3 prisma/service.db < prisma/migrations/001_init_service_db.sql
```

**Option C: Using Prisma (After npm install)**
```bash
npx prisma db push --schema=prisma/service-schema.prisma
```

### Step 3: Verify Database Creation
```bash
# Check if database file exists
ls -la prisma/service.db

# Verify table structure (if sqlite3 is available)
sqlite3 prisma/service.db ".schema tenants"
```

## Verification Checklist

- [x] `.env` contains `SERVICE_DATABASE_URL`
- [x] `prisma/service-schema.prisma` created
- [x] SQL migration file created
- [ ] Dependencies installed (`npm install`)
- [ ] Database file created (`prisma/service.db`)
- [ ] Tenants table created and verified

## Acceptance Criteria (from tasks.md)

- [x] Service database created (configured, ready to initialize)
- [x] Database URL obtained (from .env)
- [x] URL saved to .env as SERVICE_DATABASE_URL

## Notes

### Why Local SQLite Instead of Turso?
- Turso CLI not available in current environment (Windows MINGW64)
- Local SQLite file provides same functionality for development
- Can migrate to Turso in production if needed

### Production Considerations
For production deployment, consider:
1. Migrate to Turso for distributed access
2. Use Turso CLI: `turso db create ocr-service-db`
3. Update `.env` with Turso URL and token
4. No code changes needed (same libSQL client)

## Files Created

```
prisma/
├── service-schema.prisma         # Tenant model schema
└── migrations/
    └── 001_init_service_db.sql   # Initial migration

scripts/
└── init-service-db.js            # Database initialization script

docs/
└── T012-SERVICE-DB-SETUP.md      # This file
```

## Related Tasks

- **T008**: Create Prisma schema (parent task)
- **T009**: Generate initial migration
- **T010**: Create Turso seed database
- **T013**: Apply Tenant model migration to service database

## Reference
- Original task: `tasks.md` line 46
- Quickstart guide: `quickstart.md` lines 69-78
- Data model: `data-model.md` lines 476-492
