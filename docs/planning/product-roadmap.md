# Roadmap

## Product Defaults

- **Site type:** Internal team dashboard for EASHL club #19224
- **Primary audience:** Team members (captain + active roster)
- **Core surfaces:** Home, player profile, club stats
- **Desired feel:** Stats tool + team brand + archive
- **Strategic priority:** Data correctness over feature breadth

---

## Current Priority

Stable foundation. All major surfaces are live. Historical ingest is complete for NHL 22–25 across two separate legacy player sources:

- player-card season totals
- club-member club-scoped totals

Both are now presented honestly in the merged `/stats` and `/roster` routes. The third historical source (club/team stats screenshots) is no longer hypothetical: schema/importer/extractor exist and a full review queue has been generated. Near-term work is review/import of that queue, quality-of-life improvements, and analytics depth — not structural recovery work.

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
- **Backup restore drill** — periodically restore a `pg_dump` into a throwaway DB and verify row counts. An untested backup is not a verified backup.
- **Ingestion-health & data-gap visibility** — the health-staleness alert catches "worker dead" and `pg_dump` catches "disk gone", but neither catches "worker alive but silently not capturing." Add: (a) alert when `raw_match_payloads.transform_status='error'` rows accumulate (reprocess backlog), (b) surface `ingestion_log` / gap logging as a simple health view so silent capture gaps are visible before data is lost. Directly serves the correctness-first priority.
- ~~Verify `clubs/seasonRank` + `settings` field shapes~~ ✅ Done — live DB row confirmed, all widget fields correct

### 4. Third historical source review/import

- Review generated `club_team_stats/*.extract.json` files
- Promote corrected review artifacts into import-ready JSON
- Import `historical_club_team_stats` title-by-title
- Only after enough rows exist, decide where club/team screenshot totals belong in legacy UI

---

## New Feature Requests (added 2026-07-25)

> Captured from operator request. Each still needs its own inspect-and-define session before build. Scope notes below are orientation, not commitments.

### 5. Build history view — "locker"

- A view of a player's build/loadout history over time (X-Factors, build class, gear), NHL-style "locker" framing.
- Draws on the OCR loadout pipeline already extracting `build_class` / `x_factor_name` / per-slot loadout data (`player_loadout` schema, loadout extractors).
- Open questions: per-player timeline vs per-match snapshot; which titles have loadout coverage; how much of the corpus loadout data is reviewed/trustworthy enough to surface.

### 6. Login + request-access

- Introduce authentication where there is currently **none** (site is open on the LAN/self-host; audience is a handful of team members).
- Two parts: (a) member login, (b) a "request access" flow for non-members.
- Open questions: auth mechanism (Discord OAuth fits the audience, vs. simple credential), what becomes gated vs. public, session/role model, and whether this changes the "internal dashboard" security posture in `docs/`.

### 7. NHL 27 preparation (beta access live now)

- Operator has NHL 27 beta access; menus and data screens look virtually identical to NHL 26 at first glance. Begin tuning data collection ahead of launch.
- Architecture already supports this: `game_titles` is the primary axis (`is_active`, `launched_at`), match uniqueness is `(game_title_id, ea_match_id)`, and OCR is title-tagged.
- Prep work: (a) confirm EA Pro Clubs API endpoint family / platform for NHL 27; (b) add the NHL 27 `game_titles` row when it launches; (c) validate OCR screen parsers against beta capture (verify the "screens are the same" assumption per-parser before trusting it — small UI shifts break ROI/segmentation); (d) capture a small labeled beta benchmark set so day-1 ingest is calibrated, not discovered live.

### 8. Footer + final website prep (launch readiness)

- Site footer plus webmaster / data-legal protection requirements.
- Scope: footer content (branding, links, credits), plus legal/compliance surface — privacy notice, data-use/attribution, and any EA/third-party content disclaimers appropriate to a fan-operated club site.
- Open questions: what jurisdiction's data-protection reqs apply, whether any personal data (gamertags) needs a handling notice, and EA API/asset usage attribution.

### 9. Game sheet page revamp

- Revamp of the game/match detail page (the scoresheet surface — `apps/web/src/app/games/[id]`, hero + scoresheet + top performers + lineup band).
- A **new frontend is being built externally** by the operator and will be brought in — the work here is integration, not a from-scratch design.
- Timing: **after the OCR corpus run begins** (per operator). Sequencing note — much of the POLISH_BACKLOG game-detail bug list (conflicting "GAME" numbers, home/away hardcode, tie-as-win possession edge) may be **superseded or reshuffled** by the new frontend; reconcile that backlog against the incoming design before spending effort on the old surface.
- Open questions: how the new frontend maps onto the existing view-model builders (`lib/match-recap.ts`) and data sources (EA vs OCR-reviewed period summaries), and whether it changes the NHL-26-only scope of `/games/[id]`.

### 10. NHL 27 title cutover (operational milestone)

- Distinct from item 7 (which is data-collection *prep*). This is the **title flip itself**: add the NHL 27 `game_titles` row, set it `is_active`, and demote NHL 26 to archive.
- Likely runs **both titles active during the beta/transition window** — needs a plan for that dual-active period (which title the worker polls, how the UI presents "current" during overlap).
- This is the **first real production exercise of cross-game career stats** — the roadmap's stated core feature — so verify the career-stat stitching across the NHL 26 → 27 boundary is correct at cutover, not after.
- `/`, `/games`, `/games/[id]` are currently NHL-26-only by design (see `title-resolver.ts`); decide whether "active title" for those surfaces follows the flip automatically or needs an explicit change.

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

| Item                                                                                    | Done |
| --------------------------------------------------------------------------------------- | ---- |
| Phase 0–4: Foundation, worker, frontend, production                                     | ✅   |
| Depth chart on `/roster`                                                                | ✅   |
| Player profile V1 (`/roster/[id]`)                                                      | ✅   |
| Official EA club record on home page                                                    | ✅   |
| Opponent crest pipeline                                                                 | ✅   |
| Season rank / division widget                                                           | ✅   |
| Game-mode filter (All / 6s / 3s) across all surfaces                                    | ✅   |
| Source split: All=EA totals, 6s+3s=local tracked                                        | ✅   |
| Historical season import — NHL 22, 23, 24, 25 (159 reviewed rows total)                 | ✅   |
| Club-member screenshot historical import — NHL 22, 23, 24, 25 (42 canonical rows total) | ✅   |
| Club/team stats screenshot schema + importer + extractor + review queue                 | ✅   |
| Identity drift sweep — `StickMenace` collapsed into `Stick Menace` (id=3)               | ✅   |
| Legacy titles integrated into `/stats` and `/roster`; `/archive/*` retired              | ✅   |
| Legacy `/stats` split into club-scoped totals vs player-card season totals              | ✅   |
| Legacy `/roster` club-scoped only                                                       | ✅   |
| Game log on player profile                                                              | ✅   |
| EA season totals section on player profile                                              | ✅   |
| Contribution radar on player profile                                                    | ✅   |
| Match detail page V1 (story strip, goalie spotlight, scoresheet)                        | ✅   |
| Chemistry analytics: W/W-out + Best Pairs on `/stats`                                   | ✅   |
| DTW gauge color split fix                                                               | ✅   |
| Form strip "Last N" label coherence fix                                                 | ✅   |
| Event Map dead-weight placeholder removed                                               | ✅   |
