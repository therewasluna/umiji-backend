import { BrokerBots } from '@prisma/client';

import {
    BROKER_BOT_LANGS,
    BROKER_BOT_TEXTS,
    checkBrokerBotText,
    TBrokerBotLang,
    TBrokerBotTextKey,
    tokenizeTelegramHtml,
} from '@libs/contracts/commands';

import { InlineButton, InlineKeyboard } from './telegram.client';

export type Lang = TBrokerBotLang;
type Texts = Record<TBrokerBotTextKey, string>;
export type CustomTexts = Partial<Record<Lang, Partial<Texts>>>;

/** The parts of a plan the bot shows. */
export interface Plan {
    title: string;
    trafficGb: number;
    durationDays: number;
    durationHours?: null | number;
    price: number;
    ipLimit?: null | number;
}

/** What a subscription gets: a plan's or the free trial's. */
export interface Trial {
    trafficGb: number;
    durationDays: number;
    durationHours?: null | number;
    squadUuids: string[];
    ipLimit?: null | number;
    dailyLimit?: null | number;
}

// English and Persian copy is ported from rembroker's bot, so customers of existing brokers see
// the same bot. Templates fill {variables}; message texts are Telegram HTML.

const en: Texts = {
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
    useMenu: '👇 <b>Tap one of the buttons below to get started!</b>',
    menuBuy: '🛒 Buy a plan',
    menuSubs: '📦 My subscriptions',
    menuWallet: '💰 My wallet',
    menuSupport: '💬 Support',
    menuChannel: '📣 Our channel',
    menuLanguage: '🌐 Language',
    chooseLanguage: '🌐 <b>Choose your language</b>',
    btnBack: '⬅️ Back',

    chooseCategory: '🗂 <b>Pick a category</b>\n\n<i>Choose a category to see its plans.</i> 👇',
    catOther: '📦 Other',
    choosePlan:
        '🛒 <b>Awesome — let’s get you connected!</b>\n\n' +
        '⚡️ Every plan runs on our fastest, most stable servers.\n' +
        '💫 <i>Pick the one that fits you and tap it to see the full details</i> 👇',
    noPlans:
        '😔 <b>No plans available right now.</b>\n\n🙏 We’re likely restocking — please check back very soon!',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 Traffic</b>: {traffic}\n' +
        '<b>⏳ Duration</b>: {duration}\n' +
        '<b>📱 Devices at once</b>: {devices}\n' +
        '<b>💰 Price</b>: <b>{price}</b>\n\n' +
        '⚡️ <b>High-speed, secure and rock-stable</b> — activates in minutes.\n' +
        '💳 <i>Tap “Pay from wallet” to grab it!</i> 🚀\n\n' +
        '💰 Your wallet: <b>{balance}</b>',
    btnBuyWallet: '💳 Pay from wallet',
    insufficient:
        '😕 <b>Not enough balance.</b>\n\n💰 Your wallet: <b>{balance}</b>\n🏷 Plan price: <b>{price}</b>\n\nCharge your wallet, then grab the plan.',
    approved:
        '🎉🎉 <b>You’re all set!</b> 🎉🎉\n\n' +
        '🚀 Your subscription is active and ready to fly.\n\n' +
        '🔗 <b>Your personal connection link:</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>Keep it private — it’s just for you.</i>\n' +
        '📊 Tap “📦 My subscriptions” anytime to track your usage.\n\n' +
        'Enjoy the ride! ✨',
    unavailable:
        '😔 <b>Purchases are paused right now.</b>\n\n🙏 Please try again a little later — we’ll be back before you know it!',

    walletScreen:
        '💰 <b>Your wallet</b>\n\nBalance: <b>{balance}</b>\n\nUse it to buy any plan instantly.',
    btnCharge: '➕ Charge wallet',
    chargePrompt:
        '💳 <b>How much would you like to add?</b>\n\nSend the amount in Toman (e.g. <code>50000</code>).',
    invalidAmount: 'Please send a valid amount in Toman — numbers only, e.g. 50000.',
    topupNoMethods: '😔 Payment isn’t set up yet — please contact 💬 Support.',
    tooManyPending:
        '⏳ <b>Hold on a moment!</b>\n\nYou’ve already got receipt(s) waiting in our review queue — <i>please wait until those are done before sending more</i> 🙏',
    topupInstructions:
        '🧾 <b>Adding {amount} to your wallet</b>\n\nTransfer exactly <b>{amount}</b> to one of the destinations below, then send a photo of your receipt here 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>Received — thank you!</b> 🙌\n\n⏳ Your top-up is under review. We’ll credit your wallet the moment it’s approved.',
    walletCharged:
        '✅ <b>Wallet charged!</b> 🎉\n\n➕ {amount} added.\n💰 New balance: <b>{balance}</b>',
    topupRejected: '❌ Your top-up couldn’t be approved. Please contact 💬 Support.',
    topupRejectedReason:
        '❌ <b>We couldn’t approve your receipt this time.</b>\n\n📝 <b>Reason:</b> <i>{reason}</i>\n\n🤝 Need a hand? Tap 💬 Support and we’ll help you out!',

    subsPick:
        '📦 <b>Your subscriptions</b>\n\n<i>Tap one to see its details and connection links.</i>',
    subsEmpty:
        '📭 <b>No subscriptions yet!</b>\n\n🚀 Ready to get connected? Tap “🛒 Buy a plan” and you’ll be online in minutes.',
    subFallback: 'Subscription #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>Usage:</b> {used} / {limit}\n' +
        '📅 <b>Expires:</b> {expires}\n\n' +
        '🔗 <b>Subscription link:</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>Connection configs:</b>',

    menuInvite: '🤝 Invite friends',
    inviteScreen:
        '🤝 <b>Invite friends, earn credit!</b>\n\n' +
        '🎁 Share your personal link. Every time a friend you invited charges their wallet, <b>{percent}%</b> of it lands in yours.\n\n' +
        '🔗 <b>Your link:</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 Friends invited: <b>{invited}</b>\n' +
        '💰 Earned so far: <b>{earned}</b>',
    referralReward:
        '🎁 <b>Referral reward!</b>\n\nA friend you invited charged their wallet.\n➕ {amount} added to yours.\n💰 New balance: <b>{balance}</b>',

    menuTrial: '🎁 Free trial',
    trialReview:
        '🎁 <b>Try us for free!</b>\n\n' +
        '<b>📊 Traffic</b>: {traffic}\n' +
        '<b>⏳ Duration</b>: {duration}\n' +
        '<b>📱 Devices at once</b>: {devices}\n\n' +
        '✨ One free trial per account — tap below to activate it now.',
    btnTrialClaim: '✅ Activate my free trial',
    trialUsed:
        '🙌 <b>You’ve already used your free trial.</b>\n\n🛒 Ready for more? Tap “Buy a plan” to pick a full plan.',
    trialSoldOut:
        '⏳ <b>Today’s free trials are all gone.</b>\n\n🙏 Please come back tomorrow, or tap “Buy a plan” to get started right away.',

    supportPrompt:
        '💬 <b>We’re all ears!</b>\n\n✍️ Type your message below and our team will reply right here.\n\n↩️ <i>Send /start anytime to return to the menu.</i>',
    supportSent:
        '✅ <b>Message sent!</b> 🚀\n\nOur team has it and will reply right here very soon. <i>Thanks for reaching out!</i> 🙏',
    supportUnavailable:
        '😔 <b>Support isn’t available right now.</b>\n\n🙏 Please try again a little later!',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>Almost there — one quick step!</b>\n\n📣 To unlock the bot, please join our channel(s) below 👇\n\n✅ <i>Once you’ve joined them all, tap “I’ve joined”</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ I’ve joined',
    notJoinedYet:
        '🤔 Looks like you haven’t joined all of them yet. Please join every channel above, then tap “I’ve joined” again 🙏',

    currency: 'Toman',
    unlimited: 'Unlimited',
    days: 'days',
    hours: 'hours',

    reviewTopicName: 'Review Receipts',
    reviewTopicIntro: '🧾 Customer payment receipts will appear here for approval.',
    logsTopicName: 'Stats',
    logsTopicIntro:
        '📊 A stats summary lands here every day after midnight UTC, along with bot activity: new customers, purchases, free trials, top-ups, referral rewards and errors. Send /stats for the latest numbers.',
    topupReview: '💰 Top-up #{id}\n👤 {customer} · id {tgId}\n💵 {amount}',
    btnApprove: '✅ Approve',
    btnReject: '❌ Reject',
    btnRejectNoReason: 'Reject (no reason)',
    btnRejectWithReason: 'Reject with reason',
    btnStaffBack: '⬅︎ Back',
    askRejectReason: 'Reply here with the rejection reason for receipt #{id}.',
    approvedBy: '✅ Approved by {admin}',
    rejectedBy: '❌ Rejected by {admin}',
    rejectedByReason: '❌ Rejected by {admin}\nReason: {reason}',
    alertApproved: 'Approved — wallet credited.',
    alertRejected: 'Rejected.',
    alertSendReason: 'Send the reason as a reply.',
    alertHandled: 'Already handled.',
    alertNothing: 'Nothing to approve.',
    alertAdminsOnly: 'Only group admins can do that.',
    alertInactive: 'This broker account is inactive.',
    ticketTopicName: '🎫 {name}',
    ticketIntro: 'New support ticket from {name} (id {tgId}). Reply here to answer.',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ Group captured.\nID: <code>{id}</code>\n\nOpen your panel → Telegram → Group ID Finder and select this group.',
    logTopup: '💰 Top-up #{id} approved — {amount} credited to {customer}.',
    logRejected: '❌ Order #{id} was rejected.',
    logRejectedReason: '❌ Order #{id} was rejected: {reason}',
    logError: '⚠️ Bot error: {error}',
    logMembership: '⚠️ Couldn’t verify membership for {channel}: {error}',
    logNewCustomer: '👋 New customer: {customer} · id {tgId}',
    logNewReferral: '👋 New customer: {customer} · id {tgId}\n🤝 Invited by {referrer}',
    logPurchase: '🛒 Order #{id}: {customer} bought {plan} for {amount}.',
    logTrial: '🎁 {customer} claimed the free trial.',
    logReward: '🎉 Referral reward: {amount} to {referrer} for top-up #{id}.',
    logManualTopup: '💳 {amount} added to {customer} from the panel.',

    statsTitle: '📊 <b>Bot stats</b>',
    dailySummaryTitle: '🌙 <b>Daily summary · {date}</b>',
    statsToday: '<b>📅 Today</b>',
    stats7d: '<b>🗓 Last 7 days</b>',
    stats30d: '<b>🗓 Last 30 days</b>',
    statsPeriod:
        '{period}\n' +
        '👥 New customers: {newCustomers} · 🟢 Active: {active}\n' +
        '🤝 Came through referrals: {referrals}\n' +
        '🛒 Plans sold: {sales} · {salesAmount}\n' +
        '💰 Top-ups approved: {topups} · {topupsAmount}\n' +
        '❌ Top-ups rejected: {rejected}\n' +
        '🎁 Free trials: {trials}\n' +
        '🎉 Referral rewards: {rewards}',
    statsTotals:
        '<b>📦 All time</b>\n' +
        '👥 Customers: {customers} · 🛍 Buyers: {buyers}\n' +
        '🛒 Plans sold: {sales} · {salesAmount}\n' +
        '💼 Credit in wallets: {wallets}\n' +
        '⏳ Receipts waiting: {pending}',
};

const fa: Texts = {
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
    useMenu: '👇 <b>برای شروع یکی از دکمه‌های زیر رو بزن!</b>',
    menuBuy: '🛒 خرید پلن',
    menuSubs: '📦 اشتراک‌های من',
    menuWallet: '💰 کیف پول من',
    menuSupport: '💬 پشتیبانی',
    menuChannel: '📣 کانال ما',
    menuLanguage: '🌐 زبان',
    chooseLanguage: '🌐 <b>زبانت رو انتخاب کن</b>',
    btnBack: '⬅️ بازگشت',

    chooseCategory: '🗂 <b>یک دسته انتخاب کن</b>\n\n<i>برای دیدن پلن‌های هر دسته، روی آن بزن.</i> 👇',
    catOther: '📦 سایر',
    choosePlan:
        '🛒 <b>عالیه — بریم که وصلت کنیم!</b>\n\n' +
        '⚡️ همه‌ی پلن‌ها روی سریع‌ترین و پایدارترین سرورهای ما اجرا می‌شن.\n' +
        '💫 <i>اونی که بهت می‌خوره رو انتخاب کن و روش بزن تا جزئیات کاملش رو ببینی</i> 👇',
    noPlans:
        '😔 <b>الان پلنی موجود نیست.</b>\n\n🙏 احتمالاً داریم شارژ می‌کنیم — کمی بعد دوباره سر بزن!',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 ترافیک</b>: {traffic}\n' +
        '<b>⏳ مدت</b>: {duration}\n' +
        '<b>📱 دستگاه هم‌زمان</b>: {devices}\n' +
        '<b>💰 قیمت</b>: <b>{price}</b>\n\n' +
        '⚡️ <b>پرسرعت، امن و کاملاً پایدار</b> — توی چند دقیقه فعال می‌شه.\n' +
        '💳 <i>برای گرفتنش روی «پرداخت از کیف پول» بزن!</i> 🚀\n\n' +
        '💰 کیف پول تو: <b>{balance}</b>',
    btnBuyWallet: '💳 پرداخت از کیف پول',
    insufficient:
        '😕 <b>موجودی کافی نیست.</b>\n\n💰 کیف پول تو: <b>{balance}</b>\n🏷 قیمت پلن: <b>{price}</b>\n\nاول کیف پولت رو شارژ کن، بعد پلن رو بگیر.',
    approved:
        '🎉🎉 <b>همه‌چی آماده‌ست!</b> 🎉🎉\n\n' +
        '🚀 اشتراکت فعال شد و آماده‌ی پروازه.\n\n' +
        '🔗 <b>لینک اتصال اختصاصی تو:</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>پیشت نگهش دار — فقط مال خودته.</i>\n' +
        '📊 هر وقت خواستی با «📦 اشتراک‌های من» مصرفت رو ببین.\n\n' +
        'لذت ببر! ✨',
    unavailable: '😔 <b>خرید فعلاً متوقفه.</b>\n\n🙏 کمی بعد دوباره امتحان کن — خیلی زود برمی‌گردیم!',

    walletScreen: '💰 <b>کیف پول تو</b>\n\nموجودی: <b>{balance}</b>\n\nباهاش هر پلنی رو فوری بخر.',
    btnCharge: '➕ شارژ کیف پول',
    chargePrompt:
        '💳 <b>چقدر می‌خوای اضافه کنی؟</b>\n\nمبلغ رو به تومان بفرست (مثلاً <code>50000</code>).',
    invalidAmount: 'لطفاً یک مبلغ معتبر به تومان بفرست — فقط عدد، مثلاً 50000.',
    topupNoMethods: '😔 هنوز پرداخت تنظیم نشده — لطفاً با 💬 پشتیبانی تماس بگیر.',
    tooManyPending:
        '⏳ <b>یه لحظه صبر کن!</b>\n\nرسید(هایی) از تو توی صف بررسیه — <i>لطفاً تا تموم شدنشون رسید جدید نفرست</i> 🙏',
    topupInstructions:
        '🧾 <b>افزودن {amount} به کیف پول</b>\n\nدقیقاً مبلغ <b>{amount}</b> رو به یکی از مقصدهای زیر واریز کن و سپس عکس رسید رو همین‌جا بفرست 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>دریافت شد — ممنون!</b> 🙌\n\n⏳ شارژ تو در حال بررسیه. به‌محض تأیید، کیف پولت شارژ می‌شه.',
    walletCharged:
        '✅ <b>کیف پول شارژ شد!</b> 🎉\n\n➕ {amount} اضافه شد.\n💰 موجودی جدید: <b>{balance}</b>',
    topupRejected: '❌ شارژ تو تأیید نشد. لطفاً با 💬 پشتیبانی تماس بگیر.',
    topupRejectedReason:
        '❌ <b>این بار نتونستیم رسیدت رو تأیید کنیم.</b>\n\n📝 <b>دلیل:</b> <i>{reason}</i>\n\n🤝 کمک می‌خوای؟ روی 💬 پشتیبانی بزن!',

    subsPick: '📦 <b>اشتراک‌های تو</b>\n\n<i>برای دیدن جزئیات و لینک‌های اتصال، روی هرکدام بزن.</i>',
    subsEmpty:
        '📭 <b>هنوز اشتراکی نداری!</b>\n\n🚀 آماده‌ای وصل بشی؟ روی «🛒 خرید پلن» بزن تا توی چند دقیقه آنلاین بشی.',
    subFallback: 'اشتراک #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>مصرف:</b> {used} / {limit}\n' +
        '📅 <b>انقضا:</b> {expires}\n\n' +
        '🔗 <b>لینک اشتراک:</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>کانفیگ‌های اتصال:</b>',

    menuInvite: '🤝 دعوت از دوستان',
    inviteScreen:
        '🤝 <b>دوستاتو دعوت کن، اعتبار بگیر!</b>\n\n' +
        '🎁 لینک اختصاصیت رو برای دوستات بفرست. هر بار دوستی که دعوت کردی کیف پولش رو شارژ کنه، <b>{percent}٪</b> از اون مبلغ به کیف پول تو اضافه می‌شه.\n\n' +
        '🔗 <b>لینک تو:</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 دوستان دعوت‌شده: <b>{invited}</b>\n' +
        '💰 درآمد تا الان: <b>{earned}</b>',
    referralReward:
        '🎁 <b>پاداش دعوت!</b>\n\nیکی از دوستانی که دعوت کردی کیف پولش رو شارژ کرد.\n➕ {amount} به کیف پولت اضافه شد.\n💰 موجودی جدید: <b>{balance}</b>',

    menuTrial: '🎁 تست رایگان',
    trialReview:
        '🎁 <b>رایگان امتحانش کن!</b>\n\n' +
        '<b>📊 ترافیک</b>: {traffic}\n' +
        '<b>⏳ مدت</b>: {duration}\n' +
        '<b>📱 دستگاه هم‌زمان</b>: {devices}\n\n' +
        '✨ هر حساب فقط یک بار تست رایگان داره — برای فعال‌سازی، دکمه‌ی زیر رو بزن.',
    btnTrialClaim: '✅ فعال‌سازی تست رایگان',
    trialUsed:
        '🙌 <b>قبلاً از تست رایگانت استفاده کردی.</b>\n\n🛒 بیشتر می‌خوای؟ «خرید پلن» رو بزن و یه پلن کامل انتخاب کن.',
    trialSoldOut:
        '⏳ <b>تست‌های رایگان امروز تموم شد.</b>\n\n🙏 فردا دوباره سر بزن، یا همین حالا «خرید پلن» رو بزن.',

    supportPrompt:
        '💬 <b>ما سرتاپا گوشیم!</b>\n\n✍️ پیامت رو بنویس تا تیم ما همین‌جا جوابت رو بده.\n\n↩️ <i>هر وقت خواستی به منو برگردی، /start رو بزن.</i>',
    supportSent:
        '✅ <b>پیام ارسال شد!</b> 🚀\n\nتیم ما دریافتش کرد و خیلی زود همین‌جا جوابت رو می‌ده. <i>ممنون که پیام دادی!</i> 🙏',
    supportUnavailable: '😔 <b>پشتیبانی فعلاً در دسترس نیست.</b>\n\n🙏 کمی بعد دوباره امتحان کن!',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>کم مونده — فقط یک قدم!</b>\n\n📣 برای باز شدن ربات، لطفاً توی کانال(های) زیر عضو شو 👇\n\n✅ <i>وقتی توی همه عضو شدی، روی «عضو شدم» بزن</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ عضو شدم',
    notJoinedYet:
        '🤔 انگار هنوز توی همه عضو نشدی. لطفاً توی همه‌ی کانال‌های بالا عضو شو و دوباره روی «عضو شدم» بزن 🙏',

    currency: 'تومان',
    unlimited: 'نامحدود',
    days: 'روز',
    hours: 'ساعت',

    reviewTopicName: 'بررسی رسیدها',
    reviewTopicIntro: '🧾 رسیدهای پرداخت مشتریان برای تأیید اینجا نمایش داده می‌شوند.',
    logsTopicName: 'آمار',
    logsTopicIntro:
        '📊 هر روز بعد از نیمه‌شب UTC خلاصه‌ی آمار اینجا ارسال می‌شود، همراه با فعالیت ربات: مشتریان جدید، خریدها، تست‌های رایگان، شارژها، پاداش‌های دعوت و خطاها. برای آخرین اعداد /stats را بفرستید.',
    topupReview: '💰 شارژ #{id}\n👤 {customer} · شناسه {tgId}\n💵 {amount}',
    btnApprove: '✅ تأیید',
    btnReject: '❌ رد',
    btnRejectNoReason: 'رد (بدون دلیل)',
    btnRejectWithReason: 'رد با ذکر دلیل',
    btnStaffBack: '⬅︎ بازگشت',
    askRejectReason: 'دلیل رد رسید #{id} را در پاسخ همین‌جا بنویسید.',
    approvedBy: '✅ تأیید شد توسط {admin}',
    rejectedBy: '❌ رد شد توسط {admin}',
    rejectedByReason: '❌ رد شد توسط {admin}\nدلیل: {reason}',
    alertApproved: 'تأیید شد — کیف پول شارژ شد.',
    alertRejected: 'رد شد.',
    alertSendReason: 'دلیل را در پاسخ بفرستید.',
    alertHandled: 'قبلاً رسیدگی شده است.',
    alertNothing: 'چیزی برای تأیید نیست.',
    alertAdminsOnly: 'فقط ادمین‌های گروه می‌توانند این کار را انجام دهند.',
    alertInactive: 'حساب این فروشنده غیرفعال است.',
    ticketTopicName: '🎫 {name}',
    ticketIntro: 'تیکت پشتیبانی جدید از {name} (شناسه {tgId}). برای پاسخ، همین‌جا بنویسید.',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ گروه شناسایی شد.\nشناسه: <code>{id}</code>\n\nدر پنل خود به تلگرام ← یافتن شناسه گروه بروید و این گروه را انتخاب کنید.',
    logTopup: '💰 شارژ #{id} تأیید شد — {amount} به {customer} اضافه شد.',
    logRejected: '❌ سفارش #{id} رد شد.',
    logRejectedReason: '❌ سفارش #{id} رد شد: {reason}',
    logError: '⚠️ خطای ربات: {error}',
    logMembership: '⚠️ بررسی عضویت برای {channel} ممکن نشد: {error}',
    logNewCustomer: '👋 مشتری جدید: {customer} · آیدی {tgId}',
    logNewReferral: '👋 مشتری جدید: {customer} · آیدی {tgId}\n🤝 دعوت‌شده توسط {referrer}',
    logPurchase: '🛒 سفارش #{id}: {customer} پلن {plan} را به مبلغ {amount} خرید.',
    logTrial: '🎁 {customer} تست رایگان را گرفت.',
    logReward: '🎉 پاداش دعوت: {amount} برای {referrer} بابت شارژ #{id}.',
    logManualTopup: '💳 {amount} از پنل به {customer} اضافه شد.',

    statsTitle: '📊 <b>آمار ربات</b>',
    dailySummaryTitle: '🌙 <b>گزارش روزانه · {date}</b>',
    statsToday: '<b>📅 امروز</b>',
    stats7d: '<b>🗓 7 روز گذشته</b>',
    stats30d: '<b>🗓 30 روز گذشته</b>',
    statsPeriod:
        '{period}\n' +
        '👥 مشتری جدید: {newCustomers} · 🟢 فعال: {active}\n' +
        '🤝 از طریق دعوت: {referrals}\n' +
        '🛒 پلن فروخته‌شده: {sales} · {salesAmount}\n' +
        '💰 شارژ تأییدشده: {topups} · {topupsAmount}\n' +
        '❌ شارژ ردشده: {rejected}\n' +
        '🎁 تست رایگان: {trials}\n' +
        '🎉 پاداش دعوت: {rewards}',
    statsTotals:
        '<b>📦 از ابتدا</b>\n' +
        '👥 مشتریان: {customers} · 🛍 خریداران: {buyers}\n' +
        '🛒 پلن فروخته‌شده: {sales} · {salesAmount}\n' +
        '💼 اعتبار در کیف پول‌ها: {wallets}\n' +
        '⏳ رسیدهای در انتظار: {pending}',
};

const ar: Texts = {
    greeting:
        '👋 <b>أهلاً وسهلاً بك!</b>\n\n' +
        '🚀 ودّع القيود — افتح الإنترنت كله بسرعة فائقة وأمان تام.\n\n' +
        '✨ <b>لماذا ستحبه:</b>\n' +
        '⚡️ خوادم فائقة السرعة — بث وألعاب وتنزيل بلا أي تقييد\n' +
        '🌍 مواقع عالمية مميزة لكل ما تحب\n' +
        '🔒 خصوصية وتشفير — بياناتك تبقى لك دائماً\n' +
        '📱 يعمل على جميع أجهزتك في الوقت نفسه\n' +
        '♾️ ثبات دائم بلا انقطاع\n' +
        '🎧 دعم بشري حقيقي متى احتجته\n' +
        '💸 أسعار عادلة مع ضمان استرداد المال\n\n' +
        '👇 <b>اضغط على أحد الأزرار بالأسفل للبدء!</b>',
    useMenu: '👇 <b>اضغط على أحد الأزرار بالأسفل للبدء!</b>',
    menuBuy: '🛒 شراء باقة',
    menuSubs: '📦 اشتراكاتي',
    menuWallet: '💰 محفظتي',
    menuSupport: '💬 الدعم',
    menuChannel: '📣 قناتنا',
    menuLanguage: '🌐 اللغة',
    chooseLanguage: '🌐 <b>اختر لغتك</b>',
    btnBack: '⬅️ رجوع',

    chooseCategory: '🗂 <b>اختر فئة</b>\n\n<i>اختر فئة لعرض باقاتها.</i> 👇',
    catOther: '📦 أخرى',
    choosePlan:
        '🛒 <b>رائع — لنوصلك الآن!</b>\n\n' +
        '⚡️ كل الباقات تعمل على أسرع خوادمنا وأكثرها ثباتاً.\n' +
        '💫 <i>اختر الباقة المناسبة لك واضغط عليها لترى كل التفاصيل</i> 👇',
    noPlans: '😔 <b>لا توجد باقات متاحة حالياً.</b>\n\n🙏 غالباً نعيد التزويد — عد إلينا قريباً جداً!',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 البيانات</b>: {traffic}\n' +
        '<b>⏳ المدة</b>: {duration}\n' +
        '<b>📱 الأجهزة في وقت واحد</b>: {devices}\n' +
        '<b>💰 السعر</b>: <b>{price}</b>\n\n' +
        '⚡️ <b>سريعة وآمنة وثابتة تماماً</b> — تتفعّل خلال دقائق.\n' +
        '💳 <i>اضغط «الدفع من المحفظة» لتحصل عليها!</i> 🚀\n\n' +
        '💰 محفظتك: <b>{balance}</b>',
    btnBuyWallet: '💳 الدفع من المحفظة',
    insufficient:
        '😕 <b>الرصيد غير كافٍ.</b>\n\n💰 محفظتك: <b>{balance}</b>\n🏷 سعر الباقة: <b>{price}</b>\n\nاشحن محفظتك أولاً ثم احصل على الباقة.',
    approved:
        '🎉🎉 <b>كل شيء جاهز!</b> 🎉🎉\n\n' +
        '🚀 اشتراكك مفعّل وجاهز للانطلاق.\n\n' +
        '🔗 <b>رابط الاتصال الخاص بك:</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>احتفظ به لنفسك — إنه لك وحدك.</i>\n' +
        '📊 اضغط «📦 اشتراكاتي» في أي وقت لمتابعة استهلاكك.\n\n' +
        'استمتع! ✨',
    unavailable: '😔 <b>الشراء متوقف حالياً.</b>\n\n🙏 حاول مرة أخرى بعد قليل — سنعود قريباً جداً!',

    walletScreen: '💰 <b>محفظتك</b>\n\nالرصيد: <b>{balance}</b>\n\nاستخدمه لشراء أي باقة فوراً.',
    btnCharge: '➕ شحن المحفظة',
    chargePrompt: '💳 <b>كم تريد أن تضيف؟</b>\n\nأرسل المبلغ بالتومان (مثلاً <code>50000</code>).',
    invalidAmount: 'يرجى إرسال مبلغ صحيح بالتومان — أرقام فقط، مثلاً 50000.',
    topupNoMethods: '😔 الدفع غير مُعدّ بعد — يرجى التواصل مع 💬 الدعم.',
    tooManyPending:
        '⏳ <b>لحظة من فضلك!</b>\n\nلديك إيصالات بانتظار المراجعة — <i>يرجى الانتظار حتى تنتهي قبل إرسال المزيد</i> 🙏',
    topupInstructions:
        '🧾 <b>إضافة {amount} إلى محفظتك</b>\n\nحوّل <b>{amount}</b> بالضبط إلى إحدى الوجهات أدناه، ثم أرسل صورة الإيصال هنا 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>تم الاستلام — شكراً لك!</b> 🙌\n\n⏳ عملية الشحن قيد المراجعة. سنضيف الرصيد إلى محفظتك فور الموافقة.',
    walletCharged:
        '✅ <b>تم شحن المحفظة!</b> 🎉\n\n➕ أُضيف {amount}.\n💰 الرصيد الجديد: <b>{balance}</b>',
    topupRejected: '❌ لم تتم الموافقة على الشحن. يرجى التواصل مع 💬 الدعم.',
    topupRejectedReason:
        '❌ <b>لم نتمكن من قبول إيصالك هذه المرة.</b>\n\n📝 <b>السبب:</b> <i>{reason}</i>\n\n🤝 تحتاج مساعدة؟ اضغط 💬 الدعم وسنساعدك!',

    subsPick: '📦 <b>اشتراكاتك</b>\n\n<i>اضغط على أحدها لعرض تفاصيله وروابط الاتصال.</i>',
    subsEmpty:
        '📭 <b>لا توجد اشتراكات بعد!</b>\n\n🚀 جاهز للاتصال؟ اضغط «🛒 شراء باقة» وستكون متصلاً خلال دقائق.',
    subFallback: 'اشتراك #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>الاستهلاك:</b> {used} / {limit}\n' +
        '📅 <b>ينتهي في:</b> {expires}\n\n' +
        '🔗 <b>رابط الاشتراك:</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>إعدادات الاتصال:</b>',

    menuInvite: '🤝 ادعُ أصدقاءك',
    inviteScreen:
        '🤝 <b>ادعُ أصدقاءك واربح رصيداً!</b>\n\n' +
        '🎁 شارك رابطك الخاص. في كل مرة يشحن فيها صديق دعوته محفظته، يُضاف <b>{percent}%</b> من المبلغ إلى محفظتك.\n\n' +
        '🔗 <b>رابطك:</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 الأصدقاء المدعوون: <b>{invited}</b>\n' +
        '💰 أرباحك حتى الآن: <b>{earned}</b>',
    referralReward:
        '🎁 <b>مكافأة دعوة!</b>\n\nقام صديق دعوته بشحن محفظته.\n➕ أُضيف {amount} إلى محفظتك.\n💰 الرصيد الجديد: <b>{balance}</b>',

    menuTrial: '🎁 تجربة مجانية',
    trialReview:
        '🎁 <b>جرّبنا مجاناً!</b>\n\n' +
        '<b>📊 البيانات</b>: {traffic}\n' +
        '<b>⏳ المدة</b>: {duration}\n' +
        '<b>📱 الأجهزة في وقت واحد</b>: {devices}\n\n' +
        '✨ تجربة مجانية واحدة لكل حساب — اضغط أدناه لتفعيلها الآن.',
    btnTrialClaim: '✅ فعّل تجربتي المجانية',
    trialUsed:
        '🙌 <b>لقد استخدمت تجربتك المجانية من قبل.</b>\n\n🛒 تريد المزيد؟ اضغط «شراء باقة» واختر باقة كاملة.',
    trialSoldOut:
        '⏳ <b>نفدت التجارب المجانية لهذا اليوم.</b>\n\n🙏 عُد غداً، أو اضغط «شراء باقة» لتبدأ الآن.',

    supportPrompt:
        '💬 <b>نحن نسمعك!</b>\n\n✍️ اكتب رسالتك بالأسفل وسيرد فريقنا هنا.\n\n↩️ <i>أرسل /start في أي وقت للعودة إلى القائمة.</i>',
    supportSent:
        '✅ <b>تم إرسال الرسالة!</b> 🚀\n\nوصلت إلى فريقنا وسيرد هنا قريباً جداً. <i>شكراً لتواصلك!</i> 🙏',
    supportUnavailable: '😔 <b>الدعم غير متاح حالياً.</b>\n\n🙏 حاول مرة أخرى بعد قليل!',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>اقتربت — خطوة واحدة فقط!</b>\n\n📣 لفتح البوت، يرجى الانضمام إلى القناة (القنوات) أدناه 👇\n\n✅ <i>بعد الانضمام إليها كلها، اضغط «انضممت»</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ انضممت',
    notJoinedYet:
        '🤔 يبدو أنك لم تنضم إليها كلها بعد. انضم إلى كل القنوات أعلاه ثم اضغط «انضممت» مرة أخرى 🙏',

    currency: 'تومان',
    unlimited: 'غير محدود',
    days: 'يوم',
    hours: 'ساعة',

    reviewTopicName: 'مراجعة الإيصالات',
    reviewTopicIntro: '🧾 ستظهر هنا إيصالات دفع العملاء للموافقة عليها.',
    logsTopicName: 'الإحصائيات',
    logsTopicIntro:
        '📊 يصل هنا ملخص الإحصائيات كل يوم بعد منتصف الليل بتوقيت UTC، مع نشاط البوت: العملاء الجدد والمشتريات والتجارب المجانية والشحنات ومكافآت الدعوة والأخطاء. أرسل /stats لأحدث الأرقام.',
    topupReview: '💰 شحن #{id}\n👤 {customer} · المعرّف {tgId}\n💵 {amount}',
    btnApprove: '✅ موافقة',
    btnReject: '❌ رفض',
    btnRejectNoReason: 'رفض (بدون سبب)',
    btnRejectWithReason: 'رفض مع ذكر السبب',
    btnStaffBack: '⬅︎ رجوع',
    askRejectReason: 'اكتب هنا في الرد سبب رفض الإيصال #{id}.',
    approvedBy: '✅ وافق عليه {admin}',
    rejectedBy: '❌ رفضه {admin}',
    rejectedByReason: '❌ رفضه {admin}\nالسبب: {reason}',
    alertApproved: 'تمت الموافقة — شُحنت المحفظة.',
    alertRejected: 'تم الرفض.',
    alertSendReason: 'أرسل السبب كرد.',
    alertHandled: 'تمت معالجته مسبقاً.',
    alertNothing: 'لا يوجد ما تتم الموافقة عليه.',
    alertAdminsOnly: 'هذا الإجراء لمشرفي المجموعة فقط.',
    alertInactive: 'حساب هذا الوسيط غير نشط.',
    ticketTopicName: '🎫 {name}',
    ticketIntro: 'تذكرة دعم جديدة من {name} (المعرّف {tgId}). اكتب هنا للرد.',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ تم التقاط المجموعة.\nالمعرّف: <code>{id}</code>\n\nافتح لوحتك ← تيليجرام ← البحث عن معرّف المجموعة واختر هذه المجموعة.',
    logTopup: '💰 تمت الموافقة على الشحن #{id} — أُضيف {amount} إلى {customer}.',
    logRejected: '❌ رُفض الطلب #{id}.',
    logRejectedReason: '❌ رُفض الطلب #{id}: {reason}',
    logError: '⚠️ خطأ في البوت: {error}',
    logMembership: '⚠️ تعذّر التحقق من العضوية في {channel}: {error}',
    logNewCustomer: '👋 عميل جديد: {customer} · المعرّف {tgId}',
    logNewReferral: '👋 عميل جديد: {customer} · المعرّف {tgId}\n🤝 بدعوة من {referrer}',
    logPurchase: '🛒 الطلب #{id}: اشترى {customer} الباقة {plan} مقابل {amount}.',
    logTrial: '🎁 حصل {customer} على التجربة المجانية.',
    logReward: '🎉 مكافأة دعوة: {amount} إلى {referrer} عن الشحن #{id}.',
    logManualTopup: '💳 أُضيف {amount} إلى {customer} من اللوحة.',

    statsTitle: '📊 <b>إحصائيات البوت</b>',
    dailySummaryTitle: '🌙 <b>الملخص اليومي · {date}</b>',
    statsToday: '<b>📅 اليوم</b>',
    stats7d: '<b>🗓 آخر 7 أيام</b>',
    stats30d: '<b>🗓 آخر 30 يوماً</b>',
    statsPeriod:
        '{period}\n' +
        '👥 عملاء جدد: {newCustomers} · 🟢 نشطون: {active}\n' +
        '🤝 عبر الدعوات: {referrals}\n' +
        '🛒 باقات مباعة: {sales} · {salesAmount}\n' +
        '💰 شحنات مقبولة: {topups} · {topupsAmount}\n' +
        '❌ شحنات مرفوضة: {rejected}\n' +
        '🎁 تجارب مجانية: {trials}\n' +
        '🎉 مكافآت الدعوة: {rewards}',
    statsTotals:
        '<b>📦 منذ البداية</b>\n' +
        '👥 العملاء: {customers} · 🛍 المشترون: {buyers}\n' +
        '🛒 باقات مباعة: {sales} · {salesAmount}\n' +
        '💼 الرصيد في المحافظ: {wallets}\n' +
        '⏳ إيصالات بانتظار المراجعة: {pending}',
};

const ru: Texts = {
    greeting:
        '👋 <b>Добро пожаловать!</b>\n\n' +
        '🚀 Забудьте об ограничениях — весь интернет на огромной скорости и под надёжной защитой.\n\n' +
        '✨ <b>Почему вам понравится:</b>\n' +
        '⚡️ Сверхбыстрые серверы — стримы, игры и загрузки без замедлений\n' +
        '🌍 Премиальные локации по всему миру\n' +
        '🔒 Приватно и зашифровано — ваши данные остаются только вашими\n' +
        '📱 Работает на всех ваших устройствах одновременно\n' +
        '♾️ Стабильная работа без перебоев\n' +
        '🎧 Живая поддержка, когда она нужна\n' +
        '💸 Честные цены и гарантия возврата денег\n\n' +
        '👇 <b>Нажмите кнопку ниже, чтобы начать!</b>',
    useMenu: '👇 <b>Нажмите одну из кнопок ниже, чтобы начать!</b>',
    menuBuy: '🛒 Купить тариф',
    menuSubs: '📦 Мои подписки',
    menuWallet: '💰 Мой кошелёк',
    menuSupport: '💬 Поддержка',
    menuChannel: '📣 Наш канал',
    menuLanguage: '🌐 Язык',
    chooseLanguage: '🌐 <b>Выберите язык</b>',
    btnBack: '⬅️ Назад',

    chooseCategory:
        '🗂 <b>Выберите категорию</b>\n\n<i>Нажмите на категорию, чтобы увидеть её тарифы.</i> 👇',
    catOther: '📦 Другое',
    choosePlan:
        '🛒 <b>Отлично — давайте подключим вас!</b>\n\n' +
        '⚡️ Все тарифы работают на наших самых быстрых и стабильных серверах.\n' +
        '💫 <i>Выберите подходящий и нажмите на него, чтобы увидеть подробности</i> 👇',
    noPlans:
        '😔 <b>Сейчас нет доступных тарифов.</b>\n\n🙏 Скорее всего, мы их пополняем — загляните чуть позже!',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 Трафик</b>: {traffic}\n' +
        '<b>⏳ Срок</b>: {duration}\n' +
        '<b>📱 Устройств одновременно</b>: {devices}\n' +
        '<b>💰 Цена</b>: <b>{price}</b>\n\n' +
        '⚡️ <b>Быстро, безопасно и стабильно</b> — активируется за пару минут.\n' +
        '💳 <i>Нажмите «Оплатить из кошелька», чтобы оформить!</i> 🚀\n\n' +
        '💰 Ваш кошелёк: <b>{balance}</b>',
    btnBuyWallet: '💳 Оплатить из кошелька',
    insufficient:
        '😕 <b>Недостаточно средств.</b>\n\n💰 Ваш кошелёк: <b>{balance}</b>\n🏷 Цена тарифа: <b>{price}</b>\n\nПополните кошелёк, а затем оформите тариф.',
    approved:
        '🎉🎉 <b>Всё готово!</b> 🎉🎉\n\n' +
        '🚀 Ваша подписка активна и готова к работе.\n\n' +
        '🔗 <b>Ваша личная ссылка для подключения:</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>Никому её не передавайте — она только ваша.</i>\n' +
        '📊 Нажмите «📦 Мои подписки», чтобы следить за расходом.\n\n' +
        'Приятного пользования! ✨',
    unavailable:
        '😔 <b>Продажи сейчас приостановлены.</b>\n\n🙏 Попробуйте чуть позже — мы скоро вернёмся!',

    walletScreen:
        '💰 <b>Ваш кошелёк</b>\n\nБаланс: <b>{balance}</b>\n\nОплачивайте им любой тариф мгновенно.',
    btnCharge: '➕ Пополнить кошелёк',
    chargePrompt:
        '💳 <b>На какую сумму пополнить?</b>\n\nОтправьте сумму в туманах (например, <code>50000</code>).',
    invalidAmount: 'Отправьте корректную сумму в туманах — только цифры, например 50000.',
    topupNoMethods: '😔 Оплата ещё не настроена — напишите в 💬 Поддержку.',
    tooManyPending:
        '⏳ <b>Минутку!</b>\n\nВаши чеки уже ждут проверки — <i>дождитесь их, прежде чем отправлять новые</i> 🙏',
    topupInstructions:
        '🧾 <b>Пополнение кошелька на {amount}</b>\n\nПереведите ровно <b>{amount}</b> на один из реквизитов ниже, затем отправьте сюда фото чека 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>Получено — спасибо!</b> 🙌\n\n⏳ Пополнение на проверке. Мы зачислим средства сразу после подтверждения.',
    walletCharged:
        '✅ <b>Кошелёк пополнен!</b> 🎉\n\n➕ Зачислено {amount}.\n💰 Новый баланс: <b>{balance}</b>',
    topupRejected: '❌ Пополнение не подтверждено. Напишите в 💬 Поддержку.',
    topupRejectedReason:
        '❌ <b>В этот раз мы не смогли принять ваш чек.</b>\n\n📝 <b>Причина:</b> <i>{reason}</i>\n\n🤝 Нужна помощь? Нажмите 💬 Поддержка — мы поможем!',

    subsPick:
        '📦 <b>Ваши подписки</b>\n\n<i>Нажмите на подписку, чтобы увидеть подробности и ссылки.</i>',
    subsEmpty:
        '📭 <b>Подписок пока нет!</b>\n\n🚀 Готовы подключиться? Нажмите «🛒 Купить тариф» — и через пару минут вы онлайн.',
    subFallback: 'Подписка #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>Расход:</b> {used} / {limit}\n' +
        '📅 <b>Действует до:</b> {expires}\n\n' +
        '🔗 <b>Ссылка на подписку:</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>Конфиги для подключения:</b>',

    menuInvite: '🤝 Пригласить друзей',
    inviteScreen:
        '🤝 <b>Приглашайте друзей и получайте бонусы!</b>\n\n' +
        '🎁 Поделитесь своей ссылкой. Каждый раз, когда приглашённый вами друг пополняет кошелёк, <b>{percent}%</b> от суммы зачисляется вам.\n\n' +
        '🔗 <b>Ваша ссылка:</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 Приглашено друзей: <b>{invited}</b>\n' +
        '💰 Заработано: <b>{earned}</b>',
    referralReward:
        '🎁 <b>Бонус за приглашение!</b>\n\nПриглашённый вами друг пополнил кошелёк.\n➕ Вам зачислено {amount}.\n💰 Новый баланс: <b>{balance}</b>',

    menuTrial: '🎁 Бесплатный тест',
    trialReview:
        '🎁 <b>Попробуйте бесплатно!</b>\n\n' +
        '<b>📊 Трафик</b>: {traffic}\n' +
        '<b>⏳ Срок</b>: {duration}\n' +
        '<b>📱 Устройств одновременно</b>: {devices}\n\n' +
        '✨ Один бесплатный тест на аккаунт — нажмите ниже, чтобы активировать его.',
    btnTrialClaim: '✅ Активировать тест',
    trialUsed:
        '🙌 <b>Вы уже использовали бесплатный тест.</b>\n\n🛒 Хотите больше? Нажмите «Купить тариф» и выберите полный тариф.',
    trialSoldOut:
        '⏳ <b>Бесплатные тесты на сегодня закончились.</b>\n\n🙏 Загляните завтра или нажмите «Купить тариф», чтобы начать прямо сейчас.',

    supportPrompt:
        '💬 <b>Мы вас слушаем!</b>\n\n✍️ Напишите сообщение ниже, и наша команда ответит прямо здесь.\n\n↩️ <i>Отправьте /start, чтобы вернуться в меню.</i>',
    supportSent:
        '✅ <b>Сообщение отправлено!</b> 🚀\n\nКоманда уже получила его и скоро ответит здесь. <i>Спасибо, что написали!</i> 🙏',
    supportUnavailable: '😔 <b>Поддержка сейчас недоступна.</b>\n\n🙏 Попробуйте чуть позже!',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>Почти готово — остался один шаг!</b>\n\n📣 Чтобы открыть бота, подпишитесь на канал(ы) ниже 👇\n\n✅ <i>Когда подпишетесь на все, нажмите «Я подписался»</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ Я подписался',
    notJoinedYet:
        '🤔 Похоже, вы подписались не на все каналы. Подпишитесь на каждый из них и снова нажмите «Я подписался» 🙏',

    currency: 'туманов',
    unlimited: 'Безлимит',
    days: 'дн.',
    hours: 'ч.',

    reviewTopicName: 'Проверка чеков',
    reviewTopicIntro: '🧾 Здесь появляются чеки клиентов для подтверждения.',
    logsTopicName: 'Статистика',
    logsTopicIntro:
        '📊 Сюда каждый день после полуночи по UTC приходят итоги, а также действия бота: новые клиенты, покупки, бесплатные тесты, пополнения, бонусы за приглашения и ошибки. Отправьте /stats, чтобы увидеть свежие цифры.',
    topupReview: '💰 Пополнение #{id}\n👤 {customer} · id {tgId}\n💵 {amount}',
    btnApprove: '✅ Подтвердить',
    btnReject: '❌ Отклонить',
    btnRejectNoReason: 'Отклонить (без причины)',
    btnRejectWithReason: 'Отклонить с причиной',
    btnStaffBack: '⬅︎ Назад',
    askRejectReason: 'Ответьте здесь, указав причину отказа по чеку #{id}.',
    approvedBy: '✅ Подтвердил {admin}',
    rejectedBy: '❌ Отклонил {admin}',
    rejectedByReason: '❌ Отклонил {admin}\nПричина: {reason}',
    alertApproved: 'Подтверждено — кошелёк пополнен.',
    alertRejected: 'Отклонено.',
    alertSendReason: 'Отправьте причину ответом.',
    alertHandled: 'Уже обработано.',
    alertNothing: 'Нечего подтверждать.',
    alertAdminsOnly: 'Это могут делать только админы группы.',
    alertInactive: 'Аккаунт этого брокера неактивен.',
    ticketTopicName: '🎫 {name}',
    ticketIntro: 'Новое обращение от {name} (id {tgId}). Ответьте здесь.',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ Группа найдена.\nID: <code>{id}</code>\n\nОткройте панель → Telegram → Поиск ID группы и выберите эту группу.',
    logTopup: '💰 Пополнение #{id} подтверждено — {amount} зачислено {customer}.',
    logRejected: '❌ Заказ #{id} отклонён.',
    logRejectedReason: '❌ Заказ #{id} отклонён: {reason}',
    logError: '⚠️ Ошибка бота: {error}',
    logMembership: '⚠️ Не удалось проверить подписку на {channel}: {error}',
    logNewCustomer: '👋 Новый клиент: {customer} · id {tgId}',
    logNewReferral: '👋 Новый клиент: {customer} · id {tgId}\n🤝 Пригласил(а): {referrer}',
    logPurchase: '🛒 Заказ #{id}: {customer} купил(а) {plan} за {amount}.',
    logTrial: '🎁 {customer} взял(а) бесплатный тест.',
    logReward: '🎉 Бонус за приглашение: {amount} для {referrer} за пополнение #{id}.',
    logManualTopup: '💳 {amount} зачислено {customer} из панели.',

    statsTitle: '📊 <b>Статистика бота</b>',
    dailySummaryTitle: '🌙 <b>Итоги дня · {date}</b>',
    statsToday: '<b>📅 Сегодня</b>',
    stats7d: '<b>🗓 Последние 7 дней</b>',
    stats30d: '<b>🗓 Последние 30 дней</b>',
    statsPeriod:
        '{period}\n' +
        '👥 Новых клиентов: {newCustomers} · 🟢 Активных: {active}\n' +
        '🤝 По приглашениям: {referrals}\n' +
        '🛒 Продано тарифов: {sales} · {salesAmount}\n' +
        '💰 Пополнений подтверждено: {topups} · {topupsAmount}\n' +
        '❌ Пополнений отклонено: {rejected}\n' +
        '🎁 Бесплатных тестов: {trials}\n' +
        '🎉 Бонусов за приглашения: {rewards}',
    statsTotals:
        '<b>📦 За всё время</b>\n' +
        '👥 Клиентов: {customers} · 🛍 Покупателей: {buyers}\n' +
        '🛒 Продано тарифов: {sales} · {salesAmount}\n' +
        '💼 На кошельках: {wallets}\n' +
        '⏳ Чеков ждут проверки: {pending}',
};

const tr: Texts = {
    greeting:
        '👋 <b>Hoş geldin!</b>\n\n' +
        '🚀 Sınırlara elveda de — internetin tamamına yüksek hızda ve tam güvenlikle eriş.\n\n' +
        '✨ <b>Neden seveceksin:</b>\n' +
        '⚡️ Ultra hızlı sunucular — yayın, oyun ve indirmede sıfır yavaşlama\n' +
        '🌍 Sevdiğin her şey için dünya çapında premium konumlar\n' +
        '🔒 Gizli ve şifreli — verilerin her zaman sende kalır\n' +
        '📱 Tüm cihazlarında aynı anda çalışır\n' +
        '♾️ Kesintisiz, sağlam bağlantı\n' +
        '🎧 İhtiyaç duyduğunda gerçek insan desteği\n' +
        '💸 Adil fiyatlar ve para iade garantisi\n\n' +
        '👇 <b>Başlamak için aşağıdaki butonlardan birine dokun!</b>',
    useMenu: '👇 <b>Başlamak için aşağıdaki butonlardan birine dokun!</b>',
    menuBuy: '🛒 Paket satın al',
    menuSubs: '📦 Aboneliklerim',
    menuWallet: '💰 Cüzdanım',
    menuSupport: '💬 Destek',
    menuChannel: '📣 Kanalımız',
    menuLanguage: '🌐 Dil',
    chooseLanguage: '🌐 <b>Dilini seç</b>',
    btnBack: '⬅️ Geri',

    chooseCategory:
        '🗂 <b>Bir kategori seç</b>\n\n<i>Paketlerini görmek için bir kategoriye dokun.</i> 👇',
    catOther: '📦 Diğer',
    choosePlan:
        '🛒 <b>Harika — hadi seni bağlayalım!</b>\n\n' +
        '⚡️ Tüm paketler en hızlı ve en stabil sunucularımızda çalışır.\n' +
        '💫 <i>Sana uyanı seç ve tüm detaylar için üzerine dokun</i> 👇',
    noPlans:
        '😔 <b>Şu anda uygun paket yok.</b>\n\n🙏 Muhtemelen stok yeniliyoruz — çok yakında tekrar bak!',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 Trafik</b>: {traffic}\n' +
        '<b>⏳ Süre</b>: {duration}\n' +
        '<b>📱 Aynı anda cihaz</b>: {devices}\n' +
        '<b>💰 Fiyat</b>: <b>{price}</b>\n\n' +
        '⚡️ <b>Hızlı, güvenli ve kaya gibi sağlam</b> — dakikalar içinde aktif olur.\n' +
        '💳 <i>Almak için “Cüzdandan öde”ye dokun!</i> 🚀\n\n' +
        '💰 Cüzdanın: <b>{balance}</b>',
    btnBuyWallet: '💳 Cüzdandan öde',
    insufficient:
        '😕 <b>Bakiye yetersiz.</b>\n\n💰 Cüzdanın: <b>{balance}</b>\n🏷 Paket fiyatı: <b>{price}</b>\n\nÖnce cüzdanını yükle, sonra paketi al.',
    approved:
        '🎉🎉 <b>Her şey hazır!</b> 🎉🎉\n\n' +
        '🚀 Aboneliğin aktif ve kullanıma hazır.\n\n' +
        '🔗 <b>Kişisel bağlantı linkin:</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>Kimseyle paylaşma — sadece sana özel.</i>\n' +
        '📊 Kullanımını takip etmek için istediğin zaman “📦 Aboneliklerim”e dokun.\n\n' +
        'Keyfini çıkar! ✨',
    unavailable:
        '😔 <b>Satışlar şu an durduruldu.</b>\n\n🙏 Biraz sonra tekrar dene — çok yakında döneceğiz!',

    walletScreen:
        '💰 <b>Cüzdanın</b>\n\nBakiye: <b>{balance}</b>\n\nİstediğin paketi anında almak için kullan.',
    btnCharge: '➕ Cüzdan yükle',
    chargePrompt:
        '💳 <b>Ne kadar eklemek istersin?</b>\n\nTutarı Toman olarak gönder (ör. <code>50000</code>).',
    invalidAmount: 'Lütfen Toman olarak geçerli bir tutar gönder — sadece rakam, ör. 50000.',
    topupNoMethods: '😔 Ödeme henüz ayarlanmadı — lütfen 💬 Destek ile iletişime geç.',
    tooManyPending:
        '⏳ <b>Bir dakika!</b>\n\nİnceleme sırasında bekleyen dekontların var — <i>yenilerini göndermeden önce lütfen onların bitmesini bekle</i> 🙏',
    topupInstructions:
        '🧾 <b>Cüzdanına {amount} ekleniyor</b>\n\nAşağıdaki hesaplardan birine tam olarak <b>{amount}</b> gönder, sonra dekontun fotoğrafını buraya at 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>Alındı — teşekkürler!</b> 🙌\n\n⏳ Yüklemen inceleniyor. Onaylandığı anda cüzdanına eklenecek.',
    walletCharged:
        '✅ <b>Cüzdan yüklendi!</b> 🎉\n\n➕ {amount} eklendi.\n💰 Yeni bakiye: <b>{balance}</b>',
    topupRejected: '❌ Yüklemen onaylanmadı. Lütfen 💬 Destek ile iletişime geç.',
    topupRejectedReason:
        '❌ <b>Bu sefer dekontunu onaylayamadık.</b>\n\n📝 <b>Sebep:</b> <i>{reason}</i>\n\n🤝 Yardım mı lazım? 💬 Destek’e dokun, hemen yardımcı olalım!',

    subsPick:
        '📦 <b>Aboneliklerin</b>\n\n<i>Detayları ve bağlantı linklerini görmek için birine dokun.</i>',
    subsEmpty:
        '📭 <b>Henüz aboneliğin yok!</b>\n\n🚀 Bağlanmaya hazır mısın? “🛒 Paket satın al”a dokun, dakikalar içinde çevrimiçi ol.',
    subFallback: 'Abonelik #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>Kullanım:</b> {used} / {limit}\n' +
        '📅 <b>Bitiş:</b> {expires}\n\n' +
        '🔗 <b>Abonelik linki:</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>Bağlantı yapılandırmaları:</b>',

    menuInvite: '🤝 Arkadaşını davet et',
    inviteScreen:
        '🤝 <b>Arkadaşlarını davet et, bakiye kazan!</b>\n\n' +
        '🎁 Kişisel bağlantını paylaş. Davet ettiğin bir arkadaşın cüzdanına her yükleme yaptığında, tutarın <b>%{percent}</b> kadarı senin cüzdanına eklenir.\n\n' +
        '🔗 <b>Bağlantın:</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 Davet edilen arkadaşlar: <b>{invited}</b>\n' +
        '💰 Şu ana kadar kazancın: <b>{earned}</b>',
    referralReward:
        '🎁 <b>Davet ödülü!</b>\n\nDavet ettiğin bir arkadaşın cüzdanına yükleme yaptı.\n➕ Cüzdanına {amount} eklendi.\n💰 Yeni bakiye: <b>{balance}</b>',

    menuTrial: '🎁 Ücretsiz deneme',
    trialReview:
        '🎁 <b>Bizi ücretsiz dene!</b>\n\n' +
        '<b>📊 Trafik</b>: {traffic}\n' +
        '<b>⏳ Süre</b>: {duration}\n' +
        '<b>📱 Aynı anda cihaz</b>: {devices}\n\n' +
        '✨ Her hesaba bir ücretsiz deneme — hemen etkinleştirmek için aşağıya dokun.',
    btnTrialClaim: '✅ Ücretsiz denememi etkinleştir',
    trialUsed:
        '🙌 <b>Ücretsiz denemeni zaten kullandın.</b>\n\n🛒 Daha fazlası mı? “Paket satın al”a dokunup tam bir paket seç.',
    trialSoldOut:
        '⏳ <b>Bugünün ücretsiz denemeleri tükendi.</b>\n\n🙏 Yarın tekrar uğra ya da hemen başlamak için “Paket satın al”a dokun.',

    supportPrompt:
        '💬 <b>Seni dinliyoruz!</b>\n\n✍️ Mesajını aşağıya yaz, ekibimiz burada yanıtlasın.\n\n↩️ <i>Menüye dönmek için istediğin zaman /start gönder.</i>',
    supportSent:
        '✅ <b>Mesaj gönderildi!</b> 🚀\n\nEkibimiz aldı ve çok yakında burada yanıtlayacak. <i>Yazdığın için teşekkürler!</i> 🙏',
    supportUnavailable: '😔 <b>Destek şu anda kullanılamıyor.</b>\n\n🙏 Biraz sonra tekrar dene!',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>Neredeyse tamam — tek bir adım kaldı!</b>\n\n📣 Botu açmak için lütfen aşağıdaki kanal(lar)a katıl 👇\n\n✅ <i>Hepsine katıldıktan sonra “Katıldım”a dokun</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ Katıldım',
    notJoinedYet:
        '🤔 Görünüşe göre hepsine henüz katılmadın. Yukarıdaki tüm kanallara katıl ve tekrar “Katıldım”a dokun 🙏',

    currency: 'Toman',
    unlimited: 'Sınırsız',
    days: 'gün',
    hours: 'saat',

    reviewTopicName: 'Dekont İnceleme',
    reviewTopicIntro: '🧾 Müşteri ödeme dekontları onay için burada görünür.',
    logsTopicName: 'İstatistikler',
    logsTopicIntro:
        '📊 Her gün UTC gece yarısından sonra istatistik özeti buraya gelir; yeni müşteriler, satın almalar, ücretsiz denemeler, yüklemeler, davet ödülleri ve hatalar gibi bot etkinlikleri de. Güncel rakamlar için /stats gönderin.',
    topupReview: '💰 Yükleme #{id}\n👤 {customer} · id {tgId}\n💵 {amount}',
    btnApprove: '✅ Onayla',
    btnReject: '❌ Reddet',
    btnRejectNoReason: 'Reddet (sebepsiz)',
    btnRejectWithReason: 'Sebep belirterek reddet',
    btnStaffBack: '⬅︎ Geri',
    askRejectReason: '#{id} numaralı dekontun ret sebebini buraya yanıt olarak yaz.',
    approvedBy: '✅ {admin} onayladı',
    rejectedBy: '❌ {admin} reddetti',
    rejectedByReason: '❌ {admin} reddetti\nSebep: {reason}',
    alertApproved: 'Onaylandı — cüzdan yüklendi.',
    alertRejected: 'Reddedildi.',
    alertSendReason: 'Sebebi yanıt olarak gönder.',
    alertHandled: 'Zaten işlendi.',
    alertNothing: 'Onaylanacak bir şey yok.',
    alertAdminsOnly: 'Bunu sadece grup yöneticileri yapabilir.',
    alertInactive: 'Bu bayi hesabı aktif değil.',
    ticketTopicName: '🎫 {name}',
    ticketIntro:
        '{name} kullanıcısından yeni destek talebi (id {tgId}). Yanıtlamak için buraya yaz.',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ Grup bulundu.\nID: <code>{id}</code>\n\nPanelinde Telegram → Grup ID Bulucu’yu aç ve bu grubu seç.',
    logTopup: '💰 Yükleme #{id} onaylandı — {amount}, {customer} hesabına eklendi.',
    logRejected: '❌ #{id} numaralı sipariş reddedildi.',
    logRejectedReason: '❌ #{id} numaralı sipariş reddedildi: {reason}',
    logError: '⚠️ Bot hatası: {error}',
    logMembership: '⚠️ {channel} üyeliği doğrulanamadı: {error}',
    logNewCustomer: '👋 Yeni müşteri: {customer} · id {tgId}',
    logNewReferral: '👋 Yeni müşteri: {customer} · id {tgId}\n🤝 Davet eden: {referrer}',
    logPurchase: '🛒 Sipariş #{id}: {customer}, {plan} paketini {amount} karşılığında aldı.',
    logTrial: '🎁 {customer} ücretsiz denemeyi aldı.',
    logReward: '🎉 Davet ödülü: #{id} yüklemesi için {referrer} hesabına {amount}.',
    logManualTopup: '💳 Panelden {customer} hesabına {amount} eklendi.',

    statsTitle: '📊 <b>Bot istatistikleri</b>',
    dailySummaryTitle: '🌙 <b>Günlük özet · {date}</b>',
    statsToday: '<b>📅 Bugün</b>',
    stats7d: '<b>🗓 Son 7 gün</b>',
    stats30d: '<b>🗓 Son 30 gün</b>',
    statsPeriod:
        '{period}\n' +
        '👥 Yeni müşteri: {newCustomers} · 🟢 Aktif: {active}\n' +
        '🤝 Davetle gelen: {referrals}\n' +
        '🛒 Satılan paket: {sales} · {salesAmount}\n' +
        '💰 Onaylanan yükleme: {topups} · {topupsAmount}\n' +
        '❌ Reddedilen yükleme: {rejected}\n' +
        '🎁 Ücretsiz deneme: {trials}\n' +
        '🎉 Davet ödülleri: {rewards}',
    statsTotals:
        '<b>📦 Tüm zamanlar</b>\n' +
        '👥 Müşteri: {customers} · 🛍 Alıcı: {buyers}\n' +
        '🛒 Satılan paket: {sales} · {salesAmount}\n' +
        '💼 Cüzdanlardaki bakiye: {wallets}\n' +
        '⏳ Bekleyen dekont: {pending}',
};

const zh: Texts = {
    greeting:
        '👋 <b>欢迎加入！</b>\n\n' +
        '🚀 告别限制——以极速畅享整个互联网，全程安全加密。\n\n' +
        '✨ <b>你会爱上它的理由：</b>\n' +
        '⚡️ 超高速服务器——看视频、玩游戏、下载都不限速\n' +
        '🌍 遍布全球的优质节点，畅享你喜爱的一切\n' +
        '🔒 私密加密——你的数据永远只属于你\n' +
        '📱 所有设备可同时使用\n' +
        '♾️ 稳如磐石，始终在线\n' +
        '🎧 随时都有真人客服为你服务\n' +
        '💸 价格公道，并提供退款保障\n\n' +
        '👇 <b>点击下方按钮开始吧！</b>',
    useMenu: '👇 <b>点击下方任一按钮开始吧！</b>',
    menuBuy: '🛒 购买套餐',
    menuSubs: '📦 我的订阅',
    menuWallet: '💰 我的钱包',
    menuSupport: '💬 客服',
    menuChannel: '📣 我们的频道',
    menuLanguage: '🌐 语言',
    chooseLanguage: '🌐 <b>选择你的语言</b>',
    btnBack: '⬅️ 返回',

    chooseCategory: '🗂 <b>选择一个分类</b>\n\n<i>选择分类即可查看其中的套餐。</i> 👇',
    catOther: '📦 其他',
    choosePlan:
        '🛒 <b>太好了——马上为你接通！</b>\n\n' +
        '⚡️ 每个套餐都运行在我们最快、最稳定的服务器上。\n' +
        '💫 <i>挑选适合你的套餐，点击即可查看完整详情</i> 👇',
    noPlans: '😔 <b>暂时没有可购买的套餐。</b>\n\n🙏 我们可能正在补货——请稍后再来看看！',
    planButton: '{title} — {traffic} · {duration} · {price}',
    planReview:
        '✨ <b>{title}</b>\n\n' +
        '<b>📊 流量</b>：{traffic}\n' +
        '<b>⏳ 时长</b>：{duration}\n' +
        '<b>📱 同时在线设备</b>：{devices}\n' +
        '<b>💰 价格</b>：<b>{price}</b>\n\n' +
        '⚡️ <b>高速、安全、稳定</b>——几分钟内即可开通。\n' +
        '💳 <i>点击“用钱包支付”立即购买！</i> 🚀\n\n' +
        '💰 你的钱包：<b>{balance}</b>',
    btnBuyWallet: '💳 用钱包支付',
    insufficient:
        '😕 <b>余额不足。</b>\n\n💰 你的钱包：<b>{balance}</b>\n🏷 套餐价格：<b>{price}</b>\n\n请先为钱包充值，再购买套餐。',
    approved:
        '🎉🎉 <b>一切就绪！</b> 🎉🎉\n\n' +
        '🚀 你的订阅已激活，随时可以出发。\n\n' +
        '🔗 <b>你的专属连接链接：</b>\n<code>{link}</code>\n\n' +
        '🔐 <i>请妥善保管——它只属于你。</i>\n' +
        '📊 随时点击“📦 我的订阅”查看用量。\n\n' +
        '祝你使用愉快！✨',
    unavailable: '😔 <b>目前暂停购买。</b>\n\n🙏 请稍后再试——我们很快就回来！',

    walletScreen: '💰 <b>你的钱包</b>\n\n余额：<b>{balance}</b>\n\n可用于立即购买任意套餐。',
    btnCharge: '➕ 钱包充值',
    chargePrompt:
        '💳 <b>你想充值多少？</b>\n\n请发送以托曼为单位的金额（例如 <code>50000</code>）。',
    invalidAmount: '请发送有效的托曼金额——只填数字，例如 50000。',
    topupNoMethods: '😔 尚未设置付款方式——请联系 💬 客服。',
    tooManyPending:
        '⏳ <b>请稍等！</b>\n\n你已有付款凭证在等待审核——<i>请等这些处理完后再发送新的</i> 🙏',
    topupInstructions:
        '🧾 <b>正在为你的钱包充值 {amount}</b>\n\n请向下方任一收款方式准确转账 <b>{amount}</b>，然后在这里发送付款凭证的照片 📸\n\n{destinations}',
    topupSubmitted:
        '✅ <b>已收到——谢谢！</b> 🙌\n\n⏳ 你的充值正在审核中。一经批准，我们会立即为你的钱包入账。',
    walletCharged:
        '✅ <b>钱包充值成功！</b> 🎉\n\n➕ 已到账 {amount}。\n💰 新余额：<b>{balance}</b>',
    topupRejected: '❌ 你的充值未能通过审核。请联系 💬 客服。',
    topupRejectedReason:
        '❌ <b>这次我们无法通过你的付款凭证。</b>\n\n📝 <b>原因：</b><i>{reason}</i>\n\n🤝 需要帮助？点击 💬 客服，我们会帮你解决！',

    subsPick: '📦 <b>你的订阅</b>\n\n<i>点击任一订阅即可查看详情和连接链接。</i>',
    subsEmpty: '📭 <b>还没有订阅！</b>\n\n🚀 准备好连接了吗？点击“🛒 购买套餐”，几分钟内即可上线。',
    subFallback: '订阅 #{number}',
    subDetail:
        '📦 <b>{name}</b>\n\n' +
        '📊 <b>用量：</b>{used} / {limit}\n' +
        '📅 <b>到期：</b>{expires}\n\n' +
        '🔗 <b>订阅链接：</b>\n<code>{link}</code>{configs}',
    subConfigs: '🔐 <b>连接配置：</b>',

    menuInvite: '🤝 邀请好友',
    inviteScreen:
        '🤝 <b>邀请好友，赚取余额！</b>\n\n' +
        '🎁 分享你的专属链接。你邀请的好友每次为钱包充值，你都会获得充值金额的 <b>{percent}%</b>。\n\n' +
        '🔗 <b>你的链接：</b>\n<code>{inviteLink}</code>\n\n' +
        '👥 已邀请好友：<b>{invited}</b>\n' +
        '💰 累计收益：<b>{earned}</b>',
    referralReward:
        '🎁 <b>邀请奖励！</b>\n\n你邀请的一位好友为钱包充值了。\n➕ 已为你入账 {amount}。\n💰 新余额：<b>{balance}</b>',

    menuTrial: '🎁 免费试用',
    trialReview:
        '🎁 <b>免费试用！</b>\n\n' +
        '<b>📊 流量</b>：{traffic}\n' +
        '<b>⏳ 时长</b>：{duration}\n' +
        '<b>📱 同时在线设备</b>：{devices}\n\n' +
        '✨ 每个账号仅可免费试用一次——点击下方立即激活。',
    btnTrialClaim: '✅ 激活免费试用',
    trialUsed: '🙌 <b>你已经用过免费试用了。</b>\n\n🛒 想要更多？点击“购买套餐”选择完整套餐。',
    trialSoldOut: '⏳ <b>今天的免费试用已经发完了。</b>\n\n🙏 明天再来，或点击“购买套餐”立即开始。',

    supportPrompt:
        '💬 <b>我们在听！</b>\n\n✍️ 在下方输入你的消息，我们的团队会在这里回复你。\n\n↩️ <i>随时发送 /start 返回菜单。</i>',
    supportSent:
        '✅ <b>消息已发送！</b> 🚀\n\n我们的团队已收到，很快会在这里回复你。<i>感谢你的联系！</i> 🙏',
    supportUnavailable: '😔 <b>客服暂时不可用。</b>\n\n🙏 请稍后再试！',
    supportReply: '💬 {text}',

    joinRequired:
        '🔓 <b>就差一步了！</b>\n\n📣 请先加入下方的频道以解锁机器人 👇\n\n✅ <i>全部加入后，点击“我已加入”</i> 🎉',
    btnJoinChannel: '📣 {title}',
    btnJoined: '✅ 我已加入',
    notJoinedYet: '🤔 你似乎还没有全部加入。请加入上方的每个频道，然后再次点击“我已加入” 🙏',

    currency: '托曼',
    unlimited: '无限',
    days: '天',
    hours: '小时',

    reviewTopicName: '审核凭证',
    reviewTopicIntro: '🧾 客户的付款凭证会出现在这里等待审核。',
    logsTopicName: '统计',
    logsTopicIntro:
        '📊 每天 UTC 午夜后，统计汇总会发到这里，机器人的活动（新客户、购买、免费试用、充值、邀请奖励和错误）也记录在这里。发送 /stats 查看最新数据。',
    topupReview: '💰 充值 #{id}\n👤 {customer} · id {tgId}\n💵 {amount}',
    btnApprove: '✅ 批准',
    btnReject: '❌ 拒绝',
    btnRejectNoReason: '拒绝（不填原因）',
    btnRejectWithReason: '拒绝并填写原因',
    btnStaffBack: '⬅︎ 返回',
    askRejectReason: '请在这里回复凭证 #{id} 的拒绝原因。',
    approvedBy: '✅ 由 {admin} 批准',
    rejectedBy: '❌ 由 {admin} 拒绝',
    rejectedByReason: '❌ 由 {admin} 拒绝\n原因：{reason}',
    alertApproved: '已批准——钱包已入账。',
    alertRejected: '已拒绝。',
    alertSendReason: '请以回复的方式发送原因。',
    alertHandled: '已经处理过了。',
    alertNothing: '没有需要批准的内容。',
    alertAdminsOnly: '只有群组管理员可以这样做。',
    alertInactive: '该代理账户未激活。',
    ticketTopicName: '🎫 {name}',
    ticketIntro: '来自 {name}（id {tgId}）的新客服工单。在这里回复即可答复。',
    ticketRelay: '👤 {text}',
    groupCaptured:
        '✅ 已识别群组。\nID：<code>{id}</code>\n\n打开你的面板 → Telegram → Group ID Finder，然后选择这个群组。',
    logTopup: '💰 充值 #{id} 已批准——已为 {customer} 入账 {amount}。',
    logRejected: '❌ 订单 #{id} 已被拒绝。',
    logRejectedReason: '❌ 订单 #{id} 已被拒绝：{reason}',
    logError: '⚠️ 机器人错误：{error}',
    logMembership: '⚠️ 无法验证 {channel} 的成员身份：{error}',
    logNewCustomer: '👋 新客户：{customer} · id {tgId}',
    logNewReferral: '👋 新客户：{customer} · id {tgId}\n🤝 邀请人：{referrer}',
    logPurchase: '🛒 订单 #{id}：{customer} 以 {amount} 购买了 {plan}。',
    logTrial: '🎁 {customer} 领取了免费试用。',
    logReward: '🎉 邀请奖励：因充值 #{id} 向 {referrer} 发放 {amount}。',
    logManualTopup: '💳 已从面板为 {customer} 入账 {amount}。',

    statsTitle: '📊 <b>机器人统计</b>',
    dailySummaryTitle: '🌙 <b>每日汇总 · {date}</b>',
    statsToday: '<b>📅 今天</b>',
    stats7d: '<b>🗓 最近 7 天</b>',
    stats30d: '<b>🗓 最近 30 天</b>',
    statsPeriod:
        '{period}\n' +
        '👥 新客户：{newCustomers} · 🟢 活跃：{active}\n' +
        '🤝 通过邀请：{referrals}\n' +
        '🛒 售出套餐：{sales} · {salesAmount}\n' +
        '💰 已批准充值：{topups} · {topupsAmount}\n' +
        '❌ 已拒绝充值：{rejected}\n' +
        '🎁 免费试用：{trials}\n' +
        '🎉 邀请奖励：{rewards}',
    statsTotals:
        '<b>📦 累计</b>\n' +
        '👥 客户：{customers} · 🛍 买家：{buyers}\n' +
        '🛒 售出套餐：{sales} · {salesAmount}\n' +
        '💼 钱包余额：{wallets}\n' +
        '⏳ 待审核收据：{pending}',
};

export const DEFAULT_TEXTS: Record<Lang, Texts> = { en, fa, ar, ru, tr, zh };

/** Escape a dynamic value for Telegram HTML, attributes included. */
export function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Pre-built Telegram HTML that a template drops in as is. Every other value is escaped. */
export class Html {
    constructor(readonly html: string) {}
}

export type Vars = Record<string, Html | number | string>;

const LONE_AMP = /&(?!(?:amp|lt|gt|quot|#\d{1,7}|#x[\da-f]{1,6});)/gi;
const escText = (s: string) =>
    s.replace(LONE_AMP, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Re-emits a checked template as strict Telegram HTML: stray <, > and & become entities. */
function toTelegramHtml(template: string): string {
    return tokenizeTelegramHtml(template)
        .map((t) => {
            if (t.type === 'text') return escText(t.text);
            if (t.type === 'close') return `</${t.tag}>`;
            const attrs = Object.entries(t.attrs)
                .map(([k, v]) => (v ? ` ${k}="${escText(v).replace(/"/g, '&quot;')}"` : ` ${k}`))
                .join('');
            return `<${t.tag}${attrs}>`;
        })
        .join('');
}

export function isLang(v: unknown): v is Lang {
    return BROKER_BOT_LANGS.includes(v as Lang);
}

/** The bot's default language: new customers and the staff group. */
export function defaultLang(bot: Pick<BrokerBots, 'lang'> | null): Lang {
    return bot && isLang(bot.lang) ? bot.lang : 'en';
}

/** Languages customers can pick, the default among them. */
export function botLangs(bot: Pick<BrokerBots, 'lang' | 'langs'> | null): Lang[] {
    const langs = (bot?.langs ?? []).filter(isLang);
    return langs.length ? langs : [defaultLang(bot)];
}

/** The broker's text for this language, or the default. Fills {variables}. */
export function renderText(
    custom: unknown,
    lang: Lang,
    key: TBrokerBotTextKey,
    vars: Vars = {},
): string {
    const own = (custom as CustomTexts | null)?.[lang]?.[key];
    // A text saved before a rule changed must not break the bot: fall back to the default.
    const template =
        typeof own === 'string' && !checkBrokerBotText(key, own) ? own : DEFAULT_TEXTS[lang][key];
    const isHtml = BROKER_BOT_TEXTS[key].kind === 'message';
    return (isHtml ? toTelegramHtml(template) : template).replace(/\{(\w+)\}/g, (m, name) => {
        const v = vars[name];
        if (v === undefined) return m;
        if (v instanceof Html) return v.html;
        return isHtml ? esc(String(v)) : String(v);
    });
}

/** Renders texts in one language of one bot. */
export type T = (key: TBrokerBotTextKey, vars?: Vars) => string;

export function translator(custom: unknown, lang: Lang): T {
    return (key, vars) => renderText(custom, lang, key, vars);
}

/** 50000 → "50,000 Toman", with the bot's own currency word. */
export function formatToman(amount: bigint | number, t: T): string {
    const n = Number(amount);
    const sign = n < 0 ? '-' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US')} ${t('currency')}`;
}

// Wrap a value in a Unicode isolate (FSI…PDI) so a mixed LTR-number + RTL-unit
// run (e.g. "30 روز") keeps its parts together when joined with other fields on
// one line — otherwise bidi reordering flings the unit to the end of the string.
function iso(s: string): string {
    return `⁨${s}⁩`;
}

function planFields(p: Plan, t: T) {
    return {
        title: p.title,
        traffic: p.trafficGb > 0 ? `${p.trafficGb} GB` : t('unlimited'),
        duration: p.durationHours
            ? `${p.durationHours} ${t('hours')}`
            : `${p.durationDays} ${t('days')}`,
        devices: p.ipLimit ? `${p.ipLimit}` : t('unlimited'),
        price: formatToman(p.price, t),
    };
}

export function planLabel(p: Plan, t: T): string {
    const f = planFields(p, t);
    return t('planButton', {
        title: f.title,
        traffic: iso(f.traffic),
        duration: iso(f.duration),
        price: iso(f.price),
    });
}

/** The free trial's offer screen. */
export function trialReview(trial: Trial, t: T): string {
    const { traffic, duration, devices } = planFields({ ...trial, title: '', price: 0 }, t);
    return t('trialReview', { traffic, duration, devices });
}

/** The review screen before payment: plan details and the customer's balance. */
export function planReview(p: Plan, balance: bigint, t: T): string {
    return t('planReview', { ...planFields(p, t), balance: formatToman(balance, t) });
}

export function adminName(u: { first_name?: string; username?: string }): string {
    return u.username ? '@' + u.username : u.first_name || 'admin';
}

/** The free test plan, when the broker has it switched on. */
export function activeTrial(bot: Pick<BrokerBots, 'trial'>): null | Trial {
    const trial = bot.trial as null | (Trial & { isActive: boolean });
    return trial?.isActive ? trial : null;
}

export function menuKeyboard(
    t: T,
    bot: Pick<
        BrokerBots,
        'botUsername' | 'channelUrl' | 'lang' | 'langs' | 'referralPercent' | 'trial'
    >,
): InlineKeyboard {
    // Support and the channel link share the bottom row.
    const supportRow: InlineButton[] = [{ text: t('menuSupport'), callback_data: 'support' }];
    if (bot.channelUrl) supportRow.push({ text: t('menuChannel'), url: bot.channelUrl });
    const keyboard: InlineKeyboard = [
        [{ text: t('menuBuy'), callback_data: 'buy', style: 'primary' }],
        [
            { text: t('menuSubs'), callback_data: 'mysubs' },
            { text: t('menuWallet'), callback_data: 'wallet' },
        ],
    ];
    if (activeTrial(bot)) keyboard.splice(1, 0, [{ text: t('menuTrial'), callback_data: 'trial' }]);
    // The invite link needs the bot's username.
    if (bot.referralPercent > 0 && bot.botUsername) {
        keyboard.push([{ text: t('menuInvite'), callback_data: 'invite' }]);
    }
    keyboard.push(supportRow);
    if (botLangs(bot).length > 1)
        keyboard.push([{ text: t('menuLanguage'), callback_data: 'lang' }]);
    return keyboard;
}

export function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
