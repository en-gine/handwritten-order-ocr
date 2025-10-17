// src/services/review.service.ts
/**
 * Review Service - Handles manual review and correction of low-confidence orders
 *
 * Workflow:
 * 1. Retrieve orders from review queue
 * 2. Provide original order data with presigned image URLs
 * 3. Accept operator corrections (customer, items, notes)
 * 4. Update Order and OrderItem records
 * 5. Mark items as human_verified
 * 6. Update ReviewQueue status
 * 7. Log audit trail
 */

import type { PrismaClient } from '@prisma/client'
import type { ReviewQueueItem, ReviewUpdateRequest } from '../types/api.js'
import type { OrderResponse } from '../types/ocr.js'
import { createStorage } from '../lib/storage/factory.js'

/**
 * Get paginated list of orders in review queue.
 *
 * @param db - Prisma client (tenant database)
 * @param tenantId - Tenant ID for filtering
 * @param filters - Optional filters (status, flagReason, date range)
 * @param page - Page number (default 1)
 * @param pageSize - Items per page (default 20, max 100)
 * @returns Paginated review queue items
 */
export async function getReviewQueue(
  db: PrismaClient,
  tenantId: string,
  filters?: {
    reviewStatus?: 'pending' | 'in_progress' | 'completed'
    flagReason?: 'low_confidence' | 'unknown_product' | 'unknown_customer'
    startDate?: Date
    endDate?: Date
  },
  page: number = 1,
  pageSize: number = 20
): Promise<{
  items: ReviewQueueItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}> {
  // Clamp page size to max 100
  const limit = Math.min(pageSize, 100)
  const skip = (page - 1) * limit

  // Build where clause
  const where: any = {
    tenantId,
  }

  if (filters?.reviewStatus) {
    where.reviewStatus = filters.reviewStatus
  }

  if (filters?.flagReason) {
    where.flagReason = filters.flagReason
  }

  // Date filters on the related order
  if (filters?.startDate || filters?.endDate) {
    where.order = {}
    if (filters.startDate) {
      where.order.submissionTime = { gte: filters.startDate }
    }
    if (filters.endDate) {
      where.order.submissionTime = { ...where.order.submissionTime, lte: filters.endDate }
    }
  }

  // Query review queue with order details
  const [reviews, total] = await Promise.all([
    db.reviewQueue.findMany({
      where,
      include: {
        order: {
          include: {
            items: {
              include: {
                product: true,
              },
            },
            customer: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip,
    }),
    db.reviewQueue.count({ where }),
  ])

  // Transform to ReviewQueueItem format
  const items: ReviewQueueItem[] = reviews.map((review) => ({
    orderId: review.orderId,
    customerId: review.order.customerId,
    customerName: review.order.customer?.name || null,
    overallConfidence: review.order.overallConfidence,
    flagReason: review.flagReason as any,
    reviewStatus: review.reviewStatus as any,
    assignedOperator: review.assignedOperator,
    items: review.order.items.map((item) => ({
      extractedProductText: item.extractedProductText,
      productId: item.productId,
      productName: item.product?.productName || undefined,
      quantity: item.quantity,
      unitOfMeasure: item.unitOfMeasure || undefined,
      confidence: item.confidence,
      verificationStatus: item.verificationStatus as any,
      humanCorrectedProduct: item.humanCorrectedProduct || undefined,
    })),
    createdAt: review.createdAt,
    reviewedAt: review.reviewedAt || undefined,
  }))

  return {
    items,
    total,
    page,
    pageSize: limit,
    hasMore: skip + limit < total,
  }
}

/**
 * Get single order from review queue with presigned image URL.
 *
 * Includes concurrent review prevention (T056c) and draft loading (T056e).
 *
 * @param db - Prisma client (tenant database)
 * @param orderId - Order ID to retrieve
 * @param tenantId - Tenant ID for filtering
 * @param operatorId - Current operator ID (for concurrent review check)
 * @param expiresIn - Presigned URL expiry in seconds (default 3600 = 1 hour)
 * @returns Review queue item with presigned URL and draft data
 * @throws Error if order not found, not in review queue, or being reviewed by another operator
 */
export async function getReviewItem(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  operatorId: string,
  expiresIn: number = 3600
): Promise<ReviewQueueItem & { imageUrl: string; draft?: any; lastSavedAt?: Date }> {
  // Query review queue for this order
  const review = await db.reviewQueue.findFirst({
    where: {
      orderId,
      tenantId,
    },
    include: {
      order: {
        include: {
          items: {
            include: {
              product: true,
            },
          },
          customer: true,
        },
      },
    },
  })

  if (!review) {
    throw new Error(`注文 ${orderId} はレビューキューに存在しません。`)
  }

  // T056c: Concurrent review prevention
  // Check if order is already being reviewed by another operator
  if (
    review.reviewStatus === 'in_progress' &&
    review.assignedOperator &&
    review.assignedOperator !== operatorId
  ) {
    throw new Error(
      `この注文は現在 ${review.assignedOperator} によってレビュー中です。同時に複数のオペレーターがレビューすることはできません。`
    )
  }

  // Generate presigned URL for original order image
  const storage = createStorage()
  const imageUrl = await storage.generatePresignedUrl(
    tenantId,
    review.order.fileKey,
    expiresIn
  )

  // T056e: Load draft data if available
  let draft: any = undefined
  if (review.draftCustomerCorrection || review.draftItemCorrections || review.draftReviewNotes) {
    draft = {
      customerCorrection: review.draftCustomerCorrection
        ? JSON.parse(review.draftCustomerCorrection)
        : undefined,
      itemCorrections: review.draftItemCorrections
        ? JSON.parse(review.draftItemCorrections)
        : undefined,
      reviewNotes: review.draftReviewNotes || undefined,
    }
  }

  // Transform to ReviewQueueItem with imageUrl and draft
  return {
    orderId: review.orderId,
    customerId: review.order.customerId,
    customerName: review.order.customer?.name || null,
    overallConfidence: review.order.overallConfidence,
    flagReason: review.flagReason as any,
    reviewStatus: review.reviewStatus as any,
    assignedOperator: review.assignedOperator,
    imageUrl,
    items: review.order.items.map((item) => ({
      extractedProductText: item.extractedProductText,
      productId: item.productId,
      productName: item.product?.productName || undefined,
      quantity: item.quantity,
      unitOfMeasure: item.unitOfMeasure || undefined,
      confidence: item.confidence,
      verificationStatus: item.verificationStatus as any,
      humanCorrectedProduct: item.humanCorrectedProduct || undefined,
    })),
    createdAt: review.createdAt,
    reviewedAt: review.reviewedAt || undefined,
    // T056e & T056f: Return draft data and last saved timestamp
    draft,
    lastSavedAt: review.lastActivityAt || undefined,
  }
}

/**
 * Apply operator corrections to order and mark as reviewed.
 *
 * @param db - Prisma client (tenant database)
 * @param orderId - Order ID to update
 * @param tenantId - Tenant ID for filtering
 * @param corrections - Operator corrections
 * @param operatorId - ID of operator performing review
 * @returns Updated order response
 * @throws Error if order not found or not in review queue
 */
export async function applyReviewCorrections(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  corrections: ReviewUpdateRequest,
  operatorId: string
): Promise<OrderResponse> {
  // Verify order is in review queue
  const review = await db.reviewQueue.findFirst({
    where: {
      orderId,
      tenantId,
    },
    include: {
      order: {
        include: {
          items: {
            include: {
              product: true,
            },
          },
          customer: true,
        },
      },
    },
  })

  if (!review) {
    throw new Error(`注文 ${orderId} はレビューキューに存在しません。`)
  }

  // Determine final status based on action
  const finalStatus = corrections.action === 'approve' ? 'CONFIRMED' : 'REJECTED'

  // Start transaction to update order, items, and review queue
  const result = await db.$transaction(async (tx) => {
    // Update order with customer correction if provided
    const orderUpdateData: any = {
      status: finalStatus,
      flaggedForReview: false,
    }

    if (corrections.customerCorrection) {
      orderUpdateData.customerId = corrections.customerCorrection.customerId
    }

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: orderUpdateData,
      include: {
        items: true,
        customer: true,
      },
    })

    // Apply item corrections if provided
    if (corrections.itemCorrections && corrections.itemCorrections.length > 0) {
      for (const itemCorrection of corrections.itemCorrections) {
        const item = updatedOrder.items[itemCorrection.itemIndex]

        if (!item) {
          console.warn(
            `[Review] Item index ${itemCorrection.itemIndex} not found in order ${orderId}`
          )
          continue
        }

        // Update item with corrections
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            productId: itemCorrection.productId,
            quantity: itemCorrection.quantity !== undefined ? itemCorrection.quantity : item.quantity,
            unitOfMeasure: itemCorrection.unitOfMeasure || item.unitOfMeasure,
            verificationStatus: 'human_verified',
            humanCorrectedProduct: itemCorrection.productId !== item.productId ? itemCorrection.productId : undefined,
          },
        })
      }
    }

    // Update review queue status
    await tx.reviewQueue.update({
      where: { id: review.id },
      data: {
        reviewStatus: 'completed',
        assignedOperator: operatorId,
        reviewedAt: new Date(),
        reviewNotes: corrections.reviewNotes,
      },
    })

    // Fetch updated order with all items
    return await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        customer: true,
      },
    })
  })

  if (!result) {
    throw new Error(`注文 ${orderId} の更新に失敗しました。`)
  }

  console.log(
    `[Review] Order ${orderId} reviewed by ${operatorId}, status: ${finalStatus}`
  )

  // Build OrderResponse
  return {
    orderId: result.id,
    status: result.status as any,
    overallConfidence: result.overallConfidence,
    customer: result.customer
      ? {
          customerIdentifier: result.customer.name,
          confidence: 1.0, // Human verified
          additionalInfo: {
            customerId: result.customerId || '',
            customerCode: result.customer.customerCode,
          },
        }
      : null,
    items: result.items.map((item) => ({
      extractedProductText: item.extractedProductText,
      productId: item.productId,
      productName: item.product?.productName || undefined,
      quantity: item.quantity,
      unitOfMeasure: item.unitOfMeasure || undefined,
      confidence: item.verificationStatus === 'human_verified' ? 1.0 : item.confidence,
      verificationStatus: item.verificationStatus as any,
      humanCorrectedProduct: item.humanCorrectedProduct || undefined,
    })),
    flaggedForReview: result.flaggedForReview,
    flagReason: undefined,
    submissionTime: result.submissionTime,
    processingTime: 0, // Not tracked for reviews
    fileKey: result.fileKey,
  }
}

/**
 * Save draft corrections for auto-save functionality (T056b).
 *
 * Allows operators to save partial corrections every 30 seconds without finalizing the review.
 * Draft data is stored in JSON format in ReviewQueue fields.
 *
 * @param db - Prisma client (tenant database)
 * @param orderId - Order ID to save draft for
 * @param tenantId - Tenant ID for filtering
 * @param draftData - Partial corrections to save
 * @param operatorId - ID of operator saving draft
 * @returns Updated review queue item with lastActivityAt timestamp
 * @throws Error if order not found or not in review queue
 */
export async function saveDraftCorrections(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  draftData: {
    customerCorrection?: { customerId: string; customerName?: string }
    itemCorrections?: Array<{
      itemIndex: number
      productId: string
      quantity?: number
      unitOfMeasure?: string
    }>
    reviewNotes?: string
  },
  operatorId: string
): Promise<{
  orderId: string
  lastSavedAt: Date
  reviewStatus: string
}> {
  // Verify order is in review queue
  const review = await db.reviewQueue.findFirst({
    where: {
      orderId,
      tenantId,
    },
  })

  if (!review) {
    throw new Error(`注文 ${orderId} はレビューキューに存在しません。`)
  }

  // Update review queue with draft data
  const now = new Date()
  const updated = await db.reviewQueue.update({
    where: { id: review.id },
    data: {
      draftCustomerCorrection: draftData.customerCorrection
        ? JSON.stringify(draftData.customerCorrection)
        : review.draftCustomerCorrection,
      draftItemCorrections: draftData.itemCorrections
        ? JSON.stringify(draftData.itemCorrections)
        : review.draftItemCorrections,
      draftReviewNotes: draftData.reviewNotes !== undefined
        ? draftData.reviewNotes
        : review.draftReviewNotes,
      lastActivityAt: now,
      // Automatically set status to in_progress if currently pending
      reviewStatus: review.reviewStatus === 'pending' ? 'in_progress' : review.reviewStatus,
      // Assign operator if not already assigned
      assignedOperator: review.assignedOperator || operatorId,
    },
  })

  console.log(
    `[Review Draft] Order ${orderId} draft saved by ${operatorId} at ${now.toISOString()}`
  )

  return {
    orderId: updated.orderId,
    lastSavedAt: updated.lastActivityAt!,
    reviewStatus: updated.reviewStatus,
  }
}

