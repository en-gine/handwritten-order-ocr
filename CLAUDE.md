# OCR Development Guidelines

Auto-generated from feature specification. Last updated: 2025-10-17

## Active Technologies
- **TypeScript** (Node.js 20+ LTS)
- **Hono** - Web framework
- **Turso** - LibSQL database (multi-tenant)
- **Prisma** - ORM and database client
- **Gemini AI** - OCR and embeddings
- **Mastra** - AI workflow orchestration

## Project Structure
```
src/
├── api/              # Hono routes and middleware
├── services/         # Business logic
├── lib/              # Utilities and clients
└── types/            # TypeScript definitions
tests/
├── unit/             # Unit tests
├── integration/      # Integration tests
└── fixtures/         # Test data
prisma/
├── schema.prisma     # Database schema
└── migrations/       # Database migrations
scripts/              # Utility scripts
```

## Essential Commands

### Development
```bash
npm run dev              # Start development server with hot reload
npm run build            # Build TypeScript → JavaScript
npm start                # Run production build
npm run typecheck        # Check TypeScript without building
```

### Testing
```bash
npm test                 # Run MVP validation tests
npm run test:unit        # Run unit tests
npm run test:integration # Run integration tests
npm run test:coverage    # Run tests with coverage report
```

### Database
```bash
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Create and apply migration
npm run db:deploy        # Deploy migrations (production)
npm run db:seed          # Seed database with sample data
npm run db:studio        # Open Prisma Studio
npm run migrate:tenants  # Migrate all tenant databases
```

### Code Quality
```bash
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint errors
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
```

### Docker
```bash
npm run docker:build     # Build Docker image
npm run docker:run       # Run container
npm run docker:compose   # Start with docker-compose
```

## Code Style

**TypeScript**:
- Strict mode enabled
- Explicit return types for public functions
- Use ES2022+ features
- Prefer async/await over promises

**API Routes**:
- Use Hono middleware for auth, validation, rate limiting
- Return consistent JSON error responses
- Document endpoints with JSDoc

**Services**:
- Single responsibility principle
- Throw errors, let middleware handle
- Log important operations

**Database**:
- Use Prisma for type-safe queries
- Multi-tenant isolation (separate databases per tenant)
- Raw SQL only for vector operations

## Environment Variables

See `.env.example` for all required variables:
- `SERVICE_DATABASE_URL` - Service database (tenant metadata)
- `GEMINI_API_KEY` - Gemini AI API key
- `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` - RS256 JWT keys
- `TURSO_ORGANIZATION` / `TURSO_API_TOKEN` - Turso Platform API

## Recent Changes
- Phase 1-8: Complete feature implementation
- Phase 9: Error handling, Docker, npm scripts

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
