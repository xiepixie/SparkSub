(() => {
  'use strict';

  const BSE = globalThis.BSE;
  const formatClock = (seconds) => (BSE.Utils?.formatClock ? BSE.Utils.formatClock(seconds) : `${seconds}`);

  /**
   * 将字幕行合并为自然段落文本
   * @param {Array<import('../types/bse').Cue>} cues
   * @returns {string}
   */
  function mergeParagraphs(cues) {
    const paragraphs = [];
    let current = '';
    let previousTo = null;

    const flush = () => {
      const paragraph = current.trim();
      if (paragraph) paragraphs.push(paragraph);
      current = '';
    };
    const separatorFor = (left, right) => {
      if (!left || !right) return '';
      if (/\s$/.test(left) || /^\s/.test(right)) return '';
      if (/[（(【\[《「『“‘]$/.test(left)) return '';
      if (/^[，。！？；：、,.!?;:)）\]】》」』”’]/.test(right)) return '';
      const leftChar = left.slice(-1);
      const rightChar = right.charAt(0);
      const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
      if (cjk.test(leftChar) && cjk.test(rightChar)) return '\n';
      if (/[，。！？；：、]$/.test(left)) return '';
      return ' ';
    };

    for (const cue of cues || []) {
      const text = String(cue.content || '').trim();
      if (!text) continue;

      const from = Number(cue.from);
      const to = Number(cue.to);
      const gap = previousTo != null && Number.isFinite(from) ? Math.max(0, from - previousTo) : 0;
      if (current && gap >= 1.5 && current.length >= 40) flush();

      current += `${separatorFor(current, text)}${text}`;

      const strongSentenceEnd = /[。！？!?；;]$/.test(text);
      if ((strongSentenceEnd && current.length >= 80) || current.length >= 240) flush();
      if (Number.isFinite(to)) previousTo = to;
    }
    flush();
    return paragraphs.join('\n\n');
  }

  function mergeCueTextForModel(cues) {
    return (cues || [])
      .map((cue) => String(cue.content || '').trim())
      .filter(Boolean)
      .join(' ');
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
      icon: '',
      text: 'ASR 吞音与术语纠错',
      desc: '原声保真 > ASR 纠错 > 语法规范。保留自然口吻与交谈感，精准修正同音、吞音与专有名词',
      prompt: (meta = {}) => `请保守校对下面的视频字幕。视频标题是《${meta?.title || '视频原片'}》。

重点修正明显的 ASR 同音/近音错误、吞音断词、专有名词、大小写和基础标点。只有上下文足够明确时才补回漏词；保留说话人的自然口吻、措辞习惯和句子顺序，不把口语改写成书面文章。

直接返回校对后的字幕文本即可。

原始字幕：`
    },
    {
      id: 'notes',
      icon: '',
      text: '生成结构化深度讲义',
      desc: '去噪纠错、定理脉络、推导动机与避坑边界',
      prompt: `请把下面的视频转录稿整理成一份适合深入学习和复盘的 Markdown 讲义。

先还原视频自己的逻辑，再根据内容类型选择结构，不要机械套统一模板：理工内容重点保留定义、推导、条件和关键变形；软件教程重点保留目标、步骤、代码/参数和失败场景；人文社科重点区分事实、观点、论据、背景与因果关系；访谈和演讲重点梳理观点、例子、转折和分歧。

过滤明显口头禅与重复，但保留真正承载思路的过程。视频没有给出的关键事实不要补成确定结论；必要的背景解释可以补充，但要和视频原意区分开。数学公式出现时用常规 LaTeX 排版，非数学内容不要强行公式化。

直接输出自然、连续、可阅读的 Markdown。

视频字幕：`
    },
    {
      id: 'summary',
      icon: '',
      text: '总结核心主旨与脉络',
      desc: '精准概括主线脉络、核心结论与关键注意点',
      prompt: `请把下面的视频转录稿整理成一份简洁但信息密度高的摘要。

先用一两句话说明视频真正讨论的主题与主要结论，再按讲解顺序梳理关键阶段、观点或因果链。保留重要前提、限制、争议点和作者特别强调的注意事项，去掉口头禅与重复表达。不要加入视频没有提供的事实。

视频字幕：`
    },
    {
      id: 'keypoints',
      icon: '',
      text: '提炼关键要点与清单',
      desc: '提炼高密度要点、适用边界与实战动作清单',
      prompt: `请从下面的视频转录稿中提炼最值得保留的关键要点。数量随内容决定，不必为了凑数硬拆成固定条数。

每条要点先给出清晰的核心判断，再补充真正必要的依据、条件、例子或行动建议。理工内容可以强调适用条件和操作步骤；人文、评论或访谈内容则更适合强调论据、背景、视角和结论。公式使用 LaTeX，代码使用代码块。不要写空泛套话，也不要补造视频没有提供的事实。

视频字幕：`
    },
    {
      id: 'questions',
      icon: '',
      text: '生成深度复盘与辨析题',
      desc: '生成概念辨析、推导动机与易错边界思考题',
      prompt: `请根据下面的视频转录稿设计一组真正适合复盘的思考题，并给出简洁的思考方向或参考答案。

问题应围绕视频最重要的理解难点，而不是简单回忆原句。理工内容可以追问概念差异、推导动机、条件变化和失败边界；人文社科可以追问论据是否支持结论、不同视角和因果解释；软件或操作教程可以追问为什么选择某一步、替代方案以及什么情况下会失败。题目数量随内容复杂度决定。

视频字幕：`
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
    const text = withTimestamp
      ? (cues || []).map((cue) => `${formatClock(cue.from)}  ${cue.content}`).join('\n')
      : mergeCueTextForModel(cues);
    const contextBlock = BSE.MediaContext?.formatMetadataBlock?.(metadata?.mediaContext || null) || '';
    return `${promptHeader}${contextBlock ? `\n\n${contextBlock}` : ''}\n\n${text}`.trim();
  }

  function frameTimeToSeconds(value) {
    const parts = String(value ?? '').trim().split(':').map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function buildFrameReference(timeStr, label = '相关画面') {
    const safeTime = String(timeStr || '00:00').trim().replace(/[^0-9:]/g, '') || '00:00';
    const safeLabel = String(label || '相关画面').replace(/[\r\n]+/g, ' ').replace(/\]/g, '）').trim() || '相关画面';
    return `![${safeLabel}](frame://${safeTime})`;
  }

  function resolveFrameEntry(imagesMap = {}, reference = {}) {
    const seconds = Number(reference.seconds);
    const timeStr = String(reference.timeStr || '');
    const maxDistance = Math.max(0, Number(reference.maxDistance ?? 5) || 0);
    const direct = imagesMap[timeStr]
      || (Number.isFinite(seconds) ? imagesMap[seconds] || imagesMap[String(seconds)] : null);
    if (direct) return { frame: direct, distance: 0 };
    if (!Number.isFinite(seconds)) return null;

    let nearestFrame = null;
    let nearestDistance = Infinity;
    for (const value of Object.values(imagesMap || {})) {
      const timestamp = Number(value?.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const distance = Math.abs(timestamp - seconds);
      if (distance <= maxDistance && distance < nearestDistance) {
        nearestFrame = value;
        nearestDistance = distance;
      }
    }
    return nearestFrame ? { frame: nearestFrame, distance: nearestDistance } : null;
  }

  function transformFrameReferences(markdown, transform) {
    const apply = (raw, timeStr, label) => {
      const result = transform({
        raw,
        timeStr: String(timeStr || ''),
        seconds: frameTimeToSeconds(timeStr),
        label: String(label || '').trim()
      });
      return typeof result === 'string' ? result : raw;
    };
    let output = String(markdown || '');
    output = output.replace(/!\[([^\]]*)\]\(frame:\/\/([0-9:]+)\)/gi, (raw, label, timeStr) => apply(raw, timeStr, label));
    output = output.replace(/\[SCREENSHOT:\s*([0-9:]+)(?:\s*["“]([^"”]+)["”])?\]/gi, (raw, timeStr, label) => apply(raw, timeStr, label));
    return output;
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
    const validResults = resultsList
      .filter(Boolean)
      .sort((a, b) => Number(a?.item?.globalIndex || 0) - Number(b?.item?.globalIndex || 0));
    const isYouTube = tree?.kind === 'youtube_playlist';
    const sourceLabel = isYouTube ? 'YouTube' : '哔哩哔哩';
    const sourceLinkLabel = isYouTube ? 'YouTube 链接' : 'B站链接';
    const lines = [
      `# ${tree.title || '字幕合集'}`,
      '',
      `> 来源：${sourceLabel}`,
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
      const itemIndex = Number(r.item?.globalIndex || 1);
      const epNum = String(itemIndex).padStart(3, '0');
      const numberedPrefix = new RegExp(`^\\s*0*${itemIndex}\\s*(?:[.、:_-]\\s*|\\s+)`);
      const cleanTitle = String(r.item?.title || '').replace(numberedPrefix, '').trim() || '未命名';
      lines.push(`### ${epNum}. ${cleanTitle}`);
      if (r.item?.sourceUrl) lines.push(`- 来源：[${sourceLinkLabel}](${r.item.sourceUrl})`);

      if (r.status === 'success') {
        lines.push(`- 字幕类型：${r.track?.lan_doc || r.track?.lanDoc || r.track?.label || r.track?.language || r.track?.lan || '未知'}`, '');
        if (withTimestamp) {
          for (const cue of (r.body || [])) {
            lines.push(`- \`[${formatClock(cue.from)}]\` ${cue.content}`);
          }
        } else {
          lines.push(mergeParagraphs(r.body));
        }
      } else if (r.status === 'no_subtitle') {
        lines.push('- 状态：`本集未提供字幕（UP主未上传且未生成AI字幕）`', '');
      } else {
        lines.push(`- 状态：\`本集字幕抓取失败（${r.reason || '网络或接口异常'}）\``, '');
      }
      lines.push('', '---', '');
    }

    return lines.join('\n');
  }

  /**
   * 导出为适合复制、纯文本归档的合并长文稿。
   * 不使用 Markdown 标题语法，避免用户粘贴到文档、AI 或聊天框后携带额外格式噪声。
   * @param {import('../types/bse').BilibiliTree} tree
   * @param {any} results
   * @param {any} [stats]
   * @param {import('../types/bse').FormatOptions} [options]
   * @returns {string}
   */
  function toMergedText(tree, results, stats = {}, { withTimestamp = false } = {}) {
    const resultsList = Array.isArray(results)
      ? results
      : (results && typeof results.values === 'function' ? Array.from(results.values()) : []);
    const validResults = resultsList
      .filter(Boolean)
      .sort((a, b) => Number(a?.item?.globalIndex || 0) - Number(b?.item?.globalIndex || 0));
    const lines = [
      tree.title || '字幕合集',
      `共 ${stats.total || validResults.length} 项 · 成功 ${stats.success || 0} · 无字幕 ${stats.noSub || 0} · 失败 ${stats.failed || 0}`,
      ''
    ];

    for (const result of validResults) {
      const itemIndex = Number(result.item?.globalIndex || 1);
      const index = String(itemIndex).padStart(3, '0');
      const numberedPrefix = new RegExp(`^\\s*0*${itemIndex}\\s*(?:[.、:_-]\\s*|\\s+)`);
      const title = String(result.item?.title || '未命名').replace(numberedPrefix, '').trim() || '未命名';
      lines.push(`${index}. ${title}`);
      if (result.status === 'success') {
        if (withTimestamp) {
          for (const cue of (result.body || [])) {
            lines.push(`[${formatClock(cue.from)}] ${cue.content}`);
          }
        } else {
          lines.push(mergeParagraphs(result.body || []));
        }
      } else if (result.status === 'no_subtitle') {
        lines.push(`（无可用字幕：${result.reason || '未检测到字幕轨道'}）`);
      } else {
        lines.push(`（字幕提取失败：${result.reason || '网络或接口异常'}）`);
      }
      lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
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
          subtitle: r?.track ? {
            lan: r.track.lan || r.track.language || r.track.languageCode || null,
            lan_doc: r.track.lan_doc || r.track.lanDoc || r.track.label || null,
            isAI: Boolean(r.track.isAI || r.track.captionKind === 'auto')
          } : null,
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

    const escapeHtmlText = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const escapeHtmlAttribute = (value) => String(value ?? '')
      .replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeImageUrl = (value) => {
      const url = String(value || '').trim();
      if (!/^(?:https?:|blob:|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(url)) return '';
      return escapeHtmlAttribute(url);
    };
    const renderSafeTableCell = (value) => escapeHtmlText(value)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code class="note-inline-code">$1</code>');
    const renderFrameHtml = ({ timeStr, seconds, label }) => {
      const displayLabel = label || `时间点 ${timeStr}`;
      const resolved = resolveFrameEntry(imagesMap, { timeStr, seconds, maxDistance: 5 });
      const imgEntry = resolved?.frame || null;
      const actualTimestamp = Number(imgEntry?.timestamp);
      const actualSeconds = Number.isFinite(actualTimestamp) ? actualTimestamp : seconds;
      const actualTimeStr = imgEntry?.timeStr
        || (BSE.Utils?.formatClock ? BSE.Utils.formatClock(actualSeconds) : timeStr);

      const dataUrl = safeImageUrl(imgEntry?.dataUrl || imgEntry?.url || (typeof imgEntry === 'string' ? imgEntry : ''));
      const safeLabel = escapeHtmlText(displayLabel);
      const safeLabelAttr = escapeHtmlAttribute(displayLabel);
      const safeTimeStr = escapeHtmlAttribute(timeStr);
      const safeActualTimeStr = escapeHtmlAttribute(actualTimeStr);
      if (dataUrl) {
        return `
<div class="note-image-card" data-timestamp="${actualSeconds}">
  <div class="note-image-wrap">
    <img src="${dataUrl}" alt="${safeLabelAttr}" class="note-img-thumbnail" loading="lazy" />
    <button class="note-card-delete-btn" data-seek="${actualSeconds}" data-timestr="${safeActualTimeStr}" data-ref-seek="${seconds}" data-ref-timestr="${safeTimeStr}" title="删除此截图">×</button>
    <button class="note-jump-btn" data-seek="${actualSeconds}" title="跳转到 ${safeActualTimeStr} 播放">
      <span class="note-jump-time">${escapeHtmlText(actualTimeStr)}</span>
    </button>
  </div>
  <div class="note-image-caption">${safeLabel}</div>
</div>`;
      }

      return `
<div class="note-image-placeholder" data-timestamp="${seconds}" data-time-str="${safeTimeStr}" data-label="${safeLabelAttr}">
  <div class="note-placeholder-inner">
    <span class="placeholder-text">${safeLabel} (${escapeHtmlText(timeStr)})</span>
    <button class="btn-capture-slot" data-seek="${seconds}" data-timestr="${safeTimeStr}">立即截取</button>
  </div>
</div>`;
    };

    // 0. 清理大模型可能输出的转义 \$ 为标准 LaTeX 符号 $
    let rawText = markdown.replace(/\\\$/g, '$');

    // 1. 提取并替换多行代码块 ```lang ... ``` 为占位符
    const codeBlocks = [];
    rawText = rawText.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const id = `___CODE_BLOCK_${codeBlocks.length}___`;
      const escapedCode = escapeHtmlText(code);
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

    // 5. GFM Markdown 表格解析器。表格 HTML 先进入占位符，单元格逐个转义，
    // 避免后续为了恢复表格结构而把模型输出中的原始 HTML 一并反转义。
    const tableBlocks = [];
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

      const thead = '<thead><tr>' + headers.map((h, i) => `<th style="text-align:${aligns[i] || 'left'}">${renderSafeTableCell(h)}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + bodyLines.map(rowLine => {
        const cells = parseCells(rowLine);
        return '<tr>' + cells.map((c, i) => `<td style="text-align:${aligns[i] || 'left'}">${renderSafeTableCell(c)}</td>`).join('') + '</tr>';
      }).join('') + '</tbody>';

      const id = `___TABLE_BLOCK_${tableBlocks.length}___`;
      tableBlocks.push(`<div class="note-table-wrap"><table class="note-table">${thead}${tbody}</table></div>`);
      return `\n\n${id}\n\n`;
    });

    // 6. 新的 frame:// Markdown 引用与旧 SCREENSHOT 语法统一进入受控图片块。
    const frameBlocks = [];
    rawText = transformFrameReferences(rawText, (frameRef) => {
      const id = `___FRAME_BLOCK_${frameBlocks.length}___`;
      frameBlocks.push(renderFrameHtml(frameRef));
      return `\n\n${id}\n\n`;
    });

    // 7. 转义基础 HTML 字符
    let html = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 8. 传统 Markdown 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
      const safeUrl = safeImageUrl(url);
      const safeAlt = escapeHtmlText(alt);
      const safeAltAttr = escapeHtmlAttribute(alt);
      if (!safeUrl) return safeAlt ? `<span class="note-image-caption">${safeAlt}</span>` : '';
      return `
<div class="note-image-card">
  <div class="note-image-wrap">
    <img src="${safeUrl}" alt="${safeAltAttr}" class="note-img-thumbnail" loading="lazy" />
  </div>
  ${safeAlt ? `<div class="note-image-caption">${safeAlt}</div>` : ''}
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

    // 15. 还原已经逐单元格转义过的表格块。
    tableBlocks.forEach((tableHtml, i) => {
      html = html.replace(`___TABLE_BLOCK_${i}___`, tableHtml);
    });

    frameBlocks.forEach((frameHtml, i) => {
      html = html.replace(`___FRAME_BLOCK_${i}___`, frameHtml);
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
    toMergedText,
    buildBatchManifest,
    AI_PROMPTS,
    generateAiPrompt,
    buildFrameReference,
    resolveFrameEntry,
    transformFrameReferences,
    renderNoteToHtml,
    format
  });
})();
