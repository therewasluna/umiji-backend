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

export const BrokerBotRequiredChannelSchema = z.object({
    chatRef: z
        .string()
        .trim()
        .regex(/^(@\w{3,}|-?\d+)$/, 'Must be a @username or a -100… numeric ID'),
    title: z.string().trim().min(1).max(64),
    url: BrokerBotTelegramLinkSchema,
});

export const BrokerBotPlanSchema = z.object({
    id: z.int(),
    title: z.string(),
    trafficGb: z.number().describe('0 = unlimited'),
    durationDays: z.int(),
    price: z.int().describe('Toman'),
    squadUuid: z.nullable(z.uuid()),
    categoryId: z.nullable(z.int()),
    isActive: z.boolean(),
});

export const BrokerBotResponseSchema = z.object({
    response: z.object({
        isConnected: z.boolean(),
        botUsername: z.nullable(z.string()),
        groupId: z.nullable(z.string()),
        topicsReady: z.boolean(),
        lang: z.enum(['en', 'fa']),
        greeting: z.nullable(z.string()),
        channelUrl: z.nullable(z.string()),
        cards: z.array(BrokerBotCardSchema),
        wallets: z.array(BrokerBotWalletSchema),
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
    kind: z.enum(['topup', 'plan']),
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
