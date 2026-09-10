(() => {
  'use strict';

  globalThis.BSE = globalThis.BSE || /** @type {import('../types/bse').BSENamespace} */ ({});
  // Protocol clients attach their frozen namespaces after this shared root loads.
  globalThis.BSE.VERSION = '0.2.0';
  globalThis.BSE.PLATFORM = Object.freeze({
    YOUTUBE: 'youtube',
    BILIBILI: 'bilibili'
  });
})();
