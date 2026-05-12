# OCR Metrics And Feature Brainstorm

Date: 2026-05-10

This document scopes what in-game OCR data can unlock for the Boogeymen stats site. It is a feature and analytics brainstorm, not a schema implementation plan.

The key idea: EA data remains the canon for scores and aggregate stats. OCR becomes a reviewable evidence layer that adds sequence, context, locations, player builds, and screen-only details.

## Big Unlocks

### Match Timeline

OCR can turn a match from a final box score into an ordered story.

Data:

- goal time
- goal period
- scorer
- primary assist
- secondary assist
- scorer goal number in game
- penalty time
- penalty period
- penalty culprit
- infraction
- minor/major type
- shot, hit, faceoff, penalty, and goal sequence from Action Tracker

Features:

- period-grouped event log on `/games/[id]`
- goal timeline
- replay-friendly event list
- game-winning goal highlight
- comeback/collapse recap
- penalties that directly preceded goals against
- momentum swing timeline
- "response goal" callouts after conceding

Metrics:

- goals by period
- goals in final 5 minutes
- goals while tied, leading, or trailing
- first-goal win rate
- response goals within N minutes
- 3rd-period goal differential
- OT goal count
- game-winning goals by player
- penalty timing distribution
- goals against after penalties
- player clutch index

## Rink Location

The Action Tracker map can expose where events happened. For selected events, the highlighted icon can be detected visually and converted into normalized rink coordinates.

Data:

- shot location
- goal location
- hit location
- penalty location
- faceoff location
- offensive/neutral/defensive zone
- left/right faceoff dot
- raw screen pixel coordinate
- normalized rink coordinate
- optional human-readable grid cell

Features:

- team shot heatmap
- player shot heatmap
- goalie goals-against heatmap
- high-danger chance map
- hit map
- penalty map
- faceoff map
- period-filtered rink map
- game flow map by period

Metrics:

- slot shot rate
- point shot rate
- perimeter shot rate
- high-danger goal rate
- average shot distance
- average goal distance
- shot quality proxy
- player location tendencies
- goalie save percentage by zone
- shots allowed by zone
- hits by zone
- penalties by zone
- offensive-zone faceoff win rate
- defensive-zone faceoff win rate

Implementation note:

- Store continuous coordinates first: `x_norm`, `y_norm`.
- Derive grid cells second, such as `A7`.
- A Battleship-style overlay is useful for review and debugging, but it should not be the database truth.

## Player Builds And Loadouts

Player Loadout View and pre-game lobby screens expose data the EA API does not provide.

Data:

- build class
- selected position
- height
- weight
- handedness
- X-Factors
- player level
- platform
- jersey number
- player name
- attribute values across Technique, Power, Playstyle, Tenacity, and Tactics

Features:

- `/loadouts` build library
- player profile loadout history
- build comparison between players
- build-to-performance analysis
- X-Factor frequency leaderboard
- team build distribution
- opponent build scouting
- build change timeline

Metrics:

- most-used build class per player
- X-Factor usage rate
- build stability score
- average attributes by player
- average attributes by role
- speed vs shot creation
- faceoff attribute vs faceoff results
- size/weight vs hit rate
- defensive awareness/stick checking vs takeaways
- handedness vs shot-side tendency

## Lineups And Roles

Pre-game lobby OCR can capture who actually dressed, where they lined up, and whether a slot was CPU/empty.

Data:

- our lineup
- opponent lineup
- slot position
- player level
- platform
- build hint
- CPU/empty slot flag
- readiness
- party leader

Features:

- pre-game lineup card on match pages
- opponent scouting cards
- exact line-combination history
- CPU/empty-slot warning badges
- position-switch history
- recurring opponent roster tracking

Metrics:

- games by actual position
- position-switch frequency
- win rate by lineup
- win rate by center-wing pair
- win rate by defense pair
- performance with CPU slot vs full human lineup
- teammate chemistry with exact lineup context
- recurring opponent player count

## Period Splits

Post-game box score screens expose period-level goals, shots, and faceoffs.

Data:

- goals by period
- shots by period
- faceoffs by period
- overtime rows
- final totals for reconciliation

Features:

- period summary widget
- "best period / worst period" labels
- slow-start detector
- strong-finish detector
- game recap sentence generator
- per-period trend charts

Metrics:

- 1st-period shot share
- 2nd-period shot share
- 3rd-period shot share
- goal differential by period
- faceoff win rate by period
- overtime shot differential
- late-game shot suppression
- shot surge windows

## Shot Types

Net Chart screens can add shot-type context that aggregate match stats do not provide cleanly.

Data:

- wrist shots
- snap shots
- backhand shots
- slap shots
- deflections
- power-play shots
- side/team split
- period filter, if captured

Features:

- shot mix widget
- team shot-style profile
- player shot-style tendencies
- goalie scouting: what beats us
- "too many low-danger shots" warning
- special-teams shot mix

Metrics:

- wrist-shot share
- slap-shot share
- backhand-shot share
- deflection share
- power-play shot share
- goals by shot type, when paired with goal events
- shot-type efficiency
- period shot-type changes

## Penalty And Discipline

Events screens and Action Tracker can explain penalty context instead of only counting PIM.

Data:

- infraction
- minor/major type
- culprit
- period
- clock
- team side
- location, after spatial extraction

Features:

- penalty ledger
- player discipline card
- penalty type leaderboard
- bad-penalty flags: late, tied, defensive zone
- post-penalty sequence review

Metrics:

- penalties taken per game
- penalty minutes per game
- penalty type distribution
- late-game penalty rate
- defensive-zone penalty rate
- player penalty burden
- goals against after player penalties
- penalty-kill result by infraction type

## Chemistry And Playmaking

Goal events with two assists unlock a real scoring network.

Data:

- scorer
- primary assist
- secondary assist
- goal time
- period
- inferred game state

Features:

- assist web
- scorer-provider pair cards
- line chemistry graph
- most common scoring chains
- player profile setup-target section

Metrics:

- scorer-assist pair count
- primary assist rate
- secondary assist rate
- shared point rate
- goal involvement percentage
- teammate dependency index
- points by period
- clutch assists

## Opponent Scouting

OCR can collect opponent details that are otherwise difficult to preserve.

Data:

- opponent gamertags
- opponent lineup
- opponent builds
- opponent X-Factors
- opponent shot locations
- opponent penalties
- opponent faceoff zones

Features:

- opponent profile page
- recurring opponent scouting notes
- last-match-vs-this-team card
- dangerous opponent shooter map
- opponent faceoff tendency report
- opponent build library

Metrics:

- record vs opponent
- recurring opponent player count
- opponent shot map
- opponent penalty tendencies
- opponent build class distribution
- opponent faceoff win zones
- opponent scoring sources

## Data Quality Features

OCR will be noisy. That can still be valuable if the system makes uncertainty visible.

Features:

- OCR review queue
- confidence dashboard
- low-confidence field triage
- duplicate screenshot detection
- EA-vs-OCR disagreement report
- match page discrepancy badges
- review history for promoted fields

Metrics:

- OCR success rate by screen type
- average confidence by screen type
- field missing rate
- field disagreement rate
- review backlog
- reviewed vs pending count
- promotion rate
- duplicate capture rate

## Best First Features

Low risk, high value:

- match page period summary
- match page event log
- loadout history on player profiles
- build library
- assist web
- clutch goals by player
- OCR review queue

Next:

- shot-type breakdown
- penalty analysis by infraction
- opponent scouting cards
- lineup chemistry
- response-goal and momentum metrics

Later, after spatial extraction:

- shot heatmaps
- hit maps
- penalty maps
- faceoff maps
- high-danger shot metrics
- goalie weakness maps

## Site Placement Plan

This section maps OCR features onto the current site. The goal is to enhance existing pages first, then add new routes only when the data deserves a dedicated surface.

### Home `/`

Keep home high-level. Do not add dense OCR modules here.

Enhance existing latest result and recent results with small OCR signals:

- event data available
- period splits available
- shot map available
- lineup captured
- review pending / reviewed state

Home should tease richer game stories and route users into `/games/[id]`, not explain OCR data in detail.

### Games Index `/games`

Use the games list as a scan-and-filter surface.

Enhance match cards with:

- OCR coverage indicator
- reviewed / pending / missing screenshot state
- notable story labels:
  - OT winner
  - comeback
  - late collapse
  - PP trouble
  - shot-volume mismatch
- future filters:
  - has OCR
  - has events
  - has rink locations
  - has lineup capture

This page should help find interesting games, not show the full event data.

### Game Detail `/games/[id]`

This is the primary OCR destination.

Existing page structure already has natural OCR modules:

- `PeriodSummary`
- `ShotMix`
- `EventLog`
- `ShotMap`

Enhance existing modules:

- make `PeriodSummary` a visual period grid with goals, shots, faceoffs, and period winner
- make `EventLog` the main game-story module for goals, penalties, late shots, and swing events
- keep `ShotMix` compact as a tactical readout
- expand `ShotMap` once spatial extraction is reliable, with filters for shots, goals, hits, penalties, and faceoffs
- add pre-game lineup card after team stats or after event log:
  - BGM vs opponent slots
  - positions
  - build classes
  - X-Factors
  - CPU/empty flags

The match page should answer: what happened, when did it happen, where did it happen, and who drove it.

### Roster `/roster`

Keep roster as team/player navigation.

Enhance existing roster/depth-chart surfaces with compact OCR hints:

- current build class
- latest captured X-Factors
- actual recent position from lobby/game OCR
- stale build warning
- OCR-confirmed role badges

Do not turn roster into an analytics dump. Use it to point users toward player profiles.

### Player Profile `/roster/[id]`

This is the second major OCR destination.

Existing page structure already has OCR-ready modules:

- `LoadoutHistoryStrip`
- `CareerShotMap`
- EA shot maps
- game log
- contribution sections

Enhance with:

- richer loadout history
- current build card
- X-Factor history and frequency
- build comparison against team/position average
- role/position drift: listed role vs OCR-captured roles
- personal event splits:
  - goals by period
  - assists by period
  - shots by zone
  - penalties by period/zone
- career event map once spatial extraction is reliable

The player page should answer: how does this player play, where do they create events, and how has their build changed?

### Stats `/stats`

Use stats for team-wide conclusions, not raw OCR detail.

Add aggregate OCR sections:

- Period Tendencies:
  - goals by period
  - shot share by period
  - faceoff rate by period
- Clutch Stats:
  - late goals
  - OT goals
  - response goals
  - game-winning goals
- Penalty Profile:
  - infractions
  - late penalties
  - penalties leading to goals against
- Assist Web:
  - scorer-provider pairs
  - primary/secondary assist network
- Shot Type Mix:
  - wrist/snap/backhand/slap/deflection breakdown
- Build Meta:
  - build class distribution
  - X-Factor usage
  - attribute averages by role

Existing chemistry sections are the right home for assist-web expansion.

### My Performance `/me`

Use account ownership to make OCR insights private and actionable.

Add:

- my latest loadout
- my loadout changes
- my goals and assists by period
- my shot locations
- my penalties and discipline notes
- my best chemistry partners
- my goals tied to OCR metrics:
  - reduce defensive-zone penalties
  - increase slot shots
  - improve late-game faceoffs
  - use build attributes more consistently

This should feel like a coaching/performance dashboard, not a duplicate of the public profile.

### New Route: `/loadouts`

Add later, once loadout OCR is reliable enough.

Purpose:

- roster-wide build library
- current build per player
- build comparison
- X-Factor leaderboard
- attribute averages by role
- build changes over time

This route should be a catalog, not a match-analysis page.

### Admin Review: `/admin/ocr`

Add under admin, not public navigation.

Required capabilities:

- review OCR extraction batches
- approve/reject fields
- inspect confidence and missing fields
- link capture batches to matches
- show EA-vs-OCR disagreements
- detect duplicates
- mark fields as promoted

This is the trust gate. Public features should only read reviewed OCR data.

## Existing Feature Enhancements

Enhance these current surfaces rather than replacing them:

- `TeamShotMap`: blend EA season shot zones with reviewed OCR match-event coordinates.
- `ChemistrySection`: add assist web and scorer-provider pair views.
- `PlayerGameLogSection`: add OCR event badges per game.
- `ScoreCard`: add OCR availability and notable-story badges.
- `ProfileHero`: add latest build, X-Factor, and actual role hints.
- `DepthChart`: show OCR-confirmed recent lineup/build context.
- `LatestResult`: show OCR story badges and link to reviewed event log.

## Recommended Delivery Order

1. Make `/games/[id]` OCR sections useful: period summary, event log, shot mix.
2. Expand `/roster/[id]` loadout history and career event maps.
3. Add `/stats` aggregate OCR sections.
4. Add `/me` personalized OCR coaching/performance cards.
5. Add `/loadouts`.
6. Add full admin OCR review UI.

Prioritize match detail and player profile first. Stats gets aggregate conclusions. Home and games index get small navigation signals. Admin gets review and trust controls.

## Guiding Rules

- OCR never silently overwrites EA canon.
- OCR starts as evidence.
- Reviewed OCR enriches match detail and build history.
- Keep raw OCR JSON forever.
- Keep field-level confidence.
- Keep coordinates continuous, then derive grid cells.
- Keep opponent data, build data, and performance data separate enough that mistakes are reversible.
