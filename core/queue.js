(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE;

  const STORAGE_KEY_QUEUE = 'bse_transcription_queue_v1';
  const STORAGE_KEY_ITEM_PREFIX = `${STORAGE_KEY_QUEUE}:item:`;
  const STORAGE_KEY_PROJECTION_PREFIX = `${STORAGE_KEY_QUEUE}:projection:`;
  const STORAGE_KEY_INDEX = `${STORAGE_KEY_QUEUE}:index`;
  const STORAGE_KEY_SCHEMA = `${STORAGE_KEY_QUEUE}:schema`;
  const STORAGE_KEY_SUMMARY = `${STORAGE_KEY_QUEUE}:summary`;
  const QUEUE_STORAGE_SCHEMA_VERSION = 3;
  const STORAGE_KEY_SETTINGS = 'bse_queue_settings_v1';
  const LEASE_DURATION_MS = 5 * 60 * 1000;
  const EXECUTION_LEASE_MS = LEASE_DURATION_MS;
  const EXECUTOR_ID = `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ACTIVE_QUEUE_STAGES = new Set(['resolving', 'fetching_caption', 'fetching_audio', 'transcribing', 'postprocessing']);
  let nativeJobSequence = 0;
  let diagnosticReporter = null;

  function emitDiagnostic(event) {
    if (typeof diagnosticReporter === 'function') {
      diagnosticReporter(event);
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BSE_DIAGNOSTIC_APPEND', ...event }).catch(() => {});
    }
  }

  const DEFAULT_SETTINGS = {
    maxConcurrency: 2,
    autoDownload: false,
    preferredFormat: 'md',
    enableNotification: true,
    sourceLanguage: 'auto',
    enableLlmPolish: true,
    llmEndpoint: 'http://127.0.0.1:11434',
    llmModel: ''
  };
  const EPHEMERAL_MEDIA_KEYS = new Set([
    'audiocache', 'audiourl', 'backupurls', 'backupurl', 'backup_url',
    'mediaurl', 'streamurl', 'dashurl', 'dashaudio', 'mediadescriptor',
    'mediasource', 'remotesource', 'transientmedia', 'nativesource'
  ]);
  const CURATED_ERRORS = Object.freeze({
    ASR_LANGUAGE_UNSUPPORTED: { message: '当前本机字幕引擎不支持所选语言。', hint: '请使用平台字幕，或在 SparkScribe 中安装支持该语言的本地模型。', retriable: false },
    RESULT_INCOMPLETE: { message: '本机转录结果不完整。', hint: '请重试此任务。', retriable: true },
    NATIVE_HOST_NOT_INSTALLED: { message: '未检测到 SparkScribe 浏览器集成服务。', hint: '请安装或更新 SparkScribe 后重试。', retriable: false },
    NATIVE_HOST_DISCONNECTED: { message: '本机转录服务已断开。', hint: '请重新连接本机服务后重试。', retriable: true },
    NATIVE_HOST_TIMEOUT: { message: '本机转录服务响应超时。', hint: '请确认本机服务仍在运行后重试。', retriable: true },
    PROTOCOL_MISMATCH: { message: '浏览器集成服务协议不兼容。', hint: '请同时更新 SparkSub 与 SparkScribe。', retriable: false },
    PROTOCOL_MESSAGE_TOO_LARGE: { message: '本机转录服务返回的数据过大。', hint: '请重试；如持续发生请更新本机服务。', retriable: true },
    YTDLP_NOT_INSTALLED: { message: '未安装 YouTube 下载组件。', hint: '请完成本机服务安装后重试。', retriable: false },
    YTDLP_CHECKSUM_FAILED: { message: 'YouTube 下载组件校验失败。', hint: '请重新安装本机服务。', retriable: false },
    MEDIA_AUTH_REQUIRED: { message: '该媒体需要登录或访问权限。', hint: '目前仅支持公开可访问的视频。', retriable: false },
    MEDIA_DOWNLOAD_FAILED: { message: '媒体下载失败。', hint: '请确认视频公开可访问后重试。', retriable: true },
    MODEL_NOT_FOUND: { message: '未找到本机转录模型。', hint: '请安装受支持的本机模型后重试。', retriable: false },
    MODEL_LAYOUT_INCOMPATIBLE: { message: '本机转录模型布局不兼容。', hint: '请检查模型版本或重新安装模型。', retriable: false },
    ASR_FAILED: { message: '本地转录失败。', hint: '请检查本机转录服务后重试。', retriable: true },
    CANCELLED: { message: '转录已取消。', hint: '可在准备好后重新开始任务。', retriable: false },
    INVALID_REQUEST: { message: '本机转录请求无效。', hint: '请检查视频和转录设置后重试。', retriable: false },
    BUSY: { message: 'SparkScribe 正在处理另一项本机推理任务。', hint: '等待当前任务结束后重试。', retriable: true }
  });

  /**
   * 规范化视频 URL 与 ID
   * @param {string} rawUrl
   * @returns {{ platform: 'bilibili' | 'youtube', targetId: string, page?: number, cleanUrl: string } | null}
   */
  function normalizeVideoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const str = rawUrl.trim();

    // 1. Bilibili 识别
    const bvMatch = str.match(/BV[a-zA-Z0-9]{10}(?![a-zA-Z0-9])/i) || str.match(/BV[a-zA-Z0-9]+/i);
    const avMatch = str.match(/av\d+/i);
    if (bvMatch || avMatch || /bilibili\.com/i.test(str)) {
      const bvid = bvMatch ? bvMatch[0] : (avMatch ? avMatch[0] : '');
      if (!bvid) return null;
      let page = 1;
      const pMatch = str.match(/[?&]p=(\d+)|:p(\d+)/i);
      if (pMatch) page = parseInt(pMatch[1] || pMatch[2], 10) || 1;
      return {
        platform: 'bilibili',
        targetId: bvid,
        page,
        cleanUrl: `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`
      };
    }

    // 2. YouTube 识别
    const ytWatchMatch = str.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytWatchMatch) {
      const videoId = ytWatchMatch[1];
      return {
        platform: 'youtube',
        targetId: videoId,
        page: 1,
        cleanUrl: `https://www.youtube.com/watch?v=${videoId}`
      };
    }

    // 裸 11 位 YouTube ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
      return {
        platform: 'youtube',
        targetId: str,
        page: 1,
        cleanUrl: `https://www.youtube.com/watch?v=${str}`
      };
    }

    return null;
  }

  function normalizeExpectedMediaKey(parsed, value) {
    const mediaKey = String(value || '').trim();
    if (!parsed || !mediaKey) return '';
    if (parsed.platform === 'youtube') {
      return mediaKey === `yt:${parsed.targetId}` ? mediaKey : '';
    }
    if (parsed.platform === 'bilibili') {
      const match = mediaKey.match(/^bili:(BV[a-zA-Z0-9]+):(?:(cid[^:]+)|p(\d+))$/i);
      if (!match || match[1].toLowerCase() !== parsed.targetId.toLowerCase()) return '';
      if (match[3] && Number(match[3]) !== Number(parsed.page || 1)) return '';
      return mediaKey;
    }
    return '';
  }

  // === Pure-JS Lightweight MD5 for WBI Signing in Any Context ===
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

  function coreMd5(words, len) {
    words[len >> 5] |= 0x80 << (len % 32);
    words[(((len + 64) >>> 9) << 4) + 14] = len;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < words.length; i += 16) {
      const olda = a, oldb = b, oldc = c, oldd = d;
      a = md5ff(a, b, c, d, words[i], 7, -680876936);
      d = md5ff(d, a, b, c, words[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, words[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, words[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, words[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, words[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, words[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, words[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, words[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, words[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, words[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, words[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, words[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, words[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, words[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, words[i + 15], 22, 1236535329);
      a = md5gg(a, b, c, d, words[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, words[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, words[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, words[i], 20, -373897302);
      a = md5gg(a, b, c, d, words[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, words[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, words[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, words[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, words[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, words[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, words[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, words[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, words[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, words[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, words[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, words[i + 12], 20, -1926607734);
      a = md5hh(a, b, c, d, words[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, words[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, words[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, words[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, words[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, words[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, words[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, words[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, words[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, words[i], 11, -358537222);
      c = md5hh(c, d, a, b, words[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, words[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, words[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, words[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, words[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, words[i + 2], 23, -995338651);
      a = md5ii(a, b, c, d, words[i], 6, -198630844);
      d = md5ii(d, a, b, c, words[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, words[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, words[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, words[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, words[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, words[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, words[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, words[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, words[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, words[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, words[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, words[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, words[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, words[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, words[i + 9], 21, -343485551);
      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }

  function str2binl(str) {
    const bin = [];
    const mask = (1 << 8) - 1;
    for (let i = 0; i < str.length * 8; i += 8) {
      bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (i % 32);
    }
    return bin;
  }

  function binl2hex(binarray) {
    const hexTab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0x0f) +
             hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0x0f);
    }
    return str;
  }

  function md5(string) {
    if (!string) return '';
    return binl2hex(coreMd5(str2binl(string), string.length * 8));
  }

  const WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
  ];

  function getWbiMixinKey(orig) {
    let temp = '';
    WBI_MIXIN_KEY_ENC_TAB.forEach((n) => {
      temp += orig.charAt(n);
    });
    return temp.slice(0, 32);
  }

  function calculateWbiSign(params, imgKey, subKey) {
    const rawKey = (imgKey || '') + (subKey || '');
    const mixinKey = rawKey.length >= 64 ? getWbiMixinKey(rawKey) : 'ea1db124c00f4251a34b22f77ef58054';
    const currTime = Math.round(Date.now() / 1000);
    const newParams = { ...params, wts: currTime };

    const sortedKeys = Object.keys(newParams).sort();
    const queryList = [];
    for (const key of sortedKeys) {
      let val = String(newParams[key]);
      val = val.replace(/[!'()*]/g, '');
      queryList.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
    const queryString = queryList.join('&');
    const wbiSign = md5(queryString + mixinKey);
    return {
      query: `${queryString}&w_rid=${wbiSign}`,
      wts: currTime,
      w_rid: wbiSign
    };
  }

  function formatCuesToStructured(cues, title, author, url) {
    const normalizedCues = (cues || []).map((c) => ({
      from: Number(c.from || 0),
      to: Number(c.to || 0),
      content: String(c.content || '').trim()
    })).filter((c) => c.content);

    const plainText = normalizedCues.map((c) => c.content).join(' ');
    const mdLines = [
      `# ${title || '视频字幕'}`,
      '',
      `- **作者**：${author || '未知'}`,
      `- **来源**：${url || ''}`,
      `- **字幕总数**：${normalizedCues.length} 条`,
      '',
      '---',
      ''
    ];

    let currentPara = [];
    let lastTo = 0;
    for (const cue of normalizedCues) {
      if (currentPara.length && (cue.from - lastTo > 3.0 || currentPara.length >= 8)) {
        mdLines.push(currentPara.map((c) => c.content).join(' '));
        mdLines.push('');
        currentPara = [];
      }
      currentPara.push(cue);
      lastTo = cue.to;
    }
    if (currentPara.length) {
      mdLines.push(currentPara.map((c) => c.content).join(' '));
      mdLines.push('');
    }

    const srtLines = [];
    normalizedCues.forEach((cue, index) => {
      const formatTime = (seconds) => {
        const s = Math.max(0, seconds);
        const hrs = String(Math.floor(s / 3600)).padStart(2, '0');
        const mins = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const secs = String(Math.floor(s % 60)).padStart(2, '0');
        const ms = String(Math.floor((s % 1) * 1000)).padStart(3, '0');
        return `${hrs}:${mins}:${secs},${ms}`;
      };
      srtLines.push(String(index + 1));
      srtLines.push(`${formatTime(cue.from)} --> ${formatTime(cue.to)}`);
      srtLines.push(cue.content);
      srtLines.push('');
    });

    return {
      cueCount: normalizedCues.length,
      plainText,
      markdown: mdLines.join('\n'),
      srt: srtLines.join('\n'),
      cues: normalizedCues
    };
  }

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return chrome.storage.local;
    }
    return null;
  }

  function itemStorageKey(id) {
    return `${STORAGE_KEY_ITEM_PREFIX}${encodeURIComponent(id)}`;
  }

  function projectionStorageKey(id) {
    return `${STORAGE_KEY_PROJECTION_PREFIX}${encodeURIComponent(id)}`;
  }

  function projectionStorageKeyFromItemKey(key) {
    if (typeof key !== 'string' || !key.startsWith(STORAGE_KEY_ITEM_PREFIX)) return '';
    return `${STORAGE_KEY_PROJECTION_PREFIX}${key.slice(STORAGE_KEY_ITEM_PREFIX.length)}`;
  }

  function queueListProjection(item) {
    if (!item?.id) return null;
    const subtitle = item.subtitle && typeof item.subtitle === 'object'
      ? {
          language: String(item.subtitle.language || 'auto'),
          langDoc: String(item.subtitle.langDoc || item.subtitle.language || ''),
          cueCount: Math.max(0, Number(item.subtitle.cueCount) || (Array.isArray(item.subtitle.cues) ? item.subtitle.cues.length : 0)),
          ...(item.subtitle.source ? { source: item.subtitle.source } : {}),
          ...(item.subtitle.engine ? { engine: item.subtitle.engine } : {}),
          ...(item.subtitle.engineLabel ? { engineLabel: item.subtitle.engineLabel } : {}),
          ...(item.subtitle.captionKind ? { captionKind: item.subtitle.captionKind } : {})
        }
      : undefined;
    return {
      id: String(item.id),
      url: String(item.url || ''),
      platform: item.platform,
      targetId: String(item.targetId || item.id),
      title: String(item.title || ''),
      author: String(item.author || ''),
      cover: String(item.cover || ''),
      ...(item.duration != null ? { duration: item.duration } : {}),
      stage: String(item.stage || 'queued'),
      progress: Math.max(0, Math.min(100, Number(item.progress) || 0)),
      stageHint: String(item.stageHint || '').slice(0, 240),
      ...(item.error ? { error: String(item.error).slice(0, 240) } : {}),
      ...(item.errorCode ? { errorCode: String(item.errorCode).slice(0, 80) } : {}),
      ...(item.errorHint ? { errorHint: String(item.errorHint).slice(0, 240) } : {}),
      ...(typeof item.retriable === 'boolean' ? { retriable: item.retriable } : {}),
      ...(item.sourceLanguage ? { sourceLanguage: String(item.sourceLanguage) } : {}),
      ...(item.processingIntent ? { processingIntent: item.processingIntent } : {}),
      ...(Number.isFinite(Number(item.addedAt)) ? { addedAt: Number(item.addedAt) } : { addedAt: 0 }),
      ...(Number.isFinite(Number(item.completedAt)) ? { completedAt: Number(item.completedAt) } : {}),
      ...(subtitle ? { subtitle } : {})
    };
  }

  function normalizeQueueIndex(value) {
    if (!Array.isArray(value)) return null;
    return [...new Set(value.filter((key) => typeof key === 'string' && key.startsWith(STORAGE_KEY_ITEM_PREFIX)))];
  }

  const runtimeSubtitleProjectionCache = new Map();
  const MAX_RUNTIME_SUBTITLE_PROJECTIONS = 16;
  const MAX_RUNTIME_SUBTITLE_PROJECTION_CHARS = 6_000_000;
  let runtimeSubtitleProjectionChars = 0;

  function subtitleProjectionSignature(item) {
    const cues = item?.subtitle?.cues || [];
    if (!cues.length) return '';
    let textLength = 0;
    for (const cue of cues) textLength += String(cue?.content || '').length;
    const first = cues[0];
    const last = cues[cues.length - 1];
    return [
      item.completedAt || 0,
      cues.length,
      Number(first?.from || 0),
      Number(last?.to || 0),
      textLength
    ].join(':');
  }

  function hydrateQueueItemForRuntime(item) {
    if (!item || typeof item !== 'object' || !item.subtitle || !Array.isArray(item.subtitle.cues) || !item.subtitle.cues.length) {
      return item;
    }
    if (item.subtitle.plainText && item.subtitle.markdown && item.subtitle.srt) return item;

    const signature = subtitleProjectionSignature(item);
    const cached = runtimeSubtitleProjectionCache.get(item.id);
    let processed = cached?.signature === signature ? cached.processed : null;
    if (processed) {
      runtimeSubtitleProjectionCache.delete(item.id);
      runtimeSubtitleProjectionCache.set(item.id, cached);
    } else {
      const formatted = formatCuesToStructured(item.subtitle.cues, item.title, item.author, item.url);
      processed = {
        cueCount: formatted.cueCount,
        plainText: formatted.plainText,
        markdown: formatted.markdown,
        srt: formatted.srt
      };
      const cost = processed.plainText.length + processed.markdown.length + processed.srt.length;
      const previous = runtimeSubtitleProjectionCache.get(item.id);
      if (previous) {
        runtimeSubtitleProjectionChars -= previous.cost || 0;
        runtimeSubtitleProjectionCache.delete(item.id);
      }
      if (cost <= MAX_RUNTIME_SUBTITLE_PROJECTION_CHARS) {
        runtimeSubtitleProjectionCache.set(item.id, { signature, processed, cost });
        runtimeSubtitleProjectionChars += cost;
        while (
          runtimeSubtitleProjectionCache.size > MAX_RUNTIME_SUBTITLE_PROJECTIONS
          || runtimeSubtitleProjectionChars > MAX_RUNTIME_SUBTITLE_PROJECTION_CHARS
        ) {
          const oldestKey = runtimeSubtitleProjectionCache.keys().next().value;
          const oldest = runtimeSubtitleProjectionCache.get(oldestKey);
          runtimeSubtitleProjectionChars -= oldest?.cost || 0;
          runtimeSubtitleProjectionCache.delete(oldestKey);
        }
      }
    }
    return {
      ...item,
      subtitle: {
        ...item.subtitle,
        plainText: item.subtitle.plainText || processed.plainText,
        markdown: item.subtitle.markdown || processed.markdown,
        srt: item.subtitle.srt || processed.srt,
        cueCount: item.subtitle.cueCount || processed.cueCount
      }
    };
  }

  function sortQueue(items) {
    return items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  function queueSummary(items = []) {
    const list = Array.isArray(items) ? items : [];
    return {
      total: list.length,
      pending: list.reduce((sum, item) => sum + (!['done', 'failed'].includes(item?.stage) ? 1 : 0), 0),
      updatedAt: Date.now()
    };
  }

  async function readQueueFromStorage({ hydrateText = true } = {}) {
    const storage = getStorageArea();
    if (!storage) {
      const items = Object.values(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {});
      const sanitized = items.map(sanitizeQueueItemForPersistence);
      globalThis.__BSE_MEMORY_QUEUE_ITEMS__ = Object.fromEntries(sanitized.map((item) => [item.id, item]));
      return hydrateText ? sanitized.map(hydrateQueueItemForRuntime) : sanitized;
    }
    try {
      const meta = await storage.get([STORAGE_KEY_INDEX, STORAGE_KEY_QUEUE, STORAGE_KEY_SCHEMA]);
      let itemKeys = normalizeQueueIndex(meta?.[STORAGE_KEY_INDEX]);
      let sourceItems = [];
      let isLegacyArray = false;
      const needsIndexMigration = itemKeys === null;
      let indexNeedsRepair = false;

      if (itemKeys !== null) {
        if (itemKeys.length) {
          const itemRecords = await storage.get(itemKeys);
          sourceItems = itemKeys.map((key) => itemRecords?.[key]).filter((value) => value?.id);
          const survivingKeys = sourceItems.map((item) => itemStorageKey(item.id));
          if (survivingKeys.length !== itemKeys.length || survivingKeys.some((key, index) => key !== itemKeys[index])) {
            itemKeys = survivingKeys;
            indexNeedsRepair = true;
          }
        }
      } else if (Array.isArray(meta?.[STORAGE_KEY_QUEUE])) {
        isLegacyArray = true;
        sourceItems = meta[STORAGE_KEY_QUEUE];
      } else {
        // One-time migration path for installations created before the queue index existed.
        // Normal reads never scan unrelated extension storage (AI screenshots, tracker data, etc.).
        const all = await storage.get(null);
        const entries = Object.entries(all || {})
          .filter(([key, value]) => key.startsWith(STORAGE_KEY_ITEM_PREFIX) && value?.id);
        sourceItems = entries.map(([, value]) => value);
        itemKeys = entries.map(([key]) => key);
      }

      const needsSchemaMigration = Number(meta?.[STORAGE_KEY_SCHEMA] || 0) < QUEUE_STORAGE_SCHEMA_VERSION;
      let runtimeItems = sourceItems;
      if (isLegacyArray || needsIndexMigration || needsSchemaMigration) {
        // Sanitization can traverse large cue arrays. Gate it behind a persisted schema
        // version so ordinary reads stay proportional to the queue metadata we actually need.
        runtimeItems = sourceItems.map(sanitizeQueueItemForPersistence);
        const indexKeys = runtimeItems.map((item) => itemStorageKey(item.id));
        const values = {
          [STORAGE_KEY_INDEX]: indexKeys,
          [STORAGE_KEY_SCHEMA]: QUEUE_STORAGE_SCHEMA_VERSION,
          [STORAGE_KEY_SUMMARY]: queueSummary(runtimeItems)
        };
        runtimeItems.forEach((item) => {
          values[itemStorageKey(item.id)] = item;
          values[projectionStorageKey(item.id)] = queueListProjection(item);
        });
        await storage.set(values);
        if (isLegacyArray && storage.remove) await storage.remove(STORAGE_KEY_QUEUE);
      } else if (indexNeedsRepair) {
        await storage.set({ [STORAGE_KEY_INDEX]: itemKeys });
      }
      return hydrateText ? runtimeItems.map(hydrateQueueItemForRuntime) : runtimeItems;
    } catch {
      return [];
    }
  }

  async function readQueueProjectionFromStorage() {
    const storage = getStorageArea();
    if (!storage) {
      return Object.values(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {})
        .map(queueListProjection)
        .filter(Boolean);
    }

    const meta = await storage.get([STORAGE_KEY_INDEX, STORAGE_KEY_QUEUE, STORAGE_KEY_SCHEMA]);
    const itemKeys = normalizeQueueIndex(meta?.[STORAGE_KEY_INDEX]);
    const schemaVersion = Number(meta?.[STORAGE_KEY_SCHEMA] || 0);
    const requiresMigration = itemKeys === null
      || schemaVersion < QUEUE_STORAGE_SCHEMA_VERSION
      || Array.isArray(meta?.[STORAGE_KEY_QUEUE]);

    if (requiresMigration) {
      // v1/v2 stored no list projection. Pay the full-item read exactly once,
      // persist v3 item projections in the same migration write, and only expose
      // lightweight records to list consumers afterwards.
      const migratedItems = await readQueueFromStorage({ hydrateText: false });
      return migratedItems.map(queueListProjection).filter(Boolean);
    }

    if (!itemKeys.length) return [];
    const projectionKeys = itemKeys.map(projectionStorageKeyFromItemKey);
    const records = await storage.get(projectionKeys);
    const projections = [];
    const missingItemKeys = [];

    for (let index = 0; index < itemKeys.length; index += 1) {
      const itemKey = itemKeys[index];
      const projectionKey = projectionKeys[index];
      const rawProjection = records?.[projectionKey];
      const projection = queueListProjection(rawProjection);
      if (projection?.id) {
        projections.push(projection);
      } else {
        missingItemKeys.push(itemKey);
      }
    }

    if (missingItemKeys.length) {
      // Self-heal isolated projection loss without rereading healthy completed
      // items. This path is exceptional; normal v3 list reads never touch item records.
      const missingItems = await storage.get(missingItemKeys);
      const repairValues = {};
      const deadItemKeys = [];
      for (const itemKey of missingItemKeys) {
        const item = missingItems?.[itemKey];
        const projection = queueListProjection(item);
        if (!projection?.id) {
          deadItemKeys.push(itemKey);
          continue;
        }
        projections.push(projection);
        repairValues[projectionStorageKey(projection.id)] = projection;
      }
      if (deadItemKeys.length) {
        const deadSet = new Set(deadItemKeys);
        repairValues[STORAGE_KEY_INDEX] = itemKeys.filter((itemKey) => !deadSet.has(itemKey));
        repairValues[STORAGE_KEY_SUMMARY] = queueSummary(projections);
      }
      if (Object.keys(repairValues).length) await storage.set(repairValues);
    }

    return projections;
  }

  function safeClone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (typeof globalThis.structuredClone === 'function') {
      try { return globalThis.structuredClone(obj); } catch {}
    }
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch {}
    }
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {}
    return Array.isArray(obj) ? [...obj] : { ...obj };
  }

  async function writeItems(items, replace = false, fullQueue = null) {
    const snapshots = (items || []).map(sanitizeQueueItemForPersistence);
    const summary = Array.isArray(fullQueue) ? queueSummary(fullQueue) : null;
    const storage = getStorageArea();
    if (!storage) {
      const next = replace ? {} : { ...(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {}) };
      snapshots.forEach((item) => { next[item.id] = item; });
      globalThis.__BSE_MEMORY_QUEUE_ITEMS__ = next;
      globalThis.__BSE_MEMORY_QUEUE_SUMMARY__ = summary || queueSummary(Object.values(next));
      return;
    }

    const meta = await storage.get([STORAGE_KEY_INDEX, STORAGE_KEY_QUEUE, STORAGE_KEY_SCHEMA]);
    const oldKeys = normalizeQueueIndex(meta?.[STORAGE_KEY_INDEX]) || [];
    const values = {};
    const writtenKeys = snapshots.map((item) => itemStorageKey(item.id));
    snapshots.forEach((item) => {
      values[itemStorageKey(item.id)] = item;
      values[projectionStorageKey(item.id)] = queueListProjection(item);
    });

    const nextKeys = replace
      ? writtenKeys
      : [...writtenKeys, ...oldKeys.filter((key) => !values[key])];
    const schemaIsCurrent = Number(meta?.[STORAGE_KEY_SCHEMA] || 0) >= QUEUE_STORAGE_SCHEMA_VERSION;
    const indexChanged = replace
      || writtenKeys.some((key) => !oldKeys.includes(key))
      || !schemaIsCurrent;
    if (indexChanged) values[STORAGE_KEY_INDEX] = nextKeys;
    if (!schemaIsCurrent) values[STORAGE_KEY_SCHEMA] = QUEUE_STORAGE_SCHEMA_VERSION;
    if (summary) values[STORAGE_KEY_SUMMARY] = summary;

    const removed = replace ? oldKeys.filter((key) => !values[key]) : [];
    if (removed.length && storage.remove) {
      await storage.remove([
        ...removed,
        ...removed.map(projectionStorageKeyFromItemKey).filter(Boolean)
      ]);
    }
    await storage.set(values);
    // Remove the old whole-array representation after migration without scanning unrelated storage.
    if (storage.remove && Array.isArray(meta?.[STORAGE_KEY_QUEUE])) {
      await storage.remove(STORAGE_KEY_QUEUE);
    }
  }

  async function removeQueueItemsByIds(ids, remainingQueueProjection = []) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))];
    if (!uniqueIds.length) return 0;
    const storage = getStorageArea();
    if (!storage) {
      const next = { ...(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {}) };
      let removed = 0;
      for (const id of uniqueIds) {
        if (next[id]) {
          delete next[id];
          removed += 1;
        }
      }
      globalThis.__BSE_MEMORY_QUEUE_ITEMS__ = next;
      globalThis.__BSE_MEMORY_QUEUE_SUMMARY__ = queueSummary(remainingQueueProjection);
      return removed;
    }

    const removeItemKeys = uniqueIds.map(itemStorageKey);
    const nextKeys = (remainingQueueProjection || [])
      .map((item) => itemStorageKey(item?.id))
      .filter(Boolean);
    const values = {
      [STORAGE_KEY_INDEX]: nextKeys,
      [STORAGE_KEY_SCHEMA]: QUEUE_STORAGE_SCHEMA_VERSION,
      [STORAGE_KEY_SUMMARY]: queueSummary(remainingQueueProjection)
    };
    // Publish the smaller authoritative index first. If cleanup is interrupted,
    // stale unindexed records are harmless; the inverse order can leave dangling index entries.
    await storage.set(values);
    if (storage.remove) {
      await storage.remove([
        ...removeItemKeys,
        ...uniqueIds.map(projectionStorageKey)
      ]);
    }
    return uniqueIds.length;
  }

  async function readQueueItemsByIds(ids) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const storage = getStorageArea();
    if (!storage) {
      return uniqueIds
        .map((id) => globalThis.__BSE_MEMORY_QUEUE_ITEMS__?.[id])
        .filter((item) => item?.id);
    }
    const keys = uniqueIds.map(itemStorageKey);
    const records = await storage.get(keys.length === 1 ? keys[0] : keys).catch(() => ({}));
    return keys.map((key) => records?.[key]).filter((item) => item?.id);
  }

  // Every queue mutation in this context enters the same serial tail. Most v3
  // mutations use projections or targeted item records; the full-queue variant
  // remains only for compatibility paths that genuinely require every item body.
  let mutationTail = Promise.resolve();
  function serializeQueueOperation(operation) {
    const queued = mutationTail.then(operation);
    mutationTail = queued.catch(() => {});
    return queued;
  }

  function serializeQueueMutation(mutator) {
    return serializeQueueOperation(async () => {
      const queue = sortQueue(await readQueueFromStorage({ hydrateText: false }));
      return mutator(queue);
    });
  }

  function serializeQueueProjectionMutation(mutator) {
    return serializeQueueOperation(async () => {
      const queue = sortQueue(await readQueueProjectionFromStorage());
      return mutator(queue);
    });
  }

  async function getQueue({ hydrateText = true } = {}) {
    await mutationTail;
    return sortQueue(await readQueueFromStorage({ hydrateText }));
  }

  async function getQueueProjection() {
    await mutationTail;
    return sortQueue(await readQueueProjectionFromStorage());
  }

  async function getQueueSummary() {
    await mutationTail;
    const storage = getStorageArea();
    if (!storage) {
      return globalThis.__BSE_MEMORY_QUEUE_SUMMARY__
        || queueSummary(Object.values(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {}));
    }
    const result = await storage.get(STORAGE_KEY_SUMMARY).catch(() => ({}));
    const stored = result?.[STORAGE_KEY_SUMMARY];
    const total = Number(stored?.total);
    const pending = Number(stored?.pending);
    if (Number.isInteger(total) && total >= 0 && Number.isInteger(pending) && pending >= 0 && pending <= total) {
      return { total, pending, updatedAt: Number(stored?.updatedAt) || 0 };
    }

    // One-time compatibility fallback for installations created before the summary projection.
    const queue = await getQueueProjection();
    const summary = queueSummary(queue);
    await storage.set({ [STORAGE_KEY_SUMMARY]: summary }).catch(() => {});
    return summary;
  }

  async function saveQueue(items) {
    return serializeQueueOperation(async () => {
      await writeItems(items, true, items);
      return items;
    });
  }

  function validQueueSummary(value) {
    const total = Number(value?.total);
    const pending = Number(value?.pending);
    return Number.isInteger(total) && total >= 0
      && Number.isInteger(pending) && pending >= 0 && pending <= total;
  }

  async function trySaveItemTargeted(itemSnapshot) {
    const storage = getStorageArea();
    if (!storage || !itemSnapshot?.id) return null;
    const key = itemStorageKey(itemSnapshot.id);
    const nextTerminal = itemSnapshot.stage === 'done' || itemSnapshot.stage === 'failed';
    const lookupKeys = nextTerminal
      ? [key, STORAGE_KEY_SCHEMA, STORAGE_KEY_SUMMARY]
      : [key, STORAGE_KEY_SCHEMA];
    const stored = await storage.get(lookupKeys).catch(() => null);
    if (!stored || Number(stored?.[STORAGE_KEY_SCHEMA] || 0) < QUEUE_STORAGE_SCHEMA_VERSION) return null;
    const current = stored[key];
    if (!current?.id) return null;
    const currentTerminal = current.stage === 'done' || current.stage === 'failed';
    // A stale non-terminal snapshot must never resurrect a completed/failed item.
    // Explicit retries use retryItem(), which updates the summary from projections.
    if (currentTerminal && !nextTerminal) return false;
    if (itemSnapshot.leaseOwner && current.leaseOwner !== itemSnapshot.leaseOwner) return false;

    if (itemSnapshot.leaseOwner && !nextTerminal) {
      itemSnapshot.leaseExpiresAt = Date.now() + LEASE_DURATION_MS;
    } else if (itemSnapshot.stage === 'done' || itemSnapshot.stage === 'failed') {
      delete itemSnapshot.leaseOwner;
      delete itemSnapshot.leaseExpiresAt;
    }

    const transitionChangesPending = currentTerminal !== nextTerminal;
    const storedSummary = stored?.[STORAGE_KEY_SUMMARY];
    if (transitionChangesPending && !validQueueSummary(storedSummary)) return null;

    const persisted = sanitizeQueueItemForPersistence(itemSnapshot);
    const values = {
      [key]: persisted,
      [projectionStorageKey(itemSnapshot.id)]: queueListProjection(persisted)
    };
    if (transitionChangesPending) {
      const delta = nextTerminal ? -1 : 1;
      values[STORAGE_KEY_SUMMARY] = {
        total: Number(storedSummary.total),
        pending: Math.max(0, Math.min(Number(storedSummary.total), Number(storedSummary.pending) + delta)),
        updatedAt: Date.now()
      };
    }
    await storage.set(values);
    return true;
  }

  async function saveItem(updatedItem) {
    const itemSnapshot = safeClone(updatedItem);
    const fastOperation = mutationTail.then(() => trySaveItemTargeted(itemSnapshot));
    mutationTail = fastOperation.catch(() => {});
    const fastResult = await fastOperation;
    if (fastResult !== null) {
      if (fastResult) broadcastQueueUpdate(itemSnapshot);
      return fastResult;
    }

    const success = await serializeQueueMutation(async (queue) => {
      const index = queue.findIndex((i) => i.id === itemSnapshot.id);
      if (index >= 0) {
        // A stale executor must never overwrite the state (or lease) of the
        // executor which currently owns this item.
        const current = queue[index];
        if (itemSnapshot.leaseOwner && current.leaseOwner !== itemSnapshot.leaseOwner) return false;
        if (itemSnapshot.leaseOwner && itemSnapshot.stage !== 'done' && itemSnapshot.stage !== 'failed') {
          itemSnapshot.leaseExpiresAt = Date.now() + LEASE_DURATION_MS;
        } else if (itemSnapshot.stage === 'done' || itemSnapshot.stage === 'failed') {
          delete itemSnapshot.leaseOwner;
          delete itemSnapshot.leaseExpiresAt;
        }
        queue[index] = itemSnapshot;
        await writeItems([itemSnapshot], false, queue);
        return true;
      }
      return false;
    });
    if (success) {
      broadcastQueueUpdate(itemSnapshot);
    }
    return success;
  }

  async function enterStage(item, stage, progress, stageHint) {
    const now = Date.now();
    item.stage = stage;
    item.progress = progress;
    item.stageHint = stageHint;
    item.stageUpdatedAt = now;
    item.executionLease = {
      owner: item.executionLease?.owner || `queue-${item.id}`,
      acquiredAt: item.executionLease?.acquiredAt || now,
      expiresAt: now + EXECUTION_LEASE_MS
    };
    await saveItem(item);
  }

  function safeUserHint(value, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && !/(?:https?:\/\/|(?:upsig|sign|token|deadline|wssecret|wstime|auth_key)\s*(?:=|%3d))/i.test(text)
      ? text.slice(0, 240)
      : fallback;
  }

  function isRemoteMediaDescriptor(value) {
    return value && typeof value === 'object' && value.kind === 'remote'
      && typeof value.url === 'string';
  }

  function isBilibiliMediaUrl(value) {
    return typeof value === 'string'
      && /https?:\/\/[^\s]*(?:bilivideo\.com|bilivideo\.cn|hdslb\.com|hdslb\.net|biliapi\.net)/i.test(value);
  }

  function hasSigningFragment(value) {
    return typeof value === 'string' && /(?:upsig|sign|token|deadline|wssecret|wstime|auth_key)\s*(?:=|%3d)/i.test(value);
  }

  function isCaptionContentPath(path) {
    return path.some((key) => /^(?:captiontext|captionbody|cues|subtitle)$/i.test(key));
  }

  function isAllowedCaptionOrCanonicalUrl(path, key) {
    return (path.length === 1 && (key === 'url' || key === 'cover'))
      || path.some((part) => /^captiontracks$/i.test(part));
  }

  function isRemoteMediaShape(value) {
    return value && typeof value === 'object'
      && typeof value.url === 'string'
      && isBilibiliMediaUrl(value.url)
      && (Array.isArray(value.backupUrls) || value.headers && typeof value.headers === 'object');
  }

  function sanitizePersistedValue(value, parentKey = '', path = []) {
    if (Array.isArray(value)) return value.map((item) => sanitizePersistedValue(item, parentKey, path));
    if (typeof value === 'string') {
      const allowed = isCaptionContentPath(path) || isAllowedCaptionOrCanonicalUrl(path, parentKey);
      return !allowed && (isBilibiliMediaUrl(value) || hasSigningFragment(value))
        ? ''
        : value;
    }
    if (!value || typeof value !== 'object') return value;
    if (isRemoteMediaDescriptor(value) || isRemoteMediaShape(value)) return undefined;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (EPHEMERAL_MEDIA_KEYS.has(normalizedKey)) continue;
      if (isRemoteMediaDescriptor(child) || isRemoteMediaShape(child)) continue;
      if (normalizedKey === 'source' && child?.kind === 'remote') continue;
      if (normalizedKey === 'baseurl' && /(?:audio|dash|stream|media)/i.test(parentKey)) continue;
      const sanitizedChild = sanitizePersistedValue(child, key, [...path, key]);
      if (sanitizedChild !== undefined) result[key] = sanitizedChild;
    }
    return result;
  }

  function sanitizeQueueItemForPersistence(item) {
    const sanitized = sanitizePersistedValue(safeClone(item));
    const fallback = CURATED_ERRORS[sanitized.errorCode] || CURATED_ERRORS.ASR_FAILED;
    sanitized.stageHint = safeUserHint(sanitized.stageHint, sanitized.stage === 'failed' ? `失败：${fallback.message}` : '正在处理任务…');
    if (sanitized.stage === 'failed') {
      sanitized.error = fallback.message;
      sanitized.errorHint = fallback.hint;
      sanitized.retriable = fallback.retriable;
    }
    if (sanitized.stage === 'done') {
      // Persist one canonical subtitle representation. Text/Markdown/SRT are deterministic
      // projections of cues and are hydrated on read, avoiding 3-4x storage duplication.
      if (sanitized.subtitle && Array.isArray(sanitized.subtitle.cues) && sanitized.subtitle.cues.length) {
        delete sanitized.subtitle.plainText;
        delete sanitized.subtitle.markdown;
        delete sanitized.subtitle.srt;
      }
      delete sanitized.stageArtifacts;
      delete sanitized.metaCache;
      delete sanitized.executionLease;
      delete sanitized.leaseOwner;
      delete sanitized.leaseExpiresAt;
    }
    return sanitized;
  }

  function resetForRetry(item, stageHint = '重新排队中…') {
    item.stage = 'queued';
    item.progress = 0;
    item.stageHint = stageHint;
    for (const key of [
      'error', 'errorCode', 'errorHint', 'retriable', 'subtitle', 'completedAt',
      'startedAt', 'stageUpdatedAt', 'leaseOwner', 'leaseExpiresAt', 'executionLease',
      'audioCache', 'transientMedia', 'mediaDescriptor', 'mediaSource', 'nativeSource'
    ]) delete item[key];
    item.stageArtifacts = {};
    item.metaCache = {};
    return item;
  }

  function classifyCaptionTrack(track) {
    const text = [track?.lan, track?.languageCode, track?.lan_doc, track?.name?.simpleText, track?.id, track?.vssId, track?.kind]
      .filter(Boolean).join(' ').toLowerCase();
    if (track?.isTranslated || track?.translated || track?.translationLanguage || /(?:translated|translation|翻译|tlang=)/i.test(`${text} ${track?.baseUrl || ''}`)) return 2;
    if (track?.isAuto || track?.is_auto || track?.isASR || /^a\./i.test(track?.vssId || '') || /(?:auto-generated|automatic|自动生成|自动字幕|ai字幕|\basr\b|^ai-)/i.test(text)) return 1;
    return 0;
  }

  function captionLanguageRank(track, sourceLanguage) {
    const code = String(track?.lan || track?.languageCode || '').trim().toLowerCase().replace(/_/g, '-');
    const label = String(track?.lan_doc || track?.name?.simpleText || '').trim().toLowerCase();
    const requested = String(sourceLanguage || 'auto').trim().toLowerCase().replace(/_/g, '-');
    if (requested !== 'auto') {
      if (isCantoneseLanguage(requested)) {
        if (isCantoneseLanguage(code) || /(?:cantonese|粤|粵)/i.test(label)) return 0;
      } else if (code === requested || code.startsWith(`${requested}-`)) {
        return 0;
      }
    }
    if (/^(?:zh|yue)(?:-|$)/.test(code) || /(?:chinese|中文|粤|粵)/i.test(label)) return 1;
    if (/^en(?:-|$)/.test(code) || /\benglish\b/i.test(label)) return 2;
    return 3;
  }

  function rankCaptionTracks(tracks, sourceLanguage) {
    return (tracks || []).map((track, index) => ({ track, index, kind: classifyCaptionTrack(track) }))
      .sort((left, right) => (
        left.kind - right.kind
        || captionLanguageRank(left.track, sourceLanguage) - captionLanguageRank(right.track, sourceLanguage)
        || left.index - right.index
      ))
      .map(({ track }) => track);
  }

  function formatEngineLabel(engine, engineLabel) {
    if (engine === 'youtube' || engine === 'bilibili' || engine === 'platform') return '官方字幕';
    const supplied = typeof engineLabel === 'string' ? engineLabel.trim() : '';
    if (supplied) return supplied.length > 42 ? `${supplied.slice(0, 42)}…` : supplied;
    return '端侧 ASR';
  }

  const YOUTUBE_TRANSCRIPT_FALLBACK_ID = 'youtube-native-transcript';

  function isTranscriptFallbackTrack(track) {
    return track?.isTranscriptFallback === true;
  }

  function createTranscriptFallbackTrack() {
    return {
      id: YOUTUBE_TRANSCRIPT_FALLBACK_ID,
      languageCode: 'auto',
      name: { simpleText: 'YouTube 原生 Transcript' },
      isTranscriptFallback: true
    };
  }

  function captionTrackIdentity(track) {
    if (isTranscriptFallbackTrack(track)) return YOUTUBE_TRANSCRIPT_FALLBACK_ID;
    const language = String(track?.lan || track?.languageCode || '').toLowerCase();
    const label = String(track?.lan_doc || track?.name?.simpleText || '').trim().toLowerCase();
    const stableId = track?.id_str || track?.id || track?.vssId || `${language}:${classifyCaptionTrack(track)}:${label}`;
    return String(stableId);
  }

  function captionTrackMetadata(track) {
    if (isTranscriptFallbackTrack(track)) {
      return {
        id: YOUTUBE_TRANSCRIPT_FALLBACK_ID,
        language: 'auto',
        langDoc: 'YouTube 原生 Transcript',
        kind: 3,
        captionKind: 'transcript',
        isTranscriptFallback: true
      };
    }
    const kind = classifyCaptionTrack(track);
    return {
      id: captionTrackIdentity(track),
      language: track?.lan || track?.languageCode || 'auto',
      langDoc: track?.lan_doc || track?.name?.simpleText || track?.lan || track?.languageCode || '平台字幕',
      kind,
      captionKind: track?.captionKind || ['manual', 'auto', 'translated'][kind] || 'manual'
    };
  }

  function isCompleteCue(cue) {
    return cue
      && Number.isFinite(Number(cue.from))
      && Number.isFinite(Number(cue.to))
      && Number(cue.to) > Number(cue.from)
      && typeof cue.content === 'string'
      && cue.content.trim().length > 0;
  }

  function normalizeCompleteCues(cues) {
    if (!Array.isArray(cues) || !cues.length || !cues.every(isCompleteCue)) return [];
    const normalized = BSE.Parsers.normalize(cues);
    if (!normalized.length || !normalized.every(isCompleteCue)) return [];
    return normalized.map((cue) => ({
      from: Number(cue.from),
      to: Number(cue.to),
      content: cue.content.trim()
    }));
  }

  function isCantoneseLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase().replace(/_/g, '-');
    return ['yue', 'zh-hk', 'zh-yue', 'zh-hant-hk'].includes(normalized) || normalized.startsWith('yue-');
  }

  function nativeError(code, message, hint, retriable = true) {
    const error = /** @type {import('../types/bse').NativeHostError} */ (new Error(message));
    error.code = code;
    error.hint = safeUserHint(hint, '请重试此任务。');
    error.retriable = retriable;
    return error;
  }

  function nextNativeJobId(item, operation) {
    nativeJobSequence += 1;
    return `${item.id}:${operation}:${EXECUTOR_ID}:${nativeJobSequence}`;
  }

  function setCompletedSubtitle(item, cues, details) {
    const completeCues = normalizeCompleteCues(cues);
    if (!completeCues.length) {
      throw nativeError('RESULT_INCOMPLETE', '字幕结果不完整。', '未收到有效且非空的字幕内容。');
    }
    item.subtitle = {
      language: details.language || 'auto',
      langDoc: details.langDoc || details.language || '自动识别',
      source: details.source,
      engine: details.engine,
      ...(details.engineLabel ? { engineLabel: details.engineLabel } : {}),
      ...(details.captionKind ? { captionKind: details.captionKind } : {}),
      cueCount: completeCues.length,
      cues: completeCues
    };
    delete item.error;
    delete item.errorCode;
    delete item.errorHint;
    delete item.retriable;
  }

  async function transcribeWithNativeHost(item, source, signal) {
    if (!BSE.NativeHost?.transcribe || !BSE.NativeHost?.getCapabilities) {
      throw nativeError('NATIVE_HOST_NOT_INSTALLED', '未检测到可用的本机转录服务。', '请安装或更新 SparkScribe 后重试。', false);
    }

    let writeTail = Promise.resolve();
    let lastPersisted = { stage: '', progress: -1, at: 0 };
    const onProgress = (event) => {
      const nativeStage = String(event?.stage || '').toLowerCase();
      const stage = /fetch|download|audio/.test(nativeStage) ? 'fetching_audio' : 'transcribing';
      const minimum = stage === 'fetching_audio' ? 50 : 70;
      const maximum = stage === 'fetching_audio' ? 70 : 95;
      const value = Number(event?.percent);
      const progress = Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
      const now = Date.now();
      item.stage = stage;
      item.progress = progress;
      item.stageHint = safeUserHint(event?.hint, stage === 'fetching_audio' ? '正在准备音频…' : '正在本地转录…');
      item.stageUpdatedAt = now;
      item.leaseExpiresAt = now + LEASE_DURATION_MS;
      item.executionLease = {
        owner: item.executionLease?.owner || EXECUTOR_ID,
        acquiredAt: item.executionLease?.acquiredAt || now,
        expiresAt: now + EXECUTION_LEASE_MS
      };
      const meaningful = lastPersisted.stage !== stage || now - lastPersisted.at >= 1000;
      if (!meaningful) return writeTail;
      lastPersisted = { stage, progress, at: now };
      const snapshot = safeClone(item);
      writeTail = writeTail.then(() => saveItem(snapshot));
      return writeTail;
    };

    let result;
    let expectedNativeMediaKey = '';
    let requireNativeMediaEcho = false;
    try {
      const titleText = item.title || item.metaCache?.title || '';
      const chineseMatches = titleText.match(/[\u4e00-\u9fa5]/g);
      const hasChineseTitle = Boolean(chineseMatches && chineseMatches.length >= 2);
      const inferredLang = item.platform === 'bilibili' || hasChineseTitle ? 'zh' : null;
      const effectiveSourceLanguage = (item.sourceLanguage && item.sourceLanguage !== 'auto')
        ? item.sourceLanguage
        : (inferredLang || 'auto');
      const capabilities = await BSE.NativeHost.getCapabilities();
      requireNativeMediaEcho = Number(capabilities?.protocolVersion) === 2;
      const canTranscribe = BSE.LanguageRouting?.localASRSupport
        ? BSE.LanguageRouting.localASRSupport(capabilities, effectiveSourceLanguage, inferredLang)
        : capabilities?.features?.localASR?.available === true;
      if (!canTranscribe) {
        throw nativeError(
          'ASR_LANGUAGE_UNSUPPORTED',
          '当前本机字幕引擎不支持所选语言。',
          '请使用平台字幕，或在 SparkScribe 中安装支持该语言的本地模型。',
          false
        );
      }

      const asrContext = BSE.MediaContext?.buildASRContext?.(item.mediaContext || null) || {};
      const jobId = nextNativeJobId(item, 'asr');
      const mediaKey = String(item.mediaContext?.mediaKey || item.expectedMediaKey || '').trim();
      expectedNativeMediaKey = mediaKey;
      const contextTopic = asrContext.topic || '—';
      const contextTerms = Array.isArray(asrContext.terms) && asrContext.terms.length ? asrContext.terms.join(', ') : '—';
      emitDiagnostic({
        scope: 'queue',
        sessionId: String(item.id || 'queue:active'),
        level: 'debug',
        code: 'NATIVE_ASR_REQUEST',
        stage: '本地转录输入',
        message: `media=${mediaKey || 'unknown'} · source=${source?.kind || 'unknown'} · language=${effectiveSourceLanguage} · duration=${Number.isFinite(Number(item.duration)) ? `${Number(item.duration)}s` : '?'} · topic=${contextTopic} · terms=${contextTerms}`,
        context: { mediaKey, jobId, platform: item.platform || 'unknown' }
      });
      result = await BSE.NativeHost.transcribe({
        jobId,
        sourceLanguage: effectiveSourceLanguage,
        ...(inferredLang ? { platformLanguage: inferredLang } : {}),
        ...(mediaKey ? { mediaKey } : {}),
        title: item.title,
        ...(Number.isFinite(Number(item.duration)) ? { duration: Number(item.duration) } : {}),
        ...(asrContext.topic || asrContext.terms?.length ? { asrContext } : {}),
        source
      }, { onProgress, signal });
      emitDiagnostic({
        scope: 'queue',
        sessionId: String(item.id || 'queue:active'),
        level: 'debug',
        code: 'NATIVE_ASR_RESULT',
        stage: '本地转录结果',
        message: `job=${jobId} · engine=${result?.engineLabel || result?.engine || 'local-asr'} · cues=${Array.isArray(result?.cues) ? result.cues.length : 0}`,
        context: { mediaKey, jobId, platform: item.platform || 'unknown' }
      });
    } finally {
      await writeTail;
    }

    const returnedMediaKey = String(result?.mediaKey || '').trim();
    if (expectedNativeMediaKey && returnedMediaKey && returnedMediaKey !== expectedNativeMediaKey) {
      throw nativeError(
        'RESULT_INCOMPLETE',
        'SparkScribe 返回了其他视频的转录结果。',
        '已阻止跨视频字幕写入；请在当前视频重新发起本机转录。',
        true
      );
    }
    if (expectedNativeMediaKey && requireNativeMediaEcho && !returnedMediaKey) {
      throw nativeError(
        'RESULT_INCOMPLETE',
        'SparkScribe 未返回媒体身份确认。',
        '已阻止无法证明属于当前视频的转录结果；请更新 SparkScribe 后重试。',
        true
      );
    }

    const cues = normalizeCompleteCues(result?.cues);
    if (!cues.length) {
      throw nativeError('RESULT_INCOMPLETE', '本机转录结果不完整。', '本机服务没有返回有效的字幕内容。');
    }
    return {
      cues,
      engine: result?.engine || 'local-asr',
      engineLabel: result?.engineLabel || '端侧 ASR'
    };
  }

  async function polishCuesIfEnabled(item, transcript, signal) {
    const cues = Array.isArray(transcript?.cues) ? transcript.cues : [];
    if (!cues.length) return transcript;
    const settings = await getSettings();
    if (settings.enableLlmPolish === false || !BSE.AsrPolisher?.polishCues) {
      return transcript;
    }
    const endpoint = settings.llmEndpoint || BSE.AsrPolisher.DEFAULT_ENDPOINT;
    const originalEngine = transcript?.engine || 'local-asr';
    const originalEngineLabel = transcript?.engineLabel || '端侧 ASR';
    try {
      const polishResult = await BSE.AsrPolisher.polishCues(cues, {
        title: item.title,
        mediaContext: item.mediaContext,
        endpoint,
        model: settings.llmModel || '',
        onDiagnostic: (stage, message) => {
          item.stageHint = message;
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'BSE_DIAGNOSTIC_APPEND',
              stage,
              message
            }).catch(() => {});
          }
        },
        signal
      });
      if (Array.isArray(polishResult.cues) && polishResult.cues.length) {
        return {
          cues: polishResult.cues,
          engine: originalEngine,
          engineLabel: polishResult.modelUsed ? `${originalEngineLabel} + ${polishResult.modelUsed}` : originalEngineLabel
        };
      }
    } catch {}
    return transcript;
  }

  async function fetchYouTubeCaptionsWithNativeHost(item, source, signal) {
    if (!BSE.NativeHost?.fetchYouTubeCaptions) return null;

    let writeTail = Promise.resolve();
    let lastPersistedAt = 0;
    const onProgress = (event) => {
      const now = Date.now();
      item.stage = 'fetching_caption';
      item.progress = Math.max(45, Math.min(70, Number.isFinite(Number(event?.percent)) ? Number(event.percent) : 55));
      item.stageHint = safeUserHint(event?.hint, '正在通过本机服务读取 YouTube 原生字幕…');
      item.stageUpdatedAt = now;
      item.leaseExpiresAt = now + LEASE_DURATION_MS;
      item.executionLease = {
        owner: item.executionLease?.owner || EXECUTOR_ID,
        acquiredAt: item.executionLease?.acquiredAt || now,
        expiresAt: now + EXECUTION_LEASE_MS
      };
      if (now - lastPersistedAt < 1000) return writeTail;
      lastPersistedAt = now;
      const snapshot = safeClone(item);
      writeTail = writeTail.then(() => saveItem(snapshot));
      return writeTail;
    };

    let result;
    try {
      result = await BSE.NativeHost.fetchYouTubeCaptions({
        jobId: nextNativeJobId(item, 'youtube-captions'),
        sourceLanguage: item.sourceLanguage || 'auto',
        source
      }, { onProgress, signal });
    } catch (error) {
      if (signal?.aborted || error?.code === 'CANCELLED' || error?.name === 'AbortError') throw error;
      if (error?.code !== 'CAPTIONS_NOT_FOUND') {
        emitDiagnostic({
          scope: 'queue',
          sessionId: String(item.id || 'queue:active'),
          level: 'warn',
          code: 'NATIVE_CAPTION_FALLBACK',
          stage: '本机字幕回退',
          message: `${error?.code || 'NATIVE_CAPTION_ERROR'} · ${safeUserHint(error?.message, '本机字幕不可用')}`,
          context: { jobId: String(item.id || '') }
        });
      }
      return null;
    } finally {
      await writeTail;
    }

    const cues = normalizeCompleteCues(result?.cues);
    if (!cues.length
      || typeof result?.language !== 'string' || !result.language.trim()
      || typeof result?.langDoc !== 'string' || !result.langDoc.trim()
      || !['manual', 'auto', 'translated'].includes(result?.kind)) {
      return null;
    }
    return {
      cues,
      track: {
        id: `native-youtube:${result.kind}:${result.language}`,
        languageCode: result.language,
        name: { simpleText: result.langDoc },
        ...(result.kind === 'auto' ? { isAuto: true, vssId: `a.${result.language}` } : {}),
        ...(result.kind === 'translated' ? { isTranslated: true } : {}),
        captionKind: result.kind
      }
    };
  }

  function finishExecution(item) {
    item.stageUpdatedAt = Date.now();
    delete item.executionLease;
  }

  async function getItem(id) {
    await mutationTail;
    const targetId = String(id || '');
    if (!targetId) return null;
    const storage = getStorageArea();
    if (!storage) {
      const item = globalThis.__BSE_MEMORY_QUEUE_ITEMS__?.[targetId] || null;
      return item ? hydrateQueueItemForRuntime(item) : null;
    }

    const key = itemStorageKey(targetId);
    const stored = await storage.get([key, STORAGE_KEY_SCHEMA]).catch(() => ({}));
    if (Number(stored?.[STORAGE_KEY_SCHEMA] || 0) < QUEUE_STORAGE_SCHEMA_VERSION) {
      // Complete the one-time v1/v2 projection migration before serving details.
      const migratedItems = await readQueueFromStorage({ hydrateText: false });
      const migratedItem = migratedItems.find((item) => String(item.id) === targetId) || null;
      return migratedItem ? hydrateQueueItemForRuntime(migratedItem) : null;
    }
    const item = stored?.[key] || null;
    return item ? hydrateQueueItemForRuntime(item) : null;
  }

  async function getSettings() {
    const storage = getStorageArea();
    if (!storage) return { ...DEFAULT_SETTINGS };
    try {
      const res = await storage.get(STORAGE_KEY_SETTINGS);
      return { ...DEFAULT_SETTINGS, ...(res?.[STORAGE_KEY_SETTINGS] || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = { ...current, ...partial };
    const storage = getStorageArea();
    if (storage) {
      try {
        await storage.set({ [STORAGE_KEY_SETTINGS]: next });
      } catch {}
    }
    return next;
  }

  /**
   * 阶段级异常自愈（Stage-based Recovery）
   * 检测因浏览器关闭/崩溃而停留在中间态的任务，平滑重置为可继续执行的状态
   */
  async function recoverStaleJobsInternal(returnFullQueue = false) {
    const recoveredCandidates = await serializeQueueProjectionMutation(async (queueProjection) => {
      const runningStages = ['resolving', 'fetching_caption', 'fetching_audio', 'transcribing', 'postprocessing'];
      const candidateIds = queueProjection
        .filter((item) => runningStages.includes(item.stage) || item.stage === 'queued')
        .map((item) => item.id);
      const candidates = await readQueueItemsByIds(candidateIds);
      const changed = [];
      const now = Date.now();

      for (const item of candidates) {
        const leaseExpiresAt = item.leaseExpiresAt ?? item.executionLease?.expiresAt ?? 0;
        const isLeaseActive = leaseExpiresAt > now;
        if (runningStages.includes(item.stage) && !isLeaseActive) {
          const previousStage = item.stage;
          item.stage = 'queued';
          item.stageHint = `自动恢复：从 ${previousStage} 阶段继续`;
          item.progress = Math.max(0, (item.progress || 0) - 10);
          delete item.leaseOwner;
          delete item.leaseExpiresAt;
          delete item.executionLease;
          changed.push(item);
        } else if (item.stage === 'queued' && (item.leaseOwner || item.executionLease) && !isLeaseActive) {
          delete item.leaseOwner;
          delete item.leaseExpiresAt;
          delete item.executionLease;
          changed.push(item);
        }
      }
      if (changed.length) await writeItems(changed, false, null);
      if (changed.length) broadcastQueueUpdate();
      return candidates;
    });
    if (!returnFullQueue) return recoveredCandidates;
    return getQueue({ hydrateText: false });
  }

  async function recoverStaleJobs() {
    return recoverStaleJobsInternal(true);
  }

  /**
   * 添加单个或批量视频到后台转录队列
   * @param {string | import('../types/bse').QueueInput | Array<string | import('../types/bse').QueueInput>} urlsOrIds
   * @param {{ title?: string, author?: string, cover?: string, sourceLanguage?: string, processingIntent?: 'auto' | 'local-asr' }} [options]
   * @returns {Promise<Array<import('../types/bse').QueueItem>>}
   */
  async function addToQueue(urlsOrIds, options = {}) {
    const rawList = Array.isArray(urlsOrIds) ? urlsOrIds : [urlsOrIds];
    const addedItems = [];
    const settings = await getSettings();
    await serializeQueueProjectionMutation(async (queueProjection) => {
      const projectionById = new Map(queueProjection.map((item) => [item.id, item]));
      const workingItemsById = new Map();
      const itemsToWrite = new Map();
      for (const raw of rawList) {
        const rawString = typeof raw === 'object' && raw ? (raw.url || raw.targetId || raw.cleanUrl || '') : String(raw || '');
        const opt = typeof raw === 'object' && raw ? { ...options, ...raw } : options;
        const parsed = normalizeVideoUrl(rawString);
        if (!parsed) continue;

        const itemId = parsed.platform === 'bilibili' && parsed.page && parsed.page > 1
          ? `${parsed.targetId}:p${parsed.page}`
          : parsed.targetId;
        const suppliedMediaKey = String(opt.mediaKey || '').trim();
        const expectedMediaKey = normalizeExpectedMediaKey(parsed, suppliedMediaKey);
        const processingIntent = opt.processingIntent === 'local-asr' ? 'local-asr' : 'auto';
        const localBilibiliIdentityIsCoarse = processingIntent === 'local-asr'
          && parsed.platform === 'bilibili'
          && Boolean(expectedMediaKey)
          && !/^bili:BV[a-zA-Z0-9]+:cid[^:]+$/i.test(expectedMediaKey);
        const localIntentMissingIdentity = processingIntent === 'local-asr' && !expectedMediaKey;
        if ((suppliedMediaKey && !expectedMediaKey) || localBilibiliIdentityIsCoarse || localIntentMissingIdentity) {
          throw nativeError(
            'INVALID_REQUEST',
            '页面视频身份正在切换，未加入离线转录。',
            parsed.platform === 'bilibili'
              ? '请等待当前视频的 BVID/CID 加载稳定后重新点击离线转录。'
              : '请等待当前视频 ID 加载稳定后重新点击离线转录。',
            true
          );
        }

        let existing = workingItemsById.get(itemId) || null;
        if (!existing && projectionById.has(itemId)) {
          existing = (await readQueueItemsByIds([itemId]))[0] || null;
          if (existing) workingItemsById.set(itemId, existing);
        }
        if (existing) {
          const identityChanged = Boolean(expectedMediaKey)
            && Boolean(existing.expectedMediaKey)
            && existing.expectedMediaKey !== expectedMediaKey;
          const existingIntent = existing.processingIntent === 'local-asr' ? 'local-asr' : 'auto';
          const intentChanged = existingIntent !== processingIntent;
          const explicitLocalRerun = processingIntent === 'local-asr' && existing.stage === 'done';
          const intentRequiresReset = intentChanged && existing.stage !== 'done';
          const isActive = ACTIVE_QUEUE_STAGES.has(existing.stage);
          if (isActive && expectedMediaKey && existing.expectedMediaKey !== expectedMediaKey) {
            throw nativeError(
              'BUSY',
              '当前视频已有另一条媒体身份不一致的任务正在运行。',
              '已阻止复用旧任务；请等待或移除旧任务后，再对当前视频发起离线转录。',
              true
            );
          }
          // Same queue ID with a different page/media identity is not reusable.
          // Explicit local ASR also means "run ASR now", not "return an older
          // platform-caption result". Never mutate the policy of an in-flight job.
          if (!isActive && (existing.stage === 'failed' || identityChanged || intentRequiresReset || explicitLocalRerun)) {
            resetForRetry(existing, identityChanged ? '视频身份已更新，重新解析中…' : '重新排队中…');
            if (typeof opt.sourceLanguage === 'string' && opt.sourceLanguage.trim()) {
              existing.sourceLanguage = opt.sourceLanguage.trim();
            }
            existing.processingIntent = processingIntent;
          }
          if (!isActive && expectedMediaKey) existing.expectedMediaKey = expectedMediaKey;
          if (!isActive) {
            existing.page = parsed.page || existing.page || 1;
            existing.url = parsed.cleanUrl;
          }
          workingItemsById.set(itemId, existing);
          itemsToWrite.set(itemId, existing);
          projectionById.set(itemId, queueListProjection(existing));
          addedItems.push(existing);
          continue;
        }

        /** @type {import('../types/bse').QueueItem} */
        const newItem = {
          id: itemId,
          url: parsed.cleanUrl,
          platform: parsed.platform,
          targetId: parsed.targetId,
          title: opt.title || `${parsed.platform === 'bilibili' ? 'B站视频' : 'YouTube 视频'} (${itemId})`,
          author: opt.author || (parsed.platform === 'bilibili' ? 'UP主' : 'YouTube 频道'),
          cover: opt.cover || '',
          stage: 'queued',
          progress: 0,
          stageHint: '排队中…',
          sourceLanguage: typeof opt.sourceLanguage === 'string' && opt.sourceLanguage.trim()
            ? opt.sourceLanguage.trim()
            : (settings.sourceLanguage || 'auto'),
          processingIntent,
          page: parsed.page || 1,
          ...(expectedMediaKey ? { expectedMediaKey } : {}),
          addedAt: Date.now(),
          metaCache: {
            title: opt.title,
            author: opt.author,
            cover: opt.cover
          }
        };

        workingItemsById.set(itemId, newItem);
        itemsToWrite.set(itemId, newItem);
        projectionById.set(itemId, queueListProjection(newItem));
        addedItems.push(newItem);
      }
      if (itemsToWrite.size > 0) {
        await writeItems([...itemsToWrite.values()], false, [...projectionById.values()]);
      }
    });
    if (addedItems.length > 0) {
      broadcastQueueUpdate();
      notifyOrchestrator();
    }

    return addedItems;
  }

  async function removeFromQueue(id) {
    cancelInFlight(id);
    const removed = await serializeQueueProjectionMutation(async (queueProjection) => {
      const targetId = String(id || '');
      if (!queueProjection.some((item) => item.id === targetId)) return false;
      const nextQueue = queueProjection.filter((item) => item.id !== targetId);
      return (await removeQueueItemsByIds([targetId], nextQueue)) > 0;
    });
    if (removed) {
      broadcastQueueUpdate();
      return true;
    }
    return false;
  }

  async function clearCompleted() {
    const removedCount = await serializeQueueProjectionMutation(async (queueProjection) => {
      const completedIds = queueProjection.filter((item) => item.stage === 'done').map((item) => item.id);
      if (!completedIds.length) return 0;
      const nextQueue = queueProjection.filter((item) => item.stage !== 'done');
      return removeQueueItemsByIds(completedIds, nextQueue);
    });
    if (removedCount > 0) {
      broadcastQueueUpdate();
    }
    return removedCount;
  }

  async function clearAll() {
    cancelAllInFlight();
    await serializeQueueProjectionMutation(async (queueProjection) => {
      if (!queueProjection.length) return;
      await removeQueueItemsByIds(queueProjection.map((item) => item.id), []);
    });
    broadcastQueueUpdate();
  }

  async function retryItem(id) {
    cancelInFlight(id);
    const item = await serializeQueueProjectionMutation(async (queueProjection) => {
      const targetId = String(id || '');
      const projectionIndex = queueProjection.findIndex((entry) => entry.id === targetId);
      if (projectionIndex < 0) return null;
      const target = (await readQueueItemsByIds([targetId]))[0] || null;
      if (!target) return null;
      resetForRetry(target);
      const nextProjection = [...queueProjection];
      nextProjection[projectionIndex] = queueListProjection(target);
      await writeItems([target], false, nextProjection);
      return target;
    });
    if (!item) return null;
    broadcastQueueUpdate();
    notifyOrchestrator();
    return item;
  }

  function queueUpdateProjection(item) {
    if (!item?.id) return null;
    return {
      id: String(item.id),
      stage: String(item.stage || 'queued'),
      progress: Math.max(0, Math.min(100, Number(item.progress) || 0)),
      stageHint: String(item.stageHint || '').slice(0, 240)
    };
  }

  function broadcastQueueUpdate(item = null) {
    const projection = queueUpdateProjection(item);
    const message = projection
      ? { type: 'BSE_QUEUE_UPDATED', item: projection }
      : { type: 'BSE_QUEUE_UPDATED' };
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://*.bilibili.com/*'] }).then((tabs) => {
        for (const tab of tabs) {
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }

  function notifyOrchestrator() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
    }
  }

  /**
   * 格式化多条已完成字幕为合并 Markdown
   * @param {string[]} [itemIds]
   * @returns {Promise<string>}
   */
  async function exportQueueMergedMarkdown(itemIds) {
    const projection = await getQueueProjection();
    const requestedIds = itemIds && itemIds.length ? new Set(itemIds.map(String)) : null;
    const targetIds = projection
      .filter((item) => item.stage === 'done' && (!requestedIds || requestedIds.has(String(item.id))))
      .map((item) => item.id);
    const selectedItems = await readQueueItemsByIds(targetIds);
    const targetItems = selectedItems
      .filter((item) => item.stage === 'done' && (item.subtitle?.cues?.length || item.subtitle?.plainText || item.subtitle?.markdown))
      .map((item) => hydrateQueueItemForRuntime(item));

    if (!targetItems.length) return '';

    const lines = [
      '# SparkSub 离线视频转录合集',
      '',
      `> 导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${targetItems.length} 个视频`,
      '',
      '---',
      '',
      '## 目录导航',
      ''
    ];

    targetItems.forEach((item, idx) => {
      const safeAnchor = encodeURIComponent(item.title.replace(/\s+/g, '-'));
      lines.push(`${idx + 1}. [${item.title}](#${safeAnchor}) - *${item.author || '未知作者'}* (${item.subtitle?.cueCount || 0} 句)`);
    });

    lines.push('', '---', '');

    targetItems.forEach((item, idx) => {
      lines.push(`## ${idx + 1}. ${item.title}`);
      lines.push('');
      lines.push(`- **来源平台**：${item.platform === 'bilibili' ? '哔哩哔哩 (Bilibili)' : 'YouTube'}`);
      lines.push(`- **作者/UP主**：${item.author || '未知'}`);
      lines.push(`- **视频链接**：[${item.url}](${item.url})`);
      lines.push(`- **转录语言**：${item.subtitle?.langDoc || item.subtitle?.language || '默认'}`);
      lines.push(`- **字幕总数**：${item.subtitle?.cueCount || 0} 句`);
      lines.push('');
      lines.push('### 转录文本');
      lines.push('');
      if (item.subtitle?.markdown) {
        lines.push(item.subtitle.markdown);
      } else {
        lines.push(item.subtitle?.plainText || '');
      }
      lines.push('', '---', '');
    });

    return lines.join('\n');
  }

  // Active in-flight controllers Map
  const inFlightControllers = new Map();
  let isProcessingJobs = false;

  function cancelInFlight(id) {
    const controller = inFlightControllers.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  function cancelAllInFlight() {
    for (const controller of inFlightControllers.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
  }

  async function fetchBilibiliNavKeys(signal) {
    try {
      const resp = await BSE.Utils.fetchWithTimeout(
        'https://api.bilibili.com/x/web-interface/nav',
        { signal, credentials: 'include' },
        6000
      );
      const json = await resp.json();
      const wbiImg = json?.data?.wbi_img;
      if (wbiImg?.img_url && wbiImg?.sub_url) {
        const imgKey = wbiImg.img_url.slice(wbiImg.img_url.lastIndexOf('/') + 1, wbiImg.img_url.lastIndexOf('.'));
        const subKey = wbiImg.sub_url.slice(wbiImg.sub_url.lastIndexOf('/') + 1, wbiImg.sub_url.lastIndexOf('.'));
        return { imgKey, subKey };
      }
    } catch {}
    return {
      imgKey: '7cd084941338484a827105e933682852',
      subKey: '492b161900b24a499386610d69174dd4'
    };
  }

  function parseBilibiliMediaKey(mediaKey) {
    const value = String(mediaKey || '').trim();
    const match = value.match(/^bili:(BV[a-zA-Z0-9]+):cid([^:]+)$/i);
    if (!match) return null;
    return { bvid: match[1], cid: match[2] };
  }

  function bilibiliMediaKey(bvid, cid) {
    return `bili:${bvid}:cid${cid}`;
  }

  function sameBilibiliIdentity(left, right) {
    if (!left || !right) return false;
    return left.bvid.toLowerCase() === right.bvid.toLowerCase()
      && String(left.cid) === String(right.cid);
  }

  async function resolveBilibiliAudioSource(item, bvid, cid, signal) {
    await enterStage(item, 'fetching_audio', 60, '正在准备当前视频音频并校验媒体身份…');
    const playUrlResp = await BSE.Utils.fetchWithTimeout(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=4048`,
      { signal, credentials: 'include' },
      6000
    );
    const playJson = await playUrlResp.json();
    if (playJson?.code !== 0 || !playJson?.data) {
      throw nativeError('MEDIA_DOWNLOAD_FAILED', '无法获取当前 Bilibili 视频的音频流。', '请确认视频公开可访问后重试。');
    }
    const responseBvid = String(playJson?.data?.bvid || '');
    const responseCid = playJson?.data?.cid;
    if ((responseBvid && responseBvid.toLowerCase() !== bvid.toLowerCase())
      || (responseCid != null && String(responseCid) !== String(cid))) {
      throw nativeError('INVALID_REQUEST', 'Bilibili 音频身份校验失败。', '为避免转录到其他视频，已停止任务；请在当前视频重新点击离线转录。', true);
    }
    const knownDuration = Number(item.duration || item.metaCache?.duration || 0);
    const playDuration = Number(playJson?.data?.dash?.duration || 0)
      || (Number(playJson?.data?.timelength || 0) > 0 ? Number(playJson.data.timelength) / 1000 : 0);
    if (knownDuration > 10 && playDuration > 0) {
      const tolerance = Math.max(8, knownDuration * 0.10);
      if (Math.abs(playDuration - knownDuration) > tolerance) {
        throw nativeError('INVALID_REQUEST', 'Bilibili 音频时长与目标视频不一致。', '为避免串台，已停止本次转录；请刷新当前视频后重试。', true);
      }
    }
    const source = BSE.Media?.selectBilibiliAudio(playJson?.data?.dash?.audio || []);
    if (!source) {
      throw nativeError('MEDIA_DOWNLOAD_FAILED', '无法获取可用的 Bilibili 音频流。', '请确认视频公开可访问后重试。');
    }
    return source;
  }

  async function finishNativeTranscription(item, source, signal) {
    let nativeTranscript = await transcribeWithNativeHost(item, source, signal);
    await enterStage(item, 'postprocessing', 95, '正在进行端侧大模型语义纠错与时间轴整理…');
    nativeTranscript = await polishCuesIfEnabled(item, nativeTranscript, signal);
    const cues = nativeTranscript.cues;
    setCompletedSubtitle(item, cues, {
      language: item.sourceLanguage || 'auto',
      langDoc: '本地自动转录',
      source: 'native',
      engine: nativeTranscript.engine || 'local-asr',
      engineLabel: nativeTranscript.engineLabel || '端侧 ASR'
    });
    item.stage = 'done';
    item.progress = 100;
    const engineLabel = formatEngineLabel(item.subtitle?.engine, item.subtitle?.engineLabel);
    item.stageHint = `完成 · 引擎: ${engineLabel} · 共 ${item.subtitle.cueCount} 句字幕`;
    item.completedAt = Date.now();
    finishExecution(item);
    await saveItem(item);
    return cues;
  }

  async function processBilibiliItem(item, signal) {
    const bvid = item.targetId;
    const pageMatch = String(item.id || item.url || '').match(/[?&]p=(\d+)|:p(\d+)/i);
    const targetPageNum = pageMatch ? parseInt(pageMatch[1] || pageMatch[2], 10) : (item.page || 1);

    // === Stage 1: Resolving ===
    // Always re-resolve Bilibili's authoritative BVID -> CID mapping before a job.
    // A cached CID is not safe across SPA navigation, multi-P changes, restored queue
    // state, or old extension versions. The ASR path must never download media until
    // the current target identity has been proved again.
    await enterStage(item, 'resolving', 15, '正在校验视频身份与分P CID…');

    const viewResp = await BSE.Utils.fetchWithTimeout(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { signal, credentials: 'include' },
      7000
    );
    const viewJson = await viewResp.json();
    if (viewJson?.code !== 0 || !viewJson?.data) {
      throw new Error(viewJson?.message || '无法获取B站视频信息');
    }

    const vData = viewJson.data;
    if (vData.bvid && String(vData.bvid).toLowerCase() !== String(bvid).toLowerCase()) {
      throw nativeError('INVALID_REQUEST', 'Bilibili 视频身份校验失败。', '页面视频已发生变化，请在当前视频重新点击离线转录。', true);
    }
    const pages = Array.isArray(vData.pages) ? vData.pages : [];
    const targetPage = pages.find((p) => Number(p.page) === Number(targetPageNum))
      || (Number(targetPageNum) === 1 ? pages[0] : null);
    if (pages.length && !targetPage) {
      throw nativeError('INVALID_REQUEST', 'Bilibili 分P身份校验失败。', '当前分P已经变化，请重新加入离线转录。', true);
    }
    const cid = targetPage?.cid || vData.cid;
    if (!cid) {
      throw nativeError('INVALID_REQUEST', 'Bilibili 视频缺少有效 CID。', '请刷新当前视频页面后重试。', true);
    }

    const authoritativeIdentity = { bvid, cid: String(cid) };
    const authoritativeMediaKey = bilibiliMediaKey(bvid, cid);
    const requestedIdentity = parseBilibiliMediaKey(item.expectedMediaKey);
    if (requestedIdentity && !sameBilibiliIdentity(requestedIdentity, authoritativeIdentity)) {
      throw nativeError('INVALID_REQUEST', 'Bilibili 视频身份已发生变化。', '为避免串台，已停止本次任务；请在当前视频重新点击离线转录。', true);
    }

    emitDiagnostic({
      scope: 'queue',
      sessionId: String(item.id || 'queue:active'),
      level: 'debug',
      code: 'BILIBILI_MEDIA_IDENTITY_RESOLVED',
      stage: '媒体身份',
      message: `已确认当前 Bilibili 媒体：${authoritativeMediaKey} · page=${targetPage?.page || targetPageNum} · duration=${Number(targetPage?.duration || vData.duration || 0) || '?'}s`,
      context: { mediaKey: authoritativeMediaKey, platform: 'bilibili' }
    });

    let semanticTags = [];
    const existingContextOwner = BSE.MediaContext?.sameOwner?.(item.mediaContext, { mediaKey: authoritativeMediaKey }) === true;
    if (existingContextOwner && Array.isArray(item.mediaContext?.tags) && item.mediaContext.tags.length) {
      semanticTags = item.mediaContext.tags;
    } else if (BSE.MediaContext?.fetchBilibiliTags) {
      try {
        semanticTags = await BSE.MediaContext.fetchBilibiliTags(bvid, { signal });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        emitDiagnostic({
          scope: 'queue',
          sessionId: String(item.id || 'queue:active'),
          level: 'info',
          code: 'MEDIA_CONTEXT_TAGS_UNAVAILABLE',
          stage: '视频语境',
          message: 'Bilibili 标签暂时不可用，不影响字幕处理。',
          context: { mediaKey: authoritativeMediaKey, platform: 'bilibili' }
        });
      }
    }

    item.title = vData.title || item.title;
    if (targetPage && targetPage.part && pages.length > 1) {
      item.title = `${vData.title} - P${targetPage.page} ${targetPage.part}`;
    }
    item.author = vData.owner?.name || item.author;
    item.cover = vData.pic || item.cover;
    item.duration = targetPage?.duration || vData.duration || item.duration;
    item.page = targetPage?.page || targetPageNum;
    item.mediaContext = BSE.MediaContext?.fromBilibiliView?.({
      bvid,
      cid,
      page: item.page,
      viewData: vData,
      tags: semanticTags
    }) || item.mediaContext;
    item.metaCache = {
      title: item.title,
      author: item.author,
      cover: item.cover,
      duration: item.duration,
      cid,
      mediaKey: authoritativeMediaKey,
      pages: pages.map((p) => ({ page: p.page, cid: p.cid, part: p.part }))
    };

    // Caption artifacts are owned by one exact BVID+CID. Legacy artifacts without
    // an owner, or artifacts from another page/video, are deliberately discarded.
    const artifactIdentity = parseBilibiliMediaKey(item.stageArtifacts?.mediaKey);
    item.stageArtifacts = sameBilibiliIdentity(artifactIdentity, authoritativeIdentity)
      ? { ...item.stageArtifacts, metadataResolved: true, mediaKey: authoritativeMediaKey }
      : { metadataResolved: true, mediaKey: authoritativeMediaKey };
    await saveItem(item);

    if (item.processingIntent === 'local-asr') {
      // Explicit offline transcription is a separate product intent. Do not let
      // page-state, caption caches, or platform caption discovery participate.
      const source = await resolveBilibiliAudioSource(item, bvid, cid, signal);
      await finishNativeTranscription(item, source, signal);
      return;
    }

    // === Stage 2: Fetching Caption ===
    let subtitles = item.stageArtifacts?.captionTracks || [];
    let captionBody = item.stageArtifacts?.captionBody || null;
    let cues = [];
    let chosenSub = null;

    // 0. 优先检查当前已打开的标签页是否已有该视频解析好的字幕数据（直接复用，0延迟，无需重复请求）
    if (!subtitles.length && !captionBody && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ url: ['*://*.bilibili.com/*'] }).catch(() => []);
        for (const t of tabs) {
          if (t.url && (t.url.includes(bvid) || (item.url && t.url.includes(item.url)))) {
            const tabState = await chrome.tabs.sendMessage(t.id, { type: 'BSE_GET_STATE' }).catch(() => null);
            // 严防跨视频污染：必须确保标签页内状态属于当前目标视频
            const tabMediaKey = String(tabState?.mediaKey || '');
            const tabIdentity = parseBilibiliMediaKey(tabMediaKey);
            // Reusing page state is an optimization, never a correctness fallback.
            // Fail closed unless the content script proves the exact BVID+CID.
            if (!sameBilibiliIdentity(tabIdentity, authoritativeIdentity)) {
              continue;
            }
            if (tabState?.status !== 'ready') {
              continue;
            }

            if (tabState?.cues?.length) {
              cues = normalizeCompleteCues(tabState.cues);
              if (cues.length) {
                // 媒体时长与完整度一致性防护 (Duration & Completeness Guard)
                const maxCueTo = Number(cues[cues.length - 1]?.to || 0);
                const knownDuration = Number(item.duration || item.metaCache?.duration || 0);
                if (knownDuration > 10 && maxCueTo > knownDuration + 8) {
                  console.warn(`[SparkSub Queue] 忽略标签页串台字幕：视频时长 ${knownDuration}s，但标签页字幕持续到 ${maxCueTo}s`);
                  cues = [];
                  continue;
                }
                if (knownDuration >= 90 && maxCueTo < knownDuration * 0.35 && cues.length < 20) {
                  console.warn(`[SparkSub Queue] 忽略标签页残缺片头字幕：视频时长 ${knownDuration}s，但字幕仅 ${cues.length} 句（覆盖前 ${Math.round(maxCueTo)}s），回退至端侧 ASR`);
                  cues = [];
                  continue;
                }

                captionBody = tabState.cues;
                const activeTrack = Array.isArray(tabState.tracks)
                  ? (tabState.tracks.find((track) => String(track.id) === String(tabState.selectedTrackId)) || tabState.tracks[0] || null)
                  : null;
                subtitles = (Array.isArray(tabState.tracks) && tabState.tracks.length)
                  ? tabState.tracks
                  : [{
                      id: 'tab_current',
                      lan: activeTrack?.lan || 'zh-CN',
                      lan_doc: activeTrack?.lanDoc || activeTrack?.lan_doc || '网络字幕',
                      subtitle_url: ''
                    }];
                chosenSub = activeTrack || subtitles[0];
                const chosenTrackId = captionTrackIdentity(chosenSub) || 'tab_current';
                item.stageArtifacts = {
                  ...(item.stageArtifacts || {}),
                  captionTracks: subtitles,
                  captionBody,
                  captionTrackId: chosenTrackId,
                  selectedCaption: {
                    id: chosenTrackId,
                    language: chosenSub?.lan || 'zh-CN',
                    label: chosenSub?.lanDoc || chosenSub?.lan_doc || '网络字幕',
                    kind: 'official'
                  }
                };
                await enterStage(item, 'postprocessing', 85, '已从打开的网页提取字幕，正在整理格式…');
                break;
              }
            } else if (Array.isArray(tabState?.tracks) && tabState.tracks.length) {
              subtitles = tabState.tracks.map((tr) => ({
                id: tr.id,
                lan: tr.lan,
                lan_doc: tr.lanDoc || tr.lan,
                subtitle_url: tr.subtitleUrl
              }));
              item.stageArtifacts = { ...(item.stageArtifacts || {}), captionTracks: subtitles };
              await saveItem(item);
              break;
            }
          }
        }
      } catch {}
    }

    if (!cues.length && !subtitles.length) {
      await enterStage(item, 'fetching_caption', 40, '正在提取官方/AI字幕…');

      // 尝试 1: 直接请求 wbi/v2（无签名直连）
      try {
        const p1 = await BSE.Utils.fetchWithTimeout(
          `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
          { signal, credentials: 'include' },
          6000
        );
        const j1 = await p1.json();
        const responseBvid = String(j1?.data?.bvid || '');
        const responseCid = j1?.data?.cid;
        const identityMatches = (!responseBvid || responseBvid.toLowerCase() === bvid.toLowerCase())
          && (responseCid == null || String(responseCid) === String(cid));
        if (!identityMatches) {
          console.warn(`[SparkSub Queue] 忽略跨媒体字幕接口返回：请求 ${authoritativeMediaKey}，接口返回 bvid=${responseBvid || '?'} cid=${responseCid ?? '?'}`);
        } else if (Array.isArray(j1?.data?.subtitle?.subtitles) && j1.data.subtitle.subtitles.length) {
          subtitles = j1.data.subtitle.subtitles;
        }
      } catch {}

      // 尝试 2: 若未拿到，尝试带 WBI 签名请求
      if (!subtitles.length) {
        try {
          const { imgKey, subKey } = await fetchBilibiliNavKeys(signal);
          const signed = calculateWbiSign({ bvid, cid }, imgKey, subKey);
          const playerResp = await BSE.Utils.fetchWithTimeout(
            `https://api.bilibili.com/x/player/wbi/v2?${signed.query}`,
            { signal, credentials: 'include' },
            6000
          );
          const playerJson = await playerResp.json();
          const responseBvid = String(playerJson?.data?.bvid || '');
          const responseCid = playerJson?.data?.cid;
          const identityMatches = (!responseBvid || responseBvid.toLowerCase() === bvid.toLowerCase())
            && (responseCid == null || String(responseCid) === String(cid));
          if (!identityMatches) {
            console.warn(`[SparkSub Queue] 忽略跨媒体签名字幕返回：请求 ${authoritativeMediaKey}，接口返回 bvid=${responseBvid || '?'} cid=${responseCid ?? '?'}`);
          } else if (Array.isArray(playerJson?.data?.subtitle?.subtitles) && playerJson.data.subtitle.subtitles.length) {
            subtitles = playerJson.data.subtitle.subtitles;
          }
        } catch {}
      }

      // 尝试 3: 若仍未拿到，尝试兼容接口 x/player/v2
      if (!subtitles.length) {
        try {
          const p3 = await BSE.Utils.fetchWithTimeout(
            `https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(item.metaCache?.aid || '')}&bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
            { signal, credentials: 'include' },
            6000
          );
          const j3 = await p3.json();
          const responseBvid = String(j3?.data?.bvid || '');
          const responseCid = j3?.data?.cid;
          const identityMatches = (!responseBvid || responseBvid.toLowerCase() === bvid.toLowerCase())
            && (responseCid == null || String(responseCid) === String(cid));
          if (!identityMatches) {
            console.warn(`[SparkSub Queue] 忽略跨媒体兼容字幕返回：请求 ${authoritativeMediaKey}，接口返回 bvid=${responseBvid || '?'} cid=${responseCid ?? '?'}`);
          } else {
            subtitles = j3?.data?.subtitle?.subtitles || [];
          }
        } catch {}
      }

      item.stageArtifacts = { ...(item.stageArtifacts || {}), captionTracks: subtitles };
      await saveItem(item);
    }

    const captionCandidates = rankCaptionTracks(subtitles, item.sourceLanguage);
    const cachedCaptionTrackId = item.stageArtifacts?.captionTrackId || '';
    const cachedCues = normalizeCompleteCues(captionBody);
    for (const candidate of captionCandidates) {
      const candidateTrackId = captionTrackIdentity(candidate);
      if (cachedCues.length && cachedCaptionTrackId === candidateTrackId) {
        cues = cachedCues;
        chosenSub = candidate;
        break;
      }
      if (!cues.length) {
        let subUrl = candidate?.subtitle_url || candidate?.url || '';
        if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
        else if (subUrl.startsWith('http://')) subUrl = subUrl.replace(/^http:\/\//i, 'https://');
        if (!subUrl) continue;
        await enterStage(item, 'fetching_caption', 50, `正在下载《${candidate?.lan_doc || candidate?.lan || '默认'}》字幕…`);
        try {
          let subContentResp;
          try {
            subContentResp = await BSE.Utils.fetchWithTimeout(subUrl, { signal, credentials: 'omit' }, 7000);
          } catch (fetchErr) {
            if (fetchErr?.name === 'AbortError') throw fetchErr;
            const altUrl = subUrl.startsWith('https://') ? subUrl.replace(/^https:\/\//i, 'http://') : subUrl;
            subContentResp = await BSE.Utils.fetchWithTimeout(altUrl, { signal, credentials: 'omit' }, 7000);
          }
          const subContentJson = await subContentResp.json();
          const candidateCues = normalizeCompleteCues(subContentJson?.body || []);
          if (!candidateCues.length) continue;

          // 时长防错与完整度互锁 (Duration & Completeness Guard)
          const maxCueTo = Number(candidateCues[candidateCues.length - 1]?.to || 0);
          const knownDuration = Number(item.duration || item.metaCache?.duration || 0);
          if (knownDuration > 10 && maxCueTo > knownDuration + 8) {
            console.warn(`[SparkSub Queue] 忽略时长严重错配字幕：视频时长 ${knownDuration}s，字幕终点 ${maxCueTo}s`);
            continue;
          }
          if (knownDuration >= 90 && maxCueTo < knownDuration * 0.35 && candidateCues.length < 20) {
            console.warn(`[SparkSub Queue] 忽略官方残缺片头字幕：视频时长 ${knownDuration}s，字幕仅 ${candidateCues.length} 句（覆盖前 ${Math.round(maxCueTo)}s），回退至端侧 ASR`);
            continue;
          }

          captionBody = subContentJson.body;
          cues = candidateCues;
          chosenSub = candidate;
          item.stageArtifacts = {
            ...(item.stageArtifacts || {}),
            captionBody,
            captionTrackId: candidateTrackId,
            selectedCaption: captionTrackMetadata(candidate)
          };
          await saveItem(item);
          break;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
        }
      }
    }

    if (!cues.length) {
      const source = await resolveBilibiliAudioSource(item, bvid, cid, signal);
      await finishNativeTranscription(item, source, signal);
      return;
    } else {
      await enterStage(item, 'postprocessing', 85, '正在进行自然段落切分与 Markdown 格式化…');
      setCompletedSubtitle(item, cues, {
        language: chosenSub?.lan || 'auto',
        langDoc: chosenSub?.lan_doc || chosenSub?.lanDoc || chosenSub?.lan || '平台字幕',
        source: 'platform',
        engine: 'bilibili'
      });
    }

    item.stage = 'done';
    item.progress = 100;
    const engineLabel = formatEngineLabel(item.subtitle?.engine, item.subtitle?.engineLabel);
    item.stageHint = `完成 · 引擎: ${engineLabel} · 共 ${item.subtitle.cueCount} 句字幕`;
    item.completedAt = Date.now();
    finishExecution(item);
    await saveItem(item);
  }

  async function resolveYouTubeMetadataAndCaptions(videoId, signal) {
    let captionTracks = [];
    let title = '';
    let author = '';
    let cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let rawText = '';
    let chosenTrack = null;
    let mediaContext = BSE.MediaContext?.create?.({
      platform: 'youtube',
      mediaKey: `yt:${videoId}`
    }) || null;

    // Strategy 0: Ask active YouTube tab (via live MAIN world session bridge)
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        for (const tab of tabs) {
          if (!tab.id) continue;
          const tabVideoId = BSE.Utils?.getYouTubeVideoId?.(tab.url || '');
          if (tabVideoId !== videoId) continue;
          try {
            const res = await new Promise((resolve) => {
              const timer = setTimeout(() => resolve(null), 5000);
              chrome.tabs.sendMessage(tab.id, { type: 'BSE_RESOLVE_YOUTUBE_IN_TAB', videoId })
                .then((r) => { clearTimeout(timer); resolve(r); })
                .catch(() => { clearTimeout(timer); resolve(null); });
            });
            if (res?.ok && res.result) {
              const r = res.result;
              if (r.videoId !== videoId) continue;
              if (r.title) title = r.title;
              if (r.author) author = r.author;
              if (r.cover) cover = r.cover;
              if (BSE.MediaContext?.merge) {
                mediaContext = BSE.MediaContext.merge(mediaContext, {
                  platform: 'youtube',
                  mediaKey: `yt:${videoId}`,
                  title,
                  author
                });
              }
              if (Array.isArray(r.captionTracks) && r.captionTracks.length) captionTracks = r.captionTracks;
              if (r.rawText) {
                rawText = r.rawText;
                chosenTrack = r.chosenTrack;
                return { title, author, cover, captionTracks, rawText, chosenTrack, mediaContext };
              }
              if (captionTracks.length) break;
            }
          } catch {}
        }
      } catch {}
    }

    // Strategy 1: Innertube ANDROID Client (High reliability, unblocked, pure JSON)
    try {
      const androidPayload = {
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            hl: 'zh-CN',
            gl: 'US'
          }
        }
      };
      const resp = await BSE.Utils.fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(androidPayload),
          signal
        },
        7000
      );
      const text = await resp.text();
      if (text && text.trim().startsWith('{')) {
        const data = JSON.parse(text);
        if (data?.videoDetails) {
          title = data.videoDetails.title || '';
          author = data.videoDetails.author || '';
          cover = data.videoDetails.thumbnail?.thumbnails?.[0]?.url || cover;
          if (BSE.MediaContext?.merge && BSE.MediaContext?.fromYouTubeDetails) {
            mediaContext = BSE.MediaContext.merge(mediaContext, BSE.MediaContext.fromYouTubeDetails({
              videoId,
              videoDetails: data.videoDetails,
              microformat: data.microformat
            }));
          }
        }
        captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      }
    } catch {}

    // Strategy 2: Innertube WEB Client Fallback
    if (!captionTracks.length) {
      try {
        const webPayload = {
          videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240101.00.00',
              hl: 'zh-CN',
              gl: 'US'
            }
          }
        };
        const resp = await BSE.Utils.fetchWithTimeout(
          'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webPayload),
            signal
          },
          7000
        );
        const text = await resp.text();
        if (text && text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          if (data?.videoDetails) {
            if (!title) title = data.videoDetails.title || '';
            if (!author) author = data.videoDetails.author || '';
            if (data.videoDetails.thumbnail?.thumbnails?.[0]?.url) cover = data.videoDetails.thumbnail.thumbnails[0].url;
            if (BSE.MediaContext?.merge && BSE.MediaContext?.fromYouTubeDetails) {
              mediaContext = BSE.MediaContext.merge(mediaContext, BSE.MediaContext.fromYouTubeDetails({
                videoId,
                videoDetails: data.videoDetails,
                microformat: data.microformat
              }));
            }
          }
          captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        }
      } catch {}
    }

    // Strategy 3: YouTube Watch Page HTML Scraping Fallback
    if (!captionTracks.length) {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const resp = await BSE.Utils.fetchWithTimeout(watchUrl, { credentials: 'include', signal }, 8000);
        const html = await resp.text();
        const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s)
          || html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
        if (playerMatch) {
          const data = JSON.parse(playerMatch[1]);
          if (data?.videoDetails) {
            if (!title) title = data.videoDetails.title || '';
            if (!author) author = data.videoDetails.author || '';
            if (data.videoDetails.thumbnail?.thumbnails?.[0]?.url) cover = data.videoDetails.thumbnail.thumbnails[0].url;
            if (BSE.MediaContext?.merge && BSE.MediaContext?.fromYouTubeDetails) {
              mediaContext = BSE.MediaContext.merge(mediaContext, BSE.MediaContext.fromYouTubeDetails({
                videoId,
                videoDetails: data.videoDetails,
                microformat: data.microformat
              }));
            }
          }
          captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        }
        if (!title) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) title = titleMatch[1].replace(/\s*-\s*YouTube$/i, '').trim();
        }
      } catch {}
    }

    // Normalize track URLs and synthesize Chinese auto-translation track if non-Chinese
    if (captionTracks && captionTracks.length) {
      captionTracks.forEach((t) => {
        if (t.baseUrl && t.baseUrl.startsWith('//')) t.baseUrl = `https:${t.baseUrl}`;
      });
      const hasChinese = captionTracks.some((t) => /zh|cn|chinese|中/i.test(t.languageCode || t.name?.simpleText || ''));
      if (!hasChinese && captionTracks[0]?.baseUrl) {
        const base = captionTracks[0].baseUrl;
        const transUrl = base.includes('tlang=') ? base : `${base}&tlang=zh-Hans`;
        captionTracks.unshift({
          baseUrl: transUrl,
          languageCode: 'zh-Hans',
          name: { simpleText: `${captionTracks[0].name?.simpleText || captionTracks[0].languageCode} → 中文（自动翻译）` },
          vssId: '.zh-Hans',
          isTranslatable: false,
          isTranslated: true
        });
      }
    }

    return { title, author, cover, captionTracks, rawText, chosenTrack, mediaContext };
  }

  async function processYouTubeItem(item, signal) {
    const videoId = item.targetId;

    if (item.processingIntent === 'local-asr') {
      // Explicit offline transcription never consults open tabs, cached caption
      // artifacts, or platform caption endpoints. The canonical video ID is the
      // only remote-media identity passed to SparkScribe.
      item.stageArtifacts = {};
      if (!item.mediaContext && BSE.MediaContext?.create) {
        item.mediaContext = BSE.MediaContext.create({
          platform: 'youtube',
          mediaKey: `yt:${videoId}`,
          title: item.title,
          author: item.author,
          duration: item.duration
        });
      }
      await enterStage(item, 'fetching_audio', 60, '正在准备当前 YouTube 视频并进行本地转录…');
      await finishNativeTranscription(
        item,
        { kind: 'youtube', url: `https://www.youtube.com/watch?v=${videoId}` },
        signal
      );
      return;
    }

    // === Stage 1: Resolving & Fetching Caption Metadata ===
    let captionTracks = item.metaCache?.captionTracks || [];
    let directRawText = '';
    let directChosenTrack = null;

    if (!captionTracks.length) {
      await enterStage(item, 'resolving', 20, '正在调用 YouTube 接口解析字幕…');
      const resolved = await resolveYouTubeMetadataAndCaptions(videoId, signal);
      captionTracks = resolved.captionTracks || [];
      directRawText = resolved.rawText || '';
      directChosenTrack = resolved.chosenTrack || null;
      if (resolved.title) item.title = resolved.title;
      if (resolved.author) item.author = resolved.author;
      if (resolved.cover) item.cover = resolved.cover;
      if (resolved.mediaContext) item.mediaContext = resolved.mediaContext;
      item.metaCache = {
        ...(item.metaCache || {}),
        title: item.title,
        author: item.author,
        cover: item.cover,
        captionTracks
      };
      item.stageArtifacts = { ...(item.stageArtifacts || {}), metadataResolved: true };
      if (directRawText) {
        const matchedDirectTrack = directChosenTrack && captionTracks.find((track) => (
          captionTrackIdentity(track) === captionTrackIdentity(directChosenTrack)
        ));
        const directArtifactTrack = matchedDirectTrack || createTranscriptFallbackTrack();
        item.stageArtifacts.captionText = directRawText;
        item.stageArtifacts.captionTrackId = captionTrackIdentity(directArtifactTrack);
        item.stageArtifacts.selectedCaption = captionTrackMetadata(directArtifactTrack);
        item.stageArtifacts.isTranscriptFallback = isTranscriptFallbackTrack(directArtifactTrack);
      }
      await saveItem(item);
    } else {
      item.title = item.metaCache.title || item.title;
      item.author = item.metaCache.author || item.author;
      item.cover = item.metaCache.cover || item.cover;
      if (!item.mediaContext && BSE.MediaContext?.create) {
        item.mediaContext = BSE.MediaContext.create({
          platform: 'youtube',
          mediaKey: `yt:${videoId}`,
          title: item.title,
          author: item.author,
          duration: item.duration
        });
      }
    }

    const rankedCaptionTracks = rankCaptionTracks(captionTracks, item.sourceLanguage);
    const chosenTrack = rankedCaptionTracks[0] || null;

    // Download Caption with Multi-format Resilience (JSON3 / XML / TTML / VTT) and Fallback Tracks
    const cachedCaptionText = item.stageArtifacts?.captionText || '';
    const cachedCaptionCues = normalizeCompleteCues(item.stageArtifacts?.cues || (cachedCaptionText ? BSE.Parsers.parse(cachedCaptionText) : []));
    const cachedCaptionTrackId = item.stageArtifacts?.captionTrackId || '';
    const cachedTranscriptFallback = item.stageArtifacts?.isTranscriptFallback === true
      || item.stageArtifacts?.selectedCaption?.isTranscriptFallback === true;
    const directTranscriptFallback = cachedTranscriptFallback && cachedCaptionTrackId === YOUTUBE_TRANSCRIPT_FALLBACK_ID
      ? createTranscriptFallbackTrack()
      : null;
    let rawCaptionText = '';
    let cues = [];
    let actualTrack = null;

    if (chosenTrack || directTranscriptFallback) {
      const displayTrack = chosenTrack || directTranscriptFallback;
      await enterStage(item, 'fetching_caption', 50, `正在下载《${displayTrack.name?.simpleText || displayTrack.languageCode || '默认'}》字幕…`);

      const candidateTracks = rankedCaptionTracks;
      for (const track of candidateTracks) {
        const candidateTrackId = captionTrackIdentity(track);
        if (cachedCaptionCues.length && cachedCaptionTrackId === candidateTrackId) {
          cues = cachedCaptionCues;
          rawCaptionText = cachedCaptionText;
          actualTrack = track;
          break;
        }
        if (!track?.baseUrl) continue;
        const candidateUrls = [
          track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`,
          track.baseUrl.includes('fmt=') ? track.baseUrl.replace(/fmt=\w+/, 'fmt=srv3') : `${track.baseUrl}&fmt=srv3`,
          track.baseUrl.includes('fmt=') ? track.baseUrl.replace(/fmt=\w+/, 'fmt=vtt') : `${track.baseUrl}&fmt=vtt`,
          track.baseUrl
        ];
        for (const targetUrl of candidateUrls) {
          try {
            const resp = await BSE.Utils.fetchWithTimeout(targetUrl, {
              credentials: 'include',
              cache: 'no-store',
              signal
            }, 8000);
            const text = await resp.text();
            if (text && !text.includes('<!DOCTYPE html>')) {
              const parsed = BSE.Parsers.parse(text);
              const completeCues = normalizeCompleteCues(parsed);
              if (completeCues.length) {
                cues = completeCues;
                rawCaptionText = text;
                actualTrack = track;
                break;
              }
            }
          } catch {}
        }
        if (cues.length > 0) break;
      }

      if (!cues.length && directTranscriptFallback && cachedCaptionCues.length) {
        cues = cachedCaptionCues;
        rawCaptionText = cachedCaptionText;
        actualTrack = directTranscriptFallback;
      }

      if (rawCaptionText && cues.length > 0) {
        item.stageArtifacts = {
          ...(item.stageArtifacts || {}),
          captionText: rawCaptionText,
          cues,
          captionTrackId: captionTrackIdentity(actualTrack),
          selectedCaption: captionTrackMetadata(actualTrack),
          isTranscriptFallback: isTranscriptFallbackTrack(actualTrack)
        };
        await saveItem(item);
      }
    }

    if (!cues.length) {
      await enterStage(item, 'fetching_caption', 55, '扩展字幕链路不可用，正在通过本机服务读取 YouTube 原生字幕…');
      const nativeCaption = await fetchYouTubeCaptionsWithNativeHost(
        item,
        { kind: 'youtube', url: `https://www.youtube.com/watch?v=${videoId}` },
        signal
      );
      if (nativeCaption?.cues?.length) {
        cues = nativeCaption.cues;
        actualTrack = nativeCaption.track;
        item.stageArtifacts = {
          ...(item.stageArtifacts || {}),
          cues,
          captionTrackId: captionTrackIdentity(actualTrack),
          selectedCaption: captionTrackMetadata(actualTrack),
          isTranscriptFallback: false
        };
        await saveItem(item);
      }
    }

    if (!cues.length) {
      await enterStage(item, 'fetching_audio', 60, '平台字幕不可用，正在准备本地转录…');
      const source = { kind: 'youtube', url: `https://www.youtube.com/watch?v=${videoId}` };
      let nativeTranscript = await transcribeWithNativeHost(item, source, signal);
      await enterStage(item, 'postprocessing', 95, '正在进行端侧大模型语义纠错与时间轴整理…');
      nativeTranscript = await polishCuesIfEnabled(item, nativeTranscript, signal);
      cues = nativeTranscript.cues;
      setCompletedSubtitle(item, cues, {
        language: item.sourceLanguage || 'auto',
        langDoc: '本地自动转录',
        source: 'native',
        engine: nativeTranscript.engine || 'local-asr',
        engineLabel: nativeTranscript.engineLabel || '端侧 ASR'
      });
    } else {
      await enterStage(item, 'postprocessing', 85, '正在整理结构化段落与 SRT…');
      setCompletedSubtitle(item, cues, {
        language: actualTrack?.languageCode || 'auto',
        langDoc: actualTrack?.name?.simpleText || actualTrack?.languageCode || '平台字幕',
        source: 'platform',
        engine: 'youtube',
        captionKind: captionTrackMetadata(actualTrack).captionKind
      });
    }

    item.stage = 'done';
    item.progress = 100;
    const engineLabel = formatEngineLabel(item.subtitle?.engine, item.subtitle?.engineLabel);
    item.stageHint = `完成 · 引擎: ${engineLabel} · 共 ${item.subtitle.cueCount} 句字幕`;
    item.completedAt = Date.now();
    finishExecution(item);
    await saveItem(item);

    // Auto-apply transcribed cues to active matching tabs
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query && Array.isArray(cues) && cues.length) {
        const targetUrlPatterns = item.platform === 'youtube'
          ? ['*://*.youtube.com/*']
          : ['*://*.bilibili.com/*'];
        const tabs = await chrome.tabs.query({ url: targetUrlPatterns });
        for (const tab of tabs) {
          if (tab.id != null && tab.url && (tab.url.includes(item.id) || (item.url && tab.url === item.url))) {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'BSE_APPLY_EXTERNAL_SUBTITLE',
              expectedMediaKey: item.mediaContext?.mediaKey || item.expectedMediaKey || '',
              mediaContext: item.mediaContext || null,
              track: {
                id: `transcribed-${item.id}`,
                name: `端侧本地转录 (${item.subtitle.cueCount} 句)`,
                language: item.subtitle.language || 'zh',
                langDoc: item.subtitle.langDoc || '本地端侧转录',
                isAi: true,
                source: 'native',
                engine: item.subtitle.engine || 'local-asr',
                ...(item.subtitle.engineLabel ? { engineLabel: item.subtitle.engineLabel } : {})
              },
              cues
            }).catch(() => {});
          }
        }
      }
    } catch {}
  }

  async function processPendingJobs() {
    if (isProcessingJobs) return;
    isProcessingJobs = true;

    try {
      await recoverStaleJobsInternal(false);
      const settings = await getSettings();
      const maxConcurrency = Math.max(1, Math.min(4, settings.maxConcurrency || 3));

      while (true) {
        const queueProjection = await getQueueProjection();
        const pendingItems = queueProjection.filter((i) => i.stage === 'queued');

        if (!pendingItems.length) {
          break;
        }

        const candidates = pendingItems.slice(0, maxConcurrency);
        const claim = async () => {
          return serializeQueueOperation(async () => {
            const candidateItems = await readQueueItemsByIds(candidates.map((candidate) => candidate.id));
            const claimed = [];
            const now = Date.now();
            for (const item of candidateItems) {
              if (!item || item.stage !== 'queued') continue;
              const leaseExpiresAt = item.leaseExpiresAt ?? item.executionLease?.expiresAt ?? 0;
              const isLockedByOther = item.leaseOwner && item.leaseOwner !== EXECUTOR_ID && leaseExpiresAt > now;
              if (isLockedByOther) continue;

              item.leaseOwner = EXECUTOR_ID;
              item.leaseExpiresAt = now + LEASE_DURATION_MS;
              item.executionLease = {
                owner: EXECUTOR_ID,
                acquiredAt: now,
                expiresAt: now + EXECUTION_LEASE_MS
              };
              claimed.push(item);
            }
            if (claimed.length) await writeItems(claimed, false, null);
            return claimed.map(safeClone);
          });
        };
        // Web Locks is shared by extension execution contexts and makes the
        // persistent read/claim/write sequence atomic. The verification in the
        // fallback still prevents a loser from starting on normal storage.
        const batch = globalThis.navigator?.locks?.request
          ? await globalThis.navigator.locks.request('bse-queue-claim', claim)
          : await claim();
        if (!batch.length) break;
        await Promise.all(
          batch.map(async (item) => {
            const controller = new AbortController();
            inFlightControllers.set(item.id, controller);
            try {
              item.startedAt = Date.now();
              item.stageUpdatedAt = item.startedAt;
              item.executionLease = {
                owner: EXECUTOR_ID,
                acquiredAt: item.startedAt,
                expiresAt: item.startedAt + EXECUTION_LEASE_MS
              };
              const stillOwned = await saveItem(item);
              if (!stillOwned || controller.signal.aborted) return;
              if (item.platform === 'bilibili') {
                await processBilibiliItem(item, controller.signal);
              } else if (item.platform === 'youtube') {
                await processYouTubeItem(item, controller.signal);
              }
            } catch (err) {
              if (controller.signal.aborted || err?.name === 'AbortError') return;
              item.stage = 'failed';
              item.progress = 0;
              item.errorCode = err?.code || 'ASR_FAILED';
              const presentation = CURATED_ERRORS[item.errorCode] || CURATED_ERRORS.ASR_FAILED;
              item.error = presentation.message;
              item.errorHint = presentation.hint;
              item.retriable = presentation.retriable;
              item.stageHint = `失败：${presentation.message}`;
              finishExecution(item);
              await saveItem(item);
            } finally {
              if (inFlightControllers.get(item.id) === controller) {
                inFlightControllers.delete(item.id);
              }
            }
          })
        );
      }
    } finally {
      isProcessingJobs = false;
    }
  }

  BSE.Queue = {
    setDiagnosticReporter(reporter) {
      diagnosticReporter = typeof reporter === 'function' ? reporter : null;
    },
    normalizeVideoUrl,
    toListProjection: queueListProjection,
    getQueue,
    getQueueProjection,
    getQueueSummary,
    saveQueue,
    saveItem,
    getItem,
    getSettings,
    saveSettings,
    recoverStaleJobs,
    addToQueue,
    removeFromQueue,
    clearCompleted,
    clearAll,
    retryItem,
    exportQueueMergedMarkdown,
    processBilibiliItem,
    processYouTubeItem,
    processPendingJobs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BSE.Queue;
  }
})();
