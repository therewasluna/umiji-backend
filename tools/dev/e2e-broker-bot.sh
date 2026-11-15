#!/usr/bin/env bash
# Requires node, curl, jq and the running local API with TELEGRAM_BOT_API_ROOT=http://127.0.0.1:8081.
# Usage: ./tools/dev/e2e-broker-bot.sh [http://127.0.0.1:3003]
set -euo pipefail
export NO_PROXY=127.0.0.1,localhost
B=${1:-http://127.0.0.1:3003}
M=http://127.0.0.1:8081
H=(-H 'Content-Type: application/json' -H 'X-Umiji-Client-Type: browser')
PASS=0; FAIL=0
ADMIN=''; BT=''; BRK=''; SQUAD=''; EXT=''; CFG=''; MOCK_PID=''; DISCONNECTED=0
MARK=0; MSG=1
ok() { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 :: $2" >&2; }
die() { bad "$@"; exit 1; }
for cmd in node curl jq; do command -v "$cmd" >/dev/null || die prerequisite "$cmd is required"; done
# Restrict this destructive fixture test to a loopback API.
[[ $B =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || die base_url 'use a local http://127.0.0.1:PORT URL'
TMP=$(mktemp -d /tmp/e2e-broker-bot.XXXXXX)
BODY=$TMP/body.json
CALLS=$TMP/calls.json
RUN="$(date +%s)${RANDOM}"
TOKEN="e2e${RUN}"
NAME="bot${RUN}"

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
cleanup_delete() {
  local path=$1 want=$2 got
  got=$(req DELETE "$path" "$ADMIN")
  if [[ $got == "$want" || $got == 404 ]]; then ok "cleanup $path";
  else bad "cleanup $path" "HTTP $got $(head -c 300 "$BODY")"; fi
}
cleanup() {
  local status=$? ids id status_disconnect
  trap - EXIT INT TERM
  set +e
  # Delete only this run's fixtures, including subscriptions (broker deletion preserves them).
  if [[ -n $BRK && $BRK != null ]]; then
    if [[ -n $BT && $BT != null ]]; then
      if [[ $DISCONNECTED == 0 ]]; then
        status_disconnect=$(req DELETE /api/broker-bot "$BT")
        [[ $status_disconnect == 200 ]] || bad 'cleanup disconnect' "HTTP $status_disconnect"
      fi
      if [[ $(req GET '/api/users?start=0&size=100' "$BT") == 200 ]]; then
        ids=$(jq -r '.response.users[].id' "$BODY")
        for id in $ids; do cleanup_delete "/api/users/$id" 204; done
      else
        bad 'cleanup users' 'could not list this broker’s users'
      fi
    fi
    cleanup_delete "/api/brokers/$BRK" 204
  fi
  [[ -z $EXT || $EXT == null ]] || cleanup_delete "/api/external-squads/$EXT" 204
  [[ -z $CFG || $CFG == null ]] || cleanup_delete "/api/subscription-page-configs/$CFG" 204
  [[ -z $SQUAD || $SQUAD == null ]] || cleanup_delete "/api/internal-squads/$SQUAD" 204
  [[ -z $SQUAD2 || $SQUAD2 == null ]] || cleanup_delete "/api/internal-squads/$SQUAD2" 204
  if [[ -n $MOCK_PID ]]; then
    kill "$MOCK_PID" 2>/dev/null
    wait "$MOCK_PID" 2>/dev/null
    if kill -0 "$MOCK_PID" 2>/dev/null; then bad 'mock cleanup' "PID $MOCK_PID still alive";
    else ok 'mock stopped'; fi
  fi
  if ((status != 0 && FAIL == 0)); then bad script "unexpected exit $status"; fi
  echo "passed: $PASS  failed: $FAIL"
  if ((FAIL > 0 || status != 0)); then
    echo "Diagnostics: $TMP" >&2
    exit 1
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

control() {
  curl -fsS --max-time 5 -H 'Content-Type: application/json' -d "$2" "$M$1" > "$TMP/control.json"
  jq -e '.ok == true' "$TMP/control.json" >/dev/null
}
read_calls() { curl -fsS --max-time 5 "$M/_calls?token=${2:-$TOKEN}&since=${1:-$MARK}" > "$CALLS"; }
mark() { read_calls 0; MARK=$(jq -r .seq "$CALLS"); }
wait_calls() { # bounded wait, with diagnostics from just this action
  local name=$1 filter=$2 deadline=$((SECONDS+20))
  while ((SECONDS < deadline)); do
    read_calls
    if jq -e "$filter" "$CALLS" >/dev/null; then ok "$name"; return; fi
    sleep 0.2
  done
  die "$name" "timed out; $(cat "$CALLS")"
}
call_check() { check "$1" "any(.calls[]; $2)" "$CALLS"; }
push() {
  mark
  control /_push "$(jq -nc --arg token "$TOKEN" --argjson update "$1" '{token:$token,update:$update}')"
  local update_id
  update_id=$(jq -r .update_id "$TMP/control.json")
  # The next poll starts only after the previous update's handler has completed.
  wait_calls "update $update_id processed" "any(.calls[]; .method == \"getUpdates\" and .body.offset > $update_id)"
}
message() { # text [chat user thread]; private customer by default
  local chat=${2:-5550001} user=${3:-5550001} thread=${4:-0}
  MSG=$((MSG+1))
  push "$(jq -nc --arg text "$1" --argjson chat "$chat" --argjson user "$user" --argjson thread "$thread" --argjson id "$MSG" '
    {message:{message_id:$id,date:now|floor,from:{id:$user,is_bot:false,first_name:"E2E Customer"},
      chat:{id:$chat,type:(if $chat < 0 then "supergroup" else "private" end),title:"E2E staff"},text:$text}
    } | if $thread > 0 then .message.message_thread_id=$thread else . end')"
}
callback() { # data [user chat message_id]
  local user=${2:-5550001} chat=${3:-5550001} mid=${4:-}
  if [[ -z $mid ]]; then
    read_calls 0
    mid=$(jq -r --arg chat "$chat" '[.calls[] | select((.body.chat_id|tostring)==$chat and
      (.method=="sendMessage" or .method=="editMessageText")) | .result.message_id // .body.message_id] | last' "$CALLS")
    [[ $mid != null ]] || die callback 'no preceding bot message'
  fi
  MSG=$((MSG+1))
  CQ="cq${MSG}"
  push "$(jq -nc --arg data "$1" --arg id "$CQ" --argjson user "$user" --argjson chat "$chat" --argjson mid "$mid" '
    {callback_query:{id:$id,data:$data,chat_instance:"e2e",from:{id:$user,is_bot:false,first_name:"E2E Customer"},
      message:{message_id:$mid,chat:{id:$chat,type:(if $chat < 0 then "supergroup" else "private" end)}}}}')"
  call_check "callback $1 answered" ".method==\"answerCallbackQuery\" and .body.callback_query_id==\"$CQ\""
}
photo() {
  MSG=$((MSG+1))
  push "$(jq -nc --argjson id "$MSG" '{message:{message_id:$id,date:now|floor,
    from:{id:5550001,is_bot:false,first_name:"E2E Customer"},chat:{id:5550001,type:"private"},
    photo:[{file_id:"receipt-small",file_unique_id:"small",width:1,height:1},
      {file_id:"receipt-large",file_unique_id:"large",width:2,height:2}]}}')"
}
DM='.body.chat_id|tostring=="5550001"'
SCREEN=".method==\"editMessageText\" and ($DM)"
SEND=".method==\"sendMessage\" and ($DM)"
MENU='([.body.reply_markup.inline_keyboard[]?[]? | .callback_data // empty] | sort)==["buy","mysubs","support","wallet"]'

echo '== mock and fixtures'
node "$(dirname "$0")/mock-telegram.mjs" > "$TMP/mock.log" 2>&1 &
MOCK_PID=$!
for ((i=0; i<50; i++)); do
  kill -0 "$MOCK_PID" 2>/dev/null || die 'start mock' "$(cat "$TMP/mock.log")"
  if [[ $(cat "$TMP/mock.log") == *'Mock Telegram listening'* ]]; then break; fi
  sleep 0.1
done
[[ $(cat "$TMP/mock.log") == *'Mock Telegram listening'* ]] || die 'start mock' 'no listener after 5s'
ok 'mock listening'
LOGIN='{"username":"owner","password":"AdminPassword1234567890xyz"}'
if [[ $(req POST /api/auth/login '' "$LOGIN") != 200 ]]; then
  expect 'register admin' 201 POST /api/auth/register '' "$LOGIN"
  expect 'admin login' 200 POST /api/auth/login '' "$LOGIN"
fi
check 'admin login token' '.response.accessToken | type=="string"'
ADMIN=$(jqb .response.accessToken)
expect 'create squad' 201 POST /api/internal-squads "$ADMIN" "{\"name\":\"sq$RUN\",\"inbounds\":[]}"
SQUAD=$(jqb .response.uuid)
expect 'create second squad' 201 POST /api/internal-squads "$ADMIN" "{\"name\":\"sq2$RUN\",\"inbounds\":[]}"
SQUAD2=$(jqb .response.uuid)
expect 'create broker' 201 POST /api/brokers "$ADMIN" "{\"username\":\"$NAME\",\"password\":\"BrokerPassword123456789abc\",\"internalSquads\":[\"$SQUAD\",\"$SQUAD2\"]}"
BRK=$(jqb .response.uuid); EXT=$(jqb .response.externalSquad.uuid)
expect 'broker login' 200 POST /api/auth/login '' "{\"username\":\"$NAME\",\"password\":\"BrokerPassword123456789abc\"}"
check 'broker login token' '.response.accessToken | type=="string"'
BT=$(jqb .response.accessToken)
expect 'read broker subscription page fixture' 200 GET /api/brokers/me "$BT"
CFG=$(jqb .response.subpageConfigUuid)

echo '== connect and group discovery'
expect 'bad token rejected' 400 POST /api/broker-bot/connect "$BT" '{"botToken":"bad","groupId":null,"lang":"en","greeting":null}'
check 'Telegram error propagated' '.message | contains("Telegram: Unauthorized")'
read_calls 0 bad
call_check 'bad token validated with getMe' '.method=="getMe"'
mark
expect 'connect without group' 200 POST /api/broker-bot/connect "$BT" "{\"botToken\":\"$TOKEN\",\"groupId\":null,\"lang\":\"en\",\"greeting\":null}"
USERNAME=$(node -e 'process.stdout.write("mock_"+require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16)+"_bot")' "$TOKEN")
check 'connected bot identity' ".response | .isConnected and .botUsername==\"$USERNAME\" and .groupId==null and (.topicsReady|not)"
wait_calls 'poller started' 'any(.calls[]; .method=="getUpdates")'
call_check 'webhook removed without dropping updates' '.method=="deleteWebhook" and .body.drop_pending_updates==false'
message /find -100123 9000001
call_check 'group finder replied' '.method=="sendMessage" and (.body.chat_id|tostring)=="-100123" and (.body.text|contains("Group captured") and contains("-100123"))'
expect 'get discovered groups' 200 GET /api/broker-bot "$BT"
check 'groupFinds contains staff group' 'any(.response.groupFinds[]; .chatId=="-100123" and .title=="E2E staff")'
mark
expect 'connect staff group' 200 POST /api/broker-bot/connect "$BT" '{"groupId":"-100123","lang":"en","greeting":null}'
check 'topics ready' '.response | .isConnected and .topicsReady and .groupId=="-100123"'
read_calls
check 'exactly two staff topics' '[.calls[] | select(.method=="createForumTopic") | .body | {chat_id,name}] | sort_by(.name)==[{chat_id:"-100123",name:"Review Receipts"},{chat_id:"-100123",name:"Stats"}]' "$CALLS"
REVIEW=$(jq -r '.calls[] | select(.method=="createForumTopic" and .body.name=="Review Receipts") | .result.message_thread_id' "$CALLS")
STATS_TOPIC=$(jq -r '.calls[] | select(.method=="createForumTopic" and .body.name=="Stats") | .result.message_thread_id' "$CALLS")
check 'both topic headers pinned' '[.calls[]|select(.method=="pinChatMessage" and .body.chat_id=="-100123")]|length==2' "$CALLS"

echo '== settings and catalog'
SETTINGS='{"cards":[{"cardNumber":"6037991234567890","holderName":"E2E Store"}],"wallets":[{"asset":"USDT","address":"e2e-wallet-address"}],"payMethods":[{"method":"PayPal","account":"e2e@paypal.test","note":"1 USD = 100,000 Toman"}],"channelUrl":"https://t.me/e2e_store","requiredChannels":[{"chatRef":"@e2e_required","title":"Required channel","url":"https://t.me/e2e_required"}]}'
expect 'save payment and channel settings' 200 PATCH /api/broker-bot/settings "$BT" "$SETTINGS"
check 'settings round trip' ".response | {cards,wallets,payMethods,channelUrl,requiredChannels} == $SETTINGS"
expect 'create category' 201 POST /api/broker-bot/categories "$BT" '{"title":"Monthly"}'
CAT=$(jqb '.response.categories[] | select(.title=="Monthly") | .id')
expect 'create categorized plan' 201 POST /api/broker-bot/plans "$BT" "{\"title\":\"Basic\",\"trafficGb\":1,\"durationDays\":30,\"price\":10000,\"ipLimit\":2,\"squadUuids\":[\"$SQUAD\",\"$SQUAD2\"],\"categoryId\":$CAT}"
PLAN=$(jqb '.response.plans[] | select(.title=="Basic") | .id')
expect 'create expensive uncategorized plan' 201 POST /api/broker-bot/plans "$BT" "{\"title\":\"Expensive\",\"trafficGb\":2,\"durationDays\":30,\"price\":90000,\"squadUuids\":[\"$SQUAD\"],\"categoryId\":null}"
EXPENSIVE=$(jqb '.response.plans[] | select(.title=="Expensive") | .id')
check 'catalog contains both plans' ".response.plans | length==2 and any(.[];.id==$PLAN and .categoryId==$CAT and .price==10000 and .ipLimit==2) and any(.[];.id==$EXPENSIVE and .categoryId==null and .price==90000 and .ipLimit==null)"
expect 'plan with a squad the broker lacks rejected' 400 POST /api/broker-bot/plans "$BT" "{\"title\":\"Bad\",\"trafficGb\":1,\"durationDays\":30,\"price\":1,\"squadUuids\":[\"$SQUAD\",\"00000000-0000-4000-8000-000000000000\"],\"categoryId\":null}"
expect 'plan with a repeated squad rejected' 400 POST /api/broker-bot/plans "$BT" "{\"title\":\"Bad\",\"trafficGb\":1,\"durationDays\":30,\"price\":1,\"squadUuids\":[\"$SQUAD\",\"$SQUAD\"],\"categoryId\":null}"

echo '== required membership and menu'
control /_member '{"chatId":"@e2e_required","userId":5550001,"status":"left"}'
message /start
call_check 'membership checked' '.method=="getChatMember" and .body.chat_id=="@e2e_required" and .body.user_id==5550001'
call_check 'join prompt with channel and joined button' "$SEND and (.body.text|contains(\"please join our channel\")) and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"joined\") and any(.body.reply_markup.inline_keyboard[][];.url==\"https://t.me/e2e_required\")"
check 'membership gate hides menu' "all(.calls[]; ($MENU)|not)" "$CALLS"
wait_calls 'first start logged in the Stats topic' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"New customer: E2E Customer · id 5550001\")))"
control /_member '{"chatId":"@e2e_required","userId":5550001,"status":"member"}'
callback joined
call_check 'joined opens menu' "$SCREEN and ($MENU)"
message /start
call_check 'start sends menu with channel link' "$SEND and ($MENU) and any(.body.reply_markup.inline_keyboard[][];.url==\"https://t.me/e2e_store\")"
check 'a returning customer is not logged again' 'all(.calls[]; (.body.text // "" | contains("New customer"))|not)' "$CALLS"

echo '== languages and custom texts'
expect 'get texts' 200 GET /api/broker-bot/texts "$BT"
check 'one language and every default' '.response | .langs==["en"] and .defaultLang=="en" and .texts=={} and (.defaults|keys|sort)==["ar","en","fa","ru","tr","zh"] and (.defaults.fa.menuBuy|contains("خرید")) and (.defaults.zh.menuBuy|contains("购买"))'
expect 'unclosed tag rejected' 400 PUT /api/broker-bot/texts "$BT" '{"langs":["en"],"defaultLang":"en","texts":{"en":{"useMenu":"<b>oops"}}}'
check 'error names the text' 'tostring | contains("en.useMenu") and contains("never closed")'
expect 'unknown variable rejected' 400 PUT /api/broker-bot/texts "$BT" '{"langs":["en"],"defaultLang":"en","texts":{"en":{"menuBuy":"Buy {price}"}}}'
expect 'default outside the languages rejected' 400 PUT /api/broker-bot/texts "$BT" '{"langs":["en"],"defaultLang":"fa","texts":{}}'
expect 'get texts again' 200 GET /api/broker-bot/texts "$BT"
DEFAULT_GREETING=$(jq -c '.response.defaults.en.greeting' "$BODY")
TEXTS="{\"langs\":[\"en\",\"fa\"],\"defaultLang\":\"en\",\"texts\":{\"en\":{\"useMenu\":\"Pick <b>one</b> & go\",\"menuBuy\":\"🛍 Shop\",\"greeting\":$DEFAULT_GREETING,\"menuSubs\":\"  \"},\"fa\":{}}}"
expect 'save two languages and texts' 200 PUT /api/broker-bot/texts "$BT" "$TEXTS"
check 'only real changes kept' '.response | .langs==["en","fa"] and .texts=={"en":{"useMenu":"Pick <b>one</b> & go","menuBuy":"🛍 Shop"}}'
message 'hi'
call_check 'custom text sent as safe HTML' "$SEND and .body.parse_mode==\"HTML\" and .body.text==\"Pick <b>one</b> &amp; go\" and any(.body.reply_markup.inline_keyboard[][];.text==\"🛍 Shop\") and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"lang\")"
callback lang
call_check 'language picker lists the bot languages' "$SCREEN and ([.body.reply_markup.inline_keyboard[][] | .callback_data] == [\"lang:en\",\"lang:fa\",\"menu\"]) and any(.body.reply_markup.inline_keyboard[][];.text==\"✅ English\")"
callback lang:fa
call_check 'picking Persian redraws the menu in Persian' "$SCREEN and (.body.text|contains(\"خوش اومدی\")) and any(.body.reply_markup.inline_keyboard[][];.text==\"🛒 خرید پلن\")"
message 'hi'
call_check 'the choice sticks' "$SEND and (.body.text|contains(\"برای شروع\"))"
callback lang:ru
call_check 'a language the bot does not speak shows the picker' "$SCREEN and (.body.text|contains(\"زبانت\"))"
control /_member '{"chatId":"@e2e_required","userId":5550002,"status":"member"}'
MSG=$((MSG+1))
push "$(jq -nc --argjson id "$MSG" '{message:{message_id:$id,date:now|floor,
  from:{id:5550002,is_bot:false,first_name:"Persian",language_code:"fa-IR"},chat:{id:5550002,type:"private"},text:"/start"}}')"
call_check 'new customer gets their Telegram language' '.method=="sendMessage" and (.body.chat_id|tostring)=="5550002" and (.body.text|contains("خوش اومدی"))'
expect 'enable Chinese' 200 PUT /api/broker-bot/texts "$BT" '{"langs":["en","fa","zh"],"defaultLang":"en","texts":{}}'
control /_member '{"chatId":"@e2e_required","userId":5550003,"status":"member"}'
MSG=$((MSG+1))
push "$(jq -nc --argjson id "$MSG" '{message:{message_id:$id,date:now|floor,
  from:{id:5550003,is_bot:false,first_name:"Chinese",language_code:"zh-hans"},chat:{id:5550003,type:"private"},text:"/start"}}')"
call_check 'a zh-hans customer gets Chinese' '.method=="sendMessage" and (.body.chat_id|tostring)=="5550003" and (.body.text|contains("欢迎加入")) and any(.body.reply_markup.inline_keyboard[]?[]?;.text=="🛒 购买套餐")'
expect 'back to English only' 200 PUT /api/broker-bot/texts "$BT" '{"langs":["en"],"defaultLang":"en","texts":{}}'
message /start
call_check 'a disabled language falls back to the default' "$SEND and ($MENU) and (.body.text|contains(\"Welcome aboard\"))"

echo '== wallet receipt and staff approval'
callback wallet
call_check 'wallet screen offers charge' "$SCREEN and (.body.text|contains(\"0 Toman\")) and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"charge\")"
callback charge
call_check 'charge asks for amount' "$SCREEN and (.body.text|contains(\"Send the amount in Toman\"))"
message '50,000'
call_check 'instructions show amount, card, wallet and other method' "$SEND and (.body.text|contains(\"50,000 Toman\") and contains(\"6037991234567890\") and contains(\"e2e-wallet-address\") and contains(\"<b>PayPal</b> · 1 USD = 100,000 Toman\") and contains(\"e2e@paypal.test\"))"
photo
call_check 'photo copied to review topic' ".method==\"copyMessage\" and .body.chat_id==\"-100123\" and .body.from_chat_id==\"5550001\" and .body.message_id==$MSG and .body.message_thread_id==$REVIEW"
call_check 'customer told receipt is pending' "$SEND and (.body.text|contains(\"top-up is under review\"))"
expect 'list pending orders' 200 GET /api/broker-bot/orders "$BT"
check 'pending photo receipt' '.response.pending | length==1 and (.[0] | .kind=="topup" and .status=="pending" and .receiptKind=="photo" and .amount==50000 and .customer.tgUserId=="5550001")'
ORDER=$(jqb '.response.pending[0].id')
call_check 'review includes approve and reject buttons' ".method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$REVIEW and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"ap:$ORDER\") and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"rj:$ORDER\")"
REVIEW_MSG=$(jq -r --arg ap "ap:$ORDER" '.calls[]|select(.method=="sendMessage" and any(.body.reply_markup.inline_keyboard[]?[]?;.callback_data==$ap))|.result.message_id' "$CALLS")
mark
expect 'download receipt' 200 GET "/api/broker-bot/orders/$ORDER/receipt" "$BT"
check 'receipt is the mock PNG in base64' '.response.mimeType=="image/png" and .response.base64=="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="'
read_calls
call_check 'largest receipt photo fetched' '.method=="getFile" and .body.file_id=="receipt-large"'
call_check 'file endpoint downloaded' '.method=="downloadFile" and .body.file_path=="photos/receipt.png"'
callback "ap:$ORDER" 9000002 -100123 "$REVIEW_MSG"
call_check 'non-admin denied' '.method=="answerCallbackQuery" and .body.text=="Only group admins can do that."'
expect 'non-admin leaves order pending' 200 GET /api/broker-bot/orders "$BT"
check 'receipt remains pending' "any(.response.pending[];.id==$ORDER and .status==\"pending\")"
callback "ap:$ORDER" 9000001 -100123 "$REVIEW_MSG"
call_check 'admin membership checked' '.method=="getChatMember" and .body.chat_id=="-100123" and .body.user_id==9000001'
call_check 'wallet credited DM' "$SEND and (.body.text|contains(\"Wallet charged\") and contains(\"50,000 Toman\"))"
call_check 'review finalized without buttons' ".method==\"editMessageText\" and .body.chat_id==\"-100123\" and .body.message_id==$REVIEW_MSG and (.body.text|contains(\"Approved by\")) and .body.reply_markup.inline_keyboard==[]"
callback "ap:$ORDER" 9000001 -100123 "$REVIEW_MSG"
call_check 'duplicate approval rejected' '.method=="answerCallbackQuery" and .body.text=="Already handled."'
expect 'wallet state after duplicate approval' 200 GET /api/broker-bot "$BT"
check 'wallet credited exactly once' '.response.stats | .walletTotal==50000 and .topupsTotal==50000 and .pendingReceipts==0'

echo '== purchase and subscriptions'
callback buy
call_check 'buy lists category and Other' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"cat:$CAT\") and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"cat:0\")"
callback "cat:$CAT"
call_check 'category lists Basic' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"plan:$PLAN\")"
callback "plan:$PLAN"
call_check 'plan review offers purchase' "$SCREEN and (.body.text|contains(\"Basic\") and contains(\"Devices at once</b>: 2\")) and any(.body.reply_markup.inline_keyboard[][];(.callback_data // \"\")|startswith(\"pur:$PLAN:\"))"
PUR=$(jq -r '[.calls[]|select(.method=="editMessageText")|.body.reply_markup.inline_keyboard[][]|.callback_data // empty|select(startswith("pur:"))]|last' "$CALLS")
callback "$PUR"
call_check 'purchase approved with link' "$SCREEN and (.body.text|contains(\"Your subscription is active\") and contains(\"https://\"))"
wait_calls 'purchase logged' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|test(\"Order #[0-9]+: E2E Customer bought Basic for 10,000 Toman\")))"
expect 'broker lists created subscription user' 200 GET '/api/users?start=0&size=50' "$BT"
check 'one user with customer Telegram ID' '.response | .total==1 and (.users|length)==1 and (.users[0].telegramId|tostring)=="5550001"'
USER_ID=$(jqb '.response.users[0].id'); SHORT=$(jqb '.response.users[0].shortUuid')
check 'user belongs to broker and both plan squads' ".response.users[0] | .brokerUuid==\"$BRK\" and .trafficLimitBytes==1073741824 and .ipLimit==2 and ([.activeInternalSquads[].uuid]|sort)==([\"$SQUAD\",\"$SQUAD2\"]|sort)"
call_check 'approved link matches created user' "$SCREEN and (.body.text|contains(\"/$SHORT</code>\"))"
callback "$PUR"
check 'a second tap on the same pay button does nothing' '[.calls[]|select(.method=="editMessageText" or .method=="sendMessage")]|length==0' "$CALLS"
callback "plan:$PLAN"
PUR=$(jq -r '[.calls[]|select(.method=="editMessageText")|.body.reply_markup.inline_keyboard[][]|.callback_data // empty|select(startswith("pur:"))]|last' "$CALLS")
expect 'broker raises the price' 200 PATCH /api/broker-bot/plans "$BT" "{\"id\":$PLAN,\"price\":15000}"
callback "$PUR"
call_check 'old pay button shows the new price instead of charging' "$SCREEN and (.body.text|contains(\"15,000\")) and any(.body.reply_markup.inline_keyboard[][];(.callback_data // \"\")|startswith(\"pur:$PLAN:\"))"
expect 'broker restores the price' 200 PATCH /api/broker-bot/plans "$BT" "{\"id\":$PLAN,\"price\":10000}"
callback buy
callback cat:0
call_check 'Other lists expensive plan' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"plan:$EXPENSIVE\")"
callback "plan:$EXPENSIVE"
PUR=$(jq -r '[.calls[]|select(.method=="editMessageText")|.body.reply_markup.inline_keyboard[][]|.callback_data // empty|select(startswith("pur:"))]|last' "$CALLS")
callback "$PUR"
call_check 'insufficient balance shown' "$SCREEN and (.body.text|contains(\"Not enough balance\"))"
expect 'wallet and sales after purchases' 200 GET /api/broker-bot "$BT"
check 'only affordable purchase charged' '.response.stats | .walletTotal==40000 and .plansSold==1'
callback mysubs
call_check 'subscription listed' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];(.callback_data // \"\"|startswith(\"sub:\")))"
SUB=$(jq -r '.calls[]|select(.method=="editMessageText")|.body.reply_markup.inline_keyboard[][]|.callback_data // empty|select(startswith("sub:"))' "$CALLS")
callback "$SUB"
call_check 'usage screen shows usage, expiry and same link' "$SCREEN and (.body.text|contains(\"Usage:\") and contains(\"Expires:\") and contains(\"/$SHORT</code>\"))"

echo '== panel rejection and manual credit'
callback charge
message 20000
photo
expect 'second pending receipt' 200 GET /api/broker-bot/orders "$BT"
check 'second receipt pending' ".response.pending | length==1 and (.[0]|.id!=$ORDER and .amount==20000 and .receiptKind==\"photo\")"
SECOND=$(jqb '.response.pending[0].id')
mark
expect 'panel rejects receipt with reason' 200 POST "/api/broker-bot/orders/$SECOND/decision" "$BT" '{"decision":"reject","reason":"Transfer reference does not match"}'
check 'panel decision done' '.response.isDone==true'
read_calls
call_check 'customer receives rejection reason' "$SEND and (.body.text|contains(\"Transfer reference does not match\"))"
expect 'order history after rejection' 200 GET /api/broker-bot/orders "$BT"
check 'rejected order persisted' "(.response.pending|length)==0 and any(.response.orders[];.id==$SECOND and .status==\"rejected\" and .rejectReason==\"Transfer reference does not match\")"
mark
expect 'manual top-up' 200 POST /api/broker-bot/actions/top-up "$BT" '{"telegramId":"5550001","amount":1234}'
check 'manual credit returns exact balance' '.response | .name=="E2E Customer" and .balance==41234'
read_calls
call_check 'manual credit notifies customer' "$SEND and (.body.text|contains(\"Wallet charged\") and contains(\"1,234 Toman\") and contains(\"41,234 Toman\"))"
wait_calls 'manual credit logged' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"1,234 Toman added to E2E Customer from the panel\")))"

echo '== referral program'
expect 'a share above 100% rejected' 400 PATCH /api/broker-bot/settings "$BT" '{"referralPercent":101}'
expect 'referrals on at 10%' 200 PATCH /api/broker-bot/settings "$BT" '{"referralPercent":10}'
check 'referral share saved' '.response.referralPercent==10'
# Menu presses, not /start: customer messages are rate-limited and the later sections send many.
callback menu
call_check 'menu offers invites' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"invite\")"
callback invite
call_check 'invite screen shows the link, the share and a share button' "$SCREEN and (.body.text|contains(\"?start=ref\") and contains(\"<b>10%</b>\") and contains(\"Friends invited: <b>0</b>\")) and any(.body.reply_markup.inline_keyboard[][];(.url // \"\")|startswith(\"https://t.me/share/url?url=\"))"
REF=$(jq -r '[.calls[]|select(.method=="editMessageText")|.body.text]|last' "$CALLS" | grep -o 'ref[0-9]*' | head -1)
message "/start $REF" 5550004 5550004
call_check 'an invited customer gets the menu' '.method=="sendMessage" and (.body.chat_id|tostring)=="5550004" and (.body.text|contains("Welcome aboard"))'
wait_calls 'invited start logged with the inviter' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"New customer: E2E Customer · id 5550004\") and contains(\"Invited by E2E Customer\")))"
message "/start $REF" 5550002 5550002
message "/start $REF"
callback invite
call_check 'existing customers and the referrer themself are not counted' "$SCREEN and (.body.text|contains(\"Friends invited: <b>1</b>\"))"
callback charge 5550004 5550004
message 20000 5550004 5550004
message 'Paid, reference 4411' 5550004 5550004
expect 'invited customer receipt pending' 200 GET /api/broker-bot/orders "$BT"
INVITED=$(jqb '.response.pending[] | select(.customer.tgUserId=="5550004" and .receiptKind=="text") | .id')
mark
expect 'approve the invited customer top-up' 200 POST "/api/broker-bot/orders/$INVITED/decision" "$BT" '{"decision":"approve"}'
read_calls
call_check 'referrer gets 10% and is told' "$SEND and (.body.text|contains(\"Referral reward\") and contains(\"2,000 Toman\") and contains(\"43,234 Toman\"))"
wait_calls 'reward logged' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"Referral reward: 2,000 Toman to E2E Customer for top-up #$INVITED\")))"
expect 'orders after the reward' 200 GET /api/broker-bot/orders "$BT"
check 'reward recorded as a referral order' 'any(.response.orders[]; .kind=="referral" and .status=="approved" and .amount==2000 and .customer.tgUserId=="5550001")'
callback invite 5550004 5550004
REF2=$(jq -r '[.calls[]|select(.method=="editMessageText")|.body.text]|last' "$CALLS" | grep -o 'ref[0-9]*' | head -1)
[[ $REF2 != "$REF" ]] || die 'second invite link' "same link $REF2"
message "/start $REF2" 5550005 5550005
callback charge 5550005 5550005
message 10000 5550005 5550005
message 'Paid' 5550005 5550005
expect 'second-level receipt pending' 200 GET /api/broker-bot/orders "$BT"
SECOND_LEVEL=$(jqb '.response.pending[] | select(.customer.tgUserId=="5550005") | .id')
mark
expect 'approve the second-level top-up' 200 POST "/api/broker-bot/orders/$SECOND_LEVEL/decision" "$BT" '{"decision":"approve"}'
read_calls
call_check 'the direct referrer gets the reward' '.method=="sendMessage" and (.body.chat_id|tostring)=="5550004" and (.body.text|contains("Referral reward") and contains("1,000 Toman"))'
check 'nothing for the referrer’s referrer' "all(.calls[]; (($SEND) and (.body.text|contains(\"Referral reward\")))|not)" "$CALLS"
callback invite
call_check 'invite screen totals' "$SCREEN and (.body.text|contains(\"Friends invited: <b>1</b>\") and contains(\"Earned so far: <b>2,000 Toman</b>\"))"

echo '== free trial'
expect 'trial on a squad the broker lacks rejected' 400 PATCH /api/broker-bot/settings "$BT" '{"trial":{"isActive":true,"trafficGb":1,"durationDays":1,"squadUuids":["00000000-0000-4000-8000-000000000000"]}}'
expect 'set up the free trial' 200 PATCH /api/broker-bot/settings "$BT" "{\"trial\":{\"isActive\":true,\"trafficGb\":0.5,\"durationDays\":1,\"ipLimit\":1,\"squadUuids\":[\"$SQUAD\",\"$SQUAD2\"]}}"
check 'trial saved, nobody claimed yet' ".response | .trial=={isActive:true,trafficGb:0.5,durationDays:1,ipLimit:1,squadUuids:[\"$SQUAD\",\"$SQUAD2\"]} and .trialClaims==0"
callback menu
call_check 'menu offers the free trial' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"trial\")"
callback trial
call_check 'trial offer shows traffic, duration and devices' "$SCREEN and (.body.text|contains(\"Try us for free\") and contains(\"0.5 GB\") and contains(\"1 days\") and contains(\"Devices at once</b>: 1\")) and any(.body.reply_markup.inline_keyboard[][];.callback_data==\"trialgo\")"
callback trialgo
call_check 'trial activated with a link' "$SCREEN and (.body.text|contains(\"Your subscription is active\"))"
wait_calls 'trial logged' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"E2E Customer claimed the free trial\")))"
callback trialgo
check 'a second tap on Activate does nothing' '[.calls[]|select(.method=="editMessageText" or .method=="sendMessage")]|length==0' "$CALLS"
expect 'users after the trial' 200 GET '/api/users?start=0&size=50' "$BT"
check 'trial user has the trial limits and both squads' ".response | .total==2 and any(.users[]; .id!=$USER_ID and .trafficLimitBytes==536870912 and .ipLimit==1 and (.telegramId|tostring)==\"5550001\" and ([.activeInternalSquads[].uuid]|sort)==([\"$SQUAD\",\"$SQUAD2\"]|sort))"
callback trial
call_check 'the same account cannot claim twice' "$SCREEN and (.body.text|contains(\"already used your free trial\"))"
callback mysubs
call_check 'the trial is listed by name' "$SCREEN and any(.body.reply_markup.inline_keyboard[][];.text==\"🎁 Free trial\")"
callback trial 5550004 5550004
callback trialgo 5550004 5550004
call_check 'another account can claim it' ".method==\"editMessageText\" and (.body.chat_id|tostring)==\"5550004\" and (.body.text|contains(\"Your subscription is active\"))"
expect 'claims counted' 200 GET /api/broker-bot "$BT"
check 'two claims this round' '.response.trialClaims==2'
expect 'reset the trial' 200 PATCH /api/broker-bot/settings "$BT" '{"resetTrial":true}'
check 'a new round starts empty' '.response.trialClaims==0'
callback trial
call_check 'after a reset the trial is offered again' "$SCREEN and (.body.text|contains(\"Try us for free\"))"
callback trialgo
call_check 'and can be claimed again' "$SCREEN and (.body.text|contains(\"Your subscription is active\"))"
expect 'switch the trial off' 200 PATCH /api/broker-bot/settings "$BT" "{\"trial\":{\"isActive\":false,\"trafficGb\":0.5,\"durationDays\":1,\"squadUuids\":[\"$SQUAD\"]}}"
callback trial
call_check 'a switched-off trial is unavailable' "$SCREEN and (.body.text|contains(\"Purchases are paused\"))"
expect 'trial users' 200 GET '/api/users?start=0&size=50' "$BT"
for id in $(jq -r ".response.users[] | select(.id!=$USER_ID) | .id" "$BODY"); do
  expect "delete trial user $id" 204 DELETE "/api/users/$id" "$ADMIN"
done

echo '== stats'
expect 'stats page' 200 GET /api/broker-bot/stats "$BT"
check 'today counts everything' '.response.today | .newCustomers==5 and .referrals==2 and .activeCustomers==5 and .sales==1 and .salesAmount==10000 and .topups==3 and .topupsAmount==80000 and .rejectedTopups==1 and .trials==3 and .rewards==3000'
check 'totals' '.response.totals | .customers==5 and .buyers==1 and .walletTotal==74234 and .pendingReceipts==0 and .trials==3'
check 'weeks and months include today' '.response | .week.trials==3 and .month.sales==1 and (.daily|length)==30 and .daily[-1].trials==3 and .daily[0].trials==0'
check 'top plans' ".response.topPlans==[{planId:$PLAN,title:\"Basic\",sales:1,salesAmount:10000}]"
message /stats -100123 9000002
check 'members who are not admins get no stats' 'all(.calls[]; .method!="sendMessage")' "$CALLS"
message /stats -100123 9000001
call_check 'admins get /stats' '.method=="sendMessage" and .body.chat_id=="-100123" and (.body.text|contains("Bot stats") and contains("Last 30 days") and contains("Plans sold: 1 · 10,000 Toman") and contains("Free trials: 3") and contains("Referral rewards: 3,000 Toman") and contains("Customers: 5"))'
mark
docker compose -f "$(dirname "$0")/docker-compose.yml" exec -T db psql -U postgres -qc \
  "UPDATE broker_bots SET summary_posted_on = current_date - 1 WHERE broker_uuid = '$BRK'" >/dev/null \
  || die 'make the daily summary due' 'needs the dev database container'
wait_calls 'daily summary posted to the Stats topic' "any(.calls[]; .method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$STATS_TOPIC and (.body.text|contains(\"Daily summary\") and contains(\"Customers: 5\")))"
call_check 'staff topics renamed to their current texts' ".method==\"editForumTopic\" and .body.message_thread_id==$STATS_TOPIC and .body.name==\"Stats\""
sleep 6
read_calls
check 'one summary a day' '[.calls[]|select(.method=="sendMessage" and (.body.text|contains("Daily summary")))]|length==1' "$CALLS"
expect 'referrals off' 200 PATCH /api/broker-bot/settings "$BT" '{"referralPercent":0}'
callback menu
call_check 'menu back to the basics' "$SCREEN and ($MENU)"

echo '== trial in hours, daily cap, auto-delete'
# Three trials went out today above, so a cap of 4 leaves one.
expect 'trial in hours with a daily cap' 200 PATCH /api/broker-bot/settings "$BT" "{\"trial\":{\"isActive\":true,\"trafficGb\":0.5,\"durationDays\":1,\"durationHours\":6,\"dailyLimit\":4,\"deleteExpired\":true,\"squadUuids\":[\"$SQUAD\"]}}"
check 'trial options saved' '.response.trial | .durationHours==6 and .dailyLimit==4 and .deleteExpired==true'
callback trial 5550004 5550004
call_check 'trial offer shows hours' '.method=="editMessageText" and (.body.chat_id|tostring)=="5550004" and (.body.text|contains("6 hours"))'
callback trialgo 5550004 5550004
call_check 'the 4th trial today goes out' '.method=="editMessageText" and (.body.chat_id|tostring)=="5550004" and (.body.text|contains("Your subscription is active"))'
expect 'users after the hours trial' 200 GET '/api/users?start=0&size=50' "$BT"
check 'it expires in 6 hours' '[.response.users[] | select((.telegramId|tostring)=="5550004") | (.expireAt[0:19]+"Z"|fromdateiso8601) - now] | length==1 and (.[0] > 5.9*3600 and .[0] < 6.1*3600)'
callback trial 5550002 5550002
call_check 'a 5th customer is told to come back tomorrow' '.method=="editMessageText" and (.body.chat_id|tostring)=="5550002" and (.body.text|startswith("⏳")) and any(.body.reply_markup.inline_keyboard[][];.callback_data=="buy")'
callback trialgo 5550003 5550003
call_check 'an old Activate button hits the cap too' '.method=="editMessageText" and (.body.chat_id|tostring)=="5550003" and (.body.text|startswith("⏳"))'
expect 'claims counted' 200 GET /api/broker-bot "$BT"
check 'only the allowed claim counted' '.response.trialClaims==2'
expect 'switch the trial off' 200 PATCH /api/broker-bot/settings "$BT" "{\"trial\":{\"isActive\":false,\"trafficGb\":0.5,\"durationDays\":1,\"squadUuids\":[\"$SQUAD\"]}}"
check 'hours, cap and auto-delete cleared' '.response.trial | has("durationHours")|not'
expect 'trial users' 200 GET '/api/users?start=0&size=50' "$BT"
for id in $(jq -r ".response.users[] | select(.id!=$USER_ID) | .id" "$BODY"); do
  expect "delete trial user $id" 204 DELETE "/api/users/$id" "$ADMIN"
done

echo '== support relay'
callback support
call_check 'support prompt' "$SCREEN and (.body.text|contains(\"Type your message\"))"
message 'Please help with my connection'
call_check 'ticket topic created' '.method=="createForumTopic" and .body.chat_id=="-100123" and (.body.name|startswith("🎫 "))'
TICKET=$(jq -r '.calls[]|select(.method=="createForumTopic")|.result.message_thread_id' "$CALLS")
call_check 'customer text relayed to ticket' ".method==\"sendMessage\" and .body.chat_id==\"-100123\" and .body.message_thread_id==$TICKET and .body.text==\"👤 Please help with my connection\""
message 'We can help now' -100123 9000001 "$TICKET"
call_check 'admin reply relayed to customer' "$SEND and .body.text==\"💬 We can help now\""
control /_delete_topic "{\"threadId\":$TICKET}"
message 'Are you still there?'
call_check 'deleted ticket topic replaced' ".method==\"createForumTopic\" and .body.chat_id==\"-100123\" and .result.message_thread_id!=$TICKET"
NEW_TICKET=$(jq -r '.calls[]|select(.method=="createForumTopic")|.result.message_thread_id' "$CALLS")
call_check 'message relayed to the new ticket' ".method==\"sendMessage\" and .body.message_thread_id==$NEW_TICKET and .body.text==\"👤 Are you still there?\""
call_check 'customer told the message went through' "$SEND and (.body.text|contains(\"Message sent\"))"

echo '== owner broadcast'
expect 'broker cannot broadcast' 403 POST /api/broker-bot/broadcasts "$BT" '{"caption":"x","image":null}'
expect 'empty broadcast rejected' 400 POST /api/broker-bot/broadcasts "$ADMIN" '{"caption":null,"image":null}'
expect 'broadcast audience' 200 GET /api/broker-bot/broadcasts "$ADMIN"
check 'audience includes this bot' '.response.audience >= 1'
wait_broadcast() { # name id
  local deadline=$((SECONDS+30))
  while ((SECONDS < deadline)); do
    req GET /api/broker-bot/broadcasts "$ADMIN" >/dev/null
    if jq -e ".response.broadcasts[] | select(.id==$2 and .status==\"done\")" "$BODY" >/dev/null; then
      check "$1" ".response.broadcasts[] | select(.id==$2) | .sent==.recipients and .failed==0"; return
    fi
    sleep 0.5
  done
  die "$1" "not finished: $(cat "$BODY")"
}
mark
expect 'text broadcast started' 201 POST /api/broker-bot/broadcasts "$ADMIN" '{"caption":"Platform news","image":null}'
wait_broadcast 'text broadcast delivered to everyone' "$(jqb .response.id)"
read_calls
call_check 'customer got the broadcast' "$SEND and .body.text==\"Platform news\""
mark
PNG=iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=
expect 'photo broadcast started' 201 POST /api/broker-bot/broadcasts "$ADMIN" "{\"caption\":\"Sale today\",\"image\":{\"fileName\":\"sale.png\",\"mimeType\":\"image/png\",\"base64\":\"$PNG\"}}"
wait_broadcast 'photo broadcast delivered to everyone' "$(jqb .response.id)"
read_calls
call_check 'photo uploaded with caption' '.method=="sendPhoto" and .body.multipart and .body.caption=="Sale today" and .body.photo.filename=="sale.png"'

echo '== forged presses and an inactive broker'
# Any group member with a modified client can send any button data on a bot message.
callback menu 9000002 -100123 "$REVIEW_MSG"
check 'customer button in the staff group changes nothing' '[.calls[] | select(.method=="editMessageText" or .method=="sendMessage")] | length==0' "$CALLS"
callback charge
message 30000
photo
expect 'third pending receipt' 200 GET /api/broker-bot/orders "$BT"
THIRD=$(jqb '.response.pending[0].id')
THIRD_MSG=$(jq -r --arg ap "ap:$THIRD" '.calls[]|select(.method=="sendMessage" and any(.body.reply_markup.inline_keyboard[]?[]?;.callback_data==$ap))|.result.message_id' "$CALLS")
expect 'owner lets the broker expire' 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"expireAt\":\"2020-01-01T00:00:00.000Z\"}"
callback "ap:$THIRD" 9000001 -100123 "$THIRD_MSG"
call_check 'expired broker staff cannot approve' '.method=="answerCallbackQuery" and .body.text=="This broker account is inactive."'
expect 'expired broker receipt untouched' 200 GET /api/broker-bot/orders "$BT"
check 'receipt still pending' "any(.response.pending[];.id==$THIRD)"
callback wallet
callback charge
call_check 'no top-ups while the broker cannot sell' "$SCREEN and (.body.text|contains(\"Purchases are paused\"))"
expect 'owner clears the expiry' 200 PATCH /api/brokers "$ADMIN" "{\"uuid\":\"$BRK\",\"expireAt\":null}"
callback "ap:$THIRD" 9000001 -100123 "$THIRD_MSG"
call_check 'approvals work again' "$SEND and (.body.text|contains(\"Wallet charged\") and contains(\"30,000 Toman\"))"
callback wallet
callback charge
callback wallet
message 12345
call_check 'after Back, typed text is not a top-up amount' "$SEND and (.body.text|contains(\"Tap one of the buttons\"))"
callback charge
message 15000
call_check 'payment instructions sent' "$SEND and (.body.text|contains(\"15,000 Toman\"))"
expect 'broker removes the staff group' 200 POST /api/broker-bot/connect "$BT" '{"groupId":null,"lang":"en","greeting":null}'
photo
check 'receipt sent after the group was removed is not posted' '[.calls[]|select(.method=="copyMessage")]|length==0' "$CALLS"
expect 'receipt kept for the panel' 200 GET /api/broker-bot/orders "$BT"
check 'pending receipt without staff group' 'any(.response.pending[]; .amount==15000 and .receiptKind=="photo")'
callback wallet
callback charge
call_check 'no top-up instructions without a staff group' "$SCREEN and (.body.text|contains(\"Payment isn\"))"
callback support
call_check 'support without a staff group says so' "$SCREEN and (.body.text|contains(\"Support isn\"))"
message 'Hello?'
call_check 'a stray message gets the menu, not silence' "$SEND and (.body.text|contains(\"Tap one of the buttons\"))"

echo '== disconnect'
expect 'disconnect bot' 200 DELETE /api/broker-bot "$BT"
DISCONNECTED=1
check 'disconnected state' '.response | (.isConnected|not) and .botUsername==null and (.topicsReady|not)'
# Let two reconciliations pass. Wake any incorrectly surviving long poll, then
# watch for another poll: counting calls alone could miss a held 30-second request.
sleep 12
mark
control /_push "$(jq -nc --arg token "$TOKEN" '{token:$token,update:{message:{message_id:9999,from:{id:5550001},chat:{id:5550001,type:"private"},text:"/start"}}}')"
sleep 6
read_calls
check 'no polling or replies after disconnect' '.calls|length==0' "$CALLS"
expect 'delete subscription fixture' 204 DELETE "/api/users/$USER_ID" "$ADMIN"
expect 'delete broker as admin' 204 DELETE "/api/brokers/$BRK" "$ADMIN"
BRK=''
