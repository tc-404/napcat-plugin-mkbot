// @ts-nocheck
// SnowLuma 协议兼容：探测、合并转发嵌套格式、OB11 响应解析、收消息文本提取

/** 插件 config.json → mkbot_protocol_backend: auto | snowluma | napcat */
export type MkProtocolBackendSetting = 'auto' | 'snowluma' | 'napcat';

let configBackend: MkProtocolBackendSetting = 'auto';
/** 探测结果；config 强制 napcat/snowluma 时同步写入 */
let resolvedSnowLuma: boolean | null = null;
const probeCache = new Map<string, boolean>();
let lastProbeCtxKey = '';

function ctxProbeKey(ctx) {
  const fw = ctx?.frameworkEnv;
  const conn = ctx?.connectionId ?? fw?.connectionId ?? '';
  return `${fw?.frameworkId ?? 'unknown'}:${conn}`;
}

export function mkSetProtocolBackendSetting(value) {
  const v = String(value ?? 'auto').trim().toLowerCase();
  if (v === 'snowluma' || v === 'napcat') {
    configBackend = v;
    resolvedSnowLuma = v === 'snowluma';
    return;
  }
  configBackend = 'auto';
  resolvedSnowLuma = null;
}

export function mkIsSnowLumaBackend() {
  if (configBackend === 'snowluma') return true;
  if (configBackend === 'napcat') return false;
  return resolvedSnowLuma === true;
}

export function mkIsSnowLumaBackendForCtx(ctx) {
  if (configBackend === 'snowluma') return true;
  if (configBackend === 'napcat') return false;
  const key = ctxProbeKey(ctx);
  if (probeCache.has(key)) return probeCache.get(key) === true;
  return resolvedSnowLuma === true;
}

function isOb11NodeSegment(seg) {
  return seg && typeof seg === 'object' && String(seg.type ?? '').toLowerCase() === 'node';
}

/** SnowLuma：node.content 须为纯 {type:node}[] 才识别为嵌套合并 */
export function mkIsPureOb11NodeArray(content) {
  if (!Array.isArray(content) || content.length === 0) return false;
  for (const item of content) {
    if (!isOb11NodeSegment(item)) return false;
  }
  return true;
}

function isNapCatInlineForwardMarker(seg) {
  return (
    seg &&
    typeof seg === 'object' &&
    String(seg.type ?? '').toLowerCase() === 'forward' &&
    String(seg.data?.id ?? '') === '0'
  );
}

/**
 * 将 NapCat 内联嵌套（prefix + forward id:0 + node…）转为 SnowLuma 纯 node 数组。
 * buildOb11Node: (logicalNode, defaultUin) => { type:'node', data }
 */
export function mkConvertForwardContentToSnowLuma(content, defaultUin, buildOb11Node) {
  if (!Array.isArray(content)) return content;
  if (mkIsPureOb11NodeArray(content)) {
    return content.map((n) => mkNormalizeOb11NodeTree(n, defaultUin, buildOb11Node));
  }

  const prefix = [];
  const inlineNodes = [];
  let i = 0;
  let sawInlineForward = false;

  for (; i < content.length; i++) {
    const seg = content[i];
    if (isNapCatInlineForwardMarker(seg)) {
      sawInlineForward = true;
      i++;
      break;
    }
    prefix.push(seg);
  }

  if (sawInlineForward) {
    for (; i < content.length; i++) {
      const seg = content[i];
      if (isOb11NodeSegment(seg)) inlineNodes.push(seg);
    }
    const out = [];
    if (prefix.length) {
      out.push({
        type: 'node',
        data: {
          name: '用户',
          uin: String(defaultUin),
          content: prefix,
        },
      });
    }
    for (const n of inlineNodes) {
      out.push(mkNormalizeOb11NodeTree(n, defaultUin, buildOb11Node));
    }
    return out.length ? out : [{ type: 'node', data: { name: '用户', uin: String(defaultUin), content: [段_文本('')] } }];
  }

  return content;
}

function 段_文本(text) {
  return { type: 'text', data: { text: String(text ?? '') } };
}

/** 递归规范化已构建的 OB11 node 树（内层 NapCat 嵌套 → SnowLuma） */
export function mkNormalizeOb11NodeTree(ob11Node, defaultUin, buildOb11Node) {
  if (!isOb11NodeSegment(ob11Node)) return ob11Node;
  const data = ob11Node.data && typeof ob11Node.data === 'object' ? { ...ob11Node.data } : {};
  const uin = String(data.uin ?? data.user_id ?? defaultUin);
  let content = data.content ?? data.message ?? [];

  if (Array.isArray(data._mkNestedChildren)) {
    const childOb11 = (data._mkNestedChildren || []).map((c) =>
      buildOb11Node(c, uin),
    );
    const prefix = Array.isArray(data._mkNestedPrefix) ? data._mkNestedPrefix : [];
    content = [];
    if (prefix.length) {
      content.push({
        type: 'node',
        data: { name: data.name || '用户', uin, content: prefix },
      });
    }
    content.push(...childOb11);
  } else if (Array.isArray(content)) {
    content = mkConvertForwardContentToSnowLuma(content, uin, buildOb11Node);
  }

  const cleaned = { ...data };
  delete cleaned._mkNestedChildren;
  delete cleaned._mkNestedPrefix;

  return {
    type: 'node',
    data: {
      ...cleaned,
      uin,
      content,
    },
  };
}

/** 构建嵌套合并 OB11 node（按当前协议分支） */
export function mkBuildNestedForwardOb11Node(name, uin, childOb11Nodes, prefixContent, extra = {}) {
  const displayName = name || '用户';
  const qq = String(uin);

  if (mkIsSnowLumaBackend()) {
    const content = [];
    if (Array.isArray(prefixContent) && prefixContent.length) {
      content.push({
        type: 'node',
        data: { name: displayName, uin: qq, content: prefixContent },
      });
    }
    content.push(...childOb11Nodes);
    const data = { name: displayName, uin: qq, content };
    if (extra.time != null) data.time = extra.time;
    return { type: 'node', data };
  }

  const content = [
    ...(Array.isArray(prefixContent) ? prefixContent : []),
    { type: 'forward', data: { id: '0' } },
    ...childOb11Nodes,
  ];
  const data = { name: displayName, uin: qq, content };
  if (extra.time != null) data.time = extra.time;
  return { type: 'node', data };
}

/** SnowLuma / OB11 标准响应取 data 层 */
export function mkExtractBotApiPayload(result) {
  if (result == null) return result;
  if (typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  if (result.data != null && (result.retcode != null || result.status != null)) {
    return result.data;
  }
  return result;
}

/** get_version_info 等探测是否为 SnowLuma */
export async function mkProbeSnowLumaBackend(ctx, callAction) {
  if (configBackend === 'snowluma') {
    resolvedSnowLuma = true;
    return true;
  }
  if (configBackend === 'napcat') {
    resolvedSnowLuma = false;
    return false;
  }

  const key = ctxProbeKey(ctx);
  if (probeCache.has(key)) {
    resolvedSnowLuma = probeCache.get(key) === true;
    return resolvedSnowLuma;
  }

  try {
    const raw = await callAction('get_version_info', {});
    const info = mkExtractBotApiPayload(raw) ?? raw;
    const appName = String(info?.app_name ?? info?.appName ?? '').toLowerCase();
    const isSnow = appName.includes('snowluma');
    probeCache.set(key, isSnow);
    resolvedSnowLuma = isSnow;
    lastProbeCtxKey = key;
    return isSnow;
  } catch (_e) {
    probeCache.set(key, false);
    if (lastProbeCtxKey === key || resolvedSnowLuma == null) {
      resolvedSnowLuma = false;
    }
    return false;
  }
}

export async function mkEnsureProtocolBackend(ctx, callAction) {
  mkSyncProtocolBackendFromFramework(ctx);
  if (configBackend !== 'auto') return mkIsSnowLumaBackend();
  return mkProbeSnowLumaBackend(ctx, callAction);
}

/** NapCat Desktop bot.json backend_type:snowluma 等宿主提示 */
export function mkSyncProtocolBackendFromFramework(ctx) {
  const fw = ctx?.frameworkEnv;
  if (!fw || typeof fw !== 'object') return;
  const hint = String(
    fw.protocolBackend ?? fw.backendType ?? fw.backend_type ?? '',
  ).toLowerCase();
  if (hint === 'snowluma') {
    configBackend = 'snowluma';
    resolvedSnowLuma = true;
  }
}

/** SnowLuma 上报 HTML 实体解码 */
export function decodeObHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function resolveEventPlainMessage(event) {
  let fromSegs = '';
  if (typeof event?.message === 'string' && event.message.trim()) {
    fromSegs = decodeObHtmlEntities(event.message);
  } else if (Array.isArray(event?.message)) {
    for (const seg of event.message) {
      if (!seg || typeof seg !== 'object') continue;
      if (seg.type === 'text' && seg.data?.text != null) {
        fromSegs += decodeObHtmlEntities(String(seg.data.text));
      }
    }
  }
  const raw = decodeObHtmlEntities(String(event?.raw_message ?? ''));
  if (fromSegs.length > raw.length) return fromSegs;
  if (raw) return raw;
  return fromSegs;
}

/** 违禁词检测：跳过 image/video，其余段从 OB11 message JSON 提取可见文本（不扫 CQ/raw/url） */
const FORBIDDEN_WORD_SKIP_SEG_TYPES = new Set(['image', 'video']);

function pushForbiddenWordTextPart(parts: string[], value: unknown) {
  if (value == null) return;
  const text = decodeObHtmlEntities(String(value));
  if (text) parts.push(text);
}

function extractJsonSegmentVisibleText(data: unknown): string {
  if (data == null) return '';
  let obj: Record<string, unknown> | null = null;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
      else return decodeObHtmlEntities(trimmed);
    } catch {
      return decodeObHtmlEntities(trimmed);
    }
  } else if (typeof data === 'object' && !Array.isArray(data)) {
    obj = data as Record<string, unknown>;
  }
  if (!obj) return '';
  const parts: string[] = [];
  const dataField = obj.data;
  if (typeof dataField === 'string' && dataField.trim()) {
    try {
      const inner = JSON.parse(dataField);
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        obj = inner as Record<string, unknown>;
      }
    } catch {
      return decodeObHtmlEntities(dataField);
    }
  } else if (dataField && typeof dataField === 'object' && !Array.isArray(dataField)) {
    obj = dataField as Record<string, unknown>;
  }
  for (const key of ['text', 'title', 'content', 'desc', 'prompt', 'summary', 'keyword']) {
    pushForbiddenWordTextPart(parts, obj[key]);
  }
  const nested = obj.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const key of ['text', 'title', 'content', 'desc', 'prompt', 'summary']) {
      pushForbiddenWordTextPart(parts, (nested as Record<string, unknown>)[key]);
    }
  }
  return parts.join('\n');
}

function extractFaceSegmentText(data: Record<string, unknown>): string {
  const parts: string[] = [];
  pushForbiddenWordTextPart(parts, data.faceText);
  const raw = data.raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    pushForbiddenWordTextPart(parts, (raw as Record<string, unknown>).faceText);
  }
  return parts.join('\n');
}

/** 群管/问答/发言限制等：仅从 OB11 text 段提取用户输入（不含 CQ/raw/url/其它段） */
export function eventUserTextFromSegments(event: unknown): string {
  const e = event as { message?: unknown };
  if (Array.isArray(e?.message)) {
    const parts: string[] = [];
    for (const seg of e.message) {
      if (!seg || typeof seg !== 'object') continue;
      const typed = seg as { type?: string; data?: { text?: unknown } };
      if (typed.type === 'text' && typed.data?.text != null) {
        pushForbiddenWordTextPart(parts, typed.data.text);
      }
    }
    return parts.join('');
  }
  if (typeof e?.message === 'string') {
    const s = decodeObHtmlEntities(e.message);
    if (s && !/\[CQ:/i.test(s)) return s;
  }
  return '';
}

/** 从 OB11 message 段数组拼接违禁词匹配用文本 */
export function collectForbiddenWordMatchText(segments: unknown): string {
  if (!Array.isArray(segments)) return '';
  const parts: string[] = [];

  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue;
    const typed = seg as {
      type?: string;
      data?: Record<string, unknown>;
      message?: unknown;
    };
    const type = String(typed.type ?? '').toLowerCase();
    const data = typed.data && typeof typed.data === 'object' ? typed.data : {};

    if (FORBIDDEN_WORD_SKIP_SEG_TYPES.has(type)) continue;

    if (type === 'text') {
      pushForbiddenWordTextPart(parts, data.text);
      continue;
    }
    if (type === 'face') {
      const faceText = extractFaceSegmentText(data);
      if (faceText) parts.push(faceText);
      continue;
    }
    if (type === 'json' || type === 'xml') {
      const jsonText = extractJsonSegmentVisibleText(data);
      if (jsonText) parts.push(jsonText);
      continue;
    }
    if (type === 'forward' || type === 'node') {
      if (Array.isArray(data.content)) parts.push(collectForbiddenWordMatchText(data.content));
      continue;
    }
    if (Array.isArray(typed.message)) {
      parts.push(collectForbiddenWordMatchText(typed.message));
    }
  }

  return parts.filter(Boolean).join('\n');
}

/** 从事件对象提取违禁词匹配文本（仅 OB11 JSON 段；string 消息仅接受无 CQ 的纯文本） */
export function eventForbiddenWordMatchText(event: unknown): string {
  const e = event as { message?: unknown };
  if (Array.isArray(e?.message)) {
    return collectForbiddenWordMatchText(e.message);
  }
  if (typeof e?.message === 'string') {
    const s = decodeObHtmlEntities(e.message);
    if (s && !/\[CQ:/i.test(s)) return s;
  }
  return '';
}

export function forbiddenWordsMatchText(haystack: unknown, words: unknown): boolean {
  const hay = String(haystack ?? '');
  if (!hay || !Array.isArray(words) || words.length === 0) return false;
  for (const word of words) {
    const key = String(word ?? '');
    if (key && hay.includes(key)) return true;
  }
  return false;
}

export function eventMessagePlainText(event) {
  const parts = [];
  const raw = decodeObHtmlEntities(String(event?.raw_message ?? '').trim());
  if (raw) parts.push(raw);
  const segText = resolveEventPlainMessage(event);
  if (segText && segText !== raw) parts.push(segText);
  if (Array.isArray(event?.message)) {
    for (const seg of event.message) {
      if (!seg || typeof seg !== 'object') continue;
      const t = String(seg.type || '');
      if (t === 'json' || t === 'xml') {
        try {
          parts.push(JSON.stringify(seg.data ?? {}));
        } catch {
          parts.push(String(seg.data ?? ''));
        }
      }
    }
  }
  return parts.join('\n');
}

export function isQqRedPacketLikeEvent(event) {
  const hay = eventMessagePlainText(event);
  if (/QQ红包|qq红包|红包/i.test(hay)) return true;
  const raw0 = String(event?.raw_message ?? '');
  const emptyLegacy =
    raw0 === '' && (!event?.message || (Array.isArray(event.message) && event.message.length === 0));
  return emptyLegacy;
}

/** OB11 参数：SnowLuma 对 message_id 等字段类型一致，保持数字规范化 */
export function normalizeObActionParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const p = { ...params };
  for (const k of ['group_id', 'user_id', 'message_id']) {
    if (p[k] == null || p[k] === '') continue;
    const n = Number(p[k]);
    if (Number.isFinite(n)) p[k] = n;
  }
  return p;
}

/**
 * 入群私聊等：segments 中含 forward 子段时，按协议写入 content。
 * flatPrefix：forward 之前的平铺段；forwardChildren：已构建的 OB11 node 列表。
 */
export function mkAppendInlineForwardToContent(flatPrefix, forwardChildren, defaultUin, displayName) {
  if (mkIsSnowLumaBackend()) {
    const nodes = [];
    if (Array.isArray(flatPrefix) && flatPrefix.length) {
      nodes.push({
        type: 'node',
        data: {
          name: displayName || '用户',
          uin: String(defaultUin),
          content: flatPrefix,
        },
      });
    }
    if (Array.isArray(forwardChildren)) nodes.push(...forwardChildren);
    return nodes.length ? nodes : [{ type: 'text', data: { text: '' } }];
  }
  const out = [...(flatPrefix || [])];
  out.push({ type: 'forward', data: { id: '0' } });
  if (Array.isArray(forwardChildren)) out.push(...forwardChildren);
  return out.length ? out : [{ type: 'text', data: { text: '' } }];
}
