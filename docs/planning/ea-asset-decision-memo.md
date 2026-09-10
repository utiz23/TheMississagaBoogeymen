# EA Asset Product-Impact Decision Memo — E2C4

**Purpose.** Product/engineering decision support for the three EA-sourced
visual-asset families covered by E2C3. **This is not legal advice, does not
clear any asset, and does not change any E2C3 legal classification.** It
translates E2C3's unresolved-rights findings into concrete implementation
options, their costs, and an engineering recommendation. The final choice per
family is an operator decision, not one this memo makes.

**Date:** 2026-09-09. **Method:** repository analysis only (code, assets,
tests, docs, `git log`). No internet research was performed in this session;
E2C3's legal findings are treated as fixed inputs. No database, host,
Cloudflare, Proton, GitHub, or other external system was accessed. No asset,
code, test, configuration, or dependency was modified.

**Families in scope, and their E2C3 classification (unchanged by this memo):**

1. **The 84 NHL 26 X-Factor PNGs** — `NOT ADDRESSED / AMBIGUOUS → legal review
   required; replacement candidate.`
2. **EA base opponent crests** — `CONDITIONALLY SUPPORTED AT BEST, on
   unverified premises → legal review required; replacement candidate.`
3. **Custom opponent crests** — `CONDITIONAL / FACTUAL NATURE UNRESOLVED →
   legal review required; replacement candidate.`

**No family is treated as cleared by this memo.** Retaining any of them
pending legal review is a legitimate option below, not a shortcut.

---

## 1. X-Factor artwork — verified repository facts

- **File count:** exactly **84** PNGs under
  `apps/web/public/assets/x-factors/`, in **28** per-ability subfolders (3
  tier-colour variants each: Red/Elite, Blue/All Star, Gold/Specialist).
  Confirmed by direct `find`/`du`. **Disk footprint: 71 MB.**
- **A second, complete copy exists** at `docs/branding/icons/x-factors/` —
  also 84 files, also 71 MB. `diff -qr apps/web/public/assets/x-factors
  docs/branding/icons/x-factors` confirms the two trees are **byte-for-byte
  identical by path and content**. `docs/branding/README.md` does not
  mention this directory, and it has **no application, worker, or OCR
  runtime-code dependency** — `grep` confirms no `.ts`, `.tsx`, `.py`, or
  `.sh` file references it. It is, however, **actively referenced by two
  tracked Markdown documents**: `research/OCR-SS/apx.md` (28 inline `<img>`
  references, one per ability) and `research/OCR-SS/Manual OCR benchmark
  match 463.md` (28 inline `<img>` references) — **56 inline documentation
  images total**, each pointing at a file under this tree. This is a
  runtime-code-unused duplicate, not an unreferenced one: repository storage
  is approximately **142 MB across both copies** (§1.1 and §4 below separate
  this repository-storage figure from the Docker web-image footprint, which
  only includes the primary 71 MB tree — see the Dockerfile evidence there).
- **Exactly one production visual consumer:** `XFactorTiles` in
  `apps/web/src/components/matches/lineup/lineup-row.tsx`, which calls
  `xFactorIconUrl()` from `apps/web/src/lib/xfactor-asset.ts` to build
  `/assets/x-factors/<Name>/NHL_26_<Name>_X-Factor_Image__<Red|Blue|Gold>__File.png`
  and renders it via `next/image`. No other `.tsx` file references the
  `x-factors` asset path or `xfactor-asset.ts`.
- **A neutral fallback is implemented in current source**, in the same
  component: when `xFactorIconUrl()` returns `null` (X-Factor known but
  tier missing), `XFactorTiles` renders a small tier-coloured dot
  (`xfTierColor()`, keyed off the same Elite=red/All Star=blue/
  Specialist=gold mapping the PNGs encode) inside an `aria-label`/`title`
  span carrying the X-Factor's display name and tier. **This is a real
  existing code path in the repository, not a hypothetical — but this
  session did not runtime-test or deployment-verify it.**
- **A second, separate, non-decorative consumer of the same pixel data
  exists outside the website:** `tools/game_ocr/game_ocr/xfactor_icon_matcher.py`
  loads all 84 PNGs from `apps/web/public/assets/x-factors/`
  (`_TEMPLATE_DIR`) as OpenCV template-matching references, to identify
  which X-Factor ability icon appears in a loadout-screen video capture
  during OCR ingestion. It is wired into
  `tools/game_ocr/game_ocr/parsers.py` and
  `tools/game_ocr/game_ocr/loadout_extractors/icon.py`, with dedicated tests
  (`tools/game_ocr/tests/test_xfactor_icon_matcher.py`,
  `tools/video_ingest/tests/test_loadout_icon.py`) and is referenced as a
  reusable component in `docs/ocr/xfactor-effects-extraction-plan.md`. **This
  is an active part of the separate video-ingestion OCR pipeline, not dead
  code** (confirmed via `git log` — added in a dedicated feature commit,
  imported by two other modules, covered by tests). If the template
  directory is missing, `_load_templates()` raises at runtime.
- **The Node worker's text pipeline is independent of the artwork; the
  video-ingestion OCR pipeline is not — this is a distinction, not a single
  claim.** `apps/worker/src/lib/normalize-xfactor.ts` (the Node worker's
  OCR-string → canonical-name normalizer, used by the EA-API ingestion path),
  its database storage, and `apps/worker/src/backfill-xfactor-canonical-cli.ts`
  hardcode their own `XFACTOR_CANONICAL_NAMES` string array and touch only
  the database — none of them read the PNG directory, list files, or
  otherwise depend on the artwork existing. By contrast, the repository's
  separate video-ingestion OCR icon-matching path
  (`tools/game_ocr/game_ocr/xfactor_icon_matcher.py`, detailed below) **is
  not independent of the artwork** and would fail to load its templates if
  the configured directory disappeared. Repository inspection confirms how
  this code is currently wired and tested; **this session did not verify
  whether or when the OCR icon-matching path actually runs in deployed or
  production operations.**
- **Database storage is text-only.** `packages/db/src/schema/player-loadout.ts`
  (`player_loadout_x_factors`) stores `x_factor_name` (verbatim OCR string),
  `x_factor_name_canonical` (text), and `tier` (text enum `Elite | All Star |
  Specialist`, guarded by `isXFactorTier`/`coerceXFactorTier` in
  `packages/db/src/schema/player-loadout.ts` and covered by
  `packages/db/src/schema/x-factor-tier.test.ts`). No image bytes, file
  paths, or asset references are stored. `ea_member_season_stats.xfactor_zone_used`
  is an unrelated gameplay counter (X-Factor Zone ability uses), not artwork.
- **Textual presentation of X-Factor data does not depend on the artwork
  either:** `apps/web/src/components/roster/loadout-history-strip.tsx` renders
  `xf.xFactorName` as plain text; `apps/web/src/components/roster/club-stats-tabs.tsx`
  and `apps/web/src/components/matches/lineup/lineup-footer.tsx` render the
  `xfactorZoneUsed` counter as a number. Neither imports `xfactor-asset.ts`.
- **Tests:** `apps/web/src/lib/xfactor-asset.test.ts` (5 unit tests, covers
  `xFactorIconUrl`/`isXFactorTier`, asserts exact PNG-path strings) is the
  only test file that would need editing. `packages/db/src/schema/x-factor-tier.test.ts`
  and the OCR-side `test_xfactor_icon_matcher.py`/`test_xfactor_effects_spike.py`
  are unaffected by a *web-display* change and would only need attention if
  the OCR template *source location* changed.
- **Documentation:** `docs/ocr/xfactor-effects-extraction-plan.md` documents
  `apps/web/public/assets/x-factors/` as the reusable OCR template source —
  this doc would need a note if templates relocate.
  `scripts/scrape_ea_xfactor_pngs.sh` (the original acquisition script) would
  become historical/orphaned under any removal option — it is not called by
  any other script or CI step today (confirmed by grep; nothing invokes it
  automatically).

### 1.1 Options — X-Factor artwork

**Option 1: Retain pending legal review**

- User-facing surfaces affected: none (status quo).
- Information retained/lost: all retained (nothing changes).
- Visual/product-quality cost: none.
- Accessibility: unchanged (existing `alt`/`title` text already present).
- Storage/build/performance: **repository footprint** is approximately
  142 MB if both the primary 71 MB `apps/web/public/assets/x-factors/` tree
  and the 71 MB `docs/branding/icons/x-factors/` duplicate are retained.
  **Web Docker-image footprint is a smaller, separate figure:**
  `apps/web/Dockerfile`'s `COPY apps/web/ apps/web/` copies only the primary
  71 MB tree into the build/image (`next start` then serves it statically);
  the Dockerfile does not copy `docs/branding/`, so the documentation
  duplicate increases repository/storage footprint but **not** the web
  Docker-image footprint.
- External runtime dependency: none — these are same-origin static files,
  not proxied from EA at request time.
- Maintenance burden: none beyond current.
- Implementation files: none touched.
- Tests: none touched.
- DB/ingestion changes: none.
- Reversibility: N/A (no change made).
- Remaining legal-review dependency: full — E2C3's `NOT ADDRESSED /
  AMBIGUOUS` classification stands untouched, exposure is unchanged.

**Option 2: Remove the artwork, preserve underlying factual/text data**

- User-facing surfaces affected: `lineup-row.tsx`'s `XFactorTiles` only —
  every X-Factor slot would render the tier-coloured dot fallback instead of
  the branded PNG. This is an **existing styled fallback branch already
  implemented in current source** (available without designing a new
  fallback), for the specific case of missing tier data; this session did
  not runtime-test or deployment-verify how often that branch currently
  executes.
- Information retained: canonical name, tier, OCR string, `title`/
  `aria-label` text, all database rows, all OCR normalization behavior
  (`normalize-xfactor.ts` is untouched by this option). Information lost:
  the branded icon glyph on the web UI only.
- Visual/product-quality cost: moderate — loses the branded diamond icon
  look on the lineup row; the dot fallback is deliberately minimal (see
  `xfTierColor()` comment: "used only when an X-Factor has no canonical
  icon").
- Accessibility: unchanged or slightly improved — the fallback path already
  carries `title`/`aria-label` text; removing the `<Image>` branch removes
  an `alt`-text image in favour of a labelled `<span>`, which is at least as
  accessible.
- Storage/build/performance: removes the 71 MB `apps/web/public/assets/x-factors/`
  tree from the web build/image if the OCR template directory is relocated
  first (see below); otherwise the files must stay on disk somewhere for
  the OCR matcher, just not under `apps/web/public/`.
- External runtime dependency: none either way (these were never
  externally fetched at request time).
- Maintenance burden: lower (one less asset family to carry
  attribution/licence risk for on the *website*).
- **Critical implementation dependency not obvious from the web code
  alone:** `tools/game_ocr/game_ocr/xfactor_icon_matcher.py` reads its
  templates from `apps/web/public/assets/x-factors/`. Deleting that
  directory outright would break OCR ingestion's X-Factor icon matching.
  A correct Option 2 implementation must **relocate** the 84 template PNGs
  to a non-public path outside `apps/web/public/` (e.g. under
  `tools/game_ocr/` itself) and update `_TEMPLATE_DIR` in
  `xfactor_icon_matcher.py` accordingly, *before* removing them from the
  public web tree. This decouples "served to website visitors" (the E2C3
  concern) from "used as local OCR analysis input" (a different, narrower
  use this memo does not attempt to legally characterize).
- Likely implementation files: `apps/web/src/lib/xfactor-asset.ts` (remove
  or short-circuit `xFactorIconUrl`), `apps/web/src/components/matches/lineup/lineup-row.tsx`
  (drop the `<Image>` branch, keep the dot), `tools/game_ocr/game_ocr/xfactor_icon_matcher.py`
  (`_TEMPLATE_DIR` update), relocation of the 84 template files,
  `docs/ocr/xfactor-effects-extraction-plan.md` (update the stated template
  location), and `scripts/scrape_ea_xfactor_pngs.sh` (mark historical or
  remove). **Removing `docs/branding/icons/x-factors/` has zero application/
  OCR runtime dependency, but deleting it without updating
  `research/OCR-SS/apx.md` and `research/OCR-SS/Manual OCR benchmark match
  463.md` (56 inline `<img>` references combined) would break those inline
  documentation images.** Its removal is operationally independent of the
  website/OCR code changes above, but requires an explicit documentation
  choice, not made in this memo: repoint the 56 references to the relocated
  OCR template tree, retain a suitable documentation-only asset set, replace
  the images with something else, or intentionally remove the inline images.
  Neither referencing Markdown document is edited by this memo.
- Tests needing updates: `apps/web/src/lib/xfactor-asset.test.ts` (the two
  tests asserting exact PNG-path strings would need to change or be
  removed); `tools/game_ocr/tests/test_xfactor_icon_matcher.py` would need
  its fixture/template path updated to match the relocation, not deleted.
- DB/ingestion changes required: **none.** `normalize-xfactor.ts`, the
  `player_loadout_x_factors` schema, and the backfill CLI are all
  independent of file location.
- Reversibility: high — files can be restored from git history; no
  destructive schema change.
- Remaining legal-review dependency: removes exposure for the *displayed*
  artwork; does not resolve whether locally retaining and using the EA PNGs
  as OCR template data is itself a use requiring review (a narrower,
  separate question this memo flags but does not answer).

**Option 3: Replace with an operator-created neutral visual treatment**

- User-facing surfaces affected: same single surface (`XFactorTiles`), but
  instead of falling back to the existing dot, a newly designed neutral
  badge/initial/geometric marker per tier would replace the PNG. **No such
  artwork is created in this session.**
- Information retained/lost: same as Option 2 for underlying data; visually,
  a purpose-built neutral badge could preserve more product polish than the
  bare dot fallback.
- Visual/product-quality cost: lower than Option 2 if well executed, but
  requires new design work (tier-coloured badges, initials, or geometric
  markers for 28 abilities or a single generic per-tier badge — the memo
  does not resolve which).
- Accessibility: can match or exceed current (`title`/`aria-label` already
  present; new art must preserve sufficient contrast, matching the site's
  "Design Direction" dark/high-contrast conventions in `CLAUDE.md`).
- Storage/build/performance: much smaller than 71 MB if a handful of
  original SVGs/badges replace 84 PNGs (a shared per-tier badge could be a
  single small asset; per-ability markers would still be far smaller than
  photographic PNGs).
- External runtime dependency: none.
- Maintenance burden: higher than Option 2 short-term (new asset creation,
  review, and testing); similar to Option 2 long-term once shipped.
- Implementation files: same as Option 2 plus new asset files and a new
  lookup/rendering helper in `xfactor-asset.ts`/`lineup-row.tsx`.
- Tests needing updates/adding: `xfactor-asset.test.ts` updated for new
  asset paths; new tests for whatever selection logic maps ability+tier to
  the new badge.
- DB/ingestion changes required: none (same as Option 2).
- Reversibility: high.
- Remaining legal-review dependency: eliminated for the *replaced* artwork
  itself (operator-created, no EA content); the OCR-template relocation
  question from Option 2 still applies if the EA-sourced templates are kept
  for OCR use.

---

## 2. Opponent crests — verified repository facts and data-flow trace

### 2.1 Full chain: ingestion → storage → URL construction → rendering

1. **EA API → worker ingestion.** `packages/ea-client/src/types.ts` types
   the EA `clubs/info` response's `customKit.crestAssetId` and
   `customKit.useBaseAsset` (both optional strings).
   `apps/worker/src/ingest-opponents.ts` reads
   `clubData.customKit?.crestAssetId ?? null` and
   `clubData.customKit?.useBaseAsset ?? null` and upserts them into the
   `opponent_clubs` table on each new-opponent discovery.
2. **Database storage.** `packages/db/src/schema/opponent-clubs.ts` defines
   `opponent_clubs.crest_asset_id` (text, nullable) and
   `opponent_clubs.use_base_asset` (text, nullable — `"1"` or `"0"`/absent).
   **No image bytes or URLs are stored** — only EA's opaque asset-ID string
   and the base/custom flag. A separate `accentHex` column (7-char hex,
   optionally manually set) drives crest-ring/marker theming and is
   independent of the crest image pixels.
3. **URL construction.** `apps/web/src/lib/format.ts` → `opponentCrestUrls(crestAssetId, useBaseAsset)`
   builds two candidate URLs:
   `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t<id>.png`
   (base) and
   `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/<id>.png`
   (custom), ordered base-first when `useBaseAsset === '1'`, custom-first
   otherwise. Returns `[]` when `crestAssetId` is falsy.
4. **Rendering + retry + fallback.** `apps/web/src/components/ui/opponent-crest.tsx`
   (`OpponentCrest`, a client component) takes the two candidate URLs, tries
   the preferred one via `next/image`, and on `onError` (e.g. a 404 for a
   dirty/stale EA asset ID) advances to the alternate URL; once both are
   exhausted (or the list was empty because `crestAssetId` was null), it
   renders the caller-supplied `fallback` node instead.
5. **`next.config.ts`** declares two separate `images.remotePatterns` entries
   for `media.contentapi.ea.com`, one scoped to
   `/content/dam/eacom/nhl/pro-clubs/custom-crests/**` and one to
   `/content/dam/eacom/nhl/pro-clubs/crests/**` — **the two crest families
   already have independent Next.js image-optimization authorizations.**

### 2.2 Every production rendering surface (verified exhaustive by grep)

`OpponentCrest` is imported in exactly four files, and no other file builds
a crest `<Image>` directly from `opponentCrestUrls()`:

| Surface | File | Fallback content |
| --- | --- | --- |
| Recent-result score card | `apps/web/src/components/matches/score-card.tsx` | 2-letter club abbreviation (`abbreviateTeamName`) |
| Game-detail lineup module | `apps/web/src/components/matches/lineup/lineup-module.tsx` | 2-letter abbreviation |
| Game-detail hero card | `apps/web/src/components/matches/hero-card.tsx` | 2-letter abbreviation |
| Home-page latest result | `apps/web/src/components/home/latest-result.tsx` | 2-letter abbreviation |

**All four already pass a `fallback` prop, and all four already use the same
`abbreviateTeamName()`-derived 2-letter monogram, independently
implemented per surface but visually consistent in pattern.** This is a real
existing fallback branch, implemented in current source, for whenever
`crestAssetId` is null or both CDN URLs fail — not a hypothetical, but this
session did not runtime-test or deployment-verify how often it currently
executes.
`abbreviateTeamName()` itself (`apps/web/src/lib/format.ts`) is
crest-independent (pure string logic) and is separately used by seven other
match components (`game-top-bar.tsx`, `box-score.tsx`, `top-performers.tsx`,
`dtw-gauge.tsx`, `action-tracker/index.tsx`, `event-timeline.tsx`, plus the
`games/[id]/page.tsx` header) that display the opponent name/abbreviation as
text only and never render crest artwork.

### 2.3 Separability of base vs. custom crests

**Both families can be disabled independently and reliably from repository
facts alone, at two possible layers:**

- **URL-construction layer (`opponentCrestUrls()` in `format.ts`).** The
  function already branches on `useBaseAsset` to decide ordering; it can be
  changed to omit one family's URL from the returned array entirely (e.g.
  never include the `custom-crests` URL), which flows through unchanged to
  `OpponentCrest`'s existing retry/fallback logic — no component changes
  needed. This is the more reliable point of control, because it changes
  what is ever *requested*, not just what is *permitted*.
- **`next.config.ts` `images.remotePatterns` layer.** The two path patterns
  are already independent entries; removing one blocks Next.js from
  optimizing/serving URLs under that path. This alone is a coarser, less
  graceful control — a URL that fails `remotePatterns` validation surfaces
  as a `next/image` configuration error rather than the existing
  `onError`-driven graceful fallback, so this layer should be a
  belt-and-suspenders addition, not the primary mechanism.

Either family can therefore be turned off without touching the other, using
only facts already established in the codebase; no `next/image` behavior for
the *retained* family changes.

### 2.4 Tests

**No test file currently covers `opponentCrestUrls()` or `OpponentCrest`**
(confirmed by repository-wide search — no `*.test.*` file references either
symbol). Any of the three options below would be adding new test coverage,
not updating existing tests, for the crest URL/render logic specifically.

### 2.5 Options — opponent crests (base and custom evaluated together, noting where they diverge)

**Option 1: Retain pending legal review**

- User-facing surfaces affected: none (status quo, all four surfaces
  unchanged).
- Information retained/lost: all retained.
- Visual/product-quality cost: none.
- Accessibility: unchanged.
- Storage/build/performance: no local storage cost (crests are remote-fetched,
  not bundled); the `next/image` optimizer's default fetch/resize/cache
  behavior for these two remote paths continues (E2C3's unresolved
  `next/image` legal-characterization question, U8, is unaffected either
  way by this memo).
- External runtime dependency: **the site continues to depend on
  `media.contentapi.ea.com` at request time** for both families — an EA
  CDN outage or path change degrades to the existing monogram fallback
  automatically, but the dependency itself remains.
- Maintenance burden: none beyond current.
- Implementation files: none touched.
- Tests: none added.
- DB/ingestion changes: none.
- Reversibility: N/A.
- Remaining legal-review dependency: full, for both families, at their
  existing distinct E2C3 classifications.

**Option 2: Remove the artwork, preserve underlying factual/text data**

- User-facing surfaces affected: the same four surfaces, each of which
  **already has an existing styled fallback branch implemented in current
  source** (available without designing a new fallback) — removing crest
  rendering means every opponent crest slot shows the existing 2-letter
  monogram instead. No new UI states are introduced.
- Information retained: `crest_asset_id`, `use_base_asset`, `accentHex`,
  opponent name, and all match/DB history — nothing here is image data, so
  nothing factual is lost. Information lost: the crest graphic on the web
  UI.
- Visual/product-quality cost: moderate — every score card, hero card,
  lineup module, and home-page result loses a graphical crest in favour of
  text initials. This is the site's most visually prominent EA-sourced
  asset family; the cost is real, but the fallback is a styled, per-surface
  treatment in current source (not a placeholder box) — available without
  designing a new fallback, though this session did not runtime-test or
  deployment-verify it.
- Accessibility: unchanged or improved (text-based monogram vs. an image
  with `alt` text — comparable, arguably more robust against slow/broken
  image loads).
- Storage/build/performance: removes the external image fetch entirely for
  every game view (fewer `next/image` optimizer invocations, fewer
  external requests, no CDN-outage-driven layout shift while retries run).
- External runtime dependency: **eliminated** — no request to
  `media.contentapi.ea.com` is made at all for the disabled family/families.
- Maintenance burden: lower (no CDN-path drift to track, no retry-logic
  edge cases to debug).
- Likely implementation files: `apps/web/src/lib/format.ts`
  (`opponentCrestUrls()` returns `[]` for the disabled family or entirely),
  optionally `apps/web/next.config.ts` (remove the corresponding
  `remotePatterns` entry as a defense-in-depth measure once no code path
  can produce that URL), no changes needed to the four calling components
  (they already render `fallback` correctly) or to
  `apps/worker/src/ingest-opponents.ts` or the schema.
- Tests needing updates/adding: new tests for `opponentCrestUrls()` (none
  exist today) asserting the disabled family is never returned; no existing
  test to break.
- DB/ingestion changes required: **none.** Ingestion continues storing
  `crest_asset_id`/`use_base_asset` for provenance/history even if the web
  layer stops constructing URLs from them — this preserves the option to
  re-enable display later without re-ingesting anything.
- Reversibility: very high — a one-line revert in `opponentCrestUrls()`
  restores prior behavior; no data was deleted.
- Remaining legal-review dependency: removes exposure for the disabled
  family/families; if only one family is disabled, the other's E2C3
  classification and legal-review dependency stand unchanged.

**Option 3: Replace with an operator-created neutral visual treatment**

- User-facing surfaces affected: same four surfaces; instead of the plain
  2-letter monogram already used as `fallback`, a new original club-marker
  treatment (e.g. a generated geometric badge keyed off `accentHex` or the
  club abbreviation) could replace the *default* rendering, not just the
  error-path fallback.
- Information retained/lost: same as Option 2 — no factual data lost either
  way.
- Visual/product-quality cost: potentially lower than Option 2's plain
  monogram if a distinctive original marker is designed, but this requires
  new design/engineering work not done in this session.
- Accessibility: can match or exceed current, same considerations as
  Option 2.
- Storage/build/performance: a small original asset (SVG/generated) is
  cheaper than the current external fetch, similar to Option 2's benefit.
- External runtime dependency: eliminated, same as Option 2.
- Maintenance burden: higher up front (new component/asset), similar
  long-term to Option 2.
- Implementation files: `apps/web/src/lib/format.ts`,
  `apps/web/src/components/ui/opponent-crest.tsx` (or a new sibling
  component), the four calling surfaces would swap their `fallback` content
  for the new treatment (or the new treatment becomes the primary render
  path, making `OpponentCrest` itself unnecessary for the disabled
  family).
- Tests needing updates/adding: new tests for whatever selection/generation
  logic is added.
- DB/ingestion changes required: none (same as Option 2) — `accentHex` is
  already available if the new marker wants to use it.
- Reversibility: high.
- Remaining legal-review dependency: eliminated for the replaced family's
  *displayed* artwork.

---

## 3. Cross-family question: one shared neutral crest fallback?

**Yes — a single shared neutral-crest treatment could serve both the base
and custom crest families**, because:

- Both families are consumed through the exact same component
  (`OpponentCrest`) and the exact same fallback contract (a `fallback`
  React node, already implemented identically — a monogram span — at all
  four call sites).
- The distinguishing EA metadata (`useBaseAsset`) only affects *which CDN
  URL is tried first*, not how the fallback renders. Once crest URL
  construction is disabled (Option 2) or replaced (Option 3), there is no
  remaining reason for base and custom crests to have visually distinct
  fallback treatment — the operator-facing distinction was "which EA asset,
  if any, does this club use," not "what should render when there is no
  crest."
- This does **not** mean the two families must share the same *legal*
  disposition — `opponentCrestUrls()` can still be changed to disable only
  one family (§2.3) if the operator wants to retain one pending legal
  review while replacing the other. The shared-fallback question is purely
  a rendering-layer simplification available regardless of which
  combination of retain/remove/replace is chosen per family.

---

## 4. Recommendation

**This section is engineering judgment aimed at minimizing unresolved
rights exposure while preserving site functionality. It is not a legal
opinion and does not authorize any change.**

- **X-Factor PNGs — leading removal/replacement candidate.** Of the three
  families, this one has the weakest E2C3 position (`NOT ADDRESSED /
  AMBIGUOUS`, standalone marketing artwork copied and rehosted as an asset
  library — the reading E2C3 treats as least supported) and the smallest
  functional footprint on the website (one component, one helper module,
  one test file). A neutral fallback is implemented in current source
  today (not runtime-tested or deployment-verified in this session).
  **Recommended: Option 2 (remove from the public web path) as
  the immediate candidate, with the OCR-template relocation
  (`xfactor_icon_matcher.py`) done first so the video-ingestion OCR path is
  unaffected — note this is distinct from the Node worker's ingestion, which
  was already independent of the artwork (§1).**
  Option 3 (purpose-built neutral badges) is a reasonable later
  enhancement, not a prerequisite — the existing tier-dot fallback branch
  in current source is an acceptable interim state.
- **Custom opponent crests — the other leading removal/replacement
  candidate.** E2C3 could not determine whether these are UGC or
  EA-rendered-from-EA-components, and either reading carries its own
  unresolved exposure (§4 item 4 and LR-6 of the research memo). Disabling
  just this family via `opponentCrestUrls()` (§2.3) is a small, isolated
  change with an existing, per-surface-styled fallback already implemented
  in current source at all four surfaces.
- **EA base crests — the closest call, not cleared.** These sit closest to
  "game content" under S1's own terms and are the only family E2C3 found
  no basis to treat as more exposed than the others; the recommendation is
  to treat retention pending legal review (Option 1) as defensible *for
  this family specifically*, while flagging that a single `opponentCrestUrls()`
  change makes disabling it later (or in the same session as the custom
  crest change) equally cheap if the operator prefers a uniform posture
  instead of a split one.
- **One shared neutral fallback could replace both crest families** if the
  operator chooses to disable both (§3) — this does not require deciding
  the base-crest question first; the fallback code path is identical
  either way.
- **Smallest reversible implementation sequence, if the operator approves
  any removal:**
  1. Relocate the 84 X-Factor template PNGs out of `apps/web/public/` to a
     non-public path consumed by `xfactor_icon_matcher.py`; update
     `_TEMPLATE_DIR` and the one test that pins the old location; verify
     OCR tests still pass.
  2. Decide the fate of `docs/branding/icons/x-factors/` (the 71 MB,
     runtime-code-unused, but documentation-referenced duplicate — 56 inline
     images across `research/OCR-SS/apx.md` and `research/OCR-SS/Manual OCR
     benchmark match 463.md`). Removing it has zero application/OCR runtime
     dependency and is operationally independent of every other decision in
     this memo, but requires first repointing, retaining, replacing, or
     intentionally dropping those 56 references — it is not a
     drop-in deletion.
  3. Change `xFactorIconUrl()`/`XFactorTiles` to always use the existing
     dot fallback; update `xfactor-asset.test.ts`.
  4. Change `opponentCrestUrls()` to stop returning URLs for whichever
     crest family(ies) the operator chooses to disable; no component
     changes required; add the currently-missing unit tests for this
     function.
  5. (Optional, defense-in-depth) Remove the corresponding
     `next.config.ts` `remotePatterns` entry once no code path can produce
     that URL.
  Each step is independently revertible and does not depend on the others
  completing.
- **Immediate pre-publication work vs. optional later enhancement:**
  removing/disabling display (Option 2, per family, per the sequence above)
  is the pre-publication-relevant work if the operator wants to reduce
  exposure before Gate 2/3 launch. Designing original replacement artwork
  (Option 3) is optional polish that can follow publication on its own
  timeline, since Option 2's fallbacks are existing, per-surface-styled
  branches already implemented in current source, not bare placeholders.
- **The final choice per family — retain / remove / replace, and whether to
  treat both crest families uniformly or split them — is left explicit and
  open to the operator.** This memo does not select one.

---

## 5. Unresolved operator inputs (not resolved by assumption)

- **Monetization posture (E2C3 U10).** The research memo records that "E2A
  decision 4 records a personal/noncommercial reuse posture but no
  monetization audit has been performed," and lists as unresolved: "Does
  this project have or plan any monetization beyond passive banner ads?"
  This remains **unanswered** — this memo does not assume an answer, and it
  bears on every family's Option 1 (retain) analysis under S1's
  commercial-use exception.
- Whether the operator wants a **uniform posture** across both crest
  families (both retained, both disabled) or a **split posture** (e.g.
  disable custom crests only, retain base crests pending review).
- Whether **Option 2 or Option 3** is preferred for the X-Factor family —
  use the existing dot fallback branch already implemented in current
  source now, or hold for purpose-built neutral badges before changing
  anything.
- Whether to remove `docs/branding/icons/x-factors/` independently and
  immediately (it has zero application/OCR runtime dependency, so removal
  is operationally independent of every other decision in this memo) or
  bundle it with the X-Factor relocation work — and, either way, **which
  documentation choice to make first** for the 56 inline references in
  `research/OCR-SS/apx.md` and `research/OCR-SS/Manual OCR benchmark match
  463.md`: repoint them to the relocated OCR template tree, retain a
  suitable documentation asset set, replace the images, or intentionally
  remove them.
- Whether `scripts/scrape_ea_xfactor_pngs.sh` should be deleted, archived,
  or left as historical record once (if) the artwork it produced is
  relocated/removed.

---

## 6. What this memo does not do

It does not modify, delete, rename, recolour, or generate any asset; does
not modify application code, tests, configuration, dependencies, or
scripts; does not conduct additional legal or internet research; does not
access any external account or service; does not reopen or test the
tunnel; does not draft the Privacy Policy, Data Collection Policy, Terms of
Use, or attribution/non-affiliation notice; does not change any E2C3 legal
classification; does not treat replacement as legally required or
retention as legally cleared; and does not check any Gate 2 checkbox. The
Sony, Microsoft, SVG Repo, Twemoji, and font asset families from E2C2 remain
separate, untouched, and unresolved. Disabling Cloudflare Web Analytics
(E2B3 decision 1) remains separate and undone. E2 remains **IN PROGRESS**.
