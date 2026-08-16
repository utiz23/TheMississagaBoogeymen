# Games List Polish Scout Report

**Scouted:** 2026-07-04

**Status:** Source report; consolidated findings live in
[`../POLISH_BACKLOG.md`](../POLISH_BACKLOG.md).

/games (Games List) — Polish Scout Report
Critical framing note: The games list renders ScoreCard (grid of cards), not MatchRow. MatchRow (apps/web/src/components/matches/match-row.tsx) is used only on /stats (apps/web/src/app/stats/page.tsx:348), so it is out of scope for this surface even though it was in the read list. All card findings below are against score-card.tsx.

⭐ Product-owner example item: "result + game mode + one derived quality stat as pills"
Current state of the top pill cluster (score-card.tsx:161-190):

Game-mode pill — score-card.tsx:163-169. Rendered only when match.gameMode !== null. gameMode is a nullable column (packages/db/src/schema/matches.ts:110; deriveGameMode returns null for unknown/absent EA codes), so any match with an unmapped game-type code shows no mode pill at all.
Private pill — score-card.tsx:170-176. Only when matchType === 'club_private'.
Derived quality pill ("Dominated" / "Outshot") — computed score-card.tsx:140-145, rendered 177-187. Only appears at the extremes (shot share ≥ 0.65 or ≤ 0.35, suppressed on DNF). For a typical competitive game (35–65% shot share) no quality pill renders.
Result pill — score-card.tsx:221. Present, but placed in the center under the score, not in the top pill cluster.
Gap vs the spec: The owner wants every card to show result + mode + one derived quality pill. Today: result is present (but detached from the cluster), mode is conditional on non-null gameMode, and the quality pill is absent for the majority of "normal" games. A derived quality metric (DtW, score-card.tsx:262) already exists as a plain stat and could be promoted to an always-present pill (e.g. possession/shot-share %). Severity: QUICK-WIN (data already computed).

1. Visual / Contrast / Readability
   DNF card surface is visually identical to a LOSS — score-card.tsx:32-36 (bg/border) and 43 (top bar) reuse the rose palette for DNF. This contradicts the design-system intent that DNF reads as a distinct neutral-grey "something happened" signal (see result-colors.ts:26-29 where the DNF pill is grey + red border). A user scanning cards can't distinguish a DNF from a loss until they read the small center pill. Severity: NICE-TO-HAVE
   Low-contrast stat labels — the SOG / TOA / Hits / DtW labels are text-[10px] ... text-zinc-600 (score-card.tsx:64, 85, 99). zinc-600 at 10px on the near-black card is below comfortable contrast. Severity: NICE-TO-HAVE
   Match time is very dim — text-xs text-zinc-600 (score-card.tsx:189). Small + low-contrast timestamp top-right. Severity: NICE-TO-HAVE
2. Layout / Spacing / Alignment
   Loading skeleton does not match the current layout (layout shift) — apps/web/src/app/games/loading.tsx:1-12 renders 8 thin h-12 rows with a border-l-4 left bar. That is the old MatchRow list shape; the page now renders a 3-column grid of tall gradient cards with top bars, big scores, crests, and a 4-stat row. The skeleton also omits the toolbar, form strip, and date section headers. Result is a visible jump when content loads. Severity: BUG
   Four stats crammed into one row on narrow cards — score-card.tsx:250-263 puts SOG · TOA · Hits · DtW (each a labeled two-line stat) in a justify-between row. At md:grid-cols-2 / xl:grid-cols-3 (page.tsx:236) card width gets tight and these can crowd. Severity: NICE-TO-HAVE
   Redundant page indicators — "Page X of Y" appears in the toolbar (page.tsx:376) and again in both top and bottom PaginationNav (page.tsx:517-519), so up to three times on screen. Severity: NICE-TO-HAVE
3. Data Correctness / Completeness
   "Last N" form strip silently drops the most recent game — page.tsx:161 (rawFormMatches.slice(1, ...)) excludes index 0, but FormStrip labels it "Last {n}" (page.tsx:604) where n=10. This pattern makes sense only when a separate hero spotlights the newest game — but /games has no such spotlight (the newest game is just the first card). So the strip labeled "Last 10" is actually games 2–11, and the newest result is missing from both the strip and TrendBullets. Misleading. Severity: BUG
   Card DtW/quality use EA shots; the detail page uses OCR-reviewed shots — the card calls buildPossessionEdge(match) with no period summaries (score-card.tsx:133), while /games/[id] calls buildPossessionEdge(match, periodSummaries) (apps/web/src/app/games/[id]/page.tsx:161). For OCR-reviewed matches, EA under-counts shots (per the note in match-recap.ts:741-747), so the card's DtW/quality label will disagree with the detail page's possession edge for the same match. Severity: NICE-TO-HAVE (consistency)
   DNF is folded into "losses" in the form record — page.tsx:596 counts LOSS || DNF as losses, and the W-L-OTL string (page.tsx:611) shows DNF inside the loss bucket. DNF is a distinct MatchResult (matches.ts:20); folding it in is a semantic choice worth confirming. Severity: NICE-TO-HAVE
4. Consistency
   Score dash bypasses the shared formatter and mixes dash characters — the big score renders a literal hyphen - (score-card.tsx:216) built inline, while SplitStat renders an en-dash – (score-card.tsx:104) and the shared formatScore helper also uses en-dash (format.ts:31). Same card, two different separators; the card never calls formatScore. Severity: QUICK-WIN
   "DtW" is an unexplained acronym — score-card.tsx:86. Unlike SOG/TOA (standard hockey terms), DtW is a project-specific composite with no legend or tooltip on the card. Severity: NICE-TO-HAVE
   "Outshot" label is ambiguous — score-card.tsx:144. It fires when BGM was outshot (shot share ≤ 0.35) but the bare word reads either direction. "Got outshot" / "Outshot 35%" would disambiguate. Severity: NICE-TO-HAVE
5. Interaction / UX Affordances
   "Dev" filter exposes developer scaffolding in the UI — MODE_LABELS includes { mode: 'dev', label: 'Dev' } (page.tsx:307) backed by a hardcoded DEV_MATCH_IDS list of OCR-training match IDs (page.tsx:29-41). This is internal tooling surfaced as a first-class filter next to 6s/3s. Severity: NICE-TO-HAVE (or dead code — see §7)
   Segmented filter links give no programmatic "selected" signal — SegmentedLinks (page.tsx:441-453) styles the active item visually (bg-accent text-white) but sets no aria-current/aria-pressed, unlike PageLink which correctly sets aria-current (page.tsx:572). Severity: QUICK-WIN
   No focus-visible styling anywhere — globals.css defines no :focus/focus-visible rules, and the card <Link> (score-card.tsx:155-158), segmented filter links, and pagination links add no focus-visible: classes. Keyboard users get only the UA default outline, which is easy to lose on this custom dark theme. (The opponent <input> does have focus:border-zinc-500 — page.tsx:403 — so the pattern is inconsistent.) Severity: QUICK-WIN
6. Accessibility
   Card link has no accessible name — score-card.tsx:155-158 wraps the whole card in a <Link> with no aria-label; a screen reader stitches together "vs {opponent} … 3 - 1 … WIN … SOG …". An aria-label like "BGM vs {opponent}, {result} {scoreFor}–{scoreAgainst}" would make the link self-describing. Severity: NICE-TO-HAVE
   Missing focus indicators (same as §5) impact keyboard/AT users directly. Severity: QUICK-WIN
   Crest/logo alt text is handled correctly — BGM logo alt="Boogeymen" (score-card.tsx:204), OpponentCrest gets alt={match.opponentName} and an aria-hidden abbrev fallback (score-card.tsx:230-240, opponent-crest.tsx). No action needed there.
7. Dead Code / Leftover Scaffolding
   Stale loading skeleton — apps/web/src/app/games/loading.tsx is shaped for the retired MatchRow list layout (see §2). Effectively leftover scaffolding. Severity: QUICK-WIN
   Dev-only match ID list + filter — DEV_MATCH_IDS (page.tsx:29-41) plus the "Dev" mode option (page.tsx:307) is OCR-development scaffolding living in the shipped page. Severity: NICE-TO-HAVE
   SnapStat used once — score-card.tsx:61-70 is only used for TOA (256); minor, but note it exists alongside SplitStat/DtWStat as a near-duplicate primitive. Severity: NICE-TO-HAVE
8. Outright Bugs
   Loading skeleton / content layout mismatch — games/loading.tsx (list rows) vs card grid. Guaranteed layout shift on every navigation. Severity: BUG (also listed in §2)
   "Last N" excludes the newest game with no spotlight to justify it — page.tsx:161 + label at 604. Users reading "Last 10" get games 2–11. Severity: BUG (also listed in §3)
   Highest-value quick wins
   Fix games/loading.tsx to mirror the ScoreCard grid (removes layout shift).
   Make the quality/derived-stat pill always present (promote DtW/shot-share) and ensure a mode pill always renders even when gameMode is null — directly satisfies the product-owner spec.
   Add focus-visible styles + aria-current on segmented filters.
   Resolve the "Last N" exclusion (either include the newest game or relabel).
