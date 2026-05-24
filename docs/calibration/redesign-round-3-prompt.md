# Round 3 prompt — Deep research (literature-grounded)

**To be submitted externally** (ChatGPT Deep Research / Claude with web / equivalent) by the user, running in parallel with Round 2. Save returned report to `docs/calibration/redesign-round-3-deep-research-2026-05-19.md`.

---

I'm redesigning an OCR pipeline that ingests recorded EA NHL Pro Clubs match videos into a Postgres-backed stats website. I need a literature-grounded recommendation for a ground-up redesign architecture. This is one round in a four-round research process — your output will be synthesised against an internal-codebase audit, an external internet survey, and a Codex critique.

## The goal

Reliably extract every metric defined by a canonical screen + field inventory from a recorded EA NHL match video, without manual intervention, at ≥98% per-field accuracy across the inventory. "Reliably" means surviving:

- Single author, low volume (~30 matches/season)
- No API ground truth for the vast majority of fields (EA Pro Clubs API returns ~half a dozen fields; the other 95% of the metric inventory is video-only)
- No test-time human review
- NHL 26 → 27 annual UI redesign without throwing away the existing calibration corpus

## What the pipeline must extract (the inventory)

8 distinct on-screen "screen types," each with its own field schema:

1. **Pre-game lobby state 1**: club names, ratings, ranks
2. **Pre-game lobby state 2**: opponent's loadout cards in summary
3. **Player loadout view**: 10 player cards × { gamertag, persona name, jersey, position, build_class, 3 X-Factors, 23 attribute values 0–99 }
4. **In-game clock + scoreboard** (every frame mid-game): clock, period, score, special-teams state
5. **Post-game player summary**: per-slot stats (G, A, PIM, SOG, +/–, hits, blocks, faceoffs, TOA, etc.)
6. **Post-game box score**: per-period goals, shots, faceoffs
7. **Post-game events**: chronological event list (goals + assists + penalties with times)
8. **Post-game action tracker**: chronological event list with on-rink markers (shots, goals, hits, faceoffs) — 100+ events per match, each marker has (x,y) coords
9. **Post-game faceoff map**: per-zone faceoff outcome distribution
10. **Post-game net chart**: per-shot-type breakdown per period

Per-match field budget: ~600+ fields when you multiply slots × fields × periods. The V2-style hand-keyed benchmark for the canonical match (250) covers all of these.

## The current pipeline (two-pass)

- **Pass 1**: 1 fps sampling of the source video → per-frame HSV-cosine classification against fingerprint centroids per screen type + an anchor-text fuzzy-Levenshtein gate (e.g. "POST GAME REPORT") → 8 screen types or `unknown_screen` → run-length compressed into segments. Calibrated from ~5 fixture frames per class (`tools/game_ocr/calibration/extras/`).
- **Pass 2**: dense ffmpeg extraction per segment at ~5 fps → screen-specific Python parsers (regex over RapidOCR output) → JSON rows in `ocr_extractions` table.
- **Promotion**: per-screen promoter functions read `ocr_extractions` and fan out to per-table downstream rows in Postgres (`match_events`, `match_period_summaries`, `match_shot_type_summaries`, `match_faceoff_dots`, `match_faceoff_zone_summaries`, `player_loadout_snapshots`, etc.).
- **OCR engine**: RapidOCR CUDA on RTX 3060 (~200ms/frame).
- **Quality measurement**: three-layer (L1 classifier recall — not actually measured, no labelled corpus; L2 actor resolution + lineup completeness; L3 downstream completeness).

## Current state on real matches

- Match 250 (canonical pilot, fed manually via screenshots, hand-curated): L2 actor 97.9%, L2 lineup 100%, L3 100%.
- Match 463 (first end-to-end unattended video ingest): L2 actor 98.0%, L2 lineup 95% (2 OCR-garbage build_class slots), L3 84.2% — capped by structural recording gaps that mean the source video literally doesn't contain the data on screen long enough to OCR.
- 34 manual-QA defects on match 463 split across screens, classified into bucket A (recording gap, not fixable in pipeline) / B (cheap fix) / C (heavyweight justified) / D (needs more instrumentation).

## What I want from you

A literature-grounded redesign recommendation. Required sections:

### 1. Architecture survey

Survey the published literature on extracting structured data from video at scale. Focus areas:

- Two-pass (probe + dense) vs single-pass continuous vs event-driven (transition-detect → extract-once)
- HMM / Viterbi / CRF segmenters for UI-state sequences
- Probabilistic OCR (multi-hypothesis output) vs hard-decision OCR
- Document-AI architectures applied to video (LayoutLMv3, Donut, Pix2Struct, ScreenAI)
- Vision-language models for structured extraction (GPT-4V, Claude vision, Gemini, Florence-2, InternVL)

For each: cite papers, state the architectural pattern, give the operational tradeoffs (latency, accuracy, calibration cost, robustness to UI drift).

### 2. Specific recommendation for THIS pipeline

Given the constraints (single author, ~30 matches/season, NHL 26 → 27 UI shift, no API ground truth, no test-time review, RTX 3060 available, Postgres-backed), recommend a specific ground-up architecture. Be opinionated. Justify with citations. Sketch the data flow end-to-end (frame → ?? → field set).

### 3. The truth system

At 98% per-field accuracy across ~600 fields, the truth system is part of the redesign — not an external check on it. The current V2-style hand-keyed markdown exists for 1 match. Recommend an architecture for the truth system that scales with the metric inventory but doesn't require 30 matches × 8 hrs/match of manual keying. Cite literature on semi-supervised labelling, weak supervision (Snorkel, etc.), and active-learning for low-resource OCR.

### 4. The calibration loop

The redesign must survive the NHL 26 → 27 UI change without throwing away corpus. Recommend a calibration architecture: what gets versioned, what gets re-trained, what gets templated, what gets re-keyed. Cite production examples or relevant academic work.

### 5. Honest tradeoffs against the current design

For each redesign recommendation, give the _cost_ of the change: developer-hours, hardware, third-party API spend, model serving overhead, migration risk. Don't sell the redesign — characterise it.

### 6. What you would NOT recommend

Final section. Which of the literature-blessed approaches are wrong for _this_ context (single author, ~30 matches/season, no test-time review). Be willing to call ambitious approaches over-engineered.

## Hard constraints

- Cite papers, blog posts, and production writeups with full URLs.
- Distinguish between recommendations grounded in cited work vs your own synthesis.
- Acknowledge gaps in the literature where they exist.
- Length: thorough. 4000–8000 words.
- Output format: markdown, ready to drop into `docs/calibration/redesign-round-3-deep-research-2026-05-19.md`.

Begin.
