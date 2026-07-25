// @ts-nocheck
// ---------------------------------------------------------------------------
// 智能对话 — 消息缓冲与防抖
// ---------------------------------------------------------------------------

import type { SmartChatBufferEntry, SmartChatDeps } from './smart-chat-types';
import { SMART_CHAT_ROOT } from './smart-chat-types';

interface ChatBufferState {
    pending: SmartChatBufferEntry[];
}

function bufferPath(chatId: string): string {
    return `${SMART_CHAT_ROOT}buffer/${chatId}.json`;
}

export function loadChatBuffer(deps: SmartChatDeps, chatId: string): SmartChatBufferEntry[] {
    const raw = deps.readA(bufferPath(chatId));
    if (!raw) return [];
    try {
        const obj = JSON.parse(raw);
        return Array.isArray(obj?.pending) ? obj.pending : [];
    } catch {
        return [];
    }
}

export function saveChatBuffer(deps: SmartChatDeps, chatId: string, pending: SmartChatBufferEntry[]): void {
    const payload: ChatBufferState = { pending };
    deps.writeA(bufferPath(chatId), JSON.stringify(payload, null, 2));
}

export function appendChatBuffer(deps: SmartChatDeps, chatId: string, entry: SmartChatBufferEntry): SmartChatBufferEntry[] {
    const pending = loadChatBuffer(deps, chatId);
    pending.push(entry);
    saveChatBuffer(deps, chatId, pending);
    return pending;
}

export function clearChatBuffer(deps: SmartChatDeps, chatId: string): void {
    saveChatBuffer(deps, chatId, []);
}

export function takeChatBuffer(deps: SmartChatDeps, chatId: string): SmartChatBufferEntry[] {
    const pending = loadChatBuffer(deps, chatId);
    saveChatBuffer(deps, chatId, []);
    return pending;
}
