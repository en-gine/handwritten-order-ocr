// scripts/verify-service-db.js
// Verify that service database migration has been applied

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=== Service Database Migration Verification ===\n');

// Check .env configuration
const envPath = join(__dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error('✗ .env file not found');
  process.exit(1);
}

const envContent = readFileSync(envPath, 'utf-8');
const SERVICE_DATABASE_URL = envContent
  .split('\n')
  .find(line => line.startsWith('SERVICE_DATABASE_URL='))
  ?.split('=')[1]
  ?.trim();

if (!SERVICE_DATABASE_URL) {
  console.error('✗ SERVICE_DATABASE_URL not found in .env');
  process.exit(1);
}

console.log('✓ Environment Configuration');
console.log(`  DATABASE_URL: ${SERVICE_DATABASE_URL}`);
console.log();

// Check migration file exists
const migrationPath = join(__dirname, '..', 'prisma', 'migrations', '001_init_service_db.sql');
if (!existsSync(migrationPath)) {
  console.error('✗ Migration file not found:', migrationPath);
  process.exit(1);
}

console.log('✓ Migration File Exists');
console.log(`  Path: ${migrationPath}`);
console.log();

// Check schema file exists
const schemaPath = join(__dirname, '..', 'prisma', 'service-schema.prisma');
if (!existsSync(schemaPath)) {
  console.error('✗ Schema file not found:', schemaPath);
  process.exit(1);
}

console.log('✓ Schema File Exists');
console.log(`  Path: ${schemaPath}`);
console.log();

// Check if database file exists (for local SQLite)
if (SERVICE_DATABASE_URL.startsWith('file:')) {
  const dbPath = SERVICE_DATABASE_URL.replace('file:', '');
  const absoluteDbPath = join(__dirname, '..', dbPath);

  if (existsSync(absoluteDbPath)) {
    console.log('✓ Database File Exists');
    console.log(`  Path: ${absoluteDbPath}`);
    console.log();
  } else {
    console.log('⚠ Database File Not Yet Created');
    console.log(`  Expected Path: ${absoluteDbPath}`);
    console.log('  Run: node scripts/init-service-db.js (after npm install)');
    console.log();
  }
}

// Summary
console.log('=== Migration Status ===');
console.log('✓ T012: Service database configured');
console.log('⚠ T013: Ready to apply migration');
console.log();
console.log('Next Steps:');
console.log('1. Install dependencies: npm install');
console.log('2. Apply migration: node scripts/init-service-db.js');
console.log('   OR: npx prisma db push --schema=prisma/service-schema.prisma');
console.log();
