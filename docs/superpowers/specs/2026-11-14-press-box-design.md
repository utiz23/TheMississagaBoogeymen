# Press Box — admin design (`/admin/press-box`)

Status: **proposed** (operator 2026-11-14; name "Press Box" chosen by the operator over "lore": "an admin only page on the site to manage the lore … read the
player dossiers, current feuds and trends, and manage the game"). Written for the operator; built in
four tasks (L1–L4, end of this file).

## 1. Purpose

One admin-only place to read and steer the press "game": who the players are to the reporters, which
feuds and storylines are running, and how each reporter behaves. Desktop first (wide tables); it must
still be readable on a phone.

## 2. Operator decisions (2026-11-14)

- **Control:** feuds, storylines, takes and stances, and players' press can all be changed here.
- **Dossier profile:** an **AI-written profile on demand** (a button, about $0.05 each; stored until
  refreshed). Everything else on the page is plain data (no AI cost).
- **Reporters:** their characters are **editable** (bio, voice notes, catchphrases); edits feed the
  writers.
- **Device:** desktop.

## 3. Pages

All under `/admin/press-box`, behind the existing admin check (`requireAdmin`, the operator only). Each page
says where its data comes from; every change is logged (who, when, what) in a small audit list shown on
the overview.

### 3.1 Overview — "state of the game"

- Press switches: mode (trial/live), heat (cool/normal/hot, scope), reporters on/off, monthly spend vs
  the cap and the 80% stop.
- Now: open scrums and interviews (with links to their threads), pending GM asks.
- Top 5 feuds, top 5 storylines, hot and cold players (form over the last nights), milestones within
  reach (e.g. "Silky: 2 goals from 50").
- Last 20 Press Box changes (audit list).
- Buttons: `/gm testscrum` equivalent ("Run a free test scrum"), switch heat.

### 3.2 Player dossiers — `/admin/press-box/players` and `/admin/press-box/players/[id]`

Index: every club member (and bench people who have talked to the press), with press level, feud count,
quote count, last scrum/interview, profile age.

One dossier:

- **Identity:** name, gamertag, nicknames (aliases), Discord link, press level (full / go easy / leave
  me out) and who set it, role (player / bench / coach).
- **Form:** recent games, season totals, streaks, milestones within reach (from the stats the site
  already has; no new data).
- **In their own words:** usable and joke quotes from scrums and interviews (newest first), with the
  question and reporter; counts only (never text) for unusable and off-limits answers.
- **What the press thinks:** each reporter's takes and stances about this player.
- **Feuds:** per reporter level, points, trend, last flare-up.
- **GM:** notes and asks about this player; interviews done (with links to the articles).
- **Profile:** the stored AI profile ("how the press sees him"), its date, and a **Write / Refresh**
  button (one AI call; the profile follows all writing rules, hard lines and no crude quotes; "Go
  easy" players get no criticism; "Leave me out" players get no profile and no dossier content beyond
  identity).
- **Actions:** change press level (on the player's behalf; logged), add/remove nicknames, add a GM note,
  start an interview (`/gm interview` equivalent), cool down or reset a feud.

### 3.3 Feuds — `/admin/press-box/feuds`

A board: players × reporters, each cell the level (none / simmering / feud / open war) with points and
trend. Actions per cell: **cool down** (halve), **reset** (zero), **set level** (GM override, with a
reason), **freeze** (no change until unfrozen). All logged; the writers see only the resulting level.

### 3.4 Storylines and trends — `/admin/press-box/storylines`

- Open storylines (the reporter-system "threads") with each reporter's stance and when it last moved.
- Trends from data: streaks, slumps, milestones, most-quoted, most-insulted reporter, quiet players.
- Actions: **close** a storyline, **pin** one (the writers get it as a suggested angle for the next
  night), **unpin**.
- Takes and stances: **edit** the text, **remove**, **add** a take for a reporter about a player (moves
  the takes editor from `/admin/news` here; `/admin/news` keeps a link).

### 3.5 Reporters — `/admin/press-box/reporters` and `/admin/press-box/reporters/[id]`

Each reporter's card: bio, voice notes, catchphrases, scrum/interview record, takes, feuds, best quotes
they drew out, on/off switch. **Edit** bio, voice notes and catchphrases. Edits are stored as overrides
on top of the reporter definitions in code; the writers read the merged version; every item records the
character version it was written with (so the admin can tell which character version wrote it).

## 4. Data

New tables (hand-written migrations, one per task that needs one):

- `news_player_profiles` (player or bench person, profile text, written_at, rules/character version, cost).
- `news_press_box_audit` (who, when, kind, target, before/after summary).
- `news_reporter_overrides` (reporter, bio, voice_notes, catchphrases, updated_at, character_version).
- Feuds: `frozen`, `override_level`, `override_reason` columns on `news_press_feuds`.
- Storylines: `pinned`, `closed_at` on the stance/thread rows (or a small table; builder's choice).

Everything else reads existing tables (stats, members, aliases, press levels, takes, stances, scrum and
interview answers, GM notes and asks, feuds, settings).

## 5. Safety

- Admin only; server actions re-check admin on every change.
- Off-limits and unusable answers never show their text, only counts.
- "Leave me out" players: identity only. "Go easy": no criticism in profiles.
- AI profile: same writing rules, hard lines, no crude quotes; cost counted in the monthly spend; one
  call per click (no automatic refresh).
- Reporter edits cannot remove the safety rules (hockey only, no profanity, no real people); those stay
  in code and always apply.

## 6. Tasks (in order)

| Task   | Scope                                                                                     | Migration                 |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------- |
| **L1** | `/admin/press-box` shell + overview + feuds board with all feud actions + audit list      | audit table; feud columns |
| **L2** | Player dossiers (index + page) + players' press actions + AI profile on demand            | profiles table            |
| **L3** | Storylines and trends + takes/stances editor (moved here) + pin/close feeding the writers | storyline flags           |
| **L4** | Reporters: cards + editable bio/voice/catchphrases feeding the writers                    | reporter overrides        |

Each task: its own branch, the usual checks, a screenshot of the page (dev server on the live database,
read-only tunnel), the Lead's review, then a deploy with the operator's OK.
