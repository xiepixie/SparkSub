/**
 * SparkSub Dedicated Worker for transcript formatting, cue segmentation, and markdown rendering
 */
'use strict';

self.onmessage = (event) => {
  const { type, id, payload } = event.data || {};

  if (type === 'POSTPROCESS_TRANSCRIPT') {
    try {
      const { cues, title, author, url } = payload;
      const normalizedCues = (cues || []).map((c) => ({
        from: Number(c.from || 0),
        to: Number(c.to || 0),
        content: String(c.content || '').trim()
      })).filter((c) => c.content);

      const plainText = normalizedCues.map((c) => c.content).join(' ');

      // Build structured Markdown
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

      // Segment into natural paragraphs (~30-60s or punctuation)
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

      // Build SRT
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

      self.postMessage({
        type: 'POSTPROCESS_SUCCESS',
        id,
        result: {
          cueCount: normalizedCues.length,
          plainText,
          markdown: mdLines.join('\n'),
          srt: srtLines.join('\n'),
          cues: normalizedCues
        }
      });
    } catch (err) {
      self.postMessage({
        type: 'POSTPROCESS_ERROR',
        id,
        error: err.message
      });
    }
  }
};
