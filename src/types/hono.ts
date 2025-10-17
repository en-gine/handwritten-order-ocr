// src/types/hono.ts
/**
 * Hono type extensions for custom context variables.
 *
 * This file defines the environment type for Hono to include custom variables
 * set by middleware (e.g., tenantId, prisma, uploadedFile).
 */

import type { PrismaClient } from '@prisma/client'
import type { ValidatedFile } from '../api/middleware/upload.js'

/**
 * Extended context variables available in route handlers.
 */
export type HonoVariables = {
  /** JWT payload from authentication middleware */
  jwtPayload: any
  /** Tenant ID extracted from JWT */
  tenantId: string
  /** Tenant-specific Prisma client */
  prisma: PrismaClient
  /** Tenant metadata from service database */
  tenant: {
    id: string
    databaseName: string
    databaseUrl: string
    apiKey: string
    confidenceThreshold: number | null
    aiModel: string | null
    rateLimitTier: string | null
  }
  /** Validated uploaded file (from upload middleware) */
  uploadedFile: ValidatedFile
  /** Validated uploaded files array (for batch uploads) */
  uploadedFiles: ValidatedFile[]
}
