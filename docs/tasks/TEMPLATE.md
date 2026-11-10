# Task: <short title>

Copy to `docs/tasks/YYYY-MM-DD-<lane>-<slug>.md`. Keep it short. STE style. Guide:
`docs/operations/workflow-v2.md`.

- **State:** Proposed | Ready | Running | Verify | Merged | Deployed | Parked | Dropped
- **Lane:** Web | Discord | Worker | Database | Queries | Ops | Docs
- **Risk:** low | medium | high (guide section 7)
- **Slug:** <slug> (branch `work/<slug>`, worktree `.claude/worktrees/<slug>`)
- **Operator approval:** <date, or "pending">
- **Operator gate before merge:** yes | no
- **Needs a deploy:** no | yes: <services, in order> (always the operator's OK)

## Goal and visible result

One or two sentences. What can the operator see when this is done?

## Paths

- **May edit:** <exact paths in backticks; "this task file" is always allowed>
- **Shared paths needed (Lead OK required):** <none | paths + Lead OK date>
- **Must not touch:** everything else

## Checks

- **Checks (guide section 6):** <packages to typecheck and test>
- **Evidence:** <screenshot | dry-run output | side-by-side on games N..M>

## Done when (written before the work starts)

- **Done when:** <measurable rule, with the reason>
- **Not done if:** <rule>
- **Tolerance for the Verifier:** <only when a number is claimed>

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

Newest last. One line each: date, what was done, result.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail

## Verifier result (Verifier fills)

- **Ran:**
- **Got:**
- **Compared with claim:**
- **Verdict:** pass | fail | pass with notes
