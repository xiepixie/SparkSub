(() => {
  'use strict';

  const root = /** @type {any} */ (globalThis);
  const BSE = /** @type {any} */ (root.BSE = root.BSE || {});

  function create(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => new Date();
    const store = options.store || BSE.Diagnostics.createStore({
      limit: options.limit || 500,
      perSessionLimit: options.perSessionLimit || 100,
      now
    });
    const activeSessions = new Map();
    const queueSignatures = new Map();
    const dismissedByScope = new Map();
    const maxStatusItems = Number.isFinite(Number(options.maxStatusItems))
      ? Math.max(1, Number(options.maxStatusItems))
      : 5;
    let selectedScope = 'media';
    let detailed = false;
    let activeTabId = null;

    function selectedFilter() {
      const sessionId = selectedScope === 'queue' ? undefined : activeSessions.get(selectedScope);
      return {
        scope: selectedScope,
        ...(sessionId ? { sessionId } : {}),
        minLevel: detailed ? 'debug' : 'info'
      };
    }

    function isDismissed(scope, id) {
      return Boolean(id && dismissedByScope.get(scope)?.has(id));
    }

    function isUserFacing(event) {
      if (event.scope === 'native') return false;
      if (event.level === 'debug' || /_HINT$/.test(event.code)) return false;
      if (/启动加载|环境信息|挂载调度/.test(event.stage)) return false;
      if (/^init$/i.test(event.message.trim())) return false;
      return true;
    }

    function statusEvents() {
      const latestByStep = new Map();
      for (const event of store.events({ minLevel: 'info' })) {
        if (!isUserFacing(event) || isDismissed(event.scope, event.id)) continue;
        latestByStep.set(`${event.scope}\u001f${event.sessionId}\u001f${event.code}`, event);
      }
      return Array.from(latestByStep.values()).slice(-maxStatusItems);
    }

    function activityEvents(state = {}) {
      const events = statusEvents();
      if (state.status === 'ready') {
        return events.filter((event) => event.level === 'warn' || event.level === 'error').slice(-3);
      }
      if (state.status === 'error') {
        const currentCause = String(state.lastError?.message || '');
        return events.filter((event) => (
          (event.level === 'warn' || event.level === 'error')
          && (!currentCause || event.message !== currentCause)
        )).slice(-3);
      }
      return events.slice(-3);
    }

    function localTime(timestamp) {
      const instant = new Date(timestamp);
      return [instant.getHours(), instant.getMinutes(), instant.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
    }

    function statusItem(event) {
      const message = BSE.Diagnostics.sanitizeText(event?.message || '', { maxLength: 360 });
      let title = BSE.Diagnostics.sanitizeText(event?.stage || '运行状态', { maxLength: 80 });
      let detail = message;
      if (event?.level === 'error') {
        return { id: event.id, tone: 'error', title, detail, time: localTime(event.timestamp) };
      }
      const loadedMatch = message.match(/成功加载\s*(\d+)\s*条字幕/);
      const tracksMatch = message.match(/返回\s*(\d+)\s*条字幕轨道/);
      if (/字幕呈现/.test(event?.stage) && loadedMatch) {
        title = '字幕已就绪';
        detail = `已加载 ${loadedMatch[1]} 条字幕`;
      } else if (/查找字幕/.test(event?.stage) && tracksMatch) {
        title = '已找到字幕';
        detail = `发现 ${tracksMatch[1]} 条可用字幕轨道`;
      } else if (/视频定位/.test(event?.stage)) {
        title = '已识别当前视频';
      }
      const tone = event?.level === 'warn'
        ? 'warning'
        : (/成功|完成|就绪|已定位|找到/.test(`${title} ${detail}`) ? 'success' : (/正在|处理中|加载中/.test(`${title} ${detail}`) ? 'running' : 'info'));
      return { id: event.id, tone, title, detail, time: localTime(event.timestamp) };
    }

    function summarizeState(state = {}) {
      const status = String(state.status || 'idle');
      if (status === 'error') {
        return {
          tone: 'error',
          label: '发生错误',
          title: '字幕加载失败',
          detail: BSE.Diagnostics.sanitizeText(state.lastError?.message || state.message || '发生未知错误', { maxLength: 240 })
        };
      }
      if (status === 'ready') {
        const tracks = Array.isArray(state.tracks) ? state.tracks : [];
        const selected = tracks.find((track) => String(track.id) === String(state.selectedTrackId));
        const language = selected?.lanDoc || selected?.lan || '';
        const count = Array.isArray(state.cues) ? state.cues.length : 0;
        return {
          tone: 'success',
          label: '运行正常',
          title: '字幕已就绪',
          detail: `${count} 条${language ? ` · ${BSE.Diagnostics.sanitizeText(language, { maxLength: 60 })}` : ''}`
        };
      }
      if (status === 'loading') {
        return {
          tone: 'running',
          label: '处理中',
          title: '正在获取字幕',
          detail: BSE.Diagnostics.sanitizeText(state.message || '正在识别视频并查找可用字幕…', { maxLength: 240 })
        };
      }
      if (status === 'empty') {
        return {
          tone: 'warning',
          label: '未找到字幕',
          title: '暂无可用字幕',
          detail: BSE.Diagnostics.sanitizeText(state.message || '当前视频没有返回可用字幕。', { maxLength: 240 })
        };
      }
      return { tone: 'info', label: '等待中', title: '等待视频', detail: '打开视频后将自动检查字幕状态。' };
    }

    return Object.freeze({
      activateMedia({ tabId, sessionId, mediaKey }) {
        const safeSession = String(sessionId || `media:${mediaKey || 'unknown'}:${tabId || 'tab'}`);
        const changed = activeTabId !== tabId || activeSessions.get('media') !== safeSession;
        activeTabId = tabId ?? null;
        activeSessions.set('media', safeSession);
        if (changed) {
          store.replaceSession('media', safeSession);
          dismissedByScope.delete('media');
        }
      },
      ingestMedia(events) {
        const sessionId = activeSessions.get('media');
        if (!sessionId) return;
        for (const input of Array.isArray(events) ? events : []) {
          if (typeof input === 'string') {
            const legacyId = `legacy:${sessionId}:${input}`;
            if (!isDismissed('media', legacyId)) store.append({ id: legacyId, scope: 'media', sessionId, level: 'info', code: 'LEGACY_LINE', stage: '历史诊断', message: input });
          } else if ((!input?.sessionId || input.sessionId === sessionId) && !isDismissed('media', input.id)) {
            store.append({ ...input, scope: 'media', sessionId });
          }
        }
      },
      append(input) {
        const scope = BSE.Diagnostics.SCOPES.includes(input?.scope) ? input.scope : selectedScope;
        if (isDismissed(scope, input?.id)) return null;
        const sessionId = input?.sessionId || activeSessions.get(scope) || `${scope}:default`;
        if (scope !== 'queue' && activeSessions.get(scope) !== sessionId) {
          activeSessions.set(scope, sessionId);
          store.replaceSession(scope, sessionId);
          dismissedByScope.delete(scope);
        }
        return store.append({ ...input, scope, sessionId });
      },
      observeQueueItem(item) {
        if (!item?.id) return null;
        const progress = Math.max(0, Math.min(100, Math.floor(Number(item.progress) || 0)));
        const signature = `${item.stage || 'queued'}:${progress}:${item.stageHint || ''}`;
        const previous = queueSignatures.get(item.id);
        queueSignatures.set(item.id, signature);
        const terminal = item.stage === 'done' || item.stage === 'failed';
        if (previous === undefined && terminal) return null;
        if (previous === signature) return null;
        const code = item.stage === 'done' ? 'QUEUE_DONE' : (item.stage === 'failed' ? 'QUEUE_FAILED' : 'QUEUE_PROGRESS');
        const level = item.stage === 'failed' ? 'error' : 'info';
        const stage = item.stage === 'done' ? '转录完成' : (item.stage === 'failed' ? '转录失败' : '转录队列');
        const progressTag = item.stage === 'done' ? '100%' : (item.stage === 'failed' ? '终止' : `总进度 ${progress}%`);
        return BSE.Diagnostics.createEvent({
          scope: 'queue', sessionId: String(item.id), level, code, stage,
          message: `[${item.title || item.id}] ${progressTag} · ${item.stageHint || '执行中'}`,
          context: { jobId: String(item.id) }
        }, now);
      },
      selectScope(scope) {
        if (['media', 'queue', 'native', 'batch'].includes(scope)) selectedScope = scope;
      },
      setDetailed(value) { detailed = Boolean(value); },
      visibleEvents() { return store.events(selectedFilter()); },
      statusEvents,
      activityEvents,
      statusItem,
      summarizeState,
      technicalEvents() { return store.events({ minLevel: 'debug' }).filter((event) => !/_HINT$/.test(event.code)); },
      clearSelected() {
        const filter = selectedFilter();
        delete filter.minLevel;
        const dismissed = dismissedByScope.get(selectedScope) || new Set();
        for (const event of store.events(filter)) dismissed.add(event.id);
        while (dismissed.size > 500) dismissed.delete(dismissed.values().next().value);
        dismissedByScope.set(selectedScope, dismissed);
        store.clear(filter);
      },
      copySelected(header = '') {
        const lines = this.visibleEvents().map((event) => BSE.Diagnostics.formatEvent(event));
        const safeHeader = BSE.Diagnostics.sanitizeText(header, { maxLength: 2000 });
        return `${safeHeader}${safeHeader ? '\n\n' : ''}${lines.join('\n') || '暂无诊断信息'}`;
      },
      copyTechnical(header = '') {
        const lines = this.technicalEvents().map((event) => BSE.Diagnostics.formatEvent(event));
        const safeHeader = BSE.Diagnostics.sanitizeText(header, { maxLength: 2000 });
        return `${safeHeader}${safeHeader ? '\n\n' : ''}${lines.join('\n') || '暂无诊断信息'}`;
      },
      get selectedScope() { return selectedScope; },
      get detailed() { return detailed; }
    });
  }

  BSE.DiagnosticPresenter = Object.freeze({ create });
})();
