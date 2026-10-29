import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerResponseSchema } from './broker.response';

export namespace ResetBrokerTrafficCommand {
    export const url = REST_API.BROKERS.ACTIONS.RESET_TRAFFIC;
    export const TSQ_url = url(':uuid');

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.ACTIONS.RESET_TRAFFIC(':uuid'),
        'post',
        'Reset broker used traffic',
        { scope: 'reset-traffic', kind: 'write' },
    );

    export const RequestParamSchema = z.object({
        uuid: z.uuid(),
    });

    export const ResponseSchema = BrokerResponseSchema;

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
