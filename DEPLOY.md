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
                                                                  umiji-redis (Valkey), umiji-subscription-page

                                                     Your nginx:  https://panel.example.com → 127.0.0.1:3000
                                                                  https://sub.example.com   → 127.0.0.1:3010
```

You build on your computer because the panel needs Node to build. The server only needs Docker. Each server runs
the panel, the subscription page ("sub page"), or both. You pick per server, and you can change it later.

| Layout | Server | Runs (`COMPOSE_PROFILES`) |
| --- | --- | --- |
| Everything on one server | server A | `panel,subpage` |
| Sub page on its own server | server A | `panel` |
| | server B | `subpage` |

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

**Each server**: Ubuntu or Debian. Docker and nginx get installed below.

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

| File | What it is |
| --- | --- |
| `docker-compose.yml`, `up.sh` | The stack and its start script. Every deploy replaces them, so don't edit them. |
| `.env` | What runs on this server. |
| `panel.env` | The panel's settings. A random `APP_SECRET`, database password and metrics password are already filled in. |
| `subpage.env` | The sub page's settings. |

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

What this server runs: `panel,subpage` for both, or `panel` or `subpage` for just one.

```ini
COMPOSE_PROFILES=panel,subpage
```

### `panel.env` (only on a server that runs the panel)

This is the panel's normal `.env`; `.env.sample` in this repo lists every setting.
Set these:

| Setting | Value |
| --- | --- |
| `PANEL_DOMAIN` | `panel.example.com` |
| `SUB_PUBLIC_DOMAIN` | `sub.example.com`, the sub page's domain, wherever it runs. It goes into every subscription link. If the sub page uses `CUSTOM_SUB_PREFIX`, add it: `sub.example.com/sub`. |
| `TELEGRAM_BOT_PROXY` | Only if Telegram is blocked on this server, e.g. `socks5://172.17.0.1:1080`. The broker bots use it too. Inside Docker, `127.0.0.1` means the container itself, so use the host's Docker IP (`172.17.0.1`) or a proxy container's name. |
| `IS_TELEGRAM_NOTIFICATIONS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFY_*` | Only if you want the panel's own Telegram notifications. |
| `BROKER_BOT_WEBHOOK_DOMAIN` | Leave unset. Broker bots long-poll by default. See `docs/BROKERS.md` for webhook mode. |

**Don't change** `APP_SECRET` (it encrypts the brokers' bot tokens), `DATABASE_URL`, `POSTGRES_*` or `REDIS_SOCKET`.

### `subpage.env` (only on a server that runs the sub page)

| Setting | Value |
| --- | --- |
| `UMIJI_PANEL_URL` | Keep `http://umiji:3000` if the panel runs on **this** server. Otherwise use `https://panel.example.com`. |
| `UMIJI_PANEL_PROXY` | Only if this server can't reach the panel directly, e.g. `socks5://172.17.0.1:1080`. |
| `UMIJI_API_TOKEN` | Leave empty for now. You create it in step 8. |

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

The panel and sub page listen on `127.0.0.1` only, so they're not open to the internet until nginx is set up.

## 7. Set up nginx and HTTPS

The panel only answers requests that come through a reverse proxy over HTTPS: it needs `X-Forwarded-For` and
`X-Forwarded-Proto: https`. Without them it closes the connection.

```bash
# on the server
apt install -y nginx certbot python3-certbot-nginx
nano /etc/nginx/sites-available/umiji
```

Paste this, with your domains. On a server that runs only one of the two apps, keep only its `server` block, plus
the `map` if you keep the panel's.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Panel
server {
    listen 80;
    server_name panel.example.com;

    # Bot broadcast photos are up to 10 MB.
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
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

Turn it on and get certificates. Certbot adds HTTPS and the http→https redirect to this file, and renews the
certificates on its own:

```bash
# on the server
ln -s /etc/nginx/sites-available/umiji /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d panel.example.com -d sub.example.com    # only the domains this server serves
```

Before certbot runs, the panel won't load: over plain http the proto header is `http`, and the panel refuses that.

If the domains go through Cloudflare's proxy (orange cloud), set Cloudflare's SSL mode to **Full (strict)**.

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
4. On your computer: `tools/deploy.sh up root@NEW_SERVER`, then set up nginx there (step 7, sub page block only).
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

| Problem | Fix |
| --- | --- |
| The panel page doesn't load, and its log says `Reverse proxy and HTTPS are required` | Open it through nginx over **https**. Check that the nginx block sets `X-Forwarded-For` and `X-Forwarded-Proto`, and that certbot ran. |
| nginx shows `502 Bad Gateway` | The container isn't running yet or crashed. Check `docker compose ps` and `docker compose logs <service>`. The panel takes about 30 s to start. |
| The sub page keeps restarting | `UMIJI_API_TOKEN` is empty or wrong, or `UMIJI_PANEL_URL` is wrong. Check `docker compose logs umiji-subscription-page`. |
| Subscription links point to the wrong domain | `SUB_PUBLIC_DOMAIN` in `panel.env`. Then run `./up.sh`. |
| Uploading a broadcast photo fails with `413` | `client_max_body_size 20m;` is missing from the panel's nginx block. |
| `docker compose up` on the server hangs or fails pulling `postgres` or `valkey` | The server can't reach Docker Hub. Send the images from your computer: `docker pull postgres:18.4 valkey/valkey:9-alpine && docker save postgres:18.4 valkey/valkey:9-alpine \| gzip \| ssh root@SERVER 'gunzip \| docker load'`, then run `up` again. |
| Broker bots don't respond | Telegram may be blocked on the server. Set `TELEGRAM_BOT_PROXY` in `panel.env` (see step 5) and run `./up.sh`. |
| `tools/deploy.sh` asks for the SSH password many times | Run `ssh-copy-id root@SERVER` once. |
| You can only reach the server's SSH through a proxy | Run the script through it: `proxychains -q tools/deploy.sh up root@SERVER`. The script retries the first connection and then reuses it, so a flaky proxy only has to work once. |
| `no /opt/umiji/.env on ...: run tools/deploy.sh init` | Run `init` first, or set `REMOTE_DIR` if the stack lives somewhere else. |

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

The images are `umiji-panel:latest` (panel) and `umiji-subscription-page:latest` (sub page). The
compose file never pulls them from a registry, so a same-named image on Docker Hub can't replace yours.
`tools/build-image.sh` builds the panel image on its own: the frontend from the frontend folder, then this repo's
`Dockerfile`.
