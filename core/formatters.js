(() => {
  'use strict';

  const BSE = globalThis.BSE = globalThis.BSE || {};
  const formatClock = (seconds) => (BSE.Utils?.formatClock ? BSE.Utils.formatClock(seconds) : `${seconds}`);

  /**
   * 将字幕行合并为自然段落文本
   * @param {Array<import('../types/bse').Cue>} cues
   * @returns {string}
   */
  function mergeParagraphs(cues) {
    const paragraphs = [];
    let current = [];
    let length = 0;
    for (const cue of cues || []) {
      const text = String(cue.content || '').trim();
      if (!text) continue;
      current.push(text);
      length += text.length;
      if ((/[。！？!?；;]$/.test(text) && length >= 80) || length >= 200) {
        paragraphs.push(current.join(' '));
        current = [];
        length = 0;
      }
    }
    if (current.length) paragraphs.push(current.join(' '));
    return paragraphs.join('\n\n');
  }

  function srtTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const secs = Math.floor((total % 60000) / 1000);
    const ms = total % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /**
   * 导出为纯文本格式
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {boolean} [withTimestamp]
   * @returns {string}
   */
  function toTxt(cues, withTimestamp = false) {
    if (withTimestamp) return (cues || []).map((cue) => `[${formatClock(cue.from)}] ${cue.content}`).join('\n') + '\n';
    return `${mergeParagraphs(cues)}\n`;
  }

  /**
   * 导出为 SRT 格式
   * @param {Array<import('../types/bse').Cue>} cues
   * @returns {string}
   */
  function toSrt(cues) {
    return (cues || []).map((cue, index) => (
      `${index + 1}\n${srtTime(cue.from)} --> ${srtTime(cue.to)}\n${cue.content}`
    )).join('\n\n') + '\n';
  }

  const AI_PROMPTS = [
    {
      id: 'polish',
      icon: '✨',
      text: 'ASR 吞音与术语纠错',
      desc: '原声保真 > ASR 纠错 > 语法规范。保留自然口吻与交谈感，精准修正同音、吞音与专有名词',
      prompt: (meta = {}) => `你是一个专业的视频字幕校对与 ASR 纠错专家。当前视频标题为：《${meta?.title || '视频原片'}》。

【核心标准与优先级】：
原声保真 > ASR 纠错 > 可读性 > 语法规范。

字幕应当让观众产生：
“屏幕上的文字就是我刚刚听到的话”，而不是“有人把这段话重新写了一遍”。

【校对与纠错五大原则】：
1. 【同音/近音/吞音纠错】：精准修正明确的同音、近音、连读、弱读导致的识别错误（如 "starp" ➔ "startup"、"tra ined" ➔ "trained"、"to of results" ➔ "turn to the results" 等）；
2. 【专有名词与技术术语】：结合视频标题与上下文，准确识别并规范专有名词、人名、产品名与技术术语（如 Qwen, PyTorch, Codex, LoRA, Claude, GPT-5, BERT, Jacob Devlin 等）；
3. 【大小写与文本规范】：修正明显错误的英文大小写、术语拼写、不合理的词中空格与基础标点规范化；
4. 【仅在证据确凿时补词】：只有在现有上下文和发音证据足以表明 ASR 确实漏识别/吞掉词时（如失落的代词、介词或时态词尾 -ed/-s），才适度恢复漏掉的词，坚决不做主观扩写或脑补；
5. 【严格保留口语原声风味】：保留说话人的自然语气、措辞习惯、交谈感和实际语法，绝不将其粗暴重写或书面化阉割，确保字幕与原声视听高度吻合；
6. 【输出要求】：直接输出校对后的清晰自然字幕文本。

---
以下为原始字幕文本：`
    },
    {
      id: 'notes',
      icon: '🎯',
      text: '生成结构化深度讲义',
      desc: '去噪纠错、定理脉络、推导动机与避坑边界',
      prompt: `你的任务是将提供的视频转录稿，整理成一份结构严谨、逻辑清晰、适合中高阶学习、复盘或应试备考的高质量专业讲义。

【核心处理原则】：
1. 输出规范：直接输出高质量可排版 Markdown 文本，严禁输出 PPT 大纲、Word/Doc 模板等办公文档占位符；
2. 去噪与清洗：过滤讲者口误自纠、口头禅、闲聊冗余与机械性代数运算口述；保留关键变形、换元、构造动机与分类依据；
3. ASR 纠错与 LaTeX 严格排版规范：
   - 绝对值与模使用 \\lvert ... \\rvert (伸缩 \\left\\lvert ... \\right\\rvert)，禁止手打键盘竖线；
   - 范数使用 \\lVert ... \\rVert (伸缩 \\left\\lVert ... \\right\\rVert)，禁止手打 ||x||；
   - 条件符使用 \\mid (如 $P(A \\mid B)$、$\\{x \\in \\mathbb{R} \\mid x > 0\\}$)；
   - 正体微分算子使用 \\mathrm{d}x、偏导 \\partial；向量/矩阵使用粗斜体 \\boldsymbol{x}、\\boldsymbol{A} (严禁 \\pmb)；
   - 自然底数使用正体 \\mathrm{e}^x，函数名使用内置算子 \\lim、\\sin、\\cos、\\ln；不等号使用 \\le、\\ge；
4. 防幻觉与可信度分级：严禁编造原视频未给出的关键条件与数据；无法确认的信息标注 [原视频未明示/待补充]；
5. 注重方法动机：遇到关键推导、设参、定理应用或分类讨论时，必须说明“为什么这样做”；
6. 语言风格：专业、克制、自然，杜绝“秒杀/大招/闭眼套”等营销化夸张表达。

【讲义输出结构】：
# [视频主题 / 核心知识板块]

## 一、核心知识与定理/工具索引
- 提取并规范书写本讲涉及的核心概念、公式、定理或工具，注明适用条件与符号含义。

## 二、核心脉络与分步深度精讲
- 按知识板块或例题逻辑重构，分步拆解；
- 包含：明确目标 -> 关键设法/转化路径 -> 核心推导与关键变形（压缩常规计算，保留关键式） -> 结论总结。

## 三、避坑指南与边界说明
- 提取易错点、参数范围/定义域、判别式、临界条件、漏解风险、等号成立条件或特殊边界。

## 四、方法迁移与实战启发
- 本讲核心思想可迁移的类似场景或题型；
- 提炼 2~3 条具体、可转化为做题动作的实战启发。

---
以下为视频字幕内容：`
    },
    {
      id: 'summary',
      icon: '📝',
      text: '总结核心主旨与脉络',
      desc: '精准概括主线脉络、核心结论与关键注意点',
      prompt: `请将以下视频转录稿整理为一份高信息密度、逻辑严谨的核心内容摘要。

【处理原则】：
1. 过滤口语化冗余、口头禅与重复表达，纠正 ASR 同音识别错误；
2. 保持内容客观真实，严格基于视频内容，不臆造未经证实的事实；
3. 语言规范、简练、专业。

【输出结构】：
1. 💡 核心主旨：用 1~2 句话精准概括视频讨论的核心议题与核心结论；
2. 🧭 核心逻辑脉络：按论证/讲解主线，提炼 3~5 个关键阶段或论点；
3. 🔑 关键结论与价值：提炼视频输出的最重要成果、实用方法或核心洞见；
4. ⚠️ 核心注意点：视频中强调的关键前提、适用边界或易忽略事项。

---
以下为视频字幕内容：`
    },
    {
      id: 'keypoints',
      icon: '📋',
      text: '提炼关键要点与清单',
      desc: '提炼高密度要点、适用边界与实战动作清单',
      prompt: `请从以下视频转录稿中提炼出 5~10 条高信息密度的核心关键要点与实战操作清单。

【处理原则】：
1. 过滤口语噪点，纠正专业术语与符号表达（公式使用 LaTeX，代码使用代码块）；
2. 提取高信息密度的实质性内容，避免空泛套话；
3. 严格基于视频内容，不凭空捏造事实。

【输出结构】：
对于每一条关键要点，请按如下格式呈现：
- 📌 [要点名称 / 核心判断]：核心内容精炼阐述。
  - 核心依据 / 逻辑：背后的原理、推导或关键论据。
  - 适用条件 / 边界：在何种场景或前提下生效。
  - 实战落地动作：具体可执行的做题技巧或操作步骤。

---
以下为视频字幕内容：`
    },
    {
      id: 'questions',
      icon: '❓',
      text: '生成深度复盘与辨析题',
      desc: '生成概念辨析、推导动机与易错边界思考题',
      prompt: `请根据以下视频转录稿，设计 5 个具有深度、启发性与考查价值的复盘思考题。

【处理原则】：
1. 紧扣视频中的核心难点、易混淆概念、关键推导转折与边界条件；
2. 问题应促使学习者深度思考底层逻辑、方法迁移与易错陷阱，而非简单死记硬背；
3. 每个问题后附带简洁的【思考方向与复盘要点】。

【输出结构】：
- Q1 [概念辨析 / 原理溯源]：针对核心概念或定理的前提条件提出问题。
  - 💡 复盘要点：...
- Q2 [推导关键与动机探究]：针对关键步骤“为什么这么做 / 能否换一种做法”提问。
  - 💡 复盘要点：...
- Q3 [边界与易错陷阱]：针对极端情况、定义域、退化情形或常见错误提问。
  - 💡 复盘要点：...
- Q4 [变式与条件迁移]：若题设/场景发生某种变式，该方法如何调整。
  - 💡 复盘要点：...
- Q5 [实战综合应用]：结合真实做题或实践场景的综合运用提问。
  - 💡 复盘要点：...

---
以下为视频字幕内容：`
    }
  ];

  function generateAiPrompt(promptIdOrText, cues, withTimestamp = false, metadata = {}) {
    const preset = AI_PROMPTS.find(p => p.id === promptIdOrText);
    let promptHeader;
    if (preset) {
      promptHeader = typeof preset.prompt === 'function' ? preset.prompt(metadata) : preset.prompt;
    } else {
      promptHeader = promptIdOrText || (typeof AI_PROMPTS[0].prompt === 'function' ? AI_PROMPTS[0].prompt(metadata) : AI_PROMPTS[0].prompt);
    }
    const text = withTimestamp ? toTxt(cues, true) : mergeParagraphs(cues);
    return `${promptHeader}\n\n${text}`.trim();
  }

  /**
   * 导出为单视频 Markdown 格式
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {import('../types/bse').MetadataOptions} [metadata]
   * @param {import('../types/bse').FormatOptions} [options]
   * @returns {string}
   */
  function toMarkdown(cues, metadata = {}, options = {}) {
    const lines = [
      `# ${metadata.title || '字幕'}`,
      '',
      `> 平台：${metadata.platform || '未知'}`,
      `> 链接：${metadata.url || ''}`,
      `> 语言：${metadata.language || '未知'}`,
      `> 导出时间：${new Date().toLocaleString()}`,
      '',
      '---',
      ''
    ];
    if (options?.withTimestamp) {
      lines.push((cues || []).map((cue) => `- \`[${formatClock(cue.from)}]\` ${cue.content}`).join('\n'));
    } else {
      lines.push(mergeParagraphs(cues));
    }
    return lines.join('\n') + '\n';
  }

  /**
   * 导出为合并合集 Markdown 格式
   * @param {import('../types/bse').BilibiliTree} tree
   * @param {any} results
   * @param {any} [stats]
   * @param {import('../types/bse').FormatOptions} [options]
   * @returns {string}
   */
  function toMergedMarkdown(tree, results, stats = {}, { withTimestamp = false } = {}) {
    const resultsList = Array.isArray(results)
      ? results
      : (results && typeof results.values === 'function' ? Array.from(results.values()) : []);
    const validResults = resultsList.filter(Boolean);
    const lines = [
      `# ${tree.title || '字幕合集'}`,
      '',
      `> 来源：哔哩哔哩`,
      `> 导出时间：${new Date().toLocaleString()}`,
      `> 结果统计：共 ${stats.total || validResults.length} 集（成功 ${stats.success || 0}，无字幕 ${stats.noSub || 0}，失败 ${stats.failed || 0}）`,
      '',
      '[TOC]',
      ''
    ];

    let lastSection = null;
    for (const r of validResults) {
      if (r.item?.sectionKey !== lastSection) {
        lastSection = r.item?.sectionKey;
        lines.push(`## ${r.item?.sectionTitle || '全集'}`, '');
      }
      const epNum = String(r.item?.globalIndex || 1).padStart(3, '0');
      const cleanTitle = (r.item?.title || '').replace(/^\s*\d+\s*[.、:_-]\s*/, '').trim() || '未命名';
      lines.push(`### ${epNum}. ${cleanTitle}`);
      if (r.item?.sourceUrl) lines.push(`- 来源：[B站链接](${r.item.sourceUrl})`);

      if (r.status === 'success') {
        lines.push(`- 字幕类型：${r.track?.lan_doc || r.track?.lan || '中文'}`, '');
        if (withTimestamp) {
          for (const cue of (r.body || [])) {
            lines.push(`- \`[${formatClock(cue.from)}]\` ${cue.content}`);
          }
        } else {
          lines.push(mergeParagraphs(r.body));
        }
      } else if (r.status === 'no_subtitle') {
        lines.push('- 状态：`⚪ 本集未提供字幕（UP主未上传且未生成AI字幕）`', '');
      } else {
        lines.push(`- 状态：\`❌ 本集字幕抓取失败（${r.reason || '网络或接口异常'}）\``, '');
      }
      lines.push('', '---', '');
    }

    return lines.join('\n');
  }

  /**
   * 生成批量导出清单 Manifest
   * @param {import('../types/bse').BilibiliTree} tree
   * @param {Array<import('../types/bse').BilibiliItem>} selectedItems
   * @param {any} results
   * @param {any} [stats]
   * @param {any} [config]
   */
  function buildBatchManifest(tree, selectedItems, results, stats = {}, config = {}) {
    const resultsList = Array.isArray(results)
      ? results
      : (results && typeof results.values === 'function' ? Array.from(results.values()) : []);
    const byKey = new Map(resultsList.filter(Boolean).map(r => [`${r.item?.bvid}:${r.item?.cid}`, r]));
    return {
      schema: 'bse-batch-manifest-v1',
      generatedAt: new Date().toISOString(),
      collection: {
        title: tree.title,
        kind: tree.kind,
        seasonId: tree.seasonId,
        currentBvid: tree.currentBvid,
        totalItems: tree.items?.length || 0,
        selectedItems: selectedItems.length
      },
      config: {
        scope: config.scope,
        format: config.format,
        outputMode: config.outputMode,
        subtitlePreference: config.preference
      },
      stats,
      sections: (tree.sections || []).map(sec => ({ index: sec.index, title: sec.title, count: sec.items?.length || 0 })),
      items: (selectedItems || []).map(item => {
        const r = byKey.get(`${item.bvid}:${item.cid}`);
        return {
          index: item.globalIndex,
          section: item.sectionTitle,
          title: item.title,
          bvid: item.bvid,
          aid: item.aid,
          cid: item.cid,
          url: item.sourceUrl,
          status: r?.status || 'unknown',
          subtitle: r?.track ? { lan: r.track.lan, lan_doc: r.track.lan_doc, isAI: r.track.isAI } : null,
          reason: r?.reason || null
        };
      })
    };
  }

  /**
   * 将大模型生成的课程笔记 Markdown 安全渲染为富文本 HTML (含交互式时间轴与图片卡片)
   * @param {string} markdown
   * @param {object} [options]
   * @param {Map<string, {dataUrl: string, timestamp: number}>|object} [options.imagesMap]
   * @returns {string}
   */
  /**
   * 将大模型生成的课程笔记 Markdown 安全渲染为富文本 HTML (含 KaTeX 高清数学排版、交互式时间轴与图片卡片)
   * @param {string} markdown
   * @param {object} [options]
   * @param {Map<string, {dataUrl: string, timestamp: number}>|object} [options.imagesMap]
   * @returns {string}
   */
  /**
   * 将大模型生成的课程笔记 Markdown 安全渲染为富文本 HTML (含 KaTeX 高清数学排版、GFM 数据表格、多行代码块、交互式时间轴与图片卡片)
   * @param {string} markdown
   * @param {object} [options]
   * @param {Map<string, {dataUrl: string, timestamp: number}>|object} [options.imagesMap]
   * @returns {string}
   */
  function renderNoteToHtml(markdown, options = {}) {
    if (!markdown || typeof markdown !== 'string') return '';
    const imagesMap = options.imagesMap || {};

    // 0. 清理大模型可能输出的转义 \$ 为标准 LaTeX 符号 $
    let rawText = markdown.replace(/\\\$/g, '$');

    // 1. 提取并替换多行代码块 ```lang ... ``` 为占位符
    const codeBlocks = [];
    rawText = rawText.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const id = `___CODE_BLOCK_${codeBlocks.length}___`;
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const html = `<div class="note-code-wrap"><pre class="note-code-block"><code class="${lang ? `language-${lang}` : ''}">${escapedCode}</code></pre></div>`;
      codeBlocks.push(html);
      return `\n\n${id}\n\n`;
    });

    // 2. 辅助函数：通过 KaTeX 渲染公式或降级为纯文本公式
    function renderLatex(tex, isDisplay) {
      let cleanTex = tex.trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      
      // 修复 KaTeX 对未转义 % 的 commentAtEnd 警告/报错，将其规范化为 \%
      cleanTex = cleanTex.replace(/(^|[^\\])%/g, '$1\\%');

      if (typeof globalThis !== 'undefined' && globalThis.katex?.renderToString) {
        try {
          return globalThis.katex.renderToString(cleanTex, {
            displayMode: isDisplay,
            throwOnError: false,
            strict: 'ignore'
          });
        } catch {}
      }
      return isDisplay
        ? `<div class="math-block" data-math="${encodeURIComponent(cleanTex)}"><span class="math-tex">$$${cleanTex}$$</span></div>`
        : `<span class="math-inline" data-math="${encodeURIComponent(cleanTex)}">$${cleanTex}$</span>`;
    }

    // 3. 提取并替换独立块级公式 $$ ... $$ 为占位符
    const mathBlocks = [];
    rawText = rawText.replace(/\$\$([\s\S]*?)\$\$/g, (_match, eq) => {
      const id = `___MATH_BLOCK_${mathBlocks.length}___`;
      mathBlocks.push(renderLatex(eq, true));
      return `\n\n${id}\n\n`;
    });

    // 4. 提取并替换行内公式 $ ... $ 为占位符
    const mathInlines = [];
    rawText = rawText.replace(/\$([^\$\n\r]+?)\$/g, (_match, eq) => {
      const id = `___MATH_INLINE_${mathInlines.length}___`;
      mathInlines.push(renderLatex(eq, false));
      return id;
    });

    // 5. GFM Markdown 表格解析器
    const tableRegex = /((?:^|\n)\|[^\n]+\|\r?\n\|[ \t]*:?[-]+:?[ \t]*(?:\|[ \t]*:?[-]+:?[ \t]*)+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g;
    rawText = rawText.replace(tableRegex, (match) => {
      const lines = match.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return match;
      const headerLine = lines[0];
      const alignLine = lines[1];
      const bodyLines = lines.slice(2);

      const parseCells = (line) => {
        const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map(c => c.trim());
      };

      const headers = parseCells(headerLine);
      const aligns = parseCells(alignLine).map(a => {
        const left = a.startsWith(':');
        const right = a.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
      });

      const thead = '<thead><tr>' + headers.map((h, i) => `<th style="text-align:${aligns[i] || 'left'}">${h}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + bodyLines.map(rowLine => {
        const cells = parseCells(rowLine);
        return '<tr>' + cells.map((c, i) => `<td style="text-align:${aligns[i] || 'left'}">${c}</td>`).join('') + '</tr>';
      }).join('') + '</tbody>';

      return `\n\n<div class="note-table-wrap"><table class="note-table">${thead}${tbody}</table></div>\n\n`;
    });

    // 6. 转义基础 HTML 字符
    let html = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 7. 截图占位标签 [SCREENSHOT: MM:SS "说明"] 或 [SCREENSHOT: SS "说明"]
    html = html.replace(/\[SCREENSHOT:\s*([0-9:]+)(?:\s*["“]([^"”]+)["”])?\]/gi, (match, timeStr, desc) => {
      const parts = String(timeStr).split(':').map(Number);
      let seconds = 0;
      if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
      else seconds = Number(parts[0]) || 0;

      const label = desc || `时间点 ${timeStr}`;
      
      // 精确或就近模糊匹配（20秒内）已捕获图片
      let imgEntry = imagesMap[timeStr] || imagesMap[seconds] || imagesMap[String(seconds)];
      if (!imgEntry) {
        for (const [key, val] of Object.entries(imagesMap)) {
          if (val?.timestamp && Math.abs(val.timestamp - seconds) <= 20) {
            imgEntry = val;
            break;
          }
        }
      }

      const dataUrl = imgEntry?.dataUrl || imgEntry?.url || (typeof imgEntry === 'string' ? imgEntry : '');

      if (dataUrl) {
        return `
<div class="note-image-card" data-timestamp="${seconds}">
  <div class="note-image-wrap">
    <img src="${dataUrl}" alt="${label}" class="note-img-thumbnail" loading="lazy" />
    <button class="note-card-delete-btn" data-seek="${seconds}" data-timestr="${timeStr}" title="删除此截图">✕</button>
    <button class="note-jump-btn" data-seek="${seconds}" title="跳转到 ${timeStr} 播放">
      <span class="note-jump-icon">▶</span>
      <span class="note-jump-time">${timeStr}</span>
    </button>
  </div>
  <div class="note-image-caption">📸 ${label}</div>
</div>`;
      }

      return `
<div class="note-image-placeholder" data-timestamp="${seconds}" data-time-str="${timeStr}" data-label="${label}">
  <div class="note-placeholder-inner">
    <span class="placeholder-icon">📸</span>
    <span class="placeholder-text">${label} (${timeStr})</span>
    <button class="btn-capture-slot" data-seek="${seconds}" data-timestr="${timeStr}">立即截取</button>
  </div>
</div>`;
    });

    // 8. 传统 Markdown 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
      return `
<div class="note-image-card">
  <div class="note-image-wrap">
    <img src="${url}" alt="${alt}" class="note-img-thumbnail" loading="lazy" />
  </div>
  ${alt ? `<div class="note-image-caption">${alt}</div>` : ''}
</div>`;
    });

    // 9. 分割线
    html = html.replace(/^(?:---|===|\*\*\*|___)\s*$/gm, '<hr class="note-hr" />');

    // 10. 标题 (# 至 ######)
    html = html
      .replace(/^###### (.*$)/gim, '<h6 class="note-h6">$1</h6>')
      .replace(/^##### (.*$)/gim, '<h5 class="note-h5">$1</h5>')
      .replace(/^#### (.*$)/gim, '<h4 class="note-h4">$1</h4>')
      .replace(/^### (.*$)/gim, '<h3 class="note-h3">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="note-h2">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="note-h1">$1</h1>');

    // 11. 引用块 (> ...)
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="note-quote">$1</blockquote>');

    // 12. 粗体、斜体、删除线、行内代码
    html = html
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code class="note-inline-code">$1</code>');

    // 13. 列表项
    html = html
      .replace(/^\s*[-*]\s+(.*$)/gim, '<li class="note-list-item">$1</li>')
      .replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="note-ordered-item" data-num="$1">$1. $2</li>');

    // 14. 换行与段落清洗，防止块级标签被包裹在 <p> 中引发浏览器非预期提前闭合
    html = html.replace(/\n\n+/g, '</p><p class="note-p">');
    html = `<div class="note-rendered-content"><p class="note-p">${html}</p></div>`;
    html = html
      .replace(/<p class="note-p">\s*(<(?:h[1-6]|div|blockquote|hr|table|ul|ol)[^>]*>)/gi, '$1')
      .replace(/(<\/(?:h[1-6]|div|blockquote|hr|table|ul|ol)>)\s*<\/p>/gi, '$1')
      .replace(/<p class="note-p">\s*<\/p>/gi, '');

    // 15. 还原表格占位符中的 HTML 实体反转义
    html = html.replace(/&lt;div class="note-table-wrap"&gt;[\s\S]*?&lt;\/div&gt;/g, (escaped) => {
      return escaped
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    });

    // 16. 还原公式与代码块占位符
    mathBlocks.forEach((blockHtml, i) => {
      html = html.replace(`___MATH_BLOCK_${i}___`, blockHtml);
    });
    mathInlines.forEach((inlineHtml, i) => {
      html = html.replace(`___MATH_INLINE_${i}___`, inlineHtml);
    });
    codeBlocks.forEach((codeHtml, i) => {
      html = html.replace(`___CODE_BLOCK_${i}___`, codeHtml);
    });

    return html;
  }

  /**
   * 格式化统一分发函数
   * @param {string} type
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {import('../types/bse').MetadataOptions} [metadata]
   * @param {import('../types/bse').FormatOptions} [options]
   * @returns {string}
   */
  function format(type, cues, metadata = {}, options = {}) {
    if (type === 'srt') return toSrt(cues);
    if (type === 'md') return toMarkdown(cues, metadata, options);
    return toTxt(cues, options?.withTimestamp || false);
  }

  BSE.Formatters = Object.freeze({
    mergeParagraphs,
    toTxt,
    toSrt,
    toMarkdown,
    toMergedMarkdown,
    buildBatchManifest,
    AI_PROMPTS,
    generateAiPrompt,
    renderNoteToHtml,
    format
  });
})();
