// Isolated regression checks for security paths that do not need a running panel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = new URL('../../..', `file://${__dirname}/`).pathname;
const req = createRequire(`${root}/backend/package.json`);
const ts = req('typescript');
const noop = () => {};
const decorator = () => () => {};
const classes = new Proxy(
    {},
    {
        get: () =>
            class {
                constructor(...args) {
                    this.args = args;
                    if (args.length === 1 && args[0] && typeof args[0] === 'object')
                        Object.assign(this, args[0]);
                }
            },
    },
);
const ERRORS = new Proxy(
    {},
    { get: (_, key) => ({ code: String(key), message: String(key), httpCode: 403 }) },
);
const constants = {
    ERRORS,
    ROLE: { ADMIN: 'ADMIN', BROKER: 'BROKER', API: 'API' },
    USERS_STATUS: {
        ACTIVE: 'ACTIVE',
        DISABLED: 'DISABLED',
        LIMITED: 'LIMITED',
        EXPIRED: 'EXPIRED',
    },
    EVENTS: {
        USER: { MODIFIED: 'modified' },
        SERVICE: { LOGIN_ATTEMPT_FAILED: 'failed' },
        USER_HWID_DEVICES: { ADDED: 'added' },
    },
    OAUTH2_PROVIDERS: {
        GENERIC: 'generic',
        POCKETID: 'pocketid',
        KEYCLOAK: 'keycloak',
        TELEGRAM: 'telegram',
    },
    CACHE_KEYS: new Proxy(
        {},
        {
            get:
                (_, key) =>
                (...args) =>
                    `${String(key)}:${args.join(':')}`,
        },
    ),
    UMIJI_CLIENT_TYPE_HEADER: 'x-client',
    UMIJI_CLIENT_TYPE_BROWSER: 'browser',
};
const common = {
    ...constants,
    Injectable: decorator,
    Transactional: decorator,
    CommandHandler: decorator,
    EventsHandler: decorator,
    Logger: class {
        log() {}
        warn() {}
        error() {}
        debug() {}
    },
    ok: (response) => ({ isOk: true, response }),
    fail: (error) => ({ isOk: false, ...error }),
    wrapBigInt: (value) => (value === undefined ? undefined : BigInt(value)),
    wrapBigIntNullable: (value) => (value == null ? value : BigInt(value)),
};

function load(relative, overrides = {}, additions = {}) {
    const filename = `${root}/${relative}`;
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            experimentalDecorators: true,
            emitDecoratorMetadata: false,
            esModuleInterop: true,
        },
    }).outputText;
    const module = { exports: {} };
    const fallback = new Proxy(common, {
        get: (target, key) => (key in target ? target[key] : classes[key]),
    });
    const importModule = (name) => {
        if (name in overrides) return overrides[name];
        if (
            name.startsWith('node:') ||
            [
                'arctic',
                'dayjs',
                'jsonwebtoken',
                'kysely',
                'kysely/helpers/postgres',
                'ufo',
                'zod',
            ].includes(name)
        )
            return req(name);
        return fallback;
    };
    vm.runInNewContext(
        output,
        {
            module,
            exports: module.exports,
            require: importModule,
            Buffer,
            URL,
            console,
            setTimeout,
            clearTimeout,
            AbortController,
            process,
            ...additions,
        },
        { filename },
    );
    return module.exports;
}

test('login attempts stop before password work and notifications omit the password', async () => {
    const { AuthService } = load('backend/src/modules/auth/auth.service.ts');
    const auth = Object.create(AuthService.prototype);
    const counters = new Map();
    const events = [];
    let hashes = 0;
    let passwordIsRight = false;
    Object.assign(auth, {
        rawCacheService: {
            incrementWithTtl: async (key) => {
                const n = (counters.get(key) ?? 0) + 1;
                counters.set(key, n);
                return n;
            },
            delMany: async (keys) => keys.forEach((key) => counters.delete(key)),
        },
        getStatus: async () =>
            common.ok({ isLoginAllowed: true, authentication: { password: { enabled: true } } }),
        getAdminByUsername: async () =>
            common.ok({ role: 'ADMIN', passwordHash: 'hash', uuid: 'owner-id' }),
        verifyPassword: async () => {
            hashes++;
            return passwordIsRight;
        },
        jwtService: { sign: () => 'jwt' },
        emitLoginSuccess: async () => {},
        eventEmitter: { emit: (_, event) => events.push(event) },
        logger: new common.Logger(),
    });
    const login = () =>
        auth.login({ username: 'owner', password: 'synthetic-secret' }, '127.0.0.1', 'agent');

    // The right password keeps working: successes don't count toward the limit.
    passwordIsRight = true;
    for (let i = 0; i < 15; i++) assert.equal((await login()).isOk, true);

    passwordIsRight = false;
    for (let i = 0; i < 10; i++) assert.equal((await login()).isOk, false);
    const throttled = await login();
    assert.equal(throttled.code, 'TOO_MANY_LOGIN_ATTEMPTS');
    assert.equal(hashes, 25);
    assert.equal(events.length, 10);
    for (const event of events) assert.equal('password' in event.args[1].loginAttempt, false);

    // Wrong tries from one IP don't lock the account for the owner on another IP.
    passwordIsRight = true;
    const fromElsewhere = await auth.login(
        { username: 'Owner', password: 'synthetic-secret' },
        '192.0.2.7',
        'agent',
    );
    assert.equal(fromElsewhere.isOk, true);
    assert.equal((await login()).code, 'TOO_MANY_LOGIN_ATTEMPTS');
    assert.equal(hashes, 26);
});

test('a bot update is dropped after its last attempt or a permanent error', async () => {
    const { BrokerBotRepository } = load('backend/src/modules/broker-bot/broker-bot.repository.ts');
    const repo = Object.create(BrokerBotRepository.prototype);
    const writes = [];
    repo.prisma = {
        tx: { brokerBotUpdates: { update: async ({ data }) => writes.push(data.status) } },
    };
    await repo.failUpdate('broker', 1n, 0, true);
    await repo.failUpdate('broker', 1n, 3, true);
    await repo.failUpdate('broker', 1n, 4, true);
    await repo.failUpdate('broker', 1n, 0, false);
    assert.deepEqual(writes, ['pending', 'pending', 'failed', 'failed']);
});

test('unverified OIDC email is denied and numeric Telegram ID is accepted', async () => {
    const { AuthService } = load('backend/src/modules/auth/auth.service.ts');
    const auth = Object.create(AuthService.prototype);
    const jwt = (claims) =>
        `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    const email = 'owner@example.invalid';
    auth.rawCacheService = { getDel: async () => ({ provider: 'generic', codeVerifier: null }) };
    auth.queryBus = {
        execute: async () => ({ oauth2Settings: { generic: { enabled: true, withPkce: false } } }),
    };
    auth.exchangeCodeForEmail = async () =>
        auth.extractEmailFromIdToken(jwt({ email, email_verified: false }));
    auth.getAllowedEmails = () => [email];
    auth.emitFailedLoginAttempt = async () => {};
    const callback = await auth.processOAuth2Callback(
        'generic',
        'code',
        'state',
        '127.0.0.1',
        'agent',
    );
    assert.equal(callback.isAllowed, false);

    auth.getTelegramOAuth2Client = () => ({
        validateAuthorizationCode: async () => ({ idToken: () => jwt({ id: 987654321 }) }),
    });
    const telegram = await auth.fetchTelegramId('code', 'verifier', {
        oauth2Settings: { telegram: { allowedIds: ['987654321'] } },
    });
    assert.equal(telegram.email, '987654321');
});

test('broker password reset revokes old JWTs and deleted API tokens stay denied', async () => {
    const { JwtDefaultGuard } = load('backend/src/common/guards/jwt-guards/def-jwt-guard.ts', {
        '@nestjs/passport': { AuthGuard: () => class {} },
    });
    const guard = Object.create(JwtDefaultGuard.prototype);
    guard.getAdminByUsername = async () => common.ok({ uuid: 'broker-id' });
    guard.queryBus = {
        execute: async () => common.ok({ sessionVersion: 2, isDisabled: false, isExpired: false }),
    };
    const context = {
        switchToHttp: () => ({
            getRequest: () => ({ headers: { 'x-client': 'browser' }, method: 'GET' }),
        }),
    };
    assert.equal(
        await guard.verifyBroker(context, {
            uuid: 'broker-id',
            username: 'broker',
            sessionVersion: 1,
        }),
        false,
    );
    assert.equal(
        await guard.verifyBroker(context, {
            uuid: 'broker-id',
            username: 'broker',
            sessionVersion: 2,
        }),
        true,
    );
    let exists = true;
    guard.getTokenByUuid = async () =>
        exists ? common.ok({ scopes: ['users:read'] }) : common.fail(ERRORS.NOT_FOUND);
    assert.equal(await guard.verifyApiToken({}, 'api-id'), true);
    exists = false;
    assert.equal(await guard.verifyApiToken({}, 'api-id'), false);
});

test('explicit disable wins over quota changes and squad edits', async () => {
    const { UsersService } = load('backend/src/modules/users/users.service.ts');
    const users = Object.create(UsersService.prototype);
    const published = [];
    let user = {
        id: 1n,
        status: 'ACTIVE',
        vlessUuid: 'synthetic',
        trafficLimitBytes: 100n,
        activeInternalSquads: [{ uuid: 'old-squad' }],
    };
    Object.assign(users, {
        logger: new common.Logger(),
        eventBus: { publish: (event) => published.push(event) },
        eventEmitter: { emit: noop },
        userRepository: {
            findUniqueByCriteria: async () => user,
            update: async (patch) => ({ ...user, ...patch }),
        },
    });
    const disabled = await users.updateUser({
        id: 1,
        status: 'DISABLED',
        activeInternalSquads: ['new-squad'],
    });
    assert.equal(disabled.response.status, 'DISABLED');
    assert.equal(published.length, 1);
    user = { ...user, status: 'LIMITED' };
    published.length = 0;
    const limited = await users.updateUser({ id: 1, status: 'DISABLED', trafficLimitBytes: 200 });
    assert.equal(limited.response.status, 'DISABLED');
    assert.equal(published.length, 1);
});

test('bulk squad replacement validates first and uses one Prisma transaction host', async () => {
    const { UsersRepository } = load('backend/src/modules/users/repositories/users.repository.ts');
    const repo = Object.create(UsersRepository.prototype);
    const calls = [];
    let count = 0;
    repo.prisma = {
        tx: {
            internalSquads: { count: async () => count },
            internalSquadMembers: {
                deleteMany: async () => calls.push('delete'),
                createMany: async () => calls.push('insert'),
            },
        },
    };
    repo.qb = {
        get kysely() {
            throw new Error('separate connection used');
        },
    };
    await assert.rejects(
        repo.replaceUsersInternalSquads([1n], ['missing']),
        /Unknown internal squad/,
    );
    assert.deepEqual(calls, []);
    count = 1;
    await repo.replaceUsersInternalSquads([1n], ['squad']);
    assert.deepEqual(calls, ['delete', 'insert']);
    calls.length = 0;
    await repo.replaceUsersInternalSquads([1n], []);
    assert.deepEqual(calls, ['delete']);
});

test('empty squad list removes existing users from connected nodes', async () => {
    const { AddUsersToNodeHandler } = load(
        'backend/src/modules/nodes/events/add-users-to-node/add-users-to-node.handler.ts',
    );
    const handler = Object.create(AddUsersToNodeHandler.prototype);
    const removals = [];
    handler.nodesRepository = {
        findConnectedNodes: async () => [
            {
                address: '127.0.0.1',
                port: 443,
                proxyUrl: null,
                activeConfigProfileUuid: 'profile',
                activeInbounds: [{ tag: 'inbound' }],
            },
        ],
    };
    handler.queryBus = {
        execute: async () =>
            common.ok([
                {
                    id: 1n,
                    vlessUuid: 'old-credential',
                    inbounds: [],
                },
            ]),
    };
    handler.nodesQueuesService = {
        addUsersToNode: async () => {
            throw new Error('unexpected add');
        },
        removeUsersFromNode: async (request) => removals.push(request.data.users),
    };
    await handler.handle({ ids: [1n] });
    assert.equal(removals.length, 1);
    assert.equal(removals[0][0].hashUuid, 'old-credential');
});

class FakeTelegramError extends Error {
    constructor(code) {
        super(`telegram ${code}`);
        this.code = code;
    }
}

// In-memory stand-in for the broker_bot_updates queue, with the repository's selection rule.
function updateQueuePoller(handleUpdate) {
    const { BrokerBotPoller } = load('backend/src/modules/broker-bot/broker-bot.poller.ts', {
        './bot/telegram.client': { TelegramError: FakeTelegramError },
    });
    const poller = Object.create(BrokerBotPoller.prototype);
    const rows = new Map();
    const calls = [];
    poller.processingBots = new Set();
    poller.logger = new common.Logger();
    poller.repository = {
        getBot: async () => ({ botToken: 'encrypted' }),
        enqueueUpdate: async (_, id, payload) => {
            calls.push(`enqueue ${id}`);
            rows.set(id, { updateId: BigInt(id), payload, attempts: 0, status: 'pending', at: 0 });
            return true;
        },
        setUpdateOffset: async () => calls.push('offset'),
        getNextPendingUpdate: async () =>
            [...rows.values()]
                .filter((r) => r.status === 'pending' && r.at <= Date.now())
                .sort((a, b) => Number(a.updateId - b.updateId))[0] ?? null,
        claimUpdate: async (_, id) => {
            const row = rows.get(Number(id));
            if (row.status !== 'pending') return false;
            row.status = 'processing';
            return true;
        },
        completeUpdate: async (_, id) => {
            calls.push(`complete ${id}`);
            rows.get(Number(id)).status = 'processed';
        },
        failUpdate: async (_, id, attempts, retry) => {
            calls.push(`${retry ? 'retry' : 'drop'} ${id}`);
            const row = rows.get(Number(id));
            row.attempts = attempts + 1;
            row.status = retry ? 'pending' : 'failed';
            row.at = Date.now() + 60_000;
        },
    };
    poller.handler = {
        decrypt: () => 'token',
        webhookSecret: () => 'secret',
        client: () => ({}),
        context: async () => ({}),
        handleUpdate: async (_, update) => {
            await handleUpdate(update);
            calls.push(`handle ${update.update_id}`);
        },
    };
    return { poller, calls };
}

test('webhook stores the update, acknowledges it and handles it right away', async () => {
    const { poller, calls } = updateQueuePoller(async () => {});
    assert.equal(await poller.handleWebhook('broker', 'secret', { update_id: 5 }), true);
    assert.deepEqual(calls.slice(0, 2), ['enqueue 5', 'offset']);
    assert.deepEqual(calls.slice(2), ['handle 5', 'complete 5']);
});

test('a failing update backs off without blocking newer ones; Telegram 4xx is not retried', async () => {
    const { poller, calls } = updateQueuePoller(async (update) => {
        if (update.update_id === 1) throw new Error('database blip');
        if (update.update_id === 2) throw new FakeTelegramError(403);
    });
    for (const id of [1, 2, 3])
        await poller.repository.enqueueUpdate('broker', id, { update_id: id });
    await poller.processPendingUpdates('broker', {}, new AbortController().signal);
    assert.deepEqual(calls.slice(3), ['retry 1', 'drop 2', 'handle 3', 'complete 3']);
});

test('failed top-up notification keeps the receipt retryable without a duplicate order', async () => {
    const { BrokerBotHandler } = load('backend/src/modules/broker-bot/bot/broker-bot.handler.ts');
    const handler = Object.create(BrokerBotHandler.prototype);
    let created = 0;
    let reset = 0;
    let sends = 0;
    const order = { id: 7, reviewMessageId: null };
    handler.repository = {
        createTopupOrder: async () => {
            created++;
            return order;
        },
        setOrderReceipt: async () => {},
        setCustomerState: async () => {
            reset++;
        },
    };
    const ctx = {
        broker: { uuid: 'broker' },
        updateId: 42,
        bot: { groupId: null },
        t: (key) => key,
        tg: {
            sendMessage: async () => {
                if (++sends === 1) throw new Error('Telegram unavailable');
            },
        },
    };
    const customer = { id: 1, chatId: 'chat', stateAmount: 100 };
    const message = { text: 'receipt' };
    await assert.rejects(handler.submitReceipt(ctx, customer, message), /Telegram unavailable/);
    assert.equal(reset, 0);
    await handler.submitReceipt(ctx, customer, message);
    assert.equal(created, 2);
    assert.equal(reset, 1);
});

test('zero device limit reaches the locked creation path', async () => {
    const { HwidUserDevicesService } = load(
        'backend/src/modules/hwid-user-devices/hwid-user-devices.service.ts',
    );
    const hwid = Object.create(HwidUserDevicesService.prototype);
    let limit;
    const responses = [
        common.ok({ id: 1n, hwidDeviceLimit: 0 }),
        { hwidSettings: { enabled: true, fallbackDeviceLimit: 2 } },
    ];
    hwid.queryBus = { execute: async () => responses.shift() };
    hwid.commandBus = {
        execute: async (command) => {
            limit = command.args[1];
            return common.ok({ status: 'CREATED', hwidDevice: { hwid: 'device' } });
        },
    };
    hwid.hwidUserDevicesRepository = { findByCriteria: async () => [{ hwid: 'device' }] };
    hwid.eventEmitter = { emit: noop };
    hwid.logger = new common.Logger();
    const result = await hwid.createUserHwidDevice({ userId: 1, hwid: 'device' });
    assert.equal(result.isOk, true);
    assert.equal(limit, 0);
});

test('short APP_SECRET is rejected', () => {
    const { configSchema } = load('backend/src/common/config/app-config/config.schema.ts', {
        'nestjs-zod': { createZodDto: () => class {} },
    });
    const env = {
        DATABASE_URL: 'postgresql://synthetic',
        FRONT_END_DOMAIN: 'https://synthetic.invalid',
        METRICS_USER: 'test',
        METRICS_PASS: 'test',
        SUB_PUBLIC_DOMAIN: 'synthetic.invalid',
        REDIS_SOCKET: '/tmp/synthetic.sock',
    };
    assert.equal(configSchema.safeParse({ ...env, APP_SECRET: '' }).success, false);
    assert.equal(configSchema.safeParse({ ...env, APP_SECRET: 'a' }).success, false);
    assert.equal(configSchema.safeParse({ ...env, APP_SECRET: 'x'.repeat(32) }).success, true);
});

test('backend-tools token can be redeemed only once', async () => {
    const jwt = req('jsonwebtoken');
    const secret = 'SyntheticPassword1234567890';
    const ott = jwt.sign({ scope: 'ott', jti: 'one-time-id' }, secret, {
        issuer: 'Umiji',
        expiresIn: '30s',
    });
    const { toolsAuthMiddleware } = load(
        'backend/src/common/middlewares/tools-auth.middleware.ts',
        {
            '@libs/contracts/constants': {
                ...constants,
                BACKEND_TOOLS_AUTH_COOKIE_NAME: 'umiji-tools',
                BACKEND_TOOLS_JWT_ISSUER: 'Umiji',
                BACKEND_TOOLS_JWT_LIFETIME_HOURS: 2,
                BACKEND_TOOLS_JWT_SCOPES: { OTT: 'ott', ACCESS: 'access' },
            },
            '@libs/contracts/api': { ROOT: '/api', BACKEND_TOOLS_ROOT: '/backend-tools' },
            '@common/utils/startup-app': { isDevelopment: () => false },
        },
    );
    let unused = true;
    const middleware = toolsAuthMiddleware(secret, {
        getDelString: async () => {
            if (!unused) return null;
            unused = false;
            return '1';
        },
    });
    const request = {
        originalUrl: `/api/backend-tools/queues?ott=${ott}`,
        baseUrl: '/api/backend-tools',
        path: '/queues',
        headers: {},
    };
    const result = {
        cookies: 0,
        denied: 0,
        cookie() {
            this.cookies++;
        },
        redirect: noop,
        status(code) {
            assert.equal(code, 403);
            this.denied++;
            return this;
        },
        json: noop,
    };
    await middleware(request, result, noop);
    await middleware(request, result, noop);
    assert.equal(result.cookies, 1);
    assert.equal(result.denied, 1);
});

test('wallet purchase failure propagates past the transaction boundary', async () => {
    const { BrokerBotHandler } = load('backend/src/modules/broker-bot/bot/broker-bot.handler.ts');
    const handler = Object.create(BrokerBotHandler.prototype);
    const calls = [];
    handler.repository = {
        payForPlan: async () => {
            calls.push('debit');
            return 9;
        },
        completePlanOrder: async () => {
            calls.push('link');
            throw new Error('order update failed');
        },
    };
    handler.createSubscription = async () => {
        calls.push('create');
        return { id: 1n };
    };
    await assert.rejects(
        handler.completeWalletPurchase(
            {},
            { uuid: 'broker' },
            { id: 1 },
            { id: 1, price: 10, squadUuid: 'squad' },
            'checkout',
        ),
        /order update failed/,
    );
    assert.deepEqual(calls, ['debit', 'create', 'link']);
});

test('vault restore waits for one transaction and preserves old keys on failure', async () => {
    const stores = new Map([
        ['meta', [{ id: 'vault', version: 1 }]],
        ['keys', [{ nodeUuid: 'old-key' }]],
        ['hosts', []],
        ['profiles', []],
        ['snippets', []],
        ['device', []],
    ]);
    let transactions = 0;
    const db = {
        close: noop,
        transaction(names) {
            transactions++;
            assert.equal(names.length, 6);
            const pending = new Map([...stores].map(([name, rows]) => [name, [...rows]]));
            const tx = {
                error: null,
                objectStore(name) {
                    return {
                        clear: () => pending.set(name, []),
                        put: (value) => {
                            if (value.nodeUuid === 'bad-key') tx.error = new Error('quota failure');
                            pending.get(name).push(value);
                        },
                    };
                },
            };
            queueMicrotask(() => {
                if (tx.error) tx.onabort();
                else {
                    for (const [name, rows] of pending) stores.set(name, rows);
                    tx.oncomplete();
                }
            });
            return tx;
        },
    };
    const indexedDB = {
        open: () => {
            const request = {};
            queueMicrotask(() => {
                request.result = db;
                request.onsuccess();
            });
            return request;
        },
    };
    const { replaceVault } = load(
        'frontend/src/entities/ssh-vault/ssh-vault.db.ts',
        {},
        { indexedDB, queueMicrotask },
    );
    const meta = { version: 1, createdAt: 'synthetic', wrappedDataKey: {} };
    const records = { keys: [{ nodeUuid: 'bad-key' }], hosts: [], profiles: [], snippets: [] };
    await assert.rejects(replaceVault(meta, records), /quota failure/);
    assert.equal(stores.get('keys')[0].nodeUuid, 'old-key');
    records.keys = [{ nodeUuid: 'new-key' }];
    await replaceVault(meta, records);
    assert.equal(stores.get('keys')[0].nodeUuid, 'new-key');
    assert.equal(transactions, 2);
});

test('broker sub page configs refuse script, event handlers, styled overlays and script links', () => {
    const { findUnsafeBrokerContent: unsafe } = load(
        'backend/src/modules/subscription-page-configs/utils/find-unsafe-broker-content.util.ts',
    );
    const icon = (svg) => unsafe({ svgLibrary: { Happ: svg } });
    const title = (text) =>
        unsafe({ platforms: { ios: { apps: [{ blocks: [{ title: { en: text } }] }] } } });
    const link = (url) =>
        unsafe({ platforms: { ios: { apps: [{ blocks: [{ buttons: [{ link: url }] }] }] } } });

    for (const svg of [
        '<svg onload=alert(1)></svg>',
        '<svg/onload=alert(1)>',
        '<svg><script>alert(1)</script></svg>',
        '<svg><foreignObject><iframe src=x></iframe></foreignObject></svg>',
        '<svg><a href="javascript:alert(1)"><path d="M0"/></a></svg>',
        '<svg><!-- --><path d="M0"/></svg>',
        '<svg style="position:fixed;inset:0"><text x="9" y="9">Session expired</text></svg>',
        '<svg overflow="visible"><text x="-500" y="9">Sign in again</text></svg>',
    ])
        assert.equal(icon(svg), 'svgLibrary.Happ', svg);
    assert.equal(title('<img src=x onerror=alert(1)>'), 'platforms.ios.apps.0.blocks.0.title.en');
    assert.equal(title('<b onclick="x()">Hi</b>'), 'platforms.ios.apps.0.blocks.0.title.en');
    assert.notEqual(link('javascript:alert(1)'), null);
    assert.notEqual(link('java\tscript:alert(1)'), null);
    assert.notEqual(link('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(
        unsafe({ baseSettings: { metaTitle: '</title><script>x()</script>' } }),
        'baseSettings.metaTitle',
    );
    assert.equal(
        unsafe({ baseSettings: { metaDescription: 'a" onload="x' } }),
        'baseSettings.metaDescription',
    );

    // What brokers actually paste still saves: a Tabler icon, simple formatting and app links.
    const tabler =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-home"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 12l-2 0l9 -9l9 9l-2 0" /></svg>';
    assert.equal(icon(tabler), null);
    assert.equal(title('Open <b>Happ</b>, then tap <i>+</i>'), null);
    assert.equal(link('happ://add/https://sub.example.com/abc'), null);
    assert.equal(link('https://apps.apple.com/app/id1'), null);
});

test('brokers may only add the subscription headers apps read', async () => {
    const { ExternalSquadService } = load(
        'backend/src/modules/external-squads/external-squads.service.ts',
    );
    const service = Object.create(ExternalSquadService.prototype);
    service.logger = new common.Logger();
    service.externalSquadRepository = { getExternalSquadByUuid: async () => null };
    const uuid = '00000000-0000-4000-8000-000000000001';
    const broker = { externalSquadUuid: uuid };
    const update = (headers, who) =>
        service.updateExternalSquad({ uuid, responseHeadersAdd: headers }, who);

    for (const name of [
        'Set-Cookie',
        'clear-site-data',
        'Refresh',
        'access-control-allow-origin',
    ]) {
        const result = await update({ 'profile-title': 'x', [name]: 'v' }, broker);
        assert.equal(result.code, 'BROKER_ACTION_NOT_ALLOWED', name);
        assert.match(result.message, new RegExp(name));
    }
    // Allowed names, in any case, get past the check (to the lookup, which finds no squad here).
    assert.equal(
        (await update({ 'Profile-Title': 'x', announce: 'y' }, broker)).code,
        'EXTERNAL_SQUAD_NOT_FOUND',
    );
    // The owner is not limited.
    assert.equal(
        (await update({ 'set-cookie': 'a=b' }, undefined)).code,
        'EXTERNAL_SQUAD_NOT_FOUND',
    );
});

test('staff can reject only pending top-ups, never a paid plan order', async () => {
    const { BrokerBotRepository } = load('backend/src/modules/broker-bot/broker-bot.repository.ts');
    const repo = Object.create(BrokerBotRepository.prototype);
    let where;
    repo.prisma = {
        tx: {
            brokerBotOrders: { updateMany: async (args) => ((where = args.where), { count: 0 }) },
        },
    };
    assert.equal(await repo.rejectOrder(7, null), false);
    assert.deepEqual({ ...where }, { id: 7, kind: 'topup', status: 'pending' });
});

test('the derived Telegram secret matches the SQL backfill', () => {
    const { deriveMtprotoSecret, getMtprotoSecret } = load(
        'backend/src/common/helpers/xray-config/mtproto-secret.ts',
    );
    // Output of the formula in migration 20261115150000_audit_fixes for this UUID.
    const uuid = '45063828-c2b5-42ac-a323-45c270a47768';
    assert.equal(deriveMtprotoSecret(uuid), '504206ea0d63af0d841cba8b6a4c521f');
    assert.equal(deriveMtprotoSecret(uuid.toUpperCase()), '504206ea0d63af0d841cba8b6a4c521f');
    assert.equal(
        getMtprotoSecret({ mtprotoSecret: 'ab'.repeat(16), vlessUuid: uuid }),
        'ab'.repeat(16),
    );
});
