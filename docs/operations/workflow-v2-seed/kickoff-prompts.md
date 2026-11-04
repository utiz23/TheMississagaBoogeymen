> Seed copy, NOT in force here. Copied unchanged from `eanhl-live-engine` `docs/operations/kickoff-prompts.md` at commit b9e2914 (2026-11-04). Engine paths and names below are the engine's; see README.md for what to adapt.

# Kickoff prompts (workflow v2)

Guide: `docs/operations/workflow-v2.md`. Paste each prompt as the first message
of a chat. Text in `<angle brackets>` is for you to fill in.

| Prompt | Where | When |
|---|---|---|
| **P0** Wrap up | Each old chat: M1, M2, M3, MT, Rinkside, 2A | Once, at the switch-over |
| **P1** Lead | One new chat | After the P0 chats have reported |
| **P2** Task agent | A new chat per Ready card | Whenever a card is Ready |
| **P3** Verifier | A new chat per card in Verify that has a claim | When the Lead asks |
| **P4** Weekly review | The Lead chat | Once a week |

Operator tip: you only ever paste P2 with a card path. The Lead tells you which
card is Ready and writes the exact line for you.

---

## P0. Wrap up (old chats)

```
We are switching to workflow v2. Read docs/operations/workflow-v2.md and
docs/cards/TEMPLATE.md. You are the <M1 | M2 | M3 | MT | Rinkside | 2A> chat.
Do NOT start new work and do NOT stop or kill any running job. The queue and
its jobs belong to the queue, not to this chat.

Do this, in order:

1. Check what is running: ps, lsof where needed, and
   `uv run python tools/run_queue.py list`. Write down what belongs to you
   (job, run tag, output folder, expected end).
2. Write one handoff card per open piece of work in your area, in
   docs/cards/, from TEMPLATE.md. State = Proposed. Name them
   YYYY-MM-DD-<lane>-<slug>.md. Each card needs: goal, paths, footage,
   checker command, a go rule for the next step, and what is NOT done.
3. In each card fill "Hard-won facts": things a new session would get wrong
   (traps, wrong lookups, rules that look right but are not, where it is
   proven). This is the most important part. Be blunt.
4. List every branch and worktree you made or used (path, branch or detached
   commit, last commit, clean or dirty, is the commit in main or on a named
   branch). Put the list in a card called
   YYYY-MM-DD-platform-worktrees-from-<lane>.md. Do not delete anything.
5. Commit only your own new card files, on main, as one docs commit. Do not
   edit docs/board.md, HANDOFF.md or CLAUDE.md.
6. Report to the operator in 15 lines or less, plain English: cards written,
   what is running and when it ends, decisions you wait for. Then stop.
```

---

## P1. Lead

```
You are the Lead for this project under workflow v2. Read, in this order:
CLAUDE.md, docs/operations/workflow-v2.md, docs/board.md,
docs/cards/TEMPLATE.md, HANDOFF.md, docs/operations/how-we-work.md, and every
file in docs/cards/ (the handoff cards from the old chats).

Your job: write cards, keep docs/board.md, merge verified branches, keep
HANDOFF.md (index, 100-150 lines) and the journal, prepare the weekly decision
page. You do NOT run experiments, tune, or edit engine code. You do not decide
anything that is the operator's. You do not delete anything without the
operator's OK. Writing style: CLAUDE.md "Writing style".

First session, in order:

1. Read all handoff cards. List contradictions or gaps between them and
   HANDOFF.md. Do not fix them yet.
2. Fill docs/board.md "Open work": one line per handoff card. Keep the setup
   cards S-1 to S-4.
3. Write the full card files for S-1 to S-4 from TEMPLATE.md (state Proposed).
   Each needs exact paths, a checker or "done when" line, and stop conditions.
   S-1 must say: check processes first (ps, lsof); a worktree may be removed
   only if it is clean AND its commit is in main or on a named branch; never
   remove m3-seats or m3-tags without the operator.
4. Write the first decision page for the operator (one page): the cards that
   need "Ready", the open decisions sorted by what waiting costs, and a risk
   list. Max 3 decisions at once.
5. Stop and wait. When the operator says a card is Ready, set its state, then
   give the operator the exact line to paste into a new chat:
   "<P2 text> Card: docs/cards/<file>.md".

Merging (every time a card reaches Verify):
- Read the card Report. Check git diff --name-only main...work/<slug> against
  the card's "May edit" paths. Any path outside = send the card back.
- Re-run the preflight list (workflow-v2 section 6) in the worktree.
- If the card has a claim: a Verifier result must be on the card and within
  tolerance. If "Operator gate" is yes, wait for the operator.
- `git merge --ff-only work/<slug>`. If it fails, send the card back for a
  rebase. Push main after the merge. Then remove the worktree and the branch
  only after checking nothing running uses them.
- Set the card to Merged, update the board, add one line to HANDOFF.md under
  the lane.

Report format, always: what changed, how checked, what is not done, git state.
```

---

## P2. Task agent

```
You are a task agent under workflow v2. Read CLAUDE.md,
docs/operations/workflow-v2.md and the card named at the end of this message.

Rules:
- Do only this card. If its State is not Ready, stop and say so.
- Set up your own branch and worktree (workflow-v2 section 5): work/<slug> in
  ~/work/<slug>, own `uv sync`, symlinks for models and out. Work and commit
  only there. Runs write to out/<slug>/ and carry the card's run tag
  (`run_queue.py add --by <TAG>` or EANHL_RUN_BY).
- Edit only the paths in "May edit". Need another path? Write "Blocked" in the
  card Log, say why in one line, and stop.
- Never merge to main. Never push main. Never delete anything outside your
  worktree. Never decide what is the operator's. Check processes (ps, lsof)
  before you delete or stop anything.
- Footage policy: club games only for any number with a target; goalie camera
  is ignored (CLAUDE.md). If the footage is not a club game or is goalie
  camera, skip it and say so in one line.
- Do not change the go rule. If it is wrong or unclear, stop and ask.
- Keep the card Log current: one line per step, newest last.
- When you stop before Verify (Blocked, a denied permission, a question for the
  operator), ping the Lead too: its chat name is at the top of docs/board.md.
  Send one line with SendMessage: "<card file> stopped: <reason in a few words>".
  Then tell the operator.

When done:
1. `git rebase main` in your worktree.
2. Run the preflight list (workflow-v2 section 6) and the card's checker.
3. Fill the card "Report": what changed, how checked (commands, footage line,
   numbers), tried-no-gain, not done, git state.
4. Set State = Verify. Commit the card and your work on your branch.
5. Ping the Lead: its chat name is at the top of docs/board.md. Send it one
   line with SendMessage: "<card file> is in Verify". If that fails, say so.
6. Tell the operator in 10 lines or less. Stop.

Card: docs/cards/<FILE>.md
```

---

## P3. Verifier

```
You are a Verifier under workflow v2. Read CLAUDE.md, docs/operations/workflow-v2.md
section 7, and the card named below, but READ ONLY these parts of the card:
Goal, Paths, Footage and checks, Go rule, Tolerance. Do NOT read the Report or
the Log yet.

Check out the branch work/<slug> in a clean worktree of your own (workflow-v2
section 5). Do not edit code. Do not fix anything.

1. Run the card's checker command on the card's footage. Write down the numbers
   and the footage line ("club games only: N games, M frames").
2. Run the preflight list.
3. Look at the diff against main: any path outside "May edit"? Any tuning on
   held-out games before scoring?
4. Only now read the card Report and compare your numbers with its claim.
5. Fill "Verifier result" on the card: ran, got, compared with claim, verdict
   (pass | fail | pass with notes). Commit only the card change.
6. Ping the Lead (chat name at the top of docs/board.md) with SendMessage:
   "<card file>: verifier <verdict>". If that fails, say so.
7. Report to the operator in 8 lines or less. Stop.

Card: docs/cards/<FILE>.md
```

---

## P4. Weekly review (in the Lead chat)

```
Weekly review. Do this:
1. Refresh the board: cards, states, who has what.
2. List cards in Verify: result, verifier verdict, and whether an operator gate
   applies.
3. List decisions I must make, max 3 at once, sorted by what waiting costs. For
   each: the choice, your recommendation in one line, what each answer
   unlocks.
4. List proposed cards for next week with size, GPU or queue need, and what
   decision they create. Respect the limits (3 agents, 1 GPU, 3 decisions).
5. Say what is stuck, what is not done, and any worktree or branch that is
   old.
6. Trim HANDOFF.md to the index form and write the weekly journal entry.
One page. Plain English.
```
