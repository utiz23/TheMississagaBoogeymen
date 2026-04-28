# Final Score Card — UI/UX Specification

## 1. Objective

Display the **most recent game result** in a high-impact, scoreboard-style component.

This card is:

- A **primary homepage feature**
- A **quick-read summary of latest performance**
- A **visual anchor for team identity and results**

---

## 2. Core Concept

A **centered scoreboard layout** with:

```id="score-layout"
[ Team A ]   [ SCORE ]   [ Team B ]
```

Supporting data:

- Team logos
- Abbreviations
- Records
- Game status (Final / OT / SO)
- Game-winning goal (GWG)

---

## 3. Layout Structure

```id="component-structure"
FinalScoreCard
 ├── Header (optional label: "Scores")
 └── ScorePanel
      ├── TeamLeft
      ├── ScoreCenter
      └── TeamRight
```

---

## 4. Section Breakdown

## TeamLeft (Home or Featured Team)

**Contains:**

- Team logo (large)
- Team abbreviation (e.g., BGM)
- Record (W–L–OTL)

**Layout Rules:**

- Left-aligned block
- Vertical stacking:

```id="team-left"
Logo
Team Code
Record
```

---

## ScoreCenter

**Purpose:** Main focal point

**Contains:**

- Final score (e.g., 7–3)
- Game status badge ("Final", "OT", "SO")
- GWG label + player name

**Layout Rules:**

- Centered
- Largest typography on card

**Hierarchy:**

```id="score-center"
Score (largest)
Status Badge
GWG Label
Player Name
```

---

## TeamRight (Opponent)

Same structure as TeamLeft:

- Logo
- Team code (e.g., MTL)
- Record

---

## 5. Visual Hierarchy

Priority order:

1. Score (largest, center)
2. Team logos
3. Team abbreviations
4. GWG info
5. Records

---

## 6. Styling Rules

Aligned with brand guide:

### Background

- Dark panel (charcoal/black)
- Slight gradient or vignette allowed

### Score

- Very large font
- High contrast (white or light gray)

### Status Badge

- Highlight color (yellow/orange)
- Small rectangular pill

### Team Logos

- High contrast
- Equal visual weight on both sides

### Text

- White = primary
- Gray = secondary (records, labels)

---

## 7. Component Sizing

### Desktop

- Width: ~70–80% of container
- Height: medium-large (hero component)

### Tablet

- Slightly reduced spacing

### Mobile

- Stack vertically:

```id="mobile-layout"
Team A
Score
Team B
GWG
```

---

## 8. Data Mapping

| UI Element    | Source                   |
| ------------- | ------------------------ |
| Team A logo   | club.logo                |
| Team A code   | club.abbreviation        |
| Team A record | club.wins-losses-otl     |
| Team B logo   | opponent.logo            |
| Team B code   | opponent.abbreviation    |
| Team B record | opponent.record          |
| Score         | game.score_for / against |
| Status        | game.result_type         |
| GWG player    | game.game_winning_goal   |

---

## 9. Status Types

Display logic:

| Game State           | Label |
| -------------------- | ----- |
| Regulation           | Final |
| Overtime             | OT    |
| Shootout             | SO    |
| In-progress (future) | Live  |

---

## 10. Interaction Behavior

### Click

- Opens full **Game Detail Page**

### Hover (desktop)

- Slight scale increase
- Subtle glow or border highlight

---

## 11. Animation (Optional)

- Fade-in on page load
- Score pop-in animation
- Badge slide-in

Keep subtle. Avoid distracting from readability.

---

## 12. Reusability

This component should be reusable for:

- Home page (latest game)
- Scores page (featured game)
- Game recap sections

---

## 13. Edge Cases

Handle:

- Missing logos → fallback icon
- Missing GWG → hide section
- Tie (if applicable) → display appropriately
- Large scores → maintain spacing

---

## 14. Definition of Done

Component is complete when:

- Displays correct latest game data
- Score is immediately readable
- Works on all screen sizes
- Click navigates to game details
- Matches dark, high-contrast brand style
- No layout break with long team names or edge scores

---

## 15. Future Enhancements

- Add shot totals or key stats
- Add goal timeline preview
- Add highlight video link
- Add team color accents (subtle glow)

---

## 16. Design Intent Summary

This component should feel like:

> A broadcast scoreboard + esports match result panel

- Clean
- Bold
- Fast to read
- Visually centered around the score

---

If needed next:

- React/Tailwind component
- Full homepage layout combining:
  - Final score
  - Player carousel
  - Stats summary
