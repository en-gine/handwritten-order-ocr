// src/types/api.ts
/**
 * API Request and Response Types
 *
 * Defines types for API endpoints including OCR upload, review queue,
 * and master data import operations.
 */

import type { OrderResponse, OrderItem } from './ocr.js';

/**
 * OCR upload request (multipart/form-data).
 * File is uploaded as multipart form field.
 */
export interface OCRUploadRequest {
  /** Uploaded file (PDF, JPG, or PNG) */
  file: File | Buffer;
  /** Optional: Override confidence threshold for this upload */
  confidenceThreshold?: number;
}

/**
 * OCR upload response with processing results.
 */
export interface OCRUploadResponse extends OrderResponse {
  /** Message describing upload status */
  message: string;
}

/**
 * Batch OCR upload response.
 */
export interface BatchOCRUploadResponse {
  /** Array of individual order processing results */
  results: OCRUploadResponse[];
  /** Aggregate statistics */
  statistics: {
    /** Total orders processed */
    total: number;
    /** Successfully processed orders */
    successful: number;
    /** Failed orders */
    failed: number;
    /** Average confidence across all orders */
    averageConfidence: number;
    /** Total processing time in milliseconds */
    totalProcessingTime: number;
  };
}

/**
 * Review queue item representing an order requiring human review.
 */
export interface ReviewQueueItem {
  /** Order ID */
  orderId: string;
  /** Customer ID (if identified) */
  customerId: string | null;
  /** Customer name (if identified) */
  customerName: string | null;
  /** Overall confidence score */
  overallConfidence: number;
  /** Reason for flagging */
  flagReason: 'low_confidence' | 'unknown_product' | 'unknown_customer';
  /** Review status */
  reviewStatus: 'pending' | 'in_progress' | 'completed';
  /** Assigned operator ID */
  assignedOperator: string | null;
  /** Presigned URL for original order image */
  imageUrl?: string;
  /** Order items */
  items: OrderItem[];
  /** When order was created */
  createdAt: Date;
  /** When review was last updated */
  reviewedAt?: Date;
}

/**
 * Review queue list response with pagination.
 */
export interface ReviewQueueListResponse {
  /** Array of review queue items */
  reviews: ReviewQueueItem[];
  /** Total count of reviews matching filter */
  total: number;
  /** Pagination: current page */
  page: number;
  /** Pagination: items per page */
  pageSize: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

/**
 * Review update request for correcting order data.
 */
export interface ReviewUpdateRequest {
  /** Customer correction (if needed) */
  customerCorrection?: {
    customerId: string;
    customerName: string;
  };
  /** Item corrections */
  itemCorrections?: Array<{
    /** Item index in original order */
    itemIndex: number;
    /** Corrected product ID */
    productId: string;
    /** Corrected quantity */
    quantity?: number;
    /** Corrected unit of measure */
    unitOfMeasure?: string;
  }>;
  /** Operator review notes */
  reviewNotes?: string;
  /** Review action: approve or reject */
  action: 'approve' | 'reject';
}

/**
 * Review update response after corrections applied.
 */
export interface ReviewUpdateResponse {
  /** Updated order ID */
  orderId: string;
  /** New order status after review */
  status: 'CONFIRMED' | 'REJECTED';
  /** Message describing update */
  message: string;
  /** Updated order data */
  order: OrderResponse;
}

/**
 * Master data import request.
 */
export interface MasterDataImportRequest {
  /** Type of master data being imported */
  type: 'customer' | 'product';
  /** Import mode */
  mode: 'incremental' | 'full';
  /** Data format */
  format: 'csv' | 'json';
  /** File data (for CSV) or JSON array */
  file?: File | Buffer;
  /** JSON data (for JSON format) */
  data?: Array<Record<string, any>>;
}

/**
 * Master data import response with statistics.
 */
export interface MasterDataImportResponse {
  /** Import type */
  type: 'customer' | 'product';
  /** Import mode used */
  mode: 'incremental' | 'full';
  /** Statistics */
  statistics: {
    /** Total records in import file */
    totalRecords: number;
    /** Successfully inserted records */
    inserted: number;
    /** Successfully updated records */
    updated: number;
    /** Failed records */
    failed: number;
    /** Processing time in milliseconds */
    processingTime: number;
  };
  /** Error details for failed records */
  errors?: Array<{
    row: number;
    error: string;
  }>;
  /** Message describing import result */
  message: string;
}

/**
 * Error response format.
 */
export interface ErrorResponse {
  /** Error details */
  error: {
    /** Error message */
    message: string;
    /** HTTP status code */
    status: number;
    /** Error code (optional) */
    code?: string;
    /** Additional error details */
    details?: Record<string, any>;
  };
}

/**
 * Health check response.
 */
export interface HealthCheckResponse {
  /** Service status */
  status: 'ok' | 'degraded' | 'down';
  /** Timestamp of health check */
  timestamp: string;
  /** Environment (development, production) */
  environment: string;
  /** Optional service details */
  services?: {
    database?: 'ok' | 'down';
    aiService?: 'ok' | 'down';
    storage?: 'ok' | 'down';
  };
}
