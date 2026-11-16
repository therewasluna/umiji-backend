# Installing the Umiji panel

Umiji has three parts, and each one is installed on its own:

| Part         | What it is                                       | Install                                                                                                           | Folder            |
| ------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Panel**    | Where you manage users, nodes and brokers        | this guide                                                                                                        | `/opt/umiji`      |
| **Sub page** | The page users open from their subscription link | [umiji-subscription-page: DEPLOY.md](https://github.com/therewasluna/umiji-subscription-page/blob/main/DEPLOY.md) | `/opt/umiji-sub`  |
| **Nodes**    | The servers that run Xray for your users         | from the panel (step 8)                                                                                           | `/opt/umiji-node` |

The sub page can run on the panel's server or on its own. Everything runs in Docker from published images, so the
server needs only Docker. Every command in this guide runs on the server.

```
 GITHUB CONTAINER REGISTRY            PANEL SERVER, /opt/umiji
 ─────────────────────────            ───────────────────────────────────────────────────────
 ghcr.io/therewasluna/umiji-panel ─▶  docker-compose.yml, .env, caddy/Caddyfile, secrets/, backups/
           docker compose pull        Containers: umiji (panel), umiji-db (Postgres), umiji-redis (Valkey),
                                                  umiji-caddy (HTTPS), umiji-secrets (runs once at start)
                                      https://panel.example.com → umiji:3000
                                      https://sub.example.com   → umiji-subscription-page:3010 (if the sub page runs here)
```

---

## The quick way: the installer

On the server, as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh)
```

It installs Docker if it's missing and asks for your panel's domain. Every other question has a ready answer that
Enter accepts. It sets up the panel in `/opt/umiji` and the sub page in `/opt/umiji-sub`, the same way as the steps
below. Tick **Node** too and it runs a node in `/opt/umiji-node` and adds it to the panel's Nodes as **Panel server**. It also makes the owner account and the sub page's API token, so steps 6 and 7 are done too. It shows one line
per step, and when a step fails, what happened and how to fix it. The whole log is in `/var/log/umiji-install.log`.

And it adds the `umiji` command. Type `umiji` on the server any time (or run the line above again) for a menu:

| Menu item            | What it does                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Install / update** | The tick list again: add a part this server doesn't run yet, or update the ones you tick    |
| **Update all**       | The newest version of everything here, after a database backup                              |
| **Owner password**   | A new password for the owner account if you forgot it; it also turns password login back on |
| **Back up**          | The whole database and its secret in one file in `/opt/umiji/backups/` (see Backups)        |
| **Restore**          | Puts a backup back. It **deletes the current database**, after backing it up first          |
| **Uninstall**        | Removes the panel, the sub page or the node. The panel's data stays unless you say so       |

Updating needs GitHub and ghcr.io; the rest works without the internet. With `sub` or `node` at the end, the line
above installs only that part. The [setup guide](https://umiji.wiki/guide/) walks through it with screenshots.

The rest of this guide does the same install by hand and explains every setting.

## 1. What you need

- **A server** with root access, x86-64 (amd64) or 64-bit ARM (arm64). Ubuntu or Debian is easiest; any Linux that
  runs Docker works.
- **Two domains**: one for the panel (e.g. `panel.example.com`) and one for the sub page (e.g. `sub.example.com`).
  Point the panel's DNS **A record** at this server, and the sub page's at the server that will run it. Do this
  first: certificates need it. The [setup guide](https://umiji.wiki/guide/#dns) shows how, at your domain company or
  with Cloudflare.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version        # should print a version
```

## 3. Get the files and set your domains

```bash
mkdir -p /opt/umiji/caddy && cd /opt/umiji
base=https://raw.githubusercontent.com/therewasluna/umiji-backend/main/tools/deploy
curl -fsSL -o docker-compose.yml $base/docker-compose.yml
curl -fsSL -o caddy/Caddyfile    $base/caddy/Caddyfile
curl -fsSL -o .env               $base/env.example
chmod 600 .env
```

Then open the settings file:

```bash
nano .env
```

In `.env`, fill in the two domains. The other lines can stay as they are:

| Setting            | Value                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PANEL_DOMAIN`     | `panel.example.com`                                                                                                                      |
| `SUB_DOMAIN`       | `sub.example.com`. It goes into every subscription link.                                                                                 |
| `SUB_PAGE_HERE`    | `yes` if the sub page will run on this server too, so this server's Caddy serves its domain. `no` if it runs on another server (step 7). |
| `SUB_PAGE_IP`      | Only with `SUB_PAGE_HERE=no`: the sub page server's IP. The panel then trusts the visitor IPs it passes on, and nobody else's.           |
| `COMPOSE_PROFILES` | `caddy` for built-in HTTPS. Empty (`COMPOSE_PROFILES=`) to use your own nginx (step 5b).                                                 |

Optional panel settings go in the same file. Copy the lines you need from
[`.env.sample`](https://github.com/therewasluna/umiji-backend/blob/main/.env.sample), for example:

| Setting                                                                        | When                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_PROXY`                                                           | Telegram is blocked on this server, e.g. `socks5://172.17.0.1:1080`. The broker bots use it too. Inside Docker, `127.0.0.1` is the container itself, so use the host's Docker IP (`172.17.0.1`) or a proxy container's name. |
| `IS_TELEGRAM_NOTIFICATIONS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFY_*` | You want the panel's own Telegram notifications.                                                                                                                                                                             |
| `SUB_PUBLIC_DOMAIN`                                                            | The sub page uses `CUSTOM_SUB_PREFIX`: set it to the domain plus the prefix, e.g. `sub.example.com/sub`. Otherwise it's `SUB_DOMAIN`.                                                                                        |
| `BROKER_BOT_WEBHOOK_DOMAIN`                                                    | Leave unset. Broker bots long-poll by default. See `docs/BROKERS.md` for webhook mode.                                                                                                                                       |

## 4. Start it

```bash
cd /opt/umiji
docker compose up -d
docker compose ps
```

The first start pulls the images, a few hundred MB. It also makes the panel's secrets in `/opt/umiji/secrets/`: the
`APP_SECRET` (it also encrypts the brokers' bot tokens), the database password and the metrics password. Later starts
keep them. The panel applies its database migrations and is ready after about 30 seconds. With `caddy`, Caddy now
gets the certificates; watch it with `docker compose logs -f umiji-caddy`.

`umiji-secrets` shows as `Exited (0)`: it only runs at the start. The panel listens on `127.0.0.1` only, so without
Caddy it isn't open to the internet until you set up nginx in step 5b.

## 5. HTTPS: built-in Caddy or your own nginx

The panel only answers requests that come through a reverse proxy over HTTPS: it needs `X-Forwarded-For` and
`X-Forwarded-Proto: https`, and closes the connection without them. Pick one of two ways:

|                  | Built-in Caddy (5a, the default)          | Your own nginx (5b)                                |
| ---------------- | ----------------------------------------- | -------------------------------------------------- |
| Setup            | Nothing: it reads the domains from `.env` | Install nginx and certbot, write the config        |
| Certificates     | Caddy gets and renews them itself         | certbot gets and renews them                       |
| Ports 80 and 443 | Caddy takes them, so nothing else can     | nginx has them and can serve other sites as well   |
| Good for         | A server that runs only Umiji             | A server with other sites, or your own nginx rules |

Both make sure the visitor can't choose the IP the panel sees, which the login limit and the IP records rely on.

### 5a. Built-in Caddy

It's on when `.env` has `COMPOSE_PROFILES=caddy`. Ports 80 and 443 must be open and free: stop nginx or Apache if
they're installed. Certificates are kept in the `umiji-caddy-data` volume and renewed long before they expire. The
first one arrives within a minute; the log says `certificate obtained successfully` for each domain.

You only edit `caddy/Caddyfile` for a CDN. After an edit, run `docker compose restart umiji-caddy`.

**Behind a CDN** (e.g. Cloudflare's orange cloud), set Cloudflare's SSL mode to **Full (strict)** and turn off
**Always Use HTTPS**: Caddy gets and renews its certificates over plain http on port 80, and redirects visitors to
https itself. Then tell Caddy the CDN's IP ranges, so it takes the visitor's IP from the CDN instead of seeing only
the CDN's. In `caddy/Caddyfile`, remove the `#` from the six lines at the top and list the ranges, space-separated,
from https://www.cloudflare.com/ips/ (or your CDN's list):

```
{
	servers {
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 ... 2400:cb00::/32 ...
		trusted_proxies_strict
	}
}
```

### 5b. Your own nginx

In `.env`, make the line `COMPOSE_PROFILES=` and run `docker compose up -d`.

#### Install nginx and certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
ufw status                     # if it says "active", open the web ports:
ufw allow 'Nginx Full'
```

Don't open ports 3000, 3001 or 3010. The containers listen on `127.0.0.1` so that only nginx can reach them.

#### Write the config

```bash
nano /etc/nginx/sites-available/umiji
```

Paste this, with your domain. If the sub page runs on this server too, add its block from the
[sub page guide](https://github.com/therewasluna/umiji-subscription-page/blob/main/DEPLOY.md#your-own-nginx) to the
same file.

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
```

What each part is for:

- `Upgrade` and `Connection`: the panel's SSH terminal runs over a WebSocket.
- `X-Umiji-Real-IP`: the visitor's IP for the login limit, failed-login alerts and IP records. nginx always sets
  it, so a visitor can't send their own.
- `X-Forwarded-For` and `X-Forwarded-Proto`: the panel refuses requests without them.
- `client_max_body_size 20m`: room for broadcast photos.
- `access_log off` on `/api/backend-tools`: those links carry a token, which shouldn't sit in a log file.

#### Turn it on and get certificates

```bash
ln -s /etc/nginx/sites-available/umiji /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default       # nginx's welcome page, not needed
nginx -t && systemctl reload nginx
certbot --nginx -d panel.example.com         # add -d sub.example.com if the sub page runs here
```

Certbot asks for an email and to accept the terms once. It then adds HTTPS and the http→https redirect to this
file. Before certbot runs, the panel won't load: over plain http the proto header is `http`, and the panel refuses
that.

Certificates last 90 days. Certbot's timer renews them on its own; check that renewal works:

```bash
certbot renew --dry-run
```

#### Check it

```bash
# on your computer
curl -sI https://panel.example.com | head -1          # HTTP/2 200 (or HTTP/1.1 200)
curl -sI http://panel.example.com | grep -i location  # https://panel.example.com/
```

#### Behind a CDN

If the domain goes through Cloudflare's proxy (orange cloud) or another CDN, set Cloudflare's SSL mode to
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

If your nginx runs in a container, join it to the `umiji-network` network and use `http://umiji:3000` instead of
`http://127.0.0.1:3000`.

## 6. First login

Open `https://panel.example.com` and create your account. The first account you register owns the panel.

## 7. Install the sub page

The sub page has its own install: follow
[its guide](https://github.com/therewasluna/umiji-subscription-page/blob/main/DEPLOY.md). It needs an API token from
the panel: **Umiji Settings → API Tokens → Create**.

- **On this server:** keep `SUB_PAGE_HERE=yes` in `/opt/umiji/.env`. The panel's Caddy serves the sub page's domain.
- **On another server:** in `/opt/umiji/.env`, set `SUB_PAGE_HERE=no` and `SUB_PAGE_IP=` that server's IP, then run
  `docker compose up -d`. With nginx, use the commented line in the `map` instead.

## 8. Add nodes

A node on the panel's own server is easiest with the installer (see The quick way): it adds that node to the panel
by itself. Add every other node in the panel: **Nodes → Create node**. **Automatic install** logs in to the node server over SSH, sets
up Docker and the node, and adds it to the panel. **Manual setup** shows the node's secret key and a
`docker-compose.yml`. On the node server, the installer can use the key:
`bash <(curl -fsSL https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh) node`. Or run the compose file
yourself; the [node's README](https://github.com/therewasluna/umiji-node#install) has the steps. Nodes run
`ghcr.io/therewasluna/umiji-node`, on x86-64 or ARM.

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

### Update to a new version

```bash
cd /opt/umiji
# Back up the database first: the panel applies migrations when it starts.
mkdir -p backups
docker compose exec -T umiji-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backups/$(date -u +%Y%m%d-%H%M%S).sql.gz
docker compose pull
docker compose up -d
docker image prune -f         # removes the old images
```

Only containers whose image changed are restarted. `umiji` → **Update all** does the same. To stay on a specific
build instead of the newest one, put one of its tags (see Reference) in place of `latest` in `docker-compose.yml`.

The single-owner migration requires at most one existing `ADMIN` row. If a previous registration race created
multiple owners, resolve those accounts before upgrading or the migration will stop.

### Change a setting

Edit `.env` and run `docker compose up -d`. It only restarts what changed.

```bash
cd /opt/umiji
nano .env
docker compose up -d
```

`caddy/Caddyfile` is the exception: after editing it, run `docker compose restart umiji-caddy`.

### Move the sub page to another server

1. Point the sub page's domain at the new server and install the sub page there
   ([its guide](https://github.com/therewasluna/umiji-subscription-page/blob/main/DEPLOY.md)). You can reuse the API
   token from `/opt/umiji-sub/.env` on this server.
2. Here, in `/opt/umiji/.env`, set `SUB_PAGE_HERE=no` and `SUB_PAGE_IP=` the new server's IP, then run
   `docker compose up -d`.
3. Stop the old one: `cd /opt/umiji-sub && docker compose down`.

Moving it back works the same way in reverse.

### Backups

Type `umiji` and pick **Back up**. It saves one file, `/opt/umiji/backups/umiji-<date>.tar`, which holds:

- `database.sql.gz`, the whole database (`pg_dump`);
- `app_secret`, the `APP_SECRET` that the owner's password and the brokers' bot tokens are keyed to. Without it,
  brokers have to reconnect their bots and the owner needs a new password;
- `sub_token`, the sub page's API token, when the sub page runs on this server.

Keep it private: it unlocks everything. Copy it off the server, from your computer:

```bash
scp root@203.0.113.10:/opt/umiji/backups/umiji-20261116-141537.tar .
```

**Update all** makes one before every update too. Nothing deletes old ones, so clear them out now and then.

To take one by hand, dump the database and keep a copy of `secrets/` with it:

```bash
cd /opt/umiji
mkdir -p backups
docker compose exec -T umiji-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backups/manual.sql.gz
```

### Restore a backup

Restoring **deletes the panel's whole database**: users, nodes, brokers, settings and the owner account. The backup's
take their place, and its owner account signs in.

Copy the backup into `/opt/umiji/backups/`, type `umiji` and pick **Restore**. It lists the backups there and asks for
one. It makes a backup of the database as it is now, so you can go back, and asks before it deletes anything. If
the restore fails partway, nothing changes. It also takes `.sql.gz` dumps made by hand. Those don't hold
`APP_SECRET`, so from another server, also copy that server's `secrets/app_secret` into `/opt/umiji/secrets/` and run
`docker compose restart umiji`.

**On a new server:** install the panel with the installer, copy the backup into `/opt/umiji/backups/`, then pick
**Restore**. A backup from a newer panel needs this one updated first.

By hand, in one transaction, so a failed restore changes nothing:

```bash
cd /opt/umiji
ls backups/                                         # pick one, then use its name below
docker compose stop umiji
# for a .sql.gz, put gunzip -c backups/manual.sql.gz in place of the tar ... | gunzip -c part
{ echo 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'; tar -xOf backups/umiji-20261116-141537.tar database.sql.gz | gunzip -c; } | docker compose exec -T umiji-db sh -c 'psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" "$POSTGRES_DB"' > /dev/null
docker compose restart umiji-redis                  # empties the cache of the old settings
docker compose start umiji
```

If you're going back because a new version broke something, also go back to the older image: put its tag in place of
`latest` in `docker-compose.yml` and run `docker compose up -d`.

### Forgot the owner's password

Type `umiji` and pick **Owner password**. It shows the owner's username, asks for a new password (or makes one) and
turns password login back on, in case it was switched off and the other sign-in methods are lost.

### Uninstall

Type `umiji` and pick **Uninstall**. It removes the containers, their images and the folder. For the panel it asks
whether to delete the database, secrets and settings too. If you keep them, installing the panel again brings
everything back. The backups always stay. When nothing is left, it removes the `umiji` command too; Docker stays.

By hand: `cd /opt/umiji && docker compose down` stops and removes the panel. Adding `--volumes` deletes the
database.

### Useful commands

```bash
cd /opt/umiji
docker compose ps                               # what's running and healthy
docker compose logs -f umiji                    # panel logs (Ctrl+C to stop)
docker compose logs -f umiji-caddy              # certificates and HTTPS
docker compose restart umiji                    # restart the panel
docker compose down                             # stop everything (data stays)
docker compose up -d                            # start everything again
umiji                                           # menu: update, back up, restore, owner password, uninstall
cat secrets/metrics_pass                        # password for http://127.0.0.1:3001/metrics (user admin)
```

---

## Troubleshooting

| Problem                                                                              | Fix                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The installer stopped with an error                                                  | It shows what happened and how to fix it; the whole log is in `/var/log/umiji-install.log`. Fix it and type `umiji` (or run the installer again): it keeps what it has done.                                                                                                                                     |
| `docker compose` says `required variable PANEL_DOMAIN is missing a value`            | Fill in `PANEL_DOMAIN` and `SUB_DOMAIN` in `.env` (step 3).                                                                                                                                                                                                                                                      |
| The panel page doesn't load, and its log says `Reverse proxy and HTTPS are required` | Open it through Caddy or nginx over **https**. With nginx, check that the block sets `X-Forwarded-For` and `X-Forwarded-Proto`, and that certbot ran.                                                                                                                                                            |
| `umiji-caddy` won't start: `address already in use`                                  | Something else has port 80 or 443, usually nginx or Apache. Stop it (`systemctl disable --now nginx`), or make `.env` say `COMPOSE_PROFILES=` and use nginx (step 5b).                                                                                                                                           |
| `umiji-caddy` won't start: `File to import not found: sub-page-…`                    | `SUB_PAGE_HERE` in `.env` must be `yes` or `no`.                                                                                                                                                                                                                                                                 |
| Caddy's log says it couldn't get a certificate                                       | The domain's DNS must point at this server, and ports 80 and 443 must be open to the internet. With `SUB_PAGE_HERE=yes`, that goes for the sub page's domain too. Behind Cloudflare, turn off **Always Use HTTPS**. Caddy retries on its own; check with `docker compose logs -f umiji-caddy`.                   |
| The sub page's domain shows `502`                                                    | The sub page isn't running on this server yet, or it runs elsewhere and `SUB_PAGE_HERE` should be `no`.                                                                                                                                                                                                          |
| Every login, alert or IP record shows the same IP                                    | A CDN is in front and the proxy doesn't know it: the CDN lines in `caddy/Caddyfile` (step 5a) or the `set_real_ip_from` lines (step 5b).                                                                                                                                                                         |
| nginx shows `502 Bad Gateway`                                                        | The container isn't running yet or crashed. Check `docker compose ps` and `docker compose logs umiji`. The panel takes about 30 s to start.                                                                                                                                                                      |
| The panel can't log in to its database                                               | `secrets/db_password` was deleted or changed after the database was made. Put the old one back (from your backup) and run `docker compose up -d`.                                                                                                                                                                |
| Subscription links point to the wrong domain                                         | `SUB_DOMAIN` (or `SUB_PUBLIC_DOMAIN`) in `.env`. Then run `docker compose up -d`.                                                                                                                                                                                                                                |
| Uploading a broadcast photo fails with `413`                                         | `client_max_body_size 20m;` is missing from the panel's nginx block.                                                                                                                                                                                                                                             |
| `docker compose pull` hangs or fails                                                 | The server can't reach `ghcr.io` or Docker Hub. On a machine that can: `docker pull` each image (see Reference, plus `postgres:18.4`, `valkey/valkey:9-alpine` and `caddy:2.10.2`), then `docker save <images> \| gzip \| ssh root@SERVER 'gunzip \| docker load'` and run `docker compose up -d` on the server. |
| Broker bots don't respond                                                            | Telegram may be blocked on the server. Add `TELEGRAM_BOT_PROXY` to `.env` (step 3) and run `docker compose up -d`.                                                                                                                                                                                               |

## Reference

- **Images**, for x86-64 and ARM, built by GitHub Actions in each repo:
  - `ghcr.io/therewasluna/umiji-panel`: this backend plus the [frontend](https://github.com/therewasluna/umiji-frontend)
  - `ghcr.io/therewasluna/umiji-subscription-page` (the sub page's install)
  - `ghcr.io/therewasluna/umiji-node` (on the node servers)
- **Tags**: `latest` is the newest build of `main`; `sha-<commit>` is one build; `v<version>` is a release.
- **Secrets**: `secrets/app_secret`, `secrets/db_password` and `secrets/metrics_pass`, made once by `umiji-secrets`
  (`docker-secrets.sh` in the image). A value set in `.env` (`APP_SECRET`, `DATABASE_URL`, `METRICS_PASS`) wins.
- `caddy` in `COMPOSE_PROFILES` runs `caddy:2.10.2` as `umiji-caddy`, with `caddy/` mounted read-only. Its certificates
  live in the `umiji-caddy-data` volume. Keep it: Let's Encrypt limits how often a domain can get a new certificate.
- To build the panel image yourself (needs Docker, Node 24+ and the frontend repo next to this one):
  `tools/build-image.sh`. The sub page repo has its own `tools/build-image.sh`.
