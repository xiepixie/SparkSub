# ADR-001: SparkSub consumes native capabilities, not model names

## Status

Accepted

## Date

2026-09-09

## Context

SparkSub's original Native Messaging protocol v1 exposed `models.parakeet` and `models.cohere`. Browser language routing and queue presentation therefore knew which concrete model was expected for Mandarin or European languages, and Cantonese was hard-coded as a permanent local-ASR rejection.

SparkScribe now owns the broader local subtitle engine and can change its native model policy independently. Keeping model identity in the browser contract would require SparkSub changes whenever SparkScribe replaces, adds, quantizes, or reroutes an ASR engine.

The existing Native Messaging transport, request correlation, chunked cue result, cancellation, and public-media security boundaries are useful and should survive the implementation handoff.

## Decision

SparkSub adopts `sparkscribe.browser-native/2` as its current native contract while retaining `com.sparksub.transcriber` as the Chrome Native Messaging host name.

Protocol v2 exposes features:

- local ASR availability and supported language codes;
- YouTube caption access;
- YouTube/Bilibili remote-media access;
- cancellation;
- chunked-result support.

SparkSub no longer selects or predicts a concrete ASR engine. `engine` and optional `engineLabel` in a result are diagnostics/presentation only.

SparkSub tries v2 first and falls back to protocol v1 only after an explicit `PROTOCOL_MISMATCH`. The v1 capability shape is normalized immediately into the same feature representation used by v2. No new browser code may consume `models.parakeet`, `models.cohere`, or other concrete model capability keys.

The standalone `native/SparkSubHost` remains a v1/v2-compatible rollback and macOS 14+ fallback. The preferred path is now the SparkScribe-bundled headless helper when its readiness probe succeeds.

## Consequences

- A future SparkScribe model update can add Cantonese or another language by advertising its language code; SparkSub routing code does not change.
- Model installation state is no longer rendered as a browser-level Parakeet/Cohere matrix.
- Upgrade order remains safe while the legacy host is supported.
- The Native Messaging host name does not change, avoiding unnecessary Chrome manifest churn.
- Selecting the SparkScribe bundled helper raises optional local-ASR execution from the standalone host's macOS 14+ baseline to SparkScribe's macOS 15+ baseline; the explicit standalone fallback preserves the older compatibility path.
- The bundled helper preserves URL/header/workspace/cancellation restrictions and keeps stdout exclusively for Native Messaging frames; heavy ASR is delegated to SparkScribe's private headless worker.

## Rejected alternatives

Keeping permanent model-specific routing in SparkSub was rejected because it makes the browser extension a second model-policy owner.

Replacing Native Messaging with localhost HTTP was rejected because it adds a network listener, authentication/origin policy, and service lifecycle that the current browser-native channel does not need.

Removing v1 immediately was rejected because it makes SparkSub/native-host upgrade ordering brittle.

## Validation

The v2 contract is accepted only while these remain green:

- SparkSub native-client tests, including v2-first negotiation and one-shot v1 fallback;
- SparkSub queue tests showing language availability follows `features.localASR.languages`;
- SparkSubHost protocol tests showing both v1 and v2 are accepted during migration;
- chunk, cancellation, framing, URL-policy, and public-caption tests.

The exact consumer-side field contract is documented in `docs/native-contract-v2.md`.
