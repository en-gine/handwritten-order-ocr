// src/api/routes/tenants.ts
import { Hono } from 'hono'
import { adminAuth } from '../middleware/auth.js'
import { getServicePrismaClient } from '../../lib/turso.js'
import {
  createTenant,
  getTenant,
  updateTenant,
  deactivateTenant,
  type CreateTenantRequest,
} from '../../services/tenant.service.js'

/**
 * Tenant provisioning routes for multi-tenant management.
 *
 * **Purpose**:
 * Handles tenant database creation, API key generation, and tenant metadata
 * management in the service database. Admin-only endpoints for provisioning
 * new tenants in the multi-tenant OCR system.
 *
 * **Endpoints**:
 * - POST /v1/tenants - Create new tenant
 * - GET /v1/tenants/:tenantId - Get tenant details
 * - PATCH /v1/tenants/:tenantId - Update tenant settings
 * - DELETE /v1/tenants/:tenantId - Deactivate tenant
 *
 * **Authentication**: Required (Admin JWT token with 'tenant:manage' permission)
 * **Rate Limiting**: Applied globally (admin operations)
 *
 * **POST /v1/tenants** (Create new tenant):
 * Request:
 * ```json
 * {
 *   "name": "Acme Corporation",
 *   "tier": "free" | "standard" | "premium",
 *   "email": "admin@acme.com",
 *   "settings": {
 *     "maxUploadsPerMonth": 1000,
 *     "storageQuotaMB": 5000
 *   }
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "tenantId": "tenant_abc123",
 *   "name": "Acme Corporation",
 *   "apiKey": "sk_live_xxxxxxxxxxx",
 *   "databaseName": "ocr-tenant-abc123",
 *   "databaseUrl": "libsql://ocr-tenant-abc123-org.aws-ap-northeast-1.turso.io",
 *   "tier": "free",
 *   "createdAt": "2025-10-15T15:30:45.123Z",
 *   "isActive": true
 * }
 * ```
 *
 * **GET /v1/tenants/:tenantId** (Get tenant details):
 * Response:
 * ```json
 * {
 *   "tenantId": "tenant_abc123",
 *   "name": "Acme Corporation",
 *   "tier": "free",
 *   "databaseName": "ocr-tenant-abc123",
 *   "isActive": true,
 *   "createdAt": "2025-10-15T15:30:45.123Z",
 *   "updatedAt": "2025-10-15T16:00:00.000Z",
 *   "usage": {
 *     "uploadsThisMonth": 234,
 *     "storageUsedMB": 1200
 *   }
 * }
 * ```
 *
 * **PATCH /v1/tenants/:tenantId** (Update tenant settings):
 * Request:
 * ```json
 * {
 *   "tier": "standard",
 *   "settings": {
 *     "maxUploadsPerMonth": 5000,
 *     "storageQuotaMB": 20000
 *   }
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "tenantId": "tenant_abc123",
 *   "tier": "standard",
 *   "updatedAt": "2025-10-15T16:30:00.000Z"
 * }
 * ```
 *
 * **DELETE /v1/tenants/:tenantId** (Deactivate tenant):
 * Response:
 * ```json
 * {
 *   "tenantId": "tenant_abc123",
 *   "isActive": false,
 *   "deactivatedAt": "2025-10-15T17:00:00.000Z"
 * }
 * ```
 *
 * **Tenant Provisioning Flow**:
 * 1. Validate request (name, tier, email)
 * 2. Generate unique tenant ID and API key
 * 3. Create Turso database from seed database
 * 4. Insert tenant metadata into service database
 * 5. Return tenant details with API credentials
 *
 * **Multi-Tenant Architecture**:
 * - **Service Database** (ocr-service-db): Stores tenant metadata
 * - **Seed Database** (ocr-seed-db): Template schema for new tenants
 * - **Tenant Databases** (ocr-tenant-*): Individual tenant data (isolated)
 *
 * **Tier Limits**:
 * - **free**: 1,000 uploads/month, 5GB storage
 * - **standard**: 10,000 uploads/month, 50GB storage
 * - **premium**: Unlimited uploads, 500GB storage
 *
 * **Status Codes**:
 * - 201 Created: Tenant created successfully (POST)
 * - 200 OK: Success (GET, PATCH, DELETE)
 * - 400 Bad Request: Invalid request format
 * - 401 Unauthorized: Missing or invalid admin JWT token
 * - 403 Forbidden: Missing 'tenant:manage' permission
 * - 404 Not Found: Tenant not found
 * - 409 Conflict: Tenant name or email already exists
 * - 429 Too Many Requests: Rate limit exceeded
 * - 500 Internal Server Error: Provisioning failed
 *
 * @module routes/tenants
 */

const tenants = new Hono()

/**
 * POST /v1/tenants - Create new tenant
 *
 * Provisions a new tenant with:
 * - Unique tenant ID
 * - Turso database (seeded from ocr-seed-db)
 * - Database authentication token
 * - JWT API key for tenant access
 * - Service database registration
 *
 * Requires: Admin JWT token with 'admin' permission
 */
tenants.post('/', adminAuth, async (c) => {
  try {
    // Parse request body
    const body = await c.req.json<CreateTenantRequest>();

    // Validate required fields
    if (!body.name || !body.email) {
      return c.json(
        {
          error: {
            message: 'Missing required fields: name, email',
            status: 400,
          },
        },
        400
      );
    }

    // Get service database client
    const serviceDb = getServicePrismaClient();

    // Create tenant (T089-T093)
    const tenant = await createTenant(serviceDb, body);

    // Return tenant credentials
    return c.json(
      {
        tenantId: tenant.tenantId,
        name: tenant.name,
        apiKey: tenant.apiKey,
        databaseName: tenant.databaseName,
        databaseUrl: tenant.databaseUrl,
        databaseToken: tenant.databaseToken,
        tier: tenant.tier,
        createdAt: tenant.createdAt,
        isActive: tenant.isActive,
      },
      201
    );
  } catch (error) {
    console.error('[Tenants] Create failed:', error);
    return c.json(
      {
        error: {
          message: 'Tenant creation failed',
          details: error instanceof Error ? error.message : 'Unknown error',
          status: 500,
        },
      },
      500
    );
  }
})

/**
 * GET /v1/tenants/:tenantId - Get tenant details
 *
 * Requires: Admin JWT token with 'admin' permission
 */
tenants.get('/:tenantId', adminAuth, async (c) => {
  try {
    const tenantId = c.req.param('tenantId');
    const serviceDb = getServicePrismaClient();

    const tenant = await getTenant(serviceDb, tenantId);

    return c.json(tenant, 200);
  } catch (error) {
    console.error('[Tenants] Get failed:', error);
    return c.json(
      {
        error: {
          message: 'Tenant not found',
          details: error instanceof Error ? error.message : 'Unknown error',
          status: 404,
        },
      },
      404
    );
  }
})

/**
 * PATCH /v1/tenants/:tenantId - Update tenant settings
 *
 * Requires: Admin JWT token with 'admin' permission
 */
tenants.patch('/:tenantId', adminAuth, async (c) => {
  try {
    const tenantId = c.req.param('tenantId');
    const body = await c.req.json();
    const serviceDb = getServicePrismaClient();

    const tenant = await updateTenant(serviceDb, tenantId, body);

    return c.json(tenant, 200);
  } catch (error) {
    console.error('[Tenants] Update failed:', error);
    return c.json(
      {
        error: {
          message: 'Tenant update failed',
          details: error instanceof Error ? error.message : 'Unknown error',
          status: 500,
        },
      },
      500
    );
  }
})

/**
 * DELETE /v1/tenants/:tenantId - Deactivate tenant
 *
 * Soft delete - sets isActive to false, preserves data.
 * Requires: Admin JWT token with 'admin' permission
 */
tenants.delete('/:tenantId', adminAuth, async (c) => {
  try {
    const tenantId = c.req.param('tenantId');
    const serviceDb = getServicePrismaClient();

    const tenant = await deactivateTenant(serviceDb, tenantId);

    return c.json(
      {
        tenantId: tenant.id,
        isActive: tenant.isActive,
        deactivatedAt: tenant.updatedAt,
      },
      200
    );
  } catch (error) {
    console.error('[Tenants] Deactivate failed:', error);
    return c.json(
      {
        error: {
          message: 'Tenant deactivation failed',
          details: error instanceof Error ? error.message : 'Unknown error',
          status: 500,
        },
      },
      500
    );
  }
})

export default tenants
