(() => {
  'use strict';

  const BSE = globalThis.BSE;
  const uiText = (key, params) => BSE.I18n?.t(key, params) || key;
  /** @type {import('../types/bse').AppState | null} */
  let state = null;
  let stateTabId = null;
  let activeTabId = null;
  let activeIndex = -1;
  let following = true;
  let currentTab = 'timestamp';
  let currentWorkspace = 'subtitle';
  let lastSubtitleTab = 'timestamp';
  let transcriptViewCacheBaseKey = '';
  const transcriptViewCache = new Map();
  let transcriptCacheReleaseTimer = null;

  function cancelTranscriptCacheRelease() {
    if (!transcriptCacheReleaseTimer) return;
    clearTimeout(transcriptCacheReleaseTimer);
    transcriptCacheReleaseTimer = null;
  }

  function scheduleTranscriptCacheRelease() {
    cancelTranscriptCacheRelease();
    transcriptCacheReleaseTimer = setTimeout(() => {
      transcriptCacheReleaseTimer = null;
      if (currentWorkspace === 'subtitle') return;
      transcriptViewCacheBaseKey = '';
      transcriptViewCache.clear();
      renderedMediaKey = null;
      elements.transcript?.querySelectorAll('.cue, .paragraph').forEach((item) => item.remove());
    }, 30 * 1000);
  }
  let activateAiModeByName = null;
  let syncAiWorkspacePresentation = null;
  let syncAiSettingsWorkspacePresentation = null;
  let syncExternalAiPanelState = null;
  let subtitlePolishContext = null;
  let closeSubtitlePolishModal = null;
  let query = '';

  // Batch Export state
  /** @type {import('../types/bse').BatchMediaTree | null} */
  let currentTree = null;
  /** @type {import('../types/bse').BatchControlTask | null} */
  let batchControlTask = null;

  const elements = /** @type {import('../types/bse').SidepanelElements} */ ({
    title: document.querySelector('#video-title'),
    statusDot: document.querySelector('#status-dot'),
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
    tabSubtitle: document.querySelector('#tab-subtitle'),
    tabLearn: document.querySelector('#tab-learn'),
    tabReview: document.querySelector('#tab-review'),
    tabTracker: document.querySelector('#tab-tracker'),
    tabQueue: document.querySelector('#tab-queue'),
    workspaceSubtitleLabel: document.querySelector('#workspace-subtitle-label'),
    workspaceLearnLabel: document.querySelector('#workspace-learn-label'),
    workspaceReviewLabel: document.querySelector('#workspace-review-label'),
    workspaceTrackerLabel: document.querySelector('#workspace-tracker-label'),
    workspaceQueueLabel: document.querySelector('#workspace-queue-label'),
    tabTimestamp: document.querySelector('#tab-timestamp'),
    tabPlain: document.querySelector('#tab-plain'),
    subtitleToolbar: document.querySelector('#subtitle-toolbar'),
    subtitleLocalAsr: document.querySelector('#subtitle-local-asr'),
    subtitlePolish: document.querySelector('#subtitle-polish'),
    subtitlePolishLabel: document.querySelector('#subtitle-polish-label'),
    subtitlePolishModal: document.querySelector('#subtitle-polish-modal'),
    subtitlePolishModalTitle: document.querySelector('#subtitle-polish-modal-title'),
    subtitlePolishModalDesc: document.querySelector('#subtitle-polish-modal-desc'),
    subtitlePolishCopyTask: document.querySelector('#subtitle-polish-copy-task'),
    subtitlePolishAnchorHint: document.querySelector('#subtitle-polish-anchor-hint'),
    subtitlePolishTextarea: document.querySelector('#subtitle-polish-textarea'),
    subtitlePolishStatus: document.querySelector('#subtitle-polish-status'),
    subtitlePolishClose: document.querySelector('#subtitle-polish-close'),
    subtitlePolishCancel: document.querySelector('#subtitle-polish-cancel'),
    subtitlePolishApply: document.querySelector('#subtitle-polish-apply'),
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
    transcript: document.querySelector('#transcript'),
    aiSection: document.querySelector('#ai-section'),
    aiTitle: document.querySelector('#ai-title'),
    aiWorkspaceDesc: document.querySelector('#ai-workspace-desc'),
    aiLearnModeShell: document.querySelector('#ai-learn-mode-shell'),
    aiReviewModeShell: document.querySelector('#ai-review-mode-shell'),
    aiReviewProtocol: document.querySelector('#ai-review-protocol'),
    aiReviewStepAnswer: document.querySelector('#ai-review-step-answer'),
    aiReviewStepReveal: document.querySelector('#ai-review-step-reveal'),
    aiReviewStepRevisit: document.querySelector('#ai-review-step-revisit'),
    aiSettingsToggle: document.querySelector('#ai-settings-toggle'),
    aiSettingsDrawer: document.querySelector('#ai-settings-drawer'),
    aiModelBadge: document.querySelector('#ai-model-badge'),
    aiSettingsTitle: document.querySelector('#ai-settings-title'),
    aiSettingsScope: document.querySelector('#ai-settings-scope'),
    aiSharedConnectionLabel: document.querySelector('#ai-shared-connection-label'),
    aiEndpointLabel: document.querySelector('#ai-endpoint-label'),
    aiEndpointHint: document.querySelector('#ai-endpoint-hint'),
    aiApiKeyLabel: document.querySelector('#ai-apikey-label'),
    aiWorkspaceModelLabel: document.querySelector('#ai-workspace-model-label'),
    aiLearnModelField: document.querySelector('#ai-learn-model-field'),
    aiReviewModelField: document.querySelector('#ai-review-model-field'),
    aiLearnModelLabel: document.querySelector('#ai-learn-model-label'),
    aiReviewModelLabel: document.querySelector('#ai-review-model-label'),
    aiLearnModelHint: document.querySelector('#ai-learn-model-hint'),
    aiReviewModelHint: document.querySelector('#ai-review-model-hint'),
    aiLearnCurrentMark: document.querySelector('#ai-learn-current-mark'),
    aiReviewCurrentMark: document.querySelector('#ai-review-current-mark'),
    aiInputEndpoint: document.querySelector('#ai-input-endpoint'),
    aiInputApiKey: document.querySelector('#ai-input-apikey'),
    aiInputLearnModel: document.querySelector('#ai-input-learn-model'),
    aiInputReviewModel: document.querySelector('#ai-input-review-model'),
    aiModelOptions: document.querySelector('#ai-model-options'),
    aiBtnTestConn: document.querySelector('#ai-btn-test-conn'),
    aiBtnSaveSettings: document.querySelector('#ai-btn-save-settings'),
    aiTestStatus: document.querySelector('#ai-test-status'),
    aiStatusDot: document.querySelector('#ai-status-dot'),
    aiModelName: document.querySelector('#ai-model-name'),
    aiBtnGenerate: document.querySelector('#ai-btn-generate'),
    aiBtnGenerateText: document.querySelector('#ai-btn-generate-text'),
    aiBtnSnipFrame: document.querySelector('#ai-btn-snip-frame'),
    aiBtnExternalToggle: document.querySelector('#ai-btn-external-toggle'),
    aiBtnExternalToggleText: document.querySelector('#ai-btn-external-toggle-text'),
    aiBtnCopyNote: document.querySelector('#ai-btn-copy-note'),
    aiBtnExportZip: document.querySelector('#ai-btn-export-zip'),
    aiManualTray: document.querySelector('#ai-manual-tray'),
    aiManualTrayCount: document.querySelector('#ai-manual-tray-count'),
    aiManualTrayList: document.querySelector('#ai-manual-tray-list'),
    btnClearManualTray: document.querySelector('#btn-clear-manual-tray'),
    btnCopyStitchedTray: document.querySelector('#btn-copy-stitched-tray'),
    btnDownloadTrayImages: document.querySelector('#btn-download-tray-images'),
    aiExternalToolbar: document.querySelector('#ai-external-toolbar'),
    aiExternalFlowTitle: document.querySelector('#ai-external-flow-title'),
    aiExternalFlowDesc: document.querySelector('#ai-external-flow-desc'),
    aiExternalFlowBadge: document.querySelector('#ai-external-flow-badge'),
    aiExternalPlanStage: document.querySelector('#ai-external-plan-stage'),
    aiExternalPlanStageLabel: document.querySelector('#ai-external-plan-stage-label'),
    aiExternalResetPlan: document.querySelector('#ai-external-reset-plan'),
    aiExternalResultStage: document.querySelector('#ai-external-result-stage'),
    aiExternalResultStageLabel: document.querySelector('#ai-external-result-stage-label'),
    aiExternalPlanLabel: document.querySelector('#ai-external-plan-label'),
    aiExternalImportPlanLabel: document.querySelector('#ai-external-import-plan-label'),
    aiExternalImportLabel: document.querySelector('#ai-external-import-label'),
    aiExternalSynthLabel: document.querySelector('#ai-external-synth-label'),
    aiBtnCopyPlanPrompt: document.querySelector('#ai-btn-copy-plan-prompt'),
    aiBtnImportPlan: document.querySelector('#ai-btn-import-plan'),
    aiBtnCopySynthPrompt: document.querySelector('#ai-btn-copy-synth-prompt'),
    aiBtnOpenImportModal: document.querySelector('#ai-btn-open-import-modal'),
    aiImportModal: document.querySelector('#ai-import-modal'),
    aiImportModalTitle: document.querySelector('#ai-import-modal-title'),
    aiImportModalDesc: document.querySelector('#ai-import-modal-desc'),
    aiBtnCloseImportModal: document.querySelector('#ai-btn-close-import-modal'),
    aiBtnCancelImport: document.querySelector('#ai-btn-cancel-import'),
    aiBtnConfirmImport: document.querySelector('#ai-btn-confirm-import'),
    aiImportTextarea: document.querySelector('#ai-import-textarea'),
    aiProgressBox: document.querySelector('#ai-progress-box'),
    aiProgressText: document.querySelector('#ai-progress-text'),
    aiNotePlaceholder: document.querySelector('#ai-note-placeholder'),
    aiNotePlaceholderTitle: document.querySelector('#ai-note-placeholder-title'),
    aiNotePlaceholderDesc: document.querySelector('#ai-note-placeholder-desc'),
    aiNoteContent: document.querySelector('#ai-note-content'),
    aiNoteInlineActions: document.querySelector('#ai-note-inline-actions'),
    aiNoteStale: document.querySelector('#ai-note-stale'),
    aiBtnClearArtifact: document.querySelector('#ai-btn-clear-artifact'),
    aiActionToolbar: document.querySelector('#ai-action-toolbar'),
    empty: document.querySelector('#empty-state'),
    emptyMessage: document.querySelector('#empty-message'),
    emptyActions: document.querySelector('#empty-actions'),
    emptyTranscribe: document.querySelector('#empty-transcribe-btn'),
    diagnosticsPanel: document.querySelector('#diagnostics'),
    diagnosticStatusTitle: document.querySelector('#diagnostic-status-title'),
    diagnosticStatusDetail: document.querySelector('#diagnostic-status-detail'),
    diagnosticActivity: document.querySelector('#diagnostic-activity'),
    diagnosticTimeline: document.querySelector('#diagnostic-timeline'),
    diagnosticTechnical: document.querySelector('#diagnostic-technical'),
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
    trackerUnreadBadge: document.querySelector('#tracker-unread-badge'),
    trackerSection: document.querySelector('#tracker-section'),
    trackerQuickBar: document.querySelector('#tracker-quick-bar'),
    trackerQuickAvatar: document.querySelector('#tracker-quick-avatar'),
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
    queueStatusText: document.querySelector('#queue-status-text'),
    queueCountPill: document.querySelector('#queue-count-pill'),
    queueList: document.querySelector('#queue-list'),
    queueEmpty: document.querySelector('#queue-empty'),
    queueEmptyTitle: document.querySelector('#queue-empty-title'),
    queueEmptyDesc: document.querySelector('#queue-empty-desc')
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

  let renderedTechnicalDiagnosticsSignature = '';
  let ingestedMediaDiagnostics = { sessionId: '', count: 0, tailSignature: '' };

  function mediaDiagnosticSignature(event) {
    if (typeof event === 'string') return `legacy:${event}`;
    return String(event?.id || `${event?.timestamp || ''}:${event?.stage || ''}:${event?.message || ''}`);
  }

  function ingestMediaDiagnosticsIncremental(events, sessionId) {
    const list = Array.isArray(events) ? events : [];
    const sameSession = ingestedMediaDiagnostics.sessionId === sessionId;
    const previousCount = ingestedMediaDiagnostics.count;
    const previousTailStillMatches = previousCount === 0
      || mediaDiagnosticSignature(list[previousCount - 1]) === ingestedMediaDiagnostics.tailSignature;
    const canAppendOnly = sameSession && list.length >= previousCount && previousTailStillMatches;
    diagnosticsPresenter.ingestMedia(canAppendOnly ? list.slice(previousCount) : list);
    ingestedMediaDiagnostics = {
      sessionId,
      count: list.length,
      tailSignature: list.length ? mediaDiagnosticSignature(list[list.length - 1]) : ''
    };
  }

  function renderDiagnostics() {
    const status = diagnosticsPresenter.summarizeState(state || {});
    const events = diagnosticsPresenter.activityEvents(state || {});
    const technicalOpen = Boolean(elements.diagnosticTechnical?.open);
    const technicalCount = diagnosticsPresenter.technicalCount
      ? diagnosticsPresenter.technicalCount()
      : diagnosticsPresenter.technicalEvents().length;
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
    if (elements.diagnosticTechnicalCount) elements.diagnosticTechnicalCount.textContent = `· ${technicalCount}`;
    if (elements.diagnostics && technicalOpen) {
      const technicalEvents = diagnosticsPresenter.technicalEvents();
      const lastEvent = technicalEvents[technicalEvents.length - 1];
      const signature = `${technicalEvents.length}:${lastEvent?.id || ''}`;
      if (signature !== renderedTechnicalDiagnosticsSignature) {
        elements.diagnostics.textContent = technicalEvents.length
          ? technicalEvents.map((event) => BSE.Diagnostics.formatEvent(event)).join('\n')
          : (BSE.I18n?.t('no_error') || '暂无诊断信息');
        renderedTechnicalDiagnosticsSignature = signature;
      }
    }
  }

  function appendDiagnostic(stage, msg, options = {}) {
    const scope = options.scope || inferDiagnosticScope(stage);
    const appended = diagnosticsPresenter.append({
      id: options.id,
      timestamp: options.timestamp,
      scope,
      sessionId: options.sessionId || diagnosticSessions[scope] || `${scope}:active`,
      level: options.level || BSE.Diagnostics.classifyLegacy(stage, msg),
      code: options.code,
      stage,
      message: msg,
      context: options.context
    });
    if (appended) renderDiagnostics();
    return appended;
  }

  async function command(commandName, payload = {}) {
    return await chrome.runtime.sendMessage({
      type: 'BSE_COMMAND_ACTIVE_TAB',
      command: commandName,
      payload
    });
  }

  async function withButtonBusy(button, task) {
    if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return;
    const wasDisabled = button.disabled;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('busy');
    try {
      return await task();
    } finally {
      button.classList.remove('busy');
      button.setAttribute('aria-busy', 'false');
      button.disabled = wasDisabled;
    }
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

  function syncSubtitleActionAvailability(cues = state?.cues || []) {
    const hasCues = Array.isArray(cues) && cues.length > 0;
    if (elements.copy) elements.copy.disabled = !hasCues;
    if (elements.subtitlePolish) elements.subtitlePolish.disabled = !hasCues;
    const format = elements.format?.value || 'txt';
    const canExportAudio = format === 'audio'
      && state?.platform === 'bilibili'
      && Boolean(state?.mediaKey);
    if (elements.download) elements.download.disabled = format === 'audio' ? !canExportAudio : !hasCues;
    const hasSearchMatches = query.trim().length > 0 && searchMatches.length > 0;
    if (elements.searchPrev) elements.searchPrev.disabled = !hasSearchMatches;
    if (elements.searchNext) elements.searchNext.disabled = !hasSearchMatches;
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

  function syncWorkspaceChrome() {
    const workspaceButtons = [
      ['subtitle', elements.tabSubtitle],
      ['learn', elements.tabLearn],
      ['review', elements.tabReview],
      ['tracker', elements.tabTracker],
      ['queue', elements.tabQueue]
    ];
    workspaceButtons.forEach(([workspace, button]) => {
      if (!button) return;
      const active = workspace === currentWorkspace;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    const subtitleActive = currentWorkspace === 'subtitle';
    const learningActive = currentWorkspace === 'learn' || currentWorkspace === 'review';
    if (elements.subtitleToolbar) elements.subtitleToolbar.hidden = !subtitleActive;
    if (elements.transcript) elements.transcript.hidden = !subtitleActive;
    if (elements.aiSection) elements.aiSection.hidden = !learningActive;
    if (elements.trackerSection) elements.trackerSection.hidden = currentWorkspace !== 'tracker';
    if (elements.queueView) elements.queueView.hidden = currentWorkspace !== 'queue';
  }

  function switchTab(tabId) {
    if (['learn', 'review', 'tracker', 'queue'].includes(tabId)) {
      switchWorkspace(tabId);
      return;
    }
    const subtitleTab = tabId === 'plain' ? 'plain' : 'timestamp';
    currentWorkspace = 'subtitle';
    currentTab = subtitleTab;
    lastSubtitleTab = subtitleTab;
    elements.tabTimestamp?.classList.toggle('active', subtitleTab === 'timestamp');
    elements.tabTimestamp?.setAttribute('aria-selected', String(subtitleTab === 'timestamp'));
    elements.tabPlain?.classList.toggle('active', subtitleTab === 'plain');
    elements.tabPlain?.setAttribute('aria-selected', String(subtitleTab === 'plain'));
    syncWorkspaceChrome();
    renderedMediaKey = null;
    renderTranscript();
  }

  function switchWorkspace(workspace) {
    if (!['subtitle', 'learn', 'review', 'tracker', 'queue'].includes(workspace)) return;
    if (workspace !== currentWorkspace) {
      const leavingAiWorkspace = (currentWorkspace === 'learn' || currentWorkspace === 'review')
        && workspace !== 'learn' && workspace !== 'review';
      const enteringAiWorkspace = workspace === 'learn' || workspace === 'review';
      const leavingQueueWorkspace = currentWorkspace === 'queue' && workspace !== 'queue';
      const leavingTrackerWorkspace = currentWorkspace === 'tracker' && workspace !== 'tracker';
      rememberCurrentAiScrollPosition();
      if (currentWorkspace === 'subtitle' && workspace !== 'subtitle') scheduleTranscriptCacheRelease();
      if (workspace === 'subtitle') cancelTranscriptCacheRelease();
      if (leavingAiWorkspace) {
        cancelAiNoteRestore();
        aiNoteRestoreRevision++;
        scheduleAiWorkingSetRelease();
      }
      if (enteringAiWorkspace) cancelAiWorkingSetRelease();
      if (leavingQueueWorkspace) scheduleQueueWorkingSetRelease();
      if (workspace === 'queue') {
        cancelQueueWorkingSetRelease();
        queueRecoveryWakeSent = false;
      }
      if (leavingTrackerWorkspace) scheduleTrackerWorkingSetRelease();
      if (workspace === 'tracker') cancelTrackerWorkingSetRelease();
    }
    if (elements.settingsDrawer && !elements.settingsDrawer.hidden) {
      elements.settingsDrawer.hidden = true;
      elements.settingsToggle?.classList.remove('active');
      elements.settingsToggle?.setAttribute('aria-expanded', 'false');
    }

    currentWorkspace = workspace;
    if (workspace === 'subtitle') {
      switchTab(lastSubtitleTab);
      return;
    }
    if (workspace === 'tracker') {
      currentTab = 'tracker';
      syncWorkspaceChrome();
      loadAndRenderTracker().catch(() => {});
      return;
    }
    if (workspace === 'queue') {
      currentTab = 'queue';
      syncWorkspaceChrome();
      loadAndRenderQueue().catch(() => {});
      if (nativeCapabilityProbe.snapshot().phase === 'idle') loadNativeCapabilities(false).catch(() => {});
      return;
    }

    currentTab = 'ai';
    syncWorkspaceChrome();
    const targetMode = workspace === 'review' ? lastReviewAiMode : lastLearnAiMode;
    activateAiModeByName?.(targetMode);
    if (aiModeIndicatorsDirty) void refreshAiModeIndicators();
    loadAiConfigToUi({ probe: true }).catch(() => {});
  }

  // === Tracker State & Methods ===
  const TRACKER_VISIBLE_ITEMS = 3;
  const TRACKER_CONTENT_REPAIR_BUDGET = 2;
  const TRACKER_METADATA_REPAIR_BUDGET = 4;
  let trackerContentRepairCount = 0;
  let trackerMetadataRepairCount = 0;
  let trackerFilter = 'all';
  let trackerSearchQuery = '';
  let trackerSort = 'activity';
  let trackerLoading = false;
  let trackerLoadPromise = null;
  let trackerLoadFollowUpRequested = false;
  let trackerSummaryPromise = null;
  let trackerRefreshTimer = null;
  let trackerSearchTimer = null;
  let trackerWorkingSetReleaseTimer = null;
  const trackerRepairAttempts = new Set();
  const expandedTrackerCards = new Set();
  let subscriptionsCache = [];
  let currentAuthorInfo = null;
  let currentAuthorInfoKey = '';
  let currentAuthorInfoLoad = null;

  function cancelTrackerWorkingSetRelease() {
    if (!trackerWorkingSetReleaseTimer) return;
    clearTimeout(trackerWorkingSetReleaseTimer);
    trackerWorkingSetReleaseTimer = null;
  }

  function scheduleTrackerWorkingSetRelease() {
    cancelTrackerWorkingSetRelease();
    trackerWorkingSetReleaseTimer = setTimeout(() => {
      trackerWorkingSetReleaseTimer = null;
      if (currentWorkspace === 'tracker') return;
      subscriptionsCache = [];
      elements.trackerList?.replaceChildren();
    }, 60 * 1000);
  }

  function getCurrentAuthorInfoKey() {
    const author = state?.authorInfo || {};
    return [
      state?.mediaKey || '',
      state?.url || '',
      state?.title || '',
      author.targetId || author.mid || author.channelId || '',
      author.seasonId || '',
      author.name || '',
      author.avatar || '',
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
    return BSE.Tracker?.getUnreadItems?.(sub) || [];
  }

  function getTrackerUnreadCount(sub) {
    return getTrackerUnreadItems(sub).length;
  }

  function loadTrackerSummary() {
    if (!BSE.Tracker) return Promise.resolve();
    if (trackerSummaryPromise) return trackerSummaryPromise;
    trackerSummaryPromise = (BSE.Tracker.getTrackerSummary
      ? BSE.Tracker.getTrackerSummary()
      : BSE.Tracker.getSubscriptions().then((subscriptions) => ({
          total: subscriptions.length,
          unread: subscriptions.reduce((sum, sub) => sum + getTrackerUnreadCount(sub), 0)
        })))
      .then((summary) => updateTrackerCountsAndBadge(summary))
      .catch(() => {})
      .finally(() => { trackerSummaryPromise = null; });
    return trackerSummaryPromise;
  }

  function loadAndRenderTracker() {
    if (!BSE.Tracker) return Promise.resolve();
    if (trackerLoadPromise) {
      if (currentWorkspace === 'tracker') trackerLoadFollowUpRequested = true;
      return trackerLoadPromise;
    }
    trackerLoadPromise = (async () => {
      trackerLoading = true;
      const t = (k, p) => BSE.I18n?.t(k, p) || k;
      if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'true');
      if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = t('tracker_status_loading');
      try {
        const loadedSubscriptions = await BSE.Tracker.getSubscriptions();
        if (currentWorkspace !== 'tracker') {
          updateTrackerCountsAndBadge({
            total: loadedSubscriptions.length,
            unread: loadedSubscriptions.reduce((sum, sub) => sum + getTrackerUnreadCount(sub), 0)
          });
          return;
        }
        subscriptionsCache = loadedSubscriptions;
        renderTrackerList();
        updateTrackerCountsAndBadge();
        await updateQuickSubscribeBar();
        if (currentWorkspace !== 'tracker') return;

        // Empty legacy subscriptions get one repair attempt per side-panel
        // lifetime. Missing Bilibili avatars use a cheaper metadata-only repair
        // path, bounded to a few cards so opening Tracker never fans out into a
        // large refresh storm.
        const activeBvid = BSE.Utils?.getBvid
          ? (BSE.Utils.getBvid(state?.url || '') || (state?.mediaKey ? state.mediaKey.match(/bili:(BV[a-zA-Z0-9]+)/i)?.[1] : ''))
          : '';
        const remainingContentRepairBudget = Math.max(0, TRACKER_CONTENT_REPAIR_BUDGET - trackerContentRepairCount);
        const emptySubs = subscriptionsCache.filter((sub) => (
          (!sub.items || sub.items.length === 0) && !trackerRepairAttempts.has(`items:${sub.id}`)
        )).slice(0, remainingContentRepairBudget);
        if (emptySubs.length > 0) {
          trackerContentRepairCount += emptySubs.length;
          emptySubs.forEach((sub) => trackerRepairAttempts.add(`items:${sub.id}`));
          Promise.allSettled(emptySubs.map((sub) => BSE.Tracker.checkSubscriptionUpdates(sub, { activeBvid })))
            .then(() => scheduleTrackerRefresh(0));
        }

        const remainingMetadataRepairBudget = Math.max(0, TRACKER_METADATA_REPAIR_BUDGET - trackerMetadataRepairCount);
        const avatarRepairSubs = subscriptionsCache.filter((sub) => (
          sub.platform === 'bilibili'
          && !sub.avatar
          && Array.isArray(sub.items)
          && sub.items.length > 0
          && !trackerRepairAttempts.has(`avatar:${sub.id}`)
        )).slice(0, remainingMetadataRepairBudget);
        if (avatarRepairSubs.length > 0 && BSE.Tracker.repairSubscriptionMetadata) {
          trackerMetadataRepairCount += avatarRepairSubs.length;
          avatarRepairSubs.forEach((sub) => trackerRepairAttempts.add(`avatar:${sub.id}`));
          Promise.allSettled(avatarRepairSubs.map((sub) => BSE.Tracker.repairSubscriptionMetadata(sub, { activeBvid })))
            .then((results) => {
              if (results.some((result) => result.status === 'fulfilled' && result.value?.updated)) scheduleTrackerRefresh(0);
            });
        }
      } catch (err) {
        console.warn('[BSE Tracker] 读取订阅列表异常:', err);
        if (elements.trackerStatusLine) elements.trackerStatusLine.textContent = `${t('status_error')}：${err?.message || ''}`;
        toast(t('tracker_toast_load_failed'), true);
      } finally {
        trackerLoading = false;
        if (elements.trackerList) elements.trackerList.setAttribute('aria-busy', 'false');
      }
    })().finally(() => {
      trackerLoadPromise = null;
      if (trackerLoadFollowUpRequested && currentWorkspace === 'tracker') {
        trackerLoadFollowUpRequested = false;
        scheduleTrackerRefresh(0);
      } else {
        trackerLoadFollowUpRequested = false;
      }
    });
    return trackerLoadPromise;
  }

  function scheduleTrackerRefresh(delay = 35) {
    if (currentWorkspace !== 'tracker') {
      loadTrackerSummary().catch(() => {});
      return;
    }
    if (trackerRefreshTimer) clearTimeout(trackerRefreshTimer);
    trackerRefreshTimer = setTimeout(() => {
      trackerRefreshTimer = null;
      loadAndRenderTracker().catch(() => {});
    }, Math.max(0, delay));
  }

  function updateTrackerCountsAndBadge(summary = null) {
    const total = summary ? Math.max(0, Number(summary.total) || 0) : subscriptionsCache.length;
    const unread = summary
      ? Math.max(0, Number(summary.unread) || 0)
      : subscriptionsCache.reduce((sum, s) => sum + getTrackerUnreadCount(s), 0);
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
    if (state.authorInfo && state.authorInfo.name && (state.authorInfo.targetId || state.authorInfo.mid) && state.authorInfo.seasonId && (platform !== 'bilibili' || state.authorInfo.avatar)) {
      return {
        platform,
        type: platform === 'youtube' ? 'channel' : 'up',
        title: state.authorInfo.name,
        upName: state.authorInfo.name,
        mid: state.authorInfo.mid || state.authorInfo.targetId,
        targetId: state.authorInfo.targetId || state.authorInfo.mid,
        bvid: bvid || state.authorInfo.bvid || '',
        avatar: BSE.Utils?.normalizeImageUrl?.(state.authorInfo.avatar) || '',
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
      const avatar = BSE.Utils?.normalizeImageUrl?.(owner.face || state.authorInfo?.avatar || '') || '';

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
        avatar: BSE.Utils?.normalizeImageUrl?.(state.authorInfo?.avatar || '') || '',
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
    if (!elements.trackerQuickBar || currentWorkspace !== 'tracker') return;
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const authorInfo = await getCachedCurrentVideoAuthorInfo();
    if (currentWorkspace !== 'tracker') return;
    currentAuthorInfo = authorInfo;

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
  const queueCardById = new Map();
  let queueWorkingSetReleaseTimer = null;

  function cancelQueueWorkingSetRelease() {
    if (!queueWorkingSetReleaseTimer) return;
    clearTimeout(queueWorkingSetReleaseTimer);
    queueWorkingSetReleaseTimer = null;
  }

  function scheduleQueueWorkingSetRelease() {
    cancelQueueWorkingSetRelease();
    queueWorkingSetReleaseTimer = setTimeout(() => {
      queueWorkingSetReleaseTimer = null;
      if (currentWorkspace === 'queue') return;
      queueCache = [];
      queueCardById.clear();
      elements.queueList?.replaceChildren();
    }, 60 * 1000);
  }
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
    if (!BSE.QueueUI) return;
    const selected = await BSE.QueueUI.loadDefaultLanguage(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET_SETTINGS' }).catch(() => null);
      return response?.ok ? (response.settings || {}) : {};
    });
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
  let queueRecoveryWakeSent = false;

  async function performQueueLoadAndRender({ renderList = currentWorkspace === 'queue' } = {}) {
    try {
      if (!renderList) {
        const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET_SUMMARY' }).catch(() => null);
        const summary = response?.ok && response.summary
          ? response.summary
          : (() => {
              const pending = queueCache.filter((item) => !['done', 'failed'].includes(item.stage)).length;
              return { total: queueCache.length, pending, updatedAt: 0 };
            })();
        updateQueueBadge(summary);
        return;
      }

      const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET', hydrateText: false }).catch(() => null);
      if (!response?.ok || !Array.isArray(response.queue)) throw new Error(response?.error || '转录队列读取失败');
      const loadedQueue = response.queue;
      if (currentWorkspace !== 'queue') {
        updateQueueBadge({
          total: loadedQueue.length,
          pending: loadedQueue.reduce((sum, item) => sum + (!['done', 'failed'].includes(item.stage) ? 1 : 0), 0)
        });
        return;
      }
      queueCache = loadedQueue;
      renderQueueList();
      updateQueueBadge();
      for (const item of queueCache) {
        const event = diagnosticsPresenter.observeQueueItem(item);
        if (event) diagnosticsPresenter.append(event);
      }
      renderDiagnostics();
      const hasPending = queueCache.some((i) => !['done', 'failed'].includes(i.stage));
      if (!hasPending) {
        queueRecoveryWakeSent = false;
      } else if (!queueRecoveryWakeSent && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        // Opening the queue is a recovery seam for work left pending after a
        // previous browser/worker interruption. Wake once per pending epoch;
        // progress updates must not re-wake the executor on every card refresh.
        queueRecoveryWakeSent = true;
        chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {
          queueRecoveryWakeSent = false;
        });
      }
    } catch (err) {
      console.warn('[SparkSub Queue] 读取队列异常:', err);
      appendDiagnostic('转录队列', `读取队列异常: ${err?.message || err}`);
    }
  }

  async function loadAndRenderQueue(options = {}) {
    if (queueLoadPromise) {
      queueLoadFollowUpRequested = true;
      return queueLoadPromise;
    }
    queueLoadPromise = performQueueLoadAndRender(options);
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
      loadAndRenderQueue({ renderList: currentWorkspace === 'queue' }).catch(() => {});
    }, 35);
  }

  async function loadQueueItemDetail(id) {
    const itemId = String(id || '').trim();
    if (!itemId) throw new Error('转录任务不存在或已被移除');
    const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_GET_ITEM', id: itemId }).catch(() => null);
    if (!response?.ok || !response.item) throw new Error(response?.error || '转录任务不存在或已被移除');
    return response.item;
  }

  function updateQueueBadge(summary = null) {
    const runningCount = summary
      ? Math.max(0, Number(summary.pending) || 0)
      : queueCache.filter((i) => !['done', 'failed'].includes(i.stage)).length;
    const totalCount = summary
      ? Math.max(runningCount, Number(summary.total) || 0)
      : queueCache.length;
    if (elements.queueRunningBadge) {
      if (runningCount > 0) {
        elements.queueRunningBadge.hidden = false;
        elements.queueRunningBadge.textContent = String(runningCount);
      } else {
        elements.queueRunningBadge.hidden = true;
      }
    }
    if (elements.queueCountPill) {
      elements.queueCountPill.textContent = `${totalCount} 项`;
    }
    if (elements.queueStatusText) {
      elements.queueStatusText.textContent = runningCount > 0
        ? `正在处理中 (${runningCount} 项进行中)…`
        : (totalCount > 0 ? '所有转录已完成' : '队列就绪');
    }
  }

  const expandedQueueCards = new Set();

  function queueStageText(item) {
    const labels = {
      queued: '排队中',
      resolving: '解析中',
      fetching_caption: '提取字幕',
      fetching_audio: '探测音频',
      transcribing: '转录中',
      postprocessing: '格式化',
      done: item?.subtitle?.cueCount ? `${item.subtitle.cueCount} 句字幕` : '已就绪',
      failed: '失败'
    };
    return labels[item?.stage] || String(item?.stage || '排队中');
  }

  function queueProgressPercent(item) {
    if (item?.stage === 'done') return 100;
    const value = Number(item?.progress);
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  }

  function applyQueueRuntimeUpdate(update) {
    if (!update?.id) return false;
    if (currentWorkspace !== 'queue') {
      scheduleQueueRefresh();
      return true;
    }
    const index = queueCache.findIndex((item) => String(item.id) === String(update.id));
    if (index < 0) return false;
    const previous = queueCache[index];
    const next = {
      ...previous,
      ...update,
      subtitle: update.subtitle || previous.subtitle
    };
    queueCache[index] = next;
    updateQueueBadge();

    const event = diagnosticsPresenter.observeQueueItem(next);
    if (event) {
      diagnosticsPresenter.append(event);
      renderDiagnostics();
    }

    if (previous.stage !== next.stage || next.stage === 'done' || next.stage === 'failed') {
      scheduleQueueRefresh();
      return true;
    }

    const card = queueCardById.get(String(next.id));
    if (!card?.isConnected) return false;
    const displayHint = next.stageHint || queueStageText(next);
    const progressPercent = queueProgressPercent(next);
    const badge = card.querySelector('.queue-status-badge');
    if (badge) {
      badge.textContent = displayHint;
      badge.title = displayHint;
    }
    const percent = card.querySelector('.queue-card-progress-percent');
    if (percent) percent.textContent = `${progressPercent}%`;
    const fill = /** @type {HTMLElement | null} */ (card.querySelector('.queue-card-progress-fill'));
    if (fill) fill.style.width = `${progressPercent}%`;
    return true;
  }

  function renderQueueList() {
    if (!elements.queueList) return;
    queueCardById.clear();
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
      card.dataset.queueId = String(item.id || '');
      queueCardById.set(String(item.id || ''), card);

      const stageText = queueStageText(item);
      const progressPercent = queueProgressPercent(item);
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
        ${item.stage === 'done' && Number(item.subtitle?.cueCount || 0) > 0 ? `
          <div class="queue-preview-drawer ${isExpanded ? 'open' : ''}">
            <div class="queue-preview-toolbar">
              <span class="queue-preview-stats">共 ${item.subtitle.cueCount || 0} 行字幕 · ${item.subtitle.langDoc || item.subtitle.language || '中文'}</span>
              <button type="button" class="queue-preview-copy-btn btn-quick-copy" title="复制预览内容">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"/></svg>
                <span>复制全文</span>
              </button>
            </div>
            <div class="queue-preview-body" data-loaded="false"></div>
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
          if (tab?.id == null) throw new Error('当前标签页不可用');
          const tabState = await chrome.tabs.sendMessage(tab.id, { type: 'BSE_GET_STATE' });
          if (!BSE.Utils?.mediaStateMatchesUrl?.(tabState, item.url)) {
            throw new Error('当前标签页不是这条转录任务对应的视频，已阻止载入');
          }

          const detail = await loadQueueItemDetail(item.id);
          const cues = detail.subtitle?.cues;
          if (!Array.isArray(cues) || !cues.length) throw new Error('该任务无字幕数据');
          const itemMediaKey = String(detail.mediaContext?.mediaKey || detail.expectedMediaKey || '').trim();
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
            mediaContext: detail.mediaContext || null,
            track: {
              id: `transcribed-${detail.id}`,
              name: `端侧本地转录 (${detail.subtitle?.cueCount || cues.length} 句)`,
              language: detail.subtitle?.language || 'zh',
              langDoc: detail.subtitle?.langDoc || '本地端侧转录',
              isAi: true,
              source: 'native',
              engine: detail.subtitle?.engine || 'local-asr'
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
        } catch (err) {
          toast(`载入失败：${err.message}`, true);
        }
      });

      card.querySelector('.btn-preview')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const drawer = card.querySelector('.queue-preview-drawer');
        const previewBody = /** @type {HTMLElement | null} */ (card.querySelector('.queue-preview-body'));
        const btn = card.querySelector('.btn-preview');
        if (expandedQueueCards.has(item.id)) {
          expandedQueueCards.delete(item.id);
          drawer?.classList.remove('open');
          btn?.classList.remove('active');
          return;
        }

        expandedQueueCards.add(item.id);
        drawer?.classList.add('open');
        btn?.classList.add('active');
        try {
          const detail = await loadQueueItemDetail(item.id);
          const text = detail.subtitle?.plainText
            || (Array.isArray(detail.subtitle?.cues) ? BSE.Formatters?.toTxt(detail.subtitle.cues, false) : '')
            || '';
          if (!text) throw new Error('暂无可预览的字幕内容');
          if (previewBody) {
            previewBody.textContent = text;
            previewBody.dataset.loaded = 'true';
          }
        } catch (error) {
          expandedQueueCards.delete(item.id);
          drawer?.classList.remove('open');
          btn?.classList.remove('active');
          toast(`预览失败：${error?.message || '字幕读取失败'}`, true);
        }
      });

      card.querySelector('.btn-quick-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const detail = await loadQueueItemDetail(item.id);
          const text = detail.subtitle?.markdown || detail.subtitle?.plainText || '';
          if (!text) throw new Error('暂无可复制的字幕内容');
          await navigator.clipboard.writeText(text);
          toast(`已复制《${detail.title || '当前视频'}》字幕全文`);
        } catch (error) {
          toast(error?.message === '暂无可复制的字幕内容' ? error.message : '复制失败，请重试', true);
        }
      });

      card.querySelector('.btn-copy')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const detail = await loadQueueItemDetail(item.id);
          const md = detail.subtitle?.markdown || detail.subtitle?.plainText || '';
          if (!md) throw new Error('暂无可复制的字幕内容');
          await navigator.clipboard.writeText(md);
          toast(`已复制《${detail.title || '当前视频'}》Markdown 字幕`);
        } catch (error) {
          toast(error?.message === '暂无可复制的字幕内容' ? error.message : '复制失败，请重试', true);
        }
      });

      card.querySelector('.btn-download-txt')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const detail = await loadQueueItemDetail(item.id);
          const text = detail.subtitle?.plainText || '';
          if (!text) throw new Error('暂无可下载的纯文本字幕');
          const filename = `${detail.title || detail.id || 'transcript'}.txt`;
          BSE.Utils.downloadText(text, filename, 'text/plain;charset=utf-8');
          toast(`已开始下载纯文本字幕：${filename}`);
        } catch (error) {
          toast(error?.message || '字幕读取失败', true);
        }
      });

      card.querySelector('.btn-download-srt')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const detail = await loadQueueItemDetail(item.id);
          const srt = detail.subtitle?.srt || '';
          if (!srt) throw new Error('暂无可下载的 SRT 字幕');
          const filename = `${detail.title || detail.id || 'transcript'}.srt`;
          BSE.Utils.downloadText(srt, filename, 'application/x-subrip;charset=utf-8');
          toast(`已开始下载 SRT 字幕：${filename}`);
        } catch (error) {
          toast(error?.message || '字幕读取失败', true);
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
    // Hidden workspaces must not build or reconcile a long transcript DOM.
    // switchWorkspace('subtitle') renders on demand when the user comes back.
    if (currentWorkspace !== 'subtitle') return;
    const isInactive = state?.status === 'empty' || state?.status === 'error';
    const cues = isInactive ? [] : (state?.cues || []);
    syncSubtitleActionAvailability(cues);
    elements.empty.hidden = cues.length > 0;

    if (!cues.length) {
      renderedMediaKey = null;
      transcriptViewCacheBaseKey = '';
      transcriptViewCache.clear();
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

    // cueRevision changes only when a new subtitle body is committed. Cache the
    // two presentation types for that exact revision so switching Timestamp <->
    // Reading does not rebuild thousands of DOM nodes or re-run paragraph merge.
    const cacheBaseKey = `${state?.mediaKey}:${state?.selectedTrackId}:${state?.cueRevision || 0}:${cues.length}`;
    if (transcriptViewCacheBaseKey !== cacheBaseKey) {
      transcriptViewCacheBaseKey = cacheBaseKey;
      transcriptViewCache.clear();
    }
    const currentKey = `${cacheBaseKey}:${currentTab}`;
    if (renderedMediaKey !== currentKey) {
      renderedMediaKey = currentKey;
      elements.transcript.querySelectorAll('.cue, .paragraph').forEach((item) => item.remove());
      const cachedView = transcriptViewCache.get(currentTab);
      if (cachedView?.nodes?.length) {
        const cachedFragment = document.createDocumentFragment();
        cachedView.nodes.forEach((node) => cachedFragment.appendChild(node));
        elements.transcript.appendChild(cachedFragment);
        applySearch();
        if (following && currentTab === 'timestamp') scrollToActive(true);
        return;
      }

      const fragment = document.createDocumentFragment();
      const viewNodes = [];
      const rowsByIndex = currentTab === 'timestamp' ? [] : null;

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
          viewNodes.push(p);
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
          viewNodes.push(row);
          rowsByIndex[index] = row;
          fragment.appendChild(row);
        });
      }

      transcriptViewCache.set(currentTab, { nodes: viewNodes, rowsByIndex });
      elements.transcript.appendChild(fragment);
      applySearch();
      if (following && currentTab === 'timestamp') scrollToActive(true);
    }
  }

  function stateMatchesTabUrl(candidateState, tabUrl) {
    if (!candidateState) return false;
    if (!tabUrl) return true;
    const mediaKey = String(candidateState.mediaKey || '').trim();
    const hasContent = candidateState.status === 'ready' || Boolean(candidateState.cues?.length);
    if (!mediaKey) return !hasContent;
    return BSE.Utils?.mediaStateMatchesUrl?.(candidateState, tabUrl) === true;
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
    const sameMediaIdentity = Boolean(
      state?.mediaKey
      && nextState?.mediaKey
      && nextState.mediaKey === state.mediaKey
    );
    if (
      sameStateTab
      && sameMediaIdentity
      && state?.status === 'ready'
      && state.cues?.length > 0
      && nextState.status === 'empty'
    ) {
      return;
    }

    const previousArtifactKey = currentAiArtifactKey(state);
    const previousStateTabId = stateTabId;
    const previousCueRevision = Number(state?.cueRevision || 0);
    state = nextState;
    stateTabId = activeTabId;
    const nextArtifactKey = currentAiArtifactKey(state);
    const mediaChanged = previousArtifactKey !== nextArtifactKey;
    const tabChanged = previousStateTabId != null && previousStateTabId !== stateTabId;
    const cuesChanged = !mediaChanged && !tabChanged && previousCueRevision !== Number(state?.cueRevision || 0);
    const subtitlePolishInvalid = Boolean(subtitlePolishContext && (
      mediaChanged
      || tabChanged
      || subtitlePolishContext.mediaKey !== state?.mediaKey
      || subtitlePolishContext.trackId !== String(state?.selectedTrackId || '')
      || subtitlePolishContext.cueRevision !== Number(state?.cueRevision || 0)
    ));
    if (subtitlePolishInvalid) closeSubtitlePolishModal?.();
    if (mediaChanged || tabChanged) {
      resetAiWorkbenchForMediaChange();
    } else {
      if (cuesChanged) {
        cancelActiveAiGeneration('字幕内容已更新');
        aiGenerationRevision++;
        if (currentGeneratedNote?.markdown) syncAiArtifactFreshness();
      }
      const nextCacheAliasSignature = aiArtifactCacheKeys(state).join('|');
      if (nextCacheAliasSignature !== aiCacheAliasSignature) {
        aiCacheAliasSignature = nextCacheAliasSignature;
        markAiModeIndicatorsDirty();
        if (currentWorkspace === 'learn' || currentWorkspace === 'review') {
          void refreshAiModeIndicators();
          if (currentTab === 'ai' && nextArtifactKey && !currentGeneratedNote?.markdown) {
            void restoreNoteFromCache(nextArtifactKey, currentAiMode);
          }
        }
      }
    }
    activeIndex = Number.isInteger(state?.activeIndex) ? state.activeIndex : -1;
    elements.title.textContent = state?.title || BSE.I18n?.t('waiting_video') || '等待视频…';
    elements.statusDot.className = `status-dot ${state?.status || 'idle'}`;
    elements.statusDot.title = state?.message || (BSE.I18n?.t('status_ready') || '准备中…');
    const busy = state?.status === 'loading' || Boolean(state?.isRefreshing);
    elements.refresh.disabled = busy;
    elements.refresh.classList.toggle('busy', busy);
    elements.refresh.setAttribute('aria-busy', String(busy));
    const cues = state?.cues || [];
    if (elements.cueCount) elements.cueCount.textContent = String(cues.length);
    if (elements.duration) elements.duration.textContent = cues.length ? BSE.Utils.formatClock(cues[cues.length - 1].to) : '00:00';
    
    // Diagnostic info rendering
    const fault = state?.lastError;
    const mediaDiagnosticSessionId = state?.diagnosticSessionId || `legacy:${activeTabId || 'tab'}:${state?.mediaKey || 'unknown'}`;
    diagnosticsPresenter.activateMedia({
      tabId: activeTabId,
      sessionId: mediaDiagnosticSessionId,
      mediaKey: state?.mediaKey
    });
    ingestMediaDiagnosticsIncremental(state?.diagnostics || [], mediaDiagnosticSessionId);
    renderDiagnostics();
    if (state?.status === 'error' && elements.diagnosticsPanel) elements.diagnosticsPanel.open = true;
    
    renderTracks();
    renderTranscript();
    if (currentWorkspace === 'tracker') updateQuickSubscribeBar().catch(() => {});
  }

  function updatePlayback(index) {
    if (index === activeIndex) return;
    const previousIndex = activeIndex;
    activeIndex = index;

    // Keep the detached Timestamp view in sync as well. When the user switches
    // back from Reading mode, the already-built rows can be reattached without
    // an O(n) rebuild or a stale active highlight.
    const timestampView = transcriptViewCache.get('timestamp');
    if (timestampView?.rowsByIndex) {
      if (previousIndex >= 0) timestampView.rowsByIndex[previousIndex]?.classList.remove('active');
      if (index >= 0) timestampView.rowsByIndex[index]?.classList.add('active');
    } else {
      elements.transcript.querySelector('.cue.active')?.classList.remove('active');
      const row = index >= 0 ? elements.transcript.querySelector(`.cue[data-index="${index}"]`) : null;
      row?.classList.add('active');
    }
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
    syncSubtitleActionAvailability(state?.cues || []);
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

  async function loadInitialState({ preferLightweight = false } = {}) {
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
        const sameActiveTab = activeTabId === currentTab.id;
        activeTabId = currentTab.id;
        // Focus/visibility recovery should not structured-clone thousands of cues
        // when the content state has not changed. First ask for a tiny revision
        // summary; only request the full state when the owner/version differs.
        if (preferLightweight && sameActiveTab && state && stateMatchesTabUrl(state, currentTab.url || '')) {
          try {
            const meta = await chrome.tabs.sendMessage(currentTab.id, {
              type: 'BSE_GET_STATE_META',
              diagnosticSessionId: ingestedMediaDiagnostics.sessionId,
              diagnosticCount: ingestedMediaDiagnostics.count,
              diagnosticTailId: ingestedMediaDiagnostics.tailSignature
            });
            if (meta?.mediaContext && String(meta.mediaKey || '') === String(state.mediaKey || '')) {
              state.mediaContext = BSE.MediaContext?.create?.(meta.mediaContext) || meta.mediaContext;
            }
            if (Array.isArray(meta?.diagnostics)) {
              state.diagnosticSessionId = meta.diagnosticSessionId || state.diagnosticSessionId || '';
              state.diagnostics = meta.diagnostics;
              ingestMediaDiagnosticsIncremental(meta.diagnostics, meta.diagnosticSessionId || `legacy:${currentTab.id}:${meta.mediaKey || 'unknown'}`);
              renderDiagnostics();
            }
            const unchanged = meta
              && stateMatchesTabUrl(meta, currentTab.url || '')
              && String(meta.mediaKey || '') === String(state.mediaKey || '')
              && Number(meta.revision || 0) === Number(state.revision || 0)
              && Number(meta.cueRevision || 0) === Number(state.cueRevision || 0)
              && String(meta.status || '') === String(state.status || '')
              && String(meta.selectedTrackId || '') === String(state.selectedTrackId || '');
            if (unchanged) return;
          } catch {}
        }
        // Initial hydration or a changed revision still uses the authoritative
        // full state so every downstream consumer receives the same cue array.
        try {
          const directState = await chrome.tabs.sendMessage(currentTab.id, { type: 'BSE_GET_STATE' });
          if (directState && stateMatchesTabUrl(directState, currentTab.url || '')) {
            renderState(directState);
            return;
          }
        } catch {}
      }

      // 2. Query service worker state
      const result = await chrome.runtime.sendMessage({ type: 'BSE_GET_ACTIVE_STATE' });
      if (result?.tab?.id) activeTabId = result.tab.id;
      const activeUrl = currentTab?.url || result?.tab?.url || '';
      if (result?.state && stateMatchesTabUrl(result.state, activeUrl)) {
        renderState(result.state);
      } else {
        const isBili = /bilibili\.com/i.test(activeUrl);
        const isYt = /youtube\.com|youtu\.be/i.test(activeUrl);
        renderState({
          status: 'empty',
          platform: isBili ? 'bilibili' : (isYt ? 'youtube' : 'unknown'),
          mediaKey: null,
          url: activeUrl,
          message: BSE.I18n?.t('no_subtitles') || '当前页面未检测到视频字幕',
          cues: [],
          tracks: [],
          title: currentTab?.title || result?.tab?.title || ''
        });
      }
    } catch {
      // Ignore
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
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
    } else if (message?.type === 'BSE_MEDIA_CONTEXT_BROADCAST' && (!activeTabId || message.tabId === activeTabId)) {
      if (state && message.mediaKey && String(state.mediaKey || '') === String(message.mediaKey) && message.mediaContext) {
        state.mediaContext = BSE.MediaContext?.create?.(message.mediaContext) || message.mediaContext;
      }
    } else if (message?.type === 'BSE_PLAYBACK_BROADCAST' && (!activeTabId || message.tabId === activeTabId)) {
      updatePlayback(message.activeIndex);
    } else if (message?.type === 'BSE_QUEUE_UPDATED') {
      if (!applyQueueRuntimeUpdate(message.item)) scheduleQueueRefresh();
    } else if (message?.type === 'BSE_DIAGNOSTIC_APPEND') {
      const sourceTabId = message.tabId ?? sender?.tab?.id ?? null;
      const eventMediaKey = String(message.context?.mediaKey || '').trim();
      if (message.scope === 'media' && activeTabId != null && sourceTabId != null && sourceTabId !== activeTabId) return;
      if (message.scope === 'media' && eventMediaKey && state?.mediaKey && eventMediaKey !== String(state.mediaKey)) return;
      if (message.scope === 'media' && state) {
        const sessionId = String(message.sessionId || state.diagnosticSessionId || '');
        if (sessionId && String(state.diagnosticSessionId || '') !== sessionId) {
          state.diagnosticSessionId = sessionId;
          state.diagnostics = [];
        }
        if (!Array.isArray(state.diagnostics)) state.diagnostics = [];
        const eventId = String(message.id || '');
        if (!eventId || !state.diagnostics.some((event) => String(event?.id || '') === eventId)) {
          state.diagnostics.push({
            id: message.id,
            timestamp: message.timestamp,
            scope: message.scope,
            sessionId: message.sessionId,
            level: message.level,
            code: message.code,
            stage: message.stage,
            message: message.message,
            context: message.context
          });
          if (state.diagnostics.length > 100) state.diagnostics.splice(0, state.diagnostics.length - 100);
        }
        ingestedMediaDiagnostics = {
          sessionId: String(state.diagnosticSessionId || sessionId),
          count: state.diagnostics.length,
          tailSignature: state.diagnostics.length ? mediaDiagnosticSignature(state.diagnostics[state.diagnostics.length - 1]) : ''
        };
      }
      appendDiagnostic(message.stage || '端侧大模型', message.message || '', {
        id: message.id,
        timestamp: message.timestamp,
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
        if (changes && (changes['bse_tracker_summary_v1'] || changes['bse_subscriptions'])) {
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
    loadInitialState({ preferLightweight: true });
    if (currentWorkspace === 'tracker') scheduleTrackerRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadInitialState({ preferLightweight: true });
      if (currentWorkspace === 'tracker') scheduleTrackerRefresh();
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
    if (elements.workspaceSubtitleLabel) elements.workspaceSubtitleLabel.textContent = t('workspace_subtitle');
    if (elements.subtitlePolish) elements.subtitlePolish.title = t('subtitle_polish_action_title');
    if (elements.subtitlePolishLabel) elements.subtitlePolishLabel.textContent = t('subtitle_polish');
    if (elements.subtitlePolishModalTitle) elements.subtitlePolishModalTitle.textContent = t('subtitle_polish_title');
    if (elements.subtitlePolishCopyTask) elements.subtitlePolishCopyTask.textContent = t('subtitle_polish_copy_task');
    if (elements.subtitlePolishAnchorHint) elements.subtitlePolishAnchorHint.textContent = t('subtitle_polish_anchor_hint');
    if (elements.subtitlePolishTextarea) elements.subtitlePolishTextarea.placeholder = t('subtitle_polish_placeholder');
    if (elements.subtitlePolishCancel) elements.subtitlePolishCancel.textContent = t('subtitle_polish_cancel');
    if (elements.subtitlePolishApply) elements.subtitlePolishApply.textContent = t('subtitle_polish_apply');
    if (elements.workspaceLearnLabel) elements.workspaceLearnLabel.textContent = t('workspace_learn');
    if (elements.workspaceReviewLabel) elements.workspaceReviewLabel.textContent = t('workspace_review');
    if (elements.workspaceTrackerLabel) elements.workspaceTrackerLabel.textContent = t('workspace_tracker');
    if (elements.workspaceQueueLabel) elements.workspaceQueueLabel.textContent = t('workspace_queue');
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
    syncAiWorkspacePresentation?.();

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

    if (currentWorkspace === 'tracker') {
      updateQuickSubscribeBar().catch(() => {});
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
  elements.tabSubtitle?.addEventListener('click', () => switchWorkspace('subtitle'));
  elements.tabLearn?.addEventListener('click', () => switchWorkspace('learn'));
  elements.tabReview?.addEventListener('click', () => switchWorkspace('review'));
  elements.tabTracker?.addEventListener('click', () => switchWorkspace('tracker'));
  elements.tabQueue?.addEventListener('click', () => switchWorkspace('queue'));

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
    if (!BSE.QueueUI) return;
    try {
      const saved = await BSE.QueueUI.saveDefaultLanguage(
        elements.queueSourceLanguage.value,
        async (partial) => {
          const response = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_SAVE_SETTINGS', settings: partial });
          if (!response?.ok) throw new Error(response?.error || '转录设置保存失败');
          return response.settings || partial;
        }
      );
      elements.queueSourceLanguage.value = saved.sourceLanguage || 'auto';
    } catch (error) {
      toast(error?.message || '转录设置保存失败', true);
      initializeQueueLanguageControl().catch(() => {});
    }
  });

  async function enqueueCurrentVideoForLocalASR(triggerButton) {
    return withButtonBusy(triggerButton, async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        const targetUrl = activeTab?.url || '';
        const isCurrentVideoPage = Boolean(activeTab?.id && (targetUrl.includes('bilibili.com') || targetUrl.includes('youtube.com')));
        if (!isCurrentVideoPage) {
          toast('请先切回要转录的 Bilibili / YouTube 视频标签页', true);
          return;
        }

        const latestState = await chrome.tabs.sendMessage(activeTab.id, { type: 'BSE_GET_STATE' }).catch(() => null);
        const latestMatchesTarget = BSE.Utils?.mediaStateMatchesUrl?.(latestState, targetUrl) === true;
        const enqueueMediaKey = latestMatchesTarget ? String(latestState?.mediaKey || '').trim() : '';
        if (!enqueueMediaKey) {
          appendDiagnostic('转录队列', '当前页面媒体身份尚未稳定，已阻止 URL-only 离线转录，避免跨视频/CID 串台。', {
            scope: 'queue',
            level: 'warn',
            code: 'QUEUE_MEDIA_IDENTITY_UNAVAILABLE'
          });
          toast('当前视频身份仍在切换，请等待播放器稳定后再点本机转录', true);
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
        switchWorkspace('queue');
        toast('已加入本机转录队列，SparkScribe 只会处理当前视频的权威音轨');
        await loadAndRenderQueue();
      } catch (err) {
        toast(`发起本机转录失败：${err.message || String(err)}`, true);
      }
    });
  }

  elements.emptyTranscribe?.addEventListener('click', () => enqueueCurrentVideoForLocalASR(elements.emptyTranscribe));
  elements.subtitleLocalAsr?.addEventListener('click', () => enqueueCurrentVideoForLocalASR(elements.subtitleLocalAsr));

  let subtitlePolishPreviewTimer = null;
  closeSubtitlePolishModal = () => {
    if (subtitlePolishPreviewTimer) {
      clearTimeout(subtitlePolishPreviewTimer);
      subtitlePolishPreviewTimer = null;
    }
    if (elements.subtitlePolishModal) elements.subtitlePolishModal.hidden = true;
    subtitlePolishContext = null;
    if (elements.subtitlePolishTextarea) elements.subtitlePolishTextarea.value = '';
    if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = '';
  };
  const openSubtitlePolishModal = () => {
    if (!state?.cues?.length) {
      toast('当前没有可校对的字幕内容', true);
      return;
    }
    try {
      const operationContext = createMediaOperationContext();
      const trackId = String(state.selectedTrackId || '');
      subtitlePolishContext = {
        ...operationContext,
        trackId,
        cueRevision: Number(state.cueRevision || 0),
        taskToken: BSE.Utils?.buildSubtitlePatchToken?.(operationContext.mediaKey, trackId, state.cues, currentCueFingerprint()) || '',
        promptText: ''
      };
      if (elements.subtitlePolishModalDesc) {
        elements.subtitlePolishModalDesc.textContent = uiText('subtitle_polish_desc', { n: state.cues.length });
      }
      if (elements.subtitlePolishTextarea) elements.subtitlePolishTextarea.value = '';
      if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = uiText('subtitle_polish_idle');
      if (elements.subtitlePolishModal) elements.subtitlePolishModal.hidden = false;
      elements.subtitlePolishCopyTask?.focus();
    } catch (error) {
      toast(error?.message || '当前字幕上下文尚未就绪', true);
    }
  };

  elements.subtitlePolish?.addEventListener('click', openSubtitlePolishModal);
  elements.subtitlePolishClose?.addEventListener('click', closeSubtitlePolishModal);
  elements.subtitlePolishCancel?.addEventListener('click', closeSubtitlePolishModal);
  elements.subtitlePolishModal?.addEventListener('click', (event) => {
    if (event.target === elements.subtitlePolishModal) closeSubtitlePolishModal?.();
  });
  elements.subtitlePolishModal?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSubtitlePolishModal?.();
  });
  elements.subtitlePolishTextarea?.addEventListener('input', () => {
    if (subtitlePolishPreviewTimer) clearTimeout(subtitlePolishPreviewTimer);
    subtitlePolishPreviewTimer = setTimeout(() => {
      subtitlePolishPreviewTimer = null;
      if (!subtitlePolishContext || !elements.subtitlePolishStatus) return;
      const rawText = String(elements.subtitlePolishTextarea?.value || '').trim();
      if (!rawText) {
        elements.subtitlePolishStatus.textContent = uiText('subtitle_polish_idle');
        return;
      }
      const preview = BSE.AsrPolisher?.applyPolishResult?.(state?.cues || [], rawText, {
        expectedTaskToken: subtitlePolishContext.taskToken || '',
        materializeCues: false
      });
      if (!preview) return;
      if (preview.mode === 'token_missing') {
        elements.subtitlePolishStatus.textContent = '返回内容缺少本次校对任务标识，无法确认它属于当前字幕。';
      } else if (preview.mode === 'token_mismatch') {
        elements.subtitlePolishStatus.textContent = '任务标识不匹配：这份校对结果来自另一视频、轨道或旧字幕版本。';
      } else if (preview.mode === 'unmatched') {
        elements.subtitlePolishStatus.textContent = '尚未识别到可安全回填的 Lxxxx 行。';
      } else if (preview.mode === 'no_changes') {
        elements.subtitlePolishStatus.textContent = '外部 AI 返回 NO_CHANGES：当前字幕无需修改。';
      } else if (preview.mode === 'positional') {
        elements.subtitlePolishStatus.textContent = `兼容识别到 ${preview.changedCount} 处修改，但没有 Lxxxx 锚点；建议优先使用带行号结果。`;
      } else {
        elements.subtitlePolishStatus.textContent = `已识别 ${preview.changedCount} 处修改；其余字幕将直接复用当前时间轴。`;
      }
    }, 220);
  });

  elements.subtitlePolishCopyTask?.addEventListener('click', () => withButtonBusy(elements.subtitlePolishCopyTask, async () => {
    if (!subtitlePolishContext) return;
    try {
      assertMediaOperationContext(subtitlePolishContext);
      if (String(state.selectedTrackId || '') !== subtitlePolishContext.trackId || Number(state.cueRevision || 0) !== subtitlePolishContext.cueRevision) {
        throw new Error('字幕轨道或内容已经变化，请重新打开校对流程');
      }
      if (!subtitlePolishContext.promptText) {
        await ensureCurrentPromptMediaContext(subtitlePolishContext);
        assertMediaOperationContext(subtitlePolishContext);
        subtitlePolishContext.promptText = BSE.Formatters.generateSubtitlePolishPrompt(state.cues, false, {
          title: state.title,
          mediaContext: state.mediaContext || null,
          mediaKey: subtitlePolishContext.mediaKey,
          trackId: subtitlePolishContext.trackId,
          taskToken: subtitlePolishContext.taskToken || ''
        });
      }
      await navigator.clipboard.writeText(subtitlePolishContext.promptText);
      if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = uiText('subtitle_polish_copied');
      toast(uiText('subtitle_polish_copied'));
    } catch (err) {
      if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = err?.message || String(err);
      toast(`复制校对任务失败：${err?.message || err}`, true);
    }
  }));

  elements.subtitlePolishApply?.addEventListener('click', () => withButtonBusy(elements.subtitlePolishApply, async () => {
    const rawText = String(elements.subtitlePolishTextarea?.value || '').trim();
    if (!rawText) {
      if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = '请先粘贴外部 AI 返回的校对结果。';
      return;
    }
    if (!subtitlePolishContext) return;
    try {
      assertMediaOperationContext(subtitlePolishContext);
      if (String(state.selectedTrackId || '') !== subtitlePolishContext.trackId || Number(state.cueRevision || 0) !== subtitlePolishContext.cueRevision) {
        throw new Error('字幕轨道或内容已经变化，请重新复制任务后再导入');
      }
      const applied = BSE.AsrPolisher?.applyPolishResult?.(state.cues, rawText, {
        expectedTaskToken: subtitlePolishContext.taskToken || '',
        materializeCues: false
      });
      if (!applied) throw new Error('字幕校对解析器未加载');
      if (applied.mode === 'token_missing') {
        if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = '返回内容缺少本次任务标识。请重新复制当前校对任务，再粘贴对应结果。';
        return;
      }
      if (applied.mode === 'token_mismatch') {
        if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = '任务标识不匹配，已阻止把其他视频、轨道或旧字幕的结果套到当前时间轴。';
        return;
      }
      if (applied.mode === 'unmatched') {
        if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = '没有识别到可安全回填的 Lxxxx 行。请让外部 AI 保留行号后重试。';
        return;
      }
      if (applied.changedCount === 0) {
        const message = applied.mode === 'no_changes' ? '外部 AI 判断当前字幕无需修改。' : '导入成功，但没有发现与当前字幕不同的文本。';
        if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = message;
        toast(message);
        return;
      }

      const response = await sendTabMessage({
        type: 'BSE_APPLY_SUBTITLE_PATCHES',
        patches: applied.patches,
        expectedTrackId: subtitlePolishContext.trackId,
        expectedCueRevision: subtitlePolishContext.cueRevision
      }, subtitlePolishContext);
      if (!response?.ok) {
        if (response?.error === 'SUBTITLE_TRACK_CHANGED' || response?.error === 'SUBTITLE_REVISION_CHANGED') {
          throw new Error('字幕在校对期间已经变化，请重新复制任务后再导入');
        }
        throw new Error(response?.error || '校对结果应用失败');
      }
      const changedCount = Number(response.changedCount) || applied.changedCount;
      closeSubtitlePolishModal();
      toast(`已应用字幕校对：修改 ${changedCount} 条，原时间轴保持不变`);
    } catch (err) {
      if (elements.subtitlePolishStatus) elements.subtitlePolishStatus.textContent = err?.message || String(err);
      toast(`应用校对结果失败：${err?.message || err}`, true);
    }
  }));

  elements.queueCapabilityRefresh?.addEventListener('click', () => {
    loadNativeCapabilities(true);
  });

  elements.queueBatchSubmit?.addEventListener('click', () => withButtonBusy(elements.queueBatchSubmit, async () => {
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
      } else {
        toast('添加失败，请检查链接格式', true);
      }
    } catch (err) {
      toast(`添加任务失败：${err?.message || '后台服务不可用'}`, true);
    }
  }));

  elements.queueBtnCopyMerged?.addEventListener('click', () => withButtonBusy(elements.queueBtnCopyMerged, async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_EXPORT_MERGED' });
      if (res?.ok && res.markdown) {
        await navigator.clipboard.writeText(res.markdown);
        toast('已复制全部已完成视频的合并 Markdown');
      } else {
        toast('暂无已完成的转录内容可导出', true);
      }
    } catch (err) {
      toast(`复制失败：${err?.message || '剪贴板不可用'}`, true);
    }
  }));

  elements.queueBtnClearDone?.addEventListener('click', () => withButtonBusy(elements.queueBtnClearDone, async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'BSE_QUEUE_CLEAR_COMPLETED' });
      toast(`已清理 ${res?.count || 0} 项已完成任务`);
      await loadAndRenderQueue();
    } catch (err) {
      toast(`清理失败：${err?.message || '后台服务不可用'}`, true);
    }
  }));

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
    if (trackerSearchTimer) clearTimeout(trackerSearchTimer);
    trackerSearchTimer = setTimeout(() => {
      trackerSearchTimer = null;
      if (currentWorkspace === 'tracker') renderTrackerList();
    }, 100);
  });

  elements.trackerSortSelect?.addEventListener('change', () => {
    trackerSort = elements.trackerSortSelect.value;
    renderTrackerList();
  });

  elements.trackerCheckAllBtn?.addEventListener('click', () => withButtonBusy(elements.trackerCheckAllBtn, async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
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
    }
  }));

  elements.trackerReadAllBtn?.addEventListener('click', () => withButtonBusy(elements.trackerReadAllBtn, async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    try {
      await BSE.Tracker?.markAllAsRead?.();
      await loadAndRenderTracker();
      toast(t('tracker_toast_marked_all_read'));
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err?.message || '后台服务不可用' }), true);
    }
  }));

  elements.trackerCopyAllBtn?.addEventListener('click', () => withButtonBusy(elements.trackerCopyAllBtn, async () => {
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

    try {
      const mergedMd = BSE.Tracker.exportMergedMarkdown(unreadItems);
      await navigator.clipboard.writeText(mergedMd);
      const skipText = skippedWithoutSubtitle ? t('tracker_toast_copy_unread_skip', { n: skippedWithoutSubtitle }) : '';
      toast(`${t('tracker_toast_copy_unread_success', { n: unreadItems.length })}${skipText}`);
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err?.message || '剪贴板不可用' }), true);
    }
  }));

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

  elements.trackerExportBtn?.addEventListener('click', () => withButtonBusy(elements.trackerExportBtn, async () => {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    try {
      const json = await BSE.Tracker?.exportConfigJson?.();
      BSE.Utils.downloadText(json, `SparkSub_Subscriptions_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast(t('tracker_toast_export_success'));
    } catch (err) {
      toast(t('tracker_toast_extract_failed', { error: err.message }), true);
    }
  }));

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

  // === Shared Learn / Review Workbench ===
  const AI_EVIDENCE_FRAME_MAX_WIDTH = 1536;
  const AI_EVIDENCE_FRAME_QUALITY = 0.9;
  let currentAiMode = 'course_notes';
  let lastLearnAiMode = 'course_notes';
  let lastReviewAiMode = 'summary';
  const AI_MODE_CONFIG = Object.freeze({
    course_notes: Object.freeze({
      workspace: 'learn',
      labelKey: 'ai_mode_course_notes',
      kindKey: 'ai_mode_course_notes_kind',
      emptyTitleKey: 'ai_empty_course_notes_title',
      emptyDescKey: 'ai_empty_course_notes_desc',
      generateKey: 'ai_generate_course_notes',
      exportKey: 'ai_export_visual',
      usesVisualEvidence: true
    }),
    keypoints: Object.freeze({
      workspace: 'learn',
      labelKey: 'ai_mode_keypoints',
      kindKey: 'ai_mode_keypoints_kind',
      emptyTitleKey: 'ai_empty_keypoints_title',
      emptyDescKey: 'ai_empty_keypoints_desc',
      generateKey: 'ai_generate_keypoints',
      exportKey: 'ai_export_markdown',
      usesVisualEvidence: false
    }),
    concept_deep: Object.freeze({
      workspace: 'learn',
      labelKey: 'ai_mode_concept_deep',
      kindKey: 'ai_mode_concept_deep_kind',
      emptyTitleKey: 'ai_empty_concept_deep_title',
      emptyDescKey: 'ai_empty_concept_deep_desc',
      generateKey: 'ai_generate_concept_deep',
      exportKey: 'ai_export_markdown',
      usesVisualEvidence: false
    }),
    summary: Object.freeze({
      workspace: 'review',
      labelKey: 'ai_mode_summary',
      kindKey: 'ai_mode_summary_kind',
      emptyTitleKey: 'ai_empty_summary_title',
      emptyDescKey: 'ai_empty_summary_desc',
      generateKey: 'ai_generate_summary',
      exportKey: 'ai_export_markdown',
      usesVisualEvidence: false
    }),
    deep_qa: Object.freeze({
      workspace: 'review',
      labelKey: 'ai_mode_review',
      kindKey: 'ai_mode_review_kind',
      emptyTitleKey: 'ai_empty_review_title',
      emptyDescKey: 'ai_empty_review_desc',
      generateKey: 'ai_generate_review',
      exportKey: 'ai_export_markdown',
      usesVisualEvidence: false
    }),
    error_check: Object.freeze({
      workspace: 'review',
      labelKey: 'ai_mode_error_check',
      kindKey: 'ai_mode_error_check_kind',
      emptyTitleKey: 'ai_empty_error_check_title',
      emptyDescKey: 'ai_empty_error_check_desc',
      generateKey: 'ai_generate_error_check',
      exportKey: 'ai_export_markdown',
      usesVisualEvidence: false
    })
  });
  const aiModeLabel = (mode) => uiText(AI_MODE_CONFIG[mode]?.labelKey || 'ai_mode_course_notes');
  let manualFrames = [];
  let externalVideoPlan = null;
  let externalImageDeliveryMode = 'contact-sheet';
  let externalDeliveredFrames = [];
  /** @type {(() => void) | null} */
  let activeNoteImagePreviewClose = null;
  let aiNoteRestoreRevision = 0;
  let aiNoteRestoreController = null;
  let aiGenerationRevision = 0;
  let aiGenerationController = null;
  let aiCacheAliasSignature = '';
  let aiModeIndicatorsDirty = true;
  let aiModeIndicatorsEpoch = 0;
  let aiModeIndicatorsPromise = null;
  let aiModeIndicatorsPromiseKey = '';
  // Keep only the six artifacts for the current logical video hot in memory.
  // This avoids repeated chrome.storage + IndexedDB Blob->DataURL reads when the
  // user switches between Learn/Review task types, while media changes still
  // release long Markdown, rendered HTML, and screenshots immediately.
  const hotAiArtifacts = new Map();
  const hotAiDomViews = new Map();
  const aiScrollPositions = new Map();
  const HOT_AI_ARTIFACT_LIMIT = 6;
  const HOT_AI_ARTIFACT_BYTE_BUDGET = 24 * 1024 * 1024;
  const HOT_AI_DOM_LIMIT = 3;
  const HOT_AI_DOM_SOURCE_CHAR_BUDGET = 600 * 1024;
  let aiWorkingSetReleaseTimer = null;
  let mountedAiArtifact = null;

  function cancelAiWorkingSetRelease() {
    if (!aiWorkingSetReleaseTimer) return;
    clearTimeout(aiWorkingSetReleaseTimer);
    aiWorkingSetReleaseTimer = null;
  }

  function cancelAiNoteRestore() {
    if (!aiNoteRestoreController) return;
    aiNoteRestoreController.abort();
    aiNoteRestoreController = null;
  }

  function scheduleAiWorkingSetRelease() {
    cancelAiWorkingSetRelease();
    aiWorkingSetReleaseTimer = setTimeout(() => {
      aiWorkingSetReleaseTimer = null;
      if (currentWorkspace === 'learn' || currentWorkspace === 'review') return;
      hotAiArtifacts.clear();
      hotAiDomViews.clear();
      if (currentGeneratedNote) {
        delete currentGeneratedNote.renderedHtml;
        delete currentGeneratedNote.renderedMarkdown;
      }
      mountedAiArtifact = null;
      if (elements.aiNoteContent) {
        elements.aiNoteContent.replaceChildren();
        elements.aiNoteContent.hidden = true;
      }
      // Only discard the heavyweight payload after it has been durably saved.
      // Unsaved manual edits stay resident so background memory cleanup can
      // never become a data-loss mechanism.
      if (currentGeneratedNote?.runtimePersisted && currentGeneratedNote?.markdown) {
        currentGeneratedNote = {
          markdown: '',
          imagesMap: {},
          mode: currentGeneratedNote.mode || currentAiMode,
          title: '',
          mediaKey: currentGeneratedNote.mediaKey || currentAiArtifactKey(),
          sourceUrl: '',
          sourceCueFingerprint: '',
          runtimePersisted: false
        };
        if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = false;
        if (elements.aiNoteInlineActions) elements.aiNoteInlineActions.hidden = true;
        if (elements.aiNoteStale) elements.aiNoteStale.hidden = true;
        if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = true;
        if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = true;
      }
    }, 60 * 1000);
  }

  function hotAiArtifactKey(mediaKey, mode) {
    return `${String(mediaKey || '')}\u0000${String(mode || '')}`;
  }

  function estimateHotAiArtifactBytes(note) {
    if (!note) return 0;
    let chars = String(note.markdown || '').length + String(note.renderedHtml || '').length;
    const seenFrames = new Set();
    for (const frame of Object.values(note.imagesMap || {})) {
      if (!frame || seenFrames.has(frame)) continue;
      seenFrames.add(frame);
      chars += String(frame.dataUrl || '').length;
    }
    return chars * 2;
  }

  function pruneHotAiArtifacts() {
    const totalBytes = () => [...hotAiArtifacts.values()].reduce((sum, note) => sum + estimateHotAiArtifactBytes(note), 0);
    while (hotAiArtifacts.size > HOT_AI_ARTIFACT_LIMIT || totalBytes() > HOT_AI_ARTIFACT_BYTE_BUDGET) {
      const removableKey = [...hotAiArtifacts.entries()]
        .find(([, note]) => note?.runtimePersisted === true)?.[0];
      if (!removableKey) break;
      hotAiArtifacts.delete(removableKey);
    }
  }

  function rememberHotAiArtifact(note) {
    const mediaKey = String(note?.mediaKey || '').trim();
    const mode = String(note?.mode || '').trim();
    if (!mediaKey || !mode || !note?.markdown) return;
    const key = hotAiArtifactKey(mediaKey, mode);
    hotAiArtifacts.delete(key);
    hotAiArtifacts.set(key, note);
    pruneHotAiArtifacts();
  }

  function readHotAiArtifact(mediaKey, mode) {
    const key = hotAiArtifactKey(mediaKey, mode);
    const note = hotAiArtifacts.get(key) || null;
    if (!note) return null;
    hotAiArtifacts.delete(key);
    hotAiArtifacts.set(key, note);
    return note;
  }

  function forgetHotAiArtifact(mediaKey, mode) {
    const key = hotAiArtifactKey(mediaKey, mode);
    hotAiArtifacts.delete(key);
    hotAiDomViews.delete(key);
    aiScrollPositions.delete(key);
  }

  function rememberCurrentAiScrollPosition() {
    if (!elements.aiSection || currentTab !== 'ai') return;
    const mediaKey = String(currentGeneratedNote?.mediaKey || '').trim();
    const mode = String(currentGeneratedNote?.mode || currentAiMode || '').trim();
    if (!mediaKey || !mode || !currentGeneratedNote?.markdown) return;
    aiScrollPositions.set(hotAiArtifactKey(mediaKey, mode), Math.max(0, elements.aiSection.scrollTop || 0));
  }

  function restoreCurrentAiScrollPosition(note = currentGeneratedNote) {
    if (!elements.aiSection || !note?.markdown) return;
    const key = hotAiArtifactKey(note.mediaKey, note.mode);
    const scrollTop = aiScrollPositions.get(key);
    if (!Number.isFinite(scrollTop)) {
      elements.aiSection.scrollTop = 0;
      return;
    }
    requestAnimationFrame(() => {
      if (currentGeneratedNote !== note || currentTab !== 'ai') return;
      elements.aiSection.scrollTop = Math.max(0, scrollTop);
    });
  }

  function rememberHotAiDomView(note, container) {
    if (!note?.markdown || note.mode === 'course_notes' || !container || container.querySelector('img')) return;
    const key = hotAiArtifactKey(note.mediaKey, note.mode);
    hotAiDomViews.delete(key);
    hotAiDomViews.set(key, {
      note,
      sourceChars: String(note.markdown || '').length,
      nodes: [...container.childNodes],
      reviewCardMode: container.classList.contains('review-card-mode'),
      reviewBoundaryMissing: container.classList.contains('review-answer-boundary-missing'),
      reviewWarning: container.dataset.reviewWarning || ''
    });
    // A live detached DOM is already the fastest reusable representation. Do not
    // also retain the equivalent rendered HTML string for the same long note.
    delete note.renderedHtml;
    delete note.renderedMarkdown;
    const totalSourceChars = () => [...hotAiDomViews.values()].reduce((sum, entry) => sum + Math.max(0, Number(entry.sourceChars) || 0), 0);
    while (hotAiDomViews.size > HOT_AI_DOM_LIMIT || totalSourceChars() > HOT_AI_DOM_SOURCE_CHAR_BUDGET) {
      hotAiDomViews.delete(hotAiDomViews.keys().next().value);
    }
  }

  function readHotAiDomView(note) {
    const key = hotAiArtifactKey(note?.mediaKey, note?.mode);
    const entry = hotAiDomViews.get(key) || null;
    if (!entry || entry.note !== note || !entry.nodes?.length) return null;
    hotAiDomViews.delete(key);
    hotAiDomViews.set(key, entry);
    return entry;
  }

  function invalidateCurrentNoteRenderCache() {
    if (!currentGeneratedNote) return;
    delete currentGeneratedNote.renderedHtml;
    delete currentGeneratedNote.renderedMarkdown;
    hotAiDomViews.delete(hotAiArtifactKey(currentGeneratedNote.mediaKey, currentGeneratedNote.mode));
  }

  function cancelActiveAiGeneration(reason = '生成上下文已变化') {
    const controller = aiGenerationController;
    if (!controller) return false;
    aiGenerationController = null;
    try {
      controller.abort(new DOMException(reason, 'AbortError'));
    } catch {
      controller.abort();
    }
    return true;
  }

  let currentGeneratedNote = {
    markdown: '',
    imagesMap: {}, // key: timestamp (number/string), value: { dataUrl, timestamp, timeStr, label }
    mode: 'course_notes',
    title: '',
    mediaKey: '',
    sourceUrl: '',
    sourceCueFingerprint: '',
    runtimePersisted: false
  };
  let cueFingerprintMemo = { key: '', value: '' };

  function currentCueFingerprint(targetState = state) {
    const cues = Array.isArray(targetState?.cues) ? targetState.cues : [];
    if (!cues.length || !BSE.Utils?.subtitleFingerprint) return '';
    if (targetState !== state) return BSE.Utils.subtitleFingerprint(cues);
    const key = `${String(targetState?.mediaKey || '')}:${String(targetState?.selectedTrackId || '')}:${Number(targetState?.cueRevision || 0)}:${cues.length}`;
    if (cueFingerprintMemo.key !== key) {
      cueFingerprintMemo = { key, value: BSE.Utils.subtitleFingerprint(cues) };
    }
    return cueFingerprintMemo.value;
  }

  function syncAiArtifactFreshness() {
    if (!elements.aiNoteStale) return false;
    const sourceFingerprint = String(currentGeneratedNote?.sourceCueFingerprint || '').trim();
    const currentFingerprint = currentCueFingerprint();
    const stale = Boolean(sourceFingerprint && currentFingerprint && sourceFingerprint !== currentFingerprint);
    elements.aiNoteStale.hidden = !stale;
    if (stale) elements.aiNoteStale.textContent = uiText('ai_note_source_stale');
    return stale;
  }

  /** @returns {Error & { code: 'MEDIA_CONTEXT_CHANGED' }} */
  function createMediaContextChangedError(message) {
    return Object.assign(new Error(message), { code: /** @type {const} */ ('MEDIA_CONTEXT_CHANGED') });
  }

  /** @returns {Error & { code: 'SUBTITLE_CONTEXT_CHANGED' }} */
  function createSubtitleContextChangedError(message) {
    return Object.assign(new Error(message), { code: /** @type {const} */ ('SUBTITLE_CONTEXT_CHANGED') });
  }

  function assertSubtitleRevision(expectedCueRevision) {
    if (Number(state?.cueRevision || 0) !== Number(expectedCueRevision || 0)) {
      throw createSubtitleContextChangedError('字幕内容已更新，已停止本次生成；请基于最新校对字幕重新生成');
    }
  }

  function currentAiArtifactKey(targetState = state) {
    const runtimeKey = String(targetState?.mediaKey || '').trim();
    if (targetState?.platform === 'bilibili') {
      const tracks = Array.isArray(targetState?.tracks) ? targetState.tracks : [];
      const selected = tracks.find((track) => String(track.id) === String(targetState?.selectedTrackId)) || tracks[0];
      const page = Math.max(0, Number(selected?.page) || 0);
      const bvid = BSE.Utils?.getBvid?.(targetState?.url || '')
        || runtimeKey.match(/^bili:(BV[a-zA-Z0-9]+):/i)?.[1]
        || '';
      if (bvid && page > 0) return `bili:${bvid}:p${page}`;
    }
    return String(BSE.Utils?.getArtifactKey?.(
      targetState?.platform || null,
      targetState?.url || '',
      runtimeKey
    ) || '').trim();
  }

  function aiArtifactCacheKeys(targetState = state) {
    const keys = [];
    const artifactKey = currentAiArtifactKey(targetState);
    const runtimeKey = String(targetState?.mediaKey || '').trim();
    if (artifactKey) keys.push(artifactKey);
    if (runtimeKey && !keys.includes(runtimeKey)) keys.push(runtimeKey);

    if (targetState?.platform === 'bilibili') {
      const bvid = BSE.Utils?.getBvid?.(targetState?.url || '')
        || runtimeKey.match(/^bili:(BV[a-zA-Z0-9]+):/i)?.[1]
        || '';
      const tracks = Array.isArray(targetState?.tracks) ? targetState.tracks : [];
      const selected = tracks.find((track) => String(track.id) === String(targetState?.selectedTrackId)) || tracks[0];
      if (bvid && selected?.cid != null) {
        const cidKey = `bili:${bvid}:cid${selected.cid}`;
        if (!keys.includes(cidKey)) keys.push(cidKey);
      }
    }
    return keys;
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

  async function ensureCurrentPromptMediaContext(context = null) {
    const operationContext = context || createMediaOperationContext();
    try {
      const response = await sendTabMessage({ type: 'BSE_GET_MEDIA_CONTEXT' }, operationContext);
      if (response?.ok && response?.mediaContext) {
        // sendTabMessage 已经证明响应仍来自启动操作时锁定的 tabId + runtime mediaKey。
        // Bilibili 语境自身可以携带更精确的 cid key，而页面状态仍暂时是 pN key。
        state.mediaContext = BSE.MediaContext.create(response.mediaContext);
      }
    } catch (error) {
      if (error?.code === 'MEDIA_CONTEXT_CHANGED') throw error;
      appendDiagnostic('视频语境', `AI 处理前未能刷新标题/标签语境，继续使用当前已知信息: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
    }
    return state?.mediaContext || null;
  }

  function markAiModeIndicatorsDirty() {
    aiModeIndicatorsDirty = true;
    aiModeIndicatorsEpoch++;
  }

  async function refreshAiModeIndicators() {
    const cacheKeys = aiArtifactCacheKeys();
    const ownerSignature = cacheKeys.join('|');
    const requestEpoch = aiModeIndicatorsEpoch;
    const requestKey = `${requestEpoch}\u0000${ownerSignature}`;
    if (aiModeIndicatorsPromise && aiModeIndicatorsPromiseKey === requestKey) return aiModeIndicatorsPromise;

    const request = (async () => {
      const pills = [...document.querySelectorAll('.ai-mode-pill[data-mode]')];
      if (!cacheKeys.length || !BSE.AiNoteCache?.listModes) {
        if (requestEpoch === aiModeIndicatorsEpoch && ownerSignature === aiArtifactCacheKeys().join('|')) {
          pills.forEach((pill) => pill.classList.remove('has-result'));
          aiModeIndicatorsDirty = false;
        }
        return;
      }
      try {
        const modeLists = BSE.AiNoteCache.listModesMany
          ? Object.values(await BSE.AiNoteCache.listModesMany(cacheKeys))
          : await Promise.all(cacheKeys.map((key) => BSE.AiNoteCache.listModes(key).catch(() => [])));
        if (requestEpoch !== aiModeIndicatorsEpoch || ownerSignature !== aiArtifactCacheKeys().join('|')) return;
        const ready = new Set(modeLists.flat().map((entry) => entry.mode));
        pills.forEach((pill) => {
          const mode = pill.dataset.mode || '';
          pill.classList.toggle('has-result', ready.has(mode));
        });
        aiModeIndicatorsDirty = false;
      } catch {
        if (requestEpoch === aiModeIndicatorsEpoch && ownerSignature === aiArtifactCacheKeys().join('|')) {
          aiModeIndicatorsDirty = true;
        }
      }
    })();
    aiModeIndicatorsPromise = request;
    aiModeIndicatorsPromiseKey = requestKey;
    request.finally(() => {
      if (aiModeIndicatorsPromise === request) {
        aiModeIndicatorsPromise = null;
        aiModeIndicatorsPromiseKey = '';
      }
    });
    return request;
  }

  async function saveCurrentNoteToCache(note = currentGeneratedNote) {
    const noteArtifactKey = String(note?.mediaKey || '').trim();
    const activeArtifactKey = currentAiArtifactKey();
    if (!noteArtifactKey || !note?.markdown) return false;
    if (!activeArtifactKey || activeArtifactKey !== noteArtifactKey) return false;
    try {
      if (!BSE.AiNoteCache?.save) throw new Error('AI Note Cache 模块未加载');
      const saved = await BSE.AiNoteCache.save({
        ...note,
        mediaKey: noteArtifactKey,
        sourceUrl: note.sourceUrl || state?.url || ''
      });
      if (!saved) throw new Error('AI Note Cache 未能持久化当前学习产物');
      note.runtimePersisted = true;
      rememberHotAiArtifact(note);
      markAiModeIndicatorsDirty();
      if (currentWorkspace !== 'learn' && currentWorkspace !== 'review') {
        scheduleAiWorkingSetRelease();
      } else {
        void refreshAiModeIndicators();
      }
      return true;
    } catch (error) {
      appendDiagnostic('AI缓存', `讲义缓存保存失败: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
      return false;
    }
  }

  async function clearCurrentAiArtifact() {
    const artifactKey = currentAiArtifactKey();
    const mode = currentAiMode;
    if (!artifactKey || !BSE.AiNoteCache?.remove) return false;
    if (!window.confirm(uiText('ai_clear_artifact_confirm', { task: aiModeLabel(mode) }))) return false;

    const clearRevision = ++aiNoteRestoreRevision;
    const keys = aiArtifactCacheKeys();
    try {
      await Promise.all(keys.map((key) => BSE.AiNoteCache.remove(key, { mode })));
      keys.forEach((key) => forgetHotAiArtifact(key, mode));
      if (clearRevision !== aiNoteRestoreRevision || currentAiArtifactKey() !== artifactKey || currentAiMode !== mode) return false;
      renderEmptyAiNoteState(artifactKey, mode);
      markAiModeIndicatorsDirty();
      await refreshAiModeIndicators();
      toast(uiText('ai_clear_artifact_done', { task: aiModeLabel(mode) }));
      return true;
    } catch (error) {
      appendDiagnostic('AI缓存', `清空学习产物失败: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
      toast('清空当前产物失败', true);
      return false;
    }
  }

  function mergePlannedFrameContext(frame, request) {
    if (!frame || !request) return frame;
    if (!frame.chapterId && request.chapterId) frame.chapterId = request.chapterId;
    if (!frame.evidenceGoal && request.evidenceGoal) frame.evidenceGoal = request.evidenceGoal;
    if (!frame.expectedSurface && (request.expectedSurface || request.contentHint)) {
      frame.expectedSurface = request.expectedSurface || request.contentHint;
    }
    if (!Number.isFinite(frame.windowStart) && Number.isFinite(request.windowStart)) frame.windowStart = request.windowStart;
    if (!Number.isFinite(frame.windowEnd) && Number.isFinite(request.windowEnd)) frame.windowEnd = request.windowEnd;
    if (!frame.importance && request.importance) frame.importance = request.importance;
    if ((!frame.label || /^重点画面(?:\s*\(|$)/.test(frame.label)) && (request.label || request.evidenceGoal)) {
      frame.label = request.label || request.evidenceGoal;
    }
    return frame;
  }

  function buildPlannedEvidenceFrame(request, capturedFrame, targetTime) {
    const capturedTimestamp = Number(capturedFrame?.timestamp);
    const sec = Number.isFinite(capturedTimestamp) ? capturedTimestamp : targetTime;
    const timeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : `${Math.round(sec)}s`;
    return {
      dataUrl: capturedFrame.dataUrl,
      timestamp: sec,
      timeStr,
      label: request.label || request.reason || request.evidenceGoal,
      reason: request.reason || request.evidenceGoal,
      evidenceGoal: request.evidenceGoal,
      chapterId: request.chapterId,
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
      expectedSurface: request.expectedSurface || request.contentHint,
      importance: request.importance,
      source: 'planned',
      selection: capturedFrame.selection
    };
  }

  /**
   * 阶段一统一媒体执行 Adapter。Side Panel 只负责媒体身份、进度与证据语义；
   * 缓冲、解码确认和瞬态重试全部由页面侧 BSE.Media 负责。
   */
  async function capturePlannedEvidence(requests, seedFrames, mediaContext, options = {}) {
    const frames = Array.isArray(seedFrames) ? [...seedFrames] : [];
    const items = Array.isArray(requests) ? requests : [];
    let capturedCount = 0;
    let reusedCount = 0;
    let failedCount = 0;

    for (let index = 0; index < items.length; index++) {
      if (options.signal?.aborted) throw options.signal.reason || new DOMException('取帧已取消', 'AbortError');
      const request = items[index];
      const targetTime = Number.isFinite(request?.optimalSec) ? request.optimalSec : Number(request?.timestamp);
      const done = index + 1;
      if (!Number.isFinite(targetTime)) {
        failedCount++;
        appendDiagnostic('AI视觉证据', `${options.label || '规划'}取帧跳过：缺少有效时间点`, { scope: 'ai', level: 'warn' });
        options.onProgress?.({ done, total: items.length, capturedCount, reusedCount, failedCount });
        continue;
      }

      const existing = frames.find((frame) => Number.isFinite(Number(frame?.timestamp)) && Math.abs(Number(frame.timestamp) - targetTime) <= 3);
      if (existing) {
        mergePlannedFrameContext(existing, request);
        reusedCount++;
        options.onProgress?.({ done, total: items.length, capturedCount, reusedCount, failedCount });
        continue;
      }

      try {
        const res = await sendTabMessage({
          type: 'BSE_CAPTURE_BEST_FRAME',
          request,
          options: {
            quality: AI_EVIDENCE_FRAME_QUALITY,
            maxWidth: AI_EVIDENCE_FRAME_MAX_WIDTH,
            timeoutMs: 2500
          }
        }, mediaContext);
        if (options.signal?.aborted) throw options.signal.reason || new DOMException('取帧已取消', 'AbortError');
        if (res?.ok && res.frame?.dataUrl) {
          const frameObj = buildPlannedEvidenceFrame(request, res.frame, targetTime);
          frames.push(frameObj);
          capturedCount++;
          const selectionLabel = res.frame.selection?.strategy === 'visual' ? '像素稳定性筛选' : '时间兜底';
          const retryLabel = res.frame.warning === 'RETRIED_AFTER_BUFFERING' ? ' · 缓冲后重试成功' : '';
          appendDiagnostic('AI视觉证据', `${options.label || '规划'}取帧成功 (${done}/${items.length}) · ${frameObj.timeStr} · ${selectionLabel}${retryLabel} · ${frameObj.label || ''}`, { scope: 'ai', level: 'info' });
        } else {
          failedCount++;
          const captureError = res?.error || res?.frame?.error || 'CAPTURE_FAILED';
          const captureMessage = res?.message || res?.frame?.message || '';
          appendDiagnostic('AI视觉证据', `${options.label || '规划'}取帧受限 (${request.timeStr || `${targetTime}s`}): ${captureError}${captureMessage ? ` · ${captureMessage}` : ''}`, { scope: 'ai', level: 'warn' });
        }
      } catch (error) {
        if (options.signal?.aborted || error?.name === 'AbortError' || error?.code === 'MEDIA_CONTEXT_CHANGED') throw error;
        failedCount++;
        appendDiagnostic('AI视觉证据', `${options.label || '规划'}取帧异常 (${request.timeStr || `${targetTime}s`}): ${error?.message || error}`, { scope: 'ai', level: 'warn' });
      }
      options.onProgress?.({ done, total: items.length, capturedCount, reusedCount, failedCount });
    }

    return { frames, capturedCount, reusedCount, failedCount };
  }

  function renderManualTray() {
    // 托盘内容发生变化后，之前复制/下载的图片集合就不再代表当前状态；
    // 下一次复制阶段二提示词应重新绑定当前托盘，而不是沿用陈旧投递快照。
    externalImageDeliveryMode = 'contact-sheet';
    externalDeliveredFrames = [];
    if (!elements.aiManualTray || !elements.aiManualTrayList) return;
    if (!manualFrames.length) {
      elements.aiManualTray.hidden = true;
      elements.aiManualTrayList.replaceChildren();
      if (elements.aiManualTrayCount) elements.aiManualTrayCount.textContent = '0';
      return;
    }

    const fragment = document.createDocumentFragment();
    manualFrames.forEach((frame, idx) => {
      const timeStr = String(frame?.timeStr || BSE.Utils?.formatClock?.(Number(frame?.timestamp) || 0) || '');
      const card = document.createElement('div');
      card.className = 'ai-tray-card';
      card.dataset.index = String(idx);
      card.dataset.seek = String(Number(frame?.timestamp) || 0);
      card.title = `点击跳转至 ${timeStr}；外部 AI 投递请使用“复制精选拼图”或“原图打包”`;

      const image = document.createElement('img');
      image.src = String(frame?.dataUrl || '');
      image.alt = timeStr;
      image.draggable = false;
      image.loading = 'lazy';
      image.decoding = 'async';

      const time = document.createElement('span');
      time.className = 'ai-tray-card-time';
      time.textContent = timeStr;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-delete-tray-card';
      remove.dataset.index = String(idx);
      remove.title = '移除此截图';
      remove.textContent = '×';

      card.append(image, time, remove);
      fragment.appendChild(card);
    });

    elements.aiManualTrayList.replaceChildren(fragment);
    elements.aiManualTray.hidden = false;
    if (elements.aiManualTrayCount) elements.aiManualTrayCount.textContent = String(manualFrames.length);
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

  function renderEmptyAiNoteState(artifactKey = currentAiArtifactKey(), mode = currentAiMode) {
    currentGeneratedNote = {
      markdown: '',
      imagesMap: {},
      mode: Object.hasOwn(AI_MODE_CONFIG, mode) ? mode : 'course_notes',
      title: '',
      mediaKey: artifactKey,
      sourceUrl: state?.url || '',
      sourceCueFingerprint: '',
      runtimePersisted: false
    };
    mountedAiArtifact = null;
    if (elements.aiNoteContent) {
      elements.aiNoteContent.innerHTML = '';
      elements.aiNoteContent.hidden = true;
      elements.aiNoteContent.classList.remove('review-artifact', 'review-answer-boundary-missing', 'review-card-mode');
      delete elements.aiNoteContent.dataset.reviewWarning;
    }
    if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = false;
    if (elements.aiNoteInlineActions) elements.aiNoteInlineActions.hidden = true;
    if (elements.aiNoteStale) elements.aiNoteStale.hidden = true;
    if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = true;
    if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = true;
  }

  function applyReviewRecallProtection(container) {
    if (!container || currentGeneratedNote?.mode !== 'deep_qa') return;
    const root = container.querySelector('.note-rendered-content') || container;
    const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    const headingLevel = (node) => {
      const tag = node instanceof HTMLElement ? node.tagName : '';
      return /^H[1-6]$/.test(tag) ? Number(tag.slice(1)) : 0;
    };
    const answerHeading = headings.find((heading) => /^(?:\d+[.)、]\s*)?(?:参考答案|參考答案|答案(?:与解析|與解析)?|参考解析|參考解析|answers?\b|answer key\b)/i.test((heading.textContent || '').trim()));
    if (!answerHeading || !answerHeading.parentNode) {
      container.classList.add('review-answer-boundary-missing');
      container.dataset.reviewWarning = uiText('ai_review_answer_boundary_missing');
      return;
    }
    delete container.dataset.reviewWarning;

    const parent = answerHeading.parentNode;
    const answerLevel = headingLevel(answerHeading) || 6;
    const questionNumber = (heading) => {
      const match = (heading.textContent || '').trim().match(/^(?:Q|题|題)\s*(\d+)\b/i);
      return match ? Number(match[1]) : null;
    };
    const answerNumber = (heading) => {
      const match = (heading.textContent || '').trim().match(/^(?:A|答)\s*(\d+)\b/i);
      return match ? Number(match[1]) : null;
    };
    const beforeAnswer = headings.filter((heading) => Boolean(heading.compareDocumentPosition(answerHeading) & Node.DOCUMENT_POSITION_FOLLOWING));
    const questionHeadings = beforeAnswer.filter((heading) => questionNumber(heading) != null);
    const answerHeadings = [];
    for (let node = answerHeading.nextElementSibling; node; node = node.nextElementSibling) {
      const level = headingLevel(node);
      if (level > 0 && level <= answerLevel) break;
      if (answerNumber(node) != null) answerHeadings.push(node);
    }
    const answerByNumber = new Map(answerHeadings.map((heading) => [answerNumber(heading), heading]));
    const pairedQuestions = questionHeadings.filter((heading) => answerByNumber.has(questionNumber(heading)));

    if (pairedQuestions.length > 0 && pairedQuestions.length === answerHeadings.length) {
      for (const questionHeading of pairedQuestions) {
        const number = questionNumber(questionHeading);
        const pairedAnswerHeading = answerByNumber.get(number);
        if (!pairedAnswerHeading?.parentNode) continue;

        const answerBodyNodes = [];
        const answerItemLevel = headingLevel(pairedAnswerHeading) || 6;
        let answerNode = pairedAnswerHeading.nextSibling;
        while (answerNode) {
          const next = answerNode.nextSibling;
          const level = headingLevel(answerNode);
          if (level > 0 && level <= answerItemLevel) break;
          answerBodyNodes.push(answerNode);
          answerNode = next;
        }

        const disclosure = document.createElement('details');
        disclosure.className = 'review-flip-card';
        const summary = document.createElement('summary');
        summary.className = 'review-flip-summary';
        summary.dataset.questionNumber = String(number);
        summary.textContent = uiText('ai_review_reveal_one', { n: number });
        const body = document.createElement('div');
        body.className = 'review-flip-body';
        answerBodyNodes.forEach((node) => body.appendChild(node));
        disclosure.append(summary, body);
        pairedAnswerHeading.remove();

        const questionItemLevel = headingLevel(questionHeading) || 6;
        let questionTail = questionHeading;
        while (questionTail.nextSibling) {
          const candidate = questionTail.nextSibling;
          const level = headingLevel(candidate);
          if (level > 0 && level <= questionItemLevel) break;
          questionTail = candidate;
        }
        questionTail.parentNode?.insertBefore(disclosure, questionTail.nextSibling);
      }
      answerHeading.remove();
      container.classList.add('review-card-mode');
      return;
    }

    // External AI may return valid Markdown without the Qn/An pairing contract.
    // In that case preserve recall protection by hiding the whole answer section.
    const disclosure = document.createElement('details');
    disclosure.className = 'review-answer-disclosure';
    const summary = document.createElement('summary');
    summary.className = 'review-answer-summary';
    summary.textContent = uiText('ai_review_reveal_answers');
    const body = document.createElement('div');
    body.className = 'review-answer-body';
    disclosure.append(summary, body);
    parent.insertBefore(disclosure, answerHeading);

    let node = disclosure.nextSibling;
    let movedAnswerHeading = false;
    while (node) {
      const next = node.nextSibling;
      const level = headingLevel(node);
      if (movedAnswerHeading && level > 0 && level <= answerLevel) break;
      body.appendChild(node);
      movedAnswerHeading = true;
      node = next;
    }
  }

  function renderCurrentAiArtifact() {
    const activeArtifactKey = currentAiArtifactKey();
    const artifactKey = String(currentGeneratedNote?.mediaKey || '').trim();
    const aiWorkspaceVisible = currentTab === 'ai'
      && (currentWorkspace === 'learn' || currentWorkspace === 'review')
      && !elements.aiSection?.hidden;
    if (!currentGeneratedNote?.markdown || !activeArtifactKey || artifactKey !== activeArtifactKey) {
      if (aiWorkspaceVisible) renderEmptyAiNoteState(activeArtifactKey, currentAiMode);
      return false;
    }
    if (currentGeneratedNote.mode !== currentAiMode) return false;
    rememberHotAiArtifact(currentGeneratedNote);
    if (!aiWorkspaceVisible) return true;
    const hotDom = elements.aiNoteContent ? readHotAiDomView(currentGeneratedNote) : null;
    const canCacheRenderedHtml = currentGeneratedNote.mode !== 'course_notes';
    let html = '';
    if (!hotDom) {
      html = canCacheRenderedHtml
        && currentGeneratedNote.renderedHtml
        && currentGeneratedNote.renderedMarkdown === currentGeneratedNote.markdown
        ? currentGeneratedNote.renderedHtml
        : (BSE.Formatters?.renderNoteToHtml?.(currentGeneratedNote.markdown, {
            imagesMap: currentGeneratedNote.imagesMap || {}
          }) || currentGeneratedNote.markdown);
      if (canCacheRenderedHtml) {
        currentGeneratedNote.renderedHtml = html;
        currentGeneratedNote.renderedMarkdown = currentGeneratedNote.markdown;
      } else {
        delete currentGeneratedNote.renderedHtml;
        delete currentGeneratedNote.renderedMarkdown;
      }
    }
    if (elements.aiNoteContent) {
      if (hotDom?.nodes?.length) {
        elements.aiNoteContent.replaceChildren(...hotDom.nodes);
      } else {
        elements.aiNoteContent.innerHTML = html;
      }
      elements.aiNoteContent.hidden = false;
      elements.aiNoteContent.classList.toggle('review-artifact', currentGeneratedNote.mode === 'deep_qa');
      elements.aiNoteContent.classList.remove('review-answer-boundary-missing', 'review-card-mode');
      delete elements.aiNoteContent.dataset.reviewWarning;
      if (hotDom) {
        if (hotDom.reviewCardMode) elements.aiNoteContent.classList.add('review-card-mode');
        if (hotDom.reviewBoundaryMissing) elements.aiNoteContent.classList.add('review-answer-boundary-missing');
        if (hotDom.reviewWarning) elements.aiNoteContent.dataset.reviewWarning = hotDom.reviewWarning;
      } else if (currentGeneratedNote.mode === 'deep_qa') {
        applyReviewRecallProtection(elements.aiNoteContent);
      }
      if (!hotDom) rememberHotAiDomView(currentGeneratedNote, elements.aiNoteContent);
      mountedAiArtifact = currentGeneratedNote;
    }
    if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;
    if (elements.aiNoteInlineActions) elements.aiNoteInlineActions.hidden = false;
    syncAiArtifactFreshness();
    if (elements.aiBtnCopyNote) elements.aiBtnCopyNote.disabled = false;
    if (elements.aiBtnExportZip) elements.aiBtnExportZip.disabled = false;
    restoreCurrentAiScrollPosition(currentGeneratedNote);
    return true;
  }

  function resetAiWorkbenchForMediaChange() {
    const artifactKey = currentAiArtifactKey();
    cancelActiveAiGeneration('视频已切换');
    cancelAiNoteRestore();
    aiCacheAliasSignature = aiArtifactCacheKeys().join('|');
    markAiModeIndicatorsDirty();
    hotAiArtifacts.clear();
    hotAiDomViews.clear();
    aiScrollPositions.clear();
    manualFrames = [];
    externalVideoPlan = null;
    externalImageDeliveryMode = 'contact-sheet';
    externalDeliveredFrames = [];
    renderManualTray();
    activeNoteImagePreviewClose?.();
    aiNoteRestoreRevision++;
    aiGenerationRevision++;
    if (elements.aiBtnGenerate) elements.aiBtnGenerate.disabled = false;
    if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
    renderEmptyAiNoteState(artifactKey, currentAiMode);
    if (currentTab === 'ai' && (currentWorkspace === 'learn' || currentWorkspace === 'review')) {
      void refreshAiModeIndicators();
      if (artifactKey) void restoreNoteFromCache(artifactKey, currentAiMode);
    }
  }

  async function restoreNoteFromCache(artifactKey = currentAiArtifactKey(), mode = currentAiMode) {
    cancelAiNoteRestore();
    if (!artifactKey) {
      renderEmptyAiNoteState('', mode);
      return;
    }
    const restoreRevision = ++aiNoteRestoreRevision;
    let restoreController = null;
    try {
      const hot = readHotAiArtifact(artifactKey, mode);
      if (hot?.markdown) {
        if (restoreRevision !== aiNoteRestoreRevision || currentAiArtifactKey() !== artifactKey || currentAiMode !== mode) return;
        currentGeneratedNote = hot;
        currentGeneratedNote.runtimePersisted = true;
        renderCurrentAiArtifact();
        syncAiArtifactFreshness();
        return;
      }
      if (!BSE.AiNoteCache?.load) throw new Error('AI Note Cache 模块未加载');
      restoreController = new AbortController();
      aiNoteRestoreController = restoreController;
      const cacheKeys = aiArtifactCacheKeys();
      let cached = null;
      let loadedKey = '';
      for (const key of cacheKeys) {
        cached = await BSE.AiNoteCache.load(key, mode, { signal: restoreController.signal });
        if (restoreRevision !== aiNoteRestoreRevision || currentAiArtifactKey() !== artifactKey || currentAiMode !== mode) return;
        if (cached?.markdown) {
          loadedKey = key;
          break;
        }
      }
      if (!cached?.markdown) {
        renderEmptyAiNoteState(artifactKey, mode);
        return;
      }

      if (cached.sourceUrl) {
        const sourceArtifactKey = String(BSE.Utils?.getArtifactKey?.(null, cached.sourceUrl, cached.mediaKey) || '').trim();
        if (sourceArtifactKey && sourceArtifactKey !== artifactKey) {
          renderEmptyAiNoteState(artifactKey, mode);
          appendDiagnostic('AI缓存', `拒绝恢复来源不匹配的学习产物: cache=${loadedKey} · source=${sourceArtifactKey} · current=${artifactKey}`, { scope: 'ai', level: 'warn' });
          return;
        }
      }

      // Older builds may have persisted the same Bilibili part under a resolved cid key.
      // Migrate once to the stable BV+p artifact key so future reloads have a single owner.
      if (loadedKey && loadedKey !== artifactKey) {
        const migrated = await BSE.AiNoteCache.save({
          ...cached,
          mediaKey: artifactKey,
          sourceUrl: cached.sourceUrl || state?.url || ''
        }).catch(() => false);
        if (migrated) await BSE.AiNoteCache.remove(loadedKey, { mode }).catch(() => {});
        cached = { ...cached, mediaKey: artifactKey };
      }

      if (restoreRevision !== aiNoteRestoreRevision || currentAiArtifactKey() !== artifactKey || currentAiMode !== mode) return;
      currentGeneratedNote = cached;
      currentGeneratedNote.runtimePersisted = true;
      rememberHotAiArtifact(currentGeneratedNote);
      renderCurrentAiArtifact();
      void refreshAiModeIndicators();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (restoreRevision !== aiNoteRestoreRevision || currentAiArtifactKey() !== artifactKey || currentAiMode !== mode) return;
      renderEmptyAiNoteState(artifactKey, mode);
      appendDiagnostic('AI缓存', `学习产物缓存恢复失败: ${error?.message || error}`, { scope: 'ai', level: 'warn' });
    } finally {
      if (aiNoteRestoreController?.signal && aiNoteRestoreController.signal === restoreController?.signal) {
        aiNoteRestoreController = null;
      }
    }
  }

  /** @returns {Promise<import('../types/bse').AiSettings>} */
  async function getActiveAiSettings(workspace = currentWorkspace) {
    const config = savedAiConfig || await BSE.Ai?.getAiSettings?.() || BSE.Ai?.DEFAULT_CONFIG || {
      endpoint: '',
      apiKey: '',
      model: '',
      timeoutMs: 120000
    };
    return {
      ...config,
      model: BSE.Ai?.resolveAiModel?.(config, workspace) || config.model || ''
    };
  }

  const AI_STATUS_PROBE_TTL_MS = 30 * 1000;
  const AI_STATUS_PROBE_CACHE_LIMIT = 6;
  let aiStatusRevision = 0;
  const aiStatusProbeCache = new Map();
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

  async function loadAiConfigToUi({ probe = false, refresh = false } = {}) {
    const config = (!refresh && savedAiConfig)
      || await BSE.Ai?.getAiSettings?.()
      || BSE.Ai?.DEFAULT_CONFIG
      || {
        endpoint: '',
        apiKey: '',
        model: '',
        timeoutMs: 120000
      };
    const preserveDraft = Boolean(savedAiConfig && elements.aiSettingsDrawer && !elements.aiSettingsDrawer.hidden);
    savedAiConfig = config;
    const learnModel = config.learnModel || config.model || '';
    const reviewModel = config.reviewModel || config.model || '';
    if (!preserveDraft) {
      if (elements.aiInputEndpoint) elements.aiInputEndpoint.value = config.endpoint || '';
      if (elements.aiInputApiKey) elements.aiInputApiKey.value = config.apiKey || '';
      if (elements.aiInputLearnModel) elements.aiInputLearnModel.value = learnModel;
      if (elements.aiInputReviewModel) elements.aiInputReviewModel.value = reviewModel;
    }
    const workspace = currentWorkspace === 'review' ? 'review' : 'learn';
    const activeModel = BSE.Ai?.resolveAiModel?.({ ...config, learnModel, reviewModel }, workspace) || (workspace === 'review' ? reviewModel : learnModel);
    const workspaceLabel = uiText(workspace === 'review' ? 'workspace_review' : 'workspace_learn');
    if (elements.aiModelName) elements.aiModelName.textContent = `${workspaceLabel} · ${activeModel || uiText('ai_settings_model_unconfigured')}`;
    syncAiSettingsWorkspacePresentation?.();
    if (probe) await checkAiStatus(config.endpoint, config.apiKey, activeModel);
  }

  function renderAiProbeStatus(probe, model) {
    renderAiModelOptions(probe?.models || []);
    if (probe?.available) {
      if (elements.aiStatusDot) elements.aiStatusDot.className = 'badge-dot online';
      if (elements.aiTestStatus) {
        elements.aiTestStatus.textContent = probe.modelAvailable === false
          ? `服务在线 · ${probe.protocol || '兼容协议'} · 模型列表中未发现「${model}」，请用“测试当前模型”做实际调用确认`
          : `服务在线 · ${probe.protocol || '兼容协议'} · 当前生成模型：${model || '未配置'}`;
      }
      return;
    }
    if (elements.aiStatusDot) elements.aiStatusDot.className = 'badge-dot offline';
    if (elements.aiTestStatus) elements.aiTestStatus.textContent = `服务探测未通过：${probe?.error || '未响应'}`;
  }

  async function checkAiStatus(endpoint, apiKey, model, { force = false } = {}) {
    if (!elements.aiStatusDot) return null;
    const probeKey = `${String(endpoint || '').replace(/\/+$/, '')}\u0000${String(model || '')}\u0000${String(apiKey || '')}`;
    const now = Date.now();
    const revision = ++aiStatusRevision;
    const cached = aiStatusProbeCache.get(probeKey);
    if (!force && cached && now - cached.at < AI_STATUS_PROBE_TTL_MS) {
      aiStatusProbeCache.delete(probeKey);
      aiStatusProbeCache.set(probeKey, cached);
      renderAiProbeStatus(cached.probe, model);
      return cached.probe;
    }

    elements.aiStatusDot.className = 'badge-dot';
    try {
      const probe = await BSE.Ai?.probeLlm?.(endpoint, apiKey, model) || { available: false, error: '未响应' };
      aiStatusProbeCache.delete(probeKey);
      aiStatusProbeCache.set(probeKey, { probe, at: Date.now() });
      while (aiStatusProbeCache.size > AI_STATUS_PROBE_CACHE_LIMIT) {
        aiStatusProbeCache.delete(aiStatusProbeCache.keys().next().value);
      }
      if (revision !== aiStatusRevision) return probe;
      renderAiProbeStatus(probe, model);
      return probe;
    } catch (err) {
      const probe = { available: false, error: err?.message || String(err) };
      aiStatusProbeCache.delete(probeKey);
      aiStatusProbeCache.set(probeKey, { probe, at: Date.now() });
      if (revision !== aiStatusRevision) return probe;
      renderAiProbeStatus(probe, model);
      return probe;
    }
  }

  function setupAiWorkbench() {
    const aiConfigReady = loadAiConfigToUi({ probe: false });

    // Toggle AI Settings Panel
    const setAiSettingsOpen = (willOpen) => {
      if (!elements.aiSettingsDrawer) return;
      elements.aiSettingsDrawer.hidden = !willOpen;
      elements.aiSettingsToggle?.classList.toggle('active', willOpen);
      elements.aiSettingsToggle?.setAttribute('aria-expanded', String(willOpen));
      elements.aiModelBadge?.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) syncAiSettingsWorkspacePresentation?.();
    };
    const toggleAiSettings = () => setAiSettingsOpen(Boolean(elements.aiSettingsDrawer?.hidden));

    if (elements.aiSettingsToggle) {
      elements.aiSettingsToggle.addEventListener('click', toggleAiSettings);
    }
    if (elements.aiModelBadge) {
      elements.aiModelBadge.addEventListener('click', toggleAiSettings);
    }

    const currentAiSettingsWorkspace = () => currentWorkspace === 'review' ? 'review' : 'learn';
    const readDraftAiConfig = () => ({
      endpoint: elements.aiInputEndpoint?.value.trim() || '',
      apiKey: elements.aiInputApiKey?.value.trim() || '',
      learnModel: elements.aiInputLearnModel?.value.trim() || '',
      reviewModel: elements.aiInputReviewModel?.value.trim() || ''
    });
    const getDraftWorkspaceModel = (draft, workspace = currentAiSettingsWorkspace()) => (
      workspace === 'review' ? draft.reviewModel : draft.learnModel
    );

    const validateDraftAiConfig = (draft, workspace = null) => {
      if (!draft.endpoint) {
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = uiText('ai_settings_need_endpoint');
        elements.aiInputEndpoint?.focus();
        return false;
      }
      const validateModel = (targetWorkspace) => {
        const model = getDraftWorkspaceModel(draft, targetWorkspace);
        if (model) return true;
        if (elements.aiTestStatus) {
          elements.aiTestStatus.textContent = uiText(targetWorkspace === 'review' ? 'ai_settings_need_review_model' : 'ai_settings_need_learn_model');
        }
        (targetWorkspace === 'review' ? elements.aiInputReviewModel : elements.aiInputLearnModel)?.focus();
        return false;
      };
      if (workspace) return validateModel(workspace);
      return validateModel('learn') && validateModel('review');
    };

    const isSavedAiConfig = (draft) => {
      if (!savedAiConfig) return false;
      const savedLearnModel = savedAiConfig.learnModel || savedAiConfig.model || '';
      const savedReviewModel = savedAiConfig.reviewModel || savedAiConfig.model || '';
      return draft.endpoint.replace(/\/+$/, '') === String(savedAiConfig.endpoint || '').replace(/\/+$/, '')
        && draft.apiKey === (savedAiConfig.apiKey || '')
        && draft.learnModel === savedLearnModel
        && draft.reviewModel === savedReviewModel;
    };

    syncAiSettingsWorkspacePresentation = () => {
      const workspace = currentAiSettingsWorkspace();
      elements.aiLearnModelField?.classList.toggle('is-current', workspace === 'learn');
      elements.aiReviewModelField?.classList.toggle('is-current', workspace === 'review');
      if (elements.aiModelName && savedAiConfig) {
        const model = BSE.Ai?.resolveAiModel?.(savedAiConfig, workspace) || uiText('ai_settings_model_unconfigured');
        const workspaceLabel = uiText(workspace === 'review' ? 'workspace_review' : 'workspace_learn');
        elements.aiModelName.textContent = `${workspaceLabel} · ${model}`;
      }
      if (elements.aiSettingsTitle) elements.aiSettingsTitle.textContent = uiText('ai_settings_title');
      if (elements.aiSettingsScope) elements.aiSettingsScope.textContent = uiText('ai_settings_scope');
      if (elements.aiSharedConnectionLabel) elements.aiSharedConnectionLabel.textContent = uiText('ai_settings_shared_connection');
      if (elements.aiEndpointLabel) elements.aiEndpointLabel.textContent = uiText('ai_settings_endpoint_label');
      if (elements.aiEndpointHint) elements.aiEndpointHint.textContent = uiText('ai_settings_endpoint_hint');
      if (elements.aiApiKeyLabel) elements.aiApiKeyLabel.textContent = uiText('ai_settings_apikey_label');
      if (elements.aiWorkspaceModelLabel) elements.aiWorkspaceModelLabel.textContent = uiText('ai_settings_workspace_models');
      if (elements.aiLearnModelLabel) elements.aiLearnModelLabel.textContent = uiText('ai_settings_learn_model');
      if (elements.aiReviewModelLabel) elements.aiReviewModelLabel.textContent = uiText('ai_settings_review_model');
      if (elements.aiLearnModelHint) elements.aiLearnModelHint.textContent = uiText('ai_settings_learn_model_hint');
      if (elements.aiReviewModelHint) elements.aiReviewModelHint.textContent = uiText('ai_settings_review_model_hint');
      if (elements.aiLearnCurrentMark) elements.aiLearnCurrentMark.textContent = uiText('ai_settings_current_workspace');
      if (elements.aiReviewCurrentMark) elements.aiReviewCurrentMark.textContent = uiText('ai_settings_current_workspace');
      if (elements.aiBtnTestConn && !elements.aiBtnTestConn.disabled) elements.aiBtnTestConn.textContent = uiText('ai_settings_test_current');
      if (elements.aiBtnSaveSettings) elements.aiBtnSaveSettings.textContent = uiText('ai_settings_save');
    };

    // Save Settings
    if (elements.aiBtnSaveSettings) {
      elements.aiBtnSaveSettings.addEventListener('click', async () => {
        await aiConfigReady;
        const draft = readDraftAiConfig();
        if (!validateDraftAiConfig(draft)) return;
        elements.aiBtnSaveSettings.disabled = true;
        try {
          if (!BSE.Ai?.saveAiSettings) throw new Error('AI 配置模块未加载');
          const saved = await BSE.Ai.saveAiSettings({
            endpoint: draft.endpoint,
            apiKey: draft.apiKey,
            learnModel: draft.learnModel,
            reviewModel: draft.reviewModel
          });
          savedAiConfig = saved;
          if (elements.aiInputEndpoint) elements.aiInputEndpoint.value = saved.endpoint;
          if (elements.aiInputApiKey) elements.aiInputApiKey.value = saved.apiKey;
          if (elements.aiInputLearnModel) elements.aiInputLearnModel.value = saved.learnModel || saved.model || '';
          if (elements.aiInputReviewModel) elements.aiInputReviewModel.value = saved.reviewModel || saved.model || '';
          syncAiSettingsWorkspacePresentation?.();
          await checkAiStatus(
            saved.endpoint,
            saved.apiKey,
            BSE.Ai?.resolveAiModel?.(saved, currentAiSettingsWorkspace()) || saved.model || '',
            { force: true }
          );
          toast(uiText('ai_settings_saved_toast'));
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
        const workspace = currentAiSettingsWorkspace();
        if (!validateDraftAiConfig(draft, workspace)) return;
        const draftModel = getDraftWorkspaceModel(draft, workspace);
        aiStatusRevision++;
        elements.aiBtnTestConn.disabled = true;
        const originalLabel = elements.aiBtnTestConn.textContent;
        elements.aiBtnTestConn.textContent = uiText('ai_settings_testing');
        if (elements.aiTestStatus) elements.aiTestStatus.textContent = uiText('ai_settings_testing_model', { model: draftModel });
        try {
          if (!BSE.Ai?.testLlm) throw new Error('当前 AI 模块不支持模型实测');
          const result = await BSE.Ai.testLlm(draft.endpoint, draft.apiKey, draftModel);
          if (result?.models?.length) renderAiModelOptions(result.models);
          if (result?.available) {
            const returnedModel = result.returnedModel || result.model || draftModel;
            const modelRoute = returnedModel !== draftModel
              ? `请求 ${draftModel} → 服务返回 ${returnedModel}`
              : `模型 ${draftModel}`;
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
          elements.aiBtnTestConn.textContent = originalLabel || uiText('ai_settings_test_current');
        }
      });
    }

    // Workspace is the source of truth. Each workspace owns intent-level learning tasks.
    const aiModePills = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ai-mode-pill[data-mode]')]);
    let externalPanelOpen = false;
    let externalImportKind = 'result';

    syncExternalAiPanelState = () => {
      const isVisualExternalFlow = currentAiMode === 'course_notes';
      const currentTaskLabel = uiText(AI_MODE_CONFIG[currentAiMode]?.labelKey || 'ai_mode_course_notes');
      if (elements.aiExternalToolbar) elements.aiExternalToolbar.hidden = !externalPanelOpen;
      if (elements.aiBtnExternalToggle) {
        elements.aiBtnExternalToggle.setAttribute('aria-expanded', String(externalPanelOpen));
        elements.aiBtnExternalToggle.classList.toggle('active', externalPanelOpen);
        elements.aiBtnExternalToggle.title = uiText('ai_external_entry_title');
      }
      if (elements.aiBtnExternalToggleText) elements.aiBtnExternalToggleText.textContent = uiText('ai_external_entry');
      if (elements.aiExternalFlowBadge) elements.aiExternalFlowBadge.textContent = uiText('ai_external_badge');
      if (elements.aiExternalFlowTitle) {
        elements.aiExternalFlowTitle.textContent = isVisualExternalFlow
          ? uiText('ai_external_visual_title')
          : uiText('ai_external_text_title', { task: currentTaskLabel });
      }
      if (elements.aiExternalFlowDesc) {
        elements.aiExternalFlowDesc.textContent = isVisualExternalFlow
          ? uiText('ai_external_visual_desc')
          : uiText('ai_external_text_desc');
      }
      const visualPlanReady = Boolean(
        isVisualExternalFlow
        && externalVideoPlan
        && ((externalVideoPlan.chapters?.length || 0) > 0 || (externalVideoPlan.visualRequests?.length || 0) > 0)
      );
      if (elements.aiExternalPlanStage) {
        elements.aiExternalPlanStage.hidden = !isVisualExternalFlow;
        elements.aiExternalPlanStage.classList.toggle('is-complete', visualPlanReady);
      }
      if (elements.aiExternalPlanStageLabel) {
        elements.aiExternalPlanStageLabel.textContent = uiText(visualPlanReady ? 'ai_external_plan_stage_done' : 'ai_external_plan_stage');
      }
      if (elements.aiExternalResetPlan) {
        elements.aiExternalResetPlan.hidden = !visualPlanReady;
        elements.aiExternalResetPlan.textContent = uiText('ai_external_reset_plan');
      }
      if (elements.aiExternalResultStage) elements.aiExternalResultStage.hidden = isVisualExternalFlow && !visualPlanReady;
      if (elements.aiExternalResultStageLabel) {
        elements.aiExternalResultStageLabel.textContent = uiText(isVisualExternalFlow ? 'ai_external_result_stage' : 'ai_external_text_stage');
      }
      if (elements.aiExternalPlanLabel) elements.aiExternalPlanLabel.textContent = uiText('ai_external_plan');
      if (elements.aiExternalImportPlanLabel) elements.aiExternalImportPlanLabel.textContent = uiText('ai_external_import_plan');
      if (elements.aiExternalImportLabel) elements.aiExternalImportLabel.textContent = uiText('ai_external_import_result');
      if (elements.aiExternalSynthLabel) elements.aiExternalSynthLabel.textContent = uiText(isVisualExternalFlow ? 'ai_external_synth' : 'ai_external_full_task');
      if (elements.aiBtnCopyPlanPrompt) elements.aiBtnCopyPlanPrompt.title = uiText('ai_external_plan_title');
      if (elements.aiBtnImportPlan) elements.aiBtnImportPlan.title = uiText('ai_external_import_plan_title');
      if (elements.aiBtnOpenImportModal) elements.aiBtnOpenImportModal.title = uiText('ai_external_import_result_title');
      if (elements.aiBtnCopySynthPrompt) elements.aiBtnCopySynthPrompt.title = uiText(isVisualExternalFlow ? 'ai_external_synth_title' : 'ai_external_full_task_title');
    };

    const copyCurrentTextTaskForExternalAi = async () => {
      if (!state?.cues?.length || currentAiMode === 'course_notes') return false;
      const operationContext = createMediaOperationContext();
      await ensureCurrentPromptMediaContext(operationContext);
      assertMediaOperationContext(operationContext);
      const promptText = BSE.Ai?.buildCourseNotePrompt?.({
        title: state.title,
        cues: state.cues,
        mediaContext: state.mediaContext || null,
        capturedFrames: [],
        mode: currentAiMode
      }) || '';
      if (!promptText) {
        toast('构建外部 AI 任务失败', true);
        return false;
      }
      await navigator.clipboard.writeText(promptText);
      toast(`已复制「${aiModeLabel(currentAiMode)}」完整任务。交给外部 AI 完成后，回到这里导入结果即可`);
      return true;
    };

    if (elements.aiBtnExternalToggle) {
      elements.aiBtnExternalToggle.addEventListener('click', () => {
        externalPanelOpen = !externalPanelOpen;
        syncExternalAiPanelState?.();
      });
    }
    elements.aiExternalResetPlan?.addEventListener('click', () => {
      externalVideoPlan = null;
      manualFrames = manualFrames.filter((frame) => frame?.source !== 'planned');
      externalDeliveredFrames = [];
      externalImageDeliveryMode = 'contact-sheet';
      renderManualTray();
      syncExternalAiPanelState?.();
      toast('已保留手动截图，可以重新规划章节与取帧');
    });

    syncAiWorkspacePresentation = () => {
      const workspace = currentWorkspace === 'review' || currentWorkspace === 'learn'
        ? currentWorkspace
        : (AI_MODE_CONFIG[currentAiMode]?.workspace || 'learn');
      const fallbackMode = workspace === 'review' ? lastReviewAiMode : lastLearnAiMode;
      const config = AI_MODE_CONFIG[currentAiMode]?.workspace === workspace
        ? AI_MODE_CONFIG[currentAiMode]
        : AI_MODE_CONFIG[fallbackMode];
      if (config !== AI_MODE_CONFIG[currentAiMode]) currentAiMode = fallbackMode;

      if (elements.aiSection) {
        elements.aiSection.dataset.workspace = workspace;
        elements.aiSection.dataset.mode = currentAiMode;
      }
      syncAiSettingsWorkspacePresentation?.();
      if (elements.aiTitle) elements.aiTitle.textContent = uiText(workspace === 'review' ? 'ai_review_title' : 'ai_learn_title');
      if (elements.aiWorkspaceDesc) elements.aiWorkspaceDesc.textContent = uiText(workspace === 'review' ? 'ai_review_desc' : 'ai_learn_desc');
      if (elements.aiLearnModeShell) elements.aiLearnModeShell.hidden = workspace !== 'learn';
      if (elements.aiReviewModeShell) elements.aiReviewModeShell.hidden = workspace !== 'review';
      if (elements.aiReviewProtocol) elements.aiReviewProtocol.hidden = !(workspace === 'review' && currentAiMode === 'deep_qa');
      const setReviewStep = (element, index, key) => {
        if (!element) return;
        const number = document.createElement('strong');
        number.textContent = String(index);
        element.replaceChildren(number, ` ${uiText(key)}`);
      };
      setReviewStep(elements.aiReviewStepAnswer, 1, 'ai_review_step_answer');
      setReviewStep(elements.aiReviewStepReveal, 2, 'ai_review_step_reveal');
      setReviewStep(elements.aiReviewStepRevisit, 3, 'ai_review_step_revisit');
      elements.aiReviewProtocol?.setAttribute('aria-label', uiText('ai_review_title'));
      // Updating every self-test disclosure is O(question count). Only touch the
      // long note DOM when the currently mounted artifact is actually deep_qa;
      // other task switches should remain constant-cost UI work.
      if (currentGeneratedNote?.mode === 'deep_qa' && !elements.aiNoteContent?.hidden) {
        elements.aiNoteContent?.querySelectorAll('.review-answer-summary').forEach((summary) => {
          summary.textContent = uiText('ai_review_reveal_answers');
        });
        elements.aiNoteContent?.querySelectorAll('.review-flip-summary').forEach((summary) => {
          summary.textContent = uiText('ai_review_reveal_one', { n: summary.dataset.questionNumber || '' });
        });
        if (elements.aiNoteContent?.classList.contains('review-answer-boundary-missing')) {
          elements.aiNoteContent.dataset.reviewWarning = uiText('ai_review_answer_boundary_missing');
        }
      }

      aiModePills.forEach((pill) => {
        const mode = pill.dataset.mode || '';
        const pillConfig = AI_MODE_CONFIG[mode];
        const selected = pillConfig?.workspace === workspace && mode === currentAiMode;
        pill.classList.toggle('active', selected);
        pill.setAttribute('aria-selected', String(selected));
        pill.tabIndex = selected ? 0 : -1;
        const label = pill.querySelector('.ai-mode-label');
        const kind = pill.querySelector('.ai-mode-kind');
        if (label && pillConfig?.labelKey) label.textContent = uiText(pillConfig.labelKey);
        if (kind && pillConfig?.kindKey) kind.textContent = uiText(pillConfig.kindKey);
      });

      const usesVisualEvidence = config.usesVisualEvidence === true;
      syncExternalAiPanelState?.();
      if (elements.aiBtnSnipFrame) elements.aiBtnSnipFrame.hidden = !usesVisualEvidence;
      if (elements.aiManualTray) elements.aiManualTray.hidden = !usesVisualEvidence || manualFrames.length === 0;

      if (elements.aiNotePlaceholderTitle) elements.aiNotePlaceholderTitle.textContent = uiText(config.emptyTitleKey);
      if (elements.aiNotePlaceholderDesc) elements.aiNotePlaceholderDesc.textContent = uiText(config.emptyDescKey);
      if (elements.aiBtnGenerateText) elements.aiBtnGenerateText.textContent = uiText(config.generateKey);
      const exportLabel = elements.aiBtnExportZip?.querySelector('span');
      if (exportLabel) exportLabel.textContent = uiText(config.exportKey);
      if (elements.aiBtnClearArtifact) {
        elements.aiBtnClearArtifact.textContent = uiText('ai_clear_artifact');
        elements.aiBtnClearArtifact.title = uiText('ai_clear_artifact_title');
      }
      if (elements.aiActionToolbar) {
        elements.aiActionToolbar.hidden = false;
        elements.aiActionToolbar.classList.toggle('text-only', !usesVisualEvidence);
      }
    };

    const activateAiMode = (mode) => {
      const config = AI_MODE_CONFIG[mode];
      if (!config || config.workspace !== currentWorkspace) return;
      if (mode !== currentAiMode) rememberCurrentAiScrollPosition();
      currentAiMode = mode;
      if (config.workspace === 'learn') lastLearnAiMode = mode;
      if (config.workspace === 'review') lastReviewAiMode = mode;
      currentTab = 'ai';
      syncAiWorkspacePresentation?.();
      const artifactKey = currentAiArtifactKey();
      const currentArtifactMatches = Boolean(
        artifactKey
        && currentGeneratedNote?.markdown
        && currentGeneratedNote?.mode === currentAiMode
        && String(currentGeneratedNote?.mediaKey || '') === artifactKey
      );
      const alreadyVisible = Boolean(
        currentArtifactMatches
        && elements.aiNoteContent
        && mountedAiArtifact === currentGeneratedNote
        && !elements.aiNoteContent.hidden
        && elements.aiNoteContent.childNodes.length > 0
      );
      if (currentArtifactMatches) {
        if (alreadyVisible) syncAiArtifactFreshness();
        else renderCurrentAiArtifact();
      } else if (artifactKey) {
        void restoreNoteFromCache(artifactKey, currentAiMode);
      } else {
        renderEmptyAiNoteState('', currentAiMode);
      }
    };

    activateAiModeByName = (mode) => {
      const requested = AI_MODE_CONFIG[mode];
      const normalizedMode = requested?.workspace === currentWorkspace
        ? mode
        : (currentWorkspace === 'review' ? lastReviewAiMode : lastLearnAiMode);
      activateAiMode(normalizedMode);
    };

    aiModePills.forEach((pill) => {
      const mode = pill.dataset.mode || '';
      pill.addEventListener('click', () => activateAiMode(mode));
      pill.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const visiblePills = aiModePills.filter((candidate) => (
          AI_MODE_CONFIG[candidate.dataset.mode || '']?.workspace === currentWorkspace
        ));
        const index = visiblePills.indexOf(pill);
        if (index < 0 || visiblePills.length === 0) return;
        let nextIndex = index;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = visiblePills.length - 1;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + visiblePills.length) % visiblePills.length;
        else if (event.key === 'ArrowRight') nextIndex = (index + 1) % visiblePills.length;
        const next = visiblePills[nextIndex];
        if (!next) return;
        activateAiMode(next.dataset.mode || 'course_notes');
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

    elements.btnClearManualTray?.addEventListener('click', (event) => {
      event.stopPropagation();
      manualFrames = [];
      renderManualTray();
      toast('已清空预选截图');
    });

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
            const dataUrl = String(frame.dataUrl || '');
            const match = dataUrl.match(/^data:image\/([^;,]+);base64,(.+)$/s);
            if (!match) return;
            const subtype = String(match[1] || '').toLowerCase();
            const extension = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9.+-]/g, '') || 'webp';
            const base64Data = match[2];
            const safeTime = (frame.timeStr || `frame_${idx + 1}`).replace(/[:：]/g, '-');
            const fileName = `${String(idx + 1).padStart(2, '0')}_${safeTime}.${extension}`;
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
        const operationContext = createMediaOperationContext();
        await ensureCurrentPromptMediaContext(operationContext);
        assertMediaOperationContext(operationContext);
        const promptText = BSE.Ai?.buildPlanningPrompt?.({
          title: state.title,
          cues: state.cues,
          mediaContext: state.mediaContext || null,
          manualFrames
        }) || '';
        if (!promptText) {
          toast('构建提示词失败', true);
          return;
        }
        await navigator.clipboard.writeText(promptText);
        toast('已复制阶段一任务：先得到章节骨架与取样窗口，再把规划导回 SparkSub');
      });
    }

    // Copy External Synthesis Prompt (Stage 2) with already-captured screenshot tags
    if (elements.aiBtnCopySynthPrompt) {
      elements.aiBtnCopySynthPrompt.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供生成学习任务', true);
          return;
        }

        // 纯文本学习/复习任务不需要视觉规划。外部 AI 是同一产物的另一种执行 Adapter：
        // 一次复制完整任务，完成后把 Markdown 导回即可。
        if (currentAiMode !== 'course_notes') {
          try {
            await copyCurrentTextTaskForExternalAi();
          } catch (error) {
            toast(`复制外部 AI 任务失败：${error?.message || '剪贴板不可用'}`, true);
          }
          return;
        }

        const operationContext = createMediaOperationContext();
        await ensureCurrentPromptMediaContext(operationContext);
        assertMediaOperationContext(operationContext);

        // 图文讲义的最终任务必须与用户实际投递给外部 AI 的图片集合一致：
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
          cues: state.cues,
          mediaContext: state.mediaContext || null,
          capturedFrames: selectedFrames,
          videoIR: externalVideoPlan,
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
    function openImportModal(kind = 'result') {
      if (!elements.aiImportModal) return;
      externalImportKind = kind === 'plan' ? 'plan' : 'result';
      const isPlanImport = externalImportKind === 'plan';
      const isVisualExternalFlow = currentAiMode === 'course_notes';
      if (elements.aiImportModalTitle) {
        elements.aiImportModalTitle.textContent = uiText(isPlanImport ? 'ai_external_import_plan_modal_title' : 'ai_external_import_result_modal_title');
      }
      if (elements.aiImportModalDesc) {
        elements.aiImportModalDesc.textContent = isPlanImport
          ? uiText('ai_external_import_plan_modal_desc')
          : (isVisualExternalFlow
              ? uiText('ai_external_import_visual_result_modal_desc')
              : uiText('ai_external_import_modal_text_desc', { task: aiModeLabel(currentAiMode) }));
      }
      if (elements.aiImportTextarea) {
        elements.aiImportTextarea.placeholder = uiText(isPlanImport
          ? 'ai_external_import_plan_modal_placeholder'
          : 'ai_external_import_modal_result_placeholder');
      }
      if (elements.aiBtnConfirmImport) {
        elements.aiBtnConfirmImport.textContent = uiText(isPlanImport ? 'ai_external_import_plan' : 'ai_external_import_result');
      }
      elements.aiImportModal.hidden = false;
      if (elements.aiImportTextarea) {
        elements.aiImportTextarea.value = '';
        setTimeout(() => elements.aiImportTextarea.focus(), 50);
      }
    }

    function closeImportModal() {
      if (elements.aiImportModal) {
        elements.aiImportModal.hidden = true;
      }
    }

    if (elements.aiBtnImportPlan) {
      elements.aiBtnImportPlan.addEventListener('click', () => openImportModal('plan'));
    }
    if (elements.aiBtnOpenImportModal) {
      elements.aiBtnOpenImportModal.addEventListener('click', () => openImportModal('result'));
    }
    if (elements.aiBtnCloseImportModal) {
      elements.aiBtnCloseImportModal.addEventListener('click', closeImportModal);
    }
    if (elements.aiBtnCancelImport) {
      elements.aiBtnCancelImport.addEventListener('click', closeImportModal);
    }

    // Confirm & Process External Import (JSON or Markdown)
    if (elements.aiBtnConfirmImport) {
      elements.aiBtnConfirmImport.addEventListener('click', () => withButtonBusy(elements.aiBtnConfirmImport, async () => {
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

        const importMode = currentAiMode;
        const isPlanImport = externalImportKind === 'plan';
        if (isPlanImport && importMode !== 'course_notes') {
          toast('只有图文讲义需要导入阶段一章节与取样规划', true);
          return;
        }

        // 导入动作本身就是协议边界：规划入口只接受规划 JSON，结果入口始终按最终 Markdown 处理。
        // 不再根据粘贴内容猜测用户当前处于哪一步。
        const parsedJson = isPlanImport ? BSE.Ai?.extractJsonFromText?.(rawText) : null;
        if (isPlanImport) {
          if (!parsedJson || !(parsedJson.samplingWindows || parsedJson.visualRequests || parsedJson.visualEvidence || parsedJson.chapters)) {
            toast('未识别到有效的阶段一规划 JSON，请确认其中包含 chapters 或 samplingWindows', true);
            return;
          }
          closeImportModal();
          const chapters = BSE.Ai?.normalizePlanChapters?.(parsedJson)
            || (Array.isArray(parsedJson.chapters) ? parsedJson.chapters : []);
          const samplingWindows = BSE.Ai?.normalizeSamplingWindows?.(parsedJson) || [];
          appendDiagnostic('AI外部导入', `成功解析外部规划 JSON · 提取 ${chapters.length} 个章节 · ${samplingWindows.length} 个取样窗口`, { scope: 'ai', level: 'info' });

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
          externalVideoPlan = {
            strategy: 'llm',
            summary: String(parsedJson.summary || '').trim(),
            chapters,
            visualRequests: samplingWindows,
            visualEvidence
          };

          if (visualEvidence.length > 0) {
            if (elements.aiProgressBox) elements.aiProgressBox.hidden = false;
            if (elements.aiProgressText) elements.aiProgressText.textContent = `正在根据导入的规划定向截取高清原画 (0/${visualEvidence.length})…`;

            let captureResult;
            try {
              captureResult = await capturePlannedEvidence(visualEvidence, manualFrames, mediaContext, {
                label: '外部规划',
                onProgress: ({ done, total }) => {
                  if (elements.aiProgressText) elements.aiProgressText.textContent = `正在根据导入的规划定向截取高清原画 (${done}/${total})…`;
                }
              });
            } catch (error) {
              if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
              if (error?.code === 'MEDIA_CONTEXT_CHANGED') {
                toast(error.message, true);
                return;
              }
              throw error;
            }
            manualFrames = captureResult.frames;
            if (elements.aiProgressBox) elements.aiProgressBox.hidden = true;
            const beforeShortlistCount = manualFrames.length;
            const finalBudget = BSE.VisualDetector?.evidenceBudgetForDuration?.(videoDuration) || 12;
            const trayBudget = Math.min(36, Math.max(finalBudget, finalBudget * 2));
            if (BSE.VisualDetector?.selectEvidenceFrames && manualFrames.length > trayBudget) {
              manualFrames = BSE.VisualDetector.selectEvidenceFrames(manualFrames, { videoDuration, maxFrames: trayBudget });
            }
            // 批量规划期间只更新进度文本，全部截图与初筛结束后一次提交托盘 DOM。
            // 避免每新增一张大尺寸 data URL 都重新序列化并解码此前所有图片。
            renderManualTray();
            const reusedLabel = captureResult.reusedCount > 0 ? `，复用 ${captureResult.reusedCount} 张已有画面` : '';
            const failedLabel = captureResult.failedCount > 0 ? `，${captureResult.failedCount} 个窗口未取得可靠画面` : '';
            const shortlistLabel = beforeShortlistCount > manualFrames.length ? `；候选初筛后托盘保留 ${manualFrames.length} 张` : `，托盘共 ${manualFrames.length} 张`;
            toast(`阶段一完成：新增 ${captureResult.capturedCount} 张高清画面${reusedLabel}${failedLabel}${shortlistLabel}。下一步复制精选拼图，再复制最终任务。`);
          } else {
            toast('阶段一完成：已识别章节大纲且无需额外取帧。下一步复制最终任务。');
          }
          syncExternalAiPanelState?.();
          return;
        }

        // 最终结果入口不再尝试解析规划 JSON，直接按当前 mode 的 Markdown 产物回流。
        assertMediaOperationContext(mediaContext);
        closeImportModal();
        const imagesMap = importMode === 'course_notes' ? (currentGeneratedNote?.imagesMap || {}) : {};
        const selectedImportedFrames = importMode === 'course_notes'
          ? (BSE.VisualDetector?.selectEvidenceFrames
              ? BSE.VisualDetector.selectEvidenceFrames(manualFrames, { videoDuration: importState.duration || importState.cues?.[importState.cues.length - 1]?.to || 0 })
              : manualFrames)
          : [];
        for (const mf of selectedImportedFrames) {
          imagesMap[mf.timestamp] = mf;
          imagesMap[String(mf.timestamp)] = mf;
          if (mf.timeStr) imagesMap[mf.timeStr] = mf;
        }
        aiNoteRestoreRevision++;
        currentGeneratedNote = {
          markdown: rawText,
          imagesMap,
          mode: importMode,
          title: importState?.title || `导入${aiModeLabel(importMode)}`,
          mediaKey: currentAiArtifactKey(importState),
          sourceUrl: importState?.url || '',
          sourceCueFingerprint: currentCueFingerprint(importState),
          runtimePersisted: false
        };
        renderCurrentAiArtifact();
        await saveCurrentNoteToCache();
        if (state?.mediaKey === importState?.mediaKey) {
          toast('报告 Markdown 已导入并完成图文渲染');
        }
      }));
    }

    // Generate AI Notes (两阶段视频证据规划与多模态合成流水线)
    if (elements.aiBtnGenerate) {
      elements.aiBtnGenerate.addEventListener('click', async () => {
        if (!state?.cues?.length) {
          toast('暂无字幕内容可供分解', true);
          return;
        }
        if (cancelActiveAiGeneration('已开始新的生成任务')) aiGenerationRevision++;

        const generationCueRevision = Number(state.cueRevision || 0);
        // Side Panel state is replaced wholesale on every content-state broadcast;
        // cues/tracks are never mutated in place here. Keep the launch-time array
        // references instead of cloning thousands of cues just to freeze a task.
        // cueRevision + AbortSignal still guard every async commit point.
        const generationState = {
          ...state,
          tracks: Array.isArray(state.tracks) ? state.tracks : [],
          cues: state.cues,
          mediaContext: state.mediaContext ? BSE.MediaContext?.create?.(state.mediaContext) || state.mediaContext : null
        };
        const generationSourceCueFingerprint = currentCueFingerprint(state);
        const generationMode = currentAiMode;
        const generationManualFrames = manualFrames.map((frame) => ({ ...frame }));
        const mediaContext = createMediaOperationContext();
        await ensureCurrentPromptMediaContext(mediaContext);
        assertMediaOperationContext(mediaContext);
        assertSubtitleRevision(generationCueRevision);
        generationState.mediaContext = state.mediaContext ? BSE.MediaContext?.create?.(state.mediaContext) || state.mediaContext : generationState.mediaContext;
        const generationRevision = ++aiGenerationRevision;
        aiNoteRestoreRevision++;

        await aiConfigReady;
        assertMediaOperationContext(mediaContext);
        assertSubtitleRevision(generationCueRevision);
        const draftConfig = readDraftAiConfig();
        if (!isSavedAiConfig(draftConfig)) {
          setAiSettingsOpen(true);
          toast('AI 配置有未保存修改，请先保存后再生成', true);
          return;
        }

        const activeConfig = await getActiveAiSettings();
        assertMediaOperationContext(mediaContext);
        assertSubtitleRevision(generationCueRevision);
        const activeModelName = activeConfig.model || '大模型';
        const generationController = new AbortController();
        aiGenerationController = generationController;
        const generationSignal = generationController.signal;

        elements.aiBtnGenerate.disabled = true;
        if (elements.aiProgressBox) elements.aiProgressBox.hidden = false;
        if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = true;

        const updateProgress = (txt) => {
          if (generationRevision !== aiGenerationRevision) return;
          if (elements.aiProgressText) elements.aiProgressText.textContent = txt;
        };

        const startTime = performance.now();
        let synthesisTimer = null;
        try {
          const imagesMap = {};
          const capturedScreenshots = [];
          let plannedEvidence = [];

          let aiResult;
          if (generationMode === 'course_notes') {
            // 阶段一：文本模型只根据带时间戳字幕规划章节与播放器取样窗口。
            appendDiagnostic('AI时间规划', `正在向大模型提交带时间戳字幕以规划章节与取样窗口 (字幕: ${generationState.cues.length} 条 · 用户标记: ${generationManualFrames.length} 处 · 模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            updateProgress(`阶段 1/2 · ${activeModelName} 正在规划章节与取样窗口…`);
            const planResult = await BSE.Ai?.planVisualEvidence?.({
              title: generationState.title,
              cues: generationState.cues,
              mediaContext: generationState.mediaContext || null,
              manualFrames: generationManualFrames,
              videoDuration: generationState.duration || generationState.cues?.[generationState.cues.length - 1]?.to || Infinity,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
              signal: generationSignal
            });

            assertMediaOperationContext(mediaContext);
            assertSubtitleRevision(generationCueRevision);
            if (!planResult) throw new Error('AI 视频规划模块未返回结果');
            if (planResult.strategy === 'fallback' && planResult.failureKind === 'request') {
              throw new Error(`AI 规划阶段调用失败: ${planResult.error || '模型服务不可用'}`);
            }
            if (planResult.strategy === 'fallback' && planResult.failureKind === 'parse') {
              appendDiagnostic('AI时间规划', `规划返回格式异常，已降级为字幕 + 用户标记内容直接合成: ${planResult.error || 'JSON 解析失败'}`, { scope: 'ai', level: 'warn' });
              updateProgress('阶段 1/2 · 规划格式异常，已降级为字幕与用户标记内容直接合成…');
            }

            plannedEvidence = planResult.visualEvidence || [];
            appendDiagnostic('AI时间规划', `规划完成 · 提取 ${planResult.chapters?.length || 0} 个章节 · 给出 ${plannedEvidence.length} 个播放器取样窗口 (策略: ${planResult.strategy})`, { scope: 'ai', level: planResult.strategy === 'fallback' ? 'warn' : 'info' });

            // 阶段一执行：Side Panel 只编排证据窗口；播放器就绪、缓冲与有限重试由 Media Module 统一负责。
            let capturedFrames = [...generationManualFrames];
            if (plannedEvidence.length > 0) {
              updateProgress(`阶段 1/2 · 正在按规划截取稳定画面 (0/${plannedEvidence.length})…`);
              const captureResult = await capturePlannedEvidence(plannedEvidence, generationManualFrames, mediaContext, {
                label: '自动规划',
                signal: generationSignal,
                onProgress: ({ done, total }) => updateProgress(`阶段 1/2 · 正在按规划截取稳定画面 (${done}/${total})…`)
              });
              capturedFrames = captureResult.frames;
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

            // 阶段二：仅将筛选后的高价值画面与阶段一章节骨架送入模型，直接组织最终笔记。
            appendDiagnostic('AI多模态合成', `正在向多模态大模型上传 ${selectedFrames.length} 张画面与阶段一章节骨架 (模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            let elapsedSec = 0;
            updateProgress(`阶段 2/2 · 正在按既定章节骨架组织图文笔记… (已耗时 0s)`);
            synthesisTimer = setInterval(() => {
              elapsedSec++;
              updateProgress(`阶段 2/2 · 正在按既定章节骨架组织图文笔记… (已耗时 ${elapsedSec}s)`);
            }, 1000);

            aiResult = await BSE.Ai?.generateCourseNotes?.({
              title: generationState.title,
              cues: generationState.cues,
              mediaContext: generationState.mediaContext || null,
              screenshots: capturedScreenshots,
              capturedFrames: selectedFrames,
              videoIR: planResult,
              mode: generationMode,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
              signal: generationSignal,
              onProgress: (p) => updateProgress(p)
            });
          } else {
            appendDiagnostic('AI文本精修', `正在由大模型深度提炼文本 (模式: ${generationMode} · 模型: ${activeModelName})…`, { scope: 'ai', level: 'info' });
            updateProgress(`正在由 ${activeModelName} 深度提炼…`);
            aiResult = await BSE.Ai?.generateCourseNotes?.({
              title: generationState.title,
              cues: generationState.cues,
              mediaContext: generationState.mediaContext || null,
              screenshots: [],
              capturedFrames: [],
              visualEvidence: [],
              mode: generationMode,
              endpoint: activeConfig.endpoint,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
              signal: generationSignal,
              onProgress: updateProgress
            });
          }

          if (synthesisTimer) {
            clearInterval(synthesisTimer);
            synthesisTimer = null;
          }

          assertMediaOperationContext(mediaContext);
          assertSubtitleRevision(generationCueRevision);
          const markdown = aiResult?.markdown || '';
          if (!markdown.trim()) throw new Error('AI 返回的学习内容为空');
          const totalDurationSec = ((performance.now() - startTime) / 1000).toFixed(1);
          const renderedEvidenceCount = new Set(Object.values(imagesMap).map((frame) => String(frame?.timestamp ?? frame?.timeStr ?? ''))).size;
          const actualModel = aiResult?.modelUsed || activeModelName;
          appendDiagnostic('AI内容生成', `生成成功 (总耗时 ${totalDurationSec}s · 模型: ${actualModel} · Markdown ${markdown.length} 字符 · 图文证据 ${renderedEvidenceCount} 张)`, { scope: 'ai', level: 'info' });

          aiNoteRestoreRevision++;
          const completedNote = {
            markdown,
            imagesMap,
            mode: generationMode,
            title: generationState.title || '课程笔记',
            mediaKey: currentAiArtifactKey(generationState),
            sourceUrl: generationState.url || '',
            sourceCueFingerprint: generationSourceCueFingerprint,
            runtimePersisted: false
          };
          const shouldPresentCompletedNote = currentAiMode === generationMode;
          if (shouldPresentCompletedNote) {
            currentGeneratedNote = completedNote;
            // Study and Review render from the same canonical artifact path.
            renderCurrentAiArtifact();
          }
          await saveCurrentNoteToCache(completedNote);
          if (generationRevision !== aiGenerationRevision) return;
          toast(`${aiModeLabel(generationMode)}生成成功`);
        } catch (err) {
          if (synthesisTimer) {
            clearInterval(synthesisTimer);
            synthesisTimer = null;
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
          if (err?.code === 'SUBTITLE_CONTEXT_CHANGED') {
            appendDiagnostic('AI生成中止', err.message, { scope: 'ai', level: 'warn' });
            if (generationRevision === aiGenerationRevision) toast(err.message, true);
            return;
          }
          appendDiagnostic('AI生成异常', `生成失败: ${err.message}`, { scope: 'ai', level: 'error' });
          const is401 = String(err.message).includes('401') || String(err.message).includes('invalid_api_key');
          if (is401) {
            toast('AI 认证失败：请在右上角设置中输入并保存 API Key', true);
            setAiSettingsOpen(true);
            if (elements.aiInputApiKey) elements.aiInputApiKey.focus();
          } else {
            toast(`生成失败: ${err.message}`, true);
          }
          if (elements.aiNotePlaceholder) elements.aiNotePlaceholder.hidden = false;
        } finally {
          if (synthesisTimer) {
            clearInterval(synthesisTimer);
            synthesisTimer = null;
          }
          if (aiGenerationController === generationController) aiGenerationController = null;
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
            const time = Number.isFinite(capturedTimestamp) ? capturedTimestamp : 0;
            const timeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(time) : `${Math.round(time)}s`;
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
              currentGeneratedNote.runtimePersisted = false;
              currentGeneratedNote.imagesMap[timeStr] = frameObj;
              currentGeneratedNote.imagesMap[time] = frameObj;
              const frameReference = BSE.Formatters?.buildFrameReference?.(timeStr, '重点画面截图') || `[SCREENSHOT: ${timeStr} "重点画面截图"]`;
              currentGeneratedNote.markdown += `\n\n${frameReference}\n`;
              invalidateCurrentNoteRenderCache();

              renderCurrentAiArtifact();
              await saveCurrentNoteToCache();
              if (state?.mediaKey === mediaContext.mediaKey) toast(`已截取 ${timeStr} 画面并加入笔记`);
            } else {
              toast(`已截取 ${timeStr} 画面（已加入预选，生成讲义时将一并传给 AI）`);
            }
          } else {
            const detail = res?.message || res?.error || res?.frame?.message || res?.frame?.error || '当前画面不可用';
            toast(`截帧失败：${detail}`, true);
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
            currentGeneratedNote.runtimePersisted = false;
            currentGeneratedNote.markdown = BSE.Formatters?.transformFrameReferences
              ? BSE.Formatters.transformFrameReferences(currentGeneratedNote.markdown, (reference) => (
                  Math.abs(reference.seconds - referenceSec) < 0.01 && reference.timeStr === referenceTimeStr ? '' : reference.raw
                ))
              : currentGeneratedNote.markdown;
            invalidateCurrentNoteRenderCache();
            renderCurrentAiArtifact();
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

        // 3. 章节时间轴与截图时间按钮统一跳转到对应视频位置。
        const jumpBtn = closestButton(e, '.note-timeline-jump, .note-jump-btn');
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
            const capturedTimestamp = Number(res.frame.timestamp);
            const actualSec = Number.isFinite(capturedTimestamp) ? capturedTimestamp : sec;
            const actualTimeStr = BSE.Utils?.formatClock ? BSE.Utils.formatClock(actualSec) : `${Math.round(actualSec)}s`;
            const frameObj = {
              dataUrl: res.frame.dataUrl,
              timestamp: actualSec,
              timeStr: actualTimeStr,
              label: `补充画面 (${actualTimeStr})`,
              reason: '用户在报告中手动补截的画面',
              source: 'manual'
            };
            // timeStr/sec 是 Markdown 的语义槽位；actualTimeStr/actualSec 是播放器真正截到的帧。
            currentGeneratedNote.runtimePersisted = false;
            currentGeneratedNote.imagesMap[timeStr] = frameObj;
            currentGeneratedNote.imagesMap[sec] = frameObj;
            currentGeneratedNote.imagesMap[actualTimeStr] = frameObj;
            currentGeneratedNote.imagesMap[actualSec] = frameObj;
            invalidateCurrentNoteRenderCache();
            renderCurrentAiArtifact();
            await saveCurrentNoteToCache();
            if (state?.mediaKey === mediaContext.mediaKey) toast(`已嵌入 ${actualTimeStr} 视频画面`);
          } else {
            const detail = res?.message || res?.error || res?.frame?.message || res?.frame?.error || '目标画面不可用';
            toast(`补截失败：${detail}`, true);
          }
        }
      });
    }

    if (elements.aiBtnClearArtifact) {
      elements.aiBtnClearArtifact.addEventListener('click', () => {
        void clearCurrentAiArtifact();
      });
    }

    // Copy the currently selected learning artifact. Each mode is persisted
    // independently, so copying Summary never replaces Notes or Self-test.
    if (elements.aiBtnCopyNote) {
      elements.aiBtnCopyNote.addEventListener('click', async () => {
        if (!currentGeneratedNote.markdown) return;
        await navigator.clipboard.writeText(currentGeneratedNote.markdown);
        toast(`已复制${aiModeLabel(currentGeneratedNote.mode)} Markdown`);
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
          const suffix = aiModeLabel(currentGeneratedNote.mode);
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
  elements.format?.addEventListener('change', () => syncSubtitleActionAvailability(state?.cues || []));
  
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
    elements.follow.setAttribute('aria-pressed', String(following));
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
      elements.follow.setAttribute('aria-pressed', 'false');
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
    elements.follow.setAttribute('aria-pressed', 'true');
    const t = (k) => BSE.I18n?.t(k) || k;
    if (elements.followText) elements.followText.textContent = t('follow');
    scrollToActive(false);
  });

  elements.copy.addEventListener('click', async () => {
    try {
      const text = BSE.Formatters.toTxt(state?.cues || [], false);
      if (!text.trim()) {
        toast('当前没有可复制的字幕内容', true);
        return;
      }
      await navigator.clipboard.writeText(text);
      toast(BSE.I18n?.t('copied_full_text') || '已复制字幕全文');
    } catch (error) {
      toast(`复制失败：${error?.message || '剪贴板不可用'}`, true);
    }
  });

  elements.diagnosticTechnical?.addEventListener('toggle', () => {
    if (elements.diagnosticTechnical?.open) renderDiagnostics();
  });

  elements.copyDiagnostic.addEventListener('click', async (event) => {
    event.stopPropagation();
    const fault = state?.lastError;
    const activeArtifactKey = currentAiArtifactKey();
    const visibleArtifactMatches = Boolean(
      currentGeneratedNote?.markdown
      && activeArtifactKey
      && String(currentGeneratedNote.mediaKey || '') === activeArtifactKey
    );
    const header = [
      `扩展版本：${state?.version || '未知'}`,
      `平台：${state?.platform || '未知'}`,
      `媒体：${state?.mediaKey || '未知'}`,
      `学习材料：${activeArtifactKey || '无'}${visibleArtifactMatches ? ` / ${aiModeLabel(currentGeneratedNote.mode)}` : ' / 当前无可见产物'}`,
      `材料来源：${visibleArtifactMatches ? (currentGeneratedNote.sourceUrl || '旧缓存未记录来源 URL') : '无'}`,
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

  function syncBatchOutputControls(knownCheckedCount = null) {
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

    const checkedCount = Number.isInteger(knownCheckedCount)
      ? Math.max(0, knownCheckedCount)
      : queryInputs(elements.batchTreeList, '.batch-tree-cb:checked').length;
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
    const sectionStats = new Map();
    const videoStats = new Map();
    let checkedCount = 0;
    let totalSec = 0;

    for (const cb of allCbs) {
      const checked = cb.checked;
      if (checked) {
        checkedCount++;
        totalSec += Number(cb.dataset.duration) || 0;
      }
      const secKey = cb.dataset.secKey || '';
      if (secKey) {
        const stats = sectionStats.get(secKey) || { total: 0, checked: 0 };
        stats.total++;
        if (checked) stats.checked++;
        sectionStats.set(secKey, stats);
      }
      const bvid = cb.dataset.bvid || '';
      if (bvid) {
        const stats = videoStats.get(bvid) || { total: 0, checked: 0 };
        stats.total++;
        if (checked) stats.checked++;
        videoStats.set(bvid, stats);
      }
    }

    const total = allCbs.length;
    if (elements.batchTreeSelectedSummary) {
      const durLabel = totalSec > 0 ? ` · 约 ${BSE.Utils.formatClock(totalSec)}` : '';
      elements.batchTreeSelectedSummary.textContent = checkedCount === total
        ? `已全选 (${total} 集${durLabel})`
        : `已选 ${checkedCount} / ${total} 集${durLabel}`;
    }

    const syncParentCheckbox = (checkbox, stats) => {
      const checked = Math.max(0, Number(stats?.checked) || 0);
      const count = Math.max(0, Number(stats?.total) || 0);
      checkbox.checked = count > 0 && checked === count;
      checkbox.indeterminate = checked > 0 && checked < count;
    };

    queryInputs(elements.batchTreeList, '.batch-tree-sec-cb').forEach((secCb) => {
      syncParentCheckbox(secCb, sectionStats.get(secCb.dataset.secKey || ''));
    });
    queryInputs(elements.batchTreeList, '.batch-tree-video-cb').forEach((videoCb) => {
      syncParentCheckbox(videoCb, videoStats.get(videoCb.dataset.bvid || ''));
    });
    syncBatchOutputControls(checkedCount);
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
            if (currentWorkspace === 'tracker') renderTrackerList();
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

  // Keyboard Shortcuts: Esc closes the top-most transient surface; Cmd/Ctrl+F searches subtitles.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!elements.batchOverlay.hidden) {
        if (batchControlTask?.running) {
          batchControlTask.cancelled = true;
          batchControlTask.controller?.abort();
        }
        elements.batchOverlay.hidden = true;
      } else if (elements.settingsDrawer && !elements.settingsDrawer.hidden) {
        elements.settingsDrawer.hidden = true;
        elements.settingsToggle?.classList.remove('active');
        elements.settingsToggle?.setAttribute('aria-expanded', 'false');
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
  // Keep the queue badge warm without building hidden cards or opening the Native Host.
  // Native capabilities are probed lazily when the user enters Transcription.
  loadAndRenderQueue({ renderList: false }).catch(() => {});
})();
