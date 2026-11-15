import { createZodDto } from 'nestjs-zod';

import { LoginCommand } from '@libs/contracts/commands';

export class LoginBodyDto extends createZodDto(
    LoginCommand.RequestBodySchema.extend({
        username: LoginCommand.RequestBodySchema.shape.username.min(1).max(128),
        password: LoginCommand.RequestBodySchema.shape.password.min(1).max(256),
    }),
) {}
export class LoginResponseDto extends createZodDto(LoginCommand.ResponseSchema) {}
