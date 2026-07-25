// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 WebUI API
// ---------------------------------------------------------------------------

import type { SmartChatConfig, SmartChatDeps } from './smart-chat-types';
import {
    configForWeb,
    loadSmartChatConfig,
    normalizeSmartChatConfig,
    saveSmartChatConfig,
} from './smart-chat-config';
import { clearChatBuffer, loadChatBuffer } from './smart-chat-buffer';
import { clearSession, getActiveSessionNamespace, listSessionIds, listSessionNamespaces, loadSession } from './smart-chat-session';
import {
    deleteKnowledge,
    isBuiltinSkillId,
    listKnowledge,
    listKnowledgeScopes,
    setKnowledgeEnabled,
    upsertKnowledge,
} from './smart-chat-knowledge';
import { clearBalanceCache, clearUsageLedger, fetchBalance, getUsageSummary, testConnection, bindNvidiaRateDeps } from './smart-chat-billing';
import {
    bulkSetSmartChatEnabled,
    getSmartChatFriendRounds,
    getSmartChatGroupRounds,
    isSmartChatAiOnlyFriend,
    isSmartChatAiOnlyGroup,
    isSmartChatFriendEnabled,
    isSmartChatGroupEnabled,
    isSmartChatImageFriend,
    isSmartChatImageGroup,
    listSmartChatSwitchMap,
    normalizeSmartChatRounds,
    setSmartChatAiOnlyFriend,
    setSmartChatAiOnlyGroup,
    setSmartChatFriendEnabled,
    setSmartChatFriendRounds,
    setSmartChatGroupEnabled,
    setSmartChatGroupRounds,
    setSmartChatImageFriend,
    setSmartChatImageGroup,
} from './smart-chat-switches';
import {
    WEB_SEARCH_PROVIDER_META,
    listConfiguredProviders,
    testWebSearchProvider,
    type WebSearchProviderId,
} from './smart-chat-tools';


function readForceFlag(req: { query?: Record<string, unknown>; raw?: { originalUrl?: string; url?: string }; url?: string }): boolean {
    const q = req?.query || {};
    if (String(q.force || q.refresh || '') === '1' || String(q.force || '').toLowerCase() === 'true') {
        return true;
    }
    const rawUrl = String(req?.raw?.originalUrl || req?.raw?.url || req?.url || '');
    try {
        const qs = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';
        const params = new URLSearchParams(qs);
        const v = params.get('force') || params.get('refresh') || '';
        return v === '1' || v.toLowerCase() === 'true';
    } catch {
        return false;
    }
}

async function parsePostBody(req: { body?: unknown; on?: (ev: string, fn: (...args: unknown[]) => void) => void }) {
    let body = req.body;
    if (!body || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
        try {
            const raw = await new Promise<string>((resolve) => {
                let data = '';
                req.on?.('data', (chunk: Buffer | string) => { data += chunk; });
                req.on?.('end', () => resolve(data));
            });
            if (raw) body = JSON.parse(raw);
        } catch {
            body = {};
        }
    }
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function mergeConfigFromBody(current: SmartChatConfig, body: Record<string, unknown>): SmartChatConfig {
    const next = { ...current };
    if (body.vendor != null) next.vendor = String(body.vendor) as SmartChatConfig['vendor'];
    if (body.base_url != null) next.base_url = String(body.base_url);
    if (body.balance_url != null) next.balance_url = String(body.balance_url);
    if (body.model != null) next.model = String(body.model); // normalizeSmartChatConfig 按厂商白名单收敛
    if (body.temperature != null) next.temperature = Number(body.temperature);
    if (body.max_tokens != null) next.max_tokens = Number(body.max_tokens);
    if (body.debounce_ms != null) next.debounce_ms = Number(body.debounce_ms);
    if (body.max_batch != null) next.max_batch = Number(body.max_batch);
    if (body.kb_top_m != null) next.kb_top_m = Number(body.kb_top_m);
    if (body.reply_gap_ms != null) next.reply_gap_ms = Number(body.reply_gap_ms);
    if (body.system_prompt != null) next.system_prompt = String(body.system_prompt);
    if (body.shut_up_limit != null) next.shut_up_limit = Number(body.shut_up_limit);
    if (body.action_min != null) next.action_min = Number(body.action_min);
    if (body.action_max != null) next.action_max = Number(body.action_max);
    if (body.price_prompt_per_million != null) next.price_prompt_per_million = Number(body.price_prompt_per_million);
    if (body.price_completion_per_million != null) next.price_completion_per_million = Number(body.price_completion_per_million);
    if (body.private_chat_enabled != null) {
        next.private_chat_enabled = body.private_chat_enabled === true || body.private_chat_enabled === 'true';
    }
    if (body.tools_enabled != null) {
        next.tools_enabled = body.tools_enabled === true || body.tools_enabled === 'true' || body.tools_enabled === 1;
    }
    if (body.tools_max_rounds != null) next.tools_max_rounds = Number(body.tools_max_rounds);
    if (body.image_recognize != null && typeof body.image_recognize === 'object') {
        next.image_recognize = {
            ...(next.image_recognize || {}),
            ...(body.image_recognize as SmartChatConfig['image_recognize']),
        };
    }
    if (body.web_search != null && typeof body.web_search === 'object') {
        const ws = { ...(next.web_search || {}) };
        const incoming = body.web_search as Record<string, unknown>;
        const applyKey = (field: string) => {
            if (incoming[field] == null) return;
            const v = String(incoming[field] ?? '').trim();
            if (!v || v.includes('…')) return; // 脱敏占位不覆盖
            ws[field] = v;
        };
        applyKey('tavily_key');
        applyKey('serper_key');
        applyKey('bocha_key');
        // 显式清空
        for (const field of ['tavily_key', 'serper_key', 'bocha_key'] as const) {
            if (incoming[`clear_${field}`] === true || incoming[`clear_${field}`] === 'true') {
                ws[field] = '';
            }
        }
        next.web_search = ws;
    }
    const newKey = String(body.api_key ?? '').trim();
    if (newKey && !newKey.includes('…')) {
        next.api_key = newKey;
    }
    return normalizeSmartChatConfig(next);
}

export function registerSmartChatWebGetRoutes(
    base: { get: (path: string, handler: (...args: unknown[]) => unknown) => void },
    wrapPath: (p: string) => string,
    deps: SmartChatDeps,
    logger?: { error?: (...args: unknown[]) => void },
) {
    bindNvidiaRateDeps(deps);
    base.get(wrapPath('/smart-chat/config'), (_req, res) => {
        try {
            res.json({ code: 0, data: configForWeb(loadSmartChatConfig(deps)) });
        } catch (e) {
            logger?.error?.('获取智能对话配置失败:', e);
            res.status(500).json({ code: -1, message: '获取智能对话配置失败' });
        }
    });

    base.get(wrapPath('/smart-chat/usage'), (_req, res) => {
        try {
            res.json({ code: 0, data: getUsageSummary(deps) });
        } catch (e) {
            logger?.error?.('获取智能对话用量失败:', e);
            res.status(500).json({ code: -1, message: '获取智能对话用量失败' });
        }
    });

    base.get(wrapPath('/smart-chat/balance'), async (req, res) => {
        try {
            const force = readForceFlag(req);
            if (force) clearBalanceCache();
            const cfg = loadSmartChatConfig(deps);
            const data = await fetchBalance(cfg, force, deps);
            try {
                res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate');
            } catch {
                /* ignore */
            }
            res.json({ code: 0, data: { ...data, forced: force } });
        } catch (e) {
            logger?.error?.('获取智能对话余额失败:', e);
            res.status(500).json({ code: -1, message: '获取智能对话余额失败' });
        }
    });

    base.get(wrapPath('/smart-chat/knowledge'), (req, res) => {
        try {
            const scope = String(req?.query?.scope || 'global');
            const entries = listKnowledge(deps, scope).map((e) => ({
                ...e,
                builtin: isBuiltinSkillId(e.id),
            }));
            res.json({ code: 0, data: { scope, entries, scopes: listKnowledgeScopes(deps) } });
        } catch (e) {
            logger?.error?.('获取技能树失败:', e);
            res.status(500).json({ code: -1, message: '获取技能树失败' });
        }
    });

    base.get(wrapPath('/smart-chat/sessions'), (_req, res) => {
        try {
            const cfg = loadSmartChatConfig(deps);
            const ns = getActiveSessionNamespace(deps, cfg);
            const namespaces = listSessionNamespaces(deps);
            const ids = listSessionIds(deps, cfg);
            const list = ids.map((id) => {
                const s = loadSession(deps, id, cfg);
                return {
                    chatId: id,
                    messageCount: s.messages.length,
                    hasSummary: Boolean(s.summary || (s.messages[0]?.content || '').includes('<compaction-summary>')),
                    config_fingerprint: ns.fingerprint,
                };
            });
            res.json({
                code: 0,
                data: {
                    list,
                    namespace: {
                        fingerprint: ns.fingerprint,
                        preview: ns.preview,
                        profiles: namespaces.profiles,
                        profile_count: namespaces.profiles.length,
                    },
                },
            });
        } catch (e) {
            logger?.error?.('获取会话列表失败:', e);
            res.status(500).json({ code: -1, message: '获取会话列表失败' });
        }
    });

    base.get(wrapPath('/smart-chat/session'), (req, res) => {
        try {
            const chatId = String(req?.query?.chatId || '').trim();
            if (!chatId) {
                res.status(400).json({ code: -1, message: 'missing_chatId' });
                return;
            }
            const session = loadSession(deps, chatId);
            const buffer = loadChatBuffer(deps, chatId);
            res.json({ code: 0, data: { chatId, session, bufferPending: buffer.length } });
        } catch (e) {
            logger?.error?.('获取会话详情失败:', e);
            res.status(500).json({ code: -1, message: '获取会话详情失败' });
        }
    });

    base.get(wrapPath('/smart-chat/web-search/status'), (_req, res) => {
        try {
            const cfg = loadSmartChatConfig(deps);
            const configured = listConfiguredProviders(cfg.web_search);
            const providers = (Object.keys(WEB_SEARCH_PROVIDER_META) as WebSearchProviderId[]).map((id) => ({
                id,
                ...WEB_SEARCH_PROVIDER_META[id],
                configured: configured.includes(id),
            }));
            res.json({
                code: 0,
                data: {
                    tools_enabled: Boolean(cfg.tools_enabled),
                    tools_max_rounds: cfg.tools_max_rounds,
                    web_search_ready: configured.length > 0,
                    configured,
                    providers,
                },
            });
        } catch (e) {
            logger?.error?.('获取联网搜索状态失败:', e);
            res.status(500).json({ code: -1, message: '获取联网搜索状态失败' });
        }
    });

    base.get(wrapPath('/smart-chat/switches'), (req, res) => {
        try {
            const type = String(req?.query?.type || 'group') === 'friend' ? 'friend' : 'group';
            const idsRaw = String(req?.query?.ids || '').trim();
            const ids = idsRaw
                ? idsRaw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
                : Object.keys(listSmartChatSwitchMap(deps, type));
            const map: Record<string, { enabled: boolean; ai_only: boolean; rounds: number; image_recognize: boolean }> = {};
            for (const id of ids) {
                if (type === 'group') {
                    map[id] = {
                        enabled: isSmartChatGroupEnabled(deps, id),
                        ai_only: isSmartChatAiOnlyGroup(deps, id),
                        rounds: getSmartChatGroupRounds(deps, id),
                        image_recognize: isSmartChatImageGroup(deps, id),
                    };
                } else {
                    map[id] = {
                        enabled: isSmartChatFriendEnabled(deps, id),
                        ai_only: isSmartChatAiOnlyFriend(deps, id),
                        rounds: getSmartChatFriendRounds(deps, id),
                        image_recognize: isSmartChatImageFriend(deps, id),
                    };
                }
            }
            res.json({ code: 0, data: { type, map } });
        } catch (e) {
            logger?.error?.('获取智能对话开关失败:', e);
            res.status(500).json({ code: -1, message: '获取智能对话开关失败' });
        }
    });
}

export function registerSmartChatWebPostRoutes(
    base: { post: (path: string, handler: (...args: unknown[]) => unknown) => void },
    wrapPath: (p: string) => string,
    deps: SmartChatDeps,
    logger?: { error?: (...args: unknown[]) => void },
) {
    bindNvidiaRateDeps(deps);
    base.post(wrapPath('/smart-chat/config'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const current = loadSmartChatConfig(deps);
            const merged = mergeConfigFromBody(current, body);
            const saveMeta = saveSmartChatConfig(deps, merged);
            const web = configForWeb(merged);
            res.json({
                code: 0,
                data: {
                    ...web,
                    fingerprint_changed: saveMeta.fingerprintChanged,
                    previous_fingerprint: saveMeta.previousFingerprint,
                },
            });
        } catch (e) {
            logger?.error?.('保存智能对话配置失败:', e);
            res.status(500).json({ code: -1, message: '保存智能对话配置失败' });
        }
    });

    base.post(wrapPath('/smart-chat/test'), async (_req, res) => {
        try {
            const cfg = loadSmartChatConfig(deps);
            const r = await testConnection(cfg, deps);
            res.json({ code: r.ok ? 0 : -1, data: r });
        } catch (e) {
            logger?.error?.('智能对话连通性测试失败:', e);
            res.status(500).json({ code: -1, message: '智能对话连通性测试失败' });
        }
    });

    base.post(wrapPath('/smart-chat/knowledge/upsert'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const scope = String(body.scope || 'global');
            const title = String(body.title || '').trim();
            const content = String(body.content || '').trim();
            if (!title || !content) {
                res.status(400).json({ code: -1, message: 'title_and_content_required' });
                return;
            }
            const entry = upsertKnowledge(deps, scope, {
                id: body.id ? String(body.id) : undefined,
                title,
                content,
                tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
                enabled: body.enabled !== undefined ? body.enabled !== false && body.enabled !== 'false' : undefined,
            });
            res.json({ code: 0, data: entry });
        } catch (e) {
            logger?.error?.('保存技能失败:', e);
            res.status(500).json({ code: -1, message: '保存技能失败' });
        }
    });

    base.post(wrapPath('/smart-chat/knowledge/toggle'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const scope = String(body.scope || 'global');
            const id = String(body.id || '').trim();
            if (!id) {
                res.status(400).json({ code: -1, message: 'missing_id' });
                return;
            }
            const enabled = body.enabled !== false && body.enabled !== 'false' && body.enabled !== 0 && body.enabled !== '0';
            const entry = setKnowledgeEnabled(deps, scope, id, enabled);
            if (!entry) {
                res.status(404).json({ code: -1, message: 'not_found' });
                return;
            }
            res.json({ code: 0, data: entry });
        } catch (e) {
            logger?.error?.('切换技能开关失败:', e);
            res.status(500).json({ code: -1, message: '切换技能开关失败' });
        }
    });

    base.post(wrapPath('/smart-chat/knowledge/delete'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const scope = String(body.scope || 'global');
            const id = String(body.id || '').trim();
            if (!id) {
                res.status(400).json({ code: -1, message: 'missing_id' });
                return;
            }
            const ok = deleteKnowledge(deps, scope, id);
            res.json({ code: ok ? 0 : -1, message: ok ? 'ok' : 'not_found' });
        } catch (e) {
            logger?.error?.('删除技能失败:', e);
            res.status(500).json({ code: -1, message: '删除技能失败' });
        }
    });

    base.post(wrapPath('/smart-chat/session/clear'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const chatId = String(body.chatId || '').trim();
            if (!chatId) {
                res.status(400).json({ code: -1, message: 'missing_chatId' });
                return;
            }
            clearSession(deps, chatId);
            clearChatBuffer(deps, chatId);
            res.json({ code: 0, message: 'ok' });
        } catch (e) {
            logger?.error?.('清空会话失败:', e);
            res.status(500).json({ code: -1, message: '清空会话失败' });
        }
    });

    base.post(wrapPath('/smart-chat/usage/clear'), async (_req, res) => {
        try {
            clearUsageLedger(deps);
            res.json({ code: 0, message: 'ok' });
        } catch (e) {
            logger?.error?.('清空用量账本失败:', e);
            res.status(500).json({ code: -1, message: '清空用量账本失败' });
        }
    });

    base.post(wrapPath('/smart-chat/web-search/test'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const provider = String(body.provider || '').trim() as WebSearchProviderId;
            if (!['tavily', 'serper', 'bocha'].includes(provider)) {
                res.status(400).json({ code: -1, message: 'invalid_provider' });
                return;
            }
            const cfg = loadSmartChatConfig(deps);
            const r = await testWebSearchProvider(cfg, provider);
            res.json({
                code: r.ok ? 0 : -1,
                data: {
                    provider: r.provider,
                    ok: r.ok,
                    error: r.error || null,
                    hit_count: r.hits?.length || 0,
                    may_consume_quota: Boolean(r.mayConsumeQuota ?? r.meta?.testMayConsume),
                    meta: r.meta,
                    sample: r.hits?.[0] || null,
                },
                message: r.ok ? 'ok' : (r.error || 'test_failed'),
            });
        } catch (e) {
            logger?.error?.('联网搜索密钥测试失败:', e);
            res.status(500).json({ code: -1, message: '联网搜索密钥测试失败' });
        }
    });

    base.post(wrapPath('/smart-chat/switches/set'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const type = String(body.type || 'group') === 'friend' ? 'friend' : 'group';
            const id = String(body.id || '').trim();
            if (!id) {
                res.status(400).json({ code: -1, message: 'id_required' });
                return;
            }
            if (body.enabled != null) {
                const on = body.enabled === true || body.enabled === 'true' || body.enabled === '开启' || body.enabled === 1;
                if (type === 'group') setSmartChatGroupEnabled(deps, id, on);
                else setSmartChatFriendEnabled(deps, id, on);
            }
            if (body.ai_only != null) {
                const on = body.ai_only === true || body.ai_only === 'true' || body.ai_only === '开启' || body.ai_only === 1;
                if (type === 'group') setSmartChatAiOnlyGroup(deps, id, on);
                else setSmartChatAiOnlyFriend(deps, id, on);
            }
            if (body.rounds != null) {
                const rounds = normalizeSmartChatRounds(body.rounds);
                if (type === 'group') setSmartChatGroupRounds(deps, id, rounds);
                else setSmartChatFriendRounds(deps, id, rounds);
            }
            if (body.image_recognize != null) {
                const on = body.image_recognize === true
                    || body.image_recognize === 'true'
                    || body.image_recognize === '开启'
                    || body.image_recognize === 1;
                if (type === 'group') setSmartChatImageGroup(deps, id, on);
                else setSmartChatImageFriend(deps, id, on);
            }
            const enabled = type === 'group'
                ? isSmartChatGroupEnabled(deps, id)
                : isSmartChatFriendEnabled(deps, id);
            const ai_only = type === 'group'
                ? isSmartChatAiOnlyGroup(deps, id)
                : isSmartChatAiOnlyFriend(deps, id);
            const rounds = type === 'group'
                ? getSmartChatGroupRounds(deps, id)
                : getSmartChatFriendRounds(deps, id);
            const image_recognize = type === 'group'
                ? isSmartChatImageGroup(deps, id)
                : isSmartChatImageFriend(deps, id);
            res.json({ code: 0, data: { type, id, enabled, ai_only, rounds, image_recognize } });
        } catch (e) {
            logger?.error?.('保存智能对话开关失败:', e);
            res.status(500).json({ code: -1, message: '保存智能对话开关失败' });
        }
    });

    base.post(wrapPath('/smart-chat/switches/bulk'), async (req, res) => {
        try {
            const body = await parsePostBody(req);
            const type = String(body.type || 'group') === 'friend' ? 'friend' : 'group';
            const enabled = body.enabled === true || body.enabled === 'true' || body.enabled === '开启' || body.enabled === 1;
            const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
            const n = bulkSetSmartChatEnabled(deps, type, ids, enabled);
            res.json({ code: 0, data: { type, enabled, count: n } });
        } catch (e) {
            logger?.error?.('批量保存智能对话开关失败:', e);
            res.status(500).json({ code: -1, message: '批量保存智能对话开关失败' });
        }
    });
}
