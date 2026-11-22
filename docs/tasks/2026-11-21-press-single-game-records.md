# Task: Single-game records and personal bests on the fact sheet; reporters lead with them

- **State:** Ready
- **Lane:** Queries (`packages/db/src/news/`, `packages/db/src/queries/`) + Web (`apps/web/src/lib/news/`) + Discord
  (`apps/discord/src/press/`, `apps/discord/src/news/` prompt rules)
- **Risk:** medium (public bot text; claims "club record" numbers: a Verifier checks them)
- **Slug:** single-game-records
- **Operator approval:** 2026-11-22 00:02 ("D1 D2 yes"; written on the operator's "write the records task")
- **Helper model:** Sonnet
- **Operator gate before merge:** yes (dry-run sample questions)
- **Needs a deploy:** `web` (the fact sheet), then `press` and `news`

## Why (from the game)

Game 3460 (11-21, 4-1 vs Toxic Walrus): Stick Menace had 52 PIM in 21:42 (0 G, 1 A, 1 shot, 4 hits, 5 penalties
drawn). 52 is the most PIM by anyone in any game the site stores (next: 30, 2026-09-12). The scrum asked about
his 14-game point streak and his 1 shot; Dex then read the PIM as a weakness. Player feedback: "Ask about me
being a goon, dont ask me about the 1 point." Cause: the fact sheet flags season-total records, streaks and
milestones, but no single-game record and no personal best, so a routine streak outranks a record night.

## Goal and visible result

1. **Fact sheet:** per game, per player, a "standouts" list: a **club single-game record** (new or tied) and a
   **personal single-game best**, for goals, assists, points, shots, hits, PIM, takeaways, interceptions,
   blocked shots, penalties drawn, and for goalies saves. Each line has the stat, the value, the old record
   and its holder/date, and the scope in words: "most in one game since the site began tracking games (NHL 26,
   January 2026)". Older titles have only season totals: never called a game record.
2. **Reporters:** one rule (scrum writer, interview writer, news writer): a standout on the sheet comes before a
   routine number or a streak. A big PIM line is described as it is (minutes, record), never assumed to be
   good or bad; EA has no fight data, so the bots never say "fight" unless the player or a confirmed
   background fact says it.

## Operator answers (2026-11-22, "D1 D2 yes")

- **D1:** club records count **team members only** (the member-only rule for player pages: EA member list for
  any title, member archive, pinned); **AI goalies out**. Drop-ins never hold or break a club record.
- **D2:** a personal best only from a player's **3rd stored game** on, and only for a value of **2 or more**.

## Paths (draft; the task agent may not go wider)

- **May edit:** `packages/db/src/news/contract.ts` (+ test), a new query in `packages/db/src/queries/` (+ test),
  `apps/web/src/lib/news/` (build/load facts, rank, + tests), `apps/discord/src/press/asker.ts`,
  `apps/discord/src/press/interview-asker.ts`, `apps/discord/src/news/prompts.ts` (+ tests), this task file.
- **Must not touch:** schema/migrations, the worker, the score formula.

## Checks

db build; typecheck db, web, discord; web unit; discord tests; db tests by name; prettier; eslint on changed
files. Evidence: the fact sheet of game 3460 shows the 52 PIM club record (old 30) and nothing false; 5
dry-run scrum questions for Stick Menace on game 3460 (no posting).

## Done when (written before the work starts)

- **Done when:** a Verifier recomputes the club single-game maxima from `player_match_stats` and the sheet's
  standouts match for games 3460 and 3 more recent games (0 mismatches); at least 4 of 5 dry-run questions for
  Stick Menace on 3460 lead with the PIM record; checks pass. Reason: a record night must be the first
  question, and a "record" the bots claim must be true.
- **Tolerance for the Verifier:** 0 wrong standouts.

## Log

- 2026-11-21 23:55 Lead3: written from the operator's request and the 11-21 scrum. Read only: game 3460 lines; top
  single-game PIM 52 / 30 / 28.
- 2026-11-22 00:02 Lead3: operator "D1 D2 yes" → Ready.
- Resume: a task agent takes it (P2).
