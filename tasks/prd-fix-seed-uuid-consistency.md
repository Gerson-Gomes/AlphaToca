# PRD: Fix Seed/Validator UUID Consistency

## 1. Introduction / Overview

The backend has an internal contradiction that blocks the landlord dashboard, dossier, and visits flows in the frontend:

- Zod validators in `src/utils/*.ts` require `landlordId`, `tenantId`, `propertyId`, `sessionId`, and `rentalProcessId` to be **canonical UUIDs** (`z.string().uuid()`).
- The database seed in `prisma/demoData.ts` inserts human-readable ids like `user-demo-landlord-1`, `user-demo-tenant-1`, `prop-demo-sp-1`, `img-demo-rj-1`, etc.
- `/users/me` returns these invalid ids as the authenticated user identity, so every downstream call (e.g. `GET /properties/search?landlordId=user-demo-landlord-1`) is self-rejected by the backend with `400 VALIDATION_ERROR — Invalid uuid`.

This PRD captures a backend-only fix: replace the hardcoded seed ids with canonical UUIDs exposed as exported constants, keep validators strict, and prove end-to-end via regression test that an authenticated landlord can list their own properties.

**Reference error:**
```json
{ "status": 400, "code": "VALIDATION_ERROR", "messages": [{ "path": "landlordId", "message": "Invalid uuid" }] }
```

## 2. Goals

- Eliminate the `400 Invalid uuid` on every endpoint that filters by `landlordId` / `tenantId` when the caller authenticates against the demo seed.
- Keep all `z.string().uuid()` validators intact (no loosening to `z.string().min(1)`).
- Make demo ids **fixed and deterministic** across re-seeds so tests, docs, and manual QA reference stable values.
- Provide a single source of truth for demo user/property ids via exported constants.
- Document the "drop + re-seed" step required to clear legacy non-UUID rows.
- Add an end-to-end regression test that fails if this class of bug resurfaces.

## 3. User Stories

### US-001: Add exported UUID constants for demo seed entities
**Description:** As a backend developer, I need a single module that exports canonical UUID constants for every hardcoded demo entity so that seed data, tests, and debug docs reference one source of truth.

**Acceptance Criteria:**
- [ ] New file `prisma/demoIds.ts` exports named constants for each demo entity currently hardcoded in `prisma/demoData.ts`: 3 users, 5 properties, 11+ property images (total matches the 18 ids found in the current seed).
- [ ] Each constant is a canonical UUID v4 string literal (e.g. `'550e8400-e29b-41d4-a716-446655440001'`), **not** generated at runtime — so ids stay stable across re-seeds, CI runs, and developer machines.
- [ ] Constants are named by role + index (e.g. `DEMO_LANDLORD_1_ID`, `DEMO_TENANT_1_ID`, `DEMO_ADMIN_ID`, `DEMO_PROPERTY_SP_1_ID`, `DEMO_PROPERTY_RJ_1_ID`, …).
- [ ] `z.string().uuid().parse(DEMO_LANDLORD_1_ID)` passes for every exported constant (verified by a unit test in this same story).
- [ ] Typecheck and lint pass.

### US-002: Rewrite `prisma/demoData.ts` to consume the UUID constants
**Description:** As a backend developer, I want `demoData.ts` to reference the constants from `demoIds.ts` so the seed stops inserting ids that fail the global UUID validators.

**Acceptance Criteria:**
- [ ] All `id: 'user-demo-*'`, `id: 'prop-demo-*'`, and `id: 'img-demo-*'` literals in `prisma/demoData.ts` are replaced with the corresponding constant from `prisma/demoIds.ts`.
- [ ] All `landlordId: 'user-demo-landlord-1'` cross-references inside `demoData.ts` use `DEMO_LANDLORD_1_ID` (same constant referenced by the user row).
- [ ] Demo users lose the `user-demo-*` identity hint from their `id` field — identification is now via `email` (already present, e.g. `landlord1@demo.com`) and `role`. No `slug` / `demoLabel` field is added to the Prisma schema.
- [ ] `firebaseUid` env-var fallbacks (`LANDLORD_FIREBASE_UID`, `ADMIN_FIREBASE_UID`, etc.) remain unchanged — only the `id` PK changes.
- [ ] `npm run build` / `tsc --noEmit` passes.

### US-003: Run the seed against a clean database and verify UUID round-trip
**Description:** As a backend developer, I want a documented flow that drops legacy non-UUID rows and re-seeds with the new UUID ids so local and CI environments converge.

**Acceptance Criteria:**
- [ ] `README.md` (or `documentation/` equivalent) gets a **"Re-seeding after the UUID migration"** section with the exact commands: `npx prisma migrate reset --force` (or equivalent drop) followed by `npm run seed` / `npx prisma db seed`.
- [ ] After running the documented flow against a local Postgres, `SELECT id FROM users LIMIT 5;` returns only canonical UUIDs.
- [ ] Manual `curl` check: `GET /properties/search?landlordId={DEMO_LANDLORD_1_ID}` with a valid auth token returns `200` and includes the 5 demo properties seeded under that landlord.

### US-004: Audit every `z.string().uuid()` validator and confirm no loosening is needed
**Description:** As a backend developer, I want written confirmation that every UUID validator in `src/utils/` still passes strict validation after the seed fix, so we don't silently ship a bypass.

**Acceptance Criteria:**
- [ ] Audit checklist inside this PRD (or a short `tasks/audit-uuid-validators.md`) listing every `z.string().uuid()` call across the 6 files below, each marked ✅ "kept strict, verified against new seed":
  - `src/utils/contractValidation.ts` (propertyId, tenantId, landlordId)
  - `src/utils/proposalValidation.ts` (propertyId, tenantId, landlordId, optional variants)
  - `src/utils/visitValidation.ts` (propertyId, tenantId, landlordId, rentalProcessId)
  - `src/utils/propertyValidation.ts` (landlordId)
  - `src/utils/searchValidation.ts` (landlordId, tenantId)
  - `src/utils/chatValidation.ts` (sessionId, tenantId)
- [ ] No validator is relaxed to `z.string().min(1)` or `z.string()`. If a genuine need to loosen one is discovered, it is called out as an Open Question, not silently changed.

### US-005: End-to-end regression test — authenticated landlord can list own properties
**Description:** As a backend developer, I want an automated test that exercises the full chain (`/users/me` → extract `id` → `GET /properties/search?landlordId={id}` → `200`) so this class of seed/validator drift can't regress silently.

**Acceptance Criteria:**
- [ ] New test file `tests/seedUuidRegression.test.ts` (or equivalent name) covers:
  1. A request to `/users/me` authenticated as the demo landlord returns a user whose `id` passes `z.string().uuid().safeParse(...)`.
  2. `GET /properties/search?landlordId={id from /users/me}` returns `200` (not `400`), and the response contains ≥ 1 property.
  3. `GET /properties/search?landlordId=user-demo-landlord-1` (the legacy format) still returns `400 VALIDATION_ERROR` — proving the validator stayed strict.
- [ ] Test uses Supertest against the real Express app (same pattern as existing controller tests), not a fully mocked Prisma client, so it actually catches seed/validator drift.
- [ ] Test passes locally after the seed fix; would have failed before it. Include one sentence in the PR description showing the "before" failure mode to prove the assertion.
- [ ] Typecheck, lint, and the full test suite pass.

### US-006: Update `tests/seed.test.ts` assertions to reference the new constants
**Description:** As a backend developer, I want the existing seed unit test to optionally assert that `user.createMany` received UUID-shaped ids, closing the gap that let the original bug through.

**Acceptance Criteria:**
- [ ] `tests/seed.test.ts` adds one assertion that the payload passed to `prisma.user.createMany` contains ids matching the UUID regex (or equals the exported `DEMO_*_ID` constants).
- [ ] Existing assertions in the file still pass.
- [ ] Typecheck and lint pass.

## 4. Functional Requirements

- **FR-1:** Demo seed entity ids MUST be canonical UUID v4 strings that pass `z.string().uuid()`.
- **FR-2:** Demo seed ids MUST be stable across re-seeds and across developer machines (hardcoded literal UUIDs, not `crypto.randomUUID()`).
- **FR-3:** There MUST be exactly one module (`prisma/demoIds.ts`) that exports every demo UUID as a named constant. `prisma/demoData.ts`, tests, and docs MUST import from it — no re-declaring literals elsewhere.
- **FR-4:** The Prisma schema (`prisma/schema.prisma`) MUST remain unchanged — `id` columns stay as `String`, no `@db.Uuid`, no `@default(dbgenerated("gen_random_uuid()"))`. (Per clarifying answer 3A.)
- **FR-5:** All existing `z.string().uuid()` validators MUST remain strict (no downgrade to `z.string().min(1)` or `z.string()`).
- **FR-6:** Demo user identification in logs and debug flows MUST rely on `email` + `role` (already seeded), not on a human-readable `id`. (Per clarifying answer 2A.)
- **FR-7:** Documentation MUST include the drop + re-seed command for clearing environments that already hold legacy non-UUID rows.
- **FR-8:** A regression test MUST exercise the real `/users/me` → `/properties/search?landlordId=...` chain end-to-end and fail if the `id` returned by `/users/me` is not a valid UUID.

## 5. Non-Goals (Out of Scope)

- **No Prisma schema changes.** `id String` stays as-is; we are not introducing `@db.Uuid`, `gen_random_uuid()` defaults, or database-level UUID constraints.
- **No validator loosening.** `z.string().uuid()` is not changed anywhere.
- **No frontend changes.** This PRD is backend-only; the Flutter/Riverpod retry loop on `/properties/search` will resolve naturally once `400`s become `200`s.
- **No debounce / retry-loop fix** for the Riverpod notifier re-evaluation — tracked separately if it persists after this fix lands.
- **No migration script for production.** The only environments running the demo seed are local dev and CI. A `prisma migrate reset` is sufficient; we are not writing a data-migration for production because production does not run this seed.
- **No renaming / slug field** (`demoLabel`, `slug`, etc.) on the `User` or `Property` model. Human-readable identity stays in `email` / `title`.
- **No change to `firebaseUid` mock values** — only the Prisma `id` PK is affected.

## 6. Technical Considerations

- **Affected files (in scope):**
  - `prisma/demoIds.ts` — **new**
  - `prisma/demoData.ts` — rewrite id literals
  - `prisma/seed.ts` — no logic change expected, but imports may shift
  - `tests/seed.test.ts` — add UUID-shape assertion
  - `tests/seedUuidRegression.test.ts` — **new**
  - `README.md` (or `documentation/`) — re-seed instructions
- **UUID strategy:** Use hardcoded UUID v4 literals. Reserve an obvious prefix range so demo ids are recognizable at a glance during debugging, e.g. `00000000-0000-4000-8000-00000000000X` for users and `00000000-0000-4000-8000-0000000001XX` for properties. Final exact values to be chosen at implementation time, as long as they are valid UUID v4.
- **Re-seed sequencing:** `prisma/seed.ts` already calls `deleteMany()` on all tables before inserting, so a plain `npm run seed` should suffice on most dev machines. For machines where the Prisma migration history itself is dirty, `npx prisma migrate reset --force` is the documented escape hatch.
- **No references to `user-demo-*` / `prop-demo-*` outside `prisma/`** were found in `src/` or `tests/` (grep confirmed), so blast radius is contained to the seed files, one unit test, and one new regression test.
- **Existing `tests/seed.test.ts`** fully mocks Prisma, which is why the original bug slipped through. The new regression test (US-005) deliberately goes against a real app instance to close that gap.

## 7. Success Metrics

- `GET /properties/search?landlordId={demo-landlord-uuid}` returns `200` immediately after a fresh seed.
- `/users/me` returns an `id` that passes `z.string().uuid().safeParse(...)` for all three demo roles (landlord, tenant, admin).
- Zero occurrences of `"Invalid uuid"` in backend logs when the frontend boots against the demo seed.
- New regression test (US-005) is green on `main` and fails deterministically if someone reintroduces a non-UUID id in the seed.
- No reduction in existing test coverage (all pre-existing tests still pass).

## 8. Open Questions

- Do we want to also seed a `RentalProcess` / `Proposal` / `Contract` demo row so those flows have an authenticated-landlord path to exercise end-to-end, or is `/properties/search` enough for this PRD? (Current scope: just `/properties/search`; the other endpoints are covered by the shared validator audit in US-004.)
- Should the UUID constants module live at `prisma/demoIds.ts` or `src/constants/demoIds.ts`? Current proposal keeps it alongside the seed under `prisma/` since the seed is its only runtime consumer. Open to moving it if tests from `src/` end up importing heavily.
- If the Riverpod retry loop on the frontend persists after `400`s become `200`s, do we open a follow-up PRD for a debounce on the notifier, or treat it as a frontend-only concern?
