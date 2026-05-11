#!/usr/bin/env bash
#
# 02-dump-supabase.sh — Produce a custom-format pg_dump from the Supabase DIRECT_URL
# (port 5432) and validate the dump file is restorable.
#
# Run from a host with reachability to the Supabase direct endpoint AND a local
# `pg_dump` of the same major version as the Supabase server (>= 16). This step
# is idempotent in the sense that it always writes a NEW timestamped dump file —
# nothing is mutated on the source database.
#
# Source PRD: tasks/prd-supabase-to-localhost-db-migration.md (US-003, FR-3).
#
# Usage:
#   SUPABASE_DIRECT_URL="postgresql://postgres.qkmseleljscluhhrcpaz:<pwd>@aws-1-us-west-2.pooler.supabase.com:5432/postgres" \
#     ./02-dump-supabase.sh

set -euo pipefail

# Força o uso do cliente PostgreSQL 17
export PATH="/usr/lib/postgresql/17/bin:$PATH"

# --- Format choice --------------------------------------------------------------
# `--jobs=N` (parallel dump) requires `--format=directory`; it is NOT supported
# with `--format=custom`. The PRD (FR-3, AC line 40) requests both `--format=custom`
# AND `--jobs=4`, which is mutually exclusive. We deliberately pick custom format
# and DROP `--jobs=4`: a single timestamped file is operationally simpler to
# checksum, scp, and feed straight to `pg_restore --jobs=4` on the receiving end
# (where parallel restore IS supported with custom format). Throughput on the
# pg_dump side is bounded by the Supabase egress and the DB size here is small
# enough (< 5 GiB target) that single-threaded dump is fine.

# --- Helpers --------------------------------------------------------------------
log()  { printf '[02-dump] %s\n' "$*"; }
warn() { printf '[02-dump][WARN] %s\n' "$*" >&2; }
fail() { printf '[02-dump][FAIL] %s\n' "$*" >&2; exit 1; }

# --- Step 1: validate SUPABASE_DIRECT_URL --------------------------------------
if [[ -z "${SUPABASE_DIRECT_URL:-}" ]]; then
    fail "SUPABASE_DIRECT_URL is not set. Export it from the production .env (DIRECT_URL value), e.g.:
       export SUPABASE_DIRECT_URL='postgresql://postgres.qkmseleljscluhhrcpaz:<pwd>@aws-1-us-west-2.pooler.supabase.com:5432/postgres'"
fi

if [[ "${SUPABASE_DIRECT_URL}" == *":6543"* ]]; then
    fail "SUPABASE_DIRECT_URL points at the PgBouncer pooler (:6543). pg_dump is incompatible with the pooler's
       transaction mode. Use the DIRECT URL on port 5432 instead (Supabase Project Settings → Database → Connection string → Direct connection)."
fi

if [[ "${SUPABASE_DIRECT_URL}" != *":5432"* ]]; then
    fail "SUPABASE_DIRECT_URL must contain ':5432'. Got a URL without the direct port — refusing to proceed."
fi

# --- Step 2: pg_dump version check ---------------------------------------------
if ! command -v pg_dump >/dev/null 2>&1; then
    fail "pg_dump not found on PATH. Install postgresql-client-16 (apt-get install -y postgresql-client-16)."
fi

PG_DUMP_VERSION_RAW="$(pg_dump --version 2>/dev/null | head -n1)"
log "Detected: ${PG_DUMP_VERSION_RAW}"

PG_DUMP_MAJOR="$(printf '%s\n' "${PG_DUMP_VERSION_RAW}" | awk '{print $NF}' | awk -F. '{print $1}')"
if [[ -z "${PG_DUMP_MAJOR}" || ! "${PG_DUMP_MAJOR}" =~ ^[0-9]+$ ]]; then
    warn "Could not parse pg_dump major version from '${PG_DUMP_VERSION_RAW}'. Proceeding anyway."
elif (( PG_DUMP_MAJOR < 16 )); then
    warn "pg_dump major version is ${PG_DUMP_MAJOR} (< 16). Supabase runs Postgres 15+/16+; mismatch can"
    warn "produce incomplete dumps. Recommended: install postgresql-client-16 before continuing."
    warn "Continuing — but rerun with a matching client if pg_restore reports format errors."
fi

# --- Step 3: query and print source DB size ------------------------------------
if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — skipping source DB size query (the dump will still proceed)."
else
    log "Querying source database size for restore comparison…"
    SRC_SIZE="$(psql "${SUPABASE_DIRECT_URL}" -tAc \
        "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null || echo '')"
    if [[ -n "${SRC_SIZE}" ]]; then
        log "Source database size (Supabase): ${SRC_SIZE}"
        log "Record this value — compare against the local restore in 03-restore-local.sh."
    else
        warn "Source DB size query failed (psql returned empty). Continuing with the dump anyway."
    fi
fi

# --- Step 4: produce the dump --------------------------------------------------
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="imoveis-supabase-${TIMESTAMP}.dump"

log "Starting pg_dump → ${DUMP_FILE} (custom format, no-owner, no-privileges)…"
log "This may take several minutes depending on DB size and Supabase egress throughput."

# NOTE: --jobs is intentionally omitted (incompatible with --format=custom — see header).
pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --verbose \
    --file="${DUMP_FILE}" \
    "${SUPABASE_DIRECT_URL}"

if [[ ! -s "${DUMP_FILE}" ]]; then
    fail "Dump file '${DUMP_FILE}' is missing or empty after pg_dump."
fi

# --- Step 5: validate the dump is readable -------------------------------------
TOC_FILE="${DUMP_FILE}.toc"
log "Validating dump readability via 'pg_restore --list' → ${TOC_FILE}…"
pg_restore --list "${DUMP_FILE}" > "${TOC_FILE}"
log "TOC has $(wc -l < "${TOC_FILE}") entries."

# --- Step 6: print final size + absolute path ----------------------------------
DUMP_ABS_PATH="$(readlink -f "${DUMP_FILE}")"
DUMP_HUMAN_SIZE="$(du -h "${DUMP_FILE}" | awk '{print $1}')"

cat <<EOF_SUMMARY

>>> DUMP COMPLETE <<<
File:  ${DUMP_ABS_PATH}
Size:  ${DUMP_HUMAN_SIZE}
TOC:   $(readlink -f "${TOC_FILE}")
Source size (Supabase): ${SRC_SIZE:-unknown}

Next step: scp this file to desafio01.alphaedtech and run 03-restore-local.sh.
EOF_SUMMARY
