import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace CreateBrokerBotCategoryCommand {
    export const url = REST_API.BROKER_BOT.CATEGORIES.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.CATEGORIES.CREATE,
        'post',
        'Create a plan category',
        { scope: 'categories', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        title: z.string().trim().min(1, 'Enter a category name.').max(40),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
