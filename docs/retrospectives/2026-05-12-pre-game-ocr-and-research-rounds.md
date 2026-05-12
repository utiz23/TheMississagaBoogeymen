# Retrospective — 2026-05-12

Pre-game OCR pipeline shipped end-to-end + two Deep Research rounds reviewed.
This is a process / lessons-learned doc, not a session summary — the per-commit
factual record is in [HANDOFF.md](../../HANDOFF.md). Future me / future-session
me should read this before starting another OCR or research-heavy track.

---

## What got shipped

Seven commits, day's end-state:

```
c023f58 feat(web): render canonical loadout fields on match page
9ce8aa9 docs(handoff): summarize pre-game OCR end-to-end + Round-2 review
12694e9 feat(worker): cross-frame consensus CLI for loadout snapshots
87a863e feat(ocr): rewrite lobby parser with per-team state auto-detection
3e3f7c4 feat(worker): wire new loadout parser fields through promoter
f34b400 feat(ocr): rewrite loadout parser as anchor-based full-frame parse
cc101de feat(db): add pre-game OCR fields (tier, captain, number, persona, delta)
```

Pre-game OCR ingests 14 captures per match, runs cross-frame consensus, and
surfaces 10 canonical skater rows with captain marker + 3 X-Factors w/ tier
+ height/weight/handedness/level on `/games/[id]`. End-to-end validated on
match 250: **93.7% V2 match** on the parser alone, ~100% after consensus +
audit-trail at `pending_review` for the raw observations.

Earlier in the session: marker-extraction Round-2 Deep Research returned a
usable report (after one false-start 7-min stub); ingested into the dossier.
Event-list Round-2 also ingested. Four marker-calibration internal spikes
remain queued.

---

## Lessons — methodology

### 1. Anchor-based parsing beats ROI-based parsing for structured screens

The old pre-game parser used 17 named ROIs per loadout screen, each clipping a
specific small region. They were catastrophically misaligned — the `gamertag`
ROI pointed at the LEFT-STRIP avatar instead of the top-right gamertag; the
`build_class` ROI clipped half the title text; each attribute group ROI
captured 1 of 5 rows.

The fix wasn't to re-tune the ROIs. It was to **OCR the whole frame once and
use stable anchor lines** (column headers, screen titles) to derive a grid,
then snap detected text into the grid cells. The same pattern unlocked the
lobby parser the next morning.

**When you see code that asks OCR to do small focused reads at hard-coded
positions, suspect that the screen's layout has natural anchors that could
do the addressing work for you.** Cheaper to find an "ATTRIBUTES" header at
y=529 than to maintain 17 fragile pixel-coord ROIs.

### 2. Single-pixel / single-character signals are unreliable in OCR

RapidOCR consistently:
- Missed the `'C'` position label for MrHomicide's row (a single uppercase
  char that visually exists in every BGM panel capture).
- Missed the captain `★` glyph for BGM players (small symbol, mid-saturation).
- Dropped spaces in compound text (`TAGETHOMPSON-PWF` instead of `Tage Thompson - PWF`).
- Tokenised concatenated noise into single lines (`XZ4RKY★READY` as one token).

Workarounds that actually worked:
- **Canonical-ordering anchor fill:** if a position label is missing but
  other rows are detected, synthesize the missing anchor from the median
  inter-anchor gap and the known canonical row order (C/LW/RW/LD/RD/G).
- **HSV color sampling instead of OCR** for visual signals (X-Factor tier
  encoding — Elite=red, All Star=blue, Specialist=yellow). 100% accuracy on
  18/18 non-transitional captures with a 5-line classifier.
- **Strip noise from concatenated tokens** during normalisation, don't
  filter the noisy line out of candidates entirely — otherwise valid
  gamertags that happen to share a y-band with READY/captain markers get
  excluded.

**If the text or glyph you need is < 3 chars or a small icon, OCR is the
wrong tool. Use position + color sampling.**

### 3. Cross-frame consensus is a HUGE force multiplier

41 raw observations from match 250's 14 captures → 10 canonical rows. The
consensus pass corrected real errors:
- 4 OPP players had wrong levels on their loadout captures (level-extractor
  picked up a different player's strip row when the subject was in AWAY).
  3 lobby observations outvoted the buggy loadout reads.
- Build class case normalised (`PUCKMOVINGDEFENSEMAN` → `Puck Moving Defenseman`).
- `player_name_persona` backfilled across all 10 skaters from lobby state-2
  observations (loadout view doesn't have personas).

This was a ~250-line CLI. Cheap to build, gigantic downstream effect.
**Implement consensus EARLY when you have multi-frame redundancy** — it
makes parsers tolerant to per-frame errors and removes pressure to chase
perfection in single-frame parsing.

### 4. Validate against ground truth as you go

[validate_loadout_v2.py](../../tools/game_ocr/scripts/validate_loadout_v2.py)
checks the parser's output against the hand-keyed V2 benchmark for 5 known
players × 38 fields = 190 fields. The 93.7% score was the only honest signal
that the parser was actually correct — "looks right when I print one capture"
was hiding systematic level-extraction bugs.

**Build the regression harness BEFORE declaring a parser done.** Even a
simple comparator script with a hand-keyed gold set is enough.

### 5. Schema migrations land first, separately

Migration 0032 (5 columns across 3 tables) landed as its own commit before
the parser rewrite. Then parser + promoter wiring. This:
- Made the schema diff reviewable in isolation.
- Let the parser rewrite focus on parsing logic, not schema design.
- Gave the rollback granularity (revert one commit affects only one layer).

**Schema → parser → promoter → CLI → web → handoff** is a clean dependency
order; ship each as its own commit.

### 6. Stage research → debate → ingest → implement

For both pre-game and marker work, the pattern was:
1. Inspect screenshots and existing code → write a dossier
2. Identify open questions → either spike internally or send to Deep Research
3. Review findings critically → ingest the actionable bits into the dossier
4. Implement against the dossier

Avoided the failure mode of "start coding then discover halfway through
that the wrong architecture was assumed." Pre-game implementation went
from research-complete to fully shipped in 5 commits with no
architecture changes mid-stream.

### 7. Deep Research quality varies dramatically

We got 3 Deep Research outputs this session:
1. **Marker-extraction Round 2** — full structured report, 15/15 questions
   addressed, useful actionable findings (weighted LOOCV-TRE, neighbors=k,
   tiered TRE budgets). Took ~30 min.
2. **Event-list Round 2** — full report but framed the wrong problem
   (treated as generic multi-frame video OCR); 5/23 questions got concrete
   engagement.
3. **Event-list Round 2 retry** — 7-minute stub of 30 lines. Clearly not
   a real Deep Research run. Discarded.

Patterns:
- **Dump prior context into the prompt aggressively.** "Don't re-research
  these established findings" sections work — Round 1 results, internal
  spike findings, scale constraints, the specific domain.
- **Ask ≥ 10 sharply-focused questions.** Expect ~30-50% concrete
  engagement. Vague questions get vague answers.
- **A real Deep Research run is 20-40 minutes.** If it returns in <10 min,
  it's probably a regular chat response, not the multi-stage pipeline.
- **Citation tokens come back mangled** (`îciteîturnXsearchYî` artifacts).
  The prose is usable but the links aren't — paste the source URLs into the
  ingested dossier manually.

---

## Lessons — domain-specific (EA NHL OCR)

### 8. Lobby per-team state alternation is independent

State-1 (build class) and state-2 (#number + persona name) alternate
**per-team, independently**. A single capture can have BGM in state-2 and
opp in state-1. Detection: count `#\d+` patterns in each panel separately,
≥3 → state-2.

Took fusing 3 captures to get complete data per player. 3 captures gave
full coverage of all `(team, state)` combinations.

### 9. The loadout view's left strip is 11x-redundant data

Every loadout capture shows ALL 10 skaters in the strip (5 HOME + 5 AWAY)
with position + gamertag + jersey number + persona name. 11 loadout
captures → 11 observations of each skater's strip row. Consensus over
these alone gives high-confidence per-player data, completely independent
of the lobby state-2 captures.

This redundancy is why pre-game OCR works robustly even with imperfect
per-capture parsing.

### 10. Future-state input is video, not screenshots

User clarified mid-session: the screenshots in `research/OCR-SS/` are
bootstrap material for parser development. The actual production input
is a recorded video of the match playthrough, including the scrolling
Action Tracker. This changes the framing for event-list extraction
specifically — rows physically move between frames, tracking-by-detection
becomes the right framing, and smart-sampling matters (30fps → 3600
frames per 2-min scroll-through; need scroll-motion gating or fixed
5-10 fps).

Pre-game doesn't have this problem because pre-game UI is static. But
event-list extraction next pass needs the video pipeline framing baked in.

---

## Anti-patterns avoided / encountered

### 11. The DB had garbage that called itself canonical

Match 250 started the session with 28 `review_status = 'reviewed'` loadout
snapshots. All garbage — gamertags like `"5'8\" 1 175Ibs HenryTheBobJr Iil. 6'0* | 160 bs P2lYL35 JoeyFlopfish CHEL"`. Auto-approved by a prior review CLI run without inspection.

**`review_status = 'reviewed'` only means "an operator clicked approve",
not "this data is correct".** Always sample the actual rows when assessing
the state of an OCR dataset. The promoter should default to
`pending_review` (it does) and the review CLI should require explicit
confirmation per row OR a tight confidence threshold (it doesn't, yet —
worth tightening).

### 12. Parsers shouldn't make up answers

The old loadout parser silently emitted truncated build classes (`PUCK M`
instead of `Puck Moving Defenseman`) because the ROI clipped the text. It
didn't flag this as low-confidence; it just returned the truncated string
with normal confidence. Downstream consumers had no signal that something
was wrong.

**Parsers should emit `MISSING` / `UNCERTAIN` status when they can't
extract cleanly.** Don't fabricate plausible-looking output. The
`FieldStatus` enum already exists in the models for exactly this; use it.

### 13. Resisted scale-creep from Deep Research

The marker-extraction Round-2 report recommended:
- Stratified landmark-ablation at 13/17/21/25/29 landmarks
- BiGRU temporal models
- 10k-30k labelled row crops for the event-list pipeline
- IDF1/MOTA/MOTP tracking metrics framework

We have one match, ~150 events, hand-tuned 13 landmarks. The right
response was to take the *operational* recommendations (regularized
TPS, neighbors=k, confidence gates, weighted LOOCV-TRE) and ignore the
*scale-of-effort* recommendations. The dossier explicitly flags this
distinction ingested as "scale-of-effort items deferred — not
applicable to single-match operational pipeline."

**Deep Research / web research will assume your dataset is research-paper
sized.** Be explicit about scale in your prompts; be selective in what
you adopt.

### 14. Test data pollution

I ran 3-4 test ingests of match 250 during validation cycles. Each
inserts ~40 rows into `player_loadout_snapshots` + children. If you
don't clean up between runs, the DB accumulates duplicates that confuse
the next consensus run.

Mitigation that worked: use a **unique `notes` field on the capture
batch** (e.g. `'test loadout ingest'`, `'match 250 lobby for web render'`)
and write a cleanup SQL that finds and rolls back by notes pattern.
Always run cleanup at the end of a test cycle.

**Don't trust dev ingests to "naturally fade away."** They don't.

### 15. Uncommitted work accumulates faster than expected

Started the session with `docs/ocr/` containing 12 untracked dossier files
(from prior sessions) + various untracked spike scripts. Ended the session
with most of those *still* untracked because the focused commits are
intentionally narrow.

This is borderline unsafe: a wipe of the working tree (worktree cleanup,
`git clean -fdx`, fresh checkout) would lose substantial research work.

Flagged it in HANDOFF as the first task for the next session. Should
probably automate: a periodic `docs(ocr): commit research dossiers` is
worth doing even if the dossiers will be edited later.

**Untracked-file-count is a leading indicator of risk.** If git status
shows ≥10 untracked files of real work, commit them as a checkpoint
even if they're "in progress." Bigger commits later can refine.

---

## What I'd do differently

1. **Commit the dossiers earlier.** Should have been the first commit of
   the session, not deferred to a future session.
2. **Write the V2 regression script first.** Built it after the parser was
   mostly working; should have been the gate from the start.
3. **Skip the failed Deep Research stub more aggressively.** Spent
   ~15 min reading and reviewing the 30-line stub before flagging it.
   Should've noticed the 7-min runtime in 30 seconds and discarded.
4. **Build the consensus CLI before the lobby parser.** Lobby parsing
   benefits MORE from consensus than loadout does (more captures per
   match). Implementing consensus first would have made lobby parser
   validation cheaper.

---

## Things to remember next session

- HANDOFF section "Uncommitted research artifacts" → commit those first.
- The 4 marker-extraction spikes are scoped and ready: regularized TPS,
  neighbors=k, PWA comparison, hull gate. ~30 min each.
- Build-class normalization is a small follow-up that closes the
  RapidOCR spacing-variant gap (`TAGETHOMPSON-PWF` → `Tage Thompson - PowerForward`).
- The captain ★ detector is bounded: BGM ★ at fixed pixel region per
  strip avatar; HSV-match yellow.
- The Web rendering left attributes (5×4-5 grid) on the floor as a
  deliberate "not bare-bones" cut. Eventual expand-on-click would be
  nice but optional.

If the next session is short (< 1 hr), pick build-class normalization or
the M. RANTANEN alias fix — both bounded and high-ROI. If it's longer,
the marker spikes are the higher-leverage choice.
