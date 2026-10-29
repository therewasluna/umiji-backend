import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotOrderSchema } from './broker-bot.response';

export namespace GetBrokerBotOrdersCommand {
    export const url = REST_API.BROKER_BOT.ORDERS.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.ORDERS.GET,
        'get',
        'Get receipts to review and the order history',
        { scope: 'orders', kind: 'read' },
        'Pending top-ups are always returned in full; the history is paginated.',
    );

    export const RequestQuerySchema = z.object({
        start: z.coerce.number().int().min(0).default(0),
        size: z.coerce.number().int().min(1).max(100).default(20),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            pending: z.array(BrokerBotOrderSchema),
            orders: z.array(BrokerBotOrderSchema),
            total: z.int(),
        }),
    });

    export type RequestQuery = z.infer<typeof RequestQuerySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
