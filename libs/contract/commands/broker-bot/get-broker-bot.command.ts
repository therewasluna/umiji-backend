import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace GetBrokerBotCommand {
    export const url = REST_API.BROKER_BOT.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.GET,
        'get',
        'Get the Telegram bot of the current broker',
        { scope: 'get', kind: 'read' },
    );

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Response = z.infer<typeof ResponseSchema>;
}
