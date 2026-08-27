(() => {
  'use strict';

  if (window.__BSE_CONTENT_APP_INSTALLED__) return;
  window.__BSE_CONTENT_APP_INSTALLED__ = true;

  const BSE = globalThis.BSE;
  const platform = BSE.Utils.detectPlatform();
  if (!platform) return;

  /** @type {import('../types/bse').AppState} */
  const state = {
    version: BSE.VERSION,
    platform,
    mediaKey: null,
    title: '',
    url: location.href,
    status: 'idle',
    message: '准备中…',
    revision: 0,
    cueRevision: 0,
    isRefreshing: false,
    lastError: null,
    tracks: [],
    selectedTrackId: null,
    cues: [],
    activeIndex: -1,
    currentTime: 0,
    diagnostics: []
  };

  const bodyCache = new Map();
  const MAX_BODY_CACHE_CHARS = 1_500_000;
  let bodyCacheChars = 0;
  let panel = null;
  let generation = 0;
  let trackGeneration = 0;
  let isLoadingTrack = false;
  let controller = null;
  let scheduleTicket = 0;
  let retryMediaKey = null;
  let retryCount = 0;
  let lastPlaybackIndex = -2;
  let initialized = false;
  let pendingLoad = null;
  let diagnosticPublishTimer = null;

  function diagnostic(stage, message) {
    const time = new Date().toLocaleTimeString();
    state.diagnostics.push(`[${time}] ${stage}：${message}`);
    if (state.diagnostics.length > 80) state.diagnostics.shift();
    if (initialized && !diagnosticPublishTimer) {
      diagnosticPublishTimer = setTimeout(() => {
        diagnosticPublishTimer = null;
        publish(true);
      }, 80);
    }
  }

  function classifyError(error, stage) {
    let code = error?.code || 'UNKNOWN_ERROR';
    const message = error?.message || String(error || '未知错误');
    if (!error?.code && (error?.name === 'TimeoutError' || /超时|timeout/i.test(message))) code = 'TIMEOUT';
    else if (!error?.code && error?.name === 'TypeError' && /fetch|network/i.test(message)) code = 'NETWORK_OR_CORS';
    else if (!error?.code && error?.name === 'AbortError') code = 'ABORTED';
    const defaultHints = {
      NETWORK_OR_CORS: '网络、代理、站点权限或跨域策略阻止了请求。',
      TIMEOUT: '播放器或字幕接口在限定时间内没有响应。',
      UNKNOWN_ERROR: '请复制完整诊断信息，结合最后一个成功阶段定位。'
    };
    return {
      stage,
      code,
      message,
      hint: error?.hint || defaultHints[code] || '请查看诊断中的 HTTP 状态和失败阶段。',
      time: new Date().toISOString()
    };
  }

  function commitError(stage, error) {
    const fault = classifyError(error, stage);
    state.lastError = fault;
    diagnostic('错误定位', `${fault.stage} · ${fault.code} · ${fault.message}`);
    diagnostic('处理建议', fault.hint);
    return fault;
  }

  function getTitle() {
    if (platform === BSE.PLATFORM.YOUTUBE) {
      const element = document.querySelector('h1.ytd-watch-metadata, h1.title yt-formatted-string, #title h1');
      if (element?.textContent?.trim()) return element.textContent.trim();
    } else {
      const element = document.querySelector('h1.video-title, h1[title], .video-title');
      const title = element?.getAttribute('title') || element?.textContent;
      if (title?.trim()) return title.trim();
    }
    return document.title.replace(/\s*[-_|]\s*(YouTube|哔哩哔|bilibili).*$/i, '').trim() || '字幕';
  }

  function getAuthorInfo() {
    try {
      if (platform === BSE.PLATFORM.BILIBILI) {
        const upLink = document.querySelector('.up-detail-top a.up-name, a.up-name, .up-info--right .name, .user-name a, .up-card .name, .up-info_right .name');
        const upNameElem = document.querySelector('.up-name, .up-detail-top .up-name, .username, .up-info--right .name, .up-info_right .name');
        const avatarImg = document.querySelector('.up-avatar img, .up-face img, .bili-avatar img, .header-avatar img');
        
        let upName = upNameElem?.textContent?.trim() || upLink?.textContent?.trim() || '';
        let mid = '';
        if (upLink?.href) {
          const match = upLink.href.match(/space\.bilibili\.com\/(\d+)/);
          if (match) mid = match[1];
        }

        const seasonTitleElem = document.querySelector('.video-sections-head_title, .cur-list-title, .season-title, .bili-video-pod__title, .bili-video-pod__header .title');
        let seasonTitle = seasonTitleElem?.textContent?.trim() || null;
        let seasonId = null;

        const seasonLink = document.querySelector('.video-sections-head a, .cur-list-title a, a[href*="ugc_season"], a[href*="channel/collectiondetail"], a[href*="channel/seriesdetail"], .bili-video-pod a');
        if (seasonLink?.href) {
          const sMatch = seasonLink.href.match(/season_id=(\d+)|ugc_season\/(\d+)|sid=(\d+)|collectiondetail\?sid=(\d+)|seriesdetail\?sid=(\d+)/i);
          if (sMatch) seasonId = sMatch[1] || sMatch[2] || sMatch[3] || sMatch[4] || sMatch[5];
        }

        return {
          name: upName || 'UP主',
          targetId: mid || '',
          mid: mid || '',
          avatar: avatarImg?.src || '',
          seasonId: seasonId || null,
          seasonTitle: seasonTitle || null
        };
      } else if (platform === BSE.PLATFORM.YOUTUBE) {
        const channelLink = document.querySelector('#channel-name a, #owner #channel-name a, ytd-channel-name a');
        const channelName = channelLink?.textContent?.trim() || document.querySelector('#channel-name, ytd-channel-name')?.textContent?.trim() || '';
        const avatarImg = document.querySelector('#owner #avatar img, yt-img-shadow#avatar img, #owner-sub-count img');
        let channelId = '';
        if (channelLink?.href) {
          const chMatch = channelLink.href.match(/\/(channel\/|@|c\/|user\/)([^/?]+)/);
          if (chMatch) channelId = chMatch[2] || chMatch[1];
        }
        return {
          name: channelName || 'YouTube 频道',
          targetId: channelId || '',
          channelId: channelId || '',
          avatar: avatarImg?.src || ''
        };
      }
    } catch {}
    return null;
  }

  function isContextValid() {
    return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id);
  }

  function safeSendMessage(message) {
    if (!isContextValid()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  async function safeStorageGet(defaults) {
    if (!isContextValid() || !chrome?.storage?.sync?.get) return defaults;
    try {
      return await chrome.storage.sync.get(defaults);
    } catch {
      return defaults;
    }
  }

  function safeStorageSet(data) {
    if (!isContextValid() || !chrome?.storage?.sync?.set) return Promise.resolve();
    try {
      return chrome.storage.sync.set(data).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  function publicState() {
    return {
      ...state,
      tracks: state.tracks.map((track) => {
        const safeTrack = { ...track };
        delete safeTrack.subtitleUrl;
        return safeTrack;
      })
    };
  }

  function publish(full = true) {
    if (full) state.revision += 1;
    panel?.renderState(state);
    if (full && isContextValid()) {
      safeSendMessage({ type: 'BSE_STATE_UPDATE', state: publicState() });
    }
  }

  function transitionTo(status, payload = {}) {
    state.status = status;
    if (payload.message !== undefined) state.message = payload.message;
    if (payload.isRefreshing !== undefined) state.isRefreshing = payload.isRefreshing;

    if (status === 'empty') {
      state.tracks = [];
      state.selectedTrackId = null;
      state.cues = [];
      state.activeIndex = -1;
      state.lastError = null;
      state.isRefreshing = false;
      BSE.Utils.SessionSnapshotManager?.deleteSnapshot(state.mediaKey);
    } else if (status === 'error') {
      if (!payload.preserveExisting) {
        state.cues = [];
        state.activeIndex = -1;
      }
      state.isRefreshing = false;
      if (payload.error) commitError(payload.stage || '执行阶段', payload.error);
    } else if (status === 'ready') {
      state.lastError = null;
      state.isRefreshing = false;
      if (payload.cues) {
        state.cues = payload.cues;
        state.cueRevision += 1;
      }
      if (payload.tracks) state.tracks = payload.tracks;
      if (payload.selectedTrackId) state.selectedTrackId = payload.selectedTrackId;
    } else if (status === 'loading') {
      state.lastError = null;
      if (!payload.preserveExisting) {
        state.cues = [];
        state.activeIndex = -1;
      }
    }

    publish(true);
  }

  function setStatus(status, message) {
    transitionTo(status, { message });
  }

  function selectBestTrack(tracks, preferredLanguage) {
    if (!tracks.length) return null;
    if (preferredLanguage) {
      const exact = tracks.find((track) => track.lan === preferredLanguage);
      if (exact) return exact;
    }
    const chinese = tracks.filter((track) => /^(zh|ai-zh)|中|汉/i.test(`${track.lan} ${track.lanDoc}`));
    return chinese.find((track) => !track.isAuto) || chinese[0] || tracks.find((track) => !track.isAuto) || tracks[0];
  }

  function cacheBody(key, cues) {
    const cost = (cues || []).reduce((sum, cue) => sum + String(cue.content || '').length + 24, 0);
    const previous = bodyCache.get(key);
    if (previous) bodyCacheChars -= previous.cost;
    bodyCache.delete(key);
    if (cost > MAX_BODY_CACHE_CHARS) return;
    bodyCache.set(key, { cues, cost });
    bodyCacheChars += cost;
    while (bodyCache.size > 8 || bodyCacheChars > MAX_BODY_CACHE_CHARS) {
      const oldestKey = bodyCache.keys().next().value;
      const oldest = bodyCache.get(oldestKey);
      bodyCacheChars -= oldest?.cost || 0;
      bodyCache.delete(oldestKey);
    }
  }

  function readCachedBody(key) {
    const cached = bodyCache.get(key);
    if (!cached) return null;
    bodyCache.delete(key);
    bodyCache.set(key, cached);
    return cached.cues;
  }

  async function loadTrack(track, options = {}) {
    if (!track) return;
    const ownGeneration = ++trackGeneration;
    const previousCues = Array.isArray(state.cues) ? state.cues : [];
    const preserveExisting = Boolean(options.preserveExisting && previousCues.length);
    state.selectedTrackId = track.id;
    state.lastError = null;
    if (preserveExisting) {
      transitionTo('ready', {
        message: `${previousCues.length} 条 · 正在后台刷新…`,
        isRefreshing: true,
        preserveExisting: true
      });
    } else {
      transitionTo('loading', {
        message: `正在读取 ${track.lanDoc || track.lan} 字幕…`,
        preserveExisting: false
      });
    }

    const cacheKey = `${state.mediaKey}:${track.id}`;
    try {
      let cues = readCachedBody(cacheKey);
      if (!cues || options.force) {
        const adapter = platform === BSE.PLATFORM.YOUTUBE ? BSE.YouTube : BSE.Bilibili;
        cues = await adapter.loadTrack(track, { signal: controller.signal, diagnostic });
        if (cues.length) cacheBody(cacheKey, cues);
      } else {
        diagnostic('本地缓存', `复用已读取的 ${cues.length} 条字幕`);
      }

      if (ownGeneration !== trackGeneration || options.mediaGeneration !== generation) return;
      state.title = getTitle();
      if (cues.length) {
        retryCount = 0;
        diagnostic('字幕呈现', `成功加载 ${cues.length} 条字幕并同步显示`);
        transitionTo('ready', {
          message: `${cues.length} 条 · ${track.lanDoc || track.lan}`,
          cues,
          selectedTrackId: track.id
        });
        BSE.Utils.SessionSnapshotManager?.saveSnapshot(state.mediaKey, {
          title: state.title,
          tracks: state.tracks,
          selectedTrackId: track.id,
          cues: state.cues
        });
        if (platform === BSE.PLATFORM.BILIBILI) {
          scheduleNextEpisodePrefetch(ownGeneration);
        }
      } else {
        transitionTo('empty', { message: '该轨道未包含可用字幕文本' });
      }
      safeStorageSet({ preferredLanguage: track.lan });
    } catch (error) {
      if (error?.name === 'AbortError' || ownGeneration !== trackGeneration) return;
      if (preserveExisting && previousCues.length && options.mediaGeneration === generation) {
        diagnostic('容灾保留', `刷新未成功，已继续保留现有 ${previousCues.length} 条字幕`);
        transitionTo('ready', {
          message: `${previousCues.length} 条 · 刷新失败，已保留现有字幕`,
          cues: previousCues,
          preserveExisting: true
        });
        return;
      }
      const fault = commitError('字幕内容', error);
      transitionTo('error', {
        message: `[${fault.code}] ${fault.message}`,
        error,
        stage: '字幕内容'
      });
      if (!options.force && retryCount < 1 && retryMediaKey === state.mediaKey) {
        retryCount += 1;
        diagnostic('自动重试', '1.5 秒后自动重试一次');
        await BSE.Utils.delay(1500);
        if (options.mediaGeneration === generation && state.mediaKey === retryMediaKey) scheduleLoad('auto_retry', true);
      }
    } finally {
      if (ownGeneration === trackGeneration) {
        isLoadingTrack = false;
      }
    }
  }

  function scheduleNextEpisodePrefetch(gen) {
    if (document.hidden || navigator.connection?.saveData) return;
    if (state.mediaKey?.includes(':cid') || !new URL(location.href).searchParams.has('p')) return;
    setTimeout(async () => {
      if (gen !== generation) return;
      try {
        const bvid = BSE.Utils.getBvid(location.href);
        const page = Number(new URL(location.href).searchParams.get('p') || 1);
        const nextPage = page + 1;
        const nextMediaKey = `bili:${bvid}:p${nextPage}`;
        diagnostic('后台预加载', `正在预读取下一分P字幕 (P${nextPage})`);
      } catch {}
    }, 1500);
  }

  async function scheduleLoad(reason = 'route', force = false) {
    if (!initialized) {
      pendingLoad = { reason, force: Boolean(force || pendingLoad?.force) };
      return;
    }
    const ticket = ++scheduleTicket;
    let mediaKey = BSE.Utils.getMediaKey(platform);
    if (!mediaKey) return;

    const sameMedia = state.mediaKey === mediaKey;
    if (!force && sameMedia && (state.status === 'loading' || state.status === 'ready')) {
      diagnostic('忽略重复', `${reason} 任务已在运行，不重复请求 (${state.status})`);
      return;
    }

    // Step 1: Instant snapshot hydration
    let hydratedFromSnapshot = false;
    if (!force) {
      const snap = BSE.Utils.SessionSnapshotManager?.findSnapshot(mediaKey);
      if (snap && snap.cues && snap.cues.length) {
        hydratedFromSnapshot = true;
        transitionTo('ready', {
          message: `${snap.cues.length} 条 · 快照秒开`,
          tracks: snap.tracks || [],
          selectedTrackId: snap.selectedTrackId || snap.tracks[0]?.id,
          cues: snap.cues
        });
        diagnostic('快速呈现', `从本地会话缓存快速恢复 ${snap.cues.length} 条字幕`);
      }
    }

    if (retryMediaKey !== mediaKey) {
      retryMediaKey = mediaKey;
      retryCount = 0;
    }
    controller?.abort();
    controller = new AbortController();
    const ownGeneration = ++generation;
    const previousSelectedTrackId = state.selectedTrackId;
    const previousTracks = state.tracks;
    const preserveExisting = Boolean(force && sameMedia && state.cues.length);

    state.mediaKey = mediaKey;
    state.url = location.href;
    state.title = getTitle();
    state.authorInfo = getAuthorInfo();
    state.diagnostics = [];
    diagnostic('启动加载', `${reason}${force ? ' (强制刷新)' : ''}`);
    diagnostic('环境信息', `扩展 v${state.version} · ${platform} · 网络: ${navigator.onLine ? '已连接' : '未连接'} · 视频: ${mediaKey}`);

    if (preserveExisting) {
      transitionTo('ready', {
        message: `${state.cues.length} 条 · 正在后台刷新轨道…`,
        isRefreshing: true,
        preserveExisting: true
      });
    } else if (!hydratedFromSnapshot) {
      transitionTo('loading', {
        message: '正在等待播放器与字幕轨道…',
        preserveExisting: false
      });
    }

    try {
      const adapter = platform === BSE.PLATFORM.YOUTUBE ? BSE.YouTube : BSE.Bilibili;
      const tracks = await adapter.discoverTracks({ signal: controller.signal, diagnostic });
      if (ownGeneration !== generation) return;
      state.tracks = tracks;
      if (!tracks.length) {
        if (preserveExisting) {
          diagnostic('容灾保留', `未发现新轨道，继续使用现有 ${state.cues.length} 条字幕`);
          transitionTo('ready', {
            message: `${state.cues.length} 条 · 未发现新轨道，已保留现有字幕`,
            tracks: previousTracks,
            selectedTrackId: previousSelectedTrackId,
            preserveExisting: true
          });
          return;
        }
        transitionTo('empty', { message: '当前视频没有可用字幕轨道' });
        return;
      }
      const settings = await safeStorageGet({ preferredLanguage: '' });
      const selected = selectBestTrack(tracks, settings.preferredLanguage);
      state.selectedTrackId = selected.id;
      publish(true);
      await loadTrack(selected, {
        mediaGeneration: ownGeneration,
        force,
        preserveExisting: preserveExisting && String(selected.id) === String(previousSelectedTrackId)
      });
    } catch (error) {
      if (error?.name === 'AbortError' || ownGeneration !== generation) return;
      if (preserveExisting && state.cues.length) {
        diagnostic('刷新保底', `轨道刷新失败，继续使用现有 ${state.cues.length} 条字幕`);
        transitionTo('ready', {
          message: `${state.cues.length} 条 · 刷新失败，已保留现有字幕`,
          preserveExisting: true
        });
        return;
      }
      const fault = commitError('轨道发现', error);
      transitionTo('error', {
        message: `[${fault.code}] ${fault.message}`,
        error,
        stage: '轨道发现'
      });
      if (!force && retryCount < 1 && retryMediaKey === state.mediaKey) {
        retryCount += 1;
        diagnostic('自动恢复', '1.5 秒后重新等待播放器一次');
        await BSE.Utils.delay(1500);
        if (ownGeneration === generation && state.mediaKey === retryMediaKey) scheduleLoad('auto_discovery_retry', true);
      }
    }
  }

  function seek(seconds) {
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(seconds)) return;
    video.currentTime = seconds;
    video.play().catch(() => {});
  }

  async function selectTrackById(id) {
    const track = state.tracks.find((item) => String(item.id) === String(id));
    if (!track) return;
    await loadTrack(track, { mediaGeneration: generation, force: false });
  }

  function openSidePanel() {
    safeSendMessage({ type: 'BSE_OPEN_SIDE_PANEL' });
  }

  function installRuntimeMessages() {
    if (!isContextValid() || !chrome?.runtime?.onMessage?.addListener) return;
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!isContextValid()) return false;
        if (message?.type === 'BSE_CAPTION_REQUEST_CAPTURED') {
          BSE.YouTube?.rememberRequest(message.request);
          if (state.platform === BSE.PLATFORM.YOUTUBE && (state.status === 'empty' || state.status === 'error') && !state.cues?.length && !isLoadingTrack) {
            const currentTrack = state.tracks.find((t) => String(t.id) === String(state.selectedTrackId)) || state.tracks[0];
            if (currentTrack) {
              loadTrack(currentTrack, { force: false, mediaGeneration: generation });
            }
          }
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === 'BSE_APPLY_EXTERNAL_SUBTITLE') {
          const cues = Array.isArray(message.cues) ? message.cues : [];
          const track = message.track || {
            id: 'native-asr',
            name: `🎙️ 端侧本地转录 (${cues.length} 句)`,
            language: 'zh',
            langDoc: '本地自动转录',
            isAi: true,
            source: 'native',
            engine: 'local-asr'
          };
          const existingIdx = state.tracks.findIndex((t) => String(t.id) === String(track.id));
          if (existingIdx >= 0) {
            state.tracks[existingIdx] = track;
          } else {
            state.tracks.unshift(track);
          }
          state.selectedTrackId = track.id;
          state.cues = cues;
          state.status = cues.length ? 'ready' : 'empty';
          state.message = cues.length ? `已加载端侧转录字幕 · 共 ${cues.length} 条` : '端侧转录未识别到字幕';
          state.cueRevision = (state.cueRevision || 0) + 1;
          state.revision = (state.revision || 0) + 1;
          diagnostic('端侧字幕加载', `成功载入端侧转录字幕 · 共 ${cues.length} 条`);
          panel?.render(publicState());
          panel?.syncLayout();
          publish(true);
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === 'BSE_DIAGNOSTIC_APPEND') {
          diagnostic(message.stage || '端侧大模型', message.message || '');
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === 'BSE_GET_STATE') {
          sendResponse(publicState());
          return false;
        }
        if (message?.type === 'BSE_RESOLVE_YOUTUBE_IN_TAB') {
          if (BSE.YouTube?.bridgeRequest) {
            BSE.YouTube.bridgeRequest('FETCH_VIDEO_SUBTITLE', { videoId: message.videoId }, 15000)
              .then((result) => sendResponse({ ok: true, result }))
              .catch((err) => sendResponse({ ok: false, error: err.message }));
            return true;
          }
          sendResponse({ ok: false, error: 'YouTube 桥接未初始化' });
          return false;
        }
        if (message?.type === 'BSE_COMMAND') {
          const command = message.command;
          const payload = message.payload || {};
          if (command === 'SEEK') seek(Number(payload.time));
          else if (command === 'SELECT_TRACK') selectTrackById(payload.trackId);
          else if (command === 'REFRESH') scheduleLoad('sidepanel_refresh', true);
          else if (command === 'FETCH_AUDIO_STREAM') {
            if (state.platform === BSE.PLATFORM.BILIBILI) {
              BSE.Bilibili.fetchAudioStream({ diagnostic }).then((audioData) => {
                diagnostic('音频提取', `成功提取 DASH 音频直链 (${Math.round((audioData.bandwidth || 0) / 1000)}kbps)`);
                sendResponse({ ok: true, data: audioData });
              }).catch((err) => {
                diagnostic('音频错误', `音频提取失败 · ${err.message}`);
                sendResponse({ ok: false, error: err.message });
              });
              return true;
            }
            diagnostic('音频错误', '当前平台不支持 DASH 音频提取');
            sendResponse({ ok: false, error: '当前平台不支持 DASH 音频提取' });
            return false;
          }
          sendResponse({ ok: true });
          return false;
        }
        return false;
      });
    } catch {}
  }

  let mountGeneration = 0;
  let mountRetryTimer = null;
  let mountIdleHandle = null;

  function schedulePanelMount(reason = 'default') {
    const gen = ++mountGeneration;
    clearTimeout(mountRetryTimer);
    if (mountIdleHandle != null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(mountIdleHandle);
      mountIdleHandle = null;
    }
    const run = () => {
      if (gen !== mountGeneration || !isContextValid()) return;
      if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
        panel?.ensureRootMounted(platform);
        return;
      }
      diagnostic('挂载调度', `触发挂载与布局同步 (${reason}) · gen ${gen}`);
      panel?.ensureRootMounted(platform);
      panel?.syncLayout();
    };
    if (typeof requestIdleCallback === 'function') {
      mountIdleHandle = requestIdleCallback(run, { timeout: 300 });
    } else {
      mountRetryTimer = setTimeout(run, 30);
    }
  }

  function installRouteTracking() {
    const handleNavigation = (reason) => {
      if (BSE.Utils.isMatchingVideoUrl(location.href)) {
        scheduleLoad(reason);
        schedulePanelMount(reason);
      } else {
        panel?.ensureRootMounted(platform);
      }
    };

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.channel !== 'bse-extension-bridge-v1' || event.data?.direction !== 'event') return;
      if (event.data.type === 'ROUTE_CHANGED') {
        handleNavigation('yt_navigate');
      }
    });
    window.addEventListener('popstate', () => handleNavigation('popstate'));
    document.addEventListener('yt-navigate-start', () => handleNavigation('yt_navigate_start'), { passive: true });
    document.addEventListener('yt-navigate-finish', () => handleNavigation('yt_navigate_finish'), { passive: true });
    document.addEventListener('yt-page-data-updated', () => handleNavigation('yt_page_data_updated'), { passive: true });

    let observedKey = null;
    const routeInterval = setInterval(() => {
      if (!isContextValid()) {
        clearInterval(routeInterval);
        return;
      }
      if (document.hidden) return;
      if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
        if (observedKey) {
          observedKey = null;
          panel?.ensureRootMounted(platform);
        }
        return;
      }
      const key = BSE.Utils.getMediaKey(platform);
      if (key && key !== observedKey) {
        observedKey = key;
        if (key !== state.mediaKey) {
          scheduleLoad('route_fallback');
          schedulePanelMount('route_fallback');
        }
      }
    }, 280);
  }

  let activeSyncVideo = null;
  let onTimeUpdateHandler = null;

  function installPlaybackSync() {
    const syncInterval = setInterval(() => {
      if (!isContextValid()) {
        clearInterval(syncInterval);
        return;
      }
      if (document.hidden || !BSE.Utils.isMatchingVideoUrl(location.href) || !state.cues.length) return;
      if (platform === BSE.PLATFORM.YOUTUBE && document.querySelector('.html5-video-player.ad-showing, ytd-player.ad-interrupting')) return;
      
      const video = document.querySelector('video');
      if (!video) return;

      // Attach high-performance native timeupdate listener once per video element
      if (video !== activeSyncVideo) {
        if (activeSyncVideo && onTimeUpdateHandler) {
          activeSyncVideo.removeEventListener('timeupdate', onTimeUpdateHandler);
        }
        activeSyncVideo = video;
        let updateRaf = null;
        onTimeUpdateHandler = () => {
          if (updateRaf) return;
          updateRaf = requestAnimationFrame(() => {
            updateRaf = null;
            if (document.hidden || !state.cues.length) return;
            const index = BSE.Utils.findActiveCueIndex(state.cues, video.currentTime, state.activeIndex);
            state.currentTime = video.currentTime;
            state.activeIndex = index;
            panel?.updatePlayback(index);
            if (index !== lastPlaybackIndex) {
              lastPlaybackIndex = index;
              safeSendMessage({
                type: 'BSE_PLAYBACK_UPDATE',
                activeIndex: index,
                currentTime: video.currentTime
              });
            }
          });
        };
        video.addEventListener('timeupdate', onTimeUpdateHandler, { passive: true });
      }
    }, 500);
  }

  function init() {
    panel = new BSE.RollingPanel({
      seek,
      selectTrack: selectTrackById,
      refresh: () => scheduleLoad('rolling_panel_refresh', true),
      openSidePanel
    });

    if (BSE.Utils.isMatchingVideoUrl(location.href)) {
      schedulePanelMount('init');
    }

    let rafHandle = null;
    let lastScrollTime = 0;
    const onGeometryChange = () => {
      if (!BSE.Utils.isMatchingVideoUrl(location.href) || document.hidden) return;
      const now = performance.now();
      if (now - lastScrollTime < 60) return; // 60ms throttle for ultra-smooth scrolling
      lastScrollTime = now;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = requestAnimationFrame(() => {
        panel?.syncLayout();
      });
    };
    window.addEventListener('scroll', onGeometryChange, { passive: true });
    window.addEventListener('resize', onGeometryChange, { passive: true });
    document.addEventListener('fullscreenchange', () => {
      if (BSE.Utils.isMatchingVideoUrl(location.href)) schedulePanelMount('fullscreen');
    });
    document.addEventListener('webkitfullscreenchange', () => {
      if (BSE.Utils.isMatchingVideoUrl(location.href)) schedulePanelMount('fullscreen');
    });

    initialized = true;
    publish(true);

    if (BSE.Utils.isMatchingVideoUrl(location.href)) {
      const pending = pendingLoad;
      pendingLoad = null;
      scheduleLoad(pending?.reason || 'init', Boolean(pending?.force));
    }
  }

  function installBpxEpisodeListener() {
    if (platform !== BSE.PLATFORM.BILIBILI) return;
    document.addEventListener('click', (event) => {
      const target = event.target;
      const item = target?.closest?.('.bpx-player-ctrl-eplist-menu-item, .cur-list li, .video-episode-card, .bili-video-pod__item');
      if (item) {
        const targetCid = item.getAttribute('data-cid') || item.dataset.cid || '';
        diagnostic('实验特性/BPX点击', `用户点击了选集列表项 · 目标 CID: ${targetCid || '未知'}`);
        setTimeout(() => {
          const newKey = BSE.Utils.getMediaKey(platform);
          if (newKey && newKey !== state.mediaKey) {
            scheduleLoad('bpx_eplist_click');
          }
        }, 150);
      }
    }, { passive: true, capture: true });
  }

  installRuntimeMessages();
  installRouteTracking();
  installPlaybackSync();
  installBpxEpisodeListener();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(init, { timeout: 600 });
      } else {
        setTimeout(init, 100);
      }
    }, { once: true });
  } else {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 600 });
    } else {
      setTimeout(init, 100);
    }
  }
})();
