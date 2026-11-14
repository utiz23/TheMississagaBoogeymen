# Task: L2 — Press Box: player dossiers and AI profiles

- **State:** Merged 2026-11-14 14:49 (`efe3dd27`); deploy waits for the operator's OK (D10)
- **Lane:** Web, Queries, Database (one migration), Discord (profile writer)
- **Risk:** medium (AI text about players; actions on players' press)
- **Slug:** press-box-l2
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** migration, `web` (and `news`/`press` if the profile writer runs there)

## Goal and visible result

Design §3.2; mock-up "Player dossier". `/admin/press-box/players` (index: members, bench people who
talked, coach; press level, relationship count, quote count, last scrum/interview, profile age) and
`/admin/press-box/players/[id]`:

- identity, nicknames, press level and who set it, role;
- form and milestones within reach (existing stats);
- "in their own words": usable and joke quotes with question and reporter; unusable and off-limits as
  counts only, never text;
- what the press thinks (takes and stances, read here; editing comes in L3), relationships per reporter;
- GM notes and asks, interviews (article links), scrums;
- **AI profile on demand**: "Write"/"Refresh" makes one model call through the news desk's writer with
  all writing rules, hard lines, no crude quotes; Go easy = no criticism; Leave me out = no profile and
  identity only; cost counted in the monthly spend; stored with its date and rules version;
- actions (logged): press level on the player's behalf, add/remove nicknames, add a GM note, start an
  interview, cool down a relationship.

## Data

`news_player_profiles` (player id or bench person, text, written_at, rules version, cost). Hand-written
migration with rollback.

## Paths

- **May edit:** `apps/web/src/app/admin/press-box/`, `apps/web/src/components/press-box/`,
  `packages/db/src/queries/` (press-box files + tests), `packages/db/src/schema/`,
  `packages/db/migrations/0081_*.sql` (0079 is E1's, 0080 is L1's), `apps/discord/src/news/` (profile
  prompt + writer entry only), `apps/discord/src/press/box-requests*.ts` and the one `pass.ts` step that
  runs them (new request kinds only),
  this task file.

## Checks

As L1, plus tests: Leave me out shows identity only, Go easy profile has no criticism rule in its
prompt, off-limits text never rendered, profile write is one call and recorded in spend.

## Done when

All checks pass; screenshots match the mock-up.

## Log

- 2026-11-14 Lead: written.
- 2026-11-14 14:04 Lead2: started after L1 was deployed (14:01). The web app has no Anthropic key and
  no bot tokens: "Write"/"Refresh" profile and "start an interview" go through L1's request queue
  (`news_press_box_requests`, read by `apps/discord/src/press/box-requests.ts` in the `press` service),
  as L1's test scrum does: add request kinds (migration 0081 widens the kind check), the press service
  does the model call / interview and records the cost in the monthly spend. Then `press` is in the
  deploy too. Running beside D4 (worker watchdog).

- 2026-11-14 14:08 task agent: worktree `.claude/worktrees/press-box-l2` (branch `work/press-box-l2`) made; install + db/ea-client build done; read design §3.2, mock-up "Player dossier", L1 code. Plan: migration 0081 (profiles table; request kinds profile + interview with target columns), db queries, press-service handlers, web pages.

- 2026-11-14 14:19 task agent: DONE migration 0081 (profiles table, request kinds profile/interview + target columns), schema, `press-box-dossiers.ts` queries (index, dossier read, actions with audit, request queue, profile store), db tests (11 new, 15 old still pass), press service: `news/profile.ts` (writer: one write + one review, no digits/quotes, Go easy rule, Leave me out refused before any call), `press/box-requests-profile.ts` (profile and interview handlers), tests (discord suite 864 pass, typecheck clean). Migration SQL not run: no database on this PC.

- 2026-11-14 14:39 Lead2: reviewed. Every new page and all six dossier actions call `requireAdmin`
  first; `quotesSql` blanks question/answer for anything not usable/joke and filters those rows out;
  counts read no answer column. Profile writer: budget check before any call, Leave me out = no read and
  no call, Go easy = no criticism, no quotes, answers treated as data. 0081 only adds a table, columns
  and checks (test scrums exempt from the target check; live has 0 request rows). Paths: all inside
  "May edit". On current `main`: typecheck db/web/discord/worker clean; web 719/719; discord 864/864;
  db press-box + dossiers 26/26; prettier clean. The 3 failing db `dist` tests (action-tracker-provenance,
  match-lineups-cpu, run-quality) fail on `main` too: not from L2. Screenshots seen. One label is wrong:
  the profile card says "one AI call", but a click makes 2 model requests (write + review).

- 2026-11-14 14:48 task agent: operator answered D7 to D9 (keep write + review; admin may raise Leave me out). Profile card texts now say "2 AI requests (one writes, one checks the rules), about $0.05 together". No other change.

- 2026-11-14 14:49 Lead2: operator "D7 screenshots ok / D8 Yes / D9 yes": keep write + review; an admin
  MAY raise a "Leave me out" player's press level (as built, logged). Label fix `49d53243` checked
  (2 texts only). Rebased; web + discord typecheck clean; web 719/719. Merged `--ff-only`.

Resume: operator's OK to deploy (D10): fresh backup, 0081, then `press`, then `web` (never web first).

## Report

**What changed.** Migration 0081 (table `news_player_profiles`; request kinds `profile` and `interview` with target, reporter and topic columns). Db: `press-box-dossiers.ts` (index, dossier read, audited actions, request queue, profile store). Press service: `news/profile.ts` (profile writer) and `press/box-requests-profile.ts` (profile and interview handlers, dispatched from `box-requests.ts`). Web: `/admin/press-box/players` (index) and `/players/[id]` (dossier); the Dossiers tab points there.

**Decisions to know.**

- "One call" = one click makes ONE write and ONE review through `writeChecked` (`maxWrites` 1, no rewrite loop). That is 2 model requests, both recorded in `news_ai_usage`; the stored profile cost is their sum. A failed check stores nothing and the click can be repeated. If the Lead wants a literal single request (no review), say so.
- Profile rules: hockey only, no digits or number words, no quotation marks and no 4-word copy of an answer, only the person and reporters named, clean language (writer's crude check). Go easy: no-criticism rule in system prompt, person line and review; critical takes and feud levels are not offered. Leave me out: refused before any read of their words or any model call, in the press service, the db material query and the page (identity only, no profile shown even if one was stored earlier).
- The press 80% extras stop applies to profiles.
- GM note from the web: refused for Go easy (needs the Discord criticism check) and for Leave me out, and when the text names a Leave me out player. Note is for tonight's night, `critical` false, no model analysis. The audit line holds the note id, not its text.
- Press level can be set for a player by the admin, including out -> full or easy (logged "set for the player by the admin"; the line says when the player had set it). The operator may want to forbid raising a player's own Leave me out.
- Bench people and coach: listed in the index and have a read-only dossier (quotes, interviews, scrums) plus profile and interview requests; no press level, nicknames, notes or relationships. Live has none yet.
- Takes/stances shown read only (L3 edits). Stance rows are matched to the player by the id inside the thread key.
- Unusable answers: counts only. The quote SQL selects text only for usable/joke, the count SQL has no text column, `splitAnswers` drops text of unusable rows, no field in the dossier type can carry it.

**Checks (all in the worktree, after rebase on main).** db typecheck, web typecheck, discord typecheck clean. db new tests 11 pass, press-box tests 15 pass; web unit 719 pass, 0 fail (32 in press-box); discord 864 pass, 0 fail (new: 9 in `news/profile.test.ts`, 7 in `box-requests.test.ts`). `pnpm format:check`: my files clean; the 2 code warnings (`apps/worker/src/__tests__/health-endpoint.test.ts`, `packages/db/src/queries/archive-season-detail.ts`) and the docs/research warnings are on main already. db full `dist/**` run: 3 fails in `action-tracker-provenance`, `match-lineups-cpu`, `run-quality` (not touched by this task; they need a database).
**Not run:** migration 0081 itself (no Postgres on this PC; hand-checked against 0080, idempotent, rollback in header); worker integration tests; `pnpm lint` (red repo-wide); any real model call.

**Screenshots** (live DB, read-only tunnel; live has no relationships and no Go easy/Leave me out players, so those states are covered by tests, not pictures): `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-l2/index.png`, `dossier-silky.png` (matches mock: 48 goals, 106 assists, 110 GP, "2 goals from 50"), `dossier-silky-phone.png` (390 px), `dossier-erb.png`. Live lacks migration 0081, so the pages degrade (profile "not written yet").

**Paths outside "May edit":** none. (`packages/db/src/queries/index.ts` got one export line: it is under `queries/`.)

**Deploy order:** migration 0081 on live (operator OK, backup first) -> press service (needs `packages/db` rebuilt) -> web. Never web before press: the old press service runs every request as a test scrum. Discord `news` desk is unchanged.

**Not done:** editing takes (L3); bench-person profile has no live test data; no screenshot of a written profile (cannot write to live).
