// src/types/ocr.ts
/**
 * OCR Entity Types for Handwritten Order Processing
 *
 * Defines core types for order recognition, extraction, and processing results.
 * These types represent the business domain entities for the OCR workflow.
 */

/**
 * Extracted customer information from handwritten order form.
 */
export interface ExtractedCustomer {
  /** Customer identifier (code or name) as recognized from form */
  customerIdentifier: string;
  /** Confidence score for customer identification (0.0-1.0) */
  confidence: float;
  /** Additional customer details extracted (address, phone, etc.) */
  additionalInfo?: Record<string, string>;
}

/**
 * Single product line item extracted from order form.
 */
export interface OrderItem {
  /** Extracted product text as written on form (e.g., "ビール大") */
  extractedProductText: string;
  /** Matched product ID from master database (null if unmatched) */
  productId: string | null;
  /** Matched product name from master database */
  productName?: string;
  /** Extracted quantity */
  quantity: number;
  /** Unit of measure (case, bottle, kg, etc.) */
  unitOfMeasure?: string;
  /** Confidence score for this item (0.0-1.0) */
  confidence: number;
  /** Verification status */
  verificationStatus: 'unverified' | 'human_verified';
  /** Product ID after human correction (if applicable) */
  humanCorrectedProduct?: string;
}

/**
 * Complete order response returned from OCR processing.
 */
export interface OrderResponse {
  /** Unique order identifier */
  orderId: string;
  /** Current order status */
  status: 'PENDING' | 'PROCESSING' | 'REVIEWING' | 'CONFIRMED' | 'REJECTED';
  /** Overall confidence score for entire order (0.0-1.0) */
  overallConfidence: number;
  /** Extracted customer information */
  customer: ExtractedCustomer | null;
  /** Array of extracted order items */
  items: OrderItem[];
  /** Whether order requires manual review */
  flaggedForReview: boolean;
  /** Reason for flagging (if applicable) */
  flagReason?: 'low_confidence' | 'unknown_product' | 'unknown_customer';
  /** Timestamp when order was submitted */
  submissionTime: Date;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Storage key for uploaded file */
  fileKey: string;
}

/**
 * AI model processing result with raw response and metadata.
 */
export interface ProcessingResult {
  /** Order ID this result belongs to */
  orderId: string;
  /** AI model name used (e.g., "gemini-2.0-flash-exp") */
  modelName: string;
  /** Structured extracted fields */
  extractedFields: {
    customer?: ExtractedCustomer;
    items: OrderItem[];
  };
  /** Confidence scores per field */
  confidenceScores: Record<string, number>;
  /** Raw AI model response (full JSON) */
  rawResponse: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Token usage statistics */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Timestamp of processing */
  createdAt: Date;
}

/**
 * Customer matching result with confidence and suggestions.
 */
export interface CustomerMatch {
  /** Matched customer ID */
  customerId: string | null;
  /** Customer name from master database */
  customerName: string | null;
  /** Customer code from master database */
  customerCode: string | null;
  /** Confidence score for match (0.0-1.0) */
  confidence: number;
  /** Alternative customer suggestions (for low confidence) */
  suggestions?: Array<{
    customerId: string;
    customerName: string;
    customerCode: string;
    confidence: number;
  }>;
}

/**
 * Product matching result with confidence.
 */
export interface ProductMatch {
  /** Matched product ID */
  productId: string | null;
  /** Product name from master database */
  productName: string | null;
  /** Product code from master database */
  productCode: string | null;
  /** Confidence score for match (0.0-1.0) */
  confidence: number;
  /** Whether match used vector similarity search */
  usedSemanticSearch: boolean;
}

/**
 * Confidence scoring breakdown for an order.
 */
export interface ConfidenceScoring {
  /** Overall order confidence */
  overall: number;
  /** Customer identification confidence */
  customer: number;
  /** Per-item confidence scores */
  items: Array<{
    itemIndex: number;
    productMatch: number;
    quantityExtraction: number;
    combined: number;
  }>;
  /** Whether confidence meets threshold */
  meetsThreshold: boolean;
  /** Configured confidence threshold */
  threshold: number;
}
