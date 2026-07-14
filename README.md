<div align="center">

![MKbot](assets/chajian.jpg)

# MKbot

**综合娱乐 & 群管插件 · v2.3.6.alpha.3**

[![版本](https://img.shields.io/badge/版本-2.3.6.alpha.3-blue)](https://github.com/tc-404/napcat-plugin-mkbot)
[![作者](https://img.shields.io/badge/作者-三个句号-orange)](https://github.com/tc-404)
[![框架](https://img.shields.io/badge/框架-NapCat_/_咔咔珂-green)](https://github.com/NapNeko/NapCatQQ)
[![协议](https://img.shields.io/badge/协议-MIT-yellow)](LICENSE)

</div>

---

## 📖 简介

MKbot 是一款面向 **NapCat / 咔咔珂** 的综合型 QQ 群插件，集群管、娱乐、经济、发卡、空间互动、多媒体解析与可视化后台于一体。

当前版本 **2.3.6.alpha.3** 基于 **TypeScript + Vite** 源码构建，采用模块化拆分，支持 **HTML（Puppeteer）/ Sharp** 双渲染模式，并新增 QQ 邮箱、离线通知、消息记录、入群验证等扩展能力。

---

## 🆕 本版本亮点（v2.3.6.alpha.3）

| 类别 | 更新内容 |
|------|----------|
| 🖼️ **Sharp 渲染** | 菜单、今日运势、签到、运行状态、入群身份、鱼获等支持 Sharp 本地渲染，减少 Puppeteer 依赖 |
| 📦 **依赖管理** | Sharp 运行时依赖可后台一键安装，自动写入 `data/runtime-deps`，避免热重载打断 |
| 📧 **QQ 邮箱** | 支持主/备双邮箱配置，用于掉线通知与发卡二次发送 |
| 🔔 **离线通知** | 监听 `bot_offline` 事件，机器人掉线后邮件通知主人 |
| 🛒 **发卡 WebUI** | 后台「扩展功能 → 发卡系统」可视化管理商品、库存、上下架 |
| 📝 **消息记录** | 群聊/私聊消息持久化记录，支持撤回追回与临时图床 |
| 🚪 **入群验证** | 支持随机数字 / 随机字母 / 随机算式（测试功能开启后含乘除） |
| 🪦 **骨灰筛选** | 支持七日 / 半月 / 一月及自定义标准，批量获取长期不活跃成员 |
| 🤖 **群管家对接** | 采集 Q 群管家 token，对接自动回复能力 |
| 🔁 **双框架兼容** | NapCat / 咔咔珂自动识别，Snowluma 兼容层适配 |

---

## ✨ 功能总览

### 🛡️ 群管系统

支持 **22 项事件开关**，可按群独立配置：

`禁言通知` · `入群审核` · `邀人统计` · `自助头衔` · `伪造聊天` · `黑白名单` · `退群拉黑` · `退群通知` · `整点报时` · `禁发红包` · `入群欢迎` · `违禁检测` · `进阶检测` · `发言统计` · `群聊续火` · `视频解析` · `问答系统` · `管理模式` · `入群验证` · `马甲系统` · `入群私聊` · `消息记录`

| 功能 | 说明 | 指令示例 |
|------|------|----------|
| **快捷禁言** | 时/天/周/月单位快速禁言 | `禁言 @成员 1天` |
| **发言限制** | 字数 / 行数 / 艾特次数限制（需进阶检测） | `发言限制 字数 200` |
| **清屏** | 批量撤回近期消息 | `清屏` |
| **违禁检测** | 自定义违禁词，命中自动处理 | `添加违禁词 xxx` |
| **黑白名单** | 入群黑白名单管控 | `黑名单 添加 QQ` |
| **马甲系统** | 群名片前缀格式化 / 全员马甲 | `设置马甲内容 [前缀]` |
| **邀人统计** | 统计邀请人数与排行 | `邀人统计` |
| **骨灰清理** | 按活跃标准筛选长期潜水成员 | `获取半月骨灰群员列表` |
| **入群验证** | 新成员答题验证 | `设置入群验证方式随机算式` |
| **消息记录** | 消息存档 + 撤回追回推送 | 事件开关「消息记录」 |

### 🎮 娱乐系统

| 功能 | 说明 | 指令示例 |
|------|------|----------|
| **群老婆 / 群老公** | 每日随机配对，支持单群/全群 | `今日老婆`、`更换老婆` |
| **漂流瓶** | 跨群匿名抛捞，支持赞/踩 | `抛瓶子 内容`、`捞瓶子` |
| **伪造聊天** | JSON 生成合并转发聊天记录 | `伪造聊天` + JSON |
| **入群私聊收录** | 记录新成员入群私聊并随机回放 | `入群私聊` |
| **钓鱼玩法** | 钓鱼、查鱼获、出售鱼获 | `钓鱼`、`我的鱼获` |
| **打劫 / 签到 / 运势** | 群内经济娱乐与每日互动 | `签到`、`今日运势` |
| **娱乐商店** | 虚拟货币购买道具 | `商店`、`买#道具` |
| **AI 对话** | DeepSeek 智能对话（需配置密钥） | 私聊触发 |

### 🔐 授权 & 卡密

- 天卡 / 周卡 / 月卡 / 半年卡 / 年卡 / 永久卡
- 群聊授权、私聊授权独立管理
- 批量生成卡密、查询剩余时长
- 主人 QQ 白名单与助手模式

### 💳 发卡系统

- 群内指令：添加商品、导入库存、上下架、自动发货
- **WebUI 后台**：商品管理、库存查看、价格配置、邮箱二次发送
- 数据目录：`筱筱吖/扩展功能/发卡系统/`

### 🎬 多媒体解析 API

| 平台 | 功能 |
|------|------|
| 📺 哔哩哔哩 | 视频解析、无水印下载 |
| 🎵 抖音 | 视频解析、无水印下载 |
| ⚡ 快手 | 视频解析、无水印下载 |
| 📕 小红书 | 笔记解析、图片/视频提取 |

### 🌟 QQ 空间

无需扫码，直接利用 NapCat Cookie：

- 发布动态（纯文字 / 纯图片 / 图文混合）
- 获取动态列表
- 点赞 / 评论 / 回复评论

### 💰 经济系统

- 群内虚拟货币
- 每日签到、财富排行榜
- 成员间转账

---

## 🎨 渲染系统

MKbot 支持两种图片渲染模式，可在 **WebUI → 设置 → 渲染开关** 中切换：

| 模式 | 特点 | 适用场景 |
|------|------|----------|
| **HTML** | Puppeteer 截图，效果丰富 | 默认回退方案 |
| **Sharp** | Node 原生渲染，轻量快速 | 菜单、运势、签到、运行状态等 |

Sharp 依赖安装到 `data/runtime-deps/`，可在后台一键安装并查看进度，无需手动 `npm install sharp`。

---

## 🖥️ WebUI 管理后台

访问插件内置 `webui/admin.html`，支持：

- 核心设置：主人 QQ、权限、自触开关
- 事件系统：22 项功能开关，按群管理
- 渲染配置：HTML / Sharp 模式切换、依赖安装
- 扩展功能：发卡系统、QQ 邮箱、离线通知、自动点赞
- 定时消息：注册专属定时推送
- 更新公告：版本更新日志查看
- 数据统计：发言统计、授权状态等

---

## 📦 安装

### 环境要求

- NapCat **>= 4.17.10** 或咔咔珂框架
- Node.js **>= 18**（源码构建推荐 **>= 20**）

### 方式一：下载 Release

1. 从 [Releases](https://github.com/tc-404/napcat-plugin-mkbot/releases) 下载最新包
2. 解压到 NapCat 插件目录
3. 重启框架

### 方式二：源码构建

```bash
git clone https://github.com/tc-404/napcat-plugin-mkbot.git
cd napcat-plugin-mkbot
pnpm install
pnpm build
```

Windows 也可直接双击 `install-build.bat`，Linux/macOS 执行 `install-build.sh`。

构建产物输出至 `napcat-plugin-mkbot/` 目录。

---

## 🚀 快速开始

```
# 查看帮助
MKbot

# 查看授权
授权判断

# 群老婆
群老婆

# 漂流瓶
漂流瓶

# 今日运势
今日运势
```

### 管理员常用

```
生成卡密 天数 数量
卡密列表
取消授权 群号
```

更多指令请发送 `MKbot` 或 `群管` 查看分类菜单。

---

## 📁 项目结构

```
napcat-plugin-mkbot/
├── src/
│   ├── auth/                    # 功能模块
│   │   ├── card-license.ts      # 卡密授权
│   │   ├── card-shop.ts         # 发卡系统
│   │   ├── card-shop-web.ts     # 发卡 WebUI API
│   │   ├── card-shop-mail.ts    # 发卡邮箱二次发送
│   │   ├── group-wife.ts        # 群老婆
│   │   ├── drift-bottle.ts      # 漂流瓶
│   │   ├── fake-chat.ts         # 伪造聊天
│   │   ├── api-interface.ts     # API 接口
│   │   ├── join-group-pm.ts     # 入群私聊
│   │   ├── offline-notify.ts    # 离线通知
│   │   ├── offline-notify-web.ts
│   │   └── qq-mail-web.ts       # QQ 邮箱 WebUI
│   ├── lib/
│   │   ├── api/                 # 各平台 API（B站/抖音/快手/小红书/邮箱/图床）
│   │   ├── sharp-render.ts      # Sharp 菜单渲染
│   │   ├── fortune-sharp-render.ts
│   │   ├── signin-sharp-render.ts
│   │   ├── status-sharp-render.ts
│   │   ├── join-identity-sharp-render.ts
│   │   ├── fish-basket-sharp-render.ts
│   │   ├── wallet-sharp-render.ts
│   │   ├── sharp-loader.ts      # Sharp 运行时加载
│   │   ├── plugin-deps.ts       # 依赖自动安装
│   │   ├── qzone.ts             # QQ 空间
│   │   ├── qun-guanjia.ts       # 群管家
│   │   └── snowluma-compat.ts   # Snowluma 兼容
│   ├── mkbot-core.ts            # 核心逻辑
│   ├── BOT.ts                   # 消息发送封装
│   ├── config.ts
│   ├── data-fs.ts
│   └── index.ts
├── webui/admin.html             # 管理后台
├── data/默认资源/               # 默认 HTML 模板与公告
├── scripts/                     # 构建脚本
├── assets/                      # 静态资源
├── install-build.bat / .sh      # 一键构建
├── plugin.json
├── vite.config.ts
└── VERSION
```

---

## 🔧 开发

```bash
pnpm install      # 安装依赖
pnpm watch        # 监听构建
pnpm typecheck    # 类型检查
pnpm build        # 生产构建
```

### 二次开发引用

```typescript
import { 发消息, 发卡片, readA, writeA, qzonePublishDynamic } from 'napcat-plugin-mkbot';

await 发消息(event, [段_文本('Hello MKbot!')]);
await qzonePublishDynamic({ text: '来自 MKbot 的说说' });
```

---

## 📝 更新日志

### v2.3.6.alpha.3（当前版本）

- 🖼️ Sharp 渲染引擎扩展：菜单、运势、签到、运行状态、入群身份、鱼获等
- 📦 Sharp 运行时依赖后台一键安装
- 📧 QQ 邮箱集成：掉线通知 + 发卡二次发送
- 🛒 发卡系统 WebUI 可视化管理
- 📝 消息记录与撤回追回（含临时图床）
- 🚪 入群验证：数字 / 字母 / 算式三种模式
- 🪦 骨灰群员范围获取与自定义标准
- 🤖 群管家 token 采集对接

### v2.3.6.alpha.2

- 骨灰群员范围获取指令
- MK 介绍内容更新
- 发卡系统 WebUI 栏区
- QQ 邮箱功能上线

### v2.3.6.alpha.1

- 修复违禁检测禁言时长设置
- 修复群老婆菜单文本
- 新增入群验证方式
- 新增消息记录功能

### v2.3.5

- TypeScript 源码化重构
- 发言限制、清屏、数据回档
- 快捷禁言、签到排行榜修复
- Vite 构建 + WebUI 优化

<details>
<summary>更早版本</summary>

**v2.2.x** — 群老婆、漂流瓶、伪造聊天、多平台视频解析

**v2.0.x** — 卡密授权、QQ 空间、发卡系统

</details>

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 发起 Pull Request

---

## 📄 许可证

[MIT License](LICENSE)

---

## 💬 交流

- **GitHub Issues**: [提交问题](https://github.com/tc-404/napcat-plugin-mkbot/issues)
- **作者**: 三个句号

---

<div align="center">

**如果觉得好用，别忘了点个 ⭐ Star 支持一下！**

Made with ❤️ by 三个句号

</div>
