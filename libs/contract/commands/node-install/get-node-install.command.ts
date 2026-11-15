import { z } from 'zod';

import { NODE_INSTALL_ROUTES, REST_API } from '../../api';
import { getEndpointDetails, NODE_INSTALL_ERROR_CODES, NODE_INSTALL_STEPS } from '../../constants';

export const NodeInstallStateSchema = z.object({
    id: z.uuid(),
    address: z.string(),
    name: z.string(),
    status: z.enum(['running', 'success', 'failed']),
    steps: z.array(
        z.object({
            id: z.enum(NODE_INSTALL_STEPS),
            status: z.enum(['pending', 'running', 'done', 'failed']),
            detail: z.string().nullable(),
            startedAt: z.number().nullable(),
            finishedAt: z.number().nullable(),
        }),
    ),
    log: z.array(z.string()),
    error: z
        .object({
            code: z.enum(NODE_INSTALL_ERROR_CODES),
            message: z.string(),
        })
        .nullable(),
    hostKey: z.string().nullable(),
    nodeUuid: z.uuid().nullable(),
    startedAt: z.number(),
    updatedAt: z.number(),
});

export type TNodeInstallState = z.infer<typeof NodeInstallStateSchema>;

export namespace GetNodeInstallCommand {
    export const url = REST_API.NODE_INSTALL.GET;
    export const TSQ_url = url(':id');

    export const endpointDetails = getEndpointDetails(
        NODE_INSTALL_ROUTES.GET(':id'),
        'get',
        'Get the progress of a node installation',
        { scope: 'node-install', kind: 'read' },
    );

    export const RequestParamSchema = z.object({
        id: z.uuid(),
    });

    export const ResponseSchema = z.object({
        response: NodeInstallStateSchema,
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
