import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ================== 全局变量 ==================
let logger = null;
let plugin_config_ui = [];
let dataPath = "";

function setDataPath(dir) {
  dataPath = dir;
}

function getDataPath() {
  return dataPath;
}

function readA(filename) {
  const filePath = path.join(dataPath, filename);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch (error) {
    console.error(`[Function] 读取文件 ${filename} 失败:`, error);
  }
  return "";
}

function readB(filename, key, defaultValue = "") {
  const filePath = path.join(dataPath, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      if (key in data && data[key] !== null && data[key] !== undefined) {
        return data[key];
      }
    }
  } catch (error) {
    console.error(`[Function] 读取文件 ${filename} 失败:`, error);
  }
  return defaultValue;
}

function writeA(filename, content) {
  const filePath = path.join(dataPath, filename);
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`[Function] 写入文件 ${filename} 失败:`, error);
    return false;
  }
}

function writeB(filename, key, value) {
  const filePath = path.join(dataPath, filename);
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data = {};
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        data = JSON.parse(content);
      } catch {
        data = {};
      }
    }
    data[key] = value;
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`[Function] 写入文件 ${filename} 失败:`, error);
    return false;
  }
}

function deleteKey(filename, key) {
  const filePath = path.join(dataPath, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      delete data[key];
      const newContent = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, newContent, "utf-8");
      return true;
    }
  } catch (error) {
    console.error(`[Function] 删除键失败:`, error);
  }
  return false;
}

function hasKey(filename, key) {
  const filePath = path.join(dataPath, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      return key in data;
    }
  } catch (error) {
    console.error(`[Function] 检查键失败:`, error);
  }
  return false;
}

function getKeys(filename) {
  const filePath = path.join(dataPath, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      return Object.keys(data);
    }
  } catch (error) {
    console.error(`[Function] 获取键失败:`, error);
  }
  return [];
}

function clear(filename) {
  return writeA(filename, "{}");
}

// 格式化字节为 GB/TB
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

// ================== 工具函数 - 系统信息 ==================
function getSystemInfo() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercent = ((usedMemory / totalMemory) * 100).toFixed(2);
  
  // 获取 CPU 使用率百分比（系统命令方式）
  let cpuUsagePercent = 0;
  try {
    if (os.platform() === 'win32') {
      // Windows 系统命令获取 CPU 使用率
      const output = execSync('wmic os get totalvisiblememorybytes,freephysicalmemory /format:list', { encoding: 'utf-8' });
      // 使用 Get-Counter 获取 CPU 使用率（更准确）
      try {
        const cpuOutput = execSync('powershell -Command "Get-Counter -Counter \'\\\\Processor(_Total)\\\\% Processor Time\' -SampleInterval 1 -MaxSamples 1 | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue"', { encoding: 'utf-8' });
        cpuUsagePercent = parseFloat(cpuOutput.trim()).toFixed(2);
      } catch (e) {
        // 备用方案：使用 wmic
        const wmiOutput = execSync('wmic cpu get loadpercentage /format:list', { encoding: 'utf-8' });
        const match = wmiOutput.match(/LoadPercentage=(\d+)/);
        if (match) {
          cpuUsagePercent = parseFloat(match[1]).toFixed(2);
        }
      }
    } else {
      // Linux/macOS 系统命令获取 CPU 使用率
      const output = execSync('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\' | cut -d\'%\' -f1', { encoding: 'utf-8' });
      cpuUsagePercent = parseFloat(output.trim()).toFixed(2);
    }
  } catch (error) {
    console.error('获取 CPU 使用率失败:', error);
    cpuUsagePercent = 0;
  }
  
  // 获取磁盘空间
  let diskInfo = {
    total: 0,
    free: 0,
    used: 0,
    usagePercent: 0
  };
  
  try {
    if (os.platform() === 'win32') {
      // Windows 磁盘信息
      const output = execSync('wmic logicaldisk get size,freespace /format:list', { encoding: 'utf-8' });
      const lines = output.split('\n').filter(line => line.trim());
      let totalSize = 0, freeSize = 0;
      
      for (const line of lines) {
        if (line.includes('FreeSpace=')) {
          freeSize += parseInt(line.split('=')[1]) || 0;
        }
        if (line.includes('Size=')) {
          totalSize += parseInt(line.split('=')[1]) || 0;
        }
      }
      
      if (totalSize > 0) {
        diskInfo.total = totalSize;
        diskInfo.free = freeSize;
        diskInfo.used = totalSize - freeSize;
        diskInfo.usagePercent = ((diskInfo.used / totalSize) * 100).toFixed(2);
      }
    } else {
      // Linux/macOS 磁盘信息
      const output = execSync('df -B1 / | tail -1', { encoding: 'utf-8' });
      const parts = output.trim().split(/\s+/);
      
      if (parts.length >= 4) {
        diskInfo.total = parseInt(parts[1]) || 0;
        diskInfo.used = parseInt(parts[2]) || 0;
        diskInfo.free = parseInt(parts[3]) || 0;
        diskInfo.usagePercent = ((diskInfo.used / diskInfo.total) * 100).toFixed(2);
      }
    }
  } catch (error) {
    console.error('获取磁盘信息失败:', error);
  }
  
  return {
    platform: os.platform(),
    type: os.type(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    cpuUsagePercent: cpuUsagePercent,
    totalMemory: totalMemory,
    freeMemory: freeMemory,
    usedMemory: usedMemory,
    memoryUsagePercent: memoryUsagePercent,
    systemUptime: os.uptime(),
    processUptime: process.uptime(),
    nodeVersion: process.version,
    disk: diskInfo
  };
}

// 获取进程列表（按内存使用率降序排列）
function getProcessList() {
  try {
    let processes = [];
    
    if (os.platform() === 'win32') {
      // Windows 进程列表
      const output = execSync('tasklist /v /fo csv', { encoding: 'utf-8' });
      const lines = output.split('\n').slice(1).filter(line => line.trim());
      
      for (const line of lines) {
        const parts = line.split(',').map(p => p.replace(/"/g, '').trim());
        if (parts.length >= 6) {
          const memoryStr = parts[4].replace(/,/g, '').replace(' K', '');
          const memory = parseInt(memoryStr) * 1024 || 0; // 转换为字节
          
          processes.push({
            pid: parts[1] || 'N/A',
            name: parts[0] || 'Unknown',
            memory: memory,
            memoryMB: (memory / 1024 / 1024).toFixed(2)
          });
        }
      }
    } else {
      // Linux/macOS 进程列表
      const output = execSync('ps aux', { encoding: 'utf-8' });
      const lines = output.split('\n').slice(1).filter(line => line.trim());
      
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          const memoryKB = parseInt(parts[5]) || 0; // RSS 内存（单位：KB）
          const memoryBytes = memoryKB * 1024; // 转换为字节
          
          processes.push({
            pid: parts[1] || 'N/A',
            name: parts[10] || 'Unknown',
            memory: memoryBytes,
            memoryMB: (memoryKB / 1024).toFixed(2),
            cpuPercent: parts[2] || '0'
          });
        }
      }
    }
    
    // 按内存使用率降序排列，只返回前 20 个
    return processes
      .sort((a, b) => b.memory - a.memory)
      .slice(0, 20);
  } catch (error) {
    console.error('获取进程列表失败:', error);
    return [];
  }
}

// ================== 工具函数 - 时间和随机 ==================
function timeA(format, timestamp) {
  const ts = timestamp ? timestamp : Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace(/y/g, year)
    .replace(/m/g, month)
    .replace(/d/g, day)
    .replace(/H/g, hours)
    .replace(/i/g, minutes)
    .replace(/s/g, seconds);
}

function timeB(format, timestamp) {
  let remaining = timestamp;
  
  const hasYear = format.includes('y');
  const hasMonth = format.includes('m');
  const hasDay = format.includes('d');
  const hasHour = format.includes('H');
  const hasMinute = format.includes('i');
  const hasSecond = format.includes('s');
  
  let years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0;
  
  if (hasYear) {
    years = Math.floor(remaining / 31536000);
    remaining %= 31536000;
  }
  
  if (hasMonth) {
    months = Math.floor(remaining / 2678400);
    remaining %= 2678400;
  }
  
  if (hasDay) {
    days = Math.floor(remaining / 86400);
    remaining %= 86400;
  }
  
  if (hasHour) {
    hours = Math.floor(remaining / 3600);
    remaining %= 3600;
  }
  
  if (hasMinute) {
    minutes = Math.floor(remaining / 60);
    remaining %= 60;
  }
  
  if (hasSecond) {
    seconds = remaining;
  }
  
  const needsZeroPad = (value) => String(value).padStart(2, '0');
  
  let result = format;
  
  result = result.replace(/y+/g, (match) => {
    return match.length === 1 ? years : needsZeroPad(years);
  });
  
  result = result.replace(/m+/g, (match) => {
    return match.length === 1 ? months : needsZeroPad(months);
  });
  
  result = result.replace(/d+/g, (match) => {
    return match.length === 1 ? days : needsZeroPad(days);
  });
  
  result = result.replace(/H+/g, (match) => {
    return match.length === 1 ? hours : needsZeroPad(hours);
  });
  
  result = result.replace(/i+/g, (match) => {
    return match.length === 1 ? minutes : needsZeroPad(minutes);
  });
  
  result = result.replace(/s+/g, (match) => {
    return match.length === 1 ? seconds : needsZeroPad(seconds);
  });
  
  return result;
}

function rand(min, max) {
  if (typeof min === 'number' && typeof max === 'number') {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  if (typeof min === 'string' && typeof max === 'string') {
    const minChar = min.toLowerCase();
    const maxChar = max.toLowerCase();
    
    if (minChar === min && maxChar === max) {
      const minCode = min.charCodeAt(0);
      const maxCode = max.charCodeAt(0);
      const randomCode = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
      return String.fromCharCode(randomCode);
    } else if (minChar === min && maxChar !== max) {
      const allLetters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return allLetters[Math.floor(Math.random() * allLetters.length)];
    } else if (minChar !== min && maxChar === max) {
      const allLetters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return allLetters[Math.floor(Math.random() * allLetters.length)];
    } else {
      const minCode = min.charCodeAt(0);
      const maxCode = max.charCodeAt(0);
      const randomCode = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
      return String.fromCharCode(randomCode);
    }
  }
  
  return null;
}

function moneyA(number) {
    let AC比例 = 100000;
    let BC比例 = 1000;
    const erci = Math.ceil(number);
    let RC_moneyA = "";
    if(erci != 0){
        let 利润_换算_玉令 = Math.floor(number / AC比例);
        let 利润_换算_玉笺 = Math.floor((number % AC比例) / BC比例);
        let 利润_换算_归笺 = Math.floor(number % BC比例);
        if(利润_换算_玉令 != 0){
            RC_moneyA += `${利润_换算_玉令}玉令`;
        }
        if(利润_换算_玉笺 != 0){
            RC_moneyA += `${利润_换算_玉笺}玉笺`;
        }
        RC_moneyA += `${利润_换算_归笺}归笺`;
    }else{
        RC_moneyA += `${erci}归笺`;
    }
    return RC_moneyA;
}

async function downloadFile(url, savePath) {
  try {
    const fullPath = path.join(dataPath, savePath);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Function] 下载失败: HTTP ${res.status}`);
      return false;
    }
    
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(fullPath, Buffer.from(buffer));
    
    return true;
  } catch (error) {
    console.error(`[Function] 下载文件失败:`, error);
    return false;
  }
}

async function puppeteer(html, data = null) {
  try {
    const api = "http://localhost:6099/plugin/napcat-plugin-puppeteer/api/screenshot";
    
    const json = {
      file: html,
      data: data?.data || {},
      setViewport: {
        width: data?.width || 800,
        height: data?.height || 600
      }
    };
    
    const response = await fetch(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(json)
    });
    
    if (!response.ok) {
      console.error(`[Function] Puppeteer 渲染失败: HTTP ${response.status}`);
      return null;
    }
    
    const result = await response.json();
    
    if (result.code === 0 && result.data) {
      return result.data;
    } else {
      console.error(`[Function] Puppeteer 渲染失败:`, result.message || "未知错误");
      return null;
    }
  } catch (error) {
    console.error(`[Function] 调用 Puppeteer 服务失败:`, error);
    return null;
  }
}


// ================== 工具函数 - Bot API ==================
async function sendReply(event, content, ctx) {
  if (!ctx.actions || !content) return;

  const params = {
    message: content,
    message_type: event.message_type,
    ...event.message_type === "group" ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }
  };

  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    console.error("发送消息失败:", error);
  }
}

async function sendForward(event, messages, ctx) {
  if (!ctx.actions || !Array.isArray(messages)) return;

  const forwardData = messages.map((msg) => ({
    type: "node",
    data: {
      name: msg.name || "用户",
      uin: msg.qq || event.user_id,
      content: msg.text || ""
    }
  }));

  const params = {
    message: forwardData,
    message_type: event.message_type,
    ...event.message_type === "group" ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }
  };

  try {
    await ctx.actions.call("send_msg", params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    console.error("发送合并消息失败:", error);
  }
}

function giveAT(message) {
  if (!Array.isArray(message)) {
    return [];
  }
  
  return message
    .filter(s => s.type === "at" && s.data?.qq && s.data.qq !== "all")
    .map(s => s.data.qq);
}

function giveImages(message) {
  if (!Array.isArray(message)) {
    return [];
  }
  
  return message
    .filter(s => s.type === "image" && s.data?.url)
    .map(s => s.data.url);
}

function giveText(message) {
  if (!Array.isArray(message)) {
    return "";
  }
  
  return message
    .filter(s => s.type === "text")
    .map(s => s.data?.text || "")
    .join("");
}

async function BOTAPI(ctx, action, params) {
  try {
    const result = await ctx.actions.call(action, params, ctx.adapterName, ctx.pluginManager.config);
    return result;
  } catch (error) {
    if (typeof error === "object" && error.message && error.message.includes("No data returned")) {
      return { status: "ok", retcode: 0, data: null };
    }
    throw error;
  }
}

// ================== 授权系统 ==================
let globalStatus = {
  RC_sq: "未授权"
};

async function checkAuthStatus(event) {
  let dir_wj_time = "";
  
  if (event.message_type == "group") {
    dir_wj_time = "筱筱吖/授权系统/授权信息/" + event.group_id + ".json";
  } else if (event.message_type != "group") {
    dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
  }
  
  const xz_time = Math.floor(Date.now() / 1000);
  const wj_time = readB(dir_wj_time, "授权时间", 0);
  const wj_km_time = readB(dir_wj_time, "卡密时长", 0);
  const jjjj = xz_time - wj_time;
  
  let 授权状态 = "未授权";
  if (wj_time == 0 || wj_km_time == 0) {
    授权状态 = "未授权";
  } else if (jjjj > wj_km_time) {
    授权状态 = "未授权";
    writeB(dir_wj_time, "授权时间", 0);
    writeB(dir_wj_time, "卡密时长", 0);
  } else {
    授权状态 = "已授权";
  }
  
  globalStatus.RC_sq = 授权状态;
  return 授权状态;
}

function getAuthStatus() {
  return globalStatus.RC_sq;
}

function setAuthStatus(status) {
  globalStatus.RC_sq = status;
}

const array_shijian = ["禁言通知","入群审核","邀人统计","自助头衔","伪造聊天","黑白名单","退群拉黑","退群通知","整点报时","禁发红包","入群图片","违禁检测","进阶检测"];
const array_RCshijian = ["全群打卡","自动回赞"];
const RC_group_role ={
    "owner":3,
    "admin":2,
    "member":1,
    "unknown":0
};


// ================== 主人检测 - 有回复版==================
async function checkOwner(event, ctx) {
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner && nowonernr){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
        }
        return false;
    }
    return true;
}

// ================== 主人检测 - 无回复版 ==================
async function checkOwner2(event, ctx) {
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        return false;
    }
    return true;
}

// ================== 消息处理 ==================
async function handleMessage(message, event, ctx) {
// ================== 授权部分 ==================
// ================== 群管部分 ==================

// ================== 全局开关 - 群聊&私聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const haoyou_ofs = readB("config.json", "haoyou_of", []);
const isGroups = group_ofs.includes(String(event.group_id ?? ""));
const isHaoyou = haoyou_ofs.includes(String(event.user_id));
if(!isGroups && !isHaoyou) {
  return null;
}



// ================== 全局变量 ==================
await checkAuthStatus(event);
const RC_sq = getAuthStatus();//授权状态
const RC_music_bbh = `1.1.0`;




// ================== 授权部分 ==================
if(message.match(/^授权判断([0-9]+|)$/)){
    // ================== 添加来源 ==================
    let 来源 = "未知";
    let dir_wj_time = "";
    const two_km = message.match(/^授权判断([0-9]+|)$/)[1];//自选目标
    if(event.message_type == "group" && two_km == ""){//群聊
        来源 = `群聊(${event.group_id})`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
    }else if(event.message_type != "group" && two_km == ""){//私聊
        来源 = `私聊`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
    }else if(two_km != ""){//目标不为空时
        来源 = `群聊(${two_km})`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+two_km+".json";
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
    }
    
    // ================== 获取来源数据 ==================
    const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
    const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
    const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
    const jjjj = xz_time - wj_time;//距离首次授权已过多久
        
    // ================== 检 ==================
    if(jjjj < wj_km_time){
        const scsq_time = timeA("y-m-d H:i:s", wj_time);//首次授权时间
        const sysc_time = timeB("d天H时i分s秒", wj_km_time - jjjj);//剩余的授权时间
        const expireDateStr = timeA("y-m-d H:i:s", wj_time + wj_km_time);//到期时间
        let 组装消息 = `${来源} - 授权数据`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[授权时间]:${scsq_time}`;
        组装消息 += `\n[剩余时长]:${sysc_time}`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }else{
        const scsq_time = timeA("y-m-d H:i:s", wj_time);//首次授权时间
        const expireDateStr = timeA("y-m-d H:i:s", wj_time + wj_km_time);//到期时间
        let 组装消息 = `${来源} - 授权数据`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[授权时间]:${scsq_time}`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}





if(message == "授权系统"){
    // ================== 组装返回内容 ==================
    let 返回内容1 = "用户指令:";
    返回内容1 += `\n══════════════`;
    返回内容1 += `\n授权判断`;
    返回内容1 += `\n授权判断[群号]`;
    返回内容1 += `\n使用卡密[卡密]`;
    返回内容1 += `\n══════════════`;
    // ================== 组装返回内容 - 2 ==================
    let 返回内容2 = "后台指令:";
    返回内容2 += `\n══════════════`;
    返回内容2 += `\n - 单次生成`;
    返回内容2 += `\n生成天卡授权  生`;
    返回内容2 += `\n生成周卡授权  成`;
    返回内容2 += `\n生成月卡授权  卡`;
    返回内容2 += `\n生成半年授权  密`;
    返回内容2 += `\n生成年卡授权  授`;
    返回内容2 += `\n生成永久授权  权`;
    返回内容2 += `\n - 批量生成`;
    返回内容2 += `\n生成天卡授权[数量]  批`;
    返回内容2 += `\n生成周卡授权[数量]  量`;
    返回内容2 += `\n生成月卡授权[数量]  生`;
    返回内容2 += `\n生成半年授权[数量]  成`;
    返回内容2 += `\n生成年卡授权[数量]  授`;
    返回内容2 += `\n生成永久授权[数量]  权`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 添加到当前群聊`;
    返回内容2 += `\n添加天卡授权  添`;
    返回内容2 += `\n添加周卡授权  加`;
    返回内容2 += `\n添加月卡授权  本`;
    返回内容2 += `\n添加半年授权  群`;
    返回内容2 += `\n添加年卡授权  授`;
    返回内容2 += `\n添加永久授权  权`;
    返回内容2 += `\n - 添加到指定群聊`;
    返回内容2 += `\n添加天卡授权[群号]  跨`;
    返回内容2 += `\n添加周卡授权[群号]  群`;
    返回内容2 += `\n添加月卡授权[群号]  添`;
    返回内容2 += `\n添加半年授权[群号]  加`;
    返回内容2 += `\n添加年卡授权[群号]  授`;
    返回内容2 += `\n添加永久授权[群号]  权`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 看列表的`;
    返回内容2 += `\n卡密列表`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 删除卡密`;
    返回内容2 += `\n删除卡密[卡密]`;
    返回内容2 += `\n清空全部`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 取消授权`;
    返回内容2 += `\n删除授权`;
    返回内容2 += `\n删除授权[群号]`;
    返回内容2 += `\n══════════════`;
    // ================== 输出消息 ==================
    const messages = [
        { text: 返回内容1, name: "[授权系统]", qq: event.self_id },
        { text: 返回内容2, name: "[授权系统]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
    return null;
}




if (message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)) {
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[1];//卡密类型
    const two_km = (message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[3] || 1);
    
    // ================== 判断合理性 ==================
    if(two_km <= 0 || two_km >= 101){
      await sendReply(event, `[CQ:reply,id=${event.message_id}]请正常给我参数哦～`, ctx);
      return null;
    }
    
    // ================== 卡密时间表 ==================
    const km_time_type ={
        "天": 86400,
        "周": 604800,
        "月": 2678400,
        "半年": 15724800,
        "年": 31622400,
        "永久": 311040000
    };
    let km_time = km_time_type[one_km];//获取卡密时长
  
    // ================== 循环 ==================
    let 循环次数 = two_km;
    let 本次序号 = 0;
    let 组装消息 = `已生成【${循环次数}】张【${one_km}卡】`;
    for(let i = 0; i < 循环次数; i++) {
        本次序号 = i + 1;
        let km_key = "MK"+rand(100000, 999999)+Math.floor(Date.now() / 1000);
        let 内容 = {类型:one_km, 时长:km_time};
        writeB("筱筱吖/授权系统/卡密管理/卡密数据.json", km_key, 内容);
        组装消息 += `\n【${本次序号}】${km_key}`;
    }
  
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]已发给你的私聊啦，请查收～`, ctx);
    const fakeEvent = {//安全输出
        message_type: "private",
        user_id: event.user_id //目标QQ
    };
    if(循环次数 > 10){
        const messages = [
            { text: 组装消息, name: "[新的卡密]", qq: event.self_id }
        ];
        await sendForward(fakeEvent, messages, ctx);
    }else{
      await sendReply(fakeEvent, `${组装消息}`, ctx);
    }
    return null;
}




if (message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)) {
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
  
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[1];//卡密类型
    const two_km = message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[3];//自选目标
    //构建空值
    let dir_wj_time = "";
    if(event.message_type == "group" && two_km == ""){//如果消息是群聊的及自选目标为空
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
    }else if(event.message_type != "group" && two_km == ""){//私聊单加
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
    }else if(two_km != ""){//目标不为空时
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+two_km+".json";
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
    const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
    const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
    const jjjj = xz_time - wj_time;
    
    // ================== 读取固定数据 ==================
    const km_time_type ={//卡密时间表
        "天": 86400,
        "周": 604800,
        "月": 2678400,
        "半年": 15724800,
        "年": 31622400,
        "永久": 311040000
    };
    let km_time = km_time_type[one_km];
    //await sendReply(event, `[CQ:reply,id=${event.message_id}]当前值:${km_time} | 类型值:${one_km}`, ctx);
    
    // ================== 检测是否到期 ==================
    let 添加方式 = "";
    let extime = 0;
    if(jjjj > wj_km_time){//如果已过时间大于授权时间
        添加方式 = "重新添加授权";
        extime = xz_time + km_time;
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权已到期，重新增加`, ctx);
        writeB(dir_wj_time, "授权时间", xz_time);
        writeB(dir_wj_time, "卡密时长", km_time);
    }else{//卡密没到期
        添加方式 = "续期卡密时长";
        extime = xz_time + km_time + wj_km_time;
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权还在，正在续期....`, ctx);
        writeB(dir_wj_time, "卡密时长", km_time + wj_km_time);
    }
    
    // ================== 组装输出内容 ==================
    const expireDateStr = timeA("y-m-d H:i:s", extime);
    let 组装消息 = ``;
    组装消息 += `══════════════`;
    组装消息 += `\n已${添加方式}`;
    组装消息 += `\n[卡密类型]:${one_km}卡`;
    组装消息 += `\n[新增时长]:${km_time}秒`;
    组装消息 += `\n[到期时间]:${expireDateStr}`;
    组装消息 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}



if(message.match(/^使用卡密([\s\S]*)$/)){
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^使用卡密([\s\S]*)$/)[1];//卡密
    
    // ================== 读取文件数据 ==================
    const data = readB("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km, {});
    
    // ================== 取值 ==================
    let 卡密类型 = data["类型"];
    let 卡密时长 = data["时长"];
    
    // ================== 判断 ==================
    if(卡密类型 === undefined || 卡密时长 === undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]卡密无效！`, ctx);
        return null;
    }else{
        // ================== 添加来源 ==================
        let 来源 = "未知";
        let dir_wj_time = "";
        if(event.message_type == "group"){
            来源 = `群聊(${event.group_id})`;
            dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
        }else if(event.message_type != "group"){
           来源 = "私聊";
            dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
        }else{
            await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
            return null;
        }
        
        // ================== 获取来源数据 ==================
        const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
        const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
        const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
        const jjjj = xz_time - wj_time;
        
        // ================== 检测来源数据是否到期 ==================
        let 添加方式 = "";
        let extime = 0;
        if(jjjj > wj_km_time){//到期
            添加方式 = "重新添加授权";
            extime = xz_time + 卡密时长;
            //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权已到期，重新增加`, ctx);
            writeB(dir_wj_time, "授权时间", xz_time);
            writeB(dir_wj_time, "卡密时长", 卡密时长);
        }else{//卡密没到期
            添加方式 = "续期卡密时长";
            extime = xz_time + 卡密时长 + wj_km_time;
            //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权还在，正在续期....`, ctx);
            writeB(dir_wj_time, "卡密时长", 卡密时长 + wj_km_time);
        }
    
        // ================== 组装输出 ==================
        const expireDateStr = timeA("y-m-d H:i:s", extime);
        let 组装消息 = "";
        组装消息 += `══════════════`;
        组装消息 += `\n[使用目标]:${来源}`;
        组装消息 += `\n[增加模式]:${添加方式}`;
        组装消息 += `\n[卡密类型]:${卡密类型}卡`;
        组装消息 += `\n[新增时长]:${卡密时长}秒`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    
    // ================== 删除卡密 ==================
    deleteKey("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km);//删除键
    return null;
}






if(message.match(/^(删除|清空)卡密([\s\S]*)$/)){
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;

    // ================== 取出所输入的值 ==================
    const ly_km = message.match(/^(删除|清空)卡密([\s\S]*)$/)[1];//方式
    const one_km = message.match(/^(删除|清空)卡密([\s\S]*)$/)[2];//卡密
    
    // ================== 读取文件数据 ==================
    const data = readB("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km, {});
    let 卡密类型 = data["类型"];
    let 卡密时长 = data["时长"];
    
    // ================== 判断有效性 ==================
    if((卡密类型 === undefined || 卡密时长 === undefined) && ly_km != "清空"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]卡密不存在！`, ctx);
        return null;
    }
    
    // ================== 处理类型 ==================
    if(ly_km == "清空"){
        writeA("筱筱吖/授权系统/卡密管理/卡密数据.json", "{}");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已清空现在有的全部卡密啦～！`, ctx);
        return null;
    }else{
        // ================== 删除卡密 ==================
        deleteKey("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km);//删除单个卡密
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已删除卡密【${one_km}】`, ctx);
        return null;
    }
}


if(message == "卡密列表"){
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 读取数据 ==================
    const km_content = readA("筱筱吖/授权系统/卡密管理/卡密数据.json");
    let km_data = {};
    if (km_content && km_content.trim()) {
        try {
            km_data = JSON.parse(km_content);
        } catch (e) {
            km_data = {};
        }
    }
    const km_count = Object.keys(km_data).length;//卡密数量
    
    // ================== 如果没卡密 ==================
    if(km_count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]目前没有卡密哦～`, ctx);
        return null;
    }
    
    // ================== 循环前置 ==================
    let 组装消息 = "";
    let 序号 = 1;
    let 永久卡数量 = 0;
    let 年卡数量 = 0;
    let 半年卡数量 = 0;
    let 月卡数量 = 0;
    let 周卡数量 = 0;
    let 天卡数量 = 0;
    // ================== 循环 ==================
    for (const [键, 值] of Object.entries(km_data)) {
        let 本次类型 = 值["类型"];
        let 本次时长 = 值["时长"];
        
        // ================== 如果任意内容为空 ==================
        if(本次类型 == undefined || 本次时长 == undefined){
            continue;
        }
        组装消息 += `\n${序号}.[${本次类型}卡]:【${键}】`;
        序号++;
        
        // ================== 增加记录 ==================
        if(本次类型 == "永久"){
            永久卡数量++;
        }else if(本次类型 == "年"){
            年卡数量++;
        }else if(本次类型 == "半年"){
            半年卡数量++;
        }else if(本次类型 == "月"){
            月卡数量++;
        }else if(本次类型 == "周"){
            周卡数量++;
        }else{
            天卡数量++;
        }
    }
    
    // ================== 组装输出 ==================
    let 组装消息2 = `共计【${km_count}】张卡密`;
    组装消息2 += `\n══════════════`;
    组装消息2 += `\n[天卡]:${天卡数量}`;
    组装消息2 += `\n[周卡]:${周卡数量}`;
    组装消息2 += `\n[月卡]:${月卡数量}`;
    组装消息2 += `\n[半年]:${半年卡数量}`;
    组装消息2 += `\n[年卡]:${年卡数量}`;
    组装消息2 += `\n[永久]:${永久卡数量}`;
    组装消息2 += `\n══════════════`;
    
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]已发给你的私聊啦，请查收～`, ctx);
    const fakeEvent = {//安全输出
        message_type: "private",
        user_id: event.user_id //目标QQ
    };
    const messages = [
        { text: 组装消息2+组装消息, name: "[授权系统]", qq: event.self_id }
    ];
    await sendForward(fakeEvent, messages, ctx);
}



if(message.match(/^(删除|取消)授权([\s\S]*)$/)){
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    const one_km = message.match(/^(删除|取消)授权([\s\S]*)$/)[2];//目标
    // ================== 获取文件 ==================
    let mub = "";
    let dir_wj_time = "";
    if(event.message_type == "group" && one_km == ""){//群聊
        mub = event.group_id;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
        
    }else if(event.message_type != "group" && one_km == ""){//私聊
        mub = "私聊"
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
        
    }else if(one_km != ""){//目标
        mub = one_km;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+one_km+".json";
        
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
        
    }
    
    // ================== 重置时间 ==================
    writeB(dir_wj_time, "授权时间", 0);
    writeB(dir_wj_time, "卡密时长", 0);

    // ================== 输出结果 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去把【${mub}】的授权状态给bian了！`, ctx);
    return null;
}












// ================== 群管部分 ==================
if(message == "群管系统" || message == "群管功能" || message == "群管菜单"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息 - 1 ==================
    let 组装消息1 = "══════════════";
    组装消息1 += `\n【群管系统】`;
    组装消息1 += `\n - 禁言@人 [时间]`;
    组装消息1 += `\n - 解禁@人`;
    组装消息1 += `\n - 上管@人`;
    组装消息1 += `\n - 下管@人`;
    组装消息1 += `\n - 踢出@人`;
    组装消息1 += `\n - 黑踢@人`;
    组装消息1 += `\n - 获取禁言列表`;
    组装消息1 += `\n══════════════`;
    组装消息1 += `\n【扩展】`;
    组装消息1 += `\n - 更改群名称[内容]`;
    组装消息1 += `\n - 更改群头像[图片]`;
    //组装消息1 += `\n`;
    //组装消息1 += `\n`;
    //组装消息1 += `\n`;
    组装消息1 += `\n══════════════`;
    // ================== 输出消息 - 2 ==================
    let 组装消息2 = `══════════════`;
    组装消息2 += `\n【入群审核】`;
    组装消息2 += `\n`;
    组装消息2 += `\n切换类型的↓`;
    组装消息2 += `\n - 设置入群审核条件[准确|包含|模糊多重|准确多重|字数]`;
    组装消息2 += `\n`;
    组装消息2 += `\n设置每人单天的可用次数的↓`;
    组装消息2 += `\n设置入群审核单日次数[数量]`;
    组装消息2 += `\n`;
    组装消息2 += `\n字数条件的↓`;
    组装消息2 += `\n - 设置入群审核字数数量[数量]`;
    组装消息2 += `\n`;
    组装消息2 += `\n准确&包含条件的↓`;
    组装消息2 += `\n - 设置入群审核答案[内容]`;
    组装消息2 += `\n`;
    组装消息2 += `\n多重条件的↓`;
    组装消息2 += `\n - 新增审核条件[内容]`;
    组装消息2 += `\n - 删除审核条件[内容]`;
    组装消息2 += `\n - 查看多重条件列表`;
    组装消息2 += `\n══════════════`;
    组装消息2 += `\n详细数据看「功能解析」这个功能没写`;
    // ================== 组装输出 - 3 ==================
    let 组装消息3 = `══════════════`;
    组装消息3 += `\n【头衔系统】- 自助`;
    组装消息3 += `\n相关事件【自助头衔】`;
    组装消息3 += `\n - 我要头衔[内容]`;
    组装消息3 += `\n---------------`;
    组装消息3 += `\n【头街系统】- 指令`;
    组装消息3 += `\n - 设置头衔@人 [内容]`;
    组装消息3 += `\n - 全员头衔[内容]`;
    组装消息3 += `\n══════════════`;
    // ================== 组装消息 - 4 ==================
    let 组装消息4 = `══════════════`;
    组装消息4 += `\n【清理骨灰】`;
    组装消息4 += `\n - 获取骨灰群员列表`;
    组装消息4 += `\n - 查看骨灰群员列表`;
    组装消息4 += `\n - 取消骨灰群员QQ[QQ号]`;
    组装消息4 += `\n - 取消骨灰群员序号[序号]`;
    组装消息4 += `\n - 取消骨灰群员序号[序号]-[序号]`;
    组装消息4 += `\n - 确定清理全部骨灰群员`;
    组装消息4 += `\n------------------`;
    组装消息4 += `\n【清理骨灰】- 使用说明`;
    组装消息4 += `\n1.先「获取骨灰群员」列表`;
    组装消息4 += `\n2.再「查看骨灰群员」列表，确定数据无误`;
    组装消息4 += `\n3.如需调整，那就「取消骨灰群员」选「QQ号」模式或「序号」模式`;
    组装消息4 += `\n4.确定无误后，发「确定清理全部骨灰群员」`;
    组装消息4 += `\n5.重新获取列表只需要再发一次「获取骨灰群员」`;
    组装消息4 += `\n══════════════`;
    // ================== 组装消息 - 5 ==================
    let 组装消息5 = `══════════════`;
    组装消息5 += `\n【黑名单系统】`;
    组装消息5 += `\n相关事件【黑白名单】`;
    组装消息5 += `\n`;
    组装消息5 += `\n↓查看列表的↓`;
    组装消息5 += `\n - 黑名单列表`;
    组装消息5 += `\n - 全局黑名单列表`;
    组装消息5 += `\n - 本群黑名单列表`;
    组装消息5 += `\n`;
    组装消息5 += `\n↓添加/删除的↓`;
    组装消息5 += `\n - 清空黑名单`;
    组装消息5 += `\n - 清空全局黑名单`;
    组装消息5 += `\n - 添加本群黑名单@人`;
    组装消息5 += `\n - 添加全局黑名单[QQ号]`;
    组装消息5 += `\n - 删除本群黑名单[QQ号]`;
    组装消息5 += `\n`;
    组装消息5 += `\n↓设置处理方式的↓`;
    组装消息5 += `\n - 设置本群黑名单处理[踢出|黑踢]`;
    组装消息5 += `\n - 设置全局黑名单处理[踢出|黑踢]`;
    组装消息5 += `\n══════════════`;
    // ================== 组装消息 - 6 ==================
    let 组装消息6 = `══════════════`;
    组装消息6 += `\n【违禁词系统】`;
    组装消息6 += `\n相关事件【违禁检测】`;
    组装消息6 += `\n`;
    组装消息6 += `\n - 违禁词列表`;
    组装消息6 += `\n - 添加违禁词[内容]`;
    组装消息6 += `\n - 删除违禁词[内容]`;
    组装消息6 += `\n - 清空违禁词`;
    组装消息6 += `\n`;
    组装消息6 += `\n - 设置违禁处理禁言`;
    组装消息6 += `\n - 设置违禁处理撤回`;
    组装消息6 += `\n - 设置违禁处理撤回禁言`;
    组装消息6 += `\n - 设置违禁处理禁言时长[秒数]`;
    组装消息6 += `\n══════════════`;
    // ================== 输出 ==================
    const messages = [
        { text: 组装消息1, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息2, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息3, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息4, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息5, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息6, name: "[群管系统]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
}




if(message.match(/^更改群(名称|名字|头像)([\s\S]*)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 判断身份 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像木有权限改这个哎！～`, ctx);
        return null;
    }
    // ================== 检 ==================
    const one_mub = message.match(/^更改群(名称|名字|头像)([\s\S]*)$/)[1];
    const two_mub = message.match(/^更改群(名称|名字|头像)([\s\S]*)$/)[2];
    const 字数 = (two_mub.length || 0);
    // ================== 改群头像的 ==================
    if(one_mub == "头像"){
        // ================== 检测图片数量 ==================
        const image = giveImages(event.message);//图片链接
        const 图片数量 = (image.length || 0);
        if(图片数量 == 0){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]请携带一张照片再发送哟～`, ctx);
            return null;
        }
        // ================== 更改 ==================
        let 参数 = {"group_id":event.group_id, "file": image[0]};
        BOTAPI(ctx, "set_group_portrait", 参数);
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我马上就去把群头像改成介个图片的！\n[CQ:image,file=${image[0]}]`, ctx);
        return null;
    }else{
        // ================== 检 ==================
        if(字数 < 1 || two_mub == undefined){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]你介个内容好像无效唉？！`, ctx);
            return null;
        }else{
            let 参数 = {"group_id": event.group_id, "group_name": two_mub};
            await BOTAPI(ctx, "set_group_name", 参数);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒！现在就把群名字改成↓\n${two_mub}`, ctx);
        }
        return null;
    }
}



if(message.match(/^我要头衔([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 判断 ==================
    let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "自助头衔", "关闭");
    if(开关 == "关闭"){
        return null;
    }
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 != 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有权限给你头衔哎～～`, ctx);
        return null;
    }
    // ================== 正式 ==================
    const nr = (message.match(/^我要头衔([\s\S]*)/)[1] || "");
    let 参数 = {
        "group_id": event.group_id,
        "user_id": event.user_id,
        "special_title": nr
    };
    await BOTAPI(ctx, "set_group_special_title", 参数);
}


if(message.match(/^设置头衔/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 判断权限 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 != 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有权限设置头衔哎～～`, ctx);
        return null;
    }
    // ================== 循环前置 ==================
    const pureText = giveText(event.message);
    const content = pureText.replace(/^设置头衔/, "").trim();
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    if(rs == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]介个功能需要艾特才能执行哦`, ctx);
        return null;
    }
    let 组装消息 = `已把下面届些仁的头衔都改成一样的啦！`;
    组装消息 += `\n══════════════`;
    // ================== 循环开始 ==================
    for(let i = 0; i < rs; i++) {
        let 本次QQ = atUsers[i];
        let 参数 = {
            "group_id": event.group_id,
            "user_id": 本次QQ,
            "special_title": content
        };
        BOTAPI(ctx, "set_group_special_title", 参数);
        组装消息 += `\n${i + 1}.【${本次QQ}】`;
    }
    // ================== 输出方式 ==================
    if(rs > 15){
        const messages = [
            { text: 组装消息, name: "[多选改头衔结果]", qq: event.self_id }
        ];
    await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}



if(message.match(/^(全体头衔|全员头衔)([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 判断权限 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 != 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有权限设置头衔哎～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    const dp = await BOTAPI(ctx, "get_group_member_list", 参数);
    // ================== 循环前置 ==================
    let data = dp;
    let 总人数 = Object.keys(data).length;
    if(总人数 == 0){
        //什么群tm0个人
        await sendReply(event, `[CQ:reply,id=${event.message_id}]获取失败！1`, ctx);
    }
    // ================== 循环前置 ==================
    const content = message.match(/^(全体头衔|全员头衔)([\s\S]*)/)[2] || "";
    let 组装消息 = ``;
    let 有效人数 = 0;
    // ================== 循环 ==================
    for(let i = 0; i < 总人数; i++) {
        let 是否机器人 = (data[i].is_robot || false);
        if(是否机器人){
            组装消息 += `\n❌${i+1}.${data[i].nickname}(${data[i].user_id})`;
        }else{
            组装消息 += `\n✅${i+1}.${data[i].nickname}(${data[i].user_id})`;
            let 参数 = {
                "group_id": event.group_id,
                "user_id": data[i].user_id,
                "special_title": content
            };
            BOTAPI(ctx, "set_group_special_title", 参数);
            有效人数++;
        }
    }
    // ================== 输出结果 ==================
    let 返回内容 = `已对【${有效人数}】位群友进行头衔更改～`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    if(总人数 >= 15){//合并输出
        const messages = [
            { text: 返回内容, name: "[全员头衔]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{//普通输出
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}





if(message.match(/^(全体|全)(禁言|解禁|禁|解)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 取类型 ==================
    const jy_tok = message.match(/^(全体|全)(禁言|解禁|禁|解)$/)[2];//值
    let jy_token = true;
    if(jy_tok == "建议" || jy_tok == "禁"){
        jy_token = true;
    }else{
        jy_token = false;
    }
    
    // ================== 管理员身份验证 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id,
        enable : jy_token
    };
    //调用
    const dp = await BOTAPI(ctx, "set_group_whole_ban", 参数);
    
    // ================== 输出 ==================
    if(jy_tok == "禁言" || jy_tok == "禁"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]这就把全体禁言给打开，让大家都不能说话！`, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]大家又可以说话啦！`, ctx);
    }
    return null;
}


if(message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)[1];//值
    let mub_time = (message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)[3] || 60);
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取类型&时间 ==================
    if(mub_ly == "禁言"){
        mub_time = mub_time;
    }else{
        mub_time = 0;
    }
    
    // ================== 循环 ==================
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        if(User身份 >= Robot身份){//比机器人大 | 同级
            组装消息 += `\n❌${i+1}.${本次QQ}:权限不足`;
            continue;
        }else{
            // ================== 调用接口 ==================
            if(mub_ly == "禁言"){
                组装消息 += `\n✅${i+1}.${本次QQ}:禁言${mub_time}秒`;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:解禁成功`;
            }
            let 参数 = {
                group_id : event.group_id,
                user_id : 本次QQ,
                duration : mub_time
            };
            //调用
            BOTAPI(ctx, "set_group_ban", 参数);
            有效人数++;
        }
    }
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}




if(message.match(/^(踢出|黑踢)([\s\S]*?)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(踢出|黑踢)([\s\S]*?)$/)[1];//值
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取参数 ==================
    let type = false;
    if(mub_ly == "黑踢"){
        type = true;
    }else{
        type = false;
    }
    
    // ================== 循环 ==================
    let 真实数据 = [];
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        if(User身份 >= Robot身份){//比机器人大 | 同级
            组装消息 += `\n❌${i+1}.${本次QQ}:权限不足`;
            continue;
        }else{
            // ================== 调用接口 ==================
            if(mub_ly == "踢出"){
                组装消息 += `\n✅${i+1}.${本次QQ}:普通踢出`;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:拉黑踢出`;
            }
            真实数据.push(本次QQ);
            有效人数++;
        }
    }
    
    // ================== 调用接口 ==================
    let 参数 = {
        group_id : event.group_id,
        user_id : 真实数据,
        reject_add_request : type
    };
    BOTAPI(ctx, "set_group_kick_members", 参数);
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message.match(/^(上管|下管)([\s\S]*?)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(上管|下管)([\s\S]*?)$/)[1];//值
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 != 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群主权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取参数 ==================
    let type = false;
    if(mub_ly == "上管"){
        type = true;
    }else{
        type = false;
    }
    
    // ================== 循环 ==================
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        // ================== 类型 ==================
        if(mub_ly == "上管"){
            if(User身份 >= 2){//比机器人大 | 同级
                组装消息 += `\n❌${i+1}.${本次QQ}:已经是啦`;
                continue;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:新上位`;
                有效人数++;
            }
        }else{
            if(User身份 < 2){//比机器人大 | 同级
                组装消息 += `\n❌${i+1}.${本次QQ}:已就不是`;
                continue;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:被下台了`;
                有效人数++;
            }
        }
        // ================== 访问接口 ==================
        let 参数 = {
            group_id : event.group_id,
            user_id : 本次QQ,
            enable : type
        };
        BOTAPI(ctx, "set_group_admin", 参数);
    }
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}


if(message == "获取禁言列表"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 调用接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    const dp = await BOTAPI(ctx, "get_group_shut_list", 参数);
    const count =(dp.length || 0);
    
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]没有人被禁言啦～`, ctx);
        return null;
    }
    
    // ================== 循环 ==================
    let 组装消息 = `共有【${count}】人处于禁言状态:`;
    组装消息 += "\n══════════════";
    for(let i = 0; i < count; i++) {
        let QQ = (dp[i]?.uin || "0");
        let 昵称 = (dp[i]?.nick || "");
        let 禁言结束时间 = timeA("y-m-d H:i:s", (dp[i]?.shutUpTime || 0));
        组装消息 += `\n${i+1}.${QQ}(${昵称})`;
        组装消息 += `\n[结束时间]:${禁言结束时间}`;
        if(i+1 == count){
            组装消息 += `\n══════════════`;
        }else{
            组装消息 += `\n-----------------`;
        }
    }
    
    // ================== 输出 ==================
    if(count >= 10){
        const messages = [
            { text: 组装消息, name: "[禁言列表]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}


if(message.match(/^获取骨灰群员(列表|)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    
    writeA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`, "[]");
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    const dp = await BOTAPI(ctx, "get_group_member_list", 参数);
    // ================== 循环前置 ==================
    let data = dp;
    let 总人数 = Object.keys(data).length;
    if(总人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]获取失败！`, ctx);
    }
    let 现在时间 = Math.floor(Date.now() / 1000);
    let 数据_one = [];
    // ================== 循环 ==================
    for(let i = 0; i < 总人数; i++) {
        let 最后发言 = data[i].last_sent_time;
        let 未发言时长 = 现在时间 - 最后发言;//86400为一天
        // ================== 记录 ==================
        if(未发言时长 >= 604800){
            数据_one.push({
                "QQ":data[i]["user_id"],
                "昵称":data[i]["nickname"],
                "时长":未发言时长,
                "身份":data[i]["role"]
            });
        }
    }
    // ================== 二次验证 ==================
    let 总人数_2 = (数据_one.length || 0);
    if(总人数_2 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好像没获取到哎～`, ctx);
        return null;
    }
    let 组装消息 = ``;
    数据_one.sort((a, b) => b.时长 - a.时长);
    writeA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`, JSON.stringify(数据_one));
    // ================== 二次循环 ==================
    for(let i = 0; i < 总人数_2; i++) {
        let 本次QQ = 数据_one[i]["QQ"];
        let 本次昵称 = 数据_one[i]["昵称"];
        let 时长 = timeB("d", 数据_one[i]["时长"]);
        组装消息 += `\n${i + 1}.${本次昵称}(${本次QQ})(${时长}天)`;
    }
    // ================== 组装消息 ==================
    let 返回内容 = `共计有【${总人数_2}】位高冷人士`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    // ================== 输出方式 ==================
    if(总人数_2 >= 15){
        const messages = [{ text: 返回内容, name: "[你这群这么多啊]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message.match(/^查看骨灰群员(列表|)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取数据 ==================
    const data = JSON.parse(readA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`) || "[]");
    const count = (data.length || 0);
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]木有数据哎～！\n你先去「获取骨灰群员」八～！`, ctx);
        return null;
    }
    // ================== 循环前置 ==================
    let 组装消息 = ``;
    // ================== 循环 ==================
    for(let i = 0; i < count; i++) {
        let 本次QQ = data[i]["QQ"];
        let 本次昵称 = data[i]["昵称"];
        let 时长 = timeB("d", data[i]["时长"]);
        组装消息 += `\n${i + 1}.${本次昵称}(${本次QQ})(${时长}天)`;
    }
    // ================== 组装消息 ==================
    let 返回内容 = `共计有【${count}】位高冷人士`;
    返回内容 += `\n----------------------`;
    返回内容 += `\n可用指令:`;
    返回内容 += `\n - 取消骨灰群员QQ[QQ号]`;
    返回内容 += `\n - 取消骨灰群员序号[序号]`;
    返回内容 += `\n - 取消骨灰群员序号[序号]-[序号]`;
    返回内容 += `\n - 确定清理全部骨灰群员`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    // ================== 输出方式 ==================
    if(count >= 15){
        const messages = [
            { text: 返回内容, name: "[骨灰群员列表]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message.match(/^取消骨灰群员(序号|QQ)([0-9]+)(-|_|.|)([0-9]+|)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取数据 ==================
    let data = JSON.parse(readA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`) || "[]");
    const count = (data.length || 0);
    const 类型 = message.match(/^取消骨灰群员(序号|QQ)([0-9]+)(-|_|.|)([0-9]+|)$/)[1];
    const 值1 = Number(message.match(/^取消骨灰群员(序号|QQ)([0-9]+)(-|_|.|)([0-9]+|)$/)[2]);
    const 值2 = Number(message.match(/^取消骨灰群员(序号|QQ)([0-9]+)(-|_|.|)([0-9]+|)$/)[4]);
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]木有数据哎～！\n你先去「获取骨灰群员」八～！`, ctx);
        return null;
    }
    let 返回内容 = ``;
    // ================== 方式 ==================
    if(类型 == "QQ"){
        let 被删除用户 = data.find(item => item.QQ === 值1);
        if(!被删除用户){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]用户不存在列表！`, ctx);
            return null;
        }
        data = data.filter(item => item.QQ !== 值1);//过滤目标
        返回内容 += `这就把【${值1}】给取消啦！你再看看列表吧！`;
    }
    if(类型 == "序号"){
        if(值2 && (值1 == 值2 || 值1 > 值2 || 值1 == 0 || 值2 == 0)){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]操作无效`, ctx);
            return null;
        }
        let 范围 = 1;
        if(值2){
            范围 = 值2 - 值1 + 1;
        }else{
            范围 = 1;
        }
        // ================== 循环前置 ==================
        let 被删除用户 = data[值1 - 1];
        if(!被删除用户){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]序号${值1}不存在列表！`, ctx);
            return null;
        }
        // ================== 循环 ==================
        for(let i = 值1 - 1; i < 值1 - 1 + 范围; i++){
            let yh_qq = data[i]["QQ"];
            返回内容 += `\n${i + 1}.【${yh_qq}】`;
        }
        data.splice(值1 - 1, 范围);//删除几个
    }
    // ================== 输出 ==================
    writeA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`, JSON.stringify(data));
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    return null;
}


if(message.match(/^确定清理全部骨灰群员$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取数据 ==================
    let data = JSON.parse(readA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`) || "[]");
    const count = (data.length || 0);
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]木有数据哎～！\n你先去「获取骨灰群员」八～！`, ctx);
        return null;
    }
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有权限清理吧？～～`, ctx);
        return null;
    }
    let 真数据 = [];
    let 有效人数 = 0;
    let 表面工作 = ``;
    // ================== 循环 ==================
    for(let i = 0; i < count; i++){
        let 本次身份等级 = (RC_group_role[(data[i]["身份"] || "member")] || 0);
        let 本次QQ = data[i]["QQ"];
        if(本次身份等级 >= Robot身份){
            表面工作 += `\n${i + 1}.【${本次QQ}】❌权限不足`;
        }else{
            表面工作 += `\n${i + 1}.【${本次QQ}】✅`;
            真数据.push(本次QQ);
            有效人数++;
        }
    }
    // ================== 人数判断 ==================
    if(有效人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]可能是权限不足，导致列表页面我一个人都清不了！`, ctx);
        return null;
    }
    // ================== 执行清理 ==================
    writeA(`筱筱吖/群管系统/清理骨灰/${event.group_id}/目前数据.json`, "[]");
    let 参数 = {
        group_id : event.group_id,
        user_id : 真数据,
        reject_add_request : false
    };
    BOTAPI(ctx, "set_group_kick_members", 参数);
    // ================== 输出 ==================
    let 返回内容 = `共有效清理【${有效人数}】位骨灰`;
    返回内容 += `\n══════════════`;
    返回内容 += 表面工作;
    返回内容 += `\n══════════════`;
    if(有效人数 >= 15){
        const messages = [{ text: 返回内容, name: "[清空列表]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}






// ================== 娱乐部分 ==================
if(message == "菜单"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    let 发送方式 = readB("config.json", "cs_of", false);
    if(发送方式 == false){
        // ================== 文本输出 ==================
        let 组装消息 = `══════════════`;
        组装消息 += `\n授权系统 - 群管系统 - 邀人统计`;
        组装消息 += `\n事件管理 - 音乐系统 - 账号设置`;
        组装消息 += `\n----------------`;
        组装消息 += `\n银行系统 - `;
        组装消息 += `\n群老婆 - 漂流瓶 - 排行榜`;
        组装消息 += `\n══════════════`;
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }else{
        // ================== 画布输出 ==================
        const htmlContent = readA("html/导航菜单.html");
        if(!htmlContent){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]cc.html 文件不存在或为空`, ctx);
            return null;
        }
        const imageData = await puppeteer(htmlContent);
        if(!imageData){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]渲染失败，请检查 Puppeteer 服务是否运行`, ctx);
            return null;
        }
        const imageUrl = imageData.startsWith("base64://") ? imageData : `base64://${imageData}`;
        await sendReply(event, `[CQ:image,file=${imageUrl}]`, ctx);
        // ================== 检 ==================
    }
    return null;
}

if(message == "群老婆"){
    // ================== 判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    if(event.message_type != "group"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]该功能目前仅支持群聊使用哦～`, ctx);
        return null;
    }
    // ================== 组装消息 - 2 ==================
    let 组装消息1 = `══════════════`;
    组装消息1 += `\n普通指令↓`;
    组装消息1 += `\n - 今日老婆`;
    组装消息1 += `\n - 更换老婆`;
    组装消息1 += `\n`;
    组装消息1 += `\n管理员指令↓`;
    组装消息1 += `\n - 更改群老婆范围全群模式`;
    组装消息1 += `\n - 更改群老婆范围单群模式`;
    组装消息1 += `\n - 更改群老婆冷却[时长:秒]`;
    组装消息1 += `\n══════════════`;
    // ================== 组装消息 - 2 ==================
    let 组装消息2 = `══════════════`;
    组装消息2 += `\n1.本功能默开启，无法关闭`;
    组装消息2 += `\n2.默认单群模式，即每一个群分开计算`;
    组装消息2 += `\n3.群聊总数>30/有某群人数>1000的群，不建议开启全群模式`;
    组装消息2 += `\n4.全群模式，也就是获取本账号全部群聊中的全部人数据进行随机抽取`;
    组装消息2 += `\n5.管理员指令对全局生效，不会单针对某一个群`;
    组装消息2 += `\n6.开全群模式玩死机了别找我！`;
    组装消息2 += `\n══════════════`;
    // ================== 输出 ==================
    const messages = [
        { text: 组装消息1, name: "[群老婆]", qq: event.self_id },
        { text: 组装消息2, name: "[群老婆]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
    return null;
}






if(message == "排行榜"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息 ==================
    let 组装消息 = `══════════════`;
    组装消息 += `\n归笺排行榜 - 正常货币`;
    组装消息 += `\n存款排行榜 - 银行货币(含利润)`;
    组装消息 += `\n签到排行榜 - 每日签到排名`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}



if(message == "账号设置"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息 ==================
    let 组装消息 = `══════════════`;
    组装消息 += `\n更改机器人昵称[内容]`;
    组装消息 += `\n更改机器人头像[图片]`;
    组装消息 += `\n更改机器人签名[内容]`;
    组装消息 += `\n更改机器人性别[男|女]`;
    组装消息 += `\n重启服务`;
    组装消息 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}

if(message.match(/^更改机器人(头像|昵称|性别|签名)([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取数据 ==================
    const one_mub = message.match(/^更改机器人(头像|昵称|性别|签名)([\s\S]*)/)[1];
    const two_mub = message.match(/^更改机器人(头像|昵称|性别|签名)([\s\S]*)/)[2];
    let 参数9 = {user_id : event.self_id};
    const dp = await BOTAPI(ctx, "get_stranger_info", 参数9);
    // ================== 头像类型 ==================
    if(one_mub == "头像"){
        // ================== 检测图片数量 ==================
        const image = giveImages(event.message);//图片链接
        const 图片数量 = (image.length || 0);
        if(图片数量 == 0){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]请携带一张照片再发送哟～`, ctx);
            return null;
        }
        // ================== 更改 ==================
        let 参数 = {"file": image[0]};
        BOTAPI(ctx, "set_qq_avatar", 参数);
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我马上就去把头像改成介个，等我一会～～～\n[CQ:image,file=${image[0]}]`, ctx);
        return null;
    // ================== 昵称类型 ==================
    }else if(one_mub == "昵称" || one_mub == "签名"){
        let 字数 = (two_mub.length || 0);
        if(字数 == 0 || 字数 == undefined){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]更改${one_mub}时需要填内容哦～`, ctx);
            return null;
        }else{
            let 参数 = {"nickname": two_mub};
            if(one_mub == "昵称"){
                参数 = {"nickname": two_mub};
            }else{
                参数 = {"nickname": dp["nick"], "personal_note": two_mub};
            }
            // ================== 更改 ==================
            BOTAPI(ctx, "set_qq_profile", 参数);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒，已经把${one_mub}改成这个内容啦！你看看我主页叭！`, ctx);
            return null;
        }
    // ================== 昵称类型 ==================
    }else if(one_mub == "性别"){
        let 性别数据 = {"男":1, "女":2, "未知":0};
        let 据数别性 = {"0":"未知", "1":"男", "2":"女"};
        let 真实数据 = (性别数据[two_mub] || 0);
        let fffffffffff = (据数别性[真实数据] || "未知");
        // ================== 更改 ==================
        let 参数 = {"nickname": dp["nick"], "sex": 真实数据};
        BOTAPI(ctx, "set_qq_profile", 参数);
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒，已经把性别改成【${fffffffffff}】`, ctx);
        return null;
    }else{
        return null;
    }
}



if(message == "事件管理"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 数据 ==================
    const data = {
        "全群打卡":"每日00:00:00准时打卡，可能有一点点误差",
        "自动回赞":"当有人给机器人点赞时就回回赞，你点多少个就回多少个",
        "禁言通知":"在群聊有人禁言\/解禁，全体禁言\/解禁时，可触发回复",
        "入群审核":"字面意思，就是在填写进群请求的判断，推荐需求多答案且自动审核的用户群系",
        "邀人统计":"即记录当前群聊拉人数量，需保持开启才能有效计算，退群重拉不会二次记录",
        "自助头衔":"大家都会用吧，就字面意思，多了个开关而已",
        "伪造聊天":"位置合并转发消息，目前仅支持文字且当前群聊伪造，暂不支持其他操作",
        "黑白名单":"黑名单系统，需要先开启才可配置数据，默认普通踢出，黑踢为QQ自带的黑名单拦截！",
        "退群通知":"字面意思 有人退群就会发送通知，机器人踢的不会",
        "退群拉黑":"兼容退群拉黑，不开退群通知则不回复，但有实际拉黑效果",
        "整点报时":"字面意思，当时间为整点时会自动播报消息",
        "禁发红包":"字面意思，禁发全部类型红包，暂不支持分类，仅撤回",
        "入群图片":"需配搭Puppeteer插件使用，当有人成功进群时触发回复图片",
        "违禁检测":"即违禁词系统，目前可:撤回/禁言/撤回禁言",
        "进阶检测":"违禁检测的高级版，支持检测合并转发消息里面的文本消息进行匹配违禁词"
    };
    const count =array_shijian.length;//数量
    const count_2 =array_RCshijian.length;//数量2
    const messages = [
        { text: `共计【${count + count_2}】个事件\n - 开启xxxx\n - 关闭xxxx\n - 开启|关闭全部事件`, name: "[事件管理]", qq: event.self_id }
    ];
    // ================== 循环 - 1 ==================
    for(let i = 0; i < count; i++) {
        let 本次 = array_shijian[i];
        let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, 本次, "关闭");
        if(开关 == "关闭"){
            开关 = "❌关闭";
        }else{
            开关 = "✅开启";
        }
        let 组装消息 = `【${本次}】: ${开关}`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n${data[本次]}`;
        //记录
        messages.push({
            text: 组装消息,
            name: `[${本次}]`,
            qq: event.self_id
        });
    }
    // ================== 循环 - 2 ==================
    for(let i = 0; i < count_2; i++) {
        let 本次 = array_RCshijian[i];
        let 开关 = readB(`筱筱吖/事件系统/全局.json`, 本次, "关闭");
        if(开关 == "关闭"){
            开关 = "❌关闭";
        }else{
            开关 = "✅开启";
        }
        let 组装消息 = `全局【${本次}】: ${开关}`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n${data[本次]}`;
        //记录
        messages.push({
            text: 组装消息,
            name: `[${本次}]`,
            qq: event.self_id
        });
    }
    // ================== 输出 ==================
    await sendForward(event, messages, ctx);
}



if(message == "签到" || message == "打卡"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 读取数据 ==================
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let 今日人数 = readB("筱筱吖/娱乐系统/签到数据/全服记录数量.json", 今天, 0);
    let 累计次数 = readB("筱筱吖/娱乐系统/签到数据/累计次数.json", event.user_id, 0);
    let 签到状态 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/检测.json", event.user_id, "未知");
    let 签到排名 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/排名.json", event.user_id, "未知");
    let 签到详细时间 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/详细时间.json", event.user_id, "未知");
    let 上次签到时间 = readB("筱筱吖/娱乐系统/签到数据/连签记录/上次签到/详细时间.json", event.user_id, 0);
    let 连续签到数量 = readB("筱筱吖/娱乐系统/签到数据/连签记录/连签数量.json", event.user_id, 0);
    
    // ================== 判断是否已打卡 ==================
    if(签到状态 != "未知"){
        let 返回内容 = "❌你今天签到过啦～就算你再怎么发我也不会多给你哒！";
        返回内容 += `\n══════════════`;
        返回内容 += `\n[名次]:第${签到排名}名`;
        返回内容 += `\n[时间]:${签到详细时间}`;
        返回内容 += `\n[累计]:${累计次数}天`;
        返回内容 += `\n[连签]:${连续签到数量}天`;
        返回内容 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
        return null;
    }
    
    // ================== 估算奖励 ==================
    let 名次奖励 = {
        "1" : rand(90, 125),
        "2" : rand(75, 89),
        "3" : rand(50, 74),
        "其他" : rand(15, 49)
    };
    let 本次序号 = 今日人数 + 1;
    let 增加归笺 = 0;
    if(本次序号 <= 3){
        增加归笺 = 名次奖励[本次序号];
    }else{
        增加归笺 = 名次奖励["其他"];
    }
    
    // ================== 先写入 ==================
    let xx_time = timeA("y-m-d H:i:s", Math.floor(Date.now() / 1000));
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 + 增加归笺);
    writeB("筱筱吖/娱乐系统/签到数据/累计次数.json", event.user_id, 累计次数 + 1);
    writeB("筱筱吖/娱乐系统/签到数据/全服记录数量.json", 今天, 本次序号);
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/检测.json", event.user_id, "已签到");
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/排名.json", event.user_id, 本次序号);
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/详细时间.json", event.user_id, xx_time);
    // ================== 写入排名 ==================
    let 排名数据文件 = JSON.parse(readA(`筱筱吖/娱乐系统/签到数据/每日总榜/${今天}.json`) || "[]");
    let 组装json = {};
    组装json["QQ"] = event.user_id;
    组装json["排名"] = 本次序号;
    组装json["获取归笺"] = 增加归笺;
    组装json["签到时间"] = xx_time;
    排名数据文件.push(组装json);
    writeA(`筱筱吖/娱乐系统/签到数据/每日总榜/${今天}.json`, JSON.stringify(排名数据文件));
    
    // ================== 组装消息 ==================
    let 返回内容 = "✅签到成功啦～！";
    返回内容 += `\n══════════════`;
    返回内容 += `\n[归笺] + ${增加归笺}`;
    返回内容 += `\n------------------------`;
    返回内容 += `\n[名次]:第${本次序号}名`;
    返回内容 += `\n[时间]:${xx_time}`;
    返回内容 += `\n[累计]:${累计次数 + 1}天`;
    // ================== 插入内容 ==================
    let 现在时间戳 = Math.floor(Date.now() / 1000);//时间戳秒
    let 时间差 = 现在时间戳 - 上次签到时间;
    if(时间差 > 129600 && 上次签到时间 != 0){
        writeB("筱筱吖/娱乐系统/签到数据/连签记录/连签数量.json", event.user_id, 1);
        返回内容 += `\n[连签]:1天，继续保持哦～`;
    }else if(时间差 > 129600 && 上次签到时间 == 0){
        writeB("筱筱吖/娱乐系统/签到数据/连签记录/连签数量.json", event.user_id, 1);
        返回内容 += `\n[连签]:中断啦！又要重新计算了～`;
    }else{
        writeB("筱筱吖/娱乐系统/签到数据/连签记录/连签数量.json", event.user_id, 连续签到数量 + 1);
        返回内容 += `\n[连签]:连续 ${连续签到数量 + 1} 天,继续保持哟～`;
    }
    writeB("筱筱吖/娱乐系统/签到数据/连签记录/上次签到/详细时间.json", event.user_id, 现在时间戳);
    // ================== 插入结束 ==================
    返回内容 += `\n══════════════`;
    
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}




if(message == "我的货币" || message == "我的归笺" || message == "我的信息"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 银行归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    let 累计签到数量 = readB("筱筱吖/娱乐系统/签到数据/累计次数.json", event.user_id, 0);
    let 连续签到数量 = readB("筱筱吖/娱乐系统/签到数据/连签记录/连签数量.json", event.user_id, 0);
    // ================== 组装消息 ==================
    let 组装消息 = `══════════════`;
    组装消息 += `\n[现有]:${moneyA(归笺)}`;
    组装消息 += `\n[储存]:${moneyA(银行归笺)}`;
    组装消息 += `\n---------------`;
    组装消息 += `\n[累签]:${累计签到数量}天`;
    组装消息 += `\n[连签]:${连续签到数量}天`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}



if(message == "归笺排行榜"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取数据 ==================
    const shuju = JSON.parse(readA("筱筱吖/娱乐系统/游戏数据/归笺.json") || "[]");
    const ranking = Object.entries(shuju)
        .sort((a, b) => b[1] - a[1])
        .map(([人, 值], index) => ({
            排名: index + 1,
            QQ: 人,
            数量: 值
        }));
    const 总人数 = (Object.keys(shuju).length || 0);
    // ================== 判断 ==================
    if(总人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据`, ctx);
        return null;
    }
    // ================== 循环取值 ==================
    let 组装消息 = ``;
    let 本人排名 = "无";
    for(let i = 0; i < 总人数; i++) {
        let 本次QQ = (ranking[i]["QQ"] || "");
        let 本次额度0 = (ranking[i]["数量"] || 0);
        if(本次额度0 <= 0){
            本次额度0 = 0;
        }
        let 本次额度 = moneyA(本次额度0);
        if(本次QQ == event.user_id){
            本人排名 = (ranking[i]["排名"] || "无");
            组装消息 += `\n${i + 1}.【${本次QQ}】: ${本次额度}🟢`;
        }else{
            组装消息 += `\n${i + 1}.【${本次QQ}】: ${本次额度}`;
        }
    }
    // ================== 输出 ==================
    let 返回内容 = `归笺排行榜 - 共【${总人数}】人`;
    返回内容 += `\n你的排名 : ${本人排名}`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    if(总人数 >= 20){
        const messages = [
            { text: 返回内容, name: "[归笺排行榜]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}

if(message == "签到排行榜"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取数据 ==================
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let 数据 = JSON.parse(readA(`筱筱吖/娱乐系统/签到数据/每日总榜/${今天}.json`) || "[]");
    let 数量 = (数据.length || 0);
    // ================== 判断 ==================
    if(数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好像木有排名数据耶～？`, ctx);
        return null;
    }
    // ================== 正式 - 前置==================
    let 组装排名消息 = ``;
    let 发言人的排名 = `无`;
    // ================== 正式 - 循环 ==================
    for(let i = 0; i < 数量; i++) {
        let QQ = 数据[i]["QQ"];
        let 名次 = 数据[i]["排名"];
        let 归笺 = 数据[i]["获取归笺"];
        let 时间 = 数据[i]["签到时间"];
        if(QQ == event.user_id){
            发言人的排名 = 名次;
        }
        if(i < 10){
            组装排名消息 += `\n═════第${名次}名═════`;
            组装排名消息 += `\n[名次] : 第${名次}名`;
            组装排名消息 += `\n[用户] : ${QQ}`;
            组装排名消息 += `\n[获得归笺] : ${归笺}`;
            组装排名消息 += `\n[签到时间] : ${时间}`;
            组装排名消息 += `\n`;
        }
    }
    // ================== 二次组装 ==================
    let 组装消息 = `共计有 ${数量} 位签到用户`;
    组装消息 += `\n仅展示前10位用户`;
    组装消息 += `\n你的排名 : ${发言人的排名}`;
    组装消息 += `\n`;
    组装消息 += 组装排名消息;
    组装消息 += `══════════════`;
    // ================== 输出 ==================
    if(数量 >= 5){
        const messages = [{ text: 组装消息, name: "[签到排行榜]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}


if(message == "存款排行榜" || message == "银行归笺排行榜"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取数据 ==================
    const shuju = JSON.parse(readA("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json") || "[]");
    const ranking = Object.entries(shuju)
        .sort((a, b) => b[1] - a[1])
        .map(([人, 值], index) => ({
            排名: index + 1,
            QQ: 人,
            数量: 值
        }));
    const 总人数 = (Object.keys(shuju).length || 0);
    // ================== 判断 ==================
    if(总人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据`, ctx);
        return null;
    }
    // ================== 循环取值 ==================
    let 组装消息 = ``;
    let 本人排名 = "无";
    for(let i = 0; i < 总人数; i++){
        // ================== 获取用户&货币数量 ==================
        let 本次QQ = (ranking[i]["QQ"] || "");
        let 本次额度0 = (ranking[i]["数量"] || 0);
        // ================== 判断 ==================
        if(本次额度0 <= 0){
            本次额度0 = 0;
        }
        // ================== 利润机制 - 时间换算 ==================
        let 储存时间 = readB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", 本次QQ, 0);
        let 总秒数 = Math.floor(Date.now() / 1000) - 储存时间;//获取出储存秒
        let 总小时 = 总秒数 / 3600;//换算小时
        let 总天数 = 总秒数 / 86400;//换算成天数
        let 利润 = 0;
        if(储存时间 != 0 || 储存时间 != undefined || 总秒数 > 0){
            // ================== 利润机制 - 利息计算 ==================
            let 换算比例 = 2;//如24小时就砍半=12小时，不砍则1
            let 剩余小时数 = Math.floor(总小时 / 换算比例);
            if(剩余小时数 != 0){
                利润 = 本次额度0 * 剩余小时数 * 0.00025;
                if(总天数 >= 3){
                    利润 = 本次额度0 * 剩余小时数 * 0.0008;
                }
                if(总天数 >= 7){
                    利润 = 本次额度0 * 剩余小时数 * 0.001;
                }
                if(总天数 >= 14){
                    利润 = 本次额度0 * 剩余小时数 * 0.0015;
                }
                if(总天数 >= 30){
                    利润 = 本次额度0 * 剩余小时数 * 0.0019;
                }
                利润 = Math.ceil(利润);
            }else{
                利润 = 0;
            }
        }
        // ================== 检 ==================
        let 本次额度 = moneyA(本次额度0 + 利润);
        // ================== 判断本人 ==================
        if(本次QQ == event.user_id){
            本人排名 = (ranking[i]["排名"] || "无");
            组装消息 += `\n${i + 1}.【${本次QQ}】: ${本次额度}🟢`;
        }else{
            组装消息 += `\n${i + 1}.【${本次QQ}】: ${本次额度}`;
        }
    }
    // ================== 输出 ==================
    let 返回内容 = `存款归笺排行榜(含利润) - 共【${总人数}】人`;
    返回内容 += `\n你的排名 : ${本人排名}`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    if(总人数 >= 20){
        const messages = [
            { text: 返回内容, name: "[归笺排行榜]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message == "银行系统"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 组装消息 ==================
    let 返回内容 = `══════════════`;
    返回内容 += `\n存款[数量]`;
    返回内容 += `\n取出[数量]`;
    返回内容 += `\n全部存款 全部取出`;
    返回内容 += `\n══════════════`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}



if(message.match(/^(全部|)(存款|存入)([0-9]+|)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    const one_mub = message.match(/^(全部|)(存款|存入)([0-9]+|)/)[1];
    const three_mub = (message.match(/^(全部|)(存款|存入)([0-9]+|)/)[3] || 0);
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 储存时间 = readB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, 0);
    let 要存的 = 0;
    
    // ================== 判断 - 1==================
    if(one_mub != "" && three_mub != ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这样做可不行哦～全部存款时不可以加指定值哦～`, ctx);
        return null;
    }
    if(one_mub == three_mub){//如果两个都是空的
        return null;
    }
    // ================== 判断 - 2 ==================
    if(one_mub == "全部" && three_mub == ""){
        要存的 = 归笺;
    }
    if(one_mub == "" && three_mub != ""){
        要存的 = Number(three_mub);
    }
    if(要存的 > 归笺){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你现有的归笺好像没有这么多叭～？`, ctx);
        return null;
    }
    if(要存的 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你是0吗？`, ctx);
        return null;
    }
    
    // ================== 写入数据 ==================
    let 归笺2 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 银行2归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 - 要存的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 银行2归笺 + 要存的);
    if(储存时间 == 0 || 储存时间 == undefined){
        writeB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, Math.floor(Date.now() / 1000));
    }
    
    // ================== 组装消息 ==================
    let quc = moneyA(要存的);
    let zgg = moneyA(银行2归笺 + 要存的);
    let 返回内容 = ``;
    返回内容 += `存款成功啦～！`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n[存入]:${quc}`;
    返回内容 += `\n[总共]:${zgg}`;
    返回内容 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    return null;
}


if(message.match(/^(全部|)(取出|取款)([0-9]+|)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    const one_mub = message.match(/^(全部|)(取出|取款)([0-9]+|)/)[1];
    const three_mub = (message.match(/^(全部|)(取出|取款)([0-9]+|)/)[3] || 0);
    let 储存时间 = readB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, 0);
    let 银行_归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    let 要取的 = 0;
    
    // ================== 判断 - 1==================
    if(one_mub != "" && three_mub != ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这样做可不行哦～全部取款时不可以加指定值哦～`, ctx);
        return null;
    }
    if(one_mub == three_mub){//如果两个都是空的
        return null;
    }
    // ================== 判断 - 2 ==================
    if(one_mub == "全部" && three_mub == ""){
        要取的 = 银行_归笺;
    }
    if(one_mub == "" && three_mub != ""){
        要取的 = Number(three_mub);
    }
    if(储存时间 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你好像没有储存过哎～我这里都找不到记录～`, ctx);
        return null;
    }
    if(要取的 > 银行_归笺){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你好像没有这么多叭～？`, ctx);
        return null;
    }
    if(要取的 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你是0吗？`, ctx);
        return null;
    }
    
    // ================== 利润机制 - 时间换算 ==================
    let 总秒数 = Math.floor(Date.now() / 1000) - 储存时间;//获取出储存秒
    let 总小时 = 总秒数 / 3600;//换算小时
    let 总天数 = 总秒数 / 86400;//换算成天数
    if(储存时间 == 0 || 储存时间 == undefined || 总秒数 <= 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]储存时间记录异常！`, ctx);
        return null;
    }
    
    // ================== 利润机制 - 利息计算 ==================
    let 换算比例 = 2;//如24小时就砍半=12小时，不砍则1
    let 剩余小时数 = Math.floor(总小时 / 换算比例);
    let 利润 = 0;
    if(剩余小时数 != 0){
        利润 = 银行_归笺 * 剩余小时数 * 0.00025;
        if(总天数 >= 3){
            利润 = 银行_归笺 * 剩余小时数 * 0.0008;
        }
        if(总天数 >= 7){
            利润 = 银行_归笺 * 剩余小时数 * 0.001;
        }
        if(总天数 >= 14){
            利润 = 银行_归笺 * 剩余小时数 * 0.0015;
        }
        if(总天数 >= 30){
            利润 = 银行_归笺 * 剩余小时数 * 0.0019;
        }
        利润 = Math.ceil(利润);
    }else{
        利润 = 0;
    }
    
    // ================== 重新写入数据 ==================
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 银行2归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 + 利润 + 要取的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 银行2归笺 - 要取的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, Math.floor(Date.now() / 1000));
    
    // ================== 组装消息 ==================
    let hbi = moneyA(利润);
    let quc = moneyA(要取的);
    let 返回内容 = ``;
    返回内容 += `取款成功啦～！`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n[取出]:${quc}`;
    返回内容 += `\n-------------------`;
    返回内容 += `\n[利润]:${hbi}`;
    返回内容 += `\n[时长]:${Number(总小时.toFixed(2))}小时`;
    返回内容 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    return null;
}




if(message === "漂流瓶"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 检 ==================
    let 组装消息 = ``;
    组装消息 += `══════════════`;
    组装消息 += `\n抛瓶子[内容]/[图片]`;
    组装消息 += `\n捞瓶子`;
    组装消息 += `\n我的瓶子`;
    组装消息 += `\n查瓶子[ID]`;
    组装消息 += `\n删瓶子[ID]`;
    组装消息 += `\n赞此瓶子/踩此瓶子`;
    // ================== 检 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}





if(message.match(/^(赞|踩)此瓶子$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 获取基本数据 ==================
    const lx = message.match(/^(赞|踩)此瓶子$/)[1];
    const mub = readB("筱筱吖/娱乐系统/漂流瓶/赞踩/正在进行.json", event.user_id, "无");
    const zt = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/投票状态/${event.user_id}.json`, mub, "未");
    // ================== 判断 ==================
    if(mub == "无"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]请你先捞一下瓶子再弄好嘛？`, ctx);
        return null;
    }
    if(zt == "已"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]这个瓶子你已经操作过啦～！`, ctx);
        return null;
    }
    // ================== 写入 ==================
    const zz = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${mub}.json`, lx, 0);//原数据
    writeB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${mub}.json`, lx, zz + 1);
    writeB(`筱筱吖/娱乐系统/漂流瓶/赞踩/投票状态/${event.user_id}.json`, mub, "已");
    // ================== 输出 ==================
    let 组装消息 = `已对瓶子【${mub}】进行投票啦～！`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}



if(message.match(/^(删|查)瓶子([0-9]+)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 获取数据 ==================
    const ff = message.match(/^(查|删)瓶子([0-9]+)$/)[1];
    const ID = message.match(/^(查|删)瓶子([0-9]+)$/)[2];
    const pz_count = readB("筱筱吖/娱乐系统/漂流瓶/总数据.json", "总数量", 0);
    if(ID == 0 || ID > pz_count){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好像没有这个ID叭～？`, ctx);
        return null;
    }
    // ================== 读取目标文件 ==================
    let 文件数据 = JSON.parse(readA(`筱筱吖/娱乐系统/漂流瓶/瓶子数据/${ID}.json`));
    let 被捞次数 = readB("筱筱吖/娱乐系统/漂流瓶/被打捞次数.json", ID, 0);
    let 上传者QQ = (文件数据["扔的人"] || "");
    // ================== 判断当事人 ==================
    let 权限 = false;
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    if(上传者QQ == event.user_id){
        权限 = true;
    }else if(ownerQQs.includes(event.user_id)){
        权限 = true;//主人特权
    }else{
        权限 = false;
    }
    // ================== 你是什么人 ==================
    if(权限 == false){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]这个瓶子好像不是你的吧～？`, ctx);
        return null;
    }
    
    if(ff == "查"){
        // ================== 最终操作 ==================
        let 组装消息 = "";
        let 瓶子图片数据 = (文件数据["图片数据"] || []);
        let 瓶子图片数量 = 瓶子图片数据.length;
        let 瓶子文本内容 = (文件数据["瓶子内容"] || "");
        let 瓶子扔出时间 = timeA("y-m-d H:i:s", 文件数据["扔出时间"] || Math.floor(Date.now() / 1000));
        // ================== 判断异常 ==================
        if(瓶子文本内容 == "" || 瓶子文本内容.length < 3){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]配置数据异常！`, ctx);
            return null;
        }
        if(瓶子图片数量 != 0){//文本+图片
            组装消息 += `${瓶子文本内容}`;
            for(let i = 0; i < 瓶子图片数量; i++) {
                let 图片链接 = 瓶子图片数据[i];
                if(图片链接 == undefined || 图片链接 == ""){
                continue;
            }
            let imagePath = path.join(getDataPath(), `筱筱吖/娱乐系统/漂流瓶/图片数据/${图片链接}`);
            组装消息 += `[CQ:image,url=${imagePath}]`;
            }
        }else{
            组装消息 += `${瓶子文本内容}`;
        }
        组装消息 += `\n══════════════`;
        组装消息 += `\n[来自]:${上传者QQ}`;
        组装消息 += `\n[时间]:${瓶子扔出时间}`;
        组装消息 += `\n-----------------`;
        组装消息 += `\n[次数]:${被捞次数}`;
        组装消息 += `\n══════════════`;
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
    if(ff == "删"){
        // ================== 读取数据 ==================
        let 总数 = readB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, "总删除", 0);
        let 状态 = readB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, ID, "正常");
        if(状态 != "正常"){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这个瓶子好像本来就没了吧～？`, ctx);
            return null;
        }
        let 组装消息 = `耗的，这就把【${ID}】的瓶子给抹除了！`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        writeB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, "总删除", 总数 + 1);
        writeB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, ID, "异常");
        return null;
    }
}



if(message === "我的瓶子"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 获取数据 ==================
    const pz_count = readB("筱筱吖/娱乐系统/漂流瓶/总数据.json", "总数量", 0);
    
    // ================== 检 ==================
    if(pz_count == 0){
        return null;
    }
    
    // ================== 循环遍历 ==================
    let 有效数量 = 0;
    let 组装消息 = "";
    for(let i = 0; i < pz_count; i++) {
        let 本次ID = i + 1;
        let 文件数据 = JSON.parse(readA(`筱筱吖/娱乐系统/漂流瓶/瓶子数据/${本次ID}.json`));
        let 状态 = readB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, 本次ID, "正常");
        let 上传者QQ = (文件数据["扔的人"] || "");
        // ================== 不是我的 ==================
        if(上传者QQ != event.user_id){
            continue;
        }
        if(状态 != "正常"){
            continue;
        }
        // ================== 是我的 ==================
        有效数量++;
        let 被捞次数 = readB("筱筱吖/娱乐系统/漂流瓶/被打捞次数.json", 本次ID, 0);
        let 瓶子扔出时间 = timeA("y-m-d H:i:s", 文件数据["扔出时间"] || Math.floor(Date.now() / 1000));
        let dd = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${本次ID}.json`, "赞", 0);
        let cc = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${本次ID}.json`, "踩", 0);
        组装消息 += `\n【${本次ID}】`;
        组装消息 += `\n - [浏览] : ${被捞次数}次`;
        组装消息 += `\n - [时间] : ${瓶子扔出时间}`;
        组装消息 += `\n - [赞]:${dd}      [踩]:${cc}`;
        组装消息 += `\n`;
    }
    
    // ================== 输出前验证 ==================
    if(有效数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有找到你的瓶子哎～`, ctx);
        return null;
    }
    let 返回内容 = `你共有「${有效数量}」个瓶子\n══════════════` + 组装消息 + `══════════════`;
    if(有效数量 >= 7){
        const messages = [
            { text: 返回内容, name: "[我的瓶子]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}





if(message.match(/^抛瓶子/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 获取数据 ==================
    const fullText = giveText(event.message);
    const text = fullText.replace(/^抛瓶子/, "").trim();//内容
    const image = giveImages(event.message);//图片链接
    const image_count = image.length;//图片数
    const text_count = text.length;//字数
    const lineCount = text.split('\n').length;//文本行数
    // ================== 判断 ==================
    if((text == "" || text == undefined) && image_count == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]无内容`, ctx);
        return null;
    }
    if(text_count < 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]请包含至少三个字！`, ctx);
        return null;
    }
    if(lineCount > 11 || image_count > 5 || text_count > 500){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]请将内容控制在11行，500字，5图片范围内！`, ctx);
        return null;
    }
    
    // ================== 执行前置 ==================
    let 数据 = {};
    // ================== 仅文字 ==================
    if(text != "" && image_count == 0){
        数据 = {"扔的人":event.user_id, "瓶子内容":text, "扔出时间":Math.floor(Date.now() / 1000)};
        
    // ================== 文字+图片 ==================
    }else if(text != "" && image_count != 0){
        let 图片数据 = [];
        let 组装消息 = ``;
        // ================== 获取图片1 ==================
        for(let i = 0; i < image_count; i++) {
            let 随机ID = rand(10000000, 999999999);
            组装消息 += `\n图片${i}`;
            组装消息 += `[CQ:image,url=${image[i]}]`;
            图片数据.push(`${随机ID}.png`);
            downloadFile(image[i], `筱筱吖/娱乐系统/漂流瓶/图片数据/${随机ID}.png`);
        }
        数据 = {"扔的人":event.user_id, "瓶子内容":text, "图片数据":图片数据, "扔出时间":Math.floor(Date.now() / 1000)};
        
    }else{// ================== 错误返回 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]未知错误`, ctx);
        return null;
    }
    
    // ================== 获取瓶子数据 ==================
    const pz_count = readB("筱筱吖/娱乐系统/漂流瓶/总数据.json", "总数量", 0);
    writeB(`筱筱吖/娱乐系统/漂流瓶/总数据.json`, "总数量", pz_count + 1);
    writeA(`筱筱吖/娱乐系统/漂流瓶/瓶子数据/${pz_count + 1}.json`, JSON.stringify(数据));
    
    // ================== 输出结果 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]抛成功啦～！\n你的瓶子ID是:${pz_count + 1}`, ctx);
    /*
    // ================== 调试 ==================
    let 组装消息2 = ``;
    组装消息2 += `图片数量:${image_count}`;
    组装消息2 += `\n图片列表:${JSON.stringify(image)}`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息2}`, ctx);
    */
    return null;
}



if(message.match(/^(捞瓶子|捡瓶子)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 读取数据 ==================
    const pz_count = readB("筱筱吖/娱乐系统/漂流瓶/总数据.json", "总数量", 0);
    
    // ================== 判断 ==================
    if(pz_count < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]瓶子数量不足以运行本功能？`, ctx);
        return null;
    }
    
    // ================== 正常找瓶子 ==================
    let 错误次数 = 0;
    let 最大错误次数 = 5;
    let uxx = false;
    let 组装消息 = ``;
    for(let i = 0; i < pz_count; i++) {
        if(错误次数 >= 最大错误次数){
            uxx = false;
            break;
        }
        let 随机数 = rand(1, pz_count);
        let 状态 = readB(`筱筱吖/娱乐系统/漂流瓶/删除的.json`, 随机数, "正常");
        let 文件数据 = JSON.parse(readA(`筱筱吖/娱乐系统/漂流瓶/瓶子数据/${随机数}.json`));
        let 被捞次数 = readB("筱筱吖/娱乐系统/漂流瓶/被打捞次数.json", 随机数, 0);
        let 上传者QQ = (文件数据["扔的人"] || "");
        let 瓶子图片数据 = (文件数据["图片数据"] || []);
        let 瓶子图片数量 = 瓶子图片数据.length;
        let 瓶子文本内容 = (文件数据["瓶子内容"] || "");
        let 瓶子扔出时间 = timeA("y-m-d H:i:s", 文件数据["扔出时间"] || Math.floor(Date.now() / 1000));
        //判断
        if(状态 != "正常"){
            错误次数++;
            continue;
        }
        if(瓶子文本内容 == "" || 瓶子文本内容.length < 3){
            错误次数++;
            continue;
            
        }else if(瓶子图片数量 != 0){//文本+图片
            组装消息 += `${瓶子文本内容}`;
            for(let i = 0; i < 瓶子图片数量; i++) {
                let 图片链接 = 瓶子图片数据[i];
                if(图片链接 == undefined || 图片链接 == ""){
                    continue;
                }
                let imagePath = path.join(getDataPath(), `筱筱吖/娱乐系统/漂流瓶/图片数据/${图片链接}`);
                组装消息 += `[CQ:image,url=${imagePath}]`;
            }
        }else{
            组装消息 += `${瓶子文本内容}`;
        }
        uxx = true;
        let dd = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${随机数}.json`, "赞", 0);
        let cc = readB(`筱筱吖/娱乐系统/漂流瓶/赞踩/${随机数}.json`, "踩", 0);
        writeB("筱筱吖/娱乐系统/漂流瓶/被打捞次数.json", 随机数, 被捞次数 + 1)
        writeB("筱筱吖/娱乐系统/漂流瓶/赞踩/正在进行.json", event.user_id, 随机数);
        组装消息 += `\n══════════════`;
        组装消息 += `\n[来自]:${上传者QQ}`;
        组装消息 += `\n[时间]:${瓶子扔出时间}`;
        组装消息 += `\n-----------------`;
        组装消息 += `\n[被捞]:${被捞次数 + 1}次`;
        组装消息 += `\n[赞]:${dd}      [踩]:${cc}`;
        组装消息 += `\n══════════════`;
        break;
    }
    
    // ================== 输出 ==================
    if(uxx == false){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]多次打捞都找不到～(∩ᵒ̴̶̷̤⌔ᵒ̴̶̷̤∩)`, ctx);
        return null;
    }
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}


if(message == "音乐功能" || message == "音乐系统" || message == "音乐菜单"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息1 ==================
    let 组装消息1 = `MK - 音乐系统 - ${RC_music_bbh}`;
    
    let 组装消息2 = `点歌使用例子↓`;
    组装消息2 += `\n══════════════`;
    组装消息2 += `\n - 点歌小团圆`;
    组装消息2 += `\n - QQ点歌小团圆`;
    组装消息2 += `\n - 汽水点歌小团圆`;
    组装消息2 += `\n - 酷我点歌小团圆`;
    组装消息2 += `\n - 网易云点歌小团圆`;
    组装消息2 += `\n══════════════`;
    
    let 组装消息3 = `选歌使用例子↓`;
    组装消息3 += `\n══════════════`;
    组装消息3 += `\n - 选歌1`;
    组装消息3 += `\n - 卡片选歌1`;
    组装消息3 += `\n - 语音选歌1`;
    组装消息3 += `\n - 链接选歌1`;
    组装消息3 += `\n══════════════`;
    
    let 组装消息4 = `收藏操作`;
    组装消息4 += `\n══════════════`;
    组装消息4 += `\n - 个人歌单`;
    组装消息4 += `\n - 收藏歌曲1`;
    组装消息4 += `\n - 取消收藏2`;
    组装消息4 += `\n - 取消收藏3-5`;
    组装消息4 += `\n - 播放收藏6`;
    组装消息4 += `\n - 卡片播放收藏7`;
    组装消息4 += `\n - 语音播放收藏8`;
    组装消息4 += `\n - 链接播放收藏9`;
    组装消息4 += `\n - 清空个人收藏歌曲`;
    组装消息4 += `\n══════════════`;
    // ================== 组装消息2 ==================
    let 尾声1 = `【接口提供来源】`;
    尾声1 += `\n「汽水点歌」笒鬼鬼API: https://api.cenguigui.cn/`;
    尾声1 += `\n「酷我点歌」OIAPI: https://oiapi.net/`;
    尾声1 += `\n「网易云点歌」OIAPI: https://oiapi.net/`;
    尾声1 += `\n「QQ点歌」云汐API: https://a.aa.cab/`;
    // ================== 组装消息3 ==================
    let 尾声2 = `声明\n══════════════`;
    尾声2 += `\n【1】选歌时可能会有点慢，如超30秒没回复才算无效`;
    尾声2 += `\n【2】如有接口失效/更好的接口推荐，可联系更换`;
    尾声2 += `\n【3】`;
    尾声2 += `\n【4】`;
    尾声2 += `\n【5】`;
    // ================== 输出 ==================
    const messages = [
        { text: 组装消息1, name: "[音乐系统]", qq: event.self_id },
        { text: 组装消息2, name: "[音乐系统]", qq: event.self_id },
        { text: 组装消息3, name: "[音乐系统]", qq: event.self_id },
        { text: 组装消息4, name: "[音乐系统]", qq: event.self_id },
        { text: 尾声1, name: "[音乐系统]", qq: event.self_id },
        { text: 尾声2, name: "[音乐系统]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
    return null;
}


if(message.match(/^(酷我|汽水|网易云|QQ|)点歌([\s\S]*)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取基础值 ==================
    const yinyuan_0 = message.match(/^(酷我|汽水|网易云|QQ|)点歌([\s\S]*)$/)[1];
    const dd_name = message.match(/^(酷我|汽水|网易云|QQ|)点歌([\s\S]*)$/)[2];
    const text_count = dd_name.length;
    
    // ================== 事先判断 ==================
    if(dd_name == "" || text_count == 0 || text_count == undefined || dd_name == undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你是在点歌嘛？`, ctx);
        return null;
    }
    // ================== 获取音源 ==================
    let 音源 = "汽水";
    if(yinyuan_0 != ""){
        音源 = yinyuan_0;
        writeB("筱筱吖/音乐系统/使用音源.json", event.user_id, yinyuan_0);
    }else{
        音源 = readB("筱筱吖/音乐系统/使用音源.json", event.user_id, "汽水");
    }
    // ================== 检 ==================
    const CNMB = {
        "QQ":`https://a.aa.cab/qq.music?msg=${dd_name}&num=10`,
        "汽水":`https://api-v2.cenguigui.cn/api/qishui/?msg=${dd_name}&type=json&n=`,
        "酷我":`https://oiapi.net/api/Kuwo?msg=${dd_name}&n=&limit=10`,
        "网易云":`https://oiapi.net/api/Music_163?name=${dd_name}&limit=20`
    };
    const API = CNMB[音源];
    // ================== 访问接口 ==================
    const response = await fetch(API);
    const API_shuju = await response.json();
    //writeA(`测试.json`, JSON.stringify(API_shuju));
    // ================== 解析各种音源 - 前置==================
    let jieguo_数量 = (API_shuju["data"].length || 0);
    let jieguo_组装消息 = "";
    if(jieguo_数量 == 0 || jieguo_数量 == undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]接口取值异常！`, ctx);
        return null;
    }
    writeB("筱筱吖/音乐系统/选歌范围.json", event.user_id, jieguo_数量);
    writeB("筱筱吖/音乐系统/点歌名字.json", event.user_id, dd_name);
    let 组装消息 = "══════════════";
    组装消息 += `\n当前为【${音源}】点歌，共${jieguo_数量}首`;
    组装消息 += `\n══════════════`;
    let json数据 = {};
    let lisnl数据 = [];
    json数据["音源"] = 音源;
    // ================== 解析各种音源 - 执行==================
    if(音源 == "汽水"){
        // ================== 循环 ==================
        for(let i = 0; i < jieguo_数量; i++) {
            let 本次序号 = i + 1;
            let 歌名 = (API_shuju["data"][i]["title"] || "");
            let 歌手 = (API_shuju["data"][i]["singer"] || "");
            组装消息 += `\n${本次序号}.${歌名}---${歌手}`;
            lisnl数据.push({"歌名":歌名,"歌手":歌手});
        }
        组装消息 += `\n══════════════`;
    }else if(音源 == "酷我"){
        // ================== 循环 ==================
        for(let i = 0; i < jieguo_数量; i++) {
            let 本次序号 = i + 1;
            let 歌名 = (API_shuju["data"][i]["song"] || "");
            let 歌手 = (API_shuju["data"][i]["singer"] || "");
            组装消息 += `\n${本次序号}.${歌名}---${歌手}`;
            lisnl数据.push({"歌名":歌名,"歌手":歌手});
        }
        组装消息 += `\n══════════════`;
    }else if(音源 == "QQ"){
        // ================== 循环 ==================
        for(let i = 0; i < jieguo_数量; i++) {
            let 本次序号 = i + 1;
            let 歌名 = (API_shuju["data"][i]["song"] || "");
            let 歌手 = (API_shuju["data"][i]["singer"] || "");
            组装消息 += `\n${本次序号}.${歌名}---${歌手}`;
            lisnl数据.push({"歌名":歌名,"歌手":歌手});
        }
        组装消息 += `\n══════════════`;
    }else if(音源 == "网易云"){
        // ================== 循环 ==================
        for(let i = 0; i < jieguo_数量; i++) {
            let 本次序号 = i + 1;
            let 歌名 = (API_shuju["data"][i]["name"] || "");
            let 歌手 = (API_shuju["data"][i]["singers"][0]["name"] || "");
            组装消息 += `\n${本次序号}.${歌名}---${歌手}`;
            lisnl数据.push({"歌名":歌名,"歌手":歌手});
        }
        组装消息 += `\n══════════════`;
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]未知类型报错！`, ctx);
        return null;
    }
    // ================== 写入 ==================
    json数据["data"] = lisnl数据;
    //sendReply(event, `${JSON.stringify(json数据)}`, ctx);//调试
    writeA(`筱筱吖/音乐系统/临时歌单/${event.user_id}.json`, JSON.stringify(json数据));
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}



if(message.match(/^(链接|卡片|语音|)选歌([0-9]+)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取基础值 ==================
    const ffff = message.match(/^(链接|卡片|语音|)选歌([0-9]+)$/)[1];
    const mub = message.match(/^(链接|卡片|语音|)选歌([0-9]+)$/)[2];
    const zuida = readB("筱筱吖/音乐系统/选歌范围.json", event.user_id, 0);
    const dd_name = readB("筱筱吖/音乐系统/点歌名字.json", event.user_id, "九尾狐");
    const music_cc = readB("筱筱吖/音乐系统/使用音源.json", event.user_id, "汽水");
    
    // ================== 事先判断 ==================
    if(mub == 0 || mub > zuida){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]可选范围异常，当前你可选范围为【${zuida}】`, ctx);
        return null;
    }
    // ================== 获取方法 ==================
    let 方法 = "卡片";
    if(ffff != ""){
        方法 = ffff;
    }else{
        方法 = "卡片";
    }
    // ================== 检 ==================
    const CNMB = {
        "QQ":`https://a.aa.cab/qq.music?msg=${dd_name}&num=10&n=${mub}`,
        "汽水":`https://api-v2.cenguigui.cn/api/qishui/?msg=${dd_name}&type=json&n=${mub}`,
        "酷我":`https://oiapi.net/api/Kuwo?msg=${dd_name}&n=${mub}&limit=10`,
        "网易云":`https://oiapi.net/api/Music_163?name=${dd_name}&limit=20&n=${mub}`
    };
    const API = CNMB[music_cc];
    // ================== 访问接口 ==================
    const response = await fetch(API);
    const API_shuju = await response.json();
    //writeA(`测试1.json`, JSON.stringify(API_shuju));
    // ================== 解析各种音源 - 前置==================
    let 歌名 = "";
    let 歌手 = "";
    let 封面 = "";
    let 链接 = "";
    // ================== 解析各种音源 - 执行 ==================
    if(music_cc == "汽水"){
        歌名 = API_shuju["data"]["title"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["cover"];
        链接 = API_shuju["data"]["music"];
        
    }else if(music_cc == "酷我"){
        歌名 = API_shuju["data"]["song"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["picture"];
        链接 = API_shuju["data"]["url"];
        
    }else if(music_cc == "QQ"){
        歌名 = API_shuju["data"]["song"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["cover"];
        链接 = API_shuju["data"]["music"];
        
    }else if(music_cc == "网易云"){
        歌名 = API_shuju["data"]["name"];
        歌手 = API_shuju["data"]["singers"][0]["name"];
        封面 = API_shuju["data"]["picurl"];
        链接 = API_shuju["data"]["url"];
        
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]未知类型报错！`, ctx);
        return null;
    }
    
    // ================== 输出方式 ==================
    if(方法 == "卡片"){
        const musicCard = `[CQ:music,type=custom,url=${链接},audio=${链接},title=${歌名},content=${歌手},image=${封面}]`;
        await sendReply(event, musicCard, ctx);
        
    }else if(方法 == "链接"){
        let 组装输出 = `[CQ:image,url=${封面}]`;
        组装输出 += `\n歌名:${歌名}`;
        组装输出 += `\n歌手:${歌手}`;
        组装输出 += `\n音频链接:\n${链接}`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装输出}`, ctx);
    }else if(方法 == "语音"){
        await sendReply(event, `[CQ:record,url=${链接}]`, ctx);
    }
    return null;
}


if(message.match(/^(我的收藏|个人歌单)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取基础值 ==================
    let 歌单文件 = JSON.parse(readA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`) || "[]");
    
    // ================== 事先判断 ==================
    let cn = 歌单文件;
    if(cn == undefined || cn == ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据:${JSON.stringify(歌单文件)}\n请确认歌单正确！`, ctx);
        return null;
    }
    if(歌单文件 == [] || 歌单文件 == "[]" || 歌单文件 == undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]数据无效，可能是文件缺失或语法错误！0`, ctx);
        return null;
    }
    let 数量 = (歌单文件.length || 0);
    if(数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]歌单文件数量为0`, ctx);
        return null;
    }
    // ================== 循环 - 前置 ==================
    let 返回内容 = ``;
    // ================== 循环 ==================
    for(let i = 0; i < 数量; i++) {
        let 音源 = 歌单文件[i]["音源"]
        let 歌名 = 歌单文件[i]["歌名"];
        let 歌手 = 歌单文件[i]["歌手"];
        返回内容 += `\n${i+1}.[${音源}]${歌名} --- ${歌手}`;
    }
    // ================== 组装消息 ==================
    let 组装消息 = `共计【${数量}】首收藏歌曲`;
    组装消息 += `\n══════════════`;
    组装消息 += 返回内容;
    组装消息 += `\n══════════════`;
    // ================== 输出 ==================
    if(数量 >= 15){
        const messages = [{ text: 组装消息, name: "[个人歌单]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}


if(message.match(/^(收藏音乐|收藏歌曲|取消收藏)([0-9]+)(-|_|.|)([0-9]+|)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取数据 ==================
    const 搜索数据 = readB("筱筱吖/音乐系统/点歌名字.json", event.user_id, "九尾狐");
    let 歌单文件 = JSON.parse(readA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`) || "[]");
    const 临时数据 = JSON.parse(readA(`筱筱吖/音乐系统/临时歌单/${event.user_id}.json`) || "[]");
    const 执行操作 = message.match(/^(收藏音乐|收藏歌曲|取消收藏)([0-9]+)(-|_|.|)([0-9]+|)$/)[1];
    const 选择序号1 = Number(message.match(/^(收藏音乐|收藏歌曲|取消收藏)([0-9]+)(-|_|.|)([0-9]+|)$/)[2]);
    const 选择序号2 = Number(message.match(/^(收藏音乐|收藏歌曲|取消收藏)([0-9]+)(-|_|.|)([0-9]+|)$/)[4]);
    //await sendReply(event, `[CQ:reply,id=${event.message_id}]临时:${JSON.stringify(临时数据)}`, ctx);//调试
    // ================== 收藏歌曲 ==================
    if(执行操作 == "收藏歌曲" || 执行操作 == "收藏音乐"){
    let cnm = 临时数据?.data;
        if(cnm == undefined || cnm == ""){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据:${JSON.stringify(临时数据)}\n请先点歌再操作！`, ctx);
            return null;
        }
        if(临时数据 == [] || 临时数据 == "[]" || 临时数据 == undefined){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]数据无效，可能是文件缺失或语法错误！0`, ctx);
            return null;
        }
        // ================== 判断 ==================
        let 数量 = (临时数据["data"].length || 0);
        if(数量 == 0){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]数据无效，可能是文件缺失或语法错误！1`, ctx);
            return null;
        }
        if(选择序号1 == 0 || 选择序号1 > 数量){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]选取范围无效哦！`, ctx);
            return null;
        }
        // ================== 执行收藏 ==================
        let json数据 = {};
        json数据["搜索"] = 搜索数据;
        json数据["序号"] = 选择序号1;
        json数据["音源"] = 临时数据["音源"];
        json数据["歌名"] = 临时数据["data"][选择序号1-1]["歌名"];
        json数据["歌手"] = 临时数据["data"][选择序号1-1]["歌手"];
        歌单文件.push(json数据);
        writeA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`, JSON.stringify(歌单文件));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已收藏改歌曲:\n${临时数据["data"][选择序号1 - 1]["歌名"]}----${临时数据["data"][选择序号1 - 1]["歌手"]}`, ctx);
        return null;
        
    // ================== 取消收藏 ==================
    }else{
        let cn = 歌单文件;
        if(cn == undefined || cn == ""){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据:${JSON.stringify(歌单文件)}\n请确认歌单正确！`, ctx);
            return null;
        }
        if(歌单文件 == [] || 歌单文件 == "[]" || 歌单文件 == undefined){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]数据无效，可能是文件缺失或语法错误！0`, ctx);
            return null;
        }
        // ================== 判断 ==================
        let 数量 = (歌单文件.length || 0);
        if(数量 == 0){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]歌单文件数量为0`, ctx);
            return null;
        }
        if(选择序号2 && (选择序号1 > 数量 || 选择序号1 > 选择序号2 || 选择序号1 == 选择序号2)){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]范围无效哟～0|${数量}`, ctx);
            return null;
        }
        if(选择序号1 == 0 || (选择序号2 && 选择序号2 == 0)){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]范围无效哟～1|${数量}`, ctx);
            return null;
        }
        if(选择序号1 > 数量 || 选择序号2 > 数量){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]范围无效哟～3|${数量}`, ctx);
            return null;
        }
        // ================== 执行删除 - 前置 ==================
        let 范围 = 1;
        let 返回内容 = ``;
        if(选择序号1 > 选择序号2){
            范围 = 1;
        }else if(选择序号2 > 选择序号1){
            范围 = 选择序号2 - 选择序号1 + 1;
        }else if(选择序号2 == 0){
            范围 = 1;
        }else{
            范围 = 1;
        }
        // ================== 获取列表 - 循环 ==================
        for(let i = 选择序号1 - 1; i < 选择序号1 - 1 + 范围; i++){
            let 音源 = 歌单文件[i]["音源"]
            let 歌名 = 歌单文件[i]["歌名"];
            let 歌手 = 歌单文件[i]["歌手"];
            返回内容 += `\n${i+1}.[${音源}]${歌名} --- ${歌手}`;
        }
        // ================== 删除&输出 ==================
        歌单文件.splice(选择序号1 - 1, 范围);//删除几个
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已删除${选择序号1}|${选择序号2}\n══════════════${返回内容}\n══════════════`, ctx);
        writeA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`, JSON.stringify(歌单文件));
    }
    return null;
}


if(message.match(/^清空个人收藏(音乐|歌曲)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 检 ==================
    writeA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`, "[]");
    await sendReply(event, `[CQ:reply,id=${event.message_id}]好叭，这就把你的歌单给清空空！`, ctx);
    return null;
}


if(message.match(/^(链接|卡片|语音|)播放收藏([0-9]+)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 获取基础值 ==================
    const 方式 = message.match(/^(链接|卡片|语音|)播放收藏([0-9]+)$/)[1];
    const 序号 = message.match(/^(链接|卡片|语音|)播放收藏([0-9]+)$/)[2];
    let 歌单文件 = JSON.parse(readA(`筱筱吖/音乐系统/音乐收藏/${event.user_id}.json`) || "[]");
    
    // ================== 事先判断 ==================
    let cn = 歌单文件;
    if(cn == undefined || cn == ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据:${JSON.stringify(歌单文件)}\n请确认歌单正确！`, ctx);
        return null;
    }
    if(歌单文件 == [] || 歌单文件 == "[]" || 歌单文件 == undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]数据无效，可能是文件缺失或语法错误！0`, ctx);
        return null;
    }
    let 数量 = (歌单文件.length || 0);
    if(数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]歌单文件数量为0`, ctx);
        return null;
    }
    if(序号 == 0 || 序号 > 数量){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]可选范围异常！请仔细查看收藏数量！\n当前可选范围【${数量}】`, ctx);
        return null;
    }
    // ================== 获取方法 ==================
    let 方法 = "卡片";
    if(方式 != ""){
        方法 = 方式;
    }else{
        方法 = "卡片";
    }
    // ================== 检 ==================
    const dd_name = 歌单文件[序号-1]["搜索"];
    const mub = 歌单文件[序号-1]["序号"];
    const music_cc = 歌单文件[序号-1]["音源"];
    const CNMB = {
        "QQ":`https://a.aa.cab/qq.music?msg=${dd_name}&num=10&n=${mub}`,
        "汽水":`https://api-v2.cenguigui.cn/api/qishui/?msg=${dd_name}&type=json&n=${mub}`,
        "酷我":`https://oiapi.net/api/Kuwo?msg=${dd_name}&n=${mub}&limit=10`,
        "网易云":`https://oiapi.net/api/Music_163?name=${dd_name}&limit=20&n=${mub}`
    };
    const API = CNMB[music_cc];
    // ================== 访问接口 ==================
    const response = await fetch(API);
    const API_shuju = await response.json();
    //writeA(`测试1.json`, JSON.stringify(API_shuju));
    // ================== 解析各种音源 - 前置==================
    let 歌名 = "";
    let 歌手 = "";
    let 封面 = "";
    let 链接 = "";
    // ================== 解析各种音源 - 执行 ==================
    if(music_cc == "汽水"){
        歌名 = API_shuju["data"]["title"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["cover"];
        链接 = API_shuju["data"]["music"];
        
    }else if(music_cc == "酷我"){
        歌名 = API_shuju["data"]["song"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["picture"];
        链接 = API_shuju["data"]["url"];
        
    }else if(music_cc == "QQ"){
        歌名 = API_shuju["data"]["song"];
        歌手 = API_shuju["data"]["singer"];
        封面 = API_shuju["data"]["cover"];
        链接 = API_shuju["data"]["music"];
        
    }else if(music_cc == "网易云"){
        歌名 = API_shuju["data"]["name"];
        歌手 = API_shuju["data"]["singers"][0]["name"];
        封面 = API_shuju["data"]["picurl"];
        链接 = API_shuju["data"]["url"];
        
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]未知类型报错！`, ctx);
        return null;
    }
    
    // ================== 输出方式 ==================
    if(方法 == "卡片"){
        const musicCard = `[CQ:music,type=custom,url=${链接},audio=${链接},title=${歌名},content=${歌手},image=${封面}]`;
        await sendReply(event, musicCard, ctx);
    }else if(方法 == "链接"){
        let 组装输出 = `[CQ:image,url=${封面}]`;
        组装输出 += `\n歌名:${歌名}`;
        组装输出 += `\n歌手:${歌手}`;
        组装输出 += `\n音频链接:\n${链接}`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装输出}`, ctx);
    }else if(方法 == "语音"){
        await sendReply(event, `[CQ:record,url=${链接}]`, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]伪造类型报错v`, ctx);
    }
    return null;
}














if(message == "邀人统计"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息 ==================
    let 组装消息 = `══════════════`;
    组装消息 += `\n相关事件【邀人统计】`;
    组装消息 += `\n══════════════`;
    组装消息 += `\n - 邀人排行榜`;
    组装消息 += `\n - 查看我的邀请`;
    组装消息 += `\n══════════════`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}


if(message == "查看我的邀请"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    let 统计开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "邀人统计", "关闭");
    let BQ_yqr = readB(`筱筱吖/扩展功能/邀人统计/${event.group_id}/绑定数据.json`, event.user_id, "无");
    let BQ_yqr数据 = JSON.parse(readA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/${event.user_id}.json`) || "[]");
    // ================== 判断 ==================
    if(统计开关 != "开启"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]本群的统计好像没开启唉～`, ctx);
        return null;
    }
    let 数量 = (BQ_yqr数据.length || 0);
    if(数量 == 0){
        let 组装消息 = `我好像没有找到你的邀请数据哎～？`;
        if(BQ_yqr != "无"){
            组装消息 += `\n但是找到了你在本群的邀请人是【${BQ_yqr}】`;
        }
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
    // ================== 循环 ==================
    let 返回内容 = `你共有【${数量}】人次记录`;
    返回内容 += `\n══════════════`;
    for(let i = 0; i < 数量; i++) {
        let 本次QQ = BQ_yqr数据[i];
        let 时间 = timeA("y-m-d H:i:s", readB(`筱筱吖/扩展功能/邀人统计/${event.group_id}/被绑时间.json`, 本次QQ, Math.floor(Date.now() / 1000)));
        返回内容 += `\n「${i + 1}」【${本次QQ}】`;
        返回内容 += `\n[进群时间]:${时间}`;
        返回内容 += `\n`;
    }
    返回内容 += `══════════════`;
    // ================== 输出 ==================
    if(数量 >= 7){
        const messages = [
            { text: 返回内容, name: `[${event.user_id}的邀人统计]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}




if(message == "邀人排行榜"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 循环1 - 获取数据 ==================
    let zzzzz = JSON.parse(readA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/邀请官.json`) || "[]");
    let z数量 = (zzzzz.length || 0);
    //循环
    let zdata = {};
    for(let i = 0; i < z数量; i++) {
        let 本次QQ = zzzzz[i];
        let 本次人数_文件 = JSON.parse(readA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/${本次QQ}.json`) || "[]");
        let 本次人数 = (本次人数_文件.length || 0);
        zdata[本次QQ] = 本次人数;
    }
    //await sendReply(event, `${JSON.stringify(zdata)}`, ctx);//调试输出
    // ================== 降序排列 ==================
    const ranking = Object.entries(zdata)
        .sort((a, b) => b[1] - a[1])
        .map(([人, 值], index) => ({
            排名: index + 1,
            QQ: 人,
            数量: 值
        }));
    const 总人数 = (Object.keys(zdata).length || 0);
    // ================== 判断 ==================
    if(总人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]无数据`, ctx);
        return null;
    }
    // ================== 循环取值 ==================
    let 组装消息 = ``;
    let 本人排名 = "无";
    let 总邀请统计 = 0;
    for(let i = 0; i < 总人数; i++) {
        let 本次QQ = (ranking[i]["QQ"] || "");
        let 本次额度 = (ranking[i]["数量"] || 0);
        let 排名小表情 = "🏅";
        if(i+1 == 1){
            排名小表情 = "🥇";
        }else if(i+1 == 2){
            排名小表情 = "🥈";
        }else if(i+1 == 3){
            排名小表情 = "🥉";
        }else if(i+1 > 3 && i+1 <= 10){
            排名小表情 = "🏅";
        }else{
            排名小表情 = `${i + 1}.`;
        }
        // ================== 检 ==================
        组装消息 += `\n${排名小表情}【${本次QQ}】: ${本次额度}人`;
        总邀请统计 += 本次额度;
        if(本次QQ == event.user_id){
            本人排名 = (ranking[i]["排名"] || "无");
        }
    }
    // ================== 输出 ==================
    let 返回内容 = `邀人排行榜 - 共【${总人数}】位邀请官`;
    返回内容 += `\n总邀请人数【${总邀请统计}】你的排名 : ${本人排名}`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    if(总人数 >= 20){
        const messages = [
            { text: 返回内容, name: "[归笺排行榜]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}


if(message === "今日运势"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 获取数据 ==================
    const 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    const 今日我的 = JSON.parse(readB(`筱筱吖/娱乐系统/今日运势/${今天}.json`, event.user_id, "{}"));
    const 数据 = JSON.parse(readA("html/text/运势.json") || "[]");
    const 图片数据 = JSON.parse(readA("html/text/URL.json") || "[]");
    const 数据_count = (数据.length || 0);
    const 图片数据_count = (图片数据.length || 0);
    // ================== 选取数据 ==================
    let 序号 = 0;
    let 图片序号 = 0;
    let json数据 = {};
    if(!今日我的 || Object.keys(今日我的).length == 0){
        序号 = rand(0, 数据_count - 1);
        图片序号 = rand(0, 图片数据_count);
        json数据["文本"] = 序号;
        json数据["图片"] = 图片序号;
        writeB(`筱筱吖/娱乐系统/今日运势/${今天}.json`, event.user_id, JSON.stringify(json数据));
    }else{
        序号 = 今日我的["文本"];
        图片序号 = 今日我的["图片"];
    }
    // ================== 取值 ==================
    let 标题 = 数据[序号]["Sorte"];
    let 星数 = 数据[序号]["Estrelas"];
    let 附言 = 数据[序号]["signText"];
    let 细附 = 数据[序号]["unSignText"];
    let 图片 = 图片数据[图片序号];
    /*
    //调试
    let dd = 数据[1];
    sendReply(event, `输出${JSON.stringify(dd)}.....${数据_count}....${图片数据_count}.........${序号}.......${JSON.stringify(今日我的)}........${图片}`, ctx);
    */
    // ================== 正常输出 ==================
    let 发送方式 = readB("config.json", "cs_of", false);
    if(发送方式 == false){
        let 组装消息 = `✦•┈┈┈┈┈┈┈┈┈┈┈•✦`;
        组装消息 += `\n🜲 今日运势 🜲`;
        组装消息 += `\n✦•┈┈┈┈┈┈┈┈┈┈┈•✦`;
        组装消息 += `\n[运势]:${标题}`;
        组装消息 += `\n[星级]:${星数}`;
        组装消息 += `\n[签文]:${附言}`;
        组装消息 += `\n[解签]:${细附}`;
        组装消息 += `\n✦•┈┈┈┈┈┈┈┈┈┈┈•✦`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }else{
        sendReply(event, `[CQ:reply,id=${event.message_id}]正在获取图片，请稍等哟～`, ctx);
    // ================== 检 ==================
        try {
            // 获取当前日期
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}/${month}/${day}`;
            // 构建渲染数据
            const renderData = {
                qq: String(event.user_id),
                time: dateStr,
                Sorte: 标题 || "大吉",
                Estrelas: 星数 || "★★★★★★★",
                signText: 附言 || "福星高照，万事如意",
                unSignText: 细附 || "此签为大吉之兆",
                image_name: String(图片)
            };
            // 调用 Puppeteer 渲染
            const htmlContent = readA("html/今日运势.html");
            const imageData = await puppeteer(htmlContent, {
                data: renderData,
                width: 720,
                height: 1280
            });
            if (imageData) {
                // 发送渲染后的图片
                await sendReply(event, `[CQ:reply,id=${event.message_id}][CQ:image,file=base64://${imageData}]`, ctx);
            } else {
                await sendReply(event, `[CQ:reply,id=${event.message_id}]渲染失败，请检查 Puppeteer 服务是否运行`, ctx);
            }
        } catch (error) {
            console.error("[测试图片] 错误:", error);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]测试图片出错: ${error.message}`, ctx);
        }
    }
    return null;
}






if(message.match(/^(获取本群成员|群成员列表)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    //调用
    const dp = await BOTAPI(ctx, "get_group_member_list", 参数);
    // ================== 循环前置 ==================
    let data = dp;
    let 总人数 = Object.keys(data).length;
    if(总人数 == 0){
        //什么群tm0个人
        await sendReply(event, `[CQ:reply,id=${event.message_id}]获取失败！1`, ctx);
        return null;
    }
    
    // ================== 循环 ==================
    let 身份数据 = {
        "owner" : "👑",
        "admin" : "⭐",
        "member" : "👤",
        "unknown" : "👤"
    };
    let 组装消息 = `本群共有【${总人数}】人哦:`;
    for(let i = 0; i < 总人数; i++) {
        let 身份 = data[i].role;
        let 是否机器人 = data[i].is_robot;
        if(是否机器人){
            组装消息 += `\n🤖${i+1}.${data[i].nickname}(${data[i].user_id})`;
        }else{
            组装消息 += `\n${身份数据[身份]}${i+1}.${data[i].nickname}(${data[i].user_id})`;
        }
        continue;
    }
    
    // ================== 输出结果 ==================
    if(总人数 >= 15){//合并输出
        const messages = [
            { text: 组装消息, name: "[本群全部人]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{//普通输出
        await sendReply(event, `[CQ:reply,id=${event.message_id}]内容:${组装消息}`, ctx);
    }
    return null;
}





if(message.match(/^更改群老婆范围(单群模式|全群模式)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner2(event, ctx))) return null;
    // ================== 检 ==================
    const one_mub = message.match(/^更改群老婆范围(单群模式|全群模式)$/)[1];
    let 方法类型 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "类型" , "单群模式");//单或全
    if(one_mub == 方法类型){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]与原来的一样啦～！`, ctx);
        return null;
    }
    // ================== 检 ==================
    writeB("筱筱吖/娱乐系统/今日老婆/处理.json", "类型" , one_mub);//单或全
    await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒～！这就把设置群老婆的范围改成 ${one_mub}！`, ctx);
    return null;
}



if(message.match(/^更改群老婆冷却([0-9]+)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner2(event, ctx))) return null;
    // ================== 检 ==================
    const one_mub = JSON.parse(message.match(/^更改群老婆冷却([0-9]+)$/)[1]);
    let 时长 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "冷却" , 30);
    if(one_mub == 时长){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]与原来的一样啦～！`, ctx);
        return null;
    }
    // ================== 检 ==================
    writeB("筱筱吖/娱乐系统/今日老婆/处理.json", "冷却" , one_mub);
    await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒～！这就把设置群老婆的冷却改成 ${one_mub}秒！`, ctx);
    return null;
}


if(message.match(/^(今日老婆|我的老婆|换群老婆|更换老婆)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    
    // ================== 获取数据 - 1 ==================
    let 方法类型 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "类型" , "单群模式");//单或全
    let 读写路径 = `筱筱吖/娱乐系统/今日老婆/群组模式/全群模式/`;
    if(方法类型 == "单群模式"){
        读写路径 = `筱筱吖/娱乐系统/今日老婆/群组模式/分群模式/${event.group_id}/`;
    }else{
        读写路径 = `筱筱吖/娱乐系统/今日老婆/群组模式/全群模式/`;
    }
    // ================== 获取数据 - 2 ==================
    let 时间 = Math.floor(Date.now() / 1000);
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let 昨天 = timeA("y-m-d", Math.floor(Date.now() / 1000)-86400);
    let 昨日老婆 = readB(读写路径+`${昨天}/记录.json`, event.user_id, 0);
    let 今日老婆 = readB(读写路径+`${今天}/记录.json`, event.user_id, 0);
    let 来源记录 = readB(读写路径+`${今天}/记录2.json`, event.user_id, 0);
    let 记录时间 = readB(读写路径+`${今天}/冷却.json`, event.user_id, 0);
    let 过滤人机 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "过滤人机", "开启");
    let 过滤本人 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "过滤本人", "开启");
    
    // ================== 判断冷却 ==================
    let 指令 = message.match(/^(今日老婆|我的老婆|换群老婆|更换老婆)$/)[1];
    let 时长 = readB("筱筱吖/娱乐系统/今日老婆/处理.json", "冷却" , 30);
    if(时间 - 记录时间 < 时长 && (指令 == "换群老婆" || 指令 == "更换老婆")){
        let 倒计时 = 时长 - (时间 - 记录时间);
        await sendReply(event, `[CQ:reply,id=${event.message_id}]冷却时间要30秒哟～\n再等${倒计时}秒再来吧～！`, ctx);
        return null;
    }
    
    let iii = 来源记录;
    if(来源记录 == event.group_id){
        iii = "本群";
    }
    // ================== 还想抽？ -  类型判断 ==================
    //检测当前用户是否已经有过了
    if((指令 == "今日老婆" || 指令 == "我的老婆") && 今日老婆 != 0){
        //发今日老婆，也就是想第一次抽取，但他已经抽过了
        let 参数 = {user_id : 今日老婆};
        let dp = await BOTAPI(ctx, "get_stranger_info", 参数);
        // ================== 检 ==================
        let 组装消息 = `══════════════`;
        组装消息 += `\n❌ 你今天已经抽过啦～`;
        组装消息 += `\n你如果要更换的话请发「更换老婆」`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[CQ:image,file=https://q4.qlogo.cn/g?b=qq&nk=${今日老婆}&s=5]`;
        组装消息 += `[昵称]:${dp["nick"]}`;
        组装消息 += `\n[来源]:${iii}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
    if((指令 == "更换老婆" || 指令 == "换群老婆") && 今日老婆 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你今天好像还没抽过哎～？要不你先抽一下？`, ctx);
        return null;
    }
    
    // ================== 临时输出 ==================
    sendReply(event, `[CQ:reply,id=${event.message_id}]正在抽取新的老婆哟～请等待一会哈～！`, ctx);
    
    // ================== 匹配数据类型 ==================
    let data = [];
    if(方法类型 == "全群模式"){
        let 总群数据 = await BOTAPI(ctx, "get_group_list", {});
        let 总群数量 = (Object.keys(总群数据).length || 0);
        if(总群数量 == 0){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]好像获取群聊列表失败了唉？～`, ctx);
            return null;
        }
        if(总群数量 >= 15){//温馨提示
            sendReply(event, `[CQ:reply,id=${event.message_id}]全群模式数量庞大，请耐心等一等哦～`, ctx);
        }
        for(let i = 0; i < 总群数量; i++) {//循环遍历人数(全部人)
            let 来自群 = 总群数据[i]["group_id"];
            let 参数 = {group_id : event.group_id};
            let dp = await BOTAPI(ctx, "get_group_member_list", 参数);//访问当前执行群列表
            let 群总人数 = Object.keys(dp).length;//当前列表总人数
            //字循环
            for(let i = 0; i < 群总人数; i++) {
                let 组装消息 = {};
                组装消息["来自"] = 来自群;
                组装消息["QQ"] = dp[i].user_id;
                组装消息["昵称"] = dp[i].nickname;
                组装消息["机器人"] = dp[i].is_robot;
                data.push(组装消息);//直接传递到data
            }
        }
    }else{
        //单群模式(本群)
        let 参数 = {group_id : event.group_id};
        let dp = await BOTAPI(ctx, "get_group_member_list", 参数);
        // ================== 循环前置 ==================
        let 群总人数 = Object.keys(dp).length;
        if(群总人数 == 0){
            //什么群tm0个人
            await sendReply(event, `[CQ:reply,id=${event.message_id}]❌群聊模式获取失败：群成员列表获取失败！1`, ctx);
            return null;
        }
        let 来自群 = event.group_id;
        for(let i = 0; i < 群总人数; i++) {
            let 组装消息 = {};
            组装消息["来自"] = 来自群;
            组装消息["QQ"] = dp[i].user_id;
            组装消息["昵称"] = dp[i].nickname;
            组装消息["机器人"] = dp[i].is_robot;
            data.push(组装消息);//直接传递到data
        }
    }
    
    // ================== 检 ==================
    //writeA("测试/3.json", JSON.stringify(data));//调试
    let 总人数 = Object.keys(data).length;
    if(总人数 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]全部群就获取到0个人？？？`, ctx);
        return null;
    }
    
    // ================== 循环 - 前置==================
    let 历史老婆 = [];
    历史老婆.push(昨日老婆);
    历史老婆.push(今日老婆);
    let 可重复数 = 5;//最大重复次数
    let 错误累计 = 0;
    // ================== 循环 - 开始 ==================
    for(let i = 1; i < 总人数; i++){
        // ================== 获取&匹配 ==================
        let 随机数 = rand(0, 总人数-1);
        let suijiQQ = String(data[随机数].QQ);//随机到的QQ
        let 是否重复 = 历史老婆.includes(suijiQQ);
        
        // ================== 过滤系统 - 1 ==================
        if(是否重复){
            if(错误累计 >= 可重复数){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]我找了好几次都匹配不中唉？～要不待会再来？`, ctx);
                return null;
            }
            //logger.error("检测到重复");//调试
            错误累计++;
            continue;
        }
        // ================== 其他检测 - 2 ==================
        if(过滤人机 == "开启" && data[随机数].机器人 == true){
            if(错误累计 >= 可重复数){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]我找了好几次都匹配不中唉？～要不待会再来？`, ctx);
                return null;
            }
            //logger.error("检测到机器人");//调试
            错误累计++;
            continue;
        }
        // ================== 其他本人&机器人 - 3 ==================
        if(过滤本人 == "开启" && (data[随机数].QQ == event.self_id || data[随机数].QQ == event.user_id)){
            //过滤发言人和机器人本人账号
            if(错误累计 >= 可重复数){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]我找了好几次都匹配不中唉？～要不待会再来？`, ctx);
                return null;
            }
            //logger.error("检测到本人");//调试
            错误累计++;
            continue;
        }
        
        let lll = data[随机数].来自;
        if(data[随机数].来自 == event.group_id){
            lll = "本群";
        }
        
        // ================== 正常写入 ==================
        writeB(读写路径+`${今天}/记录.json`, event.user_id, suijiQQ);
        writeB(读写路径+`${今天}/记录2.json`, event.user_id, data[随机数].来自);
        writeB(读写路径+`${今天}/冷却.json`, event.user_id, Math.floor(Date.now() / 1000));//记录时间戳秒
        // ================== 正常总结 ==================
        let 组装消息 = `══════════════`;
        组装消息 += `\n✅成功获取新的群友老婆啦～`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[CQ:image,file=https://q4.qlogo.cn/g?b=qq&nk=${suijiQQ}&s=5]`;
        组装消息 += `[昵称]:${data[随机数].昵称}`;
        组装消息 += `\n[来自]:${lll}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
    // ================== 输出结果 ==================
    return null;
    await sendReply(event, `处理异常！`, ctx);
}











if(message.match(/^(开启|关闭)伪造声明$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取 ==================
    const one_mub = message.match(/^(开启|关闭)伪造声明$/)[1];
    const 状态 =readB(`筱筱吖/伪造聊天/${event.group_id}/声明.json`, "开关", "开启");
    // ================== 检 ==================
    if(one_mub == 状态){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好像也就是【${状态}】了唉～`, ctx);
        return null;
    }
    writeB(`筱筱吖/伪造聊天/${event.group_id}/声明.json`, "开关", one_mub);
    await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒！这就把声明给【${one_mub}】！`, ctx);
    return null;
}


if(message.match(/^伪造聊天([\s\S]*)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "伪造聊天", "关闭");
    if(开关 == "关闭"){
        return null;
    }
    // ================== 获取内容 ==================
    const content = message.match(/^伪造聊天([\s\S]*)$/)[1];
    const lines = content.split('\n').filter(line => line.trim());
    // ================== 判断 ==================
    if(content == "" || content == undefined){
        let 组装消息 = `══════════════`;
        组装消息 += `\n相关事件【伪造聊天】`;
        组装消息 += `\n开启|关闭伪造声明`;
        组装消息 += `\n`;
        组装消息 += `\n↓操作例子↓`;
        组装消息 += `\n`;
        组装消息 += `\n伪造聊天`;
        组装消息 += `\n864264375</>四个句号</>展示内容1`;
        组装消息 += `\n864264375</>四个句号</>换行展示<\/n>内容2`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
    // ================== 解析数据 - 前置 ==================
    let messages = [];
    const nm = readB(`筱筱吖/伪造聊天/${event.group_id}/声明.json`, "开关", "开启");
    if(nm == "开启"){
        let 临时内容 = `本功能由虚拟构造完成\n切勿相信！切勿迷信！\n本次执行人员:${event.user_id}`;
        messages.push({
            name: "声明",
            qq: 1001,
            text: 临时内容
        });
    }
    // ================== 解析数据 ==================
    for(let line of lines) {
        const parts = line.split('</>');
        if(parts.length >= 3) {
            let text = parts[2].trim();
            text = text.replace(/<\/n>/g, '\n');
            messages.push({
                name: parts[1].trim(),
                qq: parts[0].trim(),
                text: text
            });
        }
    }
    // ================== 判断 ==================
    if(messages.length === 0) {
        await sendReply(event, `[CQ:reply,id=${event.message_id}]格式错误！`, ctx);
        return null;
    }
    // ================== 发送合并消息 ==================
    await sendForward(event, messages, ctx);
    return null;
}




if(message.match(/^设置(全局|本群|)黑名单处理(踢出|黑踢)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取数据 ==================
    const scope = message.match(/^设置(全局|本群|)黑名单处理(踢出|黑踢)$/)[1] || "本群"; //全局或本群
    const ttt = message.match(/^设置(全局|本群|)黑名单处理(踢出|黑踢)$/)[2];//值
    // ================== 文件读取 ==================
    let 文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    if(scope == "全局"){
        文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    }else{
        文件路径 = `筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/`;
    }
    let data = readB(`${文件路径}处理方式.json`, "方式" , "踢出");
    // ================== 判断 ==================
    if(data == ttt){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]目前的「${scope}」黑名单处理方式已经是【${data}】啦！`, ctx);
        return null;
    }else{
        writeB(`${文件路径}处理方式.json`, "方法" , ttt);
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒！这就把「${scope}」黑名单的处理方式变为【${ttt}】！`, ctx);
    }
    return null;
}




if(message.match(/^(全局|本群|)黑名单列表$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 获取数据 ==================
    const scope = message.match(/^(全局|本群|)黑名单列表$/)[1] || "本群"; //全局或本群
    // ================== 文件读取 ==================
    let 文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    if(scope == "全局"){
        文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    }else{
        文件路径 = `筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/`;
    }
    let data = JSON.parse(readA(`${文件路径}人员.json`) || "[]");
    data = data.map(item => String(item));
    writeA(`${文件路径}人员.json`, JSON.stringify(data));
    let count = (data.length || 0);
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我好像没找到「${scope}」黑名单的人唉～？是不是没有啊～`, ctx);
        return null;
    }
    // ================== 循环 ==================
    let 组装消息 = ``;
    for(let i = 0; i < count; i++) {
        let 本次QQ = data[i];
        组装消息 += `\n${i+1}.【${data[i]}】`;
    }
    // ================== 组装消息 ==================
    let 返回内容 = `当前选择【${scope}】黑名单`;
    返回内容 += `\n共计人数【${count}】`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    // ================== 输出方式 ==================
    if(count >= 15){
        const messages = [{ text: 返回内容, name: "[黑名单列表]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message.match(/^(添加|删除|清空)(全局|本群|)黑名单([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        return null;
    }
    let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "黑白名单", "关闭");
    if(开关 == "关闭"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner(event, ctx))) return null;
    // ================== 获取数据 ==================
    const pureText = giveText(event.message);
    const operation = message.match(/^(添加|删除|清空)(全局|本群|)黑名单([\s\S]*)$/)[1]; // 添加或删除
    const scope = message.match(/^(添加|删除|清空)(全局|本群|)黑名单([\s\S]*)$/)[2] || "本群"; // 全局或本群
    const content = String(Number(pureText.replace(/^(添加|删除|清空)(全局|本群|)黑名单/, "").trim()));//内容QQ号
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    // ================== 判断 ==================
    if(rs == 0 && content == "" && operation != "清空"){
        return null;
    }
    // ================== 循环前置 ==================
    let 名单 = [];
    let 组装消息 = ``;
    let 文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    if(scope == "全局"){
        文件路径 = `筱筱吖/群管系统/黑白名单/全局/`;
    }else{
        文件路径 = `筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/`;
    }
    let data = JSON.parse(readA(`${文件路径}人员.json`) || "[]");
    let dddd = readB(`${文件路径}处理方式.json`, "方式" , "踢出");
    let tyyy = false;
    if(dddd == "踢出"){
        tyyy = false;
    }else{
        tyyy = true;
    }
    // ================== 清空模式 ==================
    if(operation == "清空"){
        writeA(`${文件路径}人员.json`, "[]");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]好叭～这就把「${scope}」黑名单给清空～～`, ctx);
        return null;
    }
    // ================== 多选模式 ==================
    if(rs != 0){
        if(operation == "添加" || operation == "新增"){
            // ================== 新增的 ==================
            for(let i = 0; i < rs; i++) {
                let 本次QQ = atUsers[i];
                let ishmd = data.includes(atUsers[i]);
                if(ishmd == true){
                    组装消息 += `\n${i+1}.【${atUsers[i]}】❌已存在`;
                }else{
                    名单.push(atUsers[i]);
                    data.push(atUsers[i]);
                    组装消息 += `\n${i+1}.【${atUsers[i]}】✅新增`;
                }
            }
            // ================== 调用接口 ==================
            let 参数 = {group_id : event.group_id,user_id : 名单,reject_add_request : tyyy};
            BOTAPI(ctx, "set_group_kick_members", 参数);
        }else{
            // ================== 删除的 ==================
            for(let i = 0; i < rs; i++) {
                let 本次QQ = atUsers[i];
                let ishmd = data.includes(atUsers[i]);
                if(ishmd == false){
                    组装消息 += `\n${i+1}.【${atUsers[i]}】❌不存在`;
                }else{
                    名单.push(atUsers[i]);
                    data = data.filter(qq => qq !== atUsers[i]);
                    组装消息 += `\n${i+1}.【${atUsers[i]}】✅删除`;
                }
            }
        }
        // ================== 写入 ==================
        writeA(`${文件路径}人员.json`, JSON.stringify(data));
        // ================== 组装输出 ==================
        let 返回内容 = ``;
        if(operation == "添加"){
            返回内容 += `已把下列人员添加至【${scope}】黑名单列表`;
        }else{
            返回内容 += `已把下列人员尝试从【${scope}】黑名单列表中移除`;
        }
        返回内容 += `\n══════════════`;
        返回内容 += 组装消息;
        返回内容 += `\n══════════════`;
        // ================== 输出 ==================
        if(rs >= 15){
            const messages = [{ text: 返回内容, name: "[黑名单操作]", qq: event.self_id }];
            await sendForward(event, messages, ctx);
        }else{
            await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
        }
        return null;
        
    // ================== 单体模式 ==================
    }else{
        // ================== 判断 ==================
        if(isNaN(content)){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]❌操作无效！内容非艾特也非数值！`, ctx);
            return null;
        }
        let ishmd = data.includes(content);
        // ================== 新增 ==================
        if(operation == "添加" || operation == "新增"){
            if(ishmd == true){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]❌【${content}】已存在于「${scope}」黑名单啦～`, ctx);
            }else{
                data.push(content);
                await sendReply(event, `[CQ:reply,id=${event.message_id}]✅已将【${content}】纳入「${scope}」黑名单列表！`, ctx);
            }
            // ================== 调用接口 ==================
            let 参数 = {group_id : event.group_id,user_id : [content],reject_add_request : tyyy};
            BOTAPI(ctx, "set_group_kick_members", 参数);
        
        // ================== 删除 ==================
        }else{
            if(ishmd == false){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]❌【${content}】本来就不在「${scope}」黑名单里面啦～！`, ctx);
            }else{
                data = data.filter(qq => qq !== content);
                await sendReply(event, `[CQ:reply,id=${event.message_id}]✅好的，这就把【${content}】从「${scope}」黑名单移出！`, ctx);
            }
        }
        // ================== 写入 ==================
        writeA(`${文件路径}人员.json`, JSON.stringify(data));
    }
    // ================== 检 ==================
    return null;
}




if(message.match(/^设置违禁处理(禁言|撤回禁言|撤回|禁言时长)([0-9]+|)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner2(event, ctx))) return null;
    // ================== 检 ==================
    const one_mub = message.match(/^设置违禁处理(禁言|撤回禁言|撤回|禁言时长)([0-9]+|)$/)[1];
    const two_mub = (message.match(/^设置违禁处理(禁言|撤回禁言|撤回|禁言时长)([0-9]+|)$/)[2] || 0);
    // ================== 禁言时长 ==================
    if(one_mub == "禁言时长"){
        let 时长 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "时长", 600);
        if(two_mub == 0){
           await sendReply(event, `[CQ:reply,id=${event.message_id}]在设置违禁禁言时长时，需要携带时间数量哦(秒)`, ctx);
           return null;
        }
        let 真时长 = 600;
        if(two_mub > 2592000){
            真时长 = 2592000;
        }
        if(two_mub == 时长){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]时长与原来的一样啦！`, ctx);
            return null;
        }else{
            writeB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "时长", 真时长);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒！这就把违禁词的禁言时长改成【${two_mub}】秒！`, ctx);
            return null;
        }
        // ================== 普通设定 ==================
    }else{
        let 类型 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "方式", "撤回");
        if(类型 == one_mub){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]现在已经是【${类型}】的处理方式啦！补药再改啦！`, ctx);
            return null;
        }else{
            writeB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "方式", one_mub);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]好哒～！这就把违禁词的处理方式改成【${one_mub}】\n下一次即可触发了哦～`, ctx);
            return null;
        }
    }
}


if(message.match(/^(增加|新增|添加|删除|取消|减少|清空)违禁词([\s\S]*)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner2(event, ctx))) return null;
    // ================== 获取数据 ==================
    const one_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)违禁词([\s\S]*)$/)[1];
    const two_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)违禁词([\s\S]*)$/)[2];
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`) || "[]");
    let 包含 = wj_cc.includes(two_mub);
    // ================== 添加 ==================
    if(one_mub == "增加" || one_mub == "新增" || one_mub == "添加"){
        if(包含 == true){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]emmmm，介个违禁词好像也就有了哎～`, ctx);
            return null;
        }
        //正常写入
        wj_cc.push(two_mub);
        writeA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`, JSON.stringify(wj_cc));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去添加违禁词！\n【新增】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 删除 ==================
    if(one_mub == "删除" || one_mub == "取消" || one_mub == "减少"){
        if(包含 == false){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]额，介个违禁词好像没有吧，我都找不到～～`, ctx);
            return null;
        }
        //正常删除
        let arr = wj_cc;
        arr = arr.filter(item => item !== two_mub);
        writeA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`, JSON.stringify(arr));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去把介个违禁词给ban了！\n【删除】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 清空 ==================
    if(one_mub == "清空"){
        writeA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`, "[]");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]耗的，这就就把违禁词通通删除！`, ctx);
        return null;
    }
    return null;
}

if(message == "违禁词列表"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 检 ==================
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`) || "[]");
    let 数量 = (wj_cc.length || 0);
    if(数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]介个群好像木有添加违禁词哎`, ctx);
        return null;
    }
    // ================== 循环 ==================
    let 组装消息 = ``;
    for(let i = 0; i < 数量; i++) {
        let 本次 = wj_cc[i];
        组装消息 += `\n【${i+1}】: ${本次}`;
    }
    // ================== 组装输出 ==================
    let 类型 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "方式", "撤回");
    let 时长 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "时长", 600);
    let 返回内容 = `共计【${数量}】个违禁词`;
    返回内容 += `\n当前处理方式 :【${类型}】`;
    返回内容 += `\n当前禁言时长 :【${时长}秒】`;
    返回内容 += `\n══════════════`;
    返回内容 += 组装消息;
    返回内容 += `\n══════════════`;
    // ================== 输出 ==================
    if(数量 >= 10){
        const messages = [{ text: 返回内容, name: "[违禁词列表]", qq: event.self_id }];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}


if(message === "重启服务"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 最高主人检测 ==================
    if(!(await checkOwner2(event, ctx))) return null;
    // ================== 组装数据 ==================
    let 数据 = {};
    数据["开关"] = true;
    数据["回复地方"] = "群聊";
    数据["回复目标"] = event.group_id;
    数据["回复ID"] = event.message_id;
    数据["记录时间"] = Math.floor(Date.now() / 1000);
    writeB("筱筱吖/重启进程/数据.json", "data", 数据);
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]已发送重启请求～请等待！\n预计10秒内会回复，如没有则需手动！`, ctx);
    // ================== 访问接口 ==================
    let 参数 = {};
    const dp = await BOTAPI(ctx, "set_restart", 参数);
    return null;
}















/*
if(message === "测试图片外显"){
    // ================== 多内容方法 ==================
    const nm = [
        {
            type: "text",
            data: {
                text: "🔗 点击下方链接了解更多：\nhttps://example.com\n\n"
            }
        },
        {
            type: "image",
            data: {
                file: "https://cnmb.xiaoyaxiao.xin/api/xihuandetupian",
                summary: "相关内容"
            }
        },
        {
            type: "text",
            data: {
                text: "\n✨ 更多精彩内容等你发现"
            }
        }
    ];
    await sendReply(event, nm, ctx);
    // ================== 更明显版本 ==================
    const nm = [
        {
            type: "image",
            data: {
                file: "https://cnmb.xiaoyaxiao.xin/api/xihuandetupian",
                summary: "特殊外显！！！"
            }
        }
    ];
    await sendReply(event, nm, ctx);
    return null;
}
*/


if(message == "赞我" || message == "点赞"){
    if(RC_sq == "已授权"){
        let 开关 = readB(`筱筱吖/事件系统/全局.json`, "自动回赞", "关闭");
        if(开关 == "开启"){
            // ================== 调用接口 ==================
            let 参数 = {"user_id": event.user_id, "times": 20};
            const dp = await BOTAPI(ctx, "send_like", 参数);
        }
    }
}

if(message == "拍我" || message == "截我"){
    if(RC_sq == "已授权"){
        let 发送方式 = readB("config.json", "cs_of", false);
        if(发送方式 == true){
            if(event.message_type == "group"){
                let 参数 = {"group_id":event.group_id, "user_id": event.user_id};
                BOTAPI(ctx, "friend_poke", 参数);
            }else{
                let 参数 = {"user_id": event.user_id};
                BOTAPI(ctx, "friend_poke", 参数);
            }
        }
    }
}



/*
//调试内容，看个人需求改进
if (event.message[0].type == "forward") {
  const forwardMsg = event.message[0];
  const content = forwardMsg.data.content;
  
  content.forEach((msg, index) => {
    logger.error(`[第 ${index + 1} 条] ${msg.sender.nickname}: ${msg.raw_message}`);
  });
}
*/























// ================== 检测大部分消息 ==================
if(message.match(/[\s\S]*/)){
    // ================== 来源 ==================
    if(event.message_type == "group"){
        //logger.error("111");//调试
        if(RC_sq == "已授权"){
            //logger.error("222");//调试
            let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "黑白名单", "关闭");
            let 机器人等级 = 0;
            let 用户等级 = 0;
            if(开关 == "开启"){//有开启检测
                //logger.error("333");
                let data1 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/全局/人员.json`) || "[]");
                let data2 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/人员.json`) || "[]");
                let ishmd1 = data1.includes(String(event.user_id));
                let ishmd2 = data2.includes(String(event.user_id));
                //logger.error(ishmd1);//调试
                //logger.error(ishmd2);//调试
                if(ishmd1 || ishmd2){
                    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
                    let dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
                    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
                    机器人等级 = Robot身份;//赋值
                    if(Robot身份 >= 2){//有神权
                        let 参数199 = {group_id : event.group_id,user_id : event.user_id};
                        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
                        let 用户身份 = (RC_group_role[(dp199?.role || "member")] || 0);
                        用户等级 = 用户身份;
                        if(Robot身份 > 用户身份){//比你大
                            let jjj = {"踢出" : false, "黑踢" : true};
                            let 参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : false};
                            if(data1.includes(event.user_id)){//全局黑名单
                                let nm1 = readA(`筱筱吖/群管系统/黑白名单/全局/处理方式.json`, "方式" , "踢出");
                                参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : jjj[nm1]};
                            }else{
                                let nm2 = readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/处理方式.json`, "方式" , "踢出");
                                参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : jjj[nm2]};
                            }
                            BOTAPI(ctx, "set_group_kick_members", 参数);
                            //顺便撤回
                            let 参数2 = {message_id : event.message_id};
                            await BOTAPI(ctx, "delete_msg", 参数2);
                        }
                    }
                }
            }
            // ================== 打卡 ==================
            let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
            let 全群打卡 = readB(`筱筱吖/事件系统/全局.json`, "全群打卡", "关闭");
            if(全群打卡 == "开启"){
                let 打卡状态 = readB(`筱筱吖/全群打卡/打卡状态/${今天}.json`, event.group_id, "未");
                if(打卡状态 == "未"){
                    writeB(`筱筱吖/全群打卡/打卡状态/${今天}.json`, event.group_id, "已");
                    let 参数 = {group_id : event.group_id};
                    BOTAPI(ctx, "send_group_sign", 参数);
                }
            }
            // ================== 违禁词检测 ==================
            let 违禁开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "违禁检测", "关闭");
            if(违禁开关 == "开启"){
                // ================== 二次正确赋值 ==================
                if(机器人等级 == 0){
                    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
                    let dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
                    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
                    机器人等级 = Robot身份;
                }
                if(机器人等级 >= 2){
                    // ================== 三次正确赋值 ==================
                    if(用户等级 == 0){
                        let 参数199 = {group_id : event.group_id,user_id : event.user_id};
                        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
                        let 用户身份 = (RC_group_role[(dp199?.role || "member")] || 0);
                        用户等级 = 用户身份;
                    }
                    if(机器人等级 > 用户等级){//神权王
                        // ================== 高级条件验证 ==================
                        let wjc_cc = JSON.parse(readA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`) || "[]");
                        let 条件数量 = wjc_cc.length;
                        let 成功与否 = false;
                        let 临时数据 = `无`;
                        for(let i = 0; i < 条件数量; i++) {
                            let 本次键 = wjc_cc[i];
                            if(message.includes(本次键) == true){
                                成功与否 = true;
                                //临时数据 = `内容:${本次键}`;//调试
                                break;
                            }else{
                                //临时数据 = "无";//调试
                            }
                        }
                        //处理方式
                        if(成功与否){
                            //ctx.logger.info(`违禁词触发:${临时数据}`);//调试
                            let 类型 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "方式", "撤回");
                            let 时长 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "时长", 600);
                            if(类型 == "禁言"){
                                let 参数 = {group_id : event.group_id,user_id : event.user_id,duration : 时长};
                                BOTAPI(ctx, "set_group_ban", 参数);
                            }else if(类型 == "撤回"){
                                let 参数 = {message_id : event.message_id};
                                await BOTAPI(ctx, "delete_msg", 参数);
                            }else{
                                //撤回+禁言
                                let 参数1 = {group_id : event.group_id,user_id : event.user_id,duration : 时长};
                                BOTAPI(ctx, "set_group_ban", 参数1);
                                let 参数2 = {message_id : event.message_id};
                                await BOTAPI(ctx, "delete_msg", 参数2);
                            }
                        }
                    }
                }
            }
            // ================== 高级检测 - 专门检测卡片的/合并转发消息的 ==================<
            //const leixing = ["video", "json", "forward", "xml"];
            //const oooooo = event.message[0].type;
            //const ispp = ownerQQs.includes(oooooo);//展示不想写这个，先放着
            if(event.message[0].type == "forward" || event.message[0].type == "json" ){
                // ================== 二次正确赋值 ==================
                if(机器人等级 == 0){
                    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
                    let dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
                    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
                    机器人等级 = Robot身份;
                }
                if(机器人等级 >= 2){
                    // ================== 三次正确赋值 ==================
                    if(用户等级 == 0){
                        let 参数199 = {group_id : event.group_id,user_id : event.user_id};
                        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
                        let 用户身份 = (RC_group_role[(dp199?.role || "member")] || 0);
                        用户等级 = 用户身份;
                    }
                    if(机器人等级 > 用户等级){//神权王
                        // ================== 先处理合并转发 ==================
                        if(event.message[0].type == "forward"){
                            let 进阶开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "进阶检测", "关闭");
                            if(进阶开关 == "开启"){
                                // ================== 高级违禁词验证 ==================
                                let 违禁开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "违禁检测", "关闭");
                                if(违禁开关 == "开启"){
                                    let wjc_cc = JSON.parse(readA(`筱筱吖/群管系统/违禁系统/${event.group_id}/违禁词.json`) || "[]");
                                    let 条件数量 = wjc_cc.length;
                                    let 成功与否 = false;
                                    let 临时数据 = `无`;
                                    let 临时文本 = ``;
                                    const forwardMsg = event.message[0];
                                    const content = forwardMsg.data.content;
                                    content.forEach((msg, index) => {
                                        //logger.error(`[第 ${index + 1} 条] ${msg.sender.nickname}: ${msg.raw_message}`);
                                        临时文本 += msg.raw_message;
                                    });
                                    for(let i = 0; i < 条件数量; i++) {
                                        let 本次键 = wjc_cc[i];
                                        if(临时文本.includes(本次键) == true){
                                            成功与否 = true;
                                            //临时数据 = `内容:${本次键}`;//调试
                                            break;
                                        }else{
                                            //临时数据 = "无";//调试
                                        }
                                    }
                                    if(成功与否){
                                        //ctx.logger.info(`违禁词触发:${临时数据}`);//调试
                                        let 类型 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "方式", "撤回");
                                        let 时长 = readB(`筱筱吖/群管系统/违禁系统/${event.group_id}/处理.json`, "时长", 600);
                                        if(类型 == "禁言"){
                                            let 参数 = {group_id : event.group_id,user_id : event.user_id,duration : 时长};
                                            BOTAPI(ctx, "set_group_ban", 参数);
                                        }else if(类型 == "撤回"){
                                            let 参数 = {message_id : event.message_id};
                                            await BOTAPI(ctx, "delete_msg", 参数);
                                        }else{
                                            //撤回+禁言
                                            let 参数1 = {group_id : event.group_id,user_id : event.user_id,duration : 时长};
                                            BOTAPI(ctx, "set_group_ban", 参数1);
                                            let 参数2 = {message_id : event.message_id};
                                            await BOTAPI(ctx, "delete_msg", 参数2);
                                        }
                                    }
                                }//进阶违禁检测结束
                            }//进阶开关
                        }//else
                    }
                }
            }
            // ================== 高级检测结束 ==================
        }
    }
}


if(event.raw_message === "" && (!event.message || event.message.length === 0)){
    if(event.message_type === "group"){//只检测群聊红包
        // ================== 授权判断 ==================
        if(RC_sq == "已授权"){
            // ================== 开关判断 ==================
            let 开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "禁发红包", "关闭");
            if(开关 == "开启"){
                // ================== 身份判断 ==================
                let dp188 = await BOTAPI(ctx, "get_group_member_info", {group_id : event.group_id,user_id : event.self_id});
                let dp199 = await BOTAPI(ctx, "get_group_member_info", {group_id : event.group_id,user_id : event.user_id});
                let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
                let 用户身份 = (RC_group_role[(dp199?.role || "member")] || 0);
                if(Robot身份 > 用户身份){
                    // ================== 撤回 ==================
                    let 参数 = {message_id : event.message_id};
                    await BOTAPI(ctx, "delete_msg", 参数);
                }
            }
        }
    }
}









// ================== 以下均为主人权限指令 ==================
// 直接拦截了，普通用户不会触发下面的
if(!(await checkOwner2(event, ctx))) return null;




if(message === "运行状态"){
    // ================== 检 ==================
    let 发送方式 = readB("config.json", "cs_of", false);
    if(发送方式 == false){
        return null;
    }
    const dp = await BOTAPI(ctx, "get_login_info", {});
    // ================== 检 ==================
    try {
        // 获取系统信息
        const systemInfo = getSystemInfo();
        const processes = getProcessList();
    
        // 获取账号信息
        const botQQ = dp["user_id"];
        const botName = dp["nickname"];
    
        // 获取群聊和好友数量
        let groupCount = 0;
        let friendCount = 0;
    
        try {
            const friendList = await BOTAPI(ctx, "get_friend_list", {});
            friendCount = (friendList.length || 0);
        }catch (e){
            console.error("获取好友列表失败:", e);
        }
    
        try {
            const groupList = await BOTAPI(ctx, "get_group_list", {});
            groupCount = (groupList.length || 0);
        }catch (e){
            console.error("获取群聊列表失败:", e);
        }
    
        // ================== 读取文件 ==================
        const htmlContent = readA("html/状态.html");
        // ================== 构造数据 ==================
        const templateData = {
            name: String(botName),
            QQ: String(botQQ),
            type: systemInfo.type,
            arch: systemInfo.arch,
            cpuCount: systemInfo.cpuCount,
            cpuUsagePercent: systemInfo.cpuUsagePercent,
            totalMemoryGB: formatBytes(systemInfo.totalMemory),
            memoryUsagePercent: systemInfo.memoryUsagePercent,
            diskTotalGB: formatBytes(systemInfo.disk.total),
            diskUsedGB: formatBytes(systemInfo.disk.used),
            diskFreeGB: formatBytes(systemInfo.disk.free),
            diskUsagePercent: systemInfo.disk.usagePercent,
            groupCount: groupCount,
            friendCount: friendCount
        };
        // ================== 传递 ==================
        const processDataScript = `<script>window.processData = ${JSON.stringify(processes)};</script>`;
        let finalHtml = htmlContent.replace("</head>", `${processDataScript}</head>`);
        // ================== 调用API ==================
        const imageData = await puppeteer(finalHtml, {
            data: templateData,
            width: 1400,
            height: 900
        });
        // ================== 输出 ==================
        if (imageData) {
            // 发送图片
            const cqCode = `[CQ:reply,id=${event.message_id}][CQ:image,file=base64://${imageData}]`;
            await sendReply(event, cqCode, ctx);
        }else{
            await sendReply(event, `[CQ:reply,id=${event.message_id}]渲染失败，请检查 puppeteer 插件是否正常运行`, ctx);
        }
    }catch (error){
        console.error("系统状态命令错误:", error);
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出错了: ${error.message}`, ctx);
    }
return null;
}




// ================== 事件开关部分 ==================
if(message.match(/^(开启|关闭)(.*|全部事件)$/)){
    // ================== 获取数据 ==================
    const one_mub = message.match(/^(开启|关闭)(.*|全局事件)$/)[1];
    const two_mub = message.match(/^(开启|关闭)(.*|全部事件)$/)[2];
    
    // ================== 判断 ==================
    if(two_mub == "" || two_mub == undefined){
        return null;
    }
    if(!array_shijian.includes(two_mub) && two_mub != "全部事件" && !array_RCshijian.includes(two_mub)){
        return null;
    }
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    
    // ================== 判断 ==================
    const isRC = array_RCshijian.includes(two_mub);
    if(isRC){
        let wj_ofu = readB(`筱筱吖/事件系统/全局.json`, two_mub, "关闭");
        if(wj_ofu == one_mub){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这个事件好像已经${wj_ofu}了吧～？`, ctx);
        }else{
            // ================== 正常写入 ==================
            writeB(`筱筱吖/事件系统/全局.json`, two_mub, one_mub);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这就把【${two_mub}】给${one_mub}！`, ctx);
        }
        return null;
    }else if(two_mub != "全部事件"){
        let wj_ofu = readB(`筱筱吖/事件系统/${event.group_id}.json`, two_mub, "关闭");
        if(wj_ofu == one_mub){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这个事件好像已经${wj_ofu}了吧～？`, ctx);
        }else{
            // ================== 正常写入 ==================
            writeB(`筱筱吖/事件系统/${event.group_id}.json`, two_mub, one_mub);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这就把【${two_mub}】给${one_mub}！`, ctx);
        }
        return null;
    }else{
        let 次数 = (array_shijian.length || 0);
        let 次数_2 = (array_RCshijian.length || 0);
        let 组装消息 = `已将以下事件统一「${one_mub}」`;
        组装消息 += `\n══════════════`;
        for(let i = 0; i < 次数; i++) {
            let wj_of = readB(`筱筱吖/事件系统/${event.group_id}.json`, array_shijian[i], "关闭");
            if(wj_of == one_mub){
                组装消息 += `\n【${array_shijian[i]}】: ❌本就${wj_of}！`;
            }else{
                组装消息 += `\n【${array_shijian[i]}】: ✅已${one_mub}！`;
                writeB(`筱筱吖/事件系统/${event.group_id}.json`, array_shijian[i], one_mub);
            }
        }
        for(let i = 0; i < 次数_2; i++) {
            let wj_of = readB(`筱筱吖/事件系统/全局.json`, array_RCshijian[i], "关闭");
            if(wj_of == one_mub){
                组装消息 += `\n【${array_RCshijian[i]}】: ❌本就${wj_of}！`;
            }else{
                组装消息 += `\n【${array_RCshijian[i]}】: ✅已${one_mub}！`;
                writeB(`筱筱吖/事件系统/全局.json`, array_RCshijian[i], one_mub);
            }
        }
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
}



if(message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)[1];
    const two_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)[2];
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`) || "[]");
    let 包含 = wj_cc.includes(two_mub);
    
    // ================== 添加 ==================
    if(one_mub == "增加" || one_mub == "新增" || one_mub == "添加"){
        if(包含 == true){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]emmmm，介个好像也就有了哎～`, ctx);
            return null;
        }
        //正常写入
        wj_cc.push(two_mub);
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, JSON.stringify(wj_cc));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去更新条件\n【新增】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 删除 ==================
    if(one_mub == "删除" || one_mub == "取消" || one_mub == "减少"){
        if(包含 == false){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]额，介个好像没有吧，我都找不到～～`, ctx);
            return null;
        }
        //正常删除
        let arr = wj_cc;
        arr = arr.filter(item => item !== two_mub);
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, JSON.stringify(arr));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去更新条件\n【删除】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 清空 ==================
    if(one_mub == "清空"){
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, "[]");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]耗的，这就就把条件通通删除！`, ctx);
        return null;
    }
}



if(message.match(/^设置入群审核字数数量([0-9]+)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核字数数量([0-9]+)$/)[1];
    let cc = Number(one_mub);
    let wj_cc = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", 5));
    
    // ================== 匹配判断 ==================
    if(cc == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]跟原来的次数一样啦～！`, ctx);
        return null;
    }
    if(cc == 0 || cc > 15){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这数字真的合适嘛～？`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", cc);
    let 返回内容 = `已把本群的入群审核【字数审核】设置为${one_mub}字`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}




if(message.match(/^设置入群审核条件(准确|模糊多重|准确多重|包含|字数)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核条件(准确|模糊多重|准确多重|包含|字数)$/)[1];
    let wj_cc = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", "字数");
    
    // ================== 判断 ==================
    if(one_mub == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]目前本群设置的条件是一样的啦～！`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", one_mub);
    let 返回内容 = `已把本群的入群审核【条件】设置为「${one_mub}」模式`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message.match(/^设置入群审核答案([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    const one_mub = message.match(/^设置入群审核答案([\s\S]*)/)[1];
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "答案", one_mub);
    let 返回内容 = `已把本群的入群审核【答案】设置为${one_mub}`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message.match(/^设置入群审核单日次数([0-9]+)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核单日次数([0-9]+)$/)[1];
    let cc = Number(one_mub);
    let wj_cc = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", 3));
    
    // ================== 匹配判断 ==================
    if(cc == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]跟原来的次数一样啦～！`, ctx);
        return null;
    }
    if(cc == 0 || cc > 100){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这数字真的合适嘛～？`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", cc);
    let 返回内容 = `已把本群的入群审核【每日次数】设置为${one_mub}次`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message == "查看多重条件列表"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 读取数据 ==================
    let 数据 = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, []));
    let 数据数量 = 数据.length;
    
    // ================== 循环前置 ==================
    if(数据数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有获取到数据哎～`, ctx);
        return null;
    }
    // ================== 循环 ==================
    let 组装消息 = `本群共有【${数据数量}】个条件`;
    组装消息 += `\n══════════════`;
    for(let i = 0; i < 数据数量; i++) {
        let 本次键 = 数据[i];
        组装消息 += `\n【${i + 1}】${本次键}`;
    }
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}





    return null;
}










// ================== 通知事件处理 ==================
async function handleNotice(event, ctx) {
const noticeType = event.notice_type;




// ================== 特殊通知 - 点赞==================
if(event.sub_type === "profile_like"){
    let 开关 = readB(`筱筱吖/事件系统/全局.json`, "自动回赞", "关闭");
    if(开关 == "开启"){
        //ctx.logger.info(`2用户${event.operator_id}给${event.self_id}点了${event.times}个赞`);//调试
        let 回赞数量 = 10;
        if(event.times > 20){
            回赞数量 = 10;
        }else{
            回赞数量 = event.times;
        }
        // ================== 调用接口 ==================
        let 参数 = {"user_id": event.operator_id, "times": 回赞数量};
        const dp = await BOTAPI(ctx, "send_like", 参数);
        return null;
    }
}



//获取授权状态 
let dir_wj_time = "";
if (event.group_id) {
    dir_wj_time = "筱筱吖/授权系统/授权信息/" + event.group_id + ".json";
} else {
    dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
}
//
const xz_time = Math.floor(Date.now() / 1000);
const wj_time = readB(dir_wj_time, "授权时间", 0);
const wj_km_time = readB(dir_wj_time, "卡密时长", 0);
const jjjj = xz_time - wj_time;
//
let RC_sq = "未授权";
if (wj_time !== 0 && wj_km_time !== 0 && jjjj <= wj_km_time) {
    RC_sq = "已授权";
}
//获取授权状态 

// ================== 全局开关 - 群聊&私聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const haoyou_ofs = readB("config.json", "haoyou_of", []);
const isGroups = group_ofs.includes(String(event.group_id ?? ""));
const isHaoyou = haoyou_ofs.includes(String(event.user_id));
if(!isGroups && !isHaoyou) {
  return null;
}


// ================== 授权匹配 ==================
if(RC_sq != "已授权"){
    return null;
}






// ================== 拍一拍回复 ==================
if(event.sub_type === "poke"){
    let 发起者 = event.user_id;
    let 被拍者 = event.target_id;
    let 发送方式 = readB("config.json", "cs_of", false);
    if(发送方式 == true){
        if(event.target_id == event.self_id){
            let 返回列表 = [
                " 嗯？有什么事吗？",
                " 喵～在这里哦",
                " 呼～刚刚打了个小盹",
                " 补药拍窝！",
                " 补药拍啦！再拍就傻啦！",
                " 诶嘿，突然出现！",
                " 哇，吓我一跳～",
                " 转圈圈～晕乎乎的",
                " 电量不足，需要抱抱充电～",
                " 怎么啦？",
                " 突然被cue到！"
            ];
            let 随机数 = rand(0, 返回列表.length-1);
            let 输出结果 = 返回列表[随机数];
            // ================== 回复地方 ==================
            let fakeEvent = ``;
            if(event.group_id){
                fakeEvent = {message_type: "group", group_id: event.group_id};
                await sendReply(fakeEvent, `${输出结果}`, ctx);
            }else{
                await sendReply(event, `${输出结果}`, ctx);
            }
        }
    }
}



// ================== 群禁言事件处理 ==================
if(noticeType === "group_ban") {
    // ================== 检 ==================
    let jj_ofu = readB(`筱筱吖/事件系统/${event.group_id}.json`, "禁言通知", "关闭");
    if(jj_ofu == "开启"){
        // ================== 输出地方 ==================
        let fakeEvent = {message_type: "group", group_id: event.group_id};
        let 返回内容 = ``;
        // ================== 单向操作 ==================
        if(event.user_id != 0){
            // ================== 禁言 ==================
            if(event.sub_type == "ban"){
                if(event.user_id == event.self_id){//如果是机器人被叼
                    return null;
                }
                返回内容 = `${event.user_id}被禁言了【${event.duration}】秒哎～他又不说话了，你总是这样....`;
                await sendReply(fakeEvent, 返回内容, ctx);
            // ================== 解禁 ==================
            }else{
                if(event.user_id == event.self_id){//如果是机器人被解开
                    返回内容 = `终于给我解开啦～！窝又可以叭叭叭了！`;
                }else{
                    返回内容 = `${event.user_id}被解禁了哎～他又可以说话了！`;
                }
                await sendReply(fakeEvent, 返回内容, ctx);
            }
        // ================== 全体操作 ==================
        }else{
            // ================== 全体禁言 ==================
            if(event.sub_type == "ban"){
                let 参数188 = {group_id : event.group_id,user_id : event.self_id};
                let dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
                let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
                if(Robot身份 >= 2){
                    返回内容 = `全体禁言了唉～！大家怎么都不说话了，是不爱说话嘛～？`;
                    await sendReply(fakeEvent, 返回内容, ctx);
                }
            // ================== 全体解禁 ==================
            }else{
                返回内容 = `全体闭嘴模式被关闭了唉！！！大家又可以唠嗑了！`;
                await sendReply(fakeEvent, 返回内容, ctx);
            }
        }
    }
    return null;
}


// ================== 已入群通知 ==================
if (noticeType === "group_increase") {
    let 放行标准 = true;
    // ================== 黑名单 ==================
    let 黑白开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "黑白名单", "关闭");
    if(黑白开关 == "开启"){
        let data1 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/全局/人员.json`) || "[]");
        let data2 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/人员.json`) || "[]");
        let ishmd1 = data1.includes(String(event.user_id));
        let ishmd2 = data2.includes(String(event.user_id));
        if(ishmd1 || ishmd2){
            let 参数188 = {group_id : event.group_id,user_id : event.self_id};
            let dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
            let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
            if(Robot身份 >= 2){//有神权
                let 参数199 = {group_id : event.group_id,user_id : event.user_id};
                let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
                let 用户身份 = (RC_group_role[(dp199?.role || "member")] || 0);
                if(Robot身份 > 用户身份){//比你大
                    放行标准 = false;
                    let jjj = {"踢出" : false, "黑踢" : true};
                    let 参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : false};
                    if(data1.includes(event.user_id)){//全局黑名单
                        let nm1 = readA(`筱筱吖/群管系统/黑白名单/全局/处理方式.json`, "方式" , "踢出");
                        参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : jjj[nm1]};
                    }else{
                        let nm2 = readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/处理方式.json`, "方式" , "踢出");
                        参数 = {group_id : event.group_id,user_id : [event.user_id],reject_add_request : jjj[nm2]};
                    }
                    BOTAPI(ctx, "set_group_kick_members", 参数);
                }
            }
        }
    }
    // ================== 黑名单判断结束 ==================
    // ================== 邀人统计 ==================
    let 通报状态 = false;
    let 统计开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "邀人统计", "关闭");
    if(统计开关 == "开启"){
        let mub_BQ_yqr = readB(`筱筱吖/扩展功能/邀人统计/${event.group_id}/绑定数据.json`, event.user_id, "无");
        if(mub_BQ_yqr == "无"){//没绑定人才会触发
            if(event.sub_type == "invite"){//邀请通过的
                // ================== 读取数据 ==================
                let BQ_yqr数据 = JSON.parse(readA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/${event.operator_id}.json`) || "[]");
                let 包含 = BQ_yqr数据.includes(event.user_id);
                // ================== 二次检测 ==================
                if(!包含){//如果之前没有就执行
                    // ================== 写入 ==================
                    BQ_yqr数据.push(event.user_id);
                    writeB(`筱筱吖/扩展功能/邀人统计/${event.group_id}/绑定数据.json`, event.user_id, event.operator_id);
                    writeB(`筱筱吖/扩展功能/邀人统计/${event.group_id}/被绑时间.json`, event.user_id, Math.floor(Date.now() / 1000));
                    writeA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/${event.operator_id}.json`, JSON.stringify(BQ_yqr数据));
                    // ================== 输出 ==================
                    let fakeEvent = {message_type: "group", group_id: event.group_id};
                    let 邀人组装消息 = `新群员(${event.user_id})是被(${event.operator_id})邀请进来的，到目前为止已累计邀请【${BQ_yqr数据.length}】人`;
                    await sendReply(fakeEvent, `${邀人组装消息}`, ctx);
                    通报状态 = true;
                    let zzzzz = JSON.parse(readA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/邀请官.json`) || "[]");
                    if(!zzzzz.includes(event.operator_id)){
                        zzzzz.push(event.operator_id);
                        writeA(`筱筱吖/扩展功能/邀人统计/${event.group_id}/邀请官.json`, JSON.stringify(zzzzz));
                    }
                }
            }
        }
    }
    // ================== 邀人统计结束 ==================
    let fakeEvent = {message_type: "group", group_id: event.group_id};
    // ================== 画布 ==================
    let 画布开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "入群图片", "关闭");
    if(画布开关 == "开启"){
        // ================== 获取数据 ==================
        let 参数 = {user_id : event.user_id};
        const dp = await BOTAPI(ctx, "get_stranger_info", 参数);
        let 性别数据 = {'unknown':"未知",'female':"女",'male':"男"};
        let 性别 = (性别数据[dp["sex"]] || "未知");
        let 年月日 = `${dp?.birthday_year}-${dp?.birthday_month}-${dp?.birthday_day}`;
        let 注册时间 = timeA("y", dp?.regTime) + "年";
        try {
            // 获取当前日期
            let 时间戳秒 = Math.floor(Date.now() / 1000);
            let 现在时间 = timeA("y-m-d H:i:s", 时间戳秒);
            // 构建渲染数据
            const renderData = {
                "qq": String(event.user_id),
                "name" : String(dp?.nick || ""),
                "sex" : String(性别 || "未知"),
                "rrrr" : String(年月日),
                "age" : String(dp?.age || 0),
                "denji" : String(dp?.qqLevel),
                "zhuce" : String(注册时间),
                "jiaqun" : String(现在时间)
            };
            // 调用 Puppeteer 渲染
            const htmlContent = readA("html/入群身份.html");
            const imageData = await puppeteer(htmlContent, {
                data: renderData,
                width: 1400,
                height: 850
            });
            if (imageData) {
                // 发送渲染后的图片
                if(放行标准 == true){
                    await sendReply(fakeEvent, `[CQ:at,qq=${event.user_id}] 欢迎你的加入～\n[CQ:image,file=base64://${imageData}]`, ctx);
                }
            } else {
                console.error("[测试图片] 渲染失败，请检查 Puppeteer 服务是否运行", error);
                //await sendReply(event, `[CQ:reply,id=${event.message_id}]渲染失败，请检查 Puppeteer 服务是否运行`, ctx);
            }
        } catch (error) {
            console.error("[测试图片] 错误:", error);
            //await sendReply(event, `[CQ:reply,id=${event.message_id}]测试图片出错: ${error.message}`, ctx);
        }
    }
    // ================== 检 ==================
}









// ================== 退群通知 ==================
if(noticeType == "group_decrease"){

    // ================== 获取数据 ==================
    let 退群通知开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "退群通知", "关闭");
    let 退群拉黑开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "退群拉黑", "关闭");
    let 返回句子 = ``;
    // ================== 类型 ==================
    if(event.sub_type == "leave"){//主动退群
        返回句子 = `用户${event.user_id}自己退群了唉～`;
        if(退群拉黑开关 == "开启"){
            返回句子 += `\n已添加至本群的黑名单啦～`;
        }
    }else if(event.sub_type == "kick"){//被动退群
        返回句子 = `用户${event.user_id}被神权王飞了唉～！`;
        if(退群拉黑开关 == "开启"){
            返回句子 += `\n已添加至本群的黑名单啦～`;
        }
        if(event.operator_id == event.self_id){
            返回句子 = ``;
        }
    }else{
        返回句子 = `好像是窝被神权王飞了.......`;
        logger.info(返回句子);
        return null;
    }
    // ================== 黑名单写入 ==================
    if(退群拉黑开关 == "开启"){
        let data = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/人员.json`) || "[]");
        let ishmd = data.includes(String(event.user_id));
        if(ishmd == false && event.user_id != event.self_id){
            data.push(String(event.user_id));
            writeA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/人员.json`, JSON.stringify(data));
        }
    }
    // ================== 是否通知 ==================
    let fakeEvent = {message_type: "group", group_id: event.group_id};
    if(退群通知开关 == "开启"){
        let 字数 = (返回句子.length || 0);
        if(字数 <= 5){
            return null;
        }else{
            await sendReply(fakeEvent, 返回句子, ctx);
        }
    }
    return null;
}


return null;
}






// ================== 请求事件处理 ==================
async function handleRequest(event, ctx) {
const requestType = event.request_type;
//获取授权状态 
let dir_wj_time = "";
if (event.group_id) {
    dir_wj_time = "筱筱吖/授权系统/授权信息/" + event.group_id + ".json";
} else {
    dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
}
//
const xz_time = Math.floor(Date.now() / 1000);
const wj_time = readB(dir_wj_time, "授权时间", 0);
const wj_km_time = readB(dir_wj_time, "卡密时长", 0);
const jjjj = xz_time - wj_time;
//
let RC_sq = "未授权";
if (wj_time !== 0 && wj_km_time !== 0 && jjjj <= wj_km_time) {
    RC_sq = "已授权";
}
//获取授权状态 

// ================== 全局开关 - 群聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const haoyou_ofs = readB("config.json", "haoyou_of", []);
const isGroups = group_ofs.includes(String(event.group_id ?? ""));
const isHaoyou = haoyou_ofs.includes(String(event.user_id));
if(!isGroups && !isHaoyou) {
  return null;
}



// ================== 授权匹配 ==================
if(RC_sq != "已授权"){
    return null;
}


// ================== 加群申请 ==================
if (requestType === "group") {
    // ================== 黑名单 ==================
    let 黑白开关 = readB(`筱筱吖/事件系统/${event.group_id}.json`, "黑白名单", "关闭");
    if(黑白开关 == "开启"){
        let data1 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/全局/人员.json`) || "[]");
        let data2 = JSON.parse(readA(`筱筱吖/群管系统/黑白名单/群聊/${event.group_id}/人员.json`) || "[]");
        let ishmd1 = data1.includes(String(event.user_id));
        let ishmd2 = data2.includes(String(event.user_id));
        if(ishmd1 || ishmd2){
            // ================== 调用接口 ==================
            let 参数 = {flag : event?.flag, approve : false, reason : "你是黑名单用户！"};
            await BOTAPI(ctx, "set_group_add_request", 参数);
            return null;
        }
    }
    // ================== 获取问题数据 ==================
    let 问题 = "";
    let 答案 = "";
    let text = (event?.comment || "");
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let wj_tj = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", "字数");
    let wj_cs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", 3));
    let wj_zs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", 5));
    let me_cs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/申请次数/${event.user_id}.json`, 今天, 0));
    let wj_ofu = readB(`筱筱吖/事件系统/${event.group_id}.json`, "入群审核", "关闭");
    // ================== 管你这那的，出去 ==================
    if(wj_ofu == "关闭"){
        return null;
    }
    if(me_cs > wj_cs){
        // ================== 调用接口 ==================
        let 参数 = {flag : event?.flag, approve : false, reason : "你今天的可用申请次数已用完咯～"};
        await BOTAPI(ctx, "set_group_add_request", 参数);
        return null;
    }
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/申请次数/${event.user_id}.json`, 今天, me_cs + 1);
    
    // ================== 获取数据 ==================
    const match = text.match(/问题：([\s\S]*)\n答案：([\s\S]*)/);
    if (match) {
        const question = match[1];
        const answer = match[2];
        问题 = ("问题:", question);
        答案 = ("答案:", answer);
    }
    if(答案 == ""){
        答案 = event.comment;
    }
    
    // ================== 判断内容 ==================
    let 成功与否 = false;
    let 参数 = {flag : event?.flag, approve : false, reason : "意想不到的回复"};
    // ================== 字数验证 ==================
    if(wj_tj == "字数"){
        let 答案字数 = (答案.length || 0);
        if(答案字数 < wj_zs){
            参数 = {flag : event?.flag, approve : false, reason : `本群设定通过内容为:>=${wj_zs}个字`};
        }else{
            参数 = {flag : event?.flag, approve : true};
        }
    }
    
    // ================== 普通答案验证 ==================
    let 普通答案 = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "答案", "");
    let 普通答案包含 = 答案.includes(普通答案);
    if(wj_tj == "包含"){
        if(普通答案包含 == false){
            参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！1"};
        }else{
            成功与否 = true;
            参数 = {flag : event?.flag, approve : true};
        }
    }
    if(wj_tj == "准确"){
        if(答案 === 普通答案){
            成功与否 = true;
            参数 = {flag : event?.flag, approve : true};
        }else{
            参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！2"};
        }
    }
    
    // ================== 高级条件验证 ==================
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`) || "[]");
    let 条件数量 = wj_cc.length;
    if(wj_tj == "模糊多重"){
        for(let i = 0; i < 条件数量; i++) {
            let 本次键 = wj_cc[i];
            if(答案.includes(本次键) == true){
                成功与否 = true;
                参数 = {flag : event?.flag, approve : true};
                break;
            }else{
                参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！3"};
            }
        }
    }
    if(wj_tj == "准确多重"){
        for(let i = 0; i < 条件数量; i++) {
            let 本次键 = wj_cc[i];
            if(答案 === 本次键){
                成功与否 = true;
                参数 = {flag : event?.flag, approve : true};
                break;
            }else{
                参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！4"};
            }
        }
    }
    // ================== 访问接口 ==================
    BOTAPI(ctx, "set_group_add_request", 参数);
    
    // ================== 组装消息 ==================
    let fakeEvent = {message_type: "group", group_id: event.group_id};//消息指导到触发群聊
    // ================== 输出 ==================
    if(成功与否 == true){//成功
        await sendReply(fakeEvent, `QQ(${event.user_id})通过入群审核，已同意进入～`, ctx);
    }else{//失败
        //await sendReply(fakeEvent, `QQ(${event.user_id})想加入群聊，但回答的问题不符合条件！`, ctx);//调试的
    }
    //await sendReply(fakeEvent, `[条件]:${wj_tj}\n[数据]:${wj_cc}\n[数量]:${条件数量}\n[答案]:${答案}\n[状态]:${成功与否}\n[参数]:${JSON.stringify(参数)}`, ctx);//调试的
    return null;
}


return null;
}






// ================== 定时任务 ==================
let lastExecutedTime = "";  // 记录上次执行的时间，防止重复执行
async function handleScheduledTask(ctx) {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];//时间格式化
    
    // ================== 防重复检查 ==================
    if (timeStr === lastExecutedTime) return;  // 如果时间相同，直接返回
    lastExecutedTime = timeStr;  // 更新记录的时间
    
    const 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    const time_data = ["00:00:00", "01:00:00", "02:00:00", "03:00:00", "04:00:00", "05:00:00", "06:00:00", "07:00:00", "08:00:00", "09:00:00", "10:00:00", "11:00:00", "12:00:00", "13:00:00", "14:00:00", "15:00:00", "16:00:00", "17:00:00", "18:00:00", "19:00:00", "20:00:00", "21:00:00", "22:00:00", "23:00:00"];
    // ================== 整点报时 ==================
    if(time_data.includes(timeStr)){//等于整点时
        //ctx.logger.info("定时任务触发：准时续火");//调试
        // ================== 获取数据 ==================
        const groupList = await BOTAPI(ctx, "get_group_list", {});
        const 群数量  = (groupList.length || 0);
        // ================== 循环 ==================
        for(let i = 0; i < 群数量; i++){
            let 群号 = groupList[i]["group_id"];
            let 群名 = groupList[i]["group_name"];
            let 现人数 = groupList[i]["member_count"];
            let 可人数 = groupList[i]["max_member_count"];
            let 状态 = readB(`筱筱吖/事件系统/${群号}.json`, "整点报时", "关闭");
            if(状态 == "开启"){
                let fakeEvent = {message_type: "group", group_id: 群号};
                sendReply(fakeEvent, `又是一个整点哎！`, ctx);
            }
            let 全群打卡 = readB(`筱筱吖/事件系统/全局.json`, "全群打卡", "关闭");
            if(全群打卡 == "开启"){
                let 打卡状态 = readB(`筱筱吖/全群打卡/打卡状态/${今天}.json`, 群号, "未");
                if(打卡状态 == "未"){
                    writeB(`筱筱吖/全群打卡/打卡状态/${今天}.json`, 群号, "已");
                    let 参数 = {group_id : 群号};
                    BOTAPI(ctx, "send_group_sign", 参数);
                }
            }
        }
    }
}



// ================== 插件初始化 ==================
const plugin_init = async (ctx) => {
  logger = ctx.logger;
  dataPath = ctx.configPath ? path.dirname(ctx.configPath) : "./data";
  
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }
  
  setDataPath(dataPath);
  
  logger.info("没事别更新！更新前要记得备份！");
  logger.error("没事别更新！更新前要记得备份！");
  logger.warn("没事别更新！更新前要记得备份！");
  
  // ================== data数据转移 ==================
  logger.warn("正在进行文件夹数据转移，请等待加载完成！");
  let 配置文件路径 = path.join(ctx.pluginPath, 'package.json');//获取配置文件路径的
  let read = JSON.parse(fs.readFileSync(配置文件路径, 'utf-8'));//读文件的
  let 文件夹名字 = read["name"];
  // ================== 转移 ==================
  const 即将转移文件夹 = path.join(ctx.pluginPath, 'data');//获取指定文件夹路径
  const 正式目录 = path.join(ctx.pluginPath, '..', '..', 'config', 'plugins', 'napcat-plugin-mkbot');
  try {
     fs.cpSync(即将转移文件夹, 正式目录, { recursive: true, force: true });
      //fs.rmSync(即将转移文件夹, { recursive: true, force: true });//删除
      logger.warn("已完成data文件夹数据转移！");
  } catch (error) {
      logger.error(`移动失败: ${error.message}`);
      logger.error(`移动失败: ${error.message}`);
      logger.error(`移动失败: ${error.message}`);
      logger.error(`移动失败: ${error.message}`);
  }
  
  logger.info("MK 插件已初始化");
  
  // 【配置面板】
  const configPath = ctx.configPath;
  let currentConfig = {};
  
  if (!fs.existsSync(configPath)) {
    currentConfig = { OwnerQQs: [], nowoner: true, nowonernr: "你不是她......." };
    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
    logger.info("配置文件已创建");
  } else {
    try {
      currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      if (typeof currentConfig.OwnerQQs === 'string') {
        const qqArray = currentConfig.OwnerQQs
          .split(/[,，、\s&|]+/)
          .map(qq => qq.trim())
          .filter(qq => qq && /^\d+$/.test(qq));
        currentConfig.OwnerQQs = qqArray;
      }
      
      if (currentConfig.nowoner === undefined) {
        currentConfig.nowoner = true;
      }
      
      if (currentConfig.nowonernr === undefined) {
        currentConfig.nowonernr = "你不是她.......";
      }
      
      fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
    } catch (e) {
      logger.error("配置文件格式错误，使用默认配置");
      currentConfig = { OwnerQQs: [], nowoner: true, nowonernr: "你不是她......." };
    }
  }
  
  const ownerQQsArray = currentConfig.OwnerQQs || [];
  const ownerQQsDisplay = Array.isArray(ownerQQsArray) ? ownerQQsArray.join(", ") : "";
  const nowoner = currentConfig.nowoner ?? true;
  const nowonernr = currentConfig.nowonernr ?? "你不是她.......";
  
  plugin_config_ui = [
    ctx.NapCatConfig.text("OwnerQQs", "主人 QQ", ownerQQsDisplay, "多个 QQ 用逗号分隔，如：123456,789012"),
    ctx.NapCatConfig.boolean("nowoner", "非主人回复开关", nowoner),
    ctx.NapCatConfig.text("nowonernr", "非主人回复", nowonernr)
  ];
  
  // 【定时任务】每秒执行一次
  setInterval(async () => {
    await handleScheduledTask(ctx);
  }, 1000);

  // 【WebUI 路由】
  try {
    const base = ctx.router;
    const ROUTE_PREFIX = "/mkbot";
    
    const wrapPath = (p) => {
      if (!p) return ROUTE_PREFIX;
      return p.startsWith("/") ? `${ROUTE_PREFIX}${p}` : `${ROUTE_PREFIX}/${p}`;
    };

    if (base && base.static) {
      base.static(wrapPath("/static"), "webui");
    }

    if (base && base.get) {
      base.get(wrapPath("/static/plugin-info.js"), (_req, res) => {
        try {
          res.type("application/javascript");
          res.send(`window.__PLUGIN_NAME__ = ${JSON.stringify(ctx.pluginName)};`);
        } catch (e) {
          res.status(500).send("// failed to generate plugin-info");
        }
      });

      base.get(wrapPath("/config"), (_req, res) => {
        try {
          const configPath = ctx.configPath;
          let config = {};
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          }
          res.json({ code: 0, data: config });
        } catch (error) {
          logger?.error("获取配置失败:", error);
          res.status(500).json({ code: -1, message: "获取配置失败" });
        }
      });

      base.get(wrapPath("/groups"), async (_req, res) => {
        try {
          const groups = await ctx.actions.call(
            "get_group_list",
            {},
            ctx.adapterName,
            ctx.pluginManager.config
          );
          res.json({ code: 0, data: { groups: groups || [] } });
        } catch (error) {
          logger?.error("获取群聊列表失败:", error);
          res.status(500).json({ code: -1, message: "获取群聊列表失败" });
        }
      });

      base.get(wrapPath("/friends"), async (_req, res) => {
        try {
          const friends = await ctx.actions.call(
            "get_friend_list",
            {},
            ctx.adapterName,
            ctx.pluginManager.config
          );
          res.json({ code: 0, data: { friends: friends || [] } });
        } catch (error) {
          logger?.error("获取好友列表失败:", error);
          res.status(500).json({ code: -1, message: "获取好友列表失败" });
        }
      });

      if (base.post) {
        base.post(wrapPath("/config"), async (req, res) => {
          try {
            let body = req.body;
            if (!body || Object.keys(body).length === 0) {
              try {
                const raw = await new Promise((resolve) => {
                  let data = "";
                  req.on("data", (chunk) => data += chunk);
                  req.on("end", () => resolve(data));
                });
                if (raw) body = JSON.parse(raw);
              } catch (e) {
                logger?.error("解析请求体失败:", e);
              }
            }

            const configPath = ctx.configPath;
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true });
            }

            let config = {};
            if (fs.existsSync(configPath)) {
              config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }

            Object.assign(config, body || {});
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

            logger?.info("配置已保存");
            res.json({ code: 0, message: "ok" });
          } catch (error) {
            logger?.error("保存配置失败:", error);
            res.status(500).json({ code: -1, message: "保存配置失败" });
          }
        });
      }

      if (base && base.get) {
        base.get(wrapPath("/announcement"), async (_req, res) => {
          try {
            const https = await import('https');
            
            // 获取请求中的 key 参数
            const key = _req.query?.key || '';
            
            // 构建远程 API URL，添加 key 参数
            let remoteUrl = 'https://cnmb.xiaoyaxiao.xin/mkbot/';
            if (key) {
              remoteUrl += '?key=' + encodeURIComponent(key);
            }
            
            const request = https.get(remoteUrl, (response) => {
              let data = '';
              response.on('data', (chunk) => {
                data += chunk;
              });
              response.on('end', () => {
                try {
                  const jsonData = JSON.parse(data);
                  res.json({ code: 0, data: jsonData.data || [] });
                } catch (e) {
                  logger?.error("解析公告 JSON 失败:", e.message);
                  res.status(500).json({ code: -1, message: "解析公告失败" });
                }
              });
            });
            
            request.on('error', (error) => {
              logger?.error("获取公告失败:", error.message);
              res.status(500).json({ code: -1, message: "获取公告失败: " + error.message });
            });
            
            request.setTimeout(5000, () => {
              request.destroy();
              res.status(500).json({ code: -1, message: "获取公告超时" });
            });
          } catch (error) {
            logger?.error("获取公告失败:", error.message);
            res.status(500).json({ code: -1, message: "获取公告失败: " + error.message });
          }
        });
      }

      if (base.page) {
        base.page({
          path: "mkbot-dashboard",
          title: "MKbot插件",
          icon: "",
          htmlFile: "webui/dashboard.html",
          description: "管理 MKbot 插件功能"
        });
        logger?.info("WebUI 页面已注册");
      }
    }

    logger?.info("WebUI 路由已注册");
  } catch (e) {
    logger?.warn("注册 WebUI 路由失败:", e);
  }

    // ================== 配置数据 ==================
    let 数据 = readB("筱筱吖/重启进程/数据.json", "data", {});
    let ppp = (数据?.开关 || false);
    if(ppp && 数据["开关"] == true){
        //logger?.error("000000");//调试
        let fakeEvent = {message_type: "group", group_id: 数据["回复目标"]};
        let ID = 数据?.回复ID;
        let 计算时间 = Math.floor(Date.now() / 1000) - 数据?.记录时间;
        let 组装消息 = `重启完成啦～！`;
        组装消息 += `\n本次耗时:${计算时间}秒`;
        sendReply(fakeEvent, `[CQ:reply,id=${ID}]${组装消息}`, ctx);
        clear("筱筱吖/重启进程/数据.json");
    }
    //logger?.error("11111111");//调试
    // ================== 检 ==================
};

const plugin_onmessage = async (ctx, event) => {
  if (event.post_type === "message") {
    const message = event.raw_message?.trim() || "";
    let reply = await handleMessage(message, event, ctx);
    
    if (reply) {
      if (reply.type === "delay") {
        for (const item of reply.messages) {
          if (item.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, item.delay));
          }
          await sendReply(event, item.text, ctx);
        }
      }
      else if (Array.isArray(reply)) {
        for (const msg of reply) {
          await sendReply(event, msg, ctx);
        }
      }
      else {
        await sendReply(event, reply, ctx);
      }
    }
  }
};

const plugin_onevent = async (ctx, event) => {
  if (event.post_type === "notice") {
    await handleNotice(event, ctx);
  } else if (event.post_type === "request") {
    await handleRequest(event, ctx);
  }
};

function plugin_on_config_change(ctx, _, key, value) {
  const configPath = ctx.configPath;
  
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      config = {};
    }
  }
  
  if (key === "OwnerQQs") {
    const qqArray = value
      .split(/[,，、\s&|]+/)
      .map(qq => qq.trim())
      .filter(qq => qq && /^\d+$/.test(qq));
    
    config.OwnerQQs = qqArray;
    logger?.info(`主人 QQ 已更新: ${qqArray.join(", ")}`);
  }
  
  if (key === "nowoner") {
    config.nowoner = value;
    logger?.info(`认主已${value ? "启用" : "禁用"}`);
  }
  
  if (key === "nowonernr") {
    config.nowonernr = value;
    logger?.info(`非主人回复已更新`);
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export { 
  plugin_init, 
  plugin_onmessage, 
  plugin_onevent, 
  plugin_config_ui, 
  plugin_on_config_change,
  // 导出工具函数供外部使用
  readA, readB, writeA, writeB, deleteKey, hasKey, getKeys, clear,
  timeA, timeB, rand, moneyA, downloadFile,
  sendReply, sendForward, giveAT, giveImages, giveText, BOTAPI,
  checkAuthStatus, getAuthStatus, setAuthStatus,
  getDataPath, setDataPath,
  getSystemInfo, getProcessList, puppeteer
};
