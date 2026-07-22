// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 会话历史（Reasonix：prepend-only + 低频 compaction）
// ---------------------------------------------------------------------------
//
// 与 Reasonix SPEC §3.6 一致：
// - 两次 compaction 之间：消息只追加、且与 API 字节一致 → DeepSeek 前缀缓存可命中
// - compaction 是刻意的 cache-reset 点：把旧段折叠成一条永久 digest 消息写入列表
// - 绝不把 digest 每轮挂到 turn 尾（那会让「已存历史 ≠ 上次 API 内容」→ 整段 miss）
//
// 会话按「配置指纹」分目录存放：改 API Key / Base URL / 模型 / system prompt 等任一字段
 // → 新命名空间；改回完全一致配置 → 回到原会话。

import fs from 'fs';
import path from 'path';
import type { SmartChatConfig, SmartChatDeps, SmartChatSessionFile, SmartChatSessionMessage } from './smart-chat-types';
import { SMART_CHAT_LEGACY_ROOT, SMART_CHAT_ROOT } from './smart-chat-types';
import { loadSmartChatConfig } from './smart-chat-config';
import {
    fingerprintPreview,
    sessionConfigFingerprint,
} from './smart-chat-fingerprint';
import { presentImageSupplementsForModel } from './smart-chat-image';
import { extractStatusTexts } from './smart-chat-reply';

/** 文件内硬上限（归档前再 compact） */
const MAX_FILE_MESSAGES = 240;
/** 超过此条数触发低频 compaction（刻意 cache-reset） */
const COMPACT_MESSAGE_THRESHOLD = 100;
/** compaction 后保留的尾部消息数（verbatim） */
const COMPACT_KEEP_TAIL = 40;
/** digest 消息内容上限，避免单条过大 */
const DIGEST_MAX_CHARS = 6000;

const SESSIONS_ROOT = `${SMART_CHAT_ROOT}sessions/`;
const BY_CONFIG_ROOT = `${SESSIONS_ROOT}by-config/`;
const REGISTRY_FILE = `${BY_CONFIG_ROOT}_registry.json`;

let migratedFlatOnce = false;

function resolveFingerprint(deps: SmartChatDeps, cfg?: SmartChatConfig): string {
    return sessionConfigFingerprint(cfg || loadSmartChatConfig(deps));
}

function sessionRelPath(fp: string, chatId: string): string {
    return `${BY_CONFIG_ROOT}${fp}/${chatId}.json`;
}

function legacyFlatSessionPath(chatId: string): string {
    return `${SESSIONS_ROOT}${chatId}.json`;
}

function legacyDeepSeekPath(chatId: string): string {
    return `${SMART_CHAT_LEGACY_ROOT}DeepSeek/${chatId}.json`;
}

function absSessionsDir(deps: SmartChatDeps): string {
    return path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'sessions');
}

function absByConfigDir(deps: SmartChatDeps, fp: string): string {
    return path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'sessions', 'by-config', fp);
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface SessionRegistry {
    active: string;
    profiles: Record<string, {
        fingerprint: string;
        updated_at: string;
        model?: string;
        base_url?: string;
        session_files?: number;
    }>;
}

function loadRegistry(deps: SmartChatDeps): SessionRegistry {
    const raw = deps.readA(REGISTRY_FILE);
    if (!raw) return { active: '', profiles: {} };
    try {
        const obj = JSON.parse(raw);
        return {
            active: String(obj.active || ''),
            profiles: obj.profiles && typeof obj.profiles === 'object' ? obj.profiles : {},
        };
    } catch {
        return { active: '', profiles: {} };
    }
}

function saveRegistry(deps: SmartChatDeps, reg: SessionRegistry): void {
    deps.writeA(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

function touchRegistry(deps: SmartChatDeps, fp: string, cfg: SmartChatConfig): void {
    const reg = loadRegistry(deps);
    const dir = absByConfigDir(deps, fp);
    let count = 0;
    try {
        if (fs.existsSync(dir)) {
            count = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
        }
    } catch {
        count = 0;
    }
    reg.active = fp;
    reg.profiles[fp] = {
        fingerprint: fp,
        updated_at: new Date().toISOString(),
        model: cfg.model,
        base_url: cfg.base_url,
        session_files: count,
    };
    saveRegistry(deps, reg);
}

/**
 * 一次性：把旧版扁平 sessions/*.json 迁入当前配置指纹目录。
 * （这些历史默认归属「迁移当时的配置」。）
 */
function migrateFlatSessionsIfNeeded(deps: SmartChatDeps, fp: string): void {
    if (migratedFlatOnce) return;
    migratedFlatOnce = true;
    try {
        const root = absSessionsDir(deps);
        if (!fs.existsSync(root)) return;
        const flat = fs.readdirSync(root).filter((f) => f.endsWith('.json'));
        if (!flat.length) return;
        const dest = absByConfigDir(deps, fp);
        ensureDir(dest);
        for (const f of flat) {
            const src = path.join(root, f);
            const dst = path.join(dest, f);
            if (fs.existsSync(dst)) continue;
            try {
                fs.renameSync(src, dst);
            } catch {
                try {
                    fs.copyFileSync(src, dst);
                    fs.unlinkSync(src);
                } catch {
                    /* ignore */
                }
            }
        }
        deps.logger?.info?.(`[智能对话] 已将 ${flat.length} 个旧会话迁入配置命名空间 ${fingerprintPreview(fp)}`);
    } catch (e) {
        deps.logger?.warn?.('[智能对话] 扁平会话迁移失败:', e?.message || e);
    }
}

export function getActiveSessionNamespace(deps: SmartChatDeps, cfg?: SmartChatConfig): {
    fingerprint: string;
    preview: string;
    relDir: string;
} {
    const config = cfg || loadSmartChatConfig(deps);
    const fp = resolveFingerprint(deps, config);
    migrateFlatSessionsIfNeeded(deps, fp);
    ensureDir(absByConfigDir(deps, fp));
    touchRegistry(deps, fp, config);
    return {
        fingerprint: fp,
        preview: fingerprintPreview(fp),
        relDir: `${BY_CONFIG_ROOT}${fp}/`,
    };
}

function normalizeMessages(messages: unknown[]): SmartChatSessionMessage[] {
    return (messages || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: String(m.content) }));
}

/** 瘦身历史：压缩识图补充并改写成 [眼睛]、剥掉误写入的 <status>，保持前后一致 */
function slimSessionMessagesInPlace(session: SmartChatSessionFile): boolean {
    let changed = false;
    const next = (session.messages || []).map((m) => {
        let content = String(m.content || '');
        if (m.role === 'user') {
            const c = presentImageSupplementsForModel(content);
            if (c !== content) {
                changed = true;
                content = c;
            }
        } else if (m.role === 'assistant') {
            const { rest } = extractStatusTexts(content);
            const c = rest || content;
            if (c !== content) {
                changed = true;
                content = c;
            }
        }
        return { role: m.role, content };
    });
    if (changed) session.messages = next;
    return changed;
}

function parseSessionRaw(raw: string | false): SmartChatSessionFile {
    if (!raw) return { messages: [] };
    try {
        const obj = JSON.parse(raw);
        const streak = Number(obj?.shut_up_streak);
        const session: SmartChatSessionFile = {
            messages: normalizeMessages(Array.isArray(obj?.messages) ? obj.messages : []),
            summary: typeof obj.summary === 'string' ? obj.summary : undefined,
            compacted_at: typeof obj.compacted_at === 'string' ? obj.compacted_at : undefined,
            shut_up_streak: Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0,
            prefer_no_reply: Boolean(obj?.prefer_no_reply),
        };
        migrateLegacySummaryIntoMessages(session);
        return session;
    } catch {
        return { messages: [] };
    }
}

/**
 * 旧数据：summary 很大且 messages 已是 compact 后的尾巴。
 * 若 messages 开头还没有 compaction-summary，则插入一次，并清空 summary。
 */
function migrateLegacySummaryIntoMessages(session: SmartChatSessionFile): void {
    const summary = String(session.summary || '').trim();
    if (!summary) return;
    const first = session.messages[0]?.content || '';
    if (first.includes('<compaction-summary>')) {
        delete session.summary;
        return;
    }
    let digest = summary;
    if (digest.length > DIGEST_MAX_CHARS) digest = digest.slice(-DIGEST_MAX_CHARS);
    session.messages = [
        { role: 'user', content: `<compaction-summary>\n${digest}\n</compaction-summary>` },
        ...session.messages,
    ];
    delete session.summary;
}

export function loadSession(deps: SmartChatDeps, chatId: string, cfg?: SmartChatConfig): SmartChatSessionFile {
    const ns = getActiveSessionNamespace(deps, cfg);
    let raw = deps.readA(sessionRelPath(ns.fingerprint, chatId));
    // 兼容：尚未迁走的扁平文件 / 更旧 DeepSeek 目录（只读一次，写入时进指纹目录）
    if (!raw) raw = deps.readA(legacyFlatSessionPath(chatId));
    if (!raw) raw = deps.readA(legacyDeepSeekPath(chatId));
    const session = parseSessionRaw(raw);
    if (slimSessionMessagesInPlace(session) && raw) {
        try {
            saveSession(deps, chatId, session, cfg);
        } catch {
            /* ignore rewrite failures */
        }
    }
    return session;
}

export function saveSession(deps: SmartChatDeps, chatId: string, session: SmartChatSessionFile, cfg?: SmartChatConfig): void {
    const ns = getActiveSessionNamespace(deps, cfg);
    let messages = session.messages || [];
    if (messages.length > MAX_FILE_MESSAGES) {
        maybeCompactSession(session);
        messages = session.messages || [];
    }
    const toSave = { ...session, messages, config_fingerprint: ns.fingerprint };
    if (!toSave.summary) delete toSave.summary;
    deps.writeA(sessionRelPath(ns.fingerprint, chatId), JSON.stringify(toSave, null, 2));
    touchRegistry(deps, ns.fingerprint, cfg || loadSmartChatConfig(deps));
}

/**
 * Reasonix prepend-only：整段已确认对话原样进入 API messages，不做「历史轮数」滑动截断。
 */
export function getPrependOnlyMessages(session: SmartChatSessionFile): SmartChatSessionMessage[] {
    return [...(session.messages || [])];
}

/**
 * 按「访问轮次」截取历史（不含本轮待发消息）。
 * rounds≤0：全部；否则从尾部取最近 rounds 条 user 消息及其后内容。
 */
export function sliceMessagesByRounds(
    messages: Array<{ role: string; content: string }>,
    rounds: number,
): Array<{ role: string; content: string }> {
    const list = Array.isArray(messages) ? messages : [];
    const n = Number(rounds);
    if (!Number.isFinite(n) || n <= 0) return list;
    const want = Math.min(999, Math.max(1, Math.floor(n)));
    let userCount = 0;
    let start = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.role === 'user') {
            userCount += 1;
            if (userCount >= want) {
                start = i;
                break;
            }
        }
    }
    return list.slice(start);
}

function buildDigestContent(dropped: SmartChatSessionMessage[]): string {
    const userParts: string[] = [];
    const assistantParts: string[] = [];
    for (const m of dropped) {
        if (m.role === 'user') {
            const c = m.content;
            userParts.push(c.length > 800 ? `${c.slice(0, 400)}\n…\n${c.slice(-200)}` : c);
        } else if (m.role === 'assistant') {
            assistantParts.push(m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content);
        }
    }
    let body =
        `[compact ${new Date().toISOString()}]\n`
        + `<digest-users>\n${userParts.join('\n---\n')}\n</digest-users>\n`
        + `<digest-assistants>\n${assistantParts.join('\n---\n')}\n</digest-assistants>`;
    if (body.length > DIGEST_MAX_CHARS) body = body.slice(-DIGEST_MAX_CHARS);
    return `<compaction-summary>\n${body}\n</compaction-summary>`;
}

function maybeCompactSession(session: SmartChatSessionFile): void {
    if (session.messages.length < COMPACT_MESSAGE_THRESHOLD) return;

    const keep = COMPACT_KEEP_TAIL;
    const dropped = session.messages.slice(0, session.messages.length - keep);
    if (!dropped.length) return;

    const digestMsg: SmartChatSessionMessage = {
        role: 'user',
        content: buildDigestContent(dropped),
    };

    session.messages = [digestMsg, ...session.messages.slice(-keep)];
    session.compacted_at = new Date().toISOString();
    delete session.summary;
}

export function appendSessionTurn(
    deps: SmartChatDeps,
    chatId: string,
    userContentExact: string,
    assistantContent: string,
    cfg?: SmartChatConfig,
    opts?: { shutUp?: boolean; preferNoReply?: boolean },
): SmartChatSessionFile {
    const session = loadSession(deps, chatId, cfg);
    session.messages.push({ role: 'user', content: userContentExact });
    session.messages.push({ role: 'assistant', content: assistantContent });
    if (opts?.shutUp) {
        session.shut_up_streak = Math.max(0, Number(session.shut_up_streak) || 0) + 1;
    } else {
        session.shut_up_streak = 0;
    }
    if (opts?.preferNoReply != null) {
        session.prefer_no_reply = Boolean(opts.preferNoReply);
    }
    maybeCompactSession(session);
    saveSession(deps, chatId, session, cfg);
    return session;
}

export function clearSession(deps: SmartChatDeps, chatId: string, cfg?: SmartChatConfig): void {
    const ns = getActiveSessionNamespace(deps, cfg);
    deps.writeA(
        sessionRelPath(ns.fingerprint, chatId),
        JSON.stringify({ messages: [], shut_up_streak: 0, prefer_no_reply: false, config_fingerprint: ns.fingerprint }, null, 2),
    );
}

export function listSessionIds(deps: SmartChatDeps, cfg?: SmartChatConfig): string[] {
    const ns = getActiveSessionNamespace(deps, cfg);
    const dir = absByConfigDir(deps, ns.fingerprint);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export function listSessionNamespaces(deps: SmartChatDeps): {
    active: string;
    activePreview: string;
    profiles: Array<{ fingerprint: string; preview: string; model?: string; base_url?: string; updated_at?: string; session_files?: number }>;
} {
    const ns = getActiveSessionNamespace(deps);
    const reg = loadRegistry(deps);
    const profiles = Object.values(reg.profiles || {}).map((p) => ({
        fingerprint: p.fingerprint,
        preview: fingerprintPreview(p.fingerprint),
        model: p.model,
        base_url: p.base_url,
        updated_at: p.updated_at,
        session_files: p.session_files,
    }));
    // 也扫描磁盘上其它指纹目录
    try {
        const root = path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'sessions', 'by-config');
        if (fs.existsSync(root)) {
            for (const name of fs.readdirSync(root)) {
                if (name.startsWith('_') || name.startsWith('.')) continue;
                const full = path.join(root, name);
                if (!fs.statSync(full).isDirectory()) continue;
                if (profiles.some((p) => p.fingerprint === name)) continue;
                const count = fs.readdirSync(full).filter((f) => f.endsWith('.json')).length;
                profiles.push({
                    fingerprint: name,
                    preview: fingerprintPreview(name),
                    session_files: count,
                });
            }
        }
    } catch {
        /* ignore */
    }
    profiles.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return {
        active: ns.fingerprint,
        activePreview: ns.preview,
        profiles,
    };
}
