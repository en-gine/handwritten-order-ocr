# Tasks: Handwritten Order OCR Engine

**Branch**: `001-ocr-typescript-hono`
**Input**: Design documents from `/specs/001-ocr-typescript-hono/`
**Prerequisites**: plan.md (✅), spec.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅)

**Tests**: NOT requested in feature specification - no test tasks included

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- File paths use `src/` and repository root structure per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure required before any feature work

- [X] T001 Initialize Node.js project with TypeScript, Hono, Mastra, Prisma dependencies in package.json
- [X] T002 [P] Create project directory structure: src/api/, src/services/, src/lib/, src/types/, prisma/, tests/
- [X] T003 [P] Configure TypeScript compiler (tsconfig.json) with strict mode and ES2022 target
- [X] T004 [P] Setup ESLint and Prettier for code formatting
- [X] T005 [P] Create .env.example with environment variable template
- [X] T006 [P] Setup Vitest configuration for unit and integration tests in vitest.config.ts
- [X] T007 [P] Create .gitignore with Node.js, TypeScript, and environment file exclusions

**Checkpoint**: ✅ Project structure ready - foundation tasks can begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database Foundation

- [X] T008 Create Prisma schema in prisma/schema.prisma with Tenant, Order, OrderItem, Customer, Product, OrderHistory, CustomerContext, ReviewQueue, ProcessingResult models (per data-model.md)
- [X] T009 Generate initial Prisma migration for base schema
- [X] T010 Create Turso seed database template via CLI: `turso db create ocr-seed-db --group ai-ocr`
- [X] T011 Apply initial Prisma migration to seed database
- [X] T012 Create service database for tenant metadata: `turso db create ocr-service-db`
- [X] T013 Apply Tenant model migration to service database
- [X] T014 Create test tenant database: `turso db create ocr-tenant-test --from-db ocr-seed-db`
- [X] T015 Add raw SQL migration for F32_BLOB vector columns (products.embedding, customer_context.embedding, order_history.embedding) in migrations/002_add_vector_embeddings.sql
- [X] T016 Apply vector migration to seed database
- [X] T017 Create DiskANN vector indexes with cosine metric in migration SQL

### Core Libraries & Utilities

- [X] T018 [P] Implement Turso client factory with per-tenant database routing in src/lib/turso.ts (LRU cache for 100 tenants, 5-minute TTL)
- [X] T019 [P] Implement Gemini API wrapper with 3x retry and exponential backoff in src/lib/gemini.ts
- [X] T020 [P] Implement vector embedding utilities (vectorToBlob, blobToVector) in src/lib/vectors.ts
- [X] T021 [P] Create TypeScript type extensions for vector embeddings (ProductWithEmbedding, CustomerContextWithEmbedding, OrderHistoryWithEmbedding) in src/types/vectors.ts
- [X] T022 [P] Implement local file storage class (LocalFileStorage) in src/lib/storage/local.ts
- [X] T023 [P] Implement Cloudflare R2 storage class (R2FileStorage) in src/lib/storage/r2.ts
- [X] T024 [P] Create storage factory (createStorage) with environment-based switching in src/lib/storage/factory.ts
- [X] T025 [P] Define FileStorage interface in src/lib/storage/interface.ts
- [X] T026 [P] Implement configuration loader for AI model, thresholds, storage settings in src/lib/config.ts

### Authentication & Multi-Tenancy

- [X] T027 Implement JWT authentication middleware in src/api/middleware/auth.ts (RS256 verification, extract tenant_id claim)
- [X] T028 Implement tenant database routing middleware in src/api/middleware/tenant.ts (fetch tenant metadata from service DB, inject Prisma client into context)
- [X] T029 [P] Implement rate limiting middleware in src/api/middleware/rateLimit.ts (per-tenant limits based on rate_limit_tier claim)
- [X] T030 [P] Create JWT token generation utility in src/lib/jwt.ts (RS256 signing with tenant_id, permissions, rate_limit_tier claims)
- [X] T031 [P] Generate RSA key pair for JWT signing (private key for signing, public key for verification) and store in environment variables

### API Framework

- [X] T032 Initialize Hono app in src/api/index.ts with CORS, error handling, and middleware chain
- [X] T033 Create health check endpoint GET /health in src/api/routes/health.ts
- [X] T034 Setup API route structure: src/api/routes/ocr.ts, src/api/routes/review.ts, src/api/routes/master.ts, src/api/routes/tenants.ts
- [X] T035 Create server entry point in src/index.ts with graceful shutdown handling

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic Order Recognition (Priority: P1) 🎯 MVP

**Goal**: Process clearly handwritten order forms and return structured JSON with customer, products, quantities, and confidence scores (90%+ accuracy target)

**Independent Test**: Upload a clear handwritten order PDF/JPG via POST /v1/ocr, verify structured JSON response with customer info, product list, quantities, and confidence scores above 80%

### Implementation for User Story 1

- [X] T036 [P] [US1] Define OCR entity types in src/types/ocr.ts (OrderResponse, ExtractedCustomer, OrderItem, ProcessingResult)
- [X] T037 [P] [US1] Define API request/response types in src/types/api.ts (OCRUploadRequest, OCRUploadResponse)
- [X] T038 [US1] Implement file upload validation middleware in src/api/middleware/upload.ts (10MB limit, PDF/JPG/PNG only)
- [X] T039 [US1] Implement POST /v1/ocr endpoint in src/api/routes/ocr.ts (multipart/form-data parsing, file validation, async processing)
- [X] T040 [US1] Implement OCR service orchestration in src/services/ocr.service.ts (Mastra workflow: file upload → Gemini OCR → extraction → confidence scoring)
- [X] T041 [US1] Create Gemini prompt templates for Japanese handwriting OCR in src/lib/gemini.ts (extract customer info, product list, quantities)
- [X] T042 [US1] Implement product matching service in src/services/matching.service.ts (fuzzy match extracted product text against tenant's product master, return confidence scores)
- [X] T043 [US1] Implement confidence scoring logic in src/services/confidence.service.ts (per-field and overall confidence calculation, threshold comparison)
- [X] T044 [US1] Create Order record in database with status PROCESSING → CONFIRMED/REVIEWING based on confidence threshold
- [X] T045 [US1] Store uploaded file via storage factory (local or R2 based on environment)
- [X] T046 [US1] Save ProcessingResult record with raw Gemini response, extracted fields, confidence scores
- [X] T047 [US1] Return structured JSON response (orderId, status, overallConfidence, customer, items, submissionTime, processingTime)
- [X] T047a [US1] Implement batch upload endpoint POST /v1/ocr/batch (accept array of files in multipart/form-data, return array of OrderResponse with individual processing results)
- [X] T047b [US1] Add parallel processing with concurrency control for batch uploads (process up to 5 orders concurrently per tenant to prevent resource exhaustion, queue remaining orders)
- [X] T047c [US1] Implement batch result aggregation (return combined statistics: total processed, successful, failed, average confidence, total processing time)

**Checkpoint**: ✅ User Story 1 is fully functional - operators can upload clear order forms (single or batch) and receive accurate JSON output

---

## Phase 4: User Story 3 - Manual Review and Correction (Priority: P1) 🎯 MVP

**Goal**: Flag low-confidence orders for human review, allow operators to view original image, correct extracted data, and mark as human-verified

**Independent Test**: Upload a poorly written order form, verify it's flagged for review (confidence < 70%), retrieve it from review queue via GET /v1/reviews, correct data via PATCH /v1/reviews/{orderId}, verify order status updates to CONFIRMED

### Implementation for User Story 3

- [X] T048 [P] [US3] Define review queue types in src/types/api.ts (ReviewQueueItem, ReviewUpdateRequest, ReviewUpdateResponse)
- [X] T049 [US3] Implement GET /v1/reviews endpoint in src/api/routes/review.ts (list orders with flaggedForReview=true, filter by status/flagReason/date, pagination support)
- [X] T050 [US3] Implement GET /v1/reviews/{orderId} endpoint to retrieve single review item with original file presigned URL
- [X] T051 [US3] Implement PATCH /v1/reviews/{orderId} endpoint to update order with corrections (customerCorrection, itemCorrections, reviewNotes)
- [X] T052 [US3] Create ReviewQueue record when order confidence falls below threshold in src/services/ocr.service.ts
- [X] T053 [US3] Implement review service in src/services/review.service.ts (update order with corrections, mark items as human_verified, change status to CONFIRMED/REJECTED)
- [X] T054 [US3] Generate presigned URLs for original order images in review interface (1-hour expiry)
- [X] T055 [US3] Update OrderItem records with humanCorrectedProduct field when operator makes corrections
- [X] T056 [US3] Add review audit logging (who reviewed, what changed, when) in ProcessingResult or review_notes field
- [X] T056a [US3] Add draft fields to ReviewQueue model (draftCustomerCorrection, draftItemCorrections, draftReviewNotes as JSON strings) and lastActivityAt timestamp
- [X] T056b [US3] Implement PATCH /v1/reviews/{orderId}/draft endpoint for auto-save functionality (save partial corrections every 30 seconds with status=in_progress, update lastActivityAt)
- [X] T056c [US3] Implement concurrent review prevention in GET /v1/reviews/{orderId} (check if status=in_progress by another operator, return 409 Conflict with Japanese message including operator name)
- [X] T056d [US3] Implement review session timeout cleanup service (background job every 5 minutes: check lastActivityAt > 30 minutes → set assignedOperator=null, status=pending, preserve draft)
- [X] T056e [US3] Update review service to load draft on resume (when operator re-opens in_progress review, pre-populate form fields from draft JSON)
- [X] T056f [US3] Add auto-save status indicator to review response (return lastSavedAt timestamp, frontend calculates "保存済み: X分前")

**Checkpoint**: At this point, User Stories 1 AND 3 form a complete MVP - clear orders auto-process, unclear orders go to review queue with draft auto-save functionality

---

## Phase 5: User Story 5 - Customer Master Data Matching (Priority: P2)

**Goal**: Automatically match handwritten customer names/IDs to customer master database with 85%+ accuracy, enabling customer-specific context

**Independent Test**: Upload order forms with various customer identifiers (clear names, partial names, customer codes), verify system correctly matches to existing customer records with appropriate confidence scores

### Implementation for User Story 5

- [X] T057 [P] [US5] Define master data import schemas in src/types/master-data.ts (ProductImportSchema, CustomerImportSchema with Zod validation)
- [X] T058 [US5] Implement POST /v1/master/import endpoint in src/api/routes/master.ts (multipart/form-data for CSV/JSON, type parameter for customer/product, mode parameter for incremental/full)
- [X] T059 [US5] Implement master data import service in src/services/import.service.ts (PapaParse CSV parsing, JSON parsing, batch validation with Zod)
- [X] T060 [US5] Implement batch upsert logic for customer data (1000-row batches, incremental mode: check existing → split into inserts/updates → bulk operations)
- [X] T061 [US5] Implement batch upsert logic for product data (same pattern as customer import)
- [X] T062 [US5] Add full replacement mode (delete all existing records → bulk insert new records within transaction)
- [X] T063 [US5] Implement customer matching service in src/services/matching.service.ts (fuzzy match on customer name, exact match on customer code, return top 3 suggestions with confidence scores)
- [X] T064 [US5] Update OCR service to call customer matching before product matching
- [X] T065 [US5] Store matched customer ID in Order.customerId field
- [X] T066 [US5] Add customer name variations support (JSON array in Customer.nameVariations field, check all variations during matching)
- [X] T067 [US5] Return customer suggestions array in OrderResponse when confidence is low (60-70% range)
- [X] T068 [US5] Flag orders as "unknown_customer" when no match above 60% confidence

**Checkpoint**: ✅ Customer matching is now functional - system can identify repeat customers from handwriting and import master data via CSV/JSON

---

## Phase 6: User Story 2 - Context-Aware Recognition (Priority: P2)

**Goal**: Use customer order history to interpret ambiguous/shorthand references like "いつもの" (the usual), improving recognition accuracy by 15%+

**Independent Test**: Create customer profile with 5+ historical orders, submit order form with "いつもの", verify system correctly suggests frequently ordered products based on last 30 days

### Implementation for User Story 2

- [X] T069 [P] [US2] Implement context service in src/services/context.service.ts (query customer order history, identify frequent product combinations, detect "いつもの" patterns)
- [X] T070 [US2] Create OrderHistory records when orders are confirmed (store product combination, order date, customer reference)
- [X] T071 [US2] Generate vector embeddings for confirmed orders using Gemini text-embedding-004 model (768-dimensional vectors for product combinations)
- [X] T072 [US2] Store embeddings in OrderHistory.embedding field (F32_BLOB via raw SQL)
- [X] T073 [US2] Update OCR service to call context service when customer is identified
- [X] T074 [US2] Implement "いつもの" detection logic (check extracted text for common phrases: "いつもの", "usual order", "same as before")
- [X] T075 [US2] Query customer's recent orders (last 30 days) and return top 3 most frequent product combinations
- [X] T076 [US2] Create CustomerContext records for learned abbreviations and patterns
- [X] T077 [US2] Update product matching to boost confidence when product appears in customer history
- [X] T078 [US2] Add contextType field to CustomerContext (frequent_order, abbreviation, usual_order)
- [X] T079 [US2] Update context records when operator corrections reveal new patterns

**Checkpoint**: ✅ Context-aware recognition is functional - "いつもの" orders leverage customer history with confidence boosting (T071-T072 vector embeddings ready for Phase 7)

---

## Phase 7: User Story 4 - Difficult Handwriting with Context (Priority: P2)

**Goal**: Use historical patterns to interpret unclear handwriting, achieving 75%+ confidence even when character recognition is only 50% confident

**Independent Test**: Upload intentionally degraded handwritten forms for customers with established order history, verify system correctly interprets unclear text by cross-referencing past orders

### Implementation for User Story 4

- [ ] T080 [US4] Implement vector similarity search for product matching in src/services/matching.service.ts (use DiskANN indexes, cosine similarity, top-K results)
- [ ] T081 [US4] Generate vector embeddings for all products during master data import (call Gemini text-embedding-004, store in Product.embedding)
- [ ] T082 [US4] Update product matching to use vector similarity when fuzzy match confidence is low (<60%)
- [ ] T083 [US4] Implement historical pattern boosting: if product appears in customer's last 10 orders, boost confidence by 20%
- [ ] T084 [US4] Implement quantity inference from historical patterns (e.g., customer always orders in multiples of 12)
- [ ] T085 [US4] Add product association detection (Product A and Product B always ordered together → boost confidence for contextually consistent interpretations)
- [ ] T086 [US4] Create CustomerContext records for learned product associations
- [ ] T087 [US4] Update confidence scoring to factor in historical context (combine OCR confidence + historical frequency + product associations)

**Checkpoint**: All user stories are now complete - system handles clear handwriting, unclear handwriting, ambiguous references, and provides review workflow

---

## Phase 8: Tenant Management (Admin Features)

**Purpose**: Allow administrators to provision new tenants and manage tenant settings

- [ ] T088 [P] Implement POST /v1/tenants endpoint in src/api/routes/tenants.ts (admin-only, requires special admin JWT claim)
- [ ] T089 Implement tenant provisioning service in src/services/tenant.service.ts (create Turso tenant database via --from-db, generate API credentials, register in service DB)
- [ ] T090 [P] Add tenant creation logic: call Turso Platform API to create database from seed template (--from-db ocr-seed-db)
- [ ] T091 [P] Generate JWT token for new tenant with tenant_id, permissions, rate_limit_tier claims
- [ ] T092 Update service database with tenant metadata (databaseUrl, confidenceThreshold, aiModel, rateLimitTier)
- [ ] T093 Return tenant credentials in API response (tenantId, databaseUrl, apiKey/JWT)

**Checkpoint**: Tenant management is functional - new customers can be onboarded programmatically

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T094 [P] Add structured logging throughout services (log OCR processing time, confidence scores, errors, tenant context)
- [ ] T095 [P] Implement audit trail logging in src/services/audit.service.ts (log all order processing, reviews, corrections, imports)
- [ ] T096 [P] Add error handling middleware in src/api/middleware/error.ts (catch all errors, return consistent error responses per OpenAPI spec)
- [ ] T097 [P] Implement file retention cleanup service in src/services/retention.service.ts (delete files older than 365 days, scheduled task)
- [ ] T098 [P] Add database migration script for existing tenants in scripts/migrate-tenant-databases.ts (fetch all tenants, apply migration SQL to each)
- [ ] T099 [P] Create database seeding script in prisma/seed.ts (sample customers, products, orders for testing)
- [ ] T100 [P] Add npm scripts to package.json (dev, build, test, test:coverage, db:seed, migrate:tenants, logs)
- [ ] T101 [P] Create Docker configuration files (Dockerfile, docker-compose.yml) for containerized deployment
- [ ] T102 [P] Add monitoring/observability setup (Sentry integration, Datadog logging, or similar)
- [ ] T103 [P] Create sample order form fixtures in tests/fixtures/sample-orders/ (clear handwriting, unclear handwriting, "いつもの" examples)
- [ ] T104 [P] Create sample master data CSV/JSON files in tests/fixtures/master-data/ (customers.csv, products.csv, with various formats)
- [ ] T105 Run quickstart.md validation (follow setup guide end-to-end, verify all commands work)
- [ ] T106 Update CLAUDE.md with final technology stack and project commands
- [ ] T107 [P] Code cleanup and refactoring (remove TODOs, consolidate utilities, optimize imports)
- [ ] T108 [P] Performance optimization: profile OCR processing pipeline, optimize Prisma queries, tune vector search parameters
- [ ] T109 [P] Security hardening: validate all inputs, sanitize file paths, prevent SQL injection, audit sensitive operations

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational phase completion
  - **US1 (Phase 3) - Basic OCR**: Can start after Foundational - No dependencies on other stories
  - **US3 (Phase 4) - Review**: Depends on US1 (needs Order creation) - Should be implemented second for MVP
  - **US5 (Phase 5) - Customer Matching**: Can start after Foundational - Independent but enhances US1/US3
  - **US2 (Phase 6) - Context-Aware**: Depends on US1 (needs Order creation) and US5 (needs customer matching)
  - **US4 (Phase 7) - Difficult Handwriting**: Depends on US1, US2, US5 (needs all context features)
- **Tenant Management (Phase 8)**: Can proceed in parallel with user stories
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### Critical Path for MVP

**Minimum viable product = User Stories 1 + 3 (Basic OCR + Review)**

1. Complete Phase 1 (Setup) - ~2 hours
2. Complete Phase 2 (Foundational) - ~2 days
3. Complete Phase 3 (US1 - Basic OCR) - ~2 days
4. Complete Phase 4 (US3 - Review) - ~1 day
5. **STOP and VALIDATE**: MVP is ready for testing and demo

### Full Feature Set

1. Phases 1-4 (MVP as above)
2. Add Phase 5 (US5 - Customer Matching) - ~1 day
3. Add Phase 6 (US2 - Context-Aware) - ~2 days
4. Add Phase 7 (US4 - Difficult Handwriting) - ~2 days
5. Add Phase 8 (Tenant Management) - ~1 day
6. Complete Phase 9 (Polish) - ~1 day

**Total estimated time**: ~12 days for full feature set, ~5 days for MVP

### Within Each User Story

- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority
- All tasks within a story phase marked [P] can run in parallel

### Parallel Opportunities

**Phase 1 (Setup)**: T002, T003, T004, T005, T006, T007 can all run in parallel

**Phase 2 (Foundational)**:
- Database tasks (T008-T017) must run sequentially
- Library tasks (T018-T026) can all run in parallel with each other
- Authentication tasks (T027-T031) can run in parallel once T018 (turso client) is done
- API framework tasks (T032-T035) run after all above

**Phase 3 (US1)**: T036, T037 can run in parallel at start

**Phase 5 (US5)**: T057, T058 can run in parallel at start

**Phase 9 (Polish)**: Most tasks (T094-T109) can run in parallel

### Parallel Example: Foundational Phase Libraries

```bash
# Launch all library implementations together after database setup:
Task: "Implement Turso client factory in src/lib/turso.ts"
Task: "Implement Gemini API wrapper in src/lib/gemini.ts"
Task: "Implement vector embedding utilities in src/lib/vectors.ts"
Task: "Create TypeScript type extensions in src/types/vectors.ts"
Task: "Implement local file storage in src/lib/storage/local.ts"
Task: "Implement R2 storage in src/lib/storage/r2.ts"
Task: "Create storage factory in src/lib/storage/factory.ts"
Task: "Define FileStorage interface in src/lib/storage/interface.ts"
Task: "Implement configuration loader in src/lib/config.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 3 Only)

**Goal**: Deliver working OCR system with review workflow in 5 days

1. Complete Phase 1: Setup (~2 hours)
2. Complete Phase 2: Foundational (~2 days)
   - Critical: Database, Turso client, Gemini wrapper, JWT auth, file storage
3. Complete Phase 3: User Story 1 - Basic OCR (~2 days)
4. Complete Phase 4: User Story 3 - Review (~1 day)
5. **STOP and VALIDATE**: Test independently with sample order forms
6. Deploy/demo if ready

**Deliverable**: Operators can upload clear handwritten orders, get JSON output, review low-confidence orders, and correct errors.

### Incremental Delivery (Add Stories One by One)

1. Complete MVP (Phases 1-4) → Test independently → Deploy/Demo
2. Add User Story 5 - Customer Matching (Phase 5) → Test independently → Deploy/Demo
3. Add User Story 2 - Context-Aware (Phase 6) → Test independently → Deploy/Demo
4. Add User Story 4 - Difficult Handwriting (Phase 7) → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy (3+ Developers)

**Week 1**:
- Team completes Setup + Foundational together (Phases 1-2)

**Week 2** (after Foundational done):
- Developer A: User Story 1 (Phase 3)
- Developer B: User Story 3 (Phase 4) - starts after US1 Order model exists
- Developer C: User Story 5 (Phase 5)

**Week 3**:
- Developer A: User Story 2 (Phase 6)
- Developer B: User Story 4 (Phase 7)
- Developer C: Tenant Management (Phase 8)

**Week 4**:
- All: Polish & integration testing (Phase 9)

---

## Task Statistics

- **Total Tasks**: 109
- **Phase 1 (Setup)**: 7 tasks
- **Phase 2 (Foundational)**: 28 tasks (CRITICAL - blocks all stories)
- **Phase 3 (US1 - Basic OCR)**: 12 tasks
- **Phase 4 (US3 - Review)**: 9 tasks
- **MVP Subtotal**: 56 tasks (51% of total)
- **Phase 5 (US5 - Customer Matching)**: 12 tasks
- **Phase 6 (US2 - Context-Aware)**: 11 tasks
- **Phase 7 (US4 - Difficult Handwriting)**: 8 tasks
- **Phase 8 (Tenant Management)**: 6 tasks
- **Phase 9 (Polish)**: 16 tasks

**Parallelizable Tasks**: 43 tasks marked [P] (39% of total)

---

## Notes

- **[P] tasks** = different files, no dependencies, can run in parallel
- **[Story] label** maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **No test tasks included** - feature specification did not request TDD approach
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## References

- Feature Specification: specs/001-ocr-typescript-hono/spec.md
- Implementation Plan: specs/001-ocr-typescript-hono/plan.md
- Data Model: specs/001-ocr-typescript-hono/data-model.md
- API Contracts: specs/001-ocr-typescript-hono/contracts/ocr-api.yaml
- Research Findings: specs/001-ocr-typescript-hono/research.md
- Developer Setup: specs/001-ocr-typescript-hono/quickstart.md
