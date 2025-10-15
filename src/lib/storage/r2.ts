// src/lib/storage/r2.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Cloudflare R2 file storage implementation for production environment.
 *
 * Uses S3-compatible API to store uploaded order images in R2 bucket:
 * - Prefix-based tenant isolation (single bucket)
 * - Presigned URLs for secure review interface access
 * - Zero egress costs (R2 advantage over S3)
 *
 * Object Key Structure:
 * {tenantId}/{orderId}.{ext}
 *
 * Example:
 * tenant-abc123/order-456.jpg
 * tenant-xyz789/order-101.pdf
 */
export class R2FileStorage {
  private client: S3Client
  private bucketName: string

  /**
   * Create a new R2FileStorage instance.
   *
   * Requires environment variables:
   * - R2_BUCKET_NAME: Bucket name (e.g., 'ocr-order-forms')
   * - R2_ENDPOINT: R2 endpoint URL (e.g., 'https://<account-id>.r2.cloudflarestorage.com')
   * - R2_ACCESS_KEY_ID: R2 access key ID
   * - R2_SECRET_ACCESS_KEY: R2 secret access key
   *
   * @throws Error if required environment variables are missing
   *
   * @example
   * ```typescript
   * const storage = new R2FileStorage()
   * const fileKey = await storage.uploadFile('tenant-123', 'order-456', file, 'image/jpeg')
   * ```
   */
  constructor() {
    this.bucketName = process.env.R2_BUCKET_NAME || ''
    const endpoint = process.env.R2_ENDPOINT || ''
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || ''
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || ''

    if (!this.bucketName || !endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'R2 configuration missing. Required: R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
      )
    }

    this.client = new S3Client({
      region: 'auto', // R2 uses 'auto' region
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }

  /**
   * Upload a file to R2 with tenant-prefixed key.
   *
   * @param tenantId - Unique tenant identifier for prefix
   * @param orderId - Order ID for filename
   * @param file - File object from HTTP upload
   * @param contentType - MIME type (e.g., 'application/pdf', 'image/jpeg')
   * @returns R2 object key (tenantId/orderId.ext)
   *
   * @throws Error if upload fails
   *
   * @example
   * ```typescript
   * const fileKey = await storage.uploadFile(
   *   'tenant-123',
   *   'order-456',
   *   uploadedFile,
   *   'application/pdf'
   * )
   * // Returns: 'tenant-123/order-456.pdf'
   * ```
   */
  async uploadFile(
    tenantId: string,
    orderId: string,
    file: File,
    contentType: string
  ): Promise<string> {
    const extension = this.getExtension(contentType)
    const key = `${tenantId}/${orderId}${extension}`

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: contentType,
      Metadata: {
        tenantId,
        orderId,
        uploadedAt: new Date().toISOString(),
      },
    })

    await this.client.send(command)
    return key
  }

  /**
   * Generate a presigned URL for secure, temporary file access.
   *
   * Used by the review interface to display order images without
   * exposing R2 credentials to the frontend.
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID to find file
   * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
   * @returns Presigned URL valid for specified duration
   *
   * @throws Error if file not found or presigned URL generation fails
   *
   * @example
   * ```typescript
   * const url = await storage.generatePresignedUrl('tenant-123', 'order-456')
   * // Returns: 'https://<account-id>.r2.cloudflarestorage.com/tenant-123/order-456.jpg?X-Amz-Signature=...'
   * // Valid for 1 hour
   * ```
   */
  async generatePresignedUrl(
    tenantId: string,
    orderId: string,
    expiresIn: number = 3600
  ): Promise<string> {
    // Find the file key by scanning tenant prefix
    // In production, the full key should be stored in the database
    const key = await this.findFileKey(tenantId, orderId)

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })

    return getSignedUrl(this.client, command, { expiresIn })
  }

  /**
   * Delete a file from R2 storage.
   *
   * Used for retention policy enforcement (e.g., delete files older than 365 days)
   * or when an order is permanently removed.
   *
   * @param fileKey - Full R2 object key (tenantId/orderId.ext)
   *
   * @throws Error if deletion fails
   *
   * @example
   * ```typescript
   * await storage.deleteFile('tenant-123/order-456.pdf')
   * ```
   */
  async deleteFile(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    })

    await this.client.send(command)
  }

  /**
   * Find a file key by tenant and order ID.
   *
   * Scans the tenant prefix to find the file, regardless of extension.
   * This is a simplified implementation - in production, the full file key
   * should be stored in the database (Order.fileKey field).
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID to search for
   * @returns Full object key (tenantId/orderId.ext)
   *
   * @throws Error if file not found
   *
   * @private
   */
  private async findFileKey(tenantId: string, orderId: string): Promise<string> {
    const prefix = `${tenantId}/${orderId}`

    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: 1, // We expect only one match
    })

    const response = await this.client.send(command)

    if (!response.Contents || response.Contents.length === 0) {
      throw new Error(
        `File not found for orderId: ${orderId} in tenant: ${tenantId}`
      )
    }

    return response.Contents[0].Key!
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

  /**
   * Get the bucket name.
   *
   * @returns R2 bucket name
   */
  getBucketName(): string {
    return this.bucketName
  }

  /**
   * Delete old files for a tenant based on age.
   *
   * Used for retention policy enforcement (e.g., delete files older than 365 days).
   * This is a batch operation that queries and deletes multiple files.
   *
   * @param tenantId - Unique tenant identifier
   * @param olderThanDays - Delete files older than this many days
   * @returns Number of files deleted
   *
   * @example
   * ```typescript
   * // Delete files older than 365 days for tenant
   * const deletedCount = await storage.deleteOldFiles('tenant-123', 365)
   * console.log(`Deleted ${deletedCount} old files`)
   * ```
   */
  async deleteOldFiles(tenantId: string, olderThanDays: number): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    // List all files for the tenant
    const listCommand = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: `${tenantId}/`,
    })

    const response = await this.client.send(listCommand)

    if (!response.Contents || response.Contents.length === 0) {
      return 0
    }

    // Filter files older than cutoff date
    const oldFiles = response.Contents.filter((file) => {
      if (!file.LastModified) return false
      return file.LastModified < cutoffDate
    })

    // Delete old files
    let deletedCount = 0
    for (const file of oldFiles) {
      if (file.Key) {
        await this.deleteFile(file.Key)
        deletedCount++
      }
    }

    return deletedCount
  }

  /**
   * Check if a file exists for a given order ID.
   *
   * @param tenantId - Unique tenant identifier
   * @param orderId - Order ID to check
   * @returns true if file exists, false otherwise
   */
  async fileExists(tenantId: string, orderId: string): Promise<boolean> {
    try {
      await this.findFileKey(tenantId, orderId)
      return true
    } catch (error) {
      return false
    }
  }
}
