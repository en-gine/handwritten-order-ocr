// src/services/tenant.service.ts
/**
 * Tenant Provisioning Service
 *
 * Handles tenant database creation, JWT token generation, and service database registration.
 * Core logic for multi-tenant onboarding.
 *
 * **Provisioning Flow**:
 * 1. Validate tenant request (name, tier, email)
 * 2. Generate unique tenant ID
 * 3. Create Turso database from seed template (--from-db ocr-seed-db)
 * 4. Create database authentication token
 * 5. Generate JWT token for tenant API access
 * 6. Register tenant metadata in service database
 * 7. Return tenant credentials
 *
 * @module services/tenant
 */

import type { PrismaClient } from '@prisma/client';
import { createTursoApiClient } from '../lib/turso-api.js';
import { generateTenantToken } from '../lib/jwt.js';
import { nanoid } from 'nanoid';

/**
 * Tenant creation request
 */
export interface CreateTenantRequest {
  name: string;
  tier?: 'free' | 'standard' | 'premium';
  email: string;
  settings?: {
    maxUploadsPerMonth?: number;
    storageQuotaMB?: number;
  };
}

/**
 * Tenant creation response
 */
export interface CreateTenantResponse {
  tenantId: string;
  name: string;
  apiKey: string; // JWT token
  databaseName: string;
  databaseUrl: string;
  databaseToken: string;
  tier: string;
  createdAt: Date;
  isActive: boolean;
}

/**
 * Tier-based limits
 */
const TIER_LIMITS = {
  free: {
    maxUploadsPerMonth: 1000,
    storageQuotaMB: 5000,
    rateLimitTier: 'free' as const,
  },
  standard: {
    maxUploadsPerMonth: 10000,
    storageQuotaMB: 50000,
    rateLimitTier: 'standard' as const,
  },
  premium: {
    maxUploadsPerMonth: -1, // Unlimited
    storageQuotaMB: 500000,
    rateLimitTier: 'premium' as const,
  },
};

/**
 * Create a new tenant with database and credentials
 *
 * @param serviceDb - Prisma client for service database
 * @param request - Tenant creation request
 * @returns Tenant credentials and metadata
 * @throws Error if provisioning fails
 */
export async function createTenant(
  serviceDb: PrismaClient,
  request: CreateTenantRequest
): Promise<CreateTenantResponse> {
  const startTime = Date.now();

  try {
    // Step 1: Validate and normalize input
    const tier = request.tier || 'free';
    const tierLimits = TIER_LIMITS[tier];

    // Step 2: Generate unique tenant ID
    const tenantId = nanoid(16); // 16-char unique ID
    const databaseName = `ocr-tenant-${tenantId.toLowerCase()}`;

    console.log(`[Tenant] Creating tenant: ${request.name} (${tier})`);

    // Step 3: Create Turso database from seed template
    const tursoApi = createTursoApiClient();
    const seedDatabaseName = process.env.SEED_DATABASE_NAME || 'ocr-seed-db';
    const groupName = process.env.TURSO_GROUP || 'ai-ocr';

    console.log(
      `[Tenant] Creating database: ${databaseName} from seed: ${seedDatabaseName}`
    );

    const databaseResult = await tursoApi.createDatabase({
      name: databaseName,
      group: groupName,
      seed: {
        type: 'database',
        name: seedDatabaseName,
      },
      size_limit: '1gb', // Default size limit
    });

    const databaseHostname = databaseResult.database.Hostname;
    const databaseUrl = `libsql://${databaseHostname}`;

    console.log(`[Tenant] Database created: ${databaseUrl}`);

    // Step 4: Create database authentication token
    const tokenName = `${databaseName}-token`;
    const dbTokenResult = await tursoApi.createDatabaseToken(
      databaseName,
      tokenName
    );

    console.log(`[Tenant] Database token created`);

    // Step 5: Generate JWT token for tenant API access (T091)
    const apiKey = await generateTenantToken({
      tenantId: tenantId,
      permissions: ['ocr:upload', 'ocr:review', 'master:import'],
      rateLimitTier: tierLimits.rateLimitTier,
    });

    console.log(`[Tenant] API key (JWT) generated`);

    // Step 6: Register tenant in service database (T092)
    const tenant = await serviceDb.tenant.create({
      data: {
        id: tenantId,
        name: request.name,
        databaseName: databaseName,
        databaseUrl: databaseUrl,
        databaseHostname: databaseHostname,
        apiKey: apiKey, // Store JWT token
        isActive: true,
        createdAt: new Date(),
      },
    });

    console.log(
      `[Tenant] Registered in service DB (${Date.now() - startTime}ms)`
    );

    // Step 7: Return tenant credentials (T093)
    return {
      tenantId: tenant.id,
      name: tenant.name,
      apiKey: apiKey,
      databaseName: databaseName,
      databaseUrl: databaseUrl,
      databaseToken: dbTokenResult.token,
      tier: tier,
      createdAt: tenant.createdAt,
      isActive: tenant.isActive,
    };
  } catch (error) {
    console.error('[Tenant] Provisioning failed:', error);
    throw new Error(
      `Tenant provisioning failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get tenant details from service database
 *
 * @param serviceDb - Prisma client for service database
 * @param tenantId - Tenant ID
 * @returns Tenant metadata
 * @throws Error if tenant not found
 */
export async function getTenant(
  serviceDb: PrismaClient,
  tenantId: string
): Promise<any> {
  const tenant = await serviceDb.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      databaseName: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  return tenant;
}

/**
 * Update tenant settings
 *
 * @param serviceDb - Prisma client for service database
 * @param tenantId - Tenant ID
 * @param updates - Tenant updates
 * @returns Updated tenant metadata
 */
export async function updateTenant(
  serviceDb: PrismaClient,
  tenantId: string,
  updates: {
    tier?: 'free' | 'standard' | 'premium';
    isActive?: boolean;
  }
): Promise<any> {
  const tenant = await serviceDb.tenant.update({
    where: { id: tenantId },
    data: {
      ...updates,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      isActive: true,
      updatedAt: true,
    },
  });

  return tenant;
}

/**
 * Deactivate tenant (soft delete)
 *
 * @param serviceDb - Prisma client for service database
 * @param tenantId - Tenant ID
 * @returns Deactivated tenant metadata
 */
export async function deactivateTenant(
  serviceDb: PrismaClient,
  tenantId: string
): Promise<any> {
  const tenant = await serviceDb.tenant.update({
    where: { id: tenantId },
    data: {
      isActive: false,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      isActive: true,
      updatedAt: true,
    },
  });

  console.log(`[Tenant] Deactivated tenant: ${tenantId}`);

  return tenant;
}
