# Roadmap

## Current Priority

The current priority is **stable stats baseline**.

This means:

- data correctness over feature breadth
- hardening semantics before adding more analytics
- fixing migration / reprocess / ingestion issues before building decorative surfaces

## Product Defaults

- Site type: internal team dashboard
- Primary audience: team members
- Most important surfaces: home, player profile, club stats
- Desired feel: stats tool + team brand + archive
- Out of scope for now: news

## Immediate To-Do

### 1. Fix current correctness and deploy blockers

- Fix player-profile goalie column gating in `apps/web/src/app/roster/[id]/page.tsx`
- Fix depth-chart record display logic in `apps/web/src/components/roster/depth-chart.tsx`
- Fix opponent-club completeness logic in `apps/worker/src/ingest-opponents.ts`
- Repair Drizzle migration metadata for `0012_cloudy_hulk`
- Verify migrate + reprocess path before treating this branch as deployable

Acceptance:

- skaters do not render goalie-only sections incorrectly
- depth-chart cards show the intended record semantics
- opponent clubs without `customKit` are not re-fetched forever
- migration state is internally consistent

### 2. Harden the data model and semantics

- Keep `wins/losses/otl` as team record during player appearances by default
- Drive goalie-only views from actual goalie game count
- Add regression coverage for data semantics before new product work
- Verify season-rank correctness or demote the widget until verified
- Keep mixed-source UI clearly labeled where EA and local tracked data differ

Acceptance:

- known stat inaccuracies are reduced before new surfaces are added
- tests cover semantic expectations for player/goalie data

## Near-Term Build Order

### 3. Improve home and matches first

Home:

- reduce visual priority of division standing
- keep latest result and player-focused modules ahead of standings
- add a compact club snapshot / signal block if it can be derived cleanly

Matches:

- add match-card pills for result + mode + one derived quality stat
- add recent-form summary bullets
- add one or two simple trend charts using existing data only

Not for now:

- no huge analytics wall
- no public/cup/private taxonomy emphasis
- no derived metric that cannot be defined from current data

### 4. Redefine `/roster` as the main team-members page

Target structure:

- team overview
- depth chart
- roster stats table below the chart
- skater and goalie views supported

Rules:

- no minimum-position threshold
- 1 game at a position is enough to count
- manual/member-only additions are allowed but should be marked provisional
- fuller inferred board is preferred over sparse honesty

### 5. Improve player profile structurally

Priority:

- stronger hero snapshot
- better skater-vs-goalie synthesis
- positional usage visualization if supported by current data
- clearer explanation of data sources

Do not build yet:

- hot-zone maps (blocked by missing spatial data)
- consistency dashboard if the match volume is still too thin
- full advanced-pro-analytics parity

## Deferred Until Preconditions Exist

### Blocked by missing data source

- hot-zone maps
- rink-spatial shot / goal visualizations

### Blocked by low data volume

- deep consistency analytics
- long-horizon trend interpretation
- advanced player-profile analytics that need stable baselines

### Blocked by weak feature evidence or weak local need

- player comparison tools
- advanced search / discovery
- Discord alerting as a priority feature

## Longer-Term Direction

- richer team identity site without sacrificing stat correctness
- optional manual lineup/coach overrides
- better archive value over time
- possible future VOD/ML ingestion project, but not relevant to current build planning
