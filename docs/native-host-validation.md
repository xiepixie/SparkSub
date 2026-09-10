# Native Browser Integration Validation

Updated: 2026-09-10
Contract: `sparkscribe.browser-native/2`
Native Messaging host: `com.sparksub.transcriber`
Preferred native execution: `/Applications/SparkScribe.app/Contents/Helpers/SparkSubNativeHost`
Compatibility fallback: `native/SparkSubHost`

This report records the currently verified SparkSub ↔ SparkScribe native boundary. It distinguishes deterministic contract/process tests from the final browser-UI smoke so a direct helper test is never mistaken for Chrome end-to-end evidence.

## Current architecture state

SparkSub consumes capability semantics, timed cues, progress, cancellation and stable errors. It does not select Qwen, Parakeet, Cohere or another concrete model. The default installer runs in `auto` mode: it selects the SparkScribe-bundled helper only when `--browser-native-readiness` succeeds; otherwise it installs/uses the standalone compatibility host. `--sparkscribe` and `--standalone` provide explicit diagnosis and rollback paths.

SparkScribe owns the preferred execution path:

```text
SparkSub Extension
        ↓ Chrome Native Messaging
com.sparksub.transcriber
        ↓
SparkSubNativeHost (bundled, lightweight)
        ├─ BrowserIntegration — framing, validation, cancellation identity
        ├─ BrowserMedia — restricted YouTube/Bilibili acquisition + verified yt-dlp
        ├─ BrowserCaptions — YouTube manual/auto/translated captions
        └─ BrowserHostCore — lifecycle, progress, result chunking, worker client
                           ↓
             SparkScribe --browser-inference-worker
                           ↓
             existing FFmpeg + local ASR stack
```

Media Queue, Live Captions and Browser Worker share one cross-process inference lease. A competing local inference session returns `BUSY` instead of loading a second heavy model session.

## Verified on Apple Silicon macOS

| Area | Evidence | Result |
| --- | --- | --- |
| SparkSub runtime/contract suite | `node tests/run-tests.mjs` | Pass |
| Installer contract | `bash tests/install-host-tests.sh` | Pass |
| Standalone compatibility host | `swift test --package-path native/SparkSubHost` | 58 tests, 0 failures, 2 fixture-dependent skips |
| SparkScribe suite | `bash ./build.sh --check` in SparkScribe | 365 tests across 58 suites, pass |
| Release helper signing | `codesign --verify --strict` | Pass |
| Worker capability probe | packaged `SparkScribe --browser-inference-capabilities` | `localASR` available for installed en/zh models |
| Helper capability projection | framed v2 `capabilities` smoke | Correct feature projection, no unframed stdout |
| Real headless ASR | macOS `say` fixture → packaged worker | Qwen3-ASR 1.7B returned one valid timed English cue |
| Third-party stdout isolation | real Qwen worker smoke | model loader diagnostics redirected away from worker JSON stdout |
| Runtime adoption | bundled helper readiness | verified legacy SparkSub yt-dlp copied into SparkScribe runtime without mutating source |
| Native manifest handoff | real Chrome Profile extension ID | manifest now points to SparkScribe bundled helper; standalone binary remains available for rollback |

The two skipped standalone Swift tests require `/tmp/test_speech.wav` for real legacy Parakeet/Cohere inference. They do not skip protocol, media-security, cancellation, platform-caption or result-framing coverage. Preferred SparkScribe inference is separately covered by its worker tests and the real packaged-worker smoke above.

## Release-critical properties

The combined suites and process smokes verify that `com.sparksub.transcriber` remains the stable integration identity; v2 is attempted before v1; only explicit `PROTOCOL_MISMATCH` permits one legacy retry; local-ASR support comes from `features.localASR.languages`; request/job correlation and cancellation are scoped; result chunks are bounded, complete and validated; browser requests never transport media bytes, Cookie/Authorization headers, arbitrary output paths or model-selection instructions; YouTube/Bilibili acquisition obeys canonical URL/header/workspace restrictions; yt-dlp readiness requires the pinned version and actual payload SHA-256; and Native Messaging stdout contains only framed protocol messages.

SparkScribe's private worker protocol is intentionally separate from the browser contract. The helper locates the main SparkScribe executable, sends a bounded private JSON request, bounds worker output to 32 MiB, terminates the worker on cancellation, and treats a valid worker failure envelope as authoritative even when the child exits non-zero.

## Installer / rollback contract

The default install command is:

```bash
./native/scripts/install-host.sh --extension-id <id> --chrome
```

`auto` selection prefers SparkScribe only when the installed helper is executable and its readiness probe succeeds. `--sparkscribe` requires that readiness and fails rather than silently falling back. `--standalone` forces the compatibility host. Dry-run never executes readiness probes or mutates the filesystem.

Uninstall removes SparkSub-owned manifests and standalone compatibility artifacts only. It must never remove `/Applications/SparkScribe.app` or SparkScribe-owned runtime/model data.

## Platform boundary

The SparkScribe-bundled helper follows SparkScribe's macOS 15+ baseline. The standalone SparkSubHost remains the macOS 14+ compatibility path. Browser-only SparkSub features remain independent of either native option.

## Type-check status

A TypeScript compiler is still not pinned in this repository. `npx tsc -p tsconfig.json` therefore cannot be treated as a reproducible release gate until `typescript` is added at a fixed repository version. The current runtime JS suite exercises the edited Native Messaging client, capability normalization, queue integration, errors, cancellation and v1 fallback.

## Remaining manual acceptance

One browser-driven check remains intentionally separate from deterministic tests: from the installed unpacked SparkSub extension, trigger an actual native subtitle job and verify Chrome extension → Native Messaging → SparkScribe helper → media/caption or worker path → cues return to the extension UI. The manifest itself has already been switched on the current Chrome profile, but direct helper/worker process smokes are not labeled as a substitute for this browser-UI E2E.

See `docs/native-contract-v2.md` and `docs/decisions/ADR-001-capability-driven-native-contract.md` for the stable consumer contract and decision rationale.
