# OCR Improvement Report — Small, Efficient ML

Updated: 2026-06-13

## Executive Summary

Yes, small efficient machine learning is the right direction here.

Not giant end-to-end AI. Not a monolithic video VLM. Not a full detector-training detour unless the UI layout starts moving around more than it already does.

The repo already points to the right pattern:

- small screen classifiers,
- closed-vocabulary specialists,
- typed deterministic parsers,
- benchmark-driven tuning,
- and targeted labeling instead of huge annotation campaigns.

The blunt recommendation is:

1. keep the current pipeline shape,
2. improve the weak stages with small specialist models,
3. add better labels and calibration before adding bigger models,
4. do not replace the whole stack with a giant model.

## Current OCR Failure Types

From the current code and handoff trail, the main failure classes are:

- screen misclassification,
- sparse labels for some important classes,
- brittle hard gates and thresholds,
- OCR digit/label confusion on some post-game screens,
- weak pre-game lobby/loadout parsing,
- wrong-frame/wrong-segment capture defects,
- and over-reliance on a single OCR string when uncertainty should be preserved longer.

That matters because the fixes are different:

- some problems want better labels,
- some want better scoring/calibration,
- some want small classifiers,
- some want parser changes,
- and some are not OCR problems at all.

## What Small Efficient ML Should Mean Here

For this project, “small efficient ML” should mean:

- logistic regression or linear classifiers on engineered features,
- tiny closed-vocabulary image classifiers,
- score calibration layers,
- nearest-prototype or few-prototype class models,
- lightweight active-labeling loops,
- and maybe one or two tiny ROI specialists where deterministic parsing is still too brittle.

That already matches parts of the repo:

- the screen classifier is intentionally logistic regression, not a CNN, in [screen_classifier.py](/home/michal/projects/eanhl-team-website/tools/game_ocr/game_ocr/screen_classifier.py)
- closed-vocab LR heads already exist and are tested in [test_closed_vocab_lr_head.py](/home/michal/projects/eanhl-team-website/tools/game_ocr/tests/test_closed_vocab_lr_head.py)

So the question is not “should we use ML at all?” The answer is already yes. The real question is where to use a bit more of it efficiently.

## Recommended Improvements

### 1. Improve The Screen Classifier With Better Labels First

This is still the highest-ROI move.

Why:

- the pipeline depends on Pass 1 being right,
- sparse labels still exist for important WoC/lobby classes,
- the proving bench already exists,
- and classifier mistakes poison everything downstream.

What to do:

- run the targeted labeling round already captured in `HANDOFF.md`,
- increase extraction density for sub-second screens,
- keep using Label Studio or equivalent,
- expand the proving bench only where it closes known gaps.

This is not glamorous, but it is the cheapest way to buy real accuracy.

### 2. Replace Hard OCR Gates With Scored, Calibrated Decisions

The repo research is right on this: hard yes/no anchor gates are too brittle.

Better approach:

- combine visual score, OCR anchor similarity, OCR confidence, token count, and temporal context into a score,
- tune the threshold on a labeled validation set,
- bias toward recall where false negatives are costly.

This is classic small ML:

- one-dimensional logistic calibration,
- or a tiny logistic regression over a handful of features.

That is cheap, fast, explainable, and much more defensible than hand-tuning literal substring gates forever.

### 3. Expand Small Closed-Vocabulary Specialists

This is one of the best uses of ML in this repo.

You already have the pattern:

- constrained vocab,
- small crop,
- simple feature extractor,
- logistic regression head,
- thresholded candidates.

Good targets for more of this:

- build classes,
- X-Factor names,
- X-Factor tiers,
- platform badges,
- position tokens when OCR is noisy,
- possibly some recurring post-game tab/header labels.

Why this works:

- the vocab is finite,
- confusion sets are known,
- training data needs are modest,
- inference cost is trivial.

This is much better ROI than trying to make generic OCR magically perfect on every stylized token.

### 4. Use Multi-Prototype Class Models Before Bigger Networks

Some screen classes are visually multimodal. A single centroid or overly compressed representation can be too crude.

Before training CNNs, try:

- multiple prototypes per class,
- nearest-of-K similarity,
- per-class `K` chosen on validation data.

This is a cheap extension of the current classifier logic, still explainable, and a lot safer than jumping into a heavier learned encoder too early.

### 5. Add Tiny ROI-Level Specialists Where Parsing Still Fails

For a few narrow cases, a small image classifier will beat OCR plus regex.

Potential candidates:

- X-Factor tier badge recognition,
- simple icon/marker states,
- some title/header crops where stylized fonts break OCR,
- loadout title/build-class crops,
- maybe period-label normalization on very constrained crops.

These should be tiny specialists, not general-purpose object detectors.

The rule should be:

- if the field is closed-set and the crop is stable, a small classifier is worth trying;
- if the field is long open text, stay with OCR plus downstream normalization.

### 6. Preserve Uncertainty Longer

Right now some failure comes from collapsing OCR to one string too early.

Better:

- keep top-N candidates for closed-vocab reads,
- keep confidence,
- let downstream structure decide when possible,
- reject or flag low-margin cases instead of overcommitting.

This is not “bigger ML.” It is just a better abstraction.

For this codebase, that likely means:

- richer candidate lists from closed-vocab heads,
- more structured evidence in `ocr_field_evidence`,
- and fewer brittle parser decisions based on one lossy string.

### 7. Use Active Learning, Not Broad Random Labeling

If you want ML gains without wasting operator time, label the hard stuff.

Best candidates to surface:

- disagreement between visual and OCR signals,
- near-threshold classifications,
- frames that cause downstream missing fields,
- classes with poor proving-bench coverage,
- recurrent confusion pairs.

That is how you keep the labeling budget small while still improving the model.

## Where Small ML Will Help Most

Highest ROI:

- screen classification,
- closed-vocab recognition,
- calibration of acceptance thresholds,
- class disambiguation for WoC/lobby/loadout states.

Medium ROI:

- stylized short-text crops,
- X-Factor tier recognition,
- ROI-specific badge/icon recognition.

Low ROI right now:

- full object detection with bounding boxes,
- monolithic OCR-free screen-to-JSON models,
- giant CNN/video models,
- general gameplay understanding.

## What I Would Not Recommend Right Now

### 1. A Giant End-To-End VLM

Bad fit.

Reasons:

- expensive,
- hard to calibrate,
- hard to benchmark at field level,
- operationally unstable,
- overkill for a narrow UI extraction problem.

### 2. Full Bounding-Box Annotation As The Main Workstream

Wrong bottleneck right now.

The bigger issue is taxonomy, labels, thresholds, and some crop-level recognition, not generic detection.

### 3. Full CNN Retraining For Everything

Too early.

You do not have the dataset size or the justification yet. The current repo structure is much better suited to small specialists and calibrated structured extraction.

### 4. Replacing Deterministic Parsers Everywhere

Also wrong.

When the layout is stable and the field semantics are known, deterministic parsing is still the right backbone. ML should support it, not erase it.

## Practical Roadmap

### Phase 1 — Cheap Wins

- run the targeted labeling round for sparse classes,
- expand the proving bench where it is obviously thin,
- add scored gate calibration instead of hard anchor rules,
- measure per-class precision/recall on a frozen eval set.

### Phase 2 — Small Specialists

- add or improve closed-vocab LR heads for the worst recurring finite-vocab fields,
- add a tiny specialist for X-Factor tier recognition,
- test multi-prototype class representations for visually multimodal screens.

### Phase 3 — Structure And Confidence

- preserve top-N candidate hypotheses longer,
- thread confidence and margins through the evidence layer,
- make downstream promoters use confidence-aware logic instead of all-or-nothing reads.

### Phase 4 — Only If Still Needed

- add one or two tiny CNN-style ROI specialists if LR/prototype models plateau,
- consider detector-style labeling only if ROI instability becomes the real bottleneck.

## Expected Payoff

If done in that order, small efficient ML should help:

- make Pass 1 screen classification more reliable,
- reduce false negatives on short-lived and ambiguous screens,
- improve closed-vocab field reads without needing perfect OCR,
- reduce brittle parser failures,
- and give you cleaner confidence-aware evidence for downstream validation.

The biggest improvement will not come from one clever model. It will come from:

- better labels,
- better calibration,
- a few narrow specialists,
- and refusing to use giant models where a 132-feature LR head already does the job.

## Bottom Line

Yes, use small efficient machine learning.

Use it surgically:

- better screen classifier calibration,
- more closed-vocab specialists,
- multi-prototype class handling,
- active labeling,
- confidence-aware evidence.

Do not waste time on:

- big end-to-end models,
- broad box-annotation campaigns,
- or replacing deterministic extraction with “AI magic.”

That is the practical path that fits this repo, this dataset size, and the problems you actually have.
