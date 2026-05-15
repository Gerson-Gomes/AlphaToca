# I-Moveis Backend

> Note: This project appears in pre-existing artifacts under the legacy name
> **AlphaToca** (e.g. `plan.md`, `conductor/product.md`, various Portuguese
> task files). New GSD artifacts use **I-Moveis**. The old documents are not
> being renamed here — they remain in place for provenance; only new artifacts
> under `.planning/` and going forward use the new name.

---

## One-Line Summary

A Node.js + TypeScript backend that runs a WhatsApp-first rental assistant,
answers tenant questions with a grounded RAG pipeline over a Portuguese
knowledge base, captures structured lead insights, and exposes a property API
for a future mobile/web app — deployed as a containerized service.

## Core Value

For tenants searching apartments, WhatsApp is the first touch. I-Moveis
replaces the cost of a human agent doing triage with a grounded AI assistant
that:

1. Answers questions about the rental process (triagem, visitas, documentação,
   rescisão, pagamento) in on-brand Portuguese — only from ingested docs.
2. Recognizes when it does not know the answer and cleanly transfers to a human.
3. Captures the tenant's preferences (budget, neighborhood, bedrooms, pets,
   intent) into the database so a human can follow up with real listings.
4. Hands qualified leads off to a mobile/web app for final discovery and
   application.

Landlords/managers and real-estate agents benefit from the same pipeline:
automated first contact and filtered leads.

## Target Users

- **Tenants** — search for rentals, interact via WhatsApp first.
- **Landlords / Property Managers** — manage listings, receive filtered
  WhatsApp-sourced leads.
- **Real Estate Agents** — use the system to automate first contact and lead
  qualification.

## Milestone Success Metric

**All 8 user stories (US-001 through US-008) in `tasks/prd-rag-langchain.md`
meet their acceptance criteria, including lead extraction (US-007) and the
eval script (US-008).**

Specifically:

- `npm run ingest:knowledge` is idempotent (second run reports
  `0 inserted, 0 updated, 0 deleted`).
- `npm run eval:rag` runs green and manual grading gives >=80%
  "correct + on-tone" on the 8-question eval set.
- Handoff fires on 0/8 in-scope eval questions and 100% of out-of-scope
  probe questions.
- End-to-end p50 <= 4s, p95 <= 8s from job pickup to outbound WhatsApp send
  over 50 real staging messages.
- >=60% of tenant conversations with at least one preference produce at least
  one `AiExtractedInsight` row.
- `leadExtractionService.ts` no longer crashes (the current `llm = null as any`
  stub is replaced with a real provider).

## Target Runtime

- **Language/runtime:** TypeScript on Node.js 18+ (targeting ES2022).
- **Framework:** Express.
- **Deployment:** Containerized (Docker). A `docker-compose.yml` already exists
  for local Postgres + Redis; the application image itself must be
  production-ready before the milestone closes (Phase 6).

## Current Stack (Informational — Not ADR-Locked)

These nine de-facto choices are asserted consistently across
`conductor/tech-stack.md`, `conductor/product.md`, the RAG PRD, and the auth
SPEC, but **no formal ADRs have been written**. They are the current state of
the system, not locked decisions. Any of them can be revisited and should be
formalized as ADRs before large architectural shifts land.

| Area | Current choice | Status |
|------|----------------|--------|
| Language & runtime | TypeScript + Node.js + Express | In use |
| Primary DB | PostgreSQL with `pgvector` extension | In use |
| ORM | Prisma (6.4.x) | In use |
| Queue | Redis + BullMQ | In use |
| Identity | Auth0 + JWT (`express-oauth2-jwt-bearer`) | In use (auth track complete) |
| RAG orchestration | LangChain Node.js (v1.3.x, LCEL APIs) | Planned (partial) |
| Embedding model | OpenAI `text-embedding-3-small` (1536 dims) per PRD | Planned per PRD; current code uses Gemini `gemini-embedding-001` @ 1536 — this mismatch must be reconciled during Phase 2 |
| Answer model | Anthropic Claude Sonnet 4.6 per PRD | Planned per PRD; current code uses Gemini 2.5 Flash — must be reconciled during Phase 3 |
| WhatsApp | Meta WhatsApp Cloud API (direct, no intermediary) | In use (inbound); outbound pending wiring |

> **Follow-up (cross-cutting):** Formalize these as status-bearing ADR files
> under `.planning/decisions/` or `conductor/decisions/` before the milestone
> closes. See Phase 6.

## Scope Boundaries

**In scope (v1, this milestone):**

- WhatsApp inbound webhook with signature + rate limiting hardening.
- WhatsApp outbound messaging via Meta Cloud API.
- Conversation state management in Postgres (`User`, `ChatSession`,
  `Message`).
- RAG pipeline per PRD US-001 through US-006: config, schema, ingest CLI,
  pgvector retriever, conversational chain, worker wiring.
- Lead extraction per US-007: structured insights, `RentalProcess` /
  `AiExtractedInsight`.
- Eval script per US-008.
- Property Listing REST API (CRUD) — already in place, to be documented +
  hardened.
- Visit/booking REST API — already in place.
- Auth0/JWT on all sensitive routes — already complete.
- Dockerized production image + basic operational runbook.
- Swagger/OpenAPI served at `/api-docs` (already JSDoc-annotated; wiring
  pending per CONCERNS.md).
- Structured logging + correlation IDs (currently `console.log` only).
- Test coverage >=80% per `conductor/workflow.md` quality gates.

**Out of scope (defer to v2):**

- PDF/DOCX/spreadsheet ingestion — Markdown under `documentation/` only.
- Re-ranking layer (Cohere, bge-reranker, etc.).
- Hybrid lexical + vector search (BM25 + vector).
- Multi-tenant isolation of knowledge docs.
- Streaming replies to WhatsApp.
- Admin UI for `KnowledgeDocument` management — CLI only.
- Visit scheduling UI, recommendation engine, contract generation.
- Cost/token usage dashboards (logging only).
- Per-user rate limiting on inbound messages (flagged in CONCERNS.md).
- Sentry/Rollbar error tracking.
- Auto-ingestion on file change.
- Hybrid search fallback for knowledge base.
- Handoff notification channel (Slack/email to human agents).

## Constraints (Carried Over from Auth SPEC)

The completed auth track establishes the following contracts that any future
work must respect:

- **Auth0 is the identity provider.** All sensitive Express routes go through
  `express-oauth2-jwt-bearer`; unauthorized requests return HTTP 401.
- **User sync on login.** First successful Auth0 login auto-creates a `users`
  row; every subsequent login re-syncs profile (name, phone). Failures must
  not block authentication.
- **Role mapping from JWT custom claims.** Auth0 roles map to the Prisma
  `Role` enum via custom claims; never hand-roll JWT parsing.
- **Webhook routes are intentionally unauthenticated** (Meta cannot present
  Auth0 tokens) but must be protected by signature verification and rate
  limiting (see Phase 1 and CONCERNS.md).

## Key Risks

- **LLM provider drift:** Codebase currently points at Gemini; PRD mandates
  OpenAI embeddings + Anthropic Claude. Reconciliation is mandatory during
  Phases 2–3 or milestone fails.
- **Lead extraction stub:** `leadExtractionService.ts:117` has
  `const llm = null as any` — every message past the first logs a stack
  trace. Phase 4 blocks until fixed.
- **No webhook HMAC verification:** `X-Hub-Signature-256` is not checked
  today. Any attacker who finds the URL can inject into the RAG pipeline.
  Phase 1 hardening.
- **In-process worker coupling:** `src/server.ts` imports the worker as a
  side effect — horizontally scaling the API also multiplies workers. Call
  out in Phase 6 as a deploy-time concern.

## References

- Product vision: `conductor/product.md`
- Product guidelines (tone, errors, Zod, `ErrorResponse` shape):
  `conductor/product-guidelines.md`
- Tech stack: `conductor/tech-stack.md`
- Workflow (TDD, quality gates, commit format, phase checkpoint protocol):
  `conductor/workflow.md`
- Plan (Portuguese, legacy task checklist): `plan.md`
- RAG PRD (authoritative for RAG + lead + eval): `tasks/prd-rag-langchain.md`
- Auth track (complete): `conductor/tracks/auth_jwt_auth0_20260416/`
- Ingest artifacts: `.planning/intel/` and `.planning/INGEST-CONFLICTS.md`
- Codebase intel (2026-04-25 snapshot): `.planning/codebase/`
