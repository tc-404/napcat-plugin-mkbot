/** 娱乐分项开关：键名、路径与兼容读取（兼容旧版「深度娱乐」总开关） */

export const ENT_FEATURE_KEYS = [
  '签到',
  '我的信息',
  '幸运轮盘',
  '银行',
  '排行榜',
  '钓鱼',
  '商店',
  '禁言卡',
  '群老婆',
  '漂流瓶',
  '今日运势',
  '发病文学',
  '搜饰品',
  '查MC服务器',
  '三角洲密码',
  'Epic免费游戏',
] as const;

export type EntFeatureKey = (typeof ENT_FEATURE_KEYS)[number];

export const ENT_SWITCH_DIR = '筱筱吖/娱乐系统/娱乐开关';

/** 分项未配置时用此哨兵，回退到旧版总开关 */
const ENT_UNSET = '__ENT_UNSET__';

export function entSwitchFile(scope: string | number): string {
  return `${ENT_SWITCH_DIR}/${String(scope)}.json`;
}

function normalizeOnOff(raw: unknown): '开启' | '关闭' | null {
  if (raw === '开启' || raw === true || raw === 1 || raw === 'true' || raw === '1') return '开启';
  if (raw === '关闭' || raw === false || raw === 0 || raw === 'false' || raw === '0') return '关闭';
  return null;
}

/**
 * 读取某娱乐分项是否开启。
 * - 分项文件有值：以分项为准
 * - 分项未配置：回退旧版总开关（深度娱乐路径 / 娱乐模式.json），默认开启
 */
export function isEntertainmentFeatureOn(
  feature: string,
  scope: string | number,
  readB: (file: string, key: string, def?: unknown) => unknown,
  masterPath: string,
): boolean {
  const scoped = String(scope);
  const raw = readB(entSwitchFile(scoped), feature, ENT_UNSET);
  if (raw !== ENT_UNSET) {
    const n = normalizeOnOff(raw);
    if (n === '开启') return true;
    if (n === '关闭') return false;
  }
  const master = readB(masterPath, scoped, true);
  return master !== false && master !== 0 && master !== '关闭' && master !== 'false' && master !== '0';
}

/** 组装 WebUI / API 用的完整分项状态（缺省回退总开关） */
export function resolveEntertainmentSwitches(
  scope: string | number,
  readB: (file: string, key: string, def?: unknown) => unknown,
  masterPath: string,
  keys: readonly string[] = ENT_FEATURE_KEYS,
): Record<string, '开启' | '关闭'> {
  const out: Record<string, '开启' | '关闭'> = {};
  for (const k of keys) {
    out[k] = isEntertainmentFeatureOn(k, scope, readB, masterPath) ? '开启' : '关闭';
  }
  return out;
}
