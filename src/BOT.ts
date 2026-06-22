// @ts-nocheck
// ================== OneBot11 协议调用（消息段 array，不用 CQ 字符串） ==================
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// ================== 当前上下文（plugin_onmessage / plugin_onevent 入口注入） ==================
let 当前上下文 = null;

function bindBotCtx(ctx) {
  当前上下文 = ctx;
}

// ================== 媒体路径（外链 or 本地 → file://） ==================
function 媒体路径(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^file:\/\//i.test(s)) return s;
  try {
    const abs = path.isAbsolute(s) ? s : path.resolve(s);
    if (fs.existsSync(abs)) return pathToFileURL(abs).href;
  } catch (_e) {}
  return s;
}

// ================== 规范化 JSON 卡片数据 ==================
function 规范化Json(json数据) {
  if (json数据 == null || json数据 === "") return "";
  if (typeof json数据 === "string") {
    const s = json数据.trim();
    return s || "";
  }
  try {
    return JSON.stringify(json数据);
  } catch (_e) {
    return "";
  }
}

// ================== 构建 send_msg 参数 ==================
function 构建发送参数(event, message) {
  const params = {
    message_type: event.message_type,
    message,
  };
  if (event.message_type === "group") {
    const gid = Number(event.group_id);
    params.group_id = Number.isFinite(gid) ? gid : event.group_id;
  } else {
    const uid = Number(event.user_id);
    params.user_id = Number.isFinite(uid) ? uid : event.user_id;
  }
  return params;
}

async function 调用发送(params, options = {}) {
  const ctx = 当前上下文;
  if (!ctx?.actions) return null;
  const throwOnError = options.throwOnError === true;
  try {
    return await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    if (ctx.logger?.error) {
      ctx.logger.error("发送消息失败:", error);
    }
    if (throwOnError) throw error;
    return null;
  }
}

function isSendTimeoutError(error) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return msg.includes("API 超时") || msg.includes("ETIMEDOUT") || msg === "terminated";
}

function 必填文本(v) {
  const s = String(v ?? "").trim();
  return s || "";
}

// ================== 合并转发 · 消息段构建（纯 OB11 JSON，不用 CQ 字符串） ==================
function 段_文本(text) {
  return { type: "text", data: { text: String(text ?? "") } };
}

function 段_图片(file) {
  const f = String(file ?? "").trim();
  if (!f) return 段_文本("");
  const resolved = 媒体路径(f);
  return { type: "image", data: { file: resolved || f } };
}

function 段_视频(file) {
  const f = String(file ?? "").trim();
  if (!f) return 段_文本("");
  const resolved = 媒体路径(f);
  return { type: "video", data: { file: resolved || f } };
}

function 段_Json(json数据) {
  const jsonStr = 规范化Json(json数据);
  if (!jsonStr) return 段_文本("");
  return { type: "json", data: { data: jsonStr } };
}

/** 经典小黄脸表情（face ID 0–103） */
function 段_表情(id) {
  const idStr = String(id ?? "").trim();
  if (!idStr || !/^\d+$/.test(idStr)) return 段_文本("");
  return { type: "face", data: { id: idStr } };
}

/** 引用一条消息 */
function 段_引用(messageId) {
  const id = String(messageId ?? "").trim();
  if (!id) return null;
  return { type: "reply", data: { id } };
}

/** 艾特 QQ（qq 可为数字或 "all"） */
function 段_艾特(qq) {
  const q = String(qq ?? "").trim();
  if (!q) return null;
  return { type: "at", data: { qq: q } };
}

/** 语音消息（record 段，file 为 URL 或本地路径） */
function 段_语音(file) {
  const f = String(file ?? "").trim();
  if (!f) return 段_文本("");
  const resolved = 媒体路径(f);
  return { type: "record", data: { file: resolved || f } };
}

/** 规范化单发消息段（仅 text / image / face；另含 reply / at 供回复场景） */
function 规范化消息段(message) {
  if (!Array.isArray(message) || message.length === 0) return [];
  const out = [];
  for (const seg of message) {
    if (!seg || typeof seg !== "object") continue;
    const type = String(seg.type ?? "").toLowerCase();
    const data = seg.data && typeof seg.data === "object" ? seg.data : {};

    if (type === "text") {
      out.push({ type: "text", data: { text: String(data.text ?? "") } });
      continue;
    }
    if (type === "image") {
      const file = String(data.file ?? data.url ?? "").trim();
      if (file) out.push(段_图片(file));
      continue;
    }
    if (type === "face") {
      const face = 段_表情(data.id ?? data.face_id);
      if (face.type === "face") out.push(face);
      continue;
    }
    if (type === "reply") {
      const rep = 段_引用(data.id ?? data.message_id);
      if (rep) out.push(rep);
      continue;
    }
    if (type === "at") {
      const at = 段_艾特(data.qq);
      if (at) out.push(at);
      continue;
    }
    // 已是合法 OB11 段则原样保留（如调用方传入完整 data）
    if (type) out.push(seg);
  }
  return out.length ? out : [段_文本("")];
}

/** 合并转发节点：{ name, qq, content: OB11 段[], time? } */
function 合并节点(name, qq, content, extra = {}) {
  return { name, qq, content, ...extra };
}

/** 引用已有合并转发消息 ID */
function 合并引用(id, name, qq, extra = {}) {
  return { id: String(id), name, qq, ...extra };
}

/** 文本在前，图片在后（顺序与旧 buildForwardContent 一致） */
function 合并图文节点(name, qq, text, images, extra = {}) {
  const content = [];
  if (text != null && String(text) !== "") content.push(段_文本(text));
  if (Array.isArray(images)) {
    for (const img of images) content.push(段_图片(img));
  } else if (images) {
    content.push(段_图片(images));
  }
  if (!content.length) content.push(段_文本(""));
  return 合并节点(name, qq, content, extra);
}

/** 文本在前，视频在后 */
function 合并视文节点(name, qq, text, video, extra = {}) {
  const content = [];
  if (text != null && String(text) !== "") content.push(段_文本(text));
  if (video) content.push(段_视频(video));
  if (!content.length) content.push(段_文本(""));
  return 合并节点(name, qq, content, extra);
}

/** 仅图片（可多张） */
function 合并图片节点(name, qq, images, extra = {}) {
  const content = [];
  if (Array.isArray(images)) {
    for (const img of images) content.push(段_图片(img));
  } else if (images) {
    content.push(段_图片(images));
  }
  if (!content.length) content.push(段_文本(""));
  return 合并节点(name, qq, content, extra);
}

function 构建Ob11节点(node, defaultUin) {
  if (node?.id != null && String(node.id).trim() !== "") {
    return {
      type: "node",
      data: {
        id: String(node.id),
        name: node.name || "用户",
        uin: String(node.qq ?? defaultUin),
        ...(node.time != null ? { time: node.time } : {}),
      },
    };
  }

  const content =
    Array.isArray(node?.content) && node.content.length > 0
      ? node.content
      : [段_文本("")];

  const data = {
    name: node?.name || "用户",
    uin: String(node?.qq ?? defaultUin),
    content,
  };
  if (node?.time != null) data.time = node.time;
  return { type: "node", data };
}

/**
 * 嵌套合并转发：prefixContent 在前（如标题文本），其后为子节点列表。
 * children 为 { name, qq, content }[]，可递归嵌套。
 */
function 嵌套合并节点(name, qq, children, extra = {}, prefixContent = []) {
  const childNodes = (children || []).map((c) => 构建Ob11节点(c, qq ?? extra.qq));
  const content = [
    ...(Array.isArray(prefixContent) ? prefixContent : []),
    { type: "forward", data: { id: "0" } },
    ...childNodes,
  ];
  return 合并节点(name, qq, content, extra);
}

// ================== 单发消息（text / image / face 可组合，纯 OB11 JSON 段） ==================
// message: [{ type: "text", data: { text } }, { type: "image", data: { file } }, ...]
// extra.group_id：私聊时附带群号（临时会话）
async function 发消息(event, message, extra = {}) {
  const segments = 规范化消息段(message);
  if (!segments.length) return null;
  const params = 构建发送参数(event, segments);
  if (event.message_type === "private") {
    const gid = extra.group_id ?? event.group_id;
    if (gid != null && String(gid).trim() !== "") {
      const n = Number(gid);
      params.group_id = Number.isFinite(n) ? n : gid;
    }
  }
  return 调用发送(params);
}

// ================== 单发语音（OB11 record 段） ==================
// file: 音频 URL 或本地路径；extra.group_id：私聊临时会话
async function 发语音(event, file, extra = {}) {
  const seg = 段_语音(file);
  if (seg.type !== "record") return null;
  const params = 构建发送参数(event, [seg]);
  if (event.message_type === "private") {
    const gid = extra.group_id ?? event.group_id;
    if (gid != null && String(gid).trim() !== "") {
      const n = Number(gid);
      params.group_id = Number.isFinite(n) ? n : gid;
    }
  }
  return 调用发送(params);
}

// ================== 单发 JSON 卡片 ==================
async function 发卡片(event, json数据) {
  const jsonStr = 规范化Json(json数据);
  if (!jsonStr) return null;
  const params = 构建发送参数(event, [{ type: "json", data: { data: jsonStr } }]);
  return 调用发送(params);
}

// ================== 单发音乐卡片 ==================
async function 发音乐卡片(event, 歌名, 歌手, 封面, 跳转url, 音频url) {
  const title = 必填文本(歌名);
  const content = 必填文本(歌手);
  const image = 媒体路径(必填文本(封面)) || 必填文本(封面);
  const url = 必填文本(跳转url);
  const audio = 必填文本(音频url);
  if (!title || !content || !image || !url || !audio) return null;

  const data = {
    type: "custom",
    url,
    audio,
    title,
    content,
    image,
  };
  const params = 构建发送参数(event, [{ type: "music", data }]);
  return 调用发送(params);
}

// ================== 单发视频 ==================
async function 发视频(event, 封面, 视频, 名称) {
  const 视频地址 = String(视频 || "").trim();
  if (!视频地址) return null;

  const 解析视频 = 媒体路径(视频地址);
  const 解析封面 = 媒体路径(封面);
  const data = {
    file: 解析视频,
  };
  if (解析封面) data.thumb = 解析封面;
  if (名称) data.name = String(名称);

  const params = 构建发送参数(event, [{ type: "video", data }]);
  return 调用发送(params, { throwOnError: true });
}

// ================== 合并转发 ==================
// nodes: [{ name, qq, content: [...] }] 或 [{ id, name, qq }]
async function 发合并消息(event, nodes) {
  const ctx = 当前上下文;
  if (!ctx?.actions || !Array.isArray(nodes) || nodes.length === 0) return false;

  const defaultUin = event.user_id ?? event.self_id;
  const forwardData = nodes.map((n) => 构建Ob11节点(n, defaultUin));
  const isGroup = event.message_type === "group";
  const params = {
    message: forwardData,
    messages: forwardData,
    message_type: event.message_type,
    ...(isGroup
      ? { group_id: String(event.group_id) }
      : { user_id: String(event.user_id) }),
  };
  const action = isGroup ? "send_group_forward_msg" : "send_private_forward_msg";

  try {
    await ctx.actions.call(action, params, ctx.adapterName, ctx.pluginManager.config);
    return true;
  } catch (error) {
    try {
      await ctx.actions.call("send_forward_msg", params, ctx.adapterName, ctx.pluginManager.config);
      return true;
    } catch (error2) {
      if (ctx.logger?.error) {
        ctx.logger.error("发送合并消息失败:", error2 ?? error);
      }
      return false;
    }
  }
}

export {
  发视频,
  发语音,
  发卡片,
  发音乐卡片,
  发合并消息,
  发消息,
  bindBotCtx,
  isSendTimeoutError,
  段_文本,
  段_图片,
  段_视频,
  段_语音,
  段_Json,
  段_表情,
  段_引用,
  段_艾特,
  合并节点,
  嵌套合并节点,
  合并引用,
  合并图文节点,
  合并视文节点,
  合并图片节点,
};
