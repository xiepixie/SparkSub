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
  function getYouTubeVideoId(url = location.href) {
    try {
      const parsed = new URL(url, location.origin);
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

  function getBvid(url = location.href) {
    return url.match(/\/video\/(BV[\w]+)/i)?.[1] || null;
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
          '#multi_page .cur-list li.on, .video-pod__list .active, .video-episode-card.active, .cur-list li.on, .bili-video-pod__item--active'
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

  function getMediaKey(platform = detectPlatform()) {
    if (platform === BSE.PLATFORM.YOUTUBE) {
      const videoId = getYouTubeVideoId();
      return videoId ? `yt:${videoId}` : null;
    }
    if (platform === BSE.PLATFORM.BILIBILI) {
      const bvid = getBvid();
      if (!bvid) return null;
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

  const SessionSnapshotManager = {
    getSnapshots() {
      try {
        const raw = sessionStorage.getItem(SESSION_SNAPSHOT_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
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
        list.unshift({
          mediaKey,
          title: data.title || '',
          tracks: (data.tracks || []).map((t) => ({
            id: t.id,
            language: t.language,
            label: t.label,
            isAuto: t.isAuto,
            isCC: t.isCC,
            subtitleUrl: t.subtitleUrl
          })),
          selectedTrackId: data.selectedTrackId,
          cues: data.cues || [],
          savedAt: Date.now()
        });
        if (list.length > MAX_SNAPSHOTS) list = list.slice(0, MAX_SNAPSHOTS);
        sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(list));
      } catch {}
    }
  };

  BSE.Utils = Object.freeze({
    detectPlatform,
    getYouTubeVideoId,
    getBvid,
    getBilibiliPage,
    getMediaKey,
    delay,
    fetchWithTimeout,
    formatClock,
    escapeHtml,
    sanitizeFilename,
    findActiveCueIndex,
    downloadText,
    downloadBlob,
    SessionSnapshotManager
  });
})();
