# PRD: Landlord Backend Closeout (Epic LL)

**Created:** 2026-05-07
**Source:** `BACKEND_PENDENCIAS_LANDLORD.md`
**Scope decisions:**
- Full doc coverage (Prioridade A + B + C)
- Real-time via **WebSocket** (Socket.IO already initialized in `src/config/socket.ts`)
- **One migration per schema change** (safer rollback; no bundling)
- Numbering: new epic prefix **LL-001 → LL-022**

---

## 1. Introduction / Overview

The landlord (proprietário) UI currently falls back to mocked values, empty lists, and heuristic hacks in several screens because the corresponding backend endpoints, fields, or tables don't exist. US-001 → US-020 closed the first wave; this PRD closes the remaining gaps so every landlord screen consumes real data end-to-end.

Concretely, this epic delivers:
1. **Dashboard metrics & analytics** (profile views, pending proposals, monthly rentals/revenue charts).
2. **Per-property analytics** (views, favorites, proposals, daily series).
3. **Multi-month rent payment history** (not just current month).
4. **Conversation list + message CRUD** with real-time push over WebSocket.
5. **Contract document status + tenant identity verification** (stops heuristics mixing `property.status` with documental state).
6. **Visit source tagging** (MANUAL vs AI agent).
7. **Schema expansion**: 4 new property types, amenities (wifi/pool), transaction type.

---

## 2. Goals

- Remove every `—` / "Métrica ainda não disponível" placeholder from the landlord dashboard.
- Replace the `property.status → documentStatus` heuristic in `tenants_page.dart` with a real field.
- Deliver a first-class Chat experience (list, history, send, real-time inbound) so `/chat` stops showing "Nenhuma conversa".
- Preserve filter semantics on `GET /properties/search` after the schema expansion (KITNET/PENTHOUSE/LAND/COMMERCIAL, hasWifi/hasPool, transactionType must all be filterable).
- Keep every new endpoint JWT-protected and role-gated where the resource is landlord-owned.
- Maintain zero regression on US-001 → US-020: no renames, no breaking shape changes on currently consumed responses.

---

## 3. User Stories

> **Conventions:**
> - Every story ends with "Typecheck passes" + "Vitest suite passes" + "Route registered in `src/app.ts` (where applicable)".
> - Backend-only stories do **not** include browser verification (there's no frontend code in this repo).
> - Each DB change is its own migration (one `prisma migrate dev --name <...>` per story). Squashing is explicitly out of scope.

---

### Epic A — Dashboard Metrics & Analytics

#### LL-001: Profile view tracking table + increment hook
**Description:** As the backend, I need a `ProfileView` table so I can aggregate how many users opened a landlord's public profile in the last 30 days (dashboard "Visitas ao perfil" card).

**Acceptance Criteria:**
- [ ] New Prisma model `ProfileView { id, landlordId, viewerId?, viewedAt }` with index `(landlordId, viewedAt)`.
- [ ] Migration name: `add_profile_view`.
- [ ] New service method `profileViewService.record(landlordId, viewerId?)` — fire-and-forget (no await at call site); duplicates within the same 24h window for the same `viewerId` are deduplicated at write time (insert only if no row for that pair in 24h).
- [ ] Anonymous viewers (no JWT) pass `viewerId=null`; still recorded.
- [ ] Called from the existing public landlord-profile endpoint (locate via `grep "GET.*landlord.*:id" src/routes`). If no such endpoint exists, add a hook point in `propertyController.getPropertyById` when `?inspectLandlord=true`.
- [ ] Vitest: `profileViewService.test.ts` covers record + 24h-dedup + null-viewer paths.

#### LL-002: GET /api/landlord/metrics
**Description:** As a landlord, I want one endpoint that returns my top-card metrics in a single round trip.

**Acceptance Criteria:**
- [ ] `GET /api/landlord/metrics` → `{ profileViews: number, proposalsPending: number, unreadMessages: number }`.
- [ ] `profileViews`: COUNT of `ProfileView` rows for `landlordId = req.localUser.id` in the last 30 days.
- [ ] `proposalsPending`: COUNT of `Proposal` where `property.landlordId = req.localUser.id AND status = 'PENDING'`.
- [ ] `unreadMessages`: COUNT of messages (see LL-008 schema) authored by a tenant in a conversation where `landlordId = req.localUser.id AND readAt IS NULL`. Fallback to `0` if LL-008 not merged.
- [ ] Guards: `checkJwt → authSyncMiddleware → requireRole(Role.LANDLORD)`.
- [ ] Vitest: `landlordMetrics.test.ts` with 200 happy, 401 unauth, 403 non-landlord.

#### LL-003: Monthly aggregation view / query helper
**Description:** As the backend, I need an efficient aggregation over contracts + rental payments so the analytics endpoint responds <300ms at P95.

**Acceptance Criteria:**
- [ ] Raw-SQL query in `src/services/analyticsService.ts::monthlySeries(landlordId, from, to)` returning, per `YYYY-MM` in range:
  - `rentals`: COUNT of contracts with `startDate` in that month and `landlordId` match.
  - `newTenants`: COUNT distinct `tenantId` whose first contract with this landlord started in that month.
  - `monthlyRevenue`: SUM of `RentalPayment.amount` where `status = 'PAID'` for properties owned by `landlordId` in that `period`. Note: `RentalPayment` currently has no `amount` column — add it in this story (nullable, backfilled from `Contract.monthlyRent` via migration `add_rental_payment_amount`).
- [ ] Missing months are filled with zeros (never return gaps).
- [ ] Vitest: seed fixture with 3 months of data → assert shape and zero-fill.

#### LL-004: GET /api/properties/analytics/monthly
**Description:** As a landlord, I want the "Análise de Performance" charts back using real data.

**Acceptance Criteria:**
- [ ] `GET /api/properties/analytics/monthly?from=YYYY-MM-01&to=YYYY-MM-01` → `{ months: string[], rentals: number[], newTenants: number[], monthlyRevenue: number[] }` (arrays are parallel).
- [ ] `from` ≤ `to`; max span 24 months (400 otherwise).
- [ ] Defaults when query omitted: last 6 months ending in current month.
- [ ] Guards: JWT + `requireRole(Role.LANDLORD)`; delegates to `analyticsService.monthlySeries` from LL-003.
- [ ] Vitest: `propertiesAnalyticsMonthly.test.ts` with default range, custom range, oversized span, role gate.

---

### Epic B — Per-Property Analytics

#### LL-005: Property view event table
**Description:** As the backend, I need per-day property-view events so the analytics endpoint can return a daily series (not just a running counter).

**Acceptance Criteria:**
- [ ] New Prisma model `PropertyViewEvent { id, propertyId, viewerId?, viewedAt }` with index `(propertyId, viewedAt)`.
- [ ] Migration name: `add_property_view_event`.
- [ ] Existing `Property.views` counter is **kept** and still incremented (don't break existing consumers) — the new table adds granularity, it does not replace the counter.
- [ ] New method `propertyViewService.record(propertyId, viewerId?)`; 1h dedup by (propertyId, viewerId) when viewerId is non-null.
- [ ] Called from the existing `propertyController.getPropertyById` handler.
- [ ] Vitest: dedup and null-viewer coverage.

#### LL-006: GET /api/properties/:id/analytics
**Description:** As a landlord, I want real analytics per property (not the same mocked 142/23 for every listing).

**Acceptance Criteria:**
- [ ] `GET /api/properties/:id/analytics?window=30d|90d|1y` (default `30d`).
- [ ] Response shape: `{ views, favorites, proposalsTotal, proposalsOpen, visitsScheduled, contactClicks, dailyViews: [{date:'YYYY-MM-DD', count:number}] }`.
- [ ] Fields resolve from: `PropertyViewEvent` (views + dailyViews zero-filled), `Favorite`, `Proposal` (total + PENDING), `Visit` (SCHEDULED only).
- [ ] `contactClicks`: add a new `ContactClickEvent` table analogous to LL-005 + new endpoint `POST /api/properties/:id/contact-click` that clients call when the "Entrar em contato" button is pressed; anonymous tenants allowed. Migration `add_contact_click_event`.
- [ ] Authorization: only the landlord owner of the property receives 200; others → 403. Non-existent → 404.
- [ ] Vitest: `propertyAnalytics.test.ts` covers each window, zero-fill, ownership gate, 404.

---

### Epic C — Rent Payment History

#### LL-007: GET /api/properties/:propertyId/payments?tenantId=
**Description:** As a landlord viewing a tenant's financial history, I want the full multi-month payment list, not just the current month.

**Acceptance Criteria:**
- [ ] `GET /api/properties/:propertyId/payments?tenantId=<uuid>` returns **array** of `{ period: "YYYY-MM", amount: number, status: "PAID"|"AWAITING"|"LATE", paidAt: string|null }`.
- [ ] Rows come from `RentalPayment` for that `propertyId`. Join with `Contract` on (propertyId, tenantId, period-within-range) to filter to the tenant's tenure — rows outside the tenant's contract window are excluded.
- [ ] `amount` comes from the new `RentalPayment.amount` column introduced in LL-003.
- [ ] `paidAt` = `updatedAt` when `status = 'PAID'`, else `null`.
- [ ] Ordering: `period DESC`.
- [ ] Guards: JWT + ownership check (landlord owns property) → 200; else 403. Unknown property → 404. Missing/invalid `tenantId` → 400.
- [ ] Vitest: `rentalPaymentsList.test.ts`.

---

### Epic D — Chat Conversations & Messages

#### LL-008: Conversation message table
**Description:** As the backend, I need a message table tied to `Conversation` (not `ChatSession`, which is the WhatsApp RAG flow) so the in-app chat can persist messages.

**Acceptance Criteria:**
- [ ] New Prisma model `ConversationMessage { id, conversationId, authorId, content @db.Text, createdAt, readAt? }` with index `(conversationId, createdAt)` and `(conversationId, readAt)`.
- [ ] `Conversation` gets an inverse relation `messages ConversationMessage[]`.
- [ ] Migration name: `add_conversation_message`.
- [ ] Naming rationale (document in migration SQL header): kept distinct from existing `Message` model because `Message.sessionId` is `ChatSession` — fusing them would force nullable session/conversation FKs and confuse the RAG worker that scans `messages`.
- [ ] Vitest: model round-trip test in `conversationMessage.test.ts`.

#### LL-009: GET /api/conversations
**Description:** As any authenticated user, I want to list my active conversations so `/chat` renders a real inbox.

**Acceptance Criteria:**
- [ ] `GET /api/conversations?unreadOnly=true` (flag optional, default false).
- [ ] Response: array of `{ id, counterpartName, counterpartAvatarUrl, lastMessage, lastMessageAt, unread: boolean, linkedPropertyId, linkedTenantId }`.
- [ ] Caller's role decides direction: LANDLORD sees tenants as counterparts (`linkedTenantId = tenant.id`); TENANT sees landlords.
- [ ] `lastMessage` / `lastMessageAt` come from the most recent `ConversationMessage`; conversations with zero messages still appear (lastMessage = `null`, lastMessageAt = `conversation.createdAt`).
- [ ] `unread = true` iff there exists a `ConversationMessage` in the conversation with `authorId != localUser.id AND readAt IS NULL`.
- [ ] Ordering: `lastMessageAt DESC` (fallback to `createdAt`).
- [ ] `counterpartAvatarUrl`: if the schema has no avatar field, return `null` (don't block on adding one here).
- [ ] Guards: `checkJwt + authSyncMiddleware`; no role gate (tenants and landlords both use this).
- [ ] Vitest: `conversationList.test.ts` — landlord view, tenant view, unreadOnly filter, empty-conversation edge case.

#### LL-010: GET /api/conversations/:id/messages
**Description:** As a conversation participant, I want to load the message history with cursor-based pagination.

**Acceptance Criteria:**
- [ ] `GET /api/conversations/:id/messages?before=<messageId>&limit=50` (limit 1..100, default 50).
- [ ] Response: array of `{ id, authorId, content, createdAt, readAt }` ordered `createdAt ASC` within the page; the **page** itself is the 50 items older than `before` (or the latest 50 when `before` absent).
- [ ] 403 if caller is neither `conversation.landlordId` nor `conversation.tenantId`.
- [ ] 404 if conversation missing (before 403, to avoid leaking existence to non-participants: return 404 for both missing and unauthorized — document this in the handler).
- [ ] As a side effect, set `readAt = now()` on messages in the returned page where `authorId != localUser.id AND readAt IS NULL`.
- [ ] Vitest: `conversationMessages.test.ts` — pagination, read-receipt side effect, authorization.

#### LL-011: POST /api/conversations/:id/messages
**Description:** As a conversation participant, I want to send a message.

**Acceptance Criteria:**
- [ ] `POST /api/conversations/:id/messages` body `{ content: string }` (1..4000 chars, Zod-validated).
- [ ] Creates a `ConversationMessage` with `authorId = localUser.id`, returns 201 + full message object.
- [ ] 403 if not a participant. 404 if missing (same ambiguity rule as LL-010).
- [ ] Vitest: happy path, validation, authorization.

#### LL-012: WebSocket push on new conversation message
**Description:** As a participant, I want new messages to arrive over WebSocket so I don't have to poll.

**Acceptance Criteria:**
- [ ] New service `conversationSocketService.emitNewMessage(conversation, message)` modelled on `chatSocketService` (`src/services/chatSocketService.ts`).
- [ ] Emits event `conversation:new_message` with payload `{ conversationId, message }` to rooms `user:${landlordId}` and `user:${tenantId}`.
- [ ] Called from the POST handler in LL-011 **after** the DB write succeeds (never emit for a message that wasn't persisted).
- [ ] Also emit `conversation:message_read` to the other participant's room when LL-010's side-effect flips `readAt` (batched once per request — one event with `{ conversationId, messageIds: [...] }`).
- [ ] Manual smoke test documented in PR: connect two socket.io clients with different JWTs, POST, observe event on the other client.
- [ ] Vitest: mock `getIO()` and assert `emit` was called with the right room + event name.

#### LL-013: Mark-all-as-read endpoint (fallback for reconnect scenarios)
**Description:** As a client recovering from a socket drop, I want an explicit "I opened the conversation, mark everything read" call that doesn't require fetching pages.

**Acceptance Criteria:**
- [ ] `POST /api/conversations/:id/read` (no body). Sets `readAt = now()` on every unread message in the conversation where `authorId != localUser.id`.
- [ ] Emits `conversation:message_read` with the list of updated ids (reuse LL-012 emitter).
- [ ] 403/404 rules match LL-010.
- [ ] Vitest: `conversationMarkRead.test.ts`.

---

### Epic E — Contract Document Status & Identity Verification

#### LL-014: Contract.documentStatus
**Description:** As a landlord on "Meus Inquilinos", I want the chip to reflect documental state, not a heuristic over `property.status`.

**Acceptance Criteria:**
- [ ] New enum `ContractDocumentStatus { PENDING_DOCUMENTS, AWAITING_SIGNATURE, APPROVED }`.
- [ ] Column `Contract.documentStatus ContractDocumentStatus @default(PENDING_DOCUMENTS)`.
- [ ] Migration name: `add_contract_document_status`. Backfill existing rows: `APPROVED` when `signedAt IS NOT NULL`, else `PENDING_DOCUMENTS`.
- [ ] Exposed in every existing `Contract` response (check `contractController.ts` and `GET /api/contracts` variants).
- [ ] New endpoint `PATCH /api/contracts/:id/document-status` with body `{ documentStatus }`, guarded by JWT + landlord ownership. Emits no socket event for now.
- [ ] Vitest: `contractDocumentStatus.test.ts` + assert backfill in migration test.

#### LL-015: User identity verification fields
**Description:** As a landlord, I want to see the ✓ dourado again when a tenant is identity-verified.

**Acceptance Criteria:**
- [ ] Columns `User.isIdentityVerified Boolean @default(false)` and `User.identityVerifiedAt DateTime?`.
- [ ] Migration name: `add_user_identity_verification`.
- [ ] Exposed in every existing user response shape (spot-check `userController.ts`, `propertyController` where `currentTenant` is expanded, `conversationController`).
- [ ] No new endpoint to flip the flag in this story — admin tooling is out of scope; the field is writable only via Prisma Studio / seed for now. Document this explicitly in the migration SQL header.
- [ ] Vitest: `userIdentityVerification.test.ts` — response shape and default=false.

---

### Epic F — Visit Source

#### LL-016: Visit.source (MANUAL / AI)
**Description:** As the landlord calendar, I want to visually distinguish visits scheduled by the AI agent vs. by humans.

**Acceptance Criteria:**
- [ ] New enum `VisitSource { MANUAL, AI }`.
- [ ] Column `Visit.source VisitSource @default(MANUAL)`.
- [ ] Migration name: `add_visit_source`.
- [ ] Field included in every `Visit` response (check `visitController` list + detail handlers).
- [ ] `POST /api/visits` defaults to `MANUAL` for human callers. AI agent flow (if it exists — grep for `leadExtractionService` callers) writes `AI` explicitly.
- [ ] Vitest: `visitSource.test.ts` — default and explicit write.
- [ ] Reference: `BACKEND_VISIT_SOURCE.md` (pre-existing design doc — align with it).

---

### Epic G — Property Schema Expansion

#### LL-017: PropertyType enum +4 values (migration)
**Description:** As a landlord creating a listing, I want all 8 types from the UI to be valid in the backend.

**Acceptance Criteria:**
- [ ] Extend `PropertyType` with `KITNET, PENTHOUSE, LAND, COMMERCIAL`.
- [ ] Migration name: `add_property_type_extended_values`.
- [ ] Existing rows untouched (enum value additions only).
- [ ] Vitest: create a Property with each new type + read back.

#### LL-018: Search filter accepts new property types
**Description:** As a tenant filtering search, I want to filter by KITNET / PENTHOUSE / LAND / COMMERCIAL.

**Acceptance Criteria:**
- [ ] `GET /api/properties/search?type=KITNET` etc. returns correctly filtered results.
- [ ] Zod schema for the `type` query param includes the 4 new values.
- [ ] Vitest: seed one property per type + assert filter returns just that row.
- [ ] Depends on LL-017.

#### LL-019: Property amenities columns (migration)
**Description:** As a landlord, I want wifi and pool checkboxes to persist.

**Acceptance Criteria:**
- [ ] Columns `Property.hasWifi Boolean @default(false)` and `Property.hasPool Boolean @default(false)`.
- [ ] Migration name: `add_property_amenities`.
- [ ] Vitest: round-trip via Prisma.

#### LL-020: Amenity support in create/update/search
**Description:** As a landlord and tenant, I want `hasWifi` and `hasPool` to flow through POST, PUT, and search.

**Acceptance Criteria:**
- [ ] `POST /api/properties` and `PUT /api/properties/:id` accept both fields (Zod schemas updated).
- [ ] `GET /api/properties/search?hasWifi=true&hasPool=true` filters correctly; omitted flags don't filter.
- [ ] Multipart variant (`propertyUpdateMultipart`) also forwards these fields — see existing test `propertyUpdateMultipart.test.ts` for shape.
- [ ] Vitest: create/read/filter.
- [ ] Depends on LL-019.

#### LL-021: Property.transactionType column (migration)
**Description:** As the backend, I need to distinguish rentals, sales, and pre-launches so the UI's transactionType filter stops being cosmetic.

**Acceptance Criteria:**
- [ ] New enum `TransactionType { RENTAL, SALE, PRE_LAUNCH }`.
- [ ] Column `Property.transactionType TransactionType @default(RENTAL)`.
- [ ] Migration name: `add_property_transaction_type`. Existing rows default to `RENTAL`.
- [ ] Vitest: enum values + default.

#### LL-022: transactionType support in create/update/search
**Description:** As a tenant, I want to filter by Aluguel / Venda / Lançamento.

**Acceptance Criteria:**
- [ ] `POST /api/properties` and `PUT /api/properties/:id` accept `transactionType`.
- [ ] `GET /api/properties/search?transactionType=SALE` filters correctly.
- [ ] Vitest: filter by each value.
- [ ] Depends on LL-021.

---

## 4. Functional Requirements

### General

- **FR-1:** Every new endpoint is registered in `src/app.ts` under the existing `/api` prefix.
- **FR-2:** Every endpoint passes through `checkJwt → authSyncMiddleware` before the handler unless explicitly listed as public.
- **FR-3:** Landlord-scoped endpoints use `requireRole(Role.LANDLORD)` OR an inline ownership check — never both.
- **FR-4:** Zod schemas live under `src/utils/*Validation.ts` matching the existing convention (see `conversationValidation.ts`).
- **FR-5:** Each story produces exactly one Prisma migration (named per the story). No two stories share a migration.
- **FR-6:** No renames of existing response fields; this epic is additive for already-consumed US-001→US-020 shapes.

### Dashboard (LL-001 → LL-004)

- **FR-7:** `GET /api/landlord/metrics` rolls up a 30-day window for profileViews.
- **FR-8:** `GET /api/properties/analytics/monthly` default range is the last 6 months (inclusive of current).
- **FR-9:** Monthly aggregation fills gap months with zeros — the arrays `months`, `rentals`, `newTenants`, `monthlyRevenue` always have the same length.

### Per-property analytics (LL-005 → LL-006)

- **FR-10:** `dailyViews` is zero-filled across the `window` range.
- **FR-11:** `contactClicks` comes from a new `ContactClickEvent` table populated by `POST /api/properties/:id/contact-click`.
- **FR-12:** Existing `Property.views` counter is preserved for backward compatibility; it MUST keep incrementing alongside `PropertyViewEvent` writes.

### Chat (LL-008 → LL-013)

- **FR-13:** `ConversationMessage` is a **separate model** from `Message` (the WhatsApp/RAG one). They do not share a table.
- **FR-14:** Read receipts are set as a **side effect** of loading messages (LL-010) or via the explicit LL-013 endpoint.
- **FR-15:** Socket events emitted: `conversation:new_message`, `conversation:message_read`. Rooms: `user:${id}` (existing pattern from `chatSocketService`).
- **FR-16:** 404 is preferred over 403 for non-participant access to a specific conversation, to avoid leaking existence.

### Tenant profile fields (LL-014 → LL-015)

- **FR-17:** `Contract.documentStatus` backfills existing rows to `APPROVED` iff `signedAt IS NOT NULL`.
- **FR-18:** `User.isIdentityVerified` defaults to `false` and has no setter endpoint in this epic (admin tooling out of scope).

### Property schema (LL-017 → LL-022)

- **FR-19:** All three schema expansions (PropertyType values, amenities, transactionType) are **additive**: existing rows remain valid without touching them.
- **FR-20:** Every new column surfaces in `POST /api/properties`, `PUT /api/properties/:id`, `PUT /api/properties/:id` multipart, and `GET /api/properties/search` filters.

---

## 5. Non-Goals (Out of Scope)

- **Frontend work.** This is a backend-only PRD. The Flutter app integration is tracked separately (see `INTEGRACAO_BACKEND_2026-05-07.md`).
- **Admin support panel frontend** (covered in `BACKEND_PENDENCIAS_LANDLORD.md` §8 — backend already done via US-017→US-020).
- **Identity verification workflow.** LL-015 only adds the fields; the KYC process, admin approval UI, and verification API integration are a separate epic.
- **AI agent visit creation flow.** LL-016 adds the `source` field; wiring the agent to write `AI` is an AI-team concern.
- **Avatar upload / `User.avatarUrl`.** LL-009 returns `null` when the field is absent; adding it is out of scope.
- **Migration squashing or data-model refactors** beyond the listed additive changes.
- **Rate limiting.** Assume `express-rate-limit` global config is sufficient; no per-endpoint limits introduced here.
- **Notification fan-out on new message.** LL-012 only pushes via WebSocket; push notifications / emails are out of scope (would reuse `pushNotificationService` in a follow-up).

---

## 6. Technical Considerations

### Reuse points

- **Auth:** `src/middlewares/authMiddleware.ts::{checkJwt, authSyncMiddleware, requireRole}`.
- **WebSocket:** `src/config/socket.ts::getIO()` + `src/services/chatSocketService.ts` as the pattern template.
- **Prisma client:** `src/config/db.ts` (grep for `prisma` import).
- **Validation:** `src/utils/conversationValidation.ts` is the Zod reference style.
- **Tests:** Vitest; each new endpoint gets a sibling `*.test.ts` under `tests/`.

### Database impact

- 7 new tables/enums, 3 additive columns on `Property`, 1 on `Contract`, 1 on `Visit`, 2 on `User`, 1 on `RentalPayment`. Each is a separate migration (13 migrations total across the epic).
- Existing indexes are untouched; new indexes:
  - `(landlordId, viewedAt)` on `ProfileView`
  - `(propertyId, viewedAt)` on `PropertyViewEvent`
  - `(propertyId, viewedAt)` on `ContactClickEvent`
  - `(conversationId, createdAt)` and `(conversationId, readAt)` on `ConversationMessage`

### Performance targets (informal, verify at review)

- `GET /api/landlord/metrics`: P95 < 150 ms (three lightweight COUNTs).
- `GET /api/properties/analytics/monthly`: P95 < 300 ms for default 6-month range.
- `GET /api/conversations`: P95 < 250 ms for < 100 conversations.
- `GET /api/conversations/:id/messages`: P95 < 200 ms per 50-message page.

### Order of implementation (recommended, not mandatory)

1. **Foundation:** LL-001, LL-005 (tracking tables — unblock dashboard and per-property analytics).
2. **Dashboard:** LL-003 → LL-004 → LL-002.
3. **Per-property:** LL-006.
4. **Rent history:** LL-007 (depends on LL-003 `amount` column).
5. **Chat:** LL-008 → LL-009 → LL-010 → LL-011 → LL-012 → LL-013.
6. **Tenant profile:** LL-014 → LL-015 (independent, can be parallel to Chat).
7. **Visits:** LL-016 (independent).
8. **Property schema:** LL-017 → LL-018, LL-019 → LL-020, LL-021 → LL-022 (three independent pairs).

Epics E, F, G can run in parallel with A/B/C/D once migrations are staged on a migration-sequencing agreement.

---

## 7. Success Metrics

- **Frontend placeholder removal:** After integration, `grep "Métrica ainda não disponível\|Sem mensagens ainda.\|document_status_heuristic" app/lib/` returns zero hits.
- **Test suite:** All new `tests/*.test.ts` pass; coverage on new files ≥ 70%.
- **Regression check:** US-001 → US-020 test suite remains green after the migration stack lands.
- **Endpoint coverage:** Every row in §9 of `BACKEND_PENDENCIAS_LANDLORD.md` has at least one LL story that closes it.

---

## 8. Open Questions

1. **Profile-view endpoint location.** Does a dedicated `GET /api/landlord/:id` public endpoint already exist, or is the view-tracking hook attached to the property detail endpoint with `?inspectLandlord=true`? LL-001 assumes the latter as fallback — needs one-line confirmation before implementation.
2. **`RentalPayment.amount` backfill semantics.** LL-003 proposes backfilling from `Contract.monthlyRent`. What happens when a property had rent changes mid-tenure (no historical `monthlyRent` snapshot)? Proposed: backfill to the current `monthlyRent` and accept imprecision for historical rows — flag as "best-effort pre-LL-003 data" in the migration SQL comment.
3. **Admin API for `User.isIdentityVerified`.** LL-015 deliberately omits the setter. Is there an admin tool (Retool, internal dashboard) that expects a REST endpoint for this? If yes, split it into LL-015a (field) and LL-015b (admin endpoint + audit log).
4. **`transactionType` vs existing pricing.** `Property.price` is decimal — for `SALE` and `PRE_LAUNCH`, is this the same column, or do we need `salePrice` separately? This PRD assumes the same column; confirm with product before LL-021.
5. **Socket room for ADMIN observers.** `chatSocketService` emits to `provider:all` for ADMIN visibility. Should `conversationSocketService` (LL-012) do the same? Current draft does **not** — admins aren't party to user-to-user threads.
6. **Message edit / delete.** Not in this PRD. Confirm acceptable as follow-up.
