// ---------------------------------------------------------------------------
// 抖音解析（移植 short_videos DouyinParser.php：视频/图集/实况）
// ---------------------------------------------------------------------------

import {
  cleanUrlTail,
  extractBalancedJsonFrom,
  fetchText,
  followRedirect,
} from './http-utils';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36';

export interface DyAuthor {
  name: string;
  id: string;
  avatar: string;
}

export interface DyLivePhoto {
  image: string;
  video: string;
}

export interface DyMusic {
  title: string;
  author: string;
  url: string;
  cover: string;
}

export interface DyMediaData {
  type: 'video' | 'image' | 'live' | 'unknown';
  title: string;
  desc: string;
  author: DyAuthor;
  cover: string;
  url: string | null;
  duration: number | null;
  video_backup: string[] | null;
  video_id?: string;
  images: string[];
  live_photo: DyLivePhoto[];
  music: DyMusic;
}

export interface DyApiResult {
  code: number;
  msg: string;
  data?: DyMediaData;
}

function output(code: number, msg: string, data: DyMediaData | Record<string, never> = {}): DyApiResult {
  return { code, msg, data: data as DyMediaData };
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function extractDouyinUrl(text: string): string {
  const shortMatch = text.match(/https?:\/\/v\.douyin\.com\/[\w-]+/i);
  if (shortMatch) return shortMatch[0].trim();
  const longMatch = text.match(/https?:\/\/(?:www\.)?douyin\.com\/[^\s]+/i);
  if (longMatch) return longMatch[0].trim().replace(/[^\w\-./?=&:#]+$/i, '');
  const anyMatch = text.match(/https?:\/\/[^\s]*douyin\.com[^\s]*/i);
  if (anyMatch) return anyMatch[0].trim().replace(/[^\w\-./?=&:#]+$/i, '');
  return text.trim();
}

function extractId(url: string): string | null {
  const patterns = [
    /\/share\/note\/(\d+)/,
    /\/share\/video\/(\d+)/,
    /\/share\/slides\/(\d+)/,
    /\/video\/(\d+)/,
    /\/note\/(\d+)/,
    /\/slides\/(\d+)/,
    /modal_id=(\d+)/,
    /[?&]item_ids=(\d+)/,
    /^(\d+)$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isNoteUrl(url: string): boolean {
  return /\/note\/|share\/note/i.test(url);
}

function isSlidesUrl(url: string): boolean {
  return /\/slides\/|share\/slides/i.test(url);
}

function buildShareFetchUrls(resolvedUrl: string, id: string): string[] {
  const urls: string[] = [];
  if (isNoteUrl(resolvedUrl)) {
    urls.push(`https://www.iesdouyin.com/share/note/${id}/`);
    urls.push(`https://www.douyin.com/note/${id}`);
  } else if (isSlidesUrl(resolvedUrl)) {
    urls.push(`https://www.iesdouyin.com/share/slides/${id}/`);
  }
  urls.push(`https://www.iesdouyin.com/share/video/${id}/`);
  urls.push(`https://www.douyin.com/video/${id}`);
  urls.push(`https://www.douyin.com/user/self?modal_id=${id}&showTab=like`);
  return [...new Set(urls)];
}

async function getRealUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': MOBILE_UA },
    });
    const location = res.headers.get('location');
    if (location) {
      const loc = location;
      if (extractId(loc)) return loc;
      return loc;
    }
  } catch {
    // fallback
  }
  return followRedirect(url, MOBILE_UA);
}

function isBlockedHtml(html: string): boolean {
  if (html.includes('waf-js') && html.length < 10000) return true;
  if (html.length < 3000) return true;
  return false;
}

async function requestPage(url: string, userAgent = MOBILE_UA): Promise<string | false> {
  try {
    const html = await fetchText(
      url,
      {
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: 'https://www.douyin.com/',
        },
      },
      userAgent,
    );
    if (isBlockedHtml(html)) return false;
    return html;
  } catch {
    return false;
  }
}

async function fetchDetailById(resolvedUrl: string, id: string): Promise<Record<string, unknown> | null> {
  const fetchUrls = buildShareFetchUrls(resolvedUrl, id);

  for (const pageUrl of fetchUrls) {
    const isIes = pageUrl.includes('iesdouyin.com');
    const uas = isIes ? [MOBILE_UA, USER_AGENT] : [USER_AGENT, MOBILE_UA];
    for (const ua of uas) {
      const html = await requestPage(pageUrl, ua);
      if (!html) continue;
      const detail = extractJsonFromHtml(html);
      if (detail) return detail;
    }
  }
  return null;
}

function extractJsonFromHtml(html: string): Record<string, unknown> | null {
  const renderStart = '<script id="RENDER_DATA" type="application/json">';
  const posStart = html.indexOf(renderStart);
  if (posStart >= 0) {
    const jsonStr = html.slice(posStart + renderStart.length);
    const posEnd = jsonStr.indexOf('</script>');
    if (posEnd >= 0) {
      try {
        const decoded = decodeURIComponent(jsonStr.slice(0, posEnd));
        const data = JSON.parse(decoded) as { app?: { videoDetail?: Record<string, unknown> } };
        if (data.app?.videoDetail) return data.app.videoDetail;
      } catch {
        // continue fallback
      }
    }
  }

  const routerJson = extractBalancedJsonFrom(html, 'window._ROUTER_DATA');
  if (routerJson) {
    try {
      const json = JSON.parse(routerJson) as { loaderData?: Record<string, unknown> };
      if (json.loaderData) {
        for (const key of Object.keys(json.loaderData)) {
          if (!key.includes('page')) continue;
          const page = json.loaderData[key] as {
            videoInfoRes?: { item_list?: Record<string, unknown>[] };
          };
          if (page?.videoInfoRes?.item_list?.[0]) {
            return page.videoInfoRes.item_list[0];
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function pickBestPlayUrl(candidates: string[]): string | null {
  if (!candidates.length) return null;
  let v3Link: string | null = null;
  let v26Link: string | null = null;
  for (const candidate of candidates) {
    if (candidate.includes('v3-web')) return candidate;
    if (candidate.includes('v26-web')) v26Link = candidate;
  }
  if (v26Link) return v26Link.replace(/:\/\/([^/]+)/, '://v26-luna.douyinvod.com');
  return candidates[0];
}

function extractLiveVideoUrl(videoInfo: Record<string, unknown>): string | null {
  let liveVideoUrl: string | null = null;

  const playAddr = videoInfo.playAddr as Array<{ src?: string }> | undefined;
  if (Array.isArray(playAddr)) {
    const candidates: string[] = [];
    for (const addr of playAddr) {
      if (addr.src) candidates.push(addr.src);
    }
    liveVideoUrl = pickBestPlayUrl(candidates);
    if (!liveVideoUrl && playAddr[1]?.src) liveVideoUrl = playAddr[1].src;
    if (!liveVideoUrl && playAddr[0]?.src) liveVideoUrl = playAddr[0].src;
  }

  const playAddrSnake = videoInfo.play_addr as { url_list?: string[] } | undefined;
  if (!liveVideoUrl && playAddrSnake?.url_list?.length) {
    liveVideoUrl = pickBestPlayUrl(playAddrSnake.url_list);
    if (!liveVideoUrl) {
      liveVideoUrl = playAddrSnake.url_list[1] ?? playAddrSnake.url_list[0] ?? null;
    }
  }

  if (!liveVideoUrl && typeof videoInfo.playApi === 'string') {
    liveVideoUrl = videoInfo.playApi;
  }

  return liveVideoUrl ? liveVideoUrl.replace(/playwm/g, 'play') : null;
}

function extractHighestQualityVideo(detail: Record<string, unknown>): { url: string | null; backup: string[] } {
  let url: string | null = null;
  const backup: string[] = [];
  const video = detail.video as Record<string, unknown> | undefined;

  const bitRateList = video?.bitRateList as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(bitRateList) && bitRateList.length) {
    const sorted = [...bitRateList].sort(
      (a, b) => (Number(b.bitRate) || 0) - (Number(a.bitRate) || 0),
    );

    for (const rateItem of sorted) {
      const candidates: string[] = [];
      const playAddr = rateItem.playAddr as Array<{ src?: string }> | undefined;
      if (Array.isArray(playAddr)) {
        for (const pa of playAddr) {
          if (pa.src) candidates.push(pa.src);
        }
      } else {
        const playAddrSnake = rateItem.play_addr as { url_list?: string[] } | undefined;
        if (playAddrSnake?.url_list) candidates.push(...playAddrSnake.url_list);
      }
      if (!candidates.length) continue;

      const currentBest = pickBestPlayUrl(candidates);
      if (!url && currentBest) url = currentBest;

      for (let candidate of candidates) {
        if (candidate.includes('v26-web')) {
          candidate = candidate.replace(/:\/\/([^/]+)/, '://v26-luna.douyinvod.com');
        }
        if (candidate !== url && !backup.includes(candidate)) backup.push(candidate);
      }

      if (url && backup.length) break;
    }
  }

  if (!url && video) {
    const uri = video.uri as string | undefined;
    const playApi = (video.playApi as string | undefined) ??
      ((video.play_addr as { url_list?: string[] })?.url_list?.[0]);
    if (playApi) {
      url = playApi.replace(/playwm/g, 'play');
    } else if (uri) {
      url = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=720p&line=0`;
    }

    const urlList = (video.play_addr as { url_list?: string[] })?.url_list ?? [];
    for (let i = 1; i < urlList.length; i++) {
      backup.push(urlList[i].replace(/playwm/g, 'play'));
    }
  }

  if (url) url = url.replace(/playwm/g, 'play');
  return { url, backup };
}

function extractCover(detail: Record<string, unknown>): string {
  const video = detail.video as Record<string, unknown> | undefined;
  let cover = '';

  const originCover = video?.originCover as { urlList?: string[] } | undefined;
  const originCoverSnake = video?.origin_cover as { url_list?: string[] } | undefined;
  if (originCover?.urlList?.[0]) cover = originCover.urlList[0];
  else if (originCoverSnake?.url_list?.[0]) cover = originCoverSnake.url_list[0];
  else if (typeof video?.originCover === 'string') cover = video.originCover;
  else if (Array.isArray(video?.originCoverUrlList) && video.originCoverUrlList[0]) {
    cover = String(video.originCoverUrlList[0]);
  }

  if (!cover && video) {
    const coverObj = video.cover as { urlList?: string[]; url_list?: string[] } | string | undefined;
    if (typeof coverObj === 'string') cover = coverObj;
    else cover = coverObj?.urlList?.[0] ?? coverObj?.url_list?.[0] ?? '';
  }

  const detailCover = detail.cover as { url_list?: string[] } | undefined;
  if (!cover && detailCover?.url_list?.[0]) cover = detailCover.url_list[0];

  if (!cover && video) {
    const dynamicCover = video.dynamicCover as { urlList?: string[] } | undefined;
    const dynamicCoverSnake = video.dynamic_cover as { url_list?: string[] } | undefined;
    cover = dynamicCover?.urlList?.[0] ?? dynamicCoverSnake?.url_list?.[0] ?? '';
  }

  return cover;
}

function formatData(detail: Record<string, unknown>): DyApiResult {
  const authorInfo = detail.authorInfo as Record<string, unknown> | undefined;
  const author = detail.author as Record<string, unknown> | undefined;
  const music = detail.music as Record<string, unknown> | undefined;
  const video = detail.video as Record<string, unknown> | undefined;

  const result: DyMediaData = {
    type: 'unknown',
    title: (detail.desc as string) ?? '',
    desc: (detail.desc as string) ?? '',
    author: {
      name:
        (authorInfo?.nickname as string) ??
        (author?.nickname as string) ??
        '',
      id: String(authorInfo?.uid ?? author?.uid ?? ''),
      avatar:
        (authorInfo?.avatarUri as string) ??
        ((author?.avatar_thumb as { url_list?: string[] })?.url_list?.[0] ?? ''),
    },
    cover: extractCover(detail),
    url: null,
    duration: (video?.duration as number | null) ?? null,
    video_backup: null,
    images: [],
    live_photo: [],
    music: {
      title: (music?.musicName as string) ?? (music?.title as string) ?? '',
      author: (music?.ownerNickname as string) ?? (music?.author as string) ?? '',
      url:
        (music?.playUrl as { uri?: string })?.uri ??
        (music?.play_url as { uri?: string })?.uri ??
        '',
      cover:
        (music?.coverThumb as { urlList?: string[] })?.urlList?.[0] ??
        (music?.cover_thumb as { url_list?: string[] })?.url_list?.[0] ??
        '',
    },
  };

  const images = detail.images as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(images) && images.length) {
    result.type = 'image';
    for (const img of images) {
      const imgUrl =
        (img.urlList as string[] | undefined)?.[0] ??
        (img.url_list as string[] | undefined)?.[0] ??
        '';
      if (imgUrl) result.images.push(imgUrl);

      const videoInfo = (img.video as Record<string, unknown>) ?? {};
      const liveVideoUrl = extractLiveVideoUrl(videoInfo);
      if (liveVideoUrl) {
        result.live_photo.push({ image: imgUrl, video: liveVideoUrl });
      }
    }
    if (result.live_photo.length) result.type = 'live';
    if (!result.cover && result.images.length) result.cover = result.images[0];
    if (!result.cover && result.live_photo.length) result.cover = result.live_photo[0].image;
  } else {
    result.type = 'video';
    const videoInfo = extractHighestQualityVideo(detail);
    result.url = videoInfo.url;
    result.video_backup = videoInfo.backup.length ? videoInfo.backup : null;
    result.video_id = (video?.uri as string) ?? '';
  }

  return output(200, '解析成功', result);
}

/**
 * 解析抖音链接（视频 / 图集 / 实况）
 */
export async function parse(urlInput: string): Promise<DyApiResult> {
  let url = cleanUrlTail(stripTags(extractDouyinUrl(urlInput)));
  if (!url) return output(400, '请输入抖音链接');

  try {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return output(400, '链接格式错误');
    }

    if (host === 'v.douyin.com' || !url.includes('douyin.com') || !extractId(url)) {
      url = await getRealUrl(url);
    }

    const id = extractId(url);
    if (!id) {
      return output(400, `链接格式错误，无法提取ID。处理后的链接: ${url}`);
    }

    const detail = await fetchDetailById(url, id);

    if (!detail) {
      return output(404, '解析失败，未找到有效内容（可能触发抖音风控，请稍后重试）');
    }

    return formatData(detail);
  } catch (e) {
    return output(500, e instanceof Error ? e.message : '解析失败');
  }
}

export default { parse };
