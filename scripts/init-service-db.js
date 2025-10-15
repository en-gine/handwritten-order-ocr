// scripts/init-service-db.js
// Initialize service database with Tenant table

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read .env file
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const SERVICE_DATABASE_URL = envContent
  .split('\n')
  .find(line => line.startsWith('SERVICE_DATABASE_URL='))
  ?.split('=')[1]
  ?.trim();

if (!SERVICE_DATABASE_URL) {
  console.error('ERROR: SERVICE_DATABASE_URL not found in .env');
  process.exit(1);
}

console.log('Initializing service database...');
console.log('Database URL:', SERVICE_DATABASE_URL);

// Create database client
const db = createClient({
  url: SERVICE_DATABASE_URL,
});

// Create tenants table
const createTableSQL = `
CREATE TABLE IF NOT EXISTS tenants (
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
`;

try {
  await db.execute(createTableSQL);
  console.log('✓ Tenants table created successfully');

  // Verify table was created
  const result = await db.execute(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='tenants';
  `);

  if (result.rows.length > 0) {
    console.log('✓ Service database initialized successfully');
    console.log('\nNext steps:');
    console.log('  1. Run: npm install (to install dependencies)');
    console.log('  2. Run: npm run db:generate (to generate Prisma client)');
    console.log('  3. Run: npm run db:migrate (to apply migrations to tenant DBs)');
  } else {
    console.error('✗ Table creation verification failed');
    process.exit(1);
  }
} catch (error) {
  console.error('Error creating service database:', error);
  process.exit(1);
} finally {
  db.close();
}
