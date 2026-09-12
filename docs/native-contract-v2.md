# SparkSub ↔ SparkScribe Native Contract v2

Updated: 2026-09-10
Contract: `sparkscribe.browser-native/2`
Native Messaging host: `com.sparksub.transcriber`

This document is the SparkSub consumer-side contract for optional native subtitle processing. The browser extension depends on **capabilities and timed-cue semantics**, not on a concrete ASR model implementation.

SparkScribe now ships the production `SparkSubNativeHost` under `SparkScribe.app/Contents/Helpers/`. The installer prefers that helper when its readiness probe confirms the required capabilities. `native/SparkSubHost` remains a v1/v2-compatible rollback and older-platform fallback, not the preferred execution path.

## Stable ownership boundary

```text
SparkSub
  owns browser/page context, queue UX and source-language intent
      ↓
Chrome Native Messaging
      ↓
com.sparksub.transcriber
  owns framing, correlation and safe native mediation
      ↓
SparkScribe native execution
  owns model selection, model lifecycle and transcription implementation
```

SparkSub must never choose Qwen, Parakeet, Cohere, sherpa or another concrete model by name. A change in the native model policy is represented only by a change in advertised capabilities.

## Negotiation

SparkSub uses protocol 2 by default.

```text
try v2
  ↓ explicit PROTOCOL_MISMATCH only
retry v1 once
```

No other failure may trigger a v1 retry. After successful negotiation, transcription, caption requests and best-effort cancellation use that negotiated version. `getCapabilities({ force: true })` may renegotiate.

Protocol v2 requires:

```json
{
  "protocolVersion": 2,
  "contract": "sparkscribe.browser-native/2",
  "features": {
    "localASR": {
      "available": true,
      "supportsAutoLanguage": true,
      "languages": ["en", "zh"]
    },
    "youtubeCaptions": {
      "available": true,
      "preferences": ["manual-first", "manual-only", "ai-first"]
    },
    "remoteMedia": {
      "youtube": true,
      "bilibili": true
    },
    "cancellation": { "available": true },
    "chunkedResults": {
      "available": true,
      "maxMessageBytes": 921599
    }
  }
}
```

SparkSub normalizes a legacy v1 response (`ytDLP` plus `models.parakeet/models.cohere`) into this same in-memory feature view. New browser code must not read the legacy model fields directly.

## Language routing

The user's language selector remains a language-intent vocabulary. Actual native support comes from `features.localASR.languages`.

Examples:

- `zh-Hans`, `zh-TW`, `cmn` normalize to `zh`;
- `yue-HK`, `zh-HK` normalize to `yue`;
- regional European tags such as `en-US` normalize to their base code.

If the host advertises `yue`, SparkSub may use local ASR for Cantonese. If it does not, SparkSub must use a platform caption or surface `ASR_LANGUAGE_UNSUPPORTED`. There is no browser-side “Cantonese is always unsupported” rule.

## Public requests

The request vocabulary remains:

- `capabilities`
- `ping`
- `youtubeCaptions`
- `transcribe`
- `cancel`

Every request has a unique `requestId`. Long-running requests also carry `jobId`, which is the cancellation and result-correlation identity. A v2 `transcribe` request may additionally carry a browser-owned `mediaKey`; explicit local transcription requires this identity. YouTube uses `yt:<videoId>`, while Bilibili local ASR uses the exact `bili:<BVID>:cid<CID>` resolved for the current page.

`mediaKey` is an end-to-end correctness token, not ASR prompt text. SparkScribe must echo the same value in the transcription result. SparkSub rejects a missing or different v2 echo before cues are persisted or applied. On Bilibili, the queue also re-resolves the authoritative BVID → page → CID mapping before media acquisition; cached caption artifacts and open-tab state may be reused only when their exact owner identity matches. An explicit `local-asr` intent bypasses all caption/cache reuse and goes directly to the freshly validated target media.

SparkSub sends only source intent/metadata. Native Messaging must never carry downloaded media bytes, cookies, Authorization headers, arbitrary output paths or model-selection instructions.

## Result contract

A valid cue is:

```json
{ "from": 1.25, "to": 3.80, "content": "Subtitle text" }
```

`from` and `to` must be finite, `from >= 0`, `to > from`, and `content` must be non-empty.

Long results use `resultBegin` → numbered `resultChunk` frames → `resultEnd`. SparkSub commits the result only after validating total chunk count, unique/complete sequence numbers, total cue count and every cue.

A transcription may include:

- `mediaKey`: required echo when a v2 request supplied one;
- `engine`: opaque diagnostic ID;
- `engineLabel`: optional display label.

They are not routing inputs. Queue cards use a generic SparkScribe/local-ASR label unless a safe display label is supplied by the host.

YouTube caption results additionally require validated language metadata and `manual | auto | translated` caption kind.

## Progress, cancellation and errors

Stable progress stage IDs may include `fetching_audio`, `fetching_caption`, `model_setup`, `transcribing`, `aligning` and `finalizing`. Human-readable hints are informational; client logic should use stage IDs.

Cancellation is job-scoped. Browser `AbortSignal` cancellation sends one best-effort native `cancel(jobId)` using the same negotiated protocol version, then settles the browser request as cancelled. Long-running native work must continue to send progress/heartbeat frames so the inactivity watchdog does not kill healthy work.

Stable protocol-facing errors include:

`INVALID_REQUEST`, `PROTOCOL_MISMATCH`, `PROTOCOL_MESSAGE_TOO_LARGE`, `MEDIA_AUTH_REQUIRED`, `MEDIA_DOWNLOAD_FAILED`, `CAPTIONS_NOT_FOUND`, `MODEL_NOT_FOUND`, `MODEL_LAYOUT_INCOMPATIBLE`, `ASR_LANGUAGE_UNSUPPORTED`, `ASR_FAILED`, `RESULT_INCOMPLETE`, `CANCELLED`, and `BUSY`.

Raw native diagnostics, signed media URLs, tokens, stack traces and filesystem model paths must not be persisted or rendered as user-facing errors.

## Security invariants retained from SparkSubHost

The SparkScribe-bundled helper preserves these protections:

- only canonical public YouTube watch URLs;
- Bilibili remote media only from approved HTTPS CDN/domain suffixes with no explicit port or URL credentials; when Bilibili returns an `mcdn` primary such as `:8082`, SparkSub discards that candidate and promotes a policy-compatible portless backup before Native Messaging;
- only `Referer` and `User-Agent` may cross with a Bilibili remote descriptor;
- no Cookie or Authorization forwarding;
- downloader arguments are arrays, never shell interpolation;
- downloaded files remain inside a per-job temporary workspace;
- redirects are revalidated;
- job cancellation terminates active downloader/network work;
- temporary job data is removed on every terminal path;
- input Native Messaging frame limit is 64 MiB;
- output JSON payload is strictly below 900 KiB;
- media bytes never traverse Native Messaging.

## Transition rule

Do not delete `native/SparkSubHost` yet. It remains the explicit `--standalone` rollback path and preserves the macOS 14+ compatibility baseline while the SparkScribe-bundled helper requires macOS 15+. The default installer uses `auto`: a complete SparkScribe readiness result selects the bundled helper, otherwise installation falls back to standalone. `--sparkscribe` and `--standalone` are available for controlled diagnosis and rollback.

Browser-only SparkSub features remain cross-platform; only optional local native execution is affected by the selected Host baseline.
