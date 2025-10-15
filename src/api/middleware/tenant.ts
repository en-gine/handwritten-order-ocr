// src/api/middleware/tenant.ts
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getServicePrismaClient, getTenantPrismaClient } from '../../lib/turso.js'

/**
 * Tenant database routing middleware.
 *
 * Fetches tenant metadata from service database and injects tenant-specific
 * Prisma client into request context for downstream handlers.
 *
 * **How it works**:
 * 1. Extracts tenantId from context (set by auth middleware)
 * 2. Queries service database for tenant metadata
 * 3. Gets tenant-specific Prisma client from cache or creates new one
 * 4. Injects Prisma client into context as 'prisma'
 *
 * **Security**:
 * - Validates tenant exists before routing
 * - Returns 404 for unknown tenants
 * - Uses cached Prisma clients for performance (LRU cache)
 *
 * **Usage**:
 * ```typescript
 * import { jwtAuth } from './middleware/auth'
 * import { tenantRouter } from './middleware/tenant'
 *
 * app.post('/api/v1/ocr', jwtAuth, tenantRouter, async (c) => {
 *   const prisma = c.get('prisma')  // Tenant-specific Prisma client
 *   const tenantId = c.get('tenantId')  // From auth middleware
 *
 *   // Query tenant's database
 *   const orders = await prisma.order.findMany({
 *     where: { tenantId }
 *   })
 *   // ...
 * })
 * ```
 *
 * **Environment Variables**:
 * - SERVICE_DATABASE_URL: Turso service database URL (required)
 *
 * **Dependencies**:
 * - Requires jwtAuth middleware to run first (sets tenantId in context)
 *
 * **Thrown Errors**:
 * - 404: Tenant not found in service database
 * - 500: Service database not configured
 * - 500: Database connection failed
 *
 * @example
 * // Middleware chain
 * app.use('/api/v1/*', jwtAuth)
 * app.use('/api/v1/*', tenantRouter)
 */
export const tenantRouter = createMiddleware(async (c, next) => {
  // Extract tenantId from context (set by jwtAuth middleware)
  const tenantId = c.get('tenantId')

  if (!tenantId) {
    throw new HTTPException(500, {
      message: 'tenantId not found in context. Ensure jwtAuth middleware runs first.',
    })
  }

  try {
    // Get service database client
    const serviceDb = getServicePrismaClient()

    // Fetch tenant metadata from service database
    const tenant = await serviceDb.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        databaseName: true,
        databaseUrl: true,
        apiKey: true,
        confidenceThreshold: true,
        aiModel: true,
        rateLimitTier: true,
      },
    })

    // Return 404 if tenant not found
    if (!tenant) {
      throw new HTTPException(404, {
        message: `Tenant not found: ${tenantId}`,
      })
    }

    // Get tenant-specific Prisma client (cached or new)
    const tenantDb = getTenantPrismaClient(tenantId, tenant.databaseUrl)

    // Inject tenant database client into context
    c.set('prisma', tenantDb)

    // Inject tenant metadata into context (optional, for easy access)
    c.set('tenant', tenant)

    await next()
  } catch (error) {
    // Re-throw HTTP exceptions
    if (error instanceof HTTPException) {
      throw error
    }

    // Handle database connection errors
    throw new HTTPException(500, {
      message: 'Database connection failed',
      cause: error,
    })
  }
})
