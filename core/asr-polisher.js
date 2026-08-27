(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE = globalThis.BSE || /** @type {any} */ ({});

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
  const TIMEOUT_MS = 120000; // 单次对话上限 2 分钟

  /**
   * 通用网络请求助手：在 content script 下自动使用 background 代理，在 worker/Node 下直接 fetch
   */
  async function fetchLlm(url, body = null, timeoutMs = TIMEOUT_MS) {
    if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && !navigator.userAgent?.includes('Node.js')) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'BSE_FETCH_LOCAL_LLM',
          url,
          body,
          timeoutMs
        });
        if (response && response.success && response.text != null) {
          return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            json: async () => JSON.parse(response.text),
            text: async () => response.text
          };
        }
      } catch {}
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      clearTimeout(timer);
      return resp;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /**
   * 探测本地大模型服务状态与可用模型
   * @param {string} [endpoint]
   * @returns {Promise<{ available: boolean, model?: string, models?: string[], endpoint: string, error?: string }>}
   */
  async function probeLocalLlm(endpoint = DEFAULT_ENDPOINT) {
    const url = `${(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')}/api/tags`;
    try {
      const resp = await fetchLlm(url, null, 3000);
      if (!resp.ok) {
        return { available: false, endpoint, error: `HTTP ${resp.status}` };
      }
      const data = await resp.json();
      const models = Array.isArray(data?.models) ? data.models.map((m) => m.name || m.model).filter(Boolean) : [];
      if (!models.length) {
        return { available: false, endpoint, error: '无可用模型' };
      }
      const gemmaModel = models.find((m) => /gemma/i.test(m));
      const qwenModel = models.find((m) => /qwen/i.test(m));
      const selectedModel = gemmaModel || qwenModel || models[0];
      return { available: true, model: selectedModel, models, endpoint };
    } catch (e) {
      return { available: false, endpoint, error: e.message || '连接失败' };
    }
  }

  /**
   * 构建针对 ASR 吞音、略读与领域专有名词纠错的单次完整对话提示词
   * @param {string} title 视频真实标题
   * @param {Array<import('../types/bse').Cue>} cues 完整的原始字幕轨道
   * @returns {string}
   */
  function buildPolishingPrompt(title, cues) {
    const safeTitle = (title || '').trim() || '视频原片/讲座';
    const lines = cues.map((c, i) => `[${i + 1}] ${c.content}`).join('\n');

    return `You are a professional video subtitle and ASR correction specialist.
Video Title: "${safeTitle}"

Priority Hierarchy:
Acoustic Fidelity (原声保真) > ASR Phonetic Correction (ASR纠错) > Readability (可读性) > Formal Grammar (语法规范)

Core Standard:
The subtitle must make the viewer feel: "The words on screen are exactly what I just heard the speaker say," NOT "Someone re-wrote what the speaker said."

Editing Rules:
1. Fix clear phonetic, near-homophone, slurring, elision, and unreleased consonant errors (e.g. "starp" -> "startup", "tra ined" -> "trained", "to of results" -> "turn to the results", "Quen" -> "Qwen", "yTch" -> "PyTorch", "gd 5" -> "GPT-5", "codecs" -> "Codex").
2. Accurately identify and standardize domain terminology, product/model names, proper nouns, and case conventions based on the video title context (e.g. Qwen, PyTorch, Codex, LoRA, Claude, GPT-5, BERT, Jacob Devlin).
3. Fix broken word spacings, obvious casing errors, and essential punctuation without altering spoken sentence boundaries.
4. Restore dropped functional words (such as missing pronouns, prepositions, or -ed/-s inflections) ONLY when acoustic evidence clearly indicates ASR omitted or clipped them.
5. PRESERVE the speaker's authentic spoken tone, natural conversational flow, colloquial phrasing, hesitations, and verbal habits. Do NOT paraphrase, summarize, or formalize spoken dialogue into written prose.
6. CRITICAL: Output every line starting with its exact original [N] index prefix (from [1] to [${cues.length}]) so timestamps align 1:1. Output ONLY the numbered lines without any preamble, thinking, explanations, or code fences.

Original Numbered Subtitle Lines:
${lines}`;
  }

  /**
   * 将大模型润色后的编号文本与原始时间轴进行精确 1:1 回填对齐
   * @param {Array<import('../types/bse').Cue>} cues 原始带时间戳的字幕轨道
   * @param {string} polishedText 大模型输出的精修文本
   * @returns {Array<import('../types/bse').Cue>}
   */
  function alignPolishedCues(cues, polishedText) {
    if (!Array.isArray(cues) || !cues.length) return cues || [];
    if (!polishedText || typeof polishedText !== 'string' || !polishedText.trim()) return cues;

    // 清洗大模型可能附带的思考过程标签、Markdown 代码块或前缀
    const clean = polishedText.trim()
      .replace(/<\|channel\|?>thought[\s\S]*?<channel\|?>/gi, '')
      .replace(/<\|start_header_id\|>thought[\s\S]*?<\|end_header_id\|>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:markdown|text)?\n/i, '')
      .replace(/\n```$/i, '')
      .trim();

    const rawLines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) return cues;

    const result = cues.map((c) => ({ ...c }));
    let indexedMatches = 0;

    for (const line of rawLines) {
      const match = line.match(/^\[(\d+)\]\s*(.*)$/);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        if (idx >= 0 && idx < result.length && match[2].trim()) {
          result[idx].content = match[2].trim();
          indexedMatches++;
        }
      }
    }

    if (indexedMatches > 0) {
      return result;
    }

    // 若大模型省略了 [N] 编号但按换行分割返回
    if (rawLines.length === cues.length) {
      return cues.map((cue, idx) => ({
        ...cue,
        content: rawLines[idx] || cue.content
      }));
    }

    return cues;
  }

  /**
   * 单次对话全量完成 cues 大模型语义精修与吞音纠错
   * @param {Array<import('../types/bse').Cue>} cues
   * @param {Object} [options]
   * @param {string} [options.title] 视频标题
   * @param {string} [options.endpoint] 本地 LLM 地址
   * @param {string} [options.model] 模型名
   * @param {Function} [options.onDiagnostic] 诊断日志回调
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ cues: Array<import('../types/bse').Cue>, modelUsed?: string, elapsedMs?: number }>}
   */
  async function polishCues(cues, {
    title = '',
    endpoint = DEFAULT_ENDPOINT,
    model = '',
    onDiagnostic = () => {},
    signal = null
  } = {}) {
    if (!Array.isArray(cues) || !cues.length) return { cues };

    const startTime = performance.now();
    onDiagnostic('端侧大模型', `正在探测本地端侧大模型服务 (${endpoint})…`);

    const probe = await probeLocalLlm(endpoint);
    if (!probe.available) {
      onDiagnostic('端侧大模型', `本地大模型未就绪 (${probe.error || '不可达'}) · 自动保留原始声学转录字幕`);
      return { cues };
    }

    const selectedModel = model || probe.model;
    const totalCount = cues.length;
    onDiagnostic('端侧大模型', `已连接端侧模型：${selectedModel} · 正在一次性进行全量 ASR 语义纠错与吞音润色 (共 ${totalCount} 句字幕)…`);

    const prompt = buildPolishingPrompt(title, cues);

    try {
      const generateUrl = `${(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')}/api/generate`;
      const body = {
        model: selectedModel,
        system: 'You are a professional video subtitle and ASR correction specialist. Priority: Acoustic Fidelity (原声保真) > ASR Phonetic Correction > Readability > Formal Grammar. Output ONLY the numbered lines with [N] prefixes. Preserve spoken tone and natural verbal cadence. Do NOT include thinking, preamble, explanations, notes, or code blocks.',
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.95,
          num_predict: 4096,
          num_ctx: 16384
        }
      };

      const resp = await fetchLlm(generateUrl, body, TIMEOUT_MS);
      if (!resp.ok) {
        throw new Error(`LLM HTTP ${resp.status}`);
      }

      const json = await resp.json();
      const polishedResponse = json.response || '';
      if (!polishedResponse.trim()) {
        throw new Error('LLM 返回内容为空');
      }

      const alignedCues = alignPolishedCues(cues, polishedResponse);
      const elapsedMs = Math.round(performance.now() - startTime);

      onDiagnostic('端侧大模型', `精修完成 · 成功优化全部 ${totalCount} 句字幕中的吞音、漏词与专业术语 (耗时 ${(elapsedMs / 1000).toFixed(1)}s · 模型: ${selectedModel})`);

      return {
        cues: alignedCues,
        modelUsed: selectedModel,
        elapsedMs
      };
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - startTime);
      onDiagnostic('端侧大模型', `大模型精修跳过或失败 (${err.message}) · 自动回退至原始声学字幕`);
      return { cues };
    }
  }

  BSE.AsrPolisher = Object.freeze({
    probeLocalLlm,
    buildPolishingPrompt,
    alignPolishedCues,
    polishCues,
    DEFAULT_ENDPOINT
  });
})();
