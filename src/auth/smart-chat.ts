// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — Runtime（Controller + 防抖 flush）
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import type { SmartChatBufferEntry, SmartChatDeps } from './smart-chat-types';
import { SMART_CHAT_LEGACY_ROOT, SMART_CHAT_ROOT } from './smart-chat-types';
import { loadSmartChatConfig } from './smart-chat-config';
import { appendChatBuffer, clearChatBuffer, loadChatBuffer, takeChatBuffer } from './smart-chat-buffer';
import { composeTurn, detectReplyPreference } from './smart-chat-compose';
import { extractInboundMeta } from './smart-chat-inbound';
import { searchKnowledgeTopM, ensureBuiltinKnowledge } from './smart-chat-knowledge';
import { chatCompletion, isFatalUpstreamError, looksLikeToolMarkup, mergeUsage, stripToolMarkup } from './smart-chat-provider';
import { nextReplyGapMs, parseAssistantActions, applyActionLimits, inferToolPreambleTexts, sleep, stripReplyAttrsFromContent, extractStatusTexts } from './smart-chat-reply';
import { appendSessionTurn, clearSession, loadSession, listSessionIds } from './smart-chat-session';
import { bindNvidiaRateDeps, fetchBalance, getUsageSummary, recordUsage } from './smart-chat-billing';
import {
    getSmartChatRoundsForEvent,
    isSmartChatAiOnlyForEvent,
    isSmartChatEnabledForEvent,
    isSmartChatImageForEvent,
} from './smart-chat-switches';
import {
    SMART_CHAT_TOOLS,
    buildToolChoice,
    executeToolCalls,
    looksLikeEmptySearchPromise,
    toolsShouldAttach,
} from './smart-chat-tools';
import {
    bindSmartChatImageRuntime,
    enqueueImageJobs,
    extractImageHttpUrls,
    planImageHandling,
    type ImageJobMeta,
} from './smart-chat-image';

interface TimerState {
    timer: ReturnType<typeof setTimeout> | null;
}

const busyChats = new Map<string, boolean>();
const chatTimers = new Map<string, TimerState>();
let migrationDone = false;

function chatIdFromEvent(event: Record<string, unknown>): string {
    if (event.message_type === 'group') return `g_${event.group_id}`;
    return `p_${event.user_id}`;
}

function groupIdFromEvent(event: Record<string, unknown>): string | null {
    if (event.message_type === 'group') return String(event.group_id || '');
    return null;
}

function isEventEnabled(deps: SmartChatDeps, event: Record<string, unknown>, cfg: ReturnType<typeof loadSmartChatConfig>): boolean {
    return isSmartChatEnabledForEvent(deps, event, cfg);
}

function readB(deps: SmartChatDeps, file: string, key: string, def: unknown): unknown {
    return deps.readB(file, key, def);
}

function snapshotEvent(event: Record<string, unknown>): Record<string, unknown> {
    return {
        message_type: event.message_type,
        group_id: event.group_id,
        user_id: event.user_id,
        self_id: event.self_id,
        message_id: event.message_id,
        sender: event.sender,
        raw_message: event.raw_message,
        message: event.message,
    };
}

function rebuildEventFromSnapshot(snap: Record<string, unknown>): Record<string, unknown> {
    return { ...snap };
}

async function executeAssistantActions(
    deps: SmartChatDeps,
    ev: Record<string, unknown>,
    actions: Array<{ type: string; text?: string; at?: string | string[]; replyId?: string; emojiId?: string; messageId?: string }>,
    replyGapMs: number,
): Promise<void> {
    const isGroup = ev.message_type === 'group';
    const runnable = (actions || []).filter((a) => a.type === 'react' || a.type === 'msg');
    for (let i = 0; i < runnable.length; i++) {
        const a = runnable[i];
        if (a.type === 'react') {
            if (isGroup && a.emojiId && a.messageId && typeof deps.设消息表情 === 'function') {
                try {
                    await deps.设消息表情(a.messageId, a.emojiId);
                } catch (e) {
                    deps.logger?.warn?.('[智能对话] 贴表情失败:', e?.message || e);
                }
            }
        } else if (a.type === 'msg' && a.text) {
            const segs = [];
            if (a.replyId && typeof deps.段_引用 === 'function') {
                const r = deps.段_引用(a.replyId);
                if (r) segs.push(r);
            }
            if (typeof deps.段_艾特 === 'function') {
                const ats = Array.isArray(a.at) ? a.at : (a.at ? [a.at] : []);
                for (const qq of ats) {
                    const at = deps.段_艾特(String(qq));
                    if (at) segs.push(at);
                }
            }
            segs.push(deps.段_文本(a.text));
            await deps.发消息(ev, segs);
        }
        if (i < runnable.length - 1) {
            await sleep(nextReplyGapMs(replyGapMs));
        }
    }
}

/** 本批是否艾特了机器人 */
function batchAtsBot(batch: SmartChatBufferEntry[], selfId: unknown): boolean {
    const sid = String(selfId ?? '').trim();
    if (!sid) return false;
    return batch.some((b) => (b.atQqs || []).some((q) => String(q).trim() === sid));
}

/** 是否有可对用户说的文字（排除占位省略号） */
function hasRealTextMsg(
    actions: Array<{ type: string; text?: string }>,
): boolean {
    return actions.some((a) => {
        if (a.type !== 'msg') return false;
        const t = String(a.text || '').trim();
        return t && t !== '……' && t !== '...';
    });
}

function parseOutboundActions(
    content: string,
    batch: SmartChatBufferEntry[],
    isGroup: boolean,
) {
    let parsed = parseAssistantActions(content, batch);
    if (!isGroup) {
        parsed = parsed.filter((a) => a.type !== 'react');
    } else {
        parsed = parsed.filter((a) => a.type !== 'react' || a.messageId);
    }
    return parsed;
}

export function migrateLegacySmartChat(deps: SmartChatDeps): void {
    if (migrationDone) return;
    migrationDone = true;
    try {
        const legacyDir = path.join(deps.getDataPath(), SMART_CHAT_LEGACY_ROOT, 'DeepSeek');
        const newDir = path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'sessions', 'by-config');
        if (!fs.existsSync(legacyDir)) return;
        // 旧 AI对话/DeepSeek → 扁平 sessions，再由 getActiveSessionNamespace 迁入 by-config
        const flatDir = path.join(deps.getDataPath(), SMART_CHAT_ROOT, 'sessions');
        if (!fs.existsSync(flatDir)) fs.mkdirSync(flatDir, { recursive: true });
        for (const f of fs.readdirSync(legacyDir)) {
            if (!f.endsWith('.json')) continue;
            const chatId = f.replace(/\.json$/, '');
            const dst = path.join(flatDir, `${chatId}.json`);
            if (fs.existsSync(dst)) continue;
            // 已在 by-config 任意指纹下存在则跳过
            let existsInNs = false;
            if (fs.existsSync(newDir)) {
                for (const ns of fs.readdirSync(newDir)) {
                    if (fs.existsSync(path.join(newDir, ns, `${chatId}.json`))) {
                        existsInNs = true;
                        break;
                    }
                }
            }
            if (existsInNs) continue;
            const src = path.join(legacyDir, f);
            fs.copyFileSync(src, dst);
            deps.logger?.info?.(`[智能对话] 已迁移会话 ${chatId}`);
        }
    } catch (e) {
        deps.logger?.warn?.('[智能对话] 迁移旧会话失败:', e?.message || e);
    }
}

async function flushChat(deps: SmartChatDeps, chatId: string): Promise<void> {
    // 访问进行中：只把新消息记入 buffer，不并行再开一次 API（保证 prepend-only 前缀不被并发打乱）
    if (busyChats.get(chatId)) return;
    const pending = loadChatBuffer(deps, chatId);
    if (!pending.length) return;

    busyChats.set(chatId, true);
    const batch = takeChatBuffer(deps, chatId);

    try {
        const config = loadSmartChatConfig(deps);
        if (!String(config.api_key || '').trim()) {
            deps.logger?.warn?.('[智能对话] 未配置 api_key，跳过 flush');
            // 放回 buffer，避免丢消息
            for (const e of batch) appendChatBuffer(deps, chatId, e);
            return;
        }

        const session = loadSession(deps, chatId, config);
        const queryText = batch.map((b) => b.text).join(' ');
        const replyPref = detectReplyPreference(queryText);
        if (replyPref === 'ban') session.prefer_no_reply = true;
        if (replyPref === 'ask') session.prefer_no_reply = false;
        // 仅对方禁止引用时剥 reply；平时由模型自己决定要不要引用
        const stripReply = Boolean(session.prefer_no_reply);
        const groupId = batch[0]?.eventSnapshot?.message_type === 'group'
            ? String(batch[0].eventSnapshot.group_id || '')
            : null;
        const knowledge = searchKnowledgeTopM(deps, queryText, groupId, config.kb_top_m);
        const lastSnapForRounds = batch[batch.length - 1]?.eventSnapshot || {};
        const historyRounds = getSmartChatRoundsForEvent(deps, lastSnapForRounds);
        const imageRecognize = isSmartChatImageForEvent(deps, lastSnapForRounds);
        const composed = composeTurn(config, session, batch, knowledge, historyRounds, { imageRecognize });
        if (historyRounds > 0) {
            deps.logger?.info?.(
                `[智能对话] ${chatId} 历史上传轮次=${historyRounds}（不含本轮）`,
            );
        }

        const useTools = toolsShouldAttach(config);
        const maxRounds = Math.min(5, Math.max(1, Number(config.tools_max_rounds) || 3));
        const liveMessages = composed.apiMessages.map((m) => ({ ...m }));
        const lastSnapEarly = batch[batch.length - 1]?.eventSnapshot;
        // 是否联网由模型 tool_choice=auto 自行决定
        let result = await chatCompletion(
            config,
            composed.systemPrompt,
            liveMessages,
            useTools
                ? { tools: SMART_CHAT_TOOLS, tool_choice: buildToolChoice(false) }
                : undefined,
        );

        const forceSearchAgain = async (reason: string) => {
            deps.logger?.warn?.(`[智能对话] ${chatId} ${reason}，强制补调 web_search`);
            const nudge = await chatCompletion(
                config,
                composed.systemPrompt,
                [
                    ...liveMessages,
                    {
                        role: 'user',
                        content:
                            '[宿主] 你已口头答应去搜，禁止空口。本轮必须立刻调用 web_search，不要只回文字。',
                    },
                ],
                { tools: SMART_CHAT_TOOLS, tool_choice: buildToolChoice(true) },
            );
            if (nudge.ok && nudge.tool_calls?.length) return nudge;
            if (nudge.ok) return nudge;
            if (isFatalUpstreamError(nudge.error)) return nudge;
            const auto = await chatCompletion(
                config,
                composed.systemPrompt,
                [
                    ...liveMessages,
                    {
                        role: 'user',
                        content: '[宿主] 请立刻调用 web_search，不要直接回答。',
                    },
                ],
                { tools: SMART_CHAT_TOOLS, tool_choice: 'auto' },
            );
            return auto.ok || isFatalUpstreamError(auto.error) ? auto : nudge;
        };

        // 仅当模型空口答应「我去搜」却没调工具时补搜（言行一致）；不按关键词强制
        if (useTools && !result.tool_calls?.length) {
            if (!result.ok && isFatalUpstreamError(result.error)) {
                deps.logger?.warn?.(
                    `[智能对话] ${chatId} 上游致命错误，跳过补搜: ${result.error}`,
                );
            } else if (result.ok && looksLikeEmptySearchPromise(result.content || '')) {
                result = await forceSearchAgain('模型空口答应搜索却未调工具');
            }
        }
        let rounds = 0;
        let statusSent = false;
        while (result.ok && useTools && result.tool_calls?.length && rounds < maxRounds) {
            rounds += 1;
            deps.logger?.info?.(
                `[智能对话] ${chatId} 工具轮 ${rounds}/${maxRounds}: ${result.tool_calls.map((t) => t.function.name).join(',')}`,
            );
            // 联网前可选说明：立刻发出，不计入最终行为数
            if (!statusSent && result.content?.trim() && lastSnapEarly) {
                const preambles = inferToolPreambleTexts(result.content);
                if (preambles.length) {
                    statusSent = true;
                    deps.logger?.info?.(
                        `[智能对话] ${chatId} 联网前说明 ${preambles.length} 条（不计行为）`,
                    );
                    try {
                        const ev = rebuildEventFromSnapshot(lastSnapEarly);
                        await executeAssistantActions(
                            deps,
                            ev,
                            preambles.map((text) => ({ type: 'msg', text })),
                            config.reply_gap_ms,
                        );
                    } catch (e) {
                        deps.logger?.warn?.('[智能对话] 联网前说明发送失败:', e?.message || e);
                    }
                }
            }
            liveMessages.push({
                role: 'assistant',
                content: result.content || null,
                tool_calls: result.tool_calls,
            });
            const toolMsgs = await executeToolCalls(config, result.tool_calls, deps.logger);
            for (const tm of toolMsgs) liveMessages.push(tm);

            const next = await chatCompletion(
                config,
                composed.systemPrompt,
                liveMessages,
                { tools: SMART_CHAT_TOOLS, tool_choice: 'auto' },
            );
            next.usage = mergeUsage(result.usage, next.usage);
            result = next;
        }
        // 达上限仍想调工具 / DSML 正文 / 无正文：强制一轮无 tools 收束（禁止再输出工具调用）
        const needForceText =
            result.ok &&
            useTools &&
            rounds > 0 &&
            (Boolean(result.tool_calls?.length) ||
                !result.content?.trim() ||
                looksLikeToolMarkup(result.content));
        if (needForceText) {
            if (result.tool_calls?.length || looksLikeToolMarkup(result.content)) {
                deps.logger?.warn?.(
                    `[智能对话] ${chatId} 工具未收束（calls=${result.tool_calls?.length || 0} dsml=${looksLikeToolMarkup(result.content)}），强制无工具收束`,
                );
            } else {
                deps.logger?.info?.(`[智能对话] ${chatId} 工具后无正文，强制无工具收束`);
            }
            // 不把未执行的 tool_calls / DSML 正文塞进历史，只基于已有 tool 结果再答
            const final = await chatCompletion(config, composed.systemPrompt, [
                ...liveMessages,
                {
                    role: 'user',
                    content:
                        '[宿主] 禁止再输出工具调用、DSML 或 function call。请根据上文已有搜索结果，用 <replies><msg>...</msg></replies> 直接回答。',
                },
            ]);
            final.usage = mergeUsage(result.usage, final.usage);
            if (final.ok) result = final;
        }

        if (!result.ok || (!result.content && !result.tool_calls?.length)) {
            deps.logger?.error?.('[智能对话] API 失败（不外发）:', result.error || 'empty_response');
            return;
        }

        // 仍夹带工具标记则剥掉；剥光则用兜底句，绝不把 DSML 发进群
        if (looksLikeToolMarkup(result.content) || result.tool_calls?.length) {
            deps.logger?.warn?.(`[智能对话] ${chatId} 最终仍含工具标记，丢弃外发`);
            result = {
                ...result,
                content: stripToolMarkup(result.content) || '',
                tool_calls: undefined,
            };
        }
        if (!result.content?.trim()) {
            result.content = rounds > 0
                ? '我查了一下，但没整理出能直接说的内容，你换个问法？'
                : '……';
        }

        // 落盘：仅最终对用户可见的 assistant 文本（工具中间轮不入 session）
        const lastSnapEv = batch[batch.length - 1]?.eventSnapshot;
        const isGroup = lastSnapEv?.message_type === 'group'
            || batch[0]?.eventSnapshot?.message_type === 'group';
        const atBot = batchAtsBot(batch, lastSnapEv?.self_id);
        const toolsUsed = rounds > 0;
        // 艾特 / 刚用过工具：须开口。硬边界由 system 自判（沉默或一句不涉禁区的带过），不靠关键词。
        const forceSpeak = atBot || toolsUsed;

        const silenceAllowed = config.action_min === 0 && !forceSpeak;
        const streak = Math.max(0, Number(session.shut_up_streak) || 0);
        const mustSpeak =
            forceSpeak || (silenceAllowed && streak >= Math.max(1, Number(config.shut_up_limit) || 5));

        let parsed = parseOutboundActions(result.content, batch, isGroup);
        let limited = applyActionLimits(parsed, {
            actionMin: config.action_min,
            actionMax: config.action_max,
            silenceAllowed,
            mustSpeak,
            stripReply,
        });

        // 已搜到结果却只贴表情/闭嘴：再强制要一次文字答案
        if (toolsUsed && !hasRealTextMsg(limited.actions)) {
            deps.logger?.warn?.(`[智能对话] ${chatId} 联网后无文字回复，强制补答`);
            const rescue = await chatCompletion(config, composed.systemPrompt, [
                ...liveMessages,
                {
                    role: 'user',
                    content:
                        '[宿主] 你已经完成联网搜索并拿到结果。不要闭嘴、不要只贴表情。用 <replies> 多条短 <msg> 把查到的要点说出来；需要钉住某条时自己决定是否带 reply。',
                },
            ]);
            result.usage = mergeUsage(result.usage, rescue.usage);
            if (rescue.ok && rescue.content?.trim() && !looksLikeToolMarkup(rescue.content)) {
                result = { ...rescue, usage: result.usage, tool_calls: undefined };
                parsed = parseOutboundActions(result.content, batch, isGroup);
                limited = applyActionLimits(parsed, {
                    actionMin: config.action_min,
                    actionMax: config.action_max,
                    silenceAllowed: false,
                    mustSpeak: true,
                    stripReply,
                });
            }
            if (!hasRealTextMsg(limited.actions)) {
                const reacts = limited.actions.filter((a) => a.type === 'react');
                limited = {
                    actions: [
                        ...reacts,
                        {
                            type: 'msg',
                            text: '搜到一些相关信息了，但这轮没组织好措辞，你再具体问一点我继续说。',
                        },
                    ],
                    shutUp: false,
                };
                result = {
                    ...result,
                    content:
                        `<replies><msg>搜到一些相关信息了，但这轮没组织好措辞，你再具体问一点我继续说。</msg></replies>`,
                };
            }
        }

        if (result.usage) {
            recordUsage(deps, config, chatId, result.usage);
            const hit = result.usage.prompt_cache_hit_tokens || 0;
            const prompt = result.usage.prompt_tokens || 0;
            const rate = prompt > 0 ? Math.round((hit / prompt) * 1000) / 10 : 0;
            deps.logger?.info?.(
                `[智能对话] ${chatId} tokens prompt=${prompt} hit=${hit} (${rate}%) completion=${result.usage.completion_tokens || 0} toolRounds=${rounds}`,
            );
        }

        let storeContent = extractStatusTexts(result.content || '').rest;
        if (stripReply) storeContent = stripReplyAttrsFromContent(storeContent);
        // 最终轮剥掉 status，避免把工具前说明写进历史
        if (!storeContent.trim() && hasRealTextMsg(limited.actions)) {
            storeContent = `<replies>\n${limited.actions
                .filter((a) => a.type === 'msg')
                .map((a) => `<msg>${a.text || ''}</msg>`)
                .join('\n')}\n</replies>`;
        }
        appendSessionTurn(deps, chatId, composed.userContentExact, storeContent, config, {
            shutUp: limited.shutUp,
            preferNoReply: Boolean(session.prefer_no_reply),
        });

        if (lastSnapEv && limited.actions.length) {
            const ev = rebuildEventFromSnapshot(lastSnapEv);
            await executeAssistantActions(deps, ev, limited.actions, config.reply_gap_ms);
        }
        if (limited.shutUp) {
            deps.logger?.info?.(
                `[智能对话] ${chatId} 闭嘴(含纯贴表情) streak→${streak + 1}/${config.shut_up_limit}`,
            );
        }
    } catch (e) {
        deps.logger?.error?.('[智能对话] flush 异常:', e);
    } finally {
        busyChats.set(chatId, false);
        // 等待期间缓冲的消息：本轮结束后再处理（仍串行）
        const leftover = loadChatBuffer(deps, chatId);
        if (leftover.length) {
            const cfg = loadSmartChatConfig(deps);
            const selfId = String(leftover[leftover.length - 1]?.eventSnapshot?.self_id ?? '').trim();
            const forceByAt = leftover.some(
                (e) =>
                    String(e.text || '').trim() &&
                    selfId &&
                    (e.atQqs || []).some((q) => String(q).trim() === selfId)
                    && !/^补充：/.test(String(e.text || '').trim()),
            );
            // 艾特+识图的补充：带 forceFlush，访问结束后立刻再跑一轮
            const forceByAtImageSupplement = leftover.some((e) => Boolean(e.forceFlush));
            if (forceByAt || forceByAtImageSupplement || shouldFlushByBatchCount(leftover.length, cfg.max_batch)) {
                if (forceByAt || forceByAtImageSupplement) {
                    deps.logger?.info?.(
                        `[智能对话] ${chatId} leftover 含${forceByAtImageSupplement ? '艾特识图补充/' : ''}艾特，立即访问（${leftover.length} 条）`,
                    );
                }
                flushChat(deps, chatId).catch((e) => deps.logger?.error?.('[智能对话] leftover flush 失败:', e));
            } else {
                scheduleFlush(deps, chatId);
            }
        }
    }
}

function scheduleFlush(deps: SmartChatDeps, chatId: string): void {
    const config = loadSmartChatConfig(deps);
    let state = chatTimers.get(chatId);
    if (!state) {
        state = { timer: null };
        chatTimers.set(chatId, state);
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        state.timer = null;
        const pending = loadChatBuffer(deps, chatId);
        if (!pending.length) return;
        // 防抖只负责「等一会儿看还能不能再攒」；未凑满最大合并条数绝不因防抖访问。
        // ≥8 的随机提前只在入队 shouldFlushByBatchCount 里做，与防抖无关。
        if (!shouldFlushOnDebounce(pending.length, config.max_batch)) {
            deps.logger?.info?.(
                `[智能对话] ${chatId} 防抖到期未凑满合并上限(${pending.length}/${config.max_batch})，暂不访问`,
            );
            return;
        }
        flushChat(deps, chatId).catch((e) => deps.logger?.error?.('[智能对话] 定时 flush 失败:', e));
    }, config.debounce_ms);
}

/**
 * 防抖到期是否允许 flush：必须已达最大合并条数。
 * （max_batch>8 时 8～上限-1 的随机提前，只在入队时判定，不走防抖「有货就刷」。）
 */
export function shouldFlushOnDebounce(pendingCount: number, maxBatch: number): boolean {
    const cap = Math.min(25, Math.max(1, Number(maxBatch) || 1));
    const n = Math.max(0, Number(pendingCount) || 0);
    if (n <= 0) return false;
    return n >= cap;
}

/**
 * 入队时提前 flush 策略：
 * - 达到 max_batch：必定 flush
 * - max_batch ≤ 8：未达上限不提前
 * - max_batch ∈ [9,25]：从第 8 条起递增概率随机提前；未满 8 条不提前
 */
export function shouldFlushByBatchCount(pendingCount: number, maxBatch: number): boolean {
    const cap = Math.min(25, Math.max(1, Number(maxBatch) || 1));
    const n = Math.max(0, Number(pendingCount) || 0);
    if (n <= 0) return false;
    if (n >= cap) return true;
    if (cap <= 8) return false;
    if (n < 8) return false;
    const span = cap - 8;
    const step = n - 8;
    const p = (step + 1) / (span + 1);
    return Math.random() < p;
}

/**
 * 艾特本机且带有效内容（文字或已记录图片占位）→ 立即访问。
 */
export function shouldFlushByAtBot(
    event: Record<string, unknown>,
    atQqs: string[] | undefined,
    text: string,
): boolean {
    const selfId = String(event?.self_id ?? '').trim();
    if (!selfId) return false;
    if (!String(text || '').trim()) return false;
    const ats = Array.isArray(atQqs) ? atQqs : [];
    return ats.some((q) => String(q).trim() === selfId);
}

function isAtBotEvent(event: Record<string, unknown>, atQqs: string[]): boolean {
    const selfId = String(event?.self_id ?? '').trim();
    if (!selfId) return false;
    return (atQqs || []).some((q) => String(q).trim() === selfId);
}

function handleImageSupplement(deps: SmartChatDeps, entry: SmartChatBufferEntry): void {
    const snap = entry.eventSnapshot || {};
    let chatId = chatIdFromEvent(snap);
    if (!chatId || chatId === 'g_undefined' || chatId === 'p_undefined') {
        chatId = snap.message_type === 'group'
            ? `g_${snap.group_id}`
            : `p_${snap.user_id}`;
    }
    if (!chatId || chatId === 'g_undefined' || chatId === 'p_undefined') {
        deps.logger?.warn?.('[智能对话·识图] 补充无法定位 chatId，已丢弃');
        return;
    }
    const pending = appendChatBuffer(deps, chatId, entry);
    const force = Boolean(entry.forceFlush);
    deps.logger?.info?.(
        `[智能对话·识图] ${chatId} 已写入补充（缓冲 ${pending.length} 条${force ? '，艾特后立即访问' : ''}）: ${String(entry.text || '').slice(0, 80)}`,
    );
    if (force) {
        const state = chatTimers.get(chatId);
        if (state?.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        // 访问进行中：留给 finally leftover（带 forceFlush）再触发
        if (busyChats.get(chatId)) return;
        flushChat(deps, chatId).catch((e) =>
            deps.logger?.error?.('[智能对话] 艾特识图补充 flush 失败:', e),
        );
        return;
    }
    scheduleFlush(deps, chatId);
}

export type SmartChatIngestResult = {
    /** 本轮是否已入队/触发对话 */
    handled: boolean;
    /** 是否仅 AI 对话（宿主应中断后续处理） */
    aiOnly: boolean;
};

export async function smartChatIngest(deps: SmartChatDeps, event: Record<string, unknown>): Promise<SmartChatIngestResult> {
    const empty: SmartChatIngestResult = { handled: false, aiOnly: false };
    if (!deps) return empty;
    migrateLegacySmartChat(deps);

    const config = loadSmartChatConfig(deps);
    const enabled = isEventEnabled(deps, event, config);
    // 仅 AI：只有聊天开关也开启时才截断后续流水线，避免「只开仅AI、没开聊天」把群管全掐死
    const aiOnly = enabled && isSmartChatAiOnlyForEvent(deps, event);

    const 自触开关 = readB(deps, 'config.json', '自触开关', false);
    if (event.self_id === event.user_id && !自触开关) {
        return { handled: false, aiOnly };
    }

    const plainText = String(deps.eventUserTextFromSegments(event) || '').trim();
    const inbound = extractInboundMeta(event);
    const atBot = isAtBotEvent(event, inbound.atQqs);
    const imageOn = isSmartChatImageForEvent(deps, event);
    const imgSettings = config.image_recognize;
    const imageUrls = imageOn ? extractImageHttpUrls(event.message) : [];
    const messageId = event.message_id != null ? String(event.message_id) : '';
    const imagePlan = planImageHandling({
        enabled: imageOn,
        urls: imageUrls,
        isAtBot: atBot,
        messageId,
        settings: imgSettings,
    });
    if (imagePlan.skipReason) {
        deps.logger?.info?.(`[智能对话·识图] ${imagePlan.skipReason} msgid=${messageId || '-'}`);
    }

    let text = plainText;
    if (imagePlan.recordImages && imagePlan.placeholderLine) {
        text = plainText
            ? `${plainText}\n${imagePlan.placeholderLine}`
            : imagePlan.placeholderLine;
    }

    // 无文字且无图片占位：不入队（纯艾特仍跳过）
    if (!String(text || '').trim()) {
        return { handled: false, aiOnly };
    }

    if (!enabled) {
        return { handled: false, aiOnly: false };
    }

    const chatId = chatIdFromEvent(event);
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const entry: SmartChatBufferEntry = {
        userId: String(event.user_id || ''),
        nickname: String((event.sender as { nickname?: string })?.nickname || event.user_id || ''),
        text,
        time: timeStr,
        messageId: messageId || undefined,
        replyToId: inbound.replyToId,
        atQqs: inbound.atQqs.length ? inbound.atQqs : undefined,
        eventSnapshot: snapshotEvent(event),
    };

    const pending = appendChatBuffer(deps, chatId, entry);

    if (imagePlan.recordImages && imagePlan.urls.length) {
        const timeoutMs = Math.round(Number(imgSettings?.timeout_sec || 30) * 1000);
        const jobs: ImageJobMeta[] = imagePlan.urls.map((url, i) => ({
            chatId,
            messageId: messageId || 'unknown',
            index: i + 1,
            total: imagePlan.urls.length,
            url,
            isAt: atBot,
            forceFlushAfter: atBot,
            timeoutMs,
            userId: entry.userId,
            nickname: entry.nickname,
            time: timeStr,
            eventSnapshot: entry.eventSnapshot,
        }));
        enqueueImageJobs(jobs, imgSettings);
    }

    const forceByAt = shouldFlushByAtBot(event, inbound.atQqs, text);
    if (forceByAt || shouldFlushByBatchCount(pending.length, config.max_batch)) {
        const state = chatTimers.get(chatId);
        if (state?.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        if (forceByAt) {
            deps.logger?.info?.(`[智能对话] ${chatId} 艾特触发立即访问（含缓冲 ${pending.length} 条）`);
        }
        await flushChat(deps, chatId);
        return { handled: true, aiOnly };
    }

    scheduleFlush(deps, chatId);
    return { handled: true, aiOnly };
}

export function createSmartChatRuntime(deps: SmartChatDeps) {
    migrateLegacySmartChat(deps);
    bindNvidiaRateDeps(deps);
    bindSmartChatImageRuntime(
        (entry) => handleImageSupplement(deps, entry),
        deps.logger,
    );
    try {
        ensureBuiltinKnowledge(deps);
    } catch (e) {
        deps.logger?.warn?.('[智能对话] 内置知识库写入失败:', e?.message || e);
    }
    return {
        ingest: (event: Record<string, unknown>) => smartChatIngest(deps, event),
        flushChat: (chatId: string) => flushChat(deps, chatId),
        getConfig: () => loadSmartChatConfig(deps),
        getUsageSummary: () => getUsageSummary(deps),
        fetchBalance: (force?: boolean) => fetchBalance(loadSmartChatConfig(deps), force, deps),
        clearSession: (chatId: string) => clearSession(deps, chatId),
        clearBuffer: (chatId: string) => clearChatBuffer(deps, chatId),
        listSessionIds: () => listSessionIds(deps),
    };
}

export type SmartChatRuntime = ReturnType<typeof createSmartChatRuntime>;

let defaultRuntime: SmartChatRuntime | null = null;

export function initSmartChatRuntime(deps: SmartChatDeps): SmartChatRuntime {
    defaultRuntime = createSmartChatRuntime(deps);
    return defaultRuntime;
}

export function getSmartChatRuntime(): SmartChatRuntime | null {
    return defaultRuntime;
}
