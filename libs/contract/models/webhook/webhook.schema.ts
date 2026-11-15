import z from 'zod';

import { EVENTS, EVENTS_SCOPES, toZodEnum, CRUD_ACTIONS } from '../../constants';
import { ExtendedUsersSchema } from '../extended-users.schema';
import { HwidUserDeviceSchema } from '../hwid-user-device.schema';
import { NodesSchema } from '../nodes.schema';

export const UmijiWebhookUserEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.USER),
    event: z.enum(toZodEnum(EVENTS.USER)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: ExtendedUsersSchema,
    meta: z
        .object({
            notConnectedAfterHours: z.number().nullish(),
            expiration: z.number().nullish(),
        })
        .nullable(),
});

export const UmijiWebhookUserHwidDevicesEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.USER_HWID_DEVICES),
    event: z.enum(toZodEnum(EVENTS.USER_HWID_DEVICES)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: z.object({
        user: ExtendedUsersSchema,
        hwidUserDevice: HwidUserDeviceSchema,
    }),
});

export const UmijiWebhookNodeEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.NODE),
    event: z.enum(toZodEnum(EVENTS.NODE)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: NodesSchema,
});

export const UmijiWebhookServiceEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.SERVICE),
    event: z.enum(toZodEnum(EVENTS.SERVICE)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: z.object({
        loginAttempt: z
            .object({
                username: z.string(),
                ip: z.string(),
                userAgent: z.string(),
                description: z.string().optional(),
                password: z.string().optional(),
            })
            .optional(),
        panelVersion: z.string().optional(),
        subpageConfig: z
            .object({
                action: z.enum(toZodEnum(CRUD_ACTIONS)),
                uuid: z.uuid(),
            })

            .optional(),
        apiToken: z
            .object({
                name: z.string(),
                uuid: z.uuid(),
                expireAt: z
                    .string()
                    .datetime()
                    .transform((str) => new Date(str)),
                scopes: z.array(z.string()),
            })
            .optional(),
    }),
});

export const UmijiWebhookErrorsEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.ERRORS),
    event: z.enum(toZodEnum(EVENTS.ERRORS)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: z.object({
        description: z.string(),
    }),
});

export const UmijiWebhookCrmEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.CRM),
    event: z.enum(toZodEnum(EVENTS.CRM)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: z.object({
        providerName: z.string(),
        nodeName: z.string(),
        nextBillingAt: z
            .string()
            .datetime()
            .transform((str) => new Date(str)),
        loginUrl: z.string(),
    }),
});

export const UmijiWebhookTorrentBlockerEvents = z.object({
    scope: z.literal(EVENTS_SCOPES.TORRENT_BLOCKER),
    event: z.enum(toZodEnum(EVENTS.TORRENT_BLOCKER)),
    timestamp: z
        .string()
        .datetime()
        .transform((str) => new Date(str)),
    data: z.object({
        node: NodesSchema,
        user: ExtendedUsersSchema,
        report: z.object({
            actionReport: z.object({
                blocked: z.boolean(),
                ip: z.string(),
                blockDuration: z.number(),
                willUnblockAt: z
                    .string()
                    .datetime({ offset: true, local: true })
                    .transform((str) => new Date(str)),
                userId: z.string(),
                processedAt: z
                    .string()
                    .datetime({ offset: true, local: true })
                    .transform((str) => new Date(str)),
            }),
            xrayReport: z.object({
                email: z.string().nullable(),
                level: z.number().nullable(),
                protocol: z.string().nullable(),
                network: z.string(),
                source: z.string().nullable(),
                destination: z.string(),
                routeTarget: z.string().nullable(),
                originalTarget: z.string().nullable(),
                inboundTag: z.string().nullable(),
                inboundName: z.string().nullable(),
                inboundLocal: z.string().nullable(),
                outboundTag: z.string().nullable(),
                ts: z.number(),
            }),
        }),
    }),
});
export const UmijiWebhookEventSchema = z.discriminatedUnion('scope', [
    UmijiWebhookUserEvents,
    UmijiWebhookUserHwidDevicesEvents,
    UmijiWebhookNodeEvents,
    UmijiWebhookServiceEvents,
    UmijiWebhookErrorsEvents,
    UmijiWebhookCrmEvents,
    UmijiWebhookTorrentBlockerEvents,
]);

export type TUmijiWebhookEvent = z.infer<typeof UmijiWebhookEventSchema>;

export type TUmijiWebhookUserEvent = z.infer<typeof UmijiWebhookUserEvents>;
export type TUmijiWebhookNodeEvent = z.infer<typeof UmijiWebhookNodeEvents>;
export type TUmijiWebhookServiceEvent = z.infer<typeof UmijiWebhookServiceEvents>;
export type TUmijiWebhookErrorsEvent = z.infer<typeof UmijiWebhookErrorsEvents>;
export type TUmijiWebhookCrmEvent = z.infer<typeof UmijiWebhookCrmEvents>;
export type TUmijiWebhookUserHwidDevicesEvent = z.infer<typeof UmijiWebhookUserHwidDevicesEvents>;
export type TUmijiWebhookTorrentBlockerEvent = z.infer<typeof UmijiWebhookTorrentBlockerEvents>;
