# Player Card UI Spec — EASHL Stats Website

## 1. Objective

Design and implement a **player profile card component** for the Roster page.

The card must:

- Present key player identity + performance stats
- Be visually consistent with the **dark, esports hockey brand system**
- Be reusable in:
  - Roster grid
  - Player spotlight
  - Carousel component

---

## 2. Layout Overview

![[PlayerCardBluePrint.png]]
Card is divided into **three vertical zones**:

```
[ TOP PANEL ]
A (info block) + B (profile)

[ IDENTITY ROW ]
C (platform) + D (name)

[ STATS + META PANEL ]
E–H (stats row)
I–K (meta row)
```

---

## 3. Section Breakdown

## A — Player Info Block (Top Left)

**Purpose:** Quick identity + competitive context

**Contains:**

- Player Number (H1)
- Position (H3)
- Record (W–L–OTL)
- Win %

**Layout Rules:**

- Fixed width block (left side)
- Rounded container with border
- Vertically stacked text

**Design Notes:**

- Number = largest element on card
- Position styled as pill/badge
- Record + Win% secondary text

---

## B — Profile Area (Top Right)

**Purpose:** Visual anchor

**Contains:**

- Player avatar / generated silhouette

**Layout Rules:**

- Dominant area (centered)
- Circular or masked image
- Takes majority of top panel width

**Fallback:**

- Default silhouette if no image

---

## C — Platform Logo

**Purpose:** Platform identification

**Contains:**

- PlayStation or Xbox logo

**Layout Rules:**

- Small square icon
- Left of player name
- Vertically centered with name

---

## D — Player Name

**Purpose:** Primary identity label

**Contains:**

- Gamertag / player name

**Layout Rules:**

- Large, bold text
- Left-aligned
- Truncated if overflow

**Design Notes:**

- Must be readable at a glance
- No wrapping beyond 2 lines

---

## E–H — Stats Row (Primary Stats)

**Purpose:** Quick performance snapshot

### E — Goals

### F — Assists

### G — Points Per Game

### H — Points (Featured)

**Layout Rules:**

- Horizontal row of stat cards
- Equal spacing
- Centered text

**Special Rule:**

- **H (Points) = 33% larger**
  - Larger width OR larger font
  - Visual emphasis

**Stat Card Structure:**

```
Label (small)
Value (large)
```

---

## I–K — Meta Row

**Purpose:** Supplemental identity + branding

### I — Flag

- Country flag
- Small rectangle

### J — Team Logo

- Primary team branding
- Medium size

### K — Spare Space

**K Usage Options:**

- Player role (C, A)
- Badge (MVP, Leader)
- Rank
- Future stat

**Layout Rules:**

- Three evenly spaced blocks
- Center-aligned row

## ![[PlayerCardBluePrint_2.png]]

## 4. Component Hierarchy

```
PlayerCard
 ├── TopPanel
 │    ├── InfoBlock (A)
 │    └── ProfileImage (B)
 ├── IdentityRow
 │    ├── PlatformLogo (C)
 │    └── PlayerName (D)
 ├── StatsRow
 │    ├── StatCard (E)
 │    ├── StatCard (F)
 │    ├── StatCard (G)
 │    └── StatCardFeatured (H)
 └── MetaRow
      ├── Flag (I)
      ├── TeamLogo (J)
      └── ExtraSlot (K)
```

---

## 5. Styling Rules (Critical)

Based on brand guide:

- Background: dark charcoal / black
- Cards: slightly lighter panels
- Accent: red (sparingly)
- Borders: thin, high-contrast
- Corners: rounded but not soft

**Typography:**

- Headlines: bold, condensed
- Stats: large numeric emphasis
- Labels: small, muted gray

**Spacing:**

- Generous padding
- Consistent gaps between sections

---

## 6. Interaction States

**Hover (desktop):**

- Slight scale (1.02–1.05)
- Shadow intensifies
- Border glow (red accent)

**Active / Click:**

- Opens player detail page OR modal

**Loading State:**

- Skeleton placeholders for:
  - Image
  - Stats
  - Name

---

## 7. Responsive Behavior

### Desktop

- Full layout as designed

### Tablet

- Slightly reduced spacing
- Stats row may compress

### Mobile

- Stack vertically:
  - A above B
  - Stats become 2x2 grid
  - Meta row stays horizontal

---

## 8. Data Mapping (Backend → UI)

| UI Element | Source                      |
| ---------- | --------------------------- |
| Number     | player.jerseyNumber         |
| Position   | player.position             |
| Record     | derived from games          |
| Win%       | derived                     |
| Avatar     | player.image                |
| Platform   | player.platform             |
| Name       | player.gamertag             |
| Goals      | season_stats.goals          |
| Assists    | season_stats.assists        |
| PPG        | season_stats.points / games |
| Points     | season_stats.points         |
| Flag       | player.country              |
| Team Logo  | club.logo                   |

---

## 9. Carousel Component

**Purpose:** Showcase players in motion

**Behavior:**

- Horizontal scroll OR 3D carousel
- Center card = active
- Side cards scaled down

**Features:**

- Auto-rotate (optional)
- Manual drag/scroll
- Snap-to-card

**Reference Implementations:**

- [https://codepen.io/frise/pen/mZvKpe](https://codepen.io/frise/pen/mZvKpe)
- [https://codepen.io/Nidal95/pen/RNNgWNM](https://codepen.io/Nidal95/pen/RNNgWNM)

---

## 10. Future Extensions

- Player badges (MVP, Captain)
- Animated stat transitions
- Live stat updates
- Card flip (front/back stats)
- Comparison mode (2 cards side-by-side)

---

## 11. Definition of Done

Component is complete when:

- All sections A–K render correctly
- Responsive behavior works
- Data binds cleanly from API
- Matches brand style (dark, high-contrast, aggressive)
- Reusable across pages
- Carousel integration works without layout break

---

If needed, next step is:

- React/Tailwind component
- or full CSS + HTML implementation
- or animated carousel version
