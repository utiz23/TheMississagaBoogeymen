# Handoff Update

Use this skill at natural stopping points after meaningful work.

## Goal

Keep `HANDOFF.md` a short, accurate current-state index — never a
transcript, and never a running log. **100-150 lines is the target to aim
for; 200 lines and 12KB are hard ceilings that must not be exceeded.**
Detail that no longer describes the _current_ state belongs in a linked
document, not in this file — see "Where detail goes" below.

## Update Checklist

Update these sections **in place** — replace the outdated summary, don't
append a new dated entry on top of it:

- current objective / status
- latest verified checkpoint
- essential operational constraints (summarized directly; link out for detail)
- immediate blockers
- next 1-3 actions

Also, for anything that counts as a meaningful milestone this session:

- add a dated entry to `docs/journal/YYYY-MM.md` (the current month; create
  the file if it doesn't exist) — normally 5-10 bullets covering outcome,
  decisions, verification, commit references when available, and links to
  any technical report instead of repeating it
- link to that journal entry from `HANDOFF.md` rather than restating it there

## Where detail goes

Each detailed account has exactly one authoritative home:

- `docs/journal/YYYY-MM.md` — the dated work diary (see above).
- `docs/planning/` — active plans and roadmaps. Use the existing topical
  location for a given topic; don't reorganize the directory to fit one
  update.
- `docs/archive/` — historical handoff snapshots and retired/superseded
  plans or reports. Mark status and, if superseded, link the replacement.

## Rules

- Summarize outcomes, not every command.
- Prefer durable facts over temporary reasoning.
- Do not update `HANDOFF.md` mid-task unless explicitly asked.
- **Check the size every time you touch `HANDOFF.md`** (`wc -l HANDOFF.md`;
  `wc -c HANDOFF.md`) — this is part of the ordinary update, not a separate
  cleanup session. 100-150 lines is a target to aim for, not a trigger:
  crossing 150 doesn't by itself obligate relocating anything. If size is
  climbing toward or past the target, first try tightening the prose — a
  concise summary of an active blocker or constraint is fine, and often the
  right fix, as long as the current constraints, decisions, and links
  survive intact. Relocate detail (superseded/resolved material to a dated
  `docs/archive/` file, roadmap-shaped material to `docs/planning/`,
  narrative/verification detail to the current journal) when condensing
  alone won't keep the file inside the 200-line / 12KB hard ceiling, or when
  the material genuinely no longer describes current state.
- Never drop a still-active blocker, decision, or gate status to make room,
  and never drop one just because it's old — summarizing it is fine, losing
  it is not. Age alone does not make unresolved work obsolete.
- Before archiving anything, copy it byte-for-byte first; don't summarize
  and delete in the same step.
- Repair references: if you move or retire a document, fix the links that
  pointed at it (in `HANDOFF.md`, the roadmap, and anywhere else you know
  references it).
