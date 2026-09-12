(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE;
  const BILIBILI_CDN_SUFFIXES = Object.freeze([
    'bilivideo.com',
    'bilivideo.cn',
    'hdslb.com',
    'hdslb.net',
    'biliapi.net'
  ]);
  const SAFE_HEADERS = Object.freeze({
    Referer: 'https://www.bilibili.com/',
    'User-Agent': globalThis.navigator?.userAgent || 'Mozilla/5.0 (SparkSub)'
  });
  const TRANSIENT_CAPTURE_ERRORS = new Set([
    'TARGET_NOT_BUFFERED',
    'FRAME_NOT_DECODED',
    'NO_STABLE_FRAME',
    'FINAL_FRAME_NOT_READY'
  ]);

  function isBilibiliCdnHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return BILIBILI_CDN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  function normalizeBilibiliUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const parsed = new URL(value.trim());
      // Keep this browser-side descriptor policy identical to SparkScribe's
      // BrowserNativeURLPolicy. Bilibili sometimes publishes an mcdn primary
      // URL on an explicit port such as :8082 while also providing ordinary
      // HTTPS backup URLs. Passing any explicit-port URL makes the native v2
      // request fail validation before audio download even starts, so discard
      // those candidates here and promote a compatible backup instead.
      if (parsed.protocol !== 'https:'
        || parsed.port
        || parsed.username
        || parsed.password
        || !isBilibiliCdnHost(parsed.hostname)) return '';
      return parsed.href;
    } catch {
      return '';
    }
  }

  function urlList(value) {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' ? [value] : [];
  }

  function normalizeBilibiliAudioStreams(audio) {
    return (Array.isArray(audio) ? audio : []).map((stream) => {
      const primaryCandidates = [stream?.baseUrl, stream?.base_url];
      const backupCandidates = [
        ...urlList(stream?.backupUrl),
        ...urlList(stream?.backup_url)
      ];
      const urls = [...primaryCandidates, ...backupCandidates]
        .map(normalizeBilibiliUrl)
        .filter(Boolean);
      const uniqueUrls = [...new Set(urls)];
      const bandwidth = Number(stream?.bandwidth);
      return {
        bandwidth,
        id: stream?.id,
        codecs: stream?.codecs || '',
        url: uniqueUrls[0] || '',
        backupUrls: uniqueUrls.slice(1)
      };
    }).filter((stream) => Number.isFinite(stream.bandwidth) && stream.url);
  }

  /** @returns {Extract<import('../types/bse').NativeHostSource, { kind: 'remote' }> | null} */
  function selectBilibiliAudio(audio) {
    const selected = normalizeBilibiliAudioStreams(audio)
      .sort((left, right) => right.bandwidth - left.bandwidth)[0];
    if (!selected) return null;
    return {
      kind: 'remote',
      url: selected.url,
      backupUrls: [...selected.backupUrls],
      headers: { ...SAFE_HEADERS }
    };
  }

  /**
   * 给剪贴板联系表一个受控布局。目标不是“塞下全部截图”，而是在主流视觉模型会缩放之前
   * 保住足够的横向文字分辨率；完整原图仍通过 ZIP 独立保留。
   * @param {number} frameCount
   * @param {{ maxFrames?: number, width?: number }} [options]
   * @returns {{ maxFrames: number, count: number, width: number, columns: number, gap: number, padding: number, headerHeight: number }}
   */
  function getContactSheetLayout(frameCount, options = {}) {
    const maxFrames = Math.max(1, Math.min(4, Math.round(Number(options.maxFrames) || 4)));
    const count = Math.max(0, Math.min(maxFrames, Math.round(Number(frameCount) || 0)));
    const width = Math.max(720, Math.min(1600, Math.round(Number(options.width) || 1152)));
    return {
      maxFrames,
      count,
      width,
      columns: count <= 2 ? 1 : 2,
      gap: 12,
      padding: 12,
      headerHeight: 34
    };
  }

  function resolveVideoElement(videoElement = null) {
    if (videoElement) return videoElement;
    if (typeof document === 'undefined') return null;
    return document.querySelector('.bpx-player-video-wrap video')
      || document.querySelector('#movie_player video')
      || document.querySelector('video');
  }

  /**
   * 从当前页面中的 HTML5 <video> 元素捕获高分辨率画面 (通道 A)
   * @param {HTMLVideoElement} [videoElement]
   * @param {object} [options]
   * @param {string} [options.format='image/webp'] 图像格式 ('image/webp', 'image/jpeg', 'image/png')
   * @param {number} [options.quality=0.92] 图像压缩质量 (0.1 - 1.0)
   * @param {number} [options.maxWidth] 可选最大宽度缩放
   * @returns {{ success: boolean, dataUrl?: string, width?: number, height?: number, originalWidth?: number, originalHeight?: number, timestamp?: number, duration?: number, format?: string, error?: string, message?: string }}
   */
  function captureVideoFrame(videoElement, options = {}) {
    if (typeof document === 'undefined') {
      return { success: false, error: 'NO_DOM_ENVIRONMENT', message: '当前非浏览器 DOM 环境' };
    }
    const video = resolveVideoElement(videoElement);

    if (!video) {
      return { success: false, error: 'NO_VIDEO_ELEMENT', message: '未找到有效视频播放器元素' };
    }

    const width = video.videoWidth || (video.clientWidth ? video.clientWidth * 2 : 0);
    const height = video.videoHeight || (video.clientHeight ? video.clientHeight * 2 : 0);

    if (!width || !height) {
      return { success: false, error: 'VIDEO_NOT_READY', message: '视频尺寸尚未就绪或尚未开始解码画面' };
    }

    let targetWidth = width;
    let targetHeight = height;
    if (options.maxWidth && options.maxWidth < width) {
      targetWidth = Math.round(options.maxWidth);
      targetHeight = Math.round((height * targetWidth) / width);
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        return { success: false, error: 'CANVAS_CONTEXT_FAILED', message: '创建 Canvas 2D 上下文失败' };
      }

      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      const format = options.format || 'image/webp';
      const quality = typeof options.quality === 'number' ? options.quality : 0.92;
      const dataUrl = canvas.toDataURL(format, quality);

      return {
        success: true,
        dataUrl,
        width: targetWidth,
        height: targetHeight,
        originalWidth: width,
        originalHeight: height,
        timestamp: Number(video.currentTime) || 0,
        duration: Number(video.duration) || 0,
        format
      };
    } catch (err) {
      return {
        success: false,
        error: err.name || 'SECURITY_ERROR',
        message: err.message || 'Canvas 画面提取受限 (CORS 跨域画布污染或播放器限制)'
      };
    }
  }

  /**
   * 从当前解码画面提取很小的灰度像素签名，用于候选帧之间的稳定性/细节比较。
   * 这里只保留 64x36 级别的分析数据，不复制第二份高清截图。
   * @param {HTMLVideoElement} video
   * @returns {{ signature: number[], brightness: number, detail: number }}
   */
  function measureVisualSignature(video) {
    try {
      const sampleWidth = 64;
      const sampleHeight = Math.max(24, Math.round(sampleWidth * ((video.videoHeight || 9) / (video.videoWidth || 16))));
      const canvas = document.createElement('canvas');
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!ctx || typeof ctx.getImageData !== 'function') return { signature: [], brightness: 0.5, detail: 0 };
      ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
      const rgba = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const signature = new Array(sampleWidth * sampleHeight);
      let brightnessTotal = 0;
      let edgeTotal = 0;
      let edgeCount = 0;

      for (let y = 0; y < sampleHeight; y++) {
        for (let x = 0; x < sampleWidth; x++) {
          const pixelIndex = y * sampleWidth + x;
          const rgbaIndex = pixelIndex * 4;
          const gray = Math.round(rgba[rgbaIndex] * 0.299 + rgba[rgbaIndex + 1] * 0.587 + rgba[rgbaIndex + 2] * 0.114);
          signature[pixelIndex] = gray;
          brightnessTotal += gray;
          if (x > 0) {
            edgeTotal += Math.abs(gray - signature[pixelIndex - 1]);
            edgeCount++;
          }
          if (y > 0) {
            edgeTotal += Math.abs(gray - signature[pixelIndex - sampleWidth]);
            edgeCount++;
          }
        }
      }

      return {
        signature,
        brightness: brightnessTotal / signature.length / 255,
        detail: edgeCount ? edgeTotal / edgeCount / 255 : 0
      };
    } catch {
      return { signature: [], brightness: 0.5, detail: 0 };
    }
  }

  function bufferedContains(video, targetSeconds, tolerance = 0.35) {
    const ranges = video?.buffered;
    if (!ranges || typeof ranges.length !== 'number') return false;
    for (let i = 0; i < ranges.length; i++) {
      try {
        if (targetSeconds >= ranges.start(i) - tolerance && targetSeconds <= ranges.end(i) + tolerance) return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function isFrameReady(video, targetSeconds, tolerance = 0.45) {
    const currentTime = Number(video?.currentTime);
    const readyState = Number(video?.readyState);
    return Number.isFinite(currentTime)
      && Math.abs(currentTime - targetSeconds) <= tolerance
      && !video?.seeking
      && (!Number.isFinite(readyState) || readyState >= 2)
      && Number(video?.videoWidth) > 0
      && Number(video?.videoHeight) > 0;
  }

  /**
   * 跳到目标时间后等待“目标时间已到 + seek 结束 + 当前解码帧可读”。
   * 这里故意不依赖 requestAnimationFrame / requestVideoFrameCallback：它们属于页面呈现节奏，
   * 暂停或后台标签页都可能被节流，而 Canvas 截帧真正需要的是媒体元素已经拥有可读的当前帧。
   * @param {HTMLVideoElement} video
   * @param {number} targetSeconds
   * @param {number} timeoutMs
   * @returns {Promise<{ ok: boolean, target: number, buffered: boolean, background: boolean, reason?: string }>}
   */
  async function seekAndWaitForFrame(video, targetSeconds, timeoutMs) {
    const duration = Number(video.duration);
    const target = Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : targetSeconds, targetSeconds));
    const background = typeof document !== 'undefined' && Boolean(document.hidden);
    const startedBuffered = bufferedContains(video, target);

    return new Promise((resolve) => {
      let settled = false;
      let pollTimer = null;
      const initiallyReady = isFrameReady(video, target);
      let seekObserved = initiallyReady;
      const passiveEventNames = ['loadeddata', 'canplay', 'progress', 'timeupdate'];

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (pollTimer !== null) clearTimeout(pollTimer);
        video.removeEventListener('seeked', onSeeked);
        passiveEventNames.forEach((name) => video.removeEventListener(name, check));
      };
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ok, target, buffered: bufferedContains(video, target) || startedBuffered, background, reason });
      };
      const scheduleCheck = () => {
        if (settled || pollTimer !== null) return;
        pollTimer = setTimeout(() => {
          pollTimer = null;
          check();
        }, 80);
      };
      const check = () => {
        if (settled) return;
        if (seekObserved && isFrameReady(video, target)) {
          finish(true);
          return;
        }
        scheduleCheck();
      };
      const onSeeked = () => {
        seekObserved = true;
        check();
      };
      const timeoutTimer = setTimeout(() => {
        const currentTime = Number(video.currentTime);
        const closeToTarget = Number.isFinite(currentTime) && Math.abs(currentTime - target) <= 1.5;
        const hasBufferedRanges = video?.buffered && typeof video.buffered.length === 'number';
        const reason = closeToTarget
          ? (hasBufferedRanges && !bufferedContains(video, target) ? 'TARGET_NOT_BUFFERED' : 'FRAME_NOT_DECODED')
          : 'SEEK_TARGET_MISMATCH';
        finish(false, reason);
      }, Math.max(50, Number(timeoutMs) || 4000));

      video.addEventListener('seeked', onSeeked);
      passiveEventNames.forEach((name) => video.addEventListener(name, check));
      if (!initiallyReady) {
        try { video.currentTime = target; } catch {
          finish(false, 'SEEK_ASSIGNMENT_FAILED');
          return;
        }
      }
      check();
    });
  }

  /**
   * 跳转到指定时间戳截取高分辨率画面（支持原地即时截取或异步 seek 截取）
   * @param {number} targetSeconds
   * @param {import('../types/bse').CaptureFrameOptions} [options]
   * @returns {Promise<import('../types/bse').CapturedFrame>}
   */
  async function captureVideoFrameAt(targetSeconds, options = {}) {
    if (typeof document === 'undefined') {
      return { success: false, error: 'NO_DOM_ENVIRONMENT', message: '当前非浏览器 DOM 环境' };
    }
    const video = resolveVideoElement(options.videoElement || null);

    if (!video) {
      return { success: false, error: 'NO_VIDEO_ELEMENT', message: '未找到有效视频播放器元素' };
    }

    if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
      return captureVideoFrame(video, options);
    }

    const originalTimeValue = Number(video.currentTime);
    const originalTime = Number.isFinite(originalTimeValue) ? originalTimeValue : 0;
    const wasPaused = Boolean(video.paused);
    const timeoutMs = Number(options.timeoutMs) || 4000;

    try {
      const seekResult = await seekAndWaitForFrame(video, targetSeconds, timeoutMs);
      if (!seekResult.ok) {
        const error = seekResult.reason || 'FRAME_NOT_DECODED';
        const message = error === 'SEEK_TARGET_MISMATCH'
          ? `播放器未能定位到目标时间 ${targetSeconds}s`
          : error === 'TARGET_NOT_BUFFERED'
            ? `目标时间 ${targetSeconds}s 尚未缓冲完成，未截取可能过期的旧画面`
            : `播放器已到达 ${targetSeconds}s 附近，但目标画面尚未完成解码`;
        return { success: false, error, message };
      }

      return captureVideoFrame(video, options);
    } finally {
      const currentTimeValue = Number(video.currentTime);
      if (options.restoreTime && (!Number.isFinite(currentTimeValue) || Math.abs(currentTimeValue - originalTime) > 0.5)) {
        video.currentTime = originalTime;
        if (!wasPaused && typeof video.play === 'function') video.play().catch(() => {});
      }
    }
  }

  async function captureStableVideoFrameOnce(video, request, options, sampleTimeoutMs) {
    const duration = Number(video.duration);
    const videoDuration = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    const requestedTimestamp = Number(request.targetSec ?? request.timestamp ?? request.windowStart);
    const fallbackTimestamp = BSE.VisualDetector?.pickOptimalTimestamp
      ? BSE.VisualDetector.pickOptimalTimestamp({ ...request, videoDuration })
      : (Number.isFinite(requestedTimestamp) ? requestedTimestamp : (Number(video.currentTime) || 0));
    const candidateTimestamps = BSE.VisualDetector?.buildCandidateTimestamps
      ? BSE.VisualDetector.buildCandidateTimestamps(request, videoDuration, 3)
      : [fallbackTimestamp];
    /** @type {Array<import('../types/bse').VisualFrameCandidate>} */
    const candidates = [];
    let lastSeekFailure = '';

    for (const timestamp of candidateTimestamps) {
      const seekResult = await seekAndWaitForFrame(video, timestamp, sampleTimeoutMs);
      if (!seekResult.ok) {
        lastSeekFailure = seekResult.reason || 'NO_STABLE_FRAME';
        // 相邻候选通常共享同一缓冲段。第一个点尚未缓冲时继续逐点等超时只会放大卡顿，
        // 交给外层统一做一次更宽超时的重试即可。
        if (!candidates.length && TRANSIENT_CAPTURE_ERRORS.has(lastSeekFailure)) break;
        continue;
      }
      const currentTimeValue = Number(video.currentTime);
      candidates.push({
        timestamp: Number.isFinite(currentTimeValue) ? currentTimeValue : timestamp,
        ...measureVisualSignature(video)
      });
    }

    if (!candidates.length) {
      const error = lastSeekFailure || 'NO_STABLE_FRAME';
      const message = error === 'TARGET_NOT_BUFFERED'
        ? '候选窗口尚未缓冲完成，未截取可能过期的旧画面'
        : error === 'FRAME_NOT_DECODED'
          ? '候选窗口已定位，但画面仍未完成解码'
          : '候选窗口内未能读取可用画面';
      return { success: false, error, message };
    }

    const hasPixelEvidence = candidates.some((candidate) => candidate.signature.length > 0);
    const selected = hasPixelEvidence && BSE.VisualDetector?.selectBestCandidate
      ? BSE.VisualDetector.selectBestCandidate(candidates)
      : candidates.reduce((best, candidate) => (
          Math.abs(candidate.timestamp - fallbackTimestamp) < Math.abs(best.timestamp - fallbackTimestamp) ? candidate : best
        ), candidates[0]);
    if (!selected) return { success: false, error: 'NO_STABLE_FRAME', message: '未能选择代表画面' };

    const finalSeek = await seekAndWaitForFrame(video, selected.timestamp, Math.max(sampleTimeoutMs, 5000));
    if (!finalSeek.ok) {
      const error = finalSeek.reason === 'SEEK_TARGET_MISMATCH' ? 'FINAL_SEEK_MISMATCH' : 'FINAL_FRAME_NOT_READY';
      return {
        success: false,
        error,
        message: finalSeek.reason === 'TARGET_NOT_BUFFERED'
          ? '代表帧已选出，但该时间点仍未缓冲完成'
          : finalSeek.reason === 'SEEK_TARGET_MISMATCH'
            ? '代表帧已选出，但播放器未能再次定位到该时间点进行高清编码'
            : '代表帧时间已到达，但未确认目标画面完成解码'
      };
    }
    const finalFrame = captureVideoFrame(video, options);
    if (!finalFrame.success || !finalFrame.dataUrl) return finalFrame;
    const finalTimestamp = Number(finalFrame.timestamp);

    return {
      ...finalFrame,
      selection: {
        strategy: hasPixelEvidence ? 'visual' : 'time-fallback',
        sampledTimestamps: candidateTimestamps,
        selectedTimestamp: Number.isFinite(finalTimestamp) ? finalTimestamp : selected.timestamp,
        visualScore: selected.visualScore,
        stabilityScore: selected.stabilityScore,
        fingerprint: BSE.VisualDetector?.compactSignature
          ? BSE.VisualDetector.compactSignature(selected.signature, 128)
          : []
      }
    };
  }

  /**
   * 在 AI 规划窗口内选择代表帧。网络/解码瞬态失败的有限重试属于 Media Module，
   * 调用方不需要理解播放器的 readyState、buffered 或具体错误码。
   * 播放器只在本函数内暂时寻道，结束后统一恢复原时间与播放状态。
   * @param {import('../types/bse').AiVisualRequest} request
   * @param {import('../types/bse').CaptureFrameOptions} [options]
   * @returns {Promise<import('../types/bse').CapturedFrame>}
   */
  async function captureStableVideoFrame(request = {}, options = {}) {
    if (typeof document === 'undefined') {
      return { success: false, error: 'NO_DOM_ENVIRONMENT', message: '当前非浏览器 DOM 环境' };
    }
    const video = resolveVideoElement(options.videoElement || null);
    if (!video) {
      return { success: false, error: 'NO_VIDEO_ELEMENT', message: '未找到有效视频播放器元素' };
    }

    const originalTime = Number(video.currentTime) || 0;
    const wasPaused = Boolean(video.paused);
    const sampleTimeoutMs = Math.max(100, Math.min(6000, Number(options.timeoutMs) || 2500));

    try {
      if (!wasPaused && typeof video.pause === 'function') video.pause();
      let result = await captureStableVideoFrameOnce(video, request, options, sampleTimeoutMs);
      if (!result.success && TRANSIENT_CAPTURE_ERRORS.has(String(result.error || ''))) {
        const retryTimeoutMs = Math.min(8000, Math.max(sampleTimeoutMs * 2, sampleTimeoutMs + 750));
        result = await captureStableVideoFrameOnce(video, request, options, retryTimeoutMs);
        if (result.success) result.warning = 'RETRIED_AFTER_BUFFERING';
      }
      return result;
    } finally {
      if (Math.abs((Number(video.currentTime) || 0) - originalTime) > 0.3) video.currentTime = originalTime;
      if (!wasPaused && typeof video.play === 'function') video.play().catch(() => {});
    }
  }

  BSE.Media = Object.freeze({
    isBilibiliCdnHost,
    normalizeBilibiliUrl,
    normalizeBilibiliAudioStreams,
    selectBilibiliAudio,
    getContactSheetLayout,
    captureVideoFrame,
    captureVideoFrameAt,
    captureStableVideoFrame
  });
})();
