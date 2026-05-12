# Player Profile Page V1 Spec

## Summary

Build the player profile as a **single long page** with an **esports-identity hero**, **current-season-first hierarchy**, and one meaningful analytic section. The page should feel like a flagship internal team profile, but remain grounded in **trusted data only**.

Primary inspirations:
- **Chelhead**: hero presence, profile feels like a person not just a row, one standout analytic
- **NHL.com**: current-season-first hierarchy, clean progression from snapshot to deeper stats
- **Esports profiles / Liquipedia patterns**: role, identity, concise profile metadata, archival/history framing

V1 should **not** attempt hot zones, deep consistency analytics, or heavy teammate/chemistry systems.

## Key Changes

### 1. Page structure and section order

The profile should be a **single page with anchor navigation**, in this order:

1. **Hero**
2. **Current Season Snapshot**
3. **Contribution Wheel**
4. **Recent Form**
5. **Career Stats**
6. **EA Season Totals**
7. **Full Game Log**
8. **Gamertag History**

Anchor pills under the hero:
- `Overview`
- `Career`
- `EA Totals`
- `Game Log`
- `History`

This keeps the page single-scroll while still making it navigable.

### 2. Hero behavior

The hero should be **identity-forward**, not a plain stat block.

Content:
- Gamertag as the dominant headline
- Small team-context line or chip cluster
- Position badge using `preferredPosition` when present, otherwise ingested/current position
- Optional club-role badge using a **manual text badge**
- Optional jersey number
- Optional nationality
- Optional short bio
- “Last seen” timestamp remains present but subordinate

Manual profile data policy:
- V1 supports **DB-only admin edits**
- No profile editor UI in this slice
- Manual fields used by the hero:
  - existing: `jerseyNumber`, `nationality`, `preferredPosition`, `bio`
  - new: `clubRoleLabel` as nullable manual text field in `player_profiles`

If manual fields are empty, the hero still renders cleanly with:
- gamertag
- position badge
- last seen
- role snapshot below

### 3. Current Season Snapshot

Top stat area is **current-season-first**.

Data-source rule:
- Use **EA season totals** for current-season summary metrics where available
- Use clearly labeled local-derived metrics only when EA does not provide an equivalent
- Keep source labeling visible and explicit

Top snapshot should show **primary role only**.
Primary role selection:
- choose the role with the higher current-season GP
- if tied, prefer the player’s preferred/manual position
- if still tied, prefer skater over goalie

Snapshot blocks:
- **Skater primary role**:
  - GP
  - G
  - A
  - PTS
  - +/- 
  - Hits
  - PIM
  - one supporting rate stat: `P/GP`
  - appearance record: `W-L-OTL`
- **Goalie primary role**:
  - GP
  - W-L-OTL
  - SV%
  - GAA
  - SO
  - Saves
  - one supporting rate stat: `SV/GP`

If the player has meaningful history in the secondary role:
- render a **compact secondary-role summary strip** below the primary snapshot
- do not duplicate the full hero block

Goalie-specific content anywhere on the page must be gated by **actual goalie game count**, not declared position.

### 4. Contribution Wheel

V1 includes **one** standout analytic section: a contribution wheel.

Purpose:
- make the player page feel smarter than a pile of tables
- stay feasible with the current data model

Rules:
- Use **current-season data**
- Role-aware presentation
- No fake precision or opaque formulas

Implementation model:
- a six-dimension visual contribution summary normalized **against teammates in the same role group** for the same season/game title
- role groups:
  - skaters
  - goalies

Skater dimensions:
- Scoring
- Playmaking
- Shooting Volume
- Physicality
- Possession
- Discipline

Suggested inputs:
- Scoring: goals per GP
- Playmaking: assists per GP
- Shooting Volume: shots per GP
- Physicality: hits per GP
- Possession: takeaways per GP adjusted down by giveaways per GP
- Discipline: inverse PIM per GP

Goalie dimensions:
- Win Rate
- Save %
- GAA (inverted)
- Saves / GP
- Shutouts / GP
- Workload

Suggested inputs:
- Win Rate: wins over total goalie decisions
- Save %: goalie save percentage
- GAA: inverted score, lower is better
- Saves / GP
- Shutouts / GP
- Workload: shots against / GP

Presentation:
- if sample size is too small for a role, show a muted “not enough tracked data” state instead of pretending accuracy
- do not call this an advanced analytics engine; call it a contribution summary

### 5. Recent Form

Include a compact **Recent Form** section above the deep tables.

V1 should avoid thin line charts. Use a concise recent-performance block built from the most recent locally tracked games.

Content:
- last 5 games summary
- recent `G / A / PTS` for skaters
- recent `SV% / GA / W-L` for goalies
- recent record during appearances
- optional small “best recent game” callout if trivial to compute from existing data

This keeps the page current without overcommitting to fragile trend systems.

### 6. Deep data sections

Keep the lower half trustworthy and plain.

**Career Stats**
- Boogeymen career / recorded-history totals and breakdowns
- keep existing career table structure, but fix goalie-column gating
- if season-by-season is not available beyond game-title scope, do not invent it

**EA Season Totals**
- keep as a clearly labeled secondary section
- do not fold it fully into the hero
- explicit label that this is EA-reported season data and not mode-filtered

**Full Game Log**
- keep paginated local game log
- maintain mode filter behavior
- keep source-clear empty states

**Gamertag History**
- keep as the archival bottom section
- no redesign beyond aligning it with the page’s visual language

## Public Interfaces / Data Changes

### Data / query additions

Add one profile-focused server query or loader shape that aggregates:
- hero/profile identity
- primary vs secondary role determination
- current-season summary
- recent-form summary
- contribution-wheel inputs

Avoid spreading this logic across multiple page-local helpers.

### Schema additions

Add to `player_profiles`:
- `clubRoleLabel text null`

Purpose:
- support one simple manual badge in the hero
- DB-managed manually for now
- no editor UI in this slice

### Existing data rules to preserve

- mixed-source UI is acceptable only if labeled
- EA remains the canonical season-total source
- local tracked data remains the source for game log and advanced/acute sections
- goalie-only sections use **goalie GP**, not primary position

## Test Plan

### Data semantics

- Skater with zero goalie GP does not render goalie-only hero or table blocks
- Player with both skater and goalie history picks the correct primary role
- Appearance record uses team record during appearances by default
- Secondary role strip appears only when the player has meaningful data in that role
- Contribution-wheel dimensions do not render bogus values when denominators are zero

### Rendering / UX

- Hero degrades gracefully when manual profile fields are null
- Club-role badge renders only when present
- Anchor navigation jumps to sections correctly
- Recent Form shows a truthful empty state when not enough tracked games exist
- EA Totals remains visible as a secondary labeled section
- Game log pagination and mode filtering continue to work

### Acceptance scenarios

- Fully enriched profile: jersey, nationality, preferred position, bio, club-role badge all populated
- Minimal profile: gamertag plus auto position only
- Skater-only player
- Goalie-only player
- Dual-role player with skater-primary
- Member-only player with no local match history

## Assumptions

- V1 is a **single page**, not a tabbed profile
- Current-season-first hierarchy is the intended default
- The player profile is the flagship polish surface later, but V1 still prioritizes correctness
- Hot zones are out because the current data source does not support spatial events
- Consistency dashboard and deeper trend analytics are deferred until tracked match volume is materially larger
- No admin/profile edit UI is included in this slice; manual profile data is DB-managed
