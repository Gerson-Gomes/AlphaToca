# Decisions Intel

Architectural and technical decisions extracted from classified ADRs.

---

## Summary

No formal ADRs (Architecture Decision Records) were ingested in this run. The project currently uses prose-based context documents (conductor/tech-stack.md, conductor/product-guidelines.md) for de-facto tech choices rather than dated, status-bearing ADR files.

The downstream roadmapper should treat entries in `constraints.md` and `context.md` as the current source of truth for technical direction and should consider prompting the user to formalize any durable decisions as ADRs.

## De-facto Decisions (Not ADRs — Informational Only)

These are technical choices asserted across DOC/PRD/SPEC sources but never captured in a status-bearing ADR file. They are surfaced here so the roadmapper can decide whether to prompt for ADR formalization.

### Identity Provider: Auth0 + JWT
- source: `conductor/tech-stack.md`
- corroborated by: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- scope: authentication, identity, route security
- status: in-progress (SPEC track exists, plan.md phases marked complete through Phase 4)
- locked: false

### Primary Database: PostgreSQL with pgvector
- source: `conductor/tech-stack.md`
- corroborated by: `tasks/prd-rag-langchain.md` (FR-1, FR-6 — depends on pgvector)
- corroborated by: `conductor/product.md` ("Essential Integrations: PostgreSQL with pgvector")
- scope: primary datastore, vector store for RAG
- status: in use
- locked: false

### ORM: Prisma
- source: `conductor/tech-stack.md`
- corroborated by: `tasks/prd-rag-langchain.md` (FR-5, technical considerations on pgvector Unsupported type)
- scope: database access layer
- status: in use
- locked: false

### Queue: Redis + BullMQ
- source: `conductor/tech-stack.md`
- corroborated by: `plan.md` Phase 1
- scope: background job processing, WhatsApp webhook ingestion
- rationale (from tech-stack.md): "mandatory to handle WhatsApp Cloud API webhooks — guarantees an immediate HTTP 200 OK response while offloading heavy LLM/RAG processing"
- status: in use
- locked: false

### RAG Orchestration: LangChain (Node.js)
- source: `conductor/tech-stack.md`
- corroborated by: `tasks/prd-rag-langchain.md`
- scope: retrieval-augmented generation pipeline
- status: planned (RAG not yet implemented per plan.md Phase 4)
- locked: false

### Embedding Model: OpenAI `text-embedding-3-small` (1536 dims)
- source: `tasks/prd-rag-langchain.md` (FR-1, US-001)
- scope: embedding generation for ingestion and query
- status: planned
- locked: false

### Answer Model: Anthropic Claude Sonnet 4.6 via `@langchain/anthropic`
- source: `tasks/prd-rag-langchain.md` (FR-2, US-005)
- scope: grounded answer generation, structured lead extraction
- config: `temperature: 0.2` for answers, `0` for extraction
- status: planned
- locked: false

### Language & Runtime: TypeScript on Node.js, Express framework
- source: `conductor/tech-stack.md`
- corroborated by: `conductor/product.md`
- scope: backend application runtime
- status: in use
- locked: false

### Integration: WhatsApp Cloud API (direct, no intermediary)
- source: `conductor/tech-stack.md`
- corroborated by: `conductor/product.md`, `plan.md` Phase 2
- scope: tenant-facing messaging channel
- status: in use (inbound), planned (outbound — plan.md Phase 2)
- locked: false
