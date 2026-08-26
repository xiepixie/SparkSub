(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});
  const ROUTING = BSE.LanguageRouting;
  const SUPPORTED_SOURCE_LANGUAGES = ROUTING?.SUPPORTED_SOURCE_LANGUAGES || Object.freeze(['auto', 'zh', 'yue', 'en']);
  const REQUIRED_I18N_KEYS = Object.freeze([
    'queue_source_language_label', 'queue_source_language_hint', 'queue_language_auto', 'queue_language_zh', 'queue_language_yue',
    'queue_capabilities_title', 'queue_capability_checking', 'queue_capability_refresh', 'queue_capability_ready', 'queue_capability_partial', 'queue_capability_not_installed', 'queue_capability_incompatible',
    'queue_capability_ytdlp', 'queue_capability_parakeet', 'queue_capability_cohere', 'queue_capability_bilibili_note',
    'queue_source_platform_bilibili', 'queue_source_platform_youtube', 'queue_engine_parakeet', 'queue_engine_cohere',
    'queue_error_retriable', 'queue_error_not_retriable', 'queue_error_safe_hint'
  ]);

  function nativeEngineFor(item = {}) {
    return ROUTING?.engineFor(item.sourceLanguage, item.platformLanguage || item.metaCache?.platformLanguage, item.platform === 'bilibili' ? 'remote' : 'youtube') || null;
  }

  function sourceEngineLabel(item = {}) {
    const subtitle = item.subtitle || {};
    if (subtitle.source === 'platform') {
      return { key: item.platform === 'bilibili' ? 'queue_source_platform_bilibili' : 'queue_source_platform_youtube' };
    }
    const engine = subtitle.engine === 'cohere' || subtitle.engine === 'parakeet'
      ? subtitle.engine
      : nativeEngineFor(item);
    return { key: engine === 'cohere' ? 'queue_engine_cohere' : 'queue_engine_parakeet' };
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

  function componentState(name, component = {}) {
    const detail = safeText(component.detail, '');
    if (component.available) return { key: 'queue_capability_ready', detail };
    if (name === 'cohere' && /k_cache_0|vocabulary/i.test(detail)) return { key: 'queue_capability_incompatible', detail };
    return { key: 'queue_capability_partial', detail };
  }

  function capabilityState(capabilities, error) {
    if (!capabilities) return { key: error?.code === 'NATIVE_HOST_NOT_INSTALLED' ? 'queue_capability_not_installed' : 'queue_capability_partial' };
    const components = [capabilities.ytDLP, capabilities.models?.parakeet, capabilities.models?.cohere];
    if (capabilities.hostReady && components.every((component) => component?.available)) return { key: 'queue_capability_ready' };
    return { key: 'queue_capability_partial' };
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
    const parts = capabilities ? [
      ['queue_capability_ytdlp', capabilities.ytDLP],
      ['queue_capability_parakeet', capabilities.models?.parakeet],
      ['queue_capability_cohere', capabilities.models?.cohere]
    ].map(([key, component]) => `${t(key)}: ${t(componentState(key.replace('queue_capability_', ''), component).key)}${safeText(component?.detail) ? ` — ${safeText(component.detail)}` : ''}`) : [t(state.key)];
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
    nativeEngineFor,
    sourceEngineLabel,
    safeFailurePresentation,
    componentState,
    capabilityState,
    enqueueWithLanguage,
    saveDefaultLanguage,
    loadDefaultLanguage,
    renderCapabilityPanel,
    renderFailureCard
  });
})();
