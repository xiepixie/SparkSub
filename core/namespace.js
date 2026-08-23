(() => {
  'use strict';

  globalThis.BSE = globalThis.BSE || {};
  globalThis.BSE.VERSION = '0.2.0';
  globalThis.BSE.PLATFORM = Object.freeze({
    YOUTUBE: 'youtube',
    BILIBILI: 'bilibili'
  });
})();
