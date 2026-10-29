export const UMIJI_CLIENT_TYPE_HEADER = 'X-Umiji-Client-Type';

export const UMIJI_CLIENT_TYPE_BROWSER = 'browser';

export const UMIJI_REAL_IP_HEADER = 'x-umiji-real-ip';

export const UMIJI_BYPASS_HTTPS_RESTRCTIONS = {
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '127.0.0.1',
} as const;
