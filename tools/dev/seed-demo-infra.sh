#!/usr/bin/env bash
# Demo infrastructure for the brokers' Internal squads page: a profile with inbounds, nodes in a few
# countries, subscription hosts, and the Germany / Netherlands / Finland-Premium squads wired to them.
# The nodes point at closed local ports, so they show as offline.
set -uo pipefail
B=${B:-http://127.0.0.1:3003}
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
api() { curl -s -X "$1" "$B$2" "${H[@]}" ${3:+-H "Authorization: Bearer $3"} ${4:+-d "$4"}; }
ADMIN=$(api POST /api/auth/login '' '{"username":"owner","password":"AdminPassword1234567890xyz"}' | jq -r .response.accessToken)

CONFIG=$(jq -nc '{
  log: {loglevel: "warning"},
  inbounds: [
    {tag: "DE_VLESS_TCP", port: 443, protocol: "vless", settings: {clients: [], decryption: "none"}, streamSettings: {network: "tcp"}},
    {tag: "DE_TROJAN_WS", port: 8443, protocol: "trojan", settings: {clients: []}, streamSettings: {network: "ws", wsSettings: {path: "/ws"}}},
    {tag: "NL_VLESS_GRPC", port: 2053, protocol: "vless", settings: {clients: [], decryption: "none"}, streamSettings: {network: "grpc", grpcSettings: {serviceName: "grpc"}}},
    {tag: "FI_SHADOWSOCKS", port: 8388, protocol: "shadowsocks", settings: {clients: [], network: "tcp,udp"}}
  ],
  outbounds: [{protocol: "freedom", tag: "DIRECT"}, {protocol: "blackhole", tag: "BLOCK"}]
}')
PROFILE=$(api POST /api/config-profiles "$ADMIN" "$(jq -nc --argjson c "$CONFIG" '{name: "Demo-Profile", config: $c}')")
PROFILE_UUID=$(jq -r .response.uuid <<<"$PROFILE")
[[ $PROFILE_UUID == null ]] && { echo "profile: $PROFILE"; exit 1; }
inb() { jq -r --arg t "$1" '.response.inbounds[] | select(.tag==$t) | .uuid' <<<"$PROFILE"; }
DE1=$(inb DE_VLESS_TCP); DE2=$(inb DE_TROJAN_WS); NL=$(inb NL_VLESS_GRPC); FI=$(inb FI_SHADOWSOCKS)

node() { # name country loopback-address inbound-uuids-json (node addresses are unique)
  api POST /api/nodes "$ADMIN" "$(jq -nc --arg n "$1" --arg c "$2" --arg a "$3" --arg p "$PROFILE_UUID" --argjson i "$4" \
    '{name: $n, address: $a, port: 1, countryCode: $c, configProfile: {activeConfigProfileUuid: $p, activeInbounds: $i}}')" | jq -r '.response.name // .message'
}
node "Frankfurt-1" DE 127.0.0.11 "[\"$DE1\",\"$DE2\"]"
node "Frankfurt-2" DE 127.0.0.12 "[\"$DE1\"]"
node "Amsterdam-1" NL 127.0.0.13 "[\"$NL\"]"
node "Helsinki-1" FI 127.0.0.14 "[\"$FI\"]"

host() { # remark inbound-uuid port
  api POST /api/hosts "$ADMIN" "$(jq -nc --arg r "$1" --arg p "$PROFILE_UUID" --arg i "$2" --argjson port "$3" \
    '{remark: $r, address: "demo.example.com", port: $port, inbound: {configProfileUuid: $p, configProfileInboundUuid: $i}}')" >/dev/null
}
host "🇩🇪 Germany · Fast" "$DE1" 443
host "🇩🇪 Germany · WebSocket" "$DE2" 8443
host "🇳🇱 Netherlands" "$NL" 2053
host "🇫🇮 Finland · Premium" "$FI" 8388

squad() { # name inbound-uuids-json
  local uuid; uuid=$(api GET /api/internal-squads "$ADMIN" | jq -r --arg n "$1" '.response.internalSquads[] | select(.name==$n) | .uuid')
  api PATCH /api/internal-squads "$ADMIN" "$(jq -nc --arg u "$uuid" --argjson i "$2" '{uuid: $u, inbounds: $i}')" | jq -r '.response.name // .message'
}
squad Germany "[\"$DE1\",\"$DE2\"]"
squad Netherlands "[\"$NL\"]"
squad Finland-Premium "[\"$FI\"]"
