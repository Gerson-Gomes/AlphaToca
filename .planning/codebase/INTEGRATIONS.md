# External Integrations

**Analysis Date:** 2026-04-25

## APIs & External Services

**Google Generative AI (Gemini):**
- Gemini 2.5 Flash - LLM for RAG chain query responses
  - SDK/Client: `@google/genai` (1.50.1) and `@langchain/google-genai` (2.1.27)
  - Auth: `GOOGLE_API_KEY`
  - Model: `gemini-2.5-flash` (chat), `gemini-embedding-001` (embeddings at 1536 dims)
  - Rate Limit: 5 requests per minute (free tier)
  - Usage: `src/config/geminiEmbedder.ts`, `src/services/ragChainService.ts`

**Meta WhatsApp Cloud API (v20.0):**
- Send/receive messages via WhatsApp Business Account
  - SDK/Client: Direct HTTP calls via `axios` from `src/services/whatsappService.ts`
  - Auth: `TOKEN_ACCES_WHATSAPP` (bearer token)
  - Endpoint: `https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages`
  - Verification: Webhook challenge verification using `WHATSAPP_VERIFY_TOKEN`
  - Webhook Receiver: `POST /api/webhook/whatsapp` in `src/routes/webhookRoutes.ts`

**Auth0 (Identity & Access Management):**
- JWT-based authentication and authorization
  - SDK/Client: `express-oauth2-jwt-bearer` (1.8.0) for middleware, `jwks-rsa` (4.0.1) for JWKS validation
  - Auth: `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER_BASE_URL`
  - Token Algorithm: RS256
  - User Sync: Custom sync logic in `src/services/userService.ts` → `upsertUserFromAuth0()`
  - Middleware: `checkJwt` validates JWT, `authSyncMiddleware` syncs to local database
  - Routes Protected: `/api/properties`, `/api/users`, `/api/visits` (via `authStack` in `src/app.ts`)

**LangSmith (Optional - LLM Observability):**
- Tracing and debugging for LangChain calls
  - SDK/Client: Built into LangChain (auto-enabled via environment)
  - Auth: `LANGCHAIN_API_KEY`
  - Config: `LANGCHAIN_TRACING_V2=true` to enable, `LANGCHAIN_PROJECT` for project name
  - Status Detection: `src/config/langsmith.ts` validates configuration at startup
  - Default Project: "alphatoca-dev" (from `.env.example`)

**OpenAI (Optional Fallback):**
- Kept as fallback for embeddings/chat
  - SDK/Client: `@langchain/openai` (1.4.4)
  - Auth: `OPENAI_API_KEY`
  - Usage: Commented out in `src/services/leadExtractionService.ts`; not currently active

**Anthropic Claude (Optional Fallback):**
- Kept as fallback for LLM responses
  - SDK/Client: `@langchain/anthropic` (1.3.26)
  - Auth: `ANTHROPIC_API_KEY`
  - Usage: Commented out in `src/services/leadExtractionService.ts`; not currently active

## Data Storage

**Databases:**
- PostgreSQL 13+ (with pgvector extension)
  - Connection: `DATABASE_URL` (connection string for application)
  - Direct URL: `DIRECT_URL` (for Prisma migrations)
  - Client: Prisma ORM (`@prisma/client` 6.4.1)
  - Vector Support: pgvector extension enabled in `prisma/schema.prisma` for embeddings
  - Docker: `ankane/pgvector:latest` in `docker-compose.yml` (port 5433)
  - Schema: `prisma/schema.prisma` with models: User, Property, PropertyImage, ChatSession, Message, RentalProcess, AiExtractedInsight, KnowledgeDocument, RentalDocument, Visit

**File Storage:**
- AWS S3 or Cloud Storage URL (inferred)
  - Reference: `PropertyImage.url` stored as URL string (no SDK integration visible)
  - Intent: Image hosting for properties (comment in schema: "URL da imagem no storage (ex: S3, Cloudinary)")
  - Status: Integration not implemented in current codebase (URLs only, no upload logic)

**Caching:**
- Redis 6+ (via ioredis)
  - Connection: `REDIS_URL`
  - Purpose: Job queue backend for BullMQ
  - Docker: `redis:alpine` in `docker-compose.yml` (port 6380)
  - Not used for HTTP caching (only queue operations)

## Authentication & Identity

**Auth Provider:**
- Auth0 (primary)
  - Implementation: JWT bearer tokens validated via JWKS
  - Endpoints: `{AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json` (implicit via jwks-rsa)
  - Token Payload: Contains `sub` (Auth0 subject ID), synced to `User.auth0Sub` in database
  - Roles: TENANT, LANDLORD, ADMIN (mapped in `User.role` via `src/services/userService.ts`)
  - Middleware Chain: `checkJwt` → `authSyncMiddleware` → role-based middleware (`requireRole`)

**Custom Middleware:**
- `src/middlewares/authMiddleware.ts`:
  - `validateAuthConfig()`: Startup validation of Auth0 environment variables
  - `checkJwt`: Express-oauth2-jwt-bearer middleware for JWT validation
  - `authSyncMiddleware`: Upserts Auth0 user into local database, attaches to `req.localUser`
  - `requireRole()`: Factory for role-based access control

## Monitoring & Observability

**Error Tracking:**
- None detected - no Sentry, Rollbar, or similar integration

**Logs:**
- Console logging (built-in)
  - Debug output: Color-coded console logs via ANSI escape sequences
  - Examples: `\x1b[35m` (magenta), `\x1b[31m` (red), `\x1b[32m` (green)
  - Components: Webhook events, WhatsApp API calls, auth errors, database queries

**LangChain Tracing (Optional):**
- LangSmith tracing (see LangSmith section above)
  - Enabled via `LANGCHAIN_TRACING_V2=true`
  - Endpoint: `https://api.smith.langchain.com` (overridable via `LANGCHAIN_ENDPOINT`)

## CI/CD & Deployment

**Hosting:**
- Not specified in codebase
  - Expected: Cloud platform (AWS, GCP, Azure, Railway, Vercel, Render, etc.)
  - Docker support ready: `docker-compose.yml` for local development

**CI Pipeline:**
- Not detected - no `.github/workflows/`, `.gitlab-ci.yml`, or similar

**Local Development Stack:**
- Docker Compose (`docker-compose.yml`):
  - PostgreSQL service: `alphatoca_db` (port 5433)
  - Redis service: `alphatoca_redis` (port 6380)
  - Persistent: `pg-data` volume for database

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection (required)
- `DIRECT_URL` - PostgreSQL direct connection (required for migrations)
- `REDIS_URL` - Redis connection (required for job queue)
- `AUTH0_AUDIENCE` - Auth0 API audience (required)
- `AUTH0_ISSUER_BASE_URL` - Auth0 issuer (required)
- `AUTH0_CLIENT_ID` - Auth0 client (required)
- `AUTH0_CLIENT_SECRET` - Auth0 secret (required)
- `GOOGLE_API_KEY` - Google Generative AI key (required for RAG)
- `TOKEN_ACCES_WHATSAPP` - WhatsApp API token (required for messaging)
- `PHONE_NUMBER_ID` - WhatsApp phone number ID (required for messaging)
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token (required)
- `PORT` - Server port (optional, defaults to 3000)
- `LANGCHAIN_TRACING_V2` - Enable tracing (optional, defaults to false)
- `LANGCHAIN_API_KEY` - LangSmith key (optional, required if tracing enabled)
- `LANGCHAIN_PROJECT` - LangSmith project (optional, defaults to "default")
- `NODE_ENV` - Environment (optional, "production" disables Prisma singleton)

**Optional env vars (legacy/fallback):**
- `OPENAI_API_KEY` - OpenAI API key (not used in primary flow)
- `ANTHROPIC_API_KEY` - Anthropic API key (not used in primary flow)

**Secrets location:**
- `.env` file (local development)
- Environment variables (production deployment)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/webhook/whatsapp` - Receives WhatsApp messages and status updates from Meta
  - Verification: GET request with `hub.mode=subscribe`, `hub.challenge`, verified via `WHATSAPP_VERIFY_TOKEN`
  - Payload Processing: Parsed via `WhatsAppWebhookSchema` in `src/schemas/whatsappSchema.ts`
  - Queue Integration: Valid messages enqueued to BullMQ (`messageQueue`)
  - Status Updates: Message status callbacks processed separately

**Outgoing:**
- WhatsApp message send via Meta Cloud API
  - Endpoint: `POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages`
  - Trigger: Via `src/services/whatsappService.ts` → `sendMessage()`
  - Auth: Bearer token from `TOKEN_ACCES_WHATSAPP`

## Integration Points in Code

**Message Flow:**
1. WhatsApp message arrives → `POST /api/webhook/whatsapp` (webhook controller)
2. Webhook enqueues to BullMQ `messageQueue` (job queue in Redis)
3. BullMQ worker processes: `src/workers/whatsappWorker.ts`
4. Worker calls RAG chain: `src/services/ragChainService.ts` → generateAnswer()
5. RAG retrieves embeddings from PostgreSQL vector table
6. Gemini 2.5 Flash generates response
7. Response sent via `src/services/whatsappService.ts` → `sendMessage()`
8. Delivery status tracked via webhook callbacks

**Key Service Files:**
- `src/config/geminiEmbedder.ts` - Gemini embedding adapter
- `src/config/langsmith.ts` - LangSmith bootstrap
- `src/services/ragChainService.ts` - RAG orchestration (LangChain)
- `src/services/whatsappService.ts` - WhatsApp message send
- `src/workers/whatsappWorker.ts` - BullMQ worker
- `src/queues/whatsappQueue.ts` - Queue initialization
- `src/controllers/webhookController.ts` - Webhook handler
- `src/middlewares/authMiddleware.ts` - Auth0 integration
- `src/services/userService.ts` - User sync from Auth0

---

*Integration audit: 2026-04-25*
