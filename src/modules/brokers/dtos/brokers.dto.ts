import { createZodDto } from 'nestjs-zod';

import {
    CreateBrokerCommand,
    DeleteBrokerCommand,
    GetBrokerCommand,
    GetBrokerMeCommand,
    GetBrokersCommand,
    ResetBrokerTrafficCommand,
    UpdateBrokerCommand,
} from '@libs/contracts/commands';

export class CreateBrokerBodyDto extends createZodDto(CreateBrokerCommand.RequestBodySchema) {}
export class UpdateBrokerBodyDto extends createZodDto(UpdateBrokerCommand.RequestBodySchema) {}
export class GetBrokerParamDto extends createZodDto(GetBrokerCommand.RequestParamSchema) {}
export class DeleteBrokerParamDto extends createZodDto(DeleteBrokerCommand.RequestParamSchema) {}
export class ResetBrokerTrafficParamDto extends createZodDto(
    ResetBrokerTrafficCommand.RequestParamSchema,
) {}

export class BrokerResponseDto extends createZodDto(GetBrokerCommand.ResponseSchema) {}
export class GetBrokersResponseDto extends createZodDto(GetBrokersCommand.ResponseSchema) {}
export class GetBrokerMeResponseDto extends createZodDto(GetBrokerMeCommand.ResponseSchema) {}
