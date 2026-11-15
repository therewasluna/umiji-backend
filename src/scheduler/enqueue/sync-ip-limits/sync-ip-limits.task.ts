import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { NodesQueuesService } from '@queue/_nodes';

import { JOBS_INTERVALS } from '../../intervals';

@Injectable()
export class SyncIpLimitsTask {
    private static readonly CRON_NAME = 'syncIpLimits';
    private readonly logger = new Logger(SyncIpLimitsTask.name);

    constructor(private readonly nodesQueuesService: NodesQueuesService) {}

    @Cron(JOBS_INTERVALS.SYNC_IP_LIMITS, {
        name: SyncIpLimitsTask.CRON_NAME,
        waitForCompletion: true,
    })
    async handleCron() {
        try {
            await this.nodesQueuesService.syncIpLimits();
        } catch (error) {
            this.logger.error(error);
        }
    }
}
