# Runbook — Rollback to Supabase

Operator runbook for reverting the I-Moveis API from local Postgres back to the
managed Supabase project in case the local instance exhibits a critical issue
within the first 72 hours after cutover.

**Audience:** the on-call operator with SSH access to
`desafio01@desafio01.alphaedtech` (`10.10.0.201`). This runbook is read by a
human under pressure — keep it short, keep the commands copy-pasteable, and do
not assume the reader has the source PRD open in another tab.

Source PRD: [`tasks/prd-supabase-to-localhost-db-migration.md`](../tasks/prd-supabase-to-localhost-db-migration.md) (US-007, NG-3, NG-7).

Sibling cutover scripts: [`scripts/db-migration/README.md`](../scripts/db-migration/README.md).

---

## Pre-requisites

The rollback path only works while the Supabase project is still alive. Confirm
the following BEFORE attempting any step:

- **Supabase project `qkmseleljscluhhrcpaz` is still active** — log into the
  Supabase dashboard and verify the project is not paused, archived, or
  deleted. The cutover plan retains this project for **at least 7 days**
  (NG-7); rolling back outside that window is not supported by this runbook.
- **`.env.pre-supabase-cutover.bak` exists** on the production server in the
  API directory. This is the file `04-cutover-env.sh` wrote during cutover and
  is the only known-good snapshot of the pre-cutover environment. If it is
  missing, **stop** and escalate — see Post-rollback below.
- **No frontend client talks to Supabase Realtime/Storage/RLS directly.**
  Per the PRD audit the backend is the only Supabase consumer, but a fresh
  `grep` of the deployed frontend is cheap insurance before flipping back.
- **You have the original `SUPABASE_ACCESS_TOKEN`** somewhere safe (password
  manager / secret store). The cutover deliberately stripped it from `.env`;
  if it was rotated post-cutover, the rolled-back API will not start cleanly
  until you restore a working token.

### Cutover and decommission dates

Fill these in during step 4 of the cutover and keep this runbook updated:

- **Cutover date (Day 0):** `__________` (UTC, e.g., `2026-05-09`)
- **Decommission window opens (Day +7):** `__________`
- **Decommission deadline (Day +14):** `__________`

Past the decommission deadline this runbook is no longer guaranteed to work —
the Supabase project may be cancelled and tokens rotated. After Day 7, treat
the local Postgres as the only source of truth and write a forward-recovery
plan instead of rolling back.

---

## When to roll back

Roll back only when one of these conditions holds and the issue cannot be
resolved in less than the rollback window itself (~10 minutes). The bar is
deliberately high — every minute spent on local Postgres after cutover is
data that NG-3 says we lose on rollback.

| Trigger | Threshold |
|---------|-----------|
| Local Postgres unreachable from the API | > 5 minutes continuous, after a `pm2 restart` failed to recover it |
| Data corruption detected | Any reproducible read returning corrupted/garbled rows from the local Postgres |
| Query latency regression | p95 latency > 10× the Supabase baseline for the same query, sustained > 10 minutes |
| Disk-full on `desafio01` blocking writes | `df -h /var/lib/postgresql` at 100% with no recoverable headroom |
| Critical schema mismatch surfaced post-restore | `npx prisma migrate status` reports drift that 03-restore-local.sh missed and that blocks the API from starting |
| Authentication / role failure | API consistently fails to authenticate against the local DB and the password rotation procedure does not fix it within the rollback window |

**Do NOT roll back for:**

- Transient `ECONNREFUSED` that recovers within 1–2 minutes (often pm2 restart
  noise).
- Slow queries that have a known optimization path (add an index, etc.) — fix
  forward.
- Cosmetic log noise (`pgaudit` / Supabase-only extension warnings) — these
  are expected per the PRD; see the Codebase Patterns in the cutover scripts.

---

## Procedure

Estimated wall-clock: 5–10 minutes from "decision to roll back" to "API back
on Supabase". Announce in `#engineering` BEFORE you start so writes from any
human-driven workflow can stop.

1. **SSH to the production server.**

   ```bash
   ssh desafio01@desafio01.alphaedtech
   ```

2. **Change into the API directory** (the directory containing `package.json`
   and the `.env` you need to restore — typically `/opt/imoveis-backend` or
   wherever PM2 was started from).

   ```bash
   cd /opt/imoveis-backend   # adjust to the actual deploy path
   ```

   Verify you are in the right place:

   ```bash
   ls -la .env .env.pre-supabase-cutover.bak package.json
   ```

   All three files must exist. If `.env.pre-supabase-cutover.bak` is missing,
   **stop** and follow Post-rollback → "Backup missing" below.

3. **Restore `.env` from the pre-cutover backup.** Keep a copy of the current
   (broken) `.env` for forensics — do not just overwrite it.

   ```bash
   cp -p .env ".env.broken-$(date -u +%Y%m%dT%H%M%SZ)"
   cp -p .env.pre-supabase-cutover.bak .env
   ```

   Sanity-check that the restored `.env` points at Supabase again:

   ```bash
   grep -E '^(DATABASE_URL|DIRECT_URL|SUPABASE_ACCESS_TOKEN)=' .env
   ```

   You should see the Supabase pooler/direct URLs and the
   `SUPABASE_ACCESS_TOKEN` line back in place.

4. **Restart the API via PM2 with the restored env.**

   ```bash
   pm2 restart alphatoca-backend --update-env
   ```

   The `--update-env` flag is essential — without it PM2 keeps the cutover-era
   environment in memory and the rollback is silently no-op.

5. **Validate the health endpoint.**

   ```bash
   curl -fsS http://localhost:3000/health
   ```

   Expected: HTTP 200 with a small JSON body. If `curl` errors or returns
   non-2xx, jump to step 6 to read the logs before declaring failure.

6. **Inspect the last 100 lines of the API log** for clean startup against
   Supabase.

   ```bash
   pm2 logs alphatoca-backend --lines 100 --nostream
   ```

   What "clean" looks like:

   - No `PrismaClientInitializationError`.
   - No `ECONNREFUSED` against `127.0.0.1:5432` (you are no longer talking to
     local Postgres — anything pointing there means `.env` was not actually
     restored).
   - The startup banner shows the API listening on its expected port.

   If the logs show the API is still trying to reach `127.0.0.1:5432`, repeat
   step 4 — PM2 sometimes needs the explicit `--update-env` flag a second
   time, or the operator restored the wrong `.env` snapshot.

7. **Announce rollback complete in `#engineering`** with the timestamp, the
   trigger from "When to roll back", and a link to this runbook. Then proceed
   to Post-rollback.

---

## Data Loss Warning

**Every write committed to the local Postgres between cutover (Day 0) and the
moment of rollback is permanently lost when you complete this procedure.**

This is the explicit trade-off accepted in the source PRD as **NG-3**: we do
not maintain bidirectional sync between Supabase and local Postgres after
cutover. Reverting `.env` simply re-points the API at the still-frozen
Supabase project; nothing replays the deltas from the local instance.

Implications you must communicate in your incident report:

- Any user that signed up, any property created, any conversation message
  sent, any rental process advanced — all between Day 0 and rollback —
  **does not exist** in the rolled-back system.
- Idempotency keys / external integrations (Stripe charges, WhatsApp message
  IDs, etc.) generated during the local-Postgres window may now collide on
  retry against Supabase. Account for this when triaging webhook failures
  after rollback.
- The local Postgres dump from `02-dump-supabase.sh` is **not** a usable
  recovery artefact for these deltas — it represents the pre-cutover state,
  not the post-cutover writes.

If the lost-writes window is unacceptable for the specific incident, **do not
roll back**. Fix forward instead and escalate.

---

## Post-rollback

Once steps 1–7 are complete and `#engineering` has been notified:

1. **File an incident report.** Use the standard incident template; required
   fields:

   - Trigger that justified rollback (matched against the table above).
   - Timeline: cutover timestamp, first symptom, rollback decision, rollback
     completion.
   - Estimated lost-write window and the data domains affected (users,
     properties, conversations, etc.) — pull row deltas from the local
     Postgres before the host is reclaimed if useful for the report.
   - Root cause hypothesis and the forensic artefacts you preserved
     (`.env.broken-*`, `pm2 logs` snapshot, the local Postgres data dir).

2. **Post in `#engineering`** with a one-paragraph summary linking the
   incident report and this runbook. Tag the platform on-call and the PRD
   author.

3. **Freeze further migration attempts.** Do not re-attempt cutover until:

   - The incident report is closed with a documented root cause.
   - A remediation plan is reviewed (typically by the operator + PRD author +
     a second engineer).
   - The rollback runbook is updated with whatever lesson the incident
     surfaced — every rollback is also a runbook bug report.

4. **Preserve forensics.** Do not run `pg_dropdb imoveis` or `apt purge
   postgresql-16` on `desafio01` until the root cause is understood. The
   local data dir is the only record of the lost-writes window.

### Backup missing

If step 2 surfaces that `.env.pre-supabase-cutover.bak` does not exist, the
automated rollback path is unavailable. Reconstruct `.env` manually:

1. Pull the most recent pre-cutover `.env` from your secret store
   (1Password / Vault / wherever the deploy secret lives).
2. Confirm it contains `DATABASE_URL` / `DIRECT_URL` pointing at
   `aws-1-us-west-2.pooler.supabase.com` and a non-revoked
   `SUPABASE_ACCESS_TOKEN`.
3. Resume from step 4 of the Procedure.

If no pre-cutover `.env` exists anywhere, escalate immediately — neither
forward nor backward recovery is automatic at that point.

---

## Decommission Timeline

The Supabase project `qkmseleljscluhhrcpaz` is the rollback safety net. Do
not cancel the account, revoke the access token, or delete the project until
the decommission deadline has passed and at least 7 days of clean local-Postgres
operation are on the record.

| Day | Date (fill in) | Milestone                                                                                |
|-----|----------------|------------------------------------------------------------------------------------------|
| 0   | `__________`   | Cutover executed; API serving from local Postgres; Supabase frozen but kept available.   |
| +7  | `__________`   | Decommission window opens. Supabase may be archived once 7 days of clean operation pass. |
| +14 | `__________`   | Decommission deadline. By this date the Supabase project is cancelled and tokens rotated.|

Update the dates in this table during step 4 of the cutover (the same
operator action that runs `04-cutover-env.sh`).
