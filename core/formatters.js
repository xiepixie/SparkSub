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

  function generateSubtitlePolishPrompt(cues, withTimestamp = false, metadata = {}) {
    const list = Array.isArray(cues) ? cues : [];
    const taskToken = String(metadata?.taskToken || '').trim();
    const protocolHeader = taskToken
      ? `\n\n返回的第一行必须原样写：\nSPARKSUB_PATCH ${taskToken}`
      : '';
    const promptHeader = `请保守校对下面的视频字幕。

重点修正明显的 ASR 同音/近音错误、吞音断词、专有名词、大小写和基础标点。只有上下文足够明确时才补回漏词；保留说话人的自然口吻、措辞习惯和句子顺序，不把口语改写成书面文章。

每一行的 Lxxxx 是 SparkSub 已有时间轴的稳定锚点。不要合并、拆分、重排或改写这些行号。为了减少返回内容，只输出真正需要修改的行，格式固定为：
L0012 | 校对后的这一句
L0048 | 校对后的这一句${protocolHeader}

未修改的行不要重复返回；如果整份字幕都无需修改，在任务标识行之后只返回 NO_CHANGES。不要输出解释、摘要、Markdown 代码块或时间戳。`;
    const text = list.map((cue, index) => {
      const id = `L${String(index + 1).padStart(4, '0')}`;
      const content = String(cue?.content || '').replace(/\s+/g, ' ').trim();
      return withTimestamp ? `${id} | ${formatClock(cue?.from)} | ${content}` : `${id} | ${content}`;
    }).join('\n');
    const contextBlock = BSE.MediaContext?.formatPromptContext?.(metadata?.mediaContext || null, { title: metadata?.title || '' }) || '';
    return `${promptHeader}${contextBlock ? `\n\n${contextBlock}` : ''}\n\n### 原始字幕\n${text}`.trim();
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
   * 将大模型生成的课程笔记 Markdown 安全渲染为连续富文本文档。
   * 支持 KaTeX、GFM 表格、代码块和交互式 frame:// 图片，同时保持原始 HTML 为不可信文本。
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
    const safeLinkUrl = (value) => {
      const url = String(value || '').trim();
      if (!/^(?:https?:|mailto:)/i.test(url)) return '';
      return escapeHtmlAttribute(url);
    };
    const parseClockSeconds = (value) => {
      const parts = String(value || '').trim().split(':').map(Number);
      if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
      const seconds = parts.at(-1);
      const minutes = parts.at(-2);
      if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
      return parts.length === 3
        ? parts[0] * 3600 + minutes * 60 + seconds
        : minutes * 60 + seconds;
    };
    const parseTimelineHeading = (value) => {
      const match = String(value || '').trim().match(/^\[\s*((?:\d{1,3}:)?\d{1,2}:\d{2})\s*(?:–|—|-|~|～|至)\s*((?:\d{1,3}:)?\d{1,2}:\d{2})\s*\]\s*(?:[·•—-]\s*)?(.+)$/);
      if (!match) return null;
      const start = parseClockSeconds(match[1]);
      const end = parseClockSeconds(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { start, end, title: match[3].trim() };
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
    <img src="${dataUrl}" alt="${safeLabelAttr}" class="note-img-thumbnail" loading="lazy" decoding="async" />
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

    // 3. 提取并替换独立块级公式 $$ ... $$ 与 \[ ... \] 为占位符
    const mathBlocks = [];
    const blockMathHandler = (_match, eq) => {
      const id = `___MATH_BLOCK_${mathBlocks.length}___`;
      mathBlocks.push(renderLatex(eq, true));
      return `\n\n${id}\n\n`;
    };
    rawText = rawText.replace(/\$\$([\s\S]*?)\$\$/g, blockMathHandler);
    rawText = rawText.replace(/(?:\\\\|\\)\[([\s\S]*?)(?:\\\\|\\)\]/g, blockMathHandler);

    // 4. 提取并替换行内公式 \( ... \) 与 $ ... $ 为占位符
    const mathInlines = [];
    const inlineMathHandler = (_match, eq) => {
      const id = `___MATH_INLINE_${mathInlines.length}___`;
      mathInlines.push(renderLatex(eq, false));
      return id;
    };
    // 优先提取定界符明确的 \( ... \)
    rawText = rawText.replace(/(?:\\\\|\\)\(([\s\S]*?)(?:\\\\|\\)\)/g, inlineMathHandler);
    // 再提取常规 $ ... $，保持不跨行
    rawText = rawText.replace(/\$([^\$\n\r]+?)\$/g, inlineMathHandler);

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

    // 7. 普通 Markdown 图片也先占位，确保后续块级解析只面对文本而不是半成品 HTML。
    const imageBlocks = [];
    rawText = rawText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
      const safeUrl = safeImageUrl(url);
      const safeAlt = escapeHtmlText(alt);
      const safeAltAttr = escapeHtmlAttribute(alt);
      if (!safeUrl) return alt || '';
      const id = `___IMAGE_BLOCK_${imageBlocks.length}___`;
      imageBlocks.push(`
<div class="note-image-card">
  <div class="note-image-wrap">
    <img src="${safeUrl}" alt="${safeAltAttr}" class="note-img-thumbnail" loading="lazy" decoding="async" />
  </div>
  ${safeAlt ? `<div class="note-image-caption">${safeAlt}</div>` : ''}
</div>`);
      return `\n\n${id}\n\n`;
    });

    // 8. 统一换行并转义原始 HTML。外部 AI 常见的 CRLF 不应破坏段落边界。
    const escapedText = rawText
      .replace(/\r\n?/g, '\n')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 9. 行内 Markdown 只在纯文本片段中解析。先保护 inline code，避免代码里的 ** / * 被误判为样式。
    function renderInlineMarkdown(value) {
      const inlineCode = [];
      const inlineLinks = [];
      let text = String(value ?? '');
      text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
        const id = `___INLINE_CODE_${inlineCode.length}___`;
        inlineCode.push(`<code class="note-inline-code">${code}</code>`);
        return id;
      });
      text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, url) => {
        const safeUrl = safeLinkUrl(url);
        if (!safeUrl) return label;
        const id = `___INLINE_LINK_${inlineLinks.length}___`;
        inlineLinks.push(`<a class="note-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        return id;
      });
      text = text
        .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^\n]+?)~~/g, '<del>$1</del>')
        .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
      text = text.replace(/___INLINE_LINK_(\d+)___/g, (_match, index) => inlineLinks[Number(index)] || '');
      text = text.replace(/___INLINE_CODE_(\d+)___/g, (_match, index) => inlineCode[Number(index)] || '');
      return text;
    }

    // 10. 按行构造合法块级结构。列表必须拥有真实 ul/ol 容器，段落不再依赖浏览器纠正非法 DOM。
    const output = [];
    let paragraphLines = [];
    let listType = '';
    let listStart = 1;
    let listItems = [];

    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      const oneLine = paragraphLines.length === 1 ? paragraphLines[0].trim() : '';
      const emphasisOnly = Boolean(oneLine && /^\*\*[^\n]+\*\*$/.test(oneLine));
      const content = paragraphLines.map(renderInlineMarkdown).join('\n');
      output.push(`<p class="note-p${emphasisOnly ? ' note-emphasis-label' : ''}">${content}</p>`);
      paragraphLines = [];
    };

    const flushList = () => {
      if (!listType || !listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const startAttr = tag === 'ol' && listStart !== 1 ? ` start="${listStart}"` : '';
      output.push(`<${tag} class="note-list"${startAttr}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
      listType = '';
      listStart = 1;
      listItems = [];
    };

    const flushFlow = () => {
      flushParagraph();
      flushList();
    };

    for (const sourceLine of escapedText.split('\n')) {
      const line = sourceLine.replace(/[ \t]+$/g, '');
      const trimmed = line.trim();
      if (!trimmed) {
        flushFlow();
        continue;
      }

      if (/^___(?:CODE_BLOCK|MATH_BLOCK|TABLE_BLOCK|FRAME_BLOCK|IMAGE_BLOCK)_\d+___$/.test(trimmed)) {
        flushFlow();
        output.push(trimmed);
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushFlow();
        const level = heading[1].length;
        const timeline = level === 2 ? parseTimelineHeading(heading[2]) : null;
        if (timeline) {
          const startLabel = BSE.Utils?.formatClock ? BSE.Utils.formatClock(timeline.start) : String(timeline.start);
          const endLabel = BSE.Utils?.formatClock ? BSE.Utils.formatClock(timeline.end) : String(timeline.end);
          output.push(`<h${level} class="note-h${level} note-timeline-heading" data-range-start="${timeline.start}" data-range-end="${timeline.end}"><button type="button" class="note-timeline-jump" data-seek="${timeline.start}" title="跳转到 ${escapeHtmlAttribute(startLabel)} 播放"><span class="note-timeline-range">${escapeHtmlText(startLabel)}–${escapeHtmlText(endLabel)}</span></button><span class="note-timeline-title">${renderInlineMarkdown(timeline.title)}</span></h${level}>`);
        } else {
          output.push(`<h${level} class="note-h${level}">${renderInlineMarkdown(heading[2])}</h${level}>`);
        }
        continue;
      }

      if (/^(?:---|===|\*\*\*|___)$/.test(trimmed)) {
        flushFlow();
        output.push('<hr class="note-hr" />');
        continue;
      }

      const quote = trimmed.match(/^(?:>|&gt;)\s?(.*)$/);
      if (quote) {
        flushFlow();
        output.push(`<blockquote class="note-quote">${renderInlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        if (listType && listType !== 'ul') flushList();
        listType = 'ul';
        listItems.push(unordered[1]);
        continue;
      }

      const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        if (listType && listType !== 'ol') flushList();
        if (!listType) listStart = Math.max(1, Number(ordered[1]) || 1);
        listType = 'ol';
        listItems.push(ordered[2]);
        continue;
      }

      flushList();
      paragraphLines.push(line);
    }
    flushFlow();

    let html = `<div class="note-rendered-content">${output.join('\n')}</div>`;

    // 11. 还原经过独立安全处理的块级内容与公式/代码占位符。
    // 每类占位符只扫描一次最终 HTML，避免长笔记中 N 个公式/代码块触发 N 次全字符串 replace。
    const restoreIndexed = (source, kind, values) => source.replace(
      new RegExp(`___${kind}_(\\d+)___`, 'g'),
      (_match, index) => values[Number(index)] || ''
    );
    html = restoreIndexed(html, 'TABLE_BLOCK', tableBlocks);
    html = restoreIndexed(html, 'FRAME_BLOCK', frameBlocks);
    html = restoreIndexed(html, 'IMAGE_BLOCK', imageBlocks);
    html = restoreIndexed(html, 'MATH_BLOCK', mathBlocks);
    html = restoreIndexed(html, 'MATH_INLINE', mathInlines);
    html = restoreIndexed(html, 'CODE_BLOCK', codeBlocks);

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
    generateSubtitlePolishPrompt,
    buildFrameReference,
    resolveFrameEntry,
    transformFrameReferences,
    renderNoteToHtml,
    format
  });
})();
