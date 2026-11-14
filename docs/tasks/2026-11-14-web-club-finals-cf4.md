# Task: CF4 — Club Finals stats (records row, finals leaders, player and stats pages, news pinning)

- **State:** Proposed (written 2026-11-14 15:27 by Lead2; the "later" items of the operator's list)
- **Lane:** Worker (precomputed finals aggregates), Database, Queries, Web
- **Risk:** medium (new numbers teammates see; a Verifier checks them)
- **Slug:** club-finals-cf4
- **Operator gate before merge:** yes
- **Needs a deploy:** migration, `worker`, `web`

## Goal and visible result

Finals-only stats from CF1's per-game state, precomputed (never on read):

- (12) Season records table (home): a row for the best Club Finals run.
- (13) Scoring leaders (home): a "Club Finals leaders" switch.
- (15) Player pages (`/roster/[id]`): Club Finals GP, G, A, +/-; "played in the final".
- (16) Stats page (`/stats`): a "Club Finals only" filter.
- (17) News page (`/news`): finals articles tagged and pinned while a run is alive.

## Log

- 2026-11-14 15:27 Lead2: written (Proposed). Starts only when the operator says Ready, after CF3.

Resume: operator decides.
