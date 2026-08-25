(() => {
  'use strict';

  const BSE = globalThis.BSE = globalThis.BSE || {};

  const STORAGE_KEY_QUEUE = 'bse_transcription_queue_v1';
  const STORAGE_KEY_ITEM_PREFIX = `${STORAGE_KEY_QUEUE}:item:`;
  const STORAGE_KEY_SETTINGS = 'bse_queue_settings_v1';
  const LEASE_DURATION_MS = 5 * 60 * 1000;
  const EXECUTION_LEASE_MS = LEASE_DURATION_MS;
  const EXECUTOR_ID = `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const DEFAULT_SETTINGS = {
    maxConcurrency: 2,
    autoDownload: false,
    preferredFormat: 'md',
    enableNotification: true
  };

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
      return Object.values(globalThis.__BSE_MEMORY_QUEUE_ITEMS__ || {});
    }
    try {
      const res = await storage.get(null);
      const items = Object.entries(res || {})
        .filter(([key, value]) => key.startsWith(STORAGE_KEY_ITEM_PREFIX) && value?.id)
        .map(([, value]) => value);
      // Read old installations without making the legacy array the source of truth.
      if (!items.length && Array.isArray(res?.[STORAGE_KEY_QUEUE])) {
        return res[STORAGE_KEY_QUEUE];
      }
      return items;
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
    const snapshots = (items || []).map(safeClone);
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
        if (itemSnapshot.leaseOwner && current.leaseOwner && current.leaseOwner !== itemSnapshot.leaseOwner) return false;
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
            existing.stage = 'queued';
            existing.error = undefined;
            existing.progress = 0;
            existing.stageHint = '重新排队中';
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
    await saveQueue([]);
    broadcastQueueUpdate();
  }

  async function retryItem(id) {
    const item = await serializeQueueMutation(async (queue) => {
      const target = queue.find((i) => i.id === id);
      if (!target) return null;
      target.stage = 'queued';
      target.error = undefined;
      target.progress = 0;
      target.stageHint = '重新排队中…';
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
    if (!captionBody && !subtitles.length) {
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

    if (!subtitles.length && !captionBody) {
      // 尝试回退至音频探测
      await enterStage(item, 'fetching_audio', 60, '未发现字幕轨道，正在探测音频直链…');

      const playUrlResp = await BSE.Utils.fetchWithTimeout(
        `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=4048`,
        { signal, credentials: 'include' },
        6000
      );
      const playJson = await playUrlResp.json();
      const audioUrl = playJson?.data?.dash?.audio?.[0]?.baseUrl || playJson?.data?.dash?.audio?.[0]?.base_url;
      if (audioUrl) {
        item.audioCache = { audioUrl, bandwidth: playJson?.data?.dash?.audio?.[0]?.bandwidth || 0 };
        item.subtitle = {
          language: 'audio_stream',
          langDoc: '音频直链已就绪 (无内嵌字幕)',
          cueCount: 0,
          plainText: `该视频暂无内置字幕，已成功提取 DASH 音频直链 (${Math.round((item.audioCache.bandwidth || 0) / 1000)}kbps)，可用于后续 ASR 转录。`,
          markdown: `> 提示：该视频暂无官方或 AI 字幕，已成功获取音频直链。`
        };
        item.stage = 'done';
        item.progress = 100;
        item.stageHint = '无字幕 · 已提取音频直链';
        item.completedAt = Date.now();
        finishExecution(item);
        await saveItem(item);
        return;
      }
      throw new Error('该视频暂无字幕轨道，且无法获取音频流');
    }

    const chosenSub = subtitles.find((s) => /zh|cn|中/i.test(s.lan || s.lan_doc || ''))
      || subtitles[0]
      || item.stageArtifacts?.chosenCaption;
    let subUrl = chosenSub?.subtitle_url || chosenSub?.url || '';
    if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
    else if (subUrl.startsWith('http://')) subUrl = subUrl.replace(/^http:\/\//i, 'https://');

    if (!captionBody) {
      await enterStage(item, 'fetching_caption', 50, `正在下载《${chosenSub?.lan_doc || chosenSub?.lan || '默认'}》字幕…`);
      const subContentResp = await BSE.Utils.fetchWithTimeout(subUrl, { signal, credentials: 'include' }, 7000);
      const subContentJson = await subContentResp.json();
      captionBody = subContentJson?.body || [];
      item.stageArtifacts = { ...(item.stageArtifacts || {}), captionBody, chosenCaption: { lan: chosenSub?.lan, lan_doc: chosenSub?.lan_doc } };
      await saveItem(item);
    }
    const rawBody = captionBody;

    if (!rawBody.length) {
      throw new Error('字幕内容为空');
    }

    const cues = rawBody.map((b) => ({
      from: Number(b.from || 0),
      to: Number(b.to || 0),
      content: String(b.content || '').trim()
    }));

    // === Stage 3: Postprocessing ===
    await enterStage(item, 'postprocessing', 85, '正在进行自然段落切分与 Markdown 格式化…');

    const processed = formatCuesToStructured(cues, item.title, item.author, item.url);

    item.subtitle = {
      language: chosenSub?.lan,
      langDoc: chosenSub?.lan_doc || '中文',
      cueCount: processed.cueCount,
      plainText: processed.plainText,
      markdown: processed.markdown,
      srt: processed.srt,
      cues: processed.cues
    };

    // === Stage 4: Done ===
    item.stage = 'done';
    item.progress = 100;
    item.stageHint = `完成 · 共 ${processed.cueCount} 句字幕`;
    item.completedAt = Date.now();
    finishExecution(item);
    await saveItem(item);
  }

  async function resolveYouTubeMetadataAndCaptions(videoId, signal) {
    let captionTracks = [];
    let title = '';
    let author = '';
    let cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

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
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11)'
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
        const resp = await BSE.Utils.fetchWithTimeout(watchUrl, { signal }, 8000);
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

    return { title, author, cover, captionTracks };
  }

  async function processYouTubeItem(item, signal) {
    const videoId = item.targetId;

    // === Stage 1: Resolving & Fetching Caption Metadata ===
    let captionTracks = item.metaCache?.captionTracks || [];
    if (!captionTracks.length) {
      await enterStage(item, 'resolving', 20, '正在调用 YouTube 接口解析字幕…');
      const resolved = await resolveYouTubeMetadataAndCaptions(videoId, signal);
      captionTracks = resolved.captionTracks || [];
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
      await saveItem(item);
    } else {
      item.title = item.metaCache.title || item.title;
      item.author = item.metaCache.author || item.author;
      item.cover = item.metaCache.cover || item.cover;
    }

    if (!captionTracks || !captionTracks.length) {
      throw new Error('该 YouTube 视频未提供字幕轨道');
    }

    const chosenTrack = captionTracks.find((t) => /zh|cn|chinese|中/i.test(t.languageCode || t.name?.simpleText || ''))
      || captionTracks.find((t) => /en|english/i.test(t.languageCode || t.name?.simpleText || ''))
      || captionTracks[0];

    // Download Caption with Multi-format Resilience (JSON3 / XML / TTML / VTT)
    let rawCaptionText = item.stageArtifacts?.captionText || '';
    if (!rawCaptionText) {
      await enterStage(item, 'fetching_caption', 50, `正在下载《${chosenTrack.name?.simpleText || chosenTrack.languageCode || '默认'}》字幕…`);
      try {
        const json3Url = chosenTrack.baseUrl.includes('fmt=') ? chosenTrack.baseUrl : `${chosenTrack.baseUrl}&fmt=json3`;
        const resp = await BSE.Utils.fetchWithTimeout(json3Url, { signal }, 8000);
        rawCaptionText = await resp.text();
      } catch {}

      if (!rawCaptionText || rawCaptionText.includes('<!DOCTYPE html>')) {
        const resp = await BSE.Utils.fetchWithTimeout(chosenTrack.baseUrl, { signal }, 8000);
        rawCaptionText = await resp.text();
      }
      if (rawCaptionText && !rawCaptionText.includes('<!DOCTYPE html>')) {
        item.stageArtifacts = { ...(item.stageArtifacts || {}), captionText: rawCaptionText };
        await saveItem(item);
      }
    }

    if (!rawCaptionText || rawCaptionText.includes('<!DOCTYPE html>')) {
      throw new Error('无法拉取 YouTube 字幕内容');
    }

    const cues = BSE.Parsers.parse(rawCaptionText);
    if (!cues || !cues.length) {
      throw new Error('YouTube 字幕数据为空或无法解析');
    }

    // === Stage 2: Postprocessing ===
    await enterStage(item, 'postprocessing', 85, '正在整理结构化段落与 SRT…');

    const processed = formatCuesToStructured(cues, item.title, item.author, item.url);

    item.subtitle = {
      language: chosenTrack.languageCode,
      langDoc: chosenTrack.name?.simpleText || chosenTrack.languageCode,
      cueCount: processed.cueCount,
      plainText: processed.plainText,
      markdown: processed.markdown,
      srt: processed.srt,
      cues: processed.cues
    };

    // === Stage 3: Done ===
    item.stage = 'done';
    item.progress = 100;
    item.stageHint = `完成 · 共 ${processed.cueCount} 句字幕`;
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
            for (const candidate of candidates) {
              const item = queue.find((entry) => entry.id === candidate.id);
              if (!item || item.stage !== 'queued' || (item.leaseOwner && item.leaseOwner !== EXECUTOR_ID)) continue;
              item.leaseOwner = EXECUTOR_ID;
              item.leaseExpiresAt = Date.now() + LEASE_DURATION_MS;
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
            item.startedAt = Date.now();
            item.stageUpdatedAt = item.startedAt;
            item.executionLease = {
              owner: `queue-${item.id}`,
              acquiredAt: item.startedAt,
              expiresAt: item.startedAt + EXECUTION_LEASE_MS
            };
            await saveItem(item);
            try {
              if (item.platform === 'bilibili') {
                await processBilibiliItem(item, controller.signal);
              } else if (item.platform === 'youtube') {
                await processYouTubeItem(item, controller.signal);
              }
            } catch (err) {
              if (err?.name === 'AbortError') return;
              item.stage = 'failed';
              item.progress = 0;
              item.error = err.message || '转录处理异常';
              item.stageHint = `失败：${item.error}`;
              finishExecution(item);
              await saveItem(item);
            } finally {
              inFlightControllers.delete(item.id);
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
