import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { UsersRepository } from '../../repositories/users.repository';
import { GetIpLimitedUsersQuery } from './get-ip-limited-users.query';

@QueryHandler(GetIpLimitedUsersQuery)
export class GetIpLimitedUsersHandler implements IQueryHandler<
    GetIpLimitedUsersQuery,
    TResult<{ id: bigint; ipLimit: number }[]>
> {
    private readonly logger = new Logger(GetIpLimitedUsersHandler.name);
    constructor(private readonly usersRepository: UsersRepository) {}

    async execute(): Promise<TResult<{ id: bigint; ipLimit: number }[]>> {
        try {
            return ok(await this.usersRepository.findIpLimitedUsers());
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
