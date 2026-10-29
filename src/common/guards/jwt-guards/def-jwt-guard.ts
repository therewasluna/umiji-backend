import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { AuthGuard } from '@nestjs/passport';

import { HttpExceptionWithErrorCodeType } from '@common/exception/http-exeception-with-error-code.type';
import { RawCacheService } from '@common/raw-cache';
import { TResult } from '@common/types';
import {
    ERRORS,
    UMIJI_CLIENT_TYPE_BROWSER,
    UMIJI_CLIENT_TYPE_HEADER,
    ROLE,
} from '@libs/contracts/constants';

import { AdminEntity } from '@modules/admin/entities/admin.entity';
import { GetAdminByUsernameQuery } from '@modules/admin/queries/get-admin-by-username';
import { ApiTokenEntity } from '@modules/api-tokens/entities/api-token.entity';
import { GetTokenByUuidQuery } from '@modules/api-tokens/queries/get-token-by-uuid';
import type { IJWTAuthPayload } from '@modules/auth/interfaces';
import { BrokerEntity } from '@modules/brokers/entities';
import { GetBrokerByUuidQuery } from '@modules/brokers/queries/get-broker-by-uuid';

@Injectable()
export class JwtDefaultGuard extends AuthGuard('registeredUserJWT') {
    constructor(
        private readonly rawCacheService: RawCacheService,
        private readonly queryBus: QueryBus,
    ) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isJwtValid = await super.canActivate(context);
        if (!isJwtValid) {
            return false;
        }

        const { user } = context.switchToHttp().getRequest<{ user: IJWTAuthPayload }>();

        if (!user || !user.role || !user.uuid) {
            return false;
        }

        switch (user.role) {
            case ROLE.API: {
                return await this.verifyApiToken(user, user.uuid);
            }

            case ROLE.ADMIN: {
                const headers = context.switchToHttp().getRequest().headers;

                const clientType = headers[UMIJI_CLIENT_TYPE_HEADER.toLowerCase()];

                if (clientType !== UMIJI_CLIENT_TYPE_BROWSER) {
                    throw new ForbiddenException(
                        'For API requests you must create own API-token in the admin dashboard.',
                    );
                }

                if (!user.username) {
                    return false;
                }

                const adminEntity = await this.getAdminByUsername({
                    username: user.username,
                    role: user.role,
                });

                if (!adminEntity.isOk) {
                    return false;
                }

                if (adminEntity.response.uuid !== user.uuid) {
                    return false;
                }
                return true;
            }

            case ROLE.BROKER: {
                return await this.verifyBroker(context, user);
            }
            default:
                return false;
        }
    }

    private async getAdminByUsername(dto: GetAdminByUsernameQuery): Promise<TResult<AdminEntity>> {
        return this.queryBus.execute<GetAdminByUsernameQuery, TResult<AdminEntity>>(
            new GetAdminByUsernameQuery(dto.username, dto.role),
        );
    }

    private async verifyBroker(context: ExecutionContext, user: IJWTAuthPayload): Promise<boolean> {
        const { headers, method } = context.switchToHttp().getRequest();

        if (headers[UMIJI_CLIENT_TYPE_HEADER.toLowerCase()] !== UMIJI_CLIENT_TYPE_BROWSER) {
            throw new ForbiddenException('Brokers can only use the panel from the browser.');
        }

        if (!user.username || !user.uuid) {
            return false;
        }

        // Re-read on every request so disabling, expiring or deleting a broker takes effect immediately.
        const adminEntity = await this.getAdminByUsername({
            username: user.username,
            role: ROLE.BROKER,
        });

        if (!adminEntity.isOk || adminEntity.response.uuid !== user.uuid) {
            return false;
        }

        const broker = await this.queryBus.execute<GetBrokerByUuidQuery, TResult<BrokerEntity>>(
            new GetBrokerByUuidQuery(user.uuid),
        );

        if (!broker.isOk) {
            return false;
        }

        if (broker.response.isDisabled) {
            throw new HttpExceptionWithErrorCodeType(
                ERRORS.BROKER_ACCOUNT_INACTIVE.message,
                ERRORS.BROKER_ACCOUNT_INACTIVE.code,
                ERRORS.BROKER_ACCOUNT_INACTIVE.httpCode,
            );
        }

        // An expired broker keeps read access; every write is refused here, in one place.
        if (broker.response.isExpired && method !== 'GET' && method !== 'HEAD') {
            throw new HttpExceptionWithErrorCodeType(
                ERRORS.BROKER_ACCOUNT_EXPIRED.message,
                ERRORS.BROKER_ACCOUNT_EXPIRED.code,
                ERRORS.BROKER_ACCOUNT_EXPIRED.httpCode,
            );
        }

        user.broker = broker.response;
        return true;
    }

    private async getTokenByUuid(dto: GetTokenByUuidQuery): Promise<TResult<ApiTokenEntity>> {
        return this.queryBus.execute<GetTokenByUuidQuery, TResult<ApiTokenEntity>>(
            new GetTokenByUuidQuery(dto.uuid),
        );
    }

    private async verifyApiToken(user: IJWTAuthPayload, apiTokenUuid: string): Promise<boolean> {
        const cached = await this.rawCacheService.get<string[]>(`api:${apiTokenUuid}`, true);
        if (cached) {
            user.scopes = cached;
            return true;
        }

        const token = await this.getTokenByUuid({ uuid: apiTokenUuid });
        if (!token.isOk) {
            return false;
        }

        const scopes = token.response.scopes ?? [];

        await this.rawCacheService.set(`api:${apiTokenUuid}`, scopes, 3600);
        user.scopes = scopes;
        return true;
    }
}
