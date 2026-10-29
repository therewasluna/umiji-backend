import { ShortUserStats } from '@modules/users/interfaces/user-stats.interface';

import { BrokerEntity } from '../entities';
import { BrokersRepository } from '../repositories';

type TInternalSquadWithMembers = Awaited<
    ReturnType<BrokersRepository['findInternalSquadsWithMembers']>
>[number];

export class GetBrokerMeResponseModel {
    public readonly uuid: string;
    public readonly username: string;
    public readonly trafficLimitBytes: number;
    public readonly usedTrafficBytes: number;
    public readonly usersLimit: number | null;
    public readonly usersCount: number;
    public readonly expireAt: Date | null;
    public readonly isDisabled: boolean;
    public readonly externalSquad: { uuid: string; name: string } | null;
    public readonly subpageConfigUuid: string | null;
    public readonly internalSquads: TInternalSquadWithMembers[];
    public readonly users: ShortUserStats['statusCounts'];
    public readonly onlineStats: ShortUserStats['onlineStats'];

    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    // The admin's private note (description) is left out on purpose.
    constructor(
        entity: BrokerEntity,
        internalSquads: TInternalSquadWithMembers[],
        stats: ShortUserStats,
    ) {
        this.uuid = entity.uuid;
        this.username = entity.username;
        this.trafficLimitBytes = Number(entity.trafficLimitBytes);
        this.usedTrafficBytes = Number(entity.usedTrafficBytes);
        this.usersLimit = entity.usersLimit;
        this.usersCount = entity.usersCount;
        this.expireAt = entity.expireAt;
        this.isDisabled = entity.isDisabled;
        this.externalSquad = entity.externalSquad;
        this.subpageConfigUuid = entity.subpageConfigUuid;
        this.internalSquads = internalSquads;
        this.users = stats.statusCounts;
        this.onlineStats = stats.onlineStats;

        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
