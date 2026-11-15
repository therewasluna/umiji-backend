import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { BrokerBotHandler, TgUpdate } from './bot/broker-bot.handler';
import { TelegramError } from './bot/telegram.client';
import { BrokerBotRepository } from './broker-bot.repository';

const RECONCILE_INTERVAL_MS = 5_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const LONG_POLL_SEC = 30;
const RETRY_DELAY_MS = 5_000;

/**
 * Gets every connected broker bot its updates. By default it long-polls, so no public URL is
 * needed. With BROKER_BOT_WEBHOOK_DOMAIN set it only registers the webhooks, and Telegram posts
 * to BrokerBotWebhookController on any API instance. The loops run in API instance 0 only: two
 * pollers on one token make Telegram reject both (409).
 */
@Injectable()
export class BrokerBotPoller implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(BrokerBotPoller.name);
    private readonly loops = new Map<string, { botToken: string; abort: AbortController }>();
    private timer: NodeJS.Timeout | undefined;
    private isReconciling = false;
    // shortcut: per process, so one bot's updates run one at a time only on a single API instance (the
    // trial's daily cap relies on it). Webhook mode with API_INSTANCES > 1 needs this lock in Valkey.
    private readonly processingBots = new Set<string>();
    private lastUpdateCleanup = 0;
    private lastStaleUpdateRequeue = 0;
    private lastTrialCleanup = 0;

    constructor(
        private readonly repository: BrokerBotRepository,
        private readonly handler: BrokerBotHandler,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if ((process.env.INSTANCE_ID ?? '0') !== '0') return;
        await this.repository.requeueProcessingUpdates();
        this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
        void this.reconcile();
    }

    onApplicationShutdown(): void {
        clearInterval(this.timer);
        for (const loop of this.loops.values()) loop.abort.abort();
        this.loops.clear();
    }

    /** Starts loops for newly connected bots, stops them for disconnected or re-tokened ones. */
    private async reconcile(): Promise<void> {
        if (this.isReconciling) return;
        this.isReconciling = true;
        try {
            if (Date.now() - this.lastStaleUpdateRequeue > RECONCILE_INTERVAL_MS) {
                await this.repository.requeueStaleUpdates(new Date(Date.now() - 300_000));
                this.lastStaleUpdateRequeue = Date.now();
            }
            if (Date.now() - this.lastUpdateCleanup > DAY_MS) {
                await this.repository.deleteProcessedUpdates(new Date(Date.now() - 2 * DAY_MS));
                this.lastUpdateCleanup = Date.now();
            }

            if (Date.now() - this.lastTrialCleanup > HOUR_MS) {
                this.lastTrialCleanup = Date.now();
                void this.handler
                    .deleteExpiredTrials()
                    .catch((error) => this.logger.warn(`Expired trials cleanup: ${error}`));
            }

            const bots = await this.repository.listConnectedBots();
            const wanted = new Map(bots.map((b) => [b.brokerUuid, b]));

            for (const [brokerUuid, loop] of this.loops) {
                if (wanted.get(brokerUuid)?.botToken !== loop.botToken) {
                    loop.abort.abort();
                    this.loops.delete(brokerUuid);
                }
            }
            // Daily summaries are due once the UTC day changes; postDailySummary claims each one.
            const today = new Date(Date.now() - (Date.now() % DAY_MS));
            const due = bots.filter((b) => b.summaryPostedOn < today).map((b) => b.brokerUuid);
            if (due.length) void this.postSummaries(due, today);

            for (const bot of bots) {
                if (this.loops.has(bot.brokerUuid) || !bot.botToken) continue;
                const abort = new AbortController();
                this.loops.set(bot.brokerUuid, { botToken: bot.botToken, abort });
                void this.run(bot.brokerUuid, bot.botToken, bot.updateOffset, abort.signal);
            }
        } catch (error) {
            this.logger.error(error);
        } finally {
            this.isReconciling = false;
        }
    }

    /** Each bot's daily summary in its staff group, one at a time. */
    private async postSummaries(brokerUuids: string[], today: Date): Promise<void> {
        for (const brokerUuid of brokerUuids) {
            try {
                await this.handler.postDailySummary(brokerUuid, today);
            } catch (error) {
                this.logger.warn(
                    `Broker ${brokerUuid} daily summary: ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }

    private async run(
        brokerUuid: string,
        botToken: string,
        offset: number,
        signal: AbortSignal,
    ): Promise<void> {
        let token: string;
        try {
            token = this.handler.decrypt(botToken);
        } catch {
            // APP_SECRET changed since the token was saved: the broker has to save it again.
            this.logger.error(`Can't decrypt the bot token of broker ${brokerUuid}`);
            return;
        }
        const tg = this.handler.client(token);

        let isRouted = false;
        while (!signal.aborted) {
            try {
                // Once per loop, so switching BROKER_BOT_WEBHOOK_DOMAIN applies on restart.
                if (!isRouted) {
                    await this.handler.routeUpdates(brokerUuid, token);
                    isRouted = true;
                }
                if (this.handler.webhookUrl(brokerUuid)) {
                    await this.processPendingUpdates(brokerUuid, tg, signal);
                    await new Promise((resolve) => setTimeout(resolve, RECONCILE_INTERVAL_MS));
                    continue;
                }

                const updates = await tg.getUpdates(offset, LONG_POLL_SEC, signal);
                for (const update of updates) {
                    if (signal.aborted) return;
                    await this.repository.enqueueUpdate(
                        brokerUuid,
                        update.update_id,
                        update as unknown as Prisma.InputJsonValue,
                    );
                    offset = update.update_id + 1;
                    await this.repository.setUpdateOffset(brokerUuid, offset);
                }
                await this.processPendingUpdates(brokerUuid, tg, signal);
            } catch (error) {
                if (signal.aborted) return;
                this.logger.warn(
                    `Broker ${brokerUuid} bot: ${error instanceof Error ? error.message : error}`,
                );
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    private async processPendingUpdates(
        brokerUuid: string,
        tg: ReturnType<BrokerBotHandler['client']>,
        signal: AbortSignal,
    ): Promise<void> {
        if (this.processingBots.has(brokerUuid)) return;
        this.processingBots.add(brokerUuid);

        try {
            while (!signal.aborted) {
                const update = await this.repository.getNextPendingUpdate(brokerUuid);
                if (!update) return;
                if (!(await this.repository.claimUpdate(brokerUuid, update.updateId))) continue;

                try {
                    const ctx = await this.handler.context(brokerUuid, tg, Number(update.updateId));
                    if (!ctx) throw new Error('Bot context is unavailable');
                    await this.handler.handleUpdate(ctx, update.payload as unknown as TgUpdate);
                    await this.repository.completeUpdate(brokerUuid, update.updateId);
                } catch (error) {
                    // A 4xx from Telegram (bot blocked, button too old) fails the same way every time.
                    const isPermanent =
                        error instanceof TelegramError &&
                        error.code !== undefined &&
                        error.code >= 400 &&
                        error.code < 500 &&
                        error.code !== 429;
                    await this.repository.failUpdate(
                        brokerUuid,
                        update.updateId,
                        update.attempts,
                        !isPermanent,
                    );
                    this.logger.warn(
                        `Broker ${brokerUuid} update ${update.updateId}: ${error instanceof Error ? error.message : error}`,
                    );
                }
            }
        } finally {
            this.processingBots.delete(brokerUuid);
        }
    }

    /** Stores a validated webhook update before returning success to Telegram. */
    public async handleWebhook(
        brokerUuid: string,
        secret: string | undefined,
        update: TgUpdate,
    ): Promise<boolean> {
        const bot = await this.repository.getBot(brokerUuid);
        if (!bot?.botToken) return true;

        let token: string;
        try {
            token = this.handler.decrypt(bot.botToken);
        } catch {
            return true;
        }
        const expected = Buffer.from(this.handler.webhookSecret(token));
        const given = Buffer.from(secret ?? '');
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;

        if (typeof update?.update_id !== 'number' || !Number.isSafeInteger(update.update_id)) {
            return true;
        }
        await this.repository.enqueueUpdate(
            brokerUuid,
            update.update_id,
            update as unknown as Prisma.InputJsonValue,
        );
        await this.repository.setUpdateOffset(brokerUuid, update.update_id + 1);
        // Handled now rather than on the next loop tick; it's stored, so a failure here only retries.
        await this.processPendingUpdates(
            brokerUuid,
            this.handler.client(token),
            new AbortController().signal,
        ).catch((error) =>
            this.logger.warn(
                `Broker ${brokerUuid} bot: ${error instanceof Error ? error.message : error}`,
            ),
        );
        return true;
    }
}
