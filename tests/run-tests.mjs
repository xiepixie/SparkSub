import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { runOrchestratorTests } from './orchestrator-tests.mjs';

await import('./diagnostics-tests.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await runOrchestratorTests();
let mockFetch = async () => { throw new Error('Unexpected network request in test'); };
const sessionStore = new Map();
const storageAreas = { local: new Map(), sync: new Map() };
const storageWriteHistory = [];
const storageReadHistory = [];
const createStorageArea = (area) => ({
  get: async (key) => {
    storageReadHistory.push({ area, key: structuredClone(key) });
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

let mockAiFetchHandler = null;

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
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
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
        if (msg.type === 'BSE_FETCH_LOCAL_LLM' || msg.type === 'BSE_AI_FETCH') {
          if (mockAiFetchHandler) {
            return mockAiFetchHandler(msg);
          }
          throw new Error('Native fetch fallback');
        }
        return { success: true, status: 200, text: '{}' };
      }
    }
  },
  document: {
    compatMode: 'CSS1Compat',
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
  'core/diagnostics.js',
  'core/native-host.js',
  'core/utils.js',
  'core/jszip.js',
  'core/i18n.js',
  'core/parsers.js',
  'core/media.js',
  'core/media-context.js',
  'core/visual-state-detector.js',
  'core/katex.min.js',
  'core/formatters.js',
  'core/batch-export.js',
  'core/ai-note-cache.js',
  'core/asr-polisher.js',
  'core/tracker.js',
  'core/language-routing.js',
  'core/queue.js',
  'platform/bilibili.js',
  'platform/youtube.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const { BSE } = context;

const originalLocation = { ...context.location };
context.location.href = 'https://www.bilibili.com/video/BV1rPtQegEtk/?spm_id_from=333.788.videopod.sections';
context.location.origin = 'https://www.bilibili.com';
context.location.hostname = 'www.bilibili.com';
assert.equal(
  BSE.Utils.rememberBilibiliMediaIdentity({ bvid: 'BV1rPtQegEtk', cid: 25955336526, page: 1, pageCount: 1 }),
  'bili:BV1rPtQegEtk:cid25955336526',
  '单P视频即使 DOM 没有活跃分P节点，也应接受 view API 已证明的精确 BVID+CID'
);
assert.equal(
  BSE.Utils.getMediaKey(BSE.PLATFORM.BILIBILI, context.location.href),
  'bili:BV1rPtQegEtk:cid25955336526',
  '权威 metadata 回灌后当前页面 mediaKey 不应继续卡在粗粒度 p1'
);

const originalBiliIdentitySendMessage = context.chrome.runtime.sendMessage;
context.location.href = 'https://www.bilibili.com/video/BV1NoSub0001/?spm_id_from=333.788.videopod.sections';
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg?.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/x/web-interface/view')) {
    return {
      success: true,
      ok: true,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      text: JSON.stringify({
        code: 0,
        data: {
          bvid: 'BV1NoSub0001',
          aid: 13579,
          cid: 24680,
          title: '单P无字幕回归测试',
          pages: [{ page: 1, cid: 24680, part: '正片', duration: 120 }]
        }
      })
    };
  }
  if (msg?.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/x/player/wbi/v2')) {
    return {
      success: true,
      ok: true,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      text: JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } })
    };
  }
  return originalBiliIdentitySendMessage(msg);
};
const noSubtitleTracks = await BSE.Bilibili.discoverTracks();
assert.deepEqual(Array.from(noSubtitleTracks), [], '平台确实无字幕时 discoverTracks 应正常返回空数组，而不是把无字幕误判成接口错误');
assert.equal(
  BSE.Utils.getMediaKey(BSE.PLATFORM.BILIBILI, context.location.href),
  'bili:BV1NoSub0001:cid24680',
  '单P无字幕视频也必须在字幕发现结束后留下精确 CID，供 local-asr 直接入队'
);

// BPX DOM 只允许提供已由 view topology 验证的活跃 CID；字幕轨道统一走
// authoritative WBI/兼容 player path，避免两个 player 来源为同一媒体给出不同 subtitle_url。
context.location.href = 'https://www.bilibili.com/video/BV12SY26cELW';
BSE.Utils.rememberBilibiliMediaIdentity({ bvid: 'BV12SY26cELW', cid: 41795717836, page: 1, pageCount: 1 });
let wrongSubtitleBodyRequests = 0;
let bpxPlayerRequests = 0;
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg?.type !== 'BSE_FETCH_BILIBILI_RESOURCE') return originalBiliIdentitySendMessage(msg);
  if (msg.url.includes('/x/web-interface/view')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV12SY26cELW', aid: 117253060168770, cid: 41795717836, duration: 192,
        pages: [{ page: 1, cid: 41795717836, duration: 192, part: 'TCP' }]
      } })
    };
  }
  if (msg.url.includes('/x/player/v2?cid=')) {
    bpxPlayerRequests++;
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV1WRONGVIDEO', cid: 999999,
        subtitle: { subtitles: [{ id: 1, lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/wrong.json' }] }
      } })
    };
  }
  if (msg.url.includes('/x/player/wbi/v2')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV12SY26cELW', cid: 41795717836,
        subtitle: { subtitles: [{ id_str: 'correct-track', lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/correct.json' }] }
      } })
    };
  }
  if (msg.url.includes('/correct.json')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ body: [{ from: 0, to: 3, content: '当前视频字幕' }, { from: 188, to: 191, content: '当前视频结尾' }] })
    };
  }
  if (msg.url.includes('/wrong.json')) {
    wrongSubtitleBodyRequests++;
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ body: [{ from: 0, to: 400, content: '其他视频字幕' }] })
    };
  }
  return originalBiliIdentitySendMessage(msg);
};
const guardedTracks = await BSE.Bilibili.discoverTracks();
assert.equal(guardedTracks.length, 1, 'BPX CID 定位后必须只由 authoritative WBI path 返回字幕轨道');
assert.equal(bpxPlayerRequests, 0, 'BPX 不应再发起第二套 player 字幕轨道请求');
assert.equal(guardedTracks[0].id, 'correct-track');
assert.equal(String(guardedTracks[0].cid), '41795717836', '轨道必须携带经过播放器响应验证的 authoritative CID');
const guardedCues = await BSE.Bilibili.loadTrack(guardedTracks[0]);
assert.equal(guardedCues[0].content, '当前视频字幕');
assert.equal(wrongSubtitleBodyRequests, 0, '跨视频 player 响应中的 subtitle_url 绝不能被下载');

// authoritative WBI 自己若返回其他媒体，也必须拒绝该轨道并尝试身份正确的兼容接口。
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg?.type !== 'BSE_FETCH_BILIBILI_RESOURCE') return originalBiliIdentitySendMessage(msg);
  if (msg.url.includes('/x/web-interface/view')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV12SY26cELW', aid: 117253060168770, cid: 41795717836, duration: 192,
        pages: [{ page: 1, cid: 41795717836, duration: 192, part: 'TCP' }]
      } })
    };
  }
  if (msg.url.includes('/x/player/wbi/v2')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV1WRONGVIDEO', cid: 123456,
        subtitle: { subtitles: [{ id_str: 'wrong-track', lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/wrong.json' }] }
      } })
    };
  }
  if (msg.url.includes('/x/player/v2?aid=')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ code: 0, data: {
        bvid: 'BV12SY26cELW', cid: 41795717836,
        subtitle: { subtitles: [{ id_str: 'compat-track', lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/compat.json' }] }
      } })
    };
  }
  return originalBiliIdentitySendMessage(msg);
};
const compatTracksAfterMismatch = await BSE.Bilibili.discoverTracks();
assert.equal(compatTracksAfterMismatch[0]?.id, 'compat-track', 'WBI 返回其他 BVID/CID 时必须拒绝并切换到身份正确的兼容 player');
assert.equal(wrongSubtitleBodyRequests, 0, '被身份 guard 拒绝的 WBI subtitle_url 不得进入正文下载');

// 即使 player 身份字段看起来正确，正文时长明显越过当前视频也不能 commit。
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg?.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/correct.json')) {
    return {
      success: true, ok: true, status: 200, contentType: 'application/json',
      text: JSON.stringify({ body: [{ from: 0, to: 3, content: '伪装正文' }, { from: 468, to: 471, content: '错误视频结尾' }] })
    };
  }
  return originalBiliIdentitySendMessage(msg);
};
await assert.rejects(
  BSE.Bilibili.loadTrack(guardedTracks[0]),
  (error) => error?.code === 'BILI_SUBTITLE_DURATION_MISMATCH',
  '正文超过 authoritative 视频时长时必须在进入 UI/cache 前拦截'
);
context.chrome.runtime.sendMessage = originalBiliIdentitySendMessage;

context.location.href = 'https://www.bilibili.com/video/BV1Ambiguous/?spm_id_from=333.788.videopod.sections';
assert.equal(
  BSE.Utils.rememberBilibiliMediaIdentity({ bvid: 'BV1Ambiguous', cid: 111111, page: 1, pageCount: 2 }),
  null,
  '多P页面没有显式 ?p=N 且 DOM 未证明活跃分P时，默认 P1 不能被当作权威证据'
);
assert.equal(
  BSE.Utils.getMediaKey(BSE.PLATFORM.BILIBILI, context.location.href),
  'bili:BV1Ambiguous:p1',
  '多P身份无法证明时必须继续保持粗粒度页号，不能提前绑定 CID'
);
context.location.href = 'https://www.bilibili.com/video/BV1rPtQegEtk/?p=2';
assert.equal(
  BSE.Utils.rememberBilibiliMediaIdentity({ bvid: 'BV1rPtQegEtk', cid: 25955336526, page: 1, pageCount: 2 }),
  null,
  '显式 P2 页面不得接纳晚到的 P1 CID'
);
Object.assign(context.location, originalLocation);

assert.equal(
  BSE.Utils.getArtifactKey(BSE.PLATFORM.BILIBILI, 'https://www.bilibili.com/video/BV1StableKey?p=2', 'bili:BV1StableKey:cid9988'),
  'bili:BV1StableKey:p2',
  'B站学习产物必须按 BV+分P 形成稳定 artifactKey，不能因运行时拿到 CID 就分裂缓存'
);
assert.equal(
  BSE.Utils.getArtifactKey(BSE.PLATFORM.BILIBILI, 'https://www.bilibili.com/video/BV1StableKey?spm_id_from=333.1007', 'bili:BV1StableKey:cid9988'),
  null,
  'B站 CID 已知但 URL 未证明分P时不得猜成 P1，避免 SPA 切分P瞬间恢复错误学习材料'
);
assert.equal(
  BSE.Utils.getArtifactKey(BSE.PLATFORM.BILIBILI, 'https://www.bilibili.com/video/BV1StableKey?spm_id_from=333.1007', 'bili:BV1StableKey:p1'),
  'bili:BV1StableKey:p1',
  '运行时已经明确 p1 时应稳定映射到 p1 artifactKey'
);
assert.equal(
  BSE.Utils.getArtifactKey(BSE.PLATFORM.YOUTUBE, 'https://www.youtube.com/watch?v=Ewd6CGwaEXY&t=120s&list=PL123', 'yt:Ewd6CGwaEXY'),
  'yt:Ewd6CGwaEXY',
  'YouTube 学习产物只绑定 videoId，不应被时间点或播放列表参数拆成多份'
);

const canonicalFrames = BSE.AiNoteCache.canonicalizeFrames({
  first: { dataUrl: 'data:image/webp;base64,AAAA', timestamp: 12, label: 'first', chapterId: 'C01', expectedSurface: 'diagram', source: 'planned', selection: { fingerprint: [1, 2, 3, 4], visualScore: 0.9 } },
  duplicate: { dataUrl: 'data:image/webp;base64,AAAA', timestamp: 99, label: 'duplicate' },
  second: { dataUrl: 'data:image/png;base64,BBBB', timestamp: 3, label: 'second' },
  invalid: { dataUrl: 'https://example.com/not-inline.png', timestamp: 1 }
});
assert.deepEqual(Array.from(canonicalFrames, (frame) => frame.timestamp), [3, 12], 'AI note frame cache must deduplicate inline frames and keep timestamp order');
const runtimeFrameMap = BSE.AiNoteCache.buildRuntimeImagesMap(canonicalFrames);
assert.equal(runtimeFrameMap['12']?.label, 'first', 'AI note frame cache must expose timestamp aliases for renderer lookup');
assert.equal(runtimeFrameMap['00:12']?.label, 'first', 'AI note frame cache must expose formatted clock aliases for renderer lookup');
assert.equal(canonicalFrames.find((frame) => frame.timestamp === 12)?.selection, undefined, '候选筛选 fingerprint/评分只应存在于运行内存，不应写入长期图片缓存');
assert.equal(canonicalFrames.find((frame) => frame.timestamp === 12)?.source, 'planned', '图片来源属于轻量语义，应保留以便重开后仍能区分用户手动图与自动证据');
assert.equal(canonicalFrames.find((frame) => frame.timestamp === 12)?.chapterId, 'C01', '最终证据图应持久化所属章节，重开后不能只剩裸图片');
assert.equal(canonicalFrames.find((frame) => frame.timestamp === 12)?.expectedSurface, 'diagram', '最终证据图应保留轻量视觉类型语义');
const aiNoteCacheSource = fs.readFileSync(path.join(root, 'core/ai-note-cache.js'), 'utf8');
assert.match(aiNoteCacheSource, /frameSetId[\s\S]+?storage\.set\([\s\S]+?noteKey\(mediaKey\)[\s\S]+?NOTE_INDEX_KEY[\s\S]+?deleteFrameRefs\(previousArtifact\.frameRefs\)/, 'AI Note 缓存应先写版本化图片集，再原子提交 note+索引指针，最后只清理被替换模式的旧图片');
assert.match(aiNoteCacheSource, /catch \(error\)[\s\S]+?deleteFrameRefs\(refs\)/, '缓存元数据提交失败时必须只回滚本次新图片集，旧缓存不可被提前破坏');
assert.match(aiNoteCacheSource, /const batchSize = 2[\s\S]+?frames\.slice\(start, start \+ batchSize\)[\s\S]+?withStore\('readwrite'/, '图文讲义截图写入必须小批量 Base64→Blob→IndexedDB，避免一次性物化所有高清 Blob');
assert.match(aiNoteCacheSource, /saveLocks\.get\(mediaKey\)[\s\S]+?saveCommitted/, '同一 mediaKey 的 AI Note 保存必须串行化，避免两套图片版本交错提交');
assert.match(aiNoteCacheSource, /function scheduleSweep[\s\S]+?setTimeout[\s\S]+?void sweep\(\)/, 'AI Note 保存后的容量回收应合并到后台执行，不得阻塞用户导入、补图或删除后的成功反馈');
assert.doesNotMatch(aiNoteCacheSource, /const saved = await run[\s\S]{0,180}await sweep\(\)/, 'AI Note 保存关键路径不得同步等待完整缓存 sweep');
assert.match(aiNoteCacheSource, /lruTouchMemory[\s\S]+?now - lastTouch >= LRU_TOUCH_INTERVAL_MS/, '连续切换同一视频的学习类型时，LRU touch 应在内存节流，避免每个 type 都跨 storage 读取索引');
assert.match(aiNoteCacheSource, /RECORD_MEMORY_TTL_MS\s*=\s*30 \* 1000[\s\S]+?RECORD_MEMORY_LIMIT\s*=\s*2/, '长笔记 record 热缓存必须短 TTL 且严格限量，避免快速 type 切换重复跨 storage IPC 又不长期占内存');
assert.match(aiNoteCacheSource, /async function listModesMany[\s\S]+?storage\.get\(NOTE_INDEX_KEY\)[\s\S]+?Array\.isArray\(entry\.modes\)/, '学习/复习结果指示器必须批量读取一次轻量索引，不能为了多个缓存别名重复扫描整份多模式 Markdown record');

const multiArtifactMediaKey = 'yt:AIARTIFACT1';
const artifactSourceUrl = 'https://www.youtube.com/watch?v=AIARTIFACT1';
const artifactFixtures = [
  ['course_notes', '图文讲义', '# 图文讲义\n内容 A'],
  ['keypoints', '关键要点', '# 关键要点\n内容 B'],
  ['concept_deep', '概念深解', '# 概念深解\n内容 C'],
  ['summary', '核心速览', '# 核心速览\n内容 D'],
  ['deep_qa', '自测翻卡', '# 自测翻卡\n内容 E'],
  ['error_check', '易错排查', '# 易错排查\n内容 F']
];
for (const [mode, title, markdown] of artifactFixtures) {
  await BSE.AiNoteCache.save({ mediaKey: multiArtifactMediaKey, mode, title, markdown, sourceUrl: artifactSourceUrl, sourceCueFingerprint: 'c2-feedfacecafebeef', imagesMap: {} });
}
for (const [mode, _title, markdown] of artifactFixtures) {
  const cached = await BSE.AiNoteCache.load(multiArtifactMediaKey, mode);
  assert.equal(cached?.markdown, markdown, `AI Note Cache 必须独立恢复 ${mode} 产物`);
  assert.equal(cached?.sourceUrl, artifactSourceUrl, `AI Note Cache 必须保留 ${mode} 产物的来源 URL 作为 provenance，但不能用它替代 mediaKey 主键`);
  assert.equal(cached?.sourceCueFingerprint, 'c2-feedfacecafebeef', `AI Note Cache 必须记录 ${mode} 产物基于哪一版字幕生成，以便校对后只标记过期而不静默伪装为最新`);
}
const cachedArtifactModes = await BSE.AiNoteCache.listModes(multiArtifactMediaKey);
assert.deepEqual(new Set(Array.from(cachedArtifactModes, (entry) => entry.mode)), new Set(artifactFixtures.map(([mode]) => mode)), 'AI Note Cache 必须按六种学习/复习任务独立保留产物');
const aiNoteIndex = storageAreas.local.get('bse_ai_note_index_v2');
const indexedMultiArtifact = aiNoteIndex.find((entry) => entry.mediaKey === multiArtifactMediaKey);
assert.equal(indexedMultiArtifact.modes.length, 6, 'AI Note LRU 索引必须携带轻量 mode 元数据，让任务圆点无需读取六份 Markdown 正文');
assert.equal(Object.prototype.hasOwnProperty.call(indexedMultiArtifact.modes[0], 'markdown'), false, 'mode 索引不得复制 Markdown 正文，只保留 mode/title/updatedAt');
const secondArtifactMediaKey = 'yt:AIARTIFACT2';
await BSE.AiNoteCache.save({ mediaKey: secondArtifactMediaKey, mode: 'summary', title: '另一个视频', markdown: '# B 视频', sourceUrl: 'https://www.youtube.com/watch?v=AIARTIFACT2', imagesMap: {} });
assert.equal((await BSE.AiNoteCache.load(multiArtifactMediaKey, 'summary'))?.markdown, '# 核心速览\n内容 D', '不同 mediaKey 的相同 mode 产物不得串读');
assert.equal((await BSE.AiNoteCache.load(secondArtifactMediaKey, 'summary'))?.markdown, '# B 视频', '第二个视频必须拥有独立的学习产物桶');
const modesByMediaKey = await BSE.AiNoteCache.listModesMany([multiArtifactMediaKey, secondArtifactMediaKey]);
assert.equal(modesByMediaKey[multiArtifactMediaKey]?.length, 6, '批量 mode 查询必须一次返回当前视频全部六种产物摘要');
assert.deepEqual(modesByMediaKey[secondArtifactMediaKey]?.map((entry) => entry.mode), ['summary'], '批量 mode 查询必须保持不同视频的结果桶隔离');
await BSE.AiNoteCache.remove(secondArtifactMediaKey);
await BSE.AiNoteCache.remove(multiArtifactMediaKey);

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
const nativeCapabilitiesV2 = ({
  localASR = true,
  languages = ['en', 'zh'],
  youtubeCaptions = true,
  youtubeRemote = true,
  bilibiliRemote = true
} = {}) => ({
  protocolVersion: 2,
  contract: 'sparkscribe.browser-native/2',
  features: {
    localASR: { available: localASR, supportsAutoLanguage: localASR, languages: localASR ? languages : [] },
    youtubeCaptions: { available: youtubeCaptions, preferences: ['manual-first', 'manual-only', 'ai-first'] },
    remoteMedia: { youtube: youtubeRemote, bilibili: bilibiliRemote },
    cancellation: { available: true },
    chunkedResults: { available: true, maxMessageBytes: (900 * 1024) - 1 }
  }
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
  protocolVersion: 2
});
capabilitiesPort.emitMessage({
  type: 'response',
  requestId: capabilitiesPort.postedMessages[0].requestId,
  ok: true,
  result: nativeCapabilitiesV2()
});
const normalizedCapabilities = await capabilitiesPromise;
assert.equal(normalizedCapabilities.protocolVersion, 2);
assert.equal(normalizedCapabilities.contract, 'sparkscribe.browser-native/2');
assert.equal(normalizedCapabilities.features.localASR.available, true);
assert.deepEqual(await BSE.NativeHost.getCapabilities(), normalizedCapabilities, 'capabilities must use the cached result by default');
assert.equal(capabilitiesPort.postedMessages.length, 1, 'cached capabilities must not send another request');
const pingPromise = BSE.NativeHost.ping();
const pingRequest = capabilitiesPort.postedMessages.at(-1);
assert.equal(pingRequest.type, 'ping');
assert.equal(pingRequest.protocolVersion, 2, 'ping must use the negotiated protocol version');
capabilitiesPort.emitMessage({
  type: 'response', requestId: pingRequest.requestId, ok: true,
  result: { alive: true, protocolVersion: 2, contract: 'sparkscribe.browser-native/2' }
});
assert.equal((await pingPromise).alive, true);
const messagesBeforeForcedRefresh = capabilitiesPort.postedMessages.length;
const refreshedCapabilities = BSE.NativeHost.getCapabilities({ force: true });
assert.equal(capabilitiesPort.postedMessages.length, messagesBeforeForcedRefresh + 1, 'force must bypass the capabilities cache with exactly one fresh capability probe');
const forcedCapabilityRequest = capabilitiesPort.postedMessages.at(-1);
capabilitiesPort.emitMessage({
  type: 'response',
  requestId: forcedCapabilityRequest.requestId,
  ok: true,
  result: nativeCapabilitiesV2({ localASR: false })
});
const refreshedCapabilityValue = await refreshedCapabilities;
assert.equal(refreshedCapabilityValue.features.localASR.available, false);
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(capabilitiesPort.disconnected, true, 'an idle Native Messaging port must close so it does not keep the Service Worker and Swift host alive');
const portsBeforeCachedRead = nativePorts.length;
assert.deepEqual(await BSE.NativeHost.getCapabilities(), refreshedCapabilityValue, 'idle disconnect must preserve the last capability snapshot');
assert.equal(nativePorts.length, portsBeforeCachedRead, 'reading cached capabilities after idle disconnect must not relaunch the native host');

resetNativeHost();
const legacyCapabilitiesPromise = BSE.NativeHost.getCapabilities({ force: true });
const legacyCapabilityPort = nativeTestPort();
const v2Probe = legacyCapabilityPort.postedMessages[0];
assert.equal(v2Probe.protocolVersion, 2, 'protocol negotiation must try v2 first');
legacyCapabilityPort.emitMessage({
  type: 'response',
  requestId: v2Probe.requestId,
  ok: false,
  error: { code: 'PROTOCOL_MISMATCH', message: 'v1 only', hint: 'retry with v1', retriable: false }
});
await Promise.resolve();
const v1Probe = legacyCapabilityPort.postedMessages[1];
assert.equal(v1Probe.protocolVersion, 1, 'an explicit protocol mismatch may fall back to v1 exactly once');
legacyCapabilityPort.emitMessage({
  type: 'response',
  requestId: v1Probe.requestId,
  ok: true,
  result: {
    protocolVersion: 1,
    hostReady: true,
    ytDLP: { available: true, detail: 'verified' },
    models: { parakeet: { available: true }, cohere: { available: false } }
  }
});
const normalizedLegacyCapabilities = await legacyCapabilitiesPromise;
assert.equal(normalizedLegacyCapabilities.protocolVersion, 1);
assert.equal(normalizedLegacyCapabilities.contract, null);
assert.equal(normalizedLegacyCapabilities.features.localASR.available, true);
assert.ok(normalizedLegacyCapabilities.features.localASR.languages.includes('en'));
assert.equal(normalizedLegacyCapabilities.features.localASR.languages.includes('zh'), false);
assert.equal(normalizedLegacyCapabilities.features.youtubeCaptions.available, true);
const legacyContextTranscription = BSE.NativeHost.transcribe({
  ...nativeYouTubePayload('job-legacy-context'),
  mediaKey: 'yt:Ewd6CGwaEXY',
  asrContext: { topic: 'English fluency', terms: ['pronunciation', 'fluency'] }
});
const legacyContextRequest = legacyCapabilityPort.postedMessages.at(-1);
assert.equal(legacyContextRequest.protocolVersion, 1);
assert.equal(legacyContextRequest.asrContext, undefined, 'v1 fallback must strip the v2-only ASR context field');
assert.equal(legacyContextRequest.mediaKey, undefined, 'v1 fallback must strip the v2-only media identity field');
legacyCapabilityPort.emitMessage({ type: 'resultBegin', requestId: legacyContextRequest.requestId, jobId: 'job-legacy-context', totalChunks: 1 });
legacyCapabilityPort.emitMessage({ type: 'resultChunk', requestId: legacyContextRequest.requestId, jobId: 'job-legacy-context', sequence: 0, totalChunks: 1, cues: [{ from: 0, to: 1, content: 'legacy' }] });
legacyCapabilityPort.emitMessage({ type: 'resultEnd', requestId: legacyContextRequest.requestId, jobId: 'job-legacy-context', totalChunks: 1, cueCount: 1 });
await legacyContextTranscription;

resetNativeHost();
const malformedV2Capabilities = BSE.NativeHost.getCapabilities({ force: true });
const malformedV2Port = nativeTestPort();
const malformedV2Request = malformedV2Port.postedMessages[0];
malformedV2Port.emitMessage({
  type: 'response', requestId: malformedV2Request.requestId, ok: true,
  result: { ...nativeCapabilitiesV2(), contract: 'wrong.contract/2' }
});
await assert.rejects(malformedV2Capabilities, expectNormalizedNativeError('RESULT_INCOMPLETE'), 'v2 capabilities must carry the exact contract identifier');

resetNativeHost();
const firstCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const secondCapabilities = BSE.NativeHost.getCapabilities({ force: true });
const concurrentPort = nativeTestPort();
const [firstRequest, secondRequest] = concurrentPort.postedMessages;
assert.notEqual(firstRequest.requestId, secondRequest.requestId, 'concurrent requests need distinct request IDs');
concurrentPort.emitMessage({ type: 'response', requestId: secondRequest.requestId, ok: true, result: nativeCapabilitiesV2({ languages: ['zh'] }) });
concurrentPort.emitMessage({ type: 'response', requestId: firstRequest.requestId, ok: true, result: nativeCapabilitiesV2({ languages: ['en'] }) });
assert.deepEqual(Array.from((await firstCapabilities).features.localASR.languages), ['en']);
assert.deepEqual(Array.from((await secondCapabilities).features.localASR.languages), ['zh']);

resetNativeHost();
const firstProgress = [];
const secondProgress = [];
const contextualTranscription = BSE.NativeHost.transcribe({
  ...nativeYouTubePayload('job-context'),
  mediaKey: 'yt:Ewd6CGwaEXY',
  asrContext: {
    topic: '4 Language Habits That Get You Fluent FAST',
    terms: ['English', 'fluency', 'pronunciation', 'fluency']
  }
});
const contextualPort = nativeTestPort();
const contextualRequest = contextualPort.postedMessages.at(-1);
assert.equal(contextualRequest.mediaKey, 'yt:Ewd6CGwaEXY');
assert.deepEqual(contextualRequest.asrContext, {
  topic: '4 Language Habits That Get You Fluent FAST',
  terms: ['English', 'fluency', 'pronunciation']
}, 'v2 transcription should send only bounded factual ASR context');
contextualPort.emitMessage({ type: 'resultBegin', requestId: contextualRequest.requestId, jobId: 'job-context', totalChunks: 1 });
contextualPort.emitMessage({ type: 'resultChunk', requestId: contextualRequest.requestId, jobId: 'job-context', sequence: 0, totalChunks: 1, cues: [{ from: 0, to: 1, content: 'context' }] });
contextualPort.emitMessage({ type: 'resultEnd', requestId: contextualRequest.requestId, jobId: 'job-context', totalChunks: 1, cueCount: 1 });
await contextualTranscription;

resetNativeHost();
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
assert.deepEqual(structuredClone(await assembledResult), {
  cues: [
    { from: 0, to: 1, content: 'first' },
    { from: 2, to: 3, content: 'second' }
  ]
});

resetNativeHost();
const backgroundCaptionResult = BSE.NativeHost.fetchYouTubeCaptions({
  jobId: 'job-youtube-captions',
  sourceLanguage: 'yue',
  subtitlePreference: 'ai-first',
  source: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=Ewd6CGwaEXY' }
});
const backgroundCaptionPort = nativeTestPort();
const backgroundCaptionRequest = backgroundCaptionPort.postedMessages[0];
assert.deepEqual(backgroundCaptionRequest, {
  type: 'youtubeCaptions',
  requestId: backgroundCaptionRequest.requestId,
  protocolVersion: 2,
  jobId: 'job-youtube-captions',
  sourceLanguage: 'yue',
  subtitlePreference: 'ai-first',
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
  message.type === 'cancel' && message.jobId === 'job-cancelled' && message.protocolVersion === 2
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
  ['non-finite duration', { ...nativeYouTubePayload('job-duration'), duration: Infinity }],
  ['invalid media identity', { ...nativeYouTubePayload('job-media-key'), mediaKey: 'x'.repeat(161) }]
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
  protocolVersion: 2,
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
assert.deepEqual(structuredClone(await longTranscription), { cues: [{ from: 0, to: 2, content: 'watchdog result' }] });
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
assert.equal(timeoutCancels[0].protocolVersion, 2);
assertOnlyIdleNativeTimer('timed out transcription must clear its watchdog without adding a tracked cancel timer');

context.setTimeout = originalNativeSetTimeout;
context.clearTimeout = originalNativeClearTimeout;
resetNativeHost();

// 1. I18n Tests
assert.equal(BSE.I18n.t('follow'), '跟随');
BSE.I18n.setLocale('en');
assert.equal(BSE.I18n.t('follow'), 'Follow');
assert.equal(BSE.I18n.t('ai_settings_shared_connection'), 'Shared connection');
assert.equal(BSE.I18n.t('tab_tracker'), 'Tracker Center');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), 'All (4)');
BSE.I18n.setLocale('zh-TW');
assert.equal(BSE.I18n.t('tab_tracker'), '追蹤更新');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), '全部 (4)');
BSE.I18n.setLocale('zh-CN');
assert.equal(BSE.I18n.t('tab_tracker'), '追踪更新');
assert.equal(BSE.I18n.formatTimeSpan(159), '2分39秒');
BSE.I18n.setLocale('auto');
assert.equal(BSE.I18n.getLocalePreference(), 'auto', '自动语言必须保留为用户偏好，而不是被解析后的系统语言覆盖');
BSE.I18n.setLocale('zh-CN');
assert.equal(BSE.I18n.getLocalePreference(), 'zh-CN', '显式语言偏好必须可查询并保持一致');
assert.equal(BSE.I18n.t('theme_auto'), '自动（跟随系统）', '自动主题文案必须明确其真实行为');
assert.equal(BSE.I18n.t('tracker_setting_notify_on'), '桌面通知与角标', '提醒设置必须准确表达通知与角标同时启用');

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

// 3. External subtitle polishing prompt
const subtitleFingerprint = BSE.Utils.subtitleFingerprint(jsonCues);
assert.equal(subtitleFingerprint, BSE.Utils.subtitleFingerprint(jsonCues.map((cue) => ({ ...cue }))), '相同 cue 内容和时间轴必须得到稳定字幕指纹');
assert.notEqual(subtitleFingerprint, BSE.Utils.subtitleFingerprint(jsonCues.map((cue, index) => index === 0 ? { ...cue, content: `${cue.content}修正` } : cue)), '字幕文本变化必须改变字幕指纹');
const subtitlePatchToken = BSE.Utils.buildSubtitlePatchToken('yt:Proofread01', 'track-zh', jsonCues);
assert.match(subtitlePatchToken, /^SPC1-[0-9a-f]{16}$/i, '校对任务必须生成紧凑稳定的任务标识');
assert.notEqual(subtitlePatchToken, BSE.Utils.buildSubtitlePatchToken('yt:Proofread02', 'track-zh', jsonCues), '不同视频不得共享校对任务标识');
assert.notEqual(subtitlePatchToken, BSE.Utils.buildSubtitlePatchToken('yt:Proofread01', 'track-en', jsonCues), '不同字幕轨道不得共享校对任务标识');

const subtitlePolishPrompt = BSE.Formatters.generateSubtitlePolishPrompt(jsonCues, false, { title: '测试视频', taskToken: subtitlePatchToken });
assert.match(subtitlePolishPrompt, /保守校对|测试视频/);
assert.match(subtitlePolishPrompt, new RegExp(`SPARKSUB_PATCH\\s+${subtitlePatchToken}`), '外部校对任务必须要求原样回显当前视频/轨道/字幕版本标识');
assert.match(subtitlePolishPrompt, /L0001 \| 第一句/);
assert.match(subtitlePolishPrompt, /只输出真正需要修改的行|NO_CHANGES/, '外部字幕校对应使用稀疏 patch 协议，避免重新返回整份字幕');
assert.doesNotMatch(subtitlePolishPrompt, /00:01\s*\|/, '普通校对任务已有行号锚点，不应再携带冗余时间戳');

const timestampedPolishPrompt = BSE.Formatters.generateSubtitlePolishPrompt(jsonCues, true, { title: '测试视频' });
assert.match(timestampedPolishPrompt, /L0001 \| 00:01 \| 第一句/);
assert.doesNotMatch(timestampedPolishPrompt, /\[00:01\]/, '需要诊断时间时也应保持行号与时间列分离，不使用方括号时间标签');

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
assert.match(mergedMd, /001\. 课程介绍/, '合并 Markdown 应只保留一层稳定序号，避免源标题编号重复');
const mergedText = BSE.Formatters.toMergedText(mockTree, mockResults, { success: 1, total: 1 });
assert.match(mergedText, /^测试课程合集/m, '复制模式必须生成不依赖 Markdown 语法的合并纯文本');
assert.match(mergedText, /001\. 课程介绍/, '合并纯文本必须保留条目序号与标题');
assert.doesNotMatch(mergedText, /^#{1,3}\s/m, '复制模式不应把 Markdown 标题标记带进剪贴板');

const chineseParagraphCues = [
  { from: 0, to: 2, content: '大家好' },
  { from: 2.1, to: 5, content: '今天跟大家分享如何使用大模型辅助科研' },
  { from: 5.1, to: 8, content: '首先我们需要明确自己的研究问题和任务边界' },
  { from: 10.2, to: 13, content: '接下来再讨论如何组织提示词和输出要求' },
  { from: 13.1, to: 16, content: '这样生成结果会更容易检查和复用' }
];
const readableChineseParagraphs = BSE.Formatters.mergeParagraphs(chineseParagraphCues);
assert.doesNotMatch(readableChineseParagraphs, /大家好 今天/, '中文相邻字幕不得由导出器人为插入西文空格');
assert.match(readableChineseParagraphs, /^大家好\n今天跟大家分享/m, '中文 cue 边界应保留为轻量换行，避免去空格后把相邻短语直接粘死');
assert.match(readableChineseParagraphs, /任务边界\n\n接下来/, '明显停顿应优先成为自然段边界，而不是只按字符数硬切');

const sharedSelectionTree = {
  ...mockTree,
  currentBvid: 'BV1A',
  currentPage: 2,
  items: [
    { globalIndex: 1, bvid: 'BV1A', page: 1, sectionKey: 's1' },
    { globalIndex: 2, bvid: 'BV1A', page: 2, sectionKey: 's1' },
    { globalIndex: 3, bvid: 'BV1B', page: 1, sectionKey: 's2' }
  ]
};
assert.deepEqual(
  Array.from(BSE.BatchExport.selectItems(sharedSelectionTree, { scope: 'current-page' }), (item) => item.globalIndex),
  [2],
  '共享 BatchExport Module 必须统一 current-page 选择语义'
);
assert.deepEqual(
  Array.from(BSE.BatchExport.selectItems(sharedSelectionTree, { scope: 'range', rangeStart: 3, rangeEnd: 2 }), (item) => item.globalIndex),
  [2, 3],
  '共享 BatchExport Module 必须统一正向/反向区间选择语义'
);

const youtubeMergedTree = { title: 'YouTube Test', kind: 'youtube_playlist', sections: [{ key: 'section_0', title: 'Playlist' }] };
const youtubeMergedResults = [{
  status: 'success',
  item: { globalIndex: 1, sectionKey: 'section_0', sectionTitle: 'Playlist', title: 'English Lesson', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  track: { label: 'English', language: 'en', lan: 'en', isAI: true },
  body: [{ from: 0, to: 1, content: 'Hello world' }]
}];
const youtubeMergedMd = BSE.Formatters.toMergedMarkdown(youtubeMergedTree, youtubeMergedResults, { total: 1, success: 1, noSub: 0, failed: 0 });
assert.match(youtubeMergedMd, /字幕类型：English/, 'YouTube 合并 Markdown 必须保留真实轨道语言，不能回退成中文');
const youtubeManifest = BSE.Formatters.buildBatchManifest(youtubeMergedTree, youtubeMergedResults.map((r) => r.item), youtubeMergedResults, { total: 1, success: 1 }, { outputMode: 'copy-text' });
assert.equal(youtubeManifest.items[0].subtitle.lan, 'en', '批量 Manifest 必须保留 YouTube 语言代码');
assert.equal(youtubeManifest.items[0].subtitle.lan_doc, 'English', '批量 Manifest 必须保留 YouTube 语言标签');
assert.equal(youtubeManifest.items[0].subtitle.isAI, true, '批量 Manifest 必须保留 YouTube 自动字幕类型');

// 5. JSZip Tests
const zip = new BSE.JSZip();
zip.file('test.txt', 'Hello Subtitle Extension');
const folder = zip.folder('episodes');
folder.file('01.srt', BSE.Formatters.toSrt(jsonCues));
const blob = await zip.generateAsync({ type: 'blob' });
assert.ok(blob, 'JSZip 应当成功生成压缩包 Blob');
assert.ok(blob.size > 100, 'JSZip 生成的 Blob 大小应当有效');

// Screenshot export stores canvas data URLs as base64. The ZIP entry must contain
// decoded image bytes, not the ASCII base64 payload with a misleading .webp suffix.
const webpHeaderBase64 = Buffer.from('RIFF1234WEBP', 'binary').toString('base64');
const imageZip = new BSE.JSZip();
imageZip.file('frame.webp', webpHeaderBase64, { base64: true });
const imageEntry = imageZip.file('frame.webp');
assert.ok(imageEntry, 'JSZip 应当能读取刚写入的截图条目');
assert.equal(Buffer.from(imageEntry.data).toString('binary'), 'RIFF1234WEBP', 'base64 截图必须先解码为真实二进制后再写入 ZIP');
assert.notEqual(Buffer.from(imageEntry.data).toString('ascii'), webpHeaderBase64, 'ZIP 内不得把 base64 文本伪装成 .webp 图片');

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

// 6b. UnifiedSubtitleCache 全局统一字幕持久化缓存测试
await BSE.Utils.UnifiedSubtitleCache.set('bili:BV1TestUnifiedCache:p1', {
  title: '统一缓存测试',
  author: '测试UP主',
  trackId: 'track-zh',
  trackSource: 'platform',
  language: 'zh',
  langDoc: '中文',
  cues: [
    { from: 0.0, to: 2.5, content: '第一句统一缓存字幕' },
    { from: 2.5, to: 5.0, content: '第二句统一缓存字幕' }
  ]
});
const unifiedLoaded = await BSE.Utils.UnifiedSubtitleCache.get('bili:BV1TestUnifiedCache:p1');
assert.ok(unifiedLoaded, '统一字幕缓存必须成功写入并读取');
assert.equal(unifiedLoaded.cues.length, 2, '统一字幕缓存必须保留完整 cues 数组');
assert.equal(unifiedLoaded.title, '统一缓存测试', '统一字幕缓存必须保留视频元数据');
assert.equal(unifiedLoaded.trackId, 'track-zh', '统一字幕缓存必须记录当前正文属于哪条字幕轨道，防止跨轨道复用');
assert.match(unifiedLoaded.plainText, /第一句统一缓存字幕.*第二句统一缓存字幕/, '读取时应从 cues 按需恢复纯文本投影');
const unifiedCueOnly = await BSE.Utils.UnifiedSubtitleCache.get('bili:BV1TestUnifiedCache:p1', { includePlainText: false });
assert.equal(unifiedCueOnly.plainText, '', '内容页只需要 cues 时不得额外拼接一份长 plainText，避免大字幕重复分配内存');

// 同一运行上下文中的字幕缓存 mutation 必须按调用顺序提交。否则慢结束的旧刷新
// 可以覆盖后发的新刷新，同时共享 index 也会发生 read-modify-write 丢更新。
const raceMediaKey = 'bili:BV1CacheRace:p1';
const raceStorageKey = `bse_sub_cache_${raceMediaKey}`;
const originalUnifiedStorageSet = context.chrome.storage.local.set;
let releaseFirstUnifiedWrite;
let firstUnifiedWriteStartedResolve;
const firstUnifiedWriteStarted = new Promise((resolve) => { firstUnifiedWriteStartedResolve = resolve; });
const firstUnifiedWriteGate = new Promise((resolve) => { releaseFirstUnifiedWrite = resolve; });
let raceBodyWriteCalls = 0;
context.chrome.storage.local.set = async (values) => {
  if (values && Object.prototype.hasOwnProperty.call(values, raceStorageKey)) {
    raceBodyWriteCalls++;
    if (raceBodyWriteCalls === 1) {
      firstUnifiedWriteStartedResolve();
      await firstUnifiedWriteGate;
    }
  }
  return originalUnifiedStorageSet(values);
};
const oldCacheWrite = BSE.Utils.UnifiedSubtitleCache.set(raceMediaKey, {
  trackId: 'zh-main', cues: [{ from: 0, to: 1, content: '旧刷新正文' }]
});
await firstUnifiedWriteStarted;
const newCacheWrite = BSE.Utils.UnifiedSubtitleCache.set(raceMediaKey, {
  trackId: 'zh-main', cues: [{ from: 0, to: 1, content: '新刷新正文' }]
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(raceBodyWriteCalls, 1, '旧 cache write 未完成时，后发刷新不得并发进入共享 index 的 read-modify-write');
releaseFirstUnifiedWrite();
await Promise.all([oldCacheWrite, newCacheWrite]);
context.chrome.storage.local.set = originalUnifiedStorageSet;
const racedCache = await BSE.Utils.UnifiedSubtitleCache.get(raceMediaKey, { includePlainText: false });
assert.equal(racedCache?.cues?.[0]?.content, '新刷新正文', '缓存最终内容必须服从刷新调用顺序，不能由网络完成先后决定');
const persistedUnifiedRecord = storageAreas.local.get('bse_sub_cache_bili:BV1TestUnifiedCache:p1');
assert.equal(persistedUnifiedRecord.plainText, '', '有规范 cues 时不得在持久层重复保存一份可派生 plainText');

const correctionMediaKey = 'bili:BV1CorrectionCache:p1';
const correctionBaseCues = [
  { from: 0, to: 2, content: '我们使用米尔沃斯做向量检索' },
  { from: 2, to: 4, content: '然后使用h n s w索引' }
];
await BSE.Utils.UnifiedSubtitleCache.set(correctionMediaKey, {
  title: '校对缓存测试',
  trackId: 'zh-main',
  trackSource: 'platform',
  language: 'zh',
  cues: correctionBaseCues
});
const correctionBodyKey = `bse_sub_cache_${correctionMediaKey}`;
const correctionOverlayKey = `bse_sub_corrections_${correctionMediaKey}`;
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
const correctionSaved = await BSE.Utils.UnifiedSubtitleCache.recordCorrections(
  correctionMediaKey,
  'zh-main',
  correctionBaseCues,
  [
    { index: 0, content: '我们使用 Milvus 做向量检索' },
    { index: 1, content: '然后使用 HNSW 索引' }
  ],
  { trackId: 'zh-main', trackSource: 'platform', language: 'zh', cues: [
    { ...correctionBaseCues[0], content: '我们使用 Milvus 做向量检索' },
    { ...correctionBaseCues[1], content: '然后使用 HNSW 索引' }
  ] }
);
assert.equal(correctionSaved, true, '显式字幕校对必须先把小型 correction overlay 持久化');
assert.equal(storageReadHistory.some((entry) => Array.isArray(entry.key) && entry.key.includes(correctionBodyKey)), false, '新 schema 下保存 sparse correction 不得先读取完整字幕正文');
assert.equal(storageWriteHistory.some((write) => correctionBodyKey in write), false, '只改少量字幕文本时不得重写完整正文缓存');
assert.ok(storageWriteHistory.some((write) => correctionOverlayKey in write), '校对持久化只应写独立 sparse correction record');
assert.equal(storageAreas.local.get(correctionBodyKey)?.corrections, undefined, '新版正文 record 不应继续内嵌 correction overlay');
assert.equal(Array.isArray(storageAreas.local.get(correctionOverlayKey)?.cues), false, '独立 correction record 不得复制完整 cues 时间轴');
assert.equal(storageAreas.local.get(correctionOverlayKey)?.corrections?.['zh-main']?.patches.length, 2, '独立 correction record 只保存变化行');
const correctedCacheRecord = await BSE.Utils.UnifiedSubtitleCache.get(correctionMediaKey);
assert.equal(correctedCacheRecord?.cues[0].content, '我们使用 Milvus 做向量检索', '统一字幕缓存读取必须自动呈现同轨道校对后的文本');
assert.equal(correctedCacheRecord?.corrections?.['zh-main']?.patches.length, 2, '校对缓存应只保存发生变化的 patch，而不是另存一整份重复时间轴');
const replayedCorrections = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(correctionMediaKey, 'zh-main', correctionBaseCues, correctedCacheRecord);
assert.equal(replayedCorrections.appliedCount, 2, '重新解析得到同一 base cues 后必须复用已有校对 patch，而不是重新做音频/文本对齐');
storageReadHistory.length = 0;
const directOverlayReplay = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(correctionMediaKey, 'zh-main', correctionBaseCues);
assert.equal(directOverlayReplay.appliedCount, 2, '没有 cachedRecord 时也应直接从独立 correction store 重放校对');
assert.equal(storageReadHistory.some((entry) => Array.isArray(entry.key) && entry.key.includes(correctionBodyKey)), false, '新 schema 下重放 correction 只应读取小型 index + overlay，不得读取完整字幕正文');
assert.equal(replayedCorrections.cues[1].content, '然后使用 HNSW 索引');
const upstreamChanged = correctionBaseCues.map((cue, index) => index === 1 ? { ...cue, content: '上游字幕已经修改了这一句' } : { ...cue });
const conflictedCorrections = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(correctionMediaKey, 'zh-main', upstreamChanged, correctedCacheRecord);
assert.equal(conflictedCorrections.appliedCount, 1, '上游原文变化后只能重放仍能证明锚点的校对项');
assert.equal(conflictedCorrections.conflictCount, 1, '原文或时间锚点不再匹配的历史校对必须明确冲突而不是按行号硬贴');
await BSE.Utils.UnifiedSubtitleCache.set(correctionMediaKey, {
  title: '后台重新写入平台字幕',
  trackId: 'zh-main',
  trackSource: 'platform',
  language: 'zh',
  cues: correctionBaseCues
});
const correctedAfterGenericWrite = await BSE.Utils.UnifiedSubtitleCache.get(correctionMediaKey);
assert.equal(correctedAfterGenericWrite?.cues[0].content, '我们使用 Milvus 做向量检索', '后台重新写入同轨道 base cues 后，统一读取仍必须恢复用户已保存的校对文本');
assert.equal(correctedAfterGenericWrite?.corrections?.['zh-main']?.patches.length, 2, '普通缓存刷新不得删除用户 correction overlay');
assert.ok(storageAreas.local.has(correctionOverlayKey), '正文刷新与 correction overlay 生命周期必须解耦');

const legacyCorrectionMediaKey = 'bili:BV1LegacyCorrection:p1';
const legacyCorrectionBodyKey = `bse_sub_cache_${legacyCorrectionMediaKey}`;
const legacyCorrectionOverlayKey = `bse_sub_corrections_${legacyCorrectionMediaKey}`;
const legacyCorrectionBase = [{ from: 0, to: 2, content: '米尔沃斯向量数据库' }];
const legacySavedAt = Date.now();
storageAreas.local.set(legacyCorrectionBodyKey, {
  mediaKey: legacyCorrectionMediaKey,
  title: '旧版校对迁移',
  trackId: 'zh-main',
  trackSource: 'platform',
  language: 'zh',
  langDoc: '中文',
  cues: legacyCorrectionBase,
  cueCount: 1,
  plainText: '',
  markdown: '',
  corrections: {
    'zh-main': {
      trackId: 'zh-main',
      cueCount: 1,
      patches: [{ index: 0, from: 0, to: 2, originalContent: '米尔沃斯向量数据库', content: 'Milvus 向量数据库' }],
      updatedAt: legacySavedAt
    }
  },
  savedAt: legacySavedAt
});
const existingSubtitleIndex = storageAreas.local.get('bse_sub_cache_index') || [];
storageAreas.local.set('bse_sub_cache_index', [
  { key: legacyCorrectionBodyKey, bytes: 512, savedAt: legacySavedAt },
  ...existingSubtitleIndex.filter((entry) => (typeof entry === 'string' ? entry : entry?.key) !== legacyCorrectionBodyKey)
]);
assert.equal(await BSE.Utils.UnifiedSubtitleCache.set(legacyCorrectionMediaKey, {
  title: '旧版校对迁移刷新', trackId: 'zh-main', trackSource: 'platform', language: 'zh', cues: legacyCorrectionBase
}), true, '旧版内嵌 correction 的正文第一次刷新应完成无损迁移');
assert.equal(storageAreas.local.get(legacyCorrectionBodyKey)?.corrections, undefined, '迁移后的正文不应继续重复保存旧 correction');
assert.equal(storageAreas.local.get(legacyCorrectionOverlayKey)?.corrections?.['zh-main']?.patches.length, 1, '旧版内嵌 correction 必须先迁移到独立 overlay key');
assert.equal((await BSE.Utils.UnifiedSubtitleCache.get(legacyCorrectionMediaKey))?.cues?.[0]?.content, 'Milvus 向量数据库', '迁移完成后普通读取仍应自动重放旧校对结果');

const oversizedCacheSaved = await BSE.Utils.UnifiedSubtitleCache.set('bili:BV1OversizedCache:p1', {
  title: '超大缓存拒绝测试',
  cues: [{ from: 0, to: 1, content: 'x'.repeat(1_000_000) }]
});
assert.equal(oversizedCacheSaved, false, '单条字幕缓存因容量上限被跳过时 set() 必须返回 false，不能向校对流程报告假成功');
assert.equal(await BSE.Utils.UnifiedSubtitleCache.get('bili:BV1OversizedCache:p1'), null, '单条字幕缓存超过字节预算时应拒绝持久化，避免长期挤爆 local storage');
const hugeCorrectionMediaKey = 'bili:BV1HugeCorrection:p1';
const hugeCorrectionBase = Array.from({ length: 7000 }, (_, index) => ({
  from: index * 2,
  to: index * 2 + 1.8,
  content: `第${index + 1}句 ${'长字幕正文'.repeat(18)}`
}));
assert.equal(await BSE.Utils.UnifiedSubtitleCache.set(hugeCorrectionMediaKey, {
  title: '超长字幕校对',
  trackId: 'zh-main',
  cues: hugeCorrectionBase
}), false, '超长 base subtitle 可以不进入正文缓存，但不能因此破坏后续 correction overlay');
assert.equal(await BSE.Utils.UnifiedSubtitleCache.recordCorrections(
  hugeCorrectionMediaKey,
  'zh-main',
  hugeCorrectionBase,
  [{ index: 3456, content: '第3457句 Milvus 与 HNSW 专有名词已校正' }],
  { title: '超长字幕校对', trackId: 'zh-main', language: 'zh', cues: hugeCorrectionBase }
), true, '超长字幕只改少量行时必须允许降级保存 correction-only 记录，不能因为 base cues 超限而丢用户修改');
const hugeCorrectionRecord = await BSE.Utils.UnifiedSubtitleCache.get(hugeCorrectionMediaKey, { includePlainText: false, applyCorrections: false });
assert.equal(hugeCorrectionRecord?.cues?.length || 0, 0, 'correction-only 记录不得偷偷持久化超限的完整 base cues');
assert.equal(hugeCorrectionRecord?.corrections?.['zh-main']?.patches.length, 1, 'correction-only 记录只应保存真正发生变化的 sparse patch');
const hugeCorrectionReplay = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(hugeCorrectionMediaKey, 'zh-main', hugeCorrectionBase, hugeCorrectionRecord);
assert.equal(hugeCorrectionReplay.appliedCount, 1, '重新取得超长 base subtitle 后必须能安全重放 correction-only patch');
assert.equal(hugeCorrectionReplay.cues[3456].content, '第3457句 Milvus 与 HNSW 专有名词已校正');
assert.equal(await BSE.Utils.UnifiedSubtitleCache.recordCorrections(
  hugeCorrectionMediaKey,
  'zh-main',
  hugeCorrectionReplay.cues,
  [{ index: 3456, content: hugeCorrectionBase[3456].content }],
  { title: '超长字幕校对', trackId: 'zh-main', language: 'zh', cues: hugeCorrectionReplay.cues }
), true, '超长字幕撤销最后一个 correction 时必须能删除 correction-only 记录，不能因为 base cues 超限而留下幽灵修改');
assert.equal(await BSE.Utils.UnifiedSubtitleCache.get(hugeCorrectionMediaKey, { includePlainText: false, applyCorrections: false }), null, '最后一个 correction 被撤销后，纯 correction 记录必须真正删除');
assert.match(fs.readFileSync(path.join(root, 'core/utils.js'), 'utf8'), /const snapshotSize = serializedByteLength\(snapshot\)[\s\S]+?candidateSizes[\s\S]+?JSON\.stringify\(candidates\)/, 'SessionSnapshot 容量裁剪应复用单项大小预算，避免对长字幕列表反复 JSON.stringify 直到 fit');

// 7. Manifest & File Integrity
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.2.0');
assert.equal(manifest.permissions.includes('offscreen'), false, 'Offscreen executor 已退出运行时架构后不得继续保留无调用方权限');
assert.equal(manifest.permissions.includes('cookies'), false, '项目未使用 chrome.cookies API，不应继续申请 cookies 权限；登录态网络请求只依赖站点 host permission + fetch credentials');
const feedContentScriptEntry = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.length === 1 && entry.js[0] === 'content/feed-injector.js'
));
const videoContentScriptEntry = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.includes('content/app.js')
));
assert.ok(feedContentScriptEntry, '推荐流按钮必须使用独立轻量 content script，不能依赖整套视频运行时');
assert.ok(feedContentScriptEntry.matches.includes('*://*.bilibili.com/*'), '轻量 Feed 注入器应覆盖 B站推荐/搜索/空间等普通页面');
assert.ok(videoContentScriptEntry, 'B站视频页必须存在独立的完整运行时 content script');
assert.ok(videoContentScriptEntry.matches.includes('*://www.bilibili.com/video/*'), 'B站标准视频页必须静态加载完整运行时');
assert.equal(videoContentScriptEntry.matches.includes('*://*.bilibili.com/*'), false, 'B站普通 Feed/搜索/空间页不得无条件解析完整播放器运行时');
assert.equal(videoContentScriptEntry.matches.some((pattern) => pattern.includes('youtube.com')), false, 'YouTube 首页/搜索页不得预加载完整视频运行时；watch/shorts 由轻量 bootstrap 按需注入');
assert.ok(feedContentScriptEntry.matches.some((pattern) => pattern.includes('youtube.com')), 'YouTube 首页与 SPA 必须保留轻量 Feed/bootstrap content script');
assert.equal(manifest.content_scripts.some((entry) => (entry.js || []).includes('content/main-world-bridge.js')), false, 'YouTube MAIN bridge 不应在首页/搜索页静态注入；真实视频路由由 Service Worker 按需加载');
for (const backgroundOnlyModule of ['core/asr-polisher.js', 'core/tracker.js', 'core/queue.js']) {
  assert.equal(videoContentScriptEntry.js.includes(backgroundOnlyModule), false, `视频 content runtime 不得继续加载后台专属模块 ${backgroundOnlyModule}`);
}

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
const diagnosticFunctionSource = contentAppSource.match(/function diagnostic\(stage, message\)[\s\S]*?(?=\n  function classifyError)/)?.[0] || '';
assert.match(diagnosticFunctionSource, /BSE_DIAGNOSTIC_APPEND/, '媒体诊断必须通过轻量增量事件广播');
assert.doesNotMatch(diagnosticFunctionSource, /publish\(true\)/, '媒体诊断热路径不得为了追加日志重新发送整份字幕 state');
assert.doesNotMatch(contentAppSource, /diagnosticPublishTimer/, '媒体诊断不应保留触发 full publish 的旧延迟定时器');
const contentRuntimeMessageSource = contentAppSource.match(/function installRuntimeMessages\(\)[\s\S]*?(?=\n  let mountGeneration)/)?.[0] || '';
assert.doesNotMatch(contentRuntimeMessageSource, /message\?\.type === ['"]BSE_DIAGNOSTIC_APPEND['"]/, '内容页不得重新消费后台 Queue/AI 诊断并回声成 media 日志；诊断应直接到 Side Panel');
assert.match(sidepanelSource, /sourceTabId = message\.tabId \?\? sender\?\.tab\?\.id[\s\S]{0,260}message\.scope === 'media'[\s\S]{0,260}sourceTabId !== activeTabId/, 'Side Panel 必须按发送者 tab 过滤媒体诊断，避免多视频标签页日志串台');
assert.match(contentAppSource, /ad-showing[\s\S]{0,160}return/, 'YouTube 广告时必须暂停正片字幕时间轴同步');
assert.match(contentAppSource, /function stopPlaybackSync\(\)[\s\S]+?clearInterval\(playbackSyncInterval\)[\s\S]+?removeEventListener\('timeupdate'/, '离开视频页必须释放播放同步 interval、旧 video listener 与相关工作集');
assert.match(contentAppSource, /function ensurePlaybackSync\(\)[\s\S]{0,360}!BSE\.Utils\.isMatchingVideoUrl\(location\.href\)[\s\S]{0,240}setInterval\(syncPlaybackVideoElement, 500\)/, '500ms 播放器元素探测只应在真实视频页启动，Feed/搜索页不得常驻轮询');
assert.match(contentAppSource, /state\.cueRevision \+= 1/, '新字幕正文提交时必须提高正文版本');
assert.match(sidepanelSource, /(?:currentKey|cacheBaseKey)[^\n]+cueRevision/, '侧边栏 DOM 缓存键必须识别同数量字幕刷新');
assert.match(rollingPanelSyncSource, /cueRenderKey[^\n]+cueRevision/, '滚动面板 DOM 缓存键必须识别同数量字幕刷新');
assert.doesNotMatch(sidepanelSource, /AUTO_RESUME_DELAY|autoResumeTimer/, '侧边栏不得在用户阅读时自动抢回跟随');
assert.doesNotMatch(rollingPanelSyncSource, /autoResumeDelay|autoResumeTimer/, '滚动面板不得在用户阅读时自动抢回跟随');
assert.match(trackerSyncSource, /if \(checkAllUpdatesPromise\) return checkAllUpdatesPromise/, '追踪中心的手动与定时巡检必须共用进行中任务');
assert.match(trackerSyncSource, /TRACKER_CHECK_CONCURRENCY\s*=\s*3/, '全量巡检应使用受控小并发，而不是串行人工延迟或无界并发');
assert.match(trackerSyncSource, /Promise\.all\(Array\.from\(\{ length: workerCount \}/, '全量巡检必须通过固定 worker pool 合并执行');
assert.match(trackerSyncSource, /updatedSubs\.push\(\{[\s\S]{0,220}title: sub\.title/, '追踪更新结果必须为通知提供订阅源标题');
assert.match(trackerSyncSource, /SUMMARY:\s*'bse_tracker_summary_v1'[\s\S]+?function trackerSummary[\s\S]+?async function getTrackerSummary/, '追踪模块必须维护独立轻量 summary，隐藏 Workspace 不应为导航 badge 读取完整订阅历史');
assert.match(trackerSyncSource, /setStorageItems\(\{[\s\S]{0,220}\[STORAGE_KEYS\.SUBSCRIPTIONS\]: sanitized,[\s\S]{0,160}\[STORAGE_KEYS\.SUMMARY\]: trackerSummary\(sanitized\)/, '订阅账本与轻量 summary 必须在同一次 storage set 中提交，避免投影与事实源长期漂移');

const backgroundSource = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
const bilibiliSource = fs.readFileSync(path.join(root, 'platform/bilibili.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'content/app.js'), 'utf8');
const rollingPanelSource = fs.readFileSync(path.join(root, 'content/rolling-panel.js'), 'utf8');
const sidePanelCss = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.css'), 'utf8');
const sidePanelSource = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.js'), 'utf8');
const feedInjectorSource = fs.readFileSync(path.join(root, 'content/feed-injector.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'core/i18n.js'), 'utf8');
const formatterSource = fs.readFileSync(path.join(root, 'core/formatters.js'), 'utf8');
const settingsHtmlSource = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
const userFacingUiSource = [settingsHtmlSource, sidePanelSource, rollingPanelSource, feedInjectorSource, i18nSource, formatterSource, backgroundSource].join('\n');
assert.doesNotMatch(userFacingUiSource, /\p{Extended_Pictographic}/u, '用户可见 UI 与文案不得重新引入彩色 Emoji；功能图标应使用 SVG/CSS 或纯文本');

assert.match(backgroundSource, /BSE_FETCH_BILIBILI_RESOURCE/, '后台必须提供哔哩哔资源读取通道');
assert.doesNotMatch(backgroundSource, /if \(cached && tab\.url && isMatchingVideoUrl\(tab\.url\)\)\s*\{?\s*return cached;?\s*\}?/, '活动标签页状态读取不得仅因当前 URL 是视频页就复用未确认属于同一媒体的旧缓存');
assert.doesNotMatch(backgroundSource, /return cached \|\| null;/, 'getTabState 末尾不得无条件回退到可能属于上一媒体的缓存状态');
assert.match(backgroundSource, /HOST_NOT_ALLOWED/, '后台代理必须拒绝非白名单域名');
assert.match(backgroundSource, /INVALID_SENDER/, '后台代理必须验证请求页面来源');
assert.match(backgroundSource, /sender\.id\s*!==\s*chrome\.runtime\.id/, '后台代理必须拒绝非本扩展消息来源');
assert.match(backgroundSource, /sender\.url\.startsWith\(extensionRoot\)/, '后台代理仅应信任本扩展拥有的无标签页页面');
assert.doesNotMatch(backgroundSource, /parsed\.hostname\.endsWith\('bilibili\.com'\)/, '发送者域名校验必须要求点分隔，不能信任 evilbilibili.com 一类后缀伪造域名');
assert.match(backgroundSource, /BSE_FETCH_YOUTUBE_RESOURCE[\s\S]+?fetchYouTubeResource\(message\.url, sender\)/, 'YouTube 字幕代理必须传递发送者用于来源校验');
assert.match(backgroundSource, /fetchYouTubeResource[\s\S]+?UNSAFE_REDIRECT[\s\S]+?BODY_TOO_LARGE/, 'YouTube 字幕代理必须限制重定向目标与响应体大小');
assert.match(backgroundSource, /BSE_DOWNLOAD_MEDIA_FILE[\s\S]+?isTrustedSender\(sender, 'bilibili'\)/, '媒体下载通道必须验证消息来源');
assert.match(backgroundSource, /updateBadgeFromUnread[\s\S]{0,320}getTrackerSummary/, '扩展图标未读 badge 应读取轻量 Tracker summary，不得每次加载完整订阅账本');
assert.match(bilibiliSource, /requestBackgroundJson\((?:track\.subtitleUrl|cleanUrl)/, '哔哩哔字幕正文必须走后台通道');
assert.match(bilibiliSource, /function assertPlayerIdentity[\s\S]+?BILI_PLAYER_MEDIA_MISMATCH/, 'B站播放器响应必须校验返回 BVID/CID，不能只相信请求参数');
assert.doesNotMatch(bilibiliSource, /\[实验特性\/BPX\] 快速通道返回/, 'BPX 只能提供活跃 CID，不应继续维护第二套字幕轨道来源');
assert.match(bilibiliSource, /const cid = domCid \|\| pageInfo\.cid \|\| viewData\.cid/, 'BPX 活跃 CID 应进入统一 authoritative player path');
assert.match(bilibiliSource, /assertTrackStillCurrent\(track, '字幕正文请求前'\)[\s\S]+?assertTrackStillCurrent\(track, '字幕正文返回后'\)/, '字幕正文下载前后都必须确认轨道仍属于当前媒体');
assert.match(bilibiliSource, /BILI_SUBTITLE_DURATION_MISMATCH/, 'B站前台字幕也必须有 authoritative duration 防错互锁');
assert.match(appSource, /const isCurrentLoad = \(\) => \([\s\S]+?ownGeneration === trackGeneration[\s\S]+?mediaGeneration === generation[\s\S]+?expectedMediaKey === String\(state\.mediaKey \|\| ''\)/, '字幕正文事务必须同时绑定 track generation、media generation 与 mediaKey');
assert.match(appSource, /if \(!isCurrentLoad\(\)\) return;\s*if \(cues\?\.length\) cacheBody/, '旧 generation 必须在写入正文内存缓存之前被淘汰');
assert.match(appSource, /const loadController = new AbortController\(\)[\s\S]+?safeStorageGet[\s\S]+?ownGeneration !== generation \|\| loadController\.signal\.aborted/, '刷新事务必须使用局部 AbortController，并在异步设置读取后再次确认 generation');
assert.match(appSource, /if \(payload\.isRefreshing === undefined\) state\.isRefreshing = false/, 'ready 状态不得提前清掉显式 refreshing 标志，否则刷新按钮会在请求完成前重新可点');
assert.match(appSource, /function canHydrateSessionSnapshot[\s\S]+?selected\?\.bvid[\s\S]+?selected\?\.cid[\s\S]+?selected\.duration/, 'B站旧 SessionSnapshot 必须有明确 BVID/CID/duration 才能秒开，避免升级后继续复用历史污染正文');
assert.match(appSource, /safeLegacyMatch = !cachedTrackId[\s\S]{0,160}platform !== BSE\.PLATFORM\.BILIBILI/, 'B站无 trackId 的旧持久缓存必须重新确认一次官方轨道，不能继续盲信 legacy body');
assert.match(backgroundSource, /'core\/media-context\.js'[\s\S]+?'core\/batch-export\.js'[\s\S]+?'content\/app\.js'/, '动态补注入依赖必须与正常 content-script 链保持一致');
assert.match(appSource, /revision/, '状态必须携带单调版本号');
assert.match(appSource, /刷新失败，已保留现有字幕/, '刷新失败必须保留已成功字幕');
assert.match(rollingPanelSource, /ResizeObserver/, '滚动面板必须监听播放器尺寸变化');
assert.match(rollingPanelSource, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/, '滚动面板必须可靠隐藏旧状态 DOM');
assert.doesNotMatch(rollingPanelSource, /ai-drawer|ai-prompts-grid|data-prompt="(?:notes|summary|keypoints|questions)"/, '播放器旁滚动面板应保持低操作，不再维护与 Side Panel 重复的旧 AI Prompt 抽屉');
assert.match(rollingPanelSource, /btn-learn-workspace[\s\S]+?openSidePanel\?\.\('learn'\)/, '播放器旁的学习入口应直接进入 Side Panel 学习工作区');
assert.match(appSource, /function openSidePanel\(tab = ''\)[\s\S]+?BSE_OPEN_SIDE_PANEL[\s\S]+?tab/, '内容页打开 Side Panel 时应允许携带目标工作区，而不是另建一套学习 UI');
assert.doesNotMatch(sidePanelSource, /targetId:\s*state\.authorInfo\?\.targetId\s*\|\|\s*videoId/, 'YouTube 视频 ID 不得冒充 Channel ID 创建无效订阅');
assert.doesNotMatch(sidePanelSource, /state\.authorInfo\?\.targetId\s*\|\|\s*bvid/, 'Bilibili BV 号不得冒充 MID 创建无效 UP 主订阅');
assert.doesNotMatch(sidePanelSource, /batchButton\?\.addEventListener\('click',\s*openBatchModal\)/, '侧边栏批量按钮不得把 MouseEvent 当成 BV 号传给 openBatchModal');
assert.match(sidePanelSource, /typeof targetId === 'string'[\s\S]{0,180}getBvid/, '批量弹窗必须只接受显式字符串媒体 ID，并对 Bilibili 目标重新规范化');
assert.match(bilibiliSource, /assertApiSuccess\(await requestApiJson\(queryUrl/, '批量字幕 WBI 接口必须校验 Bilibili 逻辑状态码后再决定是否切换兼容接口');
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
assert.equal(BSE.Utils.normalizeImageUrl('//i0.hdslb.com/avatar.jpg'), 'https://i0.hdslb.com/avatar.jpg', '协议相对头像 URL 应统一转成 HTTPS');
assert.equal(BSE.Utils.normalizeImageUrl('http://i0.hdslb.com/avatar.jpg'), 'https://i0.hdslb.com/avatar.jpg', '头像 URL 不应继续保存明文 HTTP');
assert.equal(BSE.Utils.normalizeImageUrl(''), '', '空头像 URL 必须保持为空，不能制造伪地址');

const sidePanelHtml = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
assert.match(sidePanelHtml, /batch-tree-toolbar-actions/, '侧边栏批量弹窗应包含分P全选/清空/反选/仅当前工具栏');
assert.match(sidePanelSource, /function updateTreeSummaryAndScope[\s\S]+?const sectionStats = new Map\(\)[\s\S]+?const videoStats = new Map\(\)[\s\S]+?for \(const cb of allCbs\)/, '大合集勾选状态应单次遍历聚合 section/video 计数，不能对每个父节点重复扫描全部分P');
assert.match(sidePanelCss, /\.batch-tree-item-node\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:\s*auto\s+30px/s, '大合集屏幕外分P条目应延迟布局绘制，避免一次性绘制完整目录树');
assert.match(sidePanelHtml, /batch-quick-range-bar/, '批量弹窗应包含区间速选条');
assert.match(sidePanelHtml, /batch-settings-stacked/, '批量弹窗应使用多行纵向分栏配置抽屉而非拥挤单行');
assert.match(sidePanelHtml, /name="batch-output"/, '批量弹窗应包含输出动作单选组');
assert.match(sidePanelHtml, /value="copy-text"[\s\S]{0,180}复制全文/, '批量弹窗应提供直接合并复制文本的动作');
assert.match(sidePanelHtml, /value="merged-file"[\s\S]{0,200}合并为一个长文件/, '批量弹窗应提供单一长文件输出');
assert.match(sidePanelHtml, /value="zip"[\s\S]{0,180}独立打包 ZIP/, '批量弹窗应继续保留逐集 ZIP 归档模式');
assert.match(sidePanelHtml, /name="batch-format"/, '批量弹窗应包含文件格式单选组');
assert.match(sidePanelHtml, /id="pref-select"/, '全局设置抽屉应包含默认字幕偏好配置');
assert.match(sidePanelHtml, /id="settings-general-title"/, '设置抽屉必须包含通用分组');
assert.match(sidePanelHtml, /id="settings-tracker-title"/, '设置抽屉必须包含追踪更新分组');
assert.match(sidePanelHtml, /id="settings-data-title"/, '设置抽屉必须包含订阅数据分组，避免所有设置平铺在同一层');
assert.match(sidePanelHtml, /value="desktop"[\s\S]{0,220}value="badge"[\s\S]{0,220}value="off"/, '提醒设置必须完整表达桌面通知与角标、仅角标、关闭提醒三态');
assert.match(sidePanelSource, /trackerNotificationMode[\s\S]{0,500}enableNotification[\s\S]{0,500}enableBadge/, '提醒 UI 必须与底层 notification/badge 两个布尔设置双向映射');
assert.match(sidePanelSource, /getLocalePreference/, '语言选择框必须显示用户选择的 Auto/显式语言，而不是仅显示解析后的运行时语言');
assert.match(sidePanelSource, /if \(currentAuthorInfoKey === key\) return currentAuthorInfo/, '设置与主题重绘必须复用当前媒体作者信息，不能重复请求平台元数据');
assert.match(sidePanelSource, /currentAuthorInfoLoad\?\.key === key/, '并发触发当前作者解析时必须共享同一个进行中请求');
assert.match(sidePanelSource, /document\.documentElement\.lang = effectiveLocale/, '侧边栏切换语言时必须同步文档 lang 语义');
assert.match(rollingPanelSource, /this\.panel\.lang = effectiveLocale/, '页面内面板切换语言时必须同步可访问性语言语义');
assert.match(backgroundSource, /configuredInterval[\s\S]{0,220}periodInMinutes <= 0[\s\S]{0,160}chrome\.alarms\.clear/, '仅手动刷新必须真正取消后台巡检 Alarm，不能把 0 回退成默认 60 分钟');
assert.doesNotMatch(sidePanelSource, /BSE_TRACKER_RESET_ALARM/, '巡检设置保存后应由 sync storage change 唯一驱动 Alarm，不得再发送第二套重置消息');
assert.doesNotMatch(backgroundSource, /message\.type === 'BSE_TRACKER_RESET_ALARM'/, '后台不得保留无调用方的旧巡检重置消息协议');
assert.match(contentAppSource, /selectBestTrack\(tracks, preferredLanguage, subtitlePreference[\s\S]{0,1400}manual-only[\s\S]{0,900}ai-first/, '字幕偏好必须参与当前视频轨道选择，而不是只影响批量导出');
assert.match(contentAppSource, /changes\?\.bseSubtitlePreference[\s\S]{0,420}applySubtitlePreferenceChange/, '字幕偏好修改后必须让当前播放页立即重新选择字幕轨道');
assert.match(contentAppSource, /async function applySubtitlePreferenceChange[\s\S]{0,1800}selectBestTrack\(tracks[\s\S]{0,900}loadTrack\(selected/, '字幕偏好切换应优先复用当前轨道目录，只加载真正切换到的字幕正文');
assert.doesNotMatch(contentAppSource, /subtitle_preference_changed['"],\s*true/, '字幕偏好切换不得强制重新跑完整轨道发现与网络刷新');
const aiOutcomeTabs = [...sidePanelHtml.matchAll(/class="ai-mode-pill[^\"]*"[^>]+data-mode="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(aiOutcomeTabs, ['course_notes', 'keypoints', 'concept_deep', 'summary', 'deep_qa', 'error_check'], '学习与复习页必须按用户意图提供三种任务，而不是按 AI 技术分类');
assert.match(sidePanelHtml, /id="ai-learn-mode-shell"[\s\S]+?data-mode="course_notes"[\s\S]+?data-mode="keypoints"[\s\S]+?data-mode="concept_deep"/, '学习 Workspace 必须提供图文讲义、关键要点、概念深解');
assert.match(sidePanelHtml, /id="ai-review-mode-shell"[\s\S]+?data-mode="summary"[\s\S]+?data-mode="deep_qa"[\s\S]+?data-mode="error_check"/, '复习 Workspace 必须提供核心速览、自测翻卡、易错排查');
assert.match(sidePanelHtml, /id="ai-review-protocol"/, '自测任务应明确表达先作答、后核对的使用流程');
assert.doesNotMatch(sidePanelHtml, /id="ai-prompts-toggle"|class="ai-prompts-grid"/, '旧提示词库不应继续作为学习页内部的额外层级');
assert.match(sidePanelHtml, /id="ai-btn-external-toggle"[^>]+aria-controls="ai-external-toolbar"/, '学习与复习主工具栏必须提供明确的外部 AI 执行入口');
assert.doesNotMatch(sidePanelHtml, /class="ai-mode-pill[^\"]*"[^>]+data-mode="prompts"/, '提示词库不得重新混入学习产物 Tab');
assert.match(sidePanelSource, /aiBtnSnipFrame\.hidden\s*=\s*!usesVisualEvidence/, '快速回顾和复盘自测必须隐藏截图工具，避免暗示图片参与纯文本产物');
assert.match(sidePanelSource, /for \(const key of cacheKeys\)[\s\S]{0,220}AiNoteCache\.load\(key, mode, \{ signal: restoreController\.signal \}\)/, '切换学习产物时必须按 mode 从当前视频的稳定缓存别名恢复，并允许在用户离开工作区时取消高清图物化');
assert.match(aiNoteCacheSource, /artifacts:[\s\S]+?\[mode\]/, '同一视频的学习产物必须按 mode 独立保存，不能互相覆盖');
assert.match(aiNoteCacheSource, /function noteKey\(mediaKey\)[\s\S]{0,120}NOTE_KEY_PREFIX[^\n]+mediaKey/, 'AI Note 底层持久化仍应使用显式 owner key，而不是标题或完整 URL');
assert.match(sidePanelSource, /function renderCurrentAiArtifact\(\)[\s\S]{0,420}artifactKey !== activeArtifactKey[\s\S]{0,180}renderEmptyAiNoteState/, '最终学习产物渲染必须 fail-closed 校验 artifactKey 与当前视频内容身份，禁止跨视频沿用内存结果');
assert.match(sidePanelSource, /async function saveCurrentNoteToCache\([^)]*\)[\s\S]{0,520}!activeArtifactKey \|\| activeArtifactKey !== noteArtifactKey/, '持久化任一学习/复习 mode 产物前都必须要求当前视频身份与产物身份完全一致');
assert.match(sidePanelSource, /function currentAiArtifactKey[\s\S]{0,760}selected\?\.page[\s\S]{0,520}getArtifactKey/, '学习/复习缓存必须优先使用已确认的 B站 track.page，并在其他情况回退统一 artifactKey seam，不能直接复用可能在 pN\/cidN 间变化的运行时 key');
assert.match(sidePanelSource, /sourceArtifactKey[\s\S]{0,180}sourceArtifactKey !== artifactKey/, '带来源 URL 的缓存如果证明属于另一视频，恢复时必须 fail-closed 拒绝显示');
assert.match(sidePanelHtml, /id="ai-btn-clear-artifact"/, '学习/复习结果必须提供清空当前产物入口，误导入后不能只能一直看着错误缓存');
assert.match(sidePanelSource, /clearCurrentAiArtifact[\s\S]{0,520}AiNoteCache\.remove\(key, \{ mode \}\)/, '清空当前产物必须删除当前视频当前 mode 的规范 key 与历史别名，避免旧 cid 缓存再次冒出来');
assert.match(contentAppSource, /provisional[\s\S]{0,700}state\.tracks\.some[\s\S]{0,320}ownerMatches/, 'B站 pN 临时身份必须能通过当前轨道的 BVID\/CID\/page 证明并接纳精确 MediaContext，避免标签语境被自身拒绝');
assert.match(sidePanelSource, /function stateMatchesTabUrl[\s\S]{0,520}mediaStateMatchesUrl/, 'Side Panel 必须用当前标签页 URL 校验收到的媒体状态，不能只相信旧 ready 状态');
assert.match(sidePanelSource, /const directState = await chrome\.tabs\.sendMessage[\s\S]{0,240}stateMatchesTabUrl\(directState, currentTab\.url/, 'Side Panel 初始直连状态也必须先校验当前 URL，避免 SPA 切视频时读到上一视频状态');
assert.match(sidePanelSource, /sameMediaIdentity[\s\S]{0,320}nextState\.status === 'empty'/, 'ready→empty 防抖只允许发生在同一 mediaKey，未知/新视频状态必须能清空旧笔记');
assert.match(contentAppSource, /state\.mediaKey = mediaKey;[\s\S]{0,360}SessionSnapshotManager\?\.findSnapshot\(mediaKey\)[\s\S]{0,420}transitionTo\('ready'/, '内容页必须先提交新 mediaKey 再发布快照秒开状态，禁止新视频字幕携带旧视频身份广播');
assert.match(sidePanelHtml, /id="tracker-search-input"/, '追踪中心应提供订阅搜索入口');
assert.match(sidePanelHtml, /id="tracker-sort-select"/, '追踪中心应提供订阅排序入口');
assert.match(sidePanelHtml, /id="tracker-status-line"[^>]+aria-live="polite"/, '追踪中心状态摘要应向辅助技术播报');
assert.match(sidePanelSource, /expandedTrackerCards/, '追踪卡片默认紧凑，但必须保留明确的历史展开状态');
assert.match(sidePanelSource, /TRACKER_VISIBLE_ITEMS\s*=\s*3/, '每个追踪卡片折叠时最多只展示最近 3 个视频');
assert.match(sidePanelSource, /expanded\s*\?\s*items\s*:\s*items\.slice\(0,\s*TRACKER_VISIBLE_ITEMS\)/, '折叠态显示最近 3 条，用户主动展开后必须能看到保留的历史');
assert.match(sidePanelSource, /tracker-expand-btn[\s\S]{0,500}tracker_btn_expand_more/, '存在历史时必须提供清晰的查看其余记录入口');
assert.match(sidePanelSource, /expandedTrackerCards\.has\(id\)[\s\S]{0,220}renderTrackerList\(\)/, '展开按钮必须真正切换侧边栏历史，而不是成为无效装饰');
assert.match(sidePanelSource, /changes\['bse_subscriptions'\]/, '追踪 storage 监听必须订阅真实的 bse_subscriptions key');
assert.doesNotMatch(sidePanelSource, /changes\['bse_tracker_subscriptions'\]/, '不得继续监听不存在的旧 tracker storage key');
assert.doesNotMatch(sidePanelSource, /BSE_TRACKER_SUBSCRIPTIONS_UPDATED|BSE_TRACKER_UPDATE_BADGE/, '追踪同步应直接依赖真实 storage change，不再重复发送第二套广播/徽标消息');
assert.match(sidePanelSource, /if \(currentWorkspace === 'tracker'\)[\s\S]{0,160}scheduleTrackerRefresh/, '窗口重新聚焦时只有追踪一级 Workspace 可见才应触发完整 tracker 刷新');
assert.doesNotMatch(sidePanelSource, /loadAndRenderTracker\(\)\.catch\(\(\) => \{\}\);\s*initializeQueueLanguageControl/, '侧栏初始化不得无条件加载完整 tracker 页面');
assert.match(sidePanelSource, /getTrackerUnreadItems/, '追踪中心必须按逐条已读状态选择未读内容，不能只依赖前 N 条位置');
assert.doesNotMatch(sidePanelSource, /matchingSub\.items\s*=\s*episodes/, '打开批量目录不得覆盖追踪账本并丢失已读/字幕状态');
assert.match(sidePanelSource, /previousReadState[\s\S]{0,900}previousSubtitle/, '批量目录元数据同步必须显式保留逐条已读状态与字幕缓存');
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
const mergedPlainFaults = BSE.Formatters.toMergedText(faultTree, [...faultResults].reverse(), { total: 3, success: 1, noSub: 1, failed: 1 });
assert.ok(mergedPlainFaults.indexOf('001. P1 正常分P') < mergedPlainFaults.indexOf('003. P3 接口异常分P'), '合并输出必须按用户目录序号排序，不能受并发完成先后影响');
assert.match(mergedPlainFaults, /002\. P2 无字幕分P[\s\S]+无可用字幕/, '纯文本复制也必须保留无字幕条目的可解释状态');
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
assert.equal(
  BSE.Utils.getMediaKey('bilibili', 'https://www.bilibili.com/video/BV11S4y1a7wW?p=2'),
  'bili:BV11S4y1a7wW:p2',
  'Service Worker 传入显式 Bilibili URL 时必须只依据该 URL 生成媒体键，不能读取当前页面 DOM'
);
assert.equal(
  BSE.Utils.getMediaKey('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s'),
  'yt:dQw4w9WgXcQ',
  'Service Worker 传入显式 YouTube URL 时必须生成稳定媒体键'
);
assert.equal(
  BSE.Utils.mediaStateMatchesUrl(
    { mediaKey: 'bili:BV11S4y1a7wW:cid1002', url: 'https://www.bilibili.com/video/BV11S4y1a7wW?p=2' },
    'https://www.bilibili.com/video/BV11S4y1a7wW?p=2'
  ),
  true,
  'Bilibili 页面状态只有在 BVID 与 URL 分P上下文一致时才可复用'
);
assert.equal(
  BSE.Utils.mediaStateMatchesUrl(
    { mediaKey: 'bili:BV14cCGBpErw:cid9999', url: 'https://www.bilibili.com/video/BV14cCGBpErw' },
    'https://www.bilibili.com/video/BV11S4y1a7wW?p=2'
  ),
  false,
  '其他 BVID 的 ready state 绝不能被当前 Bilibili 视频复用'
);
assert.equal(
  BSE.Utils.mediaStateMatchesUrl(
    { mediaKey: 'yt:dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s'
  ),
  true,
  'YouTube state 必须与目标 videoId 精确匹配'
);
assert.equal(
  BSE.Utils.mediaStateMatchesUrl(
    { mediaKey: 'yt:9bZkp7q19f0', url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' },
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  ),
  false,
  '其他 YouTube videoId 的 state 不能穿透到当前视频'
);

const originalRuntimeSendMessage = context.chrome.runtime.sendMessage;
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/x/web-interface/view')) {
    return {
      success: true,
      ok: true,
      status: 200,
      contentType: 'application/json',
      text: JSON.stringify({
        code: 0,
        data: {
          aid: 42,
          bvid: 'BV11S4y1a7wW',
          title: '显式页面上下文测试',
          pages: [
            { cid: 1001, page: 1, part: 'P1 第一讲', duration: 60 },
            { cid: 1002, page: 2, part: 'P2 第二讲', duration: 70 }
          ]
        }
      })
    };
  }
  return originalRuntimeSendMessage(msg);
};
const explicitPageTree = await BSE.Bilibili.fetchMediaTree('BV11S4y1a7wW', {
  pageUrl: 'https://www.bilibili.com/video/BV11S4y1a7wW?p=2'
});
assert.equal(explicitPageTree.currentPage, 2, 'Side Panel 构建合集树时必须使用活动视频 URL，而不是 chrome-extension:// 侧栏自身 URL 判断当前分P');
assert.equal(explicitPageTree.items[0].title, 'P1 第一讲', 'B站分P标题本身已有 P1 时不得再拼成 P1 P1');
assert.equal(explicitPageTree.items[1].title, 'P2 第二讲', 'B站分P标题规范化必须对每个页码稳定去重');
await assert.rejects(
  BSE.Bilibili.fetchMediaTree(/** @type {any} */ ({ type: 'click' })),
  /有效的 B 站 BV 号/,
  '批量拓扑层必须拒绝 MouseEvent/对象一类非字符串目标，不能把 [object Object] 发给 Bilibili 视频接口'
);
context.chrome.runtime.sendMessage = originalRuntimeSendMessage;

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
assert.ok(cacheStats.approximateBytes < 10000, '追踪元数据统计不得把字幕正文重新编码进订阅快照');

await BSE.Tracker.saveSubscriptions([{
  id: 'metadata-only-cache', platform: 'bilibili', type: 'up', title: '轻量追踪缓存', targetId: '1', unreadCount: 1,
  subscribedAt: Date.now(), lastCheckedAt: Date.now(),
  items: [{
    id: 'BV1CACHEMETA', title: '正文不应内嵌', url: 'https://www.bilibili.com/video/BV1CACHEMETA', isRead: false,
    subtitle: { status: 'ready', fetchedAt: Date.now(), cueCount: 2, markdown: '正文'.repeat(50000), plainText: '重复正文'.repeat(50000) }
  }]
}]);
const lightweightTrackerBlob = storageAreas.local.get('bse_subscriptions');
assert.equal(lightweightTrackerBlob[0].items[0].subtitle.markdown, undefined, '追踪主存储不得内嵌 Markdown 正文');
assert.equal(lightweightTrackerBlob[0].items[0].subtitle.plainText, undefined, '追踪主存储不得内嵌纯文本正文');
assert.ok(JSON.stringify(lightweightTrackerBlob).length < 10000, '单条已提取字幕不应把追踪主存储膨胀到正文规模');
const lightweightTrackerSummary = await BSE.Tracker.getTrackerSummary();
assert.deepEqual(
  { total: lightweightTrackerSummary.total, unread: lightweightTrackerSummary.unread },
  { total: 1, unread: 1 },
  '追踪导航摘要必须由正式压缩账本派生，只保存总订阅数和未读数'
);
assert.deepEqual(
  { total: storageAreas.local.get('bse_tracker_summary_v1')?.total, unread: storageAreas.local.get('bse_tracker_summary_v1')?.unread },
  { total: 1, unread: 1 },
  '保存追踪账本时必须同步提交轻量 summary，避免隐藏页面为了 badge 再读完整订阅历史'
);
await BSE.Tracker.removeSubscription('metadata-only-cache');
const emptyTrackerSummary = await BSE.Tracker.getTrackerSummary();
assert.deepEqual({ total: emptyTrackerSummary.total, unread: emptyTrackerSummary.unread }, { total: 0, unread: 0 }, '删除订阅后轻量 summary 必须同步归零');
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
  avatar: 'https://i0.hdslb.com/bfs/face/existing.jpg',
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

// 历史订阅缺头像时应走轻量 view API 自愈，并持久化规范化后的作者元数据。
const avatarRepairSub = await BSE.Tracker.addSubscription({
  id: 'bilibili:season:avatar-repair',
  platform: 'bilibili',
  type: 'season',
  title: '旧合集',
  author: '旧作者',
  targetId: 'avatar-repair',
  bvid: 'BV1AVATAR9',
  sourceUrl: 'https://www.bilibili.com/video/BV1AVATAR9',
  avatar: '',
  items: []
});
mockFetch = async (url) => {
  assert.match(String(url), /x\/web-interface\/view\?bvid=BV1AVATAR9/);
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, data: { owner: { mid: 54321, name: '修复后的作者', face: '//i0.hdslb.com/bfs/face/repaired.jpg' } } })
  };
};
const avatarRepairResult = await BSE.Tracker.repairSubscriptionMetadata(avatarRepairSub);
assert.equal(avatarRepairResult.updated, true, '缺失头像的 B站订阅必须能恢复作者元数据');
assert.equal(avatarRepairSub.avatar, 'https://i0.hdslb.com/bfs/face/repaired.jpg', '协议相对或 HTTP 头像地址应统一规范为 HTTPS');
assert.equal(avatarRepairSub.author, '修复后的作者', '恢复头像时应同步修正作者名称');
assert.equal(avatarRepairSub.ownerId, '54321', '恢复头像时应记录稳定 ownerId');
const persistedAvatarRepair = await BSE.Tracker.getSubscription(avatarRepairSub.id);
assert.equal(persistedAvatarRepair.avatar, avatarRepairSub.avatar, '头像自愈结果必须持久化，不能下次打开又退回字母占位');
await BSE.Tracker.removeSubscription(avatarRepairSub.id);

// A deleted/stale latestBvid must not permanently block Bilibili owner/avatar repair.
// Try the subscription's current items/source roots until a video that still belongs
// to the same owner + UGC season is found.
const staleAvatarSub = await BSE.Tracker.addSubscription({
  id: 'bilibili:season:stale-avatar-root',
  platform: 'bilibili',
  type: 'season',
  title: '真题详解-27考研',
  author: '-褴褛飞旋',
  targetId: '8920915',
  ownerId: '919346',
  bvid: 'BV18ytf6sETY',
  latestBvid: 'BV18ytf6sETY',
  sourceUrl: 'https://www.bilibili.com/video/BV1sk896uEpp',
  avatar: '',
  items: [{
    id: 'BV12SY26cELW',
    title: 'TCP-[一图流]-408计算机考研笔记',
    url: 'https://www.bilibili.com/video/BV12SY26cELW',
    pubdate: 1789139796000,
    isRead: true
  }]
});
const staleAvatarRequests = [];
mockFetch = async (url) => {
  staleAvatarRequests.push(String(url));
  if (String(url).includes('bvid=BV18ytf6sETY')) {
    return { ok: true, status: 200, json: async () => ({ code: 62002 }) };
  }
  if (String(url).includes('bvid=BV12SY26cELW')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV12SY26cELW',
          owner: { mid: 919346, name: '-褴褛飞旋', face: 'https://i2.hdslb.com/bfs/face/repaired-current.jpg' },
          ugc_season: { id: 8920915, title: '真题详解-27考研' }
        }
      })
    };
  }
  throw new Error(`unexpected avatar repair url: ${url}`);
};
const staleAvatarRepair = await BSE.Tracker.repairSubscriptionMetadata(staleAvatarSub);
assert.equal(staleAvatarRepair.checked, true, '失效 latestBvid 后必须继续尝试当前订阅的其他有效 BV');
assert.equal(staleAvatarSub.avatar, 'https://i2.hdslb.com/bfs/face/repaired-current.jpg', '有效候选必须恢复真实作者头像');
assert.equal(staleAvatarSub.bvid, 'BV12SY26cELW', '恢复成功后应淘汰失效 root hint，避免下次仍先请求已删除 BV');
assert.equal(staleAvatarSub.latestBvid, 'BV12SY26cELW', '恢复成功后 latestBvid 应指向仍有效的当前媒体');
assert.match(staleAvatarRequests[0], /bvid=BV18ytf6sETY/, '应先验证现有 latestBvid，而不是无理由忽略持久化状态');
assert.match(staleAvatarRequests[1], /bvid=BV12SY26cELW/, 'latestBvid 失效后应立即尝试已知当前条目');
await BSE.Tracker.removeSubscription(staleAvatarSub.id);

// Distinct media identities are authoritative. Two adjacent UGC episodes may
// intentionally share the same title and publish only minutes apart; title/time
// similarity must never collapse different BVIDs.
const sameTitleEpisodesSub = await BSE.Tracker.addSubscription({
  id: 'bilibili:season:same-title-distinct-media',
  platform: 'bilibili',
  type: 'season',
  title: '同标题独立视频',
  targetId: 'same-title-distinct-media',
  items: [
    {
      id: 'BV12SY26cELW',
      title: 'TCP-[一图流]-408计算机考研笔记',
      url: 'https://www.bilibili.com/video/BV12SY26cELW',
      pubdate: 1789139796000,
      duration: 192,
      isRead: true
    },
    {
      id: 'BV1mmY26aE2w',
      title: 'TCP-[一图流]-408计算机考研笔记',
      url: 'https://www.bilibili.com/video/BV1mmY26aE2w',
      pubdate: 1789139187000,
      duration: 144,
      isRead: false,
      subtitle: { status: 'ready', cueCount: 99 }
    }
  ]
});
const sameTitleEpisodesLoaded = await BSE.Tracker.getSubscription(sameTitleEpisodesSub.id);
assert.equal(sameTitleEpisodesLoaded.items.length, 2, '不同 BVID 即使标题完全相同且发布时间接近，也必须保留为两个独立视频');
assert.deepEqual(
  Array.from(sameTitleEpisodesLoaded.items, (item) => item.id),
  ['BV12SY26cELW', 'BV1mmY26aE2w'],
  'Tracker 去重必须以稳定媒体身份为准，不能用标题或时间启发式合并内容'
);
assert.equal(sameTitleEpisodesLoaded.items[1].subtitle?.status, 'ready', '独立媒体条目的字幕状态必须各自保留');
await BSE.Tracker.removeSubscription(sameTitleEpisodesSub.id);

// B站 UGC 合集拓扑追根与全量剧集提取巡检测试
const seasonSub = {
  id: 'bilibili:season:3092932',
  platform: 'bilibili',
  type: 'season',
  title: '视频合集',
  targetId: '3092932',
  bvid: 'BV1T1GA6pEvp',
  latestBvid: 'BV1STALEROOT9',
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
const seasonViewRequests = [];
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    seasonViewRequests.push(String(url));
    if (String(url).includes('bvid=BV1STALEROOT9')) {
      return { ok: true, status: 200, json: async () => ({ code: 62002 }) };
    }
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
assert.equal(seasonViewRequests.length, 2, '合集巡检遇到失效 latestBvid 时必须继续尝试其他已知 BV，而不是立即降级或放弃');
assert.match(seasonViewRequests[0], /bvid=BV1STALEROOT9/, '应先验证持久化 latestBvid');
assert.match(seasonViewRequests[1], /bvid=BV1T1GA6pEvp/, '失效 latestBvid 后必须继续尝试有效合集根视频');

await BSE.Tracker.addSubscription(seasonSub);
const reloadedSeason = await BSE.Tracker.getSubscription(seasonSub.id);
assert.equal(reloadedSeason.items.length, 25, '巡检建立基线后必须持久化到存储中');
assert.equal(reloadedSeason.title, '人工智能与机器学习实战', '巡检建立基线后标题必须持久化更新');
await BSE.Tracker.removeSubscription(seasonSub.id);

// 多 P 追踪必须为 p1 使用与后续巡检一致的稳定条目 ID，同时 latestBvid 只保存纯 BV 根标识。
const multiPageSub = {
  id: 'bilibili:season:multipage-test',
  platform: 'bilibili',
  type: 'season',
  title: '多P追踪测试',
  targetId: 'BV1MULTIPAGE',
  bvid: 'BV1MULTIPAGE',
  lastCheckedAt: 0,
  unreadCount: 0,
  items: []
};
const multiPageRequestUrls = [];
mockFetch = async (url) => {
  multiPageRequestUrls.push(String(url));
  assert.match(String(url), /bvid=BV1MULTIPAGE(?:&|$)/, '多P巡检请求必须始终使用纯 BV 根标识');
  assert.doesNotMatch(String(url), /%3Ap1|:p1/, '多P巡检不得把追踪条目 ID 当成 BVID 请求参数');
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data: {
        bvid: 'BV1MULTIPAGE',
        title: '多P视频',
        pubdate: 100,
        pages: [
          { page: 1, cid: 101, part: '第一P', duration: 60 },
          { page: 2, cid: 102, part: '第二P', duration: 70 }
        ]
      }
    })
  };
};
const multiPageBaseline = await BSE.Tracker.checkSubscriptionUpdates(multiPageSub);
assert.equal(multiPageBaseline.initialized, true, '多P首次巡检必须建立基线');
assert.deepEqual(Array.from(multiPageSub.items, (item) => item.id), ['BV1MULTIPAGE:p1', 'BV1MULTIPAGE:p2'], '多P的 p1/p2 必须统一使用稳定页级 ID');
assert.equal(multiPageSub.latestBvid, 'BV1MULTIPAGE', 'latestBvid 只能保存可再次请求 view API 的纯 BV 标识');
const multiPageRecheck = await BSE.Tracker.checkSubscriptionUpdates(multiPageSub);
assert.equal(multiPageRecheck.updated, false, '重复巡检相同多P目录不得把已知分P重新算成更新');
assert.equal(multiPageSub.unreadCount, 0, '重复巡检相同多P目录不得制造未读');
assert.equal(multiPageRequestUrls.length, 2, '两次巡检各只需要一次目录请求');

// 兼容旧数据：历史版本可能把多P第1页保存成纯 BV，并把 latestBvid 错存成 BV:p1。
const legacyMultiPageSub = {
  ...multiPageSub,
  id: 'bilibili:season:multipage-legacy-test',
  latestBvid: 'BV1MULTIPAGE:p1',
  lastCheckedAt: Date.now(),
  unreadCount: 0,
  items: [
    { id: 'BV1MULTIPAGE', title: '第一P', url: 'https://www.bilibili.com/video/BV1MULTIPAGE?p=1', pubdate: 100000, isRead: true, subtitle: { status: 'ready', cueCount: 1, markdown: '# 已缓存第一P' } },
    { id: 'BV1MULTIPAGE:p2', title: '第二P', url: 'https://www.bilibili.com/video/BV1MULTIPAGE?p=2', pubdate: 100000, isRead: true }
  ]
};
const legacyMultiPageRecheck = await BSE.Tracker.checkSubscriptionUpdates(legacyMultiPageSub);
assert.equal(legacyMultiPageRecheck.updated, false, '旧版 p1 ID 在首次新版本巡检时不得复活成新更新');
assert.equal(legacyMultiPageSub.unreadCount, 0, '旧版 p1 ID 迁移后仍应保持已读');
assert.equal(legacyMultiPageSub.items[0].id, 'BV1MULTIPAGE:p1', '旧版纯 BV p1 必须就地迁移到稳定页级 ID');
assert.equal(legacyMultiPageSub.items[0].subtitle?.status, 'ready', 'p1 ID 迁移必须保留既有字幕缓存');

// Tracker canonical media identity dedupe: the same Bilibili p1 may arrive as
// plain BV, BV:p1, or through an API record whose URL carries ?p=1. Historical
// duplicates must collapse without losing unread state or an extracted subtitle.
const trackerBeforeDedupe = await BSE.Tracker.getSubscriptions();
await BSE.Tracker.saveSubscriptions([{
  id: 'bilibili:season:dedupe-regression',
  platform: 'bilibili',
  type: 'season',
  title: '去重回归',
  targetId: 'dedupe-regression',
  subscribedAt: 1,
  lastCheckedAt: 2,
  items: [
    {
      id: 'BV1DEDUPETEST',
      title: 'NAT-UDP-[一图流]-408计算机考研笔记',
      url: 'https://www.bilibili.com/video/BV1DEDUPETEST',
      pubdate: 1000,
      isRead: true,
      subtitle: { status: 'ready', cueCount: 2 }
    },
    {
      id: 'BV1DEDUPETEST:p1',
      cid: 998877,
      title: 'NAT-UDP-[一图流]-408计算机考研笔记',
      url: 'https://www.bilibili.com/video/BV1DEDUPETEST?p=1',
      pubdate: 2000,
      isRead: false
    }
  ]
}]);
const [dedupedTrackerSub] = await BSE.Tracker.getSubscriptions();
assert.equal(dedupedTrackerSub.items.length, 1, '同一 BVID 的 p1 历史别名必须折叠成一个追踪条目');
assert.equal(dedupedTrackerSub.items[0].isRead, false, '去重必须保留更保守的未读状态');
assert.equal(dedupedTrackerSub.items[0].subtitle?.status, 'ready', '去重不能丢掉另一重复条目已经提取好的字幕状态');

await BSE.Tracker.addSubscription({
  id: 'legacy-alias-for-same-source',
  platform: 'bilibili',
  type: 'up',
  title: '同一个 UP',
  targetId: '123456'
});
await BSE.Tracker.addSubscription({
  id: 'bilibili:up:123456',
  platform: 'bilibili',
  type: 'up',
  title: '同一个 UP（新入口）',
  targetId: '123456'
});
const sameSourceSubs = (await BSE.Tracker.getSubscriptions()).filter((sub) => sub.platform === 'bilibili' && sub.type === 'up' && sub.targetId === '123456');
assert.equal(sameSourceSubs.length, 1, '同一平台/类型/targetId 的订阅源即使历史 id 不同也必须去重');
await BSE.Tracker.saveSubscriptions(trackerBeforeDedupe);

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

// 13.5 已读状态持久化与防复发测试 (Anti-Resurrection Read State Guard)
const readTestSub = {
  id: 'bilibili:season:888999',
  platform: 'bilibili',
  type: 'season',
  title: '已读状态测试合集',
  targetId: '888999',
  bvid: 'BV1READTEST',
  unreadCount: 3,
  lastCheckedAt: 1000,
  items: [
    { id: 'BV1EP3', title: '第3集', pubdate: 3000, isRead: false },
    { id: 'BV1EP2', title: '第2集', pubdate: 2000, isRead: false },
    { id: 'BV1EP1', title: '第1集', pubdate: 1000, isRead: false }
  ]
};
await BSE.Tracker.addSubscription(readTestSub);
let savedSub = await BSE.Tracker.getSubscription(readTestSub.id);
assert.equal(savedSub.unreadCount, 3, '初始未读数必须为 3');

// 测试单条标记已读
await BSE.Tracker.markAsRead(readTestSub.id, 'BV1EP3');
savedSub = await BSE.Tracker.getSubscription(readTestSub.id);
assert.equal(savedSub.unreadCount, 2, '单条标记已读后未读数递减');
assert.equal(savedSub.items.find(i => i.id === 'BV1EP3')?.isRead, true, '指定条目必须持久化为已读');

// 同一条目可能被双击、跨窗口重复写回；已读操作必须幂等，不能继续扣减其他未读项。
await BSE.Tracker.markAsRead(readTestSub.id, 'BV1EP3');
savedSub = await BSE.Tracker.getSubscription(readTestSub.id);
assert.equal(savedSub.unreadCount, 2, '重复标记同一条目不得让未读数继续递减');
assert.equal(savedSub.items.filter(i => i.isRead === false).length, 2, '未读计数必须与逐条 isRead 状态一致');

// 测试整卡全部标记已读
await BSE.Tracker.markAsRead(readTestSub.id);
savedSub = await BSE.Tracker.getSubscription(readTestSub.id);
assert.equal(savedSub.unreadCount, 0, '标为已读后卡片未读数必须清零');
assert.ok(savedSub.lastReadPubdate >= 3000, '标记已读后必须更新已读时间戳水位线');
assert.ok(savedSub.items.every(i => i.isRead), '标记已读后所有条目必须为已读状态');

// 测试后续巡检返回历史条目时，绝不复发为未读
mockFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: 0,
    data: {
      title: '已读状态测试合集',
      ugc_season: {
        id: 888999,
        title: '已读状态测试合集',
        sections: [{
          title: '正片',
          episodes: [
            { bvid: 'BV1EP3', title: '第3集', arc: { pubdate: 3, duration: 100 } },
            { bvid: 'BV1EP2', title: '第2集', arc: { pubdate: 2, duration: 100 } },
            { bvid: 'BV1EP1', title: '第1集', arc: { pubdate: 1, duration: 100 } }
          ]
        }]
      }
    }
  })
});
const recheckRes = await BSE.Tracker.checkSubscriptionUpdates(savedSub);
assert.equal(recheckRes.updated, false, '历史已读条目巡检不得触发更新');
assert.equal(savedSub.unreadCount, 0, '历史条目绝不能复活为未读');

// 测试全量标记已读
await BSE.Tracker.markAllAsRead();
const reloadedAll = await BSE.Tracker.getSubscriptions();
assert.ok(reloadedAll.every(s => s.unreadCount === 0), 'markAllAsRead 必须将所有订阅未读数彻底清零');
await BSE.Tracker.removeSubscription(readTestSub.id);

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

const batchRuntimeSendMessage = context.chrome.runtime.sendMessage;
context.chrome.runtime.sendMessage = async (msg) => {
  if (msg.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/player/wbi/v2')) {
    return {
      success: true,
      ok: true,
      status: 200,
      contentType: 'application/json',
      text: JSON.stringify({
        code: 0,
        data: {
          subtitle: {
            subtitles: [{
              id: 1,
              lan: 'zh-CN',
              lan_doc: '中文',
              subtitle_url: 'https://i0.hdslb.com/bfs/subtitle/batch-copy-test.json'
            }]
          }
        }
      })
    };
  }
  if (msg.type === 'BSE_FETCH_BILIBILI_RESOURCE' && msg.url.includes('/bfs/subtitle/batch-copy-test.json')) {
    return {
      success: true,
      ok: true,
      status: 200,
      contentType: 'application/json',
      text: JSON.stringify({ body: [{ from: 0, to: 2, content: '可复制的批量字幕正文' }] })
    };
  }
  return batchRuntimeSendMessage(msg);
};
const copyBatchResult = await BSE.Bilibili.runBatchExport(sampleTree, {
  scope: 'all',
  preference: 'manual-first',
  outputMode: 'copy-text',
  format: 'txt',
  withTimestamp: false
});
assert.equal(copyBatchResult.stats.success, 2, '复制全文模式必须复用同一批量抓取管线并保留成功统计');
assert.equal(copyBatchResult.output?.mode, 'copy-text', '复制全文模式必须返回可由 UI 写入剪贴板的输出描述');
assert.match(copyBatchResult.output?.text || '', /可复制的批量字幕正文/, '复制全文模式必须实际生成合并字幕文本');
context.chrome.runtime.sendMessage = batchRuntimeSendMessage;

const youtubeBatchTree = {
  title: 'YouTube 批量契约测试',
  kind: 'youtube_playlist',
  currentBvid: 'dQw4w9WgXcQ',
  currentPage: 1,
  items: [{
    kind: 'episode', globalIndex: 1, sectionIndex: 1, sectionTitle: 'Playlist', sectionKey: 'section_0',
    episodeIndex: 1, episodeTitle: 'English Lesson', page: 1, part: 'English Lesson', duration: 60,
    bvid: 'dQw4w9WgXcQ', aid: 'dQw4w9WgXcQ', cid: 'dQw4w9WgXcQ', title: 'English Lesson',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }],
  sections: [{ index: 1, key: 'section_0', title: 'Playlist', items: [], episodes: [] }]
};
const originalYoutubeBatchSendMessage = context.chrome.runtime.sendMessage;
let youtubeBatchPayload = null;
context.chrome.runtime.sendMessage = async (message) => {
  if (message?.type === 'BSE_FETCH_NATIVE_YOUTUBE_CAPTIONS') {
    youtubeBatchPayload = message.payload;
    return {
      success: true,
      result: {
        cues: [{ from: 0, to: 2, content: 'English batch transcript' }],
        language: 'en',
        langDoc: 'English',
        kind: 'auto'
      }
    };
  }
  return originalYoutubeBatchSendMessage(message);
};
const youtubeBatchResult = await BSE.YouTube.runBatchExport(youtubeBatchTree, {
  scope: 'all',
  preference: 'ai-first',
  outputMode: 'copy-text',
  format: 'txt',
  withTimestamp: false
});
assert.equal(youtubeBatchPayload?.subtitlePreference, 'ai-first', 'YouTube 批量导出必须把用户字幕偏好透传给 Service Worker Native 代理');
assert.equal(youtubeBatchResult.results[0].track?.lan, 'en', 'YouTube 批量结果必须保留真实语言代码');
assert.equal(youtubeBatchResult.results[0].track?.lan_doc, 'English', 'YouTube 批量结果必须保留真实语言标签');
assert.equal(youtubeBatchResult.results[0].track?.isAI, true, 'YouTube 批量结果必须保留自动字幕类型');

let cancelledNativeJobId = '';
let resolvePendingYoutubeCaption = null;
context.chrome.runtime.sendMessage = async (message) => {
  if (message?.type === 'BSE_FETCH_NATIVE_YOUTUBE_CAPTIONS') {
    return await new Promise((resolve) => { resolvePendingYoutubeCaption = resolve; });
  }
  if (message?.type === 'BSE_NATIVE_CANCEL') {
    cancelledNativeJobId = String(message.jobId || '');
    resolvePendingYoutubeCaption?.({ success: false, error: 'cancelled' });
    return { ok: true, cancelled: true };
  }
  return originalYoutubeBatchSendMessage(message);
};
const youtubeBatchControl = {};
const pendingYoutubeBatch = BSE.YouTube.runBatchExport(youtubeBatchTree, {
  scope: 'all',
  preference: 'manual-first',
  outputMode: 'copy-text',
  format: 'txt'
}, undefined, youtubeBatchControl);
await Promise.resolve();
assert.ok(youtubeBatchControl.controller, 'YouTube 批量任务必须暴露当前 AbortController 给统一取消入口');
youtubeBatchControl.cancelled = true;
youtubeBatchControl.controller.abort();
const cancelledYoutubeBatch = await pendingYoutubeBatch;
assert.match(cancelledNativeJobId, /^batch-dQw4w9WgXcQ-/, '取消 YouTube 批量任务必须把当前 jobId 发送给 Service Worker Native cancel');
assert.equal(cancelledYoutubeBatch.cancelled, true, '取消后的 YouTube 批量任务必须立即返回 cancelled 状态而非等待 Host 慢响应');
context.chrome.runtime.sendMessage = originalYoutubeBatchSendMessage;

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
const queuedSummary = await BSE.Queue.getQueueSummary();
assert.deepEqual(
  { total: queuedSummary.total, pending: queuedSummary.pending },
  { total: 2, pending: 2 },
  '隐藏工作区需要能只读取轻量 Queue summary，而不是为了导航角标加载完整字幕任务'
);

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
const recoveredSummary = await BSE.Queue.getQueueSummary();
assert.deepEqual(
  { total: recoveredSummary.total, pending: recoveredSummary.pending },
  { total: recovered.length, pending: recovered.length - 1 },
  'Queue summary 必须随完成状态同步更新，而不是成为第二套漂移状态'
);

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
const explicitPortPrimary = 'https://xy58x222x42x50xy.mcdn.bilivideo.cn:8082/upgcxcode/audio.m4a?deadline=999&sign=ported-primary';
const portlessFallback = 'https://upos-sz-estgoss.bilivideo.com/upgcxcode/audio.m4a?deadline=999&sign=portless-backup';
assert.deepEqual(
  structuredClone(BSE.Media.selectBilibiliAudio([{
    bandwidth: 68025,
    base_url: explicitPortPrimary,
    backupUrl: [portlessFallback]
  }])),
  {
    kind: 'remote',
    url: portlessFallback,
    backupUrls: [],
    headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0 (SparkSub)' }
  },
  'Bilibili mcdn :8082 primary URLs must be discarded so a SparkScribe-v2-compatible portless backup is promoted'
);
assert.equal(
  BSE.Media.selectBilibiliAudio([{ bandwidth: 68025, base_url: explicitPortPrimary }]),
  null,
  'an explicit-port Bilibili URL without a safe backup must fail before native request construction instead of surfacing INVALID_REQUEST from SparkScribe'
);

const originalNativeHost = BSE.NativeHost;
const captionsNotFound = async () => {
  const error = new Error('No public YouTube captions');
  error.code = 'CAPTIONS_NOT_FOUND';
  error.hint = 'No platform caption was published for this video.';
  error.retriable = false;
  throw error;
};
const setFakeNativeHost = (transcribe, fetchYouTubeCaptions = captionsNotFound, capabilities = nativeCapabilitiesV2()) => {
  BSE.NativeHost = Object.freeze({
    getCapabilities: async () => capabilities,
    transcribe: async (...args) => {
      const result = await transcribe(...args);
      const normalized = Array.isArray(result) ? { cues: result } : { ...(result || {}) };
      if (Number(capabilities?.protocolVersion) === 2 && args[0]?.mediaKey && !normalized.mediaKey) {
        normalized.mediaKey = args[0].mediaKey;
      }
      return normalized;
    },
    fetchYouTubeCaptions
  });
};
const getOnlyQueueItem = async () => {
  const queue = await BSE.Queue.getQueue();
  assert.equal(queue.length, 1, 'fixture must contain one queue item');
  return queue[0];
};
const biliResponse = ({ tracks = [], captionBody = null, dash = dashFixture, tags = [] } = {}) => async (url) => {
  if (url.includes('x/web-interface/view')) return { ok: true, json: async () => ({ code: 0, data: { cid: 42, title: '无字幕 B 站视频', tname: '知识', desc: '用于验证字幕与本地转录链路。', owner: { name: '测试 UP' }, pages: [{ page: 1, cid: 42, part: '正片' }] } }) };
  if (url.includes('x/tag/archive/tags')) return { ok: true, json: async () => ({ code: 0, data: tags.map((tag) => ({ tag_name: tag })) }) };
  if (url.includes('x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  if (url.includes('x/player/wbi/v2')) return { ok: true, json: async () => ({ code: 0, data: { subtitle: { subtitles: tracks } } }) };
  if (url.includes('caption.test')) return { ok: true, json: async () => ({ body: captionBody }) };
  if (url.includes('x/player/playurl')) return { ok: true, json: async () => ({ code: 0, data: { dash: { audio: dash } } }) };
  throw new Error(`Unexpected Bilibili fallback request: ${url}`);
};

await BSE.Queue.clearAll();
let nativeCalls = [];
const queueASRDiagnostics = [];
BSE.Queue.setDiagnosticReporter((event) => queueASRDiagnostics.push(structuredClone(event)));
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 1.5, content: '本地 ASR 完成的字幕。' }];
});
mockFetch = biliResponse({ tags: ['计算机', '408', 'CRC'] });
storageWriteHistory.length = 0;
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1ASRFALL01');
await BSE.Queue.processPendingJobs();
let fallbackItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 1, 'captionless Bilibili must call the native host once');
assert.deepEqual(structuredClone(nativeCalls[0].source), structuredClone(selectedDescriptor), 'Bilibili fallback must submit the shared best DASH descriptor');
assert.equal(fallbackItem.stage, 'done', 'a valid native transcription must complete the queue item');
assert.equal(fallbackItem.subtitle?.source, 'native', 'native output must persist its subtitle source');
assert.equal(fallbackItem.subtitle?.engine, 'local-asr', 'native engine IDs are optional diagnostics; missing IDs normalize to local-asr');
assert.ok(fallbackItem.subtitle?.cueCount > 0 && fallbackItem.subtitle?.plainText, 'done requires non-empty cues and plain text');
const lightweightDoneQueue = await BSE.Queue.getQueue({ hydrateText: false });
assert.equal(lightweightDoneQueue[0]?.subtitle?.plainText, undefined, 'Queue 列表轻量读取不得为已完成任务预生成 plainText');
assert.equal(lightweightDoneQueue[0]?.subtitle?.markdown, undefined, 'Queue 列表轻量读取不得为已完成任务预生成 Markdown');
assert.equal(lightweightDoneQueue[0]?.subtitle?.srt, undefined, 'Queue 列表轻量读取不得为已完成任务预生成 SRT');
assert.ok(lightweightDoneQueue[0]?.subtitle?.cues?.length > 0, '轻量读取仍必须保留 canonical cues 作为唯一字幕事实源');
assert.deepEqual(Array.from(fallbackItem.mediaContext?.tags || []), ['计算机', '408', 'CRC'], '离线转录任务应保留当前 BVID 绑定的标签语境供后续 AI 使用');
assert.equal(fallbackItem.mediaContext?.mediaKey, 'bili:BV1ASRFALL01:cid42', 'AI context 必须绑定当前 authoritative BVID+CID，不能成为无主缓存');
assert.equal(fallbackItem.mediaContext?.category, '知识');
assert.equal(nativeCalls[0].mediaKey, 'bili:BV1ASRFALL01:cid42', 'Native ASR request 必须携带 authoritative BVID+CID 作为端到端相关性标识');
assert.deepEqual(structuredClone(nativeCalls[0].asrContext), {
  topic: '无字幕 B 站视频',
  terms: ['计算机', '408', 'CRC', '知识']
}, 'Bilibili 离线转录应优先上传语义标签，分类仅作为剩余预算的兜底，不上传简介/作者/正文');
const asrInputDiagnostic = queueASRDiagnostics.find((event) => event?.code === 'NATIVE_ASR_REQUEST');
assert.ok(asrInputDiagnostic, '离线转录必须写入结构化 ASR 输入诊断日志');
assert.match(asrInputDiagnostic.message, /media=bili:BV1ASRFALL01:cid42/);
assert.match(asrInputDiagnostic.message, /topic=无字幕 B 站视频/);
assert.match(asrInputDiagnostic.message, /terms=计算机, 408, CRC, 知识/);
BSE.Queue.setDiagnosticReporter(null);
assert.equal(JSON.stringify(storageWriteHistory).includes('secret-primary'), false, 'a Bilibili signed primary URL must never be persisted');
assert.equal(JSON.stringify(storageWriteHistory).includes('secret-backup'), false, 'a Bilibili signed backup URL must never be persisted');

// Explicit local-asr is a hard product intent: it must not reuse an open tab's
// subtitles even when that tab belongs to the exact same BVID+CID.
await BSE.Queue.clearAll();
nativeCalls = [];
const tabsBeforeExplicitLocal = context.chrome.tabs;
let explicitLocalTabReads = 0;
context.chrome.tabs = {
  query: async () => [{ id: 701, url: 'https://www.bilibili.com/video/BV1LOCALASR01' }],
  sendMessage: async (_tabId, message) => {
    if (message?.type === 'BSE_GET_STATE') {
      explicitLocalTabReads += 1;
      return {
        status: 'ready',
        mediaKey: 'bili:BV1LOCALASR01:cid42',
        cues: [{ from: 0, to: 2, content: '平台已有字幕，但明确离线转录时不能采用。' }],
        tracks: [{ id: 'platform-ready', lan: 'zh-CN', lanDoc: '平台字幕' }]
      };
    }
    return null;
  }
};
mockFetch = biliResponse({
  tracks: [{ lan: 'zh-CN', lan_doc: '官方字幕', subtitle_url: 'https://caption.test/local-intent' }],
  captionBody: [{ from: 0, to: 2, content: '官方字幕也不应进入明确离线转录。' }]
});
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 2.5, content: '这是当前视频自己的 SparkScribe 离线转录。' }];
});
await BSE.Queue.addToQueue([{
  url: 'https://www.bilibili.com/video/BV1LOCALASR01',
  mediaKey: 'bili:BV1LOCALASR01:cid42',
  processingIntent: 'local-asr'
}], { processingIntent: 'local-asr' });
await BSE.Queue.processPendingJobs();
let explicitLocalItem = await getOnlyQueueItem();
assert.equal(explicitLocalTabReads, 0, 'explicit local-asr must not inspect tab caption state at all');
assert.equal(nativeCalls.length, 1, 'explicit local-asr must call SparkScribe exactly once');
assert.equal(explicitLocalItem.processingIntent, 'local-asr');
assert.equal(explicitLocalItem.subtitle?.source, 'native');
assert.match(explicitLocalItem.subtitle?.plainText, /当前视频自己的 SparkScribe/);
assert.doesNotMatch(explicitLocalItem.subtitle?.plainText || '', /平台已有字幕|官方字幕也不应/);
context.chrome.tabs = tabsBeforeExplicitLocal;

// Explicit local-ASR requests are not allowed to degrade to URL-only identity.
// This protects mixed-version/stale content scripts from starting a task while
// Bilibili is still switching BVID/CID in an SPA tab.
await BSE.Queue.clearAll();
await assert.rejects(
  () => BSE.Queue.addToQueue([{
    url: 'https://www.bilibili.com/video/BV1NOIDENT01',
    processingIntent: 'local-asr'
  }], { processingIntent: 'local-asr' }),
  (error) => error?.code === 'INVALID_REQUEST',
  'explicit Bilibili local-asr must require an exact current media identity'
);

// Protocol v2 echoes mediaKey. A result that claims another media owner must
// never be committed even when its cues are otherwise perfectly valid.
await BSE.Queue.clearAll();
mockFetch = biliResponse();
setFakeNativeHost(async (payload) => ({
  cues: [{ from: 0, to: 2, content: '这份内容来自另一个视频，必须被拦截。' }],
  mediaKey: 'bili:BV1OTHER0001:cid999'
}));
await BSE.Queue.addToQueue([{
  url: 'https://www.bilibili.com/video/BV1ECHOGUARD1',
  mediaKey: 'bili:BV1ECHOGUARD1:cid42',
  processingIntent: 'local-asr'
}], { processingIntent: 'local-asr' });
await BSE.Queue.processPendingJobs();
const echoMismatchItem = await getOnlyQueueItem();
assert.equal(echoMismatchItem.stage, 'failed', 'cross-media native result must fail closed');
assert.equal(echoMismatchItem.errorCode, 'RESULT_INCOMPLETE');
assert.equal(echoMismatchItem.subtitle, undefined, 'cross-media native cues must never be persisted as subtitles');

// An in-flight job created under an older or different media identity must never
// satisfy a new explicit local-ASR click for the same queue ID. Reusing it would
// make the UI appear to transcribe the current video while an old CID keeps running.
await BSE.Queue.clearAll();
await BSE.Queue.saveQueue([{
  id: 'BV1ACTIVEID01',
  url: 'https://www.bilibili.com/video/BV1ACTIVEID01',
  platform: 'bilibili',
  targetId: 'BV1ACTIVEID01',
  title: '旧活动任务',
  author: '测试',
  stage: 'transcribing',
  progress: 80,
  sourceLanguage: 'zh',
  processingIntent: 'auto',
  expectedMediaKey: 'bili:BV1ACTIVEID01:cid41',
  page: 1,
  addedAt: Date.now(),
  startedAt: Date.now()
}]);
await assert.rejects(
  () => BSE.Queue.addToQueue([{
    url: 'https://www.bilibili.com/video/BV1ACTIVEID01',
    mediaKey: 'bili:BV1ACTIVEID01:cid42',
    processingIntent: 'local-asr'
  }], { processingIntent: 'local-asr' }),
  (error) => error?.code === 'BUSY',
  'active work owned by another CID must never be silently reused for the current video'
);
const activeIdentityItem = await getOnlyQueueItem();
assert.equal(activeIdentityItem.expectedMediaKey, 'bili:BV1ACTIVEID01:cid41', 'rejecting the new click must not mutate the active job identity');
assert.equal(activeIdentityItem.processingIntent, 'auto', 'rejecting the new click must not silently change the active job policy');

// The CID captured by the page is only a claim until Bilibili's authoritative
// view endpoint confirms the BVID -> page -> CID mapping. A stale SPA CID must
// fail before media acquisition or SparkScribe invocation.
await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse();
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 2, content: '不应执行到本地转录。' }];
});
await BSE.Queue.addToQueue([{
  url: 'https://www.bilibili.com/video/BV1CIDPROOF01',
  mediaKey: 'bili:BV1CIDPROOF01:cid41',
  processingIntent: 'local-asr'
}], { processingIntent: 'local-asr' });
await BSE.Queue.processPendingJobs();
const staleCidItem = await getOnlyQueueItem();
assert.equal(staleCidItem.stage, 'failed', 'stale page CID must fail closed after authoritative metadata resolution');
assert.equal(staleCidItem.errorCode, 'INVALID_REQUEST');
assert.equal(nativeCalls.length, 0, 'a CID rejected by Bilibili metadata must never reach SparkScribe');

// A completed caption-first item must not block a later explicit offline request.
// Clicking local-asr is an explicit re-run request, not a request to return the old done item.
await BSE.Queue.clearAll();
nativeCalls = [];
mockFetch = biliResponse({
  tracks: [{ lan: 'zh-CN', lan_doc: '平台字幕', subtitle_url: 'https://caption.test/rerun-local' }],
  captionBody: [{ from: 0, to: 2, content: '第一次任务使用的平台字幕。' }]
});
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 2, content: '第二次任务明确要求的离线转录。' }];
});
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1RERUNLOC1');
await BSE.Queue.processPendingJobs();
let rerunLocalItem = await getOnlyQueueItem();
assert.equal(rerunLocalItem.subtitle?.source, 'platform');
assert.match(rerunLocalItem.subtitle?.plainText, /第一次任务/);
assert.equal(nativeCalls.length, 0);
mockFetch = biliResponse({ tracks: [] });
await BSE.Queue.addToQueue([{
  url: 'https://www.bilibili.com/video/BV1RERUNLOC1',
  mediaKey: 'bili:BV1RERUNLOC1:cid42',
  processingIntent: 'local-asr'
}], { processingIntent: 'local-asr' });
await BSE.Queue.processPendingJobs();
rerunLocalItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 1, 'explicit local-asr must re-run a previously completed caption-first item');
assert.equal(rerunLocalItem.processingIntent, 'local-asr');
assert.equal(rerunLocalItem.subtitle?.source, 'native');
assert.match(rerunLocalItem.subtitle?.plainText, /第二次任务明确要求/);
assert.doesNotMatch(rerunLocalItem.subtitle?.plainText || '', /第一次任务/);

// Same-owner caption artifacts are still ignored for explicit local-asr. This
// prevents restored queue state from silently changing an offline request back
// into a caption-reuse request.
await BSE.Queue.clearAll();
nativeCalls = [];
await BSE.Queue.saveQueue([{
  id: 'BV1LOCALCACHE1',
  url: 'https://www.bilibili.com/video/BV1LOCALCACHE1',
  platform: 'bilibili',
  targetId: 'BV1LOCALCACHE1',
  title: '缓存字幕离线转录测试',
  author: '测试 UP',
  stage: 'queued',
  progress: 0,
  sourceLanguage: 'zh',
  processingIntent: 'local-asr',
  expectedMediaKey: 'bili:BV1LOCALCACHE1:cid42',
  page: 1,
  addedAt: Date.now(),
  metaCache: { title: '缓存字幕离线转录测试', cid: 42, mediaKey: 'bili:BV1LOCALCACHE1:cid42' },
  stageArtifacts: {
    metadataResolved: true,
    mediaKey: 'bili:BV1LOCALCACHE1:cid42',
    captionTracks: [{ id: 'stale-official', lan: 'zh-CN', lan_doc: '缓存官方字幕', subtitle_url: 'https://caption.test/stale-local' }],
    captionBody: [{ from: 0, to: 3, content: '这是恢复出来的字幕缓存，不能用于明确离线转录。' }],
    captionTrackId: 'stale-official'
  }
}]);
mockFetch = biliResponse();
setFakeNativeHost(async (payload) => {
  nativeCalls.push(structuredClone(payload));
  return [{ from: 0, to: 2, content: '恢复任务仍然重新转录当前媒体。' }];
});
await BSE.Queue.processPendingJobs();
let localCacheItem = await getOnlyQueueItem();
assert.equal(nativeCalls.length, 1, 'local-asr must ignore persisted caption artifacts and invoke SparkScribe');
assert.equal(localCacheItem.subtitle?.source, 'native');
assert.match(localCacheItem.subtitle?.plainText, /重新转录当前媒体/);
assert.doesNotMatch(localCacheItem.subtitle?.plainText || '', /字幕缓存/);

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

// YouTube explicit local-asr has the same hard boundary: no page caption
// discovery and no native YouTube-caption request may run before ASR.
await BSE.Queue.clearAll();
nativeCalls = [];
let explicitYouTubeCaptionCalls = 0;
setFakeNativeHost(
  async (payload) => {
    nativeCalls.push(structuredClone(payload));
    return [{ from: 0, to: 2, content: 'YouTube 当前视频本地转录。' }];
  },
  async () => {
    explicitYouTubeCaptionCalls += 1;
    return {
      cues: [{ from: 0, to: 2, content: '不应该读取的 YouTube 平台字幕。' }],
      language: 'en',
      langDoc: 'English',
      kind: 'manual'
    };
  }
);
mockFetch = async (url) => {
  throw new Error(`explicit YouTube local-asr must not fetch caption metadata: ${url}`);
};
await BSE.Queue.addToQueue([{
  url: 'https://www.youtube.com/watch?v=LOCALYTASR1',
  mediaKey: 'yt:LOCALYTASR1',
  processingIntent: 'local-asr'
}], { processingIntent: 'local-asr' });
await BSE.Queue.processPendingJobs();
let explicitYouTubeItem = await getOnlyQueueItem();
assert.equal(explicitYouTubeCaptionCalls, 0, 'explicit YouTube local-asr must skip native platform-caption lookup');
assert.equal(nativeCalls.length, 1, 'explicit YouTube local-asr must call ASR exactly once');
assert.deepEqual(structuredClone(nativeCalls[0].source), { kind: 'youtube', url: 'https://www.youtube.com/watch?v=LOCALYTASR1' });
assert.equal(explicitYouTubeItem.subtitle?.source, 'native');
assert.match(explicitYouTubeItem.subtitle?.plainText, /当前视频本地转录/);

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
  query: async () => [{ id: 9, url: 'https://www.youtube.com/watch?v=ASRACTIVET1' }],
  sendMessage: async () => ({ ok: true, result: {
    videoId: 'ASRACTIVET1', title: '活动页优先级', author: '测试',
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
  query: async () => [{ id: 10, url: 'https://www.youtube.com/watch?v=ASRDIRECT01' }],
  sendMessage: async () => ({ ok: true, result: {
    videoId: 'ASRDIRECT01', title: '无轨道原生 Transcript', author: '测试', captionTracks: [],
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
  query: async () => [{ id: 11, url: 'https://www.youtube.com/watch?v=ASRDIRECT02' }],
  sendMessage: async () => ({ ok: true, result: {
    videoId: 'ASRDIRECT02', title: '轨道后原生 Transcript', author: '测试',
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
  if (url.includes('x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1ASRCACHE1', cid: 91, title: '缓存轨道', pages: [{ page: 1, cid: 91, part: '正片' }] } }) };
  }
  if (url.includes('x/player/wbi/v2')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1ASRCACHE1', cid: 91, subtitle: { subtitles: [
      { id_str: 'fresh-manual', lan: 'en', lan_doc: 'Manual', subtitle_url: 'https://caption.fresh/manual' }
    ] } } }) };
  }
  if (url.includes('caption.fresh/manual')) {
    cachedBiliRequests.push('fresh-manual');
    return { ok: true, json: async () => ({ body: [{ from: 0, to: 1, content: '当前媒体重新获取的手动字幕' }] }) };
  }
  if (url.includes('caption.cache/')) {
    cachedBiliRequests.push('stale-cache');
    return { ok: true, json: async () => ({ body: [{ from: 0, to: 1, content: '不应读取的旧缓存字幕' }] }) };
  }
  throw new Error(`unexpected Bilibili cache refresh request: ${url}`);
};
await BSE.Queue.processPendingJobs();
fallbackItem = await getOnlyQueueItem();
assert.deepEqual(cachedBiliRequests, ['fresh-manual'], '没有 BVID+CID owner 的旧 Bilibili stageArtifacts 必须整包丢弃，只能重新请求当前媒体');
assert.equal(fallbackItem.subtitle?.language, 'en');
assert.match(fallbackItem.subtitle?.plainText, /当前媒体重新获取/);

const identifiedCachedBiliRequests = [];
await BSE.Queue.clearAll();
await BSE.Queue.saveQueue([{
  id: 'BV1ASRCACHE2', platform: 'bilibili', targetId: 'BV1ASRCACHE2', url: 'https://www.bilibili.com/video/BV1ASRCACHE2', title: '有身份缓存', author: '测试', stage: 'queued', progress: 0,
  metaCache: { cid: 92, title: '有身份缓存' },
  stageArtifacts: {
    mediaKey: 'bili:BV1ASRCACHE2:cid92',
    captionTracks: [
      { id_str: 'manual-id', lan: 'en', lan_doc: 'Manual', subtitle_url: 'https://caption.cache2/manual' },
      { id_str: 'translated-id', lan: 'zh-Hans', lan_doc: '中文翻译', subtitle_url: 'https://caption.cache2/translated', isTranslated: true }
    ],
    captionBody: [{ from: 0, to: 1, content: '有身份的翻译缓存' }], captionTrackId: 'translated-id'
  }
}]);
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1ASRCACHE2', cid: 92, title: '有身份缓存', pages: [{ page: 1, cid: 92, part: '正片' }] } }) };
  }
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
// Simulate an installation created before the indexed queue representation existed.
storageAreas.local.delete('bse_transcription_queue_v1:index');
const rawMigrationId = 'BV1ASRMIGR01';
const rawMigrationKey = `bse_transcription_queue_v1:item:${encodeURIComponent(rawMigrationId)}`;
const rawMigrationProjectionKey = `bse_transcription_queue_v1:projection:${encodeURIComponent(rawMigrationId)}`;
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
assert.equal(storageAreas.local.get('bse_transcription_queue_v1:schema'), 3, 'queue migration must persist its storage schema version');
const migratedProjection = storageAreas.local.get(rawMigrationProjectionKey);
assert.ok(migratedProjection, 'queue v3 migration must backfill a lightweight list projection');
assert.equal(migratedProjection.subtitle?.cues, undefined, 'queue list projection must never contain canonical cues');
assert.equal(/plainText|markdown|\"srt\"|\"cues\"/.test(JSON.stringify(migratedProjection)), false, 'queue list projection must contain metadata only');
storageWriteHistory.length = 0;
await BSE.Queue.getQueue();
assert.equal(storageWriteHistory.length, 0, 'a current indexed queue read must not rewrite or deep-sanitize persisted items');
await BSE.Queue.saveItem(migratedItem);
assert.equal(storageWriteHistory.length, 1, 'updating an existing indexed item should require one storage write');
assert.ok(rawMigrationProjectionKey in storageWriteHistory[0], 'item and queue-list projection must update in the same storage write');
assert.equal('bse_transcription_queue_v1:index' in storageWriteHistory[0], false, 'existing-item updates must not rewrite an unchanged queue index');
assert.equal('bse_transcription_queue_v1:schema' in storageWriteHistory[0], false, 'existing-item updates must not rewrite an unchanged queue schema marker');

await BSE.Queue.saveQueue([{
  id: 'BV1FASTPATH01',
  platform: 'bilibili',
  targetId: 'BV1FASTPATH01',
  url: 'https://www.bilibili.com/video/BV1FASTPATH01',
  title: '进度快路径',
  author: '测试',
  stage: 'transcribing',
  progress: 40,
  stageHint: '正在转录',
  addedAt: Date.now()
}]);
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
await BSE.Queue.saveItem({
  id: 'BV1FASTPATH01',
  platform: 'bilibili',
  targetId: 'BV1FASTPATH01',
  url: 'https://www.bilibili.com/video/BV1FASTPATH01',
  title: '进度快路径',
  author: '测试',
  stage: 'transcribing',
  progress: 41,
  stageHint: '正在转录',
  addedAt: Date.now()
});
const fastPathReads = storageReadHistory.filter((entry) => entry.area === 'local');
assert.equal(fastPathReads.length, 1, 'pending 任务的高频进度保存必须只读取当前 item + schema，不得扫描整个 Queue');
assert.ok(Array.isArray(fastPathReads[0].key) && fastPathReads[0].key.includes('bse_transcription_queue_v1:schema'), 'pending fast path 必须验证当前 storage schema');
assert.ok(fastPathReads[0].key.includes(`bse_transcription_queue_v1:item:${encodeURIComponent('BV1FASTPATH01')}`), 'pending fast path 只应读取当前任务记录');
assert.equal(storageWriteHistory.length, 1, 'pending fast path 每次进度更新只应执行一次 storage write');
assert.ok(`bse_transcription_queue_v1:projection:${encodeURIComponent('BV1FASTPATH01')}` in storageWriteHistory[0], 'pending progress write 必须在同一次 storage write 中同步 projection');
assert.equal('bse_transcription_queue_v1:summary' in storageWriteHistory[0], false, 'pending→pending 不改变 total/pending，不能每秒重写 Queue summary');

// Queue v3 list reads must stay metadata-only even when completed items contain long canonical cues.
await BSE.Queue.clearAll();
const projectionFixtureCues = (prefix) => Array.from({ length: 1200 }, (_, index) => ({
  from: index * 2,
  to: index * 2 + 1.5,
  content: `${prefix} 第 ${index + 1} 句长字幕正文`
}));
const projectionFixtureItems = [
  {
    id: 'projection-detail-a', platform: 'youtube', targetId: 'PROJDETA001', url: 'https://www.youtube.com/watch?v=PROJDETA001',
    title: 'Projection A', author: 'Author A', cover: 'https://i.ytimg.com/vi/PROJDETA001/hqdefault.jpg', stage: 'done', progress: 100,
    sourceLanguage: 'zh', addedAt: 200, completedAt: 300,
    subtitle: { language: 'zh-CN', langDoc: '中文', cueCount: 1200, source: 'native', engine: 'local-asr', cues: projectionFixtureCues('A') }
  },
  {
    id: 'projection-detail-b', platform: 'youtube', targetId: 'PROJDETB001', url: 'https://www.youtube.com/watch?v=PROJDETB001',
    title: 'Projection B', author: 'Author B', stage: 'done', progress: 100,
    sourceLanguage: 'en', addedAt: 100, completedAt: 250,
    subtitle: { language: 'en', langDoc: 'English', cueCount: 1200, source: 'platform', engine: 'youtube', captionKind: 'manual', cues: projectionFixtureCues('B') }
  }
];
await BSE.Queue.saveQueue(projectionFixtureItems);
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
const projectedQueue = await BSE.Queue.getQueueProjection();
assert.equal(projectedQueue.length, 2, 'queue projection must preserve every queue card');
assert.equal(projectedQueue[0].subtitle?.cueCount, 1200, 'queue projection must retain cueCount without carrying cue bodies');
assert.equal(projectedQueue[0].subtitle?.source, 'native', 'queue projection must retain card source metadata');
assert.equal(/plainText|markdown|\"srt\"|\"cues\"/.test(JSON.stringify(projectedQueue)), false, 'normal queue projection result must not expose canonical or derived subtitle bodies');
const projectionReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(projectionReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'opening the queue list on schema v3 must not read any full item record');
assert.ok(projectionReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:projection:')), 'opening the queue list must read lightweight projection records');
assert.equal(storageWriteHistory.length, 0, 'healthy schema-v3 projection reads must be read-only');

// A dead indexed record must be repaired locally without rereading healthy completed cue bodies.
const orphanItemKey = 'bse_transcription_queue_v1:item:projection-orphan';
storageAreas.local.set('bse_transcription_queue_v1:index', [
  ...storageAreas.local.get('bse_transcription_queue_v1:index'),
  orphanItemKey
]);
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
const repairedProjectionQueue = await BSE.Queue.getQueueProjection();
assert.equal(repairedProjectionQueue.length, 2, 'dead queue index entries must not create phantom cards');
const orphanRepairReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(orphanRepairReadKeys.includes(orphanItemKey), 'projection repair may inspect the one missing indexed item');
assert.equal(orphanRepairReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-a'), false, 'projection repair must not reread healthy canonical item A');
assert.equal(orphanRepairReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-b'), false, 'projection repair must not reread healthy canonical item B');
assert.equal(storageAreas.local.get('bse_transcription_queue_v1:index').includes(orphanItemKey), false, 'dead indexed items must be removed from the authoritative queue index');
assert.equal(storageAreas.local.get('bse_transcription_queue_v1:summary')?.total, 2, 'dead-index repair must restore Queue summary from surviving projections');

// A detail action must read and hydrate exactly one canonical item, not the whole queue.
storageReadHistory.length = 0;
const projectedDetail = await BSE.Queue.getItem('projection-detail-a');
assert.equal(projectedDetail?.subtitle?.cues?.length, 1200, 'single-item detail must preserve canonical cues');
assert.match(projectedDetail?.subtitle?.plainText || '', /A 第 1 句长字幕正文/, 'single-item detail may derive text after explicit user demand');
const detailReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(detailReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-a'), 'single-item detail must read its own canonical item record');
assert.equal(detailReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-b'), false, 'single-item detail must not read another completed item');
assert.equal(storageReadHistory.length, 1, 'schema-v3 single-item detail should use one storage read IPC');

// Existing v2 installations pay one full-item migration, then all future list reads are projection-only.
storageAreas.local.set('bse_transcription_queue_v1:schema', 2);
storageAreas.local.delete('bse_transcription_queue_v1:projection:projection-detail-a');
storageAreas.local.delete('bse_transcription_queue_v1:projection:projection-detail-b');
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
const migratedV2Projection = await BSE.Queue.getQueueProjection();
assert.equal(storageAreas.local.get('bse_transcription_queue_v1:schema'), 3, 'first v2 queue-list read must upgrade storage to schema v3');
assert.equal(migratedV2Projection.length, 2);
assert.equal(/\"cues\"/.test(JSON.stringify(migratedV2Projection)), false, 'v2 migration must return only projection data to the caller');
const v2MigrationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(v2MigrationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), 'v2 upgrade is allowed one full-item read to backfill projections');
assert.equal(storageWriteHistory.length, 1, 'v2 upgrade must backfill item projections in one storage write');
assert.ok('bse_transcription_queue_v1:projection:projection-detail-a' in storageWriteHistory[0], 'v2 migration write must contain the first item projection');
assert.ok('bse_transcription_queue_v1:projection:projection-detail-b' in storageWriteHistory[0], 'v2 migration write must contain the second item projection');
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
await BSE.Queue.getQueueProjection();
const postMigrationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(postMigrationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'after v2→v3 migration, reopening the queue must never reread canonical items');
assert.equal(storageWriteHistory.length, 0, 'after migration, reopening the queue must not rewrite storage');

storageReadHistory.length = 0;
const selectedMergedExport = await BSE.Queue.exportQueueMergedMarkdown(['projection-detail-a']);
assert.match(selectedMergedExport, /Projection A/, 'selected merged export must include the requested completed item');
assert.equal(selectedMergedExport.includes('Projection B'), false, 'selected merged export must exclude unrequested completed items');
const selectedExportReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(selectedExportReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-a'), 'selected merged export must read the requested canonical item');
assert.equal(selectedExportReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-b'), false, 'selected merged export must not read unrequested canonical items');

// Queue mutations and idle executor scans must stay proportional to active/selected items,
// not historical completed transcript bodies.
storageReadHistory.length = 0;
storageWriteHistory.length = 0;
const [narrowMutationItem] = await BSE.Queue.addToQueue('https://www.youtube.com/watch?v=MUTATE00001', {
  title: 'Narrow mutation item',
  author: 'Queue test'
});
let narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(narrowMutationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'adding a new queue item must not read any historical canonical item');

storageReadHistory.length = 0;
storageWriteHistory.length = 0;
await BSE.Queue.saveItem({
  ...narrowMutationItem,
  stage: 'done',
  progress: 100,
  stageHint: '完成',
  completedAt: Date.now(),
  subtitle: {
    language: 'en',
    langDoc: 'English',
    cueCount: 1,
    source: 'native',
    engine: 'local-asr',
    cues: [{ from: 0, to: 1, content: 'terminal transition' }]
  }
});
narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:MUTATE00001'), 'terminal save must verify only the current canonical item');
assert.equal(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-a'), false, 'terminal save must not read historical completed item A');
assert.equal(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-b'), false, 'terminal save must not read historical completed item B');
assert.equal(storageReadHistory.length, 1, 'terminal save should verify current item/schema/summary in one storage read IPC');
assert.equal(storageWriteHistory.length, 1, 'terminal save must persist item, projection and summary in one storage write IPC');
assert.ok('bse_transcription_queue_v1:summary' in storageWriteHistory[0], 'terminal transition must update Queue summary in the same write');

storageReadHistory.length = 0;
assert.equal(await BSE.Queue.removeFromQueue('MUTATE00001'), true);
narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(narrowMutationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'removing one item must use projection/index metadata without reading canonical bodies');

storageReadHistory.length = 0;
await BSE.Queue.processPendingJobs();
narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(narrowMutationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'idle executor scans over completed history must not read canonical item records');

const retryProjectionFixture = {
  id: 'projection-retry-one', platform: 'youtube', targetId: 'RETRYPROJ01', url: 'https://www.youtube.com/watch?v=RETRYPROJ01',
  title: 'Retry projection fixture', author: 'Queue test', stage: 'failed', progress: 0, addedAt: 50,
  errorCode: 'ASR_FAILED', error: 'failed'
};
await BSE.Queue.saveQueue([...projectionFixtureItems, retryProjectionFixture]);
storageReadHistory.length = 0;
const retriedProjectionItem = await BSE.Queue.retryItem(retryProjectionFixture.id);
assert.equal(retriedProjectionItem?.stage, 'queued', 'retry must still restore the selected failed item');
narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.ok(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:projection-retry-one'), 'retry must load the selected item body');
assert.equal(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-a'), false, 'retry must not load completed history item A');
assert.equal(narrowMutationReadKeys.includes('bse_transcription_queue_v1:item:projection-detail-b'), false, 'retry must not load completed history item B');

await BSE.Queue.removeFromQueue(retryProjectionFixture.id);
storageReadHistory.length = 0;
const projectionClearCount = await BSE.Queue.clearCompleted();
assert.equal(projectionClearCount, 2, 'clearCompleted must remove both completed projection fixtures');
narrowMutationReadKeys = storageReadHistory.flatMap(({ key }) => Array.isArray(key) ? key : [key]).filter((key) => typeof key === 'string');
assert.equal(narrowMutationReadKeys.some((key) => key.startsWith('bse_transcription_queue_v1:item:')), false, 'clearCompleted must delete completed records from projection metadata without reading cue bodies');

await BSE.Queue.clearAll();
// Legacy whole-array installations also predate the queue index.
storageAreas.local.delete('bse_transcription_queue_v1:index');
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
  ['NATIVE_HOST_NOT_INSTALLED', false, '未检测到 SparkScribe 浏览器集成服务。', '请安装或更新 SparkScribe 后重试。'],
  ['NATIVE_HOST_DISCONNECTED', true, '本机转录服务已断开。', '请重新连接本机服务后重试。'],
  ['NATIVE_HOST_TIMEOUT', true, '本机转录服务响应超时。', '请确认本机服务仍在运行后重试。'],
  ['PROTOCOL_MISMATCH', false, '浏览器集成服务协议不兼容。', '请同时更新 SparkSub 与 SparkScribe。'],
  ['PROTOCOL_MESSAGE_TOO_LARGE', true, '本机转录服务返回的数据过大。', '请重试；如持续发生请更新本机服务。'],
  ['YTDLP_NOT_INSTALLED', false, '未安装 YouTube 下载组件。', '请完成本机服务安装后重试。'],
  ['YTDLP_CHECKSUM_FAILED', false, 'YouTube 下载组件校验失败。', '请重新安装本机服务。'],
  ['MEDIA_AUTH_REQUIRED', false, '该媒体需要登录或访问权限。', '目前仅支持公开可访问的视频。'],
  ['MEDIA_DOWNLOAD_FAILED', true, '媒体下载失败。', '请确认视频公开可访问后重试。'],
  ['MODEL_NOT_FOUND', false, '未找到本机转录模型。', '请安装受支持的本机模型后重试。'],
  ['MODEL_LAYOUT_INCOMPATIBLE', false, '本机转录模型布局不兼容。', '请检查模型版本或重新安装模型。'],
  ['ASR_LANGUAGE_UNSUPPORTED', false, '当前本机字幕引擎不支持所选语言。', '请使用平台字幕，或在 SparkScribe 中安装支持该语言的本地模型。'],
  ['ASR_FAILED', true, '本地转录失败。', '请检查本机转录服务后重试。'],
  ['RESULT_INCOMPLETE', true, '本机转录结果不完整。', '请重试此任务。'],
  ['CANCELLED', false, '转录已取消。', '可在准备好后重新开始任务。'],
  ['INVALID_REQUEST', false, '本机转录请求无效。', '请检查视频和转录设置后重试。'],
  ['BUSY', true, 'SparkScribe 正在处理另一项本机推理任务。', '等待当前任务结束后重试。']
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
assert.match(fallbackItem.error, /不支持所选语言/, 'language rejection must follow the negotiated host capability rather than a hard-coded Cantonese rule');

// Task 5: UI-safe native-host setup, deterministic language routing, and
// source/engine presentation are tested as pure helpers before sidepanel code.
const queueUiContext = vm.createContext({ console, globalThis: null });
queueUiContext.globalThis = queueUiContext;
for (const file of ['core/namespace.js', 'core/i18n.js', 'core/language-routing.js', 'core/queue-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), queueUiContext, { filename: file });
}
const queueUi = queueUiContext.BSE.QueueUI;
const languageRouting = queueUiContext.BSE.LanguageRouting;
assert.ok(queueUi, 'Queue UI helpers must expose language, capability, and safe-card presentation');
assert.deepEqual([...queueUi.SUPPORTED_SOURCE_LANGUAGES], [
  'auto', 'zh', 'yue', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ro', 'nl', 'da', 'sv', 'fi', 'hu', 'et', 'lv', 'lt', 'mt', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ru', 'uk', 'be', 'bg', 'sr', 'el'
], 'source-language selector is a user vocabulary; actual local support comes from host capabilities');
assert.equal(languageRouting.localASRSupport(nativeCapabilitiesV2(), 'zh'), true);
assert.equal(languageRouting.localASRSupport(nativeCapabilitiesV2(), 'en-US'), true);
assert.equal(languageRouting.localASRSupport(nativeCapabilitiesV2(), 'yue'), false, 'client must honor the installed host capability instead of hard-coding a model route');
assert.equal(languageRouting.localASRSupport(nativeCapabilitiesV2({ languages: ['en', 'zh', 'yue'] }), 'yue-HK'), true, 'a future SparkScribe host can enable Cantonese without changing browser routing code');
assert.equal(languageRouting.localASRSupport(nativeCapabilitiesV2(), 'auto'), true);
assert.equal(queueUi.sourceEngineLabel({ stage: 'done', platform: 'bilibili', subtitle: { source: 'platform', engine: 'bilibili' } }).key, 'queue_source_platform_bilibili');
assert.equal(queueUi.sourceEngineLabel({ stage: 'done', platform: 'youtube', sourceLanguage: 'zh', subtitle: { source: 'native', engine: 'qwen3-1.7b' } }).key, 'queue_engine_local_asr', 'native model IDs are opaque diagnostics, not UI routing keys');
assert.equal(queueUi.capabilityState(nativeCapabilitiesV2()).key, 'queue_capability_ready');
assert.equal(queueUi.capabilityState(nativeCapabilitiesV2({ localASR: false, youtubeCaptions: true, youtubeRemote: true })).key, 'queue_capability_partial');
assert.equal(queueUi.componentState('localASR', { available: false, detail: 'not ready' }).key, 'queue_capability_partial');
assert.equal(queueUi.capabilityState(null, { code: 'NATIVE_HOST_NOT_INSTALLED' }).key, 'queue_capability_not_installed');
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
queueUi.renderCapabilityPanel(fakeCapabilityPanel, fakeCapabilityStatus, fakeCapabilityDetails, nativeCapabilitiesV2({
  localASR: true,
  languages: ['en'],
  youtubeCaptions: false,
  youtubeRemote: false,
  bilibiliRemote: true
}), null, (key) => key);
assert.equal(fakeCapabilityPanel.hidden, false);
assert.equal(fakeCapabilityPanel.dataset.state, 'queue_capability_ready');
assert.equal(fakeCapabilityStatus.textContent, 'queue_capability_ready');
assert.match(fakeCapabilityDetails.textContent, /queue_capability_local_asr/);
assert.match(fakeCapabilityDetails.textContent, /queue_capability_youtube_captions/);
assert.match(fakeCapabilityDetails.textContent, /queue_capability_remote_media/);
const capabilityProbe = queueUi.createCapabilityProbeState();
const olderProbe = capabilityProbe.begin();
const currentProbe = capabilityProbe.begin();
assert.equal(capabilityProbe.commit(olderProbe, {
  capabilities: nativeCapabilitiesV2(),
  error: null
}), false, 'an older native capability response must not overwrite a newer probe');
assert.deepEqual({ ...capabilityProbe.snapshot() }, {
  phase: 'checking', capabilities: null, error: null, revision: currentProbe
});
assert.equal(capabilityProbe.commit(currentProbe, { capabilities: null, error: { code: 'NATIVE_HOST_DISCONNECTED' } }), true);
assert.deepEqual({ ...capabilityProbe.snapshot() }, {
  phase: 'settled', capabilities: null, error: { code: 'NATIVE_HOST_DISCONNECTED' }, revision: currentProbe
});
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
const taskFiveAsrPolisherSource = fs.readFileSync(path.join(root, 'core/asr-polisher.js'), 'utf8');
const taskFiveFormattersSource = fs.readFileSync(path.join(root, 'core/formatters.js'), 'utf8');
const taskFiveSidepanelHtml = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.html'), 'utf8');
const taskFiveRollingPanelSource = fs.readFileSync(path.join(root, 'content/rolling-panel.js'), 'utf8');

// Side-panel interaction contract: every static button must have controller evidence,
// and the controller must not keep querying DOM IDs that no longer exist. This catches
// the class of regressions where a visual redesign leaves dead controls behind.
const staticButtonIds = [...taskFiveSidepanelHtml.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((match) => match[1]);
const elementBindings = new Map(
  [...taskFiveSidepanelSource.matchAll(/(\w+): document\.querySelector\(['"]#([^'"]+)['"]\)/g)]
    .map((match) => [match[2], match[1]])
);
for (const id of staticButtonIds) {
  const property = elementBindings.get(id);
  const directListener = property
    ? new RegExp(`elements\\.${property}\\??\\.addEventListener|elements\\.${property}\\.addEventListener`).test(taskFiveSidepanelSource)
    : false;
  const selectorMentions = (taskFiveSidepanelSource.match(new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')) || []).length;
  assert.ok(
    directListener || selectorMentions >= 2,
    `sidepanel static button #${id} must have direct or delegated action wiring`
  );
}
const queriedStaticIds = [
  ...taskFiveSidepanelSource.matchAll(/document\.querySelector\(['"]#([^'"]+)['"]\)|document\.getElementById\(['"]([^'"]+)['"]\)/g)
].map((match) => match[1] || match[2]);
for (const id of new Set(queriedStaticIds)) {
  assert.match(taskFiveSidepanelHtml, new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `sidepanel controller must not query missing DOM id #${id}`);
}
assert.match(taskFiveSidepanelSource, /tabSubtitle\?\.addEventListener\('click',[\s\S]{0,120}switchWorkspace\('subtitle'\)/, '字幕主 Workspace 必须有真实切换逻辑');
assert.match(taskFiveSidepanelSource, /tabLearn\?\.addEventListener\('click',[\s\S]{0,120}switchWorkspace\('learn'\)/, '学习主 Workspace 必须有真实切换逻辑');
assert.match(taskFiveSidepanelSource, /tabReview\?\.addEventListener\('click',[\s\S]{0,120}switchWorkspace\('review'\)/, '复习主 Workspace 必须有真实切换逻辑');
assert.match(taskFiveSidepanelSource, /\['learn', 'review', 'tracker', 'queue'\]\.includes\(tabId\)[\s\S]{0,120}switchWorkspace\(tabId\)/, '程序化导航必须直接识别学习/复习等一级 Workspace');
assert.doesNotMatch(taskFiveSidepanelSource, /tabId === 'ai'/, '旧 ai tab 已无消息生产者和 DOM 入口，不应继续保留无期限兼容分支');
assert.match(taskFiveSidepanelSource, /tabTracker\?\.addEventListener\('click',[\s\S]{0,120}switchWorkspace\('tracker'\)/, '追踪更新必须是一级 Workspace，不得再作为侧栏中的抽屉');
assert.match(taskFiveSidepanelSource, /tabQueue\?\.addEventListener\('click',[\s\S]{0,120}switchWorkspace\('queue'\)/, '转录队列必须是一级 Workspace，不得再作为侧栏中的抽屉');
assert.match(taskFiveSidepanelHtml, /id="tab-tracker"/, '一级工作区导航必须直接包含追踪');
assert.match(taskFiveSidepanelHtml, /id="tab-queue"/, '一级工作区导航必须直接包含转录');
assert.ok(taskFiveSidepanelHtml.indexOf('id="tab-tracker"') < taskFiveSidepanelHtml.indexOf('id="tab-queue"'), '一级工作区导航中追踪应位于转录之前');
assert.doesNotMatch(taskFiveSidepanelHtml, /aux-drawer|aux-drawer-scrim|tracker-drawer-close|queue-drawer-close/, '一级工作区不得保留旧的嵌套抽屉 DOM');
assert.doesNotMatch(taskFiveSidepanelSource, /openAuxDrawer|closeAuxDrawer|activeAuxDrawer|headerTrackerButton|headerQueueButton/, '控制器不得保留旧的嵌套抽屉状态机');
assert.match(taskFiveSidepanelSource, /subtitleLocalAsr\?\.addEventListener\('click',[\s\S]{0,120}enqueueCurrentVideoForLocalASR/, '字幕页本机转录按钮必须绑定当前视频的 local-ASR 流程');
assert.match(taskFiveSidepanelSource, /subtitlePolish\?\.addEventListener\('click',\s*openSubtitlePolishModal\)/, '字幕页“校对”主按钮只负责打开闭环工作流，不应点击即产生隐藏复制副作用');
assert.match(taskFiveSidepanelSource, /subtitlePolishCopyTask\?\.addEventListener[\s\S]{0,900}generateSubtitlePolishPrompt/, '校对工作流必须由明确的“复制校对任务”动作调用专用提示词');
assert.match(taskFiveSidepanelSource, /subtitlePolishApply\?\.addEventListener[\s\S]+?applyPolishResult[\s\S]+?type: 'BSE_APPLY_SUBTITLE_PATCHES'/, '外部校对结果必须经过统一稀疏对齐器后回填当前字幕，而不是停留在复制提示词的半流程');
assert.match(taskFiveSidepanelSource, /subtitlePolishTextarea\?\.addEventListener\('input'[\s\S]+?materializeCues:\s*false/, '校对实时预览只应解析 sparse patch 统计，不得为了预览复制整份长字幕');
assert.match(taskFiveSidepanelSource, /subtitlePolishApply\?\.addEventListener[\s\S]+?materializeCues:\s*false[\s\S]+?BSE_APPLY_SUBTITLE_PATCHES/, 'Side Panel 应用校对时只发送 patch，完整 cue 数组只能由内容页权威 owner 构造一次');
assert.match(taskFiveSidepanelHtml, /id="subtitle-polish-modal"[\s\S]+?id="subtitle-polish-copy-task"[\s\S]+?id="subtitle-polish-textarea"[\s\S]+?id="subtitle-polish-apply"/, '字幕校对必须提供复制任务、粘贴结果与应用修改的完整闭环 UI');
assert.match(contentAppSource, /BSE_APPLY_SUBTITLE_PATCHES[\s\S]+?expectedTrackId[\s\S]+?expectedCueRevision[\s\S]+?cacheBody[\s\S]+?persistCurrentSubtitleState/, '字幕 patch 应同时校验媒体、轨道和 cue revision，并更新内存缓存与持久化缓存');
assert.match(contentAppSource, /const correctionPromise = correctionStore\.recordCorrections[\s\S]+?Promise\.resolve\(correctionPromise\)[\s\S]+?state\.cues = nextCues[\s\S]+?sendResponse\(\{ ok: true/, '显式校对应用必须先持久化 correction patch，再提交内存字幕并向 Side Panel 报告成功');
assert.match(contentAppSource, /function scheduleSessionSnapshot[\s\S]+?requestIdleCallback[\s\S]+?timeout:\s*750[\s\S]+?setTimeout\(writePendingSessionSnapshot,\s*120\)/, '长字幕校对后的 SessionSnapshot 应在空闲阶段合并写入，不能阻塞用户应用校对的关键路径');
const publicStateMetaSource = contentAppSource.match(/function publicStateMeta\([^]*?\n  }\n\n  function publish/)?.[0] || '';
assert.ok(publicStateMetaSource, '内容页必须提供轻量 state meta');
for (const field of ['mediaKey:', 'revision:', 'cueRevision:', 'selectedTrackId:']) {
  assert.ok(publicStateMetaSource.includes(field), `轻量 state meta 必须包含 ${field}`);
}
assert.doesNotMatch(publicStateMetaSource, /\bcues\s*:/, '轻量 state meta 不得携带完整 cues，Side Panel 恢复焦点时不能默认复制整份长字幕');
assert.match(taskFiveSidepanelSource, /loadInitialState\(\{ preferLightweight = false \} = \{\}\)[\s\S]+?BSE_GET_STATE_META[\s\S]+?if \(unchanged\) return;[\s\S]+?BSE_GET_STATE/, 'Side Panel 已有同媒体状态时应先比较轻量 revision meta，只有版本变化才请求完整字幕 state');
assert.match(taskFiveSidepanelSource, /window\.addEventListener\('focus'[\s\S]{0,180}preferLightweight:\s*true[\s\S]+?visibilitychange[\s\S]{0,220}preferLightweight:\s*true/, '普通 focus/visibility 恢复必须走轻量 state 握手，不能反复 structured-clone 长 cues');
assert.match(contentAppSource, /persistCurrentSubtitleState\(\{ persistUnified: false, deferSnapshot: true \}\)/, '字幕 correction 已 durable commit 后只应延后秒开快照，不得同步重复序列化整份 cues');
assert.match(contentAppSource, /function persistentSubtitleKey[\s\S]+?bili:\$\{bvid\}:p\$\{page\}/, '字幕持久化必须使用稳定视频/分P身份，不能随运行时 pN/CID 探测阶段分裂成多份缓存');
assert.match(contentAppSource, /let cues = options\.force \? null : readCachedBody\(cacheKey\)/, '强制重新解析必须真实绕过内存 body cache，不能名为 force 实际仍命中旧正文');
assert.match(contentAppSource, /cachedTrackId[\s\S]+?requestedTrackId[\s\S]+?exactTrackMatch/, '统一字幕缓存只能复用同一 trackId 的正文，禁止中文/英文或人工/自动轨道互相污染');
assert.match(contentAppSource, /applyCorrections\(subtitleKey,[\s\S]+?track\.id/, '重新抓取 base cues 后应按稳定视频+轨道身份安全重放已保存校对，不重新跑昂贵 alignment');
assert.match(contentAppSource, /recordCorrections\([\s\S]+?subtitleKey[\s\S]+?appliedPatches/, '用户校对 overlay 必须绑定稳定字幕缓存 key，而不是瞬时 runtime CID key');
assert.match(contentAppSource, /const appliedPatches = \[\][\s\S]+?const changedCount = appliedPatches\.length[\s\S]+?const nextCues = state\.cues\.map/, '内容页必须先验证少量 patch，再只在确有修改时复制一次完整 cues');
assert.match(taskFiveSidepanelSource, /function renderTranscript\(\)[\s\S]{0,260}currentWorkspace !== 'subtitle'/, '隐藏的学习/复习/追踪/转录工作区不得在状态更新时后台构造长字幕 DOM');
assert.match(taskFiveSidepanelSource, /transcriptViewCacheBaseKey[\s\S]+?transcriptViewCache\.get\(currentTab\)[\s\S]+?cachedView\.nodes/, '同一 cueRevision 下时间轴/阅读两种字幕视图应复用已构造 DOM，而不是每次 type 切换全量重建');
assert.match(taskFiveSidepanelSource, /const timestampView = transcriptViewCache\.get\('timestamp'\)[\s\S]+?rowsByIndex/, '播放进度必须同步更新被暂时 detach 的时间轴视图，复用 DOM 后不能出现旧 active 行');
assert.doesNotMatch(sidePanelCss, /\.ai-import-modal-(?:overlay|card|header|footer|desc|title)/, '字幕校对与外部 AI 导入应共享中性 workflow modal 样式，不保留 AI 专属弹层样式事实源');
assert.doesNotMatch(taskFiveSidepanelSource, /querySelector\(['"]#tab-ai['"]\)/, '学习/复习继续通过统一 AI Workspace 驱动，不得恢复旧 tab-ai');

const dynamicActionSelectors = [
  '.tracker-btn-copy', '.tracker-btn-preview-toggle', '.tracker-expand-btn', '.tracker-btn-retry-sub',
  '.tracker-btn-rename', '.tracker-btn-batch-card', '.tracker-btn-watch', '.tracker-btn-read', '.tracker-btn-del',
  '.btn-apply', '.btn-preview', '.btn-quick-copy', '.btn-copy', '.btn-download-txt', '.btn-download-srt', '.btn-retry', '.btn-remove',
  '.btn-delete-tray-card', '.batch-tree-sec-btn', '.batch-tree-video-btn'
];
for (const selector of dynamicActionSelectors) {
  assert.ok(taskFiveSidepanelSource.includes(selector), `dynamic action ${selector} must retain an implemented handler`);
}
const taskFiveBackgroundSource = fs.readFileSync(path.join(root, 'background/service-worker.js'), 'utf8');
assert.match(
  taskFiveBackgroundSource,
  /injectContentScripts[\s\S]+?files:\s*\[\s*'core\/namespace\.js',\s*'core\/diagnostics\.js'[\s\S]+?'content\/app\.js'/,
  'dynamic injection must load diagnostics before content/app.js'
);
assert.match(taskFiveSidepanelSource, /BSE_NATIVE_CAPABILITIES/, 'capability diagnostics must go through the Service Worker proxy');
assert.match(taskFiveSidepanelSource, /scope:\s*'batch'[\s\S]+?sessionId:\s*diagnosticSessions\.batch/, 'batch diagnostics must use an explicit batch scope and operation session');
const taskFiveQueueSource = fs.readFileSync(path.join(root, 'core/queue.js'), 'utf8');
assert.match(taskFiveQueueSource, /code:\s*'NATIVE_CAPTION_FALLBACK'/, 'unexpected native caption fallback must emit a stable structured diagnostic');
assert.doesNotMatch(taskFiveQueueSource, /console\.warn\('\[BSE Queue\] 本机字幕回退:/, 'recoverable native caption fallback must not bypass structured diagnostics');
assert.match(taskFiveQueueSource, /const STORAGE_KEY_SUMMARY\s*=\s*`\$\{STORAGE_KEY_QUEUE\}:summary`/, 'Queue 必须为隐藏工作区维护独立的轻量 summary 存储键');
assert.match(taskFiveQueueSource, /const STORAGE_KEY_PROJECTION_PREFIX\s*=\s*`\$\{STORAGE_KEY_QUEUE\}:projection:`/, 'Queue schema v3 必须为每个完整 item 维护独立轻量 list projection');
assert.match(taskFiveQueueSource, /const QUEUE_STORAGE_SCHEMA_VERSION\s*=\s*3/, 'Queue list projection migration 必须由 schema v3 显式门控');
assert.match(taskFiveQueueSource, /function queueSummary\(items = \[\]\)[\s\S]{0,260}total:[\s\S]{0,120}pending:/, 'Queue summary 必须只从正式任务数组派生 total/pending，不能成为第二套执行状态');
assert.match(taskFiveQueueSource, /async function getQueueSummary\(\)[\s\S]{0,520}storage\.get\(STORAGE_KEY_SUMMARY\)/, '隐藏 Queue 状态读取必须直接读取 summary，旧安装才允许一次兼容回填');
assert.match(taskFiveSidepanelSource, /if \(!renderList\)[\s\S]{0,700}BSE_QUEUE_GET_SUMMARY[\s\S]{0,420}return;/, 'Side Panel 隐藏转录工作区时只能通过后台读取轻量 summary，不得加载 Queue 核心或构造完整 Queue DOM');
assert.match(taskFiveQueueSource, /function queueUpdateProjection\(item\)[\s\S]{0,420}id:[\s\S]{0,180}stage:[\s\S]{0,180}progress:[\s\S]{0,180}stageHint:/, 'Queue 高频进度广播必须使用轻量 item 投影，不能把完整字幕 cues 跨进程广播');
assert.match(taskFiveQueueSource, /if \(success\) \{[\s\S]{0,120}broadcastQueueUpdate\(itemSnapshot\)/, 'Queue saveItem 应由核心统一广播轻量进度更新');
assert.doesNotMatch(offscreenSource, /sendMessage\(\{\s*type:\s*['"]BSE_QUEUE_UPDATED['"][\s\S]{0,120}item:/, 'Offscreen 不得在 Queue 核心广播之后再发送第二条重复进度通知');
assert.match(taskFiveSidepanelSource, /function applyQueueRuntimeUpdate\(update\)[\s\S]+?queueCardById\.get[\s\S]+?queue-card-progress-fill/, '可见 Queue 的同阶段进度更新应只 patch 当前卡片，不得每秒重读并重建整份队列');
assert.match(taskFiveQueueSource, /async function readQueueFromStorage\(\{ hydrateText = true \} = \{\}\)[\s\S]+?hydrateText \? runtimeItems\.map\(hydrateQueueItemForRuntime\) : runtimeItems/, 'Queue 完整 item 读取必须允许执行器跳过 plainText/Markdown/SRT 派生');
const targetedQueueSaveSource = taskFiveQueueSource.match(/async function trySaveItemTargeted\(itemSnapshot\)[\s\S]*?(?=\n  async function saveItem)/)?.[0] || '';
assert.match(targetedQueueSaveSource, /storage\.get\(lookupKeys\)/, 'Queue 高频/终态保存必须只通过 targeted lookup 校验当前 item');
assert.match(targetedQueueSaveSource, /projectionStorageKey\(itemSnapshot\.id\)/, 'Queue targeted save 必须在同一 write 中同步当前 item projection');
assert.match(taskFiveQueueSource, /function serializeQueueProjectionMutation\(mutator\)[\s\S]{0,260}readQueueProjectionFromStorage/, '普通 Queue mutation 必须允许以 projection 为工作集，避免读取历史 canonical items');
assert.match(taskFiveQueueSource, /async function getQueueProjection\(\)[\s\S]{0,180}readQueueProjectionFromStorage/, 'Queue 必须提供只读取 list projection 的正式接口');
assert.match(taskFiveQueueSource, /async function processPendingJobs\(\)[\s\S]+?getQueueProjection\(\)[\s\S]+?readQueueItemsByIds\(candidates\.map/, 'Queue executor 必须先从 projection 选 pending，再只读取本批候选 item');
assert.match(taskFiveQueueSource, /async function exportQueueMergedMarkdown\(itemIds\)[\s\S]{0,700}getQueueProjection\(\)[\s\S]{0,700}readQueueItemsByIds\(targetIds\)/, '合并导出必须先按 projection 筛选，再只读取实际要导出的 canonical items');
assert.match(taskFiveQueueSource, /snapshots\.forEach\(\(item\) => \{[\s\S]{0,260}itemStorageKey\(item\.id\)[\s\S]{0,180}projectionStorageKey\(item\.id\)[\s\S]{0,180}queueListProjection\(item\)/, '完整 item 与 list projection 必须进入同一个 storage values 对象，不能额外制造 projection write IPC');
assert.match(taskFiveSidepanelSource, /BSE_QUEUE_GET', hydrateText: false/, 'Side Panel 转录列表必须通过后台只读取 queue list projection，不得把 canonical cues 搬进 Side Panel');
assert.match(taskFiveSidepanelSource, /async function loadQueueItemDetail\(id\)[\s\S]{0,420}BSE_QUEUE_GET_ITEM/, 'Side Panel 只有显式单卡操作才应通过后台单项接口读取该任务 canonical cues');
assert.doesNotMatch(taskFiveSidepanelSource, /BSE\.Queue\b/, 'Side Panel 不应再拥有第二份 Queue 核心；任务事实、存储与执行协议统一由 Service Worker 持有');
assert.doesNotMatch(taskFiveSidepanelHtml, /\.\.\/core\/queue\.js/, 'Side Panel 不应解析完整 core/queue.js，只保留轻量 QueueUI 控制器');
assert.doesNotMatch(taskFiveSidepanelHtml, /\.\.\/core\/native-host\.js/, 'Side Panel 不应建立第二份 Native Messaging client；Native Host 连接统一由 Service Worker 持有');
assert.match(taskFiveBackgroundSource, /message\.hydrateText === false[\s\S]{0,180}getQueueProjection/, '跨上下文 BSE_QUEUE_GET 的轻量模式必须返回 list projection，而不是完整 item records');
assert.match(taskFiveBackgroundSource, /BSE_QUEUE_ENQUEUE[\s\S]{0,500}toListProjection/, '跨上下文 enqueue 返回值也必须投影化，复用历史 done item 时不得把 cues 带回页面');
assert.match(taskFiveBackgroundSource, /BSE_QUEUE_GET_ITEM[\s\S]{0,260}getItem\(message\.id\)/, '显式单项内容动作必须有只读取一个 canonical item 的后台通道');
assert.match(taskFiveBackgroundSource, /BSE_QUEUE_GET_SUMMARY[\s\S]{0,260}getQueueSummary/, 'Queue summary 必须由 Service Worker 暴露轻量读取通道，Side Panel 不得直接加载 Queue 核心');
assert.match(taskFiveBackgroundSource, /BSE_QUEUE_GET_SETTINGS[\s\S]{0,260}getSettings/, 'Queue 设置读取必须由 Service Worker 统一代理');
assert.match(taskFiveBackgroundSource, /BSE_QUEUE_SAVE_SETTINGS[\s\S]{0,300}saveSettings/, 'Queue 设置写入必须由 Service Worker 统一代理');
assert.match(taskFiveBackgroundSource, /BSE_FETCH_NATIVE_YOUTUBE_CAPTIONS[\s\S]{0,240}isTrustedExtensionPageSender/, 'YouTube 批量 Native captions 代理必须限制为可信扩展页调用');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'platform/youtube.js'), 'utf8'), /BSE\.NativeHost\b/, 'YouTube UI adapter 不应直接拥有 Native Host；批量 captions 必须通过 Service Worker 代理');
assert.match(fs.readFileSync(path.join(root, 'platform/youtube.js'), 'utf8'), /fetchBatchNativeCaptions[\s\S]{0,1000}BSE_NATIVE_CANCEL/, 'YouTube 批量取消必须同时终止 UI Promise 并通知 Service Worker 取消真实 Native job');
assert.match(feedInjectorSource, /BSE_QUEUE_GET', hydrateText: false[\s\S]+?function applyQueueRuntimeUpdate[\s\S]+?if \(!applyQueueRuntimeUpdate\(message\.item\)\) scheduleQueueSync/, 'Feed 应消费 Queue 轻量进度投影，同阶段进度不得每秒重新获取整份队列');
assert.doesNotMatch(feedInjectorSource, /BSE\.(?:Queue|Tracker|AsrPolisher|Formatters)/, '轻量 Feed 注入器不得重新加载或直接调用 Queue/Tracker/AI/Formatter 核心；跨上下文数据统一走 Service Worker');
assert.match(feedInjectorSource, /__BSE_FEED_INJECTOR_INSTALLED__/, 'Feed 动态补注入必须有单实例 guard，避免重复 MutationObserver/runtime listener');
assert.match(feedInjectorSource, /BSE_ENSURE_VIDEO_RUNTIME/, 'B站普通页同文档切入视频页时，轻量 Feed bootstrap 必须能够按需请求完整视频运行时');
assert.match(feedInjectorSource, /async function loadQueueItemDetail\(itemId\)[\s\S]{0,360}BSE_QUEUE_GET_ITEM/, 'Feed 完成态点击复制时才允许读取单个 canonical item');
assert.match(feedInjectorSource, /queueAliasCache[\s\S]+?function findQueueItem[\s\S]+?queueAliasCache\.get/, 'Feed 应维护 id\/targetId 轻量索引，不能为每个视频按钮反复 Array.from 全队列线性搜索');
assert.match(taskFiveQueueSource, /chrome\.tabs\.query\(\{ url: \['\*:\/\/\*\.youtube\.com\/\*', '\*:\/\/\*\.bilibili\.com\/\*'\] \}\)/, 'Queue 高频广播只应投递到支持站点标签页，不得每秒扫描并尝试消息所有浏览器标签');
assert.match(taskFiveSidepanelSource, /renderTracks\(\);[\s\S]{0,120}renderTranscript\(\);[\s\S]{0,120}if \(currentWorkspace === 'tracker'\) updateQuickSubscribeBar/, '媒体状态更新时不得在隐藏 Workspace 后台刷新追踪作者卡或触发作者元数据网络补全');
assert.match(taskFiveSidepanelSource, /loadAndRenderQueue\(\{ renderList: false \}\)/, 'Side Panel 首屏只应预热 Queue summary，不应无条件读取完整任务');
assert.doesNotMatch(taskFiveSidepanelSource, /chrome\.storage\.onChanged[\s\S]{0,420}bse_transcription_queue_v1/, 'Side Panel 不应同时监听 Queue runtime 广播与 storage change 形成双刷新源');
assert.doesNotMatch(feedInjectorSource, /chrome\.storage\.onChanged[\s\S]{0,420}bse_transcription_queue_v1/, 'Feed 按钮应只消费统一 Queue 广播，不得再叠加 storage change 同步');
assert.match(taskFiveBackgroundSource, /if \(changes\?\.bse_transcription_queue_v1\)/, 'Service Worker 只保留旧整数组 Queue key 的 storage 唤醒作为迁移兼容');
assert.doesNotMatch(taskFiveBackgroundSource, /startsWith\(['"]bse_transcription_queue_v1:item:/, '每秒 Queue item 进度持久化不得反向唤醒正在运行的 Orchestrator');
const workerImportSource = taskFiveBackgroundSource.match(/importScripts\([\s\S]*?\);/)?.[0] || '';
assert.doesNotMatch(workerImportSource, /core\/jszip\.js/, 'Service Worker 没有 ZIP 交付职责，不应在每次启动时解析 JSZip');
const dynamicInjectionSource = taskFiveBackgroundSource.match(/async function injectContentScripts\([\s\S]*?(?=\nchrome\.runtime\.onInstalled)/)?.[0] || '';
assert.doesNotMatch(dynamicInjectionSource, /core\/(?:asr-polisher|tracker|queue)\.js/, '动态视频运行时补注入也不得重新加载后台专属 Queue/Tracker/AI 模块');
assert.match(taskFiveBackgroundSource, /async function ensureVideoRuntime\(tabId, url = ''\)[\s\S]{0,900}videoRuntimeLoads\.get\(tabId\)[\s\S]{0,520}BSE_VIDEO_RUNTIME_PING[\s\S]{0,360}injectContentScripts\(tabId, url\)/, '视频运行时按 tab single-flight：先 ping，未安装才补注入，多个并发请求不得重复 executeScript');
assert.match(taskFiveBackgroundSource, /BSE_ENSURE_VIDEO_RUNTIME[\s\S]{0,420}ensureVideoRuntime\(tabId, tabUrl\)/, '同文档路由进入播放页时必须统一经过 ensureVideoRuntime');
assert.match(taskFiveBackgroundSource, /async function injectFeedContentScript[\s\S]{0,360}content\/feed-injector\.js/, '扩展更新补注入时普通站点页只能加载轻量 Feed runtime');
assert.match(taskFiveBackgroundSource, /if \(isMatchingVideoUrl\(tab\.url\)\)[\s\S]{0,180}ensureVideoRuntime\(tab\.id, tab\.url\)/, '扩展更新时只有真实视频页才允许确保完整运行时');
assert.equal((taskFiveSidepanelSource.match(/BSE_ORCHESTRATOR_NOTIFY/g) || []).length, 1, 'Side Panel 只应保留一次 pending-recovery wake；enqueue 成功后不得重复唤醒 Orchestrator');
assert.match(taskFiveSidepanelSource, /let queueRecoveryWakeSent = false;/, 'Queue recovery wake 必须拥有显式 pending-epoch 状态');
const queueProjectionLoadSource = taskFiveSidepanelSource.match(/async function performQueueLoadAndRender\([\s\S]*?(?=\n  async function loadAndRenderQueue)/)?.[0] || '';
assert.match(queueProjectionLoadSource, /!queueRecoveryWakeSent[\s\S]{0,420}BSE_ORCHESTRATOR_NOTIFY/, 'Queue 可见页的恢复唤醒必须按 pending epoch 去重，进度广播不得反复 wake');
assert.match(taskFiveBackgroundSource, /localLlmControllers\s*=\s*new Map\(\)[\s\S]+?BSE_CANCEL_LOCAL_LLM[\s\S]+?controller\.abort/, '长字幕精修取消必须真正中止正在进行的后台 LLM HTTP 请求，而不是只停止下一批');
assert.match(taskFiveBackgroundSource, /\.finally\(\(\) => \{[\s\S]+?localLlmControllers\.delete\(requestId\)/, '后台 LLM AbortController 必须在请求结束后释放，不能形成长期句柄泄漏');
assert.match(taskFiveAsrPolisherSource, /async function planVisualEvidence[\s\S]+?signal = null[\s\S]+?invokeLlm\(\{[\s\S]+?signal/, '图文讲义阶段一规划必须透传 AbortSignal，切视频或字幕更新后不得继续占用旧 LLM 请求');
assert.match(taskFiveAsrPolisherSource, /async function generateCourseNotes[\s\S]+?signal = null[\s\S]+?invokeLlm\(\{[\s\S]+?signal/, '最终学习/复习生成必须透传 AbortSignal');
assert.match(taskFiveSidepanelSource, /cancelActiveAiGeneration\('字幕内容已更新'\)[\s\S]+?aiGenerationRevision\+\+/, '字幕校对或刷新改变 cueRevision 时必须主动取消旧学习生成，而不是只在结果回来后丢弃');
assert.match(taskFiveSidepanelSource, /capturePlannedEvidence\(plannedEvidence[\s\S]+?signal:\s*generationSignal/, '阶段一播放器取帧循环也必须响应同一生成取消信号');
const restoreNoteFunctionSource = taskFiveSidepanelSource.match(/async function restoreNoteFromCache\([\s\S]*?(?=\n  \/\*\* @returns)/)?.[0] || '';
assert.match(restoreNoteFunctionSource, /error\?\.name === 'AbortError'\) return;/, '用户切走学习页取消 IndexedDB/图片恢复时必须静默退出');
assert.match(restoreNoteFunctionSource, /学习产物缓存恢复失败/, '非取消类缓存异常仍应保留可诊断提示');
assert.match(taskFiveBackgroundSource, /BSE_MEDIA_CONTEXT_UPDATE[\s\S]{0,520}ownerMatches[\s\S]{0,300}BSE_MEDIA_CONTEXT_BROADCAST/, 'MediaContext 轻量更新只有 owner 匹配时才允许写后台缓存并广播，禁止视频切换瞬间发送无效语境');
assert.match(taskFiveBackgroundSource, /BSE_DIAGNOSTIC_APPEND[\s\S]{0,520}eventMediaKey[\s\S]{0,300}diagnostics/, '轻量媒体诊断必须按 mediaKey 合并进后台 tab state，Side Panel 重开时仍能恢复最新诊断且不搬运 cues');
assert.match(taskFiveSidepanelSource, /(?:sourceLanguage\s*,|sourceLanguage:\s*sourceLanguage)/, 'batch enqueue must forward the exact selected source language');
assert.match(taskFiveSidepanelSource, /queue-source-language/, 'queue batch input must expose a source-language control');
assert.ok(
  taskFiveSidepanelHtml.indexOf('../core/language-routing.js') < taskFiveSidepanelHtml.indexOf('../core/queue-ui.js')
    && taskFiveSidepanelHtml.indexOf('../core/queue-ui.js') < taskFiveSidepanelHtml.indexOf('sidepanel.js'),
  'sidepanel must load deterministic routing and safe UI helpers before its controller'
);
assert.ok(
  taskFiveSidepanelHtml.indexOf('../core/media-context.js') >= 0
    && taskFiveSidepanelHtml.indexOf('../core/media-context.js') < taskFiveSidepanelHtml.indexOf('../core/asr-polisher.js'),
  'sidepanel AI tools must load the shared media-context contract before prompt builders'
);
assert.match(taskFiveSidepanelSource, /queue-source-engine/, 'completed cards must render their platform or native engine source');
assert.match(taskFiveSidepanelSource, /queue-failure-detail/, 'failed cards must render stable safe failure details');
assert.doesNotMatch(taskFiveSidepanelHtml, /id="btn-drag-all-tray"/, '侧边栏不得继续提供无法可靠跨站传递 FileList 的“拖拽全部”入口');
assert.doesNotMatch(taskFiveSidepanelSource, /dataTransfer\.items\.add\(file\)/, '截图托盘不得把脚本生成 File 的 HTML5 drag 当成可靠的外部上传通道');
assert.match(taskFiveSidepanelHtml, /复制精选拼图/, '外部 AI 的直接投递入口应使用可验证的剪贴板拼图方案');
const taskFiveSidepanelCss = fs.readFileSync(path.join(root, 'sidepanel/sidepanel.css'), 'utf8');
assert.match(taskFiveSidepanelCss, /button:focus-visible[\s\S]{0,260}outline:\s*2px solid var\(--primary\)/, '所有按钮必须共享可见键盘焦点，不得只给 AI 区单独做 focus ring');
assert.match(taskFiveSidepanelCss, /button:disabled[\s\S]{0,220}cursor:\s*not-allowed/, '所有不可用按钮必须有统一 disabled 反馈');
assert.match(taskFiveSidepanelCss, /button\[aria-busy="true"\][\s\S]{0,100}cursor:\s*progress/, '异步按钮必须有统一 busy 光标语义');
assert.match(taskFiveSidepanelCss, /\.primary-tab\.active\s*\{[^}]*background:\s*var\(--active-bg\)[^}]*border-color:\s*var\(--active-border\)/s, '一级工作区必须共享统一 active 视觉状态');
assert.match(taskFiveSidepanelCss, /\.workspace-nav-badge\s*\{[^}]*background:\s*#ff4757/s, '追踪未读与转录进行中状态必须在一级导航中提供紧凑 badge');
assert.match(taskFiveSidepanelCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '侧边栏交互动画必须尊重系统减少动态效果设置');
assert.doesNotMatch(taskFiveSidepanelCss, /\.note-image-wrap\s*\{[^}]*max-height:\s*220px[^}]*overflow:\s*hidden/s, '最终报告图片不得以固定 220px 高度裁掉板书、文档或代码内容');
assert.match(taskFiveSidepanelCss, /\.note-img-thumbnail\s*\{[^}]*object-fit:\s*contain/s, '最终报告图片应完整 contain 显示，而不是 cover 裁切');
assert.match(taskFiveSidepanelSource, /openNoteImagePreview/, 'zoom-in 光标必须对应真实的原图预览行为');
assert.match(taskFiveSidepanelHtml, /id="ai-learn-mode-shell"[\s\S]+?class="ai-modes-bar" role="tablist"/, '学习 Workspace 应使用轻量任务选择，不再混入技术型 Prompt 入口');
assert.match(taskFiveSidepanelHtml, /id="ai-review-mode-shell"[\s\S]+?class="ai-modes-bar" role="tablist"/, '复习 Workspace 应拥有自己的任务选择，而不是被固定成单一自测模式');
assert.match(taskFiveSidepanelSource, /syncAiWorkspacePresentation[\s\S]+?aria-selected/, '任务切换必须同步视觉状态与 aria-selected 状态');
assert.match(taskFiveSidepanelSource, /let lastLearnAiMode\s*=\s*['"]course_notes['"]/, '学习 Workspace 应拥有独立的最后任务状态');
assert.match(taskFiveSidepanelSource, /let lastReviewAiMode\s*=\s*['"]summary['"]/, '复习 Workspace 应拥有独立的最后任务状态，并默认从核心速览进入');
assert.match(taskFiveSidepanelSource, /config\.workspace === 'learn'\) lastLearnAiMode = mode[\s\S]+?config\.workspace === 'review'\) lastReviewAiMode = mode/, '学习与复习必须分别记住最后选择，互不污染');
assert.match(taskFiveSidepanelSource, /const hotAiArtifacts = new Map\(\)[\s\S]+?HOT_AI_ARTIFACT_LIMIT = 6/, '同一视频的六种学习/复习产物应使用有界内存热缓存，避免 type 切换重复读取 storage/IndexedDB');
assert.match(taskFiveSidepanelSource, /const hotAiDomViews = new Map\(\)[\s\S]+?HOT_AI_DOM_LIMIT = 3/, '纯文本长笔记 DOM 热缓存必须严格限量，不能为了切换速度无界保留整篇 DOM');
assert.match(taskFiveSidepanelSource, /canCacheRenderedHtml = currentGeneratedNote\.mode !== 'course_notes'/, '图文讲义不得长期缓存包含截图 data URL 的 renderedHtml，避免图片数据在 HTML 字符串中再复制一份');
assert.match(taskFiveSidepanelSource, /resetAiWorkbenchForMediaChange[\s\S]+?hotAiArtifacts\.clear\(\)[\s\S]+?hotAiDomViews\.clear\(\)/, '切视频时必须释放学习产物与长 DOM 热缓存，避免跨视频内存滞留');
assert.match(taskFiveSidepanelSource, /const hot = readHotAiArtifact\(artifactKey, mode\)[\s\S]+?currentGeneratedNote = hot[\s\S]+?return;/, '已看过的学习/复习 type 应优先命中内存产物，不得每次切回都读取持久层');
assert.doesNotMatch(taskFiveSidepanelSource, /currentWorkspace\s*=\s*currentAiMode\s*===\s*['"]deep_qa['"]/, '二级 AI mode 不得反向控制一级 Workspace');
assert.match(taskFiveSidepanelCss, /\.ai-header-left\s*\{[^}]*grid-template-areas:\s*[\s\S]*"title model"[\s\S]*"desc desc"/s, '学习/复习页顶部应压成标题+模型状态、说明两层，避免侧栏首屏被三行元信息占满');
assert.match(taskFiveSidepanelHtml, /<button class="ai-model-badge"[^>]*aria-controls="ai-settings-drawer"/, '模型状态必须是可键盘访问的真实按钮，并明确控制 AI 设置面板');
assert.match(taskFiveSidepanelSource, /aiModelBadge\?\.setAttribute\('aria-expanded', String\(willOpen\)\)/, '模型状态按钮的 aria-expanded 必须与设置面板实际展开状态同步');
assert.match(taskFiveSidepanelHtml, /id="ai-input-learn-model"[\s\S]+?id="ai-input-review-model"/, '学习与复习应各自拥有模型选择，而不是两个页面伪装成两套却共用一个模型输入框');
assert.doesNotMatch(taskFiveSidepanelHtml, /id="ai-input-model"/, '共享 AI 设置不应继续保留语义不清的单一“生成模型”输入框');
assert.match(taskFiveSidepanelHtml, /id="ai-settings-scope"[^>]*>接口与凭证由学习、复习共享/, 'AI 设置面板必须明确告诉用户 endpoint/API Key 是共享连接层');
assert.doesNotMatch(taskFiveSidepanelSource, /function getWorkspaceAiModel/, 'Workspace 模型选择规则应由 AI 核心统一维护，Side Panel 不应保留第二套解析器');
assert.match(taskFiveAsrPolisherSource, /function resolveAiModel[\s\S]+?scope === 'learn'[\s\S]+?scope === 'review'/, 'AI 核心必须统一解析学习/复习模型，避免其他调用入口绕过 Workspace 分流');
assert.match(taskFiveSidepanelSource, /saveAiSettings\(\{[\s\S]+?learnModel:\s*draft\.learnModel[\s\S]+?reviewModel:\s*draft\.reviewModel/, '保存设置时必须一次持久化共享连接与学习/复习两个模型');
assert.match(taskFiveSidepanelSource, /async function loadAiConfigToUi[\s\S]+?\(!refresh && savedAiConfig\)[\s\S]+?getAiSettings/, '学习/复习切换应优先复用内存 AI 配置，不能每次都重复跨 storage 读取同一份 endpoint/key/model');
assert.match(taskFiveSidepanelSource, /AI_STATUS_PROBE_CACHE_LIMIT\s*=\s*6[\s\S]+?aiStatusProbeCache = new Map\(\)[\s\S]+?aiStatusProbeCache\.get\(probeKey\)/, '学习/复习不同模型的服务探测结果应分别短时缓存，来回切 Workspace 不得重复请求或串用上一模型状态');
assert.match(taskFiveSidepanelSource, /const preserveDraft = Boolean\(savedAiConfig && elements\.aiSettingsDrawer && !elements\.aiSettingsDrawer\.hidden\)/, '切换学习/复习时不得因为后台配置刷新覆盖用户尚未保存的 AI 设置草稿');
assert.match(taskFiveSidepanelSource, /subtitlePolishContext\.promptText[\s\S]+?generateSubtitlePolishPrompt/, '同一字幕版本重复复制校对任务时应复用已构造的长 Prompt，避免反复拼接整份字幕');
assert.match(taskFiveSidepanelCss, /\.ai-workspace-model-field\.is-current\s*\{/, '设置面板应明确高亮当前工作区对应的模型配置，避免用户不知道正在配置哪一页');
assert.match(taskFiveSidepanelCss, /\.review-protocol\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s, '自测三阶段流程应使用稳定网格，不得在窄侧栏随机折成两行');
assert.match(taskFiveSidepanelCss, /\.ai-action-toolbar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s, '主生成动作与次级工具应使用稳定网格层级，避免侧栏宽度变化时随意换行');
assert.match(taskFiveSidepanelCss, /\.ai-external-flow-head/, '外部 AI 工作流应作为有标题的次级分组，而不是另一排同权重 CTA');
assert.match(taskFiveSidepanelCss, /@media\s*\(max-width:\s*430px\)/, 'AI 工作台必须为窄侧栏提供明确响应式布局');
assert.doesNotMatch(taskFiveSidepanelCss, /#0f8fd6|#5b5ce2/, '主生成按钮不得保留散落的历史蓝紫色常量');
assert.match(taskFiveSidepanelCss, /--on-primary:\s*#[0-9a-f]{6}/i, '主题系统必须显式定义 primary 填充上的文字颜色，不能默认所有主题都用白字');
assert.match(taskFiveSidepanelCss, /\[data-theme="bilibili"\][\s\S]{0,900}--on-primary:\s*#0f172a/i, 'B站亮青主题必须使用高对比深色 on-primary 文本');
assert.match(taskFiveSidepanelCss, /\.btn-ai-run\s*\{[^}]*background:\s*linear-gradient\([^;]*var\(--action-primary-start\)[^;]*var\(--action-primary-end\)[^}]*color:\s*var\(--action-primary-text\)/s, '主生成按钮应只消费主题级 action token，不再维护组件级主题分支');
assert.doesNotMatch(taskFiveSidepanelCss, /\[data-theme="(?:dark|light|bilibili|youtube)"\]\s+\.btn-ai-run/, 'AI 主按钮不得重新引入按主题散落的组件覆写');
assert.doesNotMatch(taskFiveSidepanelCss, /background:\s*var\(--primary\)[^}]{0,180}color:\s*#(?:fff|ffffff)/is, 'solid primary 填充上的文字必须使用 --on-primary，避免亮主题色叠白字导致对比不足');
assert.match(taskFiveSidepanelCss, /\.btn-ai-tool\s*\{[^}]*height:\s*28px/s, '次级工具按钮应压到 28px，把视觉优先级让给长笔记正文');
assert.match(taskFiveSidepanelCss, /\.btn-ai-subtool\s*\{[^}]*height:\s*28px/s, '外部协作步骤按钮应与次级工具保持同一紧凑密度');
assert.match(taskFiveSidepanelCss, /\.ai-action-toolbar\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/s, '工具栏应使用 6 列底网格，让内置 AI 与外部 AI 成为同一层的两种执行方式');
assert.match(taskFiveSidepanelCss, /\.btn-ai-run\s*\{[^}]*grid-column:\s*span\s*3[^}]*height:\s*32px[^}]*font-size:\s*10\.75px/s, '内置 AI 主动作应占半行但保持紧凑，不能比正文更抢视觉权重');
assert.match(taskFiveSidepanelCss, /\.ai-external-entry\s*\{[^}]*grid-column:\s*span\s*3[^}]*border-style:\s*solid/s, '外部 AI 入口应与内置生成并列，并以正式执行方式而不是虚线占位控件呈现');
assert.match(taskFiveSidepanelCss, /\.ai-progress-box\s*\{[^}]*var\(--primary\)/s, 'AI 进度提示框背景与边框必须使用主题色派生');
assert.doesNotMatch(taskFiveSidepanelCss, /\.ai-note-placeholder\s*\{[^}]*grid-template-columns:\s*36px/s, 'AI 提示占位框不得使用固定 36px 强行挤压标题为纵向细条');
assert.match(taskFiveSidepanelCss, /\.ai-note-placeholder\s*\{[^}]*display:\s*flex/s, 'AI 提示占位框应使用弹性容器自然排布图标与文本主体');
assert.match(taskFiveSidepanelHtml, /class="ai-note-placeholder"[\s\S]+?class="placeholder-icon"[\s\S]+?class="placeholder-body"/, 'AI 提示占位框应包含规范的图标与文本主体包裹层');
assert.match(taskFiveSidepanelCss, /\.ai-note-content\s*\{[^}]*overflow-wrap:\s*anywhere/s, 'AI 报告正文必须允许超长术语与 URL 在窄侧栏安全换行');
assert.match(taskFiveSidepanelCss, /\.ai-note-content\s*\{[^}]*font-size:\s*var\(--ai-note-font\)[^}]*line-height:\s*1\.78[^}]*color:\s*var\(--text-body\)/s, '长笔记正文必须使用独立阅读字号和充足行高，控制区字号不能反过来主导页面');
assert.match(taskFiveSidepanelCss, /\.note-rendered-content > p,[\s\S]+?content-visibility:\s*auto[\s\S]+?contain-intrinsic-size:\s*auto\s+112px/, '长学习笔记的屏幕外正文块应延迟布局和绘制，避免一次性渲染整篇内容');
assert.match(taskFiveSidepanelCss, /\.cue\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:\s*auto\s+44px/s, '长时间轴字幕的屏幕外 cue 应延迟布局绘制');
assert.match(taskFiveSidepanelCss, /\.paragraph\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:\s*auto\s+96px/s, '长阅读模式字幕段落应延迟布局绘制');
assert.match(taskFiveSidepanelSource, /function scheduleTranscriptCacheRelease[\s\S]+?transcriptViewCache\.clear\(\)[\s\S]+?renderedMediaKey = null[\s\S]+?querySelectorAll\('\.cue, \.paragraph'\)[\s\S]+?30 \* 1000/, '离开字幕 Workspace 较久后必须同时释放缓存引用和真实字幕 DOM，不能只清 Map 却让上千节点继续挂在隐藏容器');
assert.match(taskFiveSidepanelSource, /function scheduleAiWorkingSetRelease[\s\S]+?hotAiArtifacts\.clear\(\)[\s\S]+?hotAiDomViews\.clear\(\)[\s\S]+?runtimePersisted[\s\S]+?60 \* 1000/, '离开学习/复习较久后应释放可重建的长笔记工作集，但只有已经持久化的 payload 才允许被清理');
assert.match(taskFiveSidepanelSource, /function renderCurrentAiArtifact[\s\S]+?aiWorkspaceVisible[\s\S]+?if \(!aiWorkspaceVisible\) return true/, '后台生成在隐藏 Workspace 完成时不得构造长 Markdown DOM，只保存当前 artifact 并在用户回来后按需展示');
assert.match(taskFiveSidepanelSource, /currentArtifactMatches[\s\S]+?if \(currentArtifactMatches\)[\s\S]+?renderCurrentAiArtifact\(\)/, '当前内存里存在未保存或刚生成的匹配产物时必须优先直接恢复，不能因 DOM 回收重新读取旧持久缓存覆盖它');
assert.match(taskFiveSidepanelSource, /function scheduleQueueWorkingSetRelease[\s\S]+?queueCache = \[\][\s\S]+?queueList\?\.replaceChildren\(\)[\s\S]+?60 \* 1000/, '离开转录 Workspace 较久后应释放完整 Queue 数据与卡片 DOM，隐藏页只保留轻量 summary');
assert.match(taskFiveSidepanelSource, /diagnosticTechnical\?\.open[\s\S]+?renderedTechnicalDiagnosticsSignature/, '折叠的技术诊断不得在每次状态广播时重新格式化数百条日志，展开后才按变化物化正文');
assert.match(taskFiveSidepanelSource, /function ingestMediaDiagnosticsIncremental[\s\S]+?canAppendOnly[\s\S]+?list\.slice\(previousCount\)/, '同一媒体诊断 session 的 full-state 广播只应 ingest 新增尾部，不能每次从第一条历史日志重新遍历');
assert.match(taskFiveSidepanelSource, /trackerSearchTimer[\s\S]+?setTimeout\(\(\) => \{[\s\S]+?renderTrackerList\(\)[\s\S]+?100\)/, '追踪搜索应合并连续键入，避免最多百张卡片在每个按键上同步全量重建');
assert.match(taskFiveSidepanelSource, /function loadTrackerSummary[\s\S]+?getTrackerSummary[\s\S]+?updateTrackerCountsAndBadge\(summary\)/, '非追踪 Workspace 的一级导航 badge 必须读取轻量 Tracker summary，不得为此替换 subscriptionsCache 或加载完整历史');
assert.doesNotMatch(taskFiveSidepanelCss, /\.cue\s*\{[^}]*transition:\s*all/s, '上千条 cue 不应对 all 属性创建过宽的 transition 跟踪');
assert.match(taskFiveSidepanelCss, /--ai-note-font:\s*clamp\(13\.5px,[^;]+15px\)/s, '阅读字号应在窄侧栏与宽侧栏之间响应式增长，而不是固定在 12px 级');
assert.match(taskFiveSidepanelCss, /\.ai-mode-pill\s*\{[^}]*min-height:\s*28px[^}]*font-size:\s*var\(--ai-control-font\)/s, '学习/复习任务选择应保持紧凑，视觉上低于正文内容');
assert.match(taskFiveSidepanelCss, /@media\s*\(max-width:\s*560px\)[\s\S]{0,180}\.ai-mode-kind\s*\{[^}]*display:\s*none/s, '典型侧栏宽度应隐藏任务副标签，只保留真正需要决策的任务名');
assert.match(taskFiveSidepanelCss, /\.note-quote\s*\{[^}]*color:\s*var\(--text\)[^}]*font-size:\s*1em[^}]*font-weight:\s*540/s, '引用块是知识内容而非辅助元信息，必须维持正文级字号与更高文字对比');
assert.match(taskFiveSidepanelCss, /\.note-table tr:nth-child\(even\)\s*\{[^}]*color-mix\([^}]*var\(--surface-2\)[^}]*var\(--bg\)/s, 'Markdown 表格斑马纹必须由主题 surface token 派生，不能只在暗色主题可见');
assert.match(taskFiveSidepanelCss, /\.note-table\s*\{[^}]*font-size:\s*\.93em/s, '表格属于笔记正文，字号只能轻微收敛，不能重新掉回难读的小字');
assert.match(taskFiveSidepanelCss, /--note-code-bg:\s*#0d1117[\s\S]+?\[data-theme="light"\][\s\S]+?--note-code-bg:\s*#f6f8fa/s, '代码块必须有独立的暗色/浅色阅读背景，而不是浅色主题仍强制黑底');
assert.match(taskFiveSidepanelCss, /\.math-block\s*\{[^}]*color:\s*var\(--text\)/s, '公式属于正文内容，不能把主题强调色当作公式正文颜色');
assert.doesNotMatch(taskFiveSidepanelHtml, /ai-note-result-container/, '最终笔记应直接流入学习/复习 Workspace，不再套一层会压缩长文的结果卡片');
assert.match(taskFiveSidepanelHtml, /<article class="ai-note-content"[^>]*id="ai-note-content"/, '最终 Markdown 应使用独立文档语义直接呈现在工作区中');
assert.match(taskFiveSidepanelHtml, /<img class="brand-mark" src="\.\.\/icons\/icon-32\.png"[^>]*>/, 'Side Panel 左上角必须使用打包的真实扩展图标，不再用字母 S 伪造品牌图标');
assert.match(taskFiveSidepanelCss, /\.ai-note-content\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/s, '最终笔记 flex item 必须允许收缩并把宽内容交给表格/代码等局部滚动容器');
assert.match(taskFiveSidepanelCss, /\.note-table-wrap\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s, 'Markdown 表格只能在自身容器横向滚动，不能撑宽整篇笔记');
assert.match(taskFiveSidepanelCss, /\.note-code-wrap\s*\{[^}]*max-width:\s*100%[\s\S]*?\.note-code-block\s*\{[^}]*overflow-x:\s*auto/s, '代码块应在局部滚动层容纳长代码，不让工作区横向溢出');
assert.doesNotMatch(taskFiveSidepanelHtml, />\s*1\.\s*复制规划词\s*</, '外部 AI 回流会发生两次，不应继续用错误的线性 1/2/3 编号误导操作顺序');
assert.match(taskFiveSidepanelSource, /syncExternalAiPanelState[\s\S]+?currentAiMode === 'course_notes'[\s\S]+?aiExternalPlanStage\.hidden\s*=\s*!isVisualExternalFlow/, '外部 AI 应作为所有学习产物的替代执行路径，但只有图文讲义暴露取帧规划阶段');
assert.match(taskFiveSidepanelSource, /visualPlanReady[\s\S]+?aiExternalResultStage\.hidden\s*=\s*isVisualExternalFlow\s*&&\s*!visualPlanReady/, '图文外部协作在阶段一未完成前不得同时暴露阶段二操作，用户一次只需要理解当前步骤');
assert.match(taskFiveSidepanelSource, /aiExternalResetPlan\?\.addEventListener[\s\S]+?manualFrames\s*=\s*manualFrames\.filter\(\(frame\) => frame\?\.source !== 'planned'\)/, '重新规划只应清除自动规划帧并保留用户手动截图，避免重做步骤造成额外劳动');
assert.match(taskFiveSidepanelCss, /\.ai-external-stage\.is-complete \.ai-external-stage-actions\s*\{[^}]*display:\s*none/s, '阶段一完成后旧操作应自动收起，只保留轻量完成状态与重新规划入口');
assert.match(taskFiveSidepanelSource, /if \(currentAiMode !== 'course_notes'\)[\s\S]+?buildCourseNotePrompt[\s\S]+?mode:\s*currentAiMode/, '所有纯文本学习/复习任务必须能一次复制完整外部 AI 任务，不依赖视觉规划流程');
assert.match(taskFiveSidepanelSource, /const importMode = currentAiMode[\s\S]+?mode:\s*importMode/, '外部 AI 最终 Markdown 必须按当前学习/复习模式保存，不能强制落到 course_notes');
assert.match(taskFiveSidepanelSource, /externalVideoPlan\s*=\s*\{[\s\S]+?summary:[\s\S]+?chapters,[\s\S]+?visualRequests:[\s\S]+?visualEvidence/, '外部 AI 导入阶段一规划后必须保留完整章节骨架，不能只留下截图结果');
assert.match(taskFiveSidepanelSource, /buildCourseNotePrompt\?\.\(\{[\s\S]{0,420}videoIR:\s*externalVideoPlan/, '外部 AI 阶段二必须复用阶段一导入的章节规划，不能重新从字幕规划一遍');
assert.match(taskFiveSidepanelSource, /function buildPlannedEvidenceFrame[\s\S]+?chapterId:\s*request\.chapterId[\s\S]+?expectedSurface:\s*request\.expectedSurface \|\| request\.contentHint/, '规划截图必须通过统一证据构造 seam 保留 chapterId 与视觉类型到最终合成层');
assert.match(taskFiveFormattersSource, /note-timeline-heading[\s\S]+?note-timeline-jump[\s\S]+?data-seek/, '最终笔记的时间范围大标题必须渲染为真实可点击的视频回跳入口');
assert.match(taskFiveSidepanelSource, /const isPlanImport = externalImportKind === 'plan'[\s\S]+?const parsedJson = isPlanImport/, '规划 JSON 与最终 Markdown 必须由显式导入入口区分，不能再根据内容自动猜测当前步骤');
assert.match(taskFiveSidepanelHtml, /id="ai-btn-import-plan"[\s\S]+?id="ai-btn-open-import-modal"/, '图文协作必须分别提供“导入规划”和“导入结果”，避免一个入口同时承担两种协议');
assert.match(taskFiveSidepanelSource, /aiBtnExternalToggle\.addEventListener\('click', \(\) => \{[\s\S]{0,180}externalPanelOpen = !externalPanelOpen[\s\S]{0,120}syncExternalAiPanelState/, '外部 AI 主入口只负责展开/收起协作流程，不得点击即产生隐式复制副作用');
assert.doesNotMatch(taskFiveSidepanelSource, /aiBtnExternalToggle\.addEventListener\('click'[\s\S]{0,400}copyCurrentTextTaskForExternalAi/, '外部 AI 主入口不得再次偷偷复制纯文本任务');
assert.match(taskFiveSidepanelSource, /AI_MODE_CONFIG[\s\S]+?course_notes[\s\S]+?summary[\s\S]+?deep_qa/, '学习/复习文案与能力应由单一 mode config 驱动，避免多处分支漂移');
assert.match(taskFiveSidepanelSource, /const uiText = \(key, params\) => BSE\.I18n\?\.t\(key, params\) \|\| key/, '学习/复习共享 UI 必须使用显式模块级 i18n seam，避免依赖其他函数的局部 t 变量');
assert.match(taskFiveSidepanelSource, /function applyReviewRecallProtection[\s\S]+?review-flip-card[\s\S]+?review-answer-disclosure/, '自测页应优先逐题隐藏答案，并在外部结果不满足配对结构时降级为整段答案折叠');
assert.doesNotMatch(taskFiveSidepanelSource, /dataset\.reviewWarning\s*=\s*t\(|review-answer-summary['"][\s\S]{0,160}textContent\s*=\s*t\(/, 'Recall UI 不得引用不存在的自由 t() 变量');
assert.match(taskFiveSidepanelSource, /function renderCurrentAiArtifact[\s\S]+?applyReviewRecallProtection/, '所有学习产物必须经过统一渲染 seam，避免某条更新路径绕过 Recall 保护');
assert.match(taskFiveSidepanelSource, /function renderManualTray[\s\S]+?createDocumentFragment\(\)[\s\S]+?replaceChildren\(fragment\)/, '截图托盘必须批量提交 DOM，避免拼接包含多份 base64 的巨型 innerHTML 字符串');
assert.doesNotMatch(taskFiveSidepanelSource, /aiManualTrayList\.innerHTML/, '截图托盘不得重新使用 innerHTML 重建全部高清 data URL');
assert.match(taskFiveSidepanelSource, /function capturePlannedEvidence[\s\S]+?type: 'BSE_CAPTURE_BEST_FRAME'[\s\S]+?buildPlannedEvidenceFrame/, '内置与外部规划必须共享同一阶段一媒体执行 seam，避免两套截图循环漂移');
assert.doesNotMatch(taskFiveSidepanelSource, /retryableCaptureErrors|TARGET_NOT_BUFFERED|FRAME_NOT_DECODED|FINAL_FRAME_NOT_READY/, 'Side Panel 不得理解播放器缓冲/解码错误或维护第二套重试策略');
assert.match(taskFiveSidepanelSource, /manualFrames = captureResult\.frames[\s\S]{0,900}renderManualTray\(\)/, '外部规划应在统一媒体执行完成与候选初筛后只提交一次托盘视图');
assert.ok(taskFiveFormattersSource.includes("new RegExp(`___${kind}_(\\\\d+)___`, 'g')"), '长 Markdown 占位符还原应按类型单次扫描，而不是每个公式/代码块重新扫描整份 HTML');
assert.doesNotMatch(taskFiveFormattersSource, /(?:tableBlocks|frameBlocks|imageBlocks|mathBlocks|mathInlines|codeBlocks)\.forEach\([\s\S]{0,140}html\.replace/, '长笔记渲染不得恢复每个块时反复全字符串 replace');
assert.match(taskFiveFormattersSource, /loading="lazy" decoding="async"/, '笔记中的大图应延迟加载并异步解码，降低长文首屏主线程压力');
assert.match(taskFiveSidepanelCss, /\.review-flip-card\s*\{/, '逐题自测翻卡必须有清晰的视觉层级');
assert.match(taskFiveSidepanelCss, /\.review-answer-disclosure\s*\{/, '外部 AI 非结构化结果的降级答案折叠必须保留清晰视觉层级');
assert.match(taskFiveAsrPolisherSource, /## 自测题[\s\S]+?### Q1[\s\S]+?## 参考答案[\s\S]+?### A1[\s\S]+?## 仍值得回看/, '自测提示词必须提供 Qn\/An 稳定配对结构，让 UI 可以逐题保护答案');
assert.match(taskFiveSidepanelSource, /AI_EVIDENCE_FRAME_MAX_WIDTH\s*=\s*1536/, '最终证据帧应保留 1536px 级横向细节，避免代码/公式截图过早压缩');
assert.match(taskFiveSidepanelSource, /AI_EVIDENCE_FRAME_QUALITY\s*=\s*0\.9/, '最终证据帧 WebP 质量应保持在 0.90，候选数量受控后无需继续使用过度保守压缩');
assert.match(taskFiveSidepanelSource, /previousArtifactKey[\s\S]+?nextArtifactKey[\s\S]+?resetAiWorkbenchForMediaChange/, '逻辑视频 artifactKey 变化时必须显式重置 AI 工作台；同一 B站分P仅 pN\/cidN 运行时身份变化不应误清当前材料');
assert.match(taskFiveSidepanelSource, /function renderEmptyAiNoteState[\s\S]+?aiNoteContent\.innerHTML\s*=\s*''/, '新视频没有缓存时必须真正清空旧报告 DOM，而不能只清内存对象');
assert.match(taskFiveSidepanelSource, /function createMediaOperationContext[\s\S]+?mediaKey[\s\S]+?tabId/, '异步截图/生成操作必须绑定启动时的 mediaKey + tabId');
assert.match(taskFiveSidepanelSource, /expectedMediaKey/, 'Side Panel 截图请求必须把预期 mediaKey 发送给内容页做双端校验');
const taskFiveContentSource = fs.readFileSync(path.join(root, 'content/app.js'), 'utf8');
assert.match(taskFiveContentSource, /function getImageSource[\s\S]+?data-src[\s\S]+?data-lazy-src[\s\S]+?srcset/, '作者头像读取必须兼容站点懒加载图片来源，不能只依赖 img.src');
assert.match(taskFiveContentSource, /BSE_GET_MEDIA_CONTEXT[\s\S]+?resolveCurrentMediaContext\(\{ force: true \}\)/, 'AI 开始前必须能向当前视频页按需确认最新 MediaContext，避免字幕先就绪而标签仍未加载的竞态');
assert.match(taskFiveSidepanelSource, /function ensureCurrentPromptMediaContext[\s\S]+?BSE_GET_MEDIA_CONTEXT/, 'Side Panel 的内置与外部 AI 应共享同一个处理前媒体语境握手');
assert.match(taskFiveSidepanelSource, /planVisualEvidence\?\.\(\{[\s\S]{0,260}mediaContext: generationState\.mediaContext/, '内部图文规划必须显式传入与外部协作相同的 MediaContext');
assert.match(taskFiveSidepanelSource, /generateCourseNotes\?\.\(\{[\s\S]{0,260}mediaContext: generationState\.mediaContext/, '内部学习/复习生成必须显式传入统一 MediaContext，而不是只有外部复制才能看到标签');
assert.match(taskFiveSidepanelSource, /platform !== 'bilibili' \|\| state\.authorInfo\.avatar/, 'B站作者信息缺头像时不得因为已有姓名和合集信息就提前跳过 view API 兜底');
assert.match(taskFiveSidepanelSource, /TRACKER_CONTENT_REPAIR_BUDGET\s*=\s*2[\s\S]+?emptySubs[\s\S]+?slice\(0, remainingContentRepairBudget\)/, '旧订阅内容修复也必须有独立小预算，打开追踪页不能同时触发大量历史网络修复');
assert.match(taskFiveSidepanelSource, /TRACKER_METADATA_REPAIR_BUDGET\s*=\s*4[\s\S]+?repairSubscriptionMetadata\(sub, \{ activeBvid \}\)/, '追踪页应对历史缺失的 B站头像执行有界的元数据自愈，并限制单次 Side Panel 生命周期的修复预算');
assert.match(trackerSyncSource, /async function repairSubscriptionMetadata[\s\S]+?collectBilibiliViewCandidates[\s\S]+?fetchBilibiliView[\s\S]+?bilibiliViewMatchesSubscription[\s\S]+?mergeBilibiliOwnerMetadata/, '追踪核心必须遍历可信 BVID 候选，通过 view API 校验订阅归属后恢复作者头像，失效 latestBvid 不能阻断修复');
assert.match(taskFiveContentSource, /message\.expectedMediaKey\s*&&\s*message\.expectedMediaKey\s*!==\s*state\.mediaKey/, '内容页必须拒绝来自旧媒体上下文的截帧请求');
assert.match(taskFiveContentSource, /BSE_APPLY_EXTERNAL_SUBTITLE[\s\S]+?expectedMediaKey[\s\S]+?MEDIA_CONTEXT_CHANGED/, '离线转录结果回灌播放器前必须再次校验 mediaKey，页面切换后不得载入旧视频字幕');
assert.match(taskFiveContentSource, /BSE_RESOLVE_YOUTUBE_IN_TAB[\s\S]+?currentUrlVideoId\s*!==\s*requestedVideoId[\s\S]+?state\.mediaKey[\s\S]+?MEDIA_CONTEXT_CHANGED/, 'YouTube 标签页解析必须同时验证 URL videoId 与当前 mediaKey，不能只相信调用方筛选 tab');
assert.match(taskFiveContentSource, /FETCH_VIDEO_SUBTITLE[\s\S]+?result\?\.videoId[\s\S]+?MEDIA_CONTEXT_CHANGED/, 'YouTube MAIN-world bridge 返回后必须再次验证 result.videoId，防止 SPA 期间旧结果串台');
assert.match(taskFiveSidepanelSource, /const detail = await loadQueueItemDetail\(item\.id\)[\s\S]{0,220}const itemMediaKey = String\(detail\.mediaContext\?\.mediaKey \|\| detail\.expectedMediaKey \|\| ''\)/, '侧边栏载入队列结果必须按需读取单个完整 item，并优先保留任务自身的 exact media owner');
assert.match(taskFiveSidepanelSource, /BSE_APPLY_EXTERNAL_SUBTITLE[\s\S]+?expectedMediaKey:\s*tabMediaKey/, '侧边栏手动载入离线字幕必须先验证目标 URL，再携带当前 tab 的 authoritative media identity');
assert.match(taskFiveSidepanelSource, /mediaStateMatchesUrl\?\.\(tabState, item\.url\)/, '旧队列条目即使没有 mediaContext，也必须先证明当前 tab 属于该任务 URL 才能载入');
const sidepanelLocalAsrFlow = taskFiveSidepanelSource.match(/async function enqueueCurrentVideoForLocalASR[\s\S]*?elements\.emptyTranscribe\?\.addEventListener/)?.[0] || '';
assert.match(sidepanelLocalAsrFlow, /const targetUrl = activeTab\?\.url \|\| ''/, 'Side Panel 本机转录只能使用当前 active tab URL 作为目标');
assert.match(sidepanelLocalAsrFlow, /mediaStateMatchesUrl\?\.\(latestState, targetUrl\) === true/, '本机转录必须证明内容页状态仍属于当前 active tab URL');
assert.match(sidepanelLocalAsrFlow, /const enqueueMediaKey = latestMatchesTarget[\s\S]{0,120}: ''/, '本机转录只能从匹配当前 URL 的页面状态取得 authoritative mediaKey');
assert.match(sidepanelLocalAsrFlow, /if \(!enqueueMediaKey\)[\s\S]+?QUEUE_MEDIA_IDENTITY_UNAVAILABLE/, 'SPA 媒体身份不稳定时必须 fail closed，禁止退化成 URL-only 猜 CID');
assert.match(sidepanelLocalAsrFlow, /processingIntent:\s*'local-asr'/, 'Side Panel 的本机转录必须显式使用 local-asr intent');
assert.doesNotMatch(sidepanelLocalAsrFlow, /state\?\.mediaKey[\s\S]{0,180}youtube\.com\/watch|state\?\.mediaKey[\s\S]{0,180}bilibili\.com\/video/, 'Side Panel 不得从缓存 state.mediaKey 反推 URL 猜测当前媒体');
assert.doesNotMatch(sidepanelLocalAsrFlow, /BSE_COMMAND[\s\S]{0,120}REFRESH/, 'Side Panel 的本机转录不得先刷新或复用平台字幕');
const rollingLocalASRHandlerSource = taskFiveRollingPanelSource.match(/\.btn-transcribe-asr'\)\?\.addEventListener\('click'[\s\S]*?\.btn-retry/)?.[0] || '';
assert.match(rollingLocalASRHandlerSource, /processingIntent:\s*'local-asr'/, '播放器旁“离线转录”必须显式使用 local-asr intent');
assert.doesNotMatch(rollingLocalASRHandlerSource, /actions\.refresh/, '播放器旁“离线转录”不得重新进入字幕发现链');
assert.doesNotMatch(taskFiveSidepanelSource, /state\?\.status\s*!==\s*'ready'\s*&&\s*message\.state\?\.status\s*===\s*'ready'/, '当前活动 tab 已知时不得因为后台 tab 处于 ready 就越权接收其状态广播');

// AsrPolisher unit tests
assert.ok(BSE.AsrPolisher, 'AsrPolisher module must exist');
const testCues = [{ from: 0, to: 2, content: 'We use Quen and yTch' }, { from: 2, to: 4, content: 'and codecs tool.' }];
const testPrompt = BSE.AsrPolisher.buildPolishingPrompt('Hugging Face Journal Club', testCues);
assert.match(testPrompt, /Hugging Face Journal Club/);
assert.match(testPrompt, /L0001 \| We use Quen and yTch/);
assert.match(testPrompt, /只输出真正需要修改的行|NO_CHANGES/, '本机 LLM 精修与外部校对必须复用同一稀疏返回协议，避免模型重写整份字幕');
assert.doesNotMatch(testPrompt, /\[1\] We use Quen/, 'ASR 校对提示词使用独立行号语法，不再与字幕时间方括号混用');
assert.match(taskFiveAsrPolisherSource, /function splitPolishingCueChunks[\s\S]+?maxChars = 24000[\s\S]+?maxCues = 240/, '本机长字幕精修必须有有界字符/cue 双预算，短字幕保持单请求，长字幕才分块');
assert.match(taskFiveAsrPolisherSource, /for \(let index = 0; index < chunks\.length; index\+\+\)[\s\S]+?polished\.push\(\.\.\.applied\.cues\)/, '长字幕精修应逐块合并结果，一块失败不得迫使整条字幕重新对齐');

const aligned = BSE.AsrPolisher.alignPolishedCues(
  testCues,
  'L0001 | We use Qwen and PyTorch\nL0002 | and Codex tool.'
);
assert.equal(aligned.length, 2);
assert.equal(aligned[0].content, 'We use Qwen and PyTorch');
assert.equal(aligned[1].content, 'and Codex tool.');
const proofreadToken = BSE.Utils.buildSubtitlePatchToken('yt:Proofread01', 'track-en', testCues);
const sparsePolish = BSE.AsrPolisher.applyPolishResult(testCues, `SPARKSUB_PATCH ${proofreadToken}\nL0001 | We use Qwen and PyTorch`, { expectedTaskToken: proofreadToken });
const sparsePreview = BSE.AsrPolisher.applyPolishResult(testCues, `SPARKSUB_PATCH ${proofreadToken}\nL0001 | We use Qwen and PyTorch`, { expectedTaskToken: proofreadToken, materializeCues: false });
assert.equal(sparsePreview.cues, testCues, '校对预览只计算 patch，不应复制完整 cue 数组');
assert.equal(sparsePreview.changedCount, 1, '轻量预览仍必须准确报告真实修改数');
assert.equal(sparsePolish.mode, 'indexed');
assert.equal(sparsePolish.taskToken, proofreadToken);
assert.equal(sparsePolish.changedCount, 1, '稀疏校对只应产生真实变化的 patch');
assert.equal(sparsePolish.patches[0].index, 0);
assert.equal(sparsePolish.cues[1].content, testCues[1].content, '未返回的行必须直接复用现有字幕，不做重新对齐');
const timestampEchoPolish = BSE.AsrPolisher.applyPolishResult(testCues, 'L0002 ｜ [00:02] and Codex tool.');
assert.equal(timestampEchoPolish.cues[1].content, 'and Codex tool.', '模型误把输入时间列一起回显时应剥离时间，并兼容全角分隔符');
const missingTokenPolish = BSE.AsrPolisher.applyPolishResult(testCues, 'L0001 | We use Qwen and PyTorch', { expectedTaskToken: proofreadToken });
assert.equal(missingTokenPolish.mode, 'token_missing', 'Side Panel 导入缺少任务标识时必须拒绝，不能只靠 Lxxxx 猜归属');
const wrongTokenPolish = BSE.AsrPolisher.applyPolishResult(testCues, 'SPARKSUB_PATCH SPC1-deadbeefdeadbeef\nL0001 | We use Qwen and PyTorch', { expectedTaskToken: proofreadToken });
assert.equal(wrongTokenPolish.mode, 'token_mismatch', '另一视频、轨道或旧字幕版本的校对结果必须被任务标识拦截');
const noChangePolish = BSE.AsrPolisher.applyPolishResult(testCues, 'NO_CHANGES');
assert.equal(noChangePolish.mode, 'no_changes');
assert.equal(noChangePolish.changedCount, 0);
const unsafePolish = BSE.AsrPolisher.applyPolishResult(testCues, '这是一个没有行号且行数不匹配的自由段落');
assert.equal(unsafePolish.mode, 'unmatched', '无法证明行归属时必须 fail-closed，不做模糊猜测');
const arbitrarySameLineCount = BSE.AsrPolisher.applyPolishResult(testCues, '完全无关的第一段\n完全无关的第二段');
assert.equal(arbitrarySameLineCount.mode, 'unmatched', '旧全量纯文本兼容只有在多数行仍能证明与原字幕相关时才允许按位置回填');
const legacyAligned = BSE.AsrPolisher.alignPolishedCues(testCues, '[1] Legacy one\n[2] Legacy two');
assert.equal(legacyAligned[0].content, 'Legacy one', '旧 [N] 返回格式继续兼容，避免已有模型配置突然失效');

const dynamicAiPrompt = BSE.Formatters.generateSubtitlePolishPrompt([{ from: 0, to: 1, content: 'test' }], false, { title: 'AI 论文研读' });
assert.match(dynamicAiPrompt, /AI 论文研读/);

// === AI Media Context Pack ===
const contextPack = BSE.MediaContext.fromBilibiliView({
  bvid: 'BV1C1896KE3m',
  cid: 41281980079,
  page: 1,
  viewData: {
    title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
    tname: '校园学习',
    desc: '讲解 CRC、生成多项式与循环冗余检验。',
    owner: { name: '真题详解-27考研' },
    pages: [{ page: 1, cid: 41281980079, part: 'CRC循环冗余检验', duration: 207 }]
  },
  tags: ['计算机', '考研', '408', 'CRC', 'CRC', '计算机网络']
});
assert.equal(contextPack.mediaKey, 'bili:BV1C1896KE3m:cid41281980079');
assert.deepEqual(Array.from(contextPack.tags), ['计算机', '考研', '408', 'CRC', '计算机网络'], '媒体语境必须去重标签并保持平台顺序');
assert.equal(contextPack.category, '校园学习');
assert.equal(contextPack.partTitle, 'CRC循环冗余检验');
const learningPromptContext = BSE.MediaContext.formatPromptContext(contextPack);
assert.match(learningPromptContext, /标题：CRC循环冗余检验-\[一图流\]-408计算机考研笔记/, 'AI 语境必须显式保留视频标题');
assert.match(learningPromptContext, /标签：计算机、考研、408、CRC、计算机网络/, 'AI 语境必须把规范化标签作为高优先级主题信息');
assert.doesNotMatch(learningPromptContext, /真题详解-27考研|作者\/频道|平台：|简介：/, '学习/翻译 Prompt 语境不应携带对理解帮助很低的作者、平台和长简介');
const asrContextHint = BSE.MediaContext.buildASRContext(contextPack);
assert.equal(asrContextHint.topic, 'CRC循环冗余检验-[一图流]-408计算机考研笔记', 'ASR context 应只保留短主题，不携带简介全文');
assert.deepEqual(Array.from(asrContextHint.terms), ['计算机', '考研', '408', 'CRC', '计算机网络', '校园学习'], 'ASR context 应优先保留语义标签，仍有预算时再补分类，最多 6 个去重术语');
assert.equal(Object.prototype.hasOwnProperty.call(asrContextHint, 'description'), false, 'ASR context 不得上传页面简介');
assert.equal(Object.prototype.hasOwnProperty.call(asrContextHint, 'author'), false, 'ASR context 不得上传作者信息');
const translationContext = BSE.MediaContext.buildTranslationContext({
  mediaContext: contextPack,
  cues: [
    { from: 0, to: 1, content: '前文正在定义生成多项式。' },
    { from: 1, to: 2, content: '当前待翻译字幕。' },
    { from: 2, to: 3, content: '后文开始讨论模二除法。' }
  ],
  startIndex: 1,
  endIndex: 2,
  sourceLanguage: 'zh',
  targetLanguage: 'en'
});
assert.match(translationContext, /标签：计算机、考研、408、CRC、计算机网络/, '翻译上下文应带入受控标签用于术语消歧');
assert.match(translationContext, /前文正在定义生成多项式/, '翻译上下文应动态拼接前文');
assert.match(translationContext, /后文开始讨论模二除法/, '翻译上下文应动态拼接后文');
assert.doesNotMatch(translationContext, /当前待翻译字幕/, '当前待翻译块不应在 context 中重复，避免模型重复输出');
assert.match(translationContext, /不可信的内容数据/, '平台元数据必须明确作为不可信数据而非模型指令');
const translationPrompt = BSE.AsrPolisher.buildTranslationPrompt({
  mediaContext: contextPack,
  cues: [
    { from: 0, to: 1, content: '生成多项式是前文。' },
    { from: 1, to: 2, content: '这里讨论 CRC。' },
    { from: 2, to: 3, content: '下一步进行模二除法。' }
  ],
  startIndex: 1,
  endIndex: 2,
  sourceLanguage: 'zh',
  targetLanguage: 'en'
});
assert.match(translationPrompt, /L0002 \| 这里讨论 CRC/, 'AI 翻译 prompt 必须保持当前 chunk 的稳定行号锚点');
assert.match(translationPrompt, /生成多项式是前文/, 'AI 翻译 prompt 应动态带入邻接上下文');
assert.match(translationPrompt, /下一步进行模二除法/, 'AI 翻译 prompt 应动态带入后文');
assert.doesNotMatch(translationPrompt, /L0001 \|/, '邻接上下文不能伪装成待翻译输出行');
const polishingWithContext = BSE.AsrPolisher.buildPolishingPrompt('CRC循环冗余检验', testCues, contextPack);
assert.match(polishingWithContext, /408.*CRC/s, 'ASR 校对也应复用同一媒体语境帮助专有名词纠错');
const youtubeContext = BSE.MediaContext.fromYouTubeDetails({
  videoId: 'Ewd6CGwaEXY',
  videoDetails: {
    title: '4 Language Habits That Get You Fluent FAST',
    author: 'English Teacher',
    keywords: ['English', 'fluency', 'pronunciation'],
    shortDescription: 'Practical habits for improving spoken English.',
    lengthSeconds: '605'
  },
  microformat: { playerMicroformatRenderer: { category: 'Education' } }
});
assert.equal(youtubeContext.mediaKey, 'yt:Ewd6CGwaEXY');
assert.equal(youtubeContext.category, 'Education');
assert.deepEqual(Array.from(youtubeContext.tags), ['English', 'fluency', 'pronunciation'], 'YouTube keywords 应映射到同一 Context Pack，而不是另造平台专用 prompt');

mockFetch = async (url) => {
  assert.match(String(url), /x\/tag\/archive\/tags\?bvid=BV1C1896KE3m/);
  return {
    ok: true,
    json: async () => ({
      code: 0,
      data: [{ tag_name: '计算机' }, { tag_name: '考研' }, { tag_name: '408' }, { tag_name: 'CRC' }]
    })
  };
};
const fetchedBilibiliTags = await BSE.MediaContext.fetchBilibiliTags('BV1C1896KE3m');
assert.deepEqual(Array.from(fetchedBilibiliTags), ['计算机', '考研', '408', 'CRC'], 'Bilibili tag API 应归一成轻量语义标签，不持久化整份 API 对象');

// === 媒体一致性防错互锁与 SPA 跨视频污染防御回归测试 ===
// 1. Tracker Duration Guard 回归测试：拦截时长超标的错配字幕
const trackerDurationTestItem = {
  id: 'BV1C1896KE3m',
  title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
  author: '真题详解-27考研',
  url: 'https://www.bilibili.com/video/BV1C1896KE3m',
  duration: 207 // 目标视频时长 207s
};

// 模拟接口错误返回了老郭美食（时长 471s / 214句）的字幕 JSON
mockFetch = async (url) => {
  const urlStr = String(url || '');
  if (urlStr.includes('/x/web-interface/view')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          title: trackerDurationTestItem.title,
          cid: 41281980079,
          pages: [{ page: 1, cid: 41281980079, part: 'CRC循环冗余检验' }]
        }
      })
    };
  }
  if (urlStr.includes('/x/player/wbi/v2') || urlStr.includes('/x/player/v2')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          subtitle: {
            subtitles: [{
              lan: 'ai-zh',
              lan_doc: '中文',
              subtitle_url: 'https://i0.hdslb.com/bfs/subtitle/mismatched_laoguo.json'
            }]
          }
        }
      })
    };
  }
  if (urlStr.includes('mismatched_laoguo.json')) {
    return {
      ok: true,
      json: async () => ({
        body: [
          { from: 0.0, to: 9.0, content: '大蚂蝗每个人都爱吃 但你们了解蚂蝗吗' },
          { from: 468.0, to: 471.0, content: '咱们下期解密水质的神奇吃法' }
        ]
      })
    };
  }
  if (urlStr.includes('mismatched_bbq.json')) {
    return {
      ok: true,
      json: async () => ({
        body: [
          { from: 0.0, to: 6.0, content: '今天吃几碗烧烤的总结就是两个字' },
          { from: 244.0, to: 247.0, content: '向东流啊 天上的星星参北斗哇' }
        ]
      })
    };
  }
  return { ok: false, json: async () => ({}) };
};

const interceptedResult = await BSE.Tracker?.fetchSubtitleForItem ?
  await BSE.Tracker.fetchItemSubtitle?.(trackerDurationTestItem) : null;
if (interceptedResult) {
  assert.equal(interceptedResult.status, 'not_found', '严重时长错配的字幕必须被拦截判定为 not_found');
  assert.match(interceptedResult.errorHint, /时长严重不符/, '错误提示中必须包含时长严重不符');
}

// 1b. 针对 247s 烧烤视频对比 207s 考研视频的边界防错测试
mockFetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('x/web-interface/view')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
          duration: 207,
          pages: [{ page: 1, cid: 41281980079, duration: 207 }]
        }
      })
    };
  }
  if (urlStr.includes('x/player/wbi/v2')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          subtitle: {
            subtitles: [
              { lan: 'ai-zh', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/mismatched_bbq.json' }
            ]
          }
        }
      })
    };
  }
  if (urlStr.includes('mismatched_bbq.json')) {
    return {
      ok: true,
      json: async () => ({
        body: [
          { from: 0.0, to: 6.0, content: '今天吃几碗烧烤的总结就是两个字' },
          { from: 244.0, to: 247.0, content: '向东流啊 天上的星星参北斗哇' }
        ]
      })
    };
  }
  return { ok: false, json: async () => ({}) };
};

const bbqResult = await BSE.Tracker?.fetchItemSubtitle?.({
  id: 'BV1C1896KE3m',
  title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
  duration: 207
});
assert.equal(bbqResult.status, 'not_found', '247s 烧烤字幕在 207s 视频中必须被拦截判定为 not_found');
assert.match(bbqResult.errorHint, /时长严重不符/, '错误提示中必须包含时长严重不符');

// 1c. 针对 12 句（34s）残缺片头字幕对比 207s 考研视频的拦截测试
mockFetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('x/web-interface/view')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
          duration: 207,
          pages: [{ page: 1, cid: 41281980079, duration: 207 }]
        }
      })
    };
  }
  if (urlStr.includes('x/player/wbi/v2')) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          bvid: 'BV1C1896KE3m',
          subtitle: {
            subtitles: [
              { lan: 'ai-zh', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/mismatched_bumper.json' }
            ]
          }
        }
      })
    };
  }
  if (urlStr.includes('mismatched_bumper.json')) {
    return {
      ok: true,
      json: async () => ({
        body: [
          { from: 13.0, to: 20.0, content: '画面里这两位正在海底打电钻的潜水员' },
          { from: 26.0, to: 34.0, content: '我们自己也可以参与其中 哔哩哔哩' }
        ]
      })
    };
  }
  return { ok: false, json: async () => ({}) };
};

const bumperResult = await BSE.Tracker?.fetchItemSubtitle?.({
  id: 'BV1C1896KE3m',
  title: 'CRC循环冗余检验-[一图流]-408计算机考研笔记',
  duration: 207
});
assert.equal(bumperResult.status, 'not_found', '12句残缺片头字幕在 207s 视频中必须被拦截判定为 not_found');
assert.match(bumperResult.errorHint, /官方字幕残缺/, '错误提示中必须包含官方字幕残缺');

// 2. Queue Tab Snooping 防错测试：标签页处于旧视频状态时，队列绝不能盗用旧视频字幕
await BSE.Queue.clearAll();
const prevTabs = context.chrome.tabs;
context.chrome.tabs = {
  query: async () => [{
    id: 999,
    url: 'https://www.bilibili.com/video/BV1C1896KE3m',
    title: 'B站播放页'
  }],
  sendMessage: async (tabId, msg) => {
    if (msg?.type === 'BSE_GET_STATE') {
      return {
        status: 'ready',
        mediaKey: 'bili:BV1StsYecEmP:cid25983519148', // 标签页中残留老郭美食的 mediaKey
        bvid: 'BV1StsYecEmP',
        cues: [
          { from: 0.0, to: 9.0, content: '大蚂蝗每个人都爱吃 但你们了解蚂蝗吗' },
          { from: 468.0, to: 471.0, content: '咱们下期解密水质的神奇吃法' }
        ]
      };
    }
    return null;
  }
};

mockFetch = biliResponse({ tracks: [] });

setFakeNativeHost(
  async (payload) => [{ from: 0, to: 3, content: 'CRC循环冗余校验码正确的本地转录结果。' }]
);

await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1C1896KE3m');
await BSE.Queue.processPendingJobs();
const queueProcessedItem = await getOnlyQueueItem();
if (queueProcessedItem.stage !== 'done') {
  console.error('Queue item failed with error:', queueProcessedItem.error, queueProcessedItem.failureDetail);
}
assert.equal(queueProcessedItem.stage, 'done');
assert.notEqual(queueProcessedItem.stageArtifacts?.captionTrackId, 'tab_current', '绝不能窃取未匹配或残留的标签页字幕');
assert.equal(queueProcessedItem.subtitle?.source, 'native', '当标签页与官方均无字幕时，必须安全落入本地转录');
assert.match(queueProcessedItem.subtitle?.plainText, /CRC循环冗余/, '转录文本必须属于目标视频');
context.chrome.tabs = prevTabs;

// 2a. SPA URL 与 content mediaKey 冲突时必须拒绝入队，不能任选一个身份继续
await BSE.Queue.clearAll();
await assert.rejects(
  () => BSE.Queue.addToQueue([{
    url: 'https://www.bilibili.com/video/BV1C1896KE3m',
    mediaKey: 'bili:BV1StsYecEmP:cid25983519148'
  }]),
  /页面视频身份正在切换/,
  'URL 与页面 mediaKey 指向不同 BVID 时必须 fail-closed'
);
assert.equal((await BSE.Queue.getQueue()).length, 0, '媒体身份冲突时不能留下任何排队任务');
await assert.rejects(
  () => BSE.Queue.addToQueue([{
    url: 'https://www.bilibili.com/video/BV1C1896KE3m?p=2',
    mediaKey: 'bili:BV1C1896KE3m:p1'
  }]),
  /页面视频身份正在切换/,
  '同一 BVID 下 URL=P2 但页面 mediaKey=P1 时也必须 fail-closed'
);
await assert.rejects(
  () => BSE.Queue.addToQueue([{
    url: 'https://www.bilibili.com/video/BV1C1896KE3m?p=2',
    mediaKey: 'bili:BV1C1896KE3m:p2',
    processingIntent: 'local-asr'
  }], { processingIntent: 'local-asr' }),
  /页面视频身份正在切换/,
  '当前页面明确 local-asr 时只拿到粗粒度 P 号不够，必须等待精确 CID'
);

// 2b. Queue Tab Snooping 防错测试：ready state 缺少媒体身份时也绝不能复用
await BSE.Queue.clearAll();
context.chrome.tabs = {
  query: async () => [{
    id: 1000,
    url: 'https://www.bilibili.com/video/BV1C1896KE3m',
    title: '目标 B 站播放页'
  }],
  sendMessage: async (tabId, msg) => {
    if (msg?.type === 'BSE_GET_STATE') {
      return {
        status: 'ready',
        cues: [
          { from: 0.0, to: 4.0, content: '这是另一个视频残留在页面里的字幕' },
          { from: 4.0, to: 8.0, content: '缺少 mediaKey 时不能被当前任务复用' }
        ],
        tracks: [{ id: 'stale', lan: 'zh-CN', lanDoc: '旧字幕' }]
      };
    }
    return null;
  }
};
mockFetch = biliResponse({ tracks: [] });
setFakeNativeHost(async () => [{ from: 0, to: 3, content: '目标视频经过本地 ASR 得到的结果。' }]);
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1C1896KE3m');
await BSE.Queue.processPendingJobs();
let identitylessTabItem = await getOnlyQueueItem();
assert.equal(identitylessTabItem.subtitle?.source, 'native', '缺少媒体身份的 ready tab state 绝不能被离线转录任务当成目标字幕');
assert.match(identitylessTabItem.subtitle?.plainText, /目标视频经过本地 ASR/);
context.chrome.tabs = prevTabs;

// 2c. 同 BVID 不同 CID 也必须视为不同媒体，不能跨分P复用字幕
await BSE.Queue.clearAll();
context.chrome.tabs = {
  query: async () => [{
    id: 1002,
    url: 'https://www.bilibili.com/video/BV1C1896KE3m',
    title: '同 BV 的其他分P'
  }],
  sendMessage: async (tabId, msg) => {
    if (msg?.type === 'BSE_GET_STATE') {
      return {
        status: 'ready',
        mediaKey: 'bili:BV1C1896KE3m:cid999999',
        cues: [
          { from: 0.0, to: 4.0, content: '同一个 BV 但是另一个 CID 的字幕' },
          { from: 4.0, to: 8.0, content: '不能串到当前分P' }
        ],
        tracks: [{ id: 'wrong-cid', lan: 'zh-CN', lanDoc: '其他分P字幕' }]
      };
    }
    return null;
  }
};
mockFetch = biliResponse({ tracks: [] });
setFakeNativeHost(async () => [{ from: 0, to: 3, content: 'CID 42 对应视频的本地 ASR 结果。' }]);
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1C1896KE3m');
await BSE.Queue.processPendingJobs();
let wrongCidTabItem = await getOnlyQueueItem();
assert.equal(wrongCidTabItem.subtitle?.source, 'native', '同 BVID 但不同 CID 的 tab state 绝不能复用');
assert.match(wrongCidTabItem.subtitle?.plainText, /CID 42/);
context.chrome.tabs = prevTabs;

// 2d. 字幕接口若明确返回另一个 BVID/CID，必须忽略并进入目标媒体的本地 ASR
await BSE.Queue.clearAll();
let wrongApiCaptionFetches = 0;
let wrongApiNativeCalls = 0;
context.chrome.tabs = { query: async () => [], sendMessage: async () => null };
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1C1896KE3m', cid: 42, title: '目标媒体', duration: 10, pages: [{ page: 1, cid: 42, part: '正片', duration: 10 }] } }) };
  }
  if (url.includes('x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  if (url.includes('x/player/wbi/v2') || url.includes('x/player/v2')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1StsYecEmP', cid: 999999, subtitle: { subtitles: [
      { lan: 'zh-CN', lan_doc: '错误媒体字幕', subtitle_url: 'https://caption.wrong-media/other' }
    ] } } }) };
  }
  if (url.includes('caption.wrong-media')) {
    wrongApiCaptionFetches += 1;
    return { ok: true, json: async () => ({ body: [{ from: 0, to: 5, content: '绝不能下载的其他视频字幕' }] }) };
  }
  if (url.includes('x/player/playurl')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1C1896KE3m', cid: 42, dash: { duration: 10, audio: dashFixture } } }) };
  }
  throw new Error(`unexpected wrong-media guard request: ${url}`);
};
setFakeNativeHost(async () => {
  wrongApiNativeCalls += 1;
  return [{ from: 0, to: 3, content: '目标视频自己的 ASR 字幕。' }];
});
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1C1896KE3m');
await BSE.Queue.processPendingJobs();
let wrongApiItem = await getOnlyQueueItem();
assert.equal(wrongApiCaptionFetches, 0, '明确属于其他 BVID/CID 的字幕轨绝不能继续下载');
assert.equal(wrongApiNativeCalls, 1, '错误平台字幕被拒绝后应只转录当前目标媒体');
assert.equal(wrongApiItem.subtitle?.source, 'native');
assert.match(wrongApiItem.subtitle?.plainText, /目标视频自己的 ASR/);

// 2e. playurl 若返回其他媒体身份，必须在调用 SparkScribe 前终止
await BSE.Queue.clearAll();
let mismatchedAudioNativeCalls = 0;
mockFetch = async (url) => {
  if (url.includes('x/web-interface/view')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1C1896KE3m', cid: 42, title: '目标媒体', duration: 10, pages: [{ page: 1, cid: 42, part: '正片', duration: 10 }] } }) };
  }
  if (url.includes('x/web-interface/nav')) return { ok: true, json: async () => ({ code: 0, data: { wbi_img: {} } }) };
  if (url.includes('x/player/wbi/v2') || url.includes('x/player/v2')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1C1896KE3m', cid: 42, subtitle: { subtitles: [] } } }) };
  }
  if (url.includes('x/player/playurl')) {
    return { ok: true, json: async () => ({ code: 0, data: { bvid: 'BV1StsYecEmP', cid: 999999, dash: { duration: 10, audio: dashFixture } } }) };
  }
  throw new Error(`unexpected mismatched-audio request: ${url}`);
};
setFakeNativeHost(async () => {
  mismatchedAudioNativeCalls += 1;
  return [{ from: 0, to: 2, content: '不应执行' }];
});
await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1C1896KE3m');
await BSE.Queue.processPendingJobs();
let mismatchedAudioItem = await getOnlyQueueItem();
assert.equal(mismatchedAudioNativeCalls, 0, '音频身份不匹配时绝不能把错误媒体交给 SparkScribe');
assert.equal(mismatchedAudioItem.stage, 'failed');
assert.equal(mismatchedAudioItem.errorCode, 'INVALID_REQUEST');

context.chrome.tabs = prevTabs;

// 3. Queue Tab Direct Extraction & Broadcast Sync: 当已打开的标签页属于目标视频时，直接复用字幕并成功广播
await BSE.Queue.clearAll();
let broadcastMessagesReceived = [];
const matchingTabContext = {
  id: 1001,
  url: 'https://www.bilibili.com/video/BV1gxuH6MEKo',
  title: '目标测试视频'
};
context.chrome.tabs = {
  query: async () => [matchingTabContext],
  sendMessage: async (tabId, msg) => {
    if (msg?.type === 'BSE_GET_STATE') {
      return {
        status: 'ready',
        mediaKey: 'bili:BV1gxuH6MEKo:cid42',
        bvid: 'BV1gxuH6MEKo',
        cues: [
          { from: 0.0, to: 5.0, content: '已直接从网页解析提取到的第一句字幕' },
          { from: 5.0, to: 10.0, content: '已直接从网页解析提取到的第二句字幕' }
        ],
        tracks: [{ id: 'ai-zh', lan: 'ai-zh', lanDoc: 'AI 中文字幕' }]
      };
    }
    if (msg?.type === 'BSE_QUEUE_UPDATED') {
      broadcastMessagesReceived.push({ tabId, msg });
    }
    return null;
  }
};

mockFetch = biliResponse({
  tracks: [],
  meta: { bvid: 'BV1gxuH6MEKo', title: '目标测试视频', duration: 10 }
});

await BSE.Queue.addToQueue('https://www.bilibili.com/video/BV1gxuH6MEKo');
await BSE.Queue.processPendingJobs();
const tabExtractedItem = await getOnlyQueueItem();
assert.equal(tabExtractedItem.stage, 'done', '直接从网页提取字幕后必须正确完成 stage=done');
assert.equal(tabExtractedItem.subtitle?.source, 'platform', '字幕来源应标记为 platform');
assert.equal(tabExtractedItem.subtitle?.cueCount, 2, '字幕句数必须与网页提取一致');
assert.match(tabExtractedItem.subtitle?.plainText, /从网页解析提取到的第一句字幕/);
assert.ok(broadcastMessagesReceived.length > 0, '处理完成必须向标签页广播 BSE_QUEUE_UPDATED 消息');
context.chrome.tabs = prevTabs;

// === 7. 通道 A 视频高分辨率截帧与时间戳定位测试 (Video Frame Capture Suite) ===
const mockVideoElement = {
  videoWidth: 1920,
  videoHeight: 1080,
  currentTime: 42.5,
  duration: 360.0,
  paused: true,
  readyState: 4,
  seeking: false,
  buffered: {
    length: 1,
    start: () => 0,
    end: () => 360
  },
  listeners: {},
  addEventListener(event, handler, opts) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push({ handler, once: Boolean(opts?.once) });
  },
  removeEventListener(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l.handler !== handler);
  },
  dispatchEvent(event) {
    const list = this.listeners[event] || [];
    this.listeners[event] = [];
    for (const item of list) {
      item.handler();
    }
  }
};

let lastDrawnCanvas = null;
const mockDoc = {
  hidden: false,
  querySelector(selector) {
    if (selector.includes('video')) return mockVideoElement;
    return null;
  },
  createElement(tag) {
    if (tag === 'canvas') {
      const canvas = {
        width: 0,
        height: 0,
        getContext(type) {
          if (type !== '2d') return null;
          return {
            drawImage: (img, sx, sy, sw, sh) => {
              lastDrawnCanvas = { width: canvas.width, height: canvas.height, sw, sh };
            },
            getImageData: () => ({
              data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(128)
            })
          };
        },
        toDataURL(format = 'image/webp', quality = 0.92) {
          if (canvas._tainted) {
            const err = new Error('The canvas has been tainted by cross-origin data.');
            err.name = 'SecurityError';
            throw err;
          }
          return `data:${format};base64,MOCK_FRAME_BYTES_${canvas.width}x${canvas.height}_Q${quality}`;
        }
      };
      return canvas;
    }
    return {};
  }
};
globalThis.document = mockDoc;
if (typeof context !== 'undefined') context.document = mockDoc;

// 7a. 原生高清原图截取 (1080p WebP 0.92)
const frame1080p = BSE.Media.captureVideoFrame(mockVideoElement);
assert.equal(frame1080p.success, true, '应当成功完成 1080p 视频帧截取');
assert.equal(frame1080p.width, 1920);
assert.equal(frame1080p.height, 1080);
assert.equal(frame1080p.timestamp, 42.5);
assert.match(frame1080p.dataUrl, /data:image\/webp;base64/);

// 7b. 指定最大宽度缩放截取 (maxWidth: 1280 -> 1280x720)
const frameScaled = BSE.Media.captureVideoFrame(mockVideoElement, { maxWidth: 1280 });
assert.equal(frameScaled.success, true);
assert.equal(frameScaled.width, 1280);
assert.equal(frameScaled.height, 720);
assert.equal(frameScaled.originalWidth, 1920);

const contactSheetLayout = BSE.Media.getContactSheetLayout(4);
assert.equal(contactSheetLayout.maxFrames, 4, '剪贴板拼图应严格限制最多 4 张，避免超长图被视觉模型整体缩小');
assert.equal(contactSheetLayout.columns, 2, '3~4 张画面应使用双列联系表，而不是无限纵向长图');
assert.equal(contactSheetLayout.width, 1152, '联系表应使用受控画布宽度，兼顾文字清晰度与主流视觉模型缩放策略');
assert.equal(BSE.Media.getContactSheetLayout(8, { maxFrames: 6 }).maxFrames, 4, '联系表底层接口也不得绕过最多 4 张的质量上限');
assert.equal(frameScaled.originalHeight, 1080);

// 7c. 指定目标时间戳捕获与自动恢复原播放位置 (captureVideoFrameAt with seek & restore)
const capturePromise = BSE.Media.captureVideoFrameAt(125.0, {
  videoElement: mockVideoElement,
  restoreTime: true
});
// 模拟播放器异步 seeked 触发
assert.equal(mockVideoElement.currentTime, 125.0, '应当将播放器 seek 至目标 125.0s');
mockVideoElement.dispatchEvent('seeked');
const frameAtTime = await capturePromise;
assert.equal(frameAtTime.success, true);
assert.equal(mockVideoElement.currentTime, 42.5, 'restoreTime 为 true 时必须自动恢复回原本播放位置 42.5s');

// seeked 不是“目标帧已解码”的同义词：网络慢时 readyState 仍不足，必须继续等待 loadeddata/canplay。
let bufferingTime = 10;
const bufferingVideo = {
  videoWidth: 1280,
  videoHeight: 720,
  duration: 300,
  paused: true,
  readyState: 1,
  seeking: false,
  buffered: { length: 0, start: () => 0, end: () => 0 },
  listeners: {},
  get currentTime() { return bufferingTime; },
  set currentTime(value) { bufferingTime = value; },
  addEventListener(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event, handler) {
    this.listeners[event] = (this.listeners[event] || []).filter((item) => item !== handler);
  },
  dispatchEvent(event) {
    for (const handler of [...(this.listeners[event] || [])]) handler();
  }
};
const bufferingPromise = BSE.Media.captureVideoFrameAt(100, { videoElement: bufferingVideo, timeoutMs: 300 });
bufferingVideo.dispatchEvent('seeked');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(bufferingVideo.readyState, 1, '测试必须先停留在仅有元数据、目标帧尚未可读的状态');
bufferingVideo.readyState = 2;
bufferingVideo.buffered = { length: 1, start: () => 95, end: () => 105 };
bufferingVideo.dispatchEvent('loadeddata');
const bufferingFrame = await bufferingPromise;
assert.equal(bufferingFrame.success, true, 'seeked 后应继续等目标帧真正可读，而不是网卡时立即截旧画面');

// 后台标签页仍应允许按媒体事件完成截图；焦点/页面 rAF 不应成为截图前提。
mockDoc.hidden = true;
const backgroundPromise = BSE.Media.captureVideoFrameAt(140, { videoElement: mockVideoElement, timeoutMs: 300, restoreTime: true });
mockVideoElement.dispatchEvent('seeked');
const backgroundFrame = await backgroundPromise;
assert.equal(backgroundFrame.success, true, '标签页失焦/后台时仍应完成截图，不得依赖 requestAnimationFrame');
mockDoc.hidden = false;

// 可见但暂停的视频也不能把 requestVideoFrameCallback 当成硬前提：seeked + HAVE_CURRENT_DATA 已足够证明 Canvas 可读。
let visiblePausedTime = 20;
let requestedVideoFrameCallbacks = 0;
const visiblePausedVideo = {
  videoWidth: 1280,
  videoHeight: 720,
  duration: 300,
  paused: true,
  readyState: 4,
  seeking: false,
  buffered: { length: 1, start: () => 0, end: () => 300 },
  listeners: {},
  get currentTime() { return visiblePausedTime; },
  set currentTime(value) { visiblePausedTime = value; },
  addEventListener(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event, handler) {
    this.listeners[event] = (this.listeners[event] || []).filter((item) => item !== handler);
  },
  dispatchEvent(event) {
    for (const handler of [...(this.listeners[event] || [])]) handler();
  },
  requestVideoFrameCallback() {
    requestedVideoFrameCallbacks++;
    return 1;
  }
};
const visiblePausedPromise = BSE.Media.captureVideoFrameAt(160, { videoElement: visiblePausedVideo, timeoutMs: 120 });
visiblePausedVideo.dispatchEvent('seeked');
const visiblePausedFrame = await visiblePausedPromise;
assert.equal(visiblePausedFrame.success, true, '可见但暂停的视频 seek 完成后不应因为 rVFC 没有下一帧而假超时');
assert.equal(requestedVideoFrameCallbacks, 0, '截图就绪判定不应依赖页面呈现回调，避免暂停/后台页节流影响取帧');

let stubbornCurrentTime = 5;
const stubbornVideo = {
  videoWidth: 1280,
  videoHeight: 720,
  duration: 300,
  paused: true,
  get currentTime() { return stubbornCurrentTime; },
  set currentTime(_value) { stubbornCurrentTime = 5; },
  addEventListener() {},
  removeEventListener() {}
};
const mismatchedSeekFrame = await BSE.Media.captureVideoFrameAt(100, {
  videoElement: stubbornVideo,
  timeoutMs: 5
});
assert.equal(mismatchedSeekFrame.success, false, '显式时间点 seek 明显失败时不得把旧画面伪装成目标截图');
assert.equal(mismatchedSeekFrame.error, 'SEEK_TARGET_MISMATCH');

let unconfirmedCurrentTime = 5;
const unconfirmedVideo = {
  videoWidth: 1280,
  videoHeight: 720,
  duration: 300,
  paused: true,
  get currentTime() { return unconfirmedCurrentTime; },
  set currentTime(value) { unconfirmedCurrentTime = value; },
  addEventListener() {},
  removeEventListener() {}
};
const unconfirmedSeekFrame = await BSE.Media.captureVideoFrameAt(100, {
  videoElement: unconfirmedVideo,
  timeoutMs: 5
});
assert.equal(unconfirmedSeekFrame.success, false, 'currentTime 已变化但没有 seeked/解码确认时也不得抓取可能仍是旧内容的 Canvas');
assert.equal(unconfirmedSeekFrame.error, 'FRAME_NOT_DECODED');

// 7d. AI 视觉证据截帧不能只靠“窗口靠后”猜测：应在目标附近采样少量真实像素并选择稳定代表帧，结束后恢复播放位置。
const stableSeekTicker = setInterval(() => mockVideoElement.dispatchEvent('seeked'), 8);
const stableFrame = await BSE.Media.captureStableVideoFrame({
  windowStart: 90,
  windowEnd: 110,
  targetSec: 100
}, {
  videoElement: mockVideoElement,
  maxWidth: 1280,
  timeoutMs: 500
});
clearInterval(stableSeekTicker);
assert.equal(stableFrame.success, true, '稳定代表帧流程应返回可用截图');
assert.equal(stableFrame.selection?.strategy, 'visual', '存在像素签名时必须走真实视觉候选比较而不是纯时间启发式');
assert.equal(stableFrame.selection?.sampledTimestamps.length, 3, '默认只采样少量候选帧，避免过度寻道');
assert.ok(Number.isFinite(stableFrame.selection?.visualScore), '视觉候选应携带可诊断的评分');
assert.equal(mockVideoElement.currentTime, 42.5, '稳定帧筛选结束后必须恢复用户原播放位置');

// 瞬态未缓冲由 Media Module 内部重试一次；Side Panel 不应发送第二次业务请求。
let retryTime = 20;
let retryAssignments = 0;
const retryVideo = {
  videoWidth: 1280,
  videoHeight: 720,
  duration: 300,
  paused: true,
  readyState: 1,
  seeking: false,
  buffered: { length: 0, start: () => 0, end: () => 0 },
  listeners: {},
  get currentTime() { return retryTime; },
  set currentTime(value) {
    retryTime = value;
    retryAssignments++;
    if (retryAssignments >= 2) {
      this.readyState = 4;
      this.buffered = { length: 1, start: () => 0, end: () => 300 };
      queueMicrotask(() => this.dispatchEvent('seeked'));
    }
  },
  addEventListener(event, handler) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  },
  removeEventListener(event, handler) {
    this.listeners[event] = (this.listeners[event] || []).filter((item) => item !== handler);
  },
  dispatchEvent(event) {
    for (const handler of [...(this.listeners[event] || [])]) handler();
  }
};
const retriedStableFrame = await BSE.Media.captureStableVideoFrame({
  windowStart: 200,
  windowEnd: 210,
  targetSec: 205
}, {
  videoElement: retryVideo,
  maxWidth: 1280,
  timeoutMs: 100
});
assert.equal(retriedStableFrame.success, true, '第一次目标窗口未缓冲时应由 Media Module 有限重试并恢复');
assert.equal(retriedStableFrame.warning, 'RETRIED_AFTER_BUFFERING', '重试成功应留下轻量诊断标记供上层展示');
assert.equal(retryTime, 20, '网络重试完成后仍必须恢复用户原播放位置');

// 7e. 边界异常防御：未就绪视频与画布跨域污染
const unreadyVideo = { videoWidth: 0, videoHeight: 0, currentTime: 0 };
const frameUnready = BSE.Media.captureVideoFrame(unreadyVideo);
assert.equal(frameUnready.success, false);
assert.equal(frameUnready.error, 'VIDEO_NOT_READY');

// === 8. AI 课程图文分解与富文本渲染测试 (AI Visual Course Notes Suite) ===
const sampleCues = [
  { from: 0.0, to: 15.0, content: '大家好，今天我们来学习拉格朗日中值定理的几何证明。' },
  { from: 75.0, to: 90.0, content: '观察切线斜率与割线斜率的关系，当函数在闭区间连续开区间可导时。' },
  { from: 180.0, to: 210.0, content: '接下来我们来看这道典型的考研真题与避坑要点。' }
];

// 8a. 关键帧锚点提取
const anchors = BSE.Ai.extractKeyframeTimestamps(sampleCues, 5);
assert.ok(Array.isArray(anchors) && anchors.length > 0, '应当成功提取关键帧锚点');
assert.ok(anchors.every((a) => Number.isFinite(a.timestamp)), '锚点时间戳必须为合法数字');

assert.ok(anchors.every((a) => Number.isFinite(a.timestamp)), '锚点时间戳必须为合法数字');

// 8b. 富文本与图文卡片 HTML 渲染 (含 GFM 表格、代码块、KaTeX 渲染与 \$ / % 转义清理)
const testMarkdown = `# 《高数中值定理》深度课程分解
---
## 1. 几何意义
这里是关于切线的说明：$\\to$ 观察切线斜率与割线斜率的关系，覆盖 $60\\% \\sim 75\\%$ 的真题。
![拉格朗日中值定理几何切线板书](frame://01:15)
$$f'(c) = \\frac{f(b) - f(a)}{b - a}$$
##### 算子：Doing 动名词短语
$$\\text{Doing-VP} = V\\text{-ing} + (\\text{NP} \\mid \\text{PP})$$

| 误区维度 | 错误动作表现 | 产生机理与危害 | 纠偏与有效边界 |
| :--- | :--- | :--- | :--- |
| 误区一：机械划线综合征 | 逐字寻找介词、不定式等标记符号 | 增加了认知负荷，阅读速度反而下降 | 语法分类仅在初级分析长难句时作为自检辅助 |
| 误区二：修饰成分被动割裂 | 遇到后置修饰时，生硬将主词与从句切断 | 缺乏对宏观意群的层级封装能力 | 意群切分支持层级嵌套 |

\`\`\`python
def solve_derivative(f, x):
    return (f(x + 1e-5) - f(x)) / 1e-5
\`\`\`
`;

const imagesMap = {
  '01:15': {
    dataUrl: 'data:image/webp;base64,TEST_IMAGE_75S',
    timestamp: 75,
    label: '几何板书'
  }
};

const renderedHtml = BSE.Formatters.renderNoteToHtml(testMarkdown, { imagesMap });
assert.match(renderedHtml, /<h1 class="note-h1">/, '应正确渲染 H1 标题');
assert.match(renderedHtml, /<h5 class="note-h5">/, '应正确渲染 H5 标题');
const timelineHeadingHtml = BSE.Formatters.renderNoteToHtml('## [01:15–03:30] 切线与割线的几何关系');
assert.match(timelineHeadingHtml, /note-timeline-heading[^>]+data-range-start="75"[^>]+data-range-end="210"/, '带时间范围的二级标题必须保留章节起止秒数');
assert.match(timelineHeadingHtml, /class="note-timeline-jump" data-seek="75"/, '章节时间轴必须渲染成可回跳视频起点的真实按钮');
assert.match(timelineHeadingHtml, /01:15–03:30/, '章节标题必须向用户直接显示该节覆盖的视频范围');
assert.match(timelineHeadingHtml, /note-timeline-title">切线与割线的几何关系<\/span>/, '时间轴不应吞掉章节标题正文');
assert.match(renderedHtml, /<hr class="note-hr"/, '应正确渲染分割线');
assert.match(renderedHtml, /note-image-card/, '应正确将 frame:// Markdown 图片引用转换为 note-image-card');
assert.match(renderedHtml, /note-card-delete-btn/, '图片卡片上必须包含可删除图片的按钮');
assert.match(renderedHtml, /data-seek="75"/, '图片跳转按钮必须携带精确的秒数 75s');
assert.match(renderedHtml, /katex/, 'KaTeX 应成功将数学公式渲染为专业排版结构');

// 8b-0. 数学公式排版深度优化测试：\( ... \) 与 \[ ... \] 识别、CJK 汉字支持、加粗与标题样式深度适配
const mathMixedMarkdown = `### 模型二：识别乘积求导 $f'(x) = 2x$
若分子看起来像：
\\[ u'v + uv' \\]
优先猜：
$$ (uv)' $$
一坨复杂分式便可以整体压缩成一个 **$du$**。
模型三：“\\(e^{框框}\\times圆圈\\)”
`;
const mathRenderedHtml = BSE.Formatters.renderNoteToHtml(mathMixedMarkdown);
assert.match(mathRenderedHtml, /<h3 class="note-h3">[\s\S]*?katex[\s\S]*?<\/h3>/, '标题中的行内公式应成功渲染为 KaTeX 结构');
assert.match(mathRenderedHtml, /katex-display/, '块级公式 \\[ ... \\] 与 $$ ... $$ 应生成专业 display 排版');
assert.doesNotMatch(mathRenderedHtml, /\\\(|\\\[|\\\]|\\\)/, '渲染后不得将 \\( 或 \\[ 等 LaTeX 定界符原样泄漏给用户');
assert.match(mathRenderedHtml, /<strong>[\s\S]*?katex[\s\S]*?<\/strong>/, '加粗中的数学公式必须被正确包裹在 strong 标签中');
assert.match(mathRenderedHtml, /cjk_fallback/, '公式中的 CJK 汉字必须通过 KaTeX 回退机制优雅排版');

// 样式断言：公式去除大深色卡片背景与硬边框，深度适配加粗与标题
assert.match(taskFiveSidepanelCss, /\.katex-display-wrap,\s*\.katex-display\s*\{[^}]*background:\s*transparent/s, '块级公式应移除突兀厚重的深色卡片背景');
assert.match(taskFiveSidepanelCss, /\.katex-display-wrap,\s*\.katex-display\s*\{[^}]*border:\s*none/s, '块级公式应移除硬边框，保持干净学术排版流');
assert.match(taskFiveSidepanelCss, /strong\s+\.katex/s, '必须具备 strong / 加粗环境下的公式字重与字体深度适配');
assert.match(taskFiveSidepanelCss, /\.note-h1\s+\.katex/s, '必须具备标题环境下的公式比例与字重适配');
assert.match(taskFiveSidepanelCss, /\.ai-note-content\s+\.katex\s*\{[^}]*color:\s*inherit/s, '公式必须继承父级文本颜色，避免标题/加粗中掉色');
assert.match(renderedHtml, /<table class="note-table">/, 'Markdown 表格应成功解析为 table 结构');
assert.match(renderedHtml, /<th style="text-align:left">误区维度<\/th>/, '表头单元格与对齐方式必须正确');
assert.match(renderedHtml, /<pre class="note-code-block"><code class="language-python">/, '多行代码块应成功解析并保留代码语言');
assert.match(renderedHtml, /<table class="note-table">/, '表格块不得因为新的文档流解析器被段落包裹');
assert.doesNotMatch(renderedHtml, /<p class="note-p">\s*<div|<p class="note-p">\s*<table/i, '块级内容不得被非法包在段落中交给浏览器自行纠正');
const boundaryMarkdown = `**为什么不成立**\r\n\r\n视频最后专门用这个例子说明产品边界。\r\n\r\n假设已经知道：\r\n\r\n\`id = 100\`\r\n\r\nMilvus 确实能够查询。\r\n\r\n> 从海量向量中找到一批相似候选。\r\n\r\n**正确判断**\r\n\r\nMilvus：\r\n\r\n**能做 ID 精确查询 ≠ 最适合以 ID 精确查询为主要访问模式。**`;
const boundaryHtml = BSE.Formatters.renderNoteToHtml(boundaryMarkdown);
assert.match(boundaryHtml, /<p class="note-p note-emphasis-label"><strong>为什么不成立<\/strong><\/p>/, '独立粗体小标题必须稳定渲染，不能把 ** 标记原样露给用户');
assert.match(boundaryHtml, /<p class="note-p note-emphasis-label"><strong>正确判断<\/strong><\/p>/, 'CRLF 导入的 Markdown 也必须正确识别独立粗体标签');
assert.match(boundaryHtml, /<code class="note-inline-code">id = 100<\/code>/, '行内代码必须在长笔记中保持正确样式');
assert.match(boundaryHtml, /<blockquote class="note-quote">从海量向量中找到一批相似候选。<\/blockquote>/, '引用块必须形成真实块级结构');
assert.doesNotMatch(boundaryHtml, /\*\*为什么不成立\*\*|\*\*正确判断\*\*/, '已识别的粗体 Markdown 标记不得泄漏到最终 HTML');
const listHtml = BSE.Formatters.renderNoteToHtml('- 第一条\n- 第二条\n\n1. 第一步\n2. 第二步');
assert.match(listHtml, /<ul class="note-list"><li>第一条<\/li><li>第二条<\/li><\/ul>/, '无序列表必须拥有合法 ul 容器');
assert.match(listHtml, /<ol class="note-list"><li>第一步<\/li><li>第二步<\/li><\/ol>/, '有序列表必须拥有合法 ol 容器');
const builtFrameReference = BSE.Formatters.buildFrameReference('01:15', '几何切线板书');
assert.equal(builtFrameReference, '![几何切线板书](frame://01:15)', '新的截图引用应使用自然 Markdown 语法');
const transformedFrameReference = BSE.Formatters.transformFrameReferences(builtFrameReference, (ref) => `${ref.seconds}:${ref.label}`);
assert.equal(transformedFrameReference, '75:几何切线板书', '渲染/删除/导出应共享同一 frame 引用解析 seam');
const legacyFrameHtml = BSE.Formatters.renderNoteToHtml('[SCREENSHOT: 01:15 "旧缓存画面"]', { imagesMap });
assert.match(legacyFrameHtml, /note-image-card/, '历史 [SCREENSHOT] 缓存语法必须继续兼容');
const nearestFrameHtml = BSE.Formatters.renderNoteToHtml('![附近画面](frame://01:15)', {
  imagesMap: {
    early: { dataUrl: 'data:image/webp;base64,EARLY_60', timestamp: 60 },
    later: { dataUrl: 'data:image/webp;base64,LATER_80', timestamp: 80 }
  }
});
assert.match(nearestFrameHtml, /LATER_80/, 'frame 引用缺少精确键时必须选择时间最近的真实图片，而不是对象遍历遇到的第一张');
assert.doesNotMatch(nearestFrameHtml, /EARLY_60/);
assert.match(nearestFrameHtml, /data-seek="80"/, '附近帧兜底后跳转按钮必须指向真实截图秒数，而不是继续显示语义槽位时间');
assert.match(nearestFrameHtml, /data-ref-seek="75"/, '删除按钮必须同时保留原 frame 引用秒数，供删除/导出与渲染共享解析语义');
const nearestResolved = BSE.Formatters.resolveFrameEntry({
  early: { dataUrl: 'data:image/webp;base64,EARLY_60', timestamp: 60 },
  later: { dataUrl: 'data:image/webp;base64,LATER_80', timestamp: 80 }
}, { seconds: 75, timeStr: '01:15' });
assert.equal(nearestResolved?.frame?.timestamp, 80, '共享 frame 解析 seam 应返回最近真实截图');

// 8b-1. AI / 外部导入 Markdown 必须在进入 innerHTML 前保持安全：表格内容不可反转义成真实标签，图片 URL 只允许安全协议。
const hostileTableHtml = BSE.Formatters.renderNoteToHtml(`| 项目 | 内容 |\n| --- | --- |\n| 注入 | <img src=x onerror=alert(1)> |`);
assert.doesNotMatch(hostileTableHtml, /<img\s+src=x\s+onerror=/i, '表格单元格中的原始 HTML 不应被反转义为真实标签');
assert.match(hostileTableHtml, /&lt;img src=x onerror=alert\(1\)&gt;/i, '表格单元格中的 HTML 应保持为转义文本');

const hostileMarkdownImageHtml = BSE.Formatters.renderNoteToHtml('![危险图片](javascript:alert(1))');
assert.doesNotMatch(hostileMarkdownImageHtml, /<img\b/i, 'javascript: Markdown 图片 URL 不得生成 img 标签');
assert.doesNotMatch(hostileMarkdownImageHtml, /javascript:/i, '不安全图片协议不应进入最终 HTML');
const safeLinkHtml = BSE.Formatters.renderNoteToHtml('[Milvus 文档](https://milvus.io/docs)');
assert.match(safeLinkHtml, /<a class="note-link" href="https:\/\/milvus\.io\/docs" target="_blank" rel="noopener noreferrer">Milvus 文档<\/a>/, '普通 Markdown 链接应渲染为安全可读的外部链接');
const hostileLinkHtml = BSE.Formatters.renderNoteToHtml('[危险链接](javascript:alert(1))');
assert.doesNotMatch(hostileLinkHtml, /href="javascript:/i, '外部 AI Markdown 中的 javascript: 链接必须被拒绝');
assert.doesNotMatch(hostileLinkHtml, /<a\b/i, '不安全协议不得生成可点击链接');

const hostileScreenshotHtml = BSE.Formatters.renderNoteToHtml('[SCREENSHOT: 00:05 "<script>alert(1)</script>"]', {
  imagesMap: {
    '00:05': { dataUrl: 'data:image/webp;base64,SAFE', timestamp: 5, label: 'safe' }
  }
});
assert.doesNotMatch(hostileScreenshotHtml, /<script>/i, '截图说明中的 HTML 标签不得进入最终 DOM');
assert.match(hostileScreenshotHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/i, '截图说明应作为纯文本渲染');

// 8c. 视觉状态检测器 (VisualStateDetector) 单元测试
const optimalSec = BSE.VisualDetector.pickOptimalTimestamp({
  windowStart: 70,
  windowEnd: 95,
  targetSec: 85
});
assert.ok(optimalSec >= 70 && optimalSec <= 95, '代表帧秒数必须落在候选窗口内部');

const resolvedTimestamps = BSE.VisualDetector.resolveRequestTimestamps([
  { id: 'VR_1', windowStart: 60, windowEnd: 90, evidenceGoal: '板书结构' }
]);
assert.strictEqual(resolvedTimestamps[0].id, 'VR_1');
assert.ok(Number.isFinite(resolvedTimestamps[0].optimalSec));

const visualCandidates = BSE.VisualDetector.buildCandidateTimestamps({ windowStart: 60, windowEnd: 90, targetSec: 75 }, 210, 3);
assert.equal(visualCandidates.length, 3, '视觉检测器应只在 AI 目标附近生成少量候选秒数');
assert.ok(visualCandidates.every((sec) => sec >= 60 && sec <= 90), '候选秒数不得越出规划窗口');
const spatialSignatureA = Array.from({ length: 64 * 36 }, (_, index) => (index % 18 < 9 ? 255 : 0));
const spatialSignatureB = Array.from({ length: 64 * 36 }, (_, index) => (index % 18 >= 9 ? 255 : 0));
const compactSpatialA = Array.from(BSE.VisualDetector.compactSignature(spatialSignatureA, 128));
const compactSpatialB = Array.from(BSE.VisualDetector.compactSignature(spatialSignatureB, 128));
assert.equal(compactSpatialA.length, 128, '视觉 fingerprint 应保持轻量的固定维度');
assert.notDeepEqual(compactSpatialA, compactSpatialB, 'fingerprint 必须保留二维空间结构，不能只靠一维区间均值把不同版式压成同一签名');
const stableSignature = [40, 220, 40, 220];
const selectedVisualCandidate = BSE.VisualDetector.selectBestCandidate([
  { timestamp: 73, signature: [20, 20, 20, 20], brightness: 0.08, detail: 0.01 },
  { timestamp: 75, signature: stableSignature, brightness: 0.5, detail: 0.18 },
  { timestamp: 77, signature: stableSignature, brightness: 0.5, detail: 0.18 }
]);
assert.equal(selectedVisualCandidate?.timestamp, 77, '同样稳定且信息量充足时应轻微偏向较晚的完整画面');
const evidenceShortlist = BSE.VisualDetector.selectEvidenceFrames([
  { dataUrl: 'data:image/webp;base64,MANUAL', timestamp: 75, timeStr: '01:15', source: 'manual', selection: { strategy: 'visual', sampledTimestamps: [74, 75, 76], selectedTimestamp: 75, visualScore: 0.8, stabilityScore: 0.8, fingerprint: [100, 100, 100, 100] } },
  { dataUrl: 'data:image/webp;base64,DUP', timestamp: 75.5, timeStr: '01:16', source: 'planned', selection: { strategy: 'visual', sampledTimestamps: [75, 76, 77], selectedTimestamp: 75.5, visualScore: 0.95, stabilityScore: 0.95, fingerprint: [100, 100, 100, 100] } },
  { dataUrl: 'data:image/webp;base64,LATER', timestamp: 180, timeStr: '03:00', source: 'planned', importance: 'high', selection: { strategy: 'visual', sampledTimestamps: [179, 180, 181], selectedTimestamp: 180, visualScore: 0.85, stabilityScore: 0.85, fingerprint: [20, 220, 20, 220] } }
], { videoDuration: 600, maxFrames: 2 });
assert.equal(evidenceShortlist.length, 2, '全局证据筛选应在预算内保留高价值画面');
assert.ok(evidenceShortlist.some((frame) => frame.source === 'manual'), '用户手动截图必须优先保留');
assert.ok(evidenceShortlist.some((frame) => frame.timestamp === 180), '与手动画面不同的信息应保留以维持内容覆盖');
const chapterCoverageShortlist = BSE.VisualDetector.selectEvidenceFrames([
  { dataUrl: 'data:image/webp;base64,C1A', timestamp: 0, chapterId: 'C01', source: 'planned', selection: { strategy: 'visual', visualScore: 0.92, stabilityScore: 0.9 } },
  { dataUrl: 'data:image/webp;base64,C1B', timestamp: 10, chapterId: 'C01', source: 'planned', selection: { strategy: 'visual', visualScore: 0.88, stabilityScore: 0.88 } },
  { dataUrl: 'data:image/webp;base64,C2A', timestamp: 20, chapterId: 'C02', source: 'planned', selection: { strategy: 'visual', visualScore: 0.84, stabilityScore: 0.84 } }
], { videoDuration: 120, maxFrames: 2 });
assert.equal(chapterCoverageShortlist.length, 2);
assert.ok(chapterCoverageShortlist.some((frame) => frame.chapterId === 'C01'));
assert.ok(chapterCoverageShortlist.some((frame) => frame.chapterId === 'C02'), '证据预算收紧时，chapterId 应在质量接近的候选间提供轻量章节覆盖，而不是把两张都留在同一章');
const nonAdjacentDuplicateShortlist = BSE.VisualDetector.selectEvidenceFrames([
  { dataUrl: 'data:image/webp;base64,A', timestamp: 0, source: 'planned', selection: { visualScore: 0.6, stabilityScore: 0.7, fingerprint: [100, 100, 100, 100] } },
  { dataUrl: 'data:image/webp;base64,B', timestamp: 10, source: 'planned', selection: { visualScore: 0.7, stabilityScore: 0.7, fingerprint: [0, 255, 0, 255] } },
  { dataUrl: 'data:image/webp;base64,C', timestamp: 20, source: 'planned', selection: { visualScore: 0.9, stabilityScore: 0.9, fingerprint: [100, 100, 100, 100] } }
], { videoDuration: 60, maxFrames: 6 });
assert.equal(nonAdjacentDuplicateShortlist.length, 2, '全局去重不能只比较相邻帧；短暂插入另一画面后回到同一内容也应合并');
assert.ok(nonAdjacentDuplicateShortlist.some((frame) => frame.timestamp === 20), '重复自动帧应保留质量更高的代表帧');
const presentationFrames = BSE.VisualDetector.selectPresentationFrames([
  ...Array.from({ length: 7 }, (_, index) => ({
    dataUrl: `data:image/webp;base64,PRESENT_${index}`,
    timestamp: index * 60,
    timeStr: `0${index}:00`,
    source: 'manual'
  }))
], { maxFrames: 4, videoDuration: 360 });
assert.equal(presentationFrames.length, 4, '复制拼图必须严格限制画面数，即使用户手动截图超过预算也不能重新生成超长图');
assert.equal(presentationFrames[0].timestamp, 0, '精选拼图应保留时间轴开头覆盖');
assert.equal(presentationFrames.at(-1).timestamp, 360, '精选拼图应保留时间轴末尾覆盖');
const presentationHardLimit = BSE.VisualDetector.selectPresentationFrames(Array.from({ length: 8 }, (_, index) => ({
  dataUrl: `data:image/webp;base64,HARD_LIMIT_${index}`,
  timestamp: index * 30,
  source: 'manual'
})), { maxFrames: 6, videoDuration: 240 });
assert.equal(presentationHardLimit.length, 4, '精选拼图的 4 张上限必须是接口不变量，而不是调用方自觉传参');
assert.ok(BSE.VisualDetector.evidenceBudgetForDuration(3600) > BSE.VisualDetector.evidenceBudgetForDuration(600), '长视频应获得更大的动态证据预算');

// 8d. 两阶段视觉证据规划与 AI 模型配置契约
const originalMockFetch = mockFetch;

// 8d-0: Learn / Review share one connection but persist independent model choices.
const workspaceAiSettings = await BSE.Ai.saveAiSettings({
  endpoint: 'http://localhost:8083/v1',
  apiKey: '',
  learnModel: '  vision-learn-model  ',
  reviewModel: ' fast-review-model '
});
assert.equal(workspaceAiSettings.learnModel, 'vision-learn-model', '学习模型应独立保存并去除首尾空白');
assert.equal(workspaceAiSettings.reviewModel, 'fast-review-model', '复习模型应独立保存并去除首尾空白');
const reloadedWorkspaceAiSettings = await BSE.Ai.getAiSettings();
assert.equal(reloadedWorkspaceAiSettings.endpoint, 'http://localhost:8083/v1', '学习与复习必须共享同一个连接端点');
assert.equal(reloadedWorkspaceAiSettings.learnModel, 'vision-learn-model');
assert.equal(reloadedWorkspaceAiSettings.reviewModel, 'fast-review-model');
assert.ok(reloadedWorkspaceAiSettings.model, '旧版通用模型字段必须保留，供字幕精修等非学习/复习能力兼容使用');
assert.equal(BSE.Ai.resolveAiModel(reloadedWorkspaceAiSettings, 'learn'), 'vision-learn-model', '学习模型路由必须由 AI 核心统一解析');
assert.equal(BSE.Ai.resolveAiModel(reloadedWorkspaceAiSettings, 'review'), 'fast-review-model', '复习模型路由必须由 AI 核心统一解析');

// Old settings only had one `model`. Read-time normalization must inherit it
// into both workspaces without mutating storage or silently resetting the user.
storageAreas.local.set('bse_ai_settings_v1', {
  endpoint: 'http://localhost:8083/v1',
  apiKey: '',
  model: 'legacy-single-model',
  timeoutMs: 120000
});
const migratedLegacyAiSettings = await BSE.Ai.getAiSettings();
assert.equal(migratedLegacyAiSettings.learnModel, 'legacy-single-model', '旧单模型设置应自动成为学习模型');
assert.equal(migratedLegacyAiSettings.reviewModel, 'legacy-single-model', '旧单模型设置应自动成为复习模型');
await BSE.Ai.saveAiSettings(workspaceAiSettings);

let scopedModelBody = null;
mockFetch = async (_url, options = {}) => {
  scopedModelBody = JSON.parse(options.body || '{}');
  return {
    ok: true,
    status: 200,
    json: async () => ({ model: scopedModelBody.model, choices: [{ message: { content: 'ok' } }] }),
    text: async () => JSON.stringify({ model: scopedModelBody.model, choices: [{ message: { content: 'ok' } }] })
  };
};
await BSE.Ai.invokeLlm({ prompt: 'review route', scope: 'review' });
assert.equal(scopedModelBody.model, 'fast-review-model', '核心 LLM 调用的 review scope 必须使用复习模型');
await BSE.Ai.invokeLlm({ prompt: 'learn route', scope: 'learn' });
assert.equal(scopedModelBody.model, 'vision-learn-model', '核心 LLM 调用的 learn scope 必须使用学习模型');

// 8d-1: 服务目录探测只描述可见模型，不得擅自把用户选择切换成“推荐模型”。
mockFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
  text: async () => JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
});
const catalogProbe = await BSE.Ai.probeLlm('http://localhost:8083/v1', 'test-key', 'model-b');
assert.equal(catalogProbe.available, true, '模型目录可读时服务探测应成功');
assert.equal(catalogProbe.model, 'model-b', '服务探测必须保留用户请求的模型，而不是自动切换模型');
assert.equal(catalogProbe.modelAvailable, true, '请求模型存在于模型目录时应明确标记可见');

const missingCatalogModelProbe = await BSE.Ai.probeLlm('http://localhost:8083/v1', 'test-key', 'custom-model');
assert.equal(missingCatalogModelProbe.model, 'custom-model', '目录中未出现自定义模型时也不得篡改用户输入');
assert.equal(missingCatalogModelProbe.modelAvailable, false, '目录缺少用户模型时应给出目录层面的提示');

const remoteEndpointProbe = await BSE.Ai.probeLlm('https://api.example.com/v1', 'test-key', 'model-a');
assert.equal(remoteEndpointProbe.available, false, '当前 Manifest 未授权任意云端域名时不应假装远端直连可用');
assert.match(remoteEndpointProbe.error || '', /localhost|127\.0\.0\.1/, '远端端点错误应明确提示使用本地网关，而不是只报模糊网络失败');

// 8d-2: “测试当前模型”必须真实调用用户填写的模型，并把服务实际返回的模型原样反馈。
let testedModelBody = null;
let testedAuthHeader = 'unset';
mockFetch = async (_url, options = {}) => {
  testedModelBody = JSON.parse(options.body || '{}');
  testedAuthHeader = options.headers?.Authorization;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'provider-routed-model',
      choices: [{ message: { content: 'SparkSub OK' } }]
    }),
    text: async () => JSON.stringify({
      model: 'provider-routed-model',
      choices: [{ message: { content: 'SparkSub OK' } }]
    })
  };
};
const modelTest = await BSE.Ai.testLlm('http://localhost:8083/v1', '', 'requested-model');
assert.equal(testedModelBody.model, 'requested-model', '模型实测请求体必须使用用户当前填写的模型');
assert.equal(testedAuthHeader, undefined, '显式空 API Key 不得偷偷回退到旧的已保存凭证');
assert.equal(modelTest.available, true);
assert.equal(modelTest.requestedModel, 'requested-model');
assert.equal(modelTest.returnedModel, 'provider-routed-model', '应向用户暴露服务实际返回/路由到的模型');
assert.equal(modelTest.responsePreview, 'SparkSub OK');
assert.ok(Number.isFinite(modelTest.latencyMs), '模型实测应返回可展示的调用延迟');

// 8d-3: Fallback 请求失败必须区分 request failure，杜绝把认证/网络失败伪装成“正常规划完成”。
mockFetch = async () => { throw new Error('network unavailable'); };
const fallbackPlan = await BSE.Ai.planVisualEvidence({
  title: '高数课程',
  cues: sampleCues
});
assert.strictEqual(fallbackPlan.strategy, 'fallback', '无端点响应时应明确标记为 fallback');
assert.strictEqual(fallbackPlan.failureKind, 'request', '网络/模型调用失败必须标记为 request failure');
assert.ok(Array.isArray(fallbackPlan.visualEvidence), 'fallback 应返回 visualEvidence 数组');
assert.strictEqual(fallbackPlan.visualEvidence.length, 0, '未成功连接大模型时不应生成机械造假的截帧需求');

// 8d-4: 模型有返回但规划 JSON 格式异常时，单独标记 parse fallback，允许上层降级为字幕 + 手动画面合成。
mockFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'not valid planning json' } }] }),
  text: async () => JSON.stringify({ choices: [{ message: { content: 'not valid planning json' } }] })
});
const parseFallbackPlan = await BSE.Ai.planVisualEvidence({
  title: '高数课程',
  cues: sampleCues,
  endpoint: 'http://localhost:8083/v1',
  apiKey: 'test_key',
  model: 'model-a'
});
assert.strictEqual(parseFallbackPlan.strategy, 'fallback');
assert.strictEqual(parseFallbackPlan.failureKind, 'parse', '成功调用但规划 JSON 无法解析时应标记为 parse fallback');

// 8d-5: LLM 成功路径模拟测试（新文本规划协议输出 samplingWindows，内部再归一到媒体执行请求）
mockFetch = async (url) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          summary: '高等数学中值定理的几何本质与应用',
          chapters: [
            { id: 'C01', title: '几何意义与割线切线关系', timeStr: '00:00', windowStart: 0, windowEnd: 120, coreConcept: '导数斜率' }
          ],
          samplingWindows: [
            {
              id: 'SW_1',
              chapterId: 'C01',
              windowStart: 60,
              windowEnd: 90,
              targetSec: 75,
              contentHint: 'diagram',
              samplingGoal: '补充切线与割线几何关系',
              reason: '字幕提到几何关系但没有完整展开图形信息'
            }
          ]
        })
      }
    }]
  }),
  json: async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          summary: '高等数学中值定理的几何本质与应用',
          chapters: [
            { id: 'C01', title: '几何意义与割线切线关系', timeStr: '00:00', windowStart: 0, windowEnd: 120, coreConcept: '导数斜率' }
          ],
          samplingWindows: [
            {
              id: 'SW_1',
              chapterId: 'C01',
              windowStart: 60,
              windowEnd: 90,
              targetSec: 75,
              contentHint: 'diagram',
              samplingGoal: '补充切线与割线几何关系',
              reason: '字幕提到几何关系但没有完整展开图形信息'
            }
          ]
        })
      }
    }]
  })
});

const llmPlan = await BSE.Ai.planVisualEvidence({
  title: '高数课程',
  cues: sampleCues,
  endpoint: 'http://localhost:8083/v1',
  apiKey: 'test_key'
});
assert.strictEqual(llmPlan.strategy, 'llm', 'LLM 成功响应时 strategy 必须为 llm');
assert.strictEqual(llmPlan.chapters.length, 1);
assert.strictEqual(llmPlan.chapters[0].id, 'C01');
assert.strictEqual(llmPlan.chapters[0].windowStart, 0);
assert.strictEqual(llmPlan.chapters[0].windowEnd, 120);
assert.equal(llmPlan.chapters[0].timeStr, undefined, '章节时间显示应由数值范围派生，阶段一不应同时维护冗余 timeStr 状态');
assert.strictEqual(llmPlan.visualRequests.length, 1);
assert.strictEqual(llmPlan.visualRequests[0].id, 'SW_1');
assert.strictEqual(llmPlan.visualRequests[0].expectedSurface, 'diagram', '新 samplingWindows.contentHint 应归一到内部媒体执行字段');
assert.strictEqual(llmPlan.visualRequests[0].evidenceGoal, '补充切线与割线几何关系', '新 samplingGoal 应归一到内部 evidenceGoal');
assert.strictEqual(llmPlan.visualEvidence.length, 1);
mockFetch = originalMockFetch;

// 8d-1b: 外部 AI 协作提示词与 JSON 提取器单测
const standalonePrompt = BSE.Ai.buildPlanningPrompt({
  title: '高数课程',
  author: '名师',
  cues: sampleCues,
  manualFrames: [{ timestamp: 30, timeStr: '00:30', label: '重要例题' }]
});
assert.match(standalonePrompt, /用户已标记的时间点/, '规划提示词必须自然说明用户手动锚点');
assert.match(standalonePrompt, /第一阶段[\s\S]+章节骨架[\s\S]+时间窗口/, '规划阶段必须明确只负责章节骨架与播放器取样窗口');
assert.match(standalonePrompt, /作品\/文献\/场景|软件界面|公式\/板书/, '取样规划必须覆盖不同类型的强视觉内容，而不只面向数学板书');
assert.match(standalonePrompt, /"samplingWindows"/, '新规划协议应使用 samplingWindows，而不是要求文本模型执行媒体操作');
assert.doesNotMatch(standalonePrompt, /"timeStr"\s*:/, '章节范围只维护数值 windowStart/windowEnd，规划 JSON 不应再保存冗余 timeStr 字段');
assert.doesNotMatch(standalonePrompt, /"visualRequests"|"visualEvidence"|值得查看画面|筛选截图|重要视觉信息|视觉检查需求/, '文本规划提示词不应使用容易让模型误判为直接媒体操作的协议词');
assert.match(standalonePrompt, /00:00  大家好/, '规划字幕使用清晰的时间列，不再使用方括号时间标签');
assert.doesNotMatch(standalonePrompt, /\[Task Nature|\[Guidelines for Visual|passive data|not system instructions/i, '规划提示词不应堆叠伪系统元指令');

const noisyLlmResponse = `
<think>正在思考章节划分...</think>
这里是您需要的规划结果：
\`\`\`json
{
  "summary": "微积分中值定理与导数应用",
  "chapters": [{"id": "C01", "title": "定理引入"}],
  "visualRequests": [{"id": "VR_1", "targetSec": 45, "reason": "几何切线"}]
}
\`\`\`
希望对您的学习有帮助！`;
const extracted = BSE.Ai.extractJsonFromText(noisyLlmResponse);
assert.ok(extracted, '必须成功从带思考标签和包裹文本中提取合法 JSON');
assert.strictEqual(extracted.summary, '微积分中值定理与导数应用');
assert.strictEqual(extracted.visualRequests.length, 1);
const normalizedChapters = BSE.Ai.normalizePlanChapters({
  chapters: [null, { id: 'C02', title: '应用边界', startSec: '120', endSec: '240', coreIdea: '何时不能直接套定理' }]
});
assert.equal(normalizedChapters.length, 1, '章节协议 seam 应忽略无效章节项');
assert.equal(normalizedChapters[0].id, 'C02');
assert.equal(normalizedChapters[0].title, '应用边界');
assert.equal(normalizedChapters[0].windowStart, 120);
assert.equal(normalizedChapters[0].windowEnd, 240);
assert.equal(normalizedChapters[0].coreConcept, '何时不能直接套定理', '章节协议 seam 应吸收旧别名并只保留第二阶段真正需要的稳定字段');
const normalizedSampling = BSE.Ai.normalizeSamplingWindows({
  samplingWindows: [null, { windowStart: '60', windowEnd: '90', targetSec: '75', samplingGoal: '核对图形关系', contentHint: 'diagram' }]
});
assert.equal(normalizedSampling.length, 1, '规划兼容层应忽略 null 等无效窗口，而不是让单个坏项击穿整个规划流程');
assert.equal(normalizedSampling[0].targetSec, 75, '外部 AI 常见的数字字符串应在协议 seam 归一为有限数值');
assert.equal(normalizedSampling[0].windowStart, 60);
assert.equal(normalizedSampling[0].windowEnd, 90);
const legacySamplingWindows = BSE.Ai.normalizeSamplingWindows(extracted);
assert.strictEqual(legacySamplingWindows.length, 1, '旧 visualRequests 返回仍应兼容');
assert.strictEqual(legacySamplingWindows[0].id, 'VR_1');

// 8d-2: Prompt 严谨性测试 (区分有图与无图)
const pureTextKeypointsPrompt = BSE.Ai.buildCourseNotePrompt({
  title: contextPack.title,
  cues: sampleCues,
  mediaContext: contextPack,
  mode: 'keypoints'
});
assert.match(pureTextKeypointsPrompt, /标签：计算机、考研、408、CRC、计算机网络/, '纯文本学习任务必须真正带入 MediaContext 标签');
assert.doesNotMatch(pureTextKeypointsPrompt, /真题详解-27考研|作者：/, '纯文本学习任务不应导出作者名');
assert.doesNotMatch(pureTextKeypointsPrompt, /00:00\s+大家好/, '纯文本学习/复习任务不需要时间定位时不得携带逐句时间戳');
const pureTextReviewPrompt = BSE.Ai.buildCourseNotePrompt({ title: contextPack.title, cues: sampleCues, mediaContext: contextPack, mode: 'deep_qa' });
assert.doesNotMatch(pureTextReviewPrompt, /\[MM:SS\]|00:00\s+大家好/, '自测任务既不应要求模型生成时间，也不应为字幕附加时间戳');

const promptWithImages = BSE.Ai.buildCourseNotePrompt({
  title: '高数课程',
  cues: sampleCues,
  mediaContext: contextPack,
  capturedFrames: [
    { timestamp: 75, timeStr: '01:15', label: '几何切线板书', evidenceGoal: '补充切线与割线的图形关系', chapterId: 'C01', expectedSurface: 'diagram', dataUrl: 'data:image/webp;base64,AAA' }
  ],
  videoIR: {
    summary: '从几何斜率直观进入中值定理',
    chapters: [{ id: 'C01', title: '中值定理引论', windowStart: 0, windowEnd: 120, coreConcept: '斜率连续性' }]
  },
  mode: 'course_notes'
});
assert.match(promptWithImages, /### 已筛选画面/, '多模态提示词必须清楚列出真正进入第二阶段的画面证据');
assert.match(promptWithImages, /frame:\/\/MM:SS/, '报告图片引用应使用自然 Markdown frame:// 占位语法');
assert.match(promptWithImages, /看不清的文字、公式、图例或细节不要猜测/, '画面信息不清晰时应自然要求模型不要猜测');
assert.match(promptWithImages, /C01 · diagram/, '截图的 chapterId 与视觉类型必须一路进入第二阶段，避免图片脱离所属章节');
assert.match(promptWithImages, /整体主线：从几何斜率直观进入中值定理/, '阶段一 summary 必须服务第二阶段导读，而不是生成后被丢弃');
assert.match(promptWithImages, /### 已按阶段一章节分组的字幕/, '第二阶段不应重新从平铺字幕判断章节归属');
assert.match(promptWithImages, /#### C01 字幕/, '阶段一时间范围必须用于确定性地给第二阶段分组字幕，分组结果只需保留稳定 chapterId 避免重复标题元数据');
assert.match(promptWithImages, /### 阶段一已经确定的章节骨架/, '多模态提示词必须把 Phase 1 章节结果当作第二阶段写作骨架');
assert.match(promptWithImages, /\`## \[00:00–02:00\] 中值定理引论\`/, '阶段二必须把章节开始和结束时间直接固化为可渲染的 Markdown 大标题契约');
assert.match(promptWithImages, /不要重新切章/, '第二阶段不得重复执行第一阶段已经完成的章节规划');
assert.match(promptWithImages, /人文、历史、社会科学/, '最终报告应根据学科类型自适应组织，而不是固定数学模板');
assert.match(promptWithImages, /00:00  大家好/, '最终报告字幕应使用自然时间列');
assert.doesNotMatch(promptWithImages, /\[Language & Output Format|\[Mathematical Formula|passive text data|not system instructions/i, '最终报告提示词不应堆叠伪系统级元指令');

const promptWithoutImages = BSE.Ai.buildCourseNotePrompt({
  title: '高数课程',
  cues: sampleCues,
  mediaContext: contextPack,
  capturedFrames: [],
  mode: 'course_notes'
});
assert.match(promptWithoutImages, /本次没有可用截图/, '没有真实图片时应自然说明当前为纯文本整理');
assert.doesNotMatch(promptWithoutImages, /### 可用画面/, '无图片时不应伪造已上传的画面清单');
assert.doesNotMatch(promptWithoutImages, /00:00\s+大家好/, '没有画面映射需求时，图文讲义的纯文本降级也不应浪费 token 携带时间戳');

BSE.NativeHost = originalNativeHost;
console.log('✅ 单元测试全部通过：JSZip 打包、AI 提示词生成、合集/多P Merged Markdown、自然段落切分、逐P独立勾选架构、多行自适应配置、TypeScript 渐进式类型体系、批量导出容灾与容错降级机制、B站 DASH 独立音频直链提取、BPX 播放器选集 DOM 探测与全场景活动页支持、UP主/合集订阅追踪系统 (MD5/WBI/RSS XML/Alarms/Storage/ImportExport)、后台无人值守字幕抓取与一键 Markdown 字幕、本地 ASR 回退、受限媒体描述符与进度租约、端侧大模型 ASR 吞音语义纠错与时间轴回填、跨视频媒体一致性与时长防错互锁 (Anti-Media-Mismatch Guard)、标签页直取字幕状态机与前台 Feed 按钮多端同步、通道 A 高清视频截帧与时间轴自动恢复机制、AI 课程图文 Video Understanding IR 规划、视觉状态检测器 (VisualStateDetector)、GFM Markdown 表格与代码块排版、KaTeX 完整数学公式渲染与多模态交互工作台。');
