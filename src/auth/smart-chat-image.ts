// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 图片识别（PearAPI airecognizeimg）
// ---------------------------------------------------------------------------
//
// 宿主侧异步队列：先写入占位文案，解析完成后以「补充：」再入 buffer。
// 不走模型 function-calling；封装为可 await 的 recognizeImageUrl。

import type { SmartChatBufferEntry, SmartChatDeps, SmartChatImageRecognizeSettings } from './smart-chat-types';
import { defaultImageRecognizeSettings } from './smart-chat-config';

export const IMAGE_RECOGNIZE_API = 'https://api.pearapi.ai/api/airecognizeimg/';

/**
 * 本群/好友开启识图时追加到 system（固定文案；仅 imageRecognize 开启时挂上）。
 * batch 里「[眼睛 …]」= 视网膜私货，不是用户打的字。
 */
export const IMAGE_RECOGNIZE_SYSTEM_SUFFIX =
    '\n\n[眼睛]\n' +
    '本会话开了识图：你能看见图，像正常人一样把看见的当聊天素材。\n' +
    '占位（正在解析）= 还在瞄；「[眼睛 msgid:…]」= 已经看见的私密备注——不是对方发的正文，别当成用户原话去答、去引用、去复述成布局说明书。\n' +
    '备注是「加载不出来」= 这轮没看清，略过图即可，别当成用户在抱怨加载。看见了就直接接话，别单独汇报「我在看图」。\n';

/** @deprecated 兼容旧常量引用 */
export const IMAGE_RECOGNIZE_TIMEOUT_MS = 30_000;
export const IMAGE_QUEUE_LIMIT = 3;
export const IMAGE_PER_MSG_NORMAL_MAX = 3;
export const IMAGE_PER_MSG_AT_MAX = 2;

export interface ImageRecognizeResult {
    ok: boolean;
    result?: string;
    error?: string;
    timedOut?: boolean;
}

export interface ImagePlan {
    /** 是否把图片占位写入对话文本 */
    recordImages: boolean;
    urls: string[];
    /** 占位行（不含用户正文） */
    placeholderLine: string;
    skipReason?: string;
}

export interface ImageJobMeta {
    chatId: string;
    messageId: string;
    index: number;
    total: number;
    url: string;
    isAt: boolean;
    forceFlushAfter: boolean;
    timeoutMs: number;
    userId: string;
    nickname: string;
    time: string;
    eventSnapshot: Record<string, unknown>;
}

type QueueKind = 'normal' | 'at';

interface QueueState {
    pending: ImageJobMeta[];
    running: number;
}

const queues: Record<QueueKind, QueueState> = {
    normal: { pending: [], running: 0 },
    at: { pending: [], running: 0 },
};

let supplementHandler: ((entry: SmartChatBufferEntry) => void) | null = null;
let imageLogger: SmartChatDeps['logger'] | null = null;

export function bindSmartChatImageRuntime(
    onSupplement: (entry: SmartChatBufferEntry) => void,
    logger?: SmartChatDeps['logger'],
): void {
    supplementHandler = onSupplement;
    imageLogger = logger || null;
}

/** 从 OB11 message 段提取可识别的 http(s) 图片 URL */
export function extractImageHttpUrls(message: unknown): string[] {
    if (!Array.isArray(message)) return [];
    const out: string[] = [];
    const pushUrl = (u: unknown) => {
        const url = String(u ?? '').trim();
        if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
    };
    for (const seg of message) {
        if (!seg || typeof seg !== 'object') continue;
        const type = String((seg as { type?: string }).type || '').toLowerCase();
        const data = (seg as { data?: Record<string, unknown> }).data;
        const d = data && typeof data === 'object' ? data : {};
        if (type === 'image') {
            pushUrl(d.url);
            pushUrl(d.file);
            continue;
        }
        if (type === 'file') {
            const name = String(d.file ?? d.name ?? '').toLowerCase();
            if (/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name)) pushUrl(d.url);
        }
    }
    return out;
}

export function buildImagePlaceholderLine(messageId: string, count: number): string {
    const mid = String(messageId || '').trim() || 'unknown';
    const n = Math.max(1, Number(count) || 1);
    return `${mid} 发了${n}张[图片](图片资源正在解析，也可能没有)`;
}

export function buildImageSupplementLine(
    messageId: string,
    index: number,
    body: string,
): string {
    const mid = String(messageId || '').trim() || 'unknown';
    const i = Math.max(1, Number(index) || 1);
    const compact = compactImageOcrBody(String(body || '').trim() || '加载不出来');
    return `补充：${mid} 图片第${i}张解析结果 ${compact}`;
}

/** 识图 OCR 正文压缩：去 Markdown 妆点，截断到可读长度（进 buffer / 会话都用） */
export function compactImageOcrBody(body: string, maxChars = 280): string {
    let s = String(body || '').trim();
    if (!s) return '加载不出来';
    if (/^加载不出来/.test(s)) return '加载不出来';
    s = s
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/\n{3,}/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
    const cap = Math.max(80, Math.min(800, Number(maxChars) || 280));
    if (s.length <= cap) return s;
    return `${s.slice(0, cap)}…`;
}

/**
 * 压缩文本里所有「补充：…解析结果」段（历史会话瘦身；与 API 字节一致需在写入前做）。
 */
export function compressImageSupplementsInText(text: string, maxChars = 280): string {
    const raw = String(text || '');
    if (!raw.includes('补充：') || !raw.includes('解析结果')) return raw;

    const re = /补充：(\S+)\s*图片第(\d+)张解析结果\s*/g;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
        out += raw.slice(last, m.index);
        const bodyStart = m.index + m[0].length;
        let bodyEnd = raw.length;
        const rest = raw.slice(bodyStart);
        const nextSup = rest.search(/\n补充：/);
        const nextEyes = rest.search(/\n\[眼睛\s/);
        const nextBatchLine = rest.search(/\n\[\d{4}-\d{2}-\d{2}[^\]]*\]/);
        const cuts = [nextSup, nextEyes, nextBatchLine].filter((n) => n >= 0);
        if (cuts.length) bodyEnd = bodyStart + Math.min(...cuts);
        const body = raw.slice(bodyStart, bodyEnd).trim();
        out += `补充：${m[1]} 图片第${m[2]}张解析结果 ${compactImageOcrBody(body, maxChars)}`;
        last = bodyEnd;
    }
    out += raw.slice(last);
    return out;
}

/** 模型可见形态：眼睛备注，避免挂在昵称后被当成用户打字 */
export function formatEyesVisionLine(messageId: string, index: number, body: string): string {
    const mid = String(messageId || '').trim() || 'unknown';
    const i = Math.max(1, Number(index) || 1);
    const compact = compactImageOcrBody(String(body || '').trim() || '加载不出来');
    return `[眼睛 msgid:${mid} 第${i}张]: ${compact}`;
}

/**
 * 把 buffer/历史里的「补充：…」改写成 [眼睛 …]，供 compose / 会话瘦身。
 * 纯补充行会去掉「昵称:」归因，避免模型以为用户发了 OCR 正文。
 */
export function presentImageSupplementsForModel(text: string, maxChars = 280): string {
    let raw = compressImageSupplementsInText(String(text || ''), maxChars);
    if (!raw.includes('补充：') && !raw.includes('[眼睛 ')) return raw;

    // 整行：时间戳 昵称(qq) …: 补充：mid …
    raw = raw.replace(
        /^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s+[^(]+\(\d+\)(?:\s+\[[^\]]+\])*\s*:\s*补充：(\S+)\s*图片第(\d+)张解析结果\s*/gm,
        (_all, mid: string, idx: string) => `[眼睛 msgid:${mid} 第${idx}张]: `,
    );

    // 残留「补充：」标记（含无时间戳的纯 buffer 行）
    if (raw.includes('补充：') && raw.includes('解析结果')) {
        const re = /补充：(\S+)\s*图片第(\d+)张解析结果\s*/g;
        let out = '';
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw))) {
            out += raw.slice(last, m.index);
            const bodyStart = m.index + m[0].length;
            let bodyEnd = raw.length;
            const rest = raw.slice(bodyStart);
            const nextSup = rest.search(/\n补充：/);
            const nextEyes = rest.search(/\n\[眼睛\s/);
            const nextBatchLine = rest.search(/\n\[\d{4}-\d{2}-\d{2}[^\]]*\]/);
            const cuts = [nextSup, nextEyes, nextBatchLine].filter((n) => n >= 0);
            if (cuts.length) bodyEnd = bodyStart + Math.min(...cuts);
            const body = raw.slice(bodyStart, bodyEnd).trim();
            out += formatEyesVisionLine(m[1], Number(m[2]), body);
            last = bodyEnd;
        }
        out += raw.slice(last);
        raw = out;
    }

    return raw;
}

/** 整段文本是否为识图补充（入队 / leftover 判定） */
export function isImageSupplementText(text: string): boolean {
    const t = String(text || '').trim();
    return /^补充：\S*\s*图片第\d+张解析结果/.test(t)
        || /^\[眼睛\s+msgid:/i.test(t);
}
/** 调用 Pear 识图；超时由 timeoutMs 控制 */
export async function recognizeImageUrl(
    fileUrl: string,
    timeoutMs = IMAGE_RECOGNIZE_TIMEOUT_MS,
): Promise<ImageRecognizeResult> {
    const file = String(fileUrl || '').trim();
    if (!/^https?:\/\//i.test(file)) {
        return { ok: false, error: 'invalid_image_url' };
    }
    const wait = Math.max(5000, Math.min(120_000, Number(timeoutMs) || IMAGE_RECOGNIZE_TIMEOUT_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), wait);
    try {
        const resp = await fetch(IMAGE_RECOGNIZE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file }),
            signal: controller.signal,
        });
        const text = await resp.text();
        let data: Record<string, unknown> = {};
        try {
            data = JSON.parse(text);
        } catch {
            return { ok: false, error: `invalid_json: ${text.slice(0, 120)}` };
        }
        if (Number(data.code) !== 200) {
            return {
                ok: false,
                error: String(data.msg || data.message || `code=${data.code}`),
            };
        }
        const result = String(data.result ?? '').trim();
        if (!result) return { ok: false, error: 'empty_result' };
        return { ok: true, result };
    } catch (e: unknown) {
        const name = e && typeof e === 'object' ? String((e as { name?: string }).name || '') : '';
        const msg = e instanceof Error ? e.message : String(e || 'error');
        if (name === 'AbortError' || /aborted/i.test(msg)) {
            return { ok: false, timedOut: true, error: 'timeout' };
        }
        return { ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

function queueDepth(kind: QueueKind): number {
    const q = queues[kind];
    return q.pending.length + q.running;
}

function resolveSettings(raw?: SmartChatImageRecognizeSettings | null): SmartChatImageRecognizeSettings {
    return raw && typeof raw === 'object' ? { ...defaultImageRecognizeSettings(), ...raw } : defaultImageRecognizeSettings();
}

/**
 * 决定本条消息是否记录/识别图片。
 * - 开关关：不记录
 * - 单条超限：不记录不识别
 * - 对应队列装不下：不记录不识别
 */
export function planImageHandling(opts: {
    enabled: boolean;
    urls: string[];
    isAtBot: boolean;
    messageId?: string;
    settings?: SmartChatImageRecognizeSettings | null;
}): ImagePlan {
    const empty: ImagePlan = { recordImages: false, urls: [], placeholderLine: '' };
    if (!opts.enabled) return empty;
    const urls = Array.isArray(opts.urls) ? opts.urls.filter(Boolean) : [];
    if (!urls.length) return empty;

    const settings = resolveSettings(opts.settings);
    const perMax = opts.isAtBot ? settings.per_msg_at : settings.per_msg_normal;
    if (urls.length > perMax) {
        return {
            ...empty,
            skipReason: opts.isAtBot
                ? `艾特消息图片>${perMax}张，跳过识图`
                : `单条图片>${perMax}张，跳过识图`,
        };
    }

    const kind: QueueKind = opts.isAtBot ? 'at' : 'normal';
    const queueLimit = opts.isAtBot ? settings.queue_at : settings.queue_normal;
    if (queueDepth(kind) + urls.length > queueLimit) {
        return {
            ...empty,
            skipReason: `${kind === 'at' ? '艾特' : '普通'}识图队列已满(${queueLimit})，跳过`,
        };
    }

    return {
        recordImages: true,
        urls,
        placeholderLine: buildImagePlaceholderLine(opts.messageId || '', urls.length),
    };
}

function pump(kind: QueueKind): void {
    const q = queues[kind];
    while (q.running < 1 && q.pending.length) {
        const job = q.pending.shift();
        if (!job) break;
        q.running += 1;
        void runJob(kind, job).finally(() => {
            q.running = Math.max(0, q.running - 1);
            pump(kind);
        });
    }
}

async function runJob(kind: QueueKind, job: ImageJobMeta): Promise<void> {
    imageLogger?.info?.(
        `[智能对话·识图] ${job.chatId} msgid=${job.messageId} #${job.index}/${job.total} queue=${kind}`,
    );
    const r = await recognizeImageUrl(job.url, job.timeoutMs);
    let body: string;
    if (r.ok && r.result) body = r.result;
    else if (r.timedOut) body = '加载不出来';
    else body = '加载不出来';

    if (!r.ok) {
        imageLogger?.warn?.(
            `[智能对话·识图] 失败 msgid=${job.messageId} #${job.index}: ${r.error || 'unknown'}`,
        );
    }

    const entry: SmartChatBufferEntry = {
        userId: job.userId,
        nickname: job.nickname || job.userId,
        text: buildImageSupplementLine(job.messageId, job.index, body),
        time: job.time,
        messageId: job.messageId,
        eventSnapshot: job.eventSnapshot,
        // 仅艾特+图：补充完成后强制再访问；普通图补充只入缓存
        forceFlush: Boolean(job.forceFlushAfter),
    };
    try {
        supplementHandler?.(entry);
    } catch (e: unknown) {
        imageLogger?.warn?.('[智能对话·识图] 补充入队失败:', e instanceof Error ? e.message : e);
    }
}

/** 将本条可识别图片加入对应队列（调用前须 plan.recordImages===true） */
export function enqueueImageJobs(
    jobs: ImageJobMeta[],
    settings?: SmartChatImageRecognizeSettings | null,
): number {
    if (!jobs.length) return 0;
    const cfg = resolveSettings(settings);
    let n = 0;
    for (const job of jobs) {
        const kind: QueueKind = job.isAt ? 'at' : 'normal';
        const limit = job.isAt ? cfg.queue_at : cfg.queue_normal;
        if (queueDepth(kind) >= limit) {
            imageLogger?.warn?.(
                `[智能对话·识图] 队列满，丢弃 msgid=${job.messageId} #${job.index}`,
            );
            continue;
        }
        queues[kind].pending.push(job);
        n += 1;
        pump(kind);
    }
    return n;
}

export function getImageQueueSnapshot(): { normal: number; at: number } {
    return {
        normal: queueDepth('normal'),
        at: queueDepth('at'),
    };
}
