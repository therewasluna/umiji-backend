import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { UmijiSettingsEntity } from '@modules/umiji-settings/entities';

export const GetUmijiSettings = createParamDecorator<UmijiSettingsEntity>(
    (data: unknown, ctx: ExecutionContext): UmijiSettingsEntity => {
        const request = ctx.switchToHttp().getRequest();
        return request.umijiSettings;
    },
);
