// src/types/master-data.ts
/**
 * Master Data Import Schemas
 *
 * Defines Zod validation schemas and TypeScript types for importing
 * customer and product master data via CSV/JSON uploads.
 */

import { z } from 'zod';

// ============================================================================
// Product Import Schema
// ============================================================================

/**
 * Product Import Schema
 *
 * Validates product data from CSV/JSON imports.
 * Supports both full replacement and incremental updates.
 */
export const ProductImportSchema = z.object({
  productCode: z
    .string()
    .min(1, 'Product code is required')
    .max(50, 'Product code must be 50 characters or less')
    .regex(/^[A-Z0-9_-]+$/, 'Product code must contain only uppercase letters, numbers, hyphens, and underscores'),

  productName: z
    .string()
    .min(1, 'Product name is required')
    .max(200, 'Product name must be 200 characters or less'),

  nameVariations: z
    .union([
      z.string().transform((val) => {
        // If string, parse as JSON array or comma-separated values
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [val];
        } catch {
          return val.split(',').map((v) => v.trim()).filter(Boolean);
        }
      }),
      z.array(z.string()),
    ])
    .optional()
    .transform((val) => val || []),

  unitOfMeasure: z
    .string()
    .max(20, 'Unit of measure must be 20 characters or less')
    .optional()
    .default('unit'),

  category: z
    .string()
    .max(50, 'Category must be 50 characters or less')
    .optional()
    .nullable(),

  tags: z
    .union([
      z.string().transform((val) => {
        // Parse as JSON array or comma-separated values
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [val];
        } catch {
          return val.split(',').map((v) => v.trim()).filter(Boolean);
        }
      }),
      z.array(z.string()),
    ])
    .optional()
    .transform((val) => val || []),

  isActive: z
    .union([z.boolean(), z.string().transform((val) => val === 'true' || val === '1')])
    .optional()
    .default(true),
});

export type ProductImport = z.infer<typeof ProductImportSchema>;

// ============================================================================
// Customer Import Schema
// ============================================================================

/**
 * Customer Import Schema
 *
 * Validates customer data from CSV/JSON imports.
 * Supports name variations for fuzzy matching.
 */
export const CustomerImportSchema = z.object({
  customerCode: z
    .string()
    .min(1, 'Customer code is required')
    .max(50, 'Customer code must be 50 characters or less')
    .regex(/^[A-Z0-9_-]+$/, 'Customer code must contain only uppercase letters, numbers, hyphens, and underscores'),

  name: z
    .string()
    .min(1, 'Customer name is required')
    .max(200, 'Customer name must be 200 characters or less'),

  nameVariations: z
    .union([
      z.string().transform((val) => {
        // If string, parse as JSON array or comma-separated values
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [val];
        } catch {
          return val.split(',').map((v) => v.trim()).filter(Boolean);
        }
      }),
      z.array(z.string()),
    ])
    .optional()
    .transform((val) => val || []),

  phoneNumber: z
    .string()
    .max(20, 'Phone number must be 20 characters or less')
    .optional()
    .nullable(),

  address: z
    .string()
    .max(500, 'Address must be 500 characters or less')
    .optional()
    .nullable(),

  taxId: z
    .string()
    .max(50, 'Tax ID must be 50 characters or less')
    .optional()
    .nullable(),

  isActive: z
    .union([z.boolean(), z.string().transform((val) => val === 'true' || val === '1')])
    .optional()
    .default(true),
});

export type CustomerImport = z.infer<typeof CustomerImportSchema>;

// ============================================================================
// Import Request Types
// ============================================================================

/**
 * Import Mode
 *
 * - incremental: Add new records and update existing ones (based on code)
 * - full: Delete all existing records and insert new ones (within transaction)
 */
export type ImportMode = 'incremental' | 'full';

/**
 * Master Data Type
 *
 * - customer: Customer master data
 * - product: Product master data
 */
export type MasterDataType = 'customer' | 'product';

/**
 * Import Result
 *
 * Statistics about an import operation.
 */
export interface ImportResult {
  type: MasterDataType;
  mode: ImportMode;
  totalRows: number;
  inserted: number;
  updated: number;
  deleted?: number; // Only for full replacement mode
  errors: Array<{
    row: number;
    error: string;
  }>;
  durationMs: number;
}

/**
 * Import Request Parameters
 *
 * Extracted from multipart/form-data.
 */
export interface ImportRequest {
  type: MasterDataType;
  mode: ImportMode;
  file: File; // Uploaded CSV or JSON file
  tenantId: string;
}

/**
 * Batch Validation Result
 *
 * Results from validating a batch of import records.
 */
export interface BatchValidationResult<T> {
  valid: T[];
  invalid: Array<{
    row: number;
    data: unknown;
    errors: Array<{
      path: string;
      message: string;
    }>;
  }>;
}
