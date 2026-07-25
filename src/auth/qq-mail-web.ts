// @ts-nocheck
// ---------------------------------------------------------------------------
// QQ 邮箱配置 WebUI API（仅后台设置，授权码不回读）
// ---------------------------------------------------------------------------

import {
  listQqMailSlots,
  saveQqMailSlot,
  verifyAllQqMailSlots,
  verifyQqMailSlot,
  type QqMailDeps,
} from '../lib/api/qq-mail';

async function parsePostBody(req: { body?: unknown; on?: (ev: string, fn: (...args: unknown[]) => void) => void }) {
  let body = req.body;
  if (!body || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
    try {
      const raw = await new Promise<string>((resolve) => {
        let data = '';
        req.on?.('data', (chunk: Buffer | string) => { data += chunk; });
        req.on?.('end', () => resolve(data));
      });
      if (raw) body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

export function registerQqMailWebGetRoutes(
  base: { get: (path: string, handler: (...args: unknown[]) => unknown) => void },
  wrapPath: (p: string) => string,
  deps: QqMailDeps,
  logger?: { error?: (...args: unknown[]) => void },
) {
  base.get(wrapPath('/qq-mail/slots'), (_req, res) => {
    try {
      res.json({ code: 0, data: listQqMailSlots(deps) });
    } catch (error) {
      logger?.error?.('获取 QQ 邮箱配置失败:', error);
      res.status(500).json({ code: -1, message: '获取 QQ 邮箱配置失败' });
    }
  });
}

export function registerQqMailWebPostRoutes(
  base: { post: (path: string, handler: (...args: unknown[]) => unknown) => void },
  wrapPath: (p: string) => string,
  deps: QqMailDeps,
  logger?: { error?: (...args: unknown[]) => void },
) {
  base.post(wrapPath('/qq-mail/save'), async (req, res) => {
    try {
      const body = await parsePostBody(req);
      const r = saveQqMailSlot(deps, body);
      if (!r.ok) {
        const msgMap: Record<string, string> = {
          invalid_slot: '无效的邮箱槽位',
          invalid_email: 'QQ 邮箱格式不正确（需 @qq.com 或 @foxmail.com）',
          auth_required: '首次配置必须填写 SMTP 授权码',
        };
        res.status(400).json({ code: -1, message: msgMap[r.message] || r.message });
        return;
      }
      res.json({ code: 0, data: r.data });
    } catch (error) {
      logger?.error?.('保存 QQ 邮箱配置失败:', error);
      res.status(500).json({ code: -1, message: '保存 QQ 邮箱配置失败' });
    }
  });

  base.post(wrapPath('/qq-mail/verify'), async (req, res) => {
    try {
      const body = await parsePostBody(req);
      const r = await verifyQqMailSlot(deps, body.slot);
      if (!r.ok) {
        const msgMap: Record<string, string> = {
          invalid_slot: '无效的邮箱槽位',
          not_configured: '该槽位尚未配置邮箱',
        };
        res.status(400).json({ code: -1, message: msgMap[r.message] || r.message });
        return;
      }
      res.json({ code: 0, data: r.data });
    } catch (error) {
      logger?.error?.('验证 QQ 邮箱配置失败:', error);
      res.status(500).json({ code: -1, message: '验证 QQ 邮箱配置失败' });
    }
  });

  base.post(wrapPath('/qq-mail/verify-all'), async (_req, res) => {
    try {
      const r = await verifyAllQqMailSlots(deps);
      res.json({ code: 0, data: r.data });
    } catch (error) {
      logger?.error?.('批量验证 QQ 邮箱配置失败:', error);
      res.status(500).json({ code: -1, message: '批量验证 QQ 邮箱配置失败' });
    }
  });
}
