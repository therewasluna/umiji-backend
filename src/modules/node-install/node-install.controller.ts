import { CONTROLLERS_INFO, NODE_INSTALL_CONTROLLER } from '@contract/api';
import { ROLE } from '@contract/constants';

import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles/roles.guard';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { GetNodeInstallCommand, StartNodeInstallCommand } from '@libs/contracts/commands';

import {
    GetNodeInstallParamDto,
    GetNodeInstallResponseDto,
    StartNodeInstallBodyDto,
    StartNodeInstallResponseDto,
} from './dtos';
import { NodeInstallService } from './node-install.service';

// Admins only: the request carries a server's root password, so API tokens can't use it.
@ApiBearerAuth('Authorization')
@ApiExcludeController()
@ApiTags(CONTROLLERS_INFO.NODE_INSTALL.tag)
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(NODE_INSTALL_CONTROLLER)
export class NodeInstallController {
    constructor(private readonly nodeInstallService: NodeInstallService) {}

    @Endpoint({
        command: StartNodeInstallCommand,
        httpCode: HttpStatus.CREATED,
        type: StartNodeInstallResponseDto,
    })
    async start(@Body() body: StartNodeInstallBodyDto): Promise<StartNodeInstallResponseDto> {
        const result = await this.nodeInstallService.start(body);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        command: GetNodeInstallCommand,
        httpCode: HttpStatus.OK,
        type: GetNodeInstallResponseDto,
    })
    async get(@Param() param: GetNodeInstallParamDto): Promise<GetNodeInstallResponseDto> {
        const result = await this.nodeInstallService.get(param.id);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }
}
