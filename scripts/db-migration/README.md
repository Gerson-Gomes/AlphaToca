# Database Migration: Supabase → Local Postgres

Operator-facing entry point for the production cutover that moves the I-Moveis API
database off managed Supabase and onto a Postgres instance co-hosted with the API
on `desafio01.alphaedtech` (`10.10.0.201`).

Source PRD: [`tasks/prd-supabase-to-localhost-db-migration.md`](../../tasks/prd-supabase-to-localhost-db-migration.md).

> **Where these scripts run:** every script in this directory is intended to be
> executed on the production server `desafio01.alphaedtech` (over SSH), **not** on
> a developer workstation. Running them locally will either no-op or, in the case
> of `04-cutover-env.sh`, break your local `.env`. The dump step (`02-`) is the
> only one that can also run from another host with reachability to the Supabase
> direct endpoint.

## Overview

The cutover preserves 100% of the production data via `pg_dump` → `pg_restore`,
swaps the API's `DATABASE_URL`/`DIRECT_URL` to point at `127.0.0.1:5432`, and
keeps the Supabase project alive for at least 7 days as the rollback path.

Source database (current production):

- Host: `aws-1-us-west-2.pooler.supabase.com`
- Direct port (used for `pg_dump`): `5432`
- Pooler port (do **not** use for `pg_dump`): `6543`
- Supabase project ID: `qkmseleljscluhhrcpaz`

Target database (new production):

- Host: `127.0.0.1:5432` on `desafio01.alphaedtech`
- Role / database: `imoveis` / `imoveis`
- Listener bound to `localhost` only (UFW continues to block 5432 externally)

## Pre-flight Checks

Run these before opening the cutover window:

1. **Server capacity** — `free -h` and `df -h` on `desafio01` show enough headroom
   for Postgres + API + Redis on the same host.
2. **Source size** — record the Supabase database size so the local restore can
   be sanity-checked: `psql "$SUPABASE_DIRECT_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"`.
3. **Client version parity** — `pg_dump --version` on the dump host must be major
   version ≥ the Supabase server. Install `postgresql-client-16` if needed.
4. **Direct URL** — confirm `SUPABASE_DIRECT_URL` ends in `:5432`. Anything on
   `:6543` is the PgBouncer pooler and is incompatible with `pg_dump`.
5. **PM2 process name** — `pm2 list` to confirm the API process is named
   `alphatoca-backend` (or set `PM2_NAME` accordingly when running `04-`).
6. **Rollback runbook present** — [`documentation/runbook-rollback-supabase.md`](../../documentation/runbook-rollback-supabase.md)
   exists and the cutover/decommission dates have been filled in.
7. **Frontend independence** — confirm with the frontend team that no client
   talks to Supabase directly (Realtime/Storage/RLS). Per the PRD grep audit the
   backend is the only consumer, but verify before the window.

## Execution Order

Run the scripts in numeric order. Each script is idempotent or refuses to run
twice destructively — re-running on partial failure is safe.

| # | Script                                                       | Purpose                                                                                       |
|---|--------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| 1 | [`01-provision-postgres.sh`](./01-provision-postgres.sh)     | Install Postgres 16 via `apt` (PGDG), create role/db `imoveis`, lock listener to `localhost`. |
| 2 | [`02-dump-supabase.sh`](./02-dump-supabase.sh)               | `pg_dump --format=custom` from `SUPABASE_DIRECT_URL` (port 5432) into a timestamped file.     |
| 3 | [`03-restore-local.sh`](./03-restore-local.sh)               | Pre-create extensions, `pg_restore` into local Postgres, run row-count fidelity checks.       |
| 4 | [`04-cutover-env.sh`](./04-cutover-env.sh)                   | Back up `.env`, swap Supabase URLs for local, drop `SUPABASE_ACCESS_TOKEN`, `pm2 restart`.    |
| 5 | [`05-smoke-test.sh`](./05-smoke-test.sh)                     | Post-cutover health/Swagger/DB checks; non-zero exit if anything fails.                       |

Steps 1 and (optionally) 2 can run before the formal maintenance window. Steps
3–5 must run inside the window with the API stopped or in read-only mode.

## Rollback

If anything looks wrong after step 5 — or within 72 hours post-cutover — follow
the documented procedure in
[`documentation/runbook-rollback-supabase.md`](../../documentation/runbook-rollback-supabase.md).

The short version: SSH to `desafio01`, restore `.env` from the
`.env.pre-supabase-cutover.bak` backup created by `04-cutover-env.sh`, and
`pm2 restart alphatoca-backend --update-env`. Writes to the local Postgres
between cutover and rollback are lost — this is the accepted trade-off (NG-3 in
the PRD).

## Decommission Timeline

The Supabase project `qkmseleljscluhhrcpaz` must remain active for at least 7
days after the cutover so it can act as the rollback path. Do not cancel the
account, revoke the access token, or delete the project before then.

| Day | Milestone                                                                                |
|-----|------------------------------------------------------------------------------------------|
| 0   | Cutover executed; API serving from local Postgres; Supabase frozen but kept available.   |
| +7  | Decommission window opens. Supabase may be archived once 7 days of clean operation pass. |
| +14 | Decommission deadline. By this date the Supabase project is cancelled and tokens rotated.|

Record the actual cutover date alongside the corresponding `+7` and `+14`
calendar dates in
[`documentation/runbook-rollback-supabase.md`](../../documentation/runbook-rollback-supabase.md)
during step 4 of the cutover.
