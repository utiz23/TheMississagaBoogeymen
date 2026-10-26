# Boogeymen Design System

Design system for **The Mississauga Boogeymen** — an EASHL hockey e‑sports club. The system powers the team's stats / analytics website (`apps/web` in the source repo): a sleek, dark, broadcast‑inspired surface for tracking match results, recent form, scoring leaders, division standing, and per‑player game logs.

The visual identity is **dark, sharp, athletic**. The voice is **terse and operational** — labels, abbreviations, scoreboard tickers. There is no marketing‑speak. The accent color is a single dangerous red that earns its presence through scarcity.

## Sources

| Source                                           | Where                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- |
| GitHub repo                                      | `utiz23/TheMississagaBoogeymen` (default branch `main`)        |
| Frontend code                                    | `apps/web/` (Next.js 15 App Router, Tailwind CSS 4, shadcn/ui) |
| Brand mark (skull + cowboy hat + crossed sticks) | `uploads/spd_logo_final_*.png` (uploaded by user)              |
| In‑repo crest used in app                        | `apps/web/public/images/bgm-logo.png`                          |

The skill consumer may not have access to the GitHub repo or the original uploads — the relevant pieces are mirrored into this project. Logos live in `assets/`. The base layer of CSS variables matches `apps/web/src/app/globals.css` 1:1 so designs are pin‑compatible with the production site.

## At a glance

- **Team:** Mississauga Boogeymen (also stylized as **SPEDS** in the secondary lockup)
- **EA Club ID:** `19224` · **Platform:** `common-gen5`
- **Pages:** Home · `/games` · `/games/[id]` · `/roster` · `/roster/[id]` · `/stats`
- **Game titles:** NHL 25 / 26 / 27 (the data primary key)
- **Game modes:** `6s`, `3s`, plus all‑modes EA‑official totals

## Index

```
Boogeymen Design System/
├─ README.md                ← you are here
├─ SKILL.md                 ← Agent‑Skills entry point
├─ colors_and_type.css      ← all design tokens (drop into any HTML)
├─ assets/                  ← logos & marks
├─ fonts/                   ← (uses Google Fonts — Barlow / Barlow Semi Condensed)
├─ preview/                 ← design system cards (registered for review)
└─ ui_kits/
   └─ stats-site/           ← the Boogeymen stats website UI kit
      ├─ README.md
      ├─ index.html         ← interactive click‑thru of Home / Games / Roster / Player / Stats
      └─ *.jsx              ← components (TopNav, ScoreboardHero, ScoreCard, etc.)
```

---

## CONTENT FUNDAMENTALS

The voice is the voice of a **game‑night broadcast lower‑third**, not a SaaS dashboard. Words are short, specific, and operational.

### Casing

- **UPPERCASE** for every label, tab, section header, pill, and stat key (`SCORING LEADERS`, `LATEST RESULT`, `WIN`, `OTL`, `DNF`, `SOG`, `TOA`, `FO%`, `DtW`, `GF`, `GA`).
- Wide tracking on uppercase labels — typically `tracking-[0.15em]` to `tracking-[0.28em]`. The wider the tracking, the smaller and more peripheral the label.
- Title Case is rare; reserved for occasional sentence fragments under a label (e.g. _"local · 6s only"_).
- Body copy and footnotes are lowercase or sentence case; small and dim (`text-zinc-500`/`600`).

### Tone

- **Terse, factual, present tense.** "78.3% Win%" — not "Wow, what a season!"
- **No first or second person.** No "you", "your", "we". Subjects are the team, the player, or the stat.
- **Empty states are flat statements**, not apologies: _"No 6s games recorded yet."_ · _"Official record not yet available"_ · _"Unable to load data right now."_
- **Provenance is always labelled.** Numbers carry their source as a tiny dim tag: `EA official` · `local · 6s only` · `EA season totals` · `local tracked 3s`.
- **Comparative copy hugs the data**, not the prose. "Boogeymen – Opp" appears _next to_ the split stat, not in a paragraph.

### Vocabulary

- Hockey/EASHL canon, never softened: `OTL`, `GAA`, `SV%`, `SOG`, `TOA`, `FO%`, `Hits`, `GF`, `GA`, `GP`.
- Result words are always one syllable / one acronym: **WIN · LOSS · OTL · DNF**.
- Side labels: `BGM` (us, abbreviation) vs the opponent's three‑letter abbrev. Never "Home / Away" — this is a club tracker, not a league site.
- The team is **Boogeymen**, full word, in headers and identity blocks. Never "the Boogeymen" or "Boogeymen Hockey Club".

### Emoji & ornament

- **No emoji.** Anywhere. The brand has zero room for them.
- No exclamation marks. No em‑dash flourishes in copy (em‑dashes appear only as the `—` placeholder for missing numeric data).
- Punctuation in stat strings is the en‑dash for splits (`12 – 9`) and the bullet for provenance (`local · 3s only`).

### Examples lifted from the live frontend

- Hero label: `LATEST RESULT` · `Featured Scoreboard` · `Final`
- Scoring panel: `SCORING LEADERS` · `Points` · `Goals` · `View all stats →`
- Record strip: `W 14   L 6   OTL 2` · `70.0% Win%` · `22 GP` · `EA official`
- Filters: `All / 6s / 3s` (segmented uppercase pills)
- Empty: _"No game titles are configured yet."_ · _"No games recorded for NHL 26 yet."_

---

## VISUAL FOUNDATIONS

The frontend is a **broadcast strip** aesthetic: nearly‑black backgrounds, paper‑thin borders, controlled red accent, subtle radial glows where energy belongs (top of hero, behind a #1 player, under a leading score). Composition is rectangular and horizontal. Cards are flat panels with hairline borders, **never** softly rounded with drop shadows.

### Color

- **Background:** `#09090b` (zinc‑950) — true near‑black so the red accent reads at full intensity.
- **Surfaces:** `#18181b` (`--color-surface`) and `#1f1f22` (`--color-surface-raised`). Used as panel fills, never as page background.
- **Borders:** `#27272a` (`--color-border`) is the workhorse — every panel, every divider. `#1f1f22` is the subtle variant for inner dividers (`divide-zinc-800/60`).
- **Accent (red):** `#e11d48` (rose‑600). One color, used for: active nav indicator (under‑bar), primary numbers in record strips, the WIN side of a hero score, the gradient strip on top of the leaders panel, focus rings on filter pills, the inset left highlight on the #1 leaderboard row.
- **Result palette:** `WIN` emerald · `LOSS` rose · `OTL` amber · `DNF` zinc. Used as low‑opacity bg + matching border + saturated text — never as a card fill at full strength.
- **Text:**
  - `#fafafa` (zinc‑50) — primary, headlines, lead numbers
  - `#e4e4e7` (zinc‑200) — secondary identity text
  - `#a1a1aa` (zinc‑400) — supporting numbers, win%
  - `#71717a` (zinc‑500) — uppercase section labels
  - `#52525b` (zinc‑600) — tertiary metadata, timestamps, provenance, the en‑dash separator
- **Imagery vibe:** there is essentially no photographic imagery in the product. The mascot is a vector mark on a charcoal field (white skull, red bandana, charcoal hat with a red rim, gunmetal hockey sticks). Imagery is **cool, almost monochromatic**, with red as the only chromatic event.

### Typography

- **Sans (body):** **Barlow** — variable, 400/500/600/700.
- **Display / condensed (everything that wants to feel athletic):** **Barlow Semi Condensed** — 400/500/600/700/**900**. Used for: nav links, every uppercase label, every score, every stat number, every player name. The whole product looks "fast" because almost every interface‑critical character is `font-condensed font-bold uppercase`.
- **Numbers** always use `font-variant-numeric: tabular-nums`. Score, record, leaderboard, table — all tabular.
- **Hierarchy:**
  - **Score (hero):** 5.75rem black tabular condensed.
  - **Score (card):** 3rem (`text-5xl`) black tabular condensed.
  - **Player names (hero/leaders):** 3rem (`text-5xl`) black uppercase.
  - **H1 page header:** `text-2xl` semibold uppercase wide tracking.
  - **Section header:** `text-xs/sm` semibold uppercase, tracking‑widest, zinc‑500.
  - **Stat label:** `10–11px` semibold uppercase, tracking `0.16–0.22em`, zinc‑600.
- **Mono is not used.** The product avoids developer aesthetics; it leans into broadcast ones.

### Spacing rhythm

- **Page gutter:** `px-4` (mobile) / `max-w-screen-xl` container, `py-8` between top nav and content.
- **Section gap:** `space-y-8` (32px) between top‑level page sections.
- **Inside a section:** `mb-2`/`mb-3` between the section label and its module.
- **Card interior:** `px-5 py-3` (compact rows) up to `px-8 py-10` (hero score module).
- **Stat groups:** `gap-x-6 gap-y-2` for inline runs of label+value pairs.
- **The grid never uses 8px increments alone** — the system relies more on Tailwind's 4px scale (1, 2, 3, 4, 5, 6, 8, 10) with 5/8 doing the heavy lifting for card padding.

### Background & decoration

- **No full‑bleed photography. No hand‑drawn illustration. No repeating pattern.**
- The only decoration the system uses is the **broadcast panel**: a hairline border + a _very_ subtle red radial in the top region + a vertical zinc gradient. See `.broadcast-panel` / `.broadcast-panel-soft`.
- A 1‑px **gradient strip** (`from red-900 via red-600 to red-900`) is laid on top of hero panels and the leaders module — it reads as a TV ticker accent, not as a header.
- A 1‑px horizontal **dividing line** (`bg-gradient-to-r from-transparent via-accent/40 to-transparent`) sits at the top of featured player blocks. Otherwise dividers are flat 1px hairlines.

### Borders, radii, shadow

- **Borders are the structural element.** `border` (1px) + `border-zinc-800` (or `border-accent/15`, `border-emerald-500/40` for state). Borders are present on _every_ surface; "borderless" is not in the visual vocabulary.
- **Corner radius is restrained.**
  - Default panels: `rounded-none` (sharp). **The brand reads as fast because of this** — no soft cards.
  - Pills (result, mode filter, position): `rounded-full` for the WIN/LOSS pill, `rounded-sm` for inline rows.
  - Avatars: `rounded-full` (circular crest holder).
  - Tiny chips: `rounded-sm`.
- **Shadows are essentially absent.** The system uses `box-shadow: inset` for the leader's red left edge, and `drop-shadow-[0_0_14px_rgba(225,29,72,0.18)]` only on the marquee leader stat (a soft red glow). External shadows on cards: **never**.

### Transparency & blur

- **Top nav** uses `bg-surface/95 backdrop-blur-sm` so it sits cleanly over scrolling content. This is the only place blur is used.
- **Background pulses** (radial reds) sit at ≤16% opacity. Anything stronger would read as gamer‑gradient slop and is forbidden.
- Pills and result tints use `/10` to `/40` opacity backgrounds plus a `/40` to `/60` border to stay sharp at small sizes.

### Animation, hover & press

- **Hover (interactive panel):** border lightens (`hover:border-zinc-700`), background steps up to `hover:bg-surface-raised`, and on score cards the whole tile lifts `hover:-translate-y-0.5`. Transition: `transition-[border-color,transform,background-color]`. Default duration / ease — no fancy curves.
- **Hover (text link):** color steps from `text-zinc-400` → `text-zinc-100` (or to `text-accent` on a featured player name).
- **Press / active:** active nav link gets a 2‑px **accent under‑bar** (`bg-accent`) — no color shift on the label itself. Filter pills go from a transparent border to `border-accent bg-accent/10 text-accent`.
- **No bounce, no spring, no shimmer, no skeleton wave.** Loading states are flat `animate-pulse rounded-sm bg-zinc-800` boxes. Page‑level loading uses a tiny set of shapes — no spinners, no progress bars.
- **Scrollbars** are 6px wide, dark, with a `#27272a` thumb that lifts to `#52525b` on hover. They are part of the look, not a thing to hide.

### Layout rules

- **Sticky top nav.** Always. `border-b border-accent/15` is the brand's most consistent fingerprint — that 1‑px subtly‑red rule under the chrome.
- **Horizontal flow is the rule.** Heroes are 3‑column grids (us / score / them). Leaders are 4‑column grids (hero / list / hero / list). Cards stack vertically only on mobile.
- **Never put a UI element in a soft drop‑shadowed floating card.** The system has no floating elements.

### Iconography vibe

- See **ICONOGRAPHY** below. Short version: the live app uses **lucide-react** at 1.5px stroke; brand assets are vector PNGs.

---

## ICONOGRAPHY

### What's used in production

- The frontend uses **`lucide-react`** as its icon library — installed via the shadcn/ui generator. Stroke icons, ~1.5px weight, default 16–20px sized inline with text. Every icon is a glyph, never a colored emoji.
- Result pills use **letter glyphs** (`W`, `L`, `OT`, `—`) inside a 6×8 chip rather than icons. This is intentional — at the scoreboard density the system runs at, letters scan faster than pictograms.
- The **opponent crest** is real EA artwork pulled from the API (`crestAssetId`); it falls back gracefully to a 2‑letter abbreviation set in the same condensed black uppercase as everything else.
- The **brand crest** (`/images/bgm-logo.png`, mirrored to `assets/bgm-logo.png`) sits in the top‑left of the nav and inside the home‑page latest‑result hero.

### Substitutions / loading

- For HTML mocks, link **Lucide icons via CDN**: `https://unpkg.com/lucide-static@latest/icons/<name>.svg` or the CDN script. Stick to outline icons at 18–20px, color `currentColor` so they pick up the surrounding zinc.
- **Emoji are not used.** Anywhere. Don't try to substitute.
- **Unicode glyphs** are used sparingly: en‑dash `–` between split stats, em‑dash `—` for missing data, `·` middot for provenance, `→` arrow on "view all" CTAs.
- **No SVG illustration.** The "player silhouette" placeholder in the live app is a flat vector shape rendered in `text-zinc-700` — that's the closest thing to an illustration in the system.

### Logo usage

- **Primary mark (preferred for digital):** `assets/bgm-logo.png` — the cleaned skull‑hat‑sticks crest used as the nav glyph. Use against `#09090b` backgrounds.
- **Brand mark on charcoal:** `assets/boogeymen-mark-on-charcoal.png` — same crest sitting on the brand charcoal field. Use as a hero/identity asset.
- **Brand mark cutout:** `assets/boogeymen-mark.png` — the crest with surrounding context for printing/wordmark assemblies.
- **SPEDS lockup:** `assets/speds-wordmark.png` and `…on-charcoal.png` — the secondary "Mississauga SPEDS" badge lockup. Use as a full team identity moment (not as nav glyph). Maintain at least 24px of clear space around it.
- Never recolor the marks. Never place the red‑bandana mark on a red field. Never set the wordmark on a busy photographic background — there are no photographic backgrounds in this system.
