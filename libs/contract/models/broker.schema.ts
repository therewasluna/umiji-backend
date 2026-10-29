import { z } from 'zod';

import { BaseInternalSquadSchema } from './base-internal-squad.schema';

export const BrokerSchema = z.object({
    uuid: z.uuid(),
    username: z.string(),
    trafficLimitBytes: z.number(),
    usedTrafficBytes: z.number(),
    usersLimit: z.nullable(z.int()),
    usersCount: z.int(),
    expireAt: z.nullable(z.iso.datetime().transform((str) => new Date(str))),
    isDisabled: z.boolean(),
    description: z.nullable(z.string()),
    internalSquads: z.array(BaseInternalSquadSchema),
    externalSquad: z.nullable(z.object({ uuid: z.uuid(), name: z.string() })),

    createdAt: z.iso.datetime().transform((str) => new Date(str)),
    updatedAt: z.iso.datetime().transform((str) => new Date(str)),
});
