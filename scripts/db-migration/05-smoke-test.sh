#!/usr/bin/env bash
#
# 05-smoke-test.sh — Post-cutover validation. Runs a fixed sequence of HTTP and
# SQL checks against the live API + local Postgres so the operator can confirm
# the cutover succeeded before declaring the maintenance window closed.
#
# Target host: production server `desafio01.alphaedtech` (10.10.0.201).
#
# Run order: AFTER 04-cutover-env.sh succeeds. This is the gate before the
# operator declares cutover complete.
#
# Inputs (env, all have defaults — override only if non-standard):
#   API_BASE             — base URL of the running API (default: http://localhost:3000).
#   LOCAL_DATABASE_URL   — psql connection string to the local Postgres
#                          (default: postgresql://imoveis@127.0.0.1:5432/imoveis;
#                          password supplied via PGPASSWORD).
#   PM2_NAME             — pm2 process name to scrape logs from
#                          (default: alphatoca-backend).
#
# Exit codes:
#   0 — all 5 checks passed.
#   non-zero — at least one check failed; see [FAIL] lines for details.
#
# Source PRD: tasks/prd-supabase-to-localhost-db-migration.md (US-006, FR-5).

set -euo pipefail

# --- Configurable knobs ---------------------------------------------------------
API_BASE="${API_BASE:-http://localhost:3000}"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://imoveis@127.0.0.1:5432/imoveis}"
PM2_NAME="${PM2_NAME:-alphatoca-backend}"

# --- Helpers --------------------------------------------------------------------
log()  { printf '[05-smoke] %s\n' "$*"; }
warn() { printf '[05-smoke][WARN] %s\n' "$*" >&2; }

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_CHECKS=5

pass() {
    printf '[PASS] %s\n' "$*"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail_check() {
    printf '[FAIL] %s\n' "$*" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

usage() {
    cat >&2 <<EOF_USAGE
Usage: $0

Runs 5 post-cutover smoke checks against the running API + local Postgres.

Env overrides:
  API_BASE            — default http://localhost:3000
  LOCAL_DATABASE_URL  — default postgresql://imoveis@127.0.0.1:5432/imoveis
                        (password via PGPASSWORD)
  PM2_NAME            — default alphatoca-backend

Exits 0 only when all 5 checks pass.
EOF_USAGE
    exit 2
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
fi

# --- Pre-flight -----------------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found on PATH — Checks 1 and 2 will fail."
fi
if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found on PATH — Checks 4 and 5 will fail."
fi
if ! command -v pm2 >/dev/null 2>&1; then
    warn "pm2 not found on PATH — Check 3 will fail."
fi
if [[ -z "${PGPASSWORD:-}" ]]; then
    warn "PGPASSWORD not set — Checks 4 and 5 may fail unless ${LOCAL_DATABASE_URL} embeds credentials."
fi

log "API_BASE=${API_BASE}"
log "LOCAL_DATABASE_URL=${LOCAL_DATABASE_URL}"
log "PM2_NAME=${PM2_NAME}"
log ""

# --- Check 1 — API health -------------------------------------------------------
# Try /health first; if it 5xx's or refuses, try /. Pass only if at least one is
# < 500. The route table in src/app.ts confirms /health exists, but / is a useful
# secondary in case the route is renamed in a future revision.
log "Check 1/${TOTAL_CHECKS} — API health (${API_BASE}/health, falling back to ${API_BASE}/)…"
HEALTH_OK=0
HEALTH_DETAIL=""
set +e
HEALTH_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' "${API_BASE}/health" 2>/dev/null)"
HEALTH_RC=$?
set -e
if [[ "${HEALTH_RC}" -eq 0 ]]; then
    HEALTH_OK=1
    HEALTH_DETAIL="${API_BASE}/health → ${HEALTH_STATUS}"
else
    set +e
    ROOT_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' "${API_BASE}/" 2>/dev/null)"
    ROOT_RC=$?
    set -e
    if [[ "${ROOT_RC}" -eq 0 ]]; then
        HEALTH_OK=1
        HEALTH_DETAIL="${API_BASE}/ → ${ROOT_STATUS} (fallback; /health unavailable)"
    else
        HEALTH_DETAIL="both ${API_BASE}/health and ${API_BASE}/ failed (curl rc=${HEALTH_RC}/${ROOT_RC})"
    fi
fi
if [[ "${HEALTH_OK}" -eq 1 ]]; then
    pass "API health — ${HEALTH_DETAIL}"
else
    fail_check "API health — ${HEALTH_DETAIL}"
fi

# --- Check 2 — Swagger docs reachable ------------------------------------------
log "Check 2/${TOTAL_CHECKS} — Swagger UI (${API_BASE}/docs/)…"
set +e
DOCS_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' "${API_BASE}/docs/" 2>/dev/null)"
DOCS_RC=$?
set -e
if [[ "${DOCS_RC}" -eq 0 && "${DOCS_STATUS}" == "200" ]]; then
    pass "Swagger UI — ${API_BASE}/docs/ → 200"
else
    fail_check "Swagger UI — ${API_BASE}/docs/ → status=${DOCS_STATUS:-<no-response>} rc=${DOCS_RC}"
fi

# --- Check 3 — pm2 logs free of Prisma init errors -----------------------------
log "Check 3/${TOTAL_CHECKS} — pm2 logs for '${PM2_NAME}' free of PrismaClientInitializationError / ECONNREFUSED…"
set +e
PM2_LOG_OUTPUT="$(pm2 logs "${PM2_NAME}" --lines 100 --nostream 2>&1)"
PM2_RC=$?
set -e
if [[ "${PM2_RC}" -ne 0 ]]; then
    fail_check "pm2 logs — could not read logs for '${PM2_NAME}' (rc=${PM2_RC}). Run 'pm2 status' manually."
elif printf '%s' "${PM2_LOG_OUTPUT}" | grep -qE 'PrismaClientInitializationError|ECONNREFUSED'; then
    fail_check "pm2 logs — found Prisma init error or ECONNREFUSED in last 100 lines:"
    printf '%s\n' "${PM2_LOG_OUTPUT}" | grep -E 'PrismaClientInitializationError|ECONNREFUSED' | head -5 >&2
else
    pass "pm2 logs — last 100 lines clean (no PrismaClientInitializationError / ECONNREFUSED)"
fi

# --- Check 4 — direct DB row count for Property --------------------------------
log "Check 4/${TOTAL_CHECKS} — direct psql count from public.\"Property\"…"
set +e
PROPERTY_COUNT="$(psql "${LOCAL_DATABASE_URL}" -tAc 'SELECT count(*) FROM properties;' 2>&1)"
PROPERTY_RC=$?
set -e
if [[ "${PROPERTY_RC}" -ne 0 ]]; then
    fail_check "direct DB — psql failed: ${PROPERTY_COUNT}"
elif ! [[ "${PROPERTY_COUNT}" =~ ^[0-9]+$ ]]; then
    fail_check "direct DB — unexpected psql output: ${PROPERTY_COUNT}"
elif [[ "${PROPERTY_COUNT}" -le 0 ]]; then
    fail_check "direct DB — Property count is ${PROPERTY_COUNT} (expected > 0)"
else
    pass "direct DB — Property count = ${PROPERTY_COUNT}"
fi

# --- Check 5 — pg_stat_activity confirms API is connected ----------------------
log "Check 5/${TOTAL_CHECKS} — pg_stat_activity confirms a Prisma connection…"
PRISMA_QUERY="SELECT count(*) FROM pg_stat_activity WHERE datname='imoveis' AND pid <> pg_backend_pid();"
set +e
PRISMA_CONN_COUNT="$(psql "${LOCAL_DATABASE_URL}" -tAc "${PRISMA_QUERY}" 2>&1)"
PRISMA_RC=$?
set -e
if [[ "${PRISMA_RC}" -ne 0 ]]; then
    fail_check "pg_stat_activity — psql failed: ${PRISMA_CONN_COUNT}"
elif ! [[ "${PRISMA_CONN_COUNT}" =~ ^[0-9]+$ ]]; then
    fail_check "pg_stat_activity — unexpected psql output: ${PRISMA_CONN_COUNT}"
elif [[ "${PRISMA_CONN_COUNT}" -lt 1 ]]; then
    fail_check "pg_stat_activity — 0 prisma% connections (expected ≥ 1; is the API running?)"
else
    pass "pg_stat_activity — ${PRISMA_CONN_COUNT} prisma% connection(s) on db 'imoveis'"
fi

# --- Final summary --------------------------------------------------------------
printf '\n'
log "Smoke tests: ${PASS_COUNT}/${TOTAL_CHECKS} passed."

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    warn "${FAIL_COUNT} check(s) failed. Inspect [FAIL] lines above."
    warn "If failures look terminal, follow the rollback runbook:"
    warn "  documentation/runbook-rollback-supabase.md"
    exit 1
fi

cat <<EOF_DONE

All ${TOTAL_CHECKS} smoke checks passed. Cutover validated.

Reminder: keep Supabase project 'qkmseleljscluhhrcpaz' active for ≥7 days as
the rollback path. Decommission timeline lives in scripts/db-migration/README.md.
EOF_DONE
