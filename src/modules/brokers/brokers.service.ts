import { Prisma } from '@prisma/client';

import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { TypedConfigService } from '@common/config/app-config';
import { fail, ok, TResult } from '@common/types';
import { hashPassword, wrapBigInt } from '@common/utils';
import { ERRORS, EVENTS } from '@libs/contracts/constants';

import { SyncBrokerUsersCommand } from '@modules/users/commands/sync-broker-users';
import { ShortUserStats } from '@modules/users/interfaces/user-stats.interface';
import { GetShortUserStatsQuery } from '@modules/users/queries/get-short-user-stats';

import { UsersQueuesService } from '@queue/_users';

import { CreateBrokerBodyDto, UpdateBrokerBodyDto } from './dtos';
import { BrokerEntity } from './entities';
import { GetBrokerMeResponseModel } from './models';
import { BrokersRepository } from './repositories';

@Injectable()
export class BrokersService {
    private readonly logger = new Logger(BrokersService.name);
    private readonly appSecret: string;

    constructor(
        private readonly brokersRepository: BrokersRepository,
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus,
        private readonly usersQueuesService: UsersQueuesService,
        configService: TypedConfigService,
    ) {
        this.appSecret = configService.getOrThrow('APP_SECRET');
    }

    public async getBrokers(): Promise<TResult<BrokerEntity[]>> {
        try {
            return ok(await this.brokersRepository.findAll());
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_BROKERS_ERROR);
        }
    }

    public async getBroker(uuid: string): Promise<TResult<BrokerEntity>> {
        try {
            const broker = await this.brokersRepository.findByUUID(uuid);

            if (!broker) return fail(ERRORS.BROKER_NOT_FOUND);

            return ok(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_BROKERS_ERROR);
        }
    }

    public async getMe(broker: BrokerEntity): Promise<TResult<GetBrokerMeResponseModel>> {
        try {
            const [internalSquads, stats] = await Promise.all([
                this.brokersRepository.findInternalSquadsWithMembers(broker.uuid),
                this.queryBus.execute<GetShortUserStatsQuery, TResult<ShortUserStats>>(
                    new GetShortUserStatsQuery(broker.uuid),
                ),
            ]);

            if (!stats.isOk) return fail(ERRORS.GET_BROKERS_ERROR);

            return ok(new GetBrokerMeResponseModel(broker, internalSquads, stats.response));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_BROKERS_ERROR);
        }
    }

    public async createBroker(dto: CreateBrokerBodyDto): Promise<TResult<BrokerEntity>> {
        try {
            const broker = await this.brokersRepository.create({
                username: dto.username,
                passwordHash: await hashPassword(dto.password, this.appSecret),
                fields: {
                    trafficLimitBytes: BigInt(dto.trafficLimitBytes),
                    usersLimit: dto.usersLimit,
                    expireAt: dto.expireAt,
                    description: dto.description,
                },
                internalSquads: dto.internalSquads,
            });

            return ok(broker);
        } catch (error) {
            this.logger.error(error);

            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                // The username is also the name of the broker's external squad and subpage config.
                return fail(
                    error.meta?.modelName === 'Admin'
                        ? ERRORS.BROKER_USERNAME_ALREADY_EXISTS
                        : ERRORS.BROKER_RESOURCE_NAME_TAKEN,
                );
            }

            return fail(ERRORS.CREATE_BROKER_ERROR);
        }
    }

    public async updateBroker(dto: UpdateBrokerBodyDto): Promise<TResult<BrokerEntity>> {
        try {
            const existing = await this.brokersRepository.findByUUID(dto.uuid);

            if (!existing) return fail(ERRORS.BROKER_NOT_FOUND);

            const broker = await this.brokersRepository.update({
                uuid: dto.uuid,
                passwordHash: dto.password
                    ? await hashPassword(dto.password, this.appSecret)
                    : undefined,
                fields: {
                    trafficLimitBytes: wrapBigInt(dto.trafficLimitBytes),
                    usersLimit: dto.usersLimit,
                    expireAt: dto.expireAt,
                    description: dto.description,
                    isDisabled: dto.isDisabled,
                },
                internalSquads: dto.internalSquads,
            });

            if (!broker) return fail(ERRORS.BROKER_NOT_FOUND);

            await this.syncUsers(broker);

            return ok(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.UPDATE_BROKER_ERROR);
        }
    }

    public async deleteBroker(uuid: string): Promise<TResult<boolean>> {
        try {
            const broker = await this.brokersRepository.findByUUID(uuid);

            if (!broker) return fail(ERRORS.BROKER_NOT_FOUND);

            // Users stay in the panel and move to the admin, so lift the broker quota and expiry
            // first to bring back the ones the broker had taken down.
            const lifted = await this.brokersRepository.update({
                uuid,
                fields: { trafficLimitBytes: 0n, expireAt: null },
            });

            if (lifted) {
                await this.syncUsers(lifted);
            }

            const isDeleted = await this.brokersRepository.deleteByUUID(uuid);

            if (!isDeleted) return fail(ERRORS.BROKER_NOT_FOUND);

            return ok(true);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_BROKER_ERROR);
        }
    }

    public async resetBrokerTraffic(uuid: string): Promise<TResult<BrokerEntity>> {
        try {
            const existing = await this.brokersRepository.findByUUID(uuid);

            if (!existing) return fail(ERRORS.BROKER_NOT_FOUND);

            await this.brokersRepository.resetUsedTraffic(uuid);

            const broker = await this.brokersRepository.findByUUID(uuid);

            if (!broker) return fail(ERRORS.BROKER_NOT_FOUND);

            await this.syncUsers(broker);

            return ok(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.UPDATE_BROKER_ERROR);
        }
    }

    /** Re-activates users the broker's quota or expiry had taken down, if the broker allows it again. */
    private async syncUsers(broker: BrokerEntity): Promise<void> {
        if (broker.isExpired) return;

        const result = await this.commandBus.execute<
            SyncBrokerUsersCommand,
            TResult<{ id: bigint }[]>
        >(new SyncBrokerUsersCommand(broker.uuid));

        if (!result.isOk || result.response.length === 0) return;

        await this.usersQueuesService.fireUserEventBulk({
            users: result.response,
            userEvent: EVENTS.USER.ENABLED,
        });
    }
}
