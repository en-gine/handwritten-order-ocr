// src/api/middleware/upload.ts
/**
 * File Upload Validation Middleware
 *
 * Validates uploaded files for OCR processing:
 * - File size limit (10MB)
 * - Allowed file types (PDF, JPG, PNG)
 * - File existence and integrity
 */

import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Maximum file size in bytes (10MB).
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Allowed MIME types for order form uploads.
 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
];

/**
 * Allowed file extensions.
 */
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

/**
 * Validates uploaded file for OCR processing.
 *
 * Checks:
 * 1. File exists in request
 * 2. File size within limit
 * 3. File type is allowed
 *
 * @throws {HTTPException} 400 if validation fails
 */
export async function validateFileUpload(c: Context, next: Next) {
  try {
    // Parse multipart form data
    const body = await c.req.parseBody();
    const file = body['file'];

    // Check if file exists
    if (!file) {
      throw new HTTPException(400, {
        message: 'ファイルがアップロードされていません。注文書のPDF、JPG、またはPNG画像をアップロードしてください。',
      });
    }

    // Handle File object from Hono's parseBody
    let fileBuffer: ArrayBuffer;
    let fileName: string;
    let mimeType: string;
    let fileSize: number;

    // Check if file has the expected properties
    if (typeof file === 'object' && file !== null && 'arrayBuffer' in file && 'name' in file) {
      fileBuffer = await (file as File).arrayBuffer();
      fileName = (file as File).name;
      mimeType = (file as File).type || 'application/octet-stream';
      fileSize = (file as File).size;
    } else {
      throw new HTTPException(400, {
        message: '無効なファイル形式です。',
      });
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      throw new HTTPException(400, {
        message: `ファイルサイズが大きすぎます。最大${MAX_FILE_SIZE / 1024 / 1024}MBまでアップロード可能です。`,
      });
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new HTTPException(400, {
        message: 'サポートされていないファイル形式です。PDF、JPG、またはPNG形式のファイルをアップロードしてください。',
      });
    }

    // Validate file extension
    const fileExtension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      throw new HTTPException(400, {
        message: `無効なファイル拡張子です。許可されている拡張子: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }

    // Store validated file data in context for downstream handlers
    c.set('uploadedFile', {
      buffer: Buffer.from(fileBuffer),
      fileName,
      mimeType,
      fileSize,
      fileExtension,
    });

    // Proceed to next middleware/handler
    await next();
  } catch (error) {
    // Re-throw HTTPException as-is
    if (error instanceof HTTPException) {
      throw error;
    }

    // Handle unexpected errors
    console.error('File upload validation error:', error);
    throw new HTTPException(500, {
      message: 'ファイルのアップロード処理中にエラーが発生しました。',
    });
  }
}

/**
 * Validates batch file upload (multiple files).
 *
 * Checks each file in the upload batch.
 *
 * @throws {HTTPException} 400 if validation fails for any file
 */
export async function validateBatchFileUpload(c: Context, next: Next) {
  try {
    const body = await c.req.parseBody();
    const files = body['files'];

    // Check if files exist
    if (!files || (Array.isArray(files) && files.length === 0)) {
      throw new HTTPException(400, {
        message: 'ファイルがアップロードされていません。1つ以上のファイルをアップロードしてください。',
      });
    }

    // Ensure files is an array
    const fileArray = Array.isArray(files) ? files : [files];

    // Validate each file
    const validatedFiles = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];

      // Handle File object
      let fileBuffer: ArrayBuffer;
      let fileName: string;
      let mimeType: string;
      let fileSize: number;

      if (typeof file === 'object' && file !== null && 'arrayBuffer' in file && 'name' in file) {
        fileBuffer = await (file as File).arrayBuffer();
        fileName = (file as File).name;
        mimeType = (file as File).type || 'application/octet-stream';
        fileSize = (file as File).size;
      } else {
        throw new HTTPException(400, {
          message: `ファイル ${i + 1}: 無効なファイル形式です。`,
        });
      }

      // Validate file size
      if (fileSize > MAX_FILE_SIZE) {
        throw new HTTPException(400, {
          message: `ファイル ${i + 1} (${fileName}): サイズが大きすぎます（最大${MAX_FILE_SIZE / 1024 / 1024}MB）。`,
        });
      }

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new HTTPException(400, {
          message: `ファイル ${i + 1} (${fileName}): サポートされていない形式です。`,
        });
      }

      // Validate extension
      const fileExtension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
      if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
        throw new HTTPException(400, {
          message: `ファイル ${i + 1} (${fileName}): 無効な拡張子です。`,
        });
      }

      validatedFiles.push({
        buffer: Buffer.from(fileBuffer),
        fileName,
        mimeType,
        fileSize,
        fileExtension,
      });
    }

    // Store validated files in context
    c.set('uploadedFiles', validatedFiles);

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('Batch file upload validation error:', error);
    throw new HTTPException(500, {
      message: 'バッチファイルのアップロード処理中にエラーが発生しました。',
    });
  }
}

/**
 * Type definition for validated file stored in context.
 */
export interface ValidatedFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileExtension: string;
}
