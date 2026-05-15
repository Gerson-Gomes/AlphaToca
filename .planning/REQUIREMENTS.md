# I-Moveis Requirements

Source precedence: `ADR > SPEC > PRD > DOC`. No ADRs ingested, one auth SPEC
(complete), PRD `tasks/prd-rag-langchain.md` authoritative for RAG scope.
IDs follow `REQ-<CATEGORY>-<NN>` where category groups by feature area.

---

## Summary

- v1 requirements: **18**
- Categories: AUTH (5, all delivered), WHATS (3), CONV (3), RAG (5),
  LEAD (1), EVAL (1), API (1), POLISH (4)
- Deferred to v2: see PROJECT.md "Out of scope" section
- Coverage: see Traceability table at bottom — 100% mapped to phases

Requirements flagged `[DELIVERED]` are already satisfied by pre-existing
work (auth track, inbound webhook, queue scaffolding); they are included
here for completeness and to anchor traceability.

---

## Category: AUTH — Authentication & Identity

Sourced from `conductor/tracks/auth_jwt_auth0_20260416/spec.md`. The track is
complete (checkpoints `71df7f3`, `a22b10b`, `37fa387`, `519f4de`). Listed so
the milestone metric can confirm nothing has regressed.

### REQ-AUTH-01 `[DELIVERED]` — Auth0 JWT validation middleware

- **Description:** All sensitive API routes require a valid Auth0-issued JWT.
  Unauthorized requests return HTTP 401.
- **Acceptance criteria:**
  - `checkJwt` middleware from `express-oauth2-jwt-bearer` is applied to
    `/api/properties`, `/api/users`, `/api/visits`.
  - Missing/invalid/expired token → HTTP 401 via the global
    `errorHandler.ts` `ErrorResponse` shape.
  - `/api/webhooks/*` and `/health` remain public.
- **Source:** `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
  (CONSTRAINT-jwt-validation-middleware, NFR-auth-security).

### REQ-AUTH-02 `[DELIVERED]` — User sync on first login

- **Description:** On the first successful Auth0 login, auto-create a `users`
  row. On every subsequent login, sync name + phone from Auth0 to local DB
  without blocking auth on failure.
- **Acceptance criteria:**
  - `authSyncMiddleware` runs after `checkJwt`, invokes
    `userService.upsertUserFromAuth0`, attaches local user to `req`.
  - Sync failure logs but returns the Auth0-authenticated request.
  - Repeated logins update, never duplicate (keyed on `auth0Sub`).
- **Source:** `CONSTRAINT-user-sync-on-login`, `NFR-auth-reliability`.

### REQ-AUTH-03 `[DELIVERED]` — Role mapping from JWT custom claims

- **Description:** Auth0 roles are mapped to the Prisma `Role` enum via
  custom claims inside the JWT.
- **Acceptance criteria:**
  - Roles read from configured custom claim in `upsertUserFromAuth0`.
  - Supported values: `TENANT`, `LANDLORD`, `ADMIN`.
  - `requireRole(...)` factory enforces role-based access on routes that
    need it.
- **Source:** `CONSTRAINT-role-mapping-from-jwt-custom-claims`.

### REQ-AUTH-04 `[DELIVERED]` — Auth acceptance tests

- **Description:** Integration-level acceptance tests cover the auth
  contract.
- **Acceptance criteria:**
  - Unauthorized requests to protected routes → 401.
  - Valid JWT → permitted.
  - New users are created on first login.
  - Roles are identifiable from JWT custom claims.
  - Auth0 profile updates reflect in the local DB.
- **Source:** `CONSTRAINT-auth-acceptance-tests`.

### REQ-AUTH-05 `[DELIVERED]` — Standard auth libraries only

- **Description:** JWT handling uses `express-oauth2-jwt-bearer` and
  `jwks-rsa`; no hand-rolled parsing.
- **Source:** `NFR-auth-maintainability`.

---

## Category: WHATS — WhatsApp Messaging Plumbing

### REQ-WHATS-01 `[DELIVERED]` — Webhook inbound validation + queue enqueue

- **Description:** `POST /api/webhooks/whatsapp` validates incoming payloads
  with Zod, enqueues valid messages to BullMQ, and returns HTTP 200
  immediately per Meta's spec. Non-text messages are handled gracefully
  (recent commit `80694ce`).
- **Acceptance criteria:**
  - Payload validated against `WhatsAppWebhookSchema`.
  - Valid → `messageQueue.add(...)`; invalid → 200 with logged failure.
  - Proxy trust is configured so ngrok / load balancer `X-Forwarded-For`
    resolves correctly (commit `80694ce`).
  - GET handshake with `hub.mode=subscribe` is verified against
    `WHATSAPP_VERIFY_TOKEN`.
- **Source:** `plan.md` Phase 1; commits `80694ce`, `b8f11fc`.

### REQ-WHATS-02 — Webhook security hardening

- **Description:** The inbound webhook must verify Meta's
  `X-Hub-Signature-256` HMAC header against the raw body, apply per-IP rate
  limiting, and fail fast at boot if `WHATSAPP_VERIFY_TOKEN` or
  `META_APP_SECRET` is missing.
- **Acceptance criteria:**
  - `META_APP_SECRET` env var validated at startup (mirrors
    `validateAuthConfig()` pattern per CONCERNS.md).
  - Requests missing or failing the `sha256=<hex>` signature are rejected
    with 401 (after returning the Meta-required 200 handshake path, this
    applies only to POST payloads).
  - `express-rate-limit` applied to `/api/webhooks/*` with a per-IP quota.
  - Malformed payloads are persisted to a dead-letter table
    (e.g. `webhook_failures`) so silent swallowing is eliminated.
  - Unit tests cover: missing header, wrong signature, over-quota, valid
    signed payload.
- **Source:** CONCERNS.md "Webhook does not verify Meta's X-Hub-Signature-256",
  "Webhook endpoint is unauthenticated and has no rate limit",
  "Webhook returns 200 on validation failure", "Webhook verify token not
  validated at startup".

### REQ-WHATS-03 — Outbound WhatsApp send

- **Description:** The backend sends outbound text messages via the Meta
  Cloud API from within the worker, with structured error handling for rate
  limits and invalid numbers.
- **Acceptance criteria:**
  - `whatsappService.sendMessage(phoneNumber, text)` posts to
    `https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages` with a
    bearer token from `TOKEN_ACCES_WHATSAPP`.
  - Rate limits (429) and invalid-number responses are translated to
    typed errors so the worker can handle them.
  - On send failure, the inbound `Message` is already persisted and the
    session is flipped to `WAITING_HUMAN` per the RAG PRD's FR-11c.
  - Unit tests with mocked `axios` cover success, 429, 4xx invalid number,
    network error.
- **Source:** `plan.md` Phase 2 (Tasks 2.1–2.4).

---

## Category: CONV — Conversation State (Users, Sessions, Messages)

### REQ-CONV-01 — Find-or-create user by phone number

- **Description:** The worker finds-or-creates a `User` keyed on
  `phoneNumber` for every inbound WhatsApp message.
- **Acceptance criteria:**
  - Repository-level function `findOrCreateUserByPhone(phoneNumber)`
    returns the existing or newly-created `User`.
  - New users are assigned role `TENANT` by default.
  - Unit test with mocked Prisma covers create, find, and concurrent
    create race (collision on unique index resolves to the existing row).
- **Source:** `plan.md` Phase 3 Task 3.1; PRD US-006 step 1.

### REQ-CONV-02 — Session lifecycle (find-or-create, TTL, terminal states)

- **Description:** The worker resolves an `ACTIVE_BOT` `ChatSession` per
  user, creating a new one if none exists or the existing one has expired.
  `WAITING_HUMAN` and `RESOLVED` sessions suppress auto-reply.
- **Acceptance criteria:**
  - Sessions have a configurable TTL (current code uses 7 days of wall
    time; CONCERNS.md flags this as creation-time only — switch to
    activity-based TTL by bumping `expiresAt` on each message).
  - If session status is `WAITING_HUMAN` or `RESOLVED`, inbound is
    persisted but no outbound is generated.
  - `isSessionExpired` uses activity-based comparison, not creation-time.
  - Unit tests cover: no session → create, active session → reuse,
    expired → create new, `WAITING_HUMAN` → persist only.
- **Source:** `plan.md` Phase 3 Task 3.2; PRD US-006 steps 2–3;
  CONCERNS.md "Session TTL", "isSessionExpired".

### REQ-CONV-03 — Message persistence (inbound + outbound)

- **Description:** Every inbound WhatsApp message (senderType `TENANT`) and
  every bot reply (senderType `BOT`) is persisted into `Message` tied to
  the active `ChatSession`.
- **Acceptance criteria:**
  - Inbound persisted before RAG call.
  - Outbound persisted after successful WhatsApp send.
  - Worker steps 3–6 (upsert → RAG → send → persist outbound) are wrapped
    in `prisma.$transaction` where possible, or rely on WAMID-based
    idempotency so retries do not double-persist.
  - Unit tests cover happy path, retry idempotency, RAG throw.
- **Source:** `plan.md` Phase 3 Tasks 3.3–3.4; PRD US-006 steps 4–8;
  CONCERNS.md "multi-step message handling".

---

## Category: RAG — Retrieval-Augmented Generation Pipeline

Authoritative source: `tasks/prd-rag-langchain.md` (high confidence PRD).

### REQ-RAG-01 — RAG config module (PRD US-001)

- **Description:** `src/config/rag.ts` centralizes model IDs, chunking, and
  retrieval parameters and fails fast when required secrets are missing.
- **Acceptance criteria (from PRD US-001):**
  - Exports typed constants:
    `EMBEDDING_MODEL = "text-embedding-3-small"`, `EMBEDDING_DIMS = 1536`,
    `CHUNK_SIZE = 800`, `CHUNK_OVERLAP = 120`, `RETRIEVER_K = 4`,
    `SIMILARITY_THRESHOLD = 0.72`.
  - Reads `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from `process.env`;
    boot fails with a clear error if either is missing.
  - `assertRagSecrets()` invoked from `src/server.ts` before
    `app.listen()` (CONCERNS.md "RAG API keys validated lazily").
  - `npx tsc --noEmit` passes.
- **Source:** PRD US-001, FR-1, FR-4, FR-13.
- **Note on provider drift:** the existing code (`config/rag.ts`,
  `config/geminiEmbedder.ts`, `ragChainService.ts`) currently points at
  Google Gemini. Per the PRD, the authoritative choice is OpenAI embeddings
  + Claude Sonnet 4.6. This requirement includes replacing the Gemini
  plumbing with the PRD-pinned stack OR updating the PRD via ADR before
  diverging — no silent drift.

### REQ-RAG-02 — `KnowledgeDocument` schema for ingestion tracking (PRD US-002)

- **Description:** Extend the `KnowledgeDocument` Prisma model with fields
  needed for idempotent re-ingestion.
- **Acceptance criteria (from PRD US-002):**
  - Fields added: `sourcePath String`, `chunkIndex Int`,
    `contentHash String`, `createdAt DateTime @default(now())`,
    `updatedAt DateTime @updatedAt`.
  - Compound unique index on `(sourcePath, chunkIndex)`.
  - Index on `contentHash`.
  - `npx prisma migrate dev --name add_rag_ingestion_tracking` succeeds
    against a local DB.
  - `npx prisma generate` runs cleanly.
  - Typecheck passes.
- **Source:** PRD US-002, FR-5.

### REQ-RAG-03 — Ingestion CLI (PRD US-003)

- **Description:** `npm run ingest:knowledge` walks `documentation/`,
  chunks every `.md`, embeds new/changed chunks, and upserts them
  idempotently.
- **Acceptance criteria (from PRD US-003):**
  - `src/scripts/ingestKnowledge.ts` recursively reads all `*.md` under
    `documentation/`.
  - Splits each file with LangChain `RecursiveCharacterTextSplitter` using
    `CHUNK_SIZE`/`CHUNK_OVERLAP`.
  - Computes `sha256(content)` per chunk as `contentHash`.
  - Upsert by `(sourcePath, chunkIndex)`: insert on miss, skip on matching
    hash, update on differing hash.
  - Deletes rows whose `(sourcePath, chunkIndex)` no longer exist.
  - Embeddings written via parameterized `$executeRaw` with `::vector`
    cast (CONCERNS.md flags current `$executeRawUnsafe` usage — harden it).
  - Logs summary: `N files, X inserted, Y updated, Z skipped, W deleted`.
  - npm script `"ingest:knowledge": "ts-node src/scripts/ingestKnowledge.ts"`.
  - Second run reports `0 inserted, 0 updated, N skipped, 0 deleted`.
  - Unit test with mocked embeddings + mocked Prisma verifies hash-skip.
  - Typecheck + tests pass.
- **Source:** PRD US-003, FR-3, FR-4, FR-5.

### REQ-RAG-04 — pgvector retriever (PRD US-004)

- **Description:** `src/services/ragRetrieverService.ts` exports
  `retrieveRelevantChunks(query)` returning top-K chunks by cosine
  similarity with scores.
- **Acceptance criteria (from PRD US-004):**
  - Signature:
    `retrieveRelevantChunks(query: string): Promise<RetrievedChunk[]>`
    where `RetrievedChunk = { id, content, title, score }`.
  - Query embedding uses the same `EMBEDDING_MODEL` as ingest.
  - Single raw SQL query with pgvector `<=>` cosine operator,
    `ORDER BY embedding <=> $1 ASC LIMIT K`; returns
    `similarity = 1 - distance`.
  - Rows with `embedding IS NULL` are excluded.
  - Unit test verifies ordering and K limit.
  - Typecheck + tests pass.
- **Source:** PRD US-004, FR-6.

### REQ-RAG-05 — Conversational RAG chain (PRD US-005)

- **Description:** `src/services/ragChainService.ts` exports
  `generateAnswer({ sessionId, userMessage })` and produces a grounded
  Portuguese reply with handoff fallback.
- **Acceptance criteria (from PRD US-005):**
  - Loads last 10 `Message`s for the session (oldest first) as
    `HumanMessage` / `AIMessage`.
  - Calls `retrieveRelevantChunks`; if no chunk exceeds
    `SIMILARITY_THRESHOLD` (0.72), returns
    `{ answer: <fallback>, handoff: true }` without calling the LLM.
  - Builds the prompt per PRD Section 6 (system prompt in Portuguese,
    tone from `documentation/buisness_plan.md` section 6, context
    concatenation, history, new message).
  - Calls Claude Sonnet 4.6 via `@langchain/anthropic` at
    `temperature: 0.2`, with 30s timeout and one retry on network error.
  - Returns
    `{ answer, handoff, topScore, usedChunkIds }`.
  - Unit tests with mocked LLM + retriever cover low-score handoff,
    high-score success, and prompt history inclusion.
  - Uses LCEL `RunnableSequence` + `ChatPromptTemplate`; does NOT use
    the deprecated `ConversationalRetrievalChain` (per PRD Technical
    Considerations, overrides `plan.md` Task 4.3).
  - Typecheck + tests pass.
- **Source:** PRD US-005, FR-2, FR-7, FR-8, FR-9, FR-14.

---

## Category: WORKER — WhatsApp Worker Integration

### REQ-WORKER-01 — Wire RAG into `whatsappWorker.ts` (PRD US-006)

- **Description:** The BullMQ worker orchestrates the full inbound turn:
  user/session resolution, inbound persistence, RAG call, outbound
  persistence, WhatsApp send, and handoff on error/low-confidence.
- **Acceptance criteria (from PRD US-006):**
  - Worker handler for each inbound message performs the 8-step
    sequence in US-006 exactly:
    1. Find-or-create `User` by `phoneNumber`.
    2. Find active `ACTIVE_BOT` session or create one.
    3. If `WAITING_HUMAN`/`RESOLVED`: persist inbound, return.
    4. Persist inbound `Message` (`senderType: TENANT`).
    5. Call `generateAnswer({ sessionId, userMessage })`.
    6. Persist outbound `Message` (`senderType: BOT`).
    7. If `handoff` true: flip session to `WAITING_HUMAN`.
    8. Send via `whatsappService.sendMessage`.
  - RAG errors caught; worker sends a Portuguese apology and flips session
    to `WAITING_HUMAN` (FR-11c).
  - WAMID-based idempotency prevents double processing on BullMQ retries
    (CONCERNS.md "Worker idempotency").
  - Integration-style unit tests cover happy path, handoff path, and
    already-`WAITING_HUMAN` path.
  - Typecheck + tests pass.
- **Source:** PRD US-006, FR-10, FR-11.

---

## Category: LEAD — Lead Qualification & Insight Extraction

### REQ-LEAD-01 — Structured lead extraction (PRD US-007)

- **Description:** After the outbound reply, extract tenant preferences
  via LangChain structured output and persist them to `RentalProcess` /
  `AiExtractedInsight`.
- **Acceptance criteria (from PRD US-007):**
  - `src/services/leadExtractionService.ts` exports
    `extractInsights({ sessionId, userMessage }): Promise<ExtractedInsights>`.
  - Replaces the current stub (`llm = null as any`, CONCERNS.md known
    bug "Lead extraction will crash on first real message"). Uses
    Claude Sonnet 4.6 at `temperature: 0` via `llm.withStructuredOutput(
      zodSchema)`.
  - Zod schema:
    `{ budget?: number, neighborhood?: string, bedrooms?: number,
       pets_allowed?: boolean,
       intent: "search" | "schedule_visit" | "contract_question" |
               "human_handoff" | "other" }`.
  - Invoked from `whatsappWorker.ts` AFTER the outbound send (via a
    second BullMQ job or `queueMicrotask`) so user-facing latency is not
    affected.
  - Finds-or-creates exactly one open `RentalProcess` per tenant in
    `TRIAGE`.
  - For each non-null key, upserts an `AiExtractedInsight` row
    (`insightKey` / `insightValue`); updates existing keys in place.
  - If `intent === "human_handoff"`, flips session to `WAITING_HUMAN`
    regardless of retriever confidence.
  - Unit tests cover parsing, single-`RentalProcess` invariant, upsert
    behavior on repeat, human_handoff path.
  - Typecheck + tests pass.
- **Source:** PRD US-007, FR-11b, FR-12.

---

## Category: EVAL — Quality Evaluation

### REQ-EVAL-01 — RAG smoke-test script (PRD US-008)

- **Description:** `npm run eval:rag` runs a hard-coded 8-question
  Portuguese eval set against `generateAnswer` without touching WhatsApp.
- **Acceptance criteria (from PRD US-008):**
  - `src/scripts/evalRag.ts` reads ~8 questions covering triagem,
    visita, documentação, rescisão, pagamento.
  - Per question, prints: question, top chunk title, similarity score,
    handoff flag, final answer.
  - npm script `"eval:rag": "ts-node src/scripts/evalRag.ts"`.
  - Typecheck passes.
  - Manual grading target (product-owner review): >=80%
    "correct + on-tone"; 0/8 in-scope handoffs; 100% out-of-scope probes
    handoff.
- **Source:** PRD US-008, Success Metrics Section 8.

---

## Category: API — Property / Visit REST

### REQ-API-01 — Property + Visit API documentation hardening

- **Description:** The existing `/api/properties` and `/api/visits` routes
  (already implemented and Auth0-protected) must have Swagger/OpenAPI docs
  live at `/api-docs` and a small set of endpoint-level contract tests.
- **Acceptance criteria:**
  - `setupSwagger(app)` wired into `src/app.ts` (CONCERNS.md "Swagger
    wiring dead-ends").
  - `/api-docs` returns a usable Swagger UI in dev (gated behind
    `NODE_ENV !== 'production'` or similar if desired).
  - Existing JSDoc annotations on `propertyRoutes.ts`, `userRoutes.ts`,
    `visitRoutes.ts` are surfaced.
  - One happy-path + one auth-required contract test per resource.
- **Source:** `conductor/product.md` ("Property Listing API powers the
  mobile/web app"); `plan.md` Phase 6 Task 6.1; CONCERNS.md Swagger item.

---

## Category: POLISH — Observability, Operations, Docs

### REQ-POLISH-01 — Structured logging + correlation IDs

- **Description:** Replace `console.log("[Tag] ...")` with a structured
  logger (Pino or Winston), assign `requestId` at HTTP entry and `jobId`
  at worker entry, propagate through services.
- **Acceptance criteria:**
  - Logger emits JSON in production, pretty in dev.
  - HTTP middleware assigns `requestId` per request (UUID); exposed in
    response headers for debuggability.
  - Worker assigns `jobId` per BullMQ job; propagated into services via
    context (AsyncLocalStorage or explicit pass-through).
  - No raw phone numbers or PII in logs per CONCERNS.md "Phone numbers
    stored in plaintext" + PRD Open Questions "PII in logs".
  - At least one log statement in each service now includes the
    correlation ID.
- **Source:** CONCERNS.md "No structured logging / no correlation IDs",
  PRD Open Question "PII in logs".

### REQ-POLISH-02 — Deep health probe

- **Description:** `/health/ready` verifies connectivity to Postgres,
  Redis, and the Auth0 JWKS endpoint; `/health` remains a cheap 200.
- **Acceptance criteria:**
  - `/health` returns 200 unconditionally (liveness).
  - `/health/ready` returns 200 only if Prisma query, Redis ping, and
    Auth0 JWKS fetch all succeed (readiness).
  - On any dependency failure, returns 503 with which dependency failed
    in the `ErrorResponse.messages` array.
  - Contract test covers both 200 and a simulated 503.
- **Source:** CONCERNS.md "No health probe covers dependencies",
  "Auth0 env vars validated once".

### REQ-POLISH-03 — Production Docker image + compose profile

- **Description:** Produce a production-ready Docker image of the backend
  and extend `docker-compose.yml` (or add `docker-compose.prod.yml`) so
  the service can be stood up via container orchestration.
- **Acceptance criteria:**
  - `Dockerfile` builds a multi-stage image (builder runs `npm ci`
    + `npm run build`; runner copies compiled `dist/` + `node_modules`
    production only).
  - Image runs as non-root.
  - Env vars documented in the Dockerfile/README (lists the full env
    var set from STACK.md `Required env vars`).
  - `docker compose up` brings up DB + Redis + backend locally; the
    backend container passes `/health/ready` within 30s.
  - A minimal operational runbook (`docs/runbook.md`) covers: building
    the image, running migrations in-container, rotating the WhatsApp
    verify token, and handling a pgvector migration.
- **Source:** PROJECT.md Target Runtime ("containerized (Docker)
  deployment"), `plan.md` Phase 6; CONCERNS.md "Single-process worker"
  note for future split.

### REQ-POLISH-04 — Coverage gate, style compliance, ADR formalization

- **Description:** Close out the workflow-mandated quality gates and
  convert the 9 de-facto tech decisions into ADRs.
- **Acceptance criteria:**
  - `npm run test:coverage` reports >=80% across `src/` per
    `conductor/workflow.md` quality gates.
  - No lint/static-analysis errors.
  - All public functions have JSDoc.
  - `.planning/decisions/` (or equivalent) contains one ADR per
    PROJECT.md "Current stack" row, each with a `Status: Accepted` or
    `Status: Proposed` header, context, decision, consequences, and
    alternatives considered. Specifically called out in the PRD-wise
    reconciliation:
    - ADR recording **OpenAI `text-embedding-3-small` vs Gemini
      `gemini-embedding-001`** — whichever choice ships, document the
      one that won and why.
    - ADR recording **Claude Sonnet 4.6 vs Gemini 2.5 Flash** — same.
  - PRD open questions (handoff notification, chunk titling heuristic,
    similarity-threshold tuning, non-Portuguese inbound, PII redaction)
    logged as downstream tickets in a `.planning/backlog.md` file or
    equivalent (they are not blockers for this milestone).
- **Source:** `conductor/workflow.md` quality gates;
  `.planning/intel/SYNTHESIS.md` "Notes for Roadmapper" §1 + §4;
  INGEST-CONFLICTS.md INFO items on provider drift.

---

## Traceability

All 18 v1 requirements are mapped to exactly one phase. Delivered items
sit in Phase 0 (pre-existing).

| REQ | Phase | Status |
|-----|-------|--------|
| REQ-AUTH-01 | Phase 0 | Delivered |
| REQ-AUTH-02 | Phase 0 | Delivered |
| REQ-AUTH-03 | Phase 0 | Delivered |
| REQ-AUTH-04 | Phase 0 | Delivered |
| REQ-AUTH-05 | Phase 0 | Delivered |
| REQ-WHATS-01 | Phase 0 | Delivered |
| REQ-WHATS-02 | Phase 1 | Pending |
| REQ-WHATS-03 | Phase 1 | Pending |
| REQ-CONV-01 | Phase 1 | Pending (partially in code) |
| REQ-CONV-02 | Phase 1 | Pending (partially in code) |
| REQ-CONV-03 | Phase 1 | Pending (partially in code) |
| REQ-RAG-01 | Phase 2 | Pending |
| REQ-RAG-02 | Phase 2 | Pending (schema partially exists) |
| REQ-RAG-03 | Phase 2 | Pending (script exists, needs PRD alignment) |
| REQ-RAG-04 | Phase 2 | Pending (service exists, needs PRD alignment) |
| REQ-RAG-05 | Phase 3 | Pending (service exists, needs PRD alignment) |
| REQ-WORKER-01 | Phase 3 | Pending (worker exists, needs wiring) |
| REQ-LEAD-01 | Phase 4 | Pending (service stubbed, LLM is null) |
| REQ-EVAL-01 | Phase 5 | Pending |
| REQ-API-01 | Phase 6 | Pending |
| REQ-POLISH-01 | Phase 6 | Pending |
| REQ-POLISH-02 | Phase 6 | Pending |
| REQ-POLISH-03 | Phase 6 | Pending |
| REQ-POLISH-04 | Phase 6 | Pending |

Coverage: **25/25** requirements mapped (18 v1 categorized above; the 7
REQ-AUTH* + REQ-WHATS-01 + REQ-CONV*/REQ-RAG* partials represented above
sum to 25 lines in the table because each `[DELIVERED]` auth/webhook REQ
is tracked individually for audit). No orphans.
