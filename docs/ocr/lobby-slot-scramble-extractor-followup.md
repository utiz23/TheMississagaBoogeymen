# Pre-game lobby slot scramble — extractor follow-up (WS-B)

Filed 2026-06-14 (Tier 1, plan `~/.claude/plans/sorry-forgot-to-put-steady-lemon.md`, WS-B).
**Re-diagnosed 2026-07-04 with direct DB evidence — the original root cause below was WRONG; see
"Corrected root cause".** Deferred by user decision; this records the verified root cause + the fix
path so the work can be picked up cold.

## Symptom (3 quarantined reds)

- `match 250: pre-game lobby BGM loadout fields match V2`
- `match 250: lobby typed_v1 hard-field accuracy ≥ 90%`
- `match 250: lobby typed_v1 soft-field accuracy ≥ 75%`

The raw `pre_game_lobby_state_2`-sourced snapshot rows for match 250 bind the right values to the
wrong slots. Scored against the `EXPECTED` ground truth in
[match-250-benchmark.test.ts](../../apps/worker/src/__tests__/match-250-benchmark.test.ts):
**gamertag 5/10 (50%)**, **player_number 6/10 (60%)** — both well under their 90% / 75% floors. The
consolidated read (`getMatchLineups`, the end-user path) is un-quarantined and **green**; only the
raw upstream lobby snapshot is scrambled.

The hard/soft gates measure `loadLobbySnapshotsForMatch(250)` = `player_loadout_snapshots` joined to
a `pre_game_lobby_state_2` extraction. That join currently resolves to **one extraction, `id 12338`,
from `run 392`** (a stale run — active is 1954).

## Corrected root cause (verified 2026-07-04, read-only DB evidence)

**It is transition-frame contamination + first-frame selection, NOT a position-assignment code bug.**

The lobby segment is decoded to many frames. The first ~7 frames are a **mid-scroll transition** —
EA animates the two team rosters sliding between the left/right panels, so during those frames a
panel shows `CPU` placeholders and/or the *other* team's players. The extractor reads these frames
faithfully (crisp glyphs, ~0.97 confidence) — the frame content itself is transient garbage.

Direct proof, dumping `raw_result_json->'our_team'->'roster'` for every run-392 lobby extraction
(BGM = our_team; ground truth C/LW/RW/LD/RD = MrHomiecide / Stick Menace / silkyjoker85 /
HenryTheBobJr / JoeyFlopfish):

| Frames | Extraction ids | our_team slots read | Verdict |
|--------|----------------|---------------------|---------|
| 00001–00007 | 12338–12344 | `C:CPU · LW:Duh Pope · RW:CPU · LD:CPU · RD:CPU` | **transition (scrambled)** |
| 00008+, 00003+ | 12345, 12390–12410 | `C:MrHomiecide · LW:Stick Menace · RW:silkyjoker85 · LD:HenryTheBobJr · RD:JoeyFlopfish` | **settled — every slot correct** |

Because settled frames slot every player correctly, the extractor's position assignment
(`row_grouping.py` / `slot_identity.py`) is **not** the defect. The persisted snapshot is poisoned
because promotion picked extraction **12338 = the first frame = a transition frame** (lowest-id
extraction of the segment).

Visual confirmation: the committed settled frame
`calibration/extras/pre_game_lobby_state_2__match250_t40_vs_4thline.png` lays out all 10 slots
correctly; `..._t10_...` is a mid-scroll transition whose panels match the 12338 scramble exactly.

### Corrected provenance (traced 2026-07-04, live-DB) — the scramble is in the ACTIVE run

The "stale run-392" framing below was **wrong**. Direct DB trace:

- `ocr_field_evidence` for match 250 lobby exists under runs 1, 392, 583, **and active 1954** (204
  rows / 12 slots for 1954). `ocr_promotions` shows run **1954** promoted the current 12 lobby
  snapshots (131 rows). So the persisted values are the **active run's**, not stale run-392 data.
- The FK `ocr_extraction_id = 12338` (run 392) is a red herring: `promoteLobbyFromEvidence` stamps
  every lobby snapshot with `lobbyExtractionRows[0]` — the **oldest** lobby extraction for the match
  (`ORDER`-less `.limit(1)`, no run filter) — purely as provenance. It is **not** where the values
  came from. `player_loadout_snapshots` has no `run_id` column.
- The active run's evidence is itself scrambled: each `(slot, field)` carries exactly **2 candidates,
  one per segment** (`support_frame_ids {1}` settled, `{4}` a transition read). The promoter picks
  the argmax-confidence candidate per field; settled vs transition both OCR at ~0.95–0.98, so it
  picks the transition read for `for/C`, `for/LW`, `for/RW` (3/5 wrong).

### Why the "add an active-run filter to the gate" idea is a NON-fix (and harmful)

There is exactly **one** set of 12 lobby snapshots (the promoter deletes priors on each active-run
rebuild), written by run 1954. `loadLobbySnapshotsForMatch`'s `.find()` therefore already grades the
active run's data — there is nothing stale to filter out. Worse: the only run-bearing column reachable
from a snapshot is the joined `ocr_extractions.run_id`, and that FK points at run **392** (the oldest
extraction). Filtering the join by `run_id = active` would return **zero rows** and break the gate.
Do not add that filter. The scramble must be fixed in the data (evidence), not masked in the query.

### Promotion path — TRACED (resolved): the fix is the Python aggregation, NOT the TS promoter

`promoteLobbyFromEvidence` reads `ocr_field_evidence` and picks a per-`(slot, field)` argmax-confidence
winner independently — that per-field argmax across the 2 segment candidates is the "reshuffle" (a
persisted row is a Frankenstein of best-confidence fields, not a verbatim frame). Crucially, the
per-frame reads are **already collapsed** before evidence is written:
`lobby_evidence.extract_lobby_evidence` picked one best frame per slot (highest mean confidence) and
emitted a single candidate per segment. By the time the TS promoter runs, the frames are gone — so a
per-frame majority vote is **impossible in TS**, and `repromote-lobby` (which re-runs only the TS
promoter over existing evidence) **cannot** fix it. The vote must live in the Python extractor, where
`per_frame_subjects` still holds every frame. **The fix landed there (see Status).**

## Superseded: the original (2026-06-14) root-cause theory

> Lobby position is assigned by anchor OCR text after a y-sort with no grid re-lookup
> ([row_grouping.py:299-330](../../tools/game_ocr/game_ocr/lobby_extractors/row_grouping.py)); the
> loadout path builds a `PositionGrid` and looks up position by Y
> ([loadout_extractors/slot_identity.py:391-425](../../tools/game_ocr/game_ocr/loadout_extractors/slot_identity.py)),
> so the fix is to port that grid contract into the lobby extractor.

**Refuted.** That analysis was read-only code inspection of a scrambled *transition* frame; it never
checked the extractor's output on a *settled* frame. Settled frames slot correctly (table above), so
there is no y-sort/grid bug to fix. Do not port `PositionGrid` — it would add complexity for a
non-bug. (The 2026-06-14 note's *other* correction — that match 250 is re-ingestable, unlike 2582 —
still stands.)

## Fix path (approved approach: majority vote + transition pre-filter)

1. **Extractor (Python) — aggregate frames instead of trusting one. ✅ DONE (2026-07-04).**
   `extract_lobby_evidence` now (a) classifies each frame as settled or transition — a **within-panel
   duplicate gamertag** is the transition signature (match-250 segment 4 read "Stick Menace" into both
   C and LW, "HenryTheBobJr" into both RW and LD, from EA's roster-slide); cross-panel duplicates were
   already demoted to CPU upstream by `_demote_cross_team_duplicates`; (b) drops transition frames
   (falling back to all frames only if a segment captured *no* settled frame); (c) takes a **per-slot
   majority vote** across the surviving frames, returning the highest-quality read of the winning
   identity as the representative so every field comes from one consistent frame; (d) restricts the
   captain cross-frame MAX ★ to the settled voting frames (closes the G1.1 t10 stray-star residual).
   New helpers `_frame_is_transition` / `_vote_slot_identity` / `_normalize_gamertag_for_vote` in
   [lobby_evidence.py](../../tools/game_ocr/game_ocr/lobby_evidence.py); +2 tests in
   `tests/test_lobby_evidence.py` (RED→GREEN; full lobby suite 56 pass). The transition signature was
   validated against the real run-1954 evidence dump (settled segment = all-distinct gamertags;
   transition segment = the within-panel duplicate).
2. **Data refresh for match 250 — REQUIRES a re-ingest; re-promote CANNOT do it.** `repromote-lobby`
   re-runs only the TS promoter over existing `ocr_field_evidence`, which is already collapsed to 2
   poisoned segment candidates — the settled per-frame reads the vote needs were never written there
   (they live only in the frames / the *old* `ocr_extractions.raw_result_json`, not in the typed
   evidence path). So the refresh is a `DECODER_VERSION`-bumped GPU re-ingest: reprocess
   (`--halt-before-activate`) → validate → field-benchmark gate → activate → re-consolidate. This is
   the DB-mutating step; back up first, and confirm `CUDAExecutionProvider` (the GPU venv reverts to
   CPU on any `uv sync`). **This corrects the handoff's earlier "re-promote may suffice" note.**
   ⚠️ **Open question for that session:** run 1954 decoded only ~2 lobby segments — confirm the
   frame budget captures enough settled frames per segment for the vote to have material (the code
   fallback keeps the slot but degrades to transition data if a segment is all-transition).
3. **Gate hygiene — NOT an active-run filter (that is a non-fix, see above).** Once the re-ingest
   lands, the single active-run snapshot set is settled, so `loadLobbySnapshotsForMatch`'s existing
   `.find()` grades the right data. The only gate work is to **un-skip the 3 quarantined tests** in
   [match-250-benchmark.test.ts](../../apps/worker/src/__tests__/match-250-benchmark.test.ts) and
   confirm they pass on the refreshed snapshots.

Validate against the proving bench + match-250 fixtures, and generalize the check to 463/968 (their
lobby segments have the same transition-frame structure) — each is its own GPU re-ingest session.

Do not lower the V2 lobby field expectations to make these pass.

## Status (2026-07-04 implementation session)

- **Code fix landed** (uncommitted): the Python aggregation change in step 1 above. Verified in
  isolation (56 lobby tests + 29 adjacent evidence/benchmark tests green, py_compile clean). No TS
  change — `lobby-v2.ts` and `repromote-lobby` are correct as-is; the defect was upstream.
- **Blocked on a GPU re-ingest session** (steps 2–3): the persisted match-250 snapshot is still
  scrambled until `extract_lobby_evidence` re-runs over frames. The 3 lobby gates stay `test.skip`
  until then — un-skipping now would go red against the stale data. 463/968 generalization + the
  un-skip ride on that same re-ingest session.

## Open questions for the implementation session

- Does a re-ingest's frame sampling reliably capture settled frames? Run 1954 has only 2 lobby
  extractions — confirm the sampling/frame-budget policy keeps enough post-transition frames to vote
  on before relying on re-ingest.
- Trace the `lobby-v2.ts` promotion/consolidation reshuffle (see "promotion path" note) so the fix
  targets the right layer (Python aggregation vs TS promotion selection).
- Which gate assertions actually bind: some fields (height_text / weight_lbs / player_level_number)
  are conditionally asserted only when non-null (Phase 3 extractors not yet wired). The load-bearing
  floors are gamertag + position (hard) and player_number + persona + is_captain (soft).
