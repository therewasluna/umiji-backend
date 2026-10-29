import { createZodDto } from 'nestjs-zod';

import {
    ConnectBrokerBotCommand,
    CreateBrokerBotBroadcastCommand,
    GetBrokerBotBroadcastsCommand,
    CreateBrokerBotCategoryCommand,
    CreateBrokerBotPlanCommand,
    DecideBrokerBotOrderCommand,
    DeleteBrokerBotCategoryCommand,
    DeleteBrokerBotPlanCommand,
    GetBrokerBotCommand,
    GetBrokerBotOrdersCommand,
    GetBrokerBotReceiptCommand,
    TopUpBrokerBotWalletCommand,
    UpdateBrokerBotPlanCommand,
    UpdateBrokerBotSettingsCommand,
} from '@libs/contracts/commands';

export class ConnectBrokerBotBodyDto extends createZodDto(
    ConnectBrokerBotCommand.RequestBodySchema,
) {}
export class UpdateBrokerBotSettingsBodyDto extends createZodDto(
    UpdateBrokerBotSettingsCommand.RequestBodySchema,
) {}
export class CreateBrokerBotPlanBodyDto extends createZodDto(
    CreateBrokerBotPlanCommand.RequestBodySchema,
) {}
export class UpdateBrokerBotPlanBodyDto extends createZodDto(
    UpdateBrokerBotPlanCommand.RequestBodySchema,
) {}
export class DeleteBrokerBotPlanParamDto extends createZodDto(
    DeleteBrokerBotPlanCommand.RequestParamSchema,
) {}
export class CreateBrokerBotCategoryBodyDto extends createZodDto(
    CreateBrokerBotCategoryCommand.RequestBodySchema,
) {}
export class DeleteBrokerBotCategoryParamDto extends createZodDto(
    DeleteBrokerBotCategoryCommand.RequestParamSchema,
) {}
export class GetBrokerBotOrdersQueryDto extends createZodDto(
    GetBrokerBotOrdersCommand.RequestQuerySchema,
) {}
export class DecideBrokerBotOrderParamDto extends createZodDto(
    DecideBrokerBotOrderCommand.RequestParamSchema,
) {}
export class DecideBrokerBotOrderBodyDto extends createZodDto(
    DecideBrokerBotOrderCommand.RequestBodySchema,
) {}
export class GetBrokerBotReceiptParamDto extends createZodDto(
    GetBrokerBotReceiptCommand.RequestParamSchema,
) {}
export class TopUpBrokerBotWalletBodyDto extends createZodDto(
    TopUpBrokerBotWalletCommand.RequestBodySchema,
) {}

export class BrokerBotResponseDto extends createZodDto(GetBrokerBotCommand.ResponseSchema) {}
export class GetBrokerBotOrdersResponseDto extends createZodDto(
    GetBrokerBotOrdersCommand.ResponseSchema,
) {}
export class DecideBrokerBotOrderResponseDto extends createZodDto(
    DecideBrokerBotOrderCommand.ResponseSchema,
) {}
export class GetBrokerBotReceiptResponseDto extends createZodDto(
    GetBrokerBotReceiptCommand.ResponseSchema,
) {}
export class TopUpBrokerBotWalletResponseDto extends createZodDto(
    TopUpBrokerBotWalletCommand.ResponseSchema,
) {}

export class CreateBrokerBotBroadcastBodyDto extends createZodDto(
    CreateBrokerBotBroadcastCommand.RequestBodySchema,
) {}
export class CreateBrokerBotBroadcastResponseDto extends createZodDto(
    CreateBrokerBotBroadcastCommand.ResponseSchema,
) {}
export class GetBrokerBotBroadcastsResponseDto extends createZodDto(
    GetBrokerBotBroadcastsCommand.ResponseSchema,
) {}
