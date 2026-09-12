/**
 * SparkSub Recommendation Feed & Video Card Injector
 * Injects a transcript action button onto Bilibili & YouTube video cards
 */
(() => {
  'use strict';

  if (window.__BSE_FEED_INJECTOR_INSTALLED__) return;
  window.__BSE_FEED_INJECTOR_INSTALLED__ = true;

  // Inject feed styles once
  function ensureFeedStyles() {
    if (document.getElementById('sparksub-feed-styles')) return;
    const style = document.createElement('style');
    style.id = 'sparksub-feed-styles';
    style.textContent = `
      .sparksub-feed-btn {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 99999 !important;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #f3f4f6;
        border: 1px solid rgba(255, 255, 255, 0.22);
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        cursor: pointer;
        opacity: 0;
        pointer-events: auto !important;
        transition: opacity 0.2s ease, transform 0.15s ease, background 0.2s ease, border-color 0.2s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        user-select: none;
      }

      /* Hover or active state reveals button across all card types and sub-elements */
      .bili-video-card:hover .sparksub-feed-btn,
      .feed-card:hover .sparksub-feed-btn,
      .bili-feed-card:hover .sparksub-feed-btn,
      .video-card:hover .sparksub-feed-btn,
      .small-item:hover .sparksub-feed-btn,
      ytd-rich-item-renderer:hover .sparksub-feed-btn,
      ytd-video-renderer:hover .sparksub-feed-btn,
      ytd-grid-video-renderer:hover .sparksub-feed-btn,
      ytd-compact-video-renderer:hover .sparksub-feed-btn,
      ytd-reel-item-renderer:hover .sparksub-feed-btn,
      yt-lockup-view-model:hover .sparksub-feed-btn,
      .ytLockupViewModelHost:hover .sparksub-feed-btn,
      .ytLockupViewModelContentImage:hover .sparksub-feed-btn,
      yt-thumbnail-view-model:hover .sparksub-feed-btn,
      .ytThumbnailViewModelHost:hover .sparksub-feed-btn,
      #thumbnail:hover .sparksub-feed-btn,
      ytd-thumbnail:hover .sparksub-feed-btn,
      .sparksub-feed-btn:hover {
        opacity: 1 !important;
        visibility: visible !important;
      }

      /* Prevent touch feedback from stealing pointer/hover events from thumbnail */
      yt-touch-feedback-shape {
        pointer-events: none !important;
      }

      .sparksub-feed-btn:hover {
        background: rgba(0, 0, 0, 0.92) !important;
        border-color: rgba(0, 174, 236, 0.85) !important;
        transform: scale(1.05);
        color: #38bdf8 !important;
      }

      .sparksub-feed-btn.is-active,
      .sparksub-feed-btn.is-done,
      .sparksub-feed-btn.is-processing,
      .sparksub-feed-btn.is-failed {
        opacity: 0.95 !important;
      }

      .sparksub-feed-btn.is-failed {
        background: rgba(127, 29, 29, 0.85);
        border-color: rgba(248, 113, 113, 0.6);
        color: #fca5a5;
      }

      .sparksub-feed-btn.is-failed:hover {
        background: rgba(153, 27, 27, 0.95) !important;
        border-color: rgba(252, 165, 165, 0.85) !important;
        color: #fff !important;
      }

      .sparksub-feed-btn.is-processing {
        background: rgba(30, 58, 138, 0.75);
        border-color: rgba(96, 165, 250, 0.6);
        color: #93c5fd;
      }

      .sparksub-feed-btn.is-done {
        background: rgba(6, 78, 59, 0.78);
        border-color: rgba(52, 211, 153, 0.6);
        color: #6ee7b7;
      }

      .sparksub-feed-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(12px);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        animation: sparksubFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
      }

      @keyframes sparksubFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(message) {
    const existing = document.querySelector('.sparksub-feed-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'sparksub-feed-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  let queueCache = new Map();
  let queueAliasCache = new Map();
  let queueSyncPromise = null;
  let queueSyncFollowUpRequested = false;
  let queueSyncTimer = null;
  let lastObservedUrl = location.href;
  let videoRuntimeRequestTimer = null;

  function isVideoRuntimeUrl(url = location.href) {
    return /(^https?:\/\/)(www\.|m\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/i.test(url)
      || /(^https?:\/\/)(www\.|m\.)?bilibili\.com\/(video|festival|blackboard|list|bangumi\/play|medialist\/play)/i.test(url)
      || (/(^https?:\/\/)(www\.|m\.)?bilibili\.com/i.test(url) && /[?&]bvid=BV/i.test(url));
  }

  function isStaticBilibiliVideoPath(url = location.href) {
    return /(^https?:\/\/)(www\.|m\.)?bilibili\.com\/(video|festival|blackboard|list|bangumi\/play|medialist\/play)/i.test(url);
  }

  function requestVideoRuntime(url, delay = 40) {
    const supportedHost = location.hostname.includes('bilibili.com') || location.hostname.includes('youtube.com');
    if (!supportedHost || !isVideoRuntimeUrl(url) || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    if (videoRuntimeRequestTimer) clearTimeout(videoRuntimeRequestTimer);
    videoRuntimeRequestTimer = setTimeout(() => {
      videoRuntimeRequestTimer = null;
      chrome.runtime.sendMessage({ type: 'BSE_ENSURE_VIDEO_RUNTIME', url }).catch(() => {});
    }, delay);
  }

  function requestVideoRuntimeForRouteChange() {
    const nextUrl = location.href;
    if (nextUrl === lastObservedUrl) return;
    lastObservedUrl = nextUrl;
    // Feed/search pages stay lightweight. A same-document route into an actual
    // playback URL asks the worker to ensure the heavy video runtime once; the
    // worker pings the page first so watch-to-watch SPA navigation does not
    // reparse the runtime.
    requestVideoRuntime(nextUrl);
  }

  function replaceQueueCache(items) {
    const list = Array.isArray(items) ? items : [];
    queueCache = new Map();
    queueAliasCache = new Map();
    for (const item of list) {
      if (!item?.id) continue;
      queueCache.set(item.id, item);
      const aliases = [item.targetId, item.id];
      for (const alias of aliases) {
        const key = String(alias || '').trim();
        if (key && !queueAliasCache.has(key)) queueAliasCache.set(key, item);
      }
    }
  }

  async function performQueueSync() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET', hydrateText: false }).catch(() => null);
      if (res?.ok && Array.isArray(res.queue)) {
        replaceQueueCache(res.queue);
        updateAllButtons();
      }
    } catch {}
  }

  async function syncQueueState() {
    if (queueSyncPromise) {
      queueSyncFollowUpRequested = true;
      return queueSyncPromise;
    }
    queueSyncPromise = performQueueSync();
    try {
      await queueSyncPromise;
    } finally {
      queueSyncPromise = null;
      if (queueSyncFollowUpRequested) {
        queueSyncFollowUpRequested = false;
        scheduleQueueSync();
      }
    }
  }

  function scheduleQueueSync() {
    if (queueSyncTimer) clearTimeout(queueSyncTimer);
    queueSyncTimer = setTimeout(() => {
      queueSyncTimer = null;
      syncQueueState().catch(() => {});
    }, 35);
  }

  function findQueueItem(itemId) {
    if (!itemId) return null;
    const key = String(itemId);
    return queueCache.get(key) || queueAliasCache.get(key) || null;
  }

  async function loadQueueItemDetail(itemId) {
    const projection = findQueueItem(itemId);
    const canonicalId = String(projection?.id || itemId || '').trim();
    if (!canonicalId || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
    const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET_ITEM', id: canonicalId }).catch(() => null);
    return response?.ok && response.item ? response.item : null;
  }

  function applyQueueRuntimeUpdate(update) {
    const id = String(update?.id || '').trim();
    if (!id) return false;
    const existing = queueCache.get(id);
    if (!existing || String(existing.stage || '') !== String(update.stage || '')) return false;
    const merged = { ...existing, ...update };
    queueCache.set(id, merged);
    for (const [alias, item] of queueAliasCache) {
      if (item?.id === id) queueAliasCache.set(alias, merged);
    }
    updateButtonsForQueueItem(merged);
    return true;
  }

  function updateButtonState(btn, itemId) {
    const item = findQueueItem(itemId);
    if (!item) {
      btn.className = 'sparksub-feed-btn';
      btn.textContent = '转文字';
      btn.title = '加入 SparkSub 后台转录队列 (无需打开视频)';
      return;
    }

    if (item.stage === 'done') {
      btn.className = 'sparksub-feed-btn is-done';
      btn.textContent = '已就绪';
      btn.title = `已提取 ${item.subtitle?.cueCount || 0} 句字幕 · 点击复制 Markdown`;
    } else if (item.stage === 'failed') {
      btn.className = 'sparksub-feed-btn is-failed';
      btn.textContent = '失败重试';
      btn.title = `转录失败：${item.error || '未知错误'} · 点击重试`;
    } else if (item.stage === 'queued') {
      btn.className = 'sparksub-feed-btn is-active';
      btn.textContent = '排队中';
      btn.title = '正在后台排队中…';
    } else {
      btn.className = 'sparksub-feed-btn is-processing';
      btn.textContent = `转录中 ${item.progress || 0}%`;
      btn.title = item.stageHint || '正在后台提取转录中…';
    }
  }

  function updateButtonsForQueueItem(item) {
    const aliases = [...new Set([item?.id, item?.targetId].map((value) => String(value || '').trim()).filter(Boolean))];
    if (!aliases.length) return;
    const selector = aliases
      .map((alias) => `button.sparksub-feed-btn[data-item-id="${CSS.escape(alias)}"]`)
      .join(',');
    const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll(selector));
    buttons.forEach((btn) => {
      const itemId = btn.dataset.itemId;
      if (itemId) updateButtonState(btn, itemId);
    });
  }

  function updateAllButtons() {
    const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button.sparksub-feed-btn'));
    buttons.forEach((btn) => {
      const itemId = btn.dataset.itemId;
      if (itemId) updateButtonState(btn, itemId);
    });
  }

  function attachButtonToCard(coverContainer, targetUrl, title, author, cover, itemId) {
    if (coverContainer.querySelector('.sparksub-feed-btn')) return;

    // Ensure relative positioning and higher stacking context
    const compStyle = window.getComputedStyle(coverContainer);
    if (compStyle.position === 'static') {
      coverContainer.style.position = 'relative';
    }
    if (!coverContainer.style.zIndex || compStyle.zIndex === 'auto' || compStyle.zIndex === '0') {
      coverContainer.style.zIndex = '2';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sparksub-feed-btn';
    btn.dataset.itemId = itemId;
    btn.dataset.targetUrl = targetUrl;
    updateButtonState(btn, itemId);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentItem = findQueueItem(itemId);
      if (currentItem?.stage === 'done' && Number(currentItem.subtitle?.cueCount || 0) > 0) {
        // Queue cards cache metadata only. Fetch the one canonical item only after
        // the user explicitly clicks the completed feed action.
        try {
          const detail = await loadQueueItemDetail(itemId);
          const textToCopy = detail?.subtitle?.markdown
            || detail?.subtitle?.plainText
            || (Array.isArray(detail?.subtitle?.cues)
              ? detail.subtitle.cues.map((cue) => String(cue?.content || '').trim()).filter(Boolean).join('\n')
              : '');
          if (!textToCopy) throw new Error('empty transcript');
          await navigator.clipboard.writeText(textToCopy);
          showToast(`已复制《${detail?.title || currentItem.title}》转录字幕`);
          btn.textContent = '已复制';
          setTimeout(() => updateButtonState(btn, itemId), 1500);
        } catch {
          showToast('复制失败，请在侧边栏中查看');
        }
        return;
      }

      // Enqueue / retry
      btn.className = 'sparksub-feed-btn is-active';
      btn.textContent = '排队中';

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'BSE_QUEUE_ENQUEUE',
          urls: targetUrl,
          options: { title, author, cover }
        }).catch(() => null);
        const enqueued = Boolean(res?.ok);
        const returnedItem = res?.items?.[0] || null;

        if (enqueued) {
          if (returnedItem?.stage === 'done') {
            queueCache.set(returnedItem.id || itemId, returnedItem);
            queueAliasCache.set(String(returnedItem.targetId || itemId), returnedItem);
            updateButtonState(btn, itemId);
            showToast(`《${title}》字幕已就绪`);
          } else {
            showToast(`已将《${title}》加入后台转录队列`);
            const queuedItem = returnedItem || { id: itemId, targetId: itemId, stage: 'queued', title, author, cover, progress: 0 };
            queueCache.set(queuedItem.id || itemId, queuedItem);
            queueAliasCache.set(String(queuedItem.targetId || itemId), queuedItem);
            updateButtonState(btn, itemId);
          }
          syncQueueState();
        } else {
          throw new Error('未能加入转录队列');
        }
      } catch (err) {
        showToast('加入队列失败');
        updateButtonState(btn, itemId);
      }
    });

    coverContainer.appendChild(btn);
  }

  const BILIBILI_CARD_SELECTOR = '.bili-video-card, .feed-card, .bili-feed-card, .video-card, .small-item, .rank-item, .video-list-item, .bili-grid .bili-video-card';
  const YOUTUBE_CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, .ytLockupViewModelHost';

  /**
   * 收集一个变更节点自身、其最近卡片祖先和内部新卡片，避免每次 DOM 变化都扫描整页。
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {Element[]}
   */
  function collectAffectedCards(root, selector) {
    const cards = new Set();
    if (root instanceof Element) {
      if (root.matches(selector)) cards.add(root);
      const owner = root.closest(selector);
      if (owner) cards.add(owner);
    }
    root.querySelectorAll?.(selector).forEach((card) => cards.add(card));
    return [...cards];
  }

  function scanBilibiliCards(root = document) {
    const cards = collectAffectedCards(root, BILIBILI_CARD_SELECTOR);
    cards.forEach((card) => {
      if (card.querySelector('.sparksub-feed-btn')) return;
      const link = /** @type {HTMLAnchorElement | null} */ (card.querySelector('a[href*="/video/BV"], a[href*="bilibili.com/video/"], a[href*="BV"]'));
      if (!link) return;

      const bvMatch = (link.href || '').match(/BV[a-zA-Z0-9]{10}/i);
      if (!bvMatch) return;
      const bvid = bvMatch[0];

      const coverContainer = card.querySelector('.bili-video-card__image--wrap, .bili-video-card__image, .bili-video-card__wrap, .pic-box, .cover-wrap, .img') || link;
      const titleElem = card.querySelector('.bili-video-card__info--tit, .title, a[title], h3');
      const title = titleElem?.getAttribute('title') || titleElem?.textContent?.trim() || `B站视频 (${bvid})`;
      const authorElem = card.querySelector('.bili-video-card__info--author, .up-name, .author, .name, .bili-video-card__info--owner');
      const author = authorElem?.textContent?.trim() || 'UP主';
      const imgElem = /** @type {HTMLImageElement | null} */ (card.querySelector('img'));
      const cover = imgElem?.src || '';

      attachButtonToCard(coverContainer, link.href, title, author, cover, bvid);
    });
  }

  function scanYouTubeCards(root = document) {
    const cards = collectAffectedCards(root, YOUTUBE_CARD_SELECTOR);
    cards.forEach((card) => {
      if (card.querySelector('.sparksub-feed-btn')) return;
      const link = /** @type {HTMLAnchorElement | null} */ (card.querySelector('a.ytLockupViewModelContentImage, a#thumbnail[href*="/watch?v="], a[href*="/watch?v="], a[href*="/shorts/"]'));
      if (!link) return;

      const match = link.href.match(/(?:watch\?.*v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (!match) return;
      const videoId = match[1];

      const coverContainer = card.querySelector('a.ytLockupViewModelContentImage, #thumbnail, ytd-thumbnail, .ytd-thumbnail, yt-thumbnail-view-model') || link;
      const titleElem = card.querySelector('.ytLockupMetadataViewModelTitle, #video-title, #video-title-link, [aria-label][title]');
      const title = titleElem?.getAttribute('title') || titleElem?.getAttribute('aria-label') || titleElem?.textContent?.trim() || `YouTube 视频 (${videoId})`;
      const authorElem = card.querySelector('.ytAttributedStringLinkCallToActionColor, ytd-channel-name, #channel-name, #text.ytd-channel-name');
      const author = authorElem?.textContent?.trim() || 'YouTube 频道';
      const imgElem = /** @type {HTMLImageElement | null} */ (card.querySelector('img'));
      const cover = imgElem?.src || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      attachButtonToCard(coverContainer, link.href, title, author, cover, videoId);
    });
  }

  function scanAllCards(root = document) {
    ensureFeedStyles();
    if (location.hostname.includes('bilibili.com')) {
      scanBilibiliCards(root);
    } else if (location.hostname.includes('youtube.com')) {
      scanYouTubeCards(root);
    }
  }

  const pendingScanRoots = new Set();
  let scanTimer = null;
  function scheduleCardScan(root) {
    if (root instanceof Element) pendingScanRoots.add(root);
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const roots = [...pendingScanRoots];
      pendingScanRoots.clear();
      // Mutation bursts can contain hundreds of tiny nodes. In that case one full
      // scan is cheaper than hundreds of overlapping subtree queries.
      if (roots.length > 40) {
        scanAllCards(document);
        return;
      }
      roots.forEach((scanRoot) => scanAllCards(scanRoot));
    }, 80);
  }

  const observer = new MutationObserver((records) => {
    requestVideoRuntimeForRouteChange();
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) scheduleCardScan(node);
      });
    }
  });

  function init() {
    ensureFeedStyles();
    scanAllCards();
    syncQueueState();
    // YouTube video routes are lazy by design to keep home/search cheap.
    // Query-only Bilibili playback URLs are not covered by the heavy static
    // manifest match, so they use the same on-demand seam on first load.
    const needsInitialRuntime = location.hostname.includes('youtube.com')
      ? isVideoRuntimeUrl(location.href)
      : (location.hostname.includes('bilibili.com') && isVideoRuntimeUrl(location.href) && !isStaticBilibiliVideoPath(location.href));
    if (needsInitialRuntime) requestVideoRuntime(location.href, 0);

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
    window.addEventListener('popstate', requestVideoRuntimeForRouteChange, { passive: true });
    window.addEventListener('yt-navigate-finish', requestVideoRuntimeForRouteChange, { passive: true });

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'BSE_QUEUE_UPDATED') {
          if (!applyQueueRuntimeUpdate(message.item)) scheduleQueueSync();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
