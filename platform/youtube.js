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
    diagnostic?.('提取策略', isTrans
      ? `【自动翻译轨】目标语言: ${track.lanDoc || track.lan} (tlang: ${track.tlang || track.lan}) · 匹配到 ${existingCaptures.length} 条捕获翻译请求`
      : `【原生字幕轨】目标语言: ${track.lanDoc || track.lan} · 匹配到 ${existingCaptures.length} 条原生请求 (已隔离翻译轨)`);

    // 1. 优先重放已捕获的原生/翻译请求（最完整，带 session 与 pot）
    for (const captured of existingCaptures) {
      const cues = await fetchAndParse(captured.url, captured.fmt, signal, diagnostic, '原生请求重放');
      if (cues.length) return cues;
    }

    // 2. 并行探测快速直链 (json3 与 raw url)
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

    // 3. 驱动播放器切换轨道与翻译语言（触发原生带 PoToken 的官方字幕拉取）
    try {
      await bridgeRequest('SELECT_TRACK', track, 2000);
      diagnostic?.('播放器', `已请求切换到 ${track.lanDoc || track.lan} 轨道`);
    } catch (error) {
      diagnostic?.('播放器', `切换轨道提示：${error.message}`);
    }

    // 4. 短轮询等待新拦截请求 (最高 2.5s)
    const deadline = Date.now() + 2500;
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

  BSE.YouTube = Object.freeze({ discoverTracks, loadTrack, rememberRequest, bridgeRequest });
})();
