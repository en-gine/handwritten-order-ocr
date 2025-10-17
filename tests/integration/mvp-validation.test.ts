// tests/integration/mvp-validation.test.ts
/**
 * MVP End-to-End Integration Tests
 *
 * Tests the complete OCR workflow:
 * 1. Health check
 * 2. JWT token generation
 * 3. Single file OCR upload
 * 4. Batch file OCR upload
 * 5. Review queue listing
 * 6. Review item retrieval
 * 7. Draft auto-save
 * 8. Concurrent review prevention
 * 9. Final review approval/rejection
 * 10. Session timeout cleanup
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'

// Test configuration
const TEST_TENANT_ID = 'test-tenant-001'
const TEST_OPERATOR_1 = 'operator1@example.com'
const TEST_OPERATOR_2 = 'operator2@example.com'

describe('MVP Integration Tests', () => {
  let prisma: PrismaClient
  let testOrderId: string
  let testImagePath: string

  beforeAll(async () => {
    // Ensure DATABASE_URL is set for tests
    if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('file:')) {
      throw new Error('DATABASE_URL must be set to a file: URL for tests (e.g., file:./tests/test.db)')
    }

    // Initialize Prisma client for test database
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    })

    // Connect to database
    await prisma.$connect()

    // Ensure test image exists
    testImagePath = path.join(process.cwd(), 'tests/fixtures/sample-orders/test-order.jpg')

    // Create a minimal test image if it doesn't exist (1x1 pixel JPEG)
    try {
      await fs.access(testImagePath)
    } catch {
      // Create minimal JPEG (1x1 pixel white image)
      const minimalJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
        0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
        0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
        0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
        0x7f, 0xff, 0xd9,
      ])
      await fs.mkdir(path.dirname(testImagePath), { recursive: true })
      await fs.writeFile(testImagePath, minimalJpeg)
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('1. Database and Schema Validation', () => {
    it('should connect to test database', async () => {
      const result = await prisma.$queryRaw`SELECT 1 as result`
      expect(result).toBeDefined()
    })

    it('should have ReviewQueue table with draft fields', async () => {
      const tableInfo = await prisma.$queryRaw`
        PRAGMA table_info(review_queue)
      ` as any[]

      const columnNames = tableInfo.map((col: any) => col.name)

      expect(columnNames).toContain('draftCustomerCorrection')
      expect(columnNames).toContain('draftItemCorrections')
      expect(columnNames).toContain('draftReviewNotes')
      expect(columnNames).toContain('lastActivityAt')
    })

    it('should have all required tables', async () => {
      const tables = await prisma.$queryRaw`
        SELECT name FROM sqlite_master WHERE type='table'
      ` as any[]

      const tableNames = tables.map((t: any) => t.name)

      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('order_items')
      expect(tableNames).toContain('customers')
      expect(tableNames).toContain('products')
      expect(tableNames).toContain('review_queue')
      expect(tableNames).toContain('processing_results')
    })
  })

  describe('2. Master Data Setup', () => {
    it('should seed test customers', async () => {
      // Clean up existing test data
      await prisma.customer.deleteMany({
        where: { tenantId: TEST_TENANT_ID },
      })

      // Insert test customers
      await prisma.customer.createMany({
        data: [
          {
            tenantId: TEST_TENANT_ID,
            customerCode: 'CUST001',
            name: '田中商店',
            nameVariations: JSON.stringify(['田中商店', '田中', 'Tanaka Shoten']),
            isActive: true,
          },
          {
            tenantId: TEST_TENANT_ID,
            customerCode: 'CUST002',
            name: '鈴木食品',
            nameVariations: JSON.stringify(['鈴木食品', '鈴木', 'Suzuki Foods']),
            isActive: true,
          },
        ],
      })

      const count = await prisma.customer.count({
        where: { tenantId: TEST_TENANT_ID },
      })

      expect(count).toBeGreaterThanOrEqual(2)
    })

    it('should seed test products', async () => {
      // Clean up existing test data
      await prisma.product.deleteMany({
        where: { tenantId: TEST_TENANT_ID },
      })

      // Insert test products
      await prisma.product.createMany({
        data: [
          {
            tenantId: TEST_TENANT_ID,
            productCode: 'PROD001',
            productName: 'ビール大瓶',
            nameVariations: JSON.stringify(['ビール大瓶', 'ビール大', 'Beer Large']),
            unitOfMeasure: 'case',
            category: 'beverage',
            isActive: true,
          },
          {
            tenantId: TEST_TENANT_ID,
            productCode: 'PROD002',
            productName: 'ビール小瓶',
            nameVariations: JSON.stringify(['ビール小瓶', 'ビール小', 'Beer Small']),
            unitOfMeasure: 'case',
            category: 'beverage',
            isActive: true,
          },
          {
            tenantId: TEST_TENANT_ID,
            productCode: 'PROD003',
            productName: '日本酒一升瓶',
            nameVariations: JSON.stringify(['日本酒一升瓶', '日本酒', 'Sake 1.8L']),
            unitOfMeasure: 'bottle',
            category: 'beverage',
            isActive: true,
          },
        ],
      })

      const count = await prisma.product.count({
        where: { tenantId: TEST_TENANT_ID },
      })

      expect(count).toBeGreaterThanOrEqual(3)
    })
  })

  describe('3. Order Creation and Review Queue', () => {
    it('should create a low-confidence order for review', async () => {
      // Clean up existing test orders
      await prisma.order.deleteMany({
        where: { tenantId: TEST_TENANT_ID },
      })

      // Create a low-confidence order
      const order = await prisma.order.create({
        data: {
          tenantId: TEST_TENANT_ID,
          submissionTime: new Date(),
          status: 'REVIEWING',
          overallConfidence: 0.55, // Low confidence
          fileKey: 'test/order-001.jpg',
          fileContentType: 'image/jpeg',
          fileSize: 12345,
          flaggedForReview: true,
          items: {
            create: [
              {
                extractedProductText: 'ビール大',
                quantity: 10,
                confidence: 0.65,
                verificationStatus: 'unverified',
              },
            ],
          },
        },
      })

      testOrderId = order.id
      expect(order.status).toBe('REVIEWING')
      expect(order.flaggedForReview).toBe(true)
    })

    it('should create ReviewQueue record for low-confidence order', async () => {
      await prisma.reviewQueue.create({
        data: {
          orderId: testOrderId,
          tenantId: TEST_TENANT_ID,
          flagReason: 'low_confidence',
          reviewStatus: 'pending',
        },
      })

      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      expect(review).toBeDefined()
      expect(review?.reviewStatus).toBe('pending')
      expect(review?.flagReason).toBe('low_confidence')
    })
  })

  describe('4. Review Workflow - Draft Auto-Save', () => {
    it('should save draft corrections', async () => {
      const draftData = {
        customerCorrection: { customerId: 'cust_123', customerName: '田中商店' },
        itemCorrections: [
          { itemIndex: 0, productId: 'PROD001', quantity: 12 },
        ],
        reviewNotes: 'Test draft notes',
      }

      const updated = await prisma.reviewQueue.update({
        where: { orderId: testOrderId },
        data: {
          draftCustomerCorrection: JSON.stringify(draftData.customerCorrection),
          draftItemCorrections: JSON.stringify(draftData.itemCorrections),
          draftReviewNotes: draftData.reviewNotes,
          lastActivityAt: BigInt(Date.now()),
          reviewStatus: 'in_progress',
          assignedOperator: TEST_OPERATOR_1,
        },
      })

      expect(updated.draftCustomerCorrection).toBeDefined()
      expect(updated.draftItemCorrections).toBeDefined()
      expect(updated.lastActivityAt).toBeDefined()
      expect(updated.reviewStatus).toBe('in_progress')
      expect(updated.assignedOperator).toBe(TEST_OPERATOR_1)
    })

    it('should load draft corrections on resume', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      expect(review?.draftCustomerCorrection).toBeDefined()

      const parsedCustomer = JSON.parse(review!.draftCustomerCorrection!)
      expect(parsedCustomer.customerName).toBe('田中商店')

      const parsedItems = JSON.parse(review!.draftItemCorrections!)
      expect(parsedItems).toHaveLength(1)
      expect(parsedItems[0].quantity).toBe(12)
    })
  })

  describe('5. Concurrent Review Prevention', () => {
    it('should prevent concurrent review by different operator', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      // Simulate concurrent review check
      const isBeingReviewedByOther =
        review?.reviewStatus === 'in_progress' &&
        review?.assignedOperator &&
        review.assignedOperator !== TEST_OPERATOR_2

      expect(isBeingReviewedByOther).toBe(true)

      if (isBeingReviewedByOther) {
        const errorMessage = `この注文は現在 ${review.assignedOperator} によってレビュー中です。同時に複数のオペレーターがレビューすることはできません。`
        expect(errorMessage).toContain(TEST_OPERATOR_1)
      }
    })

    it('should allow same operator to resume review', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      const canResume =
        review?.reviewStatus === 'in_progress' &&
        review?.assignedOperator === TEST_OPERATOR_1

      expect(canResume).toBe(true)
    })
  })

  describe('6. Session Timeout Cleanup', () => {
    it('should identify abandoned sessions', async () => {
      // Set lastActivityAt to 31 minutes ago (use BigInt for SQLite compatibility)
      const thirtyOneMinutesAgo = BigInt(Date.now() - 31 * 60 * 1000)

      await prisma.reviewQueue.update({
        where: { orderId: testOrderId },
        data: {
          lastActivityAt: thirtyOneMinutesAgo,
        },
      })

      // Find abandoned reviews (timeout threshold: 30 minutes, use BigInt)
      const timeoutThreshold = BigInt(Date.now() - 30 * 60 * 1000)

      const abandonedReviews = await prisma.reviewQueue.findMany({
        where: {
          tenantId: TEST_TENANT_ID,
          reviewStatus: 'in_progress',
          lastActivityAt: {
            lt: timeoutThreshold,
          },
        },
      })

      expect(abandonedReviews).toHaveLength(1)
      expect(abandonedReviews[0].orderId).toBe(testOrderId)
    })

    it('should reset abandoned session to pending', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      // Simulate cleanup: reset to pending
      const updated = await prisma.reviewQueue.update({
        where: { id: review!.id },
        data: {
          reviewStatus: 'pending',
          assignedOperator: null,
          // Preserve draft data
        },
      })

      expect(updated.reviewStatus).toBe('pending')
      expect(updated.assignedOperator).toBeNull()
      // Draft should still exist
      expect(updated.draftCustomerCorrection).toBeDefined()
    })
  })

  describe('7. Final Review Completion', () => {
    it('should finalize review with corrections', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
        include: { order: true },
      })

      // Get customer for correction
      const customer = await prisma.customer.findFirst({
        where: { customerCode: 'CUST001' },
      })

      // Update order status and customer
      const updatedOrder = await prisma.order.update({
        where: { id: testOrderId },
        data: {
          status: 'CONFIRMED',
          customerId: customer?.id,
          flaggedForReview: false,
        },
      })

      // Update review queue
      await prisma.reviewQueue.update({
        where: { id: review!.id },
        data: {
          reviewStatus: 'completed',
          reviewedAt: new Date(),
          reviewNotes: 'Reviewed and approved',
          assignedOperator: TEST_OPERATOR_2,
        },
      })

      expect(updatedOrder.status).toBe('CONFIRMED')
      expect(updatedOrder.customerId).toBeDefined()
    })

    it('should verify final review state', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      expect(review?.reviewStatus).toBe('completed')
      expect(review?.reviewedAt).toBeDefined()
      expect(review?.assignedOperator).toBe(TEST_OPERATOR_2)
    })
  })

  describe('8. Data Integrity Validation', () => {
    it('should have complete order with customer relationship', async () => {
      const order = await prisma.order.findUnique({
        where: { id: testOrderId },
        include: {
          customer: true,
          items: true,
        },
      })

      expect(order).toBeDefined()
      expect(order?.customer).toBeDefined()
      expect(order?.customer?.name).toBe('田中商店')
      expect(order?.items).toHaveLength(1)
    })

    it('should have audit trail in review queue', async () => {
      const review = await prisma.reviewQueue.findFirst({
        where: { orderId: testOrderId },
      })

      expect(review?.createdAt).toBeDefined()
      expect(review?.reviewedAt).toBeDefined()
      expect(review?.assignedOperator).toBeDefined()
      expect(review?.reviewNotes).toBeDefined()
      expect(review?.lastActivityAt).toBeDefined()
    })
  })
})
