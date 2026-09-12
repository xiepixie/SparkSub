(() => {
  'use strict';

  const BSE = globalThis.BSE;

  const HOST_NAME = 'com.sparksub.transcriber';
  const PROTOCOL_VERSION = 2;
  const LEGACY_PROTOCOL_VERSION = 1;
  const CONTRACT_ID = 'sparkscribe.browser-native/2';
  const MAX_MESSAGE_BYTES = 900 * 1024;
  const SHORT_REQUEST_TIMEOUT_MS = 30 * 1000;
  const TRANSCRIPTION_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
  const IDLE_DISCONNECT_TIMEOUT_MS = 250;
  const MAX_RESULT_CHUNKS = 10000;
  const MAX_ASR_TOPIC_CHARS = 80;
  const MAX_ASR_TERMS = 6;
  const MAX_ASR_TERM_CHARS = 24;
  const MAX_MEDIA_KEY_CHARS = 160;

  let port = null;
  let capabilities = null;
  let negotiatedProtocolVersion = null;
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
    PROTOCOL_MISMATCH: {
      message: 'The browser integration protocol is incompatible.',
      hint: 'Update SparkSub and SparkScribe, then retry.',
      retriable: false
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

  const LEGACY_EUROPEAN_LANGUAGES = Object.freeze([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'ro', 'nl', 'da', 'sv', 'fi', 'hu',
    'et', 'lv', 'lt', 'mt', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ru', 'uk',
    'be', 'bg', 'sr', 'el'
  ]);

  function normalizeCapabilities(result, protocolVersion) {
    if (!isObject(result)) throw makeError(null, 'RESULT_INCOMPLETE');

    if (protocolVersion === PROTOCOL_VERSION) {
      if (result.protocolVersion !== PROTOCOL_VERSION
        || result.contract !== CONTRACT_ID
        || !isObject(result.features)
        || !isObject(result.features.localASR)
        || !isObject(result.features.youtubeCaptions)
        || !isObject(result.features.remoteMedia)) {
        throw makeError(null, 'RESULT_INCOMPLETE');
      }
      const rawLanguages = result.features.localASR.languages;
      if (!Array.isArray(rawLanguages) || !rawLanguages.every(isNonEmptyString)) {
        throw makeError(null, 'RESULT_INCOMPLETE');
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        contract: CONTRACT_ID,
        features: {
          localASR: {
            available: result.features.localASR.available === true,
            supportsAutoLanguage: result.features.localASR.supportsAutoLanguage === true,
            languages: [...new Set(rawLanguages.map((value) => value.trim().toLowerCase()))]
          },
          youtubeCaptions: {
            available: result.features.youtubeCaptions.available === true,
            preferences: Array.isArray(result.features.youtubeCaptions.preferences)
              ? result.features.youtubeCaptions.preferences.filter(isNonEmptyString)
              : []
          },
          remoteMedia: {
            youtube: result.features.remoteMedia.youtube === true,
            bilibili: result.features.remoteMedia.bilibili === true
          },
          cancellation: { available: result.features.cancellation?.available === true },
          chunkedResults: {
            available: result.features.chunkedResults?.available === true,
            maxMessageBytes: Number.isInteger(result.features.chunkedResults?.maxMessageBytes)
              ? result.features.chunkedResults.maxMessageBytes
              : null
          }
        }
      };
    }

    const parakeetAvailable = result.models?.parakeet?.available === true;
    const cohereAvailable = result.models?.cohere?.available === true;
    const ytDLPAvailable = result.ytDLP?.available === true;
    const languages = [];
    if (parakeetAvailable) languages.push(...LEGACY_EUROPEAN_LANGUAGES);
    if (cohereAvailable) languages.push('zh');
    return {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      contract: null,
      features: {
        localASR: {
          available: parakeetAvailable || cohereAvailable,
          supportsAutoLanguage: parakeetAvailable || cohereAvailable,
          languages: [...new Set(languages)]
        },
        youtubeCaptions: {
          available: ytDLPAvailable,
          preferences: ['manual-first', 'manual-only', 'ai-first']
        },
        remoteMedia: {
          youtube: ytDLPAvailable,
          bilibili: true
        },
        cancellation: { available: true },
        chunkedResults: { available: true, maxMessageBytes: (900 * 1024) - 1 }
      }
    };
  }

  function normalizeASRContext(value) {
    if (value === undefined) return undefined;
    if (!hasOnlyKeys(value, ['topic', 'terms'])) return null;
    if (value.topic !== undefined && typeof value.topic !== 'string') return null;
    if (value.terms !== undefined && (!Array.isArray(value.terms) || !value.terms.every((item) => typeof item === 'string'))) return null;

    const clean = (raw, maxChars) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    const topic = clean(value.topic, MAX_ASR_TOPIC_CHARS);
    const seen = new Set();
    const terms = [];
    for (const raw of value.terms || []) {
      const term = clean(raw, MAX_ASR_TERM_CHARS);
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= MAX_ASR_TERMS) break;
    }
    return {
      ...(topic ? { topic } : {}),
      ...(terms.length ? { terms } : {})
    };
  }

  function isStringMap(value) {
    return hasOnlyKeys(value, Object.keys(value || {}))
      && Object.entries(value).every(([key, item]) => (
        typeof item === 'string' && !/(?:cookie|authorization)/i.test(key)
      ));
  }

  function normalizeTranscriptionPayload(payload) {
    const allowedTopLevelKeys = ['jobId', 'sourceLanguage', 'title', 'duration', 'platformLanguage', 'mediaKey', 'asrContext', 'source'];
    if (!hasOnlyKeys(payload, allowedTopLevelKeys)
      || !isNonEmptyString(payload.jobId)
      || !isNonEmptyString(payload.sourceLanguage)
      || !isObject(payload.source)) {
      return null;
    }
    if (payload.title !== undefined && typeof payload.title !== 'string') return null;
    if (payload.platformLanguage !== undefined && typeof payload.platformLanguage !== 'string') return null;
    if (payload.duration !== undefined && !Number.isFinite(payload.duration)) return null;
    const mediaKey = payload.mediaKey === undefined ? undefined : String(payload.mediaKey || '').trim();
    if (payload.mediaKey !== undefined && (!mediaKey || mediaKey.length > MAX_MEDIA_KEY_CHARS)) return null;
    const asrContext = normalizeASRContext(payload.asrContext);
    if (asrContext === null) return null;

    const source = payload.source;
    if (source.kind === 'youtube') {
      if (!hasOnlyKeys(source, ['kind', 'url']) || !isNonEmptyString(source.url)) return null;
      return {
        jobId: payload.jobId,
        sourceLanguage: payload.sourceLanguage,
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.duration === undefined ? {} : { duration: payload.duration }),
        ...(payload.platformLanguage === undefined ? {} : { platformLanguage: payload.platformLanguage }),
        ...(mediaKey === undefined ? {} : { mediaKey }),
        ...(asrContext === undefined || (!asrContext.topic && !asrContext.terms?.length) ? {} : { asrContext }),
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
      ...(mediaKey === undefined ? {} : { mediaKey }),
      ...(asrContext === undefined || (!asrContext.topic && !asrContext.terms?.length) ? {} : { asrContext }),
      source: {
        kind: 'remote',
        url: source.url,
        ...(source.backupUrls === undefined ? {} : { backupUrls: [...source.backupUrls] }),
        ...(source.headers === undefined ? {} : { headers: { ...source.headers } })
      }
    };
  }

  function normalizeYouTubeCaptionPayload(payload) {
    const preference = payload?.subtitlePreference;
    if (!hasOnlyKeys(payload, ['jobId', 'sourceLanguage', 'subtitlePreference', 'source'])
      || !isNonEmptyString(payload.jobId)
      || !isNonEmptyString(payload.sourceLanguage)
      || (preference !== undefined && !['manual-first', 'manual-only', 'ai-first'].includes(preference))
      || !hasOnlyKeys(payload.source, ['kind', 'url'])
      || payload.source.kind !== 'youtube'
      || !isNonEmptyString(payload.source.url)) {
      return null;
    }
    return {
      jobId: payload.jobId,
      sourceLanguage: payload.sourceLanguage,
      ...(preference === undefined ? {} : { subtitlePreference: preference }),
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

  function postBestEffortCancel(jobId, protocolVersion = negotiatedProtocolVersion || PROTOCOL_VERSION) {
    if (!port || !isNonEmptyString(jobId)) return;
    try {
      port.postMessage({
        type: 'cancel',
        requestId: createRequestId(),
        protocolVersion,
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
      if (pending.expectResult) postBestEffortCancel(pending.jobId, pending.protocolVersion);
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
    negotiatedProtocolVersion = null;
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
      pending.result = {
        totalChunks,
        chunks: new Map(),
        metadata,
        engine: isNonEmptyString(message.engine) ? message.engine.slice(0, 120) : null,
        engineLabel: isNonEmptyString(message.engineLabel) ? message.engineLabel.slice(0, 120) : null,
        mediaKey: isNonEmptyString(message.mediaKey) ? message.mediaKey.slice(0, MAX_MEDIA_KEY_CHARS) : null
      };
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
        : {
            cues,
            ...(result.engine ? { engine: result.engine } : {}),
            ...(result.engineLabel ? { engineLabel: result.engineLabel } : {}),
            ...(result.mediaKey ? { mediaKey: result.mediaKey } : {})
          });
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

  function sendRequestWithVersion(type, payload = {}, options = {}, protocolVersion = PROTOCOL_VERSION) {
    let activePort;
    try {
      activePort = getPort();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = createRequestId();
    const protocolPayload = protocolVersion === LEGACY_PROTOCOL_VERSION && type === 'transcribe'
      ? Object.fromEntries(Object.entries(payload).filter(([key]) => !['asrContext', 'mediaKey'].includes(key)))
      : payload;
    const message = { ...protocolPayload, type, requestId, protocolVersion };
    return new Promise((resolve, reject) => {
      const pending = {
        resolve,
        reject,
        expectResult: Boolean(options.expectResult),
        resultMode: options.resultMode || 'cues',
        jobId: options.jobId,
        protocolVersion,
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

  async function sendNegotiatedRequest(type, payload = {}, options = {}) {
    if (negotiatedProtocolVersion !== null) {
      return sendRequestWithVersion(type, payload, options, negotiatedProtocolVersion);
    }
    try {
      const result = await sendRequestWithVersion(type, payload, options, PROTOCOL_VERSION);
      negotiatedProtocolVersion = PROTOCOL_VERSION;
      return result;
    } catch (error) {
      if (error?.code !== 'PROTOCOL_MISMATCH') throw error;
      negotiatedProtocolVersion = LEGACY_PROTOCOL_VERSION;
      return sendRequestWithVersion(type, payload, options, LEGACY_PROTOCOL_VERSION);
    }
  }

  function ping() {
    return sendNegotiatedRequest('ping');
  }

  function cancel(jobId) {
    if (!isNonEmptyString(jobId)) return Promise.reject(makeError(null, 'INVALID_REQUEST'));
    return sendNegotiatedRequest('cancel', { jobId });
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

    return sendNegotiatedRequest('transcribe', normalizedPayload, {
      expectResult: true,
      jobId,
      onProgress,
      signal,
      timeoutMs: TRANSCRIPTION_INACTIVITY_TIMEOUT_MS,
      onPending: (requestId, pending) => {
        if (!signal) return;
        pending.abortHandler = () => {
          postBestEffortCancel(jobId, pending.protocolVersion);
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

    return sendNegotiatedRequest('youtubeCaptions', normalizedPayload, {
      expectResult: true,
      resultMode: 'youtubeCaptions',
      jobId,
      onProgress,
      signal,
      timeoutMs: TRANSCRIPTION_INACTIVITY_TIMEOUT_MS,
      onPending: (requestId, pending) => {
        if (!signal) return;
        pending.abortHandler = () => {
          postBestEffortCancel(jobId, pending.protocolVersion);
          settleRequest(requestId, 'reject', makeError(null, 'CANCELLED'));
        };
        signal.addEventListener('abort', pending.abortHandler, { once: true });
      }
    });
  }

  function getCapabilities({ force = false } = {}) {
    if (!force && capabilities) return Promise.resolve(capabilities);
    if (force) negotiatedProtocolVersion = null;
    return sendNegotiatedRequest('capabilities').then((result) => {
      capabilities = normalizeCapabilities(result, negotiatedProtocolVersion);
      return capabilities;
    });
  }

  function disconnect() {
    clearIdleDisconnectTimer();
    capabilities = null;
    negotiatedProtocolVersion = null;
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
    LEGACY_PROTOCOL_VERSION,
    CONTRACT_ID,
    getCapabilities,
    ping,
    fetchYouTubeCaptions,
    transcribe,
    cancel,
    disconnect
  });
})();
