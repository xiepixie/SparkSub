(() => {
  'use strict';

  const BSE = globalThis.BSE;
  const { formatClock } = BSE.Utils;

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
1. 去噪与清洗：过滤讲者口误自纠、口头禅、闲聊冗余与机械性代数运算口述；保留关键变形、换元、构造动机与分类依据；
2. ASR 纠错与符号规范：修正同音错字与语音识别错误；数学/物理公式统一使用标准 LaTeX（行内 $...$，独立块 $$...$$），代码使用规范代码块；
3. 防幻觉与可信度分级：严禁编造原视频未给出的关键条件与数据；无法确认的信息标注 [原视频未明示/待补充]；
4. 注重方法动机：遇到关键推导、设参、定理应用或分类讨论时，必须说明“为什么这样做”；
5. 语言风格：专业、克制、自然，杜绝“秒杀/大招/闭眼套”等营销化夸张表达。

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
    format
  });
})();
