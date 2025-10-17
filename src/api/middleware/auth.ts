// src/api/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'

/**
 * JWT authentication middleware for tenant API requests.
 *
 * Verifies JWT tokens from Authorization header, extracts tenant_id claim,
 * and sets authentication context for downstream handlers.
 *
 * **How it works**:
 * 1. Extracts Bearer token from Authorization header
 * 2. Verifies JWT signature using RS256 public key
 * 3. Validates token expiration and claims
 * 4. Sets jwtPayload and tenantId in Hono context
 *
 * **Security**:
 * - Uses asymmetric RS256 signing (public key verification only)
 * - Rejects missing, malformed, or expired tokens with 401
 * - Tenant ID extracted from trusted JWT claim (not request body)
 *
 * **Usage**:
 * ```typescript
 * import { jwtAuth } from './middleware/auth'
 *
 * app.post('/api/v1/ocr', jwtAuth, async (c) => {
 *   const tenantId = c.get('tenantId')  // From verified JWT
 *   const payload = c.get('jwtPayload') // Full JWT payload
 *   // ... process OCR request for tenant
 * })
 * ```
 *
 * **Environment Variables**:
 * - JWT_PUBLIC_KEY: RS256 public key for token verification (required)
 *
 * **Thrown Errors**:
 * - 401: Missing or invalid Authorization header
 * - 401: Token verification failed (expired, invalid signature, etc.)
 * - 500: JWT_PUBLIC_KEY environment variable not set
 *
 * @example
 * // Valid request
 * Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
 *
 * @example
 * // Invalid request (missing Bearer prefix)
 * Authorization: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
 * // Returns: 401 Missing or invalid Authorization header
 */
export const jwtAuth = createMiddleware(async (c, next) => {
  // Check for JWT_PUBLIC_KEY environment variable
  const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY

  if (!JWT_PUBLIC_KEY) {
    throw new HTTPException(500, {
      message: 'JWT_PUBLIC_KEY environment variable not configured',
    })
  }

  // Extract Authorization header
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Missing or invalid Authorization header',
    })
  }

  // Extract token (remove "Bearer " prefix)
  const token = authHeader.substring(7)

  try {
    // Verify JWT with RS256 algorithm
    const payload = await verify(token, JWT_PUBLIC_KEY, 'RS256')

    // Validate tenant_id claim exists
    if (!payload.tenant_id || typeof payload.tenant_id !== 'string') {
      throw new HTTPException(401, {
        message: 'Invalid token: missing or invalid tenant_id claim',
      })
    }

    // Set authentication context for downstream handlers
    c.set('jwtPayload', payload)
    c.set('tenantId', payload.tenant_id as string)

    await next()
  } catch (error) {
    // Handle verification errors (expired, invalid signature, etc.)
    if (error instanceof HTTPException) {
      throw error // Re-throw HTTP exceptions
    }

    throw new HTTPException(401, {
      message: 'Token verification failed',
      cause: error,
    })
  }
})

/**
 * Admin authentication middleware for tenant management endpoints.
 *
 * Verifies JWT token contains 'admin' role in permissions claim.
 * Used for tenant provisioning and administrative operations.
 *
 * **How it works**:
 * 1. Runs jwtAuth middleware to verify token
 * 2. Checks for 'admin' role in permissions array
 * 3. Allows request to proceed if admin role present
 *
 * **Usage**:
 * ```typescript
 * import { adminAuth } from './middleware/auth'
 *
 * app.post('/v1/tenants', adminAuth, async (c) => {
 *   // Only accessible with admin JWT token
 * })
 * ```
 *
 * **Thrown Errors**:
 * - 403: Missing admin role in JWT permissions
 *
 * @example
 * // Valid admin JWT payload
 * {
 *   "tenant_id": "admin",
 *   "permissions": ["admin", "tenant:manage"],
 *   "rate_limit_tier": "premium"
 * }
 */
export const adminAuth = createMiddleware(async (c, next) => {
  // First, verify JWT token
  await jwtAuth(c, async () => {});

  // Check for admin role in permissions
  const payload = c.get('jwtPayload') as any;
  const permissions = payload.permissions || [];

  if (!permissions.includes('admin')) {
    throw new HTTPException(403, {
      message: 'Admin access required for this operation',
    });
  }

  await next();
})
