import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace DeleteBrokerBotPlanCommand {
    export const url = REST_API.BROKER_BOT.PLANS.DELETE;
    export const TSQ_url = url(':id');

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.PLANS.DELETE(':id'),
        'delete',
        'Delete a plan',
        { scope: 'plans', kind: 'write' },
        'Subscriptions already sold are not affected.',
    );

    export const RequestParamSchema = z.object({
        id: z.coerce.number().int(),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
