import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerSchema } from '../../models';

export namespace GetBrokersCommand {
    export const url = REST_API.BROKERS.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.GET,
        'get',
        'Get all brokers',
        { scope: 'list', kind: 'read' },
    );

    export const ResponseSchema = z.object({
        response: z.object({
            total: z.number(),
            brokers: z.array(BrokerSchema),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
