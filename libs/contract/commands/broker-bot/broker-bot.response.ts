import { z } from 'zod';

/** 100,000,000 Toman: caps any single amount so wallet sums stay exact. */
export const BROKER_BOT_MAX_TOMAN = 100_000_000;

const TELEGRAM_LINK = /^https:\/\/(t\.me|telegram\.me)\//i;

export const BrokerBotTelegramLinkSchema = z
    .string()
    .trim()
    .max(255)
    .regex(TELEGRAM_LINK, 'Must be a https://t.me/… link');

export const BrokerBotCardSchema = z.object({
    cardNumber: z.string().trim().min(1).max(64),
    holderName: z.string().trim().min(1).max(128),
});

export const BrokerBotWalletSchema = z.object({
    asset: z.string().trim().min(1).max(32),
    address: z.string().trim().min(1).max(256),
});

/** Any transfer the customer makes by hand (PayPal, IBAN, SBP…): no API, the receipt is reviewed. */
export const BrokerBotPayMethodSchema = z.object({
    method: z.string().trim().min(1).max(32).describe('Shown as the title, e.g. PayPal'),
    account: z.string().trim().min(1).max(256).describe('Email, IBAN, phone, wallet or link'),
    note: z.string().trim().max(128).describe('Holder, bank or rate; may be empty'),
});

export const BrokerBotRequiredChannelSchema = z.object({
    chatRef: z
        .string()
        .trim()
        .regex(/^(@\w{3,}|-?\d+)$/, 'Must be a @username or a -100… numeric ID'),
    title: z.string().trim().min(1).max(64),
    url: BrokerBotTelegramLinkSchema,
});

/** The squads a plan's or the trial's subscription gets, every one of them. */
export const BrokerBotSquadUuidsSchema = z
    .array(z.uuid())
    .min(1, 'Pick at least one squad.')
    .refine((a) => new Set(a).size === a.length, 'Each squad can be picked once.');

export const BrokerBotPlanSchema = z.object({
    id: z.int(),
    title: z.string(),
    trafficGb: z.number().describe('0 = unlimited'),
    durationDays: z.int(),
    price: z.int().describe('Toman'),
    squadUuids: z.array(z.uuid()),
    ipLimit: z.nullable(z.int()).describe('IPs at once across all nodes, null = unlimited'),
    categoryId: z.nullable(z.int()),
    isActive: z.boolean(),
});

/** The free test plan: every Telegram account can claim it once per round. */
export const BrokerBotTrialSchema = z.object({
    isActive: z.boolean(),
    trafficGb: z.number().min(0, 'Traffic must be ≥ 0.').max(1_000_000).describe('0 = unlimited'),
    durationDays: z.int().min(1, 'Duration must be at least 1 day.').max(3650),
    durationHours: z
        .int()
        .min(1)
        .max(3650)
        .nullish()
        .describe('Trial length in hours. When set, it is used instead of durationDays.'),
    squadUuids: BrokerBotSquadUuidsSchema,
    ipLimit: z
        .int()
        .min(1)
        .max(100)
        .nullish()
        .describe(
            'How many IPs each trial user can connect from at once (beta). Empty = unlimited.',
        ),
    dailyLimit: z
        .int()
        .min(1)
        .max(100_000)
        .nullish()
        .describe('Most trials handed out per UTC day. Empty = no cap.'),
    deleteExpired: z
        .boolean()
        .optional()
        .describe(
            'Delete trial users a day after they expire, so they stop counting toward the broker. ' +
                'Covers every expired trial user, also ones extended by hand that expired again.',
        ),
});

export const BrokerBotResponseSchema = z.object({
    response: z.object({
        isConnected: z.boolean(),
        botUsername: z.nullable(z.string()),
        groupId: z.nullable(z.string()),
        topicsReady: z.boolean(),
        channelUrl: z.nullable(z.string()),
        cards: z.array(BrokerBotCardSchema),
        wallets: z.array(BrokerBotWalletSchema),
        payMethods: z.array(BrokerBotPayMethodSchema),
        requiredChannels: z.array(BrokerBotRequiredChannelSchema),
        groupFinds: z.array(
            z.object({
                chatId: z.string(),
                title: z.nullable(z.string()),
                foundAt: z.string(),
            }),
        ),
        categories: z.array(z.object({ id: z.int(), title: z.string() })),
        plans: z.array(BrokerBotPlanSchema),
        referralPercent: z
            .int()
            .describe(
                "Share of a referred customer's approved top-ups paid to the referrer. 0 = off.",
            ),
        trial: z.nullable(BrokerBotTrialSchema),
        trialResetAt: z.iso
            .datetime()
            .transform((str) => new Date(str))
            .describe('Start of the current trial round'),
        trialClaims: z.int().describe('Trials claimed this round'),
        stats: z.nullable(
            z
                .object({
                    usersTotal: z.int(),
                    activeToday: z.int(),
                    newToday: z.int(),
                    active7d: z.int(),
                    walletTotal: z.number(),
                    plansSold: z.int(),
                    topupsTotal: z.number(),
                    pendingReceipts: z.int(),
                })
                .describe('Counted since the bot token last changed. Null while disconnected.'),
        ),
    }),
});

export const BrokerBotOrderSchema = z.object({
    id: z.int(),
    userId: z.nullable(z.int()),
    kind: z.enum(['topup', 'plan', 'trial', 'referral']),
    status: z.enum(['pending', 'approved', 'rejected']),
    amount: z.int().describe('Toman'),
    receiptKind: z.nullable(z.enum(['photo', 'text'])),
    receiptText: z.nullable(z.string()),
    rejectReason: z.nullable(z.string()),
    planTitle: z.nullable(z.string()),
    customer: z.object({
        tgUserId: z.string(),
        name: z.nullable(z.string()),
        username: z.nullable(z.string()),
    }),
    createdAt: z.iso.datetime().transform((str) => new Date(str)),
});
