import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

const BroadcastSchema = z.object({
    id: z.int(),
    caption: z.nullable(z.string()),
    hasMedia: z.boolean(),
    recipients: z.int(),
    sent: z.int(),
    failed: z.int(),
    status: z.enum(['sending', 'done']),
    createdAt: z.iso.datetime().transform((str) => new Date(str)),
});

export namespace GetBrokerBotBroadcastsCommand {
    export const url = REST_API.BROKER_BOT.BROADCASTS.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.BROADCASTS.GET,
        'get',
        'Get recent broadcasts to bot customers',
        { scope: 'broadcasts', kind: 'read' },
    );

    export const ResponseSchema = z.object({
        response: z.object({
            audience: z.int().describe('Customers of all connected broker bots right now'),
            broadcasts: z.array(BroadcastSchema),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}

/** 10 MB, Telegram's limit for photos. */
export const BROKER_BOT_BROADCAST_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export namespace CreateBrokerBotBroadcastCommand {
    export const url = REST_API.BROKER_BOT.BROADCASTS.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.BROADCASTS.CREATE,
        'post',
        'Send a message to every customer of every broker bot',
        { scope: 'broadcasts', kind: 'write' },
        'Delivery runs in the background through each broker’s own bot; the list shows progress.',
    );

    export const RequestBodySchema = z
        .object({
            caption: z.nullable(z.string().trim().max(4096, 'Message is too long.')),
            image: z.nullable(
                z.object({
                    fileName: z.string().max(255),
                    mimeType: z.string().regex(/^image\//, 'The media must be an image.'),
                    base64: z
                        .string()
                        .max(
                            Math.ceil(BROKER_BOT_BROADCAST_MAX_IMAGE_BYTES / 3) * 4,
                            'Image is too large (max 10 MB).',
                        ),
                }),
            ),
        })
        .refine((b) => !!b.caption || !!b.image, 'Add a message or an image.')
        .refine((b) => !b.image || !b.caption || b.caption.length <= 1024, 'Message is too long.');

    export const ResponseSchema = z.object({
        response: z.object({ id: z.int(), recipients: z.int() }),
    });

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
