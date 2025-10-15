// tests/unit/jwt.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { verify } from 'hono/jwt'
import { generateTenantToken, validateTokenPayload } from '../../src/lib/jwt.js'
import type { TenantTokenPayload } from '../../src/lib/jwt.js'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Test suite for JWT token generation utility.
 *
 * **Test Coverage**:
 * - Valid token generation with all claims
 * - Token signature verification (RS256)
 * - Standard JWT claims (iss, sub, aud, exp, iat, nbf, jti)
 * - Custom claims (tenant_id, permissions, rate_limit_tier)
 * - Configurable expiration times
 * - Custom issuer and audience
 * - Payload validation (required fields, valid types)
 * - Error handling (missing private key, invalid payload)
 */

describe('JWT Token Generation Utility', () => {
  let originalEnv: {
    JWT_PRIVATE_KEY?: string
    JWT_PUBLIC_KEY?: string
    JWT_ISSUER?: string
    JWT_AUDIENCE?: string
  }

  // Load RSA keys from test fixtures
  const PRIVATE_KEY = fs.readFileSync(
    path.join(__dirname, '../fixtures/keys/private.pem'),
    'utf-8'
  )
  const PUBLIC_KEY = fs.readFileSync(
    path.join(__dirname, '../fixtures/keys/public.pem'),
    'utf-8'
  )

  beforeEach(() => {
    // Save original environment variables
    originalEnv = {
      JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
      JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
      JWT_ISSUER: process.env.JWT_ISSUER,
      JWT_AUDIENCE: process.env.JWT_AUDIENCE,
    }

    // Set test environment variables
    process.env.JWT_PRIVATE_KEY = PRIVATE_KEY
    process.env.JWT_PUBLIC_KEY = PUBLIC_KEY
    process.env.JWT_ISSUER = 'test-ocr-api.example.com'
    process.env.JWT_AUDIENCE = 'test-ocr-api'
  })

  afterEach(() => {
    // Restore original environment variables
    if (originalEnv.JWT_PRIVATE_KEY !== undefined) {
      process.env.JWT_PRIVATE_KEY = originalEnv.JWT_PRIVATE_KEY
    } else {
      delete process.env.JWT_PRIVATE_KEY
    }

    if (originalEnv.JWT_PUBLIC_KEY !== undefined) {
      process.env.JWT_PUBLIC_KEY = originalEnv.JWT_PUBLIC_KEY
    } else {
      delete process.env.JWT_PUBLIC_KEY
    }

    if (originalEnv.JWT_ISSUER !== undefined) {
      process.env.JWT_ISSUER = originalEnv.JWT_ISSUER
    } else {
      delete process.env.JWT_ISSUER
    }

    if (originalEnv.JWT_AUDIENCE !== undefined) {
      process.env.JWT_AUDIENCE = originalEnv.JWT_AUDIENCE
    } else {
      delete process.env.JWT_AUDIENCE
    }
  })

  describe('Token Generation', () => {
    it('should generate a valid JWT token with all required claims', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-abc123',
        tenantName: 'Acme Corp',
        permissions: ['ocr:process', 'ocr:review', 'master:import'],
        rateLimitTier: 'standard',
      }

      const token = await generateTenantToken(payload)

      // Verify token is a non-empty string
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)

      // Verify token has three parts (header.payload.signature)
      const parts = token.split('.')
      expect(parts).toHaveLength(3)
    })

    it('should generate a token that can be verified with the public key', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-xyz789',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)

      // Verify token with public key
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      // Check standard claims
      expect(decoded.iss).toBe('test-ocr-api.example.com')
      expect(decoded.sub).toBe('tenant-xyz789')
      expect(decoded.aud).toBe('test-ocr-api')
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
      expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
      expect(decoded.nbf).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
      expect(decoded.jti).toBeDefined()

      // Check custom claims
      expect(decoded.tenant_id).toBe('tenant-xyz789')
      expect(decoded.permissions).toEqual(['ocr:process'])
      expect(decoded.rate_limit_tier).toBe('free')
    })

    it('should include tenant_name in token when provided', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-test-001',
        tenantName: 'Test Corporation',
        permissions: ['ocr:process'],
        rateLimitTier: 'premium',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.tenant_name).toBe('Test Corporation')
    })

    it('should generate token without tenant_name when not provided', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-test-002',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.tenant_name).toBeUndefined()
    })
  })

  describe('Token Expiration', () => {
    it('should use default expiration (15 minutes) when not specified', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-exp-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      const now = Math.floor(Date.now() / 1000)
      const expectedExp = now + 900 // 15 minutes

      // Allow 2 second tolerance for test execution time
      expect(decoded.exp).toBeGreaterThanOrEqual(expectedExp - 2)
      expect(decoded.exp).toBeLessThanOrEqual(expectedExp + 2)
    })

    it('should use custom expiration when specified', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-exp-002',
        permissions: ['ocr:process'],
        rateLimitTier: 'standard',
      }

      const token = await generateTenantToken(payload, { expiresIn: 3600 }) // 1 hour
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      const now = Math.floor(Date.now() / 1000)
      const expectedExp = now + 3600

      // Allow 2 second tolerance
      expect(decoded.exp).toBeGreaterThanOrEqual(expectedExp - 2)
      expect(decoded.exp).toBeLessThanOrEqual(expectedExp + 2)
    })

    it('should support short-lived tokens (60 seconds)', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-exp-003',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload, { expiresIn: 60 })
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      const now = Math.floor(Date.now() / 1000)
      const expectedExp = now + 60

      expect(decoded.exp).toBeGreaterThanOrEqual(expectedExp - 2)
      expect(decoded.exp).toBeLessThanOrEqual(expectedExp + 2)
    })
  })

  describe('Custom Issuer and Audience', () => {
    it('should use custom issuer when specified', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-iss-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload, {
        issuer: 'custom-issuer.example.com',
      })
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.iss).toBe('custom-issuer.example.com')
    })

    it('should use custom audience when specified', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-aud-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload, {
        audience: 'custom-audience',
      })
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.aud).toBe('custom-audience')
    })

    it('should fall back to default issuer from env when not specified', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-default-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.iss).toBe('test-ocr-api.example.com')
    })
  })

  describe('Rate Limit Tiers', () => {
    it('should support free tier', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-tier-free',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.rate_limit_tier).toBe('free')
    })

    it('should support standard tier', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-tier-standard',
        permissions: ['ocr:process'],
        rateLimitTier: 'standard',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.rate_limit_tier).toBe('standard')
    })

    it('should support premium tier', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-tier-premium',
        permissions: ['ocr:process'],
        rateLimitTier: 'premium',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.rate_limit_tier).toBe('premium')
    })
  })

  describe('Permissions', () => {
    it('should support single permission', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-perm-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.permissions).toEqual(['ocr:process'])
    })

    it('should support multiple permissions', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-perm-002',
        permissions: ['ocr:process', 'ocr:review', 'master:import', 'master:export'],
        rateLimitTier: 'premium',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.permissions).toEqual([
        'ocr:process',
        'ocr:review',
        'master:import',
        'master:export',
      ])
    })

    it('should support empty permissions array', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-perm-003',
        permissions: [],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      expect(decoded.permissions).toEqual([])
    })
  })

  describe('Unique Token IDs', () => {
    it('should generate unique jti for each token', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-jti-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token1 = await generateTenantToken(payload)
      const token2 = await generateTenantToken(payload)

      const decoded1 = await verify(token1, PUBLIC_KEY, 'RS256')
      const decoded2 = await verify(token2, PUBLIC_KEY, 'RS256')

      expect(decoded1.jti).toBeDefined()
      expect(decoded2.jti).toBeDefined()
      expect(decoded1.jti).not.toBe(decoded2.jti)
    })

    it('should generate jti in expected format (timestamp-random)', async () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-jti-002',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      const token = await generateTenantToken(payload)
      const decoded = await verify(token, PUBLIC_KEY, 'RS256')

      // JTI format: {timestamp}-{random}
      expect(typeof decoded.jti).toBe('string')
      expect(decoded.jti).toMatch(/^\d+-[a-z0-9]+$/)
    })
  })

  describe('Payload Validation', () => {
    it('should validate payload with valid data', () => {
      const payload: TenantTokenPayload = {
        tenantId: 'tenant-valid-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      expect(() => validateTokenPayload(payload)).not.toThrow()
    })

    it('should throw error when tenantId is empty', () => {
      const payload: TenantTokenPayload = {
        tenantId: '',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      expect(() => validateTokenPayload(payload)).toThrow(
        'tenantId is required and cannot be empty'
      )
    })

    it('should throw error when tenantId is whitespace', () => {
      const payload: TenantTokenPayload = {
        tenantId: '   ',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      expect(() => validateTokenPayload(payload)).toThrow(
        'tenantId is required and cannot be empty'
      )
    })

    it('should throw error when permissions is not an array', () => {
      const payload = {
        tenantId: 'tenant-invalid-001',
        permissions: 'not-an-array', // Invalid type
        rateLimitTier: 'free',
      } as any

      expect(() => validateTokenPayload(payload)).toThrow('permissions must be an array')
    })

    it('should throw error when rateLimitTier is invalid', () => {
      const payload = {
        tenantId: 'tenant-invalid-002',
        permissions: ['ocr:process'],
        rateLimitTier: 'enterprise', // Invalid tier
      } as any

      expect(() => validateTokenPayload(payload)).toThrow(
        'rateLimitTier must be one of free, standard, premium'
      )
    })
  })

  describe('Error Handling', () => {
    it('should throw error when JWT_PRIVATE_KEY is not configured', async () => {
      delete process.env.JWT_PRIVATE_KEY

      const payload: TenantTokenPayload = {
        tenantId: 'tenant-error-001',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      await expect(generateTenantToken(payload)).rejects.toThrow(
        'JWT_PRIVATE_KEY environment variable not configured'
      )
    })

    it('should throw error when private key is invalid', async () => {
      process.env.JWT_PRIVATE_KEY = 'invalid-key'

      const payload: TenantTokenPayload = {
        tenantId: 'tenant-error-002',
        permissions: ['ocr:process'],
        rateLimitTier: 'free',
      }

      await expect(generateTenantToken(payload)).rejects.toThrow('Failed to sign JWT token')
    })
  })
})
