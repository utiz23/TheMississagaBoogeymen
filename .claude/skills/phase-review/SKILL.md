# Phase Review

Use this skill for milestone reviews of the current phase.

## Goal

Produce a reviewer-style assessment with findings first and summary second.

## Workflow

1. Run the relevant verification commands for the current phase.
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
