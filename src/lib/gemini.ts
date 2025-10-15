// src/lib/gemini.ts
import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult } from '@google/generative-ai'

/**
 * Gemini API error types for retry logic
 */
enum GeminiErrorType {
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',      // 429 - retry
  TIMEOUT = 'TIMEOUT',                    // 503 - retry
  RATE_LIMIT = 'RATE_LIMIT',              // 429 - retry
  AUTHENTICATION = 'AUTHENTICATION',       // 401 - don't retry
  INVALID_REQUEST = 'INVALID_REQUEST',    // 400 - don't retry
  UNKNOWN = 'UNKNOWN',                    // Other errors - don't retry
}

/**
 * Configuration for Gemini API client
 */
interface GeminiConfig {
  apiKey: string
  model?: string
  maxRetries?: number
  initialRetryDelayMs?: number
}

/**
 * Options for content generation
 */
interface GenerateOptions {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
}

/**
 * Gemini API wrapper with retry logic and error handling
 */
export class GeminiClient {
  private client: GoogleGenerativeAI
  private model: GenerativeModel
  private maxRetries: number
  private initialRetryDelayMs: number

  constructor(config: GeminiConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey)
    this.model = this.client.getGenerativeModel({
      model: config.model || process.env.DEFAULT_AI_MODEL || 'gemini-2.0-flash-exp',
    })
    this.maxRetries = config.maxRetries ?? 3
    this.initialRetryDelayMs = config.initialRetryDelayMs ?? 1000
  }

  /**
   * Generate content with automatic retry on transient failures
   *
   * @param prompt - Text prompt for generation
   * @param options - Generation parameters
   * @returns Generated content result
   * @throws Error on permanent failures or after exhausting retries
   */
  async generateContent(
    prompt: string,
    options?: GenerateOptions
  ): Promise<GenerateContentResult> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: options,
        })

        return result
      } catch (error) {
        const errorType = this.classifyError(error)
        lastError = error as Error

        // Don't retry on permanent errors
        if (!this.isRetriableError(errorType)) {
          throw new Error(
            `Gemini API error (${errorType}): ${lastError.message}`
          )
        }

        // Check if we have retries left
        if (attempt < this.maxRetries) {
          const delay = this.calculateBackoff(attempt)
          console.warn(
            `Gemini API error (${errorType}), retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
          )
          await this.sleep(delay)
        }
      }
    }

    // All retries exhausted
    throw new Error(
      `Gemini API failed after ${this.maxRetries} retries: ${lastError?.message}`
    )
  }

  /**
   * Generate content with image input (for OCR processing)
   *
   * @param prompt - Text prompt for image analysis
   * @param imageData - Base64-encoded image data or Buffer
   * @param mimeType - Image MIME type (e.g., 'image/jpeg', 'image/png')
   * @param options - Generation parameters
   * @returns Generated content result
   */
  async generateContentWithImage(
    prompt: string,
    imageData: string | Buffer,
    mimeType: string,
    options?: GenerateOptions
  ): Promise<GenerateContentResult> {
    let lastError: Error | null = null

    // Convert Buffer to base64 if needed
    const base64Data = Buffer.isBuffer(imageData)
      ? imageData.toString('base64')
      : imageData

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: options,
        })

        return result
      } catch (error) {
        const errorType = this.classifyError(error)
        lastError = error as Error

        if (!this.isRetriableError(errorType)) {
          throw new Error(
            `Gemini API error (${errorType}): ${lastError.message}`
          )
        }

        if (attempt < this.maxRetries) {
          const delay = this.calculateBackoff(attempt)
          console.warn(
            `Gemini API error (${errorType}), retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
          )
          await this.sleep(delay)
        }
      }
    }

    throw new Error(
      `Gemini API failed after ${this.maxRetries} retries: ${lastError?.message}`
    )
  }

  /**
   * Classify error type for retry decision
   */
  private classifyError(error: unknown): GeminiErrorType {
    if (!(error instanceof Error)) {
      return GeminiErrorType.UNKNOWN
    }

    const message = error.message.toLowerCase()

    // Check for quota/rate limit errors
    if (message.includes('quota') || message.includes('429')) {
      return GeminiErrorType.QUOTA_EXCEEDED
    }

    // Check for timeout errors
    if (message.includes('timeout') || message.includes('503')) {
      return GeminiErrorType.TIMEOUT
    }

    // Check for rate limit
    if (message.includes('rate limit')) {
      return GeminiErrorType.RATE_LIMIT
    }

    // Check for authentication errors
    if (message.includes('auth') || message.includes('401')) {
      return GeminiErrorType.AUTHENTICATION
    }

    // Check for invalid request
    if (message.includes('invalid') || message.includes('400')) {
      return GeminiErrorType.INVALID_REQUEST
    }

    return GeminiErrorType.UNKNOWN
  }

  /**
   * Determine if error type should be retried
   */
  private isRetriableError(errorType: GeminiErrorType): boolean {
    return [
      GeminiErrorType.QUOTA_EXCEEDED,
      GeminiErrorType.TIMEOUT,
      GeminiErrorType.RATE_LIMIT,
    ].includes(errorType)
  }

  /**
   * Calculate exponential backoff delay
   * Formula: initialDelay * (2 ^ attempt)
   *
   * @param attempt - Current attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  private calculateBackoff(attempt: number): number {
    return this.initialRetryDelayMs * Math.pow(2, attempt)
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create a Gemini client with default configuration from environment variables
 *
 * @returns Configured GeminiClient instance
 * @throws Error if GEMINI_API_KEY is not set
 */
export function createGeminiClient(): GeminiClient {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey || apiKey === 'placeholder-for-development') {
    throw new Error(
      'GEMINI_API_KEY environment variable is required. Please set a valid API key.'
    )
  }

  return new GeminiClient({
    apiKey,
    model: process.env.DEFAULT_AI_MODEL,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
  })
}

/**
 * Prompt templates for OCR processing
 */
export const PromptTemplates = {
  /**
   * Japanese handwritten order form OCR prompt
   */
  orderFormOCR: (additionalContext?: string) => `
あなたは日本語の手書き注文書を読み取るOCRアシスタントです。
以下の画像から注文情報を抽出してJSONフォーマットで返してください。

抽出する情報:
1. 顧客名または顧客コード
2. 商品名（複数行ある場合は配列で）
3. 各商品の数量
4. 単位（ケース、本、kgなど）

${additionalContext ? `追加の文脈情報:\n${additionalContext}\n` : ''}

出力形式（必ずこのJSON形式で返してください）:
{
  "customer": "顧客名またはコード",
  "items": [
    {
      "product": "商品名",
      "quantity": 数量（数値）,
      "unit": "単位"
    }
  ]
}

注意事項:
- 読み取りが不明瞭な場合でも、最も確からしい解釈を提供してください
- 数量は必ず数値型で返してください
- 商品名の略語や手書きの癖にも対応してください
`.trim(),

  /**
   * Customer context matching prompt
   */
  customerContext: (customerName: string, historicalOrders: string[]) => `
以下の顧客名が過去の注文履歴のどの顧客に最も近いか判定してください。

入力された顧客名: "${customerName}"

過去の顧客リスト:
${historicalOrders.map((name, i) => `${i + 1}. ${name}`).join('\n')}

最も一致する顧客の番号を返してください。完全に一致しない場合は、表記揺れや略称を考慮して最も近いものを選んでください。
`.trim(),
}
