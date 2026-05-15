# Requirements Intel

Product requirements extracted from classified PRDs.

---

## From `tasks/prd-rag-langchain.md` (PRD, high confidence)

Source PRD title: "PRD: RAG Implementation with LangChain for WhatsApp Chatbot"

### REQ-rag-config-module
- source: `tasks/prd-rag-langchain.md` (US-001, FR-1, FR-4, FR-13)
- scope: RAG pipeline configuration
- description: Provide a single typed config module that centralizes embedding model, chunking strategy, and retrieval parameters for the rest of the RAG code.
- acceptance criteria:
  - New file `src/config/rag.ts` exports typed constants: `EMBEDDING_MODEL = "text-embedding-3-small"`, `EMBEDDING_DIMS = 1536`, `CHUNK_SIZE = 800`, `CHUNK_OVERLAP = 120`, `RETRIEVER_K = 4`, `SIMILARITY_THRESHOLD = 0.72`.
  - Reads `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from `process.env`; fails fast with a clear error at boot if either is missing.
  - Typecheck (`npx tsc --noEmit`) passes.

### REQ-rag-knowledge-document-schema
- source: `tasks/prd-rag-langchain.md` (US-002, FR-5)
- scope: Prisma schema, ingestion tracking
- description: Extend `KnowledgeDocument` with fields needed to track source, chunk index, and content hash for idempotent re-ingestion.
- acceptance criteria:
  - Add fields: `sourcePath String`, `chunkIndex Int`, `contentHash String`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
  - Compound unique index on `(sourcePath, chunkIndex)`.
  - Index on `contentHash` for fast skip lookups.
  - Prisma migration generated and applied (`npx prisma migrate dev --name add_rag_ingestion_tracking`).
  - `npx prisma generate` runs cleanly.
  - Typecheck passes.

### REQ-rag-ingestion-cli
- source: `tasks/prd-rag-langchain.md` (US-003, FR-3, FR-4, FR-5)
- scope: knowledge document ingestion pipeline
- description: Provide `npm run ingest:knowledge` CLI that walks `documentation/`, chunks every `.md` file, embeds new/changed chunks, and upserts them into `KnowledgeDocument`.
- acceptance criteria:
  - New script `src/scripts/ingestKnowledge.ts` reads all `*.md` files under `documentation/` recursively.
  - Splits each file with LangChain `RecursiveCharacterTextSplitter` using `CHUNK_SIZE` / `CHUNK_OVERLAP` from `src/config/rag.ts`.
  - Computes `sha256(content)` per chunk as `contentHash`.
  - Upserts by `(sourcePath, chunkIndex)`: insert on miss, skip on matching hash, update on differing hash.
  - Deletes rows whose `(sourcePath, chunkIndex)` no longer exists in the file.
  - Writes embeddings via raw SQL (`$executeRaw`) with `::vector` cast.
  - Logs summary: N files, X inserted, Y updated, Z skipped, W deleted.
  - npm script: `"ingest:knowledge": "ts-node src/scripts/ingestKnowledge.ts"`.
  - Running twice produces `0 inserted, 0 updated, N skipped` on the second run.
  - Unit test covers hash-skip logic with mocked embeddings + mocked Prisma client.
  - Typecheck passes; tests pass.

### REQ-rag-pgvector-retriever
- source: `tasks/prd-rag-langchain.md` (US-004, FR-6)
- scope: RAG retrieval
- description: Provide a LangChain-compatible retriever that queries `KnowledgeDocument` by cosine similarity and returns top-K chunks with similarity scores.
- acceptance criteria:
  - New module `src/services/ragRetrieverService.ts` exports `retrieveRelevantChunks(query: string): Promise<RetrievedChunk[]>` where `RetrievedChunk = { id, content, title, score }`.
  - Generates query embedding with the same `EMBEDDING_MODEL` used for ingestion.
  - Runs a single raw SQL query using pgvector cosine operator, `ORDER BY embedding <=> $1 ASC LIMIT K`.
  - Rows with `embedding IS NULL` are excluded.
  - Unit test with seeded/mocked Prisma verifies ordering and K limit.
  - Typecheck passes; tests pass.

### REQ-rag-conversational-chain
- source: `tasks/prd-rag-langchain.md` (US-005, FR-2, FR-7, FR-8, FR-9, FR-14)
- scope: grounded answer generation
- description: Provide a single function that, given a user message and a `ChatSession.id`, produces a grounded Portuguese reply.
- acceptance criteria:
  - New module `src/services/ragChainService.ts` exports `generateAnswer(input: { sessionId: string; userMessage: string })`.
  - Loads last 10 `Message`s for the session (ordered by `timestamp ASC`) formatted as LangChain `HumanMessage` / `AIMessage` history.
  - Calls `retrieveRelevantChunks(userMessage)`; if no chunk exceeds `SIMILARITY_THRESHOLD` (0.72), returns `{ answer: <fallback text>, handoff: true }` without calling the LLM.
  - Builds a prompt with Portuguese system prompt (tone from `documentation/buisness_plan.md` section 6), retrieved context, chat history, and the new user message.
  - Calls Claude Sonnet 4.6 via `@langchain/anthropic` with `temperature: 0.2`.
  - Returns `{ answer: string, handoff: boolean, topScore: number, usedChunkIds: string[] }`.
  - Unit test with mocked LLM + retriever verifies low-score handoff path, high-score success path, and prompt inclusion of chat history.
  - Typecheck passes; tests pass.

### REQ-rag-whatsapp-worker-wiring
- source: `tasks/prd-rag-langchain.md` (US-006, FR-10, FR-11)
- scope: whatsapp worker integration
- description: Wire the RAG chain into `whatsappWorker.ts` so inbound WhatsApp messages produce a grounded reply and both sides of the conversation are persisted.
- acceptance criteria:
  - `whatsappWorker.ts` job handler for each inbound message:
    1. Finds-or-creates a `User` by `phoneNumber`.
    2. Finds active `ChatSession` (status `ACTIVE_BOT`) for that user or creates one.
    3. If session status is `WAITING_HUMAN` or `RESOLVED`, persists inbound `Message` and returns (no auto-reply).
    4. Persists inbound `Message` with `senderType: TENANT`.
    5. Calls `generateAnswer({ sessionId, userMessage })`.
    6. Persists outbound `Message` with `senderType: BOT`.
    7. If `handoff` is true, updates `ChatSession.status` to `WAITING_HUMAN`.
    8. Sends answer text via existing `whatsappService` outbound call.
  - Errors from the RAG chain are caught; worker sends generic Portuguese apology and flips session to `WAITING_HUMAN`.
  - Integration-style unit test covers happy path, handoff path, and already-waiting-human path.
  - Typecheck passes; tests pass.

### REQ-rag-lead-extraction
- source: `tasks/prd-rag-langchain.md` (US-007, FR-12)
- scope: lead qualification, insight capture
- description: Capture the tenant's rental preferences (budget, neighborhood, bedrooms, pets, intent) into the database after the outbound reply, so a human can follow up with real listings.
- acceptance criteria:
  - New module `src/services/leadExtractionService.ts` exports `extractInsights(input: { sessionId: string; userMessage: string }): Promise<ExtractedInsights>`.
  - Uses LangChain structured output with Zod schema: `{ budget?: number, neighborhood?: string, bedrooms?: number, pets_allowed?: boolean, intent: "search" | "schedule_visit" | "contract_question" | "human_handoff" | "other" }`.
  - Runs against Claude Sonnet 4.6 with `temperature: 0`.
  - Invoked from `whatsappWorker.ts` AFTER outbound reply (via `queueMicrotask` or separate BullMQ job).
  - Finds-or-creates a `RentalProcess` for the tenant with status `TRIAGE` (one open process per tenant at a time).
  - For each non-null extracted key, upserts an `AiExtractedInsight` row; does not duplicate existing keys.
  - If `intent === "human_handoff"`, flips `ChatSession` to `WAITING_HUMAN` regardless of retriever confidence.
  - Unit test with mocked LLM verifies insight parsing, single RentalProcess creation, and upsert behavior on repeated calls.
  - Typecheck passes; tests pass.

### REQ-rag-eval-script
- source: `tasks/prd-rag-langchain.md` (US-008)
- scope: quality evaluation
- description: Provide a seed script for smoke-testing RAG quality without touching WhatsApp.
- acceptance criteria:
  - New script `src/scripts/evalRag.ts` reads a hard-coded array of ~8 Portuguese test questions (triagem, visita, documentação, rescisão, pagamento).
  - For each question, calls `generateAnswer` with a throwaway `ChatSession`; prints question, top chunk title, similarity score, handoff flag, final answer.
  - npm script: `"eval:rag": "ts-node src/scripts/evalRag.ts"`.
  - Typecheck passes.

### Success metrics (cross-cutting, all REQs above)
- source: `tasks/prd-rag-langchain.md` section 8
- >=80% of the 8-question eval set returns answers judged "correct + on-tone" by the product owner on a manual pass.
- Handoff fires on 0 of 8 in-scope eval questions; fires on all out-of-scope probe questions.
- Second run of `npm run ingest:knowledge` reports `0 inserted, 0 updated, 0 deleted`.
- Latency: p50 <= 4s, p95 <= 8s from job pickup to outbound send, measured over first 50 real staging messages.
- >=60% of tenant conversations containing at least one preference produce at least one `AiExtractedInsight` row in the same conversation.

---

## From `conductor/product.md` (PRD, medium confidence)

Source PRD title: "Initial Concept" — product vision doc covering target audience, value proposition, and key features. No formal user stories or acceptance criteria present; content is vision-level. The following requirements are inferred from stated "Key Features" and "Essential Integrations".

### REQ-whatsapp-webhook-entrypoint
- source: `conductor/product.md`
- scope: WhatsApp inbound channel
- description: The backend provides a WhatsApp webhook that processes incoming messages and produces AI-powered responses as the primary lead generation entrypoint.
- acceptance criteria:
  - (not formally specified in product.md — vision-level)
  - Implementation detail elaborated in `plan.md` Phase 1 (webhook validation, BullMQ enqueue, 200 OK immediate response) and `tasks/prd-rag-langchain.md` US-006.

### REQ-property-listing-api
- source: `conductor/product.md`
- scope: mobile/web app backend
- description: The backend exposes a Property Listing API that powers the mobile/web app with comprehensive property queries, optimized for mobile (lightweight payloads).
- acceptance criteria:
  - (not formally specified in product.md — vision-level)
  - No per-endpoint acceptance criteria have been ingested. The roadmapper should flag this as needing formalization before any mobile-app-facing work.

### REQ-rag-system
- source: `conductor/product.md`
- scope: WhatsApp response generation
- description: The backend uses a RAG system (PostgreSQL + pgvector + LLM) to answer tenant queries on WhatsApp.
- acceptance criteria:
  - Formalized in `tasks/prd-rag-langchain.md` (see REQ-rag-* entries above). `product.md` provides the vision; `prd-rag-langchain.md` provides the acceptance criteria.
  - See "Conflict Notes" below regarding overlap with `plan.md` Phase 4.

### REQ-frictionless-mobile-transition
- source: `conductor/product.md`
- scope: cross-channel continuity
- description: Qualified leads from WhatsApp are transitioned to the mobile/web application for rich property exploration and final applications. State continuity across channels is a product guideline (see `conductor/product-guidelines.md`).
- acceptance criteria:
  - (not formally specified — vision-level; no ingested SPEC covers the transition mechanism.)

---

## Conflict Notes

- **Scope overlap — REQ-rag-system (product.md) and REQ-rag-* set (prd-rag-langchain.md):** These are complementary, not competing. product.md is vision-level without acceptance criteria; prd-rag-langchain.md is the concrete PRD. No variant conflict — requirements flow from the high-confidence PRD and inherit vision framing from product.md.
- **Scope overlap — REQ-rag-* set vs `plan.md` Phase 4:** See WARNING in `INGEST-CONFLICTS.md`. plan.md is a task checklist covering the same feature; it was classified DOC and does NOT generate requirements. The phase/task structure is preserved in `context.md` as input for downstream roadmapping.
- **No ADRs ingested:** all requirements are PRD-derived; no ADR-locked constraints override them.
