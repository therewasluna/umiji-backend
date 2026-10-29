import { Body, Controller, HttpStatus, Param, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { GetBroker } from '@common/decorators/get-broker';
import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { BROKER_BOT_CONTROLLER, CONTROLLERS_INFO } from '@libs/contracts/api';
import {
    ConnectBrokerBotCommand,
    CreateBrokerBotBroadcastCommand,
    GetBrokerBotBroadcastsCommand,
    CreateBrokerBotCategoryCommand,
    CreateBrokerBotPlanCommand,
    DecideBrokerBotOrderCommand,
    DeleteBrokerBotCategoryCommand,
    DeleteBrokerBotPlanCommand,
    DisconnectBrokerBotCommand,
    GetBrokerBotCommand,
    GetBrokerBotOrdersCommand,
    GetBrokerBotReceiptCommand,
    TopUpBrokerBotWalletCommand,
    UpdateBrokerBotPlanCommand,
    UpdateBrokerBotSettingsCommand,
} from '@libs/contracts/commands';
import { ROLE } from '@libs/contracts/constants';

import { BrokerEntity } from '@modules/brokers/entities';

import { BrokerBotService } from './broker-bot.service';
import {
    BrokerBotResponseDto,
    CreateBrokerBotBroadcastBodyDto,
    CreateBrokerBotBroadcastResponseDto,
    GetBrokerBotBroadcastsResponseDto,
    ConnectBrokerBotBodyDto,
    CreateBrokerBotCategoryBodyDto,
    CreateBrokerBotPlanBodyDto,
    DecideBrokerBotOrderBodyDto,
    DecideBrokerBotOrderParamDto,
    DecideBrokerBotOrderResponseDto,
    DeleteBrokerBotCategoryParamDto,
    DeleteBrokerBotPlanParamDto,
    GetBrokerBotOrdersQueryDto,
    GetBrokerBotOrdersResponseDto,
    GetBrokerBotReceiptParamDto,
    GetBrokerBotReceiptResponseDto,
    TopUpBrokerBotWalletBodyDto,
    TopUpBrokerBotWalletResponseDto,
    UpdateBrokerBotPlanBodyDto,
    UpdateBrokerBotSettingsBodyDto,
} from './dtos';

/** The Telegram store bot of the broker making the request. */
@ApiBearerAuth('Authorization')
@ApiTags(CONTROLLERS_INFO.BROKER_BOT.tag)
@Roles(ROLE.BROKER)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(BROKER_BOT_CONTROLLER)
export class BrokerBotController {
    constructor(private readonly brokerBotService: BrokerBotService) {}

    @Endpoint({
        command: GetBrokerBotCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async getBot(@GetBroker() broker: BrokerEntity): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.getBot(broker)) };
    }

    @Endpoint({
        command: ConnectBrokerBotCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async connect(
        @GetBroker() broker: BrokerEntity,
        @Body() body: ConnectBrokerBotBodyDto,
    ): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.connect(broker, body)) };
    }

    @Endpoint({
        command: DisconnectBrokerBotCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async disconnect(@GetBroker() broker: BrokerEntity): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.disconnect(broker)) };
    }

    @Endpoint({
        command: UpdateBrokerBotSettingsCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async updateSettings(
        @GetBroker() broker: BrokerEntity,
        @Body() body: UpdateBrokerBotSettingsBodyDto,
    ): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.updateSettings(broker, body)) };
    }

    @Endpoint({
        command: CreateBrokerBotPlanCommand,
        httpCode: HttpStatus.CREATED,
        type: BrokerBotResponseDto,
    })
    async createPlan(
        @GetBroker() broker: BrokerEntity,
        @Body() body: CreateBrokerBotPlanBodyDto,
    ): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.createPlan(broker, body)) };
    }

    @Endpoint({
        command: UpdateBrokerBotPlanCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async updatePlan(
        @GetBroker() broker: BrokerEntity,
        @Body() body: UpdateBrokerBotPlanBodyDto,
    ): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.updatePlan(broker, body)) };
    }

    @Endpoint({
        command: DeleteBrokerBotPlanCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async deletePlan(
        @GetBroker() broker: BrokerEntity,
        @Param() param: DeleteBrokerBotPlanParamDto,
    ): Promise<BrokerBotResponseDto> {
        return { response: errorHandler(await this.brokerBotService.deletePlan(broker, param.id)) };
    }

    @Endpoint({
        command: CreateBrokerBotCategoryCommand,
        httpCode: HttpStatus.CREATED,
        type: BrokerBotResponseDto,
    })
    async createCategory(
        @GetBroker() broker: BrokerEntity,
        @Body() body: CreateBrokerBotCategoryBodyDto,
    ): Promise<BrokerBotResponseDto> {
        return {
            response: errorHandler(await this.brokerBotService.createCategory(broker, body.title)),
        };
    }

    @Endpoint({
        command: DeleteBrokerBotCategoryCommand,
        httpCode: HttpStatus.OK,
        type: BrokerBotResponseDto,
    })
    async deleteCategory(
        @GetBroker() broker: BrokerEntity,
        @Param() param: DeleteBrokerBotCategoryParamDto,
    ): Promise<BrokerBotResponseDto> {
        return {
            response: errorHandler(await this.brokerBotService.deleteCategory(broker, param.id)),
        };
    }

    @Endpoint({
        command: GetBrokerBotOrdersCommand,
        httpCode: HttpStatus.OK,
        type: GetBrokerBotOrdersResponseDto,
    })
    async getOrders(
        @GetBroker() broker: BrokerEntity,
        @Query() query: GetBrokerBotOrdersQueryDto,
    ): Promise<GetBrokerBotOrdersResponseDto> {
        return { response: errorHandler(await this.brokerBotService.getOrders(broker, query)) };
    }

    @Endpoint({
        command: DecideBrokerBotOrderCommand,
        httpCode: HttpStatus.OK,
        type: DecideBrokerBotOrderResponseDto,
    })
    async decideOrder(
        @GetBroker() broker: BrokerEntity,
        @Param() param: DecideBrokerBotOrderParamDto,
        @Body() body: DecideBrokerBotOrderBodyDto,
    ): Promise<DecideBrokerBotOrderResponseDto> {
        return {
            response: errorHandler(await this.brokerBotService.decideOrder(broker, param.id, body)),
        };
    }

    @Endpoint({
        command: GetBrokerBotReceiptCommand,
        httpCode: HttpStatus.OK,
        type: GetBrokerBotReceiptResponseDto,
    })
    async getReceipt(
        @GetBroker() broker: BrokerEntity,
        @Param() param: GetBrokerBotReceiptParamDto,
    ): Promise<GetBrokerBotReceiptResponseDto> {
        return { response: errorHandler(await this.brokerBotService.getReceipt(broker, param.id)) };
    }

    @Endpoint({
        command: TopUpBrokerBotWalletCommand,
        httpCode: HttpStatus.OK,
        type: TopUpBrokerBotWalletResponseDto,
    })
    async topUp(
        @GetBroker() broker: BrokerEntity,
        @Body() body: TopUpBrokerBotWalletBodyDto,
    ): Promise<TopUpBrokerBotWalletResponseDto> {
        return { response: errorHandler(await this.brokerBotService.topUp(broker, body)) };
    }

    @Roles(ROLE.ADMIN)
    @Endpoint({
        command: GetBrokerBotBroadcastsCommand,
        httpCode: HttpStatus.OK,
        type: GetBrokerBotBroadcastsResponseDto,
    })
    async getBroadcasts(): Promise<GetBrokerBotBroadcastsResponseDto> {
        return { response: errorHandler(await this.brokerBotService.getBroadcasts()) };
    }

    @Roles(ROLE.ADMIN)
    @Endpoint({
        command: CreateBrokerBotBroadcastCommand,
        httpCode: HttpStatus.CREATED,
        type: CreateBrokerBotBroadcastResponseDto,
    })
    async createBroadcast(
        @Body() body: CreateBrokerBotBroadcastBodyDto,
    ): Promise<CreateBrokerBotBroadcastResponseDto> {
        return { response: errorHandler(await this.brokerBotService.createBroadcast(body)) };
    }
}
