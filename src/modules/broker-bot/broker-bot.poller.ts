import { timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { BrokerBotHandler, TgUpdate } from './bot/broker-bot.handler';
import { BrokerBotRepository } from './broker-bot.repository';

const RECONCILE_INTERVAL_MS = 5_000;
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

    constructor(
        private readonly repository: BrokerBotRepository,
        private readonly handler: BrokerBotHandler,
    ) {}

    onApplicationBootstrap(): void {
        if ((process.env.INSTANCE_ID ?? '0') !== '0') return;
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
            const bots = await this.repository.listConnectedBots();
            const wanted = new Map(bots.map((b) => [b.brokerUuid, b]));

            for (const [brokerUuid, loop] of this.loops) {
                if (wanted.get(brokerUuid)?.botToken !== loop.botToken) {
                    loop.abort.abort();
                    this.loops.delete(brokerUuid);
                }
            }
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
                if (this.handler.webhookUrl(brokerUuid)) return;

                const updates = await tg.getUpdates(offset, LONG_POLL_SEC, signal);
                for (const update of updates) {
                    if (signal.aborted) return;
                    // Saved before handling: a crash mid-update drops it rather than repeating
                    // a top-up or a purchase.
                    offset = update.update_id + 1;
                    await this.repository.setUpdateOffset(brokerUuid, offset);

                    const ctx = await this.handler.context(brokerUuid, tg);
                    if (ctx) await this.handler.handleUpdate(ctx, update as unknown as TgUpdate);
                }
            } catch (error) {
                if (signal.aborted) return;
                this.logger.warn(
                    `Broker ${brokerUuid} bot: ${error instanceof Error ? error.message : error}`,
                );
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    /**
     * One webhook call. False means the secret is wrong. Telegram resends an update until it
     * gets a 200, so a repeat of the last update is skipped, as the polling offset would.
     */
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

        if (typeof update?.update_id !== 'number' || update.update_id + 1 === bot.updateOffset) {
            return true;
        }
        await this.repository.setUpdateOffset(brokerUuid, update.update_id + 1);

        const ctx = await this.handler.context(brokerUuid, this.handler.client(token));
        if (ctx) await this.handler.handleUpdate(ctx, update);
        return true;
    }
}
