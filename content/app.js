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
    diagnosticSessionId: '',
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
  let retryMediaKey = null;
  let retryCount = 0;
  let lastPlaybackIndex = -2;
  let initialized = false;
  let pendingLoad = null;
  let pendingSessionSnapshot = null;
  let sessionSnapshotIdleHandle = null;
  let mediaContextResolvedKey = '';
  let mediaContextLoad = null;
  const mediaDiagnostics = BSE.Diagnostics.createMediaSession({ platform, limit: 100 });

  function syncDiagnostics() {
    state.diagnosticSessionId = mediaDiagnostics.sessionId;
    state.diagnostics = mediaDiagnostics.events();
  }

  function diagnostic(stage, message) {
    if (!mediaDiagnostics.sessionId) mediaDiagnostics.begin(state.mediaKey || BSE.Utils.getMediaKey(platform) || 'unknown');
    const event = mediaDiagnostics.report(stage, message);
    const sessionId = mediaDiagnostics.sessionId;
    if (state.diagnosticSessionId !== sessionId) {
      state.diagnosticSessionId = sessionId;
      state.diagnostics = [];
    }
    if (event) {
      state.diagnostics.push(event);
      if (state.diagnostics.length > 100) state.diagnostics.splice(0, state.diagnostics.length - 100);
    }
    // Diagnostics are an incremental side channel. Once the content script is
    // initialized, a log line must never force the full cue array across the
    // extension boundary just to update the Side Panel timeline.
    if (initialized && event && isContextValid()) {
      safeSendMessage({ type: 'BSE_DIAGNOSTIC_APPEND', ...event });
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
    mediaDiagnostics.recordFault(fault);
    syncDiagnostics();
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

  function getImageSource(img) {
    if (!img) return '';
    const candidates = [
      img.currentSrc,
      img.getAttribute?.('src'),
      img.getAttribute?.('data-src'),
      img.getAttribute?.('data-lazy-src'),
      img.getAttribute?.('data-original')
    ];
    const srcset = img.getAttribute?.('srcset') || img.getAttribute?.('data-srcset') || '';
    if (srcset) {
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) candidates.push(first);
    }
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw || raw === location.href || raw.startsWith('data:image/gif;base64,R0lGOD')) continue;
      return BSE.Utils?.normalizeImageUrl?.(raw) || raw;
    }
    return '';
  }

  function getAuthorInfo() {
    try {
      if (platform === BSE.PLATFORM.BILIBILI) {
        const bvid = (BSE.Utils && BSE.Utils.getBvid) ? BSE.Utils.getBvid(location.href) : '';
        let domData = null;
        try {
          if (typeof document !== 'undefined') {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const text = script.textContent || '';
              if (text.includes('__INITIAL_STATE__')) {
                const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/s) || text.match(/__INITIAL_STATE__\s*=\s*(\{.+?\});?/s);
                if (match && match[1]) {
                  const parsed = JSON.parse(match[1]);
                  if (parsed?.videoData && bvid && String(parsed.videoData.bvid).toLowerCase() === String(bvid).toLowerCase()) {
                    domData = parsed.videoData;
                    break;
                  }
                }
              }
            }
          }
        } catch {}

        const upLink = /** @type {HTMLAnchorElement | null} */ (document.querySelector('.up-detail-top a.up-name, a.up-name, .up-info--right .name, .user-name a, .up-card .name, .up-info_right .name'));
        const upNameElem = document.querySelector('.up-name, .up-detail-top .up-name, .username, .up-info--right .name, .up-info_right .name');
        const avatarImg = /** @type {HTMLImageElement | null} */ (document.querySelector('.up-avatar img, .up-face img, .bili-avatar img, .bili-avatar__img, .bili-avatar-img, .up-avatar-wrap img, .header-avatar img'));
        
        let upName = domData?.owner?.name || upNameElem?.textContent?.trim() || upLink?.textContent?.trim() || '';
        let mid = domData?.owner?.mid ? String(domData.owner.mid) : '';
        if (!mid && upLink?.href) {
          const match = upLink.href.match(/space\.bilibili\.com\/(\d+)/);
          if (match) mid = match[1];
        }
        const avatar = BSE.Utils?.normalizeImageUrl?.(domData?.owner?.face || getImageSource(avatarImg) || '')
          || domData?.owner?.face
          || getImageSource(avatarImg)
          || '';

        let seasonTitle = null;
        let seasonId = null;

        // 1. 优先从页面状态数据中精准读取 UGC 合集
        if (domData?.ugc_season && (domData.ugc_season.id || domData.ugc_season.season_id)) {
          seasonId = String(domData.ugc_season.id || domData.ugc_season.season_id);
          seasonTitle = domData.ugc_season.title || null;
        } else if (domData?.pages && domData.pages.length > 1 && bvid) {
          seasonId = bvid;
          seasonTitle = domData.title ? `${domData.title} (共${domData.pages.length}P)` : '分P连载';
        }

        // 2. 兜底 DOM 结构探测 (UGC 合集、合集详情页、系列页、BPX 播放器选集)
        if (!seasonId) {
          const seasonTitleElem = document.querySelector('.video-sections-head_title, .cur-list-title, .season-title, .bili-video-pod__title, .bili-video-pod__header .title');
          if (seasonTitleElem) seasonTitle = seasonTitleElem.textContent?.trim() || seasonTitle;

          const seasonLink = /** @type {HTMLAnchorElement | null} */ (document.querySelector('.video-sections-head a, .cur-list-title a, a[href*="ugc_season"], a[href*="channel/collectiondetail"], a[href*="channel/seriesdetail"], .bili-video-pod a'));
          if (seasonLink?.href) {
            const sMatch = seasonLink.href.match(/season_id=(\d+)|ugc_season\/(\d+)|sid=(\d+)|collectiondetail\?sid=(\d+)|seriesdetail\?sid=(\d+)/i);
            if (sMatch) seasonId = sMatch[1] || sMatch[2] || sMatch[3] || sMatch[4] || sMatch[5];
          }

          const eplistDomItems = typeof document !== 'undefined' ? document.querySelectorAll('.bpx-player-ctrl-eplist-menu-item') : [];
          if (eplistDomItems.length > 1 && bvid) {
            seasonId = bvid;
            seasonTitle = seasonTitle || (document.title ? document.title.replace(/\s*[-_|]\s*(哔哩哔|bilibili).*$/i, '').trim() : '专题选集');
          }
        }

        return {
          name: upName || 'UP主',
          targetId: mid || '',
          mid: mid || '',
          bvid: bvid || '',
          avatar: avatar || '',
          seasonId: seasonId || null,
          seasonTitle: seasonTitle || null
        };
      } else if (platform === BSE.PLATFORM.YOUTUBE) {
        const channelLink = /** @type {HTMLAnchorElement | null} */ (document.querySelector('#channel-name a, #owner #channel-name a, ytd-channel-name a'));
        const channelName = channelLink?.textContent?.trim() || document.querySelector('#channel-name, ytd-channel-name')?.textContent?.trim() || '';
        const avatarImg = /** @type {HTMLImageElement | null} */ (document.querySelector('#owner #avatar img, yt-img-shadow#avatar img, ytd-video-owner-renderer #avatar img, #owner-sub-count img'));
        let channelId = '';
        if (channelLink?.href) {
          const chMatch = channelLink.href.match(/\/(channel\/|@|c\/|user\/)([^/?]+)/);
          if (chMatch) channelId = chMatch[2] || chMatch[1];
        }

        // 检测 YouTube 播放列表 / 合集 (URL 含有 list= 或页面包含 playlist 结构)
        let seasonId = null;
        let seasonTitle = null;
        try {
          const urlObj = new URL(location.href);
          const listId = urlObj.searchParams.get('list');
          if (listId && listId !== 'WL' && listId !== 'LL') {
            seasonId = listId;
            const plTitleElem = document.querySelector(
              'ytd-playlist-panel-renderer #header-description h3, ytd-playlist-panel-renderer .title, ytd-playlist-header-renderer .title, #playlist .title'
            );
            seasonTitle = plTitleElem?.textContent?.trim() || 'YouTube 播放列表';
          }
        } catch {}

        const videoId = (BSE.Utils?.getYouTubeVideoId ? BSE.Utils.getYouTubeVideoId() : '')
          || new URL(location.href).searchParams.get('v') || '';

        return {
          name: channelName || 'YouTube 频道',
          targetId: channelId || '',
          channelId: channelId || '',
          videoId,
          avatar: getImageSource(avatarImg),
          seasonId,
          seasonTitle
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

  function publicStateMeta(knownDiagnostics = null) {
    const diagnostics = Array.isArray(state.diagnostics) ? state.diagnostics : [];
    const tailId = String(diagnostics[diagnostics.length - 1]?.id || '');
    const diagnosticsChanged = !knownDiagnostics
      || String(knownDiagnostics.sessionId || '') !== String(state.diagnosticSessionId || '')
      || Number(knownDiagnostics.count || 0) !== diagnostics.length
      || String(knownDiagnostics.tailId || '') !== tailId;
    return {
      platform: state.platform,
      mediaKey: state.mediaKey,
      url: state.url,
      status: state.status,
      revision: state.revision,
      cueRevision: state.cueRevision,
      selectedTrackId: state.selectedTrackId,
      mediaContext: state.mediaContext || null,
      diagnosticSessionId: state.diagnosticSessionId || '',
      diagnosticCount: diagnostics.length,
      diagnosticTailId: tailId,
      ...(diagnosticsChanged ? { diagnostics } : {})
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
      if (payload.fault) state.lastError = payload.fault;
    } else if (status === 'ready') {
      state.lastError = null;
      if (payload.isRefreshing === undefined) state.isRefreshing = false;
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

  function selectBestTrack(tracks, preferredLanguage, subtitlePreference = 'manual-first') {
    if (!tracks.length) return null;
    const pickPreferredLanguage = (candidates) => {
      if (!candidates.length) return null;
      if (preferredLanguage) {
        const exact = candidates.find((track) => track.lan === preferredLanguage);
        if (exact) return exact;
      }
      return candidates[0] || null;
    };
    const chinese = tracks.filter((track) => /^(zh|ai-zh)|中|汉/i.test(`${track.lan} ${track.lanDoc}`));
    const manualChinese = chinese.filter((track) => !track.isAuto);
    const aiChinese = chinese.filter((track) => track.isAuto);
    const manual = tracks.filter((track) => !track.isAuto);
    const ai = tracks.filter((track) => track.isAuto);

    if (subtitlePreference === 'manual-only') {
      return pickPreferredLanguage(manualChinese) || pickPreferredLanguage(manual);
    }
    if (subtitlePreference === 'ai-first') {
      return pickPreferredLanguage(aiChinese)
        || pickPreferredLanguage(ai)
        || pickPreferredLanguage(manualChinese)
        || pickPreferredLanguage(manual)
        || tracks[0];
    }
    return pickPreferredLanguage(manualChinese)
      || pickPreferredLanguage(manual)
      || pickPreferredLanguage(aiChinese)
      || pickPreferredLanguage(ai)
      || tracks[0];
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

  function subtitleCuesFitTrack(cues, track) {
    const list = Array.isArray(cues) ? cues : [];
    if (!list.length) return false;
    const duration = Math.max(0, Number(track?.duration) || 0);
    if (duration <= 10) return true;
    const maxCueTo = Math.max(0, Number(list[list.length - 1]?.to) || 0);
    if (maxCueTo > duration + 8) return false;
    if (duration >= 90 && maxCueTo < duration * 0.35 && list.length < 20) return false;
    return true;
  }

  function canHydrateSessionSnapshot(snapshot, mediaKey) {
    if (!snapshot?.cues?.length) return false;
    if (platform !== BSE.PLATFORM.BILIBILI) return true;
    const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
    const selected = tracks.find((track) => String(track.id) === String(snapshot.selectedTrackId)) || tracks[0] || null;
    if (!selected?.id || !selected?.bvid || !selected?.cid || !(Number(selected.duration) > 0)) return false;
    const expectedBvid = String(mediaKey || '').match(/^bili:(BV[a-zA-Z0-9]+):/i)?.[1] || '';
    const expectedCid = String(mediaKey || '').match(/^bili:BV[a-zA-Z0-9]+:cid([^:]+)$/i)?.[1] || '';
    if (expectedBvid && String(selected.bvid).toLowerCase() !== expectedBvid.toLowerCase()) return false;
    if (expectedCid && String(selected.cid) !== expectedCid) return false;
    return subtitleCuesFitTrack(snapshot.cues, selected);
  }

  function persistentSubtitleKey(track = null) {
    const selectedTrack = track || state.tracks.find((item) => String(item.id) === String(state.selectedTrackId)) || state.tracks[0] || null;
    if (state.platform === BSE.PLATFORM.BILIBILI) {
      const runtimeKey = String(state.mediaKey || '');
      const bvid = String(selectedTrack?.bvid || '').trim()
        || BSE.Utils?.getBvid?.(state.url || location.href)
        || runtimeKey.match(/^bili:(BV[a-zA-Z0-9]+):/i)?.[1]
        || '';
      const page = Math.max(0, Number(selectedTrack?.page) || 0);
      if (bvid && page > 0) return `bili:${bvid}:p${page}`;
    }
    return String(BSE.Utils?.getArtifactKey?.(state.platform, state.url || location.href, state.mediaKey || '') || state.mediaKey || '').trim();
  }

  function writePendingSessionSnapshot() {
    sessionSnapshotIdleHandle = null;
    const pending = pendingSessionSnapshot;
    pendingSessionSnapshot = null;
    if (!pending?.mediaKey || !pending.data?.cues?.length) return;
    BSE.Utils.SessionSnapshotManager?.saveSnapshot(pending.mediaKey, pending.data);
  }

  function scheduleSessionSnapshot(mediaKey, data) {
    pendingSessionSnapshot = { mediaKey, data };
    if (sessionSnapshotIdleHandle != null) return;
    if (typeof requestIdleCallback === 'function') {
      sessionSnapshotIdleHandle = requestIdleCallback(writePendingSessionSnapshot, { timeout: 750 });
    } else {
      sessionSnapshotIdleHandle = setTimeout(writePendingSessionSnapshot, 120);
    }
  }

  function persistCurrentSubtitleState({ persistUnified = true, deferSnapshot = false } = {}) {
    if (!state.mediaKey || !Array.isArray(state.cues) || !state.cues.length) return Promise.resolve(true);
    const selectedTrack = state.tracks.find((track) => String(track.id) === String(state.selectedTrackId)) || state.tracks[0] || null;
    const subtitleKey = persistentSubtitleKey(selectedTrack);
    const snapshotData = {
      title: state.title,
      tracks: state.tracks,
      selectedTrackId: state.selectedTrackId,
      cues: state.cues,
      ...(state.mediaContext ? { mediaContext: state.mediaContext } : {})
    };
    if (deferSnapshot) scheduleSessionSnapshot(state.mediaKey, snapshotData);
    else BSE.Utils.SessionSnapshotManager?.saveSnapshot(state.mediaKey, snapshotData);
    if (!persistUnified) return Promise.resolve(true);
    if (!subtitleKey) return Promise.resolve(false);
    return BSE.Utils?.UnifiedSubtitleCache?.set(subtitleKey, {
      title: state.title || getTitle(),
      author: state.authorInfo?.name || getAuthorInfo()?.name || '',
      trackId: String(selectedTrack?.id || state.selectedTrackId || ''),
      trackSource: selectedTrack?.source || '',
      language: selectedTrack?.lan || selectedTrack?.language || 'zh',
      langDoc: selectedTrack?.lanDoc || selectedTrack?.langDoc || '中文',
      cues: state.cues
    }) || Promise.resolve(false);
  }

  async function loadTrack(track, options = {}) {
    if (!track) return;
    const ownGeneration = ++trackGeneration;
    const mediaGeneration = Number.isInteger(options.mediaGeneration) ? options.mediaGeneration : generation;
    const expectedMediaKey = String(state.mediaKey || '');
    const loadSignal = options.signal || controller?.signal || null;
    const isCurrentLoad = () => (
      ownGeneration === trackGeneration
      && mediaGeneration === generation
      && expectedMediaKey === String(state.mediaKey || '')
      && !loadSignal?.aborted
    );
    const previousCues = Array.isArray(state.cues) ? state.cues : [];
    const preserveExisting = Boolean(options.preserveExisting && previousCues.length);
    isLoadingTrack = true;
    state.selectedTrackId = track.id;
    state.lastError = null;
    if (preserveExisting) {
      if (!state.isRefreshing) {
        transitionTo('ready', {
          message: `${previousCues.length} 条 · 正在后台刷新…`,
          isRefreshing: true,
          preserveExisting: true
        });
      }
    } else {
      transitionTo('loading', {
        message: `正在读取 ${track.lanDoc || track.lan} 字幕…`,
        preserveExisting: false
      });
    }

    const cacheKey = `${expectedMediaKey}:${track.id}`;
    try {
      // force means a real source refresh: never let the in-memory body cache
      // accidentally turn “重新解析” into another cache hit.
      let cues = options.force ? null : readCachedBody(cacheKey);
      let unifiedCached = null;
      const subtitleKey = persistentSubtitleKey(track);
      if (!cues || options.force) {
        try {
          unifiedCached = subtitleKey ? await BSE.Utils?.UnifiedSubtitleCache?.get(subtitleKey, { includePlainText: false }) : null;
          // One-time compatibility read for older builds that persisted the same
          // Bilibili part under a runtime CID key. New writes always use subtitleKey.
          if (!unifiedCached && subtitleKey && subtitleKey !== expectedMediaKey) {
            unifiedCached = await BSE.Utils?.UnifiedSubtitleCache?.get(expectedMediaKey, { includePlainText: false });
          }
        } catch {}
        if (!isCurrentLoad()) return;

        if (!options.force && unifiedCached?.cues?.length) {
          const cachedTrackId = String(unifiedCached.trackId || '').trim();
          const requestedTrackId = String(track.id || '').trim();
          const cachedLanguage = String(unifiedCached.language || '').toLowerCase();
          const requestedLanguage = String(track.lan || track.language || '').toLowerCase();
          const exactTrackMatch = Boolean(cachedTrackId && cachedTrackId === requestedTrackId);
          const safeLegacyMatch = !cachedTrackId
            && platform !== BSE.PLATFORM.BILIBILI
            && state.tracks.length === 1
            && (!cachedLanguage || !requestedLanguage || cachedLanguage === requestedLanguage);
          const bodyFitsTrack = platform !== BSE.PLATFORM.BILIBILI || subtitleCuesFitTrack(unifiedCached.cues, track);
          if ((exactTrackMatch || safeLegacyMatch) && bodyFitsTrack) {
            cues = unifiedCached.cues;
            diagnostic('全局缓存', `秒级复用当前字幕轨道的统一持久化缓存（共 ${cues.length} 条）`);
          } else if (platform === BSE.PLATFORM.BILIBILI && !cachedTrackId) {
            diagnostic('缓存隔离', '忽略旧版 B站无轨道身份缓存，本次重新确认官方字幕后升级缓存');
          } else if (!bodyFitsTrack) {
            diagnostic('缓存隔离', '忽略与当前视频时长不一致的持久化字幕缓存');
          } else if (cachedTrackId) {
            diagnostic('缓存隔离', `忽略另一字幕轨道的持久缓存：cache=${cachedTrackId} · current=${requestedTrackId}`);
          }
        }

        if (!cues) {
          const adapter = platform === BSE.PLATFORM.YOUTUBE ? BSE.YouTube : BSE.Bilibili;
          const onIntermediateCues = (intermediateCues) => {
            if (!isCurrentLoad()) return;
            if (intermediateCues?.length) {
              diagnostic('快速呈现', `源语言已读取 ${intermediateCues.length} 条字幕，先行动态显示并后台翻译`);
              transitionTo('ready', {
                message: `${intermediateCues.length} 条 · 原文已就绪，正在后台机翻…`,
                cues: intermediateCues,
                selectedTrackId: track.id
              });
              panel?.syncLayout();
            }
          };
          cues = await adapter.loadTrack(track, { signal: loadSignal || undefined, diagnostic, onIntermediateCues });
          if (!isCurrentLoad()) return;
        }
      } else {
        diagnostic('本地缓存', `复用已读取的 ${cues.length} 条字幕`);
      }

      if (!isCurrentLoad()) return;
      if (cues?.length && subtitleKey && BSE.Utils?.UnifiedSubtitleCache?.applyCorrections) {
        const corrected = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(subtitleKey, String(track.id || ''), cues, unifiedCached);
        if (!isCurrentLoad()) return;
        cues = corrected.cues;
        if (corrected.appliedCount > 0) {
          diagnostic('字幕校对', `已在新读取字幕上恢复 ${corrected.appliedCount} 条已保存文本修正`);
        }
        if (corrected.conflictCount > 0) {
          diagnostic('字幕校对', `${corrected.conflictCount} 条历史修正因原文或时间锚点已变化而未自动套用`);
        }
      }
      if (!isCurrentLoad()) return;
      if (cues?.length) cacheBody(cacheKey, cues);

      if (!isCurrentLoad()) return;
      state.title = getTitle();
      if (cues && cues.length) {
        retryCount = 0;
        diagnostic('字幕呈现', `成功加载 ${cues.length} 条字幕并同步显示`);
        transitionTo('ready', {
          message: `${cues.length} 条 · ${track.lanDoc || track.lan}`,
          cues,
          selectedTrackId: track.id
        });
        void persistCurrentSubtitleState();
      } else {
        transitionTo('empty', { message: '该轨道未包含可用字幕文本' });
      }
      safeStorageSet({ preferredLanguage: track.lan });
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrentLoad()) return;
      if (preserveExisting && previousCues.length && mediaGeneration === generation) {
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
        fault
      });
      if (!options.force && retryCount < 1 && retryMediaKey === state.mediaKey) {
        retryCount += 1;
        diagnostic('自动重试', '1.5 秒后自动重试一次');
        await BSE.Utils.delay(1500);
        if (mediaGeneration === generation && state.mediaKey === retryMediaKey) scheduleLoad('auto_retry', true);
      }
    } finally {
      if (ownGeneration === trackGeneration) {
        isLoadingTrack = false;
      }
    }
  }

  function refineBilibiliRuntimeMediaKey(previousMediaKey) {
    if (platform !== BSE.PLATFORM.BILIBILI) return false;
    const before = String(previousMediaKey || '').trim();
    const after = String(BSE.Utils.getMediaKey(platform) || '').trim();
    if (!before || !after || before === after) return false;

    const provisional = before.match(/^bili:(BV[a-zA-Z0-9]+):p(\d+)$/i);
    const exact = after.match(/^bili:(BV[a-zA-Z0-9]+):cid(\d+)$/i);
    if (!provisional || !exact || provisional[1].toLowerCase() !== exact[1].toLowerCase()) return false;

    // getMediaKey() only reaches the exact key after platform/bilibili.js has
    // revalidated the authoritative CID against the current route. This is an
    // identity refinement of the same page, not a navigation to another media.
    state.mediaKey = after;
    if (retryMediaKey === before) retryMediaKey = after;
    diagnostic('视频身份', `运行时身份已从 P${provisional[2]} 精炼为 CID ${exact[2]}`);
    return true;
  }

  async function resolveCurrentMediaContext({ force = false, signal = null } = {}) {
    const requestedMediaKey = String(state.mediaKey || BSE.Utils.getMediaKey(platform) || '').trim();
    if (!requestedMediaKey || !BSE.MediaContext) return null;
    const existing = state.mediaContext;
    if (!force
      && existing
      && BSE.MediaContext.sameOwner(existing, { mediaKey: requestedMediaKey })
      && (existing.tags?.length || mediaContextResolvedKey === requestedMediaKey)) {
      return existing;
    }
    if (mediaContextLoad?.mediaKey === requestedMediaKey) return mediaContextLoad.promise;

    const adapter = platform === BSE.PLATFORM.YOUTUBE ? BSE.YouTube : BSE.Bilibili;
    if (typeof adapter?.fetchMediaContext !== 'function') return existing || null;

    const promise = (async () => {
      const context = await adapter.fetchMediaContext({ signal: signal || undefined, diagnostic });
      if (!context || state.mediaKey !== requestedMediaKey) return null;
      let ownerMatches = BSE.MediaContext.sameOwner(context, { mediaKey: requestedMediaKey });
      if (!ownerMatches && platform === BSE.PLATFORM.BILIBILI) {
        const provisional = requestedMediaKey.match(/^bili:(BV[a-zA-Z0-9]+):p(\d+)$/i);
        const resolved = String(context.mediaKey || '').match(/^bili:(BV[a-zA-Z0-9]+):cid([^:]+)$/i);
        if (provisional && resolved && provisional[1].toLowerCase() === resolved[1].toLowerCase()) {
          const requestedPage = Number(provisional[2]);
          ownerMatches = state.tracks.some((track) => (
            String(track.bvid || '').toLowerCase() === provisional[1].toLowerCase()
            && String(track.cid || '') === String(resolved[2])
            && Number(track.page || requestedPage) === requestedPage
          ));
        }
      }
      if (!ownerMatches) return null;
      state.mediaContext = BSE.MediaContext.create(context);
      mediaContextResolvedKey = requestedMediaKey;
      if (initialized && isContextValid()) {
        safeSendMessage({
          type: 'BSE_MEDIA_CONTEXT_UPDATE',
          mediaKey: requestedMediaKey,
          mediaContext: state.mediaContext
        });
      }
      return state.mediaContext;
    })();
    mediaContextLoad = { mediaKey: requestedMediaKey, promise };
    try {
      return await promise;
    } finally {
      if (mediaContextLoad?.promise === promise) mediaContextLoad = null;
    }
  }

  async function scheduleLoad(reason = 'route', force = false) {
    if (!initialized) {
      pendingLoad = { reason, force: Boolean(force || pendingLoad?.force) };
      return;
    }
    let mediaKey = BSE.Utils.getMediaKey(platform);
    if (!mediaKey) return;

    const sameMedia = state.mediaKey === mediaKey;
    if (!sameMedia) state.mediaContext = undefined;
    if (!force && sameMedia && (state.status === 'loading' || state.status === 'ready')) {
      diagnostic('忽略重复', `${reason} 任务已在运行，不重复请求 (${state.status})`);
      return;
    }
    if (!sameMedia || !mediaDiagnostics.sessionId) {
      mediaDiagnostics.begin(mediaKey);
      syncDiagnostics();
    }

    // Commit the new media identity before any snapshot/status publish. A fast
    // snapshot for video B must never be broadcast while state.mediaKey still
    // belongs to video A, otherwise consumers can temporarily attach A's AI
    // artifacts to B during SPA navigation.
    state.mediaKey = mediaKey;
    state.url = location.href;
    state.title = getTitle();
    state.authorInfo = getAuthorInfo();

    // Step 1: Instant snapshot hydration
    let hydratedFromSnapshot = false;
    if (!force) {
      const snap = BSE.Utils.SessionSnapshotManager?.findSnapshot(mediaKey);
      if (snap && canHydrateSessionSnapshot(snap, mediaKey)) {
        hydratedFromSnapshot = true;
        if (snap.mediaContext && BSE.MediaContext?.sameOwner?.(snap.mediaContext, { mediaKey })) {
          state.mediaContext = BSE.MediaContext.create(snap.mediaContext);
        }
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
    const loadController = new AbortController();
    controller = loadController;
    const ownGeneration = ++generation;
    const previousSelectedTrackId = state.selectedTrackId;
    const previousTracks = state.tracks;
    const preserveExisting = Boolean(force && sameMedia && state.cues.length);

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
      const tracks = await adapter.discoverTracks({ signal: loadController.signal, diagnostic });
      if (ownGeneration !== generation || loadController.signal.aborted) return;
      state.tracks = tracks;
      refineBilibiliRuntimeMediaKey(mediaKey);
      resolveCurrentMediaContext({ signal: loadController.signal }).catch((error) => {
        if (ownGeneration !== generation) return;
        if (error?.name !== 'AbortError') diagnostic('视频语境', '扩展语境未完成，不影响字幕显示');
      });
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
      const settings = await safeStorageGet({ preferredLanguage: '', bseSubtitlePreference: 'manual-first' });
      if (ownGeneration !== generation || loadController.signal.aborted) return;
      const selected = selectBestTrack(tracks, settings.preferredLanguage, settings.bseSubtitlePreference);
      if (!selected) {
        transitionTo('empty', { message: BSE.I18n?.t('subtitle_preference_no_match') || '当前字幕偏好下没有可用轨道' });
        return;
      }
      state.selectedTrackId = selected.id;
      await loadTrack(selected, {
        mediaGeneration: ownGeneration,
        signal: loadController.signal,
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
        fault
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

  function openSidePanel(tab = '') {
    safeSendMessage({
      type: 'BSE_OPEN_SIDE_PANEL',
      ...(tab ? { tab } : {})
    });
  }

  function captureMessageResponse(result) {
    const frame = result || { success: false, error: 'CAPTURE_UNAVAILABLE', message: '截帧模块未返回结果' };
    return {
      ok: Boolean(frame.success),
      frame,
      error: frame.success ? undefined : frame.error,
      message: frame.success ? undefined : frame.message,
      mediaKey: state.mediaKey
    };
  }

  function installRuntimeMessages() {
    if (!isContextValid() || !chrome?.runtime?.onMessage?.addListener) return;
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!isContextValid()) return false;
        if (message?.type === 'BSE_VIDEO_RUNTIME_PING') {
          sendResponse({ ok: true, mediaKey: state.mediaKey || null, status: state.status });
          return false;
        }
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
          const expectedMediaKey = String(message.expectedMediaKey || '').trim();
          if (expectedMediaKey && expectedMediaKey !== String(state.mediaKey || '').trim()) {
            diagnostic('端侧字幕拦截', `拒绝跨媒体字幕：expected=${expectedMediaKey} · current=${String(state.mediaKey || '').trim() || 'unknown'}`);
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
            return false;
          }
          const cues = Array.isArray(message.cues) ? message.cues : [];
          const track = message.track || {
            id: 'native-asr',
            name: `端侧本地转录 (${cues.length} 句)`,
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
          if (message.mediaContext && BSE.MediaContext?.sameOwner?.(message.mediaContext, { mediaKey: state.mediaKey })) {
            state.mediaContext = BSE.MediaContext.create(message.mediaContext);
          }
          state.status = cues.length ? 'ready' : 'empty';
          state.message = cues.length ? `已加载端侧转录字幕 · 共 ${cues.length} 条` : '端侧转录未识别到字幕';
          state.cueRevision = (state.cueRevision || 0) + 1;
          if (cues.length) void persistCurrentSubtitleState();
          diagnostic('端侧字幕加载', `成功载入端侧转录字幕 · media=${String(state.mediaKey || '').trim() || 'unknown'} · 共 ${cues.length} 条`);
          publish(true);
          panel?.syncLayout();
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === 'BSE_APPLY_SUBTITLE_PATCHES') {
          const expectedMediaKey = String(message.expectedMediaKey || '').trim();
          const expectedTrackId = String(message.expectedTrackId || '').trim();
          const expectedCueRevision = Number(message.expectedCueRevision);
          if (!expectedMediaKey || expectedMediaKey !== String(state.mediaKey || '').trim()) {
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey, cueRevision: state.cueRevision });
            return false;
          }
          if (expectedTrackId && expectedTrackId !== String(state.selectedTrackId || '').trim()) {
            sendResponse({ ok: false, error: 'SUBTITLE_TRACK_CHANGED', mediaKey: state.mediaKey, cueRevision: state.cueRevision });
            return false;
          }
          if (Number.isFinite(expectedCueRevision) && expectedCueRevision !== Number(state.cueRevision || 0)) {
            sendResponse({ ok: false, error: 'SUBTITLE_REVISION_CHANGED', mediaKey: state.mediaKey, cueRevision: state.cueRevision });
            return false;
          }

          const patches = Array.isArray(message.patches) ? message.patches : [];
          const appliedPatches = [];
          const seen = new Set();
          for (const patch of patches) {
            const index = Number(patch?.index);
            const content = String(patch?.content || '').trim();
            if (!Number.isInteger(index) || index < 0 || index >= state.cues.length || !content || seen.has(index)) continue;
            seen.add(index);
            if (content === String(state.cues[index]?.content || '').trim()) continue;
            appliedPatches.push({ index, content });
          }

          const changedCount = appliedPatches.length;
          if (changedCount > 0) {
            const nextCues = state.cues.map((cue) => ({ ...cue }));
            appliedPatches.forEach((patch) => {
              nextCues[patch.index].content = patch.content;
            });
            const selectedTrack = state.tracks.find((track) => String(track.id) === String(state.selectedTrackId)) || state.tracks[0] || null;
            const correctionStore = BSE.Utils?.UnifiedSubtitleCache;
            if (!correctionStore?.recordCorrections) {
              sendResponse({ ok: false, error: 'SUBTITLE_CORRECTION_STORE_UNAVAILABLE', changedCount: 0, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
              return false;
            }
            const subtitleKey = persistentSubtitleKey(selectedTrack);
            if (!subtitleKey) {
              sendResponse({ ok: false, error: 'SUBTITLE_CACHE_IDENTITY_UNAVAILABLE', changedCount: 0, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
              return false;
            }
            const correctionPromise = correctionStore.recordCorrections(
              subtitleKey,
              String(state.selectedTrackId || ''),
              state.cues,
              appliedPatches,
              {
                title: state.title || getTitle(),
                author: state.authorInfo?.name || getAuthorInfo()?.name || '',
                trackId: String(state.selectedTrackId || ''),
                trackSource: selectedTrack?.source || '',
                language: selectedTrack?.lan || selectedTrack?.language || 'zh',
                langDoc: selectedTrack?.lanDoc || selectedTrack?.langDoc || '中文',
                cues: nextCues
              }
            );
            Promise.resolve(correctionPromise).then((saved) => {
              if (!saved) {
                diagnostic('字幕校对', '校对 patch 未能持久化，未修改当前字幕状态');
                sendResponse({ ok: false, error: 'SUBTITLE_PERSIST_FAILED', changedCount: 0, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
                return;
              }
              state.cues = nextCues;
              state.cueRevision = (state.cueRevision || 0) + 1;
              state.status = 'ready';
              state.message = `已应用字幕校对 · 修改 ${changedCount} 条`;
              cacheBody(`${state.mediaKey}:${state.selectedTrackId}`, state.cues);
              void persistCurrentSubtitleState({ persistUnified: false, deferSnapshot: true });
              diagnostic('字幕校对', `已按现有时间轴应用并持久化 ${changedCount} 条文本修改；时间范围与轨道结构保持不变`);
              publish(true);
              panel?.syncLayout();
              sendResponse({ ok: true, changedCount, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
            }).catch((error) => {
              diagnostic('字幕校对', `校对 patch 持久化失败，未修改当前字幕：${error?.message || error}`);
              sendResponse({ ok: false, error: 'SUBTITLE_PERSIST_FAILED', changedCount: 0, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
            });
            return true;
          }
          sendResponse({ ok: true, changedCount, mediaKey: state.mediaKey, cueRevision: state.cueRevision });
          return false;
        }
        if (message?.type === 'BSE_GET_STATE') {
          sendResponse(publicState());
          return false;
        }
        if (message?.type === 'BSE_GET_STATE_META') {
          sendResponse(publicStateMeta({
            sessionId: message.diagnosticSessionId,
            count: message.diagnosticCount,
            tailId: message.diagnosticTailId
          }));
          return false;
        }
        if (message?.type === 'BSE_GET_MEDIA_CONTEXT') {
          const expectedMediaKey = String(message.expectedMediaKey || '').trim();
          if (expectedMediaKey && expectedMediaKey !== String(state.mediaKey || '').trim()) {
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
            return false;
          }
          resolveCurrentMediaContext({ force: true })
            .then((mediaContext) => sendResponse({
              ok: Boolean(mediaContext),
              mediaKey: state.mediaKey,
              mediaContext: mediaContext || state.mediaContext || null
            }))
            .catch((error) => sendResponse({
              ok: false,
              error: error?.message || String(error),
              mediaKey: state.mediaKey,
              mediaContext: state.mediaContext || null
            }));
          return true;
        }
        if (message?.type === 'BSE_CAPTURE_BEST_FRAME') {
          if (message.expectedMediaKey && message.expectedMediaKey !== state.mediaKey) {
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
            return false;
          }
          const request = message.request || {};
          const options = message.options || {};
          if (!BSE.Media?.captureStableVideoFrame) {
            sendResponse({ ok: false, error: 'STABLE_CAPTURE_UNAVAILABLE', mediaKey: state.mediaKey });
            return false;
          }
          BSE.Media.captureStableVideoFrame(request, options)
            .then((result) => sendResponse(captureMessageResponse(result)))
            .catch((err) => sendResponse(captureMessageResponse({
              success: false,
              error: err?.code || 'CAPTURE_EXCEPTION',
              message: err?.message || String(err)
            })));
          return true;
        }
        if (message?.type === 'BSE_CAPTURE_FRAME') {
          if (message.expectedMediaKey && message.expectedMediaKey !== state.mediaKey) {
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
            return false;
          }
          const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null;
          const options = message.options || {};
          if (timestamp !== null && Number.isFinite(timestamp)) {
            if (!BSE.Media?.captureVideoFrameAt) {
              sendResponse(captureMessageResponse({ success: false, error: 'CAPTURE_UNAVAILABLE', message: '时间点截帧模块未加载' }));
              return false;
            }
            BSE.Media.captureVideoFrameAt(timestamp, options)
              .then((result) => sendResponse(captureMessageResponse(result)))
              .catch((err) => sendResponse(captureMessageResponse({
                success: false,
                error: err?.code || 'CAPTURE_EXCEPTION',
                message: err?.message || String(err)
              })));
            return true;
          }
          const result = BSE.Media?.captureVideoFrame(null, options) || { success: false, error: 'CAPTURE_UNAVAILABLE', message: '截帧模块未加载' };
          sendResponse(captureMessageResponse(result));
          return false;
        }
        if (message?.type === 'BSE_RESOLVE_YOUTUBE_IN_TAB') {
          const requestedVideoId = String(message.videoId || '').trim();
          const currentUrlVideoId = BSE.Utils?.getYouTubeVideoId?.(window.location.href) || '';
          const expectedMediaKey = requestedVideoId ? `yt:${requestedVideoId}` : '';
          if (!requestedVideoId
            || currentUrlVideoId !== requestedVideoId
            || String(state.mediaKey || '').trim() !== expectedMediaKey) {
            diagnostic('字幕身份拦截', `拒绝跨视频 YouTube 解析：requested=${expectedMediaKey || 'unknown'} · current=${String(state.mediaKey || '').trim() || 'unknown'}`);
            sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
            return false;
          }
          if (BSE.YouTube?.bridgeRequest) {
            BSE.YouTube.bridgeRequest('FETCH_VIDEO_SUBTITLE', { videoId: requestedVideoId }, 15000)
              .then((result) => {
                if (String(result?.videoId || '') !== requestedVideoId) {
                  diagnostic('字幕身份拦截', `YouTube bridge 返回了其他视频：requested=yt:${requestedVideoId} · returned=yt:${String(result?.videoId || 'unknown')}`);
                  sendResponse({ ok: false, error: 'MEDIA_CONTEXT_CHANGED', mediaKey: state.mediaKey });
                  return;
                }
                sendResponse({ ok: true, result });
              })
              .catch((err) => sendResponse({ ok: false, error: err.message }));
            return true;
          }
          sendResponse({ ok: false, error: 'YouTube 桥接未初始化' });
          return false;
        }
        if (message?.type === 'BSE_GET_PLAYLIST') {
          if (BSE.YouTube?.bridgeRequest) {
            BSE.YouTube.bridgeRequest('GET_PLAYLIST', {}, 5000)
              .then((playlist) => sendResponse({ ok: true, playlist }))
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
        ensurePlaybackSync();
        scheduleLoad(reason);
        schedulePanelMount(reason);
      } else {
        stopPlaybackSync();
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
    // The MAIN-world bridge coalesces YouTube finish/data-updated/spfdone into
    // ROUTE_CHANGED. Keep only the early start hook here; listening to the same
    // finish events in both worlds creates duplicate mount/load scheduling.
    document.addEventListener('yt-navigate-start', () => handleNavigation('yt_navigate_start'), { passive: true });

    let observedKey = null;
    const routeInterval = setInterval(() => {
      if (!isContextValid()) {
        clearInterval(routeInterval);
        return;
      }
      if (document.hidden) return;
      if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
        stopPlaybackSync();
        if (observedKey) {
          observedKey = null;
          panel?.ensureRootMounted(platform);
        }
        return;
      }
      ensurePlaybackSync();
      const key = BSE.Utils.getMediaKey(platform);
      if (key && key !== observedKey) {
        observedKey = key;
        if (key !== state.mediaKey) {
          scheduleLoad('route_fallback');
          schedulePanelMount('route_fallback');
        }
      }
    }, 750);
  }

  let activeSyncVideo = null;
  let onTimeUpdateHandler = null;
  let playbackSyncInterval = null;
  let playbackUpdateRaf = null;

  async function applySubtitlePreferenceChange() {
    if (!initialized || !BSE.Utils.isMatchingVideoUrl(location.href)) return;
    const mediaKey = state.mediaKey;
    const mediaGeneration = generation;
    const tracks = Array.isArray(state.tracks) ? [...state.tracks] : [];
    if (!mediaKey || !tracks.length || state.status === 'loading') {
      scheduleLoad('subtitle_preference_changed');
      return;
    }

    const settings = await safeStorageGet({ preferredLanguage: '', bseSubtitlePreference: 'manual-first' });
    if (mediaKey !== state.mediaKey || mediaGeneration !== generation) return;
    const selected = selectBestTrack(tracks, settings.preferredLanguage, settings.bseSubtitlePreference);
    if (!selected) {
      state.status = 'empty';
      state.message = BSE.I18n?.t('subtitle_preference_no_match') || '当前字幕偏好下没有可用轨道';
      state.selectedTrackId = null;
      state.cues = [];
      state.activeIndex = -1;
      state.lastError = null;
      state.isRefreshing = false;
      publish(true);
      return;
    }

    if (String(selected.id) === String(state.selectedTrackId) && state.cues.length) {
      return;
    }
    await loadTrack(selected, { mediaGeneration, force: false, preserveExisting: false });
  }

  function installPreferenceSync() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes?.bseSubtitlePreference && initialized && BSE.Utils.isMatchingVideoUrl(location.href)) {
        applySubtitlePreferenceChange().catch(() => {});
      }
    });
  }

  function stopPlaybackSync() {
    if (playbackSyncInterval) {
      clearInterval(playbackSyncInterval);
      playbackSyncInterval = null;
    }
    if (playbackUpdateRaf) {
      cancelAnimationFrame(playbackUpdateRaf);
      playbackUpdateRaf = null;
    }
    if (activeSyncVideo && onTimeUpdateHandler) {
      activeSyncVideo.removeEventListener('timeupdate', onTimeUpdateHandler);
    }
    activeSyncVideo = null;
    onTimeUpdateHandler = null;
    lastPlaybackIndex = -2;
  }

  function syncPlaybackVideoElement() {
    if (!isContextValid()) {
      stopPlaybackSync();
      return;
    }
    if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
      stopPlaybackSync();
      return;
    }
    if (document.hidden || !state.cues.length) return;
    if (platform === BSE.PLATFORM.YOUTUBE && document.querySelector('.html5-video-player.ad-showing, ytd-player.ad-interrupting')) return;

    const video = document.querySelector('video');
    if (!video || video === activeSyncVideo) return;
    if (activeSyncVideo && onTimeUpdateHandler) {
      activeSyncVideo.removeEventListener('timeupdate', onTimeUpdateHandler);
    }
    if (playbackUpdateRaf) {
      cancelAnimationFrame(playbackUpdateRaf);
      playbackUpdateRaf = null;
    }
    activeSyncVideo = video;
    onTimeUpdateHandler = () => {
      if (playbackUpdateRaf) return;
      playbackUpdateRaf = requestAnimationFrame(() => {
        playbackUpdateRaf = null;
        if (document.hidden || !state.cues.length || !BSE.Utils.isMatchingVideoUrl(location.href)) return;
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

  function ensurePlaybackSync() {
    if (!BSE.Utils.isMatchingVideoUrl(location.href) || playbackSyncInterval) return;
    syncPlaybackVideoElement();
    playbackSyncInterval = setInterval(syncPlaybackVideoElement, 500);
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
      ensurePlaybackSync();
      const pending = pendingLoad;
      pendingLoad = null;
      scheduleLoad(pending?.reason || 'init', Boolean(pending?.force));
    }
  }

  function installBpxEpisodeListener() {
    if (platform !== BSE.PLATFORM.BILIBILI) return;
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const item = /** @type {HTMLElement | null} */ (target?.closest('.bpx-player-ctrl-eplist-menu-item, .cur-list li, .video-episode-card, .bili-video-pod__item') || null);
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
  installPreferenceSync();
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
