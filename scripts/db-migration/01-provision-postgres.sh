#!/usr/bin/env bash
#
# 01-provision-postgres.sh — Native Postgres 16 install + role/db scaffold for I-Moveis.
#
# Target host: production server `desafio01.alphaedtech` (10.10.0.201).
# Idempotent — safe to re-run after partial failure.
#
# Outputs ONE generated password between clear markers; the operator MUST copy it
# into the production `.env` (DATABASE_URL / DIRECT_URL) before running 04-cutover-env.sh.
#
# Source PRD: tasks/prd-supabase-to-localhost-db-migration.md (US-001, FR-1, FR-2, FR-10).

set -euo pipefail

# --- Configurable knobs ---------------------------------------------------------
PG_MAJOR="${PG_MAJOR:-16}"
APP_ROLE="${APP_ROLE:-imoveis}"
APP_DB="${APP_DB:-imoveis}"
APP_LOCALE="${APP_LOCALE:-en_US.UTF-8}"
PG_CONF_DIR="/etc/postgresql/${PG_MAJOR}/main"
PG_CONF="${PG_CONF_DIR}/postgresql.conf"
PG_HBA="${PG_CONF_DIR}/pg_hba.conf"

# --- Helpers --------------------------------------------------------------------
log()  { printf '[01-provision] %s\n' "$*"; }
warn() { printf '[01-provision][WARN] %s\n' "$*" >&2; }
fail() { printf '[01-provision][FAIL] %s\n' "$*" >&2; exit 1; }

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        fail "This script must run as root (use sudo). Detected EUID=${EUID}."
    fi
}

run_as_postgres() {
    # Run a psql command as the OS user `postgres` against the cluster's local socket.
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
}

# --- Steps ----------------------------------------------------------------------

require_root

# 1. Locale ----------------------------------------------------------------------
log "Ensuring locale '${APP_LOCALE}' is generated…"
if ! locale -a | grep -qiE "^${APP_LOCALE//-/}$|^${APP_LOCALE}$"; then
    apt-get install -y locales
    sed -i.bak -E "s/^# *(${APP_LOCALE} UTF-8)/\1/" /etc/locale.gen || true
    if ! grep -qE "^${APP_LOCALE} UTF-8" /etc/locale.gen; then
        echo "${APP_LOCALE} UTF-8" >> /etc/locale.gen
    fi
    locale-gen "${APP_LOCALE}"
else
    log "Locale already present, skipping locale-gen."
fi

# 2. PGDG repo (only if distro default is older than $PG_MAJOR) ------------------
log "Checking apt for postgresql-${PG_MAJOR} availability…"
apt-get update -y >/dev/null
if ! apt-cache show "postgresql-${PG_MAJOR}" >/dev/null 2>&1; then
    log "postgresql-${PG_MAJOR} not in default apt sources; configuring PGDG repo."
    apt-get install -y curl ca-certificates gnupg lsb-release
    install -d -m 0755 /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/postgresql.gpg ]]; then
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
    fi
    CODENAME="$(lsb_release -cs)"
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list
    apt-get update -y
else
    log "postgresql-${PG_MAJOR} already available from configured sources."
fi

# 3. Install Postgres + contrib --------------------------------------------------
log "Installing postgresql-${PG_MAJOR} and postgresql-contrib-${PG_MAJOR}…"
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-${PG_MAJOR}" \
    "postgresql-contrib-${PG_MAJOR}"

systemctl enable postgresql >/dev/null 2>&1 || true
systemctl start postgresql

# 4. Listener config -------------------------------------------------------------
if [[ ! -f "${PG_CONF}" ]]; then
    fail "Expected postgresql.conf at ${PG_CONF} after install — aborting."
fi
log "Locking listen_addresses to 'localhost' in ${PG_CONF}…"
if [[ ! -f "${PG_CONF}.bak" ]]; then
    cp -p "${PG_CONF}" "${PG_CONF}.bak"
fi
# Replace any existing listen_addresses line (commented or not) with the locked value.
if grep -qE "^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=" "${PG_CONF}"; then
    sed -i.tmp -E "s|^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=.*$|listen_addresses = 'localhost'|" "${PG_CONF}"
    rm -f "${PG_CONF}.tmp"
else
    printf "\nlisten_addresses = 'localhost'\n" >> "${PG_CONF}"
fi

# 5. pg_hba.conf — only local + host 127.0.0.1/32 scram-sha-256 ------------------
if [[ ! -f "${PG_HBA}" ]]; then
    fail "Expected pg_hba.conf at ${PG_HBA} after install — aborting."
fi
log "Hardening ${PG_HBA} (no trust, no 0.0.0.0/0; scram-sha-256 over loopback only)…"
if [[ ! -f "${PG_HBA}.bak" ]]; then
    cp -p "${PG_HBA}" "${PG_HBA}.bak"
fi

# Refuse to proceed if any non-loopback host rule is present besides what we manage.
if grep -E '^[[:space:]]*host' "${PG_HBA}" | grep -qE '0\.0\.0\.0/0|::/0'; then
    warn "Found a wildcard host rule in ${PG_HBA}. It will be removed."
fi
if grep -E '^[[:space:]]*[a-z]+' "${PG_HBA}" | grep -qE '\btrust\b'; then
    warn "Found a 'trust' auth method in ${PG_HBA}. It will be replaced with scram-sha-256."
fi

# Write a minimal, locked pg_hba.conf in place. Keep the original at .bak.
cat > "${PG_HBA}" <<EOF_HBA
# Managed by scripts/db-migration/01-provision-postgres.sh — do not hand-edit.
# Original preserved at $(basename "${PG_HBA}").bak.
#
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# Unix-domain socket (peer for the OS user 'postgres' for admin tasks).
local   all             postgres                                peer

# Local app connections (Prisma uses TCP via 127.0.0.1, but keep socket too).
local   ${APP_DB}       ${APP_ROLE}                             scram-sha-256
host    ${APP_DB}       ${APP_ROLE}     127.0.0.1/32            scram-sha-256
host    ${APP_DB}       ${APP_ROLE}     ::1/128                 scram-sha-256

# Replication (loopback only — used by pg_basebackup if ever needed).
local   replication     postgres                                peer
EOF_HBA
chown --reference="${PG_HBA}.bak" "${PG_HBA}"
chmod --reference="${PG_HBA}.bak" "${PG_HBA}"

# 6. Restart and verify ----------------------------------------------------------
log "Restarting postgresql to apply config changes…"
systemctl restart postgresql
if ! systemctl is-active --quiet postgresql; then
    systemctl status postgresql --no-pager || true
    fail "postgresql is not active after restart."
fi
log "postgresql is active."

# 7. Role + database (idempotent) -----------------------------------------------
ROLE_EXISTS="$(run_as_postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${APP_ROLE}';" || echo '')"
DB_EXISTS="$(run_as_postgres -tAc   "SELECT 1 FROM pg_database WHERE datname='${APP_DB}';" || echo '')"

GENERATED_PASSWORD=""
if [[ "${ROLE_EXISTS}" != "1" ]]; then
    GENERATED_PASSWORD="$(openssl rand -base64 32)"
    log "Creating role '${APP_ROLE}' with a freshly-generated password."
    # Use a DO block so re-runs raised by another path don't fail with duplicate_object.
    PGPASSWORD_ESCAPED="${GENERATED_PASSWORD//\'/\'\'}"
    run_as_postgres <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${PGPASSWORD_ESCAPED}';
    END IF;
END
\$\$;
SQL
else
    log "Role '${APP_ROLE}' already exists — leaving its password untouched."
    log "If you need a new password, ALTER ROLE manually and update .env."
fi

if [[ "${DB_EXISTS}" != "1" ]]; then
    log "Creating database '${APP_DB}' (template0, ${APP_LOCALE}, UTF8) owned by '${APP_ROLE}'…"
    run_as_postgres <<SQL
CREATE DATABASE ${APP_DB}
    OWNER ${APP_ROLE}
    TEMPLATE template0
    LC_COLLATE '${APP_LOCALE}'
    LC_CTYPE   '${APP_LOCALE}'
    ENCODING   'UTF8';
SQL
else
    log "Database '${APP_DB}' already exists — skipping CREATE DATABASE."
fi

# 8. Smoke test — \conninfo as the app role over TCP -----------------------------
SMOKE_PASSWORD=""
if [[ -n "${GENERATED_PASSWORD}" ]]; then
    SMOKE_PASSWORD="${GENERATED_PASSWORD}"
elif [[ -n "${PGPASSWORD:-}" ]]; then
    SMOKE_PASSWORD="${PGPASSWORD}"
fi

if [[ -n "${SMOKE_PASSWORD}" ]]; then
    log "Running TCP smoke test as '${APP_ROLE}'…"
    PGPASSWORD="${SMOKE_PASSWORD}" psql -h 127.0.0.1 -U "${APP_ROLE}" -d "${APP_DB}" -c '\conninfo'
else
    warn "Role '${APP_ROLE}' pre-existed and PGPASSWORD is not set — skipping TCP \\conninfo smoke test."
    warn "Verify connectivity manually: PGPASSWORD=… psql -h 127.0.0.1 -U ${APP_ROLE} -d ${APP_DB} -c '\\conninfo'"
fi

# 9. Output the new password (once, between markers) -----------------------------
if [[ -n "${GENERATED_PASSWORD}" ]]; then
    cat <<EOF_BANNER

>>> SAVE THIS PASSWORD INTO .env <<<
${GENERATED_PASSWORD}
>>> SAVE THIS PASSWORD INTO .env <<<

Use it inside DATABASE_URL and DIRECT_URL when running 04-cutover-env.sh:
    postgresql://${APP_ROLE}:<password>@127.0.0.1:5432/${APP_DB}?schema=public

This password is shown ONCE and never written to disk by this script.
EOF_BANNER
fi

# 10. Final summary --------------------------------------------------------------
echo
echo "Postgres ready at 127.0.0.1:5432, database '${APP_DB}', role '${APP_ROLE}'"
