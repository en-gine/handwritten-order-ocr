// src/api/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import health from './routes/health.js'

/**
 * Hono application initialization for multi-tenant OCR API.
 *
 * **Purpose**:
 * Central API application configuration with middleware chain, error handling,
 * and route registration for the handwritten order OCR system.
 *
 * **Middleware Chain** (execution order):
 * 1. Logger - Request/response logging
 * 2. CORS - Cross-origin resource sharing (dev: all origins, prod: configured)
 * 3. Error Handler - Global error catching and formatting
 * 4. Route-specific middleware (auth, tenant routing, rate limiting) applied per-route
 *
 * **Error Handling Strategy**:
 * - HTTPException: Returns status code and message from exception
 * - Validation errors: 400 Bad Request with details
 * - Authentication errors: 401 Unauthorized
 * - Authorization errors: 403 Forbidden
 * - Not found: 404 Not Found
 * - Rate limiting: 429 Too Many Requests
 * - Server errors: 500 Internal Server Error with sanitized message
 *
 * **CORS Configuration**:
 * - Development: Allow all origins for easier testing
 * - Production: Restrict to configured allowed origins
 * - Credentials: Enabled for authentication
 * - Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
 * - Headers: Content-Type, Authorization, X-Tenant-ID
 *
 * **Usage**:
 * ```typescript
 * import { app } from './api'
 *
 * // In src/index.ts
 * const port = process.env.API_PORT || 3000
 * console.log(`Server running on http://localhost:${port}`)
 * export default app
 * ```
 *
 * **Route Structure**:
 * - Health check: GET /health
 * - OCR processing: POST /v1/ocr
 * - Review queue: GET /v1/reviews, PATCH /v1/reviews/:id
 * - Master data: POST /v1/master/import
 * - Tenant management: POST /v1/tenants (admin only)
 *
 * @module api
 */

/**
 * Create and configure Hono application instance.
 *
 * Initializes Hono with middleware chain and error handling.
 * Routes are registered separately via route modules.
 */
export const app = new Hono()

/**
 * Logger middleware - logs all incoming requests and responses.
 *
 * Format: [timestamp] HTTP method path status response-time
 * Example: [2025-10-15 15:30:45] POST /v1/ocr 200 1234ms
 */
app.use('*', logger())

/**
 * CORS middleware - handles cross-origin requests.
 *
 * Configuration varies by environment:
 * - Development: Allow all origins for easier local testing
 * - Production: Restrict to configured CORS_ALLOWED_ORIGINS env var
 */
app.use(
  '*',
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.CORS_ALLOWED_ORIGINS?.split(',') || []
        : '*', // Allow all origins in development
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
  })
)

/**
 * Global error handler middleware.
 *
 * Catches all errors thrown in routes and middleware, and returns
 * consistent JSON error responses.
 *
 * Error response format:
 * ```json
 * {
 *   "error": {
 *     "message": "Human-readable error message",
 *     "code": "ERROR_CODE",
 *     "status": 400
 *   }
 * }
 * ```
 */
app.onError((err, c) => {
  // Handle HTTPException (thrown by Hono or our middleware)
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          message: err.message,
          status: err.status,
        },
      },
      err.status
    )
  }

  // Handle generic errors
  console.error('Unhandled error:', err)

  // Return sanitized error message (don't leak internal details)
  return c.json(
    {
      error: {
        message:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message || 'Internal server error',
        status: 500,
      },
    },
    500
  )
})

/**
 * 404 Not Found handler.
 *
 * Returns JSON error for any unmatched routes.
 */
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Route not found: ${c.req.method} ${c.req.path}`,
        status: 404,
      },
    },
    404
  )
})

/**
 * Root route - API information.
 *
 * Returns basic API information and version.
 */
app.get('/', (c) => {
  return c.json({
    name: 'Handwritten Order OCR API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      ocr: '/v1/ocr',
      reviews: '/v1/reviews',
      master: '/v1/master/import',
      tenants: '/v1/tenants',
    },
  })
})

/**
 * Route registration
 */

// Health check endpoint (no authentication required)
app.route('/health', health)

/**
 * NOTE: Additional route modules will be registered here once created:
 *
 * import { ocrRoutes } from './routes/ocr'
 * import { reviewRoutes } from './routes/review'
 * import { masterRoutes } from './routes/master'
 * import { tenantRoutes } from './routes/tenants'
 *
 * app.route('/v1/ocr', ocrRoutes)
 * app.route('/v1/reviews', reviewRoutes)
 * app.route('/v1/master', masterRoutes)
 * app.route('/v1/tenants', tenantRoutes)
 */
