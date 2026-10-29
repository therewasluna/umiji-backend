import { Query } from '@nestjs/cqrs';

import { UmijiSettingsEntity } from '@modules/umiji-settings/entities';

export class GetCachedUmijiSettingsQuery extends Query<UmijiSettingsEntity> {
    constructor() {
        super();
    }
}
