// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 余额查询 + 本地 usage 账本（对齐 Reasonix billing）
// ---------------------------------------------------------------------------

import type {
    CompletionUsage,
    SmartChatBalanceResult,
    SmartChatConfig,
    SmartChatDeps,
    SmartChatUsageLedger,
    SmartChatUsageRecord,
} from './smart-chat-types';
import { SMART_CHAT_ROOT } from './smart-chat-types';
import { getVendorPreset, normalizeSmartChatVendor } from './smart-chat-config';
import {
    bindNvidiaRateDeps,
    buildNvidiaBalanceResult,
    noteNvidiaRequest,
    NVIDIA_DEFAULT_RPM,
} from './smart-chat-nvidia-rate';

export { bindNvidiaRateDeps };

const USAGE_FILE = `${SMART_CHAT_ROOT}usage.json`;
const BALANCE_CACHE_MS = 60_000;
const HCNSEC_QUOTA_PER_UNIT = 500_000;
const HCNSEC_USD_CNY = 7.3;

let balanceCache: { at: number; data: SmartChatBalanceResult } | null = null;

function emptyLedger(): SmartChatUsageLedger {
    return {
        total_requests: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cache_hit_tokens: 0,
        total_estimated_cost: 0,
        records: [],
    };
}

export function loadUsageLedger(deps: SmartChatDeps): SmartChatUsageLedger {
    const raw = deps.readA(USAGE_FILE);
    if (!raw) return emptyLedger();
    try {
        const obj = JSON.parse(raw);
        return {
            ...emptyLedger(),
            ...obj,
            records: Array.isArray(obj.records) ? obj.records.slice(-500) : [],
        };
    } catch {
        return emptyLedger();
    }
}

function saveUsageLedger(deps: SmartChatDeps, ledger: SmartChatUsageLedger): void {
    ledger.records = (ledger.records || []).slice(-500);
    deps.writeA(USAGE_FILE, JSON.stringify(ledger, null, 2));
}

function estimateCost(config: SmartChatConfig, usage: CompletionUsage): number {
    const p = Number(config.price_prompt_per_million || 0);
    const c = Number(config.price_completion_per_million || 0);
    if (p <= 0 && c <= 0) return 0;
    return (usage.prompt_tokens / 1_000_000) * p + (usage.completion_tokens / 1_000_000) * c;
}

export function recordUsage(
    deps: SmartChatDeps,
    config: SmartChatConfig,
    chatId: string,
    usage: CompletionUsage,
): SmartChatUsageRecord {
    const ledger = loadUsageLedger(deps);
    const record: SmartChatUsageRecord = {
        at: new Date().toISOString(),
        chatId,
        model: config.model,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens,
        estimated_cost: estimateCost(config, usage),
    };
    ledger.total_requests += 1;
    ledger.total_prompt_tokens += record.prompt_tokens;
    ledger.total_completion_tokens += record.completion_tokens;
    ledger.total_tokens += record.total_tokens;
    ledger.total_cache_hit_tokens += record.prompt_cache_hit_tokens || 0;
    ledger.total_estimated_cost += record.estimated_cost || 0;
    ledger.last = record;
    ledger.records.push(record);
    saveUsageLedger(deps, ledger);
    return record;
}

export function getUsageSummary(deps: SmartChatDeps): Record<string, unknown> {
    const ledger = loadUsageLedger(deps);
    const today = new Date().toISOString().slice(0, 10);
    let todayPrompt = 0;
    let todayCompletion = 0;
    let todayTotal = 0;
    let todayCost = 0;
    let todayRequests = 0;
    for (const r of ledger.records || []) {
        if (!r.at || !r.at.startsWith(today)) continue;
        todayPrompt += r.prompt_tokens || 0;
        todayCompletion += r.completion_tokens || 0;
        todayTotal += r.total_tokens || 0;
        todayCost += r.estimated_cost || 0;
        todayRequests += 1;
    }
    const cacheDenom = ledger.total_prompt_tokens || 0;
    const cacheHitRate = cacheDenom > 0 ? Math.round((ledger.total_cache_hit_tokens / cacheDenom) * 10000) / 100 : null;
    let todayCacheHit = 0;
    let todayPromptAll = 0;
    for (const r of ledger.records || []) {
        if (!r.at || !r.at.startsWith(today)) continue;
        todayCacheHit += r.prompt_cache_hit_tokens || 0;
        todayPromptAll += r.prompt_tokens || 0;
    }
    const todayCacheHitRate = todayPromptAll > 0
        ? Math.round((todayCacheHit / todayPromptAll) * 10000) / 100
        : null;
    const last = ledger.last || null;
    const lastHit = last?.prompt_cache_hit_tokens || 0;
    const lastPrompt = last?.prompt_tokens || 0;
    const lastCacheHitRate = lastPrompt > 0 ? Math.round((lastHit / lastPrompt) * 10000) / 100 : null;
    return {
        total_requests: ledger.total_requests,
        total_prompt_tokens: ledger.total_prompt_tokens,
        total_completion_tokens: ledger.total_completion_tokens,
        total_tokens: ledger.total_tokens,
        total_cache_hit_tokens: ledger.total_cache_hit_tokens,
        total_estimated_cost: ledger.total_estimated_cost,
        cache_hit_rate_percent: cacheHitRate,
        today: {
            requests: todayRequests,
            prompt_tokens: todayPrompt,
            completion_tokens: todayCompletion,
            total_tokens: todayTotal,
            estimated_cost: todayCost,
            cache_hit_tokens: todayCacheHit,
            cache_hit_rate_percent: todayCacheHitRate,
        },
        last: last
            ? { ...last, cache_hit_rate_percent: lastCacheHitRate }
            : null,
    };
}

export function clearBalanceCache(): void {
    balanceCache = null;
}

function resolveVendor(config: SmartChatConfig) {
    return normalizeSmartChatVendor(config.vendor, config.base_url);
}

function fmtUsd(n: number): string {
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(4);
}

function quotaToUsd(quota: number, unit = HCNSEC_QUOTA_PER_UNIT): number {
    return Number(quota || 0) / unit;
}

/** 解析 NewAPI /api/usage/token 响应为余额卡片数据 */
function parseHcnsecTokenUsage(data: Record<string, unknown>): SmartChatBalanceResult | null {
    const payload = (data?.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') return null;
    const hasTokenFields =
        payload.total_available != null ||
        payload.total_used != null ||
        payload.total_granted != null ||
        payload.object === 'token_usage';
    if (!hasTokenFields) return null;

    const unlimited = Boolean(payload.unlimited_quota);
    const availableQuota = Number(payload.total_available ?? 0);
    const usedQuota = Number(payload.total_used ?? 0);
    const grantedQuota = Number(payload.total_granted ?? (availableQuota + usedQuota));
    const availUsd = unlimited ? 999999 : quotaToUsd(availableQuota);
    const usedUsd = quotaToUsd(usedQuota);
    const totalUsd = unlimited ? 999999 : quotaToUsd(grantedQuota);

    return {
        available: unlimited || availableQuota > 0,
        display: 'hcnsec',
        infos: [
            {
                currency: 'USD',
                // 主显示：剩余额度（USD）；UI 会附带约 ¥
                total_balance: unlimited ? '∞' : fmtUsd(availUsd),
                // 复用字段：已用
                topped_up_balance: fmtUsd(usedUsd),
                // 复用字段：令牌总额度
                granted_balance: unlimited ? '∞' : fmtUsd(totalUsd),
            },
        ],
        meta: {
            token_name: String(payload.name || ''),
            unlimited_quota: unlimited,
            remaining_quota: availableQuota,
            used_quota: usedQuota,
            total_quota: grantedQuota,
            quota_per_unit: HCNSEC_QUOTA_PER_UNIT,
            usd_exchange_rate: HCNSEC_USD_CNY,
        },
        fetched_at: new Date().toISOString(),
    };
}

function parseDeepseekBalance(data: Record<string, unknown>): SmartChatBalanceResult {
    const infos = Array.isArray(data.balance_infos)
        ? data.balance_infos.map((b: Record<string, string>) => ({
              currency: String(b.currency || ''),
              total_balance: String(b.total_balance || '0'),
              granted_balance: String(b.granted_balance || '0'),
              topped_up_balance: String(b.topped_up_balance || '0'),
          }))
        : [];
    return {
        available: Boolean(data.is_available),
        display: 'deepseek',
        infos,
        fetched_at: new Date().toISOString(),
    };
}

function displayForVendor(vendor: ReturnType<typeof resolveVendor>): SmartChatBalanceResult['display'] {
    if (vendor === 'hcnsec') return 'hcnsec';
    if (vendor === 'nvidia') return 'nvidia';
    return 'deepseek';
}

async function probeNvidiaModels(config: SmartChatConfig, deps?: SmartChatDeps | null): Promise<SmartChatBalanceResult> {
    const preset = getVendorPreset('nvidia');
    const base = String(config.base_url || preset.base_url).replace(/\/+$/, '');
    const apiKey = String(config.api_key || '').trim();
    if (!apiKey) {
        return {
            ...buildNvidiaBalanceResult(deps),
            available: false,
            error: 'api_key_not_configured',
        };
    }
    try {
        const resp = await fetch(`${base}/models`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'Cache-Control': 'no-cache',
            },
        });
        noteNvidiaRequest(deps, {
            headers: resp.headers,
            status: resp.status,
            ok: resp.ok,
            error: resp.ok ? '' : `HTTP ${resp.status}`,
            countInWindow: false,
        });
        const snap = buildNvidiaBalanceResult(deps);
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            return {
                ...snap,
                available: false,
                error: `HTTP ${resp.status}: ${text.slice(0, 160)}`,
                fetched_at: new Date().toISOString(),
            };
        }
        return {
            ...snap,
            // 探 models 成功只代表密钥可用；RPM 是否还有余量看 snap.available
            error: undefined,
            fetched_at: new Date().toISOString(),
        };
    } catch (e) {
        noteNvidiaRequest(deps, { ok: false, error: e?.message || String(e), countInWindow: false });
        return {
            ...buildNvidiaBalanceResult(deps),
            available: false,
            error: e?.message || String(e),
            fetched_at: new Date().toISOString(),
        };
    }
}

export async function fetchBalance(
    config: SmartChatConfig,
    force = false,
    deps?: SmartChatDeps | null,
): Promise<SmartChatBalanceResult> {
    const vendor = resolveVendor(config);
    if (vendor === 'nvidia') {
        if (force) return probeNvidiaModels(config, deps);
        return buildNvidiaBalanceResult(deps);
    }

    const preset = getVendorPreset(vendor);
    const url = String(config.balance_url || preset.balance_url || '').trim();
    const apiKey = String(config.api_key || '').trim();
    if (!url) return { available: false, infos: [], error: 'balance_url_not_configured', display: displayForVendor(vendor) };
    if (!apiKey) return { available: false, infos: [], error: 'api_key_not_configured', display: displayForVendor(vendor) };

    const now = Date.now();
    if (force) {
        balanceCache = null;
    } else if (balanceCache && now - balanceCache.at < BALANCE_CACHE_MS) {
        return { ...balanceCache.data, fetched_at: balanceCache.data.fetched_at, error: balanceCache.data.error };
    }

    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'Cache-Control': 'no-cache',
            },
        });
        const text = await resp.text();
        if (!resp.ok) {
            const result: SmartChatBalanceResult = {
                available: false,
                infos: [],
                display: displayForVendor(vendor),
                error: `HTTP ${resp.status}: ${text.slice(0, 200)}`,
                fetched_at: new Date().toISOString(),
            };
            balanceCache = { at: now, data: result };
            return result;
        }
        const data = JSON.parse(text);
        let result: SmartChatBalanceResult;
        if (vendor === 'hcnsec') {
            result = parseHcnsecTokenUsage(data) || {
                available: false,
                infos: [],
                display: 'hcnsec',
                error: 'unexpected_balance_payload',
                fetched_at: new Date().toISOString(),
            };
            // 附带约人民币提示：写入 detail 由 UI 读 meta
            if (result.infos[0] && result.infos[0].total_balance !== '∞' && result.meta) {
                const usd = Number(result.infos[0].total_balance);
                if (Number.isFinite(usd)) {
                    result.meta.approx_cny = (usd * HCNSEC_USD_CNY).toFixed(2);
                }
            }
        } else {
            const hcn = parseHcnsecTokenUsage(data);
            result = hcn || parseDeepseekBalance(data);
        }
        balanceCache = { at: now, data: result };
        return result;
    } catch (e) {
        const result: SmartChatBalanceResult = {
            available: false,
            infos: [],
            display: displayForVendor(vendor),
            error: e?.message || String(e),
            fetched_at: new Date().toISOString(),
        };
        balanceCache = { at: now, data: result };
        return result;
    }
}

async function testChatCompletions(config: SmartChatConfig): Promise<{ ok: boolean; message: string }> {
    const vendor = resolveVendor(config);
    const preset = getVendorPreset(vendor);
    const base = String(config.base_url || preset.base_url).replace(/\/+$/, '');
    const path = preset.chat_path || '/v1/chat/completions';
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const apiKey = String(config.api_key || '').trim();
    if (!apiKey) return { ok: false, message: 'api_key_not_configured' };
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: config.model || preset.default_model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 8,
                stream: false,
            }),
        });
        const text = await resp.text();
        if (!resp.ok) {
            return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 180)}` };
        }
        return { ok: true, message: 'chat_completions_ok' };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}

export async function testConnection(config: SmartChatConfig, deps?: SmartChatDeps | null): Promise<{ ok: boolean; message: string }> {
    const vendor = resolveVendor(config);
    if (vendor === 'nvidia') {
        const bal = await fetchBalance(config, true, deps);
        if (bal.error && /api_key_not_configured|401|403|unauthorized|invalid/i.test(String(bal.error))) {
            return { ok: false, message: bal.error };
        }
        if (!bal.error || bal.infos?.length) {
            return {
                ok: true,
                message: `nvidia_ok · ~${bal.meta?.rpm_used ?? 0}/${bal.meta?.rpm_limit ?? NVIDIA_DEFAULT_RPM} RPM`,
            };
        }
        const chat = await testChatCompletions(config);
        return chat.ok
            ? { ok: true, message: `chat_ok_models_failed: ${bal.error}` }
            : { ok: false, message: bal.error || chat.message };
    }

    const bal = await fetchBalance(config, true, deps);
    if (bal.infos?.length && !bal.error) {
        return { ok: true, message: bal.available ? 'balance_ok' : 'balance_fetched_but_unavailable' };
    }
    // 幻城等：余额接口失败时再探对话补全（确认 key / 模型路径可用）
    if (vendor === 'hcnsec' || (bal.error && /404|not.?found|unexpected/i.test(String(bal.error)))) {
        const chat = await testChatCompletions(config);
        if (chat.ok) {
            return {
                ok: true,
                message: bal.error ? `chat_ok_balance_failed: ${bal.error}` : chat.message,
            };
        }
        return { ok: false, message: bal.error || chat.message };
    }
    if (bal.error && !bal.infos.length) {
        return { ok: false, message: bal.error };
    }
    return { ok: true, message: bal.available ? 'balance_ok' : 'balance_fetched_but_unavailable' };
}

export function clearUsageLedger(deps: SmartChatDeps): void {
    saveUsageLedger(deps, emptyLedger());
}
