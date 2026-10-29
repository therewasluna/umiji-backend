import { DropUsersConnectionsCommand } from '@umiji/node-contract';

import { INodeConnectionOpts } from '@common/axios';

export interface IDropUsersConnectionsPayload {
    data: DropUsersConnectionsCommand.Request;
    node: INodeConnectionOpts;
}
