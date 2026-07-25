// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 出站解析（多段气泡 / 贴表情 / 闭嘴；禁止 CQ 码）
// ---------------------------------------------------------------------------

import type { SmartChatBufferEntry } from './smart-chat-types';
import { isAllowedMsgEmojiId } from './smart-chat-emoji';
import { looksLikeToolMarkup } from './smart-chat-provider';

export interface ReplyBubble {
    text: string;
    /** 要艾特的 QQ 列表；空则不艾特（一条消息可多人） */
    at?: string[];
    /** 要引用的 message_id；空则不引用。每条气泡独立；一条消息最多一个引用 */
    replyId?: string;
}

export type AssistantAction =
    | { type: 'shut_up' }
    | { type: 'react'; emojiId: string; messageId?: string }
    | { type: 'msg'; text: string; at?: string[]; replyId?: string }
    /** 联网前可选说明，立即发出且不计行为数 */
    | { type: 'status'; text: string };

const MAX_ACTIONS = 10;
const MAX_AT_PER_MSG = 8;
const MAX_BUBBLE_CHARS = 1200;

function stripCqAndFences(raw: string): string {
    let s = String(raw || '');
    s = s.replace(/```[\s\S]*?```/g, (block) => {
        const inner = block.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
        return inner;
    });
    s = s.replace(/\[CQ:[^\]]*\]/gi, '');
    return s.trim();
}

/** 出站正文清洗：HTML / Markdown / 多余空白 → QQ 可读纯文本 */
export function stripChatMarkdown(raw: string): string {
    let s = String(raw || '');
    // HTML 换行（QQ 不渲染标签，必须先变成真换行）
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/?(?:p|div|tr|li|h[1-6])\b[^>]*>/gi, '\n');
    // 去壳留字
    s = s.replace(/<\/?(?:span|strong|b|em|i|u|font|a|code|pre|ul|ol|table|tbody|thead|td|th|blockquote|hr)\b[^>]*>/gi, '');
    // 残留尖括号标签一律丢掉（正文里不该再有 HTML）
    s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
    // 常见实体
    s = s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'");
    // **bold** / __bold__（可多轮，处理嵌套少见情况）
    for (let i = 0; i < 3; i++) {
        const next = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
        if (next === s) break;
        s = next;
    }
    // 拆坏后残留的 ** / __
    s = s.replace(/\*\*/g, '').replace(/__/g, '');
    // 行首标题
    s = s.replace(/^#{1,6}\s+/gm, '');
    // [文字](url) → 文字
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
    // 行内 `code`
    s = s.replace(/`([^`\n]+)`/g, '$1');
    // 常见列表符改成更像聊天的点
    s = s.replace(/^[\t ]*[-*+]\s+/gm, '· ');
    // 空白
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return s;
}

function parseAttrs(attrText: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([a-zA-Z_\u4e00-\u9fff]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(attrText || ''))) {
        out[m[1].toLowerCase()] = m[2];
    }
    return out;
}

function sanitizeQq(raw: unknown): string | undefined {
    const q = String(raw || '').trim();
    if (!q || q.toLowerCase() === 'all') return undefined;
    if (!/^\d{5,12}$/.test(q)) return undefined;
    return q;
}

/** at="123" 或 at="123,456 789"（逗号/空白分隔，一条消息多人） */
function sanitizeAtList(raw: unknown): string[] | undefined {
    const s = String(raw || '').trim();
    if (!s) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of s.split(/[,，\s]+/)) {
        const q = sanitizeQq(part);
        if (!q || seen.has(q)) continue;
        seen.add(q);
        out.push(q);
        if (out.length >= MAX_AT_PER_MSG) break;
    }
    return out.length ? out : undefined;
}

function resolveReplyId(raw: unknown, batch: SmartChatBufferEntry[]): string | undefined {
    const v = String(raw || '').trim();
    if (!v) return undefined;
    if (v.toLowerCase() === 'last') {
        for (let i = batch.length - 1; i >= 0; i--) {
            const id = String(batch[i]?.messageId || '').trim();
            if (id) return id;
        }
        return undefined;
    }
    if (/^\d{1,24}$/.test(v)) return v;
    return undefined;
}

function pushMsg(list: AssistantAction[], text: string, at?: string, replyId?: string): void {
    let t = stripChatMarkdown(String(text || '').trim());
    if (!t) return;
    if (t.length > MAX_BUBBLE_CHARS) t = t.slice(0, MAX_BUBBLE_CHARS) + '…';
    t = t.replace(/\[CQ:[^\]]*\]/gi, '').trim();
    if (!t) return;
    list.push({
        type: 'msg',
        text: t,
        at: sanitizeAtList(at),
        replyId: replyId || undefined,
    });
}

/** 从正文里抠出最外层 JSON 对象/数组（兼容前后废话、```json fence） */
function extractJsonCandidate(raw: string): string | null {
    let s = String(raw || '').trim();
    if (!s) return null;
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    const startObj = s.indexOf('{');
    const startArr = s.indexOf('[');
    if (startObj < 0 && startArr < 0) return null;

    let start: number;
    let openCh: string;
    let closeCh: string;
    if (startObj < 0 || (startArr >= 0 && startArr < startObj)) {
        start = startArr;
        openCh = '[';
        closeCh = ']';
    } else {
        start = startObj;
        openCh = '{';
        closeCh = '}';
    }

    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === openCh) depth++;
        else if (ch === closeCh) {
            depth--;
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    return null;
}

function coerceAtField(v: unknown): string | undefined {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(',');
    return String(v);
}

/**
 * 兼容模型误输出的 JSON 协议，例如：
 * {"replies":[{"msg":"…"},{"react":{"emoji":"76","to":"last"}}]}
 */
function tryParseJsonReplies(raw: string, batch: SmartChatBufferEntry[]): AssistantAction[] | null {
    const candidate = extractJsonCandidate(raw);
    if (!candidate) return null;
    let data: unknown;
    try {
        data = JSON.parse(candidate);
    } catch {
        return null;
    }

    let items: unknown[] | null = null;
    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if (obj.shut_up === true || obj.silence === true || obj['闭嘴'] === true) {
            return [{ type: 'shut_up' }];
        }
        const list = obj.replies ?? obj.actions ?? obj.messages ?? obj.items;
        if (Array.isArray(list)) items = list;
        else if (typeof obj.msg === 'string' || typeof obj.text === 'string') items = [obj];
        else return null;
    } else {
        return null;
    }

    const actions: AssistantAction[] = [];
    for (const item of items) {
        if (actions.length >= MAX_ACTIONS) break;
        if (item == null) continue;
        if (typeof item === 'string') {
            pushMsg(actions, item);
            continue;
        }
        if (typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;

        if (row.shut_up === true || row.type === 'shut_up' || row['闭嘴'] === true) {
            actions.push({ type: 'shut_up' });
            continue;
        }

        // { "react": { "emoji": "76", "to": "last" } } 或扁平
        const reactObj =
            row.react && typeof row.react === 'object'
                ? (row.react as Record<string, unknown>)
                : row.type === 'react'
                  ? row
                  : null;
        if (reactObj) {
            const emojiId = isAllowedMsgEmojiId(
                reactObj.emoji ?? reactObj.emoji_id ?? reactObj.id ?? row.emoji,
            );
            if (!emojiId) continue;
            const target = reactObj.to ?? reactObj.target ?? reactObj.reply ?? reactObj.msg ?? 'last';
            actions.push({
                type: 'react',
                emojiId,
                messageId: resolveReplyId(target, batch),
            });
            continue;
        }

        const text =
            (typeof row.msg === 'string' && row.msg)
            || (typeof row.text === 'string' && row.text)
            || (typeof row.content === 'string' && row.content)
            || '';
        if (text || row.type === 'msg') {
            pushMsg(
                actions,
                text,
                coerceAtField(row.at ?? row.ats ?? row.qq),
                resolveReplyId(row.reply ?? row.reply_id ?? row.replyId, batch),
            );
        }
    }

    if (!actions.length) return null;
    const hasSpeak = actions.some((a) => a.type === 'msg' || a.type === 'react');
    if (hasSpeak) return actions.filter((a) => a.type !== 'shut_up');
    if (actions.every((a) => a.type === 'shut_up')) return [{ type: 'shut_up' }];
    return actions;
}

/** 闭嘴标签（含模型常见拼写错误 shr_up） */
const SILENCE_TAG_RE = /<\/?(?:shut_up|shr_up|shutup|闭嘴)\s*\/?>/i;
const SILENCE_TAG_GLOBAL_RE = /<\/?(?:shut_up|shr_up|shutup|闭嘴)\s*\/?>/gi;

function isSilenceToken(s: string): boolean {
    const t = String(s || '').trim();
    if (!t) return false;
    return (
        /^<\/?(?:shut_up|shr_up|shutup|闭嘴)\s*\/?>$/i.test(t)
        || /^<(?:shut_up|shr_up|shutup|闭嘴)\s*\/>$/i.test(t)
    );
}

/**
 * 抽出 <status>…</status>（联网前说明，不计行为）。
 * 返回剥离后的正文，避免最终轮重复发送。
 */
export function extractStatusTexts(raw: string): { statuses: string[]; rest: string } {
    const statuses: string[] = [];
    let rest = String(raw || '');
    rest = rest.replace(/<status\b[^>]*>([\s\S]*?)<\/status>/gi, (_m, inner) => {
        let t = stripChatMarkdown(String(inner || '').trim());
        if (t.length > MAX_BUBBLE_CHARS) t = t.slice(0, MAX_BUBBLE_CHARS) + '…';
        t = t.replace(/\[CQ:[^\]]*\]/gi, '').trim();
        if (t) statuses.push(t);
        return '';
    });
    return { statuses, rest: rest.trim() };
}

/**
 * 工具调用附带的「先说一句」：优先 <status>；否则短纯文本也可当作说明。
 */
export function inferToolPreambleTexts(raw: string): string[] {
    const { statuses, rest } = extractStatusTexts(raw);
    if (statuses.length) return statuses.slice(0, 2);
    const t = String(rest || '').trim();
    if (!t) return [];
    if (looksLikeToolMarkup(t)) return [];
    if (/<(?:msg|replies|react|shut_up|shr_up|闭嘴)\b/i.test(t)) return [];
    // 过长当作误塞的正文，不当 status
    if (t.length > 80) return [];
    return [t];
}

/**
 * 将模型单次输出解析为动作列表（文字气泡 / 贴表情 / 闭嘴）。
 * <status> 不在此计入；请先用 extractStatusTexts / inferToolPreambleTexts。
 */
export function parseAssistantActions(raw: string, batch: SmartChatBufferEntry[] = []): AssistantAction[] {
    const { rest } = extractStatusTexts(raw);
    const cleaned = stripCqAndFences(rest);
    if (!cleaned) return [];
    // 工具调用正文绝不当成群消息
    if (looksLikeToolMarkup(cleaned)) return [];

    {
        const hasSilenceTag = SILENCE_TAG_RE.test(cleaned);
        const hasMsgOrReact = /<(?:msg|react)\b/i.test(cleaned);
        if (isSilenceToken(cleaned) || (hasSilenceTag && !hasMsgOrReact)) {
            const onlySilence = cleaned
                .replace(SILENCE_TAG_GLOBAL_RE, '')
                .replace(/<\/?(?:replies)[^>]*>/gi, '')
                .trim();
            if (!onlySilence || isSilenceToken(cleaned) || (hasSilenceTag && !hasMsgOrReact)) {
                return [{ type: 'shut_up' }];
            }
        }
    }

    // 模型偶发输出 JSON 协议：优先吃掉，避免整段 JSON 当纯文本发出
    if (!/<(?:msg|react|replies|shut_up|shr_up|闭嘴)\b/i.test(cleaned)) {
        const fromJson = tryParseJsonReplies(cleaned, batch);
        if (fromJson?.length) return fromJson;
    }

    const wrap = cleaned.match(/<replies\b[^>]*>([\s\S]*?)<\/replies>/i);
    const scope = wrap ? wrap[1] : cleaned;
    const actions: AssistantAction[] = [];

    const tokenRe = /<(shut_up|shr_up|shutup|闭嘴)\s*\/>|<react\b([^>]*)\s*\/?>|<msg\b([^>]*)>([\s\S]*?)<\/msg>/gi;
    let m;
    while ((m = tokenRe.exec(scope)) && actions.length < MAX_ACTIONS) {
        const full = m[0];
        if (/^<(?:shut_up|shr_up|shutup|闭嘴)/i.test(full)) {
            actions.push({ type: 'shut_up' });
            continue;
        }
        if (/^<react/i.test(full)) {
            const attrs = parseAttrs(m[2] || '');
            const emojiId = isAllowedMsgEmojiId(attrs.emoji || attrs.emoji_id || attrs.id);
            if (!emojiId) continue;
            const target = attrs.to || attrs.target || attrs.reply || attrs.msg || 'last';
            actions.push({
                type: 'react',
                emojiId,
                messageId: resolveReplyId(target, batch),
            });
            continue;
        }
        const attrs = parseAttrs(m[3] || '');
        pushMsg(actions, m[4], attrs.at, resolveReplyId(attrs.reply, batch));
    }

    if (actions.length) {
        const hasSpeak = actions.some((a) => a.type === 'msg' || a.type === 'react');
        if (hasSpeak) return actions.filter((a) => a.type !== 'shut_up');
        if (actions.every((a) => a.type === 'shut_up')) return [{ type: 'shut_up' }];
        return actions;
    }

    // XML 未命中时再试一次 JSON（有人把 JSON 和说明混写）
    const fromJsonLate = tryParseJsonReplies(cleaned, batch);
    if (fromJsonLate?.length) return fromJsonLate;

    if (!/<(?:shut_up|shr_up|shutup|闭嘴|react|msg|replies)\b/i.test(cleaned)) {
        // 整段像 JSON replies 却解析失败：不要把原始 JSON 砸进群
        if (/"replies"\s*:/.test(cleaned) || /^\s*[\{\[]/.test(cleaned)) {
            return [];
        }
        pushMsg(actions, cleaned);
    }
    return actions;
}

export function parseAssistantReplies(raw: string, batch: SmartChatBufferEntry[] = []): ReplyBubble[] {
    return parseAssistantActions(raw, batch)
        .filter((a) => a.type === 'msg')
        .map((a) => ({ text: a.text, at: a.at, replyId: a.replyId }));
}

/**
 * 按行为限制裁剪动作；处理闭嘴开关与强制开口。
 *
 * shutUp（计入连续闭嘴）：
 * - 显式 <shut_up/>
 * - 仅贴表情、无文字气泡（纯表情回应也算闭嘴的一种）
 *
 * 强制开口时必须至少有一句文字；纯 react 不够。
 */
export function applyActionLimits(
    actions: AssistantAction[],
    opts: {
        actionMin: number;
        actionMax: number;
        silenceAllowed: boolean;
        mustSpeak: boolean;
        /** 强制去掉所有气泡引用（用户要求别引用 / 会话偏好） */
        stripReply?: boolean;
    },
): { actions: AssistantAction[]; shutUp: boolean } {
    const min = Math.max(0, Math.min(10, Number(opts.actionMin) || 0));
    let max = Math.max(0, Math.min(10, Number(opts.actionMax) || 0));
    if (max < min) max = min;
    if (max < 1) max = 1;

    const silenceAllowed = Boolean(opts.silenceAllowed) && min === 0;
    const mustSpeak = Boolean(opts.mustSpeak);

    let list = Array.isArray(actions) ? [...actions] : [];
    // status 不计行为，最终轮不应再执行；若混入则丢掉
    list = list.filter((a) => a.type !== 'status');
    if (opts.stripReply) {
        list = list.map((a) => (a.type === 'msg' ? { ...a, replyId: undefined } : a));
    }
    const hasMsg = list.some((a) => a.type === 'msg');
    const hasReact = list.some((a) => a.type === 'react');
    const wantsExplicitShutUp = list.some((a) => a.type === 'shut_up') && !hasMsg && !hasReact;
    const pureReactOnly = !hasMsg && hasReact;

    // 显式闭嘴
    if (wantsExplicitShutUp) {
        if (silenceAllowed && !mustSpeak) {
            return { actions: [], shutUp: true };
        }
        list = [{ type: 'msg', text: '……' }];
        return { actions: list, shutUp: false };
    }

    list = list.filter((a) => a.type !== 'shut_up');
    // 超上限截断；不靠宿主复制气泡凑下限（机械灌水），节奏由 system 引导
    if (list.length > max) list = list.slice(0, max);
    void min;

    // 纯贴表情 = 闭嘴变体：仍执行 react，但计入连续闭嘴
    if (pureReactOnly || (!hasMsg && list.every((a) => a.type === 'react'))) {
        const reacts = list.filter((a) => a.type === 'react');
        if (mustSpeak || !silenceAllowed) {
            // 强制开口 / 闭嘴关闭：保留贴表情并补一句文字
            const next = [...reacts];
            if (next.length >= max) next.pop();
            next.push({ type: 'msg', text: '……' });
            // 下限>1 时只保证「有文字」，不靠宿主灌水凑满 min
            return { actions: next.slice(0, max), shutUp: false };
        }
        return { actions: reacts.slice(0, max), shutUp: true };
    }

    if (list.length === 0) {
        if (silenceAllowed && !mustSpeak) {
            return { actions: [], shutUp: true };
        }
        list = [{ type: 'msg', text: '……' }];
    }

    // action_min：仅在「必须开口且已有文字」时作为软提醒由 system 处理；
    // 宿主不自动复制气泡凑数（会显得机械）。仍保证至少 1 条文字（上面已处理）。
    return { actions: list, shutUp: false };
}

/** 从 assistant XML 中剥掉 reply=，避免写入历史后继续教模型每句都引 */
export function stripReplyAttrsFromContent(raw: string): string {
    return String(raw || '').replace(/<msg(\b[^>]*)>/gi, (_full, attrs) => {
        const cleaned = String(attrs || '').replace(/\s*\breply\s*=\s*"[^"]*"/gi, '');
        return `<msg${cleaned}>`;
    });
}

export function sleep(ms: number): Promise<void> {
    const n = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => setTimeout(resolve, n));
}

export function nextReplyGapMs(baseMs: number): number {
    const base = Math.min(8000, Math.max(400, Number(baseMs) || 1200));
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(base * jitter);
}
