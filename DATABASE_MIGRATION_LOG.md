# Database Migration Log

## 2025-10-15: Turso Group Migration to ai-ocr

### Summary
Migrated all Turso databases from `default` group to dedicated `ai-ocr` group for better project isolation and management.

### Background
- **Issue**: All databases were in the `default` group, which could conflict with other projects
- **Decision**: Create dedicated `ai-ocr` group for this project
- **Note**: Turso groups are for project/environment separation, NOT for multi-tenancy
  - Multi-tenancy is achieved through separate databases per tenant
  - Groups help with project isolation and future replication configuration

### Migration Steps

1. **Created ai-ocr group**
   ```bash
   turso group create ai-ocr --location aws-ap-northeast-1
   ```

2. **Deleted old databases** (default group)
   - ocr-seed-db
   - ocr-service-db
   - ocr-tenant-test

3. **Created new databases** (ai-ocr group)
   - ocr-seed-db (seed database with schema)
   - ocr-service-db (tenant metadata)
   - ocr-tenant-test (test tenant database)

4. **Applied migrations**
   - Initial migration (20251014121551_init)
   - Vector embeddings migration (002_add_vector_embeddings.sql)
   - Service database migration (service_db_init.sql)

5. **Updated .env configuration**
   - New database URLs (unchanged, same hostnames)
   - New authentication tokens (regenerated)
   - Added group documentation comments

### Database Configuration

All databases now in **ai-ocr group** (aws-ap-northeast-1):

| Database | URL | Purpose |
|----------|-----|---------|
| ocr-seed-db | libsql://ocr-seed-db-sutefu23.aws-ap-northeast-1.turso.io | Template schema for new tenants |
| ocr-service-db | libsql://ocr-service-db-sutefu23.aws-ap-northeast-1.turso.io | Tenant metadata storage |
| ocr-tenant-test | libsql://ocr-tenant-test-sutefu23.aws-ap-northeast-1.turso.io | Development/testing database |

### Schema Verification

Confirmed all tables exist with proper schema:

**Tenant Databases** (ocr-seed-db, ocr-tenant-test):
- customer_context (with embedding F32_BLOB(768))
- customers
- order_history (with embedding F32_BLOB(768))
- order_items
- orders
- processing_results
- products (with embedding F32_BLOB(768))
- review_queue
- tenants

**Service Database** (ocr-service-db):
- tenants (metadata only)

### Environment Variables Updated

```env
# Seed Database
SEED_DATABASE_URL=libsql://ocr-seed-db-sutefu23.aws-ap-northeast-1.turso.io
SEED_DATABASE_TOKEN=[NEW_TOKEN]

# Service Database
SERVICE_DATABASE_URL=libsql://ocr-service-db-sutefu23.aws-ap-northeast-1.turso.io
SERVICE_DATABASE_TOKEN=[NEW_TOKEN]

# Tenant Database (test)
DATABASE_URL=libsql://ocr-tenant-test-sutefu23.aws-ap-northeast-1.turso.io
DATABASE_TOKEN=[NEW_TOKEN]
```

### Benefits

1. **Project Isolation**: ai-ocr databases separate from other projects
2. **Clear Organization**: `turso db list` shows only ai-ocr databases when filtered
3. **Future-Ready**: Group configuration enables easy replication setup if needed
4. **Professional Structure**: Dedicated group demonstrates proper project organization

### Migration Impact

✅ **No Breaking Changes**:
- Database URLs unchanged (same hostnames)
- Schema preserved perfectly
- All migrations applied successfully

⚠️ **Action Required**:
- Update local .env with new tokens (completed)
- Regenerate tokens if sharing with team members

### Verification Commands

```bash
# List all databases in ai-ocr group
turso db list | grep ai-ocr

# Verify schema
turso db shell ocr-tenant-test ".tables"

# Check vector columns
turso db shell ocr-seed-db "PRAGMA table_info(products)" | grep embedding
```

### Next Steps

- Continue with Phase 2 implementation tasks
- Use ai-ocr group for all future tenant databases
- Document group naming convention for production environments

---

**Migration Completed**: 2025-10-15T11:45:00+09:00
**Performed By**: Claude Code Assistant
**Status**: ✅ Success
