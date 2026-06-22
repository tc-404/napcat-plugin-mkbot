<div align="center">

![MKbot](assets/chajian.jpg)

# MKbot

**综合娱乐 & 群管插件**

[![版本](https://img.shields.io/badge/版本-2.3.5.alpha.3-blue)](https://github.com/tc-404/napcat-plugin-mkbot)
[![作者](https://img.shields.io/badge/作者-三个句号-orange)](https://github.com/tc-404)
[![框架](https://img.shields.io/badge/框架-NapCat_/_咔咔珂-green)](https://github.com/NapNeko/NapCatQQ)
[![协议](https://img.shields.io/badge/协议-MIT-yellow)](LICENSE)

</div>

---

## 📖 简介

MKbot 是一款功能丰富的 **NapCat / 咔咔珂 框架插件**，集娱乐互动、群聊管理、API 接口、QQ 空间等多功能于一体的综合型插件。

采用 **TypeScript** 开发，Vite 构建，支持模块化扩展，持续更新迭代中。

---

## ✨ 功能总览

### 🎮 娱乐系统

| 功能 | 描述 | 指令示例 |
|------|------|----------|
| **群老婆 / 群老公** | 每日随机抽取群成员作为你的老婆/老公，支持单群/全群模式 | `今日老婆`、`我的老公`、`更换老婆` |
| **漂流瓶** | 匿名漂流瓶互动，支持抛/捞/赞/踩，跨群随机投放 | `抛瓶子 内容`、`捞瓶子`、`我的瓶子` |
| **伪造聊天** | 通过 JSON 生成逼真的合并转发聊天记录，支持图片/视频/表情 | `伪造聊天 + JSON数据` |
| **入群私聊收录** | 自动记录新成员入群私聊消息，可随机回放 | `入群私聊` |

### 🔐 授权 & 卡密系统

- **多时长卡密**：支持天卡、周卡、月卡、半年卡、年卡、永久卡
- **群聊授权**：按群独立授权，精细化管理
- **私聊授权**：支持私聊场景授权
- **卡密生成**：管理员可批量生成卡密
- **授权查询**：随时查看授权状态和剩余时长

### 🎬 多媒体解析 API

| 平台 | 状态 | 功能 |
|------|------|------|
| 📺 **哔哩哔哩** | ✅ | 视频解析、无水印下载 |
| 🎵 **抖音** | ✅ | 视频解析、无水印下载 |
| ⚡ **快手** | ✅ | 视频解析、无水印下载 |
| 📕 **小红书** | ✅ | 笔记解析、图片/视频提取 |

### 🌟 QQ 空间功能

**无需扫码登录**，直接利用 NapCat Cookie 实现：

- 📝 **发布动态** - 支持纯文字、纯图片、图文混合
- 📋 **获取动态列表** - 拉取指定用户说说列表
- ❤️ **点赞** - 给指定说说点赞
- 💬 **评论** - 发表评论
- ↩️ **回复评论** - 回复指定评论

### 💳 发卡系统

- 商品管理：添加/删除/上下架商品
- 库存管理：批量导入卡密
- 自动发货：购买后自动提取卡密
- 价格配置：灵活设置商品价格

### 💰 经济系统

- **货币系统**：群内虚拟货币积分
- **签到功能**：每日签到获取货币
- **排行榜**：财富排行榜
- **转账功能**：成员间货币转账

### 🛠️ 开发者工具库

| 工具 | 描述 |
|------|------|
| **数据存储** | `readA` / `writeA` / `readB` / `writeB` 键值存储 |
| **消息发送** | 文本、图片、视频、语音、卡片、音乐卡片、合并转发 |
| **文件操作** | 下载文件、压缩 zip、解压 zip |
| **渲染引擎** | Puppeteer HTML 渲染截图 |
| **系统信息** | 获取系统信息、进程列表 |
| **时间工具** | 时间格式化、时间戳转换 |
| **随机数** | 高质量随机数生成 |

---

## 🎯 特色功能

### 1. 双框架兼容
- ✅ 支持 **NapCat** 框架
- ✅ 支持 **咔咔珂 (kakake)** 框架
- ✅ 自动识别运行环境

### 2. WebUI 管理后台
- 可视化配置管理
- 功能开关一键切换
- 数据统计展示
- 更新公告查看

### 3. 模块化架构
- TypeScript 类型安全
- Vite 极速构建
- 功能模块独立拆分
- 易于扩展和维护

### 4. 智能缓存机制
- 群成员数据缓存
- API 结果缓存
- 减少重复请求
- 提升响应速度

---

## 📦 安装

### 环境要求
- NapCat >= 4.17.10 或 咔咔珂框架
- Node.js >= 18

### 安装方式

#### 方式一：直接下载
1. 下载最新 Release 包
2. 解压到 NapCat 插件目录
3. 重启 NapCat 即可

#### 方式二：源码构建
```bash
# 克隆仓库
git clone https://github.com/tc-404/napcat-plugin-mkbot.git
cd napcat-plugin-mkbot

# 安装依赖
pnpm install

# 构建
pnpm build

# 将构建产物复制到插件目录
```

---

## 🚀 快速开始

### 基础指令

```
# 查看帮助
MKbot

# 查看授权状态
授权判断

# 查看群老婆功能
群老婆

# 查看漂流瓶功能
漂流瓶
```

### 管理员指令

```
# 生成卡密
生成卡密 天数 数量

# 查看卡密列表
卡密列表

# 取消授权
取消授权 群号

# 功能开关管理
（通过 WebUI 配置）
```

---

## 📁 项目结构

```
napcat-plugin-mkbot/
├── src/                    # 源码目录
│   ├── auth/              # 功能模块
│   │   ├── card-license.ts   # 卡密授权
│   │   ├── group-wife.ts     # 群老婆
│   │   ├── drift-bottle.ts   # 漂流瓶
│   │   ├── fake-chat.ts      # 伪造聊天
│   │   ├── api-interface.ts  # API 接口
│   │   └── join-group-pm.ts  # 入群私聊
│   ├── lib/               # 库文件
│   │   ├── api/           # 各平台 API
│   │   │   ├── blbl.ts    # 哔哩哔哩
│   │   │   ├── dy.ts      # 抖音
│   │   │   ├── ks.ts      # 快手
│   │   │   └── xhs.ts     # 小红书
│   │   └── qzone.ts       # QQ空间
│   ├── mkbot-core.ts      # 核心逻辑
│   ├── BOT.ts             # 消息发送封装
│   ├── config.ts          # 配置管理
│   ├── data-fs.ts         # 数据存储
│   ├── types.ts           # 类型定义
│   └── index.ts           # 入口文件
├── scripts/               # 构建脚本
├── webui/                 # Web 管理界面
├── data/                  # 默认资源
├── assets/                # 静态资源
├── plugin.json            # 插件配置
├── package.json           # 项目配置
├── vite.config.ts         # Vite 配置
├── tsconfig.json          # TypeScript 配置
└── VERSION                # 版本号
```

---

## 🔧 开发

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm watch

# 类型检查
pnpm typecheck

# 构建生产版本
pnpm build
```

### 二次开发

本插件导出了丰富的 API，可作为其他插件的依赖库使用：

```typescript
import { 发消息, 发卡片, readA, writeA, qzonePublishDynamic } from 'napcat-plugin-mkbot';

// 发送消息
await 发消息(event, [段_文本('Hello MKbot!')]);

// 发布QQ空间动态
await qzonePublishDynamic({ text: '来自MKbot的说说' });
```

---

## 📝 更新日志

### v2.3.5.alpha.3
- 🔨 全面重构为 TypeScript 源码结构
- 📦 Vite 构建，单文件输出
- 🧩 模块化拆分，功能独立管理
- 🎨 优化 WebUI 管理界面
- ⚡ 性能优化，启动速度提升

### v2.2.x
- 🎮 新增群老婆功能
- 🍾 新增漂流瓶功能
- 💬 新增伪造聊天
- 🎬 新增多平台视频解析

### v2.0.x
- 🔐 卡密授权系统上线
- 🌟 QQ空间功能集成
- 💳 发卡系统上线

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
