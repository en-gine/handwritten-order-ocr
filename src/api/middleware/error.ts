// src/api/middleware/error.ts
/**
 * Global Error Handling Middleware
 *
 * Catches all errors from routes and services, returns consistent error responses.
 * Integrates with Hono's error handling system for proper HTTP exception handling.
 *
 * **Error Response Format** (per OpenAPI spec):
 * ```json
 * {
 *   "error": {
 *     "message": "Human-readable error message",
 *     "status": 400,
 *     "code": "VALIDATION_ERROR",
 *     "details": { ... }
 *   }
 * }
 * ```
 *
 * @module middleware/error
 */

import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: {
    message: string;
    status: number;
    code?: string;
    details?: any;
    timestamp?: string;
    path?: string;
  };
}

/**
 * Global error handler middleware
 *
 * Catches all errors and returns consistent JSON error responses.
 * Logs errors for debugging and monitoring.
 *
 * @param err - Error object (HTTPException or Error)
 * @param c - Hono context
 * @returns JSON error response with appropriate status code
 */
export function errorHandler(err: Error | HTTPException, c: Context) {
  // Get tenant context for logging
  const tenantId = c.get('tenantId') || 'unknown';
  const path = c.req.path;

  // Handle HTTPException (thrown by our middleware/routes)
  if (err instanceof HTTPException) {
    const status = err.status;
    const message = err.message;

    // Log error for debugging
    console.error(`[Error] ${status} ${message}`, {
      tenantId,
      path,
      status,
      error: message,
    });

    const response: ErrorResponse = {
      error: {
        message,
        status,
        timestamp: new Date().toISOString(),
        path,
      },
    };

    return c.json(response, status as any);
  }

  // Handle standard Error (unexpected errors)
  console.error('[Error] Unexpected error:', {
    tenantId,
    path,
    error: err.message,
    stack: err.stack,
  });

  // Map common error types to HTTP status codes
  const status = getStatusFromError(err);
  const errorCode = getErrorCode(err);

  const response: ErrorResponse = {
    error: {
      message: err.message || 'Internal server error',
      status,
      code: errorCode,
      timestamp: new Date().toISOString(),
      path,
    },
  };

  return c.json(response, status as any);
}

/**
 * Determine HTTP status code from error type
 *
 * @param err - Error object
 * @returns HTTP status code
 */
function getStatusFromError(err: Error): number {
  const message = err.message.toLowerCase();

  // Validation errors
  if (message.includes('validation') || message.includes('invalid')) {
    return 400;
  }

  // Authentication errors
  if (message.includes('unauthorized') || message.includes('authentication')) {
    return 401;
  }

  // Permission errors
  if (message.includes('forbidden') || message.includes('permission')) {
    return 403;
  }

  // Not found errors
  if (message.includes('not found')) {
    return 404;
  }

  // Conflict errors
  if (message.includes('conflict') || message.includes('already exists')) {
    return 409;
  }

  // Rate limit errors
  if (message.includes('rate limit') || message.includes('too many')) {
    return 429;
  }

  // Default to 500 Internal Server Error
  return 500;
}

/**
 * Get error code from error type
 *
 * @param err - Error object
 * @returns Error code string
 */
function getErrorCode(err: Error): string {
  const message = err.message.toLowerCase();

  if (message.includes('validation')) return 'VALIDATION_ERROR';
  if (message.includes('authentication')) return 'AUTHENTICATION_ERROR';
  if (message.includes('permission')) return 'PERMISSION_DENIED';
  if (message.includes('not found')) return 'NOT_FOUND';
  if (message.includes('conflict')) return 'CONFLICT';
  if (message.includes('rate limit')) return 'RATE_LIMIT_EXCEEDED';

  return 'INTERNAL_ERROR';
}

/**
 * Not Found (404) handler for undefined routes
 *
 * @param c - Hono context
 * @returns 404 JSON response
 */
export function notFoundHandler(c: Context) {
  const response: ErrorResponse = {
    error: {
      message: `Route not found: ${c.req.method} ${c.req.path}`,
      status: 404,
      code: 'NOT_FOUND',
      timestamp: new Date().toISOString(),
      path: c.req.path,
    },
  };

  return c.json(response, 404);
}
