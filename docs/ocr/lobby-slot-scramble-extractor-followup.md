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

### Two compounding data defects (why a code fix alone won't clear the gate)

1. **Stale persistence.** The persisted lobby snapshots are from run 392 and were never refreshed by
   the active run 1954 (which has only 2 lobby extractions vs run 392's 35 / run 583's 35). The gate
   grades run-392 data even though 1954 is active.
2. **Gate has no run filter.** `loadLobbySnapshotsForMatch` joins every run's lobby snapshots and
   `findSlotRow` takes the first `.find()` match, so it grades whatever stale row happens to exist.

### Note on the promotion path (open thread for implementation)

The 12 persisted rows carry `ocr_extraction_id = 12338` but their field values do **not** match a
faithful copy of 12338's `our_team` roster (e.g. persisted `for/C = Stick Menace #96`, but 12338's
`our_team.C = CPU`). So the promoter/consolidation reshuffles across the payload rather than copying
one frame verbatim. The exact map from extraction payload → persisted `(team_side, position)` rows in
[ocr-promoters/lobby-v2.ts](../../apps/worker/src/ocr-promoters/lobby-v2.ts) must be traced before
touching it. (This also corrects the 2026-06-14 claim that the promoter "faithfully writes whatever
slot the extractor assigned" — it does not.)

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

1. **Extractor (Python) — aggregate frames instead of trusting one.** In the lobby evidence /
   segment path, OCR all `pre_game_lobby_state_2` frames in the segment, drop frames/rows carrying
   the **transition signature** (a slot reads `CPU` while that same gamertag appears on the opposite
   panel; or a real gamertag sits in the wrong-side panel), then take a **per-slot majority vote**
   across the surviving settled frames. The ~28 settled frames outvote the ~7 transition frames
   cleanly. (The G1.1 handoff note flagged this same MAX→majority-vote concern for the captain star.)
2. **Data refresh for match 250.** The settled extractions already exist in the DB (run 392:
   12345, 12390–12410), so a **re-promote** that selects settled frames + majority-votes may refresh
   the persisted snapshot **without a full GPU re-ingest**. If re-promote can't reach the settled
   frames, fall back to a `DECODER_VERSION`-bumped re-ingest (reprocess → validate → gate → activate
   → re-consolidate). This is the DB-mutating step; back up first. **This corrects the handoff's
   claim that no re-ingest/refresh is needed — a code fix alone cannot move the gate.**
3. **Gate hygiene (test/query).** Filter `loadLobbySnapshotsForMatch` to the active run (and/or clear
   stale run-392 lobby snapshots) so the gate grades the current, settled data instead of whatever
   `.find()` returns first.

Validate against the proving bench + match-250 fixtures, and generalize the check to 463/968 (their
lobby segments have the same transition-frame structure).

Do not lower the V2 lobby field expectations to make these pass.

## Open questions for the implementation session

- Does a re-ingest's frame sampling reliably capture settled frames? Run 1954 has only 2 lobby
  extractions — confirm the sampling/frame-budget policy keeps enough post-transition frames to vote
  on before relying on re-ingest.
- Trace the `lobby-v2.ts` promotion/consolidation reshuffle (see "promotion path" note) so the fix
  targets the right layer (Python aggregation vs TS promotion selection).
- Which gate assertions actually bind: some fields (height_text / weight_lbs / player_level_number)
  are conditionally asserted only when non-null (Phase 3 extractors not yet wired). The load-bearing
  floors are gamertag + position (hard) and player_number + persona + is_captain (soft).
