# Archive Index

Each file here is an immutable, byte-identical snapshot of `HANDOFF.md` (or
an earlier archive) captured at a point in time, kept only for historical
record. None of them is edited after capture — see
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

- [`handoff-history-2026-09-12.md`](handoff-history-2026-09-12.md) —
  `HANDOFF.md` as it stood immediately before the 2026-09-12 compaction.
  Current state lives in the live `HANDOFF.md` and
  `docs/planning/operational-v1-roadmap.md`, not here.
- [`handoff-history-2026-08-03.md`](handoff-history-2026-08-03.md) — an
  earlier snapshot, referenced from within the 2026-09-12 snapshot above.
- [`handoff-history-2026-06-14.md`](handoff-history-2026-06-14.md) — an
  earlier snapshot still, referenced from within the 2026-08-03 snapshot.
