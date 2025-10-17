# Makefile for OCR MVP - Unified Testing and Development Commands
# Usage: make <target>

.PHONY: help test test-mvp test-unit test-integration test-all clean build dev setup db-validate lint format

# Default target - show help
help:
	@echo "OCR MVP - Available Commands"
	@echo ""
	@echo "Testing:"
	@echo "  make test              - Run MVP validation (recommended, 11 tests)"
	@echo "  make test-mvp          - Same as 'make test'"
	@echo "  make test-unit         - Run unit tests (if any)"
	@echo "  make test-integration  - Run Vitest integration tests (12/17 passing)"
	@echo "  make test-all          - Run all tests (MVP + integration)"
	@echo ""
	@echo "Development:"
	@echo "  make dev               - Start development server"
	@echo "  make build             - Build production bundle"
	@echo "  make lint              - Run ESLint"
	@echo "  make format            - Format code with Prettier"
	@echo ""
	@echo "Database:"
	@echo "  make db-validate       - Validate database schema"
	@echo "  make db-migrate        - Run Prisma migrations"
	@echo "  make db-seed           - Seed database with test data"
	@echo ""
	@echo "Setup:"
	@echo "  make setup             - Initial project setup"
	@echo "  make clean             - Clean build artifacts"

# Primary test command - runs MVP validation script
test: test-mvp

# Run MVP validation script (recommended - 11/11 tests passing)
test-mvp:
	@echo "Running MVP validation..."
	@./tests/validate-mvp.sh

# Run unit tests (currently none, placeholder for future)
test-unit:
	@echo "Running unit tests..."
	@npm run test:unit

# Run integration tests with Vitest (12/17 passing)
test-integration:
	@echo "Running integration tests..."
	@npm run test:integration

# Run all tests
test-all:
	@echo "Running all tests..."
	@echo "\n=== 1. MVP Validation (Shell Script) ==="
	@./tests/validate-mvp.sh
	@echo "\n=== 2. Integration Tests (Vitest) ==="
	@npm run test:integration

# Validate database schema
db-validate:
	@echo "Validating database schema..."
	@turso db shell ocr-tenant-test "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
	@echo "\nDraft fields in review_queue:"
	@turso db shell ocr-tenant-test "PRAGMA table_info(review_queue);" | grep -E "(draft|lastActivity)"

# Run database migrations
db-migrate:
	@echo "Running database migrations..."
	@npx prisma migrate deploy

# Seed database with test data
db-seed:
	@echo "Seeding database..."
	@npx prisma db seed

# Development server
dev:
	@npm run dev

# Build for production
build:
	@npm run build

# Lint code
lint:
	@npm run lint

# Format code
format:
	@npx prettier --write "src/**/*.ts" "tests/**/*.ts"

# Clean build artifacts
clean:
	@rm -rf dist/
	@rm -rf node_modules/.cache/
	@rm -rf coverage/
	@echo "Cleaned build artifacts"

# Initial project setup
setup:
	@echo "Setting up project..."
	@npm install
	@npx prisma generate
	@echo "\nSetup complete! Run 'make test' to validate MVP."
