# Media Context Contract

Updated: 2026-09-11

SparkSub treats **media identity** and **AI semantic context** as two different contracts.

- Identity decides whether a subtitle/audio/result belongs to the current video. It is authoritative and fail-closed.
- Semantic context only helps an AI disambiguate terminology, entities and topic. It must never be used to decide media ownership.

## 1. Identity first

Bilibili queue work is bound to an exact `BVID + CID` once `/x/web-interface/view` has resolved the requested page. Caption artifacts, open-tab reuse and result application must prove that same identity before being accepted.

The enqueue path may additionally carry the page's current `mediaKey`. A conflicting BVID or page is rejected rather than guessed. Every Bilibili job re-resolves the authoritative BVID-to-CID mapping before using cached metadata or downloading audio.

A Bilibili content page may begin with a provisional `bili:<BVID>:p<N>` identity before the player DOM exposes a CID. Once `/x/web-interface/view` proves the current page's CID, the runtime identity should refine to `bili:<BVID>:cid<CID>` even when a single-P video has no active episode DOM node. This refinement is still fail-closed: for multi-P pages without an explicit `?p=N`, an actual active-page DOM node must prove the page before a CID is remembered; the default P1 fallback is never sufficient evidence.

YouTube work is bound to the exact 11-character video ID. Open-tab resolution must match both the tab URL and the returned `videoId`.

## 2. Bounded semantic context

`core/media-context.js` owns the platform-neutral `MediaContextPack`.

The current fields are intentionally small:

```text
version
platform
mediaKey

title
author
category
partTitle
tags[]
description
duration
```

For Bilibili:

- `title`, `owner.name`, `tname`, `desc`, duration and the active part title come from `/x/web-interface/view` or equivalent authoritative page metadata.
- tags come from `/x/tag/archive/tags?bvid=<BVID>`.
- the pack is owned by `bili:<BVID>:cid<CID>`.

For YouTube:

- title, channel, keywords, short description and duration come from `videoDetails` when available.
- category comes from `microformat.playerMicroformatRenderer.category` when available.
- the pack is owned by `yt:<videoId>`.

The context layer deduplicates and bounds values before persistence. It does not store entire platform API responses.

## 3. What is useful to translation AI

The translation context is assembled dynamically from two layers:

1. **Static media context** — title, creator, current part, category, bounded tags and a short description. These are high-value hints for names, terminology and topic.
2. **Local subtitle context** — a small window of preceding and following cues around the chunk being translated. This resolves pronouns, ellipsis and terminology consistency without repeatedly sending the full transcript.

The current chunk is supplied once as the actual translation payload. It is deliberately not duplicated inside the context block.

Source and target language are explicit task parameters rather than inferred from tags.

## 4. What must not be sent as AI context

Do not add these fields to `MediaContextPack`:

- signed Bilibili CDN URLs or backup URLs;
- cookies, authorization headers, account identifiers or private request data;
- raw platform API objects;
- Native Messaging `jobId` / `requestId` / execution leases;
- local model paths or cache paths;
- engine names as semantic routing hints;
- recommendation feeds, comments or unrelated neighboring-video metadata;
- cover-image URLs when the task is text translation.

Those fields either carry no translation value, can expire, leak implementation details, or create a cross-media/privacy risk.

## 5. Prompt-injection boundary

Titles, tags, descriptions and subtitles are all untrusted content. Prompt builders explicitly label them as **data used for semantic disambiguation**, not instructions.

A video title or description saying "ignore previous instructions" must therefore remain ordinary source content. It cannot change the translation, polishing or report-generation task.

## 6. Current consumers

The same context pack is reusable by:

- offline-ASR semantic polishing;
- future/AI subtitle translation through `buildTranslationPrompt`;
- AI planning prompts;
- AI course-note/report prompts;
- legacy prompt presets when the active player received context from the queue.

This avoids every AI feature inventing a different metadata fetch path.

## 7. Context propagation

For offline transcription:

```text
Bilibili / YouTube metadata
        ↓
MediaContextPack (identity-bound)
        ↓
QueueItem.mediaContext
        ↓
ASR polishing / translation context
        ↓
BSE_APPLY_EXTERNAL_SUBTITLE
        ↓
AppState.mediaContext
        ↓
Side-panel AI tools
```

`BSE_APPLY_EXTERNAL_SUBTITLE` also carries `expectedMediaKey`. The content page rejects the entire result if the page has changed before application, so semantic context and cues cannot be attached to a different video.

## 8. Regression requirements

Changes to this contract should keep tests for:

- Bilibili URL/mediaKey BVID mismatch;
- Bilibili same-BVID different-CID mismatch;
- Bilibili page-number mismatch;
- cached caption artifact owner mismatch;
- cross-media platform-caption response rejection;
- playurl identity/duration mismatch before native ASR;
- result-application mediaKey mismatch;
- tag normalization/deduplication and bounded context;
- dynamic previous/next cue context without duplicating the current translation block;
- YouTube tab URL + returned-video-ID agreement.
