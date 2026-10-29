import { BrokerEntity } from '../entities';

export class GetBrokerResponseModel {
    public readonly uuid: string;
    public readonly username: string;
    public readonly trafficLimitBytes: number;
    public readonly usedTrafficBytes: number;
    public readonly usersLimit: number | null;
    public readonly usersCount: number;
    public readonly expireAt: Date | null;
    public readonly isDisabled: boolean;
    public readonly description: string | null;
    public readonly internalSquads: { uuid: string; name: string }[];
    public readonly externalSquad: { uuid: string; name: string } | null;

    public readonly createdAt: Date;
    public readonly updatedAt: Date;

    constructor(entity: BrokerEntity) {
        this.uuid = entity.uuid;
        this.username = entity.username;
        this.trafficLimitBytes = Number(entity.trafficLimitBytes);
        this.usedTrafficBytes = Number(entity.usedTrafficBytes);
        this.usersLimit = entity.usersLimit;
        this.usersCount = entity.usersCount;
        this.expireAt = entity.expireAt;
        this.isDisabled = entity.isDisabled;
        this.description = entity.description;
        this.internalSquads = entity.internalSquads;
        this.externalSquad = entity.externalSquad;

        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
