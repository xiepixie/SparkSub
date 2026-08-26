(() => {
  'use strict';

  const HOST_NAME = 'com.sparksub.transcriber';
  const PROTOCOL_VERSION = 1;
  const MAX_MESSAGE_BYTES = 900 * 1024;
  const SHORT_REQUEST_TIMEOUT_MS = 30 * 1000;
  const TRANSCRIPTION_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
  const IDLE_DISCONNECT_TIMEOUT_MS = 250;
  const MAX_RESULT_CHUNKS = 10000;

  let port = null;
  let capabilities = null;
  let idleDisconnectTimer = null;
  const pendingRequests = new Map();

  const defaultErrorDetails = {
    NATIVE_HOST_NOT_INSTALLED: {
      message: 'The SparkSub native host is not installed.',
      hint: 'Install the SparkSub native host, then try again.',
      retriable: false
    },
    NATIVE_HOST_DISCONNECTED: {
      message: 'The SparkSub native host disconnected.',
      hint: 'Reconnect the native host and retry the job.',
      retriable: true
    },
    NATIVE_HOST_TIMEOUT: {
      message: 'The SparkSub native host did not respond in time.',
      hint: 'Check the native host and retry the job.',
      retriable: true
    },
    PROTOCOL_MESSAGE_TOO_LARGE: {
      message: 'The native host sent a message that exceeds the protocol limit.',
      hint: 'Retry the job. If this continues, update the native host.',
      retriable: true
    },
    RESULT_INCOMPLETE: {
      message: 'The native host returned an incomplete transcription result.',
      hint: 'Retry the job.',
      retriable: true
    },
    CAPTIONS_NOT_FOUND: {
      message: 'No public YouTube caption track was found.',
      hint: 'Use local transcription when the selected language is supported.',
      retriable: false
    },
    CANCELLED: {
      message: 'The transcription was cancelled.',
      hint: 'Start the job again when ready.',
      retriable: false
    },
    INVALID_REQUEST: {
      message: 'The transcription request is invalid.',
      hint: 'Check the transcription source and try again.',
      retriable: false
    }
  };

  function makeError(details, fallbackCode) {
    const incoming = details && typeof details === 'object' ? details : {};
    const code = typeof incoming.code === 'string' && incoming.code
      ? incoming.code
      : fallbackCode;
    const defaults = defaultErrorDetails[code] || {};
    const error = /** @type {import('../types/bse').NativeHostError} */ (new Error(
      typeof incoming.message === 'string' && incoming.message
        ? incoming.message
        : (defaults.message || 'The native host returned an error.')
    ));
    error.code = code;
    error.hint = typeof incoming.hint === 'string' && incoming.hint
      ? incoming.hint
      : (defaults.hint || 'Retry the job.');
    error.retriable = typeof incoming.retriable === 'boolean'
      ? incoming.retriable
      : Boolean(defaults.retriable);
    return error;
  }

  function messageByteLength(message) {
    return new TextEncoder().encode(JSON.stringify(message)).byteLength;
  }

  function createRequestId() {
    return typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `native-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function hasOnlyKeys(value, allowedKeys) {
    return isObject(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isStringMap(value) {
    return hasOnlyKeys(value, Object.keys(value || {}))
      && Object.entries(value).every(([key, item]) => (
        typeof item === 'string' && !/(?:cookie|authorization)/i.test(key)
      ));
  }

  function normalizeTranscriptionPayload(payload) {
    const allowedTopLevelKeys = ['jobId', 'sourceLanguage', 'title', 'duration', 'platformLanguage', 'source'];
    if (!hasOnlyKeys(payload, allowedTopLevelKeys)
      || !isNonEmptyString(payload.jobId)
      || !isNonEmptyString(payload.sourceLanguage)
      || !isObject(payload.source)) {
      return null;
    }
    if (payload.title !== undefined && typeof payload.title !== 'string') return null;
    if (payload.platformLanguage !== undefined && typeof payload.platformLanguage !== 'string') return null;
    if (payload.duration !== undefined && !Number.isFinite(payload.duration)) return null;

    const source = payload.source;
    if (source.kind === 'youtube') {
      if (!hasOnlyKeys(source, ['kind', 'url']) || !isNonEmptyString(source.url)) return null;
      return {
        jobId: payload.jobId,
        sourceLanguage: payload.sourceLanguage,
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.duration === undefined ? {} : { duration: payload.duration }),
        ...(payload.platformLanguage === undefined ? {} : { platformLanguage: payload.platformLanguage }),
        source: { kind: 'youtube', url: source.url }
      };
    }

    if (source.kind !== 'remote' || !hasOnlyKeys(source, ['kind', 'url', 'backupUrls', 'headers']) || !isNonEmptyString(source.url)) {
      return null;
    }
    if (source.backupUrls !== undefined && (!Array.isArray(source.backupUrls) || !source.backupUrls.every(isNonEmptyString))) return null;
    if (source.headers !== undefined && !isStringMap(source.headers)) return null;
    return {
      jobId: payload.jobId,
      sourceLanguage: payload.sourceLanguage,
      ...(payload.title === undefined ? {} : { title: payload.title }),
      ...(payload.duration === undefined ? {} : { duration: payload.duration }),
      ...(payload.platformLanguage === undefined ? {} : { platformLanguage: payload.platformLanguage }),
      source: {
        kind: 'remote',
        url: source.url,
        ...(source.backupUrls === undefined ? {} : { backupUrls: [...source.backupUrls] }),
        ...(source.headers === undefined ? {} : { headers: { ...source.headers } })
      }
    };
  }

  function normalizeYouTubeCaptionPayload(payload) {
    if (!hasOnlyKeys(payload, ['jobId', 'sourceLanguage', 'source'])
      || !isNonEmptyString(payload.jobId)
      || !isNonEmptyString(payload.sourceLanguage)
      || !hasOnlyKeys(payload.source, ['kind', 'url'])
      || payload.source.kind !== 'youtube'
      || !isNonEmptyString(payload.source.url)) {
      return null;
    }
    return {
      jobId: payload.jobId,
      sourceLanguage: payload.sourceLanguage,
      source: { kind: 'youtube', url: payload.source.url }
    };
  }

  function isValidCue(cue) {
    return isObject(cue)
      && Number.isFinite(cue.from)
      && Number.isFinite(cue.to)
      && cue.to > cue.from
      && typeof cue.content === 'string'
      && cue.content.trim().length > 0;
  }

  function settleRequest(requestId, outcome, value) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    pending.timeoutGeneration += 1;
    if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
    pending.signal?.removeEventListener('abort', pending.abortHandler);
    if (outcome === 'resolve') pending.resolve(value);
    else pending.reject(value);
    scheduleIdleDisconnect();
  }

  function clearIdleDisconnectTimer() {
    if (idleDisconnectTimer !== null) clearTimeout(idleDisconnectTimer);
    idleDisconnectTimer = null;
  }

  function scheduleIdleDisconnect() {
    clearIdleDisconnectTimer();
    if (!port || pendingRequests.size > 0) return;
    idleDisconnectTimer = setTimeout(() => {
      idleDisconnectTimer = null;
      if (!port || pendingRequests.size > 0) return;
      const idlePort = port;
      port = null;
      idlePort.disconnect();
    }, IDLE_DISCONNECT_TIMEOUT_MS);
  }

  function postBestEffortCancel(jobId) {
    if (!port || !isNonEmptyString(jobId)) return;
    try {
      port.postMessage({
        type: 'cancel',
        requestId: createRequestId(),
        protocolVersion: PROTOCOL_VERSION,
        jobId
      });
    } catch {
      // Timeout settlement must not depend on receiving a cancel response.
    }
  }

  function armRequestTimeout(requestId, pending) {
    if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
    const generation = ++pending.timeoutGeneration;
    pending.timeoutId = setTimeout(() => {
      if (pendingRequests.get(requestId) !== pending || pending.timeoutGeneration !== generation) return;
      if (pending.expectResult) postBestEffortCancel(pending.jobId);
      settleRequest(requestId, 'reject', makeError(null, 'NATIVE_HOST_TIMEOUT'));
    }, pending.timeoutMs);
  }

  function rejectAll(error) {
    Array.from(pendingRequests.keys()).forEach((requestId) => {
      settleRequest(requestId, 'reject', error);
    });
  }

  function handleDisconnect(disconnectedPort) {
    if (port !== disconnectedPort) return;
    clearIdleDisconnectTimer();
    const lastErrorMessage = chrome.runtime.lastError?.message;
    port = null;
    capabilities = null;
    const code = /(?:host|native messaging).*(?:not found|not installed|not registered)|(?:not found|not installed|not registered).*?(?:host|native messaging)/i.test(lastErrorMessage || '')
      ? 'NATIVE_HOST_NOT_INSTALLED'
      : 'NATIVE_HOST_DISCONNECTED';
    rejectAll(makeError(lastErrorMessage ? { message: lastErrorMessage } : null, code));
  }

  function handleMessage(message) {
    let size;
    try {
      size = messageByteLength(message);
    } catch {
      rejectAll(makeError(null, 'RESULT_INCOMPLETE'));
      return;
    }
    if (size >= MAX_MESSAGE_BYTES) {
      rejectAll(makeError(null, 'PROTOCOL_MESSAGE_TOO_LARGE'));
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.requestId !== 'string') return;

    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    if (message.type === 'response') {
      if (message.ok === false) {
        settleRequest(message.requestId, 'reject', makeError(message.error, 'RESULT_INCOMPLETE'));
      } else if (!pending.expectResult) {
        settleRequest(message.requestId, 'resolve', message.result);
      }
      return;
    }

    if (message.type === 'error') {
      settleRequest(message.requestId, 'reject', makeError(message, 'RESULT_INCOMPLETE'));
      return;
    }

    if (!pending.expectResult || message.jobId !== pending.jobId) return;

    if (message.type === 'progress') {
      armRequestTimeout(message.requestId, pending);
      try {
        pending.onProgress?.(message);
      } catch {
        // Consumer progress handlers must not destabilize the protocol connection.
      }
      return;
    }

    if (message.type === 'resultBegin') {
      const totalChunks = message.totalChunks;
      if (pending.result || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_RESULT_CHUNKS) {
        settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
        return;
      }
      let metadata = null;
      if (pending.resultMode === 'youtubeCaptions') {
        const validKinds = ['manual', 'auto', 'translated'];
        if (message.engine !== 'youtube'
          || !isNonEmptyString(message.language) || message.language.length > 64
          || !isNonEmptyString(message.langDoc) || message.langDoc.length > 160
          || !validKinds.includes(message.captionKind)) {
          settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
          return;
        }
        metadata = {
          language: message.language,
          langDoc: message.langDoc,
          kind: message.captionKind
        };
      }
      pending.result = { totalChunks, chunks: new Map(), metadata };
      armRequestTimeout(message.requestId, pending);
      return;
    }

    if (message.type === 'resultChunk') {
      const result = pending.result;
      if (!result
        || message.totalChunks !== result.totalChunks
        || !Number.isInteger(message.sequence)
        || message.sequence < 0
        || message.sequence >= result.totalChunks
        || result.chunks.has(message.sequence)
        || !Array.isArray(message.cues)) {
        settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
        return;
      }
      if (!message.cues.every(isValidCue)) {
        settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
        return;
      }
      result.chunks.set(message.sequence, message.cues);
      armRequestTimeout(message.requestId, pending);
      return;
    }

    if (message.type === 'resultEnd') {
      const result = pending.result;
      const isComplete = result
        && message.totalChunks === result.totalChunks
        && Number.isInteger(message.cueCount)
        && message.cueCount > 0
        && result.chunks.size === result.totalChunks
        && Array.from({ length: result.totalChunks }, (_, sequence) => result.chunks.has(sequence)).every(Boolean);
      if (!isComplete) {
        settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
        return;
      }
      const cues = Array.from({ length: result.totalChunks }, (_, sequence) => result.chunks.get(sequence)).flat();
      if (cues.length !== message.cueCount || !cues.every(isValidCue) || !cues.some((cue) => cue.content.trim().length > 0)) {
        settleRequest(message.requestId, 'reject', makeError(null, 'RESULT_INCOMPLETE'));
        return;
      }
      settleRequest(message.requestId, 'resolve', pending.resultMode === 'youtubeCaptions'
        ? { cues, ...result.metadata }
        : cues);
    }
  }

  function getPort() {
    if (port) {
      clearIdleDisconnectTimer();
      return port;
    }
    try {
      const connectedPort = chrome.runtime.connectNative(HOST_NAME);
      port = connectedPort;
      connectedPort.onMessage.addListener(handleMessage);
      connectedPort.onDisconnect.addListener(() => handleDisconnect(connectedPort));
      return connectedPort;
    } catch (error) {
      throw makeError(error, 'NATIVE_HOST_NOT_INSTALLED');
    }
  }

  function sendRequest(type, payload = {}, options = {}) {
    let activePort;
    try {
      activePort = getPort();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = createRequestId();
    const message = { ...payload, type, requestId, protocolVersion: PROTOCOL_VERSION };
    return new Promise((resolve, reject) => {
      const pending = {
        resolve,
        reject,
        expectResult: Boolean(options.expectResult),
        resultMode: options.resultMode || 'cues',
        jobId: options.jobId,
        onProgress: options.onProgress,
        signal: options.signal,
        abortHandler: null,
        result: null,
        timeoutId: null,
        timeoutGeneration: 0,
        timeoutMs: options.timeoutMs || SHORT_REQUEST_TIMEOUT_MS
      };
      pendingRequests.set(requestId, pending);
      armRequestTimeout(requestId, pending);
      options.onPending?.(requestId, pending);
      try {
        activePort.postMessage(message);
      } catch (error) {
        settleRequest(requestId, 'reject', makeError(error, 'NATIVE_HOST_DISCONNECTED'));
      }
    });
  }

  function cancel(jobId) {
    if (!isNonEmptyString(jobId)) return Promise.reject(makeError(null, 'INVALID_REQUEST'));
    return sendRequest('cancel', { jobId });
  }

  /**
   * @param {import('../types/bse').NativeHostTranscriptionRequest} payload
   * @param {{ onProgress?: (progress: import('../types/bse').NativeHostProgress) => void, signal?: AbortSignal }} [options]
   */
  function transcribe(payload, { onProgress, signal } = {}) {
    const normalizedPayload = normalizeTranscriptionPayload(payload);
    if (!normalizedPayload) return Promise.reject(makeError(null, 'INVALID_REQUEST'));
    const { jobId } = normalizedPayload;
    if (signal?.aborted) return Promise.reject(makeError(null, 'CANCELLED'));

    return sendRequest('transcribe', normalizedPayload, {
      expectResult: true,
      jobId,
      onProgress,
      signal,
      timeoutMs: TRANSCRIPTION_INACTIVITY_TIMEOUT_MS,
      onPending: (requestId, pending) => {
        if (!signal) return;
        pending.abortHandler = () => {
          cancel(jobId).catch(() => {});
          settleRequest(requestId, 'reject', makeError(null, 'CANCELLED'));
        };
        signal.addEventListener('abort', pending.abortHandler, { once: true });
      }
    });
  }

  /**
   * @param {import('../types/bse').NativeHostYouTubeCaptionRequest} payload
   * @param {{ onProgress?: (progress: import('../types/bse').NativeHostProgress) => void, signal?: AbortSignal }} [options]
   */
  function fetchYouTubeCaptions(payload, { onProgress, signal } = {}) {
    const normalizedPayload = normalizeYouTubeCaptionPayload(payload);
    if (!normalizedPayload) return Promise.reject(makeError(null, 'INVALID_REQUEST'));
    const { jobId } = normalizedPayload;
    if (signal?.aborted) return Promise.reject(makeError(null, 'CANCELLED'));

    return sendRequest('youtubeCaptions', normalizedPayload, {
      expectResult: true,
      resultMode: 'youtubeCaptions',
      jobId,
      onProgress,
      signal,
      timeoutMs: TRANSCRIPTION_INACTIVITY_TIMEOUT_MS,
      onPending: (requestId, pending) => {
        if (!signal) return;
        pending.abortHandler = () => {
          cancel(jobId).catch(() => {});
          settleRequest(requestId, 'reject', makeError(null, 'CANCELLED'));
        };
        signal.addEventListener('abort', pending.abortHandler, { once: true });
      }
    });
  }

  function getCapabilities({ force = false } = {}) {
    if (!force && capabilities) return Promise.resolve(capabilities);
    return sendRequest('capabilities').then((result) => {
      capabilities = result;
      return result;
    });
  }

  function disconnect() {
    clearIdleDisconnectTimer();
    capabilities = null;
    if (!port) {
      rejectAll(makeError(null, 'NATIVE_HOST_DISCONNECTED'));
      return;
    }
    const activePort = port;
    port = null;
    rejectAll(makeError(null, 'NATIVE_HOST_DISCONNECTED'));
    activePort.disconnect();
  }

  BSE.NativeHost = Object.freeze({
    HOST_NAME,
    PROTOCOL_VERSION,
    getCapabilities,
    fetchYouTubeCaptions,
    transcribe,
    cancel,
    disconnect
  });
})();
