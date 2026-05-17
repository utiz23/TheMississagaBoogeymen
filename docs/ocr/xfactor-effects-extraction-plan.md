# X-Factor Effects Extraction Plan

Date: 2026-05-16

## Goal

Extract the X-Factor effect tables from the screenshots in [`tools/game_ocr/ScreenShots/xfactor-effects/`](../../tools/game_ocr/ScreenShots/xfactor-effects/) (gitignored — present locally), normalize them into structured data, and produce a durable source of truth for:

- X-Factor canonical name
- category tab (`Skating/Strength`, `Shooting/Passing`, `Puck Skills`, `Body/Stick Checking`, `Goaltending`)
- description text
- per-tier metric labels
- per-tier metric values

The output should be good enough to drive UI copy, tooltips, comparisons, and future OCR validation.

## What the screenshots actually contain

The captured layout is a scrollable comparison table with stable columns:

- left column: X-Factor name + description
- three fixed tier columns: `Specialist`, `All-Star`, `Elite`
- inside each tier column:
  - icon
  - one to three metric labels
  - one to three green metric values

The nine screenshots appear to span multiple tabs, not just one scroll. Confirmed examples:

- `Skating/Strength`
- `Goaltending`

## Existing repo assets to reuse

Do not start from zero. Reuse what already exists:

- [`tools/game_ocr/game_ocr/xfactor_icon_matcher.py`](/home/michal/projects/eanhl-team-website/tools/game_ocr/game_ocr/xfactor_icon_matcher.py)
  - canonical icon template library
  - reliable X-Factor name matching from the icon glyph
- [`apps/worker/src/lib/normalize-xfactor.ts`](/home/michal/projects/eanhl-team-website/apps/worker/src/lib/normalize-xfactor.ts)
  - canonical name set and normalization rules
- `apps/web/public/assets/x-factors/`
  - canonical icon assets for all abilities and tiers

These remove the hardest naming problem. The new work is table extraction and normalization, not name discovery.

## Recommended output shape

Phase 1 should target a checked-in JSON artifact, not DB writes.

Suggested file:

- `docs/ocr/data/xfactor-effects.nhl26.json`

Suggested shape:

```json
[
  {
    "canonicalName": "Wheels",
    "category": "Skating/Strength",
    "description": [
      "Turn on the jets and blow past opponents after hitting top speed with increased Speed and Acceleration."
    ],
    "tiers": {
      "Specialist": [
        { "metric": "Speed", "value": "+3%", "duration": "0.50 sec", "raw": "+3% (0.50 sec)" },
        {
          "metric": "Acceleration",
          "value": "+3%",
          "duration": "0.50 sec",
          "raw": "+3% (0.50 sec)"
        }
      ],
      "All Star": [
        { "metric": "Speed", "value": "+3%", "duration": "1 sec", "raw": "+3% (1 sec)" },
        { "metric": "Acceleration", "value": "+5%", "duration": "1 sec", "raw": "+5% (1 sec)" }
      ],
      "Elite": [
        { "metric": "Speed", "value": "+3%", "duration": "2 sec", "raw": "+3% (2 sec)" },
        { "metric": "Acceleration", "value": "+8%", "duration": "2 sec", "raw": "+8% (2 sec)" }
      ]
    },
    "sourceScreenshots": ["Screenshot 2026-05-16 21-57-38.png"]
  }
]
```

Keep both parsed fields and raw strings. You will need the raw text for auditing and correction.

## Implementation plan

### Phase 0: Ground truth inventory

Build a manual index first.

- Enumerate every screenshot and assign:
  - active category tab
  - visible highlighted row, if any
  - visible X-Factor names in order
- Produce a simple worksheet:
  - `screenshot`
  - `category`
  - `xfactor_names_visible[]`

Why:

- the screenshots are a scroll set, so abilities will overlap across adjacent captures
- you need this index to deduplicate and stitch rows
- without it, you will waste time debugging extraction errors that are really merge errors

Deliverable:

- `docs/ocr/data/xfactor-effects-screenshot-index.json`

### Phase 1: One-off extraction spike on 2-3 rows

Do not try to solve the whole dataset first.

Pick 3 representative rows:

- one with durations in parentheses, like `Wheels`
- one with plain percentages, like `Second Wind`
- one with negative values and three metrics, like `Recharge`

Build a Python spike script under:

- `tools/game_ocr/scripts/extract_xfactor_effects_spike.py`

The spike should:

1. crop a single row from a screenshot
2. detect left-name block
3. detect three tier blocks
4. OCR:
   - name
   - description
   - metric labels
   - green values
5. emit a JSON record for that row

Success criterion:

- row-level extraction works on the three chosen examples with only small cleanup rules

### Phase 2: Stable row segmentation

After the spike works, generalize row detection.

Preferred strategy:

- use horizontal separators and repeated vertical geometry, not free-form text search

Expected row anatomy:

- left-aligned name heading
- description block below
- three tier icon+text clusters aligned horizontally

Detection plan:

1. identify the table header baseline (`X-FACTORS`, `SPECIALIST`, `ALL-STAR`, `ELITE`)
2. identify row start positions from:
   - highlighted row background bands when present
   - large uppercase left-column headings
   - repeated icon centroids in each tier column
3. derive row bounding boxes

Do not rely on highlight state. Only one row is highlighted per screenshot.

### Phase 3: Canonical name resolution

Use a two-stage approach:

1. primary: icon match with `xfactor_icon_matcher.py`
2. fallback: OCR text normalized through existing canonical-name rules

Reason:

- OCR on stylized X-Factor names will be noisy
- the icon matcher already solves the hard canonicalization problem

For each row, persist:

- `canonicalName`
- `ocrNameRaw`
- `iconMatchConfidence`
- `nameResolutionMethod`

Reject low-confidence rows instead of guessing silently.

### Phase 4: Metric label/value extraction

Treat labels and values as separate OCR problems.

For each tier cell:

- crop label stack
- crop green value stack independently

Why:

- labels are gray/white uppercase text
- values are bright green and easier to isolate with color masking
- combining them in one OCR pass will create line-order errors

Recommended parsing rules:

- labels:
  - uppercase normalize
  - collapse repeated whitespace
  - split into stacked metric names by line
- values:
  - preserve sign
  - preserve `%`
  - parse optional duration suffix in parentheses
  - allow negative values like `-75%`

Expected parser output per value line:

- `raw`
- `numericValue`
- `unit`
- `durationText | null`

### Phase 5: Screenshot stitching and dedup

The same X-Factor will appear in overlapping screenshots while scrolling.

Merge key:

- `category + canonicalName`

Merge policy:

- keep the version with:
  - more non-null fields
  - higher OCR confidence
  - more complete tier coverage
- union `sourceScreenshots`
- preserve raw variants for audit

Reject any merge that disagrees on:

- canonical name
- number of metrics within the same tier
- sign of a parsed numeric effect

Those are review items, not auto-merge items.

### Phase 6: Manual verification pass

Do not skip this. The dataset is small enough to verify.

Build a review table with columns:

- category
- canonical name
- tier
- metric label
- extracted raw value
- parsed numeric value
- screenshot reference

Then manually compare against the screenshots.

Success criteria:

- 100% of visible rows extracted
- 0 unresolved canonical names
- 0 tier-column swaps
- 0 missing negative signs
- 0 silent merge conflicts

### Phase 7: Promote from artifact to reusable source

Only after the JSON artifact is verified:

Option A: use it as a static app data source

- simplest
- enough for UI/tooltips/content work

Option B: add a small DB table if querying/versioning matters

Suggested schema if needed later:

- `game_title_id`
- `canonical_name`
- `category`
- `tier`
- `metric_key`
- `metric_label`
- `raw_value`
- `numeric_value`
- `unit`
- `duration_text`
- `description_lines_json`
- unique index on `(game_title_id, canonical_name, tier, metric_key)`

Do not start with DB unless there is an immediate consumer for it.

## Technical approach

### OCR strategy

Use classical OCR plus simple vision rules first.

- OpenCV for:
  - row segmentation
  - color masking for green values
  - template matching for icons
- existing RapidOCR path for:
  - names
  - descriptions
  - metric labels
  - masked green values

Do not use an LLM/VLM extraction pass as the primary pipeline. The dataset is structured and small; deterministic extraction is better.

### Likely preprocessing

- grayscale / contrast boost for descriptions
- white-text threshold for labels
- green HSV mask for values
- upscale narrow crops before OCR
- line grouping by Y coordinate

### Expected hard cases

- durations in parentheses: `+3% (0.50 sec)`
- multiline descriptions
- multiline metric labels: `SAVE ABILITY (EACH SAVE)`
- negative effect values
- row overlap across screenshots
- OCR confusion in `ALL-STAR` / `SPECIALIST` value columns if crop widths are sloppy

## File plan

Recommended files:

- `tools/game_ocr/scripts/extract_xfactor_effects_spike.py`
- `tools/game_ocr/scripts/extract_xfactor_effects.py`
- `docs/ocr/data/xfactor-effects-screenshot-index.json`
- `docs/ocr/data/xfactor-effects.nhl26.json`
- `tools/game_ocr/tests/test_xfactor_effects_parser.py`

## Test plan

Add narrow tests, not fake end-to-end theater.

1. parser unit tests
   - value string parsing
   - duration parsing
   - negative value parsing
   - multiline label normalization
2. merge tests
   - duplicate row consolidation
   - conflict detection
3. golden tests
   - 2-3 fixed crops from the screenshot set
   - expected JSON output checked in

## Suggested order of execution

1. Build screenshot index
2. Implement row extraction spike on 3 sample rows
3. Lock parser rules for metric values
4. Add canonical-name resolution through icon matcher
5. Generalize to full screenshot set
6. Merge and dedup rows
7. Manual verification
8. Publish verified JSON artifact
9. Only then decide whether to wire it into app/DB

## Non-goals for the first pass

- extracting every UI element on the page
- building a generalized OCR screen type in the main pipeline
- DB migrations before the dataset is verified
- cross-title support beyond the current NHL 26 screenshot set

## Blunt recommendation

Do not overengineer this into the main OCR ingestion pipeline yet.

This is a small, finite, static screenshot corpus. The correct first move is:

1. extract it into a verified JSON artifact
2. prove the parser on this corpus
3. only then decide whether it deserves first-class pipeline support

Trying to make it “generic” before the first clean extraction is how this turns into a mess.
