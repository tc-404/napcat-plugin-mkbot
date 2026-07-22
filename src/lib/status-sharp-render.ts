// ---------------------------------------------------------------------------
// Sharp 渲染：运行状态卡片（UI 布局参考 data/默认资源/状态.html）
// ---------------------------------------------------------------------------

import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MkLoggerResolved } from '../types';
import { loadSharp } from './sharp-loader';

export interface StatusProcessRow {
  pid: string;
  name: string;
  memoryMB: string;
  cpuPercent: string;
}

export interface StatusSharpRenderOptions {
  name: string;
  qq: string;
  type: string;
  arch: string;
  cpuCount: number;
  cpuUsagePercent: string | number;
  totalMemoryGB: string;
  memoryUsagePercent: string | number;
  diskTotalGB: string;
  diskUsedGB: string;
  diskFreeGB: string;
  diskUsagePercent: string | number;
  groupCount: number;
  friendCount: number;
  backgroundImageUrl?: string;
  bgLocalPath?: string;
  pluginPath?: string;
  processes?: StatusProcessRow[];
  pluginDir?: string;
  dataPath?: string;
  width?: number;
  height?: number;
}

const STATUS_BG_REMOTE_URL =
  'http://xn--mk-ub3cl61ae1v.xn--c5w857b.xn--fiqs8s/mkbot/image/yunxing.jpg';

function escapeXml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(text: string, maxLen: number): string {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function toPercentNum(v: string | number): number {
  const n = Number(String(v ?? '').replace('%', '').trim());
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function usageColor(percent: number): string {
  if (percent < 50) return '#4CAF50';
  if (percent < 75) return '#FF9800';
  return '#F44336';
}

function usageGlowId(percent: number): string {
  if (percent < 50) return 'pctGlowGreen';
  if (percent < 75) return 'pctGlowOrange';
  return 'pctGlowRed';
}

function fetchUrlBuffer(url: string, timeoutMs = 20000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'MKbot-StatusSharp/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrlBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/i);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

async function loadStatusBackground(
  backgroundImageUrl: string,
  bgLocalPath: string,
  pluginDir: string,
  pluginPath: string,
  dataPath: string,
): Promise<Buffer | null> {
  const candidates: string[] = [];
  const push = (v?: string) => {
    const s = String(v || '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };

  push(bgLocalPath);

  const localNames = ['运行状态.jpg', '运行状态.jpeg', '运行状态.png', '运行状态.webp', 'yunxing.jpg'];
  const roots = [
    path.join(String(dataPath || '').trim(), '默认资源', 'image'),
    path.join(String(pluginPath || '').trim(), 'data', '默认资源', 'image'),
    path.join(String(pluginDir || '').trim(), 'data', '默认资源', 'image'),
  ];
  for (const root of roots) {
    if (!String(root || '').trim()) continue;
    for (const name of localNames) {
      push(path.join(root, name));
    }
  }

  push(backgroundImageUrl);
  if (backgroundImageUrl !== STATUS_BG_REMOTE_URL) {
    push(STATUS_BG_REMOTE_URL);
  }

  for (const src of candidates) {
    try {
      if (/^data:/i.test(src)) {
        const buf = decodeDataUrl(src);
        if (buf && buf.length) return buf;
        continue;
      }
      if (/^file:\/\//i.test(src)) {
        const abs = fileURLToPath(src);
        if (fs.existsSync(abs)) return fs.readFileSync(abs);
        continue;
      }
      if (/^https?:\/\//i.test(src)) {
        const buf = await fetchUrlBuffer(src, 12000);
        if (buf.length > 0) return buf;
        continue;
      }
      if (fs.existsSync(src)) return fs.readFileSync(src);
    } catch (_e) {
      /* try next */
    }
  }
  return null;
}

function gaugeSvg(
  cx: number,
  cy: number,
  outerR: number,
  percent: number,
  color: string,
  glowId: string,
  label: string,
): string {
  const strokeW = 12;
  const r = outerR - strokeW / 2;
  const circ = 2 * Math.PI * r;
  const arcLen = circ * (percent / 100);
  const innerR = outerR - 14;
  const pctText = `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="${strokeW}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}"
      stroke-dasharray="${arcLen} ${circ - arcLen}" stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="rgba(255,255,255,0.95)"/>
    <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="22" font-weight="bold" fill="#333" filter="url(#${glowId})">${pctText}</text>
    <text x="${cx}" y="${cy + outerR + 24}" text-anchor="middle" font-size="14" fill="rgba(255,255,255,0.85)" font-weight="500">${escapeXml(label)}</text>
  `;
}

function glassRect(x: number, y: number, w: number, h: number, rx = 15): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`;
}

function cardTitle(x: number, y: number, w: number, text: string): string {
  const font = 'Microsoft YaHei, Noto Sans SC, sans-serif';
  return `
    <text x="${x}" y="${y}" font-family="${font}" font-size="18" font-weight="bold" fill="#ffffff">${escapeXml(text)}</text>
    <line x1="${x}" y1="${y + 8}" x2="${x + w}" y2="${y + 8}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  `;
}

function infoRow(x: number, y: number, w: number, label: string, value: string, highlight = false): string {
  const font = 'Microsoft YaHei, Noto Sans SC, sans-serif';
  const valAttr = highlight ? ' filter="url(#titleGlow)" font-weight="bold"' : ' font-weight="600"';
  return `
    <text x="${x}" y="${y}" font-family="${font}" font-size="13" fill="rgba(255,255,255,0.78)">${escapeXml(label)}</text>
    <text x="${x + w}" y="${y}" text-anchor="end" font-family="${font}" font-size="13" fill="#ffffff"${valAttr}>${escapeXml(value)}</text>
    <line x1="${x}" y1="${y + 6}" x2="${x + w}" y2="${y + 6}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  `;
}

function buildStatusOverlaySvg(width: number, height: number, opts: StatusSharpRenderOptions): string {
  const font = 'Microsoft YaHei, Noto Sans SC, sans-serif';
  const pad = 20;
  const name = escapeXml(truncateText(opts.name || 'Bot', 18));
  const qq = escapeXml(String(opts.qq || ''));
  const cpuPct = toPercentNum(opts.cpuUsagePercent);
  const memPct = toPercentNum(opts.memoryUsagePercent);
  const diskPct = toPercentNum(opts.diskUsagePercent);
  const cpuColor = usageColor(cpuPct);
  const memColor = usageColor(memPct);
  const diskColor = usageColor(diskPct);
  const processes = (opts.processes || []).slice(0, 12);

  const headerX = pad;
  const headerY = pad;
  const headerW = width - pad * 2;
  const headerH = 150;

  const leftX = pad;
  const leftW = Math.floor((width - pad * 3) / 2);
  const rightX = leftX + leftW + pad;
  const rightW = width - rightX - pad;
  const mainY = headerY + headerH + 20;
  const sysH = 400;
  const storeY = mainY + sysH + 20;
  const storeH = height - storeY - pad;
  const rightH = height - mainY - pad;

  const infoCards = [
    escapeXml(String(opts.type || '')),
    escapeXml(String(opts.arch || '')),
    `群聊数量: ${opts.groupCount ?? 0}`,
    `好友数量: ${opts.friendCount ?? 0}`,
  ];
  const cardW = 240;
  const cardH = 52;
  const cardsOriginX = headerX + headerW - cardW * 2 - 15;
  const cardsOriginY = headerY + 22;

  const parts: string[] = [];
  parts.push(`<defs>
    <filter id="titleGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.9"/>
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#ff77b7" flood-opacity="0.65"/>
    </filter>
    <filter id="pctGlowGreen" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#81C784" flood-opacity="0.7"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#4CAF50" flood-opacity="0.9"/>
    </filter>
    <filter id="pctGlowOrange" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffe082" flood-opacity="0.7"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#FF9800" flood-opacity="0.9"/>
    </filter>
    <filter id="pctGlowRed" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ef9a9a" flood-opacity="0.7"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#F44336" flood-opacity="0.9"/>
    </filter>
  </defs>`);

  parts.push(glassRect(headerX, headerY, headerW, headerH));

  const avatarCx = headerX + 80;
  const avatarCy = headerY + 75;
  const avatarR = 60;
  parts.push(
    `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>`,
  );

  const infoX = headerX + 170;
  parts.push(
    `<text x="${infoX}" y="${headerY + 58}" font-family="${font}" font-size="32" font-weight="bold" fill="#ffffff" filter="url(#titleGlow)">${name}</text>`,
  );
  parts.push(
    `<text x="${infoX}" y="${headerY + 88}" font-family="${font}" font-size="16" fill="rgba(255,255,255,0.82)">QQ: ${qq}</text>`,
  );

  infoCards.forEach((val, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = cardsOriginX + col * (cardW + 15);
    const y = cardsOriginY + row * (cardH + 12);
    parts.push(glassRect(x, y, cardW, cardH, 10));
    parts.push(
      `<text x="${x + cardW / 2}" y="${y + 32}" text-anchor="middle" font-family="${font}" font-size="15" font-weight="bold" fill="#ffffff">${val}</text>`,
    );
  });

  parts.push(glassRect(leftX, mainY, leftW, sysH));
  parts.push(cardTitle(leftX + 25, mainY + 32, leftW - 50, '系统状态'));

  const gaugeY = mainY + 175;
  const gaugeR = 58;
  parts.push(gaugeSvg(leftX + leftW * 0.28, gaugeY, gaugeR, cpuPct, cpuColor, usageGlowId(cpuPct), 'CPU'));
  parts.push(gaugeSvg(leftX + leftW * 0.72, gaugeY, gaugeR, memPct, memColor, usageGlowId(memPct), '内存'));

  const rowX = leftX + 25;
  const rowW = leftW - 50;
  let rowY = mainY + 280;
  const rowGap = 34;
  parts.push(infoRow(rowX, rowY, rowW, 'CPU核心数:', String(opts.cpuCount ?? 0)));
  rowY += rowGap;
  parts.push(infoRow(rowX, rowY, rowW, 'CPU使用率:', `${cpuPct.toFixed(2)}%`, true));
  rowY += rowGap;
  parts.push(infoRow(rowX, rowY, rowW, '内存总量:', String(opts.totalMemoryGB || '')));
  rowY += rowGap;
  parts.push(infoRow(rowX, rowY, rowW, '内存使用率:', `${memPct.toFixed(2)}%`, true));

  parts.push(glassRect(leftX, storeY, leftW, storeH));
  parts.push(cardTitle(leftX + 25, storeY + 32, leftW - 50, '存储状态'));

  const barX = leftX + 25;
  const barW = leftW - 50;
  const barY = storeY + 70;
  const barH = 20;
  const fillW = Math.max(0, Math.min(barW, (barW * diskPct) / 100));
  parts.push(
    `<text x="${barX}" y="${barY - 8}" font-family="${font}" font-size="12" fill="rgba(255,255,255,0.8)">磁盘使用情况</text>`,
  );
  parts.push(
    `<text x="${barX + barW}" y="${barY - 8}" text-anchor="end" font-family="${font}" font-size="12" fill="rgba(255,255,255,0.8)">${escapeXml(String(opts.diskUsedGB || ''))} / ${escapeXml(String(opts.diskTotalGB || ''))}</text>`,
  );
  parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="10" fill="rgba(255,255,255,0.2)"/>`);
  parts.push(`<rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="10" fill="${diskColor}"/>`);
  parts.push(
    `<text x="${barX}" y="${barY + 48}" font-family="${font}" font-size="16" font-weight="bold" fill="#ffffff" filter="url(#${usageGlowId(diskPct)})">${diskPct.toFixed(2)}%</text>`,
  );

  rowY = storeY + 150;
  parts.push(infoRow(rowX, rowY, rowW, '总容量:', String(opts.diskTotalGB || '')));
  rowY += rowGap;
  parts.push(infoRow(rowX, rowY, rowW, '已用:', String(opts.diskUsedGB || ''), true));
  rowY += rowGap;
  parts.push(infoRow(rowX, rowY, rowW, '可用:', String(opts.diskFreeGB || '')));

  parts.push(glassRect(rightX, mainY, rightW, rightH));
  parts.push(cardTitle(rightX + 25, mainY + 32, rightW - 50, '进程占用排行榜 (按内存占用降序排列)'));

  const tableX = rightX + 20;
  const tableY = mainY + 58;
  const tableW = rightW - 40;
  const colRank = 36;
  const colPid = 70;
  const colMem = 100;
  const colCpu = 72;
  const colName = tableW - colRank - colPid - colMem - colCpu;

  parts.push(`<rect x="${tableX}" y="${tableY}" width="${tableW}" height="38" rx="8" fill="rgba(255,255,255,0.1)"/>`);
  const thY = tableY + 25;
  parts.push(`<text x="${tableX + 8}" y="${thY}" font-family="${font}" font-size="12" font-weight="600" fill="#ffffff">排名</text>`);
  parts.push(`<text x="${tableX + colRank + 4}" y="${thY}" font-family="${font}" font-size="12" font-weight="600" fill="#ffffff">进程名</text>`);
  parts.push(`<text x="${tableX + colRank + colName + 4}" y="${thY}" font-family="${font}" font-size="12" font-weight="600" fill="#ffffff">PID</text>`);
  parts.push(`<text x="${tableX + colRank + colName + colPid + 4}" y="${thY}" font-family="${font}" font-size="12" font-weight="600" fill="#ffffff">内存占用</text>`);
  parts.push(`<text x="${tableX + tableW - 8}" y="${thY}" text-anchor="end" font-family="${font}" font-size="12" font-weight="600" fill="#ffffff">CPU占比</text>`);

  const rowH = 36;
  processes.forEach((proc, idx) => {
    const y = tableY + 38 + idx * rowH;
    const rank = idx + 1;
    const pName = escapeXml(truncateText(proc.name || 'Unknown', 22));
    const pid = escapeXml(String(proc.pid || ''));
    const mem = escapeXml(`${proc.memoryMB || '0'} MB`);
    const cpu = escapeXml(`${proc.cpuPercent || '0'}%`);
    if (idx % 2 === 1) {
      parts.push(`<rect x="${tableX}" y="${y}" width="${tableW}" height="${rowH}" fill="rgba(255,255,255,0.04)"/>`);
    }
    const ty = y + 24;
    parts.push(`<text x="${tableX + 8}" y="${ty}" font-family="${font}" font-size="12" font-weight="bold" fill="#4CAF50">${rank}</text>`);
    parts.push(`<text x="${tableX + colRank + 4}" y="${ty}" font-family="${font}" font-size="12" fill="#ffffff">${pName}</text>`);
    parts.push(`<text x="${tableX + colRank + colName + 4}" y="${ty}" font-family="${font}" font-size="12" fill="rgba(255,255,255,0.9)">${pid}</text>`);
    parts.push(`<text x="${tableX + colRank + colName + colPid + 4}" y="${ty}" font-family="${font}" font-size="12" fill="rgba(255,255,255,0.9)">${mem}</text>`);
    parts.push(`<text x="${tableX + tableW - 8}" y="${ty}" text-anchor="end" font-family="${font}" font-size="12" fill="rgba(255,255,255,0.9)">${cpu}</text>`);
    parts.push(`<line x1="${tableX}" y1="${y + rowH}" x2="${tableX + tableW}" y2="${y + rowH}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
  });

  if (!processes.length) {
    parts.push(
      `<text x="${tableX + tableW / 2}" y="${tableY + 100}" text-anchor="middle" font-family="${font}" font-size="14" fill="rgba(255,255,255,0.6)">暂无进程数据</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('\n')}</svg>`;
}

async function roundAvatar(sharp: Awaited<ReturnType<typeof getSharp>>, buf: Buffer, size: number): Promise<Buffer | null> {
  try {
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
    );
    return sharp(buf)
      .resize(size, size, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function fitCompositeLayer(
  sharp: Awaited<ReturnType<typeof getSharp>>,
  input: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(input)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();
}

export async function renderStatusWithSharp(
  options: StatusSharpRenderOptions,
  logger?: MkLoggerResolved,
): Promise<string | null> {
  const width = options.width ?? 1400;
  const height = options.height ?? 900;
  const pluginDir = String(options.pluginDir || '').trim();
  const pluginPath = String(options.pluginPath || '').trim();
  const dataPath = String(options.dataPath || '').trim();
  const bgLocalPath = String(options.bgLocalPath || '').trim();

  try {
    const sharp = await loadSharp();
    const bgBuf = await loadStatusBackground(
      String(options.backgroundImageUrl || ''),
      bgLocalPath,
      pluginDir,
      pluginPath,
      dataPath,
    );
    const composites: { input: Buffer; top?: number; left?: number }[] = [];

    if (bgBuf && bgBuf.length > 0) {
      const bgLayer = await sharp(bgBuf)
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .ensureAlpha()
        .png()
        .toBuffer();
      composites.push({ input: bgLayer, top: 0, left: 0 });
      const dimOverlay = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0.4 },
        },
      })
        .png()
        .toBuffer();
      composites.push({ input: dimOverlay, top: 0, left: 0 });
    } else {
      const fallback = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 102, g: 126, b: 234 },
        },
      })
        .png()
        .toBuffer();
      composites.push({ input: fallback, top: 0, left: 0 });
      logger?.warn?.('[Sharp渲染] 运行状态背景图不可用，已使用默认底色');
    }

    const overlaySvg = buildStatusOverlaySvg(width, height, options);
    const overlayLayer = await fitCompositeLayer(sharp, Buffer.from(overlaySvg), width, height);
    composites.push({ input: overlayLayer, top: 0, left: 0 });

    const avatarSize = 120;
    const avatarUrl = `https://q4.qlogo.cn/g?b=qq&nk=${options.qq || ''}&s=5`;
    try {
      const avatarBuf = await fetchUrlBuffer(avatarUrl, 10000);
      if (avatarBuf.length > 0) {
        const rounded = await roundAvatar(sharp, avatarBuf, avatarSize);
        if (rounded) {
          composites.push({ input: rounded, top: 40, left: 40 });
        }
      }
    } catch (_e) {
      /* 头像失败不影响整体 */
    }

    const out = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return out.toString('base64');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger?.error?.('[Sharp渲染] 运行状态渲染失败:', msg);
    return null;
  }
}
