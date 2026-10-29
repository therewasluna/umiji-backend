import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { BrokerEntity } from '../../entities';
import { BrokersRepository } from '../../repositories';
import { GetBrokerByUuidQuery } from './get-broker-by-uuid.query';

@QueryHandler(GetBrokerByUuidQuery)
export class GetBrokerByUuidHandler implements IQueryHandler<
    GetBrokerByUuidQuery,
    TResult<BrokerEntity>
> {
    private readonly logger = new Logger(GetBrokerByUuidHandler.name);
    constructor(private readonly brokersRepository: BrokersRepository) {}

    async execute(query: GetBrokerByUuidQuery): Promise<TResult<BrokerEntity>> {
        try {
            const broker = await this.brokersRepository.findByUUID(query.uuid);

            if (!broker) {
                return fail(ERRORS.BROKER_NOT_FOUND);
            }

            return ok(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
