import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { BrokerResponseSchema } from './broker.response';
import { CreateBrokerCommand } from './create-broker.command';

export namespace UpdateBrokerCommand {
    export const url = REST_API.BROKERS.UPDATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.UPDATE,
        'patch',
        'Update broker',
        { scope: 'update', kind: 'write' },
    );

    const { shape } = CreateBrokerCommand.RequestBodySchema;

    export const RequestBodySchema = z.object({
        uuid: z.uuid(),
        password: shape.password.optional().describe('Set a new password. Omit to keep it.'),
        trafficLimitBytes: z.int().min(0).optional(),
        usersLimit: z.nullable(z.int().min(1)).optional(),
        expireAt: z
            .nullable(
                z.iso.datetime({ offset: true, local: true }).transform((str) => new Date(str)),
            )
            .optional(),
        description: z.nullable(z.string().max(255)).optional(),
        isDisabled: z.boolean().optional(),
        internalSquads: z.array(z.uuid()).optional(),
    });

    export const ResponseSchema = BrokerResponseSchema;

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
