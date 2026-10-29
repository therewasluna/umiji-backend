import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { UmijiSettingsRepository } from '@modules/umiji-settings/repositories/umiji-settings.repository';

import { GetInitDateQuery } from './get-init-date.query';

@QueryHandler(GetInitDateQuery)
export class GetInitDateHandler implements IQueryHandler<GetInitDateQuery, Date> {
    private readonly logger = new Logger(GetInitDateHandler.name);
    constructor(private readonly umijiSettingsRepository: UmijiSettingsRepository) {}

    async execute(): Promise<Date> {
        try {
            const initDate = await this.umijiSettingsRepository.getInitDate();

            return initDate;
        } catch (error) {
            this.logger.error(error);
            throw error;
        }
    }
}
