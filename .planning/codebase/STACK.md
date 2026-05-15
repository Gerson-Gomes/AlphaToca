# Technology Stack

**Analysis Date:** 2026-04-25

## Languages

**Primary:**
- TypeScript 5.3.2 - All source code, type-safe development
- JavaScript - Runtime execution (via ts-node and compiled output)

**Secondary:**
- SQL - PostgreSQL database queries (via Prisma ORM)

## Runtime

**Environment:**
- Node.js - Specified via `@types/node` 20.10.0; typical LTS version expected

**Package Manager:**
- npm - Evident from `package.json` structure
- Lockfile: Not visible in exploration, but standard npm workflow

## Frameworks

**Core:**
- Express 4.18.2 - HTTP server framework, REST API endpoints
- Prisma 6.4.1 - ORM for PostgreSQL with vector extension support

**AI/LLM:**
- LangChain 1.3.3 - Orchestration framework for AI chains
- @langchain/google-genai 2.1.27 - Google Generative AI integration
- @langchain/anthropic 1.3.26 - Anthropic Claude integration (optional fallback)
- @langchain/openai 1.4.4 - OpenAI integration (optional fallback)
- @langchain/core 1.1.40 - Core abstractions
- @langchain/textsplitters 1.0.1 - Text chunking for RAG
- @google/genai 1.50.1 - Direct Google Generative AI SDK (for embeddings)
- LangSmith 0.5.19 - LLM observability and tracing

**Testing:**
- Vitest 4.1.4 - Fast unit test runner, config at `vitest.config.ts`
- Supertest 7.2.2 - HTTP assertions for API testing
- @vitest/coverage-v8 4.1.4 - Code coverage reporting

**Build/Dev:**
- ts-node 10.9.1 - Execute TypeScript directly
- Nodemon 3.0.2 - Development server auto-reload
- TypeScript 5.3.2 - Compiler for type checking and transpilation

**Documentation:**
- Swagger/OpenAPI via swagger-jsdoc 6.2.8 and swagger-ui-express 5.0.1

## Key Dependencies

**Critical:**
- @prisma/client 6.4.1 - PostgreSQL ORM client with pgvector support
- Express 4.18.2 - HTTP API framework
- BullMQ 5.73.4 - Job queue for asynchronous message processing
- ioredis 5.10.1 - Redis client for queue communication and caching

**Infrastructure:**
- axios 1.15.0 - HTTP client for external API calls (Meta WhatsApp API)
- cors 2.8.5 - Cross-origin resource sharing middleware
- dotenv 16.3.1 - Environment variable loader
- uuid 13.0.0 - UUID generation for record IDs
- zod 3.22.4 - Schema validation for runtime type safety

**Authentication:**
- express-oauth2-jwt-bearer 1.8.0 - Auth0 JWT middleware
- jwks-rsa 4.0.1 - Auth0 JWKS validation

**Rate Limiting:**
- express-rate-limit 8.4.0 - API rate limiting

**Testing Utilities:**
- @faker-js/faker 10.4.0 - Fake data generation for tests

## Configuration

**Environment:**
- `.env` file (present, contains secrets - not readable per guidelines)
- `.env.example` - Template with structure for configuration
- Configuration validated at startup via `validateAuthConfig()` in `src/middlewares/authMiddleware.ts`

**Required Environment Variables:**
- `AUTH0_AUDIENCE` - Auth0 API identifier
- `AUTH0_ISSUER_BASE_URL` - Auth0 tenant URL
- `AUTH0_CLIENT_ID` - Auth0 client credentials
- `AUTH0_CLIENT_SECRET` - Auth0 client credentials
- `GOOGLE_API_KEY` - Google Generative AI access (required for embeddings)
- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection (for Prisma migrations)
- `REDIS_URL` - Redis connection for BullMQ job queue
- `TOKEN_ACCES_WHATSAPP` - Meta WhatsApp Cloud API access token
- `PHONE_NUMBER_ID` - Meta WhatsApp registered phone number ID
- `WHATSAPP_VERIFY_TOKEN` - Token for webhook verification
- `LANGCHAIN_TRACING_V2` - Enable/disable LangSmith tracing (optional)
- `LANGCHAIN_API_KEY` - LangSmith API key (when tracing enabled)
- `LANGCHAIN_PROJECT` - LangSmith project name (optional, defaults to "default")
- `PORT` - Server port (optional, defaults to 3000)

**Build:**
- `tsconfig.json` - TypeScript compiler configuration in `src/` and `prisma/` directories
- `package.json` - Scripts: `start`, `dev`, `build`, `test`, `test:watch`, `test:coverage`

## Platform Requirements

**Development:**
- Node.js 18+ (recommended from TypeScript 5.3 target ES2022)
- PostgreSQL 13+ with pgvector extension
- Redis 6+ for job queue
- Google API key (free tier: 5 requests per minute limit noted in `.env.example`)

**Production:**
- Container deployment (docker-compose.yml present for local development)
- PostgreSQL with pgvector extension (specified in `docker-compose.yml` using `ankane/pgvector:latest`)
- Redis for distributed job queue
- Access to Google Generative AI API
- Access to Auth0 for authentication
- Access to Meta WhatsApp Cloud API for messaging

## Dependencies at Risk

- **@prisma/client @ 6.4.1** - Breaking changes across major versions; migrations required on upgrades
- **Google Generative AI SDKs** - API rate limits (5 RPM free tier); production requires paid tier
- **@langchain packages** - Rapid evolution; versions should be kept synchronized

---

*Stack analysis: 2026-04-25*
