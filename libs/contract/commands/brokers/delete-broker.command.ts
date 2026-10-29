import { z } from 'zod';

import { BROKERS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace DeleteBrokerCommand {
    export const url = REST_API.BROKERS.DELETE;
    export const TSQ_url = url(':uuid');

    export const endpointDetails = getEndpointDetails(
        BROKERS_ROUTES.DELETE(':uuid'),
        'delete',
        'Delete broker',
        { scope: 'delete', kind: 'write' },
        'Users of the deleted broker are kept and become owned by the admin.',
    );

    export const RequestParamSchema = z.object({
        uuid: z.uuid(),
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
}
