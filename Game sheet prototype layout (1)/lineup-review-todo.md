# Lineup Component — Action List

**File:** `Game Sheet.dc.html` · component = the "LINEUP + LOADOUTS" `<section>` (template ~line 94; logic in `buildLineup` / `buildTeamRows` / `buildAttrs` / `deepStats`).
**Context:** This is the _primary_ stats surface for the page (other modules reference stats but this owns them). Fabricated stats are fine — it's a prototype.

---

## P0

### 1 + 3 — Team switch for browsing, comparison in the drawer (do these together)

The original purpose was position-matched BGM-vs-opp comparison. Now we also need to show all 6 players + loadouts/stats for _both_ teams. Resolution: don't show both full rosters at once.

- **Replace the vertical "spine" switcher** with a horizontal `BGM | 4L` segmented control, placed next to the `LOADOUTS | STATS` toggle in the header. Reclaims ~54px of the 3/4 column and is instantly discoverable (no pulsing hint needed).
  - Remove: `spineStyle`, `spineTX`, `spineImg/spineNoImg`, `spinePulse`, the whole-panel `translateX` slide, `padding-right/left:60px` on panels.
- **Team toggle = which roster's 6 rows you browse** (one team's full list at a time).
- **Expand drawer = the head-to-head.** When a row opens, also render the **opposite-position opponent** alongside (C vs C, LD vs LD, etc.) so the drill-down delivers the scouting comparison. Attribute tables show both sides; the boost/nerf bars already support two-value rows.
- Decide: does opening a BGM row auto-pair the 4L player at the same position? (recommended) — keeps `open` as a single position key rather than per-team num.

### 2 — Fabricated stats → ACCEPTED, no change (prototype).

---

## P1

### 4 — De-rainbow the position colors

`POSC` uses 6 saturated hues; C (`#c0061c`) collides with the brand accent red. Collapse to one neutral (or a single muted tint) so red stays reserved for accent/leader/BGM semantics only.

### 6 — Make the expand affordance visible

Rows are clickable but no caret shows in the rich row (the computed `chev` isn't rendered). Add a persistent chevron (▸ collapsed / ▾ open) on each row so the drill-down is discoverable.

### 7 — Increase row density

Loadout rows are `min-height:82px` with a 38px jersey number + 54px avatar → 6 rows run 500px+. Shrink the jersey number (it's low-priority but currently the biggest element), tighten row height toward the source's `px-5 py-3`, so all 6 fit without scrolling.

---

## P2 (polish)

- **Micro-type contrast:** many 8–9px `fg-5`/`fg-6` labels on near-black read poorly; CPU row at `opacity:.6` compounds it. Bump size/contrast on the smallest labels.
- **`·` delta glyph** for "no change" is cryptic — use a blank or subtle "0".
- **Header crowding:** top-left (name + crest + DRESSED + GOALIE + arch-summary chips) competes with the mode toggle; the arch summary repeats per-row archetypes. Trim.
- **Wrap fragility:** loadout identity line (persona + handle + star + arch chip + physLine) stacks awkwardly at narrow widths — test/mitigate.
- **Unify the two row templates:** STATS and LOADOUT `sc-if` blocks duplicate ~40 lines of POS/number/avatar/identity markup and have drifted. Merge into one row shell before shipping (handoff hygiene).

---

## Suggested order

1. Spine → segmented team control (P0 1/3) — unblocks layout width.
2. Opponent comparison in the expand drawer (P0 1/3) — the core purpose.
3. Position-color de-rainbow (P1 4) — quick.
4. Persistent expand caret (P1 6) — quick.
5. Row density (P1 7).
6. P2 polish pass.
