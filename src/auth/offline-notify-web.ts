// @ts-nocheck
// ---------------------------------------------------------------------------
// 离线通知 WebUI API
// ---------------------------------------------------------------------------

import type { OfflineNotifyDeps } from './offline-notify';
import { getOfflineNotifySettings, saveOfflineNotifySettings } from './offline-notify';

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

export function registerOfflineNotifyWebGetRoutes(
  base: { get: (path: string, handler: (...args: unknown[]) => unknown) => void },
  wrapPath: (p: string) => string,
  deps: OfflineNotifyDeps,
  logger?: { error?: (...args: unknown[]) => void },
) {
  base.get(wrapPath('/offline-notify/config'), (_req, res) => {
    try {
      res.json({ code: 0, data: getOfflineNotifySettings(deps) });
    } catch (error) {
      logger?.error?.('获取离线通知配置失败:', error);
      res.status(500).json({ code: -1, message: '获取离线通知配置失败' });
    }
  });
}

export function registerOfflineNotifyWebPostRoutes(
  base: { post: (path: string, handler: (...args: unknown[]) => unknown) => void },
  wrapPath: (p: string) => string,
  deps: OfflineNotifyDeps,
  logger?: { error?: (...args: unknown[]) => void },
) {
  base.post(wrapPath('/offline-notify/save'), async (req, res) => {
    try {
      const body = await parsePostBody(req);
      res.json({ code: 0, data: saveOfflineNotifySettings(deps, body) });
    } catch (error) {
      logger?.error?.('保存离线通知配置失败:', error);
      res.status(500).json({ code: -1, message: '保存离线通知配置失败' });
    }
  });
}
