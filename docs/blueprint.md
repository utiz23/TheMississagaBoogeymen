# EASHL Team Stats Website – Full Blueprint (Updated)

## Overview

This project is a full-stack analytics and media platform for an EASHL team.

Core goals:

- Persist and display club stats
- Persist and display player stats
- Archive all games (no data loss)
- Provide detailed game breakdowns
- Support future AI and media features

**System of Record:** EA Pro Clubs API (`proclubs.ea.com`)  
**Reference Only:** Chelhead (UX + structure)

---

# 1. Core Constraints (Critical)

These define the entire system design:

1. EA API is **undocumented and unstable**
2. Match history is **short-lived (~5 matches)**
3. Must **poll + archive continuously**
4. All ingestion is **server-side only**
5. Most numeric fields are **strings → must parse**

Failure here = system breaks.

---

# 2. System Architecture

## Components

- Ingestion Worker (cron / background job)
- Backend API
- PostgreSQL Database
- Frontend (Next.js)

## Data Flow

```
EA API → Worker → Raw Storage → Transform → Database → API → Frontend
```

---

# 3. Data Model (Finalized)

## 3.1 Raw Storage (NEW – CRITICAL)

### raw_match_payloads

- match_id (PK)
- json_blob (full EA response)
- ingested_at

Purpose:

- Prevent data loss
- Debug parsing issues
- Handle EA API changes

---

## 3.2 Core Tables

### games

- id (matchId)
- season_id
- club_id
- opponent_name
- played_at
- result (WIN / LOSS / OTL / DNF)
- score_for
- score_against
- shots_for
- shots_against
- hits_for
- hits_against
- faceoff_win_pct
- time_on_attack
- penalty_minutes

---

### players

- id (internal)
- gamertag
- blaze_id (external ID)
- position
- is_goalie

---

### player_game_stats

- player_id
- game_id

Skater:

- goals
- assists
- points
- plus_minus
- shots
- hits
- pim
- takeaways
- giveaways
- faceoff_wins
- faceoff_losses
- pass_attempts
- pass_completions

Goalie:

- saves
- shots_against
- goals_against
- save_pct
- gaa

---

### player_season_stats (precomputed)

### club_season_stats (precomputed)

Do NOT compute these live.

---

# 4. EA API Integration

## Base URL

```
https://proclubs.ea.com/api/nhl
```

---

## Required Endpoints

### 1. Club Search

```
GET /clubs/search?platform=common-gen5&clubName=<name>
```

---

### 2. Matches (CRITICAL)

```
GET /clubs/matches?clubIds=<id>&platform=common-gen5&matchType=gameType5
```

Match types:

- gameType5 (league)
- gameType10 (playoffs)
- club_private

---

### 3. Member Stats

```
GET /members/stats?clubId=<id>&platform=common-gen5
```

---

### 4. Member Search

```
GET /members/search?platform=common-gen5&memberName=<name>
```

---

## Required Headers

```json
{
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
  "Referer": "https://www.ea.com/"
}
```

---

# 5. Ingestion System

## Polling Strategy

Every 3–10 minutes:

```
for each matchType:
    fetch matches
    for each match:
        if matchId not stored:
            store raw payload
            transform → insert
```

Reason:

- API only returns recent matches

---

## Transform Rules

- Convert all numeric strings → numbers
- points = goals + assists
- faceoff % = wins / total
- Identify opponent via clubId

---

## Aggregation

Run after ingest:

### Player Season Stats

Aggregate from player_game_stats

### Club Stats

Aggregate from games

---

# 6. Pages (Final Structure)

## 6.1 Home

- Record
- Last 5 games
- Top players
- Featured content

---

## 6.2 Stats (HIGH PRIORITY)

Club-level:

- Record
- Win %
- Goals for/against
- Goal differential
- Shots/game
- Hits/game
- Faceoff %
- Passing %
- Special teams

---

## 6.3 Roster (HIGH PRIORITY)

Table:

- Player
- GP
- G
- A
- PTS
- +/-
- Shots
- Hits
- Pass %
- Faceoff %

Tabs:

- Scoring
- Possession
- Physical
- Goalie

---

## 6.4 Scores Page

- Chronological games
- Opponent
- Score
- Date

---

## 6.5 Game Page (CORE EXPERIENCE)

- Box score
- Player stats
- Team comparison
- Timeline (future)
- Shot map (future)

---

## 6.6 Video (Low Priority)

- Embedded clips
- Linked to games

---

## 6.7 News (Low Priority)

- Articles
- AI-generated later

---

## 6.8 Store (Ornamental)

- Static mock products

---

# 7. Brand Integration (NEW)

Design must follow brand guide:

- Dark UI (black/charcoal base)
- Red accents for highlights/actions
- White text for readability
- Aggressive, esports tone

UI patterns:

- Scoreboard-style cards
- Sharp edges / diagonal elements
- High contrast layouts

Voice:

- Short, direct, competitive tone

Source:

---

# 8. Backend API (Your System)

Expose:

### /games

List games

### /games/:id

Game details + player stats

### /players

Roster stats

### /club

Club stats

---

# 9. Caching + Performance

- Cache EA responses: 60–180s
- Cache club lookup: 24h
- Precompute aggregates

---

# 10. Error Handling

Retry:

- 429
- 500–504

Backoff:

```
delay = 2^attempt * 500ms + jitter
```

---

# 11. Security Rules

- Never call EA API from frontend
- Sanitize all inputs
- Rate limit endpoints
- Use environment variables

---

# 12. Monitoring

Track:

- API failures
- ingestion success
- new matches per hour

Alert if:

- no new matches while active
- parsing fails

---

# 13. Known Risks

- API changes yearly
- Some endpoints return 400/500
- No official support
- Possible rate limiting or blocking

---

# 14. Build Phases

## Phase 1 (MVP)

- DB schema
- Ingestion worker
- Scores page
- Stats page
- Roster page

---

## Phase 2

- Player pages
- Charts
- UI polish

---

## Phase 3

- Event tracking
- Shot maps
- Timeline

---

## Phase 4

- Video
- News
- AI features

---

# 15. Key Insight

Your competitive advantage is:

**You OWN the data**

Not:

- live API calls
- scraped pages

But:

- full historical archive
- structured analytics
- extensible system

---

# Next Step

You should now:

1. Align SQL schema with this blueprint
2. Build ingestion worker
3. Test match ingestion end-to-end

---

If you want the next step, ask for:

- “updated SQL schema v2”
- “backend API structure”
- or “Next.js frontend layout”
