import { createZodDto } from 'nestjs-zod';

import { UpdateUmijiSettingsCommand } from '@libs/contracts/commands';

export class UpdateUmijiSettingsBodyDto extends createZodDto(
    UpdateUmijiSettingsCommand.RequestBodySchema,
) {}

export class UpdateUmijiSettingsResponseDto extends createZodDto(
    UpdateUmijiSettingsCommand.ResponseSchema,
) {}
