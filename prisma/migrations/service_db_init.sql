-- Service Database Migration: Tenant table only
-- This migration creates the Tenant table in the service database
-- which is used to store metadata about tenant databases

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "databaseUrl" TEXT NOT NULL,
    "databaseHostname" TEXT NOT NULL,
    "apiKey" TEXT,
    "confidenceThreshold" REAL NOT NULL DEFAULT 0.70,
    "aiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash-exp',
    "rateLimitTier" TEXT NOT NULL DEFAULT 'standard',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_databaseName_key" ON "tenants"("databaseName");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_apiKey_key" ON "tenants"("apiKey");
