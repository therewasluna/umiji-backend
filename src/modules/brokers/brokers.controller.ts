import { Body, Controller, HttpStatus, Param, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Endpoint } from '@common/decorators/base-endpoint';
import { GetBroker } from '@common/decorators/get-broker';
import { Roles } from '@common/decorators/roles/roles';
import { HttpExceptionFilter } from '@common/exception/http-exception.filter';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { errorHandler } from '@common/helpers/error-handler.helper';
import { BROKERS_CONTROLLER, CONTROLLERS_INFO } from '@libs/contracts/api';
import {
    CreateBrokerCommand,
    DeleteBrokerCommand,
    GetBrokerCommand,
    GetBrokerMeCommand,
    GetBrokersCommand,
    ResetBrokerTrafficCommand,
    UpdateBrokerCommand,
} from '@libs/contracts/commands';
import { ROLE } from '@libs/contracts/constants';

import { BrokersService } from './brokers.service';
import {
    BrokerResponseDto,
    CreateBrokerBodyDto,
    DeleteBrokerParamDto,
    GetBrokerMeResponseDto,
    GetBrokerParamDto,
    GetBrokersResponseDto,
    ResetBrokerTrafficParamDto,
    UpdateBrokerBodyDto,
} from './dtos';
import { BrokerEntity } from './entities';
import { GetBrokerResponseModel } from './models';

@ApiBearerAuth('Authorization')
@ApiTags(CONTROLLERS_INFO.BROKERS.tag)
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
@UseFilters(HttpExceptionFilter)
@Controller(BROKERS_CONTROLLER)
export class BrokersController {
    constructor(private readonly brokersService: BrokersService) {}

    // Declared before GET :uuid so "me" is not captured as a uuid.
    @Roles(ROLE.BROKER)
    @Endpoint({
        command: GetBrokerMeCommand,
        httpCode: HttpStatus.OK,
        type: GetBrokerMeResponseDto,
    })
    async getMe(@GetBroker() broker: BrokerEntity): Promise<GetBrokerMeResponseDto> {
        const result = await this.brokersService.getMe(broker);

        const data = errorHandler(result);
        return {
            response: data,
        };
    }

    @Endpoint({
        command: GetBrokersCommand,
        httpCode: HttpStatus.OK,
        type: GetBrokersResponseDto,
    })
    async getBrokers(): Promise<GetBrokersResponseDto> {
        const result = await this.brokersService.getBrokers();

        const data = errorHandler(result);
        return {
            response: {
                total: data.length,
                brokers: data.map((broker) => new GetBrokerResponseModel(broker)),
            },
        };
    }

    @Endpoint({
        command: GetBrokerCommand,
        httpCode: HttpStatus.OK,
        type: BrokerResponseDto,
    })
    async getBroker(@Param() param: GetBrokerParamDto): Promise<BrokerResponseDto> {
        const result = await this.brokersService.getBroker(param.uuid);

        const data = errorHandler(result);
        return {
            response: new GetBrokerResponseModel(data),
        };
    }

    @Endpoint({
        command: CreateBrokerCommand,
        httpCode: HttpStatus.CREATED,
        type: BrokerResponseDto,
    })
    async createBroker(@Body() body: CreateBrokerBodyDto): Promise<BrokerResponseDto> {
        const result = await this.brokersService.createBroker(body);

        const data = errorHandler(result);
        return {
            response: new GetBrokerResponseModel(data),
        };
    }

    @Endpoint({
        command: UpdateBrokerCommand,
        httpCode: HttpStatus.OK,
        type: BrokerResponseDto,
    })
    async updateBroker(@Body() body: UpdateBrokerBodyDto): Promise<BrokerResponseDto> {
        const result = await this.brokersService.updateBroker(body);

        const data = errorHandler(result);
        return {
            response: new GetBrokerResponseModel(data),
        };
    }

    @Endpoint({
        command: DeleteBrokerCommand,
        httpCode: HttpStatus.NO_CONTENT,
    })
    async deleteBroker(@Param() param: DeleteBrokerParamDto) {
        const result = await this.brokersService.deleteBroker(param.uuid);

        errorHandler(result);
        return;
    }

    @Endpoint({
        command: ResetBrokerTrafficCommand,
        httpCode: HttpStatus.OK,
        type: BrokerResponseDto,
    })
    async resetBrokerTraffic(
        @Param() param: ResetBrokerTrafficParamDto,
    ): Promise<BrokerResponseDto> {
        const result = await this.brokersService.resetBrokerTraffic(param.uuid);

        const data = errorHandler(result);
        return {
            response: new GetBrokerResponseModel(data),
        };
    }
}
