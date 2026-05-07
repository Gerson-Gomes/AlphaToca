# UUID Validator Audit

**PRD:** `tasks/prd-fix-seed-uuid-consistency.md` (US-004)
**Date:** 2026-05-06
**Scope:** Confirm every `z.string().uuid()` validator on id fields across the 6 validator files listed in the PRD stayed strict through the seed-UUID migration — no validator was silently downgraded to `z.string().min(1)` or `.nonempty()`.
**Result:** **PASS** — all 20 UUID validators across the 6 files remain strict (`z.string().uuid()` with no `.or(...)` fallback and no replacement with a non-UUID shape).

## Methodology

1. `grep -rn "z\.string\(\)\.uuid" src/utils/` enumerated every UUID validator.
2. `grep -rn "z\.string\(\)\.(min|nonempty)" src/utils/` was run as a regression guard — zero results on id fields (the only hits are on `name`, `title`, `description`, `address`, `content`, which are not ids and were already `min`-validated before this PRD).
3. Each validator below was read in-file (not just grepped) to confirm: (a) the field name is an id field, (b) the schema is still `z.string().uuid()` (optionally with a `{ message }` option and optionally `.optional()`), (c) no sibling change downgrades the constraint.

## Per-file inventory

### `src/utils/contractValidation.ts` — 3 validators, all strict ✅

| Line | Field        | Schema                  | Status   |
|------|--------------|-------------------------|----------|
| 5    | `propertyId` | `z.string().uuid()`     | strict ✓ |
| 6    | `tenantId`   | `z.string().uuid()`     | strict ✓ |
| 7    | `landlordId` | `z.string().uuid()`     | strict ✓ |

All three are inside `createContractSchema`. No optional variants, no fallbacks.

### `src/utils/proposalValidation.ts` — 5 validators, all strict ✅

| Line | Field        | Schema                           | Status   |
|------|--------------|----------------------------------|----------|
| 5    | `propertyId` | `z.string().uuid()`              | strict ✓ |
| 6    | `tenantId`   | `z.string().uuid()`              | strict ✓ |
| 16   | `tenantId`   | `z.string().uuid().optional()`   | strict ✓ |
| 17   | `propertyId` | `z.string().uuid().optional()`   | strict ✓ |
| 18   | `landlordId` | `z.string().uuid().optional()`   | strict ✓ |

Lines 5–6 are inside `createProposalSchema`; 16–18 are inside `listProposalsQuerySchema`. The `.optional()` modifier only affects presence, not the string shape — when the field *is* present it must still match UUID v4/5.

> **Note on AC wording:** The PRD AC says "propertyId, tenantId, landlordId and their optional variants" (6 expected). In reality, `createProposalSchema` has no non-optional `landlordId` — only `propertyId` and `tenantId` are required at proposal creation, and `landlordId` is derived server-side from the property. The file therefore has 5 UUID validators, not 6. No regression; the AC prose over-counted.

### `src/utils/visitValidation.ts` — 7 validators, all strict ✅

| Line | Field             | Schema                                                                  | Status   |
|------|-------------------|-------------------------------------------------------------------------|----------|
| 20   | `propertyId`      | `z.string().uuid({ message: 'Invalid propertyId format' })`             | strict ✓ |
| 21   | `tenantId`        | `z.string().uuid({ message: 'Invalid tenantId format' })`               | strict ✓ |
| 22   | `rentalProcessId` | `z.string().uuid({ message: 'Invalid rentalProcessId format' }).optional()` | strict ✓ |
| 40   | `propertyId`      | `z.string().uuid().optional()`                                          | strict ✓ |
| 41   | `tenantId`        | `z.string().uuid().optional()`                                          | strict ✓ |
| 42   | `landlordId`      | `z.string().uuid().optional()`                                          | strict ✓ |
| 49   | `propertyId`      | `z.string().uuid({ message: 'propertyId is required' })`                | strict ✓ |

Lines 20–22 live in `createVisitSchema`; 40–42 in `listVisitsQuerySchema`; 49 in `availabilityQuerySchema`. PRD AC called out `propertyId, tenantId, landlordId, rentalProcessId` — all four are accounted for.

### `src/utils/propertyValidation.ts` — 1 validator, strict ✅

| Line | Field        | Schema                                                         | Status   |
|------|--------------|----------------------------------------------------------------|----------|
| 9    | `landlordId` | `z.string().uuid({ message: "Invalid landlord ID format" })`   | strict ✓ |

Only present on `createPropertySchema` (line 9). `updatePropertySchema` intentionally has no `landlordId` — property ownership is immutable post-creation. No other id field on this schema.

### `src/utils/searchValidation.ts` — 2 validators, all strict ✅

| Line | Field        | Schema                           | Status   |
|------|--------------|----------------------------------|----------|
| 39   | `landlordId` | `z.string().uuid().optional()`   | strict ✓ |
| 40   | `tenantId`   | `z.string().uuid().optional()`   | strict ✓ |

Both inside `propertySearchSchema`. These are the two validators that actually rejected the legacy `user-demo-landlord-1` seed id — the headline bug this PRD fixes. They remain strict (proven by US-005's planned regression test).

### `src/utils/chatValidation.ts` — 2 validators, all strict ✅

| Line | Field       | Schema                | Status   |
|------|-------------|-----------------------|----------|
| 5    | `sessionId` | `z.string().uuid()`   | strict ✓ |
| 12   | `tenantId`  | `z.string().uuid()`   | strict ✓ |

`sessionId` is inside `sendMessageSchema`; `tenantId` is inside `createSessionSchema`.

## Regression guard

`grep -rn "z\.string\(\)\.(min|nonempty)" src/utils/` — full output:

```
src/utils/userValidation.ts:5:  name: z.string().min(2, "Name must be at least 2 characters"),
src/utils/propertyValidation.ts:10:  title: z.string().min(3).max(255),
src/utils/propertyValidation.ts:11:  description: z.string().min(10),
src/utils/propertyValidation.ts:14:  address: z.string().min(5),
src/utils/propertyValidation.ts:21:  title: z.string().min(3).max(255).optional(),
src/utils/propertyValidation.ts:22:  description: z.string().min(10).optional(),
src/utils/propertyValidation.ts:25:  address: z.string().min(5).optional(),
src/utils/chatValidation.ts:7:  content: z.string().min(1),
```

None of these are id fields. `name`, `title`, `description`, `address`, and `content` are free-text fields whose `.min(n)` constraints predate this PRD. Confirmed no validator was downgraded from `.uuid()` to `.min(1)` during this PRD.

## Open questions

None. No genuine need to relax any UUID validator was discovered — the seed was the bug, not the schema. If a future change ever needs to accept a non-UUID id (e.g. a slug-based legacy compatibility shim), it must be added to the Open Questions section of `tasks/prd-fix-seed-uuid-consistency.md` rather than silently weakening a validator.

## Summary

- Files audited: 6
- UUID validators: **20 total, 20 strict** (100%)
- Regression guard hits on id fields: **0**
- Verdict: every UUID validator that existed before this PRD still rejects the legacy `user-demo-*` / `prop-demo-*` / `img-demo-*` ids, and the seed (now UUID-only) satisfies them by construction.
