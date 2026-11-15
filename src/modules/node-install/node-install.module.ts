import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AxiosModule } from '@common/axios';

import { KeygenModule } from '@modules/keygen/keygen.module';
import { NodesModule } from '@modules/nodes/nodes.module';

import { NodeInstallController } from './node-install.controller';
import { NodeInstallService } from './node-install.service';

@Module({
    imports: [AxiosModule, CqrsModule, KeygenModule, NodesModule],
    controllers: [NodeInstallController],
    providers: [NodeInstallService],
})
export class NodeInstallModule {}
