# Phase 2B → Phase 3 Deferred Items

Phase 2B shipped a 1 → 3 fps bump for `player_loadout_view` segments to recover
JoeyFlopfish and ThickOoze, but several sampling-related improvements were
deliberately left for Phase 3. They're listed here so the next session can pick
them up with full context.

## Sampling architecture

### A. Navigation-event detection + best-of-window logic
At 3 fps we get 4-5 samples per ~1.5s subject window and rely on the bundle
assembler's fuzzy-gamertag dedup to collapse them. A smarter version would
detect navigation events (left-strip selection change) in the 1 fps coarse
stream and resample at high fps ONLY between detected events. Avoids the 3×
ingestion-cost overhead on segments where every subject was already captured at
1 fps. Requires: per-frame diff in the left-strip selection band; new
"navigation-event" object passed to Pass-2; per-window best-frame selection.

### B. Issue-triggered nearest-frame walking
When Pass-2 detects a "problem" frame (low gamertag confidence, X-Factor names
present but icon template-match below threshold, mid-transition gradient
detected), walk the source video frame-by-frame outward until the issue clears
or a 0.3s budget expires. Tight, targeted, cheap on good recordings. Requires:
source video access at Pass-2 time (currently Pass-2 only sees PNGs); explicit
issue detector per extractor family.

### D. Adaptive sampling rate
Drop loadout fps back to 1 when the operator isn't actively navigating (subject
stable across frames). Bump to 3-5 only during active navigation. Saves cost
on long static dwells (e.g., operator paused on one subject for 10 seconds).
Requires: motion / text-diff signal between consecutive frames.

## Extractor sophistication

### X-Factor icon-loading detection
Several frames in match 250 (operator-confirmed via screenshot) had X-Factor
names visible but icons still loading. Our current extractor either captures
both or neither — there's no "names found but icons not yet loaded; wait" path.
Add a per-frame check: if icon template-match score is below threshold AND
x_factor_name candidate has high confidence, mark the frame as transitional
and prefer a later frame in the same subject bundle.

### Transition / fade detection
Subject-change transitions in EA NHL UI have a brief crossfade. A 3 fps
sample landing mid-fade captures a half-rendered right pane. Add an HSV-delta
detector that scores frames "fade vs solid"; bundle assembler prefers solid.

## Screen-class scope

### READY-UP screen extractor
The pre-game "READY UP" lobby (both teams side-by-side, each player as a
4-line block: gamertag / build_class+position / h/w / level) is currently
mis-classified by the HMM as `player_loadout_view`. Our loadout-detail
extractor finds nothing useful there. Build a dedicated READY-UP extractor
that recognises the dual-column layout and emits identity + build_class +
h/w + level. NOTE: it does NOT replace the loadout-detail extractor —
X-Factors and attributes are still only in the detail view.

### HMM classifier — distinguish READY-UP from loadout-detail
With the dedicated extractor in place, the HMM state machine should
classify the two screens separately so we don't waste loadout-detail OCR
on READY-UP frames. Will need ~30-50 labeled READY-UP frames per game
version.

## Why deferred

Phase 2B's deliverable is the architecture redesign (evidence layer + typed
extractors + promotion gate + canonical-row write path). 3 fps sampling is
the minimum change that proves the redesign on full lineup data. The
sophistication above is engineering, not architecture — better suited to a
focused Phase 3 with its own design + test cycle.
