(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});

  const STORAGE_KEY_QUEUE = 'bse_transcription_queue_v1';
  const STORAGE_KEY_ITEM_PREFIX = `${STORAGE_KEY_QUEUE}:item:`;
  const STORAGE_KEY_SETTINGS = 'bse_queue_settings_v1';
  const LEASE_DURATION_MS = 5 * 60 * 1000;
  const EXECUTION_LEASE_MS = LEASE_DURATION_MS;
  const EXECUTOR_ID = `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let nativeJobSequence = 0;

  const DEFAULT_SETTINGS = {
    maxConcurrency: 2,
    autoDownload: false,
    preferredFormat: 'md',
    enableNotification: true,
    sourceLanguage: 'auto'
  };
  const EPHEMERAL_MEDIA_KEYS = new Set([
    'audiocache', 'audiourl', 'backupurls', 'backupurl', 'backup_url',
    'mediaurl', 'streamurl', 'dashurl', 'dashaudio', 'mediadescriptor',
    'mediasource', 'remotesource', 'transientmedia', 'nativesource'
  ]);
  const CURATED_ERRORS = Object.freeze({
    ASR_LANGUAGE_UNSUPPORTED: { message: '本机模型不支持粤语。', hint: '请使用平台提供的粤语字幕，或选择受支持的语言。', retriable: false },
    RESULT_INCOMPLETE: { message: '本机转录结果不完整。', hint: '请重试此任务。', retriable: true },
    NATIVE_HOST_NOT_INSTALLED: { message: '未检测到 SparkSub 本机转录服务。', hint: '请安装本机转录服务后重试。', retriable: false },
    NATIVE_HOST_DISCONNECTED: { message: '本机转录服务已断开。', hint: '请重新连接本机服务后重试。', retriable: true },
    NATIVE_HOST_TIMEOUT: { message: '本机转录服务响应超时。', hint: '请确认本机服务仍在运行后重试。', retriable: true },
    PROTOCOL_MISMATCH: { message: '本机转录服务协议不兼容。', hint: '请更新 SparkSub 扩展和本机服务。', retriable: false },
    PROTOCOL_MESSAGE_TOO_LARGE: { message: '本机转录服务返回的数据过大。', hint: '请重试；如持续发生请更新本机服务。', retriable: true },
    YTDLP_NOT_INSTALLED: { message: '未安装 YouTube 下载组件。', hint: '请完成本机服务安装后重试。', retriable: false },
    YTDLP_CHECKSUM_FAILED: { message: 'YouTube 下载组件校验失败。', hint: '请重新安装本机服务。', retriable: false },
    MEDIA_AUTH_REQUIRED: { message: '该媒体需要登录或访问权限。', hint: '目前仅支持公开可访问的视频。', retriable: false },
    MEDIA_DOWNLOAD_FAILED: { message: '媒体下载失败。', hint: '请确认视频公开可访问后重试。', retriable: true },
    MODEL_NOT_FOUND: { message: '未找到本机转录模型。', hint: '请安装受支持的本机模型后重试。', retriable: false },
    MODEL_LAYOUT_INCOMPATIBLE: { message: '本机转录模型布局不兼容。', hint: '请检查模型版本或重新安装模型。', retriable: false },
    ASR_FAILED: { message: '本地转录失败。', hint: '请检查本机转录服务后重试。', retriable: true },
    CANCELLED: { message: '转录已取消。', hint: '可在准备好后重新开始任务。', retriable: false },
    INVALID_REQUEST: { message: '本机转录请求无效。', hint: '请检查视频和转录设置后重试。', retriable: false }
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
    const bvMatch = str.match(/BV[a-zA-Z0-9]{10}/i) || str.match(/BV[a-zA-Z0-9]+/i);
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

  function sortQueue(items) {
    return items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  async function readQueueFromStorage() {
    const storage = getStorageArea();
    if (!storage) {
      const items = Object.values(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {});
      const sanitized = items.map(sanitizeQueueItemForPersistence);
      globalThis.__BSE_MEMORY_QUEUE_ITEMS__ = Object.fromEntries(sanitized.map((item) => [item.id, item]));
      return sanitized;
    }
    try {
      const res = await storage.get(null);
      const entries = Object.entries(res || {})
        .filter(([key, value]) => key.startsWith(STORAGE_KEY_ITEM_PREFIX) && value?.id)
      const items = entries.map(([, value]) => value);
      // Read old installations without making the legacy array the source of truth.
      const isLegacyArray = !items.length && Array.isArray(res?.[STORAGE_KEY_QUEUE]);
      const sourceItems = isLegacyArray ? res[STORAGE_KEY_QUEUE] : items;
      const sanitizedItems = sourceItems.map(sanitizeQueueItemForPersistence);
      const changed = isLegacyArray || sourceItems.some((item, index) => (
        JSON.stringify(item) !== JSON.stringify(sanitizedItems[index])
      ));
      if (changed) {
        const values = {};
        sanitizedItems.forEach((item) => { values[itemStorageKey(item.id)] = item; });
        if (Object.keys(values).length) await storage.set(values);
        if (isLegacyArray && storage.remove) await storage.remove(STORAGE_KEY_QUEUE);
      }
      return sanitizedItems;
    } catch {
      return [];
    }
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

  async function writeItems(items, replace = false) {
    const snapshots = (items || []).map(sanitizeQueueItemForPersistence);
    const storage = getStorageArea();
    if (!storage) {
      const next = replace ? {} : { ...(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {}) };
      snapshots.forEach((item) => { next[item.id] = item; });
      globalThis.__BSE_MEMORY_QUEUE_ITEMS__ = next;
      return;
    }
    const current = await storage.get(null);
    const oldKeys = Object.keys(current || {}).filter((key) => key.startsWith(STORAGE_KEY_ITEM_PREFIX));
    const values = {};
    snapshots.forEach((item) => { values[itemStorageKey(item.id)] = item; });
    const removed = replace ? oldKeys.filter((key) => !(key in values)) : [];
    if (removed.length && storage.remove) await storage.remove(removed);
    if (Object.keys(values).length) await storage.set(values);
    // Remove the old whole-array representation after migration.
    if (storage.remove && Object.prototype.hasOwnProperty.call(current || {}, STORAGE_KEY_QUEUE)) {
      await storage.remove(STORAGE_KEY_QUEUE);
    }
  }

  // Every queue mutation in this context enters here. Items are stored independently,
  // so executors in other extension contexts cannot overwrite unrelated jobs.
  let mutationTail = Promise.resolve();
  function serializeQueueMutation(mutator) {
    const operation = mutationTail.then(async () => {
      const queue = sortQueue(await readQueueFromStorage());
      return mutator(queue);
    });
    mutationTail = operation.catch(() => {});
    return operation;
  }

  async function getQueue() {
    await mutationTail;
    return sortQueue(await readQueueFromStorage());
  }

  async function saveQueue(items) {
    return serializeQueueMutation(async () => {
      await writeItems(items, true);
      return items;
    });
  }

  async function saveItem(updatedItem) {
    const itemSnapshot = safeClone(updatedItem);
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
        await writeItems([itemSnapshot], false);
        return true;
      }
      return false;
    });
    if (success) {
      broadcastQueueUpdate();
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
    const processed = formatCuesToStructured(completeCues, item.title, item.author, item.url);
    if (!processed.cueCount || !processed.plainText.trim()) {
      throw nativeError('RESULT_INCOMPLETE', '字幕结果不完整。', '未收到有效且非空的字幕内容。');
    }
    item.subtitle = {
      language: details.language || 'auto',
      langDoc: details.langDoc || details.language || '自动识别',
      source: details.source,
      engine: details.engine,
      ...(details.captionKind ? { captionKind: details.captionKind } : {}),
      cueCount: processed.cueCount,
      plainText: processed.plainText,
      markdown: processed.markdown,
      srt: processed.srt,
      cues: processed.cues
    };
    delete item.error;
    delete item.errorCode;
    delete item.errorHint;
    delete item.retriable;
  }

  async function transcribeWithNativeHost(item, source, signal) {
    if (isCantoneseLanguage(item.sourceLanguage)) {
      throw nativeError('ASR_LANGUAGE_UNSUPPORTED', '本机模型不支持粤语。', '请使用平台提供的粤语字幕，或选择受支持的语言。', false);
    }
    if (!BSE.NativeHost?.transcribe) {
      throw nativeError('NATIVE_HOST_NOT_INSTALLED', '未检测到 SparkSub 本机转录服务。', '请安装本机转录服务后重试。', false);
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
    try {
      result = await BSE.NativeHost.transcribe({
        jobId: nextNativeJobId(item, 'asr'),
        sourceLanguage: item.sourceLanguage || 'auto',
        title: item.title,
        ...(Number.isFinite(Number(item.duration)) ? { duration: Number(item.duration) } : {}),
        source
      }, { onProgress, signal });
    } finally {
      await writeTail;
    }
    const cues = normalizeCompleteCues(result);
    if (!cues.length) {
      throw nativeError('RESULT_INCOMPLETE', '本机转录结果不完整。', '本机服务没有返回有效的字幕内容。');
    }
    return cues;
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
      if (error?.code === 'CAPTIONS_NOT_FOUND') return null;
      throw error;
    } finally {
      await writeTail;
    }

    const cues = normalizeCompleteCues(result?.cues);
    if (!cues.length
      || typeof result?.language !== 'string' || !result.language.trim()
      || typeof result?.langDoc !== 'string' || !result.langDoc.trim()
      || !['manual', 'auto', 'translated'].includes(result?.kind)) {
      throw nativeError('RESULT_INCOMPLETE', '本机字幕结果不完整。', '本机服务没有返回有效的 YouTube 字幕。');
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
    const queue = await getQueue();
    return queue.find((i) => i.id === id) || null;
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
  async function recoverStaleJobs() {
    return serializeQueueMutation(async (queue) => {
      const runningStages = ['resolving', 'fetching_caption', 'fetching_audio', 'transcribing', 'postprocessing'];
      const changed = [];
      const now = Date.now();

      for (const item of queue) {
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
      if (changed.length) await writeItems(changed);
      if (changed.length) broadcastQueueUpdate();
      return queue;
    });
  }

  /**
   * 添加单个或批量视频到后台转录队列
   * @param {string | string[]} urlsOrIds
   * @param {{ title?: string, author?: string, cover?: string }} [options]
   * @returns {Promise<Array<import('../types/bse').QueueItem>>}
   */
  async function addToQueue(urlsOrIds, options = {}) {
    const rawList = Array.isArray(urlsOrIds) ? urlsOrIds : [urlsOrIds];
    const addedItems = [];
    const settings = await getSettings();
    await serializeQueueMutation(async (queue) => {
      for (const raw of rawList) {
        const rawString = typeof raw === 'object' && raw ? (raw.url || raw.targetId || raw.cleanUrl || '') : String(raw || '');
        const opt = typeof raw === 'object' && raw ? { ...options, ...raw } : options;
        const parsed = normalizeVideoUrl(rawString);
        if (!parsed) continue;

        const itemId = parsed.platform === 'bilibili' && parsed.page && parsed.page > 1
          ? `${parsed.targetId}:p${parsed.page}`
          : parsed.targetId;

        const existingIndex = queue.findIndex((item) => item.id === itemId);
        if (existingIndex >= 0) {
          const existing = queue[existingIndex];
          // 若已完成，返回已有项；若失败，重置为排队重试
          if (existing.stage === 'failed') {
            resetForRetry(existing);
            if (typeof opt.sourceLanguage === 'string' && opt.sourceLanguage.trim()) {
              existing.sourceLanguage = opt.sourceLanguage.trim();
            }
            addedItems.push(existing);
          } else {
            addedItems.push(existing);
          }
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
          addedAt: Date.now(),
          metaCache: {
            title: opt.title,
            author: opt.author,
            cover: opt.cover
          }
        };

        queue.push(newItem);
        addedItems.push(newItem);
      }
      if (addedItems.length > 0) await writeItems(addedItems);
    });
    if (addedItems.length > 0) {
      broadcastQueueUpdate();
      notifyOrchestrator();
    }

    return addedItems;
  }

  async function removeFromQueue(id) {
    cancelInFlight(id);
    const removed = await serializeQueueMutation(async (queue) => {
      if (!queue.some((item) => item.id === id)) return false;
      await writeItems(queue.filter((item) => item.id !== id), true);
      return true;
    });
    if (removed) {
      broadcastQueueUpdate();
      return true;
    }
    return false;
  }

  async function clearCompleted() {
    const removedCount = await serializeQueueMutation(async (queue) => {
      const nextQueue = queue.filter((i) => i.stage !== 'done');
      const count = queue.length - nextQueue.length;
      if (count) await writeItems(nextQueue, true);
      return count;
    });
    if (removedCount > 0) {
      broadcastQueueUpdate();
    }
    return removedCount;
  }

  async function clearAll() {
    cancelAllInFlight();
    await saveQueue([]);
    broadcastQueueUpdate();
  }

  async function retryItem(id) {
    cancelInFlight(id);
    const item = await serializeQueueMutation(async (queue) => {
      const target = queue.find((i) => i.id === id);
      if (!target) return null;
      resetForRetry(target);
      await writeItems([target]);
      return target;
    });
    if (!item) return null;
    broadcastQueueUpdate();
    notifyOrchestrator();
    return item;
  }

  function broadcastQueueUpdate() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BSE_QUEUE_UPDATED' }).catch(() => {});
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
    const queue = await getQueue();
    const completed = queue.filter((item) => item.stage === 'done' && item.subtitle?.plainText);
    const targetItems = itemIds && itemIds.length
      ? completed.filter((item) => itemIds.includes(item.id))
      : completed;

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

  async function processBilibiliItem(item, signal) {
    const bvid = item.targetId;
    const pageMatch = String(item.id || item.url || '').match(/[?&]p=(\d+)|:p(\d+)/i);
    const targetPageNum = pageMatch ? parseInt(pageMatch[1] || pageMatch[2], 10) : (item.page || 1);

    // === Stage 1: Resolving ===
    if (!item.metaCache?.cid || !item.metaCache?.title) {
      await enterStage(item, 'resolving', 15, '正在解析视频元数据与分P CID…');

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
      const targetPage = (vData.pages || []).find((p) => p.page === targetPageNum) || vData.pages?.[0];
      const cid = targetPage?.cid || vData.cid;

      item.title = vData.title || item.title;
      if (targetPage && targetPage.part && vData.pages?.length > 1) {
        item.title = `${vData.title} - P${targetPage.page} ${targetPage.part}`;
      }
      item.author = vData.owner?.name || item.author;
      item.cover = vData.pic || item.cover;
      item.metaCache = {
        title: item.title,
        author: item.author,
        cover: item.cover,
        cid,
        pages: (vData.pages || []).map((p) => ({ page: p.page, cid: p.cid, part: p.part }))
      };
      item.stageArtifacts = { ...(item.stageArtifacts || {}), metadataResolved: true };
      await saveItem(item);
    }

    const cid = item.metaCache.cid;

    // === Stage 2: Fetching Caption ===
    let subtitles = item.stageArtifacts?.captionTracks || [];
    let captionBody = item.stageArtifacts?.captionBody || null;
    if (!subtitles.length) {
      await enterStage(item, 'fetching_caption', 40, '正在提取官方/AI字幕…');
      const { imgKey, subKey } = await fetchBilibiliNavKeys(signal);
      const signed = calculateWbiSign({ bvid, cid }, imgKey, subKey);
      const playerResp = await BSE.Utils.fetchWithTimeout(
        `https://api.bilibili.com/x/player/wbi/v2?${signed.query}`,
        { signal, credentials: 'include' },
        7000
      );
      const playerJson = await playerResp.json();
      subtitles = playerJson?.data?.subtitle?.subtitles || [];
      item.stageArtifacts = { ...(item.stageArtifacts || {}), captionTracks: subtitles };
      await saveItem(item);
    }

    const captionCandidates = rankCaptionTracks(subtitles, item.sourceLanguage);
    const cachedCaptionTrackId = item.stageArtifacts?.captionTrackId || '';
    const cachedCues = normalizeCompleteCues(captionBody);
    let chosenSub = null;
    let cues = [];
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
          const subContentResp = await BSE.Utils.fetchWithTimeout(subUrl, { signal, credentials: 'include' }, 7000);
          const subContentJson = await subContentResp.json();
          const candidateCues = normalizeCompleteCues(subContentJson?.body || []);
          if (!candidateCues.length) continue;
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
      await enterStage(item, 'fetching_audio', 60, '平台字幕不可用，正在准备本地转录…');
      const playUrlResp = await BSE.Utils.fetchWithTimeout(
        `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=4048`,
        { signal, credentials: 'include' },
        6000
      );
      const playJson = await playUrlResp.json();
      const source = BSE.Media?.selectBilibiliAudio(playJson?.data?.dash?.audio || []);
      if (!source) {
        throw nativeError('MEDIA_DOWNLOAD_FAILED', '无法获取可用的 Bilibili 音频流。', '请确认视频公开可访问后重试。');
      }
      cues = await transcribeWithNativeHost(item, source, signal);
      await enterStage(item, 'postprocessing', 95, '正在整理本地转录结果…');
      setCompletedSubtitle(item, cues, {
        language: item.sourceLanguage || 'auto',
        langDoc: '本地自动转录',
        source: 'native',
        engine: 'local-asr'
      });
    } else {
      await enterStage(item, 'postprocessing', 85, '正在进行自然段落切分与 Markdown 格式化…');
      setCompletedSubtitle(item, cues, {
        language: chosenSub?.lan || 'auto',
        langDoc: chosenSub?.lan_doc || chosenSub?.lan || '平台字幕',
        source: 'platform',
        engine: 'bilibili'
      });
    }

    item.stage = 'done';
    item.progress = 100;
    item.stageHint = `完成 · 共 ${item.subtitle.cueCount} 句字幕`;
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

    // Strategy 0: Ask active YouTube tab (via live MAIN world session bridge)
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        for (const tab of tabs) {
          if (!tab.id) continue;
          try {
            const res = await new Promise((resolve) => {
              const timer = setTimeout(() => resolve(null), 5000);
              chrome.tabs.sendMessage(tab.id, { type: 'BSE_RESOLVE_YOUTUBE_IN_TAB', videoId })
                .then((r) => { clearTimeout(timer); resolve(r); })
                .catch(() => { clearTimeout(timer); resolve(null); });
            });
            if (res?.ok && res.result) {
              const r = res.result;
              if (r.title) title = r.title;
              if (r.author) author = r.author;
              if (r.cover) cover = r.cover;
              if (Array.isArray(r.captionTracks) && r.captionTracks.length) captionTracks = r.captionTracks;
              if (r.rawText) {
                rawText = r.rawText;
                chosenTrack = r.chosenTrack;
                return { title, author, cover, captionTracks, rawText, chosenTrack };
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

    return { title, author, cover, captionTracks, rawText, chosenTrack };
  }

  async function processYouTubeItem(item, signal) {
    const videoId = item.targetId;

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
      cues = await transcribeWithNativeHost(item, source, signal);
      await enterStage(item, 'postprocessing', 95, '正在整理本地转录结果…');
      setCompletedSubtitle(item, cues, {
        language: item.sourceLanguage || 'auto',
        langDoc: '本地自动转录',
        source: 'native',
        engine: 'local-asr'
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
    item.stageHint = `完成 · 共 ${item.subtitle.cueCount} 句字幕`;
    item.completedAt = Date.now();
    finishExecution(item);
    await saveItem(item);
  }

  async function processPendingJobs() {
    if (isProcessingJobs) return;
    isProcessingJobs = true;

    try {
      await recoverStaleJobs();
      const settings = await getSettings();
      const maxConcurrency = Math.max(1, Math.min(4, settings.maxConcurrency || 3));

      while (true) {
        const queue = await getQueue();
        const pendingItems = queue.filter((i) => i.stage === 'queued');

        if (!pendingItems.length) {
          break;
        }

        const candidates = pendingItems.slice(0, maxConcurrency);
        const claim = async () => {
          return serializeQueueMutation(async (queue) => {
            const claimed = [];
            const now = Date.now();
            for (const candidate of candidates) {
              const item = queue.find((entry) => entry.id === candidate.id);
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
              await writeItems([item], false);
              claimed.push(safeClone(item));
            }
            return claimed;
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
    normalizeVideoUrl,
    getQueue,
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
