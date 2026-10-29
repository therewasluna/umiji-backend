import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { QUERIES } from './queries';
import { UmijiSettingsController } from './umiji-settings.controller';
import { UmijiSettingsService } from './umiji-settings.service';
import { UmijiSettingsRepository } from './repositories/umiji-settings.repository';

@Module({
    imports: [CqrsModule],
    controllers: [UmijiSettingsController],
    providers: [UmijiSettingsService, UmijiSettingsRepository, ...QUERIES],
})
export class UmijiSettingsModule {}
