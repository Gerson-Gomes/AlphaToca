# Codebase Concerns

**Analysis Date:** 2026-04-25

## Tech Debt

**LLM provider not implemented in lead extraction service:**
- Issue: `src/services/leadExtractionService.ts:117` has a stub (`const llm = null as any`) — any call to `extractInsights()` will crash with `Cannot read property 'withStructuredOutput' of null`.
- Files: `src/services/leadExtractionService.ts`
- Impact: Lead extraction pipeline is non-functional; the worker schedules it asynchronously, so failures surface in logs rather than breaking the user flow — easy to miss.
- Fix approach: Instantiate an LLM (Gemini is already wired for RAG — reuse `@langchain/google-genai`) and call `llm.withStructuredOutput(schema)`. A commented-out Anthropic snippet shows the original intent.

**`as any` in Prisma query builders:**
- Issue: `src/services/visitService.ts` uses `where: where as any` in multiple spots (lines 77, 80, 98, 154, 227, 243) to bypass Prisma type friction when building dynamic `OR` clauses.
- Impact: Loss of compile-time safety; refactors to the Prisma schema won't error at these sites.
- Fix approach: Define a narrower `VisitWhereInput` type or split the query builder into typed helpers (`byPropertyAndWindow`, `byLandlordAndWindow`).

**Raw SQL in knowledge ingest:**
- Issue: `src/scripts/ingestKnowledge.ts` uses `$queryRawUnsafe` / `$executeRawUnsafe` with a hand-built pgvector literal (`toVectorLiteral()`).
- Impact: SQL injection risk if any input flows in; brittle against pgvector literal parsing changes.
- Fix approach: Prefer `$queryRaw` (tagged template) where possible; validate the vector literal format strictly.

**Swagger wiring dead-ends:**
- Issue: `src/config/swagger.ts` exports `setupSwagger` but `src/app.ts` never calls it — routes have JSDoc annotations that aren't served anywhere.
- Impact: Developers write Swagger JSDoc believing it'll show up at `/api-docs`, but the API has no live docs.
- Fix approach: Wire `setupSwagger(app)` into `src/app.ts` after route mounts.

## Security Considerations

**Webhook verify token not validated at startup:**
- Issue: `src/controllers/webhookController.ts:8` reads `WHATSAPP_VERIFY_TOKEN` lazily. If the env var is empty, verification silently 403s for every Meta challenge.
- Fix approach: Validate `WHATSAPP_VERIFY_TOKEN` is set in `src/app.ts` startup (mirror the `validateAuthConfig()` pattern).

**Webhook endpoint is unauthenticated and has no rate limit:**
- Issue: `/api/webhooks/whatsapp` is outside the `authStack` (necessarily — Meta can't auth with Auth0) and `express-rate-limit` is installed but not applied.
- Impact: Any unauthenticated caller can enqueue BullMQ jobs; Redis memory could be exhausted by a trivial flood.
- Fix approach: Apply per-IP rate limiting + signature verification (Meta signs webhook payloads — not currently verified).

**Webhook does not verify Meta's `X-Hub-Signature-256` header:**
- Issue: `webhookController.receiveMessage` only parses the body with Zod; nothing verifies the HMAC signature Meta includes.
- Impact: An attacker that discovers the endpoint can inject arbitrary messages into the RAG pipeline.
- Fix approach: Read `META_APP_SECRET`, verify `sha256=<hex>` against the raw body, reject on mismatch.

**RAG API keys validated lazily:**
- Issue: `getGoogleApiKey()` in `src/config/rag.ts:50-66` throws only when first invoked. The server can boot green and fail the first user message.
- Fix approach: Call `assertRagSecrets()` from `src/server.ts` before `app.listen`.

**Phone numbers stored in plaintext:**
- Issue: `prisma/schema.prisma:72` — `User.phoneNumber String @unique`. Used verbatim in WhatsApp API calls.
- Impact: PII leak risk if DB is compromised; phone numbers are also searchable.
- Fix approach: Encrypt at rest (column-level) or tokenize; at minimum, never log them raw.

**Auth0 env vars validated once, no re-check:**
- Issue: `validateAuthConfig()` is called once in `src/app.ts:12`. If a deploy is misconfigured, you discover it at startup — good — but there's no health probe that reflects Auth0 reachability.
- Fix approach: Add `/health/deep` that calls the JWKS endpoint and returns 503 on failure.

## Performance Bottlenecks

**Hardcoded similarity threshold:**
- Issue: `src/config/rag.ts:16-24` pins `EVAL_SIMILARITY_THRESHOLD = 0.55`, overridable only via env var that's only read in eval scripts, not production.
- Impact: Can't tune retrieval quality without a redeploy.
- Fix approach: Expose `RAG_SIMILARITY_THRESHOLD` as a runtime env var on the production path too.

**Lead extraction concurrency hardcoded:**
- Issue: `src/workers/whatsappWorker.ts:13` — `LEAD_EXTRACTION_CONCURRENCY = 3`. Above 3 concurrent messages, extraction queues up unboundedly inside the process.
- Fix approach: Externalize to env var; emit a gauge metric for the in-flight count.

**Session TTL is 7 days of wall time, not activity:**
- Issue: `src/workers/whatsappWorker.ts:15` — `SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`. Sessions expire based on creation time only.
- Impact: A user who chats on day 6 and day 8 starts a fresh session at day 8 despite active conversation; dormant sessions from day 1 still consume DB rows until day 7.
- Fix approach: Bump `expiresAt` on each message; add a periodic cleanup job for expired rows.

**Embedding batch size hardcoded:**
- Issue: `src/scripts/ingestKnowledge.ts:41` — `EMBEDDING_BATCH_SIZE = 100`. Gemini free tier is 5 RPM, paid is much higher — no tuning knob.
- Fix approach: Env var + inter-batch delay; add exponential backoff on 429s.

**No explicit Prisma connection pool config:**
- Issue: `DATABASE_URL` is used as-is with no `connection_limit` query param. Default is `num_physical_cpus * 2 + 1`.
- Impact: Under bursts, queries block on the pool before timing out.
- Fix approach: Set `connection_limit` explicitly per deployment target; monitor pool saturation.

## Known Bugs

**Webhook returns 200 on validation failure:**
- Issue: `src/controllers/webhookController.ts:52, 56` returns `200 EVENT_RECEIVED` even when Zod parsing fails. The 200 is required by Meta's spec, but failures are only logged — no dead-letter path.
- Impact: Malformed payloads are silently swallowed; no way to diagnose after-the-fact without log search.
- Fix approach: Keep the 200 response but persist the raw failing payload to a `webhook_failures` table.

**`isSessionExpired` uses `<=` on creation-time TTL:**
- Issue: `src/workers/whatsappWorker.ts:17-23` — `session.expiresAt.getTime() <= now.getTime()`. Combined with a default `expiresAt = now + 7 days`, the check only becomes true at exactly the 7-day mark, not for activity-based expiry.
- Impact: Works as designed but the intent ("session expired due to inactivity") is not what the code implements.
- Fix approach: Combined with the activity-based TTL fix above.

**Visit conflict detection assumes a 180-minute max duration:**
- Issue: `src/services/visitService.ts:38` — `MAX_DURATION_MINUTES = 180` is also the Zod cap, but the SQL window-query fetches `[start-180, start+duration]`. If the Zod cap ever rises without updating the SQL window, long visits outside that window silently won't be considered conflicts.
- Impact: Latent bug; unlikely to trigger today but a foot-gun during schema evolution.
- Fix approach: Derive both constants from a single source; add a test that the window always covers the max.

**Lead extraction will crash on first real message:**
- Issue: See Tech Debt — `llm = null` means `extractInsights()` throws. Worker catches the error but every message past the first logs a stack trace.
- Fix approach: Implement the LLM.

## Missing Critical Features

**No structured logging / no correlation IDs:**
- Problem: Everything is `console.log("[Tag] message")`. No JSON, no level filter, no trace ID across webhook → worker → DB.
- Impact: Production debugging is grep-only; can't correlate a user's WhatsApp message with the RAG call and DB write it triggered.
- Improvement: Adopt Pino or Winston; assign a `requestId` (HTTP) / `jobId` (BullMQ) and propagate through services.

**No observability for RAG quality:**
- Problem: Retriever doesn't emit the chunk scores it picked, the similarity threshold's hit rate, or whether handoff was triggered.
- Impact: Silent quality regressions after an embedding model change.
- Improvement: Log chunk IDs + scores per call; LangSmith tracing is already wired (`src/config/langsmith.ts`) but optional — make it default-on in staging.

**No per-user rate limiting on inbound messages:**
- Problem: `express-rate-limit` is installed but unused. A single number could flood the RAG pipeline.
- Improvement: Limit by phone number in the worker before enqueuing RAG.

**No health probe covers dependencies:**
- Problem: `/health` at `src/app.ts:20` returns 200 unconditionally.
- Improvement: Add `/health/ready` that pings Prisma, Redis, and Gemini.

## Test Coverage Gaps

- **Lead extraction with real structured output** — `tests/leadExtractionService.test.ts` mocks the LLM; no test exercises the Zod schema that the LLM must produce.
- **Webhook signature verification** — not implemented, so not tested.
- **Worker idempotency** — `whatsappWorker.ts:101-108, 252-256` has dedup logic by WAMID but no concurrency race test.
- **Timezone edge cases on `visitService.createVisit`** — all tests use `Z` ISO strings; no test with `+03:00` or DST transitions.
- **`errorHandler`** — no direct test for the `ZodError` / `UnauthorizedError` / `SyntaxError` branches.
- **RAG empty retrieval** — no test that confirms the chain's fallback when the threshold rejects all candidates.

## Fragile Areas

**`src/workers/whatsappWorker.ts` — multi-step message handling:**
- Why fragile: upsert user → find/create session → insert message → call RAG → send reply → insert outbound message — all sequential, no transaction. A crash between step 3 and 5 leaves a stored inbound message with no bot reply.
- Safe modification: Wrap steps 3–6 in `prisma.$transaction`; make the outbound WhatsApp send idempotent by keying on `wamid`.

**`src/services/leadExtractionService.ts` — LLM provider coupling:**
- Why fragile: Imports directly from `@langchain/*`; switching providers means editing the file.
- Safe modification: Introduce an `LlmProvider` interface and a factory in `src/config/rag.ts`.

**`src/services/visitService.ts` — overlap math:**
- Why fragile: Hand-rolled date arithmetic using `getTime()` + milliseconds. Readable but fragile to timezone and DST issues not currently tested.
- Safe modification: Add a date-fns or dayjs dependency, or at least centralize overlap math into one tested helper.

**`src/app.ts` — middleware order is load-bearing:**
- Why fragile: `cors → json → auth → routes → errorHandler` is correct but implicit; swapping any two would break auth or error shape.
- Safe modification: Add a comment above the middleware block documenting required order.

## Scaling Limits

**Single-process worker:**
- Current: `src/server.ts:2` imports the worker in-process. One node = one worker.
- Limit: Can't scale API and worker independently; deploying the API horizontally accidentally multiplies worker consumers.
- Fix: Split into two entrypoints (`src/workers/index.ts`) and deploy independently.

**Vector search is similarity-only:**
- Current: `ragRetrieverService.ts` does cosine similarity over `knowledge_documents.embedding`.
- Limit: Past ~50k chunks, recall degrades; no hybrid lexical+vector search.
- Fix: Add Postgres `tsvector` + `ts_rank` as a second pass; merge with RRF.

**No queue size / DLQ monitoring:**
- Current: BullMQ default config, `removeOnComplete: true`, `removeOnFail: 100`.
- Limit: Slow worker → unbounded queue growth → Redis OOM.
- Fix: Cap queue length; alert on depth > threshold; build a DLQ viewer.

## Dependencies at Risk

**Anthropic SDK present but unused:**
- Risk: `@langchain/anthropic` is imported in `leadExtractionService.ts` (commented reference) but the LLM is `null`. Confusing dependency signal.
- Fix: Pick one provider, remove the other from `package.json`.

**LangChain packages pinned with `^`:**
- Risk: `@langchain/core ^1.1.40`, `@langchain/google-genai ^2.1.27`, etc. — minor-version breaking changes are common in early LangChain v1.x.
- Fix: Pin exact versions or use `~` until 1.x stabilizes.

**`uuid ^13.0.0` is a major jump from the commonly-used v9:**
- Risk: If contributors copy old `uuid` snippets from other projects they may hit API differences.
- Fix: Standardize on `crypto.randomUUID()` (Node 18+) and drop the dependency unless specifically needed.

---

*Concerns audit: 2026-04-25*
