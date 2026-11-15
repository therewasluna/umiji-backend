import { createZodDto } from 'nestjs-zod';

import {
    GetConnectionKeysByUserIdCommand,
    GetTelegramLinksByUserIdCommand,
} from '@libs/contracts/commands';

export class GetConnectionKeysByUserIdParamDto extends createZodDto(
    GetConnectionKeysByUserIdCommand.RequestParamSchema,
) {}

export class GetConnectionKeysByUserIdResponseDto extends createZodDto(
    GetConnectionKeysByUserIdCommand.ResponseSchema,
) {}

export class GetTelegramLinksByUserIdParamDto extends createZodDto(
    GetTelegramLinksByUserIdCommand.RequestParamSchema,
) {}

export class GetTelegramLinksByUserIdResponseDto extends createZodDto(
    GetTelegramLinksByUserIdCommand.ResponseSchema,
) {}
