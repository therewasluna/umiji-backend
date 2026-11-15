import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { QUERIES } from './queries';
import { UmijiSettingsRepository } from './repositories/umiji-settings.repository';
import { UmijiSettingsController } from './umiji-settings.controller';
import { UmijiSettingsService } from './umiji-settings.service';

@Module({
    imports: [CqrsModule],
    controllers: [UmijiSettingsController],
    providers: [UmijiSettingsService, UmijiSettingsRepository, ...QUERIES],
})
export class UmijiSettingsModule {}
