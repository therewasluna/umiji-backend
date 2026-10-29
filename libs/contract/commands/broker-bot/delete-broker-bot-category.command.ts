import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace DeleteBrokerBotCategoryCommand {
    export const url = REST_API.BROKER_BOT.CATEGORIES.DELETE;
    export const TSQ_url = url(':id');

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.CATEGORIES.DELETE(':id'),
        'delete',
        'Delete a plan category',
        { scope: 'categories', kind: 'write' },
        'Its plans stay, just uncategorized.',
    );

    export const RequestParamSchema = z.object({
        id: z.coerce.number().int(),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
