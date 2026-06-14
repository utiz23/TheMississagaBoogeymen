# Captain (is_captain / ★ room-leader) detection — extractor follow-up

Filed 2026-06-14 (Tier 1, plan `~/.claude/plans/sorry-forgot-to-put-steady-lemon.md`, WS-A).

## Status: genuine extractor-quality limit — quarantined, NOT fixable in `consolidate`

WS-A originally proposed fixing the match-250 captain red
(`match 250: getMatchLineups returns expected slot data`) by having `consolidate-loadouts.ts`
read the per-slot captain confidence and gate the pure-OR fold
([consolidate-loadouts.ts:303](../../apps/worker/src/lib/consolidate-loadouts.ts)). A read-only
pre-flight against the live DB **disproved that premise**. No code/DB change was made.

## What the pre-flight found (verified read-only)

1. **The stored captain confidence does not discriminate right from wrong.** `ocr_field_evidence`/
   `ocr_promotions` `raw_confidence`/`winning_confidence` for `field_key='is_captain'` is the OCR
   *line* confidence where the ★ glyph was (or wasn't) read — not a star-detection score. For
   match 250:
   - for/LW Stick Menace — captain=**true** @ **0.9980** ← the false positive (V2: not captain)
   - for/C MrHomiecide — captain=true @ 0.9935 ← real captain (only in inactive run 1)
   - against/C XZ4RKY — captain=true @ 0.9993 ← real captain

   The false positive's confidence sits *between* the two real captains. No threshold separates
   them.

2. **The active run carries no usable captain signal.** Match 250's active decoder run is 583
   (`hmm-viterbi-v2`); all its `is_captain` promotions have `winning_value=NULL` /
   `winning_confidence=0.0000`. The captain values that survive in the canonical snapshots come
   from older runs (1 `legacy-mixed`, 392) that persist in `player_loadout_snapshots` (which has
   no `run_id` column). So an active-run-scoped reconstruction yields nothing.

3. **Captain detection is systematically unreliable across matches** (reviewed snapshots, what
   `getMatchLineups` shows):
   - 250: for-side flags only the *wrong* slot true; real captains are null.
   - 463: for-side flags **2** captains true — impossible (one room-leader per side).
   - 968: 1 true; 2582: 0.
   - There are **zero** `is_captain=false` values anywhere — `consensus()` only ever yields `true`
     or `null` — so the read-layer one-captain-per-side guard
     ([match-lineups.ts:365-373](../../packages/db/src/queries/match-lineups.ts)) only helps when
     ≥2 trues collide on a side (e.g. 463), and cannot fix a lone wrong flag (250).

Because the true captain (for/C) is simply absent from match 250's active snapshots, no
consolidate-layer rule can *recover* the correct answer — only choose between asserting a wrong
captain or asserting none. The benchmark already tolerates `null` (captain is a documented Phase 3
gap), so the test's only real failure is the wrong `true` on for/LW.

## What an honest fix needs (extractor work)

This belongs in the same class as the deferred lobby/2582 extractor work, not data repair:

1. **A real ★ detection score.** Replace the "OCR text-line confidence at the glyph" signal with a
   genuine template/color-match score for the yellow ★ marker (the icon is colored and
   positionally fixed next to the gamertag). Extractors:
   [lobby_extractors/slot_identity.py:344-357](../../tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py),
   [loadout_extractors/slot_identity.py:664-666](../../tools/game_ocr/game_ocr/loadout_extractors/slot_identity.py).
2. **Persist that score** as a discriminating confidence on the evidence/promotion (and optionally
   a snapshot column) so a downstream gate can actually separate true from false.
3. **One-captain-per-side invariant at promotion/consolidate**: at most one room-leader per side;
   reject/null a side whose flags violate it (fixes 463's 2-per-side immediately).
4. Re-ingest the affected matches with a `DECODER_VERSION` bump (same path as WS-B) so the new
   score lands in the active run.

Do **not** lower the V2 captain expectations, and do **not** force the test green by promoting a
captain we cannot verify.

## Disposition

- `match 250: getMatchLineups returns expected slot data` stays **quarantined**
  (`tier0-quarantined-worker-tests.txt`).
- No `consolidate` change, no re-consolidate, no DB mutation performed.
