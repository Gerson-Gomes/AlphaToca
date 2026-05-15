# Context Intel

Supporting project context extracted from classified DOCs. Grouped by topic. Source attribution is preserved for every note so the roadmapper can trace provenance.

---

## Topic: Project Vision & Product Scope

### AlphaToca Backend — one-line summary
- source: `conductor/product.md`
- A backend API for a mobile apartment rental platform that uses WhatsApp as the primary lead generation and qualification channel, transitioning qualified leads into a mobile/web app for detailed property discovery.

### Target audiences
- source: `conductor/product.md`
- Tenants: searching for apartments, interact via WhatsApp first.
- Landlords/Managers: manage listings, receive automated WhatsApp-sourced leads.
- Real Estate Agents: automate first contact and lead filtering.

### Core value propositions
- source: `conductor/product.md`
- WhatsApp entry point: primary initial-interaction layer.
- Automated FAQ + qualification via RAG on WhatsApp.
- Frictionless transition from WhatsApp to the mobile/web app for rich property exploration and final applications.

### Key features (vision-level)
- source: `conductor/product.md`
- WhatsApp webhook (incoming message processing + AI-powered responses).
- Property Listing API (mobile/web app backend).
- RAG system (PostgreSQL + pgvector for intelligent WhatsApp responses).

### Essential integrations
- source: `conductor/product.md`
- WhatsApp Cloud API (direct integration).
- PostgreSQL with pgvector (primary DB + vector store).

---

## Topic: Technology Stack (de-facto)

### Core runtime
- source: `conductor/tech-stack.md`
- Language: TypeScript
- Runtime: Node.js
- Framework: Express

### Data layer
- source: `conductor/tech-stack.md`
- Database: PostgreSQL with `pgvector`
- ORM: Prisma

### Identity & security
- source: `conductor/tech-stack.md`
- Provider: Auth0
- Standard: JSON Web Tokens (JWT)

### Background processing & queues
- source: `conductor/tech-stack.md`
- Queue engine: Redis
- Job manager: BullMQ
- Rationale: "mandatory to handle WhatsApp Cloud API webhooks. Guarantees an immediate HTTP 200 OK response to the WhatsApp hub while offloading heavy LLM/RAG processing with LangChain to the background."

### AI & RAG
- source: `conductor/tech-stack.md`
- Orchestration: LangChain (Node.js)
- Vector Store: PostgreSQL `pgvector`

### Communication & messaging
- source: `conductor/tech-stack.md`
- WhatsApp Cloud API — direct integration (no intermediary service).

---

## Topic: Product Guidelines (Tone, UX, Architecture, Errors)

### Tone and voice
- source: `conductor/product-guidelines.md`
- WhatsApp (user-facing): friendly & conversational, modern, like a helpful assistant.
- API (developer-facing): concise & technical, direct.

### UX principles (backend perspective)
- source: `conductor/product-guidelines.md`
- Conversational efficiency: backend must prioritize fast, RAG-powered responses for WhatsApp.
- Mobile-optimized data: lightweight, highly relevant API payloads.
- Cross-channel continuity: robust state management for WhatsApp → mobile/web transitions.

### Backend architecture style
- source: `conductor/product-guidelines.md`
- Modular and decoupled: strict separation between core business logic, WhatsApp webhooks, and RAG/AI components.
- Performant RAG integration: optimize vector queries and LLM interactions.
- Note: product-guidelines.md says "sub-second responses"; the RAG PRD specifies p50 <= 4s / p95 <= 8s. See `INGEST-CONFLICTS.md` INFO entry (PRD > DOC precedence resolves this).

### Error handling
- source: `conductor/product-guidelines.md`
- Short & technical: errors communicated via standard HTTP codes with concise, actionable, machine-readable payloads.
- Fail-safe AI: robust fallbacks for the RAG system — WhatsApp bot remains helpful even when the AI is uncertain.
- Standard error shape: all API errors must conform to the `ErrorResponse` global interface:
  ```typescript
  type ErrorResponse = {
      status: number;
      code: string;
      messages: any[];
  }
  ```
- Payload validation: **Zod** is the strongly recommended tool for validating all incoming payloads (Flutter mobile app, WhatsApp incoming webhooks). Invalid inputs must be rejected following the `ErrorResponse` shape.

---

## Topic: Implementation Roadmap — `plan.md` Phase Structure

### Provenance note
- source: `plan.md` (DOC, medium confidence)
- This is the closest thing to a roadmap currently in the project. It is written in Portuguese as a Jira-ready task checklist. It is NOT promoted to requirements — the PRDs drive requirements. The phase structure is preserved here verbatim so the downstream roadmapper can fold it into ROADMAP.md alongside the Auth0 track plan.
- This DOC overlaps in scope with `tasks/prd-rag-langchain.md` on Phase 4 (RAG). See `INGEST-CONFLICTS.md` WARNING — the RAG PRD is the authoritative source of RAG acceptance criteria; plan.md Phase 4 is a task-level breakdown of the same feature.

### Phase 1 — Webhook Foundations & Background Jobs
- source: `plan.md` (Portuguese, translated summary below; keys preserved)
- Task 1.1: Validate WhatsApp incoming webhook payloads with Zod in `webhookController.ts`.
- Task 1.2: Configure Redis connection and structure a BullMQ queue for incoming WhatsApp messages.
- Task 1.3: Refactor `webhookController.ts` to enqueue valid messages into BullMQ and return an immediate HTTP 200 OK.
- Task 1.4: Implement a BullMQ worker skeleton in `workers/whatsappWorker.ts` to process queued jobs.
- Task 1.5: Unit tests for webhook validation + job scheduling.

### Phase 2 — Outbound WhatsApp Messaging
- source: `plan.md`
- Task 2.1: Implement outbound integration with WhatsApp Cloud API for text messages.
- Task 2.2: Error handling for outbound sends (rate limits, invalid numbers).
- Task 2.3: Integrate the outbound service into `whatsappWorker.ts` so the bot can reply/echo.
- Task 2.4: Unit tests / mocks for the WhatsApp service.

### Phase 3 — Conversation State Management (Database)
- source: `plan.md`
- Task 3.1: Repository functions to create/find `User` by `phoneNumber`.
- Task 3.2: Create/resume the active `ChatSession` for a given tenantId.
- Task 3.3: Persist inbound WhatsApp messages into `Message` tied to the user's current `ChatSession`.
- Task 3.4: Persist bot replies into `Message`.
- Task 3.5: Unit tests for ChatSession / Message repository operations.

### Phase 4 — RAG System & Knowledge Base (LangChain + pgvector)
- source: `plan.md`
- Task 4.1: Seeder script populates `KnowledgeDocument` with FAQs / base guidelines + generates embeddings via LangChain.
- Task 4.2: LangChain VectorStore retriever on top of Prisma + pgvector to find similar `KnowledgeDocument`s.
- Task 4.3: Conversational Retrieval Chain combining chat history (`Message`) with retrieved RAG context.
- Task 4.4: Integrate LangChain response directly into `whatsappWorker.ts` to generate and send the AI reply.
- **Cross-reference:** These tasks describe the same feature as the REQ-rag-* set in `requirements.md`. Any phase/task-level detail here must be reconciled with the PRD's acceptance criteria before routing (see WARNING in `INGEST-CONFLICTS.md`). Notably, plan.md Task 4.3 references `ConversationalRetrievalChain` (a v0 LangChain API), whereas the PRD Technical Considerations explicitly pin `langchain@^1.3.3` + LCEL (`RunnableSequence`, `ChatPromptTemplate`) and deprecate `ConversationalRetrievalChain`. The PRD wins on precedence.

### Phase 5 — Lead Qualification & Insight Extraction
- source: `plan.md`
- Task 5.1: Configure LangChain structured output to extract user intents and keys (e.g. rental budget, desired neighborhood).
- Task 5.2: Logic to create/update a `RentalProcess` based on user intent.
- Task 5.3: Persist extracted info into `AiExtractedInsight` linked to the user's `RentalProcess`.
- Task 5.4: State transition logic: if user is qualified or requests human support, change `ChatStatus` to `WAITING_HUMAN`.
- **Cross-reference:** Formalized in REQ-rag-lead-extraction (see `requirements.md`).

### Phase 6 — Documentation & Final Polishing
- source: `plan.md`
- Task 6.1: Add Swagger/OpenAPI documentation for current `propertyRoutes` and `userRoutes`.
- Task 6.2: JSDoc on all public functions and controllers.
- Task 6.3: Run lint + format + coverage, hitting >80% coverage target.
- Task 6.4: Add manual verification walkthrough to project docs per application guidelines.

---

## Topic: Auth0/JWT Track Progress Snapshot

### Source & status
- source: `conductor/tracks/auth_jwt_auth0_20260416/plan.md`
- Status: all 4 phases marked complete (`[x]`) with checkpoint SHAs.
- Phases complete:
  - Phase 1: Foundation & Infrastructure — checkpoint `71df7f3`
  - Phase 2: Auth Middleware Implementation (TDD) — checkpoint `a22b10b`
  - Phase 3: User Synchronization & Identity Management (TDD) — checkpoint `37fa387`
  - Phase 4: Route Security & Integration — checkpoint `519f4de`

### Implementation details preserved for provenance
- source: `conductor/tracks/auth_jwt_auth0_20260416/plan.md`
- Dependencies installed: `express-oauth2-jwt-bearer`, `jwks-rsa`.
- Auth0 env vars declared in `.env.example`.
- JWT validation middleware implemented using `auth()` from `express-oauth2-jwt-bearer`.
- User sync: `upsertUserFromAuth0` service with profile + role mapping.
- Sync integrated into request lifecycle.
- Existing routes (`/api/properties`, `/api/users`) secured via auth middleware in `src/server.ts`.

### Track index
- source: `conductor/tracks/auth_jwt_auth0_20260416/index.md`
- Links to spec, plan, and metadata for the auth track.

### Tracks registry
- source: `conductor/tracks.md`
- Currently only one track is registered: `auth_jwt_auth0_20260416` (marked `[x]` done).

---

## Topic: Project Workflow & Delivery Process

### Guiding principles
- source: `conductor/workflow.md`
- The plan (`plan.md`) is the source of truth.
- Tech stack changes must be documented in `tech-stack.md` before implementation.
- Test-Driven Development: write unit tests before implementation.
- High code coverage: target >80% for all modules.
- User experience first on every decision.
- Non-interactive, CI-aware tooling (e.g., `CI=true` for watch-mode tools).

### Task lifecycle (standard workflow)
- source: `conductor/workflow.md`
- Select task → mark `[~]` in progress → Red (failing tests) → Green (minimum code) → Refactor → verify coverage → document deviations → commit code → attach git note with task summary → update `plan.md` with 7-char SHA → commit plan update.

### Phase-completion protocol
- source: `conductor/workflow.md`
- After a task that concludes a phase: announce → ensure test coverage for phase changes (diff vs previous checkpoint SHA) → run automated tests with proactive debugging (max 2 fix attempts before asking user) → propose a step-by-step manual verification plan grounded in `product.md` + `product-guidelines.md` + `plan.md` → await explicit user confirmation → create checkpoint commit → attach auditable git note → append `[checkpoint: <sha7>]` to phase heading in `plan.md` → commit plan update.

### Quality gates (per task completion)
- source: `conductor/workflow.md`
- All tests pass.
- Coverage >=80%.
- Code style compliant (per `code_styleguides/`).
- All public functions/methods documented (JSDoc).
- Type safety enforced.
- No lint/static-analysis errors.
- Mobile correctness where applicable.
- Docs updated if needed.
- No introduced security vulnerabilities.

### Commit message format
- source: `conductor/workflow.md`
- `<type>(<scope>): <description>` where type is one of `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore`.

### Emergency procedures summary
- source: `conductor/workflow.md`
- Critical production bug: hotfix branch from main → failing test → minimal fix → deploy → document.
- Data loss: stop writes → restore from backup → verify → document → update backup procedures.
- Security breach: rotate all secrets → review access logs → patch → notify affected users → document.

### Deployment workflow
- source: `conductor/workflow.md`
- Pre-deploy: all tests, coverage >=80%, no lint errors, mobile testing, env vars, migrations ready, backup.
- Deploy: merge feature → main, tag release, push, run migrations, verify, test critical paths, monitor.

### Note on workflow.md hygiene
- source: `conductor/workflow.md` (last ~10 lines of file)
- The file has a trailing duplicated fragment ("ain\n2. Tag release with version …") suggesting a prior edit accident. Flagged for the roadmapper as a minor docs-hygiene item, not a blocker.

---

## Topic: Code Style Guides

### General principles
- source: `conductor/code_styleguides/general.md`
- Readability, consistency with existing patterns, simplicity, maintainability, and meaningful documentation ("why not what").

### TypeScript (Google TS style, gts-enforced)
- source: `conductor/code_styleguides/typescript.md`
- `const` by default, `let` where reassignment needed, `var` forbidden.
- ES6 modules; no `namespace`; named exports only (no default exports).
- Classes: no `#private` fields — use `private` modifier; mark readonly where applicable; never use `public` modifier (default).
- Functions: function declarations for named fns; arrow fns for anonymous/callbacks.
- Strings: single quotes; template literals for interpolation/multi-line.
- Equality: always `===` / `!==`.
- Type assertions and non-null assertions discouraged; justify when unavoidable.
- `any` forbidden; prefer `unknown` or specific types.
- No `const enum` (plain `enum` only).
- `eval()` and `Function(...string)` forbidden.
- Semicolons explicit; no ASI reliance.
- Naming: `UpperCamelCase` classes/interfaces/types/enums/decorators; `lowerCamelCase` vars/params/fns/methods/props; `CONSTANT_CASE` globals + enum values; no `_` prefix/suffix.
- Optional (`?`) preferred over `| undefined`.
- `T[]` for simple types; `Array<T>` for unions.
- `{}` forbidden — prefer `unknown`, `Record<string, unknown>`, or `object`.
- JSDoc for docs; `//` for implementation notes; no redundant type annotations in `@param`/`@return` (TS already has types).

### JavaScript (Google JS style)
- source: `conductor/code_styleguides/javascript.md`
- File naming: lowercase + `_`/`-`, extension `.js`.
- UTF-8; ASCII horizontal spaces only (no tabs for indent).
- ES modules; named exports only (no default); `.js` extension mandatory in import paths.
- Braces required on all control structures; K&R style.
- +2 space indent; semicolons required; 80-char column limit; +4 continuation indent.
- `const` default, `let` when reassigning, `var` forbidden.
- Trailing commas in array/object literals; shorthand props; no Array/Object constructors.
- No JS getter/setter properties — use ordinary methods.
- Arrow fns preferred for nested fns (preserve `this`).
- Single quotes; template literals for multi-line / complex interpolation.
- `for-of` preferred; `for-in` only for dict-style objects.
- `this` only in class constructors/methods or arrow fns therein.
- Always use `===` / `!==`.
- Forbidden: `with`, `eval()`, `Function(...string)`, ASI, modifying builtin prototypes.
- Naming: `UpperCamelCase` classes; `lowerCamelCase` methods/fns; `CONSTANT_CASE` constants; `lowerCamelCase` non-const fields/vars.
- JSDoc on classes/fields/methods; use `@param`/`@return`/`@override`/`@deprecated`; types in braces.

---

## Topic: Document Index

### Project context entrypoint
- source: `conductor/index.md`
- Links to: product.md, product-guidelines.md, tech-stack.md, workflow.md, code_styleguides/, tracks.md, tracks/.

### Auth track entrypoint
- source: `conductor/tracks/auth_jwt_auth0_20260416/index.md`
- Links to: spec.md, plan.md, metadata.json.
