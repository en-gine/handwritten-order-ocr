-- Migration: 001_init_service_db
-- Purpose: Initialize service database with Tenant model
-- Database: Service Database (stores tenant metadata)
-- Date: 2025-10-15

-- Create tenants table
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

-- Create index on database name for fast lookups
CREATE INDEX IF NOT EXISTS idx_tenants_database_name ON tenants(databaseName);

-- Create index on active status for filtering
CREATE INDEX IF NOT EXISTS idx_tenants_is_active ON tenants(isActive);
