import { Module } from '@nestjs/common';

import { UmijiServiceService } from './umiji-service.service';

@Module({
    imports: [],
    controllers: [],
    providers: [UmijiServiceService],
})
export class UmijiServiceModule {}
