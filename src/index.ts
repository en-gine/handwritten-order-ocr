// src/index.ts
import { serve } from '@hono/node-server'
import { app } from './api/index.js'
import { disconnectAllTenants } from './lib/turso.js'

/**
 * Server entry point for the Handwritten Order OCR API.
 *
 * **Purpose**:
 * Starts the Hono application server with graceful shutdown handling,
 * ensuring all database connections are properly closed on termination.
 *
 * **Graceful Shutdown**:
 * - Listens for SIGTERM and SIGINT signals
 * - Disconnects all cached tenant database clients
 * - Disconnects service database client
 * - Exits cleanly with status code 0
 *
 * **Configuration**:
 * - Port: API_PORT environment variable (default: 3000)
 * - Host: 0.0.0.0 (listens on all network interfaces)
 *
 * **Usage**:
 * ```bash
 * # Development
 * npm run dev
 *
 * # Production
 * npm run build
 * npm start
 * ```
 *
 * @module index
 */

/**
 * Server configuration from environment variables.
 */
const port = parseInt(process.env.API_PORT || '3000', 10)
const host = '0.0.0.0'

/**
 * Start the Hono server.
 *
 * Uses @hono/node-server to serve the Hono application.
 * Logs startup information including port and environment.
 */
const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`🚀 Server started successfully`)
    console.log(`   Port: ${info.port}`)
    console.log(`   Host: ${host}`)
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`   Base URL: http://localhost:${info.port}`)
    console.log(`   Health check: http://localhost:${info.port}/health`)
    console.log(`\n📋 API endpoints:`)
    console.log(`   POST   /v1/ocr`)
    console.log(`   GET    /v1/reviews`)
    console.log(`   POST   /v1/master/import`)
    console.log(`   POST   /v1/tenants`)
    console.log(`\n✨ Server is ready to accept requests`)
  }
)

/**
 * Graceful shutdown handler.
 *
 * Performs cleanup operations before terminating the process:
 * 1. Log shutdown initiation
 * 2. Disconnect all tenant database clients (via LRU cache)
 * 3. Disconnect service database client
 * 4. Exit with success code
 *
 * @param signal - The signal that triggered shutdown (SIGTERM or SIGINT)
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal} - initiating graceful shutdown...`)

  try {
    // Disconnect all database clients
    console.log('   Disconnecting database clients...')
    await disconnectAllTenants()
    console.log('   ✓ All database connections closed')

    // Close the server
    console.log('   Closing HTTP server...')
    server.close(() => {
      console.log('   ✓ HTTP server closed')
      console.log('✅ Graceful shutdown complete')
      process.exit(0)
    })

    // Force shutdown after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('⚠️  Graceful shutdown timeout - forcing exit')
      process.exit(1)
    }, 10000)
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error)
    process.exit(1)
  }
}

/**
 * Register signal handlers for graceful shutdown.
 *
 * Handles:
 * - SIGTERM: Termination signal (e.g., from Docker, Kubernetes)
 * - SIGINT: Interrupt signal (e.g., Ctrl+C in terminal)
 */
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

/**
 * Handle uncaught errors to prevent silent failures.
 */
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error)
  gracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown('UNHANDLED_REJECTION')
})
