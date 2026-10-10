# Discord Lineup Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Discord post's star-cards image with BGM's lineup for that game, every player on a card showing that game's stats.

**Architecture:** The match page's lineup logic (which rows, which slot, which stat line) moves into shared pure helpers that `/games/[id]`, its lineup component and the Discord loader all call. A new pure `cardForGame` fills the existing `CardViewModel` with per-game values, so the card component is untouched. The hidden page `/internal/discord/stars/[matchId]` becomes `/internal/discord/lineup/[matchId]` (two-row grid); the JSON contract swaps `cardPlayerIds` for `lineupCardCount`.

**Tech Stack:** TypeScript strict, Next.js 15 App Router, `node:test` with type stripping, Playwright Chromium, existing `@eanhl/db` contract.

**Spec:** `docs/superpowers/specs/2026-10-10-discord-lineup-image-design.md` (amends `docs/superpowers/specs/2026-10-10-discord-game-results-design.md`)

## Global Constraints

- The card component (`components/cards/player-card.tsx`, `card-front.tsx`) is **not modified**. Site cards must not change.
- The image's lineup must be the match page's lineup: one shared implementation, never a copy.
- Skater stats `G, A, +/-, PTS` (PTS = G + A, +/- signed: `+2`, `-1`, `0`); goalie `SA, SV, GA, SV%` (GA = SA − SV; SV% via `formatSavePct` from `lib/format.ts`, `—` when SA is 0 or null).
- `record` = `GS <score.toFixed(2)>`; `winPct` = `⭐ <1st|2nd|3rd> star` for a star, else `''`.
- Guests: name = gamertag, theme `away`, tier 1, level 1, no badge, no flag, no platform.
- Display order: 6s `LW, C, RW, LD, G, RD` (3 columns); 3s `W, C, D, G` (2 columns).
- DNF: no image, `lineupCardCount = 0`.
- No migration. No worker change. Poster rules (settle, claim, no double post, dry run) unchanged.
- Gates: typecheck, unit tests, `pnpm format`. Rebuild `@eanhl/db` after editing it. Do not run `pnpm --filter web build` while a dev server is up.

## Review Focus

1. A 6s game where a skater quit and was not replaced (5 BGM rows) — the image still shows 6 slots, the missing one as an empty outline. Pinned in Task 2 (`lineupSlots` empty slot) and Task 3 (outline label).
2. OCR lobby gamertag that differs from EA's by spaces/case (`RAIDERS G7` vs `RAIDERSG7`) — must still match its stat line, as on the match page. Pinned in Task 2 (`findStat` by tag).
3. A goalie who faced 0 shots (early DNF or bot game) — SV% must read `—`, not `NaN`/`.000`. Pinned in Task 3.
4. A guest with no player id (unresolved gamertag) — still gets a card with no profile link. Pinned in Task 3.
5. The 6s two-row image is taller than the old 700 px viewport — the screenshot must contain both rows. Pinned in Task 5 (viewport 1000×1100) and Task 6 visual check.

---

### Task 1: Contract — `lineupCardCount` replaces `cardPlayerIds`

**Files:**

- Modify: `packages/db/src/discord/contract.ts`
- Modify: `packages/db/src/discord/contract.test.ts`

**Interfaces:**

- Produces: `DiscordGameResult.lineupCardCount: number` (integer ≥ 0); `cardPlayerIds` removed.

- [ ] **Step 1: Update the test first**

In `contract.test.ts`: in `valid`, replace `cardPlayerIds: [7],` with `lineupCardCount: 6,`. Replace the test `'rejects a card id that is not one of the member stars'` with:

```ts
void test('rejects a negative or fractional lineupCardCount', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, lineupCardCount: -1 }), /lineupCardCount/)
  assert.throws(() => parseDiscordGameResult({ ...valid, lineupCardCount: 1.5 }), /lineupCardCount/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/discord/contract.test.js`
Expected: build FAILS (`lineupCardCount` not in `DiscordGameResult`).

- [ ] **Step 3: Implement**

In `contract.ts`: replace the `cardPlayerIds` field doc + declaration with

```ts
/** Cards in the lineup image (BGM players placed in a slot). 0 ⇒ no image. */
lineupCardCount: number
```

In `parseDiscordGameResult`, delete the `cardsRaw` / `cardPlayerIds` / `memberIds` block and add before the `return`:

```ts
const lineupCardCount = int(o['lineupCardCount'], 'lineupCardCount')
if (lineupCardCount < 0) fail('lineupCardCount', 'is negative')
```

and in the returned object replace `cardPlayerIds,` with `lineupCardCount,`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/discord/contract.test.js`
Expected: PASS, 5 tests. (Consumers in web/discord will not typecheck until Tasks 4–5; that is expected.)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/db/src/discord
git commit -m "feat(db): Discord contract carries lineupCardCount instead of cardPlayerIds"
```

---

### Task 2: Shared lineup helpers (match page + Discord)

**Files:**

- Create: `apps/web/src/lib/lineup-slots.ts`
- Test: `apps/web/src/lib/lineup-slots.test.ts`
- Modify: `apps/web/src/components/matches/lineup/lineup-module.tsx` (delete local `normalizeTag`, `findStat`, `isRenderable`, `JUNK_GAMERTAG_TOKENS`, `bucketByPosition`; import them)
- Modify: `apps/web/src/lib/match-recap.ts` (add `lineupsForMatch`)
- Modify: `apps/web/src/app/games/[id]/page.tsx:176-187` (use `lineupsForMatch`)
- Test: `apps/web/src/lib/match-recap.test.ts` (append)

**Interfaces:**

- Produces (`lib/lineup-slots.ts`, no `@/` imports):
  - `normalizeLineupTag(tag: string): string`
  - `findStat<S extends { playerId?: number | null; gamertag: string }>(stats: S[], team: 'bgm' | 'opp', row: LineupRow): S | null`
  - `bucketByPosition(rows: LineupRow[], variant: 'ocr' | 'boxScore', ladder: readonly LineupPositionKey[]): Map<LineupPositionKey, LineupRow>`
  - `interface LineupSlot<S> { position: LineupPositionKey; row: LineupRow | null; stat: S | null }`
  - `lineupSlots<S>(rows, variant, ladder, stats: S[]): LineupSlot<S>[]` — in ladder order
  - `discordDisplayOrder(gameMode: GameMode | null): readonly LineupPositionKey[]` — 6s `['LW','C','RW','LD','G','RD']`, 3s `['W','C','D','G']`
- Produces (`lib/match-recap.ts`): `lineupsForMatch(match: Pick<Match, 'playedAt' | 'gameMode'>, bgmStats: PlayerStat[], oppStats: OpponentPlayerStat[], lineups: { bgm: LineupRow[]; opponent: LineupRow[] }): { variant: 'ocr' | 'boxScore'; bgm: LineupRow[]; opponent: LineupRow[] }`

- [ ] **Step 1: Snapshot the match page before the refactor**

With the dev server running against `eanhl_preview` (see Task 6 Step 1 for the start command), save the rendered text of a 6s game and a 3s game:

```bash
SP=<session scratchpad>
for M in <6s id> <3s id>; do curl -s localhost:3000/games/$M | sed 's/<script.*<\/script>//g' > $SP/before-$M.html; done
```

(Find ids: `select id, game_mode from matches where game_mode='3s' order by played_at desc limit 1` on `eanhl_preview`.)

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/lineup-slots.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { LineupRow } from '@eanhl/db/queries'
import {
  bucketByPosition,
  discordDisplayOrder,
  findStat,
  lineupSlots,
  normalizeLineupTag,
} from './lineup-slots.ts'

const row = (over: Partial<LineupRow>): LineupRow =>
  ({
    position: null,
    gamertagSnapshot: null,
    buildClass: null,
    buildClassCanonical: null,
    playerNumber: null,
    xFactors: [],
    player: null,
    ...over,
  }) as unknown as LineupRow

const stats = [
  { playerId: 1, gamertag: 'RAIDERS G7' },
  { playerId: 2, gamertag: 'Silky' },
  { playerId: null, gamertag: 'Guesty' },
]

void test('normalizeLineupTag strips spaces and case', () => {
  assert.equal(normalizeLineupTag('RAIDERS G7'), 'raidersg7')
})

void test('findStat: BGM rows match by player id first, then by normalized tag', () => {
  assert.equal(findStat(stats, 'bgm', row({ player: { id: 2, gamertag: 'x' } }))?.gamertag, 'Silky')
  assert.equal(findStat(stats, 'bgm', row({ gamertagSnapshot: 'RAIDERSG7' }))?.playerId, 1)
  assert.equal(findStat(stats, 'opp', row({ player: { id: 2, gamertag: 'nobody' } })), null)
  assert.equal(findStat(stats, 'bgm', row({})), null)
})

void test('bucketByPosition: first row per slot wins; OCR noise rows are dropped; box-score rows kept', () => {
  const ladder = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const
  const ocr = bucketByPosition(
    [
      row({ position: 'C', gamertagSnapshot: 'A', playerNumber: 9 }),
      row({ position: 'C', gamertagSnapshot: 'B', playerNumber: 10 }),
      row({ position: 'LW', gamertagSnapshot: 'cpu', playerNumber: 1 }),
      row({ position: 'RW', gamertagSnapshot: 'Bare' }),
    ],
    'ocr',
    ladder,
  )
  assert.equal(ocr.get('C')?.gamertagSnapshot, 'A')
  assert.equal(ocr.has('LW'), false)
  assert.equal(ocr.has('RW'), false)
  const box = bucketByPosition(
    [row({ position: 'RW', gamertagSnapshot: 'Bare' })],
    'boxScore',
    ladder,
  )
  assert.equal(box.get('RW')?.gamertagSnapshot, 'Bare')
})

void test('lineupSlots: one slot per ladder position, empty when nobody played it', () => {
  const ladder = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const
  const slots = lineupSlots(
    [
      row({ position: 'C', gamertagSnapshot: 'Silky' }),
      row({ position: 'G', gamertagSnapshot: 'Guesty' }),
    ],
    'boxScore',
    ladder,
    stats,
  )
  assert.deepEqual(
    slots.map((s) => s.position),
    [...ladder],
  )
  assert.equal(slots[0]?.stat?.playerId, 2)
  assert.equal(slots[1]?.row, null)
  assert.equal(slots[5]?.stat?.gamertag, 'Guesty')
})

void test('discordDisplayOrder: two rows, goalie centred under 6s', () => {
  assert.deepEqual(discordDisplayOrder('6s'), ['LW', 'C', 'RW', 'LD', 'G', 'RD'])
  assert.deepEqual(discordDisplayOrder('3s'), ['W', 'C', 'D', 'G'])
  assert.deepEqual(discordDisplayOrder(null), ['LW', 'C', 'RW', 'LD', 'G', 'RD'])
})
```

Append to `apps/web/src/lib/match-recap.test.ts` (add `lineupsForMatch` to the import):

```ts
void test('lineupsForMatch: no OCR rows ⇒ box-score lineup', () => {
  const r = lineupsForMatch({ playedAt: new Date(0), gameMode: '6s' }, [], [], {
    bgm: [],
    opponent: [],
  })
  assert.equal(r.variant, 'boxScore')
  assert.deepEqual(r.bgm, [])
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/web && node --test src/lib/lineup-slots.test.ts src/lib/match-recap.test.ts`
Expected: FAIL — `./lineup-slots.ts` not found; `lineupsForMatch` not exported.

- [ ] **Step 4: Implement `lib/lineup-slots.ts`**

Move the bodies of `normalizeTag`, `findStat`, `JUNK_GAMERTAG_TOKENS`, `isRenderable` and `bucketByPosition` out of `lineup-module.tsx` **verbatim** (renaming `normalizeTag` → `normalizeLineupTag`, making `findStat` generic over `S extends { playerId?: number | null; gamertag: string }` and `team: 'bgm' | 'opp'`), keeping their doc comments, then add:

```ts
import type { LineupRow } from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db/schema'
import type { LineupPositionKey } from './lineup-shape.ts'

// …moved helpers (exported)…

export interface LineupSlot<S> {
  position: LineupPositionKey
  row: LineupRow | null
  stat: S | null
}

/** One slot per ladder position, in ladder order — the match page's lineup. */
export function lineupSlots<S extends { playerId?: number | null; gamertag: string }>(
  rows: LineupRow[],
  variant: 'ocr' | 'boxScore',
  ladder: readonly LineupPositionKey[],
  stats: S[],
): LineupSlot<S>[] {
  const byPos = bucketByPosition(rows, variant, ladder)
  return ladder.map((position) => {
    const row = byPos.get(position) ?? null
    return { position, row, stat: row ? findStat(stats, 'bgm', row) : null }
  })
}

const DISPLAY_6S: readonly LineupPositionKey[] = ['LW', 'C', 'RW', 'LD', 'G', 'RD']
const DISPLAY_3S: readonly LineupPositionKey[] = ['W', 'C', 'D', 'G']

/** The Discord image's two-row order (forwards over defence, goalie in the middle). */
export function discordDisplayOrder(gameMode: GameMode | null): readonly LineupPositionKey[] {
  return gameMode === '3s' ? DISPLAY_3S : DISPLAY_6S
}
```

In `lineup-module.tsx`, delete the moved helpers and add `import { bucketByPosition, findStat } from '@/lib/lineup-slots'`. If the module still needs a tag normalizer elsewhere, import `normalizeLineupTag`. `findStat(activeStats, team, row)` keeps its call shape (`TeamKey` is `'bgm' | 'opp'`; if not, widen the generic's `team` param to `TeamKey`'s union).

In `lib/match-recap.ts` (it already imports from `./lineup-shape.ts`; add `rekeyLineupToLadder` to that import):

```ts
/**
 * The match page's lineup, both sides: OCR lobby slots when any OCR lineup
 * exists (re-keyed onto the ladder for 3s), else box-score positions. The
 * page and the Discord lineup image both call this.
 */
export function lineupsForMatch(
  match: Pick<Match, 'playedAt' | 'gameMode'>,
  bgmStats: PlayerStat[],
  oppStats: OpponentPlayerStat[],
  lineups: { bgm: LineupRow[]; opponent: LineupRow[] },
): { variant: 'ocr' | 'boxScore'; bgm: LineupRow[]; opponent: LineupRow[] } {
  const hasOcr = lineups.bgm.length > 0 || lineups.opponent.length > 0
  if (hasOcr) {
    return {
      variant: 'ocr',
      bgm: rekeyLineupToLadder(lineups.bgm, bgmStats, match.gameMode, 'bgm'),
      opponent: rekeyLineupToLadder(lineups.opponent, oppStats, match.gameMode, 'opp'),
    }
  }
  return {
    variant: 'boxScore',
    bgm: buildLineupFromStats(bgmStats, 'bgm', match.playedAt, match.gameMode),
    opponent: buildLineupFromStats(oppStats, 'opp', match.playedAt, match.gameMode),
  }
}
```

In `page.tsx`, replace lines 177–187 (`hasOcrLineups` … `lineupData`) with:

```ts
const lineupResult = lineupsForMatch(m, playerStats, opponentPlayerStats, lineups)
const hasOcrLineups = lineupResult.variant === 'ocr'
const lineupVariant = lineupResult.variant
const lineupData = { bgm: lineupResult.bgm, opponent: lineupResult.opponent }
```

and drop `rekeyLineupToLadder` / `buildLineupFromStats` from its imports if now unused.

- [ ] **Step 5: Run tests, typecheck, and diff the page**

Run: `cd apps/web && node --test src/lib/lineup-slots.test.ts src/lib/match-recap.test.ts src/components/**/*.test.ts && cd ../.. && pnpm --filter web typecheck && pnpm --filter web test:unit`
Expected: all PASS; typecheck clean.

Then (dev server still up, it hot-reloads):

```bash
for M in <6s id> <3s id>; do curl -s localhost:3000/games/$M | sed 's/<script.*<\/script>//g' > $SP/after-$M.html; diff -q $SP/before-$M.html $SP/after-$M.html && echo "same $M"; done
```

Expected: `same` for both. If a diff appears, inspect it — only non-semantic noise (e.g. build ids) is acceptable; any lineup difference is a bug in the move.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/web/src/lib/lineup-slots.ts apps/web/src/lib/lineup-slots.test.ts \
  apps/web/src/components/matches/lineup/lineup-module.tsx apps/web/src/lib/match-recap.ts \
  apps/web/src/lib/match-recap.test.ts "apps/web/src/app/games/[id]/page.tsx"
git commit -m "refactor(web): shared lineup helpers (match page + Discord image)"
```

---

### Task 3: `cardForGame` — per-game card data (pure)

**Files:**

- Create: `apps/web/src/lib/discord/game-card.ts`
- Test: `apps/web/src/lib/discord/game-card.test.ts`

**Interfaces:**

- Consumes: `CardViewModel`, `CardStat` (`components/cards/card-model.ts`), `CardRosterRow`, `CardSummaryInput` (`components/cards/card-adapters.ts`), `formatSavePct` (`lib/format.ts`), `LineupPositionKey`.
- Produces:
  - `interface GameStatLine { playerId: number | null; gamertag: string; goals: number; assists: number; plusMinus: number; saves: number | null; shotsAgainst: number | null }`
  - `interface GameCardInput { position: LineupPositionKey; stat: GameStatLine; identity: CardRosterRow | null; summary: CardSummaryInput | undefined; jerseyNumber: number | null; score: number | null; starRank: number | null }`
  - `cardForGame(input: GameCardInput): CardViewModel`
  - `emptySlotLabel(position: LineupPositionKey, gamertag: string | null): string` — `"RW"` or `"RW · OCRName"`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/discord/game-card.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CardRosterRow } from '../../components/cards/card-adapters.ts'
import { cardForGame, emptySlotLabel, type GameCardInput } from './game-card.ts'

const identity = {
  playerId: 3,
  gamertag: 'Stick Menace',
  playerName: 'Igor Orlov',
  jerseyNumber: 28,
  clientPlatform: 'xbox',
  nationality: 'US',
} as unknown as CardRosterRow

const skater: GameCardInput = {
  position: 'LW',
  stat: {
    playerId: 3,
    gamertag: 'Stick Menace',
    goals: 1,
    assists: 3,
    plusMinus: -1,
    saves: null,
    shotsAgainst: null,
  },
  identity,
  summary: {
    tier: 2,
    level: 4,
    theme: 'home',
    bestBadge: { familyId: 'goals', level: 2 },
  } as GameCardInput['summary'],
  jerseyNumber: null,
  score: 17.534,
  starRank: 2,
}

void test('skater: game score, star tag, G · A · +/- · PTS, identity and theme kept', () => {
  const c = cardForGame(skater).front
  assert.equal(c.name, 'Igor Orlov')
  assert.equal(c.jersey, '28')
  assert.equal(c.position, 'LW')
  assert.equal(c.role, 'skater')
  assert.equal(c.record, 'GS 17.53')
  assert.equal(c.winPct, '⭐ 2nd star')
  assert.deepEqual(c.stats, [
    { label: 'G', value: '1' },
    { label: 'A', value: '3' },
    { label: '+/-', value: '-1' },
    { label: 'PTS', value: '4' },
  ])
  assert.equal(c.theme, 'home')
  assert.equal(c.tier, 2)
  assert.equal(c.platform, 'xbox')
  assert.equal(c.nationality, 'US')
  assert.equal(cardForGame(skater).back, null)
})

void test('positive plus-minus is signed; zero is plain; non-star has no tag', () => {
  const c = cardForGame({ ...skater, stat: { ...skater.stat, plusMinus: 2 }, starRank: null }).front
  assert.equal(c.stats[2]?.value, '+2')
  assert.equal(c.winPct, '')
  assert.equal(
    cardForGame({ ...skater, stat: { ...skater.stat, plusMinus: 0 } }).front.stats[2]?.value,
    '0',
  )
})

void test('goalie: SA · SV · GA · SV%', () => {
  const c = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: 31, shotsAgainst: 33 },
  }).front
  assert.equal(c.role, 'goalie')
  assert.deepEqual(c.stats, [
    { label: 'SA', value: '33' },
    { label: 'SV', value: '31' },
    { label: 'GA', value: '2' },
    { label: 'SV%', value: '.939' },
  ])
})

void test('goalie with no shots against: SV% is a dash', () => {
  const c = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: 0, shotsAgainst: 0 },
  }).front
  assert.equal(c.stats[3]?.value, '—')
  const n = cardForGame({
    ...skater,
    position: 'G',
    stat: { ...skater.stat, saves: null, shotsAgainst: null },
  }).front
  assert.deepEqual(
    n.stats.map((s) => s.value),
    ['0', '0', '0', '—'],
  )
})

void test('guest: gamertag, Away theme, tier 1, no badge/flag/platform, lineup jersey', () => {
  const c = cardForGame({
    ...skater,
    stat: { ...skater.stat, playerId: null, gamertag: 'Guesty' },
    identity: null,
    summary: undefined,
    jerseyNumber: 44,
  }).front
  assert.equal(c.name, 'Guesty')
  assert.equal(c.jersey, '44')
  assert.equal(c.theme, 'away')
  assert.equal(c.tier, 1)
  assert.equal(c.level, 1)
  assert.equal(c.badge, null)
  assert.equal(c.nationality, null)
  assert.equal(c.platform, null)
})

void test('no score ⇒ empty record; unknown jersey ⇒ ##', () => {
  const c = cardForGame({ ...skater, identity: null, summary: undefined, score: null }).front
  assert.equal(c.record, '')
  assert.equal(c.jersey, '##')
})

void test('emptySlotLabel', () => {
  assert.equal(emptySlotLabel('RW', null), 'RW')
  assert.equal(emptySlotLabel('RW', 'OcrName'), 'RW · OcrName')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && node --test src/lib/discord/game-card.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/discord/game-card.ts`:

```ts
import type { CardStat, CardViewModel } from '../../components/cards/card-model.ts'
import type { CardRosterRow, CardSummaryInput } from '../../components/cards/card-adapters.ts'
import { formatSavePct } from '../format.ts'
import type { LineupPositionKey } from '../lineup-shape.ts'

/** One player's box-score line for the game (getPlayerMatchStats row subset). */
export interface GameStatLine {
  playerId: number | null
  gamertag: string
  goals: number
  assists: number
  plusMinus: number
  saves: number | null
  shotsAgainst: number | null
}

export interface GameCardInput {
  position: LineupPositionKey
  stat: GameStatLine
  /** The player's normal card source (members, AI goalie); null for guests. */
  identity: CardRosterRow | null
  summary: CardSummaryInput | undefined
  /** Jersey from the lineup slot (OCR); falls back to the roster's. */
  jerseyNumber: number | null
  /** Game score (the 3 stars' number); null if the player has none. */
  score: number | null
  /** 1–3 when the player was one of the 3 stars. */
  starRank: number | null
}

const ORDINALS = ['1st', '2nd', '3rd']
const signed = (n: number) => (n > 0 ? `+${String(n)}` : String(n))

function gameStats(position: LineupPositionKey, s: GameStatLine): CardStat[] {
  if (position === 'G') {
    const sa = s.shotsAgainst ?? 0
    const sv = s.saves ?? 0
    return [
      { label: 'SA', value: String(sa) },
      { label: 'SV', value: String(sv) },
      { label: 'GA', value: String(Math.max(0, sa - sv)) },
      // The site's formatter takes a percentage string ("93.9" → ".939").
      { label: 'SV%', value: sa > 0 ? formatSavePct(String((sv / sa) * 100)) : '—' },
    ]
  }
  return [
    { label: 'G', value: String(s.goals) },
    { label: 'A', value: String(s.assists) },
    { label: '+/-', value: signed(s.plusMinus) },
    { label: 'PTS', value: String(s.goals + s.assists) },
  ]
}

/**
 * The player's normal card (theme, tier, badge, name, flag) carrying THIS
 * game's numbers: game score in the record slot, the star tag in the win %
 * slot, per-game stats in the stat row. Pure data — the card component is
 * the site's, unchanged. Guests get a plain Away card.
 */
export function cardForGame(input: GameCardInput): CardViewModel {
  const { identity, summary, stat } = input
  const jerseyNumber = input.jerseyNumber ?? identity?.jerseyNumber ?? null
  const ordinal = input.starRank === null ? undefined : ORDINALS[input.starRank - 1]
  return {
    front: {
      playerId: stat.playerId ?? -1,
      name: identity?.playerName ?? identity?.gamertag ?? stat.gamertag,
      jersey: jerseyNumber === null ? '##' : String(jerseyNumber),
      role: input.position === 'G' ? 'goalie' : 'skater',
      position: input.position,
      record: input.score === null ? '' : `GS ${input.score.toFixed(2)}`,
      winPct: ordinal === undefined ? '' : `⭐ ${ordinal} star`,
      stats: gameStats(input.position, stat),
      platform: identity?.clientPlatform ?? null,
      nationality: identity?.nationality ?? null,
      tier: summary?.tier ?? 1,
      level: summary?.level ?? 1,
      theme: summary?.theme ?? 'away',
      badge: summary?.bestBadge ?? null,
    },
    back: null,
  }
}

/** Text for an empty slot outline: the position, plus the OCR name if one was seen. */
export function emptySlotLabel(position: LineupPositionKey, gamertag: string | null): string {
  return gamertag === null || gamertag === '' ? position : `${position} · ${gamertag}`
}
```

Note: `formatSavePct` (`lib/format.ts`) takes a percentage string, e.g. `"93.939…"` → `.939`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && node --test src/lib/discord/game-card.test.ts && cd ../.. && pnpm --filter web typecheck`
Expected: PASS 7; typecheck may still fail only in Discord files touched by Task 1's contract change (fixed in Task 4).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/web/src/lib/discord/game-card.ts apps/web/src/lib/discord/game-card.test.ts
git commit -m "feat(web): cardForGame — per-game stats on the normal player card"
```

---

### Task 4: Loader, result builder and the lineup page

**Files:**

- Modify: `apps/web/src/lib/discord/game-result.ts` + `game-result.test.ts` (input `lineupCardCount` replaces `cardPlayerIds`)
- Modify: `apps/web/src/lib/discord/load-game-result.ts`
- Create: `apps/web/src/app/internal/discord/lineup/[matchId]/page.tsx`
- Delete: `apps/web/src/app/internal/discord/stars/` (whole directory)

**Interfaces:**

- Consumes: Task 1 contract; Task 2 `lineupsForMatch`, `lineupSlots`, `discordDisplayOrder`, `ladderFor`; Task 3 `cardForGame`, `emptySlotLabel`; existing `starsForMatch`, `buildAllTeamScores`, `applyLoadoutOverrides`, `wentToOvertime`.
- Produces:
  - `DiscordGameResultInput.lineupCardCount: number` (replaces `cardPlayerIds`)
  - `interface LineupImageSlot { position: LineupPositionKey; card: CardViewModel | null; label: string }`
  - `loadDiscordGameResult(matchId): Promise<{ result: DiscordGameResult; lineup: LineupImageSlot[]; columns: 2 | 3 } | null>`
  - `GET /internal/discord/lineup/[matchId]` → `#discord-lineup` grid, or 404

- [ ] **Step 1: Update `game-result.test.ts` first**

Replace `cardPlayerIds: new Set([7]),` in `base` with `lineupCardCount: 6,`. Replace the three card-related tests (`'a member whose card did not load…'`, `'cards follow star order…'`, and the `cardPlayerIds` assertions in the first and `'a BGM star with no player id…'` tests) so that:

- the first test asserts `assert.equal(r.lineupCardCount, 6)` instead of `cardPlayerIds`;
- `'a BGM star with no player id is a guest, never a member'` keeps only its `kind` assertion;
- delete `'a member whose card did not load…'` and `'cards follow star order…'`;
- `'DNF drops stars and cards'` asserts `assert.equal(r.lineupCardCount, 0)`.

Run: `cd apps/web && node --test src/lib/discord/game-result.test.ts` → Expected: FAIL (type/shape mismatch: `lineupCardCount` missing).

- [ ] **Step 2: Implement the builder change**

In `game-result.ts`: replace the `cardPlayerIds: ReadonlySet<number>` input field (and its doc) with

```ts
/** Cards in the lineup image. */
lineupCardCount: number
```

delete the `const cardPlayerIds = …` block, and in the returned object replace `cardPlayerIds,` with

```ts
    lineupCardCount: match.result === 'DNF' ? 0 : input.lineupCardCount,
```

Run: `cd apps/web && node --test src/lib/discord/game-result.test.ts` → Expected: PASS.

- [ ] **Step 3: Rewrite the loader**

Replace the body of `apps/web/src/lib/discord/load-game-result.ts` with:

```ts
import type { DiscordGameResult } from '@eanhl/db/discord'
import {
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getMatchById,
  getMatchLineups,
  getMatchPeriodSummaries,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
  getRosterCarryOvers,
  listAllGameTitles,
} from '@eanhl/db/queries'
import type { CardViewModel } from '@/components/cards/card-model'
import {
  applyLoadoutOverrides,
  buildAllTeamScores,
  lineupsForMatch,
  starsForMatch,
  wentToOvertime,
} from '@/lib/match-recap'
import { ladderFor, type LineupPositionKey } from '@/lib/lineup-shape'
import { discordDisplayOrder, lineupSlots, normalizeLineupTag } from '@/lib/lineup-slots'
import { buildDiscordGameResult } from './game-result'
import { cardForGame, emptySlotLabel } from './game-card'

export interface LineupImageSlot {
  position: LineupPositionKey
  card: CardViewModel | null
  label: string
}

/**
 * Everything the Discord post needs for one game. Stars and lineup come from
 * the same functions the match page uses; each lineup card is the player's
 * normal card carrying this game's numbers (cardForGame). Throws on a DB
 * failure — the discord service retries.
 */
export async function loadDiscordGameResult(
  matchId: number,
): Promise<{ result: DiscordGameResult; lineup: LineupImageSlot[]; columns: 2 | 3 } | null> {
  const match = await getMatchById(matchId)
  if (!match) return null

  const [playerStats, opponentPlayerStats, lineups, periodSummaries, titles, memberIdList] =
    await Promise.all([
      getPlayerMatchStats(match.id),
      getOpponentPlayerMatchStats(match.id),
      getMatchLineups(match.id),
      getMatchPeriodSummaries(match.id),
      listAllGameTitles(),
      getClubMemberIds(),
    ])

  const stars = starsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const overtime = wentToOvertime(
    match,
    periodSummaries,
    [...playerStats, ...opponentPlayerStats].map((p) => p.toiSeconds),
  )
  const memberIds = new Set(memberIdList)

  // Game scores for every BGM player, exactly as the match page ranks them.
  const scores = buildAllTeamScores(
    match,
    applyLoadoutOverrides(playerStats, lineups.bgm),
    applyLoadoutOverrides(opponentPlayerStats, lineups.opponent),
  ).filter((e) => e.side === 'bgm')
  const scoreFor = (playerId: number | null, gamertag: string) =>
    scores.find((e) =>
      playerId !== null
        ? e.playerId === playerId
        : normalizeLineupTag(e.gamertag) === normalizeLineupTag(gamertag),
    )?.score ?? null
  const starRankFor = (playerId: number | null, gamertag: string) => {
    const i = stars.findIndex(
      (s) =>
        s.side === 'bgm' &&
        (playerId !== null
          ? s.playerId === playerId
          : normalizeLineupTag(s.gamertag) === normalizeLineupTag(gamertag)),
    )
    return i === -1 ? null : i + 1
  }

  const { variant, bgm } = lineupsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const slots = lineupSlots(bgm, variant, ladderFor(match.gameMode), playerStats)
  const memberSlotIds = slots.flatMap((s) =>
    s.stat?.playerId != null && memberIds.has(s.stat.playerId) ? [s.stat.playerId] : [],
  )
  const [roster, carryOvers, summaries] =
    memberSlotIds.length === 0
      ? [[], [], new Map()]
      : await Promise.all([
          getEARoster(match.gameTitleId),
          getRosterCarryOvers(match.gameTitleId),
          getCardProgressForPlayers(memberSlotIds),
        ])
  const rosterById = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))

  const byPosition = new Map(slots.map((s) => [s.position, s]))
  const lineup: LineupImageSlot[] =
    match.result === 'DNF'
      ? []
      : discordDisplayOrder(match.gameMode).map((position) => {
          const slot = byPosition.get(position)
          const stat = slot?.stat ?? null
          if (!stat) {
            return {
              position,
              card: null,
              label: emptySlotLabel(position, slot?.row?.gamertagSnapshot ?? null),
            }
          }
          const isMember = stat.playerId !== null && memberIds.has(stat.playerId)
          const card = cardForGame({
            position,
            stat,
            identity: isMember ? (rosterById.get(stat.playerId!) ?? null) : null,
            summary: isMember ? summaries.get(stat.playerId!) : undefined,
            jerseyNumber: slot?.row?.playerNumber ?? null,
            score: scoreFor(stat.playerId, stat.gamertag),
            starRank: starRankFor(stat.playerId, stat.gamertag),
          })
          return { position, card, label: position }
        })

  const title = titles.find((t) => t.id === match.gameTitleId)
  const result = buildDiscordGameResult({
    match,
    gameTitleName: title?.name ?? '',
    overtime,
    stars,
    memberIds,
    lineupCardCount: lineup.filter((s) => s.card !== null).length,
  })
  return { result, lineup, columns: match.gameMode === '3s' ? 2 : 3 }
}
```

If `typecheck` objects to the tuple's empty-branch types, give it an explicit type (`Awaited<ReturnType<typeof getEARoster>>` etc.) rather than casting to `any`. If a member is not in the roster rows (no EA row this title, no carry-over), `identity` is null and the card falls back to gamertag + their `summary` theme — acceptable.

- [ ] **Step 4: Write the lineup page and delete the stars page**

`apps/web/src/app/internal/discord/lineup/[matchId]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCard } from '@/components/cards/player-card'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * BGM's lineup for one game — every player on their card with this game's
 * stats, two rows (6s: LW C RW / LD G RD · 3s: W C / D G) — for the discord
 * service to screenshot (#discord-lineup only). A full-viewport backdrop
 * covers the site chrome. Internal: 404 without the token.
 */
export default async function DiscordLineupPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const h = await headers()
  if (!isInternalTokenValid(h.get(INTERNAL_TOKEN_HEADER), process.env['DISCORD_INTERNAL_TOKEN'])) {
    notFound()
  }
  const { matchId } = await params
  const id = Number.parseInt(matchId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const loaded = await loadDiscordGameResult(id)
  if (!loaded || loaded.result.lineupCardCount === 0) notFound()

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: 'var(--color-background)',
      }}
    >
      <div
        id="discord-lineup"
        style={{
          display: 'inline-grid',
          gridTemplateColumns: `repeat(${String(loaded.columns)}, 264px)`,
          gap: 16,
          padding: 16,
        }}
      >
        {loaded.lineup.map((slot) =>
          slot.card ? (
            <PlayerCard key={slot.position} card={slot.card} context="list" />
          ) : (
            <div
              key={slot.position}
              style={{
                border: '1px dashed var(--color-border)',
                borderRadius: 16,
                minHeight: 421,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-fg-4, #7a7778)',
                letterSpacing: '0.2em',
                fontWeight: 700,
              }}
            >
              {slot.label}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
```

Delete the old page: `git rm -r "apps/web/src/app/internal/discord/stars"`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/web && node --test src/lib/discord/*.test.ts src/lib/lineup-slots.test.ts src/lib/match-recap.test.ts && cd ../.. && pnpm --filter @eanhl/db build && pnpm --filter web typecheck && pnpm --filter web test:unit`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/web/src/lib/discord apps/web/src/app/internal
git commit -m "feat(web): Discord lineup page — every BGM player on a per-game card"
```

---

### Task 5: Poster service — render the lineup

**Files:**

- Modify: `apps/discord/src/cycle.ts` (`cardPlayerIds.length` → `lineupCardCount`)
- Modify: `apps/discord/src/cycle.test.ts` (`result()` helper)
- Modify: `apps/discord/src/render.ts` (URL, selector, viewport)
- Modify: `apps/discord/src/preview-cli.ts` (`cardPlayerIds.length` → `lineupCardCount`)
- Modify: `apps/discord/src/message.test.ts` (fixture field)

**Interfaces:**

- Consumes: Task 1 contract.
- Produces: `renderStarCards` renamed `renderLineup(opts: { webBaseUrl; token; matchId; timeoutMs }): Promise<Uint8Array>`; `PosterDeps.renderCards` keeps its name and signature.

- [ ] **Step 1: Update tests first**

In `cycle.test.ts`, change the `result` helper's last field from `cardPlayerIds: cards,` to `lineupCardCount: cards.length,`. In `message.test.ts`, change the fixture's `cardPlayerIds: [7],` to `lineupCardCount: 6,` and the DNF case's `cardPlayerIds: []` to `lineupCardCount: 0`.

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord typecheck`
Expected: FAIL — `cycle.ts`/`preview-cli.ts` still read `cardPlayerIds`.

- [ ] **Step 2: Implement**

- `cycle.ts`: `if (result.cardPlayerIds.length > 0)` → `if (result.lineupCardCount > 0)`.
- `preview-cli.ts`: same replacement; `renderStarCards` → `renderLineup`.
- `index.ts`: `renderStarCards` → `renderLineup` (import + call).
- `render.ts`: rename the export to `renderLineup`; update its doc to "Screenshot BGM's lineup …"; change the URL path to `/internal/discord/lineup/${String(opts.matchId)}`, the locator to `#discord-lineup`, and the viewport to `{ width: 1000, height: 1100 }` (two rows of ~421 px cards + gaps ≈ 890 px must fit — a fixed element can't be scrolled into view).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @eanhl/discord test && pnpm --filter @eanhl/discord typecheck && pnpm --filter @eanhl/discord build`
Expected: PASS 30; typecheck clean; build ok.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/discord/src
git commit -m "feat(discord): screenshot the lineup instead of the star cards"
```

---

### Task 6: Visual previews, docs, deploy

- [ ] **Step 1: Dev server against the preview DB**

```bash
SP=<session scratchpad>; [ -s $SP/token ] || openssl rand -hex 32 > $SP/token
U=$(grep -E '^DATABASE_URL=.*localhost' .env | head -1 | cut -d= -f2-)
DATABASE_URL="${U%/*}/eanhl_preview" DISCORD_INTERNAL_TOKEN=$(cat $SP/token) pnpm --filter web dev   # background
```

- [ ] **Step 2: Render four past games**

Pick from `eanhl_preview`: a 6s win (e.g. 3391), a 3s game, a game with a BGM guest (a `player_match_stats` row whose player is not in `getClubMemberIds()`), and one with the AI goalie in net. Run:

```bash
for M in <ids>; do DISCORD_INTERNAL_TOKEN=$(cat $SP/token) WEB_INTERNAL_URL=http://localhost:3000 \
  node apps/discord/dist/preview-cli.js --match-id $M --out $SP/lineup-preview; done
```

Expected (open each `cards.png`): two rows in the right order; every BGM player on a card; stats match the box score on `/games/<id>`; `GS` + star tags match the 3 stars; guest on an Away card; empty slot outline if a slot is missing; both rows fully inside the image. Show the operator the images and get approval before deploying.

- [ ] **Step 3: Docs** — journal entry (2026-10-10, lineup image), handoff line update in place (size ≤ 200 lines / 12 KB), commit `docs(handoff): Discord lineup image`.

- [ ] **Step 4: Final whole-branch review** (fresh reviewer) and fix pass per executing-plans.

- [ ] **Step 5: Deploy (operator-gated)** — merge to `main`, push; on Hotel-Echo: `git pull`; tag `eanhl-team-website-web:rollback-he-2026-10-10-pre-lineup` and `eanhl-team-website-discord:rollback-he-2026-10-10-pre-lineup`; `docker compose build web discord`; `docker compose up -d --no-deps web discord`; check `/internal/discord/lineup/1` → 404 publicly; render the latest live game via `docker compose exec -T discord node dist/preview-cli.js --match-id <id> --out /tmp/discord-out/preview` and show the operator.
