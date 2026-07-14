// ---------------------------------------------------------------------------
// QQ 邮箱发信 — 仅 MK 主包引用，不进入 lib/api/qq-mail.mjs 独立包
// 调用：发邮箱("QQ邮箱", { 标题, 名字, 内容, 收件人 })
// 槽位 1 为主邮箱，槽位 2 为备用（主邮箱失败时自动切换）
// ---------------------------------------------------------------------------

import tls from 'tls';
import { loadQqMailCredentials, type QqMailDeps } from './qq-mail';

export type MkQqMailSendDeps = QqMailDeps & { __mkMailInternal?: string };

export interface MkQqMailSendPayload {
  标题?: string;
  subject?: string;
  名字?: string;
  fromName?: string;
  内容?: string;
  content?: string;
  html?: string;
  text?: string;
  收件人?: string | string[];
  to?: string | string[];
}

export interface MkQqMailSendResult {
  ok: boolean;
  message?: string;
  slot?: number;
  from?: string;
  to?: string[];
  attempts?: Array<{ slot: number; message: string }>;
}

let mkMailInternalSecret = '';

/** 仅 mkbot-core 在 plugin_init 时调用 */
export function setMkQqMailInternalSecret(secret: string) {
  mkMailInternalSecret = String(secret || '');
}

function isMkInternalSendAllowed(deps: MkQqMailSendDeps) {
  return Boolean(
    mkMailInternalSecret &&
    deps.__mkMailInternal &&
    deps.__mkMailInternal === mkMailInternalSecret,
  );
}

function encodeMimeHeader(text: string) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/^[\x20-\x7E]+$/.test(raw)) return raw;
  return `=?UTF-8?B?${Buffer.from(raw, 'utf8').toString('base64')}?=`;
}

function normalizeRecipients(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const item of list) {
    const email = String(item ?? '').trim();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function parseMkQqMailSendPayload(args: unknown[]): MkQqMailSendPayload | null {
  if (!args.length) return null;
  const first = args[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return first as MkQqMailSendPayload;
  }
  const [标题, 名字, 内容, 收件人] = args;
  return {
    标题: 标题 != null ? String(标题) : '',
    名字: 名字 != null ? String(名字) : '',
    内容: 内容 != null ? String(内容) : '',
    收件人: 收件人 as string | string[],
  };
}

function buildMimeMessage(input: {
  fromEmail: string;
  fromName?: string;
  to: string[];
  subject: string;
  content: string;
}) {
  const subject = encodeMimeHeader(input.subject || '(无主题)');
  const fromName = String(input.fromName || '').trim();
  const from = fromName
    ? `${encodeMimeHeader(fromName)} <${input.fromEmail}>`
    : input.fromEmail;
  const body = String(input.content ?? '');
  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  const contentType = isHtml ? 'text/html' : 'text/plain';
  const encodedBody = Buffer.from(body, 'utf8').toString('base64');
  const foldedBody = encodedBody.replace(/.{1,76}/g, (m) => `${m}\r\n`).trimEnd();
  const headers = [
    `From: ${from}`,
    `To: ${input.to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    foldedBody,
  ];
  return dotStuff(headers.join('\r\n'));
}

function dotStuff(text: string) {
  return text.replace(/^\./gm, '..');
}

interface SmtpCred {
  email: string;
  authCode: string;
  smtpHost: string;
  smtpPort: number;
}

function smtpSendMessage(
  cred: SmtpCred,
  recipients: string[],
  rawMessage: string,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    type Phase =
      | 'greet'
      | 'ehlo'
      | 'auth'
      | 'user'
      | 'pass'
      | 'mail_from'
      | 'rcpt'
      | 'data'
      | 'body'
      | 'done';
    let phase: Phase = 'greet';
    let ehloPending = false;
    let rcptIndex = 0;

    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const writeLine = (line: string) => {
      socket.write(`${line}\r\n`);
    };

    const handleCode = (code: number, line: string) => {
      if (code >= 400 && phase !== 'done') {
        finish({ ok: false, message: line.slice(4).trim() || `SMTP 错误 (${code})` });
        return;
      }

      if (phase === 'greet' && code === 220) {
        phase = 'ehlo';
        ehloPending = true;
        writeLine('EHLO mkbot.local');
      } else if (phase === 'ehlo' && code === 250) {
        if (ehloPending && line.length > 3 && line[3] === ' ') {
          ehloPending = false;
          phase = 'auth';
          writeLine('AUTH LOGIN');
        }
      } else if (phase === 'auth' && code === 334) {
        phase = 'user';
        writeLine(Buffer.from(cred.email, 'utf8').toString('base64'));
      } else if (phase === 'user' && code === 334) {
        phase = 'pass';
        writeLine(Buffer.from(cred.authCode, 'utf8').toString('base64'));
      } else if (phase === 'pass' && code === 235) {
        phase = 'mail_from';
        writeLine(`MAIL FROM:<${cred.email}>`);
      } else if (phase === 'pass') {
        finish({ ok: false, message: line.slice(4).trim() || `SMTP 认证失败 (${code})` });
      } else if (phase === 'mail_from' && code === 250) {
        phase = 'rcpt';
        rcptIndex = 0;
        writeLine(`RCPT TO:<${recipients[rcptIndex]}>`);
      } else if (phase === 'rcpt' && code === 250) {
        rcptIndex += 1;
        if (rcptIndex < recipients.length) {
          writeLine(`RCPT TO:<${recipients[rcptIndex]}>`);
        } else {
          phase = 'data';
          writeLine('DATA');
        }
      } else if (phase === 'data' && code === 354) {
        phase = 'body';
        socket.write(`${rawMessage}\r\n.\r\n`);
      } else if (phase === 'body' && code === 250) {
        phase = 'done';
        finish({ ok: true, message: '邮件发送成功' });
      }
    };

    const socket = tls.connect(
      {
        host: cred.smtpHost,
        port: cred.smtpPort,
        servername: cred.smtpHost,
        rejectUnauthorized: true,
      },
      () => {},
    );

    socket.setTimeout(30000, () => finish({ ok: false, message: 'SMTP 连接超时' }));

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line || line.length < 3) continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;
        handleCode(code, line);
        if (settled) return;
      }
    });

    socket.on('error', (err) => finish({ ok: false, message: err.message || 'SMTP 连接失败' }));
  });
}

/**
 * MK 插件内部发信：发邮箱("QQ邮箱", { 标题, 名字, 内容, 收件人 })
 * 槽位 1 为主邮箱，失败时自动切换槽位 2。
 */
export async function sendMkQqMail(
  deps: MkQqMailSendDeps,
  provider: string,
  args: unknown[],
): Promise<MkQqMailSendResult> {
  if (!isMkInternalSendAllowed(deps)) {
    return { ok: false, message: '发邮箱仅允许 MK 插件内部调用' };
  }
  if (String(provider || '').trim() !== 'QQ邮箱') {
    return { ok: false, message: '暂不支持该邮箱渠道' };
  }

  const payload = parseMkQqMailSendPayload(args);
  if (!payload) return { ok: false, message: '缺少发信参数' };

  const subject = String(payload.标题 ?? payload.subject ?? '').trim() || '(无主题)';
  const fromName = String(payload.名字 ?? payload.fromName ?? '').trim();
  const content = String(
    payload.内容 ?? payload.content ?? payload.html ?? payload.text ?? '',
  );
  const recipients = normalizeRecipients(payload.收件人 ?? payload.to);

  if (!recipients.length) return { ok: false, message: '收件人无效或为空' };
  if (!content.trim()) return { ok: false, message: '邮件内容不能为空' };

  const attempts: Array<{ slot: number; message: string }> = [];

  for (const slot of [1, 2]) {
    const cred = loadQqMailCredentials(deps, slot);
    if (!cred) continue;

    const raw = buildMimeMessage({
      fromEmail: cred.email,
      fromName,
      to: recipients,
      subject,
      content,
    });

    const result = await smtpSendMessage(cred, recipients, raw);
    if (result.ok) {
      return {
        ok: true,
        message: result.message,
        slot,
        from: cred.email,
        to: recipients,
        attempts,
      };
    }
    attempts.push({ slot, message: result.message });
  }

  if (!attempts.length) {
    return { ok: false, message: '未找到可用 QQ 邮箱配置，请先在后台进阶设置中配置' };
  }

  return {
    ok: false,
    message: `主备邮箱均发送失败：${attempts.map((a) => `槽位${a.slot} ${a.message}`).join('；')}`,
    attempts,
  };
}
