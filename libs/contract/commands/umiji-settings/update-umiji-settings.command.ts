import { z } from 'zod';

import { UMIJI_SETTINGS_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import {
    BrandingSettingsSchema,
    Oauth2SettingsSchema,
    PasskeySettingsSchema,
    PasswordAuthSettingsSchema,
    UmijiSettingsSchema,
} from '../../models';

export namespace UpdateUmijiSettingsCommand {
    export const url = REST_API.UMIJI_SETTINGS.UPDATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        UMIJI_SETTINGS_ROUTES.UPDATE,
        'patch',
        'Update Umiji settings',
        { scope: 'update', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        passkeySettings: PasskeySettingsSchema.optional(),
        oauth2Settings: Oauth2SettingsSchema.optional(),
        passwordSettings: PasswordAuthSettingsSchema.optional(),
        brandingSettings: BrandingSettingsSchema.optional(),
    });

    export const ResponseSchema = z.object({
        response: UmijiSettingsSchema,
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
