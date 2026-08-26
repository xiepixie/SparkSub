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
      const activeEl = document.querySelector(
        '.bpx-player-ctrl-eplist-menu-item.bpx-state-active, ' +
        '.cur-list li.on, ' +
        '.bili-video-pod__item--active, ' +
        '.video-episode-card.active, ' +
        '#multi_page .cur-list li.on'
      );
      if (!activeEl) return null;
      const cid = activeEl.getAttribute('data-cid') || activeEl.dataset.cid || activeEl.getAttribute('cid');
      return cid ? String(cid).trim() : null;
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

    try {
      if (typeof document !== 'undefined') {
        const activeEl = document.querySelector(
          '.bpx-player-ctrl-eplist-menu-item.bpx-state-active, ' +
          '#multi_page .cur-list li.on, ' +
          '.video-pod__list .active, ' +
          '.video-episode-card.active, ' +
          '.cur-list li.on, ' +
          '.bili-video-pod__item--active'
        );
        if (activeEl) {
          const pAttr = activeEl.dataset.page || activeEl.getAttribute('data-page') || activeEl.getAttribute('page');
          if (pAttr && Number(pAttr) > 0) return Number(pAttr);
          const siblings = Array.from(activeEl.parentElement?.children || []);
          const idx = siblings.indexOf(activeEl);
          if (idx >= 0) return idx + 1;
        }
      }
    } catch {}

    return 1;
  }

  let lastKnownBilibiliCid = null;
  let lastKnownBilibiliBvid = null;

  function getMediaKey(platform = detectPlatform()) {
    if (platform === BSE.PLATFORM.YOUTUBE) {
      const videoId = getYouTubeVideoId();
      return videoId ? `yt:${videoId}` : null;
    }
    if (platform === BSE.PLATFORM.BILIBILI) {
      const bvid = getBvid();
      if (!bvid) return null;
      if (bvid !== lastKnownBilibiliBvid) {
        lastKnownBilibiliBvid = bvid;
        lastKnownBilibiliCid = null;
      }
      const activeCid = getActiveCidFromDom();
      if (activeCid) {
        lastKnownBilibiliCid = activeCid;
      }
      if (lastKnownBilibiliCid) {
        return `bili:${bvid}:cid${lastKnownBilibiliCid}`;
      }
      const page = getBilibiliPage();
      return `bili:${bvid}:p${page}`;
    }
    return null;
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

  function snapshotBytes(value) {
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
            isCC: t.isCC
          })),
          selectedTrackId: data.selectedTrackId,
          cues: data.cues || [],
          savedAt: Date.now()
        };
        // Signed subtitle URLs are deliberately excluded. Oversized transcripts
        // stay in the in-memory LRU cache instead of exhausting sessionStorage.
        if (snapshotBytes(snapshot) > MAX_SNAPSHOT_BYTES) {
          sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(list));
          return;
        }
        list.unshift(snapshot);
        if (list.length > MAX_SNAPSHOTS) list = list.slice(0, MAX_SNAPSHOTS);
        while (list.length && snapshotBytes(list) > MAX_SNAPSHOT_BYTES) list.pop();
        sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(list));
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

  BSE.Utils = Object.freeze({
    detectPlatform,
    isMatchingVideoUrl,
    getYouTubeVideoId,
    getBvid,
    getBilibiliPage,
    getActiveCidFromDom,
    getMediaKey,
    delay,
    fetchWithTimeout,
    formatClock,
    escapeHtml,
    sanitizeFilename,
    findActiveCueIndex,
    downloadText,
    downloadBlob,
    translateCues,
    SessionSnapshotManager
  });
})();
