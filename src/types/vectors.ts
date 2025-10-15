// src/types/vectors.ts

import { Product, CustomerContext, OrderHistory } from '@prisma/client'

/**
 * Type extensions for Prisma models with vector embedding support.
 *
 * Since Prisma doesn't natively support libSQL's F32_BLOB type, these extended types
 * add the embedding field as Float32Array for use in application code.
 *
 * The embedding field is stored in the database as F32_BLOB(768) via raw SQL,
 * but converted to/from Float32Array using utilities in src/lib/vectors.ts.
 */

/**
 * Product model extended with vector embedding support.
 *
 * The embedding is a 768-dimensional vector generated from the product name
 * using Gemini text-embedding-004 model for semantic product matching.
 *
 * @example
 * ```typescript
 * import { blobToVector, vectorToBlob } from '../lib/vectors'
 *
 * // Fetch product with embedding from database
 * const product = await prisma.$queryRaw<ProductWithEmbedding[]>`
 *   SELECT * FROM products WHERE id = ${id}
 * `
 *
 * // Convert blob to Float32Array for calculations
 * if (product[0].embedding) {
 *   const vector = blobToVector(product[0].embedding as any as Buffer)
 *   // Use vector for similarity search
 * }
 * ```
 */
export type ProductWithEmbedding = Product & {
  embedding?: Float32Array // 768-dimensional vector for semantic matching
}

/**
 * CustomerContext model extended with vector embedding support.
 *
 * The embedding represents learned customer ordering patterns and preferences,
 * used for disambiguating references like "いつもの" (the usual order).
 *
 * @example
 * ```typescript
 * // Store customer context with embedding
 * const embedding = await generateEmbedding(contextText)
 * await prisma.$executeRaw`
 *   UPDATE customer_context
 *   SET embedding = ${vectorToBlob(embedding)}
 *   WHERE id = ${contextId}
 * `
 * ```
 */
export type CustomerContextWithEmbedding = CustomerContext & {
  embedding?: Float32Array // 768-dimensional vector for pattern matching
}

/**
 * OrderHistory model extended with vector embedding support.
 *
 * The embedding represents the complete order (product combination) for
 * finding similar historical orders and detecting "usual order" patterns.
 *
 * @example
 * ```typescript
 * // Find similar historical orders using vector similarity
 * const queryVector = await generateOrderEmbedding(currentOrder)
 * const similarOrders = await prisma.$queryRaw<OrderHistoryWithEmbedding[]>`
 *   SELECT *,
 *          vector_distance_cos(embedding, vector32(${vectorToBlob(queryVector)})) as similarity
 *   FROM order_history
 *   WHERE tenantId = ${tenantId}
 *     AND customerId = ${customerId}
 *   ORDER BY similarity DESC
 *   LIMIT 10
 * `
 * ```
 */
export type OrderHistoryWithEmbedding = OrderHistory & {
  embedding?: Float32Array // 768-dimensional vector for order similarity
}

/**
 * Re-export vector utility functions for convenience.
 * These functions handle conversion between Float32Array and Buffer (F32_BLOB).
 */
export { vectorToBlob, blobToVector } from '../lib/vectors.js'

/**
 * Type guard to check if a product has an embedding.
 *
 * @param product - Product or ProductWithEmbedding
 * @returns true if product has a valid embedding
 */
export function hasEmbedding(
  product: Product | ProductWithEmbedding
): product is ProductWithEmbedding {
  return 'embedding' in product && product.embedding !== undefined
}

/**
 * Type guard to check if customer context has an embedding.
 *
 * @param context - CustomerContext or CustomerContextWithEmbedding
 * @returns true if context has a valid embedding
 */
export function hasContextEmbedding(
  context: CustomerContext | CustomerContextWithEmbedding
): context is CustomerContextWithEmbedding {
  return 'embedding' in context && context.embedding !== undefined
}

/**
 * Type guard to check if order history has an embedding.
 *
 * @param history - OrderHistory or OrderHistoryWithEmbedding
 * @returns true if history has a valid embedding
 */
export function hasHistoryEmbedding(
  history: OrderHistory | OrderHistoryWithEmbedding
): history is OrderHistoryWithEmbedding {
  return 'embedding' in history && history.embedding !== undefined
}
