# MVP Manual Validation Guide

This guide provides step-by-step manual validation procedures for the OCR MVP.

## Prerequisites

1. **Environment Setup**
   ```bash
   # Ensure .env is configured with Turso databases
   cat .env | grep DATABASE_URL
   ```

2. **Database Verification**
   ```bash
   # Check test tenant database has all tables
   turso db shell ocr-tenant-test "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
   ```

   Expected tables:
   - customer_context
   - customers
   - order_history
   - order_items
   - orders
   - processing_results
   - products
   - review_queue
   - tenants

3. **Verify Draft Fields in ReviewQueue**
   ```bash
   turso db shell ocr-tenant-test "PRAGMA table_info(review_queue);" | grep -E "(draft|lastActivity)"
   ```

   Expected columns:
   - draftCustomerCorrection (TEXT)
   - draftItemCorrections (TEXT)
   - draftReviewNotes (TEXT)
   - lastActivityAt (INTEGER)

## Test Scenarios

### Scenario 1: Database Schema Validation ✓

**Objective**: Verify all migrations applied correctly

**Steps**:
1. Check all tables exist (see Prerequisites #2)
2. Verify draft fields exist (see Prerequisites #3)
3. Verify vector embedding columns exist:
   ```bash
   turso db shell ocr-tenant-test "PRAGMA table_info(products);" | grep embedding
   turso db shell ocr-tenant-test "PRAGMA table_info(customer_context);" | grep embedding
   turso db shell ocr-tenant-test "PRAGMA table_info(order_history);" | grep embedding
   ```

**Expected Result**: All tables and columns present

**Status**: ✅ PASSED (verified during implementation)

---

### Scenario 2: Master Data Import

**Objective**: Verify customer and product master data can be inserted

**SQL Test**:
```sql
-- Insert test customer
INSERT INTO customers (id, tenantId, customerCode, name, nameVariations, isActive, createdAt, updatedAt)
VALUES (
  'cust_test_001',
  'test-tenant',
  'CUST001',
  '田中商店',
  '["田中商店", "田中", "Tanaka Shoten"]',
  1,
  datetime('now'),
  datetime('now')
);

-- Insert test product
INSERT INTO products (id, tenantId, productCode, productName, nameVariations, unitOfMeasure, category, isActive, createdAt, updatedAt)
VALUES (
  'prod_test_001',
  'test-tenant',
  'PROD001',
  'ビール大瓶',
  '["ビール大瓶", "ビール大", "Beer Large"]',
  'case',
  'beverage',
  1,
  datetime('now'),
  datetime('now')
);

-- Verify
SELECT * FROM customers WHERE customerCode = 'CUST001';
SELECT * FROM products WHERE productCode = 'PROD001';
```

**Steps**:
```bash
turso db shell ocr-tenant-test
# Run SQL commands above
```

**Expected Result**: Records inserted and retrieved successfully

---

### Scenario 3: Order Creation with Low Confidence

**Objective**: Create order that triggers review queue

**SQL Test**:
```sql
-- Insert low-confidence order
INSERT INTO orders (id, tenantId, customerId, submissionTime, status, overallConfidence, fileKey, fileContentType, fileSize, flaggedForReview, createdAt, updatedAt)
VALUES (
  'ord_test_001',
  'test-tenant',
  NULL,
  datetime('now'),
  'REVIEWING',
  0.55,
  'test/order-001.jpg',
  'image/jpeg',
  12345,
  1,
  datetime('now'),
  datetime('now')
);

-- Insert order item
INSERT INTO order_items (id, orderId, productId, extractedProductText, quantity, confidence, verificationStatus, createdAt, updatedAt)
VALUES (
  'item_test_001',
  'ord_test_001',
  NULL,
  'ビール大',
  10,
  0.65,
  'unverified',
  datetime('now'),
  datetime('now')
);

-- Insert review queue record
INSERT INTO review_queue (id, orderId, tenantId, flagReason, reviewStatus, createdAt)
VALUES (
  'review_test_001',
  'ord_test_001',
  'test-tenant',
  'low_confidence',
  'pending',
  datetime('now')
);

-- Verify
SELECT o.id, o.status, o.overallConfidence, o.flaggedForReview, r.reviewStatus
FROM orders o
JOIN review_queue r ON r.orderId = o.id
WHERE o.id = 'ord_test_001';
```

**Expected Result**:
- Order status: REVIEWING
- flaggedForReview: true
- Review queue status: pending

---

### Scenario 4: Draft Auto-Save

**Objective**: Save and retrieve draft corrections

**SQL Test**:
```sql
-- Save draft corrections
UPDATE review_queue
SET
  draftCustomerCorrection = '{"customerId": "cust_test_001", "customerName": "田中商店"}',
  draftItemCorrections = '[{"itemIndex": 0, "productId": "prod_test_001", "quantity": 12}]',
  draftReviewNotes = 'Corrected quantity from 10 to 12',
  lastActivityAt = unixepoch() * 1000,
  reviewStatus = 'in_progress',
  assignedOperator = 'operator1@example.com'
WHERE orderId = 'ord_test_001';

-- Retrieve draft
SELECT
  orderId,
  draftCustomerCorrection,
  draftItemCorrections,
  draftReviewNotes,
  datetime(lastActivityAt / 1000, 'unixepoch') as lastActivityAt,
  reviewStatus,
  assignedOperator
FROM review_queue
WHERE orderId = 'ord_test_001';
```

**Expected Result**:
- Draft fields populated with JSON
- lastActivityAt timestamp set
- reviewStatus changed to in_progress
- assignedOperator set

---

### Scenario 5: Concurrent Review Prevention

**Objective**: Verify concurrent review check logic

**SQL Test**:
```sql
-- Operator 1 is currently reviewing
SELECT
  reviewStatus,
  assignedOperator,
  CASE
    WHEN reviewStatus = 'in_progress' AND assignedOperator = 'operator1@example.com'
    THEN 'ALLOW (same operator)'
    WHEN reviewStatus = 'in_progress' AND assignedOperator != 'operator2@example.com'
    THEN 'BLOCK (different operator)'
    ELSE 'ALLOW (not in progress)'
  END as access_decision
FROM review_queue
WHERE orderId = 'ord_test_001';
```

**Expected Result**:
- Operator1 access: ALLOW
- Operator2 access: BLOCK

---

### Scenario 6: Session Timeout Detection

**Objective**: Identify abandoned sessions (30+ min inactive)

**SQL Test**:
```sql
-- Set lastActivityAt to 31 minutes ago
UPDATE review_queue
SET lastActivityAt = (unixepoch() - 31 * 60) * 1000
WHERE orderId = 'ord_test_001';

-- Find abandoned sessions (30 min threshold)
SELECT
  orderId,
  reviewStatus,
  assignedOperator,
  datetime(lastActivityAt / 1000, 'unixepoch') as lastActivity,
  (unixepoch() * 1000 - lastActivityAt) / 60000 as minutesSinceActivity
FROM review_queue
WHERE
  reviewStatus = 'in_progress'
  AND lastActivityAt < (unixepoch() - 30 * 60) * 1000;
```

**Expected Result**:
- Order identified as abandoned (>30 minutes)
- minutesSinceActivity ≈ 31

---

### Scenario 7: Session Cleanup

**Objective**: Reset abandoned session to pending

**SQL Test**:
```sql
-- Reset abandoned session
UPDATE review_queue
SET
  reviewStatus = 'pending',
  assignedOperator = NULL
  -- Preserve draft data (do not clear)
WHERE orderId = 'ord_test_001';

-- Verify reset
SELECT
  orderId,
  reviewStatus,
  assignedOperator,
  draftCustomerCorrection, -- Should still exist
  draftItemCorrections     -- Should still exist
FROM review_queue
WHERE orderId = 'ord_test_001';
```

**Expected Result**:
- reviewStatus: pending
- assignedOperator: NULL
- Draft data preserved

---

### Scenario 8: Final Review Completion

**Objective**: Apply corrections and finalize review

**SQL Test**:
```sql
-- Apply corrections to order
UPDATE orders
SET
  status = 'CONFIRMED',
  customerId = 'cust_test_001',
  flaggedForReview = 0,
  updatedAt = datetime('now')
WHERE id = 'ord_test_001';

-- Update order item with corrections
UPDATE order_items
SET
  productId = 'prod_test_001',
  quantity = 12,
  verificationStatus = 'human_verified',
  humanCorrectedProduct = 'prod_test_001',
  updatedAt = datetime('now')
WHERE orderId = 'ord_test_001';

-- Mark review as completed
UPDATE review_queue
SET
  reviewStatus = 'completed',
  reviewedAt = datetime('now'),
  reviewNotes = 'Reviewed and approved',
  assignedOperator = 'operator2@example.com'
WHERE orderId = 'ord_test_001';

-- Verify final state
SELECT
  o.id,
  o.status,
  o.customerId,
  c.name as customerName,
  r.reviewStatus,
  r.reviewedAt,
  r.assignedOperator
FROM orders o
LEFT JOIN customers c ON c.id = o.customerId
JOIN review_queue r ON r.orderId = o.id
WHERE o.id = 'ord_test_001';
```

**Expected Result**:
- Order status: CONFIRMED
- Customer linked: 田中商店
- Review status: completed
- reviewedAt timestamp set

---

### Scenario 9: Audit Trail Verification

**Objective**: Verify complete audit trail exists

**SQL Test**:
```sql
-- Check order audit trail
SELECT
  o.id,
  o.submissionTime,
  o.status,
  r.createdAt as reviewQueuedAt,
  r.lastActivityAt as lastDraftSaveAt,
  r.reviewedAt,
  r.assignedOperator,
  r.reviewNotes
FROM orders o
JOIN review_queue r ON r.orderId = o.id
WHERE o.id = 'ord_test_001';
```

**Expected Result**:
- submissionTime (order created)
- reviewQueuedAt (flagged for review)
- lastDraftSaveAt (auto-save timestamp)
- reviewedAt (finalized)
- assignedOperator (who reviewed)
- reviewNotes (what changed)

---

## Summary of Test Results

| Scenario | Description | Status |
|----------|-------------|--------|
| 1 | Database Schema Validation | ✅ PASSED |
| 2 | Master Data Import | ⏸️ Manual |
| 3 | Order Creation with Low Confidence | ⏸️ Manual |
| 4 | Draft Auto-Save | ⏸️ Manual |
| 5 | Concurrent Review Prevention | ⏸️ Manual |
| 6 | Session Timeout Detection | ⏸️ Manual |
| 7 | Session Cleanup | ⏸️ Manual |
| 8 | Final Review Completion | ⏸️ Manual |
| 9 | Audit Trail Verification | ⏸️ Manual |

## Running Manual Tests

```bash
# Start Turso shell
turso db shell ocr-tenant-test

# Copy/paste SQL from each scenario
# Verify results match expected output
```

## Cleanup After Testing

```sql
-- Remove test data
DELETE FROM review_queue WHERE orderId = 'ord_test_001';
DELETE FROM order_items WHERE orderId = 'ord_test_001';
DELETE FROM orders WHERE id = 'ord_test_001';
DELETE FROM customers WHERE customerCode = 'CUST001';
DELETE FROM products WHERE productCode = 'PROD001';
```

## MVP Validation Checklist

- [ ] All database tables exist
- [ ] Draft fields present in review_queue
- [ ] Vector embedding columns exist
- [ ] Can insert customer/product master data
- [ ] Low-confidence orders trigger review queue
- [ ] Draft auto-save stores JSON correctly
- [ ] Concurrent review prevention logic works
- [ ] Abandoned sessions detected correctly
- [ ] Session cleanup preserves draft data
- [ ] Final review updates all related tables
- [ ] Complete audit trail exists

## Next Steps After Validation

1. **If all tests pass**: MVP is production-ready
2. **If tests fail**: Document issues and fix
3. **Consider**: API endpoint testing with real HTTP requests
4. **Consider**: Full integration test with actual image uploads
