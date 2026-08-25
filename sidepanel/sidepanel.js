(() => {
  'use strict';

  const BSE = globalThis.BSE;
  /** @type {import('../types/bse').AppState | null} */
  let state = null;
  let activeTabId = null;
  let activeIndex = -1;
  let following = true;
  let currentTab = 'timestamp';
  let query = '';
  let autoResumeTimer = null;
  const AUTO_RESUME_DELAY = 4000;

  // Batch Export state
  let currentTree = null;
  let batchControlTask = null;

  const elements = {
    title: document.querySelector('#video-title'),
    statusDot: document.querySelector('#status-dot'),
    statusText: document.querySelector('#status-text'),
    refresh: document.querySelector('#refresh-button'),
    track: document.querySelector('#track-select'),
    settingsToggle: document.querySelector('#settings-toggle'),
    settingsDrawer: document.querySelector('#settings-drawer'),
    settingsTitle: document.querySelector('#settings-title'),
    labelTheme: document.querySelector('#label-theme'),
    labelLang: document.querySelector('#label-lang'),
    labelPref: document.querySelector('#label-pref'),
    labelSize: document.querySelector('#label-size'),
    themeSelect: document.querySelector('#theme-select'),
    langSelect: document.querySelector('#lang-select'),
    prefSelect: document.querySelector('#pref-select'),
    sizeSelect: document.querySelector('#size-select'),
    cueCount: document.querySelector('#cue-count'),
    duration: document.querySelector('#duration'),
    characterCount: document.querySelector('#character-count'),
    tabTimestamp: document.querySelector('#tab-timestamp'),
    tabPlain: document.querySelector('#tab-plain'),
    tabAi: document.querySelector('#tab-ai'),
    tabsBar: document.querySelector('.tabs-bar'),
    search: document.querySelector('#search-input'),
    searchCount: document.querySelector('#search-count'),
    searchPrev: document.querySelector('#search-prev'),
    searchNext: document.querySelector('#search-next'),
    follow: document.querySelector('#follow-button'),
    followText: document.querySelector('#follow-text'),
    copy: document.querySelector('#copy-button'),
    copyText: document.querySelector('#copy-text'),
    format: document.querySelector('#format-select'),
    download: document.querySelector('#download-button'),
    exportText: document.querySelector('#export-text'),
    batchButton: document.querySelector('#batch-button'),
    batchBtnText: document.querySelector('#batch-btn-text'),
    transcript: document.querySelector('#transcript'),
    aiSection: document.querySelector('#ai-section'),
    aiTitle: document.querySelector('#ai-title'),
    aiCardSummary: document.querySelector('#ai-card-summary'),
    aiCardKeypoints: document.querySelector('#ai-card-keypoints'),
    aiCardNotes: document.querySelector('#ai-card-notes'),
    aiCardQuestions: document.querySelector('#ai-card-questions'),
    empty: document.querySelector('#empty-state'),
    emptyMessage: document.querySelector('#empty-message'),
    diagnosticsPanel: document.querySelector('#diagnostics'),
    diagTitle: document.querySelector('#diag-title'),
    diagnosticSummary: document.querySelector('#diagnostic-summary'),
    diagAlert: document.querySelector('#diag-alert'),
    diagnosticCode: document.querySelector('#diagnostic-code'),
    diagnosticHint: document.querySelector('#diagnostic-hint'),
    diagnostics: document.querySelector('#diagnostic-text'),
    copyDiagnostic: document.querySelector('#copy-diagnostic-button'),
    toast: document.querySelector('#toast'),
    prefSelect: document.querySelector('#pref-select'),
    // Batch Modal Elements
    batchOverlay: document.querySelector('#batch-overlay'),
    batchModalTitle: document.querySelector('#batch-modal-title'),
    batchTypePill: document.querySelector('#batch-type-pill'),
    batchCloseBtn: document.querySelector('#batch-close-btn'),
    batchSelectedSummary: document.querySelector('#batch-selected-summary'),
    batchTreeList: document.querySelector('#batch-tree-list'),
    batchTreeSelectedSummary: document.querySelector('#batch-tree-selected-summary'),
    batchTreeBtnAll: document.querySelector('#batch-tree-btn-all'),
    batchTreeBtnCur: document.querySelector('#batch-tree-btn-cur'),
    batchTreeBtnNone: document.querySelector('#batch-tree-btn-none'),
    batchTreeBtnInvert: document.querySelector('#batch-tree-btn-invert'),
    batchQuickStart: document.querySelector('#batch-quick-start'),
    batchQuickEnd: document.querySelector('#batch-quick-end'),
    batchQuickApplyBtn: document.querySelector('#batch-quick-apply-btn'),
    batchFormatRow: document.querySelector('#batch-format-row'),
    batchTimestampRow: document.querySelector('#batch-timestamp-row'),
    batchProgressBox: document.querySelector('#batch-progress-box'),
    batchProgressText: document.querySelector('#batch-progress-text'),
    batchProgressPercent: document.querySelector('#batch-progress-percent'),
    batchProgressBarFill: document.querySelector('#batch-progress-bar-fill'),
    batchCntSuccess: document.querySelector('#batch-cnt-success'),
    batchCntNosub: document.querySelector('#batch-cnt-nosub'),
    batchCntFailed: document.querySelector('#batch-cnt-failed'),
    batchStartBtn: document.querySelector('#batch-start-btn'),
    batchPauseBtn: document.querySelector('#batch-pause-btn'),
    batchCancelBtn: document.querySelector('#batch-cancel-btn'),
    // Tracker & Subscriptions Elements
    tabTracker: document.querySelector('#tab-tracker'),
    trackerUnreadBadge: document.querySelector('#tracker-unread-badge'),
    trackerSection: document.querySelector('#tracker-section'),
    trackerQuickBar: document.querySelector('#tracker-quick-bar'),
    trackerCurrentSource: document.querySelector('#tracker-current-source'),
    trackerCurrentAuthor: document.querySelector('#tracker-current-author'),
    trackerSubscribeUpBtn: document.querySelector('#tracker-subscribe-up-btn'),
    trackerSubscribeSeasonBtn: document.querySelector('#tracker-subscribe-season-btn'),
    trackerFilterAll: document.querySelector('#tracker-filter-all'),
    trackerFilterUnread: document.querySelector('#tracker-filter-unread'),
    trackerCntAll: document.querySelector('#tracker-cnt-all'),
    trackerCntUnread: document.querySelector('#tracker-cnt-unread'),
    trackerSearchInput: document.querySelector('#tracker-search-input'),
    trackerSortSelect: document.querySelector('#tracker-sort-select'),
    trackerStatusLine: document.querySelector('#tracker-status-line'),
    trackerCheckAllBtn: document.querySelector('#tracker-check-all-btn'),
    trackerCopyAllBtn: document.querySelector('#tracker-copy-all-btn'),
    trackerReadAllBtn: document.querySelector('#tracker-read-all-btn'),
    trackerList: document.querySelector('#tracker-list'),
    trackerEmpty: document.querySelector('#tracker-empty'),
    trackerEmptyTitle: document.querySelector('#tracker-empty-title'),
    trackerEmptyDesc: document.querySelector('#tracker-empty-desc'),
    trackerIntervalSelect: document.querySelector('#tracker-interval-select'),
    trackerNotifySelect: document.querySelector('#tracker-notify-select'),
    trackerExportBtn: document.querySelector('#tracker-export-btn'),
    trackerImportBtn: document.querySelector('#tracker-import-btn'),
    trackerImportFile: document.querySelector('#tracker-import-file')
  };

  let sidepanelToastTimer = null;
  function toast(message, error = false) {
    const isError = error || message.includes('失败') || message.includes('错误');
    const isSuccess = !isError && (message.includes('✓') || message.includes('已复制') || message.includes('完成') || message.includes('OK'));

    let icon = 'ℹ️';
    if (isSuccess) icon = '✓';
    else if (isError) icon = '⚠️';

    const cleanText = message.replace(/^[✓⚠️ℹ️🤖📦📋\s]+/, '');
    elements.toast.innerHTML = `<span style="font-weight:700; color:${isError ? '#ff8b83' : (isSuccess ? '#20c978' : 'var(--primary)')}; font-size:12px;">${icon}</span> <span>${cleanText}</span>`;
    elements.toast.className = `toast show ${isError ? 'error' : (isSuccess ? 'success' : 'info')}`;
    clearTimeout(sidepanelToastTimer);
    sidepanelToastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
  }

  async function command(commandName, payload = {}) {
    return await chrome.runtime.sendMessage({
      type: 'BSE_COMMAND_ACTIVE_TAB',
      command: commandName,
      payload
    });
  }

  function metadata() {
    const selected = state?.tracks?.find((track) => String(track.id) === String(state.selectedTrackId));
    return {
      title: state?.title || '字幕',
      url: state?.url || '',
      platform: state?.platform === 'bilibili' ? '哔哩哔' : 'YouTube',
      language: selected?.lanDoc || selected?.lan || '未知'
    };
  }

  function renderTracks() {
    const autoDoc = BSE.I18n?.t('auto_generated') || '自动';
    const ccDoc = BSE.I18n?.t('cc_track') || 'CC';
    const tracks = state?.tracks || [];
    if (tracks.length > 0) {
      elements.track.replaceChildren(...tracks.map((track) => {
        const option = document.createElement('option');
        option.value = String(track.id);
        option.textContent = `${track.lanDoc || track.lan || 'Default'}（${track.isAuto ? autoDoc : ccDoc}）`;
        option.selected = String(track.id) === String(state.selectedTrackId);
        return option;
      }));
      elements.track.disabled = state?.status === 'loading' || Boolean(state?.isRefreshing);
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = state?.status === 'loading'
        ? (BSE.I18n?.t('status_loading') || '正在解析字幕…')
        : (BSE.I18n?.t('no_subtitles') || '暂无可用字幕');
      option.disabled = true;
      option.selected = true;
      elements.track.replaceChildren(option);
      elements.track.disabled = true;
    }

    // Show Batch Export button on Bilibili
    if (elements.batchButton) {
      elements.batchButton.hidden = state?.platform !== 'bilibili';
    }
  }

  let renderedMediaKey = null;
  let programmaticScrolling = false;
  let programmaticScrollTimer = null;

  function switchTab(tabId) {
    currentTab = tabId;
    elements.tabTimestamp?.classList.toggle('active', tabId === 'timestamp');
    elements.tabPlain?.classList.toggle('active', tabId === 'plain');
    elements.tabAi?.classList.toggle('active', tabId === 'ai');
    elements.tabTracker?.classList.toggle('active', tabId === 'tracker');

    if (tabId === 'tracker') {
      elements.transcript.hidden = true;
      elements.aiSection.hidden = true;
      if (elements.trackerSection) elements.trackerSection.hidden = false;
      document.querySelector('.toolbar')?.setAttribute('hidden', 'true');
      document.querySelector('.video-bar')?.setAttribute('hidden', 'true');
      loadAndRenderTracker();
    } else if (tabId === 'ai') {
      elements.transcript.hidden = true;
      elements.aiSection.hidden = false;
      if (elements.trackerSection) elements.trackerSection.hidden = true;
      document.querySelector('.toolbar')?.removeAttribute('hidden');
      document.querySelector('.video-bar')?.removeAttribute('hidden');
    } else {
      elements.transcript.hidden = false;
      elements.aiSection.hidden = true;
      if (elements.trackerSection) elements.trackerSection.hidden = true;
      document.querySelector('.toolbar')?.removeAttribute('hidden');
      document.querySelector('.video-bar')?.removeAttribute('hidden');
      renderedMediaKey = null; // Force re-render for plain vs timestamp
      renderTranscript();
    }
  }

  // === Tracker State & Methods ===
  let trackerFilter = 'all';
  let trackerSearchQuery = '';
  let trackerSort = 'activity';
  let trackerLoading = false;
  const expandedTrackerCards = new Set();
  let subscriptionsCache = [];
  let currentAuthorInfo = null;

  async function loadAndRenderTracker() {
    if (!BSE.Tracker) return;
    trackerLoading = true;
    if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'true');
    if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = '正在读取订阅…';
    try {
      subscriptionsCache = await BSE.Tracker.getSubscriptions();
      trackerLoading = false;
      renderTrackerList();
      updateTrackerCountsAndBadge();
      await updateQuickSubscribeBar();
    } catch (err) {
      console.warn('[BSE Tracker] 读取订阅列表异常:', err);
      if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = `读取失败：${err?.message || '请稍后重试'}`;
      toast('读取订阅列表失败，请稍后重试', true);
    } finally {
      trackerLoading = false;
      if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'false');
    }
  }

  function updateTrackerCountsAndBadge() {
    const total = subscriptionsCache.length;
    const unread = subscriptionsCache.reduce((sum, s) => sum + (s.unreadCount || 0), 0);
    if (elements.trackerCntAll) elements.trackerCntAll.textContent = String(total);
    if (elements.trackerCntUnread) elements.trackerCntUnread.textContent = String(unread);

    if (elements.trackerUnreadBadge) {
      if (unread > 0) {
        elements.trackerUnreadBadge.hidden = false;
        elements.trackerUnreadBadge.textContent = unread > 99 ? '99+' : String(unread);
      } else {
        elements.trackerUnreadBadge.hidden = true;
      }
    }
  }

  async function detectCurrentVideoAuthorInfo() {
    if (!state || !state.mediaKey) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'BSE_GET_ACTIVE_STATE' });
        if (res?.state) state = res.state;
      } catch {}
    }
    if (!state) return null;
    const platform = state.platform;
    const url = state.url || '';

    // 1. 如果已通过 content script 提取到了完整 authorInfo（包含合集），优先复用
    if (state.authorInfo && state.authorInfo.name && state.authorInfo.targetId && state.authorInfo.seasonId) {
      return {
        platform,
        type: platform === 'youtube' ? 'channel' : 'up',
        title: state.authorInfo.name,
        upName: state.authorInfo.name,
        mid: state.authorInfo.mid || state.authorInfo.targetId,
        targetId: state.authorInfo.targetId,
        avatar: state.authorInfo.avatar || '',
        seasonId: state.authorInfo.seasonId,
        seasonTitle: state.authorInfo.seasonTitle || '视频合集',
        videoTitle: state.title || ''
      };
    }

    // 2. B 站视频：多通道提取 BV 号并调用后台代理接口获取精准 UP 主与合集/系列/分P
    if (platform === 'bilibili') {
      let bvid = BSE.Utils.getBvid(url);
      if (!bvid && state.mediaKey) {
        const match = state.mediaKey.match(/bili:(BV[a-zA-Z0-9]+)/i);
        if (match) bvid = match[1];
      }

      let owner = {};
      let ugc = null;
      let pages = [];
      let videoTitle = state.title || '';

      if (bvid) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            type: 'BSE_FETCH_BILIBILI_RESOURCE',
            url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
          });
          if (bgRes?.success && bgRes?.text) {
            const json = JSON.parse(bgRes.text);
            if (json?.code === 0 && json?.data) {
              owner = json.data.owner || {};
              ugc = json.data.ugc_season;
              pages = json.data.pages || [];
              if (json.data.title) videoTitle = json.data.title;
            }
          }
        } catch (err) {
          console.warn('[BSE Tracker] 后台获取 B站 view 接口异常:', err);
        }
      }

      const upName = owner.name || state.authorInfo?.name || 'B站 UP 主';
      const mid = String(owner.mid || state.authorInfo?.mid || state.authorInfo?.targetId || '');
      const avatar = owner.face || state.authorInfo?.avatar || '';

      let seasonId = null;
      let seasonTitle = null;

      if (ugc && (ugc.id || ugc.season_id)) {
        seasonId = String(ugc.id || ugc.season_id);
        seasonTitle = ugc.title || '视频合集';
      } else if (state.authorInfo?.seasonId) {
        seasonId = state.authorInfo.seasonId;
        seasonTitle = state.authorInfo.seasonTitle || '视频合集';
      } else if (pages.length > 1) {
        seasonId = bvid;
        seasonTitle = `${videoTitle || '分P连载'} (共${pages.length}P)`;
      }

      return {
        platform: 'bilibili',
        type: 'up',
        title: upName,
        upName,
        mid,
        targetId: mid,
        avatar,
        seasonId,
        seasonTitle,
        videoTitle
      };
    }

    // 3. YouTube 视频
    if (platform === 'youtube') {
      return {
        platform: 'youtube',
        type: 'channel',
        title: state.title || 'YouTube 视频',
        upName: state.authorInfo?.name || 'YouTube 频道',
        targetId: state.authorInfo?.targetId || '',
        avatar: state.authorInfo?.avatar || '',
        videoTitle: state.title || ''
      };
    }

    return null;
  }

  async function updateQuickSubscribeBar() {
    if (!elements.trackerQuickBar) return;
    currentAuthorInfo = await detectCurrentVideoAuthorInfo();

    const videoTitle = state?.title || currentAuthorInfo?.videoTitle || '等待视频连接…';
    if (elements.trackerCurrentSource) {
      elements.trackerCurrentSource.textContent = videoTitle;
      elements.trackerCurrentSource.title = videoTitle;
    }

    if (elements.trackerCurrentAuthor) {
      if (currentAuthorInfo && (currentAuthorInfo.upName || currentAuthorInfo.title)) {
        elements.trackerCurrentAuthor.textContent = currentAuthorInfo.upName || currentAuthorInfo.title;
        elements.trackerCurrentAuthor.title = currentAuthorInfo.upName || currentAuthorInfo.title;
      } else {
        elements.trackerCurrentAuthor.textContent = state ? (state.platform === 'bilibili' ? 'B站视频' : 'YouTube') : '等待连接…';
      }
    }

    if (!currentAuthorInfo) {
      if (elements.trackerSubscribeUpBtn) elements.trackerSubscribeUpBtn.disabled = true;
      if (elements.trackerSubscribeSeasonBtn) elements.trackerSubscribeSeasonBtn.hidden = true;
      return;
    }

    const authorTargetId = currentAuthorInfo.mid || currentAuthorInfo.targetId;
    const upSubId = authorTargetId
      ? `${currentAuthorInfo.platform}:${currentAuthorInfo.type || 'up'}:${authorTargetId}`
      : '';
    const isUpSubscribed = Boolean(upSubId && subscriptionsCache.some((s) => s.id === upSubId));

    if (elements.trackerSubscribeUpBtn) {
      elements.trackerSubscribeUpBtn.disabled = !authorTargetId;
      elements.trackerSubscribeUpBtn.classList.toggle('subscribed', isUpSubscribed);
      elements.trackerSubscribeUpBtn.textContent = !authorTargetId
        ? '暂未识别频道 / UP 主'
        : (isUpSubscribed
          ? `✓ 已关注 ${currentAuthorInfo.upName || 'UP'}`
          : `+ 关注 UP 主 (${currentAuthorInfo.upName || 'UP'})`);
    }

    if (currentAuthorInfo.seasonId) {
      const seasonSubId = `${currentAuthorInfo.platform}:season:${currentAuthorInfo.seasonId}`;
      const isSeasonSubscribed = subscriptionsCache.some((s) => s.id === seasonSubId);
      if (elements.trackerSubscribeSeasonBtn) {
        elements.trackerSubscribeSeasonBtn.hidden = false;
        elements.trackerSubscribeSeasonBtn.classList.toggle('subscribed', isSeasonSubscribed);
        elements.trackerSubscribeSeasonBtn.textContent = isSeasonSubscribed
          ? `✓ 已订阅《${currentAuthorInfo.seasonTitle || '合集'}》`
          : `+ 订阅合集《${currentAuthorInfo.seasonTitle || '合集'}》`;
      }
    } else if (elements.trackerSubscribeSeasonBtn) {
      elements.trackerSubscribeSeasonBtn.hidden = true;
    }
  }

  function formatTrackerTime(value) {
    const time = Number(value || 0);
    if (!time) return '尚未巡检';
    const deltaMinutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (deltaMinutes < 1) return '刚刚';
    if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`;
    if (deltaMinutes < 1440) return `${Math.floor(deltaMinutes / 60)} 小时前`;
    if (deltaMinutes < 10080) return `${Math.floor(deltaMinutes / 1440)} 天前`;
    return new Date(time).toLocaleDateString();
  }

  function renderTrackerItem(sub, item, previewId, isUnread) {
    const subtitle = item.subtitle;
    let badge = '<span class="tracker-sub-badge not-found">⚪ 待提取字幕</span>';
    let actions = `<button class="tracker-btn-copy tracker-btn-retry-sub" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}">⚡ 提取</button>`;
    let preview = '';

    if (subtitle?.status === 'ready') {
      badge = `<span class="tracker-sub-badge ready">✓ 已缓存 ${subtitle.cueCount || 0} 行</span>`;
      actions = `
        <button class="tracker-btn-copy" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}">📋 复制</button>
        <button class="tracker-btn-preview-toggle" data-target="${previewId}" aria-expanded="false">👁 预览</button>`;
      preview = `<div class="tracker-preview-drawer" id="${previewId}">${BSE.Utils.escapeHtml(subtitle.markdown || subtitle.plainText || '')}</div>`;
    } else if (subtitle?.status === 'pending') {
      badge = '<span class="tracker-sub-badge pending">⏳ 正在提取</span>';
      actions = '';
    } else if (subtitle?.status === 'not_found' || subtitle?.status === 'error') {
      const label = subtitle.status === 'error' ? '提取失败' : '无官方字幕';
      badge = `<span class="tracker-sub-badge not-found" title="${BSE.Utils.escapeHtml(subtitle.errorHint || '')}">⚪ ${label}</span>`;
      actions = `<button class="tracker-btn-copy tracker-btn-retry-sub" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}">↻ 重试</button>`;
    }

    return `
      <article class="tracker-item-block${isUnread ? ' is-unread' : ''}">
        <div class="tracker-item-header">
          <span class="tracker-item-title" title="${BSE.Utils.escapeHtml(item.title)}">${isUnread ? '<span class="tracker-item-unread-dot" aria-label="未读"></span>' : ''}${BSE.Utils.escapeHtml(item.title)}</span>
          <span class="tracker-item-time">${formatTrackerTime(item.pubdate)}</span>
        </div>
        <div class="tracker-item-sub-row">
          ${badge}
          <div class="tracker-sub-actions">
            ${actions}
            ${item.url ? `<button class="tracker-btn-preview-toggle tracker-btn-watch" data-url="${BSE.Utils.escapeHtml(item.url)}">▶ 打开</button>` : ''}
          </div>
        </div>
        ${preview}
      </article>`;
  }

  function renderTrackerList() {
    if (!elements.trackerList) return;
    elements.trackerList.innerHTML = '';

    let list = [...subscriptionsCache];
    if (trackerFilter === 'unread') list = list.filter((sub) => (sub.unreadCount || 0) > 0);
    if (trackerSearchQuery) {
      list = list.filter((sub) => `${sub.title || ''} ${sub.author || ''}`.toLocaleLowerCase().includes(trackerSearchQuery));
    }
    list.sort((a, b) => {
      if (trackerSort === 'name') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
      if (trackerSort === 'unread') return (b.unreadCount || 0) - (a.unreadCount || 0) || (b.lastCheckedAt || 0) - (a.lastCheckedAt || 0);
      const aActivity = a.items?.[0]?.pubdate || a.lastCheckedAt || a.subscribedAt || 0;
      const bActivity = b.items?.[0]?.pubdate || b.lastCheckedAt || b.subscribedAt || 0;
      return bActivity - aActivity;
    });

    if (elements.trackerEmpty) elements.trackerEmpty.hidden = list.length > 0;
    if (!list.length && elements.trackerEmptyTitle && elements.trackerEmptyDesc) {
      const constrained = trackerFilter === 'unread' || trackerSearchQuery;
      elements.trackerEmptyTitle.textContent = constrained ? '没有符合条件的订阅' : '暂无关注的 UP 主或课程合集';
      elements.trackerEmptyDesc.textContent = constrained
        ? '试试清空搜索词，或切换到“全部”查看所有订阅。'
        : '在视频播放页使用上方按钮关注作者或合集，之后的新投稿会自动出现在这里。';
    }

    const unreadTotal = subscriptionsCache.reduce((sum, sub) => sum + (sub.unreadCount || 0), 0);
    const copyableUnread = subscriptionsCache.reduce((sum, sub) => {
      const unreadItems = (sub.items || []).slice(0, sub.unreadCount || 0);
      return sum + unreadItems.filter((item) => item.subtitle?.status === 'ready' && (item.subtitle.markdown || item.subtitle.plainText)).length;
    }, 0);
    if (elements.trackerStatusLine) {
      elements.trackerStatusLine.textContent = `显示 ${list.length}/${subscriptionsCache.length} 个订阅 · ${unreadTotal} 条未读 · ${copyableUnread} 篇字幕可复制`;
    }
    if (elements.trackerCopyAllBtn) elements.trackerCopyAllBtn.disabled = copyableUnread === 0 || trackerLoading;
    if (elements.trackerReadAllBtn) elements.trackerReadAllBtn.disabled = unreadTotal === 0 || trackerLoading;

    const fragment = document.createDocumentFragment();
    list.forEach((sub, subIndex) => {
      const card = document.createElement('section');
      card.className = `tracker-card${(sub.unreadCount || 0) > 0 ? ' has-unread' : ''}`;
      card.dataset.id = sub.id;
      const items = sub.items || [];
      const unreadCount = Math.min(sub.unreadCount || 0, items.length);
      const expanded = expandedTrackerCards.has(sub.id);
      const visibleCount = expanded ? items.length : Math.max(1, Math.min(unreadCount || 1, 3));
      const visibleItems = items.slice(0, visibleCount);
      const typeLabel = sub.type === 'season' ? '合集' : (sub.platform === 'youtube' ? 'YouTube 频道' : 'Bilibili UP 主');

      card.innerHTML = `
        <div class="tracker-card-head">
          <div class="tracker-card-brand">
            <div class="tracker-avatar-wrap">${sub.avatar ? `<img src="${BSE.Utils.escapeHtml(sub.avatar)}" alt="">` : (sub.platform === 'youtube' ? '▶' : '📺')}</div>
            <div class="tracker-card-meta">
              <strong class="tracker-card-title" title="${BSE.Utils.escapeHtml(sub.title)}">${BSE.Utils.escapeHtml(sub.title)}</strong>
              <span class="tracker-card-subtext">${typeLabel} · ${items.length} 条记录 · 巡检于 ${formatTrackerTime(sub.lastCheckedAt)}</span>
            </div>
          </div>
          ${unreadCount ? `<span class="tracker-card-tag unread">${unreadCount} 条未读</span>` : '<span class="tracker-card-tag">已读</span>'}
        </div>
        <div class="tracker-items">${visibleItems.map((item, itemIndex) => renderTrackerItem(sub, item, `tracker-preview-${subIndex}-${itemIndex}`, itemIndex < unreadCount)).join('')}</div>
        ${items.length > visibleCount ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}">查看其余 ${items.length - visibleCount} 条记录⌄</button>` : (expanded && items.length > 1 ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}">收起记录⌃</button>` : '')}
        <div class="tracker-card-foot">
          <div class="tracker-foot-actions">${unreadCount ? `<button class="tracker-btn-sm tracker-btn-read" data-id="${BSE.Utils.escapeHtml(sub.id)}">✓ 全部已读</button>` : ''}</div>
          <button class="tracker-btn-del" data-id="${BSE.Utils.escapeHtml(sub.id)}" data-title="${BSE.Utils.escapeHtml(sub.title)}">取消追踪</button>
        </div>`;
      fragment.appendChild(card);
    });
    elements.trackerList.appendChild(fragment);
  }

  function renderTranscript() {
    if (currentTab === 'ai') return;
    const isInactive = state?.status === 'empty' || state?.status === 'error';
    const cues = isInactive ? [] : (state?.cues || []);
    elements.copy.disabled = !cues.length;
    elements.download.disabled = !cues.length;
    elements.empty.hidden = cues.length > 0;

    if (!cues.length) {
      renderedMediaKey = null;
      elements.transcript.querySelectorAll('.cue, .paragraph').forEach((item) => item.remove());
      const defaultEmpty = BSE.I18n?.t('empty_cue_list') || '打开视频后将自动读取字幕。';
      let message = defaultEmpty;
      if (state?.status === 'error') {
        message = `${state.message}\n\n${state.lastError?.hint || BSE.I18n?.t('diagnostic_hint') || ''}`;
      } else if (state?.status === 'empty') {
        message = state.message || (BSE.I18n?.t('no_subtitles') || '当前视频没有可用字幕轨道');
      } else if (state?.status === 'loading') {
        message = state.message || (BSE.I18n?.t('status_loading') || '正在解析字幕…');
      }
      elements.empty.querySelector('p').textContent = message;
      return;
    }

    const currentKey = `${state?.mediaKey}:${state?.selectedTrackId}:${cues.length}:${currentTab}`;
    if (renderedMediaKey !== currentKey) {
      renderedMediaKey = currentKey;
      elements.transcript.querySelectorAll('.cue, .paragraph').forEach((item) => item.remove());
      const fragment = document.createDocumentFragment();

      if (currentTab === 'plain') {
        const paragraphs = BSE.Formatters.mergeParagraphs(cues).split('\n\n');
        paragraphs.forEach((pText) => {
          const p = document.createElement('div');
          p.className = 'paragraph';
          p.style.cssText = 'padding: 10px 12px; margin-bottom: 8px; line-height: 1.68; font-size: var(--bse-cue-font-size, 14.5px); border-radius: 8px; background: var(--surface); position: relative; border: 1px solid var(--border);';
          
          const header = document.createElement('div');
          header.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; margin-bottom:4px;';
          
          const copyBtn = document.createElement('button');
          copyBtn.className = 'cue-copy-btn paragraph-copy-btn';
          copyBtn.style.opacity = '1';
          copyBtn.title = '复制本段';
          copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          header.appendChild(copyBtn);

          const content = document.createElement('div');
          content.className = 'paragraph-body';
          content.style.cssText = 'color: var(--text-body); font-size: var(--bse-cue-font-size, 14.5px);';
          content.textContent = pText;

          p.append(header, content);
          fragment.appendChild(p);
        });
      } else {
        cues.forEach((cue, index) => {
          const row = document.createElement('div');
          row.className = `cue${index === activeIndex ? ' active' : ''}`;
          row.dataset.index = String(index);
          row.dataset.time = String(cue.from);
          row.dataset.search = String(cue.content || '').toLowerCase();
          
          const time = document.createElement('span');
          time.className = 'time';
          time.textContent = BSE.Utils.formatClock(cue.from);
          time.title = '点击跳转视频';

          const text = document.createElement('span');
          text.className = 'cue-text';
          text.textContent = cue.content;

          const copyBtn = document.createElement('button');
          copyBtn.className = 'cue-copy-btn single-copy-btn';
          copyBtn.title = '复制本句字幕';
          copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

          row.append(time, text, copyBtn);
          fragment.appendChild(row);
        });
      }

      elements.transcript.appendChild(fragment);
      applySearch();
      if (following && currentTab === 'timestamp') scrollToActive(true);
    }
  }

  function renderState(nextState) {
    if (
      state
      && nextState?.mediaKey === state.mediaKey
      && Number(nextState?.revision || 0) < Number(state.revision || 0)
    ) return;
    state = nextState;
    activeIndex = Number.isInteger(state?.activeIndex) ? state.activeIndex : -1;
    elements.title.textContent = state?.title || BSE.I18n?.t('waiting_video') || '等待视频…';
    if (elements.statusText) elements.statusText.textContent = state?.message || BSE.I18n?.t('connecting_tab') || '正在连接当前标签页';
    elements.statusDot.className = `status-dot ${state?.status || 'idle'}`;
    elements.statusDot.title = state?.message || (BSE.I18n?.t('status_ready') || '准备中…');
    const busy = state?.status === 'loading' || Boolean(state?.isRefreshing);
    elements.refresh.disabled = busy;
    elements.refresh.classList.toggle('busy', busy);
    elements.refresh.setAttribute('aria-busy', String(busy));
    const cues = state?.cues || [];
    if (elements.cueCount) elements.cueCount.textContent = String(cues.length);
    if (elements.duration) elements.duration.textContent = cues.length ? BSE.Utils.formatClock(cues[cues.length - 1].to) : '00:00';
    if (elements.characterCount) elements.characterCount.textContent = String(cues.reduce((sum, cue) => sum + String(cue.content || '').length, 0));
    
    // Diagnostic info rendering
    const fault = state?.lastError;
    if (elements.diagAlert) elements.diagAlert.hidden = !fault;
    if (elements.diagnosticSummary) {
      elements.diagnosticSummary.textContent = fault
        ? `${fault.stage} · ${fault.code}`
        : (state?.diagnostics?.length ? `${state.diagnostics.length} 条记录` : (BSE.I18n?.t('status_ready') || '就绪'));
    }
    if (elements.diagnosticCode) elements.diagnosticCode.textContent = fault ? `${fault.stage} / ${fault.code}` : (BSE.I18n?.t('no_error') || '尚无错误');
    if (elements.diagnosticHint) elements.diagnosticHint.textContent = fault?.hint || (BSE.I18n?.t('diagnostic_hint') || '提取过程会在这里显示每个请求阶段。');
    if (elements.diagnostics) {
      elements.diagnostics.textContent = state?.diagnostics?.length
        ? state.diagnostics.join('\n')
        : (BSE.I18n?.t('no_error') || '暂无诊断信息');
    }
    if (state?.status === 'error' && elements.diagnosticsPanel) elements.diagnosticsPanel.open = true;
    
    renderTracks();
    renderTranscript();
    updateQuickSubscribeBar().catch(() => {});
  }

  function updatePlayback(index) {
    if (index === activeIndex) return;
    elements.transcript.querySelector('.cue.active')?.classList.remove('active');
    activeIndex = index;
    const row = index >= 0 ? elements.transcript.querySelector(`.cue[data-index="${index}"]`) : null;
    row?.classList.add('active');
    if (following && currentTab === 'timestamp') scrollToActive(false);
  }

  function scrollToActive(immediate) {
    if (!following) return;
    const row = elements.transcript.querySelector('.cue.active:not(.hidden)');
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = elements.transcript.getBoundingClientRect();
    if (!listRect.height) return;

    const currentScrollTop = elements.transcript.scrollTop;
    const relativeTop = rowRect.top - listRect.top;
    const targetScrollTop = Math.max(0, Math.round(currentScrollTop + relativeTop - (listRect.height * 0.38) + (rowRect.height / 2)));

    if (Math.abs(targetScrollTop - currentScrollTop) < 10) return;

    programmaticScrolling = true;
    clearTimeout(programmaticScrollTimer);
    elements.transcript.scrollTo({
      top: targetScrollTop,
      behavior: immediate ? 'auto' : 'smooth'
    });
    programmaticScrollTimer = setTimeout(() => {
      programmaticScrolling = false;
    }, immediate ? 50 : 220);
  }

  let currentMatchIndex = -1;
  let searchMatches = [];

  function applySearch(focusIndex = 0) {
    const normalized = query.trim().toLowerCase();
    searchMatches = [];
    currentMatchIndex = -1;

    elements.transcript.querySelectorAll('.cue').forEach((row) => {
      const match = !normalized || row.dataset.search.includes(normalized);
      row.classList.toggle('hidden', !match);
      if (match) searchMatches.push(row);
    });

    if (normalized && searchMatches.length > 0) {
      currentMatchIndex = Math.min(focusIndex, searchMatches.length - 1);
      elements.searchCount.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
      if (focusIndex >= 0) {
        searchMatches[currentMatchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      elements.searchCount.textContent = normalized ? `0/0` : '';
    }
  }

  function nextMatch() {
    if (!searchMatches.length) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    elements.searchCount.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
    searchMatches[currentMatchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function prevMatch() {
    if (!searchMatches.length) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    elements.searchCount.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
    searchMatches[currentMatchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function loadInitialState() {
    const result = await chrome.runtime.sendMessage({ type: 'BSE_GET_ACTIVE_STATE' });
    activeTabId = result?.tab?.id || null;
    if (result?.state) renderState(result.state);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BSE_ACTIVE_TAB_CHANGED') {
      activeTabId = message.tabId;
      if (message.state) renderState(message.state);
    } else if (message?.type === 'BSE_STATE_BROADCAST' && (!activeTabId || message.tabId === activeTabId)) {
      activeTabId = message.tabId;
      renderState(message.state);
    } else if (message?.type === 'BSE_PLAYBACK_BROADCAST' && message.tabId === activeTabId) {
      updatePlayback(message.activeIndex);
    }
  });

  function applyI18nAndTheme() {
    const theme = BSE.I18n?.getTheme() || 'auto';
    if (theme === 'light') {
      document.documentElement.dataset.theme = 'light';
    } else if (theme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    } else if (theme === 'bilibili') {
      document.documentElement.dataset.theme = 'bilibili';
    } else if (theme === 'youtube') {
      document.documentElement.dataset.theme = 'youtube';
    } else {
      document.documentElement.dataset.theme = state?.platform === 'bilibili' ? 'bilibili' : 'dark';
    }
    if (elements.themeSelect) elements.themeSelect.value = theme;
    if (elements.langSelect) elements.langSelect.value = BSE.I18n?.getLocale() || 'auto';

    if (typeof chrome !== 'undefined' && chrome?.storage?.sync?.get) {
      chrome.storage.sync.get({ cueFontSize: '14.5', bseSubtitlePreference: 'manual-first' }, (res) => {
        if (res?.cueFontSize) {
          if (elements.sizeSelect) elements.sizeSelect.value = res.cueFontSize;
          document.documentElement.style.setProperty('--bse-cue-font-size', `${res.cueFontSize}px`);
        }
        if (res?.bseSubtitlePreference && elements.prefSelect) {
          elements.prefSelect.value = res.bseSubtitlePreference;
        }
      });
    }

    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    if (elements.settingsTitle) elements.settingsTitle.textContent = `⚙️ ${t('settings_title')}`;
    if (elements.settingsToggle) elements.settingsToggle.title = t('settings_title');
    if (elements.labelTheme) elements.labelTheme.textContent = t('theme_label');
    if (elements.labelLang) elements.labelLang.textContent = t('lang_label');
    if (elements.labelPref) elements.labelPref.textContent = '字幕偏好';
    if (elements.labelSize) elements.labelSize.textContent = '正文字号';
    if (elements.search) elements.search.placeholder = t('search_placeholder');
    if (elements.refresh) elements.refresh.title = t('refresh_subtitles');
    if (elements.copy) elements.copy.title = t('copy_full_text');
    if (elements.copyText) elements.copyText.textContent = t('copy_full_text');
    if (elements.download) elements.download.title = t('export');
    if (elements.exportText) elements.exportText.textContent = t('export');
    if (elements.diagTitle) elements.diagTitle.textContent = t('diagnostics_title');
    if (elements.copyDiagnostic) elements.copyDiagnostic.textContent = t('copy_diagnostics');
    if (elements.emptyMessage) elements.emptyMessage.textContent = t('empty_cue_list');
    if (elements.followText) elements.followText.textContent = following ? t('follow') : t('resume_follow');
    if (elements.tabTimestamp) elements.tabTimestamp.textContent = t('tab_timestamp');
    if (elements.tabPlain) elements.tabPlain.textContent = t('tab_plain');
    if (elements.tabAi) elements.tabAi.textContent = t('tab_ai');
    if (elements.batchBtnText) elements.batchBtnText.textContent = t('btn_batch_export');
    if (elements.aiTitle) elements.aiTitle.textContent = `🤖 ${t('ai_summary_title')}`;
    if (elements.aiCardSummary) elements.aiCardSummary.textContent = t('ai_prompt_summary');
    if (elements.aiCardKeypoints) elements.aiCardKeypoints.textContent = t('ai_prompt_keypoints');
    if (elements.aiCardNotes) elements.aiCardNotes.textContent = t('ai_prompt_notes');
    if (elements.aiCardQuestions) elements.aiCardQuestions.textContent = t('ai_prompt_questions');
  }

  if (BSE.I18n) {
    BSE.I18n.subscribe(applyI18nAndTheme);
    applyI18nAndTheme();
  }

  // Tabs events
  elements.tabTimestamp?.addEventListener('click', () => switchTab('timestamp'));
  elements.tabPlain?.addEventListener('click', () => switchTab('plain'));
  elements.tabAi?.addEventListener('click', () => switchTab('ai'));
  elements.tabTracker?.addEventListener('click', () => switchTab('tracker'));

  // Tracker Subscriptions Event Listeners
  elements.trackerSubscribeUpBtn?.addEventListener('click', async () => {
    if (!currentAuthorInfo || !currentAuthorInfo.targetId) return;
    const subId = `${currentAuthorInfo.platform}:${currentAuthorInfo.type || 'up'}:${currentAuthorInfo.mid || currentAuthorInfo.targetId}`;
    const exists = subscriptionsCache.some((s) => s.id === subId);
    if (exists) {
      await BSE.Tracker.removeSubscription(subId);
      toast(`已取消关注: ${currentAuthorInfo.upName}`);
    } else {
      await BSE.Tracker.addSubscription({
        id: subId,
        platform: currentAuthorInfo.platform,
        type: currentAuthorInfo.type || 'up',
        title: currentAuthorInfo.upName || currentAuthorInfo.title,
        author: currentAuthorInfo.upName,
        avatar: currentAuthorInfo.avatar,
        targetId: currentAuthorInfo.mid || currentAuthorInfo.targetId,
        sourceUrl: state?.url || ''
      });
      toast(`✓ 已成功关注 UP 主: ${currentAuthorInfo.upName}`);
    }
    await loadAndRenderTracker();
    chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
  });

  elements.trackerSubscribeSeasonBtn?.addEventListener('click', async () => {
    if (!currentAuthorInfo || !currentAuthorInfo.seasonId) return;
    const subId = `${currentAuthorInfo.platform}:season:${currentAuthorInfo.seasonId}`;
    const exists = subscriptionsCache.some((s) => s.id === subId);
    if (exists) {
      await BSE.Tracker.removeSubscription(subId);
      toast(`已取消订阅合集: ${currentAuthorInfo.seasonTitle || '本合集'}`);
    } else {
      await BSE.Tracker.addSubscription({
        id: subId,
        platform: currentAuthorInfo.platform,
        type: 'season',
        title: currentAuthorInfo.seasonTitle || currentAuthorInfo.title || '课程合集',
        author: currentAuthorInfo.upName || currentAuthorInfo.title || '',
        ownerId: currentAuthorInfo.mid || '',
        avatar: currentAuthorInfo.avatar,
        targetId: currentAuthorInfo.seasonId,
        sourceUrl: state?.url || ''
      });
      toast(`✓ 已成功订阅合集: ${currentAuthorInfo.seasonTitle || '本合集'}`);
    }
    await loadAndRenderTracker();
    chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
  });

  elements.trackerFilterAll?.addEventListener('click', () => {
    trackerFilter = 'all';
    elements.trackerFilterAll.classList.add('active');
    elements.trackerFilterUnread?.classList.remove('active');
    renderTrackerList();
  });

  elements.trackerFilterUnread?.addEventListener('click', () => {
    trackerFilter = 'unread';
    elements.trackerFilterUnread.classList.add('active');
    elements.trackerFilterAll?.classList.remove('active');
    renderTrackerList();
  });

  elements.trackerSearchInput?.addEventListener('input', () => {
    trackerSearchQuery = elements.trackerSearchInput.value.trim().toLocaleLowerCase();
    renderTrackerList();
  });

  elements.trackerSortSelect?.addEventListener('change', () => {
    trackerSort = elements.trackerSortSelect.value;
    renderTrackerList();
  });

  elements.trackerCheckAllBtn?.addEventListener('click', async () => {
    if (elements.trackerCheckAllBtn) {
      elements.trackerCheckAllBtn.textContent = '⏳ 检查中…';
      elements.trackerCheckAllBtn.disabled = true;
    }
    toast('正在后台检测所有订阅源更新…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_TRACKER_CHECK_NOW' });
      if (res?.error) throw new Error(res.error);
      await loadAndRenderTracker();
      const updatedCount = (res?.updatedSubs || []).length;
      if (updatedCount > 0) {
        toast(`✓ 发现 ${updatedCount} 个订阅源更新！`);
      } else {
        toast('所有订阅源已是最新状态');
      }
    } catch (err) {
      toast(`检查更新失败: ${err.message}`, true);
    } finally {
      if (elements.trackerCheckAllBtn) {
        elements.trackerCheckAllBtn.textContent = '🔄 刷新';
        elements.trackerCheckAllBtn.disabled = false;
      }
    }
  });

  elements.trackerReadAllBtn?.addEventListener('click', async () => {
    await BSE.Tracker?.markAllAsRead?.();
    await loadAndRenderTracker();
    chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
    toast('✓ 已全部标记为已读');
  });

  elements.trackerCopyAllBtn?.addEventListener('click', async () => {
    const list = subscriptionsCache;
    const unreadItems = [];
    let skippedWithoutSubtitle = 0;
    list.forEach((sub) => {
      if ((sub.unreadCount || 0) > 0) {
        (sub.items || []).slice(0, sub.unreadCount).forEach((item) => {
          if (item.subtitle?.status === 'ready' && (item.subtitle.markdown || item.subtitle.plainText)) {
            unreadItems.push({ ...item, author: item.author || sub.author || sub.title });
          } else {
            skippedWithoutSubtitle++;
          }
        });
      }
    });

    if (!unreadItems.length) {
      toast(skippedWithoutSubtitle ? '未读更新的字幕尚未提取完成' : '暂无未读更新，无需合并复制', true);
      return;
    }

    const mergedMd = BSE.Tracker.exportMergedMarkdown(unreadItems);
    await navigator.clipboard.writeText(mergedMd);
    toast(`✓ 已复制 ${unreadItems.length} 篇字幕${skippedWithoutSubtitle ? `，跳过 ${skippedWithoutSubtitle} 篇未就绪` : ''}`);
  });

  elements.trackerList?.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.tracker-btn-copy:not(.tracker-btn-retry-sub)');
    if (copyBtn) {
      const subId = copyBtn.dataset.subId;
      const itemId = copyBtn.dataset.itemId;
      const sub = subscriptionsCache.find((s) => s.id === subId);
      const item = (sub?.items || []).find((i) => i.id === itemId);
      if (item?.subtitle?.markdown) {
        await navigator.clipboard.writeText(item.subtitle.markdown);
        toast(`✓ 已复制《${item.title}》Markdown 字幕`);
      } else if (item?.subtitle?.plainText) {
        await navigator.clipboard.writeText(item.subtitle.plainText);
        toast(`✓ 已复制《${item.title}》纯文本字幕`);
      } else {
        toast('该视频字幕尚未提取完成，请点击「提取」重试', true);
      }
      return;
    }

    const previewBtn = e.target.closest('.tracker-btn-preview-toggle:not(.tracker-btn-watch)');
    if (previewBtn) {
      const targetId = previewBtn.dataset.target;
      const drawer = document.getElementById(targetId);
      if (drawer) {
        drawer.classList.toggle('open');
        const open = drawer.classList.contains('open');
        previewBtn.setAttribute('aria-expanded', String(open));
        previewBtn.textContent = open ? '▲ 收起' : '👁 预览';
      }
      return;
    }

    const expandBtn = e.target.closest('.tracker-expand-btn');
    if (expandBtn) {
      const id = expandBtn.dataset.id;
      if (expandedTrackerCards.has(id)) expandedTrackerCards.delete(id);
      else expandedTrackerCards.add(id);
      renderTrackerList();
      return;
    }

    const retrySubBtn = e.target.closest('.tracker-btn-retry-sub');
    if (retrySubBtn) {
      const subId = retrySubBtn.dataset.subId;
      const itemId = retrySubBtn.dataset.itemId;
      retrySubBtn.textContent = '⏳ 提取中…';
      retrySubBtn.disabled = true;
      try {
        const subRes = await BSE.Tracker.fetchSubtitleForItem(subId, itemId);
        await loadAndRenderTracker();
        if (subRes.status === 'ready') {
          toast(`✓ 成功提取《${itemId}》字幕 (${subRes.cueCount}行)`);
        } else {
          toast(`提取结果: ${subRes.errorHint || '无官方字幕'}`, true);
        }
      } catch (err) {
        toast(`提取失败: ${err.message}`, true);
      }
      return;
    }

    const watchBtn = e.target.closest('.tracker-btn-watch');
    if (watchBtn) {
      const url = watchBtn.dataset.url;
      if (url) chrome.tabs.create({ url });
      return;
    }
    const readBtn = e.target.closest('.tracker-btn-read');
    if (readBtn) {
      const id = readBtn.dataset.id;
      if (id) {
        await BSE.Tracker?.markAsRead?.(id);
        await loadAndRenderTracker();
        chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
        toast('✓ 已标记已读');
      }
      return;
    }
    const delBtn = e.target.closest('.tracker-btn-del');
    if (delBtn) {
      const id = delBtn.dataset.id;
      const title = delBtn.dataset.title || '该订阅';
      if (id && window.confirm(`确定取消追踪“${title}”吗？已缓存的更新记录也会被删除。`)) {
        await BSE.Tracker?.removeSubscription?.(id);
        await loadAndRenderTracker();
        chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
        toast('已取消该订阅');
      }
      return;
    }
  });

  if (elements.trackerIntervalSelect && BSE.Tracker) {
    BSE.Tracker.getSettings().then((s) => {
      if (elements.trackerIntervalSelect) elements.trackerIntervalSelect.value = String(s.checkIntervalMinutes);
      if (elements.trackerNotifySelect) elements.trackerNotifySelect.value = String(s.enableNotification);
    }).catch(() => {});

    elements.trackerIntervalSelect.addEventListener('change', async () => {
      const val = Number(elements.trackerIntervalSelect.value);
      await BSE.Tracker?.saveSettings?.({ checkIntervalMinutes: val });
      chrome.runtime.sendMessage({ type: 'BSE_TRACKER_RESET_ALARM' }).catch(() => {});
      toast('✓ 巡检周期已更新');
    });

    elements.trackerNotifySelect?.addEventListener('change', async () => {
      const val = elements.trackerNotifySelect.value === 'true';
      await BSE.Tracker?.saveSettings?.({ enableNotification: val });
      toast('✓ 桌面通知偏好已保存');
    });
  }

  elements.trackerExportBtn?.addEventListener('click', async () => {
    try {
      const json = await BSE.Tracker?.exportConfigJson?.();
      BSE.Utils.downloadText(json, `SparkSub_Subscriptions_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast('✓ 订阅配置已导出');
    } catch (err) {
      toast(`导出失败: ${err.message}`, true);
    }
  });

  elements.trackerImportBtn?.addEventListener('click', () => {
    elements.trackerImportFile?.click();
  });

  elements.trackerImportFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await BSE.Tracker?.importConfigJson?.(text);
      await loadAndRenderTracker();
      toast(`✓ 成功导入 ${res.importedCount} 个订阅源！`);
    } catch (err) {
      toast(`导入失败: ${err.message}`, true);
    } finally {
      elements.trackerImportFile.value = '';
    }
  });

  // AI Prompt cards
  document.querySelectorAll('.ai-prompt-card').forEach((card) => {
    card.addEventListener('click', async () => {
      if (!state?.cues?.length) {
        toast('暂无字幕内容可供总结', true);
        return;
      }
      const promptId = card.dataset.prompt;
      const text = BSE.Formatters.generateAiPrompt(promptId, state.cues, false);
      await navigator.clipboard.writeText(text);
      toast(BSE.I18n?.t('ai_copied_toast') || '✓ 已复制 AI 提示词与文稿');
    });
  });

  if (elements.settingsToggle) {
    elements.settingsToggle.addEventListener('click', () => {
      const isHidden = !elements.settingsDrawer.hidden;
      elements.settingsDrawer.hidden = isHidden;
      elements.settingsToggle.classList.toggle('active', !isHidden);
    });
  }

  if (elements.themeSelect) {
    elements.themeSelect.addEventListener('change', () => {
      BSE.I18n?.setTheme(elements.themeSelect.value);
    });
  }

  if (elements.langSelect) {
    elements.langSelect.addEventListener('change', () => {
      BSE.I18n?.setLocale(elements.langSelect.value);
    });
  }

  if (elements.sizeSelect) {
    elements.sizeSelect.addEventListener('change', () => {
      const size = elements.sizeSelect.value;
      document.documentElement.style.setProperty('--bse-cue-font-size', `${size}px`);
      if (typeof chrome !== 'undefined' && chrome?.storage?.sync?.set) {
        try { chrome.storage.sync.set({ cueFontSize: size }); } catch {}
      }
    });
  }

  if (elements.prefSelect) {
    elements.prefSelect.addEventListener('change', () => {
      const pref = elements.prefSelect.value;
      if (typeof chrome !== 'undefined' && chrome?.storage?.sync?.set) {
        try { chrome.storage.sync.set({ bseSubtitlePreference: pref }); } catch {}
      }
    });
  }

  elements.refresh.addEventListener('click', async () => {
    elements.refresh.disabled = true;
    const result = await command('REFRESH');
    if (result?.ok === false) {
      elements.refresh.disabled = false;
      toast(result.error || BSE.I18n?.t('status_error') || '刷新命令发送失败', true);
    }
  });

  elements.track.addEventListener('change', () => command('SELECT_TRACK', { trackId: elements.track.value }));
  
  let searchDebounceTimer = null;
  elements.search.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    query = elements.search.value;
    searchDebounceTimer = setTimeout(() => {
      applySearch(0);
    }, 100);
  });

  elements.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prevMatch();
      else nextMatch();
    }
  });

  elements.searchPrev?.addEventListener('click', () => prevMatch());
  elements.searchNext?.addEventListener('click', () => nextMatch());

  elements.follow.addEventListener('click', () => {
    clearTimeout(autoResumeTimer);
    following = !following;
    elements.follow.classList.toggle('active', following);
    const t = (k) => BSE.I18n?.t(k) || k;
    if (elements.followText) elements.followText.textContent = following ? t('follow') : t('resume_follow');
    if (following && currentTab === 'timestamp') scrollToActive(true);
  });

  const handleUserScrollInteraction = () => {
    if (!state?.cues?.length) return;
    programmaticScrolling = false;
    clearTimeout(programmaticScrollTimer);
    if (following) {
      following = false;
      elements.follow.classList.remove('active');
      const t = (k) => BSE.I18n?.t(k) || k;
      if (elements.followText) elements.followText.textContent = t('resume_follow');
    }
    clearTimeout(autoResumeTimer);
    autoResumeTimer = setTimeout(() => {
      if (!following && state?.cues?.length && currentTab === 'timestamp') {
        following = true;
        elements.follow.classList.add('active');
        const t = (k) => BSE.I18n?.t(k) || k;
        if (elements.followText) elements.followText.textContent = t('follow');
        scrollToActive(false);
      }
    }, AUTO_RESUME_DELAY);
  };

  elements.transcript.addEventListener('wheel', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('touchstart', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('pointerdown', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('mousedown', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('scroll', () => {
    if (programmaticScrolling) return;
    handleUserScrollInteraction();
  }, { passive: true });

  elements.transcript.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('.cue-copy-btn');
    if (copyBtn) {
      event.stopPropagation();
      const paragraph = copyBtn.closest('.paragraph');
      if (paragraph) {
        const text = paragraph.querySelector('.paragraph-body')?.textContent || '';
        await navigator.clipboard.writeText(text);
        toast('✓ 本段文字已复制');
        return;
      }
      const cue = copyBtn.closest('.cue');
      if (cue) {
        const text = cue.querySelector('.cue-text')?.textContent || '';
        await navigator.clipboard.writeText(text);
        toast('✓ 本句字幕已复制');
        return;
      }
    }

    const selection = window.getSelection()?.toString();
    if (selection && selection.trim().length > 0) return;
    const row = event.target.closest('.cue');
    if (!row) return;
    clearTimeout(autoResumeTimer);
    command('SEEK', { time: Number(row.dataset.time) });
    following = true;
    elements.follow.classList.add('active');
    const t = (k) => BSE.I18n?.t(k) || k;
    if (elements.followText) elements.followText.textContent = t('follow');
    scrollToActive(false);
  });

  elements.copy.addEventListener('click', async () => {
    const text = BSE.Formatters.toTxt(state?.cues || [], false);
    await navigator.clipboard.writeText(text);
    toast(BSE.I18n?.t('copied_full_text') || '已复制字幕全文');
  });

  elements.copyDiagnostic.addEventListener('click', async () => {
    const fault = state?.lastError;
    const header = [
      `扩展版本：${state?.version || '未知'}`,
      `平台：${state?.platform || '未知'}`,
      `媒体：${state?.mediaKey || '未知'}`,
      `状态：${state?.status || '未知'} / ${state?.message || ''}`,
      `错误：${fault ? `${fault.stage} / ${fault.code} / ${fault.message}` : '无'}`,
      `建议：${fault?.hint || '无'}`
    ].join('\n');
    await navigator.clipboard.writeText(`${header}\n\n${state?.diagnostics?.join('\n') || '暂无诊断信息'}`);
    toast(BSE.I18n?.t('copied_diagnostics') || '已复制诊断信息');
  });

  elements.download.addEventListener('click', async () => {
    const format = elements.format.value;

    if (format === 'audio') {
      if (state?.platform !== 'bilibili') {
        toast('独立音频直链提取目前支持 B 站 DASH 视频', true);
        return;
      }
      toast('正在提取 B 站独立 DASH 音频直链…');
      try {
        const res = await command('FETCH_AUDIO_STREAM');
        if (!res?.ok || !res?.data) {
          throw new Error(res?.error || '未能提取到音频流');
        }
        const audioData = res.data;
        const bitrateKbps = Math.round((audioData.bandwidth || 0) / 1000);
        await navigator.clipboard.writeText(audioData.audioUrl);
        toast(`✓ 已提取 ${bitrateKbps}kbps 音频直链并复制，正在下载文件…`);

        await BSE.Bilibili.downloadAudioFile(audioData, state?.title || '音频');
        toast(`✓ 音频文件下载完成！(${bitrateKbps}kbps M4A)`);
      } catch (err) {
        toast(`音频提取下载失败: ${err.message || '未知错误'}`, true);
      }
      return;
    }

    const extension = format === 'md' ? 'md' : format === 'srt' ? 'srt' : 'txt';
    const mime = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const text = BSE.Formatters.format(format, state?.cues || [], metadata());
    BSE.Utils.downloadText(text, `${state?.title || '字幕'}.${extension}`, mime);
    toast(BSE.I18n?.t('export') + ' OK');
  });

  // Global Subtitle Preference storage sync
  if (elements.prefSelect) {
    try {
      chrome?.storage?.sync?.get(['bseSubtitlePreference'], (res) => {
        if (res?.bseSubtitlePreference) {
          elements.prefSelect.value = res.bseSubtitlePreference;
        }
      });
    } catch {}
    elements.prefSelect.addEventListener('change', () => {
      try {
        chrome?.storage?.sync?.set({ bseSubtitlePreference: elements.prefSelect.value });
      } catch {}
    });
  }

  // Batch Export Modal logic for Bilibili
  function generateTreePreviewHtml(tree) {
    let html = '';
    const hasMultipleSections = (tree.sections || []).length > 1;

    tree.sections.forEach((sec, sIdx) => {
      const countLabel = tree.hasNestedPages ? `${sec.items.length} 个分P` : `${sec.items.length} 集`;
      html += `
        <div class="batch-tree-sec-group" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
          <div class="batch-tree-sec-node" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
            <label class="batch-tree-sec-label" title="勾选/取消勾选该分组全部分P">
              <span class="batch-tree-sec-chevron" data-sec-toggle="${BSE.Utils.escapeHtml(sec.key)}" title="折叠/展开分组">▼</span>
              <input type="checkbox" class="batch-tree-sec-cb" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
              <span>📁 ${hasMultipleSections ? `第 ${sIdx + 1} 章 · ` : ''}${BSE.Utils.escapeHtml(sec.title)}</span>
            </label>
            <div class="batch-tree-sec-actions">
              <span class="batch-tree-node-meta">${countLabel}</span>
              <button type="button" class="batch-tree-sec-btn" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">选此组</button>
            </div>
          </div>
          <div class="batch-tree-sec-children">
      `;

      (sec.episodes || []).forEach((ep) => {
        const isMultiP = ep.pagesCount > 1;
        if (isMultiP) {
          html += `
            <div class="batch-tree-video-node" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}">
              <label class="batch-tree-video-label" title="勾选/取消勾选该视频全部分P">
                <input type="checkbox" class="batch-tree-video-cb" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}" checked>
                <span>🎬 视频 ${ep.index}：${BSE.Utils.escapeHtml(ep.title)}</span>
              </label>
              <div class="batch-tree-sec-actions">
                <span class="batch-tree-node-meta">${ep.pagesCount} P</span>
                <button type="button" class="batch-tree-video-btn" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}">选此视频</button>
              </div>
            </div>
          `;
          (ep.items || []).forEach((item) => {
            const isCur = item.bvid === tree.currentBvid && item.page === (tree.currentPage || 1);
            const durText = item.duration ? BSE.Utils.formatClock(item.duration) : '';
            const pLabel = item.part ? `P${item.page || 1} ${item.part}` : `P${item.page || 1}`;
            html += `
              <div class="batch-tree-item-node sub-p${isCur ? ' active' : ''}" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
                <label class="batch-tree-item-label" title="${BSE.Utils.escapeHtml(item.title)}">
                  <input type="checkbox" class="batch-tree-cb" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
                  <span class="batch-tree-item-text">
                    ${isCur ? '▶' : '·'} <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> <strong>${BSE.Utils.escapeHtml(pLabel)}</strong>
                    ${isCur ? '<span class="batch-tree-tag-cur">当前播放</span>' : ''}
                  </span>
                </label>
                ${durText ? `<span class="batch-tree-node-meta">${durText}</span>` : ''}
              </div>
            `;
          });
        } else {
          const item = ep.items?.[0] || { globalIndex: 1, duration: 0, title: ep.title, bvid: ep.bvid, page: 1 };
          const isCur = item.bvid === tree.currentBvid;
          const durText = item.duration ? BSE.Utils.formatClock(item.duration) : '';
          html += `
            <div class="batch-tree-item-node single-ep${isCur ? ' active' : ''}" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
              <label class="batch-tree-item-label" title="${BSE.Utils.escapeHtml(item.title)}">
                <input type="checkbox" class="batch-tree-cb" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
                <span class="batch-tree-item-text">
                  ${isCur ? '▶' : '·'} <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> ${BSE.Utils.escapeHtml(ep.title)}
                  ${isCur ? '<span class="batch-tree-tag-cur">当前播放</span>' : ''}
                </span>
              </label>
              ${durText ? `<span class="batch-tree-node-meta">${durText}</span>` : ''}
            </div>
          `;
        }
      });

      html += `
          </div>
        </div>
      `;
    });
    return html;
  }

  function updateTreeSummaryAndScope() {
    if (!currentTree || !elements.batchTreeList) return;
    const allCbs = [...elements.batchTreeList.querySelectorAll('.batch-tree-cb')];
    const checkedCbs = allCbs.filter(cb => cb.checked);
    const total = allCbs.length;
    const checkedCount = checkedCbs.length;

    let totalSec = 0;
    checkedCbs.forEach(cb => {
      totalSec += Number(cb.dataset.duration) || 0;
    });

    const summaryEl = document.querySelector('#batch-tree-selected-summary');
    if (summaryEl) {
      const durLabel = totalSec > 0 ? ` · 约 ${BSE.Utils.formatClock(totalSec)}` : '';
      summaryEl.textContent = checkedCount === total
        ? `已全选 (${total} 集${durLabel})`
        : `已选 ${checkedCount} / ${total} 集${durLabel}`;
    }

    // Sync section checkboxes (checked, unchecked, or indeterminate)
    elements.batchTreeList.querySelectorAll('.batch-tree-sec-cb').forEach(secCb => {
      const secKey = secCb.dataset.secKey;
      const childCbs = [...elements.batchTreeList.querySelectorAll(`.batch-tree-cb[data-sec-key="${secKey}"]`)];
      const checkedChildren = childCbs.filter(c => c.checked).length;
      if (checkedChildren === 0) {
        secCb.checked = false;
        secCb.indeterminate = false;
      } else if (checkedChildren === childCbs.length) {
        secCb.checked = true;
        secCb.indeterminate = false;
      } else {
        secCb.checked = false;
        secCb.indeterminate = true;
      }
    });

    // Sync video checkboxes
    elements.batchTreeList.querySelectorAll('.batch-tree-video-cb').forEach(vCb => {
      const bvid = vCb.dataset.bvid;
      const childCbs = [...elements.batchTreeList.querySelectorAll(`.batch-tree-cb[data-bvid="${bvid}"]`)];
      const checkedChildren = childCbs.filter(c => c.checked).length;
      if (checkedChildren === 0) {
        vCb.checked = false;
        vCb.indeterminate = false;
      } else if (checkedChildren === childCbs.length) {
        vCb.checked = true;
        vCb.indeterminate = false;
      } else {
        vCb.checked = false;
        vCb.indeterminate = true;
      }
    });
  }

  async function openBatchModal() {
    try {
      const bvid = BSE.Utils.getBvid(state?.url || location.href);
      if (!bvid) {
        toast('未识别到 B 站视频 BV 号', true);
        return;
      }
      elements.batchOverlay.hidden = false;
      elements.batchProgressBox.hidden = true;
      elements.batchStartBtn.hidden = false;
      elements.batchPauseBtn.hidden = true;
      elements.batchCancelBtn.hidden = true;

      toast('正在分析合集与分P架构…');
      const diagLogger = (stage, msg) => {
        if (!state) return;
        if (!state.diagnostics) state.diagnostics = [];
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        state.diagnostics.push(`[${timestamp}] ${stage}：${msg}`);
        if (elements.diagnostics) elements.diagnostics.textContent = state.diagnostics.join('\n');
        if (elements.diagnosticSummary) elements.diagnosticSummary.textContent = `${state.diagnostics.length} 条记录`;
      };

      currentTree = await BSE.Bilibili.fetchMediaTree(bvid, { diagnostic: diagLogger });

      elements.batchModalTitle.textContent = currentTree.title;
      elements.batchTypePill.textContent = currentTree.kind === 'ugc_season' ? '🏷️ UGC合集' : (currentTree.kind === 'multi_page' ? '🎞️ 多P' : '🎬 单视频');
      elements.batchSelectedSummary.textContent = `共 ${currentTree.items.length} 个分P${currentTree.hasNestedPages ? ' · 含复合多P' : ''}`;

      // Initialize quick range bar values
      if (elements.batchQuickStart) {
        elements.batchQuickStart.max = String(currentTree.items.length);
        elements.batchQuickStart.value = '1';
      }
      if (elements.batchQuickEnd) {
        elements.batchQuickEnd.max = String(currentTree.items.length);
        elements.batchQuickEnd.value = String(currentTree.items.length);
      }

      // Render Tree List with Granular Checkboxes
      elements.batchTreeList.innerHTML = generateTreePreviewHtml(currentTree);

      // Auto-scroll to current episode in large collections
      const activeEp = elements.batchTreeList.querySelector('.batch-tree-item-node.active');
      if (activeEp) {
        setTimeout(() => activeEp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
      }

      updateTreeSummaryAndScope();
    } catch (err) {
      toast(err.message || '加载合集拓扑失败', true);
      elements.batchOverlay.hidden = true;
    }
  }

  // Tree Checkbox Change Delegation
  elements.batchTreeList?.addEventListener('change', (e) => {
    const target = e.target;
    if (target.classList.contains('batch-tree-cb')) {
      updateTreeSummaryAndScope();
    } else if (target.classList.contains('batch-tree-sec-cb')) {
      const secKey = target.dataset.secKey;
      const cbs = elements.batchTreeList.querySelectorAll(`.batch-tree-cb[data-sec-key="${secKey}"]`);
      cbs.forEach(cb => cb.checked = target.checked);
      updateTreeSummaryAndScope();
    } else if (target.classList.contains('batch-tree-video-cb')) {
      const bvid = target.dataset.bvid;
      const cbs = elements.batchTreeList.querySelectorAll(`.batch-tree-cb[data-bvid="${bvid}"]`);
      cbs.forEach(cb => cb.checked = target.checked);
      updateTreeSummaryAndScope();
    }
  });

  // Tree Click Delegation (Row selection, Section folding, Select buttons)
  elements.batchTreeList?.addEventListener('click', (e) => {
    const chevron = e.target.closest('.batch-tree-sec-chevron');
    if (chevron) {
      e.stopPropagation();
      const secGroup = chevron.closest('.batch-tree-sec-group');
      secGroup?.classList.toggle('collapsed');
      return;
    }

    const secBtn = e.target.closest('.batch-tree-sec-btn');
    if (secBtn) {
      e.stopPropagation();
      const secKey = secBtn.dataset.secKey;
      elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => {
        cb.checked = cb.dataset.secKey === secKey;
      });
      updateTreeSummaryAndScope();
      return;
    }

    const videoBtn = e.target.closest('.batch-tree-video-btn');
    if (videoBtn) {
      e.stopPropagation();
      const bvid = videoBtn.dataset.bvid;
      elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => {
        cb.checked = cb.dataset.bvid === bvid;
      });
      updateTreeSummaryAndScope();
      return;
    }

    const itemNode = e.target.closest('.batch-tree-item-node');
    if (itemNode && !e.target.matches('input[type="checkbox"]')) {
      const cb = itemNode.querySelector('.batch-tree-cb');
      if (cb) {
        cb.checked = !cb.checked;
        updateTreeSummaryAndScope();
      }
    }
  });

  // Tree Toolbar Buttons
  elements.batchTreeBtnAll?.addEventListener('click', () => {
    elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => cb.checked = true);
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnCur?.addEventListener('click', () => {
    if (!currentTree) return;
    elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => {
      const isCur = cb.dataset.bvid === currentTree.currentBvid;
      cb.checked = isCur;
    });
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnNone?.addEventListener('click', () => {
    elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => cb.checked = false);
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnInvert?.addEventListener('click', () => {
    elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => {
      cb.checked = !cb.checked;
    });
    updateTreeSummaryAndScope();
  });

  // Quick Range Apply Button
  elements.batchQuickApplyBtn?.addEventListener('click', () => {
    if (!currentTree) return;
    const start = Math.max(1, Number(elements.batchQuickStart?.value) || 1);
    const end = Math.min(currentTree.items.length, Number(elements.batchQuickEnd?.value) || currentTree.items.length);
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    elements.batchTreeList.querySelectorAll('.batch-tree-cb').forEach(cb => {
      const idx = Number(cb.dataset.globalIndex);
      cb.checked = (idx >= min && idx <= max);
    });
    updateTreeSummaryAndScope();
  });

  elements.batchButton?.addEventListener('click', openBatchModal);
  elements.batchCloseBtn?.addEventListener('click', () => {
    if (batchControlTask?.running) {
      batchControlTask.cancelled = true;
    }
    elements.batchOverlay.hidden = true;
  });

  // Output mode toggle
  document.querySelectorAll('input[name="batch-output"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isZip = document.querySelector('input[name="batch-output"]:checked')?.value === 'zip';
      if (elements.batchFormatRow) elements.batchFormatRow.style.display = isZip ? 'flex' : 'none';
    });
  });

  elements.batchStartBtn?.addEventListener('click', async () => {
    if (!currentTree) return;
    const checkedCbs = [...elements.batchTreeList.querySelectorAll('.batch-tree-cb:checked')];
    if (!checkedCbs.length) {
      toast('请至少在目录中勾选 1 个分P', true);
      return;
    }

    const customIndices = new Set(checkedCbs.map(cb => Number(cb.dataset.globalIndex)));
    const outputMode = document.querySelector('input[name="batch-output"]:checked')?.value || 'zip';
    const format = document.querySelector('input[name="batch-format"]:checked')?.value || 'srt';
    const preference = elements.prefSelect?.value || 'manual-first';
    const withTimestamp = document.querySelector('input[name="batch-timestamp"]:checked')?.value === 'true';

    const config = {
      scope: 'custom',
      customIndices,
      outputMode,
      format,
      preference,
      withTimestamp
    };

    batchControlTask = {};
    elements.batchStartBtn.hidden = true;
    elements.batchPauseBtn.hidden = false;
    elements.batchCancelBtn.hidden = false;
    elements.batchProgressBox.hidden = false;

    const diagLogger = (stage, msg) => {
      if (!state) return;
      if (!state.diagnostics) state.diagnostics = [];
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      state.diagnostics.push(`[${timestamp}] ${stage}：${msg}`);
      if (elements.diagnostics) elements.diagnostics.textContent = state.diagnostics.join('\n');
      if (elements.diagnosticSummary) elements.diagnosticSummary.textContent = `${state.diagnostics.length} 条记录`;
    };

    try {
      const exportResult = await BSE.Bilibili.runBatchExport(currentTree, config, (stats, currentItem, phase, task) => {
        if (phase === 'packing') {
          elements.batchProgressText.textContent = `正在打包 ZIP (${stats.packPercent || 0}%)…`;
          elements.batchProgressBarFill.style.width = `${stats.packPercent || 0}%`;
          elements.batchProgressPercent.textContent = `${stats.packPercent || 0}%`;
        } else if (phase === 'fetching') {
          const percent = Math.round((stats.completed / (stats.total || 1)) * 100);
          elements.batchProgressText.textContent = currentItem ? `正在读取: ${currentItem.title}` : `抓取中 (${stats.completed}/${stats.total})`;
          elements.batchProgressBarFill.style.width = `${percent}%`;
          elements.batchProgressPercent.textContent = `${percent}%`;
        } else if (phase === 'done') {
          const summaryText = stats.failed > 0 || stats.noSub > 0
            ? `✓ 任务完成：成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`
            : `✓ 任务完成：共 ${stats.success} 集字幕已全部下载`;
          elements.batchProgressText.textContent = summaryText;
          elements.batchProgressBarFill.style.width = '100%';
          elements.batchProgressPercent.textContent = '100%';
        }
        elements.batchCntSuccess.textContent = String(stats.success || 0);
        elements.batchCntNosub.textContent = String(stats.noSub || 0);
        elements.batchCntFailed.textContent = String(stats.failed || 0);
      }, batchControlTask, { diagnostic: diagLogger });

      const finalStats = exportResult?.stats || {};
      if (finalStats.failed > 0 || finalStats.noSub > 0) {
        toast(`导出完成：成功 ${finalStats.success || 0}，无字幕 ${finalStats.noSub || 0}，失败 ${finalStats.failed || 0}`);
      } else {
        toast(BSE.I18n?.t('batch_completed_toast') || '✓ 批量导出完成并开始下载');
      }
      setTimeout(() => {
        elements.batchOverlay.hidden = true;
      }, 2500);
    } catch (err) {
      if (err.name !== 'AbortError' && !batchControlTask.cancelled) {
        toast(err.message || '批量导出失败', true);
      }
    } finally {
      elements.batchStartBtn.hidden = false;
      elements.batchPauseBtn.hidden = true;
      elements.batchCancelBtn.hidden = true;
    }
  });

  elements.batchPauseBtn?.addEventListener('click', () => {
    if (!batchControlTask) return;
    batchControlTask.paused = !batchControlTask.paused;
    elements.batchPauseBtn.textContent = batchControlTask.paused ? (BSE.I18n?.t('batch_btn_resume') || '继续') : (BSE.I18n?.t('batch_btn_pause') || '暂停');
  });

  elements.batchCancelBtn?.addEventListener('click', () => {
    if (!batchControlTask) return;
    batchControlTask.cancelled = true;
    batchControlTask.controller?.abort();
    elements.batchOverlay.hidden = true;
  });

  // Keyboard Shortcuts: Esc to close modal, Cmd/Ctrl+F to search
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!elements.batchOverlay.hidden) {
        if (batchControlTask?.running) batchControlTask.cancelled = true;
        elements.batchOverlay.hidden = true;
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      if (elements.search) {
        e.preventDefault();
        elements.search.focus();
        elements.search.select();
      }
    }
  });

  loadInitialState().catch((error) => toast(error.message, true));
  loadAndRenderTracker().catch(() => {});
})();
