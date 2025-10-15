// src/lib/storage/local.ts
import fs from 'fs/promises'
import path from 'path'
import type { FileStorage } from './interface'

/**
 * Local file storage implementation for development environment.
 *
 * Stores uploaded order images in a local directory structure:
 * uploads/
 *   tenant-id/
 *     order-id.jpg
 *     order-id.png
 *
 * Features:
 * - Tenant isolation via subdirectories
 * - Automatic directory creation
 * - File cleanup by age
 * - Support for multiple image formats
 */
export class LocalFileStorage implements FileStorage {
  private baseDir: string

  /**
   * Create a new LocalFileStorage instance.
   *
   * @param baseDir - Base directory for file storage (default: './uploads')
   *
   * @example
   * ```typescript
   * const storage = new LocalFileStorage('./uploads')
   * await storage.saveFile('tenant-123', 'order-456', file, '.jpg')
   * ```
   */
  constructor(baseDir: string = './uploads') {
    this.baseDir = baseDir
  }

  /**
   * Upload a file to local storage (implements FileStorage interface).
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID for filename
   * @param file - File object from HTTP upload
   * @param contentType - MIME type (e.g., 'application/pdf', 'image/jpeg')
   * @returns Absolute file path where file was saved
   *
   * @throws Error if file write fails
   *
   * @example
   * ```typescript
   * const filePath = await storage.uploadFile(
   *   'tenant-123',
   *   'order-456',
   *   uploadedFile,
   *   'application/pdf'
   * )
   * // Returns: '/absolute/path/to/uploads/tenant-123/order-456.pdf'
   * ```
   */
  async uploadFile(
    tenantId: string,
    orderId: string,
    file: File,
    contentType: string
  ): Promise<string> {
    const extension = this.getExtension(contentType)
    return this.saveFile(tenantId, orderId, file, extension)
  }

  /**
   * Generate a presigned URL (for local storage, returns absolute file path).
   *
   * Note: Local storage doesn't support true presigned URLs since files
   * are accessed via filesystem. This method returns the file path for
   * development/testing purposes.
   *
   * @param tenantId - Unique tenant identifier
   * @param fileKey - Order ID to find file
   * @param expiresIn - Ignored for local storage (parameter for interface compatibility)
   * @returns Absolute file path
   *
   * @throws Error if file not found
   *
   * @example
   * ```typescript
   * const url = await storage.generatePresignedUrl('tenant-123', 'order-456')
   * // Returns: '/absolute/path/to/uploads/tenant-123/order-456.pdf'
   * ```
   */
  async generatePresignedUrl(
    tenantId: string,
    fileKey: string,
    expiresIn?: number
  ): Promise<string> {
    // For local storage, fileKey is the orderId
    // Find the file and return its absolute path
    const tenantDir = path.join(this.baseDir, tenantId)
    const files = await fs.readdir(tenantDir)
    const file = files.find((f) => f.startsWith(fileKey))

    if (!file) {
      throw new Error(
        `File not found for fileKey: ${fileKey} in tenant: ${tenantId}`
      )
    }

    const filePath = path.join(tenantDir, file)
    return path.resolve(filePath)
  }

  /**
   * Delete a file from local storage.
   *
   * @param fileKey - Absolute file path to delete
   *
   * @throws Error if deletion fails
   *
   * @example
   * ```typescript
   * await storage.deleteFile('/absolute/path/to/uploads/tenant-123/order-456.pdf')
   * ```
   */
  async deleteFile(fileKey: string): Promise<void> {
    await fs.unlink(fileKey)
  }

  /**
   * Save an uploaded file to tenant-specific directory (internal method).
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID for filename
   * @param file - File object from HTTP upload
   * @param extension - File extension (e.g., '.jpg', '.png')
   * @returns Absolute file path where file was saved
   *
   * @throws Error if file write fails
   *
   * @private
   */
  private async saveFile(
    tenantId: string,
    orderId: string,
    file: File,
    extension: string
  ): Promise<string> {
    // Create tenant-specific directory if it doesn't exist
    const tenantDir = path.join(this.baseDir, tenantId)
    await fs.mkdir(tenantDir, { recursive: true })

    // Generate filename and full path
    const fileName = `${orderId}${extension}`
    const filePath = path.join(tenantDir, fileName)

    // Convert File to Buffer and write to disk
    const buffer = await file.arrayBuffer()
    await fs.writeFile(filePath, Buffer.from(buffer))

    // Return absolute path for database storage
    return path.resolve(filePath)
  }

  /**
   * Retrieve a file from tenant-specific directory.
   *
   * Automatically finds the file by orderId prefix, regardless of extension.
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID to search for
   * @returns File contents as Buffer
   *
   * @throws Error if file not found or read fails
   *
   * @example
   * ```typescript
   * const imageBuffer = await storage.getFile('tenant-123', 'order-456')
   * // Returns Buffer containing image data
   * ```
   */
  async getFile(tenantId: string, orderId: string): Promise<Buffer> {
    const tenantDir = path.join(this.baseDir, tenantId)

    // List all files in tenant directory
    const files = await fs.readdir(tenantDir)

    // Find file starting with orderId (handles any extension)
    const file = files.find((f) => f.startsWith(orderId))

    if (!file) {
      throw new Error(
        `File not found for orderId: ${orderId} in tenant: ${tenantId}`
      )
    }

    // Read and return file contents
    const filePath = path.join(tenantDir, file)
    return fs.readFile(filePath)
  }

  /**
   * Delete files older than specified number of days.
   *
   * Useful for automated cleanup of processed orders to save disk space.
   *
   * @param tenantId - Unique tenant identifier
   * @param olderThanDays - Delete files older than this many days
   * @returns Number of files deleted
   *
   * @example
   * ```typescript
   * // Delete files older than 30 days
   * const deletedCount = await storage.deleteOldFiles('tenant-123', 30)
   * console.log(`Deleted ${deletedCount} old files`)
   * ```
   */
  async deleteOldFiles(tenantId: string, olderThanDays: number): Promise<number> {
    const tenantDir = path.join(this.baseDir, tenantId)

    try {
      const files = await fs.readdir(tenantDir)
      const cutoffDate = Date.now() - olderThanDays * 24 * 60 * 60 * 1000

      let deletedCount = 0

      for (const file of files) {
        const filePath = path.join(tenantDir, file)
        const stats = await fs.stat(filePath)

        // Check if file is older than cutoff date
        if (stats.mtimeMs < cutoffDate) {
          await fs.unlink(filePath)
          deletedCount++
        }
      }

      return deletedCount
    } catch (error) {
      // If tenant directory doesn't exist, return 0
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0
      }
      throw error
    }
  }

  /**
   * Check if a file exists for a given orderId.
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID to check
   * @returns true if file exists, false otherwise
   */
  async fileExists(tenantId: string, orderId: string): Promise<boolean> {
    try {
      const tenantDir = path.join(this.baseDir, tenantId)
      const files = await fs.readdir(tenantDir)
      return files.some((f) => f.startsWith(orderId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }

  /**
   * Get the base directory path.
   *
   * @returns Absolute path to base storage directory
   */
  getBaseDir(): string {
    return path.resolve(this.baseDir)
  }

  /**
   * Get file extension from content type.
   *
   * @param contentType - MIME type
   * @returns File extension with leading dot (e.g., '.pdf', '.jpg')
   *
   * @private
   */
  private getExtension(contentType: string): string {
    const extensions: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
    }
    return extensions[contentType] || ''
  }
}
