import fs from 'fs';
import path from 'path';
import { setDataPath } from './lib/function.mjs';
import { handleMessage } from './RC/handlers.mjs';

let logger = null;

const plugin_init = async (ctx) => {
  logger = ctx.logger;
  const dataPath = ctx.configPath ? path.dirname(ctx.configPath) : "./data";
  
  // 确保数据文件夹存在
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
  
  // 告诉库模块数据文件夹在哪里
  setDataPath(dataPath);
  
  logger.info("MK 插件已初始化");
};

const plugin_onmessage = async (ctx, event) => {
  if (event.post_type !== "message") {
    return;
  }

  const message = event.raw_message?.trim() || "";

  // 调用 RC 模块处理消息
  const reply = await handleMessage(message, event);
  
  if (reply) {
    await sendReply(event, reply, ctx);
  }
};

async function sendReply(event, content, ctx) {
  if (!ctx.actions || !content) return;

  const params = {
    message: content,
    message_type: event.message_type,
    ...event.message_type === "group" ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }
  };

  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
    logger?.info(`已回复: ${content}`);
  } catch (error) {
    logger?.error("发送消息失败:", error);
  }
}

export { plugin_init, plugin_onmessage };
