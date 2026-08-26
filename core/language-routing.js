(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});
  const EUROPEAN_CODES = Object.freeze([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'ro', 'nl', 'da', 'sv', 'fi', 'hu',
    'et', 'lv', 'lt', 'mt', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ru', 'uk',
    'be', 'bg', 'sr', 'el'
  ]);
  const SUPPORTED_SOURCE_LANGUAGES = Object.freeze(['auto', 'zh', 'yue', ...EUROPEAN_CODES]);
  const MANDARIN = new Set(['zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'cmn', 'cmn-hans', 'cmn-hant']);
  const CANTONESE = new Set(['yue', 'zh-hk', 'zh-yue']);

  function normalize(value) {
    return String(value || 'auto').trim().toLowerCase().replace(/_/g, '-');
  }

  function isCantonese(value) {
    const normalized = normalize(value);
    return CANTONESE.has(normalized) || normalized.startsWith('yue-') || normalized === 'zh-hant-hk';
  }

  function europeanLanguage(value) {
    const normalized = normalize(value);
    const base = normalized.split('-')[0];
    return EUROPEAN_CODES.includes(normalized) ? normalized : (EUROPEAN_CODES.includes(base) ? base : null);
  }

  function engineFor(sourceLanguage, platformLanguage, sourceKind) {
    const requested = normalize(sourceLanguage);
    if (isCantonese(requested)) return null;
    if (MANDARIN.has(requested)) return 'cohere';
    if (europeanLanguage(requested)) return 'parakeet';
    if (requested !== 'auto') return null;
    const hint = normalize(platformLanguage);
    if (isCantonese(hint)) return null;
    if (MANDARIN.has(hint)) return 'cohere';
    if (europeanLanguage(hint)) return 'parakeet';
    return sourceKind === 'remote' ? 'cohere' : 'parakeet';
  }

  BSE.LanguageRouting = Object.freeze({
    EUROPEAN_CODES,
    SUPPORTED_SOURCE_LANGUAGES,
    normalize,
    isCantonese,
    engineFor
  });
})();
