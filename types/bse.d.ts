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
  isTranslatable?: boolean;
}

export interface ErrorFault {
  stage: string;
  code: string;
  message: string;
  hint: string;
  time?: string;
}

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticScope = 'media' | 'queue' | 'native' | 'batch' | 'tracker' | 'system';

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
  events(filter?: { scope?: DiagnosticScope; sessionId?: string; minLevel?: DiagnosticLevel }): DiagnosticEvent[];
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
  selectScope(scope: 'media' | 'queue' | 'native' | 'batch'): void;
  setDetailed(value: boolean): void;
  visibleEvents(): DiagnosticEvent[];
  statusEvents(): DiagnosticEvent[];
  activityEvents(state: Partial<AppState>): DiagnosticEvent[];
  statusItem(event: DiagnosticEvent): { id: string; tone: 'success' | 'running' | 'warning' | 'error' | 'info'; title: string; detail: string; time: string };
  summarizeState(state: Partial<AppState>): { tone: 'success' | 'running' | 'warning' | 'error' | 'info'; label: string; title: string; detail: string };
  technicalEvents(): DiagnosticEvent[];
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
  diagnosticSessionId: string;
  diagnostics: DiagnosticEvent[];
  authorInfo?: {
    name: string;
    targetId: string;
    mid?: string;
    channelId?: string;
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

export interface BilibiliTree {
  kind: 'ugc_season' | 'multi_page' | 'single' | 'bpx_eplist';
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

export interface BatchConfig {
  scope: 'all' | 'current-page' | 'current-video' | 'video' | 'section' | 'range' | 'custom';
  targetBvid?: string;
  sectionKey?: string;
  rangeStart?: number;
  rangeEnd?: number;
  customIndices?: number[] | Set<number>;
  outputMode: 'zip' | 'merged-md';
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
    lan?: string;
    label?: string;
    lan_doc?: string;
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

export interface BatchControlTask {
  controller?: AbortController;
  running?: boolean;
  paused?: boolean;
  cancelled?: boolean;
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

export interface AiPromptPreset {
  id: string;
  icon: string;
  text: string;
  prompt: string;
}

// Global BSE namespace
export interface BSEUtilsNamespace {
  detectPlatform(hostname?: string): Platform | null;
  getYouTubeVideoId(url?: string): string | null;
  getBvid(url?: string): string | null;
  getBilibiliPage(url?: string): number;
  getActiveCidFromDom?(): string | null;
  getMediaKey(platform?: Platform | null): string | null;
  delay(ms: number, signal?: AbortSignal): Promise<void>;
  fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response>;
  formatClock(seconds: number): string;
  sanitizeFilename(value: string): string;
  findActiveCueIndex(cues: Cue[], time: number, previousIndex?: number): number;
  downloadBlob(blob: Blob, filename: string): void;
  downloadText(text: string, filename: string, mime?: string): void;
  SessionSnapshotManager: {
    getSnapshots(): any[];
    findSnapshot(mediaKey: string): any;
    saveSnapshot(mediaKey: string, data: any): void;
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
}

export interface BSEFormattersNamespace {
  mergeParagraphs(cues: Cue[]): string;
  toTxt(cues: Cue[], withTimestamp?: boolean): string;
  toSrt(cues: Cue[]): string;
  toMarkdown(cues: Cue[], metadata?: MetadataOptions, options?: FormatOptions): string;
  toMergedMarkdown(tree: BilibiliTree, results: any, stats?: any, options?: FormatOptions): string;
  buildBatchManifest(tree: BilibiliTree, selectedItems: BilibiliItem[], results: any, stats?: any, config?: any): any;
  AI_PROMPTS: AiPromptPreset[];
  generateAiPrompt(promptIdOrText: string, cues: Cue[], withTimestamp?: boolean): string;
  format(type: string, cues: Cue[], metadata?: MetadataOptions, options?: FormatOptions): string;
}

export interface BSEPlatformNamespace {
  discoverTracks(options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void }): Promise<SubtitleTrack[]>;
  loadTrack(track: SubtitleTrack, options?: { signal?: AbortSignal; diagnostic?: (stage: string, message: string) => void }): Promise<Cue[]>;
  rememberRequest?(request: CapturedCaptionRequest): void;
  bridgeRequest?(type: string, payload?: any, timeoutMs?: number): Promise<any>;
  fetchMediaTree?(currentBvid?: string, options?: any): Promise<BilibiliTree>;
  runBatchExport?(tree: BilibiliTree, config: BatchConfig, onProgress?: (stats: BatchProgressStats, currentItem: BilibiliItem | null, phase: string, task: BatchControlTask) => void, controlTask?: BatchControlTask): Promise<any>;
  chooseBilibiliSubtitle?(subList: any[], preference?: string): any;
}

export interface BSEI18nNamespace {
  t(key: string, params?: Record<string, any>): string;
  getLocale(): string;
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

export interface QueueItemSubtitle {
  language: string;
  langDoc: string;
  cueCount: number;
  plainText: string;
  markdown: string;
  srt?: string;
  cues?: Cue[];
  source?: 'platform' | 'native';
  engine?: string;
  captionKind?: 'manual' | 'auto' | 'translated' | 'transcript';
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

export interface BSEQueueNamespace {
  setDiagnosticReporter(reporter: ((event: Partial<DiagnosticEvent>) => void) | null): void;
  getQueue(): Promise<QueueItem[]>;
  saveQueue(items: QueueItem[]): Promise<QueueItem[]>;
  getItem(id: string): Promise<QueueItem | null>;
  addToQueue(urlsOrIds: string | string[], options?: { title?: string; author?: string; cover?: string; sourceLanguage?: string }): Promise<QueueItem[]>;
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
  source: NativeHostSource;
}

export interface NativeHostYouTubeCaptionRequest {
  jobId: string;
  sourceLanguage: string;
  source: Extract<NativeHostSource, { kind: 'youtube' }>;
}

export interface NativeHostYouTubeCaptionResult {
  cues: Cue[];
  language: string;
  langDoc: string;
  kind: 'manual' | 'auto' | 'translated';
}

export interface NativeHostNamespace {
  HOST_NAME: 'com.sparksub.transcriber';
  PROTOCOL_VERSION: 1;
  getCapabilities(options?: { force?: boolean }): Promise<any>;
  fetchYouTubeCaptions(payload: NativeHostYouTubeCaptionRequest, options?: {
    onProgress?: (progress: NativeHostProgress) => void;
    signal?: AbortSignal;
  }): Promise<NativeHostYouTubeCaptionResult>;
  transcribe(payload: NativeHostTranscriptionRequest, options?: {
    onProgress?: (progress: NativeHostProgress) => void;
    signal?: AbortSignal;
  }): Promise<Cue[]>;
  cancel(jobId: string): Promise<any>;
  disconnect(): void;
}

export interface BSELanguageRoutingNamespace {
  EUROPEAN_CODES: readonly string[];
  SUPPORTED_SOURCE_LANGUAGES: readonly string[];
  normalize(value: unknown): string;
  isCantonese(value: unknown): boolean;
  engineFor(sourceLanguage: string, platformLanguage?: string, sourceKind?: 'youtube' | 'remote'): 'parakeet' | 'cohere' | null;
}

export interface BSEQueueUINamespace {
  SUPPORTED_SOURCE_LANGUAGES: readonly string[];
  requiredI18nKeys(): string[];
  nativeEngineFor(item: Partial<QueueItem> & { platformLanguage?: string }): 'parakeet' | 'cohere' | null;
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

export interface BSETrackerNamespace {
  getSubscriptions(): Promise<TrackedSubscription[]>;
  getSubscription(id: string): Promise<TrackedSubscription | null>;
  addSubscription(sub: Partial<TrackedSubscription>): Promise<TrackedSubscription>;
  removeSubscription(id: string): Promise<boolean>;
  renameSubscription(id: string, newTitle: string): Promise<boolean>;
  markAsRead(subscriptionId: string, itemId?: string): Promise<void>;
  markAllAsRead(): Promise<void>;
  getSettings(): Promise<TrackerSettings>;
  saveSettings(settings: Partial<TrackerSettings>): Promise<TrackerSettings>;
  getStorageStats(subscriptions?: TrackedSubscription[]): { subscriptionCount: number; itemCount: number; cachedSubtitleCount: number; evictedCount: number; approximateBytes: number };
  checkSubscriptionUpdates(sub: TrackedSubscription, options?: { signal?: AbortSignal }): Promise<{ checked: boolean; initialized?: boolean; updated: boolean; newItems: TrackedItem[]; error?: string }>;
  checkAllUpdates(): Promise<{ totalUnread: number; updatedSubs: string[] }>;
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
  Formatters: BSEFormattersNamespace;
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
}

declare global {
  var BSE: BSENamespace;
  interface Window {
    BSE: BSENamespace;
    __BSE_MAIN_BRIDGE_INSTALLED__?: boolean;
  }
}
