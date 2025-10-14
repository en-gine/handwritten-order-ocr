# Feature Specification: Handwritten Order OCR Engine

**Feature Branch**: `001-ocr-typescript-hono`
**Created**: 2025-10-09
**Status**: Draft
**Input**: User description: "手書きの発注書のOCRに特化したエンジンを作りたいです。技術はフルTypeScript。フレームワークはHono + Mastra。ORMはPrisma.js。発注書のPDFや画像を受け取って、Gemini2.5-flashに投げます。（モデルはプログラム内の設定ファイルで変えられるようにします。）得意先と商品のマスタからデータを操作し（ベクターデータの方が都合が良ければそうします。Tursoなどがいいのではと思ってます。）その受注データとして適切なJsonを返します。またその中に確証度を持ち、一定以下の確証度は人間が見て、状態を変更できるようにします。得意先別にコンテキストや確定されたデータの履歴を持ち、例えば得意先が「いつもの」と言っても何の商品か理解できるようにします。つまり得意先ごとにコンテキストを保持し、常に利用します。また読みにくい時もその履歴を元に判断します。このシステムはあくまでORCエンジンであり、認証の必要なAPIとして機能します。また様々なテナントごとに得意先、商品マスタを持つ想定です。商品マスタを外部のAPIやMCPサーバーとして建てるか、シンプルなデータカラムにしてインポートするかは迷っています。"

## Clarifications

### Session 2025-10-14

- Q: What is the maximum acceptable latency for OCR processing of a single order form (from API submission to receiving JSON response)? → A: 5-15 seconds (responsive for operator workflow)
- Q: For storing customer order history and contextual patterns, which storage approach should be used? → A: Turso (SQLite) with vector embeddings for semantic matching
- Q: When the AI service (Gemini) fails or is unavailable, what should the system do? → A: Retry 3 times with exponential backoff, then fail the request with error message
- Q: When extracted product names don't match any entry in the product master database, how should the system handle them? → A: Accept with confidence=0%, flag entire order for review
- Q: How should tenant isolation be implemented for the multi-tenant OCR API (each tenant has separate customer/product masters)? → A: Turso Multi-DB Schemas (separate database per tenant with automated schema propagation from parent database)
- Q: How should tenant-specific product and customer master data be implemented? → A: Data import approach - store master data as tables in each tenant's Turso database with CSV/JSON import capability

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Order Recognition from Clear Handwriting (Priority: P1)

A warehouse operator receives a handwritten order form via fax or photo. They upload the PDF or image to the system, which extracts order details (customer, products, quantities) and returns structured data ready for processing.

**Why this priority**: This is the core value proposition and minimum viable functionality. Without this, the system provides no value.

**Independent Test**: Can be fully tested by uploading a clearly written handwritten order form and verifying that the system returns accurate JSON data with customer name, product list, and quantities. Success means the operator can immediately use the data for order entry.

**Acceptance Scenarios**:

1. **Given** a clear handwritten order form as PDF, **When** the operator uploads it to the system, **Then** the system returns structured JSON with customer information, product names, quantities, and a confidence score above 80%
2. **Given** a clear handwritten order form as JPG image, **When** the operator uploads it, **Then** the system extracts all order line items with at least 90% accuracy
3. **Given** an order with standard product names, **When** the system processes it, **Then** all products are correctly matched to the master product database

---

### User Story 2 - Context-Aware Recognition Using Order History (Priority: P2)

A repeat customer writes "いつもの" (the usual) or uses abbreviated product names on their order form. The system recognizes the customer and uses their historical order data to correctly interpret ambiguous or shorthand references.

**Why this priority**: This significantly reduces manual intervention and makes the system practical for real-world business scenarios where customers often use informal language. However, it depends on having Story 1 working first to build up history.

**Independent Test**: Can be tested by creating a customer profile with order history, then submitting an order form with ambiguous references (e.g., "いつもの"). The system should correctly expand these to specific products based on past orders, delivering value even if other advanced features aren't implemented.

**Acceptance Scenarios**:

1. **Given** a customer with 5+ previous orders, **When** they write "いつもの" on a new order form, **Then** the system suggests their most frequently ordered product combination from the last 30 days
2. **Given** a customer who previously ordered "ビール大瓶", **When** they write "ビール大" on a new form, **Then** the system correctly identifies it as "ビール大瓶" based on historical patterns
3. **Given** an ambiguous product reference, **When** the system has multiple possible matches, **Then** it returns the top 3 most likely products based on customer history with confidence scores

---

### User Story 3 - Manual Review and Correction for Low Confidence Results (Priority: P1)

When the system cannot confidently interpret parts of a handwritten order (due to poor handwriting, smudges, or ambiguity), it flags those items for human review. An operator can view the flagged items, see the original image, and make corrections before finalizing the order.

**Why this priority**: This is critical for production readiness. Without a review mechanism, low-confidence results would lead to order errors. This must be part of the MVP to ensure data quality.

**Independent Test**: Can be fully tested by uploading a poorly written order form, verifying that low-confidence items (below threshold) are flagged, then having an operator review and correct them through a review interface. This delivers immediate value by preventing bad data from entering the system.

**Acceptance Scenarios**:

1. **Given** an order with confidence score below 70%, **When** processing completes, **Then** the order is marked as "requires review" and appears in the operator's review queue
2. **Given** an order item with confidence below 70%, **When** the operator opens the review interface, **Then** they see the original image section, the system's best guess, and can manually correct or confirm each field
3. **Given** a corrected order item, **When** the operator saves it, **Then** the system updates the order data and marks that item as "human verified"
4. **Given** multiple reviewed orders for the same customer, **When** the system processes future orders, **Then** it learns from corrections and improves confidence for similar patterns

---

### User Story 4 - Difficult Handwriting Recognition with Historical Context (Priority: P2)

A customer submits an order with particularly difficult handwriting where individual characters or product names are barely legible. The system uses the customer's historical order patterns and common product combinations to make educated guesses about unclear text.

**Why this priority**: This enhances the system's intelligence but requires both basic OCR (P1-Story1) and history tracking (P2-Story2) to be in place first. It's a quality-of-life improvement rather than core functionality.

**Independent Test**: Can be tested by uploading intentionally degraded handwritten forms for customers with established order history. The system should correctly interpret unclear text by cross-referencing past orders, reducing the number of items requiring manual review compared to processing without historical context.

**Acceptance Scenarios**:

1. **Given** an unclear product name on an order, **When** the customer has ordered that product 10+ times in the past, **Then** the system identifies it correctly with 75%+ confidence even if character recognition is only 50% confident
2. **Given** a smudged quantity field, **When** the customer typically orders that product in multiples of 12, **Then** the system suggests the nearest multiple based on partially recognized digits
3. **Given** multiple interpretation possibilities for unclear text, **When** historical data shows strong product association patterns (e.g., Product A and Product B always ordered together), **Then** the system boosts confidence for contextually consistent interpretations

---

### User Story 5 - Customer Master Data Matching (Priority: P2)

When processing an order form, the system identifies the customer by matching handwritten customer names, IDs, or other identifying information against the customer master database. This enables automatic association with the correct customer profile and historical data.

**Why this priority**: This enables the context-aware features (Stories 2 and 4) and is necessary for building customer-specific history. However, the basic OCR (Story 1) can work without it by treating each order independently.

**Independent Test**: Can be tested by uploading order forms with various customer identifiers (names written in different styles, partial names, customer codes). The system should correctly match to existing customer records at least 85% of the time for clear handwriting, delivering value by automating customer lookup.

**Acceptance Scenarios**:

1. **Given** a handwritten customer name matching a unique entry in the master database, **When** the system processes the order, **Then** it automatically associates the order with the correct customer ID with 90%+ confidence
2. **Given** a customer name with multiple possible matches (e.g., "田中商店" when database has 3 similar names), **When** the system processes it, **Then** it provides a list of possible matches ranked by similarity and historical order frequency
3. **Given** a customer code or ID number on the form, **When** it's clearly written, **Then** the system matches it with 99%+ confidence to the master database
4. **Given** a new customer not in the database, **When** the system cannot find a match above 60% confidence, **Then** it flags the order as "new customer" for operator verification and master data creation

---

### Edge Cases

- What happens when an uploaded file is completely unreadable (e.g., blank page, corrupted image, non-order document like an invoice)?
- **[RESOLVED]** When orders contain products not in the master database (new products or typos): System assigns confidence=0% to unmatched products and flags the entire order for operator review, preserving the original extracted text
- What happens when customer history shows conflicting patterns (e.g., customer ordered Product A for 6 months, then switched to Product B for the last 3 months - which is "いつもの")?
- How does the system handle multi-page order forms or forms with non-standard layouts?
- What happens when confidence scores are borderline (e.g., 69.9% vs 70% threshold)?
- **[RESOLVED]** When the AI service (Gemini) is unavailable or returns errors: System retries 3 times with exponential backoff, then fails the request with a clear error message allowing operator to resubmit later
- What happens when an operator partially reviews an order but doesn't complete it (session timeout, browser crash)?
- How does the system handle orders with mixed languages (Japanese and English product names)?
- What happens when quantity fields contain corrections/cross-outs (e.g., "5" crossed out and "7" written beside it)?
- How does the system manage concurrent reviews of the same order by multiple operators?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept handwritten order forms in PDF and common image formats (JPG, PNG)
- **FR-002**: System MUST extract order data including customer identifier, product names, and quantities from uploaded documents
- **FR-003**: System MUST return extracted order data as structured JSON
- **FR-004**: System MUST assign a confidence score (0-100%) to each extracted field and to the overall order
- **FR-005**: System MUST match extracted customer information against a customer master database
- **FR-006**: System MUST match extracted product information against a product master database
- **FR-007**: System MUST maintain a historical record of confirmed orders for each customer
- **FR-008**: System MUST use customer order history to interpret ambiguous or abbreviated product references
- **FR-009**: System MUST flag orders or order items with confidence scores below a configurable threshold for manual review
- **FR-010**: Users MUST be able to review flagged order items, view the source image, and make corrections
- **FR-011**: System MUST learn from human corrections and incorporate them into customer-specific historical context
- **FR-012**: System MUST use historical ordering patterns to improve interpretation of unclear handwriting
- **FR-013**: System MUST allow administrators to configure which AI model to use for OCR processing via configuration file
- **FR-014**: System MUST handle cases where customers write common shorthand like "いつもの" (the usual) by referencing recent order patterns
- **FR-015**: System MUST identify when a customer is new (not in master database) and flag for operator attention
- **FR-016**: System MUST validate that extracted product codes/names exist in the product master database
- **FR-017**: System MUST provide a review queue interface showing all orders requiring human verification
- **FR-018**: System MUST allow operators to approve, reject, or modify extracted order data
- **FR-019**: System MUST preserve the original uploaded image/PDF for reference during review
- **FR-020**: System MUST update order status from "pending review" to "confirmed" after operator approval
- **FR-021**: System MUST support bulk/batch processing of multiple order forms
- **FR-022**: System MUST log all processing attempts, confidence scores, and human corrections for audit purposes
- **FR-023**: System MUST return appropriate error messages when uploaded files are unreadable or in unsupported formats
- **FR-024**: System MUST handle multi-item orders with multiple product entries
- **FR-025**: System MUST distinguish between customer identifying information and order line items in the document structure
- **FR-026**: When AI service calls fail, system MUST retry up to 3 times with exponential backoff before returning an error
- **FR-027**: System MUST return clear error messages when AI service is unavailable after retry attempts, allowing operators to resubmit later
- **FR-028**: When extracted product names do not match any product in the master database, system MUST assign confidence score of 0% to those items and flag the entire order for manual review
- **FR-029**: System MUST preserve the original extracted product text (even if unmatched) for operator review and correction
- **FR-030**: System MUST isolate each tenant's data using separate Turso databases (via Multi-DB Schemas) to ensure complete data separation between tenants
- **FR-031**: System MUST route API requests to the appropriate tenant database based on authenticated tenant identity (via API key, JWT claim, or header)
- **FR-032**: System MUST prevent cross-tenant data access under all circumstances, including in error conditions and logging
- **FR-033**: System MUST store tenant-specific product master data as tables within each tenant's Turso database
- **FR-034**: System MUST store tenant-specific customer master data as tables within each tenant's Turso database
- **FR-035**: System MUST support importing product and customer master data in CSV and JSON formats
- **FR-036**: System MUST support both full replacement and incremental update modes for master data imports

### Non-Functional Requirements

- **NFR-001**: OCR processing latency MUST be between 5-15 seconds from API submission to JSON response delivery for single order forms to ensure responsive operator workflow
- **NFR-002**: System MUST maintain processing latency target even under load of 100 concurrent uploads (per SC-007)
- **NFR-003**: System MUST use Turso Multi-DB Schemas architecture where a parent schema database defines the structure and each tenant gets a dedicated child database that automatically inherits schema changes, ensuring zero-downtime migrations across all tenants

### Key Entities

- **Tenant**: Represents an isolated customer organization using the OCR API, containing: unique identifier, dedicated Turso child database reference, API authentication credentials, configuration settings (confidence thresholds, AI model selection), subscription/billing information
- **Order**: Represents a single handwritten order submission within a tenant's database, containing: tenant reference (implicit via database isolation), customer reference, submission timestamp, processing status (pending/reviewing/confirmed/rejected), overall confidence score, list of order items, original document reference, review history
- **Order Item**: Individual product line on an order, containing: product reference, quantity, unit of measure, confidence score, verification status, human correction history
- **Customer**: Business entity placing orders (scoped to tenant), stored as master data table in tenant's Turso database, containing: unique identifier, name variations (for matching), contact information, relationship to order history, imported from tenant-provided CSV/JSON files
- **Product**: Items available for ordering (scoped to tenant), stored as master data table in tenant's Turso database, containing: unique identifier/code, product name, name variations/aliases, unit of measure, relationship to order items, imported from tenant-provided CSV/JSON files
- **Order History**: Historical record of confirmed orders stored in tenant-specific Turso child database, containing: customer reference, order date, ordered products with quantities, vector embeddings of product combinations for semantic matching, used for pattern recognition and "usual order" interpretation
- **Review Queue Item**: An order or order item flagged for human review, containing: reference to order/item, reason for flagging (low confidence, unknown product, etc.), assigned operator, review status
- **Processing Result**: Output from AI model processing, containing: extracted fields, confidence scores per field, raw model response, processing timestamp
- **Customer Context**: Customer-specific historical patterns stored in tenant's Turso database with vector embeddings, containing: frequently ordered products, common abbreviations/shorthand used, ordering patterns/frequencies, correction history, semantic vectors for fuzzy matching of product references

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can process clearly handwritten order forms end-to-end in under 30 seconds (from upload to confirmed JSON output)
- **SC-002**: System achieves 90%+ accuracy on order extraction for clearly handwritten forms without human intervention
- **SC-003**: For customers with 10+ historical orders, system correctly interprets ambiguous references ("いつもの", abbreviations) 80%+ of the time
- **SC-004**: Orders flagged for review show the original document and suggested values, allowing operators to complete review in under 1 minute per order
- **SC-005**: System reduces manual data entry time by 70% compared to operators typing orders from handwritten forms
- **SC-006**: 95%+ of orders with confidence scores above threshold (default 70%) are accurate without requiring corrections
- **SC-007**: System processes at least 100 concurrent order uploads without performance degradation
- **SC-008**: Customer matching accuracy reaches 85%+ for handwritten customer names against master database
- **SC-009**: Order accuracy improves by at least 15% when using customer historical context vs. processing orders without history
- **SC-010**: System successfully handles standard image formats (PDF, JPG, PNG) up to 10MB file size
- **SC-011**: Zero data loss - all uploaded documents are preserved and all processing results are logged
- **SC-012**: Operators can switch between different AI models via configuration without system downtime

## Assumptions

- Handwritten order forms follow a generally consistent structure (customer info at top, line items below), though exact layout may vary
- Customer and product master databases are pre-populated and maintained by administrators outside this system
- Network connectivity to AI service (Gemini or alternatives) is reliable with standard retry mechanisms for transient failures
- Operators have basic computer literacy and can use a web-based review interface
- Order forms are primarily in Japanese, with some English product names
- "Usual order" or "いつもの" refers to the most frequently ordered product combination in the last 30 days (configurable)
- Confidence threshold of 70% is a reasonable default, but may need tuning based on business risk tolerance
- The system will be used in a trusted environment where operators have authority to correct and approve orders
- Most order forms contain 1-20 line items (not hundreds of products per form)
- Customer order history should be retained for at least 12 months for pattern recognition
- The system will primarily handle B2B orders where customers order regularly (not one-time retail customers)
- Each tenant operates independently with no data sharing between tenants; customer and product masters are tenant-specific
- Tenant provisioning (creating new child databases) can be done via Turso CLI or Platform API as part of onboarding process
- Schema migrations applied to the parent database will automatically propagate to all tenant child databases with acceptable latency (monitored via Turso's /jobs endpoint)
- Product and customer master data updates occur at daily to weekly intervals (not real-time), making data import approach suitable
- Master data import files (CSV/JSON) are provided by tenants with consistent schema (column names, data types)
- Master data freshness requirements allow for periodic batch imports rather than continuous synchronization

## Dependencies

- Turso Multi-DB Schemas infrastructure with parent schema database and per-tenant child databases, accessed via Prisma.js ORM for storing order history, customer/product master data, customer context, and vector embeddings for semantic matching
- Master data import mechanism supporting CSV and JSON parsing for customer and product data
- API access to AI vision model service (Gemini 2.5 Flash or configurable alternative) with retry capability for transient failures
- Turso Platform API or CLI access for tenant provisioning (creating new child databases) and monitoring schema migration jobs
- Storage system for uploaded order form images/PDFs and processing results (may be tenant-scoped or centralized with tenant metadata)
- Tenant authentication and identification system (API keys, JWT tokens, or tenant-specific credentials) to route requests to correct database
- User authentication system to identify operators performing reviews (or can be built as part of this feature if needed)

## Out of Scope

- Creating or modifying customer master data within the OCR system (system imports and reads/matches only; master data management remains with tenant systems)
- Creating or modifying product master data within the OCR system (system imports and reads/matches only; master data management remains with tenant systems)
- Real-time synchronization of master data changes (initial implementation uses periodic batch imports; real-time sync via webhooks or external APIs is a future enhancement)
- Master data validation and cleansing (system assumes tenant-provided master data is pre-validated)
- Payment processing or invoicing functionality
- Inventory management or stock checking
- Shipping or logistics coordination
- Printed order form template design or distribution
- Training customers on how to write orders legibly
- Multi-language support beyond Japanese and English
- Real-time handwriting recognition (live writing on tablets)
- Integration with specific ERP or order management systems (can be added later but not part of initial scope)
