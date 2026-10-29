import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { RawCacheService } from '@common/raw-cache';
import { CACHE_KEYS, CACHE_KEYS_TTL } from '@libs/contracts/constants';

import { UmijiSettingsEntity } from '@modules/umiji-settings/entities';
import { UmijiSettingsRepository } from '@modules/umiji-settings/repositories/umiji-settings.repository';

import { GetCachedUmijiSettingsQuery } from './get-cached-umiji-settings.query';

@QueryHandler(GetCachedUmijiSettingsQuery)
export class GetCachedUmijiSettingsHandler implements IQueryHandler<
    GetCachedUmijiSettingsQuery,
    UmijiSettingsEntity
> {
    private readonly logger = new Logger(GetCachedUmijiSettingsHandler.name);
    constructor(
        private readonly umijiSettingsRepository: UmijiSettingsRepository,
        private readonly rawCacheService: RawCacheService,
    ) {}

    async execute(): Promise<UmijiSettingsEntity> {
        try {
            const cached = await this.rawCacheService.get<UmijiSettingsEntity>(
                CACHE_KEYS.UMIJI_SETTINGS,
            );
            if (cached) {
                return cached;
            }

            const settings = await this.umijiSettingsRepository.getSettings();

            await this.rawCacheService.set(
                CACHE_KEYS.UMIJI_SETTINGS,
                settings,
                CACHE_KEYS_TTL.UMIJI_SETTINGS,
            );

            return settings;
        } catch (error) {
            this.logger.error(error);
            throw error;
        }
    }
}
