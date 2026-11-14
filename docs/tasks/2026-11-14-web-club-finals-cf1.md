# Task: CF1 — Club Finals: rounds from EA results, game badges, the Club Finals page

- **State:** Running (since 2026-11-14 15:08; task agent of `Lead2`; Opus: numbers teammates see)
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
3. **Club Finals page** (pick the place in the site nav that fits; say where): the current attempt
   (round, W/L boxes like the panel, attempt W-L), past attempts (rounds reached, record), best record.
   Always dark, red accents, scoreboard look (the site's design direction).
4. **Season 1 history:** a table in the Report: every Club Finals game 11-06 → today with its derived
   attempt/round/game, next to the panel reads where they exist (old vs new side by side for the
   operator).

## Paths

- **May edit:** `apps/worker/src/` (a new `club-finals.ts` + tests; one call after a pass),
  `packages/db/migrations/0083_*.sql`, `packages/db/src/schema/`, `packages/db/src/queries/` (new
  `club-finals.ts` + tests), `apps/web/src/app/` (game pages and lists: badges only; the new Club
  Finals page), `apps/web/src/components/` (badges, the page's pieces, one nav link), this task file.
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

- 2026-11-14 15:2x task agent: branch `work/club-finals-cf1` and worktree made; panel file and the 33 live 6v6 games read. Rules written as tests first (`apps/worker/src/__tests__/club-finals.test.ts`, 13 tests), then `club-finals.ts` (pure rules). Replay of the 33 games matches all 11 panel reads that have a time. Migration 0083 (two tables), schema, queries, worker step after a pass and a quick check, badges on /games and game pages, page `/club-finals`, nav link. Typecheck db, worker, discord, web pass.
- 2026-11-14 15:2x finding: code 206 is NOT Club Finals (reason in Report). Attempt 1 ended with match 3431 (4scin, OT loss), game 5 of round 4: the Engine Lead's guess holds.

Resume: screenshots from the read-only dev server (port 3400, tunnel 5437), history table and Report, rebase on main, checks, State = Verify, commit.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Season 1 history table:**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
