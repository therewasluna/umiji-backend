#!/usr/bin/env bash
# Broker bot in webhook mode. Needs node, curl, jq and the local API started with
# BROKER_BOT_WEBHOOK_DOMAIN=hook.e2e.test and TELEGRAM_BOT_API_ROOT=http://127.0.0.1:8081.
# Telegram's pushes are played by curl posting to the webhook endpoint.
# Usage: ./tools/dev/e2e-broker-bot-webhook.sh [http://127.0.0.1:3003]
set -euo pipefail
export NO_PROXY=127.0.0.1,localhost
B=${1:-http://127.0.0.1:3003}
M=http://127.0.0.1:8081
DOMAIN=hook.e2e.test
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
PASS=0; FAIL=0
ADMIN=''; BT=''; BRK=''; SQUAD=''; EXT=''; CFG=''; MOCK_PID=''; DISCONNECTED=0
ok() { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 :: $2" >&2; }
die() { bad "$@"; exit 1; }
for cmd in node curl jq; do command -v "$cmd" >/dev/null || die prerequisite "$cmd is required"; done
[[ $B =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || die base_url 'use a local http://127.0.0.1:PORT URL'
APP_SECRET=$(grep -m1 '^APP_SECRET=' "$(dirname "$0")/../../.env" | cut -d= -f2-)
[[ -n $APP_SECRET ]] || die app_secret 'APP_SECRET not found in .env'
TMP=$(mktemp -d /tmp/e2e-broker-bot-webhook.XXXXXX)
BODY=$TMP/body.json
CALLS=$TMP/calls.json
RUN="$(date +%s)${RANDOM}"
TOKEN="e2e${RUN}"
NAME="hook${RUN}"
# Same derivation as BrokerBotHandler.webhookSecret.
SECRET=$(node -e 'process.stdout.write(require("node:crypto").createHmac("sha256",process.argv[1]).update("broker-bot-webhook:"+process.argv[2]).digest("hex"))' "$APP_SECRET" "$TOKEN")

req() { # method path auth [JSON] -> status; response body goes to $BODY
  local method=$1 path=$2 auth=$3
  local args=()
  [[ -z $auth ]] || args+=(-H "Authorization: Bearer $auth")
  [[ $# -lt 4 ]] || args+=(-d "$4")
  curl -sS --max-time 20 -o "$BODY" -w '%{http_code}' -X "$method" "$B$path" "${H[@]}" "${args[@]}"
}
expect() {
  local name=$1 want=$2 got; shift 2
  got=$(req "$@") || die "$name" 'HTTP request failed'
  [[ $got == "$want" ]] || die "$name" "want $want got $got $(head -c 1200 "$BODY")"
  ok "$name ($got)"
}
jqb() { jq -r "$1" "$BODY"; }
check() { # name jq-filter [file]
  local name=$1 filter=$2 file=${3:-$BODY}
  jq -e "$filter" "$file" >/dev/null || die "$name" "$(head -c 2400 "$file")"
  ok "$name"
}
calls() { curl -fsS --max-time 5 "$M/_calls?token=$TOKEN&since=0" > "$CALLS"; }
count() { calls; jq "[.calls[] | select($1)] | length" "$CALLS"; }
hook() { # name want-status path-uuid secret update-json
  local name=$1 want=$2 got
  local args=(-H 'Content-Type: application/json' -d "$5")
  [[ -z $4 ]] || args+=(-H "X-Telegram-Bot-Api-Secret-Token: $4")
  got=$(curl -sS --max-time 20 -o "$BODY" -w '%{http_code}' -X POST "$B/api/broker-bot/webhook/$3" "${args[@]}") \
    || die "$name" 'HTTP request failed'
  [[ $got == "$want" ]] || die "$name" "want $want got $got $(head -c 600 "$BODY")"
  ok "$name ($got)"
}
start_update() { # update_id
  jq -nc --argjson id "$1" '{update_id:$id,message:{message_id:$id,date:now|floor,
    from:{id:5550001,is_bot:false,first_name:"E2E Customer"},chat:{id:5550001,type:"private"},text:"/start"}}'
}
cleanup_delete() {
  local got
  got=$(req DELETE "$1" "$ADMIN")
  if [[ $got == "$2" || $got == 404 ]]; then ok "cleanup $1"; else bad "cleanup $1" "HTTP $got"; fi
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if [[ -n $BRK && $BRK != null ]]; then
    [[ -z $BT || $DISCONNECTED == 1 ]] || req DELETE /api/broker-bot "$BT" >/dev/null
    cleanup_delete "/api/brokers/$BRK" 204
  fi
  [[ -z $EXT || $EXT == null ]] || cleanup_delete "/api/external-squads/$EXT" 204
  [[ -z $CFG || $CFG == null ]] || cleanup_delete "/api/subscription-page-configs/$CFG" 204
  [[ -z $SQUAD || $SQUAD == null ]] || cleanup_delete "/api/internal-squads/$SQUAD" 204
  [[ -z $MOCK_PID ]] || { kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null; }
  if ((status != 0 && FAIL == 0)); then bad script "unexpected exit $status"; fi
  echo "passed: $PASS  failed: $FAIL"
  if ((FAIL > 0 || status != 0)); then echo "Diagnostics: $TMP" >&2; exit 1; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo '== mock and fixtures'
node "$(dirname "$0")/mock-telegram.mjs" > "$TMP/mock.log" 2>&1 &
MOCK_PID=$!
for ((i=0; i<50; i++)); do
  [[ $(cat "$TMP/mock.log") == *'Mock Telegram listening'* ]] && break
  kill -0 "$MOCK_PID" 2>/dev/null || die 'start mock' "$(cat "$TMP/mock.log")"
  sleep 0.1
done
LOGIN='{"username":"owner","password":"AdminPassword1234567890xyz"}'
if [[ $(req POST /api/auth/login '' "$LOGIN") != 200 ]]; then
  expect 'register admin' 201 POST /api/auth/register '' "$LOGIN"
  expect 'admin login' 200 POST /api/auth/login '' "$LOGIN"
fi
ADMIN=$(jqb .response.accessToken)
expect 'create squad' 201 POST /api/internal-squads "$ADMIN" "{\"name\":\"sq$RUN\",\"inbounds\":[]}"
SQUAD=$(jqb .response.uuid)
expect 'create broker' 201 POST /api/brokers "$ADMIN" "{\"username\":\"$NAME\",\"password\":\"BrokerPassword123456789abc\",\"internalSquads\":[\"$SQUAD\"]}"
BRK=$(jqb .response.uuid); EXT=$(jqb .response.externalSquad.uuid)
expect 'broker login' 200 POST /api/auth/login '' "{\"username\":\"$NAME\",\"password\":\"BrokerPassword123456789abc\"}"
BT=$(jqb .response.accessToken)
expect 'read broker' 200 GET /api/brokers/me "$BT"
CFG=$(jqb .response.subpageConfigUuid)

echo '== connect registers the webhook'
expect 'connect' 200 POST /api/broker-bot/connect "$BT" "{\"botToken\":\"$TOKEN\",\"groupId\":null,\"lang\":\"en\",\"greeting\":null}"
calls
check 'setWebhook points at this broker' "any(.calls[]; .method==\"setWebhook\" and .body.url==\"https://$DOMAIN/api/broker-bot/webhook/$BRK\"
  and .body.secret_token==\"$SECRET\" and .body.max_connections==1
  and (.body.allowed_updates|sort)==[\"callback_query\",\"message\"])" "$CALLS"
sleep 7 # longer than the reconcile interval, so the poller has had its turn
[[ $(count '.method=="getUpdates"') == 0 ]] && ok 'no long polling' || die 'no long polling' "$(cat "$CALLS")"
[[ $(count '.method=="setWebhook"') -ge 2 ]] && ok 'poller re-registered the webhook' || die 'poller re-registered the webhook' "$(cat "$CALLS")"

echo '== webhook endpoint'
DM='.method=="sendMessage" and (.body.chat_id|tostring)=="5550001"'
hook 'no secret refused' 401 "$BRK" '' "$(start_update 700)"
hook 'wrong secret refused' 401 "$BRK" "${SECRET%?}x" "$(start_update 700)"
hook 'not a uuid' 400 not-a-uuid "$SECRET" "$(start_update 700)"
hook 'unknown broker ignored' 200 00000000-0000-4000-8000-000000000000 "$SECRET" "$(start_update 700)"
[[ $(count "$DM") == 0 ]] && ok 'refused updates not handled' || die 'refused updates not handled' "$(cat "$CALLS")"
hook '/start accepted' 200 "$BRK" "$SECRET" "$(start_update 700)"
[[ $(count "$DM") == 1 ]] && ok '/start answered' || die '/start answered' "$(cat "$CALLS")"
hook 'resent update accepted' 200 "$BRK" "$SECRET" "$(start_update 700)"
[[ $(count "$DM") == 1 ]] && ok 'resent update handled once' || die 'resent update handled once' "$(cat "$CALLS")"
hook 'next update accepted' 200 "$BRK" "$SECRET" "$(start_update 701)"
[[ $(count "$DM") == 2 ]] && ok 'next update answered' || die 'next update answered' "$(cat "$CALLS")"

echo '== disconnect'
expect 'disconnect' 200 DELETE /api/broker-bot "$BT"
DISCONNECTED=1
hook 'disconnected bot ignored' 200 "$BRK" "$SECRET" "$(start_update 702)"
[[ $(count "$DM") == 2 ]] && ok 'disconnected bot silent' || die 'disconnected bot silent' "$(cat "$CALLS")"
