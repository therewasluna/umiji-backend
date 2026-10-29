import { RemoveUsersCommand } from '@umiji/node-contract';

import { INodeConnectionOpts } from '@common/axios';

export interface IRemoveUsersFromNodePayload {
    data: RemoveUsersCommand.Request;
    node: INodeConnectionOpts;
}
