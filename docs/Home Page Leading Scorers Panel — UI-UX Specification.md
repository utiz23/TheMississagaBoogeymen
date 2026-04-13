
# Home Page Leading Scorers Panel — UI/UX Specification

## 1. Objective

Create a **homepage stats showcase panel** that highlights the club’s top individual performers.

Primary goals:

- Show the most important player leaderboards at a glance
    
- Give the homepage a strong statistical identity
    
- Surface standout players without forcing the user to visit the full Roster or Stats page
    

This component is meant to function as a **featured summary block**, not a full stats table.

---

## 2. Core Concept

The panel presents two featured statistical categories side by side.

In the current mockup these are:

- **Points**
    
- **Goals**
    

Each side contains:

- One featured player
    
- That player’s total in the selected category
    
- A ranked top-10 leaderboard for the same stat
    

This creates a hybrid between:

- a **leader spotlight**
    
- and a **compact leaderboard panel**
    

---

## 3. Primary Purpose

This panel exists to answer three questions quickly:

1. Who leads the team in a major stat
    
2. What is that leader’s total
    
3. Who else is near the top
    

It is designed for:

- Homepage engagement
    
- Fast stat recognition
    
- Visual balance beside other homepage panels like recent score cards and player carousels
    

---

## 4. Layout Overview

The component is a wide rectangular content panel with two mirrored stat columns.

```text
[ Panel Title ]

[ Left Stat Feature ]     [ Right Stat Feature ]
[ Featured Leader ]       [ Featured Leader ]
[ Top 10 List ]           [ Top 10 List ]
```

Suggested default use:

- Left column = **Points**
    
- Right column = **Goals**
    

Future versions may allow:

- Assists
    
- Save Percentage
    
- Wins
    
- Plus/Minus
    
- Hits
    
- PPG
    

---

## 5. Component Structure

```text
LeadingScorersPanel
 ├── PanelHeader
 └── StatsColumns
      ├── StatColumn
      │    ├── StatTitle
      │    ├── FeaturedPlayerBlock
      │    └── LeaderboardList
      └── StatColumn
           ├── StatTitle
           ├── FeaturedPlayerBlock
           └── LeaderboardList
```

---

## 6. Section Breakdown

## PanelHeader

**Purpose:** Identify the section clearly

**Contains:**

- Title: `Stats`
    

**Layout Rules:**

- Positioned top-left inside the panel
    
- Large but not oversized
    
- Consistent with homepage section headers
    

---

## StatColumn

Each column represents one stat category.

**Contains:**

- Category heading
    
- Featured player summary
    
- Ranked leaderboard list
    

**Layout Rules:**

- Two equal-width columns
    
- Balanced spacing across the full width
    
- Each column should feel self-contained but visually matched
    

---

## StatTitle

**Purpose:** Label the stat category

**Examples:**

- Points
    
- Goals
    

**Layout Rules:**

- Small-to-medium heading
    
- Positioned above the featured player block
    
- Left-aligned within the stat column
    

---

## FeaturedPlayerBlock

**Purpose:** Spotlight the player currently leading the selected stat

**Contains:**

- Profile image or silhouette
    
- Player name
    
- Position badge
    
- Jersey number
    
- Stat label
    
- Large stat value
    

**Hierarchy:**

```text
Profile Image
Player Name
Position + Number
Stat Label
Large Stat Total
```

**Design Notes:**

- This block is the visual anchor of the column
    
- It should be much easier to scan than the leaderboard list
    
- The stat value should be the largest text element in the column
    

---

## LeaderboardList

**Purpose:** Show the rest of the top performers in ranking order

**Contains per row:**

- Rank number
    
- Player name
    
- Stat total
    

**Example row:**

```text
1. Player Name        123
```

**Layout Rules:**

- Vertical stack of ranked rows
    
- Top 10 by default
    
- All rows aligned consistently
    
- Names left-aligned, values right-aligned
    

---

## 7. Visual Hierarchy

Priority order inside each column:

1. Featured player stat total
    
2. Featured player name
    
3. Stat category title
    
4. Ranked list rows
    
5. Position badge and jersey number
    

This ensures the user notices:

- the category
    
- the leader
    
- the total  
    before reading the full ranking list.
    

---

## 8. Styling Rules

This panel must follow the existing site brand direction:

- dark background
    
- light text
    
- red accent lines
    
- aggressive but clean esports-hockey styling
    

### Background

- Deep charcoal or near-black panel
    
- Slight gradient allowed
    
- No busy imagery behind text
    

### Text

- White or off-white for primary text
    
- Gray for supporting labels
    
- Red reserved for outlines and accents
    

### Leaderboard Rows

- Thin red outline
    
- Rounded corners
    
- Dark row background
    
- Consistent row height
    

### Featured Player

- Slightly brighter or more open spacing than leaderboard rows
    
- Large stat number in white
    
- Position badge styled as a small pill
    

---

## 9. Data Mapping

|UI Element|Source|
|---|---|
|Stat title|configured category|
|Featured player image|player.image|
|Featured player name|player.gamertag / display_name|
|Position|player.position|
|Jersey number|player.jersey_number|
|Featured stat value|player.stat_total|
|Leaderboard rank|computed from team roster stats|
|Leaderboard name|player.gamertag|
|Leaderboard value|stat total|

---

## 10. Sorting Rules

Each stat column must be driven by sorted player data.

### Points Column

Sort by:

1. Points descending
    
2. Games played minimum threshold if needed
    
3. Goals descending as tiebreaker
    
4. Player name ascending as final tiebreaker
    

### Goals Column

Sort by:

1. Goals descending
    
2. Points descending as tiebreaker
    
3. Games played ascending or name ascending depending on desired logic
    

The top-ranked player becomes the featured player for that column.

---

## 11. Filtering Rules

Default state:

- Current season only
    
- Active roster only
    

Optional future filters:

- All-time
    
- Playoffs
    
- Private matches
    
- Minimum games played
    
- Skaters only
    
- Goalies only for goalie-specific stat panels
    

---

## 12. Interaction Behavior

### Featured Player Click

- Opens player detail page
    

### Leaderboard Row Click

- Opens corresponding player detail page
    

### Hover State

- Slight brightness or border emphasis
    
- Cursor changes to pointer
    

### Optional Future Interaction

- Switch stat category from dropdown or tab control
    
- Animate between Points, Goals, Assists, PPG, etc.
    

---

## 13. Responsive Behavior

### Desktop

- Two side-by-side stat columns
    
- Full leaderboard visible
    
- Featured player block centered within each column
    

### Tablet

- Columns remain side by side if space allows
    
- Reduce leaderboard width and spacing
    

### Mobile

- Stack columns vertically
    
- One stat category above the other
    
- Leaderboard may reduce from top 10 to top 5
    
- Featured stat remains large and centered
    

---

## 14. Spacing and Proportions

Suggested internal proportions per stat column:

- Top: category title
    
- Middle-left or centered: featured player
    
- Right or adjacent: leaderboard list
    

Important rule:

- The featured player block should not compete visually with the list
    
- The list should feel supplemental to the spotlight player
    

---

## 15. Accessibility

- All player names must meet contrast requirements
    
- Clickable rows should have keyboard focus states
    
- Use semantic list markup for leaderboard rows
    
- Use descriptive labels for screen readers, such as:
    
    - “Points leader, Player Name, 123 points”
        
    - “Rank 2, Player Name, 98 points”
        

---

## 16. Reusability

This component should be reusable for:

- Homepage featured stats
    
- Club stats page sidebar
    
- Team overview dashboard
    
- Seasonal recap page
    

Possible alternate configurations:

- `Points + Goals`
    
- `Assists + PPG`
    
- `Wins + Save Percentage`
    
- `Hits + Plus/Minus`
    

---

## 17. Edge Cases

Handle the following cleanly:

### Missing player image

- Use silhouette placeholder
    

### Duplicate stat totals

- Preserve stable rank order using tiebreak rules
    

### Fewer than 10 players

- Render only available rows
    

### Long gamertags

- Truncate with ellipsis
    

### Missing jersey number

- Hide number instead of showing placeholder text
    

### Missing position

- Hide badge or use generic role marker
    

---

## 18. Definition of Done

This component is complete when:

- Two stat categories render correctly
    
- Each category shows one featured leader
    
- Each category shows a ranked leaderboard list
    
- Data is accurate and sorted properly
    
- Clicking players routes to their detail pages
    
- Layout remains clean across desktop, tablet, and mobile
    
- Styling matches the site’s dark esports-hockey branding
    

---

## 19. Future Enhancements

Possible future upgrades:

- Toggle between multiple stat categories
    
- Animated transitions when categories change
    
- Team color glow behind featured player
    
- Mini headshot frame using team branding
    
- Expand/collapse leaderboard
    
- “View full stats” CTA button
    
- Include trend indicator such as:
    
    - `+5 in last 3 games`
        
    - `hot streak`
        
    - `last game: 2G 1A`
        

---

## 20. Design Intent Summary

This panel should feel like:

> A compact team leaderboard display built for quick recognition of standout players.

It is not a full analytics view.  
It is not a dense spreadsheet.  
It is a **homepage spotlight section** that makes top performers immediately visible.

---

## 21. Suggested Default Content Configuration

For homepage launch version:

### Left Column

- **Points**
    
- Featured player = team points leader
    
- Top 10 points leaderboard
    

### Right Column

- **Goals**
    
- Featured player = team goals leader
    
- Top 10 goals leaderboard
    

This is the cleanest and most recognizable starting configuration.

---

If you want, I can consolidate all of these homepage sections into one **single home-page.md master layout spec**.