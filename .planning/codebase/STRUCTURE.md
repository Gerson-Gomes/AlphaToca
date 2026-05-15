# Directory Structure

**Analysis Date:** 2026-04-25

## Top level

```
AlphaToca-Backend/
├── src/                     # Application source (TypeScript)
├── tests/                   # Vitest suites (mirrors src/)
├── prisma/                  # Prisma schema, seed, test generators
├── scripts/                 # Shell/TS scripts outside the app
├── documentation/           # Business domain docs (used by RAG ingest)
├── conductor/               # Project conductor metadata
├── tasks/                   # Task/PRD markdown (e.g. rag-langchain PRD)
├── .agents/                 # Agent configs
├── .claude/                 # Claude Code settings (local)
├── docker-compose.yml       # Local infra (Postgres, Redis likely)
├── package.json             # Scripts + deps
├── tsconfig.json            # Strict TS, CommonJS, ES2022
├── vitest.config.ts         # Test config (node env, tests/**/*.test.ts)
├── .env / .env.example      # Env template
└── plan.md                  # Working plan
```

## `src/` layout

A flat layered layout — no per-feature folders. Each concern is its own folder and files are named `{domain}Controller.ts`, `{domain}Service.ts`, etc.

```
src/
├── app.ts                       # Express app builder (middleware + routes)
├── server.ts                    # app.listen + side-effect import of worker
├── config/
│   ├── db.ts                    # Prisma singleton
│   ├── rag.ts                   # RAG model config + API key accessors
│   ├── geminiEmbedder.ts        # Gemini embedding model factory
│   ├── langsmith.ts             # Optional LangSmith tracing bootstrap
│   └── swagger.ts               # OpenAPI setup (not yet wired in app.ts)
├── controllers/
│   ├── propertyController.ts
│   ├── userController.ts
│   ├── visitController.ts
│   └── webhookController.ts
├── middlewares/
│   ├── authMiddleware.ts        # Auth0 checkJwt + local user sync
│   └── errorHandler.ts          # Global error → JSON
├── queues/
│   └── whatsappQueue.ts         # BullMQ producer
├── routes/
│   ├── propertyRoutes.ts
│   ├── userRoutes.ts
│   ├── visitRoutes.ts
│   └── webhookRoutes.ts
├── schemas/
│   └── whatsappSchema.ts        # Zod schema for Meta webhook payload
├── scripts/
│   ├── evalRag.ts               # RAG eval runner
│   ├── ingestKnowledge.ts       # FAQ/docs → embedded pgvector rows
│   └── seed-knowledge.ts
├── services/
│   ├── leadExtractionService.ts # Structured LLM extraction (stubbed LLM)
│   ├── messageStatusService.ts
│   ├── propertyService.ts
│   ├── ragChainService.ts       # LangChain RAG chain
│   ├── ragRetrieverService.ts   # pgvector similarity search
│   ├── userService.ts
│   ├── visitService.ts          # Booking logic + conflict detection
│   └── whatsappService.ts       # WhatsApp Graph API client
├── types/
│   ├── express.d.ts             # Express Request augmentation (req.user)
│   └── whatsapp.ts              # Meta webhook TS types
├── utils/
│   ├── propertyValidation.ts    # Zod schemas + inferred types
│   ├── userValidation.ts
│   └── visitValidation.ts
└── workers/
    └── whatsappWorker.ts        # BullMQ consumer + RAG pipeline
```

## `tests/` layout

Flat — one test file per module under test, named `{module}.test.ts`.

```
tests/
├── auth.test.ts
├── generators.test.ts              # Prisma generators
├── ingestKnowledge.test.ts
├── langsmith.test.ts
├── leadExtractionService.test.ts
├── ragChainService.test.ts
├── ragRetrieverService.test.ts
├── seed.test.ts
├── setup.test.ts
├── userSync.test.ts                # authSyncMiddleware
├── visitController.test.ts
├── visitService.test.ts
├── visitValidation.test.ts
├── webhookController.test.ts
└── whatsappWorker.test.ts
```

No nested `__tests__` directories. No fixture folder — fixtures are inlined as `T = (iso) => new Date(iso)` helpers and `makeHarness()` factories inside each test file.

## `prisma/` layout

```
prisma/
├── schema.prisma       # 10 models, pgvector enabled, snake_case @@map
├── seed.ts             # Invoked via npm script `prisma.seed`
└── generators.ts       # Faker-based test data generators (shared w/ tests)
```

## Key locations — by task

| I want to…                                   | Look at                                                     |
|----------------------------------------------|-------------------------------------------------------------|
| Add a new REST endpoint                      | `src/routes/*.ts` + new controller + service                |
| Change auth behavior                         | `src/middlewares/authMiddleware.ts`                         |
| Tune conflict detection for visits           | `src/services/visitService.ts:36-108`                       |
| Add a Zod schema                             | `src/utils/*Validation.ts`                                  |
| Modify RAG prompt/chain                      | `src/services/ragChainService.ts`, `src/config/rag.ts`      |
| Change similarity threshold                  | `src/config/rag.ts:16-24`                                   |
| Add a new WhatsApp message handler           | `src/workers/whatsappWorker.ts`                             |
| Change DB schema                             | `prisma/schema.prisma` → `npx prisma migrate dev`           |
| Ingest new docs into the knowledge base      | `src/scripts/ingestKnowledge.ts` + files in `documentation/`|
| Add a test                                   | `tests/{module}.test.ts`                                    |

## Naming conventions

| Artifact             | Pattern                              | Example                                  |
|----------------------|--------------------------------------|------------------------------------------|
| Files                | `camelCase.ts`                       | `visitService.ts`                        |
| Controllers          | `{domain}Controller.ts`              | `visitController.ts`                     |
| Services             | `{domain}Service.ts`                 | `visitService.ts`                        |
| Routes               | `{domain}Routes.ts`                  | `visitRoutes.ts`                         |
| Validation           | `{domain}Validation.ts`              | `visitValidation.ts`                     |
| Test files           | `{moduleName}.test.ts`               | `visitService.test.ts`                   |
| Prisma models        | PascalCase singular                  | `User`, `Property`, `Visit`              |
| Prisma table map     | snake_case plural via `@@map`        | `users`, `properties`, `visits`          |
| Prisma columns       | camelCase field, snake_case `@map`   | `landlordId @map("landlord_id")`         |
| Zod schemas          | `{action}{Entity}Schema`             | `createVisitSchema`                      |
| Zod-inferred types   | `{Action}{Entity}Input`              | `CreateVisitInput`                       |
| Controller exports   | Named object `{domain}Controller`    | `export const visitController = { … }`   |
| Service exports      | Named async functions                | `export async function createVisit()`    |
| Service DI           | `{Domain}Deps` interface + `defaultDeps` | `VisitDeps`                          |
| Domain errors        | `{Domain}Error extends Error`        | `VisitError`                             |

## Notable conventions

- **Comments are Portuguese.** Business rationale comments in `schema.prisma` and `visitService.ts` are in Brazilian Portuguese; code identifiers are English.
- **`@@map` to snake_case** — every model maps to a `snake_case` plural table name.
- **Swagger is inline on routes** — JSDoc comments above each route handler.
- **No `src/index.ts`** — entry is `src/server.ts` per `package.json:main`.

---

*Structure mapping: 2026-04-25*
