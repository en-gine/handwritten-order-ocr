// src/lib/config.ts

/**
 * Application configuration loaded from environment variables.
 *
 * This module provides type-safe access to all application configuration,
 * validates required values, and provides sensible defaults for optional settings.
 *
 * Configuration is loaded once at application startup and cached for the
 * lifetime of the application.
 */

/**
 * Storage type configuration
 */
export type StorageType = 'local' | 'r2'

/**
 * Application configuration interface
 */
export interface Config {
  // Node Environment
  nodeEnv: string
  isProduction: boolean
  isDevelopment: boolean

  // Service Database (tenant metadata)
  serviceDatabaseUrl: string
  serviceDatabaseToken: string

  // Schema Database (template for tenant DBs)
  schemaDatabaseUrl: string
  schemaDatabaseToken: string

  // Test Tenant Database (for development)
  testTenantId: string
  testTenantDatabaseUrl: string
  testTenantDatabaseToken: string

  // Gemini AI Configuration
  geminiApiKey: string
  defaultAiModel: string

  // JWT Authentication
  jwtSecret: string
  jwtPublicKey?: string
  jwtPrivateKey?: string

  // File Storage
  storageType: StorageType
  uploadDir: string

  // Cloudflare R2 (production storage)
  r2BucketName?: string
  r2Endpoint?: string
  r2AccessKeyId?: string
  r2SecretAccessKey?: string

  // API Configuration
  apiPort: number
  confidenceThreshold: number

  // Rate Limiting
  rateLimitWindowMs: number
  rateLimitMaxRequests: number
}

/**
 * Configuration validation error
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Get environment variable value
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value or default
 */
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (value !== undefined && value !== '') {
    return value
  }
  if (defaultValue !== undefined) {
    return defaultValue
  }
  throw new ConfigError(`Missing required environment variable: ${key}`)
}

/**
 * Get environment variable as number
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value as number
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value !== undefined && value !== '') {
    const parsed = parseFloat(value)
    if (isNaN(parsed)) {
      throw new ConfigError(
        `Environment variable ${key} must be a valid number, got: ${value}`
      )
    }
    return parsed
  }
  return defaultValue
}

/**
 * Get environment variable as integer
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value as integer
 */
function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value !== undefined && value !== '') {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed)) {
      throw new ConfigError(
        `Environment variable ${key} must be a valid integer, got: ${value}`
      )
    }
    return parsed
  }
  return defaultValue
}

/**
 * Get optional environment variable
 *
 * @param key - Environment variable name
 * @returns Environment variable value or undefined
 */
function getEnvOptional(key: string): string | undefined {
  const value = process.env[key]
  return value !== undefined && value !== '' ? value : undefined
}

/**
 * Validate storage type
 *
 * @param type - Storage type string
 * @returns Validated storage type
 */
function validateStorageType(type: string): StorageType {
  if (type === 'local' || type === 'r2') {
    return type
  }
  throw new ConfigError(
    `Invalid storage type: ${type}. Must be 'local' or 'r2'`
  )
}

/**
 * Validate R2 configuration when storage type is 'r2'
 *
 * @param config - Partial configuration object
 */
function validateR2Config(config: Partial<Config>): void {
  if (config.storageType === 'r2') {
    const requiredR2Keys = [
      'R2_BUCKET_NAME',
      'R2_ENDPOINT',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]

    const missing = requiredR2Keys.filter(
      (key) => !process.env[key] || process.env[key] === ''
    )

    if (missing.length > 0) {
      throw new ConfigError(
        `R2 storage requires the following environment variables: ${missing.join(
          ', '
        )}`
      )
    }
  }
}

/**
 * Load and validate application configuration from environment variables.
 *
 * This function should be called once at application startup to load all
 * configuration. It validates required variables and provides defaults for
 * optional settings.
 *
 * @returns Type-safe configuration object
 * @throws ConfigError if required configuration is missing or invalid
 *
 * @example
 * ```typescript
 * import { loadConfig } from './lib/config'
 *
 * // Load configuration at startup
 * const config = loadConfig()
 *
 * // Access configuration values
 * console.log(`Starting server on port ${config.apiPort}`)
 * console.log(`AI Model: ${config.defaultAiModel}`)
 * console.log(`Confidence threshold: ${config.confidenceThreshold}`)
 * ```
 */
export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development')
  const storageType = validateStorageType(getEnv('STORAGE_TYPE', 'local'))

  const config: Config = {
    // Node Environment
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',

    // Service Database (tenant metadata)
    serviceDatabaseUrl: getEnv('SERVICE_DATABASE_URL'),
    serviceDatabaseToken: getEnv('SERVICE_DATABASE_TOKEN'),

    // Schema Database (template for tenant DBs)
    schemaDatabaseUrl: getEnv('SCHEMA_DATABASE_URL'),
    schemaDatabaseToken: getEnv('SCHEMA_DATABASE_TOKEN'),

    // Test Tenant Database (for development)
    testTenantId: getEnv('TEST_TENANT_ID', 'tenant-test'),
    testTenantDatabaseUrl: getEnv('TEST_TENANT_DATABASE_URL'),
    testTenantDatabaseToken: getEnv('TEST_TENANT_DATABASE_TOKEN'),

    // Gemini AI Configuration
    geminiApiKey: getEnv('GEMINI_API_KEY'),
    defaultAiModel: getEnv('DEFAULT_AI_MODEL', 'gemini-2.0-flash-exp'),

    // JWT Authentication
    jwtSecret: getEnv('JWT_SECRET'),
    jwtPublicKey: getEnvOptional('JWT_PUBLIC_KEY'),
    jwtPrivateKey: getEnvOptional('JWT_PRIVATE_KEY'),

    // File Storage
    storageType,
    uploadDir: getEnv('UPLOAD_DIR', './uploads'),

    // Cloudflare R2 (production storage)
    r2BucketName: getEnvOptional('R2_BUCKET_NAME'),
    r2Endpoint: getEnvOptional('R2_ENDPOINT'),
    r2AccessKeyId: getEnvOptional('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: getEnvOptional('R2_SECRET_ACCESS_KEY'),

    // API Configuration
    apiPort: getEnvInt('API_PORT', 3000),
    confidenceThreshold: getEnvNumber('CONFIDENCE_THRESHOLD', 0.7),

    // Rate Limiting
    rateLimitWindowMs: getEnvInt('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMaxRequests: getEnvInt('RATE_LIMIT_MAX_REQUESTS', 100),
  }

  // Validate R2 configuration if using R2 storage
  validateR2Config(config)

  return config
}

/**
 * Cached configuration instance.
 * Loaded once at module initialization.
 */
let cachedConfig: Config | null = null

/**
 * Get the application configuration.
 *
 * This function returns a cached configuration object that is loaded once
 * at application startup. Subsequent calls return the cached instance.
 *
 * @returns Application configuration
 *
 * @example
 * ```typescript
 * import { getConfig } from './lib/config'
 *
 * const config = getConfig()
 * console.log(`Using AI model: ${config.defaultAiModel}`)
 * ```
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig()
  }
  return cachedConfig
}

/**
 * Reset the cached configuration (useful for testing).
 *
 * @internal
 */
export function resetConfig(): void {
  cachedConfig = null
}
