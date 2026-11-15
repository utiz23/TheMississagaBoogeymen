# Task: CF2 — Club Finals in Discord: game post line, news desk and press weighting

- **State:** Deployed 2026-11-14 17:59 (operator: "deploy now")
- **Lane:** Discord (`apps/discord/src/`), Queries (read CF1's derived states)
- **Risk:** medium (what the channel reads on finals nights)
- **Slug:** club-finals-cf2
- **Operator gate before merge:** yes (dry-run samples of a post, a recap and a scrum opener)
- **Needs a deploy:** `discord`, `news`, `press`
- **Helper model:** Opus

## Goal and visible result

From CF1's per-game Club Finals state:

1. **Game post** (Discord poster): one line, e.g. "Club Finals · Round 3 · Game 5 · series 3-1", plus
   "ROUND WON", "ELIMINATED" or "THE FINAL" when true.
2. **News desk:** finals games weigh more: a round won, an elimination and every final game are always
   covered; the final gets the bigger piece (a feature-length recap). Writers get the round, game number
   and series score as facts (from CF1, never guessed).
3. **Press bots:** elimination, round won, any final game and a series decided in its last game are
   **big moments** (the E5 list: operator's "adjust later"): they open the scrum; tone follows the moment
   (the hard lines, Go easy and no crude quotes rules unchanged).

## Paths

- **May edit:** `apps/discord/src/` (poster line, news desk input and weighting, press big moments + tests),
  `packages/db/src/queries/club-finals.ts` (reads only, + tests), this task file.

## Checks

discord typecheck and tests (zero real model calls); db tests by name; prettier. Dry-run samples for
the operator (fakes or the test channel only).

## Done when (written before the work starts)

- **Done when:** checks pass and the operator OKs the samples. Reason: finals nights are the ones the
  team cares about most.
- **Not done if:** a round or series number in a post is not CF1's stored value.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 15:08 Lead2: written (Ready; after CF1).

- 2026-11-14 16:50 Lead2: started (CF1 live; B2 merged, so the press/news code is settled).

- 2026-11-14 17:07 task agent: branch `work/club-finals-cf2` and worktree made from `main` (a7b4d1cb). Read CF1 (queries, `club-finals-view.ts` words) and the poster, news desk and press code. Built: `apps/discord/src/club-finals.ts` (words, floor, facts, moment tone), poster line, news weighting and writer facts (game posts, game articles, night recap), press big moments + tone line. Tests added. Samples (fakes only) written. State = Verify.
- Design choices the operator may change (all in `club-finals.ts`): floors normal / big / huge as in the Report; a DNF or "ended early" game keeps staying quiet (spec §12.12-3), so an elimination by DNF (game 3435) is not a big moment; the line says "Attempt N" (the site's word) and the series score after the game, never a before/after pair; the tone lines are in `MOMENT_TONE`.

- 2026-11-14 17:45 Lead2: operator "approved" (samples); DNF rule "Yes" (quiet, no ping). Rebased; discord
  typecheck clean, 957/957; merged `--ff-only`. Deploy asked separately (it changes what posts in #chel).

- 2026-11-14 17:55 Lead2: operator "D22 D23 deploy". Held: the team was playing at 17:00–17:36 (3v3,
  code 206) with a scrum open; a `press`/`news` restart could cut the scrum and the night's news. CF2 only
  changes 6v6 Club Finals games, none tonight so far. HE already holds the code (`c23e577c`).

- 2026-11-14 17:59 Lead2: operator "deploy now" (mid-session, accepted). Rollback tags
  `eanhl-team-website-{discord,news,press}:rollback-he-2026-11-14-pre-cf2`; built and restarted all three.
  press "started (live) … 9 bots" and "Barlow is in 3 of 3 open threads" (the open scrum kept); news live
  ($100 cap); discord live.

Resume: watch the next 6v6 Club Finals game's post line, news weight and scrum.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
  - **Game post:** a first line on every Club Finals game, from CF1's stored values only, e.g. `Club Finals · Attempt 3 · Round 1 · Game 5 · Series 4–1 · ROUND WON`; a game of the final reads `Club Finals · THE FINAL · Attempt 1 · Game 5 · Series 1–4 · ELIMINATED · run ends 13–9`; `FINAL WON` for a won final. No line when the game has no stored state (regular games, games after a won final). A failed read leaves the line out and the post still goes out once.
  - **News desk:** floors. Ordinary Club Finals game: normal (2 posts, no article). Round won or elimination: big (3 to 5 posts and a game story). Any game of the final, a won final and a round decided in its 7th game: huge (6 to 8 posts, a game story and a spotlight or column of 400 to 700 words). A game that already weighs more keeps its weight. Writers (game posts, game articles, night recap) get a CLUB FINALS block with the stored round, game, series, run record and stakes; the review gets the same lines as true notes; the number check allows exactly those numbers (and the rule limits 4 and 7).
  - **Press:** a round won, an elimination, every game of the final, a won final and a round decided in its 7th game are big moments: the scrum opens at big or huge and the picked player is pinged (the 3 pings a night limit, GM asks, heat, Go easy, Leave me out, hard lines and no-crude-quotes rules are unchanged). The scrum writer gets the same facts as desk notes and a one-line tone for the moment.
  - Samples for the operator (fakes only): `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/samples-cf2/samples.md`.
- **How it was checked (commands, numbers):** `pnpm --filter @eanhl/discord typecheck` pass. `pnpm --filter @eanhl/discord test` 957 pass, 0 fail (was 910 on `main`: 47 new tests; zero real model calls, all fakes). `node --test packages/db/dist/queries/__tests__/club-finals-panel.test.js` 3 pass (db unchanged). `prettier --check` on every changed file: pass (`pnpm format:check` lists 8 other files that were already unformatted on `main`; none is in this diff). The drift guard test checks `planForLevel` against `planBuzz` on 400 games.
- **Not done:** no dry run through the live web app (no Docker, no web internal route here): the samples are built from the real code with fake stars. The weekly feature, the interview and the Press Box are not changed (no Club Finals facts there). A DNF or "ended early" elimination (game 3435) stays quiet: operator decision (see Log and samples). Not run: worker integration tests (not touched).
- **Deploy order:** no migration, no web or worker change; CF1 is live and the three services read its tables (`getClubFinalsBadge(s)`). Deploy `discord`, `news` and `press` together (press and news use the same floor; one without the other gives a post without its scrum ping). Rollback: the previous image tags. Operator's OK first.
- **Paths outside "May edit":** none. All changes are in `apps/discord/src/` plus this task file.
- **Git state:** branch `work/club-finals-cf2`, rebased on `main` at a7b4d1cb, checks pass (see above).
