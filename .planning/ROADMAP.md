# I-Moveis Roadmap

Seven phases total (Phase 0 is completed work carried forward as pre-existing
constraint; Phases 1–6 are the active milestone). Phase ordering follows the
legacy `plan.md` sequence (webhook → outbound → conversation state → RAG →
lead extraction → docs) but acceptance criteria come from the authoritative
PRD (`tasks/prd-rag-langchain.md`) and the auth SPEC.

Milestone success metric (from PROJECT.md): **All 8 user stories US-001
through US-008 meet acceptance criteria, including lead extraction and the
eval script.**

---

## Phases

- [x] **Phase 0: Delivered Foundations** — Auth0/JWT, inbound webhook, BullMQ queue, seed data (reference only)
- [ ] **Phase 1: Outbound Messaging & Conversation Persistence** — Harden inbound webhook; wire outbound WhatsApp; persist users, sessions, and both-side messages
- [ ] **Phase 2: RAG Foundations** — Config module, schema migration, ingest CLI, pgvector retriever (PRD US-001 through US-004)
- [ ] **Phase 3: Conversational Chain & Worker Wiring** — LCEL RAG chain + integrate into `whatsappWorker.ts` end-to-end (PRD US-005, US-006)
- [ ] **Phase 4: Lead Extraction** — Replace LLM stub, structured output, `RentalProcess` + `AiExtractedInsight` (PRD US-007)
- [ ] **Phase 5: Eval & Quality Gates** — `eval:rag` script, manual grading against success metrics (PRD US-008 + Section 8)
- [ ] **Phase 6: Docs, Deployment & Polish** — Swagger wiring, structured logging, deep health probe, production Docker image, ADR formalization, coverage gate

---

## Phase Details

### Phase 0: Delivered Foundations

**Goal**: Capture already-shipped capabilities as a baseline so downstream
phases can depend on them without re-planning.
**Depends on**: Nothing (historical).
**Requirements**: REQ-AUTH-01, REQ-AUTH-02, REQ-AUTH-03, REQ-AUTH-04,
REQ-AUTH-05, REQ-WHATS-01
**Success Criteria** (already true today):
  1. A request with a valid Auth0-issued JWT reaches `/api/properties`,
     `/api/users`, `/api/visits`; a request without one is rejected with
     HTTP 401 in the standard `ErrorResponse` shape.
  2. A first-time Auth0 login auto-creates a `users` row and subsequent
     logins re-sync name + phone without blocking authentication on sync
     failure.
  3. Meta posts a valid WhatsApp payload to `/api/webhooks/whatsapp` and
     the request returns HTTP 200 within the Meta-required window while a
     BullMQ job appears on the `messageQueue`.
  4. The GET webhook handshake succeeds when `hub.mode=subscribe` and the
     verify token matches.
**Plans**: Complete (auth track checkpoints `71df7f3`, `a22b10b`, `37fa387`,
`519f4de`; commits `62f6fd5`, `80694ce`, `b8f11fc`, `2893e9d`, `f429f34`).
**Note**: This phase is a reference anchor for traceability; downstream
`/gsd-plan-phase` runs should start at Phase 1.

---

### Phase 1: Outbound Messaging & Conversation Persistence

**Goal**: A tenant who sends a WhatsApp message reliably ends up as a `User`
with a live `ChatSession` and a persisted inbound `Message`; the backend
can send an outbound text back and persist it — even before the RAG brain
is connected. Inbound is hardened against forged/unsigned requests and
basic flooding.
**Depends on**: Phase 0.
**Requirements**: REQ-WHATS-02, REQ-WHATS-03, REQ-CONV-01, REQ-CONV-02,
REQ-CONV-03
**Success Criteria** (what must be TRUE):
  1. A POST to `/api/webhooks/whatsapp` without a valid
     `X-Hub-Signature-256` HMAC is rejected, and per-IP rate limits prevent
     unbounded BullMQ enqueue from a single source.
  2. A tenant's first WhatsApp message in creates exactly one `User` row
     (by `phoneNumber`), one active `ChatSession` (status `ACTIVE_BOT`),
     and one `Message` row (`senderType: TENANT`), with any BullMQ retry
     being idempotent (no duplicate rows).
  3. The worker can send a hard-coded stub reply via
     `whatsappService.sendMessage` and persist it as a `Message` with
     `senderType: BOT`; rate-limit (429) and invalid-number responses are
     surfaced as typed errors rather than unhandled axios rejections.
  4. A tenant whose session is `WAITING_HUMAN` or `RESOLVED` has their
     inbound message persisted but receives no auto-reply; session TTL is
     activity-based (bumped on each message), not creation-time only.
  5. `/health` and a newly failing-for-now `/health/ready` both exist so
     Phase 6 has a place to hang deep checks.
**Plans**: TBD
**UI hint**: no

---

### Phase 2: RAG Foundations

**Goal**: A developer can run `npm run ingest:knowledge` and have every
Markdown file under `documentation/` chunked, embedded, and stored in
`KnowledgeDocument` idempotently; a retriever function returns the top-K
chunks for any query with similarity scores — all using the PRD-pinned
stack (OpenAI `text-embedding-3-small`).
**Depends on**: Phase 1 (for Prisma access patterns) and Phase 0.
**Requirements**: REQ-RAG-01, REQ-RAG-02, REQ-RAG-03, REQ-RAG-04
**Success Criteria** (what must be TRUE):
  1. `src/config/rag.ts` exports the PRD's typed constants and the process
     fails fast at boot if `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is
     missing; `npx tsc --noEmit` passes.
  2. `KnowledgeDocument` has `sourcePath`, `chunkIndex`, `contentHash`,
     `createdAt`, `updatedAt`, a compound unique index on
     `(sourcePath, chunkIndex)`, and an index on `contentHash`; migration
     was generated and applied via `prisma migrate dev`.
  3. A fresh `npm run ingest:knowledge` chunks + embeds + inserts every
     `.md` file under `documentation/`; a second run reports
     `0 inserted, 0 updated, 0 deleted` and skips by hash — unit tests
     prove the hash-skip path with mocked embeddings + Prisma.
  4. `retrieveRelevantChunks("...")` returns the top-4 chunks by cosine
     similarity with `{ id, content, title, score }` shape, excludes
     `NULL` embeddings, and uses parameterized SQL (no unsafe
     interpolation).
  5. Any provider drift between the PRD (OpenAI embeddings) and the
     existing Gemini plumbing is resolved in this phase — either the
     PRD-pinned provider is implemented and Gemini is removed, or an ADR
     is written in advance of the divergence (tracked as a blocker in
     Phase 6 if deferred).
**Plans**: TBD
**UI hint**: no

---

### Phase 3: Conversational Chain & Worker Wiring

**Goal**: An inbound WhatsApp message turns into a grounded Portuguese
reply sent back to the tenant, with both sides persisted. Low-confidence
retrievals and RAG errors both surface as a clean handoff instead of
noise.
**Depends on**: Phase 2 (retriever + config) and Phase 1 (conversation
state plumbing).
**Requirements**: REQ-RAG-05, REQ-WORKER-01
**Success Criteria** (what must be TRUE):
  1. `generateAnswer({ sessionId, userMessage })` in
     `src/services/ragChainService.ts` produces
     `{ answer, handoff, topScore, usedChunkIds }`, loads the last 10
     `Message`s as `HumanMessage`/`AIMessage`, and uses the PRD-mandated
     LCEL `RunnableSequence` + `ChatPromptTemplate` (NOT the deprecated
     `ConversationalRetrievalChain`).
  2. When `retrieveRelevantChunks` returns no chunk above
     `SIMILARITY_THRESHOLD = 0.72`, the function returns the Portuguese
     handoff fallback without calling the LLM — verified by a unit test
     that asserts the LLM mock is not invoked.
  3. When the RAG chain succeeds, the whatsappWorker persists the
     outbound `Message` with `senderType: BOT`, sends via
     `whatsappService.sendMessage`, and — if `handoff` was true — flips
     the session to `WAITING_HUMAN`.
  4. When the RAG chain throws, the worker catches the error, sends a
     generic Portuguese apology, flips the session to `WAITING_HUMAN`,
     and the failure is logged with a correlation ID instead of a bare
     stack trace.
  5. End-to-end integration test (mocked Prisma + mocked
     `whatsappService` + mocked `generateAnswer`) covers happy path,
     handoff path, and already-`WAITING_HUMAN` path exactly as described
     in PRD US-006.
**Plans**: TBD
**UI hint**: no

---

### Phase 4: Lead Extraction

**Goal**: Every tenant turn leaves a structured footprint in
`AiExtractedInsight` so a human can follow up with real listings —
without adding latency to the user-facing reply. The current stub
(`llm = null as any`) is replaced with a real provider.
**Depends on**: Phase 3 (worker + RAG chain in place).
**Requirements**: REQ-LEAD-01
**Success Criteria** (what must be TRUE):
  1. `leadExtractionService.extractInsights({ sessionId, userMessage })`
     no longer crashes; it calls Claude Sonnet 4.6 (or the ADR-recorded
     equivalent) via `llm.withStructuredOutput(zodSchema)` at
     `temperature: 0` and returns the PRD-defined
     `{ budget?, neighborhood?, bedrooms?, pets_allowed?, intent }`
     shape.
  2. A tenant ends the conversation with exactly one open
     `RentalProcess` in status `TRIAGE`, regardless of how many turns
     they took; `AiExtractedInsight` rows are upserted by `insightKey`
     rather than duplicated on each turn.
  3. Extraction runs AFTER the outbound WhatsApp reply is sent (either
     via a second BullMQ job or `queueMicrotask`) — verified by an
     integration test that asserts the extraction call happens after
     `whatsappService.sendMessage` resolves.
  4. A turn whose extracted `intent === "human_handoff"` flips the
     session to `WAITING_HUMAN` even if retrieval confidence was high —
     covered by a dedicated unit test.
  5. Unit tests cover insight parsing, the single-`RentalProcess`
     invariant, and repeat-call upsert behavior with mocked LLM output.
**Plans**: TBD
**UI hint**: no

---

### Phase 5: Eval & Quality Gates

**Goal**: A developer can run a single command and get a readable,
reproducible read on RAG quality against the PRD success metrics, without
touching WhatsApp. The product owner signs off on >=80% accuracy and the
required handoff behavior.
**Depends on**: Phase 3 (chain) and Phase 4 (full pipeline for realistic
eval).
**Requirements**: REQ-EVAL-01
**Success Criteria** (what must be TRUE):
  1. `npm run eval:rag` runs to completion and prints, per question,
     the question, top chunk title, similarity score, handoff flag, and
     final answer for ~8 Portuguese questions covering triagem, visita,
     documentação, rescisão, pagamento.
  2. Product-owner manual grading on the eval set reports >=80%
     "correct + on-tone" answers — recorded in a one-page eval log under
     `.planning/eval/` (date, grader, pass/fail per question, overall %).
  3. Handoff fires on 0/8 in-scope questions (`buisness_plan.md`
     section 5 coverage) and on 100% of out-of-scope probe questions
     (e.g., "qual a cor do céu?") — captured in the same eval log.
  4. Latency instrumentation is in place (job-pickup-to-outbound-send
     timestamp pair); a staging capture of 50 real messages shows p50
     <= 4s and p95 <= 8s excluding WhatsApp API time, OR a recorded
     deviation with an action plan is filed against Phase 6
     REQ-POLISH-01.
  5. `npx tsc --noEmit` + `npm test` + `npm run test:coverage` all
     pass on the tip of Phase 5.
**Plans**: TBD
**UI hint**: no

---

### Phase 6: Documentation, Deployment & Polish

**Goal**: The system is operationally ready to deploy: production Docker
image, Swagger docs live, structured logs with correlation IDs, deep
health probe, ADRs for the nine de-facto tech choices, and the workflow
quality gates (coverage, lint, JSDoc) all green. PRD open questions are
logged for a v2 backlog rather than abandoned.
**Depends on**: All prior phases.
**Requirements**: REQ-API-01, REQ-POLISH-01, REQ-POLISH-02,
REQ-POLISH-03, REQ-POLISH-04
**Success Criteria** (what must be TRUE):
  1. `setupSwagger(app)` is wired into `src/app.ts`; visiting `/api-docs`
     in a dev environment returns a working Swagger UI covering every
     existing route under `/api/properties`, `/api/users`, `/api/visits`
     using the already-present JSDoc annotations.
  2. All application logs in staging are JSON-structured and carry a
     correlation ID (`requestId` for HTTP entries, `jobId` for worker
     entries) propagated through every service call in the message
     lifecycle; no phone number appears raw in any production log line.
  3. `/health/ready` returns 200 only when Prisma, Redis, and the Auth0
     JWKS endpoint are all reachable, and returns 503 with a
     `messages[]` array naming the failing dependency when any are
     down — contract tests prove both paths.
  4. `docker build` produces a multi-stage, non-root image that runs
     against a real Postgres + Redis via
     `docker compose -f docker-compose.prod.yml up` (or equivalent);
     the container passes `/health/ready` within 30 seconds of start,
     and a `docs/runbook.md` covers building the image, running
     migrations in-container, rotating secrets, and handling a pgvector
     migration.
  5. `.planning/decisions/` (or `conductor/decisions/`) contains one
     ADR per PROJECT.md "Current stack" row with status, context,
     decision, consequences, and alternatives — in particular ADRs
     that record the final outcomes of the OpenAI-vs-Gemini and
     Claude-vs-Gemini reconciliations done in Phases 2–3. PRD Open
     Questions (handoff notification, chunk titling, similarity tuning,
     non-Portuguese inbound, PII redaction) are logged to
     `.planning/backlog.md`.
  6. Workflow quality gates pass: `npm run test:coverage` reports
     >=80%, lint/static analysis is clean, all public functions have
     JSDoc, and the `leadExtractionService` `llm = null as any` tech
     debt item from `.planning/codebase/CONCERNS.md` is resolved (as a
     side effect of Phase 4).
**Plans**: TBD
**UI hint**: no

---

## Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Delivered Foundations | n/a | Delivered | 2026-04-25 (baseline snapshot) |
| 1. Outbound Messaging & Conversation Persistence | 0/0 | Not started | - |
| 2. RAG Foundations | 0/0 | Not started | - |
| 3. Conversational Chain & Worker Wiring | 0/0 | Not started | - |
| 4. Lead Extraction | 0/0 | Not started | - |
| 5. Eval & Quality Gates | 0/0 | Not started | - |
| 6. Documentation, Deployment & Polish | 0/0 | Not started | - |

---

## Coverage Summary

- v1 requirements: **18** (distinct REQ IDs in REQUIREMENTS.md)
- Coverage: **18 / 18** mapped to exactly one phase — no orphans.
- Phase 0 carries 6 already-delivered requirements (5 auth + 1 webhook).
- Phases 1–6 carry 12 pending requirements plus cross-cutting polish items.

## Conflicts Resolved Inline

- **RAG PRD vs `plan.md` Phase 4 (WARNING from ingest):** phases derive
  success criteria from the PRD user stories; `plan.md` only informs
  ordering. `ConversationalRetrievalChain` (deprecated, mentioned in
  `plan.md` Task 4.3) is explicitly excluded in Phase 3 Success Criterion
  #1.
- **product-guidelines.md "sub-second responses" vs PRD p50 <= 4s / p95
  <= 8s (INFO):** roadmap success criteria use the PRD latency budget
  (Phase 5 Success Criterion #4). `product-guidelines.md` alignment is
  logged as a downstream doc update in Phase 6 under REQ-POLISH-04.
- **Embedding/LLM provider drift (OpenAI+Anthropic per PRD vs Gemini
  currently in code):** reconciliation is explicit in Phase 2 and
  Phase 3 success criteria, and the final choice is recorded as an ADR
  in Phase 6.

## Downstream Tickets (PRD Open Questions)

Logged here for provenance; to be moved to `.planning/backlog.md` in
Phase 6 (REQ-POLISH-04):

- Handoff notification channel (Slack? Email? admin UI?) — out of scope.
- Chunk titling from Markdown headings vs filename — defer unless eval
  accuracy drops below 80%.
- `SIMILARITY_THRESHOLD = 0.72` tuning post-first-eval-run.
- English fallback for non-Portuguese inbound messages.
- PII redaction policy for `insightValue` in production logs.
- `workflow.md` trailing duplicated fragment — minor docs hygiene.
