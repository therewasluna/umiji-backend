import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { AxiosService } from '@common/axios';
import { RawCacheService } from '@common/raw-cache';
import { fail, ok, TResult } from '@common/types';
import { StartNodeInstallCommand, TNodeInstallState } from '@libs/contracts/commands';
import { ERRORS } from '@libs/contracts/constants';

import { GetConfigProfileByUuidQuery } from '@modules/config-profiles/queries/get-config-profile-by-uuid';
import { KeygenService } from '@modules/keygen/keygen.service';
import { NodesService } from '@modules/nodes/nodes.service';
import { NodesRepository } from '@modules/nodes/repositories/nodes.repository';

import { NodeInstallRunner } from './node-install.runner';

const STATE_TTL_SECONDS = 60 * 60;
const LOCK_TTL_SECONDS = 30 * 60;
// The runner saves at least every 5s; a running install that stops saving lost its API process.
const STALE_AFTER_MS = 60_000;

const stateKey = (id: string) => `node_install:${id}`;
const lockKey = (address: string) => `node_install_lock:${address}`;

@Injectable()
export class NodeInstallService {
    private readonly logger = new Logger(NodeInstallService.name);
    // The API talks to nodes only here, so the mTLS client is set up on first use.
    private nodeClientReady: null | Promise<void> = null;

    constructor(
        private readonly rawCacheService: RawCacheService,
        private readonly queryBus: QueryBus,
        private readonly axiosService: AxiosService,
        private readonly keygenService: KeygenService,
        private readonly nodesRepository: NodesRepository,
        private readonly nodesService: NodesService,
    ) {}

    public async start(
        body: StartNodeInstallCommand.RequestBody,
    ): Promise<TResult<{ id: string }>> {
        try {
            const node = {
                ...body.node,
                name: body.node.name.trim(),
                address: body.node.address.trim(),
            };

            // Catch what would make the final "add to panel" step fail before spending minutes on the install.
            if ((await this.nodesRepository.findByCriteria({ name: node.name })).length > 0) {
                return fail(ERRORS.NODE_NAME_ALREADY_EXISTS);
            }

            if ((await this.nodesRepository.findByCriteria({ address: node.address })).length > 0) {
                return fail(ERRORS.NODE_ADDRESS_ALREADY_EXISTS);
            }

            const profile = await this.queryBus.execute(
                new GetConfigProfileByUuidQuery(node.configProfile.activeConfigProfileUuid),
            );

            if (!profile.isOk) {
                return fail(ERRORS.CONFIG_PROFILE_NOT_FOUND);
            }

            const inboundsBelongToProfile = node.configProfile.activeInbounds.every((uuid) =>
                profile.response.inbounds.some((inbound) => inbound.uuid === uuid),
            );

            if (!inboundsBelongToProfile) {
                return fail(ERRORS.CONFIG_PROFILE_INBOUND_NOT_FOUND_IN_SPECIFIED_PROFILE);
            }

            const secret = await this.keygenService.generateKey();

            if (!secret.isOk) {
                return fail(ERRORS.KEYPAIR_NOT_FOUND);
            }

            const id = randomUUID();

            const runner = new NodeInstallRunner(
                id,
                { node, ssh: body.ssh },
                {
                    secretKey: secret.response.payload,
                    save: (state) =>
                        this.rawCacheService.set(stateKey(id), state, STATE_TTL_SECONDS),
                    checkHealth: async () => {
                        await this.ensureNodeClient();

                        const health = await this.axiosService.getNodeHealth({
                            address: node.address,
                            port: node.port,
                            proxyUrl: node.proxyUrl ?? null,
                        });

                        return health.isOk;
                    },
                    createNode: () => this.nodesService.createNode(node),
                },
            );

            const lock = lockKey(node.address);

            if ((await this.rawCacheService.incrementWithTtl(lock, LOCK_TTL_SECONDS)) > 1) {
                return fail(ERRORS.NODE_INSTALL_ALREADY_RUNNING);
            }

            try {
                await runner.save();
            } catch (error) {
                await this.rawCacheService.del(lock);
                throw error;
            }

            void runner
                .run()
                .catch((error) => this.logger.error(`Node install ${id} crashed: ${error}`))
                .finally(() => void this.rawCacheService.del(lock));

            return ok({ id });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.START_NODE_INSTALL_ERROR);
        }
    }

    private ensureNodeClient(): Promise<void> {
        this.nodeClientReady ??= this.axiosService.setJwt().catch((error) => {
            this.nodeClientReady = null;
            throw error;
        });

        return this.nodeClientReady;
    }

    public async get(id: string): Promise<TResult<TNodeInstallState>> {
        try {
            const state = await this.rawCacheService.get<TNodeInstallState>(stateKey(id));

            if (!state) {
                return fail(ERRORS.NODE_INSTALL_NOT_FOUND);
            }

            if (state.status === 'running' && Date.now() - state.updatedAt > STALE_AFTER_MS) {
                return ok({
                    ...state,
                    status: 'failed',
                    error: { code: 'INTERRUPTED', message: 'The installer stopped responding' },
                });
            }

            return ok(state);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.NODE_INSTALL_NOT_FOUND);
        }
    }
}
