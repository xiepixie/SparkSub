# SparkSub (闪幕 / Sparkle Sub) ✨

> **点亮视频里的每一行字** —— 为 YouTube 与哔哩哔哩打造的下一代音视频文稿助手与 AI 生产力浏览器扩展。

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](manifest.json)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

---

## ⚡ 1 分钟极速上手（浏览器扩展安装）

本扩展**完全开箱即用，无需任何编译**，下载后直接导入 Chrome 即可使用：

1. **下载或克隆项目**：
   * **方式 A（小白用户）**：点击 GitHub 页面绿色的 **`Code` ➔ `Download ZIP`**，下载并解压到电脑任意文件夹（例如 `Downloads/SparkSub`）；
   * **方式 B（开发者）**：运行命令 `git clone https://github.com/xiepixie/SparkSub.git`。

2. **在浏览器中加载**：
   1. 打开 Chrome 或任何 Chromium 内核浏览器（Edge、Arc、Brave、360 等）；
   2. 在地址栏输入并回车访问：
      ```text
      chrome://extensions
      ```
   3. 打开页面右上角的 **「开发者模式」** 开关；
   4. 点击左上角的 **「加载已解压的扩展程序」**；
   5. 选择刚才解压的 **`SparkSub` 文件夹**（即包含 `manifest.json` 的主目录）。

3. **立即开始使用**：
   * 打开或刷新任意 [Bilibili (bilibili.com)](https://www.bilibili.com) 或 [YouTube (youtube.com)](https://www.youtube.com) 视频；
   * 视频播放器右侧将自动出现**实时伴随滚动面板**，点击浏览器工具栏图标即可展开**独立侧边栏**！

---

## 🌟 核心功能一览

### 1. 📺 播放器旁伴随滚动面板 (Rolling Panel)
- **智能伴随高亮**：自动吸附在播放器右侧，随播放进度实时平滑滚动并精准高亮当前句。
- **排版微调**：自由切换智能多行换行与单行模式，支持字号与行高自定义。
- **点击跳转与秒级检索**：点击任意台词瞬间跳转播放进度，支持关键词实时高亮检索。
- **全屏沉浸适配**：支持全屏与剧场模式自适应布局。

### 2. 📑 Chrome 独立侧边栏 (Sidepanel)
- **多维度视图一键切换**：
  - **`时间戳`**：逐句时间戳对齐，支持点击即跳与快速定位；
  - **`纯文本`**：自然段落流式排版，适合全文速读；
  - **`AI 总结`**：内置多套专业级学习提示词模板；
  - **`追踪更新`**：关注的 UP 主与合集更新看板；
  - **`离线转录`**：后台静默转录任务管理中心。
- **多语言与多音轨即时切换**：毫秒级多语言与双语轨道切换。

- **多语言与多音轨即时切换**：毫秒级多语言与双语轨道切换。

### 3. ⚡ B 站与 YouTube 播放列表 / 合集一键批量收割 (Batch Harvest)
- **全集一键扫描**：自动解析 B 站分 P 列表、电视剧/番剧季、UP 主自选合集/系列，以及 **YouTube Playlist 播放列表与合集拓扑**。
- **Merged Markdown**：自动合并全集为带层级目录与自然段落分段的完整知识库文档。
- **多格式打包**：一键生成标准 ZIP，内含 TXT、SRT、VTT、JSON 及合集总览。
- **DASH / 高清纯音频直链提取**：直接获取官方纯音频流直链，方便导入剪辑或第三方工作流。

### 4. 🔔 UP 主与课程合集订阅追踪中心 (Tracker)
- **一键订阅感知**：在任意播放页一键关注 UP 主或订阅专属连载合集。
- **后台无人值守自动巡检**：基于 `chrome.alarms` 定时巡检，内置纯 JS MD5 + WBI 签名加密与 YouTube RSS 解析。
- **新视频字幕静默抓取**：巡检发现新发布视频后，后台自动拉取官方字幕并转换为排版整洁的 Markdown 文档缓存于本地。
- **极速生产力交互**：更新卡片支持一键复制 MD、原位展开预览与多篇未读合并复制。

### 5. 🎙️ 本地端侧 ASR 离线转录与大模型语义纠错
- **无字幕视频自动兜底**：当视频无官方字幕时，支持一键调用本地端侧模型（CoreML / Parakeet / Cohere）进行纯离线语音识别。
- **智能语言自适应**：自动根据视频标题与平台环境智能调度识别模型（中文视频自动匹配 Cohere 多语言，英文/欧语匹配 Parakeet）。
- **端侧大模型 ASR 吞音与术语纠错**：
  - 自动对接本地端侧大模型（如 Ollama Gemma / Qwen）；
  - **核心准则**：`原声保真 > ASR 纠错 > 可读性 > 语法规范`；
  - 精准修复连读吞音、轻读弱读与领域技术专有名词（如 PyTorch, Qwen, LoRA, Codex, GPU 等），保留 1:1 毫秒级时间戳，绝不破坏说话人原本的口吻和交谈感！

---

## 🛠️ 可选：macOS 本机离线转录服务配置 (Apple Silicon)

> [!NOTE]
> 普通在线官方字幕提取、双语机翻、合集导出与订阅追踪**完全开箱即用，无需配置本机服务**。  
> 本机服务仅在“视频本身完全没有字幕轨，需要借助 Mac 本机芯片算力跑离线 CoreML 语音转文字”时使用。

### 方式一：懒人一键配置脚本（小白强烈推荐 🌟）

项目根目录已内置全自动交互式引导脚本，会自动检测环境、编译服务、部署独立引擎并绑定浏览器：

```bash
# 终端进入项目主目录，直接运行：
./setup.sh
```

**交互流程**：
1. 脚本自动检测系统与 Apple Silicon 芯片架构；
2. 提示输入 Chrome 扩展的 32 位 ID（若之前已绑定过，直接**敲回车**即可沿用）；
3. 自动完成本机服务编译与独立 `yt-dlp` 抓取引擎安装；
4. 自动运行自检诊断，输出绿色成功对勾！

> **自动化命令（非交互）**：  
> 若要无人值守或自动化部署，可执行：`./setup.sh --id <你的32位扩展ID> --yes`

---

### 方式二：手动配置（高级开发者）

1. 打开 `chrome://extensions`，在 SparkSub 卡片中复制 32 位扩展 ID；
2. 终端执行底层安装脚本：
   ```bash
   ./native/scripts/install-host.sh --extension-id <你的扩展ID> --chrome
   ```
   *(非 Chrome 浏览器用户可将 `--chrome` 替换为 `--chromium`)*
3. 运行自检诊断命令检查就绪状态：
   ```bash
   "$HOME/Library/Application Support/SparkSub/SparkSubHost" --diagnose
   ```

---

## ❓ 常见问题与排障指南 (FAQ)

<details>
<summary><b>Q1: 为什么安装本机服务后提示“Python.framework 已损坏”？</b></summary>

> **解答**：这是旧版本使用 PyInstaller 单文件打包触发的 macOS Gatekeeper 误报拦截。  
> **当前版本已彻底根除该机制**，切换为内存级纯净独立的 Python Zipapp 引擎，绝不会解压产生任何临时 `.framework` 动态库，永久杜绝系统弹窗。若之前有残留，运行 `./setup.sh` 会自动清洗并升级至无弹窗安全版本。
</details>

<details>
<summary><b>Q2: YouTube 视频首次加载字幕很慢或偶发超时怎么办？</b></summary>

> **解答**：SparkSub 为 YouTube 提供了双重极速通道：
> 1. **服务端直译通道**：自动探测服务端直链，通常在 100ms 内秒级呈现中文字幕；
> 2. **渐进式滚动呈现**：遇到大篇幅多批次翻译时，第 1 秒立即先显示源语言英文滚屏字幕，后台翻译完成后无缝平滑置换中文，零等待感知。
</details>

<details>
<summary><b>Q3: Windows 或 Linux 用户可以使用 SparkSub 吗？</b></summary>

> **解答**：完全可以！SparkSub 的全部浏览器扩展核心功能（B站/YouTube 伴随滚动面板、合集全集批量导出打包、全文 Markdown、UP主订阅追踪等）均基于纯标准 Web API 实现，在 **Windows / macOS / Linux** 的 Chrome、Edge、Brave、Arc 浏览器上均能 100% 完美开箱即用。本地 CoreML 端侧 ASR 服务目前仅针对 Apple Silicon 芯片提供硬件加速。
</details>

---

## 📁 项目结构

```text
SparkSub/
├── background/           # Service Worker（网络捕获、跨域代理、定时巡检、状态同步）
│   └── service-worker.js
├── content/              # 内容脚本（Shadow DOM 滚动面板、主世界 Bridge）
│   ├── app.js            # 核心状态机与数据流调度器
│   ├── rolling-panel.js  # 独立 Shadow DOM 伴随面板组件
│   └── main-world-bridge.js
├── core/                 # 核心模块（解析器、格式化器、多语言、JSZip、语义纠错）
│   ├── formatters.js     # SRT, VTT, TXT, JSON, Merged Markdown
│   ├── parsers.js        # B站 XML, JSON, YouTube TimedText
│   ├── asr-polisher.js   # 本地端侧大模型语义纠错与时间戳 1:1 回填
│   ├── tracker.js        # 纯 JS MD5, WBI 签名, YouTube RSS, 自动字幕拉取
│   ├── queue.js          # 持久队列、租约恢复、字幕优先与本机 ASR 回退
│   ├── native-host.js    # Native Messaging 协议与心跳看门狗
│   ├── jszip.js          # 无依赖轻量级 ZIP 打包引擎
│   ├── utils.js          # 会话快照、DOM 工具、防抖与安全下载
│   └── i18n.js           # 国际化文案体系
├── platform/             # 平台适配器（B站 WBI 鉴权、DASH 音频提取、YouTube 轨道解析）
├── sidepanel/            # 独立侧边栏 UI 与追踪中心
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── native/               # macOS Swift/CoreML host 源码与安装脚本
├── types/                # TypeScript 类型定义与 Chrome API 声明
└── manifest.json         # Chrome MV3 清单文件
```

---

## 🧪 自动化测试验证

项目内置了完整的单元测试与端到端断言，无需任何三方 npm 依赖：

```bash
node tests/run-tests.mjs
```

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 协议开源。
