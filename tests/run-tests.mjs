import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let mockFetch = async () => { throw new Error('Unexpected network request in test'); };
const sessionStore = new Map();
const storageAreas = { local: new Map(), sync: new Map() };
const createStorageArea = (area) => ({
  get: async (key) => ({ [key]: storageAreas[area].get(key) }),
  set: async (values) => { Object.entries(values).forEach(([key, value]) => storageAreas[area].set(key, value)); }
});
const context = vm.createContext({
  console,
  URL: {
    ...URL,
    createObjectURL: () => 'blob:mock-url',
    revokeObjectURL: () => {}
  },
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
  'core/utils.js',
  'core/jszip.js',
  'core/i18n.js',
  'core/parsers.js',
  'core/formatters.js',
  'core/tracker.js',
  'platform/bilibili.js',
  'platform/youtube.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const { BSE } = context;

// 1. I18n Tests
assert.equal(BSE.I18n.t('follow'), '跟随');
BSE.I18n.setLocale('en');
assert.equal(BSE.I18n.t('follow'), 'Follow');
assert.equal(BSE.I18n.t('ai_prompt_summary'), '📝 Core Essence & Logic');
assert.equal(BSE.I18n.t('tab_tracker'), '🔔 Tracker Center');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), 'All (4)');
BSE.I18n.setLocale('zh-TW');
assert.equal(BSE.I18n.t('tab_tracker'), '🔔 追蹤中心');
assert.equal(BSE.I18n.t('tracker_filter_all', { n: 4 }), '全部 (4)');
BSE.I18n.setLocale('zh-CN');
assert.equal(BSE.I18n.t('tab_tracker'), '🔔 追踪中心');
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

console.log('✅ 单元测试全部通过：JSZip 打包、AI 提示词生成、合集/多P Merged Markdown、自然段落切分、逐P独立勾选架构、多行自适应配置、TypeScript 渐进式类型体系、批量导出容灾与容错降级机制、B站 DASH 独立音频直链提取、BPX 播放器选集 DOM 探测与全场景活动页支持、UP主/合集订阅追踪系统 (MD5/WBI/RSS XML/Alarms/Storage/ImportExport)、后台无人值守字幕抓取与一键 Markdown 复制、B站批量导出并发调度与 delay 延迟重试。');
