/**
 * SparkSub (闪幕) - Visual State Detector
 * 视觉状态检测器：在时间候选窗口中定位信息完整度最高、状态最稳定的代表帧
 * 避免截取到动画过渡中、PPT正在翻页或人物遮挡的不完整画面
 */
(() => {
  'use strict';

  const BSE = globalThis.BSE;

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  /**
   * 仅根据规划窗口给出一个兜底时间点。它不读取像素，因此不能单独声称“检测到了稳定画面”；
   * 真正的稳定帧选择由 buildCandidateTimestamps + selectBestCandidate 结合 Media 像素采样完成。
   *
   * 在时间候选窗口 [windowStart, windowEnd] 内给出启发式代表时间戳。
   * @param {object} params
   * @param {number} params.windowStart 窗口起始秒
   * @param {number} params.windowEnd 窗口结束秒
   * @param {number} [params.targetSec] 期望参考秒
   * @param {number} [params.videoDuration] 视频总时长
   * @returns {number} 选定的稳定代表帧秒数
   */
  function pickOptimalTimestamp({
    windowStart = 0,
    windowEnd = 0,
    targetSec = null,
    videoDuration = Infinity
  }) {
    const start = Math.max(0, Number(windowStart) || 0);
    const end = Math.min(Number.isFinite(videoDuration) ? videoDuration : Infinity, Math.max(start, Number(windowEnd) || start));

    if (start === end) return start;

    const span = end - start;
    let candidate = 0;

    if (Number.isFinite(targetSec) && targetSec >= start && targetSec <= end) {
      // 若提供了 targetSec，取 targetSec 稍后 2~3 秒作为稳定完成帧（若仍在窗口内）
      candidate = Math.min(end - 1, targetSec + 2);
    } else if (span >= 10) {
      // 窗口较长时，取窗口末端往前 20% 处（通常更接近本段展示完成、视觉信息较完整的稳定期）
      candidate = end - Math.max(2, Math.min(6, span * 0.2));
    } else {
      // 短窗口取靠后位置
      candidate = Math.max(start, end - 1.5);
    }

    return Math.max(0, Math.round(candidate * 10) / 10);
  }

  /**
   * 为一次视觉请求构造少量候选帧。若 AI 给出了 targetSec，就只在目标附近取样，
   * 避免为了“找图”在一个很大的章节窗口内反复寻道；没有 targetSec 时才偏向窗口后段。
   * @param {import('../types/bse').AiVisualRequest} request
   * @param {number} [videoDuration]
   * @param {number} [maxSamples=3]
   * @returns {number[]}
   */
  function buildCandidateTimestamps(request = {}, videoDuration = Infinity, maxSamples = 3) {
    const start = Math.max(0, Number(request.windowStart) || 0);
    const rawEnd = Number(request.windowEnd);
    const durationLimit = Number.isFinite(videoDuration) ? Math.max(0, videoDuration) : Infinity;
    const end = Math.min(durationLimit, Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start + 20);
    const target = Number(request.targetSec ?? request.timestamp);
    const span = Math.max(0, end - start);
    const samples = [];

    if (Number.isFinite(target)) {
      const center = Math.max(start, Math.min(end, target));
      const delta = Math.max(0.6, Math.min(2.5, span * 0.08 || 1.2));
      samples.push(center - delta, center, center + delta);
    } else if (span > 0) {
      samples.push(start + span * 0.62, start + span * 0.8, Math.max(start, end - Math.min(1, span * 0.05)));
    } else {
      samples.push(start);
    }

    const unique = [];
    for (const value of samples) {
      const clamped = Math.max(start, Math.min(end, Number(value) || start));
      const rounded = Math.round(clamped * 10) / 10;
      if (!unique.some((existing) => Math.abs(existing - rounded) < 0.4)) unique.push(rounded);
      if (unique.length >= Math.max(1, Math.min(5, maxSamples))) break;
    }
    return unique.length ? unique : [pickOptimalTimestamp({ windowStart: start, windowEnd: end, targetSec: target, videoDuration })];
  }

  function signatureDifference(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null;
    let total = 0;
    for (let i = 0; i < left.length; i++) total += Math.abs(left[i] - right[i]);
    return total / left.length / 255;
  }

  function compactSignature(signature, bins = 128) {
    if (!Array.isArray(signature) || !signature.length) return [];
    const count = Math.max(8, Math.min(128, Number(bins) || 128));

    // measureVisualSignature 固定以 64px 宽采样。这里按二维网格压缩，保留“内容出现在哪里”的信息；
    // 不能把整张图展平后按连续区间求均值，否则白底 PPT / 代码页只要整体灰度接近就很容易误判为重复。
    if (signature.length >= 64 && signature.length % 64 === 0) {
      const sourceWidth = 64;
      const sourceHeight = signature.length / sourceWidth;
      const columns = Math.min(sourceWidth, count >= 96 ? 16 : 8);
      const rows = Math.max(1, Math.ceil(count / columns));
      const compact = [];

      for (let index = 0; index < count; index++) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        if (row >= rows) break;
        const xStart = Math.floor(column * sourceWidth / columns);
        const xEnd = Math.max(xStart + 1, Math.floor((column + 1) * sourceWidth / columns));
        const yStart = Math.floor(row * sourceHeight / rows);
        const yEnd = Math.max(yStart + 1, Math.floor((row + 1) * sourceHeight / rows));
        let total = 0;
        let samples = 0;
        for (let y = yStart; y < yEnd && y < sourceHeight; y++) {
          for (let x = xStart; x < xEnd && x < sourceWidth; x++) {
            total += Number(signature[y * sourceWidth + x]) || 0;
            samples++;
          }
        }
        compact.push(Math.round(total / Math.max(1, samples)));
      }
      return compact;
    }

    // 非标准测试/兼容输入没有二维尺寸信息时保留线性降级。
    const compact = [];
    for (let i = 0; i < count; i++) {
      const start = Math.floor((i * signature.length) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * signature.length) / count));
      let total = 0;
      for (let j = start; j < end && j < signature.length; j++) total += Number(signature[j]) || 0;
      compact.push(Math.round(total / Math.max(1, Math.min(end, signature.length) - start)));
    }
    return compact;
  }

  function evidenceBudgetForDuration(videoDuration = 0) {
    const minutes = Math.max(0, Number(videoDuration) || 0) / 60;
    return Math.max(6, Math.min(24, 6 + Math.ceil(minutes / 4)));
  }

  function frameQualityScore(frame) {
    const visualScore = clamp01(frame?.selection?.visualScore ?? 0.55);
    const stabilityScore = clamp01(frame?.selection?.stabilityScore ?? 0.55);
    const importance = String(frame?.importance || '').toLowerCase();
    const importanceBonus = importance === 'high' ? 0.18 : importance === 'medium' ? 0.08 : 0;
    const visualBonus = frame?.selection?.strategy === 'visual' ? 0.06 : 0;
    return visualScore * 0.62 + stabilityScore * 0.28 + importanceBonus + visualBonus;
  }

  /**
   * 对已经捕获的证据图做全局精简：用户手动画面始终保留，自动画面按近重复、质量和时间覆盖筛选。
   * 低分辨率 fingerprint 只参与本次内存计算，不要求持久化。
   * @param {Array<import('../types/bse').AiNoteFrame>} frames
   * @param {{ videoDuration?: number, maxFrames?: number }} [options]
   * @returns {Array<import('../types/bse').AiNoteFrame>}
   */
  function selectEvidenceFrames(frames = [], options = {}) {
    if (!Array.isArray(frames) || !frames.length) return [];
    const maxFrames = Math.max(1, Number(options.maxFrames) || evidenceBudgetForDuration(options.videoDuration));
    const ordered = frames
      .filter((frame) => frame && typeof frame.dataUrl === 'string' && frame.dataUrl.startsWith('data:image/'))
      .map((frame, index) => ({ ...frame, __index: index, timestamp: Number(frame.timestamp) || 0 }))
      .sort((a, b) => a.timestamp - b.timestamp || a.__index - b.__index);

    const deduped = [];
    for (const frame of ordered) {
      let duplicateIndex = -1;
      for (let i = deduped.length - 1; i >= 0; i--) {
        const existing = deduped[i];
        const timeGap = frame.timestamp - existing.timestamp;
        if (timeGap > 45) break;
        const fingerprintDiff = signatureDifference(frame.selection?.fingerprint, existing.selection?.fingerprint);
        const nearDuplicate = timeGap <= 1.2 || (Number.isFinite(fingerprintDiff) && fingerprintDiff < 0.045);
        if (nearDuplicate) {
          duplicateIndex = i;
          break;
        }
      }

      if (duplicateIndex < 0) {
        deduped.push(frame);
        continue;
      }

      const existing = deduped[duplicateIndex];
      if (existing.source === 'manual' && frame.source !== 'manual') continue;
      if (frame.source === 'manual' && existing.source === 'manual') {
        deduped.push(frame);
        continue;
      }
      if (frame.source === 'manual' || frameQualityScore(frame) > frameQualityScore(existing)) {
        deduped.splice(duplicateIndex, 1);
        deduped.push(frame);
      }
    }

    const manual = deduped.filter((frame) => frame.source === 'manual');
    const automatic = deduped.filter((frame) => frame.source !== 'manual');
    const automaticBudget = Math.max(0, maxFrames - manual.length);
    const selected = [...manual];
    const remaining = [...automatic];

    while (remaining.length && selected.length < manual.length + automaticBudget) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const nearestGap = selected.length
          ? Math.min(...selected.map((frame) => Math.abs(frame.timestamp - candidate.timestamp)))
          : Number(options.videoDuration) || 120;
        const coverageBonus = Math.min(0.18, nearestGap / 180 * 0.18);
        const chapterId = String(candidate.chapterId || '').trim();
        const chapterCoverageBonus = chapterId && !selected.some((frame) => String(frame.chapterId || '').trim() === chapterId)
          ? 0.12
          : 0;
        const score = frameQualityScore(candidate) + coverageBonus + chapterCoverageBonus;
        if (score > bestScore) {
          bestIndex = i;
          bestScore = score;
        }
      }
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }

    return selected
      .sort((a, b) => a.timestamp - b.timestamp || a.__index - b.__index)
      .map(({ __index, ...frame }) => frame);
  }

  /**
   * 为剪贴板联系表做严格限额。报告证据层可以始终保留所有用户手动画面，
   * 但“单张拼图”必须控制总尺寸，因此超过预算时按时间轴均匀抽取，保留首尾覆盖。
   * @param {Array<import('../types/bse').AiNoteFrame>} frames
   * @param {{ videoDuration?: number, maxFrames?: number }} [options]
   * @returns {Array<import('../types/bse').AiNoteFrame>}
   */
  function selectPresentationFrames(frames = [], options = {}) {
    const maxFrames = Math.max(1, Math.min(4, Math.round(Number(options.maxFrames) || 4)));
    const ordered = selectEvidenceFrames(frames, {
      videoDuration: options.videoDuration,
      maxFrames
    });
    if (ordered.length <= maxFrames) return ordered;
    if (maxFrames === 1) return [ordered[0]];

    const picked = [];
    const used = new Set();
    for (let i = 0; i < maxFrames; i++) {
      const index = Math.round(i * (ordered.length - 1) / (maxFrames - 1));
      if (used.has(index)) continue;
      used.add(index);
      picked.push(ordered[index]);
    }
    return picked;
  }

  /**
   * 用低分辨率像素签名选择候选帧：稳定性优先，其次是边缘细节与曝光，最后轻微偏向较晚的完整状态。
   * @param {Array<import('../types/bse').VisualFrameCandidate>} candidates
   * @returns {import('../types/bse').VisualFrameCandidate | null}
   */
  function selectBestCandidate(candidates = []) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    let best = null;
    let bestScore = -Infinity;

    candidates.forEach((candidate, index) => {
      const prevDiff = index > 0 ? signatureDifference(candidate.signature, candidates[index - 1].signature) : null;
      const nextDiff = index + 1 < candidates.length ? signatureDifference(candidate.signature, candidates[index + 1].signature) : null;
      const comparableDiffs = [prevDiff, nextDiff].filter((value) => Number.isFinite(value));
      const nearestDiff = comparableDiffs.length ? Math.min(...comparableDiffs) : 0.18;
      const stability = 1 - clamp01(nearestDiff / 0.24);
      const detail = clamp01((candidate.detail || 0) * 7);
      const brightness = clamp01(candidate.brightness ?? 0.5);
      const exposure = 1 - clamp01(Math.abs(brightness - 0.52) / 0.52);
      const recency = candidates.length > 1 ? index / (candidates.length - 1) : 0.5;
      const score = stability * 0.58 + detail * 0.27 + exposure * 0.1 + recency * 0.05;

      candidate.visualScore = score;
      candidate.stabilityScore = stability;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  /**
   * 针对视觉请求列表，批量规范时间窗口，并给出纯时间启发式的 fallback 秒数。
   * 真正截帧时应优先调用 Media.captureStableVideoFrame 做像素级候选比较。
   * @param {Array<import('../types/bse').AiVisualRequest>} visualRequests
   * @param {number} [videoDuration]
   * @returns {Array<import('../types/bse').AiVisualRequest>}
   */
  function resolveRequestTimestamps(visualRequests = [], videoDuration = Infinity) {
    if (!Array.isArray(visualRequests)) return [];

    return visualRequests.map((req, idx) => {
      const hasTimestamp = Number.isFinite(req.timestamp);
      const wStart = Number.isFinite(req.windowStart) ? req.windowStart : (hasTimestamp ? req.timestamp - 5 : idx * 60);
      const wEnd = Number.isFinite(req.windowEnd) ? req.windowEnd : (hasTimestamp ? req.timestamp + 15 : wStart + 20);
      const optimalSec = pickOptimalTimestamp({
        windowStart: wStart,
        windowEnd: wEnd,
        targetSec: Number.isFinite(req.targetSec) ? req.targetSec : req.timestamp,
        videoDuration
      });

      const timeStr = BSE.Utils?.formatClock
        ? BSE.Utils.formatClock(optimalSec)
        : `${Math.round(optimalSec)}s`;

      return {
        ...req,
        id: req.id || `VR_${idx + 1}`,
        windowStart: wStart,
        windowEnd: wEnd,
        optimalSec,
        timestamp: optimalSec,
        timeStr,
        label: req.label || req.evidenceGoal || `视觉检查点 ${idx + 1}`
      };
    });
  }

  const VisualDetector = {
    pickOptimalTimestamp,
    buildCandidateTimestamps,
    selectBestCandidate,
    compactSignature,
    evidenceBudgetForDuration,
    selectEvidenceFrames,
    selectPresentationFrames,
    resolveRequestTimestamps
  };

  BSE.VisualDetector = Object.freeze(VisualDetector);
})();
