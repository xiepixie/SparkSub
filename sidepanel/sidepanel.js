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
    labelInterval: document.querySelector('#label-interval'),
    labelNotify: document.querySelector('#label-notify'),
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
    emptyActions: document.querySelector('#empty-actions'),
    emptyTranscribe: document.querySelector('#empty-transcribe-btn'),
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
    tabTrackerText: document.querySelector('#tab-tracker-text'),
    trackerUnreadBadge: document.querySelector('#tracker-unread-badge'),
    trackerSection: document.querySelector('#tracker-section'),
    trackerQuickBar: document.querySelector('#tracker-quick-bar'),
    trackerQuickAvatar: document.querySelector('#tracker-quick-avatar'),
    trackerQuickCurrentLabel: document.querySelector('#tracker-quick-current-label'),
    trackerQuickSource: document.querySelector('#tracker-current-source'),
    trackerCurrentSource: document.querySelector('#tracker-current-source'),
    trackerQuickAuthorLabel: document.querySelector('#tracker-quick-author-label'),
    trackerCurrentAuthor: document.querySelector('#tracker-current-author'),
    trackerSubscribeUpBtn: document.querySelector('#tracker-subscribe-up-btn'),
    trackerSubscribeSeasonBtn: document.querySelector('#tracker-subscribe-season-btn'),
    trackerFilterAll: document.querySelector('#tracker-filter-all'),
    trackerFilterAllText: document.querySelector('#tracker-filter-all-text'),
    trackerFilterUnread: document.querySelector('#tracker-filter-unread'),
    trackerFilterUnreadText: document.querySelector('#tracker-filter-unread-text'),
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
    trackerImportFile: document.querySelector('#tracker-import-file'),
    // Queue Elements
    tabQueue: document.querySelector('#tab-queue'),
    tabQueueText: document.querySelector('#tab-queue-text'),
    queueRunningBadge: document.querySelector('#queue-running-badge'),
    queueView: document.querySelector('#queue-view'),
    queueBtnShowAdd: document.querySelector('#queue-btn-show-add'),
    queueBtnCopyMerged: document.querySelector('#queue-btn-copy-merged'),
    queueBtnClearDone: document.querySelector('#queue-btn-clear-done'),
    queueInputPanel: document.querySelector('#queue-input-panel'),
    queueBatchInput: document.querySelector('#queue-batch-input'),
    queueSourceLanguage: document.querySelector('#queue-source-language'),
    queueSourceLanguageLabel: document.querySelector('#queue-source-language-label'),
    queueSourceLanguageHint: document.querySelector('#queue-source-language-hint'),
    queueBatchSubmit: document.querySelector('#queue-batch-submit'),
    queueBatchCancel: document.querySelector('#queue-batch-cancel'),
    queueCapabilityPanel: document.querySelector('#queue-capability-panel'),
    queueCapabilityTitle: document.querySelector('#queue-capability-title'),
    queueCapabilityStatus: document.querySelector('#queue-capability-status'),
    queueCapabilityDetails: document.querySelector('#queue-capability-details'),
    queueCapabilityRefresh: document.querySelector('#queue-capability-refresh'),
    queueStatusBar: document.querySelector('#queue-status-bar'),
    queueStatusText: document.querySelector('#queue-status-text'),
    queueCountPill: document.querySelector('#queue-count-pill'),
    queueList: document.querySelector('#queue-list'),
    queueEmpty: document.querySelector('#queue-empty')
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

  let sidepanelDiagnostics = [];
  function appendDiagnostic(stage, msg) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = `[${timestamp}] ${stage}：${msg}`;
    if (!sidepanelDiagnostics.includes(line)) {
      sidepanelDiagnostics.push(line);
      if (sidepanelDiagnostics.length > 500) {
        sidepanelDiagnostics.splice(0, sidepanelDiagnostics.length - 500);
      }
    }
    if (elements.diagnostics) elements.diagnostics.textContent = sidepanelDiagnostics.join('\n');
    if (elements.diagnosticSummary) {
      const fault = state?.lastError;
      elements.diagnosticSummary.textContent = fault
        ? `${fault.stage} · ${fault.code}`
        : `${sidepanelDiagnostics.length} 条记录`;
    }
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
        const tag = track.isTranslated ? '翻译' : (track.isAuto ? autoDoc : ccDoc);
        option.textContent = track.isTranslated
          ? (track.lanDoc || track.lan)
          : `${track.lanDoc || track.lan || 'Default'}（${tag}）`;
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
    elements.tabQueue?.classList.toggle('active', tabId === 'queue');

    if (tabId === 'queue') {
      elements.transcript.hidden = true;
      elements.aiSection.hidden = true;
      if (elements.trackerSection) elements.trackerSection.hidden = true;
      if (elements.queueView) elements.queueView.hidden = false;
      document.querySelector('.toolbar')?.setAttribute('hidden', 'true');
      document.querySelector('.video-bar')?.setAttribute('hidden', 'true');
      loadAndRenderQueue();
      if (!nativeCapabilitiesCache) loadNativeCapabilities(false);
    } else if (tabId === 'tracker') {
      elements.transcript.hidden = true;
      elements.aiSection.hidden = true;
      if (elements.trackerSection) elements.trackerSection.hidden = false;
      if (elements.queueView) elements.queueView.hidden = true;
      document.querySelector('.toolbar')?.setAttribute('hidden', 'true');
      document.querySelector('.video-bar')?.setAttribute('hidden', 'true');
      loadAndRenderTracker();
    } else if (tabId === 'ai') {
      elements.transcript.hidden = true;
      elements.aiSection.hidden = false;
      if (elements.trackerSection) elements.trackerSection.hidden = true;
      if (elements.queueView) elements.queueView.hidden = true;
      document.querySelector('.toolbar')?.setAttribute('hidden', 'true');
      document.querySelector('.video-bar')?.setAttribute('hidden', 'true');
    } else {
      elements.transcript.hidden = false;
      elements.aiSection.hidden = true;
      if (elements.trackerSection) elements.trackerSection.hidden = true;
      if (elements.queueView) elements.queueView.hidden = true;
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
  let trackerStorageStats = null;
  let currentAuthorInfo = null;

  async function loadAndRenderTracker() {
    if (!BSE.Tracker) return;
    trackerLoading = true;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'true');
    if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = t('tracker_status_loading');
    try {
      subscriptionsCache = await BSE.Tracker.getSubscriptions();
      trackerStorageStats = BSE.Tracker.getStorageStats?.(subscriptionsCache) || null;
      trackerLoading = false;
      renderTrackerList();
      updateTrackerCountsAndBadge();
      await updateQuickSubscribeBar();
    } catch (err) {
      console.warn('[BSE Tracker] 读取订阅列表异常:', err);
      if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = `${t('status_error')}：${err?.message || ''}`;
      toast(t('tracker_toast_load_failed'), true);
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
        seasonTitle: state.authorInfo.seasonTitle || (BSE.I18n?.t('tracker_type_season') || '视频合集'),
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

      const upName = owner.name || state.authorInfo?.name || (BSE.I18n?.t('tracker_type_bilibili_up') || 'B站 UP 主');
      const mid = String(owner.mid || state.authorInfo?.mid || state.authorInfo?.targetId || '');
      const avatar = owner.face || state.authorInfo?.avatar || '';

      let seasonId = null;
      let seasonTitle = null;

      if (ugc && (ugc.id || ugc.season_id)) {
        seasonId = String(ugc.id || ugc.season_id);
        seasonTitle = ugc.title || (videoTitle ? `${videoTitle} (合集)` : (BSE.I18n?.t('tracker_type_season') || '视频合集'));
      } else if (state.authorInfo?.seasonId) {
        seasonId = state.authorInfo.seasonId;
        const rawTitle = state.authorInfo.seasonTitle;
        seasonTitle = (rawTitle && rawTitle !== '合集' && rawTitle !== '视频合集')
          ? rawTitle
          : (videoTitle ? `${videoTitle} (合集)` : (BSE.I18n?.t('tracker_type_season') || '视频合集'));
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
        upName: state.authorInfo?.name || (BSE.I18n?.t('tracker_type_youtube_channel') || 'YouTube 频道'),
        targetId: state.authorInfo?.targetId || '',
        avatar: state.authorInfo?.avatar || '',
        videoTitle: state.title || ''
      };
    }

    return null;
  }

  async function updateQuickSubscribeBar() {
    if (!elements.trackerQuickBar) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    currentAuthorInfo = await detectCurrentVideoAuthorInfo();

    const videoTitle = state?.title || currentAuthorInfo?.videoTitle || t('tracker_wait_video');
    if (elements.trackerCurrentSource) {
      elements.trackerCurrentSource.textContent = videoTitle;
      elements.trackerCurrentSource.title = videoTitle;
    }

    if (elements.trackerQuickAvatar) {
      if (currentAuthorInfo?.avatar) {
        elements.trackerQuickAvatar.innerHTML = `<img src="${BSE.Utils.escapeHtml(currentAuthorInfo.avatar)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
      } else if (state?.platform === 'youtube') {
        elements.trackerQuickAvatar.textContent = '▶';
      } else {
        elements.trackerQuickAvatar.textContent = '📺';
      }
    }

    if (elements.trackerQuickAuthorLabel) {
      elements.trackerQuickAuthorLabel.textContent = state?.platform === 'youtube' ? 'CH' : 'UP';
    }

    if (elements.trackerCurrentAuthor) {
      if (currentAuthorInfo && (currentAuthorInfo.upName || currentAuthorInfo.title)) {
        const authName = currentAuthorInfo.upName || currentAuthorInfo.title;
        elements.trackerCurrentAuthor.textContent = authName;
        elements.trackerCurrentAuthor.title = authName;
      } else {
        elements.trackerCurrentAuthor.textContent = state ? (state.platform === 'bilibili' ? t('tracker_type_bilibili_up') : 'YouTube') : t('tracker_wait_connect');
      }
    }

    if (!currentAuthorInfo) {
      if (elements.trackerSubscribeUpBtn) {
        elements.trackerSubscribeUpBtn.disabled = true;
        elements.trackerSubscribeUpBtn.textContent = t('tracker_btn_follow_short');
        elements.trackerSubscribeUpBtn.title = t('tracker_unidentified_author');
      }
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
      const upName = currentAuthorInfo.upName || 'UP';
      elements.trackerSubscribeUpBtn.textContent = !authorTargetId
        ? t('tracker_unidentified_author')
        : (isUpSubscribed ? t('tracker_btn_followed_short') : t('tracker_btn_follow_short'));
      elements.trackerSubscribeUpBtn.title = !authorTargetId
        ? t('tracker_unidentified_author')
        : (isUpSubscribed ? t('tracker_btn_followed_up', { name: upName }) : t('tracker_btn_follow_up', { name: upName }));
    }

    if (currentAuthorInfo.seasonId) {
      const seasonSubId = `${currentAuthorInfo.platform}:season:${currentAuthorInfo.seasonId}`;
      const isSeasonSubscribed = subscriptionsCache.some((s) => s.id === seasonSubId);
      if (elements.trackerSubscribeSeasonBtn) {
        elements.trackerSubscribeSeasonBtn.hidden = false;
        elements.trackerSubscribeSeasonBtn.classList.toggle('subscribed', isSeasonSubscribed);
        const seasonTitle = currentAuthorInfo.seasonTitle || t('tracker_type_season');
        elements.trackerSubscribeSeasonBtn.textContent = isSeasonSubscribed
          ? t('tracker_btn_subbed_season_short')
          : t('tracker_btn_sub_season_short');
        elements.trackerSubscribeSeasonBtn.title = isSeasonSubscribed
          ? t('tracker_btn_subbed_season', { title: seasonTitle })
          : t('tracker_btn_sub_season', { title: seasonTitle });
      }
    } else if (elements.trackerSubscribeSeasonBtn) {
      elements.trackerSubscribeSeasonBtn.hidden = true;
    }
  }

  function getSubscriptionUrl(sub) {
    if (!sub) return '';
    if (sub.sourceUrl) return sub.sourceUrl;
    if (sub.platform === 'bilibili') {
      if (sub.type === 'season') {
        if (sub.items?.[0]?.url) return sub.items[0].url;
        if (sub.targetId && (sub.targetId.startsWith('BV') || sub.targetId.startsWith('av'))) {
          return `https://www.bilibili.com/video/${sub.targetId}`;
        }
        return `https://space.bilibili.com/${sub.ownerId || ''}/channel/collectiondetail?sid=${sub.targetId}`;
      }
      return `https://space.bilibili.com/${sub.targetId}`;
    }
    if (sub.platform === 'youtube') {
      if (sub.type === 'channel') return `https://www.youtube.com/channel/${sub.targetId}`;
      return sub.items?.[0]?.url || `https://www.youtube.com/watch?v=${sub.targetId}`;
    }
    return sub.items?.[0]?.url || '';
  }

  function getSubscriptionBvid(sub) {
    if (!sub) return '';
    if (sub.targetId && /^BV[a-zA-Z0-9]+/i.test(sub.targetId)) return sub.targetId;
    if (sub.items?.[0]?.id && /^BV[a-zA-Z0-9]+/i.test(sub.items[0].id)) return sub.items[0].id;
    if (sub.sourceUrl) {
      const bvid = BSE.Utils?.getBvid?.(sub.sourceUrl);
      if (bvid) return bvid;
    }
    if (sub.items?.[0]?.url) {
      const bvid = BSE.Utils?.getBvid?.(sub.items[0].url);
      if (bvid) return bvid;
    }
    return '';
  }

  function formatTrackerTime(value) {
    const time = Number(value || 0);
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    if (!time) return t('tracker_time_not_checked');
    const deltaMinutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (deltaMinutes < 1) return t('tracker_time_just_now');
    if (deltaMinutes < 60) return t('tracker_time_mins_ago', { n: deltaMinutes });
    if (deltaMinutes < 1440) return t('tracker_time_hours_ago', { n: Math.floor(deltaMinutes / 60) });
    if (deltaMinutes < 10080) return t('tracker_time_days_ago', { n: Math.floor(deltaMinutes / 1440) });
    const locale = BSE.I18n?.getLocale() === 'en' ? 'en-US' : (BSE.I18n?.getLocale() === 'zh-TW' ? 'zh-TW' : 'zh-CN');
    return new Date(time).toLocaleDateString(locale);
  }

  function renderTrackerItem(sub, item, previewId, isUnread) {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const subtitle = item.subtitle;
    let badge = `<span class="tracker-sub-badge not-found">${t('tracker_badge_extract_pending')}</span>`;
    let actions = `<button class="tracker-item-act-btn tracker-btn-copy tracker-btn-retry-sub" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="提取字幕">${t('tracker_btn_extract')}</button>`;
    let preview = '';

    if (subtitle?.status === 'ready') {
      badge = `<span class="tracker-sub-badge ready">${t('tracker_badge_cached', { n: subtitle.cueCount || 0 })}</span>`;
      actions = `
        <button class="tracker-item-act-btn tracker-btn-copy" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="复制字幕">${t('tracker_btn_copy')}</button>
        <button class="tracker-item-act-btn tracker-btn-preview-toggle" data-target="${previewId}" aria-expanded="false" title="展开预览">${t('tracker_btn_preview')}</button>`;
      preview = `<div class="tracker-preview-drawer" id="${previewId}">${BSE.Utils.escapeHtml(subtitle.markdown || subtitle.plainText || '')}</div>`;
    } else if (subtitle?.status === 'pending') {
      badge = `<span class="tracker-sub-badge pending">${t('tracker_badge_extracting')}</span>`;
      actions = '';
    } else if (subtitle?.status === 'not_found' || subtitle?.status === 'error' || subtitle?.status === 'evicted') {
      const label = subtitle.status === 'error' ? t('tracker_badge_error') : (subtitle.status === 'evicted' ? t('tracker_badge_evicted') : t('tracker_badge_no_sub'));
      badge = `<span class="tracker-sub-badge not-found" title="${BSE.Utils.escapeHtml(subtitle.errorHint || '')}">⚪ ${label}</span>`;
      actions = `<button class="tracker-item-act-btn tracker-btn-copy tracker-btn-retry-sub" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="重新提取">${t('tracker_btn_retry')}</button>`;
    }

    return `
      <div class="tracker-item-row${isUnread ? ' is-unread' : ''}">
        <div class="tracker-item-top">
          <div class="tracker-item-title-wrap">
            ${isUnread ? `<span class="tracker-item-unread-dot" aria-label="${t('tracker_tag_unread', { n: 1 })}"></span>` : ''}
            <span class="tracker-item-title" title="${BSE.Utils.escapeHtml(item.title)}">${BSE.Utils.escapeHtml(item.title)}</span>
          </div>
          <span class="tracker-item-time">${formatTrackerTime(item.pubdate)}</span>
        </div>
        <div class="tracker-item-bot">
          ${badge}
          <div class="tracker-item-actions">
            ${actions}
            ${item.url ? `<button class="tracker-item-act-btn tracker-btn-watch" data-url="${BSE.Utils.escapeHtml(item.url)}" title="打开视频播放页">${t('tracker_btn_watch')}</button>` : ''}
          </div>
        </div>
        ${preview}
      </div>`;
  }

  function renderTrackerList() {
    if (!elements.trackerList) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    elements.trackerList.innerHTML = '';

    let list = [...subscriptionsCache];
    if (trackerFilter === 'unread') list = list.filter((sub) => (sub.unreadCount || 0) > 0);
    if (trackerSearchQuery) {
      list = list.filter((sub) => `${sub.title || ''} ${sub.author || ''}`.toLocaleLowerCase().includes(trackerSearchQuery));
    }
    list.sort((a, b) => {
      if (trackerSort === 'name') return String(a.title || '').localeCompare(String(b.title || ''), BSE.I18n?.getLocale() || 'zh-CN');
      if (trackerSort === 'unread') return (b.unreadCount || 0) - (a.unreadCount || 0) || (b.lastCheckedAt || 0) - (a.lastCheckedAt || 0);
      const aActivity = a.items?.[0]?.pubdate || a.lastCheckedAt || a.subscribedAt || 0;
      const bActivity = b.items?.[0]?.pubdate || b.lastCheckedAt || b.subscribedAt || 0;
      return bActivity - aActivity;
    });

    if (elements.trackerEmpty) elements.trackerEmpty.hidden = list.length > 0;
    if (!list.length && elements.trackerEmptyTitle && elements.trackerEmptyDesc) {
      const constrained = trackerFilter === 'unread' || trackerSearchQuery;
      elements.trackerEmptyTitle.textContent = constrained ? t('tracker_empty_title_filtered') : t('tracker_empty_title_all');
      elements.trackerEmptyDesc.textContent = constrained
        ? t('tracker_empty_desc_filtered')
        : t('tracker_empty_desc_all');
    }

    const unreadTotal = subscriptionsCache.reduce((sum, sub) => sum + (sub.unreadCount || 0), 0);
    const copyableUnread = subscriptionsCache.reduce((sum, sub) => {
      const unreadItems = (sub.items || []).slice(0, sub.unreadCount || 0);
      return sum + unreadItems.filter((item) => item.subtitle?.status === 'ready' && (item.subtitle.markdown || item.subtitle.plainText)).length;
    }, 0);
    if (elements.trackerStatusLine) {
      const cacheLabel = trackerStorageStats ? t('tracker_cache_label', { kb: Math.ceil(trackerStorageStats.approximateBytes / 1024) }) : '';
      elements.trackerStatusLine.textContent = t('tracker_status_summary', {
        shown: list.length,
        total: subscriptionsCache.length,
        unread: unreadTotal,
        copyable: copyableUnread,
        cache: cacheLabel
      });
    }
    if (elements.trackerCopyAllBtn) elements.trackerCopyAllBtn.disabled = copyableUnread === 0 || trackerLoading;
    if (elements.trackerReadAllBtn) elements.trackerReadAllBtn.disabled = unreadTotal === 0 || trackerLoading;

    const fragment = document.createDocumentFragment();
    list.forEach((sub, subIndex) => {
      const card = document.createElement('section');
      const hasUnread = (sub.unreadCount || 0) > 0;
      card.className = `tracker-card ${hasUnread ? 'has-unread' : 'is-read'}`;
      card.dataset.id = sub.id;
      const items = sub.items || [];
      const unreadCount = Math.min(sub.unreadCount || 0, items.length);
      const expanded = expandedTrackerCards.has(sub.id);
      const visibleCount = expanded ? items.length : Math.max(1, Math.min(unreadCount || 1, 3));
      const visibleItems = items.slice(0, visibleCount);
      const typeLabel = sub.type === 'season' ? t('tracker_type_season') : (sub.platform === 'youtube' ? t('tracker_type_youtube_channel') : t('tracker_type_bilibili_up'));

      const subUrl = getSubscriptionUrl(sub);
      const openHint = sub.type === 'season' ? '打开合集播放页' : '打开主页';
      const showBatchExport = sub.type === 'season' || items.length > 1 || (sub.platform === 'bilibili' && getSubscriptionBvid(sub));
      const authorText = sub.author || (sub.type === 'up' ? sub.title : '');

      card.innerHTML = `
        <div class="tracker-card-head">
          <div class="tracker-card-brand tracker-card-link" data-url="${BSE.Utils.escapeHtml(subUrl)}" title="${openHint}: ${BSE.Utils.escapeHtml(sub.title)}" role="button" tabindex="0">
            <div class="tracker-avatar-wrap">${sub.avatar ? `<img src="${BSE.Utils.escapeHtml(sub.avatar)}" alt="">` : (sub.platform === 'youtube' ? '▶' : '📺')}</div>
            <div class="tracker-card-meta">
              <div class="tracker-card-title-row">
                <strong class="tracker-card-title">${BSE.Utils.escapeHtml(sub.title)}</strong>
                <span class="tracker-card-open-icon" aria-hidden="true">↗</span>
              </div>
              <div class="tracker-card-subtext">
                ${authorText ? `<span class="tracker-card-author" title="UP主/作者: ${BSE.Utils.escapeHtml(authorText)}">👤 ${BSE.Utils.escapeHtml(authorText)}</span><span class="tracker-card-sep">·</span>` : ''}<span>${typeLabel} · ${items.length} 篇 · ${formatTrackerTime(sub.lastCheckedAt)}</span>
              </div>
            </div>
          </div>
          <div class="tracker-card-head-actions">
            <button class="tracker-card-icon-btn tracker-btn-rename" data-id="${BSE.Utils.escapeHtml(sub.id)}" data-title="${BSE.Utils.escapeHtml(sub.title)}" title="${t('tracker_btn_rename_title')}">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            ${showBatchExport ? `<button class="tracker-card-act-btn tracker-btn-batch-card" data-id="${BSE.Utils.escapeHtml(sub.id)}" title="${t('tracker_btn_batch_card_title')}">${t('tracker_btn_batch_card')}</button>` : ''}
            ${unreadCount ? `<button class="tracker-card-unread-pill tracker-btn-read" data-id="${BSE.Utils.escapeHtml(sub.id)}" title="${t('tracker_btn_mark_card_read')}">${t('tracker_tag_unread', { n: unreadCount })}</button>` : `<span class="tracker-card-tag is-read-tag">✓ ${t('tracker_tag_read')}</span>`}
            <button class="tracker-card-del-btn tracker-btn-del" data-id="${BSE.Utils.escapeHtml(sub.id)}" data-title="${BSE.Utils.escapeHtml(sub.title)}" title="${t('tracker_btn_untrack')}">✕</button>
          </div>
        </div>
        <div class="tracker-items">${visibleItems.map((item, itemIndex) => renderTrackerItem(sub, item, `tracker-preview-${subIndex}-${itemIndex}`, itemIndex < unreadCount)).join('')}</div>
        ${items.length > visibleCount ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}">${t('tracker_btn_expand_more', { n: items.length - visibleCount })}</button>` : (expanded && items.length > 1 ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}">${t('tracker_btn_collapse_more')}</button>` : '')}`;
      fragment.appendChild(card);
    });
    elements.trackerList.appendChild(fragment);
  }

  // === Queue (Background Transcription) State & Methods ===
  let queueCache = [];
  let nativeCapabilitiesCache = null;
  let nativeCapabilitiesError = null;

  function queueLanguageLabel(code) {
    const t = (key) => BSE.I18n?.t(key) || key;
    if (code === 'auto') return t('queue_language_auto');
    if (code === 'zh') return t('queue_language_zh');
    if (code === 'yue') return t('queue_language_yue');
    try {
      const displayNames = new Intl.DisplayNames([BSE.I18n?.getLocale?.() || 'zh-CN'], { type: 'language' });
      return `${displayNames.of(code) || code} [${code}] · Parakeet`;
    } catch {
      return `${code} · Parakeet`;
    }
  }

  function populateQueueLanguageOptions(selectedValue) {
    if (!elements.queueSourceLanguage || !BSE.QueueUI) return;
    const selected = BSE.QueueUI.SUPPORTED_SOURCE_LANGUAGES.includes(selectedValue) ? selectedValue : 'auto';
    const options = BSE.QueueUI.SUPPORTED_SOURCE_LANGUAGES.map((code) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = queueLanguageLabel(code);
      option.selected = code === selected;
      return option;
    });
    elements.queueSourceLanguage.replaceChildren(...options);
    elements.queueSourceLanguage.value = selected;
  }

  async function initializeQueueLanguageControl() {
    if (!BSE.QueueUI || !BSE.Queue?.getSettings) return;
    const selected = await BSE.QueueUI.loadDefaultLanguage(() => BSE.Queue.getSettings());
    populateQueueLanguageOptions(selected);
  }

  function renderNativeCapabilities() {
    if (!BSE.QueueUI || !elements.queueCapabilityPanel || !elements.queueCapabilityStatus || !elements.queueCapabilityDetails) return;
    const t = (key) => BSE.I18n?.t(key) || key;
    BSE.QueueUI.renderCapabilityPanel(
      /** @type {HTMLElement} */ (elements.queueCapabilityPanel),
      /** @type {HTMLElement} */ (elements.queueCapabilityStatus),
      /** @type {HTMLElement} */ (elements.queueCapabilityDetails),
      nativeCapabilitiesCache,
      nativeCapabilitiesError,
      t
    );
  }

  async function loadNativeCapabilities(force = false) {
    if (!elements.queueCapabilityPanel) return;
    const t = (key) => BSE.I18n?.t(key) || key;
    elements.queueCapabilityPanel.hidden = false;
    elements.queueCapabilityPanel.dataset.state = 'checking';
    if (elements.queueCapabilityStatus) elements.queueCapabilityStatus.textContent = t('queue_capability_checking');
    if (elements.queueCapabilityRefresh) elements.queueCapabilityRefresh.disabled = true;
    appendDiagnostic('本机服务', `正在探测端侧模型与服务状态 (force=${force})…`);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'BSE_NATIVE_CAPABILITIES', force });
      if (!response?.ok || !response.capabilities) {
        nativeCapabilitiesCache = null;
        nativeCapabilitiesError = response?.error || { code: 'NATIVE_HOST_DISCONNECTED' };
        appendDiagnostic('本机服务', `探测返回错误：${nativeCapabilitiesError.code || 'UNKNOWN'} · ${nativeCapabilitiesError.message || ''} (提示: ${nativeCapabilitiesError.hint || '无'})`);
      } else {
        nativeCapabilitiesCache = response.capabilities;
        nativeCapabilitiesError = null;
        const caps = response.capabilities;
        appendDiagnostic('本机服务', `探测成功：hostReady=${caps.hostReady} · ytDLP=${caps.ytDLP?.available} (${caps.ytDLP?.detail || ''}) · Parakeet=${caps.models?.parakeet?.available} (${caps.models?.parakeet?.detail || ''}) · Cohere=${caps.models?.cohere?.available} (${caps.models?.cohere?.detail || ''})`);
      }
    } catch (error) {
      nativeCapabilitiesCache = null;
      nativeCapabilitiesError = {
        code: error?.code || 'NATIVE_HOST_DISCONNECTED',
        message: error?.message || ''
      };
      appendDiagnostic('本机服务', `通信异常：${error?.code || 'ERROR'} · ${error?.message || error}`);
    } finally {
      renderNativeCapabilities();
      if (elements.queueCapabilityRefresh) elements.queueCapabilityRefresh.disabled = false;
    }
  }

  const lastLoggedQueueStates = new Map();
  async function loadAndRenderQueue() {
    if (!BSE.Queue) return;
    try {
      queueCache = await BSE.Queue.getQueue();
      renderQueueList();
      updateQueueBadge();
      for (const item of queueCache) {
        const last = lastLoggedQueueStates.get(item.id);
        const currentSig = `${item.stage}:${Math.floor(item.progress || 0)}:${item.stageHint || ''}`;
        if (last !== currentSig) {
          lastLoggedQueueStates.set(item.id, currentSig);
          const stageName = item.stage === 'fetching_audio' ? '音频准备' : (item.stage === 'transcribing' ? '端侧 ASR' : (item.stage === 'done' ? '转录完成' : (item.stage === 'failed' ? '转录失败' : item.stage)));
          appendDiagnostic('转录队列', `[${item.title || item.id}] ${stageName} (${Math.floor(item.progress || 0)}%)：${item.stageHint || '执行中'}`);
        }
      }
      const hasPending = queueCache.some((i) => !['done', 'failed'].includes(i.stage));
      if (hasPending) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[SparkSub Queue] 读取队列异常:', err);
      appendDiagnostic('转录队列', `读取队列异常: ${err?.message || err}`);
    }
  }

  function updateQueueBadge() {
    const runningCount = queueCache.filter((i) => !['done', 'failed'].includes(i.stage)).length;
    if (elements.queueRunningBadge) {
      if (runningCount > 0) {
        elements.queueRunningBadge.hidden = false;
        elements.queueRunningBadge.textContent = String(runningCount);
      } else {
        elements.queueRunningBadge.hidden = true;
      }
    }
    if (elements.queueCountPill) {
      elements.queueCountPill.textContent = `${queueCache.length} 项`;
    }
    if (elements.queueStatusText) {
      elements.queueStatusText.textContent = runningCount > 0
        ? `正在处理中 (${runningCount} 项进行中)…`
        : (queueCache.length > 0 ? '所有转录已完成' : '队列就绪');
    }
  }

  const expandedQueueCards = new Set();

  function renderQueueList() {
    if (!elements.queueList) return;
    if (!queueCache.length) {
      elements.queueList.innerHTML = '';
      if (elements.queueEmpty) elements.queueEmpty.hidden = false;
      return;
    }
    if (elements.queueEmpty) elements.queueEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    for (const item of queueCache) {
      const card = document.createElement('div');
      card.className = `queue-card is-${item.stage}`;

      const stageLabels = {
        queued: '⏳ 排队中',
        resolving: '🔍 解析中',
        fetching_caption: '📥 提取字幕',
        fetching_audio: '🎵 探测音频',
        transcribing: '⚡ 转录中',
        postprocessing: '📝 格式化',
        done: item.subtitle?.cueCount ? `✓ ${item.subtitle.cueCount} 句字幕` : '✓ 已就绪',
        failed: '✕ 失败'
      };

      const stageText = stageLabels[item.stage] || item.stage;
      const progressValue = Number(item.progress);
      const progressPercent = item.stage === 'done' ? 100 : Math.max(0, Math.min(100, Number.isFinite(progressValue) ? progressValue : 0));
      const displayHint = item.stageHint || stageText;
      const isExpanded = expandedQueueCards.has(item.id);
      const isBili = item.platform === 'bilibili';
      const t = (key) => BSE.I18n?.t(key) || key;
      const safeId = BSE.Utils.escapeHtml(item.id || '');
      const sourceLabel = item.stage === 'done' && item.subtitle && BSE.QueueUI
        ? t(BSE.QueueUI.sourceEngineLabel(item).key)
        : '';
      const failure = item.stage === 'failed' && BSE.QueueUI
        ? BSE.QueueUI.safeFailurePresentation(item)
        : null;

      let actionButtonsHtml = '';
      if (item.stage === 'done') {
        actionButtonsHtml = `
          <button type="button" class="queue-act-btn primary btn-apply" data-id="${safeId}" title="将此字幕载入到当前播放器与字幕全文">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>载入字幕</span>
          </button>
          <button type="button" class="queue-act-btn btn-preview ${isExpanded ? 'active' : ''}" data-id="${safeId}" title="展开/收起内联字幕预览">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>预览</span>
          </button>
          <button type="button" class="queue-act-btn btn-copy" data-id="${safeId}" title="复制 Markdown 字幕全文">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>复制</span>
          </button>
          <button type="button" class="queue-act-btn btn-download-txt" data-id="${safeId}" title="下载纯文本 TXT">
            <span>TXT</span>
          </button>
          <button type="button" class="queue-act-btn btn-download-srt" data-id="${safeId}" title="下载 SRT 字幕">
            <span>SRT</span>
          </button>
        `;
      } else if (item.stage === 'failed') {
        actionButtonsHtml = `
          <button type="button" class="queue-act-btn primary btn-retry" data-id="${safeId}" title="重新执行转录">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>重试</span>
          </button>
        `;
      }

      card.innerHTML = `
        <button type="button" class="queue-card-del-btn btn-remove" data-id="${safeId}" title="从队列中移除">✕</button>
        <div class="queue-card-main">
          <div class="queue-thumb-wrap" title="点击在新标签页打开视频">
            <img class="queue-thumb-img" src="${BSE.Utils.escapeHtml(item.cover || 'data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 60\' fill=\'%23334155\'><text x=\'50\' y=\'35\' fill=\'%2394a3b8\' font-size=\'14\' text-anchor=\'middle\'>SparkSub</text></svg>')}" alt="cover" loading="lazy">
            <span class="queue-thumb-tag ${isBili ? 'bilibili' : 'youtube'}">${isBili ? 'B站' : 'YT'}</span>
            <div class="queue-thumb-hover-overlay">▶</div>
          </div>
          <div class="queue-card-body">
            <a class="queue-card-title" href="${BSE.Utils.escapeHtml(item.url || '#')}" target="_blank" title="${BSE.Utils.escapeHtml(item.title)} (点击打开视频)">
              ${BSE.Utils.escapeHtml(item.title)}
            </a>
            <div class="queue-card-meta-line">
              <span class="queue-meta-author" title="作者">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>${BSE.Utils.escapeHtml(item.author || (isBili ? 'UP主' : '频道'))}</span>
              </span>
              ${sourceLabel ? `<span class="queue-source-engine">${BSE.Utils.escapeHtml(sourceLabel)}</span>` : ''}
            </div>
            <div class="queue-card-status-line">
              <span class="queue-status-badge stage-${item.stage}" title="${BSE.Utils.escapeHtml(displayHint)}">
                ${BSE.Utils.escapeHtml(displayHint)}
              </span>
            </div>
          </div>
        </div>
        ${actionButtonsHtml ? `
          <div class="queue-card-actions-bar">
            ${actionButtonsHtml}
          </div>
        ` : ''}
        ${item.stage !== 'done' && item.stage !== 'failed' ? `
          <div class="queue-card-progress">
            <div class="queue-card-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        ` : ''}
        ${failure ? `
          <div class="queue-failure-detail" role="status">
            <code>${BSE.Utils.escapeHtml(failure.code)}</code>
            <span>${BSE.Utils.escapeHtml(failure.hint || t('queue_error_safe_hint'))}</span>
            <span class="queue-failure-retryability">${BSE.Utils.escapeHtml(t(failure.retriable ? 'queue_error_retriable' : 'queue_error_not_retriable'))}</span>
          </div>
        ` : ''}
        ${item.subtitle?.plainText ? `
          <div class="queue-preview-drawer ${isExpanded ? 'open' : ''}">
            <div class="queue-preview-toolbar">
              <span class="queue-preview-stats">共 ${item.subtitle.cueCount || 0} 行字幕 · ${item.subtitle.langDoc || item.subtitle.language || '中文'}</span>
              <button type="button" class="queue-preview-copy-btn btn-quick-copy" title="复制预览内容">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>复制全文</span>
              </button>
            </div>
            <div class="queue-preview-body">${BSE.Utils.escapeHtml(item.subtitle.plainText)}</div>
          </div>
        ` : ''}
      `;

      // Event Listeners for Card
      const openVideo = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.url) window.open(item.url, '_blank');
      };

      card.querySelector('.queue-thumb-wrap')?.addEventListener('click', openVideo);
      card.querySelector('.queue-card-title')?.addEventListener('click', openVideo);

      card.querySelector('.btn-apply')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const cues = item.subtitle?.cues;
          if (tab?.id != null && Array.isArray(cues) && cues.length) {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'BSE_APPLY_EXTERNAL_SUBTITLE',
              track: {
                id: `transcribed-${item.id}`,
                name: `🎙️ 端侧本地转录 (${item.subtitle?.cueCount || cues.length} 句)`,
                language: item.subtitle?.language || 'zh',
                langDoc: item.subtitle?.langDoc || '本地端侧转录',
                isAi: true,
                source: 'native',
                engine: item.subtitle?.engine || 'local-asr'
              },
              cues
            }).catch(() => {});
            switchTab('timestamp');
            toast(`✓ 已载入 ${cues.length} 句字幕到播放器与侧边栏`);
          } else {
            toast('当前标签页不可用或该任务无字幕数据', true);
          }
        } catch (err) {
          toast(`载入失败：${err.message}`, true);
        }
      });

      card.querySelector('.btn-preview')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedQueueCards.has(item.id)) {
          expandedQueueCards.delete(item.id);
        } else {
          expandedQueueCards.add(item.id);
        }
        const drawer = card.querySelector('.queue-preview-drawer');
        const btn = card.querySelector('.btn-preview');
        const nowOpen = expandedQueueCards.has(item.id);
        drawer?.classList.toggle('open', nowOpen);
        btn?.classList.toggle('active', nowOpen);
      });

      card.querySelector('.btn-quick-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = item.subtitle?.markdown || item.subtitle?.plainText || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toTxt(item.subtitle.cues, false) : '');
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            toast(`✓ 已复制《${item.title || '当前视频'}》字幕全文`);
          } catch {
            toast('复制失败，请重试', true);
          }
        } else {
          toast('暂无可复制的字幕内容', true);
        }
      });

      card.querySelector('.btn-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const md = item.subtitle?.markdown || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toMd(item.subtitle.cues, metadata()) : '') || item.subtitle?.plainText || '';
        if (md) {
          try {
            await navigator.clipboard.writeText(md);
            toast(`✓ 已复制《${item.title || '当前视频'}》Markdown 字幕`);
          } catch {
            toast('复制失败，请重试', true);
          }
        } else {
          toast('暂无可复制的字幕内容', true);
        }
      });

      card.querySelector('.btn-download-txt')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = item.subtitle?.plainText || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toTxt(item.subtitle.cues, false) : '');
        if (text) {
          const filename = `${item.title || item.id || 'transcript'}.txt`;
          BSE.Utils.downloadText(text, filename, 'text/plain;charset=utf-8');
          toast(`✓ 已开始下载纯文本字幕：${filename}`);
        } else {
          toast('暂无可下载的纯文本字幕', true);
        }
      });

      card.querySelector('.btn-download-srt')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const srt = item.subtitle?.srt || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toSrt(item.subtitle.cues) : '');
        if (srt) {
          const filename = `${item.title || item.id || 'transcript'}.srt`;
          BSE.Utils.downloadText(srt, filename, 'application/x-subrip;charset=utf-8');
          toast(`✓ 已开始下载 SRT 字幕：${filename}`);
        } else {
          toast('暂无可下载的 SRT 字幕', true);
        }
      });

      card.querySelector('.btn-retry')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_RETRY', id: item.id });
          if (!response?.ok || !response.item) throw new Error(response?.error || '无法重新排队');
          toast('已重新排队，正在执行…');
          await loadAndRenderQueue();
        } catch (error) {
          toast(`重试失败：${error?.message || '后台服务不可用'}`, true);
        }
      });

      card.querySelector('.btn-remove')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_REMOVE', id: item.id });
          if (!response?.ok) throw new Error(response?.error || '无法移除任务');
          await loadAndRenderQueue();
        } catch (error) {
          toast(`移除失败：${error?.message || '后台服务不可用'}`, true);
        }
      });

      frag.appendChild(card);
    }
    elements.queueList.innerHTML = '';
    elements.queueList.appendChild(frag);
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
        if (elements.emptyActions) elements.emptyActions.hidden = true;
      } else if (state?.status === 'empty') {
        message = state.message || (BSE.I18n?.t('no_subtitles') || '当前视频没有可用字幕轨道');
        if (elements.emptyActions) elements.emptyActions.hidden = false;
      } else if (state?.status === 'loading') {
        message = state.message || (BSE.I18n?.t('status_loading') || '正在解析字幕…');
        if (elements.emptyActions) elements.emptyActions.hidden = true;
      } else {
        if (elements.emptyActions) elements.emptyActions.hidden = true;
      }
      elements.empty.querySelector('p').textContent = message;
      return;
    }

    if (elements.emptyActions) elements.emptyActions.hidden = true;

    // cueRevision changes only when a new subtitle body is committed. Using the
    // general state revision here would rebuild a large transcript for status or
    // diagnostic-only updates; using only cues.length misses same-size refreshes.
    const currentKey = `${state?.mediaKey}:${state?.selectedTrackId}:${state?.cueRevision || 0}:${cues.length}:${currentTab}`;
    if (renderedMediaKey !== currentKey) {
      renderedMediaKey = currentKey;
      elements.transcript.querySelectorAll('.cue, .paragraph').forEach((item) => item.remove());
      const fragment = document.createDocumentFragment();

      if (currentTab === 'plain') {
        const paragraphs = BSE.Formatters.mergeParagraphs(cues).split('\n\n');
        paragraphs.forEach((pText) => {
          const p = document.createElement('div');
          p.className = 'paragraph';

          const content = document.createElement('div');
          content.className = 'paragraph-body';
          content.textContent = pText;

          const copyBtn = document.createElement('button');
          copyBtn.className = 'cue-copy-btn paragraph-copy-btn';
          copyBtn.title = '复制本段';
          copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

          p.append(content, copyBtn);
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
    if (Array.isArray(state?.diagnostics)) {
      for (const line of state.diagnostics) {
        if (!sidepanelDiagnostics.includes(line)) {
          sidepanelDiagnostics.push(line);
        }
      }
    }
    if (elements.diagnosticSummary) {
      elements.diagnosticSummary.textContent = fault
        ? `${fault.stage} · ${fault.code}`
        : (sidepanelDiagnostics.length ? `${sidepanelDiagnostics.length} 条记录` : (BSE.I18n?.t('status_ready') || '就绪'));
    }
    if (elements.diagnosticCode) elements.diagnosticCode.textContent = fault ? `${fault.stage} / ${fault.code}` : (BSE.I18n?.t('no_error') || '尚无错误');
    if (elements.diagnosticHint) elements.diagnosticHint.textContent = fault?.hint || (BSE.I18n?.t('diagnostic_hint') || '提取过程会在这里显示每个请求阶段。');
    if (elements.diagnostics) {
      elements.diagnostics.textContent = sidepanelDiagnostics.length
        ? sidepanelDiagnostics.join('\n')
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
    try {
      const result = await chrome.runtime.sendMessage({ type: 'BSE_GET_ACTIVE_STATE' });
      activeTabId = result?.tab?.id || null;
      if (result?.state) {
        renderState(result.state);
      } else {
        const isBili = result?.tab?.url && /bilibili\.com/i.test(result.tab.url);
        const isYt = result?.tab?.url && /youtube\.com|youtu\.be/i.test(result.tab.url);
        renderState({
          status: 'empty',
          platform: isBili ? 'bilibili' : (isYt ? 'youtube' : 'unknown'),
          message: BSE.I18n?.t('no_subtitles') || '当前页面未检测到视频字幕',
          cues: [],
          tracks: [],
          title: result?.tab?.title || ''
        });
      }
    } catch {
      // Ignore
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BSE_ACTIVE_TAB_CHANGED') {
      activeTabId = message.tabId;
      if (message.state) {
        renderState(message.state);
      } else {
        loadInitialState();
      }
    } else if (message?.type === 'BSE_STATE_BROADCAST' && (!activeTabId || message.tabId === activeTabId)) {
      activeTabId = message.tabId;
      if (message.state) {
        renderState(message.state);
      } else {
        loadInitialState();
      }
    } else if (message?.type === 'BSE_PLAYBACK_BROADCAST' && message.tabId === activeTabId) {
      updatePlayback(message.activeIndex);
    } else if (message?.type === 'BSE_QUEUE_UPDATED') {
      loadAndRenderQueue();
    } else if (message?.type === 'BSE_DIAGNOSTIC_APPEND') {
      appendDiagnostic(message.stage || '端侧大模型', message.message || '');
    }
  });

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        const hasQueueChanges = Object.keys(changes || {}).some((k) => k.startsWith('bse_transcription_queue_v1'));
        if (hasQueueChanges) {
          loadAndRenderQueue();
        }
      }
    });
  }

  window.addEventListener('focus', () => {
    loadInitialState();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadInitialState();
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
    if (elements.settingsTitle) elements.settingsTitle.textContent = t('settings_title');
    if (elements.settingsToggle) elements.settingsToggle.title = t('settings_title');
    if (elements.labelTheme) elements.labelTheme.textContent = t('theme_label');
    if (elements.labelLang) elements.labelLang.textContent = t('lang_label');
    if (elements.labelPref) elements.labelPref.textContent = t('pref_subtitle_label');
    if (elements.labelSize) elements.labelSize.textContent = t('pref_size_label');
    if (elements.labelInterval) elements.labelInterval.textContent = t('tracker_setting_interval_label');
    if (elements.labelNotify) elements.labelNotify.textContent = t('tracker_setting_notify_label');
    if (elements.trackerExportBtn) elements.trackerExportBtn.textContent = t('tracker_setting_export_btn');
    if (elements.trackerImportBtn) elements.trackerImportBtn.textContent = t('tracker_setting_import_btn');
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
    if (elements.tabTrackerText) elements.tabTrackerText.textContent = t('tab_tracker');
    if (elements.tabQueueText) elements.tabQueueText.textContent = t('tab_queue');
    if (elements.queueBtnShowAdd?.querySelector('span')) elements.queueBtnShowAdd.querySelector('span').textContent = t('queue_btn_add_batch');
    if (elements.queueBtnCopyMerged?.querySelector('span')) elements.queueBtnCopyMerged.querySelector('span').textContent = t('queue_btn_copy_merged');
    if (elements.queueBtnClearDone?.querySelector('span')) elements.queueBtnClearDone.querySelector('span').textContent = t('queue_btn_clear_done');
    if (elements.queueBatchSubmit) elements.queueBatchSubmit.textContent = t('queue_btn_submit_batch');
    if (elements.queueBatchCancel) elements.queueBatchCancel.textContent = t('batch_btn_cancel');
    if (elements.queueSourceLanguageLabel) elements.queueSourceLanguageLabel.textContent = t('queue_source_language_label');
    if (elements.queueSourceLanguageHint) elements.queueSourceLanguageHint.textContent = t('queue_source_language_hint');
    if (elements.queueSourceLanguage) populateQueueLanguageOptions(elements.queueSourceLanguage.value || 'auto');
    if (elements.queueCapabilityTitle) elements.queueCapabilityTitle.textContent = t('queue_capabilities_title');
    if (elements.queueCapabilityRefresh) elements.queueCapabilityRefresh.title = t('queue_capability_refresh');
    if (nativeCapabilitiesCache || nativeCapabilitiesError) renderNativeCapabilities();
    if (elements.queueEmptyTitle) elements.queueEmptyTitle.textContent = t('queue_empty_title');
    if (elements.queueEmptyDesc) elements.queueEmptyDesc.textContent = t('queue_empty_desc');
    if (elements.batchBtnText) elements.batchBtnText.textContent = t('btn_batch_export');
    if (elements.aiTitle) elements.aiTitle.textContent = t('ai_summary_title');
    if (elements.aiCardSummary) elements.aiCardSummary.textContent = t('ai_prompt_summary');
    if (elements.aiCardKeypoints) elements.aiCardKeypoints.textContent = t('ai_prompt_keypoints');
    if (elements.aiCardNotes) elements.aiCardNotes.textContent = t('ai_prompt_notes');
    if (elements.aiCardQuestions) elements.aiCardQuestions.textContent = t('ai_prompt_questions');

    // Tracker UI Static & Dropdown Elements
    if (elements.trackerQuickAuthorLabel) elements.trackerQuickAuthorLabel.textContent = state?.platform === 'youtube' ? 'CH' : 'UP';
    if (elements.trackerFilterAllText) elements.trackerFilterAllText.textContent = t('tracker_filter_all', { n: 0 }).replace(/\s*\(.*\)/, '');
    if (elements.trackerFilterUnreadText) elements.trackerFilterUnreadText.textContent = t('tracker_filter_unread', { n: 0 }).replace(/\s*\(.*\)/, '');
    if (elements.trackerCopyAllBtn) {
      elements.trackerCopyAllBtn.title = t('tracker_tool_copy_unread_title');
      elements.trackerCopyAllBtn.setAttribute('aria-label', t('tracker_tool_copy_unread'));
    }
    if (elements.trackerCheckAllBtn) {
      elements.trackerCheckAllBtn.title = t('tracker_tool_check_all_title');
      elements.trackerCheckAllBtn.setAttribute('aria-label', t('tracker_tool_refresh'));
    }
    if (elements.trackerReadAllBtn) {
      elements.trackerReadAllBtn.title = t('tracker_tool_mark_all_read_title');
      elements.trackerReadAllBtn.setAttribute('aria-label', t('tracker_tool_mark_read'));
    }
    if (elements.trackerSearchInput) elements.trackerSearchInput.placeholder = t('tracker_search_placeholder');

    if (elements.trackerIntervalSelect && elements.trackerIntervalSelect.options?.length >= 4) {
      const curVal = elements.trackerIntervalSelect.value;
      elements.trackerIntervalSelect.options[0].textContent = t('tracker_setting_interval_30m');
      elements.trackerIntervalSelect.options[1].textContent = t('tracker_setting_interval_1h');
      elements.trackerIntervalSelect.options[2].textContent = t('tracker_setting_interval_3h');
      elements.trackerIntervalSelect.options[3].textContent = t('tracker_setting_interval_manual');
      elements.trackerIntervalSelect.value = curVal;
    }

    if (elements.trackerNotifySelect && elements.trackerNotifySelect.options?.length >= 2) {
      const curVal = elements.trackerNotifySelect.value;
      elements.trackerNotifySelect.options[0].textContent = t('tracker_setting_notify_on');
      elements.trackerNotifySelect.options[1].textContent = t('tracker_setting_notify_badge_only');
      elements.trackerNotifySelect.value = curVal;
    }

    if (elements.trackerSortSelect && elements.trackerSortSelect.options?.length >= 3) {
      const curVal = elements.trackerSortSelect.value;
      elements.trackerSortSelect.options[0].textContent = t('tracker_sort_activity');
      elements.trackerSortSelect.options[1].textContent = t('tracker_sort_unread');
      elements.trackerSortSelect.options[2].textContent = t('tracker_sort_name');
      elements.trackerSortSelect.value = curVal;
    }

    updateQuickSubscribeBar().catch(() => {});
    if (currentTab === 'tracker') {
      renderTrackerList();
    }
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
  elements.tabQueue?.addEventListener('click', () => switchTab('queue'));

  // Queue Toolbar & Batch Actions
  elements.queueBtnShowAdd?.addEventListener('click', () => {
    if (elements.queueInputPanel) {
      elements.queueInputPanel.hidden = !elements.queueInputPanel.hidden;
      if (!elements.queueInputPanel.hidden && elements.queueBatchInput) {
        elements.queueBatchInput.focus();
      }
    }
  });

  elements.queueBatchCancel?.addEventListener('click', () => {
    if (elements.queueInputPanel) elements.queueInputPanel.hidden = true;
  });

  elements.queueSourceLanguage?.addEventListener('change', async () => {
    if (!BSE.QueueUI || !BSE.Queue?.saveSettings) return;
    const saved = await BSE.QueueUI.saveDefaultLanguage(
      elements.queueSourceLanguage.value,
      (partial) => BSE.Queue.saveSettings(partial)
    );
    elements.queueSourceLanguage.value = saved.sourceLanguage || 'auto';
  });

  elements.emptyTranscribe?.addEventListener('click', async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const targetUrl = activeTab?.url || (state?.mediaKey ? (state.mediaKey.startsWith('bili:') ? `https://www.bilibili.com/video/${state.mediaKey.split(':')[1]}` : (state.mediaKey.startsWith('yt:') ? `https://www.youtube.com/watch?v=${state.mediaKey.split(':')[1]}` : null)) : null);
      if (!targetUrl) {
        toast('未定位到有效视频链接', true);
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: 'BSE_QUEUE_ENQUEUE',
        urls: [targetUrl],
        options: { sourceLanguage: elements.queueSourceLanguage?.value || 'auto' }
      });
      if (!response?.ok) throw new Error(response?.error || '无法加入队列');
      chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
      switchTab('queue');
      toast('已加入离线转录队列，正在进行端侧语音识别…');
      await loadAndRenderQueue();
    } catch (err) {
      toast(`发起转录失败：${err.message || String(err)}`, true);
    }
  });

  elements.queueCapabilityRefresh?.addEventListener('click', () => {
    loadNativeCapabilities(true);
  });

  elements.queueBatchSubmit?.addEventListener('click', async () => {
    const rawText = elements.queueBatchInput?.value || '';
    const urls = rawText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!urls.length) {
      toast('请输入有效的视频链接或BV号', true);
      return;
    }
    try {
      const sourceLanguage = elements.queueSourceLanguage?.value || 'auto';
      if (!BSE.QueueUI) throw new Error('Queue UI is unavailable');
      const items = await BSE.QueueUI.enqueueWithLanguage({
        urls,
        sourceLanguage,
        sendMessage: (message) => chrome.runtime.sendMessage(message)
      });

      if (items.length) {
        toast(`已成功添加 ${items.length} 个任务到队列`);
        if (elements.queueBatchInput) elements.queueBatchInput.value = '';
        if (elements.queueInputPanel) elements.queueInputPanel.hidden = true;
        await loadAndRenderQueue();
        chrome.runtime?.sendMessage?.({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
      } else {
        toast('添加失败，请检查链接格式', true);
      }
    } catch (err) {
      toast('请求失败', true);
    }
  });

  elements.queueBtnCopyMerged?.addEventListener('click', async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_EXPORT_MERGED' });
      if (res?.ok && res.markdown) {
        await navigator.clipboard.writeText(res.markdown);
        toast('✓ 已复制全部已完成视频的合并 Markdown');
      } else {
        toast('暂无已完成的转录内容可导出', true);
      }
    } catch (err) {
      toast('复制失败', true);
    }
  });

  elements.queueBtnClearDone?.addEventListener('click', async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_CLEAR_COMPLETED' });
      toast(`已清理 ${res?.count || 0} 项已完成任务`);
      await loadAndRenderQueue();
    } catch {
      toast('清理失败', true);
    }
  });

  // Tracker Subscriptions Event Listeners
  elements.trackerSubscribeUpBtn?.addEventListener('click', async () => {
    if (!currentAuthorInfo || !currentAuthorInfo.targetId) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const subId = `${currentAuthorInfo.platform}:${currentAuthorInfo.type || 'up'}:${currentAuthorInfo.mid || currentAuthorInfo.targetId}`;
    const exists = subscriptionsCache.some((s) => s.id === subId);
    const upName = currentAuthorInfo.upName || currentAuthorInfo.title || 'UP';
    if (exists) {
      await BSE.Tracker.removeSubscription(subId);
      toast(t('tracker_toast_untracked', { name: upName }));
    } else {
      await BSE.Tracker.addSubscription({
        id: subId,
        platform: currentAuthorInfo.platform,
        type: currentAuthorInfo.type || 'up',
        title: upName,
        author: upName,
        avatar: currentAuthorInfo.avatar,
        targetId: currentAuthorInfo.mid || currentAuthorInfo.targetId,
        sourceUrl: state?.url || ''
      });
      toast(t('tracker_toast_tracked_up', { name: upName }));
    }
    await loadAndRenderTracker();
    chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
  });

  elements.trackerSubscribeSeasonBtn?.addEventListener('click', async () => {
    if (!currentAuthorInfo || !currentAuthorInfo.seasonId) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const subId = `${currentAuthorInfo.platform}:season:${currentAuthorInfo.seasonId}`;
    const exists = subscriptionsCache.some((s) => s.id === subId);
    const seasonTitle = currentAuthorInfo.seasonTitle || currentAuthorInfo.title || t('tracker_type_season');
    if (exists) {
      await BSE.Tracker.removeSubscription(subId);
      toast(t('tracker_toast_untracked_season', { title: seasonTitle }));
    } else {
      await BSE.Tracker.addSubscription({
        id: subId,
        platform: currentAuthorInfo.platform,
        type: 'season',
        title: seasonTitle,
        author: currentAuthorInfo.upName || currentAuthorInfo.title || '',
        ownerId: currentAuthorInfo.mid || '',
        avatar: currentAuthorInfo.avatar,
        targetId: currentAuthorInfo.seasonId,
        sourceUrl: state?.url || ''
      });
      toast(t('tracker_toast_tracked_season', { title: seasonTitle }));
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
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    if (elements.trackerCheckAllBtn) {
      elements.trackerCheckAllBtn.classList.add('busy');
      elements.trackerCheckAllBtn.disabled = true;
    }
    toast(t('tracker_toast_checking'));
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_TRACKER_CHECK_NOW' });
      if (res?.error) throw new Error(res.error);
      await loadAndRenderTracker();
      const updatedCount = (res?.updatedSubs || []).length;
      if (updatedCount > 0) {
        toast(t('tracker_toast_updates_found', { n: updatedCount }));
      } else {
        toast(t('tracker_toast_no_updates'));
      }
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err.message }), true);
    } finally {
      if (elements.trackerCheckAllBtn) {
        elements.trackerCheckAllBtn.classList.remove('busy');
        elements.trackerCheckAllBtn.disabled = false;
      }
    }
  });

  elements.trackerReadAllBtn?.addEventListener('click', async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    await BSE.Tracker?.markAllAsRead?.();
    await loadAndRenderTracker();
    chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
    toast(t('tracker_toast_marked_all_read'));
  });

  elements.trackerCopyAllBtn?.addEventListener('click', async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
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
      toast(t(skippedWithoutSubtitle ? 'tracker_toast_copy_unread_pending' : 'tracker_toast_copy_unread_empty'), true);
      return;
    }

    const mergedMd = BSE.Tracker.exportMergedMarkdown(unreadItems);
    await navigator.clipboard.writeText(mergedMd);
    const skipText = skippedWithoutSubtitle ? t('tracker_toast_copy_unread_skip', { n: skippedWithoutSubtitle }) : '';
    toast(`${t('tracker_toast_copy_unread_success', { n: unreadItems.length })}${skipText}`);
  });

  elements.trackerList?.addEventListener('click', async (e) => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const copyBtn = e.target.closest('.tracker-btn-copy:not(.tracker-btn-retry-sub)');
    if (copyBtn) {
      const subId = copyBtn.dataset.subId;
      const itemId = copyBtn.dataset.itemId;
      const sub = subscriptionsCache.find((s) => s.id === subId);
      const item = (sub?.items || []).find((i) => i.id === itemId);
      if (item?.subtitle?.markdown) {
        await navigator.clipboard.writeText(item.subtitle.markdown);
        toast(t('tracker_toast_copied_md', { title: item.title }));
      } else if (item?.subtitle?.plainText) {
        await navigator.clipboard.writeText(item.subtitle.plainText);
        toast(t('tracker_toast_copied_txt', { title: item.title }));
      } else {
        toast(t('tracker_toast_extract_not_ready'), true);
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
        previewBtn.textContent = open ? t('tracker_btn_collapse') : t('tracker_btn_preview');
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
      retrySubBtn.textContent = t('tracker_tool_refreshing');
      retrySubBtn.disabled = true;
      try {
        const subRes = await BSE.Tracker.fetchSubtitleForItem(subId, itemId);
        await loadAndRenderTracker();
        if (subRes.status === 'ready') {
          toast(t('tracker_toast_extract_success', { title: itemId, n: subRes.cueCount || 0 }));
        } else {
          toast(t('tracker_toast_extract_failed', { error: subRes.errorHint || t('tracker_badge_no_sub') }), true);
        }
      } catch (err) {
        toast(t('tracker_toast_extract_failed', { error: err.message }), true);
      }
      return;
    }

    const cardLink = e.target.closest('.tracker-card-link');
    if (cardLink && !e.target.closest('button')) {
      const url = cardLink.dataset.url;
      if (url) chrome.tabs.create({ url });
      return;
    }

    const renameBtn = e.target.closest('.tracker-btn-rename');
    if (renameBtn) {
      const subId = renameBtn.dataset.id;
      const oldTitle = renameBtn.dataset.title || '';
      const newTitle = window.prompt(t('tracker_prompt_rename'), oldTitle);
      if (newTitle && newTitle.trim() && newTitle.trim() !== oldTitle) {
        await BSE.Tracker?.renameSubscription?.(subId, newTitle.trim());
        await loadAndRenderTracker();
        toast(t('tracker_toast_renamed', { title: newTitle.trim() }));
      }
      return;
    }

    const batchCardBtn = e.target.closest('.tracker-btn-batch-card');
    if (batchCardBtn) {
      const subId = batchCardBtn.dataset.id;
      const sub = subscriptionsCache.find((s) => s.id === subId);
      if (!sub) return;

      const bvid = getSubscriptionBvid(sub);
      if (bvid && typeof openBatchModal === 'function') {
        openBatchModal(bvid);
        return;
      }

      const readyItems = (sub.items || []).filter((item) => item.subtitle?.status === 'ready' && (item.subtitle.markdown || item.subtitle.plainText));
      if (!readyItems.length) {
        toast(t('tracker_toast_batch_no_sub'), true);
        return;
      }
      const mergedMd = BSE.Tracker.exportMergedMarkdown(readyItems.map(i => ({ ...i, author: i.author || sub.author || sub.title })));
      await navigator.clipboard.writeText(mergedMd);
      toast(t('tracker_toast_batch_copied', { title: sub.title, n: readyItems.length }));
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
        toast(t('tracker_toast_marked_read'));
      }
      return;
    }
    const delBtn = e.target.closest('.tracker-btn-del');
    if (delBtn) {
      const id = delBtn.dataset.id;
      const title = delBtn.dataset.title || t('tracker_type_season');
      if (id && window.confirm(t('tracker_confirm_untrack', { title }))) {
        await BSE.Tracker?.removeSubscription?.(id);
        await loadAndRenderTracker();
        chrome.runtime.sendMessage({ type: 'BSE_TRACKER_UPDATE_BADGE' }).catch(() => {});
        toast(t('tracker_toast_untracked', { name: title }));
      }
      return;
    }
  });

  elements.trackerList?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const cardLink = e.target.closest('.tracker-card-link');
      if (cardLink && !e.target.closest('button')) {
        e.preventDefault();
        const url = cardLink.dataset.url;
        if (url) chrome.tabs.create({ url });
      }
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
      const t = (k, p) => BSE.I18n?.t(k, p) || k;
      toast(t('tracker_toast_interval_saved'));
    });

    elements.trackerNotifySelect?.addEventListener('change', async () => {
      const val = elements.trackerNotifySelect.value === 'true';
      await BSE.Tracker?.saveSettings?.({ enableNotification: val });
      const t = (k, p) => BSE.I18n?.t(k, p) || k;
      toast(t('tracker_toast_notify_saved'));
    });
  }

  elements.trackerExportBtn?.addEventListener('click', async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    try {
      const json = await BSE.Tracker?.exportConfigJson?.();
      BSE.Utils.downloadText(json, `SparkSub_Subscriptions_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast(t('tracker_toast_export_success'));
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err.message }), true);
    }
  });

  elements.trackerImportBtn?.addEventListener('click', () => {
    elements.trackerImportFile?.click();
  });

  elements.trackerImportFile?.addEventListener('change', async (e) => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await BSE.Tracker?.importConfigJson?.(text);
      await loadAndRenderTracker();
      toast(t('tracker_toast_import_success', { n: res.importedCount }));
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err.message }), true);
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
      const text = BSE.Formatters.generateAiPrompt(promptId, state.cues, false, { title: state.title });
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
  };

  elements.transcript.addEventListener('wheel', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('touchstart', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('pointerdown', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('mousedown', handleUserScrollInteraction, { passive: true });
  elements.transcript.addEventListener('scroll', () => {
    if (programmaticScrolling) {
      clearTimeout(programmaticScrollTimer);
      programmaticScrollTimer = setTimeout(() => {
        programmaticScrolling = false;
      }, 160);
      return;
    }
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
    await navigator.clipboard.writeText(`${header}\n\n${sidepanelDiagnostics.join('\n') || '暂无诊断信息'}`);
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

  async function openBatchModal(targetBvid) {
    try {
      const bvid = targetBvid || BSE.Utils.getBvid(state?.url || location.href);
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
      const diagLogger = (stage, msg) => appendDiagnostic(stage, msg);

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

    const diagLogger = (stage, msg) => appendDiagnostic(stage, msg);

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

  chrome.runtime.onMessage?.addListener((msg) => {
    if (msg?.type === 'BSE_SWITCH_SIDE_PANEL_TAB' && msg.tab) {
      switchTab(msg.tab);
    }
  });

  loadInitialState().catch((error) => toast(error.message, true));
  loadAndRenderTracker().catch(() => {});
  initializeQueueLanguageControl().catch(() => populateQueueLanguageOptions('auto'));
  loadNativeCapabilities(false).catch(() => {});
  loadAndRenderQueue().catch(() => {});
})();
