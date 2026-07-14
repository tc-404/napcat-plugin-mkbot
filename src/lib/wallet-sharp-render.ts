// ---------------------------------------------------------------------------
// Sharp 渲染：我的货币 / 我的信息卡片（独立美化 UI）
// ---------------------------------------------------------------------------

import https from 'https';
import http from 'http';
import type { MkLoggerResolved } from '../types';
import { loadSharp } from './sharp-loader';

export interface WalletSharpRenderOptions {
  title?: string;
  userName?: string;
  userId: string | number;
  time?: string;
  currentMoney: string;
  bankMoney: string;
  baitCount: string;
  signTotal: string;
  signStreak: string;
  width?: number;
  height?: number;
}

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

function valueFontSize(text: string, base = 34, min = 20): number {
  const len = String(text || '').length;
  if (len <= 8) return base;
  if (len <= 12) return 28;
  if (len <= 18) return 24;
  return min;
}

function fetchUrlBuffer(url: string, timeoutMs = 12000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'MKbot-WalletSharp/1.0' } },
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

function buildWalletSvg(width: number, height: number, opts: WalletSharpRenderOptions): string {
  const font = 'Microsoft YaHei, Noto Sans SC, sans-serif';
  const pad = 28;
  const cardX = pad;
  const cardY = pad;
  const cardW = width - pad * 2;
  const cardH = height - pad * 2;
  const accent = '#ff77b7';
  const title = escapeXml(opts.title || '我的货币');
  const userName = escapeXml(truncateText(opts.userName || '旅人', 14));
  const userId = escapeXml(String(opts.userId || ''));
  const time = escapeXml(opts.time || '');
  const currentMoney = escapeXml(opts.currentMoney || '0归笺');
  const bankMoney = escapeXml(opts.bankMoney || '0归笺');
  const baitCount = escapeXml(String(opts.baitCount ?? '0'));
  const signTotal = escapeXml(String(opts.signTotal ?? '0'));
  const signStreak = escapeXml(String(opts.signStreak ?? '0'));

  const parts: string[] = [];
  parts.push(`<defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffb6d8"/>
      <stop offset="26%" stop-color="#ffd1e8"/>
      <stop offset="100%" stop-color="#cfe5ff"/>
    </linearGradient>
    <linearGradient id="orangeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9800"/>
      <stop offset="100%" stop-color="#ff5722"/>
    </linearGradient>
    <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4fc3f7"/>
      <stop offset="100%" stop-color="#00b4d8"/>
    </linearGradient>
    <linearGradient id="pinkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff77b7"/>
      <stop offset="100%" stop-color="#ff5722"/>
    </linearGradient>
    <filter id="blobBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="42"/>
    </filter>
    <filter id="titleGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.95"/>
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#ff77b7" flood-opacity="0.7"/>
    </filter>
    <filter id="valGlowOrange" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffeb3b" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff9800" flood-opacity="0.85"/>
      <feDropShadow dx="0" dy="2" stdDeviation="10" flood-color="#ff5722" flood-opacity="0.45"/>
    </filter>
    <filter id="valGlowBlue" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#e1f5fe" flood-opacity="0.6"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#4fc3f7" flood-opacity="0.85"/>
      <feDropShadow dx="0" dy="2" stdDeviation="10" flood-color="#00b4d8" flood-opacity="0.45"/>
    </filter>
    <filter id="valGlowPink" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffe0f0" flood-opacity="0.6"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff77b7" flood-opacity="0.9"/>
      <feDropShadow dx="0" dy="2" stdDeviation="10" flood-color="#ff5722" flood-opacity="0.4"/>
    </filter>
  </defs>`);

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrad)"/>`);
  parts.push(`<circle cx="${width - 60}" cy="70" r="150" fill="#ffcc80" opacity="0.42" filter="url(#blobBlur)"/>`);
  parts.push(`<circle cx="90" cy="${height - 50}" r="130" fill="#90e0ef" opacity="0.38" filter="url(#blobBlur)"/>`);
  parts.push(`<circle cx="220" cy="${height * 0.45}" r="110" fill="#b3e5fc" opacity="0.32" filter="url(#blobBlur)"/>`);

  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="26" ry="26" fill="rgba(255,182,193,0.36)" stroke="rgba(255,182,193,0.55)" stroke-width="2"/>`,
  );

  const avatarX = cardX + 22;
  const avatarY = cardY + 22;
  const avatarSize = 86;
  parts.push(
    `<circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2 + 1.5}" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="3"/>`,
  );

  const infoX = avatarX + avatarSize + 18;
  parts.push(
    `<text x="${infoX}" y="${avatarY + 26}" font-family="${font}" font-size="13" font-weight="900" fill="${accent}" letter-spacing="1">time:${time}</text>`,
  );
  parts.push(
    `<text x="${infoX}" y="${avatarY + 58}" font-family="${font}" font-size="30" font-weight="900" fill="#ffffff" filter="url(#titleGlow)">${title}</text>`,
  );
  parts.push(
    `<text x="${infoX}" y="${avatarY + 82}" font-family="${font}" font-size="15" fill="rgba(255,255,255,0.88)">${userName} (${userId})</text>`,
  );

  const tileY = cardY + 128;
  const gap = 14;
  const tileW = (cardW - 44 - gap * 2) / 3;
  const tileH = 196;
  const tileX0 = cardX + 22;

  const tiles = [
    { label: '现有货币', value: currentMoney, grad: 'orangeGrad', glow: 'valGlowOrange' },
    { label: '银行储存', value: bankMoney, grad: 'blueGrad', glow: 'valGlowBlue' },
    { label: '诱饵数量', value: baitCount, grad: 'pinkGrad', glow: 'valGlowPink', unit: '个' },
  ];

  tiles.forEach((tile, i) => {
    const x = tileX0 + i * (tileW + gap);
    const displayValue = tile.unit ? `${tile.value}${tile.unit}` : tile.value;
    const valSize = valueFontSize(displayValue, 32, 20);
    parts.push(
      `<rect x="${x}" y="${tileY}" width="${tileW}" height="${tileH}" rx="18" ry="18" fill="rgba(90,20,60,0.10)" stroke="rgba(255,182,193,0.32)" stroke-width="2"/>`,
    );
    parts.push(
      `<circle cx="${x + 22}" cy="${tileY + 24}" r="5" fill="${accent}"/>`,
    );
    parts.push(
      `<text x="${x + 36}" y="${tileY + 28}" font-family="${font}" font-size="16" font-weight="900" fill="#ffffff">${escapeXml(tile.label)}</text>`,
    );
    parts.push(
      `<rect x="${x + 12}" y="${tileY + 44}" width="${tileW - 24}" height="${tileH - 56}" rx="16" ry="16" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x + 22}" y="${tileY + 128}" font-family="${font}" font-size="${valSize}" font-weight="900" fill="url(#${tile.grad})" filter="url(#${tile.glow})">${escapeXml(displayValue)}</text>`,
    );
  });

  const footY = tileY + tileH + 18;
  const footW = (cardW - 44 - gap) / 2;
  const footH = 74;
  const footItems = [
    { label: '累计签到', value: signTotal, unit: '天' },
    { label: '连续签到', value: signStreak, unit: '天' },
  ];
  footItems.forEach((item, i) => {
    const x = tileX0 + i * (footW + gap);
    parts.push(
      `<rect x="${x}" y="${footY}" width="${footW}" height="${footH}" rx="16" ry="16" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x + 16}" y="${footY + 26}" font-family="${font}" font-size="13" font-weight="600" fill="rgba(255,255,255,0.82)">${escapeXml(item.label)}</text>`,
    );
    parts.push(
      `<text x="${x + 16}" y="${footY + 54}" font-family="${font}" font-size="26" font-weight="900" fill="url(#orangeGrad)" filter="url(#valGlowOrange)">${escapeXml(item.value)}<tspan font-size="13" fill="rgba(255,255,255,0.72)" filter="none"> ${escapeXml(item.unit)}</tspan></text>`,
    );
  });

  parts.push(
    `<text x="${cardX + cardW / 2}" y="${cardY + cardH - 14}" text-anchor="middle" font-family="${font}" font-size="11" fill="rgba(255,255,255,0.35)" letter-spacing="2">MK-Bot · 娱乐经济数据</text>`,
  );

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

export async function renderWalletWithSharp(
  options: WalletSharpRenderOptions,
  logger?: MkLoggerResolved,
): Promise<string | null> {
  const width = options.width ?? 1080;
  const height = options.height ?? 720;

  try {
    const sharp = await loadSharp();
    const svg = buildWalletSvg(width, height, options);
    const uiLayer = await sharp(Buffer.from(svg)).png().toBuffer();
    const composites: { input: Buffer; top: number; left: number }[] = [{ input: uiLayer, top: 0, left: 0 }];

    const avatarUrl = `https://q4.qlogo.cn/g?b=qq&nk=${options.userId}&s=5`;
    try {
      const avatarBuf = await fetchUrlBuffer(avatarUrl, 10000);
      if (avatarBuf.length > 0) {
        const rounded = await roundAvatar(sharp, avatarBuf, 86);
        if (rounded) {
          composites.push({ input: rounded, top: 50, left: 50 });
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
        background: { r: 255, g: 182, b: 216, alpha: 1 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return out.toString('base64');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger?.error?.('[Sharp渲染] 我的货币渲染失败:', msg);
    return null;
  }
}
