// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 入站事件元数据（引用 / 艾特，供上下文标注）
// ---------------------------------------------------------------------------

export interface InboundMessageMeta {
    replyToId?: string;
    atQqs: string[];
}

/** 从 OneBot 消息段提取 reply / at（不依赖 CQ 字符串） */
export function extractInboundMeta(event: Record<string, unknown>): InboundMessageMeta {
    const atQqs: string[] = [];
    let replyToId: string | undefined;
    const message = event?.message;
    const segs = Array.isArray(message)
        ? message
        : (typeof message === 'object' && message && Array.isArray((message as { message?: unknown }).message)
            ? (message as { message: unknown[] }).message
            : []);

    for (const seg of segs) {
        if (!seg || typeof seg !== 'object') continue;
        const type = String((seg as { type?: string }).type || '').toLowerCase();
        const data = (seg as { data?: Record<string, unknown> }).data || {};
        if (type === 'reply') {
            const id = String(data.id ?? data.message_id ?? '').trim();
            if (id) replyToId = id;
        }
        if (type === 'at') {
            const qq = String(data.qq ?? '').trim();
            if (qq && qq !== 'all' && /^\d+$/.test(qq) && !atQqs.includes(qq)) {
                atQqs.push(qq);
            }
        }
    }

    // 部分宿主把 reply 放在 event 顶层
    if (!replyToId && event.message_id != null && event.message_type) {
        /* no-op: 自身 id 不是被引用 */
    }
    const rawReply = (event as { reply?: unknown }).reply
        || (event as { source?: { message_id?: unknown } }).source?.message_id;
    if (!replyToId && rawReply != null) {
        const id = String(rawReply).trim();
        if (id) replyToId = id;
    }

    return { replyToId, atQqs };
}
