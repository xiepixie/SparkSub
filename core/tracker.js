(() => {
  'use strict';

  const BSE = globalThis.BSE = globalThis.BSE || {};

  const STORAGE_KEYS = Object.freeze({
    SUBSCRIPTIONS: 'bse_subscriptions',
    SETTINGS: 'bse_tracker_settings',
    BACKOFF: 'bse_tracker_backoff'
  });

  const MAX_HISTORY_PER_SUB = 20;
  const MAX_SUBSCRIPTIONS = 100;
  const MAX_CACHED_SUBTITLE_CHARS = 3_500_000;
  const MAX_SINGLE_SUBTITLE_CHARS = 750_000;

  const DEFAULT_SETTINGS = Object.freeze({
    checkIntervalMinutes: 60,
    enableNotification: true,
    enableBadge: true,
    autoExtractSubtitles: false
  });

  function normalizeSettings(value = {}) {
    const requestedInterval = Number(value.checkIntervalMinutes);
    const checkIntervalMinutes = requestedInterval === 0
      ? 0
      : Math.min(1440, Math.max(5, Number.isFinite(requestedInterval) ? requestedInterval : DEFAULT_SETTINGS.checkIntervalMinutes));
    return {
      checkIntervalMinutes,
      enableNotification: value.enableNotification !== false,
      enableBadge: value.enableBadge !== false,
      autoExtractSubtitles: value.autoExtractSubtitles === true
    };
  }

  // === 1. Lightweight Pure-JS MD5 Implementation ===
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

  function md5ff(a, b, c, d, x, s, t) {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }

  function md5gg(a, b, c, d, x, s, t) {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }

  function md5hh(a, b, c, d, x, s, t) {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5ii(a, b, c, d, x, s, t) {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function binlMD5(x, len) {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < x.length; i += 16) {
      const olda = a;
      const oldb = b;
      const oldc = c;
      const oldd = d;

      a = md5ff(a, b, c, d, x[i], 7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, x[i], 11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = md5ii(a, b, c, d, x[i], 6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }

  function rstr2binl(input) {
    const output = [];
    output[(input.length >> 2) - 1] = undefined;
    for (let i = 0; i < output.length; i++) output[i] = 0;
    const length8 = input.length * 8;
    for (let i = 0; i < length8; i += 8) {
      output[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << (i % 32);
    }
    return output;
  }

  function binl2hex(binarray) {
    const hexTab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0x0f)
        + hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0x0f);
    }
    return str;
  }

  function md5(string) {
    const utf8Str = unescape(encodeURIComponent(string));
    return binl2hex(binlMD5(rstr2binl(utf8Str), utf8Str.length * 8));
  }

  // === 2. Bilibili WBI Mixin Key Calculator ===
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
  ];

  function getMixinKey(origKey) {
    return MIXIN_KEY_ENC_TAB.map((n) => origKey[n]).join('').slice(0, 32);
  }

  function calculateWbiSign(params = {}, imgKey = '', subKey = '') {
    const rawKey = (imgKey || '') + (subKey || '');
    const mixinKey = rawKey.length >= 64 ? getMixinKey(rawKey) : '';
    const currTime = Math.round(Date.now() / 1000);
    const chrFilter = /[!'()*]/g;
    const queryMap = Object.assign({}, params, { wts: currTime });

    const sortedKeys = Object.keys(queryMap).sort();
    const queryParts = [];
    for (const key of sortedKeys) {
      let val = queryMap[key];
      if (val === undefined || val === null) continue;
      val = String(val).replace(chrFilter, '');
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }

    const queryString = queryParts.join('&');
    if (!mixinKey) {
      return { params: queryMap, query: queryString };
    }
    const wbiSign = md5(queryString + mixinKey);
    queryMap.w_rid = wbiSign;
    return {
      params: queryMap,
      query: `${queryString}&w_rid=${wbiSign}`
    };
  }

  // === 3. Zero-DOM Pure-Regex YouTube RSS XML Parser ===
  function parseYouTubeRssFeed(xmlText = '') {
    if (!xmlText || typeof xmlText !== 'string') return [];
    const entries = [];
    const entryRegex = /<entry[\s\S]*?>([\s\S]*?)<\/entry>/gi;
    let match;

    const unescapeXml = (str = '') => str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    while ((match = entryRegex.exec(xmlText)) !== null) {
      const block = match[1];
      const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
      const titleMatch = block.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pubMatch = block.match(/<published>([^<]+)<\/published>/i);
      const authorMatch = block.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/i);

      if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1].trim();
        const title = unescapeXml(titleMatch ? titleMatch[1] : '');
        const pubStr = pubMatch ? pubMatch[1].trim() : '';
        const author = unescapeXml(authorMatch ? authorMatch[1] : '');
        const pubdate = pubStr ? new Date(pubStr).getTime() : Date.now();

        entries.push({
          id: videoId,
          title: title || `YouTube 视频 ${videoId}`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          pubdate,
          author
        });
      }
    }
    return entries;
  }

  // === 4. Storage Operations with 20-Item Buffer Cap & Memory Fallback ===
  const _memoryStorage = new Map();

  async function getStorageItem(key, defaultValue, areaName = 'local') {
    const area = typeof chrome !== 'undefined' ? chrome?.storage?.[areaName] : null;
    if (area) {
      try {
        const data = await area.get(key);
        return data[key] !== undefined ? data[key] : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    return _memoryStorage.has(key) ? _memoryStorage.get(key) : defaultValue;
  }

  async function setStorageItem(key, value, areaName = 'local') {
    const area = typeof chrome !== 'undefined' ? chrome?.storage?.[areaName] : null;
    if (area) {
      try {
        await area.set({ [key]: value });
      } catch (error) {
        throw new Error(`无法写入 ${areaName} 存储：${error?.message || error}`);
      }
    }
    _memoryStorage.set(key, value);
  }

  async function getSubscriptions() {
    const list = await getStorageItem(STORAGE_KEYS.SUBSCRIPTIONS, []);
    return Array.isArray(list) ? list : [];
  }

  function compactSubscriptions(subs) {
    const originalById = new Map((subs || []).map((sub) => [sub.id, sub]));
    const sanitized = (subs || []).slice(0, MAX_SUBSCRIPTIONS).map((s) => ({
      ...s,
      id: String(s.id || '').slice(0, 256),
      title: String(s.title || '').slice(0, 300),
      author: String(s.author || '').slice(0, 200),
      avatar: String(s.avatar || '').slice(0, 2048),
      sourceUrl: String(s.sourceUrl || '').slice(0, 2048),
      targetId: String(s.targetId || '').slice(0, 256),
      unreadCount: Math.min(Number(s.unreadCount) || 0, MAX_HISTORY_PER_SUB),
      items: Array.isArray(s.items) ? s.items.slice(0, MAX_HISTORY_PER_SUB).map((item) => ({
        ...item,
        id: String(item.id || '').slice(0, 256),
        title: String(item.title || '').slice(0, 500),
        author: String(item.author || '').slice(0, 200),
        url: String(item.url || '').slice(0, 2048),
        subtitle: item.subtitle ? {
          ...item.subtitle,
          markdown: undefined,
          plainText: undefined
        } : item.subtitle
      })) : []
    }));

    const candidates = [];
    sanitized.forEach((sub, subIndex) => {
      const originalSub = originalById.get(sub.id) || {};
      sub.items.forEach((item, itemIndex) => {
        const original = originalSub.items?.find((entry) => entry.id === item.id);
        const markdown = String(original?.subtitle?.markdown || '');
        const plainText = markdown ? '' : String(original?.subtitle?.plainText || '');
        const content = markdown || plainText;
        if (!content) return;
        candidates.push({
          subIndex,
          itemIndex,
          content,
          field: markdown ? 'markdown' : 'plainText',
          unread: itemIndex < (sub.unreadCount || 0),
          fetchedAt: Number(original?.subtitle?.fetchedAt || item.pubdate || 0)
        });
      });
    });
    candidates.sort((a, b) => Number(b.unread) - Number(a.unread) || b.fetchedAt - a.fetchedAt);

    let remaining = MAX_CACHED_SUBTITLE_CHARS;
    let evictedCount = 0;
    for (const candidate of candidates) {
      const subtitle = sanitized[candidate.subIndex].items[candidate.itemIndex].subtitle;
      if (candidate.content.length <= MAX_SINGLE_SUBTITLE_CHARS && candidate.content.length <= remaining) {
        subtitle[candidate.field] = candidate.content;
        remaining -= candidate.content.length;
      } else {
        subtitle.status = 'evicted';
        subtitle.errorHint = '字幕正文已按缓存容量策略释放，可点击重新提取';
        evictedCount++;
      }
    }
    return { subscriptions: sanitized, evictedCount, cachedChars: MAX_CACHED_SUBTITLE_CHARS - remaining };
  }

  function getStorageStats(subs = []) {
    const compacted = compactSubscriptions(subs);
    return {
      subscriptionCount: compacted.subscriptions.length,
      itemCount: compacted.subscriptions.reduce((sum, sub) => sum + sub.items.length, 0),
      cachedSubtitleCount: compacted.subscriptions.reduce((sum, sub) => sum + sub.items.filter((item) => item.subtitle?.markdown || item.subtitle?.plainText).length, 0),
      evictedCount: compacted.evictedCount,
      approximateBytes: new TextEncoder().encode(JSON.stringify(compacted.subscriptions)).length
    };
  }

  async function saveSubscriptions(subs) {
    const { subscriptions: sanitized } = compactSubscriptions(subs);
    await setStorageItem(STORAGE_KEYS.SUBSCRIPTIONS, sanitized);
    return true;
  }

  async function getSubscription(id) {
    const list = await getSubscriptions();
    return list.find((s) => s.id === id) || null;
  }

  async function addSubscription(subData) {
    if (!subData?.id || !subData?.platform || !subData?.type) {
      throw new Error('订阅数据缺少必要标识 (id, platform, type)');
    }
    const list = await getSubscriptions();
    const existingIndex = list.findIndex((s) => s.id === subData.id);

    const now = Date.now();
    const sub = {
      id: subData.id,
      platform: subData.platform,
      type: subData.type,
      title: String(subData.title || '').trim() || '未命名订阅',
      author: String(subData.author || '').trim(),
      avatar: subData.avatar || '',
      targetId: String(subData.targetId || '').trim(),
      sourceUrl: subData.sourceUrl || '',
      ownerId: String(subData.ownerId || '').trim(),
      subscribedAt: existingIndex >= 0 ? list[existingIndex].subscribedAt : now,
      lastCheckedAt: existingIndex >= 0 ? list[existingIndex].lastCheckedAt : 0,
      lastUpdatedItemId: existingIndex >= 0 ? list[existingIndex].lastUpdatedItemId : '',
      lastUpdatedTitle: existingIndex >= 0 ? list[existingIndex].lastUpdatedTitle : '',
      unreadCount: existingIndex >= 0 ? list[existingIndex].unreadCount : 0,
      items: existingIndex >= 0 ? list[existingIndex].items : [],
      autoExtractSubtitle: Boolean(subData.autoExtractSubtitle)
    };

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...sub };
    } else {
      list.unshift(sub);
    }
    await saveSubscriptions(list);
    return sub;
  }

  async function removeSubscription(id) {
    const list = await getSubscriptions();
    const filtered = list.filter((s) => s.id !== id);
    if (filtered.length !== list.length) {
      await saveSubscriptions(filtered);
      return true;
    }
    return false;
  }

  async function renameSubscription(id, newTitle) {
    if (!id || typeof newTitle !== 'string') return null;
    const title = newTitle.trim();
    if (!title) return null;
    const list = await getSubscriptions();
    const sub = list.find((s) => s.id === id);
    if (!sub) return null;
    sub.title = title;
    await saveSubscriptions(list);
    return sub;
  }

  async function markAsRead(subscriptionId, itemId) {
    const list = await getSubscriptions();
    const sub = list.find((s) => s.id === subscriptionId);
    if (!sub) return;

    if (!itemId) {
      sub.unreadCount = 0;
    } else {
      sub.unreadCount = Math.max(0, (sub.unreadCount || 0) - 1);
    }
    await saveSubscriptions(list);
  }

  async function markAllAsRead() {
    const list = await getSubscriptions();
    list.forEach((s) => { s.unreadCount = 0; });
    await saveSubscriptions(list);
  }

  async function getSettings() {
    let data = await getStorageItem(STORAGE_KEYS.SETTINGS, null, 'sync');
    if (!data) {
      data = await getStorageItem(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
      await setStorageItem(STORAGE_KEYS.SETTINGS, data, 'sync').catch(() => {});
    }
    return normalizeSettings(data);
  }

  async function saveSettings(settingsPatch) {
    const current = await getSettings();
    const updated = normalizeSettings(Object.assign({}, current, settingsPatch));
    await setStorageItem(STORAGE_KEYS.SETTINGS, updated, 'sync');
    return updated;
  }

  // === 5. Exponential Backoff & Failure Circuit Breaker ===
  async function getBackoffState() {
    return await getStorageItem(STORAGE_KEYS.BACKOFF, { failures: 0, nextCheckTime: 0 });
  }

  async function recordCheckFailure() {
    const state = await getBackoffState();
    const failures = (state.failures || 0) + 1;
    const backoffMinutes = [5, 15, 30, 60];
    const delayMinutes = backoffMinutes[Math.min(failures - 1, backoffMinutes.length - 1)];
    const nextCheckTime = Date.now() + delayMinutes * 60 * 1000;
    await setStorageItem(STORAGE_KEYS.BACKOFF, { failures, nextCheckTime });
  }

  async function resetCheckBackoff() {
    await setStorageItem(STORAGE_KEYS.BACKOFF, { failures: 0, nextCheckTime: 0 });
  }

  async function resolveYouTubeChannelId(sub, signal) {
    const cachedChannelId = String(sub.resolvedTargetId || '').trim();
    if (/^UC[\w-]{20,}$/i.test(cachedChannelId)) return cachedChannelId;
    const targetId = String(sub.targetId || '').trim();
    if (/^UC[\w-]{20,}$/i.test(targetId)) return targetId;

    const channelPath = targetId.startsWith('@') ? targetId : `@${targetId}`;
    const response = await BSE.Utils.fetchWithTimeout(
      `https://www.youtube.com/${encodeURI(channelPath)}`,
      { signal, credentials: 'omit' },
      6000
    );
    if (!response.ok) throw new Error(`YouTube 频道解析失败 (HTTP ${response.status})`);
    const html = await response.text();
    const match = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/)
      || html.match(/<meta\s+itemprop="channelId"\s+content="(UC[\w-]+)"/i);
    if (!match) throw new Error('无法从频道页面解析 YouTube Channel ID');
    return match[1];
  }

  function normalizeFetchedItems(items) {
    const unique = new Map();
    for (const item of items || []) {
      if (!item?.id || unique.has(String(item.id))) continue;
      unique.set(String(item.id), { ...item, id: String(item.id) });
    }
    return [...unique.values()].sort((a, b) => Number(b.pubdate || 0) - Number(a.pubdate || 0));
  }

  // === 6. Update Checking Implementation for Bilibili & YouTube ===
  async function fetchBilibiliNavWbiKeys(signal) {
    try {
      const resp = await BSE.Utils.fetchWithTimeout('https://api.bilibili.com/x/web-interface/nav', {
        signal,
        credentials: 'include',
        cache: 'no-store'
      }, 5000);
      const json = await resp.json();
      const wbi = json?.data?.wbi_img;
      if (wbi?.img_url && wbi?.sub_url) {
        const imgKey = wbi.img_url.slice(wbi.img_url.lastIndexOf('/') + 1, wbi.img_url.lastIndexOf('.'));
        const subKey = wbi.sub_url.slice(wbi.sub_url.lastIndexOf('/') + 1, wbi.sub_url.lastIndexOf('.'));
        return { imgKey, subKey };
      }
    } catch {}
    return { imgKey: '', subKey: '' };
  }

  async function checkSubscriptionUpdates(sub, { signal } = {}) {
    if (!sub || !sub.id) return { checked: false, updated: false, newItems: [], error: '无效订阅数据' };
    const platform = sub.platform;
    const type = sub.type;
    let fetchedItems = [];

    try {
      if (platform === BSE.PLATFORM.BILIBILI) {
        if (type === 'up') {
          // B站 UP主稿件增量查询
          const mid = encodeURIComponent(sub.targetId);
          let resJson = null;

          // 尝试直接空间搜索接口
          try {
            const resp = await BSE.Utils.fetchWithTimeout(
              `https://api.bilibili.com/x/space/arc/search?mid=${mid}&ps=10&tid=0&pn=1&order=pubdate`,
              { signal, credentials: 'include' },
              6000
            );
            resJson = await resp.json();
          } catch {}

          // 若风控拦截或需 WBI 签名，尝试 WBI 签名通道
          if (!resJson || resJson.code !== 0) {
            const { imgKey, subKey } = await fetchBilibiliNavWbiKeys(signal);
            const signed = calculateWbiSign({ mid: sub.targetId, ps: 10, pn: 1, order: 'pubdate' }, imgKey, subKey);
            const wbiResp = await BSE.Utils.fetchWithTimeout(
              `https://api.bilibili.com/x/space/wbi/arc/search?${signed.query}`,
              { signal, credentials: 'include' },
              6000
            );
            resJson = await wbiResp.json();
          }
          if (resJson?.code !== 0) {
            throw new Error(`Bilibili UP 主接口失败 (code ${resJson?.code ?? 'unknown'})`);
          }

          const vlist = resJson?.data?.list?.vlist || [];
          fetchedItems = vlist.map((v) => ({
            id: v.bvid,
            title: String(v.title || '').replace(/<[^>]+>/g, '').trim(),
            url: `https://www.bilibili.com/video/${v.bvid}`,
            pubdate: (Number(v.created) || 0) * 1000,
            duration: Number(v.length) || 0,
            author: v.author || sub.author || ''
          }));
        } else if (type === 'season') {
          // B站 专区/合集与分P连载增量查询
          const targetId = String(sub.targetId || '').trim();
          if (/^BV[a-zA-Z0-9]+/i.test(targetId)) {
            // 多P分集连载检查
            const resp = await BSE.Utils.fetchWithTimeout(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(targetId)}`, { signal }, 6000);
            const resJson = await resp.json();
            if (resJson?.code !== 0) throw new Error(`Bilibili 视频接口失败 (code ${resJson?.code ?? 'unknown'})`);
            const pages = resJson?.data?.pages || [];
            fetchedItems = pages.map((p) => ({
              id: `${targetId}:p${p.page}`,
              title: p.part || `第${p.page}P`,
              url: `https://www.bilibili.com/video/${targetId}?p=${p.page}`,
              pubdate: Date.now(),
              duration: Number(p.duration) || 0,
              author: sub.title || ''
            }));
          } else {
            // UGC 合集/系列增量检查
            const seasonId = encodeURIComponent(targetId);
            // ownerId avoids overloading the human-readable author field. Keep
            // numeric legacy values compatible with subscriptions from v0.2.0.
            const ownerId = sub.ownerId || (/^\d+$/.test(String(sub.author || '')) ? sub.author : '');
            const mid = encodeURIComponent(ownerId);
            const url = mid
              ? `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=${mid}&season_id=${seasonId}&page_num=1&page_size=20`
              : `https://api.bilibili.com/x/v2/medialist/resource/list?type=1&oid=${seasonId}&ps=20`;
            const resp = await BSE.Utils.fetchWithTimeout(url, { signal, credentials: 'include' }, 6000);
            const resJson = await resp.json();
            if (resJson?.code !== 0) throw new Error(`Bilibili 合集接口失败 (code ${resJson?.code ?? 'unknown'})`);
            const archives = resJson?.data?.archives || resJson?.data?.media_list || [];
            fetchedItems = archives.map((v) => ({
              id: v.bvid || (v.bv_id ? v.bv_id : `aid:${v.id}`),
              title: String(v.title || '').trim(),
              url: `https://www.bilibili.com/video/${v.bvid || v.bv_id || ''}`,
              pubdate: (Number(v.pubdate) || 0) * 1000,
              duration: Number(v.duration) || 0,
              author: sub.title || ''
            }));
          }
        }
      } else if (platform === BSE.PLATFORM.YOUTUBE) {
        // YouTube 官方无鉴权 RSS 订阅流查询
        const resolvedChannelId = await resolveYouTubeChannelId(sub, signal);
        const channelId = encodeURIComponent(resolvedChannelId);
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const resp = await BSE.Utils.fetchWithTimeout(rssUrl, { signal }, 6000);
        if (!resp.ok) throw new Error(`YouTube RSS 请求失败 (HTTP ${resp.status})`);
        const xmlText = await resp.text();
        fetchedItems = parseYouTubeRssFeed(xmlText);
        if (!fetchedItems.length) throw new Error('YouTube RSS 未返回有效视频');
        if (sub.targetId !== resolvedChannelId) sub.resolvedTargetId = resolvedChannelId;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return { checked: false, updated: false, newItems: [], error: err?.message || String(err) };
    }

    fetchedItems = normalizeFetchedItems(fetchedItems);
    if (!fetchedItems.length) {
      sub.lastCheckedAt = Date.now();
      return { checked: true, updated: false, newItems: [] };
    }

    const existingIds = new Set((sub.items || []).map((item) => item.id));
    const newItems = fetchedItems.filter((item) => !existingIds.has(item.id));

    // The first successful poll establishes a baseline. Existing feed entries
    // predate the subscription and must not be reported as unread updates.
    if (!sub.lastCheckedAt && existingIds.size === 0) {
      sub.items = fetchedItems.slice(0, MAX_HISTORY_PER_SUB);
      sub.lastCheckedAt = Date.now();
      sub.lastUpdatedItemId = fetchedItems[0]?.id || '';
      sub.lastUpdatedTitle = fetchedItems[0]?.title || '';
      return { checked: true, initialized: true, updated: false, newItems: [] };
    }

    if (newItems.length > 0) {
      // 自动在后台拉取新视频的字幕并缓存
      try {
        const settings = await getSettings();
        if (settings.autoExtractSubtitles !== false) {
          for (const item of newItems) {
            try {
              item.subtitle = { status: 'pending' };
              const subRes = await fetchItemSubtitle(item, { signal });
              item.subtitle = subRes;
              item.hasSubtitle = subRes.status === 'ready';
            } catch {}
          }
        }
      } catch {}

      // 合并并截断为最近 MAX_HISTORY_PER_SUB 条
      const merged = [...newItems, ...(sub.items || [])].slice(0, MAX_HISTORY_PER_SUB);
      sub.items = merged;
      sub.unreadCount = Math.min(merged.length, (sub.unreadCount || 0) + newItems.length);
      sub.lastUpdatedItemId = newItems[0].id;
      sub.lastUpdatedTitle = newItems[0].title;
      sub.lastCheckedAt = Date.now();
      return { checked: true, updated: true, newItems };
    }

    sub.lastCheckedAt = Date.now();
    return { checked: true, updated: false, newItems: [] };
  }

  function formatCuesToMarkdown(title, author, url, cues) {
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const lines = [];
    lines.push(`# ${title || '视频字幕'}`);
    lines.push('');
    lines.push(`- **${t('tracker_md_author')}**: ${author || 'UP主'}`);
    if (url) lines.push(`- **${t('tracker_md_url')}**: [${url}](${url})`);
    lines.push(`- **${t('tracker_md_extracted_time')}**: ${new Date().toLocaleString()}`);
    lines.push(`- **${t('tracker_md_lines_count')}**: ${cues.length} ${t('cues_count', { n: cues.length }).replace(/^\d+\s*/, '') || '行'}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    let currentParagraph = [];
    let startTimestamp = null;
    let endTimestamp = null;

    cues.forEach((c, idx) => {
      const from = Number(c.from || 0);
      const to = Number(c.to || 0);
      const text = String(c.content || '').trim();
      if (!text) return;

      if (startTimestamp === null) startTimestamp = from;
      endTimestamp = to;
      currentParagraph.push(text);

      const isLast = idx === cues.length - 1;
      const next = cues[idx + 1];
      const gap = next ? Number(next.from || 0) - to : 0;

      if (isLast || currentParagraph.length >= 4 || gap > 3.0 || /[。？！?!]$/.test(text)) {
        const timeHeader = `### [${BSE.Utils.formatClock(startTimestamp)} - ${BSE.Utils.formatClock(endTimestamp)}]`;
        lines.push(timeHeader);
        lines.push('');
        lines.push(currentParagraph.join(' '));
        lines.push('');
        currentParagraph = [];
        startTimestamp = null;
      }
    });

    return lines.join('\n');
  }

  async function fetchItemSubtitle(item, options = {}) {
    const signal = options.signal;
    if (!item) return { status: 'error', errorHint: '无效条目' };

    const bvidMatch = (item.id || item.url || '').match(/BV[a-zA-Z0-9]+/i);
    const bvid = bvidMatch ? bvidMatch[0] : null;

    if (bvid) {
      try {
        let cid = item.cid;
        let viewTitle = item.title;

        // 1. 若无 cid，请求 view 接口定位 cid
        if (!cid) {
          const viewResp = await BSE.Utils.fetchWithTimeout(
            `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
            { signal },
            6000
          );
          const viewJson = await viewResp.json();
          if (viewJson?.code === 0 && viewJson?.data) {
            viewTitle = viewJson.data.title || item.title;
            const pageMatch = String(item.id || item.url || '').match(/[?&]p=(\d+)|:p(\d+)/i);
            const pageNum = pageMatch ? parseInt(pageMatch[1] || pageMatch[2], 10) : 1;
            const targetPage = (viewJson.data.pages || []).find((p) => p.page === pageNum) || viewJson.data.pages?.[0];
            cid = targetPage?.cid || viewJson.data.cid;
          }
        }

        if (!cid) {
          return { status: 'not_found', errorHint: '无法定位视频分P CID', fetchedAt: Date.now() };
        }

        // 2. 调用 WBI 播放器接口提取字幕列表
        const { imgKey, subKey } = await fetchBilibiliNavWbiKeys(signal);
        const signed = calculateWbiSign({ bvid, cid }, imgKey, subKey);
        const playerResp = await BSE.Utils.fetchWithTimeout(
          `https://api.bilibili.com/x/player/wbi/v2?${signed.query}`,
          { signal, credentials: 'include' },
          6000
        );
        const playerJson = await playerResp.json();
        const subtitles = playerJson?.data?.subtitle?.subtitles || [];

        if (!subtitles.length) {
          return { status: 'not_found', errorHint: '该视频暂无官方字幕轨道', fetchedAt: Date.now() };
        }

        // 优先中文字幕
        const chosenSub = subtitles.find((s) => /zh|cn|中/i.test(s.lan || s.lan_doc || '')) || subtitles[0];
        let subUrl = chosenSub.subtitle_url || chosenSub.url || '';
        if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
        else if (subUrl.startsWith('http://')) subUrl = subUrl.replace(/^http:\/\//i, 'https://');

        // 3. 下载字幕 JSON
        const subContentResp = await BSE.Utils.fetchWithTimeout(subUrl, { signal }, 6000);
        const subContentJson = await subContentResp.json();
        const rawBody = subContentJson?.body || [];

        if (!rawBody.length) {
          return { status: 'not_found', errorHint: '字幕内容为空', fetchedAt: Date.now() };
        }

        const cues = rawBody.map((b) => ({
          from: Number(b.from || 0),
          to: Number(b.to || 0),
          content: String(b.content || '').trim()
        }));

        const plainText = cues.map((c) => c.content).join(' ');
        const markdown = formatCuesToMarkdown(viewTitle || item.title, item.author, item.url, cues);

        return {
          status: 'ready',
          language: chosenSub.lan,
          langDoc: chosenSub.lan_doc || '中文',
          cueCount: cues.length,
          fetchedAt: Date.now(),
          plainText,
          markdown
        };
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        return { status: 'error', errorHint: err?.message || '抓取字幕超时或失败', fetchedAt: Date.now() };
      }
    }

    return { status: 'not_found', errorHint: '当前平台暂不支持后台直取字幕', fetchedAt: Date.now() };
  }

  async function fetchSubtitleForItem(subscriptionId, itemId) {
    const list = await getSubscriptions();
    const sub = list.find((s) => s.id === subscriptionId);
    if (!sub) throw new Error('未找到对应订阅');
    const item = (sub.items || []).find((i) => i.id === itemId);
    if (!item) throw new Error('未找到对应视频条目');

    item.subtitle = { status: 'pending' };
    await saveSubscriptions(list);

    const subRes = await fetchItemSubtitle(item);
    item.subtitle = subRes;
    item.hasSubtitle = subRes.status === 'ready';
    await saveSubscriptions(list);
    return subRes;
  }

  function exportMergedMarkdown(items) {
    if (!items || !items.length) return '';
    const t = (k, p) => BSE.I18n?.t(k, p) || k;
    const sections = [];
    sections.push(`# ${t('tracker_md_export_title', { n: items.length })}`);
    sections.push(`> ${t('tracker_md_export_time')}：${new Date().toLocaleString()}`);
    sections.push('');

    items.forEach((item, idx) => {
      sections.push(`## [${idx + 1}/${items.length}] ${item.title}`);
      sections.push(`- **${t('tracker_md_author')}**: ${item.author || '未知'}`);
      if (item.url) sections.push(`- **${t('tracker_md_url')}**: [${item.url}](${item.url})`);
      if (item.pubdate) sections.push(`- **${t('tracker_md_pubdate')}**: ${new Date(item.pubdate).toLocaleString()}`);
      sections.push('');

      if (item.subtitle && item.subtitle.status === 'ready' && item.subtitle.markdown) {
        const contentWithoutH1 = item.subtitle.markdown.replace(/^#\s+[^\n]+\n+/, '');
        sections.push(contentWithoutH1);
      } else if (item.subtitle && item.subtitle.plainText) {
        sections.push(item.subtitle.plainText);
      } else {
        sections.push(t('tracker_md_no_sub_cached'));
      }
      sections.push('\n---\n');
    });

    return sections.join('\n');
  }

  let checkAllUpdatesPromise = null;

  async function runCheckAllUpdates() {
    const list = await getSubscriptions();
    if (!list.length) return { totalUnread: 0, updatedSubs: [] };

    const backoff = await getBackoffState();
    if (backoff.nextCheckTime && Date.now() < backoff.nextCheckTime) {
      return {
        totalUnread: list.reduce((sum, sub) => sum + (sub.unreadCount || 0), 0),
        updatedSubs: []
      };
    }

    let hadNetworkSuccess = false;
    const updatedSubs = [];

    for (const sub of list) {
      try {
        const { checked, updated, newItems } = await checkSubscriptionUpdates(sub);
        if (!checked) continue;
        hadNetworkSuccess = true;
        if (updated) {
          updatedSubs.push({
            id: sub.id,
            title: sub.title,
            newItemCount: newItems.length
          });
        }
      } catch {
        // Individual failure doesn't break the full loop
      }
      await BSE.Utils.delay(200); // Gentle spacing between checks
    }

    if (hadNetworkSuccess) {
      await resetCheckBackoff();
    } else {
      await recordCheckFailure();
    }

    // Successful no-update checks and first-run baselines also mutate metadata.
    if (hadNetworkSuccess) {
      await saveSubscriptions(list);
    }

    const totalUnread = list.reduce((sum, s) => sum + (s.unreadCount || 0), 0);
    return { totalUnread, updatedSubs };
  }

  function checkAllUpdates() {
    // Alarm and manual refresh can arrive together. Sharing the in-flight task
    // prevents duplicate network traffic and last-writer-wins storage races.
    if (checkAllUpdatesPromise) return checkAllUpdatesPromise;
    checkAllUpdatesPromise = runCheckAllUpdates().finally(() => {
      checkAllUpdatesPromise = null;
    });
    return checkAllUpdatesPromise;
  }

  // === 7. JSON Configuration Import & Export ===
  async function exportConfigJson() {
    const subscriptions = await getSubscriptions();
    const settings = await getSettings();
    const payload = {
      version: '0.2.0',
      schemaVersion: 1,
      appName: 'SparkSub',
      exportedAt: new Date().toISOString(),
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        platform: s.platform,
        type: s.type,
        title: s.title,
        author: s.author,
        avatar: s.avatar,
        targetId: s.targetId,
        sourceUrl: s.sourceUrl,
        ownerId: s.ownerId,
        subscribedAt: s.subscribedAt,
        autoExtractSubtitle: s.autoExtractSubtitle
      })),
      settings
    };
    return JSON.stringify(payload, null, 2);
  }

  async function importConfigJson(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('无效的 JSON 配置文件格式');
    }

    const subsToImport = Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : (Array.isArray(parsed) ? parsed : []);
    if (!subsToImport.length) throw new Error('配置文件中未找到有效的订阅源');

    const current = await getSubscriptions();
    const existingMap = new Map(current.map((s) => [s.id, s]));
    let importedCount = 0;

    for (const item of subsToImport) {
      if (!item.id || !item.platform || !item.type) continue;
      const merged = {
        id: item.id,
        platform: item.platform,
        type: item.type,
        title: String(item.title || '').trim() || '导入订阅',
        author: String(item.author || '').trim(),
        avatar: item.avatar || '',
        targetId: String(item.targetId || '').trim(),
        sourceUrl: item.sourceUrl || '',
        ownerId: String(item.ownerId || '').trim(),
        subscribedAt: item.subscribedAt || Date.now(),
        lastCheckedAt: 0,
        lastUpdatedItemId: '',
        lastUpdatedTitle: '',
        unreadCount: 0,
        items: [],
        autoExtractSubtitle: Boolean(item.autoExtractSubtitle)
      };
      existingMap.set(item.id, merged);
      importedCount++;
    }

    const mergedList = Array.from(existingMap.values());
    await saveSubscriptions(mergedList);

    if (parsed.settings && typeof parsed.settings === 'object') {
      await saveSettings(parsed.settings);
    }

    return { importedCount, totalCount: mergedList.length };
  }

  // === Export Namespace ===
  BSE.Tracker = Object.freeze({
    md5,
    calculateWbiSign,
    parseYouTubeRssFeed,
    getSubscriptions,
    getSubscription,
    addSubscription,
    removeSubscription,
    renameSubscription,
    markAsRead,
    markAllAsRead,
    getSettings,
    saveSettings,
    getStorageStats,
    checkSubscriptionUpdates,
    checkAllUpdates,
    fetchItemSubtitle,
    fetchSubtitleForItem,
    exportMergedMarkdown,
    exportConfigJson,
    importConfigJson
  });
})();
