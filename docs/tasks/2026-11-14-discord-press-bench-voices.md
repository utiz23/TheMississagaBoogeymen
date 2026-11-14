# Task: T7 — people who watched in the call (the "bench") can talk to the press

- **State:** Deployed 2026-11-14 (0077; rollback `:rollback-he-2026-11-14-pre-t7`)
- **Lane:** Discord (`apps/discord/src/press/`), Database (one migration if a non-player person needs
  rows), Web (privacy text)
- **Risk:** medium (new data source: who is in the voice call; non-players in stories)
- **Slug:** press-bench
- **Operator approval:** 2026-11-14 (GM + volunteer; "Coach" + Discord name; privacy paragraph approved,
  adjusted by the Lead for the volunteer choice, see below)
- **Operator gate before merge:** no; migration and deploy with the operator's OK
- **Needs a deploy:** migration (next free number), `press`, `news` if shared code, `web` (privacy text)

## Why

Joey (player 5, Joey Flopfish, Discord 447213088828030998) watched a game night in the call from the
other side of the planet and could not play; the team called him "coach". The real coach role is
usually Discord user 431630903048011777 (not a player in the database), rarely in the call.

## Goal and visible result

- **Who is "bench":** for a game, a Discord user who was in the **same voice channel as the game's
  players** around the game's end, has the **🏒 Chel** role (`1423500221148696659`), did not play that
  game, is not a bot, and (if a known player) is not on "Leave me out". Voice channels of the guild are
  read from the gateway (`GuildVoiceStates` intent, not privileged; on Barlow); kept **in memory only**,
  never stored. A bench person may also be named by the GM even when the call check is unavailable.
- **GM:** `/gm ask`, `/gm note` and `/gm interview` accept a bench person for that game (today they
  refuse "not in that game"). The GM's private reply to these commands lists who was in the call and
  did not play ("In the call, not playing: Joey Flopfish, Coach Mike").
- **Volunteer:** a bench person may press "Talk to the press" on that game's recap (or `/scrum`) and
  gets the volunteer round.
- **Coach:** Discord user `431630903048011777` (configurable `PRESS_COACH_USER_IDS`, comma list) is
  named **"Coach <server nickname>"** and asked as the coach (tactics, bench view); everyone else on
  the bench is asked as someone who watched from the call. Questions never pretend a bench person
  played; facts about them come only from the game sheet and, for a known player, their own records.
- **Quotes:** usable answers may be quoted in the night recap as from the bench ("said Joey Flopfish,
  watching from the call"; "said Coach Mike"). All T5 rules apply (hard lines, feuds, no crude quotes).
- **Data:** a scrum/interview person today needs a `player_id`. For a non-player (the coach) allow a
  person keyed by Discord user id with a display name and a `role` (`player` | `bench` | `coach`):
  hand-written idempotent migration with rollback, existing rows unchanged. Agent's choice of shape;
  say why.

## Privacy paragraph (approved 2026-11-14; Lead adjusted for the volunteer choice)

> **Who is in the team's voice call.** On game nights the bots check who is in the team's voice
> channel, only so people who watched but did not play can be invited to, or step up to, talk to the
> press. We do not store who was in the call. If you answer, the rules for answers to reporters apply.

Goes into `apps/web/src/content/legal/privacy.tsx` and `data-collection.tsx`; `lastUpdated` on release day.

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/` (recap attribution only),
  `packages/db/src/schema/`, `packages/db/src/queries/news*.ts` and their tests,
  `packages/db/migrations/<next>_*.sql`, `apps/web/src/content/legal/`, `.env.example`,
  `docker-compose.yml` (press env only: `PRESS_COACH_USER_IDS`), the press runbook, this task file.

## Checks

db build; typecheck db, discord, web, worker; discord tests; changed db tests by name; web unit; prettier.
Tests: bench detection (same channel, role, did not play, bots and Leave me out excluded, in memory
only), GM commands accept a bench person and list the call, volunteer path, coach naming, quotes
attribution, a non-player person end to end, no presence stored.

## Done when

All checks pass and the tests pin the rules above.

## Log

- 2026-11-14 Lead: written from the operator's request and answers.
- 2026-11-14 task agent: built on `work/press-bench` (commit 1d7a70ea). Voice intent checked in the Discord docs (Context7): `GUILD_VOICE_STATES` (1 << 7) is not privileged; `GUILD_CREATE` carries the voice states. The one thing outside "May edit" that was needed, `press-main.ts`, is not touched (ruling 73: a process-level bench port set in `startClients`). Rulings 70-77 added. No Docker, no live step, migration not applied, nothing pushed.

- 2026-11-14 Lead review: on c7e1214e; paths inside "May edit" plus rulings 70-77; migration 0077
  read (player_id nullable on 5 tables, person_role + display_name, named-person checks, partial unique
  indexes; existing rows unchanged; one transaction; rollback in header). Re-ran: typecheck
  db/discord/web/worker clean; discord 807/807; news db tests 128/128; web unit 672/672; prettier
  clean; compose passes `PRESS_COACH_USER_IDS`. Deploy: backup → 0077 → `press`, `news`, `web`;
  `.env` `PRESS_COACH_USER_IDS=431630903048011777`; privacy `lastUpdated` that day.

- 2026-11-14 Lead: deployed on "Deploy T7": backup `eanhl-pre-0077-2026-11-14.dump`, 0077 applied, `PRESS_COACH_USER_IDS` set, `web`/`news`/`press` rebuilt; privacy page shows the paragraph.

## Report

### What changed

- **Who is bench** (`press/bench.ts`, new): a Discord user in the same voice channel as the game's players from 20 minutes before to 30 minutes after the game's end, with the Chel role (`1423500221148696659`, default; `PRESS_BENCH_ROLE_ID` optional), not a player of the game, not a bot, and (a known player) not on "Leave me out". The voice states are read from Barlow's raw `GUILD_CREATE` / `VOICE_STATE_UPDATE` events (`GuildVoiceStates` intent added for Barlow only; not privileged) and kept in a `VoiceTracker` in memory for 12 hours. Nothing is stored or logged. Guild members (role, nickname, bot flag) come over REST with a 5-minute cache (no privileged members intent). A test reads the sources: only type imports from the db package, no store write.
- **Coach:** `PRESS_COACH_USER_IDS` (comma list; `.env.example`, `docker-compose.yml` press env) -> "Coach <server nickname>", asked as the coach.
- **GM:** `/gm ask`, `/gm note` (known player) and `/gm interview` accept a bench person (the coach always; others must have been in the call; with the call unavailable the GM's word counts for a known player or a Chel member). The private reply of the three ends with "In the call, not playing: Joey Flopfish, Coach Mike" (or "Call check unavailable"). A `/gm ask` for a bench person before the scrum exists joins the scrum when it opens (checked again then).
- **Volunteers:** "Talk to the press" and `/scrum` accept a bench person: the volunteer round. Others keep the old refusals.
- **Asking:** a `subject` (`press/subject.ts`) replaces "the person on the sheet": a bench person or the coach is not on the sheet, so the request says they did not play, never to credit them with a play, stat or position, and to name only them (`benchLines`, scrum asker, judge, interview questions and article). Fallback questions for them are a bench pool (never "your game"). No feud points or levels for a person with no player row.
- **Quotes:** the night recap offers a bench or coach answer, attributed "did not play; watched from the team's voice call" / "the coach; did not play" (PRESS ROOM block, review's trusted material); the code check accepts such a speaker, who is never on `facts.people`; interview articles keep `mentions` empty for them.
- **Privacy:** the approved paragraph is in `privacy.tsx` and `data-collection.tsx`. `lastUpdated` untouched (Lead, release day).
- **Prompt change:** `NEWS_RULES_VERSION` 2026-11-13.4 -> 2026-11-14.1.

### Schema choice and why

No second people table. `player_id` becomes nullable on `news_scrum_people`, `news_scrum_answers`, `news_gm_asks`, `news_interviews`, `news_interview_answers`; `news_scrum_people`, `news_gm_asks`, `news_interviews` get `person_role` (`player` default | `bench` | `coach`) and `display_name`; `news_gm_asks` also `discord_user_id`. Checks: null player needs a display name (gm asks: a user id too). Two partial unique indexes (scrum + Discord user; one open interview per Discord user) because the old unique rules never conflict on NULL; `insertScrumPerson` now has no conflict target. Why: every claim, unique rule, thread lookup and article step stays as it is, and every existing row stays a `player` with no change. A known player on the bench keeps `player_id` and gets `person_role` 'bench' (name from the profile, so no display name). Cost: nullable columns; code that reads `playerId` now handles null (feuds, panel takes, asks).

### Migration 0077 and rollback

`packages/db/migrations/0077_press_bench.sql`: `DROP NOT NULL` (safe to repeat), `ADD COLUMN IF NOT EXISTS`, checks dropped and re-added by name, `CREATE ... INDEX IF NOT EXISTS`; hand-applied with psql like 0072-0076, BEFORE the code (press and news select the new columns). Not applied; the SQL was never run on a database (no Docker); a test pins its shape (statements, idempotence, rollback in the header, no DROP TABLE / DELETE / UPDATE). Rollback (header): delete every row with `person_role <> 'player'` or `player_id IS NULL` from the scrum people (answers cascade), interviews (answers cascade) and GM asks, `SET NOT NULL`, drop the indexes, checks and columns. Run it only after rolling back the code.

### Checks (after `pnpm --filter @eanhl/db build`, in the worktree, after the rebase on `main` c7e1214e)

- Typecheck: db, discord, web, worker: all clean.
- `pnpm --filter @eanhl/discord test`: 807 tests, 807 pass (766 before; 25 new in `bench.test.ts`, a few updated).
- db: `news-press`, `news-interviews`, `news-feuds`, `news-wire-replies`, `news` test files by name: 128 of 128; full `pnpm --filter @eanhl/db test`: 239 of 239.
- web `pnpm test:unit`: 672 of 672.
- Prettier: all changed files clean.
- Not run: the migration on a database, `pnpm --filter web build`, any Docker or live step, a real Discord voice event (the gateway glue only converts; the parse and the tracker are tested), a screenshot (no UI change except the privacy text).

### Tests that pin the rules

Bench detection (same channel, role, did not play, bots, "Leave me out" and other channels excluded, the 20/30-minute window, late joiners and early leavers, unavailable call), in memory only (no db imports, no writes), voice parsing from raw events, member cache, config; GM ask/note/interview accept bench people and list the call, refuse a person not in the call, wait for the scrum when it opens; volunteer paths (button and `/scrum`) and refusals; coach naming; the fallback question pool; a non-player end to end (the coach: `/gm ask` -> ping -> Accept -> answer -> stored with no player id -> quote "did not play" -> PRESS ROOM text); a known bench player's quote; the coach's interview (row, offer, questions with the coach request lines, stored answer); migration and query SQL shape.

### Not done / open risks

- `press-main.ts` unchanged (ruling 73). The real gateway glue (`attachVoice`, `fetchGuildMember`, `startClients` hook) is only type-checked: its first real run is on the live host. If the voice events do not arrive, every call check says "unavailable" and only the GM can name people.
- Bench people get no records of their own beyond the game sheet (a known player on the bench: no career facts added).
- A `/gm note` cannot name the coach (no player row); use `/gm ask` or `/gm interview` (ruling 74).
- The bench volunteer needs the voice data: after a press restart mid-game the tracker knows people only from the restart on ("unknown start" stays valid for people still there).
- Not measured: cost of the extra REST member calls (a few per bench check) and of bench questions (same as a scrum question).
- Rebased on `main`, one commit; nothing pushed, nothing merged, nothing deployed.

### Git state

Branch `work/press-bench`, worktree `.claude/worktrees/press-bench`. Commits on top of `main` (c7e1214e): the feature commit (1d7a70ea) and this Log/Report commit.
