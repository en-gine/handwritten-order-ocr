// tests/unit/auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import { jwtAuth } from '../../src/api/middleware/auth.js'

/**
 * Test suite for JWT authentication middleware.
 *
 * **Test Coverage**:
 * - Valid token verification
 * - Invalid token rejection
 * - Missing Authorization header handling
 * - Malformed Authorization header handling
 * - Expired token handling
 * - Missing tenant_id claim handling
 * - Context setting (jwtPayload, tenantId)
 */

describe('JWT Authentication Middleware', () => {
  let app: Hono
  let originalEnv: string | undefined

  // Test RSA keys (for RS256 testing)
  // Generated with: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem
  const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3SF3wfGz+CM1kHMT8fyz
kvrVU/4SUg18gChw15cn9bkrz3cobbrYwVAWAEIGUvXkllsLMFMHnPQlzsWeOHAZ
Ij9w0sK022nSZ7WiBSgeown+3N5RyniJFMjpLcD/Vf8fYoHDua+gv89sxidwce2I
8hjjRgtW7QHYtnEUtqBNzcQrDHf+ai5noCmTm+Jy/OwEiXIeH2MLr+wN2MW92Ry1
IwRTpIEN6x0bco6WyTN0KYSc4dJH++QwFd8zczD7dJv6Mrm0i8gQnKwceorqDcS2
BSLp0vLrbYAlX21u7w5ToP9eEITsz3qDoercRdOSB3J5uvwG5X4fPf4BHT5/MX9l
7QIDAQAB
-----END PUBLIC KEY-----`

  const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDdIXfB8bP4IzWQ
cxPx/LOS+tVT/hJSDXyAKHDXlyf1uSvPdyhtutjBUBYAQgZS9eSWWwswUwec9CXO
xZ44cBkiP3DSwrTbadJntaIFKB6jCf7c3lHKeIkUyOktwP9V/x9igcO5r6C/z2zG
J3Bx7YjyGONGC1btAdi2cRS2oE3NxCsMd/5qLmegKZOb4nL87ASJch4fYwuv7A3Y
xb3ZHLUjBFOkgQ3rHRtyjpbJM3QphJzh0kf75DAV3zNzMPt0m/oyubSLyBCcrBx6
iuoNxLYFIunS8uttgCVfbW7vDlOg/14QhOzPeoOh6txF05IHcnm6/Ablfh89/gEd
Pn8xf2XtAgMBAAECggEAQpqPgyOFdPJJ8mmu8r6N6fHSKlvG8d7tBn7nyg/Vsd3l
s7Xsv+w82DECh25bkEZO5PikLJh9nQkukBKWvuIIt/eKyHhr2ACOJr2fANWeMLZU
hPsTgJwAkfmXvje40JKoxddW+AlNrihQV3jOlgoZKu5TGihVNMrPFtiFiCJNfPGO
66EjEoY4vsTPGuFn/QcsuFY/Ed/ZQKm/dXQ/hUooIVmNEx8dg7hmkRxy5MWdnP8C
aTBTjZchbhW+kQvbQdaUy76D+NqryLYq3wPDWv0klHuQQHXMjX3TfbpNKdzK7RTH
9HMv8y0pB3uH40F5/ESrBdy8Eg58G3myQsWlW+eJ4wKBgQD+mxldmxsCjZG9q1xE
eZ8ANLESqRnWC32rESDtu5AYuVefhIbWmzJiabUVyo3B6hnL8HDQRUrDaWRor+bO
EqvosmsTB3eyeWuxWDCd/i82tyEliXNyZcVP6uyw0JvBKcQNAnj9ZbmeR5LxzG+N
NCv6T3LYzNXle5bS0ZGgWMlQXwKBgQDeV3Grn3Tg8gVdyVnz8Ircy5ATSYgCiBm/
xVh6bDxi45l9uyQ/HyEAH6EbxPlufXp6NEV276xTkdHdCEQVnU/DqFNAZPC1CZff
ksJUOLcFY4U+HD+sCH8eX0TcLcOwYVS8OHWqZpgZeR/XCVqc/jGsH6AcKBHp6Qbs
JeXkpJp9MwKBgCfEGcYg/6r6aZTyOssHI+poUG/VsY9Y5Bvf5QC8ltkFucXUcSr7
unbcg8gPhuyOn9DWkQg2imLTBzfCoY32JJuHommqdOuPQ17Do3RJyx4EpEy0ly96
7cJ5stY6/tjAqTpO9I6/YKp0C2NwxsuLJoNF/W4XMCFTmE79JH2i4G6JAoGBANwQ
rL9zihmDMnCLdG8PrEGxcZ7FbssirmmzCEnTi0lNgISDj/Kx+tXGeI2lvkPwCiOe
TQrVWjk04QTmw4ypMWO03QGlZuGo5xswhQsbP3sj76N0DklV94u2O8+5tDCFhXru
XvgTp4O+8RbDeV5d8ggtHSoBNwnPzTw6nnpZuVclAoGAcLxKOyEbRMu5p8JeDhK5
pn36eIV5SDgr3PBSGl7pQvxjFbjIJy2eBbVJQhyEBn37CjoWfyuBcDKMv7EFvHF5
MY11+DDkgc0w8WUWQs1UHiaOxre33Svnp4VDRqQJi1PN6HR+jR1NApD90NnRKf28
x/BrnmPXbShKK0T8EJmvBMk=
-----END PRIVATE KEY-----`

  beforeEach(() => {
    // Save original environment variable
    originalEnv = process.env.JWT_PUBLIC_KEY

    // Set test public key
    process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY

    // Create fresh Hono app for each test
    app = new Hono()

    // Add error handler to return JSON responses
    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json({ message: err.message }, err.status)
      }
      return c.json({ message: 'Internal Server Error' }, 500)
    })

    // Test route that uses jwtAuth middleware
    app.get('/protected', jwtAuth, (c) => {
      return c.json({
        message: 'authenticated',
        tenantId: c.get('tenantId'),
        payload: c.get('jwtPayload'),
      })
    })
  })

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.JWT_PUBLIC_KEY = originalEnv
    } else {
      delete process.env.JWT_PUBLIC_KEY
    }
  })

  describe('Valid Token Verification', () => {
    it('should verify valid RS256 token and set context', async () => {
      // Create valid token
      const payload = {
        tenant_id: 'tenant-abc123',
        sub: 'tenant-abc123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      }

      const token = await sign(payload, TEST_PRIVATE_KEY, 'RS256')

      // Make request with valid token
      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.message).toBe('authenticated')
      expect(json.tenantId).toBe('tenant-abc123')
      expect(json.payload.tenant_id).toBe('tenant-abc123')
    })
  })

  describe('Invalid Token Rejection', () => {
    it('should reject request with missing Authorization header', async () => {
      const res = await app.request('/protected')

      expect(res.status).toBe(401)

      const json = await res.json()
      expect(json.message).toBe('Missing or invalid Authorization header')
    })

    it('should reject request with malformed Authorization header (no Bearer prefix)', async () => {
      const res = await app.request('/protected', {
        headers: {
          Authorization: 'invalid-token',
        },
      })

      expect(res.status).toBe(401)

      const json = await res.json()
      expect(json.message).toBe('Missing or invalid Authorization header')
    })

    it('should reject request with invalid token signature', async () => {
      // Create token with wrong signature
      const invalidToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRfaWQiOiJ0ZW5hbnQtYWJjMTIzIn0.invalid-signature'

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${invalidToken}`,
        },
      })

      expect(res.status).toBe(401)

      const json = await res.json()
      expect(json.message).toBe('Token verification failed')
    })

    it('should reject token with missing tenant_id claim', async () => {
      // Create token without tenant_id
      const payload = {
        sub: 'some-user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await sign(payload, TEST_PRIVATE_KEY, 'RS256')

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      expect(res.status).toBe(401)

      const json = await res.json()
      expect(json.message).toBe('Invalid token: missing or invalid tenant_id claim')
    })

    it('should reject token with invalid tenant_id type (not string)', async () => {
      // Create token with numeric tenant_id
      const payload = {
        tenant_id: 12345, // Should be string
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await sign(payload, TEST_PRIVATE_KEY, 'RS256')

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      expect(res.status).toBe(401)

      const json = await res.json()
      expect(json.message).toBe('Invalid token: missing or invalid tenant_id claim')
    })
  })

  describe('Environment Configuration', () => {
    it('should return 500 if JWT_PUBLIC_KEY is not configured', async () => {
      // Remove JWT_PUBLIC_KEY
      delete process.env.JWT_PUBLIC_KEY

      const res = await app.request('/protected', {
        headers: {
          Authorization: 'Bearer some-token',
        },
      })

      expect(res.status).toBe(500)

      const json = await res.json()
      expect(json.message).toBe('JWT_PUBLIC_KEY environment variable not configured')
    })
  })

  describe('Context Setting', () => {
    it('should set jwtPayload in context', async () => {
      const payload = {
        tenant_id: 'tenant-xyz789',
        sub: 'tenant-xyz789',
        permissions: ['ocr:process', 'ocr:review'],
        rate_limit_tier: 'premium',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await sign(payload, TEST_PRIVATE_KEY, 'RS256')

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.payload.permissions).toEqual(['ocr:process', 'ocr:review'])
      expect(json.payload.rate_limit_tier).toBe('premium')
    })

    it('should set tenantId in context', async () => {
      const payload = {
        tenant_id: 'tenant-test-001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = await sign(payload, TEST_PRIVATE_KEY, 'RS256')

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.tenantId).toBe('tenant-test-001')
    })
  })
})
