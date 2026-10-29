import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerResponseSchema } from './broker.response';

export namespace CreateBrokerCommand {
    export const url = REST_API.BROKERS.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.CREATE,
        'post',
        'Create a new broker',
        { scope: 'create', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        username: z
            .string()
            .regex(
                /^[a-zA-Z0-9_-]+$/,
                'Username can only contain letters, numbers, underscores and dashes',
            )
            .min(3, 'Username must be at least 3 characters')
            .max(30, 'Username must be at most 30 characters')
            .describe(
                'Login of the broker. Must be unique across admins and brokers. Also used as the name of the external squad and subscription page config created for the broker.',
            ),
        password: z
            .string()
            .min(24, 'Password must contain at least 24 characters')
            .regex(
                /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9]).{24,}$/,
                'Password must contain uppercase and lowercase letters and numbers, and be at least 24 characters long.',
            ),
        trafficLimitBytes: z
            .int()
            .min(0)
            .default(0)
            .describe('Total traffic quota for all users of the broker. 0 means unlimited.'),
        usersLimit: z
            .nullable(z.int().min(1))
            .default(null)
            .describe('Maximum number of users the broker can own. Null means unlimited.'),
        expireAt: z
            .nullable(
                z.iso.datetime({ offset: true, local: true }).transform((str) => new Date(str)),
            )
            .default(null)
            .describe('Broker account expiration date. Null means never.'),
        description: z.nullable(z.string().max(255)).default(null),
        internalSquads: z
            .array(z.uuid())
            .default([])
            .describe('Internal squads the broker is allowed to assign to its users.'),
    });

    export const ResponseSchema = BrokerResponseSchema;

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
