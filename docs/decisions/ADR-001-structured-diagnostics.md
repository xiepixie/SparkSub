# ADR-001: 使用结构化、按会话隔离的诊断日志

## Status

Accepted

## Date

2026-08-31

## Context

SparkSub 的当前视频加载、平台字幕探测、转录队列、本机能力探测、端侧大模型和批量导出曾共同写入侧栏中的字符串数组。字符串没有级别、范围、会话或稳定事件代码，导致切换视频后日志串台、首次打开侧栏回放全部已完成队列、错误重复提交，以及不同入口绕过数量限制和脱敏。

诊断信息主要用于用户自助排错和复制给开发者，不需要远程遥测或跨浏览器会话持久化。扩展还必须保持 Native Messaging stdout 的严格分帧协议。

## Decision

使用无第三方依赖的 `BSE.Diagnostics` 作为所有 UI 诊断的统一入口：

- 事件包含 `id`、`timestamp`、`level`、`scope`、`code`、`stage`、`message`、`sessionId` 和白名单 context。
- 在事件创建和格式化阶段分别执行一次脱敏。
- Store 在 `append()` 内统一执行短窗去重、单会话上限和总量上限。
- 当前视频按 `mediaKey` 建立会话；侧栏通过 presenter 隔离 `media`、`queue`、`native` 和 `batch` 范围。
- 默认视图显示 `info` 及以上，详细视图增加 `debug`。
- 旧 `(stage, message)` 回调通过兼容 reporter 映射到结构化事件。
- 最终错误只由 `commitError()` 提交一次；状态转换不再隐式记录错误。
- Native Host stdout 和 stderr 责任边界保持不变。

## Alternatives Considered

### 继续使用字符串数组并局部清空

改动较少，但无法可靠实现范围筛选、级别、稳定代码和统一脱敏，新增日志来源后仍会复发。

### 持久化日志和远程遥测

能提供历史分析，但增加隐私、权限、迁移和运维成本。SparkSub 当前只需要本地、短生命周期的诊断，因此拒绝。

## Consequences

- 用户默认看到的是关键流程，而不是 HTTP、CID、挂载调度等实现细节。
- 队列历史、本机能力和批量任务不再混入当前视频复制结果。
- 新的日志生产者必须通过 `BSE.Diagnostics` 或 `BSE.DiagnosticPresenter`，不能直接维护字符串数组。
- `AppState.diagnostics` 从 `string[]` 变为 `DiagnosticEvent[]`，扩展更新期间通过侧栏的旧字符串兼容入口处理短暂的新旧标签页共存。
- 日志只保留在内存中；关闭标签页、侧栏或扩展上下文后不会恢复。
