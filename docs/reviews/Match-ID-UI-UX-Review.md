# Match Detail Page (`/games/[id]`) — UI/UX Review

Ongoing component-by-component review of the canonical match page using match 250 (`/games/250`) as the live target. Each component gets its own section with strengths, issues by severity, and concrete next moves.

**Reviewer:** Claude (Opus 4.7)
**Started:** 2026-05-17
**Methodology:** Live browser inspection at 1440×900 desktop and 390×844 mobile via Playwright MCP, paired with code reads of the component implementation.

---

## 1. Top Performers

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/top-performers.tsx](apps/web/src/components/matches/top-performers.tsx), [apps/web/src/components/matches/star-card.tsx](apps/web/src/components/matches/star-card.tsx), [apps/web/src/components/matches/show-all-player-scores.tsx](apps/web/src/components/matches/show-all-player-scores.tsx).

**Critical caveat up-front:** an earlier review's "bright gold/silver/bronze fills break the dark esports aesthetic" was a misperception based on thumbnail-resolution screenshots. The current cards are already on a dark canvas with subtle accent gradients — the redesign that the original todo #16 calls for is largely done. Marking #16 as already-addressed; this section is refinement on the existing dark-theme cards.

### What's working

- **Per-card info density is excellent.** Each card carries six layers of info without feeling cluttered: rank badge, identity (portrait + name + jersey), team/position/archetype chips, big score + season-avg delta, stat line (G/A/+/−/SOG/(FO% or Hits)/TOI), and a per-factor contribution bar with legend. Six layers is a lot — the visual hierarchy holds it together.
- **Rank hierarchy reads correctly.** FIRST STAR has accent-red score, subtle red gradient top, glow on jersey number; SECOND drops to neutral white; THIRD drops to muted gray with no gradient and no glow. The eye lands on rank 1 first.
- **`+9.1 vs season avg` is a genuinely insightful number.** Most game-page "star" UIs stop at raw score; surfacing the delta to season baseline tells you "MrHomiecide had an unusually big night" in one glance. Green positive / rose negative coloring is consistent with the +/− stat treatment.
- **Score breakdown bar + legend is a small masterpiece.** Horizontal stacked bar shows positive contributions (= where the points came from), with `= 14.28` total on the right anchoring the math. Legend below pulls top-4 positives + worst-2 negatives. This is the "show your work" feature the page needed.
- **Position-conditional stat slot.** Centers see FO%, non-centers see Hits. Goalies replace the whole line with SV/SA/SV%/GA. Real signal of care, not a copy-paste row.
- **Clickable BGM cards link to the player's roster page.** Standard but well-done. Opponent cards don't link (correct — no profile).
- **Mobile stack is clean.** Cards full-width, all six info layers preserved, no truncation, no horizontal scroll.

### Issues — Minor / refinement-level

**1. Third-Star card has visible empty space where `vs season avg` would go.** SHADOWASSAULT20 has no season delta (probably no season data on file), so the slot collapses and the score block looks slightly lopsided. Suggest a faint "—" placeholder ("no season data") at the same line height so card structures align, or accept the gap as deliberate negative space.

**2. Third-Star score `9.06` rendered in `text-fg-2` (dim gray)** — readable but quiet relative to cards 1 and 2. The brain reads it as "less important," accurate, but the score-vs-name contrast inverts there. Suggest bumping rank 3's score to `text-fg-1` (off-white) so the score still dominates within its own card.

**3. The "★★☆" / "★☆☆" off-stars are very dim.** On rank 2 you have `★★` lit and `☆` dim; on rank 3 `★` lit and `☆☆` dim. The dim glyphs blend into the background and are nearly invisible at viewing distance. Either lighten the off-glyphs slightly so the rank count is countable at a glance, or drop them entirely and just show `★★★ / ★★ / ★`.

**4. Archetype pill colors lack a legend.** PLY (lavender), SNP (red), PMD (blue), TWF, DFD, etc. Users will see colors change between rows and intuit meaning, but there's no key. Two options: tooltip on hover (cheap), or a tiny `?` icon in the section header that opens a one-row legend.

**5. Jersey number `—` placeholder shows whenever `playerProfiles` row is missing.** At jersey-number size (28px) the dash competes with the name for attention. Consider hiding the entire jersey slot when null on opponent cards (preserve grid alignment by collapsing that column).

**6. Section header subtitle is redundant.** "Computed from player stats" — "Top Performers" already implies player stats. Either drop the subtitle or repurpose it to clarify ranking ("Ranked by Game Score") which helps first-time readers connect this section to the score breakdown.

**7. The breakdown bar's negative-contribution legend chips don't appear in the bar itself.** By design (the bar shows where the score came FROM, not what was docked) — thoughtful and explicitly commented in code. But the `−2.3 GIVEAWAYS` chip in the legend has no visual anchor on the bar above it. Either move negatives to a separate "docked from" line below the legend, or trust the explicit `−` sign / rose color to tell the story. I'd lean toward the latter.

**8. Stat-line `+1` color** — the `+/−` value is bolded and colored green/rose, while `1G` and `2A` are plain `text-fg-1`. Reads as "the +1 is the most important number." Fine for hockey eyes (rate stats matter), but be deliberate — if the design intent is `+/−` is no more important than G/A, normalize the weight.

**9. "Where the 14.28 came from" header is wordy.** Restates the total that's already in the score block above. Suggest `BREAKDOWN` or `SCORING FACTORS` with the `= 14.28` anchor staying on the right.

**10. The portrait silhouette is a generic ghost — always.** No BGM players have configured portraits, so the silhouette is universal. The visual real estate (64×64 circle with accent border + radial gradient) is doing a lot of styling work for a generic glyph. If real portraits aren't coming, consider putting the jersey number inside the circle (kill the separate jersey badge to the right), so the avatar slot does double duty.

### Issues — Show All Player Scores table

**11. Only rank-1 row gets a tinted background** (`bg-accent/[0.06]`). Ranks 2 and 3 don't get row tint despite the star markers. Medal hierarchy goes "obvious" → "implicit" between cards (visible above) and table (just stars). A very subtle white-tint on rank 2 and dimmer red on rank 3 would tie the table back to the card visual language.

**12. "10 PLAYERS ⌄" toggle label** — minor grammar nit. The chevron with rotation feedback on click is good. No real change needed, just an observation.

**13. The expanded breakdown table is functionally identical to the breakdown bar on the cards** — same factors, weights, totals. But the table presentation is denser and harder to scan than the colored bar. For top-3 you have both; for ranks 4–10 you only get the table. Consider making the same card-style breakdown the expanded row content, not a four-column table.

**14. `+/-` column header uses a hyphen-minus, not the en-dash used in card legends.** Cards use `+/−` (Unicode minus), table header uses `+/-`. Pick one across both surfaces.

**15. `TOI · SV%` column header is overloaded.** Serves double duty: skaters show TOI, goalies show SV%. The dot suggests both could appear together. Better: `TOI / SV%` with the slash signaling alternation, or split into two narrow columns and dim the one not applicable for that row's position.

### Issues — Mobile

**16. Mobile cards eat ~3 viewport heights for the section.** Cards stack vertically which is correct, but a swipe-snap carousel for the three medal cards would keep the section shorter on mobile, with the Show-All button still revealing the full list. A scrollable carousel feels native for "three medal positions" on mobile.

**17. Section subtitle visibility on mobile** — verify it renders above the viewport when section scrolls into view (couldn't confirm in screenshot).

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 2 | Rank-3 score color: `text-fg-2` → `text-fg-1` | 1 line |
| 1 | Rank-3 card placeholder for missing season delta (preserve alignment) | 5 lines |
| 11 | Subtle row tint on Show-All ranks 2 and 3 to match card hierarchy | 1–2 lines |
| 4 | Archetype-pill tooltip OR section-header `?` legend popover | 15–30 lines |
| 3 | Slightly brighter off-star glyphs OR drop them entirely | 1 line |
| 13 | Replace Show-All row breakdown table with card-style bar+legend | 30–60 lines |
| 6 | Section subtitle: "Computed from player stats" → "Ranked by Game Score" | 1 line |

Items 5, 9, 10, 14, 15, 16, 17 are polish to batch together for a single sweep once the above are in.

---

## 2. Deserve to Win

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/possession-edge.tsx](apps/web/src/components/matches/possession-edge.tsx). 587 lines, multi-section component with module header, three-column headline, validation footnote, collapsible contributor breakdown, and methodology row.

### What's working

- **Headline composition is excellent.** Three-column layout `BGM% | Gauge+Verdict | OPP%` reads in one glance: winner percentage / who deserved it / loser percentage. The accent-red flooding the winner side (`59.7%` in red glow) and the muted treatment of the loser side (`40.3%` in fg-3) sells the verdict instantly.
- **Three-state verdict logic with a `|edge| < 3` "coin flip" threshold.** Avoids declaring close games as decisive. The "Too Close to Call" amber pill is a smart middle state — not every match has a Deserved Winner, and the UI acknowledges that.
- **The "✓ Matches actual final · BGM won 4–3" validation footnote** is the secret sauce. It builds trust in the model: when the DtW prediction agrees with the scoreboard, the user sees the model validate itself. When it doesn't, the "⚠ Result mismatch — DtW says X should have" copy is honest and informative.
- **Source provenance badge** in the top-right corner (`● OCR · post-game` with green pulse glow vs `● EA · official` neutral) tells you where the numbers came from at a glance. Pairs well with the gauge using OCR-corrected shot counts (matches Box Score below).
- **Collapsible "Where the edge came from"** keeps the headline clean while making the math available on demand. The chevron rotation feedback is polished.
- **Per-contributor row design is detailed and clear:** Label | Weight pill | BGM value · split bar · OPP value | signed `to DtW` delta. The split bar visualizes the share split and the delta column converts it to its impact on the gauge percentage. Anyone who wants to verify the math can.
- **Informational rows (Faceoff %) are gracefully demoted** — muted opacity, dashed-border `— INFO` pill, diagonal-hatched bar pattern for missing data, "OCR missing" subtitle. The data is acknowledged as known-absent, not pretended to exist.
- **Formula row at the bottom (`SHOTS 50% · TOA 35% · HITS 15%`)** is a compact methodology footer — anyone wondering "how was this computed?" gets the weights inline.
- **Mobile reorders to BGM% / gauge+verdict / OPP%** stacked vertically. Gauge stays the centerpiece. BGM-centric ordering is appropriate for a BGM-fan site.

### Issues — Important

**1. Delta color collision: both positive and negative deltas render in `text-accent` (red).** In the expanded panel, `+7.2 to DtW` (SHOTS, BGM wins) and `-3.5 to DtW` (HITS, OPP wins) both show in accent red. Only the sign differentiates. A quick scan reads "all red = all good", which is wrong — the −3.5 is BGM's loss on that factor. Convention elsewhere on the page (top-performers `+/−`, score-breakdown legend) uses **emerald-400 for positive, rose-400 for negative**. Match it here:
- `winner === 'bgm'` → emerald-400 (BGM gained on this factor)
- `winner === 'opp'` → rose-400 (BGM lost on this factor)
- Tied → fg-3

**2. Contributor bar color follows the winner, not the side.** SHOTS row: 29 (BGM, left) is red, 16 (opp, right) is grey. HITS row: 14 (BGM, left) is grey, 39 (opp, right) is red. The eye learns "red = winner of that factor" but a user scanning quickly for "where did BGM dominate?" can't read it without referencing the delta column. Same root cause as the Box Score bar polarity issue (todo #10). Fix: always color the BGM portion in one consistent token (accent-red when BGM wins that factor, accent-red-faded when BGM loses), and the opp portion in a distinct token (zinc/fg-4 throughout). The bar widths still encode the ratio; the color decouples team identity from outcome.

**3. Redundant "result matches" indicators.** The green pill `✓ Matches actual final` appears in the headline area AND the bottom methodology row repeats `✓ Result matches` (also green). Pick one. Suggest keeping the headline pill (more visible, contextual) and dropping the bottom row indicator. If the bottom row matters as a footer summary, demote it to muted text without the colored emphasis.

**4. Redundant weight display.** Each weighted contributor row has its weight as a pill next to its label (`SHOTS · 50% pill · 29 [bar] 16 · +7.2`). The bottom methodology row repeats those same three weights (`FORMULA · SHOTS 50% · TOA 35% · HITS 15%`). Information theory aside, this is visual repetition. Drop the bottom-row formula (the inline pills already make the math transparent) — or keep only the bottom row and drop the per-row pills (de-clutters the breakdown). My pick: drop the bottom-row formula, since the per-row presentation is contextual and stronger.

### Issues — Minor

**5. "DESERVE TO WIN" appears three times on screen.** Module header label, BGM side caption ("DESERVE TO WIN" under `59.7%`), OPP side caption ("DESERVE TO WIN" under `40.3%`). Twice would be enough. Drop the captions under the percentages, or replace with "BGM" / opp label since the module header already establishes the metric.

**6. Headline `EDGE +19.4` lacks units.** Is it percentage points? Score points? The number is the bgmPct−oppPct delta, so it's percentage points. A small unit tag (`EDGE +19.4 pts`) or implicit `%` would disambiguate, especially given the contributor rows show signed `to DtW` deltas in the same numeric range without units.

**7. `BGM EARNED THIS WIN` verdict pill is celebratory.** Tone-appropriate for a BGM fan site, but consider that the reverse case ("4L SHOULD HAVE WON") is the same loud styling pointed at the user. The amber `Too Close to Call` middle state is softer; the win/loss states could similarly de-emphasize when the verdict goes against BGM. Or accept the current symmetry as a feature, not a bug.

**8. "OCR missing" subtitle on the FACEOFF % informational row reads as an error.** Could be softer: "Not captured" or "Unavailable" with the same diagonal-bar treatment, since the missing data is a known EA-API gap, not an OCR pipeline failure.

**9. Source badge green dot has a glow shadow** even when value is high-confidence. Pleasant visual but conflates "the source is OCR" with "OCR is correct" (green = good). Future maintenance: if a low-confidence OCR result needs flagging, the dot will need a separate color/state, breaking the convention.

**10. Gauge SVG hardcodes colors as inline `var(--color-*)` strings** for segments. Works fine, but the rest of the codebase uses Tailwind classes via `stroke-*`. Stylistic inconsistency, not functional.

**11. The chevron in the collapsible summary** doesn't carry a clear "click to expand" affordance until hover. The text "Where the edge came from" is the click target, but it doesn't look like a button. A subtle "▾" inline next to the label could improve discoverability (the chevron in the corner reads as decorative until pointer-overed).

### Mobile

**12. Mobile stack: BGM% / gauge / OPP% / footnote.** The vertical reorder works but the gauge sits between the two percentages, which means the eye reads `59.7%` → gauge → `40.3%`. The visual relationship "BGM vs OPP" stays intact. The "BGM EARNED THIS WIN" pill and `EDGE +19.4` sit between gauge and OPP%, which feels like they belong to the gauge (correct semantic) but visually they pull attention down past the BGM number. Acceptable as-is.

**13. The contributor breakdown rows reflow cleanly** — label/weight on row 1, bar with values on row 2, delta on row 3. No truncation. Good mobile-first behavior.

**14. The bottom methodology row also reflows** — formula pills wrap to multiple lines on narrow widths. Fine but contributes to vertical bloat if items 3 and 4 (redundancy fixes) aren't addressed.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Per-row delta color: green for positive, rose for negative (replace dual-accent) | 1–2 lines in `ContributorRow` |
| 2 | Consistent bar coloring: BGM always accent, OPP always neutral; vary intensity by winner | 4–6 lines in `ContributorRow` |
| 3 | Drop redundant "✓ Result matches" indicator in methodology row | 4 lines |
| 4 | Drop bottom-row formula pills (per-row weight pills already cover this) | 10 lines |
| 5 | Drop duplicate "DESERVE TO WIN" captions under the percentages | 1 line per side |
| 6 | Add `pts` unit suffix to `EDGE +19.4` | 1 line |
| 7 | Soften "OCR missing" to "Unavailable" or "Not captured" | 1 line |
| 8 | Add small "▾" affordance hint next to the collapsible summary label | 1 line |

Items 9, 10, 11 are stylistic / maintenance polish to address in a separate sweep.

### Related todo cross-reference

- The bar-polarity fix here (#2 above) is the same shape as todo item #10 (Box Score bars). When that lands, the contributor bars here should adopt the same convention for consistency across both modules.

---

## 3. Team Stats

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/team-stats.tsx](apps/web/src/components/matches/team-stats.tsx) (rendering, 116 lines) + [apps/web/src/lib/match-recap.ts:622-720](apps/web/src/lib/match-recap.ts#L622-L720) (data shape `BoxScoreGroup` / `BoxScoreRow` and `buildBoxScore`). Section header was renamed from "Box Score" to "Team Stats" at some point in the renovation — the new label is more accurate (this is team totals, not a per-player box score).

### What's working

- **Three-column grid (`us | label | them`) is the right shape.** Numbers on the outside, label in the middle, bars below. Reads at a glance and stays balanced when long numbers (TOIA `12:42 / 6:11`) or short numbers (`1 / 0`) appear in the same column.
- **Logical grouping with horizontal-rule dividers.** OFFENSE / POSSESSION / DEFENSE / RATINGS, each separated by a `─── TITLE ───` rule. Quick to scan; the eye lands on a group title and processes its rows together.
- **OCR-corrected SHOTS handling is integrated and explained.** The `Shots *` row carries the asterisk; the OFFENSE-group footnote (`* Shots and shooting % are from the in-game Box Score (OCR-reviewed).`) sits right under the offense rows. Compact and discoverable.
- **Empty FACEOFF % row is correctly hidden** when `match.faceoffPct === null` (which is the permanent state for this team — memory note `project_eashl_no_shootout.md` aside). Compare with Deserve to Win's `—-—` placeholder; Team Stats handles the empty case more gracefully.
- **Penalties and SH-goals rows filtered when both sides are zero.** Avoids displaying empty stat rows that don't tell a story.
- **Deflections row correctly grouped under OFFENSE** (a deflection scoring stat) rather than under DEFENSE.
- **Mobile responsive.** The 5rem-1fr-5rem grid holds at 390px; bars stay aligned; no truncation. Vertical layout flows naturally.

### Issues — Important

**1. Bar polarity is inverted for lower-is-better stats.** (Already captured as todo #10.) Concrete example on match 250:
- GIVEAWAYS 44 vs 38 → BGM has more = WORSE → BGM bar renders wider (red, prominent)
- HITS 14 vs 39 → BGM has fewer = WORSE → BGM bar renders narrower (red, weak)

The "wider red = BGM wins" rule fails on giveaways and penalty minutes. A scanner reading the page bottom-up sees "BGM dominated giveaways" which is the opposite of truth. Fix options:
- Track "polarity" per stat and invert the bar fill (or color) for lower-is-better stats
- Always color the BGM bar red regardless of which side is "winning"; use the relative widths to encode the ratio — direction of polarity is implicit in the label semantics
- Add a `↓ better` or `↑ better` micro-indicator on inverted-polarity stats

Same root cause as the Deserve to Win contributor bars. Land them in one sweep.

**2. POSSESSION row shows `1471 vs 1162` with no unit.** (Already captured as todo #13.) The number is some EA-API "possession touches" count. Without a unit, it's meaningless — a casual viewer might think "1471 minutes of possession" (nonsense). TIME ON ATTACK below it (`12:42 / 6:11`) communicates the same idea with a real unit. Either label this as `Possession (touches)` / `Possession events` / `Touches`, or drop the row (TOA covers it).

**3. RATINGS placeholder is dead UI.** "RATINGS ARE RESERVED FOR LATER EXTRACTION / DERIVATION" inside a dashed-border block. (Already captured as todo #15.) On a canonical match page this leaks a TODO into production output. Either:
- Hide the entire RATINGS group when no data exists (cleanest), **or**
- Drop the placeholder and label as `Coming soon` very subtly, **or**
- Just remove the RATINGS group from `buildBoxScore` until shipping

Recommend the first.

### Issues — Minor

**4. DEFENSE group mixes "more is better" and "less is better" stats.** Hits, Blocked Shots, Takeaways, Interceptions, Short-Handed Goals = more is better. Giveaways, Penalties = less is better. Calling the whole group DEFENSE is technically defensible (giveaways are defensive failures) but makes the bar-direction confusion (#1 above) harder to mentally correct. Consider splitting:
- `DEFENSE` (more better): Hits, Blocked Shots, Takeaways, Interceptions
- `DISCIPLINE` or `MISTAKES` (less better): Giveaways, Penalties, Short-Handed Goals against

Or just label the inverted-polarity rows explicitly with a `↓` indicator inline.

**5. Sparse-value bars look misleading.** DEFLECTIONS 1 vs 0 renders as a full-width BGM bar and zero-width OPP bar — visually "BGM dominated deflections" — but the absolute difference is one deflection. The `barWidth` helper uses `Math.max(ours, theirs, 1)` as the denominator, so 1-vs-0 maxes at 1.0 = 100%. Consider:
- Capping bar width at a soft maximum (say 75%) when the larger value is < 5, so visual emphasis matches actual signal strength
- Or rendering no bar at all when the larger value is < 3 (just the numbers)

**6. Side labels say `OPP` not the opponent abbreviation.** Other sections (Deserve to Win, Period Summary) use the actual opp abbreviation (`4L`). Inconsistent. Use `4L` here so the team identity is consistent throughout the page when scrolling.

**7. No visual hierarchy among rows.** GOALS = ASSISTS = DEFLECTIONS = PENALTIES, all rendered at the same typographic weight. The hockey reader treats Goals, Shots, SH% as far more important than Deflections or Interceptions. Could bump the high-significance rows (Goals, Shots, Penalties) one step up in font weight or size, or add a subtle accent on the row containing the final score (Goals).

**8. Token inconsistency.** Team Stats uses raw zinc tokens (`text-zinc-500`, `bg-zinc-800`, `text-zinc-400`) while the renovated components (Top Performers, Deserve to Win, Action Tracker) use CSS-var tokens (`text-fg-3`, `text-accent`, `bg-charcoal`). Functionally identical, but a future palette tweak would touch only some sections. Migrate when convenient.

**9. Bars use `rounded-full`** which is a subtle break from the squared/sharp esports aesthetic everywhere else (Top Performers card chrome is square; Deserve-to-Win contributor bars are square with thin borders). Removing `rounded-full` and adding a 1px zinc-800 border would align with the rest of the page.

**10. No ARIA labels on bars.** Each bar pair has no `role` or `aria-label`. The numbers above the bars carry the data, but a screen reader treating the bars as decorative loses the comparative context. Trivial to add `aria-label="BGM 4, opponent 3"` on the bar wrapper. (Same as todo #26.)

**11. Section header subtitle "Team totals and aggregate stats"** is redundant with the section name. Drop or repurpose.

### Mobile

**12. The 5rem outer columns are oversized for short values on 390px.** When the value is `1` or `5`, there's ~3rem of empty space inside that column. Could allow the value column to shrink-to-content while keeping the label centered. Low priority — current layout doesn't break, just slightly bloated.

**13. Footnote text** (`* Shots and shooting % are from the in-game Box Score (OCR-reviewed).`) wraps to two lines on mobile. Fine; readable. No fix needed.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Bar polarity fix for lower-is-better stats (combined with Deserve to Win #2) | 10–20 lines |
| 2 | Label or drop POSSESSION integer | 1–3 lines |
| 3 | Hide RATINGS group entirely until data ships | 2 lines |
| 4 | Use opponent abbreviation (`4L`) instead of generic `OPP` for side label | 4 lines |
| 5 | Add `↓ better` indicator on inverted-polarity rows (alternative to bar invert) | 6–10 lines |
| 6 | Cap bar width when absolute values are tiny (sparse-value sanity) | 4 lines in `barWidth` |
| 7 | Token migration: zinc → fg-* CSS vars | 10–15 lines |
| 8 | ARIA labels on bar wrappers | 3 lines per Row |
| 9 | Drop section subtitle ("Team totals and aggregate stats") | 1 line |

Items 7, 9–13 are polish to batch with general page-wide token/a11y cleanup.

### Related todo cross-references

- **#10** (bar polarity, Box Score) — same issue, this section is the main offender
- **#13** (POSSESSION integer) — same issue, this section is the only place it appears
- **#14** (FACEOFF % render bug) — already addressed here (row hidden when null); the bug only persists in Deserve to Win's gauge
- **#15** (Ratings placeholder) — same issue, this section is where it lives
- **#26** (ARIA on bars) — same issue, this section + Period Summary are both affected

---

## 4. Lineup & Loadouts

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/lineup-section.tsx](apps/web/src/components/matches/lineup-section.tsx) (1028 lines — by far the largest single component on the page), plus [lineup-ladder.tsx](apps/web/src/components/matches/lineup-ladder.tsx), [lineup-row.tsx](apps/web/src/components/matches/lineup-row.tsx), [lineup-expand-panel.tsx](apps/web/src/components/matches/lineup-expand-panel.tsx).

This is the most distinctive section on the page — a true "tale of the tape" against the opponent's lineup, with per-player drill-downs to the OCR'd attribute deltas. Nothing comparable exists on official EA/NHL post-game UIs. The hockey-fan-with-a-spreadsheet target audience will love this.

### What's working

- **Tale-of-the-tape composition is genuinely original.** Six position rows (C / LW / RW / LD / RD / G), each with BGM card | position badge | opp card, mirrors the in-game scouting sheet but pulls in EA-API metadata (jersey #, captain marker, build archetype, height/weight/handedness, platform) and OCR'd loadout info (build canonical, X-Factor names + tiers, full 23-attribute panel in the drill-down). The mental model `who lines up against whom` carries through the section.
- **Summary band sets the stakes.** Crests + team names + "BGM · HOME" / "4L · AWAY" sublabel, "DRESSED 5/6" / "GOALIE CPU" / "ROOM LEADER #11" KVs, and a row of archetype chips that summarize the team's build composition (`PWF, SNP, 2× PLY, PMD` etc.). The center column (`GAME 250 · VS · EASHL 6s`) anchors the matchup like a fight-card.
- **Position badge column is the connective tissue.** Position letter tinted by position color, a tiny `POS` label, and a matchup tag (`P-MAKER ↔ 2-WAY`) showing the build-vs-build pairing. The matchup tag is the section's signature move — a quick-read of "which build is in this row, on each side."
- **X-Factor stack uses real PNG icons** (44px) when canonical/tier are known, falling back to a tier-colored dot in a ringed circle when not. Tooltip on hover (`title` attr) carries name + tier for screen readers. Tier color hierarchy (Elite=accent red, All Star=neutral light, Specialist=dim) reads at a glance.
- **CPU placeholder card is gracefully demoted.** Diagonal hatch background, "CPU GOALIE" / "CPU" persona label, dashed-border "No human dressed" pill, dimmed silhouette, no X-Factor stack. Visually present but clearly not a contender row. Goalies (where match 250 has CPU on both sides) get this treatment so the row isn't omitted from the ladder.
- **Click-to-expand drill-down is jaw-dropping for the audience.** Per side: BUILD label (PLAYMAKER), H/W/H/LEVEL, full X-Factor list with tiers, then 23 attributes grouped into TECHNIQUE / POWER / PLAYSTYLE / TENACITY / TACTICS, each with absolute value + signed delta from the build's baseline (green positive, rose negative). Side-by-side comparison reveals **exactly** where the build-vs-build matchup hits — at the attribute level, with deltas as the differentiator. This is the section's killer feature.
- **OCR provenance footer is properly humble.** `CAPTURED May 12 2026 → May 16 2026 · SOURCES Pre-game lobby + Loadout view · CONFIDENCE High · 0.96 · CANONICAL 100% · TIERED 100% · ATTRIBUTE 88%` with green/amber tone on individual badges. Tells the user this came from OCR, when it was captured, and how confident the extraction is — non-negotiable for a section this data-rich.
- **`isRenderable` defensive guard.** Rows with no build, no jersey, AND no X-Factors fall back to the CPU placeholder. Prevents half-empty ghost cards from leaking through when OCR partially missed a slot.
- **Only one row open at a time.** `LineupLadder` lifts the `openPosition` state, so opening row B closes row A. Avoids the page becoming a wall of expanded attribute tables.
- **Role/keyboard semantics on the row.** `role="button"`, `tabIndex={0}`, `aria-expanded`, `aria-controls`, Enter/Space handlers — the expand interaction is keyboard- and screen-reader-accessible.

### Issues — Important

**1. In-game character name OCR'd as `E.WANHG` (should be E.WANHO or similar).** (Already captured as todo #28.) Match 250 has visible OCR slips in persona names: `E.WANHG` (probably `E.WANHO` — Erik Wanho?), `WHOOSAH` looks legitimate but worth verifying. A canonical-match page showing visible OCR garbage in a tale-of-the-tape weakens the whole section's credibility. Two strategies:
- Manual correction list for known characters (low effort, scales poorly)
- Post-OCR fuzzy-match against a database of in-game character name aliases (more work, scales)
The user already has `player_display_aliases` for gamertags; an analogous table for `player_name_persona` could close this.

**2. The `MISSISSAUGA BOOGEYMEN` summary band title overlaps the meta strip on tight viewports.** At mid-widths (around 768–900px), the summary side wraps inelegantly and the build-chip row stacks below the KV row, while the opposite side stays compact. Visual asymmetry. Either set a `min-width` on each summary side so both wrap at the same width, or stack the build chips on a new row regardless of width.

**3. Position badge column hides on mobile (`md:flex`).** The badge carries (a) the position letter and (b) the matchup tag (`P-MAKER ↔ 2-WAY`). On mobile both disappear — the position is still visible inside each card's jersey block, but the matchup tag is lost entirely. The matchup tag is the section's signature signal at desktop; losing it on mobile flattens the experience. Recommend pulling a compact `BGM build ↔ OPP build` strip above each mobile row instead.

### Issues — Minor

**4. Opp gamertag `xZ4RKY` truncates to `X.` on mobile** inside the TOEWS card. (Visible in the mobile screenshot.) The persona name (`TOEWS`) takes most of the width and the gamertag gets squeezed. Reserve a minimum gamertag width or move the gamertag to its own line under the persona on narrow widths.

**5. Build-chip row in the summary band uses different visual languages** for ref builds vs bare builds. Ref builds get the full `ArchetypePill` (icon + label), bare builds get a count prefix (`2× PMD`) and the same pill. Visually fine but the count prefix is tiny and easily missed. Consider rendering the multiplier inside the pill or as a small superscript badge attached to the pill.

**6. The persona name (`E.WANHG`, `M.RANTANEN`) vs gamertag (`MrHomiecide`, `Stick Menace`) duality** is conceptually correct but takes a second to parse the first time. Persona is the in-game character name (the human-controlled NHL player), gamertag is the EASHL player behind the controller. Worth a one-line legend at the top of the section (`persona = in-game character · gamertag = EASHL player`) on first viewing, or a tooltip on the persona name explaining what it is. Otherwise new readers will read "M.RANTANEN  Stick Menace" as "Mikko Rantanen, also known as Stick Menace?".

**7. Section subtitle `Pre-game scouting sheet · OCR-derived`** is information-dense. "OCR-derived" is also covered by the provenance footer below. Could simplify to just `Pre-game scouting sheet` — the footer carries the provenance.

**8. The level value `LEVEL 17` for BGM vs `LEVEL 34` for opp** (visible in expand panel) is shown without explanation. New readers will wonder what `LEVEL` means in this context (it's the EASHL player progression level, separate from the in-game NHL player's overall rating). Adjacent context would help; or a tooltip.

**9. Build pill colors (`PLY`, `SNP`, `PWF`, `TWF`, `DFD`, `PMD`)** carry meaningful colors but the section uses them without a legend. The drill-down panel shows the long-form name (`PLAYMAKER`, `TWO-WAY FORWARD`), so users can decode via expand, but a small legend or hover-tooltip on the chips would shortcut the lookup. Cross-references todo #17.

**10. Attribute deltas read in green/rose** — consistent with the page's color convention. Good. But the absolute value (e.g. `80`) is rendered with the same weight as the delta (`-4`), making it slightly hard to tell at a glance whether the player is "above average for the build" (positive deltas in green) or "below average" (negatives in rose). Could bump the delta's weight up slightly or add a sparkline visualization across the attribute group.

**11. The expand panel position-letter `C` in the center column** is a smart visual anchor (reminds you which position you're drilling into). But on smaller widths the center column shrinks and the letter becomes lonely. On mobile the center column is hidden entirely, so the expanded drill-down loses the "this is the C matchup" anchor. Header inside the expand panel saying `Position: C` (or similar) would help.

**12. CPU placeholder subline `EA AI · default loadout · no X-Factors`** appears on every CPU card. Always the same string. Doesn't carry any per-position differentiation. Worth either making it position-specific (`CPU goalie · default tendency`) or shortening since the dashed pill above already says `No human dressed`.

**13. Captain `C` pill** (visible on `MrHomiecide`'s jersey block as a small red `C`) is great but could be more visible. It's currently `9px` tracking-[0.2em] inside a thin red border — easy to miss. The captain is leadership-relevant; a slightly bolder treatment is warranted.

### Mobile

**14. Vertical stacking on mobile is correct but long.** Each ladder row becomes BGM card stacked on opp card with no center divider. The section becomes ~8 viewport heights on mobile (summary + 6 rows + footer). Consider whether the section should be collapsible on mobile (closed by default, with a "view 6-row lineup" button on the section header). Same density argument as Top Performers' carousel suggestion.

**15. The "VS · GAME 250 · EASHL 6s" anchor column** disappearing on mobile means there's no fight-card framing of the matchup. Could be retained as a single horizontal strip above the rows on mobile.

**16. The expanded attribute panel reflows** but the 4-column attribute grid wraps to 2 columns on narrow widths, which works. The TECHNIQUE / POWER / PLAYSTYLE / TENACITY / TACTICS headers separate the groups visually. Good.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Persona name OCR fix list (manual aliases) — eliminate visible OCR garbage | 15–30 lines + data |
| 2 | Mobile: show matchup tag (`P-MAKER ↔ 2-WAY`) as a strip above each row | 10–20 lines |
| 3 | Reserve min-width or wrap gamertag on a new line on narrow widths | 5–10 lines |
| 4 | One-line legend explaining persona vs gamertag (tooltip on persona name) | 10–15 lines |
| 5 | Build-chip legend OR tooltips on PLY/SNP/PWF/etc. (cross-ref todo #17) | 15–30 lines |
| 6 | Tooltip on `LEVEL` value explaining it's EASHL player progression | 5 lines |
| 7 | Position anchor inside expand panel (so mobile retains "C matchup" context) | 10 lines |
| 8 | Drop "OCR-derived" from section subtitle (footer covers it) | 1 line |

Items 9–16 are polish to batch with later sweeps.

### Related todo cross-references

- **#17** (Position pill colors / archetype legend) — same root issue, applies here and in Top Performers + Scoresheet
- **#28** (OCR'd Lineup in-game character names) — directly addressed by issue #1 above

### One Last Note

This is the highest-density-of-original-design section on the page. The drill-down panel rivals the in-game pre-game scouting screen in detail. The OCR provenance footer is best-in-class transparency. The section deserves to be the page's hero example of what BGM stats tracking can do that EA can't.

---

## 5. Box Score (Period-by-Period)

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/box-score.tsx](apps/web/src/components/matches/box-score.tsx). The original 4-card per-period strip (`period-summary.tsx`) has been replaced with a tabbed table. Renovation lands a much more compact and scannable design.

### What's working

- **Tabbed metric switch is a major UX win.** Three tabs (GOALS / SHOTS / FACEOFFS) reveal the same per-period breakdown for each metric. Old design rendered all three metrics in every period card → 12 data points stacked vertically. New design surfaces 12 data points in one compact table with a one-click metric switch. Much faster to scan, much less vertical bloat.
- **Tab summaries carry totals at all times.** Even when the active tab is GOALS, the SHOTS tab still shows `29 – 16 +13` and FACEOFFS shows `70.0% 21 of 30`. Total state is always visible across all three metrics — you don't have to switch tabs to see the headline number for any metric.
- **Per-period winners highlighted in-place.** For GOALS mode, the period where BGM scored more (2nd, OT) shows the BGM number in accent red and the opp number muted; reverse on the period BGM lost (3rd). The table tells the *story* of the game period-by-period without text labels — exactly the right visual encoding.
- **OT period gets distinct color treatment.** Column header for OT renders in `text-otl` (orange), separating regulation from overtime visually.
- **Total column has a subtle accent gradient.** Last column reads as "the answer" — bigger font (24px), accent border-left, gradient background. Winning team's total gets a glow shadow (`text-shadow:0 0 10px rgba(...)`).
- **FACEOFFS mode adds a sub-row of per-period percentages.** BGM row: `6 | 5 | 5 | 5 | 21`, and immediately below in smaller text: `75.0% | 62.5% | 62.5% | 83.3% | 70.0%`. Context without crowding the main row.
- **OCR provenance badge** in the footer (green pulse dot + `OCR-REVIEWED · POST-GAME`) makes the data source explicit and trustworthy.
- **Missing-period footnote.** If OCR couldn't extract a period, the footer shows `⚠ 1ST OCR unavailable — excluded from totals` so the user knows the total is partial.
- **Best-in-class ARIA semantics.** `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `tabIndex={active ? 0 : -1}` (canonical roving-tabindex pattern). Arrow keys, Home, End all wired with `requestAnimationFrame` focus management. Screen-reader-only label on the FACEOFFS sub-row (`sr-only`). Other components on the page don't approach this level of a11y.
- **`em-dash` for unknown values, not `0`.** A missing OCR period shows `—` instead of `0` — preserves the distinction between "we didn't observe this" and "the team didn't score."

### Issues — Important

**1. GOALS tab lacks a delta indicator** (`+1`), while SHOTS tab shows `+13`. The delta indicator is conditional on `mode === 'shots'` only. Goals deserve a delta too — it's literally the most important number on the page (the game's final result). Even tied games could show `±0` for symmetry. Fix is one conditional:

```ts
{(mode === 'shots' || mode === 'goals') && delta !== 0 ? (...) : null}
```

**2. `text-otl` (orange) on OT period header collides with the OTL-loss result color** elsewhere on the page. A casual reader who's seen the `OTL` result pill on the hero card might read the orange OT column header as "this period was lost in OT", which is the opposite of the intended meaning (just "this period was overtime"). Either:
- Use a different color for OT period headers (e.g., the OTL accent but desaturated, or just a different family)
- Or accept the collision since `text-otl` is the closest semantic match for "overtime"

If keeping `text-otl`, add a tooltip clarifying ("OT — overtime period") on hover.

### Issues — Minor

**3. FACEOFFS tab summary phrasing `21 of 30` is slightly unusual.** Reads as "BGM won 21 of 30 total faceoffs." Cleaner alternatives: `21W · 30 total` (echoes hockey convention) or `21/30` (compact). Trivial nit.

**4. `r.periodLabel` is used directly for column headers** instead of going through the shared `formatPeriodLabel(n)` helper introduced in Task 1. Currently OCR-derived labels look like `1ST`, `2ND`, etc. — consistent. But if OCR ever emits a longer form ("2ND PERIOD"), the table layout could break. Adopting the shared helper (`formatPeriodLabel(r.periodNumber)`) future-proofs against OCR drift.

**5. Period numbers `1ST/2ND/3RD` look identical to the table.** In real hockey, the 3rd period is often the most consequential. The current design treats every period equally. Could add a subtle accent (e.g., slightly bolder font, or a thin top border) to the 3rd period column to indicate its weight. Or accept the egalitarian treatment as "data first, narrative second."

**6. `⚠` glyph in the missing-periods footnote** is a different visual language from the `●` pulse-dot used in the OCR-reviewed badge alongside it. Both convey "warning vs okay" but the icon families clash. Either:
- Use `●` (red) for the warning too (consistent shape, color encodes meaning)
- Or use an outline triangle SVG icon instead of the emoji `⚠` for typographic consistency

**7. Section header subtitle is somewhat redundant.** "Period-by-period · OCR-reviewed" — the `OCR-reviewed` part is also in the footer badge. Could drop to just "Period-by-period" since the badge handles provenance.

**8. The active tab's red gradient is subtle.** When you switch tabs, the transition is muted — you might miss the change if your eye is on the table. Consider amplifying the active-tab indicator slightly (e.g., a stronger ticker-strip top accent, or a bolder text contrast on the label). The ticker-strip is already present but at `ticker-strip-thin` opacity.

**9. The total column accent treatment is asymmetric.** BGM winning total gets `text-accent` + glow shadow. Opp winning total gets just `text-fg-1` (off-white, no glow). Fine for a BGM-centric site, but worth being deliberate. Opp wins could get a small treatment (e.g., italic, or a subtle desaturated accent border) so a future "neutral mode" stays balanced.

**10. No per-cell visual heatmap.** Old design used bars; new design dropped them. Trade-off: faster scan, less immediate visual signal of "who dominated." Could optionally add a very faint color tint on the period cell of the winner (e.g., `bg-accent/[0.04]` on BGM-won cells), so the table reads as a heatmap at a glance. Optional polish.

**11. OT lower-period label `OT` not `OT1`.** Standard hockey convention. But if a game ever reaches OT2/OT3, the table will widen to 5 or 6 columns — verify the layout doesn't break on widescreen. Quick check needed before this becomes a problem.

**12. The FACEOFFS sub-row `sr-only` header reads "BGM faceoff percentage by period"** — clear. But the visible per-period percentages have no inline label tying them to "BGM specifically" (the row is below the BGM row, visually). A sighted user reads them as a continuation of BGM data, which is correct, but if any future row sits between BGM and the sub-row, the association breaks. Low risk.

### Mobile

**13. Mobile table fits at 390px** but is tight. Per-period numbers stay readable; the FACEOFFS sub-row of percentages compresses but doesn't truncate. Total column slightly narrower than desktop. Works.

**14. Tab row reflows cleanly to 3 columns** at mobile width. Each tab still shows its summary value below the label. Maintains parity with desktop.

**15. Provenance badge stays on its own line below the table** — readable. The missing-periods warning (if present) would also flow correctly.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Add delta indicator to GOALS tab (parity with SHOTS) | 2 lines |
| 2 | Resolve OT-header color collision with OTL result color (or add tooltip) | 5–10 lines |
| 3 | Adopt shared `formatPeriodLabel(periodNumber)` for column headers | 3 lines |
| 4 | Drop "OCR-reviewed" from section subtitle (footer covers it) | 1 line |
| 5 | Faint heatmap tint on period-winner cells (optional polish) | 6–10 lines |
| 6 | Amplify active-tab indicator (stronger ticker-strip or text contrast) | 3 lines |
| 7 | Cleaner phrasing for FACEOFFS summary (`21 of 30` → `21W · 30 total`) | 1 line |
| 8 | Replace `⚠` emoji with SVG outline triangle for icon consistency | 5 lines |

Items 9–15 are stylistic polish or future-proofing.

### Related todo cross-references

- **Todo #11** ("Normalize Period Summary subtitles") — **OBSOLETE.** The old design's "BGM took this period" / "Lost this period" / "Tied this period" subtitles don't exist in the new tabular design. Recommend removing this todo from the list.
- **#26** (ARIA on bars) — n/a here; this section uses table semantics with proper ARIA already.

### Note

Of all the components on the page, this is the one whose **renovation** is the cleanest. The old design (4 stacked period cards each repeating goals/shots/faceoffs three times) was redundant and verbose. The new tabbed-table design is denser, more scannable, more accessible, and easier to extend (you could add a TOI/Hits tab without restructuring anything). Strong execution.

---

## 6. Scoresheet

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/scoresheet.tsx](apps/web/src/components/matches/scoresheet.tsx) — 451 lines. Player-level stats table for both teams with click-to-expand "Advanced Statistics" drill-down.

### What's working

- **Section subtitle is genuinely useful.** "BGM player profiles linked · opponent rows are match-archive only" tells the user up-front what they can click on. No need to discover the asymmetric link behavior by hovering rows.
- **Two-team layout with team labels.** BGM at top, opp below, each with its own skater + goalie tables. BGM team header gets a small `BGM` pill (accent red) next to the team name; opp gets just the team name. Clear team identity.
- **BGM-tinted table header row.** The BGM skater table uses `rgba(195,67,83,0.14)` background on the `<thead>` row — subtle but enough to telegraph "this side is BGM" even when scrolling past the team-label heading.
- **Position pill + position-full descriptor.** Each player row shows the position pill (e.g. red `C`) AND the position-full label ("CENTER") on the line below. Belt-and-suspenders accessibility — the pill carries the color, the text carries the explicit name.
- **Click-to-expand "Advanced Statistics" drill-down** is impressively detailed: 6 quick-stat tiles, then 5 grouped detail panels (SHOOTING / PASSING & POSSESSION / FACEOFFS & PRESSURE / SPECIAL TEAMS & DISCIPLINE / DISCIPLINE & TURNOVERS). 30+ stat values per player. For data-hungry team members, this is the section.
- **Expanded panel has a "View player profile" CTA** in the top-right (accent red), linking to `/roster/[id]`. Right placement, right color treatment, and `e.stopPropagation()` on click so it doesn't collapse the row.
- **`+/−` color coding** (green positive, rose negative, zinc zero) is consistent with the rest of the page.
- **DNF and GUEST badges** are well-designed inline. DNF in a desaturated zinc, GUEST in amber/orange. Both with tooltip on hover (`title` attr).
- **Featured `PTS` column** (`text-zinc-50 font-bold`) draws the eye to the points total, the most-scanned skater stat.
- **Tables are `overflow-x-auto`** so they scroll horizontally on narrow viewports without breaking the rest of the page layout.

### Issues — Critical

**1. `Shooting %` is mislabeled, and its displayed value of 117% will mislead readers without context.**

The quick-stat tile labeled "SHOOTING %" computes `(shots / shotAttempts) * 100`. That's **Shot On Net %**, not Shooting %. Real shooting % is `goals / shots` — MrHomiecide had 1G on 7 SOG = 14.3% shooting.

The **117% value is not a math bug** — it's a real EA data quirk that the user has seen before:

> *"It is possible to score without shooting. When some event happens that causes the puck to go into the net, the goal is awarded to the person who last touched it on the opposite team."*

So a deflection or redirect where the puck enters the goal credits the deflecting player with `shots +1` (and possibly `goals +1`) but **not** `shotAttempts +1` — because they didn't actually take a shot. Result: `shots > shotAttempts` is legitimate EA data, not a render artifact. The 117% is true to what EA recorded.

But the user-facing display still has two real issues:

- **Wrong label.** The value is Shot On Net %, not Shooting %. Two players seeing "117%" labeled "Shooting %" will reasonably interpret it as "this player scored on 117% of his shots" which is the wrong mental model.
- **Duplicated value.** The same number appears twice in the expanded panel:
  - Top tile: "SHOOTING %" = 117%
  - "SHOOTING" group: "SHOT ON NET %" = 116.7%

Both are the same calculation under different labels, and one of them is mislabeled.

Recommended fix (replaces earlier "clamp at 100%" advice — clamping would hide real EA data):

1. **Rename top tile to "Shot On Net %"** so the label matches the formula.
2. **Drop the duplicate "Shot On Net %" row in the SHOOTING group** to avoid showing the same value twice.
3. **Add a real "Shooting %" tile** that computes `goals / shots * 100` (MrHomiecide → 1/7 = 14.3%). Two separate, correctly-labeled metrics tell the full story: how often did the player hit the net (Shot On Net %), and how often did those shots score (Shooting %).
4. **Optional explainer tooltip on Shot On Net % > 100%** ("can exceed 100% when goals are awarded on deflections that aren't counted as shot attempts") so readers who notice the unusual value understand the EA quirk rather than assuming the page is broken.

**2. Section-redundant detail groups: "Special Teams & Discipline" + "Discipline & Turnovers"** share the word "Discipline" but split the stats arbitrarily. PIM appears in "Special Teams & Discipline" alongside PPG/SHG/Penalties Drawn. Giveaways/Hits/Blocks appear in "Discipline & Turnovers" alongside TOI. The grouping logic isn't intuitive — why is PIM with PPG but not with Penalties Drawn (those go together)? Why is TOI under "Discipline & Turnovers"? Recommend:
- **Special Teams**: PPG, SHG
- **Discipline**: PIM, Penalties Drawn
- **Defense**: Hits, Blocks
- **Turnovers**: Takeaways, Giveaways, Interceptions
- **Workload**: TOI

Or merge the two confusing groups into a single "Discipline & Special Teams" without the splits.

### Issues — Important

**3. Position pill colors are inconsistent across the table.** Visible in the screenshot:
- BGM D pills: HenryTheBobJr `D` (cyan), JoeyFlopfish `D` (cyan/teal)
- 4L D pills: shadowassault20 `D` (yellow/olive), DUH POPE `LW` (purple), MUTTBUTT `D` (yellow)
- BGM C pill (MrHomiecide): red
- BGM LW pill (Stick Menace): green
- BGM RW pill (silkyjoker85): purple/blue
- BGM RW pill on 4L (RAIDERS G7): cyan

Same position rendering different colors across rows is jarring. The `PositionPill` component uses `defenseSide` (left/right) for defense, and the `side` (`bgm` vs `opp`) for the color treatment — but the result is that "D" doesn't have one canonical color. (Cross-references todo #17 from broader review.)

**4. Table layout collapses awkwardly on mobile.** At 390px, the table is `overflow-x-auto` with `min-w-[640px]`. Only PLAYER + G + A columns are visible; PTS / +/− / SOG / Hits / Blks are off-screen to the right. The user has to scroll the table horizontally — there's no visual hint that more columns exist. Two improvements:
- Add a subtle right-edge fade gradient on the panel to signal "scroll right for more"
- Or apply `hideOnMobile` to the lower-priority columns (Hits, Blks) and prioritize the high-value ones (PTS, +/-, SOG)

The `Th` and `Td` helpers already accept a `hideOnMobile` prop but no caller passes it — easy fix.

**5. FO W/L `21-9` for MrHomiecide is misleading.** A single player's faceoff W/L equals the team's total (21-9 BGM). This is **correct** in EASHL (only the center takes faceoffs from his team) but reads ambiguously — the user might think this player took some faceoffs and the rest fell to others. Add a tiny `(team total)` note or rename to `Centerman faceoffs` to clarify. Or accept the convention since hockey-savvy users will infer.

**6. The expanded "Possession" stat appears twice.** Top tile: "POSSESSION 220s" (with `s` suffix). PASSING & POSSESSION group: "POSSESSION 220" (no suffix). Same value, different formatting. Pick one.

### Issues — Minor

**7. Section header has no team crest** (cross-references todo #21). The team names "BGM" and "4TH LINE" appear as text-only headings inside the section. Other sections (Hero, Lineup & Loadouts summary band) use the actual team crests. Reusing the crests here would tie the section back to the team identity visually established at the top of the page.

**8. The expanded panel header reads "Advanced Statistics" / "Per-match breakdown"** — that's a section-title pair, but the panel is inside an already-titled section (Scoresheet). Slightly redundant. Could be just "Per-match breakdown" or simply the player's gamertag.

**9. Quick-stat tile order isn't ordered by importance.** SCORE / SHOOTING % / PASS % / FO % / PIM / POSSESSION. Score and PIM are quite different concerns — Score is "how much did this player help win?" and PIM is "how many penalty minutes did they take?". The 3×2 grid layout shows them adjacent. Could reorder by category (offensive metrics first, then discipline) or by importance.

**10. The ▸ chevron's `transition-transform` rotates to `rotate-90` on expand** — good visual feedback. But the chevron itself is `text-zinc-500` and small. On hover it doesn't brighten (the hover lifts the row background, not the chevron). Could add `group-hover:text-zinc-300` to the chevron so it reads as "this row is interactive."

**11. The expanded row uses `bg-zinc-950/30`** — barely visible against the surface. Hard to tell where the expand panel ends and the next row begins. A slightly stronger background or a top/bottom accent line would help.

**12. "Score" tile in the expanded panel** shows the same value as the Top Performers section's Game Score. No clear connection between the two surfaces — a user might wonder "is this the same score?" Could add a one-line subtitle ("Game Score — see Top Performers") or link the tile.

**13. The "VIEW PLAYER PROFILE" link** is in the top-right of the expanded panel, accent red, uppercase, tracked. Good emphasis. But for OPP players (no profile linked), there's no equivalent — the expanded panel just doesn't show the link. That's correct semantically, but the right side of the opp player's expanded panel is empty. Could fill with the gamertag or a note like "Opponent — no profile."

**14. No keyboard support on row click.** The skater row has `onClick` but no `onKeyDown`, no `tabIndex`, no `role`. Pressing Enter or Space on a focused row doesn't toggle the expand. Compare with the Lineup row (which has full keyboard + ARIA). The DOM `<tr>` is not a button — adding `tabIndex={0}` and a key handler (Enter/Space) would close the gap. ARIA-wise, `role="button"` + `aria-expanded` + `aria-controls` would be the canonical pattern.

**15. The `min-w-[480px]` on the goalie table** is tighter than the skater table's `min-w-[640px]`. Works because the goalie table has fewer columns. Just worth noting that goalie + skater tables have different scrolling thresholds.

### Mobile

**16. Horizontal scroll has no affordance** on the table panel. User can't tell more columns exist. Add a right-edge gradient or use `hideOnMobile` strategically (see issue #4).

**17. Expanded panel reflows correctly to single-column** on mobile — the 3-column grid (SCORE / SHOOTING % / PASS %) becomes a vertical stack. Each tile stays readable. Good responsive behavior.

**18. Position-pill colors AND the "GUEST" badge** all wrap inline with the player name on mobile. RAIDERS G7's row visually has gamertag + GUEST pill + RW pill — three chips in a row. Works but stays tight.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | **Rename "Shooting %" → "Shot On Net %"** + add a real `goals/shots` Shooting % tile + drop duplicate Shot On Net % row in SHOOTING group | 10–15 lines |
| 2 | Reorganize "Special Teams & Discipline" + "Discipline & Turnovers" into intuitive groups | 30–50 lines |
| 3 | Add keyboard + ARIA semantics to skater row (`tabIndex`, `role`, `aria-expanded`, key handler) | 10 lines |
| 4 | Apply `hideOnMobile` to Hits + Blks columns (or add scroll-affordance gradient) | 4 lines |
| 5 | Resolve position pill color inconsistency for D (cross-ref #17) | 5–10 lines in `position-pill.tsx` |
| 6 | Drop duplicate "Shot On Net %" in SHOOTING group OR add real "Shooting %" tile | 5 lines |
| 7 | Unify Possession formatting (with or without `s` suffix) | 1 line |
| 8 | Add team crest icons next to team labels (cross-ref todo #21) | 5–10 lines |
| 9 | Brighten chevron on row hover | 1 line |

Items 10–18 are polish to batch with later sweeps.

### Related todo cross-references

- **#17** (Position pill colors / archetype legend) — directly applies here
- **#21** (Team crests on Scoresheet) — directly applies here
- **#26** (ARIA labels) — applies to the row interaction; complements issue #14 above

### Closing note

The Scoresheet's drill-down is one of the most data-rich surfaces on the page — when expanded, it rivals the Lineup & Loadouts attribute panel in volume. The 117% Shooting % display turned out to be a real EA quirk (goals credited on deflections without a corresponding shot attempt), not a render bug — but the labeling needs to be fixed and the duplicate row removed so the metric reads honestly. Add a real `goals/shots` Shooting % tile alongside Shot On Net %; both numbers tell different stories.

This same EA quirk likely surfaces elsewhere on the page wherever per-player or team SOG / SAT ratios are shown — worth a sweep once the Scoresheet labels are corrected, to make sure no other surface presents the same value under a misleading label.

---

## 7. Event Timeline

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/event-timeline.tsx](apps/web/src/components/matches/event-timeline.tsx) — 1064 lines. The page's primary narrative section: a vertical spine telling the chronological story of the game with running-score chips, period banners, lead-change tags, and special GWG treatment.

**Recent baseline:** Tasks 3 and 7 from the critical block already landed here — period filter chips standardized + raw OCR `eventDetail` removed from goal cards. The clock direction inconsistency (spine=elapsed, card body=remaining) is resolved. This review covers what remains.

### What's working

- **Vertical spine with running-score chips between events** is genuinely the best storytelling device on the page. As you scroll, you watch the score evolve `1-0 → 2-0 → 2-1 → 3-1 → 3-2 → 3-3 → 4-3 WINS`. No other section makes you *feel* the rhythm of the game.
- **Period banners with event counts** (`2ND PERIOD · 2 GOALS · 0 PEN · 2 EVENTS`) anchor each section and let the user judge "how busy was this period?" without scanning the events.
- **Alternating BGM-left / OPP-right card layout on desktop** mirrors the visual language of "your team scored" vs "their team scored." Cards on the left = BGM offense; cards on the right = OPP offense. Visceral signal.
- **Lead-change tags on the running-score chips and inside cards** narrate the rhythm: `BGM TAKES LEAD 1-0`, `BGM +2 2-0`, `4TH CLOSES 2-1`, `— TIED 3-3`, `BGM WINS 4-3`. These four-word phrases are the page's best example of editorial copywriting — they tell you what the score change *meant*.
- **GWG (Game-Winning Goal) treatment is on point.** Special accent-red glow shadow on the card border, `GWG · GAME-WINNER` ribbon banner on the corner, scorer name in accent red. The most important goal in the game gets visible weight. Carries Page-of-Year style.
- **OT banner styling** uses amber/orange (`text-otl` token) consistent with the OT color treatment elsewhere on the page (Box Score column header). The hierarchy stays.
- **OPENING FACE-OFF marker** at top and **FINAL · BGM · 4 – 3** banner at bottom anchor the timeline with start/end states. Red dot on the spine above OPENING and below FINAL.
- **Goal marker hexagons** are visually distinct: BGM = red-filled with white "G" letter, OPP = white-filled with black "G" letter. Clear team identity without text labels.
- **Assists rendering with `△` triangle prefix** is a nice compact visual. Saves space vs `Assists:` prefix.
- **Filter bar (Period + Team)** is clean — chips standardized post-Task 3, 1ST disabled for match 250 (no events).
- **Mobile transformation is gorgeous.** Cards stack vertically with a left-side **accent color stripe** (red for BGM, white for OPP) that distinguishes team at a glance — arguably **better than the desktop** alternating layout because the stripe is always visible without needing the eye to track sides.

### Issues — Important

**1. `4TH CLOSES` tag is ambiguous.** `4TH` reads as either:
- "4th period" — which doesn't exist in regulation hockey
- "4TH LINE" — the team name (correct interpretation here)

The team is abbreviated as `4L` everywhere else on the page (Action Tracker, Faceoff Map, Lineup summary band, Box Score period table). Event Timeline tags use `4TH` instead. Inconsistent. Fix: use the same `oppAbbrev` ("4L") in tags. Or use the full opponent name on first appearance + abbreviation after.

**2. Tied-game score chips render both score numbers in red.** Visible in the screenshot — `3 3 — TIED` has both numbers in `text-accent`. This reads as "BGM tied them" (an active, BGM-favorable framing) when the literal meaning is "the game is tied" (neutral). Fix: when verdict is tied, render both numbers in `text-fg-1` (neutral white). Cross-references todo #20.

**3. Multiple BGM goals stack on one side without alternating.** Period 2 had 2 BGM goals → both cards on the left, leaving the right side completely empty for ~400px of vertical scroll. When BGM has a lopsided period (3+ goals in a row), the asymmetry magnifies. Current rule is `team-side = card-side`. Alternatives:
- Keep current rule (most semantic — left always = BGM)
- Alternate strictly (always L→R→L→R regardless of team) — easier to scan but loses the team-identity-by-position signal
- Hybrid: alternate within a period, but reset to "BGM left" at each period banner

Current behavior is defensible; just call out that long unilateral runs feel unbalanced and consider whether the empty space is intentional.

### Issues — Minor

**4. `BGM +2` tag is unclear.** Could mean:
- BGM leads by 2 goals (correct interpretation)
- BGM scored 2 goals in this period
- BGM has a +2 differential of some other metric

Spelled-out version `BGM LEADS BY 2` would be unambiguous but verbose. Compromise: `BGM +2 LEAD` (3 chars added).

**5. Period banner `0 PEN · N EVENTS` is redundant when 0 PEN.** If `events === goals + penalties` and penalties is 0, then `EVENTS` always equals `GOALS`. Drop the EVENTS suffix when it adds no new info, or change to a different summary like `2 G · 0 PEN` and skip EVENTS.

**6. "GOAL · BGM" / "GOAL · 4TH" header inside cards** uses `4TH` instead of `4L` — same inconsistency as #1.

**7. The card body height varies across event types** but the spine clock chips and running-score chips have fixed sizes. When an event card is taller (e.g., a goal with 2 assists), the spine gap between events feels uneven. Minor; only noticeable when scanning quickly.

**8. The assists `△` triangle prefix** is compact but visually similar to a play-button (▶). Hockey-savvy users will read it as "assist." First-time readers might miss it. Consider `A:` text prefix (more explicit) or a small `↳` (assist of) glyph (more recognizable as a relational pointer).

**9. Lead-change banners are tiny text** (~9px). A reader scrolling fast misses the `BGM TAKES LEAD` cue. Could be slightly bolder/larger relative to the score chips (currently tracks at `tracking-[0.18em]`, weight `font-bold` ~600).

**10. No "jump to event" navigation.** A game with 10+ events produces a ~2000px-tall timeline. A small floating "events" sidebar or anchor links from the period banners would help. Cross-reference: would also help on a tablet form factor.

**11. `OPENING FACE-OFF` marker** has no period or clock context. A user landing in the middle of the page won't know it's the start of the game until they read the words. Could add a small "0:00" or a tiny game-start glyph for clarity.

**12. Score chips between events show `4 3` not `4-3`.** Looking at the chip layout — the two numbers are positioned with a small gap, no explicit hyphen. Reads correctly but a colon or hyphen would tighten the visual: `4-3` or `4·3` would be more conventional.

**13. Running-score chip after a tied event renders `3 3` with both numbers red.** Same issue as #2 above — the tied state should use neutral color for both.

**14. Goal-marker icons (the G hexagons) are the same shape for both BGM and OPP**, only differing in fill color. Consider whether a distinct shape or a small team color border would aid scannability. Current treatment works; this is polish.

**15. No keyboard or ARIA semantics** on the score chips and lead-change banners. They're decorative spans. A screen-reader walking the timeline will hear the scorer name + assists but miss the "BGM takes lead" narrative. Adding `aria-label` to the score chip ("Score after this goal: BGM 1, opponent 0, BGM takes lead") would surface the editorial copy to assistive tech.

### Issues — Cross-component consistency

**16. Tag wording inconsistency across the page.**
- Period Summary (old): "BGM took this period" / "Lost this period" / "Tied this period" (now obsolete — section was redesigned)
- Event Timeline: `BGM TAKES LEAD` / `4TH CLOSES` / `— TIED` / `BGM +2` / `BGM WINS`
- Box Score period winner: implicit via accent-red coloring, no text label
- Deserve to Win: `BGM Earned This Win` / `4L Should Have Won` / `Too Close to Call`

The Event Timeline tags are the most editorial of all of these. Style guide for tag voice (active vs passive, abbreviated team name vs spelled-out) would harmonize cross-section.

### Mobile

**17. Left-accent stripe pattern is excellent.** A 3px red border for BGM cards, white for opp. Eye reads team identity instantly without parsing the card content. **Should be ported to desktop** to replace (or supplement) the alternating-sides layout. Cross-reference todo #29.

**18. Period banners stay full-width on mobile** with all three counts (`2 GOALS · 0 PEN · 2 EVENTS`). Reads fine. No truncation.

**19. Score chips between events disappear on mobile** — only the cards stack. Spine and chips are desktop-only (`hidden sm:flex` per the code). The story-of-the-score narrative is preserved through the in-card lead-change tags. Acceptable, but desktop users get more narrative weight than mobile.

**20. GWG card on mobile** retains the accent-red glow and ribbon. Good.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Use `oppAbbrev` consistently (`4L` everywhere, not `4TH`) | 5 lines |
| 2 | Neutral color for tied-game score chips (cross-ref todo #20) | 4 lines |
| 3 | Clarify `BGM +2` → `BGM +2 LEAD` | 1 line |
| 4 | Drop redundant `EVENTS` from period banner when it equals goals+penalties | 5 lines |
| 5 | Port mobile left-accent stripe to desktop (cross-ref todo #29) | 10–20 lines |
| 6 | `aria-label` on score chips with full narrative | 5 lines |
| 7 | Stronger weight/size on lead-change banners | 1–2 lines |
| 8 | Replace `△` assist prefix with `A:` text or `↳` glyph | 2 lines |
| 9 | Tag voice style guide for cross-section harmony | docs |

Items 10–20 are polish.

### Related todo cross-references

- **#12** ("Normalize Event Timeline running-score chip tags") — directly addressed by issues #1 (4TH→4L) and #4 (BGM +2 clarity)
- **#20** (Tied-game chip color) — directly addressed by issue #2
- **#24** ("Add '1ST PERIOD' banner") — **OBSOLETE.** Post-Task 3, empty periods show as a *disabled filter chip* (1ST is dimmed in the chip row). The timeline never had a 1ST PERIOD banner because there were no events; this was the right call. The current empty-period treatment is the disabled chip — recommend removing this todo.
- **#29** (port mobile accent stripe to desktop) — issue #5 above

### Closing note

The Event Timeline is the page's strongest narrative element — and the editorial copy (`BGM TAKES LEAD`, `4TH CLOSES`, `BGM WINS 4-3`) is genuinely well-written. Most remaining issues are consistency tightening (4L vs 4TH) and small visual refinement. The post-critical-block state is in good shape; the polish list is small and impact is incremental rather than transformational.

---

## 8. Action Tracker

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/action-tracker-map.tsx](apps/web/src/components/matches/action-tracker-map.tsx) — 1419 lines, the second-largest component after Lineup & Loadouts. Two-pane layout: scrollable event list on the left, hockey-rink visualization with event markers on the right.

**Recent baseline:** Task 4 from the critical block landed here — period filter chips standardized + `whitespace-nowrap` added to fix the mobile `PERIOD` truncation. This review covers what remains.

### What's working

- **Two-pane layout (events list left, rink map right) is genuinely powerful** for the audience. A user can scroll the event list to find a specific play, and the rink shows where it happened spatially. Nothing comparable exists in EA's post-game UI.
- **Filter row carries counts inline.** `GOALS 2 · SHOTS 10 · HITS 15 · PENALTIES 0 · FACEOFFS 7 (LIST ONLY)`. You see what's available before clicking anything. Each chip shows its count without requiring a click to discover the total.
- **`GOALS ONLY` quick-filter toggle** in the top-right collapses the rink to just goals — the most-asked question about any game. Right-placed for prominence.
- **Player/tag search input** lets you filter by name. Drop-in support for "show me all of MrHomiecide's events." Powerful for replay analysis.
- **Period filter standardized post-Task 4.** Chips show `ALL 94 · 1ST 0 · 2ND 34 · 3RD 36 · OT 24` with counts; 1ST is disabled (no events). Same pattern as other sections.
- **OCR provenance metadata is honest.** `OCR CONFIDENCE 1.00 · SOURCE: Action Tracker OCR · v2`. The user knows where the data came from and how confident the pipeline is.
- **`UNPLACED 7` correctly accounts for faceoffs.** Faceoffs are tracked but not spatially plotted (Faceoff Map below handles them). The summary row owns up to the math: 34 visible events, 27 on rink, 7 unplaced — they all add up.
- **Rink rendering with attack-direction labels.** `4L ← DEFENDS / ATTACKS → BGM`. Orients the viewer on which net BGM was attacking — critical context for reading the markers.
- **Event markers distinguish team identity** (red-ring for BGM, white-ring for OPP) and event type (S = shot, H = hit, G = goal letters inside the circle). Visually compact.
- **Selected event row has a subtle accent** (red left-accent stripe + lighter background). Visible in the screenshot — SILKYJOKER85 GOAL row is highlighted as the most recent click target.
- **`5-ON-5 ICE` subtitle** under the rink heading indicates the strength state. Future-proof for power-play / short-handed displays if needed.

### Issues — Important

**1. `UNPLACED` is still mild jargon (Task 4 partially addressed todo #18 by renaming from `DISPLACED`).** The new word is better but still ambiguous — "what wasn't placed?" Better candidates:
- **`OFF RINK`** (implies "events not on the rink visualization")
- **`NO POSITION`** (more literal)
- Hide entirely when 0 (often the case)

Worth a one-line tooltip on hover regardless of the label: "Events that occurred but couldn't be plotted on the rink (typically faceoffs, which are shown in the Faceoff Map below)."

**2. `OCR CONFIDENCE 1.00` should hide when ≥ 0.99.** (Already captured as todo #19, still pending.) A perfect score is uninformative noise; surface only when sub-confident. When `< 0.99`, render with an amber color and a tooltip explaining the metric.

**3. Event-list rows have no hover-link to rink markers.** (Already captured as todo #23.) Click a row → you'd expect the corresponding rink marker to highlight or scroll into view. Currently the two panes are parallel views without integration. The data layer can connect them (event ID matches marker ID), so this is purely a UI wiring task. Highest-value polish on this section.

**4. `FACEOFFS 7 (LIST ONLY)` parenthetical is cryptic.** Assumes the reader knows what "LIST ONLY" means (= shown in event list, not plotted on rink). Better:
- Icon-only treatment with a hover tooltip ("Not plotted on rink — see Faceoff Map below")
- Or a small info icon (`ⓘ`) instead of the parenthetical

**5. Summary stats row mixes three concepts in one horizontal strip.**
- Filter scope: `VISIBLE 34 / ON RINK 27 / UNPLACED 7`
- Event breakdown: `GOALS · BGM 4 / 4L 3 / SHOTS 31 / HITS 35 / PENALTIES 0`
- Provenance: `OCR CONFIDENCE 1.00 / SOURCE: Action Tracker OCR · v2`

All visually equal-weight, which makes hierarchy hard to scan. Reorganize:
- Top row: event breakdown (the most important: `4 - 3 GOALS · 31 SHOTS · 35 HITS · 0 PEN`)
- Below: filter scope (smaller text) and provenance (smaller, right-aligned)

Or break into two distinct strips with a visual separator.

### Issues — Minor

**6. `GOALS · BGM 4 / 4L 3` is the most important number on the page (the final score) but gets cramped treatment** alongside SHOTS/HITS/PENALTIES at the same weight. Visually, GOALS is just one of five count chips. Could be promoted (larger font, accent treatment) or moved to its own row.

**7. Markers cluster near the net** (visible in the screenshot — multiple `S`, `H`, `G` overlap on the right side of the rink). When too many events happen near the same spot, they become unreadable. Possible mitigations:
- A subtle jitter / dodge layout when markers overlap
- A "zoom" interaction on dense areas
- Or accept clutter as data signal (lots of action in that zone)

**8. Event letters S/H/G/P inside markers require a legend.** A first-time viewer sees `S` in a circle and has to infer "shot." The filter row above has `SHOTS 10` next to a shot icon — a connection exists, but it requires looking up. Could add a small legend in the rink header: `S = shot · H = hit · G = goal · P = penalty`.

**9. `DEFENDS / ATTACKS` orientation labels are subtle** (`text-fg-5`, small size). For a section that depends on understanding "which net is BGM attacking," the labels should be stronger. Bump weight / size, or render as a colored arrow over the corresponding half of the rink.

**10. Rink orientation may not flip between periods.** In real hockey, teams switch ends each period. EA may or may not track this; the action tracker's rendering shows a single orientation for the whole game. Worth verifying whether the markers' positions account for the switch. (Out of scope for this review; flag as a data-correctness item.)

**11. Event list rows are tall (~65px each).** For a 34-event period the list is ~2200px tall — exceeds the rink height (which is roughly fixed). Rink stays static while list scrolls. Could use sticky positioning on the rink so it stays in view during long scrolls.

**12. No keyboard navigation between events.** Arrow keys don't move through the list. Tab doesn't focus rows. Adding `tabIndex` + arrow-key handler would allow speed-scanning through events with the keyboard.

**13. `EVENTS · sort · BY PERIOD` dropdown** — the alternatives aren't immediately visible. What else can you sort by? Time within period? Event type? Player? Worth exposing the options or listing them in the dropdown (probably already works on click, but the affordance is unclear from the screenshot).

**14. `34 shown` count at top-right of event list** — accurate, but redundant with the period banner ("2ND PERIOD · 34 events") right below. Could pick one location.

**15. Selected row indicator (red left-stripe + lighter bg) is subtle.** Works but could be more prominent — maybe a brighter accent or a faint glow on the row.

**16. `FACEOFF` event in the list shows `FACEOFF` as the event-type pill** (red border, red text). But faceoffs have no rink marker — the row says "yes I exist" but the rink doesn't show it. The disconnect is exactly what `(LIST ONLY)` is trying to communicate, but in the row context it's not obvious. A small "no rink position" icon on the row would close the loop.

**17. The summary stats row's `GOALS · BGM 4 / 4L 3`** uses `4L` correctly (consistent with Faceoff Map, Box Score period table). The Event Timeline section uses `4TH` inconsistently — Action Tracker is the right reference. Cross-reference Event Timeline issue #1.

### Issues — Cross-component consistency

**18. Action Tracker filter row uses period chips with counts** (`2ND 34`). Event Timeline filter row uses period chips without counts. Box Score tabs use counts in the tab summary. The convention varies across sections. Standardize on always-show-counts.

**19. Action Tracker uses `4L` (correct).** Event Timeline uses `4TH` (incorrect; see Event Timeline issue #1).

### Mobile

**20. Mobile compresses to single-column** — filter row + summary stats + event list, then rink below. Cards stack vertically. Already verified working post-Task 4 (`whitespace-nowrap` fix on period chips).

**21. Mobile rink is small** but readable. Markers stay distinct enough. Acceptable density.

### Suggested next moves (small, concrete)

Ordered by impact:

| # | Change | Effort |
| --- | --- | --- |
| 1 | Wire event-list row hover → corresponding rink marker highlight (todo #23) | 30–50 lines |
| 2 | Hide OCR confidence when ≥ 0.99; show with amber/tooltip when sub-confident (todo #19) | 10 lines |
| 3 | Rename `UNPLACED` → `OFF RINK` or hide when 0; add tooltip (todo #18) | 5 lines |
| 4 | Promote `GOALS · BGM 4 / 4L 3` in the summary stats row (typography weight) | 5–10 lines |
| 5 | Reorganize summary stats into 2 distinct strips (event breakdown above, provenance/scope below) | 20–30 lines |
| 6 | Inline rink legend (`S = shot · H = hit · G = goal`) | 10 lines |
| 7 | Replace `FACEOFFS 7 (LIST ONLY)` parenthetical with info icon + tooltip | 5 lines |
| 8 | Sticky positioning on the rink panel during long list scrolls | 5 lines |
| 9 | Keyboard navigation through event list (arrow keys) | 15–25 lines |

Items 10–21 are polish.

### Related todo cross-references

- **#18** (DISPLACED jargon) — Task 4 renamed to `UNPLACED`, partial fix; issue #1 above proposes further refinement
- **#19** (Hide OCR confidence at 1.0) — directly addressed by issue #2
- **#23** (Event hover → marker highlight) — directly addressed by issue #1

### Closing note

The Action Tracker is the page's most ambitious data-visualization component — and arguably the section that delivers the most analytical value once you understand the conventions. The biggest single improvement available is wiring the event-list-to-rink-marker hover linkage (todo #23): right now the two panes are parallel views of the same data without integration, and connecting them would transform the section from "two parallel reports" into "one interactive map." Everything else is polish.

---

## 9. Faceoff Map

Reviewed 2026-05-17. Source: [apps/web/src/components/matches/faceoff-map.tsx](apps/web/src/components/matches/faceoff-map.tsx) — 501 lines.

**Direction noted up-front:** the user has flagged this section as the weakest on the page and is leaning toward scrapping it or merging into Action Tracker. This review reflects that framing — diagnosing why it's the weakest, identifying what's worth salvaging if it gets merged, and what to drop outright.

### Why it's the weakest

**1. Low information density per pixel.** The section adds ~700px of vertical scroll. 9 faceoff dots × 2 numbers (BGM/OPP win counts) = 18 data points spread across a 600px rink. Most dots in EASHL 6s never see a faceoff (corners, behind-the-net) — those markers render as `— —` placeholders, contributing noise without information. In the screenshot, **4 of 9 dots show `— —`** (the corner dots in both ends never fire). The signal-to-real-estate ratio is poor.

**2. Most of its data is redundant.** Per-team overall faceoff % is already shown in:
- Box Score FACEOFFS tab (`70.0% · 21 of 30`, plus per-period breakdown)
- Top Performers (MrHomiecide shows `FO % 70` on the C card)
- Scoresheet expanded panel (`FO W/L 21-9`, `FO % 70%`)
- Deserve to Win contributor row (currently `INFO` because EA reports null, but the data exists from OCR)

The Faceoff Map's overall percentages (`72.73%` BGM / `26.67%` 4L) don't agree with the other sections' 70.0% — likely a per-dot OCR weighting vs raw count difference, but **the numbers diverging from the rest of the page erodes credibility** rather than building it.

**3. The genuinely unique value is small.** Only two data points exist nowhere else:
- Per-dot win counts (geographic distribution)
- OZ/DZ summary chips (`OZ 6/7 · DZ 2/4`)

Both could fit in a 6-row table or a single chip group. Neither justifies a full section.

**4. Section visually competes with Action Tracker's rink.** Two hockey-rink visualizations stacked one above the other (Action Tracker + Faceoff Map) is visually repetitive. A user scrolling past Action Tracker sees another rink and thinks "didn't I just see this?" The information context is different, but the visual chrome is identical.

**5. Faceoff-map data is the LAST piece of OCR tuning** (per HANDOFF.md — deferred after v10). The section is the most data-quality-fragile, and its standalone existence makes any quality issues highly visible. Folding it into Action Tracker (where faceoffs already exist in the event list, just without spatial coordinates) would hide the quality issues during a less-prominent visualization.

### What's worth migrating

**A. Shield-marker design.** The shield-shaped per-dot markers (red for BGM, dark for OPP, with win counts inside) are genuinely well-designed. Visually distinct from any other marker on the page. If Action Tracker gets a new faceoff marker type, this shape could become it (sized smaller, like the existing S/H/G markers).

**B. Per-dot win counts.** The granular data answers "where did BGM dominate faceoffs?" — a real question. In Action Tracker, this could surface as:
- Faceoff markers on the rink (currently faceoffs are `(LIST ONLY)`, unplotted)
- Hover/click tooltip on each marker showing the dot's overall win record (`Center: BGM 3 - OPP 0`)

**C. OZ/DZ summary.** The offensive-zone vs defensive-zone breakdown is genuinely useful (centers who win defensive-zone faceoffs are gold). Could live as a sub-row in Box Score FACEOFFS tab (`OZ: 6/7 · DZ: 2/4 · NZ: 3/3`) or as a small chip group at the top of the Action Tracker filter row.

### What to drop outright

**D. Standalone section.** The whole `<FaceoffMap>` component, including its header (`FACEOFF MAP · POST-GAME OCR · PER-DOT WIN COUNTS`).

**E. Duplicate period filter.** AT and Box Score both already let you filter by period. A third one is redundant.

**F. `— —` placeholder markers on unused dots.** Render only the dots that have data (5 of 9 on match 250 — center + four end-zone dots).

**G. The "overall %" chips at the top.** They duplicate what Box Score already shows, and they disagree with Box Score's value (72.73% vs 70.0%). Pick one source of truth; drop the other.

### Suggested next moves

If keeping (against the user's current lean):

| # | Change | Effort |
| --- | --- | --- |
| 1 | Drop `— —` placeholder markers on unused dots | 5 lines |
| 2 | Reconcile overall % with Box Score (one source of truth) | 5–10 lines |
| 3 | Compress the rink size by ~30% (it's the wrong-priority widget on the page) | 5 lines |
| 4 | Drop the duplicate period filter (or keep it as the only place faceoffs filter by period) | 5 lines |

If merging into Action Tracker (the user's current lean):

| # | Change | Effort |
| --- | --- | --- |
| A | Add faceoff event coordinates to the `match_events` rows (data layer) | depends on OCR pipeline |
| B | Render faceoff markers in AT's rink (new marker type, "F" letter or the shield shape) | 30–50 lines in AT |
| C | Move OZ/DZ summary chips to Box Score FACEOFFS tab or AT filter row | 10–15 lines |
| D | Add per-dot hover tooltip showing dot win record (`Center: BGM 3 - OPP 0`) | 15–25 lines |
| E | Delete `faceoff-map.tsx` + the section render in `page.tsx` | -501 lines |

If scrapping outright (simplest):

| # | Change | Effort |
| --- | --- | --- |
| X | Delete `faceoff-map.tsx` + remove section render in `page.tsx` | -501 lines, -1 import |
| Y | Move OZ/DZ summary into Box Score FACEOFFS tab (only piece worth keeping) | 10 lines |

### Mobile

The Faceoff Map renders correctly on mobile (rink scales down, shield markers compress). But the mobile case actually *amplifies* the "why is this a section?" problem — vertical scroll is more expensive on mobile, and this section adds ~600px of scroll for ~5 actually-data-bearing markers. Worth less on mobile than desktop.

### Closing note

The Faceoff Map's individual design choices are fine. The problem is at the section level — its existence as a standalone module costs page real-estate disproportionate to its unique value. The data it carries (per-dot win counts, OZ/DZ breakdown) is genuinely interesting but small enough to fit into adjacent sections. Recommend: **merge into Action Tracker** as a new marker type + small summary chip group; delete the standalone component. Keep the shield-marker design alive for the new AT faceoff marker.

If the merge is too much work, **scrap outright** and live with one place (Box Score FACEOFFS tab) showing faceoff totals. The unique value lost (per-dot geography) is a "nice to have," not a "must have."

---

<!--
## 10. Context Footer
... last component remaining.
-->
