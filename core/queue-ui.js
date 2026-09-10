(() => {
  'use strict';

  const root = /** @type {any} */ (globalThis);
  /** @type {import('../types/bse').BSENamespace} */
  const BSE = root.BSE = root.BSE || /** @type {any} */ ({});
  const ROUTING = BSE.LanguageRouting;
  const SUPPORTED_SOURCE_LANGUAGES = ROUTING?.SUPPORTED_SOURCE_LANGUAGES || Object.freeze(['auto', 'zh', 'yue', 'en']);
  const REQUIRED_I18N_KEYS = Object.freeze([
    'queue_source_language_label', 'queue_source_language_hint', 'queue_language_auto', 'queue_language_zh', 'queue_language_yue',
    'queue_capabilities_title', 'queue_capability_checking', 'queue_capability_refresh', 'queue_capability_ready', 'queue_capability_partial', 'queue_capability_not_installed', 'queue_capability_incompatible',
    'queue_capability_local_asr', 'queue_capability_youtube_captions', 'queue_capability_remote_media', 'queue_capability_bilibili_note',
    'queue_source_platform_bilibili', 'queue_source_platform_youtube', 'queue_engine_local_asr',
    'queue_error_retriable', 'queue_error_not_retriable', 'queue_error_safe_hint'
  ]);

  function sourceEngineLabel(item = {}) {
    const subtitle = item.subtitle || {};
    if (subtitle.source === 'platform') {
      return { key: item.platform === 'bilibili' ? 'queue_source_platform_bilibili' : 'queue_source_platform_youtube' };
    }
    return { key: 'queue_engine_local_asr' };
  }

  function safeText(value, fallback = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && !/(?:<[^>]*>|https?:\/\/|(?:upsig|sign|token|deadline|wssecret|wstime|auth_key)\s*(?:=|%3d))/i.test(text)
      ? text.slice(0, 240)
      : fallback;
  }

  function safeFailurePresentation(item = {}) {
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(String(item.errorCode || '')) ? item.errorCode : 'ASR_FAILED';
    return {
      code,
      hint: safeText(item.errorHint || item.error, ''),
      retriable: item.retriable === true
    };
  }

  function componentState(_name, component = {}) {
    const detail = safeText(component.detail, '');
    if (component.available) return { key: 'queue_capability_ready', detail };
    return { key: 'queue_capability_partial', detail };
  }

  function capabilityState(capabilities, error) {
    if (!capabilities) return { key: error?.code === 'NATIVE_HOST_NOT_INSTALLED' ? 'queue_capability_not_installed' : 'queue_capability_partial' };
    const features = capabilities.features || {};
    const localASR = features.localASR?.available === true;
    const hasMediaPath = features.youtubeCaptions?.available === true
      || features.remoteMedia?.youtube === true
      || features.remoteMedia?.bilibili === true;
    if (localASR && hasMediaPath) return { key: 'queue_capability_ready' };
    return { key: 'queue_capability_partial' };
  }

  function createCapabilityProbeState() {
    let revision = 0;
    /** @type {'idle' | 'checking' | 'settled'} */
    let phase = 'idle';
    let capabilities = null;
    let error = null;
    return Object.freeze({
      begin() {
        revision += 1;
        phase = 'checking';
        capabilities = null;
        error = null;
        return revision;
      },
      commit(probeRevision, result = {}) {
        if (probeRevision !== revision) return false;
        phase = 'settled';
        capabilities = result.capabilities || null;
        error = result.error || null;
        return true;
      },
      snapshot() { return { phase, capabilities, error, revision }; }
    });
  }

  async function enqueueWithLanguage({ urls, sourceLanguage, sendMessage }) {
    const options = { sourceLanguage };
    const response = await sendMessage({ type: 'BSE_QUEUE_ENQUEUE', urls, options });
    if (!response?.ok || !Array.isArray(response.items)) {
      throw new Error(response?.error || 'Service Worker queue is unavailable');
    }
    return response.items;
  }

  async function saveDefaultLanguage(sourceLanguage, saveSettings) {
    const value = SUPPORTED_SOURCE_LANGUAGES.includes(sourceLanguage) ? sourceLanguage : 'auto';
    return saveSettings({ sourceLanguage: value });
  }

  async function loadDefaultLanguage(getSettings) {
    const settings = await getSettings();
    return SUPPORTED_SOURCE_LANGUAGES.includes(settings?.sourceLanguage) ? settings.sourceLanguage : 'auto';
  }

  function renderCapabilityPanel(panel, statusElement, detailsElement, capabilities, error, t) {
    const state = capabilityState(capabilities, error);
    panel.hidden = false;
    panel.dataset.state = state.key;
    statusElement.textContent = t(state.key);
    if (panel.tagName === 'DETAILS') {
      panel.open = state.key !== 'queue_capability_ready';
    }

    const features = capabilities?.features;
    const localLanguages = Array.isArray(features?.localASR?.languages)
      ? features.localASR.languages.map((value) => safeText(value)).filter(Boolean).join(', ')
      : '';
    const remotePlatforms = [
      features?.remoteMedia?.youtube === true ? 'YouTube' : '',
      features?.remoteMedia?.bilibili === true ? 'Bilibili' : ''
    ].filter(Boolean).join(', ');
    const parts = features ? [
      `${t('queue_capability_local_asr')}: ${t(componentState('localASR', features.localASR).key)}${localLanguages ? ` — ${localLanguages}` : ''}`,
      `${t('queue_capability_youtube_captions')}: ${t(componentState('youtubeCaptions', features.youtubeCaptions).key)}`,
      `${t('queue_capability_remote_media')}: ${remotePlatforms || t('queue_capability_partial')}`
    ] : [t(state.key)];
    parts.push(t('queue_capability_bilibili_note'));
    detailsElement.textContent = parts.join('\n');
  }

  function renderFailureCard(element, item, t) {
    const failure = safeFailurePresentation(item);
    element.textContent = `${failure.code} · ${failure.hint || t('queue_error_safe_hint')} · ${t(failure.retriable ? 'queue_error_retriable' : 'queue_error_not_retriable')}`;
  }

  BSE.QueueUI = Object.freeze({
    SUPPORTED_SOURCE_LANGUAGES,
    requiredI18nKeys: () => [...REQUIRED_I18N_KEYS],
    sourceEngineLabel,
    safeFailurePresentation,
    componentState,
    capabilityState,
    createCapabilityProbeState,
    enqueueWithLanguage,
    saveDefaultLanguage,
    loadDefaultLanguage,
    renderCapabilityPanel,
    renderFailureCard
  });
})();
