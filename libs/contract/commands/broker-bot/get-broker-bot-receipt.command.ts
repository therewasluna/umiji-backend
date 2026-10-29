import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace GetBrokerBotReceiptCommand {
    export const url = REST_API.BROKER_BOT.ORDERS.RECEIPT;
    export const TSQ_url = url(':id');

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.ORDERS.RECEIPT(':id'),
        'get',
        'Get the photo of a pending receipt',
        { scope: 'orders', kind: 'read' },
    );

    export const RequestParamSchema = z.object({
        id: z.coerce.number().int(),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            mimeType: z.string(),
            base64: z.string(),
        }),
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
