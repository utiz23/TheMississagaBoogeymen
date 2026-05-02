# Match Detail Page — Design Research & Implementation Log

> Page: `/games/[id]`
> Primary research: 2026-04-30 – 2026-05-01

---

## Reference Surface: Chelhead

Chelhead's match/game page exposes:
- **GWG, Shooting%, Pass%, FO%, PIM, Possession** per player
- Three EA-provided **numeric Ratings** (Off, Def, Team — e.g. 100.00 / 70.00 / 95.00)
- The Ratings are Chelhead's primary scoring signal — we cannot replicate without extracting EA's rating fields in transform

Key difference: Chelhead's star score is primarily driven by EA's official Ratings fields, not counting stats. Our model uses a weighted counting-stats composite instead.

---

## Section Structure (current)

Top → bottom on `/games/[id]`:

1. **Hero/Score** — score panel with BGM vs OPP, result, date, mode pill
2. **Top Performers** — top 3 with star ranking (★★★ = #1), score + breakdown link
3. **"Deserve to Win" (DTW) Gauge** — semicircular possession/shot-share meter, TOA row
4. **Team Stats** — two-column comparison with progress bars
5. **Goalie Spotlight** — save stats for any goalie(s) who played
6. **Scoresheet** — expandable BGM + opponent tables with G/A/PTS/+/-/SOG/position

---

## Score Card Stat Row Design

Stat row order (final): **SOG → TOA → Hits → DtW**

| Stat | Format | Notes |
|---|---|---|
| SOG | `BGM-OPP` split (our number bold, theirs muted) | `SplitStat` component |
| TOA | `BGM-OPP` or BGM-only if opponent null | Formatted as `MM:SS` |
| Hits | `BGM-OPP` split | `SplitStat` component |
| DtW | Single number, color-coded | ≥60 teal, 52–59 emerald, 45–51 amber, ≤44 rose |

FO% removed — always null. Pass% was tried but replaced with DtW (Deserve to Win shot share) for more meaningful single-stat game quality indicator.

---

## DtW Color Thresholds

These thresholds encode game quality:

| DtW | Color | Meaning |
|---|---|---|
| ≥ 60% | Teal | Dominant shot share |
| 52–59% | Emerald | Controlled game |
| 45–51% | Amber | Contested |
| ≤ 44% | Rose | Outshot |

**DNF games**: DtW suppressed (no value displayed) — score for a forfeited game is meaningless.

---

## Score Card Visual Design

Result-color system:
- **WIN**: emerald glow + green top bar + `text-emerald-400` result pill
- **LOSS**: rose glow + rose top bar + `text-rose-400` result pill
- **OTL**: amber treatment
- **DNF**: neutral/grey

Mode pills:
- **6s**: violet (`border-violet-500/80 bg-violet-950/50 text-violet-300`)
- **3s**: sky (`border-sky-400/80 bg-sky-950/50 text-sky-300`)
- Kept distinct from result colors and from each other

Quality badges at top-right of card:
- **"Dominated"** (green): BGM shot share ≥ 65%
- **"Outshot"** (rose): BGM shot share ≤ 35%
- **"Private"**: `club_private` match type

Team abbreviation: "BGM" not "Boogeymen" — too long for the 56px panel column.

---

## Scoresheet Design

- Position shown **under player name**, not in a separate column (follows Chelhead pattern)
- **SOG** column promoted (replaces dedicated Pos column)
- BGM header uses accent red background — visually distinguishes BGM table from opponent table
- Opponent players not linkable (no profile page for them)

---

## "Show All Player Scores" Section

Expandable section below Top Performers. Shows BGM + opponent players scored and ranked.

**BGM filter:** `score > 0` only — suppresses AI bench/empty slots
**Opponent filter:** No filter — all opponent players shown including negative scores

The `buildAllTeamScores()` function in `match-recap.ts` generates both sides. Scores are computed by `skaterBreakdown()` / `goalieBreakdown()`.

Score display: `XX.XX` format. Breakdown tooltip shows contributing factors (label, value, weight, contribution). Stars: rank 1 = ★★★, rank 3 = ★.

---

## Form Strip (on `/games` list page)

Shows last 5 results as color-coded pills + W-L-OTL tally.

**Denominator rule:** `n = wins + losses + otl` (not `matches.length`).
- `matches.length` includes DNF which breaks the label coherence.
- "Last 7: 5-2-1" should mean exactly 7 countable results, not 7 matches including forfeits.

**Trend Bullets:** Fire only at high-confidence signals:
- ≥ 3-game win streak: "W streak: 3+"
- ≥ 4/5 shot dominance (≥65% DtW): "Shot dominance: 4 of last 5"

Kept intentionally conservative — no fabricated trend signals.
