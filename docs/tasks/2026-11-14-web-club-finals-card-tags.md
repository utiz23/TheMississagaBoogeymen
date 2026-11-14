# Task: CF3b — Club Finals game cards: tags in the top row, same height as other cards

- **State:** Verify (task agent done 2026-11-14 17:47; Running since 17:39; task agent of `Lead2`)
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

- 2026-11-14 17:46 task agent: branch and worktree made; finals tags (Finals, R3 · G4 / Final · G5, series
  score, outcome tag) moved into the top row; bottom bar and tag row removed; finals top edge h-1.5 -> h-1
  (it added 2 px). Preview on the live DB read-only (tunnel 5439, port 3600; no data patch needed, live has
  0083). Server and tunnel stopped, URL file deleted. Checks green.

Resume: Lead reviews the screenshots and the report, then merges (operator gate) and deploys `web`.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** On a Club Finals card the tags sit in the top row after the 6S / 3S tag:
  FINALS (solid red), "R3 · G4" ("Final · G5" in the final), the series score ("Series 4–0"), and the mark
  (ROUND WON green, FINAL WON strong green, ELIMINATED red) as a pill tag. Bottom bar and tag row are gone;
  the red left edge stays. Pill size and shape match the 6S / 3S tag. Choices on a card narrower than 34 rem
  (all 3-column and phone cards): the word "Series", the run score, the time, the Dominated/Outshot tag
  and the OCR tag are hidden (hover titles keep the full words); below 24 rem tags use less padding, below
  22 rem less letter spacing, below 19 rem the series tag hides. A normal card is unchanged.
- **How it was checked (commands, numbers):** `pnpm typecheck` pass; `pnpm test:unit` 755 pass 0 fail (new
  `clubFinalsCardLabel` test); prettier clean. Live /games read-only preview: all 20 cards are 277 px high at
  1280 (3 columns, card width 405) and at 390 (card width 358): finals and normal equal; top row has no
  overflow at 390, 375, 360, 320. Screenshots in
  `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-cf3b/`.
- **Not done:** No eliminated card sits beside a normal card in live data (they sit in finals-only rows);
  heights are equal for every card in the list. Opponent crests showed empty in dev (image route), not
  related. Not merged, pushed or deployed.
- **Git state:** branch `work/club-finals-card-tags`, last commit 25038554 (before this line edit), rebased on `main` at 153d10f8; checks pass.
