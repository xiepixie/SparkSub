(() => {
  'use strict';

  /** @type {import('../types/bse').BSENamespace} */
  const BSE = globalThis.BSE;

  const DB_NAME = 'bse_ai_media_v1';
  const DB_VERSION = 1;
  const FRAME_STORE = 'frames';
  const NOTE_KEY_PREFIX = 'bse_ai_note_v2_';
  const LEGACY_NOTE_KEY_PREFIX = 'bse_ai_note_';
  const NOTE_INDEX_KEY = 'bse_ai_note_index_v2';
  const MAX_CACHED_NOTES = 30;
  const MAX_FRAME_BYTES = 80 * 1024 * 1024;
  const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const LRU_TOUCH_INTERVAL_MS = 60 * 1000;
  const RECORD_MEMORY_TTL_MS = 30 * 1000;
  const RECORD_MEMORY_LIMIT = 2;

  let dbPromise = null;
  let sweepPromise = null;
  let sweepTimer = null;
  const saveLocks = new Map();
  const recordMemoryCache = new Map();
  const lruTouchMemory = new Map();

  function storageArea() {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  }

  function noteKey(mediaKey) {
    return `${NOTE_KEY_PREFIX}${mediaKey}`;
  }

  function legacyNoteKey(mediaKey) {
    return `${LEGACY_NOTE_KEY_PREFIX}${mediaKey}`;
  }

  function normalizeMode(mode) {
    return ['course_notes', 'keypoints', 'concept_deep', 'summary', 'deep_qa', 'error_check'].includes(String(mode || ''))
      ? String(mode)
      : 'course_notes';
  }

  function normalizeStoredRecord(record) {
    if (!record || typeof record !== 'object') return { artifacts: {}, updatedAt: 0, cacheVersion: 3 };
    if (record.artifacts && typeof record.artifacts === 'object') {
      const artifacts = {};
      for (const [mode, artifact] of Object.entries(record.artifacts)) {
        if (!artifact?.markdown) continue;
        const normalizedMode = normalizeMode(mode || artifact.mode);
        artifacts[normalizedMode] = { ...artifact, mode: normalizedMode };
      }
      return {
        ...record,
        artifacts,
        updatedAt: Number(record.updatedAt) || Math.max(0, ...Object.values(artifacts).map((artifact) => Number(artifact.updatedAt) || 0)),
        cacheVersion: 3
      };
    }
    if (record.markdown) {
      const mode = normalizeMode(record.mode);
      return {
        artifacts: {
          [mode]: {
            markdown: record.markdown,
            mode,
            title: record.title || '课程笔记',
            frameRefs: Array.isArray(record.frameRefs) ? record.frameRefs : [],
            updatedAt: Number(record.updatedAt) || 0
          }
        },
        updatedAt: Number(record.updatedAt) || 0,
        cacheVersion: 3
      };
    }
    return { artifacts: {}, updatedAt: 0, cacheVersion: 3 };
  }

  function recordFrameBytes(record) {
    const normalized = normalizeStoredRecord(record);
    return Object.values(normalized.artifacts).reduce((sum, artifact) => (
      sum + (artifact.frameRefs || []).reduce((frameSum, ref) => frameSum + Math.max(0, Number(ref?.bytes) || 0), 0)
    ), 0);
  }

  function artifactModeSummaries(record) {
    const normalized = normalizeStoredRecord(record);
    return Object.values(normalized.artifacts)
      .filter((artifact) => artifact?.markdown)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .map((artifact) => ({
        mode: normalizeMode(artifact.mode),
        updatedAt: Number(artifact.updatedAt) || 0,
        title: String(artifact.title || '')
      }));
  }

  function rememberRecord(mediaKey, record) {
    const key = String(mediaKey || '').trim();
    if (!key || !record) return;
    recordMemoryCache.delete(key);
    recordMemoryCache.set(key, { record: normalizeStoredRecord(record), cachedAt: Date.now() });
    while (recordMemoryCache.size > RECORD_MEMORY_LIMIT) {
      recordMemoryCache.delete(recordMemoryCache.keys().next().value);
    }
  }

  function readRememberedRecord(mediaKey) {
    const key = String(mediaKey || '').trim();
    const cached = recordMemoryCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > RECORD_MEMORY_TTL_MS) {
      recordMemoryCache.delete(key);
      return null;
    }
    recordMemoryCache.delete(key);
    recordMemoryCache.set(key, cached);
    return cached.record;
  }

  function forgetRecord(mediaKey) {
    recordMemoryCache.delete(String(mediaKey || '').trim());
  }

  function normalizeIndex(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => entry && typeof entry.mediaKey === 'string')
      .map((entry) => ({
        mediaKey: entry.mediaKey,
        updatedAt: Number(entry.updatedAt) || 0,
        frameBytes: Math.max(0, Number(entry.frameBytes) || 0),
        modes: Array.isArray(entry.modes)
          ? entry.modes
              .filter((mode) => mode && typeof mode.mode === 'string')
              .map((mode) => ({
                mode: normalizeMode(mode.mode),
                updatedAt: Number(mode.updatedAt) || 0,
                title: String(mode.title || '')
              }))
          : null
      }));
  }

  function canonicalizeFrames(imagesMap = {}) {
    const values = imagesMap instanceof Map ? [...imagesMap.values()] : Object.values(imagesMap || {});
    const byData = new Map();
    for (const frame of values) {
      if (!frame || typeof frame !== 'object' || typeof frame.dataUrl !== 'string' || !frame.dataUrl.startsWith('data:image/')) continue;
      if (byData.has(frame.dataUrl)) continue;
      const timestamp = Number(frame.timestamp);
      byData.set(frame.dataUrl, {
        dataUrl: frame.dataUrl,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        timeStr: frame.timeStr || '',
        label: frame.label || '',
        reason: frame.reason || '',
        chapterId: frame.chapterId || '',
        expectedSurface: frame.expectedSurface || '',
        evidenceGoal: frame.evidenceGoal || '',
        importance: frame.importance || '',
        source: frame.source || ''
      });
    }
    return [...byData.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  function dataUrlToBlob(dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!match) throw new Error('INVALID_IMAGE_DATA_URL');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || 'image/webp' });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('IMAGE_READ_FAILED'));
      reader.readAsDataURL(blob);
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    const opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FRAME_STORE)) {
          const store = db.createObjectStore(FRAME_STORE, { keyPath: 'id' });
          store.createIndex('mediaKey', 'mediaKey', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('AI_NOTE_DB_OPEN_FAILED'));
    });
    dbPromise = opening.catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE, mode);
      const store = tx.objectStore(FRAME_STORE);
      let operationResult;
      try {
        operationResult = operation(store, tx);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(operationResult);
      tx.onerror = () => reject(tx.error || new Error('AI_NOTE_DB_TRANSACTION_FAILED'));
      tx.onabort = () => reject(tx.error || new Error('AI_NOTE_DB_TRANSACTION_ABORTED'));
    });
  }

  async function deleteFramesForMedia(mediaKey, keepIds = null) {
    if (!mediaKey) return;
    await withStore('readwrite', (store) => {
      const index = store.index('mediaKey');
      const request = index.openCursor(IDBKeyRange.only(mediaKey));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!keepIds || !keepIds.has(String(cursor.primaryKey))) cursor.delete();
        cursor.continue();
      };
    });
  }

  async function deleteFrameRefs(refs = []) {
    const ids = (Array.isArray(refs) ? refs : []).map((ref) => ref?.id).filter(Boolean);
    if (!ids.length) return;
    await withStore('readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
    });
  }

  async function writeFrames(mediaKey, frames) {
    // 新图片先写入独立版本，不碰上一版。只有 chrome.storage 中的 note 指针提交成功后，
    // 才清理旧版本，从而避免“图片已替换、Markdown 元数据写失败”造成旧报告指向新图。
    // Base64 -> Blob conversion can briefly double image memory, so persist in
    // tiny batches instead of materializing every screenshot Blob at once.
    const frameSetId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const updatedAt = Date.now();
    const refs = [];
    let frameBytes = 0;
    const batchSize = 2;
    try {
      for (let start = 0; start < frames.length; start += batchSize) {
        const batch = frames.slice(start, start + batchSize).map((frame, offset) => {
          const index = start + offset;
          const blob = dataUrlToBlob(frame.dataUrl);
          return {
            id: `${mediaKey}:${frameSetId}:${index + 1}`,
            mediaKey,
            frameSetId,
            timestamp: frame.timestamp,
            timeStr: frame.timeStr,
            label: frame.label,
            reason: frame.reason,
            chapterId: frame.chapterId,
            expectedSurface: frame.expectedSurface,
            evidenceGoal: frame.evidenceGoal,
            importance: frame.importance,
            source: frame.source,
            blob,
            bytes: blob.size,
            updatedAt
          };
        });
        await withStore('readwrite', (store) => {
          batch.forEach((record) => store.put(record));
        });
        for (const { id, timestamp, timeStr, label, reason, chapterId, expectedSurface, evidenceGoal, importance, source, bytes } of batch) {
          refs.push({ id, timestamp, timeStr, label, reason, chapterId, expectedSurface, evidenceGoal, importance, source, bytes });
          frameBytes += bytes;
        }
      }
    } catch (error) {
      await deleteFrameRefs(refs).catch(() => {});
      throw error;
    }

    return { refs, frameBytes };
  }

  async function readFrameRecord(id) {
    if (!id) return null;
    return await withStore('readonly', (store) => new Promise((resolve) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    }));
  }

  async function readFrames(refs = [], { signal = null } = {}) {
    if (!Array.isArray(refs) || !refs.length) return [];
    const frames = new Array(refs.length);
    let nextRecordIndex = 0;
    const worker = async () => {
      while (nextRecordIndex < refs.length) {
        if (signal?.aborted) return;
        const index = nextRecordIndex++;
        const record = await readFrameRecord(refs[index]?.id);
        if (signal?.aborted) return;
        if (!record?.blob) continue;
        try {
          const dataUrl = await blobToDataUrl(record.blob);
          if (signal?.aborted) return;
          frames[index] = {
            dataUrl,
            timestamp: Number(record.timestamp) || 0,
            timeStr: record.timeStr || '',
            label: record.label || '',
            reason: record.reason || '',
            chapterId: record.chapterId || '',
            expectedSurface: record.expectedSurface || '',
            evidenceGoal: record.evidenceGoal || '',
            importance: record.importance || '',
            source: record.source || ''
          };
        } catch {}
      }
    };
    const concurrency = Math.min(2, refs.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (signal?.aborted) return [];
    return frames.filter(Boolean);
  }

  function buildRuntimeImagesMap(frames = []) {
    const imagesMap = {};
    for (const frame of frames) {
      const sec = Number(frame.timestamp) || 0;
      const timeStr = frame.timeStr || (BSE.Utils?.formatClock ? BSE.Utils.formatClock(sec) : `${Math.round(sec)}s`);
      const runtimeFrame = { ...frame, timestamp: sec, timeStr };
      imagesMap[String(sec)] = runtimeFrame;
      imagesMap[timeStr] = runtimeFrame;
    }
    return imagesMap;
  }

  async function remove(mediaKey, { updateIndex = true, mode = '' } = {}) {
    if (!mediaKey) return;
    const storage = storageArea();
    if (!storage) {
      await deleteFramesForMedia(mediaKey).catch(() => {});
      return;
    }

    const normalizedMode = mode ? normalizeMode(mode) : '';
    if (normalizedMode) {
      const result = await storage.get(noteKey(mediaKey)).catch(() => ({}));
      const current = normalizeStoredRecord(result?.[noteKey(mediaKey)] || null);
      const artifact = current.artifacts[normalizedMode];
      if (!artifact) return;
      await deleteFrameRefs(artifact.frameRefs || []).catch(() => {});
      delete current.artifacts[normalizedMode];
      const remaining = Object.values(current.artifacts);
      if (remaining.length) {
        current.updatedAt = Math.max(...remaining.map((entry) => Number(entry.updatedAt) || 0), Date.now());
        await storage.set({ [noteKey(mediaKey)]: current }).catch(() => {});
        if (updateIndex) {
          const indexResult = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
          const index = normalizeIndex(indexResult?.[NOTE_INDEX_KEY]);
          const existing = index.find((entry) => entry.mediaKey === mediaKey);
          const nextEntry = {
            mediaKey,
            updatedAt: current.updatedAt,
            frameBytes: recordFrameBytes(current),
            modes: artifactModeSummaries(current)
          };
          await storage.set({
            [NOTE_INDEX_KEY]: [nextEntry, ...index.filter((entry) => entry !== existing && entry.mediaKey !== mediaKey)]
          }).catch(() => {});
        }
        rememberRecord(mediaKey, current);
        lruTouchMemory.set(mediaKey, current.updatedAt);
        return;
      }
    }

    forgetRecord(mediaKey);
    lruTouchMemory.delete(mediaKey);
    await deleteFramesForMedia(mediaKey).catch(() => {});
    await storage.remove([noteKey(mediaKey), legacyNoteKey(mediaKey)]).catch(() => {});
    if (updateIndex) {
      const result = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
      const index = normalizeIndex(result?.[NOTE_INDEX_KEY]).filter((entry) => entry.mediaKey !== mediaKey);
      await storage.set({ [NOTE_INDEX_KEY]: index }).catch(() => {});
    }
  }

  async function sweep() {
    if (sweepTimer) {
      clearTimeout(sweepTimer);
      sweepTimer = null;
    }
    if (sweepPromise) return sweepPromise;
    sweepPromise = (async () => {
      const storage = storageArea();
      if (!storage) return { evicted: 0, frameBytes: 0 };
      const result = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
      const now = Date.now();
      const index = normalizeIndex(result?.[NOTE_INDEX_KEY]).sort((a, b) => b.updatedAt - a.updatedAt);
      const keep = [];
      const evict = [];
      let frameBytes = 0;

      for (const entry of index) {
        const expired = !entry.updatedAt || now - entry.updatedAt > MAX_CACHE_AGE_MS;
        const overCount = keep.length >= MAX_CACHED_NOTES;
        const overBytes = frameBytes + entry.frameBytes > MAX_FRAME_BYTES;
        if (expired || overCount || overBytes) {
          evict.push(entry);
        } else {
          keep.push(entry);
          frameBytes += entry.frameBytes;
        }
      }

      for (const entry of evict) {
        await remove(entry.mediaKey, { updateIndex: false });
      }
      await storage.set({ [NOTE_INDEX_KEY]: keep }).catch(() => {});
      return { evicted: evict.length, frameBytes, noteCount: keep.length };
    })().finally(() => {
      sweepPromise = null;
    });
    return sweepPromise;
  }

  function scheduleSweep(delayMs = 250) {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      void sweep().catch(() => {});
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function saveCommitted(note, mediaKey) {
    const storage = storageArea();
    if (!storage) return false;

    const mode = normalizeMode(note.mode);
    const frames = canonicalizeFrames(note.imagesMap || {});
    const [indexResult, recordResult] = await Promise.all([
      storage.get(NOTE_INDEX_KEY).catch(() => ({})),
      storage.get(noteKey(mediaKey)).catch(() => ({}))
    ]);
    const previousIndex = normalizeIndex(indexResult?.[NOTE_INDEX_KEY]).filter((entry) => entry.mediaKey !== mediaKey);
    const previousRecord = normalizeStoredRecord(recordResult?.[noteKey(mediaKey)] || null);
    const previousArtifact = previousRecord.artifacts[mode] || null;
    const { refs } = await writeFrames(mediaKey, frames);
    const updatedAt = Date.now();
    const nextRecord = {
      ...previousRecord,
      artifacts: {
        ...previousRecord.artifacts,
        [mode]: {
          markdown: note.markdown,
          mode,
          title: note.title || '课程笔记',
          sourceUrl: String(note.sourceUrl || '').slice(0, 2048),
          sourceCueFingerprint: String(note.sourceCueFingerprint || '').slice(0, 96),
          frameRefs: refs,
          updatedAt
        }
      },
      updatedAt,
      cacheVersion: 3
    };
    const nextIndex = [{
      mediaKey,
      updatedAt,
      frameBytes: recordFrameBytes(nextRecord),
      modes: artifactModeSummaries(nextRecord)
    }, ...previousIndex];

    try {
      // One media record owns multiple independent learning artifacts. Replacing
      // one mode must not discard the user's summary, notes, or self-test from
      // the other modes.
      await storage.set({
        [noteKey(mediaKey)]: nextRecord,
        [NOTE_INDEX_KEY]: nextIndex
      });
    } catch (error) {
      await deleteFrameRefs(refs).catch(() => {});
      throw error;
    }

    await storage.remove(legacyNoteKey(mediaKey)).catch(() => {});
    if (previousArtifact?.frameRefs?.length) {
      await deleteFrameRefs(previousArtifact.frameRefs).catch(() => {});
    }
    rememberRecord(mediaKey, nextRecord);
    lruTouchMemory.set(mediaKey, updatedAt);
    return true;
  }

  async function save(note) {
    const mediaKey = String(note?.mediaKey || '').trim();
    if (!mediaKey || !note?.markdown) return false;

    const previous = saveLocks.get(mediaKey) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => saveCommitted(note, mediaKey));
    saveLocks.set(mediaKey, run);

    try {
      const saved = await run;
      if (saveLocks.get(mediaKey) === run) saveLocks.delete(mediaKey);
      if (saved) scheduleSweep();
      return saved;
    } catch (error) {
      if (saveLocks.get(mediaKey) === run) saveLocks.delete(mediaKey);
      throw error;
    }
  }

  async function load(mediaKey, mode = '', { signal = null } = {}) {
    mediaKey = String(mediaKey || '').trim();
    if (!mediaKey) return null;
    const storage = storageArea();
    if (!storage) return null;

    let record = readRememberedRecord(mediaKey);
    if (!record) {
      let result = await storage.get([noteKey(mediaKey), legacyNoteKey(mediaKey)]).catch(() => ({}));
      let rawRecord = result?.[noteKey(mediaKey)] || null;
      const legacy = result?.[legacyNoteKey(mediaKey)] || null;

      if (!rawRecord && legacy?.markdown) {
        await save({ ...legacy, mediaKey });
        result = await storage.get(noteKey(mediaKey)).catch(() => ({}));
        rawRecord = result?.[noteKey(mediaKey)] || null;
      }
      record = normalizeStoredRecord(rawRecord);
      if (Object.keys(record.artifacts).length) rememberRecord(mediaKey, record);
    }
    const requestedMode = mode ? normalizeMode(mode) : '';
    const artifact = requestedMode
      ? record.artifacts[requestedMode]
      : Object.values(record.artifacts).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    if (!artifact?.markdown) return null;

    const now = Date.now();
    const artifactUpdatedAt = Number(artifact.updatedAt) || 0;
    if (artifactUpdatedAt > 0 && now - artifactUpdatedAt > MAX_CACHE_AGE_MS) {
      await remove(mediaKey, { mode: artifact.mode || requestedMode || 'course_notes' }).catch(() => {});
      return null;
    }

    const frames = await readFrames(artifact.frameRefs || [], { signal });
    if (signal?.aborted) return null;
    const imagesMap = buildRuntimeImagesMap(frames);

    const lastTouch = Number(lruTouchMemory.get(mediaKey)) || 0;
    if (now - lastTouch >= LRU_TOUCH_INTERVAL_MS) {
      const indexResult = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
      const index = normalizeIndex(indexResult?.[NOTE_INDEX_KEY]);
      const current = index.find((entry) => entry.mediaKey === mediaKey);
      if (current && (index[0]?.mediaKey !== mediaKey || now - current.updatedAt >= LRU_TOUCH_INTERVAL_MS)) {
        current.updatedAt = now;
        const reordered = [current, ...index.filter((entry) => entry.mediaKey !== mediaKey)];
        await storage.set({ [NOTE_INDEX_KEY]: reordered }).catch(() => {});
      }
      lruTouchMemory.set(mediaKey, now);
    }
    return {
      markdown: artifact.markdown,
      mode: artifact.mode || requestedMode || 'course_notes',
      title: artifact.title || '课程笔记',
      mediaKey,
      sourceUrl: String(artifact.sourceUrl || ''),
      sourceCueFingerprint: String(artifact.sourceCueFingerprint || ''),
      imagesMap,
      updatedAt: Number(artifact.updatedAt) || 0
    };
  }

  async function listModesMany(mediaKeys = []) {
    const keys = [...new Set((Array.isArray(mediaKeys) ? mediaKeys : [])
      .map((key) => String(key || '').trim())
      .filter(Boolean))];
    if (!keys.length) return {};
    const storage = storageArea();
    if (!storage) return {};

    // All aliases share the same tiny index. Read it once, then only fetch
    // records for keys whose legacy entries are missing mode metadata.
    const indexResult = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
    const index = normalizeIndex(indexResult?.[NOTE_INDEX_KEY]);
    const entryByKey = new Map(index.map((entry) => [entry.mediaKey, entry]));
    const output = {};
    const unresolved = [];

    for (const key of keys) {
      const entry = entryByKey.get(key);
      if (entry && Array.isArray(entry.modes)) {
        output[key] = entry.modes;
      } else {
        unresolved.push(key);
      }
    }

    if (!unresolved.length) return output;
    const missingRecordKeys = [];
    const recordsByMediaKey = new Map();
    for (const key of unresolved) {
      const remembered = readRememberedRecord(key);
      if (remembered) recordsByMediaKey.set(key, remembered);
      else missingRecordKeys.push(noteKey(key));
    }
    if (missingRecordKeys.length) {
      const result = await storage.get(missingRecordKeys).catch(() => ({}));
      for (const key of unresolved) {
        if (recordsByMediaKey.has(key)) continue;
        const record = normalizeStoredRecord(result?.[noteKey(key)] || null);
        recordsByMediaKey.set(key, record);
        if (Object.keys(record.artifacts).length) rememberRecord(key, record);
      }
    }

    let indexChanged = false;
    for (const key of unresolved) {
      const record = recordsByMediaKey.get(key) || normalizeStoredRecord(null);
      const modes = artifactModeSummaries(record);
      output[key] = modes;
      let entry = entryByKey.get(key);
      if (entry) {
        entry.modes = modes;
        indexChanged = true;
      } else if (modes.length) {
        entry = {
          mediaKey: key,
          updatedAt: Number(record.updatedAt) || 0,
          frameBytes: recordFrameBytes(record),
          modes
        };
        index.push(entry);
        entryByKey.set(key, entry);
        indexChanged = true;
      }
    }
    if (indexChanged) {
      index.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      await storage.set({ [NOTE_INDEX_KEY]: index }).catch(() => {});
    }
    return output;
  }

  async function listModes(mediaKey) {
    mediaKey = String(mediaKey || '').trim();
    if (!mediaKey) return [];
    const result = await listModesMany([mediaKey]);
    return result[mediaKey] || [];
  }

  async function getStats() {
    const storage = storageArea();
    if (!storage) return { noteCount: 0, frameBytes: 0 };
    const result = await storage.get(NOTE_INDEX_KEY).catch(() => ({}));
    const index = normalizeIndex(result?.[NOTE_INDEX_KEY]);
    return {
      noteCount: index.length,
      frameBytes: index.reduce((sum, entry) => sum + entry.frameBytes, 0),
      maxFrameBytes: MAX_FRAME_BYTES,
      maxNotes: MAX_CACHED_NOTES
    };
  }

  BSE.AiNoteCache = Object.freeze({
    save,
    load,
    listModes,
    listModesMany,
    remove,
    sweep,
    getStats,
    canonicalizeFrames,
    buildRuntimeImagesMap,
    LIMITS: Object.freeze({
      maxNotes: MAX_CACHED_NOTES,
      maxFrameBytes: MAX_FRAME_BYTES,
      maxAgeMs: MAX_CACHE_AGE_MS
    })
  });
})();
