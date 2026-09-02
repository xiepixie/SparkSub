(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});
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

  function isBilibiliCdnHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return BILIBILI_CDN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  function normalizeBilibiliUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'https:' || !isBilibiliCdnHost(parsed.hostname)) return '';
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
    const video = videoElement
      || document.querySelector('.bpx-player-video-wrap video')
      || document.querySelector('#movie_player video')
      || document.querySelector('video');

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
   * 跳转到指定时间戳截取高分辨率画面（支持原地即时截取或异步 seek 截取）
   * @param {number} targetSeconds
   * @param {object} [options]
   * @returns {Promise<{ success: boolean, dataUrl?: string, width?: number, height?: number, originalWidth?: number, originalHeight?: number, timestamp?: number, duration?: number, format?: string, warning?: string, error?: string, message?: string }>}
   */
  async function captureVideoFrameAt(targetSeconds, options = {}) {
    if (typeof document === 'undefined') {
      return { success: false, error: 'NO_DOM_ENVIRONMENT', message: '当前非浏览器 DOM 环境' };
    }
    const video = options.videoElement
      || document.querySelector('.bpx-player-video-wrap video')
      || document.querySelector('#movie_player video')
      || document.querySelector('video');

    if (!video) {
      return { success: false, error: 'NO_VIDEO_ELEMENT', message: '未找到有效视频播放器元素' };
    }

    if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
      return captureVideoFrame(video, options);
    }

    // 若当前播放时间与目标时间在 0.3 秒内，无需触发 seek，直接捕获当前已解码帧
    if (Math.abs(video.currentTime - targetSeconds) <= 0.3) {
      return captureVideoFrame(video, options);
    }

    const originalTime = video.currentTime;
    const wasPaused = video.paused;
    const timeoutMs = options.timeoutMs || 4000;

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // 超时回退直接截取当前帧
        const fallback = captureVideoFrame(video, options);
        resolve({
          ...fallback,
          warning: 'SEEK_TIMEOUT_FALLBACK'
        });
      }, timeoutMs);

      function cleanup() {
        video.removeEventListener('seeked', onSeeked);
      }

      function onSeeked() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();

        // 等待下一绘制帧以确保解码画面完成 GPU 渲染
        const schedule = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (cb) => setTimeout(cb, 30);

        schedule(() => {
          setTimeout(() => {
            const result = captureVideoFrame(video, options);
            if (options.restoreTime && Math.abs(video.currentTime - originalTime) > 0.5) {
              video.currentTime = originalTime;
              if (!wasPaused) video.play().catch(() => {});
            }
            resolve(result);
          }, 40);
        });
      }

      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = Math.max(0, Math.min(video.duration || targetSeconds, targetSeconds));
    });
  }

  BSE.Media = Object.freeze({
    isBilibiliCdnHost,
    normalizeBilibiliUrl,
    normalizeBilibiliAudioStreams,
    selectBilibiliAudio,
    captureVideoFrame,
    captureVideoFrameAt
  });
})();
