// @ts-nocheck
// ---------------------------------------------------------------------------
// 英伟达 NIM — 本地 RPM 滑动窗口 + 响应头限速快照
// （官方无公开余额/credits 接口，免费档常见约 40 RPM）
// ---------------------------------------------------------------------------

import type { SmartChatBalanceResult, SmartChatDeps } from './smart-chat-types';
import { SMART_CHAT_ROOT } from './smart-chat-types';

const RATE_FILE = `${SMART_CHAT_ROOT}nvidia-rate.json`;
/** 免费评估档常见上限；若响应头带 limit 则优先生效 */
export const NVIDIA_DEFAULT_RPM = 40;
const WINDOW_MS = 60_000;

export interface NvidiaRateState {
    /** 近窗内请求时间戳（ms）——仅真实对话/计费请求 */
    window: number[];
    last_headers?: {
        remaining?: number | null;
        limit?: number | null;
        reset_ms?: number | null;
        at?: string;
    };
    last_status?: number;
    last_ok?: boolean;
    last_error?: string;
    updated_at?: string;
}

function emptyState(): NvidiaRateState {
    return { window: [], updated_at: new Date().toISOString() };
}

function prune(window: number[], now = Date.now()): number[] {
    const cut = now - WINDOW_MS;
    // 去重：避免内存/磁盘合并或重复记入把次数翻倍
    const seen = new Set<number>();
    const out: number[] = [];
    for (const t of window || []) {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= cut) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    out.sort((a, b) => a - b);
    return out.slice(-120);
}

let boundDeps: SmartChatDeps | null = null;
/** 进程内快照：以内存为准，磁盘仅作冷启动恢复 */
let memoryState: NvidiaRateState = emptyState();
let diskHydrated = false;

function resolveDeps(deps?: SmartChatDeps | null): SmartChatDeps | null {
    return deps ?? boundDeps;
}

function loadNvidiaRateStateFromDisk(d: SmartChatDeps): NvidiaRateState {
    const raw = d.readA(RATE_FILE);
    if (!raw) return emptyState();
    try {
        const obj = JSON.parse(raw);
        const state: NvidiaRateState = {
            ...emptyState(),
            ...obj,
            window: prune(Array.isArray(obj.window) ? obj.window : []),
        };
        // 旧 bug 会把刷新/合并次数翻到上百；明显异常则丢弃窗口（保留响应头）
        if (state.window.length > NVIDIA_DEFAULT_RPM * 2) {
            state.window = [];
        }
        return state;
    } catch {
        return emptyState();
    }
}

function hydrateFromDiskIfNeeded(d: SmartChatDeps | null): void {
    if (!d || diskHydrated) return;
    const disk = loadNvidiaRateStateFromDisk(d);
    // 冷启动：磁盘覆盖空内存；已有内存窗口则只补响应头等元数据
    if (!(memoryState.window || []).length) {
        memoryState = disk;
    } else if (disk.last_headers && !memoryState.last_headers) {
        memoryState.last_headers = disk.last_headers;
        memoryState.last_status = memoryState.last_status ?? disk.last_status;
    }
    memoryState.window = prune(memoryState.window || []);
    diskHydrated = true;
}

/** 运行时绑定 deps，便于 provider 在无显式 deps 时落盘 */
export function bindNvidiaRateDeps(deps: SmartChatDeps | null | undefined): void {
    boundDeps = deps || null;
    diskHydrated = false;
    hydrateFromDiskIfNeeded(boundDeps);
}

export function loadNvidiaRateState(deps?: SmartChatDeps | null): NvidiaRateState {
    const d = resolveDeps(deps);
    hydrateFromDiskIfNeeded(d);
    memoryState.window = prune(memoryState.window || []);
    return {
        ...memoryState,
        window: [...(memoryState.window || [])],
        last_headers: memoryState.last_headers ? { ...memoryState.last_headers } : undefined,
    };
}

function saveNvidiaRateState(deps: SmartChatDeps | null | undefined, state: NvidiaRateState): void {
    memoryState = {
        ...state,
        window: prune(state.window || []),
        updated_at: new Date().toISOString(),
    };
    diskHydrated = true;
    const d = resolveDeps(deps);
    if (!d) return;
    try {
        d.writeA(RATE_FILE, JSON.stringify(memoryState, null, 2));
    } catch {
        /* ignore */
    }
}

function headerGet(headers: Headers | Record<string, string> | null | undefined, name: string): string {
    if (!headers) return '';
    if (typeof (headers as Headers).get === 'function') {
        return String((headers as Headers).get(name) || (headers as Headers).get(name.toLowerCase()) || '').trim();
    }
    const o = headers as Record<string, string>;
    const key = Object.keys(o).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(o[key] || '').trim() : '';
}

function parseNum(v: string): number | null {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** 从 NIM 响应头提取限速信息（字段名因网关略有差异，多路兼容） */
export function parseNvidiaRateHeaders(headers: Headers | Record<string, string> | null | undefined) {
    const remaining = parseNum(
        headerGet(headers, 'x-ratelimit-remaining-requests')
        || headerGet(headers, 'x-ratelimit-remaining')
        || headerGet(headers, 'ratelimit-remaining'),
    );
    const limit = parseNum(
        headerGet(headers, 'x-ratelimit-limit-requests')
        || headerGet(headers, 'x-ratelimit-limit')
        || headerGet(headers, 'ratelimit-limit'),
    );
    const resetRaw =
        headerGet(headers, 'x-ratelimit-reset-tokens')
        || headerGet(headers, 'x-ratelimit-reset-requests')
        || headerGet(headers, 'x-ratelimit-reset')
        || headerGet(headers, 'retry-after');
    let reset_ms: number | null = null;
    if (resetRaw) {
        const n = Number(resetRaw);
        if (Number.isFinite(n)) {
            // 常见：毫秒重置；若 < 1000 更像秒
            reset_ms = n >= 1000 ? n : n * 1000;
        }
    }
    return { remaining, limit, reset_ms };
}

/**
 * 记录一次 NIM 请求。
 * countInWindow=false：仅更新响应头/状态（用于「刷新限速」探 models，不计 RPM）
 */
export function noteNvidiaRequest(
    deps: SmartChatDeps | null | undefined,
    opts: {
        headers?: Headers | Record<string, string> | null;
        status?: number;
        ok?: boolean;
        error?: string;
        /** 默认 true；探活/刷新限速应传 false */
        countInWindow?: boolean;
    } = {},
): NvidiaRateState {
    const state = loadNvidiaRateState(deps);
    const now = Date.now();
    const count = opts.countInWindow !== false;
    if (count) {
        state.window = prune([...(state.window || []), now], now);
    } else {
        state.window = prune(state.window || [], now);
    }
    if (opts.headers) {
        const h = parseNvidiaRateHeaders(opts.headers);
        state.last_headers = {
            remaining: h.remaining,
            limit: h.limit,
            reset_ms: h.reset_ms,
            at: new Date().toISOString(),
        };
    }
    if (opts.status != null) state.last_status = opts.status;
    if (opts.ok != null) state.last_ok = opts.ok;
    if (opts.error) state.last_error = String(opts.error).slice(0, 200);
    else if (opts.ok) state.last_error = '';
    state.updated_at = new Date().toISOString();
    saveNvidiaRateState(deps, state);
    return state;
}

export function buildNvidiaBalanceResult(deps?: SmartChatDeps | null): SmartChatBalanceResult {
    const state = loadNvidiaRateState(deps);
    const now = Date.now();
    const window = prune(state.window || [], now);
    const rpmUsed = window.length;
    const headerLimit = state.last_headers?.limit;
    const rpmLimit = (headerLimit != null && headerLimit > 0) ? headerLimit : NVIDIA_DEFAULT_RPM;
    const remainingHeader = state.last_headers?.remaining ?? null;
    const resetMs = state.last_headers?.reset_ms ?? null;
    const resetInSec = resetMs != null ? Math.max(0, Math.round(resetMs / 1000)) : null;
    const available = rpmUsed < rpmLimit && (state.last_status !== 429);

    return {
        available,
        display: 'nvidia',
        infos: [
            {
                currency: 'RPM',
                total_balance: `${rpmUsed} / ${rpmLimit}`,
                topped_up_balance: String(rpmUsed),
                granted_balance: String(rpmLimit),
            },
        ],
        meta: {
            rpm_used: rpmUsed,
            rpm_limit: rpmLimit,
            header_remaining: remainingHeader,
            header_limit: headerLimit ?? null,
            reset_in_sec: resetInSec,
            token_name: 'NVIDIA NIM 免费档',
        },
        fetched_at: state.updated_at || new Date().toISOString(),
        error: state.last_status === 429
            ? (state.last_error || 'rate_limited_429')
            : undefined,
    };
}
