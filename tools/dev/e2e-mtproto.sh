#!/usr/bin/env bash
# Real check of the MTProto inbound: panel (API+worker+scheduler) + umiji/node + Telegram itself.
# It asks Telegram for an auth key through the proxy (no account needed) and expects Telegram's answer.
#
# Needs: the backend running (tools/dev/run-backend.sh), a node image with the overlay, and the test client:
#   node/scripts/xray-overlay.sh /tmp/xray && cd /tmp/xray && go test -c -o /tmp/mtproto.test ./proxy/mtproto/
# Env: MTPROTO_TEST (client), NODE_IMAGE, DC_PROXY (host:port of an HTTP proxy, if this network filters Telegram)
#
# Sponsored channel mode runs every check below through Telegram's real middle proxies:
#   AD_PUBLIC_IP   this machine's public IPv4 (turns the mode on, and the route must be direct, so no DC_PROXY)
#   TEST_RUN       which Telegram paths to ask, e.g. 'TestLiveTelegram$/^dc203$' if only DC 203's proxy on port 443 is reachable
#   LIST_PROXY     HTTP proxy the node fetches Telegram's middle proxy list through, if this network filters it
set -uo pipefail
B=${B:-http://127.0.0.1:3003}
TEST_BIN=${MTPROTO_TEST:-/tmp/mtproto.test}
NODE_IMAGE=${NODE_IMAGE:-ghcr.io/therewasluna/umiji-node:latest}
DC_PROXY=${DC_PROXY:-}
AD_PUBLIC_IP=${AD_PUBLIC_IP:-}
AD_TAG=abcdefabcdefabcdefabcdefabcdef01
TEST_RUN=${TEST_RUN:-TestLiveTelegram\$}
LIST_PROXY=${LIST_PROXY:-}
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
PORT=18443
DOMAIN=github.com

[[ -x $TEST_BIN ]] || { echo "build the test client first, see the top of this file"; exit 1; }
ADMIN=$(api POST /api/auth/login '' '{"username":"owner","password":"AdminPassword1234567890xyz"}' | jq -r .response.accessToken)
[[ $ADMIN != null ]] || { echo "run e2e-brokers.sh first (it registers the owner)"; exit 1; }

# Asks Telegram through the proxy with the secret from a user's link.
reaches_telegram() { [[ -n $1 ]] && MTPROTO_ADDRESS=127.0.0.1:$PORT MTPROTO_LINK_SECRET=$1 "$TEST_BIN" -test.run "$TEST_RUN" >/dev/null 2>&1; }
link_of() { curl -s "$B/api/sub/$1/info" | jq -r '.response.links[]? | select(startswith("tg://"))'; }
secret_of() { sed -n 's/.*[?&]secret=\([0-9a-f]*\).*/\1/p' <<<"$1"; }

echo "== config validation"
outbound='{"protocol":"freedom","tag":"DIRECT"}'
[[ -n $DC_PROXY ]] && outbound=$(jq -nc --arg h "${DC_PROXY%:*}" --argjson p "${DC_PROXY##*:}" '{protocol:"http",tag:"PROXY",settings:{servers:[{address:$h,port:$p}]}}')
profile_with() { jq -nc --arg n "e2e$RUN$2" --argjson i "$1" --argjson o "$outbound" '{name:$n,config:{log:{loglevel:"warning"},inbounds:[$i],outbounds:[$o],routing:{rules:[]}}}'; }
for c in $(api GET /api/config-profiles "$ADMIN" | jq -r '.response.configProfiles[] | select(.name | startswith("e2e")) | .uuid'); do api DELETE /api/config-profiles/$c "$ADMIN" >/dev/null; done
for n in $(api GET /api/nodes "$ADMIN" | jq -r '.response[] | select(.name | startswith("e2e-node-")) | .uuid'); do api DELETE /api/nodes/$n "$ADMIN" >/dev/null; done
TAG=TG_E2E_$RUN
no_domain=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(jq -nc --arg t "$TAG" '{tag:$t,port:18443,protocol:"mtproto",settings:{clients:[]}}')" a)")
[[ $(jq -r .response.uuid <<<"$no_domain") == null ]] && ok "profile without a domain is refused" || bad "no domain" "$no_domain"
with_tls=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(jq -nc --arg t "$TAG" '{tag:$t,port:18443,protocol:"mtproto",settings:{clients:[],domain:"github.com"},streamSettings:{network:"tcp",security:"tls"}}')" b)")
[[ $(jq -r .response.uuid <<<"$with_tls") == null ]] && ok "profile with TLS on top is refused" || bad "with tls" "$with_tls"
# Xray accepts all of these, then they do nothing or no Telegram app can connect, so the panel has to catch them.
inbound_with() { jq -nc --arg t "$TAG" --argjson e "$1" '{tag:$t,port:18443,protocol:"mtproto",settings:{clients:[],domain:"github.com"}} + $e'; }
for extra in \
  '{"streamSettings":{"finalmask":{"tcp":[{"type":"header-custom"}]}}}' \
  '{"streamSettings":{"rawSettings":{"header":{"type":"http"}}}}' \
  '{"streamSettings":{"sockopt":{"acceptProxyProtocol":true}}}' \
  '{"streamSettings":{"sockopt":{"tproxy":"tproxy"}}}' \
  '{"sniffing":{"enabled":true,"destOverride":["tls"]}}' \
  '{"settings":{"clients":[],"domain":"github.com","fallbacks":[{"dest":80}]}}'; do
  refused=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(inbound_with "$extra")" e)")
  [[ $(jq -r .response.uuid <<<"$refused") == null ]] && ok "profile refused: $extra" || bad "not refused: $extra" "$refused"
done
# The same inbound with only server-side TCP tuning has to pass, or the refusals above prove nothing.
tuned=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(inbound_with '{"streamSettings":{"network":"raw","security":"none","finalmask":{},"sockopt":{"tcpFastOpen":true,"acceptProxyProtocol":false}},"sniffing":{"enabled":false}}')" e)")
tuned_uuid=$(jq -r .response.uuid <<<"$tuned")
[[ $tuned_uuid != null ]] && ok "profile with TCP tuning only is accepted" || bad "tuned" "$tuned"
api DELETE /api/config-profiles/$tuned_uuid "$ADMIN" >/dev/null
# A bad value here would stop the core from starting and take the whole node down.
bad_tag=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(jq -nc --arg t "$TAG" '{tag:$t,port:18443,protocol:"mtproto",settings:{clients:[],domain:"github.com",adTag:"not-hex"}}')" c)")
[[ $(jq -r .response.uuid <<<"$bad_tag") == null ]] && ok "profile with a malformed adTag is refused" || bad "bad tag" "$bad_tag"
bad_ip=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(jq -nc --arg t "$TAG" --arg a "$AD_TAG" '{tag:$t,port:18443,protocol:"mtproto",settings:{clients:[],domain:"github.com",adTag:$a,publicIp:"nope"}}')" d)")
[[ $(jq -r .response.uuid <<<"$bad_ip") == null ]] && ok "profile with a malformed publicIp is refused" || bad "bad ip" "$bad_ip"

echo "== node, from nothing but a config"
KEY=$(api GET /api/keygen "$ADMIN" | jq -r .response.pubKey)
docker rm -f umiji-dev-node >/dev/null 2>&1
NODE_ENV_ARGS=()
[[ -n $LIST_PROXY ]] && NODE_ENV_ARGS=(-e "HTTPS_PROXY=$LIST_PROXY")
docker run -d --name umiji-dev-node --network host --cap-add NET_ADMIN -e NODE_PORT=2222 -e SECRET_KEY="$KEY" "${NODE_ENV_ARGS[@]}" "$NODE_IMAGE" >/dev/null && ok "node container started"
INBOUND_JSON=$(jq -nc --arg t "$TAG" --arg d "$DOMAIN" --argjson p "$PORT" '{tag:$t,port:$p,listen:"127.0.0.1",protocol:"mtproto",settings:{clients:[],domain:$d}}')
[[ -n $AD_PUBLIC_IP ]] && INBOUND_JSON=$(jq -c --arg a "$AD_TAG" --arg i "$AD_PUBLIC_IP" '.settings += {adTag:$a,publicIp:$i}' <<<"$INBOUND_JSON")
PROFILE=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$INBOUND_JSON" '')")
PROFILE_UUID=$(jq -r .response.uuid <<<"$PROFILE"); INBOUND=$(jq -r '.response.inbounds[0].uuid' <<<"$PROFILE")
[[ $INBOUND != null ]] && ok "profile saved, panel lists the inbound" || { bad "profile" "$PROFILE"; exit 1; }
SQUAD=$(api POST /api/internal-squads "$ADMIN" "{\"name\":\"e2etg$RUN\",\"inbounds\":[\"$INBOUND\"]}" | jq -r .response.uuid)
NODE=$(api POST /api/nodes "$ADMIN" "{\"name\":\"e2e-node-$RUN\",\"address\":\"127.0.0.1\",\"port\":2222,\"configProfile\":{\"activeConfigProfileUuid\":\"$PROFILE_UUID\",\"activeInbounds\":[\"$INBOUND\"]}}" | jq -r .response.uuid)
[[ $NODE != null ]] && ok "node registered" || { bad "node registered"; exit 1; }
node_up() { [[ $(api GET /api/nodes/$NODE "$ADMIN" | jq -r .response.isConnected) == true ]]; }
wait_for "node connected, core running" 120 node_up || exit 1
HOST=$(api POST /api/hosts "$ADMIN" "$(jq -nc --arg i "$INBOUND" --arg p "$PROFILE_UUID" --arg r "Telegram DE $RUN" --argjson port "$PORT" '{inbound:{configProfileUuid:$p,configProfileInboundUuid:$i},remark:$r,address:"127.0.0.1",port:$port}')")
HOST_UUID=$(jq -r .response.uuid <<<"$HOST")
[[ $HOST_UUID != null ]] && ok "host created" || bad "host" "$HOST"

echo "== Telegram hosts only take what a tg:// link can carry"
TG_INBOUND=$(jq -nc --arg p "$PROFILE_UUID" --arg i "$INBOUND" '{configProfileUuid:$p,configProfileInboundUuid:$i}')
refused_host() { [[ $(jq -r .errorCode <<<"$2") == A285 ]] && ok "$1" || bad "$1" "$2"; }
refused_host "new host with an SNI is refused" "$(api POST /api/hosts "$ADMIN" "$(jq -nc --argjson i "$TG_INBOUND" --arg r "Refused $RUN" '{inbound:$i,remark:$r,address:"127.0.0.1",port:18443,sni:"example.com"}')")"
refused_host "host can't get a final mask" "$(api PATCH /api/hosts "$ADMIN" "$(jq -nc --arg u "$HOST_UUID" '{uuid:$u,finalMask:{tcp:[{type:"fragment"}]}}')")"
refused_host "bulk edit can't give it an ALPN" "$(api PATCH /api/hosts/bulk/update "$ADMIN" "$(jq -nc --arg u "$HOST_UUID" '{uuids:[$u],alpn:"h2"}')")"
kept=$(api PATCH /api/hosts "$ADMIN" "$(jq -nc --arg u "$HOST_UUID" '{uuid:$u,isHidden:false,sni:"",muxParams:null,securityLayer:"DEFAULT"}')")
[[ $(jq -r .response.uuid <<<"$kept") == "$HOST_UUID" ]] && ok "saving it with empty options still works" || bad "empty options" "$kept"
# A host moved onto the inbound loses what its old protocol left behind, and gets it back when moved off.
VL_PROFILE=$(api POST /api/config-profiles "$ADMIN" "$(profile_with "$(jq -nc --arg t "VL_$RUN" '{tag:$t,port:18556,protocol:"vless",settings:{clients:[],decryption:"none"}}')" v)")
VL_INBOUND=$(jq -c '{configProfileUuid:.response.uuid,configProfileInboundUuid:.response.inbounds[0].uuid}' <<<"$VL_PROFILE")
VL_HOST=$(api POST /api/hosts "$ADMIN" "$(jq -nc --argjson i "$VL_INBOUND" --arg r "Moved $RUN" '{inbound:$i,remark:$r,address:"127.0.0.1",port:18556,sni:"example.com",muxParams:{enabled:true}}')" | jq -r .response.uuid)
moved=$(api PATCH /api/hosts "$ADMIN" "$(jq -nc --arg u "$VL_HOST" --argjson i "$TG_INBOUND" '{uuid:$u,inbound:$i}')")
[[ $(jq -c '[.response.sni,.response.muxParams]' <<<"$moved") == '[null,null]' ]] && ok "moving a host onto it clears its old options" || bad "moved" "$moved"
back=$(api PATCH /api/hosts "$ADMIN" "$(jq -nc --arg u "$VL_HOST" --argjson i "$VL_INBOUND" '{uuid:$u,inbound:$i,sni:"example.com"}')")
[[ $(jq -r .response.sni <<<"$back") == example.com ]] && ok "moving it off allows them again" || bad "moved back" "$back"
api PATCH /api/hosts/bulk/update "$ADMIN" "$(jq -nc --arg u "$VL_HOST" --argjson i "$TG_INBOUND" '{uuids:[$u],inbound:$i}')" >/dev/null
[[ $(api GET /api/hosts/$VL_HOST "$ADMIN" | jq -r .response.sni) == null ]] && ok "bulk moving a host onto it clears them too" || bad "bulk moved"
api DELETE /api/hosts/$VL_HOST "$ADMIN" >/dev/null; api DELETE /api/config-profiles/$(jq -r .configProfileUuid <<<"$VL_INBOUND") "$ADMIN" >/dev/null

echo "== user added to a running node"
LIMIT=3000
USER=$(api POST /api/users "$ADMIN" "$(jq -nc --arg u "tg$RUN" --arg s "$SQUAD" --argjson l "$LIMIT" '{username:$u,expireAt:"2030-01-01T00:00:00.000Z",trafficLimitBytes:$l,activeInternalSquads:[$s]}')")
UID_=$(jq -r .response.id <<<"$USER"); SHORT=$(jq -r .response.shortUuid <<<"$USER"); VLESS=$(jq -r .response.vlessUuid <<<"$USER")
[[ $UID_ != null ]] && ok "user $UID_ created" || { bad "user" "$USER"; exit 1; }

echo "== subscription"
LINK=$(link_of "$SHORT"); SECRET=$(secret_of "$LINK")
[[ $LINK == tg://proxy\?server=127.0.0.1\&port=$PORT\&secret=ee* ]] && ok "subscription info has a tg:// link" || bad "link" "$LINK"
[[ $LINK == *remark=Telegram%20DE%20$RUN ]] && ok "link carries the host's name" || bad "remark" "$LINK"
[[ $LINK != *\#* ]] && ok "link has no # that would break it in Telegram" || bad "fragment" "$LINK"
[[ $SECRET == *$(printf %s "$DOMAIN" | od -An -tx1 | tr -d ' \n') ]] && ok "secret ends with the inbound's domain" || bad "domain in secret" "$SECRET"
[[ $SECRET != *${VLESS//-/}* ]] && ok "secret doesn't expose the VLESS UUID" || bad "uuid leak" "$SECRET"
curl -s "$B/api/sub/$SHORT" | base64 -d 2>/dev/null | grep -q 'tg://' && bad "VPN apps got a tg:// line" || ok "VPN apps' subscription has no tg:// line"
[[ $(api GET /api/subscriptions/by-short-uuid/$SHORT/raw "$ADMIN" | jq -r '.response.resolvedProxyConfigs[0].protocol') == mtproto ]] && ok "raw subscription passes the contract" || bad "raw" "$(api GET /api/subscriptions/by-short-uuid/$SHORT/raw "$ADMIN" | head -c 200)"

echo "== traffic"
wait_for "Telegram answers through the proxy with the user's link" 30 reaches_telegram "$SECRET" || { docker logs --tail 30 umiji-dev-node; exit 1; }
reaches_telegram "${SECRET:0:2}00000000000000000000000000000000${SECRET:34}" && bad "a wrong secret reached Telegram" || ok "a wrong secret doesn't reach Telegram"
tls=$(curl -sS -o /dev/null -w '%{ssl_verify_result}' --max-time 15 --resolve "$DOMAIN:$PORT:127.0.0.1" "https://$DOMAIN:$PORT/" 2>&1)
[[ $tls == 0 ]] && ok "a stranger sees the real $DOMAIN with a valid certificate" || bad "fronting" "$tls"
used() { "${PSQL[@]}" "SELECT used_traffic_bytes FROM user_traffic WHERE id=$UID_"; }
counted() { (( $(used) > 0 )); }
wait_for "usage is counted against the user" 90 counted
[[ -n $("${PSQL[@]}" "SELECT online_at FROM user_traffic WHERE id=$UID_") ]] && ok "user shows as online" || bad "online_at"
if [[ -n $AD_PUBLIC_IP ]]; then
  # Without this, a silent fallback to the direct path would still pass everything below.
  # The first seconds after the core starts go direct, until Telegram's list has loaded.
  core_log() { docker exec umiji-dev-node sh -c 'cat /var/log/xray/current 2>/dev/null'; }
  middle_count() { core_log | grep -acF '(middle proxy)]'; }
  via_middle() { reaches_telegram "$SECRET"; (( $(middle_count) > 0 )); }
  wait_for "traffic really goes through a middle proxy" 30 via_middle
  core_log | grep -aqF 'using the direct path' && bad "fell back to the direct path" "$(core_log | grep -aF 'using the direct path' | head -1)" || ok "no fallback to the direct path"
fi

echo "== usage limit"
status() { "${PSQL[@]}" "SELECT status FROM users WHERE id=$UID_"; }
use_up() { reaches_telegram "$SECRET"; [[ $(status) == LIMITED ]]; }
[[ -n $AD_PUBLIC_IP ]] && before=$(middle_count)
wait_for "user goes LIMITED at $LIMIT bytes" 180 use_up
if [[ -n $AD_PUBLIC_IP ]]; then
  used_middle=$(( $(middle_count) - before ))
  (( used_middle >= 5 )) && ok "that usage went through the middle proxy ($used_middle connections)" || bad "limit reached without the middle proxy" "$used_middle"
fi
blocked() { ! reaches_telegram "$SECRET"; }
wait_for "limited user no longer reaches Telegram" 60 blocked
api POST /api/users/$UID_/actions/reset-traffic "$ADMIN" >/dev/null
works() { reaches_telegram "$SECRET"; }
wait_for "works again after a traffic reset" 90 works
api PATCH /api/users "$ADMIN" "$(jq -nc --argjson i "$UID_" '{id:$i,trafficLimitBytes:0}')" >/dev/null

echo "== revoke"
api POST /api/users/$UID_/actions/revoke "$ADMIN" '{}' >/dev/null
NEW_SHORT=$(api GET /api/users/$UID_ "$ADMIN" | jq -r .response.shortUuid)
NEW_SECRET=$(secret_of "$(link_of "$NEW_SHORT")")
[[ -n $NEW_SECRET && $NEW_SECRET != "$SECRET" ]] && ok "revoking gives a new secret" || bad "rotation" "$NEW_SECRET"
old_dead() { ! reaches_telegram "$SECRET"; }
wait_for "the old link stops working" 60 old_dead
new_works() { reaches_telegram "$NEW_SECRET"; }
wait_for "the new link works" 60 new_works

echo "== node restart: users come back from the generated config"
api POST /api/nodes/$NODE/actions/restart "$ADMIN" >/dev/null
sleep 8
wait_for "user works after the node restarts" 90 new_works

echo "== bulk add: squad membership changes"
api DELETE /api/internal-squads/$SQUAD/bulk-actions/remove-users "$ADMIN" >/dev/null
removed() { ! reaches_telegram "$NEW_SECRET"; }
wait_for "user dropped when the squad's users are removed" 90 removed
api POST /api/internal-squads/$SQUAD/bulk-actions/add-users "$ADMIN" >/dev/null
wait_for "user back through the bulk add path" 90 new_works

echo "== broker: their own secret and sponsored channel"
hex16() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
DOMAIN_HEX=$(printf %s "$DOMAIN" | od -An -tx1 | tr -d ' \n')
BROKER_PASSWORD=BrokerPassword123456789abc
make_broker() { api POST /api/brokers "$ADMIN" "$(jq -nc --arg u "$1" --arg p "$BROKER_PASSWORD" --arg s "$SQUAD" '{username:$u,password:$p,trafficLimitBytes:1073741824,internalSquads:[$s]}')" | jq -r .response.uuid; }
login() { api POST /api/auth/login '' "$(jq -nc --arg u "$1" --arg p "$BROKER_PASSWORD" '{username:$u,password:$p}')" | jq -r .response.accessToken; }
broker_user() { jq -nc --arg u "$1" --arg s "$SQUAD" --arg h "$2" --arg a "$3" '{username:$u,expireAt:"2030-01-01T00:00:00.000Z",activeInternalSquads:[$s],mtprotoSecret:$h,mtprotoAdTag:$a}'; }
BROKER=$(make_broker "tgb$RUN"); OTHER_BROKER=$(make_broker "tgo$RUN")
BT=$(login "tgb$RUN"); OT=$(login "tgo$RUN")
[[ $BT != null && $OT != null ]] && ok "brokers logged in" || bad "broker login"

OWN_HEX=$(hex16); OWN_TAG=$(hex16)
BU=$(api POST /api/users "$BT" "$(broker_user "bu$RUN" "$OWN_HEX" "$OWN_TAG")")
BUID=$(jq -r .response.id <<<"$BU"); BSHORT=$(jq -r .response.shortUuid <<<"$BU")
[[ $(jq -r .response.mtprotoSecret <<<"$BU") == "$OWN_HEX" && $(jq -r .response.mtprotoAdTag <<<"$BU") == "$OWN_TAG" ]] && ok "broker created a user with their own hex and tag" || bad "broker user" "$BU"
[[ $(secret_of "$(link_of "$BSHORT")") == "ee$OWN_HEX$DOMAIN_HEX" ]] && ok "the user's link carries the broker's hex" || bad "link" "$(link_of "$BSHORT")"
own_works() { reaches_telegram "ee$OWN_HEX$DOMAIN_HEX"; }
wait_for "that hex reaches Telegram, tag accepted by the node" 60 own_works

[[ $(api POST /api/users "$BT" "$(broker_user "bx$RUN" "not-hex" "")" | jq -r .response.id) == null ]] && ok "a malformed hex is refused" || bad "bad hex"
[[ $(api POST /api/users "$BT" "$(broker_user "by$RUN" "$(hex16)" "not-hex")" | jq -r .response.id) == null ]] && ok "a malformed tag is refused" || bad "bad tag"
dup=$(api POST /api/users "$OT" "$(jq -nc --arg u "bz$RUN" --arg s "$SQUAD" --arg h "$OWN_HEX" '{username:$u,expireAt:"2030-01-01T00:00:00.000Z",activeInternalSquads:[$s],mtprotoSecret:$h}')")
[[ $(jq -r .response.id <<<"$dup") == null && $dup == *"already in use"* ]] && ok "a hex already in use is refused, also across brokers" || bad "duplicate hex" "$dup"
upper=$(hex16); upper_user=$(api POST /api/users "$BT" "$(jq -nc --arg u "bu2$RUN" --arg s "$SQUAD" --arg h "${upper^^}" '{username:$u,expireAt:"2030-01-01T00:00:00.000Z",activeInternalSquads:[$s],mtprotoSecret:$h}')")
[[ $(jq -r .response.mtprotoSecret <<<"$upper_user") == "$upper" ]] && ok "uppercase hex is stored in lowercase, so uniqueness can't be dodged" || bad "uppercase" "$upper_user"

links=$(api GET /api/subscriptions/telegram-links/$BUID "$BT" | jq -r '.response.links[0]')
[[ $links == *"secret=ee$OWN_HEX"* ]] && ok "broker can read the address and link for the bot" || bad "broker links" "$links"
[[ $(api GET /api/subscriptions/telegram-links/$BUID "$OT" | jq -r '.response.links[0] // empty') == "" ]] && ok "another broker can't read this user's link" || bad "links leak"
[[ $(curl -s -o /dev/null -w '%{http_code}' "$B/api/subscriptions/connection-keys/$BUID" "${H[@]}" -H "Authorization: Bearer $BT") != 200 ]] && ok "brokers still can't read full connection keys" || bad "connection keys opened to brokers"

NEXT_HEX=$(hex16)
api PATCH /api/users "$BT" "$(jq -nc --argjson i "$BUID" --arg h "$NEXT_HEX" '{id:$i,mtprotoSecret:$h}')" >/dev/null
next_works() { reaches_telegram "ee$NEXT_HEX$DOMAIN_HEX"; }
wait_for "changing the hex works live" 60 next_works
own_dead() { ! reaches_telegram "ee$OWN_HEX$DOMAIN_HEX"; }
wait_for "the old hex stops working" 60 own_dead

[[ $(api PATCH /api/users "$OT" "$(jq -nc --argjson i "$BUID" --arg h "$(hex16)" '{id:$i,mtprotoSecret:$h}')" | jq -r .response.id) == null ]] && ok "another broker can't change it" || bad "foreign update"
[[ $(api PATCH /api/users "$BT" "$(jq -nc --argjson i "$BUID" '{id:$i,mtprotoAdTag:null}')" | jq -r .response.mtprotoAdTag) == null ]] && ok "the tag can be cleared" || bad "clear tag"
api PATCH /api/users "$BT" "$(jq -nc --argjson i "$BUID" --arg a "$OWN_TAG" '{id:$i,mtprotoAdTag:$a}')" >/dev/null

api POST /api/users/$BUID/actions/revoke "$BT" '{}' >/dev/null
revoked=$(api GET /api/users/$BUID "$BT")
REVOKED_HEX=$(jq -r .response.mtprotoSecret <<<"$revoked")
[[ $REVOKED_HEX != "$NEXT_HEX" && ${#REVOKED_HEX} == 32 ]] && ok "revoking drops the broker's hex for a new one" || bad "revoke" "$REVOKED_HEX"
next_dead() { ! reaches_telegram "ee$NEXT_HEX$DOMAIN_HEX"; }
wait_for "and that hex stops working" 60 next_dead
revoked_works() { reaches_telegram "ee$REVOKED_HEX$DOMAIN_HEX"; }
wait_for "and the new one works" 60 revoked_works

broker_used() { "${PSQL[@]}" "SELECT used_traffic_bytes FROM brokers WHERE uuid='$BROKER'"; }
broker_counted() { reaches_telegram "ee$REVOKED_HEX$DOMAIN_HEX"; (( $(broker_used) > 0 )); }
wait_for "usage counts against the broker's quota" 90 broker_counted

echo "== cleanup"
docker rm -f umiji-dev-node >/dev/null 2>&1
for u in $BUID $(jq -r .response.id <<<"$upper_user"); do api DELETE /api/users/$u "$BT" >/dev/null; done
api DELETE /api/brokers/$BROKER "$ADMIN" >/dev/null; api DELETE /api/brokers/$OTHER_BROKER "$ADMIN" >/dev/null
api DELETE /api/users/$UID_ "$ADMIN" >/dev/null; api DELETE /api/hosts/$HOST_UUID "$ADMIN" >/dev/null
api DELETE /api/nodes/$NODE "$ADMIN" >/dev/null; api DELETE /api/internal-squads/$SQUAD "$ADMIN" >/dev/null
api DELETE /api/config-profiles/$PROFILE_UUID "$ADMIN" >/dev/null
echo; echo "passed: $PASS  failed: $FAIL"; [[ $FAIL == 0 ]]
