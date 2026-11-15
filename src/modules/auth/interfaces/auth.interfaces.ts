import { TRolesKeys } from '@libs/contracts/constants';

import type { BrokerEntity } from '@modules/brokers/entities';

export interface IJWTAuthPayload {
    role: TRolesKeys;
    username: null | string;
    uuid: null | string;
    sessionVersion?: number;
    scopes?: string[];
    broker?: BrokerEntity;
}
