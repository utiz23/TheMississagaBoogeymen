# Badge Progression System

This file is the working badge threshold catalog for card progression.

The current structure is worth keeping: each badge family has 6 tiers, and each
tier has 5 levels. That gives every category 30 progression points without
turning the card system into a pile of one-off awards.

Badges should be treated as progression evidence:

```txt
Stat total -> Badge family -> Tier -> Level -> Card display effect
```

Badges do not directly equal card tiers. A player card should look at the best
relevant badge families, apply role-specific weighting, and then decide card
tier, featured badge, title, and visual treatment.

## Badge Metadata Needed Before Seeding

Each badge family should eventually become structured data with these fields:

```ts
type BadgeSourceStatus = "available" | "derived" | "manual" | "future"

type BadgeDefinition = {
  id: string
  scope: "player" | "team"
  role: "skater" | "goalie" | "any"
  statKey: string
  displayName: string
  sourceStatus: BadgeSourceStatus
  cardWeight: 0 | 1 | 2 | 3 | 4
}
```

Source status meanings:

| Status | Meaning |
|---|---|
| `available` | Can be computed from current stored data. |
| `derived` | Can be computed, but needs careful query logic. |
| `manual` | Should be awarded or confirmed by an admin/editor. |
| `future` | Keep the idea, but do not automate it yet. |

Card weight meanings:

| Weight | Meaning |
|---:|---|
| 0 | Cosmetic/showcase only; does not affect individual card tier. |
| 1 | Light progression signal. |
| 2 | Normal progression signal. |
| 3 | Major identity signal. |
| 4 | Elite/franchise identity signal. |

Team badges should usually have `cardWeight: 0` for individual player cards.
They can still drive team showcases, carousel slots, and card augmentations.

---

# Player
## 3v3 Games Completed

Source status: `available`  
Card weight: `1`


| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 35      | 40      | 45      | 50      | 75      |
| 3    | 100     | 125     | 150     | 175     | 200     |
| 4    | 225     | 250     | 350     | 450     | 500     |
| 5    | 550     | 600     | 650     | 700     | 750     |
| 6    | 800     | 850     | 900     | 950     | 1000    |

## 6v6 Games Completed

Source status: `available`  
Card weight: `1`


| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 35      | 40      | 45      | 50      | 75      |
| 3    | 100     | 125     | 150     | 175     | 200     |
| 4    | 225     | 250     | 350     | 450     | 500     |
| 5    | 550     | 600     | 650     | 700     | 750     |
| 6    | 800     | 850     | 900     | 950     | 1000    |

## 6v6 Games With Goalie

Source status: `derived`  
Card weight: `1`


| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |


## Wins

Source status: `available`  
Card weight: `2`


| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 85      | 90      | 95      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |

## Goals

Source status: `available`  
Card weight: `4`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 25      | 50      |
| 2    | 100     | 150     | 200     | 250     | 300     |
| 3    | 350     | 400     | 450     | 500     | 550     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |
## Assists

Source status: `available`  
Card weight: `4`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 25      | 50      |
| 2    | 75      | 100     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |
## Shots

Source status: `available`  
Card weight: `2`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 25      | 50      | 75      |
| 2    | 100     | 125     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |
## Dekes

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 25      | 50      | 75      |
| 2    | 100     | 125     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |
## Hat Tricks

Source status: `derived`  
Card weight: `3`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 2       | 3       | 4       | 5       |
| 2    | 6       | 7       | 8       | 9       | 10      |
| 3    | 11      | 12      | 13      | 14      | 15      |
| 4    | 20      | 25      | 30      | 35      | 40      |
| 5    | 45      | 50      | 55      | 60      | 65      |
| 6    | 70      | 75      | 80      | 90      | 100     |
## Breakaways

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |
## Hits

Source status: `available`  
Card weight: `3`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 25      | 50      | 75      |
| 2    | 100     | 125     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |

## Faceoffs Won

Source status: `available`  
Card weight: `3`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 25      | 50      | 75      | 100     | 150     |
| 2    | 200     | 300     | 400     | 500     | 600     |
| 3    | 700     | 800     | 900     | 1000    | 1250    |
| 4    | 1500    | 1750    | 2000    | 2250    | 2500    |
| 5    | 2750    | 3000    | 3250    | 3500    | 3750    |
| 6    | 4000    | 4250    | 4500    | 4750    | 5000    |

## Takeaways

Source status: `available`  
Card weight: `3`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 25      | 50      | 75      |
| 2    | 100     | 125     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
| 5    | 1100    | 1200    | 1300    | 1400    | 1500    |
| 6    | 1600    | 1700    | 1800    | 1900    | 2000    |
## Blocked Shots

Source status: `available`  
Card weight: `2`  
Note: validate these thresholds against real totals before seeding.

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
| 5    | 105     | 110     | 115     | 120     | 125     |
| 6    | 130     | 135     | 140     | 145     | 150     |
## Fights Won

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |

## Goalie Games Completed

Source status: `available`  
Card weight: `2`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 3       | 5       | 10      | 15      |
| 2    | 20      | 25      | 30      | 35      | 40      |
| 3    | 45      | 50      | 55      | 60      | 65      |
| 4    | 70      | 75      | 80      | 85      | 100     |
| 5    | 125     | 150     | 175     | 200     | 225     |
| 6    | 250     | 275     | 300     | 400     | 500     |
## Goalie Wins

Source status: `available`  
Card weight: `3`  
Note: validate these thresholds against actual goalie usage; they may be high.

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 85      | 90      | 95      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |

## Saves

Source status: `available`  
Card weight: `4`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 15      | 25      | 50      | 75      | 100     |
| 2    | 150     | 200     | 250     | 300     | 400     |
| 3    | 500     | 600     | 800     | 1000    | 1250    |
| 4    | 1500    | 1750    | 2000    | 2250    | 2500    |
| 5    | 2750    | 3000    | 3250    | 3500    | 3750    |
| 6    | 4000    | 4250    | 4500    | 4750    | 5000    |

## Desperation Saves

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 85      | 90      | 95      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |
## Goalie Poke Checks

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 85      | 90      | 95      | 100     |
| 5    | 110     | 120     | 130     | 140     | 150     |
| 6    | 160     | 170     | 180     | 190     | 200     |
## Shutouts

Source status: `available`  
Card weight: `4`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 2       | 3       | 4       | 5       |
| 2    | 6       | 7       | 8       | 9       | 10      |
| 3    | 11      | 12      | 13      | 14      | 15      |
| 4    | 20      | 25      | 30      | 40      | 50      |
| 5    | 60      | 70      | 80      | 90      | 100     |
| 6    | 110     | 120     | 130     | 140     | 150     |
# Team

Team badges are club achievements. They should drive team showcases, homepage
labels, carousel slots, and card augmentations. They should not directly inflate
an individual player card unless a later rule explicitly allows it.

## 3v3 Games Completed

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 35      | 40      | 45      | 50      | 75      |
| 3    | 100     | 125     | 150     | 175     | 200     |
| 4    | 225     | 250     | 325     | 400     | 500     |

## 6v6 Games Completed

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 35      | 40      | 45      | 50      | 75      |
| 3    | 100     | 125     | 150     | 175     | 200     |
| 4    | 225     | 250     | 325     | 400     | 500     |

## Games Completed

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 35      | 40      | 45      | 50      | 75      |
| 3    | 100     | 125     | 150     | 175     | 200     |
| 4    | 225     | 250     | 325     | 400     | 500     |
## 6-Player Games Completed

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 90      | 100     | 150     | 200     |

## 6v6 Games With Goalie

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 90      | 100     | 150     | 200     |
## Wins

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 15      | 20      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 75      | 100     | 125     | 150     | 175     |
| 4    | 200     | 225     | 250     | 275     | 300     |
## Wins With Goalie

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 90      | 100     | 150     | 200     |
## Wins With 6 Players

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 90      | 100     | 150     | 200     |
## Blowout Wins

Definition: win by 5 or more goals.

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
## Goals

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 5       | 10      | 25      | 50      | 75      |
| 2    | 100     | 125     | 150     | 200     | 250     |
| 3    | 300     | 350     | 400     | 450     | 500     |
| 4    | 600     | 700     | 800     | 900     | 1000    |
## Power-Play Goals

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 60      | 70      | 80      | 90      |
| 4    | 100     | 125     | 150     | 175     | 200     |
## Shutouts

Source status: `available`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
## Games With 1 Goal Against Or Fewer

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |
## Games With 2 Goals Against Or Fewer

Source status: `derived`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 25      |
| 2    | 30      | 35      | 40      | 45      | 50      |
| 3    | 55      | 60      | 65      | 70      | 75      |
| 4    | 80      | 90      | 100     | 150     | 200     |
## Perfect PK

Source status: `future`  
Card weight: `0`

| Tier | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| ---- | ------- | ------- | ------- | ------- | ------- |
| 1    | 1       | 5       | 10      | 15      | 20      |
| 2    | 25      | 30      | 35      | 40      | 45      |
| 3    | 50      | 55      | 60      | 65      | 70      |
| 4    | 75      | 80      | 85      | 90      | 100     |

---

# Cleanup Decisions Applied

- Changed `6' Games Completed` to `6v6 Games Completed`.
- Changed `5 wins` cells under games-completed badges to numeric `5`.
- Removed the duplicate `Games with 2 goals or Fewer` table and kept the more ambitious Tier 4 scale.
- Marked uncertain data categories as `future`.
- Marked categories that require match composition or derived query logic as `derived`.
- Kept the original tier/level threshold structure intact.

# Implementation Notes

For the first automated version, seed only `available` and carefully validated
`derived` badges. Keep `manual` and `future` definitions in the source catalog,
but do not show them as unlockable unless the UI clearly labels them as unavailable.

Recommended v1 automated player badges:

- 3v3 Games Completed
- 6v6 Games Completed
- Wins
- Goals
- Assists
- Shots
- Hits
- Faceoffs Won
- Takeaways
- Blocked Shots, after validation
- Goalie Games Completed
- Goalie Wins, after validation
- Saves
- Shutouts

Recommended v1 automated team badges:

- Games Completed
- Wins
- Goals
- Shutouts
- Blowout Wins
- Games With 1 Goal Against Or Fewer
- Games With 2 Goals Against Or Fewer

Recommended v1 card-tier inputs:

- Skaters: Goals, Assists, Hits, Faceoffs Won, Takeaways, Wins, Games Completed.
- Goalies: Saves, Shutouts, Goalie Wins, Goalie Games Completed.
- Team badges: display/showcase only.
