# Implementation Plan: Handwritten Order OCR Engine

**Branch**: `001-ocr-typescript-hono` | **Date**: 2025-10-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ocr-typescript-hono/spec.md`

**Note**: This implementation plan defines the technical architecture and design for the handwritten order OCR engine based on clarified requirements.

## Summary

Build a multi-tenant handwritten order OCR API that processes Japanese handwritten order forms (PDF/images) using AI vision models (Gemini 2.5 Flash), matches extracted data against tenant-specific customer/product masters stored in Turso databases, applies vector-based semantic matching with historical context for ambiguous references (e.g., "いつもの"), flags low-confidence results for human review, and returns structured JSON within 5-15 seconds.

**Key Technical Decisions:**
- **Multi-tenancy**: Separate Turso databases per tenant (seed DB template + independent tenant DBs via `--from-db`)
- **Master Data**: CSV/JSON import into tenant Turso databases (not external APIs)
- **Stack**: TypeScript + Hono (API framework) + Mastra (AI orchestration) + Prisma.js (ORM) + Turso (database)
- **AI Integration**: Gemini 2.5 Flash with configurable model selection and 3x retry with exponential backoff
- **Vector Search**: Embeddings for customer context and product semantic matching

## Technical Context

**Language/Version**: TypeScript (Node.js 20+ LTS)
**Primary Dependencies**:
- Hono (web framework for API routes)
- Mastra (AI workflow orchestration, Gemini integration)
- Prisma.js (ORM for Turso database access)
- @libsql/client (Turso TypeScript client)
- Gemini SDK (@google/generative-ai or via Mastra)
- CSV/JSON parsing libraries (csv-parser, zod for validation)

**Storage**:
- Turso (libSQL/SQLite) with separate database per tenant architecture
- Seed database as template for schema definition
- Per-tenant independent databases for isolated data (created via `--from-db`)
- Vector embeddings stored in Turso (F32_BLOB native vector type)
- File storage for uploaded order images/PDFs (local filesystem or cloud storage TBD in research)

**Testing**:
- Vitest (unit tests for services, utilities)
- Supertest (integration tests for API endpoints)
- Prisma test fixtures for database seeding
- Mock Gemini responses for deterministic AI testing

**Target Platform**:
- Node.js server (containerized deployment assumed)
- RESTful JSON API over HTTP
- Multi-tenant SaaS architecture

**Project Type**: Single API server project (backend only, no separate frontend)

**Performance Goals**:
- OCR processing latency: 5-15 seconds per order form (P95)
- Support 100 concurrent order uploads without degradation
- Master data queries: <100ms (local Turso DB)
- Vector similarity search: <500ms for top-K results

**Constraints**:
- Tenant data isolation: zero cross-tenant data leakage
- Master data freshness: daily/weekly batch imports acceptable (not real-time)
- File size limit: 10MB per uploaded order form
- Confidence threshold: configurable per tenant, default 70%

**Scale/Scope**:
- Initial target: 10-50 tenants
- Orders per tenant: 100-10,000 per month
- Master data per tenant: 100-10,000 customers, 500-50,000 products
- Order history retention: 12+ months

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: ✅ PASSED (No constitution file defined; using standard best practices)

Since no project-specific constitution exists at `.specify/memory/constitution.md`, this plan follows industry-standard best practices:

- ✅ **Test-Driven Development**: Integration and unit tests required before implementation
- ✅ **Type Safety**: Full TypeScript with strict mode
- ✅ **Error Handling**: Retry logic, graceful degradation, clear error messages
- ✅ **Security**: Tenant isolation, input validation, authentication required
- ✅ **Observability**: Structured logging, audit trails (FR-022)
- ✅ **Simplicity**: Single API server, no microservices, minimal abstractions

## Project Structure

### Documentation (this feature)

```
specs/001-ocr-typescript-hono/
├── spec.md              # Feature specification (completed)
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0: Technology research and decisions
├── data-model.md        # Phase 1: Database schema and entities
├── quickstart.md        # Phase 1: Developer setup guide
├── contracts/           # Phase 1: API contract definitions
│   └── ocr-api.yaml    # OpenAPI 3.1 specification
└── tasks.md             # Phase 2: Implementation tasks (/speckit.tasks - NOT YET CREATED)
```

### Source Code (repository root)

```
src/
├── api/                 # Hono API routes and middleware
│   ├── routes/
│   │   ├── ocr.ts      # POST /ocr - upload and process order
│   │   ├── review.ts   # GET/PATCH /reviews - review queue operations
│   │   ├── tenants.ts  # POST /tenants - tenant provisioning (admin)
│   │   └── master.ts   # POST /master/import - CSV/JSON import
│   ├── middleware/
│   │   ├── auth.ts     # Tenant authentication (API key/JWT)
│   │   └── tenant.ts   # Tenant DB routing middleware
│   └── index.ts        # Hono app initialization
├── services/
│   ├── ocr.service.ts          # OCR orchestration (Mastra + Gemini)
│   ├── matching.service.ts     # Customer/product matching with vector search
│   ├── context.service.ts      # Customer context and history analysis
│   ├── import.service.ts       # Master data CSV/JSON import
│   └── confidence.service.ts   # Confidence scoring logic
├── models/
│   ├── schema.prisma           # Prisma schema definition
│   └── migrations/             # Turso schema migrations
├── lib/
│   ├── turso.ts        # Turso client factory (per-tenant routing)
│   ├── gemini.ts       # Gemini API wrapper with retry logic
│   ├── vectors.ts      # Vector embedding generation
│   └── config.ts       # Configuration loader (AI model, thresholds)
└── types/
    ├── ocr.ts          # TypeScript types for OCR entities
    └── api.ts          # API request/response types

tests/
├── integration/
│   ├── ocr.test.ts     # End-to-end OCR processing
│   ├── review.test.ts  # Review queue workflows
│   └── import.test.ts  # Master data import
├── unit/
│   ├── services/       # Service layer unit tests
│   └── lib/            # Utility function tests
└── fixtures/
    ├── sample-orders/  # Test order form images
    ├── master-data/    # Sample CSV/JSON master data
    └── db-seeds/       # Prisma seed scripts

prisma/
├── schema.prisma       # Symlink to src/models/schema.prisma
└── seed.ts             # Test data seeding

config/
├── default.json        # Default configuration
└── production.json     # Production overrides
```

**Structure Decision**: Single backend API server. No frontend (API-only service). Hono handles routing, Prisma manages Turso database access per tenant, Mastra orchestrates AI workflows. Simple, flat service architecture—no layered abstractions beyond services/repositories pattern.

## Complexity Tracking

*No constitution violations. This section is empty.*

---

## Phase 0: Research & Unknowns

**Status**: PENDING

Research tasks to resolve before implementation:

1. **Turso Separate Database Architecture**
   - How to create seed database with schema via Prisma migrations
   - How to provision per-tenant databases from seed template (`--from-db` flag)
   - Managing independent Prisma migrations per tenant database
   - Coordinating schema updates across multiple tenant databases

2. **Vector Embeddings in Turso**
   - Best approach for storing/querying embeddings (libsql extension vs JSON columns)
   - Embedding generation: use Gemini embedding API or separate model?
   - Similarity search performance with 10K+ products

3. **Mastra + Gemini Integration**
   - Mastra workflow patterns for OCR + extraction + validation
   - Gemini 2.5 Flash prompt engineering for Japanese handwriting
   - Handling multi-page PDFs and image preprocessing

4. **File Storage Strategy**
   - Local filesystem (development) vs S3/Cloudflare R2 (production)
   - Presigned URLs for review interface image display
   - Retention policy for uploaded files

5. **Hono Authentication Patterns**
   - Middleware for tenant API key validation
   - JWT token structure (tenant ID claim)
   - Rate limiting per tenant

6. **CSV/JSON Master Import**
   - Schema validation with Zod
   - Incremental vs full replacement strategies
   - Transaction handling for large imports

**Output**: `research.md` with decisions, rationale, code patterns

---

## Phase 1: Design & Contracts

**Status**: PENDING (blocked by Phase 0)

### Deliverables

1. **data-model.md**: Prisma schema with entities:
   - Tenant, Order, OrderItem, Customer, Product, OrderHistory, ReviewQueueItem, ProcessingResult, CustomerContext

2. **contracts/ocr-api.yaml**: OpenAPI 3.1 specification with endpoints:
   - `POST /v1/ocr` - Upload and process order form
   - `GET /v1/reviews` - List orders requiring review
   - `PATCH /v1/reviews/{orderId}` - Update reviewed order
   - `POST /v1/master/import` - Import customer/product master data
   - `POST /v1/tenants` - Provision new tenant (admin only)

3. **quickstart.md**: Developer setup:
   - Prerequisites (Node.js, Turso CLI)
   - Local database setup (Turso dev mode)
   - Environment variables
   - Running tests and dev server

4. **Agent context update**: Add Hono, Mastra, Turso, Prisma to `.aider.tags.cache.v3/cache.json` (or Claude equivalent)

---

## Next Steps

1. Execute Phase 0 research (generate `research.md`)
2. Execute Phase 1 design (generate `data-model.md`, `contracts/`, `quickstart.md`)
3. Update agent context with new technologies
4. Proceed to `/speckit.tasks` for task decomposition
