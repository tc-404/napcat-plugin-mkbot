// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 知识库 CRUD + 启用开关 + 顺序 Top-M
// ---------------------------------------------------------------------------
//
// 注入策略（Reasonix 回合尾）：
 // - 只取 enabled !== false 的条目
 // - 按文件内顺序（全局在前，再群作用域）取前 Top-M 条
 // - 挂在当前 user turn，不写进稳定 system 前缀 → 不破坏历史前缀缓存

import fs from 'fs';
import path from 'path';
import type { SmartChatDeps, SmartChatKnowledgeEntry } from './smart-chat-types';
import { SMART_CHAT_ROOT } from './smart-chat-types';
import { formatEmojiCatalogForKnowledge } from './smart-chat-emoji';

function knowledgePath(scope: string): string {
    const safe = scope === 'global' ? 'global' : String(scope).replace(/[^\d]/g, '');
    return `${SMART_CHAT_ROOT}knowledge/${safe}.json`;
}

function normalizeEntry(raw: Partial<SmartChatKnowledgeEntry> | null | undefined): SmartChatKnowledgeEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const title = String(raw.title || '').trim();
    const content = String(raw.content || '').trim();
    if (!id || !title || !content) return null;
    return {
        id,
        title,
        content,
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
        enabled: raw.enabled !== false && raw.enabled !== 'false',
    };
}

function loadEntries(deps: SmartChatDeps, scope: string): SmartChatKnowledgeEntry[] {
    const raw = deps.readA(knowledgePath(scope));
    if (!raw) return [];
    try {
        const obj = JSON.parse(raw);
        const list = Array.isArray(obj?.entries) ? obj.entries : [];
        return list.map(normalizeEntry).filter(Boolean);
    } catch {
        return [];
    }
}

function saveEntries(deps: SmartChatDeps, scope: string, entries: SmartChatKnowledgeEntry[]): void {
    deps.writeA(knowledgePath(scope), JSON.stringify({ entries }, null, 2));
}

function genId(): string {
    return `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 列表按文件内顺序（即启用加载顺序） */
export function listKnowledge(deps: SmartChatDeps, scope = 'global'): SmartChatKnowledgeEntry[] {
    return loadEntries(deps, scope);
}

export function upsertKnowledge(
    deps: SmartChatDeps,
    scope: string,
    entry: Partial<SmartChatKnowledgeEntry> & { title: string; content: string },
): SmartChatKnowledgeEntry {
    const entries = loadEntries(deps, scope);
    const now = new Date().toISOString();
    let idx = -1;
    if (entry.id) idx = entries.findIndex((e) => e.id === entry.id);
    const prev = idx >= 0 ? entries[idx] : null;
    const row: SmartChatKnowledgeEntry = {
        id: entry.id && idx >= 0 ? entry.id : (entry.id ? String(entry.id) : genId()),
        title: String(entry.title || '').trim(),
        content: String(entry.content || '').trim(),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : (prev?.tags || []),
        updated_at: now,
        enabled: entry.enabled !== undefined
            ? (entry.enabled !== false && entry.enabled !== 'false')
            : (prev ? prev.enabled !== false : true),
    };
    if (idx >= 0) entries[idx] = row;
    else entries.push(row);
    saveEntries(deps, scope, entries);
    return row;
}

export function setKnowledgeEnabled(
    deps: SmartChatDeps,
    scope: string,
    id: string,
    enabled: boolean,
): SmartChatKnowledgeEntry | null {
    const entries = loadEntries(deps, scope);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    entries[idx] = {
        ...entries[idx],
        enabled: Boolean(enabled),
        updated_at: new Date().toISOString(),
    };
    saveEntries(deps, scope, entries);
    return entries[idx];
}

export function deleteKnowledge(deps: SmartChatDeps, scope: string, id: string): boolean {
    const entries = loadEntries(deps, scope);
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) return false;
    saveEntries(deps, scope, next);
    return true;
}

/**
 * 加载已开启的自定义知识（按列表顺序取前 Top-M）。
 * 内置协议条目不进本列表（已挂稳定 system）。
 * topM ≤0 时不注入任何知识。
 */
export function searchKnowledgeTopM(
    deps: SmartChatDeps,
    _query: string,
    groupId: string | null,
    topM: number,
): SmartChatKnowledgeEntry[] {
    if (topM <= 0) return [];
    const scopes = ['global'];
    if (groupId) scopes.push(String(groupId));
    const merged: SmartChatKnowledgeEntry[] = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
        for (const e of loadEntries(deps, scope)) {
            if (e.enabled === false) continue;
            if (BUILTIN_PROTOCOL_IDS.has(e.id)) continue;
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            merged.push(e);
        }
    }
    return merged.slice(0, Math.max(0, Math.floor(Number(topM) || 0)));
}

export function listKnowledgeScopes(deps: SmartChatDeps): string[] {
    const dir = path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'knowledge');
    if (!fs.existsSync(dir)) return ['global'];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const scopes = files.map((f) => f.replace(/\.json$/, ''));
    if (!scopes.includes('global')) scopes.unshift('global');
    return scopes;
}

const BUILTIN_AT_REPLY_TITLE = '何时艾特与引用（宿主协议）';
const BUILTIN_REACT_TITLE = '群聊贴小表情（宿主协议）';
const BUILTIN_SHUT_UP_TITLE = '闭嘴与行为限制（宿主协议）';

/** 内置协议条目 id：进稳定 system，不占每轮 knowledge Top-M */
export const BUILTIN_PROTOCOL_IDS = new Set([
    'kb_builtin_at_reply',
    'kb_builtin_react',
    'kb_builtin_shut_up',
]);

/**
 * 艾特 / 引用 / 贴表情 / 闭嘴：固定挂 system。
 * 教「会什么 + 怎么用」；何时用由模型按群友判断，宿主不按关键词点名强制。
 */
export const PROTOCOL_SYSTEM_SUFFIX =
    '\n\n[宿主能力]\n' +
    '结构化标签（不是 CQ）。想点名就 at，想钉某条就 reply，想表态就 react；默认纯文本就够，别句句带 reply/at。\n' +
    '- 艾特：<msg at="QQ号">…</msg>（多人 at="111,222"）\n' +
    '- 引用：<msg reply="last|msgid">…</msg>。[msgid] 本条；[引用:…] 是对方引用别人\n' +
    '- 贴表情（群聊）：<react emoji="ID" to="last|msgid"/>\n' +
    '- 沉默：<shut_up/>，或只有 react\n';

function upsertBuiltin(
    entries: SmartChatKnowledgeEntry[],
    id: string,
    title: string,
    content: string,
    tags: string[],
    preferredIndex = 0,
): void {
    const idx = entries.findIndex((e) => e.title === title || e.id === id);
    if (idx >= 0) {
        const prev = entries[idx];
        if (prev.content === content && prev.enabled !== false) return;
        entries[idx] = {
            ...prev,
            id: prev.id || id,
            title,
            content,
            tags,
            enabled: prev.enabled !== false,
            updated_at: new Date().toISOString(),
        };
        return;
    }
    const row: SmartChatKnowledgeEntry = {
        id,
        title,
        content,
        tags,
        enabled: true,
        updated_at: new Date().toISOString(),
    };
    const at = Math.max(0, Math.min(Number(preferredIndex) || 0, entries.length));
    entries.splice(at, 0, row);
}

/** 写入/刷新全局知识库：艾特/引用、贴表情、闭嘴 */
export function ensureBuiltinKnowledge(deps: SmartChatDeps): void {
    const entries = loadEntries(deps, 'global');
    const before = JSON.stringify(entries);

    upsertBuiltin(
        entries,
        'kb_builtin_at_reply',
        BUILTIN_AT_REPLY_TITLE,
        '宿主用结构化标签发真实艾特/引用，不要输出 CQ 码。\n'
            + '\n'
            + '三种能力别混：\n'
            + '- 艾特 at=\"QQ\"：点名（可多人 at=\"111,222\"）\n'
            + '- 引用 reply=\"…\"：顶住某条气泡（QQ「回复」），和艾特不是一回事\n'
            + '- 贴表情 <react>：给某条消息点表情\n'
            + '\n'
            + '写法：每条 <msg> 可自带或不带 reply；reply=\"last\" 或上下文里的 msgid（看 [msgid:…]，别编造）；一条 <msg> 最多一个 reply。\n'
            + '入站：[msgid] 是本条 id；[引用:…] 是对方引用了别人；[艾特:…] 是对方艾特了谁。\n'
            + '怎么用：多数发言不带 reply/at，真要钉楼或点名再加；对方有偏好时听人话。别假装做不到。',
        ['协议', '艾特', '引用'],
        0,
    );

    upsertBuiltin(
        entries,
        'kb_builtin_react',
        BUILTIN_REACT_TITLE,
        '贴小表情 = 给某条群消息点表情回应，不是发一条表情消息。\n'
            + '仅群聊可用；宿主会单独调用贴表情接口。\n'
            + '\n'
            + '写法：<react emoji="324" to="last"/> 或 to="消息ID"\n'
            + '可一次对多条消息贴表情：写多个 <react .../>（各自算 1 个行为）。\n'
            + '可与 <msg> 混在同一 <replies> 里。\n'
            + '若本轮只有贴表情、没有任何文字 <msg>，也算闭嘴（仍会贴上表情）。\n'
            + '\n'
            + formatEmojiCatalogForKnowledge(48),
        ['协议', '贴表情', '群聊'],
        1,
    );

    upsertBuiltin(
        entries,
        'kb_builtin_shut_up',
        BUILTIN_SHUT_UP_TITLE,
        '沉默时可用：\n'
            + '1) 整段 <shut_up/>（或 <闭嘴/>）：不发消息、不贴表情\n'
            + '2) 只有 <react>、没有 <msg>：会贴表情，也算沉默\n'
            + '都会记入会话，并累计连续沉默次数。\n'
            + '\n'
            + '行为下限为 0 时才允许沉默；下限>0 时不要用。\n'
            + '连续沉默有上限（见 <host-state> 沉默计数）；达限后至少一句文字。\n'
            + '行为数：每条 <msg>、每次 <react> 各算 1；显式沉默算 0。范围与「本轮上限」见 <host-state>。',
        ['协议', '闭嘴', '行为限制'],
        2,
    );

    if (JSON.stringify(entries) !== before) {
        saveEntries(deps, 'global', entries);
    }
}
