# Phase 3c — Lobby Gamertag Junk Filter

## Context

Phase 3b's cutover surfaced a measurable extractor data-quality gap: the typed lobby promoter's gamertag accuracy was 7/10 (70%) on match 250, failing the `≥ 90%` hard-field bar codified in `match-250-benchmark.test.ts`. Three error patterns account for all failures:

| Pattern | Examples | Where |
|---|---|---|
| UI navigation/header text picked as gamertag | "CHEL", "VIEWINGLOADOUTS", "SPORTS", "ZA SPORTS" | match 250: against/RD, for/RW; match 463: against/C, against/LD |
| Build-class strings picked as gamertag | "Puck Moving Defenseman" | match 463: for/RD |
| Adjacent-row content bleeds into a slot | "DuhPope" assigned to BGM LW (opponent player on BGM row) | match 250: for/LW |

The first two are filter problems — `_filter_gamertag_candidates` in `tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py` doesn't recognize UI labels or build-class strings as junk. The third is a slot-band alignment problem (deferred to Phase 3d).

This spec scopes the surgical filter fix only. Closes 2 of 3 error patterns → gamertag accuracy goes from 7/10 (70%) → ≥ 9/10 (90%). Hits the Phase 3b hard-field bar precisely.

## Scope

**In scope:**
- UI-label denylist constant in `slot_identity.py`, mirroring the existing `LOBBY_POSITION_TOKENS` / `LOBBY_TEAM_SIDE_LABELS` constants. Normalized (uppercase, no-space) comparison.
- Build-class rejection via `ClosedVocab.match_canonical` against the existing `build_classes` vocabulary YAML. Lazy-load + cache on the extractor module.
- Two new unit tests in `test_lobby_slot_identity.py` covering both rejection paths.
- Re-run the Phase 3b cutover ingest + consolidator on matches 250 + 463, then verify `lobby typed_v1 hard-field accuracy ≥ 90%` benchmark test passes.

**Out of scope (Phase 3d candidates):**
- Slot-band alignment fix (BGM LW = "DuhPope")
- Persona alias seeding (`H.0'Yointski` → `H. O'YOINTSKI`; closes the soft-field gap)
- Loadout-v2 FK bug (Phase 2B preexisting)
- Schema changes (`is_ready` materialization)

## Architecture

Single touchpoint: `_filter_gamertag_candidates` in `slot_identity.py`. Add two new rejection clauses AFTER the existing exclusions (position tokens, `#`, `LVL`, measurements, etc.) and BEFORE returning the filtered list.

### Component 1 — UI-label denylist

```python
# tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py
LOBBY_UI_LABEL_DENYLIST: frozenset[str] = frozenset({
    # Game / mode labels
    "CHEL", "EASHL", "NHL", "EASPORTS", "ZASPORTS", "SPORTS",
    # Top-bar nav tabs
    "PLAY", "LOADOUTS", "CLUBS", "CUSTOMIZE", "SEASONPASS",
    "STORE", "REWARDS", "STATS", "OBJECTIVES",
    # Lobby state / readiness indicators that survive the existing READY strip
    "READY", "VIEWINGLOADOUTS",
    # Pre-game arena chrome
    "ARENA", "CLUBRANK", "GAMESTARTSIN", "VIEWOBJECTIVES",
})
```

Comparison key: `text.strip().upper().replace(" ", "")`. Matches the same normalization used for `LOBBY_POSITION_TOKENS`. Single-line lines like `"VIEWING LOADOUTS"` collapse to `"VIEWINGLOADOUTS"` and match.

### Component 2 — Build-class rejection

`ClosedVocab.match_canonical(text)` already exists (see `tools/game_ocr/game_ocr/loadout_extractors/closed_vocab.py`). Returns `(canonical, confidence)` or `None`. Confidence is `1.0` for exact regex match, `0.5` for Levenshtein-≤2 fuzzy fallback. Reject when match returns a `(canonical, ≥0.5)` tuple — i.e., any non-null match.

Implementation:
```python
# slot_identity.py — module scope
from .loadout_extractors.closed_vocab import ClosedVocab, load_closed_vocab

_BUILD_CLASS_VOCAB: ClosedVocab | None = None

def _build_class_vocab() -> ClosedVocab:
    global _BUILD_CLASS_VOCAB
    if _BUILD_CLASS_VOCAB is None:
        _BUILD_CLASS_VOCAB = load_closed_vocab("build_classes", version="nhl26")
    return _BUILD_CLASS_VOCAB
```

Cache is module-level (not per-instance) so the vocab loads once per Python process. Acceptable: `build_classes.yaml` is read-only at runtime and the parsed `ClosedVocab` is immutable.

### Component 3 — Filter integration

Update `_filter_gamertag_candidates` (currently around line 250-280 of `slot_identity.py`). New rejection clauses inside the loop:

```python
def _filter_gamertag_candidates(row_lines, *, build_raw):
    out = []
    vocab = _build_class_vocab()
    for line in row_lines:
        text = line.text
        # ... existing exclusions ...

        # NEW: UI-label denylist
        normalized = text.strip().upper().replace(" ", "")
        if normalized in LOBBY_UI_LABEL_DENYLIST:
            continue

        # NEW: build-class match (reject if the text matches a canonical
        # build class — that's not a gamertag).
        match = vocab.match_canonical(text)
        if match is not None and match[1] >= 0.5:
            continue

        # ... existing clean_gamertag + non-empty check ...
        out.append(line)
    return out
```

Order: cheap string compare first, closed-vocab match last (it's the most expensive check).

## Critical files

**To modify:**
- `tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py` — add `LOBBY_UI_LABEL_DENYLIST`, `_build_class_vocab()`, update `_filter_gamertag_candidates`. Export `LOBBY_UI_LABEL_DENYLIST` from `__init__.py`.
- `tools/game_ocr/game_ocr/lobby_extractors/__init__.py` — re-export `LOBBY_UI_LABEL_DENYLIST` (the package's __init__ already deliberately avoids importing `slot_identity` to prevent the Phase 3b circular import; the denylist constant can stay slot_identity-local).
- `tools/game_ocr/tests/test_lobby_slot_identity.py` — add 2 new tests.

**Reused (no changes):**
- `tools/game_ocr/game_ocr/loadout_extractors/closed_vocab.py::load_closed_vocab` + `ClosedVocab.match_canonical`.
- `tools/game_ocr/game_ocr/configs/closed_vocab/nhl26/build_classes.yaml`.
- `apps/worker/src/__tests__/match-250-benchmark.test.ts` — existing accuracy gates re-exercise after re-ingest.

## Tests

### Unit tests (Python)

`tools/game_ocr/tests/test_lobby_slot_identity.py` — add:

```python
def test_rejects_ui_label_as_gamertag(self) -> None:
    # Row with "VIEWINGLOADOUTS" UI label as topmost line + real gamertag below
    lines = [
        _line("C", 77, 300),
        _line("VIEWINGLOADOUTS", 250, 290),
        _line("MrHomiecide", 250, 295),
        _line("#11-E.Wanhg", 250, 310),
    ]
    rows = detect_lobby_rows(lines)
    bgm_rows = [r for r in rows if r.team_side == "our_team"]
    subjects = identify_lobby_subjects(bgm_rows)
    c = next(s for s in subjects if s.position == "C")
    self.assertEqual(c.gamertag, "MrHomiecide")

def test_rejects_build_class_as_gamertag(self) -> None:
    # Row where the build-class line was NOT pre-extracted (state_2 frame)
    # but appears as a candidate. The closed-vocab match should reject it.
    lines = [
        _line("RD", 77, 300),
        _line("Puck Moving Defenseman", 250, 290),
        _line("JoeyFlopfish", 250, 295),
        _line("#48-L.Hutson", 250, 310),
    ]
    rows = detect_lobby_rows(lines)
    bgm_rows = [r for r in rows if r.team_side == "our_team"]
    subjects = identify_lobby_subjects(bgm_rows)
    rd = next(s for s in subjects if s.position == "RD")
    self.assertEqual(rd.gamertag, "JoeyFlopfish")
```

### Integration / regression

- Existing `test_parsers.py` lobby cases stay green.
- Existing `test_lobby_row_grouping.py`, `test_lobby_slot_identity.py`, `test_lobby_evidence.py` all stay green.
- Re-run Phase 3b cutover (Pass-1 cached; `--force-pass2`) on matches 250 + 463, run consolidator, then:

```bash
set -a && source .env && set +a
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
```

`match 250: lobby typed_v1 hard-field accuracy ≥ 90%` MUST pass.

## Verification gates (end-to-end)

Complete when ALL hold:

1. New tests pass: `pytest tools/game_ocr/tests/test_lobby_slot_identity.py`.
2. Existing test suites green: full Python + worker test suites unchanged.
3. After re-ingest + consolidator: SQL Gate D shows gamertag non-null on ≥ 9/10 lobby-sourced slots per match.
4. Benchmark test `match 250: lobby typed_v1 hard-field accuracy ≥ 90%` flips from FAIL → PASS.
5. Soft-field test (persona) may still fail — that's Phase 3d's separate scope.
6. Cutover doc updated with the re-run results.

## Risks

- **Denylist false positives.** A real gamertag like "STATS" or "PLAY" would now be rejected. Mitigation: all denylist entries are ≥ 4 chars and chosen because they appear as UI chrome, not in observed operator gamertags. If a future match has an operator named "STATSGUY" the candidate would still pass (normalized="STATSGUY", not in set). Operators flag false rejections by inspecting `ocr_promotions.blocked_*` reasons during cutover Gate E.
- **Build-class false positives.** A gamertag accidentally matching `match_canonical` (e.g., a player literally named "Playmaker"). Confidence ≥ 0.5 means exact regex OR Levenshtein-≤2 — the bar is high enough that a clean gamertag string won't usually fuzzy-match a build class. Mitigation: if a real gamertag is rejected, operator adds it to a per-gamertag allow-list (out of scope for Phase 3c; defer until a real case surfaces).
- **Persona accuracy still fails (3/10).** Phase 3c doesn't fix persona. The benchmark test will still show the soft-field gate failing. Document this in the cutover re-run notes.

## Bail-out triggers

Revert the filter changes if:
- Any existing Python test fails after the change.
- Match 463's gamertag accuracy regresses (currently ~7/12; should stay ≥ 7/12).
- Match 250's loadout-view snapshots regress below Phase 2B's 10/10 floor.

## Sequencing

Single linear task: edit `slot_identity.py` + tests → run unit tests → re-ingest + consolidator → run benchmark → update cutover doc. No external dependencies, no multi-step migration.

## Out of scope (clarification for future phases)

- **Slot-band alignment (Phase 3d):** the `_LOBBY_ROW_BAND_PX = 45` tolerance in `row_grouping.py` pulls in content from adjacent rows when the y-distance is < 45 px. Fixing requires either tighter tolerance (risks losing partial-panel rows) or anchor-based per-row clipping. Substantial work.
- **Persona alias seeding (Phase 3d):** `player_persona_aliases` table seeds for V2 benchmark personas. Operator-driven DB inserts, not extractor code.
- **Loadout-v2 FK bug:** Phase 2B's `support_frame_ids[0]` → `ocrExtractionId` mismatch (same pattern as the lobby-v2 fix in Phase 3b cutover). Affects loadout-view provenance; separate phase.
