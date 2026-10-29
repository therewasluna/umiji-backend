import { Body, Controller, HttpStatus, Param, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '@common/config/app-config';
import { Endpoint } from '@common/decorators/base-endpoint';
import { GetBroker } from '@common/decorators/get-broker';
import { Roles } from '@common/decorators/roles/roles';
import { ApiScopeResource } from '@common/decorators/scopes';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ScopesGuard } from '@common/guards/scopes';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { CONTROLLERS_INFO, USERS_CONTROLLER } from '@libs/contracts/api';
import {
    CreateUserCommand,
    DeleteUserCommand,
    DisableUserCommand,
    EnableUserCommand,
    GetUsersTagsCommand,
    GetUsersCommand,
    GetUserAccessibleNodesCommand,
    GetUserByIdCommand,
    GetUserByShortUuidCommand,
    GetUserByUsernameCommand,
    GetUsersStreamCommand,
    GetUserSubscriptionRequestHistoryCommand,
    ResetUserTrafficCommand,
    ResolveUserCommand,
    RevokeUserSubscriptionCommand,
    ExtendUserCommand,
    UpdateUserCommand,
} from '@libs/contracts/commands';
import { ROLE } from '@libs/contracts/constants';

import { BrokerEntity } from '@modules/brokers/entities';

import {
    CreateUserBodyDto,
    DeleteUserParamDto,
    DisableUserParamDto,
    EnableUserParamDto,
    GetUsersTagsResponseDto,
    GetUsersQueryDto,
    GetUserAccessibleNodesParamDto,
    GetUserAccessibleNodesResponseDto,
    GetUserByShortUuidParamDto,
    GetUserByUsernameParamDto,
    GetUsersStreamQueryDto,
    GetUsersStreamResponseDto,
    GetUserSubscriptionRequestHistoryParamDto,
    GetUserSubscriptionRequestHistoryResponseDto,
    ResetUserTrafficParamDto,
    ResolveUserBodyDto,
    ResolveUserResponseDto,
    RevokeUserSubscriptionBodyDto,
    RevokeUserSubscriptionParamDto,
    UpdateUserBodyDto,
    GetUsersResponseDto,
    GetUserByIdParamDto,
    UserResponseDto,
    ExtendUserBodyDto,
    ExtendUserParamDto,
} from '../dtos';
import {
    GetAllTagsResponseModel,
    GetAllUsersResponseModel,
    GetFullUserResponseModel,
    GetUsersStreamResponseModel,
} from '../models';
import { UsersService } from '../users.service';

@ApiBearerAuth('Authorization')
@ApiScopeResource(CONTROLLERS_INFO.USERS.resource)
@ApiTags(CONTROLLERS_INFO.USERS.tag)
@Roles(ROLE.ADMIN, ROLE.API)
@UseGuards(JwtDefaultGuard, RolesGuard, ScopesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(USERS_CONTROLLER)
export class UsersController {
    public readonly subPublicDomain: string;
    constructor(
        private readonly usersService: UsersService,
        private readonly configService: TypedConfigService,
    ) {
        this.subPublicDomain = this.configService.getOrThrow('SUB_PUBLIC_DOMAIN');
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: CreateUserCommand,
        httpCode: HttpStatus.CREATED,
        type: UserResponseDto,
    })
    async createUser(
        @Body() body: CreateUserBodyDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.createUser(body, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: UpdateUserCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async updateUser(
        @Body() body: UpdateUserBodyDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.updateUser(body, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: DeleteUserCommand,
        httpCode: HttpStatus.NO_CONTENT,
    })
    async deleteUser(
        @Param() param: DeleteUserParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ) {
        const result = await this.usersService.deleteUser(param.userId, broker);

        errorHandler(result);
        return;
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUsersCommand,
        httpCode: HttpStatus.OK,
        type: GetUsersResponseDto,
    })
    async getUsers(
        @Query() query: GetUsersQueryDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<GetUsersResponseDto> {
        const { start, size, filters, filterModes, globalFilterMode, sorting } = query;

        const result = await this.usersService.getAllUsers(
            {
                start,
                size,
                filters,
                filterModes,
                globalFilterMode,
                sorting,
            },
            broker,
        );

        const data = errorHandler(result);
        return {
            response: new GetAllUsersResponseModel({
                total: data.total,
                users: data.users.map(
                    (item) => new GetFullUserResponseModel(item, this.subPublicDomain),
                ),
            }),
        };
    }

    @Endpoint({
        command: GetUsersStreamCommand,
        httpCode: HttpStatus.OK,
        type: GetUsersStreamResponseDto,
    })
    async getUsersStream(
        @Query() query: GetUsersStreamQueryDto,
    ): Promise<GetUsersStreamResponseDto> {
        const result = await this.usersService.getUsersStream(query);

        const data = errorHandler(result);
        return {
            response: new GetUsersStreamResponseModel({
                users: data.users.map(
                    (item) => new GetFullUserResponseModel(item, this.subPublicDomain),
                ),
                nextCursor: data.nextCursor,
                hasMore: data.hasMore,
            }),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUsersTagsCommand,
        httpCode: HttpStatus.OK,
        type: GetUsersTagsResponseDto,
    })
    async getUsersTags(
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<GetUsersTagsResponseDto> {
        const result = await this.usersService.getAllTags(broker);

        const data = errorHandler(result);
        return {
            response: new GetAllTagsResponseModel({
                tags: data,
            }),
        };
    }

    @Endpoint({
        command: GetUserAccessibleNodesCommand,
        httpCode: HttpStatus.OK,
        type: GetUserAccessibleNodesResponseDto,
    })
    async getUserAccessibleNodes(
        @Param() param: GetUserAccessibleNodesParamDto,
    ): Promise<GetUserAccessibleNodesResponseDto> {
        const result = await this.usersService.getUserAccessibleNodes(param.userId);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUserSubscriptionRequestHistoryCommand,
        httpCode: HttpStatus.OK,
        type: GetUserSubscriptionRequestHistoryResponseDto,
    })
    async getUserSubscriptionRequestHistory(
        @Param() param: GetUserSubscriptionRequestHistoryParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<GetUserSubscriptionRequestHistoryResponseDto> {
        const result = await this.usersService.getUserSubscriptionRequestHistory(
            param.userId,
            broker,
        );

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    /* get by methods




    */

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUserByShortUuidCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async getUserByShortUuid(
        @Param() param: GetUserByShortUuidParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.getUserByUniqueFields(
            { shortUuid: param.shortUuid },
            broker,
        );

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUserByIdCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async getUserById(
        @Param() param: GetUserByIdParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.getUserByUniqueFields(
            { id: BigInt(param.userId) },
            broker,
        );

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: GetUserByUsernameCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async getUserByUsername(
        @Param() param: GetUserByUsernameParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.getUserByUniqueFields(
            { username: param.username },
            broker,
        );

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    /* actions methods


    */

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: RevokeUserSubscriptionCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async revokeUserSubscription(
        @Param() param: RevokeUserSubscriptionParamDto,
        @Body() body: RevokeUserSubscriptionBodyDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.revokeUserSubscription(param.userId, body, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: DisableUserCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async disableUser(
        @Param() param: DisableUserParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.disableUser(param.userId, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: EnableUserCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async enableUser(
        @Param() param: EnableUserParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.enableUser(param.userId, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: ResetUserTrafficCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async resetUserTraffic(
        @Param() param: ResetUserTrafficParamDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.resetUserTraffic(param.userId, broker);

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Roles(ROLE.ADMIN, ROLE.API, ROLE.BROKER)
    @Endpoint({
        command: ExtendUserCommand,
        httpCode: HttpStatus.OK,
        type: UserResponseDto,
    })
    async extendUserExpirationDate(
        @Param() param: ExtendUserParamDto,
        @Body() body: ExtendUserBodyDto,
        @GetBroker() broker: BrokerEntity | undefined,
    ): Promise<UserResponseDto> {
        const result = await this.usersService.extendUserExpirationDate(
            param.userId,
            body.days,
            broker,
        );

        const data = errorHandler(result);
        return {
            response: new GetFullUserResponseModel(data, this.subPublicDomain),
        };
    }

    @Endpoint({
        command: ResolveUserCommand,
        httpCode: HttpStatus.OK,
        type: ResolveUserResponseDto,
    })
    async resolveUser(@Body() body: ResolveUserBodyDto): Promise<ResolveUserResponseDto> {
        const result = await this.usersService.resolveUser(body);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }
}
