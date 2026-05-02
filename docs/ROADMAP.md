# Roadmap

## Product Defaults

- **Site type:** Internal team dashboard for EASHL club #19224
- **Primary audience:** Team members (captain + active roster)
- **Core surfaces:** Home, player profile, club stats
- **Desired feel:** Stats tool + team brand + archive
- **Strategic priority:** Data correctness over feature breadth

---

## Current Priority

Stable foundation. All major surfaces are live. Near-term work is quality-of-life improvements and analytics depth, not structural changes.

---

## Near-Term Build Order

### 1. Polish existing surfaces

**Matches:**

- Match-card pills for result + mode + one derived quality stat on `/games` list
- Top Performers position-pill contrast — labels are hard to read against star-card gradient backgrounds
- Verify "Show all player scores" breakdown shows all opponent players (not a partial subset)

**Navigation:**

- Remove `EASHL · #19224` subtitle from the navbar — keep branding aligned with club identity

**Player profile:**

- EA season time-on-ice totals (skater + goalie TOI separately when available)
  - Format as long-duration: `17d 22h 47m`
  - Reference ratio: EA hockey TOI ≈ 78% of platform total game time (silkyjoker85 NHL 26 reference point)
  - Use ratio only as a rough backfill estimation aid, not a claimed stat

### 2. Deepen analytics on existing data

**Chemistry (already live — W/W-out + Best Pairs):**

- Increase weight of `deflections` and `blocked shots` in the skater game-score model
- Explore position-adjusted game score (actions valued differently by role)
  - Blocked shots may deserve more credit for wingers (less role-expected)
  - Plus/minus may carry heavier weight for defensemen
  - Faceoff impact should matter mainly for centers
- Deeper possession-quality metric:
  - Base: possession time
  - Adjust by giveaway/takeaway ratio
  - Adjust by shots/shots-on-net conversion
  - Adjust by pass completion quality
  - Philosophy: productive possession rewarded; empty puck-hogging punished
- Chemistry heatmap — deferred; revisit at ~80–100+ match depth

**Roster:**

- ~~Mode filter on `/roster`~~ ✅ Done — All / 6s / 3s pills, EA totals for All, local tracked for 6s/3s

### 3. Operations

- Discord alerting — cron checks `localhost:3001/health`, notifies when stale >30 min
- `pg_dump` backup cron — daily dump to external drive
- ~~Verify `clubs/seasonRank` + `settings` field shapes~~ ✅ Done — live DB row confirmed, all widget fields correct

---

## Deferred Until Preconditions Exist

### Blocked by missing data source

- Hot-zone / rink-spatial shot visualizations
- Match-specific event maps (current payloads don't contain shot coordinates)
- Investigate whether EA exposes `ShotsLocationOnIce*` / `GoalsLocationOnIce*` in any endpoint
  - Chelhead-captured payloads appear to include such fields
  - Verify exact endpoint family before building

### Blocked by low data volume

- Deep consistency analytics
- Long-horizon trend interpretation
- Advanced player-profile analytics requiring stable baselines
- Chemistry heatmap (target: ~80–100+ matches with meaningful pair density)

### Blocked by weak feature evidence

- Player comparison tools
- Advanced search / discovery

---

## Longer-Term Direction

- Optional manual lineup/coach overrides on depth chart
- Better archive value as data accumulates
- Richer team identity without sacrificing data correctness
- Possible VOD/ML ingestion project (not relevant to current planning)

---

## Completed

| Item | Done |
|---|---|
| Phase 0–4: Foundation, worker, frontend, production | ✅ |
| Depth chart on `/roster` | ✅ |
| Player profile V1 (`/roster/[id]`) | ✅ |
| Official EA club record on home page | ✅ |
| Opponent crest pipeline | ✅ |
| Season rank / division widget | ✅ |
| Game-mode filter (All / 6s / 3s) across all surfaces | ✅ |
| Source split: All=EA totals, 6s+3s=local tracked | ✅ |
| Game log on player profile | ✅ |
| EA season totals section on player profile | ✅ |
| Contribution radar on player profile | ✅ |
| Match detail page V1 (story strip, goalie spotlight, scoresheet) | ✅ |
| Chemistry analytics: W/W-out + Best Pairs on `/stats` | ✅ |
| DTW gauge color split fix | ✅ |
| Form strip "Last N" label coherence fix | ✅ |
| Event Map dead-weight placeholder removed | ✅ |
