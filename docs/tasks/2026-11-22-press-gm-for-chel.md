# Task: /gm ask, interview, note and heat for everyone with the Chel role

- **State:** Ready
- **Lane:** Discord (`apps/discord/src/press/`)
- **Risk:** medium (who may steer a public bot; no data change, no migration)
- **Slug:** gm-for-chel (branch `work/gm-for-chel`, worktree `.claude/worktrees/gm-for-chel`)
- **Operator approval:** 2026-11-22 00:23 ("also enable the gm commands for everyone with chel role"; picked: interview, ask,
  note + heat; testscrum stays GM-only)
- **Helper model:** Sonnet
- **Operator gate before merge:** yes (test output; then deploy `press` with the operator's OK)
- **Needs a deploy:** `press` (the command registration changes on start)

## Goal and visible result

Everyone with the Chel role (`CHEL_ROLE_ID` in `config.ts`, the role the bench uses) can use `/gm ask`, `/gm
interview`, `/gm note` (and its correct/cancel buttons, which only the note's author sees) and `/gm heat`.
`/gm testscrum` stays GM-only (`PRESS_GM_USER_ID`). Everyone else gets the existing "GM only" refusal. The
GM keeps everything as today.

**Lead's safety defaults (the operator may change them):**

1. `/gm ask exact` (post the brief word for word) stays **GM-only**: for a Chel member `exact` is ignored and the
   reporter rewrites the brief. Reason: otherwise anyone with the role can make a reporter bot post any text.
2. **Who did it** is logged: every `/gm` action by a non-GM writes one press log line with the Discord user id
   and the subcommand (no new column; `news_gm_notes` has no author column).
3. Fairness rules stay for everyone (a "Leave me out" player is never touched; no critical note for "Go easy";
   one open interview per player; the news cap).

## Paths

- **May edit:** `apps/discord/src/press/gm.ts`, `interview.ts`, `interview-gateway.ts`, `gateway.ts` (the `/gm`
  registration: visible to members, `default_member_permissions` no longer `'0'`; the role must reach the
  handlers), `config.ts`, `test-scrum.ts` (only if the GM check moves), their tests, this task file.
- **Must not touch:** schema/migrations, other services, the Press Box (it acts as the GM).

## Checks

discord typecheck; discord tests; prettier; eslint on changed files (no new problems). Tests: a Chel member may
ask / interview / note / heat; a member without the role is refused for all; testscrum refused for a Chel
member; `exact` ignored for a Chel member; the GM unchanged.

## Done when (written before the work starts)

- **Done when:** the tests above pass, the checks pass, and the `/gm` registration is visible to members while
  every handler checks GM or Chel itself. Reason: the operator opened four tools to the team, nothing more.

## Log

- 2026-11-22 00:23 Lead3: written from the operator's order and choices.
- Resume: a task agent (or the Lead, if the operator says so) takes it.
