// src/api/routes/review.ts
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtAuth } from '../middleware/auth.js'
import { tenantRouter } from '../middleware/tenant.js'
import { getReviewQueue, getReviewItem, applyReviewCorrections } from '../../services/review.service.js'
import type { HonoVariables } from '../../types/hono.js'
import type { ReviewUpdateRequest } from '../../types/api.js'

/**
 * Review queue routes for manual order correction.
 *
 * **Purpose**:
 * Handles review queue operations for low-confidence orders that require
 * human verification and correction before final confirmation.
 *
 * **Endpoints**:
 * - GET /v1/reviews - List orders in review queue
 * - GET /v1/reviews/:orderId - Get single order for review
 * - PATCH /v1/reviews/:orderId - Update order with corrections
 *
 * **Authentication**: Required (JWT token with tenant_id claim)
 * **Rate Limiting**: Applied based on tenant tier
 *
 * **GET /v1/reviews** (List review queue):
 * Query parameters:
 * - status: PENDING | IN_REVIEW | COMPLETED
 * - flagReason: low_confidence | missing_data | uncertain_customer
 * - startDate: ISO8601 date filter
 * - endDate: ISO8601 date filter
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 *
 * Response:
 * ```json
 * {
 *   "items": [
 *     {
 *       "orderId": "ord_abc123",
 *       "flagReason": "low_confidence",
 *       "overallConfidence": 0.62,
 *       "submittedAt": "2025-10-15T15:30:45.123Z",
 *       "customer": { "name": "Acme Corp", "confidence": 0.55 },
 *       "itemCount": 3
 *     }
 *   ],
 *   "pagination": {
 *     "page": 1,
 *     "limit": 20,
 *     "total": 45,
 *     "pages": 3
 *   }
 * }
 * ```
 *
 * **GET /v1/reviews/:orderId** (Get single order):
 * Response:
 * ```json
 * {
 *   "orderId": "ord_abc123",
 *   "status": "REVIEWING",
 *   "overallConfidence": 0.62,
 *   "customer": {
 *     "name": "Acme Corp",
 *     "code": "ACME001",
 *     "confidence": 0.55,
 *     "suggestions": [
 *       { "name": "Acme Corporation", "code": "ACME001", "confidence": 0.75 }
 *     ]
 *   },
 *   "items": [
 *     {
 *       "productCode": "PROD-001",
 *       "productName": "Widget A",
 *       "quantity": 100,
 *       "confidence": 0.88
 *     }
 *   ],
 *   "originalFileUrl": "https://storage.example.com/orders/abc123.pdf?expires=...",
 *   "submittedAt": "2025-10-15T15:30:45.123Z"
 * }
 * ```
 *
 * **PATCH /v1/reviews/:orderId** (Update with corrections):
 * Request:
 * ```json
 * {
 *   "customerCorrection": {
 *     "customerId": "cust_123",
 *     "name": "Acme Corporation"
 *   },
 *   "itemCorrections": [
 *     {
 *       "index": 0,
 *       "productId": "prod_456",
 *       "quantity": 120
 *     }
 *   ],
 *   "reviewNotes": "Corrected quantity from 100 to 120",
 *   "status": "CONFIRMED" | "REJECTED"
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "orderId": "ord_abc123",
 *   "status": "CONFIRMED",
 *   "reviewedBy": "user_xyz",
 *   "reviewedAt": "2025-10-15T16:00:00.000Z"
 * }
 * ```
 *
 * **Status Codes**:
 * - 200 OK: Success
 * - 400 Bad Request: Invalid request format
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 404 Not Found: Order not found
 * - 429 Too Many Requests: Rate limit exceeded
 * - 500 Internal Server Error: Processing failed
 *
 * @module routes/review
 */

const review = new Hono<{ Variables: HonoVariables }>()

// Apply middleware chain: authentication → tenant routing
review.use('/*', jwtAuth, tenantRouter)

/**
 * GET /v1/reviews - List orders in review queue
 *
 * Query parameters:
 * - reviewStatus: pending | in_progress | completed
 * - flagReason: low_confidence | unknown_product | unknown_customer
 * - startDate: ISO8601 date
 * - endDate: ISO8601 date
 * - page: Page number (default 1)
 * - pageSize: Items per page (default 20, max 100)
 */
review.get('/', async (c) => {
  try {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')

    // Parse query parameters
    const reviewStatus = c.req.query('reviewStatus') as 'pending' | 'in_progress' | 'completed' | undefined
    const flagReason = c.req.query('flagReason') as 'low_confidence' | 'unknown_product' | 'unknown_customer' | undefined
    const startDate = c.req.query('startDate') ? new Date(c.req.query('startDate')!) : undefined
    const endDate = c.req.query('endDate') ? new Date(c.req.query('endDate')!) : undefined
    const page = parseInt(c.req.query('page') || '1', 10)
    const pageSize = parseInt(c.req.query('pageSize') || '20', 10)

    console.log(
      `[Review Queue] Listing reviews for tenant ${tenantId} (page ${page}, pageSize ${pageSize})`
    )

    // Get review queue
    const result = await getReviewQueue(
      prisma,
      tenantId,
      {
        reviewStatus,
        flagReason,
        startDate,
        endDate,
      },
      page,
      pageSize
    )

    return c.json({
      reviews: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    })
  } catch (error) {
    console.error('[Review Queue] Error listing reviews:', error)
    throw new HTTPException(500, {
      message: 'レビューキューの取得に失敗しました。',
      cause: error,
    })
  }
})

/**
 * GET /v1/reviews/:orderId - Get single order for review
 *
 * Returns order details with presigned URL for original image (1-hour expiry)
 */
review.get('/:orderId', async (c) => {
  try {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const orderId = c.req.param('orderId')

    console.log(`[Review Queue] Retrieving order ${orderId} for tenant ${tenantId}`)

    // Get review item with presigned URL
    const reviewItem = await getReviewItem(prisma, orderId, tenantId)

    return c.json(reviewItem)
  } catch (error) {
    console.error('[Review Queue] Error retrieving review item:', error)

    // Handle not found errors
    if (error instanceof Error && error.message.includes('存在しません')) {
      throw new HTTPException(404, {
        message: error.message,
      })
    }

    throw new HTTPException(500, {
      message: 'レビュー情報の取得に失敗しました。',
      cause: error,
    })
  }
})

/**
 * PATCH /v1/reviews/:orderId - Update order with corrections
 *
 * Request body:
 * - customerCorrection: { customerId, customerName } (optional)
 * - itemCorrections: Array<{ itemIndex, productId, quantity?, unitOfMeasure? }> (optional)
 * - reviewNotes: string (optional)
 * - action: 'approve' | 'reject' (required)
 */
review.patch('/:orderId', async (c) => {
  try {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const orderId = c.req.param('orderId')
    const jwtPayload = c.get('jwtPayload')

    // Extract operator ID from JWT (use sub claim or email)
    const operatorId = jwtPayload.sub || jwtPayload.email || 'unknown'

    console.log(`[Review Queue] Applying corrections to order ${orderId} by operator ${operatorId}`)

    // Parse request body
    const corrections = await c.req.json<ReviewUpdateRequest>()

    // Validate action field
    if (!corrections.action || !['approve', 'reject'].includes(corrections.action)) {
      throw new HTTPException(400, {
        message: 'アクションフィールドが必要です。値は "approve" または "reject" である必要があります。',
      })
    }

    // Apply corrections
    const updatedOrder = await applyReviewCorrections(
      prisma,
      orderId,
      tenantId,
      corrections,
      operatorId
    )

    return c.json({
      orderId: updatedOrder.orderId,
      status: updatedOrder.status,
      reviewedBy: operatorId,
      reviewedAt: new Date().toISOString(),
      message:
        corrections.action === 'approve'
          ? '注文の確認が完了しました。'
          : '注文が却下されました。',
    })
  } catch (error) {
    console.error('[Review Queue] Error applying corrections:', error)

    // Handle not found errors
    if (error instanceof Error && error.message.includes('存在しません')) {
      throw new HTTPException(404, {
        message: error.message,
      })
    }

    // Handle validation errors
    if (error instanceof HTTPException) {
      throw error
    }

    throw new HTTPException(500, {
      message: '注文の更新に失敗しました。',
      cause: error,
    })
  }
})

export default review
