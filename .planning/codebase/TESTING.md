# Testing

**Analysis Date:** 2026-04-25

## Framework

**Vitest 4.1.4** with v8 coverage.

- Config: `vitest.config.ts`
  - `globals: true` — `describe`/`it`/`expect`/`vi` available without imports (though files import them explicitly anyway)
  - `environment: 'node'`
  - `include: ['tests/**/*.test.ts']`
  - Coverage provider: `v8`, scope: `src/**/*.ts`
- Scripts (`package.json`):
  - `npm test` → `vitest run` (one-shot)
  - `npm run test:watch` → `vitest` (watch mode)
  - `npm run test:coverage` → `vitest run --coverage`

## Test layout

Flat `tests/` directory — one `{module}.test.ts` file per tested module. No per-feature subdirectories, no shared `__fixtures__`.

```
tests/
├── auth.test.ts                   # authMiddleware (checkJwt wiring)
├── generators.test.ts             # prisma/generators.ts (Faker)
├── ingestKnowledge.test.ts        # ingest script
├── langsmith.test.ts              # LangSmith bootstrap
├── leadExtractionService.test.ts  # lead extraction (LLM mocked)
├── ragChainService.test.ts        # RAG chain orchestration
├── ragRetrieverService.test.ts    # pgvector retriever
├── seed.test.ts                   # prisma/seed.ts
├── setup.test.ts                  # sanity check
├── userSync.test.ts               # authSyncMiddleware upsert
├── visitController.test.ts        # HTTP adapter for visits
├── visitService.test.ts           # booking + conflict logic
├── visitValidation.test.ts        # Zod schemas for visits
├── webhookController.test.ts      # Meta webhook verify + intake
└── whatsappWorker.test.ts         # BullMQ worker end-to-end
```

## Mocking strategy

Two distinct patterns coexist, picked by the shape of the module under test.

### 1. Service tests — dependency injection via `deps`

Preferred for business-logic services (`visitService`, etc.). The production code exposes a `Deps` interface that narrows Prisma to just the methods it needs; tests build a hand-rolled in-memory fake via a `makeHarness()` factory.

Example from `tests/visitService.test.ts:47-173`:

```ts
function makeHarness(opts: { properties?: FakeProperty[]; visits?: FakeVisit[] } = {}): VisitHarness {
  const properties = (opts.properties ?? []).map(p => ({ ...p }));
  const visits = (opts.visits ?? []).map(v => ({ ...v }));

  const propertyFindUnique = vi.fn(async ({ where }) => properties.find(p => p.id === where.id) ?? null);
  const visitFindMany = vi.fn(async ({ where }) => visits.filter(/* mimics Prisma where clause */));
  const visitCreate = vi.fn(async ({ data }) => { /* pushes into visits array */ });

  return {
    deps: { prisma: { property: { findUnique: propertyFindUnique }, visit: { … } } as unknown as VisitDeps['prisma'] },
    state: { properties, visits },
    mocks: { propertyFindUnique, visitFindUnique, visitFindMany, visitCreate, visitUpdate },
  };
}
```

Tests then call the service directly with `h.deps` and assert on both the return value and `h.state` / `h.mocks`:

```ts
const visit = await createVisit({ propertyId: 'prop-1', tenantId: 't-1', scheduledAt: T('2026-05-10T14:00:00Z') }, h.deps);
expect(visit.landlordId).toBe('landlord-1');
expect(h.state.visits).toHaveLength(1);
```

**Why this matters:** no module-level `vi.mock('@prisma/client')`, no `jest.mock`-style magic. Tests are fully deterministic, run in-process, and touch zero I/O.

### 2. Module mocks via `vi.hoisted` + `vi.mock`

Used when the module under test imports side-effect-heavy singletons that can't be swapped via `deps` (controllers, queue producers, worker). Pattern from `tests/webhookController.test.ts:4-17`:

```ts
const { mockQueueAdd, mockUpdateMessageStatus } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: 'job-1' }),
  mockUpdateMessageStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queues/whatsappQueue', () => ({ messageQueue: { add: mockQueueAdd } }));
vi.mock('../src/services/messageStatusService', () => ({ updateMessageStatus: mockUpdateMessageStatus }));

// Import AFTER the mocks so the mocked modules are resolved first
import { verifyWebhook, receiveMessage } from '../src/controllers/webhookController';
```

The `vi.hoisted` form is required because `vi.mock` calls are hoisted to the top of the file; using it keeps references to the same `vi.fn()` instances so assertions work.

### 3. Express request/response doubles

Controllers are tested with thin `mockRes()` factories rather than `supertest` (even though `supertest` is in devDependencies):

```ts
function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    sendStatus: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}
```

## Structure of a test

AAA pattern, with `beforeEach(() => vi.clearAllMocks())` at the top of suites that use module mocks.

```ts
describe('visitService.createVisit', () => {
  it('creates a visit and resolves landlordId from the property', async () => {
    // Arrange
    const h = makeHarness({ properties: [{ id: 'prop-1', landlordId: 'landlord-1' }] });

    // Act
    const visit = await createVisit(
      { propertyId: 'prop-1', tenantId: 't-1', scheduledAt: T('2026-05-10T14:00:00Z') },
      h.deps,
    );

    // Assert
    expect(visit.landlordId).toBe('landlord-1');
    expect(h.state.visits).toHaveLength(1);
  });
});
```

Small helpers like `const T = (iso) => new Date(iso)` make ISO-heavy tests readable.

## Error assertions

Domain errors are matched with `toMatchObject` on the typed fields, not string matching:

```ts
await expect(
  createVisit({ propertyId: 'prop-ghost', … }, h.deps),
).rejects.toMatchObject({ code: 'PROPERTY_NOT_FOUND', httpStatus: 404 });
```

## Coverage

- Provider: **v8** (via `@vitest/coverage-v8`)
- Scope: `src/**/*.ts` (only application code, not `prisma/` or `tests/`)
- Command: `npm run test:coverage`
- Artifacts are git-ignored (`.gitignore` excludes coverage output — see commit `7a26c2c`).

No coverage thresholds are enforced in CI; the config is baseline only.

## What's well-tested

- `visitService` — extensive conflict/overlap scenarios, back-to-back edge case, cancel, update, availability slots (`tests/visitService.test.ts`)
- `webhookController` — verify handshake, payload validation, queue enqueue (`tests/webhookController.test.ts`)
- `whatsappWorker` — session lifecycle, RAG happy path, error fallback (`tests/whatsappWorker.test.ts`)
- Prisma seed + generators — sanity against schema shape

## What's under-tested

- **Lead extraction with a real LLM** — `tests/leadExtractionService.test.ts` mocks the LLM entirely; the production code in `src/services/leadExtractionService.ts` has `const llm = null as any`, so the structured-output contract is not exercised end-to-end.
- **Webhook idempotency / duplicate WAMID** — worker has deduplication logic (`whatsappWorker.ts:252-256`) but no concurrency-race test.
- **Timezone edge cases in visit overlap** — the 180-minute window math in `visitService.ts:36-108` assumes JS `Date` semantics; no explicit timezone test.
- **Error handler** — `src/middlewares/errorHandler.ts` has no direct test.
- **RAG empty-result handling** — when the similarity threshold rejects all chunks, no test confirms the fallback path.

## Running a single test

```bash
# single file
npx vitest run tests/visitService.test.ts

# single test by name (regex)
npx vitest run -t 'creates a visit and resolves landlordId'

# watch a single file
npx vitest tests/visitService.test.ts
```

## Gotchas

- **`vi.hoisted` is mandatory** when you need to reference a mock inside `vi.mock()` and also assert on it later.
- **Import order matters** — always `vi.mock(...)` before `import` of the module under test.
- **`beforeEach(() => vi.clearAllMocks())`** resets call history but not implementations — use `vi.resetAllMocks()` if you also swapped `mockResolvedValue`.
- **No Supertest usage** despite being installed — controllers are tested at the function level with fake `Request`/`Response` objects.
- **`tsconfig.json` has `ts-node.files: true`** — required so ambient `.d.ts` types (like `src/types/express.d.ts`) are picked up at runtime; removing it will break `req.user` typing in tests.

---

*Testing mapping: 2026-04-25*
