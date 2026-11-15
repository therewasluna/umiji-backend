import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

const BrokerBotStatsPeriodSchema = z.object({
    newCustomers: z.int(),
    referrals: z.int().describe('New customers who came through a referral link'),
    sales: z.int().describe('Plans bought'),
    salesAmount: z.number().describe('Toman'),
    topups: z.int().describe('Top-ups approved'),
    topupsAmount: z.number().describe('Toman'),
    rejectedTopups: z.int(),
    trials: z.int().describe('Free trials claimed'),
    rewards: z.number().describe('Referral rewards credited, Toman'),
});

const BrokerBotStatsWindowSchema = BrokerBotStatsPeriodSchema.extend({
    activeCustomers: z.int().describe('Customers who used the bot in this window'),
});

export namespace GetBrokerBotStatsCommand {
    export const url = REST_API.BROKER_BOT.STATS;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.STATS,
        'get',
        'Get the stats of the current broker’s bot',
        { scope: 'stats', kind: 'read' },
        'Days are UTC. Everything is counted since the bot token last changed, except receipts waiting for review.',
    );

    export const ResponseSchema = z.object({
        response: z.object({
            since: z.iso.datetime().transform((str) => new Date(str)),
            totals: BrokerBotStatsPeriodSchema.extend({
                customers: z.int(),
                buyers: z.int().describe('Customers with at least one plan bought'),
                walletTotal: z.number().describe('Unspent wallet credit, Toman'),
                pendingReceipts: z.int(),
            }),
            today: BrokerBotStatsWindowSchema,
            week: BrokerBotStatsWindowSchema.describe('The last 7 days, today included'),
            month: BrokerBotStatsWindowSchema.describe('The last 30 days, today included'),
            daily: z
                .array(
                    BrokerBotStatsPeriodSchema.extend({ date: z.string().describe('YYYY-MM-DD') }),
                )
                .describe('The last 30 days, oldest first'),
            topPlans: z.array(
                z.object({
                    planId: z.int(),
                    title: z.string(),
                    sales: z.int(),
                    salesAmount: z.number(),
                }),
            ),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
