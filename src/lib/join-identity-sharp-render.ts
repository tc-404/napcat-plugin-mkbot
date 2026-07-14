// ---------------------------------------------------------------------------
// Sharp 渲染：入群身份卡片（MK 粉蓝玻璃主题 · 居中档案卡布局）
// ---------------------------------------------------------------------------

import https from 'https';
import http from 'http';
import type { MkLoggerResolved } from '../types';
import { loadSharp } from './sharp-loader';

export interface JoinIdentitySharpRenderOptions {
  qq: string;
  name: string;
  sex: string;
  birthday: string;
  age: string;
  qqLevel: string;
  regTime: string;
  joinTime: string;
  width?: number;
  height?: number;
}

export interface JoinIdentityLayout {
  avatarSize: number;
  avatarLeft: number;
  avatarTop: number;
}

/** 各字段独立高亮配色 */
type HighlightKind = 'name' | 'sex' | 'age' | 'birth' | 'level' | false;

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

function highlightTextAttr(kind: Exclude<HighlightKind, false>, size = 24): string {
  const map: Record<Exclude<HighlightKind, false>, { fill: string; filter: string }> = {
    name: { fill: 'url(#nameGrad)', filter: 'url(#valGlowName)' },
    sex: { fill: 'url(#sexGrad)', filter: 'url(#valGlowSex)' },
    age: { fill: 'url(#ageGrad)', filter: 'url(#valGlowAge)' },
    birth: { fill: 'url(#birthGrad)', filter: 'url(#valGlowBirth)' },
    level: { fill: 'url(#levelGrad)', filter: 'url(#valGlowLevel)' },
  };
  const s = map[kind];
  return `font-size="${size}" font-weight="900" fill="${s.fill}" filter="${s.filter}"`;
}

function fetchUrlBuffer(url: string, timeoutMs = 12000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'MKbot-JoinIdentitySharp/1.0' } },
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

function calcJoinIdentityLayout(width: number, height: number): JoinIdentityLayout {
  const pad = 40;
  const headerH = 88;
  const avatarSize = 196;
  const avatarCenterY = pad + headerH + 36 + avatarSize / 2;
  return {
    avatarSize,
    avatarLeft: Math.round(width / 2 - avatarSize / 2),
    avatarTop: Math.round(avatarCenterY - avatarSize / 2),
  };
}

function buildJoinIdentitySvg(
  width: number,
  height: number,
  opts: JoinIdentitySharpRenderOptions,
  layout: JoinIdentityLayout,
): string {
  const font = 'Microsoft YaHei, Noto Sans SC, sans-serif';
  const pad = 40;
  const cardX = pad;
  const cardY = pad;
  const cardW = width - pad * 2;
  const cardH = height - pad * 2;
  const accent = '#ff77b7';
  const cx = width / 2;

  const qq = escapeXml(String(opts.qq || ''));
  const name = escapeXml(truncateText(opts.name || '新成员', 14));
  const sex = escapeXml(String(opts.sex || '未知'));
  const birthday = escapeXml(String(opts.birthday || '-'));
  const age = escapeXml(String(opts.age || '0'));
  const qqLevel = escapeXml(String(opts.qqLevel || '0'));
  const regTime = escapeXml(String(opts.regTime || '-'));
  const joinTime = escapeXml(String(opts.joinTime || '-'));

  const avatarCx = layout.avatarLeft + layout.avatarSize / 2;
  const avatarCy = layout.avatarTop + layout.avatarSize / 2;
  const avatarR = layout.avatarSize / 2;

  const nameY = layout.avatarTop + layout.avatarSize + 44;
  const qqY = nameY + 34;
  const badgeY = qqY + 36;
  const gridY = badgeY + 40;

  const gridPad = 36;
  const gridW = cardW - gridPad * 2;
  const colGap = 16;
  const rowGap = 16;
  const colW = (gridW - colGap * 3) / 4;
  const rowH = 108;
  const wideW = (gridW - colGap) / 2;

  const parts: string[] = [];
  parts.push(`<defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffb6d8"/>
      <stop offset="26%" stop-color="#ffd1e8"/>
      <stop offset="100%" stop-color="#cfe5ff"/>
    </linearGradient>
    <linearGradient id="nameGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ffe4f3"/>
    </linearGradient>
    <linearGradient id="sexGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff77b7"/>
      <stop offset="100%" stop-color="#ff4081"/>
    </linearGradient>
    <linearGradient id="ageGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4fc3f7"/>
      <stop offset="100%" stop-color="#00b4d8"/>
    </linearGradient>
    <linearGradient id="birthGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ce93d8"/>
      <stop offset="100%" stop-color="#9c27b0"/>
    </linearGradient>
    <linearGradient id="levelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9800"/>
      <stop offset="100%" stop-color="#ff5722"/>
    </linearGradient>
    <filter id="blobBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="42"/>
    </filter>
    <filter id="titleGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.95"/>
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#ff77b7" flood-opacity="0.7"/>
    </filter>
    <filter id="valGlowName" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffffff" flood-opacity="0.8"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff9ec8" flood-opacity="0.75"/>
    </filter>
    <filter id="valGlowSex" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffc1e3" flood-opacity="0.65"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff4081" flood-opacity="0.9"/>
    </filter>
    <filter id="valGlowAge" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#b3e5fc" flood-opacity="0.65"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#00b4d8" flood-opacity="0.9"/>
    </filter>
    <filter id="valGlowBirth" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#e1bee7" flood-opacity="0.65"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#9c27b0" flood-opacity="0.9"/>
    </filter>
    <filter id="valGlowLevel" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffeb3b" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff9800" flood-opacity="0.85"/>
    </filter>
  </defs>`);

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrad)"/>`);
  parts.push(`<circle cx="${width - 90}" cy="100" r="140" fill="#ffcc80" opacity="0.38" filter="url(#blobBlur)"/>`);
  parts.push(`<circle cx="110" cy="${height - 70}" r="120" fill="#90e0ef" opacity="0.34" filter="url(#blobBlur)"/>`);

  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="32" ry="32" fill="rgba(255,182,193,0.32)" stroke="rgba(255,182,193,0.55)" stroke-width="2.5"/>`,
  );

  const headerY = cardY + 36;
  parts.push(
    `<text x="${cardX + gridPad}" y="${headerY}" font-family="${font}" font-size="30" font-weight="900" fill="#ffffff" filter="url(#titleGlow)">入群身份</text>`,
  );
  parts.push(
    `<text x="${cardX + gridPad}" y="${headerY + 26}" font-family="${font}" font-size="13" fill="rgba(255,255,255,0.75)" letter-spacing="1.5">WELCOME CARD</text>`,
  );
  parts.push(
    `<text x="${cardX + cardW - gridPad}" y="${headerY}" text-anchor="end" font-family="${font}" font-size="13" fill="rgba(255,255,255,0.82)">${joinTime}</text>`,
  );
  parts.push(
    `<text x="${cardX + cardW - gridPad}" y="${headerY + 22}" text-anchor="end" font-family="${font}" font-size="11" fill="rgba(255,255,255,0.5)">加群时间</text>`,
  );

  parts.push(
    `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR + 6}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="3"/>`,
  );
  parts.push(
    `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="rgba(255,255,255,0.1)" stroke="${accent}" stroke-width="3.5"/>`,
  );

  parts.push(
    `<text x="${cx}" y="${nameY}" text-anchor="middle" font-family="${font}" ${highlightTextAttr('name', 34)}>${name}</text>`,
  );
  parts.push(
    `<text x="${cx}" y="${qqY}" text-anchor="middle" font-family="${font}" font-size="16" fill="rgba(255,255,255,0.88)">QQ · ${qq}</text>`,
  );

  const badges: { text: string; x: number; kind: Exclude<HighlightKind, false | 'name' | 'birth'> }[] = [
    { text: sex, x: cx - 130, kind: 'sex' },
    { text: `${age}岁`, x: cx, kind: 'age' },
    { text: `Lv.${qqLevel}`, x: cx + 130, kind: 'level' },
  ];
  badges.forEach((b) => {
    const bw = 108;
    const bh = 30;
    const bx = b.x - bw / 2;
    const by = badgeY - 22;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="15" fill="rgba(255,255,255,0.12)" stroke="rgba(255,182,193,0.35)" stroke-width="1.5"/>`,
    );
    parts.push(
      `<text x="${b.x}" y="${badgeY}" text-anchor="middle" font-family="${font}" ${highlightTextAttr(b.kind, 14)}>${escapeXml(b.text)}</text>`,
    );
  });

  const drawTile = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    highlight: HighlightKind = false,
  ) => {
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,182,193,0.3)" stroke-width="1.5"/>`,
    );
    parts.push(
      `<text x="${x + 18}" y="${y + 28}" font-family="${font}" font-size="12" font-weight="600" fill="rgba(255,255,255,0.65)">${escapeXml(label)}</text>`,
    );
    if (highlight) {
      parts.push(
        `<text x="${x + 18}" y="${y + 72}" font-family="${font}" ${highlightTextAttr(highlight, 24)}>${escapeXml(value)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${x + 18}" y="${y + 68}" font-family="${font}" font-size="20" font-weight="700" fill="#ffffff">${escapeXml(value)}</text>`,
      );
    }
  };

  const gx = cardX + gridPad;
  const tiles: { label: string; value: string; highlight: HighlightKind }[] = [
    { label: '性别', value: sex, highlight: 'sex' },
    { label: '年龄', value: `${age}岁`, highlight: 'age' },
    { label: 'QQ等级', value: `${qqLevel}级`, highlight: 'level' },
    { label: '生日', value: birthday, highlight: 'birth' },
  ];
  tiles.forEach((tile, i) => {
    const x = gx + i * (colW + colGap);
    drawTile(x, gridY, colW, rowH, tile.label, tile.value, tile.highlight);
  });

  const row2Y = gridY + rowH + rowGap;
  drawTile(gx, row2Y, wideW, rowH, '注册时间', regTime);
  drawTile(gx + wideW + colGap, row2Y, wideW, rowH, '加群时间', joinTime, false);

  parts.push(
    `<text x="${cx}" y="${cardY + cardH - 18}" text-anchor="middle" font-family="${font}" font-size="11" fill="rgba(255,255,255,0.35)" letter-spacing="2">MK-Bot · 入群欢迎</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('\n')}</svg>`;
}

async function roundAvatar(
  sharp: Awaited<ReturnType<typeof getSharp>>,
  buf: Buffer,
  size: number,
): Promise<Buffer | null> {
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

export async function renderJoinIdentityWithSharp(
  options: JoinIdentitySharpRenderOptions,
  logger?: MkLoggerResolved,
): Promise<string | null> {
  const width = options.width ?? 1400;
  const height = options.height ?? 850;
  const layout = calcJoinIdentityLayout(width, height);

  try {
    const sharp = await loadSharp();
    const svg = buildJoinIdentitySvg(width, height, options, layout);
    const uiLayer = await sharp(Buffer.from(svg)).png().toBuffer();
    const composites: { input: Buffer; top: number; left: number }[] = [{ input: uiLayer, top: 0, left: 0 }];

    const avatarUrl = `https://q4.qlogo.cn/g?b=qq&nk=${options.qq || ''}&s=5`;
    try {
      const avatarBuf = await fetchUrlBuffer(avatarUrl, 10000);
      if (avatarBuf.length > 0) {
        const rounded = await roundAvatar(sharp, avatarBuf, layout.avatarSize);
        if (rounded) {
          composites.push({ input: rounded, top: layout.avatarTop, left: layout.avatarLeft });
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
    logger?.error?.('[Sharp渲染] 入群身份渲染失败:', msg);
    return null;
  }
}
