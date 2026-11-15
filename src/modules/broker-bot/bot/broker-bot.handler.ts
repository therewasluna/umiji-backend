import { Transactional } from '@nestjs-cls/transactional';
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
import { BROKER_BOT_LANG_NAMES, CreateUserCommand } from '@libs/contracts/commands';

import { BrokerEntity } from '@modules/brokers/entities';
import { GetBrokerByUuidQuery } from '@modules/brokers/queries/get-broker-by-uuid';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { UsersService } from '@modules/users/users.service';

import {
    BotReport,
    BrokerBotRepository,
    StatsWindow,
    TopupApproval,
} from '../broker-bot.repository';
import {
    activeTrial,
    adminName,
    botLangs,
    defaultLang,
    esc,
    formatBytes,
    formatToman,
    Html,
    isLang,
    Lang,
    menuKeyboard,
    planLabel,
    planReview,
    T,
    translator,
    Trial,
    trialReview,
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
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

class SubscriptionCreationFailed extends Error {}

/** "Sara @sara_m" for staff messages, or the Telegram ID when the customer has neither. */
function who(customer: BrokerBotCustomers): string {
    const parts = [customer.name, customer.username ? '@' + customer.username : ''];
    return parts.filter(Boolean).join(' ') || customer.tgUserId;
}

function customerLang(bot: BrokerBots, customer: BrokerBotCustomers): Lang {
    return isLang(customer.lang) && botLangs(bot).includes(customer.lang)
        ? customer.lang
        : defaultLang(bot);
}

/** A customer claims the free trial once per round; a reset in the panel starts a new one. */
function trialKey(bot: BrokerBots): string {
    return `trial:${bot.trialResetAt.getTime()}`;
}

/** Start of the current UTC day, the day the trial cap and the daily summary count in. */
function utcToday(): Date {
    return new Date(Date.now() - (Date.now() % DAY_MS));
}

type CreatedUser = Extract<
    Awaited<ReturnType<UsersService['createUser']>>,
    { isOk: true }
>['response'];

/** Fingerprint of what the customer agreed to on the plan review screen. */
function planTerms(p: BrokerBotPlans): string {
    // The limit is appended only when set, so plans without one keep their old fingerprint.
    const devices = p.ipLimit ? `|${p.ipLimit}` : '';
    return createHash('sha256')
        .update(
            `${p.title}|${p.price}|${p.trafficGb}|${p.durationDays}|${p.squadUuids.join(',')}${devices}`,
        )
        .digest('hex')
        .slice(0, 8);
}

// ----------------------- minimal Telegram update types -----------------------

interface TgUser {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
    language_code?: string;
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
    updateId?: number;
    /** The customer's language once known, else the default. */
    lang: Lang;
    /** Texts for the customer. */
    t: T;
    /** Texts for the staff group, always in the default language. */
    st: T;
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
interface PayMethod {
    method: string;
    account: string;
    note: string;
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
    public async context(
        brokerUuid: string,
        tg: TelegramClient,
        updateId?: number,
    ): Promise<Ctx | null> {
        const [bot, broker] = await Promise.all([
            this.repository.getBot(brokerUuid),
            this.getBroker(brokerUuid),
        ]);
        if (!bot?.botToken || !broker) return null;
        const lang = defaultLang(bot);
        const st = translator(bot.texts, lang);
        return { broker, bot, tg, updateId, lang, t: st, st };
    }

    /** Texts in this customer's language, for staff actions that message them. */
    private tFor(ctx: Ctx, customer: BrokerBotCustomers): T {
        return translator(ctx.bot.texts, customerLang(ctx.bot, customer));
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
                .sendMessage(ctx.bot.groupId, text, {
                    messageThreadId: ctx.bot.logsTopicId,
                    parseMode: 'HTML',
                })
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
                        if (cmd === '/stats') {
                            if (
                                msg.from &&
                                this.rateLimit(
                                    `tgstats:${ctx.broker.uuid}:${msg.from.id}`,
                                    3,
                                    60_000,
                                )
                            ) {
                                await this.handleStats(ctx, msg);
                            }
                        } else {
                            await this.handleGroupMessage(ctx, msg);
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error(error);
            this.log(
                ctx,
                ctx.st('logError', {
                    error: error instanceof Error ? error.message : String(error),
                }),
            );
            throw error;
        }
    }

    // ----------------------- customer DM -----------------------

    /**
     * Records the customer and switches the context to their language. A new customer who came
     * through an invite link is tied to the customer who shared it.
     */
    private async customerFrom(
        ctx: Ctx,
        from: TgUser,
        chatId: string,
        referrerId: null | number = null,
    ): Promise<BrokerBotCustomers> {
        // A new customer gets their Telegram app's language when the bot speaks it.
        const appLang = from.language_code?.split('-')[0].toLowerCase();
        // Only this broker's customers can refer: ids are shared by every broker's bot.
        const referrer = referrerId
            ? await this.repository.getCustomerById(ctx.broker.uuid, referrerId)
            : null;
        const { customer, isNew } = await this.repository.upsertCustomer({
            brokerUuid: ctx.broker.uuid,
            tgUserId: String(from.id),
            chatId,
            name: from.first_name ?? null,
            username: from.username ?? null,
            lang: isLang(appLang) && botLangs(ctx.bot).includes(appLang) ? appLang : null,
            referredById: referrer?.id ?? null,
        });
        if (isNew) {
            const vars = { customer: who(customer), tgId: customer.tgUserId };
            this.log(
                ctx,
                referrer
                    ? ctx.st('logNewReferral', { ...vars, referrer: who(referrer) })
                    : ctx.st('logNewCustomer', vars),
            );
        }
        ctx.lang = customerLang(ctx.bot, customer);
        ctx.t = translator(ctx.bot.texts, ctx.lang);
        return customer;
    }

    private menuKeyboard(ctx: Ctx): InlineKeyboard {
        return menuKeyboard(ctx.t, ctx.bot);
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

    private backRow(ctx: Ctx, target: string): InlineButton[] {
        return [{ text: ctx.t('btnBack'), callback_data: target }];
    }

    /** The main menu as a NEW message (for /start). */
    private async sendMenu(ctx: Ctx, chatId: string): Promise<void> {
        await ctx.tg.sendMessage(chatId, ctx.t('greeting'), {
            keyboard: this.menuKeyboard(ctx),
            parseMode: 'HTML',
        });
    }

    private async editMenu(ctx: Ctx, screen: Screen): Promise<void> {
        await this.showScreen(ctx, screen, ctx.t('greeting'), this.menuKeyboard(ctx));
    }

    /** The languages the bot speaks, the customer's own ticked. */
    private async showLanguages(ctx: Ctx, screen: Screen): Promise<void> {
        const keyboard: InlineKeyboard = botLangs(ctx.bot).map((l) => [
            {
                text: `${l === ctx.lang ? '✅ ' : ''}${BROKER_BOT_LANG_NAMES[l]}`,
                callback_data: `lang:${l}`,
            },
        ]);
        keyboard.push(this.backRow(ctx, 'menu'));
        await this.showScreen(ctx, screen, ctx.t('chooseLanguage'), keyboard);
    }

    private async handleDM(ctx: Ctx, msg: TgMessage): Promise<void> {
        const text = msg.text?.trim();
        // An invite link opens the bot with "/start ref<customer id>".
        const [command, payload = ''] = text?.split(/\s+/) ?? [];
        const referrerId =
            command === '/start' && /^ref\d{1,9}$/.test(payload) ? Number(payload.slice(3)) : null;
        const customer = await this.customerFrom(ctx, msg.from!, String(msg.chat.id), referrerId);

        // Force-subscribe gate: nothing works until mandatory channels are joined.
        if (!(await this.gateJoin(ctx, customer.chatId, msg.from!.id))) return;

        if (command === '/start') {
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

        await ctx.tg.sendMessage(customer.chatId, ctx.t('useMenu'), {
            keyboard: this.menuKeyboard(ctx),
            parseMode: 'HTML',
        });
    }

    /** A top-up receipt: posted to the review topic for an admin to approve. */
    private async submitReceipt(ctx: Ctx, customer: BrokerBotCustomers, msg: TgMessage) {
        const amount = customer.stateAmount;
        if (!amount || amount <= 0) {
            await this.repository.setCustomerState(customer.id, 'none');
            await ctx.tg.sendMessage(customer.chatId, ctx.t('unavailable'), {
                parseMode: 'HTML',
            });
            return;
        }

        // The broker's state, the staff group and the pending cap were checked before the
        // customer was told where to pay. They may have sent money since, so the receipt is
        // always kept: it can be decided on the panel's Orders page too.
        const order = await this.repository.createTopupOrder(
            ctx.broker.uuid,
            customer.id,
            amount,
            ctx.updateId,
        );

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
        if (ctx.bot.groupId && ctx.bot.reviewTopicId && !order.reviewMessageId) {
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
                this.topupDetails(ctx, order, customer),
                {
                    messageThreadId: ctx.bot.reviewTopicId,
                    replyToMessageId: copied.message_id,
                    keyboard: this.reviewKeyboard(ctx, order.id),
                    parseMode: 'HTML',
                },
            );
            await this.repository.setOrderReviewMessage(order.id, details.message_id);
        }
        await ctx.tg.sendMessage(customer.chatId, ctx.t('topupSubmitted'), {
            parseMode: 'HTML',
        });
        await this.repository.setCustomerState(customer.id, 'none');
    }

    private async relayCustomerToTicket(ctx: Ctx, customer: BrokerBotCustomers, msg: TgMessage) {
        const groupId = ctx.bot.groupId;
        if (!groupId) {
            // Tickets are topics in the staff group; without one, say so instead of going silent.
            await this.repository.setCustomerState(customer.id, 'none');
            await ctx.tg.sendMessage(customer.chatId, ctx.t('supportUnavailable'), {
                parseMode: 'HTML',
            });
            return;
        }
        const relay = (topicId: number) =>
            msg.text
                ? ctx.tg.sendMessage(groupId, ctx.st('ticketRelay', { text: msg.text }), {
                      messageThreadId: topicId,
                      parseMode: 'HTML',
                  })
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
        await ctx.tg.sendMessage(customer.chatId, ctx.t('supportSent'), { parseMode: 'HTML' });
    }

    private async openTicket(ctx: Ctx, customer: BrokerBotCustomers): Promise<number> {
        const name = customer.name ?? customer.username ?? customer.tgUserId;
        // Telegram caps topic names at 128 characters.
        const topicName = ctx.st('ticketTopicName', { name }).slice(0, 128);
        const topicId = await ctx.tg.createForumTopic(ctx.bot.groupId!, topicName);
        await this.repository.setTicketTopic(customer.id, topicId);
        await ctx.tg.sendMessage(
            ctx.bot.groupId!,
            ctx.st('ticketIntro', { name, tgId: customer.tgUserId }),
            { messageThreadId: topicId, parseMode: 'HTML' },
        );
        return topicId;
    }

    // ----------------------- wallet, top-up & checkout -----------------------

    private async showWallet(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        await this.showScreen(
            ctx,
            screen,
            ctx.t('walletScreen', { balance: formatToman(customer.wallet, ctx.t) }),
            [
                [{ text: ctx.t('btnCharge'), callback_data: 'charge', style: 'primary' }],
                this.backRow(ctx, 'menu'),
            ],
        );
    }

    /** Why the customer can't top up now. Checked before they are told where to send money. */
    private async topupBlockedText(ctx: Ctx, customer: BrokerBotCustomers): Promise<null | string> {
        // No money in while the broker can't sell.
        if (!this.canSell(ctx.broker)) return ctx.t('unavailable');
        const methods = [ctx.bot.cards, ctx.bot.wallets, ctx.bot.payMethods] as unknown[][];
        if (methods.every((list) => list.length === 0)) return ctx.t('topupNoMethods');
        // Receipts are reviewed in the staff group's topic.
        if (!ctx.bot.groupId || !ctx.bot.reviewTopicId) return ctx.t('topupNoMethods');
        const pending = await this.repository.countPendingByCustomer(ctx.broker.uuid, customer.id);
        return pending >= MAX_PENDING_ORDERS ? ctx.t('tooManyPending') : null;
    }

    private async startCharge(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        const blocked = await this.topupBlockedText(ctx, customer);
        if (blocked) {
            await this.showScreen(ctx, screen, blocked, [this.backRow(ctx, 'wallet')]);
            return;
        }
        await this.repository.setCustomerState(customer.id, 'awaiting_topup_amount');
        await this.showScreen(ctx, screen, ctx.t('chargePrompt'), [this.backRow(ctx, 'wallet')]);
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
            await ctx.tg.sendMessage(customer.chatId, ctx.t('invalidAmount'), {
                parseMode: 'HTML',
            });
            return;
        }
        const amount = Number(digits);

        const cards = ctx.bot.cards as unknown as Card[];
        const wallets = ctx.bot.wallets as unknown as Wallet[];
        const payMethods = ctx.bot.payMethods as unknown as PayMethod[];
        const destinations = [
            ...cards.map(
                (c) => `💳 <b>${esc(c.holderName)}</b>\n<code>${esc(c.cardNumber)}</code>`,
            ),
            ...wallets.map((w) => `🪙 <b>${esc(w.asset)}</b>\n<code>${esc(w.address)}</code>`),
            ...payMethods.map(
                (m) =>
                    `💸 <b>${esc(m.method)}</b>${m.note ? ` · ${esc(m.note)}` : ''}\n<code>${esc(m.account)}</code>`,
            ),
        ].join('\n\n');
        await this.repository.setCustomerState(customer.id, 'awaiting_receipt', amount);
        await ctx.tg.sendMessage(
            customer.chatId,
            ctx.t('topupInstructions', {
                amount: formatToman(amount, ctx.t),
                destinations: new Html(destinations),
            }),
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
            await this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);
            return;
        }
        await this.showScreen(ctx, screen, planReview(plan, customer.wallet, ctx.t), [
            [
                {
                    text: ctx.t('btnBuyWallet'),
                    // The terms catch plan edits since this screen; the key makes it pay once.
                    callback_data: `pur:${plan.id}:${planTerms(plan)}:${randomBytes(4).toString('hex')}`,
                    style: 'primary',
                },
            ],
            this.backRow(ctx, 'buy'),
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
            this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);

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
        if (!plan.squadUuids.length || !this.hasRoomFor(broker, plan.squadUuids)) {
            await unavailable();
            return;
        }

        let purchase: { orderId: number; user: CreatedUser } | null;
        try {
            purchase = await this.completeWalletPurchase(ctx, broker, customer, plan, checkoutKey);
        } catch (error) {
            // This review screen was paid already (a double tap): that purchase answered.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return;
            }
            if (error instanceof SubscriptionCreationFailed) {
                await unavailable();
                return;
            }
            throw error;
        }
        if (!purchase) {
            await this.showScreen(
                ctx,
                screen,
                ctx.t('insufficient', {
                    balance: formatToman(customer.wallet, ctx.t),
                    price: formatToman(plan.price, ctx.t),
                }),
                [
                    [{ text: ctx.t('btnCharge'), callback_data: 'charge', style: 'primary' }],
                    this.backRow(ctx, `plan:${plan.id}`),
                ],
            );
            return;
        }

        const { orderId, user } = purchase;
        this.usersService.publishCreatedUser(user);
        this.log(
            ctx,
            ctx.st('logPurchase', {
                id: orderId,
                customer: who(customer),
                plan: plan.title,
                amount: formatToman(plan.price, ctx.st),
            }),
        );
        await this.showScreen(
            ctx,
            screen,
            ctx.t('approved', { link: this.subUrl(user.shortUuid) }),
            [this.backRow(ctx, 'menu')],
        );
    }

    @Transactional()
    private async completeWalletPurchase(
        ctx: Ctx,
        broker: BrokerEntity,
        customer: BrokerBotCustomers,
        plan: BrokerBotPlans,
        checkoutKey: string,
    ): Promise<{ orderId: number; user: CreatedUser } | null> {
        const orderId = await this.repository.payForPlan({
            brokerUuid: broker.uuid,
            customerId: customer.id,
            planId: plan.id,
            amount: plan.price,
            checkoutKey,
        });
        if (orderId === null) return null;

        const user = await this.createSubscription(ctx, broker, customer, plan, true);
        if (!user) throw new SubscriptionCreationFailed();

        await this.repository.completePlanOrder(orderId, user.id);
        return { orderId, user };
    }

    /** The broker may hand out one more subscription on all these squads. */
    private hasRoomFor(broker: BrokerEntity, squadUuids: string[]): boolean {
        return (
            squadUuids.every((uuid) => broker.internalSquads.some((s) => s.uuid === uuid)) &&
            (broker.usersLimit === null || broker.usersCount < broker.usersLimit)
        );
    }

    /** The customer's subscription user. Null, with the error in the logs topic, when it fails. */
    private async createSubscription(
        ctx: Ctx,
        broker: BrokerEntity,
        customer: BrokerBotCustomers,
        spec: Trial,
        deferEvents = false,
    ): Promise<CreatedUser | null> {
        const prefix = `${broker.username}_`;
        // Keep the `<broker>_` prefix createUser requires; trim the Telegram id first, the random tail last.
        const username =
            prefix +
            `${customer.tgUserId}_${randomBytes(3).toString('hex')}`.slice(-(36 - prefix.length));
        let created: Awaited<ReturnType<UsersService['createUser']>>;
        try {
            created = await this.usersService.createUser(
                CreateUserCommand.RequestBodySchema.parse({
                    username,
                    expireAt: new Date(
                        Date.now() +
                            (spec.durationHours
                                ? spec.durationHours * HOUR_MS
                                : spec.durationDays * DAY_MS),
                    ).toISOString(),
                    trafficLimitBytes: Math.round(spec.trafficGb * GB_BYTES),
                    activeInternalSquads: spec.squadUuids,
                    ipLimit: spec.ipLimit,
                    telegramId: Number(customer.tgUserId),
                }),
                broker,
                deferEvents,
            );
        } catch (error) {
            created = {
                isOk: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
        if (created.isOk) return created.response;
        this.log(ctx, ctx.st('logError', { error: created.message ?? 'create user failed' }));
        return null;
    }

    // ----------------------- free trial & invites -----------------------

    /** The free trial offer, or why this customer can't have it. */
    private async showTrial(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        const trial = activeTrial(ctx.bot);
        if (!trial || !this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);
            return;
        }
        if (await this.repository.hasClaimedTrial(customer.id, trialKey(ctx.bot))) {
            await this.showScreen(ctx, screen, ctx.t('trialUsed'), [
                [{ text: ctx.t('menuBuy'), callback_data: 'buy', style: 'primary' }],
                this.backRow(ctx, 'menu'),
            ]);
            return;
        }
        if (await this.isTrialSoldOut(ctx.broker.uuid, trial)) {
            await this.showTrialSoldOut(ctx, screen);
            return;
        }
        await this.showScreen(ctx, screen, trialReview(trial, ctx.t), [
            [{ text: ctx.t('btnTrialClaim'), callback_data: 'trialgo', style: 'success' }],
            this.backRow(ctx, 'menu'),
        ]);
    }

    /** One free subscription per customer and round; the claim is given back if creation fails. */
    private async claimTrial(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        const unavailable = () =>
            this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);
        const trial = activeTrial(ctx.bot);
        // Re-read for the latest quota and users count, as a purchase does.
        const broker = (await this.getBroker(ctx.broker.uuid)) ?? ctx.broker;
        if (!trial || !this.canSell(broker) || !this.hasRoomFor(broker, trial.squadUuids)) {
            await unavailable();
            return;
        }
        // Updates of one bot are handled one at a time, so two claims can't both pass the cap.
        if (await this.isTrialSoldOut(broker.uuid, trial)) {
            await this.showTrialSoldOut(ctx, screen);
            return;
        }
        let orderId: number;
        try {
            orderId = await this.repository.createTrialOrder(
                broker.uuid,
                customer.id,
                trialKey(ctx.bot),
            );
        } catch (error) {
            // Claimed already this round, by a double tap or an old screen: that one answered.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return;
            }
            throw error;
        }
        const user = await this.createSubscription(ctx, broker, customer, trial);
        if (!user) {
            await this.repository.releaseTrialOrder(orderId);
            await unavailable();
            return;
        }
        await this.repository.completePlanOrder(orderId, user.id);
        this.log(ctx, ctx.st('logTrial', { customer: who(customer) }));
        await this.showScreen(
            ctx,
            screen,
            ctx.t('approved', { link: this.subUrl(user.shortUuid) }),
            [this.backRow(ctx, 'menu')],
        );
    }

    private async isTrialSoldOut(brokerUuid: string, trial: Trial): Promise<boolean> {
        if (!trial.dailyLimit) return false;
        return (await this.repository.countTrialsSince(brokerUuid, utcToday())) >= trial.dailyLimit;
    }

    private async showTrialSoldOut(ctx: Ctx, screen: Screen) {
        await this.showScreen(ctx, screen, ctx.t('trialSoldOut'), [
            [{ text: ctx.t('menuBuy'), callback_data: 'buy', style: 'primary' }],
            this.backRow(ctx, 'menu'),
        ]);
    }

    /**
     * Deletes trial users a day after they expire, for bots with trial.deleteExpired on (read
     * from the stored settings, so it keeps going while the trial itself is switched off).
     */
    public async deleteExpiredTrials(): Promise<void> {
        const due = await this.repository.listExpiredTrialUsers(new Date(Date.now() - DAY_MS));
        for (const [brokerUuid, userIds] of due) {
            const broker = await this.getBroker(brokerUuid);
            if (!broker) continue;
            // Scoped to the broker: a user moved to someone else is skipped, not deleted.
            const result = await this.usersService.bulkDeleteUsersByUserId(userIds, broker);
            if (!result.isOk) {
                this.logger.warn(
                    `Broker ${brokerUuid}: expired trials not deleted: ${result.message}`,
                );
            }
        }
    }

    /** The customer's invite link and what it has earned them. */
    private async showInvite(ctx: Ctx, screen: Screen, customer: BrokerBotCustomers) {
        if (!(ctx.bot.referralPercent > 0) || !ctx.bot.botUsername) {
            await this.editMenu(ctx, screen);
            return;
        }
        const { invited, earned } = await this.repository.getReferralSummary(customer.id);
        const link = `https://t.me/${ctx.bot.botUsername}?start=ref${customer.id}`;
        await this.showScreen(
            ctx,
            screen,
            ctx.t('inviteScreen', {
                inviteLink: link,
                percent: ctx.bot.referralPercent,
                invited,
                earned: formatToman(earned, ctx.t),
            }),
            [
                // Opens Telegram's share sheet with the link filled in.
                [
                    {
                        text: ctx.t('menuInvite'),
                        url: `https://t.me/share/url?url=${encodeURIComponent(link)}`,
                    },
                ],
                this.backRow(ctx, 'menu'),
            ],
        );
    }

    /** Tells the referrer what a friend's top-up (`topupId`) earned them, and the staff. */
    private async notifyReward(
        ctx: Ctx,
        reward: TopupApproval['reward'],
        topupId: number,
    ): Promise<void> {
        if (!reward) return;
        const referrer = await this.repository.getCustomerById(ctx.broker.uuid, reward.customerId);
        if (!referrer) return;
        const t = this.tFor(ctx, referrer);
        await ctx.tg
            .sendMessage(
                referrer.chatId,
                t('referralReward', {
                    amount: formatToman(reward.amount, t),
                    balance: formatToman(reward.balance, t),
                }),
                { parseMode: 'HTML' },
            )
            .catch(() => {});
        this.log(
            ctx,
            ctx.st('logReward', {
                amount: formatToman(reward.amount, ctx.st),
                referrer: who(referrer),
                id: topupId,
            }),
        );
    }

    /** Staff review message for a top-up. */
    private topupDetails(ctx: Ctx, order: BrokerBotOrders, customer: BrokerBotCustomers): string {
        return ctx.st('topupReview', {
            id: order.id,
            customer: who(customer),
            tgId: customer.tgUserId,
            amount: formatToman(order.amount, ctx.st),
        });
    }

    private async showPlans(ctx: Ctx, screen: Screen) {
        if (!this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);
            return;
        }
        const plans = await this.repository.listPlans(ctx.broker.uuid, true);
        if (plans.length === 0) {
            await this.showScreen(ctx, screen, ctx.t('noPlans'), [this.backRow(ctx, 'menu')]);
            return;
        }

        // With categories, show those first; otherwise list the plans directly.
        const categories = await this.repository.listCategories(ctx.broker.uuid);
        const catsWithPlans = categories.filter((c) => plans.some((p) => p.categoryId === c.id));
        const hasUncategorized = plans.some((p) => p.categoryId === null);

        if (catsWithPlans.length === 0) {
            const keyboard: InlineKeyboard = plans.map((p) => [
                { text: planLabel(p, ctx.t), callback_data: `plan:${p.id}` },
            ]);
            keyboard.push(this.backRow(ctx, 'menu'));
            await this.showScreen(ctx, screen, ctx.t('choosePlan'), keyboard);
            return;
        }

        const keyboard: InlineKeyboard = catsWithPlans.map((c) => [
            { text: c.title, callback_data: `cat:${c.id}` },
        ]);
        if (hasUncategorized) keyboard.push([{ text: ctx.t('catOther'), callback_data: 'cat:0' }]);
        keyboard.push(this.backRow(ctx, 'menu'));
        await this.showScreen(ctx, screen, ctx.t('chooseCategory'), keyboard);
    }

    /** Plans within one category (0 = uncategorized). */
    private async showCategoryPlans(ctx: Ctx, screen: Screen, catId: number) {
        if (!this.canSell(ctx.broker)) {
            await this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'menu')]);
            return;
        }
        const plans = await this.repository.listPlans(ctx.broker.uuid, true);
        const inCat = plans.filter((p) =>
            catId === 0 ? p.categoryId === null : p.categoryId === catId,
        );
        if (inCat.length === 0) {
            await this.showScreen(ctx, screen, ctx.t('noPlans'), [this.backRow(ctx, 'buy')]);
            return;
        }
        const keyboard: InlineKeyboard = inCat.map((p) => [
            { text: planLabel(p, ctx.t), callback_data: `plan:${p.id}` },
        ]);
        keyboard.push(this.backRow(ctx, 'buy'));
        await this.showScreen(ctx, screen, ctx.t('choosePlan'), keyboard);
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
            await this.showScreen(ctx, screen, ctx.t('subsEmpty'), [this.backRow(ctx, 'menu')]);
            return;
        }
        // One button per subscription; details and links open on tap.
        const keyboard: InlineKeyboard = orders.slice(0, SUBS_PER_PAGE).map((o, i) => [
            {
                text:
                    o.plan?.title ??
                    (o.kind === 'trial'
                        ? ctx.t('menuTrial')
                        : ctx.t('subFallback', { number: page * SUBS_PER_PAGE + i + 1 })),
                callback_data: `sub:${o.id}`,
            },
        ]);
        const pager: InlineButton[] = [];
        if (page > 0) pager.push({ text: '◀️', callback_data: `mysubs:${page - 1}` });
        if (orders.length > SUBS_PER_PAGE) {
            pager.push({ text: '▶️', callback_data: `mysubs:${page + 1}` });
        }
        if (pager.length) keyboard.push(pager);
        keyboard.push(this.backRow(ctx, 'menu'));
        await this.showScreen(ctx, screen, ctx.t('subsPick'), keyboard);
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
            await this.showScreen(ctx, screen, ctx.t('subsEmpty'), [this.backRow(ctx, 'mysubs')]);
            return;
        }
        const result = await this.usersService.getUserByUniqueFields(
            { id: order.userId },
            ctx.broker,
        );
        if (!result.isOk) {
            await this.showScreen(ctx, screen, ctx.t('unavailable'), [this.backRow(ctx, 'mysubs')]);
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
            ctx.t('subDetail', {
                name: plan?.title ?? (order.kind === 'trial' ? ctx.t('menuTrial') : u.username),
                used: formatBytes(Number(u.userTraffic.usedTrafficBytes)),
                limit: u.trafficLimitBytes
                    ? formatBytes(Number(u.trafficLimitBytes))
                    : ctx.t('unlimited'),
                expires: new Date(u.expireAt).toLocaleDateString(ctx.lang),
                link: this.subUrl(u.shortUuid),
                configs: new Html(
                    keys.length
                        ? `\n\n${ctx.t('subConfigs')}\n` +
                              keys.map((l) => `<code>${esc(l)}</code>`).join('\n')
                        : '',
                ),
            });
        // Many long keys overflow Telegram's limit; the subscription link alone always fits.
        let text = detail(links);
        while (text.length > MAX_MESSAGE_LENGTH && links.length > 0) {
            links = links.slice(0, -1);
            text = detail(links);
        }
        await this.showScreen(ctx, screen, text, [this.backRow(ctx, 'mysubs')]);
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

    private reviewKeyboard(ctx: Ctx, orderId: number): InlineKeyboard {
        return [
            [
                { text: ctx.st('btnApprove'), callback_data: `ap:${orderId}`, style: 'success' },
                { text: ctx.st('btnReject'), callback_data: `rj:${orderId}`, style: 'danger' },
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
                const text = `${this.topupDetails(ctx, order, customer)}\n\n${statusLine}`;
                await ctx.tg.editMessageText(
                    ctx.bot.groupId,
                    order.reviewMessageId,
                    text,
                    undefined,
                    'HTML',
                );
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
                ctx.st('logMembership', {
                    channel: chatRef,
                    error: error instanceof Error ? error.message : String(error),
                }),
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
            { text: ctx.t('btnJoinChannel', { title: c.title }), url: c.url },
        ]);
        keyboard.push([{ text: ctx.t('btnJoined'), callback_data: 'joined', style: 'success' }]);
        await ctx.tg.sendMessage(chatId, ctx.t('joinRequired'), { keyboard, parseMode: 'HTML' });
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
                await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertAdminsOnly'));
                return;
            }
            if (!this.canDecide(ctx.broker)) {
                await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertInactive'));
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
                await ctx.tg.answerCallbackQuery(cq.id, ctx.t('notJoinedYet'));
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
        } else if (action === 'trial') {
            await this.showTrial(ctx, screen, customer);
        } else if (action === 'trialgo') {
            await this.claimTrial(ctx, screen, customer);
        } else if (action === 'invite') {
            await this.showInvite(ctx, screen, customer);
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
                ctx.bot.groupId ? ctx.t('supportPrompt') : ctx.t('supportUnavailable'),
                [this.backRow(ctx, 'menu')],
            );
        } else if (action === 'lang') {
            const picked = parts[1];
            if (isLang(picked) && botLangs(ctx.bot).includes(picked)) {
                await this.repository.setCustomerLang(customer.id, picked);
                ctx.lang = picked;
                ctx.t = translator(ctx.bot.texts, picked);
                await this.editMenu(ctx, screen);
            } else {
                await this.showLanguages(ctx, screen);
            }
        }
        await ctx.tg.answerCallbackQuery(cq.id);
    }

    private async handleStaffCallback(ctx: Ctx, cq: TgCallback, action: string, orderId: number) {
        const order = await this.repository.getOrder(ctx.broker.uuid, orderId);
        const reviewMsgId = cq.message?.message_id;
        if (!order || order.status !== 'pending') {
            await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertHandled'));
            return;
        }

        if (action === 'rj') {
            // expand the reject options
            if (reviewMsgId) {
                await ctx.tg.editMessageReplyMarkup(ctx.bot.groupId!, reviewMsgId, [
                    [
                        { text: ctx.st('btnRejectNoReason'), callback_data: `rjno:${orderId}` },
                        { text: ctx.st('btnRejectWithReason'), callback_data: `rjwhy:${orderId}` },
                    ],
                    [{ text: ctx.st('btnStaffBack'), callback_data: `rjback:${orderId}` }],
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
                    this.reviewKeyboard(ctx, orderId),
                );
            }
            await ctx.tg.answerCallbackQuery(cq.id);
            return;
        }

        if (action === 'rjno') {
            if (!(await this.repository.rejectOrder(orderId, null))) {
                await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertHandled'));
                return;
            }
            await this.finalizeReview(
                ctx,
                order,
                ctx.st('rejectedBy', { admin: adminName(cq.from) }),
            );
            await this.dmCustomer(ctx, order.customerId, (t) => t('topupRejected'));
            this.log(ctx, ctx.st('logRejected', { id: orderId }));
            await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertRejected'));
            return;
        }

        if (action === 'rjwhy') {
            await this.repository.setPendingReject(ctx.broker.uuid, String(cq.from.id), orderId);
            if (ctx.bot.reviewTopicId) {
                await ctx.tg.sendMessage(
                    ctx.bot.groupId!,
                    ctx.st('askRejectReason', { id: orderId }),
                    { messageThreadId: ctx.bot.reviewTopicId, parseMode: 'HTML' },
                );
            }
            await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertSendReason'));
            return;
        }

        if (action === 'ap') {
            const customer = await this.repository.getCustomerById(
                ctx.broker.uuid,
                order.customerId,
            );
            if (!customer || order.kind !== 'topup' || !order.amount) {
                await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertNothing'));
                return;
            }
            const approval = await this.repository.approveTopup(order);
            if (approval === null) {
                await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertHandled'));
                return;
            }
            await this.finalizeReview(
                ctx,
                order,
                ctx.st('approvedBy', { admin: adminName(cq.from) }),
            );
            await ctx.tg.sendMessage(
                customer.chatId,
                this.walletCharged(this.tFor(ctx, customer), order.amount, approval.balance),
                { parseMode: 'HTML' },
            );
            this.logTopup(ctx, orderId, order.amount, customer);
            await this.notifyReward(ctx, approval.reward, orderId);
            await ctx.tg.answerCallbackQuery(cq.id, ctx.st('alertApproved'));
        }
    }

    /** A message to a customer, in their language. */
    private async dmCustomer(ctx: Ctx, customerId: number, text: (t: T) => string): Promise<void> {
        const c = await this.repository.getCustomerById(ctx.broker.uuid, customerId);
        if (c) {
            await ctx.tg
                .sendMessage(c.chatId, text(this.tFor(ctx, c)), { parseMode: 'HTML' })
                .catch(() => {});
        }
    }

    private walletCharged(t: T, amount: bigint | number, balance: bigint | number): string {
        return t('walletCharged', {
            amount: formatToman(amount, t),
            balance: formatToman(balance, t),
        });
    }

    private logTopup(ctx: Ctx, orderId: number, amount: number, customer: BrokerBotCustomers) {
        this.log(
            ctx,
            ctx.st('logTopup', {
                id: orderId,
                amount: formatToman(amount, ctx.st),
                customer: customer.name ?? customer.tgUserId,
            }),
        );
    }

    // ----------------------- group ID finder -----------------------

    private async handleFind(ctx: Ctx, msg: TgMessage): Promise<void> {
        const chatId = String(msg.chat.id);
        await this.repository.recordGroupFind(ctx.broker.uuid, chatId, msg.chat.title ?? null);
        await ctx.tg
            .sendMessage(chatId, ctx.st('groupCaptured', { id: chatId }), {
                messageThreadId: msg.message_thread_id,
                parseMode: 'HTML',
            })
            .catch(() => {});
    }

    // ----------------------- stats -----------------------

    private statsPeriod(t: T, period: string, p: StatsWindow): string {
        return t('statsPeriod', {
            period: new Html(period),
            newCustomers: p.newCustomers,
            active: p.activeCustomers,
            referrals: p.referrals,
            sales: p.sales,
            salesAmount: formatToman(p.salesAmount, t),
            topups: p.topups,
            topupsAmount: formatToman(p.topupsAmount, t),
            rejected: p.rejectedTopups,
            trials: p.trials,
            rewards: formatToman(p.rewards, t),
        });
    }

    private statsTotals(t: T, r: BotReport): string {
        return t('statsTotals', {
            customers: r.totals.customers,
            buyers: r.totals.buyers,
            sales: r.totals.sales,
            salesAmount: formatToman(r.totals.salesAmount, t),
            wallets: formatToman(r.totals.walletTotal, t),
            pending: r.totals.pendingReceipts,
        });
    }

    /** /stats from a group admin: today, the last 7 and 30 days, and the totals. */
    private async handleStats(ctx: Ctx, msg: TgMessage): Promise<void> {
        if (ctx.broker.isDisabled || !(await this.isGroupAdmin(ctx, msg.from!.id))) return;
        const r = await this.repository.getReport(ctx.broker.uuid, ctx.bot.statsResetAt);
        const text = [
            ctx.st('statsTitle'),
            this.statsPeriod(ctx.st, ctx.st('statsToday'), r.today),
            this.statsPeriod(ctx.st, ctx.st('stats7d'), r.week),
            this.statsPeriod(ctx.st, ctx.st('stats30d'), r.month),
            this.statsTotals(ctx.st, r),
        ].join('\n\n');
        await ctx.tg.sendMessage(ctx.bot.groupId!, text, {
            messageThreadId: msg.message_thread_id,
            parseMode: 'HTML',
        });
    }

    /**
     * Staff topics take their names from the texts editor, so groups made before a rename (like
     * Logs → Stats) catches up. Best effort: needs the manage-topics right.
     */
    public async syncStaffTopics(tg: TelegramClient, bot: BrokerBots): Promise<void> {
        if (!bot.groupId) return;
        const t = translator(bot.texts, defaultLang(bot));
        const topics = [
            [bot.reviewTopicId, t('reviewTopicName')],
            [bot.logsTopicId, t('logsTopicName')],
        ] as const;
        for (const [id, name] of topics) {
            if (id) await tg.editForumTopic(bot.groupId, id, name).catch(() => {});
        }
    }

    /**
     * Yesterday's numbers in the staff group's stats topic (General before the topics exist), once
     * per UTC day (`today`). Claimed first, so a bot without a group isn't retried all day.
     */
    public async postDailySummary(brokerUuid: string, today: Date): Promise<void> {
        if (!(await this.repository.claimSummaryDay(brokerUuid, today))) return;
        const ctx = await this.panelContext(brokerUuid);
        if (!ctx?.bot.groupId || ctx.broker.isDisabled) return;
        const r = await this.repository.getReport(brokerUuid, ctx.bot.statsResetAt);
        const date = new Date(today.getTime() - DAY_MS).toISOString().slice(0, 10);
        const text = [
            this.statsPeriod(ctx.st, ctx.st('dailySummaryTitle', { date }), r.yesterday),
            this.statsTotals(ctx.st, r),
        ].join('\n\n');
        await this.syncStaffTopics(ctx.tg, ctx.bot);
        await ctx.tg.sendMessage(ctx.bot.groupId, text, {
            messageThreadId: ctx.bot.logsTopicId ?? undefined,
            parseMode: 'HTML',
        });
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
                    const reason = msg.text;
                    await this.finalizeReview(
                        ctx,
                        order,
                        ctx.st('rejectedByReason', { admin: adminName(msg.from), reason }),
                    );
                    await this.dmCustomer(ctx, order.customerId, (t) =>
                        t('topupRejectedReason', { reason }),
                    );
                    this.log(ctx, ctx.st('logRejectedReason', { id: orderId, reason }));
                }
                return;
            }
        }

        // Ticket reply → relay to the customer. Only group ADMINS speak as staff
        // (otherwise any group member's message in a ticket topic would reach the customer).
        const customer = await this.repository.getCustomerByTicketTopic(ctx.broker.uuid, thread);
        if (customer && msg.text) {
            if (!(await this.isGroupAdmin(ctx, msg.from.id))) return;
            await ctx.tg.sendMessage(
                customer.chatId,
                this.tFor(ctx, customer)('supportReply', { text: msg.text }),
                { parseMode: 'HTML' },
            );
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

        const t = this.tFor(ctx, customer);
        if (decision === 'approve') {
            const approval = await this.repository.approveTopup(order);
            if (approval === null) return 'not_pending';
            await this.finalizeReview(ctx, order, ctx.st('approvedBy', { admin: who }));
            await ctx.tg
                .sendMessage(
                    customer.chatId,
                    this.walletCharged(t, order.amount, approval.balance),
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
            this.logTopup(ctx, orderId, order.amount, customer);
            await this.notifyReward(ctx, approval.reward, orderId);
        } else {
            if (!(await this.repository.rejectOrder(orderId, reason ?? null))) return 'not_pending';
            await this.finalizeReview(
                ctx,
                order,
                reason
                    ? ctx.st('rejectedByReason', { admin: who, reason })
                    : ctx.st('rejectedBy', { admin: who }),
            );
            await ctx.tg
                .sendMessage(
                    customer.chatId,
                    reason ? t('topupRejectedReason', { reason }) : t('topupRejected'),
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
            this.log(
                ctx,
                reason
                    ? ctx.st('logRejectedReason', { id: orderId, reason })
                    : ctx.st('logRejected', { id: orderId }),
            );
        }
        return 'ok';
    }

    public async recoverPlanOrder(
        brokerUuid: string,
        brokerUsername: string,
        orderId: number,
        decision: 'approve' | 'reject',
        userId?: number,
    ): Promise<'approved' | 'refunded' | 'invalid_user' | 'not_pending'> {
        const result = await this.repository.recoverPlanOrder(
            brokerUuid,
            brokerUsername,
            orderId,
            decision,
            userId,
        );
        if (result.status !== 'approved') return result.status;

        try {
            const ctx = await this.panelContext(brokerUuid);
            if (ctx) {
                await ctx.tg
                    .sendMessage(
                        result.customer.chatId,
                        this.tFor(ctx, result.customer)('approved', {
                            link: this.subUrl(result.user.shortUuid),
                        }),
                        { parseMode: 'HTML' },
                    )
                    .catch(() => {});
            }
        } catch (error) {
            this.logger.warn(
                `Broker ${brokerUuid} recovered order ${orderId}, but customer notification failed: ${error instanceof Error ? error.message : error}`,
            );
        }
        return 'approved';
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
                    this.walletCharged(this.tFor(ctx, customer), amount, balance),
                    { parseMode: 'HTML' },
                )
                .catch(() => {});
            this.log(
                ctx,
                ctx.st('logManualTopup', {
                    amount: formatToman(amount, ctx.st),
                    customer: who(customer),
                }),
            );
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
