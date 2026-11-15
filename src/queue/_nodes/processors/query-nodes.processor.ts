import { Job } from 'bullmq';
import pMap from 'p-map';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { AxiosService } from '@common/axios/axios.service';
import { TypedConfigService } from '@common/config/app-config';
import { RawCacheService } from '@common/raw-cache';
import { EXPORT_TO_STREAM_KEYS, INTERNAL_CACHE_KEYS } from '@libs/contracts/constants';
import { NODE_CONNECTIONS_STREAM_MESSAGE_VERSION } from '@libs/contracts/models';

import { NodesEntity } from '@modules/nodes';
import { FindNodesByCriteriaQuery } from '@modules/nodes/queries/find-nodes-by-criteria';
import { GetNodeByUuidQuery } from '@modules/nodes/queries/get-node-by-uuid';
import { GetOnlineNodesQuery } from '@modules/nodes/queries/get-online-nodes';
import { GetIpLimitedUsersQuery } from '@modules/users/queries/get-ip-limited-users';

import { QUEUES_NAMES } from '../../queue.enum';
import { NODES_JOB_NAMES } from '../constants';
import { IGeocheckJobResult, IGeocheckPayload, IGetIpsListResult } from '../interfaces';
import { pickAdmittedIps, slotKey } from './pick-admitted-ips';

@Processor(
    {
        name: QUEUES_NAMES.NODES.QUERY_NODES,
    },
    {
        concurrency: 10,
    },
)
export class QueryNodesQueueProcessor extends WorkerHost implements OnApplicationBootstrap {
    private static readonly CONNECTIONS_EXPORT_MAX_AGE_MS = 3_600_000; // 1 hour

    private readonly logger = new Logger(QueryNodesQueueProcessor.name);
    private readonly CONCURRENCY: number;
    private readonly exportToStreamEnabled: boolean;
    // Nodes already warned about not applying IP limits, so an old node doesn't log every 30s.
    private readonly ipLimitsWarnedNodes = new Set<string>();

    constructor(
        private readonly axios: AxiosService,
        private readonly queryBus: QueryBus,
        private readonly rawCacheService: RawCacheService,
        private readonly configService: TypedConfigService,
    ) {
        super();
        this.CONCURRENCY = 20;

        this.exportToStreamEnabled = this.configService.getOrThrow('EXPORT_TO_STREAM_ENABLED');
    }

    onApplicationBootstrap() {
        if (this.exportToStreamEnabled) {
            this.logger.log(
                `[STREAM] key "${EXPORT_TO_STREAM_KEYS.PREFIX}${EXPORT_TO_STREAM_KEYS.NODE_CONNECTIONS}", retention ${QueryNodesQueueProcessor.CONNECTIONS_EXPORT_MAX_AGE_MS / 60_000} min.`,
            );
        }
    }

    async process(job: Job) {
        switch (job.name) {
            case NODES_JOB_NAMES.CONNECTIONS_BY_USER:
                return await this.handleConnectionsByUser(job);
            case NODES_JOB_NAMES.CONNECTIONS_BY_NODE:
                return await this.handleConnectionsByNode(job);
            case NODES_JOB_NAMES.GEOCHECK_BY_NODE:
                return await this.handleGeocheckByNode(job);
            case NODES_JOB_NAMES.EXPORT_NODE_CONNECTIONS:
                return await this.handleExportNodeConnectionsJob(job);
            case NODES_JOB_NAMES.SYNC_IP_LIMITS:
                return await this.handleSyncIpLimits();
            default:
                this.logger.warn(`Job "${job.name}" is not handled.`);
                break;
        }
    }

    private async handleConnectionsByUser(job: Job<{ userId: number }>) {
        try {
            const findNodesByCriteriaResult = await this.queryBus.execute(
                new FindNodesByCriteriaQuery({
                    isDisabled: false,
                    isConnected: true,
                    isConnecting: false,
                }),
            );

            if (!findNodesByCriteriaResult.isOk) {
                return {
                    success: false,
                    userId: job.data.userId,
                    nodes: [],
                };
            }

            const { response: nodes } = findNodesByCriteriaResult;

            if (nodes.length === 0) {
                return {
                    success: true,
                    userId: job.data.userId,
                    nodes: [],
                };
            }

            let nodesCompleted = 0;

            const mapper = async (node: NodesEntity) => {
                try {
                    const ipsListResponse = await this.axios.getIpsList(
                        { userId: job.data.userId.toString() },
                        {
                            address: node.address,
                            port: node.port,
                            proxyUrl: node.proxyUrl,
                        },
                    );

                    if (!ipsListResponse.isOk || !ipsListResponse.response.ips.length) {
                        return;
                    }

                    const ips = ipsListResponse.response.ips;
                    let formattedIps: { ip: string; lastSeen: Date }[] = [];

                    if (ips.length > 0 && typeof ips[0] === 'string') {
                        formattedIps = (ips as unknown as string[]).map((ip) => ({
                            ip,
                            lastSeen: new Date(0),
                        }));
                    } else {
                        formattedIps = ips
                            .map((ip) => ({ ip: ip.ip, lastSeen: ip.lastSeen }))
                            .sort(
                                (a, b) =>
                                    new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
                            );
                    }

                    return {
                        nodeUuid: node.uuid,
                        nodeName: node.name,
                        countryCode: node.countryCode,
                        ips: formattedIps,
                    };
                } catch (error) {
                    this.logger.warn(`Failed to fetch IPs from node ${node.uuid}: ${error}`);
                } finally {
                    nodesCompleted++;
                    await job.updateProgress({
                        total: nodes.length,
                        completed: nodesCompleted,
                        percent: Math.round((nodesCompleted / nodes.length) * 100),
                    });
                }
            };

            const mapped = await pMap(nodes, mapper, { concurrency: this.CONCURRENCY });

            const result = mapped.filter((node) => node !== undefined);

            return {
                success: true,
                userId: job.data.userId,
                nodes: result,
            } satisfies IGetIpsListResult['result'];
        } catch (error) {
            this.logger.error(`Failed to fetch IPs list: ${error}`);
            return {
                success: false,
                userId: job.data.userId,
                nodes: [],
            };
        }
    }

    private async handleConnectionsByNode(job: Job<{ nodeUuid: string }>) {
        try {
            const nodeResult = await this.queryBus.execute(
                new GetNodeByUuidQuery(job.data.nodeUuid),
            );
            if (!nodeResult.isOk) {
                return {
                    success: false,
                    nodeUuid: job.data.nodeUuid,
                    users: [],
                };
            }

            if (!nodeResult.response.isConnected) {
                return {
                    success: false,
                    nodeUuid: job.data.nodeUuid,
                    users: [],
                };
            }

            const result = await this.axios.getUsersIpsList({
                address: nodeResult.response.address,
                port: nodeResult.response.port,
                proxyUrl: nodeResult.response.proxyUrl,
            });

            if (!result.isOk) {
                return {
                    success: false,
                    nodeUuid: job.data.nodeUuid,
                    users: [],
                };
            }

            return {
                success: true,
                nodeUuid: job.data.nodeUuid,
                users: result.response.users
                    .map((user) => ({ ...user, userId: Number(user.userId) }))
                    .filter((user) => Number.isFinite(user.userId))
                    .sort((a, b) => a.userId - b.userId),
            };
        } catch (error) {
            this.logger.error(`Failed to fetch users IPs list: ${error}`);
            return {
                success: false,
                nodeUuid: job.data.nodeUuid,
                users: [],
            };
        }
    }

    private async handleGeocheckByNode(job: Job<IGeocheckPayload>): Promise<IGeocheckJobResult> {
        const { nodeUuid, ip, interface: networkInterface } = job.data;

        const failed = (message: string): IGeocheckJobResult => ({
            success: false,
            nodeUuid,
            image: null,
            rawReport: null,
            message,
        });

        try {
            const nodeResult = await this.queryBus.execute(new GetNodeByUuidQuery(nodeUuid));

            if (!nodeResult.isOk) {
                return failed('Node not found.');
            }

            const result = await this.axios.getGeocheck(
                { ip, interface: networkInterface },
                {
                    address: nodeResult.response.address,
                    port: nodeResult.response.port,
                    proxyUrl: nodeResult.response.proxyUrl,
                },
            );

            if (!result.isOk) {
                return failed(result.message ?? 'Node did not return a geocheck.');
            }

            const { image, ...rawReport } = result.response;

            return {
                success: true,
                nodeUuid,
                image,
                rawReport,
                message: null,
            };
        } catch (error) {
            this.logger.error(`Failed to fetch geocheck for node ${nodeUuid}: ${error}`);

            return failed(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Reads every node's online IPs, picks which ones keep each limited user's slots, and sends
     * every node the whole table. A node that can't be read isn't sent anything: its last table
     * stays and its cross-node list expires on its own, so failures only loosen limits.
     */
    private async handleSyncIpLimits(): Promise<void> {
        try {
            const limitedResult = await this.queryBus.execute(new GetIpLimitedUsersQuery());
            if (!limitedResult.isOk) return;
            const limited = limitedResult.response;

            const previous = await this.rawCacheService.get<Record<string, string[]>>(
                INTERNAL_CACHE_KEYS.IP_LIMITS_ADMITTED,
            );
            // Nothing limited now or last run. Otherwise one empty table clears the nodes.
            if (limited.length === 0 && previous === null) return;

            const nodesResult = await this.queryBus.execute(new GetOnlineNodesQuery());
            if (!nodesResult.isOk) return;

            const limitedIds = new Set(limited.map(({ id }) => id.toString()));
            const seen = new Map<string, Map<string, number>>();
            const readable: typeof nodesResult.response = [];

            await pMap(
                nodesResult.response,
                async (node) => {
                    const result = await this.axios.getUsersIpsList(node.connectionOpts);
                    if (!result.isOk) return;
                    readable.push(node);

                    for (const user of result.response.users) {
                        if (!limitedIds.has(user.userId)) continue;
                        let ips = seen.get(user.userId);
                        if (!ips) seen.set(user.userId, (ips = new Map()));
                        for (const { ip, lastSeen } of user.ips) {
                            const at = new Date(lastSeen).getTime();
                            const slot = slotKey(ip);
                            ips.set(slot, Math.min(ips.get(slot) ?? at, at));
                        }
                    }
                },
                { concurrency: this.CONCURRENCY },
            );

            const admitted: Record<string, string[]> = {};
            const users = limited.map(({ id, ipLimit }) => {
                const username = id.toString();
                const ips = pickAdmittedIps(
                    ipLimit,
                    seen.get(username) ?? new Map(),
                    previous?.[username],
                );
                if (ips.length > 0) admitted[username] = ips;
                return { username, limit: ipLimit, ips };
            });

            if (limited.length === 0) {
                await this.rawCacheService.del(INTERNAL_CACHE_KEYS.IP_LIMITS_ADMITTED);
            } else {
                await this.rawCacheService.set(INTERNAL_CACHE_KEYS.IP_LIMITS_ADMITTED, admitted);
            }

            await pMap(
                readable,
                async (node) => {
                    const result = await this.axios.syncIpLimits({ users }, node.connectionOpts);
                    const applied = result.isOk && result.response.success;

                    if (applied) {
                        this.ipLimitsWarnedNodes.delete(node.uuid);
                    } else if (!this.ipLimitsWarnedNodes.has(node.uuid)) {
                        this.ipLimitsWarnedNodes.add(node.uuid);
                        this.logger.warn(
                            `Node ${node.uuid} did not apply IP limits (outdated node or Xray core): ${result.isOk ? 'core refused' : result.message}`,
                        );
                    }
                },
                { concurrency: this.CONCURRENCY },
            );
        } catch (error) {
            this.logger.error(`Failed to sync IP limits: ${error}`);
        }
    }

    private async handleExportNodeConnectionsJob(job: Job<{ nodeUuid: string }>): Promise<void> {
        try {
            if (!this.exportToStreamEnabled) {
                return;
            }

            const nodeResult = await this.queryBus.execute(
                new GetNodeByUuidQuery(job.data.nodeUuid),
            );

            if (!nodeResult.isOk || !nodeResult.response.isConnected) {
                return;
            }

            const result = await this.axios.getUsersIpsList({
                address: nodeResult.response.address,
                port: nodeResult.response.port,
                proxyUrl: nodeResult.response.proxyUrl,
            });

            if (!result.isOk || !result.response.users.length) {
                return;
            }

            await this.rawCacheService.xaddTrimmedByAge(
                EXPORT_TO_STREAM_KEYS.NODE_CONNECTIONS,
                QueryNodesQueueProcessor.CONNECTIONS_EXPORT_MAX_AGE_MS,
                {
                    v: NODE_CONNECTIONS_STREAM_MESSAGE_VERSION,
                    nodeId: nodeResult.response.id.toString(),
                    ts: new Date().toISOString(),
                    users: JSON.stringify(result.response.users),
                },
            );
        } catch (error) {
            this.logger.error(`Failed to export node connections to stream: ${error}`);
        }
    }
}
