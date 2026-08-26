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

  BSE.Media = Object.freeze({
    isBilibiliCdnHost,
    normalizeBilibiliUrl,
    normalizeBilibiliAudioStreams,
    selectBilibiliAudio
  });
})();
