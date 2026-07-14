// @ts-nocheck
// ---------------------------------------------------------------------------
// 离线通知：监听 NapCat/SL 协议 bot_offline 上报，邮件通知指定 QQ
// 数据目录：筱筱吖/扩展功能/离线通知/
// ---------------------------------------------------------------------------

import { hasQqMailConfigured } from '../lib/api/qq-mail';

export const OFFLINE_NOTIFY_ROOT = '筱筱吖/扩展功能/离线通知/';
const CONFIG_FILE = '配置.json';

export const OFFLINE_MAIL_SUBJECT = '【MKbot离线通知】机器人账号已掉线';
export const OFFLINE_MAIL_FROM_NAME = 'MKbot离线监控';

export interface OfflineNotifyDeps {
  readA: (relPath: string) => string | null | undefined;
  writeA: (relPath: string, content: string) => void;
  getDataPath: () => string;
  发邮箱?: (provider: string, ...args: unknown[]) => Promise<{ ok: boolean; message?: string }>;
}

interface OfflineNotifyConfig {
  enabled: boolean;
  notifyQQs: string[];
}

function defaultConfig(): OfflineNotifyConfig {
  return { enabled: false, notifyQQs: [] };
}

function normalizeQQList(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const item of list) {
    const qq = String(item ?? '').trim().replace(/\D/g, '');
    if (qq && /^\d{5,12}$/.test(qq) && !out.includes(qq)) out.push(qq);
  }
  return out;
}

function loadConfigRaw(deps: OfflineNotifyDeps): OfflineNotifyConfig {
  const content = deps.readA(`${OFFLINE_NOTIFY_ROOT}${CONFIG_FILE}`);
  if (!content) return defaultConfig();
  try {
    const obj = JSON.parse(content);
    return {
      enabled: obj?.enabled === true || obj?.enabled === 'true' || obj?.enabled === 1 || obj?.enabled === '1',
      notifyQQs: normalizeQQList(obj?.notifyQQs),
    };
  } catch {
    return defaultConfig();
  }
}

export function getOfflineNotifySettings(deps: OfflineNotifyDeps) {
  const cfg = loadConfigRaw(deps);
  const mailConfigured = hasQqMailConfigured(deps);
  return {
    enabled: cfg.enabled,
    notifyQQs: cfg.notifyQQs,
    mailConfigured,
    canNotify: cfg.enabled && mailConfigured && cfg.notifyQQs.length > 0,
  };
}

export function saveOfflineNotifySettings(
  deps: OfflineNotifyDeps,
  input: { enabled?: unknown; notifyQQs?: unknown },
) {
  const current = loadConfigRaw(deps);
  const enabled =
    input.enabled === true ||
    input.enabled === 'true' ||
    input.enabled === 1 ||
    input.enabled === '1';
  const notifyQQs = input.notifyQQs !== undefined
    ? normalizeQQList(input.notifyQQs)
    : current.notifyQQs;
  const next: OfflineNotifyConfig = { enabled, notifyQQs };
  deps.writeA(`${OFFLINE_NOTIFY_ROOT}${CONFIG_FILE}`, JSON.stringify(next, null, 2));
  return getOfflineNotifySettings(deps);
}

function buildOfflineMailBody(event: Record<string, unknown>) {
  const selfId = String(event.self_id ?? '—');
  const tag = String(event.tag ?? '下线通知');
  const msg = String(event.message ?? '账号已掉线');
  const ts = event.time ? new Date(Number(event.time) * 1000).toLocaleString() : new Date().toLocaleString();
  return [
    'MKbot 离线通知',
    '══════════════',
    `机器人 QQ：${selfId}`,
    `上报类型：bot_offline（NapCat/SL 协议）`,
    `标签：${tag}`,
    `说明：${msg}`,
    `上报时间：${ts}`,
    '══════════════',
    '请尽快检查 NapCat 登录状态并重新登录。',
    '此邮件由 MKbot 离线监控自动发送。',
  ].join('\n');
}

/** 仅响应 notice_type === bot_offline，忽略重连/心跳等日志 */
export async function handleOfflineNotifyBotOffline(
  event: Record<string, unknown>,
  deps: OfflineNotifyDeps,
) {
  if (String(event?.post_type) !== 'notice') return;
  if (String(event?.notice_type) !== 'bot_offline') return;

  const cfg = loadConfigRaw(deps);
  if (!cfg.enabled) return;
  if (!hasQqMailConfigured(deps)) return;
  if (!cfg.notifyQQs.length) return;
  if (typeof deps.发邮箱 !== 'function') return;

  const recipients = cfg.notifyQQs.map((qq) => `${qq}@qq.com`);
  const content = buildOfflineMailBody(event);

  try {
    await deps.发邮箱('QQ邮箱', {
      标题: OFFLINE_MAIL_SUBJECT,
      名字: OFFLINE_MAIL_FROM_NAME,
      内容: content,
      收件人: recipients,
    });
  } catch {
    /* 静默失败，不阻断事件处理 */
  }
}
