# Handoff

## Active State

- **Primary active workstream:** pre-game lobby/loadout extraction accuracy on branch `feat/pregame-extraction-accuracy` at commit `f4d220e`.
- **Current objective:** implement **Phase C** from `/home/michal/.claude/plans/ok-lets-draft-a-parsed-pine.md`:
  port the canonical row-Y grid lookup used by loadout extraction into the lobby row-grouping path so lobby positions stop binding to raw anchor text.
- **Scope of the broader workstream:** drive near-perfect, benchmarked extraction for identity, captain marker, handedness, level, build, X-Factor, and attributes across matches 250 / 463 / 967 / 968 plus fresh NHL 26 footage.
- **Operator parallel item:** **463 / 967 / 968 all DONE** — hand-labeled + imported to `labels/{463,967,968}.json` (held_out, 10 skater subjects × 23 attrs; deltas on boosted cards). All three import fully canonical (build class, X-Factor names, tiers verified against closed vocab). Remaining: label any new matches the same way, then finalize `benchmark/manifest.json` (file is present but its contents are unverified — intent: 250 + 1–2 new → validation, 463/967/968 + rest → held-out). Unblocks calibration / held-out validation later in the plan.

## What Is Already Done

- **Phase A measurement foundation:** done in commit `e4850aa`.
  Delivered field scoring, subject alignment, report generation, V2 markdown import, benchmark CLI, and tests.
- **Phase A operator labeling — match 463:** done this session (UNCOMMITTED). Hand-labeled via the V2-markdown template → `labels/463.json` (held_out). Frames dumped to `/mnt/k/NHL/NHL26/match463-label-frames/` (lobby/lineup from the per-match `.mkv`; per-player loadout cards from the `silkyjoker85_*.mp4` — both source files needed; `README.txt` maps frame→player).
  - **Importer extended** (`scripts/import_v2_benchmark_md.py`): now parses the 3-col `| attr | Δ | R |` layout (captures delta + value; blank Δ in a 3-col table = 0) and Title-cases handedness. Backward-compatible — match 250 re-imports byte-identical.
  - **`Enforcer` added to `build_classes.yaml`** (vocab now 10; `test_closed_vocab_lr_head.py` comment 9→10, 19 tests pass). ⚠️ Build-class LR head has only **6 trained classes** (no Enforcer/Grinder/Offensive-D/Two-Way-D), so those labels won't *match* the extractor until a Phase B retrain.
- **Phase A operator labeling — matches 967 & 968:** done this session (UNCOMMITTED). Reviewed operator files (OneDrive `Whiskey Hotel/`) synced into `research/OCR-SS/` and imported → `labels/967.json`, `labels/968.json` (held_out, 10 subjects × 23 attrs each). Fixes applied during review: 967 Home-Center X-Factor tiers de-bracketed (`<Elite (Red)>`→`Elite (Red)`, `All-Star`→`All Star`); 968 Away-LD build code `EFD`→`ENF` (`Grizzer - ENF` → canonical `Enforcer`). Confirmed by operator: all away skaters left-handed, BGM-LW is `#96`, lobby X-Factor tier colour-reads are unreliable.
  - **Importer X-Factor source inverted** (`scripts/import_v2_benchmark_md.py`): X-Factors now read from the **loadout cards first** (clearer name + explicit tier), falling back to the lobby table only when a card has none. Also strips a trailing `(colour)` parenthetical from tiers before canonicalizing. Backward-compatible — match 250 re-imports byte-identical; all three benchmark matches (250/967/968) now have 30/30 canonical tiers.
- **Tier 0 OCR shippability:** complete as of 2026-06-13.
  The activate gate is live and fail-closed; `scripts/verify-ocr.sh` passes end-to-end.
- **Tier 1 data repair:** partially complete in commit `c0b6949`.
  Live-DB contamination was repaired and the test seeder now guards against clone pollution.
- **Residual quarantined extractor reds:** down to 4 total.
  Match 463 floor was rebaselined honestly; the remaining reds are 1 captain issue and 3 lobby-position issues, both intentionally deferred to extractor work.

## Next Session

1. Read `/home/michal/.claude/plans/ok-lets-draft-a-parsed-pine.md`.
2. Stay on `feat/pregame-extraction-accuracy`.
3. Implement Phase C only.
4. Run the smallest relevant lobby tests and benchmark checks.
5. Commit only if explicitly asked or if the user asks for a checkpoint.

## Repo State

- **Intentional unrelated drift:** `apps/web/src/app/games/page.tsx` is dirty and stays out of this OCR work.
- **Current dirty files in this repo during this handoff trim:** `AGENTS.md`, `CLAUDE.md`, `docs/session-playbook.md`, plus the handoff/archive rewrite here.
- **Uncommitted-but-shippable (463/967/968 labeling + importer, this + prior session):** `research/OCR-SS/Manual OCR benchmark match {463,967,968}.md`, `tools/game_ocr/scripts/import_v2_benchmark_md.py`, `tools/game_ocr/game_ocr/configs/closed_vocab/nhl26/build_classes.yaml`, `tools/game_ocr/tests/test_closed_vocab_lr_head.py`, `tools/game_ocr/calibration/extras/loadout/benchmark/labels/{463,967,968}.json`, and (untracked, unverified) `benchmark/manifest.json`. Suggested focused commit for the importer change: `feat(ocr): loadout-primary X-Factor import + 967/968 benchmark labels`.
- **Commit rule:** do not auto-commit. `AGENTS.md` controls.

## Archive

- Full historical handoff log moved to [docs/archive/handoff-history-2026-06-14.md](/home/michal/projects/eanhl-team-website/docs/archive/handoff-history-2026-06-14.md).
- That file preserves the prior OCR revamp history, session summaries, old roadmap items, and superseded notes without keeping `HANDOFF.md` unreadable.
