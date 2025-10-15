// src/lib/jwt.ts
import { sign } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'

/**
 * JWT token generation utility for multi-tenant OCR API.
 *
 * **Purpose**:
 * Generates RS256-signed JWT tokens for tenant authentication with embedded metadata.
 *
 * **Token Claims**:
 * - Standard claims: iss, sub, aud, exp, iat, nbf, jti
 * - Custom claims: tenant_id, tenant_name, permissions, rate_limit_tier
 *
 * **Security**:
 * - RS256 asymmetric signing (public key for verification, private key for signing)
 * - Configurable token lifetime (default: 15 minutes for access tokens)
 * - Unique token ID (jti) for token tracking and revocation
 *
 * **Usage**:
 * ```typescript
 * import { generateTenantToken } from './lib/jwt'
 *
 * // Generate access token for a tenant
 * const token = await generateTenantToken({
 *   tenantId: 'tenant-abc123',
 *   tenantName: 'Acme Corp',
 *   permissions: ['ocr:process', 'ocr:review', 'master:import'],
 *   rateLimitTier: 'standard',
 * })
 * ```
 *
 * **Environment Variables**:
 * - JWT_PRIVATE_KEY: RS256 private key (PEM format) for signing tokens
 * - JWT_ISSUER: Token issuer (default: 'ocr-api.example.com')
 * - JWT_AUDIENCE: Token audience (default: 'ocr-api')
 *
 * **Token Lifetime**:
 * - Access tokens: 15 minutes (short-lived for security)
 * - Refresh tokens: Not implemented (future enhancement)
 *
 * @module jwt
 */

/**
 * Tenant token payload for JWT generation.
 */
export interface TenantTokenPayload {
  /** Unique tenant identifier */
  tenantId: string

  /** Tenant display name (for logging/debugging) */
  tenantName?: string

  /** Array of permissions granted to this tenant */
  permissions: string[]

  /** Rate limit tier (free, standard, premium) */
  rateLimitTier: 'free' | 'standard' | 'premium'
}

/**
 * JWT token generation options.
 */
export interface TokenGenerationOptions {
  /** Token expiration time in seconds (default: 900 = 15 minutes) */
  expiresIn?: number

  /** Token issuer (default: from JWT_ISSUER env var) */
  issuer?: string

  /** Token audience (default: from JWT_AUDIENCE env var) */
  audience?: string

  /** Not before time in seconds from now (default: 0) */
  notBefore?: number
}

/**
 * Generate a unique token ID (jti claim).
 *
 * Creates a unique identifier for the token using timestamp and random string.
 * Format: `{timestamp}-{random}`
 *
 * @returns Unique token ID
 *
 * @example
 * generateTokenId() // => "1728900000-abc123def456"
 */
function generateTokenId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 15)
  return `${timestamp}-${random}`
}

/**
 * Generate a JWT token for tenant authentication.
 *
 * Creates an RS256-signed JWT token with tenant metadata embedded as claims.
 * Tokens are short-lived (15 minutes by default) and include standard JWT claims
 * plus custom claims for tenant identification and authorization.
 *
 * @param payload - Tenant information to encode in the token
 * @param options - Token generation options (expiration, issuer, etc.)
 * @returns Signed JWT token string
 * @throws HTTPException(500) if JWT_PRIVATE_KEY is not configured
 *
 * @example
 * ```typescript
 * const token = await generateTenantToken({
 *   tenantId: 'tenant-abc123',
 *   tenantName: 'Acme Corp',
 *   permissions: ['ocr:process', 'ocr:review'],
 *   rateLimitTier: 'standard',
 * })
 *
 * // With custom expiration (1 hour)
 * const longLivedToken = await generateTenantToken(
 *   {
 *     tenantId: 'tenant-abc123',
 *     permissions: ['ocr:process'],
 *     rateLimitTier: 'free',
 *   },
 *   { expiresIn: 3600 }
 * )
 * ```
 */
export async function generateTenantToken(
  payload: TenantTokenPayload,
  options: TokenGenerationOptions = {}
): Promise<string> {
  // Validate environment configuration
  const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY

  if (!JWT_PRIVATE_KEY) {
    throw new HTTPException(500, {
      message: 'JWT_PRIVATE_KEY environment variable not configured',
    })
  }

  // Extract options with defaults
  const {
    expiresIn = 900, // 15 minutes
    issuer = process.env.JWT_ISSUER || 'ocr-api.example.com',
    audience = process.env.JWT_AUDIENCE || 'ocr-api',
    notBefore = 0, // Valid immediately
  } = options

  // Calculate timestamps
  const now = Math.floor(Date.now() / 1000)
  const exp = now + expiresIn
  const nbf = now + notBefore

  // Build JWT claims
  const claims = {
    // Standard claims (RFC 7519)
    iss: issuer, // Issuer
    sub: payload.tenantId, // Subject (tenant ID)
    aud: audience, // Audience
    exp: exp, // Expiration time
    iat: now, // Issued at
    nbf: nbf, // Not before
    jti: generateTokenId(), // JWT ID (unique identifier)

    // Custom claims (tenant-specific metadata)
    tenant_id: payload.tenantId, // Tenant identifier
    tenant_name: payload.tenantName, // Tenant display name (optional)
    permissions: payload.permissions, // Granted permissions
    rate_limit_tier: payload.rateLimitTier, // Rate limit tier
  }

  // Sign token with RS256 private key
  try {
    const token = await sign(claims, JWT_PRIVATE_KEY, 'RS256')
    return token
  } catch (error) {
    throw new HTTPException(500, {
      message: 'Failed to sign JWT token',
      cause: error,
    })
  }
}

/**
 * Generate a refresh token for token renewal.
 *
 * NOTE: This is a placeholder for future implementation.
 * Refresh tokens should:
 * - Have longer expiration (7-30 days)
 * - Be stored in database for revocation
 * - Be rotated on each use
 * - Include only tenant_id claim (no permissions)
 *
 * @param tenantId - Tenant identifier
 * @returns Refresh token (placeholder - throws error)
 * @throws Error - Not implemented
 */
export async function generateRefreshToken(tenantId: string): Promise<string> {
  throw new Error(
    'Refresh tokens not implemented. Use short-lived access tokens with re-authentication.'
  )
}

/**
 * Validate token generation payload.
 *
 * Ensures all required fields are present and valid before generating a token.
 * This helps catch errors early and provides clear error messages.
 *
 * @param payload - Tenant token payload to validate
 * @throws HTTPException(400) if payload is invalid
 *
 * @example
 * ```typescript
 * validateTokenPayload({
 *   tenantId: 'tenant-abc123',
 *   permissions: ['ocr:process'],
 *   rateLimitTier: 'free',
 * }) // No error - valid payload
 *
 * validateTokenPayload({
 *   tenantId: '',
 *   permissions: [],
 *   rateLimitTier: 'invalid',
 * }) // Throws HTTPException(400)
 * ```
 */
export function validateTokenPayload(payload: TenantTokenPayload): void {
  // Validate tenant ID
  if (!payload.tenantId || payload.tenantId.trim().length === 0) {
    throw new HTTPException(400, {
      message: 'Invalid token payload: tenantId is required and cannot be empty',
    })
  }

  // Validate permissions array
  if (!Array.isArray(payload.permissions)) {
    throw new HTTPException(400, {
      message: 'Invalid token payload: permissions must be an array',
    })
  }

  // Validate rate limit tier
  const validTiers = ['free', 'standard', 'premium'] as const
  if (!validTiers.includes(payload.rateLimitTier)) {
    throw new HTTPException(400, {
      message: `Invalid token payload: rateLimitTier must be one of ${validTiers.join(', ')}`,
    })
  }
}
