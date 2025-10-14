# Developer Quickstart Guide

**Handwritten Order OCR Engine** | TypeScript + Hono + Mastra + Prisma + Turso

Get the OCR API running locally in under 15 minutes.

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js 20+** LTS ([Download](https://nodejs.org/))
- **Turso CLI** ([Installation Guide](https://docs.turso.tech/cli/installation))
- **Gemini API Key** ([Get API Key](https://ai.google.dev/))
- **Git** (for cloning the repository)

### Verify Installation

```bash
node --version  # Should be v20.x.x or higher
turso --version # Should display Turso CLI version
```

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ocr
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- Hono (web framework)
- Mastra (AI orchestration)
- Prisma + libSQL adapter (ORM)
- Turso client
- Gemini SDK
- Other dependencies

---

## Database Setup

The system uses Turso's Multi-DB Schemas architecture with separate databases per tenant.

### 1. Create Parent Schema Database

The parent database defines the schema that propagates to all tenant databases:

```bash
# Create parent schema database (local development)
turso db create ocr-schema-db --type schema

# Get the database URL (save for later)
turso db show ocr-schema-db --url
```

### 2. Create Service Database

The service database stores tenant metadata (mappings to tenant-specific databases):

```bash
# Create service database for tenant metadata
turso db create ocr-service-db

# Get the database URL
turso db show ocr-service-db --url
```

### 3. Create Test Tenant Database

Create at least one tenant database for development:

```bash
# Create a test tenant database (inherits schema from parent)
turso db create ocr-tenant-test --from-db ocr-schema-db

# Get the database URL
turso db show ocr-tenant-test --url
```

### 4. Generate Auth Tokens

Generate authentication tokens for database connections:

```bash
# Generate token for parent schema database
turso db tokens create ocr-schema-db

# Generate token for service database
turso db tokens create ocr-service-db

# Generate token for test tenant database
turso db tokens create ocr-tenant-test
```

**Save these tokens** - you'll need them for environment variables.

---

## Environment Variables

### 1. Copy Environment Template

```bash
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` and fill in the following:

```bash
# Node Environment
NODE_ENV=development

# Service Database (stores tenant metadata)
SERVICE_DATABASE_URL=libsql://ocr-service-db-[your-org].turso.io
SERVICE_DATABASE_TOKEN=your-service-db-token-here

# Parent Schema Database (defines structure)
SCHEMA_DATABASE_URL=libsql://ocr-schema-db-[your-org].turso.io
SCHEMA_DATABASE_TOKEN=your-schema-db-token-here

# Test Tenant Database (for local development)
TEST_TENANT_ID=tenant-test
TEST_TENANT_DATABASE_URL=libsql://ocr-tenant-test-[your-org].turso.io
TEST_TENANT_DATABASE_TOKEN=your-tenant-test-db-token-here

# Gemini AI Configuration
GEMINI_API_KEY=your-gemini-api-key-here
DEFAULT_AI_MODEL=gemini-2.0-flash-exp

# JWT Authentication (for API access)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_PUBLIC_KEY=optional-for-rs256-signing
JWT_PRIVATE_KEY=optional-for-rs256-signing

# File Storage (local development)
STORAGE_TYPE=local
UPLOAD_DIR=./uploads

# Production File Storage (Cloudflare R2, optional)
# R2_BUCKET_NAME=ocr-order-forms
# R2_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
# R2_ACCESS_KEY_ID=your-r2-access-key
# R2_SECRET_ACCESS_KEY=your-r2-secret-key

# API Configuration
API_PORT=3000
CONFIDENCE_THRESHOLD=0.70

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Database Schema Setup

### 1. Generate Prisma Client

```bash
npx prisma generate
```

This generates the Prisma Client based on `prisma/schema.prisma`.

### 2. Apply Schema Migrations

Apply the initial schema to the parent database:

```bash
# Apply migrations to parent schema database
npx prisma migrate deploy
```

The schema will automatically propagate to all child databases (including `ocr-tenant-test`).

### 3. Verify Schema Propagation

Check that the test tenant database has the correct schema:

```bash
turso db shell ocr-tenant-test

# Inside the shell, run:
.tables
# Should show: customers, orders, order_items, products, order_history, etc.

.exit
```

### 4. Seed Test Data

Populate the test tenant database with sample data:

```bash
npm run db:seed
```

This creates:
- Sample customers (5 records)
- Sample products (20 records)
- Sample order history (for context-aware recognition)

---

## Running the Development Server

### 1. Start the API Server

```bash
npm run dev
```

The server starts on `http://localhost:3000`.

You should see output like:

```
Server running on http://localhost:3000
Environment: development
Tenant databases connected: 1
```

### 2. Health Check

Test the server is running:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-10-14T12:00:00.000Z",
  "environment": "development"
}
```

### 3. Test Authentication

Generate a test JWT token:

```bash
npm run auth:generate-token -- --tenant-id=tenant-test
```

This outputs a JWT token. Copy it for use in API requests.

### 4. Test OCR Endpoint

Upload a sample order form (PDF or image):

```bash
curl -X POST http://localhost:3000/api/v1/ocr \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@./tests/fixtures/sample-order.pdf"
```

Expected response (202 Accepted):

```json
{
  "orderId": "order-abc123",
  "status": "processing",
  "message": "Order form uploaded successfully"
}
```

---

## Running Tests

### 1. Run All Tests

```bash
npm test
```

This runs:
- Unit tests (services, utilities)
- Integration tests (API endpoints)
- Database tests (Prisma queries)

### 2. Run Tests with Coverage

```bash
npm run test:coverage
```

Coverage report is generated in `./coverage/index.html`.

### 3. Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode (for TDD)
npm run test:watch
```

### 4. Test File Upload Flow

Run the OCR integration test:

```bash
npm run test:ocr
```

This tests:
- File upload validation (size, format)
- OCR processing with Gemini
- Customer/product matching
- Order creation and persistence

---

## Common Development Tasks

### Creating New Migrations

When you modify `prisma/schema.prisma`:

1. Generate a migration:

```bash
npx prisma migrate dev --name add_customer_notes
```

2. Apply to parent schema database:

```bash
turso db shell ocr-schema-db < prisma/migrations/XXXXXX_add_customer_notes/migration.sql
```

3. Schema automatically propagates to all tenant databases.

### Provisioning New Tenants

To create a new tenant with isolated database:

```bash
npm run tenant:provision -- \
  --name="Acme Corp" \
  --email="admin@acme.com" \
  --tier="standard"
```

This:
- Creates a new Turso child database
- Generates authentication credentials
- Registers tenant in service database
- Returns tenant API key/JWT

### Importing Master Data

Import customer and product data for a tenant:

**CSV Import (Product Master)**:

```bash
curl -X POST http://localhost:3000/api/v1/master/import \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "type=product" \
  -F "mode=incremental" \
  -F "format=csv" \
  -F "file=@./data/products.csv"
```

**JSON Import (Customer Master)**:

```bash
curl -X POST http://localhost:3000/api/v1/master/import \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "customer",
    "mode": "full",
    "format": "json",
    "data": [
      {
        "customer_code": "C001",
        "customer_name": "田中商店",
        "phone": "03-1234-5678",
        "email": "tanaka@example.com"
      }
    ]
  }'
```

### Viewing Tenant Databases

List all tenant databases:

```bash
turso db list | grep ocr-tenant
```

Open a specific tenant database shell:

```bash
turso db shell ocr-tenant-test
```

Query orders for a customer:

```sql
SELECT o.id, o.status, o.overallConfidence, c.name
FROM orders o
JOIN customers c ON o.customerId = c.id
WHERE c.customerCode = 'C001'
ORDER BY o.createdAt DESC
LIMIT 10;
```

### Checking Review Queue

View orders requiring human review:

```bash
curl -X GET http://localhost:3000/api/v1/reviews \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Response:

```json
{
  "reviews": [
    {
      "orderId": "order-abc123",
      "customerId": "cust-456",
      "overallConfidence": 0.65,
      "flagReason": "low_confidence",
      "status": "pending",
      "imageUrl": "https://storage.../order-abc123.pdf"
    }
  ],
  "total": 1
}
```

### Monitoring OCR Processing

Tail application logs:

```bash
npm run logs
```

Or with filtering:

```bash
npm run logs | grep "OCR processing"
```

### Running Database Migrations for Existing Tenants

When you have multiple tenants and need to migrate them all:

```bash
npm run migrate:tenants -- --migration=XXXXXX_add_customer_notes
```

This script:
1. Fetches all active tenants from service database
2. Applies migration SQL to each tenant database
3. Reports success/failure per tenant
4. Logs migration progress

---

## Troubleshooting

### Error: "Turso database not found"

**Cause**: Database URL or token is incorrect in `.env`.

**Fix**:
1. Verify database exists: `turso db list`
2. Regenerate token: `turso db tokens create <db-name>`
3. Update `.env` with correct values

### Error: "Gemini API quota exceeded"

**Cause**: You've exceeded the free tier API limits.

**Fix**:
1. Check usage: [Gemini API Console](https://ai.google.dev/)
2. Wait for quota reset (next day)
3. Or upgrade to paid tier

### Error: "Prisma Client initialization failed"

**Cause**: Prisma Client wasn't generated after schema changes.

**Fix**:
```bash
npx prisma generate
npm run dev
```

### Error: "File upload too large"

**Cause**: Order form exceeds 10MB limit.

**Fix**:
1. Compress the PDF/image
2. Or increase limit in `src/api/routes/ocr.ts` (if needed)

### Tests Failing with Database Errors

**Cause**: Test database not seeded or schema outdated.

**Fix**:
```bash
npm run db:reset:test
npm run db:seed:test
npm test
```

---

## Project Structure Overview

```
ocr/
├── src/
│   ├── api/                    # Hono routes and middleware
│   │   ├── routes/
│   │   │   ├── ocr.ts         # POST /ocr (upload & process)
│   │   │   ├── review.ts      # GET/PATCH /reviews
│   │   │   ├── master.ts      # POST /master/import
│   │   │   └── tenants.ts     # POST /tenants (admin)
│   │   ├── middleware/
│   │   │   ├── auth.ts        # JWT authentication
│   │   │   ├── tenant.ts      # Tenant routing
│   │   │   └── rateLimit.ts   # Rate limiting
│   │   └── index.ts           # App initialization
│   ├── services/
│   │   ├── ocr.service.ts     # OCR orchestration (Mastra + Gemini)
│   │   ├── matching.service.ts # Customer/product matching
│   │   ├── context.service.ts  # Historical context analysis
│   │   └── import.service.ts   # Master data import
│   ├── lib/
│   │   ├── turso.ts           # Turso client factory
│   │   ├── gemini.ts          # Gemini API wrapper
│   │   ├── vectors.ts         # Vector embeddings
│   │   └── storage/           # File storage (local/R2)
│   └── types/
│       ├── ocr.ts             # OCR entity types
│       └── api.ts             # API request/response types
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Migration history
│   └── seed.ts                # Test data seeding
├── tests/
│   ├── integration/           # API endpoint tests
│   ├── unit/                  # Service layer tests
│   └── fixtures/              # Sample order forms, master data
├── uploads/                   # Local file storage (dev)
├── .env                       # Environment variables
└── package.json
```

---

## Next Steps

### For Development

1. **Explore the API**: Review `specs/001-ocr-typescript-hono/contracts/ocr-api.yaml` for full API documentation
2. **Read the Spec**: Understand requirements in `specs/001-ocr-typescript-hono/spec.md`
3. **Check Data Model**: Review database schema in `specs/001-ocr-typescript-hono/data-model.md`
4. **Study Architecture**: Read technical decisions in `specs/001-ocr-typescript-hono/research.md`

### For Testing

1. Upload sample order forms from `tests/fixtures/sample-orders/`
2. Test context-aware recognition with "いつもの" (the usual) orders
3. Simulate low-confidence scenarios and test review workflow
4. Import sample master data and verify matching accuracy

### For Production Deployment

1. **Set up Cloudflare R2**: Replace local file storage with R2 buckets
2. **Configure JWT Signing**: Generate RSA key pairs for RS256 signing
3. **Enable Redis**: Add Redis for distributed rate limiting
4. **Set up Monitoring**: Integrate logging (Sentry, Datadog, etc.)
5. **CI/CD Pipeline**: Configure automated testing and deployment

---

## Support & Documentation

- **Technical Spec**: `specs/001-ocr-typescript-hono/spec.md`
- **API Contracts**: `specs/001-ocr-typescript-hono/contracts/ocr-api.yaml`
- **Data Model**: `specs/001-ocr-typescript-hono/data-model.md`
- **Architecture Research**: `specs/001-ocr-typescript-hono/research.md`

For questions or issues, check the project documentation or open a GitHub issue.

---

**You're ready to develop!** Start the server with `npm run dev` and begin building the OCR engine.
