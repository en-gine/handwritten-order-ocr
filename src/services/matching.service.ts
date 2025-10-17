// src/services/matching.service.ts
/**
 * Product and Customer Matching Service
 *
 * Matches extracted text against master databases:
 * - Fuzzy matching for product names
 * - Exact and fuzzy matching for customer names/codes
 * - Vector similarity search for semantic matching
 */

import type { PrismaClient } from '@prisma/client';
import type { ProductMatch, CustomerMatch } from '../types/ocr.js';
import { createGeminiClient } from '../lib/gemini.js';
import { blobToVector, cosineSimilarity } from '../lib/vectors.js';

/**
 * Calculate Levenshtein distance between two strings.
 * Used for fuzzy text matching.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (lower = more similar)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0-1).
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (1 = identical, 0 = completely different)
 */
function similarityScore(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);

  if (maxLength === 0) return 1.0;

  return 1 - distance / maxLength;
}

/**
 * Match extracted product text against product master database.
 *
 * Matching strategy:
 * 1. Try exact match on product code
 * 2. Try exact match on product name
 * 3. Try fuzzy match on product name
 * 4. Check name variations (if available)
 *
 * @param db - Prisma client (tenant database)
 * @param extractedText - Product text from OCR
 * @param tenantId - Tenant ID for filtering
 * @returns Product match result with confidence
 */
export async function matchProduct(
  db: PrismaClient,
  extractedText: string,
  tenantId: string
): Promise<ProductMatch> {
  const normalizedText = extractedText.trim().toLowerCase();

  // Fetch all active products for this tenant
  const products = await db.product.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      productCode: true,
      productName: true,
      nameVariations: true,
    },
  });

  if (products.length === 0) {
    return {
      productId: null,
      productName: null,
      productCode: null,
      confidence: 0,
      usedSemanticSearch: false,
    };
  }

  let bestMatch: {
    product: typeof products[0];
    confidence: number;
    matchType: 'exact_code' | 'exact_name' | 'fuzzy_name' | 'variation';
  } | null = null;

  for (const product of products) {
    // Try exact match on product code
    if (product.productCode.toLowerCase() === normalizedText) {
      bestMatch = {
        product,
        confidence: 0.99,
        matchType: 'exact_code',
      };
      break; // Exact code match - stop searching
    }

    // Try exact match on product name
    if (product.productName.toLowerCase() === normalizedText) {
      if (!bestMatch || bestMatch.confidence < 0.95) {
        bestMatch = {
          product,
          confidence: 0.95,
          matchType: 'exact_name',
        };
      }
      continue;
    }

    // Try name variations
    if (product.nameVariations) {
      try {
        const variations = JSON.parse(product.nameVariations) as string[];
        for (const variation of variations) {
          if (variation.toLowerCase() === normalizedText) {
            if (!bestMatch || bestMatch.confidence < 0.92) {
              bestMatch = {
                product,
                confidence: 0.92,
                matchType: 'variation',
              };
            }
            break;
          }
        }
      } catch (e) {
        // Invalid JSON in nameVariations - skip
      }
    }

    // Fuzzy match on product name
    const similarity = similarityScore(normalizedText, product.productName);
    if (similarity >= 0.75) {
      // Threshold: 75% similarity
      if (!bestMatch || similarity > bestMatch.confidence) {
        bestMatch = {
          product,
          confidence: similarity,
          matchType: 'fuzzy_name',
        };
      }
    }
  }

  if (!bestMatch) {
    // No match found
    return {
      productId: null,
      productName: null,
      productCode: null,
      confidence: 0,
      usedSemanticSearch: false,
    };
  }

  return {
    productId: bestMatch.product.id,
    productName: bestMatch.product.productName,
    productCode: bestMatch.product.productCode,
    confidence: bestMatch.confidence,
    usedSemanticSearch: false,
  };
}

/**
 * Match extracted customer text against customer master database.
 *
 * Matching strategy:
 * 1. Try exact match on customer code
 * 2. Try exact match on customer name
 * 3. Try fuzzy match on customer name
 * 4. Check name variations
 *
 * @param db - Prisma client (tenant database)
 * @param extractedText - Customer text from OCR
 * @param tenantId - Tenant ID for filtering
 * @returns Customer match result with suggestions
 */
export async function matchCustomer(
  db: PrismaClient,
  extractedText: string,
  tenantId: string
): Promise<CustomerMatch> {
  const normalizedText = extractedText.trim().toLowerCase();

  // Fetch all active customers for this tenant
  const customers = await db.customer.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      customerCode: true,
      name: true,
      nameVariations: true,
    },
  });

  if (customers.length === 0) {
    return {
      customerId: null,
      customerName: null,
      customerCode: null,
      confidence: 0,
      suggestions: [],
    };
  }

  const matches: Array<{
    customer: typeof customers[0];
    confidence: number;
    matchType: string;
  }> = [];

  for (const customer of customers) {
    // Try exact match on customer code
    if (customer.customerCode.toLowerCase() === normalizedText) {
      matches.push({
        customer,
        confidence: 0.99,
        matchType: 'exact_code',
      });
      continue;
    }

    // Try exact match on name
    if (customer.name.toLowerCase() === normalizedText) {
      matches.push({
        customer,
        confidence: 0.95,
        matchType: 'exact_name',
      });
      continue;
    }

    // Try name variations
    if (customer.nameVariations) {
      try {
        const variations = JSON.parse(customer.nameVariations) as string[];
        for (const variation of variations) {
          if (variation.toLowerCase() === normalizedText) {
            matches.push({
              customer,
              confidence: 0.92,
              matchType: 'variation',
            });
            break;
          }
        }
      } catch (e) {
        // Invalid JSON - skip
      }
    }

    // Fuzzy match on name
    const similarity = similarityScore(normalizedText, customer.name);
    if (similarity >= 0.70) {
      matches.push({
        customer,
        confidence: similarity,
        matchType: 'fuzzy_name',
      });
    }
  }

  // Sort matches by confidence (descending)
  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      customerId: null,
      customerName: null,
      customerCode: null,
      confidence: 0,
      suggestions: [],
    };
  }

  // Best match
  const bestMatch = matches[0];

  // Top 3 suggestions (for low confidence scenarios)
  const suggestions = matches.slice(0, 3).map((match) => ({
    customerId: match.customer.id,
    customerName: match.customer.name,
    customerCode: match.customer.customerCode,
    confidence: match.confidence,
  }));

  return {
    customerId: bestMatch.customer.id,
    customerName: bestMatch.customer.name,
    customerCode: bestMatch.customer.customerCode,
    confidence: bestMatch.confidence,
    suggestions: bestMatch.confidence < 0.85 ? suggestions : undefined,
  };
}

// ============================================================================
// Vector Similarity Search (T080, T082)
// ============================================================================

/**
 * Match product using vector similarity search
 *
 * When fuzzy matching confidence is low (<60%), use semantic similarity
 * to find products with similar meanings even if text doesn't match well.
 *
 * @param db - Prisma client (tenant database)
 * @param extractedText - Product text from OCR
 * @param tenantId - Tenant ID for filtering
 * @param topK - Number of top results to return (default: 5)
 * @returns Top K products ranked by semantic similarity
 */
export async function matchProductBySemantic(
  db: PrismaClient,
  extractedText: string,
  tenantId: string,
  topK: number = 5
): Promise<Array<ProductMatch & { semanticSimilarity: number }>> {
  try {
    // Generate embedding for extracted text
    const gemini = createGeminiClient();
    const queryEmbedding = await gemini.generateEmbedding(extractedText);
    const queryVector = new Float32Array(queryEmbedding);

    // Fetch all products with embeddings (using raw SQL)
    // Note: Turso's DiskANN vector_top_k would be ideal here, but we'll use
    // application-side similarity calculation for now
    const products: any[] = await db.$queryRaw`
      SELECT id, productCode, productName, embedding
      FROM products
      WHERE tenantId = ${tenantId}
        AND isActive = 1
        AND embedding IS NOT NULL
    `;

    if (products.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const results = products
      .map((product) => {
        const productVector = blobToVector(product.embedding);
        const similarity = cosineSimilarity(queryVector, productVector);

        return {
          productId: product.id,
          productName: product.productName,
          productCode: product.productCode,
          confidence: similarity, // Cosine similarity is already 0-1
          semanticSimilarity: similarity,
          usedSemanticSearch: true,
        };
      })
      .sort((a, b) => b.semanticSimilarity - a.semanticSimilarity)
      .slice(0, topK);

    return results;
  } catch (error) {
    console.error('[Matching] Vector similarity search failed:', error);
    // Fall back to empty results if vector search fails
    return [];
  }
}

/**
 * Enhanced product matching with vector fallback (T082)
 *
 * Strategy:
 * 1. Try fuzzy matching first (fast, accurate for clear text)
 * 2. If confidence < 60%, use vector similarity (handles unclear text)
 * 3. Return best match from either method
 *
 * @param db - Prisma client
 * @param extractedText - Product text from OCR
 * @param tenantId - Tenant ID
 * @returns Best product match with confidence
 */
export async function matchProductEnhanced(
  db: PrismaClient,
  extractedText: string,
  tenantId: string
): Promise<ProductMatch> {
  // Step 1: Try fuzzy matching first
  const fuzzyMatch = await matchProduct(db, extractedText, tenantId);

  // If fuzzy match has good confidence, return it
  if (fuzzyMatch.confidence >= 0.6) {
    console.log(
      `[Matching] Fuzzy match succeeded: ${fuzzyMatch.productName} (${(fuzzyMatch.confidence * 100).toFixed(0)}%)`
    );
    return fuzzyMatch;
  }

  // Step 2: Try vector similarity search
  console.log(
    `[Matching] Fuzzy match confidence low (${(fuzzyMatch.confidence * 100).toFixed(0)}%), trying semantic search...`
  );

  const semanticMatches = await matchProductBySemantic(db, extractedText, tenantId, 3);

  if (semanticMatches.length === 0) {
    // No semantic matches, return fuzzy match (even if low confidence)
    return fuzzyMatch;
  }

  // Compare fuzzy vs semantic matches
  const bestSemantic = semanticMatches[0];

  if (bestSemantic.semanticSimilarity > fuzzyMatch.confidence) {
    console.log(
      `[Matching] Semantic match better: ${bestSemantic.productName} (${(bestSemantic.semanticSimilarity * 100).toFixed(0)}% vs ${(fuzzyMatch.confidence * 100).toFixed(0)}%)`
    );
    return bestSemantic;
  }

  // Fuzzy match still better
  return fuzzyMatch;
}
