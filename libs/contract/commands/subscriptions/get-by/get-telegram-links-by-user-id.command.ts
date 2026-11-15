import { z } from 'zod';

import { REST_API, SUBSCRIPTIONS_ROUTES } from '../../../api';
import { getEndpointDetails } from '../../../constants';
import { numberParamSchema } from '../../../models';

export namespace GetTelegramLinksByUserIdCommand {
    export const url = REST_API.SUBSCRIPTIONS.GET_TELEGRAM_LINKS_BY_USER_ID;
    export const TSQ_url = url(':userId');

    export const endpointDetails = getEndpointDetails(
        SUBSCRIPTIONS_ROUTES.GET_TELEGRAM_LINKS_BY_USER_ID(':userId'),
        'get',
        'Get Telegram proxy links by user id',
        { scope: 'telegram-links', kind: 'read' },
    );

    export const RequestParamSchema = z.object({
        userId: numberParamSchema.describe('User ID'),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            links: z.array(z.string()),
        }),
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
