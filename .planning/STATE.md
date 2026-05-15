# I-Moveis State

> Project memory. Updated incrementally as phases, plans, and sessions
> progress. This file is the single source of "where are we right now".

---

## Project Reference

- **Name:** I-Moveis (legacy name in pre-existing artifacts: AlphaToca)
- **Core value:** WhatsApp-first rental assistant — grounded RAG answers
  in Portuguese, structured lead capture, handoff to humans when
  uncertain, and a property API for a future mobile/web app.
- **Target runtime:** Node.js + Express on TypeScript, containerized
  (Docker).
- **Milestone success metric:** All 8 user stories (US-001–US-008) in
  `tasks/prd-rag-langchain.md` meet their acceptance criteria — including
  lead extraction and the eval script.

## Current Focus

- **Phase:** Phase 1 — Outbound Messaging & Conversation Persistence
  (Phase 0 is delivered baseline; Phase 1 is the active starting point
  for new work).
- **Plan:** None yet. Next step: run `/gsd-plan-phase 1` to decompose
  Phase 1 into executable plans.
- **Blocking prerequisites:** None — Phase 0 foundations are in place.

## Current Position

```
[====·······················································] 14%
 Phase 0/6 complete, starting Phase 1 of 6 active milestone phases
```

| Field | Value |
|-------|-------|
| Active phase | Phase 1: Outbound Messaging & Conversation Persistence |
| Active plan | TBD |
| Plans complete in active phase | 0 / 0 (not yet planned) |
| Phases complete in milestone | 0 of 6 (Phase 0 delivered as baseline) |
| Next recommended command | `/gsd-plan-phase 1` |

## Phase Status Snapshot

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Delivered Foundations | Delivered | Auth0 JWT + sync, inbound webhook, BullMQ queue, seed data (commits up to `b8f11fc`). |
| 1. Outbound Messaging & Conversation Persistence | Not started | Hardening + outbound + session/user/message persistence. |
| 2. RAG Foundations | Not started | Config, schema migration, ingest CLI, retriever — PRD US-001 through US-004. |
| 3. Conversational Chain & Worker Wiring | Not started | LCEL chain + worker integration — PRD US-005, US-006. |
| 4. Lead Extraction | Not started | Replace `llm = null` stub; structured output; `RentalProcess` + `AiExtractedInsight` — PRD US-007. |
| 5. Eval & Quality Gates | Not started | `eval:rag` + manual grading against PRD Section 8 metrics — PRD US-008. |
| 6. Documentation, Deployment & Polish | Not started | Swagger, logging, health probe, Docker image, ADRs, coverage. |

## Performance Metrics

(To be populated once Phase 5 instrumentation lands.)

| Metric | Target | Current | Source |
|--------|--------|---------|--------|
| Eval accuracy (manual grading) | >=80% | — | PRD US-008 + Section 8 |
| In-scope handoff rate | 0 / 8 | — | PRD Section 8 |
| Out-of-scope handoff rate | 100% | — | PRD Section 8 |
| p50 latency (job → outbound send) | <= 4s | — | PRD Section 8 |
| p95 latency (job → outbound send) | <= 8s | — | PRD Section 8 |
| Insight capture rate | >=60% | — | PRD Section 8 |
| Ingest idempotency (2nd run diff) | 0/0/0 | — | PRD Section 8 |
| Coverage | >=80% | — | `conductor/workflow.md` quality gates |

## Accumulated Context

### Decisions (Current — not yet formalized as ADRs)

- Auth0 + JWT for identity (delivered).
- PostgreSQL + pgvector as primary DB + vector store.
- Prisma as ORM.
- Redis + BullMQ as queue.
- LangChain Node.js (v1 LCEL APIs) for RAG orchestration.
- Per PRD: OpenAI `text-embedding-3-small` (1536 dims) for embeddings —
  **current code uses Gemini `gemini-embedding-001`; reconciliation owed in
  Phase 2**.
- Per PRD: Anthropic Claude Sonnet 4.6 for answers + extraction —
  **current code uses Gemini 2.5 Flash; reconciliation owed in Phase 3**.
- TypeScript + Node.js + Express for the runtime.
- WhatsApp Cloud API (direct).

Formalization: see REQ-POLISH-04 (Phase 6).

### Open Todos

- Resolve OpenAI/Gemini provider drift (Phase 2).
- Resolve Claude/Gemini answer-model drift (Phase 3).
- Replace `leadExtractionService.ts:117` stub `const llm = null as any`
  before lead extraction is exercised (Phase 4).
- Wire `setupSwagger(app)` into `src/app.ts` (Phase 6 / REQ-API-01).
- Add webhook HMAC verification + rate limiting (Phase 1 / REQ-WHATS-02).
- Convert `console.log` to structured logger with correlation IDs
  (Phase 6 / REQ-POLISH-01).
- Add `/health/ready` deep probe (Phase 6 / REQ-POLISH-02).
- Write Dockerfile + runbook (Phase 6 / REQ-POLISH-03).
- Formalize the 9 de-facto decisions as ADRs (Phase 6 / REQ-POLISH-04).

### Blockers

- None as of 2026-04-29.

### Downstream backlog (PRD open questions, not this milestone)

- Handoff notification mechanism (Slack / email / admin UI).
- Chunk titling from Markdown headings vs filename.
- `SIMILARITY_THRESHOLD` post-eval tuning.
- English fallback for non-Portuguese inbound.
- PII redaction policy for insight values in logs.

### Known Concerns (carried from `.planning/codebase/CONCERNS.md`)

High-priority for this milestone:

- Lead extraction LLM is `null` (will crash) — Phase 4.
- Webhook `X-Hub-Signature-256` not verified — Phase 1.
- Webhook returns 200 on validation failure without dead-letter — Phase 1.
- Session TTL is wall-time, not activity-based — Phase 1.
- Swagger JSDoc written but never served — Phase 6.
- No structured logging / correlation IDs — Phase 6.
- `/health` is unconditional 200 — Phase 6.
- Single-process worker (API + worker coupled via
  `src/server.ts:2` side-effect import) — flagged for Phase 6; split is
  out of scope for this milestone but documented in the runbook.

Lower-priority (defer):

- `as any` in Prisma `where` clauses in `visitService.ts`.
- Phone numbers stored plaintext in `users.phoneNumber`.
- `uuid ^13.0.0` major-version jump — consider `crypto.randomUUID()`.

## Session Continuity

- **Last session:** 2026-04-29 — `/gsd-new-project` ingest + roadmap.
- **What changed:** Created `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`,
  `.planning/ROADMAP.md`, `.planning/STATE.md` from ingested intel
  (`.planning/intel/`, `.planning/INGEST-CONFLICTS.md`) and prior codebase
  map (`.planning/codebase/`, snapshot 2026-04-25).
- **What was not changed:** Existing `plan.md`, `conductor/product.md`,
  `tasks/prd-rag-langchain.md`, and the auth track were all preserved
  verbatim. The new artifacts use the project name "I-Moveis" while the
  legacy docs retain "AlphaToca" for provenance.
- **Next session should:** Run `/gsd-plan-phase 1` to decompose Phase 1
  (Outbound Messaging & Conversation Persistence) into executable plans.

## File Locations

- Project intel entry point: `.planning/intel/SYNTHESIS.md`
- Per-type intel files: `.planning/intel/{decisions,requirements,constraints,context}.md`
- Conflict report: `.planning/INGEST-CONFLICTS.md`
- Codebase intel: `.planning/codebase/{ARCHITECTURE,CONCERNS,CONVENTIONS,INTEGRATIONS,STACK,STRUCTURE,TESTING}.md`
- Authoritative RAG PRD: `tasks/prd-rag-langchain.md`
- Legacy task checklist (Portuguese): `plan.md`
- Completed auth track: `conductor/tracks/auth_jwt_auth0_20260416/`
- Product guidelines (tone, error shape, Zod): `conductor/product-guidelines.md`
- Workflow (TDD, phase checkpointing, quality gates): `conductor/workflow.md`
