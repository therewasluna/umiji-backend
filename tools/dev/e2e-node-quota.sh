#!/usr/bin/env bash
# Real-traffic check of broker quotas: panel (API+worker+scheduler) + umiji/node + xray client.
set -uo pipefail
B=${B:-http://127.0.0.1:3003}
DEV=$(cd "$(dirname "$0")" && pwd); WORK=$DEV/.node-e2e; mkdir -p "$WORK"
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
PSQL=(docker exec -i umiji-dev-db-1 psql -U postgres -tAc)
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 :: ${2:-}"; }
api() { curl -s -X "$1" "$B$2" "${H[@]}" ${3:+-H "Authorization: Bearer $3"} ${4:+-d "$4"}; }
wait_for() { # desc timeout_s cmd...
  local d=$1 t=$2 start=$SECONDS; shift 2
  while (( SECONDS - start < t )); do "$@" && { ok "$d ($((SECONDS - start))s)"; return 0; }; sleep 3; done
  bad "$d" "timed out after ${t}s"; return 1
}
RUN=$RANDOM
MB=1048576

ADMIN=$(api POST /api/auth/login '' '{"username":"owner","password":"AdminPassword1234567890xyz"}' | jq -r .response.accessToken)
[[ $ADMIN != null ]] || { echo "run e2e-brokers.sh first (it registers the owner)"; exit 1; }

echo "== node"
# Leftovers from an interrupted run would point a second node record at the same container.
for n in $(api GET /api/nodes "$ADMIN" | jq -r '.response[] | select(.name | startswith("e2e-node-")) | .uuid'); do api DELETE /api/nodes/$n "$ADMIN" >/dev/null; done
for c in $(api GET /api/config-profiles "$ADMIN" | jq -r '.response.configProfiles[] | select(.name | startswith("e2e")) | .uuid'); do api DELETE /api/config-profiles/$c "$ADMIN" >/dev/null; done
KEY=$(api GET /api/keygen "$ADMIN" | jq -r .response.pubKey)
docker rm -f umiji-dev-node umiji-dev-client >/dev/null 2>&1
docker run -d --name umiji-dev-node --network host --cap-add NET_ADMIN -e NODE_PORT=2222 -e SECRET_KEY="$KEY" ghcr.io/therewasluna/umiji-node:latest >/dev/null && ok "node container started"
CFG=$(jq -n --arg run "$RUN" '{log:{loglevel:"warning"},inbounds:[{tag:("VLESS_E2E_" + $run),port:18443,listen:"127.0.0.1",protocol:"vless",settings:{clients:[],decryption:"none"},streamSettings:{network:"tcp",security:"none"}}],outbounds:[{protocol:"freedom",tag:"DIRECT"}],routing:{rules:[]}}')
PROFILE=$(api POST /api/config-profiles "$ADMIN" "$(jq -n --arg n "e2e$RUN" --argjson c "$CFG" '{name:$n,config:$c}')")
PROFILE_UUID=$(jq -r .response.uuid <<<"$PROFILE"); INBOUND=$(jq -r '.response.inbounds[0].uuid' <<<"$PROFILE")
[[ $INBOUND != null ]] && ok "config profile with inbound" || { bad "config profile" "$PROFILE"; exit 1; }
SQUAD=$(api POST /api/internal-squads "$ADMIN" "{\"name\":\"e2esq$RUN\",\"inbounds\":[\"$INBOUND\"]}" | jq -r .response.uuid)
NODE=$(api POST /api/nodes "$ADMIN" "{\"name\":\"e2e-node-$RUN\",\"address\":\"127.0.0.1\",\"port\":2222,\"configProfile\":{\"activeConfigProfileUuid\":\"$PROFILE_UUID\",\"activeInbounds\":[\"$INBOUND\"]}}" | jq -r .response.uuid)
[[ $NODE != null ]] && ok "node registered" || { bad "node registered"; exit 1; }
node_up() { [[ $(api GET /api/nodes/$NODE "$ADMIN" | jq -r .response.isConnected) == true ]]; }
wait_for "node connected" 120 node_up || exit 1

echo "== broker + user"
api POST /api/brokers "$ADMIN" "{\"username\":\"qb$RUN\",\"password\":\"BrokerPassword123456789abc\",\"trafficLimitBytes\":$((20*MB)),\"internalSquads\":[\"$SQUAD\"]}" > "$WORK/broker.json"
BRK=$(jq -r .response.uuid "$WORK/broker.json")
BT=$(api POST /api/auth/login '' "{\"username\":\"qb$RUN\",\"password\":\"BrokerPassword123456789abc\"}" | jq -r .response.accessToken)
USER=$(api POST /api/users "$BT" "{\"username\":\"qu$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\",\"activeInternalSquads\":[\"$SQUAD\"]}")
UID_=$(jq -r .response.id <<<"$USER"); VLESS=$(jq -r .response.vlessUuid <<<"$USER")
[[ $UID_ != null ]] && ok "broker created user $UID_" || { bad "user" "$USER"; exit 1; }

echo "== client"
jq -n --arg id "$VLESS" '{log:{loglevel:"warning"},inbounds:[{port:10808,listen:"127.0.0.1",protocol:"socks",settings:{udp:false}}],outbounds:[{protocol:"vless",settings:{vnext:[{address:"127.0.0.1",port:18443,users:[{id:$id,encryption:"none"}]}]},streamSettings:{network:"tcp",security:"none"}}]}' > "$WORK/client.json"
docker run -d --name umiji-dev-client --network host -v "$WORK/client.json:/etc/xray/config.json:ro" ghcr.io/xtls/xray-core:latest run -c /etc/xray/config.json >/dev/null && ok "xray client started"
# The node blocks private destinations, so pull bytes from the internet.
fetch() { curl -s --max-time 30 --socks5-hostname 127.0.0.1:10808 "https://speed.cloudflare.com/__down?bytes=$((25*MB))" -o /dev/null -w '%{size_download}'; }
proxy_works() { [[ $(fetch) == $((25*MB)) ]]; }
wait_for "traffic flows through the node for the broker's user" 60 proxy_works

echo "== quota"
broker_used() { "${PSQL[@]}" "SELECT used_traffic_bytes FROM brokers WHERE uuid='$BRK'"; }
counted() { (( $(broker_used) >= 20*MB )); }
wait_for "broker usage counted (>= 20MB)" 90 counted
user_used=$("${PSQL[@]}" "SELECT used_traffic_bytes FROM user_traffic WHERE id=$UID_")
(( user_used >= 20*MB )) && ok "user usage counted too ($user_used)" || bad "user usage" "$user_used"
status() { "${PSQL[@]}" "SELECT status FROM users WHERE id=$UID_"; }
limited() { [[ $(status) == LIMITED ]]; }
wait_for "user LIMITED after broker quota exhausted" 120 limited
blocked() { [[ $(fetch) != $((25*MB)) ]]; }
wait_for "proxy blocked for limited user" 60 blocked
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/users/$UID_/actions/reset-traffic" "${H[@]}" -H "Authorization: Bearer $BT")
[[ $code == 400 ]] && ok "broker can't reset its way out of the quota ($code)" || bad "reset bypass" "$code"
"${PSQL[@]}" "UPDATE user_traffic SET used_traffic_bytes = 0 WHERE id=$UID_" >/dev/null
sleep 50
[[ $(status) == LIMITED ]] && ok "periodic sync keeps user limited while broker is exhausted" || bad "re-activated while exhausted" "$(status)"

echo "== recovery"
api PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"trafficLimitBytes\":$((1024*MB))}" >/dev/null
active() { [[ $(status) == ACTIVE ]]; }
wait_for "user re-activated after quota raised" 30 active
wait_for "proxy works again" 90 proxy_works

echo "== no refund on delete"
before=$(broker_used)
api DELETE /api/users/$UID_ "$BT" >/dev/null
[[ $(broker_used) == "$before" ]] && ok "deleting the user keeps broker usage ($before)" || bad "refund" "$(broker_used)"

echo "== cleanup"
docker rm -f umiji-dev-node umiji-dev-client >/dev/null 2>&1
api DELETE /api/nodes/$NODE "$ADMIN" >/dev/null; api DELETE /api/brokers/$BRK "$ADMIN" >/dev/null
echo; echo "passed: $PASS  failed: $FAIL"; [[ $FAIL == 0 ]]
