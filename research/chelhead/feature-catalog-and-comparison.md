# Chelhead Feature Catalog And Comparison

## Scope

This document compares the captured Chelhead surfaces against the current app in this repo.

Chelhead artifacts reviewed:

- `research/chelhead/club/`
- `research/chelhead/players/`
- `research/chelhead/matches/`
- `research/chelhead/player-profile/`
- `research/chelhead/advanced-search/` as a low-priority appendix

Local app surfaces reviewed:

- `apps/web/src/app/page.tsx`
- `apps/web/src/app/stats/page.tsx`
- `apps/web/src/app/games/page.tsx`
- `apps/web/src/app/roster/page.tsx`
- `apps/web/src/app/roster/[id]/page.tsx`
- supporting components in `apps/web/src/components/...`

## Important Current-App Caveat

This comparison is against the current working tree, not a pristine stable release.

Known branch issues that affect roster/player interpretation:

- player profile goalie-column gating is wrong
- depth-chart record display is wrong for skaters
- opponent metadata completeness logic is wrong
- migration `0012_cloudy_hulk.sql` is not fully registered in Drizzle metadata

Those issues matter operationally, but they do not change the product-level comparison much.

## Executive Read

Chelhead is stronger than the current app in four areas:

- analytics density
- charting and trend surfaces
- heat-map / spatial data presentation
- player-level advanced breakdowns

The current app is stronger than Chelhead in three areas:

- cleaner visual hierarchy on featured player cards
- simpler and more readable home-to-stats flow
- willingness to separate source labeling and honest empty states

Your product preference is not “copy Chelhead.” It is closer to:

- adopt Chelhead’s information architecture where it is genuinely better
- keep your own visual language
- separate skater and goalie identity more aggressively than Chelhead does
- avoid junk surfaces like achievements/division clutter unless they add real value

## Page-By-Page Catalog

## 1. Club / Home Surface

Chelhead club page currently includes:

- top-level club identity and navigation
- large record summary
- titles count
- points total
- win/loss/OTL donut or pie visualization
- current division record module
- club snapshot / signal list with narrative bullets
- achievements block
- ranking and division block
- club analytics section with time-window filters
- advanced insights / advanced analytics path

What Chelhead does well here:

- turns the club landing page into a dashboard, not just a stat dump
- uses visual summaries early before forcing tables
- “club snapshot” creates immediate takeaways instead of making the user infer everything
- trend modules appear above the fold and make the page feel active

What Chelhead does poorly or what you already rejected:

- division/ranking/achievement clutter is too prominent
- some modules feel like generic gamer-meta filler rather than team-ops value
- dashboard density is high enough that it can start to feel noisy

Current app equivalent:

- `Home` in `apps/web/src/app/page.tsx`
- `Stats` in `apps/web/src/app/stats/page.tsx`

Current app already has:

- club record strip
- season rank widget
- featured latest-result hero
- featured player carousel
- scoring leaders
- stats page with record card, team averages, skater table, goalie table, recent games

Current app gaps versus Chelhead:

- no club “snapshot” narrative layer
- no trend charts on the home page
- no compact visual win/loss distribution graphic
- no insight/signal system summarizing what changed recently
- no analytics-first club dashboard above the fold

Recommendation:

- `Adapt`: club snapshot / signal list
- `Adapt`: simple win/loss/OTL visual summary
- `Adapt`: one or two trend charts at most
- `Ignore`: achievements block
- `Ignore`: current division record as a hero-level feature
- `Defer`: advanced insights engine until base data semantics are hardened

## 2. Players Surface

Chelhead players page currently includes:

- team overview counts by role
- skater statistics table
- goalie statistics table
- basic/advanced table modes or dense stat groupings
- club hot zones
- stat leaders visualization
- player comparison widget
- player cards for each member

What Chelhead does well here:

- the page has a clear “team personnel” identity
- skater and goalie tables are both first-class
- hot-zone content adds something tables cannot
- stat leaders module helps scan standout contributors quickly
- player comparison suggests an exploratory workflow beyond list browsing

What Chelhead does poorly:

- player cards try to be everything at once
- skater and goalie identity are collapsed onto the same card too often
- the layout is useful but visually cramped

Your current preference from notes:

- this page should be a major model
- skater and goalie should be treated as different entities even if tied to one player
- you prefer your own card visual language over Chelhead’s card design

Current app equivalent:

- `Roster` in `apps/web/src/app/roster/page.tsx`
- current roster presentation is a depth chart, not a stats-first player directory
- skater/goalie tables currently live on `/stats`, not `/roster`

Current app already has:

- bespoke player-card language
- separate skater and goalie stats tables on `/stats`
- player profile links
- depth chart concept

Current app gaps versus Chelhead:

- no team-overview role summary on roster
- no roster page skater table
- no roster page goalie table
- no hot-zone module at team level
- no stat leaders visualization inside roster context
- no player comparison tool
- no obvious “browse the roster analytically” surface; depth chart is more lineup-oriented than stats-oriented

Recommendation:

- `Steal`: page structure of team overview + skater table + goalie table + optional secondary modules
- `Adapt`: club hot zones
- `Adapt`: stat leaders module, but cleaner than Chelhead’s
- `Defer`: player comparison until your player data model is more mature
- `Keep`: your separate player-card design direction
- `Change`: decide whether `/roster` is lineup-first, stats-first, or a hybrid; right now it is confused

## 3. Matches Surface

Chelhead matches page currently includes:

- match trends summary bullets
- recent-match strips by match type
- match-type segmentation: public / cup / private
- player overview module
- DTW score chart
- gamescore chart
- goal differential chart
- shot efficiency chart
- last-5 games breakdown table with skater/goalie and basic/advanced switching
- match analytics section with time windows
- record by match type
- frequent opponents section
- searchable/filterable match history list
- match cards with strong metadata pills like result, mode, and DTW%

What Chelhead does well here:

- treats matches as an analytics surface, not just an archive
- gives multiple ways to summarize recent form
- uses compact metadata pills effectively
- exposes trends and context before the raw history table

What Chelhead does poorly or what you already rejected:

- the public/cup/private taxonomy is not important for your current vision
- the page can become too chart-heavy without stronger prioritization
- some blocks feel more exploratory than essential

Current app equivalent:

- `Games` in `apps/web/src/app/games/page.tsx`
- game detail in `apps/web/src/app/games/[id]/page.tsx`

Current app already has:

- paginated match history
- `All / 6s / 3s` filter
- match detail page
- recent-games strip on stats page
- latest result hero on home
- opponent crest support in progress

Current app gaps versus Chelhead:

- no match trends summary
- no recent-form analytic charts
- no gamescore-style trend chart
- no goal differential trend chart
- no shot efficiency trend chart
- no frequent-opponents module
- no searchable/filterable history beyond page/mode
- no compact mode/result/quality pills on match cards

Recommendation:

- `Steal`: match-card pills for result + mode + one derived team-quality stat
- `Adapt`: match trends summary block
- `Adapt`: one recent-form analytics section
- `Defer`: large analytics wall with multiple charts until derived stat definitions are settled
- `Ignore`: public/cup/private emphasis for now

## 4. Player Profile Surface

Chelhead player profile currently includes:

- stronger hero/header treatment
- role / position labeling
- player handle / identity emphasis
- skater snapshot metrics
- goalie snapshot metrics
- player trends chart
- club stats breakdown sections
- hot-zone maps for both skater and goalie contexts
- contribution wheel
- consistency dashboard
- advanced pro analytics section
- multiple trend tabs and split views

What Chelhead does well here:

- this is the strongest page in the capture set
- combines hero identity with advanced analysis well
- hot zones and contribution wheel add real interpretive value
- consistency dashboard is a strong differentiator
- advanced trends make the player page feel alive and not just archival

What Chelhead does less well:

- the “club stats” section is not the strongest block
- some advanced panels look mechanically useful but visually generic
- skater and goalie data coexisting on one page is correct, but the hierarchy could be cleaner

Current app equivalent:

- `apps/web/src/app/roster/[id]/page.tsx`

Current app already has:

- player hero
- jersey / nationality / preferred position support
- career stats table
- EA season totals table
- game log
- gamertag history
- mode filter
- honest member-only notice

Current app gaps versus Chelhead:

- no visual player snapshot block
- no role-specific hero stats
- no trend charts
- no hot-zone maps
- no contribution wheel
- no consistency dashboard
- no advanced derived analytics section
- no top-level skater-vs-goalie synthesis beyond tables

Recommendation:

- `Steal`: hero bar concept
- `Steal`: positional pie / usage visualization
- `Steal`: contribution wheel
- `Steal`: hot-zone maps
- `Adapt`: consistency dashboard
- `Defer`: full advanced pro analytics dashboard until tracked-match volume is large enough
- `Replace`: the current “club stats” middle area with a better breakdown aligned to your existing profile-page specs

## 5. Advanced Search Surface

Captured but low priority.

This appears to be more discovery/search tooling than core team-site UX.

Recommendation:

- `Defer` entirely
- only revisit if you later want public discovery, recruiting, or multi-club browsing

## Side-By-Side Summary

### Where Chelhead is clearly ahead

- club-level dashboarding
- trend analytics
- heat maps / spatial presentation
- player-level advanced interpretation
- analytics density on the matches page

### Where the current app is already better

- featured player card visual design
- cleaner and less cluttered narrative on home/stats
- source labeling and honest fallback states
- simpler IA for users who are not power analysts

### Where the current app is pointed in the right direction but incomplete

- separating skater and goalie tables
- roster/player card identity system
- latest-result hero and match-detail structure
- role-aware player profile foundation

## Recommended Product Decisions

These are the calls the project should make explicitly.

1. `/roster` should become a hybrid page.

Suggested order:

- team overview
- depth chart
- skater stats table
- goalie stats table
- secondary modules like hot zones / stat leaders

Reason:

- your current depth-chart idea is worth keeping
- Chelhead is right that the players surface needs first-class analytic browsing
- doing only one or the other is too limiting

2. Skater and goalie should be treated as separate presentation modes.

Reason:

- this is already your stated preference
- Chelhead’s combined cards prove the downside of not doing this cleanly
- it also aligns with the bug fixes you already need in current branch logic

3. Player profile should become a flagship surface.

Priority additions:

- hero snapshot stats
- positional usage visualization
- hot zones
- contribution wheel
- consistency block

Reason:

- this is where Chelhead feels most differentiated
- this is also where your app currently has the biggest upside gap

4. Matches should gain one analytics layer, not five.

Suggested first additions:

- recent-form summary bullets
- one goal differential / results trend chart
- improved match-card metadata pills

Reason:

- Chelhead proves the value
- but copying the full analytics wall immediately would be bloat

5. Club home should stay selective.

Add:

- club snapshot / signal block
- one simple record visual
- one analytics preview

Do not add yet:

- achievements
- ranking clutter
- division-history vanity modules

## Steal / Adapt / Ignore / Defer

### Steal

- skater and goalie tables as first-class roster surface elements
- player-profile hero snapshot concept
- contribution wheel
- hot-zone modules
- match-card metadata pills
- match trends summary concept

### Adapt

- club dashboard summary
- stat leaders module
- consistency dashboard
- team hot zones
- recent-form charts
- player usage visualization

### Ignore

- achievements prominence
- heavy division/ranking clutter
- public/cup/private taxonomy as a core organizing principle
- combined skater/goalie player cards

### Defer

- full advanced analytics wall on matches
- player comparison widget
- advanced search/discovery
- advanced pro analytics parity

## Concrete Next-Build Roadmap

1. Stabilize current branch.

- fix roster/profile regressions
- fix opponent completeness logic
- repair migration metadata
- migrate and reprocess

2. Redefine `/roster`.

- keep depth chart
- add team overview
- add skater table
- add goalie table

3. Upgrade player profile.

- add role-specific snapshot hero stats
- add positional usage chart
- add hot zones
- add contribution wheel

4. Upgrade matches.

- add result/mode/quality pills
- add recent-form summary
- add one or two trend charts

5. Upgrade home/club dashboard.

- add club snapshot signal list
- add compact record visual
- add one analytics preview section

## Bottom Line

Chelhead is not better because it is prettier. It is better because it gives users more ways to interpret the data.

Your app should not clone its visual system.

Your app should borrow its strongest ideas in this order:

- player analytics depth
- roster analytics structure
- match trend interpretation
- compact club insight modules

If executed cleanly, your app can end up better than Chelhead for your actual audience because your visual direction is cleaner and your product intent is narrower.
