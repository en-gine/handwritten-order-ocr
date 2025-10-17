// src/services/ocr.service.ts
/**
 * OCR Service - Orchestrates handwritten order form processing
 *
 * Workflow:
 * 1. Receive uploaded file
 * 2. Send to Gemini API for OCR extraction
 * 3. Parse extracted data
 * 4. Match customer and products against master databases
 * 5. Calculate confidence scores
 * 6. Create Order record
 * 7. Flag for review if confidence below threshold
 * 8. Return structured response
 */

import type { PrismaClient } from '@prisma/client';
import type { OrderResponse, ExtractedCustomer, OrderItem } from '../types/ocr.js';
import { GeminiClient, PromptTemplates } from '../lib/gemini.js';
import { matchProduct, matchCustomer } from './matching.service.js';
import {
  calculateOverallConfidence,
  meetsThreshold,
  determineFlagReason,
} from './confidence.service.js';

/**
 * Parsed OCR extraction result from Gemini.
 */
interface GeminiOCRResult {
  customer: string;
  items: Array<{
    product: string;
    quantity: number;
    unit?: string;
  }>;
}

/**
 * Process uploaded order form through OCR pipeline.
 *
 * @param db - Prisma client (tenant database)
 * @param geminiClient - Gemini API client
 * @param fileBuffer - Uploaded file buffer
 * @param fileName - Original file name
 * @param mimeType - File MIME type
 * @param fileKey - Storage key for uploaded file
 * @param tenantId - Tenant ID
 * @param confidenceThreshold - Confidence threshold (default 0.70)
 * @returns Order response with processing results
 */
export async function processOrderForm(
  db: PrismaClient,
  geminiClient: GeminiClient,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  fileKey: string,
  tenantId: string,
  confidenceThreshold: number = 0.7
): Promise<OrderResponse> {
  const startTime = Date.now();

  try {
    // Step 1: Send to Gemini for OCR extraction
    console.log(`[OCR] Processing file: ${fileName} (${fileBuffer.length} bytes)`);
    const geminiResult = await geminiClient.generateContentWithImage(
      PromptTemplates.orderFormOCR(),
      fileBuffer,
      mimeType,
      {
        temperature: 0.1, // Low temperature for consistent extraction
        maxOutputTokens: 2048,
      }
    );

    // Step 2: Parse Gemini response
    const rawResponse = geminiResult.response.text();
    console.log(`[OCR] Gemini raw response:`, rawResponse);

    let extractedData: GeminiOCRResult;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                        rawResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawResponse;
      extractedData = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[OCR] Failed to parse Gemini response:', parseError);
      throw new Error('OCRレスポンスの解析に失敗しました。注文書の形式を確認してください。');
    }

    // Step 3: Match customer
    const customerMatch = await matchCustomer(db, extractedData.customer, tenantId);
    console.log(`[OCR] Customer match:`, customerMatch);

    const extractedCustomer: ExtractedCustomer = {
      customerIdentifier: extractedData.customer,
      confidence: customerMatch.confidence,
      additionalInfo: customerMatch.customerId
        ? {
            customerId: customerMatch.customerId,
            customerCode: customerMatch.customerCode || '',
          }
        : undefined,
    };

    // Step 4: Match products and build order items
    const orderItems: OrderItem[] = [];
    for (const item of extractedData.items) {
      const productMatch = await matchProduct(db, item.product, tenantId);
      console.log(`[OCR] Product match for "${item.product}":`, productMatch);

      orderItems.push({
        extractedProductText: item.product,
        productId: productMatch.productId,
        productName: productMatch.productName || undefined,
        quantity: item.quantity,
        unitOfMeasure: item.unit,
        confidence: productMatch.confidence,
        verificationStatus: 'unverified',
      });
    }

    // Step 5: Calculate confidence scores
    const overallConfidence = calculateOverallConfidence(customerMatch.confidence, orderItems);
    const meetsConfidenceThreshold = meetsThreshold(overallConfidence, confidenceThreshold);

    console.log(`[OCR] Overall confidence: ${overallConfidence} (threshold: ${confidenceThreshold})`);

    // Step 6: Determine status and flag reason
    const flagReason = determineFlagReason(
      customerMatch.confidence,
      orderItems,
      customerMatch.customerId !== null
    );

    const status = meetsConfidenceThreshold ? 'CONFIRMED' : 'REVIEWING';
    const flaggedForReview = !meetsConfidenceThreshold;

    console.log(`[OCR] Status: ${status}, Flagged: ${flaggedForReview}, Reason: ${flagReason}`);

    // Step 7: Create Order record in database
    const order = await db.order.create({
      data: {
        tenantId,
        customerId: customerMatch.customerId,
        status,
        overallConfidence,
        fileKey,
        fileContentType: mimeType,
        fileSize: fileBuffer.length,
        flaggedForReview,
        processingResult: JSON.stringify({
          geminiResponse: rawResponse,
          extractedData,
        }),
        items: {
          create: orderItems.map((item) => ({
            productId: item.productId,
            extractedProductText: item.extractedProductText,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
            confidence: item.confidence,
            verificationStatus: item.verificationStatus,
          })),
        },
      },
      include: {
        items: true,
        customer: true,
      },
    });

    console.log(`[OCR] Order created: ${order.id}`);

    // Step 8: Create ReviewQueue record if flagged
    if (flaggedForReview && flagReason) {
      await db.reviewQueue.create({
        data: {
          orderId: order.id,
          tenantId,
          flagReason,
          reviewStatus: 'pending',
        },
      });
      console.log(`[OCR] Added to review queue: ${flagReason}`);
    }

    // Step 9: Save ProcessingResult for audit
    await db.processingResult.create({
      data: {
        orderId: order.id,
        tenantId,
        modelName: process.env.DEFAULT_AI_MODEL || 'gemini-2.0-flash-exp',
        extractedFields: JSON.stringify({
          customer: extractedCustomer,
          items: orderItems,
        }),
        confidenceScores: JSON.stringify({
          overall: overallConfidence,
          customer: customerMatch.confidence,
          items: orderItems.map((item) => item.confidence),
        }),
        rawResponse,
        processingTime: Date.now() - startTime,
      },
    });

    // Step 10: Build and return response
    const processingTime = Date.now() - startTime;

    return {
      orderId: order.id,
      status: order.status as any,
      overallConfidence,
      customer: extractedCustomer,
      items: orderItems,
      flaggedForReview,
      flagReason: flagReason || undefined,
      submissionTime: order.submissionTime,
      processingTime,
      fileKey,
    };
  } catch (error) {
    console.error('[OCR] Processing error:', error);
    throw error;
  }
}

/**
 * Process multiple order forms in batch with concurrency control.
 *
 * @param db - Prisma client
 * @param geminiClient - Gemini API client
 * @param files - Array of uploaded files
 * @param tenantId - Tenant ID
 * @param confidenceThreshold - Confidence threshold
 * @param maxConcurrency - Maximum concurrent processes (default 5)
 * @returns Array of order responses with aggregate statistics
 */
export async function processBatchOrderForms(
  db: PrismaClient,
  geminiClient: GeminiClient,
  files: Array<{
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    fileKey: string;
  }>,
  tenantId: string,
  confidenceThreshold: number = 0.7,
  maxConcurrency: number = 5
): Promise<{
  results: OrderResponse[];
  statistics: {
    total: number;
    successful: number;
    failed: number;
    averageConfidence: number;
    totalProcessingTime: number;
  };
}> {
  const results: OrderResponse[] = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  let totalConfidence = 0;
  const totalStartTime = Date.now();

  // Process files in batches with concurrency control
  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);

    const batchResults = await Promise.allSettled(
      batch.map((file) =>
        processOrderForm(
          db,
          geminiClient,
          file.buffer,
          file.fileName,
          file.mimeType,
          file.fileKey,
          tenantId,
          confidenceThreshold
        )
      )
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const file = batch[j];

      if (result.status === 'fulfilled') {
        results.push(result.value);
        totalConfidence += result.value.overallConfidence;
      } else {
        errors.push({
          fileName: file.fileName,
          error: result.reason?.message || '不明なエラー',
        });
      }
    }
  }

  const totalProcessingTime = Date.now() - totalStartTime;

  return {
    results,
    statistics: {
      total: files.length,
      successful: results.length,
      failed: errors.length,
      averageConfidence: results.length > 0 ? totalConfidence / results.length : 0,
      totalProcessingTime,
    },
  };
}
