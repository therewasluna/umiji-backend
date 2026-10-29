import { ERRORS } from '@contract/constants';

import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';

import { UsersRepository } from '../../repositories/users.repository';
import { SyncBrokerUsersCommand } from './sync-broker-users.command';

@CommandHandler(SyncBrokerUsersCommand)
export class SyncBrokerUsersHandler implements ICommandHandler<
    SyncBrokerUsersCommand,
    TResult<{ id: bigint }[]>
> {
    public readonly logger = new Logger(SyncBrokerUsersHandler.name);

    constructor(private readonly usersRepository: UsersRepository) {}

    async execute(command: SyncBrokerUsersCommand): Promise<TResult<{ id: bigint }[]>> {
        try {
            const result = await this.usersRepository.syncBrokerUsers(command.brokerUuid);

            return ok(result);
        } catch (error: unknown) {
            this.logger.error(error);
            return fail(ERRORS.UPDATE_USER_ERROR);
        }
    }
}
