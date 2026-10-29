import { z } from 'zod';

import { UMIJI_SETTINGS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { UmijiSettingsSchema } from '../../models';

export namespace GetUmijiSettingsCommand {
    export const url = REST_API.UMIJI_SETTINGS.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        UMIJI_SETTINGS_ROUTES.GET,
        'get',
        'Get Umiji settings',
        { scope: 'get', kind: 'read' },
    );

    export const ResponseSchema = z.object({
        response: UmijiSettingsSchema,
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
