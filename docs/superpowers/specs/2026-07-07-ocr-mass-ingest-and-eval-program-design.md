# OCR Mass-Ingest & Eval Program — Design

- **Date:** 2026-07-07
- **Status:** Design approved. Ready for `writing-plans` (in a fresh session).
- **Author:** brainstorming session (Claude + operator)
- **Scope decision:** design all three components as one program with shared sequencing.

---

## 1. Motivation & Context

The operator is about to do a large ingest of NHL26 gameplay recordings and wants to
use it as an opportunity to improve the OCR system, doing the improvement work
**before** the mass run begins.

**Library reality (measured 2026-07-06):**

- NHL26 recordings since match 250 (the first stats-recorded match, captured
  2026-05-08): **~100 matches**, of which only **4 have been OCR-ingested**.
  - 16 curated `matchNNN/` folders (each one match, all ≥ 250).
  - 63 loose top-level recordings on/after 2026-05-08 (~118 GB, 48.5 hrs readable):
    ~40 single-match files (10–58 min), 16 multi-match sessions (≥58 min, 100–170
    min ⇒ 3–5 games each ⇒ ~47 games), 7 sub-10-min partials, and one 50 GB
    `2026-06-08` file whose duration will not probe (likely unfinalized/corrupt).
  - Roughly **47 matches are trapped inside multi-match files** the pipeline
    cannot currently separate.
- Only matches **since 250** have deliberate operator capture of loadouts +
  post-game action tracker / events / box score. Older games (NHL22–25) and
  pre-250 footage are **out of scope** for this program.

**Two OCR value regimes (inversely easy to grade):**

- **Box-score fields** — the EA API already has these for the ~199 NHL26 matches
  in the DB, so they are free to auto-grade. OCR adds *unique* value here only for
  matches the API **missed** (the 5-recent-match API window ⇒ permanent data loss).
- **Unique fields** — action-tracker events, shot/goal coordinates, faceoff maps,
  loadouts/X-factors. The API never provides these; this is the real reason OCR
  exists. But there is **no free ground truth** — grading needs hand-labeled
  benchmarks (like the match-250 V2 benchmark).

**Pipeline reality (the structural gap):** the video-ingest pipeline is hard-wired
**one video → one match**. `orchestrator.py::ingest()` takes a single `match_id`;
Pass-1 "segments" are *screen types* (decoded by a Viterbi state machine), **not
match boundaries**; `dispatch_segments` fans every screen-segment out under that one
`match_id`. A multi-match file today collapses into one match's worth of
overwritten data. Multi-game extraction is therefore a **prerequisite**, not an
extra.

---

## 2. Goals & Non-Goals

**Goals**

1. Split one video into N per-match "reels" so multi-match sessions ingest correctly.
2. Tie each reel to the right DB `match_id` with a low-effort, safe workflow.
3. Auto-grade box-score OCR against EA-API truth so ingest is *measured*, not blind.
4. Run ~100 matches unattended (overnight / while away), resumably and safely.

**Non-Goals (this program)**

- Older games (NHL22–25) and pre-250 footage.
- Hand-labeled benchmarks for unique fields (events/coords/loadouts) beyond
  confidence flagging. Unique-field accuracy is a *later* program.
- Rewriting the existing Pass-2 or promotion pipeline. Those stay largely untouched.

---

## 3. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Program scope | Design all three components together, one shared spec + sequencing |
| 2 | Match → `match_id` association | **Hybrid**: auto-propose (OCR score/teams/date → fuzzy-match to API) + operator confirm |
| 3 | Accuracy investment focus | **Box-score first** (API-gradable); unique fields ride along with confidence flags |
| 4 | Match-boundary detection | **State-machine grouping** (group existing Pass-1 screen-segments), with operator confirm/override fallback |

---

## 4. Architecture

```
[video file]
   │
   ▼  ① MATCH-SPLIT   group Pass-1 screen-segments into per-match reels
[reel A][reel B][reel C] ...
   │
   ▼  ② ASSOCIATE     identity-probe OCR (score/teams/date) → fuzzy-match API → propose match_id → operator confirm
[reel A→match 2701][reel B→match 2702] ...
   │
   ▼  Pass-2 + existing promotion pipeline  (per reel, per match_id)   ← already built
   │
   ▼  ③ AUTO-EVAL     promoted box-score vs EA-API truth → per-field diff + score (new L4 layer)
   │
   ▼  ④ ORCHESTRATION enumerate → dedup → prioritize → run unattended → review queue + scorecards
```

Components ②③④ are new or generalized; Pass-2 + promotion already exist.

---

## 5. Component ① — MATCH-SPLIT

**Location:** new module `tools/video_ingest/video_ingest/match_split.py`, running
*after* Pass-1, *before* Pass-2/dispatch. Consumes the screen-typed segments Pass-1
already emits; groups them into per-match reels. Pass-2 and dispatch then run **once
per reel** (each windowed to its reel time range, each dispatched under its own
`match_id`) — a modest change to the existing dispatch loop, which today fires once
for the whole video.

**Confirmed screen-type vocabulary (from `tools/game_ocr` state machine):**
`pre_game_lobby`, `post_game_box_score_goals`, `post_game_box_score_shots`,
`post_game_box_score_faceoffs`, `post_game_action_tracker`, `post_game_events`,
`post_game_net_chart`, `post_game_faceoff_map`, `post_game_player_summary`,
`loadout_view` / `loadout_slot_seg`.

**Grouping rule (over the segment sequence):**

- A reel **opens** at a `pre_game_lobby` segment (the match-start marker).
- It **closes** at the post-game cluster (`post_game_box_score_*` /
  `post_game_action_tracker` / etc.) when followed by the *next* `pre_game_lobby`,
  or at end-of-video.
- Everything between belongs to that reel.

**Edge cases — handled by *flagging, never dropping* (these are the operator's
real recording issues):**

- **Late start (no lobby):** a post-game box score with no preceding lobby still
  forms a reel (start = prior boundary / video start), flagged `missing_lobby`.
- **Early stop (no post-game):** a lobby + gameplay with no box score still emits a
  reel, flagged `partial_no_boxscore`.
- **Sub-10-min fragment:** zero reels, or one flagged `incomplete` — never merged
  into a neighbor.
- **Back-to-back, no clear gap:** ambiguous post-game→lobby transition ⇒ reel
  flagged `low_confidence_boundary` for operator review.

**Output contract — `reels.json`:** N reels, each
`{reel_index, start_s, end_s, segment_indices, screen_inventory {has_lobby,
has_boxscore, has_action_tracker, has_events, has_loadout}, completeness_flags[],
boundary_confidence}`. Feeds the operator confirm step (merge/split/nudge) and ③
(a `partial_no_boxscore` reel sets expectations for what is gradable).

---

## 6. Component ② — ASSOCIATE (reel → DB `match_id`)

**Ordering (critical):** association runs on a cheap **identity probe** *before*
full Pass-2/promotion, so we never dispatch under a placeholder ID. The probe OCRs
only the identifying fields from a handful of the reel's box-score/lobby frames:
**final score, opponent name, a few player personas.** Once a `match_id` is
confirmed, the full per-reel Pass-2 + promotion runs under it.

**Matching signals (weighted score vs the ~199 API matches):**

- **Capture timestamp** — file basename (`2026-05-20_18-15-59`) + reel offset gives
  wall-clock time; API match has `played_at`. Very strong (evening-session
  clustering ⇒ narrows to 1–2 candidates).
- **Final score** — exact BGM-vs-opponent goals; near-decisive with date.
- **Opponent name** — fuzzy string match (reuse existing persona-normalization fuzzy
  logic).
- **Roster/persona overlap** — personas OCR'd from box score vs API match roster;
  strong tiebreaker.

Best candidate + confidence + runner-up gap ⇒ a **proposal**.

**Confirm UX:** new worker CLI `resolve-match-cli` (sibling to existing
`reconcile-*` / `decoder-runs-cli`) lists proposals sorted by confidence with
evidence (score/opp/date/roster); operator confirms or overrides. Only **confirmed**
associations stamp `match_id` onto the reel's capture batch and unlock promotion.
(Confirm surface is a CLI review queue; a lightweight web review page is a possible
later refinement — see Open Questions.)

**Data model — new table `ocr_match_associations`:**
`{id, reel_identity, video_sha256, run_id, proposed_match_id, confidence,
evidence jsonb, status: pending|confirmed|rejected}`. Clean audit trail; mirrors the
existing candidate→confirm pattern.

**No-match handling:** nothing clears threshold ⇒ flag `no_api_match`. That is
likely an **API-missed match** (high-value OCR-only case ⇒ prioritized by ④), not an
error. Operator confirms it as a new / OCR-only match.

---

## 7. Component ③ — AUTO-EVAL (box-score vs EA-API)

**Not a new tool — a new layer on the existing run-quality report.**
`apps/worker/src/lib/run-quality-report.ts` already builds layered scorecards
(L1/L2/L3, pass/fail) into `ocr_run_quality_reports` via `computeLayers`. ③ adds an
**API-truth accuracy layer (L4)** to that same structure. Confirmed greenfield:
nothing currently joins OCR output to `player_match_stats` for grading — and
`post-game-player-summary.ts`'s own header already notes its per-player data "is
redundant with what the EA API gives us via `player_match_stats` … for
reconciliation when EA payloads disagree."

**Comparison surface — two tiers, both auto-gradable:**

- **Team totals:** OCR `box-score.ts` (`goals/shots/faceoffs_for/against`, promoted
  to the match/period summary) ↔ API team aggregates (from `player_match_stats`
  by `team_side`).
- **Per-player lines:** OCR `post_game_player_summary` (goals, assists, saves,
  save%) ↔ `player_match_stats` per player, joined on resolved identity.

> The exact gradable field set = (fields `box-score.ts` + `post_game_player_summary`
> extract) ∩ `player_match_stats` columns. Pin the precise list during
> implementation — the per-player OCR surface is a *subset* (goals/assists/saves/
> save%), not the full stat line.

**Output:** per-field diff (`ocr_value`, `api_value`, `exact_match` bool), a
per-match accuracy score, and a mismatch list with evidence — written as the L4
section on the run-quality row. Counting stats grade **exact**; a per-match pass
threshold feeds ④'s review queue.

**Dual role:** (1) grades OCR reading accuracy where API truth exists, and directly
**fills API-missed matches**; (2) **doubles as ②'s association safety-check** — if
OCR-read score/roster matches the *proposed* API match, that is strong evidence the
association is correct. API-missed matches (no `player_match_stats`) are marked
"ungradable — OCR sole source," not failed.

---

## 8. Component ④ — BATCH ORCHESTRATION

A runner (extends `reprocess.py`'s run lifecycle) that is safe to leave running:

1. **Enumerate** the target set (NHL26 since-250: `matchNNN/` folders + loose files).
2. **Dedup** by sha256 — skip shas already in `ocr_capture_batches.video_sha256`;
   collapse `.mkv`/`.mp4`/`.remuxed`/`- Trim` copies.
3. **Prioritize** — API-missed matches first (unique value), then API-covered
   (eval), partials last.
4. **Preflight** — GPU-venv walk-import smoke test *before* committing hours (known
   venv-fragility trap: `video-ingest reprocess` runs in `tools/video_ingest/.venv`
   and can lose the full closure incl. pydantic on any `uv sync`).
5. **Run per video** — `run_id` → Pass-1 → ① split → ② identity-probe + association
   proposals → per-reel Pass-2 + promotion → ③ eval. Idempotent + resumable via
   sha-keyed caches and `run_id` scoping (both already exist).
6. **Emit review queue** — proposals + eval scorecards + completeness flags for
   `resolve-match-cli`. **Nothing promotes to canonical without passing ③'s
   threshold AND operator confirming ②'s association.**

---

## 9. Cross-Cutting

**Error handling**

- Flag-never-drop (①); confidence/threshold gates (②③); per-video failure isolation
  (a corrupt file like the 50 GB `2026-06-08` one is logged + skipped, run
  continues); no silent truncation (log every skip/partial/dropped file).

**Testing**

- Unit: split grouping rule (segment-sequence fixtures for late-start / early-stop /
  fragment / back-to-back edge cases); association fuzzy-scorer (synthetic candidate
  sets); eval comparator (known OCR↔API pairs).
- Regression anchor: keep `apps/worker/src/__tests__/match-250-benchmark.test.ts`
  green throughout.

---

## 10. Data-Model & Interface Changes (summary)

- **New:** `ocr_match_associations` table (§6).
- **New:** `reels.json` per-video artifact (§5).
- **New:** L4 API-truth accuracy section on `ocr_run_quality_reports` (§7).
- **New CLI:** `resolve-match-cli` (worker) for association review/confirm.
- **Changed:** dispatch loop iterates reels (per-reel `match_id`) instead of once
  per video; new `match_split` step between Pass-1 and Pass-2.

---

## 11. Suggested Implementation Sequencing (for `writing-plans` to refine)

1. **③ Auto-eval first** — smallest, and immediately testable against the 4
   already-ingested matches; establishes the measurement backbone everything else is
   verified against.
2. **① Match-split** — unlocks the ~47 trapped multi-match games.
3. **② Associate** — depends on ① reels and uses ③ as its safety-check.
4. **④ Orchestration** — ties ①②③ into the unattended mass run.

(Build order is independent of decision #1, which was about designing them together.)

---

## 12. Open Questions / Risks

- **Exact gradable field set** — pin (OCR box-score ∪ player-summary) ∩
  `player_match_stats` during implementation; the per-player OCR surface is a subset.
- **Confirm UX** — CLI review queue is the baseline; decide later whether a
  lightweight web review page is worth it for the tiny audience.
- **50 GB `2026-06-08` file** — needs a remux/repair check before it is trusted;
  may be unusable.
- **GPU venv fragility** — the preflight smoke test (§8.4) is mandatory, not
  optional, given prior 37-min crash from a lost pydantic closure.
- **Unique-field accuracy** — explicitly deferred; only confidence-flagged here.
- **Association threshold tuning** — the confidence cutoff for auto-propose vs
  `no_api_match` needs empirical calibration on the first batch.

---

## 13. Grounding References (files read this session)

- `tools/video_ingest/video_ingest/orchestrator.py` — one-video→one-match pipeline,
  Pass-1/Pass-2/dispatch, `run_id` + sha-keyed caching.
- `tools/video_ingest/video_ingest/cli.py` — `ingest` / `classify-only` /
  `extract-only`, `--match-id` (manual association today).
- `apps/worker/src/ocr-promoters/` — `box-score.ts` (team for/against totals),
  `post-game-player-summary.ts` (per-player, notes API redundancy), and the rest.
- `apps/worker/src/lib/run-quality-report.ts` — existing layered scorecard infra
  (generalization target for ③).
- DB: `player_match_stats` (API truth surface), `ocr_capture_batches`,
  `ocr_promotions`, `ocr_run_quality_reports`, `ocr_decoder_runs`.
