# Pre-Game Lobby & Loadout Extraction — Research Dossier

Status: **PARTIALLY IMPLEMENTED, MOSTLY BROKEN.** Last updated 2026-05-12.

Sister docs:
[marker-extraction-research.md](./marker-extraction-research.md),
[event-list-extraction-research.md](./event-list-extraction-research.md).
Reference: [research/OCR-SS/Manual OCR benchmark for verification V2.md](../../research/OCR-SS/Manual%20OCR%20benchmark%20for%20verification%20V2.md)
(authoritative ground truth for match 250).

---

## Problem statement

Two distinct pre-game screens carry the per-player metadata we want to
capture for every match:

1. **Pre-Game Lobby** — a single-screen 6v6 roster view showing both teams
   side-by-side. Player cards in this view **alternate every few seconds**
   between two visual states:
   - **State 1** ("class state"): shows Build Class Name (e.g. "Playmaker",
     "Tage Thompson - PowerForward", "Sniper")
   - **State 2** ("identity state"): shows in-game Player Number (e.g. `#11`)
     + in-game Player Name (e.g. `E. Wanhg`)
   The two teams **are not synced** in their alternation, so a single
   capture can have one team in state 1 and the other in state 2.

2. **Pre-Game Loadout View** — a per-player deep-dive screen showing
   complete build details: 3 X-Factors with tier labels, 23 attribute
   ratings across 5 groups (Technique / Power / Playstyle / Tenacity /
   Tactics), plus full player info (gamertag, height, weight, handedness,
   level, etc.). The operator scrolls through each player to capture them
   in turn.

Per match: **up to 10 unique skater loadouts** to extract (5 BGM + 5 opp
skaters; goalies are CPU in match 250 and don't have loadout views).
If both teams field human goalies in a future match, that becomes 12.

### Target data per player (from V2 benchmark)

**Pre-Game Lobby state 1 (per player):**

| Field | Example |
|---|---|
| Position | Center / Left Wing / Right Wing / Left Defense / Right Defense / Goalie |
| Level | `P1 \| Level 17` |
| Gamertag | `MrHomicide` |
| Platform | `Xbox` |
| Height | `6'0"` |
| Weight | `160lbs` |
| Build Class Name | `Playmaker`, `Sniper`, `Tage Thompson - PowerForward`, etc. |
| Leader? | `Yes` / `No` |
| X-Factor 1 / 2 / 3 (each with tier) | `Wheels - All Star`, `One T - Elite`, `Tape to Tape - Specialist` |

**Pre-Game Lobby state 2 — same as state 1 BUT** replaces Build Class
with two new fields:

| Field | Example |
|---|---|
| Player Number | `#11` |
| Player Name (in-game persona) | `E. Wanhg`, `-. Silky`, `H. Jenkins` |

**Pre-Game Loadout View (per player) — strictly richer:**

| Section | Fields |
|---|---|
| Player Info | Position, Player_Level, Platform, Name (full in-game name e.g. `Evgeni Wanhg`), Number, GamerTag, Build_Class_Name, Height, Weight, Shot Handness (`Right`/`Left`) |
| X-Factors | 3 X-Factors, each with name + tier (`Elite` / `All Star` / `Specialist`) |
| Attributes — Technique | Wrist Shot Accuracy, Slap Shot Accuracy, Speed, Balance, Agility (5 values, 0-99) |
| Attributes — Power | Wrist Shot Power, Slap Shot Power, Acceleration, Puck Control, Endurance (5) |
| Attributes — Playstyle | Passing, Offensive Awareness, Body Checking, Stick Checking, Defensive Awareness (5) |
| Attributes — Tenacity | Hand-Eye, Strength, Durability, Shot Blocking (4) |
| Attributes — Tactics | Deking, Faceoffs, Discipline, Fighting Skill (4) |
| Δ column (optional) | per-attribute buff/diff indicator (visual triangle marker) — semantics: change vs base rating |

Total per player from Loadout View: **10 player-info fields + 3 X-Factors
+ 23 attribute ratings = 36 fields**. For 10 skaters: 360 fields plus team
metadata (game mode, team names).

---

## Current state

### Inventory

| Asset | Path | State |
|---|---|---|
| Lobby state 1 ROI config | [pre_game_lobby_state_1.yaml](../../tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_1.yaml) | Defined: 5 regions (game_mode, two team names, two team panels). Each panel is a single large ROI containing all 6 player rows. |
| Lobby state 2 ROI config | [pre_game_lobby_state_2.yaml](../../tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_2.yaml) | **Identical to state 1.** No per-state ROI variation; same coords. |
| Loadout view ROI config | [player_loadout_view.yaml](../../tools/game_ocr/game_ocr/configs/roi/player_loadout_view.yaml) | Defined: 17 regions covering selected_player, position, name, level, platform, gamertag, home_team, build_class, measurements, handedness, x_factors, and one ROI per attribute group (technique/power/playstyle/tenacity/tactics). |
| Lobby parser | [`parsers.py:parse_lobby_team`](../../tools/game_ocr/game_ocr/parsers.py) | Splits a panel by position-token markers, builds `PlayerSlot` per row. Single-pass token-token classification, no positional grid. |
| Loadout parser | [`parsers.py:parse_loadout_result`](../../tools/game_ocr/game_ocr/parsers.py) | Reads each ROI as a single field. **Each attribute group ROI returns ONE attribute value, not 5/4.** |
| Loadout promoter | [loadout.ts](../../apps/worker/src/ocr-promoters/loadout.ts) | Idempotent. Writes snapshots + x_factors + attributes. Fan-in is 1 snapshot per extraction (correct — loadout is a single-player screen). |
| Lobby promoter | [pre-game-lobby.ts](../../apps/worker/src/ocr-promoters/pre-game-lobby.ts) | Walks our_team + opponent_team rosters and writes one thin snapshot per detected player slot. CPU/empty slots skipped. |
| DB schema | [player-loadout.ts](../../packages/db/src/schema/player-loadout.ts) | `player_loadout_snapshots` + `player_loadout_x_factors` + `player_loadout_attributes`. Schema is correct, supports the full V2 target. |
| Captures available | [research/OCR-SS/Pre-Game-Lobby/](../../research/OCR-SS/Pre-Game-Lobby/) (3), [research/OCR-SS/Pre-Game-Loadouts/](../../research/OCR-SS/Pre-Game-Loadouts/) (11) | Total 14 captures for match 250. |

### Live DB state (match 250, as of 2026-05-12)

- **player_loadout_snapshots: 28 rows.** All `review_status='reviewed'`.
  Sources: 13 from `player_loadout_view`, 15 from `pre_game_lobby_state_2`.
  20 distinct gamertag_snapshot strings, but **most are garbage**
  (concatenations of multiple players' OCR'd text).
- **player_loadout_x_factors: 39 rows.** ~1.4 per snapshot. V2 target: 3
  per snapshot → expected ~84 rows for 28 snapshots. Coverage ~46%.
- **player_loadout_attributes: 65 rows.** ~2.3 per snapshot. V2 target: 23
  per snapshot → expected ~644 rows for 28 snapshots. **Coverage ~10%.**
  And every snapshot has the same 5 attribute keys: `hand_eye`,
  `wrist_shot_accuracy`, `deking`, `passing`, `wrist_shot_power` —
  ONE per group, never the other 4 in each group.

### What works

- Capture/extraction pipeline reaches the promoters with usable region OCR text
- DB schema is shape-correct for the V2 target
- Loadout promoter idempotency
- Gamertag → `players` resolver runs for both screens
- `player_loadout_view` → 1 snapshot mapping is correct
- Pre-game lobby parser correctly identifies position-token markers
  (`LW`, `RW`, `C`, `LD`, `RD`, `G`) and groups rows

### What's broken or missing

1. **Loadout parser only reads 1 attribute per group.** [`parsers.py:132-163`](../../tools/game_ocr/game_ocr/parsers.py#L132-L163)
   passes each attribute-group ROI through `field_from_lines` as a single
   field. The ROI contains a vertical stack of 4-5 (label, value) pairs;
   we need to grid-parse it into N rows, not collapse it. Result: only 5
   of 23 attributes per player ever reach the DB.
2. **Lobby panel parser misclassifies fields.** Live DB shows:
   - Gamertag column has multi-player concatenated text:
     `"5'8\" 1 175Ibs HenryTheBobJr Iil. 6'0* | 160 bs P2lYL35 JoeyFlopfish CHEL"`
   - All BGM rows tagged `position='LW'` even though MrHomicide is C and
     HenryTheBobJr is LD. Token-based grouping fails when multiple
     position tokens appear in the same vertical region.
   - `build_class` truncated to ~7 chars: `'PUCK M'`, `'EFENSI DE'`,
     `'TAGE TH'` — ROI width too narrow OR the lobby panel has the build
     text wrapping/clipping.
3. **No tier extraction for X-Factors.** V2 says each X-Factor has a tier
   (Elite / All Star / Specialist) that's visually encoded as a colored
   icon + the tier word. Parser captures the X-Factor name only; tier
   never reaches the DB. Schema does NOT have a `tier` column on
   `player_loadout_x_factors` — needs migration.
4. **No Leader/captain flag.** V2 distinguishes the captain per team
   (`Leader?: Yes/No`). Not modeled or extracted.
5. **No state-1-vs-state-2 fusion.** The lobby alternates between class-
   state and identity-state. We need BOTH states per player to capture
   build_class AND (player_number, player_name). Current pipeline reads
   each state in isolation and writes them as separate snapshots with no
   cross-state merging.
6. **No identity-state-2 player-number/name persistence.** Schema's
   `playerNameSnapshot` is correct but the lobby parser path doesn't
   populate it on state-2 extractions — the `parse_lobby_team` code only
   populates `player_name` when `include_player_name=True`, and even then
   it parses from `#N -. Name` patterns which may not be robust.
7. **Attribute group ROIs may misalign per-player.** The loadout-view ROIs
   are defined as proportions of 1920×1080. If different player builds
   shift the attribute area slightly, the ROI captures the wrong row
   (e.g. group label "TECHNIQUE" becomes the value for Wrist Shot
   Accuracy). Likely contributor to the ~10% attribute coverage.
8. **CPU/Goalie handling is incomplete.** V2 shows goalies as a single
   `CPU` row with all `-`. The lobby parser detects "CPU" but the goalie
   row itself isn't written — that's correct for match 250 (CPU goalies)
   but if a human goalie plays, we have no schema support for a goalie-
   specific loadout layout (which may have different stats than skaters).
9. **All review statuses auto-approved.** All 28 rows are marked
   `reviewed` despite the garbage content. The review pass either ran
   `--auto-approve` without a confidence threshold, or the operator
   approved them sight-unseen. Now we have garbage marked as canonical
   truth.
10. **No deduplication across captures.** When 11 loadout captures of the
    same 10 players come in, we get 11+ snapshots, not 10 canonical-per-
    player rows. Cross-frame consensus (the same pattern proposed for
    event-list extraction) does not exist here.

### Sample of current DB rot (loadout snapshots for match 250)

```
id  gamertag_snapshot                                            position  build_class
28  HenryTheBobJr                                                RD        PUCK M
27  silkyjoker85                                                 LD        EFENSI DE
26  Stick Menace                                                 RW        SNIPER
25  7 MrHomiecide Evoeni Wan                                     LW        SNIPER
24  7 MrHomiecide Evoeni Wan                                     LW        TWO-WA
23  MrHomiecide Evoer ni Wan                                     LW        PUCK M
…
4   Cole Caufield - SNP 5'8" | 175lbs B HenryTheBobJr Puck M…    RW        Puck Moving Defenseman. Puck Moving Defenseman
```

Row 4 is the worst case: it contains data from at least 3 players
(`Cole Caufield - SNP` is silkyjoker85's loadout build name; the height
`5'8"` and weight `175 lbs` match silkyjoker; then `HenryTheBobJr` is a
different player; `Puck Moving Defenseman` is HenryTheBobJr's build; and
the whole thing is tagged with gamertag set to a 100+-char garbage
string). The lobby panel ROIs are clearly catching the entire panel as
one blob and the parser isn't splitting rows reliably.

---

## What V2 says we need vs. what we have

| Field | V2 says | DB has | Status |
|---|---|---|---|
| Game mode (`6v6`) | ✓ | not persisted | gap |
| Both team names | ✓ | not persisted | gap |
| Position per player | C/LW/RW/LD/RD/G | mostly LW/RW/LD/RD; never C | broken |
| Gamertag | clean string | concatenated garbage | broken |
| Player Number (state 2) | `#11` | NULL | gap |
| Player Name in-game (state 2) | `E. Wanhg` | NULL | gap |
| Player full Name (loadout) | `Evgeni Wanhg` | NULL | gap |
| Build Class | clean string e.g. `Playmaker` | truncated 7 chars | broken |
| Height | `6'0"` | sometimes correct, often NULL | partial |
| Weight | `160lbs` | sometimes correct | partial |
| Handedness | `Right`/`Left` (loadout) | `SHOOTS RIGHT/LEFT` (some) | partial |
| Level | `P1 \| Level 17` | mangled (`P11VL17`, `P2LVL41 P2LVL35`) | broken |
| Platform | `Xbox` | not persisted | gap |
| Leader/Captain | `Yes`/`No` | not modeled | gap |
| X-Factor names | 3 | ~1.4 avg, mostly truncated | broken |
| X-Factor tiers | Elite/All Star/Specialist | not modeled | gap (schema missing) |
| Attributes (23) | 23 values 0-99 | 5 values per snapshot | broken |
| Δ column (buff indicator) | binary or directional | not modeled | gap |

---

## Internal research findings (May 2026)

Captured during the 2026-05-12 spike. Diagnostic artifacts:
[scripts/dump_raw_ocr.py](../../tools/game_ocr/scripts/dump_raw_ocr.py),
[scripts/xfactor_tier_spike.py](../../tools/game_ocr/scripts/xfactor_tier_spike.py).
Raw OCR dumps at `/tmp/ocr-mrhomicide-loadout.json`,
`/tmp/ocr-lobby-state1.json`, `/tmp/ocr-lobby-state2.json`.

### Headline

**The OCR backend is not the problem.** RapidOCR reads every relevant
string on every capture with high confidence (typical 0.95-1.00). The
parser is broken because:

1. **The ROIs are catastrophically misaligned** — `gamertag` ROI points
   to the LEFT STRIP (where the SELECTED player's persona shows), not
   the TOP-RIGHT where the actual gamertag of the loadout's subject
   sits. `build_class` ROI clips the right half of the title text off,
   producing `'PLAYMA'` instead of `'PLAYMAKER'`. Several other ROIs are
   1/3 the size they should be.
2. **The attribute parser captures one field per group** ([parsers.py:138-162](../../tools/game_ocr/game_ocr/parsers.py#L138-L162))
   — `field_from_lines(regions["technique"])` collapses every line in
   the technique ROI into a single field. The grid has 5 rows × 3
   sub-fields per row (label, Δ, R); we extract one value, conflated.
3. **The lobby panel parser splits players by position-token markers
   but sorts by (y, x)** — which mixes position-labels with text from
   adjacent rows at similar y, producing scrambled `PlayerSlot`s.

### The OCR signal is rich

Full-frame OCR on the Playmaker loadout (MrHomicide) returns 128 lines,
including:

- `'PLAYMAKER'` at (y=137, x=451-773), conf 0.99 — build class
- `'MrHomiecide'` at (y=146, x=1715-1854), conf 0.99 — top-right gamertag
- `"6'0"|160LBS|S"` + `'SHOOTS RIGHT'` at y=189-190 — measurements strip (height truncated due to RapidOCR's bbox segmentation)
- `'X-FACTORS'` header at (y=254)
- `'WHEELS'`, `'ONET'`, `'TAPETOTAPE'` at y=327-330, x≈555/1054/1555 — X-Factor names
- `'ACTIVEABILITYPOINTS(AP):'` at y=449 + `'90/100'` at y=472 — AP indicator
- `'ATTRIBUTES'` header at y=529
- `'TECHNIQUE'`, `'POWER'`, `'PLAYSTYLE'`, `'TENACITY'`, `'TACTICS'` at y=564, conf 0.99 — column headers
- `'△IR'` or `'△|R'` at y=565 in each column — Δ|R sub-headers
- All 23 attribute rows below, each split into: label (left), optional Δ (middle), R (right)

The same picture holds for the lobby OCR — each player row is fully
readable; the data loss is downstream.

### Loadout layout reference (1920×1080)

Empirically validated grid coordinates:

| element | y center | x center / range |
|---|---|---|
| Build class title | ~137 | x=451-773 (centered top) |
| Top-right gamertag | ~146 | x=1715-1854 |
| Measurements strip | ~189 | x=1495-1860 (`H \| W \| Handedness`) |
| X-Factors header | ~254 | centered |
| X-Factor 1/2/3 icons (centroid) | ~340 | 500 / 1000 / 1500 |
| X-Factor 1/2/3 names | ~328 | 555-651 / 1054-1125 / 1555-1705 |
| X-Factor descriptions | ~356 | aligned under names |
| Active Ability Points line | ~449 + ~472 (value) | x=440-880 |
| Attributes section header | ~529 | centered |
| Column headers (T/P/P/T/T) | ~564 | 444-538 / 737-801 / 1031-1122 / 1323-1404 / 1617-1687 |
| Attribute row 1 (y center) | ~598 | 5 columns |
| Attribute row 2 | ~656 | |
| Attribute row 3 | ~714 | |
| Attribute row 4 | ~771 | |
| Attribute row 5 (only Technique/Power/Playstyle) | ~830 | |
| Per-row column-x ranges | — | TECH: label 449-603 / Δ 619-650 / R 664-690 · POWER: 741-876 / 916-945 / 957-982 · PLAY: 1034-1200 / 1205-1240 / 1250-1275 · TENC: 1325-1435 / 1499-1525 / 1543-1567 · TACT: 1619-1725 / 1793-1822 / 1835-1860 |
| Left-strip roster (HOME/AWAY) | y=180-980 | x=22-377 |
| Per-row in strip | every ~88 px | position label x=22-128, gamertag x=200-340 |

Row y-spacing of 58 px (attribute rows) and 88 px (left-strip rows) is
consistent across all 11 loadout captures. Anchor-based parsing is the
right approach.

### Lobby layout reference (1920×1080)

| element | location |
|---|---|
| EASHL 6v6 (game mode) | y=130, x=100-290 |
| THE BOOGEYMEN (our team name) | y=211, x=106-406 |
| 4TH LINE (opp team name) | y=210, x=1652-1818 |
| Our team panel | y=270-960, x=85-410 |
| Opp team panel | y=270-960, x=1500-1860 (narrower) |
| Per-row vertical band | y-step ~88 px starting at y=288 for our team |
| Position label per row | x=22-128 (left edge of panel) |
| Gamertag per row | x=187-340 (top of row) |
| Build class / `#N-Name` per row | x=152-330 (middle of row) |
| Height/Weight per row | x=152-280 (lower in row) |
| Level per row | x=77-170 |
| Captain marker (★) | OCR'd as `'★'` next to gamertag when present (e.g. MrHomicide) |
| READY indicator | text `'READY'` adjacent to gamertag |

### State 1 vs State 2 detection — solved with 5-line regex

| capture | panel | `#NN` count | build-keyword count | inferred state |
|---|---|---|---|---|
| state-1 lobby | our_team | 0 | 6 | **State 1** |
| state-1 lobby | opp_team | 0 | 2 | State 1 (low confidence) |
| state-2 lobby | our_team | 5 | 0 | **State 2** |
| state-2 lobby | opp_team | 0 | 3 | **State 1** ← opp panel is in different state |

Confirmed: **each team alternates independently**. Detection rule per
team panel:

```python
state = 'state_2' if n_hash_patterns >= 3 else 'state_1'
```

The state is per-team-panel, not per-capture. Promoter must merge
state-1 build data + state-2 number/name data across multiple captures
into a single canonical row per (match, team, position).

### X-Factor tier extraction — solved via HSV color sampling

Sample a 70×70 px patch centered at (500, 340) / (1000, 340) / (1500, 340)
for slots 0/1/2. Filter to saturated pixels (S > 100, V > 60). Compute
circular mean of hue. Classify:

| tier | hue range | example median H | example median S |
|---|---|---|---|
| **Elite** | H ≤ 15 OR H ≥ 165 (red, with wrap) | 3 | 220 |
| **All Star** | 95 ≤ H ≤ 135 (blue) | 114 | 134 |
| **Specialist** | 15 < H < 35 (yellow/orange) | 21 | 140 |

**Validated 18/18 = 100% on non-transitional captures** across 6
loadouts (MrHomicide, Stick Menace, HenryTheBobJr, JoeyFlopfish,
MuttButt, shadowassault20, silkyjoker85's second capture).

One capture (silkyjoker85's first, `01h49m06s688`) had **no saturated
pixels** in the X-Factor icon area — the icons were dim/desaturated,
indicating the screen was captured mid-animation/transition before the
icons fully rendered. **Detectable: < 50 saturated pixels in icon
region → "capture is transitional, drop or downweight."** This same
diagnostic generalizes to other capture-quality issues.

### Build class display — variable format

V2 catalogues two styles of build class:

| style | example | source |
|---|---|---|
| Generic | `Playmaker`, `Sniper`, `Two-Way Forward`, `Puck Moving Defenseman`, `Defensive Defenseman`, `Hybrid Defenseman`, `Power Forward` | base game build catalog |
| Named/themed | `Cole Caufield - Sniper`, `Tage Thompson - PowerForward`, `Lane Hutson - Puck Moving Defenseman` | NHL-player-themed variants; "{Player Name} - {Class abbreviation}" |

In the lobby state-1 panel the build is displayed in compact form (e.g.
`Cole Caufield - SNP`, `Tage Thompson - PWF`); in the loadout view it's
the BUILD-CLASS title shown in huge text at the top (`COLE CAUFIELD - SNP`).
The abbreviations seen so far: `SNP` (Sniper), `PWF` (Power Forward),
`PMD` (Puck Moving Defenseman), `TWF` (Two-Way Forward), `DDD` (Defensive
Defenseman). The mapping abbreviation → full class name is finite and
can be hardcoded. The "Player Name" prefix is the NHL star whose
playstyle the build mimics.

### Selected player — title bar IS the signal

Originally listed as an open question. **Not needed in practice:** the
loadout view's title bar gives us the build class of the selected player
directly, and the top-right gamertag identifies them. No left-strip
selection-marker detection required.

### Left strip is a parallel data source

Every loadout capture includes the full 5-row HOME and 5-row AWAY rosters
in the left strip, OCR'd cleanly. For example MrHomicide's loadout
capture surfaces (from the strip):

```
y=210  C  MrHomiecide   #11-Evgeni Wanhg   (P1LVL17)
y=300  LW Stick Menace  #96-Mikko Rantanen (P2LVL34)
y=387  RW silkyjokerB5  #10--Silky          (P2LVL41)
y=474  LD HenryTheBobJr #7-Hubert Jenkins   (P2LVL35)
y=563  RD JoeyFlopfish  #48-Lane Hutson     (P2LVL24)
y=708  AWAY (header)
y=753  C  XZ4RKY        -Toews-#19          (P6LVL34)
...
```

**Across 11 loadout captures: 11× redundancy for every gamertag, persona-
name, and player-number per skater.** This is more redundancy than the 3
lobby captures alone could provide, and motivates cross-frame consensus
as the canonicalisation strategy (same pattern as event-list dossier).

Note: the strip OCR shows misreads (`silkyjokerB5` → silkyjoker85,
`MrHomiecide` → MrHomicide) — same letter-shape confusions as in the
action tracker. Fuzzy match against a known vocabulary (BGM players +
per-match opp roster) will canonicalize them.

### Active Ability Points (AP) and Δ values

- **AP**: visible on most builds as `ACTIVE ABILITY POINTS (AP): N/100`.
  Some captures show 100/100, some 75/100, etc. Low priority; extractable
  as two integers.
- **Δ (per-attribute)**: NEW finding — the rendered loadout shows a green
  `+N` or red `-N` chip next to each modified attribute, with the R
  value reflecting the BUFFED total. V2's "Δ | R" column shows base
  values (R - Δ), meaning we should store BOTH Δ and R to recover base.
  OCR reads Δ chips as e.g. `'-2'`, `'+5'`, `'+9'`, conf 0.95-0.99. Some
  rows have no Δ (no buff/nerf applied).

### Schema additions confirmed

| change | table | column | type |
|---|---|---|---|
| add | `player_loadout_x_factors` | `tier` | `text` (Elite/All Star/Specialist) |
| add | `player_loadout_snapshots` | `is_captain` | `boolean` |
| add | `player_loadout_snapshots` | `player_number` | `integer` |
| add | `player_loadout_snapshots` | `player_name_persona` | `text` (the in-game `E. Wanhg` style name; distinct from full-name `Evgeni Wanhg`) |
| add | `player_loadout_snapshots` | `is_leader` | `boolean` |
| add | `player_loadout_attributes` | `delta_value` | `smallint` (signed; null when no Δ chip) |
| add (optional) | `player_loadout_snapshots` | `ap_used` + `ap_total` | `smallint` |

(The existing `player_name_snapshot` column should be repurposed for the
full real name like "Evgeni Wanhg" from the loadout view; the persona
column is the short in-game version like "E. Wanhg".)

### Tactics panel — clarified

V2's "Tactics" group has 4 attributes: Deking, Faceoffs, Discipline,
Fighting Skill. In the loadout view OCR these appear as the 5th column
header `'TACTICS'` at y=564, x=1617-1687, with 4 attribute rows below.
**Not** active-abilities — just another attribute group with the same
shape as Tenacity. No clarification needed beyond what's in the dossier.

### Capture-quality detection

Two distinct "bad capture" failure modes observed:

1. **Mid-animation transition** (silkyjoker85 first capture): X-Factor
   icons not yet drawn. Detectable: < 50 saturated pixels in icon ROI.
2. **Frame stitching / scroll-in-progress**: rows partially visible at
   top/bottom edges, attribute panel not aligned. Detectable: column
   header `'TECHNIQUE'` / `'POWER'` etc. not present at expected y±10
   range.

Both should be filtered before parsing, or flagged at low confidence so
consensus voting can outvote them.

---

## Recommended architecture (revised — based on internal research)

### Layer 1 — Drop ROI configs for these screens; use full-frame anchored parse

The current per-ROI strategy is the wrong abstraction. Run a single
full-frame OCR pass per capture and parse by anchor lines + global
coordinates.

**Anchor lines** (high-confidence, position-stable):
- Lobby: team-name headers (`THE BOOGEYMEN`, `4TH LINE`), `EASHL 6v6`,
  position labels (C/LW/RW/LD/RD/G) at the left edge of each panel
- Loadout view: `X-FACTORS`, `ATTRIBUTES`, column headers (`TECHNIQUE` /
  `POWER` / `PLAYSTYLE` / `TENACITY` / `TACTICS`), `ACTIVE ABILITY
  POINTS (AP):`, top-right gamertag

**Per-screen parsing strategy:**

| screen | strategy |
|---|---|
| Lobby | (1) y-cluster each panel into 6 row-bands (~88 px each, starting at y≈288). (2) Within each band, identify fields by x-range + text-pattern: position label at x=22-128, gamertag at top-most y, level via `LVL` keyword, height/weight via `'` or `"`/`lbs`, build vs `#N-Name` by regex. (3) Detect per-team state via `#NN` regex count (≥3 → state 2, otherwise state 1). |
| Loadout view | (1) Locate column headers at y≈564 (TECHNIQUE/POWER/PLAYSTYLE/TENACITY/TACTICS). (2) Compute the 5 column x-bands from those headers. (3) Snap OCR lines into 5 row × 5 column grid (rows at y≈598/656/714/771/830; last two columns only have 4 rows). (4) Per cell, classify token by x-sub-range: label / Δ / R. (5) Extract X-Factor names + tiers separately (tiers via HSV sampling at fixed centroids, names via OCR at fixed y/x). (6) Extract build class from huge centered title at y≈137. (7) Extract gamertag from top-right at y≈146 x≈1715-1854. (8) Extract measurements strip from y≈189 x=1495-1860, split on `\|`/`lbs`/`SHOOTS`. |

### Layer 2 — State-1/state-2 fusion for lobby (per team)

Each team's panel state is independent. Per team:

```python
state = 'state_2' if hash_pattern_count >= 3 else 'state_1'
```

The promoter merges state-1 build data + state-2 number/name data across
multiple captures into ONE canonical row per (match, team, position).

### Layer 3 — Cross-frame consensus per player (same as event-list pipeline)

With 11 loadout captures and 3 lobby captures we have substantial
redundancy:

- **Lobby state coverage**: 3 captures with the 3 visible
  (BGM-state, OPP-state) combinations give us at least 2 observations
  of each (team, state) pair → easy state-1 + state-2 fusion per team.
- **Loadout view captures**: 11 captures, 1 per skater (+ 1 duplicate for
  silkyjoker85). For the SUBJECT of each capture: 1 observation of full
  attribute breakdown. For the LEFT STRIP: 11× redundancy per skater of
  position+gamertag+number+name+level.

Cross-frame consensus pattern:
- Cluster captures by canonical gamertag via RapidFuzz / Jaro-Winkler
  match against the BGM-known + opp-observed vocabulary.
- Per skater, vote per field across all observations with confidence
  weighting (CWMV from the event-list dossier).
- Singletons go to a manual review queue rather than auto-approve.
- Filter transitional captures up-front (< 50 saturated pixels in
  X-Factor icon ROI → drop or downweight).

### Layer 4 — X-Factor tier classifier (validated 100% on non-transitional captures)

Sample 70×70 px HSV patch at icon centroids (500, 340) / (1000, 340) /
(1500, 340). Filter S > 100 and V > 60. Compute circular hue mean.
Bucket: red → Elite, blue → All Star, yellow → Specialist.

### Layer 5 — Schema additions

| change | table | column | type | source |
|---|---|---|---|---|
| add | `player_loadout_x_factors` | `tier` | `text` | HSV color of icon |
| add | `player_loadout_snapshots` | `is_captain` | `boolean` | yellow ★ next to gamertag |
| add | `player_loadout_snapshots` | `player_number` | `integer` | `#NN` from state-2 lobby or loadout strip |
| add | `player_loadout_snapshots` | `player_name_persona` | `text` | the `E. Wanhg` short in-game name |
| add | `player_loadout_attributes` | `delta_value` | `smallint` | Δ chip (signed, null when no chip) |
| optional | `player_loadout_snapshots` | `ap_used` + `ap_total` | `smallint × 2` | "ACTIVE ABILITY POINTS (AP): N/100" |

Existing `player_name_snapshot` should be the full real name like
"Evgeni Wanhg" from the loadout view (different from persona).

### Layer 6 — Validation against V2 benchmark

Match 250's V2 entries are the gold standard. End-to-end regression test
diffs the new pipeline's per-player output against V2 row-by-row. We
already have data for 10 skaters with full attribute/X-Factor/tier
coverage in V2.

### What to drop

- The 17-region ROI config for `player_loadout_view`
- The 5-region ROI config for `pre_game_lobby_state_*` (or keep purely
  as broad band hints for OCR throttling, not for per-field clipping)
- The current `parse_loadout_result`'s single-attribute-per-group logic
- The current `parse_lobby_team`'s sort-by-(y,x)-then-walk-position
  approach
- All 28 existing reviewed-but-garbage rows (delete + reingest)

---

## Open research questions

After the internal-research spike, here's where each question landed:

| # | Question | Status |
|---|---|---|
| 1 | Grid extraction technique for attribute panel | **Answered**: anchor-based parse on full-frame OCR. The 5-column header row at y=564 is a stable anchor; row y-positions are at 598/656/714/771/830. No need for PP-Structure or layout-parser. |
| 2 | State 1 vs State 2 detection | **Answered**: per-team `#NN` regex count ≥ 3 → State 2. Trivial. |
| 3 | X-Factor tier extraction (color vs CNN) | **Answered**: HSV color sampling at fixed icon centroids. 100% accuracy on non-transitional captures with 5-line classifier. No CNN needed. |
| 4 | Build-class vocabulary | **Answered**: finite catalogue with a generic-vs-themed split. Abbreviations (SNP/PWF/PMD/TWF/DDD) are decodable from the V2 corpus and a hardcoded mapping. |
| 5 | Selected-player indicator | **Moot**: not needed — the build-class title and top-right gamertag identify the active player directly. |
| 6 | Left strip as parallel source | **Answered**: 11× redundancy per skater per match via loadout captures + 3× via lobby captures. Use for cross-frame consensus. |
| 7 | Δ column meaning | **Answered**: Δ = buff/nerf delta (signed int), R = post-buff displayed value. V2's "Δ \| R" column actually shows BASE = R − Δ. Store both Δ and R; base is derivable. |
| 8 | Goalie loadout view | **Deferred**: no goalie data in match 250 (CPU goalies). Revisit when a real match has human goalies. |

### Remaining unknowns (low-priority)

- **AP semantics**: what does "Active Ability Points (AP): 90/100" mean
  for gameplay? Probably a pool of points used to activate boosts. Low
  priority — capturing the values is cheap, interpretation can wait.
- **What's the full canonical build-class catalogue?** We've seen ~8
  distinct base classes. EA publishes them in-game; could be scraped
  from a static EA reference if one exists, otherwise grown from
  observation across matches.
- **Per-X-Factor name vocabulary**: ~20 distinct X-Factor names observed
  so far (Wheels, One T, Tape to Tape, Big Rig, Ankle Breaker, Quick
  Release, Pressure+, Warrior, Elite Edges, Stick 'Em Up, Quick Pick,
  Rocket, Two-Way Forward... wait those last two are builds). Worth
  cataloguing for fuzzy matching.

---

## Concrete next-pass plan (revised after internal research)

In priority order:

1. **Schema migrations** (small, can land first): add `tier`,
   `is_captain`, `is_leader`, `player_number`, `player_name_persona`,
   `delta_value`, (optional) `ap_used` / `ap_total` columns per the
   table above.
2. **Reset the DB**: delete all 28 garbage snapshots + their children
   for match 250. Start clean.
3. **Rewrite `parse_loadout_result`** using anchor-based parsing:
   - Full-frame OCR pass
   - Locate column headers → derive 5 column x-bands
   - Snap OCR lines into 5×5 (or 5×4) attribute grid
   - Extract X-Factor names + HSV-classified tiers separately
   - Extract gamertag, build class, measurements via fixed-position OCR
   - Validate output against V2 for MrHomicide, Stick Menace,
     silkyjoker85, HenryTheBobJr, JoeyFlopfish — all 23 attributes
     should match V2's base values (R − Δ)
4. **Rewrite `parse_lobby_team`** using y-band row-clustering:
   - Per panel: cluster OCR lines into 6 row-bands at ~88 px steps
   - Within each band: pattern-match position label, gamertag, level,
     build/`#N-Name`, height/weight by content + x-range
   - Detect state-1 vs state-2 via `#NN` regex count per team
   - Detect captain via `'★'` token presence
5. **Add transitional-capture filter** in the extractor: count
   saturated pixels at X-Factor icon ROI (loadout) or at portrait
   regions (lobby); skip captures below threshold.
6. **Add cross-frame consensus** in the promoter:
   - Cluster captures of the same match by canonical gamertag (fuzzy
     match via RapidFuzz against BGM-known + opp-observed vocab)
   - CWMV per field across observations
   - Single-observation rows → manual review queue (not auto-approve)
7. **Validation pass**: run new pipeline against match 250 captures,
   diff output against V2 benchmark row-by-row. Goal: 100% match on
   gamertag + position + 23 attributes per skater.
8. **(Defer) External research round** — internal research answered
   every priority question. External round is only needed if/when:
   - We hit a parser edge case we can't reason about
   - We want validation that CWMV is the right consensus algorithm
     for this specific schema
   - A new screen layout is introduced (NHL 26 release, etc.)

### Out of scope (for now)

- Goalie-specific loadout extraction (no test data)
- Active-Ability-Points semantics (capture values; interpret later)
- Rendering loadouts on the web (separate task; data layer first)
- Cross-match build-class catalogue normalisation (we'll grow it as we
  ingest more matches)

---

## Sources

### Internal references

- [research/OCR-SS/Manual OCR benchmark for verification V2.md](../../research/OCR-SS/Manual%20OCR%20benchmark%20for%20verification%20V2.md) — canonical V2 ground truth
- [research/OCR-SS/Pre-Game-Lobby/](../../research/OCR-SS/Pre-Game-Lobby/) — 3 lobby captures
- [research/OCR-SS/Pre-Game-Loadouts/](../../research/OCR-SS/Pre-Game-Loadouts/) — 11 loadout captures
- [tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_1.yaml](../../tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_1.yaml)
- [tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_2.yaml](../../tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_2.yaml)
- [tools/game_ocr/game_ocr/configs/roi/player_loadout_view.yaml](../../tools/game_ocr/game_ocr/configs/roi/player_loadout_view.yaml)
- [tools/game_ocr/game_ocr/parsers.py](../../tools/game_ocr/game_ocr/parsers.py) (`parse_pre_game_result`, `parse_loadout_result`, `parse_lobby_team`)
- [tools/game_ocr/game_ocr/models.py](../../tools/game_ocr/game_ocr/models.py) (`PreGameLobbyResult`, `PlayerLoadoutResult`, `PlayerSlot`, `TeamSummary`, `AttributeGroup`)
- [apps/worker/src/ocr-promoters/loadout.ts](../../apps/worker/src/ocr-promoters/loadout.ts)
- [apps/worker/src/ocr-promoters/pre-game-lobby.ts](../../apps/worker/src/ocr-promoters/pre-game-lobby.ts)
- [packages/db/src/schema/player-loadout.ts](../../packages/db/src/schema/player-loadout.ts)
- [packages/db/src/queries/match-lineups.ts](../../packages/db/src/queries/match-lineups.ts) — already imagines reviewed loadouts as the source of truth for match rosters

### Spike artifacts (May 2026 internal research)

- [tools/game_ocr/scripts/dump_raw_ocr.py](../../tools/game_ocr/scripts/dump_raw_ocr.py)
  — full-frame + per-ROI OCR dump
- [tools/game_ocr/scripts/xfactor_tier_spike.py](../../tools/game_ocr/scripts/xfactor_tier_spike.py)
  — HSV-based tier classifier, validated 18/18 on non-transitional captures
- `/tmp/ocr-mrhomicide-loadout.json` — Playmaker reference OCR dump
- `/tmp/ocr-lobby-state1.json` — both teams state 1
- `/tmp/ocr-lobby-state2.json` — BGM state 2, OPP state 1

### External

Not run yet. Internal research answered every priority question; an
external round can be cued later if a specific implementation question
turns out to need one.

---

## Picking this back up

When resumed:

1. Re-read this dossier top-to-bottom.
2. Start with question 1-5 in "Open research questions" via internal
   spike (no web research needed yet — most of these are answerable from
   the screen captures and the existing codebase).
3. Externalize only the questions that can't be answered internally.
4. Match 250's V2 benchmark is the regression-test gold standard for
   any new pipeline.
