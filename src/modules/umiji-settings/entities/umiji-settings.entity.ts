import { UmijiSettings } from '@prisma/client';

import {
    TBrandingSettings,
    TOauth2Settings,
    TPasswordAuthSettings,
    TUmijiPasskeySettings,
} from '@libs/contracts/models';

export class UmijiSettingsEntity implements UmijiSettings {
    public id: number;
    public passkeySettings: TUmijiPasskeySettings;
    public oauth2Settings: TOauth2Settings;
    public passwordSettings: TPasswordAuthSettings;
    public brandingSettings: TBrandingSettings;

    constructor(umijiSettings: Partial<UmijiSettings>) {
        Object.assign(this, umijiSettings);
        return this;
    }
}
