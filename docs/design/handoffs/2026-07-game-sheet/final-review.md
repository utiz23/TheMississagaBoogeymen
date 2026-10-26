# Game Sheet — Final UI/UX Review

**File:** `Game Sheet.dc.html` · reviewed at 1280 (target) and 920 (squeezed) · no console errors.

The page reads as a real broadcast product now: the scoreboard → sub-nav → 3/4 + rail structure is legible, the accent red is disciplined, the timeline and action map earn their space. Below is what I'd still fix, in the order I'd fix it.

---

## P0

### 1. The drawer still isn't a head-to-head

Carried over unresolved from the last review. Opening WHOOSAH (4L · LW) shows _only_ WHOOSAH's five attribute tables. Same for a BGM skater. With the team toggle now showing one roster at a time, there is no longer **any** view on the page that compares two players — which was the stated purpose of the module ("Lineup · **Scouting**").

Pick one:

- **Implement it:** when a row opens, render the opposite-position skater from the other team in a second column. The Δ column and two-value bars already support it.
- **Or retire the framing:** drop "Scouting" and the comparison premise, and call it what it is — a roster inspector.

Right now the label promises something the interaction doesn't deliver.

### 2. Keyboard and assistive access

The page's primary interaction is unreachable without a mouse.

- Lineup rows are `<div onClick>` — no `tabindex`, no `role="button"`, no Enter/Space handler. Six rows × two teams × two modes of content, all mouse-only.
- Top nav `HOME / GAMES / ROSTER / STATS` are `<span>`s, not links — not focusable, not announced.
- `BGM|4L`, `LOADOUTS|STATS`, and the box-score `GOALS|SHOTS|FO` tabs have no `aria-pressed` or `role="tab"`; a screen reader hears three identical unlabelled buttons.
- One heading exists on the entire page and it's `<h1>▰Action Tracker Map</h1>`, emitted by the embedded widget. The game itself has no heading, and the ▰ ornament is inside the accessible name.

This is a ~30-line fix and it's the difference between prototype and shippable.

---

## P1

### 3. Two real contrast failures

Most of the micro-type now clears ~4.5:1 — the last pass worked. Two colours didn't come along:

- `--fg-5` (`#514E4F`) = **2.15:1**. Used on `LOSS`, `2ND MEETING VS 4TH LINE · SEASON SERIES 1-0-1`, `NO GOALS`, `EA AI · NO TRACKED DATA`.
- Action Tracker's `defends · attacks` axis label = **1.52:1** — effectively invisible in the rendered map, which is a shame because it's the one thing that tells you which way the ice is oriented.

### 4. Attribute names are truncated in the loadout drawer

`WRIST S…`, `ACCELE…`, `DURABIL…`, `DISCIPLI…`, `OFF. AW…`, `PUCK CO…`. Five columns is one too many for a 645px content well — the payoff screen of the whole module is a wall of stats whose labels you can't read. Go 3-up × 2 rows, or commit to short codes with a one-line legend.

### 5. The expand affordance is still too quiet

The chevron is a 12px `›` in a near-body colour, parked at the far right edge past the x-factor tiles. At a glance the rows read as static. Raise its contrast and/or move it inboard so it sits in the eye path.

### 6. Nothing handles narrower than 1280

At ~920 (a laptop at default zoom, or a browser with a sidebar open):

- The STATS summary strip drops `POSSESSION` onto its own full-width row — one orphan tile.
- Rows with long handles (`SERGEIZUBOV · shadowassault20`) wrap and break the row rhythm.
- Drawer labels truncate hard (see #4).

Either set an explicit `min-width` and let it scroll horizontally, or add one breakpoint that collapses the rail below the main column.

---

## P2 — polish

- **Duplicate score.** The row shows `GS 7.65`; the drawer's first tile shows `SCORE 7.65`. Same number, 40px apart. Drop the tile.
- **No-data glyph is inconsistent.** `FO %` renders `—` in the summary tiles and in the FACEOFFS table, but `0` appears elsewhere for genuinely-zero values. Good instinct — just make sure "no attempts" and "zero" never both render as `0` anywhere.
- **`POSSESSION 193` has no unit.** Seconds? Touches? Label it or format as `3:13`.
- **Disclosure glyph doesn't flip.** `WHERE THE EDGE CAME FROM ＋` stays `＋` when open. Every other disclosure on the page rotates its caret — this one should too.
- **Events pane overflows itself.** The Action Tracker event list has an inner horizontal scrollbar (484 → 564px). Content is wider than its own pane.
- **Header still crowded.** Crest + name + DRESSED + GOALIE + the "tap a skater" hint all stack in the top-left while the segmented control sits opposite. The hint is the weakest element there — it could ride once in the chevron column instead.
- **Four disclosures in a 215px rail.** `SHOW ALL 10 PLAYERS`, `WHERE THE EDGE CAME FROM`, the box-score tabs, and `SHOW FULL TIMELINE` in the main column all hide state. Individually fine; together the page has a lot of "there's more, somewhere". Consider defaulting one or two open.

---

## Suggested order

1. Drawer comparison, or drop the scouting framing (P0 1) — it's the module's reason to exist.
2. Focusability + roles + one real `<h1>` (P0 2) — small, mechanical, unblocks handoff.
3. `--fg-5` and the attacks/defends label (P1 3).
4. Drawer column count (P1 4) and chevron contrast (P1 5).
5. One breakpoint or a hard min-width (P1 6).
6. P2 sweep.
