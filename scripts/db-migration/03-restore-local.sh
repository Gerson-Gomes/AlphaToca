#!/usr/bin/env bash
#
# 03-restore-local.sh — Restore a Supabase pg_dump into the locally-provisioned
# Postgres on desafio01.alphaedtech, after preparing required extensions and
# verifying row counts on the way out.
#
# Run AFTER 01-provision-postgres.sh (database `imoveis` exists, role `imoveis`
# can connect over 127.0.0.1) and AFTER 02-dump-supabase.sh (the .dump file has
# been scp'd to this host).
#
# Source PRD: tasks/prd-supabase-to-localhost-db-migration.md (US-004, FR-4..FR-7).
#
# Usage:
#   PGPASSWORD='<from 01-provision>' \
#     ./03-restore-local.sh /path/to/imoveis-supabase-<UTC>.dump
#
# Optional env:
#   LOCAL_DATABASE_URL   default: postgresql://imoveis@127.0.0.1:5432/imoveis

set -euo pipefail

# --- Helpers --------------------------------------------------------------------
log()  { printf '[03-restore] %s\n' "$*"; }
warn() { printf '[03-restore][WARN] %s\n' "$*" >&2; }
fail() { printf '[03-restore][FAIL] %s\n' "$*" >&2; exit 1; }

# --- Step 0: arg + env validation ----------------------------------------------
if [[ $# -lt 1 || -z "${1:-}" ]]; then
    fail "Usage: $0 <dump-file>
       Example: PGPASSWORD='…' $0 ./imoveis-supabase-20260509T034512Z.dump"
fi

DUMP_FILE="$1"
if [[ ! -f "${DUMP_FILE}" ]]; then
    fail "Dump file not found: ${DUMP_FILE}"
fi
if [[ ! -s "${DUMP_FILE}" ]]; then
    fail "Dump file is empty: ${DUMP_FILE}"
fi

LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://imoveis@127.0.0.1:5432/imoveis}"

if [[ -z "${PGPASSWORD:-}" ]]; then
    warn "PGPASSWORD is not set. If the local 'imoveis' role requires a password,"
    warn "this script will fail on the first psql/pg_restore call."
    warn "Export it from the value printed by 01-provision-postgres.sh, e.g.:"
    warn "  export PGPASSWORD='<paste from 01-provision output>'"
fi

if ! command -v pg_restore >/dev/null 2>&1; then
    fail "pg_restore not found on PATH. Install postgresql-client-16."
fi
if ! command -v psql >/dev/null 2>&1; then
    fail "psql not found on PATH. Install postgresql-client-16."
fi

DUMP_ABS="$(readlink -f "${DUMP_FILE}")"
log "Restoring dump: ${DUMP_ABS}"
log "Target:        ${LOCAL_DATABASE_URL}"

# --- Step 1: extension discovery -----------------------------------------------
log "Step 1/6 — Discovering extensions in the dump…"

# `pg_restore --list` rows for extensions look like:
#   1234; 3079 16389 EXTENSION - pgcrypto
# The extension name is the LAST field on the line.
EXT_LIST_FILE="$(mktemp)"
trap 'rm -f "${EXT_LIST_FILE}"' EXIT

pg_restore --list "${DUMP_FILE}" \
    | grep -i 'EXTENSION ' \
    | grep -v -i 'EXTENSION COMMENT' \
    | awk '{print $NF}' \
    | sort -u \
    > "${EXT_LIST_FILE}" || true

if [[ ! -s "${EXT_LIST_FILE}" ]]; then
    log "  (no EXTENSION entries found in dump TOC — proceeding without extension prep)"
else
    log "  Extensions referenced by the dump:"
    sed 's/^/    - /' "${EXT_LIST_FILE}"
fi

# --- Step 2: extension creation ------------------------------------------------
log "Step 2/6 — Creating extensions on the local database (CREATE EXTENSION IF NOT EXISTS)…"

# Supabase-only extensions: typically NOT shipped in postgresql-contrib-16. We
# attempt CREATE EXTENSION anyway and surface a warning if Postgres rejects them.
# The application should not depend on these (pg_graphql/pgjwt/vault are platform
# helpers used by the Supabase API layer, not the Prisma schema).
SUPABASE_ONLY_REGEX='^(pg_graphql|pgjwt|vault|supabase_vault|pgsodium|pg_net|pgaudit|wrappers)$'

EXT_CREATE_FAILS=0
while IFS= read -r ext; do
    [[ -z "${ext}" ]] && continue
    if [[ "${ext}" =~ ${SUPABASE_ONLY_REGEX} ]]; then
        warn "  '${ext}' is a Supabase-platform extension; it is not part of postgresql-contrib-16."
        warn "    The application schema does not depend on it — attempting CREATE anyway, will skip on failure."
    fi
    log "  CREATE EXTENSION IF NOT EXISTS ${ext}…"
    set +e
    psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS \"${ext}\";" >/dev/null 2>&1
    rc=$?
    set -e
    if (( rc != 0 )); then
        warn "    Failed to create '${ext}' (rc=${rc}). If it is a Supabase-only extension this is expected;"
        warn "    pg_restore will warn but the application schema will still load."
        EXT_CREATE_FAILS=$(( EXT_CREATE_FAILS + 1 ))
    fi
done < "${EXT_LIST_FILE}"

if (( EXT_CREATE_FAILS > 0 )); then
    log "  ${EXT_CREATE_FAILS} extension(s) could not be created — continuing (these will appear as pg_restore warnings)."
fi

# --- Step 3: pg_restore --------------------------------------------------------
log "Step 3/6 — Running pg_restore (parallel jobs=4, no-owner, no-privileges)…"
log "  Warnings about missing Supabase-only extensions are EXPECTED and do not fail the restore."

set +e
pg_restore \
    --no-owner \
    --no-privileges \
    --jobs=4 \
    --verbose \
    --dbname="${LOCAL_DATABASE_URL}" \
    "${DUMP_FILE}"
RESTORE_RC=$?
set -e

if (( RESTORE_RC == 0 )); then
    log "  pg_restore completed cleanly (rc=0)."
else
    warn "  pg_restore exited with rc=${RESTORE_RC}. This is commonly non-fatal — Supabase-only"
    warn "  extension warnings cause a non-zero exit. Continue and verify row counts below."
fi

# --- Step 4: Prisma migration status (operator-run) ----------------------------
log "Step 4/6 — Prisma migration status (RUN MANUALLY from the API project root):"
cat <<EOF_PRISMA

  cd /path/to/AlphaToca-Backend   # the API directory on this host
  DATABASE_URL='${LOCAL_DATABASE_URL}' npx prisma migrate status

  Expected output: "Database schema is up to date!"
  If pending migrations are listed, run \`npx prisma migrate deploy\` (NOT \`migrate dev\`).

EOF_PRISMA

# --- Step 5: row count verification --------------------------------------------
log "Step 5/6 — Row counts for critical tables (compare against Supabase pre-cutover figures)…"

# A single anonymous DO block: builds a label→table mapping, gracefully skips
# tables that are not present in this schema (Lead is included per the PRD AC
# but is not currently in the Prisma schema — to_regclass returns NULL, and we
# print '<not in schema>' instead of failing).
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<'EOF_COUNTS'
DO $$
DECLARE
    rec   RECORD;
    cnt   BIGINT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '  %-18s | %s', 'Table', 'Rows';
    RAISE NOTICE '  ------------------ + ----------------';
    FOR rec IN
        SELECT * FROM (VALUES
            ('User',          'users'),
            ('Property',      'properties'),
            ('PropertyImage', 'property_images'),
            ('Lead',          'leads'),
            ('Conversation',  'conversations')
        ) AS t(label, tbl)
    LOOP
        IF to_regclass('public.' || quote_ident(rec.tbl)) IS NULL THEN
            RAISE NOTICE '  %-18s | %s', rec.label, '<not in schema>';
        ELSE
            EXECUTE format('SELECT count(*) FROM public.%I', rec.tbl) INTO cnt;
            RAISE NOTICE '  %-18s | %s', rec.label, cnt::text;
        END IF;
    END LOOP;
    RAISE NOTICE '';
END $$;
EOF_COUNTS

# --- Step 6: final summary -----------------------------------------------------
log "Step 6/6 — Done."
cat <<EOF_DONE

>>> RESTORE COMPLETE <<<
Restore complete. Compare row counts above against Supabase pre-cutover counts.

Next steps for the operator:
  1. Run \`npx prisma migrate status\` from the API directory (see Step 4).
  2. If counts match and migrate-status is clean, proceed to 04-cutover-env.sh.
  3. If counts diverge, do NOT cut over — investigate via the dump's TOC file
     (\`pg_restore --list ${DUMP_FILE}\`) and check pg_restore stderr above.
EOF_DONE
