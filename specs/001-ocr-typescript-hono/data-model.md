# Data Model: Handwritten Order OCR Engine

**Branch**: `001-ocr-typescript-hono` | **Date**: 2025-10-14

This document defines the database schema for the multi-tenant handwritten order OCR system using Prisma ORM with Turso (libSQL/SQLite).

## Architecture Overview

- **Multi-tenancy**: Separate Turso databases per tenant (created from seed database template via `--from-db` flag)
- **Schema Management**: Seed database template defines structure, new tenants inherit schema automatically
- **ORM**: Prisma with `@prisma/adapter-libsql` driver adapter
- **Vector Storage**: Native libSQL `F32_BLOB` type for semantic embeddings (768 dimensions)
- **Indexes**: DiskANN vector indexes (`libsql_vector_idx`) for similarity search

---

## Complete Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ======================
// Core Entities
// ======================

/// Tenant represents an isolated organization using the OCR API
/// Each tenant has a dedicated Turso database (created from seed template)
model Tenant {
  id                  String   @id @default(uuid())
  name                String
  databaseName        String   @unique // Turso tenant database name (e.g., "ocr-tenant-abc123")
  databaseUrl         String   // libsql://tenant-abc123.turso.io
  databaseHostname    String   // tenant-abc123.turso.io
  apiKey              String?  @unique // Optional: for API key auth (if not using JWT)
  confidenceThreshold Float    @default(0.70) // Default 70% confidence threshold
  aiModel             String   @default("gemini-2.0-flash-exp") // Configurable AI model
  rateLimitTier       String   @default("standard") // standard, premium, enterprise
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@map("tenants")
}

/// Order represents a single handwritten order submission
model Order {
  id                String      @id @default(uuid())
  tenantId          String      // Implicit: stored in tenant's child DB
  customerId        String?     // NULL if customer not identified
  submissionTime    DateTime    @default(now())
  status            OrderStatus @default(PENDING)
  overallConfidence Float       // 0.0 - 1.0
  fileKey           String      // Storage key (S3/R2 path or local path)
  fileContentType   String      // image/jpeg, image/png, application/pdf
  fileSize          Int         // bytes
  flaggedForReview  Boolean     @default(false)
  processingResult  String?     // JSON: raw Gemini response
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  customer     Customer?     @relation(fields: [customerId], references: [id])
  items        OrderItem[]
  reviewQueue  ReviewQueue?
  orderHistory OrderHistory?

  @@index([tenantId, status])
  @@index([customerId])
  @@map("orders")
}

enum OrderStatus {
  PENDING    // Just uploaded, OCR not started
  PROCESSING // OCR in progress
  REVIEWING  // Low confidence, awaiting human review
  CONFIRMED  // Approved by operator or high confidence
  REJECTED   // Rejected by operator
}

/// OrderItem represents a single product line on an order
model OrderItem {
  id                    String  @id @default(uuid())
  orderId               String
  productId             String? // NULL if product not matched
  extractedProductText  String  // Original OCR text (e.g., "ビール大")
  quantity              Int
  unitOfMeasure         String? // case, bottle, kg
  confidence            Float   // 0.0 - 1.0
  verificationStatus    String  @default("unverified") // unverified, human_verified
  humanCorrectedProduct String? // Product ID after operator correction
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  order   Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product Product? @relation(fields: [productId], references: [id])

  @@index([orderId])
  @@index([productId])
  @@map("order_items")
}

// ======================
// Master Data Entities
// ======================

/// Customer master data (imported via CSV/JSON, scoped to tenant)
model Customer {
  id             String   @id @default(uuid())
  tenantId       String   // Implicit: stored in tenant's database
  customerCode   String   @unique // Tenant-defined unique code
  name           String
  nameVariations String?  // JSON array: ["田中商店", "田中", "Tanaka Shoten"]
  contactInfo    String?  // JSON: {phone, email, address}
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  orders          Order[]
  orderHistories  OrderHistory[]
  customerContext CustomerContext[]

  @@index([tenantId, customerCode])
  @@map("customers")
}

/// Product master data (imported via CSV/JSON, scoped to tenant)
model Product {
  id             String  @id @default(uuid())
  tenantId       String  // Implicit: stored in tenant's database
  productCode    String  @unique // Tenant-defined unique code
  productName    String
  nameVariations String? // JSON array: ["ビール大瓶", "ビール大", "beer large"]
  unitOfMeasure  String? // case, bottle, kg
  category       String? // beverage, food, etc.
  isActive       Boolean @default(true)
  // Vector embedding (768-dim F32 vector for semantic matching)
  // Note: Prisma doesn't support F32_BLOB natively, managed via raw SQL
  // embedding    Bytes?  // Stored as BLOB, converted to/from Float32Array in app layer
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  orderItems     OrderItem[]
  orderHistories OrderHistory[]

  @@index([tenantId, productCode])
  @@map("products")
}

// ======================
// Historical Data
// ======================

/// OrderHistory tracks confirmed orders for learning and "usual order" patterns
model OrderHistory {
  id          String   @id @default(uuid())
  orderId     String   @unique
  tenantId    String
  customerId  String
  orderDate   DateTime
  products    String   // JSON: [{product_id, product_name, quantity}]
  // Vector embedding of entire order (product combination)
  // embedding Bytes?   // F32_BLOB(768) in raw SQL
  confirmedAt DateTime @default(now())

  order    Order    @relation(fields: [orderId], references: [id])
  customer Customer @relation(fields: [customerId], references: [id])
  product  Product? @relation(fields: [productId], references: [id]) // For joins

  // Workaround: Prisma requires explicit foreign key field
  productId String?

  @@index([tenantId, customerId, orderDate])
  @@map("order_history")
}

/// CustomerContext stores learned patterns for ambiguous reference interpretation
model CustomerContext {
  id                  String   @id @default(uuid())
  tenantId            String
  customerId          String
  contextType         String   // 'frequent_order', 'abbreviation', 'usual_order'
  productCombination  String   // JSON: [product_id_1, product_id_2, ...]
  frequency           Int      // Times ordered in last 30 days
  abbreviations       String?  // JSON: {"ビール大": "ビール大瓶"}
  lastOrderedAt       DateTime
  // Vector embedding for semantic pattern matching
  // embedding         Bytes?   // F32_BLOB(768)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  customer Customer @relation(fields: [customerId], references: [id])

  @@index([tenantId, customerId, contextType])
  @@map("customer_context")
}

// ======================
// Review & Processing
// ======================

/// ReviewQueue tracks orders flagged for human review
model ReviewQueue {
  id               String   @id @default(uuid())
  orderId          String   @unique
  tenantId         String
  flagReason       String   // 'low_confidence', 'unknown_product', 'unknown_customer'
  assignedOperator String?  // User ID of operator (if assigned)
  reviewStatus     String   @default("pending") // pending, in_progress, completed
  reviewedAt       DateTime?
  reviewNotes      String?  // Operator notes
  createdAt        DateTime @default(now())

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([tenantId, reviewStatus])
  @@map("review_queue")
}

/// ProcessingResult stores raw AI model output for debugging/audit
model ProcessingResult {
  id                String   @id @default(uuid())
  orderId           String
  tenantId          String
  modelName         String   // e.g., "gemini-2.0-flash-exp"
  extractedFields   String   // JSON: {customer, products, quantities}
  confidenceScores  String   // JSON: per-field confidence scores
  rawResponse       String   // Full Gemini API response
  processingTime    Int      // milliseconds
  tokenUsage        String?  // JSON: {input_tokens, output_tokens}
  createdAt         DateTime @default(now())

  @@index([tenantId, orderId])
  @@map("processing_results")
}

// ======================
// Vector Index Management
// ======================

// Note: Vector indexes are managed via raw SQL migrations, not Prisma schema
// See migrations/001_add_vector_indexes.sql:
//
// CREATE INDEX idx_products_embedding
// ON products(libsql_vector_idx(embedding, 'metric=cosine'));
//
// CREATE INDEX idx_context_embedding
// ON customer_context(libsql_vector_idx(embedding, 'metric=cosine'));
//
// CREATE INDEX idx_order_history_embedding
// ON order_history(libsql_vector_idx(embedding, 'metric=cosine'));
```

---

## Entity Relationships

```
Tenant (stored in service DB)
    ↓ (1:N, implicit via separate tenant DBs)

Customer ←→ Order ←→ OrderItem → Product
    ↓           ↓
OrderHistory    ReviewQueue
    ↓
CustomerContext

ProcessingResult (audit log, many-to-one with Order)
```

---

## Field Type Mappings

| Prisma Type | SQLite Type | TypeScript Type | Use Case |
|-------------|-------------|-----------------|----------|
| `String` | `TEXT` | `string` | IDs, names, text fields |
| `Int` | `INTEGER` | `number` | Counts, file sizes |
| `Float` | `REAL` | `number` | Confidence scores (0.0-1.0) |
| `Boolean` | `INTEGER` (0/1) | `boolean` | Flags, active status |
| `DateTime` | `INTEGER` (Unix timestamp) | `Date` | Timestamps |
| `Bytes` | `BLOB` | `Buffer` / `Uint8Array` | File data, **vector embeddings** |

**Vector Embeddings Note**: Prisma's `Bytes` type maps to SQLite `BLOB`. We'll use raw SQL to cast to `F32_BLOB(768)` for libSQL vector functions.

---

## Vector Embedding Schema (Raw SQL)

Since Prisma doesn't support libSQL's native `F32_BLOB` type, vector columns are managed via raw SQL migrations:

### Migration: Add Vector Columns

```sql
-- migrations/002_add_vector_embeddings.sql

-- Add embedding column to products (768-dim F32 vector)
ALTER TABLE products ADD COLUMN embedding F32_BLOB(768);

-- Add embedding column to customer_context
ALTER TABLE customer_context ADD COLUMN embedding F32_BLOB(768);

-- Add embedding column to order_history
ALTER TABLE order_history ADD COLUMN embedding F32_BLOB(768);

-- Create DiskANN indexes for similarity search
CREATE INDEX idx_products_embedding
ON products(libsql_vector_idx(embedding, 'metric=cosine'));

CREATE INDEX idx_context_embedding
ON customer_context(libsql_vector_idx(embedding, 'metric=cosine'));

CREATE INDEX idx_order_history_embedding
ON order_history(libsql_vector_idx(embedding, 'metric=cosine'));
```

### TypeScript Type Extensions

```typescript
// src/types/vectors.ts
import { Product, CustomerContext, OrderHistory } from '@prisma/client';

// Extend Prisma types with vector embedding support
export type ProductWithEmbedding = Product & {
  embedding?: Float32Array; // 768-dimensional vector
};

export type CustomerContextWithEmbedding = CustomerContext & {
  embedding?: Float32Array;
};

export type OrderHistoryWithEmbedding = OrderHistory & {
  embedding?: Float32Array;
};

// Helper to serialize/deserialize vectors
export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer);
}

export function blobToVector(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}
```

---

## Indexes Strategy

### Primary Indexes (Auto-created by Prisma)

- All `@id` fields → `PRIMARY KEY`
- All `@unique` fields → `UNIQUE INDEX`

### Custom Indexes (Defined in Schema)

```prisma
@@index([tenantId, status])     // Order filtering by status
@@index([customerId])            // Customer lookup
@@index([tenantId, customerCode])// Customer unique constraint per tenant
@@index([tenantId, productCode]) // Product unique constraint per tenant
@@index([tenantId, customerId, contextType]) // Context pattern queries
```

### Vector Indexes (Raw SQL Only)

```sql
-- Cosine similarity search on product embeddings
CREATE INDEX idx_products_embedding
ON products(libsql_vector_idx(embedding, 'metric=cosine', 'compress_neighbors=true'));

-- Customer context pattern search
CREATE INDEX idx_context_embedding
ON customer_context(libsql_vector_idx(embedding, 'metric=cosine'));

-- Historical order similarity search
CREATE INDEX idx_order_history_embedding
ON order_history(libsql_vector_idx(embedding, 'metric=cosine'));
```

**Index Parameters:**
- `metric=cosine`: Cosine similarity (best for normalized embeddings)
- `compress_neighbors=true`: Reduces index size by 3-8x (optional, for >10K vectors)
- `max_neighbors=20`: DiskANN graph connectivity (default=32, lower=smaller index)

---

## Data Validation Rules

### Product Import (CSV/JSON)

```typescript
import { z } from 'zod';

export const ProductImportSchema = z.object({
  product_code: z.string().min(1, "Product code required"),
  product_name: z.string().min(1, "Product name required"),
  name_variations: z.string().optional(), // Comma-separated or JSON
  unit_of_measure: z.string().optional(),
  category: z.string().optional(),
});

export type ProductImport = z.infer<typeof ProductImportSchema>;
```

### Customer Import (CSV/JSON)

```typescript
export const CustomerImportSchema = z.object({
  customer_code: z.string().min(1, "Customer code required"),
  name: z.string().min(1, "Customer name required"),
  name_variations: z.string().optional(),
  contact_info: z.string().optional(), // JSON string
});

export type CustomerImport = z.infer<typeof CustomerImportSchema>;
```

### Order Processing

```typescript
export const OrderItemSchema = z.object({
  extractedProductText: z.string(),
  productId: z.string().uuid().nullable(),
  quantity: z.number().int().positive(),
  unitOfMeasure: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const ProcessOrderSchema = z.object({
  customerId: z.string().uuid().nullable(),
  overallConfidence: z.number().min(0).max(1),
  items: z.array(OrderItemSchema).min(1, "At least one item required"),
});
```

---

## State Transitions

### Order Status Flow

```
PENDING → PROCESSING → {REVIEWING, CONFIRMED, REJECTED}
                ↓              ↓
            (OCR done)   (Human review)

            If confidence >= threshold: → CONFIRMED
            If confidence < threshold:  → REVIEWING
            Operator action:            → CONFIRMED or REJECTED
```

### Review Status Flow

```
ReviewQueue.reviewStatus:
  pending → in_progress → completed
```

---

## Tenant Metadata Storage

**Service Database** (separate from tenant databases):
- Stores `Tenant` model records
- Maps `tenant_id` → `databaseUrl` for routing
- Shared across all tenants (no tenant_id filtering needed)

**Example Service DB Query**:
```typescript
// Get tenant database URL for routing
const tenant = await serviceDb.tenant.findUnique({
  where: { id: tenantId },
  select: { databaseUrl: true, confidenceThreshold: true, aiModel: true }
});

// Connect to tenant's database
const tenantDb = prismaFactory.getClient(tenant.databaseUrl);
```

---

## Migration Workflow

### 1. Generate Migration

```bash
# Generate Prisma migration (local SQLite)
npx prisma migrate dev --name add_customer_notes

# Output: prisma/migrations/20250114_add_customer_notes/migration.sql
```

### 2. Apply to Seed Database Template

```bash
# Apply to Turso seed database (new tenants inherit)
turso db shell ocr-seed-db < prisma/migrations/20250114_add_customer_notes/migration.sql
```

### 3. Apply to Existing Tenant Databases

```bash
# Run migration script for existing tenants
npm run migrate:tenants 20250114_add_customer_notes
```

**Script** (see `research.md` Section 1 for full implementation):
```typescript
// scripts/migrate-tenant-databases.ts
async function migrateTenantDatabases(migrationName: string) {
  const tenants = await serviceDb.tenant.findMany({ where: { isActive: true } });

  for (const tenant of tenants) {
    const tenantDb = createClient({ url: tenant.databaseUrl, authToken: TURSO_GROUP_TOKEN });
    await tenantDb.execute(migrationSql);
  }
}
```

---

## Sample Data

### Tenant Record (Service DB)

```json
{
  "id": "tenant_abc123",
  "name": "Acme Distributors",
  "databaseName": "ocr-tenant-abc123",
  "databaseUrl": "libsql://tenant-abc123.turso.io",
  "databaseHostname": "tenant-abc123.turso.io",
  "confidenceThreshold": 0.70,
  "aiModel": "gemini-2.0-flash-exp",
  "rateLimitTier": "premium",
  "isActive": true
}
```

### Product Record (Tenant Database)

```json
{
  "id": "prod_001",
  "tenantId": "tenant_abc123",
  "productCode": "BEER-L-001",
  "productName": "ビール大瓶",
  "nameVariations": "[\"ビール大\", \"ビール 大\", \"beer large\"]",
  "unitOfMeasure": "case",
  "category": "beverage",
  "isActive": true
}
```

### Order Record

```json
{
  "id": "order_001",
  "tenantId": "tenant_abc123",
  "customerId": "cust_456",
  "status": "CONFIRMED",
  "overallConfidence": 0.85,
  "fileKey": "tenant-abc123/order-001.pdf",
  "fileContentType": "application/pdf",
  "fileSize": 245678,
  "flaggedForReview": false,
  "items": [
    {
      "extractedProductText": "ビール大",
      "productId": "prod_001",
      "quantity": 24,
      "unitOfMeasure": "case",
      "confidence": 0.92
    }
  ]
}
```

---

## Database Size Estimates

### Per-Tenant Database

| Entity | Records | Size/Record | Total Size |
|--------|---------|-------------|------------|
| **Customers** | 1,000 | 1 KB | 1 MB |
| **Products** | 10,000 | 2 KB (768-dim vector) | 20 MB |
| **Orders** (12 months) | 10,000 | 0.5 KB | 5 MB |
| **OrderItems** | 50,000 | 0.3 KB | 15 MB |
| **OrderHistory** | 10,000 | 2 KB (with vector) | 20 MB |
| **CustomerContext** | 5,000 | 2 KB (with vector) | 10 MB |
| **Vector Indexes** | - | ~30% of vectors | 15 MB |
| **TOTAL** | - | - | **~86 MB/tenant** |

**Scaling**: 50 tenants × 86 MB = 4.3 GB total storage (well within Turso limits).

---

## Performance Considerations

### Query Optimization

1. **Always filter by indexed fields first**:
   ```sql
   -- Good
   WHERE tenantId = ? AND status = 'REVIEWING'

   -- Bad (full table scan)
   WHERE status = 'REVIEWING'
   ```

2. **Use vector indexes for similarity search**:
   ```sql
   -- Good (DiskANN index)
   SELECT * FROM vector_top_k('idx_products_embedding', vector32(?), 10)

   -- Bad (brute force O(N))
   SELECT * FROM products WHERE vector_distance_cos(embedding, vector32(?)) < 0.3
   ```

3. **Batch inserts during import**:
   ```typescript
   // Good (1 transaction, 1000 rows)
   await prisma.$transaction(
     rows.map(row => prisma.product.create({ data: row }))
   );

   // Bad (1000 transactions)
   for (const row of rows) {
     await prisma.product.create({ data: row });
   }
   ```

### Connection Pooling

```typescript
// Prisma Client pool (per-tenant caching)
const prismaFactory = new PrismaClientFactory(TURSO_GROUP_TOKEN);

// Reuse clients (LRU cache with 100-tenant capacity)
const client1 = prismaFactory.getClient(tenant1.databaseUrl); // cache miss
const client2 = prismaFactory.getClient(tenant1.databaseUrl); // cache hit
```

---

## Next Steps

1. **Create Prisma schema file** at `prisma/schema.prisma` (copy content above)
2. **Generate Prisma Client**: `npx prisma generate`
3. **Create initial migration**: `npx prisma migrate dev --name init`
4. **Apply to Turso seed DB**: `turso db shell ocr-seed-db < prisma/migrations/*/migration.sql`
5. **Add vector columns**: Apply `002_add_vector_embeddings.sql` migration
6. **Create service DB**: `turso db create ocr-service-db` (for Tenant metadata)
7. **Implement Prisma Client factory** (see `research.md` Section 1)
8. **Write database seeding script** for test data

---

## References

- [Prisma with Turso Documentation](https://www.prisma.io/docs/orm/overview/databases/turso)
- [libSQL Vector Types](https://github.com/tursodatabase/libsql/blob/main/docs/VECTOR_SEARCH.md)
- [Turso Multi-DB Schemas](https://docs.turso.tech/features/multi-db-schemas) (deprecated, using independent DBs)
- [Prisma Multi-Tenancy Patterns](https://www.prisma.io/docs/guides/deployment/multi-tenant-apps)

---

**Data model design complete. Proceed to API contracts generation.**
