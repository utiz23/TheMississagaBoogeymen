# Archive Index

Each file here is an immutable, byte-identical snapshot of `HANDOFF.md` (or
an earlier archive), or a retired plan, captured at a point in time and kept
only for historical record. None of them is edited after capture — see
`.claude/skills/handoff-update/SKILL.md`'s "copy byte-for-byte before
anything is reworded" rule.

## Known limitation: internal links do not resolve from here

Every snapshot was written when it was the live root-level `HANDOFF.md` (or
a prior archive), so its relative Markdown links (e.g.
`docs/planning/some-doc.md`) are relative to the **repository root**, not to
`docs/archive/`. Opened directly from this directory, those links resolve
one level too deep and 404 (`docs/archive/docs/planning/some-doc.md`).
Rewriting them would break the "byte-identical" guarantee these files exist
for, so they are left as originally written.

**To follow a link inside an archived snapshot:** take the path exactly as
written and open it from the repository root — do not resolve it relative
to the archive file's own location. Most such links point at
`docs/planning/`, `docs/operations/`, or an earlier `docs/archive/` file;
some of those targets have since moved or been retired themselves, in which
case treat the broken link as a historical record rather than a defect to
fix.

This is a snapshot-only limitation. Live documents (`HANDOFF.md`,
`docs/planning/*`, `docs/operations/*`) are checked for working links as
part of ordinary verification; archived snapshots are not, and are not
expected to be.

## Snapshots

- [`handoff-history-2026-10-09.md`](handoff-history-2026-10-09.md) —
  `HANDOFF.md` before the 2026-10-09 condense: holds the full 2026-10-05
  launch / security-polish checkpoint and public-check list.
- [`handoff-history-2026-10-05.md`](handoff-history-2026-10-05.md) —
  `HANDOFF.md` as it stood before the 2026-10-05 workflow reset. Holds the
  full Proton/E3 backup state (parked) and the E3J9C–E3J9E checkpoints.
- [`handoff-history-2026-09-12.md`](handoff-history-2026-09-12.md) —
  `HANDOFF.md` as it stood immediately before the 2026-09-12 compaction.
  Current state lives in the live `HANDOFF.md` and
  `docs/planning/operational-v1-roadmap.md`, not here.
- [`handoff-history-2026-08-03.md`](handoff-history-2026-08-03.md) — an
  earlier snapshot, referenced from within the 2026-09-12 snapshot above.
- [`handoff-history-2026-06-14.md`](handoff-history-2026-06-14.md) — an
  earlier snapshot still, referenced from within the 2026-08-03 snapshot.

## Retired plans

- [`operational-v1-roadmap-2026-10-05.md`](operational-v1-roadmap-2026-10-05.md)
  — **superseded 2026-10-05** by the 7-item launch plan in
  [`docs/planning/operational-v1-roadmap.md`](../planning/operational-v1-roadmap.md).
  Holds the Gate 1–3 Operational V1 checklist and the 33-item Limited Public
  Launch gate, unchanged.
- [`lpl-l0-reconciliation-2026-10-03.md`](lpl-l0-reconciliation-2026-10-03.md)
  — **superseded 2026-10-05** by the same launch plan. Moved here unchanged
  from `docs/planning/`.
- [`agent-manager-workflow-2026-10-05.md`](agent-manager-workflow-2026-10-05.md)
  — **superseded 2026-10-05** by the one-page
  [`docs/operations/agent-manager-workflow.md`](../operations/agent-manager-workflow.md)
  (Codex-as-manager workflow, unchanged).
- [`AGENTS-2026-10-05.md`](AGENTS-2026-10-05.md) — **superseded 2026-10-05** by
  the short reviewer-role [`AGENTS.md`](../../AGENTS.md) (unchanged copy).
- [`session-playbook-2026-10-05.md`](session-playbook-2026-10-05.md) —
  **retired 2026-10-05**: copy-paste prompt templates for the old
  operator-relayed workflow. Moved here unchanged from `docs/`.
