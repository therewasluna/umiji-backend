# Deploying Umiji

This guide takes you from an empty server to a working panel and subscription page, and then covers updates,
backups and moving things around. Every command block says where to run it: **on your computer** or **on the server**.

## How it fits together

```
 YOUR COMPUTER                                       SERVER(S)
 ─────────────                                       ─────────
 umiji-backend/               tools/deploy.sh     /opt/umiji/
 umiji-frontend/        ── builds the images ──▶   docker-compose.yml, up.sh
 umiji-subscription-page/  and sends them           .env, panel.env, subpage.env
                               over SSH                 backups/

                                                     Containers:  umiji (panel), umiji-db (Postgres),
                                                                  umiji-redis (Valkey), umiji-subscription-page,
                                                                  umiji-caddy (only with built-in HTTPS)

                                                     HTTPS, one of:
                                                       built-in Caddy  https://panel.example.com → umiji:3000
                                                                       https://sub.example.com   → umiji-subscription-page:3010
                                                       your own nginx  https://panel.example.com → 127.0.0.1:3000
                                                                       https://sub.example.com   → 127.0.0.1:3010
```

You build on your computer because the panel needs Node to build. The server only needs Docker. Each server runs
the panel, the subscription page ("sub page"), or both. You pick per server, and you can change it later.

| Layout                     | Server   | Runs (`COMPOSE_PROFILES`) |
| -------------------------- | -------- | ------------------------- |
| Everything on one server   | server A | `panel,subpage`           |
| Sub page on its own server | server A | `panel`                   |
|                            | server B | `subpage`                 |

Nodes run on their own servers (step 9).

---

## 1. What you need

**Your computer** (Linux or macOS):

- Docker, Node 24+, `git`, `zip`, `python3`, `openssl`, `ssh`
- SSH access to the server as **root** with a key, so deploys don't ask for a password:
  ```bash
  # on your computer
  ssh-copy-id root@203.0.113.10
  ```

**Each server**: Ubuntu or Debian. Docker gets installed below, and nginx too if you pick it for HTTPS in step 7.

**Domains**: one for the panel (e.g. `panel.example.com`) and one for the sub page (e.g. `sub.example.com`). Point
each one's DNS **A record** at the server that will run it. Do this first: certificates need it.

## 2. Get the code (once)

```bash
# on your computer
git clone https://github.com/therewasluna/umiji-backend.git
git clone https://github.com/therewasluna/umiji-frontend.git
git clone https://github.com/therewasluna/umiji-subscription-page.git
cd umiji-backend
```

The three folders must sit next to each other. The deploy script finds them by name: `umiji-frontend` or
`frontend`, and `umiji-subscription-page` or `subscription-page`. What's checked out in them,
uncommitted changes included, is what gets deployed. All commands below run from `umiji-backend`.

## 3. Install Docker on the server

```bash
# on the server
curl -fsSL https://get.docker.com | sh
docker compose version        # should print a version
```

## 4. Put the stack on the server

```bash
# on your computer
tools/deploy.sh init root@203.0.113.10
```

This creates `/opt/umiji` on the server with:

| File                          | What it is                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`, `up.sh` | The stack and its start script. Every deploy replaces them, so don't edit them.                            |
| `.env`                        | What runs on this server.                                                                                  |
| `panel.env`                   | The panel's settings. A random `APP_SECRET`, database password and metrics password are already filled in. |
| `subpage.env`                 | The sub page's settings.                                                                                   |

Running `init` again is safe: it never overwrites the three env files.

## 5. Fill in the settings

```bash
# on the server
cd /opt/umiji
nano .env
nano panel.env
nano subpage.env
```

### `.env`

What this server runs: `panel,subpage` for both, or `panel` or `subpage` for just one. Add `caddy` for built-in
HTTPS (step 7 explains both ways):

```ini
# your own nginx in front
COMPOSE_PROFILES=panel,subpage

# or built-in HTTPS: Caddy gets the certificates itself
COMPOSE_PROFILES=panel,subpage,caddy
CADDY_PANEL_DOMAIN=panel.example.com
CADDY_SUBPAGE_DOMAIN=sub.example.com
```

With `caddy`, set the domain of each app this server runs. The other two `CADDY_` settings are for later:
`CADDY_TRUSTED_PROXIES` for a CDN and `CADDY_SUBPAGE_SERVER_IP` for a sub page on another server (both in step 7a).
Servers set up before these settings existed don't have the lines; add them by hand.

### `panel.env` (only on a server that runs the panel)

This is the panel's normal `.env`; `.env.sample` in this repo lists every setting.
Set these:

| Setting                                                                        | Value                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PANEL_DOMAIN`                                                                 | `panel.example.com`                                                                                                                                                                                                                     |
| `SUB_PUBLIC_DOMAIN`                                                            | `sub.example.com`, the sub page's domain, wherever it runs. It goes into every subscription link. If the sub page uses `CUSTOM_SUB_PREFIX`, add it: `sub.example.com/sub`.                                                              |
| `TELEGRAM_BOT_PROXY`                                                           | Only if Telegram is blocked on this server, e.g. `socks5://172.17.0.1:1080`. The broker bots use it too. Inside Docker, `127.0.0.1` means the container itself, so use the host's Docker IP (`172.17.0.1`) or a proxy container's name. |
| `IS_TELEGRAM_NOTIFICATIONS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFY_*` | Only if you want the panel's own Telegram notifications.                                                                                                                                                                                |
| `BROKER_BOT_WEBHOOK_DOMAIN`                                                    | Leave unset. Broker bots long-poll by default. See `docs/BROKERS.md` for webhook mode.                                                                                                                                                  |

**Don't change** `APP_SECRET` (it encrypts the brokers' bot tokens), `DATABASE_URL`, `POSTGRES_*` or `REDIS_SOCKET`.
`APP_SECRET` must be at least 32 characters; a shorter value now stops the panel at startup.

### `subpage.env` (only on a server that runs the sub page)

| Setting             | Value                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `UMIJI_PANEL_URL`   | Keep `http://umiji:3000` if the panel runs on **this** server. Otherwise use `https://panel.example.com`. |
| `UMIJI_PANEL_PROXY` | Only if this server can't reach the panel directly, e.g. `socks5://172.17.0.1:1080`.                      |
| `UMIJI_API_TOKEN`   | Leave empty for now. You create it in step 8.                                                             |

## 6. Start it

```bash
# on your computer
tools/deploy.sh up root@203.0.113.10
```

What happens:

1. It reads `COMPOSE_PROFILES` on the server and builds only the images it needs. The first build takes a few minutes.
2. It sends the images over SSH. That's a few hundred MB, sent again whenever an image changes. An image the server
   already has is skipped.
3. It runs `up.sh` on the server, which backs up the database (if one is running), then starts the containers.
   The panel applies database migrations on start.

At the end you'll see the container list. On the first run this warning is expected:

```
!! subpage.env has no UMIJI_API_TOKEN, so the sub page can't start. ...
```

The panel and sub page listen on `127.0.0.1` only. With `caddy` in `COMPOSE_PROFILES`, Caddy now serves them over
HTTPS. Otherwise they're not open to the internet until you set up nginx in step 7.

## 7. HTTPS: built-in Caddy or your own nginx

The panel only answers requests that come through a reverse proxy over HTTPS: it needs `X-Forwarded-For` and
`X-Forwarded-Proto: https`. Without them it closes the connection. Pick one of two ways per server:

|                  | Built-in Caddy (7a)                   | Your own nginx (7b)                                |
| ---------------- | ------------------------------------- | -------------------------------------------------- |
| Setup            | Two lines in `.env`                   | Install nginx and certbot, write the config        |
| Certificates     | Caddy gets and renews them itself     | certbot gets and renews them                       |
| Ports 80 and 443 | Caddy takes them, so nothing else can | nginx has them and can serve other sites as well   |
| Good for         | A server that runs only Umiji         | A server with other sites, or your own nginx rules |

Both make sure the visitor can't choose the IP the panel sees, which the login limit and the IP records rely on.

### 7a. Built-in Caddy

1. Check that each domain's DNS points at this server and that ports 80 and 443 are open. Caddy needs both to
   get a certificate, and nothing else on the server may use them (stop nginx or Apache if they're installed).
2. In `/opt/umiji/.env`, add `caddy` to `COMPOSE_PROFILES` and set the domains of what this server runs:
   ```ini
   COMPOSE_PROFILES=panel,subpage,caddy
   CADDY_PANEL_DOMAIN=panel.example.com
   CADDY_SUBPAGE_DOMAIN=sub.example.com
   ```
3. Start it with `tools/deploy.sh up`, or with `./up.sh` on the server if the images are already there.

`up.sh` writes Caddy's config to `/opt/umiji/caddy/Caddyfile` on every run, so change `.env`, not that file.
Certificates are kept in the `umiji-caddy-data` volume and renewed long before they expire. Watch the first one
arrive with `docker compose logs -f umiji-caddy`: it says `certificate obtained successfully` for each domain.

**Behind a CDN** (e.g. Cloudflare's orange cloud), set Cloudflare's SSL mode to **Full (strict)** and turn off
**Always Use HTTPS**: Caddy gets and renews its certificates over plain http on port 80, and redirects visitors to
https itself. Then tell Caddy the CDN's IP ranges, space-separated, from https://www.cloudflare.com/ips/ (or your
CDN's list), so it takes the visitor's IP from the CDN instead of seeing only the CDN's. Keep the quotes: `up.sh`
reads `.env` with bash, which stops at the first space without them.

```ini
CADDY_TRUSTED_PROXIES="173.245.48.0/20 103.21.244.0/22 ... 2400:cb00::/32 ..."
```

**Sub page on another server**: on the panel's server, set `CADDY_SUBPAGE_SERVER_IP` to the sub page server's IP.
The sub page passes its visitors' IPs on to the panel, and Caddy only lets that server do it.

### 7b. Your own nginx

#### Install nginx and certbot

```bash
# on the server
apt install -y nginx certbot python3-certbot-nginx
ufw status                     # if it says "active", open the web ports:
ufw allow 'Nginx Full'
```

Don't open ports 3000, 3001 or 3010. The containers listen on `127.0.0.1` so that only nginx can reach them.

#### Write the config

```bash
# on the server
nano /etc/nginx/sites-available/umiji
```

Paste this, with your domains. On a server that runs only one of the two apps, keep only its `server` block, plus
both `map`s if you keep the panel's.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# The panel reads the visitor's IP from X-Umiji-Real-IP, so nginx sets it and ignores whatever the visitor sent.
map $remote_addr $umiji_real_ip {
    default $remote_addr;
    # A sub page on another server that reaches the panel at https://panel.example.com sends its own
    # visitors' IPs. Trust it by its IP:
    # 203.0.113.20 $http_x_umiji_real_ip;
}

# Panel
server {
    listen 80;
    server_name panel.example.com;

    # Bot broadcast photos are up to 10 MB.
    client_max_body_size 20m;

    # Backend-tools links carry a short-lived bearer token in the query string.
    location ^~ /api/backend-tools {
        access_log off;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Umiji-Real-IP $umiji_real_ip;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Umiji-Real-IP $umiji_real_ip;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Subscription page
server {
    listen 80;
    server_name sub.example.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

What each part is for:

- `Upgrade` and `Connection`: the panel's SSH terminal runs over a WebSocket.
- `X-Umiji-Real-IP`: the visitor's IP for the login limit, failed-login alerts and IP records. nginx always sets
  it, so a visitor can't send their own.
- `X-Forwarded-For` and `X-Forwarded-Proto`: the panel refuses requests without them. The sub page takes the
  visitor's IP from the last `X-Forwarded-For` entry, which is the one nginx adds.
- `client_max_body_size 20m`: room for broadcast photos.
- `access_log off` on `/api/backend-tools`: those links carry a token, which shouldn't sit in a log file.

#### Turn it on and get certificates

```bash
# on the server
ln -s /etc/nginx/sites-available/umiji /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default       # nginx's welcome page, not needed
nginx -t && systemctl reload nginx
certbot --nginx -d panel.example.com -d sub.example.com    # only the domains this server serves
```

Certbot asks for an email and to accept the terms once. It then adds HTTPS and the http→https redirect to this
file. Before certbot runs, the panel won't load: over plain http the proto header is `http`, and the panel refuses
that.

Certificates last 90 days. Certbot's timer renews them on its own; check that renewal works:

```bash
# on the server
certbot renew --dry-run
```

#### Check it

```bash
# on your computer
curl -sI https://panel.example.com | head -1          # HTTP/2 200 (or HTTP/1.1 200)
curl -sI http://panel.example.com | grep -i location  # https://panel.example.com/
```

#### Behind a CDN

If the domains go through Cloudflare's proxy (orange cloud) or another CDN, set Cloudflare's SSL mode to
**Full (strict)**. nginx then sees the CDN's addresses instead of your visitors', so they would all share one login
limit. Add this at the top of the file, with one `set_real_ip_from` line for each of the CDN's ranges (Cloudflare
lists them on https://www.cloudflare.com/ips/):

```nginx
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 2400:cb00::/32;
# ...the other ranges
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

nginx then reads `X-Forwarded-For` from the right and skips the CDN's own entries, so an entry the visitor wrote
at the start is never used. Every `$remote_addr` above, and so the panel, gets the visitor's real IP.

#### nginx in Docker

If your nginx runs in a container, join it to the `umiji-network` network and use `http://umiji:3000` and
`http://umiji-subscription-page:3010` instead of the `127.0.0.1` addresses.

#### Upgrading a server set up before November 2026?

Its nginx passes on the `X-Umiji-Real-IP` a visitor sends, so anyone can pick the IP the panel sees and get around
the login limit. Add the `$umiji_real_ip` map and the two `X-Umiji-Real-IP` lines above, then run
`nginx -t && systemctl reload nginx`.

## 8. First login, then connect the sub page

1. Open `https://panel.example.com` and create the admin account. The first account you register becomes the admin.
2. Go to **Umiji Settings → API Tokens** and create a token.
3. On the server that runs the sub page, put it in `subpage.env` and apply it:
   ```bash
   # on the sub page's server
   cd /opt/umiji
   nano subpage.env              # UMIJI_API_TOKEN=<the token>
   ./up.sh
   ```
4. Check it works: create a user in the panel and open their subscription link. It should open
   `https://sub.example.com/<id>` and show the subscription page.

`https://sub.example.com/` on its own doesn't load. That's normal: the sub page drops any request that isn't a
real subscription link.

## 9. Add nodes

Add each node in the panel (**Nodes → Create node**). The panel shows the `docker-compose.yml` to run on the node
server. The node image is built from [umiji-node](https://github.com/therewasluna/umiji-node).

If the panel can't reach a node directly, set the node's **Proxy URL** (`socks5://…` or `http://…`). The panel
then talks to that node only through the proxy. A proxy on the panel's own server can be written as `127.0.0.1`:
inside Docker the panel reaches it as `host.docker.internal`, which is the host's Docker IP (`172.17.0.1`). For
that to work the proxy must listen on `172.17.0.1` or `0.0.0.0`, not on `127.0.0.1` alone, and the firewall must
let Docker reach the port, for example `ufw allow from 172.16.0.0/12 to any port 1080`.

**Inbounds behind a CDN** (XHTTP, WebSocket, HTTPUpgrade or gRPC through Cloudflare and the like): the node sees
the CDN's addresses, not your users'. The simultaneous IP limit then refuses users at random, and an app can even
write its own address into the header the node reads. The wiki shows the setup that gives the node each user's
real IP: a small nginx on the node in front of Xray, plus one inbound setting.
See [Behind a CDN](https://umiji.wiki/concepts/#ip-limit-cdn).

---

## Everyday use

### Deploy a new version

```bash
# on your computer
git pull                                          # in each of the three folders, or check out what you want
tools/deploy.sh up root@203.0.113.10
```

Run it any time. Before it restarts the panel, `up.sh` saves a database backup. If nothing changed in an image, the
server keeps running it without a restart. To deploy the same build to a second server without building again:

```bash
SKIP_BUILD=1 tools/deploy.sh up root@198.51.100.20
```

The single-owner migration requires at most one existing `ADMIN` row. If a previous registration race created
multiple owners, resolve those accounts before upgrading or the migration will stop.

### Change a setting

You don't need your computer for this: edit the env file on the server and run `up.sh`. It only restarts what changed.

```bash
# on the server
cd /opt/umiji
nano panel.env
./up.sh
```

### Move the sub page to its own server

1. Point the sub page's domain at the new server.
2. On your computer: `tools/deploy.sh init root@NEW_SERVER`.
3. On the new server: `.env` → `COMPOSE_PROFILES=subpage`. In `subpage.env`, set
   `UMIJI_PANEL_URL=https://panel.example.com` and copy `UMIJI_API_TOKEN` from the old server.
4. On your computer: `tools/deploy.sh up root@NEW_SERVER`, then set up HTTPS there (step 7: `caddy` with only
   `CADDY_SUBPAGE_DOMAIN`, or nginx with only the sub page block). On the panel's server, let the new server pass
   on its visitors' IPs: `CADDY_SUBPAGE_SERVER_IP` in `.env` with Caddy, or the commented line in the nginx `map`.
5. On the panel's server: `.env` → `COMPOSE_PROFILES=panel`, then run `/opt/umiji/up.sh`. That removes the old sub
   page container. If the sub page's domain changed, update `SUB_PUBLIC_DOMAIN` in `panel.env` first.

Moving it back works the same way in reverse. Whatever `COMPOSE_PROFILES` lists runs, and the rest is removed. Data
is never deleted.

### Backups

`up.sh` dumps the database to `/opt/umiji/backups/<date>.sql.gz` before every deploy and keeps the last 10.
To take one by hand, or to copy one to your computer:

```bash
# on the server
cd /opt/umiji
docker compose exec -T umiji-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backups/manual.sql.gz

# on your computer
scp root@203.0.113.10:/opt/umiji/backups/manual.sql.gz .
```

Also keep a copy of `panel.env`. Without its `APP_SECRET`, brokers have to reconnect their bots.

### Restore a backup

This replaces the whole database with the backup.

```bash
# on the server
cd /opt/umiji
ls backups/                                         # pick one, then use its name below
docker compose stop umiji
docker compose exec -T umiji-db sh -c 'dropdb -U "$POSTGRES_USER" --force --maintenance-db=template1 "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" --maintenance-db=template1 "$POSTGRES_DB"'
gunzip -c backups/20261024-141537.sql.gz | docker compose exec -T umiji-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' > /dev/null
docker compose start umiji
```

If you're going back because a new version broke something, also deploy the older version: check out the old
commit on your computer and run `tools/deploy.sh up`.

### Useful commands

```bash
# on the server, in /opt/umiji
docker compose ps                                   # what's running and healthy
docker compose logs -f umiji                    # panel logs (Ctrl+C to stop)
docker compose logs -f umiji-subscription-page  # sub page logs
docker compose restart umiji                    # restart the panel
docker compose down                                 # stop everything (data stays)
./up.sh                                             # start everything again
```

---

## Troubleshooting

| Problem                                                                              | Fix                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The panel page doesn't load, and its log says `Reverse proxy and HTTPS are required` | Open it through nginx over **https**. Check that the nginx block sets `X-Forwarded-For` and `X-Forwarded-Proto`, and that certbot ran.                                                                                                                 |
| `umiji-caddy` won't start: `address already in use`                                  | Something else has port 80 or 443, usually nginx or Apache. Stop it (`systemctl disable --now nginx`), or leave `caddy` out and use nginx (step 7b).                                                                                                   |
| Caddy's log says it couldn't get a certificate                                       | The domain's DNS must point at this server, and ports 80 and 443 must be open to the internet. Behind Cloudflare, turn off **Always Use HTTPS**. Caddy retries on its own; check with `docker compose logs -f umiji-caddy`.                            |
| Every login, alert or IP record shows the same IP                                    | A CDN is in front and the proxy doesn't know it: set `CADDY_TRUSTED_PROXIES` (step 7a) or the `set_real_ip_from` lines (step 7b).                                                                                                                      |
| nginx shows `502 Bad Gateway`                                                        | The container isn't running yet or crashed. Check `docker compose ps` and `docker compose logs <service>`. The panel takes about 30 s to start.                                                                                                        |
| The sub page keeps restarting                                                        | `UMIJI_API_TOKEN` is empty or wrong, or `UMIJI_PANEL_URL` is wrong. Check `docker compose logs umiji-subscription-page`.                                                                                                                               |
| Subscription links point to the wrong domain                                         | `SUB_PUBLIC_DOMAIN` in `panel.env`. Then run `./up.sh`.                                                                                                                                                                                                |
| Uploading a broadcast photo fails with `413`                                         | `client_max_body_size 20m;` is missing from the panel's nginx block.                                                                                                                                                                                   |
| `docker compose up` on the server hangs or fails pulling `postgres` or `valkey`      | The server can't reach Docker Hub. Send the images from your computer: `docker pull postgres:18.4 valkey/valkey:9-alpine && docker save postgres:18.4 valkey/valkey:9-alpine \| gzip \| ssh root@SERVER 'gunzip \| docker load'`, then run `up` again. |
| Broker bots don't respond                                                            | Telegram may be blocked on the server. Set `TELEGRAM_BOT_PROXY` in `panel.env` (see step 5) and run `./up.sh`.                                                                                                                                         |
| `tools/deploy.sh` asks for the SSH password many times                               | Run `ssh-copy-id root@SERVER` once.                                                                                                                                                                                                                    |
| You can only reach the server's SSH through a proxy                                  | Run the script through it: `proxychains -q tools/deploy.sh up root@SERVER`. The script retries the first connection and then reuses it, so a flaky proxy only has to work once.                                                                        |
| `no /opt/umiji/.env on ...: run tools/deploy.sh init`                                | Run `init` first, or set `REMOTE_DIR` if the stack lives somewhere else.                                                                                                                                                                               |

## Reference

```
tools/deploy.sh init <host>    put the stack on the server, create the env files (never overwrites them)
tools/deploy.sh up <host>      build what that server runs, send it, start or update it
```

- `<host>` is anything `ssh` accepts: `root@1.2.3.4`, or a `Host` name from `~/.ssh/config`. Use `local` to deploy
  on the machine you're on. Use that when you build on the server itself, which then needs Node 24 and the three
  folders.
- `REMOTE_DIR=/srv/umiji` puts the stack somewhere other than `/opt/umiji`.
- `SKIP_BUILD=1` sends the images from the last build instead of building again.
- `FRONTEND_DIR=...` and `SUBPAGE_DIR=...` point at the frontend and sub page folders if they have other names.
- `caddy` in `COMPOSE_PROFILES` runs `caddy:2.10.2` as `umiji-caddy`. `up.sh` writes its config from the
  `CADDY_*` settings in `.env`, and it restarts only when that config changes.

The images are `umiji-panel:latest` (panel) and `umiji-subscription-page:latest` (sub page). The
compose file never pulls them from a registry, so a same-named image on Docker Hub can't replace yours.
`tools/build-image.sh` builds the panel image on its own: the frontend from the frontend folder, then this repo's
`Dockerfile`.
