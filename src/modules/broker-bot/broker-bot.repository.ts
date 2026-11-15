import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import {
    BrokerBotBroadcasts,
    BrokerBotCustomers,
    BrokerBotOrders,
    BrokerBotPlans,
    BrokerBotUpdates,
    BrokerBots,
    Prisma,
} from '@prisma/client';

import { Injectable } from '@nestjs/common';

export type CustomerState = 'none' | 'awaiting_topup_amount' | 'awaiting_receipt' | 'support';

const MAX_GROUP_FINDS = 10;
// Retries at 5, 10, 20 and 40 seconds, then the update is dropped.
const MAX_UPDATE_ATTEMPTS = 5;

const ORDER_ROW_INCLUDE = {
    customer: { select: { tgUserId: true, name: true, username: true } },
    plan: { select: { title: true } },
} satisfies Prisma.BrokerBotOrdersInclude;

export type OrderRow = Prisma.BrokerBotOrdersGetPayload<{ include: typeof ORDER_ROW_INCLUDE }>;
export type PlanOrderRecovery =
    | { status: 'approved'; customer: BrokerBotCustomers; user: { shortUuid: string } }
    | { status: 'refunded' }
    | { status: 'invalid_user' }
    | { status: 'not_pending' };

export interface TopupApproval {
    /** The customer's new balance */
    balance: bigint;
    /** What their referrer got, if anything */
    reward: { customerId: number; amount: number; balance: bigint } | null;
}

/** What happened in a stretch of time. Amounts are Toman. */
export interface StatsPeriod {
    newCustomers: number;
    referrals: number;
    sales: number;
    salesAmount: number;
    topups: number;
    topupsAmount: number;
    rejectedTopups: number;
    trials: number;
    rewards: number;
}
export type StatsWindow = StatsPeriod & { activeCustomers: number };

export interface BotReport {
    since: Date;
    totals: StatsPeriod & {
        customers: number;
        buyers: number;
        walletTotal: number;
        pendingReceipts: number;
    };
    yesterday: StatsWindow;
    today: StatsWindow;
    week: StatsWindow;
    month: StatsWindow;
    /** The last 30 UTC days, oldest first */
    daily: (StatsPeriod & { date: string })[];
    topPlans: { planId: number; title: string; sales: number; salesAmount: number }[];
}

const DAY_MS = 86_400_000;
const REPORT_DAYS = 30;

const emptyPeriod = (): StatsPeriod => ({
    newCustomers: 0,
    referrals: 0,
    sales: 0,
    salesAmount: 0,
    topups: 0,
    topupsAmount: 0,
    rejectedTopups: 0,
    trials: 0,
    rewards: 0,
});

function addPeriod(to: StatsPeriod, from: StatsPeriod): StatsPeriod {
    for (const k of Object.keys(to) as (keyof StatsPeriod)[]) to[k] += from[k];
    return to;
}

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
        Pick<BrokerBots, 'brokerUuid' | 'botToken' | 'updateOffset' | 'summaryPostedOn'>[]
    > {
        return this.prisma.tx.brokerBots.findMany({
            select: { brokerUuid: true, botToken: true, updateOffset: true, summaryPostedOn: true },
            where: { botToken: { not: null } },
        });
    }

    public async setUpdateOffset(brokerUuid: string, updateOffset: number): Promise<void> {
        await this.prisma.tx.brokerBots.updateMany({
            where: { brokerUuid, updateOffset: { lt: updateOffset } },
            data: { updateOffset },
        });
    }

    public async enqueueUpdate(
        brokerUuid: string,
        updateId: number,
        payload: Prisma.InputJsonValue,
    ): Promise<boolean> {
        try {
            await this.prisma.tx.brokerBotUpdates.create({
                data: { brokerUuid, updateId: BigInt(updateId), payload },
            });
            return true;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return false;
            }
            throw error;
        }
    }

    public async getNextPendingUpdate(brokerUuid: string): Promise<BrokerBotUpdates | null> {
        // Skips updates waiting out a retry, so one failure doesn't hold back the rest.
        return this.prisma.tx.brokerBotUpdates.findFirst({
            where: { brokerUuid, status: 'pending', availableAt: { lte: new Date() } },
            orderBy: { updateId: 'asc' },
        });
    }

    public async claimUpdate(brokerUuid: string, updateId: bigint): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotUpdates.updateMany({
            where: { brokerUuid, updateId, status: 'pending' },
            data: { status: 'processing', claimedAt: new Date() },
        });
        return count === 1;
    }

    public async completeUpdate(brokerUuid: string, updateId: bigint): Promise<void> {
        await this.prisma.tx.brokerBotUpdates.update({
            where: { brokerUuid_updateId: { brokerUuid, updateId } },
            data: {
                status: 'processed',
                payload: {},
                claimedAt: null,
                processedAt: new Date(),
            },
        });
    }

    /** Backs a failed update off for another try, or gives up on it after the last attempt. */
    public async failUpdate(
        brokerUuid: string,
        updateId: bigint,
        attempts: number,
        retry: boolean,
    ): Promise<void> {
        const giveUp = !retry || attempts + 1 >= MAX_UPDATE_ATTEMPTS;
        await this.prisma.tx.brokerBotUpdates.update({
            where: { brokerUuid_updateId: { brokerUuid, updateId } },
            data: giveUp
                ? {
                      status: 'failed',
                      claimedAt: null,
                      attempts: { increment: 1 },
                      processedAt: new Date(),
                  }
                : {
                      status: 'pending',
                      claimedAt: null,
                      attempts: { increment: 1 },
                      availableAt: new Date(Date.now() + 5_000 * 2 ** attempts),
                  },
        });
    }

    public async requeueProcessingUpdates(): Promise<void> {
        await this.prisma.tx.brokerBotUpdates.updateMany({
            where: { status: 'processing' },
            data: { status: 'pending', claimedAt: null, availableAt: new Date() },
        });
    }

    public async requeueStaleUpdates(before: Date): Promise<void> {
        await this.prisma.tx.brokerBotUpdates.updateMany({
            where: { status: 'processing', claimedAt: { lt: before } },
            data: { status: 'pending', claimedAt: null, availableAt: new Date() },
        });
    }

    public async deleteProcessedUpdates(before: Date): Promise<void> {
        await this.prisma.tx.brokerBotUpdates.deleteMany({
            where: { status: { in: ['processed', 'failed'] }, processedAt: { lt: before } },
        });
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
        /** Set on the first contact only; the customer can change it later. */
        lang: string | null;
        /** Who invited them. Only a new customer gets one: existing customers aren't reassigned. */
        referredById: number | null;
    }): Promise<{ customer: BrokerBotCustomers; isNew: boolean }> {
        const where = { brokerUuid_tgUserId: { brokerUuid: c.brokerUuid, tgUserId: c.tgUserId } };
        const fields = {
            chatId: c.chatId,
            name: c.name,
            username: c.username,
            lastSeenAt: new Date(),
        };
        const update = async () => ({
            customer: await this.prisma.tx.brokerBotCustomers.update({ where, data: fields }),
            isNew: false,
        });
        // Not an upsert: it can't say whether it created the row.
        if (await this.prisma.tx.brokerBotCustomers.findUnique({ where, select: { id: true } })) {
            return update();
        }
        try {
            const customer = await this.prisma.tx.brokerBotCustomers.create({
                data: {
                    brokerUuid: c.brokerUuid,
                    tgUserId: c.tgUserId,
                    lang: c.lang,
                    referredById: c.referredById,
                    ...fields,
                },
            });
            return { customer, isNew: true };
        } catch (error) {
            // Their first two messages raced and the other one created the row.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return update();
            }
            throw error;
        }
    }

    /** Friends this customer invited, and what their top-ups earned the customer. */
    public async getReferralSummary(
        customerId: number,
    ): Promise<{ invited: number; earned: number }> {
        const [invited, earned] = await Promise.all([
            this.prisma.tx.brokerBotCustomers.count({ where: { referredById: customerId } }),
            this.prisma.tx.brokerBotOrders.aggregate({
                where: { customerId, kind: 'referral' },
                _sum: { amount: true },
            }),
        ]);
        return { invited, earned: earned._sum.amount ?? 0 };
    }

    public async setCustomerLang(id: number, lang: string): Promise<void> {
        await this.prisma.tx.brokerBotCustomers.update({ where: { id }, data: { lang } });
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
        telegramUpdateId?: number,
    ): Promise<BrokerBotOrders> {
        if (telegramUpdateId !== undefined) {
            return this.prisma.tx.brokerBotOrders.upsert({
                where: {
                    brokerUuid_telegramUpdateId: {
                        brokerUuid,
                        telegramUpdateId: BigInt(telegramUpdateId),
                    },
                },
                create: {
                    brokerUuid,
                    customerId,
                    amount,
                    kind: 'topup',
                    telegramUpdateId: BigInt(telegramUpdateId),
                },
                update: {},
            });
        }

        return this.prisma.tx.brokerBotOrders.create({
            data: { brokerUuid, customerId, kind: 'topup', amount },
        });
    }

    public async getOrder(brokerUuid: string, id: number): Promise<BrokerBotOrders | null> {
        return this.prisma.tx.brokerBotOrders.findFirst({ where: { id, brokerUuid } });
    }

    @Transactional()
    public async recoverPlanOrder(
        brokerUuid: string,
        brokerUsername: string,
        id: number,
        decision: 'approve' | 'reject',
        userId?: number,
    ): Promise<PlanOrderRecovery> {
        const order = await this.prisma.tx.brokerBotOrders.findFirst({
            where: { id, brokerUuid, kind: 'plan', status: 'pending', userId: null },
            include: { customer: true },
        });
        if (!order) return { status: 'not_pending' };

        if (decision === 'reject') {
            const { count } = await this.prisma.tx.brokerBotOrders.updateMany({
                where: { id, brokerUuid, kind: 'plan', status: 'pending', userId: null },
                data: { status: 'rejected', decidedAt: new Date() },
            });
            if (count !== 1) return { status: 'not_pending' };
            await this.prisma.tx.brokerBotCustomers.update({
                where: { id: order.customerId },
                data: { wallet: { increment: order.amount } },
            });
            return { status: 'refunded' };
        }

        if (userId === undefined) return { status: 'invalid_user' };
        const brokerPrefix = `${brokerUsername}_`;
        const telegramPrefix = `${brokerPrefix}${order.customer.tgUserId}_`;
        const usernamePrefix =
            36 - brokerPrefix.length >= `${order.customer.tgUserId}_`.length
                ? telegramPrefix
                : brokerPrefix;
        const user = await this.prisma.tx.users.findFirst({
            where: {
                id: BigInt(userId),
                brokerUuid,
                username: { startsWith: usernamePrefix },
                createdAt: {
                    gte: order.createdAt,
                    lte: new Date(order.createdAt.getTime() + 30 * 60_000),
                },
            },
            select: { id: true, shortUuid: true },
        });
        if (!user) return { status: 'invalid_user' };

        const { count } = await this.prisma.tx.brokerBotOrders.updateMany({
            where: { id, brokerUuid, kind: 'plan', status: 'pending', userId: null },
            data: { status: 'approved', userId: user.id, decidedAt: new Date() },
        });
        if (count !== 1) return { status: 'not_pending' };
        return { status: 'approved', customer: order.customer, user };
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
    public async approveTopup(order: BrokerBotOrders): Promise<null | TopupApproval> {
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
        const balance = await this.creditWallet(order.customerId, order.amount);
        return { balance, reward: await this.payReferralReward(order) };
    }

    /**
     * The referrer's share of an approved top-up, recorded as a referral order. One level only: the
     * reward is no top-up, so it never pays the referrer's own referrer.
     */
    private async payReferralReward(order: BrokerBotOrders): Promise<TopupApproval['reward']> {
        const [customer, bot] = await Promise.all([
            this.prisma.tx.brokerBotCustomers.findUnique({
                where: { id: order.customerId },
                select: { referredById: true },
            }),
            this.prisma.tx.brokerBots.findUnique({
                where: { brokerUuid: order.brokerUuid },
                select: { referralPercent: true },
            }),
        ]);
        const referrerId = customer?.referredById;
        if (!referrerId || !bot?.referralPercent) return null;
        const amount = Math.floor((order.amount * bot.referralPercent) / 100);
        if (amount <= 0) return null;
        await this.prisma.tx.brokerBotOrders.create({
            data: {
                brokerUuid: order.brokerUuid,
                customerId: referrerId,
                kind: 'referral',
                amount,
                status: 'approved',
                decidedAt: new Date(),
            },
        });
        return {
            customerId: referrerId,
            amount,
            balance: await this.creditWallet(referrerId, amount),
        };
    }

    // ---- Free trial ----

    /** Throws P2002 when this customer already claimed in this round (see trialKey). */
    public async createTrialOrder(
        brokerUuid: string,
        customerId: number,
        trialKey: string,
    ): Promise<number> {
        const order = await this.prisma.tx.brokerBotOrders.create({
            data: { brokerUuid, customerId, kind: 'trial', amount: 0, checkoutKey: trialKey },
        });
        return order.id;
    }

    /** The subscription couldn't be created: the claim is given back. */
    public async releaseTrialOrder(id: number): Promise<void> {
        await this.prisma.tx.brokerBotOrders.update({
            where: { id },
            data: { status: 'rejected', checkoutKey: null, decidedAt: new Date() },
        });
    }

    public async hasClaimedTrial(customerId: number, trialKey: string): Promise<boolean> {
        const order = await this.prisma.tx.brokerBotOrders.findUnique({
            where: { customerId_checkoutKey: { customerId, checkoutKey: trialKey } },
            select: { id: true },
        });
        return order !== null;
    }

    public async countTrialClaims(brokerUuid: string, trialKey: string): Promise<number> {
        return this.prisma.tx.brokerBotOrders.count({
            where: { brokerUuid, kind: 'trial', checkoutKey: trialKey },
        });
    }

    /** Trials handed out since `since`; claims given back don't count. */
    public async countTrialsSince(brokerUuid: string, since: Date): Promise<number> {
        return this.prisma.tx.brokerBotOrders.count({
            where: {
                brokerUuid,
                kind: 'trial',
                status: { not: 'rejected' },
                createdAt: { gte: since },
            },
        });
    }

    /** Trial users that expired before `before`, per broker, for bots with trial.deleteExpired on. */
    public async listExpiredTrialUsers(before: Date): Promise<Map<string, number[]>> {
        const bots = await this.prisma.tx.brokerBots.findMany({
            where: { trial: { path: ['deleteExpired'], equals: true } },
            select: { brokerUuid: true },
        });
        const due = new Map<string, number[]>();
        if (bots.length === 0) return due;
        const orders = await this.prisma.tx.brokerBotOrders.findMany({
            where: {
                brokerUuid: { in: bots.map((b) => b.brokerUuid) },
                kind: 'trial',
                status: 'approved',
                user: { expireAt: { lt: before } },
            },
            select: { brokerUuid: true, userId: true },
        });
        for (const o of orders) {
            if (o.userId === null) continue;
            due.set(o.brokerUuid, [...(due.get(o.brokerUuid) ?? []), Number(o.userId)]);
        }
        return due;
    }

    /** Drops the stored receipt: it's never needed after a decision. False if already decided. */
    public async rejectOrder(id: number, rejectReason: string | null): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBotOrders.updateMany({
            // Only top-ups: a pending plan order is already paid, and rejecting it would hide the refund.
            where: { id, kind: 'topup', status: 'pending' },
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

    /**
     * Everything the stats page, /stats and the daily summary show, since `since` (the bot token's
     * last change). Days are UTC. An order counts on the day it was decided: a top-up when it was
     * approved, not when the receipt came in.
     */
    public async getReport(brokerUuid: string, since: Date): Promise<BotReport> {
        const now = Date.now();
        const today = now - (now % DAY_MS);
        const dayStart = (daysAgo: number) => new Date(today - daysAgo * DAY_MS);
        const customers = { brokerUuid, createdAt: { gte: since } };
        // ISO strings cast to timestamp read as UTC, like the columns Prisma writes.
        const from = since.toISOString();

        const [orderRows, customerRows, active, buyers, wallets, pending, plans] =
            await Promise.all([
                this.prisma.tx.$queryRaw<
                    { day: string; kind: string; status: string; n: number; amount: bigint }[]
                >`
                    SELECT to_char(coalesce(decided_at, created_at), 'YYYY-MM-DD') AS day,
                           kind, status, count(*)::int AS n, coalesce(sum(amount), 0)::bigint AS amount
                    FROM broker_bot_orders
                    WHERE broker_uuid = ${brokerUuid}::uuid
                      AND coalesce(decided_at, created_at) >= ${from}::timestamp
                    GROUP BY 1, 2, 3`,
                this.prisma.tx.$queryRaw<{ day: string; n: number; referred: number }[]>`
                    SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
                           count(*)::int AS n, count(referred_by_id)::int AS referred
                    FROM broker_bot_customers
                    WHERE broker_uuid = ${brokerUuid}::uuid AND created_at >= ${from}::timestamp
                    GROUP BY 1`,
                Promise.all(
                    [0, 1, 6, REPORT_DAYS - 1].map((daysAgo) =>
                        this.prisma.tx.brokerBotCustomers.count({
                            where: { ...customers, lastSeenAt: { gte: dayStart(daysAgo) } },
                        }),
                    ),
                ),
                this.prisma.tx.brokerBotCustomers.count({
                    where: {
                        brokerUuid,
                        orders: {
                            some: { kind: 'plan', status: 'approved', createdAt: { gte: since } },
                        },
                    },
                }),
                this.prisma.tx.brokerBotCustomers.aggregate({
                    where: customers,
                    _sum: { wallet: true },
                }),
                // All of them, not only since the reset: they still need a decision.
                this.prisma.tx.brokerBotOrders.count({
                    where: { brokerUuid, kind: 'topup', status: 'pending' },
                }),
                this.prisma.tx.brokerBotOrders.groupBy({
                    by: ['planId'],
                    where: {
                        brokerUuid,
                        kind: 'plan',
                        status: 'approved',
                        planId: { not: null },
                        createdAt: { gte: since },
                    },
                    _count: { planId: true },
                    _sum: { amount: true },
                    orderBy: { _count: { planId: 'desc' } },
                    take: 5,
                }),
            ]);

        const days = new Map<string, StatsPeriod>();
        const dayOf = (day: string) => days.get(day) ?? days.set(day, emptyPeriod()).get(day)!;
        for (const r of orderRows) {
            const p = dayOf(r.day);
            const amount = Number(r.amount);
            if (r.kind === 'plan' && r.status === 'approved') {
                p.sales += r.n;
                p.salesAmount += amount;
            } else if (r.kind === 'topup' && r.status === 'approved') {
                p.topups += r.n;
                p.topupsAmount += amount;
            } else if (r.kind === 'topup' && r.status === 'rejected') {
                p.rejectedTopups += r.n;
            } else if (r.kind === 'trial' && r.status === 'approved') {
                p.trials += r.n;
            } else if (r.kind === 'referral') {
                p.rewards += amount;
            }
        }
        for (const r of customerRows) {
            const p = dayOf(r.day);
            p.newCustomers += r.n;
            p.referrals += r.referred;
        }

        const daily = Array.from({ length: REPORT_DAYS }, (_, i) => {
            const date = dayStart(REPORT_DAYS - 1 - i)
                .toISOString()
                .slice(0, 10);
            return { date, ...(days.get(date) ?? emptyPeriod()) };
        });
        const sum = (rows: StatsPeriod[]) =>
            rows.reduce((acc, r) => addPeriod(acc, r), emptyPeriod());
        const strip = ({ date: _date, ...p }: StatsPeriod & { date: string }) => p;
        const window = (rows: (StatsPeriod & { date: string })[], activeCustomers: number) => ({
            ...sum(rows.map(strip)),
            activeCustomers,
        });

        const titles = await this.prisma.tx.brokerBotPlans.findMany({
            where: { id: { in: plans.map((p) => p.planId!) } },
            select: { id: true, title: true },
        });

        return {
            since,
            totals: {
                ...sum([...days.values()]),
                customers: customerRows.reduce((n, r) => n + r.n, 0),
                buyers,
                walletTotal: Number(wallets._sum.wallet ?? 0n),
                pendingReceipts: pending,
            },
            // At midnight, everyone seen since yesterday's start was active yesterday.
            yesterday: window(daily.slice(-2, -1), active[1]),
            today: window(daily.slice(-1), active[0]),
            week: window(daily.slice(-7), active[2]),
            month: window(daily, active[3]),
            daily,
            topPlans: plans.map((p) => ({
                planId: p.planId!,
                title: titles.find((t) => t.id === p.planId)?.title ?? `#${p.planId}`,
                sales: p._count.planId,
                salesAmount: p._sum.amount ?? 0,
            })),
        };
    }

    /** True once per UTC day per bot, so restarts and several API instances post one summary. */
    public async claimSummaryDay(brokerUuid: string, day: Date): Promise<boolean> {
        const { count } = await this.prisma.tx.brokerBots.updateMany({
            where: { brokerUuid, summaryPostedOn: { lt: day } },
            data: { summaryPostedOn: day },
        });
        return count === 1;
    }
}
