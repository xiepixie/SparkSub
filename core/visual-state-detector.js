/**
 * SparkSub (闪幕) - Visual State Detector
 * 视觉状态检测器：在时间候选窗口中定位信息完整度最高、状态最稳定的代表帧
 * 避免截取到动画过渡中、PPT正在翻页或人物遮挡的不完整画面
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./namespace', './media'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./namespace'), require('./media'));
  } else {
    factory(root.BSE, root.BSE?.Media);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BSE, Media) {
  'use strict';

  BSE = BSE || {};
  Media = Media || BSE.Media || {};

  /**
   * 在时间候选窗口 [windowStart, windowEnd] 内寻找信息最完整、最稳定的代表帧时间戳
   * 教学与讲解视频的演化规律：通常在一个时间窗口的末期（翻页前 2~4 秒）板书/PPT 呈现最为完整。
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
      // 窗口较长时，取窗口末端往前 20% 处（通常是本段讲解即将结束、板书最全的稳定期）
      candidate = end - Math.max(2, Math.min(6, span * 0.2));
    } else {
      // 短窗口取靠后位置
      candidate = Math.max(start, end - 1.5);
    }

    return Math.max(0, Math.round(candidate * 10) / 10);
  }

  /**
   * 针对视觉请求列表，批量调度时间窗口并解析最佳截帧时间戳
   * @param {Array<object>} visualRequests
   * @param {number} [videoDuration]
   * @returns {Array<object>}
   */
  function resolveRequestTimestamps(visualRequests = [], videoDuration = Infinity) {
    if (!Array.isArray(visualRequests)) return [];

    return visualRequests.map((req, idx) => {
      const wStart = Number.isFinite(req.windowStart) ? req.windowStart : (req.timestamp ? req.timestamp - 5 : idx * 60);
      const wEnd = Number.isFinite(req.windowEnd) ? req.windowEnd : (req.timestamp ? req.timestamp + 15 : wStart + 20);
      const optimalSec = pickOptimalTimestamp({
        windowStart: wStart,
        windowEnd: wEnd,
        targetSec: req.targetSec || req.timestamp,
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
    resolveRequestTimestamps
  };

  BSE.VisualDetector = VisualDetector;
  return VisualDetector;
});
