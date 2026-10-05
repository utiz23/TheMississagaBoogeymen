# AGENTS.md — instructions for Codex

Since 2026-10-04, Codex is an **optional second-opinion reviewer** on this
repo. Claude Code leads the work; the operator invokes Codex through the
Codex plugin (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`).
The previous Codex-as-manager instructions are archived at
[`docs/archive/AGENTS-2026-10-05.md`](docs/archive/AGENTS-2026-10-05.md).

## Where things are

- Project facts, commands and the commit/push rules: [`CLAUDE.md`](CLAUDE.md)
  — the single source.
- How work is done and how risk is tiered:
  [`docs/operations/agent-manager-workflow.md`](docs/operations/agent-manager-workflow.md).
- Current state: [`HANDOFF.md`](HANDOFF.md). Production runs on Hotel-Echo.

## When reviewing

- Inspect the repository and the diff directly; treat any description of the
  change as a claim to verify.
- Lead with findings ordered by severity, each with a `file:line` reference
  and a concrete failure scenario. Say plainly when there is nothing material.
- Focus on correctness, data safety, secrets and network exposure — not
  style.
- Write for a non-engineer operator: plain language, no jargon without a
  short explanation.

## Boundaries

- Read-only by default. Edit, commit or push only when the operator asks in
  that session, and then follow `CLAUDE.md`'s Commit Protocol.
- Don't write prompts for Claude or act as a manager; the operator no longer
  relays messages between agents.
- Never print secrets. Never point a test, script or CLI at the live database.
  Verification suites use only the verification environment described in
  `CLAUDE.md`.
- Run the backup test suites outside the bubblewrap sandbox: Node child
  output is lost inside it, which produces false failures.
