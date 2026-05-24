# Review prompts for Phase 4b (internal) and 4c (external)

These are queued, ready to fire as soon as `docs/calibration/research-2026-05-19.md` lands. Both consume the same inputs; the prompts differ in framing (inside view vs fresh eyes).

---

## Phase 4b — Internal review (Claude sub-agent)

Spawn via the `Plan` or `code-reviewer` subagent_type.

> **Read these in order:**
>
> - `docs/calibration/baseline-2026-05-19.md` — context
> - `docs/calibration/research-2026-05-19.md` — the new input
> - `apps/worker/src/ocr-promoters/match-events-dedup.ts` — Q1 codepath
> - `apps/worker/src/ocr-promoters/action-tracker.ts` — Q1 codepath
> - `tools/game_ocr/scripts/inventory_consensus_match.py` — Q1 codepath
> - `tools/game_ocr/game_ocr/classifier.py` — Q2 codepath (especially `anchor_color_floor` at line 303)
> - `tools/game_ocr/scripts/calibrate_classifier.py` — Q3 codepath
>
> For each of the research doc's **top-3 prioritised recommendations**:
>
> - Is the codebase actually shaped the way the recommendation assumes? Flag any mismatch.
> - Are there hidden interactions with cached Pass-1 results, the existing consolidator pipeline, or the match-quality report that the recommendation doesn't account for?
> - For any recommendation involving classifier recalibration, confirm the existing test at `tools/game_ocr/tests/test_classifier.py:132-148` would still pass against the canonical 9 ScreenShots fixtures after the proposed change.
> - For any recommendation touching the matcher, confirm the existing 1:1 assignment invariant in `inventory_consensus_match.py:441-468` is preserved or its violation explicitly justified.
>
> For each of the **4 architectural questions** (Q1–Q4):
>
> - Does the recommendation generalise beyond match 463 to other matches we haven't seen? Or is it overfit to the specific 6 marker-collision pairs?
> - Is the operator-effort budget (~5 min/match) respected by the proposed `annotate-segments` workflow?
>
> Report a short critique (≤600 words) with `file:line` citations for any codepath you call out. Use `[FAIL]` / `[WARN]` / `[OK]` tags at the start of each bullet. Save the output to `docs/calibration/internal-review-2026-05-19.md`.

---

## Phase 4c — External review (Codex sub-agent)

Spawn via `codex:rescue` subagent_type.

> **Pretend you have never seen this codebase.** Read these inputs and critique the research recommendations as if you were a senior systems engineer joining the project this week:
>
> - `docs/calibration/baseline-2026-05-19.md`
> - `docs/calibration/research-2026-05-19.md`
> - `docs/calibration/internal-review-2026-05-19.md` (output of Phase 4b)
>
> What's _missing_ from the recommendations that anyone working inside the codebase would assume? What blind spots does the internal review likely have?
>
> Focus the critique on:
>
> - Whether the proposed designs are over-engineered for a single-user, no-SLA, ~30-matches-per-season system
> - Whether simpler alternatives were dismissed without justification
> - Whether the operator workflow assumptions (~5 min/match labeling) are realistic
> - Whether there's a "do nothing" option for any of Q1–Q4 that has merit
> - Whether the order of Phase 5b.2 / Phase 0 / Phase 3 work proposed is correct, or should be reshuffled
>
> Report a critique (≤700 words). Save to `docs/calibration/external-review-2026-05-19.md`.

---

## After both reviews land

The final Phase-5 plan distils all three (research + internal + external) into a concrete to-do list for the next session. Living in `docs/calibration/phase-5-plan-2026-05-19.md`, structured as:

- For each architectural question Q1–Q4: chosen approach + 2-line justification citing the 3 review sources
- File-level change list with line citations
- Verification commands
- Acceptance criteria (target deltas in match-quality scores)
