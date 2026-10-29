#!/usr/bin/env bash
# Start or update the stack on this server. tools/deploy.sh runs it after sending the images;
# run it yourself after editing .env, panel.env or subpage.env.
set -euo pipefail
cd "$(dirname "$0")"
set -a && . ./.env && set +a

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

if [[ ,$COMPOSE_PROFILES, == *,subpage,* ]] && ! grep -q '^UMIJI_API_TOKEN=.' subpage.env; then
    echo "!! subpage.env has no UMIJI_API_TOKEN, so the sub page can't start. Create one in the panel" \
        "(Umiji Settings → API Tokens), put it in subpage.env and run ./up.sh again." >&2
fi

docker image prune -f > /dev/null
docker compose ps
