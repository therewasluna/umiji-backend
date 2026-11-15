import { z } from 'zod';

import { NODE_INSTALL_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { CreateNodeCommand } from '../nodes/create.command';

export namespace StartNodeInstallCommand {
    export const url = REST_API.NODE_INSTALL.START;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        NODE_INSTALL_ROUTES.START,
        'post',
        'Install the node on a server over SSH, then add it to the panel',
        { scope: 'node-install', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        node: CreateNodeCommand.RequestBodySchema.extend({
            port: z.int().min(1).max(65535),
        }),
        ssh: z.object({
            port: z.int().min(1).max(65535),
            // Root password: used once for the SSH login, never stored or logged.
            password: z.string().min(1).max(1024),
        }),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            id: z.uuid(),
        }),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
