import { AddUserCommand as AddUserToNodeCommandSdk } from '@umiji/node-contract';

import { INodeConnectionOpts } from '@common/axios';

export interface IAddUserToNodePayload {
    data: AddUserToNodeCommandSdk.Request;
    node: INodeConnectionOpts;
}
