import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { runOrchestratorTests } from './orchestrator-tests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await runOrchestratorTests();
let mockFetch = async () => { throw new Error('Unexpected network request in test'); };
const sessionStore = new Map();
const storageAreas = { local: new Map(), sync: new Map() };
const storageWriteHistory = [];
const createStorageArea = (area) => ({
  get: async (key) => {
    if (typeof key === 'string') {
      return { [key]: storageAreas[area].get(key) };
    }
    if (Array.isArray(key)) {
      const out = {};
      key.forEach((k) => { out[k] = storageAreas[area].get(k); });
      return out;
    }
    if (key && typeof key === 'object') {
      const out = {};
      Object.entries(key).forEach(([k, defVal]) => {
        out[k] = storageAreas[area].has(k) ? storageAreas[area].get(k) : defVal;
      });
      return out;
    }
    const out = {};
    storageAreas[area].forEach((v, k) => { out[k] = v; });
    return out;
  },
  set: async (values) => {
    const snapshot = structuredClone(values);
    storageWriteHistory.push(snapshot);
    Object.entries(snapshot).forEach(([key, value]) => storageAreas[area].set(key, value));
  },
  remove: async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => storageAreas[area].delete(key)); }
});
const messageListeners = new Set();
const nativePorts = [];
let nativeLastErrorMessage = null;
class FakeNativePort {
  constructor(name) {
    this.name = name;
    this.postedMessages = [];
    this.disconnected = false;
    this.messageListeners = new Set();
    this.disconnectListeners = new Set();
    this.onMessage = {
      addListener: (listener) => this.messageListeners.add(listener),
      removeListener: (listener) => this.messageListeners.delete(listener)
    };
    this.onDisconnect = {
      addListener: (listener) => this.disconnectListeners.add(listener),
      removeListener: (listener) => this.disconnectListeners.delete(listener)
    };
  }

  postMessage(message) {
    if (this.disconnected) throw new Error('Port is disconnected');
    this.postedMessages.push(structuredClone(message));
  }

  emitMessage(message) {
    this.messageListeners.forEach((listener) => listener(structuredClone(message)));
  }

  disconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
  }

  emitDisconnect(message) {
    if (this.disconnected) return;
    this.disconnected = true;
    nativeLastErrorMessage = message || null;
    this.disconnectListeners.forEach((listener) => listener());
    nativeLastErrorMessage = null;
  }
}
const windowMock = {
  addEventListener: (type, fn) => { if (type === 'message') messageListeners.add(fn); },
  removeEventListener: (type, fn) => { if (type === 'message') messageListeners.delete(fn); },
  postMessage: (data) => {
    if (data?.channel === 'bse-extension-bridge-v1' && data.direction === 'request') {
      queueMicrotask(() => {
        let result = {
          ready: true,
          video: { id: 'Ewd6CGwaEXY', title: '4 Language Habits That Get You Fluent FAST' },
          tracks: [
            { id: 'asr:en', lan: 'en', lanDoc: 'English (auto-generated)', subtitleUrl: 'https://www.youtube.com/api/timedtext?v=Ewd6CGwaEXY&lang=en', isAuto: true }
          ]
        };
        if (data.type === 'GET_PLAYLIST') {
          result = {
            listId: 'PL1234567890',
            title: 'Learn English FAST Playlist',
            items: [
              { id: 'Ewd6CGwaEXY', title: '4 Language Habits', duration: '10:05', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY&list=PL1234567890' },
              { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', duration: '03:32', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890' }
            ]
          };
        }
        const responseData = {
          channel: 'bse-extension-bridge-v1',
          direction: 'response',
          requestId: data.requestId,
          ok: true,
          result
        };
        messageListeners.forEach((fn) => {
          try { fn({ data: responseData }); } catch {}
        });
      });
    }
  }
};
URL.createObjectURL = () => 'blob:mock-url';
URL.revokeObjectURL = () => {};

const context = vm.createContext({
  console,
  crypto: {
    randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2)
  },
  URL,
  location: {
    href: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY',
    origin: 'https://www.youtube.com',
    hostname: 'www.youtube.com'
  },
  structuredClone,
  window: windowMock,
  setTimeout,
  clearTimeout,
  Blob,
  TextEncoder,
  TextDecoder,
  DOMException,
  AbortController,
  fetch: (...args) => mockFetch(...args),
  sessionStorage: {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key)
  },
  chrome: {
    storage: {
      local: createStorageArea('local'),
      sync: createStorageArea('sync')
    },
    runtime: {
      get lastError() {
        return nativeLastErrorMessage ? { message: nativeLastErrorMessage } : undefined;
      },
      connectNative: (name) => {
        const port = new FakeNativePort(name);
        nativePorts.push(port);
        return port;
      },
      sendMessage: async (msg) => {
        if (msg.type === 'BSE_FETCH_BILIBILI_RESOURCE') {
          if (msg.url.includes('/nav')) {
            return {
              success: true,
              status: 200,
              text: JSON.stringify({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4907a71099b74ab88168dec7d63f0d61.png' } } })
            };
          }
          if (msg.url.includes('/player/wbi/v2')) {
            return {
              success: true,
              status: 200,
              text: JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } })
            };
          }
        }
        return { success: true, status: 200, text: '{}' };
      }
    }
  },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {},
      click: () => {},
      remove: () => {}
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  },
  globalThis: null
});
context.globalThis = context;

for (const file of [
  'core/namespace.js',
  'core/native-host.js',
  'core/utils.js',
  'core/jszip.js',
  'core/i18n.js',
  'core/parsers.js',
  'core/formatters.js',
  'core/asr-polisher.js',
  'core/tracker.js',
  'core/media.js',
  'core/queue.js',
  'platform/bilibili.js',
  'platform/youtube.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const { BSE } = context;

// Native Messaging client behavior tests. These fail before core/native-host.js exists.
const nativeTestPort = () => nativePorts.at(-1);
const resetNativeHost = () => {
  BSE.NativeHost?.disconnect();
  nativePorts.length = 0;
};
const expectNativeError = (code) => (error) => error?.code === code;
const expectNormalizedNativeError = (code) => (error) => (
  error?.code === code
  && typeof error.message === 'string' && error.message.length > 0
  && typeof error.hint === 'string' && error.hint.length > 0
  && typeof error.retriable === 'boolean'
);
const nativeYouTubePayload = (jobId) => ({
  jobId,
  sourceLanguage: 'en',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
});

assert.ok(BSE.NativeHost, 'BSE.NativeHost must expose the Native Messaging client');
assert.ok(Object.isFrozen(BSE.NativeHost), 'BSE.NativeHost must be immutable');

resetNativeHost();
const capabilitiesPromise = BSE.NativeHost.getCapabilities();
const capabilitiesPort = nativeTestPort();
assert.equal(capabilitiesPort.name, 'com.sparksub.transcriber');
assert.deepEqual(capabilitiesPort.postedMessages[0], {
  type: 'capabilities',
  requestId: capabilitiesPort.postedMessages[0].requestId,
  protocolVersion: 1
});
capabilitiesPort.emitMessage({
  type: 'response',
  requestId: capabilitiesPort.postedMessages[0].requestId,
  ok: true,
  result: { hostReady: true }
});
assert.deepEqual(await capabilitiesPromise, { hostReady: true });
assert.deepEqual(await BSE.NativeHost.getCapabilities(), { hostReady: true }, 'capabilities must use the cached result by default');
assert.equal(capabilitiesPort.postedMessages.length, 1, 'cached capabilities must not send another request');
const refreshedCapabilities = BSE.NativeHost.getCapabilities({ force: true });
assert.equal(capabilitiesPort.postedMessages.length, 2, 'force must bypass the capabilities cache');
capabilitiesPort.emitMessage({
  type: 'response',
  requestId: capabilitiesPort.postedMessages[1].requestId,
  ok: true,
  result: { hostReady: false }
});
assert.deepEqual(await refreshedCapabilities, { hostReady: false });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(capabilitiesPort.disconnected, true, 'an idle Native Messaging port must close so it does not keep the Service Worker and Swift host alive');
const portsBeforeCachedRead = nativePorts.length;
assert.deepEqual(await BSE.NativeHost.getCapabilities(), { hostReady: false }, 'idle disconnect must preserve the last capability snapshot');
assert.equal(nativePorts.length, portsBeforeCachedRead, 'reading cached capabilities after idle disconnect must not relaunch the native host');

resetNativeHost();
const firstCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const secondCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const concurrentPort = nativeTestPort();
const [firstRequest, secondRequest] = concurrentPort.postedMessages;
assert.notEqual(firstRequest.requestId, secondRequest.requestId, 'concurrent requests need distinct request IDs');
concurrentPort.emitMessage({ type: 'response', requestId: secondRequest.requestId, ok: true, result: { instance: 2 } });
concurrentPort.emitMessage({ type: 'response', requestId: firstRequest.requestId, ok: true, result: { instance: 1 } });
assert.deepEqual(await firstCapabilities, { instance: 1 });
assert.deepEqual(await secondCapabilities, { instance: 2 });

resetNativeHost();
const firstProgress = [];
const secondProgress = [];
const firstTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-first'), {
  onProgress: (event) => firstProgress.push(event)
});
const secondTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-second'), {
  onProgress: (event) => secondProgress.push(event)
});
const progressPort = nativeTestPort();
const [firstTranscribeRequest, secondTranscribeRequest] = progressPort.postedMessages;
progressPort.emitMessage({
  type: 'progress',
  requestId: secondTranscribeRequest.requestId,
  jobId: 'job-second',
  stage: 'transcribing',
  percent: 42,
  hint: 'Working'
});
assert.deepEqual(firstProgress, [], 'progress must not reach a different job callback');
assert.deepEqual(secondProgress, [{
  type: 'progress',
  requestId: secondTranscribeRequest.requestId,
  jobId: 'job-second',
  stage: 'transcribing',
  percent: 42,
  hint: 'Working'
}]);
for (const request of [firstTranscribeRequest, secondTranscribeRequest]) {
  const jobId = request.jobId;
  progressPort.emitMessage({ type: 'resultBegin', requestId: request.requestId, jobId, totalChunks: 1 });
  progressPort.emitMessage({ type: 'resultChunk', requestId: request.requestId, jobId, sequence: 0, totalChunks: 1, cues: [{ from: 0, to: 1, content: jobId }] });
  progressPort.emitMessage({ type: 'resultEnd', requestId: request.requestId, jobId, totalChunks: 1, cueCount: 1 });
}
await firstTranscription;
await secondTranscription;

resetNativeHost();
const assembledResult = BSE.NativeHost.transcribe(nativeYouTubePayload('job-ordered'));
const assemblyPort = nativeTestPort();
const assemblyRequest = assemblyPort.postedMessages[0];
assemblyPort.emitMessage({ type: 'resultBegin', requestId: assemblyRequest.requestId, jobId: 'job-ordered', totalChunks: 2 });
assemblyPort.emitMessage({ type: 'resultChunk', requestId: assemblyRequest.requestId, jobId: 'job-ordered', sequence: 1, totalChunks: 2, cues: [{ from: 2, to: 3, content: 'second' }] });
assemblyPort.emitMessage({ type: 'resultChunk', requestId: assemblyRequest.requestId, jobId: 'job-ordered', sequence: 0, totalChunks: 2, cues: [{ from: 0, to: 1, content: 'first' }] });
assemblyPort.emitMessage({ type: 'resultEnd', requestId: assemblyRequest.requestId, jobId: 'job-ordered', totalChunks: 2, cueCount: 2 });
assert.deepEqual(structuredClone(await assembledResult), [
  { from: 0, to: 1, content: 'first' },
  { from: 2, to: 3, content: 'second' }
]);

resetNativeHost();
const backgroundCaptionResult = BSE.NativeHost.fetchYouTubeCaptions({
  jobId: 'job-youtube-captions',
  sourceLanguage: 'yue',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
});
const backgroundCaptionPort = nativeTestPort();
const backgroundCaptionRequest = backgroundCaptionPort.postedMessages[0];
assert.deepEqual(backgroundCaptionRequest, {
  type: 'youtubeCaptions',
  requestId: backgroundCaptionRequest.requestId,
  protocolVersion: 1,
  jobId: 'job-youtube-captions',
  sourceLanguage: 'yue',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
});
backgroundCaptionPort.emitMessage({
  type: 'resultBegin', requestId: backgroundCaptionRequest.requestId, jobId: 'job-youtube-captions', totalChunks: 1,
  engine: 'youtube', language: 'yue', langDoc: '粵語（自動產生）', captionKind: 'auto'
});
backgroundCaptionPort.emitMessage({
  type: 'resultChunk', requestId: backgroundCaptionRequest.requestId, jobId: 'job-youtube-captions', sequence: 0, totalChunks: 1,
  cues: [{ from: 0, to: 1, content: '原生粵語字幕。' }]
});
backgroundCaptionPort.emitMessage({
  type: 'resultEnd', requestId: backgroundCaptionRequest.requestId, jobId: 'job-youtube-captions', totalChunks: 1, cueCount: 1
});
assert.deepEqual(structuredClone(await backgroundCaptionResult), {
  cues: [{ from: 0, to: 1, content: '原生粵語字幕。' }],
  language: 'yue',
  langDoc: '粵語（自動產生）',
  kind: 'auto'
});

resetNativeHost();
const captionAbortController = new AbortController();
const abortedCaptionFetch = BSE.NativeHost.fetchYouTubeCaptions({
  jobId: 'job-caption-cancelled', sourceLanguage: 'yue',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
}, { signal: captionAbortController.signal });
const captionAbortPort = nativeTestPort();
captionAbortController.abort();
await Promise.resolve();
assert.equal(captionAbortPort.postedMessages.filter((message) => (
  message.type === 'cancel' && message.jobId === 'job-caption-cancelled'
)).length, 1, 'aborting a background caption fetch must emit exactly one native cancel request');
await assert.rejects(abortedCaptionFetch, expectNativeError('CANCELLED'));
captionAbortPort.emitDisconnect('Native host stopped unexpectedly');

resetNativeHost();
const invalidCaptionMetadataResult = BSE.NativeHost.fetchYouTubeCaptions({
  jobId: 'job-bad-caption-metadata', sourceLanguage: 'yue',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
});
const invalidCaptionMetadataPort = nativeTestPort();
const invalidCaptionMetadataRequest = invalidCaptionMetadataPort.postedMessages[0];
invalidCaptionMetadataPort.emitMessage({
  type: 'resultBegin', requestId: invalidCaptionMetadataRequest.requestId, jobId: 'job-bad-caption-metadata', totalChunks: 1,
  engine: 'youtube', language: '', langDoc: 'bad', captionKind: 'unknown'
});
await assert.rejects(invalidCaptionMetadataResult, expectNativeError('RESULT_INCOMPLETE'), 'caption result metadata must be complete and from the fixed vocabulary');

resetNativeHost();
const incompleteResult = BSE.NativeHost.transcribe(nativeYouTubePayload('job-incomplete'));
const incompletePort = nativeTestPort();
const incompleteRequest = incompletePort.postedMessages[0];
incompletePort.emitMessage({ type: 'resultBegin', requestId: incompleteRequest.requestId, jobId: 'job-incomplete', totalChunks: 2 });
incompletePort.emitMessage({ type: 'resultChunk', requestId: incompleteRequest.requestId, jobId: 'job-incomplete', sequence: 0, totalChunks: 2, cues: [{ from: 0, to: 1, content: 'only chunk' }] });
incompletePort.emitMessage({ type: 'resultEnd', requestId: incompleteRequest.requestId, jobId: 'job-incomplete', totalChunks: 2, cueCount: 1 });
await assert.rejects(incompleteResult, expectNativeError('RESULT_INCOMPLETE'));

resetNativeHost();
const mismatchedCueCountResult = BSE.NativeHost.transcribe(nativeYouTubePayload('job-cue-count-mismatch'));
const mismatchedCueCountPort = nativeTestPort();
const mismatchedCueCountRequest = mismatchedCueCountPort.postedMessages[0];
mismatchedCueCountPort.emitMessage({ type: 'resultBegin', requestId: mismatchedCueCountRequest.requestId, jobId: 'job-cue-count-mismatch', totalChunks: 1 });
mismatchedCueCountPort.emitMessage({ type: 'resultChunk', requestId: mismatchedCueCountRequest.requestId, jobId: 'job-cue-count-mismatch', sequence: 0, totalChunks: 1, cues: [{ from: 0, to: 1, content: 'one cue' }] });
mismatchedCueCountPort.emitMessage({ type: 'resultEnd', requestId: mismatchedCueCountRequest.requestId, jobId: 'job-cue-count-mismatch', totalChunks: 1, cueCount: 2 });
await assert.rejects(mismatchedCueCountResult, expectNativeError('RESULT_INCOMPLETE'), 'resultEnd cueCount must match assembled cues');

resetNativeHost();
const mismatchedChunkCountResult = BSE.NativeHost.transcribe(nativeYouTubePayload('job-chunk-count-mismatch'));
const mismatchedChunkCountPort = nativeTestPort();
const mismatchedChunkCountRequest = mismatchedChunkCountPort.postedMessages[0];
mismatchedChunkCountPort.emitMessage({ type: 'resultBegin', requestId: mismatchedChunkCountRequest.requestId, jobId: 'job-chunk-count-mismatch', totalChunks: 1 });
mismatchedChunkCountPort.emitMessage({ type: 'resultChunk', requestId: mismatchedChunkCountRequest.requestId, jobId: 'job-chunk-count-mismatch', sequence: 0, totalChunks: 2, cues: [{ from: 0, to: 1, content: 'wrong envelope count' }] });
await assert.rejects(mismatchedChunkCountResult, expectNativeError('RESULT_INCOMPLETE'), 'each resultChunk must repeat the resultBegin totalChunks value');

resetNativeHost();
const disconnectedCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const disconnectedTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-disconnected'));
nativeTestPort().emitDisconnect('Native host stopped unexpectedly');
await assert.rejects(disconnectedCapabilities, expectNormalizedNativeError('NATIVE_HOST_DISCONNECTED'));
await assert.rejects(disconnectedTranscription, expectNormalizedNativeError('NATIVE_HOST_DISCONNECTED'));

resetNativeHost();
const missingHostCapabilities = BSE.NativeHost.getCapabilities({ force: true });
nativeTestPort().emitDisconnect('Specified native messaging host not found.');
await assert.rejects(missingHostCapabilities, expectNormalizedNativeError('NATIVE_HOST_NOT_INSTALLED'));

resetNativeHost();
const locallyDisconnectedCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const localDisconnectPort = nativeTestPort();
BSE.NativeHost.disconnect();
const localDisconnectOutcome = await Promise.race([
  locallyDisconnectedCapabilities.then(
    () => 'resolved',
    (error) => error.code
  ),
  new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25))
]);
assert.equal(localDisconnectPort.disconnected, true, 'client.disconnect must call the Chrome Port disconnect method');
assert.equal(localDisconnectOutcome, 'NATIVE_HOST_DISCONNECTED', 'client.disconnect must settle pending work without an onDisconnect callback');

resetNativeHost();
const abortController = new AbortController();
const abortedTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-cancelled'), { signal: abortController.signal });
const abortPort = nativeTestPort();
abortController.abort();
await Promise.resolve();
assert.ok(abortPort.postedMessages.some((message) => (
  message.type === 'cancel' && message.jobId === 'job-cancelled' && message.protocolVersion === 1
)), 'aborting a transcription must send a cancel request');
assert.equal(abortPort.postedMessages.filter((message) => (
  message.type === 'cancel' && message.jobId === 'job-cancelled'
)).length, 1, 'aborting one transcription must emit exactly one native cancel request');
await assert.rejects(abortedTranscription, expectNativeError('CANCELLED'));
abortPort.emitDisconnect('Native host stopped unexpectedly');

resetNativeHost();
const oversizedResponse = BSE.NativeHost.getCapabilities({ force: true });
const oversizedPort = nativeTestPort();
const oversizedRequest = oversizedPort.postedMessages[0];
oversizedPort.emitMessage({
  type: 'response',
  requestId: oversizedRequest.requestId,
  ok: true,
  result: { data: 'x'.repeat(901 * 1024) }
});
await assert.rejects(oversizedResponse, expectNativeError('PROTOCOL_MESSAGE_TOO_LARGE'));
resetNativeHost();

resetNativeHost();
const boundarySizedResponse = BSE.NativeHost.getCapabilities({ force: true });
const boundarySizedPort = nativeTestPort();
const boundarySizedRequest = boundarySizedPort.postedMessages[0];
const boundaryMessage = {
  type: 'response',
  requestId: boundarySizedRequest.requestId,
  ok: true,
  result: { data: '' }
};
const boundaryBaseSize = new TextEncoder().encode(JSON.stringify(boundaryMessage)).byteLength;
boundaryMessage.result.data = 'x'.repeat((900 * 1024) - boundaryBaseSize);
assert.equal(new TextEncoder().encode(JSON.stringify(boundaryMessage)).byteLength, 900 * 1024, 'boundary fixture must be exactly 900 KiB');
boundarySizedPort.emitMessage(boundaryMessage);
await assert.rejects(boundarySizedResponse, expectNativeError('PROTOCOL_MESSAGE_TOO_LARGE'), 'native host messages must remain strictly below 900 KiB');
resetNativeHost();

resetNativeHost();
const hostReportedError = BSE.NativeHost.getCapabilities({ force: true });
const hostReportedErrorPort = nativeTestPort();
const hostReportedErrorRequest = hostReportedErrorPort.postedMessages[0];
hostReportedErrorPort.emitMessage({
  type: 'response',
  requestId: hostReportedErrorRequest.requestId,
  ok: false,
  error: { code: 'MEDIA_DOWNLOAD_FAILED', message: 'Download failed', hint: 'Check the source URL.', retriable: true }
});
await assert.rejects(hostReportedError, (error) => (
  error?.code === 'MEDIA_DOWNLOAD_FAILED'
  && error.message === 'Download failed'
  && error.hint === 'Check the source URL.'
  && error.retriable === true
));

for (const [label, payload] of [
  ['unknown top-level field', { ...nativeYouTubePayload('job-top-level'), cookies: 'session=secret' }],
  ['unknown source field', { ...nativeYouTubePayload('job-source-field'), source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY', bytes: new Uint8Array([1]) } }],
  ['cookie header', { jobId: 'job-cookie-header', sourceLanguage: 'en', source: { kind: 'remote', url: 'https://media.example/audio', headers: { Cookie: 'session=secret' } } }],
  ['authorization header', { jobId: 'job-authorization-header', sourceLanguage: 'en', source: { kind: 'remote', url: 'https://media.example/audio', headers: { Authorization: 'Bearer secret' } } }],
  ['non-finite duration', { ...nativeYouTubePayload('job-duration'), duration: Infinity }]
]) {
  resetNativeHost();
  await assert.rejects(BSE.NativeHost.transcribe(payload), expectNormalizedNativeError('INVALID_REQUEST'), `transcribe must reject ${label}`);
  assert.equal(nativePorts.length, 0, `transcribe must not connect for ${label}`);
}

resetNativeHost();
await assert.rejects(BSE.NativeHost.cancel(''), expectNormalizedNativeError('INVALID_REQUEST'));
assert.equal(nativePorts.length, 0, 'cancel must not connect without a job ID');
const cancelRequest = BSE.NativeHost.cancel('job-cancel-only');
const cancelRequestPort = nativeTestPort();
assert.deepEqual(cancelRequestPort.postedMessages[0], {
  type: 'cancel',
  requestId: cancelRequestPort.postedMessages[0].requestId,
  protocolVersion: 1,
  jobId: 'job-cancel-only'
});
cancelRequestPort.emitMessage({ type: 'response', requestId: cancelRequestPort.postedMessages[0].requestId, ok: true, result: { cancelled: true } });
await cancelRequest;

const invalidCues = [
  {},
  { from: NaN, to: 1, content: 'NaN start' },
  { from: 0, to: Infinity, content: 'Infinite end' },
  { from: 1, to: 1, content: 'No duration' },
  { from: 0, to: 1, content: '   ' }
];
for (const [index, cue] of invalidCues.entries()) {
  resetNativeHost();
  const invalidCueResult = BSE.NativeHost.transcribe(nativeYouTubePayload(`job-invalid-cue-${index}`));
  const invalidCuePort = nativeTestPort();
  const invalidCueRequest = invalidCuePort.postedMessages[0];
  invalidCuePort.emitMessage({ type: 'resultBegin', requestId: invalidCueRequest.requestId, jobId: invalidCueRequest.jobId, totalChunks: 1 });
  invalidCuePort.emitMessage({ type: 'resultChunk', requestId: invalidCueRequest.requestId, jobId: invalidCueRequest.jobId, sequence: 0, totalChunks: 1, cues: [cue] });
  await assert.rejects(invalidCueResult, expectNormalizedNativeError('RESULT_INCOMPLETE'), 'invalid cues must reject the complete result');
}

resetNativeHost();
const originalNativeSetTimeout = context.setTimeout;
const originalNativeClearTimeout = context.clearTimeout;
const nativeTimerCallbacks = new Map();
let nativeTimerId = 0;
context.setTimeout = (callback, delay) => {
  const timerId = ++nativeTimerId;
  nativeTimerCallbacks.set(timerId, { callback, delay });
  return timerId;
};
context.clearTimeout = (timerId) => nativeTimerCallbacks.delete(timerId);
const assertOnlyIdleNativeTimer = (message) => {
  assert.equal(nativeTimerCallbacks.size, 1, message);
  assert.equal(nativeTimerCallbacks.values().next().value.delay, 250, 'the remaining timer must be the short idle-port disconnect');
};

const timedOutCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const timeoutPort = nativeTestPort();
assert.equal(nativeTimerCallbacks.size, 1, 'a request must register one timeout');
const shortRequestTimer = nativeTimerCallbacks.values().next().value;
assert.ok(shortRequestTimer.delay < 5 * 60 * 1000, 'short native requests need a bounded timeout below the old transcription limit');
shortRequestTimer.callback();
await assert.rejects(timedOutCapabilities, expectNormalizedNativeError('NATIVE_HOST_TIMEOUT'));
assertOnlyIdleNativeTimer('settling a timed out request must replace its request timeout with one idle disconnect');
assert.equal(timeoutPort.postedMessages.some((message) => message.type === 'cancel'), false, 'short request timeout must not post a job cancel');
timeoutPort.emitMessage({ type: 'response', requestId: timeoutPort.postedMessages[0].requestId, ok: true, result: { ignored: true } });

resetNativeHost();
let longTranscriptionSettled = false;
const longTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-watchdog'));
longTranscription.then(
  () => { longTranscriptionSettled = true; },
  () => { longTranscriptionSettled = true; }
);
const watchdogPort = nativeTestPort();
const watchdogRequest = watchdogPort.postedMessages[0];
assert.equal(nativeTimerCallbacks.size, 1, 'transcription must register one inactivity watchdog');
const initialWatchdogEntry = [...nativeTimerCallbacks.entries()][0];
assert.ok(initialWatchdogEntry[1].delay > 5 * 60 * 1000, 'silent model cold start must have more than the old five-minute allowance');

watchdogPort.emitMessage({
  type: 'progress',
  requestId: watchdogRequest.requestId,
  jobId: 'job-watchdog',
  stage: 'transcribing',
  percent: 70,
  hint: 'Model heartbeat'
});
assert.equal(nativeTimerCallbacks.has(initialWatchdogEntry[0]), false, 'progress must replace the previous inactivity timer');
assert.equal(nativeTimerCallbacks.size, 1, 'progress refresh must leave exactly one active timer');
const progressWatchdogEntry = [...nativeTimerCallbacks.entries()][0];
assert.notEqual(progressWatchdogEntry[0], initialWatchdogEntry[0]);
initialWatchdogEntry[1].callback();
await Promise.resolve();
assert.equal(longTranscriptionSettled, false, 'a cleared stale timer callback must not reject active transcription');
assert.equal(watchdogPort.postedMessages.some((message) => message.type === 'cancel'), false, 'a stale timer must not post cancel');

watchdogPort.emitMessage({
  type: 'resultBegin', requestId: watchdogRequest.requestId, jobId: 'job-watchdog', totalChunks: 1
});
const beginWatchdogEntry = [...nativeTimerCallbacks.entries()][0];
assert.notEqual(beginWatchdogEntry[0], progressWatchdogEntry[0], 'resultBegin must refresh inactivity watchdog');
watchdogPort.emitMessage({
  type: 'resultChunk', requestId: watchdogRequest.requestId, jobId: 'job-watchdog', sequence: 0, totalChunks: 1,
  cues: [{ from: 0, to: 2, content: 'watchdog result' }]
});
const chunkWatchdogEntry = [...nativeTimerCallbacks.entries()][0];
assert.notEqual(chunkWatchdogEntry[0], beginWatchdogEntry[0], 'resultChunk must refresh inactivity watchdog');
watchdogPort.emitMessage({
  type: 'resultEnd', requestId: watchdogRequest.requestId, jobId: 'job-watchdog', totalChunks: 1, cueCount: 1
});
assert.deepEqual(structuredClone(await longTranscription), [{ from: 0, to: 2, content: 'watchdog result' }]);
assertOnlyIdleNativeTimer('successful settlement must replace its inactivity watchdog with one idle disconnect');

resetNativeHost();
const inactiveTranscription = BSE.NativeHost.transcribe(nativeYouTubePayload('job-inactive'));
const inactivePort = nativeTestPort();
const inactivityTimer = nativeTimerCallbacks.values().next().value;
inactivityTimer.callback();
await assert.rejects(inactiveTranscription, expectNormalizedNativeError('NATIVE_HOST_TIMEOUT'));
const timeoutCancels = inactivePort.postedMessages.filter((message) => message.type === 'cancel');
assert.equal(timeoutCancels.length, 1, 'true transcription inactivity timeout must post one best-effort cancel');
assert.equal(timeoutCancels[0].jobId, 'job-inactive');
assert.equal(timeoutCancels[0].protocolVersion, 1);
assertOnlyIdleNativeTimer('timed out transcription must clear its watchdog without adding a tracked cancel timer');

context.setTimeout = originalNativeSetTimeout;
context.clearTimeout = originalNativeClearTimeout;
resetNativeHost();

// 1. I18n Tests
assert.equal(BSE.I18n.t('follow'), '跟随');
BSE.I18n.setLocale('en');
assert.equal(BSE.I18n.t('follow'), 'Follow');
assert.equal(BSE.I18n.t('ai_prompt_summary'), 'Core Essence & Logic');
assert.equal(BSE.I18n.t('tab_tracker'), 'Tracker Center');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), 'All (4)');
BSE.I18n.setLocale('zh-TW');
assert.equal(BSE.I18n.t('tab_tracker'), '追蹤更新');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), '全部 (4)');
BSE.I18n.setLocale('zh-CN');
assert.equal(BSE.I18n.t('tab_tracker'), '追踪更新');
assert.equal(BSE.I18n.formatTimeSpan(159), '2分39秒');

// 1.1 Symmetrical Dictionary Key Verification
const zhCnKeys = Object.keys(BSE.DICTIONARIES['zh-CN']).sort();
const enKeys = Object.keys(BSE.DICTIONARIES['en']).sort();
const zhTwKeys = Object.keys(BSE.DICTIONARIES['zh-TW']).sort();
assert.deepEqual(zhCnKeys, enKeys, 'zh-CN 与 en 词典键集必须完全一致');
assert.deepEqual(zhCnKeys, zhTwKeys, 'zh-CN 与 zh-TW 词典键集必须完全一致');
assert.ok(zhCnKeys.some((k) => k.startsWith('tracker_')), '词典中必须包含追踪中心翻译键');

// 2. Parser Tests
const json3 = JSON.stringify({
  events: [
    { tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: '第一句' }] },
    { tStartMs: 2500, dDurationMs: 1200, segs: [{ utf8: '第二' }, { utf8: '句' }] }
  ]
});
const jsonCues = BSE.Parsers.parseJson3(json3);
assert.equal(jsonCues.length, 2);
assert.equal(jsonCues[1].content, '第二句');
assert.equal(jsonCues[0].from, 1);
assert.equal(jsonCues[0].to, 2.5);

const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello world\n\n00:00:03.000 --> 00:00:04.000\nNext line\n';
const vttCues = BSE.Parsers.parseVtt(vtt);
assert.equal(vttCues.length, 2);
assert.equal(vttCues[0].content, 'Hello world');

const duplicateCues = BSE.Parsers.normalize([
  { from: 1, to: 2, content: 'Each level will become more difficult.' },
  { from: 1, to: 2.5, content: 'Each level will become more difficult.' },
  { from: 2.5, to: 4, content: 'The vocabulary will become more' },
  { from: 2.5, to: 4, content: 'The vocabulary will become more' }
]);
assert.equal(duplicateCues.length, 2, '连续重复字幕必须被自动去重');
assert.equal(duplicateCues[0].to, 2.5, '重复字幕时间跨度应合并');

// 3. AI Prompts Tests
const aiSummaryPrompt = BSE.Formatters.generateAiPrompt('summary', jsonCues, false);
assert.match(aiSummaryPrompt, /核心内容摘要|核心主旨/);
assert.match(aiSummaryPrompt, /第一句 第二句/);

const aiNotesPrompt = BSE.Formatters.generateAiPrompt('notes', jsonCues, true);
assert.match(aiNotesPrompt, /高质量专业讲义|结构严谨/);
assert.match(aiNotesPrompt, /\[00:01\] 第一句/);

// 4. Merged Markdown Tests
const mockTree = {
  title: '测试课程合集',
  kind: 'ugc_season',
  sections: [
    {
      title: '第一章 基础入门',
      episodes: [
        {
          title: '01 课程介绍',
          items: [{ globalIndex: 1, title: '01 课程介绍' }]
        }
      ]
    }
  ]
};
const mockResults = new Map();
mockResults.set(1, {
  status: 'success',
  item: { globalIndex: 1, title: '01 课程介绍', sectionKey: 'sec_0', sectionTitle: '第一章 基础入门', sourceUrl: 'https://www.bilibili.com/video/BV1xx' },
  body: jsonCues,
  track: { lan_doc: '中文' }
});
const mergedMd = BSE.Formatters.toMergedMarkdown(mockTree, mockResults, { success: 1, total: 1 });
assert.match(mergedMd, /# 测试课程合集/);
assert.match(mergedMd, /\[TOC\]/);
assert.match(mergedMd, /第一章 基础入门/);
assert.match(mergedMd, /01 课程介绍/);

// 5. JSZip Tests
const zip = new BSE.JSZip();
zip.file('test.txt', 'Hello Subtitle Extension');
const folder = zip.folder('episodes');
folder.file('01.srt', BSE.Formatters.toSrt(jsonCues));
const blob = await zip.generateAsync({ type: 'blob' });
assert.ok(blob, 'JSZip 应当成功生成压缩包 Blob');
assert.ok(blob.size > 100, 'JSZip 生成的 Blob 大小应当有效');

// 6. Time & Clock
assert.equal(BSE.Utils.findActiveCueIndex(jsonCues, 1.2), 0);
assert.equal(BSE.Utils.findActiveCueIndex(jsonCues, 2.6), 1);
assert.equal(BSE.Utils.findActiveCueIndex(jsonCues, 10), -1);
assert.match(BSE.Formatters.toSrt(jsonCues), /00:00:01,000 --> 00:00:02,500/);
assert.match(BSE.Formatters.toTxt(jsonCues), /第一句/);

// Session snapshots are bounded and must not retain signed subtitle URLs.
BSE.Utils.SessionSnapshotManager.saveSnapshot('yt:cache-test', {
  title: '缓存测试',
  tracks: [{ id: 'zh', lan: 'zh-CN', lanDoc: '中文', subtitleUrl: 'https://signed.example/token=secret' }],
  selectedTrackId: 'zh',
  cues: jsonCues
});
const cachedSnapshot = BSE.Utils.SessionSnapshotManager.findSnapshot('yt:cache-test');
assert.equal(cachedSnapshot.tracks[0].lan, 'zh-CN', '会话快照必须保留实际语言字段');
assert.equal('subtitleUrl' in cachedSnapshot.tracks[0], false, '会话快照不得持久化带签名的字幕 URL');
const oversizedCues = [{ from: 0, to: 1, content: 'x'.repeat(2 * 1024 * 1024) }];
BSE.Utils.SessionSnapshotManager.saveSnapshot('yt:oversized', { tracks: [], cues: oversizedCues });
assert.equal(BSE.Utils.SessionSnapshotManager.findSnapshot('yt:oversized'), null, '超大字幕不得写满 sessionStorage');

// 7. Manifest & File Integrity
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.2.0');

const referencedFiles = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap((entry) => entry.js || [])
];
for (const file of referencedFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `清单引用的文件不存在：${file}`);
}

const html = fs.readFileSync(path.join(root, manifest.side_panel.default_path), 'utf8');
for (const source of [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1])) {
  assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, manifest.side_panel.default_path)), source)), `侧边栏脚本不存在：${source}`);
}
for (const source of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1])) {
  assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, manifest.side_panel.default_path)), source)), `侧边栏样式不存在：${source}`);
}

const extensionSource = fs.readdirSync(root, { recursive: true })
  .filter((file) => String(file).endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');
assert.doesNotMatch(extensionSource, /(?:window|globalThis|pageWindow)\.fetch\s*=/, '扩展不应替换页面全局 fetch');
assert.match(extensionSource, /touchstart[\s\S]{0,120}passive:\s*true/, '触摸滚动监听应使用被动模式');

const contentAppSource = fs.readFileSync(path.join(root, 'content/app.js'), 'utf8');
const sidepanelSource = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.js'), 'utf8');
const rollingPanelSyncSource = fs.readFileSync(path.join(root, 'content/rolling-panel.js'), 'utf8');
const trackerSyncSource = fs.readFileSync(path.join(root, 'core/tracker.js'), 'utf8');
assert.match(contentAppSource, /if \(index !== lastPlaybackIndex\)[\s\S]{0,240}BSE_PLAYBACK_UPDATE/, '跨进程播放同步必须仅在当前句变化时发布');
assert.match(contentAppSource, /ad-showing[\s\S]{0,160}return/, 'YouTube 广告时必须暂停正片字幕时间轴同步');
assert.match(contentAppSource, /state\.cueRevision \+= 1/, '新字幕正文提交时必须提高正文版本');
assert.match(sidepanelSource, /currentKey[^\n]+cueRevision/, '侧边栏 DOM 缓存键必须识别同数量字幕刷新');
assert.match(rollingPanelSyncSource, /cueRenderKey[^\n]+cueRevision/, '滚动面板 DOM 缓存键必须识别同数量字幕刷新');
assert.doesNotMatch(sidepanelSource, /AUTO_RESUME_DELAY|autoResumeTimer/, '侧边栏不得在用户阅读时自动抢回跟随');
assert.doesNotMatch(rollingPanelSyncSource, /autoResumeDelay|autoResumeTimer/, '滚动面板不得在用户阅读时自动抢回跟随');
assert.match(trackerSyncSource, /if \(checkAllUpdatesPromise\) return checkAllUpdatesPromise/, '追踪中心的手动与定时巡检必须共用进行中任务');
assert.match(trackerSyncSource, /updatedSubs\.push\(\{[\s\S]{0,160}title: sub\.title/, '追踪更新结果必须为通知提供订阅源标题');

const backgroundSource = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
const bilibiliSource = fs.readFileSync(path.join(root, 'platform/bilibili.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'content/app.js'), 'utf8');
const rollingPanelSource = fs.readFileSync(path.join(root, 'content/rolling-panel.js'), 'utf8');
const sidePanelCss = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.css'), 'utf8');
const sidePanelSource = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.js'), 'utf8');

assert.match(backgroundSource, /BSE_FETCH_BILIBILI_RESOURCE/, '后台必须提供哔哩哔资源读取通道');
assert.match(backgroundSource, /HOST_NOT_ALLOWED/, '后台代理必须拒绝非白名单域名');
assert.match(backgroundSource, /INVALID_SENDER/, '后台代理必须验证请求页面来源');
assert.match(backgroundSource, /sender\.id\s*!==\s*chrome\.runtime\.id/, '后台代理必须拒绝非本扩展消息来源');
assert.match(backgroundSource, /sender\.url\.startsWith\(extensionRoot\)/, '后台代理仅应信任本扩展拥有的无标签页页面');
assert.doesNotMatch(backgroundSource, /parsed\.hostname\.endsWith\('bilibili\.com'\)/, '发送者域名校验必须要求点分隔，不能信任 evilbilibili.com 一类后缀伪造域名');
assert.match(backgroundSource, /BSE_FETCH_YOUTUBE_RESOURCE[\s\S]+?fetchYouTubeResource\(message\.url, sender\)/, 'YouTube 字幕代理必须传递发送者用于来源校验');
assert.match(backgroundSource, /fetchYouTubeResource[\s\S]+?UNSAFE_REDIRECT[\s\S]+?BODY_TOO_LARGE/, 'YouTube 字幕代理必须限制重定向目标与响应体大小');
assert.match(backgroundSource, /BSE_DOWNLOAD_MEDIA_FILE[\s\S]+?isTrustedSender\(sender, 'bilibili'\)/, '媒体下载通道必须验证消息来源');
assert.match(bilibiliSource, /requestBackgroundJson\((?:track\.subtitleUrl|cleanUrl)/, '哔哩哔字幕正文必须走后台通道');
assert.match(appSource, /revision/, '状态必须携带单调版本号');
assert.match(appSource, /刷新失败，已保留现有字幕/, '刷新失败必须保留已成功字幕');
assert.match(rollingPanelSource, /ResizeObserver/, '滚动面板必须监听播放器尺寸变化');
assert.match(rollingPanelSource, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/, '滚动面板必须可靠隐藏旧状态 DOM');
assert.doesNotMatch(sidePanelSource, /targetId:\s*state\.authorInfo\?\.targetId\s*\|\|\s*videoId/, 'YouTube 视频 ID 不得冒充 Channel ID 创建无效订阅');
assert.doesNotMatch(sidePanelSource, /state\.authorInfo\?\.targetId\s*\|\|\s*bvid/, 'Bilibili BV 号不得冒充 MID 创建无效 UP 主订阅');
// 8. TypeScript & Typesystem Integrity (Scheme A)
assert.ok(fs.existsSync(path.join(root, 'types/bse.d.ts')), '必须提供核心类型定义 types/bse.d.ts');
assert.ok(fs.existsSync(path.join(root, 'types/chrome.d.ts')), '必须提供 Chrome API 声明 types/chrome.d.ts');
assert.ok(fs.existsSync(path.join(root, 'tsconfig.json')), '必须提供 tsconfig.json 配置文件');

const bseTypeContent = fs.readFileSync(path.join(root, 'types/bse.d.ts'), 'utf8');
assert.match(bseTypeContent, /interface Cue/, '类型声明应包含 Cue 接口');
assert.match(bseTypeContent, /interface SubtitleTrack/, '类型声明应包含 SubtitleTrack 接口');
assert.match(bseTypeContent, /interface AppState/, '类型声明应包含 AppState 接口');
assert.match(bseTypeContent, /interface BSENamespace/, '类型声明应包含 BSENamespace 命名空间');

const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
assert.equal(tsconfig.compilerOptions.allowJs, true, 'tsconfig 必须允许 JavaScript');
assert.equal(tsconfig.compilerOptions.checkJs, true, 'tsconfig 必须启用 checkJs 类型校验');
assert.equal(tsconfig.compilerOptions.noEmit, true, 'tsconfig 必须开启 noEmit 保持零构建负担');

// 9. Batch Modal & Custom Selection Tests
assert.equal(BSE.Utils.escapeHtml('<script>alert("xss")&\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;&lt;/script&gt;', 'escapeHtml 应当正确转义 HTML 关键字符');

const sidePanelHtml = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
assert.match(sidePanelHtml, /batch-tree-toolbar-actions/, '侧边栏批量弹窗应包含分P全选/清空/反选/仅当前工具栏');
assert.match(sidePanelHtml, /batch-quick-range-bar/, '批量弹窗应包含区间速选条');
assert.match(sidePanelHtml, /batch-settings-stacked/, '批量弹窗应使用多行纵向分栏配置抽屉而非拥挤单行');
assert.match(sidePanelHtml, /name="batch-output"/, '批量弹窗应包含打包形式单选组');
assert.match(sidePanelHtml, /name="batch-format"/, '批量弹窗应包含单文件格式单选组');
assert.match(sidePanelHtml, /id="pref-select"/, '全局设置抽屉应包含默认字幕偏好配置');
assert.match(sidePanelHtml, /id="tracker-search-input"/, '追踪中心应提供订阅搜索入口');
assert.match(sidePanelHtml, /id="tracker-sort-select"/, '追踪中心应提供订阅排序入口');
assert.match(sidePanelHtml, /id="tracker-status-line"[^>]+aria-live="polite"/, '追踪中心状态摘要应向辅助技术播报');
assert.match(sidePanelSource, /expandedTrackerCards/, '追踪卡片应支持展开历史更新而不只显示最新一条');
assert.match(sidePanelSource, /window\.confirm\([^)]*tracker_confirm_untrack/, '删除订阅前必须通过 i18n 进行明确确认');
assert.match(sidePanelSource, /item\.subtitle\?\.status === 'ready'/, '合并复制应只包含字幕已就绪的未读条目');

// 10. Batch Export Fault Tolerance & Markdown Fallbacks
const faultTree = {
  title: '容灾测试合集',
  sections: [
    { index: 1, title: '第一章', key: '01_第一章' }
  ]
};
const faultResults = [
  {
    status: 'success',
    item: { globalIndex: 1, sectionKey: '01_第一章', sectionTitle: '第一章', title: 'P1 正常分P', sourceUrl: 'https://bilibili.com/video/BV1?p=1' },
    track: { lan_doc: '中文（自动生成）' },
    body: [{ from: 0, to: 5, content: '你好世界' }]
  },
  {
    status: 'no_subtitle',
    item: { globalIndex: 2, sectionKey: '01_第一章', sectionTitle: '第一章', title: 'P2 无字幕分P', sourceUrl: 'https://bilibili.com/video/BV1?p=2' },
    reason: 'UP主未上传且未生成AI字幕'
  },
  {
    status: 'failed',
    item: { globalIndex: 3, sectionKey: '01_第一章', sectionTitle: '第一章', title: 'P3 接口异常分P', sourceUrl: 'https://bilibili.com/video/BV1?p=3' },
    reason: 'HTTP 412 风控拦截'
  }
];
const mergedOutput = BSE.Formatters.toMergedMarkdown(faultTree, faultResults, { total: 3, success: 1, noSub: 1, failed: 1 });
assert.match(mergedOutput, /001\. P1 正常分P/, '成功分P必须在 Markdown 中保留');
assert.match(mergedOutput, /002\. P2 无字幕分P[\s\S]+本集未提供字幕/, '无字幕分P必须在对应章节位置生成清晰状态说明');
// 12. Bilibili Special URLs & BPX Fast-Path Tests
assert.equal(
  BSE.Utils.getBvid('https://www.bilibili.com/festival/kaoyanshangfen?bvid=BV14cCGBpErw&spm_id_from=333.337.search-card.all.click'),
  'BV14cCGBpErw',
  'getBvid 必须成功从 Festival 活动专题页 Query 参数提取 BV 号'
);
assert.equal(
  BSE.Utils.getBvid('https://www.bilibili.com/blackboard/activity.html?bvid=BV1xx411c7mD'),
  'BV1xx411c7mD',
  'getBvid 必须成功从 Blackboard 专题页提取 BV 号'
);
assert.equal(
  BSE.Utils.getBvid('https://www.bilibili.com/list/watchlater?bvid=BV1Ab411c7eE'),
  'BV1Ab411c7eE',
  'getBvid 必须成功从稍后再看列表页提取 BV 号'
);
assert.equal(
  BSE.Utils.getBvid('https://www.bilibili.com/video/BV11S4y1a7wW?p=2'),
  'BV11S4y1a7wW',
  'getBvid 必须成功从标准视频页路径提取 BV 号'
);

// 13. Subscription Tracker Tests
assert.equal(
  BSE.Tracker.md5('hello'),
  '5d41402abc4b2a76b9719d911017c592',
  '轻量级 MD5 必须能够正确计算字符串哈希'
);
assert.equal(
  BSE.Tracker.md5('SparkSub'),
  '808ddc7c56201fa9aadbdae008a01e16',
  '轻量级 MD5 必须正确计算 SparkSub 哈希'
);

const wbiSigned = BSE.Tracker.calculateWbiSign(
  { mid: '123456', ps: 10 },
  'ea1db124c00f43a7ac988e404be0e5cd',
  '50529d8995a947709b1f7d9cc03328e1'
);
assert.ok(wbiSigned.query.includes('w_rid='), 'WBI 签名结果中必须包含 w_rid 参数');
assert.ok(wbiSigned.query.includes('wts='), 'WBI 签名结果中必须包含 wts 时间戳');

const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:dQw4w9WgXcQ</id>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Never Gonna Give You Up &amp; Dance</title>
    <published>2009-10-25T06:57:33+00:00</published>
    <author><name>Rick Astley</name></author>
  </entry>
  <entry>
    <yt:videoId>testVideo123</yt:videoId>
    <title>Test Video Title &lt;2&gt;</title>
    <published>2026-08-24T00:00:00+00:00</published>
    <author><name>Channel Name</name></author>
  </entry>
</feed>`;

const parsedRss = BSE.Tracker.parseYouTubeRssFeed(sampleRssXml);
assert.equal(parsedRss.length, 2, '免 DOM RSS 解析器必须成功提取全部 entry 节点');
assert.equal(parsedRss[0].id, 'dQw4w9WgXcQ', '第一条视频 videoId 提取必须准确');
assert.equal(parsedRss[0].title, 'Never Gonna Give You Up & Dance', 'XML 实体转义必须被正确还原');
assert.equal(parsedRss[0].author, 'Rick Astley', '作者名称提取必须准确');
assert.equal(parsedRss[1].id, 'testVideo123', '第二条视频 videoId 提取必须准确');
assert.equal(parsedRss[1].title, 'Test Video Title <2>', '尖括号转义必须被正确还原');

const cacheStats = BSE.Tracker.getStorageStats([{
  id: 'cache-policy', platform: 'bilibili', type: 'up', title: '容量测试', targetId: '1', unreadCount: 1,
  items: [{ id: 'large', title: '超大字幕', subtitle: { status: 'ready', fetchedAt: Date.now(), markdown: 'x'.repeat(800000), plainText: 'duplicate' } }]
}]);
assert.equal(cacheStats.evictedCount, 1, '超过单字幕上限的正文必须被缓存策略释放');
assert.ok(cacheStats.approximateBytes < 10000, '释放超大正文后只应保留轻量元数据');
const cappedStats = BSE.Tracker.getStorageStats(Array.from({ length: 105 }, (_, index) => ({
  id: `sub-${index}`, platform: 'youtube', type: 'channel', title: `频道 ${index}`, targetId: `UC${index}`, items: []
})));
assert.equal(cappedStats.subscriptionCount, 100, '订阅元数据必须设置全局数量上限');

const normalizedSettings = await BSE.Tracker.saveSettings({ checkIntervalMinutes: -10, enableNotification: false });
assert.equal(normalizedSettings.checkIntervalMinutes, 5, '自动巡检周期不得低于 5 分钟');
assert.equal(normalizedSettings.enableNotification, false, '布尔设置必须正确保存');
assert.ok(storageAreas.sync.has('bse_tracker_settings'), '小型追踪设置应存放在可同步存储而非字幕缓存区');

// Subscription polling must establish a baseline before reporting updates.
const youtubeSub = {
  id: 'youtube:channel:UC1234567890123456789012',
  platform: 'youtube',
  type: 'channel',
  title: '测试频道',
  targetId: 'UC1234567890123456789012',
  lastCheckedAt: 0,
  unreadCount: 0,
  items: []
};
mockFetch = async (url) => {
  assert.match(String(url), /feeds\/videos\.xml\?channel_id=UC1234567890123456789012/);
  return { ok: true, status: 200, text: async () => sampleRssXml };
};
const youtubeBaseline = await BSE.Tracker.checkSubscriptionUpdates(youtubeSub);
assert.equal(youtubeBaseline.initialized, true, 'YouTube 首次巡检必须建立基线');
assert.equal(youtubeSub.unreadCount, 0, 'YouTube RSS 中订阅前的历史视频不得计为未读');
assert.equal(youtubeSub.items.length, 2, 'YouTube 基线应缓存 RSS 历史条目');

const newYoutubeEntry = `<entry><yt:videoId>newVideo456</yt:videoId><title>New Upload</title><published>2026-08-25T00:00:00Z</published><author><name>Channel Name</name></author></entry>`;
mockFetch = async () => ({
  ok: true,
  status: 200,
  text: async () => sampleRssXml.replace('</feed>', `${newYoutubeEntry}</feed>`)
});
const youtubeUpdate = await BSE.Tracker.checkSubscriptionUpdates(youtubeSub);
assert.equal(youtubeUpdate.updated, true, 'YouTube 后续巡检必须识别新视频');
assert.deepEqual(Array.from(youtubeUpdate.newItems, (item) => item.id), ['newVideo456']);
assert.equal(youtubeSub.unreadCount, 1, 'YouTube 新视频必须准确增加未读数');

const handleSub = { ...youtubeSub, id: 'youtube:channel:testhandle', targetId: 'testhandle', items: [], lastCheckedAt: 0, unreadCount: 0 };
let handleResolved = false;
mockFetch = async (url) => {
  if (String(url).includes('/@testhandle')) {
    handleResolved = true;
    return { ok: true, status: 200, text: async () => '{"externalId":"UCabcdefghijklmnopqrstuv"}' };
  }
  assert.match(String(url), /channel_id=UCabcdefghijklmnopqrstuv/);
  return { ok: true, status: 200, text: async () => sampleRssXml };
};
await BSE.Tracker.checkSubscriptionUpdates(handleSub);
assert.equal(handleResolved, true, 'YouTube @handle 必须先解析为稳定 Channel ID');
assert.equal(handleSub.resolvedTargetId, 'UCabcdefghijklmnopqrstuv');

const bilibiliSub = {
  id: 'bilibili:up:12345',
  platform: 'bilibili',
  type: 'up',
  title: '测试 UP 主',
  targetId: '12345',
  lastCheckedAt: 0,
  unreadCount: 0,
  items: []
};
let bilibiliVideos = [{ bvid: 'BV1BASELINE1', title: '已有视频', created: 100, author: '测试 UP 主' }];
mockFetch = async (url) => {
  assert.match(String(url), /x\/space\/arc\/search/);
  return { ok: true, status: 200, json: async () => ({ code: 0, data: { list: { vlist: bilibiliVideos } } }) };
};
const bilibiliBaseline = await BSE.Tracker.checkSubscriptionUpdates(bilibiliSub);
assert.equal(bilibiliBaseline.initialized, true, 'Bilibili 首次巡检必须建立基线');
assert.equal(bilibiliSub.unreadCount, 0, 'Bilibili 订阅前的历史视频不得计为未读');
bilibiliVideos = [{ bvid: 'BV1NEWVIDEO1', title: '新投稿', created: 200, author: '测试 UP 主' }, ...bilibiliVideos];
const bilibiliUpdate = await BSE.Tracker.checkSubscriptionUpdates(bilibiliSub);
assert.equal(bilibiliUpdate.updated, true, 'Bilibili 后续巡检必须识别新投稿');
assert.deepEqual(Array.from(bilibiliUpdate.newItems, (item) => item.id), ['BV1NEWVIDEO1']);
assert.equal(bilibiliSub.unreadCount, 1, 'Bilibili 新投稿必须准确增加未读数');

// B站 UGC 合集拓扑追根与全量剧集提取巡检测试
const seasonSub = {
  id: 'bilibili:season:3092932',
  platform: 'bilibili',
  type: 'season',
  title: '视频合集',
  targetId: '3092932',
  bvid: 'BV1T1GA6pEvp',
  sourceUrl: 'https://www.bilibili.com/video/BV1T1GA6pEvp',
  lastCheckedAt: 0,
  unreadCount: 0,
  items: []
};
const ugcEpisodes = Array.from({ length: 25 }, (_, i) => ({
  bvid: `BV1EP${i + 1}`,
  title: `第${i + 1}讲：AI与深度学习`,
  arc: { pubdate: 1000 + i * 10, duration: 300 }
}));
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1T1GA6pEvp',
          title: '原视频',
          ugc_season: {
            id: 3092932,
            title: '人工智能与机器学习实战',
            sections: [{ title: '正片', episodes: ugcEpisodes }]
          }
        }
      })
    };
  }
  throw new Error(`unexpected url: ${url}`);
};
const seasonBaseline = await BSE.Tracker.checkSubscriptionUpdates(seasonSub);
assert.equal(seasonBaseline.initialized, true, 'UGC合集首次巡检必须成功建立基线');
assert.equal(seasonSub.items.length, 25, 'UGC合集必须完整提取全部 25 集而不被 20 截断');
assert.equal(seasonSub.title, '人工智能与机器学习实战', 'UGC合集巡检必须自动升级为精准真实合集标题');
assert.equal(seasonSub.latestBvid, 'BV1EP25', 'UGC合集最新集 BVID 必须正确更新');

await BSE.Tracker.addSubscription(seasonSub);
const reloadedSeason = await BSE.Tracker.getSubscription(seasonSub.id);
assert.equal(reloadedSeason.items.length, 25, '巡检建立基线后必须持久化到存储中');
assert.equal(reloadedSeason.title, '人工智能与机器学习实战', '巡检建立基线后标题必须持久化更新');
await BSE.Tracker.removeSubscription(seasonSub.id);

mockFetch = async () => { throw new Error('network unavailable'); };
const failedCheck = await BSE.Tracker.checkSubscriptionUpdates({ ...youtubeSub, targetId: 'UC1234567890123456789012' });
assert.equal(failedCheck.checked, false, '网络失败不得伪装成成功的无更新巡检');

await BSE.Tracker.addSubscription({
  id: 'youtube:channel:UC1234567890123456789012',
  platform: 'youtube',
  type: 'channel',
  title: '巡检持久化测试',
  targetId: 'UC1234567890123456789012'
});
mockFetch = async () => ({ ok: true, status: 200, text: async () => sampleRssXml });
const allCheck = await BSE.Tracker.checkAllUpdates();
assert.equal(allCheck.totalUnread, 0, '首次全量巡检不应制造历史未读');
const persistedBaseline = await BSE.Tracker.getSubscription('youtube:channel:UC1234567890123456789012');
assert.ok(persistedBaseline.lastCheckedAt > 0, '无新视频的成功巡检也必须持久化 lastCheckedAt');
assert.equal(persistedBaseline.items.length, 2, '全量巡检必须持久化首次基线');
await BSE.Tracker.removeSubscription('youtube:channel:UC1234567890123456789012');

assert.ok(manifest.permissions.includes('alarms'), 'manifest.json 必须申请 alarms 权限');
assert.ok(manifest.permissions.includes('notifications'), 'manifest.json 必须申请 notifications 权限');
assert.ok(fs.existsSync(path.join(root, 'core/tracker.js')), '必须存在 core/tracker.js 文件');

// 14. Configuration Import/Export JSON tests
const sampleImportJson = JSON.stringify({
  version: '0.2.0',
  exportedAt: new Date().toISOString(),
  settings: { checkIntervalMinutes: 30, enableNotification: true, enableBadge: true },
  subscriptions: [
    {
      id: 'bilibili:up:12345',
      platform: 'bilibili',
      type: 'up',
      title: '测试 UP 主',
      author: '测试 UP 主',
      targetId: '12345',
      items: [
        { id: 'BV1111', title: '第 1 个视频', url: 'https://bilibili.com/video/BV1111', pubdate: 1000 },
        { id: 'BV2222', title: '第 2 个视频', url: 'https://bilibili.com/video/BV2222', pubdate: 2000 }
      ],
      unreadCount: 2
    }
  ]
});

const imported = await BSE.Tracker.importConfigJson(sampleImportJson);
assert.equal(imported.importedCount, 1, '导入配置必须成功解析 1 个有效订阅源');

const renamedSub = await BSE.Tracker.renameSubscription('bilibili:up:12345', '自定义UP名称');
assert.equal(renamedSub?.title, '自定义UP名称', '订阅源重命名必须成功生效并持久化');

const exported = await BSE.Tracker.exportConfigJson();
const parsedExport = JSON.parse(exported);
assert.equal(parsedExport.version, '0.2.0', '导出的 JSON 必须包含 SparkSub 版本标识');
assert.equal(parsedExport.subscriptions[0].title, '自定义UP名称', '导出配置必须包含重命名后的新名称');
// 15. TrackedItem Subtitle & Merged Markdown export tests
const sampleTrackedItems = [
  {
    id: 'BV1AAA',
    title: '计算机网络第一讲',
    author: '王道考研',
    url: 'https://www.bilibili.com/video/BV1AAA',
    pubdate: Date.now() - 3600000,
    subtitle: {
      status: 'ready',
      language: 'zh-CN',
      langDoc: '中文',
      cueCount: 50,
      plainText: '大家好，今天我们来学习计算机网络体系结构。',
      markdown: '# 计算机网络第一讲\n\n- **来源作者**: 王道考研\n- **提取时间**: 2026/8/24\n\n---\n\n### [00:00 - 00:05]\n\n大家好，今天我们来学习计算机网络体系结构。'
    }
  },
  {
    id: 'BV1BBB',
    title: '操作系统第一讲',
    author: '王道考研',
    url: 'https://www.bilibili.com/video/BV1BBB',
    pubdate: Date.now(),
    subtitle: {
      status: 'ready',
      language: 'zh-CN',
      langDoc: '中文',
      cueCount: 40,
      plainText: '操作系统的基本概念与系统调用。',
      markdown: '# 操作系统第一讲\n\n- **来源作者**: 王道考研\n- **提取时间**: 2026/8/24\n\n---\n\n### [00:00 - 00:06]\n\n操作系统的基本概念与系统调用。'
    }
  }
];

BSE.I18n.setLocale('zh-CN');
const mergedDocZh = BSE.Tracker.exportMergedMarkdown(sampleTrackedItems);
assert.ok(typeof mergedDocZh === 'string' && mergedDocZh.length > 50, '合并导出的 Markdown 文档必须为非空字符串');
assert.match(mergedDocZh, /# 批量视频更新字幕汇总 \(2 篇\)/, '中文环境下必须输出中文标题');

BSE.I18n.setLocale('en');
const mergedDocEn = BSE.Tracker.exportMergedMarkdown(sampleTrackedItems);
assert.match(mergedDocEn, /# Batch Subtitle Summary \(2 items\)/, '英文环境下必须输出英文标题');
BSE.I18n.setLocale('zh-CN');
// 16. Bilibili runBatchExport execution & delay verification
const sampleTree = {
  title: '测试合集',
  currentBvid: 'BV1TEST',
  items: [
    { bvid: 'BV1TEST', cid: '12345', title: '测试分P 1', globalIndex: 1, sectionKey: 'sec1' },
    { bvid: 'BV1TEST', cid: '12346', title: '测试分P 2', globalIndex: 2, sectionKey: 'sec1' }
  ],
  sections: [
    { key: 'sec1', title: '第1章', episodes: [] }
  ]
};

let progressCount = 0;
const batchExportResult = await BSE.Bilibili.runBatchExport(sampleTree, {
  scope: 'all',
  preference: 'manual-first',
  formats: { srt: true, txt: true },
  outputMode: 'zip'
}, (stats, item, phase) => {
  progressCount++;
});

assert.equal(batchExportResult.stats.total, 2, '批量导出必须正确统计 2 个任务条目');
assert.equal(batchExportResult.stats.completed, 2, '批量导出必须在模拟环境下完成所有任务执行');
assert.ok(progressCount > 0, '批量导出必须持续触发进度回调');

// 17. Queue URL Normalization
const bvidNorm = BSE.Queue.normalizeVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=3');
assert.equal(bvidNorm?.platform, 'bilibili');
assert.equal(bvidNorm?.targetId, 'BV1xx411c7mD');
assert.equal(bvidNorm?.page, 3);
assert.equal(bvidNorm?.cleanUrl, 'https://www.bilibili.com/video/BV1xx411c7mD?p=3');

const ytNorm1 = BSE.Queue.normalizeVideoUrl('https://www.youtube.com/watch?v=-94Fizn6XcA&t=10s');
assert.equal(ytNorm1?.platform, 'youtube');
assert.equal(ytNorm1?.targetId, '-94Fizn6XcA');

const ytNorm2 = BSE.Queue.normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ');
assert.equal(ytNorm2?.platform, 'youtube');
assert.equal(ytNorm2?.targetId, 'dQw4w9WgXcQ');

const ytShortsNorm = BSE.Queue.normalizeVideoUrl('https://www.youtube.com/shorts/abcdefghijk');
assert.equal(ytShortsNorm?.platform, 'youtube');
assert.equal(ytShortsNorm?.targetId, 'abcdefghijk');

// 18. Queue Lifecycle, Stage-based Recovery & Merged Markdown
await BSE.Queue.clearAll();
const added = await BSE.Queue.addToQueue([
  'https://www.bilibili.com/video/BV1TEST111',
  'https://www.youtube.com/watch?v=TEST_YT_111'
], { title: '测试视频 1', author: '测试UP主' });

assert.equal(added.length, 2, '批量加入队列必须返回 2 个任务条目');
const queueList = await BSE.Queue.getQueue();
assert.equal(queueList.length, 2, '队列中必须持久化存储 2 个任务条目');
assert.equal(queueList[0].stage, 'queued');

// Simulate crashes in each resumable stage. A live execution lease must be left alone.
const staleAt = Date.now() - 10 * 60 * 1000;
const staleStages = ['resolving', 'fetching_caption', 'postprocessing'];
const recoveryFixtures = staleStages.map((stage, index) => ({
  ...queueList[index % queueList.length],
  id: `stale-${stage}`,
  stage,
  progress: 20 + index * 30,
  stageUpdatedAt: staleAt,
  executionLease: { owner: 'dead-worker', acquiredAt: staleAt, expiresAt: staleAt + 1000 }
}));
const liveJob = {
  ...queueList[0],
  id: 'live-fetching-caption',
  stage: 'fetching_caption',
  stageHint: '仍在下载字幕',
  stageUpdatedAt: Date.now(),
  executionLease: { owner: 'live-worker', acquiredAt: Date.now(), expiresAt: Date.now() + 60_000 }
};
await BSE.Queue.saveQueue([...recoveryFixtures, liveJob]);

const recovered = await BSE.Queue.recoverStaleJobs();
for (const originalStage of staleStages) {
  const item = recovered.find((candidate) => candidate.id === `stale-${originalStage}`);
  assert.equal(item.stage, 'queued', `${originalStage} 陈旧任务必须恢复到 queued`);
  assert.ok(item.stageHint?.includes(originalStage), '恢复提示必须保留被中断的原阶段');
}
assert.equal(recovered.find((item) => item.id === liveJob.id)?.stage, 'fetching_caption', '有效执行租约的任务不得被恢复器重置');

// Complete an item and verify export
recovered[0].stage = 'done';
recovered[0].subtitle = {
  language: 'zh-CN',
  langDoc: '中文',
  cueCount: 100,
  plainText: '测试转录文本第一句。测试转录文本第二句。',
  markdown: '### [00:00 - 00:05]\n\n测试转录文本第一句。测试转录文本第二句。'
};
await BSE.Queue.saveQueue(recovered);

const queueMd = await BSE.Queue.exportQueueMergedMarkdown();
assert.ok(queueMd.includes('# SparkSub 离线视频转录合集'), '导出队列 Markdown 必须包含主标题');
assert.ok(queueMd.includes('测试转录文本第一句'), '导出队列 Markdown 必须包含字幕内容');

// Persisted YouTube metadata and caption body are stage artifacts: resume must not request them again.
const cachedYoutubeItem = {
  id: 'cached-youtube',
  targetId: 'Ewd6CGwaEXY',
  platform: 'youtube',
  url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY',
  title: '缓存标题',
  author: '缓存作者',
  stage: 'queued',
  progress: 75,
  metaCache: {
    title: '缓存标题',
    author: '缓存作者',
    captionTracks: [{ baseUrl: 'https://must-not-fetch.invalid/caption', languageCode: 'zh-CN', name: { simpleText: '中文' } }]
  },
  stageArtifacts: {
    metadataResolved: true,
    captionText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '持久化字幕正文' }] }] }),
    captionTrackId: 'zh-cn:0:中文'
  }
};
await BSE.Queue.saveQueue([cachedYoutubeItem]);
let resumeFetchCount = 0;
mockFetch = async () => { resumeFetchCount++; throw new Error('续跑不应重复请求已有阶段产物'); };
await BSE.Queue.processYouTubeItem(cachedYoutubeItem, new AbortController().signal);
assert.equal(resumeFetchCount, 0, '已有 metaCache 和字幕正文阶段产物时不得重复发起网络请求');
assert.equal(cachedYoutubeItem.stage, 'done', '缓存阶段产物必须能够直接完成后处理');

// 20. Queue processPendingJobs end-to-end execution
await BSE.Queue.clearAll();
const testQueueItems = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1OFFLINETEST');
assert.equal(testQueueItems.length, 1);
assert.equal(testQueueItems[0].stage, 'queued');

// Mock Bilibili View & Subtitle APIs
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1OFFLINETEST',
          cid: 888999,
          title: '离线转录全自动化测试视频',
          pic: 'https://i0.hdslb.com/bfs/archive/test.jpg',
          owner: { name: '自动化测试UP主' },
          pages: [{ page: 1, cid: 888999, part: '正片' }]
        }
      })
    };
  }
  if (url.includes('x/web-interface/nav')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484a827105e933682852.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/492b161900b24a499386610d69174dd4.png' } } })
    };
  }
  if (url.includes('x/player/wbi/v2')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              { lan: 'zh-CN', lan_doc: '中文（简体）', subtitle_url: 'https://api.bilibili.com/x/player/wbi/sub.json' }
            ]
          }
        }
      })
    };
  }
  if (url.includes('sub.json')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        body: [
          { from: 0.5, to: 3.2, content: '欢迎使用 SparkSub 离线后台转录功能。' },
          { from: 3.5, to: 6.8, content: '无需打开视频页面，即可极速获取完整 Markdown 字幕。' }
        ]
      })
    };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

await BSE.Queue.processPendingJobs();
const processedItems = await BSE.Queue.getQueue();
assert.equal(processedItems.length, 1);
assert.equal(processedItems[0].stage, 'done', '任务必须通过 processPendingJobs 顺利转为 done 状态');
assert.equal(processedItems[0].subtitle?.cueCount, 2, '必须成功提取 2 句字幕');
assert.ok(processedItems[0].subtitle?.markdown?.includes('SparkSub 离线后台转录功能'), '必须包含转录出的 Markdown 内容');

// 20.1 Concurrent jobs must not overwrite another item's newer stage/subtitles
await BSE.Queue.clearAll();
await BSE.Queue.saveSettings({ maxConcurrency: 2 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    const second = url.includes('BV1CONCR002');
    await delay(second ? 5 : 20);
    return {
      json: async () => ({
        code: 0,
        data: {
          cid: second ? 202 : 101,
          title: second ? '并发任务二' : '并发任务一',
          owner: { name: '并发测试' },
          pages: [{ page: 1, cid: second ? 202 : 101, part: '正片' }]
        }
      })
    };
  }
  if (url.includes('x/web-interface/nav')) {
    await delay(3);
    return { json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  }
  if (url.includes('x/player/wbi/v2')) {
    const second = url.includes('cid=202');
    await delay(second ? 25 : 5);
    return { json: async () => ({ data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: `https://subtitle.test/${second ? 2 : 1}` }] } } }) };
  }
  if (url.includes('subtitle.test')) {
    const second = url.endsWith('/2');
    await delay(second ? 20 : 2);
    return { json: async () => ({ body: [{ from: 0, to: 1, content: second ? '任务二字幕' : '任务一字幕' }] }) };
  }
  throw new Error(`Unexpected concurrent queue URL: ${url}`);
};

storageWriteHistory.length = 0;
await BSE.Queue.addToQueue([
  'https://www.bilibili.com/video/BV1CONCR001',
  'https://www.bilibili.com/video/BV1CONCR002'
]);

await BSE.Queue.processPendingJobs();
const concurrentItems = await BSE.Queue.getQueue();
assert.equal(concurrentItems.length, 2);
assert.ok(concurrentItems.every((item) => item.stage === 'done'), 'maxConcurrency=2 的交错任务最终必须全部完成');
assert.equal(concurrentItems.find((item) => item.id === 'BV1CONCR001')?.subtitle?.plainText, '任务一字幕');
assert.equal(concurrentItems.find((item) => item.id === 'BV1CONCR002')?.subtitle?.plainText, '任务二字幕');

const observedStages = new Map();
const stageOrder = ['queued', 'resolving', 'fetching_caption', 'fetching_audio', 'postprocessing', 'done'];
for (const write of storageWriteHistory) {
  for (const [key, value] of Object.entries(write)) {
    if (!key.includes(':item:') || !value?.id) continue;
    const previous = observedStages.get(value.id);
    if (previous) {
      assert.ok(stageOrder.indexOf(value.stage) >= stageOrder.indexOf(previous), `任务 ${value.id} 不得被另一任务的中间状态回退 (previous: ${previous}, current: ${value.stage})`);
    }
    observedStages.set(value.id, value.stage);
  }
}
assert.equal(observedStages.get('BV1CONCR001'), 'done');
assert.equal(observedStages.get('BV1CONCR002'), 'done');

// 21. YouTube Offline Transcription with Multi-client & Multi-format Subtitles
await BSE.Queue.clearCompleted();

mockFetch = async (url, options = {}) => {
  if (url.includes('youtubei/v1/player')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        videoDetails: {
          title: '4 Language Habits That Get You Fluent FAST',
          author: 'Olly Richards',
          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/Ewd6CGwaEXY/hqdefault.jpg' }] }
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=Ewd6CGwaEXY&lang=en',
                name: { simpleText: 'English' },
                languageCode: 'en'
              }
            ]
          }
        }
      })
    };
  }
  if (url.includes('timedtext')) {
    // Return XML format to verify that XML subtitles don't throw Unexpected Token
    return {
      ok: true,
      status: 200,
      text: async () => `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.0" dur="3.5">Reading every single day is the number one habit.</text>
  <text start="3.5" dur="4.0">It allows you to acquire vocabulary naturally in context.</text>
</transcript>`
    };
  }
  return { ok: true, status: 200, text: async () => '' };
};

await BSE.Queue.addToQueue({
  platform: 'youtube',
  targetId: 'Ewd6CGwaEXY',
  url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY',
  title: 'YouTube 离线转录测试',
  author: 'YouTube 频道'
});

await BSE.Queue.processPendingJobs();
const ytItems = await BSE.Queue.getQueue();
assert.equal(ytItems.length, 1);
assert.equal(ytItems[0].stage, 'done', 'YouTube 任务必须成功完成');
// 21.01 Stale lease on queued item must be reclaimable and not get stuck in queued forever
await BSE.Queue.clearAll();
await BSE.Queue.saveQueue([{
  id: 'waGRF_ZApfI',
  platform: 'youtube',
  targetId: 'waGRF_ZApfI',
  url: 'https://www.youtube.com/watch?v=waGRF_ZApfI',
  title: 'YouTube 视频 (waGRF_ZApfI)',
  author: 'YouTube 频道',
  stage: 'queued',
  progress: 0,
  stageHint: '排队中…',
  leaseOwner: 'old-stale-executor-999',
  leaseExpiresAt: Date.now() - 10000
}]);
await BSE.Queue.processPendingJobs();
const reclaimed = await BSE.Queue.getQueue();
assert.equal(reclaimed.length, 1);
assert.equal(reclaimed[0].stage, 'done', '带有过期 leaseOwner 的 queued 任务必须能够被新执行器顺利认领并转录完成');

// 21.1 Two isolated executors must atomically claim a queue item exactly once.
const isolatedStorage = new Map();
let lockTail = Promise.resolve();
const isolatedLocks = {
  request: async (_name, callback) => {
    const previous = lockTail;
    let release;
    lockTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); } finally { release(); }
  }
};
const isolatedCounts = { metadata: 0, captionList: 0, subtitle: 0 };
const isolatedFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    isolatedCounts.metadata++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { json: async () => ({ code: 0, data: { title: '租约并发测试', owner: { name: '测试作者' }, pages: [{ page: 1, cid: 42, part: '正片' }] } }) };
  }
  if (url.includes('x/web-interface/nav')) {
    return { json: async () => ({ code: 0, data: {} }) };
  }
  if (url.includes('x/player/wbi/v2')) {
    isolatedCounts.captionList++;
    return { json: async () => ({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://example.test/subtitle.json' }] } } }) };
  }
  if (url.includes('subtitle.json')) {
    isolatedCounts.subtitle++;
    return { json: async () => ({ body: [{ from: 0, to: 1, content: '只应请求一次' }] }) };
  }
  throw new Error(`Unexpected isolated request: ${url}`);
};
const createIsolatedQueueContext = () => {
  const storage = {
    get: async (key) => {
      if (!key) {
        const out = {};
        for (const [k, v] of isolatedStorage.entries()) out[k] = structuredClone(v);
        return out;
      }
      if (typeof key === 'string') return { [key]: structuredClone(isolatedStorage.get(key)) };
      if (Array.isArray(key)) {
        const out = {};
        key.forEach((k) => { out[k] = structuredClone(isolatedStorage.get(k)); });
        return out;
      }
      return {};
    },
    set: async (values) => { for (const [key, value] of Object.entries(values)) isolatedStorage.set(key, structuredClone(value)); },
    remove: async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => isolatedStorage.delete(k)); }
  };
  const isolated = vm.createContext({
    console, URL, setTimeout, clearTimeout, AbortController,
    fetch: isolatedFetch,
    navigator: { locks: isolatedLocks },
    chrome: { storage: { local: storage }, runtime: { sendMessage: async () => ({ ok: true }) } },
    globalThis: null
  });
  isolated.globalThis = isolated;
  for (const file of ['core/namespace.js', 'core/utils.js', 'core/parsers.js', 'core/tracker.js', 'core/queue.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), isolated, { filename: `isolated/${file}` });
  }
  return isolated;
};
const executorA = createIsolatedQueueContext();
const executorB = createIsolatedQueueContext();
await executorA.BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1LEASE001');
const runA = executorA.BSE.Queue.processPendingJobs();
const runB = executorB.BSE.Queue.processPendingJobs();
await new Promise((resolve) => setTimeout(resolve, 10));
const duringRecovery = await executorB.BSE.Queue.recoverStaleJobs();
assert.equal(duringRecovery[0].stage, 'resolving', '有效租约的执行中任务不得被第二个执行器重新排队');
assert.ok(duringRecovery[0].leaseOwner, '执行期间必须持久化 leaseOwner');
assert.ok(duringRecovery[0].leaseExpiresAt > Date.now(), '执行期间必须持久化未过期的 leaseExpiresAt');
await Promise.all([runA, runB]);
const isolatedResult = await executorA.BSE.Queue.getQueue();
assert.equal(isolatedResult[0].stage, 'done');
assert.equal(isolatedCounts.metadata, 1, '两个隔离 VM 收到通知时元数据请求只能发生一次');
assert.equal(isolatedCounts.captionList, 1, '两个隔离 VM 收到通知时字幕元数据请求只能发生一次');
assert.equal(isolatedCounts.subtitle, 1, '两个隔离 VM 收到通知时字幕网络请求只能发生一次');
assert.equal(isolatedResult[0].leaseOwner, undefined, '任务完成后必须释放持久化租约');

// 22. YouTube Multi-track and Translation Isolation Test
const mockTracks = await BSE.YouTube.discoverTracks();
assert.ok(mockTracks.length >= 1, '必须发现 YouTube 基础字幕轨道');
const transTrack = mockTracks.find((t) => t.isTranslated && t.lan === 'zh-Hans');
assert.ok(transTrack, '非中文 YouTube 视频必须自动生成中文自动翻译轨道选项');
assert.ok(transTrack.subtitleUrl.includes('tlang=zh-Hans'), '翻译轨道 URL 必须包含 tlang 参数');

// 22.1 YouTube Playlist fetchMediaTree Test
const ytTree = await BSE.YouTube.fetchMediaTree('PL1234567890');
assert.equal(ytTree.kind, 'youtube_playlist', 'YouTube 必须正确识别播放列表拓扑');
assert.equal(ytTree.title, 'Learn English FAST Playlist', '必须返回正确的播放列表标题');
assert.equal(ytTree.items.length, 2, '必须提取播放列表中的两个视频');
assert.equal(ytTree.items[0].globalIndex, 1, '第 1 集的 globalIndex 必须为 1');
assert.equal(ytTree.items[0].duration, 605, '10:05 必须正确换算为 605 秒');
assert.equal(ytTree.sections[0].episodes.length, 2, '必须构造合法的 sections 与 episodes 结构以适配批量导出 UI');

// 22.2 YouTube Subtitle direct fetching in Tracker
const fakeYtSubItem = {
  id: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  author: 'Rick Astley',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
};
const prevNative = BSE.NativeHost;
BSE.NativeHost = {
  fetchYouTubeCaptions: async () => ({
    cues: [
      { from: 0, to: 5, content: 'Never gonna give you up' },
      { from: 5, to: 10, content: 'Never gonna let you down' }
    ],
    language: 'zh-Hans',
    langDoc: '中文（自动翻译）'
  })
};
const directYtRes = await BSE.Tracker.addSubscription({
  id: 'youtube:channel:UCuAXFkgsw1L7xaCfnd5JJOw',
  platform: 'youtube',
  type: 'channel',
  title: 'Rick Astley',
  targetId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  items: [fakeYtSubItem]
});
const itemSubtitle = await BSE.Tracker.fetchSubtitleForItem(directYtRes.id, fakeYtSubItem.id);
assert.equal(itemSubtitle.status, 'ready', 'YouTube 条目必须通过 Native Host 成功直取字幕');
assert.equal(itemSubtitle.cueCount, 2, '字幕条数必须正确解析');
assert.ok(itemSubtitle.markdown.includes('Never gonna give you up'), 'Markdown 必须包含字幕正文');
BSE.NativeHost = prevNative;
await BSE.Tracker.removeSubscription(directYtRes.id);

// 23. Queue native-ASR fallback behavior. These exercise the real queue; only
// the Native Messaging boundary is replaced with a deterministic fake.
assert.ok(BSE.Media, 'BSE.Media must expose the shared, immutable DASH descriptor helpers');
assert.ok(Object.isFrozen(BSE.Media), 'BSE.Media must be immutable');

const signedPrimary = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/primary.m4a?deadline=999&sign=secret-primary';
const signedBackup = 'https://upos-sz-mirrorali.bilivideo.com/upgcxcode/backup.m4a?deadline=999&sign=secret-backup';
const dashFixture = [
  { bandwidth: 999999, baseUrl: 'http://upos-sz-mirrorcos.bilivideo.com/insecure.m4a' },
  { bandwidth: 888888, base_url: 'https://evil.example/steal.m4a' },
  { bandwidth: 128000, baseUrl: signedPrimary, backup_url: signedBackup },
  { bandwidth: 192000, base_url: signedPrimary.replace('primary', 'best'), backupUrl: [signedBackup.replace('backup', 'best-backup'), 'http://upos-sz-mirrorcos.bilivideo.com/nope.m4a'] }
];
const selectedDescriptor = BSE.Media.selectBilibiliAudio(dashFixture);
assert.deepEqual(structuredClone(selectedDescriptor), {
  kind: 'remote',
  url: signedPrimary.replace('primary', 'best'),
  backupUrls: [signedBackup.replace('backup', 'best-backup')],
  headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0 (SparkSub)' }
}, 'shared selector must prefer the highest finite-bandwidth HTTPS Bilibili CDN stream and discard unsafe backups');
assert.deepEqual(Object.keys(selectedDescriptor.headers).sort(), ['Referer', 'User-Agent'], 'remote descriptors must carry only the two required public headers');
assert.deepEqual(
  structuredClone(BSE.Media.selectBilibiliAudio([{ bandwidth: 1, base_url: signedPrimary, backup_url: signedBackup }])?.backupUrls),
  [signedBackup],
  'a scalar backup_url must normalize to a safe backup URL array'
);

const originalNativeHost = BSE.NativeHost;
const captionsNotFound = async () => {
  const error = new Error('No public YouTube captions');
  error.code = 'CAPTIONS_NOT_FOUND';
  error.hint = 'No platform caption was published for this video.';
  error.retriable = false;
  throw error;
};
const setFakeNativeHost = (transcribe, fetchYouTubeCaptions = captionsNotFound) => {
  BSE.NativeHost = Object.freeze({ transcribe, fetchYouTubeCaptions });
};
const getOnlyQueueItem = async () => {
  const queue = await BSE.Queue.getQueue();
  assert.equal(queue.length, 1, 'fixture must contain one queue item');
  return queue[0];
};
const biliResponse = ({ tracks = [], captionBody = null, dash = dashFixture } = {}) => async (url) => {
  if (url.includes('x/web-interface/view')) return { ok: true, json: async () => ({ code: 0, data: { cid: 42, title: '无字幕 B 站视频', owner: { name: '测试 UP' }, pages: [{ page: 1, cid: 42, part: '正片' }] } }) };
  if (url.includes('x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  if (url.includes('x/player/wbi/v2')) return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: tracks } } }) };
  if (url.includes('caption.test')) return { ok: true, json: async () => ({ body: captionBody }) };
  if (url.includes('x/player/playurl')) return { ok: true, json: async () => ({ code: 0, data: { dash: { audio: dash } } }) };
  throw new Error(`Unexpected Bilibili fallback request: ${url}`);
};

await BSE.Queue.clearAll();
let nativeCalls = [];
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 1.5, content: '本地 ASR 完成的字幕。' }];
});
mockFetch = biliResponse();
storageWriteHistory.length = 0;
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRFALL01');
await BSE.Queue.processPendingJobs();
let fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 1, 'captionless Bilibili must call the native host once');
assert.deepEqual(structuredClone(nativeCalls[0].source), structuredClone(selectedDescriptor), 'Bilibili fallback must submit the shared best DASH descriptor');
assert.equal(fallbackItem.stage, 'done', 'a valid native transcription must complete the queue item');
assert.equal(fallbackItem.subtitle?.source, 'native', 'native output must persist its subtitle source');
assert.ok(['local-asr', 'parakeet', 'cohere'].includes(fallbackItem.subtitle?.engine), 'native output must persist its subtitle engine');
assert.ok(fallbackItem.subtitle?.cueCount > 0 && fallbackItem.subtitle?.plainText, 'done requires non-empty cues and plain text');
assert.equal(JSON.stringify(storageWriteHistory).includes('secret-primary'), false, 'a Bilibili signed primary URL must never be persisted');
assert.equal(JSON.stringify(storageWriteHistory).includes('secret-backup'), false, 'a Bilibili signed backup URL must never be persisted');

// A discovered track is not a successful caption path until its body has text.
await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse({ tracks: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://caption.test/empty' }], captionBody: [{ from: 0, to: 1, content: '   ' }] });
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASREMPTY1');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 1, 'empty bodies from every discovered Bilibili track must fall through to native ASR');
assert.equal(fallbackItem.stage, 'done');

await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse({ tracks: [{ lan: 'zh-CN', lan_doc: '官方中文', subtitle_url: 'https://caption.test/official' }], captionBody: [{ from: 0, to: 1, content: '官方字幕优先。' }] });
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASROFFI01');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 0, 'a usable official caption must never call the native host');
assert.equal(fallbackItem.stage, 'done');

await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse();
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRYUE001', { sourceLanguage: 'yue' });
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'failed', 'unsupported Cantonese must fail only after captions are exhausted');
assert.equal(fallbackItem.errorCode, 'ASR_LANGUAGE_UNSUPPORTED');
assert.equal(nativeCalls.length, 0, 'unsupported Cantonese must not contact the native host');

await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse({ tracks: [{ lan: 'zh-HK', lan_doc: '粵語字幕', subtitle_url: 'https://caption.test/yue' }], captionBody: [{ from: 0, to: 1, content: '平台粵語字幕。' }] });
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRYUE002', { sourceLanguage: 'yue' });
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'done', 'Cantonese is permitted when platform captions are usable');
assert.equal(nativeCalls.length, 0);

await BSE.Queue.clearAll();
nativeCalls = [];
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 2, to: 3, content: '没有页面时的 YouTube 本地字幕。' }];
});
mockFetch = async () => ({ ok: true, text: async () => '', json: async () => ({}) });
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=ASRYOUTUBE1');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'done', 'captionless YouTube must fall back without an open tab');
assert.deepEqual(structuredClone(nativeCalls[0].source), { kind: 'youtube', url: 'https://www.youtube.com/watch?v=ASRYOUTUBE1' }, 'YouTube fallback must submit only the canonical watch URL');

await BSE.Queue.clearAll();
nativeCalls = [];
let nativeCaptionRequests = [];
setFakeNativeHost(
  async (payload) => {
    nativeCalls.push(payload);
    throw new Error('Cantonese platform captions must complete before local ASR');
  },
  async (payload) => {
    nativeCaptionRequests.push(structuredClone(payload));
    return {
      cues: [{ from: 0, to: 1.5, content: '關閉頁面後仍可取得粵語字幕。' }],
      language: 'yue',
      langDoc: '粵語（自動產生）',
      kind: 'auto'
    };
  }
);
mockFetch = async () => ({ ok: true, text: async () => '', json: async () => ({}) });
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=YUECAPTION1', { sourceLanguage: 'yue' });
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCaptionRequests.length, 1, 'closed-tab YouTube must ask the native host for public captions before ASR');
assert.match(nativeCaptionRequests[0].jobId, new RegExp(`^${fallbackItem.id}:youtube-captions:`), 'each native caption attempt must have a unique execution-scoped job ID');
assert.deepEqual(structuredClone({
  sourceLanguage: nativeCaptionRequests[0].sourceLanguage,
  source: nativeCaptionRequests[0].source
}), {
  sourceLanguage: 'yue',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=YUECAPTION1' }
});
assert.equal(nativeCalls.length, 0, 'a native-fetched YouTube caption must never enter local ASR');
assert.equal(fallbackItem.stage, 'done');
assert.equal(fallbackItem.subtitle?.source, 'platform');
assert.equal(fallbackItem.subtitle?.engine, 'youtube');
assert.equal(fallbackItem.subtitle?.language, 'yue');
assert.equal(fallbackItem.subtitle?.langDoc, '粵語（自動產生）');
assert.equal(fallbackItem.subtitle?.captionKind, 'auto', 'the completed queue item must retain whether YouTube supplied manual, automatic, or translated captions');

// Queue mutations must cancel active work before changing persistence. The
// NativeHost boundary test above proves each abort maps to exactly one native
// cancel frame; these tests prove remove/clear/retry actually trigger the abort.
const cancellationError = () => Object.assign(new Error('cancelled'), {
  code: 'CANCELLED', hint: 'cancelled', retriable: false
});
const waitUntil = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
};

await BSE.Queue.clearAll();
let removeStarted = false;
let removeAbortCount = 0;
setFakeNativeHost((_payload, { signal }) => new Promise((_resolve, reject) => {
  removeStarted = true;
  signal.addEventListener('abort', () => {
    removeAbortCount += 1;
    reject(cancellationError());
  }, { once: true });
}));
mockFetch = biliResponse();
const [removeSeed] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1CANCEL001');
const removeDrain = BSE.Queue.processPendingJobs();
await waitUntil(() => removeStarted, 'remove fixture must reach native transcription');
assert.equal(await BSE.Queue.removeFromQueue(removeSeed.id), true);
await removeDrain;
assert.equal(removeAbortCount, 1, 'removing an active item must abort its executor exactly once');
assert.equal((await BSE.Queue.getQueue()).length, 0, 'a cancelled removed item must not be resurrected by stale completion');

await BSE.Queue.clearAll();
const clearStarted = new Set();
const clearAborted = new Set();
setFakeNativeHost((payload, { signal }) => new Promise((_resolve, reject) => {
  clearStarted.add(payload.jobId);
  signal.addEventListener('abort', () => {
    clearAborted.add(payload.jobId);
    reject(cancellationError());
  }, { once: true });
}));
mockFetch = biliResponse();
await BSE.Queue.addToQueue([
  'https://www.bilibili.com/video/BV1CLEAR0001',
  'https://www.bilibili.com/video/BV1CLEAR0002'
]);
const clearDrain = BSE.Queue.processPendingJobs();
await waitUntil(() => clearStarted.size === 2, 'clear fixture must start both native jobs');
await BSE.Queue.clearAll();
await clearDrain;
assert.equal(clearAborted.size, 2, 'clear all must abort every active executor');
assert.equal((await BSE.Queue.getQueue()).length, 0, 'clear all must remain empty after active jobs settle');

await BSE.Queue.clearAll();
let retryAttempts = 0;
let retryAbortCount = 0;
const retryJobIds = [];
setFakeNativeHost((payload, { signal }) => {
  retryAttempts += 1;
  retryJobIds.push(payload.jobId);
  if (retryAttempts > 1) return Promise.resolve([{ from: 0, to: 1, content: '取消旧执行后重试成功。' }]);
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      retryAbortCount += 1;
      reject(cancellationError());
    }, { once: true });
  });
});
mockFetch = biliResponse();
const [retrySeed] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1RETRY0001', { sourceLanguage: 'en' });
const retryDrain = BSE.Queue.processPendingJobs();
await waitUntil(() => retryAttempts === 1, 'retry fixture must reach its first native attempt');
const activeRetry = await BSE.Queue.retryItem(retrySeed.id);
assert.equal(activeRetry?.stage, 'queued');
await retryDrain;
fallbackItem = await getOnlyQueueItem();
assert.equal(retryAbortCount, 1, 'retrying an active item must cancel the stale attempt exactly once');
assert.equal(retryAttempts, 2, 'the Service Worker drain must run the newly queued retry once');
assert.notEqual(retryJobIds[0], retryJobIds[1], 'a retry must use a new native job ID so cancellation cannot race with the replacement attempt');
assert.equal(fallbackItem.stage, 'done');

await BSE.Queue.clearAll();
const originalQueueStorageSet = context.chrome.storage.local.set;
context.chrome.storage.local.set = async (values) => {
  await new Promise((resolve) => setTimeout(resolve, 2));
  return originalQueueStorageSet(values);
};
setFakeNativeHost(async (_payload, { onProgress }) => {
  onProgress({ stage: 'fetching_audio', percent: 61, hint: 'Downloading media' });
  onProgress({ stage: 'fetching_audio', percent: 61, hint: 'Downloading media' });
  for (let percent = 62; percent <= 70; percent++) {
    onProgress({ stage: 'fetching_audio', percent, hint: 'Downloading media' });
  }
  onProgress({ stage: 'transcribing', percent: 82, hint: 'Recognizing audio' });
  return [{ from: 0, to: 2, content: '进度完成。' }];
});
mockFetch = biliResponse();
storageWriteHistory.length = 0;
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRPROG01');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'done');
assert.ok(storageWriteHistory.some((write) => Object.values(write).some((item) => item?.stage === 'transcribing')), 'native progress must persist the transcribing stage');
const duplicateProgressWrites = storageWriteHistory.filter((write) => Object.values(write).some((item) => item?.stage === 'fetching_audio' && item?.progress === 61));
assert.equal(duplicateProgressWrites.length, 1, 'duplicate progress values inside the throttle window must not write storage twice');
const highFrequencyFetchingWrites = storageWriteHistory.filter((write) => Object.values(write).some((item) => item?.stage === 'fetching_audio' && item?.progress >= 61));
assert.equal(highFrequencyFetchingWrites.length, 1, 'high-frequency percentage changes must be throttled to one persistent write per stage window');
assert.equal(fallbackItem.leaseExpiresAt, undefined, 'terminal persistence must clear the renewed lease');
context.chrome.storage.local.set = originalQueueStorageSet;

await BSE.Queue.clearAll();
setFakeNativeHost(async () => []);
mockFetch = biliResponse();
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRBAD001');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'failed', 'empty native results must not produce a false done state');
assert.equal(fallbackItem.errorCode, 'RESULT_INCOMPLETE');

await BSE.Queue.clearAll();
setFakeNativeHost(async () => [{ from: 2, to: 1, content: '时间倒流' }]);
mockFetch = biliResponse();
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRBAD002');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'failed', 'malformed native cues must not produce a false done state');
assert.equal(fallbackItem.errorCode, 'RESULT_INCOMPLETE');

await BSE.Queue.clearAll();
await BSE.Queue.saveSettings({ sourceLanguage: 'en' });
const [settingsLanguageItem] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRLANG00');
assert.equal(settingsLanguageItem.sourceLanguage, 'en', 'queue settings must supply the default source language');
await BSE.Queue.clearAll();
await BSE.Queue.saveSettings({ sourceLanguage: 'auto' });
const [languageItem] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRLANG01', { sourceLanguage: 'en' });
await BSE.Queue.saveQueue([{ ...languageItem, stage: 'failed', error: 'previous failure', errorCode: 'ASR_FAILED' }]);
const [requeuedLanguageItem] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRLANG01', { sourceLanguage: 'zh' });
assert.equal(requeuedLanguageItem.sourceLanguage, 'zh', 'explicit language must update a previously failed item on enqueue');
const retriedLanguageItem = await BSE.Queue.retryItem(requeuedLanguageItem.id);
assert.equal(retriedLanguageItem.sourceLanguage, 'zh', 'retryItem must preserve the selected source language');

// 24. Review hardening: persistent lease heartbeat, persistence sanitization,
// caption-class priority, and retry reset must remain observable at the queue boundary.
await BSE.Queue.clearAll();
vm.runInContext('globalThis.__bseOriginalDateNow = Date.now; Date.now = () => globalThis.__bseTestClock;', context);
context.__bseTestClock = 1_000_000;
setFakeNativeHost(async (_payload, { onProgress }) => {
  context.__bseTestClock = 1_000_100;
  onProgress({ stage: 'fetching_audio', percent: 61, hint: 'Downloading media' });
  context.__bseTestClock = 1_001_300;
  onProgress({ stage: 'fetching_audio', percent: 61, hint: 'Downloading media' });
  return [{ from: 0, to: 1, content: '心跳续租完成。' }];
});
mockFetch = biliResponse();
storageWriteHistory.length = 0;
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRHEART1');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
const heartbeatWrites = storageWriteHistory.filter((write) => Object.values(write).some((item) => (
  item?.stage === 'fetching_audio' && item?.progress === 61
)));
assert.equal(heartbeatWrites.length, 2, 'unchanged native progress after the throttle interval must persist a lease heartbeat exactly once');
assert.equal(fallbackItem.stage, 'done', 'drained heartbeat writes must not overwrite terminal done');
vm.runInContext('Date.now = globalThis.__bseOriginalDateNow; delete globalThis.__bseOriginalDateNow; delete globalThis.__bseTestClock;', context);

await BSE.Queue.clearAll();
setFakeNativeHost(async (_payload, { onProgress }) => {
  onProgress({ stage: 'fetching_audio', percent: 61, hint: 'native-progress:sign=progress-secret' });
  const error = new Error('native-error:token=error-secret');
  error.code = 'MEDIA_DOWNLOAD_FAILED';
  error.hint = 'native-hint:deadline=999';
  error.retriable = true;
  throw error;
});
mockFetch = biliResponse();
storageWriteHistory.length = 0;
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRSECRET');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'failed');
assert.equal(/progress-secret|error-secret|deadline=999|sign=|token=/.test(JSON.stringify(storageWriteHistory)), false, 'native progress and host errors must never persist URL or bare signing fragments');

await BSE.Queue.clearAll();
const legacySignedUrl = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/legacy.m4a?deadline=999&sign=legacy-secret&token=legacy-token';
await BSE.Queue.saveQueue([{
  id: 'BV1ASRLEGACY',
  platform: 'bilibili',
  targetId: 'BV1ASRLEGACY',
  url: 'https://www.bilibili.com/video/BV1ASRLEGACY',
  cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
  title: '旧任务', author: '测试', stage: 'failed', progress: 0,
  sourceLanguage: 'en', completedAt: 123,
  audioCache: { audioUrl: legacySignedUrl, backupUrls: [legacySignedUrl] },
  stageArtifacts: { captionTracks: [{ baseUrl: 'https://caption.test/needed', languageCode: 'en' }], nested: { audioUrl: legacySignedUrl, backup_url: legacySignedUrl } },
  transientMedia: { source: { kind: 'remote', url: legacySignedUrl } },
  error: `native failed: ${legacySignedUrl}`,
  errorHint: 'token=legacy-token',
  stageHint: 'deadline=999'
}]);
fallbackItem = await getOnlyQueueItem();
const sanitizedPersistedJson = JSON.stringify(fallbackItem);
assert.equal(fallbackItem.url, 'https://www.bilibili.com/video/BV1ASRLEGACY', 'canonical video URL must survive legacy migration');
assert.equal(fallbackItem.cover, 'https://i0.hdslb.com/bfs/archive/cover.jpg', 'cover URL must survive legacy migration');
assert.equal(fallbackItem.stageArtifacts?.captionTracks?.[0]?.baseUrl, 'https://caption.test/needed', 'needed platform caption data must survive legacy migration');
assert.equal(/legacy-secret|legacy-token|deadline=999|audioCache|audioUrl|backup_url/.test(sanitizedPersistedJson), false, 'recursive persistence migration must remove legacy ephemeral media and token fragments');

await BSE.Queue.clearAll();
const [failedResetSeed] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRRESET1', { sourceLanguage: 'en' });
await BSE.Queue.saveQueue([{
  ...failedResetSeed,
  stage: 'failed', completedAt: 42, error: 'old error', errorCode: 'ASR_FAILED', errorHint: 'old hint', retriable: false,
  subtitle: { language: 'en', langDoc: 'old', cueCount: 1, plainText: '旧字幕', markdown: '旧字幕' },
  audioCache: { audioUrl: legacySignedUrl }, stageArtifacts: { nested: { mediaUrl: legacySignedUrl } }
}]);
const [requeuedResetItem] = await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRRESET1', { sourceLanguage: 'zh' });
assert.equal(requeuedResetItem.sourceLanguage, 'zh');
assert.equal('subtitle' in requeuedResetItem || 'errorCode' in requeuedResetItem || 'completedAt' in requeuedResetItem || 'audioCache' in requeuedResetItem, false, 'failed re-enqueue must reset stale terminal/error/media state');
const retriedResetItem = await BSE.Queue.retryItem(requeuedResetItem.id);
assert.equal('subtitle' in retriedResetItem || 'errorHint' in retriedResetItem || 'audioCache' in retriedResetItem, false, 'retryItem must use the same reset boundary');
setFakeNativeHost(async () => [{ from: 0, to: 1, content: '重试成功字幕。' }]);
mockFetch = biliResponse();
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.stage, 'done');
assert.equal('error' in fallbackItem || 'errorCode' in fallbackItem || 'errorHint' in fallbackItem || 'retriable' in fallbackItem, false, 'successful retry must not retain stale failure metadata');

const mixedBiliOrder = [];
await BSE.Queue.clearAll();
setFakeNativeHost(async () => { throw new Error('native fallback must not run for a later usable platform caption'); });
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) return { ok: true, json: async () => ({ code: 0, data: { cid: 77, title: '字幕优先级', owner: { name: '测试' }, pages: [{ page: 1, cid: 77 }] } }) };
  if (url.includes('x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  if (url.includes('x/player/wbi/v2')) return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: [
    { lan: 'en', lan_doc: 'Manual English', subtitle_url: 'https://caption.test/manual' },
    { lan: 'zh-CN', lan_doc: 'AI 自动字幕', subtitle_url: 'https://caption.test/auto', is_auto: true },
    { lan: 'zh-Hans', lan_doc: '中文翻译', subtitle_url: 'https://caption.test/translated', isTranslated: true }
  ] } } }) };
  if (url.includes('caption.test/')) {
    const name = url.split('/').at(-1);
    mixedBiliOrder.push(name);
    return { ok: true, json: async () => ({ body: name === 'translated' ? [{ from: 0, to: 1, content: '翻译字幕成功。' }] : [{ from: 0, to: 1, content: ' ' }] }) };
  }
  throw new Error(`Unexpected Bilibili rank request: ${url}`);
};
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRRANK01');
await BSE.Queue.processPendingJobs();
assert.deepEqual(mixedBiliOrder, ['manual', 'auto', 'translated'], 'Bilibili must exhaust manual, then automatic, then translated captions regardless of language preference');

const mixedYouTubeOrder = [];
await BSE.Queue.clearAll();
mockFetch = async (url) => {
  if (url.includes('youtubei/v1/player')) return {
    ok: true,
    text: async () => JSON.stringify({ videoDetails: { title: 'YouTube priority', author: '测试' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: 'https://caption.yt/manual', languageCode: 'en', name: { simpleText: 'Manual English' } },
      { baseUrl: 'https://caption.yt/auto', languageCode: 'en', name: { simpleText: 'English (auto-generated)' }, vssId: 'a.en' },
      { baseUrl: 'https://caption.yt/translated', languageCode: 'zh-Hans', name: { simpleText: '中文翻译' }, isTranslated: true }
    ] } } })
  };
  if (url.includes('caption.yt/')) {
    const name = url.match(/caption\.yt\/(manual|auto|translated)/)?.[1];
    mixedYouTubeOrder.push(name);
    return { ok: true, text: async () => name === 'translated'
      ? JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'YouTube 翻译字幕成功。' }] }] })
      : '' };
  }
  if (url.includes('www.youtube.com/watch')) return { ok: true, text: async () => '' };
  throw new Error(`Unexpected YouTube rank request: ${url}`);
};
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=ASRRANKYT01');
await BSE.Queue.processPendingJobs();
assert.deepEqual([...new Set(mixedYouTubeOrder)], ['manual', 'auto', 'translated'], 'YouTube must keep translated tracks behind manual and automatic captions');

const cantoneseAliasRequests = [];
await BSE.Queue.clearAll();
setFakeNativeHost(async () => { throw new Error('a usable zh-HK platform track must complete before native fallback'); });
mockFetch = async (url) => {
  if (url.includes('youtubei/v1/player')) return {
    ok: true,
    text: async () => JSON.stringify({ videoDetails: { title: '粵語別名', author: '測試' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: 'https://caption.alias/mandarin', languageCode: 'zh-CN', name: { simpleText: '普通话' } },
      { baseUrl: 'https://caption.alias/cantonese', languageCode: 'zh-HK', name: { simpleText: '粵語' } }
    ] } } })
  };
  if (url.includes('caption.alias/')) {
    const name = url.match(/caption\.alias\/(mandarin|cantonese)/)?.[1];
    cantoneseAliasRequests.push(name);
    return { ok: true, text: async () => JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: name === 'cantonese' ? '正確粵語字幕。' : '錯誤普通話字幕。' }] }
    ] }) };
  }
  if (url.includes('www.youtube.com/watch')) return { ok: true, text: async () => '' };
  throw new Error(`Unexpected Cantonese alias request: ${url}`);
};
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=YUEALIASYT1', { sourceLanguage: 'yue' });
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(cantoneseAliasRequests[0], 'cantonese', 'requested yue must rank a zh-HK manual track ahead of an earlier zh-CN manual track');
assert.equal(fallbackItem.subtitle?.language, 'zh-HK');
assert.match(fallbackItem.subtitle?.plainText || '', /正確粵語字幕/);

const offscreenSource = fs.readFileSync(path.join(root, 'offscreen/offscreen.js'), 'utf8');
assert.match(offscreenSource, /function normalizeLegacyCues\(/, 'legacy offscreen caption completion must validate normalized non-empty cues before done');

// 25. Round-2 review: caption bodies are bound to their source track, direct
// storage is migrated on read, and host errors have stable curated copy.
await BSE.Queue.clearAll();
const originalTabs = context.chrome.tabs;
const activeTabRequests = [];
context.chrome.tabs = {
  query: async () => [{ id: 9 }],
  sendMessage: async () => ({ ok: true, result: {
    title: '活动页优先级', author: '测试',
    captionTracks: [
      { baseUrl: 'https://caption.active/manual', languageCode: 'en', name: { simpleText: 'Manual English' } },
      { baseUrl: 'https://caption.active/translated', languageCode: 'zh-Hans', name: { simpleText: '中文翻译' }, isTranslated: true }
    ],
    rawText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '活动页翻译字幕' }] }] }),
    chosenTrack: { id: 'youtube-native-transcript', languageCode: 'auto', name: { simpleText: 'YouTube 原生 Transcript' }, isTranscriptFallback: true }
  } })
};
mockFetch = async (url) => {
  if (url.includes('caption.active/')) {
    activeTabRequests.push(url.match(/caption\.active\/(manual|translated)/)?.[1]);
    return { ok: true, text: async () => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Manual wins.' }] }] }) };
  }
  throw new Error(`active-tab direct text must not bypass ranked tracks: ${url}`);
};
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=ASRACTIVET1');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(activeTabRequests[0], 'manual', 'active-tab translated text must wait until higher-priority manual tracks are attempted');
assert.equal(fallbackItem.subtitle?.language, 'en', 'final label must come from the actual manual track');
context.chrome.tabs = originalTabs;

// A direct get_transcript body without a track identity is a final platform
// candidate, not a Chinese track and not a reason to start native ASR.
await BSE.Queue.clearAll();
nativeCalls = [];
setFakeNativeHost(async (payload) => {
  nativeCalls.push(payload);
  throw new Error('unidentified platform transcript must complete before native ASR');
});
context.chrome.tabs = {
  query: async () => [{ id: 10 }],
  sendMessage: async () => ({ ok: true, result: {
    title: '无轨道原生 Transcript', author: '测试', captionTracks: [],
    rawText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '原生 transcript 正文。' }] }] }),
    chosenTrack: { id: 'youtube-native-transcript', languageCode: 'auto', name: { simpleText: 'YouTube 原生 Transcript' }, isTranscriptFallback: true }
  } })
};
mockFetch = async (url) => { throw new Error(`unidentified direct transcript must not fetch or call native: ${url}`); };
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=ASRDIRECT01');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 0, 'valid unmatched direct transcript with no listed tracks must not call native ASR');
assert.equal(fallbackItem.stage, 'done');
assert.equal(fallbackItem.subtitle?.source, 'platform');
assert.equal(fallbackItem.subtitle?.language, 'auto', 'unidentified direct transcript must not claim zh-Hans');
assert.equal(fallbackItem.subtitle?.langDoc, 'YouTube 原生 Transcript');
assert.ok(fallbackItem.subtitle?.cueCount > 0, 'unidentified direct transcript must persist normalized non-empty cues');

await BSE.Queue.clearAll();
const directAfterTracksRequests = [];
nativeCalls = [];
context.chrome.tabs = {
  query: async () => [{ id: 11 }],
  sendMessage: async () => ({ ok: true, result: {
    title: '轨道后原生 Transcript', author: '测试',
    captionTracks: [
      { baseUrl: 'https://caption.direct/manual', languageCode: 'en', name: { simpleText: 'Manual English' } },
      { baseUrl: 'https://caption.direct/auto', languageCode: 'en', name: { simpleText: 'English (auto-generated)' }, vssId: 'a.en' }
    ],
    rawText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '所有轨道耗尽后的原生正文。' }] }] }),
    chosenTrack: { id: 'youtube-native-transcript', languageCode: 'auto', name: { simpleText: 'YouTube 原生 Transcript' }, isTranscriptFallback: true }
  } })
};
setFakeNativeHost(async (payload) => {
  nativeCalls.push(payload);
  throw new Error('direct transcript must be consumed before native ASR');
});
mockFetch = async (url) => {
  if (url.includes('caption.direct/')) {
    directAfterTracksRequests.push(url.match(/caption\.direct\/(manual|auto)/)?.[1]);
    return { ok: true, text: async () => '' };
  }
  throw new Error(`unexpected direct-transcript request: ${url}`);
};
await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=ASRDIRECT02');
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.deepEqual([...new Set(directAfterTracksRequests)], ['manual', 'auto'], 'listed manual and automatic tracks must exhaust before the unmatched direct transcript');
assert.equal(nativeCalls.length, 0);
assert.equal(fallbackItem.subtitle?.language, 'auto');
assert.equal(fallbackItem.subtitle?.langDoc, 'YouTube 原生 Transcript');
context.chrome.tabs = originalTabs;

// Crash-resume must reconstruct the persisted direct fallback without an
// in-memory chosenTrack, only after every listed track remains empty.
await BSE.Queue.clearAll();
const resumedDirectRequests = [];
nativeCalls = [];
await BSE.Queue.saveQueue([{
  id: 'resume-direct-transcript', platform: 'youtube', targetId: 'ASRDIRECT03', url: 'https://www.youtube.com/watch?v=ASRDIRECT03',
  title: '恢复原生 Transcript', author: '测试', stage: 'queued', progress: 0,
  metaCache: {
    title: '恢复原生 Transcript', author: '测试',
    captionTracks: [
      { baseUrl: 'https://caption.resume-direct/manual', languageCode: 'en', name: { simpleText: 'Manual English' } },
      { baseUrl: 'https://caption.resume-direct/auto', languageCode: 'en', name: { simpleText: 'English (auto-generated)' }, vssId: 'a.en' }
    ]
  },
  stageArtifacts: {
    metadataResolved: true,
    captionText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '恢复后的原生正文。' }] }] }),
    captionTrackId: 'youtube-native-transcript',
    selectedCaption: { id: 'youtube-native-transcript', language: 'auto', langDoc: 'YouTube 原生 Transcript', kind: 3, isTranscriptFallback: true }
  }
}]);
setFakeNativeHost(async (payload) => {
  nativeCalls.push(payload);
  throw new Error('resumed direct transcript must complete before native ASR');
});
mockFetch = async (url) => {
  if (url.includes('caption.resume-direct/')) {
    resumedDirectRequests.push(url.match(/caption\.resume-direct\/(manual|auto)/)?.[1]);
    return { ok: true, text: async () => '' };
  }
  throw new Error(`resume must not refetch metadata: ${url}`);
};
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.deepEqual([...new Set(resumedDirectRequests)], ['manual', 'auto'], 'resumed direct transcript must remain after all ranked listed tracks');
assert.equal(nativeCalls.length, 0);
assert.equal(fallbackItem.subtitle?.source, 'platform');
assert.equal(fallbackItem.subtitle?.language, 'auto');
assert.equal(fallbackItem.subtitle?.langDoc, 'YouTube 原生 Transcript');

const mainWorldBridgeSource = fs.readFileSync(path.join(root, 'content/main-world-bridge.js'), 'utf8');
assert.match(mainWorldBridgeSource, /languageCode:\s*'auto'/, 'get_transcript bridge contract must not label an unidentified transcript zh-Hans');
assert.match(mainWorldBridgeSource, /isTranscriptFallback:\s*true/, 'get_transcript bridge contract must identify an unmatched transcript explicitly');

await BSE.Queue.clearAll();
const cachedBiliRequests = [];
await BSE.Queue.saveQueue([{
  id: 'BV1ASRCACHE1', platform: 'bilibili', targetId: 'BV1ASRCACHE1', url: 'https://www.bilibili.com/video/BV1ASRCACHE1', title: '缓存轨道', author: '测试', stage: 'queued', progress: 0,
  metaCache: { cid: 91, title: '缓存轨道' },
  stageArtifacts: {
    captionTracks: [
      { id_str: 'manual-id', lan: 'en', lan_doc: 'Manual', subtitle_url: 'https://caption.cache/manual' },
      { id_str: 'translated-id', lan: 'zh-Hans', lan_doc: '中文翻译', subtitle_url: 'https://caption.cache/translated', isTranslated: true }
    ],
    captionBody: [{ from: 0, to: 1, content: '旧翻译缓存' }]
  }
}]);
mockFetch = async (url) => {
  if (url.includes('caption.cache/')) {
    cachedBiliRequests.push(url.match(/caption\.cache\/(manual|translated)/)?.[1]);
    return { ok: true, json: async () => ({ body: [{ from: 0, to: 1, content: '缓存后的手动字幕' }] }) };
  }
  throw new Error(`legacy Bilibili cache must refetch ranked track: ${url}`);
};
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(cachedBiliRequests[0], 'manual', 'legacy Bilibili captionBody without a track identity must be ignored and refetched in rank order');
assert.equal(fallbackItem.subtitle?.language, 'en');

const identifiedCachedBiliRequests = [];
await BSE.Queue.clearAll();
await BSE.Queue.saveQueue([{
  id: 'BV1ASRCACHE2', platform: 'bilibili', targetId: 'BV1ASRCACHE2', url: 'https://www.bilibili.com/video/BV1ASRCACHE2', title: '有身份缓存', author: '测试', stage: 'queued', progress: 0,
  metaCache: { cid: 92, title: '有身份缓存' },
  stageArtifacts: {
    captionTracks: [
      { id_str: 'manual-id', lan: 'en', lan_doc: 'Manual', subtitle_url: 'https://caption.cache2/manual' },
      { id_str: 'translated-id', lan: 'zh-Hans', lan_doc: '中文翻译', subtitle_url: 'https://caption.cache2/translated', isTranslated: true }
    ],
    captionBody: [{ from: 0, to: 1, content: '有身份的翻译缓存' }], captionTrackId: 'translated-id'
  }
}]);
mockFetch = async (url) => {
  if (url.includes('caption.cache2/manual')) {
    identifiedCachedBiliRequests.push('manual');
    return { ok: true, json: async () => ({ body: [{ from: 0, to: 1, content: ' ' }] }) };
  }
  throw new Error(`identified cached track should be used at its ranked position, not fetched: ${url}`);
};
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.deepEqual(identifiedCachedBiliRequests, ['manual'], 'a lower-priority identified cache must wait until higher manual candidates are exhausted');
assert.equal(fallbackItem.subtitle?.language, 'zh-Hans', 'identified cache must retain the actual producing track label');

await BSE.Queue.clearAll();
const rawMigrationId = 'BV1ASRMIGR01';
const rawMigrationKey = `bse_transcription_queue_v1:item:${encodeURIComponent(rawMigrationId)}`;
const rawSignedDescriptor = { kind: 'remote', url: 'https://upos-sz-mirrorcos.bilivideo.com/x.m4a?upsig=raw-secret&wsSecret=raw-ws&wsTime=99', backupUrls: ['https://upos-sz-mirrorcos.bilivideo.com/y.m4a?sign%3Draw-secret'], headers: { Referer: 'https://www.bilibili.com/' } };
storageAreas.local.set(rawMigrationKey, {
  id: rawMigrationId, platform: 'bilibili', targetId: rawMigrationId, url: `https://www.bilibili.com/video/${rawMigrationId}`, cover: 'https://i0.hdslb.com/cover.jpg', title: '直接注入旧数据', author: '测试', stage: 'failed', progress: 0,
  unknownContainer: { descriptor: rawSignedDescriptor },
  untypedNestedSource: { url: rawSignedDescriptor.url, backupUrls: rawSignedDescriptor.backupUrls, headers: rawSignedDescriptor.headers },
  mystery: `https://upos-sz-mirrorcos.bilivideo.com/mystery.m4a?upsig=raw-secret&wsTime=99`, diagnostics: 'wsSecret=raw-ws auth_key=raw-auth sign%3Draw-secret',
  stageArtifacts: { captionTracks: [{ baseUrl: 'https://caption.migration/needed?lang=en', languageCode: 'en' }], captionText: '真实字幕内容 token 这个词本身不应删除' }
});
storageWriteHistory.length = 0;
const migratedRead = await BSE.Queue.getQueue();
const migratedItem = migratedRead.find((item) => item.id === rawMigrationId);
assert.ok(migratedItem, 'read migration must return directly injected old per-item storage');
assert.equal(/raw-secret|raw-ws|raw-auth|upsig|wsSecret|auth_key|sign%3D/.test(JSON.stringify(migratedItem)), false, 'read migration must remove unknown nested remote descriptors and broad signing diagnostics');
assert.equal(migratedItem.url, `https://www.bilibili.com/video/${rawMigrationId}`);
assert.equal(migratedItem.stageArtifacts?.captionTracks?.[0]?.baseUrl, 'https://caption.migration/needed?lang=en');
assert.equal(storageWriteHistory.filter((write) => rawMigrationKey in write).length, 1, 'read migration must rewrite a changed per-item snapshot once');
assert.equal(/raw-secret|raw-ws|raw-auth/.test(JSON.stringify(storageAreas.local.get(rawMigrationKey))), false, 'read migration must clean the underlying storage entry');

await BSE.Queue.clearAll();
const legacyArrayId = 'BV1ASRARRAY1';
storageAreas.local.set('bse_transcription_queue_v1', [{
  id: legacyArrayId, platform: 'bilibili', targetId: legacyArrayId, url: `https://www.bilibili.com/video/${legacyArrayId}`, cover: 'https://i0.hdslb.com/cover.jpg', title: '旧数组', author: '测试', stage: 'queued', progress: 0,
  unknown: { url: rawSignedDescriptor.url, backupUrls: rawSignedDescriptor.backupUrls, headers: rawSignedDescriptor.headers }
}]);
storageWriteHistory.length = 0;
const legacyArrayRead = await BSE.Queue.getQueue();
assert.equal(legacyArrayRead.find((item) => item.id === legacyArrayId)?.unknown, undefined, 'legacy whole-array reads must apply the same descriptor migration');
assert.ok(storageAreas.local.has(`bse_transcription_queue_v1:item:${encodeURIComponent(legacyArrayId)}`), 'legacy array migration must write the sanitized per-item snapshot');
assert.equal(storageAreas.local.has('bse_transcription_queue_v1'), false, 'legacy array migration must remove the old array key after one rewrite');

await BSE.Queue.clearAll();
await BSE.Queue.saveQueue([{
  id: 'BV1ASRWORDS1', platform: 'bilibili', targetId: 'BV1ASRWORDS1', url: 'https://www.bilibili.com/video/BV1ASRWORDS1',
  title: 'Token Economy and sign language before deadline', author: 'Token analyst', stage: 'queued', progress: 0,
  stageHint: 'Review sign language before deadline'
}]);
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.title, 'Token Economy and sign language before deadline', 'ordinary title text containing sensitive words without assignments must persist');
assert.equal(fallbackItem.author, 'Token analyst', 'ordinary author text containing sensitive words without assignments must persist');
assert.equal(fallbackItem.stageHint, 'Review sign language before deadline', 'ordinary stage hints containing sensitive words without assignments must persist');

const curatedErrorCases = [
  ['NATIVE_HOST_NOT_INSTALLED', false, '未检测到 SparkSub 本机转录服务。', '请安装本机转录服务后重试。'],
  ['NATIVE_HOST_DISCONNECTED', true, '本机转录服务已断开。', '请重新连接本机服务后重试。'],
  ['NATIVE_HOST_TIMEOUT', true, '本机转录服务响应超时。', '请确认本机服务仍在运行后重试。'],
  ['PROTOCOL_MISMATCH', false, '本机转录服务协议不兼容。', '请更新 SparkSub 扩展和本机服务。'],
  ['PROTOCOL_MESSAGE_TOO_LARGE', true, '本机转录服务返回的数据过大。', '请重试；如持续发生请更新本机服务。'],
  ['YTDLP_NOT_INSTALLED', false, '未安装 YouTube 下载组件。', '请完成本机服务安装后重试。'],
  ['YTDLP_CHECKSUM_FAILED', false, 'YouTube 下载组件校验失败。', '请重新安装本机服务。'],
  ['MEDIA_AUTH_REQUIRED', false, '该媒体需要登录或访问权限。', '目前仅支持公开可访问的视频。'],
  ['MEDIA_DOWNLOAD_FAILED', true, '媒体下载失败。', '请确认视频公开可访问后重试。'],
  ['MODEL_NOT_FOUND', false, '未找到本机转录模型。', '请安装受支持的本机模型后重试。'],
  ['MODEL_LAYOUT_INCOMPATIBLE', false, '本机转录模型布局不兼容。', '请检查模型版本或重新安装模型。'],
  ['ASR_LANGUAGE_UNSUPPORTED', false, '本机模型不支持粤语。', '请使用平台提供的粤语字幕，或选择受支持的语言。'],
  ['ASR_FAILED', true, '本地转录失败。', '请检查本机转录服务后重试。'],
  ['RESULT_INCOMPLETE', true, '本机转录结果不完整。', '请重试此任务。'],
  ['CANCELLED', false, '转录已取消。', '可在准备好后重新开始任务。'],
  ['INVALID_REQUEST', false, '本机转录请求无效。', '请检查视频和转录设置后重试。']
];
for (const [code, retriable, message, hint] of curatedErrorCases) {
  await BSE.Queue.clearAll();
  setFakeNativeHost(async () => {
    const error = new Error(`raw ${code} https://host.invalid/?token=secret`);
    error.code = code;
    error.hint = 'raw token=secret';
    error.retriable = !retriable;
    throw error;
  });
  mockFetch = biliResponse();
  await BSE.Queue.addToQueue(`https://www.bilibili.com/video/BV1ERR${code.slice(0, 5)}1`);
  await BSE.Queue.processPendingJobs();
  fallbackItem = await getOnlyQueueItem();
  assert.equal(fallbackItem.errorCode, code);
  assert.equal(fallbackItem.retriable, retriable, `${code} retriable status must be curated rather than taken from host text`);
  assert.equal(fallbackItem.error, message, `${code} must persist its curated message`);
  assert.equal(fallbackItem.errorHint, hint, `${code} must persist its curated hint`);
  assert.equal(/host\.invalid|token=secret/.test(`${fallbackItem.error} ${fallbackItem.errorHint}`), false, `${code} must not persist raw host diagnostics`);
}
await BSE.Queue.clearAll();
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRYUEERR', { sourceLanguage: 'yue' });
setFakeNativeHost(async () => { throw new Error('Cantonese must be rejected before host'); });
mockFetch = biliResponse();
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.equal(fallbackItem.errorCode, 'ASR_LANGUAGE_UNSUPPORTED');
assert.match(fallbackItem.error, /本机模型不支持粤语/, 'Cantonese rejection must present the release limitation verbatim');

// Task 5: UI-safe native-host setup, deterministic language routing, and
// source/engine presentation are tested as pure helpers before sidepanel code.
const queueUiContext = vm.createContext({ console, globalThis: null });
queueUiContext.globalThis = queueUiContext;
for (const file of ['core/namespace.js', 'core/i18n.js', 'core/language-routing.js', 'core/queue-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), queueUiContext, { filename: file });
}
const queueUi = queueUiContext.BSE.QueueUI;
assert.ok(queueUi, 'Queue UI helpers must expose language, capability, and safe-card presentation');
assert.deepEqual([...queueUi.SUPPORTED_SOURCE_LANGUAGES], [
  'auto', 'zh', 'yue', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ro', 'nl', 'da', 'sv', 'fi', 'hu', 'et', 'lv', 'lt', 'mt', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ru', 'uk', 'be', 'bg', 'sr', 'el'
], 'source-language selector must expose only host-supported routing codes');
assert.equal(queueUi.nativeEngineFor({ sourceLanguage: 'zh', platform: 'bilibili' }), 'cohere');
assert.equal(queueUi.nativeEngineFor({ sourceLanguage: 'fr', platform: 'youtube' }), 'parakeet');
assert.equal(queueUi.nativeEngineFor({ sourceLanguage: 'auto', platform: 'bilibili' }), 'cohere');
assert.equal(queueUi.nativeEngineFor({ sourceLanguage: 'auto', platform: 'youtube' }), 'parakeet');
assert.equal(queueUi.nativeEngineFor({ sourceLanguage: 'yue', platform: 'youtube' }), null, 'Cantonese remains platform-caption-only');
assert.equal(queueUi.sourceEngineLabel({ stage: 'done', platform: 'bilibili', subtitle: { source: 'platform', engine: 'bilibili' } }).key, 'queue_source_platform_bilibili');
assert.equal(queueUi.sourceEngineLabel({ stage: 'done', platform: 'youtube', sourceLanguage: 'zh', subtitle: { source: 'native', engine: 'local-asr' } }).key, 'queue_engine_cohere', 'legacy local-asr cards must derive the same host route');
assert.equal(queueUi.capabilityState({ hostReady: true, ytDLP: { available: true }, models: { parakeet: { available: true }, cohere: { available: true } } }).key, 'queue_capability_ready');
assert.equal(queueUi.capabilityState({ hostReady: true, ytDLP: { available: false }, models: { parakeet: { available: true }, cohere: { available: false, detail: 'vocabulary or k_cache_0 missing' } } }).key, 'queue_capability_partial', 'yt-dlp absence must not claim Bilibili remote download is unavailable');
assert.equal(queueUi.componentState('cohere', { available: false, detail: 'vocabulary or k_cache_0 missing' }).key, 'queue_capability_incompatible', 'Cohere compatibility must surface its vocabulary/k_cache_0 evidence');
assert.equal(queueUi.capabilityState(null, { code: 'NATIVE_HOST_NOT_INSTALLED' }).key, 'queue_capability_not_installed');
assert.equal(queueUi.capabilityState({ hostReady: false, ytDLP: { available: false }, models: { parakeet: { available: false }, cohere: { available: false } } }).key, 'queue_capability_partial');
const safeFailure = queueUi.safeFailurePresentation({ errorCode: 'MEDIA_DOWNLOAD_FAILED', errorHint: '<img src=x> https://media.invalid/a?token=secret', retriable: true });
assert.equal(safeFailure.code, 'MEDIA_DOWNLOAD_FAILED');
assert.equal(/<|https?:\/\/|token=/.test(safeFailure.hint), false, 'queue failure UI must not expose raw HTML, URLs, or signing fragments');
assert.equal(safeFailure.retriable, true);
const serviceWorkerEnqueueCalls = [];
const serviceWorkerItems = await queueUi.enqueueWithLanguage({
  urls: ['https://www.youtube.com/watch?v=abcdefghijk'],
  sourceLanguage: 'fr',
  sendMessage: async (message) => {
    serviceWorkerEnqueueCalls.push(message);
    return { ok: true, items: [{ id: 'worker-item' }] };
  }
});
assert.deepEqual(serviceWorkerItems, [{ id: 'worker-item' }]);
assert.deepEqual(JSON.parse(JSON.stringify(serviceWorkerEnqueueCalls)), [{
  type: 'BSE_QUEUE_ENQUEUE',
  urls: ['https://www.youtube.com/watch?v=abcdefghijk'],
  options: { sourceLanguage: 'fr' }
}], 'queue enqueue must forward the exact selected language to the Service Worker');
await assert.rejects(queueUi.enqueueWithLanguage({
  urls: ['https://www.youtube.com/watch?v=abcdefghijk'],
  sourceLanguage: 'fr',
  sendMessage: async () => { throw new Error('Service Worker unavailable'); }
}), /Service Worker unavailable/, 'a failed Service Worker enqueue must not mutate a sidepanel-local queue');
let savedLanguage;
await queueUi.saveDefaultLanguage('de', async (partial) => { savedLanguage = partial; return partial; });
assert.deepEqual(JSON.parse(JSON.stringify(savedLanguage)), { sourceLanguage: 'de' }, 'selector changes must persist the exact queue default');
assert.equal(await queueUi.loadDefaultLanguage(async () => ({ sourceLanguage: 'de' })), 'de', 'later batch input must read the saved queue default');
assert.equal(await queueUi.loadDefaultLanguage(async () => ({ sourceLanguage: 'not-a-host-language' })), 'auto', 'unsupported stored defaults must fail safe to auto');
const fakeCapabilityPanel = { hidden: true, dataset: {}, textContent: '' };
const fakeCapabilityStatus = { textContent: '' };
const fakeCapabilityDetails = { textContent: '' };
queueUi.renderCapabilityPanel(fakeCapabilityPanel, fakeCapabilityStatus, fakeCapabilityDetails, {
  hostReady: true,
  ytDLP: { available: false, detail: 'yt-dlp missing' },
  models: { parakeet: { available: true, detail: 'ready' }, cohere: { available: false, detail: 'vocabulary or k_cache_0 missing' } }
}, null, (key) => key);
assert.equal(fakeCapabilityPanel.hidden, false);
assert.equal(fakeCapabilityPanel.dataset.state, 'queue_capability_partial');
assert.equal(fakeCapabilityStatus.textContent, 'queue_capability_partial');
assert.match(fakeCapabilityDetails.textContent, /queue_capability_ytdlp/);
assert.match(fakeCapabilityDetails.textContent, /queue_capability_cohere/);
const fakeFailureCard = { textContent: '' };
queueUi.renderFailureCard(fakeFailureCard, { errorCode: 'MEDIA_DOWNLOAD_FAILED', errorHint: '<b>bad</b> https://host.invalid/?token=x', retriable: false }, (key) => key);
assert.equal(/<|https?:\/\/|token=/.test(fakeFailureCard.textContent), false, 'failed-card renderer must use safe text output');
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  queueUiContext.BSE.I18n.setLocale(locale);
  for (const key of queueUi.requiredI18nKeys()) {
    assert.notEqual(queueUiContext.BSE.I18n.t(key), key, `${locale} must define ${key}`);
  }
}
const taskFiveSidepanelSource = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.js'), 'utf8');
const taskFiveSidepanelHtml = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
assert.match(taskFiveSidepanelSource, /BSE_NATIVE_CAPABILITIES/, 'capability diagnostics must go through the Service Worker proxy');
assert.match(taskFiveSidepanelSource, /(?:sourceLanguage\s*,|sourceLanguage:\s*sourceLanguage)/, 'batch enqueue must forward the exact selected source language');
assert.match(taskFiveSidepanelSource, /queue-source-language/, 'queue batch input must expose a source-language control');
assert.ok(
  taskFiveSidepanelHtml.indexOf('../core/language-routing.js') < taskFiveSidepanelHtml.indexOf('../core/queue-ui.js')
    && taskFiveSidepanelHtml.indexOf('../core/queue-ui.js') < taskFiveSidepanelHtml.indexOf('sidepanel.js'),
  'sidepanel must load deterministic routing and safe UI helpers before its controller'
);
assert.match(taskFiveSidepanelSource, /queue-source-engine/, 'completed cards must render their platform or native engine source');
assert.match(taskFiveSidepanelSource, /queue-failure-detail/, 'failed cards must render stable safe failure details');

// AsrPolisher unit tests
assert.ok(BSE.AsrPolisher, 'AsrPolisher module must exist');
const testCues = [{ from: 0, to: 2, content: 'We use Quen and yTch' }, { from: 2, to: 4, content: 'and codecs tool.' }];
const testPrompt = BSE.AsrPolisher.buildPolishingPrompt('Hugging Face Journal Club', testCues);
assert.match(testPrompt, /Hugging Face Journal Club/);
assert.match(testPrompt, /\[1\] We use Quen and yTch/);

const aligned = BSE.AsrPolisher.alignPolishedCues(
  testCues,
  '[1] We use Qwen and PyTorch\n[2] and Codex tool.'
);
assert.equal(aligned.length, 2);
assert.equal(aligned[0].content, 'We use Qwen and PyTorch');
assert.equal(aligned[1].content, 'and Codex tool.');

const dynamicAiPrompt = BSE.Formatters.generateAiPrompt('polish', [{ from: 0, to: 1, content: 'test' }], false, { title: 'AI 论文研读' });
assert.match(dynamicAiPrompt, /AI 论文研读/);

BSE.NativeHost = originalNativeHost;
console.log('✅ 单元测试全部通过：JSZip 打包、AI 提示词生成、合集/多P Merged Markdown、自然段落切分、逐P独立勾选架构、多行自适应配置、TypeScript 渐进式类型体系、批量导出容灾与容错降级机制、B站 DASH 独立音频直链提取、BPX 播放器选集 DOM 探测与全场景活动页支持、UP主/合集订阅追踪系统 (MD5/WBI/RSS XML/Alarms/Storage/ImportExport)、后台无人值守字幕抓取与一键 Markdown 字幕、本地 ASR 回退、受限媒体描述符与进度租约、端侧大模型 ASR 吞音语义纠错与时间轴回填。');
