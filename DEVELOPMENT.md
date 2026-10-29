1. Launch the database and redis containers:

```bash
docker compose -f docker-compose-db-local.yml up -d
```

2. Install dependencies:

```bash
npm install
```

3. Migrate the database:

```bash
npm run migrate:deploy
```

4. Generate types:

```bash
npm run migrate:generate
```

5. Seed the database:

```bash
npm run migrate:seed:dev
```

6. Running dev mode (if you run multiple instances, make sure to wait before starting the next instance):

- API:

```bash
npm run dev:api
```

- Worker:

```bash
npm run dev:worker
```

- Scheduler:

```bash
npm run dev:scheduler
```

## Test it locally (brokers and the store bot)

```bash
docker compose -f tools/dev/docker-compose.yml up -d      # postgres :6767, valkey :6380
cp .env.sample .env   # then set APP_PORT=3003, DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:6767/postgres,
                      # REDIS_HOST=127.0.0.1, REDIS_PORT=6380 (remove REDIS_SOCKET), APP_SECRET, PANEL_DOMAIN, SUB_PUBLIC_DOMAIN
npm ci && npx prisma migrate deploy && npm run migrate:seed:dev
./tools/dev/run-backend.sh
./tools/dev/e2e-brokers.sh        # 143 API checks: ownership, bulk actions, squads, branding, limits, expiry, denied endpoints
./tools/dev/e2e-node-quota.sh     # real traffic through an umiji-node + xray client, quota cut-off and recovery
./tools/dev/e2e-broker-bot.sh     # broker bot against a mock Telegram API; needs TELEGRAM_BOT_API_ROOT=http://127.0.0.1:8081
./tools/dev/e2e-broker-bot-webhook.sh  # webhook mode; the API also needs BROKER_BOT_WEBHOOK_DOMAIN=hook.e2e.test
./tools/dev/seed-demo.sh          # demo brokers, users, servers and squads for clicking around
```

Frontend: in the frontend checkout, `cp .env.sample .env`, `npm ci`, `../umiji-backend/tools/dev/link-contract.sh`,
then `npm run start:dev` and open http://127.0.0.1:3333.

## Shared packages

The repos share a few npm packages (`@umiji/backend-contract`, `@umiji/node-contract`, `@umiji/hashed-set`,
`@umiji/node-plugins`, `@umiji/subscription-page-types`). They aren't published to npm: each repo that needs one
keeps its tarball in `vendor/` and depends on it with a `file:vendor/...` path.

After changing `libs/contract`, rebuild it and copy it to the frontend:

```bash
cd libs/contract
rm -rf build && npx tsc -p tsconfig.backend.json && npx tsc -p tsconfig.frontend.json
npm pack --pack-destination ../../../umiji-frontend/vendor/
# in umiji-frontend: npm install ./vendor/umiji-backend-contract-<version>.tgz
# (a plain `npm install` keeps the old copy when the file name hasn't changed)
```
