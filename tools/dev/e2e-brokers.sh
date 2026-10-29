#!/usr/bin/env bash
# End-to-end checks for broker accounts against a local dev API. Usage: ./e2e-brokers.sh [base_url]
set -uo pipefail
B=${1:-http://127.0.0.1:3003}
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1 :: $2"; }
req()  { # method path token [body] -> prints "status body"
  local m=$1 p=$2 t=$3 d=${4:-}
  curl -s -o /tmp/e2e_body -w '%{http_code}' -X "$m" "$B$p" "${H[@]}" ${t:+-H "Authorization: Bearer $t"} ${d:+-d "$d"}
}
expect() { # name expected_status method path token [body]
  local name=$1 want=$2; shift 2
  local got; got=$(req "$@")
  if [[ "$got" == "$want" ]]; then ok "$name ($got)"; else bad "$name" "want $want got $got $(head -c 200 /tmp/e2e_body)"; fi
}
jqb() { jq -r "$1" /tmp/e2e_body; }

ADMIN_PASS='AdminPassword1234567890xyz'
BROKER_PASS='BrokerPassword123456789abc'
RUN=$RANDOM

echo "== admin"
st=$(req POST /api/auth/register '' "{\"username\":\"owner\",\"password\":\"$ADMIN_PASS\"}")
[[ $st == 201 || $st == 200 ]] || true
req POST /api/auth/login '' "{\"username\":\"owner\",\"password\":\"$ADMIN_PASS\"}" >/dev/null
ADMIN=$(jqb .response.accessToken); [[ $ADMIN != null ]] && ok "admin login" || { bad "admin login" "$(cat /tmp/e2e_body)"; exit 1; }

echo "== squads"
req GET /api/config-profiles '' >/dev/null
expect "create squad A" 201 POST /api/internal-squads "$ADMIN" "{\"name\":\"sqA$RUN\",\"inbounds\":[]}"; SQA=$(jqb .response.uuid)
expect "create squad B" 201 POST /api/internal-squads "$ADMIN" "{\"name\":\"sqB$RUN\",\"inbounds\":[]}"; SQB=$(jqb .response.uuid)
expect "admin creates own user" 201 POST /api/users "$ADMIN" "{\"username\":\"owneruser$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"; OWNER_USER=$(jqb .response.id)

echo "== broker CRUD (admin)"
expect "weak broker password rejected" 400 POST /api/brokers "$ADMIN" "{\"username\":\"br$RUN\",\"password\":\"short\"}"
expect "create broker" 201 POST /api/brokers "$ADMIN" "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\",\"trafficLimitBytes\":1000,\"usersLimit\":2,\"description\":\"private note\",\"internalSquads\":[\"$SQA\"]}"
BRK=$(jqb .response.uuid)
[[ $(jqb '.response.internalSquads[0].uuid') == "$SQA" ]] && ok "broker has squad A" || bad "broker squads" "$(cat /tmp/e2e_body)"
EXT=$(jqb .response.externalSquad.uuid)
[[ $(jqb .response.externalSquad.name) == "br$RUN" ]] && ok "broker got its own external squad" || bad "external squad" "$(cat /tmp/e2e_body)"
expect "owner creates a squad" 201 POST /api/external-squads "$ADMIN" "{\"name\":\"taken$RUN\"}"; OTHER_EXT=$(jqb .response.uuid)
expect "username taken by a squad name rejected" 409 POST /api/brokers "$ADMIN" "{\"username\":\"taken$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "nothing left behind by the failed create" 403 POST /api/auth/login '' "{\"username\":\"taken$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "duplicate username rejected" 409 POST /api/brokers "$ADMIN" "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "admin username can't be reused" 409 POST /api/brokers "$ADMIN" "{\"username\":\"owner\",\"password\":\"$BROKER_PASS\"}"
expect "list brokers" 200 GET /api/brokers "$ADMIN"
expect "admin cannot call /me" 403 GET /api/brokers/me "$ADMIN"

echo "== broker login"
req POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\"}" >/dev/null
BT=$(jqb .response.accessToken); [[ $BT != null ]] && ok "broker login" || { bad "broker login" "$(cat /tmp/e2e_body)"; exit 1; }
expect "wrong broker password" 403 POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"WrongPassword123456789abc\"}"
expect "broker /me" 200 GET /api/brokers/me "$BT"
[[ $(jqb .response.description) == null ]] && ok "/me hides the admin's note" || bad "/me description" "$(jqb .response.description)"
st=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/brokers/me" -H "Authorization: Bearer $BT")
[[ $st == 403 ]] && ok "broker token without browser header rejected ($st)" || bad "broker non-browser" "$st"

echo "== broker is denied admin surface"
for p in /api/nodes /api/hosts /api/internal-squads /api/external-squads /api/subscription-page-configs /api/subscription-templates /api/config-profiles /api/system/stats /api/brokers /api/tokens /api/users/stream /api/umiji-settings /api/subscription-settings /api/keygen; do
  expect "deny GET $p" 403 GET $p "$BT"
done
expect "deny bulk delete by status" 403 POST /api/users/bulk/delete-by-status "$BT" '{"status":"ACTIVE"}'
expect "deny bulk all reset" 403 POST /api/users/bulk/all/reset-traffic "$BT"
expect "deny create broker" 403 POST /api/brokers "$BT" "{\"username\":\"x$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "deny accessible nodes" 403 GET /api/users/$OWNER_USER/accessible-nodes "$BT"

echo "== broker users"
expect "disallowed squad rejected" 400 POST /api/users "$BT" "{\"username\":\"bu1$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\",\"activeInternalSquads\":[\"$SQB\"]}"
expect "create user in squad A" 201 POST /api/users "$BT" "{\"username\":\"bu1$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\",\"activeInternalSquads\":[\"$SQA\"]}"
BU1=$(jqb .response.id); [[ $(jqb .response.brokerUuid) == "$BRK" ]] && ok "user owned by broker" || bad "ownership" "$(cat /tmp/e2e_body)"
[[ $(jqb .response.externalSquadUuid) == "$EXT" ]] && ok "user gets the broker's external squad" || bad "user squad" "$(jqb .response.externalSquadUuid)"
[[ $(jqb .response.username) == "br${RUN}_bu1$RUN" ]] && ok "username gets the broker prefix" || bad "prefix" "$(jqb .response.username)"
expect "prefixed name over 36 chars rejected" 400 POST /api/users "$BT" "{\"username\":\"$(printf 'a%.0s' {1..30})\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"
expect "create second user" 201 POST /api/users "$BT" "{\"username\":\"br${RUN}_bu2$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"
[[ $(jqb .response.username) == "br${RUN}_bu2$RUN" ]] && ok "already-prefixed name kept as is" || bad "double prefix" "$(jqb .response.username)"
expect "users limit enforced" 400 POST /api/users "$BT" "{\"username\":\"bu3$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"
expect "owner allows one more user" 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"usersLimit\":3}"
for i in 1 2 3 4 5 6; do
  curl -s -o /tmp/e2e_race_$i -w '%{http_code}' -X POST "$B/api/users" "${H[@]}" -H "Authorization: Bearer $BT" \
    -d "{\"username\":\"race$i$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}" > /tmp/e2e_race_status_$i &
done; wait
CREATED=0
for i in 1 2 3 4 5 6; do
  [[ $(cat /tmp/e2e_race_status_$i) == 201 ]] || continue
  CREATED=$((CREATED+1)); req DELETE /api/users/$(jq -r .response.id /tmp/e2e_race_$i) "$ADMIN" >/dev/null
done
[[ $CREATED == 1 ]] && ok "6 parallel creates for 1 free slot: exactly 1 got in" || bad "users limit race" "$CREATED created"
expect "owner restores the limit" 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"usersLimit\":2}"
expect "broker lists users" 200 GET "/api/users?start=0&size=50" "$BT"
[[ $(jqb .response.total) == 2 ]] && ok "broker sees exactly its 2 users" || bad "list scope" "total=$(jqb .response.total)"
expect "broker reads own user" 200 GET /api/users/$BU1 "$BT"
expect "broker can't read owner's user" 404 GET /api/users/$OWNER_USER "$BT"
expect "broker can't read owner's user by username" 404 GET /api/users/by-username/owneruser$RUN "$BT"
expect "broker can't update owner's user" 404 PATCH /api/users "$BT" "{\"id\":$OWNER_USER,\"description\":\"pwned\"}"
expect "broker can't update owner's user by username" 404 PATCH /api/users "$BT" "{\"username\":\"owneruser$RUN\",\"description\":\"pwned\"}"
expect "broker can't disable owner's user" 404 POST /api/users/$OWNER_USER/actions/disable "$BT"
expect "broker can't delete owner's user" 404 DELETE /api/users/$OWNER_USER "$BT"
expect "broker can't revoke owner's user" 404 POST /api/users/$OWNER_USER/actions/revoke "$BT" '{}'
expect "broker can't extend owner's user" 404 POST /api/users/$OWNER_USER/actions/extend "$BT" '{"days":30}'
expect "broker can't reset owner's user traffic" 404 POST /api/users/$OWNER_USER/actions/reset-traffic "$BT"
expect "broker can't enable owner's user" 404 POST /api/users/$OWNER_USER/actions/enable "$BT"
expect "broker can't read owner's request history" 404 GET /api/users/$OWNER_USER/subscription-request-history "$BT"
OWNER_SHORT=$(req GET /api/users/$OWNER_USER "$ADMIN" >/dev/null; jqb .response.shortUuid)
expect "broker can't read owner's user by short uuid" 404 GET /api/users/by-short-uuid/$OWNER_SHORT "$BT"
expect "broker can't filter its way to owner's users" 200 GET "/api/users?start=0&size=50&filters=$(jq -rn '[{id:"username",value:"owneruser"}]|@uri')" "$BT"
[[ $(jqb .response.total) == 0 ]] && ok "username filter stays scoped" || bad "filter scope" "total=$(jqb .response.total)"
expect "broker can't move user to squad B" 400 PATCH /api/users "$BT" "{\"id\":$BU1,\"activeInternalSquads\":[\"$SQB\"]}"
expect "broker updates own user" 200 PATCH /api/users "$BT" "{\"id\":$BU1,\"description\":\"hello\",\"hwidDeviceLimit\":3}"
expect "broker edit ignores external squad" 200 PATCH /api/users "$BT" "{\"id\":$BU1,\"externalSquadUuid\":\"$OTHER_EXT\"}"
[[ $(jqb .response.externalSquadUuid) == "$EXT" ]] && ok "user keeps the broker's squad" || bad "squad changed" "$(jqb .response.externalSquadUuid)"
expect "broker disables own user" 200 POST /api/users/$BU1/actions/disable "$BT"
expect "broker enables own user" 200 POST /api/users/$BU1/actions/enable "$BT"
expect "broker tags" 200 GET /api/users/tags "$BT"
expect "broker reads own user's devices" 200 GET /api/hwid/devices/$BU1 "$BT"
expect "broker can't read owner's user devices" 404 GET /api/hwid/devices/$OWNER_USER "$BT"
expect "broker can't wipe owner's user devices" 404 POST /api/hwid/devices/delete-all "$BT" "{\"userId\":$OWNER_USER}"
expect "broker wipes own user's devices" 200 POST /api/hwid/devices/delete-all "$BT" "{\"userId\":$BU1}"
expect "deny global hwid list" 403 GET "/api/hwid/devices?start=0&size=10" "$BT"
expect "admin sees broker user" 200 GET /api/users/$BU1 "$ADMIN"
expect "admin filters users by broker" 200 GET "/api/users?start=0&size=50&filters=$(jq -rn --arg b "$BRK" '[{id:"brokerUuid",value:$b}]|@uri')" "$ADMIN"
[[ $(jqb .response.total) == 2 ]] && ok "admin broker filter returns 2" || bad "admin broker filter" "total=$(jqb .response.total)"

echo "== broker bulk actions"
OWNER_BEFORE=$(req GET /api/users/$OWNER_USER "$ADMIN" >/dev/null; jq -c '.response | {shortUuid, expireAt, description}' /tmp/e2e_body)
BU1_BEFORE=$(req GET /api/users/$BU1 "$ADMIN" >/dev/null; jq -c '.response | {shortUuid, expireAt}' /tmp/e2e_body)
expect "bulk squads outside the allowlist rejected" 400 POST /api/users/bulk/update-squads "$BT" "{\"userIds\":[$BU1],\"activeInternalSquads\":[\"$SQB\"]}"
expect "bulk squads within the allowlist" 204 POST /api/users/bulk/update-squads "$BT" "{\"userIds\":[$BU1,$OWNER_USER],\"activeInternalSquads\":[\"$SQA\"]}"
expect "bulk extend" 204 POST /api/users/bulk/extend-expiration-date "$BT" "{\"userIds\":[$BU1,$OWNER_USER],\"extendDays\":30}"
expect "bulk update" 202 POST /api/users/bulk/update "$BT" "{\"userIds\":[$BU1,$OWNER_USER],\"fields\":{\"description\":\"bulk$RUN\",\"externalSquadUuid\":\"$OTHER_EXT\"}}"
expect "bulk revoke" 202 POST /api/users/bulk/revoke-subscription "$BT" "{\"userIds\":[$BU1,$OWNER_USER]}"
expect "bulk delete of someone else's user" 204 POST /api/users/bulk/delete "$BT" "{\"userIds\":[$OWNER_USER]}"
sleep 4 # update and revoke run in the background queue
req GET /api/users/$OWNER_USER "$ADMIN" >/dev/null
[[ $(jq -c '.response | {shortUuid, expireAt, description}' /tmp/e2e_body) == "$OWNER_BEFORE" ]] && ok "owner's user untouched by broker bulk actions" || bad "owner user changed" "$OWNER_BEFORE -> $(jq -c '.response | {shortUuid, expireAt, description}' /tmp/e2e_body)"
[[ $(jq -r '[.response.activeInternalSquads[].uuid] | index("'"$SQA"'")' /tmp/e2e_body) == null ]] && ok "owner's user squads untouched" || bad "owner squads" "$(jq -c .response.activeInternalSquads /tmp/e2e_body)"
req GET /api/users/$BU1 "$ADMIN" >/dev/null
[[ $(jqb .response.description) == "bulk$RUN" ]] && ok "bulk update reached the broker's user" || bad "bulk update" "$(jqb .response.description)"
[[ $(jqb .response.externalSquadUuid) == "$EXT" ]] && ok "bulk update keeps the broker's squad" || bad "bulk squad" "$(jqb .response.externalSquadUuid)"
[[ $(jqb .response.shortUuid) != $(jq -r .shortUuid <<<"$BU1_BEFORE") ]] && ok "bulk revoke reached the broker's user" || bad "bulk revoke" "shortUuid unchanged"
[[ $(jqb .response.expireAt) != $(jq -r .expireAt <<<"$BU1_BEFORE") ]] && ok "bulk extend reached the broker's user" || bad "bulk extend" "expireAt unchanged"
expect "deny bulk all update" 403 POST /api/users/bulk/all/update "$BT" '{"description":"x"}'
expect "deny bulk all extend" 403 POST /api/users/bulk/all/extend-expiration-date "$BT" '{"extendDays":1}'

echo "== broker status"
expect "broker /me with stats" 200 GET /api/brokers/me "$BT"
[[ $(jqb .response.users.totalUsers) == 2 && $(jqb .response.users.statusCounts.ACTIVE) == 2 ]] && ok "stats count only the broker's users" || bad "stats" "$(jq -c .response.users /tmp/e2e_body)"
[[ $(jqb '.response.internalSquads[0].membersCount') == 1 ]] && ok "squad member count is scoped" || bad "squad members" "$(jq -c .response.internalSquads /tmp/e2e_body)"
CFG=$(jqb .response.subpageConfigUuid); [[ $CFG != null ]] && ok "broker has an editable subscription page" || bad "subpage" "$(cat /tmp/e2e_body)"

echo "== broker subscription"
expect "broker reads its squad" 200 GET /api/external-squads/$EXT "$BT"
expect "broker can't read another squad" 404 GET /api/external-squads/$OTHER_EXT "$BT"
expect "broker brands its squad" 200 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"responseHeadersAdd\":{\"profile-title\":\"Nova\"},\"subscriptionSettings\":{\"randomizeHosts\":true}}"
expect "broker edits remarks" 200 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"customRemarks\":null}"
expect "broker can't rename its squad" 400 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"name\":\"x$RUN\"}"
expect "broker can't set templates" 400 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"templates\":[]}"
expect "broker can't set HWID settings" 400 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"hwidSettings\":null}"
expect "broker can't relink the page" 400 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"subpageConfigUuid\":null}"
expect "broker can't edit another squad" 404 PATCH /api/external-squads "$BT" "{\"uuid\":\"$OTHER_EXT\",\"responseHeadersAdd\":{}}"
expect "broker reads its page config" 200 GET /api/subscription-page-configs/$CFG "$BT"
jq -c --arg u "$CFG" '{uuid:$u, config:.response.config}' /tmp/e2e_body > /tmp/e2e_cfg
expect "broker saves its page config" 200 PATCH /api/subscription-page-configs "$BT" "@/tmp/e2e_cfg"
# The subscription page and the owner's editor render these as raw HTML.
for edit in \
  '.config.svgLibrary.Evil = "<svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"x\" onerror=\"alert(1)\"/></svg>"' \
  '.config.baseSettings.metaTitle = "</title><script>alert(1)</script>"' \
  '.config.baseSettings.metaDescription = "x\" http-equiv=\"refresh"' \
  '(.config.platforms[] | .apps[0].blocks[0].description[]) |= "<img src=x onerror=alert(1)>"' \
  '(.config.platforms[] | .apps[0].blocks[0].buttons[0].link) |= "javascript:alert(1)"'; do
  jq -c "$edit" /tmp/e2e_cfg > /tmp/e2e_cfg_bad
  expect "unsafe page content refused: ${edit:0:40}" 400 PATCH /api/subscription-page-configs "$BT" "@/tmp/e2e_cfg_bad"
  grep -q 'only plain icons' /tmp/e2e_body && ok "  refused by the broker content check" || bad "refusal reason" "$(head -c 200 /tmp/e2e_body)"
done
expect "broker can't rename its page config" 400 PATCH /api/subscription-page-configs "$BT" "{\"uuid\":\"$CFG\",\"name\":\"x$RUN\"}"
expect "broker can't read the default page" 404 GET /api/subscription-page-configs/00000000-0000-0000-0000-000000000000 "$BT"
expect "broker can't edit the default page" 404 PATCH /api/subscription-page-configs "$BT" "{\"uuid\":\"00000000-0000-0000-0000-000000000000\",\"name\":\"xx\"}"
expect "owner links another squad to the broker page" 200 PATCH /api/external-squads "$ADMIN" "{\"uuid\":\"$OTHER_EXT\",\"subpageConfigUuid\":\"$CFG\"}"
expect "shared page becomes read-only for the broker" 404 GET /api/subscription-page-configs/$CFG "$BT"
expect "owner unlinks it again" 200 PATCH /api/external-squads "$ADMIN" "{\"uuid\":\"$OTHER_EXT\",\"subpageConfigUuid\":null}"
expect "broker page editable again" 200 GET /api/subscription-page-configs/$CFG "$BT"

echo "== quota"
PSQL=(docker exec -i umiji-dev-db-1 psql -U postgres -tAc)
"${PSQL[@]}" "UPDATE brokers SET used_traffic_bytes = 1000 WHERE uuid = '$BRK'" >/dev/null
expect "exhausted broker can't create" 400 POST /api/users "$BT" "{\"username\":\"bu4$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"
expect "exhausted broker can't enable" 400 POST /api/users/$BU1/actions/enable "$BT"
expect "exhausted broker can still read" 200 GET /api/users/$BU1 "$BT"
expect "exhausted broker can't bulk reset" 400 POST /api/users/bulk/reset-traffic "$BT" "{\"userIds\":[$BU1]}"
expect "exhausted broker can't bulk extend" 400 POST /api/users/bulk/extend-expiration-date "$BT" "{\"userIds\":[$BU1],\"extendDays\":1}"
expect "exhausted broker can still bulk revoke" 202 POST /api/users/bulk/revoke-subscription "$BT" "{\"userIds\":[$BU1]}"
"${PSQL[@]}" "UPDATE users SET status = 'EXPIRED', expire_at = now() - interval '1 day' WHERE id = $BU1" >/dev/null
expect "owner extends an expired user of the exhausted broker" 204 POST /api/users/bulk/extend-expiration-date "$ADMIN" "{\"userIds\":[$BU1],\"extendDays\":30}"
req GET /api/users/$BU1 "$ADMIN" >/dev/null; [[ $(jqb .response.status) == EXPIRED ]] && ok "it stays down while the broker is out of quota" || bad "quota bypass" "status=$(jqb .response.status)"
expect "admin resets broker usage" 200 POST /api/brokers/$BRK/actions/reset-traffic "$ADMIN"
[[ $(jqb .response.usedTrafficBytes) == 0 ]] && ok "usage reset to 0" || bad "reset" "$(cat /tmp/e2e_body)"
req GET /api/users/$BU1 "$ADMIN" >/dev/null; [[ $(jqb .response.status) == ACTIVE ]] && ok "it comes back with the broker" || bad "not back" "status=$(jqb .response.status)"

echo "== restart safety"
# The startup seed (run on every container start) must keep brokers.
BACKEND_DIR=${BACKEND_DIR:-}
for d in "$(dirname "$0")/../.." "$(dirname "$0")/../backend"; do
  [[ -z $BACKEND_DIR && -f $d/prisma/seed/seeders/12_verify-admin.ts ]] && BACKEND_DIR=$d
done
if [[ -n $BACKEND_DIR ]]; then
  (cd "$BACKEND_DIR" && npm run -s migrate:seed:dev >/dev/null 2>&1)
  expect "broker survives the startup seed" 200 GET /api/brokers/$BRK "$ADMIN"
else
  echo "  skip (set BACKEND_DIR to run the seed check)"
fi

echo "== lifecycle"
expect "admin disables broker" 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"isDisabled\":true}"
expect "disabled broker token rejected" 403 GET /api/brokers/me "$BT"
expect "disabled broker can't log in" 403 POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "admin re-enables + sets expiry in past" 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"isDisabled\":false,\"expireAt\":\"2020-01-01T00:00:00.000Z\"}"
expect "expired broker can still sign in" 200 POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "expired broker can still read" 200 GET /api/users/$BU1 "$BT"
expect "expired broker can't create users" 400 POST /api/users "$BT" "{\"username\":\"bu5$RUN\",\"expireAt\":\"2030-01-01T00:00:00.000Z\"}"
[[ $(jqb .errorCode) == A269 ]] && ok "error says the account expired" || bad "expired error" "$(cat /tmp/e2e_body)"
expect "expired broker can't disable users" 400 POST /api/users/$BU1/actions/disable "$BT"
expect "expired broker can't edit its squad" 400 PATCH /api/external-squads "$BT" "{\"uuid\":\"$EXT\",\"customRemarks\":null}"
status=""; for _ in $(seq 1 25); do req GET /api/users/$BU1 "$ADMIN" >/dev/null; status=$(jqb .response.status); [[ $status == EXPIRED ]] && break; sleep 3; done
[[ $status == EXPIRED ]] && ok "broker expiry expires its users" || bad "users not expired" "status=$status"
req GET /api/users/$OWNER_USER "$ADMIN" >/dev/null; [[ $(jqb .response.status) == ACTIVE ]] && ok "owner's users unaffected" || bad "owner user" "$(jqb .response.status)"
expect "admin clears expiry, changes password" 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"expireAt\":null,\"password\":\"NewBrokerPassword123456789\"}"
req GET /api/users/$BU1 "$ADMIN" >/dev/null; [[ $(jqb .response.status) == ACTIVE ]] && ok "extending the broker brings its users back" || bad "users not back" "$(jqb .response.status)"
expect "old password fails" 403 POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"$BROKER_PASS\"}"
expect "new password works" 200 POST /api/auth/login '' "{\"username\":\"br$RUN\",\"password\":\"NewBrokerPassword123456789\"}"
expect "delete broker" 204 DELETE /api/brokers/$BRK "$ADMIN"
expect "deleted broker token rejected" 403 GET /api/brokers/me "$BT"
expect "users survive broker deletion" 200 GET /api/users/$BU1 "$ADMIN"
[[ $(jqb .response.brokerUuid) == null ]] && ok "user moved to admin" || bad "orphan" "$(cat /tmp/e2e_body)"
[[ $(jqb .response.externalSquadUuid) == "$EXT" ]] && ok "user keeps the broker's subscription branding" || bad "squad after delete" "$(jqb .response.externalSquadUuid)"
expect "owner account untouched" 200 POST /api/auth/login '' "{\"username\":\"owner\",\"password\":\"$ADMIN_PASS\"}"

echo; echo "passed: $PASS  failed: $FAIL"; [[ $FAIL == 0 ]]
