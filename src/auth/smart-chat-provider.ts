// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — Provider（OpenAI 兼容 chat/completions + tools）
// ---------------------------------------------------------------------------

import type { CompletionUsage, SmartChatConfig } from './smart-chat-types';
import { getVendorPreset, normalizeSmartChatVendor } from './smart-chat-config';
import { noteNvidiaRequest } from './smart-chat-nvidia-rate';

export interface ToolCallResult {
    id: string;
    type: string;
    function: { name: string; arguments: string };
}

export interface CompletionResult {
    ok: boolean;
    content?: string;
    tool_calls?: ToolCallResult[];
    usage?: CompletionUsage;
    error?: string;
}

export type ChatMessage =
    | { role: string; content: string | null; tool_calls?: ToolCallResult[] }
    | { role: 'tool'; tool_call_id: string; content: string };

/** DeepSeek 等模型偶发把工具调用写成正文 DSML/XML，而不是 API tool_calls */
const DSML_PIPE = '[|｜]{0,4}';

export function looksLikeToolMarkup(raw: string | null | undefined): boolean {
    const t = String(raw || '');
    if (!t.trim()) return false;
    if (/DSML/i.test(t) && /(?:tool_calls|invoke|parameter)/i.test(t)) return true;
    if (/<\/?tool_calls?\b/i.test(t)) return true;
    if (/<invoke\b[^>]*\bname\s*=/i.test(t) && /<\/?parameter\b/i.test(t)) return true;
    return false;
}

/** 去掉 DSML / tool XML，留下可读正文（若有） */
export function stripToolMarkup(raw: string | null | undefined): string {
    let s = String(raw || '');
    // <｜｜DSML｜｜tag>...</｜｜DSML｜｜tag> 或 <|DSML|...>
    const openClose = new RegExp(
        `<\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*[\\w-]+\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*[\\w-]+\\s*>`,
        'gi',
    );
    const selfOrOpen = new RegExp(
        `<\\s*/?\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*[\\w-]*\\b[^>]*>`,
        'gi',
    );
    s = s.replace(openClose, ' ');
    s = s.replace(selfOrOpen, ' ');
    s = s.replace(/<\/?(?:tool_calls?|invoke|parameter)\b[^>]*>/gi, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

/**
 * 从正文里抠出 DSML / XML 风格工具调用，转成 OpenAI tool_calls。
 */
export function parseEmbeddedToolCalls(raw: string | null | undefined): ToolCallResult[] {
    const text = String(raw || '');
    if (!text.trim()) return [];
    const out: ToolCallResult[] = [];
    const invokeRe = new RegExp(
        `(?:<\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*invoke|<invoke)\\s+name\\s*=\\s*"([^"]+)"[^>]*>([\\s\\S]*?)(?:<\\s*/\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*invoke\\s*>|</invoke>)`,
        'gi',
    );
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = invokeRe.exec(text)) && out.length < 8) {
        const name = String(m[1] || '').trim();
        const body = m[2] || '';
        if (!name) continue;
        const args: Record<string, unknown> = {};
        const paramRe = new RegExp(
            `(?:<\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*parameter|<parameter)\\s+name\\s*=\\s*"([^"]+)"[^>]*>([\\s\\S]*?)(?:<\\s*/\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}\\s*parameter\\s*>|</parameter>)`,
            'gi',
        );
        let pm: RegExpExecArray | null;
        while ((pm = paramRe.exec(body))) {
            const key = String(pm[1] || '').trim();
            let val = String(pm[2] || '').trim();
            if (!key) continue;
            if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
            if (/^(true|false)$/i.test(val)) args[key] = /^true$/i.test(val);
            else if (/^-?\d+(\.\d+)?$/.test(val)) args[key] = Number(val);
            else args[key] = val;
        }
        idx += 1;
        out.push({
            id: `dsml_${Date.now()}_${idx}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
        });
    }
    return out;
}

/** 若 API 未给 tool_calls 但正文是 DSML，则补齐；并清掉不应外发的工具标记 */
export function normalizeCompletionTools(result: CompletionResult): CompletionResult {
    if (!result?.ok) return result;
    let content = result.content;
    let tool_calls = result.tool_calls;
    if ((!tool_calls || !tool_calls.length) && looksLikeToolMarkup(content)) {
        const parsed = parseEmbeddedToolCalls(content);
        if (parsed.length) tool_calls = parsed;
    }
    if (looksLikeToolMarkup(content)) {
        const stripped = stripToolMarkup(content);
        content = stripped || undefined;
    }
    return {
        ...result,
        content,
        tool_calls: tool_calls?.length ? tool_calls : undefined,
    };
}

function mergeUsage(a?: CompletionUsage, b?: CompletionUsage): CompletionUsage | undefined {
    if (!a && !b) return undefined;
    if (!a) return b;
    if (!b) return a;
    return {
        prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
        completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
        total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
        prompt_cache_hit_tokens: (a.prompt_cache_hit_tokens || 0) + (b.prompt_cache_hit_tokens || 0) || undefined,
        prompt_cache_miss_tokens: (a.prompt_cache_miss_tokens || 0) + (b.prompt_cache_miss_tokens || 0) || undefined,
    };
}

export async function chatCompletion(
    config: SmartChatConfig,
    systemPrompt: string,
    messages: ChatMessage[],
    options?: { tools?: unknown[]; tool_choice?: string | object },
): Promise<CompletionResult> {
    const apiKey = String(config.api_key || '').trim();
    if (!apiKey) return { ok: false, error: 'api_key_not_configured' };

    const vendor = normalizeSmartChatVendor(config.vendor, config.base_url);
    const preset = getVendorPreset(vendor);
    const chatPath = preset.chat_path || '/v1/chat/completions';
    const url = `${config.base_url.replace(/\/+$/, '')}${chatPath.startsWith('/') ? chatPath : `/${chatPath}`}`;
    const body: Record<string, unknown> = {
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stream: false,
    };
    if (vendor === 'nvidia') {
        // 群聊场景默认关闭 thinking，避免 reasoning 烧额度且不外发
        body.top_p = 0.95;
        body.chat_template_kwargs = { thinking: false, enable_thinking: false };
    }
    if (options?.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.tool_choice ?? 'auto';
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        let resp: Response;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
        if (vendor === 'nvidia') {
            noteNvidiaRequest(null, {
                headers: resp.headers,
                status: resp.status,
                ok: resp.ok,
                error: resp.ok ? '' : `HTTP ${resp.status}`,
            });
        }
        const text = await resp.text();
        let data: Record<string, unknown> = {};
        try {
            data = JSON.parse(text);
        } catch {
            return { ok: false, error: `invalid_json: ${text.slice(0, 200)}` };
        }
        if (!resp.ok) {
            const errMsg = (data?.error as { message?: string })?.message || text.slice(0, 300);
            return { ok: false, error: errMsg };
        }
        const choices = data.choices as Array<{
            message?: {
                content?: string | null;
                reasoning?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                    id?: string;
                    type?: string;
                    function?: { name?: string; arguments?: string };
                }>;
            };
        }> | undefined;
        const msg = choices?.[0]?.message;
        // 只取最终 content；reasoning / reasoning_content 不进群聊
        const content = String(msg?.content ?? '').trim();
        const rawCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
        const tool_calls: ToolCallResult[] = rawCalls
            .filter((c) => c && (c.function?.name || c.id))
            .map((c) => ({
                id: String(c.id || ''),
                type: String(c.type || 'function'),
                function: {
                    name: String(c.function?.name || ''),
                    arguments: String(c.function?.arguments || '{}'),
                },
            }));
        const usageRaw = data.usage as Record<string, number> | undefined;
        const usage: CompletionUsage | undefined = usageRaw
            ? {
                  prompt_tokens: Number(usageRaw.prompt_tokens || 0),
                  completion_tokens: Number(usageRaw.completion_tokens || 0),
                  total_tokens: Number(usageRaw.total_tokens || 0),
                  prompt_cache_hit_tokens: Number(usageRaw.prompt_cache_hit_tokens || 0) || undefined,
                  prompt_cache_miss_tokens: Number(usageRaw.prompt_cache_miss_tokens || 0) || undefined,
              }
            : undefined;
        return normalizeCompletionTools({
            ok: true,
            content,
            tool_calls: tool_calls.length ? tool_calls : undefined,
            usage,
        });
    } catch (e) {
        if (vendor === 'nvidia') {
            noteNvidiaRequest(null, { ok: false, error: e?.message || String(e) });
        }
        const name = e?.name || '';
        const msg = e?.message || String(e);
        if (name === 'AbortError' || /aborted/i.test(msg)) {
            return { ok: false, error: 'upstream_timeout' };
        }
        return { ok: false, error: msg };
    }
}

/** 上游致命错误：不应再连打重试 */
export function isFatalUpstreamError(err: unknown): boolean {
    const e = String(err || '');
    return /fetch failed|upstream_timeout|aborted|timeout|econnreset|enotfound|econnrefused|network|no available channel|invalid.*(?:api[- ]?)?key|authentication|unauthorized|401|403|insufficient|余额不足|quota|令牌|token.*invalid|rate.?limit|too many requests|429/i.test(e);
}

/** 给群友看的简短中文报错 */
export function formatSmartChatApiError(err: unknown): string {
    const e = String(err || 'unknown');
    if (/no available channel/i.test(e)) {
        return '当前令牌分组用不了这个模型，请换模型或换有权限的令牌';
    }
    if (/fetch failed|upstream_timeout|timeout|aborted|econnreset|enotfound|econnrefused/i.test(e)) {
        return '上游 API 连不上或超时，请稍后重试，或换深度求索/其它线路';
    }
    if (/authentication|invalid.*(?:api[- ]?)?key|unauthorized|401/i.test(e)) {
        return 'API Key 无效或未授权，请检查密钥';
    }
    if (/insufficient|余额|quota|rate.?limit|429|too many requests/i.test(e)) {
        return '额度或限速不足，请稍后再试（英伟达免费档常见约 40 次/分钟）';
    }
    return e.length > 160 ? `${e.slice(0, 160)}…` : e;
}

export { mergeUsage };
