# SparkSub (闪幕 / Sparkle Sub) ✨

> **点亮视频里的每一行字** —— 为 YouTube 与哔哩哔哩打造的下一代音视频文稿助手与 AI 生产力浏览器扩展。

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](manifest.json)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

---

## 🌟 核心特性

- **📺 播放器旁伴随滚动面板 (Rolling Panel)**
  - 自动吸附在播放器右侧，随播放进度实时平滑滚动并高亮当前句。
  - 自由切换 **智能多行换行** 与 **单行纯文本** 模式，支持字号与行高微调。
  - 支持关键词秒级检索与点击任意台词跳转播放进度。
  - 全屏沉浸模式与剧场模式自适应。

- **📑 Chrome 独立侧边栏 (Sidepanel)**
  - 时间戳视图、纯文本视图与 AI 提示词视图无缝切换。
  - 毫秒级多语言与双语轨道切换。
  - 针对无字幕视频的精准状态侦测与空状态提示。

- **⚡ B 站合集/多P 一键批量收割 (Batch Harvest)**
  - 一键扫描整个分P列表、电视剧/番剧季、UP 主自选合集与系列。
  - 智能多线程并行抓取，支持勾选/反选与选择性导出。
  - **Merged Markdown**：自动合并全集为带层级目录与自然段落分段的完整知识库文档。
  - 打包生成标准 ZIP，内含 TXT、SRT、VTT、JSON 及合集总览。
  - **DASH 纯音频提取**：直接获取官方纯音频流直链，方便导入 Whisper / 播客剪辑。

- **🔔 UP 主与课程合集订阅追踪中心 (Tracker & Unattended Harvest)**
  - **智能订阅感知**：在任意播放页一键关注 UP 主或订阅专属专题合集 / 多 P 连载。
  - **后台无人值守自动巡检**：基于 `chrome.alarms` 定时巡检，内置纯 JS MD5 + WBI 签名加密与 YouTube 官方 RSS 解析。
  - **新视频字幕自动秒级抓取**：巡检发现新发布视频后，后台自动拉取官方字幕并转换为排版整洁的 Markdown 文档缓存于本地。
  - **极速生产力交互**：更新卡片支持 **「📋 复制 MD」**（一键复制完整字幕）、**「👁️ 预览」**（卡片内原位展开阅读）与 **「📋 合并复制未读」**（多篇长文一并打包复制）。
  - **更新触达与角标**：扩展图标未读角标提示 + 系统桌面弹窗提醒。
  - **配置导入与导出**：一键导出为标准 JSON 备份或跨浏览器快速迁移。

- **📥 无需播放的后台转录队列**
  - 加入队列后由 MV3 Service Worker 独占调度；视频标签页可以关闭，任务仍按“平台字幕优先、本机 ASR 兜底”完成整条视频。
  - 关闭标签页后，YouTube 公共视频由固定版本的 `yt-dlp_macos` 先盘点，并按人工字幕、自动 CC、翻译字幕逐轨尝试（每次只下载一轨）；全部不可用时才获取 M4A/MP4 音频。Bilibili 复用受限 DASH 音频描述符，不把带签名地址写入持久存储。
  - 普通话路由到本地 Cohere，英语及受支持的欧洲语言路由到 Parakeet。粤语只使用 YouTube/Bilibili 平台字幕；平台无字幕时会明确失败，不会误用普通话模型。
  - 队列保存字幕语言与 `manual / auto / translated` 轨道类型；卡片显示真实来源（平台字幕、Parakeet 或 Cohere）、稳定错误码、脱敏建议和是否可重试。

- **🤖 AI 生产力工作流无缝对接**
  - 内置 4 套开箱即用的专业 AI 提示词模板（长文精读速览、分点核心提炼、行动清单生成、双语逐句对照）。
  - 一键复制格式化 Markdown 文本，直接粘贴至 ChatGPT、Claude、DeepSeek、Gemini 或 Notion。

- **🛡️ 极致鲁棒的状态机与零脏数据架构**
  - WBI 官方权威接口优先校验，彻底消除旧接口对无字幕视频的脏数据污染。
  - 智能会话快照（`SessionSnapshotManager`）实现秒开恢复与原子化生命周期管理。
  - 全流程诊断面板，一键复制错误阶段与调试日志。

---

## 🚀 快速安装

1. 克隆或下载本仓库代码：
   ```bash
   git clone https://github.com/xiepixie/SparkSub.git
   ```
2. 打开 Chrome 或 Chromium 内核浏览器（Edge / Brave / Arc / 360 等），在地址栏访问：
   ```text
   chrome://extensions
   ```
3. 打开右上角的 **“开发者模式”** 开关。
4. 点击 **“加载已解压的扩展程序”**，选择项目根目录（包含 `manifest.json` 的目录）。
5. 打开或刷新任意 [YouTube](https://www.youtube.com) 或 [Bilibili](https://www.bilibili.com) 视频即可即刻体验！

### 可选：安装 macOS 本机转录服务

要求 **macOS 14+、Apple Silicon**。本机服务用于“关闭 YouTube 标签页后继续读取公共字幕”以及“平台无字幕时继续离线转录”；打开的 YouTube 页面和 Bilibili 平台字幕链路仍可独立工作。

1. 在 `chrome://extensions` 的 SparkSub 卡片中复制 32 位扩展 ID。
2. 先检查安装计划（不构建、不联网、不写文件）：

   ```bash
   ./native/scripts/install-host.sh --extension-id <扩展ID> --chrome --dry-run
   ```

3. 确认后安装：

   ```bash
   ./native/scripts/install-host.sh --extension-id <扩展ID> --chrome
   ```

   Chromium 用户将 `--chrome` 改为 `--chromium`。安装器以 release 模式构建 Swift host，并仅在官方校验清单和固定 SHA-256 均通过后安装 `yt-dlp_macos` 2026.08.19。若只处理 Bilibili，可添加 `--skip-ytdlp`。

4. 诊断本机组件：

   ```bash
   "$HOME/Library/Application Support/SparkSub/SparkSubHost" --diagnose
   ```

卸载可同时清理 Chrome 与 Chromium 注册信息；用户模型与 `SparkSub/Models` 兼容别名会保留：

```bash
./native/scripts/uninstall-host.sh --extension-id <扩展ID> --chrome --chromium
```

### 本地模型发现边界

- Parakeet：`~/Library/Application Support/parakeet-tdt-0.6b-v3/`。需要四个完整 `.mlmodelc` 目录和有效的 `parakeet_vocab.json` 或 `parakeet_v3_vocab.json`。
- Cohere：搜索 `~/Library/Application Support/FluidAudio/Cohere`、`FluidAudio/Models/Cohere`、`Cohere`，以及 `~/Library/Caches/FluidAudio/CompiledCohereModels`、`~/Library/Caches/cohere-transcribe-03-2026-CoreML-6bit` 下一级目录。仅文件存在不代表兼容：必须有有效词表，且解码器输入包含 `k_cache_0`。
- 用户模型目录只读；SparkSub 只在 `~/Library/Application Support/SparkSub/Models/` 建立兼容符号链接。`~/Library/Caches` 可能被系统或清理工具回收，丢失后界面会显示“部分就绪/模型不兼容”。
- FluidAudio 被固定为 0.15.6，并在进程启动时强制离线模式；本机 host 不下载模型、不读取浏览器 Cookie，只支持公开可访问的视频。

---

## 🛠️ 项目结构

```text
SparkSub/
├── background/           # Service Worker（网络捕获、跨域代理、定时巡检、状态同步）
│   └── service-worker.js
├── content/              # 内容脚本（Shadow DOM 滚动面板、主世界 Bridge）
│   ├── app.js            # 核心状态机与数据流调度器
│   ├── rolling-panel.js  # 独立 Shadow DOM 伴随面板组件
│   └── main-world-bridge.js
├── core/                 # 核心模块（解析器、格式化器、多语言、JSZip、订阅追踪引擎）
│   ├── formatters.js     # SRT, VTT, TXT, JSON, Merged Markdown
│   ├── parsers.js        # B站 XML, JSON, YouTube TimedText
│   ├── tracker.js        # 纯 JS MD5, WBI 签名, YouTube RSS, 环形缓冲, 自动字幕拉取
│   ├── queue.js          # 持久队列、租约恢复、字幕优先与本机 ASR 回退
│   ├── native-host.js    # Native Messaging 协议、心跳看门狗与分块结果组装
│   ├── jszip.js          # 无依赖轻量级 ZIP 打包引擎
│   ├── utils.js          # 会话快照、DOM 工具、防抖
│   └── i18n.js           # 国际化文案
├── platform/             # 平台适配器
│   ├── youtube.js        # YouTube 轨道发现与解密
│   └── bilibili.js       # B站 WBI 鉴权、多P与合集爬取、DASH 提取
├── sidepanel/            # 独立侧边栏 UI 与追踪中心
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── native/               # macOS Swift/CoreML host 与安全安装脚本
│   ├── SparkSubHost/
│   └── scripts/
├── types/                # 渐进式 TypeScript 类型定义
│   ├── bse.d.ts          # 完整领域模型与状态协议声明
│   └── chrome.d.ts       # Chrome MV3 API 类型补齐
├── docs/                 # 架构与用户场景文档
│   ├── 架构与消息协议.md
│   └── 用户场景与交互设计.md
├── tests/                # 自动化单元测试套件
│   └── run-tests.mjs
└── manifest.json         # Chrome MV3 清单文件
```

---

## 🧪 测试与质量验证

项目内置了完整的单体与集成测试套件，无需额外依赖即可直接运行：

```bash
node tests/run-tests.mjs
node tests/orchestrator-tests.mjs
bash tests/install-host-tests.sh
```

当前 Linux 开发环境没有 Swift/CoreML，因此不能声称 Swift 编译、XCTest、真实模型加载或真实媒体解码已在本机通过。对应门禁由 `.github/workflows/native-host.yml` 的 macOS runner，以及安装后的 Mac 实机诊断/冒烟测试完成。

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
