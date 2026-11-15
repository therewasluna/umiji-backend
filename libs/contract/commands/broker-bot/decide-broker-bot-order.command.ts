import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace DecideBrokerBotOrderCommand {
    export const url = REST_API.BROKER_BOT.ORDERS.DECIDE;
    export const TSQ_url = url(':id');

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.ORDERS.DECIDE(':id'),
        'post',
        'Approve or reject a top-up receipt or recover an incomplete purchase',
        { scope: 'orders', kind: 'write' },
        'Same effect as deciding in Telegram: the wallet is credited (or not), the customer is told and the review message is updated.',
    );

    export const RequestParamSchema = z.object({
        id: z.coerce.number().int(),
    });

    export const RequestBodySchema = z.object({
        decision: z.enum(['approve', 'reject']),
        reason: z.string().trim().max(500).optional(),
        userId: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    });

    export const ResponseSchema = z.object({
        response: z.object({ isDone: z.boolean() }),
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
