// src/lib/storage/interface.ts

/**
 * FileStorage interface for abstracting file storage implementations.
 *
 * This interface allows seamless switching between different storage backends:
 * - LocalFileStorage: For development/testing (local filesystem)
 * - R2FileStorage: For production (Cloudflare R2 object storage)
 *
 * All storage implementations must adhere to this contract, ensuring
 * consistent behavior across environments.
 */
export interface FileStorage {
  /**
   * Upload a file to storage.
   *
   * @param tenantId - Unique tenant identifier for isolation
   * @param orderId - Order ID for filename/key
   * @param file - File object from HTTP upload
   * @param contentType - MIME type (e.g., 'application/pdf', 'image/jpeg')
   * @returns Storage key or file path where file was saved
   *
   * @throws Error if upload fails
   *
   * @example
   * ```typescript
   * const storage = createStorage()
   * const key = await storage.uploadFile(
   *   'tenant-123',
   *   'order-456',
   *   uploadedFile,
   *   'application/pdf'
   * )
   * // LocalFileStorage returns: '/absolute/path/to/uploads/tenant-123/order-456.pdf'
   * // R2FileStorage returns: 'tenant-123/order-456.pdf'
   * ```
   */
  uploadFile(
    tenantId: string,
    orderId: string,
    file: File,
    contentType: string
  ): Promise<string>

  /**
   * Generate a presigned URL for secure, temporary file access.
   *
   * Used by the review interface to display order images without
   * exposing storage credentials to the frontend.
   *
   * @param tenantId - Unique tenant identifier
   * @param fileKey - Storage key or order ID to identify the file
   * @param expiresIn - URL expiration time in seconds (optional)
   * @returns Presigned URL or file path for accessing the file
   *
   * @throws Error if file not found or URL generation fails
   *
   * @example
   * ```typescript
   * const storage = createStorage()
   * const url = await storage.generatePresignedUrl('tenant-123', 'order-456', 3600)
   * // LocalFileStorage returns: '/absolute/path/to/uploads/tenant-123/order-456.pdf'
   * // R2FileStorage returns: 'https://<account>.r2.cloudflarestorage.com/...?signature=...'
   * ```
   */
  generatePresignedUrl(
    tenantId: string,
    fileKey: string,
    expiresIn?: number
  ): Promise<string>

  /**
   * Delete a file from storage.
   *
   * Used for retention policy enforcement (e.g., delete files older than 365 days)
   * or when an order is permanently removed.
   *
   * @param fileKey - Storage key or file path to delete
   *
   * @throws Error if deletion fails
   *
   * @example
   * ```typescript
   * const storage = createStorage()
   * await storage.deleteFile('tenant-123/order-456.pdf')
   * ```
   */
  deleteFile(fileKey: string): Promise<void>
}
