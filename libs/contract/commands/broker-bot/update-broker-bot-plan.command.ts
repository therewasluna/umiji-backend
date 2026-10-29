import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';
import { CreateBrokerBotPlanCommand } from './create-broker-bot-plan.command';

export namespace UpdateBrokerBotPlanCommand {
    export const url = REST_API.BROKER_BOT.PLANS.UPDATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.PLANS.UPDATE,
        'patch',
        'Update a plan or pause its sales',
        { scope: 'plans', kind: 'write' },
    );

    export const RequestBodySchema = CreateBrokerBotPlanCommand.RequestBodySchema.partial().extend({
        id: z.int(),
        isActive: z.boolean().optional(),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
