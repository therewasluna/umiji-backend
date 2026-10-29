import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import {
    BrokerBotBroadcasts,
    BrokerBotCustomers,
    BrokerBotOrders,
    BrokerBotPlans,
    BrokerBots,
    Prisma,
} from '@prisma/client';

import { Injectable } from '@nestjs/common';

export type CustomerState = 'none' | 'awaiting_topup_amount' | 'awaiting_receipt' | 'support';

const MAX_GROUP_FINDS = 10;

const ORDER_ROW_INCLUDE = {
    customer: { select: { tgUserId: true, name: true, username: true } },
    plan: { select: { title: true } },
} satisfies Prisma.BrokerBotOrdersInclude;

export type OrderRow = Prisma.BrokerBotOrdersGetPayload<{ include: typeof ORDER_ROW_INCLUDE }>;

@Injectable()
export class BrokerBotRepository {
    constructor(private readonly prisma: TransactionHost<TransactionalAdapterPrisma>) {}

    // ---- Bot config ----

    public async getBot(brokerUuid: string): Promise<BrokerBots | null> {
        return this.prisma.tx.brokerBots.findUnique({ where: { brokerUuid } });
    }

    public async upsertBot(
        brokerUuid: string,
        data: Prisma.BrokerBotsUncheckedUpdateInput,
    ): Promise<BrokerBots> {
        return this.prisma.tx.brokerBots.upsert({
            where: { brokerUuid },
            create: { ...(data as Prisma.BrokerBotsUncheckedCreateInput), brokerUuid },
            update: data,
        });
    }

    /** Bots the poller should run. */
    public async listConnectedBots(): Promise<
        Pick<BrokerBots, 'brokerUuid' | 'botToken' | 'updateOffset'>[]
    > {
        return this.prisma.tx.brokerBots.findMany({
            select: { brokerUuid: true, botToken: true, updateOffset: true },
            where: { botToken: { not: null } },
        });
    }

    public async setUpdateOffset(brokerUuid: string, updateOffset: number): Promise<void> {
        await this.prisma.tx.brokerBots.update({ where: { brokerUuid }, data: { updateOffset } });
    }

    /** Records (or refreshes) a group found via /find, keeping the newest few. */
    public async recordGroupFind(
        brokerUuid: string,
        chatId: string,
        title: string | null,
    ): Promise<void> {
        const bot = await this.getBot(brokerUuid);
        if (!bot) return;
        const finds = (bot.groupFinds as { chatId: string }[]).filter((g) => g.chatId !== chatId);
        await this.prisma.tx.brokerBots.update({
            where: { brokerUuid },
            data: {
                groupFinds: [{ chatId, title, foundAt: new Date().toISOString() }, ...finds].slice(
                    0,
                    MAX_GROUP_FINDS,
                ),
            },
        });
    }

    public async setPendingReject(
        brokerUuid: string,
        adminTgUserId: string,
        orderId: number,
    ): Promise<void> {
        const bot = await this.getBot(brokerUuid);
        if (!bot) return;
        await this.prisma.tx.brokerBots.update({
            where: { brokerUuid },
            data: {
                pendingRejects: {
                    ...(bot.pendingRejects as Record<string, number>),
                    [adminTgUserId]: orderId,
                },
            },
        });
    }

    public async takePendingReject(
        brokerUuid: string,
        adminTgUserId: string,
    ): Promise<number | undefined> {
        const bot = await this.getBot(brokerUuid);
        const pending = { ...((bot?.pendingRejects ?? {}) as Record<string, number>) };
        const orderId = pending[adminTgUserId];
        if (orderId === undefined) return undefined;
        delete pending[adminTgUserId];
        await this.prisma.tx.brokerBots.update({
            where: { brokerUuid },
            data: { pendingRejects: pending },
        });
        return orderId;
    }

    // ---- Plans & categories ----

    public async listPlans(brokerUuid: string, activeOnly = false): Promise<BrokerBotPlans[]> {
        return this.prisma.tx.brokerBotPlans.findMany({
            where: { brokerUuid, ...(activeOnly ? { isActive: true } : {}) },
            orderBy: activeOnly ? [{ price: 'asc' }, { id: 'asc' }] : { id: 'asc' },
        });
    }

    public async getPlan(brokerUuid: string, id: number): Promise<BrokerBotPlans | null> {
        return this.prisma.tx.brokerBotPlans.findFirst({ where: { id, brokerUuid } });
    }

    public async createPlan(data: Prisma.BrokerBotPlansUncheckedCreateInput): Promise<void> {
        await this.prisma.tx.brokerBotPlans.create({ data });
    }

    public async updatePlan(
        brokerUuid: string,
        id: number,
        data: Prisma.BrokerBotPlansUncheckedUpdateManyInput,
    ): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotPlans.updateMany({
            where: { id, brokerUuid },
            data,
        });
        return count === 1;
    }

    public async deletePlan(brokerUuid: string, id: number): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotPlans.deleteMany({
            where: { id, brokerUuid },
        });
        return count === 1;
    }

    public async listCategories(brokerUuid: string): Promise<{ id: number; title: string }[]> {
        return this.prisma.tx.brokerBotPlanCategories.findMany({
            select: { id: true, title: true },
            where: { brokerUuid },
            orderBy: { id: 'asc' },
        });
    }

    public async categoryExists(brokerUuid: string, id: number): Promise<boolean> {
        return (
            (await this.prisma.tx.brokerBotPlanCategories.count({ where: { id, brokerUuid } })) > 0
        );
    }

    public async createCategory(brokerUuid: string, title: string): Promise<void> {
        await this.prisma.tx.brokerBotPlanCategories.create({ data: { brokerUuid, title } });
    }

    /** Its plans become uncategorized (FK is SET NULL), not deleted. */
    public async deleteCategory(brokerUuid: string, id: number): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotPlanCategories.deleteMany({
            where: { id, brokerUuid },
        });
        return count === 1;
    }

    // ---- Customers ----

    public async upsertCustomer(c: {
        brokerUuid: string;
        tgUserId: string;
        chatId: string;
        name: string | null;
        username: string | null;
    }): Promise<BrokerBotCustomers> {
        const fields = {
            chatId: c.chatId,
            name: c.name,
            username: c.username,
            lastSeenAt: new Date(),
        };
        return this.prisma.tx.brokerBotCustomers.upsert({
            where: { brokerUuid_tgUserId: { brokerUuid: c.brokerUuid, tgUserId: c.tgUserId } },
            create: { brokerUuid: c.brokerUuid, tgUserId: c.tgUserId, ...fields },
            update: fields,
        });
    }

    public async getCustomerById(
        brokerUuid: string,
        id: number,
    ): Promise<BrokerBotCustomers | null> {
        return this.prisma.tx.brokerBotCustomers.findFirst({ where: { id, brokerUuid } });
    }

    public async getCustomerByTgUserId(
        brokerUuid: string,
        tgUserId: string,
    ): Promise<BrokerBotCustomers | null> {
        return this.prisma.tx.brokerBotCustomers.findUnique({
            where: { brokerUuid_tgUserId: { brokerUuid, tgUserId } },
        });
    }

    public async getCustomerByTicketTopic(
        brokerUuid: string,
        ticketTopicId: number,
    ): Promise<BrokerBotCustomers | null> {
        return this.prisma.tx.brokerBotCustomers.findFirst({
            where: { brokerUuid, ticketTopicId },
        });
    }

    public async setCustomerState(
        id: number,
        state: CustomerState,
        stateAmount: number | null = null,
    ): Promise<void> {
        await this.prisma.tx.brokerBotCustomers.update({
            where: { id },
            data: { state, stateAmount },
        });
    }

    /** Ticket topics live in the staff group: a new group means new tickets. */
    public async clearTicketTopics(brokerUuid: string): Promise<void> {
        await this.prisma.tx.brokerBotCustomers.updateMany({
            where: { brokerUuid, ticketTopicId: { not: null } },
            data: { ticketTopicId: null },
        });
    }

    /** Another broker's bot with this username, if any (two pollers on one token would fight). */
    public async isBotTakenByOther(brokerUuid: string, botUsername: string): Promise<boolean> {
        const count = await this.prisma.tx.brokerBots.count({
            where: { botUsername, botToken: { not: null }, brokerUuid: { not: brokerUuid } },
        });
        return count > 0;
    }

    public async setTicketTopic(id: number, ticketTopicId: number): Promise<void> {
        await this.prisma.tx.brokerBotCustomers.update({ where: { id }, data: { ticketTopicId } });
    }

    /** Returns the new balance. */
    public async creditWallet(id: number, amount: number): Promise<bigint> {
        const c = await this.prisma.tx.brokerBotCustomers.update({
            where: { id },
            data: { wallet: { increment: amount } },
            select: { wallet: true },
        });
        return c.wallet;
    }

    // ---- Orders ----

    /**
     * Debits the wallet and records the purchase as a pending plan order, in one transaction. Null
     * when the balance is short. A second call with the same checkout key throws P2002 (unique) and
     * rolls the debit back, so a double tap pays once. A crash before completePlanOrder leaves a
     * visible pending plan order instead of money gone without a trace.
     */
    @Transactional()
    public async payForPlan(o: {
        brokerUuid: string;
        customerId: number;
        planId: number;
        amount: number;
        checkoutKey: string;
    }): Promise<null | number> {
        const { count } = await this.prisma.tx.brokerBotCustomers.updateMany({
            where: { id: o.customerId, wallet: { gte: o.amount } },
            data: { wallet: { decrement: o.amount } },
        });
        if (count !== 1) return null;
        const order = await this.prisma.tx.brokerBotOrders.create({
            data: { ...o, kind: 'plan' },
        });
        return order.id;
    }

    public async completePlanOrder(id: number, userId: bigint): Promise<void> {
        await this.prisma.tx.brokerBotOrders.update({
            where: { id },
            data: { status: 'approved', userId, decidedAt: new Date() },
        });
    }

    /** The subscription couldn't be created: the order is rejected and the money goes back. */
    @Transactional()
    public async refundPlanOrder(id: number, customerId: number, amount: number): Promise<void> {
        await this.prisma.tx.brokerBotOrders.update({
            where: { id },
            data: { status: 'rejected', decidedAt: new Date() },
        });
        await this.creditWallet(customerId, amount);
    }

    public async createTopupOrder(
        brokerUuid: string,
        customerId: number,
        amount: number,
    ): Promise<BrokerBotOrders> {
        return this.prisma.tx.brokerBotOrders.create({
            data: { brokerUuid, customerId, kind: 'topup', amount },
        });
    }

    public async getOrder(brokerUuid: string, id: number): Promise<BrokerBotOrders | null> {
        return this.prisma.tx.brokerBotOrders.findFirst({ where: { id, brokerUuid } });
    }

    public async setOrderReviewMessage(id: number, reviewMessageId: number): Promise<void> {
        await this.prisma.tx.brokerBotOrders.update({ where: { id }, data: { reviewMessageId } });
    }

    /** Kept so the receipt can be reviewed in the panel too. */
    public async setOrderReceipt(
        id: number,
        receiptKind: 'photo' | 'text',
        receiptFileId: string | null,
        receiptText: string | null,
    ): Promise<void> {
        await this.prisma.tx.brokerBotOrders.update({
            where: { id },
            data: { receiptKind, receiptFileId, receiptText },
        });
    }

    /**
     * Approves a pending top-up and credits the wallet in one transaction, so a double tap,
     * a second admin or a crash can't credit twice. Null when the order wasn't pending.
     */
    @Transactional()
    public async approveTopup(order: BrokerBotOrders): Promise<bigint | null> {
        const { count } = await this.prisma.tx.brokerBotOrders.updateMany({
            where: { id: order.id, brokerUuid: order.brokerUuid, status: 'pending' },
            data: {
                status: 'approved',
                decidedAt: new Date(),
                receiptKind: null,
                receiptFileId: null,
                receiptText: null,
            },
        });
        if (count !== 1) return null;
        return this.creditWallet(order.customerId, order.amount);
    }

    /** Drops the stored receipt: it's never needed after a decision. False if already decided. */
    public async rejectOrder(id: number, rejectReason: string | null): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotOrders.updateMany({
            where: { id, status: 'pending' },
            data: {
                status: 'rejected',
                rejectReason,
                decidedAt: new Date(),
                receiptKind: null,
                receiptFileId: null,
                receiptText: null,
            },
        });
        return count === 1;
    }

    /** The customer's subscriptions, newest first. */
    public async listApprovedPlanOrders(
        brokerUuid: string,
        customerId: number,
        skip: number,
        take: number,
    ): Promise<(BrokerBotOrders & { plan: { title: string } | null })[]> {
        return this.prisma.tx.brokerBotOrders.findMany({
            where: { brokerUuid, customerId, status: 'approved', userId: { not: null } },
            include: { plan: { select: { title: true } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip,
            take,
        });
    }

    public async countPendingByCustomer(brokerUuid: string, customerId: number): Promise<number> {
        return this.prisma.tx.brokerBotOrders.count({
            where: { brokerUuid, customerId, status: 'pending', kind: 'topup' },
        });
    }

    /** Every pending top-up: never paginated, so none is missed. */
    public async listPendingReceipts(brokerUuid: string): Promise<OrderRow[]> {
        return this.prisma.tx.brokerBotOrders.findMany({
            where: { brokerUuid, status: 'pending', kind: 'topup' },
            include: ORDER_ROW_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
    }

    /** Decided top-ups and purchases. */
    public async listOrders(
        brokerUuid: string,
        start: number,
        size: number,
    ): Promise<[OrderRow[], number]> {
        const where = {
            brokerUuid,
            NOT: { status: 'pending', kind: 'topup' },
        } satisfies Prisma.BrokerBotOrdersWhereInput;
        return Promise.all([
            this.prisma.tx.brokerBotOrders.findMany({
                where,
                include: ORDER_ROW_INCLUDE,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: start,
                take: size,
            }),
            this.prisma.tx.brokerBotOrders.count({ where }),
        ]);
    }

    // ---- Broadcasts ----

    /** Distinct customer chats of one broker's bot. */
    public async listCustomerChatIds(brokerUuid: string): Promise<string[]> {
        const rows = await this.prisma.tx.brokerBotCustomers.findMany({
            select: { chatId: true },
            where: { brokerUuid },
            distinct: ['chatId'],
        });
        return rows.map((r) => r.chatId);
    }

    /** Customers a broadcast would reach: those of every connected bot. */
    public async countBroadcastAudience(): Promise<number> {
        return this.prisma.tx.brokerBotCustomers.count({
            where: { broker: { bot: { botToken: { not: null } } } },
        });
    }

    public async createBroadcast(
        caption: string | null,
        hasMedia: boolean,
        recipients: number,
    ): Promise<BrokerBotBroadcasts> {
        return this.prisma.tx.brokerBotBroadcasts.create({
            data: { caption, hasMedia, recipients },
        });
    }

    public async saveBroadcastProgress(id: number, sent: number, failed: number): Promise<void> {
        await this.prisma.tx.brokerBotBroadcasts.update({ where: { id }, data: { sent, failed } });
    }

    public async finishBroadcast(id: number, sent: number, failed: number): Promise<void> {
        await this.prisma.tx.brokerBotBroadcasts.update({
            where: { id },
            data: { sent, failed, status: 'done', finishedAt: new Date() },
        });
    }

    public async listBroadcasts(take = 10): Promise<BrokerBotBroadcasts[]> {
        return this.prisma.tx.brokerBotBroadcasts.findMany({ orderBy: { id: 'desc' }, take });
    }

    /** Bot stats since `since` (the bot token's last change). */
    public async getStats(brokerUuid: string, since: Date) {
        const now = new Date();
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
        const customers = { brokerUuid, createdAt: { gte: since } };
        const orders = { brokerUuid, createdAt: { gte: since } };

        const [usersTotal, activeToday, newToday, active7d, wallets, plansSold, topups, pending] =
            await Promise.all([
                this.prisma.tx.brokerBotCustomers.count({ where: customers }),
                this.prisma.tx.brokerBotCustomers.count({
                    where: { ...customers, lastSeenAt: { gte: today } },
                }),
                this.prisma.tx.brokerBotCustomers.count({
                    where: { brokerUuid, createdAt: { gte: since > today ? since : today } },
                }),
                this.prisma.tx.brokerBotCustomers.count({
                    where: { ...customers, lastSeenAt: { gte: weekAgo } },
                }),
                this.prisma.tx.brokerBotCustomers.aggregate({
                    where: customers,
                    _sum: { wallet: true },
                }),
                this.prisma.tx.brokerBotOrders.count({
                    where: { ...orders, kind: 'plan', status: 'approved' },
                }),
                this.prisma.tx.brokerBotOrders.aggregate({
                    where: { ...orders, kind: 'topup', status: 'approved' },
                    _sum: { amount: true },
                }),
                // All of them, not only since the reset: they still need a decision.
                this.prisma.tx.brokerBotOrders.count({
                    where: { brokerUuid, kind: 'topup', status: 'pending' },
                }),
            ]);

        return {
            usersTotal,
            activeToday,
            newToday,
            active7d,
            walletTotal: Number(wallets._sum.wallet ?? 0n),
            plansSold,
            topupsTotal: topups._sum.amount ?? 0,
            pendingReceipts: pending,
        };
    }
}
