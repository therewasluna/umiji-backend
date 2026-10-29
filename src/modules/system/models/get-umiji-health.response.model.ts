import { RuntimeMetric } from '@common/runtime-metrics/interfaces';

export class GetUmijiHealthResponseModel {
    runtimeMetrics: RuntimeMetric[];

    constructor(data: RuntimeMetric[]) {
        this.runtimeMetrics = data;
    }
}
