import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';

import { INTERNAL_SQUADS_MODE, ROLE } from '@libs/contracts/constants';
import { SUBPAGE_DEFAULT_CONFIG_UUID } from '@libs/subscription-page/constants';

import { DEFAULT_SUBPAGE_CONFIG } from '@modules/subscription-page-configs/constants';

import { BrokerEntity } from '../entities';

const BROKER_INCLUDE = {
    admin: { select: { username: true } },
    internalSquads: { select: { internalSquad: { select: { uuid: true, name: true } } } },
    externalSquad: {
        select: {
            uuid: true,
            name: true,
            subpageConfig: {
                select: { uuid: true, _count: { select: { externalSquads: true } } },
            },
        },
    },
    _count: { select: { users: true } },
} satisfies Prisma.BrokersInclude;

type BrokerWithRelations = Prisma.BrokersGetPayload<{ include: typeof BROKER_INCLUDE }>;

type BrokerFields = Partial<
    Pick<
        BrokerEntity,
        'trafficLimitBytes' | 'usersLimit' | 'expireAt' | 'isDisabled' | 'description'
    >
>;

@Injectable()
export class BrokersRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    /**
     * Creates the broker together with its own external squad and subscription page config,
     * both named after the broker. The config starts as a copy of the panel's default one.
     */
    public async create(dto: {
        username: string;
        passwordHash: string;
        fields: BrokerFields;
        internalSquads: string[];
    }): Promise<BrokerEntity> {
        const defaultConfig = await this.prisma.tx.subscriptionPageConfig.findUnique({
            select: { config: true },
            where: { uuid: SUBPAGE_DEFAULT_CONFIG_UUID },
        });

        const admin = await this.prisma.tx.admin.create({
            select: { uuid: true },
            data: {
                username: dto.username,
                passwordHash: dto.passwordHash,
                role: ROLE.BROKER,
                broker: {
                    create: {
                        ...dto.fields,
                        internalSquads: {
                            create: dto.internalSquads.map((uuid) => ({ internalSquadUuid: uuid })),
                        },
                        externalSquad: {
                            create: {
                                name: dto.username,
                                subpageConfig: {
                                    create: {
                                        name: dto.username,
                                        config: (defaultConfig?.config ??
                                            DEFAULT_SUBPAGE_CONFIG) as Prisma.InputJsonValue,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        return (await this.findByUUID(admin.uuid))!;
    }

    public async findByUUID(uuid: string): Promise<BrokerEntity | null> {
        const result = await this.prisma.tx.brokers.findUnique({
            where: { uuid },
            include: BROKER_INCLUDE,
        });

        return result ? this.toEntity(result) : null;
    }

    public async findAll(): Promise<BrokerEntity[]> {
        const result = await this.prisma.tx.brokers.findMany({
            include: BROKER_INCLUDE,
            orderBy: { createdAt: 'asc' },
        });

        return result.map((broker) => this.toEntity(broker));
    }

    /**
     * Allowed internal squads as the broker needs to see them: inbounds, server countries with how
     * many servers are online, the subscription entries a member gets, and how many of the broker's
     * users are in each. Node names and addresses stay with the owner.
     */
    public async findInternalSquadsWithMembers(uuid: string) {
        const squads = await this.prisma.tx.internalSquads.findMany({
            where: { brokers: { some: { brokerUuid: uuid } } },
            orderBy: { viewPosition: 'asc' },
            select: {
                uuid: true,
                name: true,
                internalSquadInbounds: {
                    select: {
                        inbound: {
                            select: {
                                uuid: true,
                                tag: true,
                                type: true,
                                network: true,
                                security: true,
                                port: true,
                                profileUuid: true,
                                configProfileInboundsToNodes: {
                                    select: {
                                        node: {
                                            select: {
                                                uuid: true,
                                                countryCode: true,
                                                isConnected: true,
                                                isDisabled: true,
                                                activeConfigProfileUuid: true,
                                            },
                                        },
                                    },
                                },
                                hosts: {
                                    where: { isDisabled: false, isHidden: false },
                                    orderBy: { viewPosition: 'asc' },
                                    select: {
                                        uuid: true,
                                        remark: true,
                                        internalSquadsMode: true,
                                        internalSquads: { select: { squadUuid: true } },
                                    },
                                },
                            },
                        },
                    },
                },
                _count: {
                    select: { internalSquadMembers: { where: { user: { brokerUuid: uuid } } } },
                },
            },
        });

        return squads.map(({ internalSquadInbounds, _count, ...squad }) => {
            const inbounds = internalSquadInbounds.map(({ inbound }) => inbound);

            // A node serves the inbound only while it runs the inbound's profile.
            const nodes = new Map(
                inbounds.flatMap((inbound) =>
                    inbound.configProfileInboundsToNodes
                        .map(({ node }) => node)
                        .filter(
                            (node) =>
                                !node.isDisabled &&
                                node.activeConfigProfileUuid === inbound.profileUuid,
                        )
                        .map((node) => [node.uuid, node] as const),
                ),
            );

            const locations = new Map<string, { nodesCount: number; onlineCount: number }>();
            for (const node of nodes.values()) {
                const location = locations.get(node.countryCode) ?? {
                    nodesCount: 0,
                    onlineCount: 0,
                };
                location.nodesCount += 1;
                location.onlineCount += node.isConnected ? 1 : 0;
                locations.set(node.countryCode, location);
            }

            // Same rule as subscriptions: a link to the squad means "only" in ALLOW_ONLY mode and
            // "not" in EXCLUDE mode.
            const hosts = new Map(
                inbounds.flatMap((inbound) =>
                    inbound.hosts
                        .filter(
                            (host) =>
                                host.internalSquads.some(
                                    ({ squadUuid }) => squadUuid === squad.uuid,
                                ) ===
                                (host.internalSquadsMode === INTERNAL_SQUADS_MODE.ALLOW_ONLY),
                        )
                        .map((host) => [host.uuid, { remark: host.remark }] as const),
                ),
            );

            return {
                ...squad,
                membersCount: _count.internalSquadMembers,
                inbounds: inbounds.map(({ uuid, tag, type, network, security, port }) => ({
                    uuid,
                    tag,
                    type,
                    network,
                    security,
                    port,
                })),
                locations: Array.from(locations, ([countryCode, counts]) => ({
                    countryCode,
                    ...counts,
                })),
                hosts: Array.from(hosts.values()),
            };
        });
    }

    public async update(dto: {
        uuid: string;
        passwordHash?: string;
        fields: BrokerFields;
        internalSquads?: string[];
    }): Promise<BrokerEntity | null> {
        await this.prisma.tx.brokers.update({
            select: { uuid: true },
            where: { uuid: dto.uuid },
            data: {
                ...dto.fields,
                admin: dto.passwordHash
                    ? { update: { passwordHash: dto.passwordHash } }
                    : undefined,
                internalSquads: dto.internalSquads && {
                    deleteMany: {},
                    create: dto.internalSquads.map((uuid) => ({ internalSquadUuid: uuid })),
                },
            },
        });

        return this.findByUUID(dto.uuid);
    }

    public async resetUsedTraffic(uuid: string): Promise<void> {
        await this.prisma.tx.brokers.update({
            select: { uuid: true },
            where: { uuid },
            data: { usedTrafficBytes: 0n },
        });
    }

    public async deleteByUUID(uuid: string): Promise<boolean> {
        // The admin row owns the broker profile (cascade); the role filter keeps the panel owner safe.
        const result = await this.prisma.tx.admin.deleteMany({
            where: { uuid, role: ROLE.BROKER },
        });

        return result.count > 0;
    }

    private toEntity({
        admin,
        internalSquads,
        externalSquad,
        _count,
        ...broker
    }: BrokerWithRelations): BrokerEntity {
        const config = externalSquad?.subpageConfig;

        return new BrokerEntity({
            ...broker,
            username: admin.username,
            usersCount: _count.users,
            internalSquads: internalSquads.map(({ internalSquad }) => internalSquad),
            externalSquad: externalSquad && { uuid: externalSquad.uuid, name: externalSquad.name },
            // Editable only while the config is the broker's alone, so it never edits the
            // default page or one the owner shares with other squads.
            subpageConfigUuid:
                config &&
                config.uuid !== SUBPAGE_DEFAULT_CONFIG_UUID &&
                config._count.externalSquads === 1
                    ? config.uuid
                    : null,
        });
    }
}
