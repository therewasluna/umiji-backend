#!/usr/bin/env node
import { createHash } from 'node:crypto';
// Local-only Telegram Bot API double. Control endpoints return {ok, ...}:
// POST /_push {token, update} -> {update_id}; POST /_member {chatId,userId,status}; POST /_delete_topic {threadId};
// GET /_calls?token=...&since=N -> {seq, calls:[{seq,token,method,body,result?}]}.
import http from 'node:http';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
);
const bots = new Map();
const members = new Map();
const calls = [];
const deletedTopics = new Set();
let sequence = 0;
let messageId = 100;
let topicId = 1000;

function bot(token) {
    if (!bots.has(token)) bots.set(token, { nextUpdate: 1, updates: [], polls: new Set() });
    return bots.get(token);
}

function json(res, status, value) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
}

function record(token, method, body) {
    const call = { seq: ++sequence, token, method, body };
    calls.push(call);
    return call;
}

function updatesFor(state, offset) {
    return state.updates.filter((u) => u.update_id >= offset).slice(0, 100);
}

async function bodyOf(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('latin1');
    if ((req.headers['content-type'] ?? '').startsWith('multipart/form-data')) {
        // Photo uploads: keep the text fields, note the file part.
        const fields = { multipart: true };
        for (const m of raw.matchAll(
            /name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n/g,
        )) {
            if (m[2] !== undefined) {
                fields[m[1]] = { filename: m[2] };
                continue;
            }
            const start = m.index + m[0].length;
            fields[m[1]] = Buffer.from(
                raw.slice(start, raw.indexOf('\r\n--', start)),
                'latin1',
            ).toString('utf8');
        }
        return fields;
    }
    return raw ? JSON.parse(Buffer.from(raw, 'latin1').toString('utf8')) : {};
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1:8081');
        if (req.method === 'GET' && url.pathname === '/_calls') {
            const token = url.searchParams.get('token');
            const since = Number(url.searchParams.get('since') ?? 0);
            return json(res, 200, {
                ok: true,
                seq: sequence,
                calls: calls.filter((c) => c.seq > since && (token === null || c.token === token)),
            });
        }
        const file = url.pathname.match(/^\/file\/bot([^/]+)\/(.+)$/);
        if (req.method === 'GET' && file) {
            record(file[1], 'downloadFile', { file_path: file[2] });
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
            return res.end(png);
        }
        if (req.method !== 'POST') {
            return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
        }
        const body = await bodyOf(req);
        if (url.pathname === '/_push') {
            if (typeof body.token !== 'string' || !body.update || typeof body.update !== 'object') {
                return json(res, 400, { ok: false, description: 'Expected token and update' });
            }
            const state = bot(body.token);
            const update = { ...body.update, update_id: state.nextUpdate++ };
            state.updates.push(update);
            for (const poll of state.polls) {
                const updates = updatesFor(state, poll.offset);
                if (updates.length) poll.finish(updates);
            }
            return json(res, 200, { ok: true, update_id: update.update_id });
        }
        if (url.pathname === '/_member') {
            if (body.chatId == null || body.userId == null || typeof body.status !== 'string') {
                return json(res, 400, {
                    ok: false,
                    description: 'Expected chatId, userId and status',
                });
            }
            members.set(`${body.chatId}:${body.userId}`, body.status);
            return json(res, 200, { ok: true });
        }
        if (url.pathname === '/_delete_topic') {
            deletedTopics.add(Number(body.threadId));
            return json(res, 200, { ok: true });
        }
        const route = url.pathname.match(/^\/bot([^/]+)\/([^/]+)$/);
        if (!route) return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
        const [, token, method] = route;
        const call = record(token, method, body);
        if (deletedTopics.has(Number(body.message_thread_id))) {
            return json(res, 400, {
                ok: false,
                error_code: 400,
                description: 'Bad Request: message thread not found',
            });
        }
        const reply = (result) => {
            call.result = result;
            json(res, 200, { ok: true, result });
        };
        switch (method) {
            case 'getMe': {
                if (token === 'bad') {
                    return json(res, 401, {
                        ok: false,
                        error_code: 401,
                        description: 'Unauthorized',
                    });
                }
                const hash = createHash('sha256').update(token).digest('hex').slice(0, 16);
                return reply({
                    id: 8000001,
                    is_bot: true,
                    first_name: 'Mock Store',
                    username: `mock_${hash}_bot`,
                });
            }
            case 'getUpdates': {
                const state = bot(token);
                const offset = Number(body.offset ?? 0);
                state.updates = state.updates.filter((u) => u.update_id >= offset);
                state.nextUpdate = Math.max(state.nextUpdate, offset);
                const updates = updatesFor(state, offset);
                const timeout = Math.max(0, Number(body.timeout) || 0);
                if (updates.length || !timeout) return reply(updates);
                const poll = { offset, finish: null };
                const cleanup = () => {
                    clearTimeout(timer);
                    state.polls.delete(poll);
                };
                poll.finish = (result) => {
                    cleanup();
                    reply(result);
                };
                const timer = setTimeout(() => poll.finish([]), timeout * 1000);
                state.polls.add(poll);
                res.on('close', cleanup);
                return;
            }
            case 'createForumTopic':
                return reply({
                    message_thread_id: ++topicId,
                    name: body.name,
                    icon_color: 7322096,
                });
            case 'sendMessage':
                return reply({
                    message_id: ++messageId,
                    date: Math.floor(Date.now() / 1000),
                    chat: { id: Number(body.chat_id) },
                    text: body.text,
                });
            case 'sendPhoto':
                return reply({
                    message_id: ++messageId,
                    chat: { id: Number(body.chat_id) },
                    photo: [{ file_id: 'mock-photo-small' }, { file_id: 'mock-photo-large' }],
                });
            case 'copyMessage':
                return reply({ message_id: ++messageId });
            case 'editMessageText':
                return reply({
                    message_id: body.message_id,
                    chat: { id: Number(body.chat_id) },
                    text: body.text,
                });
            case 'getChatMember':
                return reply({
                    status:
                        members.get(`${body.chat_id}:${body.user_id}`) ??
                        (Number(body.user_id) === 9000001 && Number(body.chat_id) < 0
                            ? 'administrator'
                            : 'member'),
                    user: { id: Number(body.user_id), is_bot: false, first_name: 'Mock member' },
                });
            case 'getFile':
                return reply({
                    file_id: body.file_id,
                    file_unique_id: 'receipt',
                    file_size: png.length,
                    file_path: 'photos/receipt.png',
                });
            case 'deleteWebhook':
            case 'setWebhook':
            case 'editMessageReplyMarkup':
            case 'pinChatMessage':
            case 'editForumTopic':
            case 'answerCallbackQuery':
                return reply(true);
            default:
                return json(res, 404, {
                    ok: false,
                    error_code: 404,
                    description: `Unknown method: ${method}`,
                });
        }
    } catch (error) {
        json(res, 400, { ok: false, error_code: 400, description: error.message });
    }
});

server.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
});
server.listen(8081, '127.0.0.1', () => console.log('Mock Telegram listening on 127.0.0.1:8081'));
function stop() {
    for (const state of bots.values()) for (const poll of state.polls) poll.finish([]);
    server.close();
    server.closeAllConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
