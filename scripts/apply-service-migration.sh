#!/bin/bash
# scripts/apply-service-migration.sh
# Apply Tenant model migration to service database
#
# Usage:
#   bash scripts/apply-service-migration.sh
#   OR
#   npm run db:migrate:service

set -e

echo "=== Applying Service Database Migration (T013) ==="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "Error: .env file not found"
  echo "Please create .env from .env.example"
  exit 1
fi

# Extract SERVICE_DATABASE_URL from .env
SERVICE_DB_URL=$(grep "^SERVICE_DATABASE_URL=" .env | cut -d '=' -f2-)

if [ -z "$SERVICE_DB_URL" ]; then
  echo "Error: SERVICE_DATABASE_URL not found in .env"
  exit 1
fi

echo "Database URL: $SERVICE_DB_URL"
echo ""

# Check if it's a local SQLite file
if [[ $SERVICE_DB_URL == file:* ]]; then
  echo "Using local SQLite database"
  echo "Running initialization script..."
  node scripts/init-service-db.js
else
  echo "Using remote Turso database"
  echo "Applying migration via Turso CLI..."

  # Extract database name from URL
  DB_NAME=$(echo $SERVICE_DB_URL | sed 's|libsql://\([^.]*\).*|\1|')

  if command -v turso &> /dev/null; then
    turso db shell $DB_NAME < prisma/migrations/001_init_service_db.sql
    echo "✓ Migration applied successfully"
  else
    echo "Warning: Turso CLI not found"
    echo "Please install Turso CLI or apply migration manually:"
    echo "  turso db shell $DB_NAME < prisma/migrations/001_init_service_db.sql"
    exit 1
  fi
fi

echo ""
echo "=== Migration Complete ==="
echo "✓ T013: Tenant model migration applied to service database"
echo ""
echo "Verification:"
echo "  Run: node scripts/verify-service-db.js"
echo ""
