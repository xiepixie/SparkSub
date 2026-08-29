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

    const isTrans = Boolean(payload.tlang || payload.isTranslated);
    if (isTrans) {
      const baseTrackId = payload.id ? payload.id.split(':tlang:')[0] : '';
      const baseTrack = rawTracks.find((t) => (baseTrackId && t.vssId === baseTrackId))
        || rawTracks.find((t) => t.languageCode === (payload.sourceLan || 'en'))
        || rawTracks[0];
      if (baseTrack) {
        player.setOption?.('captions', 'track', baseTrack);
      }
      player.setOption?.('captions', 'translationLanguage', {
        languageCode: payload.tlang || payload.lan || 'zh-Hans',
        languageName: '中文（简体）'
      });
    } else {
      player.setOption?.('captions', 'translationLanguage', null);
      const selected = rawTracks.find((track) => (
        (track.vssId && track.vssId === payload.id)
        || (track.languageCode === payload.lan && Boolean(track.kind === 'asr') === Boolean(payload.isAuto))
      ));
      if (selected) player.setOption?.('captions', 'track', selected);
      else if (payload.lan) player.setOption?.('captions', 'track', { languageCode: payload.lan });
    }

    const button = document.querySelector('.ytp-subtitles-button');
    if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
    return { ok: true };
  }

  async function fetchVideoSubtitle(videoId) {
    if (!videoId) throw new Error('缺少 videoId');
    const ytcfg = window.ytcfg;
    const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY') || '';
    const innertubeContext = ytcfg?.get?.('INNERTUBE_CONTEXT') || {
      client: {
        clientName: 'WEB',
        clientVersion: ytcfg?.get?.('INNERTUBE_CLIENT_VERSION') || '2.20260101.01.00',
        hl: ytcfg?.get?.('HL') || 'zh-CN',
        gl: ytcfg?.get?.('GL') || 'US'
      }
    };

    let captionTracks = [];
    let title = '';
    let author = '';
    let cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let rawText = '';
    let cues = [];

    // 1. 同源获取 watch 页面 HTML（带真实 Cookie 与页面上下文）
    try {
      const watchResp = await fetch(`/watch?v=${videoId}`);
      const html = await watchResp.text();

      // 尝试直接提取官方 transcriptEndpoint 并调用官方接口
      const dataMatch = html.match(/var\s+ytInitialData\s*=\s*(\{.+?\});/s) || html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
      if (dataMatch) {
        try {
          const d = JSON.parse(dataMatch[1]);
          const str = JSON.stringify(d);
          const epMatch = str.match(/\"getTranscriptEndpoint\":\{(\"params\":\"[^\"]+\")/);
          if (epMatch) {
            const transcriptParams = JSON.parse('{' + epMatch[1] + '}').params;
            const transcriptUrl = apiKey ? `/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false` : '/youtubei/v1/get_transcript?prettyPrint=false';
            const tResp = await fetch(transcriptUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-YouTube-Client-Name': '1',
                'X-YouTube-Client-Version': innertubeContext.client?.clientVersion || '2.20260101.01.00'
              },
              body: JSON.stringify({
                context: innertubeContext,
                params: transcriptParams
              })
            });
            const tData = await tResp.json();
            const actions = tData?.actions || [];
            for (const act of actions) {
              const segments = act?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments
                || act?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;
              if (Array.isArray(segments) && segments.length > 0) {
                const parsedCues = [];
                for (const seg of segments) {
                  const r = seg?.transcriptSegmentRenderer;
                  if (r) {
                    const from = Number(r.startMs || 0) / 1000;
                    const to = Number(r.endMs || (Number(r.startMs || 0) + 2000)) / 1000;
                    const content = r.snippet?.runs?.map((item) => item.text).join('') || '';
                    if (content.trim()) parsedCues.push({ from, to, content: content.trim() });
                  }
                }
                if (parsedCues.length > 0) {
                  cues = parsedCues;
                  rawText = JSON.stringify({ events: cues.map((c) => ({ tStartMs: c.from * 1000, dDurationMs: (c.to - c.from) * 1000, segs: [{ utf8: c.content }] })) });
                  break;
                }
              }
            }
          }
        } catch {}
      }

      // 提取 playerResponse 元数据与 captionTracks
      const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s) || html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (m) {
        const d = JSON.parse(m[1]);
        captionTracks = d?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (d?.videoDetails) {
          title = d.videoDetails.title || '';
          author = d.videoDetails.author || '';
          cover = d.videoDetails.thumbnail?.thumbnails?.[0]?.url || cover;
        }
      }
    } catch {}

    // 如果通过 get_transcript 已经拿到字幕，直接返回
    if (cues.length > 0) {
      return {
        ok: true,
        title,
        author,
        cover,
        rawText,
        cues,
        captionTracks,
        // get_transcript does not expose a reliable caption-track identity.
        // Keep this separate from listed tracks so the queue can try them first.
        chosenTrack: {
          id: 'youtube-native-transcript',
          languageCode: 'auto',
          name: { simpleText: 'YouTube 原生 Transcript' },
          isTranscriptFallback: true
        }
      };
    }

    // 2. 若 get_transcript 未成功，回退到 player / timedtext 提取
    if (!captionTracks.length) {
      try {
        const playerUrl = apiKey ? `/youtubei/v1/player?key=${apiKey}&prettyPrint=false` : '/youtubei/v1/player?prettyPrint=false';
        const resp = await fetch(playerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': innertubeContext.client?.clientVersion || '2.20260101.01.00'
          },
          body: JSON.stringify({
            context: innertubeContext,
            videoId,
            racyCheckOk: true,
            contentCheckOk: true
          })
        });
        const data = await resp.json();
        captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (data?.videoDetails) {
          if (!title) title = data.videoDetails.title || '';
          if (!author) author = data.videoDetails.author || '';
          if (data.videoDetails.thumbnail?.thumbnails?.[0]?.url) cover = data.videoDetails.thumbnail.thumbnails[0].url;
        }
      } catch {}
    }

    if (!captionTracks.length) {
      return { ok: false, error: '该视频未提供字幕轨道', title, author, cover, captionTracks: [] };
    }

    // 规范化并合成中文自动翻译轨道
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

    const chosenTrack = captionTracks.find((t) => /zh|cn|chinese|中/i.test(t.languageCode || t.name?.simpleText || ''))
      || captionTracks.find((t) => /en|english/i.test(t.languageCode || t.name?.simpleText || ''))
      || captionTracks[0];

    const candidateTracks = [chosenTrack, ...captionTracks.filter((t) => t !== chosenTrack)];
    let actualTrack = chosenTrack;

    for (const track of candidateTracks) {
      if (!track?.baseUrl) continue;
      const candidateUrls = [
        track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`,
        track.baseUrl.includes('fmt=') ? track.baseUrl.replace(/fmt=\w+/, 'fmt=srv3') : `${track.baseUrl}&fmt=srv3`,
        track.baseUrl.includes('fmt=') ? track.baseUrl.replace(/fmt=\w+/, 'fmt=vtt') : `${track.baseUrl}&fmt=vtt`,
        track.baseUrl
      ];
      for (const u of candidateUrls) {
        try {
          const subResp = await fetch(u);
          const text = await subResp.text();
          if (text && !text.includes('<!DOCTYPE html>')) {
            rawText = text;
            actualTrack = track;
            break;
          }
        } catch {}
      }
      if (rawText) break;
    }

    return {
      ok: Boolean(rawText),
      title,
      author,
      cover,
      rawText,
      captionTracks,
      chosenTrack: actualTrack
    };
  }

  function getPlaylistData() {
    let listId = '';
    try {
      listId = new URL(location.href).searchParams.get('list') || '';
    } catch {}
    let title = '';
    const items = [];

    // 1. 尝试从 ytInitialData 获取
    try {
      const initData = window.ytInitialData;
      // 场景 A: Watch page with playlist panel
      const playlistRenderer = initData?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
      if (playlistRenderer) {
        title = playlistRenderer.title || '';
        const rawContents = playlistRenderer.contents || [];
        for (const item of rawContents) {
          const v = item.playlistPanelVideoRenderer;
          if (!v || !v.videoId) continue;
          const epTitle = v.title?.simpleText || v.title?.runs?.map((r) => r.text).join('') || '';
          const epDuration = v.lengthText?.simpleText || '';
          items.push({
            id: v.videoId,
            title: epTitle,
            url: `https://www.youtube.com/watch?v=${v.videoId}&list=${listId || ''}`,
            duration: epDuration,
            author: v.shortBylineText?.runs?.[0]?.text || ''
          });
        }
      }

      // 场景 B: Playlist page (/playlist?list=...)
      if (!items.length) {
        const tabs = initData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
        const tabContent = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer;
        if (tabContent) {
          title = initData?.metadata?.playlistMetadataRenderer?.title || initData?.header?.playlistHeaderRenderer?.title?.simpleText || '';
          const rawContents = tabContent.contents || [];
          for (const item of rawContents) {
            const v = item.playlistVideoRenderer;
            if (!v || !v.videoId) continue;
            const epTitle = v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '';
            const epDuration = v.lengthText?.simpleText || '';
            items.push({
              id: v.videoId,
              title: epTitle,
              url: `https://www.youtube.com/watch?v=${v.videoId}&list=${listId || ''}`,
              duration: epDuration,
              author: v.shortBylineText?.runs?.[0]?.text || ''
            });
          }
        }
      }
    } catch {}

    // 2. DOM 兜底探测
    if (!items.length) {
      const plTitleElem = document.querySelector('ytd-playlist-panel-renderer #header-description h3, ytd-playlist-panel-renderer .title, ytd-playlist-header-renderer .title, #playlist .title');
      if (plTitleElem) title = plTitleElem.textContent?.trim() || '';

      const domItems = document.querySelectorAll('ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer');
      domItems.forEach((node) => {
        const link = node.querySelector('a#wc-endpoint, a#video-title, a#thumbnail');
        const href = link?.getAttribute('href') || '';
        const vMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        const epVid = vMatch ? vMatch[1] : '';
        if (!epVid) return;
        const titleElem = node.querySelector('#video-title, .title');
        const epTitle = titleElem?.textContent?.trim() || '';
        const durElem = node.querySelector('span.ytd-thumbnail-overlay-time-status-renderer, #time-status');
        const epDur = durElem?.textContent?.trim() || '';
        items.push({
          id: epVid,
          title: epTitle,
          url: `https://www.youtube.com/watch?v=${epVid}&list=${listId || ''}`,
          duration: epDur,
          author: ''
        });
      });
    }

    return { listId: listId || '', title: title || 'YouTube 播放列表', items };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
    const { requestId, type, payload } = event.data;
    let result;
    try {
      if (type === 'GET_PLAYER_STATE') {
        result = getState();
        window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result }, '*');
      } else if (type === 'SELECT_TRACK') {
        result = selectTrack(payload || {});
        window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result }, '*');
      } else if (type === 'GET_VIDEO_DATA') {
        result = getState().video;
        window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result }, '*');
      } else if (type === 'GET_PLAYLIST') {
        result = getPlaylistData();
        window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result }, '*');
      } else if (type === 'FETCH_VIDEO_SUBTITLE') {
        fetchVideoSubtitle(payload?.videoId).then((res) => {
          window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: true, result: res }, '*');
        }).catch((err) => {
          window.postMessage({ channel: CHANNEL, direction: 'response', requestId, ok: false, error: err.message }, '*');
        });
      } else {
        throw new Error(`未知请求：${type}`);
      }
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
