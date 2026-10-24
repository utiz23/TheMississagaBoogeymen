# Discord Card-Update Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post one "Card updates" message per batch of visible card changes (new badge numeral, card level, tier, mythic awarded) for real teammates, with their current compact cards.

**Architecture:** A batch = the `player_card_events` rows with one `(game_title_id, occurred_at)`, named by its smallest event id. Migration 0068 adds `discord_card_posts` (one row per batch, same claim rules as `discord_posts`). A pure `showcaseChanges` in `@eanhl/db/discord` decides what counts and the wording. The web app serves a token-guarded JSON route and a card page per batch; the `discord` service gets a second pass after games.

**Tech Stack:** TypeScript strict, Drizzle + hand-written SQL, Next.js 15, Playwright, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-discord-card-updates-design.md`

## Global Constraints

- Counts (§4 of the spec): `badge_level_up` only when `numeral(to) > numeral(from)` with `numeral(l) = l <= 0 ? 0 : min(6, ceil(l/5))`; `level_up`, `tier_up`, `mythic_awarded` always; `mythic_cleared` never. Members only (`MEMBER_CONDITION`), never AI goalies (`ai_goalie_side IS NULL`), active title only.
- Texts: `New badge: <Name> <to numeral>` · `<Name> <from> → <to>` · `Card level <from> → <to>` · `⬆ Tier: <Label> → <Label>` · `Mythic card awarded`. Per player: badge texts first, then level, tier, mythic; joined by `·`.
- Badge names = `BADGE_FAMILIES[].name`; tier labels = `TIER_LABELS`.
- Candidates: active title, `occurred_at` within 24 h, no row or `failed` with `attempts < 3`, settled (an `ingestion_log` row for the title with `started_at > occurred_at`), ≥ 1 counted event. `pending` never re-picked.
- Each poster cycle: games first, then card batches.
- Image: ≤ 9 compact medium cards (176×252), ≤ 3 per row, caption = the player's changes; plain attachment under the embed. Embed title `CARD UPDATES`, colour `0xe84131`.
- Raw `sql` fragments never take a JS `Date` param — pass `toISOString()` + `::timestamptz` (postgres.js rejects a Date there).
- Migration hand-written, idempotent; applied to live only after the operator's OK, after a dump. Live SQL checks run only inside transactions that are rolled back.
- No local DB on the main PC: previews use the read-only SSH tunnel (`?default_transaction_read_only=on`), per the operator-approved procedure.
- Gates: typecheck, unit tests, `pnpm format`. Rebuild `@eanhl/db` after editing it.

## Review Focus

1. A batch with only internal badge steps (13 → 14) plus one AI-goalie level up — must not post at all. Pinned in Task 1 (SQL counted-event clause) and Task 2 (`showcaseChanges`).
2. Badge 0 → 6 in one batch (a big jump) — reads `New badge: X II`, not `I`. Pinned in Task 2.
3. A mythic awarded from `/admin/cards` between worker cycles — waits for the next cycle start, then posts once. Pinned in Task 1 (settle clause) and Task 3 live check.
4. A player whose membership ended after the batch — the batch is skipped with `nothing to show`, not retried. Pinned in Task 5 (cycle test).
5. Twelve changed players in one batch — 9 cards, all 12 in the text. Pinned in Task 4 (loader slice) and Task 5 (message test).

---

### Task 1: Batch table, queries and SQL pins

**Files:**

- Modify: `packages/db/src/queries/club-members.ts` (export `MEMBER_CONDITION`)
- Create: `packages/db/migrations/0068_discord_card_posts.sql`
- Create: `packages/db/src/schema/discord-card-posts.ts`; modify `packages/db/src/schema/index.ts`
- Create: `packages/db/src/queries/discord-card-posts.ts`; modify `packages/db/src/queries/index.ts`
- Test: `packages/db/src/queries/__tests__/discord-card-posts.test.ts`

**Interfaces:**

- Produces (`@eanhl/db/queries`):
  - `discordCardBatchCandidatesSql(args: { since: Date; limit: number }): SQL`
  - `listDiscordCardBatchCandidates(args: { since: Date; limit: number }): Promise<number[]>`
  - `claimDiscordCardPostSql(batchEventId: number): SQL`; `claimDiscordCardPost(batchEventId: number): Promise<boolean>`
  - `markDiscordCardPostPosted(id: number, messageId: string | null)`, `markDiscordCardPostFailed(id: number, error: string)`, `markDiscordCardPostSkipped(id: number, reason: string)` — all `Promise<void>`
  - `interface CardEventRow { id: number; playerId: number; gamertag: string; aiGoalie: boolean; kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number }`
  - `getCardEventBatch(batchEventId: number): Promise<{ gameTitleId: number; occurredAt: Date; events: CardEventRow[] } | null>`

- [ ] **Step 1: Export the member condition**

In `club-members.ts`, change `const MEMBER_CONDITION = sql\`(`to`export const MEMBER_CONDITION = sql\`(`and add to its doc comment: "Uses the alias`p`for`players`." No behaviour change.

- [ ] **Step 2: Write the migration**

`packages/db/migrations/0068_discord_card_posts.sql`:

```sql
-- Migration: discord_card_posts — one row per batch of card changes posted (or skipped)
-- Spec: docs/superpowers/specs/2026-10-24-discord-card-updates-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-card-updates.md (task 1).
--
-- A batch = the player_card_events rows with one (game_title_id, occurred_at);
-- batch_event_id is the smallest event id in it. Same states as discord_posts:
-- pending (never re-picked: no double post), posted, failed (retried while
-- attempts < 3), skipped. Back-fills a skipped row for every existing batch so
-- launch never posts history.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0067):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0068_discord_card_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_card_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_card_posts" (
  "batch_event_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "player_card_events"("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles"("id") ON DELETE CASCADE,
  "occurred_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_card_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_card_posts" ("batch_event_id", "game_title_id", "occurred_at", "status", "last_error")
SELECT min("id"), "game_title_id", "occurred_at", 'skipped', 'before launch'
FROM "player_card_events"
GROUP BY "game_title_id", "occurred_at"
ON CONFLICT ("batch_event_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM (SELECT 1 FROM "player_card_events" GROUP BY "game_title_id", "occurred_at") b) AS "batches",
  (SELECT count(*) FROM "discord_card_posts") AS "rows",
  (SELECT count(*) FROM "discord_card_posts" WHERE "status" = 'skipped') AS "skipped";
```

- [ ] **Step 3: Write the Drizzle schema**

`packages/db/src/schema/discord-card-posts.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { playerCardEvents } from './player-card-progression.js'
import type { DiscordPostStatus } from './discord-posts.js'

/**
 * One row per batch of card changes the discord service posted or skipped
 * (migration 0068, hand-applied). A batch = the player_card_events rows with
 * one (game_title_id, occurred_at); batch_event_id is its smallest event id.
 * Same states and no-double-post rule as discord_posts.
 */
export const discordCardPosts = pgTable(
  'discord_card_posts',
  {
    batchEventId: bigint('batch_event_id', { mode: 'number' })
      .primaryKey()
      .references(() => playerCardEvents.id, { onDelete: 'cascade' }),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: text('status').$type<DiscordPostStatus>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    discordMessageId: text('discord_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'discord_card_posts_status_check',
      sql`${table.status} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)
```

Add `export * from './discord-card-posts.js'` to `schema/index.ts` after the `discord-posts` line.

- [ ] **Step 4: Write the failing SQL test**

`packages/db/src/queries/__tests__/discord-card-posts.test.ts`:

```ts
/**
 * SQL-shape pins for the card-batch queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-card-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-card-posts-test:unused@127.0.0.1:1/unused'

const { discordCardBatchCandidatesSql, claimDiscordCardPostSql } =
  await import('../discord-card-posts.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('candidates: active title, 24 h window passed as text, settled, counted events only', () => {
  const q = dialect.sqlToQuery(
    discordCardBatchCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 5 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = ev\.game_title_id and g\.is_active/)
  assert.match(s, /ev\.occurred_at > \$\d+::timestamptz/)
  assert.ok(q.params.includes('2026-10-24T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
  assert.match(s, /d\.batch_event_id is null or \(d\.status = 'failed' and d\.attempts < 3\)/)
  assert.match(s, /l\.game_title_id = b\.game_title_id and l\.started_at > b\.occurred_at/)
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /p\.pinned_to_roster/)
  assert.match(
    s,
    /ce\.kind = 'badge_level_up' and ceil\(ce\.to_value \/ 5\.0\) > ceil\(ce\.from_value \/ 5\.0\)/,
  )
  assert.match(s, /ce\.kind in \('level_up', 'tier_up', 'mythic_awarded'\)/)
  assert.doesNotMatch(s, /mythic_cleared/)
  assert.match(s, /order by b\.batch_event_id limit \$\d+/)
})

void test('claim: insert pending from the event row, or flip only a failed row under the cap', () => {
  const s = flat(dialect.sqlToQuery(claimDiscordCardPostSql(42)).sql)
  assert.match(
    s,
    /insert into discord_card_posts .* select ev\.id, ev\.game_title_id, ev\.occurred_at, 'pending', 1 from player_card_events ev where ev\.id = \$1/,
  )
  assert.match(
    s,
    /on conflict \(batch_event_id\) do update set status = 'pending', attempts = discord_card_posts\.attempts \+ 1/,
  )
  assert.match(
    s,
    /where discord_card_posts\.status = 'failed' and discord_card_posts\.attempts < 3/,
  )
  assert.match(s, /returning batch_event_id/)
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/queries/__tests__/discord-card-posts.test.js`
Expected: FAIL — `../discord-card-posts.js` missing.

- [ ] **Step 6: Write the queries**

`packages/db/src/queries/discord-card-posts.ts`:

```ts
import { and, asc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { discordCardPosts, playerCardEvents, players } from '../schema/index.js'
import type { BadgeFamilyId } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'

const MAX = sql.raw(String(DISCORD_MAX_ATTEMPTS))

/**
 * An event a card-update post shows (spec §4), alias `ce`: a new badge
 * numeral (every 5 internal steps), a card level up, a tier up, a mythic
 * award. Internal badge steps and cleared mythics never count.
 */
const COUNTED_EVENT = sql`(
  (ce.kind = 'badge_level_up' and ceil(ce.to_value / 5.0) > ceil(ce.from_value / 5.0))
  or ce.kind in ('level_up', 'tier_up', 'mythic_awarded')
)`

/**
 * Card batches the discord service may post: active title, inside the window,
 * no row or failed under the cap (pending is never re-picked), settled (the
 * worker's next cycle for that title began), and at least one counted event
 * for a real teammate (a member, never an AI goalie). The window is passed as
 * text: postgres.js rejects a Date param inside raw sql.
 */
export function discordCardBatchCandidatesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    with batches as (
      select ev.game_title_id, ev.occurred_at, min(ev.id) as batch_event_id
      from player_card_events ev
      join game_titles g on g.id = ev.game_title_id and g.is_active
      where ev.occurred_at > ${args.since.toISOString()}::timestamptz
      group by ev.game_title_id, ev.occurred_at
    )
    select b.batch_event_id
    from batches b
    left join discord_card_posts d on d.batch_event_id = b.batch_event_id
    where (d.batch_event_id is null or (d.status = 'failed' and d.attempts < ${MAX}))
      and exists (
        select 1 from ingestion_log l
        where l.game_title_id = b.game_title_id and l.started_at > b.occurred_at
      )
      and exists (
        select 1 from player_card_events ce
        join players p on p.id = ce.player_id
        where ce.game_title_id = b.game_title_id and ce.occurred_at = b.occurred_at
          and p.ai_goalie_side is null
          and ${MEMBER_CONDITION}
          and ${COUNTED_EVENT}
      )
    order by b.batch_event_id
    limit ${args.limit}`
}

export async function listDiscordCardBatchCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await db.execute<{ batch_event_id: string | number }>(
    discordCardBatchCandidatesSql(args),
  )
  return rows.map((r) => Number(r.batch_event_id))
}

/** Atomic claim, same rule as claimDiscordPost: new ⇒ pending; failed under the cap ⇒ pending. */
export function claimDiscordCardPostSql(batchEventId: number): SQL {
  return sql`
    insert into discord_card_posts (batch_event_id, game_title_id, occurred_at, status, attempts)
    select ev.id, ev.game_title_id, ev.occurred_at, 'pending', 1
    from player_card_events ev where ev.id = ${batchEventId}
    on conflict (batch_event_id) do update
      set status = 'pending', attempts = discord_card_posts.attempts + 1, updated_at = now()
      where discord_card_posts.status = 'failed' and discord_card_posts.attempts < ${MAX}
    returning batch_event_id`
}

export async function claimDiscordCardPost(batchEventId: number): Promise<boolean> {
  const rows = await db.execute(claimDiscordCardPostSql(batchEventId))
  return rows.length > 0
}

export async function markDiscordCardPostPosted(
  batchEventId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export async function markDiscordCardPostFailed(
  batchEventId: number,
  error: string,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export async function markDiscordCardPostSkipped(
  batchEventId: number,
  reason: string,
): Promise<void> {
  await db
    .update(discordCardPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordCardPosts.batchEventId, batchEventId))
}

export interface CardEventRow {
  id: number
  playerId: number
  gamertag: string
  aiGoalie: boolean
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

/** Every event of the batch named by `batchEventId`, in id order; null if no such event. */
export async function getCardEventBatch(
  batchEventId: number,
): Promise<{ gameTitleId: number; occurredAt: Date; events: CardEventRow[] } | null> {
  const [head] = await db
    .select({ gameTitleId: playerCardEvents.gameTitleId, occurredAt: playerCardEvents.occurredAt })
    .from(playerCardEvents)
    .where(eq(playerCardEvents.id, batchEventId))
  if (!head) return null
  const rows = await db
    .select({
      id: playerCardEvents.id,
      playerId: playerCardEvents.playerId,
      gamertag: players.gamertag,
      aiGoalieSide: players.aiGoalieSide,
      kind: playerCardEvents.kind,
      familyId: playerCardEvents.familyId,
      fromValue: playerCardEvents.fromValue,
      toValue: playerCardEvents.toValue,
    })
    .from(playerCardEvents)
    .innerJoin(players, eq(players.id, playerCardEvents.playerId))
    .where(
      and(
        eq(playerCardEvents.gameTitleId, head.gameTitleId),
        eq(playerCardEvents.occurredAt, head.occurredAt),
      ),
    )
    .orderBy(asc(playerCardEvents.id))
  return {
    gameTitleId: head.gameTitleId,
    occurredAt: head.occurredAt,
    events: rows.map(({ aiGoalieSide, ...r }) => ({ ...r, aiGoalie: aiGoalieSide !== null })),
  }
}
```

Add `export * from './discord-card-posts.js'` to `queries/index.ts` after `discord-posts`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/queries/__tests__/discord-card-posts.test.js packages/db/dist/queries/__tests__/discord-posts.test.js`
Expected: PASS. If a regex misses only on whitespace or quoting of the real rendering, tighten it to the real text — never loosen to `.*` across clauses.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add packages/db/migrations/0068_discord_card_posts.sql packages/db/src/schema packages/db/src/queries
git commit -m "feat(db): discord_card_posts batches and card-update queries (migration 0068)"
```

---

### Task 2: `showcaseChanges` and the card-updates contract (pure)

**Files:**

- Create: `packages/db/src/discord/card-updates.ts`, `packages/db/src/discord/card-updates.test.ts`
- Modify: `packages/db/src/discord/contract.ts`, `contract.test.ts`, `discord/index.ts`

**Interfaces:**

- Produces (`@eanhl/db/discord`):
  - `badgeNumeral(level: number): string` (`''` for ≤ 0)
  - `interface ShowcaseEvent { id: number; playerId: number; kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number }`
  - `showcaseText(e: ShowcaseEvent): string | null`
  - `showcaseChanges(events: readonly ShowcaseEvent[], eligible: (playerId: number) => boolean): { playerId: number; changes: string[] }[]`
  - `interface DiscordCardUpdates { batchEventId: number; gameTitleName: string; players: { playerId: number; name: string; changes: string[] }[]; cardCount: number }`
  - `parseDiscordCardUpdates(value: unknown): DiscordCardUpdates`

- [ ] **Step 1: Write the failing tests**

`packages/db/src/discord/card-updates.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeNumeral, showcaseChanges, showcaseText, type ShowcaseEvent } from './card-updates.js'

const ev = (over: Partial<ShowcaseEvent>): ShowcaseEvent => ({
  id: 1,
  playerId: 2,
  kind: 'badge_level_up',
  familyId: 'p6g',
  fromValue: 0,
  toValue: 1,
  ...over,
})

void test('badgeNumeral: every 5 internal steps, capped at VI', () => {
  assert.deepEqual([0, 1, 5, 6, 10, 11, 30, 40].map(badgeNumeral), [
    '',
    'I',
    'I',
    'II',
    'II',
    'III',
    'VI',
    'VI',
  ])
})

void test('badge texts: new badge uses the numeral reached; upgrades only when the numeral changes', () => {
  const name = (t: string | null) => t
  assert.match(name(showcaseText(ev({ fromValue: 0, toValue: 1 })))!, /^New badge: .+ I$/)
  assert.match(name(showcaseText(ev({ fromValue: 0, toValue: 6 })))!, /^New badge: .+ II$/)
  assert.match(name(showcaseText(ev({ fromValue: 5, toValue: 6 })))!, /^.+ I → II$/)
  assert.equal(showcaseText(ev({ fromValue: 13, toValue: 14 })), null)
  assert.equal(showcaseText(ev({ fromValue: 6, toValue: 10 })), null)
})

void test('level, tier, mythic texts; mythic cleared never shows', () => {
  assert.equal(
    showcaseText(ev({ kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 })),
    'Card level 4 → 5',
  )
  assert.equal(
    showcaseText(ev({ kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 })),
    '⬆ Tier: Rookie → Stud',
  )
  assert.equal(
    showcaseText(ev({ kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 })),
    'Mythic card awarded',
  )
  assert.equal(
    showcaseText(ev({ kind: 'mythic_cleared', familyId: null, fromValue: 6, toValue: 3 })),
    null,
  )
})

void test('showcaseChanges: per player, badges then level/tier/mythic, players in first-event order, ineligible dropped', () => {
  const out = showcaseChanges(
    [
      ev({ id: 10, playerId: 7, kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 }),
      ev({ id: 11, playerId: 7, familyId: 'p6g', fromValue: 10, toValue: 11 }),
      ev({ id: 12, playerId: 9, familyId: 'p6g', fromValue: 13, toValue: 14 }),
      ev({ id: 13, playerId: 3, kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 }),
      ev({ id: 14, playerId: 99, kind: 'level_up', familyId: null, fromValue: 1, toValue: 2 }),
    ],
    (id) => id !== 99,
  )
  assert.deepEqual(
    out.map((p) => p.playerId),
    [7, 3],
  )
  assert.equal(out[0]?.changes.length, 2)
  assert.match(out[0]?.changes[0] ?? '', / II → III$/)
  assert.equal(out[0]?.changes[1], 'Card level 4 → 5')
  assert.deepEqual(out[1]?.changes, ['⬆ Tier: Rookie → Stud'])
})

void test('showcaseChanges: nothing counted ⇒ empty', () => {
  assert.deepEqual(
    showcaseChanges([ev({ fromValue: 13, toValue: 14 })], () => true),
    [],
  )
})
```

Append to `packages/db/src/discord/contract.test.ts` (add `parseDiscordCardUpdates` to the import):

```ts
void test('card updates: valid round-trip; bad shapes rejected', () => {
  const v = {
    batchEventId: 500,
    gameTitleName: 'NHL 27',
    players: [{ playerId: 2, name: 'Silky', changes: ['Goals II → III'] }],
    cardCount: 1,
  }
  assert.deepEqual(parseDiscordCardUpdates(JSON.parse(JSON.stringify(v))), v)
  assert.throws(() => parseDiscordCardUpdates({ ...v, cardCount: -1 }), /cardCount/)
  assert.throws(
    () => parseDiscordCardUpdates({ ...v, players: [{ playerId: 2, name: 'x', changes: [1] }] }),
    /changes/,
  )
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/discord/card-updates.test.js packages/db/dist/discord/contract.test.js`
Expected: FAIL (build: module and export missing).

- [ ] **Step 3: Implement**

`packages/db/src/discord/card-updates.ts`:

```ts
/**
 * What a Discord card-update post shows (spec §4): pure, shared by the web
 * loader and its tests. Badge levels are internal steps 1–30; the site shows
 * one Roman numeral per 5 steps (card-badge.tsx), so only a numeral change
 * counts.
 */
import {
  BADGE_FAMILIES,
  TIER_LABELS,
  type BadgeFamilyId,
  type CardTier,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

const numeralIndex = (level: number) => (level <= 0 ? 0 : Math.min(6, Math.ceil(level / 5)))

/** The site's Roman numeral for an internal badge level; '' for no badge. */
export function badgeNumeral(level: number): string {
  const i = numeralIndex(level)
  return i === 0 ? '' : (ROMAN[i - 1] ?? '')
}

export interface ShowcaseEvent {
  id: number
  playerId: number
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

const familyName = (id: BadgeFamilyId | null) =>
  BADGE_FAMILIES.find((f) => f.id === id)?.name ?? String(id)
const tierLabel = (t: number) => TIER_LABELS[t as CardTier] ?? String(t)

/** The line text for one event, or null when it doesn't count. */
export function showcaseText(e: ShowcaseEvent): string | null {
  switch (e.kind) {
    case 'badge_level_up': {
      if (numeralIndex(e.toValue) <= numeralIndex(e.fromValue)) return null
      const name = familyName(e.familyId)
      return numeralIndex(e.fromValue) === 0
        ? `New badge: ${name} ${badgeNumeral(e.toValue)}`
        : `${name} ${badgeNumeral(e.fromValue)} → ${badgeNumeral(e.toValue)}`
    }
    case 'level_up':
      return `Card level ${String(e.fromValue)} → ${String(e.toValue)}`
    case 'tier_up':
      return `⬆ Tier: ${tierLabel(e.fromValue)} → ${tierLabel(e.toValue)}`
    case 'mythic_awarded':
      return 'Mythic card awarded'
    default:
      return null
  }
}

const KIND_ORDER: Partial<Record<CardEventKind, number>> = {
  badge_level_up: 0,
  level_up: 1,
  tier_up: 2,
  mythic_awarded: 3,
}

/**
 * Each eligible player's counted changes, players in order of their first
 * counted event, texts ordered badges → level → tier → mythic.
 */
export function showcaseChanges(
  events: readonly ShowcaseEvent[],
  eligible: (playerId: number) => boolean,
): { playerId: number; changes: string[] }[] {
  const byPlayer = new Map<
    number,
    { first: number; items: { order: number; id: number; text: string }[] }
  >()
  for (const e of events) {
    if (!eligible(e.playerId)) continue
    const text = showcaseText(e)
    if (text === null) continue
    const entry = byPlayer.get(e.playerId) ?? { first: e.id, items: [] }
    entry.first = Math.min(entry.first, e.id)
    entry.items.push({ order: KIND_ORDER[e.kind] ?? 9, id: e.id, text })
    byPlayer.set(e.playerId, entry)
  }
  return [...byPlayer.entries()]
    .sort((a, b) => a[1].first - b[1].first)
    .map(([playerId, v]) => ({
      playerId,
      changes: v.items.sort((a, b) => a.order - b.order || a.id - b.id).map((i) => i.text),
    }))
}
```

In `contract.ts`, append:

```ts
export interface DiscordCardUpdates {
  /** Smallest player_card_events.id of the batch — its name. */
  batchEventId: number
  gameTitleName: string
  /** Players with counted changes, in first-event order. */
  players: { playerId: number; name: string; changes: string[] }[]
  /** Cards in the image (≤ 9). 0 ⇒ no image. */
  cardCount: number
}

export function parseDiscordCardUpdates(value: unknown): DiscordCardUpdates {
  const o = obj(value, 'root')
  const playersRaw = o['players']
  if (!Array.isArray(playersRaw)) fail('players', 'is not an array')
  const players = playersRaw.map((p, i) => {
    const path = `players[${String(i)}]`
    const po = obj(p, path)
    const changes = po['changes']
    if (!Array.isArray(changes)) fail(`${path}.changes`, 'is not an array')
    return {
      playerId: int(po['playerId'], `${path}.playerId`),
      name: str(po['name'], `${path}.name`),
      changes: changes.map((c, j) => str(c, `${path}.changes[${String(j)}]`)),
    }
  })
  const cardCount = int(o['cardCount'], 'cardCount')
  if (cardCount < 0) fail('cardCount', 'is negative')
  return {
    batchEventId: int(o['batchEventId'], 'batchEventId'),
    gameTitleName: str(o['gameTitleName'], 'gameTitleName'),
    players,
    cardCount,
  }
}
```

In `discord/index.ts` add `export * from './card-updates.js'`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/discord/card-updates.test.js packages/db/dist/discord/contract.test.js`
Expected: PASS. (`badge-catalog.js` and `progression.js` must be importable without `DATABASE_URL`; they are pure.)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/db/src/discord
git commit -m "feat(db): showcaseChanges and the Discord card-updates contract"
```

---

### Task 3: Live migration and rolled-back live checks (operator-gated)

- [ ] **Step 1: Ask the operator** for OK to (a) dump the live DB and apply 0068 on Hotel-Echo, (b) run the candidate/claim checks against live inside rolled-back transactions. Stop until the answer is yes.

- [ ] **Step 2: Dump and apply**

```bash
ssh hotel-echo 'cd ~/eanhl-team-website && git pull -q --ff-only && \
  docker exec eanhl-team-website-db-1 pg_dump -U eanhl -d eanhl -Fc > ~/eanhl-backups/pre-discord-card-posts-$(date +%F).dump && \
  docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" eanhl-team-website-db-1 \
    psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - < packages/db/migrations/0068_discord_card_posts.sql | tail -3'
```

Expected: `batches = rows = skipped`. Run again: same counts (idempotent). (Pull needs the branch on GitHub or the file copied: if the work is on an unpushed branch, `scp packages/db/migrations/0068_discord_card_posts.sql hotel-echo:/tmp/` and apply from `/tmp` instead of pulling.)

- [ ] **Step 3: Rolled-back live checks**

Render the two SQL texts with the built package (`new PgDialect().sqlToQuery(...)`, params inlined only for this check), then in one `psql` session on Hotel-Echo:

```sql
BEGIN;
-- (a) nothing is a candidate right after launch
<candidates SQL with since = now() - interval '24 hours', limit 5>;              -- expect 0 rows
-- (b) a fresh counted batch for a member: un-skip the newest batch that has a counted member event
DELETE FROM discord_card_posts WHERE batch_event_id = <id>;
UPDATE player_card_events SET occurred_at = now() - interval '1 hour'
  WHERE game_title_id = <t> AND occurred_at = <its occurred_at>;
<candidates SQL>;                                          -- expect <id> (settled: a later ingestion_log row exists)
<claim SQL for id>;                                        -- expect 1 row
<claim SQL for id>;                                        -- expect 0 rows (pending never re-claimed)
ROLLBACK;
```

Expected as commented. Then confirm the live table is unchanged (`select count(*), max(updated_at) from discord_card_posts`).

- [ ] **Step 4:** No commit (no code change). Ledger the results.

---

### Task 4: Web — loader, JSON route, card page

**Files:**

- Create: `apps/web/src/lib/discord/load-card-updates.ts`
- Create: `apps/web/src/app/internal/discord/card-updates/[batchEventId]/data/route.ts`
- Create: `apps/web/src/app/internal/discord/card-updates/[batchEventId]/page.tsx`

**Interfaces:**

- Consumes: Task 1 `getCardEventBatch`; Task 2 `showcaseChanges`, `DiscordCardUpdates`; existing `getClubMemberIds`, `getEARoster`, `getRosterCarryOvers`, `getCardProgressForPlayers`, `listAllGameTitles`, `cardFromRosterRow`, `PlayerCardCompact`, token guard.
- Produces: `loadDiscordCardUpdates(batchEventId: number): Promise<{ data: DiscordCardUpdates; cards: { playerId: number; card: CardViewModel; caption: string }[] } | null>`

- [ ] **Step 1: Write the loader**

```ts
import { showcaseChanges, type DiscordCardUpdates } from '@eanhl/db/discord'
import {
  getCardEventBatch,
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getRosterCarryOvers,
  listAllGameTitles,
} from '@eanhl/db/queries'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import type { CardViewModel } from '@/components/cards/card-model'

/** Cards in the image; extra players appear in the text only. */
const MAX_CARDS = 9

/**
 * One batch of card changes for the Discord post: the counted changes per
 * real teammate (members, never AI goalies), and each player's current card
 * for that title, built the way the site builds it.
 */
export async function loadDiscordCardUpdates(batchEventId: number): Promise<{
  data: DiscordCardUpdates
  cards: { playerId: number; card: CardViewModel; caption: string }[]
} | null> {
  const batch = await getCardEventBatch(batchEventId)
  if (!batch) return null
  const [titles, memberIdList] = await Promise.all([listAllGameTitles(), getClubMemberIds()])
  const members = new Set(memberIdList)
  const aiGoalies = new Set(batch.events.filter((e) => e.aiGoalie).map((e) => e.playerId))
  const shown = showcaseChanges(batch.events, (id) => members.has(id) && !aiGoalies.has(id))
  const gamertags = new Map(batch.events.map((e) => [e.playerId, e.gamertag]))

  const ids = shown.map((p) => p.playerId)
  const [roster, carryOvers, summaries] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : getEARoster(batch.gameTitleId),
    ids.length === 0 ? Promise.resolve([]) : getRosterCarryOvers(batch.gameTitleId),
    getCardProgressForPlayers(ids, batch.gameTitleId),
  ])
  const rows = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))

  const cards = shown
    .flatMap((p) => {
      const row = rows.get(p.playerId)
      return row
        ? [
            {
              playerId: p.playerId,
              card: cardFromRosterRow(row, summaries.get(p.playerId)),
              caption: p.changes.join(' · '),
            },
          ]
        : []
    })
    .slice(0, MAX_CARDS)
  const names = new Map(cards.map((c) => [c.playerId, c.card.front.name]))

  return {
    data: {
      batchEventId,
      gameTitleName: titles.find((t) => t.id === batch.gameTitleId)?.name ?? '',
      players: shown.map((p) => ({
        playerId: p.playerId,
        name: names.get(p.playerId) ?? gamertags.get(p.playerId) ?? `#${String(p.playerId)}`,
        changes: p.changes,
      })),
      cardCount: cards.length,
    },
    cards,
  }
}
```

If `typecheck` rejects the `Promise.resolve([])` branches, type them as `Promise.resolve([] as Awaited<ReturnType<typeof getEARoster>>)` (and likewise for carry-overs) — no `any`.

- [ ] **Step 2: Write the JSON route** — `…/card-updates/[batchEventId]/data/route.ts`: same shape as `internal/discord/game/[matchId]/route.ts` (token guard → 404; parse `batchEventId` as a positive safe integer → else 404; `loadDiscordCardUpdates` → null ⇒ 404; `NextResponse.json(loaded.data, { headers: { 'cache-control': 'no-store' } })`), `export const dynamic = 'force-dynamic'`.

- [ ] **Step 3: Write the page** — `…/card-updates/[batchEventId]/page.tsx`: same guard and full-viewport backdrop as the lineup page; `notFound()` when null or `cards.length === 0`; `#discord-card-updates` is an `inline-grid` with `repeat(${Math.min(3, cards.length)}, 176px)`, gap 12, padding 12; each cell = `<PlayerCardCompact card={c.card.front} size="medium" />` plus a caption `div` (width 176, centered, 13 px, weight 700, `var(--color-fg-2, #d6d3d4)`, wraps).

- [ ] **Step 4: Typecheck and unit suite**

Run: `pnpm --filter @eanhl/db build && pnpm --filter web typecheck && pnpm --filter web test:unit`
Expected: clean; all pass.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/web/src/lib/discord/load-card-updates.ts "apps/web/src/app/internal/discord/card-updates"
git commit -m "feat(web): internal Discord card-update data route and card page"
```

---

### Task 5: Poster — card-update pass

**Files:**

- Modify: `apps/discord/src/web-client.ts` (+ `fetchCardUpdates`), `render.ts` (generic `renderElement`), `message.ts` (+ `buildCardUpdatesPayload`), `store.ts` (+ `dbCardStore`), `index.ts` (second pass), `preview-cli.ts` (`--card-batch N`)
- Create: `apps/discord/src/cycle-cards.ts`
- Test: `apps/discord/src/cycle-cards.test.ts`, `message.test.ts` (append), `web-client.test.ts` (append)

**Interfaces:**

- Produces:
  - `fetchCardUpdates(opts: { webBaseUrl: string; token: string; batchEventId: number }, fetchImpl?): Promise<DiscordCardUpdates>`
  - `renderElement(opts: { webBaseUrl: string; token: string; path: string; selector: string; timeoutMs: number }): Promise<Uint8Array>`; `renderLineup` and `renderCardUpdates(opts: { webBaseUrl; token; batchEventId; timeoutMs })` call it
  - `buildCardUpdatesPayload(d: DiscordCardUpdates, opts: { siteUrl: string; hasImage: boolean }): WebhookPayload`
  - `interface CardPostStore { candidates(since: Date, limit: number): Promise<number[]>; claim(id: number): Promise<boolean>; markPosted(id: number, messageId: string | null): Promise<void>; markFailed(id: number, error: string): Promise<void>; markSkipped(id: number, reason: string): Promise<void> }`
  - `interface CardPosterDeps { store: CardPostStore; fetchCardUpdates(id: number): Promise<DiscordCardUpdates>; renderCards(id: number): Promise<Uint8Array>; send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>; writeDryRun(key: string, payload: WebhookPayload, image: Uint8Array | null): Promise<void>; log(m: string): void; now(): Date }`
  - `runCardUpdatesCycle(deps: CardPosterDeps, opts: CycleOptions): Promise<CycleSummary>`

- [ ] **Step 1: Write the failing tests**

`apps/discord/src/cycle-cards.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordCardUpdates } from '@eanhl/db/discord'
import { runCardUpdatesCycle, type CardPosterDeps } from './cycle-cards.ts'
import type { WebhookPayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

const data = (players: number): DiscordCardUpdates => ({
  batchEventId: 500,
  gameTitleName: 'NHL 27',
  players: Array.from({ length: players }, (_, i) => ({
    playerId: i + 1,
    name: `P${String(i + 1)}`,
    changes: ['Goals II → III'],
  })),
  cardCount: Math.min(players, 9),
})

function harness(over: Partial<CardPosterDeps> = {}) {
  const events: string[] = []
  const claimed = new Set<number>()
  const sent: { payload: WebhookPayload; image: Uint8Array | null }[] = []
  const deps: CardPosterDeps = {
    store: {
      candidates: async () => [500],
      claim: async (id) =>
        claimed.has(id) ? false : (claimed.add(id), events.push(`claim:${String(id)}`), true),
      markPosted: async (id, m) => void events.push(`posted:${String(id)}:${String(m)}`),
      markFailed: async (id, e) => void events.push(`failed:${String(id)}:${e}`),
      markSkipped: async (id, r) => void events.push(`skipped:${String(id)}:${r}`),
    },
    fetchCardUpdates: async () => data(2),
    renderCards: async () => new Uint8Array([1]),
    send: async (payload, image) => (sent.push({ payload, image }), 'msg'),
    writeDryRun: async (k) => void events.push(`dry:${k}`),
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
  batchLimit: 5,
}

void test('happy path: claim, render, send with image, mark posted', async () => {
  const h = harness()
  const s = await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(s.posted, 1)
  assert.ok(h.events.includes('posted:500:msg'))
  assert.equal(h.sent[0]?.image?.length, 1)
})

void test('web down ⇒ nothing claimed, retried next cycle', async () => {
  const h = harness({
    fetchCardUpdates: async () => {
      throw new Error('card data HTTP 502')
    },
  })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.ok(!h.events.some((e) => e.startsWith('claim:') || e.startsWith('failed:')))
})

void test('nothing to show (membership changed) ⇒ skipped, never sent', async () => {
  const h = harness({ fetchCardUpdates: async () => data(0) })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('skipped:500:nothing to show'))
})

void test('no cards ⇒ text-only, no render', async () => {
  let rendered = false
  const h = harness({
    fetchCardUpdates: async () => ({ ...data(1), cardCount: 0 }),
    renderCards: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('unknown send outcome stays pending; markPosted failure never re-posts', async () => {
  const a = harness({
    send: async () => {
      throw new WebhookOutcomeUnknownError('x')
    },
  })
  await runCardUpdatesCycle(a.deps, OPTS)
  assert.ok(!a.events.some((e) => e.startsWith('failed:')))
  const b = harness()
  b.deps.store.markPosted = async () => {
    throw new Error('reset')
  }
  await runCardUpdatesCycle(b.deps, OPTS)
  assert.ok(!b.events.some((e) => e.startsWith('failed:')))
})

void test('dry run writes and skips', async () => {
  const h = harness()
  const s = await runCardUpdatesCycle(h.deps, { ...OPTS, dryRun: true })
  assert.equal(s.dryRun, 1)
  assert.ok(h.events.includes('dry:card-500'))
  assert.ok(h.events.includes('skipped:500:dry run'))
})
```

Append to `message.test.ts` (add `buildCardUpdatesPayload` to the import from `./message.ts`):

```ts
void test('card updates: red CARD UPDATES box, one linked line per player, image under the box, all players in text', () => {
  const d = {
    batchEventId: 500,
    gameTitleName: 'NHL 27',
    players: Array.from({ length: 12 }, (_, i) => ({
      playerId: i + 1,
      name: i === 0 ? 'x_Sniper_x' : `P${String(i + 1)}`,
      changes: ['New badge: Goals I', 'Card level 4 → 5'],
    })),
    cardCount: 9,
  }
  const p = buildCardUpdatesPayload(d, { siteUrl: 'https://boogeymen.app', hasImage: true })
  const e = p.embeds[0]!
  assert.equal(e.title, 'CARD UPDATES')
  assert.equal(e.color, 0xe84131)
  assert.equal(e.image, undefined)
  assert.deepEqual(p.attachments, [{ id: 0, filename: 'cards.png' }])
  assert.deepEqual(p.allowed_mentions, { parse: [] })
  assert.equal(e.description.split('\n').length, 12)
  assert.match(
    e.description,
    /^\[x\\_Sniper\\_x\]\(https:\/\/boogeymen\.app\/roster\/1\) — New badge\\: Goals I · Card level 4 → 5$/m,
  )
})
```

Append to `web-client.test.ts` (add `fetchCardUpdates` to the import):

```ts
void test('fetchCardUpdates: token header, data route, contract-parsed', async () => {
  let url = ''
  const fake = (async (u: URL | string) => {
    url = String(u)
    return new Response('{"bad":1}', { status: 200 })
  }) as typeof fetch
  await assert.rejects(
    fetchCardUpdates(
      { webBaseUrl: 'http://web:3000', token: 't'.repeat(32), batchEventId: 500 },
      fake,
    ),
    /discord contract/,
  )
  assert.equal(url, 'http://web:3000/internal/discord/card-updates/500/data')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord test`
Expected: FAIL — `./cycle-cards.ts` missing, exports missing.

- [ ] **Step 3: Implement**

`web-client.ts` — add:

```ts
export async function fetchCardUpdates(
  opts: { webBaseUrl: string; token: string; batchEventId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordCardUpdates> {
  const res = await fetchImpl(
    `${opts.webBaseUrl}/internal/discord/card-updates/${String(opts.batchEventId)}/data`,
    { headers: { [INTERNAL_TOKEN_HEADER]: opts.token }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`card data HTTP ${String(res.status)}`)
  return parseDiscordCardUpdates(await res.json())
}
```

(import `parseDiscordCardUpdates, type DiscordCardUpdates` from `@eanhl/db/discord`).

`render.ts` — rename the body of `renderLineup` into `renderElement(opts: { webBaseUrl; token; path; selector; timeoutMs })` (the URL is `${webBaseUrl}${path}`, the locator `selector`; everything else unchanged), then:

```ts
export const renderLineup = (o: {
  webBaseUrl: string
  token: string
  matchId: number
  timeoutMs: number
}) =>
  renderElement({
    ...o,
    path: `/internal/discord/lineup/${String(o.matchId)}`,
    selector: '#discord-lineup',
  })

export const renderCardUpdates = (o: {
  webBaseUrl: string
  token: string
  batchEventId: number
  timeoutMs: number
}) =>
  renderElement({
    ...o,
    path: `/internal/discord/card-updates/${String(o.batchEventId)}`,
    selector: '#discord-card-updates',
  })
```

`message.ts` — add:

```ts
/** One "Card updates" post: one linked line per player, the image under the box. */
export function buildCardUpdatesPayload(
  d: DiscordCardUpdates,
  opts: { siteUrl: string; hasImage: boolean },
): WebhookPayload {
  const description = d.players
    .map(
      (p) =>
        `[${escapeMarkdown(p.name)}](${opts.siteUrl}/roster/${String(p.playerId)}) — ${p.changes.map(escapeMarkdown).join(' · ')}`,
    )
    .join('\n')
  const payload: WebhookPayload = {
    allowed_mentions: { parse: [] },
    embeds: [{ title: 'CARD UPDATES', url: opts.siteUrl, color: 0xe84131, description }],
  }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: CARDS_FILENAME }]
  return payload
}
```

(import `type DiscordCardUpdates`.) Note `escapeMarkdown` turns `New badge:` into `New badge\:` (renders as `:`), as the test expects.

`cycle-cards.ts`:

```ts
import type { DiscordCardUpdates } from '@eanhl/db/discord'
import type { CycleOptions, CycleSummary } from './cycle.ts'
import { buildCardUpdatesPayload, type WebhookPayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

export interface CardPostStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(batchEventId: number): Promise<boolean>
  markPosted(batchEventId: number, messageId: string | null): Promise<void>
  markFailed(batchEventId: number, error: string): Promise<void>
  markSkipped(batchEventId: number, reason: string): Promise<void>
}

export interface CardPosterDeps {
  store: CardPostStore
  fetchCardUpdates(batchEventId: number): Promise<DiscordCardUpdates>
  renderCards(batchEventId: number): Promise<Uint8Array>
  send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(key: string, payload: WebhookPayload, image: Uint8Array | null): Promise<void>
  log(message: string): void
  now(): Date
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * One pass over card batches — the same order and no-double-post rules as the
 * game pass (cycle.ts): fetch before claiming (web down ⇒ retry later), claim,
 * render (failure ⇒ text only), send; once a send succeeded or might have, the
 * row is never marked failed. A batch with nothing left to show is skipped.
 */
export async function runCardUpdatesCycle(
  deps: CardPosterDeps,
  opts: CycleOptions,
): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  for (const id of await deps.store.candidates(since, opts.batchLimit)) {
    const tag = `card batch ${String(id)}`
    let data: DiscordCardUpdates
    try {
      data = await deps.fetchCardUpdates(id)
    } catch (err: unknown) {
      deps.log(`${tag}: data unavailable, will retry (${message(err)})`)
      continue
    }
    if (!(await deps.store.claim(id))) continue
    if (data.players.length === 0) {
      await deps.store.markSkipped(id, 'nothing to show')
      continue
    }
    let image: Uint8Array | null = null
    if (data.cardCount > 0) {
      try {
        image = await deps.renderCards(id)
      } catch (err: unknown) {
        deps.log(`${tag}: card render failed, posting text only (${message(err)})`)
      }
    }
    const payload = buildCardUpdatesPayload(data, {
      siteUrl: opts.siteUrl,
      hasImage: image !== null,
    })
    if (opts.dryRun) {
      await deps.writeDryRun(`card-${String(id)}`, payload, image)
      await deps.store.markSkipped(id, 'dry run')
      summary.dryRun++
      continue
    }
    let messageId: string | null
    try {
      messageId = await deps.send(payload, image)
    } catch (err: unknown) {
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

`dry-run.ts`: change `writeDryRunFiles(outDir, matchId: number, …)` to take `key: string | number` (directory name `String(key)`); callers keep working.

`store.ts`: add

```ts
export const dbCardStore: CardPostStore = {
  candidates: (since, limit) => listDiscordCardBatchCandidates({ since, limit }),
  claim: claimDiscordCardPost,
  markPosted: markDiscordCardPostPosted,
  markFailed: markDiscordCardPostFailed,
  markSkipped: markDiscordCardPostSkipped,
}
```

`index.ts`: after the `runPosterCycle(...)` call inside the loop's `try`, add a `runCardUpdatesCycle` call with `store: dbCardStore`, `fetchCardUpdates: (id) => fetchCardUpdates({ ...web, batchEventId: id })`, `renderCards: (id) => renderCardUpdates({ ...web, batchEventId: id, timeoutMs: config.renderTimeoutMs })`, the same `send`, a `writeDryRun` that logs `dry run → …`, `log`, `now`, and the same options; log its summary when non-zero. Import the new modules dynamically after the config check, like the others.

`preview-cli.ts`: accept `--card-batch N` as an alternative to `--match-id N`: fetch with `fetchCardUpdates`, render with `renderCardUpdates` when `cardCount > 0`, build with `buildCardUpdatesPayload`, write to `<out>/card-<N>`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @eanhl/discord test && pnpm --filter @eanhl/discord typecheck && pnpm --filter @eanhl/discord build`
Expected: all PASS (30 existing + 6 cycle-cards + 1 message + 1 web-client); typecheck clean; build ok.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/discord/src
git commit -m "feat(discord): card-update pass after games"
```

---

### Task 6: Previews, docs, review, deploy

- [ ] **Step 1: Read-only tunnel + dev server** (operator-approved procedure, memory `project-dev-server-preview-db`): `ssh -N -L 127.0.0.1:5434:127.0.0.1:5433 hotel-echo` (background); build `postgresql://eanhl:<HE POSTGRES_PASSWORD>@127.0.0.1:5434/eanhl?default_transaction_read_only=on` into a mode-600 scratch file; `DATABASE_URL=$(cat file) DISCORD_INTERNAL_TOKEN=<scratch token> pnpm --filter web dev` (background). Requires 0068 on live (Task 3) only for the poster, not for these pages.

- [ ] **Step 2: Render real batches.** Pick from live (read-only): the batch with the 10-14 `tier_up`, one with a new-numeral badge for a member, and one that should show nothing (only internal steps / AI goalie) — its page must 404 and its JSON have `players: []`. Run `node apps/discord/dist/preview-cli.js --card-batch <id> --out discord-preview` for each; open the PNGs; check the texts against the site's card pages. Show the operator; get approval.

- [ ] **Step 3: Clean up** — stop the dev server and the tunnel, delete the URL file.

- [ ] **Step 4: Docs** — journal entry (2026-10-24), handoff line in place (≤ 200 lines / 12 KB), commit `docs(handoff): Discord card updates`.

- [ ] **Step 5: Final whole-branch review** (fresh reviewer) and the fix pass.

- [ ] **Step 6: Deploy (operator-gated)** — merge, push; on Hotel-Echo pull, tag `eanhl-team-website-{web,discord}:rollback-he-2026-10-24-pre-card-updates`, `docker compose build web discord`, `docker compose up -d --no-deps web discord`, check public `/internal/discord/card-updates/1/data` → 404 and the poster log `started (live)`.
