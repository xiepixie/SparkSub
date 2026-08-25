(() => {
  'use strict';

  const BSE = globalThis.BSE;

  /**
   * 规范化与去重字幕条目
   * @param {Array<import('../types/bse').Cue>} cues
   * @returns {Array<import('../types/bse').Cue>}
   */
  function normalize(cues) {
    const cleaned = (cues || [])
      .map((cue) => ({
        from: Math.max(0, Number(cue.from) || 0),
        to: Math.max(Number(cue.to) || 0, (Number(cue.from) || 0) + 0.05),
        content: String(cue.content || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((cue) => cue.content)
      .sort((a, b) => a.from - b.from || a.to - b.to);

    const result = [];
    for (const cue of cleaned) {
      if (!result.length) {
        result.push(cue);
        continue;
      }
      const prev = result[result.length - 1];
      if (cue.content.toLowerCase() === prev.content.toLowerCase()) {
        prev.to = Math.max(prev.to, cue.to);
        continue;
      }
      if (Math.abs(cue.from - prev.from) < 0.3) {
        if (cue.content.startsWith(prev.content)) {
          prev.content = cue.content;
          prev.to = Math.max(prev.to, cue.to);
          continue;
        }
        if (prev.content.startsWith(cue.content)) {
          prev.to = Math.max(prev.to, cue.to);
          continue;
        }
      }
      result.push(cue);
    }
    return result;
  }

  function parseJson3(text) {
    try {
      const data = JSON.parse(text);
      return normalize((data.events || []).filter((event) => event.segs).map((event) => ({
        from: Number(event.tStartMs || 0) / 1000,
        to: (Number(event.tStartMs || 0) + Number(event.dDurationMs || 0)) / 1000,
        content: event.segs.map((segment) => segment.utf8 || '').join('')
      })));
    } catch {
      return [];
    }
  }

  function parseVttTime(value) {
    const parts = String(value).replace(',', '.').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function parseVtt(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const cues = [];
    let current = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = line.match(/((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})/);
      if (match) {
        if (current?.content) cues.push(current);
        current = { from: parseVttTime(match[1]), to: parseVttTime(match[2]), content: '' };
      } else if (current && line && !line.startsWith('WEBVTT') && !/^\d+$/.test(line)) {
        const cleanText = line.replace(/<\/?[^>]+(>|$)/g, '').trim();
        if (cleanText) {
          if (!current.content) {
            current.content = cleanText;
          } else if (!current.content.endsWith(cleanText)) {
            current.content += ` ${cleanText}`;
          }
        }
      }
    }
    if (current?.content) cues.push(current);
    return normalize(cues);
  }

  function parseTimeExpression(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    if (/ms$/i.test(raw)) return Number.parseFloat(raw) / 1000;
    if (/s$/i.test(raw)) return Number.parseFloat(raw);
    return parseVttTime(raw);
  }

  function parseXml(text, selector, mapper) {
    try {
      const documentNode = new DOMParser().parseFromString(text, 'text/xml');
      if (documentNode.querySelector('parsererror')) return [];
      return normalize(Array.from(documentNode.querySelectorAll(selector)).map(mapper));
    } catch {
      return [];
    }
  }

  function parseTtml(text) {
    return parseXml(text, 'p', (node) => {
      const from = parseTimeExpression(node.getAttribute('begin'));
      const end = node.getAttribute('end');
      const duration = node.getAttribute('dur');
      return {
        from,
        to: end ? parseTimeExpression(end) : from + parseTimeExpression(duration || '2s'),
        content: node.textContent
      };
    });
  }

  function parseSrv3(text) {
    return parseXml(text, 'p', (node) => {
      const from = Number(node.getAttribute('t') || 0) / 1000;
      return {
        from,
        to: from + Number(node.getAttribute('d') || 0) / 1000,
        content: Array.from(node.querySelectorAll('s')).length
          ? Array.from(node.querySelectorAll('s')).map((item) => item.textContent || '').join('')
          : node.textContent
      };
    });
  }

  function parseLegacyXml(text) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const parsed = parseXml(text, 'text', (node) => {
          const from = Number.parseFloat(node.getAttribute('start') || '0');
          return {
            from,
            to: from + Number.parseFloat(node.getAttribute('dur') || '2'),
            content: node.textContent
          };
        });
        if (parsed.length) return parsed;
      } catch {}
    }
    const cues = [];
    const regex = /<text\s+[^>]*start="([\d\.]+)"[^>]*dur="([\d\.]+)"[^>]*>([\s\S]*?)<\/text>|<text\s+[^>]*>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const from = Number.parseFloat(match[1] || '0') || 0;
      const dur = Number.parseFloat(match[2] || '2') || 2;
      const rawContent = match[3] || match[4] || '';
      const content = rawContent
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '')
        .trim();
      if (content) {
        cues.push({ from, to: from + dur, content });
      }
    }
    return normalize(cues);
  }

  /**
   * 自动或指定格式解析字幕文本
   * @param {string} text
   * @param {string} [format]
   * @returns {Array<import('../types/bse').Cue>}
   */
  function parse(text, format = '') {
    const body = String(text || '').trim();
    if (!body) return [];
    const normalizedFormat = String(format || '').toLowerCase();
    const parser = {
      json3: parseJson3,
      vtt: parseVtt,
      ttml: parseTtml,
      srv3: parseSrv3
    }[normalizedFormat];
    const preferred = parser?.(body) || [];
    if (preferred.length) return preferred;
    if (body.startsWith('{')) return parseJson3(body);
    if (body.startsWith('WEBVTT')) return parseVtt(body);
    if (/<transcript[\s>]/i.test(body)) return parseLegacyXml(body);
    if (/<timedtext[\s>]/i.test(body)) return parseSrv3(body);
    if (/<tt[\s>]/i.test(body)) return parseTtml(body);
    return [];
  }

  BSE.Parsers = Object.freeze({ normalize, parse, parseJson3, parseVtt, parseTtml, parseSrv3, parseLegacyXml });
})();
