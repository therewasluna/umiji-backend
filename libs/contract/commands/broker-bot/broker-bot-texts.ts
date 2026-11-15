import { z } from 'zod';

import { BROKER_BOT_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

/** Languages a broker bot can speak. Customers pick among the ones the broker enables. */
export const BROKER_BOT_LANGS = ['en', 'fa', 'ar', 'ru', 'tr', 'zh'] as const;
export type TBrokerBotLang = (typeof BROKER_BOT_LANGS)[number];

/** Shown to customers as is, so each in its own language. */
export const BROKER_BOT_LANG_NAMES: Record<TBrokerBotLang, string> = {
    en: 'English',
    fa: 'فارسی',
    ar: 'العربية',
    ru: 'Русский',
    tr: 'Türkçe',
    zh: '简体中文',
};

export const BROKER_BOT_RTL_LANGS: readonly TBrokerBotLang[] = ['fa', 'ar'];

/**
 * message: Telegram HTML. button, alert (the pop-up after a tap), topic (a staff group topic
 * name) and word (a unit inside other texts) are plain text.
 */
export type TBrokerBotTextKind = 'alert' | 'button' | 'message' | 'topic' | 'word';

export const BROKER_BOT_TEXT_MAX: Record<TBrokerBotTextKind, number> = {
    message: 3000,
    button: 100,
    alert: 200,
    topic: 100,
    word: 32,
};

export const BROKER_BOT_TEXT_GROUPS = [
    'menu',
    'plans',
    'wallet',
    'subs',
    'referral',
    'trial',
    'support',
    'channels',
    'words',
    'staff',
] as const;
export type TBrokerBotTextGroup = (typeof BROKER_BOT_TEXT_GROUPS)[number];

interface ITextDef {
    group: TBrokerBotTextGroup;
    kind: TBrokerBotTextKind;
    vars?: readonly string[];
}

const def = (
    group: TBrokerBotTextGroup,
    kind: TBrokerBotTextKind,
    ...vars: string[]
): ITextDef => ({
    group,
    kind,
    vars,
});

/** Every text the bot sends. Defaults per language are served by GetBrokerBotTextsCommand. */
export const BROKER_BOT_TEXTS = {
    // Main menu
    greeting: def('menu', 'message'),
    useMenu: def('menu', 'message'),
    menuBuy: def('menu', 'button'),
    menuSubs: def('menu', 'button'),
    menuWallet: def('menu', 'button'),
    menuSupport: def('menu', 'button'),
    menuChannel: def('menu', 'button'),
    menuLanguage: def('menu', 'button'),
    chooseLanguage: def('menu', 'message'),
    btnBack: def('menu', 'button'),

    // Plans and checkout
    chooseCategory: def('plans', 'message'),
    catOther: def('plans', 'button'),
    choosePlan: def('plans', 'message'),
    noPlans: def('plans', 'message'),
    planButton: def('plans', 'button', 'title', 'traffic', 'duration', 'price'),
    planReview: def(
        'plans',
        'message',
        'title',
        'traffic',
        'duration',
        'devices',
        'price',
        'balance',
    ),
    btnBuyWallet: def('plans', 'button'),
    insufficient: def('plans', 'message', 'balance', 'price'),
    approved: def('plans', 'message', 'link'),
    unavailable: def('plans', 'message'),

    // Wallet and top-ups
    walletScreen: def('wallet', 'message', 'balance'),
    btnCharge: def('wallet', 'button'),
    chargePrompt: def('wallet', 'message'),
    invalidAmount: def('wallet', 'message'),
    topupNoMethods: def('wallet', 'message'),
    tooManyPending: def('wallet', 'message'),
    topupInstructions: def('wallet', 'message', 'amount', 'destinations'),
    topupSubmitted: def('wallet', 'message'),
    walletCharged: def('wallet', 'message', 'amount', 'balance'),
    topupRejected: def('wallet', 'message'),
    topupRejectedReason: def('wallet', 'message', 'reason'),

    // My subscriptions
    subsPick: def('subs', 'message'),
    subsEmpty: def('subs', 'message'),
    subFallback: def('subs', 'button', 'number'),
    subDetail: def('subs', 'message', 'name', 'used', 'limit', 'expires', 'link', 'configs'),
    subConfigs: def('subs', 'message'),

    // Referral program
    menuInvite: def('referral', 'button'),
    inviteScreen: def('referral', 'message', 'inviteLink', 'percent', 'invited', 'earned'),
    referralReward: def('referral', 'message', 'amount', 'balance'),

    // Free trial
    menuTrial: def('trial', 'button'),
    trialReview: def('trial', 'message', 'traffic', 'duration', 'devices'),
    btnTrialClaim: def('trial', 'button'),
    trialUsed: def('trial', 'message'),
    trialSoldOut: def('trial', 'message'),

    // Support
    supportPrompt: def('support', 'message'),
    supportSent: def('support', 'message'),
    supportUnavailable: def('support', 'message'),
    supportReply: def('support', 'message', 'text'),

    // Mandatory channels
    joinRequired: def('channels', 'message'),
    btnJoinChannel: def('channels', 'button', 'title'),
    btnJoined: def('channels', 'button'),
    notJoinedYet: def('channels', 'alert'),

    // Units used inside other texts
    currency: def('words', 'word'),
    unlimited: def('words', 'word'),
    days: def('words', 'word'),
    hours: def('words', 'word'),

    // Staff group, in the bot's default language
    reviewTopicName: def('staff', 'topic'),
    reviewTopicIntro: def('staff', 'message'),
    logsTopicName: def('staff', 'topic'),
    logsTopicIntro: def('staff', 'message'),
    topupReview: def('staff', 'message', 'id', 'customer', 'tgId', 'amount'),
    btnApprove: def('staff', 'button'),
    btnReject: def('staff', 'button'),
    btnRejectNoReason: def('staff', 'button'),
    btnRejectWithReason: def('staff', 'button'),
    btnStaffBack: def('staff', 'button'),
    askRejectReason: def('staff', 'message', 'id'),
    approvedBy: def('staff', 'message', 'admin'),
    rejectedBy: def('staff', 'message', 'admin'),
    rejectedByReason: def('staff', 'message', 'admin', 'reason'),
    alertApproved: def('staff', 'alert'),
    alertRejected: def('staff', 'alert'),
    alertSendReason: def('staff', 'alert'),
    alertHandled: def('staff', 'alert'),
    alertNothing: def('staff', 'alert'),
    alertAdminsOnly: def('staff', 'alert'),
    alertInactive: def('staff', 'alert'),
    ticketTopicName: def('staff', 'topic', 'name'),
    ticketIntro: def('staff', 'message', 'name', 'tgId'),
    ticketRelay: def('staff', 'message', 'text'),
    groupCaptured: def('staff', 'message', 'id'),
    logTopup: def('staff', 'message', 'id', 'amount', 'customer'),
    logRejected: def('staff', 'message', 'id'),
    logRejectedReason: def('staff', 'message', 'id', 'reason'),
    logError: def('staff', 'message', 'error'),
    logMembership: def('staff', 'message', 'channel', 'error'),
    logNewCustomer: def('staff', 'message', 'customer', 'tgId'),
    logNewReferral: def('staff', 'message', 'customer', 'tgId', 'referrer'),
    logPurchase: def('staff', 'message', 'id', 'customer', 'plan', 'amount'),
    logTrial: def('staff', 'message', 'customer'),
    logReward: def('staff', 'message', 'amount', 'referrer', 'id'),
    logManualTopup: def('staff', 'message', 'amount', 'customer'),

    // Stats: /stats in the staff group and the daily summary in its stats topic (logsTopicName)
    statsTitle: def('staff', 'message'),
    dailySummaryTitle: def('staff', 'message', 'date'),
    statsToday: def('staff', 'message'),
    stats7d: def('staff', 'message'),
    stats30d: def('staff', 'message'),
    statsPeriod: def(
        'staff',
        'message',
        'period',
        'newCustomers',
        'active',
        'referrals',
        'sales',
        'salesAmount',
        'topups',
        'topupsAmount',
        'rejected',
        'trials',
        'rewards',
    ),
    statsTotals: def(
        'staff',
        'message',
        'customers',
        'buyers',
        'sales',
        'salesAmount',
        'wallets',
        'pending',
    ),
} as const satisfies Record<string, ITextDef>;

export type TBrokerBotTextKey = keyof typeof BROKER_BOT_TEXTS;
export const BROKER_BOT_TEXT_KEYS = Object.keys(BROKER_BOT_TEXTS) as TBrokerBotTextKey[];

// ----------------------- Telegram HTML -----------------------

/** The tags Telegram's HTML parse mode accepts. */
const TG_TAGS = new Set([
    'a',
    'b',
    'blockquote',
    'code',
    'del',
    'em',
    'i',
    'ins',
    'pre',
    's',
    'span',
    'strike',
    'strong',
    'tg-spoiler',
    'u',
]);
const TAG_RE = /<(\/?)([a-z][a-z-]*)((?:\s+[a-z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*>/iy;
const ATTR_RE = /([a-z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/gi;
const VAR_RE = /\{(\w+)\}/g;
const LINK_RE = /^(?:https?:\/\/|tg:\/\/|\{\w+\})/i;

export type TTelegramHtmlToken =
    | { type: 'close'; tag: string }
    | { type: 'open'; tag: string; attrs: Record<string, string> }
    | { type: 'text'; text: string };

export type TBrokerBotTextError =
    | { code: 'badAttr' | 'nested' | 'unclosed' | 'unexpectedClose'; tag: string }
    | { code: 'badLink' }
    | { code: 'empty' }
    | { code: 'newline' }
    | { code: 'tooLong'; max: number }
    | { code: 'unknownVar'; name: string };

/**
 * Splits Telegram HTML into tags and text. A `<` that doesn't open a known tag is text, so
 * "<3" or "a < b" need no escaping: they're escaped when sent.
 */
export function tokenizeTelegramHtml(html: string): TTelegramHtmlToken[] {
    const tokens: TTelegramHtmlToken[] = [];
    let text = '';
    let i = 0;
    while (i < html.length) {
        if (html[i] === '<') {
            TAG_RE.lastIndex = i;
            const m = TAG_RE.exec(html);
            if (m && TG_TAGS.has(m[2].toLowerCase())) {
                if (text) tokens.push({ type: 'text', text });
                text = '';
                const tag = m[2].toLowerCase();
                if (m[1]) {
                    tokens.push({ type: 'close', tag });
                } else {
                    const attrs: Record<string, string> = {};
                    for (const a of m[3].matchAll(ATTR_RE)) {
                        attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? '';
                    }
                    tokens.push({ type: 'open', tag, attrs });
                }
                i = TAG_RE.lastIndex;
                continue;
            }
        }
        text += html[i++];
    }
    if (text) tokens.push({ type: 'text', text });
    return tokens;
}

function attrsError(tag: string, attrs: Record<string, string>): TBrokerBotTextError | null {
    const names = Object.keys(attrs);
    const only = (...allowed: string[]) => names.every((n) => allowed.includes(n));
    if (tag === 'a') {
        if (!only('href')) return { code: 'badAttr', tag };
        return LINK_RE.test(attrs.href ?? '') ? null : { code: 'badLink' };
    }
    if (tag === 'span') {
        return only('class') && attrs.class === 'tg-spoiler' ? null : { code: 'badAttr', tag };
    }
    if (tag === 'code') {
        return only('class') && (!names.length || /^language-[\w+-]+$/.test(attrs.class))
            ? null
            : { code: 'badAttr', tag };
    }
    if (tag === 'blockquote') return only('expandable') ? null : { code: 'badAttr', tag };
    return names.length ? { code: 'badAttr', tag } : null;
}

/** Why Telegram (or the bot) would refuse this text, or null when it's fine. */
export function checkBrokerBotText(
    key: TBrokerBotTextKey,
    text: string,
): TBrokerBotTextError | null {
    const { kind, vars = [] } = BROKER_BOT_TEXTS[key] as ITextDef;
    if (!text.trim()) return { code: 'empty' };
    if (text.length > BROKER_BOT_TEXT_MAX[kind]) {
        return { code: 'tooLong', max: BROKER_BOT_TEXT_MAX[kind] };
    }
    for (const [, name] of text.matchAll(VAR_RE)) {
        if (!vars.includes(name)) return { code: 'unknownVar', name };
    }
    if (kind !== 'message' && kind !== 'alert' && text.includes('\n')) return { code: 'newline' };
    if (kind !== 'message') return null;

    const open: string[] = [];
    for (const token of tokenizeTelegramHtml(text)) {
        if (token.type === 'text') continue;
        const parent = open[open.length - 1];
        if (token.type === 'close') {
            if (parent !== token.tag) return { code: 'unexpectedClose', tag: token.tag };
            open.pop();
            continue;
        }
        const attrError = attrsError(token.tag, token.attrs);
        if (attrError) return attrError;
        // Telegram allows nothing inside code and pre, except code directly in pre.
        const inCode = parent === 'code' || (parent === 'pre' && token.tag !== 'code');
        if (inCode || (token.tag === 'a' && open.includes('a'))) {
            return { code: 'nested', tag: token.tag };
        }
        if (token.tag === 'blockquote' && open.includes('blockquote')) {
            return { code: 'nested', tag: token.tag };
        }
        open.push(token.tag);
    }
    return open.length ? { code: 'unclosed', tag: open[open.length - 1] } : null;
}

export function describeBrokerBotTextError(e: TBrokerBotTextError): string {
    switch (e.code) {
        case 'empty':
            return 'Text is empty';
        case 'tooLong':
            return `Longer than ${e.max} characters`;
        case 'unknownVar':
            return `Unknown variable {${e.name}}`;
        case 'newline':
            return 'Must be a single line';
        case 'badLink':
            return 'Links must start with https://, http:// or tg://';
        case 'badAttr':
            return `Unsupported attribute on <${e.tag}>`;
        case 'nested':
            return `<${e.tag}> can't go there`;
        case 'unclosed':
            return `<${e.tag}> is never closed`;
        default:
            return `</${e.tag}> doesn't match an open tag`;
    }
}

// ----------------------- commands -----------------------

const TextsByKeySchema = z.partialRecord(
    z.enum(BROKER_BOT_TEXT_KEYS as [TBrokerBotTextKey, ...TBrokerBotTextKey[]]),
    z.string(),
);

const BrokerBotTextsSchema = z.object({
    langs: z.array(z.enum(BROKER_BOT_LANGS)).describe('Languages customers can pick, in order'),
    defaultLang: z.enum(BROKER_BOT_LANGS).describe('For new customers and the staff group'),
    texts: z
        .partialRecord(z.enum(BROKER_BOT_LANGS), TextsByKeySchema)
        .describe("The broker's own texts. A missing one uses the default."),
});

export namespace GetBrokerBotTextsCommand {
    export const url = REST_API.BROKER_BOT.TEXTS.GET;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.TEXTS.GET,
        'get',
        "Get the bot's languages and texts",
        { scope: 'texts', kind: 'read' },
    );

    export const ResponseSchema = z.object({
        response: BrokerBotTextsSchema.extend({
            defaults: z.record(z.enum(BROKER_BOT_LANGS), z.record(z.string(), z.string())),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace UpdateBrokerBotTextsCommand {
    export const url = REST_API.BROKER_BOT.TEXTS.UPDATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        BROKER_BOT_ROUTES.TEXTS.UPDATE,
        'put',
        "Replace the bot's languages and texts",
        { scope: 'texts', kind: 'write' },
        'Texts are replaced as a whole. A blank text, or one equal to the default, is dropped.',
    );

    export const RequestBodySchema = BrokerBotTextsSchema.superRefine((body, ctx) => {
        if (!body.langs.length || new Set(body.langs).size !== body.langs.length) {
            ctx.addIssue({
                code: 'custom',
                path: ['langs'],
                message: 'Pick at least one language, once each',
            });
        }
        if (!body.langs.includes(body.defaultLang)) {
            ctx.addIssue({
                code: 'custom',
                path: ['defaultLang'],
                message: 'Must be one of the languages',
            });
        }
        for (const [lang, texts] of Object.entries(body.texts)) {
            for (const [key, text] of Object.entries(texts ?? {})) {
                if (!text?.trim() || !(key in BROKER_BOT_TEXTS)) continue;
                const error = checkBrokerBotText(key as TBrokerBotTextKey, text);
                if (error) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['texts', lang, key],
                        message: `${lang}.${key}: ${describeBrokerBotTextError(error)}`,
                    });
                }
            }
        }
    });

    export const ResponseSchema = GetBrokerBotTextsCommand.ResponseSchema;

    export type Request = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
