import { BrokerBots } from '@prisma/client';

import { Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';
import { fail, ok, TResult } from '@common/types';
import {
    ConnectBrokerBotCommand,
    CreateBrokerBotBroadcastCommand,
    GetBrokerBotBroadcastsCommand,
    CreateBrokerBotPlanCommand,
    DecideBrokerBotOrderCommand,
    GetBrokerBotCommand,
    GetBrokerBotOrdersCommand,
    TopUpBrokerBotWalletCommand,
    UpdateBrokerBotPlanCommand,
    UpdateBrokerBotSettingsCommand,
} from '@libs/contracts/commands';
import { ERRORS } from '@libs/contracts/constants';

import { BrokerEntity } from '@modules/brokers/entities';

import { BrokerBotHandler } from './bot/broker-bot.handler';
import { TelegramClient, TelegramError } from './bot/telegram.client';
import { encryptToken } from './bot/token-cipher';
import { BrokerBotRepository, OrderRow } from './broker-bot.repository';

type BotView = GetBrokerBotCommand.Response['response'];
type OrderView = GetBrokerBotOrdersCommand.Response['response']['orders'][number];

const BROADCAST_SEND_DELAY_MS = 50; // ~20 messages/s per process, well under Telegram's bulk limits

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Names and pinned headers of the staff topics, in the bot's language.
const TOPIC_TEXT = {
    en: {
        reviewName: 'Review Receipts',
        reviewIntro: '🧾 Customer payment receipts will appear here for approval.',
        logsName: 'Logs',
        logsIntro: '📜 Bot activity — approvals, rejections and errors — is logged here.',
    },
    fa: {
        reviewName: 'بررسی رسیدها',
        reviewIntro: '🧾 رسیدهای پرداخت مشتریان برای تأیید اینجا نمایش داده می‌شوند.',
        logsName: 'لاگ‌ها',
        logsIntro: '📜 فعالیت ربات — تأییدها، ردها و خطاها — اینجا ثبت می‌شود.',
    },
} as const;

@Injectable()
export class BrokerBotService {
    private readonly logger = new Logger(BrokerBotService.name);
    private readonly appSecret: string;

    constructor(
        private readonly repository: BrokerBotRepository,
        private readonly handler: BrokerBotHandler,
        configService: TypedConfigService,
    ) {
        this.appSecret = configService.getOrThrow('APP_SECRET');
    }

    public async getBot(broker: BrokerEntity): Promise<TResult<BotView>> {
        try {
            const [bot, plans, categories] = await Promise.all([
                this.repository.getBot(broker.uuid),
                this.repository.listPlans(broker.uuid),
                this.repository.listCategories(broker.uuid),
            ]);
            const isConnected = !!bot?.botToken;

            return ok({
                isConnected,
                botUsername: bot?.botUsername ?? null,
                groupId: bot?.groupId ?? null,
                topicsReady: !!bot?.reviewTopicId && !!bot?.logsTopicId,
                lang: bot?.lang === 'fa' ? 'fa' : 'en',
                greeting: bot?.greeting ?? null,
                channelUrl: bot?.channelUrl ?? null,
                cards: (bot?.cards ?? []) as BotView['cards'],
                wallets: (bot?.wallets ?? []) as BotView['wallets'],
                requiredChannels: (bot?.requiredChannels ?? []) as BotView['requiredChannels'],
                groupFinds: isConnected ? ((bot!.groupFinds ?? []) as BotView['groupFinds']) : [],
                categories,
                plans: plans.map((p) => ({
                    id: p.id,
                    title: p.title,
                    trafficGb: p.trafficGb,
                    durationDays: p.durationDays,
                    price: p.price,
                    squadUuid: p.squadUuid,
                    categoryId: p.categoryId,
                    isActive: p.isActive,
                })),
                stats: isConnected
                    ? await this.repository.getStats(broker.uuid, bot!.statsResetAt)
                    : null,
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    /**
     * Connects the bot, or changes its group, language or greeting. A blank token keeps the
     * saved one. Topics are created in the staff group whenever it is set or changes.
     */
    public async connect(
        broker: BrokerEntity,
        dto: ConnectBrokerBotCommand.Request,
    ): Promise<TResult<BotView>> {
        try {
            const existing = await this.repository.getBot(broker.uuid);
            let existingToken = '';
            try {
                existingToken = existing?.botToken ? this.handler.decrypt(existing.botToken) : '';
            } catch {
                // APP_SECRET changed since it was saved: the broker enters the token again.
            }
            const submittedToken = dto.botToken?.trim() ?? '';
            const token = submittedToken || existingToken;

            if (!token) {
                return fail({
                    ...ERRORS.BROKER_BOT_TELEGRAM_ERROR,
                    message: 'Enter the bot token.',
                });
            }

            const groupChanged = !!existing?.botToken && (existing.groupId ?? null) !== dto.groupId;

            // Same bot and group: language and greeting are read live on every update,
            // so this is a plain save. No token round trip, nothing to re-create.
            if (existingToken && !submittedToken && !groupChanged) {
                const bot = await this.repository.upsertBot(broker.uuid, {
                    lang: dto.lang,
                    greeting: dto.greeting || null,
                });
                // Topics that failed before (e.g. no manage-topics right yet) are retried here.
                const topicsError = await this.ensureTopics(
                    this.handler.client(existingToken),
                    bot,
                );
                if (topicsError) return topicsError;
                return this.getBot(broker);
            }

            const tg = this.handler.client(token);
            let botUsername: string;
            try {
                botUsername = (await tg.getMe()).username;
            } catch (error) {
                return this.telegramFail(error);
            }

            // Checked before the webhook is set, which would take the bot from its broker.
            if (await this.repository.isBotTakenByOther(broker.uuid, botUsername)) {
                return fail({
                    ...ERRORS.BROKER_BOT_TELEGRAM_ERROR,
                    message: `@${botUsername} is already connected to another broker.`,
                });
            }

            try {
                // Sets our webhook, or clears one (e.g. left by another tool) that blocks getUpdates.
                await this.handler.routeUpdates(broker.uuid, token);
            } catch (error) {
                return this.telegramFail(error);
            }

            const isNewBot =
                !existingToken || (!!submittedToken && submittedToken !== existingToken);
            const finds = (existing?.groupFinds ?? []) as { chatId: string }[];

            const bot = await this.repository.upsertBot(broker.uuid, {
                botToken: encryptToken(this.appSecret, token),
                botUsername,
                groupId: dto.groupId,
                lang: dto.lang,
                greeting: dto.greeting || null,
                // A different bot starts fresh: its own update offset and stats.
                ...(isNewBot && { updateOffset: 0, statsResetAt: new Date() }),
                ...(groupChanged && { reviewTopicId: null, logsTopicId: null }),
                ...(groupChanged &&
                    finds.some((g) => g.chatId === dto.groupId) && { groupFinds: [] }),
            });

            if (groupChanged) await this.repository.clearTicketTopics(broker.uuid);

            const topicsError = await this.ensureTopics(tg, bot);
            if (topicsError) return topicsError;

            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    private telegramFail(error: unknown): TResult<BotView> {
        return fail({
            ...ERRORS.BROKER_BOT_TELEGRAM_ERROR,
            ...(error instanceof TelegramError && { message: `Telegram: ${error.description}` }),
        });
    }

    /** Creates the Review Receipts and Logs topics when a group is set and they're missing. */
    private async ensureTopics(
        tg: ReturnType<BrokerBotHandler['client']>,
        bot: BrokerBots,
    ): Promise<TResult<BotView> | null> {
        if (!bot.groupId || (bot.reviewTopicId && bot.logsTopicId)) return null;
        const tx = TOPIC_TEXT[bot.lang === 'fa' ? 'fa' : 'en'];
        try {
            const reviewTopicId = await tg.createPinnedTopic(
                bot.groupId,
                tx.reviewName,
                tx.reviewIntro,
            );
            const logsTopicId = await tg.createPinnedTopic(bot.groupId, tx.logsName, tx.logsIntro);
            await this.repository.upsertBot(bot.brokerUuid, { reviewTopicId, logsTopicId });
            return null;
        } catch {
            return fail(ERRORS.BROKER_BOT_TOPICS_ERROR);
        }
    }

    /** Stops the bot. Plans, payment methods, channels, customers and orders stay. */
    public async disconnect(broker: BrokerEntity): Promise<TResult<BotView>> {
        try {
            const bot = await this.repository.getBot(broker.uuid);
            if (bot?.botToken) {
                await this.repository.upsertBot(broker.uuid, {
                    botToken: null,
                    botUsername: null,
                    groupId: null,
                    reviewTopicId: null,
                    logsTopicId: null,
                    lang: 'en',
                    greeting: null,
                    channelUrl: null,
                    groupFinds: [],
                    pendingRejects: {},
                });
                await this.repository.clearTicketTopics(broker.uuid);
            }
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async updateSettings(
        broker: BrokerEntity,
        dto: UpdateBrokerBotSettingsCommand.Request,
    ): Promise<TResult<BotView>> {
        try {
            if (dto.channelUrl !== undefined) {
                const bot = await this.repository.getBot(broker.uuid);
                if (!bot?.botToken) return fail(ERRORS.BROKER_BOT_NOT_CONNECTED);
            }
            await this.repository.upsertBot(broker.uuid, {
                ...(dto.channelUrl !== undefined && { channelUrl: dto.channelUrl }),
                ...(dto.cards && { cards: dto.cards }),
                ...(dto.wallets && { wallets: dto.wallets }),
                ...(dto.requiredChannels && { requiredChannels: dto.requiredChannels }),
                ...(dto.clearGroupFinds && { groupFinds: [] }),
            });
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    /** Plans may only use the broker's allowed squads and its own categories. */
    private async checkPlanRefs(
        broker: BrokerEntity,
        dto: Partial<CreateBrokerBotPlanCommand.Request>,
    ): Promise<TResult<true>> {
        if (dto.squadUuid && !broker.internalSquads.some((s) => s.uuid === dto.squadUuid)) {
            return fail(ERRORS.BROKER_SQUAD_NOT_ALLOWED);
        }
        if (
            dto.categoryId != null &&
            !(await this.repository.categoryExists(broker.uuid, dto.categoryId))
        ) {
            return fail(ERRORS.BROKER_BOT_ITEM_NOT_FOUND);
        }
        return ok(true);
    }

    public async createPlan(
        broker: BrokerEntity,
        dto: CreateBrokerBotPlanCommand.Request,
    ): Promise<TResult<BotView>> {
        try {
            const refs = await this.checkPlanRefs(broker, dto);
            if (!refs.isOk) return refs;
            await this.repository.createPlan({ brokerUuid: broker.uuid, ...dto });
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async updatePlan(
        broker: BrokerEntity,
        dto: UpdateBrokerBotPlanCommand.Request,
    ): Promise<TResult<BotView>> {
        try {
            const { id, ...fields } = dto;
            const refs = await this.checkPlanRefs(broker, fields);
            if (!refs.isOk) return refs;
            if (!(await this.repository.updatePlan(broker.uuid, id, fields))) {
                return fail(ERRORS.BROKER_BOT_ITEM_NOT_FOUND);
            }
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async deletePlan(broker: BrokerEntity, id: number): Promise<TResult<BotView>> {
        try {
            if (!(await this.repository.deletePlan(broker.uuid, id))) {
                return fail(ERRORS.BROKER_BOT_ITEM_NOT_FOUND);
            }
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async createCategory(broker: BrokerEntity, title: string): Promise<TResult<BotView>> {
        try {
            await this.repository.createCategory(broker.uuid, title);
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async deleteCategory(broker: BrokerEntity, id: number): Promise<TResult<BotView>> {
        try {
            if (!(await this.repository.deleteCategory(broker.uuid, id))) {
                return fail(ERRORS.BROKER_BOT_ITEM_NOT_FOUND);
            }
            return this.getBot(broker);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async getOrders(
        broker: BrokerEntity,
        query: GetBrokerBotOrdersCommand.RequestQuery,
    ): Promise<TResult<GetBrokerBotOrdersCommand.Response['response']>> {
        try {
            const [pending, [orders, total]] = await Promise.all([
                this.repository.listPendingReceipts(broker.uuid),
                this.repository.listOrders(broker.uuid, query.start, query.size),
            ]);
            return ok({
                pending: pending.map(toOrderView),
                orders: orders.map(toOrderView),
                total,
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async decideOrder(
        broker: BrokerEntity,
        id: number,
        dto: DecideBrokerBotOrderCommand.Request,
    ): Promise<TResult<DecideBrokerBotOrderCommand.Response['response']>> {
        try {
            const result = await this.handler.decideTopupFromPanel(
                broker.uuid,
                id,
                dto.decision,
                broker.username,
                dto.reason || undefined,
            );
            if (result === 'not_connected') return fail(ERRORS.BROKER_BOT_NOT_CONNECTED);
            if (result === 'not_pending') return fail(ERRORS.BROKER_BOT_ORDER_NOT_PENDING);
            return ok({ isDone: true });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async getReceipt(
        broker: BrokerEntity,
        id: number,
    ): Promise<TResult<{ mimeType: string; base64: string }>> {
        try {
            const image = await this.handler.getReceiptImage(broker.uuid, id);
            if (!image) return fail(ERRORS.BROKER_BOT_ITEM_NOT_FOUND);
            return ok({ mimeType: image.mime, base64: image.bytes.toString('base64') });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    public async topUp(
        broker: BrokerEntity,
        dto: TopUpBrokerBotWalletCommand.Request,
    ): Promise<TResult<TopUpBrokerBotWalletCommand.Response['response']>> {
        try {
            const result = await this.handler.manualTopup(broker.uuid, dto.telegramId, dto.amount);
            if (!result) return fail(ERRORS.BROKER_BOT_CUSTOMER_NOT_FOUND);
            return ok({ name: result.name, balance: Number(result.balance) });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    // ---- Broadcasts (admin) ----

    public async getBroadcasts(): Promise<
        TResult<GetBrokerBotBroadcastsCommand.Response['response']>
    > {
        try {
            const [audience, broadcasts] = await Promise.all([
                this.repository.countBroadcastAudience(),
                this.repository.listBroadcasts(),
            ]);
            return ok({
                audience,
                broadcasts: broadcasts.map((b) => ({
                    id: b.id,
                    caption: b.caption,
                    hasMedia: b.hasMedia,
                    recipients: b.recipients,
                    sent: b.sent,
                    failed: b.failed,
                    // A broadcast runs in the API process that started it, so a restart mid-way
                    // leaves it "sending" forever. Past any plausible run time it is shown as done.
                    status:
                        b.status === 'sending' &&
                        Date.now() - b.createdAt.getTime() < b.recipients * 500 + 600_000
                            ? 'sending'
                            : 'done',
                    createdAt: b.createdAt,
                })),
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    /** Starts a broadcast and returns at once: throttled delivery can take minutes. */
    public async createBroadcast(
        dto: CreateBrokerBotBroadcastCommand.Request,
    ): Promise<TResult<CreateBrokerBotBroadcastCommand.Response['response']>> {
        try {
            const recipients = await this.repository.countBroadcastAudience();
            if (recipients === 0) return fail(ERRORS.BROKER_BOT_BROADCAST_NO_AUDIENCE);

            const media = dto.image
                ? {
                      bytes: Buffer.from(dto.image.base64, 'base64'),
                      fileName: dto.image.fileName || 'photo.jpg',
                      mimeType: dto.image.mimeType,
                  }
                : null;
            const caption = dto.caption || null;
            const broadcast = await this.repository.createBroadcast(caption, !!media, recipients);

            void this.runBroadcast(broadcast.id, caption, media).catch((error) =>
                this.logger.error(error),
            );
            return ok({ id: broadcast.id, recipients });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.BROKER_BOT_ERROR);
        }
    }

    /**
     * Sends to every customer of every connected bot, through each broker's own bot. Blocked or
     * deleted accounts count as failed; a rate limit gets one retry after a pause.
     */
    private async runBroadcast(
        id: number,
        caption: string | null,
        media: { bytes: Buffer; fileName: string; mimeType: string } | null,
    ): Promise<void> {
        let sent = 0;
        let failed = 0;
        try {
            for (const bot of await this.repository.listConnectedBots()) {
                let tg: TelegramClient;
                try {
                    tg = this.handler.client(this.handler.decrypt(bot.botToken!));
                } catch {
                    continue;
                }

                let fileId: string | undefined; // upload once per bot, then reuse
                for (const chatId of await this.repository.listCustomerChatIds(bot.brokerUuid)) {
                    const attempt = async () => {
                        if (media) {
                            const r = await tg.sendPhoto(
                                chatId,
                                fileId ?? media,
                                caption ?? undefined,
                            );
                            fileId ??= r.fileId;
                        } else {
                            await tg.sendMessage(chatId, caption!);
                        }
                    };
                    try {
                        await attempt();
                        sent++;
                    } catch (error) {
                        if (error instanceof TelegramError && error.code === 429) {
                            await sleep(1_500);
                            try {
                                await attempt();
                                sent++;
                            } catch {
                                failed++;
                            }
                        } else {
                            failed++;
                        }
                    }
                    await sleep(BROADCAST_SEND_DELAY_MS);
                    // Saved as it goes, so an interrupted broadcast still shows what went out.
                    if ((sent + failed) % 25 === 0) {
                        await this.repository.saveBroadcastProgress(id, sent, failed);
                    }
                }
            }
        } finally {
            await this.repository.finishBroadcast(id, sent, failed);
        }
    }
}

function toOrderView(o: OrderRow): OrderView {
    return {
        id: o.id,
        kind: o.kind as OrderView['kind'],
        status: o.status as OrderView['status'],
        amount: o.amount,
        receiptKind: o.receiptKind as OrderView['receiptKind'],
        receiptText: o.receiptText,
        rejectReason: o.rejectReason,
        planTitle: o.plan?.title ?? null,
        customer: o.customer,
        createdAt: o.createdAt,
    };
}
