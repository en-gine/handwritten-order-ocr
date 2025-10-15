// src/lib/vectors.ts

/**
 * Vector embedding utilities for converting between Float32Array and Buffer (F32_BLOB).
 *
 * Used for storing and retrieving 768-dimensional embeddings in Turso database.
 * Turso stores vectors as F32_BLOB, but JavaScript works with Float32Array.
 */

/**
 * Standard vector dimension for Gemini text-embedding-004 model
 */
export const VECTOR_DIMENSION = 768

/**
 * Convert Float32Array vector to Buffer for database storage.
 *
 * @param vector - 768-dimensional Float32Array vector
 * @returns Buffer containing the raw float32 data
 *
 * @example
 * ```typescript
 * const embedding = new Float32Array(768)
 * const blob = vectorToBlob(embedding)
 * await prisma.$executeRaw`INSERT INTO products (embedding) VALUES (${blob})`
 * ```
 */
export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer)
}

/**
 * Convert Buffer from database to Float32Array for vector operations.
 *
 * @param blob - Buffer containing F32_BLOB data from database
 * @returns Float32Array (768 dimensions) for vector calculations
 *
 * @example
 * ```typescript
 * const row = await prisma.$queryRaw`SELECT embedding FROM products WHERE id = ${id}`
 * const vector = blobToVector(row.embedding)
 * // Now can use vector for similarity calculations
 * ```
 */
export function blobToVector(blob: Buffer): Float32Array {
  // Use byteOffset and byteLength to handle Buffer's internal structure correctly
  // This ensures proper alignment when creating Float32Array view
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}

/**
 * Validate that a vector has the correct dimensions.
 *
 * @param vector - Float32Array to validate
 * @param expectedDimension - Expected vector dimension (default: 768)
 * @returns true if valid, false otherwise
 */
export function isValidVector(
  vector: Float32Array,
  expectedDimension: number = VECTOR_DIMENSION
): boolean {
  return vector.length === expectedDimension
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 (opposite) and 1 (identical).
 *
 * @param vectorA - First vector
 * @param vectorB - Second vector
 * @returns Cosine similarity score
 *
 * @throws Error if vectors have different dimensions
 */
export function cosineSimilarity(vectorA: Float32Array, vectorB: Float32Array): number {
  if (vectorA.length !== vectorB.length) {
    throw new Error(
      `Vector dimensions must match: ${vectorA.length} !== ${vectorB.length}`
    )
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i]
    normA += vectorA[i] * vectorA[i]
    normB += vectorB[i] * vectorB[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)

  // Avoid division by zero
  if (magnitude === 0) {
    return 0
  }

  return dotProduct / magnitude
}

/**
 * Normalize a vector to unit length (L2 normalization).
 * Useful before storing embeddings for cosine similarity search.
 *
 * @param vector - Vector to normalize
 * @returns Normalized vector
 */
export function normalizeVector(vector: Float32Array): Float32Array {
  let squareSum = 0

  for (let i = 0; i < vector.length; i++) {
    squareSum += vector[i] * vector[i]
  }

  const magnitude = Math.sqrt(squareSum)

  // Avoid division by zero
  if (magnitude === 0) {
    return vector
  }

  const normalized = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / magnitude
  }

  return normalized
}

/**
 * Create a zero vector with specified dimensions.
 *
 * @param dimension - Vector dimension (default: 768)
 * @returns Zero-initialized Float32Array
 */
export function createZeroVector(dimension: number = VECTOR_DIMENSION): Float32Array {
  return new Float32Array(dimension)
}

/**
 * Check if a vector is a zero vector (all elements are 0).
 *
 * @param vector - Vector to check
 * @returns true if all elements are 0
 */
export function isZeroVector(vector: Float32Array): boolean {
  for (let i = 0; i < vector.length; i++) {
    if (vector[i] !== 0) {
      return false
    }
  }
  return true
}
