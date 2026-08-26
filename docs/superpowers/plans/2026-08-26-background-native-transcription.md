# SparkSub Background Native Transcription Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make queued Bilibili and YouTube videos complete full, unattended local transcription when platform captions are unavailable, without requiring an open or playing tab.

**Architecture:** The MV3 Service Worker becomes the only queue executor. Platform captions remain the first path. The fallback path sends a small media descriptor over a persistent Native Messaging connection to a macOS Swift host, which downloads media, routes it to the supported local CoreML model, and streams chunked cue results back to the extension.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, Chrome Native Messaging, Swift 6, CoreML, FluidAudio 0.15.6, yt-dlp 2026.08.19, Node.js tests, Swift Testing/XCTest.

**Spec:** `docs/superpowers/specs/2026-08-26-background-native-transcription-design.md`

---

## Global Constraints

- Platform captions are always attempted before media download or local ASR.
- A queue item reaches `done` only with non-empty subtitle text and at least one cue.
- The Service Worker is the only context allowed to call `BSE.Queue.processPendingJobs()`.
- Native host name is exactly `com.sparksub.transcriber`; protocol version is exactly `1`.
- Native-host-to-extension messages stay below `900 * 1024` bytes; full media bytes never cross Native Messaging.
- YouTube extraction uses pinned `yt-dlp_macos` version `2026.08.19`, invoked through `Process.arguments`, never through a shell.
- FluidAudio is pinned to exact version `0.15.6`.
- Public-video support only: do not read, export, or copy browser cookies.
- Cantonese (`yue`, `zh-HK`, `zh-yue`) never enters local ASR when platform captions are unavailable.
- Bilibili signed media URLs are ephemeral and must not be persisted in queue storage.
- Native host stdout contains framed protocol messages only; diagnostics go to stderr.
- User model directories are read-only. Compatibility aliases live under SparkSub Application Support.
- Existing platform-caption behavior and all existing test coverage must remain green.

### Task 1: Native Messaging JavaScript client and protocol assembly

**Files:**
- Create: `core/native-host.js`
- Modify: `core/namespace.js`
- Modify: `types/bse.d.ts`
- Modify: `types/chrome.d.ts`
- Modify: `tests/run-tests.mjs`

**Step 1: Write failing Native Messaging behavior tests**

Add a complete fake `chrome.runtime.Port` and load `core/native-host.js` in the VM test harness. Add tests proving:

- `getCapabilities()` sends `protocolVersion: 1` to `com.sparksub.transcriber`;
- concurrent requests are correlated by `requestId`;
- `progress` events reach only the matching job callback;
- `resultBegin`, out-of-order `resultChunk`, and `resultEnd` assemble cues in sequence order;
- a missing chunk rejects with `RESULT_INCOMPLETE`;
- port disconnect rejects every pending request with `NATIVE_HOST_DISCONNECTED`;
- abort sends a `cancel` request and rejects with `CANCELLED`;
- a single incoming message over 900 KiB is rejected as `PROTOCOL_MESSAGE_TOO_LARGE`.

Run: `node tests/run-tests.mjs`

Expected: FAIL because `BSE.NativeHost` does not exist.

**Step 2: Implement the minimal client**

Implement a frozen `BSE.NativeHost` namespace with:

- `HOST_NAME` and `PROTOCOL_VERSION` constants;
- lazy `connectNative()` connection reuse;
- request correlation and timeout cleanup;
- `getCapabilities({ force })` caching;
- `transcribe(payload, { onProgress, signal })` with validated result assembly;
- `cancel(jobId)` and `disconnect()`;
- normalized errors with `code`, `message`, `hint`, and `retriable`.

Do not make queue or Service Worker changes in this task.

**Step 3: Run tests and type checking**

Run:

- `node tests/run-tests.mjs`
- `npx --yes typescript@latest tsc -p tsconfig.json` when package download is available; otherwise record the unavailable command and run `node --check core/native-host.js`.

Expected: Native client tests and existing tests pass.

**Step 4: Commit**

```bash
git add core/native-host.js core/namespace.js types/bse.d.ts types/chrome.d.ts tests/run-tests.mjs
git commit -m "feat(native): add native messaging client"
```

### Task 2: Single Service Worker executor and native lifecycle

**Files:**
- Create: `core/queue-orchestrator.js`
- Create: `tests/orchestrator-tests.mjs`
- Modify: `core/queue.js`
- Modify: `background/service-worker.js`
- Modify: `offscreen/offscreen.js`
- Modify: `offscreen/offscreen.html`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `manifest.json`
- Modify: `types/chrome.d.ts`
- Modify: `tests/run-tests.mjs`

**Step 1: Write failing orchestrator tests**

Build a runtime-level fake queue around `BSE.QueueOrchestrator` and prove:

- simultaneous wake signals share one in-flight execution;
- a wake arriving during execution causes one follow-up drain when work remains;
- queue execution is started on enqueue, retry, extension startup, and relevant storage changes;
- an idle executor does not create an Offscreen Document;
- native capability requests are proxied by the Service Worker;
- sidepanel/offscreen wake events never directly execute the queue.
- queue mutations such as retry notify the Service Worker but never call `processPendingJobs()` in their own execution context.

Run: `node tests/orchestrator-tests.mjs`

Expected: FAIL because the orchestrator does not exist and execution is currently duplicated.

**Step 2: Implement the single executor**

Create a small single-flight orchestrator used only by `background/service-worker.js`. Import `core/native-host.js` and the orchestrator before queue startup.

Remove direct `processPendingJobs()` calls from sidepanel and Offscreen Document. Keep their enqueue/wake messages and UI refresh behavior. Add Service Worker listeners for extension startup and queue storage changes.

Remove the direct self-execution call from `BSE.Queue.retryItem()` as well; queue mutations may notify the orchestrator, but only the Service Worker may invoke `processPendingJobs()`.

Add `nativeMessaging` permission. Preserve Offscreen files for compatibility but do not create an Offscreen Document for queue work.

Expose `BSE_NATIVE_CAPABILITIES` and `BSE_NATIVE_CANCEL` runtime messages with trusted-extension sender validation.

**Step 3: Verify runtime behavior**

Run:

- `node tests/orchestrator-tests.mjs`
- `node tests/run-tests.mjs`
- `node --check background/service-worker.js`
- `node --check offscreen/offscreen.js`
- `node --check sidepanel/sidepanel.js`

Expected: one executor owns all queue processing and all tests pass.

**Step 4: Commit**

```bash
git add core/queue-orchestrator.js tests/orchestrator-tests.mjs core/queue.js background/service-worker.js offscreen/offscreen.js offscreen/offscreen.html sidepanel/sidepanel.js sidepanel/sidepanel.html manifest.json types/chrome.d.ts tests/run-tests.mjs
git commit -m "refactor(queue): make service worker the sole executor"
```

### Task 3: Shared media descriptor and real queue ASR fallback

**Files:**
- Create: `core/media.js`
- Modify: `core/queue.js`
- Modify: `platform/bilibili.js`
- Modify: `background/service-worker.js`
- Modify: `offscreen/offscreen.html`
- Modify: `sidepanel/sidepanel.html`
- Modify: `manifest.json`
- Modify: `types/bse.d.ts`
- Modify: `tests/run-tests.mjs`

**Step 1: Write failing queue fallback tests**

Add behavior tests with a real queue and a fake `BSE.NativeHost.transcribe()` boundary:

- Bilibili with no caption tracks resolves the best DASH audio descriptor, calls native transcription, and completes with returned cues;
- Bilibili no-caption jobs never persist the signed `audioUrl` and never finish with zero cues;
- YouTube with no tabs and no caption tracks calls native transcription using only the canonical watch URL;
- official-caption success never calls native transcription;
- `sourceLanguage: yue` with no platform captions fails with `ASR_LANGUAGE_UNSUPPORTED` without invoking the host;
- native progress moves through `fetching_audio` and `transcribing`, renews `leaseExpiresAt`, and does not write storage for duplicate progress values inside the throttle window;
- malformed or empty native results fail with `RESULT_INCOMPLETE`.

Run: `node tests/run-tests.mjs`

Expected: FAIL because no queue path invokes the native host.

**Step 2: Extract reusable media selection**

Implement `BSE.Media` pure helpers that normalize Bilibili DASH variants, choose the highest-bandwidth usable stream, normalize backup URLs, produce the allowed request headers, and reject non-Bilibili/HTTP media sources.

Refactor `platform/bilibili.js` and the queue to consume the same normalization and selection functions. Context-specific API fetching may remain in each adapter; stream semantics must not be duplicated. Load `core/media.js` before the queue/platform in every context that consumes it.

**Step 3: Implement local-transcription fallback**

Add queue helpers to:

- preserve `sourceLanguage` from enqueue options and settings;
- reject Cantonese local fallback before contacting the host;
- map native progress to queue stages and throttled persistent lease renewal;
- send a `remote` source for Bilibili and a `youtube` source for YouTube;
- validate and normalize returned cues through `BSE.Parsers.normalize()`;
- persist `subtitle.source`, `subtitle.engine`, error codes, hints, and retriable status;
- clear ephemeral media descriptors after the host accepts or finishes the job.

Change Bilibili and YouTube processors so local fallback is reached only after the caption path has been exhausted.

**Step 4: Run focused and full tests**

Run:

- `node tests/run-tests.mjs`
- `node --check core/media.js`
- `node --check core/queue.js`
- `node --check platform/bilibili.js`

Expected: fallback tests and existing caption tests pass.

**Step 5: Commit**

```bash
git add core/media.js core/queue.js platform/bilibili.js background/service-worker.js offscreen/offscreen.html sidepanel/sidepanel.html manifest.json types/bse.d.ts tests/run-tests.mjs
git commit -m "feat(queue): transcribe captionless media through native host"
```

### Task 4: macOS Swift native host, media download, and CoreML adapters

**Files:**
- Create: `native/SparkSubHost/Package.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/main.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/NativeProtocol.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/HostController.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/MediaDownloader.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/ModelLocator.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/TranscriptionEngine.swift`
- Create: `native/SparkSubHost/Sources/SparkSubHost/CueBuilder.swift`
- Create: `native/SparkSubHost/Tests/SparkSubHostTests/NativeProtocolTests.swift`
- Create: `native/SparkSubHost/Tests/SparkSubHostTests/MediaDownloaderTests.swift`
- Create: `native/SparkSubHost/Tests/SparkSubHostTests/ModelLocatorTests.swift`
- Create: `native/SparkSubHost/Tests/SparkSubHostTests/CueBuilderTests.swift`
- Create: `.github/workflows/native-host.yml`

**Step 1: Write failing Swift tests first**

Define tests for:

- little-endian framed JSON read/write and 64 MiB incoming/900 KiB outgoing limits;
- strict YouTube watch URL validation and Bilibili HTTPS/CDN validation;
- yt-dlp argument construction contains the pinned version's binary path, `--no-config`, `--no-playlist`, `bestaudio/best`, and a host-owned output directory without shell interpolation;
- Parakeet vocabulary alias staging without modifying the source directory;
- Cohere decoder compatibility requires `k_cache_0`;
- Parakeet token timings aggregate into ordered, non-empty cues;
- Mandarin low-energy window splitting is ordered, gap-free, and no longer than 35 seconds;
- result cue chunks serialize below 900 KiB.

Run on macOS: `cd native/SparkSubHost && swift test`

Expected: FAIL because production sources are missing. In this Linux workspace, record the absence of Swift/CoreML and use the macOS workflow as the build gate.

**Step 2: Implement framed protocol and controller**

Implement stdin/stdout framing, protocol request decoding, progress/result/error events, cancellation, request correlation, result chunking, and stderr-only logging. Support `--diagnose` as an explicit non-Native-Messaging mode that prints one human-readable JSON capability report.

**Step 3: Implement safe media acquisition**

Implement URLSession download with Bilibili backup failover and restricted headers. Implement yt-dlp execution via `Process.executableURL` plus `arguments`, parse structured progress, classify auth/download errors, and terminate the child on cancellation. Use task-specific temporary directories and `defer` cleanup.

**Step 4: Implement model discovery and transcription**

Pin FluidAudio exactly to `0.15.6`.

- Parakeet: stage read-only compatibility symlinks, load `.v3`, transcribe complete files, and build cues from token timings.
- Cohere: find standard/known timestamped candidates, inspect decoder inputs for `k_cache_0`, require `vocab.json`, retain loaded models, split Mandarin near low-energy boundaries, and emit timestamped window cues.
- Route explicit Cantonese to `ASR_LANGUAGE_UNSUPPORTED`.
- Return capabilities without triggering model downloads.

**Step 5: Add macOS CI and run available checks**

Workflow requirements:

- `macos-14` runner;
- `swift test` in `native/SparkSubHost`;
- no model download and no real media network call in unit tests.

Run locally where available:

- `cd native/SparkSubHost && swift test`
- otherwise `rg -n "TODO|fatalError\(|Process\(\)|/bin/(ba)?sh" native/SparkSubHost` and inspect every match.

**Step 6: Commit**

```bash
git add native/SparkSubHost .github/workflows/native-host.yml
git commit -m "feat(native): add macOS CoreML transcription host"
```

### Task 5: Installer, queue language controls, capability UI, and documentation

**Files:**
- Create: `native/scripts/install-host.sh`
- Create: `native/scripts/uninstall-host.sh`
- Create: `tests/install-host-tests.sh`
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/sidepanel.css`
- Modify: `core/i18n.js`
- Modify: `types/bse.d.ts`
- Modify: `README.md`
- Modify: `docs/架构与消息协议.md`
- Modify: `docs/用户场景与交互设计.md`
- Modify: `tests/run-tests.mjs`

**Step 1: Write failing installer and UI tests**

Add tests proving:

- install rejects a missing or malformed 32-character Chrome extension ID;
- dry-run output targets the user-level Chrome NativeMessagingHosts directory and one exact allowed origin;
- yt-dlp URL is pinned to `2026.08.19/yt-dlp_macos` and checksum verification occurs before replacement;
- uninstall removes only SparkSub-owned manifest/binaries and rejects unsafe roots;
- batch enqueue forwards the selected `sourceLanguage`;
- capability UI distinguishes ready, partial, not installed, and incompatible model states;
- queue cards expose subtitle source/engine and stable error hints.

Run:

- `bash tests/install-host-tests.sh`
- `node tests/run-tests.mjs`

Expected: FAIL before scripts and controls exist.

**Step 2: Implement install and uninstall scripts**

Installer must:

- accept `--extension-id`, `--chrome`, `--chromium`, `--dry-run`, and optional `--skip-ytdlp`;
- build the Swift package in release mode unless `--dry-run`;
- copy only into `~/Library/Application Support/SparkSub`;
- download the pinned binary and official `SHA2-256SUMS`, verify the exact asset, and atomically replace it;
- write an absolute-path Native Messaging manifest with one allowed origin;
- never repurpose `HOME`, use unresolved destructive globs, or run downloaded code before verification.

Uninstaller must remove only explicit SparkSub paths and leave model directories untouched.

**Step 3: Implement queue controls and capability status**

Add the source-language selector and host status panel. Forward the selection through both Service Worker enqueue and direct-storage fallback. Display native model/downloader readiness, subtitle source/engine, and actionable errors without exposing signed URLs.

Add symmetric zh-CN, zh-TW, and English dictionary entries.

**Step 4: Update user and architecture documentation**

Document:

- one-time native host installation and diagnostics;
- exact caption-first/local-fallback behavior;
- model paths and compatibility rules;
- Cantonese limitation;
- public-video/credential boundary;
- recovery, cancellation, and temporary-file behavior;
- macOS 14+ and Apple Silicon requirements.

**Step 5: Run tests**

Run:

- `bash -n native/scripts/install-host.sh native/scripts/uninstall-host.sh tests/install-host-tests.sh`
- `bash tests/install-host-tests.sh`
- `node tests/run-tests.mjs`
- `node --check sidepanel/sidepanel.js`

Expected: installer, UI, and existing tests pass.

**Step 6: Commit**

```bash
git add native/scripts tests/install-host-tests.sh sidepanel core/i18n.js types/bse.d.ts README.md docs tests/run-tests.mjs
git commit -m "feat(ui): add native host setup and queue controls"
```

### Task 6: End-to-end hardening and release verification

**Files:**
- Modify as required by verified failures only.
- Create: `docs/native-host-validation.md`

**Step 1: Exercise the complete extension fallback in tests**

Run the full fake-host scenarios for:

- captioned YouTube bypass;
- captionless YouTube native fallback with no tab;
- captionless Bilibili remote media fallback;
- Cantonese refusal;
- disconnect, retry, cancellation, stale lease recovery, and result chunking.

Run: `node tests/run-tests.mjs && node tests/orchestrator-tests.mjs`

**Step 2: Run static and type verification**

Run:

- `git diff --check`
- `node --check core/native-host.js core/media.js core/queue-orchestrator.js core/queue.js background/service-worker.js platform/bilibili.js sidepanel/sidepanel.js offscreen/offscreen.js`
- `npx --yes typescript@latest tsc -p tsconfig.json` when network permits;
- `bash -n native/scripts/install-host.sh native/scripts/uninstall-host.sh tests/install-host-tests.sh`;
- `bash tests/install-host-tests.sh`.

**Step 3: Validate or explicitly record macOS-only evidence**

On macOS run:

- `cd native/SparkSubHost && swift test`;
- `swift run -c release sparksub-native-host --diagnose`;
- installer dry-run with the real unpacked extension ID;
- one Parakeet public-video smoke test and one supported Mandarin smoke test.

If the current environment cannot run these commands, `docs/native-host-validation.md` must list them as unverified gates. Do not claim the Swift host builds or that physical user models load without this evidence.

**Step 4: Review requirements and remove false completion paths**

Inspect every assignment of `stage = 'done'` and confirm it requires non-empty cues. Confirm no queue storage object contains signed media URLs, and no source outside the Service Worker invokes `processPendingJobs()`.

**Step 5: Run the final complete verification suite**

Run every available command from Steps 1–3 again after any fix. Capture exact exit codes and outputs in the task report.

**Step 6: Commit**

```bash
git add -A
git commit -m "test: harden background native transcription"
```
