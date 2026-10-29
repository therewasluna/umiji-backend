import { Brokers } from '@prisma/client';

export class BrokerEntity implements Brokers {
    public uuid: string;
    public trafficLimitBytes: bigint;
    public usedTrafficBytes: bigint;
    public usersLimit: number | null;
    public expireAt: Date | null;
    public isDisabled: boolean;
    public description: string | null;
    public externalSquadUuid: string | null;

    public createdAt: Date;
    public updatedAt: Date;

    public username: string;
    public usersCount: number;
    public internalSquads: { uuid: string; name: string }[];
    public externalSquad: { uuid: string; name: string } | null;
    /** Subscription page config the broker may edit: linked to its external squad and to nothing else. */
    public subpageConfigUuid: string | null;

    constructor(broker: Partial<BrokerEntity>) {
        Object.assign(this, broker);
        return this;
    }

    public get isTrafficLimitReached(): boolean {
        return this.trafficLimitBytes > 0n && this.usedTrafficBytes >= this.trafficLimitBytes;
    }

    public get isExpired(): boolean {
        return this.expireAt !== null && this.expireAt <= new Date();
    }
}
