# Research: Handwritten Order OCR Engine

**Branch**: `001-ocr-typescript-hono` | **Date**: 2025-10-14 | **Phase**: 0

This document contains research findings and technical decisions for implementing the OCR engine.

---

## 4. File Storage Strategy

### Overview

Users upload handwritten order forms as PDF or image files (up to 10MB each). The system must:
- Store uploaded files for review interface access
- Maintain audit trail with 12+ months retention
- Support multi-tenant isolation (50+ tenants)
- Generate secure, temporary access URLs for the review interface
- Handle approximately 1,000 orders/month per tenant

---

### Decision: Development Storage Approach

**Choice**: Local filesystem storage with tenant-prefixed directory structure

**Implementation**:
```typescript
// File: src/lib/storage/local.ts
import * as fs from 'fs/promises';
import * as path from 'path';

export class LocalFileStorage {
  private baseDir: string;

  constructor(baseDir: string = './uploads') {
    this.baseDir = baseDir;
  }

  async saveFile(
    tenantId: string,
    orderId: string,
    file: File,
    extension: string
  ): Promise<string> {
    const tenantDir = path.join(this.baseDir, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    const fileName = `${orderId}${extension}`;
    const filePath = path.join(tenantDir, fileName);

    const buffer = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));

    return filePath;
  }

  async getFile(tenantId: string, orderId: string): Promise<Buffer> {
    // Automatically detect file extension
    const tenantDir = path.join(this.baseDir, tenantId);
    const files = await fs.readdir(tenantDir);
    const file = files.find(f => f.startsWith(orderId));

    if (!file) {
      throw new Error(`File not found: ${orderId}`);
    }

    const filePath = path.join(tenantDir, file);
    return fs.readFile(filePath);
  }

  async deleteOldFiles(tenantId: string, olderThanDays: number): Promise<number> {
    const tenantDir = path.join(this.baseDir, tenantId);
    const files = await fs.readdir(tenantDir);
    const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    let deletedCount = 0;
    for (const file of files) {
      const filePath = path.join(tenantDir, file);
      const stats = await fs.stat(filePath);

      if (stats.mtimeMs < cutoffDate) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  }
}
```

**Directory Structure**:
```
uploads/
├── tenant-abc123/
│   ├── order-001.pdf
│   ├── order-002.jpg
│   └── order-003.png
├── tenant-xyz789/
│   ├── order-100.pdf
│   └── order-101.jpg
└── .gitkeep
```

**Rationale**:
- Simple implementation for local development and testing
- No external service dependencies during development
- Easy to inspect and debug uploaded files
- Tenant isolation via directory prefixes
- Can be easily replaced with production storage via adapter pattern

**Cleanup Strategy**:
```typescript
// File: src/services/cleanup.service.ts
import { LocalFileStorage } from '../lib/storage/local';
import { PrismaClient } from '@prisma/client';

export class CleanupService {
  constructor(
    private storage: LocalFileStorage,
    private prisma: PrismaClient
  ) {}

  async cleanupOldFiles(retentionDays: number = 365): Promise<void> {
    // Get all tenants
    const tenants = await this.prisma.tenant.findMany();

    for (const tenant of tenants) {
      const deletedCount = await this.storage.deleteOldFiles(
        tenant.id,
        retentionDays
      );
      console.log(`Deleted ${deletedCount} files for tenant ${tenant.id}`);
    }
  }
}

// Run as cron job or scheduled task
// Example: Daily at 2 AM
// 0 2 * * * node dist/scripts/cleanup.js
```

---

### Decision: Production Storage Service

**Choice**: Cloudflare R2 (S3-compatible object storage)

**Rationale**:

| Factor | AWS S3 | Cloudflare R2 | Winner |
|--------|--------|---------------|--------|
| **Storage Cost** | $0.023/GB/month | $0.015/GB/month | R2 (35% cheaper) |
| **Egress Cost** | $0.09/GB | $0.00/GB (FREE) | R2 (major savings) |
| **Operations** | ~$0.005/1K PUTs | $4.50/1M PUTs | R2 (comparable) |
| **API Compatibility** | Native S3 API | S3-compatible API | Both (equal) |
| **Setup Complexity** | Well-documented | Well-documented | Both (equal) |
| **Turso Integration** | No special integration | No special integration | Both (equal) |

**Key Decision Factors**:

1. **Zero Egress Costs**: The review interface will frequently serve images to operators. With R2's free egress, 50 tenants × 1,000 orders × 10MB × 12 months = 6TB of egress would cost $540/month on S3 vs $0 on R2.

2. **Cost Efficiency**: For the expected scale (500GB storage), R2 costs $7.50/month vs S3's $11.50/month for storage alone.

3. **S3 Compatibility**: R2 uses the S3 API, so the implementation is nearly identical to S3, avoiding vendor lock-in.

4. **Simplicity**: Single service handles both storage and delivery, no CDN needed for the review interface.

5. **Turso Integration**: Neither service has special Turso integration, so both are equal. Turso's BLOB column type is unsuitable for 10MB files (optimized for embeddings/small data).

---

### Implementation: Cloudflare R2 Setup

**Installation**:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Configuration**:
```typescript
// File: src/lib/storage/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2FileStorage {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.R2_BUCKET_NAME!;

    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT, // https://<account-id>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  async uploadFile(
    tenantId: string,
    orderId: string,
    file: File,
    contentType: string
  ): Promise<string> {
    const key = `${tenantId}/${orderId}${this.getExtension(contentType)}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: contentType,
      Metadata: {
        tenantId,
        orderId,
        uploadedAt: new Date().toISOString(),
      },
    });

    await this.client.send(command);
    return key;
  }

  async generatePresignedUrl(
    tenantId: string,
    orderId: string,
    expiresIn: number = 3600 // 1 hour default
  ): Promise<string> {
    // Find the file by scanning tenant prefix
    // In production, store the full key in database
    const key = await this.findFileKey(tenantId, orderId);

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  private getExtension(contentType: string): string {
    const extensions: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
    };
    return extensions[contentType] || '';
  }

  private async findFileKey(tenantId: string, orderId: string): Promise<string> {
    // Simplified - in production, query database for stored key
    // This assumes orderId contains the extension
    return `${tenantId}/${orderId}`;
  }
}
```

**Environment Variables**:
```bash
# .env
R2_BUCKET_NAME=ocr-order-forms
R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<your-access-key>
R2_SECRET_ACCESS_KEY=<your-secret-key>
```

**Database Schema Extension** (store file metadata):
```prisma
// Add to schema.prisma Order model
model Order {
  id              String   @id @default(cuid())
  tenantId        String
  customerId      String?
  status          String   // pending, reviewing, confirmed, rejected
  confidence      Float

  // File storage fields
  fileKey         String   // R2 object key: tenant-id/order-id.pdf
  fileContentType String   // application/pdf, image/jpeg, image/png
  fileSize        Int      // bytes
  uploadedAt      DateTime @default(now())

  // ... other fields
}
```

---

### Presigned URL Generation for Review Interface

**API Endpoint**:
```typescript
// File: src/api/routes/review.ts
import { Hono } from 'hono';
import { R2FileStorage } from '../../lib/storage/r2';

const app = new Hono();

app.get('/reviews/:orderId/image', async (c) => {
  const { orderId } = c.req.param();
  const tenantId = c.get('tenantId'); // From auth middleware

  // Fetch order from database
  const order = await c.get('prisma').order.findUnique({
    where: { id: orderId, tenantId },
  });

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const storage = new R2FileStorage();
  const presignedUrl = await storage.generatePresignedUrl(
    tenantId,
    order.fileKey,
    3600 // 1 hour expiry
  );

  return c.json({ url: presignedUrl, expiresIn: 3600 });
});

export default app;
```

**Frontend Usage** (review interface):
```typescript
// Example: Review interface fetches presigned URL
async function loadOrderImage(orderId: string): Promise<string> {
  const response = await fetch(`/api/v1/reviews/${orderId}/image`, {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  const { url } = await response.json();
  return url; // Use this URL in <img src={url} />
}
```

**Security Benefits**:
- Presigned URLs expire after 1 hour (configurable)
- No direct R2 credentials exposed to frontend
- Tenant isolation enforced by API middleware before URL generation
- Each URL is tied to a specific file (order form)

---

### Retention Policy Implementation

**Option 1: R2 Lifecycle Rules** (Automated)
```typescript
// Configure via R2 dashboard or API
// Lifecycle rule: Delete objects older than 365 days
{
  "lifecycle": [
    {
      "action": {
        "type": "expiration"
      },
      "daysAfterLastModification": 365,
      "filter": {
        "prefix": "" // Applies to all objects
      }
    }
  ]
}
```

**Option 2: Application-Level Cleanup** (More Control)
```typescript
// File: src/services/retention.service.ts
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

export class RetentionService {
  constructor(
    private s3Client: S3Client,
    private prisma: PrismaClient,
    private bucketName: string
  ) {}

  async enforceRetentionPolicy(retentionDays: number = 365): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Find old orders from database
    const oldOrders = await this.prisma.order.findMany({
      where: {
        uploadedAt: {
          lt: cutoffDate,
        },
      },
      select: {
        id: true,
        fileKey: true,
        tenantId: true,
      },
    });

    console.log(`Found ${oldOrders.length} orders older than ${retentionDays} days`);

    // Delete files from R2
    const deleteKeys = oldOrders.map(order => ({ Key: order.fileKey }));

    if (deleteKeys.length > 0) {
      const command = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: deleteKeys,
        },
      });

      await this.s3Client.send(command);

      // Update database to mark files as deleted (or delete records)
      await this.prisma.order.updateMany({
        where: {
          id: {
            in: oldOrders.map(o => o.id),
          },
        },
        data: {
          fileKey: null, // Mark as deleted
          status: 'archived',
        },
      });

      console.log(`Deleted ${deleteKeys.length} files from R2`);
    }
  }
}

// Run as scheduled task
// Example: Daily at 3 AM
// 0 3 * * * node dist/scripts/retention-cleanup.js
```

**Recommended Approach**: Use **Option 2 (Application-Level)** for:
- Audit logging (record what was deleted and when)
- Tenant-specific retention policies (some tenants may require longer retention)
- Graceful handling of orphaned files
- Integration with database cleanup

---

### Tenant Isolation Strategy

**Decision**: Prefix-based isolation within a single R2 bucket

**Rationale**:

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Separate bucket per tenant** | Strong isolation, per-tenant configs | 10,000 bucket limit, management overhead | Not recommended for 50+ tenants |
| **Prefix-based isolation** | Unlimited scalability, simple management | Requires careful IAM policies | Recommended |

**Implementation**:
```
R2 Bucket: ocr-order-forms

Object Key Structure:
tenant-abc123/order-001.pdf
tenant-abc123/order-002.jpg
tenant-xyz789/order-100.pdf
tenant-xyz789/order-101.png
```

**Tenant Isolation Enforcement**:
```typescript
// File: src/api/middleware/tenant.ts
import { MiddlewareHandler } from 'hono';

export const tenantIsolation: MiddlewareHandler = async (c, next) => {
  const tenantId = c.get('tenantId'); // From auth middleware

  // Store tenant context for downstream handlers
  c.set('storagePrefix', tenantId);

  await next();
};

// Usage in route handler
app.post('/ocr', tenantIsolation, async (c) => {
  const tenantId = c.get('storagePrefix');
  const fileKey = `${tenantId}/${orderId}.pdf`; // Always prefix with tenant ID
  // ... upload logic
});
```

**Security Considerations**:
1. Always validate `tenantId` from authenticated token
2. Never accept tenant ID from request body/query params
3. Use database queries with `WHERE tenantId = ?` for additional validation
4. Log all file access attempts with tenant context

---

### Cost Estimates

**Assumptions**:
- 50 tenants
- 1,000 orders/month per tenant = 50,000 orders/month total
- 10MB average file size
- 12-month retention policy
- Review interface: 50% of orders reviewed (25,000 image views/month)

**Storage Calculation**:
- Month 1: 50,000 orders × 10MB = 500GB stored
- Month 12: 50,000 orders/month × 12 months = 600,000 orders = 6,000GB stored (accounting for deletions after 12 months)
- Average storage (steady state after 12 months): ~6TB

**Cloudflare R2 Costs**:

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **Storage** (6TB) | 6,000GB × $0.015/GB | $90.00 |
| **PUT Operations** | 50,000 uploads/month × $4.50/1M | $0.23 |
| **GET Operations** (review interface) | 25,000 views/month × $0.36/1M | $0.01 |
| **Egress** | Unlimited (FREE) | $0.00 |
| **TOTAL** | | **$90.24/month** |

**AWS S3 Costs** (for comparison):

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **Storage** (6TB) | 6,000GB × $0.023/GB | $138.00 |
| **PUT Operations** | 50,000 uploads/month × $0.005/1K | $0.25 |
| **GET Operations** | 25,000 views/month × $0.0004/1K | $0.01 |
| **Egress** (review interface) | 25,000 views × 10MB = 250GB × $0.09/GB | $22.50 |
| **TOTAL** | | **$160.76/month** |

**Savings**: R2 saves **$70.52/month (44% reduction)** compared to S3.

**Scaling Projections**:

| Tenants | Orders/Month | Storage (12mo) | R2 Cost/Month | S3 Cost/Month | Savings |
|---------|--------------|----------------|---------------|---------------|---------|
| 10 | 10,000 | 1.2TB | $18.00 | $32.10 | $14.10 |
| 50 | 50,000 | 6TB | $90.24 | $160.76 | $70.52 |
| 100 | 100,000 | 12TB | $180.48 | $321.52 | $141.04 |
| 200 | 200,000 | 24TB | $360.96 | $643.04 | $282.08 |

**Break-even Analysis**:
- R2 is always cheaper than S3 for this use case
- Primary savings come from egress (free on R2)
- Even at 10 tenants, R2 saves $169/year

---

### File Upload Handling in Hono

**Implementation**:
```typescript
// File: src/api/routes/ocr.ts
import { Hono } from 'hono';
import { R2FileStorage } from '../../lib/storage/r2';

const app = new Hono();

app.post('/ocr', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file; // multipart/form-data field name

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  // Validate file type
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({
      error: 'Invalid file type. Allowed: PDF, JPEG, PNG'
    }, 400);
  }

  // Validate file size (10MB limit)
  const maxSize = 10 * 1024 * 1024; // 10MB in bytes
  if (file.size > maxSize) {
    return c.json({
      error: 'File too large. Maximum size: 10MB'
    }, 413);
  }

  const tenantId = c.get('tenantId'); // From auth middleware
  const orderId = generateOrderId(); // Your ID generation logic

  // Upload to R2
  const storage = new R2FileStorage();
  const fileKey = await storage.uploadFile(tenantId, orderId, file, file.type);

  // Save order metadata to database
  const order = await c.get('prisma').order.create({
    data: {
      id: orderId,
      tenantId,
      fileKey,
      fileContentType: file.type,
      fileSize: file.size,
      status: 'pending',
      uploadedAt: new Date(),
    },
  });

  // Trigger OCR processing (async)
  await triggerOcrProcessing(orderId);

  return c.json({
    orderId,
    status: 'processing',
    message: 'Order form uploaded successfully',
  }, 202);
});

function generateOrderId(): string {
  return `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function triggerOcrProcessing(orderId: string): Promise<void> {
  // Queue for background processing
  // Implementation depends on job queue choice (BullMQ, etc.)
}

export default app;
```

**Testing File Uploads**:
```typescript
// File: tests/integration/ocr.test.ts
import { describe, it, expect } from 'vitest';
import app from '../../src/api';
import * as fs from 'fs';

describe('POST /ocr - File Upload', () => {
  it('should accept PDF file upload', async () => {
    const pdfBuffer = fs.readFileSync('./tests/fixtures/sample-order.pdf');
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'order.pdf');

    const res = await app.request('/api/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
      },
      body: formData,
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.orderId).toBeDefined();
    expect(json.status).toBe('processing');
  });

  it('should reject files larger than 10MB', async () => {
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
    const formData = new FormData();
    formData.append('file', new Blob([largeBuffer], { type: 'application/pdf' }), 'large.pdf');

    const res = await app.request('/api/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
      },
      body: formData,
    });

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toContain('too large');
  });

  it('should reject invalid file types', async () => {
    const textBuffer = Buffer.from('This is not an image');
    const formData = new FormData();
    formData.append('file', new Blob([textBuffer], { type: 'text/plain' }), 'order.txt');

    const res = await app.request('/api/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
      },
      body: formData,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid file type');
  });
});
```

---

### Storage Adapter Pattern (Environment Switching)

**Abstraction Layer**:
```typescript
// File: src/lib/storage/interface.ts
export interface FileStorage {
  uploadFile(
    tenantId: string,
    orderId: string,
    file: File,
    contentType: string
  ): Promise<string>;

  generatePresignedUrl(
    tenantId: string,
    fileKey: string,
    expiresIn?: number
  ): Promise<string>;

  deleteFile(fileKey: string): Promise<void>;
}

// File: src/lib/storage/factory.ts
import { FileStorage } from './interface';
import { LocalFileStorage } from './local';
import { R2FileStorage } from './r2';

export function createStorage(): FileStorage {
  const env = process.env.NODE_ENV || 'development';

  if (env === 'production') {
    return new R2FileStorage();
  } else {
    return new LocalFileStorage();
  }
}

// Usage in application
import { createStorage } from './lib/storage/factory';

const storage = createStorage(); // Automatically switches based on NODE_ENV
await storage.uploadFile(tenantId, orderId, file, contentType);
```

**Benefits**:
- Seamless switching between local and production storage
- Easy to add new storage backends (Azure Blob, Google Cloud Storage)
- Consistent interface across environments
- Simplifies testing (use local storage in tests)

---

### Summary

| Decision Point | Choice | Key Reason |
|---------------|--------|------------|
| **Development Storage** | Local Filesystem | Simplicity, no external dependencies |
| **Production Storage** | Cloudflare R2 | 44% cost savings vs S3, free egress |
| **Tenant Isolation** | Prefix-based (single bucket) | Scalability (50+ tenants), simplicity |
| **Presigned URLs** | 1-hour expiry | Security, temporary review access |
| **Retention Policy** | Application-level cleanup | Audit trail, tenant-specific policies |
| **Upload Handling** | Hono `parseBody()` with validation | Native support, type-safe |
| **Cost (50 tenants, 12mo retention)** | $90/month (R2) | vs $160/month (S3) |

**Next Steps**:
1. Implement `LocalFileStorage` for development environment
2. Set up R2 bucket with prefix-based tenant isolation
3. Create storage adapter factory for environment switching
4. Add file upload validation middleware
5. Implement retention cleanup service with cron job
6. Write integration tests for file upload/download flows

---

**References**:
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [Cloudflare R2 Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [AWS Multi-tenant S3 Design Patterns](https://aws.amazon.com/blogs/storage/design-patterns-for-multi-tenant-access-control-on-amazon-s3/)
- [Hono File Upload Documentation](https://hono.dev/examples/file-upload)

---

## 6. CSV/JSON Master Import

### Overview

Tenants need to upload CSV/JSON files containing customer and product master data. The system must validate schema, safely import data into tenant-specific Turso databases, and provide clear error reporting for invalid rows.

**Requirements**:
- FR-035: Support CSV and JSON import formats
- FR-036: Support both full replacement and incremental update modes
- Handle 10K+ rows efficiently with transaction safety
- Validate data against defined schemas
- Report which rows failed and why

---

### Decision 1: CSV Parser Library

**Selected**: **PapaParse**

**Rationale**:

After evaluating Node.js CSV parsers, PapaParse emerges as the optimal choice for this use case:

**Performance**:
- Fastest overall parser (even beating String.split in benchmarks)
- Handles 1M rows with quotes in ~5.5 seconds
- 5.3s for 10 sequential queries vs 1.7s for 1000-row batch in libSQL context

**Features**:
- Works in both browser and Node.js
- Streaming API for large files (no memory bloat)
- Automatic delimiter detection
- Header row parsing with field name mapping
- Error handling with row-level detail
- RFC 4180 compliant

**TypeScript Support**:
- Official type definitions available
- Excellent TypeScript integration

**Comparison with Alternatives**:

| Feature | PapaParse | csv-parser | csv-parse |
|---------|-----------|------------|-----------|
| Speed | Fastest (5.5s/1M rows) | 90K rows/s | Similar to csv-parser |
| Streaming | Yes | Yes | Yes |
| Browser Support | Yes | No | No |
| Bundle Size | Medium | Minimal | Medium |
| Header Parsing | Built-in | Manual | Built-in |
| Error Details | Excellent | Basic | Good |

**Installation**:
```bash
npm install papaparse
npm install -D @types/papaparse
```

---

### Decision 2: Incremental vs Full Replacement Approach

**Selected**: **Incremental Update (Upsert-based) as Primary Strategy**

**Rationale**:

**When to Use Incremental Update (Recommended Default)**:
- Master data changes are partial (10-20% of records updated)
- Need to preserve records not in import file
- Want faster import times for large datasets
- Need to track modification history
- Typical use case: daily/weekly updates from external systems

**When to Use Full Replacement**:
- Complete data refresh required (e.g., new tenant onboarding)
- Source system is authoritative (delete records not in file)
- Master data is small (<1000 records)
- Simplicity preferred over performance

**Implementation Strategy**:

The system will support **both modes** via API parameter:

```typescript
// API Endpoint
POST /v1/master/import
{
  "type": "customer" | "product",
  "mode": "incremental" | "full",  // Default: "incremental"
  "file": "base64..." | "url",
  "format": "csv" | "json"
}
```

**Benefits of Incremental (Upsert)**:
1. **Data Integrity**: Preserves related records (orders still reference old customers)
2. **Performance**: Only processes changed data (10% update = 10x faster)
3. **Auditability**: Can track when records were last updated
4. **Safety**: Doesn't accidentally delete active data

**Benefits of Full Replacement**:
1. **Simplicity**: Single transaction DELETE + INSERT
2. **Data Consistency**: Import file is single source of truth
3. **Cleanup**: Removes stale/deprecated records automatically

**Change Detection Method**:
- Use **unique identifiers** (customer_code, product_code) for upsert matching
- Track `updated_at` timestamp for incremental sync tracking
- Support soft deletes with `deleted_at` column (optional)

---

### Decision 3: Schema Validation with Zod

**Selected**: **Zod for runtime schema validation**

**Rationale**:

Zod provides TypeScript-first schema validation with excellent error reporting:

**Advantages**:
- Type inference: Schema doubles as TypeScript type
- Composable: Reuse schemas for API, DB, and imports
- Rich validation: Required/optional, regex, custom refinements
- Error messages: Clear, actionable feedback per field
- Ecosystem: Works with Prisma, tRPC, React Hook Form

**Schema Definition Pattern**:

```typescript
// src/types/master-data.ts
import { z } from 'zod';

// Product Master Schema
export const ProductImportSchema = z.object({
  product_code: z.string()
    .min(1, 'Product code is required')
    .max(50, 'Product code must be 50 characters or less'),

  product_name: z.string()
    .min(1, 'Product name is required')
    .max(200, 'Product name must be 200 characters or less'),

  product_name_kana: z.string()
    .max(200, 'Kana name must be 200 characters or less')
    .optional(),

  unit_of_measure: z.string()
    .max(20, 'Unit must be 20 characters or less')
    .default('個'),

  category: z.string()
    .max(100, 'Category must be 100 characters or less')
    .optional(),

  standard_price: z.number()
    .nonnegative('Price must be non-negative')
    .optional(),

  is_active: z.boolean()
    .default(true),

  aliases: z.array(z.string())
    .optional()
    .describe('Alternative names for fuzzy matching'),
});

export type ProductImport = z.infer<typeof ProductImportSchema>;

// Customer Master Schema
export const CustomerImportSchema = z.object({
  customer_code: z.string()
    .min(1, 'Customer code is required')
    .max(50, 'Customer code must be 50 characters or less'),

  customer_name: z.string()
    .min(1, 'Customer name is required')
    .max(200, 'Customer name must be 200 characters or less'),

  customer_name_kana: z.string()
    .max(200, 'Kana name must be 200 characters or less')
    .optional(),

  phone: z.string()
    .regex(/^[\d\-+() ]*$/, 'Invalid phone number format')
    .max(20, 'Phone must be 20 characters or less')
    .optional(),

  email: z.string()
    .email('Invalid email format')
    .optional(),

  address: z.string()
    .max(500, 'Address must be 500 characters or less')
    .optional(),

  postal_code: z.string()
    .regex(/^\d{3}-?\d{4}$/, 'Invalid postal code format (e.g., 123-4567)')
    .optional(),

  is_active: z.boolean()
    .default(true),

  notes: z.string()
    .max(1000, 'Notes must be 1000 characters or less')
    .optional(),
});

export type CustomerImport = z.infer<typeof CustomerImportSchema>;

// CSV Column Mapping (flexible header names)
export const ProductCSVHeaders = z.object({
  product_code: z.union([
    z.literal('product_code'),
    z.literal('商品コード'),
    z.literal('code'),
  ]),
  product_name: z.union([
    z.literal('product_name'),
    z.literal('商品名'),
    z.literal('name'),
  ]),
  // ... other mappings
});
```

**Validation Error Handling**:

```typescript
// Parse with detailed error reporting
function validateRow<T>(
  schema: z.ZodSchema<T>,
  row: unknown,
  rowNumber: number
): { success: true; data: T } | { success: false; errors: string[] } {

  const result = schema.safeParse(row);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Extract human-readable errors
  const errors = result.error.issues.map(issue => {
    const field = issue.path.join('.');
    return `Row ${rowNumber}, field "${field}": ${issue.message}`;
  });

  return { success: false, errors };
}
```

---

### Implementation Pattern: CSV Parsing with Validation

```typescript
// src/services/import.service.ts
import Papa from 'papaparse';
import { Readable } from 'stream';
import { ProductImportSchema, CustomerImportSchema } from '../types/master-data';
import type { z } from 'zod';

interface ImportResult {
  totalRows: number;
  successRows: number;
  failedRows: number;
  errors: Array<{
    row: number;
    data: unknown;
    errors: string[];
  }>;
  warnings: string[];
}

interface ImportOptions {
  type: 'product' | 'customer';
  mode: 'incremental' | 'full';
  format: 'csv' | 'json';
  batchSize?: number; // Default: 1000
}

export class MasterDataImportService {

  /**
   * Parse and validate CSV file with streaming
   * Collects all errors without stopping on first failure
   */
  async parseCSV<T>(
    fileStream: Readable,
    schema: z.ZodSchema<T>,
    options: { header: boolean; skipEmptyLines: boolean }
  ): Promise<ImportResult> {

    const validRows: T[] = [];
    const errors: ImportResult['errors'] = [];
    const warnings: string[] = [];
    let rowNumber = 0;

    return new Promise((resolve, reject) => {
      Papa.parse(fileStream, {
        header: options.header,
        skipEmptyLines: options.skipEmptyLines,
        dynamicTyping: true, // Auto-convert numbers/booleans
        transformHeader: (header) => {
          // Normalize headers (trim, lowercase)
          return header.trim().toLowerCase().replace(/\s+/g, '_');
        },

        step: (result) => {
          rowNumber++;

          // Skip header row in count
          if (rowNumber === 1 && options.header) {
            return;
          }

          // Validate row against schema
          const validation = schema.safeParse(result.data);

          if (validation.success) {
            validRows.push(validation.data);
          } else {
            // Collect errors but continue parsing
            const rowErrors = validation.error.issues.map(issue => {
              const field = issue.path.join('.');
              return `Field "${field}": ${issue.message}`;
            });

            errors.push({
              row: rowNumber,
              data: result.data,
              errors: rowErrors,
            });
          }

          // Check for PapaParse-specific errors (malformed CSV)
          if (result.errors.length > 0) {
            result.errors.forEach(error => {
              warnings.push(
                `Row ${rowNumber}: ${error.message} (code: ${error.code})`
              );
            });
          }
        },

        complete: () => {
          resolve({
            totalRows: rowNumber - 1, // Exclude header
            successRows: validRows.length,
            failedRows: errors.length,
            errors,
            warnings,
          });
        },

        error: (error) => {
          reject(new Error(`CSV parsing failed: ${error.message}`));
        },
      });
    });
  }

  /**
   * Parse and validate JSON file
   */
  async parseJSON<T>(
    fileContent: string,
    schema: z.ZodSchema<T>
  ): Promise<ImportResult> {

    const errors: ImportResult['errors'] = [];
    const validRows: T[] = [];

    try {
      const data = JSON.parse(fileContent);

      // Support both array and object with data property
      const records = Array.isArray(data) ? data : data.data || [];

      records.forEach((record, index) => {
        const rowNumber = index + 1;
        const validation = schema.safeParse(record);

        if (validation.success) {
          validRows.push(validation.data);
        } else {
          const rowErrors = validation.error.issues.map(issue => {
            const field = issue.path.join('.');
            return `Field "${field}": ${issue.message}`;
          });

          errors.push({
            row: rowNumber,
            data: record,
            errors: rowErrors,
          });
        }
      });

      return {
        totalRows: records.length,
        successRows: validRows.length,
        failedRows: errors.length,
        errors,
        warnings: [],
      };

    } catch (error) {
      throw new Error(`JSON parsing failed: ${error.message}`);
    }
  }
}
```

---

### Implementation Pattern: Batch Upsert with Prisma

```typescript
// src/services/import.service.ts (continued)
import { PrismaClient } from '@prisma/client';

export class MasterDataImportService {

  constructor(private prisma: PrismaClient) {}

  /**
   * Import products with incremental upsert strategy
   * Processes in batches to avoid transaction timeouts
   */
  async importProducts(
    products: ProductImport[],
    tenantId: string,
    mode: 'incremental' | 'full'
  ): Promise<{ inserted: number; updated: number; deleted?: number }> {

    const BATCH_SIZE = 1000; // Optimal for Turso/libSQL
    const batches: ProductImport[][] = [];

    // Split into chunks
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      batches.push(products.slice(i, i + BATCH_SIZE));
    }

    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    // Execute within transaction
    await this.prisma.$transaction(async (tx) => {

      // FULL REPLACEMENT MODE: Delete all existing products first
      if (mode === 'full') {
        const deleteResult = await tx.product.deleteMany({
          where: { tenantId },
        });
        deleted = deleteResult.count;
      }

      // Process batches sequentially (required for transaction safety)
      for (const batch of batches) {

        if (mode === 'incremental') {
          // INCREMENTAL MODE: Upsert each batch

          // Check which products already exist
          const existingCodes = await tx.product.findMany({
            where: {
              tenantId,
              product_code: { in: batch.map(p => p.product_code) },
            },
            select: { product_code: true },
          });

          const existingCodeSet = new Set(
            existingCodes.map(p => p.product_code)
          );

          // Split batch into inserts and updates
          const toInsert = batch.filter(
            p => !existingCodeSet.has(p.product_code)
          );
          const toUpdate = batch.filter(
            p => existingCodeSet.has(p.product_code)
          );

          // Bulk insert new products
          if (toInsert.length > 0) {
            await tx.product.createMany({
              data: toInsert.map(p => ({
                tenantId,
                product_code: p.product_code,
                product_name: p.product_name,
                product_name_kana: p.product_name_kana,
                unit_of_measure: p.unit_of_measure,
                category: p.category,
                standard_price: p.standard_price,
                is_active: p.is_active,
                aliases: p.aliases || [],
                updated_at: new Date(),
              })),
              skipDuplicates: true, // Safety net
            });
            inserted += toInsert.length;
          }

          // Bulk update existing products
          // Note: Prisma doesn't support updateMany with different values
          // So we use individual updates (still faster than sequential)
          if (toUpdate.length > 0) {
            await Promise.all(
              toUpdate.map(p =>
                tx.product.update({
                  where: {
                    tenantId_product_code: {
                      tenantId,
                      product_code: p.product_code,
                    },
                  },
                  data: {
                    product_name: p.product_name,
                    product_name_kana: p.product_name_kana,
                    unit_of_measure: p.unit_of_measure,
                    category: p.category,
                    standard_price: p.standard_price,
                    is_active: p.is_active,
                    aliases: p.aliases || [],
                    updated_at: new Date(),
                  },
                })
              )
            );
            updated += toUpdate.length;
          }

        } else {
          // FULL REPLACEMENT MODE: Just insert (already deleted)
          await tx.product.createMany({
            data: batch.map(p => ({
              tenantId,
              product_code: p.product_code,
              product_name: p.product_name,
              product_name_kana: p.product_name_kana,
              unit_of_measure: p.unit_of_measure,
              category: p.category,
              standard_price: p.standard_price,
              is_active: p.is_active,
              aliases: p.aliases || [],
              updated_at: new Date(),
            })),
          });
          inserted += batch.length;
        }
      }

    }, {
      timeout: 60000, // 60 second timeout for large imports
      maxWait: 5000,  // Max 5s to acquire transaction lock
    });

    return { inserted, updated, deleted };
  }

  /**
   * Import customers (similar pattern to products)
   */
  async importCustomers(
    customers: CustomerImport[],
    tenantId: string,
    mode: 'incremental' | 'full'
  ): Promise<{ inserted: number; updated: number; deleted?: number }> {
    // Similar implementation to importProducts
    // ... (omitted for brevity)
  }
}
```

---

### Implementation Pattern: Transaction Handling for Large Imports

**Key Principles**:

1. **Batch Size Optimization**:
   - **1000 rows per batch**: Optimal for Turso/libSQL based on benchmarks
   - Balance between speed and transaction safety
   - Avoid connection pool exhaustion

2. **Transaction Strategy**:
   - Wrap entire import in single transaction for atomicity
   - If any batch fails, entire import rolls back
   - Use timeout configuration (60s for 10K+ rows)

3. **Error Recovery**:
   - Transaction rollback ensures no partial data
   - Return detailed error report to operator
   - Allow retry with corrected data

4. **Performance Optimization**:
   - Use `createMany()` for bulk inserts (single SQL statement)
   - Use `findMany()` to check existence in batch (not row-by-row)
   - Avoid N+1 queries with Set-based lookups

**Batch Processing Performance**:

| Import Size | Batch Size | Batches | Estimated Time |
|-------------|------------|---------|----------------|
| 1,000 rows  | 1000       | 1       | ~0.5s          |
| 10,000 rows | 1000       | 10      | ~5s            |
| 50,000 rows | 1000       | 50      | ~25s           |

**Transaction Safety**:

```typescript
// Transaction configuration
await prisma.$transaction(
  async (tx) => {
    // All operations here
  },
  {
    timeout: 60000,      // 60s total transaction timeout
    maxWait: 5000,       // 5s max wait to acquire lock
    isolationLevel: 'Serializable', // Strongest consistency
  }
);
```

---

### Error Handling Pattern: Partial Failure Reporting

**Goal**: Provide actionable feedback when some rows fail validation

**Implementation**:

```typescript
// src/api/routes/master.ts
import { Hono } from 'hono';
import { MasterDataImportService } from '../../services/import.service';

const master = new Hono();

master.post('/import', async (c) => {
  const { type, mode, format, file } = await c.req.json();
  const tenantId = c.get('tenantId'); // From auth middleware

  const importService = new MasterDataImportService(prisma);

  try {
    // Step 1: Parse and validate
    const parseResult = format === 'csv'
      ? await importService.parseCSV(fileStream, schema, { header: true, skipEmptyLines: true })
      : await importService.parseJSON(file, schema);

    // Step 2: Report validation errors (if any)
    if (parseResult.failedRows > 0) {
      return c.json({
        success: false,
        message: 'Validation failed for some rows',
        summary: {
          totalRows: parseResult.totalRows,
          successRows: parseResult.successRows,
          failedRows: parseResult.failedRows,
        },
        errors: parseResult.errors.map(err => ({
          row: err.row,
          data: err.data,
          errors: err.errors,
        })),
        warnings: parseResult.warnings,
      }, 400);
    }

    // Step 3: Import valid rows
    const importResult = type === 'product'
      ? await importService.importProducts(validRows, tenantId, mode)
      : await importService.importCustomers(validRows, tenantId, mode);

    // Step 4: Return success response
    return c.json({
      success: true,
      message: 'Import completed successfully',
      summary: {
        totalRows: parseResult.totalRows,
        inserted: importResult.inserted,
        updated: importResult.updated,
        deleted: importResult.deleted,
      },
    }, 200);

  } catch (error) {
    // Step 5: Handle critical errors (transaction rollback)
    return c.json({
      success: false,
      message: 'Import failed',
      error: error.message,
      hint: 'Transaction was rolled back. No data was imported.',
    }, 500);
  }
});

export default master;
```

**Error Response Format**:

```json
{
  "success": false,
  "message": "Validation failed for some rows",
  "summary": {
    "totalRows": 1000,
    "successRows": 987,
    "failedRows": 13
  },
  "errors": [
    {
      "row": 45,
      "data": {
        "product_code": "",
        "product_name": "ビール大瓶"
      },
      "errors": [
        "Field \"product_code\": Product code is required"
      ]
    },
    {
      "row": 127,
      "data": {
        "product_code": "BEER-001",
        "product_name": "",
        "standard_price": -500
      },
      "errors": [
        "Field \"product_name\": Product name is required",
        "Field \"standard_price\": Price must be non-negative"
      ]
    }
  ],
  "warnings": [
    "Row 89: Too many fields detected (code: TooManyFields)"
  ]
}
```

**Benefits**:
- Operator sees exactly which rows failed
- Original data preserved for correction
- Clear error messages per field
- Can fix errors and re-upload

---

### Performance Optimization: Streaming Large Files

**Challenge**: Importing 50K+ row CSV files without memory exhaustion

**Solution**: Stream processing with PapaParse

```typescript
import { Readable } from 'stream';
import Papa from 'papaparse';

/**
 * Stream large CSV files without loading entire file into memory
 * Validates and processes rows incrementally
 */
async function streamImportCSV(
  fileStream: Readable,
  schema: z.ZodSchema,
  onBatch: (validRows: any[]) => Promise<void>,
  batchSize: number = 1000
): Promise<ImportResult> {

  let currentBatch: any[] = [];
  let rowNumber = 0;
  const errors: ImportResult['errors'] = [];

  return new Promise((resolve, reject) => {
    Papa.parse(fileStream, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,

      step: async (result, parser) => {
        rowNumber++;

        // Validate row
        const validation = schema.safeParse(result.data);

        if (validation.success) {
          currentBatch.push(validation.data);

          // Flush batch when size reached
          if (currentBatch.length >= batchSize) {
            parser.pause(); // Pause parsing during DB write

            try {
              await onBatch(currentBatch);
              currentBatch = []; // Clear batch
            } catch (error) {
              parser.abort(); // Stop parsing on DB error
              reject(error);
              return;
            }

            parser.resume(); // Resume parsing
          }
        } else {
          // Collect error
          errors.push({
            row: rowNumber,
            data: result.data,
            errors: validation.error.issues.map(i => i.message),
          });
        }
      },

      complete: async () => {
        // Flush remaining rows
        if (currentBatch.length > 0) {
          await onBatch(currentBatch);
        }

        resolve({
          totalRows: rowNumber,
          successRows: rowNumber - errors.length,
          failedRows: errors.length,
          errors,
          warnings: [],
        });
      },

      error: reject,
    });
  });
}

// Usage
await streamImportCSV(
  fileStream,
  ProductImportSchema,
  async (batch) => {
    // Process batch (1000 rows at a time)
    await importService.importProducts(batch, tenantId, 'incremental');
  }
);
```

**Memory Usage**:

| Approach | 10K Rows | 50K Rows | 100K Rows |
|----------|----------|----------|-----------|
| Load All | ~50MB    | ~250MB   | ~500MB    |
| Streaming | ~5MB     | ~5MB     | ~5MB      |

---

### Summary of Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **CSV Parser** | PapaParse | Fastest, streaming support, excellent error handling, TypeScript support |
| **Schema Validation** | Zod | TypeScript-first, composable, clear error messages, type inference |
| **Import Strategy** | Incremental (default) + Full (option) | Balance data integrity and performance, support both use cases |
| **Batch Size** | 1000 rows | Optimal for Turso/libSQL based on benchmarks, balances speed and transaction safety |
| **Transaction Approach** | Single transaction per import | Atomicity guaranteed, rollback on any failure, no partial data |
| **Error Handling** | Collect all errors, report with row numbers | Operator gets complete picture, can fix all issues at once |
| **Streaming** | Yes (for 10K+ rows) | Prevents memory exhaustion, maintains low latency |

---

### Implementation Checklist

- [ ] Install dependencies: `papaparse`, `zod`, `@types/papaparse`
- [ ] Define Zod schemas for Product and Customer imports
- [ ] Implement `MasterDataImportService` with CSV/JSON parsing
- [ ] Implement batch upsert logic with Prisma transactions
- [ ] Add API endpoint `/v1/master/import` with multipart/form-data support
- [ ] Implement streaming for large files (10K+ rows)
- [ ] Add comprehensive error reporting with row-level details
- [ ] Write unit tests for validation logic
- [ ] Write integration tests for import scenarios (incremental, full, error handling)
- [ ] Add monitoring/logging for import operations (duration, row counts, errors)
- [ ] Document CSV column mapping flexibility (Japanese and English headers)
- [ ] Create sample CSV/JSON files for testing

---

### References

- PapaParse Documentation: https://www.papaparse.com/
- Zod Documentation: https://zod.dev/
- Prisma Transactions: https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Turso Batches in SQLite: https://turso.tech/blog/batches-in-sqlite-838e0961
- ETL Best Practices: Incremental vs Full Load Strategies

---

**Next Phase**: Proceed to Phase 1 (Design & Contracts) to define Prisma schema for master data entities.

---

## 5. Hono Authentication Patterns

### Overview

This section provides comprehensive analysis and implementation patterns for authentication and multi-tenancy in the Hono-based OCR API. The system requires secure tenant isolation with each API request authenticated and routed to the correct tenant's Turso database.

**Key Decision**: Use **JWT tokens** (not API keys) for tenant authentication.

**Rationale**:
- **Stateless operation**: Self-contained tokens eliminate database lookups on every request
- **Tenant metadata in claims**: Embed tenant ID, permissions, rate limit tier in JWT payload
- **Scalability**: Supports 10-50 tenants initially, scales to thousands without session storage
- **Security**: Asymmetric RS256 signing enables verification without sharing secrets
- **Standards compliance**: Industry-standard OAuth2/OIDC integration path for future B2B features

---

### 5.1 Turso Multi-DB Schemas Setup

#### Architecture Overview

Turso's Multi-DB Schemas architecture provides complete tenant data isolation:

```
Parent Schema DB (schema-definition-only)
├── Schema: customers, products, orders, order_items, order_history
├── Migrations: Applied once, propagate to all children
└── No data stored

Tenant Child DBs (data-isolated per tenant)
├── tenant-abc123.turso.io → Customer A's data
├── tenant-def456.turso.io → Customer B's data
└── tenant-ghi789.turso.io → Customer C's data
```

**Key Benefits for Multi-Tenancy**:
- **Auto-propagating schemas**: Update parent schema, changes cascade to all 500-10,000 child DBs
- **Zero-downtime migrations**: Each child DB migrates independently
- **Complete isolation**: No cross-tenant queries possible (security by architecture)
- **Cost efficiency**: Turso charges based on total row reads, not DB count

#### Prisma Integration with Multi-DB Schemas

**Challenge**: Prisma Client is not optimized for dynamic database switching. Each Prisma Client instance holds connection pools and schema metadata (~5-10MB per instance).

**Solution**: Maintain a tenant-scoped Prisma Client cache with LRU eviction:

```typescript
// src/lib/turso.ts
import { PrismaClient } from '@prisma/client'
import { LRUCache } from 'lru-cache'

interface TenantDBConfig {
  tenantId: string
  databaseUrl: string
}

// Cache up to 100 active tenant connections, evict after 5 minutes idle
const prismaClientCache = new LRUCache<string, PrismaClient>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
  dispose: (client: PrismaClient) => {
    client.$disconnect().catch(console.error)
  },
})

export function getTenantPrismaClient(tenantId: string, databaseUrl: string): PrismaClient {
  const cached = prismaClientCache.get(tenantId)
  if (cached) {
    return cached
  }

  const client = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

  prismaClientCache.set(tenantId, client)
  return client
}

// For cleanup on graceful shutdown
export async function disconnectAllTenants() {
  const clients = Array.from(prismaClientCache.values())
  await Promise.all(clients.map((client) => client.$disconnect()))
  prismaClientCache.clear()
}
```

**Memory Considerations**:
- 100 cached connections = ~500-1000MB RAM (acceptable for modern servers)
- LRU eviction ensures inactive tenants release resources
- Graceful shutdown handler prevents connection leaks

---

### 5.2 Authentication Decision: JWT Tokens

#### API Key vs JWT Comparison

| **Criteria**                  | **API Keys**                         | **JWT Tokens**                             | **Winner** |
|-------------------------------|--------------------------------------|--------------------------------------------|------------|
| **Stateless**                 | No (requires DB lookup)              | Yes (self-contained)                       | JWT        |
| **Tenant Metadata**           | External storage required            | Embedded in claims                         | JWT        |
| **Revocation**                | Instant (delete from DB)             | Delayed (wait for expiration)              | API Key    |
| **Scalability**               | DB bottleneck at scale               | No DB lookups                              | JWT        |
| **Security**                  | Simple, less attack surface          | Complex, but industry-standard             | Tie        |
| **Multi-Tenant Isolation**    | Requires middleware logic            | Tenant ID in `tenant_id` claim             | JWT        |
| **Rate Limiting**             | Requires DB lookup for tier          | Tier embedded in `rate_limit_tier` claim   | JWT        |
| **Ease of Implementation**    | Very simple                          | Moderate complexity                        | API Key    |
| **B2B Integration**           | Partner-friendly (Stripe-style)      | OAuth2/OIDC standard                       | JWT        |

**Final Decision**: **JWT Tokens**

**Trade-off Mitigation**:
- **Revocation problem**: Implement short token lifetimes (15 minutes) + refresh tokens
- **Token size**: Keep claims minimal (tenant_id, permissions, rate_limit_tier only)

---

### 5.3 JWT Token Structure

#### Claims Schema

```json
{
  "iss": "ocr-api.example.com",
  "sub": "tenant-abc123",
  "aud": "ocr-api",
  "exp": 1728900000,
  "iat": 1728899100,
  "nbf": 1728899100,
  "jti": "unique-token-id-12345",
  "tenant_id": "abc123",
  "tenant_name": "Acme Corp",
  "permissions": ["ocr:process", "ocr:review", "master:import"],
  "rate_limit_tier": "standard"
}
```

---

### 5.4 JWT Authentication Middleware

```typescript
// src/api/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!

export const jwtAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Missing or invalid Authorization header',
    })
  }

  const token = authHeader.substring(7)
  const payload = await verify(token, JWT_PUBLIC_KEY, 'RS256')
  
  c.set('jwtPayload', payload)
  c.set('tenantId', payload.tenant_id)
  
  await next()
})
```

---

### 5.5 Tenant Database Routing Middleware

```typescript
// src/api/middleware/tenant.ts
import { getTenantPrismaClient } from '../../lib/turso'

export const tenantRouter = createMiddleware(async (c, next) => {
  const tenantId = c.get('tenantId')
  
  const metadata = await fetchTenantMetadata(tenantId)
  const db = getTenantPrismaClient(tenantId, metadata.databaseUrl)
  
  c.set('db', db)
  await next()
})
```

---

### 5.6 Rate Limiting Middleware

```typescript
// src/api/middleware/rateLimit.ts
import { rateLimiter } from 'hono-rate-limiter'

const RATE_LIMIT_TIERS = {
  free: 10,
  standard: 100,
  premium: 1000,
}

export const tenantRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  keyGenerator: (c) => c.get('tenantId'), // Rate limit by tenant, not IP
})
```

---

### 5.7 Implementation Checklist

**Phase 1: Core Authentication**
- [ ] Generate RSA key pair (RS256)
- [ ] Implement JWT signing service
- [ ] Implement JWT verification middleware
- [ ] Create refresh token database schema

**Phase 2: Multi-Tenancy**
- [ ] Set up Turso Multi-DB Schemas
- [ ] Implement tenant provisioning service
- [ ] Build Prisma Client cache with LRU eviction
- [ ] Test cross-tenant data isolation

**Phase 3: Rate Limiting**
- [ ] Install hono-rate-limiter package
- [ ] Implement per-tenant rate limiting
- [ ] Set up Redis for distributed rate limiting

---

**Next Phase**: Proceed to Phase 1 (Design & Contracts) to define Prisma schema and API contracts.
