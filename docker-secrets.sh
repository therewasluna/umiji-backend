# Secrets for the Docker install (tools/deploy), kept in /opt/umiji/secrets on the host.
# A value set in the environment (the install's .env) wins over the file.
UMIJI_SECRETS=/var/lib/umiji/secrets

# Run by the umiji-secrets service before Postgres starts. Makes only the missing ones: Postgres takes
# its password once, when it creates the database, so db_password must never change after that.
make_secrets() {
    umask 077
    for s in app_secret:64 db_password:24 metrics_pass:24; do
        f="$UMIJI_SECRETS/${s%%:*}"
        [ -s "$f" ] || head -c "${s#*:}" /dev/urandom | od -An -vtx1 | tr -d ' \n' > "$f"
        [ -s "$f" ] || { echo "Could not write $f" >&2; return 1; }
    done
}

# Used by docker-entrypoint.sh and the cli command (docker exec doesn't see what the entrypoint exports).
load_secrets() {
    [ -s "$UMIJI_SECRETS/app_secret" ] || return 0
    : "${APP_SECRET:=$(cat "$UMIJI_SECRETS/app_secret")}"
    : "${METRICS_PASS:=$(cat "$UMIJI_SECRETS/metrics_pass")}"
    : "${DATABASE_URL:=postgresql://postgres:$(cat "$UMIJI_SECRETS/db_password")@umiji-db:5432/postgres}"
    export APP_SECRET METRICS_PASS DATABASE_URL
}
