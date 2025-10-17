// src/services/confidence.service.ts
/**
 * Confidence Scoring Service
 *
 * Calculates confidence scores for OCR extraction results:
 * - Per-field confidence (customer, products, quantities)
 * - Overall order confidence
 * - Threshold comparison for review flagging
 */

import type { OrderItem, ConfidenceScoring } from '../types/ocr.js';

/**
 * Calculate overall confidence score for an order.
 *
 * Formula:
 * - Customer confidence: 30% weight
 * - Items confidence: 70% weight (average of all items)
 *
 * @param customerConfidence - Customer identification confidence (0-1)
 * @param items - Array of order items with confidence scores
 * @returns Overall confidence score (0-1)
 */
export function calculateOverallConfidence(
  customerConfidence: number,
  items: OrderItem[]
): number {
  if (items.length === 0) {
    // No items extracted - use only customer confidence
    return customerConfidence;
  }

  // Calculate average item confidence
  const totalItemConfidence = items.reduce((sum, item) => sum + item.confidence, 0);
  const averageItemConfidence = totalItemConfidence / items.length;

  // Weighted average: 30% customer + 70% items
  const overall = customerConfidence * 0.3 + averageItemConfidence * 0.7;

  // Round to 2 decimal places
  return Math.round(overall * 100) / 100;
}

/**
 * Determine if order meets confidence threshold.
 *
 * @param overallConfidence - Overall order confidence (0-1)
 * @param threshold - Confidence threshold (0-1, default 0.70)
 * @returns True if confidence meets or exceeds threshold
 */
export function meetsThreshold(overallConfidence: number, threshold: number = 0.7): boolean {
  // Use >= comparison (70.0% passes, 69.9% fails)
  return overallConfidence >= threshold;
}

/**
 * Calculate detailed confidence breakdown for an order.
 *
 * @param customerConfidence - Customer identification confidence
 * @param items - Array of order items
 * @param threshold - Confidence threshold (default 0.70)
 * @returns Detailed confidence scoring breakdown
 */
export function calculateConfidenceBreakdown(
  customerConfidence: number,
  items: OrderItem[],
  threshold: number = 0.7
): ConfidenceScoring {
  const overall = calculateOverallConfidence(customerConfidence, items);

  // Calculate per-item breakdown
  const itemBreakdown = items.map((item, index) => ({
    itemIndex: index,
    productMatch: item.confidence,
    quantityExtraction: item.confidence, // For now, use same confidence
    combined: item.confidence,
  }));

  return {
    overall,
    customer: customerConfidence,
    items: itemBreakdown,
    meetsThreshold: meetsThreshold(overall, threshold),
    threshold,
  };
}

/**
 * Calculate confidence score for extracted text based on AI model confidence.
 *
 * Adjusts raw AI confidence based on:
 * - Text clarity indicators
 * - Length and completeness
 * - Character recognition quality
 *
 * @param rawConfidence - Raw confidence from AI model (0-1)
 * @param extractedText - The extracted text
 * @returns Adjusted confidence score (0-1)
 */
export function adjustConfidenceForQuality(
  rawConfidence: number,
  extractedText: string
): number {
  let adjusted = rawConfidence;

  // Penalty for very short text (likely incomplete)
  if (extractedText.length < 2) {
    adjusted *= 0.5;
  }

  // Penalty for excessive special characters (likely OCR errors)
  const specialCharRatio = (extractedText.match(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length / extractedText.length;
  if (specialCharRatio > 0.3) {
    adjusted *= 0.8;
  }

  // Boost for clear Japanese text patterns
  const hasJapaneseChars = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(extractedText);
  if (hasJapaneseChars && extractedText.length >= 2) {
    adjusted *= 1.05; // Small boost for clear Japanese text
  }

  // Ensure result stays in [0, 1] range
  return Math.min(Math.max(adjusted, 0), 1);
}

/**
 * Determine flag reason based on confidence scores.
 *
 * @param customerConfidence - Customer identification confidence
 * @param items - Array of order items
 * @param customerMatched - Whether customer was matched
 * @returns Flag reason if order should be flagged, null otherwise
 */
export function determineFlagReason(
  customerConfidence: number,
  items: OrderItem[],
  customerMatched: boolean
): 'low_confidence' | 'unknown_product' | 'unknown_customer' | null {
  // Check for unknown customer
  if (!customerMatched || customerConfidence < 0.6) {
    return 'unknown_customer';
  }

  // Check for unknown products (product ID is null)
  const hasUnknownProduct = items.some((item) => item.productId === null);
  if (hasUnknownProduct) {
    return 'unknown_product';
  }

  // Check for low confidence items
  const hasLowConfidenceItem = items.some((item) => item.confidence < 0.7);
  if (hasLowConfidenceItem) {
    return 'low_confidence';
  }

  // No flag needed
  return null;
}

/**
 * Calculate confidence score with historical context boost.
 *
 * Boosts confidence if product/customer appears frequently in history.
 *
 * @param baseConfidence - Base confidence from OCR
 * @param historicalFrequency - Number of times seen in history (0-N)
 * @param maxBoost - Maximum boost percentage (default 0.20 = 20%)
 * @returns Boosted confidence score
 */
export function applyHistoricalBoost(
  baseConfidence: number,
  historicalFrequency: number,
  maxBoost: number = 0.2
): number {
  if (historicalFrequency === 0) {
    return baseConfidence;
  }

  // Calculate boost: logarithmic scale (diminishing returns)
  // frequency 1-5: small boost, 6-10: medium, 11+: approaching max
  const boostFactor = Math.min(Math.log10(historicalFrequency + 1) / 2, maxBoost);

  const boosted = baseConfidence + boostFactor;

  // Cap at 0.99 (never 100% certain)
  return Math.min(boosted, 0.99);
}
