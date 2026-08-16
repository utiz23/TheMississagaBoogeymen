# Dirty Website Workstream Audit — 2026-08-16

**Type:** source-read-only audit. No source, formatting, database, container, deployment,
or migration changes were made. No dirty/untracked file was modified.

**Baseline:** HEAD `a97ce87c655e9ce7145653837f18df5c7b1eba9c`. Migration 0056 applied. Web/worker
period-family code and the worker `/health` fix are deployed. The dirty website changes
audited here were never deployed and are not part of that baseline.

---

## 1. Verdict per workstream

| Workstream | Verdict | One-line reason |
| --- | --- | --- |
| A — 3s lineup shaping/re-keying | **PASS** | Correct, well-reasoned, thoroughly tested. No defects found. Minor lint-only issues. |
| B — OCR coverage pills | **BLOCKED** | The `periods` stream query uses the legacy whole-row `review_status`, which migration 0056 explicitly retired as an authorization signal and which worker code (`review-cascade.ts`) now advances independently of. The pill can misreport coverage on any match reviewed after 0056. Must not ship as-is. |
| C — Box-score/visual polish | **PASS** | Two small, low-risk, self-contained Tailwind class tweaks. No functional risk. |
| D — Documentation/archive | **PASS** | Coherent doc-reorg + model-naming-policy update + two content-preserving file relocations (SVG identical apart from a normalized final newline; games report body byte-identical past its new header block). No content loss found. |

---

## 2. File-to-workstream ownership

| File | Workstream | Notes |
| --- | --- | --- |
| `apps/web/src/lib/lineup-shape.ts` | A | New. Core ladder/re-key logic. |
| `apps/web/src/lib/lineup-shape.test.ts` | A | New. 19 unit tests, all passing. |
| `apps/web/src/app/games/[id]/page.tsx` | A | Wires `ladderFor` + `rekeyLineupToLadder` into the page. |
| `apps/web/src/components/matches/lineup/lineup-module.tsx` | A | Ladder made a prop instead of a hardcoded 6-slot constant. |
| `apps/web/src/components/matches/lineup/lineup-row.tsx` | A (98%) + C (1 line) | Type re-export for A; the `border-b` vs `border-b-border-subtle` specificity fix on the same line-range is workstream C bleeding into an A file (see §3). |
| `apps/web/src/lib/match-recap.ts` | A | `buildLineupFromStats` gains a `gameMode` param for the box-score fallback path. |
| `apps/web/src/lib/position-colors.ts` | A | Adds neutral `wing`/`W` alongside existing `defenseMen`/`D`. |
| `apps/web/src/app/globals.css` | A | One new CSS var, `--pos-w`. |
| `apps/web/src/lib/ocr-coverage.ts` | B | New. Presentation-tier logic (tier from stream count, pill styling). Correct and well-tested. |
| `apps/web/src/lib/ocr-coverage.test.ts` | B | New. Tests only the presentation tier — see §6. |
| `apps/web/src/components/ui/ocr-pill.tsx` | B | New. Pill component. |
| `packages/db/src/queries/ocr-coverage.ts` | B | New. **Contains the confirmed defect — §5.** |
| `packages/db/src/queries/index.ts` | B | One-line barrel export for the new query. |
| `apps/web/src/app/games/page.tsx` | B (functional) + noise (unrelated) | The coverage wiring (`getOcrCoverageForMatches` call + fail-soft `.catch`) is B. The `DEV_MATCH_IDS` array reformatting (one-item-per-line) is pure prettier/editor churn unrelated to any workstream — see §3. |
| `apps/web/src/components/matches/score-card.tsx` | B | `ocrCoverage` prop + `<OcrPill>` render, optional and additive. |
| `apps/web/src/components/matches/box-score.tsx` | C | Header cell font-size (10px→12px) and color (`fg-3`→`fg-4`) only. Unrelated to A/B. |
| `AGENTS.md` | D | Codex-as-manager model-naming policy (Claude 5 family). |
| `docs/operations/agent-manager-workflow.md` | D | Same model-naming policy, applied to the manager-agent doc. Consistent with `AGENTS.md`. |
| `HANDOFF.md` | D | Net rewrite: 2,497 lines removed / 313 added. Consolidates completed/superseded entries (worker `/health` fix, 97-window rescue reconciliation) and trims stale content. Read-verified as containing accurate references to already-deployed `a97ce87`/`540777a` work; explicitly notes the rest of the dirty tree (this audit's subject) as untouched drift. |
| `docs/README.md` | D | Index reorganization by purpose; adds links for previously-unlisted directories (`branding/`, `research/`, `reviews/`, `retrospectives/`, `runbook/`, `archive/`, etc.). |
| `Asset 1.svg` (deleted) → `docs/branding/rink-event-map/faceoff-pin-reference.svg` (new) | D | SVG/XML content is identical (431→432 bytes); the sole difference is a normalized final newline added to the destination. Diffed against the HEAD blob directly. |
| `polish list games.md` (deleted) → `docs/reviews/games-list-polish-scout-2026-07-04.md` (new) | D | Body is byte-identical to the HEAD blob starting at destination line 8, after a new 7-line header/status block. |
| `docs/archive/handoff-history-2026-08-03.md` | D | New. Historical handoff snapshot, referenced by the new `HANDOFF.md`. |
| `docs/calibration/live-schema-drift-audit-2026-08-15.md` | D | New. Record of already-completed schema-drift investigation. |
| `docs/calibration/rescue-non-faceoff-exclusion-audit-2026-08-15.md` | D | New. Record of already-completed rescue audit. |
| `docs/calibration/rescue-non-faceoff-resimulation-2026-08-15.md` | D | New. Record of already-completed resimulation. |
| `docs/operations/deploy-540777a-period-family-2026-08-15.md` | D | New. Deploy record for already-deployed `540777a`. Per instructions, not treated as dirty *website* work. |
| `docs/operations/deploy-a97ce87-worker-health-2026-08-16.md` | D | New. Deploy record for already-deployed `a97ce87` (the current baseline). Not treated as dirty website work. |
| `docs/operations/migration-0056-application-2026-08-15.md` | D | New. Record of the already-applied migration 0056. |
| `docs/reviews/games-list-polish-scout-2026-07-04.md` | D | New (relocation target — see above). Its findings are cross-checked against current code in §7. |

---

## 3. Files spanning more than one workstream, and how to split them

**`apps/web/src/components/matches/lineup/lineup-row.tsx`** — mixes A and C on adjacent lines:
- A: the `LineupPositionKey` type is now re-exported from `lineup-shape.ts` instead of declared locally (lines ~19–23 of the diff).
- C: the same hunk that touches `rowClass` also fixes a real specificity bug — `border-border-subtle` (all four sides) collided with the row's own `border-l` accent color at equal specificity, resolved only by Tailwind's emission order. The fix pins it to `border-b-border-subtle` (bottom only). This fix is functionally unrelated to the ladder work; it happens to sit in the same template string because that's where `border-b` already lived.
- **Split:** commit the type re-export with the rest of workstream A. Commit the `border-b` → `border-b-border-subtle` one-line class change with workstream C (it stands alone; nothing else in the hunk depends on it).

**`apps/web/src/app/games/page.tsx`** — mixes B and pure noise:
- B: the `getOcrCoverageForMatches` import, the fail-soft `.catch()` call, and the `ocrCoverage={ocrCoverage.get(match.id)}` prop wire-up.
- Noise: `DEV_MATCH_IDS` was reformatted from packed comma-separated rows to one-array-item-per-line. This is a pure formatting change (likely an editor/prettier pass or manual edit) with zero functional effect, sitting in the same file as the B change for no logical reason.
- **Split:** commit the coverage wiring under B. Either fold the `DEV_MATCH_IDS` reformat into workstream D's docs-only "chore" pass (if the user wants it retained) or drop it — it is not part of any of the four named workstreams and does not need to ship with B.

No other file mixes workstreams; `score-card.tsx`, `box-score.tsx`, `match-recap.ts`, `position-colors.ts`, `globals.css`, `ocr-coverage.ts` (both copies), `ocr-pill.tsx`, `lineup-shape.ts`, `lineup-module.tsx`, and `[id]/page.tsx` are each cleanly single-workstream.

---

## 4. Functional summary of each workstream

### A — 3s lineup shaping/re-keying

New module `lineup-shape.ts` gives the lineup module a mode-aware ladder: 6s keeps the existing
`C/LW/RW/LD/RD/G` six-slot ladder untouched (`rekeyLineupToLadder` is a literal passthrough,
verified by reference-equality test), while 3s gets a new four-slot `C/W/D/G` ladder.

The reason for the rewrite: on 3s matches, the pre-game lobby OCR parser snaps row positions to
six fixed y-coordinates tuned for a 6s lobby. A 3s lobby only has three real rows, so OCR reports
values in the bottom three (fabricated) rows anyway — in practice, opposing-team players leaked
in from the neighboring panel (documented, concrete example: match 466's BGM `LD` and `G` slots
held two actual opponents). The fix re-keys every OCR loadout row onto the ladder by resolving it
against the authoritative EA stat row for the same match/side, in two tiers:
1. **Identity match** (BGM: `player.id`, then normalized gamertag; opponent: normalized gamertag
   only) — the row's slot comes from EA's own position field, not the OCR label.
2. **Lobby-label fallback**, used only when identity match fails (documented cause: OCR spelling
   drift, e.g. `Slick Sl0th` → `SlickSIoth`) — falls back to the row's own OCR position label,
   restricted to the three labels (`C`/`LW`/`RW`) an actual 3s lobby can produce. `LD`/`RD`/`G`
   are excluded from the fallback map entirely, because in a 3-row lobby those labels are always
   fabricated.

Duplicate resolution: tier 1 always outranks tier 2 for the same slot; within a tier, the row
with more loadout detail (build, jersey #, X-Factors, attributes, name, height) wins, and the
result is independent of input order (asserted both directions in tests).

Unknown/null `gameMode` falls back to the 6s ladder (documented rationale: an unclassified game
type is more likely 6s, and a 6-slot ladder degrades to extra CPU rows rather than silently
dropping real skaters).

### B — OCR coverage pills

New `getOcrCoverageForMatches(matchIds)` batches three index-backed `DISTINCT` scans (loadouts,
periods, events) across a page of matches in one round trip, returning a per-match
`{loadouts, periods, events}` boolean triple. A presentation layer
(`apps/web/src/lib/ocr-coverage.ts`) turns the stream count into a tier (`full`/`partial`/
`minimal`/`none`) and a color/label; `none` renders no pill. Wired into the games list via
`score-card.tsx`, fail-soft (`.catch(() => new Map())`) so a query failure only loses the
decorative pill, not the page.

### C — Box-score/visual polish

Two Tailwind class edits: box-score header cells go from 10px/`fg-3` to 12px/`fg-4` (larger,
higher-contrast); the lineup row's bottom border is pinned to `border-b-border-subtle` instead of
the all-sides `border-border-subtle`, removing a same-specificity collision with the row's own
left-border accent color (documented as "same defect class as the box score's TOT rule" — an
existing, already-committed fix elsewhere in `box-score.tsx` that this change mirrors).

### D — Documentation/archive

`HANDOFF.md` consolidation (removes ~2,500 lines of superseded/completed entries, keeps ~310 of
current state), a `docs/README.md` reorganization to reflect directories that already exist but
weren't indexed, a Claude-model-naming-policy update in `AGENTS.md` and
`agent-manager-workflow.md` (old `haiku`/`sonnet` names → `Sonnet 5`/`Opus 5`/`Fable 5`, with
effort-tier guidance), two content-preserving file relocations (`Asset 1.svg` →
`docs/branding/...faceoff-pin-reference.svg`, identical apart from a normalized final newline;
`polish list games.md` → `docs/reviews/games-list-polish-scout-2026-07-04.md`, body byte-identical
past its new header block), and several new operations/calibration
records documenting already-completed, already-deployed work (migration 0056 application, the
`540777a` and `a97ce87` deploys, two rescue-audit reports, a schema-drift audit).

---

## 5. Findings, ordered by severity

### HIGH — `packages/db/src/queries/ocr-coverage.ts` gates `periods` on the wrong column (confirmed, not hypothetical)

`getOcrCoverageForMatches`'s `periods` query (lines 55–64) is:

```ts
and(
  inArray(matchPeriodSummaries.matchId, matchIds),
  eq(matchPeriodSummaries.source, 'ocr'),
  eq(matchPeriodSummaries.reviewStatus, 'reviewed'),
)
```

Migration 0056 (`packages/db/migrations/0056_period_family_review_status.sql`) split
`match_period_summaries` review authorization into three independent per-family columns
(`goals_review_status`, `shots_review_status`, `faceoffs_review_status`) precisely because the
single row-level `review_status` was letting a goals-only verdict silently publish unreviewed
shots/faceoffs. The migration's own column comment states explicitly: *"review_status = 'reviewed'
alone exposes nothing... do not reintroduce it into any read-boundary authorization predicate."*
The committed `getMatchPeriodSummaries` (`packages/db/src/queries/match-enrichments.ts:74-124`)
follows that rule — it retains a row only if `source = 'ea'` OR at least one of the three family
columns is `'reviewed'`, and masks each stat pair independently.

The dirty `ocr-coverage.ts` query does not follow that rule — it checks the legacy `review_status`
directly, which is exactly the predicate the migration says to stop using.

This is not a theoretical drift risk: `apps/worker/src/lib/review-cascade.ts` (already deployed,
part of the `540777a`/`3038821` period-family commits) writes to the family columns independently
of the legacy column — `familyPatch()` (lines 247–258) returns a single-field patch
(`{ goalsReviewStatus: status }`, etc.) with no corresponding write to `reviewStatus`. Any match
reviewed through this cascade since migration 0056 landed will have family-column state that the
legacy `review_status` does not reflect, in either direction: the pill can read `periods: false`
for a match whose Goals family is genuinely reviewed and visible on the match page (under-count),
or `periods: true` for a match whose legacy status predates a family being rejected post-migration
(over-count, though this direction depends on whether rejection cascades also touch the legacy
column — not traced further here, see §11).

**Correct predicate** (mirrors `getMatchPeriodSummaries`'s row-retention logic, restricted to
`source = 'ocr'` since EA rows are out of scope for an *OCR* coverage pill):

```ts
and(
  inArray(matchPeriodSummaries.matchId, matchIds),
  eq(matchPeriodSummaries.source, 'ocr'),
  or(
    eq(matchPeriodSummaries.goalsReviewStatus, 'reviewed'),
    eq(matchPeriodSummaries.shotsReviewStatus, 'reviewed'),
    eq(matchPeriodSummaries.faceoffsReviewStatus, 'reviewed'),
  ),
)
```

By contrast, the `loadouts` query (no review gate at all) and the `events` query
(`source = 'ocr' AND reviewStatus = 'reviewed'`) were checked directly against their respective
committed authorities — `getMatchLineups` (`packages/db/src/queries/match-lineups.ts`, no
`reviewStatus` filter in its `WHERE` at all) and `getMatchEvents`
(`packages/db/src/queries/match-events.ts:106-115`, single-family whole-row gate, since
`match_events` was never split into families) — and both match exactly. **Only `periods` is
wrong.**

The module's own doc comment (`ocr-coverage.ts:27-30`) claims *"The `periods` and `events` gates
mirror `getMatchPeriodSummaries` and `getMatchEvents` exactly"* — that claim is false for
`periods` as written.

**Not fixed in this audit, per instructions.**

### MEDIUM — No test exercises the defective query, and the one B test file that exists cannot catch it

`apps/web/src/lib/ocr-coverage.test.ts` (7 tests, all passing) tests only
`ocrCoverageTier`/`getOcrCoverageStyle` — pure presentation functions with no database
involvement. There is no test at all for `packages/db/src/queries/ocr-coverage.ts`. Other DB query
modules in this package do have integration-style tests under `packages/db/src/queries/__tests__/`
(e.g. `match-lineups-cpu.test.ts`, `action-tracker-provenance.test.ts`) — the convention exists in
this codebase and was not applied here. A test built against a migration-0056-era fixture (a row
with `review_status = 'pending_review'` but `goals_review_status = 'reviewed'`) would have caught
the HIGH finding directly.

### LOW — Lint errors in the two new test files (mechanical, not correctness)

`apps/web/src/lib/lineup-shape.test.ts` and `apps/web/src/lib/ocr-coverage.test.ts` produce 26
`@typescript-eslint/no-floating-promises` errors, one per `test(...)` call — `node:test`'s `test()`
returns a `Promise`, and the repo's ESLint config flags every one as unhandled. This is exactly the
error class HANDOFF.md documents fixing on the worker `/health` test file (same rule, same pattern,
already-established fix: mark each call `void test(...)`). `lineup-shape.ts` also has one
`@typescript-eslint/prefer-optional-chain` error (line 212, `held && held.tier < tier`-style
checks). None of this is a correctness issue — `pnpm typecheck` is clean and all 26 runtime tests
pass — but it is new code failing lint in isolation, not pre-existing repo-wide lint drift, so it
does not fall under the project's "don't chase pre-existing red lint" convention.

### LOW — `OcrPill` accessibility is convention-consistent but minimal

The pill's only accessible text is a `title` attribute on a non-interactive `<span>`; the colored
dot is `aria-hidden`. `title` on a non-focusable element is inconsistently exposed by screen
readers (hover-only in most browsers, no keyboard path). This matches the existing bar for
metadata chips elsewhere on the card (e.g. the quality/mode pills use plain text with no
`aria-label` either), so it's consistent with current practice rather than a regression — flagged
as a pre-existing pattern the OCR pill inherits, not a new defect.

### INFORMATIONAL — One assumption in the 3s re-key is documented but not independently re-verified here

`lineup-shape.ts`'s module comment states the opponent-side leak "runs left, into BGM's empty
lower slots, never right" — i.e., an opponent OCR row is never itself misread as `LD`/`RD`/`G`.
The lobby fallback map (`LOBBY_TO_3S_SLOT`) is built on that assumption (it has no entries for
those three labels). The claim is stated as measured against the DB's 3s match corpus, and the
test suite encodes the *consequence* of the assumption (opponent rows never test with an `LD`
input), but this audit did not independently re-query the corpus to re-verify the claim itself.
If it ever turns out false, the failure mode is the same as the already-designed-for one — a
legitimate row silently drops rather than being misassigned — so the risk ceiling is low even if
the assumption is wrong.

---

## 6. Detailed review — workstream A (3s lineup shaping), against every requested criterion

- **6s vs 3s ladders correct:** Yes. `LADDER_6S` is the pre-existing six slots; `LADDER_3S` is
  `['C','W','D','G']`. 6s is a verified passthrough (reference-equality test).
- **BGM/opponent identity matching:** Correct and matches this project's established identity
  model (`ea_id`/blazeId absent, gamertag is the real anchor — consistent with the codebase's
  known player-identity constraints). BGM matches by `player.id` first (the resolved identity),
  falling back to normalized gamertag; opponent matches by normalized gamertag only, since
  opponent stat rows never carry a resolved player id — and a test explicitly proves the BGM
  id-map is never consulted on the opponent side (`'3s ignores a player id on the opponent side'`).
- **OCR fallback behavior:** Two-tier, correctly ordered (identity beats lobby-label), restricted
  to the three labels a 3s lobby can actually produce. Covered by a real, cited fixture (match
  618's `Slick Sl0th`/`SlickSIoth` OCR drift).
- **Duplicate-slot resolution:** Same player read into two rows (match 563 fixture) resolves to
  the richer row, order-independent (tested both orderings).
- **CPU/missing-player behavior:** Rows that can't be identity-matched AND don't carry an
  admissible lobby label are dropped, not fabricated into a wrong slot (tested: opponent-leak
  rows are excluded; a fully-empty side returns `[]`, not a throw).
- **Goalie behavior:** Generic — `dressed`/`goalieLabel` computation in `lineup-module.tsx` was
  already ladder-length-based, not hardcoded to 6, and a 3s human goalie (were EA ever to report
  one) is preserved by the identity tier (tested explicitly).
- **Unknown game-mode fallback:** `ladderFor(null)` → 6s, deliberately (documented rationale: safer
  degradation than a 4-slot ladder silently dropping real skaters). `rekeyLineupToLadder` treats
  `null` the same as 6s (passthrough).
- **W/D neutral positions:** Correctly modeled as genuinely neutral — no L/R claim is made for
  either source, since the two sources (lobby OCR calls the row `RW`; EA calls it `defenseMen`)
  disagree and neither is overridden. Color fallback (`--pos-w` → `--pos-lw`) and
  `position-colors.ts` (`wing`/`W` key) are consistent with the pre-existing `defenseMen`/`D`
  neutral-fallback pattern already used for 6s box-score defense.
- **Test coverage vs. measured production cases:** Fixtures are drawn from real matches (466, 563,
  618) with cited row-level specifics, not synthetic placeholders. 19 tests cover both ladder
  selection and every branch of the re-key (identity hit, fallback hit, both-miss-drop, dedup both
  orderings, ladder-order output, empty-input, no-EA-rows).
- **Can it drop or misassign a legitimate player?** No defect found. The only drop path is rows
  that fail both identity match and the (deliberately narrow) lobby-label fallback — which, per
  the documented lobby geometry, are rows that were never real in the first place. No path was
  found where a genuinely-present player is discarded or assigned to another player's slot.

---

## 7. Detailed review — workstream B (OCR coverage), against every requested criterion

- **Exact meaning of loadouts/periods/events:** `loadouts` = any loadout snapshot exists for the
  match (no review gate — matches `getMatchLineups`). `periods` = intended to mean "reviewed OCR
  per-period box-score rows exist," but as written means "row-level legacy status is `reviewed`,"
  which is a different (and, going forward, increasingly wrong) thing — see §5 HIGH finding.
  `events` = reviewed OCR action-tracker events exist (correct, matches `getMatchEvents`).
- **Consistency with what the match-detail page actually publishes:** `loadouts` and `events` are
  verified consistent with their respective committed query authorities. `periods` is not — it can
  disagree with what `getMatchPeriodSummaries` actually returns to the match page in both
  directions (§5).
- **Query batching and indexes:** Three `DISTINCT` scans batched across the whole page (one round
  trip, not per-card) — appropriate. All three underlying tables have a `matchId` (or
  `match_id`) index (`match_period_summaries_match_idx`, `player_loadout_snapshots_match_idx`,
  `match_events_match_idx`), so the `inArray(matchId, ...)` filter is index-backed. At this
  project's scale (self-hosted, handful of users) this is more rigor than strictly necessary but
  not wasteful.
- **Fail-soft behavior:** Correct — `getOcrCoverageForMatches(...).catch(() => new Map())` in
  `games/page.tsx` means a coverage-query failure loses only the decorative pill, never the page.
- **Accessibility and pill semantics:** See §5 LOW finding — minimal but consistent with existing
  card-chip conventions.
- **Test coverage:** See §5 MEDIUM finding — the existing test file cannot and does not exercise
  the defective code path.

---

## 8. Migration-0056 compatibility findings

| Query | Predicate as written | Compatible with 0056? |
| --- | --- | --- |
| `getMatchPeriodSummaries` (committed) | Per-family (`goalsReviewStatus`/`shotsReviewStatus`/`faceoffsReviewStatus`), `source='ea'` bypass | Yes — this is the migration's own reference implementation |
| `getMatchEvents` (committed) | Single-family whole-row `reviewStatus`, `source` branch | Yes — `match_events` was never split into families; whole-row is correct for it |
| `getMatchLineups` (committed) | No review-status filter at all | Yes — loadouts were never gated on review status |
| `getOcrCoverageForMatches` `loadouts` query (dirty) | No review-status filter | **Yes** — matches `getMatchLineups` |
| `getOcrCoverageForMatches` `periods` query (dirty) | Legacy whole-row `reviewStatus` | **No** — the exact anti-pattern migration 0056's column comment warns against |
| `getOcrCoverageForMatches` `events` query (dirty) | `source='ocr' AND reviewStatus='reviewed'` | **Yes** — matches `getMatchEvents`'s ocr branch exactly |

---

## 9. Test and verification results

All run read-only; nothing was written except normal build output
(`packages/db/dist/`, already gitignored — confirmed the working tree is unchanged, §10).

- `pnpm --filter @eanhl/db build` — **clean.**
- `pnpm --filter @eanhl/db typecheck` — **clean.**
- `pnpm --filter web typecheck` — **clean.**
- `node --test apps/web/src/lib/lineup-shape.test.ts apps/web/src/lib/ocr-coverage.test.ts` —
  **26/26 pass, 0 fail.**
- Focused `eslint` on every dirty/new web file — **27 errors**, all in the two new test files
  (26× `no-floating-promises`) plus one `prefer-optional-chain` in `lineup-shape.ts` (§5 LOW). No
  errors in any non-test file.
- Focused `eslint` on `packages/db/src/queries/ocr-coverage.ts` + `index.ts` — **clean.**
- `git diff --check` (tracked changes) — **clean, no whitespace errors.**
- Untracked new files checked by hand for trailing whitespace / missing final newline — **all
  clean.**
- Repo-wide `pnpm lint` was intentionally **not** run — per this project's known state, it is
  pre-existing red repo-wide from eslint config drift unrelated to this work; focused lint above is
  the correct signal.

---

## 10. Repository verification

- `git status --short` captured before any work and re-captured after all reads, the `db` build,
  typecheck, lint, and test runs — **byte-identical**, diffed programmatically, confirmed matching.
- The only new path on disk is this report,
  `docs/reviews/dirty-website-workstream-audit-2026-08-16.md`.
- `git diff --check` on all tracked dirty files — clean (§9).
- All pre-existing dirty/untracked files are unmodified — proven by the identical `git status`
  snapshot (a modified or re-typed file would change `git status`'s hash-based dirty detection).
- No commit, push, stash, reset, checkout, or cleanup command was run at any point.

---

## 11. Recommended commit boundaries

1. **`feat(web): mode-aware 3s lineup ladder and re-key`** (workstream A)
   `apps/web/src/lib/lineup-shape.ts`, `apps/web/src/lib/lineup-shape.test.ts`,
   `apps/web/src/app/games/[id]/page.tsx`, `apps/web/src/components/matches/lineup/lineup-module.tsx`,
   `apps/web/src/components/matches/lineup/lineup-row.tsx` (type re-export hunk only, not the
   `border-b` hunk), `apps/web/src/lib/match-recap.ts`, `apps/web/src/lib/position-colors.ts`,
   `apps/web/src/app/globals.css`.
   Blocked on: fixing the 26 `no-floating-promises` + 1 `prefer-optional-chain` lint errors in
   `lineup-shape.test.ts` first (mechanical, `void test(...)` pattern already established in this
   repo).

2. **`fix(db,web): OCR coverage pill — periods stream + tests`** (workstream B) — **do not commit
   until the HIGH finding in §5 is fixed.** When ready:
   `packages/db/src/queries/ocr-coverage.ts` (with the corrected predicate),
   `packages/db/src/queries/index.ts`, `apps/web/src/lib/ocr-coverage.ts`,
   `apps/web/src/lib/ocr-coverage.test.ts` (plus a new DB-level test exercising the family-column
   predicate), `apps/web/src/components/ui/ocr-pill.tsx`, `apps/web/src/components/matches/score-card.tsx`,
   `apps/web/src/app/games/page.tsx` (coverage-wiring hunk only, not the `DEV_MATCH_IDS` reformat).
   Also fix the `lineup-shape.test.ts`-class lint errors in `ocr-coverage.test.ts`.

3. **`fix(web): box-score header contrast + lineup row border specificity`** (workstream C)
   `apps/web/src/components/matches/box-score.tsx`, plus the `border-b-border-subtle` hunk of
   `apps/web/src/components/matches/lineup/lineup-row.tsx`.

4. **`docs: reorganize docs index, update model-naming policy, consolidate handoff`** (workstream D)
   `AGENTS.md`, `docs/operations/agent-manager-workflow.md`, `docs/README.md`, `HANDOFF.md`,
   `Asset 1.svg` deletion + `docs/branding/rink-event-map/faceoff-pin-reference.svg` addition,
   `polish list games.md` deletion + `docs/reviews/games-list-polish-scout-2026-07-04.md` addition,
   plus the new `docs/archive/`, `docs/calibration/`, `docs/operations/deploy-*`,
   `docs/operations/migration-0056-application-2026-08-15.md` records. This can ship as one
   docs-only commit or be split further by the user's preference (e.g. the two file relocations
   are independent of the naming-policy update) — none of it has a functional dependency on A/B/C.

**Decision point, not this audit's call:** the `DEV_MATCH_IDS` reformat in `games/page.tsx` — drop
it (revert to the prior packed formatting) or fold it into a standalone formatting commit. It
carries no functional content either way.

---

## 12. Recommended implementation order

1. **B first, and only the fix** — this is the one workstream with a confirmed correctness defect
   and the one most likely to actively worsen (every new per-family review committed by
   `review-cascade.ts` increases the gap between legacy `review_status` and reality). Fix the
   predicate, add a DB-level regression test keyed to a migration-0056-shaped fixture (family
   reviewed, legacy status still pending — and the reverse), then commit.
2. **A** — no known defects; ship once the mechanical lint fix is applied. Independent of B.
3. **C** — trivial, independent, can ship any time; bundling with A's `lineup-row.tsx` commit or
   its own is a style choice.
4. **D** — no code dependency on A/B/C; can go first, last, or interleaved. Recommended last only
   so `HANDOFF.md` can be updated once at the end reflecting A/B/C's actual landed state, per this
   project's own handoff-timing convention (update at natural stopping points, not mid-task).

---

## 13. The single next implementation session

**Session 2 (Implement), scoped to workstream B only:** fix the `periods` predicate in
`packages/db/src/queries/ocr-coverage.ts` per §5's corrected query, add a DB-integration test
under `packages/db/src/queries/__tests__/` that plants a row with `review_status='pending_review'`
and `goals_review_status='reviewed'` and asserts the pill sees it as covered (and the inverse case),
fix the `no-floating-promises` lint errors in both new test files while touching them, then run
`pnpm --filter @eanhl/db build && pnpm --filter @eanhl/db typecheck && pnpm --filter web typecheck`
plus the two test files. Do not touch A, C, or D in this session — they have no dependency on this
fix and mixing them back in would violate the one-task-per-session default this project already
uses.

---

## 14. Files that must not be combined in one commit

- `apps/web/src/components/matches/lineup/lineup-row.tsx`'s two hunks (A's type re-export vs. C's
  `border-b-border-subtle` fix) belong in different commits — see §3.
- `apps/web/src/app/games/page.tsx`'s coverage-wiring hunk (B) must not be combined with its
  `DEV_MATCH_IDS` reformat hunk (unrelated noise) — see §3.
- `packages/db/src/queries/ocr-coverage.ts` must not be committed with the `periods` predicate
  unfixed, under any commit message — it is the confirmed HIGH-severity defect.
- Do not fold any of the `docs/operations/deploy-*` or `docs/calibration/*` records (workstream D)
  into an A/B/C commit — they document unrelated, already-deployed worker/rescue work and would
  make an A/B/C commit's diff misleading about its own scope.

---

## 15. Remaining unknowns

- Whether a family-level *rejection* in `review-cascade.ts` also ever touches the legacy
  `review_status` column (which would determine whether the HIGH finding's over-count direction is
  live today or only under-count is) — not traced in this audit; the fix in §5 is correct
  regardless of the answer, since it stops consulting the legacy column entirely.
- Whether any production match today actually has divergent family vs. legacy status (i.e.,
  whether the HIGH finding has already produced a visibly wrong pill, or is purely forward risk) —
  would require a live-DB query, out of scope for a source-read-only audit.
- The opponent-side "leak always runs left, never right" assumption in `lineup-shape.ts` (§5
  INFORMATIONAL) was checked for internal consistency (code + tests + comments agree) but not
  independently re-verified against the full match corpus.
- Whether the user wants the `DEV_MATCH_IDS` reformat kept, reverted, or shipped as its own
  formatting commit (§3, §11) — a preference call, not a correctness question.
