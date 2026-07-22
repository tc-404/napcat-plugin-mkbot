// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — Function Calling 工具（web_search / web_fetch）
// ---------------------------------------------------------------------------

import dns from 'dns/promises';
import net from 'net';
import type { SmartChatConfig, SmartChatWebSearchKeys } from './smart-chat-types';

export type WebSearchProviderId = 'tavily' | 'serper' | 'bocha';

export const WEB_SEARCH_PROVIDER_META: Record<
    WebSearchProviderId,
    {
        label: string;
        keyUrls: string[];
        notes: string;
        /** 测试是否可能消耗搜索额度 */
        testMayConsume: boolean;
    }
> = {
    tavily: {
        label: 'Tavily',
        keyUrls: ['https://app.tavily.com/home', 'https://docs.tavily.com'],
        notes: '控制台复制 API Key（tvly-…）；免费档每月有额度。',
        testMayConsume: true,
    },
    serper: {
        label: 'Serper',
        keyUrls: ['https://serper.dev'],
        notes: '登录 Dashboard → API Key 复制。',
        testMayConsume: true,
    },
    bocha: {
        label: '博查',
        keyUrls: [
            'https://open.bochaai.com/api-keys',
            'https://open.bochaai.com/',
            'https://open.bochaai.com/recharge',
        ],
        notes: '开放平台创建 Key；预付费，无余额会失败。',
        testMayConsume: true,
    },
};

/** 稳定、固定字节的 tools schema（写入请求时勿改动描述文案） */
export const SMART_CHAT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the public web for up-to-date information. Returns titles, URLs and snippets.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    max_results: { type: 'integer', description: 'Max results 1-8', minimum: 1, maximum: 8 },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'web_fetch',
            description: 'Fetch a public http(s) URL and return readable text content.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Absolute http(s) URL' },
                },
                required: ['url'],
            },
        },
    },
] as const;

/** 联网开启时追加到 system（固定文案，随 tools_enabled 指纹隔离会话） */
export const TOOLS_SYSTEM_SUFFIX =
    '\n\n[联网工具]\n' +
    '可用 web_search / web_fetch。不熟、要核实、要新鲜信息时自己搜；纯闲聊能接就别搜。\n' +
    '真搜就出 tool_calls，别空口答应。只有正在调工具时才可用一句很短的 <status>…</status>（与 tool_calls 同轮）；看图、普通回消息不要用 status。\n' +
    '搜到的当素材，口语说要点。本轮搜过就用文字把有用的说出来。别把调用原文贴进群。\n';

/** @deprecated 不再用于强制 tool_choice；保留供兼容引用 */
export function detectSearchIntent(text: string): boolean {
    const t = String(text || '');
    if (!t.trim()) return false;
    return /联网|搜索|搜一下|查一下|查下|搜下|查查|搜搜|帮我查|帮我搜|帮我找|找一下|找找|再搜|重新搜|再查|去搜|去查|搜一搜|查一查|有哪些|哪些公司|哪些企业|龙头|名单|排行|最新消息|今日热点|今天热点|今日新闻|今天新闻|热搜|google|百度一下/i.test(t);
}

/** 模型空口答应去搜、却没返回 tool_calls */
export function looksLikeEmptySearchPromise(content: string): boolean {
    const t = String(content || '');
    if (!t.trim()) return false;
    return /这就去搜|这就查|马上.*(?:搜|查)|我去搜|我去查|等我(?:搜|查)|别催|马上给你|搜完再|让我搜|我先搜|稍等.*(?:搜|查)|这就去查|我去找|这就找|确认一下|要不要我搜|要我搜吗|要不要搜/i.test(t);
}

export function buildToolChoice(forceSearch: boolean): string | object {
    if (forceSearch) {
        return { type: 'function', function: { name: 'web_search' } };
    }
    return 'auto';
}
export interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}

export interface ProviderSearchResult {
    ok: boolean;
    provider: WebSearchProviderId;
    hits?: SearchHit[];
    error?: string;
    /** 测试时：是否可能已扣额度 */
    mayConsumeQuota?: boolean;
}

function clampResults(n: unknown, fallback = 5): number {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(8, Math.max(1, Math.floor(v)));
}

/** 已配置的搜索源（无固定优先级） */
export function listConfiguredProviders(keys: SmartChatWebSearchKeys | null | undefined): WebSearchProviderId[] {
    const k = keys || ({} as SmartChatWebSearchKeys);
    const out: WebSearchProviderId[] = [];
    if (String(k.tavily_key || '').trim()) out.push('tavily');
    if (String(k.serper_key || '').trim()) out.push('serper');
    if (String(k.bocha_key || '').trim()) out.push('bocha');
    return out;
}

export function hasAnySearchKey(cfg: SmartChatConfig): boolean {
    return listConfiguredProviders(cfg.web_search).length > 0;
}

export function toolsShouldAttach(cfg: SmartChatConfig): boolean {
    return Boolean(cfg.tools_enabled) && hasAnySearchKey(cfg);
}

function shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function searchTavily(key: string, query: string, maxResults: number): Promise<ProviderSearchResult> {
    try {
        const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                query,
                max_results: maxResults,
                search_depth: 'basic',
                include_answer: false,
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            return {
                ok: false,
                provider: 'tavily',
                error: String(data?.detail || data?.error || data?.message || `HTTP ${resp.status}`),
                mayConsumeQuota: true,
            };
        }
        const results = Array.isArray(data?.results) ? data.results : [];
        const hits: SearchHit[] = results.slice(0, maxResults).map((r) => ({
            title: String(r?.title || ''),
            url: String(r?.url || ''),
            snippet: String(r?.content || r?.snippet || '').slice(0, 400),
        })).filter((h) => h.url);
        return { ok: true, provider: 'tavily', hits, mayConsumeQuota: true };
    } catch (e) {
        return { ok: false, provider: 'tavily', error: e?.message || String(e), mayConsumeQuota: false };
    }
}

async function searchSerper(key: string, query: string, maxResults: number): Promise<ProviderSearchResult> {
    try {
        const resp = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': key,
            },
            body: JSON.stringify({ q: query, num: maxResults }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            return {
                ok: false,
                provider: 'serper',
                error: String(data?.message || data?.error || `HTTP ${resp.status}`),
                mayConsumeQuota: true,
            };
        }
        const organic = Array.isArray(data?.organic) ? data.organic : [];
        const hits: SearchHit[] = organic.slice(0, maxResults).map((r) => ({
            title: String(r?.title || ''),
            url: String(r?.link || ''),
            snippet: String(r?.snippet || '').slice(0, 400),
        })).filter((h) => h.url);
        return { ok: true, provider: 'serper', hits, mayConsumeQuota: true };
    } catch (e) {
        return { ok: false, provider: 'serper', error: e?.message || String(e), mayConsumeQuota: false };
    }
}

async function searchBocha(key: string, query: string, maxResults: number): Promise<ProviderSearchResult> {
    try {
        const resp = await fetch('https://api.bochaai.com/v1/web-search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                query,
                count: maxResults,
                summary: true,
                freshness: 'noLimit',
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            return {
                ok: false,
                provider: 'bocha',
                error: String(data?.message || data?.msg || data?.error || `HTTP ${resp.status}`),
                mayConsumeQuota: true,
            };
        }
        const pages =
            data?.data?.webPages?.value ||
            data?.data?.webPages ||
            data?.webPages?.value ||
            data?.results ||
            [];
        const list = Array.isArray(pages) ? pages : [];
        const hits: SearchHit[] = list.slice(0, maxResults).map((r) => ({
            title: String(r?.name || r?.title || ''),
            url: String(r?.url || r?.displayUrl || ''),
            snippet: String(r?.snippet || r?.summary || r?.description || '').slice(0, 400),
        })).filter((h) => h.url);
        return { ok: true, provider: 'bocha', hits, mayConsumeQuota: true };
    } catch (e) {
        return { ok: false, provider: 'bocha', error: e?.message || String(e), mayConsumeQuota: false };
    }
}

async function runOneProvider(
    id: WebSearchProviderId,
    keys: SmartChatWebSearchKeys,
    query: string,
    maxResults: number,
): Promise<ProviderSearchResult> {
    switch (id) {
        case 'tavily':
            return searchTavily(keys.tavily_key, query, maxResults);
        case 'serper':
            return searchSerper(keys.serper_key, query, maxResults);
        case 'bocha':
            return searchBocha(keys.bocha_key, query, maxResults);
        default:
            return { ok: false, provider: id, error: 'unknown_provider' };
    }
}

/**
 * 在已配置源中随机打乱后依次尝试，直到成功。
 */
export async function webSearchWithFailover(
    cfg: SmartChatConfig,
    query: string,
    maxResults = 5,
    logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void },
): Promise<{ ok: boolean; text: string; provider?: WebSearchProviderId; errors?: string[] }> {
    const q = String(query || '').trim();
    if (!q) return { ok: false, text: JSON.stringify({ error: 'empty_query' }) };
    const n = clampResults(maxResults, 5);
    const providers = shuffleInPlace(listConfiguredProviders(cfg.web_search));
    if (!providers.length) {
        return { ok: false, text: JSON.stringify({ error: 'no_search_provider_configured' }) };
    }
    const errors: string[] = [];
    for (const id of providers) {
        const r = await runOneProvider(id, cfg.web_search, q, n);
        if (r.ok && r.hits?.length) {
            const sample = String(r.hits[0]?.title || r.hits[0]?.url || '').slice(0, 80);
            logger?.info?.(
                `[智能对话·联网] web_search 使用 ${id}，命中 ${r.hits.length} 条，首条=${sample || '(无标题)'}`,
            );
            const payload = { provider: id, query: q, results: r.hits };
            return { ok: true, text: JSON.stringify(payload).slice(0, 12000), provider: id };
        }
        if (r.ok && (!r.hits || !r.hits.length)) {
            errors.push(`${id}: empty_results`);
            logger?.warn?.(`[智能对话·联网] ${id} 返回空结果`);
            continue;
        }
        errors.push(`${id}: ${r.error || 'fail'}`);
        logger?.warn?.(`[智能对话·联网] ${id} 失败:`, r.error);
    }
    return {
        ok: false,
        text: JSON.stringify({ error: 'all_providers_failed', errors }),
        errors,
    };
}

export async function testWebSearchProvider(
    cfg: SmartChatConfig,
    provider: WebSearchProviderId,
): Promise<ProviderSearchResult & { meta: (typeof WEB_SEARCH_PROVIDER_META)[WebSearchProviderId] }> {
    const meta = WEB_SEARCH_PROVIDER_META[provider];
    const keys = cfg.web_search;
    const has =
        (provider === 'tavily' && keys.tavily_key) ||
        (provider === 'serper' && keys.serper_key) ||
        (provider === 'bocha' && keys.bocha_key);
    if (!has) {
        return { ok: false, provider, error: 'key_not_configured', mayConsumeQuota: false, meta };
    }
    // 极小搜索：可能消耗 1 次额度
    const r = await runOneProvider(provider, keys, 'ping', 1);
    return { ...r, meta };
}

function isBlockedIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const p = ip.split('.').map(Number);
        if (p[0] === 10) return true;
        if (p[0] === 127) return true;
        if (p[0] === 0) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT / 云元数据常见段
        return false;
    }
    if (net.isIPv6(ip)) {
        const s = ip.toLowerCase();
        if (s === '::1') return true;
        if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA
        if (s.startsWith('fe80')) return true;
        return false;
    }
    return true;
}

async function assertSafePublicUrl(rawUrl: string): Promise<string> {
    let u: URL;
    try {
        u = new URL(String(rawUrl || '').trim());
    } catch {
        throw new Error('invalid_url');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol_not_allowed');
    const host = u.hostname;
    if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('host_blocked');
    if (net.isIP(host)) {
        if (isBlockedIp(host)) throw new Error('ip_blocked');
        return u.toString();
    }
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) throw new Error('dns_failed');
    for (const a of addrs) {
        if (isBlockedIp(a.address)) throw new Error('resolved_ip_blocked');
    }
    return u.toString();
}

function htmlToText(html: string): string {
    let s = String(html || '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    s = s.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

export async function webFetchUrl(rawUrl: string): Promise<{ ok: boolean; text: string }> {
    try {
        const safe = await assertSafePublicUrl(rawUrl);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        try {
            const resp = await fetch(safe, {
                method: 'GET',
                redirect: 'follow',
                signal: ctrl.signal,
                headers: {
                    'User-Agent': 'MKBot-SmartChat-WebFetch/1.0',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
                },
            });
            const ct = String(resp.headers.get('content-type') || '');
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 1_500_000) {
                return { ok: false, text: JSON.stringify({ error: 'body_too_large', status: resp.status }) };
            }
            let body = buf.toString('utf8');
            if (/html/i.test(ct) || /<html/i.test(body.slice(0, 500))) {
                body = htmlToText(body);
            }
            body = body.slice(0, 12000);
            if (!resp.ok) {
                return {
                    ok: false,
                    text: JSON.stringify({ error: `HTTP ${resp.status}`, url: safe, preview: body.slice(0, 500) }),
                };
            }
            return { ok: true, text: JSON.stringify({ url: safe, content: body }) };
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        return { ok: false, text: JSON.stringify({ error: e?.message || String(e) }) };
    }
}

export interface ToolCallLike {
    id: string;
    type?: string;
    function?: { name?: string; arguments?: string };
}

export async function executeToolCalls(
    cfg: SmartChatConfig,
    toolCalls: ToolCallLike[],
    logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void },
): Promise<Array<{ role: 'tool'; tool_call_id: string; content: string }>> {
    const out: Array<{ role: 'tool'; tool_call_id: string; content: string }> = [];
    for (const call of toolCalls || []) {
        const id = String(call?.id || '');
        const name = String(call?.function?.name || '');
        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(String(call?.function?.arguments || '{}'));
        } catch {
            args = {};
        }
        let content = '';
        if (name === 'web_search') {
            const r = await webSearchWithFailover(cfg, String(args.query || ''), clampResults(args.max_results, 5), logger);
            content = r.text;
        } else if (name === 'web_fetch') {
            const r = await webFetchUrl(String(args.url || ''));
            content = r.text;
        } else {
            content = JSON.stringify({ error: `unknown_tool:${name}` });
        }
        out.push({ role: 'tool', tool_call_id: id || 'unknown', content: content || '{}' });
    }
    return out;
}
