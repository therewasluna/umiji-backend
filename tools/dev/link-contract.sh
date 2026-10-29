#!/usr/bin/env bash
# Build libs/contract and drop it into the frontend's node_modules (dev only; npm ci undoes it).
# FRONTEND_DIR defaults to ../frontend or ../umiji-frontend next to this backend checkout.
set -euo pipefail
BACKEND=$(cd "$(dirname "$0")/../.." && pwd)
FRONTEND=${FRONTEND_DIR:-}
for f in "$BACKEND/../umiji-frontend" "$BACKEND/../frontend"; do
    [[ -z $FRONTEND && -f $f/package.json ]] && FRONTEND=$(cd "$f" && pwd)
done
C=$BACKEND/libs/contract
T=$FRONTEND/node_modules/@umiji/backend-contract
(cd "$C" && rm -rf build && npx -y -p typescript@5.9.3 tsc -p tsconfig.backend.json && npx -y -p typescript@5.9.3 tsc -p tsconfig.frontend.json)
rm -rf "$T/build" && cp -r "$C/build" "$T/build"
rm -rf "$FRONTEND/node_modules/.vite"
echo "linked contract into $FRONTEND"
