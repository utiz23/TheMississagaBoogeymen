# Polish Backlog — Existing Surfaces (Track C)

> Scouting output, 2026-07-04. Six parallel read-only surface scouts swept `apps/web` (home, games list, game detail, roster/profile, stats, nav/shared-UI/auth). Every item cites a real `file:line` seen during the sweep. Nothing here is implemented — this is the task list.
>
> **Severity:** `BUG` = incorrect/broken output · `QUICK-WIN` = small, high-value, data already present · `NICE` = polish / lower priority.
>
> This is a Session-1 (inspect & scope) artifact. Implement in focused follow-up sessions, one surface per session.

> ### ⚠️ Game-detail items are stale (2026-07-29)
>
> `/games/[id]` was rebuilt in the 12-phase game-sheet revamp. Every `file:line`
> below that cites `scoresheet.tsx`, `shot-mix.tsx`, `lineup-section.tsx`,
> `lineup-expand-panel.tsx`, `lineup-ladder.tsx`, `lineup-card.tsx`,
> `possession-edge.tsx`, or `action-tracker-map.tsx` points at a **file deleted in
> Phase 11**; `star-card.tsx` → `performer-row.tsx` and
> `show-all-player-scores.tsx` → `performer-score-list.tsx` were renamed.
>
> **Verified fixed by the revamp** (re-checked while writing this banner, not assumed):
>
> - §0 #2 / §2 position-pill contrast — Phase 10 added `PositionPill tone="muted"` (colour keeps border + tint, label goes fg-1).
> - §0 #6 / §1 two conflicting "GAME" numbers — the lineup band that printed `Game {matchId}` is gone; the hero is now the only "GAME n".
> - §1 hero meta highlight on the wrong token — the hardcoded `i === 2` no longer exists (hero rewritten in Phase 3).
> - §1 lineup band hardcodes Home/Away — that band is gone; the new module prints neither.
> - §1 Possession Edge scores a tie as a BGM win — `dtw-gauge.tsx` has a real `'tie'` branch and renders `Tied 3–3`, never "BGM won 3–3".
> - §2 divergent BGM/OPP colour conventions — the whole page now rides `accent` (BGM) / `--opp*` (opponent) from `lib/opponent-colors.ts`; raw per-match OCR hexes are no longer drawn anywhere.
> - §2 possession gauge tick-label inconsistency — that gauge was replaced.
> - §2 `role="button"` wrapping a `<Link>` — in `performer-row.tsx` the link is a **sibling** of the row button, inside the expanded panel.
>
> **Still open and NOT part of the revamp:** §1 "Games-list loading skeleton is
> the retired list layout" (`games/loading.tsx`) — that is the games **list**
> skeleton. Phase 11 refreshed only `games/[id]/loading.tsx`; the list one is
> still the stale `MatchRow` layout against a card grid.
>
> Items for every other surface (home, games list, roster, stats, nav) are untouched by this and remain valid.

---

## 0. Seed items from the request — verified status

| #   | Seed item                                                                | Status                                                                                                                                                                                                                                                                      | Where                                                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | `/games` match-card pills (result + mode + one derived quality stat)     | **Partially present** — result pill exists but is detached; mode pill only renders when `gameMode !== null`; quality pill ("Dominated"/"Outshot") only fires at shot-share extremes, so most games show none. Promote a derived stat (DtW/shot-share) to an always-on pill. | `score-card.tsx:161-190`, `140-145`, `221`                                               |
| 2   | Top Performers position-pill contrast                                    | **Confirmed** — C/G/RW hues (dark red/purple/blue) as text on a near-transparent tint of themselves fall below WCAG AA on the dark card. The `onLight` opaque variant exists but is never enabled at these call sites.                                                      | `position-pill.tsx:25-42`; `star-card.tsx:174-181`; `show-all-player-scores.tsx:206-213` |
| 3   | Verify "Show all player scores" includes all opponents                   | **Verified complete** — `getOpponentPlayerMatchStats` has no LIMIT; only players with an entirely empty stat line (`hasRecordedActivity` false) are dropped. No top-N truncation. Optional: show zero-activity players greyed or add an "N hidden" note.                    | `opponent-match.ts:16-26`; `match-recap.ts:583-596`; `show-all-player-scores.tsx:43`     |
| 4   | Navbar: drop "EASHL · #19224" subtitle                                   | **Already done** — nav brand renders only the crest + "Boogeymen" wordmark; `grep 19224` across `apps/web/src` returns zero hits. No action beyond confirming intent.                                                                                                       | `top-nav.tsx:24-42`                                                                      |
| 5   | Player profile EA season TOI totals (skater/goalie split, `17d 22h 47m`) | **Needs work** — TOI totals exist but are buried one-at-a-time in sub-tabs, never shown as a skater-vs-goalie split, and `formatHrsMin` never rolls hours into days (a 17d total renders "430h 47m"). Data (`toiSeconds`, `goalieToiSeconds`) is available.                 | `club-stats-tabs.tsx:836-841`, `1258-1264`, `1555-1561`; `players.ts:530,542`            |
| 6   | Bug: two conflicting "GAME" numbers on `/games/[id]`                     | **Confirmed BUG** — hero prints `Game {seasonNumber}` (chronological game-of-title, meaningful) while the lineup band prints `Game {matchId}` (surrogate bigserial PK, meaningless).                                                                                        | `hero-card.tsx:66` vs `lineup-section.tsx:210-215` (`page.tsx:219`)                      |

---

## 1. Bugs (fix first)

> **Bugs pass done 2026-10-05.** Re-verified every item against current code first.
> ✅ = fixed that day · ⛔ = already gone before the pass · ❓ = needs an operator decision.

- ⛔ **Two conflicting "GAME" numbers** (game-sheet revamp) — `hero-card.tsx:66` (`Game {seasonNumber}`) vs `lineup-section.tsx:210-215` (`Game {matchId}` = DB PK). Pass `seasonNumber` into `LineupSection` (or relabel the band "Match ID"). `[BUG]`
- ⛔ **Hero meta highlight lands on the wrong token** (game-sheet revamp) — `hero-card.tsx:84` hardcodes emphasis on index `i === 2`, but when `gameMode` is present "Game N" shifts to index 3, so the bold lands on the mode string. Match the index to the game-number part. `[BUG/QUICK-WIN]`
- ⛔ **Lineup band hardcodes BGM=Home / OPP=Away** (game-sheet revamp) — `lineup-section.tsx:324` (`… · Home`) and `:283` (`… · Away`); `match.bgmWasHome` is never passed in, so away games are mislabeled. `[BUG]`
- ⛔ **Possession Edge scores a tie as a BGM win** (game-sheet revamp) — `possession-edge.tsx:47` (`scoreFor >= scoreAgainst ? 'bgm' : 'opp'`) + footnote `:96` renders "BGM won 3–3". Use `match.result` instead of a score comparison (EASHL OT3 can end tied). `[BUG]`
- ✅ **Empty Last-10 form slots render as red losses** (`1eb253d`) — `record-strip.tsx:246` emits `<span class="d l" />` for missing games; `.d.l` is the LOSS style, so a <10-game team shows phantom red "loss" boxes. Add a neutral `empty` class. `[BUG]`
- ✅ **Games-list "Last 10" excludes the newest game** (`9aae4ce`, operator 2026-10-09: include it) — deliberate in `af01074` (2026-05-24: "don't count a game as form leading into itself"); keep, or include the newest game? — `page.tsx:161` (`rawFormMatches.slice(1, …)`) drops index 0, but the strip is labeled "Last 10" (`page.tsx:604`) and there's no hero spotlighting game 0 to justify it. Include the newest game or relabel. `[BUG]`
- ✅ **Games-list loading skeleton is the retired list layout** (`ddaad41`) — `games/loading.tsx:1-12` renders thin `MatchRow`-style rows while the page now renders a card grid → guaranteed layout shift on every navigation. Reshape the skeleton to the `ScoreCard` grid. `[BUG]`
- ⛔ **Stats sticky Player column bleeds through on mobile scroll** (stats tables rebuilt on `stats-table-shell.tsx`, opaque `bg-surface`) — `skater-stats-table.tsx:604`, `goalie-stats-table.tsx:448` use `bg-inherit`, which resolves to transparent on plain rows, so columns scroll under a see-through name cell. Give it an explicit opaque `bg-surface`. `[BUG]`
- ✅ **Team shot map hardcoded to `slug === 'nhl26'`** (`007523d`; was LIVE once NHL 27 became default — profile zone maps were also pinned to title id 1, fixed too) — `stats/page.tsx:220-222`; when the active title advances to NHL 27 the map silently shows "no data" despite populated aggregates. Gate on data presence / `isActive`. `[BUG — latent]`
- ✅ **Goalie marquee rank noun hardcoded to "skaters"** (`8f4076c`) — `club-stats-tabs.tsx:336` (`of {rank.total} skaters`) renders on goalie tabs too, so a goalie reads "#1 of 2 skaters". Switch the noun on `role`. `[BUG/QUICK-WIN]`
- ✅ **Season TOI totals overflow to hundreds of hours** (`99ace54`; shared `formatDuration` in `lib/format.ts`; seed #5's skater/goalie _split_ is still open in §2) — `formatHrsMin` (`club-stats-tabs.tsx:1555-1561`) never rolls hours into days → "430h 47m" instead of "17d 22h 47m". This is seed item #5. `[BUG/QUICK-WIN]`

---

## 2. By surface

### Home (`/`)

- ✅ (`666f70c`, one band scale `c649dba`) **DtW legend colors map to nothing** — `dtw-chip.tsx:100-116` advertises 4 color bands but the gauge/number are always red; color the value by band. `[NICE]`
- ⛔ (old home player card removed) **Jersey number near-invisible** — `player-card.css:98-105` `#3f3f46` on `#0a0a0a` (~1.6:1) for a key identifier. Lift the color or add a stroke. `[NICE]`
- ✅ (`666f70c`: removed until wired) **Placeholder period-score tiles always show "— —"** — `latest-result.tsx:269-288`; pipeline doesn't extract period scores yet. Hide until wired. `[QUICK-WIN]`
- ✅ (operator 2026-10-09: removed, `d40a7db`) **Fake "Sheet BGM/REC/0001" broadcast string** — `record-strip.tsx:36,272-274`; invented flavor that reads like leftover placeholder. Remove or make real. `[NICE]`
- ✅ (`666f70c`) **Leaders footer GP doesn't match the mode filter** — `page.tsx:170` → `leaders-section.tsx:175-181` shows all-modes `officialRecord.gamesPlayed` beside per-mode leaders. Source mode-scoped GP when `gameMode !== null`. `[QUICK-WIN]`
- ✅ (`666f70c`: GP-weighted archive TOA; PP/PK hidden in All) **TOA / PP% / PK% columns are all "—" in default "All" view** — `page.tsx:295-297`, `354-359` null them; only single-mode rows populate. Hide those columns in "All" or aggregate. `[NICE]`
- ⛔ (source is already "MM:SS") **TOA in title-records table rendered unformatted** — `title-records-table.tsx:151-153` passes raw through `fmt()`; apply `formatTOA` (verify the source unit). `[NICE]`
- ✅ (`bb8f097`: relabelled "Last game", club zone) **"Updated {last game time}" mislabels a game timestamp as a refresh time** — `record-strip.tsx:64,88-95`; relabel "Last game". `[NICE]`
- ✅ (`666f70c`) **"in last 10" copy with <10 games** — `record-strip.tsx:235-240`; use `dots.length`. `[NICE]`
- ✅ (`666f70c`) **Mode capitalization split** — `latest-result.tsx:60` shows "6S"/"3S" while other sections show "6s"/"3s". Standardize lowercase. `[QUICK-WIN]`
- ✅ (`666f70c`, site-wide `175c0bf`) **Record dash mixes `-` and `–`** — `record-strip.tsx:124-126,237` use ASCII hyphen vs `formatRecord`'s en-dash. Route through `formatRecord`. `[QUICK-WIN]`
- ✅ (`666f70c`, `110828c`) **Duplicated formatters diverging from `lib/format.ts`** — `title-records-table.tsx:37` (`winPct`), `leaders-section.tsx:365` (`formatSavePct`, uses `isNaN` vs shared `Number.isFinite`). Import shared helpers. `[NICE]`
- ✅ (`666f70c`) **Redundant mode label** — `leaders-section.tsx:180-181` renders "local tracked 6s · 6s". Drop the trailing label. `[QUICK-WIN]`
- ✅ (`1b20f15`: global focus ring) **Carousel focus ring removed** — `player-carousel.tsx:54` `outline-none` with no replacement. Add `focus-visible:` ring. `[QUICK-WIN]`
- ✅ (`666f70c`: inert) **Off-stage carousel cards stay in tab order** — `player-carousel.tsx:87-124`; add `tabIndex={-1}`/`aria-hidden` (or `visibility:hidden`). `[QUICK-WIN]`
- ⛔ (old home player card removed) **Redundant crest alt on every card** — `player-card.tsx:160` `alt="BGM"` decorative noise; use `alt=""`. `[QUICK-WIN]`
- ✅ (`666f70c`: site-wide rule; game sheet keeps its own) **No `prefers-reduced-motion` handling** — pulse/animate-pulse/transitions across `record-strip.css`, `latest-result.tsx`, `player-card.css`, carousel. `[NICE]`
- ✅ (`666f70c`) **`tablist`/`tab` roles without tabpanels** — `player-carousel.tsx:134-147`, `leaders-section.tsx:88-110`; use `aria-pressed` buttons or complete the pattern. `[NICE]`
- ⛔ (compact carousel below 1100px, 10-09) **5-card carousel fan clipped 640–1024px** — `player-carousel.css:6-8`; raise breakpoint to `lg`/`xl` or scale offsets. `[NICE]`
- ✅ (`666f70c`) **Title-records table loses row label on horizontal scroll** — `title-records-table.tsx:90-91`; make Title column `sticky left-0`. `[NICE]`
- ⛔ (old home player card removed) **Empty "spare" identity cell** — `player-card.tsx:162`; 3-col grid with a permanently empty third cell. Drop to 2-col. `[NICE]`
- ✅ (`666f70c`) **Stale section-number comments (1,2,3,4,5,7)** — `page.tsx:184-242`; gap from removed goalie spotlight. Renumber. `[NICE]`

### Games list (`/games`)

- ⛔ (DtW is always on the card; mode pill renders whenever a mode is known — kept as is) **Promote an always-on quality pill + always-render mode pill** — seed item #1; `score-card.tsx:161-190`. `[QUICK-WIN]`
- ✅ (`8d1ecee`: neutral DNF card) **DNF card looks identical to a LOSS** — `score-card.tsx:32-36,43` reuse the rose palette; the DNF _pill_ is grey-with-red-border, so cards disagree with pills. Give DNF a neutral card surface. `[NICE]`
- ✅ (`c649dba`) **Low-contrast stat labels & timestamp** — `score-card.tsx:64,85,99` (`text-zinc-600` at 10px), `:189` timestamp. Lift contrast. `[NICE]`
- ✅ (`c649dba`: batched reviewed OCR shots) **Card DtW uses EA shots; detail page uses OCR-reviewed shots** — `score-card.tsx:133` calls `buildPossessionEdge(match)` without period summaries, so the card can disagree with `/games/[id]`. `[NICE]`
- ✅ (operator 2026-10-09: DNF counts as a loss in records) **DNF folded into losses in the form record** — `page.tsx:596,611`; confirm this semantic choice. `[NICE]`
- ✅ (`c649dba`) **Score dash bypasses `formatScore` and mixes dash glyphs** — `score-card.tsx:216` literal `-` vs `:104` en-dash vs `format.ts:31`. Use `formatScore`. `[QUICK-WIN]`
- ✅ (`c649dba`: tooltips) **"DtW" acronym unexplained; "Outshot" ambiguous** — `score-card.tsx:86,144`. Add a legend/tooltip; disambiguate direction. `[NICE]`
- ✅ (`c649dba`) **Segmented filter links lack `aria-current`** — `page.tsx:441-453` (contrast with `PageLink` at `:572` which sets it). `[QUICK-WIN]`
- ✅ (`1b20f15`) **No `focus-visible` styling on card link / filters / pagination** — `score-card.tsx:155-158`, `page.tsx` links; only the opponent input has focus styling. `[QUICK-WIN]`
- ✅ (`c649dba`) **Card link has no accessible name** — `score-card.tsx:155-158`; add an `aria-label`. `[NICE]`
- ✅ (`c649dba`) **Redundant page indicator (up to 3×)** — toolbar `page.tsx:376` + top/bottom `PaginationNav` `:517-519`. `[NICE]`
- ✅ (operator 2026-10-09: keep it) **"Dev" filter + `DEV_MATCH_IDS` shipped in the UI** — `page.tsx:29-41,307`; OCR-training scaffolding surfaced as a first-class filter. Gate or remove. `[NICE]`

### Game detail (`/games/[id]`)

_(bugs listed in §1: double GAME number, hero highlight index, lineup Home/Away, possession-edge tie)_

- ⛔ (star-card removed in the game-sheet revamp; pills use the muted tone) **Top Performers pill contrast** — seed item #2; brighten C/G/RW on-dark. `[QUICK-WIN]`
- ⛔ (bars are now share-of-pair) **Team Stats Save% comparison bars near-invisible** — `team-stats.tsx:103-124`; `.917` parsed as `0.917` → both bars ~18% width. Scale save% specially. `[QUICK-WIN]`
- ⛔ (no subtitle in the revamp) **Box Score subtitle hardcodes "OCR-reviewed"** — `box-score.tsx:37` can contradict the "EA · official" footnote at `:497`. Derive from `detectSource`. `[NICE]`
- ⛔ (offending files removed in the revamp) **Divergent BGM/OPP color conventions (4 pairs)** — `shot-mix.tsx:50,53` (`#ce202f`/`#7d8db0`), `lineup-card.tsx:32,39,83`, `event-timeline.tsx:36-37`, vs `team-stats.tsx:22-28` (`text-accent`). Consolidate on the accent token. `[QUICK-WIN]`
- ✅ (`1356283`) **Bottom prev/next drops the list-filter query** — `context-footer.tsx:28` vs top nav `page.tsx:283-285`. Preserve `listQuery`. `[NICE]`
- ⛔ (possession-edge removed) **Possession gauge tick labels inconsistent** — `possession-edge.tsx:304/318/332` "0%"/"100%"/"50". `[NICE]`
- ✅ (`1356283`: "N players … aren't ranked") **Show-all-scores: zero-activity players silently hidden** — seed item #3; optional grey-out or "N hidden" note. `[NICE]`
- ⛔ (show-all table removed) **Merged "TOI · SV%" column header** — `show-all-player-scores.tsx:64-72`; can't describe both roles. `[NICE]`
- ⛔ (row button + separate panel link now) **Row is `role="button"` wrapping a `<Link>`** — `show-all-player-scores.tsx:174-228`, `scoresheet.tsx:134-189`; nested interactives. `[NICE]`
- ⛔ (not a defect: both open the same drawer, which ARIA allows) **Two buttons share one `aria-controls`** — `lineup-row.tsx:56-76` (BGM + OPP wrappers). `[NICE]`
- ✅ (`1356283`: club-zone dates; year label refreshes on each deploy) **Indefinite cache + render-time year logic** — `page.tsx:48` `revalidate=false` vs `formatMatchDate` (`format.ts:5-14`) comparing to `new Date()`; year label goes stale after Jan 1. `[NICE]`
- ⛔ (already deleted) **Dead: `lineup-card.tsx`** — no importers (superseded by `lineup-section.tsx`); carries its own X-Factor legend and stale colors. Delete. `[QUICK-WIN]`
- ✅ (`19d8b81`) **Deprecated `PositionPill` props still threaded** — `position-pill.tsx:11-22` (`side`/`defenseSide`) still passed at `star-card.tsx:179`, `show-all-player-scores.tsx:211`, `scoresheet.tsx:169-170,377`. `[NICE]`

### Roster list + Player profile (`/roster`, `/roster/[id]`)

_(bugs in §1: goalie marquee "skaters" noun, TOI day-rollover — both fixed 2026-10-05)_

- ✅ (`bb8f097`) **Club Stats delta badges show raw seconds for time stats** — found 2026-10-05: Time on Ice reads "2d 10h 58m" with a "+67509" badge, Possession "+5992" (`club-stats-tabs.tsx`, the `cs-delta` beside each cell). Format time deltas with `formatDuration`. `[QUICK-WIN]`
- ✅ (`4b24930`: coordinates rounded) **Hydration mismatch on every profile** — found 2026-10-05: the contribution wheel's SVG `<line>` attributes differ server vs client (float rounding), logged as a console error. Round the coordinates. `[NICE]`

- ✅ (`ca7cff2`: split in the Club Stats header) **Add shared `formatDuration(seconds)` → "Nd Nh Nm" + surface skater/goalie TOI split** — seed item #5; new helper in `lib/format.ts`, render both `toiSeconds` & `goalieToiSeconds` regardless of selected role. `[QUICK-WIN]`
- ✅ (`bb8f097`) **Hero goalie SV% in non-hockey format** — `profile-hero.tsx:698-700,716,630` shows "92.30" while ledger + `formatSavePct` use ".923". Use the shared helper. `[QUICK-WIN]`
- ✅ (`175c0bf`) **Career-Totals goalie SV%/GAA always "—"** — `profile-hero.tsx:846` hardcodes null; `PlayerCareerSeasonRow` lacks saves/shots/TOI to recompute. Looks like missing data. `[NICE]`
- ✅ (`bb8f097`: real lastFetchedAt) **`ClubStatsTabs` "Updated" defaults to `new Date()`** — `club-stats-tabs.tsx:227`; page never passes the real `lastFetchedAt` though it's available. Pass `eaStats[0].lastFetchedAt`. `[QUICK-WIN]`
- ✅ (`bb8f097`) **Shot-map "Updated" hardcoded to today** — `page.tsx` (both `ShotMap` call sites) pass `new Date()`; footer implies false freshness. `[QUICK-WIN]`
- ✅ (`175c0bf`: removed; EASHL has no shootouts) **Goalie "Shootouts" subsection is dead data for EASHL** — `club-stats-tabs.tsx:1307-1409,1328`; always-zero cells read as broken. Drop or guard on `soShots > 0`. `[NICE — verify on a real goalie row]`
- ✅ (moot: Recent Form chart removed (`4095e49`)) **TrendChart paints DNF as a loss** — `trend-chart.tsx:61` else-branch; legend `:84-95` only lists W/OT/L. `[NICE]`
- ⛔ (one map per role now) **Two stacked, visually similar shot maps** — `page.tsx:239` (`CareerShotMap`) + `:241-262` (`ShotMap`); read as duplicates. Tab/toggle or differentiate headers. `[NICE]`
- ✅ (operator 2026-10-09: goalie wheel built, `e94b4cf`) **Skater vs goalie contribution use different components/headers** — `contribution-section.tsx:59-71` (rich wheel) vs `:74-112` (older donut); "Contribution Wheel" vs "Season Profile". `[NICE]`
- ⛔ (section removed `fb40008`) **Two permanent "Coming Soon" stubs advertised in subtitle** — `charts-visuals-section.tsx:14,18-26` (archetype radar, awards). `[NICE]`
- ✅ (`5de5a13`) **Contribution wheel click-to-lock undiscoverable** — `contribution-wheel.tsx:303-311`; no affordance hint. `[NICE]`
- ⛔ (trend chart removed; the donut's bars carry the same values as text) **Charts `aria-hidden` with no text alternative** — `trend-chart.tsx:44`, `contribution-section.tsx:137`; add SR-only summary for the trend chart. `[NICE]`
- ✅ (`175c0bf`: nav + aria-current) **Hero role tabs are `<Link role="tab">` without tabpanel/roving-tabindex** — `profile-hero.tsx:536`. `[NICE]`
- ✅ (operator 2026-10-09: nothing under 10px, `75c8a45`) **Pervasive 9px `text-zinc-600/700` micro-labels** — `roster-ledger.css:213,255,325,441`, `club-stats-tabs.css:131`, `shot-map.css:373,538`, `profile-hero.tsx:432`. Bump to 10-11px / zinc-500. `[NICE]`
- ✅ (`19d8b81`) **Dead: `shot-map-renderer.tsx` (`IceMapSvg`/`NetMapSvg`)** — zero importers; also prune the divergent net-zone exports in `shot-map-zones.ts:36`. Delete. `[QUICK-WIN]`
- ⛔ (component removed) **`ComingSoonCard` `icon` prop never passed** — `coming-soon-card.tsx:6,24-28`. `[NICE]`

### Stats (`/stats`)

_(bugs in §1: transparent sticky Player column, hardcoded `nhl26` shot map)_

- ✅ (`bb8f097`: .923 in SV%, BRKSV%, PSV%) **Goalie SV% shown as raw percent** — `goalie-stats-table.tsx:102` ("67.00%") vs app-wide `formatSavePct` (".670"). Use the shared helper, keep numeric sort. `[QUICK-WIN]`
- ⛔ (section removed) **`ArchiveClubTeamSection` table has no `min-w`** — `page.tsx:511`; its twin `TeamHistoryTable` uses `min-w-[760px]`. Cramps on mobile instead of scrolling. `[QUICK-WIN]`
- ⛔ (stats-table shell has buttons + aria-sort + scope) **Sortable `<th>` not keyboard-operable / no `aria-sort`/`scope`** — `skater-stats-table.tsx:519-537`, `goalie-stats-table.tsx:371-388`; wrap label in a `<button>`, add `scope="col"` + `aria-sort`. `[QUICK-WIN]`
- ✅ (`110828c`) **"Leader" accent band tracks sort position, not merit** — `skater-stats-table.tsx:578-602`; ascending sort paints the _worst_ rows with the winner accent. Only apply on default higher-is-better sort. `[NICE]`
- ✅ (`110828c`) **Matrix `t3` tier: white text on mid-yellow** — `pair-win-matrix.css:399-403`; use dark text like `t4`. `[NICE]`
- ✅ partly (`110828c`: matrix row labels stick; thead stickiness needs the tables out of their scroll boxes — not worth it) **No sticky `<thead>` on any table; pair-matrix row label not sticky** — all tables; `pair-win-matrix.css:308`. Add `position: sticky`. `[NICE]`
- ✅ (`110828c`) **Shot map + chemistry render on 0-game titles** — `page.tsx:264,315`; stack empty modules under the EmptyState. Gate on `gamesPlayed > 0`. `[NICE]`
- ✅ (`110828c`: spoken "sorted", aria-sort) **Interactive vs static sort headers look identical** — chemistry tables show a decorative `↓` (`chemistry-tables.tsx:55-62,157,262`) that isn't clickable. `[NICE]`
- ✅ (`110828c`: tooltips) **Chemistry headers cryptic ("Rec W/", "GP W/O")** — `chemistry-tables.tsx:138-155`; add `title=` tooltips / spell out. `[NICE]`
- ⛔ (gone with the shell rewrite) **Dead: `rl-rank-1/2/3` classes** — `skater-stats-table.tsx:581` sets them but no CSS defines them; visible styling is the inline `boxShadow`. Delete `leaderClass`. `[QUICK-WIN]`
- ✅ (`110828c`; PLAYLIST_LABEL already single) **Duplicated constants/formatters** — `PLAYLIST_LABEL` (`page.tsx:481-490` + `team-history-table.tsx:9-18`), `buildPlayerTooltip` (`skater:367` + `goalie:50`), `fmtToi`/`fmtPer`/`fmtRecord` re-implemented per component. Hoist to shared modules. `[QUICK-WIN]`
- ⛔ (ArchiveClubTeamSection removed) **Two near-identical team tables with different styling** — `ArchiveClubTeamSection` (`page.tsx:492-566`) vs `TeamHistoryTable`. Converge. `[NICE]`
- ✅ (`110828c`: dead helper removed; "Tracked 6s games") **`statsSourceLabel` capitalization/phrasing inconsistent** — `title-selector.tsx:147-149`. `[QUICK-WIN]`
- ✅ partly (`110828c`: toggles are aria-pressed; the grid stays a div) **Pair matrix is a `<div>` grid with no table semantics; misused `tablist`/`aria-selected` on sort/toggle controls** — `pair-win-matrix.tsx:331-378,298-313`, `team-shot-map.tsx:49-67`. Use `radiogroup`/`aria-pressed`. `[NICE]`
- ✅ (`110828c`, stats-table shell) **Row-name cells are `<td>` not `<th scope="row">`; no `<caption>`** — across all stats tables. `[NICE]`

### Nav / shared UI / auth

- ~~**Auth/account unreachable from the chrome**~~ — **OBSOLETE, do not action.** Authentication is disabled before launch and those routes now 404; the nav CTA was removed deliberately and a guard test fails if it returns. Revisit only with the post-launch account feature (`apps/web/src/deferred/auth/README.md`).
- ✅ (`eb5e1b3`; auth pages are dormant) **Page-title separator drift + unbranded tab** — public pages use `—`, all auth pages use `-` (13 strings); home title is generic "Club Stats". Add a `title.template` (`%s — Club Stats`) in `layout.tsx`. `[QUICK-WIN]`
- ✅ (`1b20f15`, `eb5e1b3`; aria-current and labels were already in) **No `aria-current` on nav links; two unlabeled `<nav>` landmarks; no `focus-visible`; no skip link** — `nav-links.tsx:27,34-38,62-68`, `top-nav.tsx:58`, `layout.tsx:32-34`. `[QUICK-WIN]`
- **Placeholder-only inputs on create-invite forms** — **DEFERRED with the account system.** Those pages no longer exist under `src/app/`; the code is dormant in `apps/web/src/deferred/auth/`. Fix as part of re-enabling auth, not before. `[QUICK-WIN]`
- **No pending/disabled state on server-action buttons** — **DEFERRED with the account system.** Same dormant files as above. `[NICE]`
- ⛔ (drawer switcher follows its own prototype — design call) **Two title switchers styled differently** — nav `game-title-switcher.tsx:28-50` (no LIVE dot) vs page `title-selector.tsx:41-70` (green LIVE dot). Unify. `[NICE]`
- ⛔ (uses defaultSlug now) **Nav switcher default (`titles[0]`) may disagree with the page's resolved title** — `game-title-switcher.tsx:17`. Verify. `[NICE]`
- ✅ (`eb5e1b3`: close button 44px; burger already 44px; desktop links px-4) **Mobile nav tap targets under ~44px; desktop links `px-1`** — `nav-links.tsx:35,63`, `top-nav.tsx:88`. `[NICE]`
- ⛔ (in use by the card/locker components now) **`--color-border` token effectively dead** — `globals.css:14` defined but `border-zinc-800` hardcoded ~105×. Adopt the token or drop it. `[NICE]`
- **`BroadcastPanel` component bypassed by raw `.broadcast-panel` class in 6 files** — all auth pages. Standardize on the component. `[NICE]`
- ⛔ (stat-card / stat-strip deleted) **"accent" means two colors** — `stat-card.tsx:33` `text-accent` (red) vs `stat-strip.tsx:41` `text-rose-400` (pink). Align. `[NICE]`
- ✅ (`eb5e1b3`) **Stale hex values in `Panel` JSDoc** — `panel.tsx:4` claims `#18181b`/`#1f1f22`; tokens are `#232122`/`#2a2829`. Fix comment. `[QUICK-WIN]`
- ✅ (`eb5e1b3`) **`section-header` subtitle very low contrast** — `section-header.tsx:46` `text-zinc-600`. `[NICE]`
- ✅ partly (20 KB icon + apple-icon shipped earlier; no OG image yet) **Favicon is a 264 KB full-res logo; no apple-touch-icon/manifest/OG image** — `app/icon.png`. Ship a small purpose-built favicon. `[NICE]`

---

## 3. Cross-cutting themes (fix once, apply everywhere)

1. ✅ (`1b20f15`) **Missing `focus-visible` styling is site-wide** — home carousel, games-list card/filter/pagination links, nav links, title switchers, stats sort headers. A single global `:focus-visible` ring treatment closes most of these. `[QUICK-WIN, high leverage]`
2. ✅ (`bb8f097`; operator 2026-10-09: .923 everywhere) **SV% format divergence** — hockey-style `.923` (`formatSavePct`) vs raw `92.30%`/`92.30` appears wrong in: profile hero (`profile-hero.tsx:698-700,716`) and stats goalie table (`goalie-stats-table.tsx:102`). Route all SV% through the shared helper.
3. ✅ (`99ace54` + `bb8f097`) **Duration formatting is bespoke & not day-aware** — `formatHrsMin`/`formatMinutes` (private to `club-stats-tabs.tsx`) + `formatTOA` (`lib/format.ts`). Add one shared `formatDuration` and consolidate.
4. ✅ (`666f70c`, `110828c`) **Duplicated formatters diverging from `lib/format.ts`** — win%, save%, record, playlist labels, tooltip builders re-implemented across home + stats. Import the shared helpers.
5. ✅ (`bb8f097`) **Misleading "Updated {today}" timestamps** — `ClubStatsTabs`, profile shot map, home record strip all show render-time as data freshness. Thread real `lastFetchedAt`.
6. ✅ (`8d1ecee`; operator 2026-10-09: neutral grey, still a loss in records) **DNF handled inconsistently** — styled as a loss on home form dots (`record-strip.tsx:246`), games-list cards (`score-card.tsx:32-36`), and the profile trend chart (`trend-chart.tsx:61`); folded into losses in the games-list record. Decide one treatment (distinct neutral) and apply everywhere.
7. ✅ (operator 2026-10-09: removed, `d40a7db`) **Decorative fabricated IDs** — "Sheet BGM/REC/0001" (home), "BGM/PAIR/0001", "BGM/TSM/…" (stats). Confirm the broadcast-flavor intent or remove.
8. ✅ partly (slug gating fixed `007523d`; "Boogeymen" stays hardcoded — single-club site) **Hardcoded club identity & game-title slug** — `Boogeymen` hardcoded in 3 stats call sites; shot map gated on literal `nhl26`. Source from config / gate on data.
9. ✅ (`19d8b81`; /preview is untracked locally, never deployed) **Dead code inventory** — `lineup-card.tsx`, `shot-map-renderer.tsx` (+ unused net-zone exports), `ui/stat-card.tsx` (0 uses), `rl-rank-*` CSS classes, deprecated `PositionPill` props, single-use `ui/stat-strip.tsx`. `ArchetypePillFeature` and `/preview/*` routes are preview-only but **publicly reachable in production** — gate or remove.

---

### Suggested sequencing

1. **Bugs pass** (§1) — one focused session; several are one-liners (GAME number, marquee noun, TOI day-rollover, loading skeleton, sticky column).
2. **Cross-cutting pass** (§3, items 1–5) — shared `focus-visible`, `formatSavePct`, `formatDuration`, `lastFetchedAt`. High leverage, touches many surfaces.
3. **Per-surface quick-wins** — one surface per session, work the `QUICK-WIN` items.
4. **Dead-code cleanup + `/preview` gating** (§3 item 9) — low-risk, isolated.
5. **`NICE` items** — as time allows.
