#!/usr/bin/env bash
# Build the Umiji panel image: this backend + the Umiji frontend.
#
#   tools/build-image.sh [image-tag]
#
# FRONTEND_DIR  checkout of umiji-frontend (default: ../umiji-frontend or ../frontend)
#
# The Dockerfile downloads the frontend zip and the Xray validator files, so they are served from a
# throwaway local web server: the frontend built from FRONTEND_DIR, the validator from the assets release.
set -euo pipefail

BACKEND=$(cd "$(dirname "$0")/.." && pwd)
TAG=${1:-umiji:$(git -C "$BACKEND" rev-parse --short HEAD)}
FRONTEND=${FRONTEND_DIR:-}
if [[ -z $FRONTEND ]]; then
    for d in "$BACKEND/../umiji-frontend" "$BACKEND/../frontend"; do
        grep -qs '"@umiji/backend-contract": "file:vendor/' "$d/package.json" && FRONTEND=$(cd "$d" && pwd) && break
    done
fi
[[ -n $FRONTEND && -f $FRONTEND/package.json ]] || { echo "set FRONTEND_DIR to the umiji-frontend checkout" >&2; exit 1; }
grep -q '"@umiji/backend-contract": "file:vendor/' "$FRONTEND/package.json" ||
    { echo "$FRONTEND is not an umiji-frontend checkout (no vendored contract)" >&2; exit 1; }

WORK=$(mktemp -d)
PORT=$((20000 + RANDOM % 10000))
cleanup() { [[ -n ${SERVER:-} ]] && kill "$SERVER" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> building frontend from $FRONTEND"
# The checkout's .env is for local dev (DOMAIN_OVERRIDE=1 points the app at DOMAIN_BACKEND) and vite would bake it in.
# Set these the way a release build has them, so the app calls the address it's served from.
(cd "$FRONTEND" && npm ci --no-audit --no-fund && DOMAIN_OVERRIDE=0 DOMAIN_BACKEND= npm run start:build)
dev_backend=$(sed -n 's/^DOMAIN_BACKEND=//p' "$FRONTEND/.env" 2>/dev/null || true)
if [[ -n $dev_backend ]] && grep -rqF "$dev_backend" "$FRONTEND/dist/assets"; then
    echo "the frontend build still contains the dev backend $dev_backend" >&2
    exit 1
fi
(cd "$FRONTEND" && zip -qr "$WORK/umiji-frontend.zip" ./dist)

echo "==> fetching the Xray validator from the assets release"
for f in main.wasm wasm_exec.js xray.schema.json xray.schema.cn.json; do
    curl -fsSL --retry 3 -o "$WORK/$f" "https://github.com/therewasluna/umiji/releases/download/assets-1/$f"
done

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WORK" >/dev/null 2>&1 &
SERVER=$!
sleep 1

echo "==> building image $TAG"
docker build --network host \
    --build-arg FRONTEND_URL="http://127.0.0.1:$PORT/umiji-frontend.zip" \
    --build-arg UMIJI_ASSETS_URL="http://127.0.0.1:$PORT" \
    --build-arg __UMIJI_METADATA_GIT_BACKEND_COMMIT="$(git -C "$BACKEND" rev-parse HEAD)" \
    --build-arg __UMIJI_METADATA_GIT_FRONTEND_COMMIT="$(git -C "$FRONTEND" rev-parse HEAD)" \
    --build-arg __UMIJI_METADATA_GIT_BRANCH="$(git -C "$BACKEND" branch --show-current)" \
    --build-arg __UMIJI_METADATA_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "$TAG" "$BACKEND"

echo "==> done: $TAG"
