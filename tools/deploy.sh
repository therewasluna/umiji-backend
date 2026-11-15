#!/usr/bin/env bash
# Deploy the panel and/or the subscription page to a server with Docker. See DEPLOY.md.
#
#   tools/deploy.sh init <host>   first time: put the stack on <host> and create its .env files
#   tools/deploy.sh up <host>     build the images that server runs, send them over SSH, start or update it
#
# <host>        anything ssh takes (root@1.2.3.4, a Host from ~/.ssh/config), or "local" for this machine
# REMOTE_DIR    where the stack lives on the server (default /opt/umiji)
# SKIP_BUILD=1  send the images built last time instead of building again
# SUBPAGE_DIR   checkout of umiji-subscription-page (default ../umiji-subscription-page or ../subscription-page)
set -euo pipefail

BACKEND=$(cd "$(dirname "$0")/.." && pwd)
KIT=$BACKEND/tools/deploy
DIR=${REMOTE_DIR:-/opt/umiji}
CMD=${1:-} HOST=${2:-}
[[ $CMD =~ ^(init|up)$ && -n $HOST ]] || { sed -n '2,10p' "$0" >&2; exit 1; }
PANEL_IMAGE=umiji-panel:latest
SUBPAGE_IMAGE=umiji-subscription-page:latest

SUBPAGE=${SUBPAGE_DIR:-}
if [[ -z $SUBPAGE ]]; then
    for d in "$BACKEND/../umiji-subscription-page" "$BACKEND/../subscription-page"; do
        [[ -x $d/tools/build-image.sh ]] && SUBPAGE=$(cd "$d" && pwd) && break
    done
fi
[[ -n $SUBPAGE && -x $SUBPAGE/tools/build-image.sh ]] || { echo "set SUBPAGE_DIR to the umiji-subscription-page checkout" >&2; exit 1; }

# One SSH connection for the whole run, opened with retries: a proxy in front of ssh can drop an attempt.
SSH=(ssh -o ControlMaster=auto -o ControlPersist=15m -o "ControlPath=${TMPDIR:-/tmp}/umiji-deploy-%C")
on() { if [[ $HOST == local ]]; then bash -c "$1"; else "${SSH[@]}" "$HOST" "$1"; fi; }
if [[ $HOST != local ]]; then
    for i in 1 2 3; do on true && break; [[ $i == 3 ]] && exit 1; sleep 3; done
    trap '"${SSH[@]}" -O exit "$HOST" 2>/dev/null' EXIT
fi
# Writes stdin to a new file on the server. The server checks it exists, so a dropped connection never overwrites one.
put_new() { on "umask 077; if [ -e '$DIR/$1' ]; then cat > /dev/null; else cat > '$DIR/$1'; fi"; }
sync_kit() { tar -C "$KIT" -cf - docker-compose.yml up.sh | on "mkdir -p '$DIR' && tar -C '$DIR' --no-same-owner -xf -"; }

ship() {
    # Not .Id: it differs between Docker's classic and containerd image stores for the same image.
    local f='{{.Created}} {{.RootFS.Layers}}' id
    id=$(docker image inspect -f "$f" "$1")
    if [[ $(on "docker image inspect -f '$f' '$1' 2>/dev/null" || true) == "$id" ]]; then
        echo "==> $HOST already has this $1"
        return
    fi
    echo "==> sending $1 to $HOST"
    docker save "$1" | gzip | on 'gunzip | docker load'
}

if [[ $CMD == init ]]; then
    sync_kit
    put_new .env < "$KIT/env.example"
    pw=$(openssl rand -hex 24)
    sed -e "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -hex 64)|" \
        -e "s|^DATABASE_URL=.*|DATABASE_URL=\"postgresql://postgres:$pw@umiji-db:5432/postgres\"|" \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
        -e "s|^METRICS_PASS=.*|METRICS_PASS=$(openssl rand -hex 24)|" \
        -e "s|^WEBHOOK_SECRET_HEADER=.*|WEBHOOK_SECRET_HEADER=$(openssl rand -hex 32)|" \
        "$BACKEND/.env.sample" | put_new panel.env
    sed 's|^UMIJI_PANEL_URL=.*|UMIJI_PANEL_URL=http://umiji:3000|' "$SUBPAGE/.env.sample" | put_new subpage.env
    cat <<EOF
==> the stack is in $HOST:$DIR. Existing .env files were kept. Edit them there:
  .env          COMPOSE_PROFILES: what runs on this server (panel, subpage or both). HTTPS: add caddy
                and set CADDY_*_DOMAIN for built-in certificates, or leave it out and run your own nginx.
  panel.env     PANEL_DOMAIN, SUB_PUBLIC_DOMAIN (the sub page's domain), Telegram settings if you use them
  subpage.env   UMIJI_PANEL_URL: keep http://umiji:3000 when the panel runs on this server,
                otherwise https://<panel domain>. UMIJI_API_TOKEN: create it in the panel once it's up.
Then run: tools/deploy.sh up $HOST
EOF
    exit
fi

profiles=$(on "sed -n 's/#.*//; s/^COMPOSE_PROFILES=//p' '$DIR/.env'" | tr -d "\"' ") ||
    { echo "couldn't read $DIR/.env on $HOST. If the server isn't set up yet, run tools/deploy.sh init $HOST first." >&2; exit 1; }
images=()
if [[ ,$profiles, == *,panel,* ]]; then
    [[ -n ${SKIP_BUILD:-} ]] || "$BACKEND/tools/build-image.sh" "$PANEL_IMAGE"
    images+=("$PANEL_IMAGE")
fi
if [[ ,$profiles, == *,subpage,* ]]; then
    [[ -n ${SKIP_BUILD:-} ]] || "$SUBPAGE/tools/build-image.sh" "$SUBPAGE_IMAGE"
    images+=("$SUBPAGE_IMAGE")
fi
if [[ $HOST != local ]]; then
    for image in "${images[@]}"; do ship "$image"; done
fi
sync_kit
on "'$DIR/up.sh'"
