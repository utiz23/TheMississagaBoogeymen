> Seed copy, NOT in force here. Copied unchanged from `eanhl-live-engine` `docs/cards/TEMPLATE.md` at commit b9e2914 (2026-11-04). Engine paths and names below are the engine's; see README.md for what to adapt.

# Card: <short title>

Copy to `docs/cards/YYYY-MM-DD-<lane>-<slug>.md`. Keep it short. STE style.

- **State:** Proposed | Ready | Running | Verify | Merged | Parked | Dropped
- **Lane / run tag:** Geometry/M1 | Detection/M2 | Tracking/M3 | Text/MT | Client/– | Platform/2A
- **Slug:** <slug>  (branch `work/<slug>`, worktree `~/work/<slug>`, runs in `out/<slug>/`)
- **Operator approval:** <date, or "pending">
- **Operator gate before merge:** yes | no  (yes = the operator looks at the result first)

## Goal and visible result

One or two sentences. What can the operator see or measure when this is done?

## Paths

- **May edit:** <exact paths, each in backticks: a file, a folder `dir/` or a glob `tools/check_m1*`;
  "this card" is always allowed. `tools/check_card_paths.py` reads this line.>
- **Shared paths needed (Lead OK required):** <none | paths + Lead OK date>
- **Must not touch:** everything else

## Footage and checks

- **Footage:** club games only: <list of games>. Held-out games: <list>.
- **Checker command:** <exact command>
- **Preflight extras:** <e.g. clips tests, app tests>

## Go rule (written before the first run)

- **Claim to test:** <number or behaviour>
- **Go if:** <measurable rule, with the reason from the game>
- **No-go if:** <measurable rule>
- **Tolerance for the Verifier:** <e.g. 0.5 points>

## Stop conditions

Stop and write "Blocked" in the Log when: <a path outside "May edit" is needed>;
<the footage is not a club game or is goalie camera>; <the go rule is unclear>;
<an operator decision is needed>; <anything irreversible comes next>.

## Hard-won facts (only for handoff cards)

Things a new session would get wrong. Short list. Each with where it is proven.

## Log

Newest last. One line each: date, what was done, result.

## Error report (every card that scores against marks; operator, 2026-11-04)

Every error, not only the totals. One table row per error: frame (recording, game, video time),
kind, what the marks say, what the engine says, where on screen and on the rink, size, and a short
cause. One picture sheet per kind (marked answer and engine answer drawn on the frame), saved under
`out/<slug>/errors/` and opened for the operator. Then a summary: counts per kind and cause, and
which causes repeat across games. Say which causes are new and which are known.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, footage line, numbers):**
- **Tried, no gain:**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, preflight pass/fail

## Verifier result (Verifier fills)

- **Ran:** <command, footage>
- **Got:** <numbers>
- **Compared with claim:** <within tolerance? yes/no>
- **Verdict:** pass | fail | pass with notes
