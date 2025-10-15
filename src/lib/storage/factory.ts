// src/lib/storage/factory.ts
import type { FileStorage } from './interface'
import { LocalFileStorage } from './local'
import { R2FileStorage } from './r2'

/**
 * Create a storage instance based on the current environment.
 *
 * This factory function provides seamless switching between storage backends:
 * - **Development/Test**: Uses LocalFileStorage (local filesystem)
 * - **Production**: Uses R2FileStorage (Cloudflare R2 object storage)
 *
 * The environment is determined by the NODE_ENV environment variable.
 *
 * @returns FileStorage instance appropriate for the current environment
 *
 * @example
 * ```typescript
 * // Automatically selects storage based on NODE_ENV
 * const storage = createStorage()
 *
 * // Upload a file - same interface regardless of backend
 * const key = await storage.uploadFile(
 *   'tenant-123',
 *   'order-456',
 *   uploadedFile,
 *   'application/pdf'
 * )
 *
 * // Generate presigned URL - same interface regardless of backend
 * const url = await storage.generatePresignedUrl('tenant-123', key)
 * ```
 *
 * @example
 * ```typescript
 * // In development (NODE_ENV=development or undefined):
 * // - Returns LocalFileStorage
 * // - Files stored in ./uploads/ directory
 * // - Presigned URLs return file paths
 *
 * // In production (NODE_ENV=production):
 * // - Returns R2FileStorage
 * // - Files stored in Cloudflare R2 bucket
 * // - Presigned URLs are temporary signed URLs
 * ```
 */
export function createStorage(): FileStorage {
  const env = process.env.NODE_ENV || 'development'

  if (env === 'production') {
    return new R2FileStorage()
  } else {
    return new LocalFileStorage()
  }
}
