import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadModules(files) {
  const context = vm.createContext({
    console,
    URL,
    Date,
    structuredClone,
    globalThis: null
  });
  context.globalThis = context;
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context.BSE;
}

const BSE = loadModules(['core/namespace.js', 'core/diagnostics.js', 'core/diagnostic-presenter.js']);
const Diagnostics = BSE.Diagnostics;
const fixedNow = () => new Date('2026-08-31T23:21:24.000Z');

const normalized = Diagnostics.createEvent({
  level: 'invalid',
  scope: 'media',
  stage: '播放器信息/WBI',
  message: 'GET https://host.test/path?token=secret&lang=zh Authorization: Bearer abc',
  sessionId: 'media-1',
  context: { mediaKey: 'bili:BV1:p1', ignored: 'drop-me' }
}, fixedNow);
assert.equal(normalized.level, 'info');
assert.equal(normalized.scope, 'media');
assert.equal(normalized.code, 'LEGACY_WBI');
assert.equal(normalized.timestamp, '2026-08-31T23:21:24.000Z');
assert.equal(normalized.context.mediaKey, 'bili:BV1:p1');
assert.equal('ignored' in normalized.context, false);
assert.equal(/secret|Bearer abc/.test(normalized.message), false);
assert.match(normalized.message, /lang=zh/);

for (const unsafe of [
  'Cookie: sid=x',
  'https://host.test/x?auth_key=raw-auth&wsSecret=raw-ws&upsig=raw-sign',
  'https://host.test/x?sign%3Draw-encoded-secret',
  'https://user:pass@host.test/private?credential=raw',
  'refresh_token=raw-refresh authToken=raw-auth-token',
  'https://host.test/x?x-api-key=raw-x-api-key',
  'X-Api-Key: raw-header-key'
]) {
  const safe = Diagnostics.sanitizeText(unsafe);
  assert.equal(/sid=x|raw-auth|raw-ws|raw-sign|raw-encoded-secret|user:pass|credential=raw|raw-refresh|raw-auth-token|raw-x-api-key|raw-header-key/.test(safe), false);
}
assert.equal(
  Diagnostics.sanitizeEndpoint('http://user:pass@127.0.0.1:11434/private?token=secret'),
  'http://127.0.0.1:11434'
);

let clock = Date.parse('2026-08-31T23:21:24.000Z');
const store = Diagnostics.createStore({
  limit: 500,
  perSessionLimit: 100,
  dedupeWindowMs: 5000,
  now: () => new Date(clock)
});
const base = {
  level: 'info', scope: 'media', code: 'LOAD_START', stage: '启动加载',
  message: 'init', sessionId: 'media-1', context: { mediaKey: 'bili:BV1:p1' }
};
store.append(base);
store.append(base);
assert.equal(store.events().length, 1, 'same event inside dedupe window must collapse');
clock += 5001;
store.append(base);
assert.equal(store.events().length, 2, 'same event outside dedupe window must remain');

store.clear();
for (let i = 0; i < 105; i += 1) store.append({ ...base, message: `event-${i}` });
assert.equal(store.events({ scope: 'media', sessionId: 'media-1' }).length, 100);
store.replaceSession('media', 'media-2');
store.append({ ...base, sessionId: 'media-2', message: 'new media' });
assert.deepEqual(
  Array.from(store.events({ scope: 'media' }), (item) => item.message),
  ['new media']
);

const boundedStore = Diagnostics.createStore({
  limit: 2,
  perSessionLimit: 2,
  dedupeWindowMs: 5000,
  now: () => new Date(clock)
});
boundedStore.append({ ...base, message: 'evicted' });
boundedStore.append({ ...base, message: 'retained-1' });
boundedStore.append({ ...base, message: 'retained-2' });
boundedStore.append({ ...base, message: 'evicted' });
assert.deepEqual(
  Array.from(boundedStore.events(), (event) => event.message),
  ['retained-2', 'evicted'],
  'dedupe metadata for evicted events must not grow forever or suppress a new event'
);

const emitted = [];
const reporter = Diagnostics.createLegacyReporter((event) => emitted.push(event), {
  scope: 'media', sessionId: 'media-1'
});
reporter('播放器信息/WBI', 'HTTP 200 · 6467 字符');
reporter('字幕呈现', '成功加载 188 条字幕并同步显示');
reporter('通道切换', '后台异常，回退页面通道');
assert.deepEqual(Array.from(emitted, (item) => item.level), ['debug', 'info', 'warn']);

const faultEvents = Diagnostics.createFaultEvents({
  code: 'TIMEOUT', stage: '字幕内容', message: '超时', hint: '请重试'
}, { sessionId: 'media-1', context: { mediaKey: 'bili:BV1:p1' }, now: fixedNow });
assert.deepEqual(
  Array.from(faultEvents, (item) => [item.level, item.code]),
  [['error', 'TIMEOUT'], ['info', 'TIMEOUT_HINT']]
);

const localFaultTime = new Date(faultEvents[0].timestamp);
const localTimeLabel = [localFaultTime.getHours(), localFaultTime.getMinutes(), localFaultTime.getSeconds()]
  .map((part) => String(part).padStart(2, '0'))
  .join(':');
assert.match(Diagnostics.formatEvent(faultEvents[0]), new RegExp(`^\\[${localTimeLabel}\\] \\[media\\] \\[ERROR\\]`));

const mediaDiagnostics = Diagnostics.createMediaSession({ platform: 'bilibili', now: fixedNow });
mediaDiagnostics.begin('bili:BV1OLD:p1');
mediaDiagnostics.report('启动加载', 'init');
mediaDiagnostics.begin('bili:BV1NEW:p1');
mediaDiagnostics.report('启动加载', 'route');
assert.deepEqual(
  Array.from(mediaDiagnostics.events(), (event) => event.context.mediaKey),
  ['bili:BV1NEW:p1']
);
mediaDiagnostics.recordFault({ code: 'TIMEOUT', stage: '轨道发现', message: '超时', hint: '请重试' });
assert.deepEqual(
  Array.from(mediaDiagnostics.events().filter((event) => event.code.startsWith('TIMEOUT')), (event) => event.code),
  ['TIMEOUT', 'TIMEOUT_HINT']
);

let presenterClock = Date.parse('2026-08-31T23:21:24.000Z');
const presenterNow = () => new Date(presenterClock);
const presenter = BSE.DiagnosticPresenter.create({ limit: 500, now: presenterNow });
const eventFor = (sessionId, message, level = 'info') => Diagnostics.createEvent({
  scope: 'media', sessionId, message, level, code: 'MEDIA_EVENT', stage: '当前视频',
  context: { mediaKey: sessionId }
}, fixedNow);
presenter.activateMedia({ tabId: 1, sessionId: 'old', mediaKey: 'bili:old' });
presenter.ingestMedia([eventFor('old', 'old event')]);
presenter.activateMedia({ tabId: 2, sessionId: 'new', mediaKey: 'bili:new' });
const repeatedMediaEvents = [eventFor('new', 'new event'), eventFor('new', 'HTTP 200', 'debug')];
presenter.ingestMedia(repeatedMediaEvents);
presenterClock += 6000;
presenter.ingestMedia(repeatedMediaEvents);
assert.deepEqual(Array.from(presenter.visibleEvents(), (event) => event.message), ['new event']);

presenter.append({ scope: 'queue', sessionId: 'queue-1', level: 'info', code: 'QUEUE_PROGRESS', stage: '转录队列', message: 'queue event' });
assert.equal(presenter.visibleEvents().some((event) => event.scope === 'queue'), false);
presenter.selectScope('queue');
assert.equal(presenter.visibleEvents()[0].scope, 'queue');
presenter.selectScope('media');
presenter.setDetailed(true);
assert.equal(presenter.visibleEvents().some((event) => event.level === 'debug'), true);
presenter.clearSelected();
presenter.ingestMedia(repeatedMediaEvents);
assert.equal(presenter.visibleEvents().length, 0, 'cleared media events must stay cleared when the full state is rebroadcast');
presenter.ingestMedia([eventFor('new', 'new event after clear')]);
assert.deepEqual(Array.from(presenter.visibleEvents(), (event) => event.message), ['new event after clear']);

presenter.append({ scope: 'native', sessionId: 'native-old', level: 'info', code: 'NATIVE_PROBE', stage: '本机服务', message: 'old probe' });
presenter.append({ scope: 'native', sessionId: 'native-new', level: 'info', code: 'NATIVE_PROBE', stage: '本机服务', message: 'new probe' });
presenter.selectScope('native');
assert.deepEqual(Array.from(presenter.visibleEvents(), (event) => event.message), ['new probe']);

presenter.append({ scope: 'batch', sessionId: 'batch-old', level: 'info', code: 'BATCH_SCAN', stage: '批量任务', message: 'old batch' });
presenter.append({ scope: 'batch', sessionId: 'batch-new', level: 'info', code: 'BATCH_SCAN', stage: '批量任务', message: 'new batch' });
presenter.selectScope('batch');
assert.deepEqual(Array.from(presenter.visibleEvents(), (event) => event.message), ['new batch']);

assert.equal(presenter.observeQueueItem({ id: 'old-done', title: '历史任务', stage: 'done', progress: 100, stageHint: '完成' }), null);
assert.equal(presenter.observeQueueItem({ id: 'running', title: '运行任务', stage: 'transcribing', progress: 70, stageHint: '识别中' }).scope, 'queue');
assert.equal(presenter.observeQueueItem({ id: 'running', title: '运行任务', stage: 'done', progress: 100, stageHint: '完成' }).code, 'QUEUE_DONE');

presenter.selectScope('queue');
const copied = presenter.copySelected('扩展版本：0.2.0');
assert.match(copied, /queue event/);
assert.doesNotMatch(copied, /new event|old event/);

const statusPresenter = BSE.DiagnosticPresenter.create({ limit: 500, now: presenterNow });
statusPresenter.activateMedia({ tabId: 7, sessionId: 'media-status', mediaKey: 'bili:BV1:p1' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'info', code: 'LOAD_START', stage: '启动加载', message: 'init' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'debug', code: 'PLAYER_HTTP', stage: '播放器信息/WBI', message: 'HTTP 200 · 6467 字符' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'info', code: 'TRACKS_FOUND', stage: '查找字幕', message: '播放器接口返回 4 条字幕轨道' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'info', code: 'TRACKS_FOUND', stage: '查找字幕', message: '播放器接口返回 6 条字幕轨道' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'info', code: 'SUBTITLES_READY', stage: '字幕呈现', message: '成功加载 188 条字幕并同步显示' });
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'info', code: 'TIMEOUT_HINT', stage: '处理建议', message: '请重试' });
statusPresenter.append({ scope: 'native', sessionId: 'native-status', level: 'info', code: 'NATIVE_READY', stage: '本机服务', message: '本机服务已就绪' });
statusPresenter.append({ scope: 'native', sessionId: 'native-status', level: 'warn', code: 'NATIVE_PARTIAL', stage: '本机服务', message: '本机服务部分能力不可用' });

assert.deepEqual(
  Array.from(statusPresenter.statusEvents(), (event) => event.code),
  ['TRACKS_FOUND', 'SUBTITLES_READY'],
  'capability probing belongs to the offline-transcription card and must not become a second service status in the activity feed'
);
assert.deepEqual(
  Array.from(statusPresenter.activityEvents({ status: 'ready' }), (event) => event.code),
  [],
  'a successful summary must replace duplicate successful timeline entries'
);
statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'warn', code: 'TRACK_FALLBACK', stage: '字幕轨道回退', message: '首选轨道不可用，已使用备用轨道' });
assert.deepEqual(
  Array.from(statusPresenter.activityEvents({ status: 'ready' }), (event) => event.code),
  ['TRACK_FALLBACK'],
  'warnings remain visible after successful completion'
);

const loadingPresenter = BSE.DiagnosticPresenter.create({ limit: 500, now: presenterNow });
loadingPresenter.activateMedia({ tabId: 8, sessionId: 'media-loading', mediaKey: 'bili:BV2:p1' });
for (let step = 1; step <= 4; step += 1) {
  loadingPresenter.append({ scope: 'media', sessionId: 'media-loading', level: 'info', code: `LOAD_STEP_${step}`, stage: `加载步骤 ${step}`, message: `正在执行步骤 ${step}` });
}
assert.deepEqual(
  Array.from(loadingPresenter.activityEvents({ status: 'loading' }), (event) => event.code),
  ['LOAD_STEP_2', 'LOAD_STEP_3', 'LOAD_STEP_4'],
  'in-progress activity must stay dense by keeping only the latest three key steps'
);
assert.deepEqual(
  ((item) => ({ id: item.id, tone: item.tone, title: item.title, detail: item.detail }))(statusPresenter.statusItem(statusPresenter.statusEvents()[1])),
  {
    id: statusPresenter.statusEvents()[1].id,
    tone: 'success',
    title: '字幕已就绪',
    detail: '已加载 188 条字幕'
  },
  'successful subtitle completion must read naturally without developer fields'
);
assert.match(statusPresenter.statusItem(statusPresenter.statusEvents()[1]).time, /^\d{2}:\d{2}:\d{2}$/);
assert.equal(statusPresenter.technicalEvents().some((event) => event.code === 'PLAYER_HTTP'), true, 'developer details must retain debug events');
assert.equal(statusPresenter.technicalEvents().some((event) => event.code === 'NATIVE_PARTIAL'), true, 'native capability evidence must remain available for troubleshooting');
assert.match(statusPresenter.copyTechnical('扩展版本：0.2.0'), /\[media\] \[DEBUG\].*HTTP 200/);
assert.equal(statusPresenter.technicalEvents().some((event) => event.code === 'TIMEOUT_HINT'), false, 'remediation advice must not appear in the user-facing diagnostics drawer');
assert.doesNotMatch(statusPresenter.copyTechnical('扩展版本：0.2.0'), /请重试/);

statusPresenter.append({ scope: 'queue', sessionId: 'offline-job-1', level: 'error', code: 'QUEUE_FAILED', stage: '离线转录失败', message: '本机服务未连接' });
assert.equal(statusPresenter.statusEvents().at(-1).code, 'QUEUE_FAILED', 'an actual offline job failure must still appear as task status');

statusPresenter.append({ scope: 'media', sessionId: 'media-status', level: 'error', code: 'CAPTION_FETCH_FAILED', stage: '字幕加载失败', message: '字幕接口返回空内容' });
const errorItem = statusPresenter.statusItem(statusPresenter.statusEvents().at(-1));
assert.deepEqual(
  { tone: errorItem.tone, title: errorItem.title, detail: errorItem.detail },
  { tone: 'error', title: '字幕加载失败', detail: '字幕接口返回空内容' },
  'errors must show only the failure cause, without remediation hints'
);

assert.deepEqual(
  { ...statusPresenter.summarizeState({
    status: 'ready',
    cues: new Array(188),
    selectedTrackId: 'zh',
    tracks: [{ id: 'zh', lanDoc: '中文', lan: 'zh-CN' }]
  }) },
  { tone: 'success', label: '运行正常', title: '字幕已就绪', detail: '188 条 · 中文' }
);
assert.deepEqual(
  { ...statusPresenter.summarizeState({
    status: 'error',
    message: '加载失败',
    lastError: { message: '字幕接口返回空内容', hint: '请刷新页面后重试' }
  }) },
  { tone: 'error', label: '发生错误', title: '字幕加载失败', detail: '字幕接口返回空内容' },
  'the primary status must show the error cause and omit remediation advice'
);

console.log('✅ Structured diagnostics tests passed');
