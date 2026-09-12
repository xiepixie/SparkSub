# SparkSub 视频内字幕呈现层：产品与实现计划

> 状态：仅规划，尚未进入实现。本文件用于固定本轮调研结论、用户场景、第一版范围、架构边界、实现顺序、风险与验收标准。下一轮开发应以此为基线，除非新的实机证据推翻其中假设。

**目标：** 在当前视频画面上增加 SparkSub 自有字幕呈现层，同时复用现有字幕状态、播放同步、翻译、KaTeX、截图、学习/复习以及媒体身份保护能力。新功能必须增强观看与学习，不得复制出第二套字幕状态机，也不得破坏 Bilibili / YouTube 原生播放器交互。

**产品判断：** 这项功能值得做，但价值不在于“字幕更好看”，而在于补齐 **观看 → 理解 → 捕获 → 学习 → 复习** 中当前缺失的即时入口。视频内字幕只负责当前时刻的低摩擦呈现与轻交互，复杂学习仍回到现有 Side Panel。

**架构判断：** 不重新实现字幕获取、时间轴、翻译或数学排版。新增的是一个薄的 **Video Subtitle Presentation Layer**，消费现有 canonical cues。

**第一阶段平台范围：** Bilibili + YouTube。

---

## 1. 为什么值得做

### 1.1 SparkSub 已经具备大部分高成本底座

当前仓库已经有：

- `content/app.js` 维护当前视频唯一状态；
- 统一的 `tracks / selectedTrackId / cues[] / cueRevision / activeIndex`；
- 基于原生 `timeupdate + requestAnimationFrame` 合并的播放同步；
- `findActiveCueIndex()` 与 Rolling Panel 的增量高亮；
- 平台字幕、SparkScribe 本机 ASR、外部导入、字幕校对与持久化修正；
- 翻译轨与 `translateCues()`；
- `tabId + mediaKey` 的防串台机制；
- 学习笔记里已经稳定工作的 KaTeX；
- 绑定真实媒体时间的高清截图；
- Learn / Review 工作区与 MediaContext。

因此下一步不应该再做一个“视频字幕子系统”，而应该让现有字幕状态多一个呈现 Adapter。

### 1.2 它能明显缩短学习链路

当前用户遇到一句难内容时，往往需要在视频、播放器旁 Rolling Panel、Side Panel 之间来回移动注意力。

目标体验应该是：

```text
看视频
  ↓
当前 SparkSub 字幕直接显示在视频内
  ↓
这一句没听懂 / 没看懂
  ↓
暂停或显式进入 Inspect
  ↓
重播 · 复制 · 摘录 · 解释
  ↓
进入现有 Learn 工作区
  ↓
以后进入 Review
```

因此 Overlay 是**即时入口**，不是知识最终落盘位置。

### 1.3 数学与技术内容是 SparkSub 的真实差异点

WebVTT 非常适合传统字幕：它具备时间、位置、对齐、尺寸和有限的 cue 样式能力。但它不是完整的富文本数学排版系统。

SparkSub 已经有经过调优的 KaTeX 管线，因此 DOM Overlay 可以自然承载：

- 中文 / 英文 + 行内公式；
- 上下标、分式、极限、积分；
- 技术符号与代码标识；
- 后续可交互的词语或术语。

但必须保持一个严格边界：

> **第一版只渲染明确标记的数学公式，不在播放时实时猜测哪些普通 ASR 文本应该转成 LaTeX。**

---

## 2. 本轮调研结论

### 2.1 Language Reactor 说明真正有价值的是“字幕 + 逐句学习动作”

Language Reactor 当前的视频学习体验把以下能力组合在一起：

- 点击词语查看释义；
- 上一句 / 重播当前句 / 下一句；
- 自动暂停；
- 复制和保存当前句；
- 人工翻译 / 机器翻译。

更重要的是，它自己的学习建议并不是“永久盯双语字幕”，而是：先听，再看原文，需要时再看翻译，最后重新听。

这说明 SparkSub 不应该把“学习字幕”等同于“两行文字永远同时显示”，而应该把字幕理解成可以逐步揭示的学习脚手架。

参考：

- https://dev.languagereactor.com/help/basic
- https://www.languagereactor.com/help/studytips

### 2.2 Immersive Translate 暴露了“依赖平台原生字幕”的局限

Immersive Translate 当前 Bilibili 双语字幕流程要求先存在并开启 Bilibili 原生字幕。

SparkSub 不需要沿用这个限制，因为我们的 Overlay 可以只依赖 canonical cues：

```text
平台有没有 CC
        ≠
SparkSub 能不能视频内显示字幕
```

只要已经进入 SparkSub 时间轴，都应该可以显示：

- 平台人工字幕；
- 平台自动字幕；
- 翻译字幕；
- SparkScribe 本机转录；
- 外部导入字幕；
- 校对后的字幕。

参考：

- https://immersivetranslate.com/docs/faq/

### 2.3 asbplayer 说明 Overlay 必须按基础设施来设计

asbplayer 并没有把字幕 Overlay 写成一个简单绝对定位 DIV，而是有专门的 Element Overlay 抽象，处理：

- 非全屏 / 全屏容器；
- top / bottom；
- position offset；
- 宽度；
- DOM cache；
- 响应式尺寸；
- 全屏 reparent。

更值得参考的是它长期真实 Bug：

- 全屏后字幕消失；
- 重复挂载导致双份甚至四份字幕；
- 字幕 z-index 把 Yomitan 词典盖住；
- 播放状态提示反过来盖住自己的字幕；
- 页面存在多个 `<video>` 时绑定错播放器；
- 外部字幕经常需要可调时间偏移。

这些问题说明第一版就必须把 **Owner、Fullscreen、Player Replacement、Layering、Timing Offset** 当核心合同，而不是后期 CSS 修补。

参考：

- https://github.com/asbplayer/asbplayer/blob/main/extension/src/services/element-overlay.ts
- https://github.com/asbplayer/asbplayer/blob/main/extension/src/controllers/subtitle-controller.ts
- https://github.com/asbplayer/asbplayer/blob/main/docs/docs/guides/subtitle-timing.md
- https://github.com/asbplayer/asbplayer/issues/454
- https://github.com/asbplayer/asbplayer/issues/606
- https://github.com/asbplayer/asbplayer/issues/839
- https://github.com/asbplayer/asbplayer/issues/1110

### 2.4 Fullscreen 是结构问题，不是样式问题

Fullscreen API 的核心语义是：全屏元素及其后代进入全屏展示。

如果字幕一直挂在 `document.body`，而真正进入全屏的是内部播放器节点，就不能假设字幕仍然可见。因此 `fullscreenchange`、正确父节点、reparent / remount 必须进入 v1。

参考：

- https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API
- https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenchange_event

### 2.5 WebVTT 继续作为字幕格式有价值，但不是我们交互层的最佳宿主

WebVTT / `VTTCue` 支持字幕时间、位置、尺寸和有限样式，适合标准字幕轨、导出与兼容。

但 SparkSub 视频内字幕还需要：

- KaTeX；
- 两轨独立呈现；
- Inspect；
- 文本选择；
- 学习动作；
- Shadow DOM 样式隔离。

因此呈现层继续使用 DOM Overlay 更合适，不需要把全部能力硬塞进原生 TextTrack。

参考：

- https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API
- https://developer.mozilla.org/en-US/docs/Web/API/VTTCue

### 2.6 字幕位置关系到学习效果与可访问性

W3C 明确提醒字幕不应该遮挡视频中理解内容所必需的信息。

这对 SparkSub 尤其关键，因为数学、代码、PPT、图表等视频的重要信息经常就在画面底部。

因此：

> 固定 `bottom: 24px` 可以作为某个平台某种状态下的一个默认值，但不能成为产品数据模型。

参考：

- https://www.w3.org/TR/WCAG22/

---

## 3. 产品原则

### 原则 A：Overlay 只呈现 canonical subtitle state

不得自行请求字幕，不得持久化第二套 cue timeline。

它只消费现有：

```text
mediaKey
track(s)
cues
cueRevision
currentTime
```

### 原则 B：默认观看状态必须是 Passive

正常看视频时，除了字幕本身，用户不应该感知播放器交互被 SparkSub 改写。

不得默认破坏：

- 单击暂停 / 播放；
- 双击全屏；
- 右键；
- 原生控制栏 hover；
- 拖动；
- 键盘焦点。

### 原则 C：学习交互必须显式进入

文字选择、工具条、解释、摘录等进入 Inspect 后再启用，不让所有字幕永久 `pointer-events: auto`。

### 原则 D：时间偏移只能改变 Presentation Clock

```text
effectiveTime = video.currentTime + subtitleOffsetMs / 1000
```

它不能改：

- `cue.from / cue.to`；
- 原始导入文件；
- AI 笔记时间；
- SRT/VTT 导出。

### 原则 E：平台 DOM 差异只留在 Adapter

Bilibili 的 `data-ctrl-hidden`、YouTube 的播放器 selector 等不能进入通用 Overlay CSS / 业务逻辑。

### 原则 F：不参与全局 z-index 军备竞赛

优先利用播放器内部 stacking context，定义层级语义，不用 `2147483647` 压住整个网页和其他扩展。

### 原则 G：视频内容本身优先于字幕装饰

默认不使用高成本、重遮挡的磨砂玻璃效果；位置、宽度、透明度必须可调整。

---

## 4. 用户场景

### 场景 1：普通 STEM 视频观看

用户打开 Bilibili / YouTube 数学、408、软件或技术课程，SparkSub 已经有字幕。

预期：

- 根据用户偏好自动显示视频内字幕；
- 默认只显示一条主字幕；
- 不抢播放器鼠标事件；
- 播放时跟随当前 cue；
- 明确 LaTeX delimiter 的公式可使用 KaTeX；
- 平台控制栏出现时，字幕根据 safe area 合理避让。

核心目的：不用再把视线移到播放器旁面板才能读当前句。

### 场景 2：视频没有平台 CC，但 SparkSub 已经有 ASR / 导入字幕

预期：

- 和平台字幕完全相同地进入 Overlay；
- Overlay 不关心字幕来源；
- 不把“已有完整 SparkScribe 转录”误宣传成“实时 Live ASR”。

### 场景 3：英语学习中的双语字幕

用户选择英文为主字幕，中文为辅助字幕。

预期：

- 两条轨道分别按当前时间查找 cue；
- 绝不能认为 `primaryCues[i] === secondaryCues[i]`；
- 可以选择原文在上 / 译文在下，也可以反过来；
- 默认仍为单语，双语由用户主动开启。

### 场景 4：听力 / Recall 模式

用户希望先听，不希望一开始就被文字泄题。

预期：

- 当前字幕可以先隐藏或模糊；
- 第一次操作显示原文；
- 第二次操作再显示翻译；
- 随时可以重播当前句；
- 该模式显式开启，不改变普通观看。

这与 SparkSub 已有 Recall protection 的产品哲学一致。

### 场景 5：一句内容没看懂

用户暂停视频，主动进入 Inspect。

预期：

- 字幕从 Passive 变成可选择；
- 出现极小的动作栏：`上一句 / 重播 / 下一句 / 复制 / 摘录 / 解释`；
- `解释` 把当前 cue + 前后文 + MediaContext 交给现有 Learn，而不是视频里再造 AI Chat；
- `摘录` 后续可以复用现有截图能力组合“字幕 + 时间 + 画面”。

### 场景 6：字幕整体快了或慢了几百毫秒

预期：

```text
-0.1s   0.0s   +0.1s
          重置
```

只调显示时钟，不修改源字幕。

### 场景 7：全屏、剧院模式、B站分P、YouTube SPA 切视频

预期：

- Overlay 跟随当前真正的 video surface；
- 旧 Host 被 dispose；
- 永远只有一个当前 Overlay；
- 全屏时重新进入正确 subtree；
- 切新视频后旧字幕不会残留。

### 场景 8：平台原生字幕与 SparkSub 字幕同时开启

预期：

- 能可靠检测时，轻提示“播放器原生字幕仍开启”；
- 用户可选择关闭原生字幕或保留两者；
- 不在背后永久修改平台字幕偏好；
- 检测失败也不影响 SparkSub 自己的字幕。

---

## 5. 第一版功能范围

### 必须完成

1. **视频字幕开关**
   - canonical cues 可用时即可显示。

2. **简洁 / 双语 / 听力三种呈现方式**
   - 默认简洁；
   - 双语、听力均为 opt-in。

3. **主轨 / 辅助轨独立选择**
   - 两轨按时间独立定位。

4. **显式 KaTeX 数学公式**
   - 只处理明确 delimiter；
   - 不实时 AI 猜公式。

5. **基础外观设置**
   - 字号；
   - 最大宽度；
   - 背景透明度；
   - 顶部 / 中下 / 底部位置；
   - 后续可扩展自定义垂直拖动。

6. **Presentation timing offset**
   - ±100 ms；
   - 一键重置；
   - 不修改 cue 数据。

7. **Passive / Inspect 两态**
   - Passive 完全尽量穿透播放器；
   - Inspect 才启用文字选择和动作。

8. **上一句 / 重播 / 下一句**
   - 复用现有 seek / cue 时间轴。

9. **全屏 + Player Replacement 稳定性**
   - Bilibili / YouTube 第一版就处理。

10. **原生字幕共存提示**
    - 避免用户莫名看到两套字幕。

### v1 明确不做

暂时不做：

- 完整词典系统；
- 英日中分词 / morphology；
- 每个词都弹 AI；
- 自动把自然语言数学口述变成 LaTeX；
- 每句实时 LLM 翻译；
- 实时 Streaming ASR；
- 全站任意视频通用适配；
- ASS/SSA 完整特效兼容；
- 视觉 AI 自动判断字幕应该放哪里；
- 默认 hover 自动暂停；
- Overlay 自己持久化一套字幕正文。

---

## 6. 推荐架构

```text
                 ┌──────────────────────────────┐
                 │ 现有字幕获取                  │
                 │ platform / ASR / import      │
                 └──────────────┬───────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │ content/app.js               │
                 │ canonical media + cue state  │
                 └──────────────┬───────────────┘
                                │
                      playback state / revision
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
   ┌──────────────────────┐             ┌─────────────────────┐
   │ SubtitlePresentation │             │ 现有消费者           │
   │ 纯状态 / 投影         │             │ Rolling / Side Panel │
   └──────────┬───────────┘             └─────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │ VideoSubtitleOverlay │
   │ DOM + Shadow DOM     │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ PlayerSurfaceAdapter │
   │ Bilibili / YouTube   │
   └──────────────────────┘
```

### 6.1 `SubtitlePresentation`：纯状态 / 投影层

负责：

- 呈现偏好；
- timing offset 后的 effective time；
- 主 / 辅助轨当前 cue；
- listening reveal state；
- 判断本次呈现是否真的变化；
- 输出很小的 `SubtitlePresentationFrame`。

不负责：

- DOM；
- 平台 selector；
- 获取字幕；
- 翻译；
- AI；
- 修改 canonical cues。

概念模型：

```ts
interface SubtitlePresentationSettings {
  enabled: boolean;
  mode: 'single' | 'bilingual' | 'listening';
  primaryTrackId: string;
  secondaryTrackId?: string;
  secondaryPlacement: 'above' | 'below';
  timingOffsetMs: number;
  positionPreset: 'top' | 'lower' | 'bottom' | 'custom';
  positionRatio?: number;
  maxWidthRatio: number;
  fontScale: number;
  backgroundOpacity: number;
}

interface SubtitlePresentationFrame {
  mediaKey: string;
  primaryCue: Cue | null;
  secondaryCue: Cue | null;
  primaryIndex: number;
  secondaryIndex: number;
  effectiveTime: number;
  revealState: 'hidden' | 'primary' | 'all';
}
```

最终字段可根据现有类型体系微调，但职责边界不要改变。

### 6.2 `PlayerSurfaceAdapter`：网站几何与生命周期 seam

负责：

- 找到当前真正有效的 `<video>`；
- 找到最佳 Overlay Anchor；
- 验证 anchor 与当前 video 对应；
- 确定 fullscreen anchor；
- 输出播放器控件 safe insets；
- 感知播放器被替换；
- 如果可靠，提供原生字幕可见状态 / 切换能力。

概念接口：

```ts
interface PlayerSurfaceAdapter {
  resolveVideo(): HTMLVideoElement | null;
  resolveOverlayAnchor(video: HTMLVideoElement): HTMLElement | null;
  resolveFullscreenAnchor(video: HTMLVideoElement): HTMLElement | null;
  measureSafeInsets(): { top: number; right: number; bottom: number; left: number };
  isNativeCaptionVisible?(): boolean;
}
```

#### Bilibili

Preferred anchor：

```text
.bpx-player-video-area
```

但不能把它定义成“永远唯一正确 selector”。Fallback 必须经过：

```text
isConnected
width > 0
height > 0
与当前 video 几何 / owner 对应
```

`data-ctrl-hidden` 可以在 Bilibili Adapter 内用来计算控制栏 safe bottom，但不能进入通用 Overlay 层。

#### YouTube

优先围绕当前有效 video 所属的：

```text
.html5-video-player
#movie_player
```

确定 surface。

不能默认第一个 `<video>` 就是真正的视频；成熟字幕项目仍持续遇到 extra/stale video element 问题。

### 6.3 `VideoSubtitleOverlay`：只负责 DOM 呈现

负责：

- 当前视频 surface 上只存在一个 Host；
- Shadow DOM 样式隔离；
- 渲染主 / 辅助字幕；
- Passive / Inspect；
- 很轻的播放 / 学习动作；
- fullscreen / player replace 时 remount；
- 消费 safe area CSS variables。

推荐结构：

```text
#sparksub-video-subtitle-host
  #shadow-root
    .subtitle-surface
      .subtitle-stack
        .subtitle-primary
        .subtitle-secondary
      .inspect-toolbar
      .ephemeral-feedback
```

Host 应带 owner/media 标记，以便重复挂载时明确识别并 dispose 旧实例。

### 6.4 `RichTextMathRenderer`：共享的安全文本 + 数学渲染

不要把完整 `renderNoteToHtml()` 直接拿来渲染一句字幕。

应该从现有规则里收敛出一个很小的共享层，支持：

- 纯文本转义；
- 显式行内 / 块级 math delimiter；
- 和笔记一致的 KaTeX policy；
- 不执行原始 HTML；
- subtitle mode 不处理表格 / 图片 / frame reference。

目标关系：

```text
AI Note Renderer ──────┐
                       ├── shared math rules / KaTeX policy
Video Subtitle Overlay ┘
```

这样以后不会出现两套数学正则逐渐漂移。

### 6.5 `VideoSurfaceCoordinator`：只在生命周期开始分散时再引入

不要为了“架构漂亮”第一天就创建。

如果 fullscreen、SPA、player replacement 的 Owner 开始散在多个文件，再引入一个 Coordinator 统一拥有：

- current video；
- adapter；
- overlay host；
- observer / listener；
- teardown。

不要把 Video Overlay 生命周期塞进 `RollingPanel`，两者 geometry 和职责不同。

---

## 7. 播放同步策略

现有播放架构继续作为事实源：

```text
video.timeupdate
      ↓
requestAnimationFrame 合并
      ↓
findActiveCueIndex()
      ↓
activeIndex change
```

Overlay **不要再创建一条自己的无限 60fps render loop**。

建议：

```text
播放时间变化，但 active cue 没变
→ 什么都不改 DOM

主 cue 改变
→ 只更新主字幕节点

辅助 cue 改变
→ 只更新辅助字幕节点

cueRevision / track 改变
→ invalidate rendered cue cache

mediaKey / video owner 改变
→ dispose + remount
```

### 双语轨关键不变量

两轨必须分别用 effective time 查：

```text
primaryIndex = findActiveCueIndex(primaryCues, effectiveTime, previousPrimaryIndex)
secondaryIndex = findActiveCueIndex(secondaryCues, effectiveTime, previousSecondaryIndex)
```

禁止：

```text
secondaryCue = secondaryCues[primaryIndex]
```

因为不同语言、不同来源的 cue 切分数量和边界经常完全不同。

---

## 8. KaTeX 实现路径

### 当前约束

现在 KaTeX JS 主要在 Side Panel 页面加载，content script 不能自然继承 Side Panel 的 JS runtime。KaTeX CSS / fonts 已经作为扩展资源存在。

### 推荐路径

1. 从现有笔记公式规则中抽出小型 safe text+math renderer；
2. 通过扩展本地资源把 KaTeX runtime 加载进 content-script 使用的执行上下文；
3. 给 Overlay Shadow Root 注入所需 KaTeX CSS / fonts；
4. 只在 cue 变化时做解析和 render；
5. 使用类似下面的 cache key：

```text
trackId + cueRevision + cueIndex + contentHash
```

6. 字幕被校对、换轨后 invalidate；
7. active cue 没变化时绝不重复 KaTeX。

### v1 delimiter policy

只处理明确的：

```text
$...$
\(...\)
$$...$$
\[...\]
```

不要自动把这些普通文本当数学：

```text
x=3
$100
1/2
C++
```

以后如果要做“数学字幕富化”，应该是独立、可缓存、非播放热路径的 enrichment 能力。

---

## 9. 交互模型

### 9.1 Passive

默认观看状态。

要求：

- Overlay 外层 pointer-through；
- 不拦截播放器 click / double click / context menu；
- 不默认 hover auto-pause；
- 不抢 keyboard focus；
- Inspect toolbar 不显示。

### 9.2 Inspect

用户显式进入，例如：

- 暂停后点一个轻量 Inspect 入口；
- 快捷键 / modifier；
- 后续显式学习模式。

进入后：

- 字幕可选择；
- 只让必要文本 / action 区域接收 pointer；
- 离开后立即恢复 Passive。

第一版动作：

```text
上一句   重播   下一句   复制   摘录   解释
```

这些动作只能调用现有能力，不在 Overlay 内重写业务逻辑。

### `解释`

激活现有 Learn，并交付：

- 当前 cue；
- 前后文；
- MediaContext；
- 当前时间；
- 只有确实需要视觉信息时才补截图。

不要在视频上永久开一个 AI 对话窗。

### `摘录`

第一版可以只交付当前 cue + 时间；架构上预留后续复用现有 `core/media.js` 截图能力。

---

## 10. 位置、安全区与视觉

### 10.1 Position model

最低要求：

- 顶部；
- 中下；
- 底部。

以后支持拖动时，建议存归一化坐标：

```text
positionRatio = 0.0 ... 1.0
```

不要存死 `bottom: 83px`，否则播放器尺寸变化后语义失效。

### 10.2 Native controls avoidance

通用 Overlay 只消费：

```text
--bse-video-safe-top
--bse-video-safe-right
--bse-video-safe-bottom
--bse-video-safe-left
```

每个平台 Adapter 再决定这些值怎么得出。

### 10.3 Layering

定义语义，不固定魔法数字：

```text
video
  < platform visual overlays / danmaku
  < SparkSub subtitle
  < SparkSub Inspect toolbar / ephemeral feedback
  < native controls / menus
```

禁止用最大 z-index 去压所有第三方 UI。

### 10.4 默认视觉风格

第一版偏克制：

- 半透明深色背景；
- 必要时轻微 text-shadow；
- 圆角；
- 根据 player width 响应字号；
- 最大宽度约占视频 80–90%；
- 默认不用重 `backdrop-filter`。

Blur 可以以后作为可选项，并在真实 4K / Retina 播放下测性能后再决定。

---

## 11. 设置 UX

不要让用户理解 Overlay / Adapter / primary track 这些架构术语。

主设置保持少量：

```text
视频字幕            开 / 关
显示方式            简洁 / 双语 / 听力
字幕语言            English
位置                底部
```

高级设置：

```text
辅助字幕            中文
辅助字幕位置        上 / 下
同步                -0.2s  [重置]  +0.2s
字号                100%
宽度                85%
背景                60%
```

### 持久化建议

适合全局保存：

- enabled；
- mode；
- 首选语言；
- font scale；
- width；
- background；
- position preference。

Timing offset 不建议一开始做成全局永久值。它通常是媒体源特有的问题，v1 优先 session 或 media-specific，待实机体验后再定。

---

## 12. 与平台原生字幕共存

必须明确建模，而不是让两套字幕偶然叠起来。

建议：

1. 用户开启 SparkSub 视频字幕；
2. Adapter 在可靠时检测平台原生字幕是否可见；
3. 两者同时开启时给轻量提示：

```text
播放器原生字幕仍开启
[关闭原生字幕] [保留两者]
```

要求：

- 不偷偷永久改变平台偏好；
- Toggle 实现留在平台 Adapter；
- 平台 DOM 变化导致检测失败时，SparkSub 自己字幕仍正常工作。

---

## 13. Fullscreen 与播放器生命周期

这是 v1，不是未来优化。

Overlay Owner 必须处理：

- `fullscreenchange`；
- 当前代码若仍需要则处理 `webkitfullscreenchange`；
- player container replace；
- `<video>` replace；
- Bilibili 分P / 番剧 episode SPA；
- YouTube SPA navigation；
- video disconnect / reconnect；
- theater / widescreen geometry change。

核心不变量：

```text
当前媒体 / 当前 video 最多只有一个 VideoSubtitleOverlay owner。
```

Owner 变化时：

```text
验证新 media / video
→ dispose 旧 observer / listener / host
→ resolve 新 surface
→ mount exactly one host
→ render current frame
```

不要靠累积多个 MutationObserver 或一堆永久 interval 来“确保总能挂上”；只有真实证据证明必要时才加有限 fallback。

---

## 14. 主要工程风险与应对

### 风险 1：重复 Overlay

应对：

- 唯一 Owner；
- Host 有 media/video owner marker；
- mount 幂等；
- 测试重复 mount / fullscreen / SPA。

### 风险 2：绑定 stale / wrong video

应对：

- 复用并深化现有有效 video resolution；
- 校验连接、几何、owner；
- 不能只拿 `document.querySelector('video')` 第一项。

### 风险 3：Fullscreen 字幕消失

应对：

- v1 就有 fullscreen mount strategy；
- 进入正确 fullscreen subtree；
- 测试父节点关系，而不仅是 CSS display。

### 风险 4：字幕阻塞播放器点击

应对：

- Passive pointer-through；
- Inspect 才局部可交互；
- 专门验收 click / double-click / right-click。

### 风险 5：与 Yomitan 等第三方扩展 z-index 冲突

应对：

- 不用全局最大 z-index；
- 利用播放器本地 stacking context；
- Inspect toolbar 只在需要时出现。

### 风险 6：KaTeX 让播放卡顿

应对：

- cue 改变才 render；
- render cache；
- 只识别显式 delimiter；
- 不在每个 `timeupdate` 重跑。

### 风险 7：双语字幕错行

应对：

- 两轨按时间独立找 cue；
- 禁止 index coupling。

### 风险 8：字幕盖住公式 / PPT / 代码

应对：

- 多位置 preset；
- 宽度 / 背景调节；
- 后续 normalized vertical drag；
- 不只有一个固定底部位置。

### 风险 9：设置越来越像专业字幕软件

应对：

- 一级只保留 4 个高频选项；
- timing / appearance 放高级设置；
- v1 不做词典、分词等大系统。

### 风险 10：Overlay 变成第二个 Side Panel

应对：

- Overlay 只显示当前 cue 与短动作；
- 搜索、解释长文、笔记、复习都回现有 Workspace。

---

## 15. 推荐开发顺序

开发顺序故意先解决长期最危险的 Owner / Fullscreen / Player Replacement，再做漂亮 UI。

### Phase 0：先固定 Presentation Contract

**目标：** 没有 DOM 前先把状态边界测试清楚。

- [ ] 定义 `SubtitlePresentationSettings` / `SubtitlePresentationFrame` 或等价 JSDoc 类型；
- [ ] 实现纯函数式 presentation-frame resolver；
- [ ] 测试主 / 辅助字幕不等长、不等分段；
- [ ] 测试 timing offset 只影响查找，不修改 cue；
- [ ] 固定 `content/app.js` 仍是 canonical owner。

**退出条件：** 还没有 Overlay UI，但 Presentation 状态可以完整单测。

### Phase 1：PlayerSurfaceAdapter

**目标：** 先稳定回答“字幕应该挂在哪一个当前播放器上”。

- [ ] 引入最小 Bilibili / YouTube surface seam；
- [ ] 复用现有有效 `<video>` 解析，不复制 selectors；
- [ ] Bilibili preferred `.bpx-player-video-area`；
- [ ] YouTube 从当前有效 video 反推 `.html5-video-player / #movie_player`；
- [ ] geometry / disconnected 校验；
- [ ] 输出 safe insets；
- [ ] 能识别 stale / extra video 的测试夹具。

**退出条件：** Adapter 能稳定输出 video、普通 anchor、fullscreen anchor、safe insets，但还不画字幕。

### Phase 2：Passive 单语字幕

**目标：** 用最小能力验证用户体验和性能。

- [ ] 新建一个 Video Subtitle Overlay Host + Shadow DOM；
- [ ] Bilibili / YouTube 显示当前主字幕；
- [ ] 复用现有 playback sync，不新建独立 60fps loop；
- [ ] 仅 active cue 变化时更新 DOM；
- [ ] 视频字幕开关；
- [ ] 基础字号 / 宽度 / 背景 / 位置；
- [ ] Passive pointer-through；
- [ ] media/video owner 变化时 dispose。

**退出条件：** 播放器原生 click / double-click / right-click 完全正常，字幕稳定同步。

### Phase 3：Fullscreen + Lifecycle Hardening

**目标：** 在丰富功能之前把 Overlay 生存周期打稳。

- [ ] fullscreen enter / exit；
- [ ] theater / widescreen；
- [ ] YouTube / Bilibili SPA replace；
- [ ] duplicate-host 防护；
- [ ] 重复 fullscreen 不增加 listener / observer；
- [ ] Chrome 实机进行多轮 P / video 切换。

**退出条件：** 反复切换全屏和视频仍只有一个正确 Overlay，没有旧字幕残留。

### Phase 4：共享 KaTeX Renderer

**目标：** 做出 STEM 差异化，但不引入第二套公式系统。

- [ ] 抽取最小 safe text+math renderer；
- [ ] content-script 加载扩展本地 KaTeX runtime；
- [ ] Shadow DOM 加载 KaTeX CSS/fonts；
- [ ] 仅显式 delimiter；
- [ ] cue identity / revision cache；
- [ ] malformed formula / currency false positive 回归测试。

**退出条件：** 中英公式混排正确，active cue 不变时不重复渲染。

### Phase 5：双语 + 听力模式

**目标：** 加入真正的语言学习价值，但不污染默认观看。

- [ ] secondary track；
- [ ] 两轨独立 time lookup；
- [ ] 原文 / 译文上下顺序；
- [ ] listening reveal state；
- [ ] 保存稳定语言 / mode 偏好；
- [ ] 长双语字幕遮挡测试。

**退出条件：** cue 分段不一致也不串行，单语仍是默认。

### Phase 6：Timing Offset + 逐句播放

**目标：** 低复杂度提升真实媒体可用性。

- [ ] ±100 ms；
- [ ] reset；
- [ ] 上一句 / 重播 / 下一句；
- [ ] 实机后决定 offset 是 session 还是 media-specific；
- [ ] 验证所有导出和 canonical cue 完全未改变。

### Phase 7：Inspect + Learn Handoff

**目标：** 补齐 Watch → Learn。

- [ ] 显式 Inspect 进入 / 退出；
- [ ] Inspect 才允许选择文字；
- [ ] `复制`；
- [ ] `摘录` 当前 cue + time；
- [ ] `解释` 把 cue + nearby context + MediaContext 送到现有 Learn；
- [ ] 只有学习动作确实需要时才复用截图；
- [ ] 工具条保持短暂、轻量。

**退出条件：** Overlay 提供学习杠杆，但没有变成第二个 Side Panel。

### Phase 8：平台原生字幕共存优化

- [ ] Bilibili / YouTube best-effort native caption detect；
- [ ] 可靠时提供“关闭原生字幕 / 保留两者”；
- [ ] 不静默修改永久平台偏好；
- [ ] selector 失效时 fail-soft。

---

## 16. 测试与验收策略

### 16.1 纯逻辑测试

必须覆盖：

- 主 / 辅助轨独立定位；
- `0s` cue；
- timing offset；
- cue 边界；
- `cueRevision` invalidate；
- listening reveal state；
- presentation change detection。

### 16.2 DOM / 生命周期测试

覆盖：

- exactly one host；
- mount 幂等；
- Passive / Inspect pointer state；
- active cue 未变化时不重建；
- math render / fallback；
- dispose 删除 observer/listener/host。

### 16.3 Adapter Fixture

至少模拟：

- Bilibili 正常播放器；
- Bilibili preferred anchor 缺失后的 fallback；
- YouTube active video + stale/extra video；
- fullscreen subtree；
- controls safe inset 状态。

### 16.4 Chrome 实机矩阵

| 场景 | Bilibili | YouTube |
| --- | --- | --- |
| 正常播放 | 必测 | 必测 |
| Pause / Resume | 必测 | 必测 |
| 单击视频 | 必测 | 必测 |
| 双击全屏 | 必测 | 必测 |
| Hover 原生 controls | 必测 | 必测 |
| 剧院 / 宽屏 | 必测 | 必测 |
| 多次进出全屏 | 必测 | 必测 |
| SPA 切 P / 切视频 | 必测 | 必测 |
| 原生字幕同时开启 | 必测 | 必测 |
| 超长字幕 | 必测 | 必测 |
| 数学公式字幕 | 必测 | 必测 |
| 双轨分段不一致 | 必测 | 必测 |

性能验收必须包含 Retina Mac 上 1080p 与 4K 视频。Node 单测无法证明 `backdrop-filter`、KaTeX、Shadow DOM 在真实播放器上的合成成本。

---

## 17. 性能预算与不变量

目标不是追求理论 60fps Overlay，而是**不明显增加当前视频播放成本**。

必须维持：

- 不创建无界独立 60fps 渲染循环；
- active cue 不变 → 0 次字幕 DOM 更新；
- KaTeX 只在 cue / revision 改变时工作；
- 当前播放器只有一个 Overlay Host；
- 当前 surface 只有一套生命周期 owner/observer；
- Video Overlay 不持有完整字幕列表 DOM；
- Overlay 状态不保存高清 base64 截图；
- playback hot path 内没有 AI 网络调用；
- 重 blur 不作为默认效果。

遇到性能问题时优先使用 Chrome Performance / Rendering 做真实测量，不要凭感觉叠 debounce/throttle。

---

## 18. 正式实现后应写回架构文档的不变量

进入实现阶段后，需要把稳定结论补进 `docs/架构与消息协议.md`：

1. `content/app.js` 继续拥有当前媒体 / 字幕唯一 canonical state；
2. Video Subtitle Presentation 不获取、不持久化第二套 cue timeline；
3. 平台 selector / control state 只属于 `PlayerSurfaceAdapter`；
4. 主 / 辅助字幕轨独立按时间解析；
5. timing offset 只改变 Presentation Clock；
6. Passive Overlay 不拦截原生视频鼠标交互；
7. 当前 media/video 最多一个 Overlay Owner；
8. Fullscreen remount/reparent 属于正式生命周期；
9. 数学字幕与学习笔记共享安全 KaTeX 规则，不维护第二套公式 parser；
10. 复杂学习行为仍进入 Learn/Review，不在视频上复制 Side Panel。

在真正实现前不要把这些写成“当前已完成能力”。

---

## 19. v1 Done 定义

只有以下条件全部成立才能认为第一版完成：

- canonical cues 可以直接显示在当前 Bilibili / YouTube 视频上；
- pause/resume、resize、剧院/宽屏、fullscreen、SPA replace 后都能继续正确显示；
- 普通观看时播放器单击 / 双击 / 右键没有被破坏；
- 单语稳定且默认；
- 双语按时间独立解析，不要求 cue 数量一致；
- 明确 LaTeX 可经共享 KaTeX policy 安全渲染；
- 字号 / 位置 / 宽度 / 背景和 timing offset 可调整；
- timing offset 不改 canonical cue；
- 上一句 / 重播 / 下一句复用现有 seek；
- Inspect 是显式状态，并能把当前句交给已有 Learn；
- 重复 mount / fullscreen / SPA 不产生 duplicate overlay / leaked listeners；
- 除 Node / 静态测试外，已经完成真实 Chrome + Bilibili + YouTube 实机验收。

---

## 20. 下一次开发的起点

**不要从字幕胶囊 CSS 开始。**

正确顺序：

```text
Phase 0：Presentation Contract + Tests
              ↓
Phase 1：PlayerSurfaceAdapter
              ↓
Phase 2：Passive 单语 Overlay
              ↓
Phase 3：Fullscreen / SPA Hardening
              ↓
再进入 KaTeX / 双语 / Offset / Inspect
```

原因是这项功能长期最难维护的不是字体、阴影和圆角，而是：

- 当前到底是哪一个 video；
- 谁拥有 Overlay；
- 网站 SPA 换播放器后如何迁移；
- Fullscreen subtree 是否正确；
- 是否重复挂载；
- 是否阻塞原生播放器交互。

先把这些基础合同做深，后续数学、双语和学习交互才不会建立在脆弱 DOM patch 上。
