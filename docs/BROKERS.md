# Brokers

Brokers are reseller accounts. They sign in to the same panel but can only manage their own users, inside limits
the panel owner sets. Each broker can also run its own Telegram store bot.

## What a broker can do

| Broker can | Broker can't |
| --- | --- |
| Create, edit, enable/disable, extend, reset, revoke and delete **its own** users, one by one or in bulk | See or touch users of the owner or other brokers |
| Put users only in the internal squads the owner allowed, and see each squad's countries (servers online), protocols and the entries its users get | See nodes, hosts, config profiles, settings, panel statistics, API tokens, node names or addresses |
| Brand its own subscription page, and edit its external squad's client settings, response headers and remarks | Change its squad's templates, host overrides, HWID settings or linked page |
| See a Status page: its quota, users limit, expiry, user and online stats, users expiring soon or near their limit | Use "all users" bulk actions or the API with tokens (browser sign-in only) |
| See its users' HWID devices and subscription request history, open users by ID (Quick open) | Raise its own limits |

Limits the owner sets per broker (Management → Brokers):

- **Traffic quota**: total traffic of all its users. Counted in the same database transaction as user
  traffic, so deleting users or resetting their traffic does **not** give quota back. When it runs out,
  all of the broker's active users become `LIMITED` (removed from nodes) and the broker can't create,
  enable, extend or edit users until you raise the quota or reset its usage. Then they come back
  automatically.
- **Users limit**: maximum number of users the broker can own.
- **Expiry date**. An expired broker can still sign in and look around but can't change anything,
  and all of its users expire with it. Extend the broker and they come back straight away.
- **Enable/disable** switch. A disabled broker can't sign in; its users keep working.
- **Allowed internal squads**.

Each broker also gets **its own external squad and subscription page config**, created with the broker
and named after it (so broker usernames are limited to 30 characters and can't match an existing squad
or page config name). Its users always use that squad. You can still set the squad's templates, host
overrides and HWID settings on the External squads page. If you link the broker's page config to another
squad as well, the broker can no longer edit it.

The subscription page and your config editor show page icons and texts as raw HTML, so a broker's page
config may only use plain SVG shapes, simple text formatting (`<b>`, `<i>`, `<br>`…, no attributes) and
non-script links. Scripts, event handlers, embedded objects and `javascript:`/`data:` links are refused
with the field that has them. Your own edits aren't checked.

Subscription page edits (yours and brokers') show up the next time a user opens the page, and new brokers'
pages work right away.

Deleting a broker keeps its users; they become yours and keep the broker's squad. The squad and page
config stay too; delete them yourself if you don't need them.

## Telegram store bot

Each broker can connect its own Telegram bot under **Telegram bot → Bot settings** in its panel. The
bot speaks English or Persian:

- Customers open the bot, top up a wallet by card-to-card or crypto and send a receipt photo. Staff approve
  or reject it in the broker's Telegram group (forum topics *Review Receipts* and *Logs*) or on the panel's
  **Orders** page.
- With a balance, a customer buys a plan in one tap. The panel creates a user owned by the broker, on the
  plan's internal squad, with the customer's Telegram ID, and sends the subscription link. *My subscriptions*
  shows usage, expiry and the connection links.
- Plans (traffic, days, price in Toman, one internal squad), plan categories, payment cards and wallets, a
  channel button, mandatory channels, support tickets (a forum topic per customer), `/find` to discover the
  group ID, manual wallet top-ups and bot stats.
- A bot-sold user counts like any other: toward the broker's users limit and traffic quota. Sales stop while
  the broker is disabled, expired, out of quota or at its users limit. New wallet top-ups stop too while it
  is disabled, expired or out of quota, and a disabled or expired broker's staff can't
  approve or reject receipts in Telegram either, the same as in the panel.
- Support tickets need the staff group; without one the bot tells customers support is unavailable. If staff
  delete or close a ticket topic, the customer's next message opens a new one.
- Customers only get payment instructions when a receipt can be taken (payment methods and the staff group's
  review topic set, fewer than 5 pending receipts). A receipt for money already sent is always kept for the
  **Orders** page. A purchase pays once even on a double tap, and if you change a plan while a customer is
  looking at it, they see the new terms before paying.
- **Bot broadcast** (Users menu → Bot broadcast, owner only): send a message and/or a photo to every customer of
  every connected broker bot. It goes out in the background through each broker's own bot (about 20 messages a
  second) and the page shows how many were sent and failed. Brokers see a notice that this can happen. If the
  panel is behind nginx, photos over 1 MB need a bigger `client_max_body_size`.
- The broker panel, the bot pages and the broadcast page are in English and Persian.

How it runs: by default bots **long-poll** Telegram from API instance 0, so no public webhook URL or nginx
change is needed. If Telegram is blocked on the server, set `TELEGRAM_BOT_PROXY` (the same variable the
notification bot uses).

**Webhook mode**: set `BROKER_BOT_WEBHOOK_DOMAIN` (a domain, optionally with a port, no `https://`), and
Telegram pushes each bot's updates to `https://<domain>/api/broker-bot/webhook/<broker uuid>` instead. Connecting
a bot sets its webhook, and on every start the panel re-registers all connected bots, so switching the variable
on or off only needs a restart. The domain must have a valid TLS certificate on port 443, 80, 88 or 8443 and be
reachable from Telegram, so `TELEGRAM_BOT_PROXY` doesn't help here. In nginx only `/api/broker-bot/webhook/`
needs to be open on that domain; keep it out of any cookie or IP protection the panel has, and allow it in
Cloudflare's WAF. Each call carries a secret header derived from `APP_SECRET` and the bot token, and wrong ones
get 401. Telegram sends one update at a time per bot, and a resent update is handled once. Bot tokens are stored encrypted with `APP_SECRET`; changing `APP_SECRET` means brokers have to
save their token again. A token can run in one place only: connecting it here replaces any webhook, so stop
any other app using that token first.
