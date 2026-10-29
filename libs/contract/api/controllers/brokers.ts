export const BROKERS_CONTROLLER = 'brokers' as const;

export const BROKERS_ROUTES = {
    GET: '',
    CREATE: '',
    UPDATE: '',
    ME: 'me',
    GET_BY_UUID: (uuid: string) => `${uuid}`,
    DELETE: (uuid: string) => `${uuid}`,
    ACTIONS: {
        RESET_TRAFFIC: (uuid: string) => `${uuid}/actions/reset-traffic`,
    },
} as const;
