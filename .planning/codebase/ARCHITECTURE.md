# Architecture

**Analysis Date:** 2026-04-25

## Overview

AlphaToca Backend is a **Node.js/TypeScript** service for a real-estate rental platform that combines a conventional REST API (properties, users, visits) with a **WhatsApp-driven conversational agent** backed by a **RAG (Retrieval-Augmented Generation)** pipeline over pgvector.

The codebase follows a classic **layered architecture** (Routes → Controllers → Services → Prisma) with one asynchronous pipeline on the side (**BullMQ worker**) that consumes inbound WhatsApp webhook events, runs them through the RAG chain, and optionally extracts lead insights.

## High-level Pattern

Layered monolith with a background worker:

```
               ┌──────────────────────────────────────────┐
   HTTP  ───►  │  Express app (src/app.ts)                │
               │  CORS → JSON → Auth0 (checkJwt + sync)   │
               │  Routes → Controllers → Services → DB    │
               └───────────────┬──────────────────────────┘
                               │
                               │ (REST: /api/properties,
                               │        /api/users,
                               │        /api/visits,
                               │        /api/webhooks)
                               │
   WhatsApp ─►  POST /api/webhooks/whatsapp
                               │
                               ▼
                     enqueue job → Redis/BullMQ
                               │
                               ▼
               ┌──────────────────────────────────────────┐
               │  WhatsApp Worker (src/workers/           │
               │  whatsappWorker.ts)                      │
               │  – upsert user / session / message       │
               │  – RAG chain (ragChainService)           │
               │  – send outbound WhatsApp message        │
               │  – async lead extraction (limited        │
               │    concurrency)                          │
               └──────────────────────────────────────────┘
                               │
                               ▼
               Postgres (Prisma) + pgvector (knowledge base)
```

## Layers

### 1. Routes (`src/routes/`)
Thin Express routers with **Swagger/OpenAPI JSDoc annotations** inline. They only wire paths to controller methods.
- `webhookRoutes.ts` — public (no auth): GET/POST `/api/webhooks/whatsapp`
- `propertyRoutes.ts` — authenticated CRUD for properties
- `userRoutes.ts` — authenticated user endpoints
- `visitRoutes.ts` — authenticated visit/booking endpoints

### 2. Controllers (`src/controllers/`)
Parse requests (Zod), call services, format HTTP responses. Controllers own HTTP concerns only; never talk to Prisma directly.
- `webhookController.ts` — WhatsApp verify handshake + payload intake, enqueues BullMQ jobs
- `propertyController.ts`, `userController.ts`, `visitController.ts`

Domain errors (`VisitError`) are caught and translated to structured JSON responses; everything else falls through to the global error handler.

### 3. Services (`src/services/`)
Business logic. Services accept a **dependency-injected `deps` argument** (with a default singleton) so tests can swap Prisma for an in-memory fake — see `visitService.ts:26-34`.
- `visitService.ts` — booking lifecycle, conflict detection, availability slot generation
- `propertyService.ts`, `userService.ts`, `whatsappService.ts`, `messageStatusService.ts`
- `ragChainService.ts` — builds the LangChain retrieval+generation chain
- `ragRetrieverService.ts` — pgvector similarity search
- `leadExtractionService.ts` — structured-output LLM call (currently stubbed with `llm = null as any`)

### 4. Persistence (`src/config/db.ts`, `prisma/`)
Single Prisma singleton. `prisma/schema.prisma` defines 10 models; `KnowledgeDocument.embedding` uses the `vector(1536)` type via the `postgresqlExtensions` preview feature.

### 5. Background worker (`src/workers/whatsappWorker.ts`)
BullMQ `Worker` bound to Redis (`ioredis`). Imported at boot from `src/server.ts:2` so it starts in the same process as the API.

### 6. Middleware (`src/middlewares/`)
- `authMiddleware.ts` — `checkJwt` (Auth0 via `express-oauth2-jwt-bearer`) + `authSyncMiddleware` (upsert Auth0 sub → local User) + `validateAuthConfig()` called at startup
- `errorHandler.ts` — global last-stop handler; translates `ZodError`, `UnauthorizedError`, JSON `SyntaxError` into `{status, code, messages[]}` shape

## Entry points

- `src/server.ts` — boots LangSmith tracing, imports the worker side-effect, starts `app.listen`
- `src/app.ts` — builds the Express app, mounts routes, registers the global error handler
- `src/scripts/ingestKnowledge.ts` — one-shot CLI to chunk & embed FAQ/docs into `knowledge_documents`
- `src/scripts/evalRag.ts` — RAG evaluation runner
- `prisma/seed.ts` — DB seed

## Data flow — two shapes

### Synchronous REST (e.g., `POST /api/visits`)
1. Auth0 JWT verified (`checkJwt`)
2. Local user upserted by `authSyncMiddleware`
3. `visitController.create` parses body with `createVisitSchema` (Zod)
4. `visitService.createVisit` resolves `landlordId` from the property, checks for conflicts in a ±180-minute window, writes the visit
5. Controller returns 201 JSON; any `VisitError` becomes `{409|404, code}`

### Asynchronous WhatsApp
1. Meta sends POST to `/api/webhooks/whatsapp`
2. `webhookController.receiveMessage` Zod-validates the payload and enqueues `messageQueue.add(...)`
3. Worker picks up the job, upserts the `User` (by `phoneNumber`), reuses or creates an `ACTIVE_BOT` `ChatSession` (7-day TTL), persists the inbound `Message`
4. Worker calls `generateAnswer({sessionId, userMessage})` (RAG chain) → text reply
5. Worker sends reply via WhatsApp Graph API (`whatsappService.sendMessage`), persists outbound `Message`
6. Worker asynchronously (bounded concurrency = 3) calls `extractInsights` to persist `AiExtractedInsight` rows

## Core abstractions

- **`VisitDeps` (service-level DI)** — every service exports a `Deps` interface with its own narrowed `Pick<PrismaClient, ...>` subset. Tests construct a fake that implements just those methods. See `src/services/visitService.ts:26-34`.
- **`VisitError`** — typed domain error with `code` + `httpStatus` + optional `details`. Controllers unwrap it into JSON. `src/services/visitService.ts:10-24`.
- **Zod schemas** (`src/utils/*Validation.ts`, `src/schemas/whatsappSchema.ts`) — input contracts used both at the controller boundary and inferred for service input types.
- **`ConcurrencyLimiter`** — hand-rolled limiter used to cap lead-extraction parallelism. `src/workers/whatsappWorker.ts:25-51`.
- **RAG config singleton (`src/config/rag.ts`)** — centralizes model names, similarity threshold, API key accessors.

## Cross-cutting concerns

- **Auth** — Auth0 JWT on every `/api/*` route except `/api/webhooks/*` and `/health`. `authSyncMiddleware` maps `auth0_sub` → local `User.id` and places it on `req.user`.
- **Validation** — Zod at controller entry; `safeParse` in the webhook path so a bad payload never reaches the queue.
- **Logging** — `console.log`/`console.error` with bracketed context prefixes (`[Auth]`, `[Error Handler]`, `[server]`). No structured logger yet.
- **Tracing** — optional LangSmith tracing bootstrapped in `src/config/langsmith.ts` and kicked off from `server.ts:8`.
- **Docs** — Swagger JSDoc comments on routes; `setupSwagger` in `src/config/swagger.ts` (currently referenced but not wired into `app.ts`).

## External boundaries

| Boundary              | Integration                                           |
|-----------------------|-------------------------------------------------------|
| Auth                  | Auth0 (`express-oauth2-jwt-bearer`, `jwks-rsa`)       |
| DB                    | Postgres via Prisma 6.4.1, `vector` extension         |
| Queue / worker broker | Redis via `ioredis` + BullMQ                          |
| Messaging             | WhatsApp Cloud API (Meta Graph)                       |
| LLM (chat)            | Google Gemini via `@langchain/google-genai`           |
| LLM (embeddings)      | Gemini `gemini-embedding-001`, 1536 dims              |
| Observability         | LangSmith (optional)                                  |

## Ports & Adapters (implicit)

The codebase is not a strict hexagonal architecture, but the DI-by-`deps` convention in each service acts as a de-facto port: services declare a minimal Prisma surface they need (`VisitPrismaClient = Pick<PrismaClient, 'visit' | 'property'>`) and tests swap in a lightweight adapter. This is the most important pattern for a new contributor to understand — **the tests do not mock Prisma globally; they hand-roll a fake via `deps`**.

## Where things live (quick map)

| Concern                         | File                                                        |
|---------------------------------|-------------------------------------------------------------|
| Express app bootstrap           | `src/app.ts`                                                |
| Server listen + worker side-fx  | `src/server.ts`                                             |
| Route tree                      | `src/routes/*.ts`                                           |
| HTTP adapters                   | `src/controllers/*.ts`                                      |
| Business logic                  | `src/services/*.ts`                                         |
| Validation (Zod)                | `src/utils/*Validation.ts`, `src/schemas/whatsappSchema.ts` |
| Auth pipeline                   | `src/middlewares/authMiddleware.ts`                         |
| Global error shape              | `src/middlewares/errorHandler.ts`                           |
| Prisma client singleton         | `src/config/db.ts`                                          |
| Schema + migrations             | `prisma/schema.prisma`                                      |
| RAG config                      | `src/config/rag.ts`                                         |
| RAG chain                       | `src/services/ragChainService.ts`                           |
| RAG retriever                   | `src/services/ragRetrieverService.ts`                       |
| WhatsApp worker                 | `src/workers/whatsappWorker.ts`                             |
| BullMQ queue                    | `src/queues/whatsappQueue.ts`                               |
| Ingest knowledge (CLI)          | `src/scripts/ingestKnowledge.ts`                            |

---

*Architecture mapping: 2026-04-25*
