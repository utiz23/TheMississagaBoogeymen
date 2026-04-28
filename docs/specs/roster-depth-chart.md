# Roster Depth Chart — Specification

## Goal

Build the `/roster` page as a lineup-style depth chart instead of a flat roster table.

The page should:

- use player cards arranged in a hockey lineup structure
- allow the same player to appear multiple times across eligible positions
- show season totals on cards by default
- visually follow the mocked layout provided by the user
- take styling inspiration from the HUT lineup screen reference

This is a lineup presentation surface, not a unique-members table.

## Product Rules

### 1. Stats shown on roster cards are season stats by default

Roster card stats should always be full-season totals unless the page is explicitly filtered otherwise.

Examples of explicit non-default scopes:

- `6s`
- `3s`
- `last 5 games`

If no explicit filter is active, cards show season totals.

### 2. Players may appear multiple times

Players can be listed more than once on the roster page.

They may appear:

- once in the first-pass board fill based on their strongest played position
- again later as reused depth fillers in other positions they have actually played

For phase 1, each appearance uses the same season totals card.

Position-specific card stats are deferred.

### 3. Position groups are assigned by positional usage, not points

For phase 1, lineup placement is based on **games played at that position** from tracked positional history.

This means:

- forward assignment is based on forward-position usage
- defense assignment is based on defense usage
- goalie assignment is based on goalie usage

Season totals are still shown on the cards, but they do **not** determine slot placement.

Recommended tie-breakers when two players have the same games played at a position:

- season points desc
- total games played desc
- gamertag asc

### 4. Defense is one pooled ranked group

Defense should be sorted by **games played at defense** from one defense pool.

Specific `LD` and `RD` assignments are not derived yet.

For phase 1:

- render `LD` and `RD` columns for layout
- fill them from one ranked defense pool
- treat side assignment as visual placement only

Manual side assignment is future work.

## Layout

## Overall Board

The page should use a centered dark lineup board with three major areas:

- forwards block
- defense block
- goalie block

The structure should closely follow the user mockup.

## Forwards

Display 4 forward lines with 3 columns:

- `LW`
- `C`
- `RW`

Rows:

- `Line 1`
- `Line 2`
- `Line 3`
- `Line 4`

Total forward slots: 12

## Defense

Display 3 defense pairs with 2 columns:

- `LD`
- `RD`

Rows:

- `Pair 1`
- `Pair 2`
- `Pair 3`

Total defense slots: 6

Important:

- these columns are layout labels only in phase 1
- assignment comes from one defense ranking pool sorted by defense games played

## Goalies

Display a bottom goalie row with 5 slots:

- `Starter`
- `Backup`
- `3rd String`
- `4th String`
- `5th String`

Total goalie slots: 5

Goalies are ranked independently from skaters by **games played at goalie**.

Recommended tie-breakers:

- `wins desc`
- `save % desc`
- `GAA asc`

## Player Card Content

Phase 1 roster cards should display the same season totals regardless of which slot the player appears in.

Required fields:

- gamertag
- displayed position label
- GP
- G
- A
- PTS

Visual direction:

- reuse the same card component / card design language used in the player carousel
- do not invent a separate roster-card visual system
- adapt the existing carousel card into a smaller board-friendly variant if needed

Not in phase 1:

- position-specific stats
- slot-specific production
- advanced role chemistry
- inferred left/right defense intelligence

## Eligibility Rules

Players may appear in multiple position groups if they have actual played history there.

For phase 1:

- use tracked positional usage / played-position evidence to determine eligibility
- use season totals for displayed card numbers
- use games played at position as the placement metric

That split is intentional:

- placement logic comes from tracked positional history
- displayed stats come from season totals

### Example

If `silkyjoker85` has tracked games at multiple positions, he may appear:

- first in the strongest applicable position during first-pass filling
- again later as a reused filler in another position he has actually played

Each appearance still shows the same season totals card for now.

## Source of Truth

### Card stats

Default card stats should use full-season totals.

Preferred source:

- EA season totals

Reason:

- user requirement is explicit
- roster cards should show season stats unless another scope is selected

### Position eligibility / deployment logic

Use tracked/local positional usage data.

Reason:

- EA season totals alone do not describe multi-position usage well enough
- the depth chart needs actual played-position evidence

## Assignment Model

Phase 1 uses a two-pass assignment model.

### Pass 1: unique-placement pass

Try to place each player once before reusing anyone.

For forwards:

- consider `leftWing`, `center`, and `rightWing`
- determine each player’s strongest forward position by highest games played at that position
- assign players into forward slots from that strongest-position usage
- order within a position by games played at that position desc

For defense:

- rank all defense-eligible players by games played at `defenseMen` desc
- fill the defense board from that one pool

For goalies:

- rank by games played at `goalie` desc
- fill horizontally from Starter through 5th String

### Pass 2: reuse pass

After the first-pass board fill:

- fill remaining empty forward slots using reused players who have played that position
- fill remaining defense slots using reused defense-eligible players
- goalie row remains a straight ordered list by goalie games played

This allows duplicate appearances, but only after the first-pass unique fill has been attempted.

### Manual example

The intended behavior matches the user’s manual example:

- players are placed roughly once at forward based on most-played forward position
- remaining gaps are filled by reused players based on games played at that position
- defense is filled from a pooled defense usage ranking
- goalies are ordered horizontally by goalie games played

## Empty Slot Behavior

If there are not enough eligible players to fill a slot:

- render an empty placeholder card
- label it `Open Slot`

Do not fabricate assignments.

## Interaction Model

### Phase 1

- lineup board is static
- click card navigates to player profile
- hover may show light emphasis only

### Future Enhancements

- `Primary Only` vs `Full Depth Chart` toggle
- mode filters (`All`, `6s`, `3s`)
- highlight all duplicate appearances of the same player
- admin/manual side assignment for defense
- position-specific card stats

## Mobile Behavior

Do not collapse the full lineup board into unreadable trash.

Mobile behavior should:

- stack `Forwards`, `Defense`, and `Goalies` vertically
- preserve line/pair/goalie labels
- keep cards readable first
- use horizontal overflow only if absolutely necessary

## Visual Direction

Use the provided mockup as the structural reference and the HUT lineup screen as the visual mood reference.

Desired traits:

- dark lineup board
- clear positional headings
- obvious line/pair grouping
- compact, repeatable player cards
- layout that feels like a roster/depth-chart screen, not a spreadsheet
- line labels and position labels should sit directly on the board background
- do not wrap line labels or position labels in visible boxes, pills, or tiles

## Phase 1 Scope

Phase 1 includes:

1. lineup-style roster board
2. season totals on all cards by default
3. multi-position duplicate appearances
4. usage-based placement by games played at position
5. pooled defense ranking by defense games played
6. horizontal goalie ordering by goalie games played
7. static lineup presentation with player-profile linking

## Deferred Work

The following are explicitly not part of phase 1:

- position-specific stats on roster cards
- automatic `LD` / `RD` intelligence
- manual side assignment tooling
- advanced lineup weighting
- chemistry systems
- role-specific card variants beyond basic goalie handling

## Blunt Summary

Phase 1 roster page behavior is:

- season totals on cards
- multiple appearances allowed
- first-pass placement driven by games played at position
- reused players fill remaining gaps
- defense treated as one pooled ranked group by defense usage
- goalies ordered horizontally by goalie usage
- true side-specific defense assignment deferred

This version is intentionally simple and honest.
