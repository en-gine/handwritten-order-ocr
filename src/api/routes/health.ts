// src/api/routes/health.ts
import { Hono } from 'hono'

/**
 * Health check endpoint for server monitoring and load balancer probes.
 *
 * **Purpose**:
 * Provides a simple endpoint to verify the server is running and responsive.
 * Used by load balancers, monitoring systems, and orchestration platforms
 * to check application health.
 *
 * **Endpoint**: GET /health
 *
 * **Response Format**:
 * ```json
 * {
 *   "status": "ok",
 *   "timestamp": "2025-10-15T15:30:45.123Z",
 *   "environment": "development",
 *   "version": "1.0.0"
 * }
 * ```
 *
 * **Status Codes**:
 * - 200 OK: Server is healthy and operational
 *
 * **Authentication**: None required (public endpoint)
 *
 * **Use Cases**:
 * 1. Load Balancer Health Probes: AWS ELB, GCP Load Balancer, etc.
 * 2. Kubernetes Liveness/Readiness Probes
 * 3. Monitoring Systems: Datadog, New Relic, Prometheus
 * 4. CI/CD Deployment Verification
 * 5. Manual Service Discovery
 *
 * **Future Enhancements**:
 * - Database connection check (optional deep health check)
 * - External service connectivity (Turso, Gemini API)
 * - Memory/CPU usage metrics
 * - Uptime tracking
 *
 * @module routes/health
 */

const health = new Hono()

/**
 * GET /health - Health check endpoint
 *
 * Returns server status, timestamp, and environment information.
 * This endpoint does NOT check:
 * - Database connectivity (to keep response fast)
 * - External API availability
 * - Disk space or memory usage
 *
 * For deep health checks, consider adding a separate `/health/deep` endpoint.
 */
health.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  })
})

export default health
