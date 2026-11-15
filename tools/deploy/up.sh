#!/usr/bin/env bash
# Start or update the stack on this server. tools/deploy.sh runs it after sending the images;
# run it yourself after editing .env, panel.env or subpage.env.
set -euo pipefail
cd "$(dirname "$0")"
set -a && . ./.env && set +a

has() { [[ ,$COMPOSE_PROFILES, == *,$1,* ]]; }

# Built-in HTTPS: Caddy's config, written from .env on every run.
caddyfile() {
    local panel=${CADDY_PANEL_DOMAIN:-} sub=${CADDY_SUBPAGE_DOMAIN:-}
    local trusted=${CADDY_TRUSTED_PROXIES:-} subpage_ip=${CADDY_SUBPAGE_SERVER_IP:-}
    if { has panel && [[ -z $panel ]]; } || { has subpage && [[ -z $sub ]]; }; then
        echo "!! caddy is in COMPOSE_PROFILES: set CADDY_PANEL_DOMAIN and CADDY_SUBPAGE_DOMAIN in .env" \
            "(only the one for what this server runs)." >&2
        exit 1
    fi
    if [[ -n $trusted ]]; then
        # Strict: read X-Forwarded-For from the right, so an entry the visitor wrote is never used.
        printf '{\n\tservers {\n\t\ttrusted_proxies static %s\n\t\ttrusted_proxies_strict\n\t}\n}\n\n' "$trusted"
    fi
    if has panel; then
        printf '%s {\n\t# Bot broadcast photos are up to 10 MB.\n\trequest_body {\n\t\tmax_size 20MB\n\t}\n' "$panel"
        if [[ -n $subpage_ip ]]; then
            # The sub page server passes on its own visitors' IPs; nobody else may.
            printf '\t@subpage client_ip %s\n\treverse_proxy @subpage umiji:3000\n' "$subpage_ip"
        fi
        # The panel reads the visitor's IP from this header, so Caddy always sets it.
        printf '\treverse_proxy umiji:3000 {\n\t\theader_up X-Umiji-Real-IP {client_ip}\n\t}\n}\n\n'
    fi
    if has subpage; then
        printf '%s {\n\treverse_proxy umiji-subscription-page:3010 {\n' "$sub"
        printf '\t\theader_up X-Forwarded-For {client_ip}\n\t}\n}\n'
    fi
}
if has caddy; then
    mkdir -p caddy
    caddyfile > caddy/Caddyfile.new && mv caddy/Caddyfile.new caddy/Caddyfile
    CADDYFILE_HASH=$(sha256sum caddy/Caddyfile | cut -c1-16)
    export CADDYFILE_HASH
fi

# Migrations run when the panel starts, so dump the database first. Keeps the last 10.
if [[ -n $(docker compose ps -q umiji-db 2>/dev/null) ]]; then
    mkdir -p backups
    (umask 077 && docker compose exec -T umiji-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' |
        gzip > "backups/$(date -u +%Y%m%d-%H%M%S).sql.gz")
    ls -t backups/*.sql.gz | tail -n +11 | xargs -r rm --
fi

docker compose up -d --remove-orphans
# --remove-orphans keeps services whose profile was taken out of COMPOSE_PROFILES; remove them too (volumes stay).
stale=$(comm -13 <(docker compose config --services | sort) <(docker compose --profile '*' ps -a --services | sort))
[[ -z $stale ]] || docker compose --profile '*' rm -sf $stale

if has subpage && ! grep -q '^UMIJI_API_TOKEN=.' subpage.env; then
    echo "!! subpage.env has no UMIJI_API_TOKEN, so the sub page can't start. Create one in the panel" \
        "(Umiji Settings → API Tokens), put it in subpage.env and run ./up.sh again." >&2
fi

docker image prune -f > /dev/null
docker compose ps
