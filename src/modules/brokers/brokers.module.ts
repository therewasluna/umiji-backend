import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { BrokersController } from './brokers.controller';
import { BrokersService } from './brokers.service';
import { QUERIES } from './queries';
import { BrokersRepository } from './repositories';

@Module({
    imports: [CqrsModule],
    controllers: [BrokersController],
    providers: [BrokersRepository, BrokersService, ...QUERIES],
})
export class BrokersModule {}
