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

---

## 🛠️ 项目结构

```text
SparkSub/
├── background/           # Service Worker（网络捕获、跨域代理、标签页状态同步）
│   └── service-worker.js
├── content/              # 内容脚本（Shadow DOM 滚动面板、主世界 Bridge）
│   ├── app.js            # 核心状态机与数据流调度器
│   ├── rolling-panel.js  # 独立 Shadow DOM 伴随面板组件
│   └── main-world-bridge.js
├── core/                 # 核心模块（解析器、格式化器、多语言、JSZip 引擎）
│   ├── formatters.js     # SRT, VTT, TXT, JSON, Merged Markdown
│   ├── parsers.js        # B站 XML, JSON, YouTube TimedText
│   ├── jszip.js          # 无依赖轻量级 ZIP 打包引擎
│   ├── utils.js          # 会话快照、DOM 工具、防抖
│   └── i18n.js           # 国际化文案
├── platform/             # 平台适配器
│   ├── youtube.js        # YouTube 轨道发现与解密
│   └── bilibili.js       # B站 WBI 鉴权、多P与合集爬取、DASH 提取
├── sidepanel/            # 独立侧边栏 UI 与逻辑
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── tests/                # 自动化单元测试套件
│   └── run-tests.mjs
└── manifest.json         # Chrome MV3 清单文件
```

---

## 🧪 测试与质量验证

项目内置了完整的单体与集成测试套件，无需额外依赖即可直接运行：

```bash
node tests/run-tests.mjs
```

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
