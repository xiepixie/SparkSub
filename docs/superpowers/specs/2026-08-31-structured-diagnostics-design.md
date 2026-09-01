# SparkSub 结构化诊断日志架构设计

## 背景

SparkSub 当前存在两类日志：面向用户的诊断时间线，以及面向开发者的控制台和 Native Host stderr 日志。用户诊断由当前视频加载、平台字幕探测、转录队列、本机能力探测、端侧大模型和批量导出共同写入。它们最终以带时间戳的字符串合并到侧栏的单一数组中。

现有实现产生四个直接问题：错误路径可能重复提交；切换视频或标签页后仍保留旧诊断；不同写入路径没有一致执行数量上限；字符串事件没有级别、范围、会话和稳定代码，无法可靠筛选、去重或脱敏。预期内的回退还经常使用 `console.warn`，使真正异常被噪声淹没。

## 目标

- 为扩展上下文提供一个轻量、无第三方依赖的结构化诊断事件模型。
- 将当前媒体、转录队列、本机服务和批量导出的日志隔离为独立会话。
- 默认向用户显示关键阶段、降级和错误，同时保留可复制的详细诊断。
- 在所有入口统一执行规范化、去重、裁剪和脱敏。
- 保留现有 `(stage, message)` 回调的兼容能力，避免同时重写全部平台调用点。
- 使一次逻辑错误只产生一个错误事件和一个对应的处理建议。
- 保持 Native Messaging stdout 协议不变；Native Host 运行日志继续只写 stderr。

## 非目标

- 不引入远程遥测、日志上传、分析服务或用户跟踪。
- 不把诊断日志持久化到浏览器存储或磁盘。
- 不在本次改动中重写字幕抓取、队列执行或 Native Messaging 协议。
- 不提供任意查询语言或完整的开发者日志控制台。

## 方案选择

### 采用：共享结构化日志核心与按范围会话存储

新增 `core/diagnostics.js`，负责创建、规范化、脱敏、去重、格式化和限制诊断事件。内容脚本仍负责当前标签页媒体状态，但保存结构化事件；侧栏使用独立的诊断存储，按 `media`、`queue`、`native`、`batch` 范围及其会话键隔离事件。

这一方案提供稳定的数据边界，同时允许现有平台适配器继续调用 `(stage, message)`。调用方通过绑定了范围、会话和默认级别的兼容回调，将旧调用转换成结构化事件。

### 未采用：只修补字符串数组

仅在切换媒体时清空数组、补上裁剪并删除重复 `commitError`，改动最小，但仍无法实现可靠的分级、范围隔离、事件代码和脱敏。后续新增来源会再次造成同类问题。

### 未采用：持久化日志与遥测管线

持久化数据库、日志上传和远程检索能提供更强的历史分析，但会引入隐私、权限、存储迁移和运维成本，不符合本地浏览器扩展当前需求。

## 事件模型

`DiagnosticEvent` 使用可序列化的普通对象：

```ts
type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
type DiagnosticScope = 'media' | 'queue' | 'native' | 'batch' | 'tracker' | 'system';

interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  scope: DiagnosticScope;
  code: string;
  stage: string;
  message: string;
  sessionId: string;
  context?: {
    mediaKey?: string;
    jobId?: string;
    platform?: string;
  };
}
```

约束：

- `id` 由事件内容和当前时间生成，用于渲染键；去重不依赖 `id`。
- 去重键由 `scope + sessionId + level + code + stage + message` 组成；相同事件在短时间窗口内只保留一次。
- `timestamp` 使用 ISO 8601，展示时再按本地时区格式化。
- `code` 是稳定的机器可读标识。兼容回调未提供代码时，从 stage 规范化生成 `LEGACY_<STAGE>`。
- 事件只携带允许的 context 字段，不接受任意对象扩散到复制日志。
- 未知 level、scope 或空字段在入口处被规范化为安全默认值。

## 日志核心接口

`core/diagnostics.js` 暴露于 `BSE.Diagnostics`：

```js
createEvent(input, now?)
sanitizeText(value)
sanitizeEndpoint(value)
formatEvent(event, options?)
createStore({ limit, dedupeWindowMs, now? })
createLegacyReporter(emit, defaults)
```

`createStore()` 返回：

```js
append(input)
replaceSession(scope, sessionId)
events({ scope?, sessionId?, minLevel? })
clear({ scope?, sessionId? })
```

所有事件必须通过 store 的 `append()` 进入集合，因此数量上限和去重不会因来源不同而失效。单个会话默认最多 100 条，侧栏全部活跃范围合计最多 500 条。

## 会话与责任边界

### 当前媒体

`content/app.js` 在 `mediaKey` 变化时创建新的 media session。强制刷新沿用同一个 session，从而保留一次视频会话内的刷新路径。发布的 `AppState.diagnostics` 改为 `DiagnosticEvent[]`，并增加 `diagnosticSessionId`。

内容脚本继续作为当前标签页媒体状态的唯一来源。平台适配器收到的 `diagnostic(stage, message)` 是绑定到该 media session 的兼容 reporter。

### 侧栏

侧栏不再维护无边界的字符串数组。它维护四个面向用户的活跃范围：

- `media`：只接受当前活动标签页和当前 `diagnosticSessionId` 的事件；切换时替换会话。
- `queue`：以队列项 ID 为 session，保留当前队列项的状态变化。
- `native`：以一次能力探测或一次 Native 操作为 session。
- `batch`：以一次批量导出任务为 session。

侧栏从状态广播合并 media 事件时仍通过统一 store，不能直接 push。队列、本机服务和批量回调也使用结构化 append。

### 控制台与 Native Host

开发控制台只记录需要开发者介入的异常。预期降级不再输出 Error 对象堆栈；必要时以结构化诊断的 info/warn 事件呈现。

Native Host 的 stdout 契约保持不变：正常模式只写 Native Messaging 帧，`--diagnose` 才输出可读 JSON。运行错误继续写 stderr，且只写稳定错误代码，不写媒体 URL、令牌或字幕正文。

## 级别规则

- `debug`：HTTP 探测、通道选择、缓存命中、DOM/BPX 内部探测。
- `info`：开始、关键阶段完成、用户触发动作、预期回退成功。
- `warn`：发生降级、数据完整性保护拦截、可恢复异常。
- `error`：工作流最终失败，且需要用户操作或重试。

默认诊断视图显示 `info` 及以上。详细日志开关显示全部级别。错误摘要仍由 `lastError` 驱动，不从文案反向解析级别。

## UI 行为

诊断抽屉增加：

- 当前范围摘要；
- “关键 / 详细”两档视图；
- 范围筛选：当前视频、转录队列、本机服务、批量任务；
- 清空当前范围按钮；
- 复制按钮只复制当前筛选范围和会话。

切换活动标签页或媒体时，当前视频视图自动切换到新会话。其他范围不会混入当前视频，但用户仍可通过范围筛选查看正在运行的队列或批量任务。

## 错误处理

`commitError(stage, error)` 是媒体错误转换和记录的唯一入口。`transitionTo('error')` 只接收已经构造好的 `fault`，不再隐式调用 `commitError`。每次最终错误生成：

- 一个 `error` 事件，code 使用 fault code；
- 一个 `info` 处理建议事件，code 为 `<FAULT_CODE>_HINT`；
- 一个 `lastError` 状态对象。

平台层可记录尝试失败或降级事件，但不能提交最终 `lastError`。

## 脱敏

`sanitizeText()` 在事件创建时执行，至少处理：

- URL 查询参数中的 `token`、`key`、`sig`、`sign`、`auth`、`cookie`、`credential` 及其常见变体；
- `Authorization`、`Cookie` 等请求头格式；
- 超长 URL 和错误消息的长度限制；
- 用户配置的 LLM endpoint 只保留协议、主机和端口，不记录路径、查询或凭据。

事件格式化和复制阶段再次调用脱敏，作为纵深保护。媒体 ID、BVID、CID、任务 ID 和视频标题不是凭据，但复制头部必须明确当前上下文，避免与其他会话混淆。

## 兼容与迁移

- `DiagnosticEvent[]` 替代 `string[]`，属于内部消息协议变更；所有生产者和消费者在同一版本内更新。
- 读取诊断时暂时兼容旧字符串：将其转换为 `info / media / LEGACY_LINE` 事件。这允许扩展更新期间旧标签页与新侧栏短暂共存。
- 平台文件中的现有日志调用不要求本次全部改写；通过 stage 到 level/code 的映射改善默认展示。新增调用应优先传结构化输入。
- manifest 必须在依赖诊断功能的内容脚本、侧栏和 Service Worker 之前加载 `core/diagnostics.js`。

## 测试策略

### 日志核心单元测试

- 创建事件时规范化 level、scope、code 和时间。
- 对查询令牌、请求头和带凭据 endpoint 脱敏。
- 相同事件在去重窗口内只出现一次，窗口外可以再次出现。
- 单会话和总集合限制在不同写入入口下都生效。
- 替换 media session 后不返回旧媒体事件。
- `minLevel` 和 scope/session 筛选返回正确结果。
- 旧字符串能转换并格式化。

### 集成回归测试

- 一次媒体失败只生成一组错误与建议。
- 侧栏切换媒体或标签页后只复制当前 media session。
- 队列和本机事件不会出现在“当前视频”范围。
- 默认视图隐藏 debug，详细视图显示 debug。
- 清空只影响当前筛选范围。
- 现有消息广播、字幕渲染和队列测试继续通过。

### 手动验证

- 在 B 站和 YouTube 各打开一个视频并切换标签页，确认媒体日志不会串台。
- 触发一次正常字幕加载、一次回退和一次最终失败，确认级别与摘要正确。
- 执行本机能力探测和队列任务，确认范围筛选与复制内容正确。
- 检查 Service Worker 控制台，确认预期回退不再输出完整 warning 堆栈。

## 成功标准

- 单次最终错误不会重复。
- 任一日志写入路径都不能绕过去重、裁剪和脱敏。
- 当前视频视图和复制结果不包含其他媒体或其他范围的事件。
- 默认日志明显少于详细日志，且仍完整呈现用户可操作的失败信息。
- 所有既有自动化测试和新增日志测试通过。
- Native Messaging stdout 协议保持原样。
