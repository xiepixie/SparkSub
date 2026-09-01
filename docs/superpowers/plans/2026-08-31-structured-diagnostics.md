# SparkSub Structured Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SparkSub's mixed string log stream with scoped, structured, deduplicated, bounded, and sanitized diagnostic sessions while keeping legacy platform callbacks compatible.

**Architecture:** A new dependency-free `BSE.Diagnostics` core owns event normalization, sanitization, formatting, and bounded stores. A focused `BSE.DiagnosticPresenter` owns sidepanel session selection, queue-observation behavior, filtering, clearing, and copy output; content state remains the sole producer for current-media diagnostics.

**Tech Stack:** Chrome Extension Manifest V3, browser JavaScript, Node.js `vm` tests, TypeScript `checkJs` declarations, HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-08-31-structured-diagnostics-design.md`

## Global Constraints

- Do not add remote telemetry, persistence, third-party packages, or new permissions.
- Native Messaging stdout remains protocol frames only; `--diagnose` remains the only readable JSON stdout mode.
- Continue accepting legacy `(stage, message)` diagnostic callbacks during migration.
- Default UI shows `info` and above; detailed UI includes `debug`.
- A media session holds at most 100 events; the sidepanel presenter holds at most 500 active events.
- Sanitize on event creation and again on formatting/copy.
- Existing uncommitted user changes overlap `manifest.json`, `content/app.js`, `sidepanel/sidepanel.js`, `core/queue.js`, and `tests/run-tests.mjs`; preserve them and do not create implementation commits that would capture unrelated changes.

## File Structure

- Create `core/diagnostics.js`: event schema, sanitization, legacy classification, formatting, store, and fault-event construction.
- Create `core/diagnostic-presenter.js`: sidepanel-only active sessions, scope/detail selection, queue observation, visible view model, clear, and copy.
- Create `tests/diagnostics-tests.mjs`: real behavior tests for both new modules.
- Modify `tests/run-tests.mjs`: run the focused diagnostics suite and verify extension wiring.
- Modify `types/bse.d.ts`: declare events, stores, presenter, and structured `AppState` fields.
- Modify `manifest.json`, `background/service-worker.js`, and `sidepanel/sidepanel.html`: load the new modules before consumers.
- Modify `content/app.js`: media session lifecycle, structured reporter, and single fault submission.
- Modify `sidepanel/sidepanel.js`, `sidepanel/sidepanel.html`, `sidepanel/sidepanel.css`, and `core/i18n.js`: scoped diagnostics controls and rendering.
- Modify `core/queue.js`, `core/asr-polisher.js`, and selected platform callers: remove warning-stack noise and attach safe structured metadata.
- Create `docs/decisions/ADR-001-structured-diagnostics.md` and update `docs/架构与消息协议.md`.

---

### Task 1: Structured diagnostics core

**Files:**
- Create: `tests/diagnostics-tests.mjs`
- Create: `core/diagnostics.js`
- Modify: `tests/run-tests.mjs`
- Modify: `types/bse.d.ts`
- Modify: `manifest.json`
- Modify: `background/service-worker.js`
- Modify: `sidepanel/sidepanel.html`

**Interfaces:**
- Produces: `BSE.Diagnostics.createEvent(input, now?)`
- Produces: `BSE.Diagnostics.sanitizeText(value, options?)`
- Produces: `BSE.Diagnostics.sanitizeEndpoint(value)`
- Produces: `BSE.Diagnostics.formatEvent(event, options?)`
- Produces: `BSE.Diagnostics.createStore({ limit, perSessionLimit, dedupeWindowMs, now? })`
- Produces: `BSE.Diagnostics.createLegacyReporter(emit, defaults)`
- Produces: `BSE.Diagnostics.createFaultEvents(fault, defaults)`

- [ ] **Step 1: Write failing normalization and sanitization tests**

Create a VM context, load `core/namespace.js` and the not-yet-existing `core/diagnostics.js`, then assert literal behavior:

```js
const fixedNow = () => new Date('2026-08-31T23:21:24.000Z');
const event = Diagnostics.createEvent({
  level: 'invalid', scope: 'media', stage: '播放器信息/WBI',
  message: 'GET https://host.test/path?token=secret&lang=zh Authorization: Bearer abc',
  sessionId: 'media-1', context: { mediaKey: 'bili:BV1:p1', ignored: 'drop-me' }
}, fixedNow);
assert.equal(event.level, 'info');
assert.equal(event.scope, 'media');
assert.equal(event.code, 'LEGACY_WBI');
assert.equal(event.timestamp, '2026-08-31T23:21:24.000Z');
assert.equal(event.context.mediaKey, 'bili:BV1:p1');
assert.equal('ignored' in event.context, false);
assert.equal(/secret|Bearer abc/.test(event.message), false);
```

Add literal cases for `Cookie: sid=x`, `auth_key`, `wsSecret`, `upsig`, credential-bearing URLs, and LLM endpoints; assert safe query fields such as `lang=zh` remain.

Assert `sanitizeEndpoint('http://user:pass@127.0.0.1:11434/private?token=secret')` equals the hand-derived literal `http://127.0.0.1:11434`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL because `core/diagnostics.js` does not exist.

- [ ] **Step 3: Implement event normalization and sanitization**

Implement an IIFE module with fixed allowlists:

```js
const LEVELS = ['debug', 'info', 'warn', 'error'];
const SCOPES = ['media', 'queue', 'native', 'batch', 'tracker', 'system'];
const CONTEXT_KEYS = ['mediaKey', 'jobId', 'platform', 'tabId'];

function createEvent(input, now = () => new Date()) {
  const source = input && typeof input === 'object' ? input : { message: input };
  const level = LEVELS.includes(source.level) ? source.level : 'info';
  const scope = SCOPES.includes(source.scope) ? source.scope : 'system';
  const stage = sanitizeText(source.stage || '诊断');
  const message = sanitizeText(source.message || '');
  const sessionId = sanitizeIdentifier(source.sessionId || `${scope}:default`);
  const code = normalizeCode(source.code || legacyCode(stage));
  const timestamp = now().toISOString();
  return { id: createId(timestamp, scope, sessionId, code, message), timestamp, level, scope, code, stage, message, sessionId, context: pickContext(source.context) };
}
```

Sanitize URL query values by key, redact credential headers, cap stage at 120 characters and message at 2,000 characters, and never mutate input objects.

- [ ] **Step 4: Write failing store, legacy, and fault tests**

Add tests whose failure names the protected behavior:

```js
store.append(base);
store.append(base);
assert.equal(store.events().length, 1, 'same event inside dedupe window must collapse');

clock += 5001;
store.append(base);
assert.equal(store.events().length, 2, 'same event outside dedupe window must remain');

for (let i = 0; i < 105; i += 1) store.append({ ...base, message: `event-${i}` });
assert.equal(store.events({ scope: 'media', sessionId: 'media-1' }).length, 100);

store.replaceSession('media', 'media-2');
store.append({ ...base, sessionId: 'media-2', message: 'new media' });
assert.deepEqual(store.events({ scope: 'media' }).map((item) => item.message), ['new media']);

const reporter = Diagnostics.createLegacyReporter(events.push.bind(events), { scope: 'media', sessionId: 'media-1' });
reporter('播放器信息/WBI', 'HTTP 200 · 6467 字符');
assert.equal(events[0].level, 'debug');

const faultEvents = Diagnostics.createFaultEvents({ code: 'TIMEOUT', stage: '字幕内容', message: '超时', hint: '请重试' }, { sessionId: 'media-1' });
assert.deepEqual(faultEvents.map((item) => [item.level, item.code]), [['error', 'TIMEOUT'], ['info', 'TIMEOUT_HINT']]);
```

- [ ] **Step 5: Run the focused test and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL at the first missing store/legacy/fault behavior.

- [ ] **Step 6: Implement the store, reporter, formatter, and fault events**

The store must expose `append`, `replaceSession`, `events`, and `clear`; route legacy strings through `createEvent`; dedupe on `scope/sessionId/level/code/stage/message`; enforce per-session and total limits inside `append()`; and return cloned arrays from `events()`.

Legacy classification rules:

```js
if (/HTTP|通道|挂载|BPX|缓存|环境信息|CID|探测\(/i.test(`${stage} ${message}`)) return 'debug';
if (/失败|异常|回退|降级|拦截|残缺|错配/i.test(`${stage} ${message}`)) return 'warn';
return 'info';
```

`formatEvent()` outputs `[HH:mm:ss] [scope] [LEVEL] stage：message` and applies `sanitizeText()` again.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `node tests/diagnostics-tests.mjs`

Expected: PASS with no warnings.

- [ ] **Step 8: Wire and type the core**

Load `core/diagnostics.js` immediately after `core/namespace.js` in the manifest content-script list, Service Worker `importScripts`, sidepanel script list, and primary VM test list. Add `DiagnosticLevel`, `DiagnosticScope`, `DiagnosticEvent`, `DiagnosticStore`, and `DiagnosticsModule` declarations; change `AppState.diagnostics` to `DiagnosticEvent[]` and add `diagnosticSessionId: string`.

- [ ] **Step 9: Run the full JS suite**

Run: `node tests/run-tests.mjs`

Expected: PASS; existing behavior remains intact.

### Task 2: Current-media session integration and single error submission

**Files:**
- Modify: `content/app.js`
- Modify: `tests/diagnostics-tests.mjs`
- Modify: `types/bse.d.ts`

**Interfaces:**
- Consumes: `BSE.Diagnostics.createStore`, `createLegacyReporter`, and `createFaultEvents`
- Produces: `AppState.diagnosticSessionId` and `AppState.diagnostics: DiagnosticEvent[]`

- [ ] **Step 1: Write failing media lifecycle tests**

Load the real `content/app.js` in a focused VM fixture with a minimal document, `chrome.runtime`, `BSE.RollingPanel.create`, and a Bilibili adapter whose `discoverTracks()` can be controlled. Capture every `BSE_STATE_UPDATE` message. First resolve one media, then change the fixture URL/media key and trigger the registered route callback; assert the last public state contains only the new media session. Next reject `discoverTracks()` with a literal timeout fault and assert the broadcast state contains exactly one error event and one hint event:

```js
await fixture.loadMedia('bili:BV1OLD:p1');
await fixture.navigateTo('bili:BV1NEW:p1');
assert.deepEqual(fixture.lastState().diagnostics.map((event) => event.context.mediaKey), ['bili:BV1NEW:p1']);

await fixture.failDiscovery({ code: 'TIMEOUT', stage: '轨道发现', message: '超时', hint: '请重试' });
assert.deepEqual(
  fixture.lastState().diagnostics.filter((event) => event.code.startsWith('TIMEOUT')).map((event) => event.code),
  ['TIMEOUT', 'TIMEOUT_HINT']
);
```

The production change that makes the second assertion fail is reintroducing implicit fault recording in `transitionTo('error')`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL because the real content state still publishes string diagnostics and duplicates the timeout fault pair.

- [ ] **Step 3: Replace the content string array with a media store**

Initialize a store with `limit: 100, perSessionLimit: 100`. Create a new session only when `mediaKey` changes:

```js
function beginMediaDiagnostics(mediaKey) {
  const nextSession = `media:${mediaKey}:${Date.now()}`;
  mediaDiagnostics.clear({ scope: 'media' });
  state.diagnosticSessionId = nextSession;
  state.diagnostics = [];
  diagnostic = BSE.Diagnostics.createLegacyReporter(appendMediaDiagnostic, {
    scope: 'media', sessionId: nextSession,
    context: { mediaKey, platform }
  });
}
```

`appendMediaDiagnostic()` updates `state.diagnostics` only from `store.events({ scope: 'media', sessionId })` and keeps the existing 80 ms publish throttle.

- [ ] **Step 4: Make fault submission explicit and singular**

Change `commitError()` to append `createFaultEvents()` once. Remove `commitError()` from `transitionTo('error')`; it accepts `payload.fault` only:

```js
} else if (status === 'error') {
  state.lastError = payload.fault || state.lastError;
  state.isRefreshing = false;
}
```

Both catch paths call `const fault = commitError(...)` once and pass `{ fault }` to `transitionTo` without the raw `error`.

- [ ] **Step 5: Run focused and full tests**

Run: `node tests/diagnostics-tests.mjs && node tests/run-tests.mjs`

Expected: PASS; a fault yields exactly two fault-related events.

### Task 3: Scoped sidepanel presenter and queue replay suppression

**Files:**
- Create: `core/diagnostic-presenter.js`
- Modify: `tests/diagnostics-tests.mjs`
- Modify: `sidepanel/sidepanel.html`
- Modify: `manifest.json`
- Modify: `types/bse.d.ts`

**Interfaces:**
- Produces: `BSE.DiagnosticPresenter.create({ limit, store? })`
- Produces presenter methods: `activateMedia`, `ingestMedia`, `append`, `observeQueueItem`, `selectScope`, `setDetailed`, `visibleEvents`, `clearSelected`, `copySelected`

- [ ] **Step 1: Write failing presenter session tests**

```js
const presenter = DiagnosticPresenter.create({ limit: 500 });
presenter.activateMedia({ tabId: 1, sessionId: 'old', mediaKey: 'bili:old' });
presenter.ingestMedia([eventFor('old', 'old event')]);
presenter.activateMedia({ tabId: 2, sessionId: 'new', mediaKey: 'bili:new' });
presenter.ingestMedia([eventFor('new', 'new event')]);
assert.deepEqual(presenter.visibleEvents().map((event) => event.message), ['new event']);

presenter.append(queueEvent);
assert.equal(presenter.visibleEvents().some((event) => event.scope === 'queue'), false);
presenter.selectScope('queue');
assert.equal(presenter.visibleEvents()[0].scope, 'queue');
```

- [ ] **Step 2: Write failing detail, clear, copy, and queue-observation tests**

```js
presenter.selectScope('media');
presenter.setDetailed(false);
assert.deepEqual(presenter.visibleEvents().map((event) => event.level), ['info', 'warn', 'error']);
presenter.setDetailed(true);
assert.equal(presenter.visibleEvents().some((event) => event.level === 'debug'), true);

assert.equal(presenter.observeQueueItem({ id: 'old-done', stage: 'done', progress: 100, stageHint: '完成' }), null);
assert.equal(presenter.observeQueueItem({ id: 'running', stage: 'transcribing', progress: 70, stageHint: '识别中' }).scope, 'queue');
assert.equal(presenter.observeQueueItem({ id: 'running', stage: 'done', progress: 100, stageHint: '完成' }).code, 'QUEUE_DONE');
```

Assert `copySelected()` includes only the selected scope/session and never includes a secret query value.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL because `core/diagnostic-presenter.js` does not exist.

- [ ] **Step 4: Implement the presenter**

Use one `BSE.Diagnostics` store. `activateMedia()` replaces the active media selector without deleting queue/native/batch sessions. `visibleEvents()` queries only the selected scope and active session, with `minLevel: detailed ? 'debug' : 'info'`.

`observeQueueItem()` seeds terminal items silently on first observation; active items emit on first observation; later signature changes emit exactly once. It uses stable codes `QUEUE_PROGRESS`, `QUEUE_DONE`, and `QUEUE_FAILED`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node tests/diagnostics-tests.mjs`

Expected: PASS with no warnings.

- [ ] **Step 6: Wire and type the presenter**

Load `core/diagnostic-presenter.js` after `core/diagnostics.js` in the sidepanel only. Declare its input and result types in `types/bse.d.ts`.

- [ ] **Step 7: Run full JS tests**

Run: `node tests/run-tests.mjs`

Expected: PASS.

### Task 4: Sidepanel scoped diagnostics UI

**Files:**
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.css`
- Modify: `sidepanel/sidepanel.js`
- Modify: `core/i18n.js`
- Modify: `tests/diagnostics-tests.mjs`

**Interfaces:**
- Consumes: the `BSE.DiagnosticPresenter` API from Task 3
- Produces: scope selector, key/detail toggle, clear-current-scope action, and current-scope copy output

- [ ] **Step 1: Write failing DOM behavior tests using a minimal real DOM fixture**

Build a focused fake DOM containing only diagnostics controls and load a small exported binding function from the presenter module. Exercise real click/change handlers rather than searching source text. Verify:

```js
fixture.scope.value = 'queue';
fixture.scope.dispatchEvent({ type: 'change' });
assert.match(fixture.output.textContent, /queue event/);
assert.doesNotMatch(fixture.output.textContent, /media event/);

fixture.detail.checked = false;
fixture.detail.dispatchEvent({ type: 'change' });
assert.doesNotMatch(fixture.output.textContent, /HTTP 200/);

fixture.clear.click();
assert.equal(fixture.output.textContent, '暂无诊断信息');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL because the diagnostics controls/binding are missing.

- [ ] **Step 3: Add diagnostics controls**

Add accessible controls inside the diagnostics body:

```html
<select id="diagnostic-scope-select" aria-label="诊断范围">
  <option value="media">当前视频</option>
  <option value="queue">转录队列</option>
  <option value="native">本机服务</option>
  <option value="batch">批量任务</option>
</select>
<label><input id="diagnostic-detail-toggle" type="checkbox">详细日志</label>
<button id="clear-diagnostic-button" type="button">清空当前范围</button>
```

Add `aria-live="polite"` to the summary, focus-visible styles, compact mobile wrapping, and i18n keys for Chinese, Traditional Chinese, and English.

- [ ] **Step 4: Replace direct array mutation in the sidepanel**

Delete `sidepanelDiagnostics` and `lastLoggedQueueStates`. Instantiate one presenter. Route all sources through it:

```js
function appendDiagnostic(stage, message, defaults = {}) {
  diagnosticsPresenter.append({ stage, message, ...defaults });
  renderDiagnostics();
}
```

`renderState()` calls `activateMedia()` when tab/session changes, then `ingestMedia(state.diagnostics)`. `loadAndRenderQueue()` calls `observeQueueItem()` and appends only non-null events. Native and batch callbacks pass their scopes and stable session IDs.

- [ ] **Step 5: Render, filter, clear, and copy only the selected session**

`renderDiagnostics()` formats `presenter.visibleEvents()`; the summary counts only those visible events. Copy uses `presenter.copySelected(header)` rather than the former global array. Event listeners update presenter selection before rendering.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/diagnostics-tests.mjs && node tests/run-tests.mjs`

Expected: PASS; the first queue load does not emit already-completed history.

### Task 5: Severity cleanup, safe endpoint reporting, and documentation

**Files:**
- Modify: `core/queue.js`
- Modify: `core/asr-polisher.js`
- Modify: `platform/bilibili.js`
- Modify: `platform/youtube.js`
- Modify: `tests/diagnostics-tests.mjs`
- Create: `docs/decisions/ADR-001-structured-diagnostics.md`
- Modify: `docs/架构与消息协议.md`

**Interfaces:**
- Consumes: structured diagnostics and legacy reporter classification
- Produces: clean console output and documented diagnostic contracts

- [ ] **Step 1: Write failing expected-fallback and endpoint tests**

Capture console output while exercising the native-caption-not-found fallback with an error carrying a stack. Assert no warning contains `CAPTIONS_NOT_FOUND` or the stack, while the returned control flow still selects local transcription.

Exercise the polisher reporter with `http://user:pass@127.0.0.1:11434/private?token=secret` and assert the event contains only `http://127.0.0.1:11434`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/diagnostics-tests.mjs`

Expected: FAIL because the fallback still calls `console.warn` with the Error object or the endpoint is reported raw.

- [ ] **Step 3: Remove expected warning-stack output and add stable diagnostics**

For expected `CAPTIONS_NOT_FOUND`, return the fallback without `console.warn`. For unexpected recoverable native-caption errors, emit a `warn` diagnostic with stable code `NATIVE_CAPTION_FALLBACK` and sanitized message, but do not print the Error object stack.

Pass the polisher a display endpoint produced by `BSE.Diagnostics.sanitizeEndpoint(endpoint)`. Keep the real endpoint unchanged for the request.

Add explicit structured calls only where the legacy classifier cannot infer correct semantics; do not mechanically rewrite every platform log call.

- [ ] **Step 4: Run focused and full tests**

Run: `node tests/diagnostics-tests.mjs && node tests/run-tests.mjs`

Expected: PASS and no expected-fallback warning stack in test output.

- [ ] **Step 5: Record the decision and protocol**

Create ADR-001 with status Accepted, date 2026-08-31, context, decision, alternatives, and consequences. Update `docs/架构与消息协议.md` to define `DiagnosticEvent[]`, `diagnosticSessionId`, scope ownership, default/detail levels, and the rule that all UI events pass through the shared store.

- [ ] **Step 6: Run documentation and diff checks**

Run:

```bash
rg -n "diagnostics\s+不含令牌的阶段日志|diagnostics: string\[\]" docs types
git diff --check
```

Expected: the old string-only contract is absent; `git diff --check` exits 0.

### Task 6: Final verification and manual artifact review

**Files:**
- Verify all files from Tasks 1-5

**Interfaces:**
- Validates the complete spec without introducing new production behavior

- [ ] **Step 1: Run all automated verification**

Run:

```bash
node tests/diagnostics-tests.mjs
node tests/run-tests.mjs
node tests/orchestrator-tests.mjs
swift test --package-path native/SparkSubHost
npx tsc --noEmit
git diff --check
```

Expected: diagnostics, JS, orchestrator, and Swift tests pass; TypeScript output is compared against the documented existing baseline and introduces no new diagnostics; diff check exits 0.

- [ ] **Step 2: Inspect the final diff against the spec**

Confirm each success criterion has direct evidence: one fault pair, one active media session, separated scopes, hidden debug by default, bounded stores, safe copy, no expected fallback stack, and unchanged Native Host stdout.

- [ ] **Step 3: Manually validate the user-provided scenario**

Reload the unpacked extension, open `bili:BV1yYtA6sEcs:p1`, and verify the default current-video log is limited to the start, track discovery, and 188-cue success events. Confirm completed historical queue items appear only after selecting the queue scope and are not replayed as new events on sidepanel initialization. Toggle detailed logs to reveal HTTP/CID/mount events, then copy and confirm only the selected scope/session appears.

- [ ] **Step 4: Report working-tree boundaries**

List files changed by this implementation separately from pre-existing dirty files. Do not commit overlapping user changes without explicit authorization.
