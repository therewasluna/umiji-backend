import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails, USERS_STATUS } from '../../constants';
import { BrokerSchema } from '../../models';

export namespace GetBrokerMeCommand {
    export const url = REST_API.BROKERS.ME;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.ME,
        'get',
        'Get the current broker',
        { scope: 'me', kind: 'read' },
        'Returns the quota, limits, squads and user statistics of the broker making the request.',
    );

    export const ResponseSchema = z.object({
        response: BrokerSchema.omit({ description: true, internalSquads: true }).extend({
            subpageConfigUuid: z
                .nullable(z.uuid())
                .describe(
                    'Subscription page config the broker can edit. Null when the external squad has none or shares it with others.',
                ),
            internalSquads: z.array(
                z.object({
                    uuid: z.uuid(),
                    name: z.string(),
                    membersCount: z.int().describe('Users of this broker in the squad'),
                    inbounds: z.array(
                        z.object({
                            uuid: z.uuid(),
                            tag: z.string(),
                            type: z.string(),
                            network: z.nullable(z.string()),
                            security: z.nullable(z.string()),
                            port: z.nullable(z.number()),
                        }),
                    ),
                    locations: z
                        .array(
                            z.object({
                                countryCode: z.string(),
                                nodesCount: z.int(),
                                onlineCount: z.int(),
                            }),
                        )
                        .describe('Countries of the enabled nodes serving the squad'),
                    hosts: z
                        .array(z.object({ remark: z.string() }))
                        .describe('Subscription entries a user in this squad gets'),
                }),
            ),
            users: z.object({
                statusCounts: z.record(z.enum(USERS_STATUS), z.number()),
                totalUsers: z.number(),
            }),
            onlineStats: z.object({
                lastDay: z.number(),
                lastWeek: z.number(),
                neverOnline: z.number(),
                onlineNow: z.number(),
            }),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
