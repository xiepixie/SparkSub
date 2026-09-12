/**
 * 视频字幕助手 - 核心 TypeScript 类型定义
 */

export type Platform = 'youtube' | 'bilibili';

export type StatusKind = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface Cue {
  from: number;
  to: number;
  content: string;
}

export interface SubtitleTrack {
  id: string;
  lan: string;
  lanDoc: string;
  subtitleUrl?: string;
  isAuto: boolean;
  isCC: boolean;
  platform: Platform;
  aid?: number | string;
  bvid?: string;
  cid?: number | string;
  page?: number;
  part?: string;
  duration?: number;
  isTranslatable?: boolean;
  isTranslated?: boolean;
  sourceLan?: string;
  tlang?: string;
}

export interface ErrorFault {
  stage: string;
  code: string;
  message: string;
  hint: string;
  time?: string;
}

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticScope = 'media' | 'queue' | 'native' | 'batch' | 'tracker' | 'ai' | 'system';

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  scope: DiagnosticScope;
  code: string;
  stage: string;
  message: string;
  sessionId: string;
  context: {
    mediaKey?: string;
    jobId?: string;
    platform?: string;
    tabId?: number;
  };
}

export interface DiagnosticStore {
  append(input: Partial<DiagnosticEvent> | string): DiagnosticEvent | null;
  replaceSession(scope: DiagnosticScope, sessionId: string): void;
  events(filter?: { scope?: DiagnosticScope; sessionId?: string; minLevel?: DiagnosticLevel; excludeCodeSuffix?: string }): DiagnosticEvent[];
  count(filter?: { scope?: DiagnosticScope; sessionId?: string; minLevel?: DiagnosticLevel; excludeCodeSuffix?: string }): number;
  clear(filter?: { scope?: DiagnosticScope; sessionId?: string }): void;
}

export interface DiagnosticsModule {
  LEVELS: readonly DiagnosticLevel[];
  SCOPES: readonly DiagnosticScope[];
  createEvent(input: Partial<DiagnosticEvent> | string, now?: () => Date): DiagnosticEvent;
  sanitizeText(value: unknown, options?: { maxLength?: number }): string;
  sanitizeEndpoint(value: unknown): string;
  formatEvent(event: Partial<DiagnosticEvent> | string): string;
  createStore(options?: { limit?: number; perSessionLimit?: number; dedupeWindowMs?: number; now?: () => Date }): DiagnosticStore;
  createLegacyReporter(emit: (event: DiagnosticEvent) => void, defaults?: Partial<DiagnosticEvent> & { now?: () => Date }): (stage: string, message: string) => void;
  createFaultEvents(fault: ErrorFault, defaults?: Partial<DiagnosticEvent> & { now?: () => Date }): DiagnosticEvent[];
  createMediaSession(options?: { platform?: string; limit?: number; now?: () => Date }): {
    begin(mediaKey: string): string;
    report(stage: string, message: string, overrides?: Partial<DiagnosticEvent>): DiagnosticEvent | null;
    append(event: Partial<DiagnosticEvent>): DiagnosticEvent | null;
    recordFault(fault: ErrorFault): DiagnosticEvent[];
    events(): DiagnosticEvent[];
    readonly sessionId: string;
    readonly mediaKey: string;
  };
  classifyLegacy(stage: string, message: string): DiagnosticLevel;
}

export interface DiagnosticPresenter {
  activateMedia(input: { tabId?: number | null; sessionId: string; mediaKey?: string | null }): void;
  ingestMedia(events: Array<DiagnosticEvent | string>): void;
  append(input: Partial<DiagnosticEvent>): DiagnosticEvent | null;
  observeQueueItem(item: Partial<QueueItem>): DiagnosticEvent | null;
  selectScope(scope: 'media' | 'queue' | 'native' | 'batch' | 'ai'): void;
  setDetailed(value: boolean): void;
  visibleEvents(): DiagnosticEvent[];
  statusEvents(): DiagnosticEvent[];
  activityEvents(state: Partial<AppState>): DiagnosticEvent[];
  statusItem(event: DiagnosticEvent): { id: string; tone: 'success' | 'running' | 'warning' | 'error' | 'info'; title: string; detail: string; time: string };
  summarizeState(state: Partial<AppState>): { tone: 'success' | 'running' | 'warning' | 'error' | 'info'; label: string; title: string; detail: string };
  technicalEvents(): DiagnosticEvent[];
  technicalCount(): number;
  clearSelected(): void;
  copySelected(header?: string): string;
  copyTechnical(header?: string): string;
  readonly selectedScope: string;
  readonly detailed: boolean;
}

export interface AppState {
  version: string;
  platform: Platform;
  mediaKey: string | null;
  /** Semantic metadata bound to the same mediaKey; used only for AI disambiguation. */
  mediaContext?: MediaContextPack;
  title: string;
  url: string;
  status: StatusKind;
  message: string;
  revision: number;
  /** Increments only when a newly loaded subtitle body is committed. */
  cueRevision: number;
  isRefreshing: boolean;
  lastError: ErrorFault | null;
  tracks: SubtitleTrack[];
  selectedTrackId: string | null;
  cues: Cue[];
  activeIndex: number;
  currentTime: number;
  duration?: number;
  diagnosticSessionId: string;
  diagnostics: DiagnosticEvent[];
  authorInfo?: {
    name: string;
    targetId: string;
    mid?: string;
    channelId?: string;
    bvid?: string;
    videoId?: string;
    avatar?: string;
    seasonId?: string | null;
    seasonTitle?: string | null;
  } | null;
}

export type PublicState = Omit<AppState, 'tracks'> & {
  tracks: Array<Omit<SubtitleTrack, 'subtitleUrl'>>;
};

export interface CapturedCaptionRequest {
  url: string;
  videoId: string;
  lang: string;
  sourceLang?: string;
  tlang?: string;
  isTranslated?: boolean;
  kind: string;
  fmt: string;
  hasPoToken: boolean;
  capturedAt: number;
}

export interface BilibiliItem {
  kind: 'single' | 'page' | 'episode';
  globalIndex: number;
  sectionIndex: number;
  sectionTitle: string;
  sectionKey: string;
  episodeIndex: number;
  episodeTitle: string;
  page: number;
  part: string;
  duration: number;
  pubdate?: number;
  bvid: string;
  aid: number | string;
  cid: number | string;
  title: string;
  sourceUrl: string;
}

export interface BilibiliEpisode {
  index: number;
  bvid: string;
  aid: number | string;
  title: string;
  pagesCount: number;
  items: BilibiliItem[];
}

export interface BilibiliSection {
  index: number;
  title: string;
  key: string;
  episodes: BilibiliEpisode[];
  items: BilibiliItem[];
}

export interface BatchMediaTree {
  kind: 'ugc_season' | 'multi_page' | 'single' | 'bpx_eplist' | 'youtube_playlist';
  isCollection: boolean;
  seasonId: number | string | null;
  title: string;
  currentBvid: string;
  currentPage: number;
  totalEpisodesCount: number;
  sections: BilibiliSection[];
  items: BilibiliItem[];
  hasNestedPages?: boolean;
}

/** Backward-compatible alias; batch UI now consumes the same normalized topology on both platforms. */
export type BilibiliTree = BatchMediaTree;

export interface BatchConfig {
  scope: 'all' | 'current-page' | 'current-video' | 'video' | 'section' | 'range' | 'custom';
  targetBvid?: string;
  sectionKey?: string;
  rangeStart?: number;
  rangeEnd?: number;
  customIndices?: number[] | Set<number>;
  outputMode: 'zip' | 'merged-file' | 'copy-text' | 'merged-md';
  format?: 'srt' | 'txt' | 'md';
  preference?: 'manual-first' | 'manual-only' | 'ai-first';
  withTimestamp?: boolean;
}

export interface BatchItemResult {
  status: 'success' | 'no_subtitle' | 'failed';
  item: BilibiliItem;
  track?: {
    id?: string;
    language?: string;
    languageCode?: string;
    lan?: string;
    label?: string;
    lan_doc?: string;
    lanDoc?: string;
    captionKind?: 'manual' | 'auto' | 'translated';
    isAI?: boolean;
  };
  body?: Cue[];
  reason?: string;
}

export interface BatchProgressStats {
  total: number;
  completed: number;
  success: number;
  noSub: number;
  failed: number;
  packPercent?: number;
}

export type BatchOutput =
  | { mode: 'copy-text'; text: string; filename: string; mime: string }
  | { mode: 'merged-file'; text: string; filename: string; mime: string }
  | { mode: 'zip'; blob: Blob; filename: string; mime: 'application/zip' };

export interface BatchControlTask {
  controller?: AbortController;
  running?: boolean;
  paused?: boolean;
  cancelled?: boolean;
  diagnostic?: (stage: string, message: string) => void;
}

export interface MetadataOptions {
  title?: string;
  url?: string;
  platform?: string;
  language?: string;
}

export interface FormatOptions {
  withTimestamp?: boolean;
}

type SidepanelButtonKey =
  | 'refresh' | 'settingsToggle' | 'tabSubtitle' | 'tabLearn' | 'tabReview' | 'tabTimestamp' | 'tabPlain' | 'searchPrev' | 'searchNext'
  | 'follow' | 'copy' | 'download' | 'batchButton' | 'aiSettingsToggle' | 'aiModelBadge' | 'aiBtnTestConn'
  | 'aiBtnSaveSettings' | 'aiBtnGenerate' | 'aiBtnSnipFrame' | 'aiBtnExternalToggle' | 'aiBtnCopyNote' | 'aiBtnExportZip'
  | 'btnClearManualTray' | 'btnCopyStitchedTray' | 'btnDownloadTrayImages' | 'aiBtnCopyPlanPrompt'
  | 'aiBtnImportPlan' | 'aiBtnCopySynthPrompt' | 'aiBtnOpenImportModal' | 'aiBtnCloseImportModal' | 'aiBtnCancelImport'
  | 'aiBtnConfirmImport' | 'emptyTranscribe' | 'copyDiagnostic' | 'batchCloseBtn' | 'batchTreeBtnAll'
  | 'batchTreeBtnCur' | 'batchTreeBtnNone' | 'batchTreeBtnInvert' | 'batchQuickApplyBtn' | 'batchStartBtn'
  | 'batchPauseBtn' | 'batchCancelBtn' | 'tabTracker' | 'trackerSubscribeUpBtn' | 'trackerSubscribeSeasonBtn'
  | 'trackerFilterAll' | 'trackerFilterUnread' | 'trackerCheckAllBtn' | 'trackerCopyAllBtn' | 'trackerReadAllBtn'
  | 'trackerExportBtn' | 'trackerImportBtn' | 'tabQueue' | 'queueBtnShowAdd' | 'queueBtnCopyMerged'
  | 'queueBtnClearDone' | 'queueBatchSubmit' | 'queueBatchCancel' | 'queueCapabilityRefresh';

type SidepanelInputKey =
  | 'search' | 'aiInputEndpoint' | 'aiInputApiKey' | 'aiInputLearnModel' | 'aiInputReviewModel' | 'batchQuickStart' | 'batchQuickEnd'
  | 'trackerSearchInput' | 'trackerImportFile';

type SidepanelSelectKey =
  | 'track' | 'themeSelect' | 'langSelect' | 'prefSelect' | 'sizeSelect' | 'format' | 'trackerSortSelect'
  | 'trackerIntervalSelect' | 'trackerNotifySelect' | 'queueSourceLanguage';

type SidepanelTextareaKey = 'aiImportTextarea' | 'queueBatchInput';
type SidepanelDetailsKey = 'diagnosticsPanel' | 'queueCapabilityPanel';

export type SidepanelElements = Record<string, HTMLElement | null>
  & { [K in SidepanelButtonKey]: HTMLButtonElement | null }
  & { [K in SidepanelInputKey]: HTMLInputElement | null }
  & { [K in SidepanelSelectKey]: HTMLSelectElement | null }
  & { [K in SidepanelTextareaKey]: HTMLTextAreaElement | null }
  & { [K in SidepanelDetailsKey]: HTMLDetailsElement | null };

// Global BSE namespace
export interface SubtitleCorrectionPatch {
  index: number;
  from: number;
  to: number;
  originalContent: string;
  content: string;
}

export interface SubtitleCorrectionEntry {
  trackId: string;
  cueCount: number;
  patches: SubtitleCorrectionPatch[];
  updatedAt: number;
}

export interface SubtitleCacheRecord {
  mediaKey: string;
  title: string;
  author: string;
  trackId?: string;
  trackSource?: string;
  language: string;
  langDoc: string;
  corrections?: Record<string, SubtitleCorrectionEntry>;
  cues: Cue[];
  cueCount: number;
  plainText?: string;
  markdown?: string;
  savedAt: number;
}

export interface BSEUtilsNamespace {
  detectPlatform(hostname?: string): Platform | null;
  isMatchingVideoUrl(url?: string): boolean;
  getYouTubeVideoId(url?: string): string | null;
  getBvid(url?: string): string | null;
  getBilibiliPage(url?: string): number;
  getActiveCidFromDom(): string | null;
  rememberBilibiliMediaIdentity(identity?: { bvid?: string; cid?: string | number; page?: number; pageCount?: number }): string | null;
  getMediaKey(platform?: Platform | null, url?: string): string | null;
  getArtifactKey(platform?: Platform | null, url?: string, mediaKey?: string): string | null;
  mediaStateMatchesUrl(candidateState: { mediaKey?: string | null; url?: string | null } | null | undefined, targetUrl: string): boolean;
  delay(ms: number, signal?: AbortSignal): Promise<void>;
  fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response>;
  formatClock(seconds: number): string;
  escapeHtml(value: unknown): string;
  sanitizeFilename(value: string): string;
  normalizeImageUrl(value: unknown): string;
  subtitleFingerprint(cues?: Cue[]): string;
  buildSubtitlePatchToken(mediaKey: string, trackId: string, cues?: Cue[], knownFingerprint?: string): string;
  findActiveCueIndex(cues: Cue[], time: number, previousIndex?: number): number;
  downloadBlob(blob: Blob, filename: string): void;
  downloadText(text: string, filename: string, mime?: string): void;
  downloadTextFile(text: string, filename: string, mime?: string): void;
  translateCues(cues: Cue[], targetLang?: string, signal?: AbortSignal): Promise<Cue[]>;
  SessionSnapshotManager: {
    getSnapshots(): Array<Record<string, any>>;
    findSnapshot(mediaKey: string): Record<string, any> | null;
    deleteSnapshot(mediaKey: string | null): void;
    saveSnapshot(mediaKey: string, data: Record<string, any>): void;
  };
  UnifiedSubtitleCache: {
    get(mediaKey: string, options?: { includePlainText?: boolean; applyCorrections?: boolean }): Promise<SubtitleCacheRecord | null>;
    getMany(mediaKeys: string[], options?: { includePlainText?: boolean; applyCorrections?: boolean }): Promise<Record<string, SubtitleCacheRecord>>;
    set(mediaKey: string, payload: {
      title?: string;
      author?: string;
      trackId?: string;
      trackSource?: string;
      language?: string;
      lang?: string;
      langDoc?: string;
      plainText?: string;
      markdown?: string;
      cueCount?: number;
      cues?: Cue[];
      corrections?: Record<string, SubtitleCorrectionEntry>;
    }): Promise<boolean>;
    setMany(entries: Array<{ mediaKey: string; payload: {
      title?: string;
      author?: string;
      trackId?: string;
      trackSource?: string;
      language?: string;
      lang?: string;
      langDoc?: string;
      plainText?: string;
      markdown?: string;
      cueCount?: number;
      cues?: Cue[];
      corrections?: Record<string, SubtitleCorrectionEntry>;
    } }>): Promise<number>;
    recordCorrections(mediaKey: string, trackId: string, baseCues: Cue[], patches: Array<{ index: number; content: string }>, payload?: Record<string, any>): Promise<boolean>;
    remove(mediaKey: string): Promise<boolean>;
    applyCorrections(mediaKey: string, trackId: string, cues: Cue[], cachedRecord?: SubtitleCacheRecord | null): Promise<{ cues: Cue[]; appliedCount: number; conflictCount: number }>;
  };
}

export interface BSEParsersNamespace {
  normalize(cues: any[]): Cue[];
  parse(text: string, format?: string): Cue[];
  parseJson3(text: string): Cue[];
  parseVtt(text: string): Cue[];
  parseTtml(text: string): Cue[];
  parseSrv3(text: string): Cue[];
  parseLegacyXml(text: string): Cue[];
}

export interface CapturedFrame {
  success: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  timestamp?: number;
  duration?: number;
  format?: string;
  warning?: string;
  error?: string;
  message?: string;
  selection?: {
    strategy: 'visual' | 'time-fallback';
    sampledTimestamps: number[];
    selectedTimestamp: number;
    visualScore?: number;
    stabilityScore?: number;
    fingerprint?: number[];
  };
}

export interface VisualFrameCandidate {
  timestamp: number;
  signature: number[];
  brightness: number;
  detail: number;
  frame?: CapturedFrame;
  visualScore?: number;
  stabilityScore?: number;
}

export interface CaptureFrameOptions {
  format?: string;
  quality?: number;
  maxWidth?: number;
  timeoutMs?: number;
  restoreTime?: boolean;
  videoElement?: HTMLVideoElement;
}

export interface BSEMediaNamespace {
  isBilibiliCdnHost(hostname: string): boolean;
  normalizeBilibiliUrl(value: string): string;
  normalizeBilibiliAudioStreams(audio: Array<Record<string, unknown>>): Array<{
    bandwidth: number;
    id?: number | string;
    codecs: string;
    url: string;
    backupUrls: string[];
  }>;
  selectBilibiliAudio(audio: Array<Record<string, unknown>>): Extract<NativeHostSource, { kind: 'remote' }> | null;
  getContactSheetLayout(frameCount: number, options?: { maxFrames?: number; width?: number }): { maxFrames: number; count: number; width: number; columns: number; gap: number; padding: number; headerHeight: number };
  captureVideoFrame(videoElement?: HTMLVideoElement | null, options?: CaptureFrameOptions): CapturedFrame;
  captureVideoFrameAt(targetSeconds: number, options?: CaptureFrameOptions): Promise<CapturedFrame>;
  captureStableVideoFrame(request?: AiVisualRequest, options?: CaptureFrameOptions): Promise<CapturedFrame>;
}

export interface BSEFormattersNamespace {
  mergeParagraphs(cues: Cue[]): string;
  toTxt(cues: Cue[], withTimestamp?: boolean): string;
  toSrt(cues: Cue[]): string;
  toMarkdown(cues: Cue[], metadata?: MetadataOptions, options?: FormatOptions): string;
  toMergedMarkdown(tree: BilibiliTree, results: any, stats?: any, options?: FormatOptions): string;
  toMergedText(tree: BilibiliTree, results: any, stats?: any, options?: FormatOptions): string;
  buildBatchManifest(tree: BilibiliTree, selectedItems: BilibiliItem[], results: any, stats?: any, config?: any): any;
  generateSubtitlePolishPrompt(cues: Cue[], withTimestamp?: boolean, metadata?: Record<string, any>): string;
  buildFrameReference(timeStr: string, label?: string): string;
  resolveFrameEntry(imagesMap?: Record<string, AiNoteFrame>, reference?: { seconds?: number; timeStr?: string; maxDistance?: number }): { frame: AiNoteFrame; distance: number } | null;
  transformFrameReferences(markdown: string, transform: (reference: { raw: string; timeStr: string; seconds: number; label: string }) => string): string;
  renderNoteToHtml(markdown: string, options?: { imagesMap?: Record<string, AiNoteFrame> }): string;
  format(type: string, cues: Cue[], metadata?: MetadataOptions, options?: FormatOptions): string;
}

export interface BSEBatchExportNamespace {
  selectItems(tree: BatchMediaTree, config: BatchConfig): BilibiliItem[];
  createOutput(
    tree: BatchMediaTree,
    selectedItems: BilibiliItem[],
    results: BatchItemResult[] | Map<any, BatchItemResult>,
    stats: BatchProgressStats,
    config: BatchConfig,
    options?: { onPackProgress?: (percent: number) => void }
  ): Promise<BatchOutput>;
  deliver(output: BatchOutput, adapters: {
    writeText(text: string): Promise<void>;
    downloadText(text: string, filename: string, mime: string): void;
    downloadBlob(blob: Blob, filename: string): void;
  }): Promise<void>;
  trackLanguageLabel(track?: BatchItemResult['track'], fallback?: string): string;
}

export interface BSEPlatformNamespace {
  discoverTracks(options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void }): Promise<SubtitleTrack[]>;
  loadTrack(track: SubtitleTrack, options?: {
    signal?: AbortSignal;
    diagnostic?: (stage: string, message: string) => void;
    onIntermediateCues?: (cues: Cue[]) => void;
  }): Promise<Cue[]>;
  rememberRequest?(request: CapturedCaptionRequest): void;
  bridgeRequest?(type: string, payload?: any, timeoutMs?: number): Promise<any>;
  fetchMediaTree?(currentBvid?: string, options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void; pageUrl?: string }): Promise<BatchMediaTree>;
  fetchMediaContext?(options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void }): Promise<MediaContextPack | null>;
  runBatchExport?(tree: BatchMediaTree, config: BatchConfig, onProgress?: (stats: BatchProgressStats, currentItem: BilibiliItem | null, phase: string, task: BatchControlTask) => void, controlTask?: BatchControlTask): Promise<any>;
  chooseBilibiliSubtitle?(subList: any[], preference?: string): any;
  fetchAudioStream?(options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void }): Promise<{
    bvid: string;
    cid: string | number;
    title: string;
    audioUrl: string;
    backupUrls: string[];
    bandwidth: number;
    codecs: string;
    id?: string | number;
    duration: number;
    headers?: Record<string, string>;
    allAudioStreams: Array<{ id?: string | number; codecs: string; bandwidth: number; baseUrl: string }>;
  }>;
  downloadAudioFile?(audioData: { audioUrl: string; title?: string; bandwidth?: number; codecs?: string }, filename?: string, options?: { diagnostic?: (stage: string, message: string) => void }): Promise<any>;
}

export interface BSEI18nNamespace {
  t(key: string, params?: Record<string, any>): string;
  getLocale(): string;
  getLocalePreference(): string;
  setLocale(locale: string): void;
  getTheme(): string;
  setTheme(theme: string): void;
  subscribe(callback: () => void): () => void;
  formatTimeSpan(seconds: number): string;
}

export interface TrackedItemSubtitle {
  status: 'ready' | 'pending' | 'not_found' | 'error' | 'evicted';
  language?: string;
  langDoc?: string;
  cueCount?: number;
  fetchedAt?: number;
  plainText?: string;
  markdown?: string;
  errorHint?: string;
}

export interface TrackedItem {
  id: string;
  title: string;
  url: string;
  pubdate?: number;
  duration?: number;
  author?: string;
  hasSubtitle?: boolean;
  isRead?: boolean;
  cid?: string | number;
  subtitle?: TrackedItemSubtitle | null;
}

export interface TrackedSubscription {
  id: string;
  platform: Platform;
  type: 'up' | 'season' | 'channel';
  title: string;
  author?: string;
  avatar?: string;
  targetId: string;
  sourceUrl?: string;
  ownerId?: string;
  resolvedTargetId?: string;
  bvid?: string;
  latestBvid?: string;
  subscribedAt: number;
  lastCheckedAt: number;
  lastReadPubdate?: number;
  lastReadItemId?: string;
  lastUpdatedItemId?: string;
  lastUpdatedTitle?: string;
  unreadCount: number;
  items: TrackedItem[];
  autoExtractSubtitle?: boolean;
}

export interface TrackerSettings {
  checkIntervalMinutes: number;
  enableNotification: boolean;
  enableBadge: boolean;
  autoExtractSubtitles: boolean;
}

export type QueueStage =
  | 'queued'
  | 'resolving'
  | 'fetching_caption'
  | 'fetching_audio'
  | 'transcribing'
  | 'postprocessing'
  | 'done'
  | 'failed';

export interface MediaContextPack {
  version: 1;
  platform: Platform | 'unknown';
  mediaKey: string;
  title: string;
  author: string;
  category: string;
  partTitle: string;
  tags: string[];
  description: string;
  duration?: number;
}

export interface ASRContextHint {
  topic?: string;
  terms?: string[];
}

export interface BSEMediaContextNamespace {
  readonly CONTEXT_VERSION: 1;
  create(value?: Partial<MediaContextPack>): MediaContextPack;
  merge(base: MediaContextPack | null | undefined, patch: Partial<MediaContextPack>): MediaContextPack;
  sameOwner(left: { mediaKey?: string } | null | undefined, right: { mediaKey?: string } | null | undefined): boolean;
  normalizeTags(values?: Array<string | Record<string, any>>): string[];
  fromBilibiliView(params?: { bvid?: string; cid?: string | number; page?: number; viewData?: Record<string, any>; tags?: Array<string | Record<string, any>> }): MediaContextPack;
  fromYouTubeDetails(params?: { videoId?: string; videoDetails?: Record<string, any>; microformat?: Record<string, any> }): MediaContextPack;
  fetchBilibiliTags(bvid: string, options?: { signal?: AbortSignal }): Promise<string[]>;
  buildASRContext(mediaContext?: MediaContextPack | null): ASRContextHint;
  formatPromptContext(mediaContext?: MediaContextPack | null, options?: { title?: string; sourceLanguage?: string; targetLanguage?: string }): string;
  buildTranslationContext(params?: { mediaContext?: MediaContextPack | null; cues?: Cue[]; startIndex?: number; endIndex?: number; sourceLanguage?: string; targetLanguage?: string; neighborCount?: number }): string;
}

export interface QueueItemSubtitle {
  language: string;
  langDoc: string;
  cueCount: number;
  plainText: string;
  markdown: string;
  srt?: string;
  cues?: Cue[];
  source?: 'platform' | 'native';
  /** Opaque diagnostic engine identifier returned by the native host. */
  engine?: string;
  /** Optional user-facing engine label; routing must never depend on this value. */
  engineLabel?: string;
  captionKind?: 'manual' | 'auto' | 'translated' | 'transcript';
}

export interface QueueListProjectionSubtitle {
  language: string;
  langDoc: string;
  cueCount: number;
  source?: 'platform' | 'native';
  engine?: string;
  engineLabel?: string;
  captionKind?: 'manual' | 'auto' | 'translated' | 'transcript';
}

export interface QueueListProjection {
  id: string;
  url: string;
  platform: Platform;
  targetId: string;
  title: string;
  author: string;
  cover?: string;
  duration?: number | string;
  stage: QueueStage;
  progress: number;
  stageHint?: string;
  error?: string;
  errorCode?: string;
  errorHint?: string;
  retriable?: boolean;
  sourceLanguage?: string;
  processingIntent?: 'auto' | 'local-asr';
  addedAt: number;
  completedAt?: number;
  subtitle?: QueueListProjectionSubtitle;
}

export interface QueueItem {
  id: string;
  url: string;
  platform: Platform;
  targetId: string;
  title: string;
  author: string;
  cover?: string;
  duration?: number | string;
  stage: QueueStage;
  progress: number;
  stageHint?: string;
  error?: string;
  errorCode?: string;
  errorHint?: string;
  retriable?: boolean;
  sourceLanguage?: string;
  /** Explicit local-asr never reuses platform-caption state; auto keeps the normal caption-first policy. */
  processingIntent?: 'auto' | 'local-asr';
  /** Media identity captured at enqueue time; used to reject SPA/cache cross-talk. */
  expectedMediaKey?: string;
  /** Bounded semantic metadata tied to one exact media identity for AI disambiguation. */
  mediaContext?: MediaContextPack;
  /** Normalized Bilibili page number when known. */
  page?: number;
  addedAt: number;
  stageUpdatedAt?: number;
  startedAt?: number;
  completedAt?: number;
  /** Persistent executor claim; cleared when the job reaches a terminal stage. */
  leaseOwner?: string;
  /** Unix epoch milliseconds after which crash recovery may reclaim the job. */
  leaseExpiresAt?: number;
  metaCache?: {
    title?: string;
    author?: string;
    cid?: number | string;
    /** Authoritative media owner for cached metadata. */
    mediaKey?: string;
    cover?: string;
    pages?: Array<{ page: number; cid: number | string; part: string }>;
    captionTracks?: Array<{
      baseUrl: string;
      languageCode?: string;
      name?: { simpleText?: string };
    }>;
  };
  stageArtifacts?: {
    metadataResolved?: boolean;
    /** Exact BVID+CID owner for Bilibili caption artifacts. */
    mediaKey?: string;
    captionTracks?: Array<Record<string, unknown>>;
    chosenCaption?: { lan?: string; lan_doc?: string };
    captionTrackId?: string;
    selectedCaption?: {
      id: string;
      language: string;
      langDoc: string;
      kind: number;
      captionKind?: 'manual' | 'auto' | 'translated' | 'transcript';
      isTranscriptFallback?: boolean;
    };
    isTranscriptFallback?: boolean;
    captionBody?: Cue[];
    captionText?: string;
    cues?: Cue[];
  };
  captionTrackCache?: {
    tracks?: SubtitleTrack[];
    selectedTrack?: SubtitleTrack;
    rawText?: string;
  };
  audioCache?: {
    audioUrl?: string;
    bandwidth?: number;
  };
  subtitle?: QueueItemSubtitle;
}

export interface QueueSettings {
  maxConcurrency: number;
  autoDownload: boolean;
  preferredFormat: 'md' | 'txt' | 'srt';
  enableNotification: boolean;
  sourceLanguage?: string;
}

export interface QueueInput {
  url?: string;
  cleanUrl?: string;
  targetId?: string;
  title?: string;
  author?: string;
  cover?: string;
  sourceLanguage?: string;
  processingIntent?: 'auto' | 'local-asr';
  platform?: Platform;
  /** Current page media identity captured by the content script. */
  mediaKey?: string;
  /** Current Bilibili page number when already known. */
  page?: number;
}

export interface BSEQueueNamespace {
  setDiagnosticReporter(reporter: ((event: Partial<DiagnosticEvent>) => void) | null): void;
  toListProjection(item: QueueItem | QueueListProjection): QueueListProjection | null;
  getQueue(options?: { hydrateText?: boolean }): Promise<QueueItem[]>;
  getQueueProjection(): Promise<QueueListProjection[]>;
  getQueueSummary(): Promise<{ total: number; pending: number; updatedAt: number }>;
  saveQueue(items: QueueItem[]): Promise<QueueItem[]>;
  getItem(id: string): Promise<QueueItem | null>;
  addToQueue(urlsOrIds: string | QueueInput | Array<string | QueueInput>, options?: { title?: string; author?: string; cover?: string; sourceLanguage?: string; processingIntent?: 'auto' | 'local-asr' }): Promise<QueueItem[]>;
  removeFromQueue(id: string): Promise<boolean>;
  clearCompleted(): Promise<number>;
  clearAll(): Promise<void>;
  retryItem(id: string): Promise<QueueItem | null>;
  getSettings(): Promise<QueueSettings>;
  saveSettings(settings: Partial<QueueSettings>): Promise<QueueSettings>;
  recoverStaleJobs(): Promise<QueueItem[]>;
  saveItem(item: QueueItem): Promise<boolean>;
  processBilibiliItem(item: QueueItem, signal: AbortSignal): Promise<void>;
  processYouTubeItem(item: QueueItem, signal: AbortSignal): Promise<void>;
  processPendingJobs(): Promise<void>;
  exportQueueMergedMarkdown(itemIds?: string[]): Promise<string>;
  normalizeVideoUrl(rawUrl: string): { platform: Platform; targetId: string; page?: number; cleanUrl: string } | null;
}

export interface BSEQueueOrchestratorNamespace {
  create(options: { drain: () => Promise<void> | void }): { wake(): Promise<void> };
}

export interface NativeHostError extends Error {
  code: string;
  hint: string;
  retriable: boolean;
}

export interface NativeHostProgress {
  type: 'progress';
  requestId: string;
  jobId: string;
  stage: string;
  percent: number;
  hint: string;
}

export type NativeHostSource =
  | { kind: 'youtube'; url: string }
  | { kind: 'remote'; url: string; backupUrls?: string[]; headers?: Record<string, string> };

export interface NativeHostTranscriptionRequest {
  jobId: string;
  sourceLanguage: string;
  title?: string;
  duration?: number;
  platformLanguage?: string;
  /** Exact browser-owned media identity, e.g. bili:<BVID>:cid<CID> or yt:<videoId>. */
  mediaKey?: string;
  asrContext?: ASRContextHint;
  source: NativeHostSource;
}

export interface NativeHostYouTubeCaptionRequest {
  jobId: string;
  sourceLanguage: string;
  subtitlePreference?: 'manual-first' | 'manual-only' | 'ai-first';
  source: Extract<NativeHostSource, { kind: 'youtube' }>;
}

export interface NativeHostYouTubeCaptionResult {
  cues: Cue[];
  language: string;
  langDoc: string;
  kind: 'manual' | 'auto' | 'translated';
}

export interface NativeHostTranscriptionResult {
  cues: Cue[];
  /** Echoed media identity. Protocol v2 clients use it to reject cross-media results. */
  mediaKey?: string;
  /** Opaque diagnostic identifier. SparkSub must not route on this value. */
  engine?: string;
  engineLabel?: string;
}

export interface NativeHostLocalASRCapability {
  available: boolean;
  supportsAutoLanguage: boolean;
  languages: string[];
}

export interface NativeHostCapabilities {
  protocolVersion: 1 | 2;
  /** Present only for the capability-driven v2 contract. */
  contract: 'sparkscribe.browser-native/2' | null;
  features: {
    localASR: NativeHostLocalASRCapability;
    youtubeCaptions: { available: boolean; preferences: string[] };
    remoteMedia: { youtube: boolean; bilibili: boolean };
    cancellation: { available: boolean };
    chunkedResults: { available: boolean; maxMessageBytes: number | null };
  };
}

export interface NativeHostNamespace {
  HOST_NAME: 'com.sparksub.transcriber';
  PROTOCOL_VERSION: 2;
  LEGACY_PROTOCOL_VERSION: 1;
  CONTRACT_ID: 'sparkscribe.browser-native/2';
  getCapabilities(options?: { force?: boolean }): Promise<NativeHostCapabilities>;
  ping(): Promise<{ alive: boolean; protocolVersion: 1 | 2; contract?: 'sparkscribe.browser-native/2' }>;
  fetchYouTubeCaptions(payload: NativeHostYouTubeCaptionRequest, options?: {
    onProgress?: (progress: NativeHostProgress) => void;
    signal?: AbortSignal;
  }): Promise<NativeHostYouTubeCaptionResult>;
  transcribe(payload: NativeHostTranscriptionRequest, options?: {
    onProgress?: (progress: NativeHostProgress) => void;
    signal?: AbortSignal;
  }): Promise<NativeHostTranscriptionResult>;
  cancel(jobId: string): Promise<any>;
  disconnect(): void;
}

export interface BSELanguageRoutingNamespace {
  EUROPEAN_CODES: readonly string[];
  SUPPORTED_SOURCE_LANGUAGES: readonly string[];
  normalize(value: unknown): string;
  canonicalLanguage(value: unknown): string;
  isCantonese(value: unknown): boolean;
  localASRSupport(capabilities: NativeHostCapabilities | null | undefined, sourceLanguage: string, platformLanguage?: string | null): boolean;
}

export interface BSEQueueUINamespace {
  SUPPORTED_SOURCE_LANGUAGES: readonly string[];
  requiredI18nKeys(): string[];
  sourceEngineLabel(item: Partial<QueueItem>): { key: string };
  safeFailurePresentation(item: Partial<QueueItem>): { code: string; hint: string; retriable: boolean };
  componentState(name: string, component?: { available?: boolean; detail?: string }): { key: string; detail: string };
  capabilityState(capabilities?: any, error?: { code?: string }): { key: string };
  createCapabilityProbeState(): {
    begin(): number;
    commit(revision: number, result?: { capabilities?: any; error?: { code?: string; message?: string } | null }): boolean;
    snapshot(): { phase: 'idle' | 'checking' | 'settled'; capabilities: any; error: { code?: string; message?: string } | null; revision: number };
  };
  enqueueWithLanguage(options: {
    urls: string[];
    sourceLanguage: string;
    sendMessage(message: any): Promise<any>;
  }): Promise<QueueItem[]>;
  saveDefaultLanguage(sourceLanguage: string, saveSettings: (partial: Partial<QueueSettings>) => Promise<QueueSettings>): Promise<QueueSettings>;
  loadDefaultLanguage(getSettings: () => Promise<QueueSettings>): Promise<string>;
  renderCapabilityPanel(panel: HTMLElement, status: HTMLElement, details: HTMLElement, capabilities: any, error: any, t: (key: string) => string): void;
  renderFailureCard(element: HTMLElement, item: Partial<QueueItem>, t: (key: string) => string): void;
}

export interface AiImageInput {
  dataUrl?: string;
  url?: string;
}

export interface AiMessage {
  role: string;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface AiSettings {
  endpoint: string;
  apiKey: string;
  /** General-purpose fallback used by subtitle polishing and legacy settings. */
  model: string;
  /** Canonical model for Learn workspace tasks. Old stored settings inherit `model` on read. */
  learnModel: string;
  /** Canonical model for Review workspace tasks. Old stored settings inherit `model` on read. */
  reviewModel: string;
  timeoutMs: number;
}

export interface AiProbeResult {
  available: boolean;
  protocol?: 'openai' | 'ollama';
  endpoint: string;
  model?: string;
  requestedModel?: string;
  returnedModel?: string;
  models?: string[];
  modelAvailable?: boolean;
  error?: string;
}

export interface AiModelTestResult extends AiProbeResult {
  latencyMs?: number;
  responsePreview?: string;
}

export interface AiVisualRequest {
  id?: string;
  chapterId?: string;
  label?: string;
  reason?: string;
  evidenceGoal?: string;
  contentHint?: string;
  samplingGoal?: string;
  timestamp?: number;
  targetSec?: number;
  windowStart?: number;
  windowEnd?: number;
  optimalSec?: number;
  timeStr?: string;
  videoDuration?: number;
  expectedSurface?: string;
  importance?: 'high' | 'medium' | 'low' | string;
  source?: 'manual' | 'planned' | 'auto';
}

export interface AiVisualPlanResult {
  strategy: 'llm' | 'fallback';
  failureKind?: 'request' | 'parse';
  error?: string;
  summary: string;
  chapters: Array<Record<string, any>>;
  visualRequests: AiVisualRequest[];
  visualEvidence: AiVisualRequest[];
}

export interface BSEAsrPolisherNamespace {
  probeLocalLlm(customEndpoint?: string, customApiKey?: string, customModel?: string): Promise<AiProbeResult>;
  probeLlm(customEndpoint?: string, customApiKey?: string, customModel?: string): Promise<AiProbeResult>;
  testLlm(customEndpoint?: string, customApiKey?: string, customModel?: string): Promise<AiModelTestResult>;
  invokeLlm(params?: {
    prompt?: string;
    system?: string;
    messages?: AiMessage[] | null;
    images?: Array<string | AiImageInput>;
    model?: string;
    scope?: 'default' | 'learn' | 'review';
    endpoint?: string;
    apiKey?: string;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal | null;
  }): Promise<{ text: string; model: string; usage?: object | null; raw?: any }>;
  getAiSettings(): Promise<AiSettings>;
  saveAiSettings(settings?: Partial<AiSettings>): Promise<AiSettings>;
  resolveAiModel(settings: Partial<AiSettings> | null | undefined, scope?: 'default' | 'learn' | 'review'): string;
  aiScopeForMode(mode?: string): 'learn' | 'review';
  buildPolishingPrompt(title: string, cues: Cue[], mediaContext?: MediaContextPack | null): string;
  buildTranslationPrompt(params?: { cues?: Cue[]; startIndex?: number; endIndex?: number; mediaContext?: MediaContextPack | null; sourceLanguage?: string; targetLanguage?: string }): string;
  applyPolishResult(cues: Cue[], polishedText: string, options?: { expectedTaskToken?: string; materializeCues?: boolean }): { cues: Cue[]; patches: Array<{ index: number; lineId: string; content: string }>; matchedCount: number; changedCount: number; mode: 'empty' | 'no_changes' | 'indexed' | 'positional' | 'unmatched' | 'token_missing' | 'token_mismatch'; ignoredCount: number; taskToken?: string };
  alignPolishedCues(cues: Cue[], polishedText: string): Cue[];
  extractKeyframeTimestamps(cues: Cue[], maxCount?: number): Array<{ timestamp: number; label: string }>;
  buildPlanningPrompt(params?: { title?: string; cues?: Cue[]; mediaContext?: MediaContextPack | null; manualFrames?: AiVisualRequest[] }): string;
  extractJsonFromText(rawText: string): any;
  normalizePlanChapters(parsed: any): Array<{ id: string; title: string; windowStart?: number; windowEnd?: number; coreConcept?: string }>;
  normalizeSamplingWindows(parsed: any): AiVisualRequest[];
  planVisualEvidence(params?: {
    title?: string;
    cues?: Cue[];
    mediaContext?: MediaContextPack | null;
    manualFrames?: AiVisualRequest[];
    videoDuration?: number;
    endpoint?: string;
    apiKey?: string;
    model?: string;
    onProgress?: (message: string) => void;
    signal?: AbortSignal | null;
  }): Promise<AiVisualPlanResult>;
  buildCourseNotePrompt(params?: Record<string, any>): string;
  generateCourseNotes(params?: {
    title?: string;
    cues?: Cue[];
    mediaContext?: MediaContextPack | null;
    screenshots?: string[];
    capturedFrames?: Array<AiImageInput & AiVisualRequest>;
    videoIR?: any;
    mode?: string;
    endpoint?: string;
    apiKey?: string;
    model?: string;
    onProgress?: (message: string) => void;
    signal?: AbortSignal | null;
  }): Promise<{ markdown: string; modelUsed?: string; mode?: string }>;
  polishCues(cues: Cue[], options?: Record<string, any>): Promise<{ cues: Cue[]; modelUsed?: string; elapsedMs?: number; changedCount?: number; alignmentMode?: string }>;
  DEFAULT_CONFIG: Readonly<AiSettings>;
  DEFAULT_ENDPOINT: string;
}

export interface BSEVisualDetectorNamespace {
  pickOptimalTimestamp(request: AiVisualRequest, videoDuration?: number): number;
  buildCandidateTimestamps(request?: AiVisualRequest, videoDuration?: number, maxSamples?: number): number[];
  selectBestCandidate(candidates?: VisualFrameCandidate[]): VisualFrameCandidate | null;
  compactSignature(signature?: number[], bins?: number): number[];
  evidenceBudgetForDuration(videoDuration?: number): number;
  selectEvidenceFrames(frames?: AiNoteFrame[], options?: { videoDuration?: number; maxFrames?: number }): AiNoteFrame[];
  selectPresentationFrames(frames?: AiNoteFrame[], options?: { videoDuration?: number; maxFrames?: number }): AiNoteFrame[];
  resolveRequestTimestamps(visualRequests?: AiVisualRequest[], videoDuration?: number): AiVisualRequest[];
}

export interface AiNoteFrame {
  dataUrl: string;
  timestamp: number;
  timeStr?: string;
  label?: string;
  reason?: string;
  chapterId?: string;
  expectedSurface?: string;
  evidenceGoal?: string;
  importance?: string;
  source?: 'manual' | 'planned' | 'auto';
  selection?: CapturedFrame['selection'];
}

export type AiArtifactMode = 'course_notes' | 'keypoints' | 'concept_deep' | 'summary' | 'deep_qa' | 'error_check';

export interface BSEAiNoteCacheNamespace {
  save(note: { mediaKey: string; markdown: string; imagesMap?: Record<string, AiNoteFrame> | Map<string, AiNoteFrame>; mode?: AiArtifactMode; title?: string; sourceUrl?: string; sourceCueFingerprint?: string }): Promise<boolean>;
  load(mediaKey: string, mode?: AiArtifactMode, options?: { signal?: AbortSignal | null }): Promise<{ markdown: string; mode: AiArtifactMode; title: string; mediaKey: string; sourceUrl?: string; sourceCueFingerprint?: string; imagesMap: Record<string, AiNoteFrame>; updatedAt?: number } | null>;
  listModes(mediaKey: string): Promise<Array<{ mode: AiArtifactMode; updatedAt: number; title: string }>>;
  listModesMany(mediaKeys: string[]): Promise<Record<string, Array<{ mode: AiArtifactMode; updatedAt: number; title: string }>>>;
  remove(mediaKey: string, options?: { updateIndex?: boolean; mode?: AiArtifactMode }): Promise<void>;
  sweep(): Promise<{ evicted: number; frameBytes: number; noteCount?: number }>;
  getStats(): Promise<{ noteCount: number; frameBytes: number; maxFrameBytes?: number; maxNotes?: number }>;
  canonicalizeFrames(imagesMap?: Record<string, AiNoteFrame> | Map<string, AiNoteFrame>): AiNoteFrame[];
  buildRuntimeImagesMap(frames?: AiNoteFrame[]): Record<string, AiNoteFrame>;
  LIMITS: Readonly<{ maxNotes: number; maxFrameBytes: number; maxAgeMs: number }>;
}

export interface BSETrackerNamespace {
  getSubscriptions(): Promise<TrackedSubscription[]>;
  getTrackerSummary(): Promise<{ total: number; unread: number; updatedAt: number }>;
  getSubscription(id: string): Promise<TrackedSubscription | null>;
  addSubscription(sub: Partial<TrackedSubscription>): Promise<TrackedSubscription>;
  removeSubscription(id: string): Promise<boolean>;
  renameSubscription(id: string, newTitle: string): Promise<boolean>;
  markAsRead(subscriptionId: string, itemId?: string): Promise<void>;
  markAllAsRead(): Promise<void>;
  getUnreadItems(subscription: TrackedSubscription): TrackedItem[];
  getTrackedItemMediaKey(item: TrackedItem): string;
  getCachedSubtitleForItem(subscriptionId: string, itemId: string): Promise<TrackedItemSubtitle | null>;
  getCachedSubtitlesForItems(requests: Array<{ subscriptionId: string; itemId: string }>): Promise<Array<{ subscriptionId: string; itemId: string; subtitle: TrackedItemSubtitle | null }>>;
  getSettings(): Promise<TrackerSettings>;
  saveSettings(settings: Partial<TrackerSettings>): Promise<TrackerSettings>;
  getStorageStats(subscriptions?: TrackedSubscription[]): { subscriptionCount: number; itemCount: number; cachedSubtitleCount: number; evictedCount: number; approximateBytes: number };
  saveSubscriptions(subscriptions: TrackedSubscription[]): Promise<boolean>;
  repairSubscriptionMetadata(sub: TrackedSubscription, options?: { signal?: AbortSignal; activeBvid?: string; persist?: boolean }): Promise<{ checked: boolean; updated: boolean; avatar?: string; error?: string }>;
  checkSubscriptionUpdates(sub: TrackedSubscription, options?: { signal?: AbortSignal; activeBvid?: string; persist?: boolean }): Promise<{ checked: boolean; initialized?: boolean; updated: boolean; newItems: TrackedItem[]; error?: string }>;
  checkAllUpdates(): Promise<{ totalUnread: number; updatedSubs: Array<{ id: string; title: string; newItemCount: number }> }>;
  fetchItemSubtitle(item: TrackedItem, options?: { signal?: AbortSignal }): Promise<TrackedItemSubtitle>;
  fetchSubtitleForItem(subscriptionId: string, itemId: string): Promise<TrackedItemSubtitle>;
  exportMergedMarkdown(items: TrackedItem[]): string;
  exportConfigJson(): Promise<string>;
  importConfigJson(jsonStr: string): Promise<{ importedCount: number; totalCount: number }>;
  parseYouTubeRssFeed(xmlText: string): TrackedItem[];
  calculateWbiSign(params: Record<string, any>, imgKey: string, subKey: string): { params: Record<string, any>; query: string };
}

export interface BSENamespace {
  VERSION: string;
  PLATFORM: {
    YOUTUBE: 'youtube';
    BILIBILI: 'bilibili';
  };
  Utils: BSEUtilsNamespace;
  Parsers: BSEParsersNamespace;
  Media?: BSEMediaNamespace;
  MediaContext?: BSEMediaContextNamespace;
  Formatters: BSEFormattersNamespace;
  BatchExport: BSEBatchExportNamespace;
  Tracker?: BSETrackerNamespace;
  Queue?: BSEQueueNamespace;
  QueueOrchestrator?: BSEQueueOrchestratorNamespace;
  NativeHost?: NativeHostNamespace;
  LanguageRouting?: BSELanguageRoutingNamespace;
  QueueUI?: BSEQueueUINamespace;
  Diagnostics: DiagnosticsModule;
  DiagnosticPresenter?: { create(options?: { limit?: number; perSessionLimit?: number; now?: () => Date; store?: DiagnosticStore }): DiagnosticPresenter };
  YouTube: BSEPlatformNamespace;
  Bilibili: BSEPlatformNamespace;
  I18n?: BSEI18nNamespace;
  JSZip?: any;
  RollingPanel?: any;
  DICTIONARIES?: Record<string, Record<string, string>>;
  THEMES?: string[];
  LANGUAGES?: string[];
  AsrPolisher?: BSEAsrPolisherNamespace;
  Ai?: BSEAsrPolisherNamespace;
  VisualDetector?: BSEVisualDetectorNamespace;
  AiNoteCache?: BSEAiNoteCacheNamespace;
}

declare global {
  var BSE: BSENamespace;
  interface GlobalThis {
    BSE: BSENamespace;
  }
  interface Window {
    BSE: BSENamespace;
    __BSE_MAIN_BRIDGE_INSTALLED__?: boolean;
    __BSE_CONTENT_APP_INSTALLED__?: boolean;
    ytInitialPlayerResponse?: any;
    ytInitialData?: any;
    ytcfg?: { get?: (key: string) => any };
  }
  interface Navigator {
    connection?: { saveData?: boolean };
  }
}
