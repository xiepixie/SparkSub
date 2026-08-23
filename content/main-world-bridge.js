(() => {
  'use strict';

  if (window.__BSE_MAIN_BRIDGE_INSTALLED__) return;
  window.__BSE_MAIN_BRIDGE_INSTALLED__ = true;

  const CHANNEL = 'bse-extension-bridge-v1';

  function getPlayer() {
    const player = document.getElementById('movie_player');
    return player && typeof player.getPlayerResponse === 'function' ? player : null;
  }

  function mapTrack(track, index) {
    const languageCode = track.languageCode || track.vssId || '';
    const kind = track.kind || (/^a\./.test(track.vssId || '') ? 'asr' : '');
    return {
      id: track.vssId || track.id || `${languageCode}:${kind}:${index}`,
      lan: languageCode,
      lanDoc: track.name?.simpleText
        || track.name?.runs?.map((item) => item.text).join('')
        || track.displayName
        || track.languageName
        || languageCode
        || '未知语言',
      subtitleUrl: track.url || track.baseUrl || '',
      isAuto: kind === 'asr',
      isTranslatable: Boolean(track.isTranslatable)
    };
  }

  function getCurrentVideoId(player) {
    try {
      const data = player?.getVideoData?.() || {};
      return data.video_id || data.videoId || new URL(location.href).searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function getTracks(player) {
    const candidates = [];
    const currentVideoId = getCurrentVideoId(player);

    try {
      const tracks = player?.getOption?.('captions', 'tracklist');
      if (Array.isArray(tracks)) candidates.push(...tracks);
    } catch {}
    try {
      const tracks = player?.getAudioTrack?.()?.captionTracks;
      if (Array.isArray(tracks)) candidates.push(...tracks);
    } catch {}
    try {
      const resp = player?.getPlayerResponse?.();
      const pVid = resp?.videoDetails?.videoId;
      if (pVid && currentVideoId && pVid === currentVideoId) {
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks)) candidates.push(...tracks);
      }
    } catch {}
    try {
      const initResp = window?.ytInitialPlayerResponse;
      const initVid = initResp?.videoDetails?.videoId;
      if (initVid && currentVideoId && initVid === currentVideoId) {
        const tracks = initResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks)) candidates.push(...tracks);
      }
    } catch {}
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      const flexyVid = watchFlexy?.playerData_?.videoDetails?.videoId;
      if (flexyVid && currentVideoId && flexyVid === currentVideoId) {
        const tracks = watchFlexy?.playerData_?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks)) candidates.push(...tracks);
      }
    } catch {}

    const seen = new Set();
    return candidates.map(mapTrack).filter((track) => {
      if (!track.subtitleUrl) return false;
      try {
        const u = new URL(track.subtitleUrl, location.origin);
        const v = u.searchParams.get('v');
        if (v && currentVideoId && v !== currentVideoId) return false;
      } catch {}
      const key = `${track.id}|${track.lan}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getState() {
    const player = getPlayer();
    const tracks = getTracks(player);
    let video = null;
    try {
      const data = player?.getVideoData?.() || {};
      const id = data.video_id || data.videoId || new URL(location.href).searchParams.get('v') || '';
      const title = data.title || document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || '';
      video = { id, title };
    } catch {}

    if (tracks.length > 0 || player) {
      return { ready: true, tracks, video };
    }
    return { ready: false, tracks: [], video: null };
  }

  function selectTrack(payload) {
    const player = getPlayer();
    if (!player) throw new Error('播放器尚未就绪');
    const rawTracks = player.getOption?.('captions', 'tracklist') || [];
    const selected = rawTracks.find((track) => (
      (track.vssId && track.vssId === payload.id)
      || (track.languageCode === payload.lan && Boolean(track.kind === 'asr') === Boolean(payload.isAuto))
    ));
    if (selected) player.setOption?.('captions', 'track', selected);
    else if (payload.lan) player.setOption?.('captions', 'track', { languageCode: payload.lan });

    const button = document.querySelector('.ytp-subtitles-button');
    if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
    return { ok: true };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
    const { requestId, type, payload } = event.data;
    let result;
    try {
      if (type === 'GET_PLAYER_STATE') result = getState();
      else if (type === 'SELECT_TRACK') result = selectTrack(payload || {});
      else if (type === 'GET_VIDEO_DATA') result = getState().video;
      else throw new Error(`未知请求：${type}`);
      window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result }, '*');
    } catch (error) {
      window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: false, error: error.message }, '*');
    }
  });

  ['yt-navigate-finish', 'yt-page-data-updated', 'spfdone'].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      window.postMessage({ channel: CHANNEL, direction: 'event', type: 'ROUTE_CHANGED' }, '*');
    });
  });
})();
