import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BROKER_BOT_MAX_TOMAN, BrokerBotResponseSchema } from './broker-bot.response';

export namespace CreateBrokerBotPlanCommand {
    export const url = REST_API.BROKER_BOT.PLANS.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.PLANS.CREATE,
        'post',
        'Create a plan',
        { scope: 'plans', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        title: z.string().trim().min(1, 'Enter a plan title.').max(64),
        trafficGb: z.number().min(0, 'Traffic must be ≥ 0.').max(1_000_000),
        durationDays: z.int().min(1, 'Duration must be at least 1 day.').max(3650),
        price: z.int().min(0, 'Price must be ≥ 0.').max(BROKER_BOT_MAX_TOMAN),
        squadUuid: z.uuid(),
        categoryId: z.nullable(z.int()),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
