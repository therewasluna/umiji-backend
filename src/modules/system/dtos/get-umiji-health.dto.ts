import { GetUmijiHealthCommand } from '@contract/commands';
import { createZodDto } from 'nestjs-zod';

export class GetUmijiHealthResponseDto extends createZodDto(
    GetUmijiHealthCommand.ResponseSchema,
) {}
