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
 * @param db - Prisma client (tenant database)
 * @param orderId - Order ID to retrieve
 * @param tenantId - Tenant ID for filtering
 * @param expiresIn - Presigned URL expiry in seconds (default 3600 = 1 hour)
 * @returns Review queue item with presigned URL
 * @throws Error if order not found or not in review queue
 */
export async function getReviewItem(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  expiresIn: number = 3600
): Promise<ReviewQueueItem & { imageUrl: string }> {
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

  // Generate presigned URL for original order image
  const storage = createStorage()
  const imageUrl = await storage.generatePresignedUrl(
    tenantId,
    review.order.fileKey,
    expiresIn
  )

  // Transform to ReviewQueueItem with imageUrl
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
