import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { UsersModule } from '@modules/users/users.module';

import { BrokerBotHandler } from './bot/broker-bot.handler';
import { BrokerBotWebhookController } from './broker-bot-webhook.controller';
import { BrokerBotController } from './broker-bot.controller';
import { BrokerBotPoller } from './broker-bot.poller';
import { BrokerBotRepository } from './broker-bot.repository';
import { BrokerBotService } from './broker-bot.service';

@Module({
    imports: [CqrsModule, UsersModule, SubscriptionModule],
    controllers: [BrokerBotController, BrokerBotWebhookController],
    providers: [BrokerBotRepository, BrokerBotHandler, BrokerBotService, BrokerBotPoller],
})
export class BrokerBotModule {}
