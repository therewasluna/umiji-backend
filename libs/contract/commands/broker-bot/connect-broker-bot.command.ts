import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerBotResponseSchema } from './broker-bot.response';

export namespace ConnectBrokerBotCommand {
    export const url = REST_API.BROKER_BOT.CONNECT;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.CONNECT,
        'post',
        'Connect the bot or change its group',
        { scope: 'connect', kind: 'write' },
        'Validates the token with Telegram and creates the Review Receipts and Logs topics in the staff group when it is set or changed.',
    );

    export const RequestBodySchema = z.object({
        botToken: z
            .string()
            .trim()
            .max(128)
            .optional()
            .describe('Omit or leave empty to keep the saved token.'),
        groupId: z.nullable(
            z
                .string()
                .trim()
                .regex(/^-?\d+$/, 'Enter a valid numeric group chat ID (e.g. -1001234567890).'),
        ),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
