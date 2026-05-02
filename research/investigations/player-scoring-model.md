# Player Scoring Model — Research & Calibration Log

> Research conducted: 2026-04-30 – 2026-05-01
> Status: **Final v3** (frozen — do not redesign without evidence)

---

## Background

The match detail page (`/games/[id]`) shows a "Top Performers" score and a "Show all player scores" expandable section. The scoring model must produce a meaningful rank order that matches intuitive hockey sense. We went through three calibration rounds.

---

## Reference Models

### Luszczyszyn Game Score (Hockey Graphs, 2016 — NHL)

```
G=0.75, A1=0.70, A2=0.55, SOG=0.075, BLK=0.05,
PD=0.15, PT=−0.15, FOW=0.01, FOL=−0.01,
CF=0.05, CA=−0.05, GF=0.15, GA=−0.15
Goalie: −0.75×GA + 0.10×SV
```

**Key implication:** Primary assists are nearly as valuable as goals (0.70 vs 0.75 = 93% of a goal). Average assist weighted 65/35 primary/secondary = 0.645. G:A ratio ≈ 1.16:1.

### NWHL Game Score (Hockey Graphs, 2018)

```
G=1.0, A=0.64, SOG=0.11, FOW=0.12, FOL=−0.12, PEN=−0.17
Goalie: 0.14×SV − GA
```

G:A ratio 1.56:1. No giveaways/takeaways.

### MoneyPuck

Documents team-level predictive models only — not usable as a per-player formula anchor.

**Key gap:** Neither published model includes giveaways or hits. Both use shot-attempt differential (Corsi) as the possession-quality signal. Since we have giveaways/takeaways but not Corsi, those become our possession proxy.

---

## Chelhead Reverse Engineering

From the 7-1 match data (G0obers, 2026 NHL):

| Player | Stats | Chelhead Score |
|---|---|---|
| SilkyJoker85 | 1G 6A +6 6H | 31.20 |
| Camrazz | 4G 1A +6 6H | 24.40 |
| JoeyFlopfish | 2G 2A +6 10H | 21.10 |

**Finding:** Chelhead values 6 assists higher than 4 goals. This implies assists weight ≥ goals — consistent with EA's own Ratings model. Chelhead's primary score is EA's official Ratings field (Off/Def/Team numeric values like 100.00 / 70.00 / 95.00), not our counting-stats model. We cannot replicate those because EA's rating fields are not extracted in our transform pipeline.

---

## Calibration History

### V1 (original — wrong)

```
goals × 4.0 + assists × 2.0 + plusMinus × 0.5 + ...
```

**Problems:**
- G:A ratio = 2.0:1 — too goal-heavy vs published models
- Assists dramatically underweighted; a 1G 6A player ranked below a 4G 1A player
- Hits at 0.1 — 10 hits = +1 point, essentially invisible
- Missing: interceptions, blocked shots, faceoff net, penalties drawn

### V2 (first correction)

```
goals × 4.5 + assists × 3.0 + plusMinus × 0.75 + shots × 0.15
+ hits × 0.2 + interceptions × 0.4 + blockedShots × 0.35
+ takeaways × 0.4 + giveaways × −0.3 + foNet × 0.12
+ penaltiesDrawn × 0.6 + pim × −0.2
Goalie: saves × 0.2 + svPct × 15 + goalsAgainst × −0.8
       + despSaves × 0.5 + breakawaySaves × 0.8 + penShotSaves × 0.8 + pokechecks × 0.15
```

**Remaining problems:** G:A ratio 1.5:1 still too goal-heavy vs published 1.16–1.56 range; +/- at 0.75 was second-largest modifier, causing "+/- dominates in blowouts" problem.

### V3 — Published-model anchored (current/final)

```
goals × 4.0 + assists × 3.25 + takeaways × 0.55 + interceptions × 0.45
+ blockedShots × 0.45 + penaltiesDrawn × 0.40 + giveaways × −0.45
+ pim × −0.30 + shots × 0.12 + plusMinus × 0.20 + hits × 0.08 + foNet × 0.08
```

**G:A ratio: 1.23:1** — within published range (1.16–1.56). Four-tier structure:

| Tier | Factors | Weights |
|---|---|---|
| 1 — Core offense | Goals, Assists | 4.0, 3.25 |
| 2 — Strong positive | Takeaways, Interceptions, Blocks, Pen. Drawn | 0.55, 0.45, 0.45, 0.40 |
| 3 — Strong negative | Giveaways, PIM | −0.45, −0.30 |
| 4 — Light context | Shots, +/-, Hits, FO Net | 0.12, 0.20, 0.08, 0.08 |

---

## Validation — Real Match Data

### Match 121: 7-1 vs G0obers (goal-heavy)

| Player | Stats | V3 Score |
|---|---|---|
| silkyjoker85 | 1G 6A +6, 2 GAs | 28.07 ← **#1** |
| camrazz | 4G 1A +6, 15 GAs | 18.36 |
| JoeyFlopfish | 2G 2A +6 | 17.63 |

Silky ranks #1 because 6 assists × 3.25 = 19.5 base, 15 giveaways × −0.45 = −6.75 drag on camrazz. The assist weight correctly counterbalances high goals in this context. **Correct result.**

### Match 113: 3-4 vs Buffalo Lippers (assist-heavy)

| Player | Stats | V3 Score |
|---|---|---|
| Pratt2016 | 1G 2A | 12.40 **#1** |
| Stick Menace | 2G 0A, 8 GAs | 12.35 **#2** |
| HenryTheBobJr | 0G 2A, 1 pen drawn | 9.55 **#3** |

2G vs 1G 2A within 0.05 — genuinely equivalent performances. **Correct result.**

### Match 117: 0-4 vs HalfHard (shutout)

All tracked players scored negative (−1.95 to −3.29). Ranking defensible. **Correct result.**

---

## Known Limitations

- Goalie scoring model is structurally correct but effectively inert — only 1 BGM goalie row in entire DB (match 6). Insufficient data to validate.
- EA's official Ratings fields (Off/Def/Team) are not extracted from the transform pipeline. Chelhead uses those as its primary score signal — we cannot replicate that.
- No Corsi/shot-attempt differential — giveaways/takeaways are the possession proxy.

---

## UI Implementation

- `match-recap.ts` — `skaterBreakdown()` and `goalieBreakdown()` compute scores; `buildAllTeamScores()` merges both sides
- `top-performers.tsx` — renders top 3 with star ranking (★★★ = #1)
- Star ordering: rank 1 = ★★★, rank 3 = ★ (more stars = better)
- Score labeled "Score = weighted composite (computed from player stats)" — not EA Ratings
- BGM entries: `score > 0` guard (suppresses AI bench slots)
- Opponent entries: no filter (real players can score negative)

---

## Bug: Opponent Players Silently Dropped

**Discovered:** 2026-05-01

`buildAllTeamScores` originally applied one shared filter: keep only entries with `score > 0` or goalies with saves. In match 121, 3 of 5 opponent players had net-negative scores (high giveaways, −6 +/-). They were silently dropped from "Show all player scores."

**Fix:** Split the filter. BGM keeps `score > 0` guard (still needed to suppress AI bench rows). Opponent entries pass through unconditionally.

**File:** `apps/web/src/lib/match-recap.ts` — `buildAllTeamScores()`
