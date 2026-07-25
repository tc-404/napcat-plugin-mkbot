// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — Compose（Reasonix：cache-stable system + turn 尾）
// ---------------------------------------------------------------------------
//
// - system_prompt：整段会话 byte-stable，不在中途改写
// - session.messages：与送进 API 的内容 byte-identical（prepend-only）
// - 技能树自定义 Top-M：仅挂在「当前」user turn；写入 session 时一并保存，避免下次前缀漂移
// - compaction digest：已作为消息永久写入 session，不再每轮重复注入
// - host-state：本轮可变事实（行为范围、本轮上限、沉默、艾特主/次访问、话题延续等）
//   不写教做人的提示词；原则留给 system_prompt

import type { SmartChatBufferEntry, SmartChatConfig, SmartChatKnowledgeEntry, SmartChatSessionFile } from './smart-chat-types';
import { getPrependOnlyMessages, sliceMessagesByRounds } from './smart-chat-session';
import { TOOLS_SYSTEM_SUFFIX, toolsShouldAttach } from './smart-chat-tools';
import { IMAGE_RECOGNIZE_SYSTEM_SUFFIX, presentImageSupplementsForModel } from './smart-chat-image';
import { CHINA_SENSITIVE_SYSTEM_SUFFIX } from './smart-chat-safety';
import { PROTOCOL_SYSTEM_SUFFIX } from './smart-chat-knowledge';

export interface ComposedTurn {
    systemPrompt: string;
    apiMessages: Array<{ role: string; content: string }>;
    /** 与送进 API 的当前 user 消息完全一致，必须原样写入 session */
    userContentExact: string;
    userTurnPlain: string;
    knowledgeBlock: string;
}

/** 话题与上次访问的关系（供 host-state / 测调用） */
export type TopicContinuity = 'none' | 'related' | 'unrelated';

const TOPIC_STOPWORDS = new Set([
    '这个', '那个', '什么', '怎么', '怎样', '可以', '不是', '就是', '我们', '你们', '他们', '没有', '还是',
    '一个', '一下', '真的', '觉得', '知道', '然后', '因为', '所以', '如果', '已经', '现在', '时候',
    '东西', '问题', '直接', '出来', '过来', '起来', '这样', '那样', '哈哈', '呵呵', '嗯嗯', '好的',
    '收到', '谢谢', '请问', '大家', '自己', '怎么了', '怎么样', '为什么', '是不是', '有没有',
    '图片', '解析', '结果', '补充', '加载', '不出', '发了', '张图', '眼睛', '引用', '艾特',
    'msgid', 'http', 'https', 'www', 'com', 'html', 'json', 'null', 'true', 'false',
]);

function formatBatchLines(batch: SmartChatBufferEntry[]): string {
    return batch
        .map((b) => {
            const text = presentImageSupplementsForModel(b.text || '');
            // 纯眼睛备注：不挂昵称，避免被当成用户发言
            if (/^\[眼睛\s+msgid:/i.test(text.trim())) {
                return text.trim();
            }
            const nick = b.nickname || b.userId;
            let meta = '';
            if (b.messageId) meta += ` [msgid:${b.messageId}]`;
            if (b.replyToId) meta += ` [引用:${b.replyToId}]`;
            if (b.atQqs?.length) meta += ` [艾特:${b.atQqs.join(',')}]`;
            return `[${b.time}] ${nick}(${b.userId})${meta}: ${text}`;
        })
        .join('\n');
}

function buildSkillTreeBlock(entries: SmartChatKnowledgeEntry[]): string {
    if (!entries.length) return '';
    const lines = entries.map((e) => `${e.title.startsWith('◆') ? e.title : `◆ ${e.title}`}\n${e.content}`);
    return `<skill-tree>\n（本轮已装备的自定义技能；相关就释放，别当说明书背）\n${lines.join('\n\n')}\n</skill-tree>`;
}

function batchMentionsBot(batch: SmartChatBufferEntry[], selfId: string): boolean {
    const sid = String(selfId || '').trim();
    if (!sid) return false;
    return batch.some((b) => (b.atQqs || []).some((q) => String(q).trim() === sid));
}

function entryAtsBot(entry: SmartChatBufferEntry, selfId: string): boolean {
    const sid = String(selfId || '').trim();
    if (!sid) return false;
    return (entry.atQqs || []).some((q) => String(q).trim() === sid);
}

function eyeMsgidFromText(text: string): string | null {
    const m = String(text || '').match(/\[眼睛\s+msgid:(\d+)/i);
    return m ? m[1] : null;
}

/**
 * 艾特触发：艾特你的消息（及其眼睛补充）= 主访问；缓冲里其它 = 次访问。
 * 非艾特：不拆，整批 batch-messages。
 */
export function splitVisitByAtFocus(
    batch: SmartChatBufferEntry[],
    selfId: string,
): { atTriggered: boolean; primary: SmartChatBufferEntry[]; secondary: SmartChatBufferEntry[] } {
    const sid = String(selfId || '').trim();
    const primaryHuman = sid ? batch.filter((b) => entryAtsBot(b, sid)) : [];
    if (!primaryHuman.length) {
        return { atTriggered: false, primary: [], secondary: batch };
    }
    const primaryMsgIds = new Set(
        primaryHuman.map((b) => String(b.messageId || '').trim()).filter(Boolean),
    );
    const primary: SmartChatBufferEntry[] = [];
    const secondary: SmartChatBufferEntry[] = [];
    for (const b of batch) {
        if (entryAtsBot(b, sid)) {
            primary.push(b);
            continue;
        }
        const mid = String(b.messageId || '').trim();
        if (mid && primaryMsgIds.has(mid)) {
            primary.push(b);
            continue;
        }
        const eyeId = eyeMsgidFromText(b.text || '');
        if (eyeId && primaryMsgIds.has(eyeId)) {
            primary.push(b);
            continue;
        }
        secondary.push(b);
    }
    return { atTriggered: true, primary, secondary };
}

function extractBatchBlobFromUserContent(userContent: string): string {
    const raw = String(userContent || '');
    const chunks: string[] = [];
    const re = /<(?:main-visit|side-context|batch-messages)>\s*([\s\S]*?)\s*<\/(?:main-visit|side-context|batch-messages)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
        chunks.push(m[1]);
    }
    if (chunks.length) return chunks.join('\n');
    return raw
        .replace(/<host-state>[\s\S]*?<\/host-state>/gi, ' ')
        .replace(/<(?:knowledge|skill-tree)>[\s\S]*?<\/(?:knowledge|skill-tree)>/gi, ' ');
}

/** 从一批正文抽话题词（中英），用于与上次访问比相关性 */
export function extractTopicTokens(text: string): Set<string> {
    let s = String(text || '');
    s = s
        .replace(/<host-state>[\s\S]*?<\/host-state>/gi, ' ')
        .replace(/<(?:knowledge|skill-tree)>[\s\S]*?<\/(?:knowledge|skill-tree)>/gi, ' ')
        .replace(/\[眼睛[^\]]*\]:[^\n]*/gi, ' ')
        .replace(/补充：[\s\S]*?(?=\n\[|\n<|$)/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\[[^\]]{0,40}\]/g, ' ')
        .replace(/\b\d{4,}\b/g, ' ');

    const out = new Set<string>();
    for (const w of s.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []) {
        if (!TOPIC_STOPWORDS.has(w)) out.add(w);
    }
    const hans = s.match(/[\u4e00-\u9fff]{2,8}/g) || [];
    for (const chunk of hans) {
        if (chunk.length <= 4) {
            if (!TOPIC_STOPWORDS.has(chunk)) out.add(chunk);
        } else {
            for (let i = 0; i + 2 <= chunk.length; i += 1) {
                const bi = chunk.slice(i, i + 2);
                if (!TOPIC_STOPWORDS.has(bi)) out.add(bi);
            }
            for (let i = 0; i + 3 <= chunk.length; i += 1) {
                const tri = chunk.slice(i, i + 3);
                if (!TOPIC_STOPWORDS.has(tri)) out.add(tri);
            }
        }
    }
    return out;
}

/**
 * 看本轮缓冲/主访正文里，是否还有与「上一次访问」相关的内容。
 * related = 话题未刷新；unrelated = 已换场；none = 无上次可对比。
 */
export function detectTopicContinuity(prevUserContent: string | null | undefined, currentBlob: string): TopicContinuity {
    const prevBlob = extractBatchBlobFromUserContent(String(prevUserContent || ''));
    if (!prevBlob.trim() || !String(currentBlob || '').trim()) return 'none';
    const prev = extractTopicTokens(prevBlob);
    const curr = extractTopicTokens(currentBlob);
    if (prev.size < 2 || curr.size < 2) return 'none';

    let hits = 0;
    let strongHits = 0;
    for (const t of prev) {
        if (!curr.has(t)) continue;
        hits += 1;
        if (t.length >= 3) strongHits += 1;
    }
    const denom = Math.min(prev.size, curr.size, 24);
    const ratio = hits / Math.max(1, denom);
    if (strongHits >= 2 || hits >= 3 || ratio >= 0.18) return 'related';
    return 'unrelated';
}

function getLastUserTurnContent(session: SmartChatSessionFile): string | null {
    const msgs = session?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === 'user' && String(msgs[i].content || '').trim()) {
            return String(msgs[i].content);
        }
    }
    return null;
}

function formatVisitBody(
    atTriggered: boolean,
    primary: SmartChatBufferEntry[],
    secondary: SmartChatBufferEntry[],
    all: SmartChatBufferEntry[],
): { body: string; plain: string } {
    if (atTriggered && primary.length) {
        const main = formatBatchLines(primary);
        const side = secondary.length ? formatBatchLines(secondary) : '';
        const parts = [
            '<main-visit>\n（主访问：艾特你的消息，优先接这里）\n' + main + '\n</main-visit>',
        ];
        if (side) {
            parts.push(
                '<side-context>\n（次访问：缓冲里其它消息，仅背景；别当作业挨个答）\n' + side + '\n</side-context>',
            );
        }
        const body = parts.join('\n\n');
        return { body, plain: side ? `${main}\n${side}` : main };
    }
    const plain = formatBatchLines(all);
    return {
        body: `<batch-messages>\n${plain}\n</batch-messages>`,
        plain,
    };
}

/** 用户口头偏好：仅「禁止引用」进会话；「要引用」只清除禁止，不强制定时触发 */
export function detectReplyPreference(text: string): 'ban' | 'ask' | null {
    const t = String(text || '');
    if (/别引用|不要引用|别再引用|禁止引用|别回复气泡|发消息别引用|不要用引用|别带引用/i.test(t)) {
        return 'ban';
    }
    if (/引用我|引用这条|回复这条|顶一下这条|请引用|带上引用|可以引用了|再用引用/i.test(t)) {
        return 'ask';
    }
    return null;
}

/**
 * 本轮若开口，从允许范围内抽一个软上限（每条 msg / 每次 react 各算 1）。
 * min=0 时开口至少 1；多数时候偏向低档，偶尔拉满范围，避免常抽到接近 max。
 */
export function sampleSpeakActionCount(actionMin: number, actionMax: number): number {
    let max = Math.min(10, Math.max(1, Math.floor(Number(actionMax) || 1)));
    let min = Math.max(0, Math.min(max, Math.floor(Number(actionMin) || 0)));
    const lo = Math.max(1, min);
    const hi = max;
    if (lo >= hi) return hi;
    const softHi = Math.min(hi, lo + 2);
    const top = Math.random() < 0.78 ? softHi : hi;
    return lo + Math.floor(Math.random() * (top - lo + 1));
}

/**
 * 本轮运行态快照：只报事实与数字，不下达行为口令。
 * 人设 / 参与方式 / 能力用法由 system_prompt 负责。
 */
function buildHostConstraint(
    config: SmartChatConfig,
    session: SmartChatSessionFile,
    batch: SmartChatBufferEntry[],
    visit: { atTriggered: boolean; primary: SmartChatBufferEntry[]; secondary: SmartChatBufferEntry[] },
    topic: TopicContinuity,
    opts?: { imageRecognize?: boolean },
): string {
    const lines: string[] = [];
    const min = Number(config.action_min) || 0;
    const max = Number(config.action_max) || 3;
    const speakN = sampleSpeakActionCount(min, max);
    lines.push(`行为数 ${min}-${max}`);
    lines.push(`本轮上限 ${speakN}`);

    const silenceAllowed = min === 0;
    if (silenceAllowed) {
        const limit = Math.max(1, Number(config.shut_up_limit) || 5);
        const streak = Math.max(0, Number(session.shut_up_streak) || 0);
        lines.push(`沉默计数 ${streak}/${limit}`);
        if (streak >= limit) lines.push('沉默已达上限');
    } else {
        lines.push('不允许沉默');
    }

    const selfId = String(batch[batch.length - 1]?.eventSnapshot?.self_id ?? '');
    const atBot = batchMentionsBot(batch, selfId);
    lines.push(atBot ? '本批艾特了你' : '本批未艾特你');

    if (visit.atTriggered) {
        lines.push('访问：艾特主访（次=缓冲背景）');
        const ids = visit.primary
            .map((b) => String(b.messageId || '').trim())
            .filter(Boolean);
        const uniq = [...new Set(ids)];
        if (uniq.length) lines.push(`主访问 msgid: ${uniq.join(',')}`);
        lines.push(`次访问条数 ${visit.secondary.length}`);
    } else {
        lines.push('访问：整批同等');
    }

    if (topic === 'related') lines.push('话题：与上次相关');
    else if (topic === 'unrelated') lines.push('话题：与上次无关');
    else lines.push('话题：无上次对比');

    if (session.prefer_no_reply) {
        lines.push('会话偏好：不带 reply');
    }

    if (config.tools_enabled) {
        lines.push('联网已开启');
    }

    if (opts?.imageRecognize) {
        const batchBlob = batch.map((b) => b.text || '').join('\n');
        const hasSupplement = /补充：\S*\s*图片第\d+张解析结果/.test(batchBlob)
            || /补充：.+图片第.+解析结果/.test(batchBlob)
            || /\[眼睛\s+msgid:/i.test(batchBlob);
        const hasPending = /发了\d+张\[图片\]\(图片资源正在解析/.test(batchBlob);
        if (hasSupplement) lines.push('识图：已有补充');
        else if (hasPending) lines.push('识图：解析中');
        else lines.push('识图：已开启');
    }

    return `<host-state>\n${lines.join('\n')}\n</host-state>`;
}

export function composeTurn(
    config: SmartChatConfig,
    session: SmartChatSessionFile,
    batch: SmartChatBufferEntry[],
    knowledge: SmartChatKnowledgeEntry[],
    historyRounds = 0,
    opts?: { imageRecognize?: boolean },
): ComposedTurn {
    const selfId = String(batch[batch.length - 1]?.eventSnapshot?.self_id ?? '');
    const visit = splitVisitByAtFocus(batch, selfId);
    const formatted = formatVisitBody(visit.atTriggered, visit.primary, visit.secondary, batch);
    const topic = detectTopicContinuity(getLastUserTurnContent(session), formatted.plain);
    const knowledgeBlock = buildSkillTreeBlock(knowledge);
    const hostConstraint = buildHostConstraint(config, session, batch, visit, topic, opts);

    const parts: string[] = [];
    if (knowledgeBlock) {
        parts.push(
            '以下 <skill-tree> 是你本轮已装备的自定义技能；相关就释放，别背说明书，也别假装没点亮。\n'
                + knowledgeBlock,
        );
    }
    parts.push(hostConstraint);
    parts.push(formatted.body);
    const userContentExact = parts.join('\n\n');

    const history = sliceMessagesByRounds(getPrependOnlyMessages(session), historyRounds);
    const apiMessages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContentExact },
    ];

    let systemPrompt = config.system_prompt;
    systemPrompt += PROTOCOL_SYSTEM_SUFFIX;
    systemPrompt += CHINA_SENSITIVE_SYSTEM_SUFFIX;
    if (toolsShouldAttach(config)) systemPrompt += TOOLS_SYSTEM_SUFFIX;
    if (opts?.imageRecognize) systemPrompt += IMAGE_RECOGNIZE_SYSTEM_SUFFIX;

    return {
        systemPrompt,
        apiMessages,
        userContentExact,
        userTurnPlain: formatted.plain,
        knowledgeBlock,
    };
}
