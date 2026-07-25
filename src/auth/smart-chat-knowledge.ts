// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 技能树 CRUD + 启用开关 + 顺序 Top-M
// ---------------------------------------------------------------------------
//
// 注入策略（Reasonix 回合尾）：
// - 只取 enabled !== false 的自定义技能
// - 按文件内顺序（全局在前，再群作用域）取前 Top-M 条
// - 挂在当前 user turn，不写进稳定 system 前缀 → 不破坏历史前缀缓存
// - 宿主技（钉楼/表情/沉默）固定进 system「技能树」，不占 Top-M
//
// 磁盘路径仍为 knowledge/（兼容旧数据）；对内对外文案统一叫技能树。

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
    return `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    if (prev && isBuiltinSkillId(prev.id)) {
        // 宿主技内容由代码刷新；允许改 enabled，禁止改写正文/标题覆盖
        const row: SmartChatKnowledgeEntry = {
            ...prev,
            enabled: entry.enabled !== undefined
                ? (entry.enabled !== false && entry.enabled !== 'false')
                : prev.enabled !== false,
            updated_at: now,
        };
        entries[idx] = row;
        saveEntries(deps, scope, entries);
        return row;
    }
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
    if (isBuiltinSkillId(id)) return false;
    const entries = loadEntries(deps, scope);
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) return false;
    saveEntries(deps, scope, next);
    return true;
}

/**
 * 加载已装备的自定义技能（按列表顺序取前 Top-M）。
 * 宿主技不进本列表（已挂稳定 system 技能树）。
 * topM ≤0 时不注入。
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

const BUILTIN_AT_REPLY_TITLE = '◆ 钉楼点名';
const BUILTIN_REACT_TITLE = '◆ 表情回应';
const BUILTIN_SHUT_UP_TITLE = '◆ 沉默控场';

/** 宿主技 id：进稳定 system 技能树，不占每轮自定义 Top-M */
export const BUILTIN_PROTOCOL_IDS = new Set([
    'kb_builtin_at_reply',
    'kb_builtin_react',
    'kb_builtin_shut_up',
]);

export function isBuiltinSkillId(id: unknown): boolean {
    return BUILTIN_PROTOCOL_IDS.has(String(id || '').trim());
}

function skillAtReplyBody(): string {
    return (
        '分支：社交 · 已点亮\n'
        + '释放：在 <msg> 上挂 at / reply（结构化标签，不是 CQ）。\n'
        + '- at="QQ"：点名；多人 at="111,222"\n'
        + '- reply="last|msgid"：顶住某条气泡（和艾特不是一回事）\n'
        + '入站：[msgid] 本条；[引用:…] 对方引用别人；[艾特:…] 对方艾特了谁。\n'
        + '耗蓝：多数发言不带；真要钉楼或点名再放。对方有偏好时听人话，别装不会。'
    );
}

function skillReactBody(): string {
    return (
        '分支：社交 · 已点亮 · 仅群聊\n'
        + '释放：<react emoji="ID" to="last|msgid"/> —— 给某条消息点表情，不是发一条表情消息。\n'
        + '可一次多放（多个 <react>，各算 1 行为）；可与 <msg> 同在 <replies>。\n'
        + '只有 react、没有文字 msg：也算沉默（仍会贴上）。\n'
        + '\n'
        + formatEmojiCatalogForKnowledge(48)
    );
}

function skillShutUpBody(): string {
    return (
        '分支：节奏 · 已点亮\n'
        + '释放：\n'
        + '1) <shut_up/>（或 <闭嘴/>）：不发消息、不贴表情\n'
        + '2) 只有 <react>、没有 <msg>：贴表情也算沉默\n'
        + '都会记入会话，并累计连续沉默。\n'
        + '条件：行为下限为 0 才可沉默；下限>0 时不要用。\n'
        + '沉默计数见 <host-state>；达限后至少一句文字。\n'
        + '每条 <msg>、每次 <react> 各算 1；显式沉默算 0。「本轮上限」是天花板不是配额。\n'
        + '话题与上次无关 + 闲聊/刷屏/别人互回：优先沉默，别硬拽旧话题。\n'
        + '有 <main-visit> 时接主访问；次访问只作背景，不必开口。'
    );
}

/**
 * 宿主技：固定挂 system，技能树文风。
 * 教「会什么 + 怎么放」；何时放由模型按群友判断。
 */
export const PROTOCOL_SYSTEM_SUFFIX =
    '\n\n[技能树 · 宿主技]\n' +
    '你已点亮下列技能。写法即释放方式；何时放由你按群友判断——别刷屏，也别装不会。\n' +
    '开口一律用 <replies> 包住 <msg>/<react>（不要裸文本、CQ、JSON）。\n' +
    '\n' +
    '◆ 钉楼点名\n' +
    '- 释放：<msg at="QQ">…</msg>（多人 at="111,222"）；<msg reply="last|msgid">…</msg>\n' +
    '- at=点名，reply=顶气泡，别和贴表情混\n' +
    '- [msgid] 本条；[引用:…] 对方引用别人\n' +
    '- 多数发言不带；真要钉楼/点名再放\n' +
    '\n' +
    '◆ 表情回应（仅群聊）\n' +
    '- 释放：<react emoji="ID" to="last|msgid"/> —— 点表情，不是发表情消息\n' +
    '- 可与 <msg> 同在 <replies>；只有 react 也算沉默\n' +
    '- 常用：76赞 / 201点赞 / 324吃糖 / 319比心 / 271吃瓜 / 268问号脸\n' +
    '\n' +
    '◆ 沉默控场\n' +
    '- 释放：<shut_up/>，或只有 react、没有 msg\n' +
    '- 行为下限为 0 才可沉默；计数见 host-state，达限须开口\n' +
    '- 话题与上次无关且只是闲聊刷屏：优先沉默\n' +
    '- 有 main-visit 接主访问；次访问不必开口\n';

function upsertBuiltin(
    entries: SmartChatKnowledgeEntry[],
    id: string,
    title: string,
    content: string,
    tags: string[],
    preferredIndex = 0,
): void {
    const idx = entries.findIndex((e) => e.id === id || e.title === title);
    if (idx >= 0) {
        const prev = entries[idx];
        if (prev.content === content && prev.title === title && prev.enabled !== false) return;
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
    // 旧标题迁移：同 id 已在上面；再扫一遍旧协议标题
    const legacyIdx = entries.findIndex((e) => e.id === id);
    if (legacyIdx >= 0) {
        const prev = entries[legacyIdx];
        entries[legacyIdx] = {
            ...prev,
            id,
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

/** 写入/刷新全局技能树：钉楼点名、表情回应、沉默控场 */
export function ensureBuiltinKnowledge(deps: SmartChatDeps): void {
    const entries = loadEntries(deps, 'global');
    const before = JSON.stringify(entries);

    // 清掉仍挂着旧「宿主协议」标题的残留（同 id 会在 upsert 覆盖）
    upsertBuiltin(
        entries,
        'kb_builtin_at_reply',
        BUILTIN_AT_REPLY_TITLE,
        skillAtReplyBody(),
        ['技能', '宿主技', '钉楼', '艾特', '引用'],
        0,
    );

    upsertBuiltin(
        entries,
        'kb_builtin_react',
        BUILTIN_REACT_TITLE,
        skillReactBody(),
        ['技能', '宿主技', '表情'],
        1,
    );

    upsertBuiltin(
        entries,
        'kb_builtin_shut_up',
        BUILTIN_SHUT_UP_TITLE,
        skillShutUpBody(),
        ['技能', '宿主技', '沉默'],
        2,
    );

    if (JSON.stringify(entries) !== before) {
        saveEntries(deps, 'global', entries);
    }
}
