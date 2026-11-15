import { randomUUID } from 'node:crypto';

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';

import { RawCacheService } from '@common/raw-cache';
import { ok, TResult } from '@common/types';
import { BACKEND_TOOLS_JWT_ISSUER, BACKEND_TOOLS_JWT_SCOPES } from '@libs/contracts/constants';

import { SignOttTokenCommand } from './sign-ott-token.command';

interface IOttTokenPayload {
    jti: string;
    scope: string;
}

@CommandHandler(SignOttTokenCommand)
export class SignOttTokenHandler implements ICommandHandler<SignOttTokenCommand, TResult<string>> {
    constructor(
        private readonly jwtService: JwtService,
        private readonly rawCacheService: RawCacheService,
    ) {}

    async execute(): Promise<TResult<string>> {
        const jti = randomUUID();
        await this.rawCacheService.setString(`backend-tools:ott:${jti}`, '1', 30);
        const payload: IOttTokenPayload = {
            jti,
            scope: BACKEND_TOOLS_JWT_SCOPES.OTT,
        };

        return ok(
            this.jwtService.sign(payload, {
                expiresIn: '30s',
                issuer: BACKEND_TOOLS_JWT_ISSUER,
            }),
        );
    }
}
