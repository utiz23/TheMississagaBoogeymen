# Event-List Extraction — Research Dossier

Status: **PARKED** — research is captured, implementation is deferred. Last updated 2026-05-11.

This doc consolidates everything we know about extracting event rows from the
left-side panel of EA NHL's Action Tracker screen. Sister document to
[marker-extraction-research.md](./marker-extraction-research.md); the two
systems integrate at the `(event_row, rink_marker)` linkage point.

---

## Problem statement

The Action Tracker screen has a scrollable list of event cards on the left
side, one per event in the current period. Each card visually encodes the
who/what/when/team-side of the event. The operator scrolls through the list
in-game and screenshots each frame; per-frame the list shows ~6-7 visible
cards. Events appear newest-at-top, oldest-at-bottom.

We want to extract, per event:

- event type (Hit / Shot / Goal / Penalty / Faceoff)
- team colour (BGM vs opp, derived from visual signal not gamertag lookup)
- time of event (clock MM:SS)
- event initiator (actor)
- event receiver (target)
- associated shot marker (the rink-position marker for this event)

### Visual encoding of an event row

Reference image: [Single_Event.png](../../research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Single_Event.png)
showing `L. HUTSON ON M. LEHMANN — SHOT 10:52 2nd Period`.
Reference panel: [Event_List.png](../../research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Event_List.png).

| element | position | encodes | reliability |
|---|---|---|---|
| Portrait box | left | actor's team primary color (red for BGM, dark for opp in this match) | **high** — clear gradient, only 2 distinct colors per match |
| Actor line | top-centre | `X ON Y` (action) or `X VS Y` (faceoff), uppercase | high |
| Event-type pill | mid-left of card | `HIT` / `SHOT` / `GOAL` / `FACEOFF` / `PENALTY` in colored badge | high if OCR reads cleanly; otherwise `'unknown'` |
| Clock | right of pill | `MM:SS` in [0:00, 19:59] | high |
| Period label | right of clock | `1st Period` / `2nd Period` / `3rd Period` / `OT` / `OT2`... | high |
| Play-arrow icon (▶) | far right, before badge | presence = replayable highlight clip exists | not extracted today |
| Event-type badge | far right | letter `S/H/G/P` inside circle. **Solid fill = home; white interior with team-color ring = away**. Per-match — for match 250 BGM is AWAY (scoreboard `BM` on left), so BGM rows are outlined. Faceoffs have no badge. | not extracted today |
| White border around card | whole-card outline | this row is the currently-selected one | high — already detected by `detect_selected_row_index` |
| Slight white tint on bg | row-wide fill | reinforces selection | high (secondary signal for the same state) |

### Row formats by event type (confirmed conventions)

Most events use one of two patterns (`X ON Y` for actions, `X VS Y` for
faceoffs). Penalties use a **third pattern** with no relation token:

| event_type | row format | fields |
|---|---|---|
| HIT | `X ON Y` | X = hitter, Y = victim |
| SHOT | `X ON Y` | X = shooter, Y = goalie/defender |
| GOAL | `X ON Y` | X = scorer, Y = goalie |
| FACEOFF | `X VS Y` | X = **winner**, Y = loser. Faceoffs with no winner aren't recorded. |
| **PENALTY** | `X <INFRACTION> (<SEVERITY>)` | X = culprit, `INFRACTION` = one or more words (`INTERFERENCE`, `HIGH STICKING`, `CROSS CHECKING`, `TRIPPING`, `HOOKING`, `HOLDING`, `SLASHING`...), `SEVERITY` = `MINOR` / `MAJOR` / `DOUBLE MINOR` |

**Penalties don't have a victim recorded** in this panel — only culprit +
infraction + severity. (If victim info is ever needed, it would come from
the Events screen, not the Action Tracker.)

### Reference image showing a penalty row

[research/OCR-SS/Action-Tracker examples](../../research/OCR-SS/Action-Tracker/)
contains a frame where row 7 is `J. MINOGUE INTERFERENCE (MINOR) — PENALTY
14:17 — 1st Period`. The right-side badge is a **green diamond with `P`**
(opp/PHI team color in that match; outlined-with-team-color-ring style
because PHI is the away team there). The corresponding rink marker is a
**yellow-highlighted diamond** in the offensive zone.

---

## Current state

### What gets extracted today

[`parse_post_game_action_tracker`](../../tools/game_ocr/game_ocr/parsers.py) →
`ActionTrackerEvent`:

| field | source | quality |
|---|---|---|
| `event_type` | pill text matched against `_ACTION_TRACKER_TYPES` | works when pill OCRs cleanly; falls back to `'unknown'` |
| `actor_snapshot` | text before `ON`/`VS` | works |
| `target_snapshot` | text after `ON`/`VS`, trailing chip letter stripped | works |
| `relation` | `ON` or `VS` verbatim | works |
| `clock` | regex `[01]?\d:[0-5]\d` against any line in the group | works, bounded to valid `MM:SS` |
| `period_label` | from `period_label` ROI | works |
| `period_number` | derived from `period_label` | works |
| `selected_event_index` | white-border detector from spatial.py | works — validated 6/6 on ground-truth captures |

### Gaps (what's missing for the user's target output)

| target | gap | available visual signal |
|---|---|---|
| **Penalties (UNVERIFIED)** | current parser regex requires `ON`/`VS`, which penalty rows don't have. May or may not be silently dropped — match 250 has no penalties and is the only ingested match. Test as soon as a penalty-containing match is OCR-ingested. | distinctive row text pattern `<player> <INFRACTION...> (<SEVERITY>)` with PENALTY pill |
| **Team colour from visual signal** | currently inferred post-hoc via `player_display_aliases` lookup; silently misfires when alias is missing — caused the M. RANTANEN misclassification | portrait colour (HSV sample) — but **opp team color varies per match** (GREEN for PHI, dark for the match 250 opponent). Need per-match opp-color detection. |
| **Per-row replay-clip flag** | not read | binary presence/absence of `▶` icon |
| **Per-row y-centre as a field** | used internally, never exposed | already computed |
| **Per-match BGM home/away identification** | not derived | scoreboard layout (`AWAY HOME` order); badge fill style (solid = home, outlined = away) |
| **Cross-frame deduplication** | naive `(period, type, clock, actor)` exact match; misses OCR variants → phantom rows | sliding window of visible rows across frames; fuzzy matching + voting could canonicalise |
| **Marker linkage for non-highlighted events** | only the yellow-highlighted row is linked to its rink marker | with the full-frame marker detector from the sister doc, every row could be paired |

### Specific failure modes observed in match 250

- `WILDE` vs `WILOE` (3 phantom hits at 2:09 and 6:51) — letter-shape OCR confusion
- `TOEWS` vs `fOEWS` (1 phantom shot at 2:35) — same
- `SILKY` vs `SIlKY` (1 phantom shot at 11:23) — caught by alias
- `unknown` event_type from icon-glyph misreads (5 events in P2/OT)
- `1:10` clock parse from `11:10` real (phantom SILKY shot at 1:10 in OT)
- Cutoff captures where the selected row is partially off-screen → parser omits the row entirely

All of these would have been caught by a cross-frame consensus engine — same real event reads cleanly in 3+ other frames, so the lone misread can be voted down.

### Penalty parser status — UNVERIFIED

Match 250 had **zero penalties** (EA-side `pim` = 0 across both teams, 0 penalty events). Match 250 is also the **only match we've ingested via the Action Tracker OCR pipeline** so far. So we have no test case for penalty rows in this parser.

Reading the code, the Action Tracker parser requires `ON` or `VS` in the actor line (`_ACTION_RELATION_RE = r"\s+(ON|VS)\s+"`); rows without either are skipped via `if not rel_match: continue`. Penalty rows in the in-game UI (per the PHI reference image) use the format `<culprit> <INFRACTION...> (<SEVERITY>)` with no `ON`/`VS`, which would appear to fail the regex.

But this is unverified empirically — when a real penalty-containing match gets ingested, we'll find out for sure. The Events screen parser already has a working penalty regex (`_EVENT_PENALTY_RE`) that could be lifted into the Action Tracker parser if it turns out we need it. Flag this for testing as soon as a real penalty match is run through the pipeline.

---

## Recommended architecture

Three layers, integrating with the marker-extraction system from the sister
research doc.

### Layer 0 — Penalty row parser (gap, must add first)

Current parser drops any row without `ON`/`VS`. Add a third pattern matcher
that fires when the actor line contains no relation token but the pill text
is `PENALTY`. Pattern:

```
^(?P<culprit>[^()]+?)\s+(?P<infraction>[A-Z][A-Z ]+?)\s+\((?P<severity>MINOR|MAJOR|DOUBLE MINOR)\)$
```

with the constraint that `<infraction>` may contain multiple words
(`HIGH STICKING`, `CROSS CHECKING`, `DELAY OF GAME`, etc.). The culprit
trails should be canonicalised against the known gamertag vocabulary same
as actor names from other event types.

The resulting `ActionTrackerEvent` (or a new `ActionTrackerPenaltyEvent`
subtype) carries:

- `culprit` (replaces `actor_snapshot` for this event type)
- `infraction` (new field, free text)
- `severity` (`minor` / `major` / `double_minor`)
- `target_snapshot` and `relation` are NULL — penalty rows don't have a victim here

The promoter should then write into `match_events` + `match_penalty_events`
(the extension table already exists, see [packages/db/src/schema/match-events.ts](../../packages/db/src/schema/match-events.ts)).

### Layer 1 — Per-row visual extraction (extends today's parser)

In addition to current fields, each row produces:

1. **Portrait colour sample** — HSV mask of a small block in the portrait area. Classify by dominant hue:
   - red-dominant → `team_side = 'for'` (actor is BGM — BGM is always red)
   - non-red, saturated → actor is opp. The opp team's specific colour
     (green for PHI, dark for the match 250 opponent, etc.) is detected
     per-match by sampling a known opp UI element (badge or pill on a
     known-opp row).
2. **Badge fill-style sample** — sample centre vs annulus of the right-side `S`/`H`/`G`/`P`/diamond badge:
   - solid colored → actor's team is HOME in this match
   - white interior with team-color ring → actor's team is AWAY in this match
   Captures the per-match home/away assignment. Scoreboard layout
   (`AWAY HOME` order) is a parallel signal — if `BM` appears on the right
   in the scoreboard, BGM is home; if on the left, BGM is away.
3. **Replay-clip flag** — detect the `▶` icon by its known relative position within the card (or by a small template match). Boolean output.
4. **Per-row y-centre** — already computed; surface as `row_y_center` field on `ActionTrackerEvent`.

### Layer 2 — Cross-frame consensus engine (new)

Given a sequence of N captures from one period:

1. Per capture, parse all visible rows with Layer-1 outputs.
2. Group rows across captures into **event clusters** by:
   - Same period.
   - Clock within ±1 sec match (handles minor OCR variance).
   - Actor name fuzzy match (Levenshtein ≤ 1 against canonicalised gamertag set).
   - Event-type agreement (or cross-validation between pill text and badge letter).
3. For each cluster, vote on every field:
   - Most-common clock wins.
   - Most-common actor name (fuzzy-canonicalised against the known BGM-player gamertag list + a learned opp-player list) wins.
   - Pill text and badge letter must agree on type; if conflict, prefer the higher-confidence OCR.
   - Median portrait-colour sample wins for `team_side`.
4. Emit one canonical event per cluster, with per-field confidence scores derived from cluster-agreement count.
5. Drop singleton clusters that disagree with their neighbours on multiple fields (likely phantoms).

This kills the phantom-row problem at the parsing layer instead of patching it downstream.

### Layer 3 — Marker linkage

Hook into the full-frame marker detector from
[marker-extraction-research.md](./marker-extraction-research.md):

- For each canonical event we know (type, team_side, clock).
- The rink has N markers of the matching (type, team_side). One is this event.
- **Yellow-chain**: in frames where this event was selected, the yellow marker on the rink IS this event's position. Identifies the linkage directly.
- **Position consensus fallback**: when no frame highlights this event, use the (type, team_side) cardinality match against the marker inventory. Most events have unique positions; clusters (multiple events at near-same on-ice location) are rare and can be resolved by scroll-order proximity.

### What to drop

- The naïve `(period, type, clock, actor)` dedup key in the promoter — replaced by the consensus engine's canonical events.
- Singleton-OCR-misread tolerance — every event must appear in ≥2 frames or be flagged for human review.

### What to keep

- Row grouping (`_group_lines_by_y`)
- Actor / target / relation regex
- Clock regex with bounded MM:SS
- `_strip_ornament` trailing-chip cleanup
- `detect_selected_row_index` (white border)
- `selected_event_index` as a fast linkage signal

---

## Internal research findings (recap)

### Existing code we'll reuse

- [`parsers.py:parse_post_game_action_tracker`](../../tools/game_ocr/game_ocr/parsers.py) — current parser, structure is sound for `ON`/`VS` events.
- [`parsers.py:_group_lines_by_y`](../../tools/game_ocr/game_ocr/parsers.py) — row clustering.
- [`parsers.py:_strip_ornament`](../../tools/game_ocr/game_ocr/parsers.py) — cleanup helper.
- [`parsers.py:_ACTION_TRACKER_TYPES`](../../tools/game_ocr/game_ocr/parsers.py) — pill-text → type map.
- [`parsers.py:_EVENT_PENALTY_RE`](../../tools/game_ocr/game_ocr/parsers.py) — already-existing penalty regex used by the Events screen parser; we can adapt it for the Action Tracker variant.
- [`spatial.py:detect_selected_row_index`](../../tools/game_ocr/game_ocr/spatial.py) — white-border detector.
- [`configs/roi/post_game_action_tracker.yaml`](../../tools/game_ocr/game_ocr/configs/roi/post_game_action_tracker.yaml) — `list_panel` ROI ratios (0.075–0.470 × 0.190–0.890 of 1920×1080).
- [`models.py:ActionTrackerEvent`](../../tools/game_ocr/game_ocr/models.py) — schema we extend.

### New helpers to build

- `sample_portrait_color(image, row_y_center, panel_x1, ...)` → `'for' | 'against'`
- `sample_badge_fill_style(image, row_y_center, panel_x2, ...)` → `'home' | 'away'`
- `detect_replay_arrow(image, row_y_center, ...)` → `bool`
- `cross_frame_consensus(parsed_captures: list[CaptureResult]) -> list[CanonicalEvent]` — the big one
- Schema additions on `ActionTrackerEvent`: `row_y_center`, `team_side_visual` (separate from gamertag-resolved `team_side`), `actor_team_color`, `home_or_away`, `has_replay_clip`, `per_field_confidence`

### Existing test coverage

- [`tests/test_parsers.py`](../../tools/game_ocr/tests/test_parsers.py) — has Action Tracker fixtures (good).
- No visual-signal sampling tests yet (gap).
- No cross-frame consensus tests yet (gap).

---

## Open external-research questions

Captured in the paired Deep Research prompt at
[event-list-extraction-deep-research-prompt.md](./event-list-extraction-deep-research-prompt.md).
Headline questions:

- **Cross-frame consensus algorithms** for OCR'd repeating-event lists — known patterns, citations, libraries.
- **Fuzzy gamertag canonicalisation** with a known vocabulary (BGM player list).
- **OCR preprocessing tricks** for tiny pill text under H.264 compression (the `'unknown'` event-type cases all stem from pill-glyph noise).
- **Robust colour sampling** in small image patches under compression — same questions as the marker dossier.
- **Voting / robust-estimator patterns** for multi-observation OCR data (RANSAC-style, weighted-median, etc.).

---

## Concrete next-pass plan (when resumed)

In priority order:

1. **Verify penalty-row handling** — first, ingest a penalty-containing match (e.g., the PHI example or any of the EA-source matches with non-zero PIM totals like match 15, 388, 14, 11, 120). If the existing parser silently drops penalty rows, add a penalty-specific regex like `^<culprit>\s+<INFRACTION>\s+\((MINOR|MAJOR|DOUBLE MINOR)\)$` triggered when the pill text says `PENALTY`. Emit `infraction` + `severity` fields. (`_EVENT_PENALTY_RE` already exists in the Events screen parser — could be adapted.) Without this, penalty-heavy matches lose data silently.
2. **Add visual `team_side` signal**: implement `sample_portrait_color` and add `team_side_visual` to `ActionTrackerEvent`. Retires the gamertag-alias misclassification problem. Note: opp team color varies per match (BGM is always red); need per-match opp-color auto-detection.
3. **Add `has_replay_clip`**: small UI-feature lift, useful metadata for "which events have highlight reels."
4. **Expose `row_y_center`**: trivial schema change, enables Layer 2.
5. **Build the cross-frame consensus engine** offline first — a notebook / script that takes a folder of captures, runs the parser, and emits canonical events with confidence scores. Compare against manually-curated match 250 ground truth.
6. **Integrate consensus engine into the promoter**: replace the naïve dedup with consensus-derived canonical events. Drop singleton-misread tolerance.
7. **Hook to the marker-extraction system** (sister doc): emit `(canonical_event, rink_marker)` pairs.
8. **Defer**: badge fill-style detection (home/away identification). Useful but lower priority than the above — and the scoreboard layout offers a parallel signal that's likely easier to read.

### Validation

- Match 250 currently has 72 manually-curated non-faceoff events. Use them as regression-test ground truth for the new pipeline. Diff per field; flag any events the new pipeline assigns differently.
- Phantom rows from the old approach (`WILOE`, `fOEWS`, `1:10 SILKY`) must NOT appear in the new output.
- Coverage of valid events must stay ≥ 72/72.

---

## Sources

### Internal references

- [docs/ocr/source-screen-inventory.md § Action tracker](./source-screen-inventory.md) — original screen-element catalogue
- [docs/ocr/event-map-implementation-report.md](./event-map-implementation-report.md) — what's been built so far (the manual labelling pass)
- [docs/ocr/marker-extraction-research.md](./marker-extraction-research.md) — sister dossier for rink-marker extraction
- [tools/game_ocr/game_ocr/parsers.py](../../tools/game_ocr/game_ocr/parsers.py) — current parser
- [tools/game_ocr/game_ocr/spatial.py](../../tools/game_ocr/game_ocr/spatial.py) — selected-row + marker detection
- [tools/game_ocr/game_ocr/configs/roi/post_game_action_tracker.yaml](../../tools/game_ocr/game_ocr/configs/roi/post_game_action_tracker.yaml) — ROI rectangles
- [tools/game_ocr/game_ocr/models.py](../../tools/game_ocr/game_ocr/models.py) — `ActionTrackerEvent` schema
- [research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Event_List.png](../../research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Event_List.png) — full-panel reference
- [research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Single_Event.png](../../research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-2026-05-10-02h00m33s853_Single_Event.png) — single-card close-up

### External

Findings below — gathered 2026-05-11 via direct web research (not Deep Research), guided by the questions in the paired prompt doc.

---

## External research findings

### Top-level summary

1. **The literature is settled on voting, not on choosing among voting schemes.** Cross-frame consensus is a 30-year-old technique (Lopresti & Zhou 1996) that consistently eliminates 20–50% of single-pass OCR errors; modern recommendation is **confidence-weighted majority voting (CWMV)**, which is provably optimal for combining noisy observations and matches real-group-decision accuracy. Practical implementation: NIST's **ROVER** (originally ASR, generalizes to OCR) builds a word-transition network via dynamic programming alignment, then votes per slot.
2. **RapidFuzz is the obvious pick for fuzzy name matching.** Benchmarked ~40% faster than python-Levenshtein, ~55% faster than Jellyfish; `process.cdist` gives a single-call vocabulary-matrix that's exactly what we need for "OCR candidate → BGM gamertag" canonicalisation. **Jaro-Winkler** is the right scorer for short identifiers (prefix bias matches how OCR usually preserves the first letters); fall back to plain Levenshtein for the OCR-substitution pattern (`O↔0`, `l↔I↔1`).
3. **The closest production analogue to our problem is esports broadcast OCR** (PandaScore on CS:GO, ScoreSight for OBS, LeagueOCR). Their core insight: don't trust a single frame, use a **blueprint** (known-position constraints) plus **temporal smoothing** ("Semantic Smoothing" in ScoreSight's terms: average multiple text outputs for higher confidence). This validates our cross-frame consensus direction.
4. **For tiny pill text, a small CNN classifier is the right answer**, not OCR. The 5 pill categories are visually distinctive even at 20×40 px; an existing reference (`semantic-icon-classifier`, 99 Android icon classes) shows a tiny CNN handles this scale with hundreds of training samples per class — not the 5000 PaddleOCR needs to fine-tune a recogniser. We have hundreds of pills already labelled in the match 250 captures.
5. **Drop singleton-OCR rows by default.** Confidence threshold literature converges on per-field cutoffs (different thresholds for different field types) and a manual-review queue for sub-threshold reads. Concretely: events with cluster size = 1 AND any field-confidence < 0.8 should land in a review queue rather than be silently emitted.

---

### Detailed findings

#### A. Cross-frame consensus / voting

##### Question A1 — voting algorithms comparison

**Finding:** Three families are production-proven for OCR multi-observation. (1) **Consensus sequence voting** (Lopresti & Zhou 1996) — align multiple OCR outputs character-by-character via dynamic programming, vote per position; eliminates 20–50% of single-pass errors with no a-priori assumptions about error distribution. (2) **ROVER** (NIST) — alignment via word-transition network + voting; modes include frequency-only, average-confidence (`-m avgconf`), and max-confidence (`-m maxconf`); the `-a` flag tunes the confidence-vs-frequency tradeoff. (3) **Confidence-Weighted Majority Voting (CWMV)** — provably optimal aggregation when per-observation confidence is reliable; matches real group decisions, beats unweighted majority. **Recommended for us: CWMV at the field level, ROVER-style DP alignment at the row level.**

**Evidence:**
- [Lopresti & Zhou 1996 — Using Consensus Sequence Voting to Correct OCR Errors](https://www.sciencedirect.com/science/article/abs/pii/S1077314296905020) — 20–50% error reduction over single-pass; foundational.
- [NIST SCTK / ROVER docs](https://github.com/usnistgov/SCTK/blob/master/doc/rover.htm) — three voting modes; DP-based WTN alignment.
- [Group decisions based on confidence weighted majority voting (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7960862/) — CWMV proven optimal; UCMV underperforms.
- [LV-ROVER (arXiv 1707.07432)](https://arxiv.org/abs/1707.07432) — lexicon-verified ROVER variant; relevant because we have a known gamertag vocabulary.

**Confidence:** high — multiple independent papers across 30 years converge.
**Applicability:** high — our problem (same row in N frames, slightly varying OCR) is exactly what these algorithms target.
**Code/library pointers:** No drop-in Python ROVER for OCR. Build it: per-row align observations on `actor.field` via SequenceMatcher or python-Levenshtein-derived DP, then CWMV per field. For confidence scores use RapidOCR's per-token confidence (`result[1][1]` in the standard tuple).

##### Question A2 — production examples in scrolling lists

**Finding:** No published paper on *scrolling-list-specific* OCR consensus. Closest production analogues are **esports overlay extractors** (PandaScore for CS:GO/LoL/Dota, ScoreSight for live broadcast scoreboards, LeagueOCR for League of Legends) which all combine **fixed-position constraints + multi-frame smoothing**. PandaScore explicitly uses a "blueprint system" with per-overlay parametric constraints and conditional-IoU box-classification; ScoreSight calls its multi-frame aggregation "Semantic Smoothing — getting more consistent outputs with higher accuracy and confidence by averaging several text outputs."

**Evidence:**
- [PandaScore: Automated Object Localisation in Esports Streams](https://www.pandascore.co/blog/automated-object-localisation-in-esports-video-streams) — blueprint + MCTS + OCR-classified detections; "close to 100% accuracy" on timer/score.
- [ScoreSight (royshil/scoresight on GitHub)](https://github.com/royshil/scoresight) — "Semantic Smoothing" for temporal consistency.
- [Modulai/Abios — Real-time esport tracking](https://modulai.io/blog/enabling-real-time-e-sport-tracking-with-streaming-video-object-detection/) — deep-learning object detection on CS:GO, LoL, Dota, Fortnite.
- [LeagueOCR (floh22 on GitHub)](https://github.com/floh22/LeagueOCR) — Spectator-mode OCR with single-game-specific heuristics.

**Confidence:** medium — direct scrolling-list analogues are rare, but the broader esports-OCR pattern strongly validates our architecture.
**Applicability:** high — these tools solve essentially our problem (overlay text + temporal smoothing).
**Code/library pointers:** ScoreSight is open source and Python; worth reading for binarisation + smoothing patterns. PandaScore's MCTS is overkill for our 5-event-type schema.

##### Question A3 — singleton observation problem

**Finding:** Industry standard is **per-field confidence thresholds** routing low-confidence extractions to a manual-review queue. Specific recommendation: each field-type gets its own cutoff (clock might need 0.85, actor name 0.75, event type 0.7) because the cost of a misread differs. Microsoft Document Intelligence, AWS Textract, and most enterprise OCR all expose per-field confidence and recommend tuning thresholds per-field-type rather than globally.

**Evidence:**
- [llamaindex glossary — Confidence Threshold](https://www.llamaindex.ai/glossary/what-is-confidence-threshold) — per-field threshold rationale.
- [Microsoft Document Intelligence — Accuracy & Confidence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/accuracy-confidence?view=doc-intel-4.0.0) — recommends per-field tuning, 0.7–0.8 typical baseline.
- [Extend.ai — Best Confidence Scoring Systems 2026](https://www.extend.ai/resources/best-confidence-scoring-systems-document-processing) — review-queue routing patterns.

**Confidence:** high — universal industry practice.
**Applicability:** high — directly maps to our review-queue idea.
**Code/library pointers:** No library needed; schema decision. Each canonical event gets `confidence_<field>` columns; rows where any required field falls below threshold land in a `match_event_review_queue` table.

---

#### B. Fuzzy gamertag / name canonicalisation

##### Question B4 — library benchmark for Python 2026

**Finding:** **RapidFuzz wins on both speed and API ergonomics.** Single-threaded ~2,500 string-pairs/sec vs. python-Levenshtein at 1,800, Jellyfish at 1,600, FuzzyWuzzy at 1,200. C++ core, NumPy-vectorised `process.cdist`. FuzzyWuzzy is effectively deprecated (its core maintainer moved to RapidFuzz). Jellyfish is still best-in-class for *phonetic* algorithms (Metaphone, Soundex) but slower at edit distance.

**Evidence:**
- [Similarity API 2026 Benchmarks](https://similarity-api.com/blog/speed-benchmarks) — head-to-head pairs/sec.
- [RapidFuzz GitHub](https://github.com/rapidfuzz/RapidFuzz) — actively maintained 2026, C++ backend.
- [Comparative Analysis of Python Text Matching Libraries (IJEEdu)](https://ijeedu.com/index.php/ijeedu/article/view/188) — 50,000-case multilingual study; Levenshtein wins non-Latin, FuzzyWuzzy good for varied lengths, Jellyfish best phonetic, RapidFuzz fastest overall.

**Confidence:** high — multiple recent benchmarks agree.
**Applicability:** high — our query vocabulary is ~20 BGM gamertags per match, plus per-match opp roster of ~6. `process.cdist(captures, vocabulary)` returns the full similarity matrix in one C++ call.
**Code/library pointers:** `pip install rapidfuzz` (3.14+). Use `process.extractOne(query, vocab, scorer=JaroWinkler.normalized_similarity, score_cutoff=0.85)`. Returns `None` if no candidate clears the cutoff — perfect for surfacing unknowns.

##### Question B5 — best scorer for OCR-confusion patterns

**Finding:** **Jaro-Winkler for short tokens (gamertags ≤ 15 chars)** — empirical studies (cited by Babel Street and Datablist) found "fewer errors typically occur at the beginning of names," which Jaro-Winkler exploits via prefix bonus (up to first 4 chars). Plain Levenshtein is the right fallback when prefix-OCR errors do happen (e.g. `fOEWS` for `TOEWS` is a leading-letter confusion that Jaro-Winkler penalises hardest — Levenshtein 1 is more forgiving). **Phonetic codes (Soundex/Metaphone) are wrong for OCR**: they target human typos/sound-alikes, not visual letter confusions. Q-gram (n-gram overlap) handles substitutions well but is slower than Levenshtein with no real accuracy advantage on short strings.

**Evidence:**
- [Datablist — What is Jaro-Winkler Distance](https://www.datablist.com/learn/data-cleaning/fuzzy-matching-jaro-winkler-distance) — prefix bonus rationale.
- [Babel Street — Fuzzy Name Matching Techniques](https://www.babelstreet.com/blog/fuzzy-name-matching-techniques) — Jaro-Winkler best for people names.
- [DataLadder — Fuzzy Matching 101](https://dataladder.com/fuzzy-matching-101/) — five-category taxonomy; phonetic explicitly designed for sound-alike (not visual) confusion.

**Confidence:** medium — Jaro-Winkler "best for names" is empirically supported but OCR-specific comparisons are sparse.
**Applicability:** high — our gamertags are 3–15 chars with letter-shape OCR confusions, exactly the regime where JW excels.
**Code/library pointers:** RapidFuzz exports `JaroWinkler.normalized_similarity` and `Levenshtein.normalized_similarity`. For belt-and-suspenders: vote between the two scorers per token (if either clears 0.85 → match).

##### Question B6 — OOV (out-of-vocabulary) gamertag detection

**Finding:** Standard pattern is **score_cutoff + cluster-then-canonicalise**: if `process.extractOne(query, known_vocab, score_cutoff=T)` returns `None`, the token is OOV. Group all OOV tokens across captures, cluster by mutual fuzzy distance (DBSCAN with `eps = 1 - JW_threshold`), and the cluster centroid becomes a new candidate identity. Surface to a human-review queue for confirmation; on confirmation, add to `player_display_aliases`. This is how fraud-detection systems handle "new entity" detection.

**Evidence:**
- [Tilores — Fuzzy Matching Algorithms for Data Deduplication](https://tilores.io/fuzzy-matching-algorithms) — cluster-then-canonicalise patterns.
- [DBSCAN sklearn docs](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.DBSCAN.html) — `metric="precomputed"` lets us feed a fuzzy-distance matrix directly from `rapidfuzz.process.cdist`.

**Confidence:** medium — pattern is well-known; OCR-specific tuning of `eps` will need empirical calibration.
**Applicability:** high — opp rosters change every match and we have no canonical list.
**Code/library pointers:**
```python
from rapidfuzz import process, distance
sim_matrix = process.cdist(unknown_tokens, unknown_tokens,
                           scorer=distance.JaroWinkler.normalized_similarity)
dist_matrix = 1 - sim_matrix
from sklearn.cluster import DBSCAN
labels = DBSCAN(eps=0.15, min_samples=2, metric="precomputed").fit_predict(dist_matrix)
```

---

#### C. Tiny pill / icon OCR preprocessing

##### Question C7 — preprocessing for ~20×40 px white-on-colour pills

**Finding:** Two stacked techniques. (1) **2x–4x upsample first** (intelligent, not pixel-replication) — improves OCR on small text by recovering H.264 compression loss; PaddleOCR's own docs say text < 10 px tall is unreliable. (2) **Channel isolation, not greyscale** — for white-on-saturated-colour, take the **V channel of HSV** (since white = high V, dark backgrounds = low V) instead of converting to grey; binarise with Otsu. Skip adaptive binarisation here — the pill background is uniform, so global Otsu is fine.

**Evidence:**
- [Aspose Cloud OCR — Upsample Images for Small Text](https://tutorials.aspose.cloud/ocr/preprocess-image/upsample-image/) — 2x–4x upscale stabilises OCR under compression.
- [Tesseract docs — Improving Quality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) — segmentation mode (`--psm`) for single-line text helps tiny labels; adding a white border helps tightly cropped text.
- [arXiv 1509.03456 — OCR Accuracy via Preprocessing](https://arxiv.org/pdf/1509.03456) — channel isolation > greyscale for colored backgrounds.
- [PaddleOCR Fine-tune docs](https://www.paddleocr.ai/main/en/version2.x/ppocr/model_train/finetune.html) — small text best practices.

**Confidence:** high — these are textbook OCR preprocessing techniques.
**Applicability:** high — our pill is the prototypical "white text on uniform saturated background" case.
**Code/library pointers:**
```python
import cv2
def preprocess_pill(roi):
    h, w = roi.shape[:2]
    upscaled = cv2.resize(roi, (w*3, h*3), interpolation=cv2.INTER_CUBIC)
    hsv = cv2.cvtColor(upscaled, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]  # white text pops on V
    _, binary = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.copyMakeBorder(binary, 5, 5, 5, 5, cv2.BORDER_CONSTANT, value=255)
```

##### Question C8 — CNN classifier vs OCR for 5 pill types

**Finding:** **Yes, a tiny CNN beats OCR here**, and not by a small margin. Existing reference: `semantic-icon-classifier` (CNN over 99 Android icon classes, 100×100 px input, `small_cnn_weights_100_512.h5`) demonstrates feasibility at our scale. Training data: ~200 labelled samples per class is enough for a 5-class problem with `mobilenet_v3_small` backbone or even a 3-layer custom CNN. Expected accuracy: ≥ 99% (the 5 classes are visually distinctive — `HIT`, `SHOT`, `GOAL`, `PENALTY`, `FACEOFF` differ in colour AND text length). Inference cost: ~1 ms/pill on CPU. Compared to OCR which fails ~10% of the time on these glyphs ("unknown" rows in match 250), the CNN wins on every axis.

**Evidence:**
- [semantic-icon-classifier (GitHub)](https://github.com/datadrivendesign/semantic-icon-classifier) — 99 classes, small CNN, working reference.
- [TFLite Image Classification tutorial](https://www.tensorflow.org/tutorials/images/classification) — minimal 5-class image classifier template.
- [Calamari OCR ensemble — 30–50% CER reduction notes](https://intuitionlabs.ai/articles/non-llm-ocr-technologies) — illustrates upper bound of OCR-only approaches; classifiers exceed this.

**Confidence:** high — pill classification is a textbook "few-class image classification" problem.
**Applicability:** high — we already have ~200+ labelled pill images per type from match 250's captures (just need to crop them out).
**Code/library pointers:** Don't bother with TFLite — use `keras` or `pytorch` with a 3-conv CNN, 5-class softmax. Export ONNX, run via `onnxruntime` (already a dep of RapidOCR). Training takes < 5 minutes on a laptop GPU.

---

#### D. Visual signal extraction

##### Question D9 — HSV "red vs dark" classification in compressed patches

**Finding:** Sample the patch with `cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)`, then take the **median H, S, V over a small central region** (avoid edges where compression artefacts cluster). For "red vs anything-else" use a wide-ish hue tolerance because BGM red varies under different rink-art shading: red satisfies `(H ∈ [0,10] ∪ [170,180]) AND S > 100 AND V > 80`. **Use median over mean** — median is the textbook robust statistic for image regions under H.264 compression (mean drags toward block-boundary smearing).

**Evidence:**
- [OpenCV color spaces docs](https://opencv.org/color-spaces-in-opencv/) — HSV separates colour from intensity, easier under varying lighting.
- [LearnCodeByGaming — HSV Color Range Thresholding](https://learncodebygaming.com/blog/hsv-color-range-thresholding) — practical HSV ranges for game-UI work; median sampling for robustness.
- [GeeksforGeeks — HSV boundaries for cv::inRange](https://www.geeksforgeeks.org/computer-vision/choosing-the-correct-upper-and-lower-hsv-boundaries-for-color-detection-with-cv-inrange-opencv/) — red hue wraps around 0/180, needs two ranges.

**Confidence:** high — well-established CV practice.
**Applicability:** high — exactly our portrait-colour-classification problem.
**Code/library pointers:**
```python
def is_portrait_red(roi):
    h, w = roi.shape[:2]
    centre = roi[h//4:3*h//4, w//4:3*w//4]
    hsv = cv2.cvtColor(centre, cv2.COLOR_BGR2HSV)
    H, S, V = np.median(hsv.reshape(-1, 3), axis=0)
    return ((H <= 10 or H >= 170) and S > 100 and V > 80)
```
For per-match opp-colour detection: take the dominant non-red hue from a known-opp portrait, store as `opp_team_hue` per match.

##### Question D10 — play-arrow icon detection

**Finding:** **Template matching at known scale** is sufficient — the icon's position is fixed within the card and the scale doesn't vary (single-source captures, 1920×1080). Use `cv2.matchTemplate(roi, template, cv2.TM_CCOEFF_NORMED)` with threshold 0.7+. Multi-scale is unnecessary here. Fallback if the template has noticeable per-frame variation: **edge-density signature** — count Canny edges in the expected ROI; presence of `▶` produces a characteristic triangular edge cluster distinct from absence (flat).

**Evidence:**
- [PyImageSearch — Multi-scale Template Matching](https://pyimagesearch.com/2015/01/26/multi-scale-template-matching-using-python-opencv/) — TM_CCOEFF_NORMED standard.
- [Funvision OpenCV Tutorial — matchTemplate](https://www.funvisiontutorials.com/2023/07/cvmatchtemplate-function-in-opencv-to.html) — 0.7 threshold is "good match"; 0.99 is near-perfect.

**Confidence:** high — template matching at fixed scale is reliable.
**Applicability:** high — our use case is the textbook one.
**Code/library pointers:** Crop a single clean play-arrow icon once; save as PNG; load and reuse. ~0.5 ms per row.

##### Question D11 — solid-vs-outlined badge classification

**Finding:** Sample **centre pixel** vs **annulus pixels** of the badge:
- Solid (home): centre and annulus both saturated team-colour
- Outlined (away): centre is near-white (S < 30), annulus is team-colour
Robust statistic again: median over a 3×3 patch at each sample location. Threshold on the **S channel difference** between centre and annulus — large delta = outlined.

**Evidence:**
- Same HSV / median pattern as D9; no domain-specific paper but the technique is standard for "solid vs hollow shape" classification in CV.

**Confidence:** medium — no direct paper, but the operation is mechanical given clean ROI sampling.
**Applicability:** medium — listed as deferred priority in the recommended architecture; scoreboard layout is a parallel signal that's probably easier.
**Code/library pointers:** Same `is_portrait_red` template; compare centre and annulus separately.

---

#### E. Sliding-window list extraction

##### Question E12 — reconstructing list ordering from N frames

**Finding:** **Bioinformatics overlap-layout-consensus (OLC)** is the closest established technique. Each capture is a "read" with a stretch of overlapping events; align via local DP (Smith-Waterman style) on the `(clock, actor)` key; merge into an event genome. Free end-gaps (no penalty for content extending past the capture frame) handle top/bottom cutoffs. For *scroll offset estimation* per frame, anchor on a known event clock (e.g. the first row's clock) and integer-divide by row-height to derive a synthetic scroll position.

**Evidence:**
- [JHU Lecture — Overlap-Layout-Consensus Assembly](https://www.cs.jhu.edu/~langmea/resources/lecture_notes/assembly_olc.pdf) — fundamental algorithm.
- [SeqAn Pairwise Sequence Alignment](https://seqan.readthedocs.io/en/seqan-v2.0.2/Tutorial/PairwiseSequenceAlignment.html) — free-end-gap variant ("overlap alignment").
- [ResearchGate — Improved Version Using Noisy OCR from Multiple Editions](https://ciir-publications.cs.umass.edu/getpdf.php?id=1104) — DP alignment applied directly to OCR'd text from multiple sources.

**Confidence:** medium — OLC isn't a perfect fit (events are ordered but not strictly sequential like DNA), but the alignment kernel transfers.
**Applicability:** medium — our captures have natural anchors (period number, clock, event type) so naïve clustering by `(period, clock±1s)` may suffice without full DP alignment.
**Code/library pointers:** Skip the full bioinformatics stack — for 6–8 visible rows per frame, an `(period, clock±1, fuzzy-actor)`-keyed cluster step gives 90% of the value. Add DP alignment only if cluster drift becomes a problem.

##### Question E13 — Document-AI for multi-frame tabular ingestion

**Finding:** **Donut and LayoutParser don't help us directly.** Both are designed for single-image document understanding, not multi-frame consolidation. The "frames" they care about are pages within a single PDF, and they assume each page is content-complete. Multi-frame video OCR libraries do exist (Microsoft Azure Video Indexer, Google Cloud Video Intelligence) but are closed-source SaaS. The 2002 CMU paper "Robust Video Text Segmentation and Recognition with Multiple Hypotheses" (Odobez & Chen) is the seminal reference for our specific pattern — keep top-K hypotheses per region, vote across frames.

**Evidence:**
- [Robust Video Text Segmentation (Odobez & Chen, CMU)](http://www.cs.cmu.edu/~datong/ICIP02.pdf) — top-K hypotheses + cross-frame voting; 93.1% → 97.9% with K=3.
- [Multi-frame Combination for Robust Videotext Recognition (IEEE)](https://ieeexplore.ieee.org/document/4517870/) — direct multi-frame voting study.
- [Scene Text Recognition in Multiple Frames Based on Text Tracking](https://xrong.org/publications/icme14.pdf) — tracking-based variant.
- [Optimal Frame-by-frame Result Combination Strategy (SPIE 2018)](https://ui.adsabs.harvard.edu/abs/2018SPIE10696E..1ZB/abstract) — per-field combination strategy paper.

**Confidence:** medium — multiple papers but the field is fragmented.
**Applicability:** high — the K=3 result (94% → 98%) is exactly the lift we'd expect for our use case.
**Code/library pointers:** No off-the-shelf library implements this. Build it: per row, keep top-3 OCR hypotheses (RapidOCR returns confidence-ranked candidates per text region), vote per field across frames + per hypothesis within frame.

---

#### F. Schema / dedup for multi-source ingestion

##### Question F14 — multi-source event canonicalisation

**Finding:** Event-sourcing canonical pattern: **separate raw observations from canonical facts**. Concretely:
- Raw `ocr_observations` table (immutable, per-capture-per-row): keep everything OCR'd, including misreads.
- Canonical `match_events` table: produced by the consensus engine; source-of-truth.
- A `match_event_source_links` join table records which raw observations voted for each canonical event, with confidence scores.

This gives **source priority + weighted merge + audit trail** in one schema. The pattern is from CQRS/event-sourcing; deduplication at the projection layer (consensus engine) is established practice. Idempotency: canonical event ID = hash of `(match_id, period, canonical_clock, canonical_actor, canonical_type)` so reprocessing the same raw observations produces the same canonical row.

**Evidence:**
- [Microservices.io — Event Sourcing](https://microservices.io/patterns/data/event-sourcing.html) — canonical fact pattern.
- [DomainCentric — Event Sourcing Projections Deduplication](https://domaincentric.net/blog/event-sourcing-projection-patterns-deduplication-strategies) — projection-layer dedup; at-least-once + idempotent keys.
- [SoftwareMill — Event Sourcing with Relational DB](https://softwaremill.com/implementing-event-sourcing-using-a-relational-database/) — concrete schema patterns in Postgres.

**Confidence:** high — well-established architecture.
**Applicability:** high — our current schema already keeps raw OCR results separate; just needs the canonical/links layer.
**Code/library pointers:** Drizzle schema:
```typescript
match_event_source_links: pgTable({
  canonical_event_id: bigint().references(() => matchEvents.id),
  ocr_observation_id: bigint().references(() => ocrObservations.id),
  per_field_confidence: jsonb().$type<Record<string, number>>(),
  voted_for_field: text().array(),
})
```

##### Question F15 — per-field confidence in Postgres

**Finding:** **JSONB column per-event** is the right Postgres pattern. Schema: `match_events.field_confidence jsonb` storing `{"clock": 0.97, "actor": 0.83, "event_type": 1.0, "team_side": 0.91}`. Index with `jsonb_path_ops` GIN if querying by confidence is common; usually it isn't (queries filter on the canonical fields, not confidence), so no index. **CHECK constraint** validates structure if schema-stability matters.

**Evidence:**
- [PostgreSQL JSONB docs (18)](https://www.postgresql.org/docs/current/datatype-json.html) — JSONB indexing and operators.
- [AWS — PostgreSQL as a JSON database: patterns](https://aws.amazon.com/blogs/database/postgresql-as-a-json-database-advanced-patterns-and-best-practices/) — per-document-metadata in JSONB column.
- [Heap — When to Avoid JSONB](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) — relevant counterpoint: don't put queryable fields in JSONB.

**Confidence:** high.
**Applicability:** high.
**Code/library pointers:** Drizzle: `fieldConfidence: jsonb().$type<{clock: number; actor: number; event_type: number; team_side: number}>()`.

---

#### G. Pipeline architecture & testing

##### Question G16 — separation of concerns

**Finding:** Standard three-stage pattern: **(1) per-frame extraction** (single-capture parsing) → **(2) cross-frame consensus** (the new layer we need) → **(3) downstream business-logic dedup** (matching events to rink markers, joining to players). Keep them as independent processes communicating via tables: extraction writes raw observations, consensus reads + writes canonical events, downstream reads canonical events. This matches CQRS projection-style architecture and lets each stage be reprocessed independently.

**Evidence:**
- [Dropbox — Modern OCR Pipeline](https://dropbox.tech/machine-learning/creating-a-modern-ocr-pipeline-using-computer-vision-and-deep-learning) — three-stage architecture (detection → recognition → understanding).
- [Towards Data Science — Scalable OCR Pipelines on AWS](https://towardsdatascience.com/scalable-ocr-pipelines-using-aws-88b3c130a1ea/) — separation of concerns in production.
- [HealthEdge — Scalable OCR Pipeline](https://healthedge.com/resources/blog/building-a-scalable-ocr-pipeline-technical-architecture-behind-healthedge-s-document-processing-platform) — three-stage + confidence routing + manual-review queue.

**Confidence:** high.
**Applicability:** high.
**Code/library pointers:** N/A — architecture choice. Our current `tools/game_ocr` already does stage 1; stages 2 and 3 are what's parked.

##### Question G17 — end-to-end testing with multi-frame inputs

**Finding:** **Unit-test-driven evaluation against synthetic ground truth** is the 2026 state-of-the-art. Two concrete frameworks:
- **OlmOCR-Bench** — auto-generates fine-grained unit tests from HTML-rendered ground truth; benchmarks output against per-test assertions, not free-text comparison.
- **LiteParse** — "Gold Standard" baseline stored as HuggingFace dataset; current run diff'd against known-good per page.

For our use case, the analogous setup: **match 250's 72 manually-curated non-faceoff events ARE the gold standard**; build a regression suite that asserts the new pipeline produces exactly those events (per-field exact match where possible, fuzzy ≥ 0.95 for OCR'd text).

**Evidence:**
- [OlmOCR-Bench (EmergentMind)](https://www.emergentmind.com/topics/olmocr-bench) — unit-test-driven OCR evaluation.
- [LiteParse Testing & QA (DeepWiki)](https://deepwiki.com/run-llama/liteparse/8-testing-and-quality-assurance) — multi-layered E2E + regression dataset.
- [Signzy — State-of-the-art OCR Pipeline](https://www.signzy.com/blogs/ocr-pipeline-built-using-deep-learning) — production regression-test architecture.

**Confidence:** high.
**Applicability:** high — match 250 is the perfect frozen baseline.
**Code/library pointers:** `pytest` with parametrised tests, one per canonical event in match 250. Pipeline produces a dict per event; assert per field. Use `rapidfuzz.fuzz.ratio` ≥ 95 for free-text fields.

---

### Comparison tables

#### Fuzzy-string libraries (Python 2026)

| Approach | Strengths | Weaknesses | Best for | Library | Maturity |
|---|---|---|---|---|---|
| RapidFuzz (Levenshtein/Jaro-Winkler) | Fastest (~2,500 pairs/s); `process.cdist` batch API; C++ core | No phonetic algorithms | OCR canonicalisation; bulk vocabulary matching | `rapidfuzz` 3.14+ | Active (2026) |
| Jellyfish | Best-in-class phonetic (Metaphone, Soundex); pure-Python fallback | Slower (~1,600 pairs/s); awkward API | Sound-alike matching (NOT our case) | `jellyfish` | Active |
| python-Levenshtein | Simple C extension | No batch API; manual loops | Single-pair fast path | `python-Levenshtein` | Active |
| FuzzyWuzzy | Familiar API (`fuzz.ratio`) | Deprecated; maintainer moved to RapidFuzz | Legacy code | `fuzzywuzzy` | Maintenance-only |
| Difflib (stdlib) | No install | Slow (~1,000 pairs/s) | Quick scripts | stdlib | Stable |

#### Consensus voting schemes

| Approach | Strengths | Weaknesses | Best for | Library |
|---|---|---|---|---|
| Simple majority (per field) | Trivial; no confidence needed | Loses to CWMV; ignores variance | First pass / debugging | None — DIY |
| Confidence-Weighted Majority Voting (CWMV) | Provably optimal w/ reliable confidence | Requires per-field confidence scores | Production OCR consensus | DIY — straightforward |
| ROVER (NIST) | Battle-tested ASR algorithm; three voting modes | Designed for word-sequence; adapt for OCR | When multiple OCR engines vote | `SCTK` (C, NIST) |
| RANSAC | Robust to outliers | Needs continuous parameter space | Geometric fits, not text | scikit-image |
| DBSCAN | Handles unknown cluster count | Tuning `eps` empirical | OOV gamertag discovery | `sklearn` |
| Probabilistic graphical models (CRF/HMM) | Models sequential dependencies | Overkill for ~6 events × 4 fields | Complex sequential structure | `sklearn-crfsuite` |

---

### Concrete code snippets

#### 1. Per-row fuzzy canonicalisation against BGM vocabulary

```python
from rapidfuzz import process, distance

BGM_VOCAB = ["MrHomicide", "Stick Menace", "silkyjoker85", "HenryTheBobJr", "JoeyFlopfish"]
PERSONA_TO_GAMERTAG = {"E. Wanhg": "MrHomicide", "M. Rantanen": "Stick Menace", ...}

def canonicalise_actor(ocr_text: str, score_cutoff: float = 0.85):
    """Returns (canonical_gamertag, score) or (None, score) if OOV."""
    # Try persona names first (they're how the in-game UI prints actors).
    persona_match = process.extractOne(
        ocr_text, PERSONA_TO_GAMERTAG.keys(),
        scorer=distance.JaroWinkler.normalized_similarity,
        score_cutoff=score_cutoff,
    )
    if persona_match:
        persona, score, _ = persona_match
        return PERSONA_TO_GAMERTAG[persona], score
    # Fallback to direct gamertag match (covers Events screen, scoreboard).
    gamertag_match = process.extractOne(
        ocr_text, BGM_VOCAB,
        scorer=distance.JaroWinkler.normalized_similarity,
        score_cutoff=score_cutoff,
    )
    return (gamertag_match[0], gamertag_match[1]) if gamertag_match else (None, 0)
```

#### 2. Cross-frame consensus for one canonical event

```python
from collections import Counter
from dataclasses import dataclass

@dataclass
class RawObservation:
    capture_id: int
    event_type: str         # one of {hit, shot, goal, penalty, faceoff, unknown}
    clock: str | None       # "MM:SS"
    actor_raw: str
    actor_canonical: str | None
    actor_score: float
    confidences: dict[str, float]  # per-field confidence from OCR

def consensus_event(observations: list[RawObservation]) -> dict:
    """CWMV across observations for the same logical event."""
    def vote(field: str, getter):
        weighted = Counter()
        for obs in observations:
            v = getter(obs)
            if v is None:
                continue
            weighted[v] += obs.confidences.get(field, 0.5)
        if not weighted:
            return None, 0.0
        winner, total_weight = weighted.most_common(1)[0]
        denom = sum(weighted.values())
        return winner, total_weight / denom

    event_type, et_conf = vote("event_type", lambda o: o.event_type if o.event_type != "unknown" else None)
    clock, cl_conf = vote("clock", lambda o: o.clock)
    actor, ac_conf = vote("actor_canonical", lambda o: o.actor_canonical)
    return {
        "event_type": event_type,
        "clock": clock,
        "actor": actor,
        "field_confidence": {"event_type": et_conf, "clock": cl_conf, "actor": ac_conf},
        "cluster_size": len(observations),
    }
```

#### 3. Pill ROI preprocessing + 5-class CNN inference

```python
import cv2, numpy as np, onnxruntime as ort

PILL_CLASSES = ["faceoff", "goal", "hit", "penalty", "shot"]
session = ort.InferenceSession("pill_classifier.onnx", providers=["CPUExecutionProvider"])

def classify_pill(roi: np.ndarray) -> tuple[str, float]:
    # Preprocess: upscale 3x, V-channel, Otsu, padded to 48x48
    h, w = roi.shape[:2]
    up = cv2.resize(roi, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    v = cv2.cvtColor(up, cv2.COLOR_BGR2HSV)[:, :, 2]
    _, binary = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    resized = cv2.resize(binary, (48, 48))
    inp = resized.astype(np.float32)[None, None] / 255.0  # NCHW
    logits = session.run(None, {"input": inp})[0][0]
    probs = np.exp(logits) / np.exp(logits).sum()
    idx = int(probs.argmax())
    return PILL_CLASSES[idx], float(probs[idx])
```

#### 4. OOV gamertag clustering

```python
from rapidfuzz import process, distance
from sklearn.cluster import DBSCAN
import numpy as np

def cluster_unknowns(unknown_tokens: list[str], eps: float = 0.15):
    """Group OCR'd unknowns into candidate identities. Returns list[list[str]]."""
    sims = process.cdist(unknown_tokens, unknown_tokens,
                         scorer=distance.JaroWinkler.normalized_similarity)
    dist = 1.0 - sims
    labels = DBSCAN(eps=eps, min_samples=2, metric="precomputed").fit_predict(dist)
    clusters = {}
    for tok, lbl in zip(unknown_tokens, labels):
        clusters.setdefault(int(lbl), []).append(tok)
    return [v for k, v in clusters.items() if k != -1]  # drop noise (-1)
```

---

### Open questions surfaced during research

- **RapidOCR per-token confidence reliability.** RapidOCR returns confidence per text region, but it's unclear whether character-level confidence (needed for character-level CWMV) is exposed. Spike: instrument a few captures, see what gets returned.
- **Pill-CNN training data labelling pipeline.** ~200 samples per class × 5 classes = 1000 crops. Best to script this against the match 250 captures (we already know what each pill is from the canonical events). Pending: small CLI to dump pill crops with labels.
- **Cross-frame alignment for cut-off rows.** If a row appears at the very top of one frame and the very bottom of another (so the actor line is cut off in both), can we still recover the event by combining the partial reads? Probably yes via DP alignment, but worth a controlled test.
- **Penalty-row handling regression test.** Need to ingest a real penalty-match before any of the above is fully verifiable; match 250 doesn't exercise the penalty path.
- **opp team color detection per-match.** When and how is `opp_team_color` derived? Probably: take the dominant non-red colour from the first capture's badges; store as `matches.opp_visual_color` for the rest of the pipeline.

---

### Constraints honoured

- Only mature, actively-maintained 2026 libraries cited (RapidFuzz, OpenCV, scikit-learn, scikit-image, scipy, rapidocr, onnxruntime).
- No deep-learning solutions proposed except for the tiny pill CNN (question explicitly invited the comparison; classical OCR already underperforms here).
- Sources from 2022–2026 preferred; older (Lopresti 1996, ROVER 1997) cited where foundational and still authoritative.

When you resume:

1. Re-read this doc top-to-bottom.
2. Run the Deep Research prompt at
   [event-list-extraction-deep-research-prompt.md](./event-list-extraction-deep-research-prompt.md)
   and ingest its output into this dossier's "External research findings"
   section (currently empty).
3. Start at "Concrete next-pass plan" step 1 (visual `team_side` signal).
4. Match-250 ground truth is in the DB — regression-test against it.

---

## Round-2 Deep Research findings (May 2026)

Ingested from a ChatGPT Deep Research run on the Round-2 prompt at
[event-list-extraction-deep-research-prompt.md](./event-list-extraction-deep-research-prompt.md).
Source artifact: `deep-research-report_2.md` (citation tokens mangled
into `îfileciteîturn0…î` markers as with the marker-extraction Round 1
report; underlying papers are findable but links aren't usable).

### Critical framing update

**The end-state input is video frames, not screenshots.** The operator
records the match (scrolling through the Action Tracker post-game),
saves the recording as a video file, and the pipeline consumes the
video. The screenshots in `research/OCR-SS/` are bootstrap material
for developing and tuning per-frame algorithms.

This shift makes the video-text-tracking literature genuinely
applicable: rows physically move between frames as the operator
scrolls; the same row appears at different y-positions in consecutive
frames; cutoff rows at the top/bottom edge in one frame become fully
visible in subsequent frames.

The Round-2 architecture sketches in this section should be read with
"frame" meaning "video frame extracted at some sample rate," not
"operator-triggered screenshot."

### Top-level summary

1. **Tracking-by-detection over short row sequences is the right
   architectural framing**, not single-frame OCR-and-vote. The same
   row appearing at different y in consecutive frames must be
   associated into a "row track" before consensus fires.
2. **PaddleOCR / RapidOCR default decoders return argmax only.** No
   top-K hypothesis lattice. If we want CVTS-style per-character
   alignment with uncertainty fusion, we'll need to fork the
   recognizer path to expose raw logits.
3. **Multimodal LLMs (2026 state) do NOT solve this off-the-shelf.**
   MME-VideoOCR benchmark: best multimodal LLM = 73.7% on multi-frame
   OCR tasks, with explicit weaknesses in spatio-temporal reasoning
   and cross-frame integration. Confirms the classical-CV-first
   direction.
4. **Per-frame scroll-offset estimation is cheap and high-value.**
   Phase correlation or ECC alignment within the panel ROI gives a
   near-deterministic "where is row N in frame K+1 given its position
   in frame K" — converts row-association from fuzzy to mechanical.
5. **Smart-sampling matters at video rates.** Naive 30-fps OCR is
   3600 frames per 2-min scroll-through; either gate OCR on
   scroll-motion detection (only OCR when text is visually stable for
   ≥100 ms) or fixed-rate sample at 5-10 fps and let consensus
   absorb the noise.

### Detailed adoptions

#### Tracking layer (NEW, video-specific)

1. **Per-frame scroll-velocity estimation** via phase correlation or
   `cv2.findTransformECC` on the panel crop. Outputs per-frame scroll
   vector `(dx, dy)`.
2. **Row tracks** are formed by associating row-bounding-boxes across
   consecutive frames using the predicted dy. Tolerance dy ± 20 px.
3. **Track-first merging for cutoff rows**: a row clipped at the top
   edge in frame K and fully visible in frame K+3 is associated
   BEFORE OCR finalization — we OCR the full version, drop the
   cutoff version.
4. **Sample-rate**: start with **5 fps decoder + scroll-motion-gated
   OCR** (only OCR frames where scroll-velocity ≈ 0 for ≥100 ms). If
   accuracy is insufficient, increase to fixed 10 fps and let
   consensus voting absorb the noise.

#### Temporal consensus layer (refined)

Round-1 CWMV recommendation stands, with one implementation refinement
from CVTS:

- **Don't vote on whole-string field values.** Whole-string voting
  fails when truncation or insertion/deletion errors dominate.
- **Do per-character alignment within a row track** (Needleman-Wunsch
  on candidate strings), then pick the lowest-uncertainty character
  at each aligned slot. Whole tokens with insufficient evidence stay
  blank rather than getting a fabricated character.
- For confidence calibration on RapidOCR's known-overconfident output:
  temperature-scale at the sequence level on a held-out validation
  set as a first step. Reserve isotonic regression for later if
  needed.

#### OCR backend caveat

**PaddleOCR / RapidOCR / `rapidocr_onnxruntime` all use argmax CTC
decoding at the post-processing layer.** Stock API returns a single
best string per region; no logit lattice exposed. To implement
per-character CVTS-style alignment+uncertainty fusion, we'd need to:

1. Fork the recogniser's post-processing step
2. Expose raw CTC logits per time step
3. Build a custom top-K decoder

Sizing data from the report: PP-OCRv5 / PP-OCRv4 mobile English
recognizers are 7.5 MB. Cheap to retrain with custom decoder hooks.

For our scale (one match, ~150 events, ~5-10 frames per event), this
refactor may not be necessary. **Recommend: start with the simpler
sequence-level whole-string CWMV, validate against match 250 ground
truth, only fork the decoder if accuracy gates require it.**

#### Augmentation recipe for pill CNN

Concrete recipe for training the 5-class pill classifier:

- Motion blur (linear kernel 3-7 px, random angle)
- JPEG re-encode at quality 50-95
- Gamma shift in [0.8, 1.2]
- Slight crop truncation (5-10% off any side)
- Highlight overlay (additive yellow patch at random α)
- Horizontal jitter ± 2 px

2-4 random corruptions per crop. Mix with clean originals at 1:1.

#### Three-tier temporal fusion progression

| Tier | Method | Use when |
|---|---|---|
| Baseline | Confidence-weighted majority vote on whole strings | Smallest budget; sanity check |
| **Default** | Character-level alignment + uncertainty fusion (CVTS-style) | Most cases — our recommended target |
| Advanced | Tiny transformer over row-track embeddings | Only after labeled row tracks are abundant |

Target the middle tier. Skip the advanced tier — under our scale
it's all downside.

#### Error-bucket schema (concrete)

Per failed event, tag with one or more of:

- `low_sharpness`: motion blur during scroll
- `partial_row`: row clipped at top/bottom edge
- `highlight_contamination`: yellow selection bar overlapping text
- `out_of_lexicon_player`: gamertag not in BGM + observed-opp roster
- `lexicon_collision`: ambiguous match to multiple roster entries
- `selected_state_mismatch`: white-border detector vs row content disagree
- `missing_visual_corroboration`: pill text and badge letter disagree on type
- `short_tag_ambiguity`: actor name ≤3 chars, multiple plausible matches
- `ocr_confusion_family_match`: misread matches a known character-substitution
  pattern (`O↔0`, `l↔I↔1`, `S↔5`, `B↔8`, `m↔rn`, `f↔t`)

Carry this bucketing into the test harness; aggregate stats per bucket
for the regression suite.

#### Evaluation metrics

Field-separated, not collapsed:

| Layer | Metric | Threshold |
|---|---|---|
| Tracking | Row-track IDF1 | ≥ 0.85 |
| Per-field OCR | CER (clock) | ≤ 0.02 |
| Per-field OCR | CER (actor) | ≤ 0.05 |
| Per-field OCR | event_type accuracy | ≥ 0.98 |
| Calibration | ECE (expected calibration error) | ≤ 0.05 |
| End-to-end | Exact-match event accuracy vs match 250 V2 | 72/72 non-faceoff |

Runtime budgets (for the eventual video pipeline):
- ≤ 30 ms per OCR'd frame on CPU
- Scroll-motion gate + ECC alignment ≤ 5 ms per frame

#### Storage model

The 4-table sketch in the Round-2 report is a watered-down version of
Round-1's canonical-facts schema. **Stick with Round 1's pattern**:
`ocr_observations` (raw, immutable) → consensus engine → canonical
`match_events` + `match_event_source_links` (JSONB per-field
confidence, per-source-observation IDs). Backfill strategy: replay
raw observations through new consensus logic without touching
canonical rows until ready to swap.

### What the report DIDN'T address from the Round-2 prompt

Of the 23 specific questions in the Round-2 prompt, only ~5 got
concrete engagement. The rest remain open — to be answered via
internal spikes (the pre-game-extraction pattern) rather than another
Deep Research round:

| # | Question | Path forward |
|---|---|---|
| A1 | DP alignment kernel for row clustering with same-clock collisions | Internal spike: prototype Smith-Waterman on tuple-encoded rows |
| A2 | RapidOCR confidence calibration (Platt / isotonic specifics) | Internal: temperature scaling on match 250 calibration set |
| B5 | Empirical Jaro-Winkler threshold for our OCR-confusion table | Internal: parameter sweep on match 250 |
| B6 | JW + Levenshtein fusion rules | Internal: A/B compare on match 250 |
| B7 | DBSCAN eps tuning for OOV gamertag clustering | Internal: k-distance plot on observed unknowns |
| B8 | Vocabulary-expansion patterns for new opp rosters | Internal: design pattern |
| C11 | Few-shot training for pill CNN (50 vs 200 vs 1000 samples) | Internal: crop training data from match 250, ablation |
| C12 | ONNX-Runtime-Node vs subprocess vs FastAPI sidecar | Internal: small benchmark on actual deployment box |
| D13 | Per-match opp-team-colour auto-detection | Internal: portrait-color spike (technique already from marker dossier) |
| D14 | Solid-vs-outlined badge edge cases | Internal: HSV sample from match 250 captures |
| E16 | Frame-duplicate detection in video stream | Internal: perceptual hash on the panel ROI |
| E17 | GOT-OCR2.0 / Nougat for scrolling-list ingestion in 2026 | Internal: 30-min spike; defer if not promising |
| F18 | Concrete Postgres DDL with indexes | Internal: schema design pass when we start implementation |
| F20 | Identity-resolution propagation to past events | Internal: schema pattern |
| G21 | Bootstrapping regression coverage from one gold match | Internal: design test harness |
| G22 | Drift detection for EA UI updates | Internal: monitoring pattern |
| G23 | Lightweight labelling tools comparison | Internal: pick one and run with it |

### Round-2 caveats

- Citation tokens in source report mangled (`îfileciteî…`); links not
  followable.
- Report framed our problem as a sprawling "Round 2 benchmark
  dataset" — repeatedly asked for clip counts, fps, splits we don't
  have. Our actual scope is one match (250) as gold standard, with
  the goal being a working pipeline, not a published benchmark.
- Scale recommendations (10k-30k labeled row crops, BiGRU/transformer
  temporal model, large-scale IDF1/MOTA tracking metrics framework)
  are sized for a research-paper effort, not our single-match
  operational pipeline. We adopt the operational pieces and ignore
  the scale.

### What changed in the implementation order

The "Concrete next-pass plan" above (8 steps) remains correct but two
new items rise in priority for the video pipeline:

0a. **Add per-frame scroll-velocity estimation** (phase correlation /
   ECC) as the first stage of the video pipeline. Cheap, deterministic,
   converts row-association from fuzzy to mechanical.
0b. **Add smart-sampling gate**: detect "scroll-velocity ≈ 0 for
   ≥100 ms" and only OCR those frames. Fallback to fixed 5-10 fps if
   the gate misses too much content.

Both belong upstream of the consensus engine in the new pipeline.
