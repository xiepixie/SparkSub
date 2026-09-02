(() => {
  'use strict';

  const root = /** @type {any} */ (globalThis);
  const BSE = /** @type {any} */ (root.BSE = root.BSE || {});
  const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
  const SCOPES = Object.freeze(['media', 'queue', 'native', 'batch', 'tracker', 'ai', 'system']);
  const CONTEXT_KEYS = Object.freeze(['mediaKey', 'jobId', 'platform', 'tabId']);
  const LEVEL_WEIGHT = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3 });
  const SECRET_KEY = /^(?:accesstoken|refreshtoken|apikey|xapikey|auth|authorization|authtoken|authkey|cookie|setcookie|credential|key|secret|sig|sign|signature|token|upsig|wssecret)$/i;

  function isSecretKey(value) {
    let decoded = String(value || '');
    try { decoded = decodeURIComponent(decoded); } catch {}
    return SECRET_KEY.test(decoded.replace(/[^a-z0-9]/gi, ''));
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function redactUrl(raw) {
    try {
      const parsed = new URL(raw);
      parsed.username = '';
      parsed.password = '';
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (isSecretKey(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  function sanitizeText(value, options = {}) {
    const maxLength = Number.isFinite(Number(options.maxLength)) ? Math.max(1, Number(options.maxLength)) : 2000;
    let text = String(value ?? '');
    text = text.replace(/\b(?:Authorization|Proxy-Authorization|X[-_]?Api[-_]?Key|Api[-_]?Key|Auth[-_]?Token|Refresh[-_]?Token)\s*:\s*(?:Bearer|Basic)?\s*[^\s,;]+/gi, (match) => `${match.split(':')[0]}: [REDACTED]`);
    text = text.replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, (match) => `${match.split(':')[0]}: [REDACTED]`);
    text = text.replace(/\b(access[-_]?token|refresh[-_]?token|x[-_]?api[-_]?key|api[-_]?key|auth(?:orization)?|auth[-_]?token|auth[-_]?key|cookie|credential|secret|sig|sign|signature|token|upsig|wssecret)%3D[^&\s]+/gi, '$1%3D[REDACTED]');
    text = text.replace(/https?:\/\/[^\s<>'"）)]+/gi, (url) => redactUrl(url));
    text = text.replace(/\b(access[-_]?token|refresh[-_]?token|x[-_]?api[-_]?key|api[-_]?key|auth(?:orization)?|auth[-_]?token|auth[-_]?key|cookie|credential|secret|sig|sign|signature|token|upsig|wssecret)\s*[=:]\s*[^\s&,;]+/gi, '$1=[REDACTED]');
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
  }

  function sanitizeEndpoint(value) {
    try {
      const parsed = new URL(String(value || ''));
      if (!/^https?:$/.test(parsed.protocol)) return '不可用端点';
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '不可用端点';
    }
  }

  function sanitizeIdentifier(value) {
    return sanitizeText(value, { maxLength: 240 }).replace(/[\r\n\t]/g, ' ').trim() || 'default';
  }

  function normalizeCode(value) {
    const code = String(value || '')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return code.slice(0, 80) || 'DIAGNOSTIC_EVENT';
  }

  function legacyCode(stage) {
    const tail = String(stage || '').split('/').pop() || '';
    const ascii = normalizeCode(tail);
    return `LEGACY_${ascii === 'DIAGNOSTIC_EVENT' ? 'EVENT' : ascii}`;
  }

  function pickContext(context) {
    if (!context || typeof context !== 'object') return {};
    const out = {};
    for (const key of CONTEXT_KEYS) {
      if (context[key] === undefined || context[key] === null || context[key] === '') continue;
      out[key] = key === 'tabId' && Number.isFinite(Number(context[key]))
        ? Number(context[key])
        : sanitizeText(context[key], { maxLength: 240 });
    }
    return out;
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createEvent(input, now = () => new Date()) {
    const source = input && typeof input === 'object' ? input : { message: input };
    const level = LEVELS.includes(source.level) ? source.level : 'info';
    const scope = SCOPES.includes(source.scope) ? source.scope : 'system';
    const stage = sanitizeText(source.stage || '诊断', { maxLength: 120 });
    const message = sanitizeText(source.message || '');
    const sessionId = sanitizeIdentifier(source.sessionId || `${scope}:default`);
    const code = normalizeCode(source.code || legacyCode(stage));
    const suppliedTime = typeof source.timestamp === 'string' ? new Date(source.timestamp) : null;
    const timestamp = suppliedTime && Number.isFinite(suppliedTime.getTime())
      ? suppliedTime.toISOString()
      : now().toISOString();
    const context = pickContext(source.context);
    const id = sanitizeIdentifier(source.id || `${timestamp}-${simpleHash(`${scope}|${sessionId}|${code}|${stage}|${message}`)}`);
    return { id, timestamp, level, scope, code, stage, message, sessionId, context };
  }

  function classifyLegacy(stage, message) {
    const text = `${stage || ''} ${message || ''}`;
    if (/失败|异常|回退|降级|拦截|残缺|错配/i.test(text)) return 'warn';
    if (/HTTP|通道|挂载|BPX|缓存|环境信息|\bCID\b|探测\(/i.test(text)) return 'debug';
    return 'info';
  }

  function createLegacyReporter(emit, defaults = {}) {
    return (stage, message) => emit(createEvent({
      ...defaults,
      level: defaults.level || classifyLegacy(stage, message),
      code: defaults.code || legacyCode(stage),
      stage,
      message
    }, defaults.now));
  }

  function dedupeKey(event) {
    return [event.scope, event.sessionId, event.level, event.code, event.stage, event.message].join('\u001f');
  }

  function createStore(options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 500;
    const perSessionLimit = Number.isFinite(Number(options.perSessionLimit)) ? Math.max(1, Number(options.perSessionLimit)) : 100;
    const dedupeWindowMs = Number.isFinite(Number(options.dedupeWindowMs)) ? Math.max(0, Number(options.dedupeWindowMs)) : 1500;
    const now = typeof options.now === 'function' ? options.now : () => new Date();
    let collection = [];
    const lastSeen = new Map();

    function pruneLastSeen() {
      const retainedKeys = new Set(collection.map(dedupeKey));
      for (const key of Array.from(lastSeen.keys())) {
        if (!retainedKeys.has(key)) lastSeen.delete(key);
      }
    }

    function enforceLimits(event) {
      const same = collection.filter((item) => item.scope === event.scope && item.sessionId === event.sessionId);
      if (same.length > perSessionLimit) {
        const removeIds = new Set(same.slice(0, same.length - perSessionLimit).map((item) => item.id));
        collection = collection.filter((item) => !removeIds.has(item.id));
      }
      if (collection.length > limit) collection = collection.slice(collection.length - limit);
      pruneLastSeen();
    }

    return Object.freeze({
      append(input) {
        const event = createEvent(input, now);
        if (collection.some((item) => item.id === event.id)) return null;
        const key = dedupeKey(event);
        const observedAt = now().getTime();
        const previousAt = lastSeen.get(key);
        if (Number.isFinite(previousAt) && observedAt - previousAt <= dedupeWindowMs) return null;
        lastSeen.set(key, observedAt);
        collection.push(event);
        enforceLimits(event);
        return clone(event);
      },
      replaceSession(scope, sessionId) {
        collection = collection.filter((item) => item.scope !== scope || item.sessionId === sessionId);
        pruneLastSeen();
      },
      events(filter = {}) {
        const minWeight = filter.minLevel && LEVEL_WEIGHT[filter.minLevel] !== undefined ? LEVEL_WEIGHT[filter.minLevel] : -1;
        return clone(collection.filter((event) => (
          (!filter.scope || event.scope === filter.scope)
          && (!filter.sessionId || event.sessionId === filter.sessionId)
          && LEVEL_WEIGHT[event.level] >= minWeight
        )));
      },
      clear(filter = {}) {
        if (!filter.scope && !filter.sessionId) {
          collection = [];
          lastSeen.clear();
          return;
        }
        collection = collection.filter((event) => !(
          (!filter.scope || event.scope === filter.scope)
          && (!filter.sessionId || event.sessionId === filter.sessionId)
        ));
        lastSeen.clear();
      }
    });
  }

  function createFaultEvents(fault, defaults = {}) {
    const base = {
      scope: defaults.scope || 'media',
      sessionId: defaults.sessionId || 'media:default',
      context: defaults.context || {}
    };
    const code = normalizeCode(fault?.code || 'UNKNOWN_ERROR');
    return [
      createEvent({ ...base, level: 'error', code, stage: fault?.stage || '执行阶段', message: fault?.message || '未知错误' }, defaults.now),
      createEvent({ ...base, level: 'info', code: `${code}_HINT`, stage: '处理建议', message: fault?.hint || '请重试。' }, defaults.now)
    ];
  }

  function createMediaSession(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => new Date();
    const store = createStore({ limit: options.limit || 100, perSessionLimit: options.limit || 100, now });
    const platform = sanitizeIdentifier(options.platform || 'unknown');
    let mediaKey = '';
    let sessionId = '';

    function defaults() {
      return { scope: 'media', sessionId, context: { mediaKey, platform } };
    }

    return Object.freeze({
      begin(nextMediaKey) {
        const safeMediaKey = sanitizeIdentifier(nextMediaKey || 'unknown');
        if (safeMediaKey === mediaKey && sessionId) return sessionId;
        mediaKey = safeMediaKey;
        sessionId = `media:${mediaKey}:${now().getTime()}`;
        store.replaceSession('media', sessionId);
        return sessionId;
      },
      report(stage, message, overrides = {}) {
        if (!sessionId) this.begin(mediaKey || 'unknown');
        return store.append({
          ...defaults(),
          ...overrides,
          level: overrides.level || classifyLegacy(stage, message),
          code: overrides.code || legacyCode(stage),
          stage,
          message
        });
      },
      append(event) {
        if (!sessionId) this.begin(event?.context?.mediaKey || 'unknown');
        return store.append({ ...defaults(), ...(event || {}) });
      },
      recordFault(fault) {
        const appended = [];
        for (const event of createFaultEvents(fault, { ...defaults(), now })) {
          const result = store.append(event);
          if (result) appended.push(result);
        }
        return appended;
      },
      events() {
        return sessionId ? store.events({ scope: 'media', sessionId }) : [];
      },
      get sessionId() { return sessionId; },
      get mediaKey() { return mediaKey; }
    });
  }

  function formatEvent(input) {
    const event = createEvent(input, () => new Date());
    const instant = new Date(event.timestamp);
    const time = [instant.getHours(), instant.getMinutes(), instant.getSeconds()]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    return sanitizeText(`[${time}] [${event.scope}] [${event.level.toUpperCase()}] ${event.stage}：${event.message}`, { maxLength: 2600 });
  }

  BSE.Diagnostics = Object.freeze({
    LEVELS,
    SCOPES,
    createEvent,
    sanitizeText,
    sanitizeEndpoint,
    formatEvent,
    createStore,
    createLegacyReporter,
    createFaultEvents,
    createMediaSession,
    classifyLegacy
  });
})();
