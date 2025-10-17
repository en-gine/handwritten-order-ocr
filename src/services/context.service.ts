// src/services/context.service.ts
/**
 * Context-Aware Recognition Service
 *
 * Leverages customer order history to interpret ambiguous references
 * and improve recognition accuracy through learned patterns.
 *
 * Features:
 * - Detect "いつもの" (the usual) patterns in OCR text
 * - Query customer order history (last 30 days)
 * - Identify frequent product combinations
 * - Return top 3 most common product patterns
 * - Learn abbreviations and custom terminology
 *
 * @module services/context
 */

import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Product suggestion from order history
 */
export interface ProductSuggestion {
  productId: string;
  productCode: string;
  productName: string;
  frequency: number; // How many times ordered in last 30 days
  lastOrderedAt: Date;
  typicalQuantity?: number; // Most common quantity
}

/**
 * Frequent product combination pattern
 */
export interface ProductCombination {
  products: Array<{
    productId: string;
    productCode: string;
    productName: string;
    typicalQuantity: number;
  }>;
  frequency: number; // How many times this combination appeared
  lastOrderedAt: Date;
}

/**
 * Context service result
 */
export interface CustomerContext {
  customerId: string;
  hasHistory: boolean;
  totalOrders: number;
  dateRange: {
    from: Date;
    to: Date;
  };
  frequentProducts: ProductSuggestion[];
  frequentCombinations: ProductCombination[];
  detectedPatterns: {
    isUsualOrder: boolean; // "いつもの" detected
    isSameAsBefore: boolean; // "same as before" detected
    hasAbbreviations: boolean; // Customer-specific abbreviations found
  };
}

// ============================================================================
// "いつもの" Pattern Detection
// ============================================================================

/**
 * Common phrases that indicate "usual order" across languages
 */
const USUAL_ORDER_PATTERNS = [
  // Japanese
  'いつもの',
  'いつも',
  '通常',
  '通常通り',
  'いつもと同じ',
  // English
  'usual',
  'usual order',
  'same as usual',
  'same as before',
  'same as last time',
  'regular order',
  'the usual',
];

/**
 * Detect if extracted text contains "usual order" patterns
 *
 * @param extractedText - Text from OCR (customer section or notes)
 * @returns True if usual order pattern detected
 */
export function detectUsualOrderPattern(extractedText: string): boolean {
  const normalized = extractedText.toLowerCase().trim();

  return USUAL_ORDER_PATTERNS.some((pattern) =>
    normalized.includes(pattern.toLowerCase())
  );
}

// ============================================================================
// Customer Order History Analysis
// ============================================================================

/**
 * Query customer order history and identify patterns
 *
 * Analyzes last 30 days of confirmed orders to find:
 * - Most frequently ordered products
 * - Common product combinations
 * - Typical quantities
 *
 * @param db - Prisma client (tenant database)
 * @param customerId - Customer ID
 * @param tenantId - Tenant ID for filtering
 * @param daysBack - Number of days to look back (default: 30)
 * @returns Customer context with patterns
 */
export async function getCustomerContext(
  db: PrismaClient,
  customerId: string,
  tenantId: string,
  daysBack: number = 30
): Promise<CustomerContext> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  // Fetch customer's recent confirmed orders
  const orders = await db.order.findMany({
    where: {
      tenantId,
      customerId,
      status: 'CONFIRMED',
      submissionTime: {
        gte: startDate,
      },
    },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      submissionTime: 'desc',
    },
  });

  if (orders.length === 0) {
    return {
      customerId,
      hasHistory: false,
      totalOrders: 0,
      dateRange: {
        from: startDate,
        to: new Date(),
      },
      frequentProducts: [],
      frequentCombinations: [],
      detectedPatterns: {
        isUsualOrder: false,
        isSameAsBefore: false,
        hasAbbreviations: false,
      },
    };
  }

  // Analyze product frequencies
  const frequentProducts = analyzeProductFrequency(orders);

  // Analyze product combinations
  const frequentCombinations = analyzeProductCombinations(orders);

  return {
    customerId,
    hasHistory: true,
    totalOrders: orders.length,
    dateRange: {
      from: startDate,
      to: new Date(),
    },
    frequentProducts,
    frequentCombinations,
    detectedPatterns: {
      isUsualOrder: false, // Will be set by caller based on OCR text
      isSameAsBefore: false,
      hasAbbreviations: false,
    },
  };
}

/**
 * Analyze product frequency in order history
 *
 * Counts how many times each product was ordered and calculates
 * typical quantities.
 *
 * @param orders - Customer's confirmed orders
 * @returns Top 10 most frequent products
 */
function analyzeProductFrequency(
  orders: Array<{
    items: Array<{
      productId: string | null;
      quantity: number;
      product: {
        id: string;
        productCode: string;
        productName: string;
      } | null;
    }>;
    submissionTime: Date;
  }>
): ProductSuggestion[] {
  const productStats = new Map<
    string,
    {
      productId: string;
      productCode: string;
      productName: string;
      count: number;
      quantities: number[];
      lastOrderedAt: Date;
    }
  >();

  // Collect product statistics
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.product || !item.productId) continue;

      const existing = productStats.get(item.productId);
      if (existing) {
        existing.count++;
        existing.quantities.push(item.quantity);
        if (order.submissionTime > existing.lastOrderedAt) {
          existing.lastOrderedAt = order.submissionTime;
        }
      } else {
        productStats.set(item.productId, {
          productId: item.productId,
          productCode: item.product.productCode,
          productName: item.product.productName,
          count: 1,
          quantities: [item.quantity],
          lastOrderedAt: order.submissionTime,
        });
      }
    }
  }

  // Convert to suggestions and sort by frequency
  const suggestions: ProductSuggestion[] = Array.from(productStats.values())
    .map((stat) => ({
      productId: stat.productId,
      productCode: stat.productCode,
      productName: stat.productName,
      frequency: stat.count,
      lastOrderedAt: stat.lastOrderedAt,
      typicalQuantity: calculateTypicalQuantity(stat.quantities),
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10); // Top 10

  return suggestions;
}

/**
 * Calculate typical (median) quantity from order history
 *
 * @param quantities - Array of quantities ordered
 * @returns Median quantity
 */
function calculateTypicalQuantity(quantities: number[]): number {
  if (quantities.length === 0) return 1;

  const sorted = [...quantities].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Analyze product combination patterns
 *
 * Identifies sets of products frequently ordered together.
 *
 * @param orders - Customer's confirmed orders
 * @returns Top 3 most frequent combinations
 */
function analyzeProductCombinations(
  orders: Array<{
    items: Array<{
      productId: string | null;
      quantity: number;
      product: {
        id: string;
        productCode: string;
        productName: string;
      } | null;
    }>;
    submissionTime: Date;
  }>
): ProductCombination[] {
  const combinationStats = new Map<
    string,
    {
      productIds: string[];
      products: Map<
        string,
        {
          productId: string;
          productCode: string;
          productName: string;
          quantities: number[];
        }
      >;
      count: number;
      lastOrderedAt: Date;
    }
  >();

  // Collect combination statistics
  for (const order of orders) {
    const validItems = order.items.filter((item) => item.product && item.productId);
    if (validItems.length < 2) continue; // Need at least 2 products for a combination

    // Create combination key (sorted product IDs)
    const productIds = validItems.map((item) => item.productId!).sort();
    const key = productIds.join('|');

    const existing = combinationStats.get(key);
    if (existing) {
      existing.count++;
      if (order.submissionTime > existing.lastOrderedAt) {
        existing.lastOrderedAt = order.submissionTime;
      }
      // Update quantities
      for (const item of validItems) {
        const productStat = existing.products.get(item.productId!);
        if (productStat) {
          productStat.quantities.push(item.quantity);
        }
      }
    } else {
      const products = new Map();
      for (const item of validItems) {
        products.set(item.productId!, {
          productId: item.productId!,
          productCode: item.product!.productCode,
          productName: item.product!.productName,
          quantities: [item.quantity],
        });
      }
      combinationStats.set(key, {
        productIds,
        products,
        count: 1,
        lastOrderedAt: order.submissionTime,
      });
    }
  }

  // Convert to combinations and sort by frequency
  const combinations: ProductCombination[] = Array.from(combinationStats.values())
    .map((stat) => ({
      products: Array.from(stat.products.values()).map((p) => ({
        productId: p.productId,
        productCode: p.productCode,
        productName: p.productName,
        typicalQuantity: calculateTypicalQuantity(p.quantities),
      })),
      frequency: stat.count,
      lastOrderedAt: stat.lastOrderedAt,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3); // Top 3

  return combinations;
}

// ============================================================================
// Order History Recording (T070-T072)
// ============================================================================

/**
 * Create OrderHistory record when order is confirmed
 *
 * Stores product combination and generates vector embedding
 * for future semantic similarity search.
 *
 * @param db - Prisma client (tenant database)
 * @param orderId - Confirmed order ID
 * @param tenantId - Tenant ID
 * @returns Created OrderHistory record ID
 */
export async function recordOrderHistory(
  db: PrismaClient,
  orderId: string,
  tenantId: string
): Promise<string | null> {
  // Fetch the confirmed order with items
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order || order.status !== 'CONFIRMED' || !order.customerId) {
    return null; // Only record confirmed orders with known customers
  }

  // Build product combination string
  const productCombination = order.items
    .filter((item) => item.productId)
    .map((item) => ({
      productId: item.productId!,
      productCode: item.product?.productCode || '',
      productName: item.product?.productName || '',
      quantity: item.quantity,
    }));

  if (productCombination.length === 0) {
    return null; // No products to record
  }

  // Create OrderHistory record
  const orderHistory = await db.orderHistory.create({
    data: {
      tenantId,
      orderId,
      customerId: order.customerId,
      products: JSON.stringify(productCombination), // Field name is 'products' not 'productCombination'
      orderDate: order.submissionTime,
      // Note: Vector embedding will be generated in Phase 7
      // For now, we just store the product combination
    },
  });

  return orderHistory.id;
}

// ============================================================================
// Context Boosting
// ============================================================================

/**
 * Boost product match confidence based on order history
 *
 * If a product appears in customer's recent history, increase its
 * confidence score.
 *
 * @param originalConfidence - Original match confidence (0-1)
 * @param productId - Product ID to check
 * @param context - Customer context
 * @returns Boosted confidence score
 */
export function boostConfidenceWithContext(
  originalConfidence: number,
  productId: string,
  context: CustomerContext
): number {
  if (!context.hasHistory) {
    return originalConfidence;
  }

  // Find product in frequent products
  const frequentProduct = context.frequentProducts.find(
    (p) => p.productId === productId
  );

  if (!frequentProduct) {
    return originalConfidence; // No boost
  }

  // Calculate boost based on frequency
  // Top product: +15% boost
  // 2nd-5th: +10% boost
  // 6th-10th: +5% boost
  const rank = context.frequentProducts.indexOf(frequentProduct);
  let boost = 0;

  if (rank === 0) {
    boost = 0.15;
  } else if (rank < 5) {
    boost = 0.10;
  } else {
    boost = 0.05;
  }

  // Cap at 0.99 to avoid false certainty
  return Math.min(0.99, originalConfidence + boost);
}

// ============================================================================
// Customer Context Learning (T076-T079)
// ============================================================================

/**
 * Context Type for CustomerContext records
 */
export type ContextType = 'frequent_order' | 'abbreviation' | 'usual_order';

/**
 * Learn customer-specific patterns from operator corrections
 *
 * When operators correct OCR errors, we capture these as CustomerContext
 * records to improve future recognition for this customer.
 *
 * @param db - Prisma client (tenant database)
 * @param customerId - Customer ID
 * @param tenantId - Tenant ID
 * @param productCombination - Products from the corrected order
 * @param contextType - Type of pattern learned
 * @returns Created CustomerContext record ID
 */
export async function learnCustomerPattern(
  db: PrismaClient,
  customerId: string,
  tenantId: string,
  productCombination: Array<{
    productId: string;
    productCode: string;
    productName: string;
    quantity: number;
  }>,
  contextType: ContextType
): Promise<string> {
  // Create context record
  const context = await db.customerContext.create({
    data: {
      tenantId,
      customerId,
      contextType,
      productCombination: JSON.stringify(productCombination),
      frequency: 1, // Initial frequency
      lastOrderedAt: new Date(),
      // Note: Vector embedding will be generated in Phase 7
    },
  });

  console.log(
    `[Context Learning] Learned ${contextType} pattern for customer ${customerId}: ${productCombination.length} products`
  );

  return context.id;
}

/**
 * Update context records when operator corrections reveal new patterns
 *
 * Called after review completion to learn from human corrections.
 *
 * @param db - Prisma client (tenant database)
 * @param orderId - Order ID that was reviewed
 * @param tenantId - Tenant ID
 */
export async function updateContextFromReview(
  db: PrismaClient,
  orderId: string,
  tenantId: string
): Promise<void> {
  // Fetch the reviewed order with corrections
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        where: {
          verificationStatus: 'human_verified',
        },
        include: {
          product: true,
        },
      },
    },
  });

  if (!order || !order.customerId || order.items.length === 0) {
    return; // No corrections to learn from
  }

  // Check if this is a frequent order pattern
  const productCombination = order.items.map((item) => ({
    productId: item.productId!,
    productCode: item.product?.productCode || '',
    productName: item.product?.productName || '',
    quantity: item.quantity,
  }));

  // Learn the pattern as a frequent order
  await learnCustomerPattern(
    db,
    order.customerId,
    tenantId,
    productCombination,
    'frequent_order'
  );
}
