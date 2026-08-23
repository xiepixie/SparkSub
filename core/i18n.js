(() => {
  'use strict';

  const BSE = globalThis.BSE || (globalThis.BSE = {});

  const DICTIONARIES = {
    'zh-CN': {
      app_name: '视频字幕助手',
      waiting_video: '等待视频…',
      connecting_tab: '正在连接当前标签页',
      track_label: '字幕轨道',
      auto_generated: '自动',
      cc_track: 'CC',
      follow: '跟随',
      resume_follow: '恢复跟随',
      open_sidebar: '打开字幕侧边栏',
      refresh_subtitles: '重新解析',
      collapse_panel: '收起字幕面板',
      expand_panel: '展开字幕面板',
      search_placeholder: '搜索字幕关键词...',
      copy_full_text: '复制全文',
      copied_full_text: '已复制字幕全文',
      copy_paragraph: '复制此段',
      copied_paragraph: '已复制此段内容',
      export: '导出',
      format_txt: '纯文本 (.txt)',
      format_srt: '字幕文件 (.srt)',
      format_md: '学习笔记 (.md)',
      empty_cue_list: '打开 YouTube 或哔哩哔哩视频后，字幕将自动出现在这里。',
      waiting_cues: '正在等待字幕…',
      no_subtitles: '暂无可用字幕',
      diagnostics_title: '诊断信息',
      copy_diagnostics: '复制日志',
      copied_diagnostics: '已复制诊断信息',
      no_error: '尚无错误',
      diagnostic_hint: '提取过程会在这里显示每个请求阶段。',
      cues_count: '{n} 条',
      duration_text: '{t}',
      chars_count: '{n} 字',
      stage_count: '{n} 个阶段',
      settings_title: '偏好设置',
      section_appearance: '界面与外观',
      section_video: '当前视频字幕',
      theme_label: '主题',
      theme_auto: '🌓 自动',
      theme_dark: '🌑 暗曜',
      theme_light: '☀️ 浅色',
      theme_bilibili: '哔哩碧蓝',
      theme_youtube: '油管猩红',
      lang_label: '语言',
      lang_auto: '🌐 自动',
      lang_zh_cn: '简体中文',
      lang_zh_tw: '繁體中文',
      lang_en: 'English',
      size_label: '字号',
      size_small: '小 (13px)',
      size_medium: '中 (14.5px)',
      size_large: '大 (16.5px)',
      btn_sidebar: '独立侧边栏',
      btn_reload: '重新解析',
      sec: '{s}秒',
      min: '{m}分钟',
      min_sec: '{m}分{s}秒',
      click_to_seek: '{t} 点击跳转',
      tab_timestamp: '带时间戳',
      tab_plain: '纯文本',
      tab_preview: '搜索预览',
      tab_ai: 'AI 总结',
      ai_summary_title: 'AI 总结与学习助手',
      ai_prompt_notes: '🎯 结构化深度讲义',
      ai_prompt_summary: '📝 核心主旨与脉络',
      ai_prompt_keypoints: '📋 关键要点与清单',
      ai_prompt_questions: '❓ 深度复盘与辨析题',
      ai_copied_toast: '✓ 已复制 AI 提示词与文稿，可直接粘贴给 AI 模型',
      btn_batch_export: '批量导出',
      batch_title: '批量导出字幕',
      batch_scope_all: '全合集全部',
      batch_scope_section: '按分组选择',
      batch_scope_video: '按单视频全部分P',
      batch_scope_current: '仅当前分P/视频',
      batch_scope_range: '指定序号区间',
      batch_scope_custom: '目录自定义勾选',
      batch_output_zip: 'ZIP 压缩包（每集/分P独立文件）',
      batch_output_merged_md: '合并为一个 Markdown 文件（带目录）',
      batch_pref_manual_first: '中文人工优先，AI兜底',
      batch_pref_manual_only: '仅人工中文',
      batch_pref_ai_first: 'AI 优先',
      batch_btn_start: '开始批量导出',
      batch_btn_pause: '暂停',
      batch_btn_resume: '继续',
      batch_btn_cancel: '取消',
      batch_completed_toast: '✓ 批量导出已完成并开始下载',
      status_loading: '加载中…',
      status_ready: '已就绪',
      status_error: '解析异常',
      status_idle: '等待中'
    },
    'en': {
      app_name: 'Video Subtitles',
      waiting_video: 'Waiting for video…',
      connecting_tab: 'Connecting to active tab',
      track_label: 'Subtitle Track',
      auto_generated: 'Auto',
      cc_track: 'CC',
      follow: 'Follow',
      resume_follow: 'Resume',
      open_sidebar: 'Open Side Panel',
      refresh_subtitles: 'Reload Subtitles',
      collapse_panel: 'Collapse Panel',
      expand_panel: 'Expand Panel',
      search_placeholder: 'Search transcript...',
      copy_full_text: 'Copy All',
      copied_full_text: 'Copied full transcript',
      copy_paragraph: 'Copy paragraph',
      copied_paragraph: 'Copied paragraph content',
      export: 'Export',
      format_txt: 'Plain Text (.txt)',
      format_srt: 'Subtitles (.srt)',
      format_md: 'Markdown (.md)',
      empty_cue_list: 'Subtitles will automatically appear here when playing YouTube or Bilibili videos.',
      waiting_cues: 'Waiting for subtitles…',
      no_subtitles: 'No Subtitles Available',
      diagnostics_title: 'Diagnostics',
      copy_diagnostics: 'Copy Log',
      copied_diagnostics: 'Copied diagnostic log',
      no_error: 'No Errors',
      diagnostic_hint: 'Diagnostics will display detailed request stages and error codes here.',
      cues_count: '{n} cues',
      duration_text: '{t}',
      chars_count: '{n} chars',
      stage_count: '{n} stages',
      settings_title: 'Preferences',
      section_appearance: 'Appearance & UI',
      section_video: 'Video Subtitles',
      theme_label: 'Theme',
      theme_auto: '🌓 Auto',
      theme_dark: '🌑 Dark',
      theme_light: '☀️ Light',
      theme_bilibili: 'Bilibili Cyan',
      theme_youtube: 'YouTube Red',
      lang_label: 'Language',
      lang_auto: '🌐 Auto',
      lang_zh_cn: '简体中文',
      lang_zh_tw: '繁體中文',
      lang_en: 'English',
      size_label: 'Font Size',
      size_small: 'Small (13px)',
      size_medium: 'Medium (14.5px)',
      size_large: 'Large (16.5px)',
      btn_sidebar: 'Side Panel',
      btn_reload: 'Reload',
      sec: '{s}s',
      min: '{m}m',
      min_sec: '{m}m {s}s',
      click_to_seek: '{t} Click to seek',
      tab_timestamp: 'Timestamps',
      tab_plain: 'Plain Text',
      tab_preview: 'Search Preview',
      tab_ai: 'AI Summary',
      ai_summary_title: 'AI Summary & Study Assistant',
      ai_prompt_notes: '🎯 Structured Lecture Notes',
      ai_prompt_summary: '📝 Core Essence & Logic',
      ai_prompt_keypoints: '📋 Key Takeaways & Action List',
      ai_prompt_questions: '❓ Deep Review & Concept QA',
      ai_copied_toast: '✓ Copied AI prompt with transcript to clipboard',
      btn_batch_export: 'Batch Export',
      batch_title: 'Batch Export Subtitles',
      batch_scope_all: 'All Episodes / Parts',
      batch_scope_section: 'By Section',
      batch_scope_video: 'By Single Video Parts',
      batch_scope_current: 'Current Episode / Part Only',
      batch_scope_range: 'Specified Range',
      batch_scope_custom: 'Custom Selection',
      batch_output_zip: 'ZIP Archive (One file per episode)',
      batch_output_merged_md: 'Single Merged Markdown File (with TOC)',
      batch_pref_manual_first: 'Manual Chinese First, AI Fallback',
      batch_pref_manual_only: 'Manual Chinese Only',
      batch_pref_ai_first: 'AI First',
      batch_btn_start: 'Start Batch Export',
      batch_btn_pause: 'Pause',
      batch_btn_resume: 'Resume',
      batch_btn_cancel: 'Cancel',
      batch_completed_toast: '✓ Batch export completed and downloading',
      status_loading: 'Loading…',
      status_ready: 'Ready',
      status_error: 'Error',
      status_idle: 'Idle'
    },
    'zh-TW': {
      app_name: '影片字幕助手',
      waiting_video: '等待影片…',
      connecting_tab: '正在連線當前分頁',
      track_label: '字幕軌道',
      auto_generated: '自動',
      cc_track: 'CC',
      follow: '跟隨',
      resume_follow: '恢復跟隨',
      open_sidebar: '開啟字幕側邊欄',
      refresh_subtitles: '重新解析',
      collapse_panel: '收起字幕面板',
      expand_panel: '展開字幕面板',
      search_placeholder: '搜尋字幕關鍵字...',
      copy_full_text: '複製全文',
      copied_full_text: '已複製字幕全文',
      copy_paragraph: '複製此段',
      copied_paragraph: '已複製此段內容',
      export: '匯出',
      format_txt: '純文字 (.txt)',
      format_srt: '字幕檔 (.srt)',
      format_md: '學習筆記 (.md)',
      empty_cue_list: '播放 YouTube 或嗶哩嗶哩影片後，字幕將自動出現在這裡。',
      waiting_cues: '正在等待字幕…',
      no_subtitles: '暫無可用字幕',
      diagnostics_title: '診斷資訊',
      copy_diagnostics: '複製日誌',
      copied_diagnostics: '已複製診斷資訊',
      no_error: '尚無錯誤',
      diagnostic_hint: '提取過程會在這裡顯示每個請求階段。',
      cues_count: '{n} 條',
      duration_text: '{t}',
      chars_count: '{n} 字',
      stage_count: '{n} 個階段',
      settings_title: '偏好設定',
      section_appearance: '介面與外觀',
      section_video: '當前影片字幕',
      theme_label: '主題',
      theme_auto: '🌓 自動',
      theme_dark: '🌑 暗曜',
      theme_light: '☀️ 淺色',
      theme_bilibili: '嗶哩碧藍',
      theme_youtube: '油管猩紅',
      lang_label: '語言',
      lang_auto: '🌐 自動',
      lang_zh_cn: '簡體中文',
      lang_zh_tw: '繁體中文',
      lang_en: 'English',
      size_label: '字體',
      size_small: '小 (13px)',
      size_medium: '中 (14.5px)',
      size_large: '大 (16.5px)',
      btn_sidebar: '獨立側邊欄',
      btn_reload: '重新解析',
      sec: '{s}秒',
      min: '{m}分鐘',
      min_sec: '{m}分{s}秒',
      click_to_seek: '{t} 點擊跳轉',
      tab_timestamp: '帶時間戳',
      tab_plain: '純文字',
      tab_preview: '搜尋預覽',
      tab_ai: 'AI 總結',
      ai_summary_title: 'AI 總結與學習助手',
      ai_prompt_notes: '🎯 結構化深度講義',
      ai_prompt_summary: '📝 核心主旨與脈絡',
      ai_prompt_keypoints: '📋 關鍵要點與清單',
      ai_prompt_questions: '❓ 深度複盤與辨析題',
      ai_copied_toast: '✓ 已複製 AI 提示詞與文稿，可直接貼上給 AI 模型',
      btn_batch_export: '批次匯出',
      batch_title: '批次匯出字幕',
      batch_scope_all: '全合集全部',
      batch_scope_section: '按分組選擇',
      batch_scope_video: '按單影片全部分P',
      batch_scope_current: '僅當前分P/影片',
      batch_scope_range: '指定序號區間',
      batch_scope_custom: '目錄自訂勾選',
      batch_output_zip: 'ZIP 壓縮包（每集/分P獨立檔案）',
      batch_output_merged_md: '合併為一個 Markdown 檔案（附目錄）',
      batch_pref_manual_first: '中文人工優先，AI兜底',
      batch_pref_manual_only: '僅人工中文',
      batch_pref_ai_first: 'AI 優先',
      batch_btn_start: '開始批次匯出',
      batch_btn_pause: '暫停',
      batch_btn_resume: '繼續',
      batch_btn_cancel: '取消',
      batch_completed_toast: '✓ 批次匯出已完成並開始下載',
      status_loading: '載入中…',
      status_ready: '已就緒',
      status_error: '解析異常',
      status_idle: '等待中'
    }
  };

  const THEMES = ['auto', 'dark', 'light', 'bilibili', 'youtube'];
  const LANGUAGES = ['auto', 'zh-CN', 'en', 'zh-TW'];

  class I18nManager {
    constructor() {
      this.currentLocale = 'zh-CN';
      this.currentTheme = 'auto';
      this.listeners = new Set();
      this.init();
    }

    async init() {
      this.detectSystemLocale();
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id && chrome?.storage?.sync?.get) {
        try {
          const settings = await chrome.storage.sync.get({ uiLang: 'auto', theme: 'auto' });
          if (settings.uiLang && settings.uiLang !== 'auto') {
            this.currentLocale = settings.uiLang;
          }
          if (settings.theme) {
            this.currentTheme = settings.theme;
          }
        } catch {}
      }
      if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
        try {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync') return;
            let updated = false;
            if (changes.theme && changes.theme.newValue !== this.currentTheme) {
              this.currentTheme = changes.theme.newValue || 'auto';
              updated = true;
            }
            if (changes.uiLang) {
              const lang = changes.uiLang.newValue || 'auto';
              if (lang === 'auto') this.detectSystemLocale();
              else this.currentLocale = lang;
              updated = true;
            }
            if (updated) this.notify();
          });
        } catch {}
      }
      this.notify();
    }

    detectSystemLocale() {
      const navLang = typeof navigator !== 'undefined' && navigator?.language ? navigator.language : 'zh-CN';
      if (/^zh-TW|^zh-HK|^zh-MO/i.test(navLang)) {
        this.currentLocale = 'zh-TW';
      } else if (/^zh/i.test(navLang)) {
        this.currentLocale = 'zh-CN';
      } else {
        this.currentLocale = 'en';
      }
    }

    getLocale() {
      return this.currentLocale;
    }

    async setLocale(locale) {
      if (locale === 'auto') {
        this.detectSystemLocale();
      } else if (DICTIONARIES[locale]) {
        this.currentLocale = locale;
      }
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id && chrome?.storage?.sync?.set) {
        try {
          await chrome.storage.sync.set({ uiLang: locale });
        } catch {}
      }
      this.notify();
    }

    getTheme() {
      return this.currentTheme;
    }

    async setTheme(theme) {
      if (THEMES.includes(theme)) {
        this.currentTheme = theme;
        if (typeof chrome !== 'undefined' && chrome?.runtime?.id && chrome?.storage?.sync?.set) {
          try {
            await chrome.storage.sync.set({ theme });
          } catch {}
        }
        this.notify();
      }
    }

    t(key, params = {}) {
      const dict = DICTIONARIES[this.currentLocale] || DICTIONARIES['zh-CN'];
      let text = dict[key] || DICTIONARIES['zh-CN'][key] || key;
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
      return text;
    }

    formatTimeSpan(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds || 0)));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      if (mins === 0) return this.t('sec', { s: secs });
      if (secs === 0) return this.t('min', { m: mins });
      return this.t('min_sec', { m: mins, s: secs });
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    notify() {
      for (const listener of this.listeners) {
        try { listener(this); } catch {}
      }
    }
  }

  BSE.I18n = new I18nManager();
  BSE.DICTIONARIES = DICTIONARIES;
  BSE.THEMES = THEMES;
  BSE.LANGUAGES = LANGUAGES;
})();
