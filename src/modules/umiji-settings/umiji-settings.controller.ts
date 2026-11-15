import { CONTROLLERS_INFO, UMIJI_SETTINGS_CONTROLLER } from '@contract/api';
import { ROLE } from '@contract/constants';

import { Body, Controller, HttpStatus, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { GetUmijiSettingsCommand, UpdateUmijiSettingsCommand } from '@libs/contracts/commands';

import {
    GetUmijiSettingsResponseDto,
    UpdateUmijiSettingsBodyDto,
    UpdateUmijiSettingsResponseDto,
} from './dto';
import { UmijiSettingsResponseModel } from './models/get-umiji-settings.response.model';
import { UmijiSettingsService } from './umiji-settings.service';

@ApiBearerAuth('Authorization')
@ApiTags(CONTROLLERS_INFO.UMIJI_SETTINGS.tag)
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(UMIJI_SETTINGS_CONTROLLER)
export class UmijiSettingsController {
    constructor(private readonly umijiSettingsService: UmijiSettingsService) {}

    @Endpoint({
        command: GetUmijiSettingsCommand,
        httpCode: HttpStatus.OK,
        type: GetUmijiSettingsResponseDto,
    })
    async getSettings(): Promise<GetUmijiSettingsResponseDto> {
        const result = await this.umijiSettingsService.getSettingsFromController();

        const data = errorHandler(result);
        return {
            response: new UmijiSettingsResponseModel(data),
        };
    }

    @Endpoint({
        command: UpdateUmijiSettingsCommand,
        httpCode: HttpStatus.OK,
        type: UpdateUmijiSettingsResponseDto,
    })
    async updateSettings(
        @Body() body: UpdateUmijiSettingsBodyDto,
    ): Promise<UpdateUmijiSettingsResponseDto> {
        const result = await this.umijiSettingsService.updateSettingsFromController(body);

        const data = errorHandler(result);
        return {
            response: new UmijiSettingsResponseModel(data),
        };
    }
}
