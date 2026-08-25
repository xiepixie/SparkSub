/**
 * SparkSub Offscreen Document Manager
 * Handles stage-based background transcription for Bilibili & YouTube
 */
(() => {
  'use strict';

  const BSE = globalThis.BSE;
  let worker = null;
  let isRunning = false;
  const activeAbortControllers = new Map();

  function formatTranscriptLocally(cues, title, author, url) {
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
      `- **字数/句数**：${normalizedCues.length} 条字幕`,
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

  function getWorker() {
    if (!worker) {
      try {
        worker = new Worker('transcript-worker.js');
      } catch (err) {
        console.warn('[SparkSub Offscreen] 实例化 Dedicated Worker 失败，使用主线程保底:', err);
      }
    }
    return worker;
  }

  function postProcessOnWorker(cues, title, author, url) {
    return new Promise((resolve) => {
      const w = getWorker();
      if (!w) {
        resolve(formatTranscriptLocally(cues, title, author, url));
        return;
      }
      const reqId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
      const timer = setTimeout(() => {
        resolve(formatTranscriptLocally(cues, title, author, url));
      }, 3000);

      const handler = (e) => {
        const data = e.data || {};
        if (data.id === reqId) {
          clearTimeout(timer);
          w.removeEventListener('message', handler);
          if (data.type === 'POSTPROCESS_SUCCESS' && data.result) {
            resolve(data.result);
          } else {
            resolve(formatTranscriptLocally(cues, title, author, url));
          }
        }
      };
      w.addEventListener('message', handler);
      try {
        w.postMessage({
          type: 'POSTPROCESS_TRANSCRIPT',
          id: reqId,
          payload: { cues, title, author, url }
        });
      } catch {
        clearTimeout(timer);
        resolve(formatTranscriptLocally(cues, title, author, url));
      }
    });
  }

  /**
   * Bilibili 阶段级提取管道
   * @param {import('../types/bse').QueueItem} item
   * @param {AbortSignal} signal
   */
  async function processBilibiliItem(item, signal) {
    const bvid = item.targetId;
    const pageMatch = String(item.id || item.url || '').match(/[?&]p=(\d+)|:p(\d+)/i);
    const targetPageNum = pageMatch ? parseInt(pageMatch[1] || pageMatch[2], 10) : 1;

    // === Stage 1: Resolving ===
    if (!item.metaCache?.cid || !item.metaCache?.title) {
      item.stage = 'resolving';
      item.progress = 15;
      item.stageHint = '正在解析视频元数据与分P CID…';
      await saveItemState(item);

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
      await saveItemState(item);
    }

    const cid = item.metaCache.cid;

    // === Stage 2: Fetching Caption ===
    item.stage = 'fetching_caption';
    item.progress = 40;
    item.stageHint = '正在提取官方/AI字幕…';
    await saveItemState(item);

    const { imgKey, subKey } = await fetchBilibiliNavWbiKeys(signal);
    const signed = BSE.Tracker.calculateWbiSign({ bvid, cid }, imgKey, subKey);
    const playerResp = await BSE.Utils.fetchWithTimeout(
      `https://api.bilibili.com/x/player/wbi/v2?${signed.query}`,
      { signal, credentials: 'include' },
      7000
    );
    const playerJson = await playerResp.json();
    const subtitles = playerJson?.data?.subtitle?.subtitles || [];

    if (!subtitles.length) {
      // 尝试回退至音频探测
      item.stage = 'fetching_audio';
      item.progress = 60;
      item.stageHint = '未发现字幕轨道，正在探测音频直链…';
      await saveItemState(item);

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
        await saveItemState(item);
        return;
      }
      throw new Error('该视频暂无字幕轨道，且无法获取音频流');
    }

    const chosenSub = subtitles.find((s) => /zh|cn|中/i.test(s.lan || s.lan_doc || '')) || subtitles[0];
    let subUrl = chosenSub.subtitle_url || chosenSub.url || '';
    if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
    else if (subUrl.startsWith('http://')) subUrl = subUrl.replace(/^http:\/\//i, 'https://');

    const subContentResp = await BSE.Utils.fetchWithTimeout(subUrl, { signal, credentials: 'include' }, 7000);
    const subContentJson = await subContentResp.json();
    const rawBody = subContentJson?.body || [];

    if (!rawBody.length) {
      throw new Error('字幕内容为空');
    }

    const cues = rawBody.map((b) => ({
      from: Number(b.from || 0),
      to: Number(b.to || 0),
      content: String(b.content || '').trim()
    }));

    // === Stage 3: Postprocessing ===
    item.stage = 'postprocessing';
    item.progress = 85;
    item.stageHint = '正在进行自然段落切分与 Markdown 格式化…';
    await saveItemState(item);

    const processed = await postProcessOnWorker(cues, item.title, item.author, item.url);

    item.subtitle = {
      language: chosenSub.lan,
      langDoc: chosenSub.lan_doc || '中文',
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
    await saveItemState(item);
  }

  /**
   * YouTube 阶段级提取管道
   * @param {import('../types/bse').QueueItem} item
   * @param {AbortSignal} signal
   */
  async function processYouTubeItem(item, signal) {
    const videoId = item.targetId;

    // === Stage 1: Resolving ===
    if (!item.captionTrackCache?.tracks || !item.metaCache?.title) {
      item.stage = 'resolving';
      item.progress = 15;
      item.stageHint = '正在解析 YouTube 视频信息与字幕轨道…';
      await saveItemState(item);

      // 请求 YouTube InnerTube Player API
      const playerResp = await BSE.Utils.fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: 'WEB',
                clientVersion: '2.20240101.01.00',
                hl: 'zh-CN',
                gl: 'CN'
              }
            }
          }),
          signal
        },
        7000
      );

      let playerJson = null;
      try {
        playerJson = await playerResp.json();
      } catch {}

      let tracks = playerJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const vDetails = playerJson?.videoDetails || {};

      item.title = vDetails.title || item.title;
      item.author = vDetails.author || item.author;
      item.cover = vDetails.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      item.metaCache = {
        title: item.title,
        author: item.author,
        cover: item.cover
      };

      // 若 InnerTube 接口未拿到 tracks，尝试回退解析 Watch HTML
      if (!tracks.length) {
        const watchResp = await BSE.Utils.fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}`, { signal }, 7000);
        const html = await watchResp.text();
        const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (playerMatch) {
          try {
            const parsed = JSON.parse(playerMatch[1]);
            tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (!item.title && parsed?.videoDetails?.title) item.title = parsed.videoDetails.title;
            if (!item.author && parsed?.videoDetails?.author) item.author = parsed.videoDetails.author;
          } catch {}
        }
      }

      if (!tracks.length) {
        throw new Error('未发现该 YouTube 视频的可用字幕轨道');
      }

      item.captionTrackCache = { tracks };
      await saveItemState(item);
    }

    const tracks = item.captionTrackCache.tracks || [];

    // === Stage 2: Fetching Caption ===
    item.stage = 'fetching_caption';
    item.progress = 45;
    item.stageHint = '正在下载并解析 YouTube 字幕…';
    await saveItemState(item);

    // 优先选择中文（普通话/简体/繁体），其次英文，最后首个轨道
    const chosenTrack = tracks.find((t) => /zh|cn|chinese|中/i.test(`${t.languageCode} ${t.name?.simpleText || ''}`))
      || tracks.find((t) => /en/i.test(t.languageCode))
      || tracks[0];

    const targetUrl = chosenTrack.baseUrl.includes('fmt=') ? chosenTrack.baseUrl : `${chosenTrack.baseUrl}&fmt=json3`;
    const captionResp = await BSE.Utils.fetchWithTimeout(targetUrl, { signal }, 7000);
    const captionText = await captionResp.text();

    let cues = BSE.Parsers.parseJson3(captionText);
    if (!cues.length) {
      cues = BSE.Parsers.parseVtt(captionText);
    }
    if (!cues.length) {
      throw new Error('无法解析 YouTube 字幕文本');
    }

    // === Stage 3: Postprocessing ===
    item.stage = 'postprocessing';
    item.progress = 85;
    item.stageHint = '正在格式化字幕为结构化 Markdown…';
    await saveItemState(item);

    const processed = await postProcessOnWorker(cues, item.title, item.author, item.url);

    item.subtitle = {
      language: chosenTrack.languageCode || 'unknown',
      langDoc: chosenTrack.name?.simpleText || chosenTrack.languageCode || '字幕',
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
    await saveItemState(item);
  }

  async function saveItemState(updatedItem) {
    const queue = await BSE.Queue.getQueue();
    const index = queue.findIndex((i) => i.id === updatedItem.id);
    if (index >= 0) {
      queue[index] = updatedItem;
      await BSE.Queue.saveQueue(queue);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BSE_QUEUE_UPDATED', item: updatedItem }).catch(() => {});
    }
  }

  async function fetchBilibiliNavWbiKeys(signal) {
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

  /**
   * 队列执行主循环（统一委托至 BSE.Queue.processPendingJobs）
   */
  async function runQueueLoop() {
    if (isRunning) return;
    isRunning = true;

    try {
      if (BSE.Queue?.processPendingJobs) {
        await BSE.Queue.processPendingJobs();
      }
    } catch (err) {
      console.warn('[SparkSub Offscreen] 队列执行异常:', err);
    } finally {
      isRunning = false;
      // 队列执行完毕，通知 Service Worker 关闭 Offscreen Document
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'BSE_OFFSCREEN_QUEUE_IDLE' }).catch(() => {});
      }
    }
  }

  // 监听来自 Service Worker、侧边栏或前端推荐流的各种触发指令
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (
        message?.type === 'BSE_OFFSCREEN_START' ||
        message?.type === 'BSE_ORCHESTRATOR_NOTIFY' ||
        message?.type === 'BSE_QUEUE_UPDATED' ||
        message?.type === 'BSE_QUEUE_ENQUEUE'
      ) {
        runQueueLoop();
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === 'BSE_OFFSCREEN_PING') {
        sendResponse({ ok: true, isRunning });
        return false;
      }
      return false;
    });
  }

  // 监听本地存储变化，一旦检测到有待处理队列自动启动
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes?.bse_transcription_queue_v1) {
        runQueueLoop();
      }
    });
  }

  // 启动时自动检查队列
  runQueueLoop();
})();
