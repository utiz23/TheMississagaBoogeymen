# Task: /gm ask — the GM's text is a private brief by default, never posted

- **State:** Running (since 2026-11-14 19:12; task agent of `Lead2`)
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (what reporters post to players)
- **Slug:** gm-ask-brief (branch `work/gm-ask-brief`)
- **Operator approval:** 2026-11-14 19:12 ("the gm interview prompt did not work as intended")
- **Operator gate before merge:** yes (dry-run samples)
- **Needs a deploy:** `press`
- **Helper model:** Opus

## What happened (live, 2026-11-14 19:07, game 3448, `news_gm_asks` id 1)

The operator used `/gm ask` for yoma with the text "Ask him about his disaterous game on defense, and ask why
he would go for a push faceoff in the offensive zone when he is lined up on the blue line. Put the heat on
him." `exact` defaults to **true** (T2, `apps/discord/src/press/gm.ts` ~line 573), so Dex Mercer posted that
text word for word to the player. The operator meant a private brief for the reporter.

## Goal and visible result

1. **Default = brief:** `exact` defaults to **false**. The GM's text is a private brief: the reporter writes
   ONE question in his own voice from it (keeping the GM's angle and tone; "put the heat on" = a tough, fair
   hockey question inside the hard lines), addressed to the player in the second person.
2. **The brief is never posted:** a code check refuses a written question that repeats the brief (for example
   5+ words in a row from it), or that contains reporter-instruction phrasing ("Ask him", "ask her", "put the
   heat on", "Ask why", third person about the player being asked). On refusal: rewrite (as the writer's
   existing retry), then fall back to an ordinary game question; never post the brief.
3. **Word for word** stays only when the GM sets `exact: true` explicitly. The option text says so clearly
   (e.g. "exact: post my text word for word (off = a private brief the reporter rewrites)").
4. **Private reply to the GM** says what will happen: "Got it: Dex Mercer will ask yoma, in his own words,
   about: <brief>" or, with exact, "…will ask yoma word for word: <text>".
5. Unchanged: Leave me out refused; a critical brief for a Go easy player refused (existing criticality
   check, fail closed); hard lines, no crude quotes, typos in the brief never copied ("disaterous").
6. Also check `/gm interview` topics: a topic typed by the GM is a brief, never posted word for word (add
   the same repeat check if it is not there; say what you found).

## Paths

- **May edit:** `apps/discord/src/press/` (gm.ts, question writing, the checks, tests), this task file.

## Checks

discord typecheck and tests (zero real model calls); prettier. Tests: default is brief; the live case above
never posts the brief (fake writer that echoes the brief → refused → fallback); exact: true posts as typed;
Go easy + critical brief refused; reply text. Dry-run samples (fake model, wording by hand where needed) in
`/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/samples-gm-ask/samples.md`.

## Done when (written before the work starts)

- **Done when:** checks pass and the operator OKs the samples. Reason: a GM brief must never reach the player.
- **Not done if:** any path can post a non-exact brief's text to a player.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 19:12 Lead2: written from the operator's report (Discord paste, 19:07). Cause found: `exact` default true.

Resume: task agent makes the branch and worktree, writes the failing test for the live case first.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
