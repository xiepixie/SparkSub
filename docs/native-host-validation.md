# Background Native Transcription Validation

Date: 2026-08-27

Branch: `feat/background-native-transcription`

This report separates checks completed in the current Linux workspace from the macOS-only release gates that still require execution on Apple Silicon. A green JavaScript suite does not imply that the Swift host builds or that the physical user models load.

## Verified in this workspace

| Area | Command or evidence | Result |
| --- | --- | --- |
| Extension unit and fallback scenarios | `node tests/run-tests.mjs` | Pass, exit 0 |
| Service Worker queue ownership and wake coalescing | `node tests/orchestrator-tests.mjs` | Pass, exit 0 |
| JavaScript syntax | `node --check` on the native client, media adapter, queue/orchestrator, Service Worker, Bilibili adapter, side panel, and offscreen controller | Pass, exit 0 |
| Installer behavior | `bash tests/install-host-tests.sh` | Pass, exit 0 |
| Shell syntax | `bash -n native/scripts/install-host.sh native/scripts/uninstall-host.sh tests/install-host-tests.sh` | Pass, exit 0 |
| Patch whitespace | `git diff --check` | Pass, exit 0 |
| Runtime | Linux 6.18 x86_64, Node.js v24.19.0 | Recorded |

The extension tests cover these release-critical paths:

- a captioned YouTube item completes from platform captions and does not call the native host;
- a closed-tab Cantonese YouTube item completes through the native host's public-caption path without invoking local ASR;
- a captionless YouTube item falls back to the native host without an open tab;
- a captionless Bilibili item uses an ephemeral remote-media descriptor;
- explicit Cantonese aliases fail with `ASR_LANGUAGE_UNSUPPORTED` instead of entering local ASR;
- manual captions outrank automatic captions, which outrank translated captions and local ASR;
- disconnect, retry, cancellation, inactivity timeout, stale-lease recovery, and concurrent queue ownership;
- removing, clearing, or retrying active work aborts the owning Service Worker execution exactly once, and stale completion cannot overwrite or resurrect queue state;
- host-returned YouTube caption metadata is validated and persisted as `manual`, `auto`, or `translated`;
- a malformed/unavailable higher-priority YouTube track is removed and the host continues through later automatic and translated candidates;
- requested Cantonese aliases (`yue`, `zh-HK`, `zh-yue`, `zh-Hant-HK`, and `yue-*`) rank consistently in both extension and native caption paths;
- sidepanel enqueue, retry, remove, and clear mutations are routed through the Service Worker rather than a sidepanel-local queue instance;
- Native Messaging remains open during active/concurrent work but disconnects after a 250 ms idle grace period while retaining the capability snapshot;
- out-of-order result assembly, missing/duplicate chunks, mismatched chunk counts, mismatched cue counts, invalid cues, and the strict `< 900 KiB` host-message limit;
- `done` requires at least one normalized cue and non-empty plain text;
- Bilibili signed media URLs and signing fragments are removed before every queue-storage write and during legacy-state migration.

## Architecture audit

`processPendingJobs` has one runtime caller: `background/service-worker.js`. Its other two production references are the function definition and the exported queue method. The side panel, content scripts, and offscreen document only wake or message the Service Worker.

Every production `item.stage = 'done'` path is preceded by a non-empty result guard. The active Service Worker paths both call `setCompletedSubtitle`, which rejects unless normalized cues, `cueCount`, and trimmed `plainText` are non-empty. The two retained legacy offscreen paths perform the same checks and are not connected to a queue-processing message.

Queue persistence is centralized through `sanitizeQueueItemForPersistence`. It recursively drops remote media descriptors, audio caches, Bilibili CDN media URLs, and known signing fragments. Signed URLs exist only in the in-memory native request needed for the current download.

The idle-port rule follows the official [Chrome extension service-worker lifecycle guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): an open `connectNative()` port keeps the Service Worker alive. SparkSub therefore retains the port only while requests are pending (plus a short reuse grace period).

## FluidAudio 0.15.6 API review

`Package.swift` pins FluidAudio exactly to `0.15.6`. The host calls were checked against the upstream [`v0.15.6` Parakeet CLI implementation](https://github.com/FluidInference/FluidAudio/blob/v0.15.6/Sources/FluidAudioCLI/Commands/ASR/Parakeet/SlidingWindow/TranscribeCommand.swift), [`CoherePipeline`](https://github.com/FluidInference/FluidAudio/blob/v0.15.6/Sources/FluidAudio/ASR/Cohere/CoherePipeline.swift), and [`ModelHub` offline behavior](https://github.com/FluidInference/FluidAudio/blob/v0.15.6/Sources/FluidAudio/Shared/Download/DownloadTypes.swift). The reviewed signatures match the implementation for:

- `AsrModels.load(from:configuration:version:encoderPrecision:)`;
- `AsrManager.loadModels`, `decoderLayerCount`, `TdtDecoderState.make`, and file transcription with a language filter;
- `CoherePipeline.loadModels` and `transcribe(audio:models:language:)`;
- `ModelHub.offlineMode`.

This is source-level API evidence only; it does not replace compiling the pinned package on macOS.

## yt-dlp 2026.08.19 caption path review

The host first runs a metadata-only `--dump-single-json --skip-download --ignore-no-formats-error` request, classifies `subtitles` as manual tracks and `automatic_captions` entries with a `tlang` URL parameter as translations, then tries parseable JSON3/VTT candidates in manual → automatic → translated order using `--write-subs` or `--write-auto-subs`. Each failed candidate's output is removed before the next attempt. Both invocations use `Process.arguments`, `--no-config`, `--no-playlist`, no cookies, bounded stdout/stderr, cancellation, and a job-owned output directory. `live_chat` and formats the host cannot parse are excluded from caption selection.

## Type-check baseline

The repository-wide JavaScript type configuration is not currently green on the base branch.

- `typescript@latest` resolved to 7.0.2. `tsc -p tsconfig.json` exits 1 because the existing `moduleResolution: "node"` maps to the removed `node10` mode (`TS5108`).
- With TypeScript 5.9.2, the feature branch reports 570 existing `checkJs` diagnostics, while the local base checkout reports 592.
- After normalizing file names, diagnostic codes, and messages (to ignore shifted line numbers), the feature branch introduces no branch-only TypeScript diagnostic. The remaining errors are existing ambient Chrome API, DOM element, and legacy namespace typing debt.

The type check therefore remains a known repository baseline failure, not a passed gate. This feature adds and corrects declarations for its new queue, native-host, media, routing, and orchestrator surfaces without disabling `checkJs` or adding `@ts-nocheck`.

## macOS-only release gates — not yet verified

The current workspace has no Swift toolchain (`swift --version` exits 127). Before release, run all of the following on an Apple Silicon Mac:

1. `swift test --package-path native/SparkSubHost`
2. `swift run --package-path native/SparkSubHost -c release sparksub-native-host --diagnose`
3. `native/scripts/install-host.sh --extension-id <real-unpacked-extension-id> --browser chrome --dry-run`
4. Install the host and reload the unpacked extension.
5. Run one public, captionless European-language YouTube video through Parakeet with the video tab closed.
6. Run one public, captionless Mandarin video through a compatible Cohere cache-external decoder.
7. With the video tab closed, confirm a public Cantonese video completes from a YouTube manual/automatic caption without invoking ASR.
8. Confirm a Cantonese video with no public caption returns `ASR_LANGUAGE_UNSUPPORTED` and never invokes a local model.

The Cohere smoke test requires a non-empty `vocab.json` and a decoder whose CoreML inputs contain `k_cache_0`. Merely finding a timestamped `.mlmodelc` directory is intentionally not treated as readiness. The host creates compatibility symlinks under SparkSub Application Support and never modifies the user's model directories.

`.github/workflows/native-host.yml` provides a `macos-14` `swift test` job for pushes and pull requests that touch the native host. It has not run for these local-only commits.
