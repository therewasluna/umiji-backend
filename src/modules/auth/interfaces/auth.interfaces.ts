import { TRolesKeys } from '@libs/contracts/constants';

import type { BrokerEntity } from '@modules/brokers/entities';

export interface IJWTAuthPayload {
    role: TRolesKeys;
    username: null | string;
    uuid: null | string;
    scopes?: string[];
    broker?: BrokerEntity;
}
