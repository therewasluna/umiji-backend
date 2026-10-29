#!/usr/bin/env bash
# Demo data for screenshots / manual testing: named squads, three brokers in different states, broker users.
set -uo pipefail
B=${B:-http://127.0.0.1:3003}
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
api() { curl -s -X "$1" "$B$2" "${H[@]}" ${3:+-H "Authorization: Bearer $3"} ${4:+-d "$4"}; }
PSQL=(docker exec -i umiji-dev-db-1 psql -U postgres -tAc)
GB=1073741824
ADMIN=$(api POST /api/auth/login '' '{"username":"owner","password":"AdminPassword1234567890xyz"}' | jq -r .response.accessToken)
sq() { api POST /api/internal-squads "$ADMIN" "{\"name\":\"$1\",\"inbounds\":[]}" >/dev/null; api GET /api/internal-squads "$ADMIN" | jq -r --arg n "$1" '.response.internalSquads[] | select(.name==$n) | .uuid'; }
DE=$(sq Germany); NL=$(sq Netherlands); FI=$(sq Finland-Premium); sq Owner-Only >/dev/null
bash "$(dirname "$0")/seed-demo-infra.sh" >/dev/null
exp=$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%S.000Z)
mk() { api POST /api/brokers "$ADMIN" "$1" | jq -r .response.uuid; }
B1=$(mk "{\"username\":\"nova-seller\",\"password\":\"DemoBrokerPassword123456789\",\"trafficLimitBytes\":$((500*GB)),\"usersLimit\":50,\"expireAt\":\"$exp\",\"description\":\"Tehran resale partner\",\"internalSquads\":[\"$DE\",\"$NL\"]}")
B2=$(mk "{\"username\":\"orbit-vpn\",\"password\":\"DemoBrokerPassword123456789\",\"trafficLimitBytes\":$((100*GB)),\"internalSquads\":[\"$DE\",\"$NL\",\"$FI\"]}")
B3=$(mk "{\"username\":\"legacy-reseller\",\"password\":\"DemoBrokerPassword123456789\",\"trafficLimitBytes\":$((50*GB)),\"usersLimit\":10,\"internalSquads\":[\"$NL\"]}")
api PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$B3\",\"isDisabled\":true}" >/dev/null
BT=$(api POST /api/auth/login '' '{"username":"nova-seller","password":"DemoBrokerPassword123456789"}' | jq -r .response.accessToken)
for u in alice-m bob_k chen.w dariush sara-p mehdi77 lena-v omid_r; do
  u=${u//./-}
  api POST /api/users "$BT" "{\"username\":\"$u\",\"expireAt\":\"$(date -u -d "+$((RANDOM%60+5)) days" +%Y-%m-%dT%H:%M:%S.000Z)\",\"trafficLimitBytes\":$(( (RANDOM%4+1)*25*GB )),\"activeInternalSquads\":[\"$DE\"],\"tag\":\"PREMIUM\"}" >/dev/null
done
"${PSQL[@]}" "UPDATE brokers SET used_traffic_bytes = $((187*GB)) WHERE uuid='$B1'; UPDATE brokers SET used_traffic_bytes = $((100*GB)) WHERE uuid='$B2'; UPDATE user_traffic t SET used_traffic_bytes = (random()*20*$GB)::bigint, lifetime_used_traffic_bytes = (random()*20*$GB)::bigint + $((20*GB)), online_at = now() - (random()*interval '3 hours') FROM users u WHERE u.id=t.id AND u.broker_uuid='$B1';" >/dev/null
echo "brokers: $B1 $B2 $B3"
