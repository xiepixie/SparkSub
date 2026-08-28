'use strict';

try {
  importScripts(
    '/core/namespace.js',
    '/core/utils.js',
    '/core/i18n.js',
    '/core/parsers.js',
    '/core/media.js',
    '/core/formatters.js',
    '/core/asr-polisher.js',
    '/core/tracker.js',
    '/core/native-host.js',
    '/core/queue-orchestrator.js',
    '/core/queue.js'
  );
} catch (e) {
  console.warn('[BSE Worker] importScripts 异常:', e);
}

/** @type {Map<number, import('../types/bse').AppState>} */
const tabStates = new Map();
/** @type {Map<number, Array<import('../types/bse').CapturedCaptionRequest>>} */
const captionRequests = new Map();
const MAX_REQUESTS_PER_TAB = 24;
const MAX_PROXY_BODY_BYTES = 5 * 1024 * 1024;
const BILIBILI_REQUEST_TIMEOUT_MS = 15000;

const BILIBILI_REFERER_RULE_ID = 1001;
const OLLAMA_ORIGIN_RULE_ID = 1002;
const ALARM_SUBSCRIPTION_CHECK = 'BSE_SUBSCRIPTION_CHECK';
const queueOrchestrator = BSE.QueueOrchestrator?.create({
  drain: () => BSE.Queue?.processPendingJobs?.() || Promise.resolve()
});

function startQueueExecutor() {
  return queueOrchestrator?.wake() || Promise.resolve();
}

function setupContextMenus() {
  if (!chrome.contextMenus) return;
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'sparksub_add_to_queue',
        title: '📥 加入 SparkSub 离线转录队列',
        contexts: ['link', 'page', 'video']
      });
    });
  } catch {}
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'sparksub_add_to_queue') {
      const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
      if (targetUrl) {
        const added = await BSE.Queue?.addToQueue(targetUrl);
        if (added?.length) {
          await startQueueExecutor();
          if (chrome.notifications) {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
              title: 'SparkSub 已加入转录队列',
              message: `已将《${added[0].title}》加入后台队列，正在转录…`,
              priority: 1
            });
          }
        }
      }
    }
  });
}

async function updateBadgeFromUnread() {
  try {
    const subs = await BSE.Tracker?.getSubscriptions?.() || [];
    const totalUnread = subs.reduce((sum, s) => sum + (s.unreadCount || 0), 0);
    const settings = await BSE.Tracker?.getSettings?.() || { enableBadge: true };

    if (chrome.action) {
      if (settings.enableBadge && totalUnread > 0) {
        await chrome.action.setBadgeText({ text: totalUnread > 99 ? '99+' : String(totalUnread) });
        await chrome.action.setBadgeBackgroundColor({ color: '#00AEEC' });
      } else {
        await chrome.action.setBadgeText({ text: '' });
      }
    }
  } catch {}
}

async function setupSubscriptionAlarm() {
  if (!chrome.alarms) return;
  try {
    const settings = await BSE.Tracker?.getSettings?.() || { checkIntervalMinutes: 60 };
    const periodInMinutes = Number(settings.checkIntervalMinutes) || 60;
    if (periodInMinutes <= 0) {
      await chrome.alarms.clear(ALARM_SUBSCRIPTION_CHECK);
      return;
    }
    await chrome.alarms.create(ALARM_SUBSCRIPTION_CHECK, {
      periodInMinutes,
      delayInMinutes: 1
    });
  } catch (err) {
    console.warn('[BSE Tracker] 设置巡检闹钟异常:', err);
  }
}

async function setupBilibiliNetRules() {
  if (!chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BILIBILI_REFERER_RULE_ID, OLLAMA_ORIGIN_RULE_ID],
      addRules: [
        {
          id: BILIBILI_REFERER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' },
              { header: 'Origin', operation: 'set', value: 'https://www.bilibili.com' },
              { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            ]
          },
          condition: {
            urlFilter: '*bilivideo.*',
            resourceTypes: ['xmlhttprequest', 'media', 'other', 'main_frame', 'sub_frame']
          }
        },
        {
          id: OLLAMA_ORIGIN_RULE_ID,
          priority: 2,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'http://127.0.0.1:11434' }
            ]
          },
          condition: {
            urlFilter: '*11434*',
            resourceTypes: ['xmlhttprequest', 'other']
          }
        }
      ]
    });
  } catch (err) {
    console.warn('[BSE] 设置 declarativeNetRequest 规则异常:', err);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled?.addListener(setupBilibiliNetRules);
  chrome.runtime.onStartup?.addListener(() => {
    setupBilibiliNetRules();
    startQueueExecutor().catch((err) => console.warn('[SparkSub ServiceWorker] 队列执行异常:', err));
  });
}
setupBilibiliNetRules();

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const hasQueueChange = Object.keys(changes || {}).some((key) => key === 'bse_transcription_queue_v1' || key.startsWith('bse_transcription_queue_v1:item:'));
    if (hasQueueChange) startQueueExecutor().catch((err) => console.warn('[SparkSub ServiceWorker] 队列执行异常:', err));
  });
}

function isBilibiliVideoPage(url = '') {
  try {
    if (!url) return false;
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && (parsed.hostname === 'bilibili.com'
        || parsed.hostname.endsWith('.bilibili.com')
        || parsed.hostname === 'biliapi.net'
        || parsed.hostname.endsWith('.biliapi.net'));
  } catch {
    return false;
  }
}

function isTrustedSender(sender, platform) {
  if (!sender || sender.id !== chrome.runtime.id) return false;

  const extensionRoot = chrome.runtime.getURL('');
  if (sender.url && sender.url.startsWith(extensionRoot)) {
    return true;
  }

  const pageUrl = sender.tab?.url || sender.url || '';
  if (platform === 'bilibili') return isBilibiliVideoPage(pageUrl);
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function isTrustedExtensionPageSender(sender) {
  const extensionRoot = chrome.runtime.getURL('');
  return Boolean(sender
    && sender.id === chrome.runtime.id
    && sender.url
    && sender.url.startsWith(extensionRoot));
}

/** @param {any} error */
function stableNativeError(error, fallbackCode = 'NATIVE_HOST_ERROR') {
  return {
    code: typeof error?.code === 'string' && error.code ? error.code : fallbackCode,
    message: typeof error?.message === 'string' && error.message ? error.message : 'Native host request failed.',
    hint: typeof error?.hint === 'string' && error.hint ? error.hint : 'Retry the request after checking the native host.',
    retriable: typeof error?.retriable === 'boolean' ? error.retriable : true
  };
}

function nativeProxyFailure(code, message, hint, retriable = true) {
  const error = /** @type {import('../types/bse').NativeHostError} */ (new Error(message));
  error.code = code;
  error.hint = hint;
  error.retriable = retriable;
  return error;
}

function proxyNativeRequest(method, argument, responseKey) {
  return Promise.resolve().then(() => {
    const nativeMethod = BSE.NativeHost?.[method];
    if (typeof nativeMethod !== 'function') {
      throw nativeProxyFailure(
        'NATIVE_HOST_API_UNAVAILABLE',
        'The native host API is unavailable.',
        'Reload SparkSub and verify that the native host is installed.',
        true
      );
    }
    return nativeMethod.call(BSE.NativeHost, argument);
  }).then((result) => {
    if (result === undefined) {
      throw nativeProxyFailure(
        'NATIVE_HOST_EMPTY_RESPONSE',
        'The native host returned no response.',
        'Retry the request after checking the native host.',
        true
      );
    }
    return { ok: true, [responseKey]: result };
  }).catch((error) => ({ ok: false, error: stableNativeError(error) }));
}

function isAllowedBilibiliResource(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = host === 'api.bilibili.com'
      || host.endsWith('.bilibili.com')
      || host.endsWith('.biliapi.net')
      || host.endsWith('.biliapi.com')
      || host.endsWith('.hdslb.com')
      || host.endsWith('.hdslb.net')
      || host.endsWith('.bilivideo.com')
      || host.endsWith('.bilivideo.cn')
      || host.endsWith('.szbdyd.com');
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && isAllowedHost;
  } catch {
    return false;
  }
}

function classifyNetworkError(error) {
  if (error?.name === 'TimeoutError' || /超时|timeout/i.test(error?.message || '')) return 'TIMEOUT';
  if (error?.name === 'AbortError') return 'ABORTED';
  if (error instanceof TypeError) return 'NETWORK_OR_PERMISSION';
  return 'BACKGROUND_FETCH_FAILED';
}

async function fetchBilibiliResource(url, sender) {
  if (!isTrustedSender(sender, 'bilibili')) {
    return { success: false, error: { code: 'INVALID_SENDER', message: '请求来源不是哔哩哔哩视频页' } };
  }
  if (!isAllowedBilibiliResource(url)) {
    return { success: false, error: { code: 'HOST_NOT_ALLOWED', message: '字幕资源域名不在扩展白名单中' } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`后台请求超时（${BILIBILI_REQUEST_TIMEOUT_MS}ms）`, 'TimeoutError'));
  }, BILIBILI_REQUEST_TIMEOUT_MS);

  const parsedUrl = new URL(url);
  const isApi = parsedUrl.hostname === 'api.bilibili.com' || parsedUrl.hostname.endsWith('.biliapi.net');
  const fetchUrlHttps = String(url).startsWith('http://') ? url.replace(/^http:\/\//i, 'https://') : url;
  const fetchUrlHttp = String(url).startsWith('https://') ? url.replace(/^https:\/\//i, 'http://') : url;
  const headers = {
    Accept: 'application/json,text/plain;q=0.9,*/*;q=0.5'
  };

  try {
    let response;
    // Strategy:
    // 1. If API, try include credentials with HTTPS
    // 2. If CDN or if step 1 fails, try omit credentials with HTTPS
    // 3. If HTTPS fails, try HTTP with omit credentials
    if (isApi) {
      try {
        response = await fetch(fetchUrlHttps, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          headers
        });
      } catch {
        response = await fetch(fetchUrlHttps, {
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
          headers
        });
      }
    } else {
      try {
        response = await fetch(fetchUrlHttps, {
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
          headers
        });
      } catch (httpsErr) {
        try {
          response = await fetch(fetchUrlHttp, {
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
            headers
          });
        } catch {
          throw httpsErr;
        }
      }
    }
    const finalUrl = new URL(response.url || url);
    if (!isAllowedBilibiliResource(finalUrl.toString())) {
      return { success: false, error: { code: 'UNSAFE_REDIRECT', message: '字幕请求被重定向到未授权域名' } };
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_PROXY_BODY_BYTES) {
      return { success: false, error: { code: 'BODY_TOO_LARGE', message: '字幕响应超过 5 MiB 安全上限' } };
    }
    const text = await response.text();
    if (new Blob([text]).size > MAX_PROXY_BODY_BYTES) {
      return { success: false, error: { code: 'BODY_TOO_LARGE', message: '字幕响应超过 5 MiB 安全上限' } };
    }
    return {
      success: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') || '',
      text,
      endpoint: `${finalUrl.hostname}${finalUrl.pathname}`
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: classifyNetworkError(error),
        name: error?.name || 'Error',
        message: error?.message || String(error)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function isAllowedYouTubeResource(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = host === 'www.youtube.com'
      || host === 'm.youtube.com'
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host.endsWith('.googlevideo.com');
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && isAllowedHost
      && (parsed.pathname === '/api/timedtext' || parsed.pathname.includes('timedtext'));
  } catch {
    return false;
  }
}

async function fetchYouTubeResource(url, sender) {
  if (!isTrustedSender(sender, 'youtube')) {
    return { success: false, error: { code: 'INVALID_SENDER', message: '请求来源不是 YouTube 视频页' } };
  }
  if (!isAllowedYouTubeResource(url)) {
    return { success: false, error: { code: 'HOST_NOT_ALLOWED', message: 'YouTube 字幕资源地址不在扩展白名单中' } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('后台请求超时（8000ms）', 'TimeoutError'));
  }, 8000);

  const fetchUrl = String(url).startsWith('http://') ? url.replace(/^http:\/\//i, 'https://') : url;
  const headers = {
    'Accept': '*/*'
  };

  try {
    let response;
    try {
      response = await fetch(fetchUrl, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers
      });
    } catch {
      response = await fetch(fetchUrl, {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers
      });
    }

    const finalUrl = new URL(response.url || url);
    if (!isAllowedYouTubeResource(finalUrl.toString())) {
      return { success: false, error: { code: 'UNSAFE_REDIRECT', message: '字幕请求被重定向到未授权域名' } };
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_PROXY_BODY_BYTES) {
      return { success: false, error: { code: 'BODY_TOO_LARGE', message: '字幕响应超过 5 MiB 安全上限' } };
    }
    const text = await response.text();
    if (new Blob([text]).size > MAX_PROXY_BODY_BYTES) {
      return { success: false, error: { code: 'BODY_TOO_LARGE', message: '字幕响应超过 5 MiB 安全上限' } };
    }
    return {
      success: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') || '',
      text
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: classifyNetworkError(error),
        name: error?.name || 'Error',
        message: error?.message || String(error)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function isMatchingVideoUrl(url = '') {
  if (!url) return false;
  const isYouTube = /(^https?:\/\/)(www\.|m\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/i.test(url);
  if (isYouTube) return true;
  const isBili = /(^https?:\/\/)(www\.|m\.)?bilibili\.com\/(video|festival|blackboard|list|bangumi\/play|medialist\/play)/i.test(url)
    || (/(^https?:\/\/)(www\.|m\.)?bilibili\.com/i.test(url) && /[?&]bvid=BV/i.test(url));
  return isBili;
}

function isMatchingSiteUrl(url = '') {
  if (!url) return false;
  return /(^https?:\/\/)(www\.|m\.)?(youtube\.com|bilibili\.com|youtu\.be)/i.test(url);
}

async function injectContentScripts(tabId, url = '') {
  if (!tabId || !chrome.scripting) return false;
  try {
    const isYouTube = /(^https?:\/\/)(www\.|m\.)?youtube\.com/i.test(url);
    if (isYouTube) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['content/main-world-bridge.js']
      }).catch(() => {});
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      files: [
        'core/namespace.js',
        'core/utils.js',
        'core/jszip.js',
        'core/i18n.js',
        'core/parsers.js',
        'core/media.js',
        'core/formatters.js',
        'core/tracker.js',
        'core/queue.js',
        'platform/youtube.js',
        'platform/bilibili.js',
        'content/rolling-panel.js',
        'content/feed-injector.js',
        'content/app.js'
      ]
    });
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  setupBilibiliNetRules().catch(() => {});
  setupSubscriptionAlarm().catch(() => {});
  updateBadgeFromUnread().catch(() => {});
  setupContextMenus();
  BSE.Queue?.recoverStaleJobs?.().catch(() => {});
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id && isMatchingSiteUrl(tab.url)) {
        injectContentScripts(tab.id, tab.url).catch(() => {});
      }
    }
  }).catch(() => {});
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_SUBSCRIPTION_CHECK) {
      try {
        const { totalUnread, updatedSubs } = await BSE.Tracker?.checkAllUpdates?.() || { totalUnread: 0, updatedSubs: [] };
        await updateBadgeFromUnread();

        const settings = await BSE.Tracker?.getSettings?.() || { enableNotification: true };
        if (settings.enableNotification && updatedSubs.length > 0) {
          const t = (k, p) => BSE.I18n?.t(k, p) || k;
          chrome.notifications?.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: 'SparkSub 订阅更新提醒',
            message: `发现 ${updatedSubs.length} 个订阅源有新更新：${updatedSubs.map((s) => s.title).slice(0, 3).join('、')}`,
            priority: 1
          });
        }
      } catch (err) {
        console.warn('[SparkSub Alarm] Subscription check error:', err);
      }
    }
  });
}

function parseCaptionRequest(details) {
  try {
    const url = new URL(details.url);
    if (url.pathname !== '/api/timedtext') return null;
    const videoId = url.searchParams.get('v');
    if (!videoId) return null;
    const lang = url.searchParams.get('lang') || '';
    const tlang = url.searchParams.get('tlang') || '';
    return {
      url: url.toString(),
      videoId,
      lang: tlang || lang,
      sourceLang: lang,
      tlang,
      isTranslated: Boolean(tlang),
      kind: url.searchParams.get('kind') || 'manual',
      fmt: url.searchParams.get('fmt') || '',
      hasPoToken: url.searchParams.has('pot'),
      capturedAt: Date.now()
    };
  } catch {
    return null;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const request = parseCaptionRequest(details);
    if (!request) return;
    const list = captionRequests.get(details.tabId) || [];
    const next = [request, ...list.filter((item) => item.url !== request.url)].slice(0, MAX_REQUESTS_PER_TAB);
    captionRequests.set(details.tabId, next);
    chrome.tabs.sendMessage(details.tabId, {
      type: 'BSE_CAPTION_REQUEST_CAPTURED',
      request
    }).catch(() => {});
  },
  { urls: ['*://*.youtube.com/api/timedtext*'] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  captionRequests.delete(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  getTabState(tabId).then((state) => {
    chrome.runtime.sendMessage({ type: 'BSE_ACTIVE_TAB_CHANGED', tabId, state }).catch(() => {});
  }).catch(() => {});
});

function isSameMediaOrUrl(cached, tabUrl) {
  if (!cached || !tabUrl) return false;
  if (cached.url === tabUrl) return true;
  const cleanCached = String(cached.url || '').split('#')[0];
  const cleanTab = String(tabUrl).split('#')[0];
  if (cleanCached && cleanTab && cleanCached === cleanTab) return true;

  const currentMediaKey = BSE.Utils?.getMediaKey ? (BSE.Utils.getMediaKey('bilibili', tabUrl) || BSE.Utils.getMediaKey('youtube', tabUrl)) : null;
  if (currentMediaKey && cached.mediaKey && currentMediaKey === cached.mediaKey) {
    return true;
  }
  return false;
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  if (changeInfo.url) {
    const cached = tabStates.get(tabId);
    if (cached && !isSameMediaOrUrl(cached, changeInfo.url)) {
      tabStates.delete(tabId);
      captionRequests.delete(tabId);
    }
  }

  const isVideo = isMatchingVideoUrl(url);
  const isSite = isMatchingSiteUrl(url);
  const enabled = isVideo || isSite;

  chrome.sidePanel.setOptions({ tabId, path: 'sidepanel/sidepanel.html', enabled }).catch(() => {});

  if (!enabled) {
    tabStates.delete(tabId);
    captionRequests.delete(tabId);
  } else if (changeInfo.status === 'complete' || (changeInfo.url && isVideo)) {
    const activeTab = await getActiveTab();
    if (activeTab?.id === tabId) {
      const state = await getTabState(tabId);
      chrome.runtime.sendMessage({
        type: 'BSE_ACTIVE_TAB_CHANGED',
        tabId,
        state
      }).catch(() => {});
    }
  }
});

async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs?.length && tabs[0]?.id != null) return tabs[0];
  } catch {}
  try {
    const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (fallbackTabs?.length && fallbackTabs[0]?.id != null) return fallbackTabs[0];
  } catch {}
  return null;
}

async function getTabState(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;

  const cached = tabStates.get(tabId);
  if (cached && isSameMediaOrUrl(cached, tab.url)) {
    return cached;
  }

  try {
    const state = await chrome.tabs.sendMessage(tabId, { type: 'BSE_GET_STATE' });
    if (state && (state.status === 'ready' || state.cues?.length > 0 || state.status === 'loading')) {
      tabStates.set(tabId, state);
      return state;
    }
  } catch {
    // Content script not ready yet
  }

  if (cached && tab.url && isMatchingVideoUrl(tab.url)) {
    return cached;
  }

  if (tab.url && isMatchingSiteUrl(tab.url)) {
    const injected = await injectContentScripts(tabId, tab.url);
    if (injected) {
      await new Promise((r) => setTimeout(r, 220));
      const state = await chrome.tabs.sendMessage(tabId, { type: 'BSE_GET_STATE' }).catch(() => null);
      if (state) {
        tabStates.set(tabId, state);
        return state;
      }
    }
  }
  return cached || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === 'BSE_STATE_UPDATE' && sender.tab?.id != null) {
    const previous = tabStates.get(sender.tab.id);
    if (previous && Number(message.state?.revision || 0) < Number(previous.revision || 0)) {
      sendResponse({ ok: true, ignored: 'stale_revision' });
      return false;
    }
    tabStates.set(sender.tab.id, message.state);
    chrome.runtime.sendMessage({
      type: 'BSE_STATE_BROADCAST',
      tabId: sender.tab.id,
      state: message.state
    }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'BSE_PLAYBACK_UPDATE' && sender.tab?.id != null) {
    const previous = tabStates.get(sender.tab.id);
    if (previous) {
      tabStates.set(sender.tab.id, {
        ...previous,
        activeIndex: message.activeIndex,
        currentTime: message.currentTime
      });
    }
    chrome.runtime.sendMessage({
      type: 'BSE_PLAYBACK_BROADCAST',
      tabId: sender.tab.id,
      activeIndex: message.activeIndex,
      currentTime: message.currentTime
    }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'BSE_GET_CAPTURED_REQUESTS') {
    const tabId = sender.tab?.id;
    sendResponse({ requests: tabId == null ? [] : (captionRequests.get(tabId) || []) });
    return false;
  }

  if (message.type === 'BSE_FETCH_BILIBILI_RESOURCE') {
    fetchBilibiliResource(message.url, sender).then(sendResponse).catch((error) => {
      sendResponse({
        success: false,
        error: { code: 'BACKGROUND_FETCH_FAILED', message: error?.message || String(error) }
      });
    });
    return true;
  }

  if (message.type === 'BSE_FETCH_YOUTUBE_RESOURCE') {
    fetchYouTubeResource(message.url, sender).then(sendResponse).catch((error) => {
      sendResponse({
        success: false,
        error: { code: 'BACKGROUND_FETCH_FAILED', message: error?.message || String(error) }
      });
    });
    return true;
  }

  if (message.type === 'BSE_FETCH_LOCAL_LLM') {
    const url = message.url;
    const body = message.body;
    const timeoutMs = Math.max(60000, Number(message.timeoutMs) || 90000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const options = {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: controller.signal
    };
    fetch(url, options)
      .then(async (resp) => {
        clearTimeout(timer);
        const text = await resp.text();
        sendResponse({ success: resp.ok, status: resp.status, text });
      })
      .catch((err) => {
        clearTimeout(timer);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'BSE_DOWNLOAD_MEDIA_FILE') {
    (async () => {
      const { url, filename } = message;
      if (!isTrustedSender(sender, 'bilibili')) {
        return { success: false, error: { code: 'INVALID_SENDER', message: '请求来源不是哔哩哔页面或扩展页面' } };
      }
      if (!isAllowedBilibiliResource(url)) {
        return { success: false, error: { message: '音频域名不在白名单中' } };
      }
      const safeFilename = filename || 'audio.m4a';

      // 方案 1：优先使用 Chrome 原生下载管理器（带 Referer 标头，支持大文件与断点续传）
      if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
        try {
          const downloadId = await chrome.downloads.download({
            url,
            filename: safeFilename,
            headers: [
              { name: 'Referer', value: 'https://www.bilibili.com/' },
              { name: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            ],
            saveAs: false,
            conflictAction: 'uniquify'
          });
          return { success: true, downloadId, method: 'chrome.downloads' };
        } catch (dlErr) {
          console.warn('[BSE] chrome.downloads 异常，回退 fetch blob 模式:', dlErr);
        }
      }

      // 方案 2：回退 fetch ArrayBuffer 模式
      const fetchHeaders = {
        'Referer': 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      let response;
      try {
        response = await fetch(url, { headers: fetchHeaders, credentials: 'omit', cache: 'no-store' });
      } catch {
        const httpsUrl = url.replace(/^http:\/\//i, 'https://');
        response = await fetch(httpsUrl, { headers: fetchHeaders, credentials: 'omit', cache: 'no-store' });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      const chunkSize = 0x8000;
      for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return {
        success: true,
        base64: btoa(binary),
        size: len,
        contentType: response.headers.get('content-type') || 'audio/mp4'
      };
    })().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: { message: err.message || String(err) } });
    });
    return true;
  }

  if (message.type === 'BSE_OPEN_SIDE_PANEL' && sender.tab?.id != null) {
    chrome.sidePanel.open({ tabId: sender.tab.id })
      .then(() => {
        if (message.tab) {
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'BSE_SWITCH_SIDE_PANEL_TAB',
              tab: message.tab
            }).catch(() => {});
          }, 150);
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'BSE_GET_ACTIVE_STATE') {
    (async () => {
      const tab = await getActiveTab();
      if (!tab?.id) return { tab: null, state: null };
      return { tab: { id: tab.id, url: tab.url, title: tab.title }, state: await getTabState(tab.id) };
    })().then(sendResponse).catch((error) => sendResponse({ state: null, error: error.message }));
    return true;
  }

  if (message.type === 'BSE_COMMAND_ACTIVE_TAB') {
    (async () => {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error('没有可用的视频标签页');
      try {
        return await chrome.tabs.sendMessage(tab.id, {
          type: 'BSE_COMMAND',
          command: message.command,
          payload: message.payload || {}
        });
      } catch (error) {
        if (/connection|receiving end/i.test(error?.message || '') && isMatchingVideoUrl(tab.url)) {
          const injected = await injectContentScripts(tab.id, tab.url);
          if (injected) {
            await new Promise((r) => setTimeout(r, 250));
            return await chrome.tabs.sendMessage(tab.id, {
              type: 'BSE_COMMAND',
              command: message.command,
              payload: message.payload || {}
            });
          }
        }
        throw error;
      }
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'BSE_TRACKER_UPDATE_BADGE') {
    updateBadgeFromUnread().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'BSE_TRACKER_RESET_ALARM') {
    setupSubscriptionAlarm().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'BSE_TRACKER_CHECK_NOW') {
    (async () => {
      const result = await BSE.Tracker?.checkAllUpdates?.() || { totalUnread: 0, updatedSubs: [] };
      await updateBadgeFromUnread();
      return result;
    })().then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'BSE_NATIVE_CAPABILITIES') {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: stableNativeError({ code: 'INVALID_SENDER', message: 'Native host requests are only available to extension pages.', hint: 'Open SparkSub from an extension page.', retriable: false }) });
      return false;
    }
    proxyNativeRequest('getCapabilities', { force: Boolean(message.force) }, 'capabilities')
      .then(sendResponse);
    return true;
  }

  if (message.type === 'BSE_NATIVE_CANCEL') {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ ok: false, error: stableNativeError({ code: 'INVALID_SENDER', message: 'Native host requests are only available to extension pages.', hint: 'Open SparkSub from an extension page.', retriable: false }) });
      return false;
    }
    if (typeof message.jobId !== 'string' || !message.jobId.trim()) {
      sendResponse({ ok: false, error: stableNativeError({ code: 'INVALID_REQUEST', message: 'A job ID is required.', hint: 'Retry from a queue item.', retriable: false }) });
      return false;
    }
    proxyNativeRequest('cancel', message.jobId, 'result')
      .then(sendResponse);
    return true;
  }

  // === Queue Orchestrator Messages ===
  if (message.type === 'BSE_ORCHESTRATOR_NOTIFY') {
    (async () => {
      await startQueueExecutor();
      return { ok: true };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_ENQUEUE') {
    (async () => {
      const items = await BSE.Queue?.addToQueue(message.urls, message.options) || [];
      startQueueExecutor().catch(() => {});
      return { ok: true, items };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_GET') {
    (async () => {
      const queue = await BSE.Queue?.getQueue() || [];
      return { ok: true, queue };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_CLEAR_COMPLETED') {
    (async () => {
      const count = await BSE.Queue?.clearCompleted() || 0;
      return { ok: true, count };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_CLEAR_ALL') {
    (async () => {
      await BSE.Queue?.clearAll();
      return { ok: true };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_RETRY') {
    (async () => {
      const item = await BSE.Queue?.retryItem(message.id);
      await startQueueExecutor();
      return { ok: true, item };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_REMOVE') {
    (async () => {
      const success = await BSE.Queue?.removeFromQueue(message.id);
      return { ok: success };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'BSE_QUEUE_EXPORT_MERGED') {
    (async () => {
      const markdown = await BSE.Queue?.exportQueueMergedMarkdown(message.itemIds);
      return { ok: true, markdown };
    })().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
