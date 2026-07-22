// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 群聊/好友开关 + 仅 AI 对话（独立于事件系统）
// ---------------------------------------------------------------------------

import type { SmartChatConfig, SmartChatDeps } from './smart-chat-types';
import { SMART_CHAT_EVENT_KEY, SMART_CHAT_ROOT } from './smart-chat-types';
import { loadSmartChatConfig } from './smart-chat-config';

export const SMART_CHAT_GROUP_SWITCH = `${SMART_CHAT_ROOT}群聊开关.json`;
export const SMART_CHAT_FRIEND_SWITCH = `${SMART_CHAT_ROOT}好友开关.json`;
export const SMART_CHAT_GROUP_AI_ONLY = `${SMART_CHAT_ROOT}仅AI对话群.json`;
export const SMART_CHAT_FRIEND_AI_ONLY = `${SMART_CHAT_ROOT}仅AI对话好友.json`;
export const SMART_CHAT_GROUP_ROUNDS = `${SMART_CHAT_ROOT}轮次群.json`;
export const SMART_CHAT_FRIEND_ROUNDS = `${SMART_CHAT_ROOT}轮次好友.json`;
export const SMART_CHAT_GROUP_IMAGE = `${SMART_CHAT_ROOT}识图群.json`;
export const SMART_CHAT_FRIEND_IMAGE = `${SMART_CHAT_ROOT}识图好友.json`;

/** 0=上传全部上下文；1–999=仅取最近 N 次访问（不含本轮） */
export function normalizeSmartChatRounds(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(999, Math.max(1, Math.floor(n)));
}

function readB(deps: SmartChatDeps, file: string, key: string, def: unknown): unknown {
    return deps.readB(file, key, def);
}

function writeB(deps: SmartChatDeps, file: string, key: string, value: unknown): void {
    deps.writeB(file, key, value);
}

function normStatus(v: unknown): '开启' | '关闭' | null {
    const s = String(v ?? '').trim();
    if (s === '开启' || s === '关闭') return s;
    if (v === true || v === 1 || s === 'true' || s === '1') return '开启';
    if (v === false || v === 0 || s === 'false' || s === '0') return '关闭';
    return null;
}

/** 兼容：尚未写入独立开关文件时，回落到旧事件系统键 */
function legacyGroupEnabled(deps: SmartChatDeps, groupId: string): boolean {
    return readB(deps, `筱筱吖/事件系统/${groupId}.json`, SMART_CHAT_EVENT_KEY, '关闭') === '开启';
}

function legacyPrivateEnabled(deps: SmartChatDeps): boolean {
    return readB(deps, '筱筱吖/事件系统/私聊.json', SMART_CHAT_EVENT_KEY, '关闭') === '开启';
}

export function isSmartChatGroupEnabled(deps: SmartChatDeps, groupId: string): boolean {
    const gid = String(groupId || '').trim();
    if (!gid) return false;
    const cur = normStatus(readB(deps, SMART_CHAT_GROUP_SWITCH, gid, null));
    if (cur) return cur === '开启';
    if (legacyGroupEnabled(deps, gid)) {
        writeB(deps, SMART_CHAT_GROUP_SWITCH, gid, '开启');
        return true;
    }
    return false;
}

export function isSmartChatFriendEnabled(deps: SmartChatDeps, userId: string): boolean {
    const qq = String(userId || '').trim();
    if (!qq) return false;
    const cur = normStatus(readB(deps, SMART_CHAT_FRIEND_SWITCH, qq, null));
    if (cur) return cur === '开启';
    if (legacyPrivateEnabled(deps)) {
        // 旧版私聊为全局开关：首次查询某好友时落盘，避免后台全灭
        writeB(deps, SMART_CHAT_FRIEND_SWITCH, qq, '开启');
        return true;
    }
    return false;
}

export function isSmartChatAiOnlyGroup(deps: SmartChatDeps, groupId: string): boolean {
    const gid = String(groupId || '').trim();
    if (!gid) return false;
    return normStatus(readB(deps, SMART_CHAT_GROUP_AI_ONLY, gid, '关闭')) === '开启';
}

export function isSmartChatAiOnlyFriend(deps: SmartChatDeps, userId: string): boolean {
    const qq = String(userId || '').trim();
    if (!qq) return false;
    return normStatus(readB(deps, SMART_CHAT_FRIEND_AI_ONLY, qq, '关闭')) === '开启';
}

export function setSmartChatGroupEnabled(deps: SmartChatDeps, groupId: string, enabled: boolean): void {
    const gid = String(groupId || '').trim();
    if (!gid) return;
    writeB(deps, SMART_CHAT_GROUP_SWITCH, gid, enabled ? '开启' : '关闭');
}

export function setSmartChatFriendEnabled(deps: SmartChatDeps, userId: string, enabled: boolean): void {
    const qq = String(userId || '').trim();
    if (!qq) return;
    writeB(deps, SMART_CHAT_FRIEND_SWITCH, qq, enabled ? '开启' : '关闭');
}

export function setSmartChatAiOnlyGroup(deps: SmartChatDeps, groupId: string, enabled: boolean): void {
    const gid = String(groupId || '').trim();
    if (!gid) return;
    writeB(deps, SMART_CHAT_GROUP_AI_ONLY, gid, enabled ? '开启' : '关闭');
}

export function setSmartChatAiOnlyFriend(deps: SmartChatDeps, userId: string, enabled: boolean): void {
    const qq = String(userId || '').trim();
    if (!qq) return;
    writeB(deps, SMART_CHAT_FRIEND_AI_ONLY, qq, enabled ? '开启' : '关闭');
}

export function getSmartChatGroupRounds(deps: SmartChatDeps, groupId: string): number {
    const gid = String(groupId || '').trim();
    if (!gid) return 0;
    return normalizeSmartChatRounds(readB(deps, SMART_CHAT_GROUP_ROUNDS, gid, 0));
}

export function getSmartChatFriendRounds(deps: SmartChatDeps, userId: string): number {
    const qq = String(userId || '').trim();
    if (!qq) return 0;
    return normalizeSmartChatRounds(readB(deps, SMART_CHAT_FRIEND_ROUNDS, qq, 0));
}

export function setSmartChatGroupRounds(deps: SmartChatDeps, groupId: string, rounds: number): void {
    const gid = String(groupId || '').trim();
    if (!gid) return;
    writeB(deps, SMART_CHAT_GROUP_ROUNDS, gid, normalizeSmartChatRounds(rounds));
}

export function setSmartChatFriendRounds(deps: SmartChatDeps, userId: string, rounds: number): void {
    const qq = String(userId || '').trim();
    if (!qq) return;
    writeB(deps, SMART_CHAT_FRIEND_ROUNDS, qq, normalizeSmartChatRounds(rounds));
}

export function isSmartChatImageGroup(deps: SmartChatDeps, groupId: string): boolean {
    const gid = String(groupId || '').trim();
    if (!gid) return false;
    return normStatus(readB(deps, SMART_CHAT_GROUP_IMAGE, gid, '关闭')) === '开启';
}

export function isSmartChatImageFriend(deps: SmartChatDeps, userId: string): boolean {
    const qq = String(userId || '').trim();
    if (!qq) return false;
    return normStatus(readB(deps, SMART_CHAT_FRIEND_IMAGE, qq, '关闭')) === '开启';
}

export function setSmartChatImageGroup(deps: SmartChatDeps, groupId: string, enabled: boolean): void {
    const gid = String(groupId || '').trim();
    if (!gid) return;
    writeB(deps, SMART_CHAT_GROUP_IMAGE, gid, enabled ? '开启' : '关闭');
}

export function setSmartChatImageFriend(deps: SmartChatDeps, userId: string, enabled: boolean): void {
    const qq = String(userId || '').trim();
    if (!qq) return;
    writeB(deps, SMART_CHAT_FRIEND_IMAGE, qq, enabled ? '开启' : '关闭');
}

/** 当前对象是否开启识图（与全局联网页参数配合） */
export function isSmartChatImageForEvent(deps: SmartChatDeps, event: Record<string, unknown>): boolean {
    if (event.message_type === 'group') {
        return isSmartChatImageGroup(deps, String(event.group_id || ''));
    }
    if (event.message_type === 'private') {
        return isSmartChatImageFriend(deps, String(event.user_id || ''));
    }
    return false;
}

/** 当前对象历史上传轮次（0=全部） */
export function getSmartChatRoundsForEvent(deps: SmartChatDeps, event: Record<string, unknown>): number {
    if (event.message_type === 'group') {
        return getSmartChatGroupRounds(deps, String(event.group_id || ''));
    }
    if (event.message_type === 'private') {
        return getSmartChatFriendRounds(deps, String(event.user_id || ''));
    }
    return 0;
}

/** 当前消息是否启用智能对话 */
export function isSmartChatEnabledForEvent(
    deps: SmartChatDeps,
    event: Record<string, unknown>,
    cfg?: SmartChatConfig,
): boolean {
    const config = cfg || loadSmartChatConfig(deps);
    if (event.message_type === 'group') {
        return isSmartChatGroupEnabled(deps, String(event.group_id || ''));
    }
    if (event.message_type === 'private') {
        if (!config.private_chat_enabled) return false;
        return isSmartChatFriendEnabled(deps, String(event.user_id || ''));
    }
    return false;
}

/** 当前消息是否「仅 AI 对话」（命中后宿主应中断后续群管/娱乐等） */
export function isSmartChatAiOnlyForEvent(deps: SmartChatDeps, event: Record<string, unknown>): boolean {
    if (event.message_type === 'group') {
        return isSmartChatAiOnlyGroup(deps, String(event.group_id || ''));
    }
    if (event.message_type === 'private') {
        return isSmartChatAiOnlyFriend(deps, String(event.user_id || ''));
    }
    return false;
}

export function listSmartChatSwitchMap(
    deps: SmartChatDeps,
    type: 'group' | 'friend',
): Record<string, { enabled: boolean; ai_only: boolean; rounds: number; image_recognize: boolean }> {
    const switchFile = type === 'group' ? SMART_CHAT_GROUP_SWITCH : SMART_CHAT_FRIEND_SWITCH;
    const aiFile = type === 'group' ? SMART_CHAT_GROUP_AI_ONLY : SMART_CHAT_FRIEND_AI_ONLY;
    const roundsFile = type === 'group' ? SMART_CHAT_GROUP_ROUNDS : SMART_CHAT_FRIEND_ROUNDS;
    const imageFile = type === 'group' ? SMART_CHAT_GROUP_IMAGE : SMART_CHAT_FRIEND_IMAGE;
    const rawSwitch = deps.readA(switchFile);
    const rawAi = deps.readA(aiFile);
    const rawRounds = deps.readA(roundsFile);
    const rawImage = deps.readA(imageFile);
    let switchObj: Record<string, unknown> = {};
    let aiObj: Record<string, unknown> = {};
    let roundsObj: Record<string, unknown> = {};
    let imageObj: Record<string, unknown> = {};
    try {
        if (rawSwitch) switchObj = JSON.parse(String(rawSwitch)) || {};
    } catch { /* ignore */ }
    try {
        if (rawAi) aiObj = JSON.parse(String(rawAi)) || {};
    } catch { /* ignore */ }
    try {
        if (rawRounds) roundsObj = JSON.parse(String(rawRounds)) || {};
    } catch { /* ignore */ }
    try {
        if (rawImage) imageObj = JSON.parse(String(rawImage)) || {};
    } catch { /* ignore */ }

    const ids = new Set([
        ...Object.keys(switchObj || {}),
        ...Object.keys(aiObj || {}),
        ...Object.keys(roundsObj || {}),
        ...Object.keys(imageObj || {}),
    ]);
    const out: Record<string, { enabled: boolean; ai_only: boolean; rounds: number; image_recognize: boolean }> = {};
    for (const id of ids) {
        const en = normStatus(switchObj[id]);
        const ai = normStatus(aiObj[id]);
        const img = normStatus(imageObj[id]);
        out[id] = {
            enabled: en === '开启',
            ai_only: ai === '开启',
            rounds: normalizeSmartChatRounds(roundsObj[id]),
            image_recognize: img === '开启',
        };
    }
    return out;
}

export function bulkSetSmartChatEnabled(
    deps: SmartChatDeps,
    type: 'group' | 'friend',
    ids: string[],
    enabled: boolean,
): number {
    let n = 0;
    for (const id of ids) {
        if (!id) continue;
        if (type === 'group') setSmartChatGroupEnabled(deps, id, enabled);
        else setSmartChatFriendEnabled(deps, id, enabled);
        n += 1;
    }
    return n;
}
