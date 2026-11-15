import { createHash } from 'node:crypto';

interface IMtprotoUser {
    mtprotoSecret: null | string;
    vlessUuid: string;
}

// The default secret: hashed so a shared Telegram link can't be turned back into the VLESS UUID, and
// rotating with it on revoke. It's stored like a chosen one, so the unique index covers every user.
// The SQL twin in migration 20261115150000_audit_fixes must stay in step.
export const deriveMtprotoSecret = (vlessUuid: string): string =>
    createHash('sha256').update(`mtproto:${vlessUuid.toLowerCase()}`).digest('hex').slice(0, 32);

// Null only on rows the backfill had to skip because their derived secret was already taken.
export const getMtprotoSecret = (user: IMtprotoUser): string =>
    user.mtprotoSecret ?? deriveMtprotoSecret(user.vlessUuid);

// The "ee" prefix tells Telegram to use fake TLS, and the domain it should claim to visit follows.
export const getMtprotoLinkSecret = (user: IMtprotoUser, domain: string): string =>
    `ee${getMtprotoSecret(user)}${Buffer.from(domain).toString('hex')}`;
