import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace DisconnectBrokerBotCommand {
    export const url = REST_API.BROKER_BOT.DISCONNECT;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.DISCONNECT,
        'delete',
        'Disconnect the bot',
        { scope: 'disconnect', kind: 'write' },
        'Plans, payment methods, channels, customers and orders are kept.',
    );

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Response = z.infer<typeof ResponseSchema>;
}
