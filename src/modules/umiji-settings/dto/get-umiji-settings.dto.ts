import { createZodDto } from 'nestjs-zod';

import { GetUmijiSettingsCommand } from '@libs/contracts/commands';

export class GetUmijiSettingsResponseDto extends createZodDto(
    GetUmijiSettingsCommand.ResponseSchema,
) {}
