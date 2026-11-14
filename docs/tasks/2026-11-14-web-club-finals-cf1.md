# Task: CF1 — Club Finals: rounds from EA results, game badges, the Club Finals page

- **State:** Merged 2026-11-14 15:50 (`3b2b3300`; operator D16 "Its acceptable then"); deploy waits for the operator's OK
- **Lane:** Worker (derive after each pass), Database (one migration), Queries, Web
- **Risk:** medium (a number teammates see: round, game number, series score) — a Verifier checks it
- **Slug:** club-finals-cf1 (branch `work/club-finals-cf1`, worktree `.claude/worktrees/club-finals-cf1`)
- **Operator approval:** 2026-11-14 15:07 ("approve all 4 items")
- **Operator gate before merge:** yes (screenshots and the Season 1 history table)
- **Needs a deploy:** migration, `worker`, `web`
- **Helper model:** Opus

## Facts this task starts from

- NHL 27 club id is 1650. EA match type `gameType10` with `cNhlOnlineGameType` 10 = 6v6 **Club
  Finals** games, played since 2026-11-06 (33 games by 11-13). `gameType5` code 5 (83 games,
  09-04 → 10-25) was the regular season. Codes 200 (in `gameType5`) and 206 (in `gameType10`) look like
  3v3 (`memberString` 3 / 3); find out whether 206 belongs to Club Finals (say what you find; do not
  guess).
- EA's payload has no playoff, round or series field.
- Engine Lead (2026-11-14), from the club-room "Club Finals" panel: a **round** is first to **4 wins**;
  **4 losses in a round end the whole attempt** (panel back to ROUND 1, 0-0, RETRY); **round 4 is the
  final**. A DNF or an OT loss counts as a loss. Not seen yet: what happens after winning round 4;
  whether RP resets with the season.
- Panel reads (engine repo, read only): `~/projects/eanhl-live-engine/out/club-finals/club-finals-inbox-20261114.jsonl`
  (round, round W/L boxes, attempt W-L, RP, best record 13-5 / RP 22542; one per club-room visit since
  2026-11-12; the state between games). By time the engine maps the 11-12 19:13 reset to the end of a
  round-4 attempt: Homie Time L 0-2 (18:22) and 4scin L 2-3 OT (18:44) likely games 4 and 5 of the
  final — **not confirmed**: check it against the panel reads and say what the data shows.

## Goal and visible result

1. **Derive** (worker, after each normal pass and quick check, precomputed, never on read): walk the
   6v6 Club Finals games in time order with the rules above and store per game: attempt number, round,
   game number in the round, round W-L before/after, attempt W-L, "round won", "eliminated", "final"
   (round 4). Starting point: 2026-11-06 21:08 is attempt 1, round 1, 0-0 unless the panel reads or the
   data say otherwise; panel reads, where they exist, **check** the derived state; a mismatch is logged
   and reported, never silently fixed.
2. **Badges:** on game pages and game lists: "Club Finals · Round 4 · Game 5", series score, "Final"
   and "Eliminated" / "Round won" marks.
3. **Club Finals component on the home page** (operator 2026-11-14 15:34: not its own page): the
   current attempt (round, R1/R2/R3/FINAL steps, this round's W/L boxes, attempt W-L, last game) and
   the best attempt, high on the home page while an attempt runs; one small line ("Best 13-9, reached
   the final") when none runs; past attempts in a collapsed "All attempts" list. Anchor `/#club-finals`.
   No route, no nav link. Always dark, red accents, scoreboard look (the site's design direction).
4. **Season 1 history:** a table in the Report: every Club Finals game 11-06 → today with its derived
   attempt/round/game, next to the panel reads where they exist (old vs new side by side for the
   operator).

## Paths

- **May edit:** `apps/worker/src/` (a new `club-finals.ts` + tests; one call after a pass),
  `packages/db/migrations/0083_*.sql`, `packages/db/src/schema/`, `packages/db/src/queries/` (new
  `club-finals.ts` + tests), `apps/web/src/app/` (game pages and lists: badges only; the home page `page.tsx`:
  the component), `apps/web/src/components/` (badges), `apps/web/src/components/home/` and
  `apps/web/src/components/club-finals/` (the home component; added by the Lead 2026-11-14), this task file.
  Read only: the engine repo file above.

## Checks

db build; typecheck db, web, worker, discord; web unit; worker tests that need no database; db tests by
name; prettier. Tests: the round rules (4 wins advance, 4 losses reset to round 1, DNF and OTL are
losses, round 4 = final), a full replay of the 11-13 night against the engine's panel sequence above,
3v3 games kept out (or in, with the reason). Screenshots from the read-only preview (any login bypass
never committed).

## Done when (written before the work starts)

- **Done when:** checks pass; the derived states match every panel read that exists (or each mismatch
  is explained); screenshots and the history table are in the Report. Reason: a round or series score
  shown to teammates must match the game's own panel.
- **Not done if:** any number is guessed where data is missing (show "unknown" instead).
- **Tolerance for the Verifier:** 0 mismatches between derived states and panel reads, except those the
  Report explains.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 15:08 Lead2: written and started (operator "approve all 4 items"). Migration 0083 (B1 has
  0082; B2 takes 0084 if it needs one). CF2 (Discord post line, news desk and press weighting) after
  CF1.

- 2026-11-14 15:19 task agent: branch `work/club-finals-cf1` and worktree made; panel file and the 33 live 6v6 games read. Rules written as tests first (`apps/worker/src/__tests__/club-finals.test.ts`, 13 tests), then `club-finals.ts` (pure rules). Replay of the 33 games matches all 11 panel reads that have a time. Migration 0083 (two tables), schema, queries, worker step after a pass and a quick check, badges on /games and game pages, page `/club-finals`, nav link. Typecheck db, worker, discord, web pass.
- 2026-11-14 15:19 finding: code 206 is NOT Club Finals (reason in Report). Attempt 1 ended with match 3431 (4scin, OT loss), game 5 of round 4: the Engine Lead's guess holds.

- 2026-11-14 15:27 task agent: screenshots done (read-only dev server and tunnel stopped, temporary in-memory patch reverted, never committed). History table and Report written. Rebased on main (already up to date). Checks pass. State = Verify.

- 2026-11-14 15:41 task agent: operator decision (Lead2, 2026-11-14 15:34): "club finals page not approved. This can just be a component on the home page, doesnt need to be its own page. The rest are approved". Removed the `/club-finals` route and the nav link; added `components/club-finals/club-finals-card.tsx` (Server Component, native `<details>` for "All attempts") placed first on the home page. Rebased on main (B1 merged; kept both export lines in the two index files). Typecheck db, worker, discord, web clean; web unit 727/727; prettier clean. Home screenshots (desktop 1280, phone 390, with the list open) in the scratchpad `shots-cf1/home-*-running*.png`. Not screenshotted: the one-line state (no attempt running); a second preview run for it was denied by the permission system (broad process kill), so it is not shown.

- 2026-11-14 15:48 task agent: operator cancelled the streamline; the dropdown stays.

- 2026-11-14 15:50 Lead2: rebased, web/worker typecheck clean, web 727/727; merged `--ff-only`.

Resume: operator's OK to deploy: fresh backup, 0083, `worker` (log "Club Finals nhl27: … games, … attempts"), then `web`.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  - Worker derives Club Finals rounds after each normal pass and each quick check that stored a new game (`apps/worker/src/club-finals.ts` rules, `club-finals-sync.ts` store, two calls in `ingest.ts`). It rebuilds the title's rows from `matches` each time, so a late game fixes the rows after it. It skips when migration 0083 is not applied.
  - Migration 0083 (hand-written, idempotent, rollback in the header): `club_finals_games` (one row per game) and `club_finals_attempts` (one row per attempt). Not applied anywhere yet; it was **not run** on any database (no Docker, no local Postgres; one attempt to test it in a throwaway engine was denied, so it is checked by eye against 0081 only).
  - Badges: game cards on /games and the scoreboard of a game page show "Club Finals · Round R · Game N", "Series W–L" (the round record after the game), and marks "Final", "Final won", "Round won", "Eliminated". The game page strip also shows the attempt record. A game with no row shows nothing.
  - REWORKED 2026-11-14 (operator): there is no `/club-finals` page and no nav link now. The same content is a component on the home page (`/#club-finals`), first block, compact; one small line when no attempt runs. The next bullet describes the old page and is kept for the record. (old) New page `/club-finals` (own nav link "Club Finals", after Games; also in the mobile drawer): now (round, 4 round boxes track, the seven W/L boxes like the panel, RETRY, attempt record, last game), best attempt, every attempt by round with each game linking to its page. Dark, red accents, scoreboard look. Unknown after a won final: the page says so.
  - Only 6v6 games count: `match_type = gameType10` and EA code 10. Only active titles are derived (NHL 27). NHL 26 also has code-10 games (44) but is inactive and its rules are unknown, so they are not derived.
- **What the data says:**
  - Attempt 1 ended with **match 3431** (4scin, OT loss 2-3, 11-12 19:08): game 5 of round 4. Round 4 was W L L L L (3427 W, 3428 L, 3429 L, 3430 L Homie Time, 3431 OTL). The Engine Lead's guess holds.
  - **Code 206 is not Club Finals.** With 206 left out, the 6v6 games before 3427 add up to exactly 13 wins and 5 losses, the panel's best attempt (RP 22542). The 3-skater DNF (3412) must count as a loss for that to hold. With 206 in, the numbers do not fit. The 5 games with 206 (11-08 and 11-09) are 3v3 and carry no badge.
  - The panel's "best 13-5" is a peak snapshot (after 3427), not the final record of the attempt (13-9). The page shows the attempt's final record, furthest round first.
  - The undated "operator-example" panel images in `club-finals.jsonl` (5-4, 6-4, 8-8 ...) match no derived round or attempt, so they are not used as checks.
  - Not guessed: after a won final (4 wins in round 4) the state is unknown. No game is placed there; the page says "Final won" and shows no current state. Not seen yet in the data.
  - Real attempts so far: 1 (3405-3431, reached the final, 13-9, eliminated), 2 (3432-3435, 0-4, eliminated), 3 (3436-, running, round 2, 5-2).
- **How it was checked (commands, numbers):**
  - Round-rule tests written first: `apps/worker/src/__tests__/club-finals.test.ts`, 13 tests pass (4 wins advance, 4 losses reset, DNF and OTL are losses, round 4 is the final and a won final leaves later games unplaced, input order, 3v3 kept out, replay of the 33 live games, every panel read).
  - Panel check: 11 timed panel reads (11-12 19:13 and 21:07; 11-13 18:55 to 21:58) vs the derived state after the last game before each: **0 mismatches** (round, boxes, attempt W-L, RETRY). Columns "Panel read after it" below.
  - db: `dist/queries/__tests__/club-finals-panel.test.js` 3/3. Typecheck db, worker, discord, web: clean. web unit 719/719. Worker tests that need no database: club-finals + ingest-title-eligibility + live-checks 26/26. Prettier on all my files: clean (`pnpm format:check` shows only warnings in files I did not touch).
  - Not run: worker integration tests and the pre-push OCR suite (no Docker); the SQL of 0083 on a real database.
  - Screenshots (dev server on the live database through the read-only tunnel, port 3400, tunnel 5437; live has no derived tables yet, so a **temporary uncommitted patch** derived the states in memory from `matches`; reverted, never committed; server and tunnel stopped, password file deleted): `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-cf1/club-finals-desktop.png`, `club-finals-mobile.png`, `games-list-desktop.png`, `games-list-mobile.png`, `game-3431-final-eliminated.png`, `game-3440-round-won.png`, `game-3431-mobile.png`. No horizontal overflow at 1280 and 390. The only console errors are 404s on opponent crest images (the same on any games list).
- **Season 1 history table** (every 6v6 Club Finals game 11-06 to 11-13, club time UTC-6; "Panel read after it" = engine panel reads between this game and the next):

| Match | Ended (club time) | Result   | Opponent               | Attempt | Round | Game | Round W-L after | Attempt W-L after | Mark              | Panel read after it               |
| ----- | ----------------- | -------- | ---------------------- | ------- | ----- | ---- | --------------- | ----------------- | ----------------- | --------------------------------- |
| 3405  | 11-06 21:08       | WIN 4-0  | 814s Finest            | 1       | 1     | 1    | 1-0             | 1-0               | -                 | none                              |
| 3406  | 11-06 21:37       | LOSS 1-4 | Okanagan Bears         | 1       | 1     | 2    | 1-1             | 1-1               | -                 | none                              |
| 3407  | 11-06 22:06       | LOSS 4-7 | Ea cest de la marde    | 1       | 1     | 3    | 1-2             | 1-2               | -                 | none                              |
| 3408  | 11-06 22:34       | WIN 2-1  | LMF KNIGHT             | 1       | 1     | 4    | 2-2             | 2-2               | -                 | none                              |
| 3409  | 11-07 20:47       | WIN 3-2  | AAA elite jrs          | 1       | 1     | 5    | 3-2             | 3-2               | -                 | none                              |
| 3410  | 11-07 21:11       | WIN 2-0  | Treys lost amigos      | 1       | 1     | 6    | 4-2             | 4-2               | round won         | none                              |
| 3411  | 11-07 21:26       | DNF 0-3  | P E A C H E S          | 1       | 2     | 1    | 0-1             | 4-3               | -                 | none                              |
| 3412  | 11-07 21:30       | DNF 0-3  | Amateur Hour           | 1       | 2     | 2    | 0-2             | 4-4               | -                 | none                              |
| 3413  | 11-07 21:58       | WIN 6-0  | Muffin Passes          | 1       | 2     | 3    | 1-2             | 5-4               | -                 | none                              |
| 3414  | 11-07 22:25       | WIN 3-2  | Nair                   | 1       | 2     | 4    | 2-2             | 6-4               | -                 | none                              |
| 3415  | 11-07 22:47       | LOSS 1-4 | Ol Guysers             | 1       | 2     | 5    | 2-3             | 6-5               | -                 | none                              |
| 3416  | 11-07 23:09       | WIN 2-0  | LMF KNIGHT             | 1       | 2     | 6    | 3-3             | 7-5               | -                 | none                              |
| 3420  | 11-08 18:41       | WIN 3-2  | Brady Budo HC          | 1       | 2     | 7    | 4-3             | 8-5               | round won         | none                              |
| 3421  | 11-08 19:06       | WIN 2-1  | CHELCHUMPS             | 1       | 3     | 1    | 1-0             | 9-5               | -                 | none                              |
| 3422  | 11-08 19:35       | WIN 2-1  | UNAMEN 1               | 1       | 3     | 2    | 2-0             | 10-5              | -                 | none                              |
| 3423  | 11-08 20:00       | WIN 3-1  | Boston Grape Smugglers | 1       | 3     | 3    | 3-0             | 11-5              | -                 | none                              |
| 3426  | 11-09 19:12       | WIN 4-3  | Chieftains             | 1       | 3     | 4    | 4-0             | 12-5              | round won         | none                              |
| 3427  | 11-09 19:38       | WIN 5-0  | Daves Devils           | 1       | 4     | 1    | 1-0             | 13-5              | final             | none                              |
| 3428  | 11-09 20:01       | LOSS 2-4 | Mosinee PaperMakers    | 1       | 4     | 2    | 1-1             | 13-6              | final             | none                              |
| 3429  | 11-09 20:25       | LOSS 4-8 | Mosinee PaperMakers    | 1       | 4     | 3    | 1-2             | 13-7              | final             | none                              |
| 3430  | 11-12 18:41       | LOSS 0-2 | Homie Time             | 1       | 4     | 4    | 1-3             | 13-8              | final             | none                              |
| 3431  | 11-12 19:08       | OTL 2-3  | 4scin                  | 1       | 4     | 5    | 1-4             | 13-9              | final, ELIMINATED | 11-12 19:13: R1 - 0-0 RETRY MATCH |
| 3432  | 11-12 19:40       | LOSS 1-4 | Sunnyvale Shot Hawks   | 2       | 1     | 1    | 0-1             | 0-1               | -                 | 11-12 21:07: R1 L 0-1 MATCH       |
| 3433  | 11-13 18:53       | LOSS 0-2 | Stoneham Snipers       | 2       | 1     | 2    | 0-2             | 0-2               | -                 | 11-13 18:55: R1 LL 0-2 MATCH      |
| 3434  | 11-13 19:26       | LOSS 2-3 | Muffin Passes          | 2       | 1     | 3    | 0-3             | 0-3               | -                 | 11-13 19:28: R1 LLL 0-3 MATCH     |
| 3435  | 11-13 19:45       | DNF 0-3  | Labatt50               | 2       | 1     | 4    | 0-4             | 0-4               | ELIMINATED        | 11-13 19:46: R1 - 0-0 RETRY MATCH |
| 3436  | 11-13 19:56       | WIN 3-0  | Slugdog Millionaires   | 3       | 1     | 1    | 1-0             | 1-0               | -                 | 11-13 19:57: R1 W 1-0 MATCH       |
| 3437  | 11-13 20:17       | WIN 4-2  | Kings of the world     | 3       | 1     | 2    | 2-0             | 2-0               | -                 | 11-13 20:20: R1 WW 2-0 MATCH      |
| 3438  | 11-13 20:42       | LOSS 2-3 | Susky River Rats       | 3       | 1     | 3    | 2-1             | 2-1               | -                 | 11-13 20:45: R1 WWL 2-1 MATCH     |
| 3439  | 11-13 21:12       | WIN 5-4  | NHLCLUB02139           | 3       | 1     | 4    | 3-1             | 3-1               | -                 | 11-13 21:16: R1 WWLW 3-1 MATCH    |
| 3440  | 11-13 21:40       | WIN 5-3  | Maikans                | 3       | 1     | 5    | 4-1             | 4-1               | round won         | 11-13 21:43: R2 - 4-1 MATCH       |
| 3441  | 11-13 21:55       | WIN 3-0  | StormBrew Boyz         | 3       | 2     | 1    | 1-0             | 5-1               | -                 | 11-13 21:56: R2 W 5-1 MATCH       |
| 3442  | 11-13 22:18       | LOSS 1-4 | Mile High Mob          | 3       | 2     | 2    | 1-1             | 5-2               | -                 | none                              |

- **Tried, no gain:** testing 0083 in a throwaway Postgres engine (denied by the permission system; not retried).
- **Not done:** deploy, migration apply, any live write. The worker cannot read the engine's panel files, so the "check against panel reads" is done here, at test and verify time, not at run time. RP is not derived (not in the data). CF2 (Discord post line, news desk, press weighting) is a separate task.
- **Deploy order (for the operator's OK):** 1) fresh backup, apply `0083_club_finals.sql` on Hotel-Echo; 2) deploy `worker` (fills the tables on its next pass; check `[ingest] Club Finals nhl27: 33 games, 3 attempts` in its log); 3) deploy `web` (new image: this also clears cached game pages that were built before the badges existed, since game pages cache forever). Web before the worker is safe: it shows no badges and an empty page text until rows exist. Rollback: roll back code, then the DROP TABLE block in the migration header.
- **Git state:** branch `work/club-finals-cf1`, rebased on `main` at `fc7c7a2d`, checks pass (see above).

## Verifier result (Verifier fills)

- **Ran:** (2026-11-14, own worktree `.claude/worktrees/verify-cf1`, detached at `02b0b4c0`, no code edits, read-only database access.)
  - Rebuilt the state on my own: read the 38 NHL 27 `gameType10` games (33 with code 10, 5 with code 206) from the live database (read-only), walked them with the rules in a small script (scratchpad `verify-cf1/sim.py`, not in the repo), compared with the engine panel reads (inbox file: 10 reads; plus the 11-12 19:13 read in `club-finals.jsonl`; 11 in all). Each read is matched to the last game that ended before its time. DB times in America/Edmonton line up with the panel clock (reads come 1 to 4 minutes after a game).
  - Checks on the branch: db build, typecheck db / web / worker / discord, web test:unit, worker `tsc -p .` + `node --test dist/__tests__/club-finals.test.js`, db `club-finals-panel.test.js`, prettier on the changed files (not the .sql). Path check: `git diff --name-only main...work/club-finals-cf1`.
- **Got:**
  - Reads compared: 11 (10 inbox + 11-12 19:13). Mismatches: 0 (round, W/L boxes, attempt W-L).
  - Attempt 1 ended with match 3431 (4scin, OTL 2-3, 11-12 19:08), game 5 of round 4. Round 4 = W (3427), L, L, L (3430 Homie Time), OTL (3431). Attempt 1: reached the final, 13-9, eliminated. Attempt 2: 3432-3435, 0-4, eliminated (3435 DNF). Attempt 3: 3436-3442, running, round 2 at 1-1, attempt 5-2. After 3427 the attempt stood at 13-5 (the panel's best).
  - Code 206: including the 5 games does NOT change any of the 10/11 panel matches (all reads come after the 206 games, so reads cannot decide it). It breaks the rules instead: attempt 1 would reach "round 5" (no such round) at 16-11, and after 3427 it would be 16-7, not the panel's 13-5. So 206 is left out for a game reason, not a read reason.
  - Checks: db build ok; typecheck db, web, worker, discord clean; web unit 719/719; worker club-finals 13/13; db club-finals-panel 3/3; prettier clean. `packages/db/src/queries/club-finals.ts` has no test file of its own (the rules are tested in the worker).
  - Path check: 19 files, all inside "May edit" (worker `club-finals.ts`, `club-finals-sync.ts`, `ingest.ts`, test; migration 0083; db schema and queries incl. the two index files; web club-finals page, games pages, badge/card components, nav link; this task file). Nothing outside.
- **Compared with claim:** Report numbers agree with mine: 0 mismatches over 11 reads, 3431 ends attempt 1, 13-9 / 0-4 / running 5-2, 206 left out, history table rows spot-checked (3410, 3426, 3431, 3435, 3440, 3441) and match. Not verified by me: migration 0083 SQL on a real database (nobody ran it; Report says so), screenshots (not looked at), the worker's run-time behaviour. One small note: the "11 timed reads" in the Report come from two engine files; the inbox file alone has 10.
- **Verdict:** pass (migration SQL still unexecuted: run it on a disposable copy or under a fresh backup at deploy)
