# Discord Unlock Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the batch "CARD UPDATES" post with one Discord message per unlock (badge level, card level, tier, mythic), each with one transparent graphic — the badge or the full card.

**Architecture:** Migration 0069 adds `discord_unlock_posts` (one row per `player_card_events` row). A pure `describeUnlock` in `@eanhl/db/discord` turns an event into `{ kind, subject, graphic }`. The web app serves a token-guarded JSON route and a transparent graphic page per event; the `discord` service's unlock pass (after games) fetches, claims, renders (`omitBackground`), and sends message `content` with the PNG, about 2 s apart. The batch code (card-updates route/page, `showcaseChanges`, `DiscordCardUpdates`, `runCardUpdatesCycle`) is removed.

**Tech Stack:** TypeScript strict, Drizzle + hand-written SQL, Next.js 15, Playwright, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-discord-unlock-posts-design.md`

## Global Constraints

- **Work in a git worktree** (superpowers:using-git-worktrees): the main checkout holds someone else's uncommitted nav/stats/`club-members.ts` work. Do not edit `club-members.ts`.
- Counts: `badge_level_up` with `to_value > from_value`; `level_up`; `tier_up`; `mythic_awarded`. Never `mythic_cleared`. Members only (`MEMBER_CONDITION`), never AI goalies, active title, 24 h, settled on every match type (same clause as 0068).
- Badge subject: `<Family name> · <Theme name> <I|II|III>` with theme `CARD_THEME_ORDER[ceil(l/3)−1]`, frame `['I','II','III'][(l−1)%3]` (must equal web `themeLabel`).
- Card subject: `tier_up` → `TIER_LABELS[to]` upper-cased; `mythic_awarded` → `CARD_THEME_NAMES[mythicTheme]` upper-cased; `level_up` → `String(to)`.
- Texts: `**[NAME](<URL>)** has unlocked **<subject>**!` (badge); `… has unlocked the **<SUBJECT>** card!` (tier, mythic); `… has reached **card level <n>**!` (level). NAME = card name upper-cased; every user string escaped; `allowed_mentions: { parse: [] }`.
- Graphics: badge `Badge` 120 px, board theme + frame, padding 16, scale 2; card `PlayerCard` list context, no padding, scale 3; both `omitBackground: true` on a page with `html, body { background: transparent }` and header/footer/nav hidden.
- Card theme per kind: `tier_up` → `TIER_THEME[to]`, tier `to`; `mythic_awarded` → `mythicTheme`, tier 6, level 10; `level_up` → the card as the site shows it now.
- Order: `occurred_at`, the player's first event id in that batch, kind (badge 0, level 1, tier 2, mythic 3), id. ≤ 20 per cycle; ~2.1 s between sends.
- Raw-SQL timestamps as `toISOString()::timestamptz`.
- Gates: typecheck, unit tests, `pnpm format`. Rebuild `@eanhl/db` after editing it.

## Review Focus

1. A badge jump 3 → 5 in one event — one message, for level 5 (`Home II`), not two. Pinned in Task 2.
2. A mythic cleared before the poster runs — `nothing to show`, no post. Pinned in Task 3 (loader returns null ⇒ 404) and Task 4 (cycle skip).
3. Ten unlocks in one batch — all ten post, in the spec order, ≥ 2 s apart, and a crash halfway never re-sends the sent ones. Pinned in Task 1 (order SQL) and Task 4 (cycle with pause + per-event claim).
4. A player name with markdown (`x_Sniper_x`) — rendered literally inside the bold link. Pinned in Task 4.
5. A card unlock for a member with no roster row this title — text-only post, not a failure. Pinned in Task 3 (`graphic: 'none'`) and Task 4.

---

### Task 1: Unlock record, queries, SQL pins

**Files:**

- Create: `packages/db/migrations/0069_discord_unlock_posts.sql`
- Create: `packages/db/src/schema/discord-unlock-posts.ts`; modify `schema/index.ts`
- Create: `packages/db/src/queries/discord-unlock-posts.ts`; modify `queries/index.ts`
- Test: `packages/db/src/queries/__tests__/discord-unlock-posts.test.ts`

**Interfaces (produces, `@eanhl/db/queries`):**

- `discordUnlockCandidatesSql(args: { since: Date; limit: number }): SQL`; `listDiscordUnlockCandidates(args): Promise<number[]>`
- `claimDiscordUnlockSql(eventId: number): SQL`; `claimDiscordUnlock(eventId: number): Promise<boolean>`
- `markDiscordUnlockPosted(id, messageId: string | null)`, `markDiscordUnlockFailed(id, error)`, `markDiscordUnlockSkipped(id, reason)` → `Promise<void>`
- `interface UnlockEventRow { id: number; playerId: number; gameTitleId: number; gamertag: string; aiGoalie: boolean; kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number; mythicTheme: MythicThemeKey | null }`
- `getUnlockEvent(eventId: number): Promise<UnlockEventRow | null>`

- [ ] **Step 1: Migration** — `0069_discord_unlock_posts.sql`, same header form as 0068:

```sql
-- Migration: discord_unlock_posts — one row per card event posted (or skipped)
-- Spec: docs/superpowers/specs/2026-10-24-discord-unlock-posts-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-unlock-posts.md (task 1).
--
-- One Discord message per unlock, so one row per player_card_events row. Same
-- states as discord_posts: pending (never re-picked: no double post), posted,
-- failed (retried while attempts < 3), skipped. Back-fills a skipped row for
-- every existing event so launch never posts history. discord_card_posts (0068)
-- stays, unused.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0068):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0069_discord_unlock_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_unlock_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_unlock_posts" (
  "event_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "player_card_events"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_unlock_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_unlock_posts" ("event_id", "status", "last_error")
SELECT "id", 'skipped', 'before launch' FROM "player_card_events"
ON CONFLICT ("event_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM "player_card_events") AS "events",
  (SELECT count(*) FROM "discord_unlock_posts") AS "rows",
  (SELECT count(*) FROM "discord_unlock_posts" WHERE "status" = 'skipped') AS "skipped";
```

- [ ] **Step 2: Schema** — `schema/discord-unlock-posts.ts` mirroring `discord-card-posts.ts` (`eventId: bigint('event_id', { mode: 'number' }).primaryKey().references(() => playerCardEvents.id, { onDelete: 'cascade' })`, status/attempts/lastError/discordMessageId/createdAt/updatedAt/postedAt, the status CHECK named `discord_unlock_posts_status_check`). Export from `schema/index.ts` after `discord-card-posts`.

- [ ] **Step 3: Failing SQL test** — `queries/__tests__/discord-unlock-posts.test.ts`:

```ts
/**
 * SQL-shape pins for the unlock queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-unlock-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-unlock-posts-test:unused@127.0.0.1:1/unused'

const { discordUnlockCandidatesSql, claimDiscordUnlockSql } =
  await import('../discord-unlock-posts.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('candidates: counted kinds (every badge level), members only, settled, ordered, limited', () => {
  const q = dialect.sqlToQuery(
    discordUnlockCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 20 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = ev\.game_title_id and g\.is_active/)
  assert.match(s, /ev\.occurred_at > \$\d+::timestamptz/)
  assert.ok(q.params.includes('2026-10-24T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
  assert.match(s, /d\.event_id is null or \( ?d\.status = 'failed' and d\.attempts < 3 ?\)/)
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /p\.pinned_to_roster/)
  assert.match(s, /ev\.kind = 'badge_level_up' and ev\.to_value > ev\.from_value/)
  assert.match(s, /ev\.kind in \('level_up', 'tier_up', 'mythic_awarded'\)/)
  assert.doesNotMatch(s, /mythic_cleared/)
  assert.match(s, /unnest\(array\['gameType5', 'gameType10', 'club_private'\]::text\[\]\)/)
  assert.match(
    s,
    /order by ev\.occurred_at, \( ?select min\(x\.id\) from player_card_events x where x\.game_title_id = ev\.game_title_id and x\.occurred_at = ev\.occurred_at and x\.player_id = ev\.player_id ?\), case ev\.kind when 'badge_level_up' then 0 when 'level_up' then 1 when 'tier_up' then 2 else 3 end, ev\.id limit \$\d+/,
  )
})

void test('claim: insert pending, or flip only a failed row under the cap', () => {
  const s = flat(dialect.sqlToQuery(claimDiscordUnlockSql(42)).sql)
  assert.match(
    s,
    /insert into discord_unlock_posts \(event_id, status, attempts\) values \(\$1, 'pending', 1\)/,
  )
  assert.match(
    s,
    /on conflict \(event_id\) do update set status = 'pending', attempts = discord_unlock_posts\.attempts \+ 1/,
  )
  assert.match(
    s,
    /where discord_unlock_posts\.status = 'failed' and discord_unlock_posts\.attempts < 3/,
  )
  assert.match(s, /returning event_id/)
})
```

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/queries/__tests__/discord-unlock-posts.test.js` → Expected: FAIL (module missing).

- [ ] **Step 4: Queries** — `queries/discord-unlock-posts.ts`:

```ts
import { eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { MATCH_TYPE, discordUnlockPosts } from '../schema/index.js'
import type { BadgeFamilyId, MythicThemeKey } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'

const MAX = sql.raw(String(DISCORD_MAX_ATTEMPTS))
const TYPES = sql.raw(`array[${MATCH_TYPE.map((t) => `'${t}'`).join(', ')}]`)

/**
 * Card events the discord service may post, one message each (spec §5.2):
 * active title, inside the window, no row or failed under the cap (pending
 * never re-picked), settled on every match type, a counted kind (every badge
 * level up, card level, tier, mythic award), a member who is not an AI goalie.
 * Ordered so a batch reads player by player, badge → level → tier → mythic.
 */
export function discordUnlockCandidatesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    select ev.id
    from player_card_events ev
    join game_titles g on g.id = ev.game_title_id and g.is_active
    join players p on p.id = ev.player_id
    left join discord_unlock_posts d on d.event_id = ev.id
    where ev.occurred_at > ${args.since.toISOString()}::timestamptz
      and (d.event_id is null or (d.status = 'failed' and d.attempts < ${MAX}))
      and p.ai_goalie_side is null
      and ${MEMBER_CONDITION}
      and ((ev.kind = 'badge_level_up' and ev.to_value > ev.from_value)
           or ev.kind in ('level_up', 'tier_up', 'mythic_awarded'))
      and not exists (
        select 1 from unnest(${TYPES}::text[]) t(mt)
        where not exists (
          select 1 from ingestion_log l
          where l.game_title_id = ev.game_title_id and l.match_type = t.mt and l.started_at > ev.occurred_at
        )
      )
    order by ev.occurred_at,
      (select min(x.id) from player_card_events x
        where x.game_title_id = ev.game_title_id and x.occurred_at = ev.occurred_at and x.player_id = ev.player_id),
      case ev.kind when 'badge_level_up' then 0 when 'level_up' then 1 when 'tier_up' then 2 else 3 end,
      ev.id
    limit ${args.limit}`
}

export async function listDiscordUnlockCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await db.execute<{ id: string | number }>(discordUnlockCandidatesSql(args))
  return rows.map((r) => Number(r.id))
}

export function claimDiscordUnlockSql(eventId: number): SQL {
  return sql`
    insert into discord_unlock_posts (event_id, status, attempts) values (${eventId}, 'pending', 1)
    on conflict (event_id) do update
      set status = 'pending', attempts = discord_unlock_posts.attempts + 1, updated_at = now()
      where discord_unlock_posts.status = 'failed' and discord_unlock_posts.attempts < ${MAX}
    returning event_id`
}

export async function claimDiscordUnlock(eventId: number): Promise<boolean> {
  const rows = await db.execute(claimDiscordUnlockSql(eventId))
  return rows.length > 0
}

export async function markDiscordUnlockPosted(
  eventId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export async function markDiscordUnlockFailed(eventId: number, error: string): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export async function markDiscordUnlockSkipped(eventId: number, reason: string): Promise<void> {
  await db
    .update(discordUnlockPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordUnlockPosts.eventId, eventId))
}

export interface UnlockEventRow {
  id: number
  playerId: number
  gameTitleId: number
  gamertag: string
  aiGoalie: boolean
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
  /** The card's current mythic theme for that title (null when none / cleared). */
  mythicTheme: MythicThemeKey | null
}

/** One card event with what its post needs; null if no such event. */
export async function getUnlockEvent(eventId: number): Promise<UnlockEventRow | null> {
  const rows = await db.execute<{
    id: string | number
    player_id: number
    game_title_id: number
    gamertag: string
    ai_goalie_side: string | null
    kind: CardEventKind
    family_id: BadgeFamilyId | null
    from_value: number
    to_value: number
    mythic_theme: MythicThemeKey | null
  }>(sql`
    select ev.id, ev.player_id, ev.game_title_id, p.gamertag, p.ai_goalie_side, ev.kind,
      ev.family_id, ev.from_value, ev.to_value, cp.mythic_theme
    from player_card_events ev
    join players p on p.id = ev.player_id
    left join player_card_progress cp on cp.player_id = ev.player_id and cp.game_title_id = ev.game_title_id
    where ev.id = ${eventId}`)
  const r = rows[0]
  if (!r) return null
  return {
    id: Number(r.id),
    playerId: Number(r.player_id),
    gameTitleId: Number(r.game_title_id),
    gamertag: r.gamertag,
    aiGoalie: r.ai_goalie_side !== null,
    kind: r.kind,
    familyId: r.family_id,
    fromValue: Number(r.from_value),
    toValue: Number(r.to_value),
    mythicTheme: r.mythic_theme,
  }
}
```

Export from `queries/index.ts` after `discord-card-posts`. If `player_card_progress`'s mythic column has another name, use the schema's (`playerCardProgress.mythicTheme`) column name.

- [ ] **Step 5:** Run the test → Expected: PASS 2. Tighten any regex only to the real rendering (print `sqlToQuery(...).sql` if a match misses on spacing).

- [ ] **Step 6: Commit** `feat(db): discord_unlock_posts and per-event unlock queries (migration 0069)`.

---

### Task 2: `describeUnlock` and the unlock contract (pure); remove the batch contract

**Files:**

- Create: `packages/db/src/discord/unlocks.ts`, `unlocks.test.ts`
- Modify: `packages/db/src/discord/contract.ts` (+ `DiscordUnlock`, parser; − `DiscordCardUpdates`, `parseDiscordCardUpdates`), `contract.test.ts`, `discord/index.ts`
- Delete: `packages/db/src/discord/card-updates.ts`, `card-updates.test.ts`

**Interfaces (produces, `@eanhl/db/discord`):**

- `badgeBoardName(level: number): string` — e.g. 10 → `'Carbon-Fiber I'`
- `interface UnlockDescription { kind: 'badge' | 'card_level' | 'tier' | 'mythic'; subject: string; graphic: 'badge' | 'card'; badge?: { familyId: BadgeFamilyId; level: number }; cardTheme?: CardThemeKey; cardTier?: CardTier }`
- `describeUnlock(e: { kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number }, ctx: { mythicTheme: MythicThemeKey | null }): UnlockDescription | null`
- `interface DiscordUnlock { eventId: number; playerId: number; name: string; kind: UnlockDescription['kind']; subject: string; graphic: 'badge' | 'card' | 'none' }`; `parseDiscordUnlock(value: unknown): DiscordUnlock`

- [ ] **Step 1: Failing tests** — `unlocks.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeBoardName, describeUnlock } from './unlocks.js'

const none = { mythicTheme: null }

void test('badgeBoardName: theme per 3 levels, frame I–III', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 30].map(badgeBoardName), [
    'Away I',
    'Away II',
    'Away III',
    'Home I',
    'Carbon-Fiber I',
    'Maximus III',
  ])
})

void test('badge: every level up counts; a jump posts the level reached; equal or down never', () => {
  assert.deepEqual(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pshots', fromValue: 9, toValue: 10 }, none),
    {
      kind: 'badge',
      subject: 'Shots · Carbon-Fiber I',
      graphic: 'badge',
      badge: { familyId: 'pshots', level: 10 },
    },
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 3, toValue: 5 }, none)
      ?.subject,
    'Goals · Home II',
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 0, toValue: 1 }, none)
      ?.subject,
    'Goals · Away I',
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 5, toValue: 5 }, none),
    null,
  )
})

void test('card level, tier, mythic; cleared mythic and missing mythic theme never post', () => {
  assert.deepEqual(
    describeUnlock({ kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 }, none),
    {
      kind: 'card_level',
      subject: '5',
      graphic: 'card',
    },
  )
  assert.deepEqual(
    describeUnlock({ kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 }, none),
    {
      kind: 'tier',
      subject: 'STUD',
      graphic: 'card',
      cardTheme: 'alternate',
      cardTier: 3,
    },
  )
  assert.deepEqual(
    describeUnlock(
      { kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 },
      { mythicTheme: 'inferno' },
    ),
    {
      kind: 'mythic',
      subject: 'INFERNO',
      graphic: 'card',
      cardTheme: 'inferno',
      cardTier: 6,
    },
  )
  assert.equal(
    describeUnlock({ kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 }, none),
    null,
  )
  assert.equal(
    describeUnlock(
      { kind: 'mythic_cleared', familyId: null, fromValue: 6, toValue: 3 },
      { mythicTheme: 'inferno' },
    ),
    null,
  )
})
```

In `contract.test.ts`: replace the `card updates: …` test (and its import) with:

```ts
void test('unlock: valid round-trip; bad kind/graphic rejected', () => {
  const v = {
    eventId: 9,
    playerId: 2,
    name: 'SILKY',
    kind: 'badge',
    subject: 'Shots · Home II',
    graphic: 'badge',
  }
  assert.deepEqual(parseDiscordUnlock(JSON.parse(JSON.stringify(v))), v)
  assert.throws(() => parseDiscordUnlock({ ...v, kind: 'x' }), /kind/)
  assert.throws(() => parseDiscordUnlock({ ...v, graphic: 'gif' }), /graphic/)
})
```

Run → Expected: FAIL (modules/exports missing).

- [ ] **Step 2: Implement** — `unlocks.ts`:

```ts
/**
 * What one Discord unlock message says and shows (spec §4). Pure. Badge names
 * follow the badge board (badge-board.ts `themeLabel`): one card theme per 3
 * levels, framed I–III.
 */
import {
  BADGE_FAMILIES,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  TIER_LABELS,
  TIER_THEME,
  type BadgeFamilyId,
  type CardThemeKey,
  type CardTier,
  type MythicThemeKey,
  type StatsTier,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

const FRAMES = ['I', 'II', 'III'] as const

export function badgeBoardName(level: number): string {
  const l = Math.max(1, Math.floor(level))
  const theme =
    CARD_THEME_ORDER[Math.ceil(l / 3) - 1] ?? CARD_THEME_ORDER[CARD_THEME_ORDER.length - 1]!
  return `${CARD_THEME_NAMES[theme]} ${FRAMES[(l - 1) % 3]!}`
}

export interface UnlockDescription {
  kind: 'badge' | 'card_level' | 'tier' | 'mythic'
  subject: string
  graphic: 'badge' | 'card'
  badge?: { familyId: BadgeFamilyId; level: number }
  cardTheme?: CardThemeKey
  cardTier?: CardTier
}

export function describeUnlock(
  e: { kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number },
  ctx: { mythicTheme: MythicThemeKey | null },
): UnlockDescription | null {
  switch (e.kind) {
    case 'badge_level_up': {
      if (e.toValue <= e.fromValue || e.familyId === null) return null
      const name = BADGE_FAMILIES.find((f) => f.id === e.familyId)?.name ?? e.familyId
      return {
        kind: 'badge',
        subject: `${name} · ${badgeBoardName(e.toValue)}`,
        graphic: 'badge',
        badge: { familyId: e.familyId, level: e.toValue },
      }
    }
    case 'level_up':
      return { kind: 'card_level', subject: String(e.toValue), graphic: 'card' }
    case 'tier_up': {
      const tier = e.toValue as StatsTier
      return {
        kind: 'tier',
        subject: (TIER_LABELS[tier] ?? String(tier)).toUpperCase(),
        graphic: 'card',
        cardTheme: TIER_THEME[tier] ?? 'away',
        cardTier: tier,
      }
    }
    case 'mythic_awarded':
      if (ctx.mythicTheme === null) return null
      return {
        kind: 'mythic',
        subject: CARD_THEME_NAMES[ctx.mythicTheme].toUpperCase(),
        graphic: 'card',
        cardTheme: ctx.mythicTheme,
        cardTier: 6,
      }
    default:
      return null
  }
}
```

(If `StatsTier`/`TIER_THEME`/`MythicThemeKey` live in another catalog file, import from there; the test is the contract.)

In `contract.ts`: delete `DiscordCardUpdates` and `parseDiscordCardUpdates`; add

```ts
export const UNLOCK_KINDS = ['badge', 'card_level', 'tier', 'mythic'] as const
export interface DiscordUnlock {
  eventId: number
  playerId: number
  /** Card name, upper-cased. */
  name: string
  kind: (typeof UNLOCK_KINDS)[number]
  /** Badge board name, tier/mythic name, or the card level. */
  subject: string
  /** 'none' ⇒ text-only (e.g. no card this title). */
  graphic: 'badge' | 'card' | 'none'
}

export function parseDiscordUnlock(value: unknown): DiscordUnlock {
  const o = obj(value, 'root')
  const kind = o['kind']
  if (!UNLOCK_KINDS.includes(kind as DiscordUnlock['kind'])) fail('kind', 'is invalid')
  const graphic = o['graphic']
  if (graphic !== 'badge' && graphic !== 'card' && graphic !== 'none') fail('graphic', 'is invalid')
  return {
    eventId: int(o['eventId'], 'eventId'),
    playerId: int(o['playerId'], 'playerId'),
    name: str(o['name'], 'name'),
    kind: kind as DiscordUnlock['kind'],
    subject: str(o['subject'], 'subject'),
    graphic,
  }
}
```

In `discord/index.ts`: replace `export * from './card-updates.js'` with `export * from './unlocks.js'`; `git rm` `card-updates.ts` and `card-updates.test.ts`.

- [ ] **Step 3:** Run `pnpm --filter @eanhl/db build && node --test packages/db/dist/discord/unlocks.test.js packages/db/dist/discord/contract.test.js` → PASS. (Web/discord consumers break until Tasks 3–4; expected.)

- [ ] **Step 4: Commit** `feat(db): describeUnlock and the Discord unlock contract (replaces card-updates)`.

---

### Task 3: Web — unlock loader, data route, transparent graphic page

**Files:**

- Create: `apps/web/src/lib/discord/load-unlock.ts`
- Create: `apps/web/src/app/internal/discord/unlock/[eventId]/data/route.ts`, `…/unlock/[eventId]/page.tsx`
- Test: `apps/web/src/lib/discord/badge-board-name.test.ts`
- Delete: `apps/web/src/lib/discord/load-card-updates.ts`, `apps/web/src/app/internal/discord/card-updates/`

**Interfaces (produces):** `loadDiscordUnlock(eventId: number): Promise<{ data: DiscordUnlock; badge: { familyId: BadgeFamilyId; level: number } | null; card: CardViewModel | null } | null>`

- [ ] **Step 1: Failing parity test** — `badge-board-name.test.ts` (pins the db naming to the site's badge board):

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeBoardName } from '@eanhl/db/discord'
import { themeLabel } from '../../components/badges/badge-board.ts'

void test('Discord badge names equal the badge board labels for every level', () => {
  for (let l = 1; l <= 30; l++) assert.equal(badgeBoardName(l), themeLabel(l), `level ${String(l)}`)
})
```

Run: `cd apps/web && node --test src/lib/discord/badge-board-name.test.ts`. Expected: PASS once Task 2 is built (if `badge-board.ts` pulls a non-strippable import, run it through the web unit suite instead and note it).

- [ ] **Step 2: Loader** — `load-unlock.ts`:

```ts
import { describeUnlock, type DiscordUnlock } from '@eanhl/db/discord'
import {
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getRosterCarryOvers,
  getUnlockEvent,
} from '@eanhl/db/queries'
import type { BadgeFamilyId } from '@eanhl/db/cards'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import type { CardViewModel } from '@/components/cards/card-model'

/**
 * One unlock's message data and graphic. Null (⇒ 404, the poster skips it)
 * when the event doesn't count any more: not a member, an AI goalie, a cleared
 * mythic, a non-counting kind.
 */
export async function loadDiscordUnlock(eventId: number): Promise<{
  data: DiscordUnlock
  badge: { familyId: BadgeFamilyId; level: number } | null
  card: CardViewModel | null
} | null> {
  const ev = await getUnlockEvent(eventId)
  if (!ev || ev.aiGoalie) return null
  if (!(await getClubMemberIds()).includes(ev.playerId)) return null
  const d = describeUnlock(ev, { mythicTheme: ev.mythicTheme })
  if (!d) return null

  const [roster, carryOvers, summaries] = await Promise.all([
    getEARoster(ev.gameTitleId),
    getRosterCarryOvers(ev.gameTitleId),
    getCardProgressForPlayers([ev.playerId], ev.gameTitleId),
  ])
  const row = [...roster, ...carryOvers].find((r) => r.playerId === ev.playerId)
  const base = row ? cardFromRosterRow(row, summaries.get(ev.playerId)) : null
  const card =
    base === null
      ? null
      : d.cardTheme === undefined
        ? base
        : {
            ...base,
            front: {
              ...base.front,
              theme: d.cardTheme,
              tier: d.cardTier ?? base.front.tier,
              level: d.kind === 'mythic' ? 10 : base.front.level,
            },
          }
  const name = (base?.front.name ?? ev.gamertag).toUpperCase()
  const graphic = d.graphic === 'badge' ? 'badge' : card ? 'card' : 'none'
  return {
    data: { eventId, playerId: ev.playerId, name, kind: d.kind, subject: d.subject, graphic },
    badge: d.badge ?? null,
    card: graphic === 'card' ? card : null,
  }
}
```

- [ ] **Step 3: Data route** — `unlock/[eventId]/data/route.ts`: same shape as `card-updates/[batchEventId]/data/route.ts` (token guard, positive integer id, `loadDiscordUnlock` → null ⇒ 404, JSON `loaded.data` with `no-store`).

- [ ] **Step 4: Graphic page** — `unlock/[eventId]/page.tsx`: token guard; `loadDiscordUnlock`; `notFound()` when null or `graphic === 'none'`; render

```tsx
<>
  <style>{`html, body { background: transparent !important; } header, footer, nav { display: none !important; }`}</style>
  <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 2147483647 }}>
    <div id="discord-unlock" style={{ display: 'inline-flex', padding: loaded.badge ? 16 : 0 }}>
      {loaded.badge ? (
        <Badge
          familyId={loaded.badge.familyId}
          shape={shape}
          theme={look.theme}
          frame={look.frame}
          size={120}
        />
      ) : (
        <PlayerCard card={loaded.card!} context="list" />
      )}
    </div>
  </div>
</>
```

with `look = badgeVisual(loaded.badge.level)` and `shape = BADGE_GROUPS.find((g) => g.id === family.group)?.shape ?? 'hex'` (as in `card-badge.tsx`). `export const dynamic = 'force-dynamic'`, `robots` noindex.

- [ ] **Step 5: Remove the batch web code** — `git rm -r apps/web/src/lib/discord/load-card-updates.ts "apps/web/src/app/internal/discord/card-updates"`.

- [ ] **Step 6:** `pnpm --filter @eanhl/db build && pnpm --filter web typecheck && pnpm --filter web test:unit` → clean / all pass.

- [ ] **Step 7: Commit** `feat(web): internal Discord unlock data route and transparent graphic page`.

---

### Task 4: Poster — unlock pass (replaces the card-batch pass)

**Files:**

- Modify: `apps/discord/src/web-client.ts` (+ `fetchUnlock`, − `fetchCardUpdates`), `render.ts` (`renderElement` + `omitBackground`, `scale`; + `renderUnlock`, − `renderCardUpdates`), `message.ts` (+ `MessagePayload`, `buildUnlockPayload`; − `buildCardUpdatesPayload`), `webhook.ts` + `dry-run.ts` (accept `WebhookPayload | MessagePayload`), `store.ts` (+ `dbUnlockStore`, − `dbCardStore`), `index.ts` (unlock pass), `preview-cli.ts` (`--unlock N` replaces `--card-batch N`)
- Create: `apps/discord/src/cycle-unlocks.ts`, `cycle-unlocks.test.ts`
- Delete: `apps/discord/src/cycle-cards.ts`, `cycle-cards.test.ts`; remove card-updates cases from `message.test.ts`, `web-client.test.ts`

**Interfaces (produces):**

- `fetchUnlock(opts: { webBaseUrl; token; eventId }, fetchImpl?): Promise<DiscordUnlock>` — GET `/internal/discord/unlock/<id>/data`, error `unlock data HTTP <status>`
- `renderElement(opts: { …; omitBackground?: boolean; scale?: number })`; `renderUnlock(o: { webBaseUrl; token; eventId; graphic: 'badge' | 'card'; timeoutMs }): Promise<Uint8Array>` (scale 2 badge / 3 card, `omitBackground: true`, selector `#discord-unlock`)
- `interface MessagePayload { allowed_mentions: { parse: never[] }; content: string; attachments?: { id: number; filename: string }[] }`
- `buildUnlockPayload(u: DiscordUnlock, opts: { siteUrl: string; hasImage: boolean }): MessagePayload`
- `interface UnlockStore { candidates(since, limit): Promise<number[]>; claim(id): Promise<boolean>; markPosted(id, messageId); markFailed(id, error); markSkipped(id, reason) }`
- `interface UnlockDeps { store: UnlockStore; fetchUnlock(id): Promise<DiscordUnlock>; render(id: number, graphic: 'badge' | 'card'): Promise<Uint8Array>; send(payload: MessagePayload, image: Uint8Array | null): Promise<string | null>; writeDryRun(key: string, payload: MessagePayload, image: Uint8Array | null): Promise<void>; pause(ms: number): Promise<void>; log(m: string): void; now(): Date }`
- `runUnlockCycle(deps: UnlockDeps, opts: CycleOptions): Promise<CycleSummary>`; `UNLOCK_LIMIT = 20`, `UNLOCK_GAP_MS = 2100`

- [ ] **Step 1: Failing tests**

`message.test.ts` — remove the two `card updates:` tests and the `buildCardUpdatesPayload` import; add (import `buildUnlockPayload`):

```ts
void test('unlock texts: bold linked capital name, no link preview, one line per kind, image under', () => {
  const u = (kind: 'badge' | 'card_level' | 'tier' | 'mythic', subject: string) =>
    buildUnlockPayload(
      { eventId: 1, playerId: 2, name: 'X_SNIPER_X', kind, subject, graphic: 'badge' },
      { siteUrl: 'https://boogeymen.app', hasImage: true },
    )
  assert.equal(
    u('badge', 'Shots · Carbon-Fiber I').content,
    '**[X\\_SNIPER\\_X](<https://boogeymen.app/roster/2>)** has unlocked **Shots · Carbon\\-Fiber I**!',
  )
  assert.match(u('tier', 'STUD').content, / has unlocked the \*\*STUD\*\* card!$/)
  assert.match(u('mythic', 'INFERNO').content, / has unlocked the \*\*INFERNO\*\* card!$/)
  assert.match(u('card_level', '5').content, / has reached \*\*card level 5\*\*!$/)
  const p = u('badge', 'Goals · Away I')
  assert.deepEqual(p.allowed_mentions, { parse: [] })
  assert.deepEqual(p.attachments, [{ id: 0, filename: 'unlock.png' }])
  assert.equal('embeds' in p, false)
  assert.equal(
    buildUnlockPayload(
      { eventId: 1, playerId: 2, name: 'A', kind: 'tier', subject: 'STUD', graphic: 'none' },
      { siteUrl: 'https://boogeymen.app', hasImage: false },
    ).attachments,
    undefined,
  )
})
```

`web-client.test.ts` — replace the `fetchCardUpdates` test with:

```ts
void test('fetchUnlock: token header, data route, contract-parsed', async () => {
  let url = ''
  const fake = (async (u: URL | string) => {
    url = String(u)
    return new Response('{"bad":1}', { status: 200 })
  }) as typeof fetch
  await assert.rejects(
    fetchUnlock({ webBaseUrl: 'http://web:3000', token: 't'.repeat(32), eventId: 9 }, fake),
    /discord contract/,
  )
  assert.equal(url, 'http://web:3000/internal/discord/unlock/9/data')
})
```

`cycle-unlocks.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordUnlock } from '@eanhl/db/discord'
import { runUnlockCycle, type UnlockDeps } from './cycle-unlocks.ts'
import type { MessagePayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

const unlock = (id: number, graphic: DiscordUnlock['graphic'] = 'badge'): DiscordUnlock => ({
  eventId: id,
  playerId: 2,
  name: 'SILKY',
  kind: 'badge',
  subject: 'Shots · Home II',
  graphic,
})

function harness(ids: number[], over: Partial<UnlockDeps> = {}) {
  const events: string[] = []
  const claimed = new Set<number>()
  const sent: { id: number; payload: MessagePayload; image: Uint8Array | null }[] = []
  let current = 0
  const deps: UnlockDeps = {
    store: {
      candidates: async () => ids,
      claim: async (id) => {
        if (claimed.has(id)) return false
        claimed.add(id)
        events.push(`claim:${String(id)}`)
        return true
      },
      markPosted: async (id) => void events.push(`posted:${String(id)}`),
      markFailed: async (id, e) => void events.push(`failed:${String(id)}:${e}`),
      markSkipped: async (id, r) => void events.push(`skipped:${String(id)}:${r}`),
    },
    fetchUnlock: async (id) => ((current = id), unlock(id)),
    render: async (id) => new Uint8Array([id]),
    send: async (payload, image) => (
      sent.push({ id: current, payload, image }),
      `m${String(current)}`
    ),
    writeDryRun: async (k) => void events.push(`dry:${k}`),
    pause: async (ms) => void events.push(`pause:${String(ms)}`),
    log: (m) => void events.push(`log:${m}`),
    now: () => new Date('2026-10-24T12:00:00Z'),
    ...over,
  }
  return { deps, events, sent }
}
const OPTS = {
  dryRun: false,
  siteUrl: 'https://boogeymen.app',
  windowMs: 86_400_000,
  batchLimit: 20,
}

void test('posts each unlock in candidate order, one message each, paused between sends', async () => {
  const h = harness([5, 6, 7])
  const s = await runUnlockCycle(h.deps, OPTS)
  assert.equal(s.posted, 3)
  assert.deepEqual(
    h.sent.map((x) => x.id),
    [5, 6, 7],
  )
  assert.equal(h.events.filter((e) => e.startsWith('pause:')).length, 2)
})

void test('not counted any more (404 from web) ⇒ claimed and skipped, never sent', async () => {
  const h = harness([5], {
    fetchUnlock: async () => {
      throw new Error('unlock data HTTP 404')
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('skipped:5:nothing to show'))
})

void test('web down (5xx / network) ⇒ nothing claimed, retried next cycle', async () => {
  const h = harness([5], {
    fetchUnlock: async () => {
      throw new Error('unlock data HTTP 502')
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.ok(!h.events.some((e) => e.startsWith('claim:')))
})

void test("graphic 'none' ⇒ text-only, no render", async () => {
  let rendered = false
  const h = harness([5], {
    fetchUnlock: async (id) => unlock(id, 'none'),
    render: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('a crash-like failure mid-run never re-sends earlier unlocks; unknown outcome stays pending', async () => {
  let n = 0
  const h = harness([5, 6, 7], {
    send: async () => {
      n++
      if (n === 2) throw new WebhookOutcomeUnknownError('timeout')
      return 'm'
    },
  })
  const s = await runUnlockCycle(h.deps, OPTS)
  assert.equal(s.posted, 2)
  assert.ok(!h.events.some((e) => e.startsWith('failed:6')))
  assert.ok(h.events.includes('posted:5') && h.events.includes('posted:7'))
})

void test('dry run writes each unlock and skips it', async () => {
  const h = harness([5, 6])
  const s = await runUnlockCycle(h.deps, { ...OPTS, dryRun: true })
  assert.equal(s.dryRun, 2)
  assert.ok(h.events.includes('dry:unlock-5') && h.events.includes('skipped:6:dry run'))
})
```

Run `pnpm --filter @eanhl/discord test` → Expected: FAIL (missing module/exports).

- [ ] **Step 2: Implement**

`message.ts` — add:

```ts
/** A plain Discord message (no embed): text plus an attached graphic. */
export interface MessagePayload {
  allowed_mentions: { parse: never[] }
  content: string
  attachments?: { id: number; filename: string }[]
}

export const UNLOCK_FILENAME = 'unlock.png'

/** One unlock: "**[NAME](<url>)** has unlocked **…**!" — markdown text, the graphic under it. */
export function buildUnlockPayload(
  u: DiscordUnlock,
  opts: { siteUrl: string; hasImage: boolean },
): MessagePayload {
  const who = `**[${escapeMarkdown(u.name)}](<${opts.siteUrl}/roster/${String(u.playerId)}>)**`
  const what = escapeMarkdown(u.subject)
  const content =
    u.kind === 'badge'
      ? `${who} has unlocked **${what}**!`
      : u.kind === 'card_level'
        ? `${who} has reached **card level ${what}**!`
        : `${who} has unlocked the **${what}** card!`
  const payload: MessagePayload = { allowed_mentions: { parse: [] }, content }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: UNLOCK_FILENAME }]
  return payload
}
```

and delete `buildCardUpdatesPayload` (keep `fitLines` only if still used; otherwise delete it too). Import `type DiscordUnlock`.

`webhook.ts` / `dry-run.ts`: change the `payload: WebhookPayload` parameter type to `WebhookPayload | MessagePayload`; `webhook.ts` attaches the file under the filename from `payload.attachments?.[0]?.filename ?? CARDS_FILENAME`.

`render.ts`: add `omitBackground?: boolean` and `scale?: number` to `renderElement` (context `deviceScaleFactor: opts.scale ?? 2`; screenshot `omitBackground: opts.omitBackground ?? false`); delete `renderCardUpdates`; add

```ts
/** One unlock's graphic: the badge (scale 2) or the full card (scale 3), transparent. */
export const renderUnlock = (o: {
  webBaseUrl: string
  token: string
  eventId: number
  graphic: 'badge' | 'card'
  timeoutMs: number
}): Promise<Uint8Array> =>
  renderElement({
    ...o,
    path: `/internal/discord/unlock/${String(o.eventId)}`,
    selector: '#discord-unlock',
    omitBackground: true,
    scale: o.graphic === 'card' ? 3 : 2,
  })
```

`web-client.ts`: replace `fetchCardUpdates` with `fetchUnlock` (path `/internal/discord/unlock/<id>/data`, error `unlock data HTTP <status>`, parsed by `parseDiscordUnlock`).

`cycle-unlocks.ts`:

```ts
import type { DiscordUnlock } from '@eanhl/db/discord'
import type { CycleOptions, CycleSummary } from './cycle.ts'
import { buildUnlockPayload, type MessagePayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

export const UNLOCK_LIMIT = 20
/** Discord allows ~30 webhook messages a minute per channel. */
export const UNLOCK_GAP_MS = 2100

export interface UnlockStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(eventId: number): Promise<boolean>
  markPosted(eventId: number, messageId: string | null): Promise<void>
  markFailed(eventId: number, error: string): Promise<void>
  markSkipped(eventId: number, reason: string): Promise<void>
}

export interface UnlockDeps {
  store: UnlockStore
  fetchUnlock(eventId: number): Promise<DiscordUnlock>
  render(eventId: number, graphic: 'badge' | 'card'): Promise<Uint8Array>
  send(payload: MessagePayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(key: string, payload: MessagePayload, image: Uint8Array | null): Promise<void>
  pause(ms: number): Promise<void>
  log(message: string): void
  now(): Date
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
/** The web route answers 404 when an unlock doesn't count any more. */
const gone = (err: unknown) => /HTTP 404\b/.test(message(err))

/**
 * One pass over unlocks, one Discord message each, in candidate order and
 * UNLOCK_GAP_MS apart. Same rules as the game pass: fetch before claiming (web
 * down ⇒ retry later; 404 ⇒ claim and skip), render (failure ⇒ text only),
 * send; once a send succeeded or might have, the row is never marked failed.
 * Each unlock is its own row, so a crash mid-run never re-sends earlier ones.
 */
export async function runUnlockCycle(deps: UnlockDeps, opts: CycleOptions): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  let sentBefore = false
  for (const id of await deps.store.candidates(since, opts.batchLimit)) {
    const tag = `unlock ${String(id)}`
    let u: DiscordUnlock
    try {
      u = await deps.fetchUnlock(id)
    } catch (err: unknown) {
      if (gone(err) && (await deps.store.claim(id))) {
        await deps.store.markSkipped(id, 'nothing to show')
      } else if (!gone(err)) {
        deps.log(`${tag}: data unavailable, will retry (${message(err)})`)
      }
      continue
    }
    if (!(await deps.store.claim(id))) continue
    let image: Uint8Array | null = null
    if (u.graphic !== 'none') {
      try {
        image = await deps.render(id, u.graphic)
      } catch (err: unknown) {
        deps.log(`${tag}: render failed, posting text only (${message(err)})`)
      }
    }
    const payload = buildUnlockPayload(u, { siteUrl: opts.siteUrl, hasImage: image !== null })
    if (opts.dryRun) {
      await deps.writeDryRun(`unlock-${String(id)}`, payload, image)
      await deps.store.markSkipped(id, 'dry run')
      summary.dryRun++
      continue
    }
    if (sentBefore) await deps.pause(UNLOCK_GAP_MS)
    let messageId: string | null
    try {
      messageId = await deps.send(payload, image)
    } catch (err: unknown) {
      sentBefore = true
      if (err instanceof WebhookOutcomeUnknownError) {
        deps.log(`${tag}: ${err.message} — left pending, not retried; check the channel`)
      } else {
        deps.log(`${tag}: failed (${message(err)})`)
        try {
          await deps.store.markFailed(id, message(err))
        } catch (markErr: unknown) {
          deps.log(`${tag}: could not record the failure — left pending (${message(markErr)})`)
        }
      }
      summary.failed++
      continue
    }
    sentBefore = true
    summary.posted++
    try {
      await deps.store.markPosted(id, messageId)
    } catch (err: unknown) {
      deps.log(`${tag}: posted but not recorded — left pending, not retried (${message(err)})`)
    }
  }
  return summary
}
```

`store.ts`: replace `dbCardStore` with `dbUnlockStore` (`listDiscordUnlockCandidates`, `claimDiscordUnlock`, `markDiscordUnlock*`).

`index.ts`: replace the card-batch pass with `runUnlockCycle({ store: dbUnlockStore, fetchUnlock: (id) => fetchUnlock({ ...web, eventId: id }), render: (id, graphic) => renderUnlock({ ...web, eventId: id, graphic, timeoutMs: config.renderTimeoutMs }), send, writeDryRun, pause: sleep, log, now }, { …same options, batchLimit: UNLOCK_LIMIT })`; log `unlock cycle: …` when non-zero. Fix the header comment ("writes only its discord\_\* tables").

`preview-cli.ts`: replace `--card-batch N` with `--unlock N` (fetch → render when `graphic !== 'none'` → `buildUnlockPayload` → write `<out>/unlock-<N>`).

`git rm apps/discord/src/cycle-cards.ts apps/discord/src/cycle-cards.test.ts`.

- [ ] **Step 3:** `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord test && pnpm --filter @eanhl/discord typecheck && pnpm --filter @eanhl/discord build` → all PASS, clean.

- [ ] **Step 4: Commit** `feat(discord): one message per unlock with a transparent graphic (replaces card-update batches)`.

---

### Task 5: Docs, review, deploy, test run

- [ ] **Step 1: Docs** — journal entry (2026-10-24, unlock posts), handoff Discord line in place (≤ 200 lines / 12 KB). Commit `docs(handoff): Discord unlock posts`.
- [ ] **Step 2: Final whole-branch review** (fresh reviewer) and the fix pass.
- [ ] **Step 3: Ask the operator for the deploy go-ahead.** Then: merge (fast-forward) and push; on Hotel-Echo pull, tag `eanhl-team-website-{web,discord}:rollback-he-2026-10-24-pre-unlocks`, `docker compose build web discord`, dump `~/eanhl-backups/pre-discord-unlock-posts-2026-10-24.dump`, apply 0069 (twice; `events = rows = skipped`), `docker compose up -d --no-deps web discord`; public `/internal/discord/unlock/1/data` → 404; poster log `started (live)`.
- [ ] **Step 4: Test run** — insert for player 28 on the active title, each its own batch, `occurred_at = date_trunc('milliseconds', now()) - interval '10 minutes' - k seconds`: `badge_level_up pshots 9→10`, `badge_level_up pgoals 0→1`, `level_up 2→3`, `tier_up 2→3`, and `mythic_awarded 2→6` **only if** player 28 has a `player_card_progress.mythic_theme` (otherwise report that the mythic message is covered by unit tests and skip it). Record the ids; wait for `posted` rows; then delete exactly those events (their unlock rows cascade). Show the operator.
