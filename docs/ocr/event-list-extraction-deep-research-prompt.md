# Deep Research Prompt — Event-List Extraction (Round 2)

This is the verbatim prompt to paste into ChatGPT Deep Research (or
equivalent) when picking up the event-list extraction redesign. Output goes
back into [event-list-extraction-research.md](./event-list-extraction-research.md)
under a new "Round-2 external research findings" section.

**Status:** Round 1 (web research) is captured in the dossier under
"External research findings." This round is the deeper, citation-heavy
Deep Research pass that builds on those findings rather than rediscovering
them. The prompt is self-contained — Deep Research won't see our
conversation history, and the output format is prescribed for ingestion by
another AI.

Paired with the marker-extraction deep-research prompt; consider running
both in parallel.

---

```
# Deep Research Request: Multi-Frame Event-List OCR with Visual Signal Fusion (Round 2)

## Background (context, do not re-research)

I'm building a computer-vision pipeline that extracts a list of hockey
events from post-game screenshots of EA NHL's Action Tracker screen. The
screen has a scrollable panel on the left listing 6-7 event cards visible
at once. Operators screenshot the panel frame-by-frame as they scroll, so
each event appears in multiple consecutive captures. Per-event card
visually encodes:

  • EVENT TYPE via the colored pill (HIT / SHOT / GOAL / FACEOFF / PENALTY)
    and a redundant letter badge on the far right (S/H/G/P; faceoffs have no badge)
  • TEAM COLOUR via the portrait box (red for our team BGM; opp colour varies per match)
  • CLOCK in MM:SS
  • ACTOR + RECEIVER in "X ON Y" (action), "X VS Y" (faceoff, X is winner),
    or "X INFRACTION (SEVERITY)" (penalty, no receiver)
  • SELECTED STATE via a thin white border around the entire card
  • REPLAY CLIP AVAILABILITY via a play-arrow icon (▶)

The current parser handles per-frame extraction of event_type / actor /
target / clock with a regex-based approach. Pill text → event type via
lookup; clock via bounded regex; actor/target via "ON"/"VS" split. The
selected-row detector (white border) is reliable. Match 250 is the only
match ingested through this pipeline so far — 72/72 non-faceoff events are
manually placed, ZERO penalties exist in that match, and the penalty
parser path is empirically unverified.

Observed failure modes (in match 250):
  • OCR letter-shape confusion: WILDE ↔ WILOE, TOEWS ↔ fOEWS, SILKY ↔ SIlKY
  • Pill icon glyph misreads → event_type = "unknown" (~10% of pills)
  • Clock misreads: "11:10" → "1:10" — bounded regex didn't catch this one
  • Cutoff captures where the selected row is partially off-screen → row dropped
  • Naïve dedup (period, type, clock, actor) misses cross-frame variants → phantom rows

## What I've ALREADY established (Round 1 research findings)

DO NOT re-research these. Build on them.

### Cross-frame consensus
- Lopresti & Zhou (1996) consensus voting eliminates 20-50% of OCR errors.
- NIST ROVER is the canonical algorithm: DP-aligned word-transition network + voting.
- Confidence-Weighted Majority Voting (CWMV) is provably optimal vs. unweighted.
- The K=3 top-hypotheses approach (Odobez & Chen 2002) improves 93.1% → 97.9%.
- Production esports analogues: PandaScore (CS:GO, blueprint+MCTS), ScoreSight
  (OBS plugin, "Semantic Smoothing"), LeagueOCR (Riot spectator API).
- Singletons → confidence-threshold routing to a manual-review queue is industry standard.

### Fuzzy matching
- RapidFuzz wins all 2026 benchmarks (~2,500 pairs/sec, C++ core, `process.cdist` batch).
- Jaro-Winkler best for short identifiers (prefix bias).
- Phonetic codes (Soundex/Metaphone) wrong for OCR (they target sound-alike, not visual).
- For OOV gamertags: `process.cdist` → DBSCAN cluster on fuzzy distance.

### Pill OCR
- Tiny CNN classifier (5-class) beats OCR — `semantic-icon-classifier` is a
  working reference at this scale.
- Preprocessing: 3x upscale → HSV V-channel → Otsu → 5-px white border padding.
- PaddleOCR fine-tuning needs 5000 samples — overkill for our 5-class case.

### Visual signals
- HSV median sampling over central region (not edges) is the robust pattern.
- Red detection: H ∈ [0,10] ∪ [170,180] AND S > 100 AND V > 80.
- Template matching at known scale (TM_CCOEFF_NORMED, threshold 0.7+) for ▶ icon.
- Solid-vs-outlined badge: centre pixel vs annulus median delta on S channel.

### Schema
- Event-sourcing canonical-facts pattern: raw `ocr_observations` table
  (immutable) → consensus engine → canonical `match_events` →
  `match_event_source_links` JSONB recording per-field confidence + voting.
- Per-field confidence as JSONB column, no index unless queried.
- Idempotency key = hash(match_id, period, canonical_clock, canonical_actor, canonical_type).

### Architecture
- Three-stage separation: per-frame extraction → cross-frame consensus → business-logic dedup.
- OlmOCR-Bench / LiteParse for unit-test-driven regression on a frozen ground truth.
- Match 250's 72 manually-placed events are our gold standard.

## What I need YOU to research (Round 2 — deeper gaps)

Don't repeat Round 1 findings. Focus on operational depth: implementation
edge cases, calibration of the recommended techniques, and decisions Round
1 punted on.

### A. Cross-frame consensus — operational depth

1. **DP alignment kernel for row matching across frames.** When grouping
   rows from multiple captures into clusters, the obvious key is
   (period, clock±1s, fuzzy-actor). But this fails when:
     (a) clock OCR is off by more than 1s (rare but does happen),
     (b) actor is unreadable on one frame but clean on others,
     (c) two real events legitimately have the same (period, clock) — adjacent
         faceoff and shot at same second.
   What's the best DP alignment formulation for this? Smith-Waterman with
   custom gap penalties? Levenshtein over a tuple-encoded row representation?
   Concrete algorithm + cost-function recommendation, citation-backed.

2. **CWMV calibration when confidence scores are unreliable.** RapidOCR's
   per-region confidence is known to be optimistic (regions with garbage
   text often get confidence > 0.9). How do practitioners calibrate or
   re-score OCR confidence before feeding it into CWMV? Platt scaling?
   Isotonic regression on a validation set? Specific papers / code.

3. **Top-K hypotheses extraction from RapidOCR / PaddleOCR.** Round 1
   recommended Odobez-Chen's K=3 approach but neither RapidOCR nor
   PaddleOCR's default Python API surfaces per-region top-K — only the
   single best read. What's the actual API surface for getting top-K
   from these engines in 2026? CTC beam-search depth? Forced re-decoding?
   Custom recogniser-head call?

4. **Cutoff-row recovery.** When a row is clipped at top/bottom of a
   frame so only the actor line OR only the pill+clock is visible, how
   do you safely splice it with a different frame's view of the same row?
   What's the precision/recall tradeoff? Citations to multi-fragment
   text reconstruction work preferred.

### B. Fuzzy matching — operational depth

5. **Empirical Jaro-Winkler threshold calibration for OCR-substitution
   patterns.** Round 1 recommended `score_cutoff=0.85` for JW on our
   vocabulary. Is 0.85 right? Cite or derive: what cutoff minimises
   false-positive identity assignment when the OCR-confusion table is
   {O↔0, l↔I↔1, S↔5, B↔8, m↔rn, f↔t}? Ideally a study or principled
   derivation, not a guess.

6. **Combining JW + Levenshtein in a single decision rule.** Round 1
   suggested "if either scorer clears 0.85, accept" but didn't justify
   it. Is there a better fusion (max? mean? logistic regression?) for
   short-token OCR canonicalisation? Cite if studied.

7. **DBSCAN eps tuning for OOV cluster discovery.** Round 1 hand-waved
   `eps=0.15` for clustering unknown gamertags on `1 - JW_similarity`.
   What's the principled way to choose eps when cluster sizes are small
   (2-5 observations each)? k-distance plot? Silhouette? OCR-specific
   priors?

8. **Gamertag vocabulary expansion strategy.** New opp players appear
   every match. How do production identity-resolution systems handle
   "candidate identity emerges from N observations, promote to canonical
   vocabulary after M cross-match appearances or human confirmation"?
   This is fraud-detection-style entity resolution; cite concrete
   patterns.

### C. Pill CNN — training & deployment

9. **Architectural recommendation for the 5-class pill classifier at
   ~60×120 px input (post-upscale).** Round 1 said "3-conv CNN" but no
   specifics. What's the right size/shape under modern transfer-learning
   norms in 2026? MobileNetV3-Small pretrained? EfficientNet-Lite0?
   Custom 3-conv from scratch? Quantify the speed/accuracy tradeoff for
   on-CPU inference (the worker is single-threaded Node calling Python).

10. **Data augmentation for in-game UI elements.** Standard CV augmentations
    (rotation, scale jitter, perspective) don't make sense for fixed UI
    geometry. What augmentations DO make sense for game-screenshot pill
    classification? Compression-noise simulation (JPEG re-encode at low
    quality)? Hue jitter on the pill colour? Random crop +/- 2 px?
    Concrete recipes.

11. **Cold-start training set: how few labels can we get away with?** With
    ~200 labelled samples per class from match 250, do we expect >99%
    test accuracy? What about with 50? With 20? Cite few-shot or
    transfer-learning results on similar UI-icon classification problems.

12. **Production deployment: ONNX export, Python ↔ Node bridge.** Our
    worker is Node.js; the OCR + classifier needs to be invoked from it.
    What's the cleanest 2026 pattern: ONNX Runtime Node binding directly?
    Python subprocess + IPC? Tiny FastAPI sidecar? Cite ergonomics +
    benchmarks.

### D. Visual signals — calibration

13. **Per-match opp-team-colour auto-detection.** BGM is always red, but
    opp is green for PHI, dark for the match 250 opponent, etc. How do
    you reliably auto-detect the opp's primary colour from a single
    early capture? K-means on portrait pixels with k=2? Median Hue over
    a known-opp ROI? Robustness to compression artefacts in saturated
    regions?

14. **Solid-vs-outlined badge edge cases.** What happens when the badge
    is partially occluded by the play-arrow icon? When the team colour
    coincidentally has similar HSV-V to white (light grey opp colour)?
    What's the worst-case false-classification rate observed in published
    icon-fill-classification studies?

### E. Scroll-frame reconstruction

15. **Scroll-position estimation when row anchors are partial.** Round 1
    recommended "anchor on the first row's clock and integer-divide by
    row-height." But if the first row's clock is itself misread, this
    cascades. What's the established way to *jointly* estimate scroll
    offset and row-y-centres across frames? RANSAC fit on per-row y?
    Bundle adjustment over (frame_offset, row_index) tuples?

16. **Detection of frame *duplicates* (operator screenshotted same scroll
    position twice).** Should they be deduped before consensus, or fed in
    as extra signal? Cite if studied.

17. **Best document-AI library specifically for "scrolling capture
    reconstruction" in 2026.** Round 1 surveyed LayoutParser, Donut,
    LayoutLMv3 and found none fit. Are there newer libraries
    (mPLUG-DocOwl 2.0+, GOT-OCR2.0, Nougat-derivatives) that DO handle
    multi-frame ingestion natively? If so, can they ingest 6-frame
    sequences with overlap and emit one event list? Or is custom code
    still the answer in 2026?

### F. Schema — production patterns

18. **Concrete production schema (Postgres) for the canonical-facts +
    raw-observations + source-links pattern from Round 1.** I have the
    architecture; I want the DDL. Indexes? Trigger for materialised
    canonical view? Or a periodic recompute job? Cite real systems
    (Snowplow, RudderStack, Stripe events?) that implement this at
    scale.

19. **Backfill strategy when the consensus engine changes.** If we
    improve the consensus logic after ingestion, do we replay raw
    observations through the new engine and rewrite canonical events?
    What's the cost model and the failure mode if a canonical event has
    downstream references (aggregates, foreign keys)?

20. **Handling per-match identity-resolution updates.** When a human
    confirms that OCR'd "M. RANTANEN" really maps to player_id=3, that
    fact should propagate to all past events. Schema pattern for this
    that doesn't require rewriting historical canonical events?

### G. Testing & operational excellence

21. **Building a regression test suite when only ONE match has ground
    truth.** Match 250 is our gold standard but we'll only have one
    until we manually annotate more matches. How do practitioners
    bootstrap regression coverage when ground truth is expensive?
    Synthetic match generation (replay an old match with different OCR
    noise)? Mutation testing on the parser?

22. **Production monitoring & drift detection for an OCR pipeline.**
    When EA pushes a UI change (new font, repositioned pill, different
    colour palette), our pipeline silently degrades. What's the
    established way to detect this? Per-field confidence distribution
    shift? Champion-challenger setup? Citations to deployed systems.

23. **Ground truth labelling tools in 2026.** CVAT is what we use today
    but it's heavy for our scale. What lightweight alternatives have
    emerged for "small team annotates a few hundred game screenshots
    per month"? Labelbox? Roboflow? Scale Studio? FiftyOne? Compare on
    ergonomics, cost, and OCR-specific support.

## Output format requirements

Return findings as a markdown section titled "Round-2 external research
findings" intended to be appended to an existing dossier. Use this exact
structure:

# Round-2 External Research Findings

## Top-level summary (≤200 words)

Opinionated: 3-5 most actionable additions beyond Round 1.

## Detailed findings

Organize by sections A-G. For each question, give a finding block:

### Question #N: <one-line restatement>

**Finding:** <2-4 sentences>

**Evidence:** <bulleted citations, markdown links with 1-line captions>

**Confidence:** high | medium | low — and why (1 sentence)

**Applicability to our problem:** high | medium | low — and why (1 sentence)

**Code/library pointers:** <specific package versions, function names,
gotchas, code if directly answering the question> or "N/A" if non-software.

## Comparison tables

Anywhere 2+ approaches compete (e.g., ONNX vs subprocess for Node↔Python).

## Concrete code snippets

Code blocks ≤ 30 lines, Python 3.11+, well-maintained libraries only.
Each runnable as-is given sensible test input. Use # NOTE comments for
quirky library behaviour.

## Open questions surfaced during research

Bullet list of NEW gaps for a hypothetical Round 3.

## Constraints

- DO NOT repeat Round 1 findings. Reference them only when needed to frame
  a follow-up answer.
- Cite 2024-2026 sources strongly preferred; older OK for foundational
  techniques.
- Note library maintainership status in 2026 (active, in maintenance,
  abandoned, forked).
- Don't propose deep-learning unless the question invites it; classical
  CV/algorithms preferred.
- Mark anything unverifiable with "(unverified)" rather than asserting.
- If a question's literature is genuinely silent, say so explicitly and
  recommend an empirical spike rather than fabricating an answer.
```
