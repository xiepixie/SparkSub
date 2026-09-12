# ADR-002: Separate queue list projections from canonical subtitle records

## Status

Accepted

## Date

2026-09-11

## Context

Queue storage schema v2 already removed persisted TXT/Markdown/SRT duplication and kept cues as the canonical subtitle representation. However, the indexed queue list still loaded every full per-item record. A Side Panel user who only opened the Transcription workspace therefore paid the storage IPC and structured-clone cost of every historical cue array.

For a queue containing many long completed videos, list rendering needs only card metadata: identity, title, author, cover, stage, progress, cue count, language/source labels, and safe error state. Canonical cues are only needed after an explicit content action.

## Decision

Queue storage schema v3 keeps two per-item records:

- `bse_transcription_queue_v1:item:<id>` stores task facts plus canonical cues.
- `bse_transcription_queue_v1:projection:<id>` stores only lightweight list metadata and never stores cues or derived transcript bodies.

Every queue mutation derives the projection from the item snapshot and writes both records in the same `chrome.storage.local.set(...)` call. Progress persistence therefore does not add another storage write IPC.

List consumers use `getQueueProjection()`. The Side Panel Transcription workspace and feed status UI must not use full queue items for ordinary rendering. Explicit per-card actions such as preview, load subtitle, copy, TXT, and SRT call `getItem(id)`, which reads only that item's canonical record and derives text formats on demand. Cross-context enqueue responses are projected as well, so re-enqueueing an already-completed item cannot accidentally push its historical cues into a content page.

Schema v1/v2 installations perform one migration that reads existing item records, sanitizes them, and backfills projections in the same migration write. After schema v3 is present, normal list reads request projection keys only. A missing projection is repaired from only the affected item rather than rereading the whole queue. If an indexed item and its projection are both gone, that dead index entry and the queue summary are repaired from the surviving projections without scanning healthy canonical records.

The queue summary remains a separate tiny projection for hidden-workspace badges. Normal mutations (add, retry, remove, clear-completed, clear-all) use the projection set as their working set and read only the selected canonical item when its body is actually needed. Executor scans likewise select queued/running candidates from projections before loading those candidate records; completed history is not part of the executor working set.

A deliberate merged transcript export may read multiple canonical items because the user explicitly requested their contents, but it first filters IDs through projections. Selecting two completed videos reads those two canonical records rather than every queue item.

Full canonical queue reads remain allowed only on compatibility/recovery seams: one-time v1/v2 migration, exceptional fallback when current storage metadata is missing or damaged, and the public `recoverStaleJobs()` return contract (which historically returns the full queue). The executor uses an internal lightweight recovery path and therefore does not pay that compatibility cost during normal background scans.

## Consequences

- Opening or reopening Transcription scales with queue metadata rather than historical subtitle volume.
- Canonical cues no longer cross into the Side Panel or feed page unless the user requests content for a specific item.
- Background queue maintenance and idle executor scans are proportional to active/selected items rather than completed transcript history.
- Queue metadata is duplicated once per item, trading a small storage cost for substantially lower routine IPC and structured-clone cost.
- The first v1/v2 access can still be expensive by design because it must backfill the new projection records exactly once.
- Item and projection state cannot drift through normal writes because they share one storage write boundary.

## Validation

The queue test suite verifies that:

- schema v3 list reads request projection keys and no `:item:` keys;
- projection records contain cue count/source metadata but no cues, TXT, Markdown, or SRT;
- `getItem(id)` reads one target item and not neighboring completed items;
- v2 performs one full migration and subsequent list reads stay projection-only;
- dead indexed records repair index/summary without reading healthy canonical items;
- progress and terminal item saves update item + projection in one storage write, with terminal summary changes included in that same write;
- add/remove/clear/retry paths do not read unrelated completed item records;
- an idle executor over completed history performs zero canonical item reads;
- selected merged export reads the requested canonical item(s) only;
- existing queue lifecycle, recovery, export, native-ASR, and media-identity tests remain green.
