// src/api/routes/ocr.ts
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtAuth } from '../middleware/auth.js'
import { tenantRouter } from '../middleware/tenant.js'
import { validateFileUpload, validateBatchFileUpload } from '../middleware/upload.js'
import { processOrderForm, processBatchOrderForms } from '../../services/ocr.service.js'
import { GeminiClient } from '../../lib/gemini.js'
import { createStorage } from '../../lib/storage/factory.js'
import { getConfig } from '../../lib/config.js'
import type { OCRUploadResponse } from '../../types/api.js'
import type { HonoVariables } from '../../types/hono.js'

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

const ocr = new Hono<{ Variables: HonoVariables }>()

// Apply middleware chain: authentication → tenant routing → file validation
ocr.use('/', jwtAuth, tenantRouter, validateFileUpload)

/**
 * POST /v1/ocr - Upload and process order form
 *
 * Processes uploaded handwritten order form through complete OCR pipeline:
 * 1. Extracts file from validated upload (middleware provides this)
 * 2. Stores file in storage backend (local/R2)
 * 3. Sends to Gemini API for OCR extraction
 * 4. Matches extracted customer and products against databases
 * 5. Calculates confidence scores
 * 6. Creates Order and related records in database
 * 7. Returns structured JSON response
 */
ocr.post('/', async (c) => {
  try {
    // Extract context from middleware
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const tenant = c.get('tenant')
    const uploadedFile = c.get('uploadedFile')

    // Get configuration
    const config = getConfig()

    // Get confidence threshold (tenant-specific or default)
    const confidenceThreshold = tenant.confidenceThreshold || config.confidenceThreshold

    console.log(
      `[OCR] Processing upload for tenant ${tenantId}: ${uploadedFile.fileName} (${uploadedFile.fileSize} bytes)`
    )

    // Initialize storage and AI client
    const storage = createStorage()
    const geminiClient = new GeminiClient({
      apiKey: config.geminiApiKey,
      model: tenant.aiModel || config.defaultAiModel,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
    })

    // Generate temporary order ID for file storage (will be replaced by database ID)
    const tempOrderId = `temp-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Store uploaded file
    let fileKey: string
    try {
      // Convert Buffer to File-like object for storage interface
      const fileBlob = new File([uploadedFile.buffer], uploadedFile.fileName, {
        type: uploadedFile.mimeType,
      })

      fileKey = await storage.uploadFile(
        tenantId,
        tempOrderId,
        fileBlob,
        uploadedFile.mimeType
      )

      console.log(`[OCR] File stored: ${fileKey}`)
    } catch (storageError) {
      console.error('[OCR] File storage failed:', storageError)
      throw new HTTPException(500, {
        message: 'ファイルの保存に失敗しました。',
      })
    }

    // Process order form through OCR pipeline
    let orderResponse: OCRUploadResponse
    try {
      const result = await processOrderForm(
        prisma,
        geminiClient,
        uploadedFile.buffer,
        uploadedFile.fileName,
        uploadedFile.mimeType,
        fileKey,
        tenantId,
        confidenceThreshold
      )

      // Build response with success message
      orderResponse = {
        ...result,
        message:
          result.status === 'CONFIRMED'
            ? '注文書の処理が完了しました。'
            : '注文書の処理が完了しましたが、確認が必要な項目があります。レビューキューを確認してください。',
      }

      console.log(
        `[OCR] Processing complete: ${orderResponse.orderId} (confidence: ${orderResponse.overallConfidence})`
      )
    } catch (ocrError) {
      console.error('[OCR] Processing error:', ocrError)

      // Clean up uploaded file on error
      try {
        await storage.deleteFile(fileKey)
        console.log(`[OCR] Cleaned up file after error: ${fileKey}`)
      } catch (deleteError) {
        console.error('[OCR] Failed to clean up file:', deleteError)
      }

      // Return user-friendly error message
      if (ocrError instanceof HTTPException) {
        throw ocrError
      }

      throw new HTTPException(500, {
        message: 'OCR処理中にエラーが発生しました。画像が不鮮明な場合は、再度アップロードしてください。',
        cause: ocrError,
      })
    }

    return c.json(orderResponse, 200)
  } catch (error) {
    // Re-throw HTTP exceptions
    if (error instanceof HTTPException) {
      throw error
    }

    // Handle unexpected errors
    console.error('[OCR] Unexpected error:', error)
    throw new HTTPException(500, {
      message: 'サーバー内部エラーが発生しました。',
      cause: error,
    })
  }
})

/**
 * POST /v1/ocr/batch - Upload and process multiple order forms in batch
 *
 * Processes multiple uploaded handwritten order forms with concurrency control:
 * 1. Validates all files (middleware provides this)
 * 2. Stores files in storage backend (local/R2)
 * 3. Processes files in batches (max 5 concurrent per tenant)
 * 4. Returns aggregate statistics and individual results
 */
ocr.post('/batch', jwtAuth, tenantRouter, validateBatchFileUpload, async (c) => {
  try {
    // Extract context from middleware
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const tenant = c.get('tenant')
    const uploadedFiles = c.get('uploadedFiles')

    // Get configuration
    const config = getConfig()

    // Get confidence threshold (tenant-specific or default)
    const confidenceThreshold = tenant.confidenceThreshold || config.confidenceThreshold

    console.log(
      `[OCR Batch] Processing ${uploadedFiles.length} files for tenant ${tenantId}`
    )

    // Initialize storage and AI client
    const storage = createStorage()
    const geminiClient = new GeminiClient({
      apiKey: config.geminiApiKey,
      model: tenant.aiModel || config.defaultAiModel,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
    })

    // Store all uploaded files first
    const filesWithKeys: Array<{
      buffer: Buffer
      fileName: string
      mimeType: string
      fileKey: string
    }> = []

    for (const uploadedFile of uploadedFiles) {
      const tempOrderId = `temp-${Date.now()}-${Math.random().toString(36).substring(7)}`

      try {
        // Create File object for storage interface
        const fileBlob = new File([uploadedFile.buffer], uploadedFile.fileName, {
          type: uploadedFile.mimeType,
        }) as File

        const fileKey = await storage.uploadFile(
          tenantId,
          tempOrderId,
          fileBlob,
          uploadedFile.mimeType
        )

        filesWithKeys.push({
          buffer: uploadedFile.buffer,
          fileName: uploadedFile.fileName,
          mimeType: uploadedFile.mimeType,
          fileKey,
        })

        console.log(`[OCR Batch] File stored: ${fileKey}`)
      } catch (storageError) {
        console.error(`[OCR Batch] File storage failed for ${uploadedFile.fileName}:`, storageError)
        throw new HTTPException(500, {
          message: `ファイル ${uploadedFile.fileName} の保存に失敗しました。`,
        })
      }
    }

    // Process all files in batch with concurrency control
    let batchResult
    try {
      batchResult = await processBatchOrderForms(
        prisma,
        geminiClient,
        filesWithKeys,
        tenantId,
        confidenceThreshold,
        5 // Max 5 concurrent processes
      )

      console.log(
        `[OCR Batch] Batch complete: ${batchResult.statistics.successful}/${batchResult.statistics.total} successful`
      )
    } catch (batchError) {
      console.error('[OCR Batch] Batch processing error:', batchError)

      // Clean up uploaded files on error
      for (const file of filesWithKeys) {
        try {
          await storage.deleteFile(file.fileKey)
        } catch (deleteError) {
          console.error(`[OCR Batch] Failed to clean up file ${file.fileKey}:`, deleteError)
        }
      }

      throw new HTTPException(500, {
        message: 'バッチOCR処理中にエラーが発生しました。',
        cause: batchError,
      })
    }

    // Build response with individual results and statistics
    const response = {
      message: `${batchResult.statistics.successful}/${batchResult.statistics.total} 件の注文書を処理しました。`,
      results: batchResult.results.map((result) => ({
        ...result,
        message:
          result.status === 'CONFIRMED'
            ? '注文書の処理が完了しました。'
            : '注文書の処理が完了しましたが、確認が必要な項目があります。',
      })),
      statistics: {
        ...batchResult.statistics,
        failedFiles: uploadedFiles.length - batchResult.statistics.successful,
      },
    }

    return c.json(response, 200)
  } catch (error) {
    // Re-throw HTTP exceptions
    if (error instanceof HTTPException) {
      throw error
    }

    // Handle unexpected errors
    console.error('[OCR Batch] Unexpected error:', error)
    throw new HTTPException(500, {
      message: 'サーバー内部エラーが発生しました。',
      cause: error,
    })
  }
})

export default ocr
