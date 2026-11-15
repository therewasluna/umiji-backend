export const BROKER_BOT_CONTROLLER = 'broker-bot' as const;

export const BROKER_BOT_ROUTES = {
    GET: '',
    DISCONNECT: '',
    CONNECT: 'connect',
    UPDATE_SETTINGS: 'settings',
    STATS: 'stats',
    PLANS: {
        CREATE: 'plans',
        UPDATE: 'plans',
        DELETE: (id: string) => `plans/${id}`,
    },
    CATEGORIES: {
        CREATE: 'categories',
        DELETE: (id: string) => `categories/${id}`,
    },
    ORDERS: {
        GET: 'orders',
        DECIDE: (id: string) => `orders/${id}/decision`,
        RECEIPT: (id: string) => `orders/${id}/receipt`,
    },
    ACTIONS: {
        TOP_UP: 'actions/top-up',
    },
    BROADCASTS: {
        GET: 'broadcasts',
        CREATE: 'broadcasts',
    },
    TEXTS: {
        GET: 'texts',
        UPDATE: 'texts',
    },
    WEBHOOK: (brokerUuid: string) => `webhook/${brokerUuid}`,
} as const;
