#!/usr/bin/env bash
# Run the backend locally: API in watch mode, worker and scheduler from a production build.
# Needs: docker compose -f tools/dev/docker-compose.yml up -d, and a .env pointing at it (see DEVELOPMENT.md).
set -euo pipefail
BACKEND=$(cd "$(dirname "$0")/../.." && pwd); LOGS=$BACKEND/tools/dev/logs; mkdir -p "$LOGS"
cd "$BACKEND"
# Worker + scheduler get their own production build: the watch build and the seed build wipe dist/.
NODE_ENV=production npx rspack build --output-path tools/dev/dist-worker > "$LOGS/build.log" 2>&1
# The production bundle serves the UI from /opt/app/frontend, so the API runs in dev-watch mode (needs ./frontend).
mkdir -p frontend && [ -f frontend/index.html ] || echo '<!doctype html><title>dev</title>' > frontend/index.html
nohup npm run dev > "$LOGS/api.log" 2>&1 &
sleep 25
INSTANCE_TYPE=processor nohup node --env-file=.env tools/dev/dist-worker/processors.js > "$LOGS/worker.log" 2>&1 &
sleep 4
INSTANCE_TYPE=scheduler nohup node --env-file=.env tools/dev/dist-worker/scheduler.js > "$LOGS/scheduler.log" 2>&1 &
sleep 6
ss -ltn | grep -q ':3003 ' && echo "api up on :3003" || { echo "api failed, see $LOGS/api.log"; exit 1; }
