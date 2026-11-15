import { z } from 'zod';

import { RESET_PERIODS, USERS_STATUS } from '../constants';

// Telegram proxy secrets and sponsored channel tags are both 16 bytes of hex.
export const MtprotoHexSchema = z
    .string()
    .toLowerCase()
    .regex(/^[0-9a-f]{32}$/, 'Must be exactly 32 hex characters (0-9, a-f)');

export const UsersSchema = z.object({
    id: z.number(),
    shortUuid: z.string(),
    username: z.string(),
    status: z.enum(USERS_STATUS),
    trafficLimitBytes: z.number(),
    trafficLimitStrategy: z.enum(RESET_PERIODS).describe('Available reset periods'),
    expireAt: z.iso.datetime().transform((str) => new Date(str)),
    telegramId: z.nullable(z.number()),
    email: z.nullable(z.email()),
    description: z.nullable(z.string()),
    tag: z.nullable(z.string()),
    hwidDeviceLimit: z.nullable(z.int()),
    ipLimit: z.nullable(z.int()),
    externalSquadUuid: z.nullable(z.uuid()),
    brokerUuid: z.nullable(z.uuid()),
    trojanPassword: z.string(),
    vlessUuid: z.guid(),
    ssPassword: z.string(),
    mtprotoSecret: z.string(),
    mtprotoAdTag: z.nullable(z.string()),
    lastTriggeredThreshold: z.int(),
    subRevokedAt: z.nullable(z.iso.datetime().transform((str) => new Date(str))),
    lastTrafficResetAt: z.nullable(z.iso.datetime().transform((str) => new Date(str))),
    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
