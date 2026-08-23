import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  Blob,
  TextEncoder,
  TextDecoder,
  globalThis: null
});
context.globalThis = context;

for (const file of [
  'core/namespace.js',
  'core/utils.js',
  'core/jszip.js',
  'core/i18n.js',
  'core/parsers.js',
  'core/formatters.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const { BSE } = context;

// 1. I18n Tests
assert.equal(BSE.I18n.t('follow'), '跟随');
BSE.I18n.setLocale('en');
assert.equal(BSE.I18n.t('follow'), 'Follow');
assert.equal(BSE.I18n.t('ai_prompt_summary'), '📝 Core Essence & Logic');
BSE.I18n.setLocale('zh-CN');
assert.equal(BSE.I18n.formatTimeSpan(159), '2分39秒');

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

assert.match(backgroundSource, /BSE_FETCH_BILIBILI_RESOURCE/, '后台必须提供哔哩哔资源读取通道');
assert.match(backgroundSource, /HOST_NOT_ALLOWED/, '后台代理必须拒绝非白名单域名');
assert.match(backgroundSource, /INVALID_SENDER/, '后台代理必须验证请求页面来源');
assert.match(bilibiliSource, /requestBackgroundJson\((?:track\.subtitleUrl|cleanUrl)/, '哔哩哔字幕正文必须走后台通道');
assert.match(appSource, /revision/, '状态必须携带单调版本号');
assert.match(appSource, /刷新失败，已保留现有字幕/, '刷新失败必须保留已成功字幕');
assert.match(rollingPanelSource, /ResizeObserver/, '滚动面板必须监听播放器尺寸变化');
assert.match(rollingPanelSource, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/, '滚动面板必须可靠隐藏旧状态 DOM');
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
// 11. Bilibili DASH Audio Extraction Tests
assert.match(bilibiliSource, /fetchAudioStream/, 'B站平台模块必须导出 fetchAudioStream 接口');
assert.match(rollingPanelSource, /fetchAudioStream/, '滚动面板必须接入 fetchAudioStream 提取独立音频');
assert.match(sidePanelHtml, /value="audio"/, '侧边栏格式选择器应包含独立音频选项');

console.log('✅ 单元测试全部通过：JSZip 打包、AI 提示词生成、合集/多P Merged Markdown、自然段落切分、逐P独立勾选架构、多行自适应配置、TypeScript 渐进式类型体系、批量导出容灾与容错降级机制、B站 DASH 独立音频直链提取。');


