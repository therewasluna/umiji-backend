// Type-only: decorator metadata would otherwise look for an interface at runtime.
import type { TgUpdate } from './bot/broker-bot.handler';

import {
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { BROKER_BOT_CONTROLLER, BROKER_BOT_ROUTES } from '@libs/contracts/api';

import { BrokerBotPoller } from './broker-bot.poller';

/**
 * Telegram posts broker bot updates here when BROKER_BOT_WEBHOOK_DOMAIN is set. No JWT: the
 * secret header is the auth. An error answers 500 so Telegram resends; a repeat is skipped.
 */
@ApiExcludeController()
@Controller(BROKER_BOT_CONTROLLER)
export class BrokerBotWebhookController {
    constructor(private readonly poller: BrokerBotPoller) {}

    @Post(BROKER_BOT_ROUTES.WEBHOOK(':brokerUuid'))
    @HttpCode(HttpStatus.OK)
    async webhook(
        @Param('brokerUuid', ParseUUIDPipe) brokerUuid: string,
        @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
        @Body() update: TgUpdate,
    ): Promise<void> {
        if (!(await this.poller.handleWebhook(brokerUuid, secret, update))) {
            throw new UnauthorizedException();
        }
    }
}
