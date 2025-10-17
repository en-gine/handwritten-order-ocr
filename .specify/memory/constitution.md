# AI OCR Engine Constitution

**Project**: Handwritten Order OCR Engine
**Version**: 1.0.0
**Ratified**: 2025-10-15
**Last Amended**: 2025-10-15

---

## Core Principles

### I. Multi-Tenant Data Isolation (MUST - NON-NEGOTIABLE)

**Principle**: Tenant data isolation is absolute and non-negotiable. Zero cross-tenant data leakage is tolerated under any circumstance.

**Requirements**:
- All database queries MUST filter by tenant ID or use tenant-specific database connections
- Authentication MUST extract and validate tenant identity before any data access
- Tenant routing middleware MUST verify tenant context on every authenticated request
- Error messages and logs MUST NOT leak information about other tenants
- Unit and integration tests MUST verify tenant isolation in all data access paths

**Rationale**: This is a multi-tenant SaaS system handling sensitive business data. A single tenant data leak would be catastrophic for trust and compliance.

---

### II. Confidence-Driven Workflow (MUST - NON-NEGOTIABLE)

**Principle**: All extracted data must include confidence scores, and low-confidence results must route to human review.

**Requirements**:
- Every extracted field (customer, product, quantity) MUST have a confidence score (0.0-1.0)
- Orders with overall confidence below threshold (default 70%, configurable per tenant) MUST be flagged for review
- Confidence calculation logic MUST be transparent and auditable
- Human review interface MUST display confidence scores alongside extracted data
- System MUST NOT auto-confirm orders below threshold without explicit operator approval

**Rationale**: Handwriting OCR is inherently probabilistic. Confidence-driven workflow ensures data quality while minimizing manual effort for clear handwriting.

---

### III. Historical Context Utilization (SHOULD)

**Principle**: Leverage customer order history and vector embeddings to improve interpretation of ambiguous or abbreviated references.

**Requirements**:
- System SHOULD store confirmed order history with vector embeddings for semantic search
- When customer is identified, system SHOULD query recent order patterns (last 30 days default)
- Ambiguous references like "いつもの" (the usual) SHOULD trigger context-aware interpretation
- Product matching SHOULD use vector similarity search when fuzzy text matching has low confidence
- Human corrections SHOULD update customer context patterns for future improvements

**Rationale**: Real-world orders often use informal language and abbreviations. Historical context significantly reduces review queue load.

---

### IV. API-First Architecture (MUST)

**Principle**: All functionality must be exposed via RESTful JSON APIs with proper authentication and rate limiting.

**Requirements**:
- Core OCR processing MUST be available via `POST /v1/ocr` endpoint
- Review queue operations MUST be available via `/v1/reviews` endpoints
- Master data import MUST support CSV and JSON formats via `/v1/master/import`
- All endpoints MUST require authentication (JWT or API key)
- Rate limiting MUST be enforced per tenant tier
- API contracts MUST be documented in OpenAPI 3.1 specification

**Rationale**: This is an OCR engine, not a full application. API-first design enables integration with various frontend interfaces and business systems.

---

### V. Observability & Audit Trail (MUST - NON-NEGOTIABLE)

**Principle**: All processing results, AI responses, and human corrections must be logged for debugging, auditing, and continuous improvement.

**Requirements**:
- Every OCR processing attempt MUST log: tenant ID, order ID, AI model used, processing time, confidence scores
- Raw AI responses MUST be preserved in `ProcessingResult` table for debugging
- Human corrections MUST be logged with: operator ID, timestamp, original value, corrected value
- System MUST support audit queries: "Show all orders processed for customer X in date range Y"
- Logs MUST include sufficient context for debugging production issues without accessing raw order images

**Rationale**: OCR accuracy depends on continuous learning from corrections. Comprehensive logging enables model improvement and troubleshooting.

---

## Additional Constraints

### Security Requirements

- JWT tokens MUST use RS256 (asymmetric) signing for production environments
- Uploaded order images MUST be stored securely with tenant-scoped access controls
- Database credentials MUST NOT be hardcoded; use environment variables only
- API endpoints MUST validate all inputs with Zod schemas before processing
- File uploads MUST enforce size limits (10MB) and format restrictions (PDF/JPG/PNG)

### Performance Standards

- OCR processing latency MUST be 5-15 seconds (P95) for responsive operator workflow
- System MUST support 100 concurrent uploads without performance degradation
- Master data queries MUST complete in <100ms (using indexed lookups)
- Vector similarity searches MUST use DiskANN indexes for sub-500ms performance

### Data Retention

- Uploaded order images MUST be retained for at least 365 days for audit compliance
- Order history MUST be retained for at least 12 months for pattern recognition
- Processing logs MUST be retained according to tenant compliance requirements

---

## Development Workflow

### Implementation Standards

- **Type Safety**: Use TypeScript strict mode; no `any` types without explicit justification
- **Error Handling**: All AI service calls MUST implement retry logic (3 attempts with exponential backoff)
- **Testing**: Integration tests MUST verify tenant isolation, confidence scoring, and review workflow
- **Code Review**: All PRs MUST be reviewed for tenant isolation vulnerabilities

### Quality Gates

- All endpoints MUST have OpenAPI documentation before implementation
- Database schema changes MUST include migration scripts for existing tenant databases
- Performance regressions MUST be caught via profiling before production deployment

---

## Governance

### Constitution Authority

This constitution supersedes code comments, individual preferences, and ad-hoc decisions. When in doubt about architectural choices, refer to these principles.

### Amendment Process

Constitution amendments require:
1. Documented rationale for the change
2. Review of impact on existing implementations
3. Migration plan if retroactive changes needed
4. Update to this document with new version number

### Complexity Justification

Any deviation from these principles (e.g., skipping confidence scores for certain fields, relaxing tenant isolation for admin operations) MUST be explicitly documented with:
- Clear justification for the exception
- Risk assessment and mitigation plan
- Alternative approaches considered and rejected

---

**Constitution Version**: 1.0.0
**Ratified**: 2025-10-15
**Next Review**: 2026-04-15 (6 months)
