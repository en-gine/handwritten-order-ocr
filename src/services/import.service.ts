// src/services/import.service.ts
/**
 * Master Data Import Service
 *
 * Handles bulk import of customer and product master data from CSV/JSON files.
 * Supports incremental updates and full replacement modes.
 *
 * Features:
 * - CSV parsing with PapaParse
 * - JSON parsing with validation
 * - Batch validation with Zod schemas
 * - Incremental mode: upsert existing records
 * - Full replacement mode: delete all + bulk insert
 * - 1000-row batches for performance
 * - Detailed error reporting
 *
 * @module services/import
 */

import type { PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import {
  CustomerImportSchema,
  ProductImportSchema,
  type CustomerImport,
  type ProductImport,
  type MasterDataType,
  type ImportMode,
  type ImportResult,
  type BatchValidationResult,
} from '../types/master-data.js';

// ============================================================================
// Import Master Data (Main Entry Point)
// ============================================================================

export interface ImportMasterDataParams {
  prisma: PrismaClient;
  tenantId: string;
  type: MasterDataType;
  mode: ImportMode;
  fileContent: string;
  fileName: string;
}

/**
 * Import master data from CSV or JSON file
 *
 * @param params - Import parameters
 * @returns Import result with statistics
 */
export async function importMasterData(
  params: ImportMasterDataParams
): Promise<ImportResult> {
  const startTime = Date.now();
  const { prisma, tenantId, type, mode, fileContent, fileName } = params;

  try {
    // Step 1: Parse file (CSV or JSON)
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    const rawData: unknown[] =
      fileExtension === 'csv'
        ? parseCSV(fileContent)
        : parseJSON(fileContent);

    // Step 2: Validate and transform data
    const validationResult =
      type === 'customer'
        ? validateBatch(rawData, CustomerImportSchema)
        : validateBatch(rawData, ProductImportSchema);

    // Step 3: Process based on mode
    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    if (mode === 'incremental') {
      // Incremental mode: upsert records
      const upsertResult =
        type === 'customer'
          ? await upsertCustomers(
              prisma,
              tenantId,
              validationResult.valid as CustomerImport[]
            )
          : await upsertProducts(
              prisma,
              tenantId,
              validationResult.valid as ProductImport[]
            );

      inserted = upsertResult.inserted;
      updated = upsertResult.updated;
    } else {
      // Full replacement mode: delete all + bulk insert
      const replacementResult =
        type === 'customer'
          ? await replaceAllCustomers(
              prisma,
              tenantId,
              validationResult.valid as CustomerImport[]
            )
          : await replaceAllProducts(
              prisma,
              tenantId,
              validationResult.valid as ProductImport[]
            );

      deleted = replacementResult.deleted;
      inserted = replacementResult.inserted;
    }

    // Step 4: Build result
    const durationMs = Date.now() - startTime;

    return {
      type,
      mode,
      totalRows: rawData.length,
      inserted,
      updated,
      deleted: mode === 'full' ? deleted : undefined,
      errors: validationResult.invalid.map((inv: any) => ({
        row: inv.row,
        error: inv.errors.map((e: any) => `${e.path}: ${e.message}`).join('; '),
      })),
      durationMs,
    };
  } catch (error) {
    throw new Error(
      `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// ============================================================================
// File Parsing
// ============================================================================

/**
 * Parse CSV file using PapaParse
 *
 * @param content - CSV file content
 * @returns Array of parsed objects
 */
function parseCSV(content: string): unknown[] {
  const result = Papa.parse(content, {
    header: true, // First row is header
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(), // Remove whitespace from headers
  });

  if (result.errors.length > 0) {
    throw new Error(
      `CSV parsing failed: ${result.errors.map((e) => e.message).join('; ')}`
    );
  }

  return result.data;
}

/**
 * Parse JSON file
 *
 * @param content - JSON file content
 * @returns Array of parsed objects
 */
function parseJSON(content: string): unknown[] {
  try {
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new Error('JSON must be an array of objects');
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `JSON parsing failed: ${error instanceof Error ? error.message : 'Invalid JSON'}`
    );
  }
}

// ============================================================================
// Batch Validation
// ============================================================================

/**
 * Validate a batch of records using Zod schema
 *
 * @param data - Raw data to validate
 * @param schema - Zod schema to validate against
 * @returns Validation result with valid and invalid records
 */
function validateBatch<T>(
  data: unknown[],
  schema: any
): BatchValidationResult<T> {
  const valid: T[] = [];
  const invalid: BatchValidationResult<T>['invalid'] = [];

  data.forEach((row, index) => {
    const result = schema.safeParse(row);

    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({
        row: index + 1, // 1-indexed for user-friendly error messages
        data: row,
        errors: result.error.errors.map((err: any) => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      });
    }
  });

  return { valid, invalid };
}

// ============================================================================
// Customer Import Operations
// ============================================================================

/**
 * Upsert customers (incremental mode)
 *
 * Process in 1000-row batches for performance.
 * Check existing records → split into inserts/updates → bulk operations.
 */
async function upsertCustomers(
  prisma: PrismaClient,
  tenantId: string,
  customers: CustomerImport[]
): Promise<{ inserted: number; updated: number }> {
  const BATCH_SIZE = 1000;
  let inserted = 0;
  let updated = 0;

  // Process in batches
  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    const codes = batch.map((c) => c.customerCode);

    // Find existing customers by code
    const existing = await prisma.customer.findMany({
      where: {
        tenantId,
        customerCode: { in: codes },
      },
      select: { customerCode: true },
    });

    const existingCodes = new Set(existing.map((c) => c.customerCode));

    // Split into inserts and updates
    const toInsert = batch.filter((c) => !existingCodes.has(c.customerCode));
    const toUpdate = batch.filter((c) => existingCodes.has(c.customerCode));

    // Bulk insert new customers
    if (toInsert.length > 0) {
      await prisma.customer.createMany({
        data: toInsert.map((c) => ({
          tenantId,
          customerCode: c.customerCode,
          name: c.name,
          nameVariations: JSON.stringify(c.nameVariations),
          isActive: c.isActive,
        })),
      });
      inserted += toInsert.length;
    }

    // Update existing customers (one by one for now - could optimize further)
    for (const customer of toUpdate) {
      await prisma.customer.update({
        where: {
          customerCode: customer.customerCode,
        },
        data: {
          name: customer.name,
          nameVariations: JSON.stringify(customer.nameVariations),
          isActive: customer.isActive,
        },
      });
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Replace all customers (full mode)
 *
 * Delete all existing records → bulk insert new records within transaction.
 */
async function replaceAllCustomers(
  prisma: PrismaClient,
  tenantId: string,
  customers: CustomerImport[]
): Promise<{ deleted: number; inserted: number }> {
  return await prisma.$transaction(async (tx) => {
    // Delete all existing customers for this tenant
    const deleteResult = await tx.customer.deleteMany({
      where: { tenantId },
    });

    // Bulk insert new customers
    await tx.customer.createMany({
      data: customers.map((c) => ({
        tenantId,
        customerCode: c.customerCode,
        name: c.name,
        nameVariations: JSON.stringify(c.nameVariations),
        isActive: c.isActive,
      })),
    });

    return {
      deleted: deleteResult.count,
      inserted: customers.length,
    };
  });
}

// ============================================================================
// Product Import Operations
// ============================================================================

/**
 * Upsert products (incremental mode)
 *
 * Same pattern as customer upsert.
 */
async function upsertProducts(
  prisma: PrismaClient,
  tenantId: string,
  products: ProductImport[]
): Promise<{ inserted: number; updated: number }> {
  const BATCH_SIZE = 1000;
  let inserted = 0;
  let updated = 0;

  // Process in batches
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const codes = batch.map((p) => p.productCode);

    // Find existing products by code
    const existing = await prisma.product.findMany({
      where: {
        tenantId,
        productCode: { in: codes },
      },
      select: { productCode: true },
    });

    const existingCodes = new Set(existing.map((p) => p.productCode));

    // Split into inserts and updates
    const toInsert = batch.filter((p) => !existingCodes.has(p.productCode));
    const toUpdate = batch.filter((p) => existingCodes.has(p.productCode));

    // Bulk insert new products
    if (toInsert.length > 0) {
      await prisma.product.createMany({
        data: toInsert.map((p) => ({
          tenantId,
          productCode: p.productCode,
          productName: p.productName,
          nameVariations: JSON.stringify(p.nameVariations),
          unitOfMeasure: p.unitOfMeasure,
          category: p.category || null,
          isActive: p.isActive,
        })),
      });
      inserted += toInsert.length;
    }

    // Update existing products
    for (const product of toUpdate) {
      await prisma.product.update({
        where: {
          productCode: product.productCode,
        },
        data: {
          productName: product.productName,
          nameVariations: JSON.stringify(product.nameVariations),
          unitOfMeasure: product.unitOfMeasure,
          category: product.category || null,
          isActive: product.isActive,
        },
      });
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Replace all products (full mode)
 *
 * Delete all existing records → bulk insert new records within transaction.
 */
async function replaceAllProducts(
  prisma: PrismaClient,
  tenantId: string,
  products: ProductImport[]
): Promise<{ deleted: number; inserted: number }> {
  return await prisma.$transaction(async (tx) => {
    // Delete all existing products for this tenant
    const deleteResult = await tx.product.deleteMany({
      where: { tenantId },
    });

    // Bulk insert new products
    await tx.product.createMany({
      data: products.map((p) => ({
        tenantId,
        productCode: p.productCode,
        productName: p.productName,
        nameVariations: JSON.stringify(p.nameVariations),
        unitOfMeasure: p.unitOfMeasure,
        category: p.category || null,
        isActive: p.isActive,
      })),
    });

    return {
      deleted: deleteResult.count,
      inserted: products.length,
    };
  });
}
