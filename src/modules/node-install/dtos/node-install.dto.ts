import { GetNodeInstallCommand, StartNodeInstallCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class StartNodeInstallBodyDto extends createZodDto(
    StartNodeInstallCommand.RequestBodySchema,
) {}

export class StartNodeInstallResponseDto extends createZodDto(
    StartNodeInstallCommand.ResponseSchema,
) {}

export class GetNodeInstallParamDto extends createZodDto(
    GetNodeInstallCommand.RequestParamSchema,
) {}

export class GetNodeInstallResponseDto extends createZodDto(GetNodeInstallCommand.ResponseSchema) {}
