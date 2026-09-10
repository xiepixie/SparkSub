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

### 6. 🤖 AI 图文报告与多模态学习工作台 (Visual Course Notes)
- **文本规划与媒体执行分层**：学习提示词使用普通 Markdown 与自然中文；字幕时间写成 `00:12  文本`，ASR 回填用 `L0001 | 文本`，图片引用用 `![说明](frame://00:12)`。阶段一只根据字幕语义输出 `samplingWindows` 时间窗口 JSON，播放器后续才负责真实取样与筛帧；历史 `visualRequests / visualEvidence` 只在兼容层接受。
- **跨学科内容自适应**：数学/理工、软件教程、人文社科、访谈演讲、艺术设计和纪录片按各自的信息结构组织报告，不把所有视频硬套成“定理 + 避坑 + 解题动作”。
- **宽覆盖截图 + 两级筛选**：模型可以为重要内容给出较多候选窗口；每个窗口先用低分辨率像素签名选出 1 张代表图，再用保留二维空间结构的紧凑 fingerprint 做跨窗口去重与时间覆盖筛选。显式 seek 必须确认目标画面已完成寻道/解码才允许截图；最终证据帧约 `1536px / WebP 0.90`，用户手动截图优先保留。
- **候选不等于缓存**：低分辨率 fingerprint、评分和未入选候选只存在当前运行内存；只有最终选中的图片进入多模态请求与 IndexedDB，因此可以提高截图覆盖率而不让长期存储随候选数膨胀。
- **精选拼图替代跨站拖拽**：移除 Side Panel 中不可靠的“拖拽全部”。直接给网页版 AI 时底层硬限制最多 4 张生成受控尺寸联系表并复制到剪贴板；需要全部原图则使用 ZIP 打包。阶段二合成提示词只引用最后一次真正投递的图片集合，避免提示词与网页端实际收到的图片数量不一致。
- **报告图片完整显示**：图片卡片使用 `contain`，不再用固定高度裁图；点击缩略图打开原图预览，时间按钮单独负责跳回视频。
- **可验证的模型配置**：顶部始终显示已保存的生成模型；“测试当前模型”会真实调用输入框里的准确模型，并显示服务实际返回模型、延迟和短响应。目录探测不会自动替用户切换模型，未保存配置也不会悄悄用于生成。
- **本地 AI 网关与最小权限**：扩展只直连 `http://localhost` / `http://127.0.0.1` 的 OpenAI-compatible / Ollama 网关；云端模型通过用户自己的本地网关转发，不申请任意公网访问权限。文本测试不等同于多模态图片能力验证。
- **安全图文渲染与兼容导出**：AI/外部导入 Markdown 默认按不可信文本处理；`frame://` 图片引用和历史 `[SCREENSHOT: ...]` 共用帧解析 seam，精确时间缺失时只在约 ±5 秒内选择真正最近帧，渲染、删除和 ZIP 导出保持一致。
- **媒体身份防串流**：截图与生成任务锁定启动时的 `tabId + mediaKey`；Bilibili 离线转录进一步以精确 `BVID + CID` 为身份，执行前会重新解析并验证当前分P，字幕缓存也必须带相同 owner。播放器/Side Panel 的“离线转录”是独立 `local-asr` 意图，不会再先复用打开标签页或平台字幕缓存；切视频/切标签页后旧任务和晚到结果都不能覆盖新媒体。
- **持久化本地缓存**：讲义按视频自动落盘，图片以版本集写入 IndexedDB；Markdown 指针与 LRU 索引提交成功后才清旧图片，同一视频保存串行执行。缓存继续受数量、总容量和有效期回收策略约束。

---

## 🛠️ 可选：macOS 本机离线转录服务配置 (Apple Silicon)

> [!NOTE]
> 普通在线官方字幕提取、双语机翻、合集导出与订阅追踪**完全开箱即用，无需配置本机服务**。  
> 本机服务仅在“视频本身完全没有字幕轨，需要借助 Mac 本机芯片算力跑离线语音转文字”时使用。
>
> 浏览器与本机执行层统一使用能力导向的 `sparkscribe.browser-native/2` Contract。SparkSub 不依赖 Parakeet、Cohere、Qwen 等具体模型名；实际可转录语言由 Native Host capability 决定。当前安装脚本会优先使用 `/Applications/SparkScribe.app` 内置的 `SparkSubNativeHost`，只有 SparkScribe readiness 不完整或用户显式要求时才回退到 `native/SparkSubHost`。详见 `docs/native-contract-v2.md`。视频身份与 AI 语义上下文严格分离；Bilibili 标题/UP主/分区/标签/简介及 YouTube 标题/频道/keywords 等如何进入动态 AI context，见 `docs/media-context-contract.md`。

### 方式一：一键配置

项目根目录的安装流程会自动选择可用执行层、绑定浏览器并完成就绪检查：

```bash
# 终端进入项目主目录，直接运行：
./setup.sh
```

**交互流程**：
1. 脚本自动检测系统与 Apple Silicon 芯片架构；
2. 提示输入 Chrome 扩展的 32 位 ID（若之前已绑定过，直接**敲回车**即可沿用）；
3. 若 SparkScribe 的 bundled helper readiness 完整，则直接绑定它；否则构建并安装 standalone 兼容 Host；
4. 自动运行当前 Host 的 capability/诊断检查并报告实际可用能力。

> **自动化命令（非交互）**：  
> 若要无人值守或自动化部署，可执行：`./setup.sh --id <你的32位扩展ID> --yes`

---

### 方式二：手动配置（高级开发者）

1. 打开 `chrome://extensions`，在 SparkSub 卡片中复制 32 位扩展 ID；
2. 终端执行底层安装脚本：
   ```bash
   ./native/scripts/install-host.sh --extension-id <你的扩展ID> --chrome
   ```
   默认 `auto` 模式优先 SparkScribe；可用 `--sparkscribe` 强制 bundled helper，或用 `--standalone` 强制兼容 Host。非 Chrome 浏览器可将 `--chrome` 替换为 `--chromium`。
3. SparkScribe 接管时可直接检查 readiness：
   ```bash
   /Applications/SparkScribe.app/Contents/Helpers/SparkSubNativeHost --browser-native-readiness
   ```
   若安装器回退到 standalone Host，则继续使用其 `--diagnose` 诊断入口。

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
