(() => {
  'use strict';

  const BSE = globalThis.BSE;

  /**
   * The panel template and its bindings are one contract. Fail fast if a required
   * control disappears instead of letting a distant interaction crash later.
   * @template {Element} T
   * @param {ParentNode} root
   * @param {string} selector
   * @param {{ new (...args: any[]): T }} ctor
   * @returns {T}
   */
  function requireElement(root, selector, ctor) {
    const node = root.querySelector(selector);
    if (!(node instanceof ctor)) {
      throw new Error(`SparkSub RollingPanel template mismatch: ${selector}`);
    }
    return node;
  }

  /**
   * @param {Event} event
   * @returns {Element | null}
   */
  function eventTargetElement(event) {
    return event.target instanceof Element ? event.target : null;
  }

  /** @returns {HTMLElement | null} */
  function closestHtml(event, selector) {
    const node = eventTargetElement(event)?.closest(selector) || null;
    return node instanceof HTMLElement ? node : null;
  }

  /** @returns {HTMLButtonElement | null} */
  function closestButton(event, selector) {
    const node = closestHtml(event, selector);
    return node instanceof HTMLButtonElement ? node : null;
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {HTMLInputElement[]}
   */
  function queryInputs(root, selector) {
    return Array.from(root.querySelectorAll(selector)).filter((node) => node instanceof HTMLInputElement);
  }

  class RollingPanel {
    constructor(actions = {}) {
      this.actions = actions;
      this.state = null;
      this.activeIndex = -1;
      this.following = true;
      this.collapsed = false;
      this.programmaticScrolling = false;
      this.programmaticScrollTimer = null;
      this.renderedMediaKey = null;
      this.platform = null;
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.wrapper?.isConnected || !document.body.contains(this.wrapper)) return;
        this.syncLayout();
      });
      const existing = document.getElementById('bse-rolling-panel-wrapper');
      if (existing) {
        try { existing.remove(); } catch (_) {}
      }
      this.wrapper = document.createElement('div');
      this.wrapper.id = 'bse-rolling-panel-wrapper';
      this.wrapper.style.cssText = 'width:100%;box-sizing:border-box;margin:0;border-radius:6px;position:relative;z-index:1000;display:block;';
      this.host = document.createElement('div');
      this.host.id = 'bse-extension-rolling-panel';
      this.host.style.cssText = 'display:block;width:100%;';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.wrapper.appendChild(this.host);
      this.currentTree = null;
      this.mountTimer = null;
      this.build();
      this.bind();
      window.addEventListener('resize', () => this.syncLayout(), { passive: true });
      if (BSE.I18n) {
        BSE.I18n.subscribe(() => this.applyI18nAndTheme());
        this.applyI18nAndTheme();
      }
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id && chrome?.storage?.sync?.get) {
        try {
          chrome.storage.sync.get({ rollingPanelCollapsed: false, cueFontSize: '14.5', bseSubtitlePreference: 'manual-first' }).then((settings) => {
            this.collapsed = Boolean(settings?.rollingPanelCollapsed);
            this.updateCollapsed();
            if (settings?.cueFontSize) {
              if (this.menuSize) this.menuSize.value = settings.cueFontSize;
              this.panel.style.setProperty('--bse-cue-font-size', `${settings.cueFontSize}px`);
            }
            if (settings?.bseSubtitlePreference && this.menuPref) {
              this.menuPref.value = settings.bseSubtitlePreference;
            }
          }).catch(() => {});
        } catch {}
      }
      if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
        try {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync') return;
            if (changes?.cueFontSize?.newValue) {
              const size = String(changes.cueFontSize.newValue);
              if (this.menuSize) this.menuSize.value = size;
              this.panel.style.setProperty('--bse-cue-font-size', `${size}px`);
            }
            if (changes?.bseSubtitlePreference?.newValue && this.menuPref) {
              this.menuPref.value = String(changes.bseSubtitlePreference.newValue);
            }
          });
        } catch {}
      }
      if (typeof matchMedia === 'function') {
        const systemThemeQuery = matchMedia('(prefers-color-scheme: light)');
        systemThemeQuery.addEventListener?.('change', () => {
          if ((BSE.I18n?.getTheme?.() || 'auto') === 'auto') this.applyTheme('auto');
        });
      }
    }

    build() {
      this.shadow.innerHTML = `
        <style>
          :host { all: initial; display:block; width:100%; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
          * { box-sizing:border-box; }
          [hidden] { display:none !important; }
          .panel {
            color-scheme: dark;
            --primary:#818cf8; --bg:#0f1218; --card:#161b24; --surface-2:#202736;
            --border:rgba(255,255,255,.09); --border-focus:rgba(129,140,248,.45);
            --text:#ffffff; --text-body:#cbd5e1; --dim:#8b9ab0;
            --active-bg:rgba(129,140,248,.14); --active-border:rgba(129,140,248,.38);
            --active-shadow:none;
            width:100%; min-width:280px; height:var(--bse-panel-height,420px); max-height:var(--bse-panel-max-height,100%); overflow:hidden; display:flex;
            flex-direction:column; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text);
            box-shadow:0 8px 24px rgba(0,0,0,.28);
            position:relative;
          }
          .panel[data-theme="dark"] {
            color-scheme: dark;
            --primary:#818cf8; --bg:#0f1218; --card:#161b24; --surface-2:#202736;
            --border:rgba(255,255,255,.09); --border-focus:rgba(129,140,248,.45);
            --text:#ffffff; --text-body:#cbd5e1; --dim:#8b9ab0;
            --active-bg:rgba(129,140,248,.14); --active-border:rgba(129,140,248,.38);
            --active-shadow:none;
          }
          .panel[data-theme="light"] {
            color-scheme: light;
            --primary:#5044cf; --bg:#f8fafc; --card:#ffffff; --surface-2:#f1f5f9;
            --border:rgba(0,0,0,.08); --border-focus:rgba(80,68,207,.36);
            --text:#0f172a; --text-body:#334155; --dim:#64748b;
            --active-bg:rgba(80,68,207,.08); --active-border:rgba(80,68,207,.26);
            --active-shadow:none;
            box-shadow:0 8px 20px rgba(0,0,0,.06);
          }
          .panel[data-theme="bilibili"] {
            color-scheme: dark;
            --primary:#00aeec; --bg:#12151d; --card:#191e28; --surface-2:#212836;
            --border:rgba(255,255,255,0.08); --border-focus:rgba(0,174,236,.48);
            --text:#ffffff; --text-body:#e3e5e7; --dim:#9499a0;
            --active-bg:rgba(0,174,236,.14); --active-border:rgba(0,174,236,.38);
            --active-shadow:none;
          }
          .panel[data-theme="youtube"] {
            color-scheme: dark;
            --primary:#ff4e45; --bg:#0f0f0f; --card:#1f1f1f; --surface-2:#272727;
            --border:rgba(255,255,255,0.10); --border-focus:rgba(255,78,69,.45);
            --text:#ffffff; --text-body:#f1f1f1; --dim:#aaaaaa;
            --active-bg:rgba(255,78,69,.14); --active-border:rgba(255,78,69,.38);
            --active-shadow:none;
          }

          .header {
            flex-shrink:0; height:38px; min-height:38px; max-height:38px; padding:0 8px 0 10px;
            display:flex; align-items:center; justify-content:space-between; gap:6px;
            border-bottom:1px solid var(--border);
            background:linear-gradient(180deg,rgba(255,255,255,.03),transparent);
            position:relative;
            overflow:hidden;
            box-sizing:border-box;
          }
          .header-left {
            min-width:0; flex:1 1 auto; display:flex; flex-direction:row; align-items:center; gap:6px;
            overflow:hidden; height:26px; line-height:26px; box-sizing:border-box;
          }
          .dot {
            width:7px !important; height:7px !important; min-width:7px !important; min-height:7px !important;
            max-width:7px !important; max-height:7px !important; flex:0 0 7px !important;
            border-radius:50% !important; background:var(--dim);
            display:inline-block !important; box-sizing:border-box !important;
            margin:0 !important; padding:0 !important; overflow:hidden !important;
            vertical-align:middle !important; align-self:center !important;
            transition:background .2s;
          }
          .dot.loading { background:#ffb020 !important; animation:pulse 1s infinite; }
          .dot.ready { background:#20c978 !important; }
          .dot.error { background:#ff554d !important; }
          .dot.empty { background:var(--dim) !important; }

          select.tracks {
            min-width:80px; flex:1 1 auto; max-width:170px; height:26px; line-height:24px; padding:0 18px 0 7px;
            border:1px solid var(--border); border-radius:6px;
            color:var(--text); background:var(--card); font-size:11.5px; font-weight:500;
            outline:none; cursor:pointer; text-overflow:ellipsis; white-space:nowrap;
            display:inline-block; box-sizing:border-box;
            -webkit-appearance:none; appearance:none;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='rgba(128,128,128,0.8)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat:no-repeat; background-position:right 6px center;
            transition:border-color .16s ease, background-color .16s ease;
          }
          select.tracks:hover { border-color:var(--border-focus); background-color:var(--surface-2); }
          select.tracks:focus { border-color:var(--primary); }
          select.tracks:disabled { opacity:.6; cursor:default; }

          .header-right { display:flex; align-items:center; gap:4px; flex-shrink:0; }
          .follow {
            height:26px; padding:0 8px; border:1px solid var(--border); border-radius:6px;
            color:var(--dim); background:var(--card); font-size:11px; font-weight:550;
            cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; gap:4px;
            transition:all .16s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .follow:hover { border-color:var(--border-focus); color:var(--text); background:var(--surface-2); }
          .follow:active { transform:scale(.95); }
          .follow.active {
            color:#ffffff !important; border-color:var(--primary) !important;
            background:var(--primary) !important;
            box-shadow:0 2px 8px color-mix(in srgb,var(--primary) 40%,transparent);
          }
          .icon-btn {
            width:26px; height:26px; flex:0 0 26px;
            border:1px solid var(--border); border-radius:6px;
            background:var(--card); color:var(--dim);
            cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
            transition:all .16s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .icon-btn svg { width:12px; height:12px; pointer-events:none; }
          .icon-btn:hover { border-color:var(--border-focus); color:var(--text); background:var(--surface-2); }
          .icon-btn:active { transform:scale(.94); }
          .icon-btn.active { border-color:var(--primary); color:var(--primary); background:var(--active-bg); }
          .icon-btn:disabled { cursor:wait; opacity:.48; pointer-events:none; }
          .icon-btn.refresh.busy svg { animation:spin .9s linear infinite; }

          .list {
            flex:1 1 0%; min-height:0; overflow-y:auto; overflow-x:hidden; padding:10px 12px 14px;
            scrollbar-width:thin; scrollbar-color:rgba(128,128,128,0.35) transparent;
            -webkit-overflow-scrolling:touch;
          }
          .list::-webkit-scrollbar { width:5px; }
          .list::-webkit-scrollbar-track { background:transparent; }
          .list::-webkit-scrollbar-thumb { background:rgba(128,128,128,0.28); border-radius:6px; transition:background .2s ease; }
          .list::-webkit-scrollbar-thumb:hover { background:var(--primary); }

          .paragraph { position:relative; margin-bottom:16px; }
          .paragraph-header { display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-bottom:4px; }
          .paragraph-copy {
            opacity:0; width:20px; height:20px; border-radius:5px;
            display:inline-flex; align-items:center; justify-content:center;
            color:var(--dim); cursor:pointer; transition:all .16s ease;
          }
          .paragraph:hover .paragraph-copy { opacity:1; }
          .paragraph-copy:hover { color:var(--text); background:var(--surface-2); }
          .paragraph-copy svg { width:11px; height:11px; }

          .paragraph-time {
            font-size:11px; font-weight:500; color:var(--dim);
            background:var(--surface-2); border:1px solid var(--border);
            padding:1px 8px; border-radius:10px; font-family:ui-monospace,SFMono-Regular,Menlo,sans-serif;
            user-select:none; cursor:pointer; transition:all .16s ease;
          }
          .paragraph-time:hover {
            color:var(--primary); border-color:var(--primary);
            background:var(--active-bg);
          }
          .paragraph-body {
            margin:0; color:var(--text-body) !important; font-size:var(--bse-cue-font-size, 14.5px);
            line-height:1.62; letter-spacing:0.015em; word-break:break-word;
            user-select:text;
          }

          .cue {
            position:relative;
            display:inline;
            padding:2px 4px;
            margin:0 1px;
            border-radius:4px;
            color:var(--text-body);
            cursor:pointer;
            border-bottom:1.5px solid transparent;
            transition:color .18s ease, background-color .18s ease, border-color .18s ease;
          }
          .cue:hover {
            color:var(--text);
            background:var(--surface-2);
          }
          .cue.active {
            color:var(--text) !important;
            font-weight:600;
            background:var(--active-bg) !important;
            border-bottom:2px solid var(--primary) !important;
            border-radius:4px 4px 0 0;
            padding:2px 5px;
          }

          .search-drawer {
            flex-shrink:0; height:34px; padding:0 8px 0 10px;
            display:flex; align-items:center; gap:6px;
            border-bottom:1px solid var(--border);
            background:var(--surface-2);
          }
          .search-drawer svg.search-icon-sm { width:12px; height:12px; color:var(--dim); flex-shrink:0; }
          .search-drawer input {
            min-width:0; flex:1; border:0; outline:0;
            background:transparent; color:var(--text); font-size:11.5px;
          }
          .search-drawer input::placeholder { color:var(--dim); }
          .search-badge {
            font-size:10px; color:var(--dim);
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
            white-space:nowrap;
          }
          .icon-btn-sm {
            width:20px; height:20px; border:1px solid var(--border); border-radius:5px;
            background:var(--card); color:var(--dim); font-size:9px;
            display:inline-flex; align-items:center; justify-content:center;
            cursor:pointer; transition:all .16s ease;
          }
          .icon-btn-sm:hover { color:var(--text); border-color:var(--primary); background:var(--surface-2); }

          mark.search-match {
            padding:0 2px; border-radius:3px;
            background:rgba(255,176,32,.42); color:inherit;
          }
          mark.search-match.current {
            background:#ffb020; color:#000; font-weight:600;
          }

          /* Settings Drawer (Top) */
          .settings-drawer {
            flex-shrink:0; padding:10px 12px;
            display:flex; flex-direction:column; gap:9px;
            border-bottom:1px solid var(--border);
            background:var(--surface-2);
            animation:slideDown .18s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .settings-grid {
            display:grid; grid-template-columns:repeat(2, 1fr); gap:6px 8px;
          }
          .settings-card {
            padding:5px 8px; border:1px solid var(--border); border-radius:7px;
            background:var(--card); display:flex; flex-direction:column; gap:2px;
            transition:border-color .16s ease, background-color .16s ease;
          }
          .settings-card:hover { border-color:var(--border-focus); background:var(--surface-2); }
          .settings-card:focus-within { border-color:var(--primary); }
          .settings-card-label {
            font-size:9.5px; font-weight:600; color:var(--dim);
          }
          .settings-card select {
            width:100%; height:22px; padding:0 14px 0 0;
            border:0; outline:none; background:transparent;
            color:var(--text); font-size:11px; font-weight:500; cursor:pointer;
            -webkit-appearance:none; appearance:none;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='rgba(128,128,128,0.7)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat:no-repeat; background-position:right center;
          }

          /* AI Drawer (Bottom Slide-Up) */
          .ai-drawer {
            flex-shrink:0; padding:9px 12px;
            border-top:1px solid var(--border);
            background:var(--surface-2);
            display:flex; flex-direction:column; gap:7px;
            animation:slideUp .18s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .ai-drawer-header {
            display:flex; align-items:center; justify-content:space-between;
          }
          .ai-drawer-title {
            font-size:10px; font-weight:600; color:var(--dim); text-transform:uppercase; letter-spacing:0.04em;
          }
          .ai-prompts-grid {
            display:grid; grid-template-columns:repeat(2, 1fr); gap:5px;
          }
          .ai-btn {
            height:26px; padding:0 6px; border:1px solid var(--border); border-radius:6px;
            background:var(--card); color:var(--text); font-size:10.5px; font-weight:500;
            display:inline-flex; align-items:center; justify-content:center; gap:4px;
            cursor:pointer; transition:all .16s ease; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;
          }
          .ai-btn:hover { border-color:var(--primary); background:var(--active-bg); color:var(--text); }

          /* Bottom Footer Toolbar */
          .footer-bar {
            flex-shrink:0; height:36px; padding:0 8px;
            display:flex; align-items:center; justify-content:space-between; gap:4px;
            border-top:1px solid var(--border);
            background:var(--card);
            overflow:hidden;
          }
          .footer-left {
            display:flex; align-items:center; gap:4px; min-width:0; flex:1; overflow:hidden;
          }
          .footer-right {
            display:flex; align-items:center; gap:4px; flex-shrink:0;
          }
          .footer-btn {
            height:25px; padding:0 6px; border:1px solid var(--border); border-radius:6px;
            background:var(--surface-2); color:var(--text); font-size:10.5px; font-weight:500;
            cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:3px; white-space:nowrap;
            transition:all .16s cubic-bezier(0.4, 0, 0.2, 1);
            flex-shrink:0;
          }
          .footer-btn svg { width:11.5px; height:11.5px; }
          .footer-btn:hover { border-color:var(--border-focus); background:var(--surface-hover, rgba(255,255,255,.06)); color:var(--text); }
          .footer-btn:active { transform:scale(.95); }
          .footer-btn.active {
            background:var(--active-bg) !important; color:var(--primary) !important; border-color:var(--primary) !important;
            font-weight:600;
          }
          .footer-export-group {
            display:inline-flex; align-items:center; flex-shrink:0;
          }
          .footer-select {
            height:25px; padding:0 12px 0 5px; border:1px solid var(--border); border-right:0;
            border-radius:6px 0 0 6px; background:var(--surface-2); color:var(--text); font-size:10px; font-weight:500;
            outline:none; cursor:pointer; -webkit-appearance:none; appearance:none;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='7' height='7' viewBox='0 0 24 24' fill='none' stroke='rgba(128,128,128,0.7)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat:no-repeat; background-position:right 3px center;
            transition:border-color .16s ease, background-color .16s ease;
          }
          .footer-select:hover { border-color:var(--border-focus); }
          .footer-select:focus { border-color:var(--primary); }
          .footer-export-group .footer-btn {
            border-radius:0 6px 6px 0;
          }
          .footer-bar .icon-btn {
            width:25px; height:25px; flex:0 0 25px; border-radius:6px;
            background:var(--surface-2);
          }
          .footer-bar .icon-btn svg { width:11.5px; height:11.5px; }

          @media (max-width: 360px) {
            .header { padding:0 6px 0 8px; gap:4px; }
            .tracks { max-width:110px; font-size:11px; }
            .follow { padding:0 6px; font-size:10.5px; }
            .footer-bar { padding:0 5px; gap:2px; }
            .footer-btn { padding:0 4px; font-size:10px; }
            .footer-btn svg { width:11px; height:11px; }
          }

          .empty {
            flex:1; min-height:160px; padding:24px 16px;
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            text-align:center; color:var(--dim);
          }
          .empty-icon-wrap {
            width:38px !important; height:38px !important; min-width:38px !important; min-height:38px !important;
            max-width:38px !important; max-height:38px !important; flex:0 0 38px !important;
            margin:0 0 10px 0 !important; border-radius:50% !important;
            background:var(--card); display:flex; align-items:center; justify-content:center;
            color:var(--dim); border:1px solid var(--border); box-sizing:border-box !important;
          }
          .empty-icon-wrap.error {
            color:#ff554d; background:rgba(255,85,77,.12); border-color:rgba(255,85,77,.25);
          }
          .empty-icon-wrap.empty {
            color:var(--dim); background:var(--surface-2); border-color:var(--border);
          }
          .empty-icon-wrap.loading {
            color:var(--primary); background:var(--active-bg); border-color:var(--active-border);
          }
          .empty-icon-wrap svg { width:18px; height:18px; flex-shrink:0; }
          .empty-title {
            font-size:12.5px; font-weight:600; color:var(--text);
            margin-bottom:4px; line-height:1.4;
          }
          .empty-desc {
            font-size:11px; color:var(--dim); line-height:1.5; max-width:240px; margin-bottom:12px;
          }
          .empty-actions {
            display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; margin-top:10px; width:100%;
          }
          .empty-sub-actions {
            display:inline-flex; align-items:center; justify-content:center; gap:6px;
          }
          .empty-btn {
            height:28px; padding:0 12px; font-size:11.5px; font-weight:550;
            border-radius:6px; border:1px solid var(--border);
            background:var(--card); color:var(--text);
            cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:5px;
            transition:all .16s ease; outline:none; box-sizing:border-box;
          }
          .empty-btn svg { width:12px; height:12px; flex-shrink:0; }
          .empty-btn:hover {
            border-color:var(--border-focus); background:var(--surface-2); color:var(--text); transform:translateY(-1px);
          }
          .empty-btn:active { transform:translateY(0); }
          .empty-btn.btn-transcribe-asr {
            height:32px; padding:0 18px; font-size:12.5px; font-weight:600;
            background:linear-gradient(135deg,var(--primary),#ff6b64); color:#ffffff;
            border:none; border-radius:8px; box-shadow:0 3px 12px rgba(255,85,77,0.35);
          }
          .empty-btn.btn-transcribe-asr svg { width:14px; height:14px; }
          .empty-btn.btn-transcribe-asr:hover {
            filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 5px 16px rgba(255,85,77,0.45);
          }
          .empty-btn.btn-retry {
            background:var(--active-bg); color:var(--primary); border-color:var(--active-border);
          }
          .empty-btn.btn-retry:hover {
            background:var(--primary); color:#ffffff; border-color:var(--primary);
          }

          /* Batch Modal in Shadow DOM */
          .batch-overlay {
            position:absolute; inset:0; z-index:50;
            background:rgba(0,0,0,0.72); backdrop-filter:blur(8px);
            display:flex; align-items:center; justify-content:center; padding:10px;
          }
          .batch-dialog {
            width:100%; max-width:520px; max-height:92%;
            background:var(--bg); border:1px solid var(--border-focus); border-radius:14px;
            box-shadow:0 18px 42px rgba(0,0,0,0.55); display:flex; flex-direction:column; overflow:hidden;
          }
          .batch-header {
            padding:10px 12px; border-bottom:1px solid var(--border);
            display:flex; align-items:center; justify-content:space-between; background:var(--surface-2);
          }
          .batch-header-info { display:flex; flex-direction:column; gap:2px; min-width:0; }
          .batch-title-row { display:flex; align-items:center; gap:6px; }
          .batch-title { font-size:12.5px; font-weight:650; color:var(--text); }
          .batch-type-pill {
            font-size:9.5px; padding:1px 5px; border-radius:4px;
            background:var(--active-bg); color:var(--primary); border:1px solid var(--active-border); font-weight:600;
          }
          .batch-summary { font-size:10.5px; color:var(--dim); }
          .batch-body {
            padding:10px 12px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;
          }
          .batch-card {
            padding:8px 10px; border:1px solid var(--border); border-radius:8px;
            background:var(--card); display:flex; flex-direction:column; gap:6px;
          }
          .batch-card-header { display:flex; flex-direction:column; gap:6px; }
          .batch-card-title { font-size:12px; font-weight:650; color:var(--text); }
          .batch-tree-header-top { display:flex; align-items:center; justify-content:space-between; gap:6px; }
          .batch-tree-selected-summary {
            font-size:10.5px; color:var(--primary); background:rgba(255,85,77,0.12); border:1px solid rgba(255,85,77,0.25);
            padding:2px 7px; border-radius:10px; font-weight:600; font-family:ui-monospace, monospace; white-space:nowrap;
          }
          .batch-tree-toolbar-actions { display:grid; grid-template-columns:repeat(4, 1fr); gap:5px; width:100%; }
          .batch-tree-tool-btn {
            background:var(--surface-2); border:1px solid var(--border); color:var(--text);
            border-radius:6px; padding:0 4px; font-size:10.5px; font-weight:550; cursor:pointer;
            height:25px; display:inline-flex; align-items:center; justify-content:center; gap:3px;
            white-space:nowrap; transition:all .16s ease; user-select:none;
          }
          .batch-tree-tool-btn svg { flex-shrink:0; opacity:0.75; }
          .batch-tree-tool-btn:hover {
            background:var(--surface-hover); color:var(--text); border-color:var(--border-focus);
            transform:translateY(-0.5px); box-shadow:0 2px 6px rgba(0,0,0,0.1);
          }
          .batch-tree-tool-btn:hover svg { opacity:1; }
          .batch-tree-tool-btn:active { transform:scale(0.96); }
          .batch-quick-range-bar {
            display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 8px; background:var(--surface-2);
            border:1px solid var(--border); border-radius:7px; font-size:10.5px; color:var(--text-body);
          }
          .batch-quick-range-badge { display:inline-flex; align-items:center; gap:3px; font-weight:600; color:var(--text); flex-shrink:0; }
          .batch-quick-range-inputs { display:inline-flex; align-items:center; gap:3px; color:var(--dim); }
          .batch-range-input {
            width:42px; height:22px; padding:0 3px; border:1px solid var(--border); border-radius:5px;
            background:var(--surface); color:var(--text); font-size:11px; font-weight:600; text-align:center; outline:none; font-family:ui-monospace, monospace;
            transition:border-color .16s ease, box-shadow .16s ease;
          }
          .batch-range-input:focus { border-color:var(--primary); box-shadow:0 0 0 2px rgba(255,85,77,0.2); }
          .batch-quick-apply-btn {
            height:22px; padding:0 8px; border-radius:5px; background:var(--surface-hover); border:1px solid var(--border-focus);
            color:var(--text); font-size:10.5px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
            transition:all .16s ease; white-space:nowrap; flex-shrink:0;
          }
          .batch-quick-apply-btn:hover { background:var(--primary); color:#fff; border-color:var(--primary); box-shadow:0 2px 6px rgba(255,85,77,0.25); }
          .batch-quick-apply-btn:active { transform:scale(0.96); }
          .batch-tree {
            max-height:190px; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:3px; font-size:11px; padding-right:2px;
          }
          .batch-tree-sec-group { display:flex; flex-direction:column; gap:2px; }
          .batch-tree-sec-group.collapsed .batch-tree-sec-children { display:none; }
          .batch-tree-sec-group.collapsed .batch-tree-sec-chevron { transform:rotate(-90deg); }
          .batch-tree-sec-chevron {
            display:inline-flex; align-items:center; justify-content:center; font-size:8.5px; width:13px; height:13px;
            transition:transform .16s ease; user-select:none; cursor:pointer; color:var(--dim);
          }
          .batch-tree-sec-chevron:hover { color:var(--primary); }
          .batch-tree-sec-children { display:flex; flex-direction:column; gap:2px; }
          .batch-tree-sec-node {
            font-size:11px; font-weight:700; color:var(--primary); padding:4px 8px;
            background:var(--surface-2); border:1px solid var(--border); border-radius:5px;
            margin-top:3px; display:flex; align-items:center; justify-content:space-between;
          }
          .batch-tree-video-node {
            font-size:11px; font-weight:600; color:var(--text); padding:4px 8px;
            margin-top:2px; background:var(--surface-hover); border-radius:5px;
            display:flex; align-items:center; justify-content:space-between;
          }
          .batch-tree-item-node {
            padding:4px 8px; border-radius:5px; background:var(--surface-2); color:var(--text-body);
            display:flex; align-items:center; justify-content:space-between; gap:5px; font-size:11px;
            cursor:pointer; border-left:3px solid transparent; transition:all .14s ease;
          }
          .batch-tree-item-node.sub-p { padding-left:16px; }
          .batch-tree-item-node:hover { background:var(--surface-hover); color:var(--text); }
          .batch-tree-item-node:has(.batch-tree-cb:checked) {
            background:var(--active-bg); border-left-color:var(--primary);
          }
          .batch-tree-item-node.active {
            background:var(--active-bg); color:var(--primary); border-left-color:var(--primary); font-weight:600;
          }
          .batch-tree-item-label, .batch-tree-sec-label, .batch-tree-video-label {
            display:inline-flex; align-items:center; gap:6px; min-width:0; flex:1; cursor:pointer; user-select:none;
          }
          .batch-tree-cb, .batch-tree-sec-cb, .batch-tree-video-cb {
            accent-color:var(--primary); cursor:pointer; width:13px; height:13px; margin:0; flex-shrink:0;
          }
          .batch-tree-item-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .batch-tree-item-idx { color:var(--dim); font-family:ui-monospace, monospace; }
          .batch-tree-tag-cur {
            display:inline-block; padding:1px 4px; background:var(--primary); color:#fff; font-size:8.5px; font-weight:700; border-radius:2px; margin-left:3px;
          }
          .batch-tree-node-meta { font-size:10px; color:var(--dim); white-space:nowrap; }
          .batch-tree-sec-btn, .batch-tree-video-btn {
            font-size:10px; font-weight:550; color:var(--text-body); padding:2px 8px; border-radius:10px;
            background:var(--surface); border:1px solid var(--border); cursor:pointer;
            height:20px; display:inline-flex; align-items:center; justify-content:center;
            transition:all .14s ease; white-space:nowrap; user-select:none;
          }
          .batch-tree-sec-btn:hover, .batch-tree-video-btn:hover {
            background:var(--primary); color:#fff; border-color:var(--primary); transform:scale(1.02); box-shadow:0 2px 6px rgba(255,85,77,0.25);
          }
          .batch-tree-sec-btn:active, .batch-tree-video-btn:active { transform:scale(0.96); }
          .batch-settings-stacked { display:flex; flex-direction:column; gap:8px; }
          .batch-settings-row { display:flex; flex-direction:column; gap:4px; }
          .batch-setting-title { font-size:10.5px; font-weight:600; color:var(--dim); }
          .batch-radio-group { display:flex; flex-direction:column; gap:4px; }
          .batch-radio-pill {
            display:flex; align-items:center; gap:7px; padding:6px 10px; border:1px solid var(--border);
            border-radius:7px; background:var(--surface-2); color:var(--text-body); font-size:11px; cursor:pointer;
            transition:all .14s ease; user-select:none;
          }
          .batch-radio-pill:hover { background:var(--surface-hover); color:var(--text); border-color:var(--border-focus); }
          .batch-radio-pill:has(input:checked) {
            border-color:var(--primary); background:var(--active-bg); color:var(--text); font-weight:600;
            box-shadow:0 0 0 1px var(--primary) inset, 0 2px 6px rgba(0,0,0,0.1);
          }
          .batch-radio-pill input[type="radio"] { accent-color:var(--primary); margin:0; width:13px; height:13px; flex-shrink:0; }
          .batch-output-pill { align-items:flex-start; padding:7px 9px; }
          .batch-output-pill > span { display:flex; min-width:0; flex-direction:column; gap:2px; }
          .batch-output-pill strong { color:var(--text); font-size:11px; font-weight:650; }
          .batch-output-pill small { color:var(--dim); font-size:10px; font-weight:450; line-height:1.3; }
          .batch-radio-pill:has(input:checked) small { color:var(--text-body); }
          .batch-footer {
            padding:10px 14px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; background:var(--surface);
          }
          .batch-btn-sm {
            height:32px; padding:0 18px; border-radius:8px; border:0; font-size:12px; font-weight:600; cursor:pointer;
            transition:all .18s cubic-bezier(0.16, 1, 0.3, 1); display:inline-flex; align-items:center; justify-content:center; gap:4px;
            user-select:none;
          }
          .batch-btn-primary {
            background:linear-gradient(135deg, var(--primary), #ff6b64); color:#fff; box-shadow:0 3px 10px rgba(255,85,77,0.35);
          }
          .batch-btn-primary:hover { filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 5px 14px rgba(255,85,77,0.45); }
          .batch-btn-primary:active { transform:scale(0.98) translateY(0); }
          .batch-progress {
            height:6px; background:var(--surface-2); border-radius:6px; overflow:hidden; margin:4px 0;
          }
          .batch-bar {
            height:100%; width:0%; background:linear-gradient(90deg, var(--primary), #20c978); transition:width .2s ease;
          }
          .batch-prog-text { font-size:11px; color:var(--text); margin-bottom:3px; font-weight:500; }

          .toast {
            position: absolute;
            bottom: 48px;
            left: 50%;
            transform: translate(-50%, 10px) scale(0.94);
            z-index: 999;
            max-width: calc(100% - 32px);
            padding: 7px 14px;
            border-radius: 20px;
            background: var(--surface-2);
            color: var(--text);
            font-size: 11.5px;
            font-weight: 550;
            border: 1px solid var(--border-focus);
            box-shadow: 0 10px 28px rgba(0,0,0,0.45);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            opacity: 0;
            pointer-events: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
            transition: transform .22s cubic-bezier(0.16, 1, 0.3, 1), opacity .22s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .toast.show {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
          .toast.success {
            border-color: rgba(32, 201, 120, 0.45);
            color: #20c978;
          }
          .toast.error {
            border-color: rgba(255, 85, 77, 0.45);
            color: #ff8b83;
          }

          .panel.collapsed .list,
          .panel.collapsed .empty,
          .panel.collapsed .search-drawer,
          .panel.collapsed .settings-drawer,
          .panel.collapsed .ai-drawer,
          .panel.collapsed .footer-bar,
          .panel.collapsed .batch-overlay { display:none; }
          .panel.collapsed { height:44px !important; max-height:44px !important; min-height:44px !important; }
          @keyframes pulse { 50% { opacity:.35; } }
          @keyframes spin { to { transform:rotate(360deg); } }
          @keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
          @keyframes slideUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
          @media (max-width:700px) { .panel { min-width:240px; } .paragraph-body { font-size:13px; line-height:1.85; } }
        </style>
        <section class="panel">
          <header class="header">
            <div class="header-left">
              <span class="dot"></span>
              <select id="rp-tracks-select" name="rp-tracks-select" class="tracks" aria-label="字幕轨道"></select>
            </div>
            <div class="header-right">
              <button class="follow active" title="自动跟随">跟随</button>
              <button class="icon-btn search-toggle" title="搜索文稿">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
              <button class="icon-btn settings-toggle" title="偏好设置" aria-controls="rp-settings-drawer" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <button class="icon-btn collapse" title="收起或展开">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
          </header>
          <div class="search-drawer" hidden>
            <svg class="search-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="rp-search-input" name="rp-search-input" class="search-input" type="search" placeholder="搜索字幕关键词..." autocomplete="off" />
            <span class="search-badge"></span>
            <button class="icon-btn-sm search-prev" title="上一个">▲</button>
            <button class="icon-btn-sm search-next" title="下一个">▼</button>
            <button class="icon-btn-sm search-close" title="关闭搜索">×</button>
          </div>
          <div class="settings-drawer" id="rp-settings-drawer" hidden>
            <div class="settings-grid">
              <div class="settings-card">
                <span class="settings-card-label" id="rp-label-theme">主题</span>
                <select id="rp-menu-theme" name="rp-menu-theme" class="settings-select menu-theme" aria-label="主题">
                  <option value="auto">自动</option>
                  <option value="dark">暗曜</option>
                  <option value="light">浅色</option>
                  <option value="bilibili">哔哩碧蓝</option>
                  <option value="youtube">油管猩红</option>
                </select>
              </div>
              <div class="settings-card">
                <span class="settings-card-label" id="rp-label-lang">语言</span>
                <select id="rp-menu-lang" name="rp-menu-lang" class="settings-select menu-lang" aria-label="语言">
                  <option value="auto">自动</option>
                  <option value="zh-CN">简体中文</option>
                  <option value="zh-TW">繁體中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div class="settings-card">
                <span class="settings-card-label" id="rp-label-pref">默认字幕策略</span>
                <select id="rp-menu-pref" name="rp-menu-pref" class="settings-select menu-pref" aria-label="默认字幕策略">
                  <option value="manual-first">人工字幕优先，AI 字幕兜底</option>
                  <option value="manual-only">仅人工字幕</option>
                  <option value="ai-first">AI 字幕优先</option>
                </select>
              </div>
              <div class="settings-card">
                <span class="settings-card-label" id="rp-label-size">正文字号</span>
                <select id="rp-menu-size" name="rp-menu-size" class="settings-select menu-size" aria-label="正文字号">
                  <option value="13">小 (13px)</option>
                  <option value="14.5" selected>中 (14.5px)</option>
                  <option value="16.5">大 (16.5px)</option>
                </select>
              </div>
            </div>
          </div>
          <div class="list"></div>
          <div class="empty">正在等待字幕…</div>
          <div class="toast"></div>

          <!-- AI Prompts Drawer (Slide Up) -->
          <div class="ai-drawer" hidden>
            <div class="ai-drawer-header">
              <span class="ai-drawer-title">AI 总结与学习提示词</span>
              <button class="icon-btn-sm ai-close" title="收起 AI 工具">×</button>
            </div>
            <div class="ai-prompts-grid">
              <button class="ai-btn" data-prompt="notes">深度讲义</button>
              <button class="ai-btn" data-prompt="summary">核心总结</button>
              <button class="ai-btn" data-prompt="keypoints">关键要点</button>
              <button class="ai-btn" data-prompt="questions">思考复盘</button>
            </div>
          </div>

          <!-- Bottom Footer Toolbar -->
          <footer class="footer-bar">
            <div class="footer-left">
              <button class="footer-btn btn-ai-toggle" title="AI 总结与学习助手">
                <span>AI 总结</span>
              </button>
              <div class="footer-export-group">
                <select id="rp-format-select" name="rp-format-select" class="footer-select format-select" aria-label="导出格式">
                  <option value="txt">TXT</option>
                  <option value="srt">SRT</option>
                  <option value="md">MD</option>
                  <option value="audio">音频直链</option>
                </select>
                <button class="footer-btn btn-download-single" title="下载当前字幕文件">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>下载</span>
                </button>
              </div>
              <button class="footer-btn btn-batch-export" title="批量导出合集/多P字幕" hidden>
                <span>批量</span>
              </button>
            </div>
            <div class="footer-right">
              <button class="footer-btn copy-all" title="复制全文">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>复制</span>
              </button>
              <button class="icon-btn btn-open-sidebar" title="打开独立侧边栏">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              </button>
              <button class="icon-btn btn-refresh-sub" title="重新获取解析字幕">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l6.73-5.19"/></svg>
              </button>
            </div>
          </footer>

          <!-- Batch Modal Overlay inside Rolling Panel Shadow DOM -->
          <div class="batch-overlay" hidden>
            <div class="batch-dialog">
              <div class="batch-header">
                <div class="batch-header-info">
                  <div class="batch-title-row">
                    <strong class="batch-title">批量导出字幕</strong>
                    <span class="batch-type-pill">合集</span>
                  </div>
                  <div class="batch-summary">正在读取合集架构…</div>
                </div>
                <button class="icon-btn-sm batch-close" title="关闭">×</button>
              </div>
              <div class="batch-body">
                <!-- Card 1: Tree Preview & Granular Selection -->
                <div class="batch-card">
                  <div class="batch-card-header">
                    <div class="batch-tree-header-top">
                      <div class="batch-tree-title-group">
                        <span class="batch-card-title">分P与合集架构</span>
                      </div>
                      <span class="batch-tree-selected-summary">已选 0 集</span>
                    </div>
                    <div class="batch-tree-toolbar-actions">
                      <button type="button" class="batch-tree-tool-btn batch-tree-btn-all" title="全选所有分P">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        <span>全选</span>
                      </button>
                      <button type="button" class="batch-tree-tool-btn batch-tree-btn-cur" title="仅勾选当前分P">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
                        <span>仅当前</span>
                      </button>
                      <button type="button" class="batch-tree-tool-btn batch-tree-btn-none" title="清空全部勾选">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        <span>清空</span>
                      </button>
                      <button type="button" class="batch-tree-tool-btn batch-tree-btn-invert" title="反向勾选">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>
                        <span>反选</span>
                      </button>
                    </div>
                  </div>
                  <div class="batch-quick-range-bar">
                    <div class="batch-quick-range-badge">
                      <span style="font-weight:600;color:var(--text);">区间速选</span>
                    </div>
                    <div class="batch-quick-range-inputs">
                      <span>从第</span>
                      <input type="number" class="batch-range-input rp-range-start" min="1" value="1">
                      <span>至</span>
                      <input type="number" class="batch-range-input rp-range-end" min="1" value="1">
                      <span>集</span>
                    </div>
                    <button type="button" class="batch-quick-apply-btn rp-range-apply">应用勾选</button>
                  </div>
                  <div class="batch-tree"></div>
                </div>

                <!-- Card 2: Output & Format Settings -->
                <div class="batch-card">
                  <div class="batch-card-header">
                    <span class="batch-card-title">输出与格式设置</span>
                  </div>
                  <div class="batch-settings-stacked">
                    <div class="batch-settings-row">
                      <span class="batch-setting-title">完成后怎么用</span>
                      <div class="batch-radio-group">
                        <label class="batch-radio-pill batch-output-pill"><input type="radio" name="rp-output" value="copy-text" checked> <span><strong>复制全文</strong><small>按目录顺序合并所选字幕，直接复制到剪贴板</small></span></label>
                        <label class="batch-radio-pill batch-output-pill"><input type="radio" name="rp-output" value="merged-file"> <span><strong>合并为一个长文件</strong><small>下载 Markdown 或 TXT，适合阅读、归档与 AI</small></span></label>
                        <label class="batch-radio-pill batch-output-pill"><input type="radio" name="rp-output" value="zip"> <span><strong>每集独立打包 ZIP</strong><small>保留独立文件，适合播放器、剪辑和批量归档</small></span></label>
                      </div>
                    </div>
                    <div class="batch-settings-row rp-format-row" hidden>
                      <span class="batch-setting-title rp-format-label">合并文件格式</span>
                      <div class="batch-radio-group">
                        <label class="batch-radio-pill rp-format-srt" hidden><input type="radio" name="rp-format" value="srt"> <span>SRT 字幕（播放器/剪辑外挂）</span></label>
                        <label class="batch-radio-pill"><input type="radio" name="rp-format" value="md" checked> <span>Markdown（保留标题与来源结构）</span></label>
                        <label class="batch-radio-pill"><input type="radio" name="rp-format" value="txt"> <span>TXT（纯文本长文稿）</span></label>
                      </div>
                    </div>
                    <div class="batch-settings-row rp-timestamp-row">
                      <span class="batch-setting-title">时间戳选项（适用于 Markdown / TXT）</span>
                      <div class="batch-radio-group">
                        <label class="batch-radio-pill"><input type="radio" name="rp-timestamp" value="false" checked> <span>纯文本讲稿（无时间轴 · 适合阅读与 AI）</span></label>
                        <label class="batch-radio-pill"><input type="radio" name="rp-timestamp" value="true"> <span>保留时间戳（方便精准定位回查）</span></label>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Progress Wrapper -->
                <div class="batch-progress-wrapper" hidden>
                  <div class="batch-prog-text">处理中…</div>
                  <div class="batch-progress"><div class="batch-bar"></div></div>
                </div>
              </div>
              <div class="batch-footer">
                <button class="batch-btn-sm batch-btn-primary batch-start">开始导出</button>
              </div>
            </div>
          </div>
        </section>
      `;
      this.panel = requireElement(this.shadow, '.panel', HTMLElement);
      this.dot = requireElement(this.shadow, '.dot', HTMLElement);
      this.trackSelect = requireElement(this.shadow, '.tracks', HTMLSelectElement);
      this.list = requireElement(this.shadow, '.list', HTMLElement);
      this.empty = requireElement(this.shadow, '.empty', HTMLElement);
      this.followButton = requireElement(this.shadow, '.follow', HTMLButtonElement);
      this.searchToggle = requireElement(this.shadow, '.search-toggle', HTMLButtonElement);
      this.settingsToggle = requireElement(this.shadow, '.settings-toggle', HTMLButtonElement);
      this.collapseButton = requireElement(this.shadow, '.collapse', HTMLButtonElement);
      this.searchDrawer = requireElement(this.shadow, '.search-drawer', HTMLElement);
      this.searchInput = requireElement(this.shadow, '.search-input', HTMLInputElement);
      this.searchBadge = requireElement(this.shadow, '.search-badge', HTMLElement);
      this.searchPrev = requireElement(this.shadow, '.search-prev', HTMLButtonElement);
      this.searchNext = requireElement(this.shadow, '.search-next', HTMLButtonElement);
      this.searchClose = requireElement(this.shadow, '.search-close', HTMLButtonElement);
      this.settingsDrawer = requireElement(this.shadow, '.settings-drawer', HTMLElement);
      this.menuTheme = requireElement(this.shadow, '.menu-theme', HTMLSelectElement);
      this.menuLang = requireElement(this.shadow, '.menu-lang', HTMLSelectElement);
      this.menuPref = requireElement(this.shadow, '.menu-pref', HTMLSelectElement);
      this.menuSize = requireElement(this.shadow, '.menu-size', HTMLSelectElement);
      this.aiDrawer = requireElement(this.shadow, '.ai-drawer', HTMLElement);
      this.aiBtnToggle = requireElement(this.shadow, '.btn-ai-toggle', HTMLButtonElement);
      this.aiClose = requireElement(this.shadow, '.ai-close', HTMLButtonElement);
      this.formatSelect = requireElement(this.shadow, '.format-select', HTMLSelectElement);
      this.btnDownloadSingle = requireElement(this.shadow, '.btn-download-single', HTMLButtonElement);
      this.btnBatchExport = requireElement(this.shadow, '.btn-batch-export', HTMLButtonElement);
      this.copyAllButton = requireElement(this.shadow, '.copy-all', HTMLButtonElement);
      this.btnOpenSidebar = requireElement(this.shadow, '.btn-open-sidebar', HTMLButtonElement);
      this.btnRefreshSub = requireElement(this.shadow, '.btn-refresh-sub', HTMLButtonElement);
      this.refreshButton = this.btnRefreshSub;
      this.toastEl = requireElement(this.shadow, '.toast', HTMLElement);
      // Batch Modal in Shadow DOM
      this.batchOverlay = requireElement(this.shadow, '.batch-overlay', HTMLElement);
      this.batchClose = requireElement(this.shadow, '.batch-close', HTMLButtonElement);
      this.batchSummary = requireElement(this.shadow, '.batch-summary', HTMLElement);
      this.batchTree = requireElement(this.shadow, '.batch-tree', HTMLElement);
      this.batchTreeSummary = requireElement(this.shadow, '.batch-tree-selected-summary', HTMLElement);
      this.batchRangeStart = requireElement(this.shadow, '.rp-range-start', HTMLInputElement);
      this.batchRangeEnd = requireElement(this.shadow, '.rp-range-end', HTMLInputElement);
      this.batchRangeApply = requireElement(this.shadow, '.rp-range-apply', HTMLButtonElement);
      this.batchProgressWrapper = requireElement(this.shadow, '.batch-progress-wrapper', HTMLElement);
      this.batchProgText = requireElement(this.shadow, '.batch-prog-text', HTMLElement);
      this.batchBar = requireElement(this.shadow, '.batch-bar', HTMLElement);
      this.batchStart = requireElement(this.shadow, '.batch-start', HTMLButtonElement);
      this.searchQuery = '';
      this.searchMatches = [];
      this.currentMatchIndex = -1;
    }

    bind() {
      this.collapseButton.addEventListener('click', () => {
        this.collapsed = !this.collapsed;
        this.updateCollapsed();
        if (typeof chrome !== 'undefined' && chrome?.runtime?.id && chrome?.storage?.sync?.set) {
          try {
            chrome.storage.sync.set({ rollingPanelCollapsed: this.collapsed }).catch(() => {});
          } catch {}
        }
      });
      this.trackSelect.addEventListener('change', () => this.actions.selectTrack?.(this.trackSelect.value));
      this.followButton.addEventListener('click', () => {
        this.following = true;
        this.updateFollowButton();
        this.scrollToActive(true);
      });

      // Quick Copy
      this.copyAllButton.addEventListener('click', async () => {
        if (!this.state?.cues?.length) return;
        const text = BSE.Formatters.toTxt(this.state.cues, false);
        await navigator.clipboard.writeText(text);
        this.showToast(BSE.I18n?.t('copied_full_text') || '已复制字幕全文');
      });

      // AI Summary Drawer Toggle
      this.aiBtnToggle.addEventListener('click', () => {
        const isHidden = !this.aiDrawer.hidden;
        this.aiDrawer.hidden = isHidden;
        this.aiBtnToggle.classList.toggle('active', !isHidden);
      });
      this.aiClose.addEventListener('click', () => {
        this.aiDrawer.hidden = true;
        this.aiBtnToggle.classList.remove('active');
      });

      // AI Prompt Buttons
      /** @type {NodeListOf<HTMLElement>} */ (this.shadow.querySelectorAll('.ai-btn')).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!this.state?.cues?.length) {
            this.showToast('暂无字幕内容可供总结');
            return;
          }
          const promptId = btn.dataset.prompt;
          const text = BSE.Formatters.generateAiPrompt(promptId, this.state.cues, false, {
            title: this.state.title,
            mediaContext: this.state.mediaContext || null
          });
          await navigator.clipboard.writeText(text);
          this.showToast(BSE.I18n?.t('ai_copied_toast') || '已复制 AI 提示词与文稿');
        });
      });

      // Single Video Download & DASH Audio Extraction
      this.btnDownloadSingle.addEventListener('click', async () => {
        const format = this.formatSelect.value || 'txt';

        // 独立提取 B站 DASH 音频直链并无损下载
        if (format === 'audio') {
          if (this.state?.platform !== 'bilibili') {
            this.showToast('独立音频直链提取目前支持 B 站 DASH 视频', 'error');
            return;
          }
          this.showToast('正在提取 B 站独立 DASH 音频直链…');
          try {
            const audioData = await BSE.Bilibili.fetchAudioStream();
            const bitrateKbps = Math.round((audioData.bandwidth || 0) / 1000);
            await navigator.clipboard.writeText(audioData.audioUrl);
            this.showToast(`已提取 ${bitrateKbps}kbps 音频直链并复制，正在下载文件…`, 'success');

            // 通过后台通道带 Referer 下载完整音频文件
            await BSE.Bilibili.downloadAudioFile(audioData, this.state?.title || '音频');
            this.showToast(`音频文件已开始下载 (${bitrateKbps}kbps M4A)`, 'success');
          } catch (err) {
            this.showToast(`音频提取下载失败: ${err.message || '未知错误'}`, 'error');
          }
          return;
        }

        if (!this.state?.cues?.length) {
          this.showToast('暂无字幕可下载');
          return;
        }
        const extension = format === 'md' ? 'md' : format === 'srt' ? 'srt' : 'txt';
        const mime = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
        const meta = {
          title: this.state?.title || '字幕',
          url: this.state?.url || location.href,
          platform: this.state?.platform === 'bilibili' ? 'B站' : 'YouTube',
          language: this.state?.tracks?.find(t => String(t.id) === String(this.state.selectedTrackId))?.lanDoc || '中文'
        };
        const text = BSE.Formatters.format(format, this.state.cues, meta);
        BSE.Utils.downloadText(text, `${this.state.title || '字幕'}.${extension}`, mime);
        this.showToast(BSE.I18n?.t('export') + ' OK', 'success');
      });

      // Batch Export Trigger
      this.btnBatchExport.addEventListener('click', async () => {
        await this.openBatchModal();
      });

      // Batch Modal inside Shadow DOM
      this.batchClose.addEventListener('click', () => {
        if (this.batchControlTask?.running) {
          this.batchControlTask.cancelled = true;
          this.batchControlTask.controller?.abort();
        }
        this.batchOverlay.hidden = true;
      });

      queryInputs(this.shadow, 'input[name="rp-output"]').forEach((radio) => {
        radio.addEventListener('change', () => this.syncBatchOutputControls());
      });
      queryInputs(this.shadow, 'input[name="rp-format"]').forEach((radio) => {
        radio.addEventListener('change', () => this.syncBatchOutputControls());
      });
      this.syncBatchOutputControls();

      // Toolbar buttons
      this.shadow.querySelector('.batch-tree-btn-all')?.addEventListener('click', () => {
        queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => { cb.checked = true; });
        this.updateTreeSummaryAndScope();
      });

      this.shadow.querySelector('.batch-tree-btn-cur')?.addEventListener('click', () => {
        if (!this.currentTree) return;
        queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => {
          cb.checked = cb.dataset.bvid === this.currentTree.currentBvid;
        });
        this.updateTreeSummaryAndScope();
      });

      this.shadow.querySelector('.batch-tree-btn-none')?.addEventListener('click', () => {
        queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => { cb.checked = false; });
        this.updateTreeSummaryAndScope();
      });

      this.shadow.querySelector('.batch-tree-btn-invert')?.addEventListener('click', () => {
        queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => { cb.checked = !cb.checked; });
        this.updateTreeSummaryAndScope();
      });

      // Quick Range Apply Button
      this.shadow.querySelector('.rp-range-apply')?.addEventListener('click', () => {
        if (!this.currentTree) return;
        const start = Math.max(1, Number(this.batchRangeStart.value) || 1);
        const end = Math.min(this.currentTree.items.length, Number(this.batchRangeEnd.value) || this.currentTree.items.length);
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => {
          const idx = Number(cb.dataset.globalIndex);
          cb.checked = idx >= min && idx <= max;
        });
        this.updateTreeSummaryAndScope();
      });

      // Tree delegation
      this.batchTree.addEventListener('change', (e) => {
        const target = e.target instanceof HTMLInputElement ? e.target : null;
        if (!target) return;
        if (target.classList.contains('batch-tree-cb')) {
          this.updateTreeSummaryAndScope();
        } else if (target.classList.contains('batch-tree-sec-cb')) {
          const secKey = target.dataset.secKey || '';
          queryInputs(this.batchTree, `.batch-tree-cb[data-sec-key="${secKey}"]`).forEach((cb) => {
            cb.checked = target.checked;
          });
          this.updateTreeSummaryAndScope();
        } else if (target.classList.contains('batch-tree-video-cb')) {
          const bvid = target.dataset.bvid || '';
          queryInputs(this.batchTree, `.batch-tree-cb[data-bvid="${bvid}"]`).forEach((cb) => {
            cb.checked = target.checked;
          });
          this.updateTreeSummaryAndScope();
        }
      });

      this.batchTree.addEventListener('click', (e) => {
        const target = eventTargetElement(e);
        if (!target) return;

        const chevron = target.closest('.batch-tree-sec-chevron');
        if (chevron instanceof HTMLElement) {
          e.stopPropagation();
          const secGroup = chevron.closest('.batch-tree-sec-group');
          secGroup?.classList.toggle('collapsed');
          return;
        }

        const secBtn = target.closest('.batch-tree-sec-btn');
        if (secBtn instanceof HTMLElement) {
          e.stopPropagation();
          const secKey = secBtn.dataset.secKey;
          queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => {
            cb.checked = cb.dataset.secKey === secKey;
          });
          this.updateTreeSummaryAndScope();
          return;
        }
        const videoBtn = target.closest('.batch-tree-video-btn');
        if (videoBtn instanceof HTMLElement) {
          e.stopPropagation();
          const bvid = videoBtn.dataset.bvid;
          queryInputs(this.batchTree, '.batch-tree-cb').forEach((cb) => {
            cb.checked = cb.dataset.bvid === bvid;
          });
          this.updateTreeSummaryAndScope();
          return;
        }

        const itemNode = target.closest('.batch-tree-item-node');
        if (itemNode && !target.matches('input[type="checkbox"]')) {
          const cb = itemNode.querySelector('.batch-tree-cb');
          if (cb instanceof HTMLInputElement) {
            cb.checked = !cb.checked;
            this.updateTreeSummaryAndScope();
          }
        }
      });

      this.batchStart.addEventListener('click', async () => {
        if (!this.currentTree) return;
        const checkedCbs = queryInputs(this.batchTree, '.batch-tree-cb:checked');
        if (!checkedCbs.length) {
          this.showToast('请至少在目录中勾选 1 个分P');
          return;
        }

        const customIndices = new Set(checkedCbs.map((cb) => Number(cb.dataset.globalIndex)));
        const outputRadio = this.shadow.querySelector('input[name="rp-output"]:checked');
        const formatRadio = this.shadow.querySelector('input[name="rp-format"]:checked');
        const timestampRadio = this.shadow.querySelector('input[name="rp-timestamp"]:checked');
        const outputMode = outputRadio instanceof HTMLInputElement && ['merged-file', 'zip'].includes(outputRadio.value)
          ? /** @type {'merged-file'|'zip'} */ (outputRadio.value)
          : 'copy-text';
        let format = formatRadio instanceof HTMLInputElement && ['srt', 'txt', 'md'].includes(formatRadio.value)
          ? /** @type {'srt'|'txt'|'md'} */ (formatRadio.value)
          : 'md';
        if (outputMode === 'copy-text') format = 'txt';
        else if (outputMode === 'merged-file' && format === 'srt') format = 'md';
        const rawPreference = this.menuPref.value;
        const preference = ['manual-first', 'manual-only', 'ai-first'].includes(rawPreference)
          ? /** @type {'manual-first'|'manual-only'|'ai-first'} */ (rawPreference)
          : 'manual-first';
        const withTimestamp = timestampRadio instanceof HTMLInputElement && timestampRadio.value === 'true';

        /** @type {import('../types/bse').BatchConfig} */
        const config = {
          scope: 'custom',
          customIndices,
          outputMode,
          format,
          preference,
          withTimestamp
        };
        this.batchControlTask = {};
        this.batchProgressWrapper.hidden = false;
        this.batchStart.disabled = true;

        try {
          const exportResult = await BSE.Bilibili.runBatchExport(this.currentTree, config, (stats, currentItem, phase) => {
            if (phase === 'packing') {
              this.batchProgText.textContent = `打包中 (${stats.packPercent || 0}%)…`;
              this.batchBar.style.width = `${stats.packPercent || 0}%`;
            } else if (phase === 'building') {
              this.batchProgText.textContent = outputMode === 'copy-text'
                ? '正在整理可复制的合并全文…'
                : (outputMode === 'merged-file' ? '正在生成合并长文件…' : '正在整理打包清单…');
            } else if (phase === 'fetching') {
              const percent = Math.round((stats.completed / (stats.total || 1)) * 100);
              this.batchProgText.textContent = currentItem ? `读取中: ${currentItem.title}` : `抓取中 (${stats.completed}/${stats.total})`;
              this.batchBar.style.width = `${percent}%`;
            } else if (phase === 'done') {
              const completionVerb = outputMode === 'copy-text'
                ? '已整理为可复制全文'
                : (outputMode === 'merged-file' ? '已合并为长文件' : '已打包为 ZIP');
              const summaryText = stats.failed > 0 || stats.noSub > 0
                ? `任务完成：成功 ${stats.success} · 无字幕 ${stats.noSub} · 失败 ${stats.failed}`
                : `任务完成：${stats.success} 项字幕${completionVerb}`;
              this.batchProgText.textContent = summaryText;
              this.batchBar.style.width = '100%';
            }
          }, this.batchControlTask);

          if (exportResult?.cancelled) return;
          const finalStats = exportResult?.stats || {};
          if (outputMode === 'copy-text' && !finalStats.success) {
            throw new Error('所选视频没有可复制的字幕，请调整选择范围或字幕偏好');
          }
          await BSE.BatchExport.deliver(exportResult?.output, {
            writeText: (text) => navigator.clipboard.writeText(text),
            downloadText: (text, filename, mime) => BSE.Utils.downloadText(text, filename, mime),
            downloadBlob: (blob, filename) => BSE.Utils.downloadBlob(blob, filename)
          });

          const partial = finalStats.failed > 0 || finalStats.noSub > 0;
          const resultLabel = outputMode === 'copy-text'
            ? `已复制 ${finalStats.success || 0} 项字幕全文`
            : (outputMode === 'merged-file' ? '合并长文件已开始下载' : 'ZIP 已开始下载');
          this.showToast(partial
            ? `${resultLabel}；无字幕 ${finalStats.noSub || 0}，失败 ${finalStats.failed || 0}`
            : resultLabel);
          setTimeout(() => {
            this.batchOverlay.hidden = true;
            this.batchStart.disabled = false;
          }, 1800);
        } catch (err) {
          this.showToast(err.message || '批量导出失败');
        } finally {
          if (this.batchControlTask) this.batchControlTask.running = false;
          this.batchStart.disabled = false;
          this.syncBatchOutputControls();
        }
      });

      // Settings Subtitle Preference
      if (this.menuPref) {
        this.menuPref.addEventListener('change', () => {
          try {
            chrome?.storage?.sync?.set({ bseSubtitlePreference: this.menuPref.value });
          } catch {}
        });
      }

      // Settings Drawer Toggle
      this.settingsToggle.addEventListener('click', () => {
        const shouldClose = !this.settingsDrawer.hidden;
        this.settingsDrawer.hidden = shouldClose;
        this.settingsToggle.classList.toggle('active', !shouldClose);
        this.settingsToggle.setAttribute('aria-expanded', String(!shouldClose));
        if (!shouldClose) {
          this.searchDrawer.hidden = true;
          this.clearSearchHighlight();
        }
      });

      this.btnOpenSidebar.addEventListener('click', () => {
        this.actions.openSidePanel?.();
      });

      this.btnRefreshSub.addEventListener('click', () => {
        this.actions.refresh?.();
      });

      this.menuTheme.addEventListener('change', () => {
        BSE.I18n?.setTheme(this.menuTheme.value);
      });

      this.menuLang.addEventListener('change', () => {
        BSE.I18n?.setLocale(this.menuLang.value);
      });

      this.menuSize.addEventListener('change', () => {
        const size = this.menuSize.value;
        this.panel.style.setProperty('--bse-cue-font-size', `${size}px`);
        if (typeof chrome !== 'undefined' && chrome?.storage?.sync?.set) {
          try { chrome.storage.sync.set({ cueFontSize: size }).catch(() => {}); } catch {}
        }
      });

      this.searchToggle.addEventListener('click', () => this.toggleSearch());
      this.searchClose.addEventListener('click', () => this.toggleSearch(false));
      this.searchDebounceTimer = null;
      this.searchInput.addEventListener('input', () => {
        clearTimeout(this.searchDebounceTimer);
        const query = this.searchInput.value;
        if (!query.trim()) {
          this.clearSearchHighlight();
          return;
        }
        this.searchDebounceTimer = setTimeout(() => {
          this.performSearch(query);
        }, 100);
      });
      this.searchInput.addEventListener('keydown', (e) => {
        if (!(e instanceof KeyboardEvent)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) this.prevMatch();
          else this.nextMatch();
        } else if (e.key === 'Escape') {
          this.toggleSearch(false);
        }
      });
      this.searchPrev.addEventListener('click', () => this.prevMatch());
      this.searchNext.addEventListener('click', () => this.nextMatch());
      this.shadow.addEventListener('keydown', (e) => {
        if (!(e instanceof KeyboardEvent)) return;
        if (e.key === 'Escape') {
          if (!this.batchOverlay.hidden) {
            if (this.batchControlTask?.running) {
              this.batchControlTask.cancelled = true;
              this.batchControlTask.controller?.abort();
            }
            this.batchOverlay.hidden = true;
          }
          if (!this.searchDrawer.hidden) this.toggleSearch(false);
          if (!this.settingsDrawer.hidden) this.settingsDrawer.hidden = true;
          if (!this.aiDrawer.hidden) this.aiDrawer.hidden = true;
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          this.toggleSearch(true);
        }
      });

      const handleUserScrollInteraction = () => {
        if (!this.state?.cues?.length) return;
        this.programmaticScrolling = false;
        clearTimeout(this.programmaticScrollTimer);
        if (this.following) {
          this.following = false;
          this.updateFollowButton();
        }
      };

      this.list.addEventListener('wheel', handleUserScrollInteraction, { passive: true });
      this.list.addEventListener('touchstart', handleUserScrollInteraction, { passive: true });
      this.list.addEventListener('pointerdown', handleUserScrollInteraction, { passive: true });
      this.list.addEventListener('mousedown', handleUserScrollInteraction, { passive: true });
      this.list.addEventListener('scroll', () => {
        if (this.programmaticScrolling) {
          clearTimeout(this.programmaticScrollTimer);
          this.programmaticScrollTimer = setTimeout(() => {
            this.programmaticScrolling = false;
          }, 160);
          return;
        }
        handleUserScrollInteraction();
      }, { passive: true });
      this.list.addEventListener('click', async (event) => {
        const target = eventTargetElement(event);
        if (!target) return;
        const copyBtn = target.closest('.paragraph-copy');
        if (copyBtn) {
          event.stopPropagation();
          const paragraph = copyBtn.closest('.paragraph');
          if (paragraph) {
            const text = paragraph.querySelector('.paragraph-body')?.textContent || '';
            await navigator.clipboard.writeText(text);
            this.showToast(BSE.I18n?.t('copied_paragraph') || '已复制此段内容');
            return;
          }
        }

        const pTime = target.closest('.paragraph-time');
        if (pTime instanceof HTMLElement) {
          event.stopPropagation();
          const time = Number(pTime.dataset.time || 0);
          this.actions.seek?.(time);
          this.following = true;
          this.updateFollowButton();
          this.scrollToActive(false);
          return;
        }

        const selection = window.getSelection()?.toString();
        if (selection && selection.trim().length > 0) return;
        const cue = target.closest('.cue');
        if (!(cue instanceof HTMLElement)) return;
        this.actions.seek?.(Number(cue.dataset.time));
        this.following = true;
        this.updateFollowButton();
        this.scrollToActive(false);
      });
    }

    syncBatchOutputControls() {
      const outputRadio = this.shadow.querySelector('input[name="rp-output"]:checked');
      const mode = outputRadio instanceof HTMLInputElement && ['merged-file', 'zip'].includes(outputRadio.value)
        ? outputRadio.value
        : 'copy-text';
      const formatRadio = this.shadow.querySelector('input[name="rp-format"]:checked');
      const formatRow = this.shadow.querySelector('.rp-format-row');
      const formatLabel = this.shadow.querySelector('.rp-format-label');
      const srtOption = this.shadow.querySelector('.rp-format-srt');
      const timestampRow = this.shadow.querySelector('.rp-timestamp-row');
      const allowSrt = mode === 'zip';

      if (formatRow instanceof HTMLElement) formatRow.hidden = mode === 'copy-text';
      if (formatLabel) formatLabel.textContent = allowSrt ? 'ZIP 内单文件格式' : '合并文件格式';
      if (srtOption instanceof HTMLElement) srtOption.hidden = !allowSrt;
      if (!allowSrt && formatRadio instanceof HTMLInputElement && formatRadio.value === 'srt') {
        const mdInput = this.shadow.querySelector('input[name="rp-format"][value="md"]');
        if (mdInput instanceof HTMLInputElement) mdInput.checked = true;
      }

      const activeFormat = this.shadow.querySelector('input[name="rp-format"]:checked');
      const showTimestamp = mode !== 'zip' || !(activeFormat instanceof HTMLInputElement) || activeFormat.value !== 'srt';
      if (timestampRow instanceof HTMLElement) timestampRow.hidden = !showTimestamp;

      const checkedCount = queryInputs(this.batchTree, '.batch-tree-cb:checked').length;
      if (!this.batchControlTask?.running) {
        this.batchStart.disabled = checkedCount === 0 && Boolean(this.currentTree);
        this.batchStart.textContent = mode === 'copy-text'
          ? `复制 ${checkedCount || ''} 项字幕`.replace(/\s+/g, ' ').trim()
          : (mode === 'merged-file' ? '下载合并长文件' : '导出独立文件 ZIP');
      }
    }

    updateTreeSummaryAndScope() {
      if (!this.currentTree || !this.batchTree) return;
      const allCbs = queryInputs(this.batchTree, '.batch-tree-cb');
      const checkedCbs = allCbs.filter((cb) => cb.checked);
      const total = allCbs.length;
      const checkedCount = checkedCbs.length;

      let totalSec = 0;
      checkedCbs.forEach(cb => {
        totalSec += Number(cb.dataset.duration) || 0;
      });

      const summaryEl = this.shadow.querySelector('.batch-tree-selected-summary');
      if (summaryEl) {
        const durLabel = totalSec > 0 ? ` · 约 ${BSE.Utils.formatClock(totalSec)}` : '';
        summaryEl.textContent = checkedCount === total
          ? `已全选 (${total} 集${durLabel})`
          : `已选 ${checkedCount} / ${total} 集${durLabel}`;
      }

      // Sync section checkboxes (checked, unchecked, indeterminate)
      queryInputs(this.batchTree, '.batch-tree-sec-cb').forEach((secCb) => {
        const secKey = secCb.dataset.secKey || '';
        const childCbs = queryInputs(this.batchTree, `.batch-tree-cb[data-sec-key="${secKey}"]`);
        const checkedChildren = childCbs.filter((c) => c.checked).length;
        if (checkedChildren === 0) {
          secCb.checked = false;
          secCb.indeterminate = false;
        } else if (checkedChildren === childCbs.length) {
          secCb.checked = true;
          secCb.indeterminate = false;
        } else {
          secCb.checked = false;
          secCb.indeterminate = true;
        }
      });

      // Sync video checkboxes
      queryInputs(this.batchTree, '.batch-tree-video-cb').forEach((vCb) => {
        const bvid = vCb.dataset.bvid || '';
        const childCbs = queryInputs(this.batchTree, `.batch-tree-cb[data-bvid="${bvid}"]`);
        const checkedChildren = childCbs.filter((c) => c.checked).length;
        if (checkedChildren === 0) {
          vCb.checked = false;
          vCb.indeterminate = false;
        } else if (checkedChildren === childCbs.length) {
          vCb.checked = true;
          vCb.indeterminate = false;
        } else {
          vCb.checked = false;
          vCb.indeterminate = true;
        }
      });
      this.syncBatchOutputControls();
    }

    generateTreeHtml(tree) {
      let html = '';
      const hasMultipleSections = (tree.sections || []).length > 1;

      tree.sections.forEach((sec, sIdx) => {
        const countLabel = tree.hasNestedPages ? `${sec.items.length} 个分P` : `${sec.items.length} 集`;
        html += `
          <div class="batch-tree-sec-group" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
            <div class="batch-tree-sec-node" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
              <label class="batch-tree-sec-label">
                <span class="batch-tree-sec-chevron" data-sec-toggle="${BSE.Utils.escapeHtml(sec.key)}" title="折叠/展开分组">▼</span>
                <input type="checkbox" class="batch-tree-sec-cb" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
                <span>${hasMultipleSections ? `第 ${sIdx + 1} 章 · ` : ''}${BSE.Utils.escapeHtml(sec.title)}</span>
              </label>
              <div class="batch-tree-sec-actions">
                <span class="batch-tree-node-meta">${countLabel}</span>
                <button type="button" class="batch-tree-sec-btn" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">选此组</button>
              </div>
            </div>
            <div class="batch-tree-sec-children">
        `;

        (sec.episodes || []).forEach((ep) => {
          const isMultiP = ep.pagesCount > 1;
          if (isMultiP) {
            html += `
              <div class="batch-tree-video-node" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}">
                <label class="batch-tree-video-label">
                  <input type="checkbox" class="batch-tree-video-cb" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}" checked>
                  <span>视频 ${ep.index}：${BSE.Utils.escapeHtml(ep.title)}</span>
                </label>
                <div class="batch-tree-sec-actions">
                  <span class="batch-tree-node-meta">${ep.pagesCount} P</span>
                  <button type="button" class="batch-tree-video-btn" data-bvid="${BSE.Utils.escapeHtml(ep.bvid)}">选此视频</button>
                </div>
              </div>
            `;
            (ep.items || []).forEach((item) => {
              const isCur = item.bvid === tree.currentBvid && item.page === (tree.currentPage || 1);
              const durText = item.duration ? BSE.Utils.formatClock(item.duration) : '';
              const pLabel = item.part ? `P${item.page || 1} ${item.part}` : `P${item.page || 1}`;
              html += `
                <div class="batch-tree-item-node sub-p${isCur ? ' active' : ''}" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
                  <label class="batch-tree-item-label" title="${BSE.Utils.escapeHtml(item.title)}">
                    <input type="checkbox" class="batch-tree-cb" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
                    <span class="batch-tree-item-text">
                      <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> <strong>${BSE.Utils.escapeHtml(pLabel)}</strong>
                      ${isCur ? '<span class="batch-tree-tag-cur">当前播放</span>' : ''}
                    </span>
                  </label>
                  ${durText ? `<span class="batch-tree-node-meta">${durText}</span>` : ''}
                </div>
              `;
            });
          } else {
            const item = ep.items?.[0] || { globalIndex: 1, duration: 0, title: ep.title, bvid: ep.bvid, page: 1 };
            const isCur = item.bvid === tree.currentBvid;
            const durText = item.duration ? BSE.Utils.formatClock(item.duration) : '';
            html += `
              <div class="batch-tree-item-node single-ep${isCur ? ' active' : ''}" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}">
                <label class="batch-tree-item-label" title="${BSE.Utils.escapeHtml(item.title)}">
                  <input type="checkbox" class="batch-tree-cb" data-global-index="${item.globalIndex}" data-duration="${item.duration || 0}" data-bvid="${BSE.Utils.escapeHtml(item.bvid)}" data-sec-key="${BSE.Utils.escapeHtml(sec.key)}" checked>
                  <span class="batch-tree-item-text">
                    <span class="batch-tree-item-idx">#${String(item.globalIndex).padStart(2, '0')}</span> ${BSE.Utils.escapeHtml(ep.title)}
                    ${isCur ? '<span class="batch-tree-tag-cur">当前播放</span>' : ''}
                  </span>
                </label>
                ${durText ? `<span class="batch-tree-node-meta">${durText}</span>` : ''}
              </div>
            `;
          }
        });

        html += `
            </div>
          </div>
        `;
      });
      return html;
    }

    async openBatchModal() {
      try {
        const bvid = BSE.Utils.getBvid(location.href);
        if (!bvid) {
          this.showToast('未识别到 B 站视频 BV 号');
          return;
        }
        if (this.batchControlTask?.running) {
          this.batchControlTask.cancelled = true;
          this.batchControlTask.controller?.abort();
        }
        this.batchControlTask = null;
        this.currentTree = null;
        this.batchOverlay.hidden = false;
        this.batchProgressWrapper.hidden = true;
        this.batchProgText.textContent = '准备开始…';
        this.batchBar.style.width = '0%';
        this.batchStart.disabled = true;
        this.batchStart.textContent = '正在读取目录…';
        this.batchSummary.textContent = '正在读取合集架构…';
        this.currentTree = await BSE.Bilibili.fetchMediaTree(bvid);
        this.batchSummary.textContent = `${this.currentTree.title} · 共 ${this.currentTree.items.length} 个分P`;

        // Initialize quick range inputs
        this.batchRangeStart.max = String(this.currentTree.items.length);
        this.batchRangeStart.value = '1';
        this.batchRangeEnd.max = String(this.currentTree.items.length);
        this.batchRangeEnd.value = String(this.currentTree.items.length);

        this.batchTree.innerHTML = this.generateTreeHtml(this.currentTree);

        // Auto-scroll to active episode
        const activeEp = this.batchTree.querySelector('.batch-tree-item-node.active');
        if (activeEp) {
          setTimeout(() => activeEp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
        }

        this.updateTreeSummaryAndScope();
      } catch (err) {
        this.showToast(err.message || '加载合集失败');
        this.batchOverlay.hidden = true;
      }
    }

    showToast(message, type = 'info') {
      if (!this.toastEl) return;
      const text = String(message || '').replace(/^(?:\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|\s)+/gu, '');
      const isError = type === 'error' || text.includes('失败') || text.includes('错误');
      const isSuccess = !isError && (type === 'success' || text.includes('已复制') || text.includes('完成') || text.includes('成功') || text.includes('OK'));

      this.toastEl.textContent = text;
      this.toastEl.className = `toast show ${isError ? 'error' : (isSuccess ? 'success' : 'info')}`;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2200);
    }

    toggleSearch(forceOpen) {
      const isHidden = typeof forceOpen === 'boolean' ? !forceOpen : !this.searchDrawer.hidden;
      this.searchDrawer.hidden = isHidden;
      if (!isHidden) {
        this.searchInput.focus();
        this.searchInput.select();
        if (this.searchInput.value) this.performSearch(this.searchInput.value);
      } else {
        this.clearSearchHighlight();
      }
    }

    clearSearchHighlight() {
      this.searchMatches = [];
      this.currentMatchIndex = -1;
      if (this.searchBadge) this.searchBadge.textContent = '';
      const marks = this.list.querySelectorAll('mark.search-match');
      if (!marks.length) return;
      const affectedCues = new Set();
      marks.forEach((m) => {
        const parentCue = m.closest('.cue');
        if (parentCue) affectedCues.add(parentCue);
        const text = m.textContent;
        m.replaceWith(document.createTextNode(text));
      });
      affectedCues.forEach((cue) => cue.normalize());
    }

    performSearch(rawQuery) {
      this.clearSearchHighlight();
      const query = rawQuery.trim();
      this.searchQuery = query;
      if (!query) return;

      const cues = this.list.querySelectorAll('.cue');
      const matches = [];
      const lowerQuery = query.toLowerCase();

      cues.forEach((cue) => {
        const text = cue.textContent || '';
        const lowerText = text.toLowerCase();
        let idx = lowerText.indexOf(lowerQuery);
        if (idx === -1) return;

        let node = cue.firstChild;
        while (node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const nodeText = node.textContent || '';
            const lowerNodeText = nodeText.toLowerCase();
            const matchIndex = lowerNodeText.indexOf(lowerQuery);
            if (matchIndex !== -1) {
              const before = nodeText.slice(0, matchIndex);
              const matchStr = nodeText.slice(matchIndex, matchIndex + query.length);
              const after = nodeText.slice(matchIndex + query.length);

              const mark = document.createElement('mark');
              mark.className = 'search-match';
              mark.textContent = matchStr;
              matches.push(mark);

              const frag = document.createDocumentFragment();
              if (before) frag.appendChild(document.createTextNode(before));
              frag.appendChild(mark);
              if (after) frag.appendChild(document.createTextNode(after));

              const nextNode = frag.lastChild;
              node.replaceWith(frag);
              node = nextNode;
            }
          }
          node = node.nextSibling;
        }
      });

      this.searchMatches = matches;
      if (matches.length > 0) {
        this.currentMatchIndex = 0;
        this.highlightCurrentMatch();
      } else {
        this.searchBadge.textContent = '0/0';
      }
    }

    highlightCurrentMatch() {
      this.searchMatches.forEach((m, idx) => {
        m.classList.toggle('current', idx === this.currentMatchIndex);
      });
      this.searchBadge.textContent = `${this.currentMatchIndex + 1}/${this.searchMatches.length}`;
      const current = this.searchMatches[this.currentMatchIndex];
      if (current) {
        current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    nextMatch() {
      if (!this.searchMatches.length) return;
      this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
      this.highlightCurrentMatch();
    }

    prevMatch() {
      if (!this.searchMatches.length) return;
      this.currentMatchIndex = (this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
      this.highlightCurrentMatch();
    }

    applyTheme(theme) {
      if (theme === 'light') {
        this.panel.dataset.theme = 'light';
      } else if (theme === 'dark') {
        this.panel.dataset.theme = 'dark';
      } else if (theme === 'bilibili') {
        this.panel.dataset.theme = 'bilibili';
      } else if (theme === 'youtube') {
        this.panel.dataset.theme = 'youtube';
      } else {
        const systemLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
        this.panel.dataset.theme = systemLight ? 'light' : 'dark';
      }
    }

    applyI18nAndTheme() {
      const theme = BSE.I18n?.getTheme() || 'auto';
      const effectiveLocale = BSE.I18n?.getLocale?.() || 'zh-CN';
      const t = (key) => BSE.I18n?.t(key) || key;
      if (this.panel) this.panel.lang = effectiveLocale;
      const setOption = (select, value, text) => {
        const option = Array.from(select?.options || []).find((entry) => entry.value === value);
        if (option) option.textContent = text;
      };
      this.applyTheme(theme);
      if (this.menuTheme) {
        this.menuTheme.value = theme;
        this.menuTheme.setAttribute('aria-label', t('theme_label'));
        setOption(this.menuTheme, 'auto', t('theme_auto'));
        setOption(this.menuTheme, 'dark', t('theme_dark'));
        setOption(this.menuTheme, 'light', t('theme_light'));
        setOption(this.menuTheme, 'bilibili', t('theme_bilibili'));
        setOption(this.menuTheme, 'youtube', t('theme_youtube'));
      }
      if (this.menuLang) {
        this.menuLang.value = BSE.I18n?.getLocalePreference?.() || BSE.I18n?.getLocale() || 'auto';
        this.menuLang.setAttribute('aria-label', t('lang_label'));
        setOption(this.menuLang, 'auto', t('lang_auto'));
        setOption(this.menuLang, 'zh-CN', t('lang_zh_cn'));
        setOption(this.menuLang, 'zh-TW', t('lang_zh_tw'));
        setOption(this.menuLang, 'en', t('lang_en'));
      }
      if (this.menuPref) {
        this.menuPref.setAttribute('aria-label', t('pref_subtitle_label'));
        setOption(this.menuPref, 'manual-first', t('batch_pref_manual_first'));
        setOption(this.menuPref, 'manual-only', t('batch_pref_manual_only'));
        setOption(this.menuPref, 'ai-first', t('batch_pref_ai_first'));
      }
      if (this.menuSize) {
        this.menuSize.setAttribute('aria-label', t('pref_size_label'));
        setOption(this.menuSize, '13', t('size_small'));
        setOption(this.menuSize, '14.5', t('size_medium'));
        setOption(this.menuSize, '16.5', t('size_large'));
      }
      const themeLabel = this.shadow.querySelector('#rp-label-theme');
      const langLabel = this.shadow.querySelector('#rp-label-lang');
      const prefLabel = this.shadow.querySelector('#rp-label-pref');
      const sizeLabel = this.shadow.querySelector('#rp-label-size');
      if (themeLabel) themeLabel.textContent = t('theme_label');
      if (langLabel) langLabel.textContent = t('lang_label');
      if (prefLabel) prefLabel.textContent = t('pref_subtitle_label');
      if (sizeLabel) sizeLabel.textContent = t('pref_size_label');
      if (this.settingsToggle) {
        this.settingsToggle.title = t('settings_title');
        this.settingsToggle.setAttribute('aria-label', t('settings_title'));
      }
      if (this.btnBatchExport) {
        this.btnBatchExport.hidden = this.platform !== BSE.PLATFORM.BILIBILI;
      }
    }

    updateCollapsed() {
      this.panel.classList.toggle('collapsed', this.collapsed);
      this.collapseButton.title = this.collapsed ? (BSE.I18n?.t('expand_panel') || '展开字幕面板') : (BSE.I18n?.t('collapse_panel') || '收起字幕面板');
      this.collapseButton.innerHTML = this.collapsed
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      if (this.platform === BSE.PLATFORM.BILIBILI) {
        const spacerHeight = this.collapsed ? 48 : (parseInt(this.panel.style.height || '420', 10) + 14);
        document.documentElement.style.setProperty('--bse-injected-spacer-height', `${spacerHeight}px`);
      }
    }

    updateFollowButton() {
      this.followButton.classList.toggle('active', this.following);
      this.followButton.textContent = this.following ? (BSE.I18n?.t('follow') || '跟随') : (BSE.I18n?.t('resume_follow') || '恢复跟随');
    }

    ensureRootMounted(platform) {
      if (platform) this.platform = platform;
      this.applyI18nAndTheme();

      if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
        if (this.wrapper) this.wrapper.style.display = 'none';
        const extRoot = document.getElementById('bse-extension-root');
        if (extRoot) extRoot.style.display = 'none';
        return;
      }
      if (this.wrapper) this.wrapper.style.display = 'block';
      const extRoot = document.getElementById('bse-extension-root');
      if (extRoot) extRoot.style.display = 'block';

      if (this.platform === BSE.PLATFORM.YOUTUBE) {
        const secondary = document.querySelector('#secondary-inner, #secondary, ytd-watch-next-secondary-results-renderer');
        if (secondary) {
          if (this.wrapper.parentElement !== secondary) {
            this.wrapper.style.cssText = 'width:100%;box-sizing:border-box;margin:0 0 12px 0;border-radius:6px;position:relative;z-index:10;display:block;';
            secondary.prepend(this.wrapper);
          }
          return;
        }
      }

      // Inject dynamic CSS spacer for Bilibili to push down native right column content smoothly
      if (this.platform === BSE.PLATFORM.BILIBILI) {
        let styleEl = document.getElementById('bse-bilibili-spacer-style');
        if (!styleEl && document.head) {
          styleEl = document.createElement('style');
          styleEl.id = 'bse-bilibili-spacer-style';
          styleEl.textContent = `
            #right-bottom-banner > .up-panel-container + *,
            .right-container > .up-panel-container + *,
            .right-container-inner > .up-panel-container + *,
            #right-bottom-banner > .up-info-container + *,
            .right-container > .up-info-container + *,
            .right-container-inner > .up-info-container + *,
            .r-con > .up-panel-container + *,
            .grid-right > .up-panel-container + *,
            #right-bottom-banner:not(:has(.up-panel-container)):not(:has(.up-info-container)) > *:first-child,
            .right-container:not(:has(.up-panel-container)):not(:has(.up-info-container)) > *:first-child,
            .grid-right:not(:has(.up-panel-container)):not(:has(.up-info-container)) > *:first-child {
              margin-top: var(--bse-injected-spacer-height, 0px) !important;
              transition: margin-top 0.15s ease-out;
            }
          `;
          document.head.appendChild(styleEl);
        }
      }

      // For Bilibili & standalone: Mount permanently into independent root on document.body
      let root = document.getElementById('bse-extension-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'bse-extension-root';
        root.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:100%;pointer-events:none;z-index:1000;display:block;';
        document.body.appendChild(root);
      }
      if (!this.wrapper.parentElement || this.wrapper.parentElement !== root) {
        this.wrapper.style.pointerEvents = 'auto';
        root.appendChild(this.wrapper);
      }
    }

    ensureMounted(platform) {
      this.ensureRootMounted(platform);
      this.syncLayout();
    }

    applyHeight(rawHeight) {
      if (!this.panel?.style || !rawHeight || rawHeight < 150) return;
      const targetHeight = Math.round(rawHeight);
      this.panel.style.setProperty('--bse-panel-height', `${targetHeight}px`);
      this.panel.style.setProperty('--bse-panel-max-height', `${targetHeight}px`);
      this.panel.style.height = `${targetHeight}px`;
      this.panel.style.maxHeight = `${targetHeight}px`;
    }

    syncLayout() {
      if (!this.panel?.style) return;
      if (!BSE.Utils.isMatchingVideoUrl(location.href)) {
        if (this.wrapper) this.wrapper.style.display = 'none';
        const extRoot = document.getElementById('bse-extension-root');
        if (extRoot) extRoot.style.display = 'none';
        return;
      }
      this.ensureRootMounted(this.platform);

      if (this.platform === BSE.PLATFORM.YOUTUBE) {
        const selectors = [
          '#movie_player',
          '.html5-video-player',
          'ytd-watch-flexy #player-container',
          'ytd-watch-flexy #player',
          '#player-container',
          'video'
        ];
        let player = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.clientHeight > 150 && el.isConnected) {
            player = el;
            break;
          }
        }
        const video = document.querySelector('video');
        const targetToObserve = player || (video?.isConnected ? video : null);

        if (this.resizeObserver) {
          if (!targetToObserve || (this.observedPlayer && !this.observedPlayer.isConnected)) {
            this.resizeObserver.disconnect();
            this.observedPlayer = null;
          }
          if (targetToObserve && targetToObserve !== this.observedPlayer) {
            try {
              this.resizeObserver.disconnect();
              this.resizeObserver.observe(targetToObserve);
              this.observedPlayer = targetToObserve;
            } catch (_) {}
          }
        }

        if (targetToObserve && targetToObserve.isConnected) {
          const height = targetToObserve.clientHeight || targetToObserve.getBoundingClientRect?.()?.height || 0;
          if (height > 150) {
            this.applyHeight(height);
          }
        }
        return;
      }

      // === For Bilibili: High-Precision Read-Only DOM Measurement + Responsive Geometry Sync ===
      const legacyDocument = /** @type {Document & { webkitFullscreenElement?: Element | null }} */ (document);
      const isFullscreen = Boolean(document.fullscreenElement || legacyDocument.webkitFullscreenElement);
      if (isFullscreen) {
        if (this.wrapper) this.wrapper.style.display = 'none';
        document.documentElement.classList.remove('bse-docked');
        document.documentElement.style.removeProperty('--bse-injected-spacer-height');
        return;
      }

      const videoWrap = document.querySelector('.bpx-player-container')
        || document.querySelector('#bilibili-player')
        || document.querySelector('.festival-video-player')
        || document.querySelector('.video-player-box')
        || document.querySelector('.bpx-player-video-wrap')
        || document.querySelector('#playerWrap')
        || document.querySelector('video');

      const rightCol = document.querySelector('#right-bottom-banner')
        || document.querySelector('.right-container')
        || document.querySelector('.right-container-inner')
        || document.querySelector('#mirror-vdcon .right-container')
        || document.querySelector('.video-container-v1 .right-container')
        || document.querySelector('.v-wrap .r-con')
        || document.querySelector('.grid-box .grid-right')
        || document.querySelector('.grid-right')
        || document.querySelector('.festival-main-panel .grid-right')
        || document.querySelector('.page-main-content .grid-right');

      const upCard = document.querySelector('#right-bottom-banner .up-panel-container')
        || document.querySelector('.up-panel-container')
        || document.querySelector('.up-info-container')
        || document.querySelector('.up-detail')
        || document.querySelector('.membersinfo-up')
        || document.querySelector('.user-card-m-v1');

      if (!videoWrap) {
        if (this.wrapper) this.wrapper.style.display = 'none';
        document.documentElement.classList.remove('bse-docked');
        document.documentElement.style.removeProperty('--bse-injected-spacer-height');
        return;
      }

      const videoRect = videoWrap.getBoundingClientRect();
      const rightRect = rightCol ? rightCol.getBoundingClientRect() : null;
      const upRect = upCard ? upCard.getBoundingClientRect() : null;

      if (videoRect.width <= 0 || videoRect.height <= 0) {
        if (this.wrapper) this.wrapper.style.display = 'none';
        document.documentElement.classList.remove('bse-docked');
        document.documentElement.style.removeProperty('--bse-injected-spacer-height');
        return;
      }

      // Check if layout is truly dual-column (side-by-side horizontally) vs single-column/widescreen
      const isSideBySide = Boolean(
        rightRect &&
        rightRect.width > 200 &&
        (rightRect.left >= videoRect.left + 150)
      );
      const isWidescreen = Boolean(
        document.querySelector('.player-mode-widescreen, .mode-widescreen, .wide')
        || !isSideBySide
      );

      this.wrapper.style.display = 'block';
      this.wrapper.style.position = 'absolute';

      let topPos = 0;
      let leftPos = 0;
      let width = 0;
      let targetHeight = 0;

      this.lastLayout = this.lastLayout || { top: -1, left: -1, width: -1, height: -1, spacer: -1, display: '', docked: false };

      if (!isWidescreen && rightRect && rightRect.width > 200) {
        // Standard Dual-Column Mode: Align perfectly with right column
        leftPos = window.scrollX + rightRect.left;
        width = rightRect.width;

        if (upRect && upRect.bottom > 0 && upRect.bottom < videoRect.bottom - 80) {
          // Dock directly under UP card, extend all the way down to video player bottom
          topPos = window.scrollY + upRect.bottom + 8;
          const availableHeight = (window.scrollY + videoRect.bottom) - topPos;
          targetHeight = Math.max(260, Math.round(availableHeight));
        } else {
          // If no UP card, align directly with video top & full video height
          topPos = window.scrollY + videoRect.top;
          targetHeight = Math.max(260, Math.round(videoRect.height));
        }

        if (!this.lastLayout.docked) {
          document.documentElement.classList.add('bse-docked');
          this.lastLayout.docked = true;
        }
        const spacerHeight = this.collapsed ? 48 : (targetHeight + 14);
        if (this.lastLayout.spacer !== spacerHeight) {
          document.documentElement.style.setProperty('--bse-injected-spacer-height', `${spacerHeight}px`);
          this.lastLayout.spacer = spacerHeight;
        }
      } else {
        // Widescreen / Below-Video Mode: Flow cleanly below player
        if (this.lastLayout.docked) {
          document.documentElement.classList.remove('bse-docked');
          document.documentElement.style.removeProperty('--bse-injected-spacer-height');
          this.lastLayout.docked = false;
          this.lastLayout.spacer = 0;
        }

        if (rightRect && rightRect.width > 200) {
          leftPos = window.scrollX + rightRect.left;
          width = rightRect.width;
          topPos = window.scrollY + rightRect.top;
          targetHeight = 420;
        } else {
          leftPos = window.scrollX + videoRect.left;
          width = Math.min(videoRect.width, 800);
          topPos = window.scrollY + videoRect.bottom + 12;
          targetHeight = 380;
        }
      }

      const topRounded = Math.round(topPos);
      const leftRounded = Math.round(leftPos);
      const widthRounded = Math.round(width);

      if (this.lastLayout.display !== 'block') {
        this.wrapper.style.display = 'block';
        this.lastLayout.display = 'block';
      }
      if (this.lastLayout.top !== topRounded) {
        this.wrapper.style.top = `${topRounded}px`;
        this.lastLayout.top = topRounded;
      }
      if (this.lastLayout.left !== leftRounded) {
        this.wrapper.style.left = `${leftRounded}px`;
        this.lastLayout.left = leftRounded;
      }
      if (this.lastLayout.width !== widthRounded) {
        this.wrapper.style.width = `${widthRounded}px`;
        this.lastLayout.width = widthRounded;
      }
      if (this.lastLayout.height !== targetHeight) {
        this.applyHeight(targetHeight);
        this.lastLayout.height = targetHeight;
      }

      if (this.resizeObserver) {
        const targetToObserve = videoWrap;
        if (targetToObserve && targetToObserve !== this.observedPlayer) {
          try {
            this.resizeObserver.disconnect();
            this.resizeObserver.observe(targetToObserve);
            if (rightCol && rightCol !== targetToObserve) {
              this.resizeObserver.observe(rightCol);
            }
            this.observedPlayer = targetToObserve;
          } catch (_) {}
        }
      }
    }

    formatParagraphTime(seconds) {
      if (BSE.I18n) return BSE.I18n.formatTimeSpan(seconds);
      const total = Math.max(0, Math.floor(Number(seconds || 0)));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      if (mins === 0) return `${secs}秒`;
      if (secs === 0) return `${mins}分钟`;
      return `${mins}分${secs}秒`;
    }

    buildParagraphs(cues) {
      const paragraphs = [];
      let currentCues = [];
      let currentLength = 0;
      let paragraphStartTime = 0;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const text = String(cue.content || '').trim();
        if (!text) continue;

        if (currentCues.length === 0) {
          paragraphStartTime = cue.from;
        }

        currentCues.push({ ...cue, index: i });
        currentLength += text.length;

        const nextCue = cues[i + 1];
        const timeGap = nextCue ? Math.max(0, nextCue.from - cue.to) : 0;
        const timeSpan = nextCue ? Math.max(0, nextCue.from - paragraphStartTime) : 0;
        const isSentenceEnd = /[。！？!?；;]$|\.\s*$/.test(text);

        const shouldBreak = !nextCue
          || (timeGap >= 3.8 && currentLength >= 90)
          || (isSentenceEnd && (currentLength >= 220 || timeSpan >= 40))
          || currentLength >= 380
          || timeSpan >= 70;

        if (shouldBreak) {
          paragraphs.push({
            from: paragraphStartTime,
            cues: currentCues
          });
          currentCues = [];
          currentLength = 0;
        }
      }
      return paragraphs;
    }

    renderState(state) {
      this.state = state;
      this.ensureMounted(state.platform);
      this.dot.className = `dot ${state.status || 'idle'}`;
      this.dot.title = state.message || (BSE.I18n?.t('status_ready') || '准备中…');
      const busy = state.status === 'loading' || Boolean(state.isRefreshing);
      if (this.refreshButton) {
        this.refreshButton.disabled = busy;
        this.refreshButton.classList.toggle('busy', busy);
        this.refreshButton.setAttribute('aria-busy', String(busy));
      }

      const tracks = state.tracks || [];
      const autoDoc = BSE.I18n?.t('auto_generated') || '自动';
      const ccDoc = BSE.I18n?.t('cc_track') || 'CC';
      const selected = String(state.selectedTrackId || '');

      if (tracks.length > 0) {
        this.trackSelect.replaceChildren(...tracks.map((track) => {
          const option = document.createElement('option');
          option.value = String(track.id);
          const tag = track.isTranslated ? '翻译' : (track.isAuto ? autoDoc : ccDoc);
          option.textContent = track.isTranslated
            ? (track.lanDoc || track.lan)
            : `${track.lanDoc || track.lan || 'Default'}（${tag}）`;
          option.selected = option.value === selected;
          return option;
        }));
        this.trackSelect.disabled = state.status === 'loading';
      } else {
        const noTrackOpt = document.createElement('option');
        noTrackOpt.value = '';
        noTrackOpt.textContent = state.status === 'loading'
          ? (BSE.I18n?.t('status_loading') || '正在解析字幕…')
          : (BSE.I18n?.t('no_subtitles') || '暂无可用字幕');
        noTrackOpt.disabled = true;
        noTrackOpt.selected = true;
        this.trackSelect.replaceChildren(noTrackOpt);
        this.trackSelect.disabled = true;
      }

      const hasCues = state.status !== 'empty' && state.status !== 'error' && Array.isArray(state.cues) && state.cues.length > 0;
      this.list.hidden = !hasCues;
      this.empty.hidden = hasCues;
      if (!hasCues) {
        this.list.replaceChildren();
        this.renderedMediaKey = null;
        this.activeIndex = -1;
        const isError = state.status === 'error';
        const isEmpty = state.status === 'empty';
        const isLoading = state.status === 'loading';

        let iconSvg = '';
        let title = '';
        let hint = '';

        if (isError) {
          iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
          title = state.message || '字幕解析失败';
          hint = state.lastError?.hint || '请检查网络或重新刷新尝试';
        } else if (isEmpty) {
          iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="2" y1="2" x2="22" y2="22"/><line x1="7" y1="15" x2="11" y2="15"/></svg>`;
          title = state.message || (BSE.I18n?.t('no_subtitles') || '当前视频没有可用字幕');
          hint = '该视频/分P未包含官方字幕或自动生成的字幕轨道';
        } else if (isLoading) {
          iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1.2s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;
          title = state.message || (BSE.I18n?.t('status_loading') || '正在解析字幕…');
          hint = '正在等待视频播放器与字幕轨道就绪…';
        } else {
          iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;
          title = BSE.I18n?.t('waiting_cues') || '正在等待字幕…';
          hint = BSE.I18n?.t('empty_cue_list') || '打开视频后，字幕将自动在这里同步显示';
        }

        const retryText = BSE.I18n?.t('btn_reload') || '↻ 重新获取';
        const diagText = BSE.I18n?.t('diagnostics_title') || '查看诊断';

        this.empty.innerHTML = `
          <div class="empty-icon-wrap ${isError ? 'error' : (isEmpty ? 'empty' : (isLoading ? 'loading' : ''))}">
            ${iconSvg}
          </div>
          <div class="empty-title">${BSE.Utils.escapeHtml(title)}</div>
          <div class="empty-desc">${BSE.Utils.escapeHtml(hint)}</div>
          ${isEmpty ? `
            <div class="empty-actions">
              <button class="empty-btn btn-transcribe-asr" type="button" title="直接使用 SparkScribe 对当前视频进行本地离线转录，不复用其他页面或平台字幕缓存">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                <span>获取字幕 / 转文字</span>
              </button>
              <div class="empty-sub-actions">
                <button class="empty-btn btn-retry" type="button">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  <span>重新获取</span>
                </button>
                <button class="empty-btn btn-diag" type="button">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>诊断信息</span>
                </button>
              </div>
            </div>
          ` : (isError ? `
            <div class="empty-actions">
              <div class="empty-sub-actions">
                <button class="empty-btn btn-retry" type="button">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  <span>重新获取</span>
                </button>
                <button class="empty-btn btn-diag" type="button">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>诊断信息</span>
                </button>
              </div>
            </div>
          ` : '')}
        `;
        if (isEmpty) {
          this.empty.querySelector('.btn-transcribe-asr')?.addEventListener('click', async () => {
            try {
              const mediaKey = String(this.state?.mediaKey || '').trim();
              const stateMatchesCurrentVideo = BSE.Utils?.mediaStateMatchesUrl?.(this.state, window.location.href) === true;
              if (!mediaKey || !stateMatchesCurrentVideo) {
                this.showToast('当前视频身份仍在切换，请等待播放器稳定后再点离线转录');
                return;
              }
              this.showToast('正在为当前视频启动 SparkScribe 离线转录…');
              const res = await chrome.runtime.sendMessage({
                type: 'BSE_QUEUE_ENQUEUE',
                urls: [{
                  url: window.location.href,
                  mediaKey,
                  processingIntent: 'local-asr'
                }],
                options: { sourceLanguage: 'auto', processingIntent: 'local-asr' }
              });
              if (res?.ok) {
                chrome.runtime.sendMessage({ type: 'BSE_ORCHESTRATOR_NOTIFY' }).catch(() => {});
                chrome.runtime.sendMessage({ type: 'BSE_OPEN_SIDE_PANEL', tab: 'queue' }).catch(() => {});
                this.showToast('未检测到平台网络字幕，已在侧边栏开启离线转录！');
              } else {
                this.showToast('加入转录队列失败：' + (res?.error || '未知错误'));
              }
            } catch (err) {
              this.showToast('字幕获取操作异常：' + (err?.message || err));
            }
          });
          this.empty.querySelector('.btn-retry')?.addEventListener('click', () => this.actions.refresh?.());
          this.empty.querySelector('.btn-diag')?.addEventListener('click', () => this.actions.openSidePanel?.());
        } else if (isError) {
          this.empty.querySelector('.btn-retry')?.addEventListener('click', () => this.actions.refresh?.());
          this.empty.querySelector('.btn-diag')?.addEventListener('click', () => this.actions.openSidePanel?.());
        }
      }

      // Rebuild only for a newly committed subtitle body. A normal state revision
      // may contain diagnostics only, while cueRevision also catches a refresh
      // whose replacement happens to contain the same number of cues.
      const cueRenderKey = `${state.mediaKey}:${state.selectedTrackId}:${state.cueRevision || 0}:${state.cues.length}`;
      if (hasCues && this.renderedMediaKey !== cueRenderKey) {
        this.renderedMediaKey = cueRenderKey;
        const paragraphs = this.buildParagraphs(state.cues);
        const fragment = document.createDocumentFragment();
        paragraphs.forEach((p) => {
          const pEl = document.createElement('div');
          pEl.className = 'paragraph';

          const pHeader = document.createElement('div');
          pHeader.className = 'paragraph-header';

          const pCopy = document.createElement('span');
          pCopy.className = 'paragraph-copy';
          pCopy.title = BSE.I18n?.t('copy_paragraph') || '复制此段';
          pCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

          const pTime = document.createElement('span');
          pTime.className = 'paragraph-time';
          pTime.dataset.time = String(p.from);
          pTime.textContent = this.formatParagraphTime(p.from);
          pTime.title = BSE.I18n ? BSE.I18n.t('click_to_seek', { t: BSE.Utils.formatClock(p.from) }) : `${BSE.Utils.formatClock(p.from)} 点击跳转`;
          pHeader.appendChild(pCopy);
          pHeader.appendChild(pTime);
          pEl.appendChild(pHeader);

          const pBody = document.createElement('p');
          pBody.className = 'paragraph-body';

          p.cues.forEach((cue) => {
            const span = document.createElement('span');
            span.className = 'cue';
            span.dataset.index = String(cue.index);
            span.dataset.time = String(cue.from);
            const clock = BSE.Utils.formatClock(cue.from);
            span.dataset.clock = clock;
            span.title = `${clock} 点击跳转`;
            span.textContent = cue.content;
            pBody.appendChild(span);
            if (/[a-zA-Z0-9,\.]$/.test(cue.content)) {
              pBody.appendChild(document.createTextNode(' '));
            }
          });

          pEl.appendChild(pBody);
          fragment.appendChild(pEl);
        });
        this.list.replaceChildren(fragment);
        this.activeIndex = -1;
      }
      this.updatePlayback(state.activeIndex ?? -1);
    }

    updatePlayback(index) {
      if (index === this.activeIndex) return;
      this.list.querySelector('.cue.active')?.classList.remove('active');
      this.activeIndex = index;
      const active = index >= 0 ? this.list.querySelector(`.cue[data-index="${index}"]`) : null;
      active?.classList.add('active');
      if (this.following) this.scrollToActive(false);
    }

    scrollToActive(immediate) {
      if (!this.following) return;
      const active = this.list.querySelector('.cue.active');
      if (!active) return;
      const activeRect = active.getBoundingClientRect();
      const listRect = this.list.getBoundingClientRect();
      if (!listRect.height) return;

      const currentScrollTop = this.list.scrollTop;
      const relativeTop = activeRect.top - listRect.top;
      const targetScrollTop = Math.max(0, Math.round(currentScrollTop + relativeTop - (listRect.height * 0.38) + (activeRect.height / 2)));

      if (Math.abs(targetScrollTop - currentScrollTop) < 10) return;

      this.programmaticScrolling = true;
      clearTimeout(this.programmaticScrollTimer);
      this.list.scrollTo({
        top: targetScrollTop,
        behavior: immediate ? 'auto' : 'smooth'
      });
      this.programmaticScrollTimer = setTimeout(() => {
        this.programmaticScrolling = false;
      }, 350);
    }
  }

  BSE.RollingPanel = RollingPanel;
})();
