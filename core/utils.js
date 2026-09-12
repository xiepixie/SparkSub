(() => {
  'use strict';

  const BSE = globalThis.BSE;

  /**
   * 识别当前视频平台类型
   * @param {string} [hostname]
   * @returns {import('../types/bse').Platform | null}
   */
  function detectPlatform(hostname = location.hostname) {
    if (hostname.includes('youtube.com')) return BSE.PLATFORM.YOUTUBE;
    if (hostname.includes('bilibili.com')) return BSE.PLATFORM.BILIBILI;
    return null;
  }

  /**
   * 提取 YouTube 视频 ID
   * @param {string} [url]
   * @returns {string | null}
   */
  function getYouTubeVideoId(url = (typeof location !== 'undefined' ? location.href : '')) {
    if (!url) return null;
    try {
      const baseOrigin = typeof location !== 'undefined' && location.origin ? location.origin : 'https://www.youtube.com';
      const parsed = new URL(url, baseOrigin);
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) return parsed.pathname.slice(1) || null;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 提取 B 站视频 BV 号 (支持 /video/BV..., ?bvid=BV..., 或任意包含 BV 号的 URL)
   * @param {string} [url]
   * @returns {string | null}
   */
  function getBvid(url = location.href) {
    if (!url) return null;
    try {
      const parsed = new URL(url, location.origin);
      const queryBvid = parsed.searchParams.get('bvid');
      if (queryBvid && /^BV[a-zA-Z0-9]{10}$/i.test(queryBvid)) return queryBvid;
      const pathMatch = parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]{10})/i);
      if (pathMatch) return pathMatch[1];
    } catch {}
    const generalMatch = String(url).match(/(BV[a-zA-Z0-9]{10})/i);
    return generalMatch ? generalMatch[1] : null;
  }

  /**
   * 从页面 DOM (包括 BPX 播放器选集列表) 实时提取当前活跃项的 CID
   * @returns {string | null}
   */
  function getActiveCidFromDom() {
    try {
      if (typeof document === 'undefined') return null;
      const currentBvid = getBvid();
      const activeEl = /** @type {HTMLElement | null} */ (document.querySelector(
        '.bpx-player-ctrl-eplist-menu-item.bpx-state-active, ' +
        '.cur-list li.on, ' +
        '.bili-video-pod__item--active, ' +
        '.video-episode-card.active, ' +
        '#multi_page .cur-list li.on'
      ));
      if (!activeEl) return null;

      // 严防 SPA 页面跳转残留：若节点自身或链接包含 BVID，必须与当前视频一致
      if (currentBvid) {
        const link = activeEl.closest('a') || activeEl.querySelector('a');
        const href = link?.getAttribute('href') || link?.href || '';
        const linkBvid = getBvid(href);
        if (linkBvid && linkBvid.toLowerCase() !== currentBvid.toLowerCase()) {
          return null;
        }
      }

      const cid = activeEl.getAttribute('data-cid') || activeEl.dataset.cid || activeEl.getAttribute('cid');
      return cid ? String(cid).trim() : null;
    } catch {
      return null;
    }
  }

  function getActiveBilibiliPageFromDom() {
    try {
      if (typeof document === 'undefined') return null;
      const activeEl = /** @type {HTMLElement | null} */ (document.querySelector(
        '.bpx-player-ctrl-eplist-menu-item.bpx-state-active, ' +
        '#multi_page .cur-list li.on, ' +
        '.video-pod__list .active, ' +
        '.video-episode-card.active, ' +
        '.cur-list li.on, ' +
        '.bili-video-pod__item--active'
      ));
      if (!activeEl) return null;
      const pAttr = activeEl.dataset.page || activeEl.getAttribute('data-page') || activeEl.getAttribute('page');
      if (pAttr && Number(pAttr) > 0) return Number(pAttr);
      const siblings = Array.from(activeEl.parentElement?.children || []);
      const idx = siblings.indexOf(activeEl);
      return idx >= 0 ? idx + 1 : null;
    } catch {
      return null;
    }
  }

  function getBilibiliPage(url = location.href) {
    try {
      const parsed = new URL(url, location.origin);
      const pParam = parsed.searchParams.get('p');
      if (pParam && Number(pParam) > 0) return Number(pParam);
    } catch {}

    return getActiveBilibiliPageFromDom() || 1;
  }

  let lastKnownBilibiliCid = null;
  let lastKnownBilibiliBvid = null;
  let lastKnownBilibiliPage = null;

  /**
   * 将已经由 Bilibili 权威 metadata 解析出的 BVID + CID 回灌到页面运行时身份。
   *
   * 单 P 视频通常没有可供 DOM 探测的“当前分 P”节点，因此仅依赖
   * getActiveCidFromDom() 会让 mediaKey 永久停留在 bili:<BV>:p1。这里允许
   * discoverTracks/fetchMediaContext 在拿到 /x/web-interface/view 的确定结果后
   * 精炼身份，但仍要求它与此刻页面 URL/分 P 一致，避免 SPA 晚到响应串台。
   *
   * @param {{ bvid?: string, cid?: string | number, page?: number, pageCount?: number }} identity
   * @returns {string | null}
   */
  function rememberBilibiliMediaIdentity(identity = {}) {
    const bvid = String(identity.bvid || '').trim();
    const cid = String(identity.cid ?? '').trim();
    const page = Math.max(1, Number(identity.page) || 1);
    const pageCount = Math.max(0, Number(identity.pageCount) || 0);
    if (!/^BV[a-zA-Z0-9]+$/i.test(bvid) || !/^\d+$/.test(cid)) return null;

    if (typeof location !== 'undefined' && typeof document !== 'undefined') {
      const currentBvid = getBvid(location.href);
      if (!currentBvid || currentBvid.toLowerCase() !== bvid.toLowerCase()) return null;

      let explicitPage = 0;
      try {
        const parsed = new URL(location.href, location.origin || 'https://www.bilibili.com');
        const rawPage = parsed.searchParams.get('p');
        const value = Number(rawPage);
        if (rawPage && Number.isFinite(value) && value > 0) explicitPage = value;
      } catch {}

      if (explicitPage > 0) {
        if (explicitPage !== page) return null;
      } else if (!(pageCount === 1 && page === 1)) {
        // 对多 P 且 URL 没有显式 ?p=N 的页面仍要求 DOM 能真正证明当前页；
        // getBilibiliPage() 的默认 P1 不能作为证据，否则 SPA 切换期间会误收晚到的 P1 CID。
        const activePage = getActiveBilibiliPageFromDom();
        if (!activePage || activePage !== page) return null;
      }
    }

    lastKnownBilibiliBvid = bvid;
    lastKnownBilibiliPage = page;
    lastKnownBilibiliCid = cid;
    return `bili:${bvid}:cid${cid}`;
  }

  /**
   * 生成稳定媒体键。传入显式 URL 时只依据 URL 本身解析，避免 Service Worker
   * 或其他非页面上下文误用当前 document/location 的 DOM 状态。
   * @param {import('../types/bse').Platform | null} [platform]
   * @param {string} [url]
   * @returns {string | null}
   */
  function getMediaKey(platform = detectPlatform(), url = (typeof location !== 'undefined' ? location.href : '')) {
    if (platform === BSE.PLATFORM.YOUTUBE) {
      const videoId = getYouTubeVideoId(url);
      return videoId ? `yt:${videoId}` : null;
    }
    if (platform === BSE.PLATFORM.BILIBILI) {
      const bvid = getBvid(url);
      if (!bvid) return null;

      const hasCurrentDocument = typeof location !== 'undefined' && typeof document !== 'undefined';
      const isCurrentDocumentUrl = hasCurrentDocument && url === location.href;
      if (!isCurrentDocumentUrl) {
        return `bili:${bvid}:p${getBilibiliPage(url)}`;
      }

      const currentPage = getBilibiliPage(url);
      if (bvid !== lastKnownBilibiliBvid || currentPage !== lastKnownBilibiliPage) {
        lastKnownBilibiliBvid = bvid;
        lastKnownBilibiliPage = currentPage;
        lastKnownBilibiliCid = null;
      }
      const activeCid = getActiveCidFromDom();
      if (activeCid) {
        lastKnownBilibiliCid = activeCid;
      }
      if (lastKnownBilibiliCid) {
        return `bili:${bvid}:cid${lastKnownBilibiliCid}`;
      }
      return `bili:${bvid}:p${currentPage}`;
    }
    return null;
  }

  /**
   * 学习/复习产物的稳定归属键。它表达“用户眼中的同一条视频/分P”，
   * 不直接使用可能随页面探测阶段在 pN / cidN 之间变化的运行时 mediaKey。
   * URL 只用于提取稳定内容身份，不把时间点、播放列表或追踪参数带入缓存主键。
   * @param {import('../types/bse').Platform | null} [platform]
   * @param {string} [url]
   * @param {string} [mediaKey]
   * @returns {string | null}
   */
  function getArtifactKey(
    platform = (typeof location !== 'undefined' ? detectPlatform() : null),
    url = (typeof location !== 'undefined' ? location.href : ''),
    mediaKey = ''
  ) {
    const runtimeKey = String(mediaKey || '').trim();
    const youtubeId = getYouTubeVideoId(url) || runtimeKey.match(/^yt:([^:]+)$/i)?.[1] || '';
    if (platform === BSE.PLATFORM.YOUTUBE || youtubeId) {
      return youtubeId ? `yt:${youtubeId}` : (runtimeKey || null);
    }

    const runtimeBili = runtimeKey.match(/^bili:(BV[a-zA-Z0-9]+):(?:cid[^:]+|p(\d+))$/i);
    const urlBvid = getBvid(url);
    const bvid = urlBvid || runtimeBili?.[1] || '';
    if (platform === BSE.PLATFORM.BILIBILI || bvid) {
      if (!bvid) return runtimeKey || null;
      let page = Math.max(0, Number(runtimeBili?.[2]) || 0);
      if (urlBvid) {
        // Only an explicit ?p=N can override a page already encoded in the runtime/artifact key.
        // A Bilibili URL without p does not prove P1: some player navigations can keep the same URL
        // while the authoritative subtitle track already identifies another part.
        try {
          const parsed = new URL(url, 'https://www.bilibili.com');
          const rawPage = parsed.searchParams.get('p');
          const urlPage = Number(rawPage);
          if (rawPage && Number.isFinite(urlPage) && urlPage > 0) page = urlPage;
        } catch {}
      }
      return page > 0 ? `bili:${bvid}:p${page}` : null;
    }

    return runtimeKey || null;
  }

  function mediaStateMatchesUrl(candidateState, targetUrl) {
    if (!candidateState || !targetUrl) return false;
    const mediaKey = String(candidateState.mediaKey || '').trim();
    if (!mediaKey) return false;

    const targetYouTubeId = getYouTubeVideoId(targetUrl);
    if (targetYouTubeId) {
      if (mediaKey !== `yt:${targetYouTubeId}`) return false;
      const stateVideoId = candidateState.url ? getYouTubeVideoId(candidateState.url) : targetYouTubeId;
      return stateVideoId === targetYouTubeId;
    }

    const targetBvid = getBvid(targetUrl);
    if (targetBvid) {
      const isCurrentDocumentUrl = typeof location !== 'undefined'
        && typeof document !== 'undefined'
        && targetUrl === location.href;
      if (isCurrentDocumentUrl) {
        const liveMediaKey = getMediaKey(BSE.PLATFORM.BILIBILI, targetUrl);
        if (!liveMediaKey || mediaKey !== liveMediaKey) return false;
      }
      const mediaMatch = mediaKey.match(/^bili:(BV[a-zA-Z0-9]+):(?:cid[^:]+|p(\d+))$/i);
      if (!mediaMatch || mediaMatch[1].toLowerCase() !== targetBvid.toLowerCase()) return false;
      if (candidateState.url) {
        const stateBvid = getBvid(candidateState.url);
        if (!stateBvid || stateBvid.toLowerCase() !== targetBvid.toLowerCase()) return false;
        if (getBilibiliPage(candidateState.url) !== getBilibiliPage(targetUrl)) return false;
      }
      return true;
    }

    return false;
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (!signal) return;
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const upstream = options.signal;
    const abortFromUpstream = () => controller.abort(upstream?.reason);
    const timer = setTimeout(() => {
      controller.abort(new DOMException(`请求超时（${timeoutMs}ms）`, 'TimeoutError'));
    }, timeoutMs);

    if (upstream) {
      if (upstream.aborted) abortFromUpstream();
      else upstream.addEventListener('abort', abortFromUpstream, { once: true });
    }

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', abortFromUpstream);
    }
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeFilename(value) {
    return String(value || '字幕')
      .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '字幕';
  }

  function normalizeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('//')) return `https:${raw}`;
    return raw.replace(/^http:\/\//i, 'https://');
  }

  /**
   * 二分查找当前播放时间对应的字幕索引
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {number} time
   * @param {number} [previousIndex]
   * @returns {number}
   */
  function findActiveCueIndex(cues, time, previousIndex = -1) {
    if (!Array.isArray(cues) || !cues.length) return -1;
    const current = cues[previousIndex];
    if (current && time >= current.from && time < current.to) return previousIndex;

    let low = 0;
    let high = cues.length - 1;
    let candidate = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cues[mid].from <= time) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (candidate < 0) return -1;
    return time < cues[candidate].to ? candidate : -1;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFilename(filename);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    downloadBlob(blob, filename);
  }

  const SESSION_SNAPSHOT_KEY = 'bse_recent_snapshots';
  const MAX_SNAPSHOTS = 4;
  const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
  const SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function serializedByteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  const SessionSnapshotManager = {
    getSnapshots() {
      try {
        const raw = sessionStorage.getItem(SESSION_SNAPSHOT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const fresh = parsed.filter((item) => item?.savedAt && Date.now() - item.savedAt <= SNAPSHOT_MAX_AGE_MS);
        if (fresh.length !== parsed.length) sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(fresh));
        return fresh;
      } catch {
        try { sessionStorage.removeItem(SESSION_SNAPSHOT_KEY); } catch {}
        return [];
      }
    },
    findSnapshot(mediaKey) {
      if (!mediaKey) return null;
      const list = this.getSnapshots();
      return list.find((item) => item.mediaKey === mediaKey) || null;
    },
    deleteSnapshot(mediaKey) {
      if (!mediaKey) return;
      try {
        const list = this.getSnapshots().filter((item) => item.mediaKey !== mediaKey);
        sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(list));
      } catch {}
    },
    saveSnapshot(mediaKey, data) {
      if (!mediaKey || !data) return;
      try {
        let list = this.getSnapshots().filter((item) => item.mediaKey !== mediaKey);
        const snapshot = {
          mediaKey,
          title: data.title || '',
          tracks: (data.tracks || []).map((t) => ({
            id: t.id,
            lan: t.lan,
            lanDoc: t.lanDoc,
            isAuto: t.isAuto,
            isCC: t.isCC,
            platform: t.platform,
            bvid: t.bvid,
            cid: t.cid,
            page: t.page,
            part: t.part
          })),
          selectedTrackId: data.selectedTrackId,
          cues: data.cues || [],
          ...(data.mediaContext ? { mediaContext: data.mediaContext } : {}),
          savedAt: Date.now()
        };
        // Signed subtitle URLs are deliberately excluded. Oversized transcripts
        // stay in the in-memory LRU cache instead of exhausting sessionStorage.
        const snapshotSize = serializedByteLength(snapshot);
        if (snapshotSize > MAX_SNAPSHOT_BYTES) {
          sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(list));
          return;
        }
        const candidates = [snapshot, ...list].slice(0, MAX_SNAPSHOTS);
        const candidateSizes = candidates.map((item, index) => index === 0 ? snapshotSize : serializedByteLength(item));
        let totalBytes = 2 + candidateSizes.reduce((sum, bytes) => sum + bytes, 0) + Math.max(0, candidates.length - 1);
        while (candidates.length > 1 && totalBytes > MAX_SNAPSHOT_BYTES) {
          totalBytes -= candidateSizes.pop() || 0;
          totalBytes -= 1;
          candidates.pop();
        }
        sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(candidates));
      } catch {}
    }
  };

  /**
   * 判断指定或当前 URL 是否为真正的视频播放页（而非首页、推荐流或分区索引）
   * @param {string} [url]
   * @returns {boolean}
   */
  function isMatchingVideoUrl(url = (typeof location !== 'undefined' ? location.href : '')) {
    if (!url) return false;
    const isYouTube = /(^https?:\/\/)(www\.|m\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/i.test(url);
    if (isYouTube) return true;
    const isBili = /(^https?:\/\/)(www\.|m\.)?bilibili\.com\/(video|festival|blackboard|list|bangumi\/play|medialist\/play)/i.test(url)
      || (/(^https?:\/\/)(www\.|m\.)?bilibili\.com/i.test(url) && /[?&]bvid=BV/i.test(url));
    return isBili;
  }

  /**
   * 将字幕分段数组进行批量多语言机翻（基于 Google 官方客户端翻译接口）
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {string} [targetLang='zh-CN']
   * @param {AbortSignal} [signal]
   * @returns {Promise<Array<import('../types/bse').Cue>>}
   */
  async function translateCues(cues, targetLang = 'zh-CN', signal) {
    if (!Array.isArray(cues) || !cues.length) return [];
    const normLang = targetLang.toLowerCase().includes('zh') ? 'zh-CN' : targetLang;
    const lines = cues.map((c) => String(c.content || '').trim());
    const batchSize = 35;
    const translatedCues = [];

    for (let i = 0; i < lines.length; i += batchSize) {
      if (signal?.aborted) throw signal.reason || new DOMException('请求已取消', 'AbortError');
      const chunk = lines.slice(i, i + batchSize);
      const joined = chunk.join('\n');
      if (!joined.trim()) {
        for (let j = 0; j < chunk.length; j++) translatedCues.push(cues[i + j]);
        continue;
      }

      try {
        const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(normLang)}&q=${encodeURIComponent(joined)}`;
        const resp = await fetchWithTimeout(url, { signal }, 6000);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const text = (Array.isArray(data) && data[0] && typeof data[0][0] === 'string')
          ? data[0][0]
          : (typeof data === 'string' ? data : '');
        const translatedLines = text ? text.split('\n') : [];

        for (let j = 0; j < chunk.length; j++) {
          const origCue = cues[i + j];
          const transText = (translatedLines[j] || '').trim();
          translatedCues.push({
            from: origCue.from,
            to: origCue.to,
            content: transText || origCue.content
          });
        }
      } catch {
        for (let j = 0; j < chunk.length; j++) {
          translatedCues.push(cues[i + j]);
        }
      }
    }
    return translatedCues;
  }

  function hashText32(value, seed = 0x811c9dc5) {
    let hash = seed >>> 0;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function subtitleFingerprint(cues = []) {
    const list = Array.isArray(cues) ? cues : [];
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (const cue of list) {
      const from = Math.round((Number(cue?.from) || 0) * 1000);
      const to = Math.round((Number(cue?.to) || 0) * 1000);
      const content = String(cue?.content || '').replace(/\s+/g, ' ').trim();
      const chunk = `${from}|${to}|${content}\n`;
      hashA = hashText32(chunk, hashA);
      hashB = hashText32(chunk, hashB ^ 0x85ebca6b);
    }
    return `c${list.length}-${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
  }

  function buildSubtitlePatchToken(mediaKey, trackId, cues = [], knownFingerprint = '') {
    const fingerprint = String(knownFingerprint || '').trim() || subtitleFingerprint(cues);
    const owner = `${String(mediaKey || '').trim()}|${String(trackId || '').trim()}|${fingerprint}`;
    const hashA = hashText32(owner, 0x811c9dc5).toString(16).padStart(8, '0');
    const hashB = hashText32(owner, 0x27d4eb2d).toString(16).padStart(8, '0');
    return `SPC1-${hashA}${hashB}`;
  }

  const UNIFIED_CACHE_KEY_PREFIX = 'bse_sub_cache_';
  const UNIFIED_CORRECTION_KEY_PREFIX = 'bse_sub_corrections_';
  const UNIFIED_CACHE_INDEX_KEY = 'bse_sub_cache_index';
  const MAX_UNIFIED_CACHE_ITEMS = 60;
  const MAX_UNIFIED_CACHE_BYTES = 6_000_000;
  const MAX_UNIFIED_CACHE_RECORD_BYTES = 900_000;
  const MAX_UNIFIED_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  let unifiedCacheMutationTail = Promise.resolve();

  function serializeUnifiedCacheMutation(task) {
    const operation = unifiedCacheMutationTail.then(task, task);
    unifiedCacheMutationTail = operation.catch(() => {});
    return operation;
  }

  function hasCorrectionPatches(corrections) {
    if (!corrections || typeof corrections !== 'object') return false;
    return Object.values(corrections).some((entry) => Array.isArray(entry?.patches) && entry.patches.length > 0);
  }

  function buildUnifiedSubtitleRecord(mediaKey, payload) {
    const cleanKey = String(mediaKey || '').trim();
    const cues = Array.isArray(payload?.cues) ? payload.cues : [];
    const markdown = String(payload?.markdown || '');
    const plainText = String(payload?.plainText || '');
    if (!cleanKey || (!cues.length && !markdown && !plainText)) return null;
    return {
      mediaKey: cleanKey,
      title: payload?.title || '',
      author: payload?.author || '',
      trackId: String(payload?.trackId || '').slice(0, 256),
      trackSource: String(payload?.trackSource || payload?.source || '').slice(0, 64),
      language: payload?.language || payload?.lang || 'zh',
      langDoc: payload?.langDoc || '中文',
      cues,
      cueCount: Number(payload?.cueCount) || cues.length,
      // Plain text is deterministic from cues. Persist it only for text-only
      // legacy/migration records to avoid duplicating every subtitle body.
      plainText: cues.length ? '' : plainText,
      markdown,
      savedAt: Date.now()
    };
  }

  function applyCorrectionEntry(cues, entry) {
    const list = Array.isArray(cues) ? cues : [];
    const patches = Array.isArray(entry?.patches) ? entry.patches : [];
    if (!list.length || !patches.length) return { cues: list, appliedCount: 0, conflictCount: 0 };
    if (Number(entry.cueCount) !== list.length) {
      return { cues: list, appliedCount: 0, conflictCount: patches.length };
    }
    let result = list;
    let appliedCount = 0;
    let conflictCount = 0;
    for (const patch of patches) {
      const index = Number(patch?.index);
      const cue = list[index];
      if (!Number.isInteger(index) || index < 0 || index >= list.length || !cue) {
        conflictCount++;
        continue;
      }
      const currentContent = String(cue.content || '').replace(/\s+/g, ' ').trim();
      const originalContent = String(patch.originalContent || '').replace(/\s+/g, ' ').trim();
      const correctedContent = String(patch.content || '').replace(/\s+/g, ' ').trim();
      if (!correctedContent) {
        conflictCount++;
        continue;
      }
      if (currentContent === correctedContent) continue;
      const timeMatches = Math.abs((Number(cue.from) || 0) - (Number(patch.from) || 0)) <= 0.25
        && Math.abs((Number(cue.to) || 0) - (Number(patch.to) || 0)) <= 0.25;
      if (!timeMatches || currentContent !== originalContent) {
        conflictCount++;
        continue;
      }
      if (result === list) result = list.map((item) => ({ ...item }));
      result[index].content = correctedContent;
      appliedCount++;
    }
    return { cues: result, appliedCount, conflictCount };
  }

  function estimateUnifiedCacheBytes(record) {
    try {
      return new TextEncoder().encode(JSON.stringify(record)).length;
    } catch {
      return 0;
    }
  }

  function fitUnifiedCacheRecord(record) {
    if (!record) return null;
    let candidate = record;
    let bytes = estimateUnifiedCacheBytes(candidate);
    if (bytes <= MAX_UNIFIED_CACHE_RECORD_BYTES) return { record: candidate, bytes };

    // Markdown is a derived/export representation when cues are present. Drop
    // it before giving up on a useful cue cache entry.
    if (candidate.cues?.length && candidate.markdown) {
      candidate = { ...candidate, markdown: '' };
      bytes = estimateUnifiedCacheBytes(candidate);
    }
    if (bytes > MAX_UNIFIED_CACHE_RECORD_BYTES) return null;
    return { record: candidate, bytes };
  }

  async function normalizeUnifiedCacheIndex(rawIndex) {
    if (!Array.isArray(rawIndex) || !rawIndex.length) return [];
    const normalized = rawIndex.map((entry) => (
      typeof entry === 'string'
        ? { key: entry, bytes: 0, savedAt: 0, correctionSchema: 0 }
        : {
            key: String(entry?.key || ''),
            bytes: Math.max(0, Number(entry?.bytes) || 0),
            savedAt: Number(entry?.savedAt) || 0,
            correctionSchema: Math.max(0, Number(entry?.correctionSchema) || 0)
          }
    )).filter((entry) => entry.key);
    const unknown = normalized.filter((entry) => entry.bytes <= 0);
    if (!unknown.length) return normalized;

    // One-time upgrade from the old string-only index. Read existing records in
    // one batch so future writes can enforce a byte budget without rescanning.
    const stored = await chrome.storage.local.get(unknown.map((entry) => entry.key));
    unknown.forEach((entry) => {
      entry.bytes = estimateUnifiedCacheBytes(stored[entry.key]);
      entry.savedAt = Number(stored[entry.key]?.savedAt) || 0;
    });
    return normalized;
  }

  async function writeUnifiedSubtitleRecords(entries) {
    if (!Array.isArray(entries) || !entries.length || typeof chrome === 'undefined' || !chrome.storage?.local) return 0;
    const records = {};
    const freshEntries = [];
    // Subtitle bodies and proofreading overlays have separate persistence keys.
    // Existing records only need one compatibility read if their index predates
    // this split; after correctionSchema=1, normal body refreshes never read the
    // old large body just to preserve sparse user corrections.
    const indexSnapshot = await chrome.storage.local.get(UNIFIED_CACHE_INDEX_KEY);
    const previousIndex = await normalizeUnifiedCacheIndex(indexSnapshot[UNIFIED_CACHE_INDEX_KEY]);
    const previousByKey = new Map(previousIndex.map((entry) => [entry.key, entry]));
    const legacyCorrectionKeys = [];
    for (const entry of entries) {
      const mediaKey = String(entry?.mediaKey || '').trim();
      const recordKey = mediaKey ? UNIFIED_CACHE_KEY_PREFIX + mediaKey : '';
      const previous = previousByKey.get(recordKey);
      if (previous && previous.correctionSchema < 1) {
        legacyCorrectionKeys.push(correctionStorageKey(mediaKey));
      }
    }
    const legacyCorrectionStored = legacyCorrectionKeys.length
      ? await chrome.storage.local.get([...new Set(legacyCorrectionKeys)])
      : {};
    const legacyBodyKeys = [];
    for (const entry of entries) {
      const mediaKey = String(entry?.mediaKey || '').trim();
      const recordKey = mediaKey ? UNIFIED_CACHE_KEY_PREFIX + mediaKey : '';
      const previous = previousByKey.get(recordKey);
      const correctionRecord = legacyCorrectionStored?.[correctionStorageKey(mediaKey)];
      if (previous && previous.correctionSchema < 1 && Number(correctionRecord?.version || 0) < 1) {
        legacyBodyKeys.push(recordKey);
      }
    }
    const legacyBodyStored = legacyBodyKeys.length
      ? await chrome.storage.local.get([...new Set(legacyBodyKeys)])
      : {};

    for (const entry of entries) {
      const mediaKey = String(entry?.mediaKey || '').trim();
      const fitted = fitUnifiedCacheRecord(buildUnifiedSubtitleRecord(mediaKey, entry?.payload || {}));
      if (!fitted) continue;
      const recordKey = UNIFIED_CACHE_KEY_PREFIX + fitted.record.mediaKey;
      const previous = previousByKey.get(recordKey);
      if (previous && previous.correctionSchema < 1) {
        const correctionKey = correctionStorageKey(mediaKey);
        const corrections = mergeCorrectionMaps(
          legacyBodyStored?.[recordKey]?.corrections,
          legacyCorrectionStored?.[correctionKey]?.corrections
        );
        if (hasCorrectionPatches(corrections)) {
          records[correctionKey] = buildCorrectionRecord(mediaKey, corrections);
        }
      }
      records[recordKey] = fitted.record;
      freshEntries.push({ key: recordKey, bytes: fitted.bytes, savedAt: fitted.record.savedAt, correctionSchema: 1 });
    }
    if (!freshEntries.length) return 0;
    const freshSet = new Set(freshEntries.map((entry) => entry.key));
    const candidates = [...freshEntries, ...previousIndex.filter((entry) => !freshSet.has(entry.key))];
    const index = [];
    const evicted = [];
    let totalBytes = 0;
    for (const entry of candidates) {
      const bytes = Math.max(0, Number(entry.bytes) || 0);
      if (index.length >= MAX_UNIFIED_CACHE_ITEMS || totalBytes + bytes > MAX_UNIFIED_CACHE_BYTES) {
        evicted.push(entry.key);
        continue;
      }
      index.push(entry);
      totalBytes += bytes;
    }

    records[UNIFIED_CACHE_INDEX_KEY] = index;
    await chrome.storage.local.set(records);
    if (evicted.length) chrome.storage.local.remove([...new Set(evicted)]).catch(() => {});
    return freshEntries.length;
  }

  function correctionStorageKey(mediaKey) {
    const cleanKey = String(mediaKey || '').trim();
    return cleanKey ? UNIFIED_CORRECTION_KEY_PREFIX + cleanKey : '';
  }

  function mergeCorrectionMaps(...sources) {
    const merged = {};
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      for (const [trackId, entry] of Object.entries(source)) {
        if (!trackId || !Array.isArray(entry?.patches) || !entry.patches.length) continue;
        const current = merged[trackId];
        if (!current || Number(entry?.updatedAt || 0) >= Number(current?.updatedAt || 0)) {
          merged[trackId] = entry;
        }
      }
    }
    return merged;
  }

  function buildCorrectionRecord(mediaKey, corrections) {
    return {
      mediaKey: String(mediaKey || '').trim(),
      corrections,
      savedAt: Date.now(),
      version: 1
    };
  }

  async function readStoredCorrections(mediaKey) {
    const cleanMediaKey = String(mediaKey || '').trim();
    if (!cleanMediaKey || typeof chrome === 'undefined' || !chrome.storage?.local) return {};
    const bodyKey = UNIFIED_CACHE_KEY_PREFIX + cleanMediaKey;
    const correctionKey = correctionStorageKey(cleanMediaKey);
    const snapshot = await chrome.storage.local.get([UNIFIED_CACHE_INDEX_KEY, correctionKey]).catch(() => ({}));
    const correctionRecord = snapshot?.[correctionKey] || null;
    const rawIndex = Array.isArray(snapshot?.[UNIFIED_CACHE_INDEX_KEY]) ? snapshot[UNIFIED_CACHE_INDEX_KEY] : [];
    const rawEntry = rawIndex.find((entry) => (typeof entry === 'string' ? entry : entry?.key) === bodyKey);
    const correctionSchema = typeof rawEntry === 'object' ? Number(rawEntry?.correctionSchema || 0) : 0;
    if (Number(correctionRecord?.version || 0) >= 1 || correctionSchema >= 1) {
      return mergeCorrectionMaps(correctionRecord?.corrections);
    }

    // One-time compatibility path for records written before corrections were
    // split from the subtitle body. This is the only path allowed to read the
    // potentially large body merely to discover legacy proofreading patches.
    const legacySnapshot = await chrome.storage.local.get(bodyKey).catch(() => ({}));
    const legacyCorrections = legacySnapshot?.[bodyKey]?.corrections;
    const corrections = mergeCorrectionMaps(legacyCorrections, correctionRecord?.corrections);
    const updates = {};
    if (hasCorrectionPatches(corrections)) {
      updates[correctionKey] = buildCorrectionRecord(cleanMediaKey, corrections);
    }
    if (rawEntry && typeof rawEntry === 'object') {
      updates[UNIFIED_CACHE_INDEX_KEY] = rawIndex.map((entry) => (
        entry === rawEntry ? { ...entry, correctionSchema: 1 } : entry
      ));
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates).catch(() => {});
    return corrections;
  }

  const UnifiedSubtitleCache = {
    async get(mediaKey, options = {}) {
      const cleanKey = String(mediaKey || '').trim();
      if (!cleanKey || typeof chrome === 'undefined' || !chrome.storage?.local) return null;
      try {
        const result = await this.getMany([cleanKey], options);
        return result[cleanKey] || null;
      } catch {
        return null;
      }
    },
    async getMany(mediaKeys, { includePlainText = true, applyCorrections = true } = {}) {
      if (!Array.isArray(mediaKeys) || !mediaKeys.length || typeof chrome === 'undefined' || !chrome.storage?.local) return {};
      const cleanKeys = [...new Set(mediaKeys.map((key) => String(key || '').trim()).filter(Boolean))];
      if (!cleanKeys.length) return {};
      const storageKeys = cleanKeys.map((key) => UNIFIED_CACHE_KEY_PREFIX + key);
      const correctionKeys = cleanKeys.map((key) => correctionStorageKey(key));
      const stored = await chrome.storage.local.get([...storageKeys, ...correctionKeys]);
      const result = {};
      const expired = [];
      const correctionMigrations = {};
      for (let index = 0; index < cleanKeys.length; index++) {
        const mediaKey = cleanKeys[index];
        const storageKey = storageKeys[index];
        const correctionKey = correctionKeys[index];
        let data = stored[storageKey] || null;
        const correctionRecord = stored[correctionKey] || null;
        const legacyCorrections = data?.corrections && typeof data.corrections === 'object' ? data.corrections : {};
        const persistedCorrections = correctionRecord?.corrections && typeof correctionRecord.corrections === 'object'
          ? correctionRecord.corrections
          : {};
        const corrections = mergeCorrectionMaps(legacyCorrections, persistedCorrections);
        const needsCorrectionMigration = Object.entries(legacyCorrections).some(([trackId, entry]) => (
          Array.isArray(entry?.patches)
          && entry.patches.length > 0
          && (!persistedCorrections[trackId]
            || Number(persistedCorrections[trackId]?.updatedAt || 0) < Number(entry?.updatedAt || 0))
        ));
        if (needsCorrectionMigration) {
          correctionMigrations[correctionKey] = buildCorrectionRecord(mediaKey, corrections);
        }
        if (data?.savedAt && Date.now() - data.savedAt > MAX_UNIFIED_CACHE_AGE_MS) {
          expired.push(storageKey);
          data = null;
        }
        const hasCues = Array.isArray(data?.cues) && data.cues.length > 0;
        const hasBody = hasCues || Boolean(data?.markdown || data?.plainText);
        const hasCorrections = hasCorrectionPatches(corrections);
        if (!hasBody && !hasCorrections) continue;
        let resolvedCues = hasCues ? data.cues : [];
        if (applyCorrections && hasCues && data.trackId && corrections[data.trackId]) {
          resolvedCues = applyCorrectionEntry(data.cues, corrections[data.trackId]).cues;
        }
        const base = data || {
          mediaKey,
          title: '',
          author: '',
          trackId: '',
          trackSource: '',
          language: 'zh',
          langDoc: '中文',
          cues: [],
          cueCount: Math.max(0, ...Object.values(corrections).map((entry) => Number(entry?.cueCount) || 0)),
          plainText: '',
          markdown: '',
          savedAt: Number(correctionRecord?.savedAt) || 0
        };
        result[mediaKey] = hasCues
          ? {
              ...base,
              corrections,
              cues: resolvedCues,
              plainText: includePlainText ? resolvedCues.map((cue) => cue.content).join(' ') : ''
            }
          : { ...base, corrections };
      }
      if (expired.length) chrome.storage.local.remove(expired).catch(() => {});
      if (Object.keys(correctionMigrations).length) chrome.storage.local.set(correctionMigrations).catch(() => {});
      return result;
    },
    async set(mediaKey, payload) {
      return serializeUnifiedCacheMutation(async () => {
        try {
          return (await writeUnifiedSubtitleRecords([{ mediaKey, payload }])) > 0;
        } catch (err) {
          console.warn('[UnifiedSubtitleCache] Failed to cache subtitle:', err);
          return false;
        }
      });
    },
    async setMany(entries) {
      return serializeUnifiedCacheMutation(async () => {
        try {
          return await writeUnifiedSubtitleRecords(entries);
        } catch (err) {
          console.warn('[UnifiedSubtitleCache] Failed to cache subtitle batch:', err);
          return 0;
        }
      });
    },
    async recordCorrections(mediaKey, trackId, baseCues, patches, _payload = {}) {
      const cleanMediaKey = String(mediaKey || '').trim();
      const cleanTrackId = String(trackId || '').trim();
      const list = Array.isArray(baseCues) ? baseCues : [];
      if (!cleanMediaKey || !cleanTrackId || !list.length || !Array.isArray(patches) || !patches.length || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
      const correctionKey = correctionStorageKey(cleanMediaKey);
      const corrections = { ...(await readStoredCorrections(cleanMediaKey)) };
      const existingEntry = corrections[cleanTrackId] && typeof corrections[cleanTrackId] === 'object'
        ? corrections[cleanTrackId]
        : { trackId: cleanTrackId, cueCount: list.length, patches: [], updatedAt: 0 };
      const byIndex = new Map((Array.isArray(existingEntry.patches) ? existingEntry.patches : []).map((patch) => [Number(patch?.index), patch]));
      for (const patch of patches) {
        const index = Number(patch?.index);
        const content = String(patch?.content || '').replace(/\s+/g, ' ').trim();
        const cue = list[index];
        if (!Number.isInteger(index) || index < 0 || index >= list.length || !cue || !content) continue;
        const previous = byIndex.get(index);
        const originalContent = String(previous?.originalContent || cue.content || '').replace(/\s+/g, ' ').trim();
        if (!originalContent) continue;
        if (content === originalContent) {
          byIndex.delete(index);
          continue;
        }
        byIndex.set(index, {
          index,
          from: Number.isFinite(Number(previous?.from)) ? Number(previous.from) : Number(cue.from) || 0,
          to: Number.isFinite(Number(previous?.to)) ? Number(previous.to) : Number(cue.to) || 0,
          originalContent,
          content
        });
      }
      const nextPatches = [...byIndex.values()].sort((a, b) => a.index - b.index);
      if (nextPatches.length) {
        corrections[cleanTrackId] = {
          trackId: cleanTrackId,
          cueCount: list.length,
          patches: nextPatches,
          updatedAt: Date.now()
        };
      } else {
        delete corrections[cleanTrackId];
      }
      try {
        if (!hasCorrectionPatches(corrections)) {
          await chrome.storage.local.remove(correctionKey);
          return true;
        }
        await chrome.storage.local.set({ [correctionKey]: buildCorrectionRecord(cleanMediaKey, corrections) });
        return true;
      } catch (err) {
        console.warn('[UnifiedSubtitleCache] Failed to persist subtitle corrections:', err);
        return false;
      }
    },
    async remove(mediaKey) {
      const cleanMediaKey = String(mediaKey || '').trim();
      if (!cleanMediaKey || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
      return serializeUnifiedCacheMutation(async () => {
        try {
          const storageKey = UNIFIED_CACHE_KEY_PREFIX + cleanMediaKey;
          const stored = await chrome.storage.local.get(UNIFIED_CACHE_INDEX_KEY);
          const index = (await normalizeUnifiedCacheIndex(stored?.[UNIFIED_CACHE_INDEX_KEY]))
            .filter((entry) => entry.key !== storageKey);
          await chrome.storage.local.remove(storageKey);
          await chrome.storage.local.set({ [UNIFIED_CACHE_INDEX_KEY]: index });
          return true;
        } catch (err) {
          console.warn('[UnifiedSubtitleCache] Failed to remove subtitle cache:', err);
          return false;
        }
      });
    },
    async applyCorrections(mediaKey, trackId, cues, cachedRecord = null) {
      const cleanMediaKey = String(mediaKey || '').trim();
      const cleanTrackId = String(trackId || '').trim();
      const list = Array.isArray(cues) ? cues : [];
      if (!cleanMediaKey || !cleanTrackId || !list.length) return { cues: list, appliedCount: 0, conflictCount: 0 };
      let corrections = cachedRecord?.corrections;
      if (!corrections || typeof corrections !== 'object') {
        corrections = await readStoredCorrections(cleanMediaKey);
      }
      return applyCorrectionEntry(list, corrections?.[cleanTrackId]);
    }
  };

  BSE.Utils = Object.freeze({
    detectPlatform,
    isMatchingVideoUrl,
    getYouTubeVideoId,
    getBvid,
    getBilibiliPage,
    getActiveCidFromDom,
    rememberBilibiliMediaIdentity,
    getMediaKey,
    getArtifactKey,
    mediaStateMatchesUrl,
    delay,
    fetchWithTimeout,
    formatClock,
    escapeHtml,
    sanitizeFilename,
    normalizeImageUrl,
    subtitleFingerprint,
    buildSubtitlePatchToken,
    findActiveCueIndex,
    downloadText,
    downloadTextFile: downloadText,
    downloadBlob,
    translateCues,
    SessionSnapshotManager,
    UnifiedSubtitleCache
  });
})();
