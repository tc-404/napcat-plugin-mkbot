// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 会话绑定指纹（配置 byte-identical → 同一会话命名空间）
// ---------------------------------------------------------------------------
//
// 下列字段任一变更（规范化后字符串不完全一致）→ 新指纹 → 旧会话不再参与对话。
// 改回与某次保存完全一致的配置 → 指纹相同 → 自动回到对应会话数据。
//
// 注意：本文件不依赖 smart-chat-config，避免循环引用；调用方应先 normalize。
// 搜索 API Key 不参与指纹（换 Key 不切会话）；tools_enabled 参与（工具契约变化）。

import crypto from 'crypto';

/** 参与会话隔离的配置字段（与后台「模型/上下文」相关项对齐） */
export interface SessionBindingPayload {
    api_key: string;
    base_url: string;
    balance_url: string;
    model: string;
    temperature: number;
    max_tokens: number;
    debounce_ms: number;
    kb_top_m: number;
    system_prompt: string;
    shut_up_limit: number;
    action_min: number;
    action_max: number;
    tools_enabled: boolean;
}

export function buildSessionBindingPayload(cfg: Record<string, unknown> | null | undefined): SessionBindingPayload {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    return {
        api_key: String(c.api_key ?? ''),
        base_url: String(c.base_url ?? '').replace(/\/+$/, ''),
        balance_url: String(c.balance_url ?? '').trim(),
        model: String(c.model ?? ''),
        temperature: Number(c.temperature ?? 0),
        max_tokens: Number(c.max_tokens ?? 0),
        debounce_ms: Number(c.debounce_ms ?? 0),
        kb_top_m: Number(c.kb_top_m ?? 0),
        system_prompt: String(c.system_prompt ?? ''),
        shut_up_limit: Number(c.shut_up_limit ?? 0),
        action_min: Number(c.action_min ?? 0),
        action_max: Number(c.action_max ?? 0),
        tools_enabled: c.tools_enabled === true || c.tools_enabled === 'true' || c.tools_enabled === 1,
    };
}

/** 稳定序列化：固定字段顺序，避免 JSON key 顺序漂移 */
export function sessionBindingCanonical(cfg: Record<string, unknown> | null | undefined): string {
    const p = buildSessionBindingPayload(cfg);
    return [
        'api_key=' + p.api_key,
        'base_url=' + p.base_url,
        'balance_url=' + p.balance_url,
        'model=' + p.model,
        'temperature=' + String(p.temperature),
        'max_tokens=' + String(p.max_tokens),
        'debounce_ms=' + String(p.debounce_ms),
        'kb_top_m=' + String(p.kb_top_m),
        'system_prompt=' + p.system_prompt,
        'shut_up_limit=' + String(p.shut_up_limit),
        'action_min=' + String(p.action_min),
        'action_max=' + String(p.action_max),
        'tools_enabled=' + (p.tools_enabled ? '1' : '0'),
    ].join('\n');
}

export function sessionConfigFingerprint(cfg: Record<string, unknown> | null | undefined): string {
    const raw = sessionBindingCanonical(cfg);
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
}

export function fingerprintPreview(fp: string): string {
    const s = String(fp || '');
    if (s.length <= 8) return s || '—';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
