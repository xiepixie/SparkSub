(() => {
  'use strict';

  const BSE = globalThis.BSE;

  function normalizedMode(mode) {
    return mode === 'merged-md' ? 'merged-file' : mode;
  }

  function isYouTubeTree(tree) {
    return tree?.kind === 'youtube_playlist';
  }

  function sortedResults(results) {
    const list = Array.isArray(results)
      ? results
      : (results && typeof results.values === 'function' ? Array.from(results.values()) : []);
    return list
      .filter(Boolean)
      .sort((a, b) => Number(a?.item?.globalIndex || 0) - Number(b?.item?.globalIndex || 0));
  }

  function selectItems(tree, config) {
    const items = tree?.items || [];
    if (config.scope === 'current-page') {
      const current = items.find((item) => (
        item.bvid === tree.currentBvid && (tree.currentPage ? item.page === tree.currentPage : true)
      )) || items[0];
      return current ? [current] : [];
    }
    if (config.scope === 'current-video' || config.scope === 'video') {
      const targetBvid = config.targetBvid || tree.currentBvid;
      const sameVideo = items.filter((item) => item.bvid === targetBvid);
      return sameVideo.length ? sameVideo : items.slice(0, 1);
    }
    if (config.scope === 'section') {
      if (config.sectionKey) {
        const sectionItems = items.filter((item) => item.sectionKey === config.sectionKey);
        if (sectionItems.length) return sectionItems;
      }
      const current = items.find((item) => item.bvid === tree.currentBvid) || items[0];
      return current ? items.filter((item) => item.sectionKey === current.sectionKey) : items.slice();
    }
    if (config.scope === 'range') {
      const start = Math.min(items.length, Math.max(1, Number(config.rangeStart) || 1));
      const end = Math.min(items.length, Math.max(1, Number(config.rangeEnd) || items.length));
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      return items.filter((item) => item.globalIndex >= min && item.globalIndex <= max);
    }
    if (config.scope === 'custom') {
      const selected = config.customIndices instanceof Set
        ? config.customIndices
        : new Set(config.customIndices || []);
      return items.filter((item) => selected.has(item.globalIndex));
    }
    return items.slice();
  }

  function trackLanguageLabel(track, fallback = '未知') {
    return String(
      track?.label
      || track?.lanDoc
      || track?.lan_doc
      || track?.language
      || track?.languageCode
      || track?.lan
      || fallback
    ).trim() || fallback;
  }

  function zipFailureNote(result, platformLabel) {
    const item = result.item || {};
    const lines = [
      `标题：${item.title || '未命名'}`,
      ...(platformLabel === 'YouTube'
        ? [`ID：${item.bvid || ''}`]
        : [`分P：${item.page || item.globalIndex || ''}`, `BV号：${item.bvid || ''}`, `CID：${item.cid || ''}`]),
      `链接：${item.sourceUrl || ''}`
    ];
    if (result.status === 'no_subtitle') {
      lines.push(`状态：无可用字幕（${result.reason || '未检测到字幕轨道'}）`);
    } else {
      lines.push('状态：字幕提取失败', `原因：${result.reason || '网络或解析异常'}`);
    }
    return `${lines.join('\n')}\n`;
  }

  /**
   * 将平台抓取结果投影为统一批量输出。平台 Module 只负责生产 BatchItemResult；
   * 复制、单一长文件和 ZIP 的组织规则全部集中在这里。
   * @param {import('../types/bse').BatchMediaTree} tree
   * @param {Array<import('../types/bse').BilibiliItem>} selectedItems
   * @param {Array<import('../types/bse').BatchItemResult>|Map<any, import('../types/bse').BatchItemResult>} results
   * @param {import('../types/bse').BatchProgressStats} stats
   * @param {import('../types/bse').BatchConfig} config
   * @param {{ onPackProgress?: (percent: number) => void }} [options]
   * @returns {Promise<import('../types/bse').BatchOutput>}
   */
  async function createOutput(tree, selectedItems, results, stats, config, options = {}) {
    const mode = normalizedMode(config.outputMode);
    const orderedResults = sortedResults(results);
    const safeTitle = BSE.Utils.sanitizeFilename(tree?.title || '字幕合集');
    const manifest = BSE.Formatters.buildBatchManifest(tree, selectedItems, orderedResults, stats, config);

    if (mode === 'copy-text') {
      const text = BSE.Formatters.toMergedText(tree, orderedResults, stats, { withTimestamp: config.withTimestamp });
      return {
        mode: 'copy-text',
        text,
        filename: `${safeTitle}_字幕全文.txt`,
        mime: 'text/plain;charset=utf-8'
      };
    }

    if (mode === 'merged-file') {
      const isText = config.format === 'txt';
      const text = isText
        ? BSE.Formatters.toMergedText(tree, orderedResults, stats, { withTimestamp: config.withTimestamp })
        : BSE.Formatters.toMergedMarkdown(tree, orderedResults, stats, { withTimestamp: config.withTimestamp });
      const extension = isText ? 'txt' : 'md';
      return {
        mode: 'merged-file',
        text,
        filename: `${safeTitle}_合并字幕.${extension}`,
        mime: isText ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8'
      };
    }

    const JSZipClass = globalThis.JSZip;
    if (!JSZipClass) throw new Error('JSZip 模块未加载');
    const zip = new JSZipClass();
    const platformLabel = isYouTubeTree(tree) ? 'YouTube' : 'B站';
    const hasMultipleSections = (tree?.sections || []).length > 1;

    for (const result of orderedResults) {
      const item = result.item || {};
      const targetContainer = hasMultipleSections
        ? zip.folder(BSE.Utils.sanitizeFilename(item.sectionTitle || item.sectionKey || '全集'))
        : zip;
      const itemIndex = Number(item.globalIndex || 1);
      const numberedPrefix = new RegExp(`^\\s*0*${itemIndex}\\s*(?:[.、:_-]\\s*|\\s+)`);
      const cleanTitle = String(item.title || '未命名').replace(numberedPrefix, '').trim() || '未命名';
      const baseName = `${String(itemIndex).padStart(3, '0')}_${BSE.Utils.sanitizeFilename(cleanTitle)}`;

      if (result.status === 'success') {
        const format = config.format || 'srt';
        const content = BSE.Formatters.format(format, result.body || [], {
          title: item.title,
          url: item.sourceUrl,
          platform: platformLabel,
          language: trackLanguageLabel(result.track)
        }, { withTimestamp: config.withTimestamp });
        targetContainer.file(`${baseName}.${format}`, content);
      } else if (result.status === 'no_subtitle') {
        targetContainer.file(`${baseName} (无字幕).txt`, zipFailureNote(result, platformLabel));
      } else {
        targetContainer.file(`${baseName} (下载失败).error.txt`, zipFailureNote(result, platformLabel));
      }
    }

    zip.file('_README.md', BSE.Formatters.toMergedMarkdown(tree, orderedResults, stats, { withTimestamp: config.withTimestamp }));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    options.onPackProgress?.(0);
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      options.onPackProgress?.(Number(meta.percent) || 0);
    });
    return {
      mode: 'zip',
      blob,
      filename: `${safeTitle}_字幕.zip`,
      mime: 'application/zip'
    };
  }

  /**
   * 将统一输出交给当前 UI 上下文的真实投递 Adapter。
   * @param {import('../types/bse').BatchOutput} output
   * @param {{ writeText: (text: string) => Promise<void>, downloadText: (text: string, filename: string, mime: string) => void, downloadBlob: (blob: Blob, filename: string) => void }} adapters
   */
  async function deliver(output, adapters) {
    if (!output) throw new Error('批量输出为空');
    if (output.mode === 'copy-text') {
      if (!output.text) throw new Error('已读取字幕，但未能生成可复制文本');
      await adapters.writeText(output.text);
      return;
    }
    if (output.mode === 'merged-file') {
      if (!output.text) throw new Error('已读取字幕，但未能生成合并文件');
      adapters.downloadText(output.text, output.filename, output.mime);
      return;
    }
    if (output.mode === 'zip') {
      if (!output.blob) throw new Error('未能生成 ZIP 压缩包');
      adapters.downloadBlob(output.blob, output.filename);
      return;
    }
    throw new Error(`不支持的批量输出模式：${output.mode}`);
  }

  BSE.BatchExport = Object.freeze({
    selectItems,
    createOutput,
    deliver,
    trackLanguageLabel
  });
})();
