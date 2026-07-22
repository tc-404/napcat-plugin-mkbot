// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — Compose（Reasonix：cache-stable system + turn 尾）
// ---------------------------------------------------------------------------
//
// - system_prompt：整段会话 byte-stable，不在中途改写
// - session.messages：与送进 API 的内容 byte-identical（prepend-only）
// - 知识库 Top-M：仅挂在「当前」user turn；写入 session 时一并保存，避免下次前缀漂移
// - compaction digest：已作为消息永久写入 session，不再每轮重复注入
// - host-state：本轮可变事实（行为范围、本轮上限抽数、沉默计数、是否被艾特等）
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

function buildKnowledgeBlock(entries: SmartChatKnowledgeEntry[]): string {
    if (!entries.length) return '';
    const lines = entries.map((e, i) => `${i + 1}. ${e.title}\n${e.content}`);
    return `<knowledge>\n${lines.join('\n\n')}\n</knowledge>`;
}

function batchMentionsBot(batch: SmartChatBufferEntry[], selfId: string): boolean {
    const sid = String(selfId || '').trim();
    if (!sid) return false;
    return batch.some((b) => (b.atQqs || []).some((q) => String(q).trim() === sid));
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
    const batchText = formatBatchLines(batch);
    const knowledgeBlock = buildKnowledgeBlock(knowledge);
    const hostConstraint = buildHostConstraint(config, session, batch, opts);

    const parts: string[] = [];
    if (knowledgeBlock) {
        parts.push(
            '以下 <knowledge> 是你已学过的资料，相关时自然用上；别当说明书背，也别假装没学过。\n'
                + knowledgeBlock,
        );
    }
    parts.push(hostConstraint);
    parts.push(`<batch-messages>\n${batchText}\n</batch-messages>`);
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
        userTurnPlain: batchText,
        knowledgeBlock,
    };
}
