import axios, { AxiosInstance } from 'axios';
import { ProxyAgent } from 'proxy-agent';

/** Inline keyboard button. `style` colors it (Bot API 9.4+); older clients ignore it. */
export interface InlineButton {
    text: string;
    callback_data?: string;
    url?: string;
    style?: 'danger' | 'success' | 'primary';
}
export type InlineKeyboard = InlineButton[][];

export class TelegramError extends Error {
    constructor(
        public readonly method: string,
        public readonly description: string,
        public readonly code?: number,
    ) {
        super(`Telegram ${method} failed: ${description}`);
        this.name = 'TelegramError';
    }
}

export interface TelegramClientOptions {
    apiRoot: string;
    proxy?: string;
}

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // receipts are images, not archives

/** Thin Bot API client for one broker bot. Goes through TELEGRAM_BOT_PROXY when it is set. */
export class TelegramClient {
    private readonly http: AxiosInstance;

    constructor(
        private readonly token: string,
        private readonly options: TelegramClientOptions,
    ) {
        const agent = options.proxy
            ? new ProxyAgent({ getProxyForUrl: () => options.proxy! })
            : undefined;

        this.http = axios.create({
            baseURL: options.apiRoot,
            timeout: 20_000,
            // follow-redirects caps uploads at 10 MB by default; broadcast photos can be that big.
            maxBodyLength: Infinity,
            httpAgent: agent,
            httpsAgent: agent,
            // Telegram answers errors with a JSON body we want to read.
            validateStatus: () => true,
        });
    }

    async call<T = unknown>(
        method: string,
        params?: FormData | Record<string, unknown>,
        opts?: { timeoutMs?: number; signal?: AbortSignal },
    ): Promise<T> {
        let data: { ok: boolean; result?: T; description?: string; error_code?: number } | null;
        let status: number;
        try {
            const res = await this.http.post(`/bot${this.token}/${method}`, params ?? {}, {
                timeout: opts?.timeoutMs,
                signal: opts?.signal,
            });
            data = res.data;
            status = res.status;
        } catch (error) {
            throw new TelegramError(
                method,
                error instanceof Error ? error.message : 'request failed',
            );
        }
        if (!data || !data.ok) {
            throw new TelegramError(
                method,
                data?.description ?? `HTTP ${status}`,
                data?.error_code,
            );
        }
        return data.result as T;
    }

    getMe(): Promise<{ id: number; username: string; first_name: string }> {
        return this.call('getMe');
    }

    deleteWebhook(): Promise<boolean> {
        return this.call('deleteWebhook', { drop_pending_updates: false });
    }

    /** One connection at a time, so a bot's updates are handled in order, as with polling. */
    setWebhook(url: string, secretToken: string): Promise<boolean> {
        return this.call('setWebhook', {
            url,
            secret_token: secretToken,
            allowed_updates: ['message', 'callback_query'],
            max_connections: 1,
        });
    }

    /** Long poll. `timeoutSec` is how long Telegram holds the request open. */
    getUpdates(
        offset: number,
        timeoutSec: number,
        signal?: AbortSignal,
    ): Promise<{ update_id: number; [key: string]: unknown }[]> {
        return this.call(
            'getUpdates',
            { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
            { timeoutMs: (timeoutSec + 15) * 1000, signal },
        );
    }

    /** Creates a forum topic and returns its message_thread_id. Needs a forum group and the manage-topics right. */
    async createForumTopic(chatId: string, name: string): Promise<number> {
        const r = await this.call<{ message_thread_id: number }>('createForumTopic', {
            chat_id: chatId,
            name,
        });
        return r.message_thread_id;
    }

    /** Renames a forum topic. Telegram refuses an unchanged name (TOPIC_NOT_MODIFIED). */
    async editForumTopic(chatId: string, threadId: number, name: string): Promise<void> {
        await this.call('editForumTopic', { chat_id: chatId, message_thread_id: threadId, name });
    }

    /**
     * Creates a forum topic with a pinned header message. The Bot API can't pin a topic in the
     * topic list, so the header inside it is pinned instead (best effort, needs the pin right).
     */
    async createPinnedTopic(chatId: string, name: string, intro: string): Promise<number> {
        const topicId = await this.createForumTopic(chatId, name);
        try {
            const m = await this.sendMessage(chatId, intro, { messageThreadId: topicId });
            await this.call('pinChatMessage', {
                chat_id: chatId,
                message_id: m.message_id,
                disable_notification: true,
            });
        } catch {
            // no pin right — the topic still works
        }
        return topicId;
    }

    sendMessage(
        chatId: string | number,
        text: string,
        opts?: {
            keyboard?: InlineKeyboard;
            messageThreadId?: number;
            replyToMessageId?: number;
            parseMode?: 'HTML';
        },
    ): Promise<{ message_id: number }> {
        return this.call('sendMessage', {
            chat_id: chatId,
            text,
            ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
            ...(opts?.messageThreadId ? { message_thread_id: opts.messageThreadId } : {}),
            ...(opts?.replyToMessageId
                ? {
                      reply_parameters: {
                          message_id: opts.replyToMessageId,
                          allow_sending_without_reply: true,
                      },
                  }
                : {}),
            ...(opts?.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
            link_preview_options: { is_disabled: true },
        });
    }

    /** Replaces a message's text: in-place navigation and decision statuses. */
    editMessageText(
        chatId: string | number,
        messageId: number,
        text: string,
        keyboard?: InlineKeyboard,
        parseMode?: 'HTML',
    ): Promise<unknown> {
        return this.call('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            ...(parseMode ? { parse_mode: parseMode } : {}),
            reply_markup: { inline_keyboard: keyboard ?? [] },
            link_preview_options: { is_disabled: true },
        });
    }

    editMessageReplyMarkup(
        chatId: string | number,
        messageId: number,
        keyboard?: InlineKeyboard,
    ): Promise<unknown> {
        return this.call('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard ?? [] },
        });
    }

    copyMessage(args: {
        toChatId: string | number;
        fromChatId: string | number;
        messageId: number;
        messageThreadId?: number;
    }): Promise<{ message_id: number }> {
        return this.call('copyMessage', {
            chat_id: args.toChatId,
            from_chat_id: args.fromChatId,
            message_id: args.messageId,
            ...(args.messageThreadId ? { message_thread_id: args.messageThreadId } : {}),
        });
    }

    /**
     * Sends a photo by an earlier file_id or by uploading bytes. Returns the file_id Telegram stored,
     * so the same bot can resend it without another upload (file_ids are per bot).
     */
    async sendPhoto(
        chatId: string | number,
        photo: string | { bytes: Buffer; fileName: string; mimeType: string },
        caption?: string,
    ): Promise<{ message_id: number; fileId?: string }> {
        let body: FormData | Record<string, unknown>;
        if (typeof photo === 'string') {
            body = { chat_id: chatId, photo, ...(caption ? { caption } : {}) };
        } else {
            body = new FormData();
            body.append('chat_id', String(chatId));
            if (caption) body.append('caption', caption);
            body.append(
                'photo',
                new Blob([new Uint8Array(photo.bytes)], { type: photo.mimeType }),
                photo.fileName,
            );
        }
        const r = await this.call<{ message_id: number; photo?: { file_id: string }[] }>(
            'sendPhoto',
            body,
            { timeoutMs: 60_000 },
        );
        return { message_id: r.message_id, fileId: r.photo?.at(-1)?.file_id };
    }

    getChatMember(chatId: string | number, userId: number): Promise<{ status: string }> {
        return this.call('getChatMember', { chat_id: chatId, user_id: userId });
    }

    answerCallbackQuery(id: string, text?: string): Promise<boolean> {
        return this.call('answerCallbackQuery', {
            callback_query_id: id,
            ...(text ? { text } : {}),
        });
    }

    /** Downloads a file by file_id, size-capped. Only image MIME types are passed through. */
    async downloadPhoto(fileId: string): Promise<{ bytes: Buffer; mime: string }> {
        const file = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
        if (!file.file_path) throw new TelegramError('getFile', 'no file_path');

        const res = await this.http.get<ArrayBuffer>(`/file/bot${this.token}/${file.file_path}`, {
            responseType: 'arraybuffer',
            timeout: 30_000,
            maxContentLength: MAX_DOWNLOAD_BYTES,
        });
        if (res.status !== 200) throw new TelegramError('downloadFile', `HTTP ${res.status}`);

        const upstream = String(res.headers['content-type'] ?? '');
        const ext = file.file_path.split('.').pop()?.toLowerCase();
        const mime = /^image\/(png|jpeg|webp|gif)$/.test(upstream)
            ? upstream
            : ext === 'png'
              ? 'image/png'
              : ext === 'webp'
                ? 'image/webp'
                : 'image/jpeg';
        return { bytes: Buffer.from(res.data), mime };
    }
}
