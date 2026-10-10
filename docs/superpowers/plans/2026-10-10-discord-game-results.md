# Discord Game-Result Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each new game on the active title, post the result, the three stars with their game scores, and a still image of the member stars' real player cards to the team's Discord channel — exactly once, without touching ingestion.

**Architecture:** A new opt-in `discord` Compose service polls `discord_posts`/`matches` every 60 s. For each unposted game it fetches a JSON summary and a card-strip page from two token-guarded internal web routes (both built from the same code the match page and home carousel use), screenshots the strip with headless Chromium in reduced-motion mode, and sends one webhook message. The worker is not modified.

**Tech Stack:** TypeScript (strict, NodeNext), Drizzle ORM + hand-written SQL migration, Next.js 15 App Router (route handler + server page), Playwright Chromium, Node 22 `node:test` with type stripping, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-10-discord-game-results-design.md`

## Global Constraints

- Worker (`apps/worker`) source is **not modified**. Ingestion must not depend on anything in this plan.
- The `discord` service writes **only** `discord_posts`; it reads match data through the web app.
- Migration is **hand-written, idempotent SQL** applied via `psql` (journal frozen at 0045); file `packages/db/migrations/0067_discord_posts.sql`, same header form as `0065_discord_invites_card_prefs.sql`.
- Same three stars, order, scores (`score.toFixed(2)`) and `statLine` as `/games/[id]` — via one shared function, never a copy.
- Card order left → right: 1st, 2nd, 3rd. Members only get cards (member = `getClubMemberIds()`); guests and opponents are text-only.
- Screenshots use `reducedMotion: 'reduce'` and `animations: 'disabled'` — no motion effects.
- Embed colours: WIN `0x10b981`, LOSS `0xe84131`, OTL `0xf59e0b`, DNF `0x3a3839`.
- Labels: `WIN`, `WIN (OT)`, `LOSS`, `OT LOSS`, `DNF`. DNF posts have no stars and no image.
- Eligible game: active title, `played_at` within the last 24 h, and no `discord_posts` row or a `failed` row with `attempts < 3`. A `pending` row is never re-picked.
- Internal routes return 404 unless header `x-internal-token` equals `DISCORD_INTERNAL_TOKEN` (min 16 chars; empty/missing env ⇒ always 404).
- Secrets (`DISCORD_WEBHOOK_URL`, `DISCORD_INTERNAL_TOKEN`) live only in the host `.env`; never in code, logs, error strings or `last_error`.
- `discord` Compose service is behind `profiles: ['discord']` and defaults to `DISCORD_DRY_RUN=1`.
- Green gates: typecheck, unit tests, `pnpm format`. Repo-wide `pnpm lint` is pre-existing red — do not chase it.
- After editing `packages/db/src/`, run `pnpm --filter @eanhl/db build` before typechecking consumers.

## Spec deltas (implementation detail, same behaviour)

1. The service gets the message data from a JSON route (`/internal/discord/game/[matchId]`) rather than computing stars itself — the stars code lives in the web app, so this keeps one source of truth. The JSON shape is a shared contract in `@eanhl/db/discord`.
2. Absolute links are built by the service from `DISCORD_SITE_URL` (default `https://boogeymen.app`).
3. Dry-run marks the row `skipped` with `last_error = 'dry run'`, so each game is rendered once, not every minute.
4. A row left `pending` (crash mid-post) is never retried automatically — that is what guarantees no double post. Startup logs any such rows.
5. The service is a Compose **profile** (opt-in) and defaults to dry-run, so the stopped fallback stack on the main PC can never post.

## Review Focus

1. A gamertag or opponent name containing Discord markdown or `@everyone` (`x_Sniper_x`, `[BGM]`, `@everyone`) — must render literally and ping nobody. Pinned in Task 5 (`escapeMarkdown`, `allowed_mentions`).
2. A host where nobody opted in (main-PC fallback, a fresh clone) — must never post. Pinned in Task 5 (`loadConfig` idles without webhook unless dry-run) and Task 8 (profile + dry-run default).
3. Discord rejects the webhook (404 deleted webhook, 429) — the error stored in `last_error` and logs must not contain the webhook URL/token. Pinned in Task 6 (`sendWebhook` error test).
4. Service dies after Discord accepted the post but before `markPosted` — must not post again. Pinned in Task 1 (candidates SQL excludes `pending`) and Task 6 (cycle never re-claims).
5. A bot-filled or near-empty game with 0–2 stars, or stars with no member — post still well-formed, image omitted. Pinned in Task 3 (`buildDiscordGameResult`) and Task 5 (`buildGameResultPayload`).

---

### Task 1: `discord_posts` table, schema and queries

**Files:**

- Create: `packages/db/migrations/0067_discord_posts.sql`
- Create: `packages/db/src/schema/discord-posts.ts`
- Modify: `packages/db/src/schema/index.ts` (add export)
- Create: `packages/db/src/queries/discord-posts.ts`
- Modify: `packages/db/src/queries/index.ts` (add export)
- Test: `packages/db/src/queries/__tests__/discord-posts.test.ts`

**Interfaces:**

- Produces (from `@eanhl/db/queries`):
  - `DISCORD_MAX_ATTEMPTS: 3`
  - `discordPostCandidatesQuery(args: { since: Date; limit: number })` — Drizzle select of `{ matchId: number }`
  - `listDiscordPostCandidates(args: { since: Date; limit: number }): Promise<number[]>`
  - `claimDiscordPost(matchId: number): Promise<boolean>`
  - `markDiscordPostPosted(matchId: number, messageId: string | null): Promise<void>`
  - `markDiscordPostFailed(matchId: number, error: string): Promise<void>`
  - `markDiscordPostSkipped(matchId: number, reason: string): Promise<void>`
  - `listStuckDiscordPosts(olderThan: Date): Promise<number[]>`
- Produces (from `@eanhl/db/schema`): `discordPosts`, `DISCORD_POST_STATUS`, `DiscordPostStatus`

- [ ] **Step 1: Write the migration**

`packages/db/migrations/0067_discord_posts.sql`:

```sql
-- Migration: discord_posts — one row per game posted (or skipped) to Discord
-- Spec: docs/superpowers/specs/2026-10-10-discord-game-results-design.md
-- Plan: docs/superpowers/plans/2026-10-10-discord-game-results.md (task 1).
--
-- The discord service writes only this table. A row is the service's memory of
-- what it did with a game: pending (claimed, in flight), posted, failed
-- (retried while attempts < 3), skipped (history at launch, or dry run).
-- A pending row is never re-picked: that is the no-double-post guarantee.
--
-- Back-fills a `skipped` row for every existing match so launch never posts
-- history.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0066):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0067_discord_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_posts" (
  "match_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "matches"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'game_result' NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_posts" ("match_id", "status", "last_error")
SELECT "id", 'skipped', 'before launch' FROM "matches"
ON CONFLICT ("match_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM "matches") AS "matches",
  (SELECT count(*) FROM "discord_posts") AS "discord_posts_rows",
  (SELECT count(*) FROM "discord_posts" WHERE "status" = 'skipped') AS "skipped_rows";
```

- [ ] **Step 2: Write the Drizzle schema**

`packages/db/src/schema/discord-posts.ts`:

```ts
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { matches } from './matches.js'

export const DISCORD_POST_STATUS = ['pending', 'posted', 'failed', 'skipped'] as const
export type DiscordPostStatus = (typeof DISCORD_POST_STATUS)[number]

/**
 * One row per game the discord service posted or skipped (migration 0067,
 * hand-applied). `pending` = claimed and in flight; it is never re-picked, so
 * a crash mid-post can never produce a second post. `failed` rows are retried
 * while attempts < DISCORD_MAX_ATTEMPTS. History at launch is `skipped`.
 */
export const discordPosts = pgTable(
  'discord_posts',
  {
    matchId: bigint('match_id', { mode: 'number' })
      .primaryKey()
      .references(() => matches.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('game_result'),
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
      'discord_posts_status_check',
      sql`${table.status} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)
```

Add to `packages/db/src/schema/index.ts` after the `card-prefs` line:

```ts
export * from './discord-posts.js'
```

- [ ] **Step 3: Write the failing query test**

`packages/db/src/queries/__tests__/discord-posts.test.ts`:

```ts
/**
 * SQL-shape pins for the discord_posts queries. No database: postgres.js
 * connects lazily and nothing here executes a query (same pattern as
 * game-title-controls.test.ts).
 *
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://discord-posts-test:unused@127.0.0.1:1/unused'

const { discordPostCandidatesQuery, claimDiscordPostQuery, DISCORD_MAX_ATTEMPTS } =
  await import('../discord-posts.js')

void test('candidates: active title, inside the window, never a pending/posted/skipped row', () => {
  const { sql, params } = discordPostCandidatesQuery({
    since: new Date('2026-10-10T00:00:00Z'),
    limit: 5,
  }).toSQL()
  assert.match(sql, /"game_titles"\."is_active" = \$\d/)
  assert.match(sql, /"matches"\."played_at" > \$\d/)
  assert.match(sql, /"discord_posts"\."match_id" is null/)
  assert.match(sql, /"discord_posts"\."status" = \$\d/)
  assert.match(sql, /"discord_posts"\."attempts" < \$\d/)
  assert.match(sql, /order by "matches"\."played_at" asc/)
  assert.ok(params.includes('failed'))
  assert.ok(!params.includes('pending'))
  assert.ok(params.includes(DISCORD_MAX_ATTEMPTS))
})

void test('claim: insert pending, or flip only a failed row under the attempt cap', () => {
  const { sql } = claimDiscordPostQuery(42).toSQL()
  assert.match(sql, /insert into "discord_posts"/)
  assert.match(sql, /on conflict \("match_id"\) do update/)
  assert.match(sql, /"discord_posts"\."attempts" \+ 1/)
  assert.match(
    sql,
    /where "discord_posts"\."status" = 'failed' and "discord_posts"\."attempts" < 3/,
  )
  assert.match(sql, /returning "match_id"/)
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/queries/__tests__/discord-posts.test.js`
Expected: build FAILS (or test FAILS) — `../discord-posts.js` does not exist.

- [ ] **Step 5: Write the queries**

`packages/db/src/queries/discord-posts.ts`:

```ts
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { discordPosts, gameTitles, matches } from '../schema/index.js'

/** A failed post is retried until it has been attempted this many times. */
export const DISCORD_MAX_ATTEMPTS = 3

/**
 * Games the discord service may post: active title, ended after `since`, and
 * either never touched or failed under the attempt cap. `pending`, `posted`
 * and `skipped` rows are never returned. Joined select, so Drizzle qualifies
 * every column (see feedback: unqualified columns in single-table selects).
 */
export function discordPostCandidatesQuery(args: { since: Date; limit: number }) {
  return db
    .select({ matchId: matches.id })
    .from(matches)
    .innerJoin(gameTitles, eq(gameTitles.id, matches.gameTitleId))
    .leftJoin(discordPosts, eq(discordPosts.matchId, matches.id))
    .where(
      and(
        eq(gameTitles.isActive, true),
        gt(matches.playedAt, args.since),
        or(
          isNull(discordPosts.matchId),
          and(eq(discordPosts.status, 'failed'), lt(discordPosts.attempts, DISCORD_MAX_ATTEMPTS)),
        ),
      ),
    )
    .orderBy(asc(matches.playedAt))
    .limit(args.limit)
}

export async function listDiscordPostCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await discordPostCandidatesQuery(args)
  return rows.map((r) => r.matchId)
}

/**
 * Atomically claim a game: insert a pending row, or flip a failed row under
 * the cap back to pending. Returns no row (⇒ false) when the game is pending,
 * posted, skipped, or out of attempts. The ON CONFLICT clauses are raw SQL so
 * the existing-row columns are explicitly qualified.
 */
export function claimDiscordPostQuery(matchId: number) {
  return db
    .insert(discordPosts)
    .values({ matchId, status: 'pending', attempts: 1 })
    .onConflictDoUpdate({
      target: discordPosts.matchId,
      set: {
        status: 'pending',
        attempts: sql`"discord_posts"."attempts" + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`"discord_posts"."status" = 'failed' and "discord_posts"."attempts" < ${sql.raw(String(DISCORD_MAX_ATTEMPTS))}`,
    })
    .returning({ matchId: discordPosts.matchId })
}

export async function claimDiscordPost(matchId: number): Promise<boolean> {
  const rows = await claimDiscordPostQuery(matchId)
  return rows.length > 0
}

export async function markDiscordPostPosted(
  matchId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(discordPosts)
    .set({
      status: 'posted',
      discordMessageId: messageId,
      lastError: null,
      postedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(discordPosts.matchId, matchId))
}

export async function markDiscordPostFailed(matchId: number, error: string): Promise<void> {
  await db
    .update(discordPosts)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordPosts.matchId, matchId))
}

export async function markDiscordPostSkipped(matchId: number, reason: string): Promise<void> {
  await db
    .update(discordPosts)
    .set({ status: 'skipped', lastError: reason.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(discordPosts.matchId, matchId))
}

/** Rows left pending since before `olderThan` — a crash mid-post. Logged, never retried. */
export async function listStuckDiscordPosts(olderThan: Date): Promise<number[]> {
  const rows = await db
    .select({ matchId: discordPosts.matchId })
    .from(discordPosts)
    .where(and(eq(discordPosts.status, 'pending'), lt(discordPosts.updatedAt, olderThan)))
  return rows.map((r) => r.matchId)
}
```

Add to `packages/db/src/queries/index.ts` after the `cards.js` line:

```ts
export * from './discord-posts.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/queries/__tests__/discord-posts.test.js`
Expected: PASS, 2 tests. If a regex misses only on whitespace/casing of Drizzle's rendering, print `toSQL().sql`, confirm the clause is semantically right, and tighten the regex to the real rendering — do not loosen it to `.*`.

- [ ] **Step 7: Apply the migration to the local preview DB and run the queries for real**

```bash
docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
  eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -v ON_ERROR_STOP=1 -f - \
  < packages/db/migrations/0067_discord_posts.sql
```

Expected: final SELECT shows `discord_posts_rows = matches = skipped_rows`. Run it a second time: same counts, no error (idempotent).

Then exercise the claim/retry SQL against `eanhl_preview` (inside a transaction, rolled back):

```bash
docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM discord_posts WHERE match_id = (SELECT max(id) FROM matches);
-- claim #1 inserts
INSERT INTO discord_posts (match_id, status, attempts) VALUES ((SELECT max(id) FROM matches), 'pending', 1)
ON CONFLICT (match_id) DO UPDATE SET status='pending', attempts="discord_posts"."attempts"+1, updated_at=now()
WHERE "discord_posts"."status"='failed' AND "discord_posts"."attempts" < 3 RETURNING match_id;
-- claim #2 on a pending row returns nothing
INSERT INTO discord_posts (match_id, status, attempts) VALUES ((SELECT max(id) FROM matches), 'pending', 1)
ON CONFLICT (match_id) DO UPDATE SET status='pending', attempts="discord_posts"."attempts"+1, updated_at=now()
WHERE "discord_posts"."status"='failed' AND "discord_posts"."attempts" < 3 RETURNING match_id;
ROLLBACK;
SQL
```

Expected: first INSERT returns 1 row, second returns 0 rows.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add packages/db/migrations/0067_discord_posts.sql packages/db/src/schema/discord-posts.ts \
  packages/db/src/schema/index.ts packages/db/src/queries/discord-posts.ts \
  packages/db/src/queries/index.ts packages/db/src/queries/__tests__/discord-posts.test.ts
git commit -m "feat(db): discord_posts table and claim/mark queries (migration 0067)"
```

---

### Task 2: Shared JSON contract `@eanhl/db/discord`

**Files:**

- Create: `packages/db/src/discord/contract.ts`
- Create: `packages/db/src/discord/index.ts`
- Modify: `packages/db/package.json` (`exports`)
- Test: `packages/db/src/discord/contract.test.ts`

**Interfaces:**

- Produces (from `@eanhl/db/discord`, no DB client import):
  - `type DiscordResult = 'WIN' | 'LOSS' | 'OTL' | 'DNF'`
  - `type DiscordStarKind = 'member' | 'guest' | 'opponent'`
  - `interface DiscordStar { rank: number; gamertag: string; kind: DiscordStarKind; playerId: number | null; score: number; statLine: string; teamAbbrev: string | null }`
  - `interface DiscordGameResult { matchId: number; result: DiscordResult; overtime: boolean; scoreFor: number; scoreAgainst: number; opponentName: string; gameTitleName: string; gameMode: '3s' | '6s' | null; playedAt: string; stars: DiscordStar[]; cardPlayerIds: number[] }`
  - `parseDiscordGameResult(value: unknown): DiscordGameResult` — throws `Error('discord contract: <path> ...')`

- [ ] **Step 1: Write the failing test**

`packages/db/src/discord/contract.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscordGameResult, type DiscordGameResult } from './contract.js'

const valid: DiscordGameResult = {
  matchId: 1234,
  result: 'WIN',
  overtime: true,
  scoreFor: 4,
  scoreAgainst: 3,
  opponentName: 'XYZ Hockey Club',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T03:42:00.000Z',
  stars: [
    {
      rank: 1,
      gamertag: 'PlayerA',
      kind: 'member',
      playerId: 7,
      score: 8.4,
      statLine: '2G 1A',
      teamAbbrev: null,
    },
    {
      rank: 2,
      gamertag: 'OppGuy',
      kind: 'opponent',
      playerId: null,
      score: 6.1,
      statLine: '1G',
      teamAbbrev: 'XYZ',
    },
  ],
  cardPlayerIds: [7],
}

void test('a valid payload round-trips through JSON', () => {
  assert.deepEqual(parseDiscordGameResult(JSON.parse(JSON.stringify(valid))), valid)
})

void test('rejects an unknown result', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, result: 'TIE' }), /result/)
})

void test('rejects a star with a non-numeric score', () => {
  const bad = { ...valid, stars: [{ ...valid.stars[0], score: '8.4' }] }
  assert.throws(() => parseDiscordGameResult(bad), /stars\[0\]\.score/)
})

void test('rejects a card id that is not one of the member stars', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, cardPlayerIds: [99] }), /cardPlayerIds/)
})

void test('rejects non-objects', () => {
  assert.throws(() => parseDiscordGameResult(null), /discord contract/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @eanhl/db build; node --test packages/db/dist/discord/contract.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the contract**

`packages/db/src/discord/contract.ts`:

```ts
/**
 * The JSON the web app's /internal/discord/game/[matchId] route returns and
 * the discord service consumes. Lives here (no DB client import) so both
 * apps share one definition. Parsed at the network boundary, never trusted.
 */

export const DISCORD_RESULTS = ['WIN', 'LOSS', 'OTL', 'DNF'] as const
export type DiscordResult = (typeof DISCORD_RESULTS)[number]
export type DiscordStarKind = 'member' | 'guest' | 'opponent'

export interface DiscordStar {
  /** 1, 2 or 3. */
  rank: number
  gamertag: string
  kind: DiscordStarKind
  /** BGM player id for members and guests; null for opponents. */
  playerId: number | null
  score: number
  statLine: string
  /** Opponent club abbreviation; null for BGM stars. */
  teamAbbrev: string | null
}

export interface DiscordGameResult {
  matchId: number
  result: DiscordResult
  overtime: boolean
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  gameTitleName: string
  gameMode: '3s' | '6s' | null
  /** ISO timestamp of game end (matches.played_at). */
  playedAt: string
  /** Empty for DNF. */
  stars: DiscordStar[]
  /** Member stars with a renderable card, in star order. */
  cardPlayerIds: number[]
}

function fail(path: string, why: string): never {
  throw new Error(`discord contract: ${path} ${why}`)
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'is not an object')
  return v as Record<string, unknown>
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'is not a finite number')
  return v
}
function int(v: unknown, path: string): number {
  const n = num(v, path)
  if (!Number.isSafeInteger(n)) fail(path, 'is not an integer')
  return n
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'is not a string')
  return v
}
function nullable<T>(v: unknown, path: string, inner: (v: unknown, p: string) => T): T | null {
  return v === null ? null : inner(v, path)
}

function parseStar(v: unknown, path: string): DiscordStar {
  const o = obj(v, path)
  const kind = o['kind']
  if (kind !== 'member' && kind !== 'guest' && kind !== 'opponent')
    fail(`${path}.kind`, 'is invalid')
  return {
    rank: int(o['rank'], `${path}.rank`),
    gamertag: str(o['gamertag'], `${path}.gamertag`),
    kind,
    playerId: nullable(o['playerId'], `${path}.playerId`, int),
    score: num(o['score'], `${path}.score`),
    statLine: str(o['statLine'], `${path}.statLine`),
    teamAbbrev: nullable(o['teamAbbrev'], `${path}.teamAbbrev`, str),
  }
}

export function parseDiscordGameResult(value: unknown): DiscordGameResult {
  const o = obj(value, 'root')
  const result = o['result']
  if (!DISCORD_RESULTS.includes(result as DiscordResult)) fail('result', 'is invalid')
  const gameMode = o['gameMode']
  if (gameMode !== null && gameMode !== '3s' && gameMode !== '6s') fail('gameMode', 'is invalid')
  const overtime = o['overtime']
  if (typeof overtime !== 'boolean') fail('overtime', 'is not a boolean')
  const starsRaw = o['stars']
  if (!Array.isArray(starsRaw)) fail('stars', 'is not an array')
  const stars = starsRaw.map((s, i) => parseStar(s, `stars[${String(i)}]`))
  const cardsRaw = o['cardPlayerIds']
  if (!Array.isArray(cardsRaw)) fail('cardPlayerIds', 'is not an array')
  const cardPlayerIds = cardsRaw.map((c, i) => int(c, `cardPlayerIds[${String(i)}]`))
  const memberIds = new Set(stars.filter((s) => s.kind === 'member').map((s) => s.playerId))
  if (cardPlayerIds.some((id) => !memberIds.has(id)))
    fail('cardPlayerIds', 'names a non-member star')
  return {
    matchId: int(o['matchId'], 'matchId'),
    result: result as DiscordResult,
    overtime,
    scoreFor: int(o['scoreFor'], 'scoreFor'),
    scoreAgainst: int(o['scoreAgainst'], 'scoreAgainst'),
    opponentName: str(o['opponentName'], 'opponentName'),
    gameTitleName: str(o['gameTitleName'], 'gameTitleName'),
    gameMode,
    playedAt: str(o['playedAt'], 'playedAt'),
    stars,
    cardPlayerIds,
  }
}
```

`packages/db/src/discord/index.ts`:

```ts
export * from './contract.js'
```

In `packages/db/package.json` `exports`, add after `"./cards"`:

```json
"./discord": "./dist/discord/index.js",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @eanhl/db build && node --test packages/db/dist/discord/contract.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/db/src/discord packages/db/package.json
git commit -m "feat(db): shared Discord game-result JSON contract (@eanhl/db/discord)"
```

---

### Task 3: Web — shared stars helper, token guard, result builder (pure)

**Files:**

- Modify: `apps/web/src/lib/match-recap.ts` (add `starsForMatch` after `buildTopPerformers`, ~line 502)
- Modify: `apps/web/src/app/games/[id]/page.tsx:189-192` (use `starsForMatch`)
- Create: `apps/web/src/lib/discord/internal-token.ts`
- Create: `apps/web/src/lib/discord/game-result.ts`
- Test: `apps/web/src/lib/discord/internal-token.test.ts`, `apps/web/src/lib/discord/game-result.test.ts`, `apps/web/src/lib/match-recap.test.ts` (append)

**Interfaces:**

- Consumes: `DiscordGameResult`, `DiscordStar` from `@eanhl/db/discord` (Task 2).
- Produces:
  - `starsForMatch(match, bgm: PlayerStat[], opponent: OpponentPlayerStat[], lineups: { bgm: LineupRow[]; opponent: LineupRow[] }): TopPerformer[]`
  - `INTERNAL_TOKEN_HEADER = 'x-internal-token'`; `isInternalTokenValid(provided: string | null | undefined, expected: string | undefined): boolean`
  - `buildDiscordGameResult(input: DiscordGameResultInput): DiscordGameResult` where
    `DiscordGameResultInput = { match: { id: number; result: DiscordResult; scoreFor: number; scoreAgainst: number; opponentName: string; gameMode: '3s' | '6s' | null; playedAt: Date }; gameTitleName: string; overtime: boolean; stars: Pick<TopPerformer, 'side' | 'playerId' | 'gamertag' | 'score' | 'statLine'>[]; memberIds: ReadonlySet<number>; cardPlayerIds: ReadonlySet<number> }`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/discord/internal-token.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { isInternalTokenValid } from './internal-token.ts'

const TOKEN = 'a'.repeat(32)

void test('the right token passes', () => {
  assert.equal(isInternalTokenValid(TOKEN, TOKEN), true)
})
void test('wrong, missing, or different-length tokens fail', () => {
  assert.equal(isInternalTokenValid('b'.repeat(32), TOKEN), false)
  assert.equal(isInternalTokenValid(null, TOKEN), false)
  assert.equal(isInternalTokenValid(undefined, TOKEN), false)
  assert.equal(isInternalTokenValid('', TOKEN), false)
  assert.equal(isInternalTokenValid(TOKEN.slice(1), TOKEN), false)
})
void test('an unset, empty or short server token refuses everyone', () => {
  assert.equal(isInternalTokenValid('', ''), false)
  assert.equal(isInternalTokenValid('x', undefined), false)
  assert.equal(isInternalTokenValid('short', 'short'), false)
})
```

`apps/web/src/lib/discord/game-result.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscordGameResult, type DiscordGameResultInput } from './game-result.ts'

const base: DiscordGameResultInput = {
  match: {
    id: 900,
    result: 'WIN',
    scoreFor: 4,
    scoreAgainst: 2,
    opponentName: 'XYZ Hockey Club',
    gameMode: '6s',
    playedAt: new Date('2026-10-10T03:42:00Z'),
  },
  gameTitleName: 'NHL 26',
  overtime: false,
  stars: [
    { side: 'bgm', playerId: 7, gamertag: 'Member1', score: 8.4, statLine: '2G 1A' },
    { side: 'opp', playerId: null, gamertag: 'OppGuy', score: 6.1, statLine: '1G' },
    { side: 'bgm', playerId: 50, gamertag: 'Guesty', score: 5.3, statLine: '1A' },
  ],
  memberIds: new Set([7, 8]),
  cardPlayerIds: new Set([7]),
}

void test('classifies member, opponent and guest stars in star order', () => {
  const r = buildDiscordGameResult(base)
  assert.deepEqual(
    r.stars.map((s) => [s.rank, s.kind, s.playerId, s.teamAbbrev]),
    [
      [1, 'member', 7, null],
      [2, 'opponent', null, 'XHC'],
      [3, 'guest', 50, null],
    ],
  )
  assert.deepEqual(r.cardPlayerIds, [7])
  assert.equal(r.playedAt, '2026-10-10T03:42:00.000Z')
})

void test('a BGM star with no player id is a guest, never a member', () => {
  const r = buildDiscordGameResult({
    ...base,
    stars: [{ side: 'bgm', playerId: null, gamertag: 'Unresolved', score: 3, statLine: '' }],
  })
  assert.equal(r.stars[0]?.kind, 'guest')
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('a member whose card did not load gets no card but stays a member line', () => {
  const r = buildDiscordGameResult({ ...base, cardPlayerIds: new Set() })
  assert.equal(r.stars[0]?.kind, 'member')
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('cards follow star order, not id order', () => {
  const r = buildDiscordGameResult({
    ...base,
    stars: [
      { side: 'bgm', playerId: 8, gamertag: 'B', score: 9, statLine: '' },
      { side: 'bgm', playerId: 7, gamertag: 'A', score: 8, statLine: '' },
    ],
    cardPlayerIds: new Set([7, 8]),
  })
  assert.deepEqual(r.cardPlayerIds, [8, 7])
})

void test('DNF drops stars and cards', () => {
  const r = buildDiscordGameResult({ ...base, match: { ...base.match, result: 'DNF' } })
  assert.deepEqual(r.stars, [])
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('zero stars is a valid result', () => {
  const r = buildDiscordGameResult({ ...base, stars: [] })
  assert.deepEqual(r.stars, [])
})
```

Append to `apps/web/src/lib/match-recap.test.ts` (add `starsForMatch` to the existing import from `./match-recap.ts`):

```ts
void test('starsForMatch: no players, no stars', () => {
  assert.deepEqual(
    starsForMatch({ result: 'WIN', scoreFor: 1, scoreAgainst: 0 }, [], [], {
      bgm: [],
      opponent: [],
    }),
    [],
  )
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @eanhl/db build && cd apps/web && node --test src/lib/discord/internal-token.test.ts src/lib/discord/game-result.test.ts src/lib/match-recap.test.ts`
Expected: FAIL — modules / export `starsForMatch` missing.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/match-recap.ts`, directly after `buildTopPerformers`:

```ts
/**
 * The three stars exactly as /games/[id] ranks them: loadout OCR overrides
 * applied first, then the shared score ladder. The match page and the Discord
 * post both call this, so they can never disagree.
 */
export function starsForMatch(
  match: Pick<Match, 'result' | 'scoreFor' | 'scoreAgainst'>,
  bgm: PlayerStat[],
  opponent: OpponentPlayerStat[],
  lineups: { bgm: LineupRow[]; opponent: LineupRow[] },
): TopPerformer[] {
  return buildTopPerformers(
    match,
    applyLoadoutOverrides(bgm, lineups.bgm),
    applyLoadoutOverrides(opponent, lineups.opponent),
  )
}
```

In `apps/web/src/app/games/[id]/page.tsx`, replace

```ts
const topPerformers = attachSeasonAvgs(
  buildTopPerformers(match, playerStatsForStars, opponentStatsForStars),
  seasonAvgs,
)
```

with

```ts
const topPerformers = attachSeasonAvgs(
  starsForMatch(match, playerStats, opponentPlayerStats, lineups),
  seasonAvgs,
)
```

and in the `@/lib/match-recap` import list replace `buildTopPerformers,` with `starsForMatch,`. (`playerStatsForStars`/`opponentStatsForStars` stay — `buildAllTeamScores` still uses them.)

`apps/web/src/lib/discord/internal-token.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'

/** Header the discord service sends to the internal routes. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

/** Shorter server tokens are treated as unset: refuse everyone. */
const MIN_TOKEN_LENGTH = 16

/**
 * Whether a request may reach /internal/discord/*. The Cloudflare tunnel
 * exposes every web route, so this token is the only guard. Unset, empty or
 * short server tokens refuse every request.
 */
export function isInternalTokenValid(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected.length < MIN_TOKEN_LENGTH) return false
  if (provided === null || provided === undefined || provided.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

`apps/web/src/lib/discord/game-result.ts`:

```ts
import type { DiscordGameResult, DiscordResult, DiscordStar } from '@eanhl/db/discord'
import type { TopPerformer } from '../match-recap.ts'
import { abbreviateTeamName } from '../format.ts'

export interface DiscordGameResultInput {
  match: {
    id: number
    result: DiscordResult
    scoreFor: number
    scoreAgainst: number
    opponentName: string
    gameMode: '3s' | '6s' | null
    playedAt: Date
  }
  gameTitleName: string
  overtime: boolean
  stars: Pick<TopPerformer, 'side' | 'playerId' | 'gamertag' | 'score' | 'statLine'>[]
  /** Team members, present and past (getClubMemberIds). */
  memberIds: ReadonlySet<number>
  /** Members whose card loaded and can be drawn. */
  cardPlayerIds: ReadonlySet<number>
}

/** Pure: the Discord post's data for one game. DNF carries no stars. */
export function buildDiscordGameResult(input: DiscordGameResultInput): DiscordGameResult {
  const { match } = input
  const teamAbbrev = abbreviateTeamName(match.opponentName)
  const stars: DiscordStar[] =
    match.result === 'DNF'
      ? []
      : input.stars.map((s, i) => {
          const kind =
            s.side === 'opp'
              ? 'opponent'
              : s.playerId !== null && input.memberIds.has(s.playerId)
                ? 'member'
                : 'guest'
          return {
            rank: i + 1,
            gamertag: s.gamertag,
            kind,
            playerId: s.side === 'opp' ? null : s.playerId,
            score: s.score,
            statLine: s.statLine,
            teamAbbrev: s.side === 'opp' ? teamAbbrev : null,
          }
        })
  const cardPlayerIds = stars.flatMap((s) =>
    s.kind === 'member' && s.playerId !== null && input.cardPlayerIds.has(s.playerId)
      ? [s.playerId]
      : [],
  )
  return {
    matchId: match.id,
    result: match.result,
    overtime: input.overtime,
    scoreFor: match.scoreFor,
    scoreAgainst: match.scoreAgainst,
    opponentName: match.opponentName,
    gameTitleName: input.gameTitleName,
    gameMode: match.gameMode,
    playedAt: match.playedAt.toISOString(),
    stars,
    cardPlayerIds,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && node --test src/lib/discord/internal-token.test.ts src/lib/discord/game-result.test.ts src/lib/match-recap.test.ts && cd ../.. && pnpm --filter web typecheck`
Expected: all PASS; typecheck clean. (`abbreviateTeamName('XYZ Hockey Club')` is `'XHC'` — checked 2026-10-10; `format.ts` has no imports, so it loads under `node --test`.)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/web/src/lib/match-recap.ts apps/web/src/lib/match-recap.test.ts \
  "apps/web/src/app/games/[id]/page.tsx" apps/web/src/lib/discord
git commit -m "feat(web): shared starsForMatch, internal token guard, Discord result builder"
```

---

### Task 4: Web — loader, JSON route, card-strip page

**Files:**

- Create: `apps/web/src/lib/discord/load-game-result.ts`
- Create: `apps/web/src/app/internal/discord/game/[matchId]/route.ts`
- Create: `apps/web/src/app/internal/discord/stars/[matchId]/page.tsx`
- Modify: `.env.example` (document `DISCORD_INTERNAL_TOKEN`)

**Interfaces:**

- Consumes: `starsForMatch`, `wentToOvertime` (match-recap), `isInternalTokenValid`, `INTERNAL_TOKEN_HEADER`, `buildDiscordGameResult` (Task 3); `cardFromRosterRow` (`components/cards/card-adapters`), `PlayerCard` (`components/cards/player-card`); queries `getMatchById`, `getPlayerMatchStats`, `getOpponentPlayerMatchStats`, `getMatchLineups`, `getMatchPeriodSummaries`, `listAllGameTitles`, `getClubMemberIds`, `getEARoster`, `getRosterCarryOvers`, `getCardProgressForPlayers`.
- Produces:
  - `loadDiscordGameResult(matchId: number): Promise<{ result: DiscordGameResult; cards: CardViewModel[] } | null>`
  - `GET /internal/discord/game/[matchId]` → `DiscordGameResult` JSON, or 404
  - `GET /internal/discord/stars/[matchId]` → page with `#discord-stars` containing the member cards in star order, or 404

- [ ] **Step 1: Write the loader**

`apps/web/src/lib/discord/load-game-result.ts`:

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
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import { starsForMatch, wentToOvertime } from '@/lib/match-recap'
import { buildDiscordGameResult } from './game-result'

type CardViewModel = ReturnType<typeof cardFromRosterRow>

/**
 * Everything the Discord post needs for one game. Stars come from the same
 * starsForMatch the match page uses; cards are built exactly like the home
 * carousel's (EA roster + carry-overs, newest season card, equipped theme).
 * Throws on a DB failure — the caller (the discord service) retries.
 */
export async function loadDiscordGameResult(
  matchId: number,
): Promise<{ result: DiscordGameResult; cards: CardViewModel[] } | null> {
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
  const memberStarIds =
    match.result === 'DNF'
      ? []
      : stars.flatMap((s) =>
          s.side === 'bgm' && s.playerId !== null && memberIds.has(s.playerId) ? [s.playerId] : [],
        )

  const cards = await loadCards(match.gameTitleId, memberStarIds)
  const cardIds = new Set(cards.map((c) => c.front.playerId))
  const title = titles.find((t) => t.id === match.gameTitleId)

  const result = buildDiscordGameResult({
    match,
    gameTitleName: title?.name ?? '',
    overtime,
    stars,
    memberIds,
    cardPlayerIds: cardIds,
  })
  // Cards in star order (result.cardPlayerIds is already ordered).
  const byId = new Map(cards.map((c) => [c.front.playerId, c]))
  return {
    result,
    cards: result.cardPlayerIds.flatMap((id) => {
      const c = byId.get(id)
      return c ? [c] : []
    }),
  }
}

async function loadCards(gameTitleId: number, playerIds: number[]): Promise<CardViewModel[]> {
  if (playerIds.length === 0) return []
  const [roster, carryOvers, summaries] = await Promise.all([
    getEARoster(gameTitleId),
    getRosterCarryOvers(gameTitleId),
    getCardProgressForPlayers(playerIds),
  ])
  const rows = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))
  return playerIds.flatMap((id) => {
    const row = rows.get(id)
    return row ? [cardFromRosterRow(row, summaries.get(id))] : []
  })
}
```

If `typecheck` reports the `match` argument shape doesn't fit `buildDiscordGameResult` (e.g. `gameMode` typed as `GameMode | null` vs `'3s' | '6s' | null`, or `result` typed as `MatchResult`), map the fields explicitly — they are the same unions.

- [ ] **Step 2: Write the JSON route**

`apps/web/src/app/internal/discord/game/[matchId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** Discord post data for one game. Internal: 404 without the service token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { matchId } = await params
  const id = Number.parseInt(matchId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()
  const loaded = await loadDiscordGameResult(id)
  if (!loaded) return notFound()
  return NextResponse.json(loaded.result, { headers: { 'cache-control': 'no-store' } })
}
```

- [ ] **Step 3: Write the card-strip page**

`apps/web/src/app/internal/discord/stars/[matchId]/page.tsx`:

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
 * The member stars' cards side by side, for the discord service to
 * screenshot (#discord-stars only). Pinned over the site chrome so the
 * element screenshot never catches the nav. Internal: 404 without the token.
 */
export default async function DiscordStarsPage({
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
  if (!loaded || loaded.cards.length === 0) notFound()

  return (
    <div
      id="discord-stars"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 2147483647,
        display: 'inline-flex',
        gap: 16,
        padding: 16,
        background: 'var(--color-background)',
      }}
    >
      {loaded.cards.map((card) => (
        <PlayerCard key={card.front.playerId} card={card} context="list" />
      ))}
    </div>
  )
}
```

In `.env.example`, after the Discord login block, add:

```bash
# Shared secret between web and the discord poster (/internal/discord/* routes).
# Unset or shorter than 16 chars ⇒ those routes always 404. Generate: openssl rand -hex 32
DISCORD_INTERNAL_TOKEN=
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @eanhl/db build && pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 5: Check the routes against the local dev server**

Do **not** run `pnpm --filter web build` while a dev server is up (it corrupts `.next`). Start dev with a token (dev reads `eanhl_preview`):

```bash
export DISCORD_INTERNAL_TOKEN=$(openssl rand -hex 32); echo "$DISCORD_INTERNAL_TOKEN" > /tmp/claude-discord-token
# start in the background with the token in its env, per the run skill / project dev setup
pnpm --filter web dev
```

Pick a recent WIN with a member star from `eanhl_preview`:

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl_preview -Atc \
  "select id, result from matches order by played_at desc limit 5"
```

Then (with `T=$(cat /tmp/claude-discord-token)`, `M=<id>`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/internal/discord/game/$M                      # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "x-internal-token: wrongwrongwrongwrong" localhost:3000/internal/discord/game/$M   # 404
curl -s -H "x-internal-token: $T" localhost:3000/internal/discord/game/$M | head -c 1200                # JSON
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/internal/discord/stars/$M                     # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "x-internal-token: $T" localhost:3000/internal/discord/stars/$M   # 200
```

Expected: as commented. Open `/games/$M` in the browser and confirm the JSON's three stars, order and scores (2 decimals) match the page's Three Stars.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/web/src/lib/discord/load-game-result.ts apps/web/src/app/internal .env.example
git commit -m "feat(web): token-guarded internal Discord routes (game JSON + card strip)"
```

---

### Task 5: `apps/discord` scaffold, config, message builder

**Files:**

- Create: `apps/discord/package.json`, `apps/discord/tsconfig.json`
- Create: `apps/discord/src/config.ts`, `apps/discord/src/message.ts`
- Test: `apps/discord/src/config.test.ts`, `apps/discord/src/message.test.ts`

**Interfaces:**

- Consumes: `DiscordGameResult`, `DiscordResult` from `@eanhl/db/discord`.
- Produces:
  - `interface PosterConfig { webhookUrl: string | null; internalToken: string; webBaseUrl: string; siteUrl: string; dryRun: boolean; outDir: string; pollIntervalMs: number; renderTimeoutMs: number }`
  - `type ConfigResult = { ok: true; config: PosterConfig } | { ok: false; problems: string[] }`
  - `loadConfig(env: Record<string, string | undefined>): ConfigResult`
  - `interface WebhookPayload { allowed_mentions: { parse: never[] }; embeds: WebhookEmbed[]; attachments?: { id: number; filename: string }[] }`
  - `interface WebhookEmbed { title: string; url: string; color: number; description: string; image?: { url: string } }`
  - `CARDS_FILENAME = 'cards.png'`
  - `escapeMarkdown(text: string): string`, `resultLabel(result: DiscordResult, overtime: boolean): string`
  - `buildGameResultPayload(r: DiscordGameResult, opts: { siteUrl: string; hasImage: boolean }): WebhookPayload`

- [ ] **Step 1: Scaffold the package**

`apps/discord/package.json`:

```json
{
  "name": "@eanhl/discord",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --test \"src/**/*.test.ts\"",
    "start": "node dist/index.js",
    "preview": "node dist/preview-cli.js"
  },
  "dependencies": {
    "@eanhl/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

`apps/discord/tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM"],
    // Source imports './x.ts' so node:test runs it directly (type stripping);
    // tsc rewrites them to './x.js' on emit.
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Run: `pnpm install` (links the new workspace; lockfile updates). Then `pnpm --filter @eanhl/discord add playwright` (adds the current version). Then `pnpm --filter @eanhl/discord exec playwright install chromium`.

- [ ] **Step 2: Write the failing tests**

`apps/discord/src/config.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.ts'

const TOKEN = 'a'.repeat(32)
const HOOK = 'https://discord.com/api/webhooks/123/abc'

void test('live config with defaults', () => {
  const r = loadConfig({
    DISCORD_WEBHOOK_URL: HOOK,
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000/',
  })
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, false)
  assert.equal(r.config.webBaseUrl, 'http://web:3000')
  assert.equal(r.config.siteUrl, 'https://boogeymen.app')
  assert.equal(r.config.pollIntervalMs, 60000)
})

void test('no webhook and no dry run ⇒ idle (a host nobody opted in never posts)', () => {
  const r = loadConfig({ DISCORD_INTERNAL_TOKEN: TOKEN, WEB_INTERNAL_URL: 'http://web:3000' })
  assert.equal(r.ok, false)
})

void test('dry run needs no webhook', () => {
  const r = loadConfig({
    DISCORD_DRY_RUN: '1',
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, true)
  assert.equal(r.config.webhookUrl, null)
})

void test('rejects a non-Discord webhook URL and a short token, without echoing them', () => {
  const r = loadConfig({
    DISCORD_WEBHOOK_URL: 'https://evil.example/hook',
    DISCORD_INTERNAL_TOKEN: 'short',
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.problems.length, 2)
    assert.ok(r.problems.every((p) => !p.includes('evil.example') && !p.includes('short')))
  }
})
```

`apps/discord/src/message.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordGameResult } from '@eanhl/db/discord'
import { buildGameResultPayload, escapeMarkdown, resultLabel } from './message.ts'

const SITE = 'https://boogeymen.app'
const r: DiscordGameResult = {
  matchId: 900,
  result: 'WIN',
  overtime: false,
  scoreFor: 4,
  scoreAgainst: 2,
  opponentName: 'XYZ Hockey Club',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T03:42:00.000Z',
  stars: [
    {
      rank: 1,
      gamertag: 'x_Sniper_x',
      kind: 'member',
      playerId: 7,
      score: 8.4,
      statLine: '2G 1A +2',
      teamAbbrev: null,
    },
    {
      rank: 2,
      gamertag: 'OppGuy',
      kind: 'opponent',
      playerId: null,
      score: 6.1,
      statLine: '1G 1A',
      teamAbbrev: 'XYZ',
    },
    {
      rank: 3,
      gamertag: '@everyone',
      kind: 'guest',
      playerId: 50,
      score: 5.25,
      statLine: '1A 4 HITS',
      teamAbbrev: null,
    },
  ],
  cardPlayerIds: [7],
}

void test('labels', () => {
  assert.equal(resultLabel('WIN', false), 'WIN')
  assert.equal(resultLabel('WIN', true), 'WIN (OT)')
  assert.equal(resultLabel('LOSS', false), 'LOSS')
  assert.equal(resultLabel('OTL', true), 'OT LOSS')
  assert.equal(resultLabel('DNF', false), 'DNF')
})

void test('escapeMarkdown neutralises Discord formatting', () => {
  assert.equal(escapeMarkdown('x_Sniper_x'), 'x\\_Sniper\\_x')
  assert.equal(escapeMarkdown('[BGM] *Ace*'), '\\[BGM\\] \\*Ace\\*')
})

void test('win post: colour, title link, timestamp, three star lines, image, nobody pinged', () => {
  const p = buildGameResultPayload(r, { siteUrl: SITE, hasImage: true })
  const e = p.embeds[0]!
  assert.deepEqual(p.allowed_mentions, { parse: [] })
  assert.equal(e.color, 0x10b981)
  assert.equal(e.url, `${SITE}/games/900`)
  assert.equal(e.title, 'BGM 4 – 2 XYZ Hockey Club · WIN')
  assert.match(e.description, /NHL 26 · 6s · <t:1791603720:f>/)
  assert.match(
    e.description,
    /⭐ \*\*1st\*\* · \[x\\_Sniper\\_x\]\(https:\/\/boogeymen\.app\/roster\/7\) · \*\*8\.40\*\* · 2G 1A \+2/,
  )
  assert.match(e.description, /⭐ \*\*2nd\*\* · OppGuy \(XYZ\) · \*\*6\.10\*\*/)
  assert.match(e.description, /⭐ \*\*3rd\*\* · @everyone · \*\*5\.25\*\*/)
  assert.ok(!e.description.includes('/roster/50'))
  assert.match(e.description, /\[Full box score →\]\(https:\/\/boogeymen\.app\/games\/900\)/)
  assert.deepEqual(e.image, { url: 'attachment://cards.png' })
  assert.deepEqual(p.attachments, [{ id: 0, filename: 'cards.png' }])
})

void test('no image ⇒ no image field, no attachments', () => {
  const p = buildGameResultPayload(r, { siteUrl: SITE, hasImage: false })
  assert.equal(p.embeds[0]!.image, undefined)
  assert.equal(p.attachments, undefined)
})

void test('loss / OT loss / OT win colours and titles', () => {
  assert.equal(
    buildGameResultPayload({ ...r, result: 'LOSS' }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .color,
    0xe84131,
  )
  assert.equal(
    buildGameResultPayload({ ...r, result: 'OTL' }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .color,
    0xf59e0b,
  )
  assert.match(
    buildGameResultPayload({ ...r, overtime: true }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .title,
    / · WIN \(OT\)$/,
  )
})

void test('DNF: grey, no stars, says it ended early', () => {
  const p = buildGameResultPayload(
    { ...r, result: 'DNF', stars: [], cardPlayerIds: [] },
    { siteUrl: SITE, hasImage: false },
  )
  const e = p.embeds[0]!
  assert.equal(e.color, 0x3a3839)
  assert.ok(!e.description.includes('⭐'))
  assert.match(e.description, /Game ended early/)
})

void test('missing game mode is omitted, not printed as null', () => {
  const p = buildGameResultPayload({ ...r, gameMode: null }, { siteUrl: SITE, hasImage: false })
  assert.match(p.embeds[0]!.description, /^NHL 26 · <t:/)
})
```

Note: `1791603720` is `Date.parse('2026-10-10T03:42:00.000Z') / 1000`.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord test`
Expected: FAIL — `./config.ts` / `./message.ts` not found.

- [ ] **Step 4: Implement**

`apps/discord/src/config.ts`:

```ts
export interface PosterConfig {
  webhookUrl: string | null
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  dryRun: boolean
  outDir: string
  pollIntervalMs: number
  renderTimeoutMs: number
}

export type ConfigResult = { ok: true; config: PosterConfig } | { ok: false; problems: string[] }

const WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/',
]

const trimSlash = (s: string) => s.replace(/\/+$/, '')

function intOr(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

/**
 * Reads the poster's environment. Problems never echo a secret's value.
 * Not dry-run and no webhook ⇒ not ok: the service idles and posts nothing.
 */
export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = []
  const dryRun = env['DISCORD_DRY_RUN'] === '1'
  const webhook = env['DISCORD_WEBHOOK_URL']?.trim() || null
  const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
  const web = env['WEB_INTERNAL_URL']?.trim() ?? ''

  if (webhook === null && !dryRun)
    problems.push('DISCORD_WEBHOOK_URL is unset and DISCORD_DRY_RUN is not 1')
  if (webhook !== null && !WEBHOOK_PREFIXES.some((p) => webhook.startsWith(p))) {
    problems.push('DISCORD_WEBHOOK_URL is not a Discord webhook URL')
  }
  if (token.length < 16)
    problems.push('DISCORD_INTERNAL_TOKEN is unset or shorter than 16 characters')
  if (web === '') problems.push('WEB_INTERNAL_URL is unset')

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    config: {
      webhookUrl: webhook,
      internalToken: token,
      webBaseUrl: trimSlash(web),
      siteUrl: trimSlash(env['DISCORD_SITE_URL']?.trim() || 'https://boogeymen.app'),
      dryRun,
      outDir: env['DISCORD_OUT_DIR']?.trim() || '/tmp/discord-out',
      pollIntervalMs: intOr(env['DISCORD_POLL_INTERVAL_MS'], 60000),
      renderTimeoutMs: intOr(env['DISCORD_RENDER_TIMEOUT_MS'], 30000),
    },
  }
}
```

`apps/discord/src/message.ts`:

```ts
import type { DiscordGameResult, DiscordResult, DiscordStar } from '@eanhl/db/discord'

export const CARDS_FILENAME = 'cards.png'

export interface WebhookEmbed {
  title: string
  url: string
  color: number
  description: string
  image?: { url: string }
}

export interface WebhookPayload {
  /** Always empty: a gamertag like "@everyone" must never ping anyone. */
  allowed_mentions: { parse: never[] }
  embeds: WebhookEmbed[]
  attachments?: { id: number; filename: string }[]
}

/** Mirrors apps/web/src/lib/result-colors.ts. */
const COLORS: Record<DiscordResult, number> = {
  WIN: 0x10b981,
  LOSS: 0xe84131,
  OTL: 0xf59e0b,
  DNF: 0x3a3839,
}

const ORDINALS = ['1st', '2nd', '3rd']

export function resultLabel(result: DiscordResult, overtime: boolean): string {
  switch (result) {
    case 'WIN':
      return overtime ? 'WIN (OT)' : 'WIN'
    case 'LOSS':
      return 'LOSS'
    case 'OTL':
      return 'OT LOSS'
    case 'DNF':
      return 'DNF'
  }
}

/** Backslash-escape every character Discord markdown treats as syntax. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|<>[\]()#:-]/g, '\\$&')
}

function starLine(s: DiscordStar, siteUrl: string): string {
  const ordinal = ORDINALS[s.rank - 1] ?? `${String(s.rank)}th`
  const name =
    s.kind === 'member' && s.playerId !== null
      ? `[${escapeMarkdown(s.gamertag)}](${siteUrl}/roster/${String(s.playerId)})`
      : s.kind === 'opponent' && s.teamAbbrev !== null
        ? `${escapeMarkdown(s.gamertag)} (${escapeMarkdown(s.teamAbbrev)})`
        : escapeMarkdown(s.gamertag)
  const parts = [`⭐ **${ordinal}**`, name, `**${s.score.toFixed(2)}**`]
  if (s.statLine !== '') parts.push(escapeMarkdown(s.statLine))
  return parts.join(' · ')
}

export function buildGameResultPayload(
  r: DiscordGameResult,
  opts: { siteUrl: string; hasImage: boolean },
): WebhookPayload {
  const gameUrl = `${opts.siteUrl}/games/${String(r.matchId)}`
  const unix = Math.floor(Date.parse(r.playedAt) / 1000)
  const meta = [r.gameTitleName, r.gameMode, `<t:${String(unix)}:f>`]
    .filter((x): x is string => x !== null && x !== '')
    .join(' · ')
  const body =
    r.result === 'DNF' ? ['Game ended early.'] : r.stars.map((s) => starLine(s, opts.siteUrl))
  const description = [meta, '', ...body, '', `[Full box score →](${gameUrl})`].join('\n')
  const title =
    `BGM ${String(r.scoreFor)} – ${String(r.scoreAgainst)} ${r.opponentName} · ${resultLabel(r.result, r.overtime)}`.slice(
      0,
      256,
    )

  const embed: WebhookEmbed = { title, url: gameUrl, color: COLORS[r.result], description }
  if (opts.hasImage) embed.image = { url: `attachment://${CARDS_FILENAME}` }
  const payload: WebhookPayload = { allowed_mentions: { parse: [] }, embeds: [embed] }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: CARDS_FILENAME }]
  return payload
}
```

Note: the statLine escape turns `+2` → `+2` (unchanged) and `-1` → `\-1` (renders `-1`); the test regex for `2G 1A \+2` stays valid. The meta line keeps `<t:…:f>` unescaped on purpose — it is Discord timestamp markup.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @eanhl/discord test && pnpm --filter @eanhl/discord typecheck`
Expected: PASS (config 4, message 7); typecheck clean.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/discord pnpm-lock.yaml
git commit -m "feat(discord): poster package scaffold, config and message builder"
```

---

### Task 6: Webhook client, web client, renderer, poster cycle

**Files:**

- Create: `apps/discord/src/webhook.ts`, `apps/discord/src/web-client.ts`, `apps/discord/src/render.ts`, `apps/discord/src/cycle.ts`
- Test: `apps/discord/src/webhook.test.ts`, `apps/discord/src/web-client.test.ts`, `apps/discord/src/cycle.test.ts`

**Interfaces:**

- Consumes: `WebhookPayload`, `CARDS_FILENAME`, `buildGameResultPayload` (Task 5); `parseDiscordGameResult`, `DiscordGameResult` (Task 2).
- Produces:
  - `sendWebhook(webhookUrl: string, payload: WebhookPayload, image: Uint8Array | null, fetchImpl?: typeof fetch): Promise<string | null>` — returns Discord message id
  - `fetchGameResult(opts: { webBaseUrl: string; token: string; matchId: number }, fetchImpl?: typeof fetch): Promise<DiscordGameResult>`
  - `renderStarCards(opts: { webBaseUrl: string; token: string; matchId: number; timeoutMs: number }): Promise<Uint8Array>`
  - `interface PosterStore { candidates(since: Date, limit: number): Promise<number[]>; claim(matchId: number): Promise<boolean>; markPosted(matchId: number, messageId: string | null): Promise<void>; markFailed(matchId: number, error: string): Promise<void>; markSkipped(matchId: number, reason: string): Promise<void> }`
  - `interface PosterDeps { store: PosterStore; fetchGameResult(matchId: number): Promise<DiscordGameResult>; renderCards(matchId: number): Promise<Uint8Array>; send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>; writeDryRun(matchId: number, payload: WebhookPayload, image: Uint8Array | null): Promise<void>; log(message: string): void; now(): Date }`
  - `interface CycleOptions { dryRun: boolean; siteUrl: string; windowMs: number; batchLimit: number }`
  - `interface CycleSummary { posted: number; failed: number; dryRun: number }`
  - `runPosterCycle(deps: PosterDeps, opts: CycleOptions): Promise<CycleSummary>`
  - `WINDOW_MS = 86_400_000`, `BATCH_LIMIT = 5`

- [ ] **Step 1: Write the failing tests**

`apps/discord/src/webhook.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { sendWebhook } from './webhook.ts'
import type { WebhookPayload } from './message.ts'

const HOOK = 'https://discord.com/api/webhooks/123/SECRET-TOKEN-VALUE'
const payload: WebhookPayload = { allowed_mentions: { parse: [] }, embeds: [] }

void test('posts multipart with wait=true, payload_json and the png; returns the message id', async () => {
  let seenUrl = ''
  let seenBody: FormData | null = null
  const fake = (async (url: URL | string, init?: RequestInit) => {
    seenUrl = String(url)
    seenBody = init?.body as FormData
    return new Response(JSON.stringify({ id: '555' }), { status: 200 })
  }) as typeof fetch
  const id = await sendWebhook(HOOK, payload, new Uint8Array([137, 80, 78, 71]), fake)
  assert.equal(id, '555')
  assert.match(seenUrl, /\?wait=true$/)
  assert.equal(JSON.parse(String(seenBody!.get('payload_json'))).allowed_mentions.parse.length, 0)
  const file = seenBody!.get('files[0]') as File
  assert.equal(file.name, 'cards.png')
})

void test('no image ⇒ no file part', async () => {
  let seenBody: FormData | null = null
  const fake = (async (_u: URL | string, init?: RequestInit) => {
    seenBody = init?.body as FormData
    return new Response('{"id":"1"}', { status: 200 })
  }) as typeof fetch
  await sendWebhook(HOOK, payload, null, fake)
  assert.equal(seenBody!.get('files[0]'), null)
})

void test('an HTTP error never leaks the webhook URL or token', async () => {
  const fake = (async () =>
    new Response(`{"message": "Unknown Webhook", "url": "${HOOK}"}`, {
      status: 404,
    })) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), (err: Error) => {
    assert.match(err.message, /HTTP 404/)
    assert.ok(!err.message.includes('SECRET-TOKEN-VALUE'))
    assert.ok(!err.message.includes('/api/webhooks/'))
    return true
  })
})

void test('a network failure never leaks the webhook URL', async () => {
  const fake = (async () => {
    throw new TypeError(`fetch failed for ${HOOK}`)
  }) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), (err: Error) => {
    assert.ok(!err.message.includes('SECRET-TOKEN-VALUE'))
    return true
  })
})
```

`apps/discord/src/web-client.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchGameResult } from './web-client.ts'

void test('sends the token header and parses the contract', async () => {
  let header: string | null = null
  const fake = (async (_u: URL | string, init?: RequestInit) => {
    header = new Headers(init?.headers).get('x-internal-token')
    return new Response('{"bad": true}', { status: 200 })
  }) as typeof fetch
  await assert.rejects(
    fetchGameResult({ webBaseUrl: 'http://web:3000', token: 't'.repeat(32), matchId: 1 }, fake),
    /discord contract/,
  )
  assert.equal(header, 't'.repeat(32))
})

void test('non-2xx is an error naming only the status', async () => {
  const fake = (async () => new Response('nope', { status: 404 })) as typeof fetch
  await assert.rejects(
    fetchGameResult({ webBaseUrl: 'http://web:3000', token: 't'.repeat(32), matchId: 1 }, fake),
    /game data HTTP 404/,
  )
})
```

`apps/discord/src/cycle.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordGameResult } from '@eanhl/db/discord'
import { runPosterCycle, type PosterDeps, type PosterStore } from './cycle.ts'
import type { WebhookPayload } from './message.ts'

const NOW = new Date('2026-10-10T12:00:00Z')
const result = (id: number, cards: number[]): DiscordGameResult => ({
  matchId: id,
  result: 'WIN',
  overtime: false,
  scoreFor: 3,
  scoreAgainst: 1,
  opponentName: 'Opp',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T11:00:00.000Z',
  stars: cards.map((pid, i) => ({
    rank: i + 1,
    gamertag: `P${String(pid)}`,
    kind: 'member',
    playerId: pid,
    score: 5,
    statLine: '',
    teamAbbrev: null,
  })),
  cardPlayerIds: cards,
})

function harness(over: Partial<PosterDeps> = {}, candidates = [1]) {
  const events: string[] = []
  const claimed = new Set<number>()
  const store: PosterStore = {
    candidates: async (since, limit) => {
      events.push(`candidates:${since.toISOString()}:${String(limit)}`)
      return candidates
    },
    claim: async (id) => {
      if (claimed.has(id)) return false
      claimed.add(id)
      events.push(`claim:${String(id)}`)
      return true
    },
    markPosted: async (id, msg) => void events.push(`posted:${String(id)}:${String(msg)}`),
    markFailed: async (id, err) => void events.push(`failed:${String(id)}:${err}`),
    markSkipped: async (id, why) => void events.push(`skipped:${String(id)}:${why}`),
  }
  const sent: { payload: WebhookPayload; image: Uint8Array | null }[] = []
  const deps: PosterDeps = {
    store,
    fetchGameResult: async (id) => result(id, [7]),
    renderCards: async () => new Uint8Array([1, 2, 3]),
    send: async (payload, image) => {
      sent.push({ payload, image })
      return 'msg-1'
    },
    writeDryRun: async (id) => void events.push(`dry:${String(id)}`),
    log: (m) => void events.push(`log:${m}`),
    now: () => NOW,
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

void test('asks for the last 24 h only', async () => {
  const h = harness()
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.events[0], 'candidates:2026-10-09T12:00:00.000Z:5')
})

void test('happy path: claim, render, send with image, mark posted', async () => {
  const h = harness()
  const s = await runPosterCycle(h.deps, OPTS)
  assert.deepEqual(s, { posted: 1, failed: 0, dryRun: 0 })
  assert.ok(h.events.includes('posted:1:msg-1'))
  assert.equal(h.sent[0]?.image?.length, 3)
  assert.ok(h.sent[0]?.payload.embeds[0]?.image)
})

void test('render failure ⇒ text-only post, still posted', async () => {
  const h = harness({
    renderCards: async () => {
      throw new Error('chromium died')
    },
  })
  const s = await runPosterCycle(h.deps, OPTS)
  assert.equal(s.posted, 1)
  assert.equal(h.sent[0]?.image, null)
  assert.equal(h.sent[0]?.payload.embeds[0]?.image, undefined)
})

void test('no member cards ⇒ no render call, no image', async () => {
  let rendered = false
  const h = harness({
    fetchGameResult: async (id) => result(id, []),
    renderCards: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runPosterCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('send failure ⇒ marked failed, not posted', async () => {
  const h = harness({
    send: async () => {
      throw new Error('Discord webhook HTTP 429')
    },
  })
  const s = await runPosterCycle(h.deps, OPTS)
  assert.deepEqual(s, { posted: 0, failed: 1, dryRun: 0 })
  assert.ok(h.events.includes('failed:1:Discord webhook HTTP 429'))
})

void test('game data failure ⇒ marked failed, nothing sent', async () => {
  const h = harness({
    fetchGameResult: async () => {
      throw new Error('game data HTTP 500')
    },
  })
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('failed:1:game data HTTP 500'))
})

void test('a game the store will not let us claim is never sent', async () => {
  const h = harness({}, [1, 1])
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 1)
})

void test('dry run writes files, marks skipped, sends nothing', async () => {
  const h = harness()
  const s = await runPosterCycle(h.deps, { ...OPTS, dryRun: true })
  assert.deepEqual(s, { posted: 0, failed: 0, dryRun: 1 })
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('dry:1'))
  assert.ok(h.events.includes('skipped:1:dry run'))
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @eanhl/discord test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/discord/src/webhook.ts`:

```ts
import { CARDS_FILENAME, type WebhookPayload } from './message.ts'

/**
 * POST one message to the webhook and return its id (`?wait=true`). Errors
 * name the HTTP status only: the webhook URL is a secret and must never reach
 * a log line or discord_posts.last_error.
 */
export async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  image: Uint8Array | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(webhookUrl)
  url.searchParams.set('wait', 'true')
  const form = new FormData()
  form.append('payload_json', JSON.stringify(payload))
  if (image !== null) {
    form.append(
      'files[0]',
      new Blob([new Uint8Array(image)], { type: 'image/png' }),
      CARDS_FILENAME,
    )
  }
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    throw new Error(`Discord webhook request failed (${name})`)
  }
  if (!res.ok) throw new Error(`Discord webhook HTTP ${String(res.status)}`)
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null
  return typeof json?.id === 'string' ? json.id : null
}
```

`apps/discord/src/web-client.ts`:

```ts
import { parseDiscordGameResult, type DiscordGameResult } from '@eanhl/db/discord'

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

export async function fetchGameResult(
  opts: { webBaseUrl: string; token: string; matchId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordGameResult> {
  const res = await fetchImpl(`${opts.webBaseUrl}/internal/discord/game/${String(opts.matchId)}`, {
    headers: { [INTERNAL_TOKEN_HEADER]: opts.token },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`game data HTTP ${String(res.status)}`)
  return parseDiscordGameResult(await res.json())
}
```

`apps/discord/src/render.ts`:

```ts
import { chromium } from 'playwright'
import { INTERNAL_TOKEN_HEADER } from './web-client.ts'

/**
 * Screenshot the member stars' real cards. Reduced motion + disabled
 * animations ⇒ each card's still variant. A fresh browser per render, always
 * closed; a hard timeout kills it if anything hangs.
 */
export async function renderStarCards(opts: {
  webBaseUrl: string
  token: string
  matchId: number
  timeoutMs: number
}): Promise<Uint8Array> {
  const browser = await chromium.launch()
  const killer = setTimeout(() => void browser.close(), opts.timeoutMs + 5_000)
  try {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      deviceScaleFactor: 2,
      viewport: { width: 1000, height: 700 },
      extraHTTPHeaders: { [INTERNAL_TOKEN_HEADER]: opts.token },
    })
    const page = await context.newPage()
    const res = await page.goto(
      `${opts.webBaseUrl}/internal/discord/stars/${String(opts.matchId)}`,
      { waitUntil: 'networkidle', timeout: opts.timeoutMs },
    )
    if (res === null || !res.ok()) throw new Error(`card page HTTP ${String(res?.status() ?? 0)}`)
    const strip = page.locator('#discord-stars')
    await strip.waitFor({ state: 'visible', timeout: opts.timeoutMs })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? null
            : new Promise((resolve) => {
                img.onload = resolve
                img.onerror = resolve
              }),
        ),
      )
    })
    const png = await strip.screenshot({
      type: 'png',
      animations: 'disabled',
      timeout: opts.timeoutMs,
    })
    return new Uint8Array(png)
  } finally {
    clearTimeout(killer)
    await browser.close().catch(() => undefined)
  }
}
```

`apps/discord/src/cycle.ts`:

```ts
import type { DiscordGameResult } from '@eanhl/db/discord'
import { buildGameResultPayload, type WebhookPayload } from './message.ts'

export const WINDOW_MS = 86_400_000
export const BATCH_LIMIT = 5

export interface PosterStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(matchId: number): Promise<boolean>
  markPosted(matchId: number, messageId: string | null): Promise<void>
  markFailed(matchId: number, error: string): Promise<void>
  markSkipped(matchId: number, reason: string): Promise<void>
}

export interface PosterDeps {
  store: PosterStore
  fetchGameResult(matchId: number): Promise<DiscordGameResult>
  renderCards(matchId: number): Promise<Uint8Array>
  send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(matchId: number, payload: WebhookPayload, image: Uint8Array | null): Promise<void>
  log(message: string): void
  now(): Date
}

export interface CycleOptions {
  dryRun: boolean
  siteUrl: string
  windowMs: number
  batchLimit: number
}

export interface CycleSummary {
  posted: number
  failed: number
  dryRun: number
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * One pass: claim each eligible game, build its post, send (or dry-run), and
 * record the outcome. A card render failure degrades to a text-only post; any
 * other failure marks the row failed for a later retry. Never throws for a
 * single game.
 */
export async function runPosterCycle(deps: PosterDeps, opts: CycleOptions): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  const ids = await deps.store.candidates(since, opts.batchLimit)

  for (const matchId of ids) {
    if (!(await deps.store.claim(matchId))) continue
    try {
      const result = await deps.fetchGameResult(matchId)
      let image: Uint8Array | null = null
      if (result.cardPlayerIds.length > 0) {
        try {
          image = await deps.renderCards(matchId)
        } catch (err: unknown) {
          deps.log(
            `game ${String(matchId)}: card render failed, posting text only (${message(err)})`,
          )
        }
      }
      const payload = buildGameResultPayload(result, {
        siteUrl: opts.siteUrl,
        hasImage: image !== null,
      })
      if (opts.dryRun) {
        await deps.writeDryRun(matchId, payload, image)
        await deps.store.markSkipped(matchId, 'dry run')
        summary.dryRun++
      } else {
        const messageId = await deps.send(payload, image)
        await deps.store.markPosted(matchId, messageId)
        summary.posted++
      }
    } catch (err: unknown) {
      deps.log(`game ${String(matchId)}: failed (${message(err)})`)
      await deps.store.markFailed(matchId, message(err))
      summary.failed++
    }
  }
  return summary
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @eanhl/discord test && pnpm --filter @eanhl/discord typecheck`
Expected: all PASS; typecheck clean. (`render.ts` is not unit-tested — it needs a browser and the web app; Task 7 exercises it for real.)

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/discord/src
git commit -m "feat(discord): webhook/web clients, card renderer, poster cycle"
```

---

### Task 7: Entry loop, DB store, preview CLI — local end-to-end

**Files:**

- Create: `apps/discord/src/store.ts`, `apps/discord/src/dry-run.ts`, `apps/discord/src/index.ts`, `apps/discord/src/preview-cli.ts`

**Interfaces:**

- Consumes: Task 1 queries; Tasks 5–6 modules.
- Produces: `dbStore: PosterStore`; `writeDryRunFiles(outDir: string, matchId: number, payload: WebhookPayload, image: Uint8Array | null): Promise<string>` (returns the directory written); executables `dist/index.js`, `dist/preview-cli.js`.

- [ ] **Step 1: Write the store and dry-run writer**

`apps/discord/src/store.ts`:

```ts
import {
  claimDiscordPost,
  listDiscordPostCandidates,
  markDiscordPostFailed,
  markDiscordPostPosted,
  markDiscordPostSkipped,
} from '@eanhl/db/queries'
import type { PosterStore } from './cycle.ts'

export const dbStore: PosterStore = {
  candidates: (since, limit) => listDiscordPostCandidates({ since, limit }),
  claim: claimDiscordPost,
  markPosted: markDiscordPostPosted,
  markFailed: markDiscordPostFailed,
  markSkipped: markDiscordPostSkipped,
}
```

`apps/discord/src/dry-run.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CARDS_FILENAME, type WebhookPayload } from './message.ts'

/** Write what would have been posted to <outDir>/<matchId>/. */
export async function writeDryRunFiles(
  outDir: string,
  matchId: number,
  payload: WebhookPayload,
  image: Uint8Array | null,
): Promise<string> {
  const dir = path.join(outDir, String(matchId))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'payload.json'), JSON.stringify(payload, null, 2))
  if (image !== null) await writeFile(path.join(dir, CARDS_FILENAME), image)
  return dir
}
```

- [ ] **Step 2: Write the entry loop**

`apps/discord/src/index.ts`:

```ts
/**
 * Discord poster entry point. Non-overlapping loop (async wait, like the
 * worker). Reads match data only through the web app's internal routes and
 * writes only discord_posts. Bad config ⇒ log once and idle (no restart loop,
 * no posts).
 *
 * Env: DATABASE_URL, DISCORD_WEBHOOK_URL, DISCORD_INTERNAL_TOKEN,
 * WEB_INTERNAL_URL, DISCORD_DRY_RUN, DISCORD_SITE_URL, DISCORD_OUT_DIR,
 * DISCORD_POLL_INTERVAL_MS, DISCORD_RENDER_TIMEOUT_MS.
 */
import { loadConfig } from './config.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const log = (m: string) => console.log(`[discord] ${m}`)

async function main(): Promise<void> {
  const loaded = loadConfig(process.env)
  if (!loaded.ok) {
    log(`not posting: ${loaded.problems.join('; ')}`)
    for (;;) await sleep(3_600_000)
  }
  const config = loaded.config
  // Imported after the config check so a misconfigured host never opens a DB pool.
  const { listStuckDiscordPosts } = await import('@eanhl/db/queries')
  const { dbStore } = await import('./store.ts')
  const { runPosterCycle, WINDOW_MS, BATCH_LIMIT } = await import('./cycle.ts')
  const { fetchGameResult } = await import('./web-client.ts')
  const { renderStarCards } = await import('./render.ts')
  const { sendWebhook } = await import('./webhook.ts')
  const { writeDryRunFiles } = await import('./dry-run.ts')

  const stuck = await listStuckDiscordPosts(new Date(Date.now() - 10 * 60_000))
  if (stuck.length > 0) log(`left pending by an earlier crash (not retried): ${stuck.join(', ')}`)
  log(`started (${config.dryRun ? 'DRY RUN' : 'live'}), every ${String(config.pollIntervalMs)}ms`)

  const web = { webBaseUrl: config.webBaseUrl, token: config.internalToken }
  for (;;) {
    const start = Date.now()
    try {
      const s = await runPosterCycle(
        {
          store: dbStore,
          fetchGameResult: (matchId) => fetchGameResult({ ...web, matchId }),
          renderCards: (matchId) =>
            renderStarCards({ ...web, matchId, timeoutMs: config.renderTimeoutMs }),
          send: (payload, image) => {
            if (config.webhookUrl === null) throw new Error('no webhook configured')
            return sendWebhook(config.webhookUrl, payload, image)
          },
          writeDryRun: async (matchId, payload, image) => {
            log(`dry run → ${await writeDryRunFiles(config.outDir, matchId, payload, image)}`)
          },
          log,
          now: () => new Date(),
        },
        {
          dryRun: config.dryRun,
          siteUrl: config.siteUrl,
          windowMs: WINDOW_MS,
          batchLimit: BATCH_LIMIT,
        },
      )
      if (s.posted + s.failed + s.dryRun > 0) log(`cycle: ${JSON.stringify(s)}`)
    } catch (err: unknown) {
      log(`cycle error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(Math.max(0, config.pollIntervalMs - (Date.now() - start)))
  }
}

main().catch((err: unknown) => {
  console.error('[discord] fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Write the preview CLI**

`apps/discord/src/preview-cli.ts`:

```ts
/**
 * Render one game's post to disk without touching the database or Discord:
 *   DISCORD_INTERNAL_TOKEN=… WEB_INTERNAL_URL=http://localhost:3000 \
 *     pnpm --filter @eanhl/discord preview --match-id 1234 [--out ./discord-preview]
 */
import { buildGameResultPayload } from './message.ts'
import { fetchGameResult } from './web-client.ts'
import { renderStarCards } from './render.ts'
import { writeDryRunFiles } from './dry-run.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const matchId = Number.parseInt(arg('--match-id') ?? '', 10)
const outDir = arg('--out') ?? './discord-preview'
const token = process.env['DISCORD_INTERNAL_TOKEN'] ?? ''
const webBaseUrl = (process.env['WEB_INTERNAL_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
const siteUrl = (process.env['DISCORD_SITE_URL'] ?? 'https://boogeymen.app').replace(/\/+$/, '')

if (!Number.isSafeInteger(matchId) || matchId <= 0 || token.length < 16) {
  console.error('usage: DISCORD_INTERNAL_TOKEN=… preview --match-id N [--out DIR]')
  process.exit(2)
}

const result = await fetchGameResult({ webBaseUrl, token, matchId })
const image =
  result.cardPlayerIds.length > 0
    ? await renderStarCards({ webBaseUrl, token, matchId, timeoutMs: 30_000 })
    : null
const payload = buildGameResultPayload(result, { siteUrl, hasImage: image !== null })
console.log(`wrote ${await writeDryRunFiles(outDir, matchId, payload, image)}`)
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord build && pnpm --filter @eanhl/discord test`
Expected: clean build, tests PASS.

- [ ] **Step 5: End-to-end preview against the local dev server (manual)**

With the Task 4 dev server running with `DISCORD_INTERNAL_TOKEN`, pick four games from `eanhl_preview`: a WIN with ≥2 member stars, a LOSS, a DNF, and one where a star is an opponent or guest.

```bash
T=$(cat /tmp/claude-discord-token)
for M in <win> <loss> <dnf> <guest>; do
  DISCORD_INTERNAL_TOKEN=$T WEB_INTERNAL_URL=http://localhost:3000 \
    pnpm --filter @eanhl/discord preview --match-id $M \
    --out /tmp/claude-1000/-home-michal-projects-eanhl-team-website/discord-preview
done
```

Expected, checked by opening each `cards.png` and `payload.json`:

- Cards appear 1st → 2nd → 3rd, each in the player's equipped theme, no motion artifacts, no nav bar, crisp (2×).
- The stars/scores in `payload.json` match `/games/<id>` exactly.
- DNF: no `cards.png`, grey colour, "Game ended early."
- Guest/opponent star: text line only, no card in the image.

Show the operator the rendered images before committing (they approve the look).

- [ ] **Step 6: Run the real loop in dry-run against `eanhl_preview` once**

```bash
T=$(cat /tmp/claude-discord-token)
set -a && source .env && set +a   # DATABASE_URL for the local container
DATABASE_URL="${DATABASE_URL%/*}/eanhl_preview" DISCORD_DRY_RUN=1 \
  DISCORD_INTERNAL_TOKEN=$T WEB_INTERNAL_URL=http://localhost:3000 \
  DISCORD_OUT_DIR=/tmp/claude-1000/-home-michal-projects-eanhl-team-website/discord-dry \
  timeout 90 node apps/discord/dist/index.js
```

Expected: logs `started (DRY RUN)`; no cycle output (every preview-DB match is `skipped` from the migration and older than 24 h). That proves the history guard. Optionally, to see a dry-run cycle, inside a psql session `DELETE FROM discord_posts WHERE match_id = <recent id>` **and** temporarily `UPDATE matches SET played_at = now() - interval '1 hour' WHERE id = <id>` on `eanhl_preview` only, rerun, confirm a `dry run →` line and the row becomes `skipped`/`dry run`, then restore `played_at` to its original value.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/discord/src
git commit -m "feat(discord): poster entry loop, DB store, preview CLI"
```

---

### Task 8: Packaging — Dockerfile, Compose service, existing Dockerfiles

**Files:**

- Create: `apps/discord/Dockerfile`
- Modify: `apps/worker/Dockerfile` (add `COPY apps/discord/package.json apps/discord/` with the other package.json copies)
- Modify: `apps/web/Dockerfile` (same line)
- Modify: `docker-compose.yml` (new `discord` service; `DISCORD_INTERNAL_TOKEN` on `web`)
- Modify: `.env.example` (poster vars)

- [ ] **Step 1: Write the Dockerfile**

`apps/discord/Dockerfile`:

```dockerfile
# Debian, not alpine: Playwright's Chromium needs glibc.
FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

# ── Install layer ─────────────────────────────────────────────────────────────
# Every workspace package.json must be present for --frozen-lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/discord/package.json apps/discord/
COPY packages/db/package.json packages/db/
COPY packages/ea-client/package.json packages/ea-client/

RUN pnpm install --frozen-lockfile --filter "@eanhl/discord..."

# Chromium + its OS libraries (needs root, so before USER node).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd apps/discord && pnpm exec playwright install --with-deps chromium && \
    chmod -R a+rX /ms-playwright

# ── Build layer ───────────────────────────────────────────────────────────────
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/discord/ apps/discord/

RUN pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord build

# ── Runtime ───────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
WORKDIR /app/apps/discord
USER node
CMD ["node", "dist/index.js"]
```

In `apps/worker/Dockerfile` and `apps/web/Dockerfile`, after `COPY apps/worker/package.json apps/worker/`, add:

```dockerfile
COPY apps/discord/package.json apps/discord/
```

- [ ] **Step 2: Add the Compose service**

In `docker-compose.yml`, add to `web.environment`:

```yaml
DISCORD_INTERNAL_TOKEN: ${DISCORD_INTERNAL_TOKEN:-}
```

Add after the `web` service:

```yaml
  # OPT-IN (like cloudflared). Posts game results to Discord. A host that
  # doesn't pass `--profile discord` never runs it — the stopped fallback stack
  # on the main PC can never post. Defaults to DRY RUN: set
  # DISCORD_DRY_RUN=0 in .env to post for real.
  discord:
    profiles: ['discord']
    build:
      context: .
      dockerfile: apps/discord/Dockerfile
    restart: unless-stopped
    logging: *default-logging
    mem_limit: 1g
    environment:
      DATABASE_URL: postgresql://eanhl:${POSTGRES_PASSWORD}@db:5432/eanhl
      DISCORD_WEBHOOK_URL: ${DISCORD_WEBHOOK_URL:-}
      DISCORD_INTERNAL_TOKEN: ${DISCORD_INTERNAL_TOKEN:-}
      DISCORD_DRY_RUN: ${DISCORD_DRY_RUN:-1}
      DISCORD_SITE_URL: ${DISCORD_SITE_URL:-https://boogeymen.app}
      DISCORD_POLL_INTERVAL_MS: ${DISCORD_POLL_INTERVAL_MS:-60000}
      DISCORD_OUT_DIR: /tmp/discord-out
      WEB_INTERNAL_URL: http://web:3000
    depends_on:
      db:
        condition: service_healthy
      web:
        condition: service_started
```

In `.env.example`, after `DISCORD_INTERNAL_TOKEN=`, add:

```bash
# Discord game-result poster (`--profile discord`). Webhook: channel → Edit →
# Integrations → Webhooks. DRY RUN (1, the default) writes /tmp/discord-out in
# the container instead of posting.
DISCORD_WEBHOOK_URL=
DISCORD_DRY_RUN=1
```

- [ ] **Step 3: Verify the images build (distinct tags; does not touch the compose images)**

```bash
docker compose config --profiles >/dev/null && docker compose --profile discord config --services
docker build -f apps/discord/Dockerfile -t eanhl-discord-check .
docker build -f apps/worker/Dockerfile -t eanhl-worker-check .
docker run --rm -e DISCORD_INTERNAL_TOKEN= eanhl-discord-check timeout 5 node dist/index.js; echo "exit=$?"
docker image ls eanhl-discord-check --format '{{.Size}}'
```

Expected: services list includes `discord`; both builds succeed; the run logs `not posting: …` (idle, no crash; `timeout` exits 124); image size noted (expect under ~1.5 GB). Do **not** `docker compose up` on this machine (stopped fallback). Remove the check images afterwards: `docker image rm eanhl-discord-check eanhl-worker-check`.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/discord/Dockerfile apps/worker/Dockerfile apps/web/Dockerfile docker-compose.yml .env.example
git commit -m "feat(ops): opt-in discord Compose service (dry-run by default)"
```

---

### Task 9: Docs

**Files:**

- Modify: `docs/journal/2026-10.md` (dated entry)
- Modify: `HANDOFF.md` (in place; check size ≤ 200 lines / 12 KB)
- Modify: `CLAUDE.md` Commands block (add `pnpm --filter @eanhl/discord preview --match-id N` and the `--profile discord` note) — one line each

- [ ] **Step 1:** Write the journal entry: what shipped, migration 0067, the opt-in profile, dry-run default, the rollout steps still pending.
- [ ] **Step 2:** Update `HANDOFF.md` per `.claude/skills/handoff-update/SKILL.md` — current objective "Discord game-result posts: built, rollout pending", next actions = Task 10 steps. Run `wc -l -c HANDOFF.md`.
- [ ] **Step 3:** Commit `docs(handoff): Discord poster built, rollout pending` and push `main`.

---

### Task 10: Rollout on Hotel-Echo (operator-gated — confirm each step)

Use the `docker-redeploy` skill for every rebuild. Each step needs the operator's OK.

- [ ] **Step 1:** On HE, append to `~/eanhl-team-website/.env`: `DISCORD_INTERNAL_TOKEN=$(openssl rand -hex 32)` and `DISCORD_DRY_RUN=1`. (No webhook yet.)
- [ ] **Step 2:** Apply `0067` to the live DB (HE container `eanhl-team-website-db-1`, `-d eanhl`) with the header command; confirm `discord_posts_rows = matches`. Also apply to the verification seed DB per `ops/README.md` (missing migrations there cause false verify-ocr failures).
- [ ] **Step 3:** Redeploy `web` (new internal routes + token env). From HE: `curl -s -o /dev/null -w '%{http_code}' https://boogeymen.app/internal/discord/game/1` → `404`.
- [ ] **Step 4:** Start the poster: `docker compose --profile public --profile discord up -d --build discord`. Logs show `started (DRY RUN)`. After the next real game: `docker compose exec discord ls /tmp/discord-out/<id>`; `docker compose cp discord:/tmp/discord-out ./discord-out` and show the operator `cards.png` + `payload.json`.
- [ ] **Step 5:** Operator creates a private `#bot-test` channel + webhook. Put it in `.env` as `DISCORD_WEBHOOK_URL`, set `DISCORD_DRY_RUN=0`, `docker compose --profile public --profile discord up -d discord`. Verify the next game posts there.
- [ ] **Step 6:** Operator approves → replace `DISCORD_WEBHOOK_URL` with the real channel's webhook, restart `discord`. Note in the journal + handoff.

**Off switch:** `docker compose stop discord` (or unset `DISCORD_WEBHOOK_URL` / set `DISCORD_DRY_RUN=1` and restart it).
