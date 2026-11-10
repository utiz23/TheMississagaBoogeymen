# Workflow v2 seed (NOT in force)

Status: **used 2026-11-09** for `docs/operations/workflow-v2.md` (now in force); kept for reference. Was **seed only**, planted 2026-11-04 on the operator's request ("copy this new workflow into the
sister project, we will set it up later"). Until the operator starts the switch-over here, the rules in
`CLAUDE.md` and `docs/operations/agent-manager-workflow.md` stay in force. Nothing in this folder changes
how this repo works today.

## What it is

The engine repo (`eanhl-live-engine`) moved on 2026-11-03/04 from long-lived chats to **one Lead chat and
one short task chat per piece of work**. Each piece of work is a small file with a goal, the exact paths it
may edit, a written go rule and stop conditions; one branch and worktree per piece; only the Lead merges;
a Verifier re-checks any claimed number; the operator sees one live decision page.

Files here, copied unchanged from the engine at commit b9e2914:

- `workflow-v2.md`: the guide (roles, states, lanes, git rules, checks, evidence rules, limits, switch-over).
- `kickoff-prompts.md`: the prompts to paste (P0 wrap-up, P1 Lead, P2 task agent, P3 Verifier, P4 review).
- `task-template.md`: the template for one piece of work (the engine calls it a "card").

## What must change before it is used here

1. **Name clash: "cards".** This repo already uses "cards" for the player card system
   (`docs/specs/cards/`). Call the work items something else here, for example **tasks**, with a folder like
   `docs/tasks/` and a board `docs/tasks-board.md`.
2. **Lanes** (who owns which paths) must be drawn for this repo, for example: web app (`apps/web`), worker
   and EA ingest (`apps/worker`), database and migrations (shared, high risk: always an operator gate),
   OCR (`tools/game_ocr`, `tools/video_ingest`), operations and backups (`ops/`, backup producer), docs.
   The engine's check script `tools/check_card_paths.py` can be copied and adapted.
3. **Checks.** This repo has a pre-push hook with a test-database harness, not the engine's preflight
   script and GitHub CI. The preflight list in `workflow-v2.md` section 6 must name this repo's commands
   (`CLAUDE.md` "Commands").
4. **Live system.** The site and its database run on Hotel-Echo. Deploys, migrations and any write to the
   live database are operator decisions on every task that needs them, never part of a task agent's
   normal work.
5. **Run tags** are an engine thing (GPU queue); drop them or replace them with a deploy/migration log.
6. **Existing rules stay:** the Handoff Protocol (`HANDOFF.md` 100-150 lines), the Commit Protocol, the
   writing style, the backup rules. The Lead takes over keeping them.

## Lessons from the engine's switch-over (2026-11-03/04)

- Write the go rule and the "start when" condition on each task before it starts; give the operator the
  exact paste line with the model and effort in its title.
- Task chats ping the Lead when they finish **and** when they stop early. The Lead's chat name can change
  (renames); keep the current name at the top of the board.
- Keep a live operator page (`docs/decisions.md` in the engine): at most 3 open decisions, each with advice
  and what waiting costs; the Lead updates it after every merge or decision.
- The Lead may rebase a branch itself when there is no conflict and the checks pass again (operator rule).
- Every task that scores against marks keeps an error report (every error, with pictures), not only totals.
- Operator MO: "we do it right, and we do it once". Plan scope in full, split it into ordered tasks; never
  trim scope to close sooner.
- Close old chats only after they wrote their handoff (P0) with their hard-won facts.

## How to switch over later

Follow `workflow-v2.md` section 9 with the changes above: adapt the guide and the template, draw the lanes,
wrap up open chats (P0), start the Lead (P1), then change `CLAUDE.md` and `agent-manager-workflow.md` as a
Lead task with the operator's approval.
