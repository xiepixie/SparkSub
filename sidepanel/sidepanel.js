(() => {
  'use strict';

  const BSE = globalThis.BSE;
  /** @type {import('../types/bse').AppState | null} */
  let state = null;
  let stateTabId = null;
  let activeTabId = null;
  let activeIndex = -1;
  let following = true;
  let currentTab = 'timestamp';
  let query = '';

  // Batch Export state
  /** @type {import('../types/bse').BatchMediaTree | null} */
  let currentTree = null;
  /** @type {import('../types/bse').BatchControlTask | null} */
  let batchControlTask = null;

  const elements = /** @type {import('../types/bse').SidepanelElements} */ ({
    title: document.querySelector('#video-title'),
    statusDot: document.querySelector('#status-dot'),
    statusText: document.querySelector('#status-text'),
    refresh: document.querySelector('#refresh-button'),
    track: document.querySelector('#track-select'),
    settingsToggle: document.querySelector('#settings-toggle'),
    settingsDrawer: document.querySelector('#settings-drawer'),
    settingsTitle: document.querySelector('#settings-title'),
    settingsGeneralTitle: document.querySelector('#settings-general-title'),
    settingsTrackerTitle: document.querySelector('#settings-tracker-title'),
    settingsDataTitle: document.querySelector('#settings-data-title'),
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
    aiSettingsToggle: document.querySelector('#ai-settings-toggle'),
    aiSettingsDrawer: document.querySelector('#ai-settings-drawer'),
    aiModelBadge: document.querySelector('#ai-model-badge'),
    aiInputEndpoint: document.querySelector('#ai-input-endpoint'),
    aiInputApiKey: document.querySelector('#ai-input-apikey'),
    aiInputModel: document.querySelector('#ai-input-model'),
    aiModelOptions: document.querySelector('#ai-model-options'),
    aiBtnTestConn: document.querySelector('#ai-btn-test-conn'),
    aiBtnSaveSettings: document.querySelector('#ai-btn-save-settings'),
    aiTestStatus: document.querySelector('#ai-test-status'),
    aiStatusDot: document.querySelector('#ai-status-dot'),
    aiModelName: document.querySelector('#ai-model-name'),
    aiBtnGenerate: document.querySelector('#ai-btn-generate'),
    aiBtnGenerateText: document.querySelector('#ai-btn-generate-text'),
    aiBtnSnipFrame: document.querySelector('#ai-btn-snip-frame'),
    aiBtnCopyNote: document.querySelector('#ai-btn-copy-note'),
    aiBtnExportZip: document.querySelector('#ai-btn-export-zip'),
    aiManualTray: document.querySelector('#ai-manual-tray'),
    aiManualTrayCount: document.querySelector('#ai-manual-tray-count'),
    aiManualTrayList: document.querySelector('#ai-manual-tray-list'),
    btnClearManualTray: document.querySelector('#btn-clear-manual-tray'),
    btnCopyStitchedTray: document.querySelector('#btn-copy-stitched-tray'),
    btnDownloadTrayImages: document.querySelector('#btn-download-tray-images'),
    aiBtnCopyPlanPrompt: document.querySelector('#ai-btn-copy-plan-prompt'),
    aiBtnCopySynthPrompt: document.querySelector('#ai-btn-copy-synth-prompt'),
    aiBtnOpenImportModal: document.querySelector('#ai-btn-open-import-modal'),
    aiImportModal: document.querySelector('#ai-import-modal'),
    aiBtnCloseImportModal: document.querySelector('#ai-btn-close-import-modal'),
    aiBtnCancelImport: document.querySelector('#ai-btn-cancel-import'),
    aiBtnConfirmImport: document.querySelector('#ai-btn-confirm-import'),
    aiImportTextarea: document.querySelector('#ai-import-textarea'),
    aiProgressBox: document.querySelector('#ai-progress-box'),
    aiProgressText: document.querySelector('#ai-progress-text'),
    aiNotePlaceholder: document.querySelector('#ai-note-placeholder'),
    aiNoteContent: document.querySelector('#ai-note-content'),
    aiPromptsGrid: document.querySelector('#ai-prompts-grid'),
    aiPromptsToggle: document.querySelector('#ai-prompts-toggle'),
    aiActionToolbar: document.querySelector('#ai-action-toolbar'),
    aiCardSummary: document.querySelector('#ai-card-summary'),
    aiCardKeypoints: document.querySelector('#ai-card-keypoints'),
    aiCardNotes: document.querySelector('#ai-card-notes'),
    aiCardQuestions: document.querySelector('#ai-card-questions'),
    empty: document.querySelector('#empty-state'),
    emptyMessage: document.querySelector('#empty-message'),
    emptyActions: document.querySelector('#empty-actions'),
    emptyTranscribe: document.querySelector('#empty-transcribe-btn'),
    diagnosticsPanel: document.querySelector('#diagnostics'),
    diagnosticStatusTitle: document.querySelector('#diagnostic-status-title'),
    diagnosticStatusDetail: document.querySelector('#diagnostic-status-detail'),
    diagnosticActivity: document.querySelector('#diagnostic-activity'),
    diagnosticTimeline: document.querySelector('#diagnostic-timeline'),
    diagnosticTechnicalLabel: document.querySelector('#diagnostic-technical-label'),
    diagnosticTechnicalCount: document.querySelector('#diagnostic-technical-count'),
    diagnostics: document.querySelector('#diagnostic-text'),
    copyDiagnostic: document.querySelector('#copy-diagnostic-button'),
    toast: document.querySelector('#toast'),
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
    batchFormatLabel: document.querySelector('#batch-format-label'),
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
  });

  /**
   * Keep DOM narrowing at one seam instead of scattering unchecked casts through
   * delegated event handlers and batch-tree queries.
   * @param {Event} event
   * @returns {Element | null}
   */
  function eventTargetElement(event) {
    return event.target instanceof Element ? event.target : null;
  }

  /**
   * @param {Event} event
   * @param {string} selector
   * @returns {HTMLElement | null}
   */
  function closestHtml(event, selector) {
    const match = eventTargetElement(event)?.closest(selector) || null;
    return match instanceof HTMLElement ? match : null;
  }

  /**
   * @param {Event} event
   * @param {string} selector
   * @returns {HTMLButtonElement | null}
   */
  function closestButton(event, selector) {
    const match = closestHtml(event, selector);
    return match instanceof HTMLButtonElement ? match : null;
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {HTMLInputElement[]}
   */
  function queryInputs(root, selector) {
    return Array.from(root.querySelectorAll(selector)).filter((node) => node instanceof HTMLInputElement);
  }

  let sidepanelToastTimer = null;
  function toast(message, error = false) {
    const text = String(message || '').replace(/^(?:\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|\s)+/gu, '');
    const isError = error || text.includes('失败') || text.includes('错误');
    const isSuccess = !isError && (text.includes('已复制') || text.includes('完成') || text.includes('成功') || text.includes('OK'));

    elements.toast.textContent = text;
    elements.toast.className = `toast show ${isError ? 'error' : (isSuccess ? 'success' : 'info')}`;
    clearTimeout(sidepanelToastTimer);
    sidepanelToastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
  }

  const diagnosticsPresenter = BSE.DiagnosticPresenter.create({ limit: 500 });
  const diagnosticSessions = {
    native: `native:${Date.now()}`,
    queue: 'queue:active',
    batch: `batch:${Date.now()}`
  };
  let diagnosticSessionSequence = 0;

  function rotateDiagnosticSession(scope, operation) {
    diagnosticSessionSequence += 1;
    const sessionId = `${scope}:${operation}:${Date.now()}:${diagnosticSessionSequence}`;
    diagnosticSessions[scope] = sessionId;
    return sessionId;
  }

  function inferDiagnosticScope(stage) {
    if (/本机服务/.test(stage)) return 'native';
    if (/AI|讲义|大模型|视频规划|视觉证据|多模态|文本精修/i.test(stage)) return 'ai';
    if (/转录队列|端侧 ASR|音频准备/.test(stage)) return 'queue';
    if (/批量|合集/.test(stage)) return 'batch';
    return 'media';
  }

  function renderDiagnostics() {
    const status = diagnosticsPresenter.summarizeState(state || {});
    const events = diagnosticsPresenter.activityEvents(state || {});
    const technicalEvents = diagnosticsPresenter.technicalEvents();
    if (elements.diagnosticsPanel) elements.diagnosticsPanel.setAttribute('data-tone', status.tone);
    if (elements.diagnosticStatusTitle) elements.diagnosticStatusTitle.textContent = status.title;
    if (elements.diagnosticStatusDetail) elements.diagnosticStatusDetail.textContent = status.detail;
    if (elements.diagnosticActivity) elements.diagnosticActivity.toggleAttribute('hidden', events.length === 0);
    if (elements.diagnosticTimeline) {
      elements.diagnosticTimeline.replaceChildren(...events.map((event) => {
        const item = diagnosticsPresenter.statusItem(event);
        const row = document.createElement('li');
        row.className = 'diag-timeline-item';
        row.dataset.tone = item.tone;
        const marker = document.createElement('span');
        marker.className = 'diag-timeline-marker';
        marker.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('div');
        copy.className = 'diag-timeline-copy';
        const title = document.createElement('strong');
        title.textContent = item.title;
        const detail = document.createElement('span');
        detail.textContent = item.detail;
        const time = document.createElement('time');
        time.textContent = item.time;
        time.dateTime = event.timestamp;
        copy.append(title, detail);
        row.append(marker, copy, time);
        return row;
      }));
    }
    if (elements.diagnostics) {
      elements.diagnostics.textContent = technicalEvents.length
        ? technicalEvents.map((event) => BSE.Diagnostics.formatEvent(event)).join('\n')
        : (BSE.I18n?.t('no_error') || '暂无诊断信息');
    }
    if (elements.diagnosticTechnicalCount) elements.diagnosticTechnicalCount.textContent = `· ${technicalEvents.length}`;
  }

  function appendDiagnostic(stage, msg, options = {}) {
    const scope = options.scope || inferDiagnosticScope(stage);
    diagnosticsPresenter.append({
      scope,
      sessionId: options.sessionId || diagnosticSessions[scope] || `${scope}:active`,
      level: options.level || BSE.Diagnostics.classifyLegacy(stage, msg),
      code: options.code,
      stage,
      message: msg,
      context: options.context
    });
    renderDiagnostics();
  }

  BSE.Queue?.setDiagnosticReporter?.((event) => {
    appendDiagnostic(event?.stage || '转录队列', event?.message || '', event || {});
  });

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
      if (nativeCapabilityProbe.snapshot().phase === 'idle') loadNativeCapabilities(false);
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
      restoreNoteFromCache(state?.mediaKey);
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
  const TRACKER_VISIBLE_ITEMS = 3;
  let trackerFilter = 'all';
  let trackerSearchQuery = '';
  let trackerSort = 'activity';
  let trackerLoading = false;
  let trackerLoadPromise = null;
  let trackerSummaryPromise = null;
  let trackerRefreshTimer = null;
  const trackerRepairAttempts = new Set();
  const expandedTrackerCards = new Set();
  let subscriptionsCache = [];
  let currentAuthorInfo = null;
  let currentAuthorInfoKey = '';
  let currentAuthorInfoLoad = null;

  function getCurrentAuthorInfoKey() {
    const author = state?.authorInfo || {};
    return [
      state?.mediaKey || '',
      state?.url || '',
      state?.title || '',
      author.targetId || author.mid || author.channelId || '',
      author.seasonId || '',
      author.name || '',
      BSE.I18n?.getLocale?.() || 'zh-CN'
    ].join('|');
  }

  async function getCachedCurrentVideoAuthorInfo() {
    const key = getCurrentAuthorInfoKey();
    if (currentAuthorInfoKey === key) return currentAuthorInfo;
    if (currentAuthorInfoLoad?.key === key) return currentAuthorInfoLoad.promise;

    const promise = detectCurrentVideoAuthorInfo();
    currentAuthorInfoLoad = { key, promise };
    try {
      const info = await promise;
      if (getCurrentAuthorInfoKey() === key) {
        currentAuthorInfo = info;
        currentAuthorInfoKey = key;
        return info;
      }
      return getCachedCurrentVideoAuthorInfo();
    } finally {
      if (currentAuthorInfoLoad?.promise === promise) currentAuthorInfoLoad = null;
    }
  }

  function getTrackerUnreadItems(sub) {
    if (BSE.Tracker?.getUnreadItems) return BSE.Tracker.getUnreadItems(sub);
    const items = Array.isArray(sub?.items) ? sub.items : [];
    const legacyUnreadCount = Math.max(0, Number(sub?.unreadCount) || 0);
    return items.filter((item, index) => item?.isRead === false || (item?.isRead === undefined && index < legacyUnreadCount));
  }

  function getTrackerUnreadCount(sub) {
    return getTrackerUnreadItems(sub).length;
  }

  function loadTrackerSummary() {
    if (!BSE.Tracker) return Promise.resolve();
    if (trackerSummaryPromise) return trackerSummaryPromise;
    trackerSummaryPromise = BSE.Tracker.getSubscriptions()
      .then((subscriptions) => {
        subscriptionsCache = subscriptions;
        updateTrackerCountsAndBadge();
      })
      .catch(() => {})
      .finally(() => { trackerSummaryPromise = null; });
    return trackerSummaryPromise;
  }

  function loadAndRenderTracker() {
    if (!BSE.Tracker) return Promise.resolve();
    if (trackerLoadPromise) return trackerLoadPromise;
    trackerLoadPromise = (async () => {
      trackerLoading = true;
      const t = (k, p) => BSE.I18n?.t(k, p) || k;
      if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'true');
      if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = t('tracker_status_loading');
      try {
        subscriptionsCache = await BSE.Tracker.getSubscriptions();
        renderTrackerList();
        updateTrackerCountsAndBadge();
        await updateQuickSubscribeBar();

        // Empty legacy subscriptions get one repair attempt per side-panel
        // lifetime. Normal tracker opens never launch background network work.
        const emptySubs = subscriptionsCache.filter((sub) => (
          (!sub.items || sub.items.length === 0) && !trackerRepairAttempts.has(sub.id)
        ));
        if (emptySubs.length > 0) {
          emptySubs.forEach((sub) => trackerRepairAttempts.add(sub.id));
          const activeBvid = BSE.Utils?.getBvid
            ? (BSE.Utils.getBvid(state?.url || '') || (state?.mediaKey ? state.mediaKey.match(/bili:(BV[a-zA-Z0-9]+)/i)?.[1] : ''))
            : '';
          Promise.allSettled(emptySubs.map((sub) => BSE.Tracker.checkSubscriptionUpdates(sub, { activeBvid })))
            .then(() => scheduleTrackerRefresh(0));
        }
      } catch (err) {
        console.warn('[BSE Tracker] 读取订阅列表异常:', err);
        if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = `${t('status_error')}：${err?.message || ''}`;
        toast(t('tracker_toast_load_failed'), true);
      } finally {
        trackerLoading = false;
        if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'false');
      }
    })().finally(() => { trackerLoadPromise = null; });
    return trackerLoadPromise;
  }

  function scheduleTrackerRefresh(delay = 35) {
    if (currentTab !== 'tracker') {
      loadTrackerSummary().catch(() => {});
      return;
    }
    if (trackerRefreshTimer) clearTimeout(trackerRefreshTimer);
    trackerRefreshTimer = setTimeout(() => {
      trackerRefreshTimer = null;
      loadAndRenderTracker().catch(() => {});
    }, Math.max(0, delay));
  }

  function updateTrackerCountsAndBadge() {
    const total = subscriptionsCache.length;
    const unread = subscriptionsCache.reduce((sum, s) => sum + getTrackerUnreadCount(s), 0);
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
    let bvid = (BSE.Utils && BSE.Utils.getBvid) ? (BSE.Utils.getBvid(url) || BSE.Utils.getBvid(state.url || '')) : '';
    if (!bvid && state.mediaKey) {
      const match = state.mediaKey.match(/bili:(BV[a-zA-Z0-9]+)/i);
      if (match) bvid = match[1];
    }
    if (!bvid && state.authorInfo?.bvid) bvid = state.authorInfo.bvid;

    // 1. 如果已通过 content script 提取到了完整 authorInfo（包含合集），优先复用
    if (state.authorInfo && state.authorInfo.name && (state.authorInfo.targetId || state.authorInfo.mid) && state.authorInfo.seasonId) {
      return {
        platform,
        type: platform === 'youtube' ? 'channel' : 'up',
        title: state.authorInfo.name,
        upName: state.authorInfo.name,
        mid: state.authorInfo.mid || state.authorInfo.targetId,
        targetId: state.authorInfo.targetId || state.authorInfo.mid,
        bvid: bvid || state.authorInfo.bvid || '',
        avatar: state.authorInfo.avatar || '',
        seasonId: state.authorInfo.seasonId,
        seasonTitle: state.authorInfo.seasonTitle || (BSE.I18n?.t('tracker_type_season') || '视频合集'),
        videoTitle: state.title || ''
      };
    }

    // 2. B 站视频：多通道提取 BV 号并调用后台代理接口获取精准 UP 主与合集/系列/分P
    if (platform === 'bilibili') {
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
        bvid: bvid || '',
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

  function findSubscriptionBySource({ id = '', platform = '', type = '', targetId = '' } = {}) {
    const normalizedPlatform = String(platform || '').toLowerCase();
    const normalizedType = String(type || '').toLowerCase();
    const normalizedTarget = String(targetId || '').trim().toLowerCase();
    return subscriptionsCache.find((sub) => {
      if (id && sub.id === id) return true;
      return normalizedTarget
        && String(sub.platform || '').toLowerCase() === normalizedPlatform
        && String(sub.type || '').toLowerCase() === normalizedType
        && String(sub.targetId || sub.resolvedTargetId || '').trim().toLowerCase() === normalizedTarget;
    }) || null;
  }

  async function updateQuickSubscribeBar() {
    if (!elements.trackerQuickBar) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    currentAuthorInfo = await getCachedCurrentVideoAuthorInfo();

    const videoTitle = state?.title || currentAuthorInfo?.videoTitle || t('tracker_wait_video');
    if (elements.trackerCurrentSource) {
      elements.trackerCurrentSource.textContent = videoTitle;
      elements.trackerCurrentSource.title = videoTitle;
    }

    if (elements.trackerQuickAvatar) {
      if (currentAuthorInfo?.avatar) {
        elements.trackerQuickAvatar.innerHTML = `<img src="${BSE.Utils.escapeHtml(currentAuthorInfo.avatar)}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
      } else if (state?.platform === 'youtube') {
        elements.trackerQuickAvatar.textContent = 'YT';
      } else {
        elements.trackerQuickAvatar.textContent = 'B';
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
    const upSubscription = authorTargetId ? findSubscriptionBySource({
      id: upSubId,
      platform: currentAuthorInfo.platform,
      type: currentAuthorInfo.type || 'up',
      targetId: authorTargetId
    }) : null;
    const isUpSubscribed = Boolean(upSubscription);

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
      const seasonSubscription = findSubscriptionBySource({
        id: seasonSubId,
        platform: currentAuthorInfo.platform,
        type: 'season',
        targetId: currentAuthorInfo.seasonId
      });
      const isSeasonSubscribed = Boolean(seasonSubscription);
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
    if (sub.latestBvid && /^BV[a-zA-Z0-9]+/i.test(sub.latestBvid)) return sub.latestBvid;
    if (sub.bvid && /^BV[a-zA-Z0-9]+/i.test(sub.bvid)) return sub.bvid;
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
    if (currentAuthorInfo?.bvid && /^BV[a-zA-Z0-9]+/i.test(currentAuthorInfo.bvid)) {
      return currentAuthorInfo.bvid;
    }
    if (state?.url) {
      const bvid = BSE.Utils?.getBvid?.(state.url);
      if (bvid) return bvid;
    }
    if (state?.mediaKey) {
      const match = state.mediaKey.match(/bili:(BV[a-zA-Z0-9]+)/i);
      if (match) return match[1];
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
      preview = `<div class="tracker-preview-drawer" id="${previewId}" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" data-loaded="false"></div>`;
    } else if (subtitle?.status === 'pending') {
      badge = `<span class="tracker-sub-badge pending">${t('tracker_badge_extracting')}</span>`;
      actions = '';
    } else if (subtitle?.status === 'not_found' || subtitle?.status === 'error' || subtitle?.status === 'evicted') {
      const label = subtitle.status === 'error' ? t('tracker_badge_error') : (subtitle.status === 'evicted' ? t('tracker_badge_evicted') : t('tracker_badge_no_sub'));
      badge = `<span class="tracker-sub-badge not-found" title="${BSE.Utils.escapeHtml(subtitle.errorHint || '')}">${label}</span>`;
      actions = `<button class="tracker-item-act-btn tracker-btn-copy tracker-btn-retry-sub" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="重新提取">${t('tracker_btn_retry')}</button>`;
    }

    return `
      <div class="tracker-item-row${isUnread ? ' is-unread' : ''}" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}">
        <div class="tracker-item-top">
          <div class="tracker-item-title-wrap">
            ${isUnread ? `<span class="tracker-item-unread-dot" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="点击标为已读" aria-label="${t('tracker_tag_unread', { n: 1 })}"></span>` : ''}
            <span class="tracker-item-title" title="${BSE.Utils.escapeHtml(item.title)}">${BSE.Utils.escapeHtml(item.title)}</span>
          </div>
          <span class="tracker-item-time">${formatTrackerTime(item.pubdate)}</span>
        </div>
        <div class="tracker-item-bot">
          ${badge}
          <div class="tracker-item-actions">
            ${actions}
            ${item.url ? `<button class="tracker-item-act-btn tracker-btn-watch" data-url="${BSE.Utils.escapeHtml(item.url)}" data-sub-id="${BSE.Utils.escapeHtml(sub.id)}" data-item-id="${BSE.Utils.escapeHtml(item.id)}" title="打开视频播放页">${t('tracker_btn_watch')}</button>` : ''}
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
    if (trackerFilter === 'unread') list = list.filter((sub) => getTrackerUnreadCount(sub) > 0);
    if (trackerSearchQuery) {
      list = list.filter((sub) => `${sub.title || ''} ${sub.author || ''}`.toLocaleLowerCase().includes(trackerSearchQuery));
    }
    list.sort((a, b) => {
      if (trackerSort === 'name') return String(a.title || '').localeCompare(String(b.title || ''), BSE.I18n?.getLocale() || 'zh-CN');
      if (trackerSort === 'unread') return getTrackerUnreadCount(b) - getTrackerUnreadCount(a) || (b.lastCheckedAt || 0) - (a.lastCheckedAt || 0);
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

    const unreadTotal = subscriptionsCache.reduce((sum, sub) => sum + getTrackerUnreadCount(sub), 0);
    const copyableUnread = subscriptionsCache.reduce((sum, sub) => (
      sum + getTrackerUnreadItems(sub).filter((item) => item.subtitle?.status === 'ready').length
    ), 0);
    if (elements.trackerStatusLine) {
      elements.trackerStatusLine.textContent = t('tracker_status_summary', {
        shown: list.length,
        total: subscriptionsCache.length,
        unread: unreadTotal,
        copyable: copyableUnread
      });
    }
    if (elements.trackerCopyAllBtn) elements.trackerCopyAllBtn.disabled = copyableUnread === 0 || trackerLoading;
    if (elements.trackerReadAllBtn) elements.trackerReadAllBtn.disabled = unreadTotal === 0 || trackerLoading;

    const fragment = document.createDocumentFragment();
    list.forEach((sub, subIndex) => {
      const card = document.createElement('section');
      const items = [...(sub.items || [])].sort((a, b) => Number(b.pubdate || 0) - Number(a.pubdate || 0));
      const unreadItems = getTrackerUnreadItems(sub);
      const unreadIds = new Set(unreadItems.map((item) => item.id));
      const unreadCount = unreadItems.length;
      const hasUnread = unreadCount > 0;
      card.className = `tracker-card ${hasUnread ? 'has-unread' : 'is-read'}`;
      card.dataset.id = sub.id;
      // Tracker is compact by default, but history stays reachable in-context.
      // Collapsed cards show exactly the latest three rows; expanding is an
      // explicit user action and therefore may render the retained history.
      const expanded = expandedTrackerCards.has(sub.id);
      const visibleItems = expanded ? items : items.slice(0, TRACKER_VISIBLE_ITEMS);
      const hiddenCount = Math.max(0, items.length - visibleItems.length);
      const typeLabel = sub.type === 'season' ? t('tracker_type_season') : (sub.platform === 'youtube' ? t('tracker_type_youtube_channel') : t('tracker_type_bilibili_up'));

      const subUrl = getSubscriptionUrl(sub);
      const openHint = sub.type === 'season' ? '打开合集播放页' : '打开主页';
      const showBatchExport = sub.type === 'season' || items.length > 1 || (sub.platform === 'bilibili' && getSubscriptionBvid(sub));
      const authorText = sub.author || (sub.type === 'up' ? sub.title : '');

      card.innerHTML = `
        <div class="tracker-card-head">
          <div class="tracker-card-brand tracker-card-link" data-url="${BSE.Utils.escapeHtml(subUrl)}" title="${openHint}: ${BSE.Utils.escapeHtml(sub.title)}" role="button" tabindex="0">
            <div class="tracker-avatar-wrap">${sub.avatar ? `<img src="${BSE.Utils.escapeHtml(sub.avatar)}" alt="">` : (sub.platform === 'youtube' ? 'YT' : 'B')}</div>
            <div class="tracker-card-meta">
              <div class="tracker-card-title-row">
                <strong class="tracker-card-title">${BSE.Utils.escapeHtml(sub.title)}</strong>
                <span class="tracker-card-open-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5"/><path d="M10 14L19 5"/><path d="M19 14v5H5V5h5"/></svg></span>
              </div>
              <div class="tracker-card-subtext">
                ${authorText ? `<span class="tracker-card-author" title="UP主/作者: ${BSE.Utils.escapeHtml(authorText)}">${BSE.Utils.escapeHtml(authorText)}</span><span class="tracker-card-sep">·</span>` : ''}<span>${typeLabel} · ${items.length} 篇 · ${formatTrackerTime(sub.lastCheckedAt)}</span>
              </div>
            </div>
          </div>
          <div class="tracker-card-head-actions">
            <button class="tracker-card-icon-btn tracker-btn-rename" data-id="${BSE.Utils.escapeHtml(sub.id)}" data-title="${BSE.Utils.escapeHtml(sub.title)}" title="${t('tracker_btn_rename_title')}">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            ${showBatchExport ? `<button class="tracker-card-act-btn tracker-btn-batch-card" data-id="${BSE.Utils.escapeHtml(sub.id)}" title="${t('tracker_btn_batch_card_title')}">${t('tracker_btn_batch_card')}</button>` : ''}
            ${unreadCount ? `<button class="tracker-card-unread-pill tracker-btn-read" data-id="${BSE.Utils.escapeHtml(sub.id)}" title="${t('tracker_btn_mark_card_read')}">${t('tracker_tag_unread', { n: unreadCount })}</button>` : `<span class="tracker-card-tag is-read-tag">${t('tracker_tag_read')}</span>`}
            <button class="tracker-card-del-btn tracker-btn-del" data-id="${BSE.Utils.escapeHtml(sub.id)}" data-title="${BSE.Utils.escapeHtml(sub.title)}" title="${t('tracker_btn_untrack')}">×</button>
          </div>
        </div>
        <div class="tracker-items">${visibleItems.map((item, itemIndex) => (
          renderTrackerItem(sub, item, `tracker-preview-${subIndex}-${itemIndex}`, unreadIds.has(item.id))
        )).join('')}</div>
        ${!expanded && hiddenCount > 0
          ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}" aria-expanded="false">${t('tracker_btn_expand_more', { n: hiddenCount })}</button>`
          : (expanded && items.length > TRACKER_VISIBLE_ITEMS
            ? `<button class="tracker-expand-btn" data-id="${BSE.Utils.escapeHtml(sub.id)}" aria-expanded="true">${t('tracker_btn_collapse_more')}</button>`
            : '')}`;
      fragment.appendChild(card);
    });
    elements.trackerList.appendChild(fragment);
  }

  // === Queue (Background Transcription) State & Methods ===
  let queueCache = [];
  const nativeCapabilityProbe = BSE.QueueUI.createCapabilityProbeState();

  function queueLanguageLabel(code) {
    const t = (key) => BSE.I18n?.t(key) || key;
    if (code === 'auto') return t('queue_language_auto');
    if (code === 'zh') return t('queue_language_zh');
    if (code === 'yue') return t('queue_language_yue');
    try {
      const displayNames = new Intl.DisplayNames([BSE.I18n?.getLocale?.() || 'zh-CN'], { type: 'language' });
      return `${displayNames.of(code) || code} [${code}]`;
    } catch {
      return code;
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
    const snapshot = nativeCapabilityProbe.snapshot();
    BSE.QueueUI.renderCapabilityPanel(
      /** @type {HTMLElement} */ (elements.queueCapabilityPanel),
      /** @type {HTMLElement} */ (elements.queueCapabilityStatus),
      /** @type {HTMLElement} */ (elements.queueCapabilityDetails),
      snapshot.capabilities,
      snapshot.error,
      t
    );
  }

  async function loadNativeCapabilities(force = false) {
    if (!elements.queueCapabilityPanel) return;
    const probeRevision = nativeCapabilityProbe.begin();
    rotateDiagnosticSession('native', 'capabilities');
    const t = (key) => BSE.I18n?.t(key) || key;
    elements.queueCapabilityPanel.hidden = false;
    elements.queueCapabilityPanel.dataset.state = 'checking';
    if (elements.queueCapabilityStatus) elements.queueCapabilityStatus.textContent = t('queue_capability_checking');
    if (elements.queueCapabilityRefresh) elements.queueCapabilityRefresh.disabled = true;
    appendDiagnostic('本机服务', `正在探测 SparkScribe 浏览器集成能力 (force=${force})…`);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'BSE_NATIVE_CAPABILITIES', force });
      if (!response?.ok || !response.capabilities) {
        const capabilityError = response?.error || { code: 'NATIVE_HOST_DISCONNECTED' };
        if (!nativeCapabilityProbe.commit(probeRevision, { capabilities: null, error: capabilityError })) return;
        appendDiagnostic('本机服务', `探测返回错误：${capabilityError.code || 'UNKNOWN'} · ${capabilityError.message || ''}`);
      } else {
        const caps = response.capabilities;
        if (!nativeCapabilityProbe.commit(probeRevision, { capabilities: caps, error: null })) return;
        const ready = BSE.QueueUI.capabilityState(caps, null).key === 'queue_capability_ready';
        appendDiagnostic('本机服务', ready ? '本机服务已就绪' : '本机服务部分能力不可用', {
          scope: 'native',
          sessionId: diagnosticSessions.native,
          level: ready ? 'info' : 'warn',
          code: ready ? 'NATIVE_READY' : 'NATIVE_PARTIAL'
        });
        const localASR = caps.features?.localASR;
        const remoteMedia = caps.features?.remoteMedia;
        appendDiagnostic('本机服务详情', `protocol=${caps.protocolVersion} · contract=${caps.contract || 'legacy-v1'} · localASR=${localASR?.available === true} · languages=${Array.isArray(localASR?.languages) ? localASR.languages.join(',') : ''} · youtubeCaptions=${caps.features?.youtubeCaptions?.available === true} · remoteMedia[youtube=${remoteMedia?.youtube === true},bilibili=${remoteMedia?.bilibili === true}]`, {
          scope: 'native',
          sessionId: diagnosticSessions.native,
          level: 'debug',
          code: 'NATIVE_CAPABILITIES'
        });
      }
    } catch (error) {
      const capabilityError = {
        code: error?.code || 'NATIVE_HOST_DISCONNECTED',
        message: error?.message || ''
      };
      if (!nativeCapabilityProbe.commit(probeRevision, { capabilities: null, error: capabilityError })) return;
      appendDiagnostic('本机服务', `通信异常：${error?.code || 'ERROR'} · ${error?.message || error}`);
    } finally {
      if (nativeCapabilityProbe.snapshot().revision === probeRevision) {
        renderNativeCapabilities();
        if (elements.queueCapabilityRefresh) elements.queueCapabilityRefresh.disabled = false;
      }
    }
  }

  let queueLoadPromise = null;
  let queueLoadFollowUpRequested = false;
  let queueRefreshTimer = null;

  async function performQueueLoadAndRender() {
    if (!BSE.Queue) return;
    try {
      queueCache = await BSE.Queue.getQueue();
      renderQueueList();
      updateQueueBadge();
      for (const item of queueCache) {
        const event = diagnosticsPresenter.observeQueueItem(item);
        if (event) diagnosticsPresenter.append(event);
      }
      renderDiagnostics();
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

  async function loadAndRenderQueue() {
    if (queueLoadPromise) {
      queueLoadFollowUpRequested = true;
      return queueLoadPromise;
    }
    queueLoadPromise = performQueueLoadAndRender();
    try {
      await queueLoadPromise;
    } finally {
      queueLoadPromise = null;
      if (queueLoadFollowUpRequested) {
        queueLoadFollowUpRequested = false;
        scheduleQueueRefresh();
      }
    }
  }

  function scheduleQueueRefresh() {
    if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
    queueRefreshTimer = setTimeout(() => {
      queueRefreshTimer = null;
      loadAndRenderQueue().catch(() => {});
    }, 35);
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
        queued: '排队中',
        resolving: '解析中',
        fetching_caption: '提取字幕',
        fetching_audio: '探测音频',
        transcribing: '转录中',
        postprocessing: '格式化',
        done: item.subtitle?.cueCount ? `${item.subtitle.cueCount} 句字幕` : '已就绪',
        failed: '失败'
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
        <button type="button" class="queue-card-del-btn btn-remove" data-id="${safeId}" title="从队列中移除">×</button>
        <div class="queue-card-main">
          <div class="queue-thumb-wrap" title="点击在新标签页打开视频">
            <img class="queue-thumb-img" src="${BSE.Utils.escapeHtml(item.cover || 'data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 60\' fill=\'%23334155\'><text x=\'50\' y=\'35\' fill=\'%2394a3b8\' font-size=\'14\' text-anchor=\'middle\'>SparkSub</text></svg>')}" alt="cover" loading="lazy">
            <span class="queue-thumb-tag ${isBili ? 'bilibili' : 'youtube'}">${isBili ? 'B站' : 'YT'}</span>
            <div class="queue-thumb-hover-overlay" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
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
              ${item.stage !== 'done' && item.stage !== 'failed' ? `
                <span class="queue-card-progress-percent" title="总任务流水线进度">${progressPercent}%</span>
              ` : ''}
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
        ${Array.isArray(item.subtitle?.cues) && item.subtitle.cues.length ? `
          <div class="queue-preview-drawer ${isExpanded ? 'open' : ''}">
            <div class="queue-preview-toolbar">
              <span class="queue-preview-stats">共 ${item.subtitle.cueCount || 0} 行字幕 · ${item.subtitle.langDoc || item.subtitle.language || '中文'}</span>
              <button type="button" class="queue-preview-copy-btn btn-quick-copy" title="复制预览内容">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>复制全文</span>
              </button>
            </div>
            <div class="queue-preview-body" data-loaded="${isExpanded ? 'true' : 'false'}">${isExpanded ? BSE.Utils.escapeHtml(item.subtitle.plainText || BSE.Formatters?.toTxt(item.subtitle.cues, false) || '') : ''}</div>
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
            const tabState = await chrome.tabs.sendMessage(tab.id, { type: 'BSE_GET_STATE' });
            if (!BSE.Utils?.mediaStateMatchesUrl?.(tabState, item.url)) {
              throw new Error('当前标签页不是这条转录任务对应的视频，已阻止载入');
            }
            const itemMediaKey = String(item.mediaContext?.mediaKey || '').trim();
            const tabMediaKey = String(tabState?.mediaKey || '').trim();
            const itemBilibiliCid = itemMediaKey.match(/^bili:(BV[a-zA-Z0-9]+):cid([^:]+)$/i);
            const tabBilibiliCid = tabMediaKey.match(/^bili:(BV[a-zA-Z0-9]+):cid([^:]+)$/i);
            const exactIdentityRequired = itemMediaKey.startsWith('yt:')
              || Boolean(itemBilibiliCid && tabBilibiliCid);
            if (itemMediaKey && exactIdentityRequired && itemMediaKey !== tabMediaKey) {
              throw new Error('当前视频的分P/CID 已变化，已阻止载入旧字幕');
            }
            const applyResult = await chrome.tabs.sendMessage(tab.id, {
              type: 'BSE_APPLY_EXTERNAL_SUBTITLE',
              expectedMediaKey: tabMediaKey,
              mediaContext: item.mediaContext || null,
              track: {
                id: `transcribed-${item.id}`,
                name: `端侧本地转录 (${item.subtitle?.cueCount || cues.length} 句)`,
                language: item.subtitle?.language || 'zh',
                langDoc: item.subtitle?.langDoc || '本地端侧转录',
                isAi: true,
                source: 'native',
                engine: item.subtitle?.engine || 'local-asr'
              },
              cues
            });
            if (applyResult?.ok !== true) {
              throw new Error(applyResult?.error === 'MEDIA_CONTEXT_CHANGED'
                ? '当前标签页已经切换到其他视频，已阻止载入旧字幕'
                : (applyResult?.error || '字幕载入被页面拒绝'));
            }
            switchTab('timestamp');
            toast(`已载入 ${cues.length} 句字幕到播放器与侧边栏`);
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
        const previewBody = /** @type {HTMLElement | null} */ (card.querySelector('.queue-preview-body'));
        const btn = card.querySelector('.btn-preview');
        const nowOpen = expandedQueueCards.has(item.id);
        if (nowOpen && previewBody?.dataset.loaded !== 'true') {
          previewBody.textContent = item.subtitle?.plainText
            || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toTxt(item.subtitle.cues, false) : '')
            || '';
          previewBody.dataset.loaded = 'true';
        }
        drawer?.classList.toggle('open', nowOpen);
        btn?.classList.toggle('active', nowOpen);
      });

      card.querySelector('.btn-quick-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = item.subtitle?.markdown || item.subtitle?.plainText || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toTxt(item.subtitle.cues, false) : '');
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            toast(`已复制《${item.title || '当前视频'}》字幕全文`);
          } catch {
            toast('复制失败，请重试', true);
          }
        } else {
          toast('暂无可复制的字幕内容', true);
        }
      });

      card.querySelector('.btn-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const md = item.subtitle?.markdown || (Array.isArray(item.subtitle?.cues) ? BSE.Formatters?.toMarkdown(item.subtitle.cues, metadata()) : '') || item.subtitle?.plainText || '';
        if (md) {
          try {
            await navigator.clipboard.writeText(md);
            toast(`已复制《${item.title || '当前视频'}》Markdown 字幕`);
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
          toast(`已开始下载纯文本字幕：${filename}`);
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
          toast(`已开始下载 SRT 字幕：${filename}`);
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
    if (!nextState) return;
    if (
      state
      && nextState?.mediaKey === state.mediaKey
      && Number(nextState?.revision || 0) < Number(state.revision || 0)
    ) return;

    // Prevent accidental downgrades from 'ready' with cues to transient 'empty' only inside the same tab.
    // A real active-tab switch must be allowed to replace the old media state, even when the new tab has no video.
    const sameStateTab = stateTabId == null || stateTabId === activeTabId;
    if (
      sameStateTab
      && state?.status === 'ready'
      && state.cues?.length > 0
      && nextState.status === 'empty'
      && (!nextState.mediaKey || nextState.mediaKey === state.mediaKey)
    ) {
      return;
    }

    const previousMediaKey = state?.mediaKey || null;
    const previousStateTabId = stateTabId;
    state = nextState;
    stateTabId = activeTabId;
    const mediaChanged = previousMediaKey && previousMediaKey !== (state?.mediaKey || null);
    const tabChanged = previousStateTabId != null && previousStateTabId !== stateTabId;
    if (mediaChanged || tabChanged) {
      resetAiWorkbenchForMediaChange(state?.mediaKey || '');
    }
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
    diagnosticsPresenter.activateMedia({
      tabId: activeTabId,
      sessionId: state?.diagnosticSessionId || `legacy:${activeTabId || 'tab'}:${state?.mediaKey || 'unknown'}`,
      mediaKey: state?.mediaKey
    });
    diagnosticsPresenter.ingestMedia(state?.diagnostics || []);
    renderDiagnostics();
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

    /** @type {NodeListOf<HTMLElement>} */ (elements.transcript.querySelectorAll('.cue')).forEach((row) => {
      const match = !normalized || String(row.dataset.search || '').includes(normalized);
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
      // 1. Direct active tab inquiry
      let currentTab = null;
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs?.length && tabs[0]?.id != null) currentTab = tabs[0];
      } catch {}
      if (!currentTab) {
        try {
          const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (fallbackTabs?.length && fallbackTabs[0]?.id != null) currentTab = fallbackTabs[0];
        } catch {}
      }

      if (currentTab?.id != null) {
        activeTabId = currentTab.id;
        // Direct ping to the content script for instant (<5ms) state retrieval!
        try {
          const directState = await chrome.tabs.sendMessage(currentTab.id, { type: 'BSE_GET_STATE' });
          if (directState && (directState.status === 'ready' || (directState.cues && directState.cues.length > 0))) {
            renderState(directState);
            return;
          }
        } catch {}
      }

      // 2. Query service worker state
      const result = await chrome.runtime.sendMessage({ type: 'BSE_GET_ACTIVE_STATE' });
      if (result?.tab?.id) activeTabId = result.tab.id;
      if (result?.state && (result.state.status === 'ready' || (result.state.cues && result.state.cues.length > 0))) {
        renderState(result.state);
      } else if (result?.state) {
        renderState(result.state);
      } else {
        const activeUrl = currentTab?.url || result?.tab?.url || '';
        const isBili = /bilibili\.com/i.test(activeUrl);
        const isYt = /youtube\.com|youtu\.be/i.test(activeUrl);
        if (state?.status !== 'ready' || (activeUrl && BSE.Utils?.getMediaKey && state?.mediaKey && BSE.Utils.getMediaKey('bilibili', activeUrl) !== state.mediaKey && BSE.Utils.getMediaKey('youtube', activeUrl) !== state.mediaKey)) {
          renderState({
            status: 'empty',
            platform: isBili ? 'bilibili' : (isYt ? 'youtube' : 'unknown'),
            message: BSE.I18n?.t('no_subtitles') || '当前页面未检测到视频字幕',
            cues: [],
            tracks: [],
            title: currentTab?.title || result?.tab?.title || ''
          });
        }
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
    } else if (message?.type === 'BSE_STATE_BROADCAST') {
      const shouldAccept = !activeTabId || message.tabId === activeTabId;
      if (shouldAccept) {
        activeTabId = message.tabId;
        if (message.state) {
          renderState(message.state);
        } else {
          loadInitialState();
        }
      }
    } else if (message?.type === 'BSE_PLAYBACK_BROADCAST' && (!activeTabId || message.tabId === activeTabId)) {
      updatePlayback(message.activeIndex);
    } else if (message?.type === 'BSE_QUEUE_UPDATED') {
      scheduleQueueRefresh();
    } else if (message?.type === 'BSE_DIAGNOSTIC_APPEND') {
      appendDiagnostic(message.stage || '端侧大模型', message.message || '', {
        scope: message.scope,
        sessionId: message.sessionId,
        level: message.level,
        code: message.code,
        context: message.context
      });
    }
  });

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        const hasQueueChanges = Object.keys(changes || {}).some((k) => k.startsWith('bse_transcription_queue_v1'));
        if (hasQueueChanges) {
          scheduleQueueRefresh();
        }
        if (changes && changes['bse_subscriptions']) {
          scheduleTrackerRefresh();
        }
      } else if (areaName === 'sync') {
        if (changes?.cueFontSize?.newValue && elements.sizeSelect) {
          const size = String(changes.cueFontSize.newValue);
          elements.sizeSelect.value = size;
          document.documentElement.style.setProperty('--bse-cue-font-size', `${size}px`);
        }
        if (changes?.bseSubtitlePreference?.newValue && elements.prefSelect) {
          elements.prefSelect.value = String(changes.bseSubtitlePreference.newValue);
        }
        if (changes?.bse_tracker_settings) {
          syncTrackerSettingsControls().catch(() => {});
        }
      }
    });
  }

  window.addEventListener('focus', () => {
    loadInitialState();
    if (currentTab === 'tracker') scheduleTrackerRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadInitialState();
      if (currentTab === 'tracker') scheduleTrackerRefresh();
    }
  });

  function setSelectOptionText(select, value, text) {
    if (!select) return;
    const option = Array.from(select.options || []).find((entry) => entry.value === value);
    if (option) option.textContent = text;
  }

  async function syncGlobalPreferenceControls() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.sync?.get) return;
    try {
      const settings = await chrome.storage.sync.get({ cueFontSize: '14.5', bseSubtitlePreference: 'manual-first' });
      if (settings?.cueFontSize) {
        if (elements.sizeSelect) elements.sizeSelect.value = settings.cueFontSize;
        document.documentElement.style.setProperty('--bse-cue-font-size', `${settings.cueFontSize}px`);
      }
      if (settings?.bseSubtitlePreference && elements.prefSelect) {
        elements.prefSelect.value = settings.bseSubtitlePreference;
      }
    } catch {}
  }

  function applyI18nAndTheme() {
    const theme = BSE.I18n?.getTheme() || 'auto';
    const effectiveLocale = BSE.I18n?.getLocale?.() || 'zh-CN';
    document.documentElement.lang = effectiveLocale;
    if (theme === 'light') {
      document.documentElement.dataset.theme = 'light';
    } else if (theme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    } else if (theme === 'bilibili') {
      document.documentElement.dataset.theme = 'bilibili';
    } else if (theme === 'youtube') {
      document.documentElement.dataset.theme = 'youtube';
    } else {
      const systemLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
      document.documentElement.dataset.theme = systemLight ? 'light' : 'dark';
    }
    if (elements.themeSelect) elements.themeSelect.value = theme;
    if (elements.langSelect) elements.langSelect.value = BSE.I18n?.getLocalePreference?.() || BSE.I18n?.getLocale() || 'auto';

    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    if (elements.settingsTitle) elements.settingsTitle.textContent = t('settings_title');
    if (elements.settingsGeneralTitle) elements.settingsGeneralTitle.textContent = t('settings_section_general');
    if (elements.settingsTrackerTitle) elements.settingsTrackerTitle.textContent = t('settings_section_tracking');
    if (elements.settingsDataTitle) elements.settingsDataTitle.textContent = t('settings_section_data');
    if (elements.settingsToggle) {
      elements.settingsToggle.title = t('settings_title');
      elements.settingsToggle.setAttribute('aria-label', t('settings_title'));
    }
    if (elements.labelTheme) elements.labelTheme.textContent = t('theme_label');
    if (elements.labelLang) elements.labelLang.textContent = t('lang_label');
    if (elements.labelPref) elements.labelPref.textContent = t('pref_subtitle_label');
    if (elements.labelSize) elements.labelSize.textContent = t('pref_size_label');
    if (elements.labelInterval) elements.labelInterval.textContent = t('tracker_setting_interval_label');
    if (elements.labelNotify) elements.labelNotify.textContent = t('tracker_setting_notify_label');
    if (elements.themeSelect) {
      elements.themeSelect.setAttribute('aria-label', t('theme_label'));
      setSelectOptionText(elements.themeSelect, 'auto', t('theme_auto'));
      setSelectOptionText(elements.themeSelect, 'dark', t('theme_dark'));
      setSelectOptionText(elements.themeSelect, 'light', t('theme_light'));
      setSelectOptionText(elements.themeSelect, 'bilibili', t('theme_bilibili'));
      setSelectOptionText(elements.themeSelect, 'youtube', t('theme_youtube'));
    }
    if (elements.langSelect) {
      elements.langSelect.setAttribute('aria-label', t('lang_label'));
      setSelectOptionText(elements.langSelect, 'auto', t('lang_auto'));
      setSelectOptionText(elements.langSelect, 'zh-CN', t('lang_zh_cn'));
      setSelectOptionText(elements.langSelect, 'zh-TW', t('lang_zh_tw'));
      setSelectOptionText(elements.langSelect, 'en', t('lang_en'));
    }
    if (elements.prefSelect) {
      elements.prefSelect.setAttribute('aria-label', t('pref_subtitle_label'));
      setSelectOptionText(elements.prefSelect, 'manual-first', t('batch_pref_manual_first'));
      setSelectOptionText(elements.prefSelect, 'manual-only', t('batch_pref_manual_only'));
      setSelectOptionText(elements.prefSelect, 'ai-first', t('batch_pref_ai_first'));
    }
    if (elements.sizeSelect) {
      elements.sizeSelect.setAttribute('aria-label', t('pref_size_label'));
      setSelectOptionText(elements.sizeSelect, '13', t('size_small'));
      setSelectOptionText(elements.sizeSelect, '14.5', t('size_medium'));
      setSelectOptionText(elements.sizeSelect, '16.5', t('size_large'));
    }
    if (elements.trackerExportBtn) {
      elements.trackerExportBtn.textContent = t('tracker_setting_export_btn');
      elements.trackerExportBtn.title = t('tracker_setting_export_btn');
    }
    if (elements.trackerImportBtn) {
      elements.trackerImportBtn.textContent = t('tracker_setting_import_btn');
      elements.trackerImportBtn.title = t('tracker_setting_import_btn');
    }
    if (elements.search) elements.search.placeholder = t('search_placeholder');
    if (elements.refresh) elements.refresh.title = t('refresh_subtitles');
    if (elements.copy) elements.copy.title = t('copy_full_text');
    if (elements.copyText) elements.copyText.textContent = t('copy_full_text');
    if (elements.download) elements.download.title = t('export');
    if (elements.exportText) elements.exportText.textContent = t('export');
    if (elements.copyDiagnostic) {
      elements.copyDiagnostic.title = t('copy_diagnostics');
      elements.copyDiagnostic.setAttribute('aria-label', t('copy_diagnostics'));
    }
    if (elements.diagnosticTechnicalLabel) elements.diagnosticTechnicalLabel.textContent = t('diagnostic_technical_details');
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
    if (nativeCapabilityProbe.snapshot().phase === 'settled') renderNativeCapabilities();
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

    if (elements.trackerIntervalSelect) {
      const curVal = elements.trackerIntervalSelect.value;
      elements.trackerIntervalSelect.setAttribute('aria-label', t('tracker_setting_interval_label'));
      setSelectOptionText(elements.trackerIntervalSelect, '30', t('tracker_setting_interval_30m'));
      setSelectOptionText(elements.trackerIntervalSelect, '60', t('tracker_setting_interval_1h'));
      setSelectOptionText(elements.trackerIntervalSelect, '180', t('tracker_setting_interval_3h'));
      setSelectOptionText(elements.trackerIntervalSelect, '0', t('tracker_setting_interval_manual'));
      elements.trackerIntervalSelect.value = curVal;
    }

    if (elements.trackerNotifySelect) {
      const curVal = elements.trackerNotifySelect.value;
      elements.trackerNotifySelect.setAttribute('aria-label', t('tracker_setting_notify_label'));
      setSelectOptionText(elements.trackerNotifySelect, 'desktop', t('tracker_setting_notify_on'));
      setSelectOptionText(elements.trackerNotifySelect, 'badge', t('tracker_setting_notify_badge_only'));
      setSelectOptionText(elements.trackerNotifySelect, 'off', t('tracker_setting_notify_off'));
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
  if (typeof matchMedia === 'function') {
    const systemThemeQuery = matchMedia('(prefers-color-scheme: light)');
    systemThemeQuery.addEventListener?.('change', () => {
      if ((BSE.I18n?.getTheme?.() || 'auto') === 'auto') applyI18nAndTheme();
    });
  }
  syncGlobalPreferenceControls().catch(() => {});

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
      const targetUrl = activeTab?.url || '';
      const isCurrentVideoPage = Boolean(activeTab?.id && (targetUrl.includes('bilibili.com') || targetUrl.includes('youtube.com')));
      if (!isCurrentVideoPage) {
        toast('请先切回要转录的 Bilibili / YouTube 视频标签页', true);
        return;
      }

      let enqueueMediaKey = '';

      // Explicit offline transcription never refreshes or reuses platform subtitles.
      // It only asks the active content script for its current media identity.
      if (isCurrentVideoPage) {
        const latestState = await chrome.tabs.sendMessage(activeTab.id, { type: 'BSE_GET_STATE' }).catch(() => null);
        const latestMatchesTarget = BSE.Utils?.mediaStateMatchesUrl?.(latestState, targetUrl) === true;
        if (latestMatchesTarget) enqueueMediaKey = String(latestState?.mediaKey || '').trim();
      }

      if (isCurrentVideoPage && !enqueueMediaKey) {
        appendDiagnostic('转录队列', '当前页面媒体身份尚未稳定，已阻止 URL-only 离线转录，避免跨视频/CID 串台。', {
          scope: 'queue',
          level: 'warn',
          code: 'QUEUE_MEDIA_IDENTITY_UNAVAILABLE'
        });
        toast('当前视频身份仍在切换，请等待播放器稳定后再点离线转录', true);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'BSE_QUEUE_ENQUEUE',
        urls: [{
          url: targetUrl,
          mediaKey: enqueueMediaKey,
          processingIntent: 'local-asr'
        }],
        options: {
          sourceLanguage: elements.queueSourceLanguage?.value || 'auto',
          processingIntent: 'local-asr'
        }
      });
      if (!response?.ok) throw new Error(response?.error || '无法加入队列');
      chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
      switchTab('queue');
      toast('已加入离线转录队列，SparkScribe 将只处理当前视频音频…');
      await loadAndRenderQueue();
    } catch (err) {
      toast(`发起字幕获取失败：${err.message || String(err)}`, true);
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
        toast('已复制全部已完成视频的合并 Markdown');
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
    const targetId = currentAuthorInfo.mid || currentAuthorInfo.targetId;
    const subId = `${currentAuthorInfo.platform}:${currentAuthorInfo.type || 'up'}:${targetId}`;
    const existingSubscription = findSubscriptionBySource({
      id: subId,
      platform: currentAuthorInfo.platform,
      type: currentAuthorInfo.type || 'up',
      targetId
    });
    const upName = currentAuthorInfo.upName || currentAuthorInfo.title || 'UP';
    if (existingSubscription) {
      await BSE.Tracker.removeSubscription(existingSubscription.id);
      toast(t('tracker_toast_untracked', { name: upName }));
    } else {
      const sub = await BSE.Tracker.addSubscription({
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
      try {
        await BSE.Tracker.checkSubscriptionUpdates(sub);
      } catch {}
    }
    await loadAndRenderTracker();
  });

  elements.trackerSubscribeSeasonBtn?.addEventListener('click', async () => {
    if (!currentAuthorInfo || !currentAuthorInfo.seasonId) return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const subId = `${currentAuthorInfo.platform}:season:${currentAuthorInfo.seasonId}`;
    const existingSubscription = findSubscriptionBySource({
      id: subId,
      platform: currentAuthorInfo.platform,
      type: 'season',
      targetId: currentAuthorInfo.seasonId
    });
    const seasonTitle = currentAuthorInfo.seasonTitle || currentAuthorInfo.title || t('tracker_type_season');
    if (existingSubscription) {
      await BSE.Tracker.removeSubscription(existingSubscription.id);
      toast(t('tracker_toast_untracked_season', { title: seasonTitle }));
    } else {
      const bvid = currentAuthorInfo.bvid || (BSE.Utils?.getBvid ? BSE.Utils.getBvid(state?.url || '') : '') || '';
      const sub = await BSE.Tracker.addSubscription({
        id: subId,
        platform: currentAuthorInfo.platform,
        type: 'season',
        title: seasonTitle,
        author: currentAuthorInfo.upName || currentAuthorInfo.title || '',
        ownerId: currentAuthorInfo.mid || '',
        avatar: currentAuthorInfo.avatar,
        targetId: currentAuthorInfo.seasonId,
        bvid: bvid,
        latestBvid: bvid,
        sourceUrl: state?.url || (bvid ? `https://www.bilibili.com/video/${bvid}` : '')
      });
      toast(t('tracker_toast_tracked_season', { title: seasonTitle }));
      try {
        await BSE.Tracker.checkSubscriptionUpdates(sub);
      } catch {}
    }
    await loadAndRenderTracker();
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
    toast(t('tracker_toast_marked_all_read'));
  });

  elements.trackerCopyAllBtn?.addEventListener('click', async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const requests = [];
    const sourceByKey = new Map();
    let skippedWithoutSubtitle = 0;

    subscriptionsCache.forEach((sub) => {
      getTrackerUnreadItems(sub).forEach((item) => {
        if (item.subtitle?.status === 'ready') {
          const key = `${sub.id}\u0000${item.id}`;
          requests.push({ subscriptionId: sub.id, itemId: item.id });
          sourceByKey.set(key, { sub, item });
        } else {
          skippedWithoutSubtitle++;
        }
      });
    });

    const hydrated = requests.length
      ? await BSE.Tracker.getCachedSubtitlesForItems(requests)
      : [];
    const unreadItems = [];
    hydrated.forEach((entry) => {
      const source = sourceByKey.get(`${entry.subscriptionId}\u0000${entry.itemId}`);
      const subtitle = entry.subtitle;
      if (source && subtitle && (subtitle.markdown || subtitle.plainText)) {
        unreadItems.push({
          ...source.item,
          author: source.item.author || source.sub.author || source.sub.title,
          subtitle
        });
      } else {
        skippedWithoutSubtitle++;
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
    const copyBtn = closestButton(e, '.tracker-btn-copy:not(.tracker-btn-retry-sub)');
    if (copyBtn) {
      const subId = copyBtn.dataset.subId;
      const itemId = copyBtn.dataset.itemId;
      const sub = subscriptionsCache.find((s) => s.id === subId);
      const item = (sub?.items || []).find((i) => i.id === itemId);
      if (!subId || !itemId || !item) return;
      copyBtn.disabled = true;
      try {
        const subtitle = await BSE.Tracker.getCachedSubtitleForItem(subId, itemId);
        if (subtitle?.markdown) {
          await navigator.clipboard.writeText(subtitle.markdown);
          toast(t('tracker_toast_copied_md', { title: item.title }));
        } else if (subtitle?.plainText) {
          await navigator.clipboard.writeText(subtitle.plainText);
          toast(t('tracker_toast_copied_txt', { title: item.title }));
        } else {
          toast(subtitle?.errorHint || t('tracker_toast_extract_not_ready'), true);
        }
      } finally {
        copyBtn.disabled = false;
      }
      return;
    }

    const previewBtn = closestButton(e, '.tracker-btn-preview-toggle:not(.tracker-btn-watch)');
    if (previewBtn) {
      const targetId = previewBtn.dataset.target;
      const drawer = document.getElementById(targetId);
      if (drawer) {
        const opening = !drawer.classList.contains('open');
        if (opening && drawer.dataset.loaded !== 'true') {
          previewBtn.disabled = true;
          try {
            const subtitle = await BSE.Tracker.getCachedSubtitleForItem(drawer.dataset.subId, drawer.dataset.itemId);
            drawer.textContent = subtitle?.markdown || subtitle?.plainText || subtitle?.errorHint || t('tracker_toast_extract_not_ready');
            drawer.dataset.loaded = 'true';
          } finally {
            previewBtn.disabled = false;
          }
        }
        drawer.classList.toggle('open', opening);
        previewBtn.setAttribute('aria-expanded', String(opening));
        previewBtn.textContent = opening ? t('tracker_btn_collapse') : t('tracker_btn_preview');
      }
      return;
    }

    const expandBtn = closestButton(e, '.tracker-expand-btn');
    if (expandBtn) {
      const id = expandBtn.dataset.id;
      if (!id) return;
      if (expandedTrackerCards.has(id)) expandedTrackerCards.delete(id);
      else expandedTrackerCards.add(id);
      renderTrackerList();
      return;
    }

    const retrySubBtn = closestButton(e, '.tracker-btn-retry-sub');
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

    const cardLink = closestHtml(e, '.tracker-card-link');
    if (cardLink && !closestButton(e, 'button')) {
      const url = cardLink.dataset.url;
      if (url) chrome.tabs.create({ url });
      return;
    }

    const renameBtn = closestButton(e, '.tracker-btn-rename');
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

    const batchCardBtn = closestButton(e, '.tracker-btn-batch-card');
    if (batchCardBtn) {
      const subId = batchCardBtn.dataset.id;
      const sub = subscriptionsCache.find((s) => s.id === subId);
      if (!sub) return;

      if (sub.platform === 'youtube' && typeof openBatchModal === 'function') {
        openBatchModal(sub.id, 'youtube');
        return;
      }

      const bvid = getSubscriptionBvid(sub);
      if (bvid && typeof openBatchModal === 'function') {
        openBatchModal(bvid, 'bilibili');
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

    const unreadDot = closestHtml(e, '.tracker-item-unread-dot');
    if (unreadDot) {
      const subId = unreadDot.dataset.subId;
      const itemId = unreadDot.dataset.itemId;
      if (subId && itemId) {
        await BSE.Tracker?.markAsRead?.(subId, itemId);
        await loadAndRenderTracker();
      }
      return;
    }

    const watchBtn = closestButton(e, '.tracker-btn-watch');
    if (watchBtn) {
      const url = watchBtn.dataset.url;
      const subId = watchBtn.dataset.subId;
      const itemId = watchBtn.dataset.itemId;
      if (subId && itemId) {
        BSE.Tracker?.markAsRead?.(subId, itemId).then(() => {
          loadAndRenderTracker();
        }).catch(() => {});
      }
      if (url) chrome.tabs.create({ url });
      return;
    }
    const readBtn = closestButton(e, '.tracker-btn-read');
    if (readBtn) {
      const id = readBtn.dataset.id;
      if (id) {
        await BSE.Tracker?.markAsRead?.(id);
        await loadAndRenderTracker();
        toast(t('tracker_toast_marked_read'));
      }
      return;
    }
    const delBtn = closestButton(e, '.tracker-btn-del');
    if (delBtn) {
      const id = delBtn.dataset.id;
      const title = delBtn.dataset.title || t('tracker_type_season');
      if (id && window.confirm(t('tracker_confirm_untrack', { title }))) {
        await BSE.Tracker?.removeSubscription?.(id);
        await loadAndRenderTracker();
        toast(t('tracker_toast_untracked', { name: title }));
      }
      return;
    }
  });

  elements.trackerList?.addEventListener('keydown', (e) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      const cardLink = closestHtml(e, '.tracker-card-link');
      if (cardLink && !closestButton(e, 'button')) {
        e.preventDefault();
        const url = cardLink.dataset.url;
        if (url) chrome.tabs.create({ url });
      }
    }
  });

  function trackerNotificationMode(settings) {
    if (settings?.enableNotification) return 'desktop';
    if (settings?.enableBadge) return 'badge';
    return 'off';
  }

  async function syncTrackerSettingsControls() {
    if (!BSE.Tracker) return;
    const settings = await BSE.Tracker.getSettings();
    if (elements.trackerIntervalSelect) elements.trackerIntervalSelect.value = String(settings.checkIntervalMinutes);
    if (elements.trackerNotifySelect) elements.trackerNotifySelect.value = trackerNotificationMode(settings);
  }

  if (elements.trackerIntervalSelect && BSE.Tracker) {
    syncTrackerSettingsControls().catch(() => {});

    elements.trackerIntervalSelect.addEventListener('change', async () => {
      const val = Number(elements.trackerIntervalSelect.value);
      await BSE.Tracker?.saveSettings?.({ checkIntervalMinutes: val });
      const t = (k, p) => BSE.I18n?.t(k, p) || k;
      toast(t('tracker_toast_interval_saved'));
    });

    elements.trackerNotifySelect?.addEventListener('change', async () => {
      const mode = elements.trackerNotifySelect.value;
      await BSE.Tracker?.saveSettings?.({
        enableNotification: mode === 'desktop',
        enableBadge: mode !== 'off'
      });
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

  elements.trackerImportFile?.addEventListener('change', async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const file = elements.trackerImportFile?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await BSE.Tracker?.importConfigJson?.(text);
      await syncTrackerSettingsControls();
      await loadAndRenderTracker();
      toast(t('tracker_toast_import_success', { n: res.importedCount }));
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err.message }), true);
    } finally {
      elements.trackerImportFile.value = '';
    }
  });

  // === AI Workbench & Visual Course Breakdown Note Generator ===
  const AI_EVIDENCE_FRAME_MAX_WIDTH = 1536;
  const AI_EVIDENCE_FRAME_QUALITY = 0.9;
  let currentAiMode = 'course_notes';
  let manualFrames = [];
  let externalImageDeliveryMode = 'contact-sheet';
  let externalDeliveredFrames = [];
  /** @type {(() => void) | null} */
  let activeNoteImagePreviewClose = null;
  let aiNoteRestoreRevision = 0;
  let aiGenerationRevision = 0;
  let currentGeneratedNote = {
    markdown: '',
    imagesMap: {}, // key: timestamp (number/string), value: { dataUrl, timestamp, timeStr, label }
    mode: 'course_notes',
    title: '',
    mediaKey: ''
  };

  /** @returns {Error & { code: 'MEDIA_CONTEXT_CHANGED' }} */
  function createMediaContextChangedError(message) {
    return Object.assign(new Error(message), { code: /** @type {const} */ ('MEDIA_CONTEXT_CHANGED') });
  }

  function createMediaOperationContext() {
    const mediaKey = state?.mediaKey || '';
    const tabId = activeTabId;
    if (!mediaKey || tabId == null) throw new Error('当前视频上下文尚未就绪');
    return { mediaKey, tabId };
  }

  function assertMediaOperationContext(context) {
    if (!context || activeTabId !== context.tabId || state?.mediaKey !== context.mediaKey) {
      throw createMediaContextChangedError('视频已切换，已停止本次画面处理以避免跨视频污染');
    }
  }

  /**
   * 向启动操作时锁定的视频标签页发送消息。媒体上下文改变时立即拒绝继续执行，
   * 避免 A 视频字幕与 B 视频画面在异步流程中被混合。
   */
  async function sendTabMessage(message, context = null) {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    if (context) {
      assertMediaOperationContext(context);
      const response = await chrome.tabs.sendMessage(context.tabId, {
        ...message,
        expectedMediaKey: context.mediaKey
      });
      assertMediaOperationContext(context);
      if (response?.mediaKey && response.mediaKey !== context.mediaKey) {
        throw createMediaContextChangedError('播放器媒体已变化，截图结果已丢弃');
      }
      return response;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('未找到当前活跃的视频标签页');
    return await chrome.tabs.sendMessage(tab.id, message);
  }

  async function refreshAiModeIndicators(mediaKey = state?.mediaKey || '') {
    const pills = [...document.querySelectorAll('.ai-mode-pill[data-mode]')];
    pills.forEach((pill) => pill.classList.remove('has-result'));
    if (!mediaKey || !BSE.AiNoteCache?.listModes) return;
    try {
      const modes = await BSE.AiNoteCache.listModes(mediaKey);
      const ready = new Set((modes || []).map((entry) => entry.mode));
      pills.forEach((pill) => {
        const mode = pill.dataset.mode || '';
        if (ready.has(mode)) pill.classList.add('has-result');
      });
    } catch {}
  }

  async function saveCurrentNoteToCache() {
    const noteMediaKey = String(currentGeneratedNote?.mediaKey || '').trim();
    if (!noteMediaKey || !currentGeneratedNote?.markdown) return false;
    if (state?.mediaKey && state.mediaKey !== noteMediaKey) return false;
    try {
      if (!BSE.AiNoteCache?.save) throw new Error('AI Note Cache 模块未加载');
      const saved = await BSE.AiNoteCache.save({ ...currentGeneratedNote, mediaKey: noteMediaKey });
      if (!saved) throw new Error('AI Note Cache 未能持久化当前学习产物');
      void refreshAiModeIndicators(noteMediaKey);
      return true;
    } catch (error) {
      appendDiagnostic('AI缓存', `讲义缓存保存失败: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
      return false;
    }
  }

  function renderManualTray() {
    // 托盘内容发生变化后，之前复制/下载的图片集合就不再代表当前状态；
    // 下一次复制阶段二提示词应重新绑定当前托盘，而不是沿用陈旧投递快照。
    externalImageDeliveryMode = 'contact-sheet';
    externalDeliveredFrames = [];
    if (!elements.aiManualTray || !elements.aiManualTrayList) return;
    if (!manualFrames.length) {
      elements.aiManualTray.hidden = true;
      elements.aiManualTrayList.innerHTML = '';
      if (elements.aiManualTrayCount) elements.aiManualTrayCount.textContent = '0';
      return;
    }
    elements.aiManualTray.hidden = false;
    if (elements.aiManualTrayCount) {
      elements.aiManualTrayCount.textContent = String(manualFrames.length);
    }
    elements.aiManualTrayList.innerHTML = manualFrames.map((frame, idx) => `
      <div class="ai-tray-card" data-index="${idx}" data-seek="${frame.timestamp}" title="点击跳转至 ${frame.timeStr}；外部 AI 投递请使用“复制精选拼图”或“原图打包”">
        <img src="${frame.dataUrl}" alt="${frame.timeStr}" draggable="false" />
        <span class="ai-tray-card-time">${frame.timeStr}</span>
        <button class="btn-delete-tray-card" data-index="${idx}" title="移除此截图">×</button>
      </div>
    `).join('');
  }

  function removeFrameAliases(imagesMap, targetFrame, targetSeconds) {
    if (!imagesMap || !targetFrame) return;
    const targetDataUrl = targetFrame.dataUrl || '';
    for (const [key, value] of Object.entries(imagesMap)) {
      const timestamp = Number(value?.timestamp);
      const sameFrame = value === targetFrame
        || (targetDataUrl && value?.dataUrl === targetDataUrl)
        || (Number.isFinite(timestamp) && Number.isFinite(targetSeconds) && Math.abs(timestamp - targetSeconds) < 0.01);
      if (sameFrame) delete imagesMap[key];
    }
  }

  function renderEmptyAiNoteState(mediaKey = state?.mediaKey || '', mode = currentAiMode) {
    currentGeneratedNote = {
      markdown: '',
      imagesMap: {},
      mode: ['course_notes', 'summary', 'deep_qa'].includes(mode) ? mode : 'course_notes',
      title: '',
      mediaKey
    };
    if (elements.aiNoteContent) {
      elements.aiNoteContent.innerHTML = '';
      elements.aiNoteContent.hidden = true;
    }
    if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = false;
    if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = true;
    if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = true;
  }

  function resetAiWorkbenchForMediaChange(mediaKey) {
    manualFrames = [];
    externalImageDeliveryMode = 'contact-sheet';
    externalDeliveredFrames = [];
    renderManualTray();
    activeNoteImagePreviewClose?.();
    aiNoteRestoreRevision++;
    aiGenerationRevision++;
    if (elements.aiBtnGenerate) elements.aiBtnGenerate.disabled = false;
    if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
    renderEmptyAiNoteState(mediaKey || '', currentAiMode);
    void refreshAiModeIndicators(mediaKey || '');
    if (currentTab === 'ai' && mediaKey && currentAiMode !== 'prompts') void restoreNoteFromCache(mediaKey, currentAiMode);
  }

  async function restoreNoteFromCache(mediaKey, mode = currentAiMode) {
    if (!mediaKey) {
      renderEmptyAiNoteState('', mode);
      return;
    }
    const restoreRevision = ++aiNoteRestoreRevision;
    try {
      if (!BSE.AiNoteCache?.load) throw new Error('AI Note Cache 模块未加载');
      const cached = await BSE.AiNoteCache.load(mediaKey, mode);
      if (restoreRevision !== aiNoteRestoreRevision || state?.mediaKey !== mediaKey || currentAiMode !== mode) return;
      if (!cached?.markdown) {
        renderEmptyAiNoteState(mediaKey, mode);
        return;
      }
      currentGeneratedNote = cached;
      const html = BSE.Formatters?.renderNoteToHtml?.(cached.markdown, { imagesMap: cached.imagesMap || {} }) || cached.markdown;
      if (elements.aiNoteContent) {
        elements.aiNoteContent.innerHTML = html;
        elements.aiNoteContent.hidden = false;
      }
      if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;
      if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = false;
      if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = false;
    } catch (error) {
      if (restoreRevision !== aiNoteRestoreRevision || state?.mediaKey !== mediaKey || currentAiMode !== mode) return;
      renderEmptyAiNoteState(mediaKey, mode);
      appendDiagnostic('AI缓存', `学习产物缓存恢复失败: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
    }
  }

  /** @returns {Promise<import('../types/bse').AiSettings>} */
  async function getActiveAiSettings() {
    const config = await BSE.Ai?.getAiSettings?.();
    return config || BSE.Ai?.DEFAULT_CONFIG || {
      endpoint: '',
      apiKey: '',
      model: '',
      timeoutMs: 120000
    };
  }

  let aiStatusRevision = 0;
  /** @type {import('../types/bse').AiSettings | null} */
  let savedAiConfig = null;

  function renderAiModelOptions(models = []) {
    if (!elements.aiModelOptions) return;
    const uniqueModels = [...new Set((Array.isArray(models) ? models : []).filter(Boolean))].slice(0, 200);
    const fragment = document.createDocumentFragment();
    uniqueModels.forEach((model) => {
      const option = document.createElement('option');
      option.value = String(model);
      fragment.appendChild(option);
    });
    elements.aiModelOptions.replaceChildren(fragment);
  }

  async function loadAiConfigToUi() {
    const config = await getActiveAiSettings();
    savedAiConfig = config;
    if (elements.aiInputEndpoint) elements.aiInputEndpoint.value = config.endpoint || '';
    if (elements.aiInputApiKey) elements.aiInputApiKey.value = config.apiKey || '';
    if (elements.aiInputModel) elements.aiInputModel.value = config.model || '';
    if (elements.aiModelName) elements.aiModelName.textContent = config.model || '未配置模型';
    checkAiStatus(config.endpoint, config.apiKey, config.model);
  }

  async function checkAiStatus(endpoint, apiKey, model) {
    if (!elements.aiStatusDot) return null;
    const revision = ++aiStatusRevision;
    elements.aiStatusDot.className = 'badge-dot';
    try {
      const probe = await BSE.Ai?.probeLlm?.(endpoint, apiKey, model);
      if (revision !== aiStatusRevision) return probe || null;
      renderAiModelOptions(probe?.models || []);
      if (probe?.available) {
        elements.aiStatusDot.className = 'badge-dot online';
        if (elements.aiTestStatus) {
          elements.aiTestStatus.textContent = probe.modelAvailable === false
            ? `服务在线 · ${probe.protocol || '兼容协议'} · 模型列表中未发现「${model}」，请用“测试当前模型”做实际调用确认`
            : `服务在线 · ${probe.protocol || '兼容协议'} · 当前生成模型：${model || '未配置'}`;
        }
      } else {
        elements.aiStatusDot.className = 'badge-dot offline';
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = `服务探测未通过：${probe?.error || '未响应'}`;
      }
      return probe || null;
    } catch (err) {
      if (revision !== aiStatusRevision) return null;
      elements.aiStatusDot.className = 'badge-dot offline';
      if (elements.aiTestStatus) elements.aiTestStatus.textContent = `服务探测异常：${err?.message || err}`;
      return null;
    }
  }

  function setupAiWorkbench() {
    const aiConfigReady = loadAiConfigToUi();

    // Toggle AI Settings Panel
    const toggleAiSettings = () => {
      if (!elements.aiSettingsDrawer) return;
      const isHidden = !elements.aiSettingsDrawer.hidden;
      elements.aiSettingsDrawer.hidden = isHidden;
      elements.aiSettingsToggle?.classList.toggle('active', !isHidden);
    };

    if (elements.aiSettingsToggle) {
      elements.aiSettingsToggle.addEventListener('click', toggleAiSettings);
    }
    if (elements.aiModelBadge) {
      elements.aiModelBadge.addEventListener('click', toggleAiSettings);
    }

    const readDraftAiConfig = () => ({
      endpoint: elements.aiInputEndpoint?.value.trim() || '',
      apiKey: elements.aiInputApiKey?.value.trim() || '',
      model: elements.aiInputModel?.value.trim() || ''
    });

    const validateDraftAiConfig = (draft) => {
      if (!draft.endpoint) {
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = '请先填写 API Base URL';
        elements.aiInputEndpoint?.focus();
        return false;
      }
      if (!draft.model) {
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = '请先填写生成模型名称';
        elements.aiInputModel?.focus();
        return false;
      }
      return true;
    };

    const isSavedAiConfig = (draft) => Boolean(savedAiConfig
      && draft.endpoint.replace(/\/+$/, '') === savedAiConfig.endpoint.replace(/\/+$/, '')
      && draft.apiKey === savedAiConfig.apiKey
      && draft.model === savedAiConfig.model);

    // Save Settings
    if (elements.aiBtnSaveSettings) {
      elements.aiBtnSaveSettings.addEventListener('click', async () => {
        await aiConfigReady;
        const draft = readDraftAiConfig();
        if (!validateDraftAiConfig(draft)) return;
        elements.aiBtnSaveSettings.disabled = true;
        try {
          if (!BSE.Ai?.saveAiSettings) throw new Error('AI 配置模块未加载');
          const saved = await BSE.Ai.saveAiSettings(draft);
          savedAiConfig = saved;
          if (elements.aiInputEndpoint) elements.aiInputEndpoint.value = saved.endpoint;
          if (elements.aiInputApiKey) elements.aiInputApiKey.value = saved.apiKey;
          if (elements.aiInputModel) elements.aiInputModel.value = saved.model;
          if (elements.aiModelName) elements.aiModelName.textContent = saved.model;
          await checkAiStatus(saved.endpoint, saved.apiKey, saved.model);
          toast('AI 配置已保存');
        } catch (err) {
          if (elements.aiTestStatus) elements.aiTestStatus.textContent = `配置保存失败：${err?.message || err}`;
          toast(`AI 配置保存失败: ${err?.message || err}`, true);
        } finally {
          elements.aiBtnSaveSettings.disabled = false;
        }
      });
    }

    // Test the exact model currently entered. This does not mutate saved settings.
    if (elements.aiBtnTestConn) {
      elements.aiBtnTestConn.addEventListener('click', async () => {
        await aiConfigReady;
        const draft = readDraftAiConfig();
        if (!validateDraftAiConfig(draft)) return;
        aiStatusRevision++;
        elements.aiBtnTestConn.disabled = true;
        const originalLabel = elements.aiBtnTestConn.textContent;
        elements.aiBtnTestConn.textContent = '测试中…';
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = `正在实际调用「${draft.model}」…`;
        try {
          if (!BSE.Ai?.testLlm) throw new Error('当前 AI 模块不支持模型实测');
          const result = await BSE.Ai.testLlm(draft.endpoint, draft.apiKey, draft.model);
          if (result?.models?.length) renderAiModelOptions(result.models);
          if (result?.available) {
            const returnedModel = result.returnedModel || result.model || draft.model;
            const modelRoute = returnedModel !== draft.model
              ? `请求 ${draft.model} → 服务返回 ${returnedModel}`
              : `模型 ${draft.model}`;
            const catalogHint = result.modelAvailable === false ? ' · 未列入模型目录但实际调用成功' : '';
            const saveHint = isSavedAiConfig(draft) ? '' : ' · 当前为未保存配置';
            const preview = result.responsePreview ? ` · 返回「${result.responsePreview}」` : '';
            if (elements.aiTestStatus) {
              elements.aiTestStatus.textContent = `模型可用 · ${result.protocol || '兼容协议'} · ${modelRoute} · ${result.latencyMs || 0}ms${catalogHint}${saveHint}${preview}`;
            }
            if (isSavedAiConfig(draft) && elements.aiStatusDot) elements.aiStatusDot.className = 'badge-dot online';
          } else {
            if (elements.aiTestStatus) elements.aiTestStatus.textContent = `当前模型不可用：${result?.error || '服务未响应'}`;
            if (isSavedAiConfig(draft) && elements.aiStatusDot) elements.aiStatusDot.className = 'badge-dot offline';
          }
        } catch (err) {
          if (elements.aiTestStatus) elements.aiTestStatus.textContent = `模型测试异常：${err?.message || err}`;
        } finally {
          elements.aiBtnTestConn.disabled = false;
          elements.aiBtnTestConn.textContent = originalLabel || '测试当前模型';
        }
      });
    }

    // Mode Selector: segmented navigation with synchronized visual + accessibility state.
    const aiModePills = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ai-mode-pill')]);
    const aiExternalToolbar = /** @type {HTMLElement | null} */ (document.querySelector('#ai-external-toolbar'));
    const aiPlaceholderTitle = /** @type {HTMLElement | null} */ (document.querySelector('#ai-note-placeholder-title'));
    const aiPlaceholderDesc = /** @type {HTMLElement | null} */ (document.querySelector('#ai-note-placeholder-desc'));
    const activateAiMode = (pill) => {
      aiModePills.forEach((item) => {
        const selected = item === pill;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      currentAiMode = pill.dataset.mode || 'course_notes';
      const isDeepNotes = currentAiMode === 'course_notes';
      if (aiExternalToolbar) aiExternalToolbar.hidden = !isDeepNotes;
      if (elements.aiBtnSnipFrame) elements.aiBtnSnipFrame.hidden = !isDeepNotes;
      if (elements.aiManualTray && !isDeepNotes) elements.aiManualTray.hidden = true;
      if (elements.aiPromptsGrid) elements.aiPromptsGrid.hidden = true;
      if (elements.aiPromptsToggle) elements.aiPromptsToggle.setAttribute('aria-expanded', 'false');

      const emptyStateCopy = {
        course_notes: {
          title: '生成一份可长期留存的学习讲义',
          desc: '先梳理字幕主线，再按需要规划和筛选关键画面，适合系统学习、课程复习和归档。'
        },
        summary: {
          title: '生成一份几分钟就能看完的快速回顾',
          desc: '只处理字幕文本，保留一句话结论、主线、关键结论和重要边界；适合看完视频后快速回忆。'
        },
        deep_qa: {
          title: '把视频变成真正可作答的复盘自测',
          desc: '聚焦易混概念、关键前提与推理断点；题目和参考答案分开组织，适合复习和查漏补缺。'
        }
      };
      const currentCopy = emptyStateCopy[currentAiMode] || emptyStateCopy.course_notes;
      if (aiPlaceholderTitle) aiPlaceholderTitle.textContent = currentCopy.title;
      if (aiPlaceholderDesc) aiPlaceholderDesc.textContent = currentCopy.desc;

      if (elements.aiActionToolbar) {
        elements.aiActionToolbar.hidden = false;
        elements.aiActionToolbar.classList.toggle('text-only', !isDeepNotes);
      }
      if (elements.aiNoteResultContainer) elements.aiNoteResultContainer.hidden = false;

      const modeTexts = {
        course_notes: '生成学习讲义',
        summary: '生成快速回顾',
        deep_qa: '生成复盘自测'
      };
      if (elements.aiBtnGenerateText) {
        elements.aiBtnGenerateText.textContent = modeTexts[currentAiMode] || '开始生成';
      }
      const exportLabel = elements.aiBtnExportZip?.querySelector('span');
      if (exportLabel) exportLabel.textContent = currentAiMode === 'course_notes' ? '导出图文包' : '下载 Markdown';
      if (elements.aiManualTray) {
        elements.aiManualTray.hidden = !isDeepNotes || manualFrames.length === 0;
      }
      if (state?.mediaKey) void restoreNoteFromCache(state.mediaKey, currentAiMode);
      else renderEmptyAiNoteState('', currentAiMode);
    };

    if (elements.aiPromptsToggle) {
      elements.aiPromptsToggle.addEventListener('click', () => {
        const nextOpen = Boolean(elements.aiPromptsGrid?.hidden);
        if (elements.aiPromptsGrid) elements.aiPromptsGrid.hidden = !nextOpen;
        elements.aiPromptsToggle.setAttribute('aria-expanded', String(nextOpen));
      });
    }

    aiModePills.forEach((pill, index) => {
      pill.addEventListener('click', () => activateAiMode(pill));
      pill.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = aiModePills.length - 1;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + aiModePills.length) % aiModePills.length;
        else if (event.key === 'ArrowRight') nextIndex = (index + 1) % aiModePills.length;
        const next = aiModePills[nextIndex];
        if (!next) return;
        activateAiMode(next);
        next.focus();
      });
    });

    // Pre-generation Manual Frames Buffer & Tray Management
    function openNoteImagePreview(sourceImage) {
      if (!(sourceImage instanceof HTMLImageElement) || !sourceImage.src) return;
      activeNoteImagePreviewClose?.();

      const overlay = document.createElement('div');
      overlay.className = 'note-image-lightbox';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', sourceImage.alt || '截图原图预览');

      const image = document.createElement('img');
      image.className = 'note-image-lightbox-image';
      image.src = sourceImage.src;
      image.alt = sourceImage.alt || '截图原图';

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'note-image-lightbox-close';
      closeButton.setAttribute('aria-label', '关闭原图预览');
      closeButton.textContent = '×';

      const caption = document.createElement('div');
      caption.className = 'note-image-lightbox-caption';
      caption.textContent = sourceImage.alt || '视频画面';

      const onKeydown = (event) => {
        if (event.key === 'Escape') closePreview();
      };
      const closePreview = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (activeNoteImagePreviewClose === closePreview) activeNoteImagePreviewClose = null;
      };

      closeButton.addEventListener('click', closePreview);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePreview();
      });
      document.addEventListener('keydown', onKeydown);
      overlay.append(image, closeButton, caption);
      document.body.appendChild(overlay);
      activeNoteImagePreviewClose = closePreview;
      closeButton.focus();
    }

    if (elements.aiManualTray) {
      elements.aiManualTray.addEventListener('click', (e) => {
        const delBtn = closestButton(e, '.btn-delete-tray-card');
        if (delBtn) {
          e.stopPropagation();
          const idx = Number(delBtn.dataset.index);
          if (idx >= 0 && idx < manualFrames.length) {
            const removed = manualFrames.splice(idx, 1)[0];
            renderManualTray();
            toast(`已移除 ${removed?.timeStr || ''} 预选截图`);
          }
          return;
        }

        const clearBtn = closestButton(e, '#btn-clear-manual-tray');
        if (clearBtn) {
          e.stopPropagation();
          manualFrames = [];
          renderManualTray();
          toast('已清空预选截图');
          return;
        }

        const trayCard = closestHtml(e, '.ai-tray-card');
        if (trayCard && trayCard.dataset.seek) {
          const sec = Number(trayCard.dataset.seek);
          if (Number.isFinite(sec)) {
            command('SEEK', { time: sec });
            toast(`已跳转至 ${BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : sec}`);
          }
        }
      });
    }

    // 为外部 AI 生成受控尺寸的联系表，而不是无限向下拼接的超长图。
    // 1~2 张保持单列以保文字分辨率；3~4 张使用双列。完整原图始终由 ZIP 保留。
    async function buildContactSheetBlob(frames) {
      if (!Array.isArray(frames) || !frames.length) return null;
      const initialLayout = BSE.Media?.getContactSheetLayout?.(frames.length) || {
        maxFrames: 4, count: Math.min(4, frames.length), width: 1152, columns: frames.length <= 2 ? 1 : 2, gap: 12, padding: 12, headerHeight: 34
      };
      const sourceFrames = frames.slice(0, initialLayout.maxFrames);
      const loaded = await Promise.all(sourceFrames.map((frame, index) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ img, frame, index });
        img.onerror = () => resolve(null);
        img.src = frame.dataUrl;
      })));
      const valid = loaded.filter(Boolean);
      if (!valid.length) return null;

      const layout = BSE.Media?.getContactSheetLayout?.(valid.length, {
        maxFrames: initialLayout.maxFrames,
        width: initialLayout.width
      }) || initialLayout;
      const { width, columns, gap, padding, headerHeight } = layout;
      const cardWidth = Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
      const maxImageHeight = columns === 1 ? 640 : 360;
      const rows = [];
      for (let start = 0; start < valid.length; start += columns) {
        const entries = valid.slice(start, start + columns).map((entry) => {
          const scale = Math.min(1, cardWidth / entry.img.width, maxImageHeight / entry.img.height);
          return {
            ...entry,
            imageWidth: Math.max(1, Math.round(entry.img.width * scale)),
            imageHeight: Math.max(1, Math.round(entry.img.height * scale))
          };
        });
        rows.push({
          entries,
          height: headerHeight + Math.max(...entries.map((entry) => entry.imageHeight))
        });
      }
      const totalHeight = padding * 2
        + rows.reduce((sum, row) => sum + row.height, 0)
        + gap * Math.max(0, rows.length - 1);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, totalHeight);

      const fitLabel = (text, maxWidth) => {
        const raw = String(text || '');
        if (ctx.measureText(raw).width <= maxWidth) return raw;
        let shortened = raw;
        while (shortened.length > 4 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
        return `${shortened}…`;
      };

      let rowY = padding;
      let visualIndex = 0;
      for (const row of rows) {
        row.entries.forEach(({ img, frame, imageWidth, imageHeight }, columnIndex) => {
          const x = padding + columnIndex * (cardWidth + gap);
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x, rowY, cardWidth, headerHeight);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          const time = frame.timeStr || `${Number(frame.timestamp) || 0}s`;
          const label = frame.label ? ` · ${frame.label}` : '';
          ctx.fillText(fitLabel(`${visualIndex + 1}. ${time}${label}`, cardWidth - 20), x + 10, rowY + 22);
          const imageX = x + Math.floor((cardWidth - imageWidth) / 2);
          ctx.drawImage(img, imageX, rowY + headerHeight, imageWidth, imageHeight);
          visualIndex++;
        });
        rowY += row.height + gap;
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return {
        blob,
        frameCount: valid.length,
        frames: valid.map(({ frame }) => frame),
        width,
        height: totalHeight
      };
    }

    // 可靠的外部投递路径：复制一张受控尺寸联系表，再在目标 AI 输入框粘贴。
    if (elements.btnCopyStitchedTray) {
      elements.btnCopyStitchedTray.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!manualFrames.length) {
          toast('当前暂无截图可供复制', true);
          return;
        }
        const videoDuration = state.duration || state.cues?.[state.cues.length - 1]?.to || 0;
        const selectedFrames = BSE.VisualDetector?.selectPresentationFrames
          ? BSE.VisualDetector.selectPresentationFrames(manualFrames, { videoDuration, maxFrames: 4 })
          : manualFrames.slice(0, 4);
        toast(`正在生成 ${selectedFrames.length} 张精选画面的高清联系表…`);
        try {
          const sheet = await buildContactSheetBlob(selectedFrames);
          if (!sheet?.blob) {
            toast('精选拼图生成失败', true);
            return;
          }
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': sheet.blob })
          ]);
          externalImageDeliveryMode = 'contact-sheet';
          externalDeliveredFrames = [...(sheet.frames || [])];
          const omitted = Math.max(0, manualFrames.length - sheet.frameCount);
          const omittedHint = omitted > 0 ? `；其余 ${omitted} 张请用“原图打包”保留完整画质` : '';
          toast(`已复制 ${sheet.frameCount} 张精选拼图 (${sheet.width}×${sheet.height})，可直接粘贴到网页版 AI${omittedHint}`);
        } catch (err) {
          console.error('[SparkSub] 复制精选拼图异常:', err);
          toast(`复制精选拼图失败: ${err.message}；可改用“原图打包”`, true);
        }
      });
    }

    // 打包下载全部截图为 ZIP（方便在网页端 AI 一次性拖拽上传多张图片附件）
    if (elements.btnDownloadTrayImages) {
      elements.btnDownloadTrayImages.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!manualFrames.length) {
          toast('当前暂无截图可供打包', true);
          return;
        }
        if (!BSE.JSZip) {
          toast('JSZip 依赖未就绪', true);
          return;
        }
        toast(`正在打包 ${manualFrames.length} 张高清原画…`);
        try {
          const zip = new BSE.JSZip();
          manualFrames.forEach((frame, idx) => {
            const base64Data = (frame.dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
            const safeTime = (frame.timeStr || `frame_${idx + 1}`).replace(/[:：]/g, '-');
            const fileName = `${String(idx + 1).padStart(2, '0')}_${safeTime}.webp`;
            zip.file(fileName, base64Data, { base64: true });
          });
          const blob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const safeTitle = (state?.title || '视频截图').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 30);
          a.href = url;
          a.download = `${safeTitle}_${manualFrames.length}张关键帧.zip`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          externalImageDeliveryMode = 'originals';
          externalDeliveredFrames = [...manualFrames];
          toast('截图包已下载。解压后可直接批量拖入网页版 AI；阶段二合成词会按这批原图生成');
        } catch (err) {
          toast(`打包下载失败: ${err.message}`, true);
        }
      });
    }

    // Copy External Planning Prompt for Web-based AI (ChatGPT / DeepSeek / Claude)
    if (elements.aiBtnCopyPlanPrompt) {
      elements.aiBtnCopyPlanPrompt.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供提取提示词', true);
          return;
        }
        const promptText = BSE.Ai?.buildPlanningPrompt?.({
          title: state.title,
          author: state.authorInfo?.name || state.mediaContext?.author || '',
          cues: state.cues,
          mediaContext: state.mediaContext || null,
          manualFrames
        }) || '';
        if (!promptText) {
          toast('构建提示词失败', true);
          return;
        }
        await navigator.clipboard.writeText(promptText);
        toast('已复制阶段一时间窗口规划词，可直接粘贴至网页版 AI 获取播放器取样窗口 JSON');
      });
    }

    // Copy External Synthesis Prompt (Stage 2) with already-captured screenshot tags
    if (elements.aiBtnCopySynthPrompt) {
      elements.aiBtnCopySynthPrompt.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供生成讲义', true);
          return;
        }

        // 阶段二提示词必须与用户实际投递给外部 AI 的图片集合一致：
        // 联系表只列联系表中的最多 4 张；原图包模式才从已打包原图中选择更宽的证据集。
        const videoDuration = state.duration || state.cues?.[state.cues.length - 1]?.to || 0;
        const hasDeliveredSnapshot = externalDeliveredFrames.length > 0;
        const deliveredFrames = hasDeliveredSnapshot ? [...externalDeliveredFrames] : [...manualFrames];
        const selectedFrames = externalImageDeliveryMode === 'originals'
          ? (BSE.VisualDetector?.selectEvidenceFrames
              ? BSE.VisualDetector.selectEvidenceFrames(deliveredFrames, { videoDuration })
              : deliveredFrames)
          : (BSE.VisualDetector?.selectPresentationFrames
              ? BSE.VisualDetector.selectPresentationFrames(deliveredFrames, { videoDuration, maxFrames: 4 })
              : deliveredFrames.slice(0, 4));
        const promptText = BSE.Ai?.buildCourseNotePrompt?.({
          title: state.title,
          author: state.authorInfo?.name || state.mediaContext?.author || '',
          cues: state.cues,
          mediaContext: state.mediaContext || null,
          capturedFrames: selectedFrames,
          mode: currentAiMode || 'course_notes'
        }) || '';

        if (!promptText) {
          toast('构建讲义合成提示词失败', true);
          return;
        }

        await navigator.clipboard.writeText(promptText);
        if (selectedFrames.length > 0) {
          const deliveryLabel = externalImageDeliveryMode === 'originals'
            ? `原图包中的 ${selectedFrames.length} 张高价值画面`
            : `精选拼图中的 ${selectedFrames.length} 张画面`;
          const deliveryHint = hasDeliveredSnapshot
            ? '请确保网页版 AI 收到同一批图片'
            : '请再点击“复制精选拼图”并粘贴同一批图片';
          toast(`已复制阶段二讲义合成词（按${deliveryLabel}生成）。${deliveryHint}`);
        } else {
          toast('已复制阶段二报告合成词。当前未绑定图片；建议先导入规划并截取关键画面', true);
        }
      });
    }

    // Open & Close Import Modal
    function openImportModal() {
      if (elements.aiImportModal) {
        elements.aiImportModal.hidden = false;
        if (elements.aiImportTextarea) {
          elements.aiImportTextarea.value = '';
          setTimeout(() => elements.aiImportTextarea.focus(), 50);
        }
      }
    }

    function closeImportModal() {
      if (elements.aiImportModal) {
        elements.aiImportModal.hidden = true;
      }
    }

    if (elements.aiBtnOpenImportModal) {
      elements.aiBtnOpenImportModal.addEventListener('click', openImportModal);
    }
    if (elements.aiBtnCloseImportModal) {
      elements.aiBtnCloseImportModal.addEventListener('click', closeImportModal);
    }
    if (elements.aiBtnCancelImport) {
      elements.aiBtnCancelImport.addEventListener('click', closeImportModal);
    }

    // Confirm & Process External Import (JSON or Markdown)
    if (elements.aiBtnConfirmImport) {
      elements.aiBtnConfirmImport.addEventListener('click', async () => {
        const rawText = (elements.aiImportTextarea?.value || '').trim();
        if (!rawText) {
          toast('请先粘贴内容', true);
          return;
        }
        const importState = state;
        let mediaContext;
        try {
          mediaContext = createMediaOperationContext();
        } catch (error) {
          toast(error.message, true);
          return;
        }

        // 1. 尝试解析为 JSON 规划
        const parsedJson = BSE.Ai?.extractJsonFromText?.(rawText);
        if (parsedJson && (parsedJson.samplingWindows || parsedJson.visualRequests || parsedJson.visualEvidence || parsedJson.chapters)) {
          closeImportModal();
          const samplingWindows = BSE.Ai?.normalizeSamplingWindows?.(parsedJson) || [];
          appendDiagnostic('AI外部导入', `成功解析外部规划 JSON · 提取 ${parsedJson.chapters?.length || 0} 个章节 · ${samplingWindows.length} 个取样窗口`, { scope: 'ai', level: 'info' });

          const videoDuration = importState.duration || importState.cues?.[importState.cues.length - 1]?.to || Infinity;
          const visualEvidence = BSE.VisualDetector?.resolveRequestTimestamps
            ? BSE.VisualDetector.resolveRequestTimestamps(samplingWindows, videoDuration)
            : samplingWindows.map((req, idx) => ({
                ...req,
                id: req.id || `SW_${idx + 1}`,
                timestamp: Number.isFinite(req.targetSec) ? req.targetSec : (Number.isFinite(req.timestamp) ? req.timestamp : (idx + 1) * 60),
                timeStr: req.timeStr || `${Math.round(Number.isFinite(req.targetSec) ? req.targetSec : (Number.isFinite(req.timestamp) ? req.timestamp : (idx + 1) * 60))}s`,
                label: req.label || req.evidenceGoal || `取样窗口 ${idx + 1}`,
                reason: req.reason || '字幕提示该时段可能包含额外信息'
              }));

          if (visualEvidence.length > 0) {
            if (elements.aiProgressBox) elements.aiProgressBox.hidden = false;
            if (elements.aiProgressText) elements.aiProgressText.textContent = `正在根据导入的规划定向截取高清原画 (0/${visualEvidence.length})…`;

            let doneCount = 0;
            let capturedCount = 0;
            let reusedCount = 0;
            for (const ev of visualEvidence) {
              try {
                const targetTime = Number.isFinite(ev.optimalSec) ? ev.optimalSec : ev.timestamp;
                const existingManual = manualFrames.find(mf => Math.abs(mf.timestamp - targetTime) <= 3);
                if (existingManual) {
                  reusedCount++;
                  doneCount++;
                  continue;
                }
                const res = await sendTabMessage({
                  type: 'BSE_CAPTURE_BEST_FRAME',
                  request: ev,
                  options: { quality: AI_EVIDENCE_FRAME_QUALITY, maxWidth: AI_EVIDENCE_FRAME_MAX_WIDTH, timeoutMs: 2500 }
                }, mediaContext);
                if (res?.ok && res.frame?.dataUrl) {
                  const capturedTimestamp = Number(res.frame.timestamp);
                  const sec = Number.isFinite(capturedTimestamp) ? capturedTimestamp : targetTime;
                  const timeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : `${Math.round(sec)}s`;
                  const frameObj = {
                    dataUrl: res.frame.dataUrl,
                    timestamp: sec,
                    timeStr,
                    label: ev.label || ev.reason || ev.evidenceGoal,
                    reason: ev.reason || ev.evidenceGoal,
                    evidenceGoal: ev.evidenceGoal,
                    importance: ev.importance,
                    source: 'planned',
                    selection: res.frame.selection
                  };
                  manualFrames.push(frameObj);
                  capturedCount++;
                  renderManualTray();
                  const selectionLabel = res.frame.selection?.strategy === 'visual' ? '像素稳定性筛选' : '时间兜底';
                  appendDiagnostic('AI视觉证据', `外部规划截帧成功 (${doneCount + 1}/${visualEvidence.length}) · ${timeStr} · ${selectionLabel} · ${frameObj.label}`, { scope: 'ai', level: 'info' });
                }
              } catch (err) {
                if (err?.code === 'MEDIA_CONTEXT_CHANGED') {
                  if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
                  toast(err.message, true);
                  return;
                }
                console.warn('[SparkSub AI] 外部规划截帧失败:', ev, err);
              }
              doneCount++;
              if (elements.aiProgressText) elements.aiProgressText.textContent = `正在根据导入的规划定向截取高清原画 (${doneCount}/${visualEvidence.length})…`;
            }
            if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
            const beforeShortlistCount = manualFrames.length;
            const finalBudget = BSE.VisualDetector?.evidenceBudgetForDuration?.(videoDuration) || 12;
            const trayBudget = Math.min(36, Math.max(finalBudget, finalBudget * 2));
            if (BSE.VisualDetector?.selectEvidenceFrames && manualFrames.length > trayBudget) {
              manualFrames = BSE.VisualDetector.selectEvidenceFrames(manualFrames, { videoDuration, maxFrames: trayBudget });
              renderManualTray();
            }
            const reusedLabel = reusedCount > 0 ? `，复用 ${reusedCount} 张已有画面` : '';
            const shortlistLabel = beforeShortlistCount > manualFrames.length ? `；候选初筛后托盘保留 ${manualFrames.length} 张` : `，托盘共 ${manualFrames.length} 张`;
            toast(`本次新增 ${capturedCount} 张高清画面${reusedLabel}${shortlistLabel}`);
          } else {
            toast('已识别章节大纲（未包含截图点位）');
          }
          return;
        }

        // 2. 若不是规划 JSON，直接作为最终 Markdown 讲义渲染
        assertMediaOperationContext(mediaContext);
        closeImportModal();
        const imagesMap = currentGeneratedNote?.imagesMap || {};
        const selectedImportedFrames = BSE.VisualDetector?.selectEvidenceFrames
          ? BSE.VisualDetector.selectEvidenceFrames(manualFrames, { videoDuration: importState.duration || importState.cues?.[importState.cues.length - 1]?.to || 0 })
          : manualFrames;
        for (const mf of selectedImportedFrames) {
          imagesMap[mf.timestamp] = mf;
          imagesMap[String(mf.timestamp)] = mf;
          if (mf.timeStr) imagesMap[mf.timeStr] = mf;
        }
        aiNoteRestoreRevision++;
        currentGeneratedNote = {
          markdown: rawText,
          imagesMap,
          mode: 'course_notes',
          title: importState?.title || '导入讲义',
          mediaKey: importState?.mediaKey || ''
        };
        const html = BSE.Formatters?.renderNoteToHtml?.(rawText, { imagesMap }) || rawText;
        if (elements.aiNoteContent) {
          elements.aiNoteContent.innerHTML = html;
          elements.aiNoteContent.hidden = false;
        }
        if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;
        if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = false;
        if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = false;
        await saveCurrentNoteToCache();
        if (state?.mediaKey === importState?.mediaKey) {
          toast('报告 Markdown 已导入并完成图文渲染');
        }
      });
    }

    // Generate AI Notes (两阶段视频证据规划与多模态合成流水线)
    if (elements.aiBtnGenerate) {
      elements.aiBtnGenerate.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供分解', true);
          return;
        }

        const generationState = state;
        const generationMode = currentAiMode;
        const generationManualFrames = [...manualFrames];
        const mediaContext = createMediaOperationContext();
        const generationRevision = ++aiGenerationRevision;
        aiNoteRestoreRevision++;

        await aiConfigReady;
        assertMediaOperationContext(mediaContext);
        const draftConfig = readDraftAiConfig();
        if (!isSavedAiConfig(draftConfig)) {
          if (elements.aiSettingsDrawer) elements.aiSettingsDrawer.hidden = false;
          toast('AI 配置有未保存修改，请先保存后再生成', true);
          return;
        }

        const activeConfig = await getActiveAiSettings();
        assertMediaOperationContext(mediaContext);
        const activeModelName = activeConfig.model || '大模型';

        elements.aiBtnGenerate.disabled = true;
        if (elements.aiProgressBox) elements.aiProgressBox.hidden = false;
        if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;

        const updateProgress = (txt) => {
          if (generationRevision !== aiGenerationRevision) return;
          if (elements.aiProgressText) elements.aiProgressText.textContent = txt;
        };

        const startTime = performance.now();
        let step3Timer = null;
        try {
          const imagesMap = {};
          const capturedScreenshots = [];
          let plannedEvidence = [];

          let aiResult;
          if (generationMode === 'course_notes') {
            // 阶段一：文本模型只根据带时间戳字幕规划章节与播放器取样窗口。
            appendDiagnostic('AI时间规划', `正在向大模型提交带时间戳字幕以规划章节与取样窗口 (字幕: ${generationState.cues.length} 条 · 用户标记: ${generationManualFrames.length} 处 · 模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            updateProgress(`1/3 正在由 ${activeModelName} 分析字幕并规划取样时间窗口…`);
            const planResult = await BSE.Ai?.planVisualEvidence?.({
              title: generationState.title,
              author: generationState.authorInfo?.name || '',
              cues: generationState.cues,
              manualFrames: generationManualFrames,
              videoDuration: generationState.duration || generationState.cues?.[generationState.cues.length - 1]?.to || Infinity,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model
            });

            assertMediaOperationContext(mediaContext);
            if (!planResult) throw new Error('AI 视频规划模块未返回结果');
            if (planResult.strategy === 'fallback' && planResult.failureKind === 'request') {
              throw new Error(`AI 规划阶段调用失败: ${planResult.error || '模型服务不可用'}`);
            }
            if (planResult.strategy === 'fallback' && planResult.failureKind === 'parse') {
              appendDiagnostic('AI时间规划', `规划返回格式异常，已降级为字幕 + 用户标记内容直接合成: ${planResult.error || 'JSON 解析失败'}`, { scope: 'ai', level: 'warn' });
              updateProgress('1/3 时间窗口规划格式异常，已降级为字幕与用户标记内容直接合成…');
            }

            plannedEvidence = planResult.visualEvidence || [];
            appendDiagnostic('AI时间规划', `规划完成 · 提取 ${planResult.chapters?.length || 0} 个章节 · 给出 ${plannedEvidence.length} 个播放器取样窗口 (策略: ${planResult.strategy})`, { scope: 'ai', level: planResult.strategy === 'fallback' ? 'warn' : 'info' });

            // 阶段二：允许规划覆盖更多高价值画面；所有候选先留在内存，完成后再做跨画面的去重与质量筛选。
            const capturedFrames = [...generationManualFrames];

            if (plannedEvidence.length > 0) {
              updateProgress(`2/3 正在根据大模型规划定位稳定画面代表帧 (0/${plannedEvidence.length})…`);
              let doneCount = 0;
              for (const ev of plannedEvidence) {
                try {
                  const targetTime = Number.isFinite(ev.optimalSec) ? ev.optimalSec : ev.timestamp;
                  // 若用户已预先截取过该时间附近（3秒内）的画面，直接复用，避免重复寻道
                  const existingManual = generationManualFrames.find(mf => Math.abs(mf.timestamp - targetTime) <= 3);
                  if (existingManual) {
                    doneCount++;
                    updateProgress(`2/3 正在根据大模型规划定位稳定画面代表帧 (${doneCount}/${plannedEvidence.length})…`);
                    continue;
                  }

                  const res = await sendTabMessage({
                    type: 'BSE_CAPTURE_BEST_FRAME',
                    request: ev,
                    options: { quality: AI_EVIDENCE_FRAME_QUALITY, maxWidth: AI_EVIDENCE_FRAME_MAX_WIDTH, timeoutMs: 2500 }
                  }, mediaContext);
                  if (res?.ok && res.frame?.dataUrl) {
                    const capturedTimestamp = Number(res.frame.timestamp);
                    const sec = Number.isFinite(capturedTimestamp) ? capturedTimestamp : targetTime;
                    const timeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : `${Math.round(sec)}s`;
                    const frameObj = {
                      dataUrl: res.frame.dataUrl,
                      timestamp: sec,
                      timeStr,
                      label: ev.label || ev.reason || ev.evidenceGoal,
                      reason: ev.reason || ev.evidenceGoal,
                      evidenceGoal: ev.evidenceGoal,
                      importance: ev.importance,
                      source: 'planned',
                      selection: res.frame.selection
                    };
                    capturedFrames.push(frameObj);
                    const selectionLabel = res.frame.selection?.strategy === 'visual' ? '像素稳定性筛选' : '时间兜底';
                    appendDiagnostic('AI视觉证据', `成功截取代表帧 (${doneCount + 1}/${plannedEvidence.length}) · ${timeStr} · ${selectionLabel} · ${frameObj.label}`, { scope: 'ai', level: 'info' });
                  } else {
                    appendDiagnostic('AI视觉证据', `代表帧截取受限 (${ev.timeStr || targetTime + 's'}): ${res?.error || '画面未就绪'}`, { scope: 'ai', level: 'warn' });
                  }
                } catch (err) {
                  if (err?.code === 'MEDIA_CONTEXT_CHANGED') throw err;
                  console.warn('[SparkSub AI] 截帧失败:', ev, err);
                  appendDiagnostic('AI视觉证据', `代表帧截取异常: ${err.message}`, { scope: 'ai', level: 'warn' });
                }
                doneCount++;
                updateProgress(`2/3 正在根据大模型规划定位稳定画面代表帧 (${doneCount}/${plannedEvidence.length})…`);
              }
            }

            const videoDuration = generationState.duration || generationState.cues?.[generationState.cues.length - 1]?.to || 0;
            const selectedFrames = BSE.VisualDetector?.selectEvidenceFrames
              ? BSE.VisualDetector.selectEvidenceFrames(capturedFrames, { videoDuration })
              : capturedFrames;
            for (const frame of selectedFrames) {
              imagesMap[frame.timestamp] = frame;
              imagesMap[String(frame.timestamp)] = frame;
              if (frame.timeStr) imagesMap[frame.timeStr] = frame;
              capturedScreenshots.push(frame.dataUrl);
            }
            if (capturedFrames.length !== selectedFrames.length) {
              appendDiagnostic('AI视觉证据', `候选画面 ${capturedFrames.length} 张，经近重复、质量与时间覆盖筛选后保留 ${selectedFrames.length} 张；未入选候选不写入讲义缓存`, { scope: 'ai', level: 'info' });
            }

            // 阶段三：仅将筛选后的高价值画面送入模型并进入最终缓存。
            appendDiagnostic('AI多模态合成', `正在向多模态大模型上传 ${selectedFrames.length} 张画面与结构化知识大纲 (模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            let elapsedSec = 0;
            updateProgress(`3/3 正在由多模态大模型组织结构化知识与图文讲义排版… (已耗时 0s)`);
            step3Timer = setInterval(() => {
              elapsedSec++;
              updateProgress(`3/3 正在由多模态大模型组织结构化知识与图文讲义排版… (已耗时 ${elapsedSec}s)`);
            }, 1000);

            aiResult = await BSE.Ai?.generateCourseNotes?.({
              title: generationState.title,
              author: generationState.authorInfo?.name || '',
              cues: generationState.cues,
              screenshots: capturedScreenshots,
              capturedFrames: selectedFrames,
              videoIR: planResult,
              mode: generationMode,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
              onProgress: (p) => updateProgress(p)
            });
          } else {
            appendDiagnostic('AI文本精修', `正在由大模型深度提炼文本 (模式: ${generationMode} · 模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            updateProgress(`正在由 ${activeModelName} 深度提炼…`);
            aiResult = await BSE.Ai?.generateCourseNotes?.({
              title: generationState.title,
              author: generationState.authorInfo?.name || '',
              cues: generationState.cues,
              screenshots: [],
              capturedFrames: [],
              visualEvidence: [],
              mode: generationMode,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
              onProgress: updateProgress
            });
          }

          if (step3Timer) {
            clearInterval(step3Timer);
            step3Timer = null;
          }

          assertMediaOperationContext(mediaContext);
          const markdown = aiResult?.markdown || '';
          if (!markdown.trim()) throw new Error('AI 返回的学习内容为空');
          const totalDurationSec = ((performance.now() - startTime) / 1000).toFixed(1);
          const renderedEvidenceCount = new Set(Object.values(imagesMap).map((frame) => String(frame?.timestamp ?? frame?.timeStr ?? ''))).size;
          const actualModel = aiResult?.modelUsed || activeModelName;
          appendDiagnostic('AI内容生成', `生成成功 (总耗时 ${totalDurationSec}s · 模型: ${actualModel} · Markdown ${markdown.length} 字符 · 图文证据 ${renderedEvidenceCount} 张)`, { scope: 'ai', level: 'info' });

          aiNoteRestoreRevision++;
          currentGeneratedNote = {
            markdown,
            imagesMap,
            mode: generationMode,
            title: generationState.title || '课程笔记',
            mediaKey: generationState.mediaKey || ''
          };

          // Render Markdown with Interactive Image Cards
          const html = BSE.Formatters?.renderNoteToHtml?.(markdown, { imagesMap }) || markdown;
          if (elements.aiNoteContent) {
            elements.aiNoteContent.innerHTML = html;
            elements.aiNoteContent.hidden = false;
          }

          if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = false;
          if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = false;
          await saveCurrentNoteToCache();
          if (generationRevision !== aiGenerationRevision) return;
          const successLabel = generationMode === 'summary'
            ? '快速回顾'
            : (generationMode === 'deep_qa' ? '复盘自测' : '学习讲义');
          toast(`${successLabel}生成成功`);
        } catch (err) {
          if (step3Timer) {
            clearInterval(step3Timer);
            step3Timer = null;
          }
          if (generationRevision !== aiGenerationRevision) {
            console.info('[SparkSub AI] 忽略已过期生成任务的结束状态:', err?.message || err);
            return;
          }
          if (err?.code === 'MEDIA_CONTEXT_CHANGED') {
            console.info('[SparkSub AI] 生成因媒体上下文变化而中止:', err.message);
            if (generationRevision === aiGenerationRevision) toast(err.message, true);
            return;
          }
          appendDiagnostic('AI生成异常', `生成失败: ${err.message}`, { scope: 'ai', level: 'error' });
          const is401 = String(err.message).includes('401') || String(err.message).includes('invalid_api_key');
          if (is401) {
            toast('AI 认证失败：请在右上角设置中输入并保存 API Key', true);
            if (elements.aiSettingsDrawer) elements.aiSettingsDrawer.hidden = false;
            if (elements.aiInputApiKey) elements.aiInputApiKey.focus();
          } else {
            toast(`生成失败: ${err.message}`, true);
          }
          if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = false;
        } finally {
          if (step3Timer) {
            clearInterval(step3Timer);
            step3Timer = null;
          }
          if (generationRevision === aiGenerationRevision) {
            elements.aiBtnGenerate.disabled = false;
            if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
          }
        }
      });
    }

    // Snip Current Frame Button (支持预选截图托盘与实时讲义追加)
    if (elements.aiBtnSnipFrame) {
      elements.aiBtnSnipFrame.addEventListener('click', async () => {
        try {
          const mediaContext = createMediaOperationContext();
          const res = await sendTabMessage({
            type: 'BSE_CAPTURE_FRAME',
            options: { quality: AI_EVIDENCE_FRAME_QUALITY, maxWidth: AI_EVIDENCE_FRAME_MAX_WIDTH }
          }, mediaContext);
          if (res?.ok && res.frame?.dataUrl) {
            const capturedTimestamp = Number(res.frame.timestamp);
            const time = Math.round(Number.isFinite(capturedTimestamp) ? capturedTimestamp : 0);
            const timeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(time) : `${time}s`;
            const frameObj = {
              dataUrl: res.frame.dataUrl,
              timestamp: time,
              timeStr,
              label: `重点画面 (${timeStr})`,
              reason: '用户手动标记的关键画面',
              source: 'manual'
            };

            // 1. 保存至预选截图托盘（供稍后点击生成讲义时一并传给 AI）
            const existingIdx = manualFrames.findIndex(f => Math.abs(f.timestamp - time) <= 1);
            if (existingIdx >= 0) {
              manualFrames[existingIdx] = frameObj;
            } else {
              manualFrames.push(frameObj);
            }
            renderManualTray();

            // 2. 若当前已处于讲义展示状态，同步向现有讲义中插入卡片
            if (currentGeneratedNote?.markdown) {
              currentGeneratedNote.imagesMap[timeStr] = frameObj;
              currentGeneratedNote.imagesMap[time] = frameObj;
              const frameReference = BSE.Formatters?.buildFrameReference?.(timeStr, '重点画面截图') || `[SCREENSHOT: ${timeStr} "重点画面截图"]`;
              currentGeneratedNote.markdown += `\n\n${frameReference}\n`;

              const html = BSE.Formatters?.renderNoteToHtml?.(currentGeneratedNote.markdown, { imagesMap: currentGeneratedNote.imagesMap }) || currentGeneratedNote.markdown;
              if (elements.aiNoteContent) {
                elements.aiNoteContent.innerHTML = html;
                elements.aiNoteContent.hidden = false;
              }
              if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;
              if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = false;
              if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = false;
              await saveCurrentNoteToCache();
              if (state?.mediaKey === mediaContext.mediaKey) toast(`已截取 ${timeStr} 画面并加入笔记`);
            } else {
              toast(`已截取 ${timeStr} 画面（已加入预选，生成讲义时将一并传给 AI）`);
            }
          } else {
            toast('截帧失败，请确认当前视频正在播放', true);
          }
        } catch (err) {
          toast(`截帧异常: ${err.message}`, true);
        }
      });
    }

    // Click handler for jump-to-time buttons, slot capture, and image deletion inside note
    if (elements.aiNoteContent) {
      elements.aiNoteContent.addEventListener('click', async (e) => {
        // 1. 删除图片按钮
        const deleteBtn = closestButton(e, '.note-card-delete-btn');
        if (deleteBtn) {
          e.stopPropagation();
          e.preventDefault();
          const timeStr = deleteBtn.dataset.timestr || '';
          const sec = Number(deleteBtn.dataset.seek);
          const referenceTimeStr = deleteBtn.dataset.refTimestr || timeStr;
          const referenceSecValue = Number(deleteBtn.dataset.refSeek);
          const referenceSec = Number.isFinite(referenceSecValue) ? referenceSecValue : sec;
          if (currentGeneratedNote?.imagesMap) {
            const resolved = BSE.Formatters?.resolveFrameEntry?.(currentGeneratedNote.imagesMap, {
              timeStr,
              seconds: sec,
              maxDistance: 0.01
            });
            if (resolved?.frame) removeFrameAliases(currentGeneratedNote.imagesMap, resolved.frame, sec);
          }
          if (currentGeneratedNote?.markdown) {
            currentGeneratedNote.markdown = BSE.Formatters?.transformFrameReferences
              ? BSE.Formatters.transformFrameReferences(currentGeneratedNote.markdown, (reference) => (
                  Math.abs(reference.seconds - referenceSec) < 0.01 && reference.timeStr === referenceTimeStr ? '' : reference.raw
                ))
              : currentGeneratedNote.markdown;
            const html = BSE.Formatters?.renderNoteToHtml?.(currentGeneratedNote.markdown, { imagesMap: currentGeneratedNote.imagesMap }) || currentGeneratedNote.markdown;
            elements.aiNoteContent.innerHTML = html;
            await saveCurrentNoteToCache();
            toast(`已删除 ${timeStr} 截图`);
          }
          return;
        }

        // 2. 点击缩略图查看完整原图；跳转视频只由明确的时间按钮触发，避免“zoom-in”光标却执行跳播。
        const previewImage = closestHtml(e, '.note-img-thumbnail');
        if (previewImage instanceof HTMLImageElement) {
          e.stopPropagation();
          openNoteImagePreview(previewImage);
          return;
        }

        // 3. 跳转播放按钮
        const jumpBtn = closestButton(e, '.note-jump-btn');
        if (jumpBtn && jumpBtn.dataset.seek) {
          const sec = Number(jumpBtn.dataset.seek);
          if (Number.isFinite(sec)) {
            command('SEEK', { time: sec });
            toast(`已跳转至 ${BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : sec}`);
          }
          return;
        }

        // 4. 立即补截插槽按钮
        const slotBtn = closestButton(e, '.btn-capture-slot');
        if (slotBtn) {
          const sec = Number(slotBtn.dataset.seek);
          const timeStr = slotBtn.dataset.timestr;
          const mediaContext = createMediaOperationContext();
          toast(`正在截取 ${timeStr} 画面…`);
          const res = await sendTabMessage({
            type: 'BSE_CAPTURE_FRAME',
            timestamp: sec,
            options: { restoreTime: true, quality: AI_EVIDENCE_FRAME_QUALITY, maxWidth: AI_EVIDENCE_FRAME_MAX_WIDTH }
          }, mediaContext);
          if (res?.ok && res.frame?.dataUrl) {
            currentGeneratedNote.imagesMap[timeStr] = {
              dataUrl: res.frame.dataUrl,
              timestamp: sec,
              timeStr,
              label: `补充画面 (${timeStr})`,
              reason: '用户在报告中手动补截的画面',
              source: 'manual'
            };
            currentGeneratedNote.imagesMap[sec] = currentGeneratedNote.imagesMap[timeStr];
            const html = BSE.Formatters?.renderNoteToHtml?.(currentGeneratedNote.markdown, { imagesMap: currentGeneratedNote.imagesMap }) || currentGeneratedNote.markdown;
            elements.aiNoteContent.innerHTML = html;
            await saveCurrentNoteToCache();
            if (state?.mediaKey === mediaContext.mediaKey) toast(`已嵌入 ${timeStr} 视频画面`);
          }
        }
      });
    }

    // Copy the currently selected learning artifact. Each mode is persisted
    // independently, so copying Summary never replaces Notes or Self-test.
    if (elements.aiBtnCopyNote) {
      elements.aiBtnCopyNote.addEventListener('click', async () => {
        if (!currentGeneratedNote.markdown) return;
        await navigator.clipboard.writeText(currentGeneratedNote.markdown);
        const label = currentGeneratedNote.mode === 'summary'
          ? '快速回顾'
          : (currentGeneratedNote.mode === 'deep_qa' ? '复盘自测' : '学习讲义');
        toast(`已复制${label} Markdown`);
      });
    }

    // Deep notes export as a Markdown + image package. Text-only artifacts are
    // downloaded directly as Markdown; wrapping them in an empty ZIP is needless work.
    if (elements.aiBtnExportZip) {
      elements.aiBtnExportZip.addEventListener('click', async () => {
        if (!currentGeneratedNote.markdown) {
          toast('当前模式还没有可导出的学习产物', true);
          return;
        }
        const safeTitle = (state?.title || 'SparkSub').replace(/[\/\\?%*:|"<>]/g, '_').slice(0, 40);
        if (currentGeneratedNote.mode !== 'course_notes') {
          const suffix = currentGeneratedNote.mode === 'summary' ? '快速回顾' : '复盘自测';
          const blob = new Blob([currentGeneratedNote.markdown], { type: 'text/markdown;charset=utf-8' });
          BSE.Utils?.downloadBlob?.(blob, `${safeTitle}_${suffix}.md`);
          toast(`已下载${suffix} Markdown`);
          return;
        }
        if (!BSE.JSZip) {
          toast('图文打包模块未加载', true);
          return;
        }
        try {
          toast('正在打包学习讲义与原始画面…');
          const zip = new BSE.JSZip();

          // 去重收集唯一的图像
          const uniqueImageMap = new Map();
          for (const [key, item] of Object.entries(currentGeneratedNote.imagesMap || {})) {
            if (!item || !item.dataUrl) continue;
            const dataUrl = item.dataUrl;
            if (!uniqueImageMap.has(dataUrl)) {
              uniqueImageMap.set(dataUrl, item);
            }
          }

          let exportedMd = currentGeneratedNote.markdown;
          let imgIndex = 1;
          const exportedFrames = [];

          for (const [dataUrl, item] of uniqueImageMap.entries()) {
            const timeStr = String(item.timeStr || item.timestamp || imgIndex).replace(/:/g, '_');
            const imgFilename = `screenshot_${timeStr}_${imgIndex++}.webp`;

            const base64Data = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            zip.file(`images/${imgFilename}`, bytes);
            exportedFrames.push({ item, dataUrl, imgFilename });
          }

          if (BSE.Formatters?.transformFrameReferences && BSE.Formatters?.resolveFrameEntry) {
            exportedMd = BSE.Formatters.transformFrameReferences(exportedMd, (reference) => {
              const resolved = BSE.Formatters.resolveFrameEntry(currentGeneratedNote.imagesMap || {}, {
                timeStr: reference.timeStr,
                seconds: reference.seconds,
                maxDistance: 5
              });
              if (!resolved?.frame) return reference.raw;
              const matched = exportedFrames.find(({ item, dataUrl }) => (
                item === resolved.frame || dataUrl === resolved.frame.dataUrl
              ));
              if (!matched) return reference.raw;
              const alt = String(reference.label || matched.item.label || '视频画面').replace(/\]/g, '）');
              return `![${alt}](images/${matched.imgFilename})`;
            });
          }

          zip.file(`${safeTitle}.md`, exportedMd);
          const blob = await zip.generateAsync({ type: 'blob' });
          BSE.Utils?.downloadBlob?.(blob, `${safeTitle}_图文讲义.zip`);
          toast('已导出图文 Markdown 压缩包');
        } catch (err) {
          toast(`导出失败: ${err.message}`, true);
        }
      });
    }

    // Legacy AI Prompt cards
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.ai-prompt-card')).forEach((card) => {
      card.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供总结', true);
          return;
        }
        const promptId = card.dataset.prompt;
        const text = BSE.Formatters.generateAiPrompt(promptId, state.cues, false, { title: state.title, mediaContext: state.mediaContext || null });
        await navigator.clipboard.writeText(text);
        toast(BSE.I18n?.t('ai_copied_toast') || '已复制 AI 提示词与文稿');
      });
    });
  }

  setupAiWorkbench();

  if (elements.settingsToggle) {
    elements.settingsToggle.addEventListener('click', () => {
      const shouldClose = !elements.settingsDrawer.hidden;
      elements.settingsDrawer.hidden = shouldClose;
      elements.settingsToggle.classList.toggle('active', !shouldClose);
      elements.settingsToggle.setAttribute('aria-expanded', String(!shouldClose));
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
    const copyBtn = closestButton(event, '.cue-copy-btn');
    if (copyBtn) {
      event.stopPropagation();
      const paragraph = copyBtn.closest('.paragraph');
      if (paragraph) {
        const text = paragraph.querySelector('.paragraph-body')?.textContent || '';
        await navigator.clipboard.writeText(text);
        toast('本段文字已复制');
        return;
      }
      const cue = copyBtn.closest('.cue');
      if (cue) {
        const text = cue.querySelector('.cue-text')?.textContent || '';
        await navigator.clipboard.writeText(text);
        toast('本句字幕已复制');
        return;
      }
    }

    const selection = window.getSelection()?.toString();
    if (selection && selection.trim().length > 0) return;
    const row = closestHtml(event, '.cue');
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

  elements.copyDiagnostic.addEventListener('click', async (event) => {
    event.stopPropagation();
    const fault = state?.lastError;
    const header = [
      `扩展版本：${state?.version || '未知'}`,
      `平台：${state?.platform || '未知'}`,
      `媒体：${state?.mediaKey || '未知'}`,
      `状态：${state?.status || '未知'} / ${state?.message || ''}`,
      `错误：${fault ? `${fault.stage} / ${fault.code} / ${fault.message}` : '无'}`
    ].join('\n');
    await navigator.clipboard.writeText(diagnosticsPresenter.copyTechnical(header));
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
        toast(`已提取 ${bitrateKbps}kbps 音频直链并复制，正在下载文件…`);

        await BSE.Bilibili.downloadAudioFile(audioData, state?.title || '音频');
        toast(`音频文件下载完成 (${bitrateKbps}kbps M4A)`);
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
              <span>${hasMultipleSections ? `第 ${sIdx + 1} 章 · ` : ''}${BSE.Utils.escapeHtml(sec.title)}</span>
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
                <span>视频 ${ep.index}：${BSE.Utils.escapeHtml(ep.title)}</span>
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
                    <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> <strong>${BSE.Utils.escapeHtml(pLabel)}</strong>
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
                  <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> ${BSE.Utils.escapeHtml(ep.title)}
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

  function getBatchOutputMode() {
    const selected = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-output"]:checked'));
    if (selected?.value === 'merged-file' || selected?.value === 'zip') return selected.value;
    return 'copy-text';
  }

  function syncBatchOutputControls() {
    const mode = getBatchOutputMode();
    const formatInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-format"]:checked'));
    const srtOption = /** @type {HTMLElement | null} */ (document.querySelector('.batch-format-srt'));
    const showFormat = mode !== 'copy-text';
    const allowSrt = mode === 'zip';

    if (elements.batchFormatRow) elements.batchFormatRow.hidden = !showFormat;
    if (elements.batchFormatLabel) {
      elements.batchFormatLabel.textContent = allowSrt ? 'ZIP 内单文件格式' : '合并文件格式';
    }
    if (srtOption) srtOption.hidden = !allowSrt;
    if (!allowSrt && formatInput?.value === 'srt') {
      const mdInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-format"][value="md"]'));
      if (mdInput) mdInput.checked = true;
    }

    const activeFormat = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-format"]:checked'))?.value || 'md';
    const showTimestamp = mode !== 'zip' || activeFormat !== 'srt';
    if (elements.batchTimestampRow) elements.batchTimestampRow.hidden = !showTimestamp;

    const checkedCount = queryInputs(elements.batchTreeList, '.batch-tree-cb:checked').length;
    if (elements.batchStartBtn && !batchControlTask?.running) {
      elements.batchStartBtn.disabled = checkedCount === 0;
      elements.batchStartBtn.textContent = mode === 'copy-text'
        ? `复制 ${checkedCount || ''} 项字幕`.replace(/\s+/g, ' ').trim()
        : (mode === 'merged-file' ? '下载合并长文件' : '导出独立文件 ZIP');
    }
  }

  function updateTreeSummaryAndScope() {
    if (!currentTree || !elements.batchTreeList) return;
    const allCbs = queryInputs(elements.batchTreeList, '.batch-tree-cb');
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
    queryInputs(elements.batchTreeList, '.batch-tree-sec-cb').forEach(secCb => {
      const secKey = secCb.dataset.secKey;
      const childCbs = queryInputs(elements.batchTreeList, `.batch-tree-cb[data-sec-key="${secKey}"]`);
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
    queryInputs(elements.batchTreeList, '.batch-tree-video-cb').forEach(vCb => {
      const bvid = vCb.dataset.bvid;
      const childCbs = queryInputs(elements.batchTreeList, `.batch-tree-cb[data-bvid="${bvid}"]`);
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
    syncBatchOutputControls();
  }

  async function openBatchModal(targetId, targetPlatform) {
    try {
      const explicitPlatform = targetPlatform === 'youtube' || targetPlatform === 'bilibili' ? targetPlatform : '';
      const isYouTube = explicitPlatform
        ? explicitPlatform === 'youtube'
        : (state?.platform === 'youtube' || (state?.url && state.url.includes('youtube.com')));
      // DOM click listeners pass a MouseEvent as their first argument. Only explicit string IDs
      // are accepted here, otherwise derive the media ID from the active state URL.
      const explicitTargetId = typeof targetId === 'string' ? targetId.trim() : '';
      const bvid = !isYouTube
        ? (BSE.Utils?.getBvid?.(explicitTargetId) || BSE.Utils?.getBvid?.(state?.url || ''))
        : null;
      const ytId = isYouTube
        ? (explicitTargetId || (BSE.Utils?.getYouTubeVideoId ? BSE.Utils.getYouTubeVideoId(state?.url || '') : ''))
        : null;

      if (!bvid && !isYouTube) {
        toast('未识别到视频或合集 ID', true);
        return;
      }
      if (batchControlTask?.running) {
        batchControlTask.cancelled = true;
        batchControlTask.controller?.abort();
      }
      batchControlTask = null;
      currentTree = null;
      elements.batchOverlay.hidden = false;
      elements.batchProgressBox.hidden = true;
      elements.batchStartBtn.hidden = false;
      elements.batchStartBtn.disabled = true;
      elements.batchStartBtn.textContent = '正在读取目录…';
      elements.batchPauseBtn.hidden = true;
      elements.batchCancelBtn.hidden = true;
      elements.batchProgressText.textContent = '准备开始…';
      elements.batchProgressBarFill.style.width = '0%';
      elements.batchProgressPercent.textContent = '0%';
      elements.batchCntSuccess.textContent = '0';
      elements.batchCntNosub.textContent = '0';
      elements.batchCntFailed.textContent = '0';
      rotateDiagnosticSession('batch', 'export');

      toast('正在分析合集与分P架构…');
      const diagLogger = (stage, msg) => appendDiagnostic(stage, msg, {
        scope: 'batch',
        sessionId: diagnosticSessions.batch
      });

      if (isYouTube) {
        const cachedSub = subscriptionsCache.find((s) => s.id === explicitTargetId || s.targetId === explicitTargetId);
        if (cachedSub && Array.isArray(cachedSub.items) && cachedSub.items.length > 0) {
          /** @type {import('../types/bse').BilibiliItem[]} */
          const items = cachedSub.items.map((it, idx) => {
            const globalIndex = idx + 1;
            const title = it.title || `第 ${globalIndex} 节`;
            return {
              kind: 'episode',
              globalIndex,
              sectionIndex: 1,
              sectionTitle: cachedSub.title || '播放列表',
              sectionKey: 'section_0',
              episodeIndex: globalIndex,
              episodeTitle: title,
              bvid: it.id,
              cid: it.id,
              aid: it.id,
              title,
              page: 1,
              part: title,
              duration: typeof it.duration === 'number' ? it.duration : 0,
              sourceUrl: it.url
            };
          });
          currentTree = {
            title: cachedSub.title || 'YouTube 播放列表',
            kind: 'youtube_playlist',
            isCollection: true,
            seasonId: cachedSub.targetId || explicitTargetId || '',
            currentBvid: ytId || '',
            currentPage: 1,
            totalEpisodesCount: items.length,
            items,
            sections: [{
              index: 1,
              key: 'section_0',
              title: cachedSub.title || '播放列表',
              items,
              episodes: items.map((it) => ({
                bvid: it.bvid,
                aid: it.aid,
                title: it.title,
                index: it.globalIndex,
                pagesCount: 1,
                items: [it]
              }))
            }],
            hasNestedPages: false
          };
        } else {
          currentTree = await BSE.YouTube.fetchMediaTree(ytId, { diagnostic: diagLogger });
        }
      } else {
        currentTree = await BSE.Bilibili.fetchMediaTree(bvid, {
          diagnostic: diagLogger,
          pageUrl: state?.url || ''
        });
      }

      // Batch browsing is a metadata view, not an update-discovery path. It may
      // enrich tracker rows already known to the ledger, but it must never
      // replace the ledger or invent new read/unread state. Otherwise opening
      // the batch dialog can erase `isRead` / cached subtitles and resurrect
      // work the user has already consumed.
      if (currentTree && Array.isArray(currentTree.items) && currentTree.items.length > 0) {
        const sid = currentTree.seasonId ? String(currentTree.seasonId) : '';
        const matchingSub = subscriptionsCache.find((s) => {
          if (sid && (s.targetId === sid || s.id.includes(`:${sid}`))) return true;
          if (bvid && (s.bvid === bvid || s.latestBvid === bvid || s.targetId === bvid)) return true;
          if (ytId && (s.bvid === ytId || s.latestBvid === ytId || s.targetId === ytId)) return true;
          if (s.sourceUrl && ((bvid && s.sourceUrl.includes(bvid)) || (sid && s.sourceUrl.includes(sid)))) return true;
          return false;
        });
        if (matchingSub && Array.isArray(matchingSub.items) && matchingSub.items.length > 0) {
          const pageCountsByBvid = new Map();
          for (const treeItem of currentTree.items) {
            const itemBvid = String(treeItem.bvid || bvid || '');
            if (!itemBvid) continue;
            pageCountsByBvid.set(itemBvid, (pageCountsByBvid.get(itemBvid) || 0) + 1);
          }

          const existingById = new Map(matchingSub.items.map((item) => [item.id, item]));
          let trackerMetadataChanged = false;
          for (const it of currentTree.items) {
            const itemBvid = String(it.bvid || bvid || '');
            const pageNumber = Number(it.page) || 1;
            const needsPageIdentity = Boolean(itemBvid) && (
              (pageCountsByBvid.get(itemBvid) || 0) > 1
              || currentTree.kind === 'multi_page'
              || currentTree.kind === 'bpx_eplist'
            );
            const canonicalId = currentTree.kind === 'youtube_playlist'
              ? String(it.bvid || it.id || '')
              : (needsPageIdentity ? `${itemBvid}:p${pageNumber}` : itemBvid);
            if (!canonicalId) continue;

            // p1 used to be stored as plain BV by the batch UI. Accept that
            // alias once and migrate it to the same canonical key the poller
            // uses, while preserving all durable tracker state.
            const legacyP1Id = needsPageIdentity && pageNumber === 1 ? itemBvid : '';
            const previous = existingById.get(canonicalId) || (legacyP1Id ? existingById.get(legacyP1Id) : null);
            if (!previous) continue;

            const incomingPubdate = Number(it.pubdate) > 0
              ? (Number(it.pubdate) > 1e11 ? Number(it.pubdate) : Number(it.pubdate) * 1000)
              : 0;
            const previousReadState = previous.isRead;
            const previousSubtitle = previous.subtitle;
            const previousHasSubtitle = previous.hasSubtitle;
            Object.assign(previous, {
              id: canonicalId,
              title: String(it.part || it.title || previous.title || '').trim(),
              url: it.sourceUrl || previous.url,
              pubdate: incomingPubdate || previous.pubdate || 0,
              duration: Number(it.duration) || previous.duration || 0,
              author: previous.author || currentTree.title || matchingSub.title,
              cid: it.cid || previous.cid,
              isRead: previousReadState,
              subtitle: previousSubtitle,
              hasSubtitle: previousHasSubtitle
            });
            if (legacyP1Id && legacyP1Id !== canonicalId) {
              existingById.delete(legacyP1Id);
              existingById.set(canonicalId, previous);
            }
            trackerMetadataChanged = true;
          }

          if (bvid && !matchingSub.bvid) {
            matchingSub.bvid = bvid;
            trackerMetadataChanged = true;
          }
          if (currentTree.title && (matchingSub.title === '合集' || matchingSub.title === '视频合集' || matchingSub.title === 'YouTube 播放列表' || !matchingSub.title)) {
            matchingSub.title = currentTree.title;
            trackerMetadataChanged = true;
          }
          if (trackerMetadataChanged) {
            await BSE.Tracker.saveSubscriptions(subscriptionsCache);
            renderTrackerList();
            updateTrackerCountsAndBadge();
          }
        }
      }

      elements.batchModalTitle.textContent = currentTree.title;
      elements.batchTypePill.textContent = currentTree.kind === 'youtube_playlist'
        ? '播放列表'
        : (currentTree.kind === 'ugc_season' ? 'UGC合集' : (currentTree.kind === 'multi_page' ? '多P' : '单视频'));
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
    const target = e.target instanceof HTMLInputElement ? e.target : null;
    if (!target) return;
    if (target.classList.contains('batch-tree-cb')) {
      updateTreeSummaryAndScope();
    } else if (target.classList.contains('batch-tree-sec-cb')) {
      const secKey = target.dataset.secKey;
      queryInputs(elements.batchTreeList, `.batch-tree-cb[data-sec-key="${secKey}"]`)
        .forEach(cb => { cb.checked = target.checked; });
      updateTreeSummaryAndScope();
    } else if (target.classList.contains('batch-tree-video-cb')) {
      const bvid = target.dataset.bvid;
      queryInputs(elements.batchTreeList, `.batch-tree-cb[data-bvid="${bvid}"]`)
        .forEach(cb => { cb.checked = target.checked; });
      updateTreeSummaryAndScope();
    }
  });

  // Tree Click Delegation (Row selection, Section folding, Select buttons)
  elements.batchTreeList?.addEventListener('click', (e) => {
    const target = eventTargetElement(e);
    if (!target) return;
    const chevron = closestHtml(e, '.batch-tree-sec-chevron');
    if (chevron) {
      e.stopPropagation();
      const secGroup = chevron.closest('.batch-tree-sec-group');
      secGroup?.classList.toggle('collapsed');
      return;
    }

    const secBtn = closestButton(e, '.batch-tree-sec-btn');
    if (secBtn) {
      e.stopPropagation();
      const secKey = secBtn.dataset.secKey;
      queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => {
        cb.checked = cb.dataset.secKey === secKey;
      });
      updateTreeSummaryAndScope();
      return;
    }

    const videoBtn = closestButton(e, '.batch-tree-video-btn');
    if (videoBtn) {
      e.stopPropagation();
      const bvid = videoBtn.dataset.bvid;
      queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => {
        cb.checked = cb.dataset.bvid === bvid;
      });
      updateTreeSummaryAndScope();
      return;
    }

    const itemNode = closestHtml(e, '.batch-tree-item-node');
    if (itemNode && !target.matches('input[type="checkbox"]')) {
      const cb = /** @type {HTMLInputElement | null} */ (itemNode.querySelector('.batch-tree-cb'));
      if (cb) {
        cb.checked = !cb.checked;
        updateTreeSummaryAndScope();
      }
    }
  });

  // Tree Toolbar Buttons
  elements.batchTreeBtnAll?.addEventListener('click', () => {
    queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => { cb.checked = true; });
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnCur?.addEventListener('click', () => {
    if (!currentTree) return;
    queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => {
      const isCur = cb.dataset.bvid === currentTree.currentBvid;
      cb.checked = isCur;
    });
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnNone?.addEventListener('click', () => {
    queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => { cb.checked = false; });
    updateTreeSummaryAndScope();
  });

  elements.batchTreeBtnInvert?.addEventListener('click', () => {
    queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => {
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
    queryInputs(elements.batchTreeList, '.batch-tree-cb').forEach(cb => {
      const idx = Number(cb.dataset.globalIndex);
      cb.checked = (idx >= min && idx <= max);
    });
    updateTreeSummaryAndScope();
  });

  elements.batchButton?.addEventListener('click', () => openBatchModal());
  elements.batchCloseBtn?.addEventListener('click', () => {
    if (batchControlTask?.running) {
      batchControlTask.cancelled = true;
      batchControlTask.controller?.abort();
    }
    elements.batchOverlay.hidden = true;
  });

  queryInputs(document, 'input[name="batch-output"]').forEach(radio => {
    radio.addEventListener('change', syncBatchOutputControls);
  });
  queryInputs(document, 'input[name="batch-format"]').forEach(radio => {
    radio.addEventListener('change', syncBatchOutputControls);
  });
  syncBatchOutputControls();

  elements.batchStartBtn?.addEventListener('click', async () => {
    if (!currentTree) return;
    const checkedCbs = queryInputs(elements.batchTreeList, '.batch-tree-cb:checked');
    if (!checkedCbs.length) {
      toast('请至少在目录中勾选 1 个分P', true);
      return;
    }

    const customIndices = new Set(checkedCbs.map(cb => Number(cb.dataset.globalIndex)));
    const formatInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-format"]:checked'));
    const timestampInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="batch-timestamp"]:checked'));
    const outputMode = getBatchOutputMode();
    /** @type {'srt' | 'txt' | 'md'} */
    let format = formatInput?.value === 'txt' ? 'txt' : (formatInput?.value === 'srt' ? 'srt' : 'md');
    if (outputMode === 'copy-text') format = 'txt';
    else if (outputMode === 'merged-file' && format === 'srt') format = 'md';
    /** @type {'manual-first' | 'manual-only' | 'ai-first'} */
    const preference = elements.prefSelect?.value === 'manual-only'
      ? 'manual-only'
      : (elements.prefSelect?.value === 'ai-first' ? 'ai-first' : 'manual-first');
    const withTimestamp = timestampInput?.value === 'true';

    /** @type {import('../types/bse').BatchConfig} */
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

    const diagLogger = (stage, msg) => appendDiagnostic(stage, msg, {
      scope: 'batch',
      sessionId: diagnosticSessions.batch
    });
    batchControlTask.diagnostic = diagLogger;

    try {
      const runner = currentTree?.kind === 'youtube_playlist' ? BSE.YouTube?.runBatchExport : BSE.Bilibili?.runBatchExport;
      if (!runner) throw new Error('当前合集/播放列表导出引擎不可用');
      const exportResult = await runner(currentTree, config, (stats, currentItem, phase, task) => {
        if (phase === 'packing') {
          elements.batchProgressText.textContent = `正在打包 ZIP (${stats.packPercent || 0}%)…`;
          elements.batchProgressBarFill.style.width = `${stats.packPercent || 0}%`;
          elements.batchProgressPercent.textContent = `${stats.packPercent || 0}%`;
        } else if (phase === 'building') {
          elements.batchProgressText.textContent = outputMode === 'copy-text'
            ? '正在整理可复制的合并全文…'
            : (outputMode === 'merged-file' ? '正在生成合并长文件…' : '正在整理打包清单…');
        } else if (phase === 'fetching') {
          const percent = Math.round((stats.completed / (stats.total || 1)) * 100);
          elements.batchProgressText.textContent = currentItem ? `正在读取: ${currentItem.title}` : `抓取中 (${stats.completed}/${stats.total})`;
          elements.batchProgressBarFill.style.width = `${percent}%`;
          elements.batchProgressPercent.textContent = `${percent}%`;
        } else if (phase === 'done') {
          const completionVerb = outputMode === 'copy-text'
            ? '已整理为可复制全文'
            : (outputMode === 'merged-file' ? '已合并为长文件' : '已打包为 ZIP');
          const summaryText = stats.failed > 0 || stats.noSub > 0
            ? `任务完成：成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`
            : `任务完成：${stats.success} 项字幕${completionVerb}`;
          elements.batchProgressText.textContent = summaryText;
          elements.batchProgressBarFill.style.width = '100%';
          elements.batchProgressPercent.textContent = '100%';
        }
        elements.batchCntSuccess.textContent = String(stats.success || 0);
        elements.batchCntNosub.textContent = String(stats.noSub || 0);
        elements.batchCntFailed.textContent = String(stats.failed || 0);
      }, batchControlTask);

      if (exportResult?.cancelled) return;
      const finalStats = exportResult?.stats || {};
      if (outputMode === 'copy-text' && !finalStats.success) {
        throw new Error('所选视频没有可复制的字幕，请调整选择范围或字幕偏好');
      }
      await BSE.BatchExport.deliver(exportResult?.output, {
        writeText: (text) => navigator.clipboard.writeText(text),
        downloadText: (text, filename, mime) => BSE.Utils.downloadText(text, filename, mime),
        downloadBlob: (blob, filename) => BSE.Utils.downloadBlob(blob, filename)
      });

      const partial = finalStats.failed > 0 || finalStats.noSub > 0;
      const resultLabel = outputMode === 'copy-text'
        ? `已复制 ${finalStats.success || 0} 项字幕全文`
        : (outputMode === 'merged-file'
            ? `合并长文件已下载${exportResult?.output?.filename ? `：${exportResult.output.filename}` : ''}`
            : 'ZIP 已开始下载');
      toast(partial
        ? `${resultLabel}；无字幕 ${finalStats.noSub || 0}，失败 ${finalStats.failed || 0}`
        : resultLabel);
      setTimeout(() => {
        elements.batchOverlay.hidden = true;
      }, 1800);
    } catch (err) {
      if (err.name !== 'AbortError' && !batchControlTask.cancelled) {
        toast(err.message || '批量导出失败', true);
      }
    } finally {
      if (batchControlTask) batchControlTask.running = false;
      elements.batchStartBtn.hidden = false;
      elements.batchPauseBtn.hidden = true;
      elements.batchCancelBtn.hidden = true;
      syncBatchOutputControls();
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
        if (batchControlTask?.running) {
          batchControlTask.cancelled = true;
          batchControlTask.controller?.abort();
        }
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
  loadTrackerSummary().catch(() => {});
  initializeQueueLanguageControl().catch(() => populateQueueLanguageOptions('auto'));
  loadNativeCapabilities(false).catch(() => {});
  loadAndRenderQueue().catch(() => {});
})();
