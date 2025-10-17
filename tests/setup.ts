// tests/setup.ts
/**
 * Test Setup - Initialize local SQLite database for testing
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Set test environment
process.env.DATABASE_URL = 'file:./tests/test.db'
process.env.NODE_ENV = 'test'

const testDbPath = path.join(process.cwd(), 'tests/test.db')

// Clean up old test database
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath)
  console.log('✓ Cleaned up old test database')
}

// Create directory if it doesn't exist
const testsDir = path.dirname(testDbPath)
if (!fs.existsSync(testsDir)) {
  fs.mkdirSync(testsDir, { recursive: true })
}

try {
  // Apply migrations to create schema
  console.log('Applying migrations to test database...')

  // Read migration files and apply them
  const migrationsDir = path.join(process.cwd(), 'prisma/migrations')

  // Create test database with sqlite3
  execSync(`sqlite3 ${testDbPath} "SELECT 1"`, { stdio: 'inherit' })

  // Apply base schema migration (001)
  const migration001 = fs.readFileSync(
    path.join(migrationsDir, '20251014121551_init/migration.sql'),
    'utf-8'
  )
  execSync(`sqlite3 ${testDbPath} "${migration001.replace(/"/g, '\\"')}"`, {
    stdio: 'inherit',
    shell: '/bin/bash',
  })

  // Apply vector embeddings migration (002)
  const migration002 = fs.readFileSync(
    path.join(migrationsDir, '002_add_vector_embeddings.sql'),
    'utf-8'
  )
  execSync(`sqlite3 ${testDbPath} "${migration002.replace(/"/g, '\\"')}"`, {
    stdio: 'inherit',
    shell: '/bin/bash',
  })

  // Apply draft fields migration (003)
  const migration003 = fs.readFileSync(
    path.join(migrationsDir, '003_add_review_draft_fields.sql'),
    'utf-8'
  )
  execSync(`sqlite3 ${testDbPath} "${migration003.replace(/"/g, '\\"')}"`, {
    stdio: 'inherit',
    shell: '/bin/bash',
  })

  console.log('✓ Test database initialized with all migrations')
} catch (error) {
  console.error('Error setting up test database:', error)
  process.exit(1)
}
