import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import {
    BrokerBotCardSchema,
    BrokerBotPayMethodSchema,
    BrokerBotRequiredChannelSchema,
    BrokerBotResponseSchema,
    BrokerBotTelegramLinkSchema,
    BrokerBotTrialSchema,
    BrokerBotWalletSchema,
} from './broker-bot.response';

export namespace UpdateBrokerBotSettingsCommand {
    export const url = REST_API.BROKER_BOT.UPDATE_SETTINGS;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.UPDATE_SETTINGS,
        'patch',
        'Update the channel link, payment methods, mandatory channels, referrals or the free trial',
        { scope: 'settings', kind: 'write' },
        'Lists are replaced as a whole. Omitted fields stay as they are. resetTrial lets every customer claim the free trial again.',
    );

    export const RequestBodySchema = z.object({
        channelUrl: z.nullable(BrokerBotTelegramLinkSchema).optional(),
        cards: z.array(BrokerBotCardSchema).max(20).optional(),
        wallets: z.array(BrokerBotWalletSchema).max(20).optional(),
        payMethods: z.array(BrokerBotPayMethodSchema).max(20).optional(),
        requiredChannels: z.array(BrokerBotRequiredChannelSchema).max(10).optional(),
        clearGroupFinds: z.boolean().optional(),
        referralPercent: z.int().min(0).max(100).optional(),
        trial: BrokerBotTrialSchema.optional(),
        resetTrial: z.boolean().optional(),
    });

    export const ResponseSchema = BrokerBotResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
