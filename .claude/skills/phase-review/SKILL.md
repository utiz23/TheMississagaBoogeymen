# Phase Review

Use this skill for milestone reviews of completed work — not as a mandatory
checkpoint after every phase or commit. See
`docs/operations/agent-manager-workflow.md` for how process is sized to risk.

## Goal

Produce a reviewer-style assessment with findings first and summary second.

## Workflow

1. First inspect whatever verification evidence already exists for the
   work being reviewed (prior command output, test results, a completion
   report). Rerun only what's missing, what no longer applies because the
   code changed since that evidence was produced, or what a specific concern
   justifies rechecking. Don't re-run a clean gate just to re-run it.
2. Inspect the code paths touched by the phase.
3. Identify:
   - correctness bugs
   - regression risks
   - missing validation
   - architecture mismatches
4. Report findings first, ordered by severity, with file references.
5. After findings, include:
   - residual risks
   - test gaps
   - short status summary

## Rules

- Be concise and concrete.
- Prefer runtime and data-integrity issues over style feedback.
- If there are no findings, say so explicitly and list remaining risks/test gaps.
