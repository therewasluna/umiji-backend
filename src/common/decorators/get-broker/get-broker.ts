import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { IJWTAuthPayload } from '@modules/auth/interfaces';
import type { BrokerEntity } from '@modules/brokers/entities';

/** The broker making the request, or undefined for admins and API tokens. */
export const GetBroker = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): BrokerEntity | undefined => {
        return ctx.switchToHttp().getRequest<{ user?: IJWTAuthPayload }>().user?.broker;
    },
);
