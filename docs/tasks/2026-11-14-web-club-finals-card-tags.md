# Task: CF3b — Club Finals game cards: tags in the top row, same height as other cards

- **State:** Running (since 2026-11-14 17:39; task agent of `Lead2`)
- **Lane:** Web
- **Risk:** low (layout of one card)
- **Slug:** club-finals-card-tags (branch `work/club-finals-card-tags`)
- **Operator approval:** 2026-11-14 17:39 (operator screenshot of the live /games page)
- **Operator gate before merge:** yes (screenshots)
- **Needs a deploy:** `web`
- **Helper model:** Sonnet

## Goal and visible result

Operator, looking at the live `/games` cards (CF3): "1. the extra stuff is messing with the height of the
panel. 2. we have to put all the tags in line with the 6s and 3s tag."

- On a Club Finals game card (`apps/web/src/components/matches/score-card.tsx` and its pieces), the
  finals tags (CLUB FINALS, "R3 · G4", "SERIES 4–0") move into the **top row**, next to the 6S / 3S tag,
  before the time.
- The bottom status bar (ROUND WON / ELIMINATED / FINAL WON) becomes a **tag in the same top row**
  (keep its colour: green for won, red for eliminated, the strong red for the final).
- A finals card is **exactly as tall** as a normal card in the same grid row (no extra row, no bottom
  bar). The red left edge stays.
- At 390 px the top row stays **one line** (shorter labels allowed, e.g. "R3·G4 4–0"; the time may
  hide on the smallest width if needed; say what you chose).
- Words and numbers stay CF1's stored values via `apps/web/src/lib/club-finals-view.ts` (no new numbers).

## Paths

- **May edit:** `apps/web/src/components/matches/` (score card and the finals badge pieces),
  `apps/web/src/lib/club-finals-view.ts` (+ its test), the CSS those use, this task file.

## Checks

web typecheck; web test:unit; prettier on changed files; screenshots of `/games` at 1280 and 390 with a
finals card next to a normal card in the same row (one round-won card, one eliminated card), from the
read-only preview (temporary in-memory CF1 patch never committed; live has 0083, so it may not be needed:
say which). Note: preview times are 1 h early on this PC (old tz data), not a bug.

## Done when (written before the work starts)

- **Done when:** checks pass; in the screenshots a finals card and a normal card in the same row have the
  same height and all tags sit in the top row. Reason: the operator's two points.
- **Not done if:** any finals number changes, or a normal (non-finals) card changes.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 17:39 Lead2: written and started from the operator's screenshot
  (`/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/operator-cf3-card.png`).

Resume: task agent makes the branch and worktree, then fixes the card.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
