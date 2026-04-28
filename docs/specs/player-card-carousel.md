# Player Card Carousel — UI/UX Specification

## 1. Objective

Implement a **player card carousel component** to:

- Visually showcase roster players
- Highlight individual player cards in an interactive format
- Provide a dynamic, engaging alternative to static tables

Primary use:

- **Roster page hero section**
- Optional reuse on Home page for featured players

---

## 2. Core Concept

The carousel displays multiple **player cards in a layered, rotating layout**:

- One **active (center) card**
- Surrounding cards positioned behind and to the sides
- Depth created through:
  - Scale
  - Opacity
  - Position offset

This creates a **3D / stacked card effect**.

---

## 3. Layout Structure

```id="carousel-structure"
CarouselContainer
 ├── Card (left-back)
 ├── Card (left-mid)
 ├── Card (center-active)
 ├── Card (right-mid)
 └── Card (right-back)
```

---

## 4. Visual Behavior

### Active Card (Center)

- Largest scale (1.0)
- Full opacity
- Highest z-index
- Fully interactive

### Side Cards

- Slightly smaller scale (0.85–0.95)
- Reduced opacity (0.6–0.8)
- Offset horizontally

### Back Cards

- Smallest scale (0.7–0.8)
- Low opacity (0.3–0.5)
- Positioned further outward

---

## 5. Motion & Rotation

### Interaction Types

#### 1. Manual Navigation

- Click left/right arrows
- Drag/swipe (mobile + desktop)
- Click on side cards to bring forward

#### 2. Auto Rotation (Optional)

- Interval: 3–6 seconds
- Pauses on hover

---

### Rotation Logic

```id="rotation-logic"
CurrentIndex = active player

On Next:
    shift all cards left
    new card enters from right

On Previous:
    shift all cards right
    new card enters from left
```

---

## 6. Animation Rules

- Transition duration: **250ms–400ms**
- Use **ease-in-out**
- Animate:
  - transform (translateX, scale)
  - opacity
  - z-index (snap, not animated)

**Avoid:**

- Layout reflow
- Width/height animation

---

## 7. Positioning Model

Example transform mapping:

```id="position-map"
Index -2 → translateX(-220px) scale(0.75)
Index -1 → translateX(-120px) scale(0.9)
Index  0 → translateX(0)     scale(1.0)
Index +1 → translateX(120px) scale(0.9)
Index +2 → translateX(220px) scale(0.75)
```

---

## 8. Component Responsibilities

### Carousel Container

- Controls active index
- Handles input (click, drag, auto-rotate)
- Applies transforms to children

### Player Card

- Pure display component
- No carousel logic

---

## 9. Data Flow

Input:

```json
[
  { player_id, name, stats, team, platform },
  ...
]
```

State:

```id="state-model"
activeIndex: number
players: Player[]
```

---

## 10. Interaction States

### Hover (Desktop)

- Slight scale increase on hovered card
- Cursor: pointer

### Active Card

- Full interaction enabled
- Click → open player detail

### Dragging

- Cards follow pointer movement
- Snap to nearest index on release

---

## 11. Responsive Behavior

### Desktop

- Full 5-card spread visible

### Tablet

- Reduce to 3 visible cards

### Mobile

- Single card focus
- Swipe navigation
- No side stacking

---

## 12. Accessibility

- Keyboard navigation:
  - Arrow keys to rotate
- Focus state on active card
- ARIA role: `region` + `carousel`
- Announce active player change

---

## 13. Performance Considerations

- Use `transform` instead of layout properties
- Avoid re-rendering all cards
- Virtualize if roster is large
- Debounce drag events

---

## 14. Integration with Player Card

- Uses existing **PlayerCard component**
- No modification to card internals
- Carousel only controls positioning

---

## 15. Styling Alignment

Must follow brand system:

- Dark background container
- Subtle gradient or vignette
- Cards pop with contrast
- Red accents only on active/focus states

---

## 16. Use Cases

### Primary

- Roster page hero display

### Secondary

- Featured players (Home page)
- Top performers (Stats page)

---

## 17. Definition of Done

Carousel is complete when:

- Smooth rotation (no jitter)
- Works with mouse, touch, keyboard
- Active card clearly dominant
- Responsive behavior implemented
- Integrates cleanly with PlayerCard
- No performance issues with 10–20 players

---

## 18. Future Enhancements

- Infinite looping carousel
- Physics-based motion (spring)
- Player comparison mode
- Card flip animation (front/back)
- Highlight animations (hot streak, MVP)

---

## 19. Reference Implementations

- [https://codepen.io/frise/pen/mZvKpe](https://codepen.io/frise/pen/mZvKpe)
- [https://codepen.io/Nidal95/pen/RNNgWNM](https://codepen.io/Nidal95/pen/RNNgWNM)

---

If needed next:

- React + Framer Motion implementation
- Pure CSS + JS version
- Drag physics system
- Tailwind component version
