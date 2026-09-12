(() => {
  'use strict';

  const BSE = globalThis.BSE;
  const { delay, fetchWithTimeout, getBvid, getBilibiliPage } = BSE.Utils;
  let lastResolvedView = null;
  let lastMediaContext = null;

  /** @returns {Error & { code: string, hint: string }} */
  function createError(code, message, hint = '') {
    const error = /** @type {Error & { code: string, hint: string }} */ (new Error(message));
    error.code = code;
    error.hint = hint;
    return error;
  }

  function sendMessageWithAbort(message, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, signal.reason || new DOMException('请求已取消', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      chrome.runtime.sendMessage(message)
        .then((result) => finish(resolve, result))
        .catch((error) => finish(reject, error));
    });
  }

  async function requestBackgroundJson(url, { signal, diagnostic, stage }) {
    diagnostic?.(stage, '通过扩展后台通道获取数据');
    const result = await sendMessageWithAbort({ type: 'BSE_FETCH_BILIBILI_RESOURCE', url }, signal);
    if (!result?.success) {
      const code = result?.error?.code || 'BACKGROUND_NO_RESPONSE';
      const message = result?.error?.message || '扩展后台没有返回请求结果';
      const hint = code === 'NETWORK_OR_PERMISSION'
        ? '请检查扩展站点权限、代理或网络拦截；此请求已绕过页面跨域限制。'
        : code === 'HOST_NOT_ALLOWED'
          ? '字幕资源使用了尚未授权的域名，请复制诊断信息。'
          : '请检查网络连接或重新加载扩展。';
      diagnostic?.(stage, `后台请求失败 · ${code} · ${message}`);
      throw createError(code, `${stage}失败：${message}`, hint);
    }

    diagnostic?.(
      stage,
      `HTTP ${result.status} · ${result.contentType || 'application/json'} · ${String(result.text || '').length} 字符`
    );
    if (!result.ok) {
      throw createError(
        `HTTP_${result.status}`,
        `${stage} HTTP ${result.status}`,
        result.status === 403 ? '登录状态或地区限制可能导致无法访问。' : '接口返回了非正常状态。'
      );
    }

    try {
      return JSON.parse(result.text);
    } catch {
      throw createError(
        'INVALID_JSON',
        `${stage}返回的不是有效 JSON`,
        `响应类型：${result.contentType || '未知'}，正文长度：${String(result.text || '').length}`
      );
    }
  }

  async function requestPageJson(url, { signal, diagnostic, stage }) {
    const endpoint = (() => {
      try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}`;
      } catch {
        return '接口端点';
      }
    })();
    diagnostic?.(stage, `通过页面同站请求 · ${endpoint}`);
    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      cache: 'no-store',
      signal
    });
    const text = await response.text();
    diagnostic?.(stage, `HTTP ${response.status} · ${response.headers.get('content-type') || 'application/json'} · ${text.length} 字符`);
    if (!response.ok) {
      throw createError(`HTTP_${response.status}`, `${stage} HTTP ${response.status}`, '接口返回了非正常状态。');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw createError('INVALID_JSON', `${stage}返回的不是有效 JSON`, `响应正文长度：${text.length}`);
    }
  }

  async function requestApiJson(url, options) {
    try {
      return await requestBackgroundJson(url, options);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      options.diagnostic?.('通道切换', `${options.stage} 后台通道异常，尝试前端同站请求 · ${error.message}`);
      return await requestPageJson(url, options);
    }
  }

  function assertApiSuccess(payload, stage) {
    if (payload?.code === 0 || payload?.code == null) return payload;
    throw createError(
      `BILI_API_${payload.code}`,
      `${stage}返回状态码 ${payload.code}：${payload.message || '未知错误'}`,
      '这通常与登录状态、风控限制或视频访问权限有关。'
    );
  }

  function assertViewIdentity(viewData, expectedBvid, stage = '视频信息接口') {
    const returnedBvid = String(viewData?.bvid || '').trim();
    const requestedBvid = String(expectedBvid || '').trim();
    if (returnedBvid && requestedBvid && returnedBvid.toLowerCase() !== requestedBvid.toLowerCase()) {
      throw createError(
        'BILI_VIEW_MEDIA_MISMATCH',
        `${stage}返回了其他视频：请求 ${requestedBvid}，返回 ${returnedBvid}`,
        '已阻止跨视频元数据进入当前字幕加载事务，请重新刷新。'
      );
    }
    return viewData;
  }

  function assertPlayerIdentity(payload, { bvid, cid, stage = '播放器接口' } = {}) {
    const data = payload?.data || {};
    const expectedBvid = String(bvid || '').trim();
    const expectedCid = String(cid ?? '').trim();
    const returnedBvid = String(data.bvid || '').trim();
    const returnedCid = String(data.cid ?? '').trim();
    const bvidMismatch = returnedBvid && expectedBvid && returnedBvid.toLowerCase() !== expectedBvid.toLowerCase();
    const cidMismatch = returnedCid && expectedCid && returnedCid !== expectedCid;
    if (bvidMismatch || cidMismatch) {
      throw createError(
        'BILI_PLAYER_MEDIA_MISMATCH',
        `${stage}返回了其他媒体：请求 ${expectedBvid || 'unknown'} / cid ${expectedCid || 'unknown'}，返回 ${returnedBvid || 'unknown'} / cid ${returnedCid || 'unknown'}`,
        '已阻止错误字幕轨道进入当前视频；播放器接口返回身份与请求不一致。'
      );
    }
    return payload;
  }

  function assertTrackStillCurrent(track, stage = '字幕轨道') {
    const trackBvid = String(track?.bvid || '').trim();
    const trackCid = String(track?.cid ?? '').trim();
    const trackPage = Math.max(0, Number(track?.page) || 0);
    const currentBvid = String(getBvid() || '').trim();
    const currentKey = String(BSE.Utils?.getMediaKey?.(BSE.PLATFORM.BILIBILI) || '').trim();
    const exact = currentKey.match(/^bili:(BV[a-zA-Z0-9]+):cid([^:]+)$/i);
    const provisional = currentKey.match(/^bili:(BV[a-zA-Z0-9]+):p(\d+)$/i);
    const bvidMismatch = trackBvid && currentBvid && trackBvid.toLowerCase() !== currentBvid.toLowerCase();
    const cidMismatch = Boolean(exact && trackCid && String(exact[2]) !== trackCid);
    const pageMismatch = Boolean(provisional && trackPage > 0 && Number(provisional[2]) !== trackPage);
    if (bvidMismatch || cidMismatch || pageMismatch) {
      throw createError(
        'BILI_TRACK_MEDIA_CHANGED',
        `${stage}已不属于当前媒体：track=${trackBvid || 'unknown'} / cid ${trackCid || 'unknown'} / p${trackPage || '?'} · current=${currentKey || currentBvid || 'unknown'}`,
        '视频或分P已切换，旧字幕请求已被丢弃。'
      );
    }
    return true;
  }

  function normalizeTracks(rawTracks, context) {
    const seen = new Set();
    return (rawTracks || []).map((track, index) => {
      const rawUrl = String(track.subtitle_url || '');
      const subtitleUrl = rawUrl.startsWith('//')
        ? `https:${rawUrl}`
        : rawUrl.replace(/^http:\/\//i, 'https://');
      return {
        id: String(track.id_str || track.id || `${track.lan}:${index}`),
        lan: track.lan || '',
        lanDoc: track.lan_doc || track.lan || '未知语言',
        subtitleUrl,
        isAuto: String(track.lan || '').startsWith('ai-'),
        isCC: !String(track.lan || '').startsWith('ai-'),
        platform: BSE.PLATFORM.BILIBILI,
        ...context
      };
    }).filter((track) => {
      if (!track.subtitleUrl || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  }

  function extractDomVideoData(bvid) {
    try {
      if (typeof document === 'undefined') return null;
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('__INITIAL_STATE__')) {
          const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/s) || text.match(/__INITIAL_STATE__\s*=\s*(\{.+?\});?/s);
          if (match && match[1]) {
            const parsed = JSON.parse(match[1]);
            if (parsed?.videoData && (!bvid || parsed.videoData.bvid === bvid)) {
              return parsed.videoData;
            }
          }
        }
      }
    } catch {}
    return null;
  }

  async function fetchMediaContext({ signal, diagnostic } = {}) {
    if (!BSE.MediaContext) return null;
    const bvid = getBvid();
    if (!bvid) return null;
    const page = getBilibiliPage(location.href);
    let viewData = lastResolvedView?.bvid?.toLowerCase() === bvid.toLowerCase()
      ? lastResolvedView.viewData
      : extractDomVideoData(bvid);
    if (!viewData) {
      try {
        const view = assertApiSuccess(await requestApiJson(
          `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          { signal, diagnostic, stage: '视频语境' }
        ), '视频语境接口');
        viewData = assertViewIdentity(view?.data, bvid, '视频语境接口');
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return null;
      }
    }
    const pageInfo = viewData?.pages?.find((entry) => Number(entry?.page) === Number(page))
      || viewData?.pages?.[Math.max(0, page - 1)]
      || viewData?.pages?.[0]
      || {};
    const cid = pageInfo?.cid || viewData?.cid;
    if (!cid) return null;
    const resolvedPage = Number(pageInfo?.page) || page;
    const mediaKey = BSE.Utils.rememberBilibiliMediaIdentity?.({
      bvid,
      cid,
      page: resolvedPage,
      pageCount: Array.isArray(viewData?.pages) && viewData.pages.length
        ? viewData.pages.length
        : Math.max(0, Number(viewData?.videos) || 0)
    }) || `bili:${bvid}:cid${cid}`;
    let tags = BSE.MediaContext.sameOwner(lastMediaContext, { mediaKey }) ? lastMediaContext.tags : [];
    if (!tags?.length) {
      try {
        tags = await BSE.MediaContext.fetchBilibiliTags(bvid, { signal });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        diagnostic?.('视频语境', 'Bilibili 标签暂时不可用，继续使用标题与分类语境');
        tags = [];
      }
    }
    const context = BSE.MediaContext.fromBilibiliView({ bvid, cid, page: resolvedPage, viewData, tags });
    lastResolvedView = { bvid, viewData };
    lastMediaContext = context;
    return context;
  }

  /**
   * 发现当前 B 站视频分P的所有可用字幕轨道
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void }} [options]
   * @returns {Promise<Array<import('../types/bse').SubtitleTrack>>}
   */
  async function discoverTracks({ signal, diagnostic } = {}) {
    const bvid = getBvid();
    if (!bvid) throw createError('BVID_NOT_FOUND', '未识别到视频 BV 号', '请确认当前处于 B 站视频播放页面。');

    let viewData = extractDomVideoData(bvid);
    if (viewData) {
      diagnostic?.('页面数据', `直接从页面嵌入数据读取视频信息 · aid ${viewData.aid || '未知'}`);
    } else {
      const view = assertApiSuccess(await requestApiJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { signal, diagnostic, stage: '视频信息' }
      ), '视频信息接口');
      viewData = assertViewIdentity(view?.data, bvid, '视频信息接口');
    }
    if (!viewData) throw createError('VIEW_DATA_EMPTY', '视频信息接口缺少数据', '接口数据结构可能已更新。');
    lastResolvedView = { bvid, viewData };

    const validCids = new Set([
      String(viewData.cid || ''),
      ...(viewData.pages || []).map((p) => String(p.cid || ''))
    ]);

    // 实验特性：优先尝试从 BPX 播放器活跃选集 DOM 快速提取 CID（必须严格属于当前视频的 validCids，严防 SPA 跨视频污染）
    const mediaKey = BSE.Utils.getMediaKey ? BSE.Utils.getMediaKey(BSE.PLATFORM.BILIBILI) : '';
    let domCid = (BSE.Utils.getActiveCidFromDom ? BSE.Utils.getActiveCidFromDom() : null)
      || (mediaKey && mediaKey.includes(':cid') ? mediaKey.split(':cid')[1] : null);
    if (domCid && !validCids.has(String(domCid))) {
      diagnostic?.('实验特性/BPX校验', `检测到残留选集 CID (${domCid}) 不属于当前视频，已安全丢弃`);
      domCid = null;
    }

    if (domCid) {
      diagnostic?.('实验特性/BPX探测', `检测到当前视频活跃选集 · 锁定 CID: ${domCid}`);
    }

    // BPX only contributes the active CID hint. Track discovery stays on one
    // authoritative player path below, avoiding two competing sources of
    // subtitle_url for the same media identity.
    const page = getBilibiliPage(location.href);
    const pageInfo = (domCid
      ? viewData.pages?.find((p) => String(p.cid || '') === String(domCid))
      : null)
      || viewData.pages?.find((p) => Number(p.page) === Number(page))
      || viewData.pages?.[Math.max(0, page - 1)]
      || viewData.pages?.[0]
      || {};
    const cid = domCid || pageInfo.cid || viewData.cid;
    const aid = viewData.aid;
    if (!cid) throw createError('CID_NOT_FOUND', '视频信息中未找到 CID', `BV 号：${bvid}，分P：${page}`);
    const resolvedPage = Number(pageInfo.page) || page;
    const resolvedMediaKey = BSE.Utils.rememberBilibiliMediaIdentity?.({
      bvid,
      cid,
      page: resolvedPage,
      pageCount: Array.isArray(viewData.pages) && viewData.pages.length
        ? viewData.pages.length
        : Math.max(0, Number(viewData.videos) || 0)
    });
    diagnostic?.('视频定位', `已定位视频 · 分P: P${resolvedPage} · CID: ${cid}`);
    if (resolvedMediaKey) diagnostic?.('视频身份', `已确认精确媒体身份 · ${resolvedMediaKey}`);

    try {
      const player = assertPlayerIdentity(assertApiSuccess(await requestApiJson(
        `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
        { signal, diagnostic, stage: '播放器信息/WBI' }
      ), '播放器信息/WBI'), { bvid, cid, stage: '播放器信息/WBI' });
      const tracks = normalizeTracks(player.data?.subtitle?.subtitles, {
        bvid,
        aid,
        cid,
        page: resolvedPage,
        part: pageInfo.part || '',
        duration: Number(pageInfo.duration || viewData.duration) || 0
      });
      diagnostic?.('查找字幕', `WBI 播放器接口返回 ${tracks.length} 条字幕轨道`);
      return tracks;
    } catch (wbiError) {
      if (wbiError?.name === 'AbortError') throw wbiError;
      diagnostic?.('通道切换', `WBI 接口不可用 (${wbiError.message})，尝试兼容接口`);
      try {
        const player = assertPlayerIdentity(assertApiSuccess(await requestApiJson(
          `https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(aid || '')}&bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
          { signal, diagnostic, stage: '播放器信息/兼容' }
        ), '播放器信息/兼容'), { bvid, cid, stage: '播放器信息/兼容' });
        const tracks = normalizeTracks(player.data?.subtitle?.subtitles, {
          bvid,
          aid,
          cid,
          page: resolvedPage,
          part: pageInfo.part || '',
          duration: Number(pageInfo.duration || viewData.duration) || 0
        });
        diagnostic?.('查找字幕', `兼容播放器接口返回 ${tracks.length} 条字幕轨道`);
        return tracks;
      } catch (compatError) {
        if (compatError?.name === 'AbortError') throw compatError;
        throw wbiError;
      }
    }
  }

  /**
   * 加载指定 B 站字幕轨道的完整条目
   * @param {import('../types/bse').SubtitleTrack} track
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void }} [options]
   * @returns {Promise<Array<import('../types/bse').Cue>>}
   */
  async function loadTrack(track, { signal, diagnostic } = {}) {
    if (!track?.subtitleUrl) {
      throw createError('SUBTITLE_URL_EMPTY', '字幕轨道缺少正文地址', '接口数据结构可能已更新。');
    }
    assertTrackStillCurrent(track, '字幕正文请求前');
    const cleanUrl = track.subtitleUrl.startsWith('//')
      ? `https:${track.subtitleUrl}`
      : track.subtitleUrl.replace(/^http:\/\//i, 'https://');

    let data;
    try {
      data = await requestBackgroundJson(cleanUrl, { signal, diagnostic, stage: '字幕内容' });
    } catch (bgError) {
      if (signal?.aborted) throw bgError;
      diagnostic?.('通道切换', `后台获取失败，尝试前端直接请求 · ${bgError.message}`);
      try {
        const response = await fetchWithTimeout(cleanUrl, { signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
        diagnostic?.('通道切换', `前端直接请求成功 · HTTP ${response.status}`);
      } catch (pageError) {
        throw bgError;
      }
    }

    assertTrackStillCurrent(track, '字幕正文返回后');
    const rawBody = Array.isArray(data?.body) ? data.body : [];
    const cues = BSE.Parsers.normalize(rawBody);
    diagnostic?.('解析字幕', `原始字幕 ${rawBody.length} 条 · 解析有效 ${cues.length} 条`);
    if (!cues.length) {
      throw createError(
        'SUBTITLE_BODY_EMPTY',
        '字幕正文已返回，但没有可用条目',
        `JSON 顶层字段：${Object.keys(data || {}).slice(0, 8).join(', ') || '无'}`
      );
    }
    const knownDuration = Math.max(0, Number(track.duration) || 0);
    const maxCueTo = Math.max(0, Number(cues[cues.length - 1]?.to) || 0);
    if (knownDuration > 10 && maxCueTo > knownDuration + 8) {
      throw createError(
        'BILI_SUBTITLE_DURATION_MISMATCH',
        `字幕时长与当前视频严重不符：视频 ${Math.round(knownDuration)}s / 字幕 ${Math.round(maxCueTo)}s`,
        '已阻止疑似其他视频的字幕正文覆盖当前视频。'
      );
    }
    if (knownDuration >= 90 && maxCueTo < knownDuration * 0.35 && cues.length < 20) {
      throw createError(
        'BILI_SUBTITLE_INCOMPLETE',
        `字幕只覆盖当前视频前 ${Math.round(maxCueTo)}s，疑似残缺或错误正文`,
        '已保留当前字幕；可稍后重试或使用本地转录。'
      );
    }
    return cues;
  }

  /**
   * 解析 B 站当前视频所属的多 P / UGC 合集拓扑树结构
   * @param {string} [currentBvid]
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void, pageUrl?: string }} [options]
   * @returns {Promise<import('../types/bse').BilibiliTree>}
   */
  function canonicalPartLabel(page, part) {
    const pageNumber = Math.max(1, Number(page) || 1);
    const rawPart = String(part || '').trim();
    const prefix = new RegExp(`^P\\s*0*${pageNumber}(?=\\s|$|[：:._-])\\s*[：:._-]?\\s*`, 'i');
    const cleanPart = rawPart.replace(prefix, '').trim();
    return cleanPart ? `P${pageNumber} ${cleanPart}` : `P${pageNumber}`;
  }

  async function fetchMediaTree(currentBvid = getBvid(), { signal, diagnostic, pageUrl } = {}) {
    const mediaPageUrl = pageUrl || (typeof location !== 'undefined' ? location.href : '');
    const normalizedBvid = typeof currentBvid === 'string' ? getBvid(currentBvid) : null;
    if (!normalizedBvid) {
      throw createError('BVID_NOT_FOUND', '未识别到有效的 B 站 BV 号', '批量导出只会向视频接口发送规范化后的 BV 号。');
    }
    currentBvid = normalizedBvid;
    // 实验特性：优先检测页面是否存在 BPX 播放器选集菜单
    const eplistDomItems = typeof document !== 'undefined'
      ? Array.from(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.bpx-player-ctrl-eplist-menu-item')))
      : [];
    if (eplistDomItems.length > 1) {
      diagnostic?.('实验特性/BPX拓扑', `从播放器选集 DOM 捕获到 ${eplistDomItems.length} 个专题选集`);
      const pageTitle = (typeof document !== 'undefined' ? document.title.replace(/\s*[-_|]\s*(哔哩哔|bilibili).*$/i, '').trim() : '') || 'B站专题选集';
      /** @type {import('../types/bse').BilibiliTree} */
      const tree = {
        kind: 'bpx_eplist',
        isCollection: true,
        seasonId: null,
        title: pageTitle,
        currentBvid,
        currentPage: 1,
        totalEpisodesCount: eplistDomItems.length,
        sections: [],
        items: []
      };
      const sectionTitle = '专题选集';
      const sectionKey = '01_专题选集';
      const epObj = {
        index: 1,
        bvid: currentBvid,
        aid: '',
        title: pageTitle,
        pagesCount: eplistDomItems.length,
        items: []
      };
      const section = { index: 1, title: sectionTitle, key: sectionKey, episodes: [epObj], items: [] };

      eplistDomItems.forEach((el, idx) => {
        const cid = el.getAttribute('data-cid') || el.dataset.cid || '';
        const itemTitle = (el.textContent || '').trim() || `第${idx + 1}讲`;
        /** @type {import('../types/bse').BilibiliItem} */
        const item = {
          kind: 'episode',
          globalIndex: idx + 1,
          sectionIndex: 1,
          sectionTitle,
          sectionKey,
          episodeIndex: 1,
          episodeTitle: pageTitle,
          page: idx + 1,
          part: itemTitle,
          duration: 0,
          bvid: currentBvid,
          aid: '',
          cid,
          title: itemTitle,
          sourceUrl: mediaPageUrl || `https://www.bilibili.com/video/${currentBvid}?p=${idx + 1}`
        };
        epObj.items.push(item);
        section.items.push(item);
        tree.items.push(item);
      });
      tree.sections.push(section);
      return tree;
    }

    let viewData = extractDomVideoData(currentBvid);
    if (!viewData) {
      const view = assertApiSuccess(await requestApiJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(currentBvid)}`,
        { signal, diagnostic, stage: '合集拓扑' }
      ), '视频信息接口');
      viewData = view?.data;
    }
    if (!viewData) throw createError('VIEW_DATA_EMPTY', '无法获取视频合集拓扑信息');

    const ugc = viewData.ugc_season;
    const currentPage = BSE.Utils?.getBilibiliPage
      ? BSE.Utils.getBilibiliPage(mediaPageUrl)
      : (Number(new URL(mediaPageUrl || `https://www.bilibili.com/video/${currentBvid}`).searchParams.get('p')) || 1);

    /** @type {import('../types/bse').BilibiliTree} */
    const tree = {
      kind: ugc?.sections?.length ? 'ugc_season' : ((viewData.pages || []).length > 1 ? 'multi_page' : 'single'),
      isCollection: !!(ugc?.sections?.length),
      seasonId: ugc?.id || ugc?.season_id || null,
      title: ugc?.title || viewData.title || 'B站字幕合集',
      currentBvid,
      currentPage,
      totalEpisodesCount: 0,
      sections: [],
      items: []
    };

    let globalIndex = 0;
    const seen = new Set();

    if (ugc?.sections?.length) {
      ugc.sections.forEach((sec, sIdx) => {
        const sectionTitle = sec.title || `第${sIdx + 1}节`;
        const sectionKey = /^\s*\d{1,3}[-_.、\s]/.test(sectionTitle) ? sectionTitle : `${String(sIdx + 1).padStart(2, '0')}_${sectionTitle}`;
        const section = { index: sIdx + 1, title: sectionTitle, key: sectionKey, episodes: [], items: [] };
        tree.totalEpisodesCount += (sec.episodes?.length || 0);

        (sec.episodes || []).forEach((ep, epIdx) => {
          const bvid = ep.bvid || ep.arc?.bvid;
          const aid = ep.aid || ep.arc?.aid;
          let epPages = ep.pages && ep.pages.length ? ep.pages : null;
          // If this episode matches the current video and has multi-pages:
          if (!epPages && (bvid === currentBvid || String(aid) === String(viewData.aid)) && viewData.pages?.length) {
            epPages = viewData.pages;
          }
          if (!epPages) {
            epPages = [{
              cid: ep.cid || ep.arc?.cid,
              page: ep.page?.page || 1,
              part: ep.page?.part || ep.title || `第${epIdx + 1}集`,
              duration: ep.page?.duration || ep.arc?.duration || 0
            }];
          }
          const epObj = {
            index: epIdx + 1,
            bvid,
            aid,
            title: ep.title || ep.arc?.title || `第${epIdx + 1}集`,
            pagesCount: epPages.length,
            items: []
          };

          epPages.forEach((pObj, pIdx) => {
            const cid = pObj.cid;
            if (!bvid || !aid || !cid) return;
            const uniqueKey = `${bvid}:${cid}`;
            if (seen.has(uniqueKey)) return;
            seen.add(uniqueKey);
            globalIndex += 1;

            const baseTitle = ep.title || ep.arc?.title || `第${epIdx + 1}集`;
            let itemTitle = baseTitle;
            if (epPages.length > 1) {
              itemTitle = `${baseTitle} · ${canonicalPartLabel(pObj.page || pIdx + 1, pObj.part)}`;
            }

            /** @type {import('../types/bse').BilibiliItem} */
            const item = {
              kind: 'episode',
              globalIndex,
              sectionIndex: sIdx + 1,
              sectionTitle,
              sectionKey,
              episodeIndex: epIdx + 1,
              episodeTitle: baseTitle,
              page: pObj.page || pIdx + 1,
              part: pObj.part || '',
              duration: pObj.duration || 0,
              bvid,
              aid,
              cid,
              title: itemTitle,
              sourceUrl: `https://www.bilibili.com/video/${bvid}?p=${pObj.page || pIdx + 1}`
            };
            epObj.items.push(item);
            section.items.push(item);
            tree.items.push(item);
          });
          section.episodes.push(epObj);
        });
        if (section.items.length) tree.sections.push(section);
      });
    } else if ((viewData.pages || []).length > 1) {
      tree.totalEpisodesCount = 1;
      const sectionTitle = '全集';
      const sectionKey = '01_全集';
      const epObj = {
        index: 1,
        bvid: currentBvid,
        aid: viewData.aid,
        title: viewData.title || '当前视频',
        pagesCount: viewData.pages.length,
        items: []
      };
      const section = { index: 1, title: sectionTitle, key: sectionKey, episodes: [epObj], items: [] };
      (viewData.pages || []).forEach((p, idx) => {
        globalIndex += 1;
        /** @type {import('../types/bse').BilibiliItem} */
        const item = {
          kind: 'page',
          globalIndex,
          sectionIndex: 1,
          sectionTitle,
          sectionKey,
          episodeIndex: 1,
          episodeTitle: viewData.title || '当前视频',
          bvid: currentBvid,
          aid: viewData.aid,
          cid: p.cid,
          page: p.page || idx + 1,
          part: p.part || `P${idx + 1}`,
          duration: p.duration || 0,
          title: canonicalPartLabel(p.page || idx + 1, p.part),
          sourceUrl: `https://www.bilibili.com/video/${currentBvid}?p=${p.page || idx + 1}`
        };
        epObj.items.push(item);
        section.items.push(item);
        tree.items.push(item);
      });
      tree.sections.push(section);
    } else {
      tree.totalEpisodesCount = 1;
      const sectionTitle = '单视频';
      const sectionKey = '01_单视频';
      /** @type {import('../types/bse').BilibiliItem} */
      const item = {
        kind: 'single',
        globalIndex: 1,
        sectionIndex: 1,
        sectionTitle,
        sectionKey,
        episodeIndex: 1,
        episodeTitle: viewData.title || '当前视频',
        page: 1,
        part: '',
        duration: viewData.duration || 0,
        bvid: currentBvid,
        aid: viewData.aid,
        cid: viewData.cid,
        title: viewData.title || '当前视频',
        sourceUrl: `https://www.bilibili.com/video/${currentBvid}`
      };
      const epObj = {
        index: 1,
        bvid: currentBvid,
        aid: viewData.aid,
        title: viewData.title || '当前视频',
        pagesCount: 1,
        items: [item]
      };
      tree.sections.push({ index: 1, title: sectionTitle, key: sectionKey, episodes: [epObj], items: [item] });
      tree.items.push(item);
    }

    tree.hasNestedPages = tree.sections.some(s => (s.episodes || []).some(e => e.pagesCount > 1));
    diagnostic?.('合集分析', `已解析合集架构 · 类型: ${tree.kind} · 共 ${tree.items.length} 个分P · ${tree.sections.length} 个分组${tree.hasNestedPages ? ' (含复合多P)' : ''}`);
    return tree;
  }

  function isChineseSubtitleTrack(sub) {
    const lan = String(sub?.lan || '').toLowerCase();
    const doc = String(sub?.lan_doc || '');
    return lan === 'zh' || lan.startsWith('zh-') || lan.startsWith('ai-zh') || /中文|汉语|漢語|华语|華語/.test(doc);
  }

  function isAiSubtitleTrack(sub) {
    return String(sub?.lan || '').toLowerCase().startsWith('ai-');
  }

  function chooseBilibiliSubtitle(subList, preference = 'manual-first') {
    const all = Array.isArray(subList) ? subList : [];
    const chinese = all.filter(isChineseSubtitleTrack);
    const pool = chinese.length ? chinese : all;
    const manual = pool.filter(s => !isAiSubtitleTrack(s));
    const ai = pool.filter(isAiSubtitleTrack);

    if (preference === 'manual-only') return manual[0] || null;
    if (preference === 'ai-first') return ai[0] || manual[0] || pool[0] || null;
    return manual[0] || ai[0] || pool[0] || null;
  }

  async function fetchItemSubtitle(item, preference, signal, diagnostic) {
    const queryUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(item.bvid || '')}&cid=${encodeURIComponent(item.cid)}&aid=${encodeURIComponent(item.aid || '')}`;
    let resp;
    try {
      resp = assertApiSuccess(await requestApiJson(queryUrl, {
        signal,
        diagnostic,
        stage: `分P${item.page || item.globalIndex}播放器/WBI`
      }), `分P${item.page || item.globalIndex}播放器/WBI`);
    } catch (wbiError) {
      if (wbiError?.name === 'AbortError') throw wbiError;
      diagnostic?.('批量字幕通道', `WBI 播放器接口不可用，切换兼容接口 · ${wbiError.message}`);
      resp = assertApiSuccess(await requestApiJson(
        `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(item.bvid || '')}&cid=${encodeURIComponent(item.cid)}&aid=${encodeURIComponent(item.aid || '')}`,
        {
          signal,
          diagnostic,
          stage: `分P${item.page || item.globalIndex}播放器/兼容`
        }
      ), `分P${item.page || item.globalIndex}播放器/兼容`);
    }
    const rawSubs = resp?.data?.subtitle?.subtitles;
    if (!rawSubs || !rawSubs.length) return { status: 'no_subtitle', item, reason: '未返回字幕轨道（UP主未上传且未生成AI字幕）' };

    const chosen = chooseBilibiliSubtitle(rawSubs, preference);
    if (!chosen) return { status: 'no_subtitle', item, reason: '未找到符合偏好的字幕语言' };

    const trackObj = {
      id: String(chosen.id || chosen.lan || 'batch-subtitle'),
      lan: chosen.lan || 'unknown',
      lanDoc: chosen.lan_doc || chosen.lan || '字幕',
      subtitleUrl: chosen.subtitle_url,
      isAuto: isAiSubtitleTrack(chosen),
      isCC: !isAiSubtitleTrack(chosen),
      platform: BSE.PLATFORM.BILIBILI,
      language: chosen.lan,
      label: chosen.lan_doc || chosen.lan,
      isAI: isAiSubtitleTrack(chosen)
    };
    try {
      let cues = await loadTrack(trackObj, { signal, diagnostic });
      if (!cues || !cues.length) return { status: 'no_subtitle', item, track: trackObj, reason: '字幕内容为空' };
      const stableSubtitleKey = item.bvid && Number(item.page) > 0 ? `bili:${item.bvid}:p${Number(item.page)}` : '';
      if (stableSubtitleKey && BSE.Utils?.UnifiedSubtitleCache?.applyCorrections) {
        const corrected = await BSE.Utils.UnifiedSubtitleCache.applyCorrections(stableSubtitleKey, trackObj.id, cues);
        cues = corrected.cues;
        if (corrected.appliedCount > 0) {
          diagnostic?.('批量字幕校对', `P${item.page || item.globalIndex} 已复用 ${corrected.appliedCount} 条已保存字幕修正`);
        }
      }
      return { status: 'success', item, track: trackObj, body: cues };
    } catch (trackErr) {
      if (trackErr?.name === 'AbortError') throw trackErr;
      return { status: 'failed', item, track: trackObj, reason: trackErr?.message || '下载字幕正文失败' };
    }
  }

  /**
   * 执行多分 P / 合集字幕批量导出任务并打包
   * @param {import('../types/bse').BilibiliTree} tree
   * @param {import('../types/bse').BatchConfig} config
   * @param {(stats: import('../types/bse').BatchProgressStats, currentItem: import('../types/bse').BilibiliItem | null, phase: string, task: import('../types/bse').BatchControlTask) => void} [onProgress]
   * @param {import('../types/bse').BatchControlTask} [controlTask]
   * @returns {Promise<any>}
   */
  async function runBatchExport(tree, config, onProgress, controlTask = {}, options = {}) {
    const diagnostic = options.diagnostic || controlTask.diagnostic;
    const selectedItems = BSE.BatchExport.selectItems(tree, config);
    if (!selectedItems.length) throw createError('NO_ITEMS', '当前范围没有可导出的条目');

    diagnostic?.('批量导出', `启动导出任务 · 范围: ${config.scope} · 选中 ${selectedItems.length} 个分P · 输出: ${config.outputMode}`);

    const controller = new AbortController();
    controlTask.controller = controller;
    controlTask.running = true;
    controlTask.paused = false;
    controlTask.cancelled = false;

    const results = new Array(selectedItems.length);
    const stats = { total: selectedItems.length, completed: 0, success: 0, noSub: 0, failed: 0 };
    let nextIndex = 0;

    const report = (currentItem = null, phase = 'fetching') => {
      onProgress?.({ ...stats }, currentItem, phase, controlTask);
    };
    report(null, 'starting');

    const worker = async () => {
      while (true) {
        while (controlTask.paused && !controlTask.cancelled) {
          await delay(200);
        }
        if (controlTask.cancelled || controller.signal.aborted) return;

        const idx = nextIndex++;
        if (idx >= selectedItems.length) return;
        const item = selectedItems[idx];
        report(item, 'fetching');

        let res = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (controlTask.cancelled || controller.signal.aborted) return;
          try {
            res = await fetchItemSubtitle(item, config.preference || 'manual-first', controller.signal, diagnostic);
            if (res.status === 'success' || res.status === 'no_subtitle') {
              break;
            }
          } catch (err) {
            if (err?.name === 'AbortError' || controlTask.cancelled) return;
            res = { status: 'failed', item, reason: err?.message || '抓取失败' };
          }
          if (attempt === 0 && res?.status === 'failed') {
            await delay(350);
          }
        }

        results[idx] = res || { status: 'failed', item, reason: '未知错误' };
        if (results[idx].status === 'success') stats.success += 1;
        else if (results[idx].status === 'no_subtitle') stats.noSub += 1;
        else stats.failed += 1;

        if (!controlTask.cancelled) {
          stats.completed += 1;
          report(item, 'fetching');
        }
        await delay(280); // Adaptive rate limiting jitter
      }
    };

    const CONCURRENCY = Math.min(3, selectedItems.length);
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (controlTask.cancelled) {
      controlTask.running = false;
      report(null, 'cancelled');
      diagnostic?.('批量导出', '用户中断了批量导出任务');
      return { selectedItems, results, stats, cancelled: true };
    }

    report(null, 'building');
    const output = await BSE.BatchExport.createOutput(tree, selectedItems, results, stats, config, {
      onPackProgress: (percent) => {
        onProgress?.({ ...stats, packPercent: percent }, null, 'packing', controlTask);
      }
    });
    const outputLabel = output.mode === 'copy-text'
      ? `复制用长文本 · ${output.text.length} 字符`
      : (output.mode === 'merged-file' ? `单一${config.format === 'txt' ? '纯文本' : ' Markdown'}长文件` : 'ZIP 压缩包');
    diagnostic?.('批量完成', `已生成${outputLabel} · 成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`);

    controlTask.running = false;
    report(null, 'done');
    return { selectedItems, results, stats, output };
  }

  /**
   * 提取当前 B 站视频的真实 DASH 独立音频流直链信息
   * @param {{ signal?: AbortSignal, diagnostic?: (stage: string, message: string) => void }} [options]
   * @returns {Promise<{
   *   bvid: string,
   *   cid: string | number,
   *   title: string,
   *   audioUrl: string,
   *   backupUrls: string[],
   *   bandwidth: number,
   *   codecs: string,
   *   id: string | number | undefined,
   *   duration: number,
   *   headers: Record<string, string>,
   *   allAudioStreams: Array<{ id: string | number | undefined, codecs: string, bandwidth: number, baseUrl: string }>
   * }>}
   */
  async function fetchAudioStream({ signal, diagnostic } = {}) {
    const bvid = getBvid();
    if (!bvid) throw createError('BVID_NOT_FOUND', '未识别到视频 BV 号');

    let playInfo = null;
    let title = '音频';
    let cid = null;

    // 1. 优先获取视频权威元数据 (Title, CID)
    let viewData = extractDomVideoData(bvid);
    if (!viewData) {
      const view = assertApiSuccess(await requestApiJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { signal, diagnostic, stage: '视频信息' }
      ), '视频信息接口');
      viewData = view?.data;
    }
    const page = Number(new URL(location.href).searchParams.get('p') || 1);
    const pageInfo = viewData?.pages?.[Math.max(0, page - 1)] || viewData?.pages?.[0] || {};
    cid = pageInfo.cid || viewData?.cid;
    title = pageInfo.part || viewData?.title || 'B站音频';

    if (!cid) {
      throw createError('CID_NOT_FOUND', '未定位到视频 CID，无法提取音频流');
    }

    // 2. 通过 playurl 官方 API 动态获取精准匹配当前 bvid 与 cid 的 DASH 音轨 (严禁盲目读取静态 DOM 脚本，杜绝 SPA 串台)
    const playUrlApi = `https://api.bilibili.com/x/player/wbi/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=0&fnval=4048&fnver=0&fourk=1`;
    try {
      const res = assertApiSuccess(await requestApiJson(playUrlApi, {
        signal,
        diagnostic,
        stage: 'DASH音频接口'
      }), 'DASH音频接口');
      playInfo = res;
    } catch (playErr) {
      if (playErr?.name === 'AbortError') throw playErr;
      const fallbackUrl = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=0&fnval=4048`;
      playInfo = assertApiSuccess(await requestApiJson(fallbackUrl, {
        signal,
        diagnostic,
        stage: 'DASH音频接口(兼容)'
      }), 'DASH音频接口(兼容)');
    }

    const audioStreams = playInfo?.data?.dash?.audio || [];
    const descriptor = BSE.Media?.selectBilibiliAudio(audioStreams);
    const normalizedStreams = BSE.Media?.normalizeBilibiliAudioStreams(audioStreams) || [];
    if (!descriptor) {
      throw createError('AUDIO_STREAM_NOT_FOUND', '未找到可用的独立 DASH 音频流', '视频可能为老旧 flv/mp4 格式或无访问权限');
    }

    const sorted = [...normalizedStreams].sort((a, b) => b.bandwidth - a.bandwidth);
    const best = sorted.find((stream) => stream.url === descriptor.url) || sorted[0];

    diagnostic?.('音频提取', `成功提取 DASH 独立音频流 · 码率 ${(best.bandwidth / 1000).toFixed(0)} kbps · 编码 ${best.codecs || 'm4a'}`);

    return {
      bvid,
      cid,
      title,
      audioUrl: descriptor.url,
      backupUrls: descriptor.backupUrls,
      bandwidth: best.bandwidth || 0,
      codecs: best.codecs || 'mp4a.40.2',
      id: best.id,
      duration: playInfo?.data?.dash?.duration || 0,
      headers: descriptor.headers,
      allAudioStreams: sorted.map(s => ({
        id: s.id,
        codecs: s.codecs,
        bandwidth: s.bandwidth,
        baseUrl: s.url
      }))
    };
  }

  /**
   * 通过扩展后台代理下载带防盗链的 B 站 DASH 音频流并保存为本地文件
   * @param {{ audioUrl: string, title?: string, bandwidth?: number, codecs?: string }} audioData
   * @param {string} [filename]
   * @param {{ diagnostic?: (stage: string, message: string) => void }} [options]
   */
  async function downloadAudioFile(audioData, filename, { diagnostic } = {}) {
    if (!audioData?.audioUrl) throw new Error('缺少音频地址');
    const targetName = `${BSE.Utils.sanitizeFilename(filename || audioData.title || '音频')}.m4a`;

    diagnostic?.('音频下载', `正在下载 DASH 纯音频流 · ${targetName}`);

    // 方案 1：优先通过后台通道发起带 Referer 的下载请求
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'BSE_DOWNLOAD_MEDIA_FILE',
        url: audioData.audioUrl,
        filename: targetName
      });

      if (result?.success) {
        if (result.method === 'chrome.downloads') {
          diagnostic?.('音频下载', `已通过 Chrome 原生下载管理器保存音频 · 任务 ID: ${result.downloadId}`);
          return { success: true, method: 'chrome.downloads', filename: targetName };
        }

        if (result.base64) {
          const binary = atob(result.base64);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: result.contentType || 'audio/mp4' });
          BSE.Utils.downloadBlob(blob, targetName);
          diagnostic?.('音频下载', `已生成本地音频文件并保存 (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
          return { size: blob.size, filename: targetName };
        }
      } else if (result?.error) {
        diagnostic?.('通道切换', `后台通道下载返回错误 (${result.error.message})，尝试前端同域拉取`);
      }
    } catch (bgErr) {
      diagnostic?.('通道切换', `后台通信异常 (${bgErr.message})，尝试前端同域拉取`);
    }

    // 方案 2：前端同域回退拉取（在 B 站当前标签页环境下拉取）
    diagnostic?.('音频下载', `通过页面同域通道拉取音频数据 · ${targetName}`);
    let response;
    try {
      response = await fetch(audioData.audioUrl, { credentials: 'omit', cache: 'no-store' });
    } catch {
      const httpsUrl = audioData.audioUrl.replace(/^http:\/\//i, 'https://');
      response = await fetch(httpsUrl, { credentials: 'omit', cache: 'no-store' });
    }
    if (!response.ok) {
      const errText = `HTTP ${response.status}`;
      diagnostic?.('音频错误', `前端同域拉取失败 · ${errText}`);
      throw new Error(errText);
    }
    const blob = await response.blob();
    BSE.Utils.downloadBlob(blob, targetName);
    diagnostic?.('音频下载', `前端同域拉取成功并保存 (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    return { size: blob.size, filename: targetName };
  }

  BSE.Bilibili = Object.freeze({
    discoverTracks,
    loadTrack,
    fetchMediaTree,
    runBatchExport,
    fetchAudioStream,
    fetchMediaContext,
    downloadAudioFile,
    chooseBilibiliSubtitle
  });
})();
