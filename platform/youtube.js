(() => {
  'use strict';

  const BSE = globalThis.BSE;
  const { delay, fetchWithTimeout, getYouTubeVideoId } = BSE.Utils;
  const CHANNEL = 'bse-extension-bridge-v1';
  const requests = new Map();

  function bridgeRequest(type, payload = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(`播放器通信超时：${type}`));
      }, timeoutMs);
      const onMessage = (event) => {
        const data = event?.data;
        if (data?.channel !== CHANNEL || data?.direction !== 'response' || data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error || '播放器通信失败'));
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CHANNEL, direction: 'request', requestId, type, payload }, '*');
    });
  }

  function rememberRequest(request) {
    if (!request?.url || !request.videoId) return;
    const currentVideoId = getYouTubeVideoId();
    if (currentVideoId && request.videoId !== currentVideoId) return;
    requests.set(request.url, request);
    if (requests.size > 24) requests.delete(requests.keys().next().value);
  }

  async function hydrateCapturedRequests() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'BSE_GET_CAPTURED_REQUESTS' });
      (response?.requests || []).forEach(rememberRequest);
    } catch {}
  }

  function matchingRequests(track) {
    const videoId = getYouTubeVideoId();
    const expectedKind = track?.isAuto ? 'asr' : 'manual';
    const targetLang = track?.lan || '';
    const isTrackTranslated = Boolean(track?.isTranslated || track?.tlang);

    return Array.from(requests.values())
      .filter((item) => item.videoId === videoId)
      .filter((item) => {
        if (!targetLang) return true;
        // 如果目标轨道是翻译轨（如 zh-Hans），只匹配携带 tlang=zh-Hans 的翻译请求
        if (isTrackTranslated) {
          return (item.tlang === targetLang || item.lang === targetLang) && Boolean(item.tlang);
        }
        // 如果目标轨道是原生轨（未翻译，如 en），绝不能匹配携带了 tlang 的翻译请求！
        if (item.tlang) return false;
        return item.lang === targetLang || item.sourceLang === targetLang;
      })
      .sort((a, b) => {
        const aScore = Number(a.kind === expectedKind) + Number(a.hasPoToken) * 2 + Number(a.fmt === 'json3');
        const bScore = Number(b.kind === expectedKind) + Number(b.hasPoToken) * 2 + Number(b.fmt === 'json3');
        return bScore - aScore || b.capturedAt - a.capturedAt;
      })
      .slice(0, 2);
  }

  async function waitForPlayer(signal, timeoutMs = 7000) {
    const deadline = Date.now() + timeoutMs;
    // 0ms 极速探测
    try {
      const state = await bridgeRequest('GET_PLAYER_STATE', {}, 500);
      if (state?.ready && (!state.video?.id || state.video?.id === getYouTubeVideoId())) return state;
    } catch {}

    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason || new DOMException('请求已取消', 'AbortError');
      try {
        const state = await bridgeRequest('GET_PLAYER_STATE', {}, 500);
        if (state?.ready && (!state.video?.id || state.video?.id === getYouTubeVideoId())) return state;
      } catch {}
      await delay(100, signal);
    }
    throw new Error('YouTube 播放器初始化超时');
  }

  /**
   * 发现当前 YouTube 视频的可用字幕轨道
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void }} [options]
   * @returns {Promise<Array<import('../types/bse').SubtitleTrack>>}
   */
  async function discoverTracks({ signal, diagnostic } = {}) {
    await hydrateCapturedRequests();
    const state = await waitForPlayer(signal);
    const currentVideoId = getYouTubeVideoId();
    const rawTracks = (state.tracks || []).map((track) => ({
      id: track.id,
      lan: track.lan,
      lanDoc: track.lanDoc,
      subtitleUrl: track.subtitleUrl,
      isAuto: Boolean(track.isAuto),
      isCC: !track.isAuto,
      platform: BSE.PLATFORM.YOUTUBE
    }));

    const tracks = rawTracks.filter((track) => {
      if (!track.subtitleUrl) return false;
      try {
        const u = new URL(track.subtitleUrl, location.origin);
        const v = u.searchParams.get('v');
        if (v && currentVideoId && v !== currentVideoId) return false;
      } catch {}
      return true;
    });

    // 自动为非中文视频扩展生成 YouTube 原生「中文（自动翻译）」轨道
    const hasChineseTrack = tracks.some((t) => /zh|cn|chinese|中/i.test(t.lan || t.lanDoc || ''));
    if (!hasChineseTrack && tracks.length > 0) {
      const baseTrack = tracks.find((t) => t.isCC) || tracks[0];
      if (baseTrack && baseTrack.subtitleUrl) {
        try {
          const transUrl = new URL(baseTrack.subtitleUrl, location.origin);
          transUrl.searchParams.set('tlang', 'zh-Hans');
          tracks.push({
            id: `${baseTrack.id}:tlang:zh-Hans`,
            lan: 'zh-Hans',
            sourceLan: baseTrack.lan,
            lanDoc: `${baseTrack.lanDoc || baseTrack.lan} → 中文（自动翻译）`,
            subtitleUrl: transUrl.toString(),
            isAuto: true,
            isTranslated: true,
            tlang: 'zh-Hans',
            platform: BSE.PLATFORM.YOUTUBE
          });
        } catch {}
      }
    }

    diagnostic?.('查找字幕', `播放器返回 ${tracks.length} 条字幕轨道 (含自动翻译轨)`);
    return tracks;
  }

  function buildFormatUrl(baseUrl, format) {
    const url = new URL(baseUrl, location.origin);
    url.searchParams.set('fmt', format);
    return url.toString();
  }

  async function fetchYouTubeText(url, signal) {
    // 方案 1：优先通过扩展后台通道（Service Worker）拉取，彻底绕过页面 CSP 与 Service Worker 拦截
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const res = await new Promise((resolve, reject) => {
          let done = false;
          const onAbort = () => {
            if (!done) { done = true; reject(signal?.reason || new DOMException('请求已取消', 'AbortError')); }
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          chrome.runtime.sendMessage({ type: 'BSE_FETCH_YOUTUBE_RESOURCE', url })
            .then((r) => { if (!done) { done = true; signal?.removeEventListener('abort', onAbort); resolve(r); } })
            .catch((e) => { if (!done) { done = true; signal?.removeEventListener('abort', onAbort); reject(e); } });
        });
        if (res?.success && res.ok && res.text) {
          return { ok: true, status: res.status, text: res.text, via: 'background' };
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    // 方案 2：回退至前端页面直接 fetch
    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      cache: 'no-store',
      signal
    }, 4500);
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, via: 'direct' };
  }

  async function fetchAndParse(url, format, signal, diagnostic, stage) {
    try {
      const res = await fetchYouTubeText(url, signal);
      const text = res.text;
      const cues = res.ok ? BSE.Parsers.parse(text, format) : [];
      if (cues.length) {
        diagnostic?.(stage, `HTTP ${res.status} · ${res.via === 'background' ? '后台通道' : '直连'} · 成功解析 ${cues.length} 条字幕`);
      }
      return cues;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      diagnostic?.(stage, `请求失败：${error.message}`);
      return [];
    }
  }

  function extractTranscriptDom() {
    const container = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer, [target-id="engagement-panel-transcript"], #engagement-panel-transcript');
    if (!container) return [];
    const selectors = [
      'ytd-transcript-segment-renderer',
      'ytd-transcript-segment-view-model',
      '#segments-container [class*="transcript-segment"]'
    ];
    let nodes = [];
    for (const selector of selectors) {
      nodes = Array.from(container.querySelectorAll(selector));
      if (nodes.length) break;
    }
    const parseClock = (value) => {
      const match = String(value || '').trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
      return match ? Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
    };
    const cues = nodes.map((node) => {
      const timestamp = node.querySelector('.segment-timestamp, [class*="timestamp"]')?.textContent;
      const text = node.querySelector('.segment-text, [class*="segment-text"]')?.textContent;
      const lines = String(node.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const from = parseClock(timestamp || lines[0]);
      const content = String(text || (from == null ? '' : lines.slice(1).join(' '))).trim();
      return from == null || !content ? null : { from, to: from + 5, content };
    }).filter(Boolean);
    cues.forEach((cue, index) => {
      const next = cues[index + 1]?.from;
      if (Number.isFinite(next) && next > cue.from) cue.to = next;
    });
    return BSE.Parsers.normalize(cues);
  }

  async function transcriptFallback(signal, diagnostic) {
    let cues = extractTranscriptDom();
    if (cues.length) return cues;
    const panel = document.querySelector('ytd-watch-metadata, #panels, #secondary, ytd-watch-flexy');
    if (!panel) return [];
    const pattern = /show transcript|open transcript|显示转录|文字稿|转录内容/i;
    const button = Array.from(panel.querySelectorAll('button, tp-yt-paper-button'))
      .find((item) => pattern.test(`${item.getAttribute('aria-label') || ''} ${item.textContent || ''}`));
    if (!button) {
      diagnostic?.('转录面板', '未找到“显示转录内容”按钮');
      return [];
    }
    button.click();
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      await delay(150, signal);
      cues = extractTranscriptDom();
      if (cues.length) {
        diagnostic?.('转录面板', `从转录面板成功获取 ${cues.length} 条字幕`);
        return cues;
      }
    }
    return [];
  }

  /**
   * 加载指定 YouTube 轨道的字幕内容
   * @param {import('../types/bse').SubtitleTrack} track
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void }} [options]
   * @returns {Promise<Array<import('../types/bse').Cue>>}
   */
  async function loadTrack(track, { signal, diagnostic } = {}) {
    await hydrateCapturedRequests();
    const existingCaptures = matchingRequests(track);
    const isTrans = Boolean(track.isTranslated || track.tlang);

    // ==========================================
    // 方案 A：自动翻译轨（极速直通：先尝试 YouTube 服务端直译，次选源语言提取+机翻）
    // ==========================================
    if (isTrans) {
      diagnostic?.('提取策略', `【自动翻译轨】目标语言: ${track.lanDoc || track.lan} · 开启极速直通翻译引擎`);

      // 1. 若已有同 tlang 捕获请求，优先重放
      for (const captured of existingCaptures) {
        const cues = await fetchAndParse(captured.url, captured.fmt, signal, diagnostic, '原生翻译重放');
        if (cues.length) return cues;
      }

      // 2. 极速直链探测：YouTube 服务端自带高质量机翻，直接请求带 tlang 的字幕直链 (50ms ~ 200ms 直出)
      if (track.subtitleUrl) {
        const probeUrls = [
          { url: buildFormatUrl(track.subtitleUrl, 'json3'), fmt: 'json3' },
          { url: track.subtitleUrl, fmt: 'srv3' },
          { url: buildFormatUrl(track.subtitleUrl, 'vtt'), fmt: 'vtt' }
        ];
        try {
          const directCues = await Promise.any(
            probeUrls.map(({ url, fmt }) =>
              fetchAndParse(url, fmt, signal, diagnostic, `服务端直译探测(${fmt})`).then((res) => {
                if (res && res.length) return res;
                throw new Error('empty');
              })
            )
          );
          if (directCues && directCues.length) {
            diagnostic?.('服务端直译', `✓ 命中 YouTube 服务端秒级翻译通道，成功获取 ${directCues.length} 条中文字幕`);
            return directCues;
          }
        } catch {}
      }

      // 3. 兜底回退：提取源语言原生字幕，并完成全自动高质量机翻
      try {
        const state = await bridgeRequest('GET_PLAYER_STATE', {}, 1000).catch(() => null);
        const baseTrackId = track.id ? track.id.split(':tlang:')[0] : '';
        const baseRawTrack = (state?.tracks || []).find((t) => t.id === baseTrackId || (track.sourceLan && t.lan === track.sourceLan)) || state?.tracks?.[0];
        if (baseRawTrack) {
          const baseTrackObj = {
            id: baseRawTrack.id,
            lan: baseRawTrack.lan,
            lanDoc: baseRawTrack.lanDoc,
            subtitleUrl: baseRawTrack.subtitleUrl,
            isAuto: Boolean(baseRawTrack.isAuto),
            isCC: !baseRawTrack.isAuto,
            platform: BSE.PLATFORM.YOUTUBE
          };
          const baseCues = await loadTrack(baseTrackObj, { signal, diagnostic });
          if (baseCues && baseCues.length) {
            diagnostic?.('智能翻译', `已成功提取 ${baseCues.length} 条源语言字幕，正在进行全自动高质量中文翻译…`);
            const translatedCues = await BSE.Utils.translateCues(baseCues, track.tlang || track.lan || 'zh-Hans', signal);
            if (translatedCues.length) {
              diagnostic?.('智能翻译', `✓ 成功完成 ${translatedCues.length} 条中文字幕翻译并呈现`);
              return translatedCues;
            }
          }
        }
      } catch (transErr) {
        diagnostic?.('智能翻译', `机翻直通降级：${transErr.message}`);
      }

      // 4. 转录面板回退机翻
      const transcript = await transcriptFallback(signal, diagnostic);
      if (transcript.length) {
        diagnostic?.('智能翻译', `正在将转录面板提取的 ${transcript.length} 句字幕自动翻译为中文…`);
        const translated = await BSE.Utils.translateCues(transcript, track.tlang || track.lan || 'zh-Hans', signal);
        if (translated.length) return translated;
      }

      const error = new Error(`YouTube 字幕轨道 [${track.lanDoc || track.lan}] 翻译未获取到内容`);
      error.code = 'YOUTUBE_BODY_UNAVAILABLE';
      error.hint = '请检查网络或点击重新解析。';
      throw error;
    }

    // ==========================================
    // 方案 B：原生字幕轨（重放 -> 快速直链 -> 播放器切换 -> 拦截短轮询 -> 转录面板）
    // ==========================================
    diagnostic?.('提取策略', `【原生字幕轨】目标语言: ${track.lanDoc || track.lan} · 匹配到 ${existingCaptures.length} 条原生请求`);

    // 1. 优先重放已捕获的原生请求
    for (const captured of existingCaptures) {
      const cues = await fetchAndParse(captured.url, captured.fmt, signal, diagnostic, '原生请求重放');
      if (cues.length) return cues;
    }

    // 2. 极速直链探测 (0ms ~ 150ms 极速呈现，避免无谓阻塞等待播放器切换)
    if (track.subtitleUrl) {
      const probeUrls = [
        { url: buildFormatUrl(track.subtitleUrl, 'json3'), fmt: 'json3' },
        { url: track.subtitleUrl, fmt: 'srv3' },
        { url: buildFormatUrl(track.subtitleUrl, 'vtt'), fmt: 'vtt' }
      ];

      try {
        const directCues = await Promise.any(
          probeUrls.map(({ url, fmt }) =>
            fetchAndParse(url, fmt, signal, diagnostic, `直连探测(${fmt})`).then((res) => {
              if (res && res.length) return res;
              throw new Error('empty');
            })
          )
        );
        if (directCues && directCues.length) return directCues;
      } catch {}
    }

    // 3. 驱动播放器切换轨道触发原生拉取
    try {
      await bridgeRequest('SELECT_TRACK', track, 1500);
      diagnostic?.('播放器', `已请求切换到 ${track.lanDoc || track.lan} 轨道`);
    } catch (error) {
      diagnostic?.('播放器', `切换轨道提示：${error.message}`);
    }

    // 4. 短轮询等待新拦截请求 (最高 1.8s)
    const deadline = Date.now() + 1800;
    const triedUrls = new Set();
    while (Date.now() < deadline) {
      await hydrateCapturedRequests();
      const candidates = matchingRequests(track).filter((item) => !triedUrls.has(item.url));
      if (candidates.length) {
        for (const captured of candidates) {
          triedUrls.add(captured.url);
          const cues = await fetchAndParse(captured.url, captured.fmt, signal, diagnostic, '新拦截请求');
          if (cues.length) return cues;
        }
      }
      await delay(100, signal);
    }

    // 5. 转录面板回退
    const transcript = await transcriptFallback(signal, diagnostic);
    if (transcript.length) return transcript;

    const error = new Error(`YouTube 字幕轨道 [${track.lanDoc || track.lan}] 存在，但所有正文通道均未返回有效字幕`);
    error.code = 'YOUTUBE_BODY_UNAVAILABLE';
    error.hint = '先在播放器中开启一次该语言字幕；若仍失败，请复制诊断中各通道的 HTTP 状态。';
    throw error;
  }

  async function fetchMediaTree(targetId, { signal, diagnostic } = {}) {
    diagnostic?.('合集拓扑', '正在解析 YouTube 播放列表/合集拓扑…');
    let plData = null;

    // 1. 如果在页面内，通过 bridgeRequest 请求 GET_PLAYLIST
    try {
      plData = await bridgeRequest('GET_PLAYLIST', {}, 1500);
    } catch {}

    // 2. 检查活动标签页
    if (!plData || !plData.items || !plData.items.length) {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs?.length && tabs[0].url && tabs[0].url.includes('youtube.com')) {
            const tabResp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'BSE_GET_PLAYLIST' });
            if (tabResp?.playlist?.items?.length) {
              plData = tabResp.playlist;
            }
          }
        } catch {}
      }
    }

    if (!plData || !plData.items || !plData.items.length) {
      throw new Error('未在当前 YouTube 页面检测到可用播放列表或合集视频');
    }

    diagnostic?.('合集拓扑', `成功解析 YouTube 播放列表：共 ${plData.items.length} 个视频`);

    const parseDurationToSeconds = (durStr) => {
      const parts = String(durStr || '').trim().split(':').map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return 0;
    };

    const currentVideoId = getYouTubeVideoId();

    const items = plData.items.map((it, idx) => {
      const globalIndex = idx + 1;
      const durationSec = typeof it.duration === 'number' ? it.duration : parseDurationToSeconds(it.duration);
      return {
        globalIndex,
        bvid: it.id,
        videoId: it.id,
        cid: it.id,
        aid: it.id,
        title: it.title || `第 ${globalIndex} 节`,
        page: globalIndex,
        part: it.title || `第 ${globalIndex} 节`,
        duration: durationSec,
        sourceUrl: it.url,
        sectionKey: 'section_0',
        sectionTitle: plData.title || '播放列表'
      };
    });

    const episodes = items.map((it) => ({
      bvid: it.videoId,
      title: it.title,
      index: it.globalIndex,
      pagesCount: 1,
      items: [it]
    }));

    const sections = [{
      key: 'section_0',
      title: plData.title || '播放列表',
      items,
      episodes
    }];

    return {
      title: plData.title || 'YouTube 播放列表',
      kind: 'youtube_playlist',
      seasonId: plData.listId || targetId || '',
      currentBvid: currentVideoId,
      items,
      sections,
      hasNestedPages: false
    };
  }

  async function runBatchExport(tree, config, onProgress, taskControl = {}, { diagnostic } = {}) {
    const selectedIndices = config.customIndices instanceof Set ? config.customIndices : new Set(config.customIndices || []);
    const selectedItems = (tree.items || []).filter((item) => selectedIndices.has(item.globalIndex));

    if (!selectedItems.length) {
      throw new Error('未选择需要导出的视频条目');
    }

    const controlTask = taskControl || {};
    controlTask.cancelled = false;
    controlTask.paused = false;

    const stats = {
      total: selectedItems.length,
      completed: 0,
      success: 0,
      noSub: 0,
      failed: 0,
      packPercent: 0
    };

    const results = [];
    const report = (currentItem, phase = 'fetching') => {
      onProgress?.(stats, currentItem, phase, controlTask);
    };

    let itemQueue = [...selectedItems];
    const worker = async () => {
      while (itemQueue.length > 0) {
        if (controlTask.cancelled) break;
        while (controlTask.paused && !controlTask.cancelled) {
          await delay(200);
        }
        const item = itemQueue.shift();
        if (!item) break;

        report(item, 'fetching');
        diagnostic?.('批量抓取', `正在提取: [${item.globalIndex}/${tree.items.length}] ${item.title}`);

        let res = null;
        try {
          const ytUrl = item.sourceUrl || `https://www.youtube.com/watch?v=${item.videoId}`;
          let cues = null;
          let trackLabel = '字幕';

          // 1. 优先通过本机服务 Native Host fetchYouTubeCaptions (yt-dlp) 直取
          if (BSE.NativeHost?.fetchYouTubeCaptions) {
            try {
              const nativeRes = await BSE.NativeHost.fetchYouTubeCaptions({
                jobId: `batch-${item.videoId}-${Date.now()}`,
                sourceLanguage: 'auto',
                source: { kind: 'youtube', url: ytUrl }
              });
              if (nativeRes?.cues && nativeRes.cues.length > 0) {
                cues = nativeRes.cues;
                trackLabel = nativeRes.langDoc || nativeRes.language || '中文字幕';
              }
            } catch (nativeErr) {
              console.warn('[YouTube Batch] 本机服务提取失败:', nativeErr);
            }
          }

          if (cues && cues.length) {
            res = { status: 'success', item, body: cues, track: { label: trackLabel } };
            stats.success += 1;
          } else {
            res = { status: 'no_subtitle', item, reason: '该视频未检测到可用字幕' };
            stats.noSub += 1;
          }
        } catch (err) {
          res = { status: 'failed', item, reason: err.message || '抓取异常' };
          stats.failed += 1;
        }

        stats.completed += 1;
        results.push(res);
        report(item, 'fetching');
        await delay(100);
      }
    };

    const CONCURRENCY = Math.min(2, selectedItems.length);
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (controlTask.cancelled) {
      report(null, 'cancelled');
      return { selectedItems, results, stats, cancelled: true };
    }

    report(null, 'building');
    const manifest = BSE.Formatters.buildBatchManifest(tree, selectedItems, results, stats, config);

    if (config.outputMode === 'merged-md') {
      const text = BSE.Formatters.toMergedMarkdown(tree, results, stats, { withTimestamp: config.withTimestamp });
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      BSE.Utils.downloadBlob(blob, `${BSE.Utils.sanitizeFilename(tree.title)}_播放列表字幕.md`);
      diagnostic?.('批量完成', `已合并生成 Markdown 并下载 · 成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`);
    } else {
      const JSZipClass = globalThis.JSZip;
      if (!JSZipClass) throw new Error('JSZip 模块未加载');
      const zip = new JSZipClass();

      for (const res of results) {
        if (!res) continue;
        const baseName = `${String(res.item.globalIndex || 1).padStart(3, '0')}_${BSE.Utils.sanitizeFilename((res.item.title || '').trim() || '未命名')}`;

        if (res.status === 'success') {
          const content = BSE.Formatters.format(config.format || 'srt', res.body, {
            title: res.item.title,
            url: res.item.sourceUrl,
            platform: 'YouTube',
            language: res.track?.label || ''
          }, { withTimestamp: config.withTimestamp });
          zip.file(`${baseName}.${config.format || 'srt'}`, content);
        } else if (res.status === 'no_subtitle') {
          zip.file(`${baseName} (无字幕).txt`, `标题：${res.item.title}\nID：${res.item.videoId}\n链接：${res.item.sourceUrl}\n状态：未检测到可用字幕轨道\n`);
        } else if (res.status === 'failed') {
          zip.file(`${baseName} (下载失败).error.txt`, `标题：${res.item.title}\nID：${res.item.videoId}\n链接：${res.item.sourceUrl}\n原因：${res.reason || '网络或解析异常'}\n`);
        }
      }

      const readmeMd = BSE.Formatters.toMergedMarkdown(tree, results, stats, { withTimestamp: config.withTimestamp });
      zip.file('_README.md', readmeMd);
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      report(null, 'packing');
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        onProgress?.({ ...stats, packPercent: meta.percent }, null, 'packing', controlTask);
      });
      BSE.Utils.downloadBlob(blob, `${BSE.Utils.sanitizeFilename(tree.title)}_字幕.zip`);
      diagnostic?.('批量完成', `ZIP 压缩包打包完成并触发下载 · 成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`);
    }

    report(null, 'done');
    return { selectedItems, results, stats };
  }

  BSE.YouTube = Object.freeze({
    discoverTracks,
    loadTrack,
    rememberRequest,
    bridgeRequest,
    fetchMediaTree,
    runBatchExport
  });
})();
