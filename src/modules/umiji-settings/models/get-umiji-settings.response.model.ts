import {
    TBrandingSettings,
    TOauth2Settings,
    TPasswordAuthSettings,
    TUmijiPasskeySettings,
} from '@libs/contracts/models';

import { UmijiSettingsEntity } from '../entities';

export class UmijiSettingsResponseModel {
    public passkeySettings: TUmijiPasskeySettings;
    public oauth2Settings: TOauth2Settings;
    public passwordSettings: TPasswordAuthSettings;
    public brandingSettings: TBrandingSettings;

    constructor(entity: UmijiSettingsEntity) {
        this.passkeySettings = entity.passkeySettings;
        this.oauth2Settings = entity.oauth2Settings;
        this.passwordSettings = entity.passwordSettings;
        this.brandingSettings = entity.brandingSettings;
    }
}
