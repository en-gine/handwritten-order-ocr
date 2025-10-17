// src/api/routes/master.ts
import { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { importMasterData } from '../../services/import.service.js';
import type { MasterDataType, ImportMode } from '../../types/master-data.js';

/**
 * Master data import routes for customer and product data.
 *
 * **Purpose**:
 * Handles bulk import of customer and product master data from CSV/JSON files.
 * Supports incremental updates and full replacement modes.
 *
 * **Endpoints**:
 * - POST /v1/master/import - Import customer or product data
 *
 * **Authentication**: Required (JWT token with 'master:import' permission)
 * **Rate Limiting**: Applied based on tenant tier
 *
 * **POST /v1/master/import** (Import master data):
 * Request (multipart/form-data):
 * ```
 * file: <binary> (CSV or JSON file)
 * type: "customer" | "product"
 * mode: "incremental" | "full"
 * ```
 *
 * **CSV Format - Customer**:
 * ```csv
 * customerCode,name,nameVariations,address,phone,email
 * ACME001,Acme Corporation,"[""Acme Corp"",""ACME""]",123 Main St,555-0100,info@acme.com
 * ```
 *
 * **CSV Format - Product**:
 * ```csv
 * productCode,name,category,unitPrice,unit
 * PROD-001,Widget A,Widgets,1000,piece
 * ```
 *
 * **JSON Format - Customer**:
 * ```json
 * [
 *   {
 *     "customerCode": "ACME001",
 *     "name": "Acme Corporation",
 *     "nameVariations": ["Acme Corp", "ACME"],
 *     "address": "123 Main St",
 *     "phone": "555-0100",
 *     "email": "info@acme.com"
 *   }
 * ]
 * ```
 *
 * **Import Modes**:
 * - **incremental**: Check existing records → split into inserts/updates → bulk operations
 *   - Updates existing records (matched by code)
 *   - Inserts new records
 *   - Preserves records not in import file
 * - **full**: Delete all existing records → bulk insert new records (within transaction)
 *   - WARNING: Removes all existing data before import
 *   - Use with caution (requires confirmation flag)
 *
 * **Response**:
 * ```json
 * {
 *   "type": "customer",
 *   "mode": "incremental",
 *   "processed": 1000,
 *   "inserted": 150,
 *   "updated": 850,
 *   "deleted": 0,
 *   "errors": 0,
 *   "duration": 3.2,
 *   "startedAt": "2025-10-15T15:30:45.123Z",
 *   "completedAt": "2025-10-15T15:30:48.323Z"
 * }
 * ```
 *
 * **Validation**:
 * - File size: Max 50MB
 * - Row limit: Max 100,000 rows per import
 * - Required fields validated with Zod schemas
 * - Duplicate codes rejected
 * - Invalid data logged with line numbers
 *
 * **Processing Flow**:
 * 1. Parse CSV/JSON (PapaParse for CSV)
 * 2. Validate schema with Zod
 * 3. Check for duplicates within file
 * 4. Process in batches (1000 rows per batch)
 * 5. Generate vector embeddings for products (Phase 7)
 * 6. Execute database operations
 * 7. Return summary statistics
 *
 * **Status Codes**:
 * - 200 OK: Import successful
 * - 400 Bad Request: Invalid file format or data
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 403 Forbidden: Missing 'master:import' permission
 * - 413 Payload Too Large: File exceeds 50MB
 * - 429 Too Many Requests: Rate limit exceeded
 * - 500 Internal Server Error: Import failed
 *
 * @module routes/master
 */

// Type for Hono context with tenant-injected Prisma client
type Env = {
  Variables: {
    prisma: PrismaClient;
    tenantId: string;
    jwtPayload: {
      sub?: string;
      email?: string;
      permissions?: string[];
    };
  };
};

const master = new Hono<Env>();

/**
 * POST /v1/master/import - Import customer or product data
 *
 * Required middleware:
 * - jwtAuth: Verify JWT token
 * - tenantRouter: Load tenant database client
 *
 * Accepts multipart/form-data with:
 * - file: CSV or JSON file
 * - type: "customer" | "product"
 * - mode: "incremental" | "full"
 */
master.post('/import', async (c) => {
  try {
    const prisma = c.get('prisma');
    const tenantId = c.get('tenantId');

    // Parse multipart/form-data
    const body = await c.req.parseBody();

    // Validate required fields
    if (!body.file || !body.type || !body.mode) {
      return c.json(
        {
          error: 'Missing required fields',
          required: ['file', 'type', 'mode'],
        },
        400
      );
    }

    // Validate file is actually a File object
    if (!(body.file instanceof File)) {
      return c.json(
        {
          error: 'Invalid file upload',
          message: 'File must be uploaded as multipart/form-data',
        },
        400
      );
    }

    // Validate type parameter
    const type = body.type as string;
    if (type !== 'customer' && type !== 'product') {
      return c.json(
        {
          error: 'Invalid type parameter',
          message: 'Type must be either "customer" or "product"',
          received: type,
        },
        400
      );
    }

    // Validate mode parameter
    const mode = body.mode as string;
    if (mode !== 'incremental' && mode !== 'full') {
      return c.json(
        {
          error: 'Invalid mode parameter',
          message: 'Mode must be either "incremental" or "full"',
          received: mode,
        },
        400
      );
    }

    // Validate file size (50MB limit)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (body.file.size > MAX_FILE_SIZE) {
      return c.json(
        {
          error: 'File too large',
          message: `File size must be less than 50MB`,
          size: body.file.size,
          maxSize: MAX_FILE_SIZE,
        },
        413
      );
    }

    // Validate file type (CSV or JSON)
    const fileExtension = body.file.name.split('.').pop()?.toLowerCase();
    if (fileExtension !== 'csv' && fileExtension !== 'json') {
      return c.json(
        {
          error: 'Invalid file type',
          message: 'File must be CSV (.csv) or JSON (.json)',
          received: fileExtension,
        },
        400
      );
    }

    // Full replacement mode requires confirmation flag for safety
    if (mode === 'full' && body.confirm !== 'true') {
      return c.json(
        {
          error: 'Full replacement mode requires confirmation',
          message:
            'Full replacement will delete all existing data. Add confirm=true to proceed.',
          hint: 'This is a safety check to prevent accidental data loss',
        },
        400
      );
    }

    // Read file content
    const fileContent = await body.file.text();

    // Call import service
    const result = await importMasterData({
      prisma,
      tenantId,
      type: type as MasterDataType,
      mode: mode as ImportMode,
      fileContent,
      fileName: body.file.name,
    });

    // Return success response
    return c.json(
      {
        success: true,
        type: result.type,
        mode: result.mode,
        totalRows: result.totalRows,
        inserted: result.inserted,
        updated: result.updated,
        deleted: result.deleted,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 10), // Return first 10 errors
        durationMs: result.durationMs,
        message:
          result.errors.length === 0
            ? `Successfully imported ${result.totalRows} ${result.type} records`
            : `Imported with ${result.errors.length} errors (showing first 10)`,
      },
      result.errors.length === 0 ? 200 : 207 // 207 Multi-Status for partial success
    );
  } catch (error) {
    console.error('Master data import error:', error);

    return c.json(
      {
        error: 'Import failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
})

export default master
