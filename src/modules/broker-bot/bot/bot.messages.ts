import { InlineButton, InlineKeyboard } from './telegram.client';

/** The parts of a plan the bot shows. */
export interface Plan {
    title: string;
    trafficGb: number;
    durationDays: number;
    price: number;
}

// Copy is ported as-is from rembroker's bot: customers of existing brokers see the same bot.

export type Lang = 'en' | 'fa';

/** Escape a dynamic value for Telegram HTML parse_mode (customer-facing messages use HTML). */
export function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const M = {
    en: {
        menuBuy: '🛒 Buy a plan',
        menuSubs: '📦 My subscriptions',
        menuSupport: '💬 Support',
        menuChannel: '📣 Our channel',
        greeting:
            '👋 <b>Welcome aboard!</b>\n\n' +
            '🚀 Say goodbye to limits — unlock the whole internet at blazing speed, fully secured.\n\n' +
            '✨ <b>Why you’ll love it:</b>\n' +
            '⚡️ Ultra-fast servers — stream, game and download with zero throttling\n' +
            '🌍 Premium global locations for everything you love\n' +
            '🔒 Private and encrypted — your data stays yours, always\n' +
            '📱 Works on all your devices at the same time\n' +
            '♾️ Rock-solid, always-on stability\n' +
            '🎧 Real human support whenever you need it\n' +
            '💸 Fair pricing plus a money-back guarantee\n\n' +
            '👇 <b>Tap a button below to get started!</b>',
        choosePlan:
            '🛒 <b>Awesome — let’s get you connected!</b>\n\n' +
            '⚡️ Every plan runs on our fastest, most stable servers.\n' +
            '💫 <i>Pick the one that fits you and tap it to see the full details</i> 👇',
        noPlans:
            '😔 <b>No plans available right now.</b>\n\n🙏 We’re likely restocking — please check back very soon!',
        btnBack: '⬅️ Back',
        btnPay: '💳 Continue to payment',
        btnCard: '💳 Card to card',
        btnCrypto: '🪙 Crypto',
        choosePayment:
            '💳 <b>Almost yours!</b>\n\nChoose how you’d like to pay — <i>pick whatever’s easiest</i> 👇',
        cardInstructions: (amount: string, cards: string) =>
            '🧾 <b>One last step and you’re in!</b>\n\n' +
            `💰 Transfer exactly <b>${amount}</b> to one of the cards below:\n\n${cards}\n\n` +
            '📸 <i>Then send a photo of your receipt right here</i> — our team will confirm it in a flash ⚡️',
        cryptoInstructions: (amount: string, wallets: string) =>
            '🧾 <b>One last step and you’re in!</b>\n\n' +
            `🪙 Send the equivalent of <b>${amount}</b> to one of the wallets below:\n\n${wallets}\n\n` +
            '📸 <i>Then send your transaction hash or a screenshot right here</i> — we’ll confirm it in a flash ⚡️',
        sendReceipt:
            '📸 <b>All paid up?</b>\n\nJust send a photo of your receipt here and our team will activate your subscription as fast as possible ⚡️',
        receiptSubmitted:
            '✅ <b>Received — thank you!</b> 🙌\n\n⏳ Your receipt is in our review queue. <i>Sit tight</i> — we’ll message you the second it’s approved! ✨',
        unavailable:
            '😔 <b>Purchases are paused right now.</b>\n\n🙏 Please try again a little later — we’ll be back before you know it!',
        supportPrompt:
            '💬 <b>We’re all ears!</b>\n\n✍️ Type your message below and our team will reply right here.\n\n↩️ <i>Send /start anytime to return to the menu.</i>',
        supportSent:
            '✅ <b>Message sent!</b> 🚀\n\nOur team has it and will reply right here very soon. <i>Thanks for reaching out!</i> 🙏',
        supportUnavailable:
            '😔 <b>Support isn’t available right now.</b>\n\n🙏 Please try again a little later!',
        approved: (u: string) =>
            '🎉🎉 <b>You’re all set!</b> 🎉🎉\n\n' +
            '🚀 Your subscription is active and ready to fly.\n\n' +
            `🔗 <b>Your personal connection link:</b>\n<code>${esc(u)}</code>\n\n` +
            '🔐 <i>Keep it private — it’s just for you.</i>\n' +
            '📊 Tap “📦 My subscriptions” anytime to track your usage.\n\n' +
            'Enjoy the ride! ✨',
        rejectedGeneric:
            '❌ <b>Hmm — we couldn’t approve your receipt this time.</b>\n\n🤝 No worries! Tap 💬 Support and our team will sort it out with you right away.',
        rejectedReason: (r: string) =>
            `❌ <b>We couldn’t approve your receipt this time.</b>\n\n📝 <b>Reason:</b> <i>${esc(r)}</i>\n\n🤝 Need a hand? Tap 💬 Support and we’ll help you out!`,
        subsHeader: '📦 <b>Your active subscriptions:</b>',
        subsEmpty:
            '📭 <b>No subscriptions yet!</b>\n\n🚀 Ready to get connected? Tap “🛒 Buy a plan” and you’ll be online in minutes.',
        subLine: (name: string, used: string, limit: string, exp: string, url: string) =>
            `• <b>${esc(name)}</b>\n   📊 ${used} / ${limit}\n   📅 expires ${exp}\n   🔗 <code>${esc(url)}</code>`,
        subsPick:
            '📦 <b>Your subscriptions</b>\n\n<i>Tap one to see its details and connection links.</i>',
        subFallback: (n: number) => `Subscription #${n}`,
        subDetail: (d: {
            name: string;
            used: string;
            limit: string;
            exp: string;
            subUrl: string;
            links: string[];
        }) =>
            `📦 <b>${esc(d.name)}</b>\n\n` +
            `📊 <b>Usage:</b> ${d.used} / ${d.limit}\n` +
            `📅 <b>Expires:</b> ${d.exp}\n\n` +
            `🔗 <b>Subscription link:</b>\n<code>${esc(d.subUrl)}</code>` +
            (d.links.length
                ? `\n\n🔐 <b>Connection configs:</b>\n` +
                  d.links.map((l) => `<code>${esc(l)}</code>`).join('\n')
                : ''),
        chooseCategory: '🗂 <b>Pick a category</b>\n\n<i>Choose a category to see its plans.</i> 👇',
        catOther: '📦 Other',
        support: (t: string) => `💬 ${t}`,
        useMenu: '👇 <b>Tap one of the buttons below to get started!</b>',
        menuWallet: '💰 My wallet',
        walletScreen: (balance: string) =>
            `💰 <b>Your wallet</b>\n\nBalance: <b>${balance}</b>\n\nUse it to buy any plan instantly.`,
        btnCharge: '➕ Charge wallet',
        chargePrompt:
            '💳 <b>How much would you like to add?</b>\n\nSend the amount in Toman (e.g. <code>50000</code>).',
        invalidAmount: 'Please send a valid amount in Toman — numbers only, e.g. 50000.',
        topupInstructions: (amount: string, destinations: string) =>
            `🧾 <b>Adding ${amount} to your wallet</b>\n\nTransfer exactly <b>${amount}</b> to one of the destinations below, then send a photo of your receipt here 📸\n\n${destinations}`,
        topupNoMethods: '😔 Payment isn’t set up yet — please contact 💬 Support.',
        topupSubmitted:
            '✅ <b>Received — thank you!</b> 🙌\n\n⏳ Your top-up is under review. We’ll credit your wallet the moment it’s approved.',
        walletCharged: (amount: string, balance: string) =>
            `✅ <b>Wallet charged!</b> 🎉\n\n➕ ${amount} added.\n💰 New balance: <b>${balance}</b>`,
        topupRejected: '❌ Your top-up couldn’t be approved. Please contact 💬 Support.',
        insufficient: (balance: string, price: string) =>
            `😕 <b>Not enough balance.</b>\n\n💰 Your wallet: <b>${balance}</b>\n🏷 Plan price: <b>${price}</b>\n\nCharge your wallet, then grab the plan.`,
        btnBuyWallet: '💳 Pay from wallet',
        reviewBalance: (balance: string) => `💰 Your wallet: <b>${balance}</b>`,
        lblTopup: 'Top-up',
        logTopup: (id: number, amount: string, who: string) =>
            `💰 Top-up #${id} approved — ${amount} credited to ${who}.`,
        unlimited: 'Unlimited',
        currency: 'Toman',
        tooManyPending:
            '⏳ <b>Hold on a moment!</b>\n\nYou’ve already got receipt(s) waiting in our review queue — <i>please wait until those are done before sending more</i> 🙏',
        groupCaptured: (id: string) =>
            `✅ Group captured.\nID: ${id}\n\nOpen your panel → Telegram → Group ID Finder and select this group.`,
        joinRequired:
            '🔓 <b>Almost there — one quick step!</b>\n\n📣 To unlock the bot, please join our channel(s) below 👇\n\n✅ <i>Once you’ve joined them all, tap “I’ve joined”</i> 🎉',
        btnJoined: '✅ I’ve joined',
        notJoinedYet:
            '🤔 Looks like you haven’t joined all of them yet. Please join every channel above, then tap “I’ve joined” again 🙏',
        planTraffic: '📊 Traffic',
        planDuration: '⏳ Duration',
        planPrice: '💰 Price',
        planPitch:
            '⚡️ <b>High-speed, secure and rock-stable</b> — activates in minutes.\n💳 <i>Tap “Continue to payment” to grab it!</i> 🚀',
        days: 'days',
        lblOrder: 'Order',
        payCard: '💳 Card to card',
        payCrypto: '🪙 Crypto',
        payNone: '—',
        approvedBy: (who: string) => `✅ Approved by ${who}`,
        rejectedBy: (who: string) => `❌ Rejected by ${who}`,
        rejectedByReason: (who: string, reason: string) =>
            `❌ Rejected by ${who}\nReason: ${reason}`,
        logError: (m: string) => `⚠️ Bot error: ${m}`,
        logApprovalBlocked: (id: number) =>
            `⚠️ Approval blocked for order #${id}: out of balance — top up first.`,
        logRejected: (id: number) => `❌ Order #${id} was rejected.`,
        logRejectedReason: (id: number, reason: string) =>
            `❌ Order #${id} was rejected: ${reason}`,
        logApproved: (id: number, username: string, who: string) =>
            `✅ Order #${id} approved → ${username} created for ${who}.`,
        logSubFailed: (id: number, err: string) =>
            `⚠️ Couldn't create the subscription for order #${id}: ${err}`,
        logMembership: (ref: string, err: string) =>
            `⚠️ Couldn't verify membership for ${ref}: ${err}`,
    },
    fa: {
        menuBuy: '🛒 خرید پلن',
        menuSubs: '📦 اشتراک‌های من',
        menuSupport: '💬 پشتیبانی',
        menuChannel: '📣 کانال ما',
        greeting:
            '👋 <b>خوش اومدی!</b>\n\n' +
            '🚀 محدودیت‌ها رو بذار کنار — کل اینترنت رو با سرعت بالا و امنیت کامل باز کن.\n\n' +
            '✨ <b>چرا عاشقش می‌شی:</b>\n' +
            '⚡️ سرورهای فوق‌سریع — استریم، گیم و دانلود بدون افت سرعت\n' +
            '🌍 لوکیشن‌های باکیفیت جهانی برای هر چیزی که دوست داری\n' +
            '🔒 امن و رمزنگاری‌شده — اطلاعاتت همیشه فقط مال خودته\n' +
            '📱 روی همه‌ی دستگاه‌هات، هم‌زمان\n' +
            '♾️ پایداری همیشگی و بدون قطعی\n' +
            '🎧 پشتیبانی واقعی، هر وقت لازم داشتی\n' +
            '💸 قیمت منصفانه به‌همراه ضمانت بازگشت وجه\n\n' +
            '👇 <b>برای شروع یکی از دکمه‌های زیر رو بزن!</b>',
        choosePlan:
            '🛒 <b>عالیه — بریم که وصلت کنیم!</b>\n\n' +
            '⚡️ همه‌ی پلن‌ها روی سریع‌ترین و پایدارترین سرورهای ما اجرا می‌شن.\n' +
            '💫 <i>اونی که بهت می‌خوره رو انتخاب کن و روش بزن تا جزئیات کاملش رو ببینی</i> 👇',
        noPlans:
            '😔 <b>الان پلنی موجود نیست.</b>\n\n🙏 احتمالاً داریم شارژ می‌کنیم — کمی بعد دوباره سر بزن!',
        btnBack: '⬅️ بازگشت',
        btnPay: '💳 ادامه و پرداخت',
        btnCard: '💳 کارت به کارت',
        btnCrypto: '🪙 ارز دیجیتال',
        choosePayment:
            '💳 <b>کم مونده تا مال تو بشه!</b>\n\nروش پرداختت رو انتخاب کن — <i>هر کدوم برات راحت‌تره</i> 👇',
        cardInstructions: (amount: string, cards: string) =>
            '🧾 <b>فقط یک قدم تا وصل شدنت!</b>\n\n' +
            `💰 دقیقاً مبلغ <b>${amount}</b> رو به یکی از کارت‌های زیر واریز کن:\n\n${cards}\n\n` +
            '📸 <i>بعد عکس رسیدت رو همین‌جا بفرست</i> — تیم ما در یه چشم‌به‌هم‌زدن تأییدش می‌کنه ⚡️',
        cryptoInstructions: (amount: string, wallets: string) =>
            '🧾 <b>فقط یک قدم تا وصل شدنت!</b>\n\n' +
            `🪙 معادل <b>${amount}</b> رو به یکی از کیف‌پول‌های زیر بفرست:\n\n${wallets}\n\n` +
            '📸 <i>بعد هش تراکنش یا اسکرین‌شاتش رو همین‌جا بفرست</i> — سریع تأییدش می‌کنیم ⚡️',
        sendReceipt:
            '📸 <b>پرداخت انجام شد؟</b>\n\nکافیه عکس رسیدت رو همین‌جا بفرستی تا تیم ما در سریع‌ترین زمان اشتراکت رو فعال کنه ⚡️',
        receiptSubmitted:
            '✅ <b>دریافت شد — ممنون!</b> 🙌\n\n⏳ رسیدت توی صف بررسیه. <i>خیالت راحت</i> — به‌محض تأیید بهت خبر می‌دیم! ✨',
        unavailable:
            '😔 <b>خرید فعلاً متوقفه.</b>\n\n🙏 کمی بعد دوباره امتحان کن — خیلی زود برمی‌گردیم!',
        supportPrompt:
            '💬 <b>ما سرتاپا گوشیم!</b>\n\n✍️ پیامت رو بنویس تا تیم ما همین‌جا جوابت رو بده.\n\n↩️ <i>هر وقت خواستی به منو برگردی، /start رو بزن.</i>',
        supportSent:
            '✅ <b>پیام ارسال شد!</b> 🚀\n\nتیم ما دریافتش کرد و خیلی زود همین‌جا جوابت رو می‌ده. <i>ممنون که پیام دادی!</i> 🙏',
        supportUnavailable: '😔 <b>پشتیبانی فعلاً در دسترس نیست.</b>\n\n🙏 کمی بعد دوباره امتحان کن!',
        approved: (u: string) =>
            '🎉🎉 <b>همه‌چی آماده‌ست!</b> 🎉🎉\n\n' +
            '🚀 اشتراکت فعال شد و آماده‌ی پروازه.\n\n' +
            `🔗 <b>لینک اتصال اختصاصی تو:</b>\n<code>${esc(u)}</code>\n\n` +
            '🔐 <i>پیشت نگهش دار — فقط مال خودته.</i>\n' +
            '📊 هر وقت خواستی با «📦 اشتراک‌های من» مصرفت رو ببین.\n\n' +
            'لذت ببر! ✨',
        rejectedGeneric:
            '❌ <b>متأسفانه این بار نتونستیم رسیدت رو تأیید کنیم.</b>\n\n🤝 نگران نباش! روی 💬 پشتیبانی بزن تا تیم ما سریع باهات حلش کنه.',
        rejectedReason: (r: string) =>
            `❌ <b>این بار نتونستیم رسیدت رو تأیید کنیم.</b>\n\n📝 <b>دلیل:</b> <i>${esc(r)}</i>\n\n🤝 کمک می‌خوای؟ روی 💬 پشتیبانی بزن!`,
        subsHeader: '📦 <b>اشتراک‌های فعال تو:</b>',
        subsEmpty:
            '📭 <b>هنوز اشتراکی نداری!</b>\n\n🚀 آماده‌ای وصل بشی؟ روی «🛒 خرید پلن» بزن تا توی چند دقیقه آنلاین بشی.',
        subLine: (name: string, used: string, limit: string, exp: string, url: string) =>
            `• <b>${esc(name)}</b>\n   📊 ${used} / ${limit}\n   📅 انقضا ${exp}\n   🔗 <code>${esc(url)}</code>`,
        subsPick:
            '📦 <b>اشتراک‌های تو</b>\n\n<i>برای دیدن جزئیات و لینک‌های اتصال، روی هرکدام بزن.</i>',
        subFallback: (n: number) => `اشتراک #${n}`,
        subDetail: (d: {
            name: string;
            used: string;
            limit: string;
            exp: string;
            subUrl: string;
            links: string[];
        }) =>
            `📦 <b>${esc(d.name)}</b>\n\n` +
            `📊 <b>مصرف:</b> ${d.used} / ${d.limit}\n` +
            `📅 <b>انقضا:</b> ${d.exp}\n\n` +
            `🔗 <b>لینک اشتراک:</b>\n<code>${esc(d.subUrl)}</code>` +
            (d.links.length
                ? `\n\n🔐 <b>کانفیگ‌های اتصال:</b>\n` +
                  d.links.map((l) => `<code>${esc(l)}</code>`).join('\n')
                : ''),
        chooseCategory:
            '🗂 <b>یک دسته انتخاب کن</b>\n\n<i>برای دیدن پلن‌های هر دسته، روی آن بزن.</i> 👇',
        catOther: '📦 سایر',
        support: (t: string) => `💬 ${t}`,
        useMenu: '👇 <b>برای شروع یکی از دکمه‌های زیر رو بزن!</b>',
        menuWallet: '💰 کیف پول من',
        walletScreen: (balance: string) =>
            `💰 <b>کیف پول تو</b>\n\nموجودی: <b>${balance}</b>\n\nباهاش هر پلنی رو فوری بخر.`,
        btnCharge: '➕ شارژ کیف پول',
        chargePrompt:
            '💳 <b>چقدر می‌خوای اضافه کنی؟</b>\n\nمبلغ رو به تومان بفرست (مثلاً <code>50000</code>).',
        invalidAmount: 'لطفاً یک مبلغ معتبر به تومان بفرست — فقط عدد، مثلاً 50000.',
        topupInstructions: (amount: string, destinations: string) =>
            `🧾 <b>افزودن ${amount} به کیف پول</b>\n\nدقیقاً مبلغ <b>${amount}</b> رو به یکی از مقصدهای زیر واریز کن و سپس عکس رسید رو همین‌جا بفرست 📸\n\n${destinations}`,
        topupNoMethods: '😔 هنوز پرداخت تنظیم نشده — لطفاً با 💬 پشتیبانی تماس بگیر.',
        topupSubmitted:
            '✅ <b>دریافت شد — ممنون!</b> 🙌\n\n⏳ شارژ تو در حال بررسیه. به‌محض تأیید، کیف پولت شارژ می‌شه.',
        walletCharged: (amount: string, balance: string) =>
            `✅ <b>کیف پول شارژ شد!</b> 🎉\n\n➕ ${amount} اضافه شد.\n💰 موجودی جدید: <b>${balance}</b>`,
        topupRejected: '❌ شارژ تو تأیید نشد. لطفاً با 💬 پشتیبانی تماس بگیر.',
        insufficient: (balance: string, price: string) =>
            `😕 <b>موجودی کافی نیست.</b>\n\n💰 کیف پول تو: <b>${balance}</b>\n🏷 قیمت پلن: <b>${price}</b>\n\nاول کیف پولت رو شارژ کن، بعد پلن رو بگیر.`,
        btnBuyWallet: '💳 پرداخت از کیف پول',
        reviewBalance: (balance: string) => `💰 کیف پول تو: <b>${balance}</b>`,
        lblTopup: 'شارژ',
        logTopup: (id: number, amount: string, who: string) =>
            `💰 شارژ #${id} تأیید شد — ${amount} به ${who} اضافه شد.`,
        unlimited: 'نامحدود',
        currency: 'تومان',
        tooManyPending:
            '⏳ <b>یه لحظه صبر کن!</b>\n\nرسید(هایی) از تو توی صف بررسیه — <i>لطفاً تا تموم شدنشون رسید جدید نفرست</i> 🙏',
        groupCaptured: (id: string) =>
            `✅ گروه شناسایی شد.\nشناسه: ${id}\n\nدر پنل خود به تلگرام ← یافتن شناسه گروه بروید و این گروه را انتخاب کنید.`,
        joinRequired:
            '🔓 <b>کم مونده — فقط یک قدم!</b>\n\n📣 برای باز شدن ربات، لطفاً توی کانال(های) زیر عضو شو 👇\n\n✅ <i>وقتی توی همه عضو شدی، روی «عضو شدم» بزن</i> 🎉',
        btnJoined: '✅ عضو شدم',
        notJoinedYet:
            '🤔 انگار هنوز توی همه عضو نشدی. لطفاً توی همه‌ی کانال‌های بالا عضو شو و دوباره روی «عضو شدم» بزن 🙏',
        planTraffic: '📊 ترافیک',
        planDuration: '⏳ مدت',
        planPrice: '💰 قیمت',
        planPitch:
            '⚡️ <b>پرسرعت، امن و کاملاً پایدار</b> — توی چند دقیقه فعال می‌شه.\n💳 <i>برای گرفتنش روی «ادامه و پرداخت» بزن!</i> 🚀',
        days: 'روز',
        lblOrder: 'سفارش',
        payCard: '💳 کارت به کارت',
        payCrypto: '🪙 ارز دیجیتال',
        payNone: '—',
        approvedBy: (who: string) => `✅ تأیید شد توسط ${who}`,
        rejectedBy: (who: string) => `❌ رد شد توسط ${who}`,
        rejectedByReason: (who: string, reason: string) => `❌ رد شد توسط ${who}\nدلیل: ${reason}`,
        logError: (m: string) => `⚠️ خطای ربات: ${m}`,
        logApprovalBlocked: (id: number) =>
            `⚠️ تأیید سفارش #${id} متوقف شد: موجودی تمام شده — ابتدا شارژ کنید.`,
        logRejected: (id: number) => `❌ سفارش #${id} رد شد.`,
        logRejectedReason: (id: number, reason: string) => `❌ سفارش #${id} رد شد: ${reason}`,
        logApproved: (id: number, username: string, who: string) =>
            `✅ سفارش #${id} تأیید شد ← ${username} برای ${who} ساخته شد.`,
        logSubFailed: (id: number, err: string) =>
            `⚠️ ساخت اشتراک برای سفارش #${id} ممکن نشد: ${err}`,
        logMembership: (ref: string, err: string) => `⚠️ بررسی عضویت برای ${ref} ممکن نشد: ${err}`,
    },
} satisfies Record<Lang, Record<string, unknown>>;

function money(p: Plan, lang: Lang): string {
    return `${p.price.toLocaleString('en-US')} ${M[lang].currency}`;
}

// Wrap a value in a Unicode isolate (FSI…PDI) so a mixed LTR-number + RTL-unit
// run (e.g. "30 روز") keeps its parts together when joined with other fields on
// one line — otherwise bidi reordering flings the unit to the end of the string.
function iso(s: string): string {
    return `⁨${s}⁩`;
}

export function planLabel(p: Plan, lang: Lang): string {
    const t = p.trafficGb > 0 ? `${p.trafficGb} GB` : M[lang].unlimited;
    const fields = [t, `${p.durationDays} ${M[lang].days}`, money(p, lang)].map(iso);
    return `${p.title} — ${fields.join(' · ')}`;
}

/** Multi-line plan details shown on the review screen before payment. */
export function planDetails(p: Plan, lang: Lang): string {
    const traffic = p.trafficGb > 0 ? `${p.trafficGb} GB` : M[lang].unlimited;
    return [
        `✨ <b>${esc(p.title)}</b>`,
        '',
        `<b>${M[lang].planTraffic}</b>: ${traffic}`,
        `<b>${M[lang].planDuration}</b>: ${p.durationDays} ${M[lang].days}`,
        `<b>${M[lang].planPrice}</b>: <b>${money(p, lang)}</b>`,
        '',
        M[lang].planPitch,
    ].join('\n');
}

export function adminName(u: { first_name?: string; username?: string }): string {
    return u.username ? '@' + u.username : u.first_name || 'admin';
}

export function menuKeyboard(lang: Lang, channelUrl?: string | null): InlineKeyboard {
    // Support and the channel link share the bottom row.
    const supportRow: InlineButton[] = [{ text: M[lang].menuSupport, callback_data: 'support' }];
    if (channelUrl) supportRow.push({ text: M[lang].menuChannel, url: channelUrl });
    return [
        [{ text: M[lang].menuBuy, callback_data: 'buy', style: 'primary' }],
        [
            { text: M[lang].menuSubs, callback_data: 'mysubs' },
            { text: M[lang].menuWallet, callback_data: 'wallet' },
        ],
        supportRow,
    ];
}

/** 50000 → "50,000 Toman" (same wording in both languages, like rembroker). */
export function formatToman(amount: number | bigint): string {
    const n = Number(amount);
    const sign = n < 0 ? '-' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US')} Toman`;
}

export function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
