// src/api/routes/ocr.ts
import { Hono } from 'hono'

/**
 * OCR processing routes for handwritten order form recognition.
 *
 * **Purpose**:
 * Handles upload and processing of handwritten order forms (PDF/JPG/PNG),
 * extracts customer information and order items using AI vision models,
 * and returns structured JSON with confidence scores.
 *
 * **Endpoints**:
 * - POST /v1/ocr - Upload and process order form
 *
 * **Authentication**: Required (JWT token with tenant_id claim)
 * **Rate Limiting**: Applied based on tenant tier (free/standard/premium)
 *
 * **Request Format** (multipart/form-data):
 * ```
 * file: <binary> (PDF, JPG, PNG - max 10MB)
 * ```
 *
 * **Response Format** (JSON):
 * ```json
 * {
 *   "orderId": "ord_abc123",
 *   "status": "CONFIRMED" | "REVIEWING",
 *   "overallConfidence": 0.92,
 *   "customer": {
 *     "name": "Acme Corporation",
 *     "code": "ACME001",
 *     "confidence": 0.95
 *   },
 *   "items": [
 *     {
 *       "productCode": "PROD-001",
 *       "productName": "Widget A",
 *       "quantity": 100,
 *       "confidence": 0.88
 *     }
 *   ],
 *   "submissionTime": "2025-10-15T15:30:45.123Z",
 *   "processingTime": 3.2
 * }
 * ```
 *
 * **Processing Flow**:
 * 1. File upload validation (size, format)
 * 2. Store file in storage (local/R2)
 * 3. Send to Gemini API for OCR extraction
 * 4. Match customer against master database
 * 5. Match products against master database
 * 6. Calculate confidence scores
 * 7. Create Order record (status: PROCESSING → CONFIRMED/REVIEWING)
 * 8. Return structured response
 *
 * **Status Codes**:
 * - 200 OK: Order processed successfully
 * - 400 Bad Request: Invalid file format or size
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 413 Payload Too Large: File exceeds 10MB
 * - 429 Too Many Requests: Rate limit exceeded
 * - 500 Internal Server Error: Processing failed
 *
 * @module routes/ocr
 */

const ocr = new Hono()

/**
 * POST /v1/ocr - Upload and process order form
 *
 * NOTE: This is a placeholder implementation.
 * Full implementation will be added in Phase 3 (User Story 1).
 *
 * Required middleware (to be added):
 * - jwtAuth: Verify JWT token and extract tenant_id
 * - tenantRouter: Load tenant database client
 * - tenantRateLimiter: Apply rate limiting based on tenant tier
 * - uploadValidator: Validate file size and format
 */
ocr.post('/', (c) => {
  return c.json(
    {
      error: {
        message: 'OCR processing not yet implemented',
        status: 501,
        hint: 'This endpoint will be implemented in Phase 3 (User Story 1 - Basic Order Recognition)',
      },
    },
    501
  )
})

export default ocr
