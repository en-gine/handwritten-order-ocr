// src/lib/storage/local.ts
import fs from 'fs/promises'
import path from 'path'

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
export class LocalFileStorage {
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
   * Save an uploaded file to tenant-specific directory.
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID for filename
   * @param file - File object from HTTP upload
   * @param extension - File extension (e.g., '.jpg', '.png')
   * @returns Absolute file path where file was saved
   *
   * @throws Error if file write fails
   *
   * @example
   * ```typescript
   * const filePath = await storage.saveFile(
   *   'tenant-123',
   *   'order-456',
   *   uploadedFile,
   *   '.jpg'
   * )
   * // Returns: '/absolute/path/to/uploads/tenant-123/order-456.jpg'
   * ```
   */
  async saveFile(
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
}
