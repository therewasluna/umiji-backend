import {
    BrokerBotCustomers,
    BrokerBotOrders,
    BrokerBotPlans,
    BrokerBots,
    Prisma,
} from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { TypedConfigService } from '@common/config/app-config';
import { TResult } from '@common/types';
import { REST_API } from '@libs/contracts/api';
import { CreateUserCommand } from '@libs/contracts/commands';

import { BrokerEntity } from '@modules/brokers/entities';
import { GetBrokerByUuidQuery } from '@modules/brokers/queries/get-broker-by-uuid';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { UsersService } from '@modules/users/users.service';

import { BrokerBotRepository } from '../broker-bot.repository';
import {
    adminName,
    esc,
    formatBytes,
    formatToman,
    Lang,
    M,
    menuKeyboard,
    planDetails,
    planLabel,
} from './bot.messages';
import { InlineButton, InlineKeyboard, TelegramClient, TelegramError } from './telegram.client';
import { decryptToken } from './token-cipher';

const MAX_PENDING_ORDERS = 5; // per customer
const DM_RATE_LIMIT = 20; // messages
const DM_RATE_WINDOW = 60_000; // per minute
const MAX_TOMAN = 100_000_000;
const GB_BYTES = 1_073_741_824;
const SUBS_PER_PAGE = 10;
// Telegram refuses longer messages.
const MAX_MESSAGE_LENGTH = 4096;

/** Fingerprint of what the customer agreed to on the plan review screen. */
function planTerms(p: BrokerBotPlans): string {
    return createHash('sha256')
        .update(`${p.title}|${p.price}|${p.trafficGb}|${p.durationDays}|${p.squadUuid}`)
        .digest('hex')
        .slice(0, 8);
}

// ----------------------- minimal Telegram update types -----------------------

interface TgUser {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
}
interface TgChat {
    id: number;
    type: string;
    title?: string;
}
interface TgMessage {
    message_id: number;
    message_thread_id?: number;
    from?: TgUser;
    chat: TgChat;
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
}
interface TgCallback {
    id: string;
    from: TgUser;
    data?: string;
    message?: TgMessage;
}
export interface TgUpdate {
    update_id: number;
    message?: TgMessage;
    callback_query?: TgCallback;
}

interface Ctx {
    broker: BrokerEntity;
    bot: BrokerBots;
    tg: TelegramClient;
    lang: Lang;
}

/** A message we can edit in place (the one a button was attached to). */
interface Screen {
    chatId: string;
    messageId: number;
}

interface Card {
    cardNumber: string;
    holderName: string;
}
interface Wallet {
    asset: string;
    address: string;
}
interface RequiredChannel {
    chatRef: string;
    title: string;
    url: string;
}

/** Per-broker Telegram store: customers buy plans from a prepaid wallet topped up by receipts. */
@Injectable()
export class BrokerBotHandler {
    private readonly logger = new Logger(BrokerBotHandler.name);
    private readonly appSecret: string;
    private readonly subPublicDomain: string;
    private readonly apiRoot: string;
    private readonly proxy: string | undefined;
    private readonly webhookDomain: string | undefined;
    // shortcut: in-memory fixed window per API process; with webhooks behind several API
    // instances each counts on its own. Move to Valkey if that lets floods through.
    private readonly rateBuckets = new Map<string, { count: number; reset: number }>();
    // Decrypted tokens by stored blob (null: can't decrypt). scrypt blocks the event loop for
    // ~20 ms, and the unauthenticated webhook would otherwise pay that on every call.
    private readonly tokens = new Map<string, null | string>();

    constructor(
        private readonly repository: BrokerBotRepository,
        private readonly usersService: UsersService,
        private readonly subscriptionService: SubscriptionService,
        private readonly queryBus: QueryBus,
        configService: TypedConfigService,
    ) {
        this.appSecret = configService.getOrThrow('APP_SECRET');
        this.subPublicDomain = configService.getOrThrow('SUB_PUBLIC_DOMAIN');
        this.apiRoot = configService.get('TELEGRAM_BOT_API_ROOT') ?? 'https://api.telegram.org';
        this.proxy = configService.get('TELEGRAM_BOT_PROXY') || undefined;
        this.webhookDomain = configService.get('BROKER_BOT_WEBHOOK_DOMAIN') || undefined;
    }

    /** Where Telegram posts this broker's updates, or null when the bots long-poll. */
    public webhookUrl(brokerUuid: string): string | null {
        return this.webhookDomain
            ? `https://${this.webhookDomain}${REST_API.BROKER_BOT.WEBHOOK(brokerUuid)}`
            : null;
    }

    /** Telegram echoes it on every webhook call. Tied to the token, so a replaced bot is refused. */
    public webhookSecret(token: string): string {
        return createHmac('sha256', this.appSecret)
            .update(`broker-bot-webhook:${token}`)
            .digest('hex');
    }

    /** Points the bot at this panel: sets the webhook, or clears one so getUpdates works. */
    public async routeUpdates(brokerUuid: string, token: string): Promise<void> {
        const url = this.webhookUrl(brokerUuid);
        const tg = this.client(token);
        await (url ? tg.setWebhook(url, this.webhookSecret(token)) : tg.deleteWebhook());
    }

    public client(token: string): TelegramClient {
        return new TelegramClient(token, { apiRoot: this.apiRoot, proxy: this.proxy });
    }

    public decrypt(botToken: string): string {
        if (!this.tokens.has(botToken)) {
            // Replaced tokens leave old blobs behind, only as fast as brokers re-connect bots.
            if (this.tokens.size >= 1_000) this.tokens.clear();
            let token: null | string = null;
            try {
                token = decryptToken(this.appSecret, botToken);
            } catch {
                // APP_SECRET changed since the token was saved; remembered so it's not retried.
            }
            this.tokens.set(botToken, token);
        }
        const token = this.tokens.get(botToken);
        if (!token)
            throw new Error("Can't decrypt the bot token: APP_SECRET changed since it was saved.");
        return token;
    }

    /** Fresh broker + bot state for one update, so panel edits apply right away. */
    public async context(brokerUuid: string, tg: TelegramClient): Promise<Ctx | null> {
        const [bot, broker] = await Promise.all([
            this.repository.getBot(brokerUuid),
            this.getBroker(brokerUuid),
        ]);
        if (!bot?.botToken || !broker) return null;
        return { broker, bot, tg, lang: bot.lang === 'fa' ? 'fa' : 'en' };
    }

    private async getBroker(uuid: string): Promise<BrokerEntity | null> {
        const result = await this.queryBus.execute<GetBrokerByUuidQuery, TResult<BrokerEntity>>(
            new GetBrokerByUuidQuery(uuid),
        );
        return result.isOk ? result.response : null;
    }

    private subUrl(shortUuid: string): string {
        return `https://${this.subPublicDomain}/${shortUuid}`;
    }

    private rateLimit(key: string, limit: number, windowMs: number): boolean {
        const now = Date.now();
        const b = this.rateBuckets.get(key);
        if (!b || now > b.reset) {
            // Drop finished windows now and then, so one-off senders don't pile up forever.
            if (this.rateBuckets.size >= 10_000) {
                for (const [k, v] of this.rateBuckets)
                    if (now > v.reset) this.rateBuckets.delete(k);
            }
            this.rateBuckets.set(key, { count: 1, reset: now + windowMs });
            return true;
        }
        if (b.count >= limit) return false;
        b.count++;
        return true;
    }

    /** A disabled, expired or out-of-quota broker can't sell. */
    private canSell(broker: BrokerEntity): boolean {
        return !broker.isDisabled && !broker.isExpired && !broker.isTrafficLimitReached;
    }

    /** Like the panel: a disabled broker is locked out and an expired one is read-only. */
    private canDecide(broker: BrokerEntity): boolean {
        return !broker.isDisabled && !broker.isExpired;
    }

    private log(ctx: Ctx, text: string): void {
        if (ctx.bot.groupId && ctx.bot.logsTopicId) {
            void ctx.tg
                .sendMessage(ctx.bot.groupId, text, { messageThreadId: ctx.bot.logsTopicId })
                .catch(() => {});
        }
    }

    // ----------------------- entry point -----------------------

    public async handleUpdate(ctx: Ctx, update: TgUpdate): Promise<void> {
        try {
            if (update.callback_query) {
                await this.handleCallback(ctx, update.callback_query);
            } else if (update.message) {
                const msg = update.message;
                if (msg.from?.is_bot) return;
                if (msg.chat.type === 'private') {
                    // Rate-limit customer DMs to bound flooding of the staff group / DB.
                    if (
                        msg.from &&
                        !this.rateLimit(
                            `tgdm:${ctx.broker.uuid}:${msg.from.id}`,
                            DM_RATE_LIMIT,
                            DM_RATE_WINDOW,
                        )
                    ) {
                        return;
                    }
                    await this.handleDM(ctx, msg);
                } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
                    // /find works in ANY group, even before it is the configured one,
                    // so brokers can discover the group ID during first-time setup.
                    const cmd = msg.text?.trim().split(/\s+/)[0]?.split('@')[0];
                    if (cmd === '/find') {
                        if (this.rateLimit(`tgfind:${ctx.broker.uuid}:${msg.chat.id}`, 3, 60_000)) {
                            await this.handleFind(ctx, msg);
                        }
                    } else if (String(msg.chat.id) === ctx.bot.groupId) {
                        await this.handleGroupMessage(ctx, msg);
                    }
                }
            }
        } catch (error) {
            this.logger.error(error);
            this.log(
                ctx,
                M[ctx.lang].logError(error instanceof Error ? error.message : String(error)),
            );
        }
    }

    // ----------------------- customer DM -----------------------

    private customerFrom(ctx: Ctx, from: TgUser, chatId: string): Promise<BrokerBotCustomers> {
        return this.repository.upsertCustomer({
            brokerUuid: ctx.broker.uuid,
            tgUserId: String(from.id),
            chatId,
            name: from.first_name ?? null,
            username: from.username ?? null,
        });
    }

    private menuText(ctx: Ctx): string {
        // A broker's custom greeting is plain text, so escape it for HTML mode.
        const custom = ctx.bot.greeting?.trim();
        return custom ? esc(custom) : M[ctx.lang].greeting;
    }

    /** Edits a screen in place, so the chat stays a single, morphing message. */
    private async showScreen(
        ctx: Ctx,
        screen: Screen,
        text: string,
        keyboard: InlineKeyboard,
    ): Promise<void> {
        try {
            await ctx.tg.editMessageText(screen.chatId, screen.messageId, text, keyboard, 'HTML');
        } catch {
            // "message is not modified" and similar: navigation edits are best-effort.
        }
    }

    private backRow(lang: Lang, target: string): InlineButton[] {
        return [{ text: M[lang].btnBack, callback_data: target }];
    }

    /** The main menu as a NEW message (for /start). */
    private async sendMenu(ctx: Ctx, chatId: string): Promise<void> {
        await ctx.tg.sendMessage(chatId, this.menuText(ctx), {
            keyboard: menuKeyboard(ctx.lang, ctx.bot.channelUrl),
            parseMode: 'HTML',
        });
    }

    private async editMenu(ctx: Ctx, screen: Screen): Promise<void> {
        await this.showScreen(
            ctx,
            screen,
            this.menuText(ctx),
            menuKeyboard(ctx.lang, ctx.bot.channelUrl),
        );
    }

    private async handleDM(ctx: Ctx, msg: TgMessage): Promise<void> {
        const customer = await this.customerFrom(ctx, msg.from!, String(msg.chat.id));

        // Force-subscribe gate: nothing works until mandatory channels are joined.
        if (!(await this.gateJoin(ctx, customer.chatId, msg.from!.id))) return;

        const text = msg.text?.trim();

        if (text === '/start') {
            await this.repository.setCustomerState(customer.id, 'none');
            await this.sendMenu(ctx, customer.chatId);
            return;
        }

        if (customer.state === 'awaiting_topup_amount') {
            await this.handleTopupAmount(ctx, customer, text ?? '');
            return;
        }

        if (customer.state === 'awaiting_receipt') {
            await this.submitReceipt(ctx, customer, msg);
            return;
        }

        if (customer.state === 'support') {
            await this.relayCustomerToTicket(ctx, customer, msg);
            return;
        }

        await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].useMenu, {
            keyboard: menuKeyboard(ctx.lang, ctx.bot.channelUrl),
            parseMode: 'HTML',
        });
    }

    /** A top-up receipt: posted to the review topic for an admin to approve. */
    private async submitReceipt(ctx: Ctx, customer: BrokerBotCustomers, msg: TgMessage) {
        const amount = customer.stateAmount;
        await this.repository.setCustomerState(customer.id, 'none');
        if (!amount || amount <= 0) {
            await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].unavailable, {
                parseMode: 'HTML',
            });
            return;
        }

        // The broker's state, the staff group and the pending cap were checked before the
        // customer was told where to pay. They may have sent money since, so the receipt is
        // always kept: it can be decided on the panel's Orders page too.
        const order = await this.repository.createTopupOrder(ctx.broker.uuid, customer.id, amount);

        // Kept so the receipt can be reviewed in the broker panel too.
        if (msg.photo?.length) {
            await this.repository.setOrderReceipt(
                order.id,
                'photo',
                msg.photo[msg.photo.length - 1].file_id,
                msg.caption ?? null,
            );
        } else if (msg.text) {
            await this.repository.setOrderReceipt(order.id, 'text', null, msg.text);
        }

        if (ctx.bot.groupId && ctx.bot.reviewTopicId) {
            // 1) Copy the customer's actual receipt (photo or text) into the review topic.
            const copied = await ctx.tg.copyMessage({
                toChatId: ctx.bot.groupId,
                fromChatId: customer.chatId,
                messageId: msg.message_id,
                messageThreadId: ctx.bot.reviewTopicId,
            });

            // 2) The top-up details + approve/reject buttons as a reply beneath it.
            const details = await ctx.tg.sendMessage(
                ctx.bot.groupId,
                this.topupDetails(order, customer, ctx.lang),
                {
                    messageThreadId: ctx.bot.reviewTopicId,
                    replyToMessageId: copied.message_id,
                    keyboard: this.reviewKeyboard(order.id),
                },
            );
            await this.repository.setOrderReviewMessage(order.id, details.message_id);
        }
        await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].topupSubmitted, {
            parseMode: 'HTML',
        });
    }

    private async relayCustomerToTicket(ctx: Ctx, customer: BrokerBotCustomers, msg: TgMessage) {
        const groupId = ctx.bot.groupId;
        if (!groupId) {
            // Tickets are topics in the staff group; without one, say so instead of going silent.
            await this.repository.setCustomerState(customer.id, 'none');
            await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].supportUnavailable, {
                parseMode: 'HTML',
            });
            return;
        }
        const relay = (topicId: number) =>
            msg.text
                ? ctx.tg.sendMessage(groupId, `👤 ${msg.text}`, { messageThreadId: topicId })
                : ctx.tg.copyMessage({
                      toChatId: groupId,
                      fromChatId: customer.chatId,
                      messageId: msg.message_id,
                      messageThreadId: topicId,
                  });

        try {
            await relay(customer.ticketTopicId ?? (await this.openTicket(ctx, customer)));
        } catch (error) {
            // Staff deleted or closed the ticket topic: open a new one.
            const isTopicGone =
                error instanceof TelegramError &&
                /thread not found|TOPIC_(CLOSED|DELETED)/i.test(error.description);
            if (!customer.ticketTopicId || !isTopicGone) throw error;
            await relay(await this.openTicket(ctx, customer));
        }
        // Reassure the customer their message went through.
        await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].supportSent, { parseMode: 'HTML' });
    }

    private async openTicket(ctx: Ctx, customer: BrokerBotCustomers): Promise<number> {
        const name = customer.name ?? customer.username ?? customer.tgUserId;
        const topicId = await ctx.tg.createForumTopic(ctx.bot.groupId!, `🎫 ${name}`);
        await this.repository.setTicketTopic(customer.id, topicId);
        await ctx.tg.sendMessage(
            ctx.bot.groupId!,
            `New support ticket from ${name} (id ${customer.tgUserId}). Reply here to answer.`,
            { messageThreadId: topicId },
        );
        return topicId;
    }

    // ----------------------- wallet, top-up & checkout -----------------------

    private async showWallet(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        await this.showScreen(ctx, screen, M[ctx.lang].walletScreen(formatToman(customer.wallet)), [
            [{ text: M[ctx.lang].btnCharge, callback_data: 'charge', style: 'primary' }],
            this.backRow(ctx.lang, 'menu'),
        ]);
    }

    /** Why the customer can't top up now. Checked before they are told where to send money. */
    private async topupBlockedText(ctx: Ctx, customer: BrokerBotCustomers): Promise<null | string> {
        // No money in while the broker can't sell.
        if (!this.canSell(ctx.broker)) return M[ctx.lang].unavailable;
        const cards = ctx.bot.cards as unknown as Card[];
        const wallets = ctx.bot.wallets as unknown as Wallet[];
        if (cards.length === 0 && wallets.length === 0) return M[ctx.lang].topupNoMethods;
        // Receipts are reviewed in the staff group's topic.
        if (!ctx.bot.groupId || !ctx.bot.reviewTopicId) return M[ctx.lang].topupNoMethods;
        const pending = await this.repository.countPendingByCustomer(ctx.broker.uuid, customer.id);
        return pending >= MAX_PENDING_ORDERS ? M[ctx.lang].tooManyPending : null;
    }

    private async startCharge(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        const blocked = await this.topupBlockedText(ctx, customer);
        if (blocked) {
            await this.showScreen(ctx, screen, blocked, [this.backRow(ctx.lang, 'wallet')]);
            return;
        }
        await this.repository.setCustomerState(customer.id, 'awaiting_topup_amount');
        await this.showScreen(ctx, screen, M[ctx.lang].chargePrompt, [
            this.backRow(ctx.lang, 'wallet'),
        ]);
    }

    /** The customer typed a top-up amount: show where to pay and wait for the receipt. */
    private async handleTopupAmount(ctx: Ctx, customer: BrokerBotCustomers, raw: string) {
        const blocked = await this.topupBlockedText(ctx, customer);
        if (blocked) {
            await this.repository.setCustomerState(customer.id, 'none');
            await ctx.tg.sendMessage(customer.chatId, blocked, { parseMode: 'HTML' });
            return;
        }
        const digits = raw.replace(/[\s,٬_]/g, ''); // strip thousands separators / spaces
        if (!/^\d+$/.test(digits) || Number(digits) <= 0 || Number(digits) > MAX_TOMAN) {
            await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].invalidAmount, {
                parseMode: 'HTML',
            });
            return;
        }
        const amount = Number(digits);

        const cards = ctx.bot.cards as unknown as Card[];
        const wallets = ctx.bot.wallets as unknown as Wallet[];
        const destinations = [
            ...cards.map(
                (c) => `💳 <b>${esc(c.holderName)}</b>\n<code>${esc(c.cardNumber)}</code>`,
            ),
            ...wallets.map((w) => `🪙 <b>${esc(w.asset)}</b>\n<code>${esc(w.address)}</code>`),
        ].join('\n\n');
        await this.repository.setCustomerState(customer.id, 'awaiting_receipt', amount);
        await ctx.tg.sendMessage(
            customer.chatId,
            M[ctx.lang].topupInstructions(formatToman(amount), destinations),
            { parseMode: 'HTML' },
        );
    }

    /** Plan review: details, the wallet balance and a "pay from wallet" button. */
    private async showPlanReview(
        ctx: Ctx,
        screen: Screen,
        customer: BrokerBotCustomers,
        planId: number,
    ) {
        const plan = await this.repository.getPlan(ctx.broker.uuid, planId);
        if (!plan || !this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, M[ctx.lang].unavailable, [
                this.backRow(ctx.lang, 'menu'),
            ]);
            return;
        }
        const text = `${planDetails(plan, ctx.lang)}\n\n${M[ctx.lang].reviewBalance(formatToman(customer.wallet))}`;
        await this.showScreen(ctx, screen, text, [
            [
                {
                    text: M[ctx.lang].btnBuyWallet,
                    // The terms catch plan edits since this screen; the key makes it pay once.
                    callback_data: `pur:${plan.id}:${planTerms(plan)}:${randomBytes(4).toString('hex')}`,
                    style: 'primary',
                },
            ],
            this.backRow(ctx.lang, 'buy'),
        ]);
    }

    /** Instant purchase: pay from the wallet, then create the user (refunded if that fails). */
    private async purchaseFromWallet(
        ctx: Ctx,
        screen: Screen,
        customer: BrokerBotCustomers,
        planId: number,
        terms: string | undefined,
        checkoutKey: string | undefined,
    ) {
        const unavailable = () =>
            this.showScreen(ctx, screen, M[ctx.lang].unavailable, [this.backRow(ctx.lang, 'menu')]);

        const plan = await this.repository.getPlan(ctx.broker.uuid, planId);
        // ctx.broker is fresh per update, but re-read anyway: the purchase must see the latest
        // quota, users count and squads.
        const broker = (await this.getBroker(ctx.broker.uuid)) ?? ctx.broker;
        if (!plan || !plan.isActive || !this.canSell(broker)) {
            await unavailable();
            return;
        }
        // The broker changed the plan since the customer saw it: show the new terms, don't charge.
        if (!checkoutKey || terms !== planTerms(plan)) {
            await this.showPlanReview(ctx, screen, customer, plan.id);
            return;
        }
        const squadAllowed = broker.internalSquads.some((s) => s.uuid === plan.squadUuid);
        const usersLimitReached =
            broker.usersLimit !== null && broker.usersCount >= broker.usersLimit;
        if (!plan.squadUuid || !squadAllowed || usersLimitReached) {
            await unavailable();
            return;
        }

        let orderId: null | number;
        try {
            orderId = await this.repository.payForPlan({
                brokerUuid: broker.uuid,
                customerId: customer.id,
                planId: plan.id,
                amount: plan.price,
                checkoutKey,
            });
        } catch (error) {
            // This review screen was paid already (a double tap): that purchase answered.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return;
            }
            throw error;
        }
        if (orderId === null) {
            await this.showScreen(
                ctx,
                screen,
                M[ctx.lang].insufficient(formatToman(customer.wallet), formatToman(plan.price)),
                [
                    [{ text: M[ctx.lang].btnCharge, callback_data: 'charge', style: 'primary' }],
                    this.backRow(ctx.lang, `plan:${plan.id}`),
                ],
            );
            return;
        }

        const prefix = `${broker.username}_`;
        // Keep the `<broker>_` prefix createUser requires; trim the Telegram id first, the random tail last.
        const username =
            prefix +
            `${customer.tgUserId}_${randomBytes(3).toString('hex')}`.slice(-(36 - prefix.length));

        // Step 1: create the user. If THIS fails there is no subscription, so refund.
        let created: Awaited<ReturnType<UsersService['createUser']>>;
        try {
            created = await this.usersService.createUser(
                CreateUserCommand.RequestBodySchema.parse({
                    username,
                    expireAt: new Date(Date.now() + plan.durationDays * 86_400_000).toISOString(),
                    trafficLimitBytes: Math.round(plan.trafficGb * GB_BYTES),
                    activeInternalSquads: [plan.squadUuid],
                    telegramId: Number(customer.tgUserId),
                }),
                broker,
            );
        } catch (error) {
            created = {
                isOk: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
        if (!created.isOk) {
            await this.repository.refundPlanOrder(orderId, customer.id, plan.price);
            await unavailable();
            this.log(ctx, M[ctx.lang].logError(created.message ?? 'create user failed'));
            return;
        }
        const user = created.response;

        // Step 2: the subscription IS live now; never refund from here on.
        await this.repository.completePlanOrder(orderId, user.id);
        await this.showScreen(ctx, screen, M[ctx.lang].approved(this.subUrl(user.shortUuid)), [
            this.backRow(ctx.lang, 'menu'),
        ]);
    }

    /** Staff review message for a top-up. */
    private topupDetails(order: BrokerBotOrders, customer: BrokerBotCustomers, lang: Lang): string {
        const who = [customer.name, customer.username ? '@' + customer.username : '']
            .filter(Boolean)
            .join(' ');
        return [
            `💰 ${M[lang].lblTopup} #${order.id}`,
            `👤 ${who || customer.tgUserId} · id ${customer.tgUserId}`,
            `💵 ${formatToman(order.amount)}`,
        ].join('\n');
    }

    private async showPlans(ctx: Ctx, screen: Screen) {
        if (!this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, M[ctx.lang].unavailable, [
                this.backRow(ctx.lang, 'menu'),
            ]);
            return;
        }
        const plans = await this.repository.listPlans(ctx.broker.uuid, true);
        if (plans.length === 0) {
            await this.showScreen(ctx, screen, M[ctx.lang].noPlans, [
                this.backRow(ctx.lang, 'menu'),
            ]);
            return;
        }

        // With categories, show those first; otherwise list the plans directly.
        const categories = await this.repository.listCategories(ctx.broker.uuid);
        const catsWithPlans = categories.filter((c) => plans.some((p) => p.categoryId === c.id));
        const hasUncategorized = plans.some((p) => p.categoryId === null);

        if (catsWithPlans.length === 0) {
            const keyboard: InlineKeyboard = plans.map((p) => [
                { text: planLabel(p, ctx.lang), callback_data: `plan:${p.id}` },
            ]);
            keyboard.push(this.backRow(ctx.lang, 'menu'));
            await this.showScreen(ctx, screen, M[ctx.lang].choosePlan, keyboard);
            return;
        }

        const keyboard: InlineKeyboard = catsWithPlans.map((c) => [
            { text: c.title, callback_data: `cat:${c.id}` },
        ]);
        if (hasUncategorized)
            keyboard.push([{ text: M[ctx.lang].catOther, callback_data: 'cat:0' }]);
        keyboard.push(this.backRow(ctx.lang, 'menu'));
        await this.showScreen(ctx, screen, M[ctx.lang].chooseCategory, keyboard);
    }

    /** Plans within one category (0 = uncategorized). */
    private async showCategoryPlans(ctx: Ctx, screen: Screen, catId: number) {
        if (!this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, M[ctx.lang].unavailable, [
                this.backRow(ctx.lang, 'menu'),
            ]);
            return;
        }
        const plans = await this.repository.listPlans(ctx.broker.uuid, true);
        const inCat = plans.filter((p) =>
            catId === 0 ? p.categoryId === null : p.categoryId === catId,
        );
        if (inCat.length === 0) {
            await this.showScreen(ctx, screen, M[ctx.lang].noPlans, [
                this.backRow(ctx.lang, 'buy'),
            ]);
            return;
        }
        const keyboard: InlineKeyboard = inCat.map((p) => [
            { text: planLabel(p, ctx.lang), callback_data: `plan:${p.id}` },
        ]);
        keyboard.push(this.backRow(ctx.lang, 'buy'));
        await this.showScreen(ctx, screen, M[ctx.lang].choosePlan, keyboard);
    }

    private async showSubscriptions(
        ctx: Ctx,
        screen: Screen,
        customer: BrokerBotCustomers,
        page: number,
    ) {
        // One extra row tells whether there is a next page.
        const orders = await this.repository.listApprovedPlanOrders(
            ctx.broker.uuid,
            customer.id,
            page * SUBS_PER_PAGE,
            SUBS_PER_PAGE + 1,
        );
        if (orders.length === 0) {
            await this.showScreen(ctx, screen, M[ctx.lang].subsEmpty, [
                this.backRow(ctx.lang, 'menu'),
            ]);
            return;
        }
        // One button per subscription; details and links open on tap.
        const keyboard: InlineKeyboard = orders.slice(0, SUBS_PER_PAGE).map((o, i) => [
            {
                text: o.plan?.title ?? M[ctx.lang].subFallback(page * SUBS_PER_PAGE + i + 1),
                callback_data: `sub:${o.id}`,
            },
        ]);
        const pager: InlineButton[] = [];
        if (page > 0) pager.push({ text: '◀️', callback_data: `mysubs:${page - 1}` });
        if (orders.length > SUBS_PER_PAGE) {
            pager.push({ text: '▶️', callback_data: `mysubs:${page + 1}` });
        }
        if (pager.length) keyboard.push(pager);
        keyboard.push(this.backRow(ctx.lang, 'menu'));
        await this.showScreen(ctx, screen, M[ctx.lang].subsPick, keyboard);
    }

    /** One subscription: usage, expiry, the subscription link and every config. */
    private async showSubDetail(
        ctx: Ctx,
        screen: Screen,
        customer: BrokerBotCustomers,
        orderId: number,
    ) {
        const order = await this.repository.getOrder(ctx.broker.uuid, orderId);
        if (
            !order ||
            order.customerId !== customer.id ||
            order.status !== 'approved' ||
            !order.userId
        ) {
            await this.showScreen(ctx, screen, M[ctx.lang].subsEmpty, [
                this.backRow(ctx.lang, 'mysubs'),
            ]);
            return;
        }
        const result = await this.usersService.getUserByUniqueFields(
            { id: order.userId },
            ctx.broker,
        );
        if (!result.isOk) {
            await this.showScreen(ctx, screen, M[ctx.lang].unavailable, [
                this.backRow(ctx.lang, 'mysubs'),
            ]);
            return;
        }
        const u = result.response;
        let links: string[] = [];
        try {
            const keys = await this.subscriptionService.getConnectionKeysByUserId(Number(u.id));
            if (keys.isOk) links = keys.response.enabledKeys;
        } catch {
            // links unavailable: still show the subscription link and usage
        }
        const plan = order.planId
            ? await this.repository.getPlan(ctx.broker.uuid, order.planId)
            : null;
        const detail = (keys: string[]) =>
            M[ctx.lang].subDetail({
                name: plan?.title ?? u.username,
                used: formatBytes(Number(u.userTraffic.usedTrafficBytes)),
                limit: u.trafficLimitBytes
                    ? formatBytes(Number(u.trafficLimitBytes))
                    : M[ctx.lang].unlimited,
                exp: new Date(u.expireAt).toLocaleDateString(),
                subUrl: this.subUrl(u.shortUuid),
                links: keys,
            });
        // Many long keys overflow Telegram's limit; the subscription link alone always fits.
        let text = detail(links);
        while (text.length > MAX_MESSAGE_LENGTH && links.length > 0) {
            links = links.slice(0, -1);
            text = detail(links);
        }
        await this.showScreen(ctx, screen, text, [this.backRow(ctx.lang, 'mysubs')]);
    }

    // ----------------------- callbacks -----------------------

    private async isGroupAdmin(ctx: Ctx, userId: number): Promise<boolean> {
        if (!ctx.bot.groupId) return false;
        try {
            const m = await ctx.tg.getChatMember(ctx.bot.groupId, userId);
            return m.status === 'administrator' || m.status === 'creator';
        } catch {
            return false;
        }
    }

    private reviewKeyboard(orderId: number): InlineKeyboard {
        return [
            [
                { text: '✅ Approve', callback_data: `ap:${orderId}`, style: 'success' },
                { text: '❌ Reject', callback_data: `rj:${orderId}`, style: 'danger' },
            ],
        ];
    }

    /** Appends the decision to a top-up review message and drops its buttons. */
    private async finalizeReview(ctx: Ctx, order: BrokerBotOrders, statusLine: string) {
        if (!order.reviewMessageId || !ctx.bot.groupId) return;
        const customer = await this.repository.getCustomerById(ctx.broker.uuid, order.customerId);
        try {
            if (customer) {
                // Keep the original details verbatim; add the status two lines below.
                const text = `${this.topupDetails(order, customer, ctx.lang)}\n\n${statusLine}`;
                await ctx.tg.editMessageText(ctx.bot.groupId, order.reviewMessageId, text);
            } else {
                await ctx.tg.editMessageReplyMarkup(ctx.bot.groupId, order.reviewMessageId, []);
            }
        } catch {
            // best-effort: never block the decision on a failed edit
        }
    }

    // ----------------------- force-subscribe gate -----------------------

    private async isMemberOf(ctx: Ctx, chatRef: string, userId: number): Promise<boolean> {
        try {
            const m = await ctx.tg.getChatMember(chatRef, userId);
            return m.status !== 'left' && m.status !== 'kicked';
        } catch (error) {
            // Can't verify (the bot isn't an admin of the channel, etc.): fail open so a
            // misconfiguration never locks every customer out, and say so in the logs.
            this.log(
                ctx,
                M[ctx.lang].logMembership(
                    chatRef,
                    error instanceof Error ? error.message : String(error),
                ),
            );
            return true;
        }
    }

    private async pendingChannels(ctx: Ctx, userId: number): Promise<RequiredChannel[]> {
        const required = ctx.bot.requiredChannels as unknown as RequiredChannel[];
        if (required.length === 0) return [];
        const checked = await Promise.all(
            required.map(async (c) => ({ c, ok: await this.isMemberOf(ctx, c.chatRef, userId) })),
        );
        return checked.filter((r) => !r.ok).map((r) => r.c);
    }

    /** True if the user may go on; otherwise sends the join prompt. */
    private async gateJoin(ctx: Ctx, chatId: string, userId: number): Promise<boolean> {
        const pending = await this.pendingChannels(ctx, userId);
        if (pending.length === 0) return true;
        const keyboard: InlineKeyboard = pending.map((c) => [
            { text: `📣 ${c.title}`, url: c.url },
        ]);
        keyboard.push([{ text: M[ctx.lang].btnJoined, callback_data: 'joined', style: 'success' }]);
        await ctx.tg.sendMessage(chatId, M[ctx.lang].joinRequired, { keyboard, parseMode: 'HTML' });
        return false;
    }

    private async handleCallback(ctx: Ctx, cq: TgCallback): Promise<void> {
        const parts = (cq.data ?? '').split(':');
        const action = parts[0];
        const chatId = cq.message ? String(cq.message.chat.id) : '';

        // Staff actions happen inside the configured group AND need a group admin
        // (inline buttons are otherwise clickable by any group member).
        if (['ap', 'rj', 'rjno', 'rjwhy', 'rjback'].includes(action)) {
            if (chatId !== ctx.bot.groupId) {
                await ctx.tg.answerCallbackQuery(cq.id);
                return;
            }
            if (!(await this.isGroupAdmin(ctx, cq.from.id))) {
                await ctx.tg.answerCallbackQuery(cq.id, 'Only group admins can do that.');
                return;
            }
            if (!this.canDecide(ctx.broker)) {
                await ctx.tg.answerCallbackQuery(cq.id, 'This broker account is inactive.');
                return;
            }
            await this.handleStaffCallback(ctx, cq, action, Number(parts[1]));
            return;
        }

        // Customer screens live in the private chat with the bot. A press anywhere else (say, a
        // forged one on a staff group message) must not act as a customer or edit that message.
        if (cq.message?.chat.type !== 'private') {
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        // Customer actions (DM).
        const customer = await this.customerFrom(ctx, cq.from, chatId);
        const screen: Screen | null = cq.message
            ? { chatId, messageId: cq.message.message_id }
            : null;

        // "I've joined" re-checks the mandatory channels and opens the menu when satisfied.
        if (action === 'joined') {
            const pending = await this.pendingChannels(ctx, cq.from.id);
            if (pending.length === 0) {
                await this.repository.setCustomerState(customer.id, 'none');
                if (screen) await this.editMenu(ctx, screen);
                else await this.sendMenu(ctx, customer.chatId);
                await ctx.tg.answerCallbackQuery(cq.id);
            } else {
                await ctx.tg.answerCallbackQuery(cq.id, M[ctx.lang].notJoinedYet);
            }
            return;
        }

        // Everything else is behind the mandatory channels.
        if (!(await this.gateJoin(ctx, customer.chatId, cq.from.id))) {
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        // All navigation edits the current message in place to keep the chat tidy.
        if (!screen) {
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        if (action === 'menu') {
            await this.repository.setCustomerState(customer.id, 'none');
            await this.editMenu(ctx, screen);
        } else if (action === 'buy') {
            await this.showPlans(ctx, screen);
        } else if (action === 'cat') {
            await this.showCategoryPlans(ctx, screen, Number(parts[1]));
        } else if (action === 'plan') {
            await this.showPlanReview(ctx, screen, customer, Number(parts[1]));
        } else if (action === 'pur') {
            await this.purchaseFromWallet(
                ctx,
                screen,
                customer,
                Number(parts[1]),
                parts[2],
                parts[3],
            );
        } else if (action === 'wallet') {
            // Back from "send the amount": typed text is no longer an amount.
            if (customer.state === 'awaiting_topup_amount') {
                await this.repository.setCustomerState(customer.id, 'none');
            }
            await this.showWallet(ctx, screen, customer);
        } else if (action === 'charge') {
            await this.startCharge(ctx, screen, customer);
        } else if (action === 'mysubs') {
            await this.showSubscriptions(ctx, screen, customer, Number(parts[1]) || 0);
        } else if (action === 'sub') {
            await this.showSubDetail(ctx, screen, customer, Number(parts[1]));
        } else if (action === 'support') {
            if (ctx.bot.groupId) await this.repository.setCustomerState(customer.id, 'support');
            await this.showScreen(
                ctx,
                screen,
                ctx.bot.groupId ? M[ctx.lang].supportPrompt : M[ctx.lang].supportUnavailable,
                [this.backRow(ctx.lang, 'menu')],
            );
        }
        await ctx.tg.answerCallbackQuery(cq.id);
    }

    private async handleStaffCallback(ctx: Ctx, cq: TgCallback, action: string, orderId: number) {
        const order = await this.repository.getOrder(ctx.broker.uuid, orderId);
        const reviewMsgId = cq.message?.message_id;
        if (!order || order.status !== 'pending') {
            await ctx.tg.answerCallbackQuery(cq.id, 'Already handled.');
            return;
        }

        if (action === 'rj') {
            // expand the reject options
            if (reviewMsgId) {
                await ctx.tg.editMessageReplyMarkup(ctx.bot.groupId!, reviewMsgId, [
                    [
                        { text: 'Reject (no reason)', callback_data: `rjno:${orderId}` },
                        { text: 'Reject with reason', callback_data: `rjwhy:${orderId}` },
                    ],
                    [{ text: '⬅︎ Back', callback_data: `rjback:${orderId}` }],
                ]);
            }
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        if (action === 'rjback') {
            if (reviewMsgId) {
                await ctx.tg.editMessageReplyMarkup(
                    ctx.bot.groupId!,
                    reviewMsgId,
                    this.reviewKeyboard(orderId),
                );
            }
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        if (action === 'rjno') {
            if (!(await this.repository.rejectOrder(orderId, null))) {
                await ctx.tg.answerCallbackQuery(cq.id, 'Already handled.');
                return;
            }
            await this.finalizeReview(ctx, order, M[ctx.lang].rejectedBy(adminName(cq.from)));
            await this.dmCustomer(ctx, order.customerId, M[ctx.lang].topupRejected);
            this.log(ctx, M[ctx.lang].logRejected(orderId));
            await ctx.tg.answerCallbackQuery(cq.id, 'Rejected.');
            return;
        }

        if (action === 'rjwhy') {
            await this.repository.setPendingReject(ctx.broker.uuid, String(cq.from.id), orderId);
            if (ctx.bot.reviewTopicId) {
                await ctx.tg.sendMessage(
                    ctx.bot.groupId!,
                    `Reply here with the rejection reason for receipt #${orderId}.`,
                    { messageThreadId: ctx.bot.reviewTopicId },
                );
            }
            await ctx.tg.answerCallbackQuery(cq.id, 'Send the reason as a reply.');
            return;
        }

        if (action === 'ap') {
            const customer = await this.repository.getCustomerById(
                ctx.broker.uuid,
                order.customerId,
            );
            if (!customer || order.kind !== 'topup' || !order.amount) {
                await ctx.tg.answerCallbackQuery(cq.id, 'Nothing to approve.');
                return;
            }
            const balance = await this.repository.approveTopup(order);
            if (balance === null) {
                await ctx.tg.answerCallbackQuery(cq.id, 'Already handled.');
                return;
            }
            await this.finalizeReview(ctx, order, M[ctx.lang].approvedBy(adminName(cq.from)));
            await ctx.tg.sendMessage(
                customer.chatId,
                M[ctx.lang].walletCharged(formatToman(order.amount), formatToman(balance)),
                { parseMode: 'HTML' },
            );
            this.log(
                ctx,
                M[ctx.lang].logTopup(
                    orderId,
                    formatToman(order.amount),
                    customer.name ?? customer.tgUserId,
                ),
            );
            await ctx.tg.answerCallbackQuery(cq.id, 'Approved — wallet credited.');
        }
    }

    private async dmCustomer(ctx: Ctx, customerId: number, text: string): Promise<void> {
        const c = await this.repository.getCustomerById(ctx.broker.uuid, customerId);
        if (c) await ctx.tg.sendMessage(c.chatId, text, { parseMode: 'HTML' }).catch(() => {});
    }

    // ----------------------- group ID finder -----------------------

    private async handleFind(ctx: Ctx, msg: TgMessage): Promise<void> {
        const chatId = String(msg.chat.id);
        await this.repository.recordGroupFind(ctx.broker.uuid, chatId, msg.chat.title ?? null);
        await ctx.tg
            .sendMessage(chatId, M[ctx.lang].groupCaptured(chatId), {
                messageThreadId: msg.message_thread_id,
            })
            .catch(() => {});
    }

    // ----------------------- staff group messages -----------------------

    private async handleGroupMessage(ctx: Ctx, msg: TgMessage): Promise<void> {
        const thread = msg.message_thread_id;
        if (!thread || !msg.from) return;

        // Rejection reason (an admin typing in the review topic).
        if (thread === ctx.bot.reviewTopicId && msg.text && this.canDecide(ctx.broker)) {
            const orderId = await this.repository.takePendingReject(
                ctx.broker.uuid,
                String(msg.from.id),
            );
            if (orderId) {
                const order = await this.repository.getOrder(ctx.broker.uuid, orderId);
                if (order && (await this.repository.rejectOrder(orderId, msg.text))) {
                    await this.finalizeReview(
                        ctx,
                        order,
                        M[ctx.lang].rejectedByReason(adminName(msg.from), msg.text),
                    );
                    await this.dmCustomer(
                        ctx,
                        order.customerId,
                        M[ctx.lang].rejectedReason(msg.text),
                    );
                    this.log(ctx, M[ctx.lang].logRejectedReason(orderId, msg.text));
                }
                return;
            }
        }

        // Ticket reply → relay to the customer. Only group ADMINS speak as staff
        // (otherwise any group member's message in a ticket topic would reach the customer).
        const customer = await this.repository.getCustomerByTicketTopic(ctx.broker.uuid, thread);
        if (customer && msg.text) {
            if (!(await this.isGroupAdmin(ctx, msg.from.id))) return;
            await ctx.tg.sendMessage(customer.chatId, M[ctx.lang].support(msg.text));
        }
    }

    // ----------------------- panel-driven actions -----------------------

    private async panelContext(brokerUuid: string): Promise<Ctx | null> {
        const bot = await this.repository.getBot(brokerUuid);
        if (!bot?.botToken) return null;
        return this.context(brokerUuid, this.client(this.decrypt(bot.botToken)));
    }

    /** Approve/reject a top-up from the panel: same effect as deciding in Telegram. */
    public async decideTopupFromPanel(
        brokerUuid: string,
        orderId: number,
        decision: 'approve' | 'reject',
        who: string,
        reason?: string,
    ): Promise<'ok' | 'not_connected' | 'not_pending'> {
        const ctx = await this.panelContext(brokerUuid);
        if (!ctx) return 'not_connected';
        const order = await this.repository.getOrder(brokerUuid, orderId);
        const customer = order
            ? await this.repository.getCustomerById(brokerUuid, order.customerId)
            : null;
        if (!order || !customer || order.kind !== 'topup' || order.status !== 'pending') {
            return 'not_pending';
        }

        if (decision === 'approve') {
            const balance = await this.repository.approveTopup(order);
            if (balance === null) return 'not_pending';
            await this.finalizeReview(ctx, order, M[ctx.lang].approvedBy(who));
            await ctx.tg
                .sendMessage(
                    customer.chatId,
                    M[ctx.lang].walletCharged(formatToman(order.amount), formatToman(balance)),
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
            this.log(
                ctx,
                M[ctx.lang].logTopup(
                    orderId,
                    formatToman(order.amount),
                    customer.name ?? customer.tgUserId,
                ),
            );
        } else {
            if (!(await this.repository.rejectOrder(orderId, reason ?? null))) return 'not_pending';
            await this.finalizeReview(
                ctx,
                order,
                reason ? M[ctx.lang].rejectedByReason(who, reason) : M[ctx.lang].rejectedBy(who),
            );
            await ctx.tg
                .sendMessage(
                    customer.chatId,
                    reason ? M[ctx.lang].rejectedReason(reason) : M[ctx.lang].topupRejected,
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
            this.log(
                ctx,
                reason
                    ? M[ctx.lang].logRejectedReason(orderId, reason)
                    : M[ctx.lang].logRejected(orderId),
            );
        }
        return 'ok';
    }

    /** Credits a customer's wallet by Telegram ID and tells them, best effort. */
    public async manualTopup(
        brokerUuid: string,
        tgUserId: string,
        amount: number,
    ): Promise<{ name: string; balance: bigint } | null> {
        const customer = await this.repository.getCustomerByTgUserId(brokerUuid, tgUserId);
        if (!customer) return null;
        const balance = await this.repository.creditWallet(customer.id, amount);
        const ctx = await this.panelContext(brokerUuid).catch(() => null);
        if (ctx) {
            await ctx.tg
                .sendMessage(
                    customer.chatId,
                    M[ctx.lang].walletCharged(formatToman(amount), formatToman(balance)),
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
        }
        return { name: customer.name ?? customer.username ?? customer.tgUserId, balance };
    }

    /** A pending photo receipt, for display in the panel. */
    public async getReceiptImage(
        brokerUuid: string,
        orderId: number,
    ): Promise<{ bytes: Buffer; mime: string } | null> {
        const [order, bot] = await Promise.all([
            this.repository.getOrder(brokerUuid, orderId),
            this.repository.getBot(brokerUuid),
        ]);
        if (order?.receiptKind !== 'photo' || !order.receiptFileId || !bot?.botToken) return null;
        try {
            return await this.client(this.decrypt(bot.botToken)).downloadPhoto(order.receiptFileId);
        } catch {
            return null;
        }
    }
}
