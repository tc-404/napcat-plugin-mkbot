// ---------------------------------------------------------------------------
// 本地视频解析 API 加载器（运行时从 lib/api/*.mjs 动态导入）
// ---------------------------------------------------------------------------

import path from 'path';
import { pathToFileURL } from 'url';

export type LocalVideoApiName = 'blbl' | 'dy' | 'xhs' | 'ks';

export interface LocalImghostInput {
  buffer?: Buffer;
  filepath?: string;
  url?: string;
  filename?: string;
}

export interface LocalImghostResult {
  code: number;
  msg: string;
  data?: {
    url: string;
    source: 'cdn58' | 'pngcm' | 'imgdd';
  };
}

const moduleCache = new Map<LocalVideoApiName, { parse: (input: string) => Promise<unknown> }>();
let imghostModuleCache: { upload: (input: LocalImghostInput) => Promise<LocalImghostResult> } | null = null;

/**
 * 调用本地 lib/api 解析模块
 * @param pluginDir 插件根目录（index.mjs 所在目录，即 napcat-plugin-mkbot/）
 * @param apiName blbl | dy | xhs | ks
 * @param input 链接或原始文本
 */
export async function callLocalVideoApi(
  pluginDir: string,
  apiName: LocalVideoApiName,
  input: string,
): Promise<unknown> {
  let mod = moduleCache.get(apiName);
  if (!mod) {
    const modPath = path.join(pluginDir, 'lib', 'api', `${apiName}.mjs`);
    mod = (await import(pathToFileURL(modPath).href)) as { parse: (input: string) => Promise<unknown> };
    moduleCache.set(apiName, mod);
  }
  return mod.parse(input);
}

/**
 * 调用本地 lib/api 聚合图床模块（58同城 → fuliba → IMGDD）
 * @param pluginDir 插件根目录（index.mjs 所在目录）
 * @param input buffer / filepath / url + 可选 filename
 */
export async function callLocalImghostApi(
  pluginDir: string,
  input: LocalImghostInput,
): Promise<LocalImghostResult> {
  if (!imghostModuleCache) {
    const modPath = path.join(pluginDir, 'lib', 'api', 'imghost.mjs');
    imghostModuleCache = (await import(pathToFileURL(modPath).href)) as {
      upload: (input: LocalImghostInput) => Promise<LocalImghostResult>;
    };
  }
  return imghostModuleCache.upload(input);
}
