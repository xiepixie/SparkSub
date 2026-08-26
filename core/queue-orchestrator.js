(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});

  /**
   * @param {{ drain?: () => Promise<void> | void }} [options]
   */
  function create({ drain } = {}) {
    if (typeof drain !== 'function') throw new TypeError('QueueOrchestrator requires a drain function');

    let running = false;
    let followUpRequested = false;
    let currentRun = null;

    function wake() {
      if (running) {
        followUpRequested = true;
        return currentRun;
      }

      running = true;
      currentRun = Promise.resolve().then(async () => {
        let firstError = null;
        do {
          followUpRequested = false;
          try {
            await drain();
          } catch (error) {
            firstError = firstError || error;
          }
        } while (followUpRequested);
        if (firstError) throw firstError;
      }).finally(() => {
        running = false;
        currentRun = null;
      });
      return currentRun;
    }

    return Object.freeze({ wake });
  }

  BSE.QueueOrchestrator = Object.freeze({ create });
})();
