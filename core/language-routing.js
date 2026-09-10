(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE;
  const EUROPEAN_CODES = Object.freeze([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'ro', 'nl', 'da', 'sv', 'fi', 'hu',
    'et', 'lv', 'lt', 'mt', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ru', 'uk',
    'be', 'bg', 'sr', 'el'
  ]);
  const SUPPORTED_SOURCE_LANGUAGES = Object.freeze(['auto', 'zh', 'yue', ...EUROPEAN_CODES]);
  const MANDARIN = new Set(['zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'cmn', 'cmn-hans', 'cmn-hant']);
  const CANTONESE = new Set(['yue', 'zh-hk', 'zh-yue', 'zh-hant-hk']);

  function normalize(value) {
    return String(value || 'auto').trim().toLowerCase().replace(/_/g, '-');
  }

  function canonicalLanguage(value) {
    const normalized = normalize(value);
    if (normalized === 'auto') return 'auto';
    if (MANDARIN.has(normalized)) return 'zh';
    if (CANTONESE.has(normalized) || normalized.startsWith('yue-')) return 'yue';
    const base = normalized.split('-')[0];
    return EUROPEAN_CODES.includes(base) ? base : normalized;
  }

  function isCantonese(value) {
    return canonicalLanguage(value) === 'yue';
  }

  function localASRSupport(capabilities, sourceLanguage, platformLanguage) {
    const feature = capabilities?.features?.localASR;
    if (!feature || feature.available !== true) return false;

    const requested = canonicalLanguage(sourceLanguage);
    const supported = new Set(
      Array.isArray(feature.languages)
        ? feature.languages.map(canonicalLanguage).filter((value) => value && value !== 'auto')
        : []
    );

    if (requested !== 'auto') return supported.has(requested);

    const hint = canonicalLanguage(platformLanguage);
    if (hint !== 'auto' && hint) return supported.has(hint);
    return feature.supportsAutoLanguage === true;
  }

  BSE.LanguageRouting = Object.freeze({
    EUROPEAN_CODES,
    SUPPORTED_SOURCE_LANGUAGES,
    normalize,
    canonicalLanguage,
    isCantonese,
    localASRSupport
  });
})();
