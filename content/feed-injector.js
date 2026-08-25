/**
 * SparkSub Recommendation Feed & Video Card Injector
 * Injects "📥 转文字" action button onto Bilibili & YouTube video cards
 */
(() => {
  'use strict';

  const BSE = globalThis.BSE = globalThis.BSE || {};

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

  async function syncQueueState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET' });
        if (res?.ok && Array.isArray(res.queue)) {
          queueCache = new Map(res.queue.map((i) => [i.id, i]));
          updateAllButtons();
        }
      }
    } catch {}
  }

  function updateButtonState(btn, itemId) {
    const item = queueCache.get(itemId);
    if (!item) {
      btn.className = 'sparksub-feed-btn';
      btn.innerHTML = '📥 转文字';
      btn.title = '加入 SparkSub 后台转录队列 (无需打开视频)';
      return;
    }

    if (item.stage === 'done') {
      btn.className = 'sparksub-feed-btn is-done';
      btn.innerHTML = '✓ 已就绪';
      btn.title = `已提取 ${item.subtitle?.cueCount || 0} 句字幕 · 点击复制 Markdown`;
    } else if (item.stage === 'failed') {
      btn.className = 'sparksub-feed-btn is-failed';
      btn.innerHTML = '✕ 失败重试';
      btn.title = `转录失败：${item.error || '未知错误'} · 点击重试`;
    } else if (item.stage === 'queued') {
      btn.className = 'sparksub-feed-btn is-active';
      btn.innerHTML = '⏳ 排队中';
      btn.title = '正在后台排队中…';
    } else {
      btn.className = 'sparksub-feed-btn is-processing';
      btn.innerHTML = `⚡ 转录中 ${item.progress || 0}%`;
      btn.title = item.stageHint || '正在后台提取转录中…';
    }
  }

  function updateAllButtons() {
    const buttons = document.querySelectorAll('.sparksub-feed-btn');
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

      const currentItem = queueCache.get(itemId);
      if (currentItem?.stage === 'done' && (currentItem.subtitle?.markdown || currentItem.subtitle?.plainText)) {
        // One-click copy formatted markdown
        try {
          const textToCopy = currentItem.subtitle.markdown || currentItem.subtitle.plainText;
          await navigator.clipboard.writeText(textToCopy);
          showToast(`✓ 已复制《${currentItem.title}》转录字幕`);
          btn.innerHTML = '✓ 已复制';
          setTimeout(() => updateButtonState(btn, itemId), 1500);
        } catch {
          showToast('复制失败，请在侧边栏中查看');
        }
        return;
      }

      // Enqueue / retry
      btn.className = 'sparksub-feed-btn is-active';
      btn.innerHTML = '⏳ 排队中';

      try {
        let enqueued = false;
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'BSE_QUEUE_ENQUEUE',
            urls: targetUrl,
            options: { title, author, cover }
          });
          if (res?.ok) enqueued = true;
        } catch {}

        if (!enqueued && BSE.Queue?.addToQueue) {
          // Direct fallback via shared storage
          await BSE.Queue.addToQueue(targetUrl, { title, author, cover });
          enqueued = true;
        }

        if (enqueued) {
          showToast(`📥 已将《${title}》加入后台转录队列`);
          queueCache.set(itemId, { id: itemId, stage: 'queued', title, author, cover, progress: 0 });
          updateButtonState(btn, itemId);
          syncQueueState();
          // Trigger orchestrator notify
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
          }
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

  function scanBilibiliCards() {
    const cards = document.querySelectorAll('.bili-video-card, .feed-card, .bili-feed-card, .video-card, .small-item, .rank-item');
    cards.forEach((card) => {
      if (card.querySelector('.sparksub-feed-btn')) return;
      const link = card.querySelector('a[href*="/video/BV"]');
      if (!link) return;

      const bvMatch = link.href.match(/BV[a-zA-Z0-9]{10}/i);
      if (!bvMatch) return;
      const bvid = bvMatch[0];

      const coverContainer = card.querySelector('.bili-video-card__image, .bili-video-card__wrap, .pic-box, .cover-wrap, .img, .bili-video-card__image--wrap') || link;
      const titleElem = card.querySelector('.bili-video-card__info--tit, .title, a[title]');
      const title = titleElem?.getAttribute('title') || titleElem?.textContent?.trim() || `B站视频 (${bvid})`;
      const authorElem = card.querySelector('.bili-video-card__info--author, .up-name, .author, .name');
      const author = authorElem?.textContent?.trim() || 'UP主';
      const imgElem = card.querySelector('img');
      const cover = imgElem?.src || '';

      attachButtonToCard(coverContainer, link.href, title, author, cover, bvid);
    });
  }

  function scanYouTubeCards() {
    const cards = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, .ytLockupViewModelHost');
    cards.forEach((card) => {
      if (card.querySelector('.sparksub-feed-btn')) return;
      const link = card.querySelector('a.ytLockupViewModelContentImage, a#thumbnail[href*="/watch?v="], a[href*="/watch?v="], a[href*="/shorts/"]');
      if (!link) return;

      const match = link.href.match(/(?:watch\?.*v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (!match) return;
      const videoId = match[1];

      const coverContainer = card.querySelector('a.ytLockupViewModelContentImage, #thumbnail, ytd-thumbnail, .ytd-thumbnail, yt-thumbnail-view-model') || link;
      const titleElem = card.querySelector('.ytLockupMetadataViewModelTitle, #video-title, #video-title-link, [aria-label][title]');
      const title = titleElem?.getAttribute('title') || titleElem?.getAttribute('aria-label') || titleElem?.textContent?.trim() || `YouTube 视频 (${videoId})`;
      const authorElem = card.querySelector('.ytAttributedStringLinkCallToActionColor, ytd-channel-name, #channel-name, #text.ytd-channel-name');
      const author = authorElem?.textContent?.trim() || 'YouTube 频道';
      const imgElem = card.querySelector('img');
      const cover = imgElem?.src || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      attachButtonToCard(coverContainer, link.href, title, author, cover, videoId);
    });
  }

  function scanAllCards() {
    ensureFeedStyles();
    if (location.hostname.includes('bilibili.com')) {
      scanBilibiliCards();
    } else if (location.hostname.includes('youtube.com')) {
      scanYouTubeCards();
    }
  }

  // MutationObserver with 180ms throttling
  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (!scanTimer) {
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scanAllCards();
      }, 180);
    }
  });

  function init() {
    ensureFeedStyles();
    scanAllCards();
    syncQueueState();

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'BSE_QUEUE_UPDATED') {
          syncQueueState();
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes?.bse_transcription_queue_v1) {
          syncQueueState();
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
