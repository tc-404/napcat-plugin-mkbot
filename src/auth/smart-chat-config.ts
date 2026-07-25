// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 配置读写
// ---------------------------------------------------------------------------

import type {
    SmartChatConfig,
    SmartChatDeps,
    SmartChatImageRecognizeSettings,
    SmartChatVendorId,
} from './smart-chat-types';
import { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPTS, SMART_CHAT_ROOT } from './smart-chat-types';
import { fingerprintPreview, sessionConfigFingerprint } from './smart-chat-fingerprint';

const CONFIG_FILE = `${SMART_CHAT_ROOT}config.json`;

/** 保存时对比：若会话绑定指纹变化，调用方可用于提示 */
let lastSavedFingerprint: string | null = null;

export function peekLastSavedFingerprint(): string | null {
    return lastSavedFingerprint;
}

export const SMART_CHAT_MODELS_DEEPSEEK = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
/** @deprecated 兼容旧引用：等同深度求索模型列表 */
export const SMART_CHAT_MODELS = SMART_CHAT_MODELS_DEEPSEEK;

/** 新疆幻城网安科技公益 — 按量计费对话模型（model 参数须与模型广场 ID 一致） */
export const SMART_CHAT_MODELS_HCNSEC = [
    'auto',
    'MiniMax-M2.7',
    'MiniMax-M3',
    'step-3.5-flash-2603',
    'Spark-X2-Flash',
    'Qwen3.5-397B-A17B',
] as const;

/** 英伟达 NIM（OpenAI 兼容 integrate.api.nvidia.com） */
export const SMART_CHAT_MODELS_NVIDIA = [
    'deepseek-ai/deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'z-ai/glm-5.2',
    'minimaxai/minimax-m3',
    'mistralai/mistral-medium-3.5-128b',
    'nvidia/nemotron-3-super-120b-a12b',
] as const;

export type SmartChatModelId =
    | (typeof SMART_CHAT_MODELS_DEEPSEEK)[number]
    | (typeof SMART_CHAT_MODELS_HCNSEC)[number]
    | (typeof SMART_CHAT_MODELS_NVIDIA)[number]
    | string;

export interface SmartChatVendorPreset {
    id: SmartChatVendorId;
    name: string;
    website: string;
    docs?: string;
    base_url: string;
    balance_url: string;
    /** OpenAI 兼容对话路径（挂在 base_url 后） */
    chat_path: string;
    models: readonly string[];
    default_model: string;
    model_labels?: Record<string, string>;
}

export const SMART_CHAT_VENDOR_PRESETS: Record<SmartChatVendorId, SmartChatVendorPreset> = {
    deepseek: {
        id: 'deepseek',
        name: '深度求索',
        website: 'https://platform.deepseek.com/',
        docs: 'https://api-docs.deepseek.com/',
        base_url: 'https://api.deepseek.com',
        balance_url: 'https://api.deepseek.com/user/balance',
        chat_path: '/v1/chat/completions',
        models: SMART_CHAT_MODELS_DEEPSEEK,
        default_model: 'deepseek-v4-flash',
        model_labels: {
            'deepseek-v4-flash': 'deepseek-v4-flash（更快更省）',
            'deepseek-v4-pro': 'deepseek-v4-pro（更强）',
        },
    },
    hcnsec: {
        id: 'hcnsec',
        name: '新疆幻城网安科技公益',
        website: 'https://api.hcnsec.cn/',
        docs: 'https://hcnote.cn/',
        base_url: 'https://api.hcnsec.cn',
        balance_url: 'https://api.hcnsec.cn/api/usage/token',
        chat_path: '/v1/chat/completions',
        models: SMART_CHAT_MODELS_HCNSEC,
        default_model: 'auto',
        model_labels: {
            auto: 'auto（智能路由）',
        },
    },
    nvidia: {
        id: 'nvidia',
        name: '英伟达 NIM',
        website: 'https://build.nvidia.com/',
        docs: 'https://docs.api.nvidia.com/nim/',
        base_url: 'https://integrate.api.nvidia.com/v1',
        /** 官方无余额接口；留空，额度页展示本地 RPM 统计 */
        balance_url: '',
        chat_path: '/chat/completions',
        models: SMART_CHAT_MODELS_NVIDIA,
        default_model: 'deepseek-ai/deepseek-v4-flash',
        model_labels: {
            'deepseek-ai/deepseek-v4-flash': 'deepseek-v4-flash（Free）',
            'deepseek-ai/deepseek-v4-pro': 'deepseek-v4-pro（Pro）',
            'openai/gpt-oss-120b': 'gpt-oss-120b',
            'openai/gpt-oss-20b': 'gpt-oss-20b',
            'z-ai/glm-5.2': 'glm-5.2',
            'minimaxai/minimax-m3': 'Minimax-M3',
            'mistralai/mistral-medium-3.5-128b': 'mistral-medium-3.5-128b',
            'nvidia/nemotron-3-super-120b-a12b': 'nemotron-3-super-120b',
        },
    },
};

export function normalizeSmartChatVendor(raw: unknown, hintBaseUrl?: string): SmartChatVendorId {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'hcnsec' || v === '幻城' || v === 'xinjiang' || v === 'iamhc') return 'hcnsec';
    if (v === 'nvidia' || v === 'nim' || v === '英伟达' || v === 'nvidia-nim' || v === 'nvidianim') return 'nvidia';
    if (v === 'deepseek' || v === '深度求索') return 'deepseek';
    const base = String(hintBaseUrl || '').toLowerCase();
    if (base.includes('hcnsec.cn') || base.includes('iamhc.cn')) return 'hcnsec';
    if (base.includes('nvidia.com') || base.includes('integrate.api.nvidia')) return 'nvidia';
    return 'deepseek';
}

export function getVendorPreset(vendor: SmartChatVendorId): SmartChatVendorPreset {
    return SMART_CHAT_VENDOR_PRESETS[vendor] || SMART_CHAT_VENDOR_PRESETS.deepseek;
}

export function normalizeSmartChatModel(raw: unknown, vendor: SmartChatVendorId = 'deepseek'): string {
    const m = String(raw || '').trim();
    const preset = getVendorPreset(vendor);
    if (preset.models.includes(m)) return m;
    // 兼容历史大小写差异（如 Kimi-K2.6）
    const lower = m.toLowerCase();
    const hit = preset.models.find((x) => x.toLowerCase() === lower);
    if (hit) return hit;
    return preset.default_model;
}

export function defaultWebSearchKeys() {
    return {
        tavily_key: '',
        serper_key: '',
        bocha_key: '',
    };
}

export function defaultImageRecognizeSettings(): SmartChatImageRecognizeSettings {
    return {
        timeout_sec: 30,
        queue_normal: 3,
        queue_at: 3,
        per_msg_normal: 3,
        per_msg_at: 2,
    };
}

export function defaultSmartChatConfig(): SmartChatConfig {
    const preset = SMART_CHAT_VENDOR_PRESETS.deepseek;
    return {
        vendor: 'deepseek',
        api_key: '',
        base_url: preset.base_url,
        balance_url: preset.balance_url,
        model: preset.default_model,
        temperature: 0.7,
        max_tokens: 2048,
        debounce_ms: 8000,
        max_batch: 12,
        kb_top_m: 3,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        reply_gap_ms: 1200,
        shut_up_limit: 5,
        action_min: 0,
        action_max: 3,
        price_prompt_per_million: 0,
        price_completion_per_million: 0,
        private_chat_enabled: true,
        tools_enabled: false,
        tools_max_rounds: 3,
        web_search: defaultWebSearchKeys(),
        image_recognize: defaultImageRecognizeSettings(),
    };
}

function normalizeWebSearchKeys(raw: unknown) {
    const d = defaultWebSearchKeys();
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
        tavily_key: String(o.tavily_key ?? d.tavily_key).trim(),
        serper_key: String(o.serper_key ?? d.serper_key).trim(),
        bocha_key: String(o.bocha_key ?? d.bocha_key).trim(),
    };
}

function normalizeImageRecognizeSettings(raw: unknown): SmartChatImageRecognizeSettings {
    const d = defaultImageRecognizeSettings();
    const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    let timeoutSec = d.timeout_sec;
    if (o.timeout_sec != null) timeoutSec = Number(o.timeout_sec);
    else if (o.timeout_ms != null) timeoutSec = Number(o.timeout_ms) / 1000;
    return {
        timeout_sec: clampNum(timeoutSec, 5, 120, d.timeout_sec),
        queue_normal: clampNum(o.queue_normal ?? o.queue_limit, 1, 20, d.queue_normal),
        queue_at: clampNum(o.queue_at ?? o.queue_limit, 1, 20, d.queue_at),
        per_msg_normal: clampNum(o.per_msg_normal, 1, 10, d.per_msg_normal),
        per_msg_at: clampNum(o.per_msg_at, 1, 10, d.per_msg_at),
    };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
    const n = Number(v);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** 行为限制：0–10，min≤max，禁止 max=0（即禁止 0-0） */
export function normalizeActionRange(
    minRaw: unknown,
    maxRaw: unknown,
    fallbackMin: number,
    fallbackMax: number,
): { action_min: number; action_max: number } {
    let min = clampNum(minRaw, 0, 10, fallbackMin);
    let max = clampNum(maxRaw, 0, 10, fallbackMax);
    if (max < 1) max = Math.max(1, fallbackMax);
    if (min > max) min = max;
    return { action_min: min, action_max: max };
}

export function normalizeSmartChatConfig(raw: Record<string, unknown> | null | undefined): SmartChatConfig {
    const d = defaultSmartChatConfig();
    if (!raw || typeof raw !== 'object') return d;
    let systemPrompt = String(raw.system_prompt ?? d.system_prompt);
    if (LEGACY_SYSTEM_PROMPTS.includes(systemPrompt)) {
        systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    const range = normalizeActionRange(raw.action_min, raw.action_max, d.action_min, d.action_max);
    const hintBase = String(raw.base_url ?? d.base_url);
    const vendor = normalizeSmartChatVendor(raw.vendor, hintBase);
    const preset = getVendorPreset(vendor);
    // 厂商切换后若仍是对方默认 URL，自动对齐预设；用户自定义 URL 则保留
    let base_url = String(raw.base_url ?? d.base_url).replace(/\/+$/, '');
    let balance_url = String(raw.balance_url ?? d.balance_url).trim();
    const otherBases = Object.values(SMART_CHAT_VENDOR_PRESETS)
        .filter((p) => p.id !== vendor)
        .map((p) => p.base_url);
    const otherBalances = Object.values(SMART_CHAT_VENDOR_PRESETS)
        .filter((p) => p.id !== vendor)
        .map((p) => p.balance_url);
    if (!base_url || otherBases.includes(base_url)) base_url = preset.base_url;
    if (!balance_url || otherBalances.includes(balance_url)) balance_url = preset.balance_url;

    return {
        vendor,
        api_key: String(raw.api_key ?? d.api_key),
        base_url,
        balance_url,
        model: normalizeSmartChatModel(raw.model ?? d.model, vendor),
        temperature: clampNum(raw.temperature, 0, 2, d.temperature),
        max_tokens: clampNum(raw.max_tokens, 64, 16384, d.max_tokens),
        debounce_ms: clampNum(raw.debounce_ms, 1000, 120000, d.debounce_ms),
        max_batch: clampNum(raw.max_batch, 1, 25, d.max_batch),
        kb_top_m: clampNum(raw.kb_top_m, 0, 20, d.kb_top_m),
        system_prompt: systemPrompt,
        reply_gap_ms: clampNum(raw.reply_gap_ms, 400, 8000, d.reply_gap_ms),
        shut_up_limit: clampNum(raw.shut_up_limit, 1, 50, d.shut_up_limit),
        action_min: range.action_min,
        action_max: range.action_max,
        price_prompt_per_million: clampNum(raw.price_prompt_per_million, 0, 9999, d.price_prompt_per_million),
        price_completion_per_million: clampNum(raw.price_completion_per_million, 0, 9999, d.price_completion_per_million),
        private_chat_enabled: raw.private_chat_enabled !== false && raw.private_chat_enabled !== 'false',
        tools_enabled: raw.tools_enabled === true || raw.tools_enabled === 'true' || raw.tools_enabled === 1,
        tools_max_rounds: clampNum(raw.tools_max_rounds, 1, 5, d.tools_max_rounds),
        web_search: normalizeWebSearchKeys(raw.web_search),
        image_recognize: normalizeImageRecognizeSettings(raw.image_recognize),
    };
}

export function loadSmartChatConfig(deps: SmartChatDeps): SmartChatConfig {
    const raw = deps.readA(CONFIG_FILE);
    if (!raw) return defaultSmartChatConfig();
    try {
        const parsed = JSON.parse(raw);
        const beforePrompt = String(parsed?.system_prompt ?? '');
        const cfg = normalizeSmartChatConfig(parsed);
        if (LEGACY_SYSTEM_PROMPTS.includes(beforePrompt)) {
            try {
                deps.writeA(CONFIG_FILE, JSON.stringify(cfg, null, 2));
            } catch {
                /* ignore */
            }
        }
        return cfg;
    } catch {
        return defaultSmartChatConfig();
    }
}

export function saveSmartChatConfig(deps: SmartChatDeps, cfg: SmartChatConfig): { fingerprint: string; fingerprintChanged: boolean; previousFingerprint: string | null } {
    const normalized = normalizeSmartChatConfig(cfg);
    const prev = lastSavedFingerprint ?? sessionConfigFingerprint(loadSmartChatConfig(deps));
    const fp = sessionConfigFingerprint(normalized);
    deps.writeA(CONFIG_FILE, JSON.stringify(normalized, null, 2));
    const fingerprintChanged = Boolean(prev) && prev !== fp;
    lastSavedFingerprint = fp;
    return { fingerprint: fp, fingerprintChanged, previousFingerprint: prev === fp ? null : prev };
}

export function maskApiKey(key: string): string {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '****';
    return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export function configForWeb(cfg: SmartChatConfig): SmartChatConfig & {
    api_key_masked: string;
    api_key_set: boolean;
    session_fingerprint: string;
    session_fingerprint_preview: string;
    web_search_masked: Record<string, string | boolean>;
    web_search_ready: boolean;
    vendor_meta: SmartChatVendorPreset;
    vendors: Array<Pick<SmartChatVendorPreset, 'id' | 'name' | 'website' | 'docs'>>;
    /** 当前代码内置默认 system（供 WebUI「恢复默认」） */
    default_system_prompt: string;
} {
    const fp = sessionConfigFingerprint(cfg);
    lastSavedFingerprint = fp;
    const ws = cfg.web_search || defaultWebSearchKeys();
    const web_search_masked = {
        tavily_key: ws.tavily_key ? maskApiKey(ws.tavily_key) : '',
        tavily_set: Boolean(ws.tavily_key),
        serper_key: ws.serper_key ? maskApiKey(ws.serper_key) : '',
        serper_set: Boolean(ws.serper_key),
        bocha_key: ws.bocha_key ? maskApiKey(ws.bocha_key) : '',
        bocha_set: Boolean(ws.bocha_key),
    };
    const vendor_meta = getVendorPreset(cfg.vendor || 'deepseek');
    return {
        ...cfg,
        api_key_masked: maskApiKey(cfg.api_key),
        api_key_set: Boolean(String(cfg.api_key || '').trim()),
        api_key: cfg.api_key ? maskApiKey(cfg.api_key) : '',
        web_search: {
            tavily_key: web_search_masked.tavily_key,
            serper_key: web_search_masked.serper_key,
            bocha_key: web_search_masked.bocha_key,
        },
        web_search_masked,
        default_system_prompt: DEFAULT_SYSTEM_PROMPT,
        web_search_ready: Boolean(ws.tavily_key || ws.serper_key || ws.bocha_key),
        session_fingerprint: fp,
        session_fingerprint_preview: fingerprintPreview(fp),
        vendor_meta,
        vendors: Object.values(SMART_CHAT_VENDOR_PRESETS).map((p) => ({
            id: p.id,
            name: p.name,
            website: p.website,
            docs: p.docs,
        })),
    };
}
