import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise((resolve) => queueMicrotask(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadOrchestrator(drain) {
  const context = vm.createContext({ console, Promise, queueMicrotask, globalThis: null });
  context.globalThis = context;
  vm.runInContext(source('core/namespace.js'), context, { filename: 'core/namespace.js' });
  vm.runInContext(source('core/queue-orchestrator.js'), context, { filename: 'core/queue-orchestrator.js' });
  return context.BSE.QueueOrchestrator.create({ drain });
}

function waitForWorker() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertStableProxyFailure(response, message) {
  assert.equal(response?.ok, false, message);
  assert.equal(typeof response?.error?.code, 'string', `${message}: error code`);
  assert.ok(response.error.code.length > 0, `${message}: non-empty error code`);
  assert.equal(typeof response?.error?.message, 'string', `${message}: error message`);
  assert.ok(response.error.message.length > 0, `${message}: non-empty error message`);
  assert.equal(typeof response?.error?.hint, 'string', `${message}: error hint`);
  assert.ok(response.error.hint.length > 0, `${message}: non-empty error hint`);
  assert.equal(typeof response?.error?.retriable, 'boolean', `${message}: retriable flag`);
}

function createServiceWorkerHarness() {
  const runtimeMessages = [];
  const runtimeListeners = [];
  const startupListeners = [];
  const storageListeners = [];
  let drainCalls = 0;
  let queueDrain = () => Promise.resolve();
  const queueEnqueues = [];
  const queue = {
    addToQueue: async (urls, options) => {
      queueEnqueues.push({ urls, options });
      return (Array.isArray(urls) ? urls : [urls]).map((url, index) => ({ id: `${index}`, url }));
    },
    retryItem: async (id) => ({ id }),
    getQueue: async () => [],
    clearCompleted: async () => 0,
    clearAll: async () => {},
    removeFromQueue: async () => true,
    exportQueueMergedMarkdown: async () => '',
    processPendingJobs: () => { drainCalls += 1; return queueDrain(); }
  };
  const nativeCalls = [];
  const context = vm.createContext({
    console,
    Promise,
    URL,
    AbortController,
    DOMException,
    TextEncoder,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    globalThis: null,
    chrome: {
      runtime: {
        id: 'extension-id',
        getURL: (value = '') => `chrome-extension://extension-id/${value}`,
        getContexts: async () => [],
        sendMessage: async (message) => { runtimeMessages.push(message); return { ok: true }; },
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
        onStartup: { addListener: (listener) => startupListeners.push(listener) },
        onInstalled: { addListener: () => {} }
      },
      storage: { onChanged: { addListener: (listener) => storageListeners.push(listener) } },
      contextMenus: { onClicked: { addListener: () => {} }, removeAll: () => {}, create: () => {} },
      declarativeNetRequest: { updateDynamicRules: async () => {} },
      alarms: { onAlarm: { addListener: () => {} } },
      tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} }, onActivated: { addListener: () => {} } },
      webRequest: { onBeforeRequest: { addListener: () => {} } }
    }
  });
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      if (file.endsWith('/core/namespace.js')) vm.runInContext(source('core/namespace.js'), context, { filename: file });
      else if (file.endsWith('/core/queue-orchestrator.js')) vm.runInContext(source('core/queue-orchestrator.js'), context, { filename: file });
      else if (file.endsWith('/core/queue.js')) context.BSE.Queue = queue;
      else if (file.endsWith('/core/native-host.js')) {
        context.BSE.NativeHost = {
          getCapabilities: async ({ force } = {}) => { nativeCalls.push(['capabilities', force]); return { hostReady: true, force }; },
          cancel: async (jobId) => { nativeCalls.push(['cancel', jobId]); return { cancelled: true }; }
        };
      }
    }
  };
  vm.runInContext(source('background/service-worker.js'), context, { filename: 'background/service-worker.js' });
  const dispatch = async (message, sender) => {
    let response;
    const keepAlive = runtimeListeners[0](message, sender, (value) => { response = value; });
    if (keepAlive) for (let i = 0; i < 8 && response === undefined; i += 1) await tick();
    return response;
  };
  return {
    dispatch,
    runtimeMessages,
    nativeCalls,
    queueEnqueues,
    setNativeHost: (host) => { context.BSE.NativeHost = host; },
    runStartup: async () => { startupListeners.forEach((listener) => listener()); await tick(); },
    runStorageChange: async (changes) => { storageListeners.forEach((listener) => listener(changes, 'local')); await tick(); },
    get drainCalls() { return drainCalls; },
    setQueueDrain: (fn) => { queueDrain = fn; }
  };
}

export async function runOrchestratorTests() {
  const first = deferred();
  let drains = 0;
  const orchestrator = loadOrchestrator(() => {
    drains += 1;
    return drains === 1 ? first.promise : Promise.resolve();
  });
  const firstWake = orchestrator.wake();
  const simultaneousWake = orchestrator.wake();
  assert.strictEqual(simultaneousWake, firstWake, 'simultaneous wake signals must share the same in-flight promise');
  await tick();
  assert.equal(drains, 1, 'only one drain may start for simultaneous wakes');
  orchestrator.wake();
  orchestrator.wake();
  first.resolve();
  await firstWake;
  assert.equal(drains, 2, 'multiple wakes during a drain must coalesce into exactly one follow-up drain');

  const rejectedFirstDrain = deferred();
  const rejectedFollowUpDrain = deferred();
  let rejectedDrainCalls = 0;
  const preservedWake = loadOrchestrator(() => {
    rejectedDrainCalls += 1;
    return rejectedDrainCalls === 1 ? rejectedFirstDrain.promise : rejectedFollowUpDrain.promise;
  });
  const failedSharedWake = preservedWake.wake();
  const observedSharedFailure = assert.rejects(failedSharedWake, /first drain failed/);
  await tick();
  assert.strictEqual(preservedWake.wake(), failedSharedWake, 'a wake during a failing drain must share the current run');
  rejectedFirstDrain.reject(new Error('first drain failed'));
  await tick();
  await tick();
  assert.equal(rejectedDrainCalls, 2, 'a wake requested before failure must still drain once after failure');
  rejectedFollowUpDrain.resolve();
  await observedSharedFailure;

  let noWakeFailureCalls = 0;
  const noWakeFailure = loadOrchestrator(() => {
    noWakeFailureCalls += 1;
    throw new Error('one failure');
  });
  await assert.rejects(noWakeFailure.wake(), /one failure/);
  assert.equal(noWakeFailureCalls, 1, 'a failure without a queued wake must not add a drain');

  const rejection = loadOrchestrator(() => Promise.reject(new Error('drain failed')));
  await assert.rejects(rejection.wake(), /drain failed/);
  let recovered = 0;
  const retryable = loadOrchestrator(() => {
    recovered += 1;
    if (recovered === 1) throw new Error('first failure');
  });
  await assert.rejects(retryable.wake(), /first failure/);
  await retryable.wake();
  assert.equal(recovered, 2, 'a rejected drain must release the orchestrator for later wakeups');

  const trustedExtension = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel/sidepanel.html' };
  const wakeSources = [
    ['enqueue', async (worker) => worker.dispatch({ type: 'BSE_QUEUE_ENQUEUE', urls: ['https://www.youtube.com/watch?v=abcdefghijk'] }, trustedExtension)],
    ['retry', async (worker) => worker.dispatch({ type: 'BSE_QUEUE_RETRY', id: 'job-1' }, trustedExtension)],
    ['startup', async (worker) => worker.runStartup()],
    ['queue storage change', async (worker) => worker.runStorageChange({ bse_transcription_queue_v1: { newValue: [] } })]
  ];
  for (const [name, trigger] of wakeSources) {
    const worker = createServiceWorkerHarness();
    await trigger(worker);
    await waitForWorker();
    assert.equal(worker.drainCalls, 1, `${name} must wake exactly one Service Worker drain`);
  }

  const selfWakingWorker = createServiceWorkerHarness();
  const storageFirstDrain = deferred();
  const storageFollowUpDrain = deferred();
  let activeDrains = 0;
  let maxActiveDrains = 0;
  let storageDrainRuns = 0;
  selfWakingWorker.setQueueDrain(() => {
    storageDrainRuns += 1;
    activeDrains += 1;
    maxActiveDrains = Math.max(maxActiveDrains, activeDrains);
    const pending = storageDrainRuns === 1 ? storageFirstDrain : storageFollowUpDrain;
    return pending.promise.finally(() => { activeDrains -= 1; });
  });
  await selfWakingWorker.runStorageChange({ bse_transcription_queue_v1: { newValue: [] } });
  await tick();
  await Promise.all(Array.from({ length: 4 }, () => selfWakingWorker.runStorageChange({
    'bse_transcription_queue_v1:item:job-1': { newValue: { stage: 'resolving' } }
  })));
  assert.equal(selfWakingWorker.drainCalls, 1, 'storage writes during an active drain must not start concurrent drains');
  storageFirstDrain.resolve();
  await waitForWorker();
  assert.equal(selfWakingWorker.drainCalls, 2, 'multiple active storage writes must coalesce to one follow-up drain');
  assert.equal(maxActiveDrains, 1, 'storage self-wakes must remain single-flight');
  storageFollowUpDrain.resolve();
  await waitForWorker();
  assert.equal(selfWakingWorker.drainCalls, 2, 'storage self-wake drain must stop after the coalesced follow-up');

  const worker = createServiceWorkerHarness();

  const languageEnqueue = await worker.dispatch({
    type: 'BSE_QUEUE_ENQUEUE',
    urls: ['https://www.youtube.com/watch?v=abcdefghijk'],
    options: { sourceLanguage: 'fr' }
  }, trustedExtension);
  assert.equal(languageEnqueue.ok, true);
  assert.deepEqual(worker.queueEnqueues.at(-1), {
    urls: ['https://www.youtube.com/watch?v=abcdefghijk'],
    options: { sourceLanguage: 'fr' }
  }, 'Service Worker enqueue must forward the exact selected source language');

  const caps = await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES', force: true }, trustedExtension);
  assert.deepEqual(JSON.parse(JSON.stringify(caps)), { ok: true, capabilities: { hostReady: true, force: true } });
  const cancellation = await worker.dispatch({ type: 'BSE_NATIVE_CANCEL', jobId: 'job-1' }, trustedExtension);
  assert.deepEqual(JSON.parse(JSON.stringify(cancellation)), { ok: true, result: { cancelled: true } });
  assert.deepEqual(worker.nativeCalls, [['capabilities', true], ['cancel', 'job-1']], 'native proxies must pass only force or jobId');
  const rejectedSender = await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES' }, {
    id: 'extension-id', tab: { id: 5, url: 'https://evil.example/' }, url: 'https://evil.example/'
  });
  assert.equal(rejectedSender.ok, false, 'webpage senders must not reach the native host proxy');
  assert.equal(rejectedSender.error.code, 'INVALID_SENDER');

  worker.setNativeHost({ cancel: async () => ({ cancelled: true }) });
  assertStableProxyFailure(await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES' }, trustedExtension), 'missing capabilities API must reply');
  worker.setNativeHost({ getCapabilities: () => { throw new Error('capabilities sync failure'); }, cancel: async () => ({ cancelled: true }) });
  assertStableProxyFailure(await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES' }, trustedExtension), 'sync capabilities failure must reply');
  worker.setNativeHost({ getCapabilities: () => undefined, cancel: async () => ({ cancelled: true }) });
  assertStableProxyFailure(await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES' }, trustedExtension), 'undefined capabilities result must reply');
  worker.setNativeHost({ getCapabilities: async () => ({ hostReady: true }), cancel: () => undefined });
  assertStableProxyFailure(await worker.dispatch({ type: 'BSE_NATIVE_CANCEL', jobId: 'job-1' }, trustedExtension), 'undefined cancel result must reply through the shared proxy path');
  worker.setNativeHost({
    getCapabilities: async () => { throw Object.assign(new Error('async capability failure'), { code: 'ASYNC_CAPS', hint: 'retry later', retriable: false }); },
    cancel: async () => ({ cancelled: true })
  });
  const asyncNativeFailure = await worker.dispatch({ type: 'BSE_NATIVE_CAPABILITIES' }, trustedExtension);
  assertStableProxyFailure(asyncNativeFailure, 'async capabilities failure must reply');
  assert.equal(asyncNativeFailure.error.code, 'ASYNC_CAPS', 'async native error codes must remain normalized');

  const retryStorage = new Map();
  const retryMessages = [];
  let retryLocalProcessCalls = 0;
  const retryContext = vm.createContext({
    console,
    Promise,
    Date,
    Math,
    JSON,
    structuredClone,
    globalThis: null,
    chrome: {
      storage: {
        local: {
          get: async (key) => {
            if (key === null) return Object.fromEntries(retryStorage.entries());
            return { [key]: retryStorage.get(key) };
          },
          set: async (items) => { Object.entries(items).forEach(([key, value]) => retryStorage.set(key, structuredClone(value))); },
          remove: async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => retryStorage.delete(key)); }
        }
      },
      runtime: { sendMessage: async (message) => { retryMessages.push(message); return { ok: true }; } }
    }
  });
  retryContext.globalThis = retryContext;
  vm.runInContext(source('core/namespace.js'), retryContext, { filename: 'retry/namespace.js' });
  vm.runInContext(source('core/queue.js'), retryContext, { filename: 'retry/queue.js' });
  const realProcessPendingJobs = retryContext.BSE.Queue.processPendingJobs;
  retryContext.BSE.Queue.processPendingJobs = () => { retryLocalProcessCalls += 1; return realProcessPendingJobs(); };
  await retryContext.BSE.Queue.saveQueue([{ id: 'retry-job', stage: 'failed', progress: 0, stageArtifacts: {}, metaCache: {} }]);
  await retryContext.BSE.Queue.retryItem('retry-job');
  assert.equal(retryLocalProcessCalls, 0, 'real retryItem must not process locally');
  assert.ok(retryMessages.some((message) => message.type === 'BSE_ORCHESTRATOR_NOTIFY'), 'real retryItem must notify the Service Worker');

  const directQueueCall = /(?:\bBSE\.Queue(?:\.|\?\.)processPendingJobs(?:\.|\?\.)?\s*\(|(?<!function\s)\bprocessPendingJobs\s*\()/;
  for (const fixture of ['BSE.Queue.processPendingJobs()', 'BSE.Queue?.processPendingJobs()', 'BSE.Queue?.processPendingJobs?.()', 'processPendingJobs()']) {
    assert.match(fixture, directQueueCall, `sole-executor detector must catch ${fixture}`);
  }
  assert.doesNotMatch('async function processPendingJobs() {}', directQueueCall, 'sole-executor detector must allow the queue function declaration');
  const productionFiles = ['core/queue.js', 'offscreen/offscreen.js', 'sidepanel/sidepanel.js'];
  for (const file of productionFiles) {
    assert.doesNotMatch(source(file), directQueueCall, `${file} must not directly execute the queue`);
  }
  assert.match(source('background/service-worker.js'), directQueueCall, 'the Service Worker must remain the sole queue executor');
  assert.doesNotMatch(source('background/service-worker.js'), /ensureOffscreenDocument\s*\(/, 'queue wakeups must not create an Offscreen Document');
  assert.doesNotMatch(source('offscreen/offscreen.js'), /BSE_ORCHESTRATOR_NOTIFY|BSE_QUEUE_ENQUEUE/, 'Offscreen must not react to queue wake signals');
  assert.doesNotMatch(source('offscreen/offscreen.js'), /runQueueLoop\s*\(/, 'Offscreen must not start queue work on load');
  assert.ok(!worker.runtimeMessages.some((message) => message.type === 'BSE_OFFSCREEN_START'), 'idle queue execution must not create or wake an Offscreen Document');

  const sidepanelSource = source('sidepanel/sidepanel.js');
  assert.match(sidepanelSource, /type:\s*'BSE_QUEUE_RETRY'/, 'sidepanel retry must route through the sole Service Worker executor');
  assert.match(sidepanelSource, /type:\s*'BSE_QUEUE_REMOVE'/, 'sidepanel removal must route through the Service Worker that owns active cancellation');
  assert.doesNotMatch(sidepanelSource, /BSE\.Queue\.retryItem\s*\(/, 'sidepanel must not retry an active item in its local execution context');
  assert.doesNotMatch(sidepanelSource, /BSE\.Queue\.removeFromQueue\s*\(/, 'sidepanel must not remove an active item outside the Service Worker context');
  assert.doesNotMatch(sidepanelSource, /BSE\.Queue\??\.addToQueue\s*\(/, 'sidepanel must not enqueue by mutating its local queue context');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runOrchestratorTests();
  console.log('✅ Queue orchestrator tests passed');
}
