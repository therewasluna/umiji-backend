import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';

import { Injectable } from '@nestjs/common';

import { UmijiSettingsEntity } from '../entities';

const DEFAULT_UMIJI_SETTINGS_ID = 1;

@Injectable()
export class UmijiSettingsRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    public async create(entity: UmijiSettingsEntity): Promise<UmijiSettingsEntity> {
        const result = await this.prisma.tx.umijiSettings.create({
            data: {
                id: entity.id,
                passkeySettings: entity.passkeySettings,
            },
        });

        return new UmijiSettingsEntity(result);
    }

    public async findById(id: number): Promise<UmijiSettingsEntity | null> {
        const result = await this.prisma.tx.umijiSettings.findUnique({
            where: { id },
        });
        if (!result) {
            return null;
        }
        return new UmijiSettingsEntity(result);
    }

    public async getSettings(): Promise<UmijiSettingsEntity> {
        const result = await this.prisma.tx.umijiSettings.findFirstOrThrow();
        return new UmijiSettingsEntity(result);
    }

    public async update({
        id = DEFAULT_UMIJI_SETTINGS_ID,
        ...data
    }: Partial<UmijiSettingsEntity>): Promise<UmijiSettingsEntity> {
        const result = await this.prisma.tx.umijiSettings.update({
            where: {
                id,
            },
            data,
        });

        return new UmijiSettingsEntity(result);
    }

    public async getInitDate(): Promise<Date> {
        const result = await this.prisma.tx.$queryRaw<{ started_at: Date }[]>`
            SELECT started_at
            FROM _prisma_migrations
            ORDER BY started_at ASC
            LIMIT 1
        `;

        if (!result.length || !result[0].started_at) {
            return new Date();
        }

        const date = new Date(result[0].started_at);

        if (isNaN(date.getTime())) {
            return new Date();
        }

        return date;
    }
}
