import { Request, Response, NextFunction } from 'express';

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { UmijiSettingsEntity } from '@modules/umiji-settings/entities';
import { GetCachedUmijiSettingsQuery } from '@modules/umiji-settings/queries/get-cached-umiji-settings/get-cached-umiji-settings.query';

@Injectable()
export class InjectUmijiSettingsMiddleware implements NestMiddleware {
    private readonly logger = new Logger(InjectUmijiSettingsMiddleware.name);
    constructor(private readonly queryBus: QueryBus) {}

    async use(
        req: { umijiSettings: UmijiSettingsEntity } & Request,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const umijiSettings = await this.queryBus.execute(new GetCachedUmijiSettingsQuery());

            req.umijiSettings = umijiSettings;

            next();
        } catch (error) {
            next(error);
        }
    }
}
