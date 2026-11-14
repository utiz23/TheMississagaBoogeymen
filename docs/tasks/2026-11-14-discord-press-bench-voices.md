# Task: T7 — people who watched in the call (the "bench") can talk to the press

- **State:** Ready (operator 2026-11-14); starts after T6 is merged (same files)
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

## Report
