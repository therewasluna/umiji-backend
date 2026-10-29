import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BROKER_BOT_MAX_TOMAN } from './broker-bot.response';

export namespace TopUpBrokerBotWalletCommand {
    export const url = REST_API.BROKER_BOT.ACTIONS.TOP_UP;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.ACTIONS.TOP_UP,
        'post',
        "Credit a customer's wallet",
        { scope: 'top-up', kind: 'write' },
        'The customer must have started the bot. They get a message about it.',
    );

    export const RequestBodySchema = z.object({
        telegramId: z
            .string()
            .trim()
            .regex(/^\d+$/, 'Enter a valid Telegram numeric ID (digits only).'),
        amount: z.int().min(1, 'Enter a valid amount in Toman.').max(BROKER_BOT_MAX_TOMAN),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            name: z.string(),
            balance: z.number(),
        }),
    });

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
