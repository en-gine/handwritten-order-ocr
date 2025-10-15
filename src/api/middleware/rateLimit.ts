// src/api/middleware/rateLimit.ts
import { createMiddleware } from 'hono/factory'
import { rateLimiter } from 'hono-rate-limiter'
import { HTTPException } from 'hono/http-exception'

/**
 * Rate limit tiers for multi-tenant API access control.
 *
 * **Tiers**:
 * - free: 10 requests/minute
 * - standard: 100 requests/minute
 * - premium: 1000 requests/minute
 *
 * **How it works**:
 * 1. Extracts rate_limit_tier from JWT payload (set by jwtAuth middleware)
 * 2. Applies tenant-specific rate limit based on tier
 * 3. Uses sliding window algorithm with in-memory store
 * 4. Returns 429 status when limit exceeded
 * 5. Includes X-RateLimit-* headers in all responses
 *
 * **Security**:
 * - Rate limits are per-tenant (not per-IP) to prevent shared IP issues
 * - Prevents abuse while allowing legitimate high-volume use
 * - Gracefully handles missing tier (defaults to 'free')
 *
 * **Usage**:
 * ```typescript
 * import { jwtAuth } from './middleware/auth'
 * import { tenantRateLimiter } from './middleware/rateLimit'
 *
 * app.post('/api/v1/ocr', jwtAuth, tenantRateLimiter, async (c) => {
 *   // Request is rate-limited based on tenant's tier
 *   // ...
 * })
 * ```
 *
 * **Headers Returned**:
 * - X-RateLimit-Limit: Maximum requests per window
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Timestamp when window resets
 *
 * **Environment Variables**: None required (uses in-memory store)
 *
 * **Dependencies**:
 * - Requires jwtAuth middleware to run first (sets jwtPayload in context)
 * - hono-rate-limiter package (^0.4.0)
 *
 * **Thrown Errors**:
 * - 429: Rate limit exceeded
 * - 500: Rate limit tier not found in JWT payload
 *
 * @example
 * // Middleware chain
 * app.use('/api/v1/*', jwtAuth)
 * app.use('/api/v1/*', tenantRateLimiter)
 */

/**
 * Rate limit configuration by tier.
 * Maps tier name to requests per minute.
 */
export const RATE_LIMIT_TIERS = {
  free: 10,
  standard: 100,
  premium: 1000,
} as const

type RateLimitTier = keyof typeof RATE_LIMIT_TIERS

/**
 * Create rate limiter instances for each tier (initialized once).
 * These are shared across all requests and maintain state.
 */
const rateLimiters = {
  free: rateLimiter({
    windowMs: 60 * 1000, // 1 minute window
    limit: RATE_LIMIT_TIERS.free,
    standardHeaders: 'draft-7', // Use draft-7 RateLimit headers
    keyGenerator: (c) => `${c.get('tenantId')}:free`, // Include tier in key for isolation
    handler: (c) => {
      throw new HTTPException(429, {
        message: `Rate limit exceeded for tier 'free'. Maximum ${RATE_LIMIT_TIERS.free} requests per minute.`,
      })
    },
  }),
  standard: rateLimiter({
    windowMs: 60 * 1000,
    limit: RATE_LIMIT_TIERS.standard,
    standardHeaders: 'draft-7',
    keyGenerator: (c) => `${c.get('tenantId')}:standard`,
    handler: (c) => {
      throw new HTTPException(429, {
        message: `Rate limit exceeded for tier 'standard'. Maximum ${RATE_LIMIT_TIERS.standard} requests per minute.`,
      })
    },
  }),
  premium: rateLimiter({
    windowMs: 60 * 1000,
    limit: RATE_LIMIT_TIERS.premium,
    standardHeaders: 'draft-7',
    keyGenerator: (c) => `${c.get('tenantId')}:premium`,
    handler: (c) => {
      throw new HTTPException(429, {
        message: `Rate limit exceeded for tier 'premium'. Maximum ${RATE_LIMIT_TIERS.premium} requests per minute.`,
      })
    },
  }),
}

/**
 * Tenant-aware rate limiting middleware.
 *
 * Enforces per-tenant rate limits based on rate_limit_tier claim in JWT.
 * Uses sliding window algorithm with 60-second window.
 */
export const tenantRateLimiter = createMiddleware(async (c, next) => {
  // Extract JWT payload (set by jwtAuth middleware)
  const jwtPayload = c.get('jwtPayload')

  if (!jwtPayload) {
    throw new HTTPException(500, {
      message: 'JWT payload not found in context. Ensure jwtAuth middleware runs first.',
    })
  }

  // Extract rate limit tier from JWT claims
  const tier = (jwtPayload.rate_limit_tier as RateLimitTier) || 'free'

  // Validate tier exists
  if (!RATE_LIMIT_TIERS[tier]) {
    throw new HTTPException(500, {
      message: `Invalid rate limit tier: ${tier}. Valid tiers: free, standard, premium`,
    })
  }

  // Get tenant ID for rate limit key
  const tenantId = c.get('tenantId')

  if (!tenantId) {
    throw new HTTPException(500, {
      message: 'tenantId not found in context. Ensure jwtAuth middleware runs first.',
    })
  }

  // Apply rate limiting with appropriate tier limiter
  return rateLimiters[tier](c, next)
})

/**
 * Helper function to get current rate limit status for a tenant.
 *
 * NOTE: This is a placeholder. hono-rate-limiter doesn't expose
 * current rate limit state directly. For production, consider:
 * - Using Redis-based rate limiter with direct query capability
 * - Implementing custom rate limiter with status exposure
 * - Adding monitoring/metrics for rate limit hits
 *
 * @param tenantId - Tenant identifier
 * @returns Current rate limit status (requests remaining, reset time)
 */
export function getRateLimitStatus(tenantId: string): {
  remaining: number
  resetAt: Date
  limit: number
} {
  // Placeholder implementation
  // In production, query rate limiter store (Redis, memory, etc.)
  throw new Error('getRateLimitStatus not implemented. Use X-RateLimit-* headers instead.')
}
