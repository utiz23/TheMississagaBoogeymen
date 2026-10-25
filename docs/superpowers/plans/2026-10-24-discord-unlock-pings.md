# Discord Unlock Pings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new-card unlock post (tier up, mythic award) pings the player it is about; nothing else pings.

**Architecture:** Migration 0070 adds `players.discord_user_id` (manual ID). `getPlayerDiscordUserId` prefers the Discord sign-in ID (`accounts` via `user_player_claims`) over the manual one. The unlock loader sets `discordUserId` only for `tier`/`mythic`; the poster's message builder adds `<@ID>` and allows exactly that user. A new `/admin` section lists the team with each player's ID (sign-in, read-only; else a manual field).

**Tech Stack:** TypeScript strict, Drizzle + hand-written SQL, Next.js 15 Server Actions, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-discord-unlock-pings-design.md`

## Global Constraints

- Only `tier` and `mythic` unlocks carry a `discordUserId`; every other kind and every game post keeps `allowed_mentions: { parse: [] }`.
- A ping message: `**[NAME](<URL>)** <@ID> has unlocked the **X** card!` with `allowed_mentions: { parse: [], users: ['ID'] }`.
- A Discord user ID is `^[0-9]{17,20}$` everywhere (DB CHECK, admin parser, contract parser).
- Sign-in ID beats the manual ID.
- The manual IDs are personal data: they are entered on live after deploy (admin page or one SQL update from the operator's list), never committed.
- Work on a short branch `feat/discord-pings` in the main checkout (clean tree).
- Gates: typecheck, unit tests, `pnpm format`. Rebuild `@eanhl/db` after editing it.

## Review Focus

1. A badge or card-level unlock for a player who has an ID — no ping. Pinned in Task 2 (message test).
2. A malformed stored ID (somehow) — never reaches Discord as a mention. Pinned in Task 1 (DB CHECK) and Task 2 (contract rejects).
3. A player with both a sign-in ID and a manual ID — the sign-in ID is used. Pinned in Task 1 (SQL `coalesce` order).
4. A non-admin posting the save action directly — refused. Pinned in Task 3 (`requireAdmin` first; parser test).
5. Clearing a manual ID (empty field) — stored as NULL, no ping afterwards. Pinned in Task 3 (parser test) and Task 1 (setter).

---

### Task 1: Column, ID lookup, admin queries

**Files:**

- Create: `packages/db/migrations/0070_player_discord_user_id.sql`
- Modify: `packages/db/src/schema/players.ts` (+ `discordUserId`)
- Create: `packages/db/src/queries/discord-ids.ts`; modify `queries/index.ts`
- Test: `packages/db/src/queries/__tests__/discord-ids.test.ts`

**Interfaces (produces):**

- `DISCORD_USER_ID_RE = /^[0-9]{17,20}$/`
- `playerDiscordUserIdSql(playerId: number): SQL`; `getPlayerDiscordUserId(playerId: number): Promise<string | null>`
- `interface DiscordPingRow { playerId: number; gamertag: string; signInId: string | null; manualId: string | null }`; `listDiscordPingRows(gameTitleId: number): Promise<DiscordPingRow[]>` — the roster-menu members of that title plus anyone with a manual ID, A–Z
- `setPlayerDiscordUserId(playerId: number, id: string | null): Promise<void>`

- [ ] **Step 1: Migration**

```sql
-- Migration: players.discord_user_id — manual Discord user ID for unlock pings
-- Spec: docs/superpowers/specs/2026-10-24-discord-unlock-pings-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-unlock-pings.md (task 1).
--
-- Used only when the player has no Discord sign-in (the sign-in ID wins).
-- Entered on /admin. A Discord user ID is 17–20 digits.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0069):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0070_player_discord_user_id.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   ALTER TABLE "players" DROP COLUMN IF EXISTS "discord_user_id";

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "discord_user_id" text;

DO $$ BEGIN
  ALTER TABLE "players" ADD CONSTRAINT "players_discord_user_id_check"
    CHECK ("discord_user_id" IS NULL OR "discord_user_id" ~ '^[0-9]{17,20}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

SELECT count(*) FILTER (WHERE "discord_user_id" IS NOT NULL) AS "with_manual_id" FROM "players";
```

- [ ] **Step 2: Schema** — in `players.ts`, add `discordUserId: text('discord_user_id'),` with a doc comment ("Manual Discord user ID for unlock pings (migration 0070); the sign-in ID wins.").

- [ ] **Step 3: Failing test** — `discord-ids.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-ids-test:unused@127.0.0.1:1/unused'
const { playerDiscordUserIdSql, DISCORD_USER_ID_RE } = await import('../discord-ids.js')
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('lookup: the Discord sign-in ID first, then the manual ID', () => {
  const q = new PgDialect().sqlToQuery(playerDiscordUserIdSql(28))
  const s = flat(q.sql)
  assert.match(
    s,
    /coalesce\( ?\( ?select a\.account_id from user_player_claims c join accounts a on a\.user_id = c\.user_id and a\.provider_id = 'discord' where c\.player_id = p\.id limit 1 ?\), p\.discord_user_id ?\)/,
  )
  assert.match(s, /from players p where p\.id = \$1/)
  assert.deepEqual(q.params, [28])
})

void test('Discord user ID shape', () => {
  assert.ok(DISCORD_USER_ID_RE.test('447213088828030998'))
  assert.ok(!DISCORD_USER_ID_RE.test('1234'))
  assert.ok(!DISCORD_USER_ID_RE.test('12345678901234567x'))
})
```

Run → FAIL (module missing).

- [ ] **Step 4: Queries** — `discord-ids.ts`:

```ts
import { eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { players } from '../schema/index.js'

/** A Discord user ID (snowflake): 17–20 digits. Same rule as the 0070 CHECK. */
export const DISCORD_USER_ID_RE = /^[0-9]{17,20}$/

/** The player's Discord user ID: their Discord sign-in wins, else the manual ID. */
export function playerDiscordUserIdSql(playerId: number): SQL {
  return sql`
    select coalesce(
      (select a.account_id from user_player_claims c
        join accounts a on a.user_id = c.user_id and a.provider_id = 'discord'
        where c.player_id = p.id limit 1),
      p.discord_user_id
    ) as discord_user_id
    from players p where p.id = ${playerId}`
}

export async function getPlayerDiscordUserId(playerId: number): Promise<string | null> {
  const rows = await db.execute<{ discord_user_id: string | null }>(
    playerDiscordUserIdSql(playerId),
  )
  const id = rows[0]?.discord_user_id ?? null
  return id !== null && DISCORD_USER_ID_RE.test(id) ? id : null
}

export interface DiscordPingRow {
  playerId: number
  gamertag: string
  /** From the player's Discord sign-in; read-only on the admin page. */
  signInId: string | null
  /** Entered on the admin page; used only without a sign-in ID. */
  manualId: string | null
}

/** The team for `gameTitleId` (as the roster menu) plus anyone with a manual ID, A–Z. */
export async function listDiscordPingRows(gameTitleId: number): Promise<DiscordPingRow[]> {
  const rows = await db.execute<{
    id: number
    gamertag: string
    sign_in_id: string | null
    manual_id: string | null
  }>(sql`
    select p.id, p.gamertag,
      (select a.account_id from user_player_claims c
        join accounts a on a.user_id = c.user_id and a.provider_id = 'discord'
        where c.player_id = p.id limit 1) as sign_in_id,
      p.discord_user_id as manual_id
    from players p
    where p.ai_goalie_side is null
      and (
        p.discord_user_id is not null
        or p.pinned_to_roster
        or exists (select 1 from ea_member_season_stats e where e.player_id = p.id and e.game_title_id = ${gameTitleId})
      )
    order by lower(p.gamertag)`)
  return rows.map((r) => ({
    playerId: Number(r.id),
    gamertag: r.gamertag,
    signInId: r.sign_in_id,
    manualId: r.manual_id,
  }))
}

export async function setPlayerDiscordUserId(playerId: number, id: string | null): Promise<void> {
  if (id !== null && !DISCORD_USER_ID_RE.test(id)) throw new Error('invalid Discord user ID')
  await db.update(players).set({ discordUserId: id }).where(eq(players.id, playerId))
}
```

Export from `queries/index.ts`.

- [ ] **Step 5:** Run → PASS. Commit `feat(db): manual Discord user IDs and the ping ID lookup (migration 0070)`.

---

### Task 2: Contract + message — ping only on new cards

**Files:**

- Modify: `packages/db/src/discord/contract.ts` (+ `discordUserId`), `contract.test.ts`
- Modify: `apps/discord/src/message.ts` (`MessagePayload.allowed_mentions` gains `users?`; `buildUnlockPayload` mention), `message.test.ts`

**Interfaces:** `DiscordUnlock.discordUserId: string | null` (17–20 digits or null; parser rejects otherwise). `MessagePayload.allowed_mentions: { parse: never[]; users?: string[] }`.

- [ ] **Step 1: Failing tests**

`contract.test.ts` — in the unlock round-trip value add `discordUserId: null`; add:

```ts
void test('unlock discordUserId: 17–20 digits or null', () => {
  const v = { eventId: 9, playerId: 2, name: 'A', kind: 'tier', subject: 'STUD', graphic: 'card' }
  assert.equal(
    parseDiscordUnlock({ ...v, discordUserId: '447213088828030998' }).discordUserId,
    '447213088828030998',
  )
  assert.equal(parseDiscordUnlock({ ...v, discordUserId: null }).discordUserId, null)
  assert.throws(() => parseDiscordUnlock({ ...v, discordUserId: '12ab' }), /discordUserId/)
})
```

(Also add `discordUserId: null` to the `parseDiscordUnlockResponse` test's unlock value.)

`message.test.ts` — add `discordUserId: null` to the existing unlock fixtures; add:

```ts
void test('new-card unlocks ping exactly their player; nothing else pings', () => {
  const base = {
    eventId: 1,
    playerId: 2,
    name: 'SILKY',
    graphic: 'card' as const,
    discordUserId: '447213088828030998',
  }
  const tier = buildUnlockPayload(
    { ...base, kind: 'tier', subject: 'STUD' },
    { siteUrl: 'https://boogeymen.app', hasImage: true },
  )
  assert.equal(
    tier.content,
    '**[SILKY](<https://boogeymen.app/roster/2>)** <@447213088828030998> has unlocked the **STUD** card!',
  )
  assert.deepEqual(tier.allowed_mentions, { parse: [], users: ['447213088828030998'] })
  const mythic = buildUnlockPayload(
    { ...base, kind: 'mythic', subject: 'CYBER' },
    { siteUrl: 'https://boogeymen.app', hasImage: true },
  )
  assert.deepEqual(mythic.allowed_mentions, { parse: [], users: ['447213088828030998'] })
  for (const kind of ['badge', 'card_level'] as const) {
    const p = buildUnlockPayload(
      { ...base, kind, subject: '5' },
      { siteUrl: 'https://boogeymen.app', hasImage: true },
    )
    assert.deepEqual(p.allowed_mentions, { parse: [] })
    assert.doesNotMatch(p.content, /<@/)
  }
  const none = buildUnlockPayload(
    { ...base, kind: 'tier', subject: 'STUD', discordUserId: null },
    { siteUrl: 'https://boogeymen.app', hasImage: true },
  )
  assert.deepEqual(none.allowed_mentions, { parse: [] })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

`contract.ts`: add to `DiscordUnlock`: `/** Pinged on tier and mythic unlocks only; null otherwise. */ discordUserId: string | null`; in `parseDiscordUnlock` add

```ts
const rawId = o['discordUserId'] ?? null
if (rawId !== null && (typeof rawId !== 'string' || !/^[0-9]{17,20}$/.test(rawId))) {
  fail('discordUserId', 'is not a Discord user ID')
}
```

and `discordUserId: rawId as string | null` in the result.

`message.ts`: `allowed_mentions: { parse: never[]; users?: string[] }`; in `buildUnlockPayload`:

```ts
  const pings = (u.kind === 'tier' || u.kind === 'mythic') && u.discordUserId !== null
  const who = `**[${escapeMarkdown(u.name)}](<${opts.siteUrl}/roster/${String(u.playerId)}>)**${pings ? ` <@${u.discordUserId}>` : ''}`
  …
  const payload: MessagePayload = {
    allowed_mentions: pings ? { parse: [], users: [u.discordUserId!] } : { parse: [] },
    content,
  }
```

- [ ] **Step 3:** Run db + discord tests → PASS; typecheck. Commit `feat(discord): new-card unlocks ping their player`.

---

### Task 3: Loader sets the ID; admin section

**Files:**

- Modify: `apps/web/src/lib/discord/load-unlock.ts`
- Create: `apps/web/src/lib/discord-id-form.ts`, `discord-id-form.test.ts`
- Modify: `apps/web/src/app/admin/actions.ts` (+ `saveDiscordIdAction`), `apps/web/src/app/admin/page.tsx` (+ "Discord pings" section)

**Interfaces:** `parseDiscordIdForm(formData: FormData): { playerId: number; id: string | null } | { error: string }`.

- [ ] **Step 1: Failing parser test** — `discord-id-form.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscordIdForm } from './discord-id-form.ts'

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

void test('valid ID saved; spaces trimmed', () => {
  assert.deepEqual(
    parseDiscordIdForm(form({ playerId: '5', discordUserId: ' 447213088828030998 ' })),
    { playerId: 5, id: '447213088828030998' },
  )
})
void test('empty clears', () => {
  assert.deepEqual(parseDiscordIdForm(form({ playerId: '5', discordUserId: '' })), {
    playerId: 5,
    id: null,
  })
})
void test('rejects letters, short, long, bad player', () => {
  for (const v of ['abc', '1234', '123456789012345678901', '12345678901234567x']) {
    assert.ok('error' in parseDiscordIdForm(form({ playerId: '5', discordUserId: v })), v)
  }
  assert.ok('error' in parseDiscordIdForm(form({ playerId: '0', discordUserId: '' })))
})
```

Run → FAIL.

- [ ] **Step 2: Implement** — `discord-id-form.ts`:

```ts
/** The admin "Discord pings" form: a player and a 17–20 digit ID, or empty to clear. Pure. */
export function parseDiscordIdForm(
  formData: FormData,
): { playerId: number; id: string | null } | { error: string } {
  const playerId = Number(formData.get('playerId'))
  if (!Number.isInteger(playerId) || playerId <= 0) return { error: 'Unknown player.' }
  const raw = String(formData.get('discordUserId') ?? '').trim()
  if (raw === '') return { playerId, id: null }
  if (!/^[0-9]{17,20}$/.test(raw)) return { error: 'A Discord user ID is 17–20 digits.' }
  return { playerId, id: raw }
}
```

`actions.ts`: add

```ts
/** Save or clear a player's manual Discord user ID (unlock pings). */
export async function saveDiscordIdAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const parsed = parseDiscordIdForm(formData)
  if ('error' in parsed) redirect(`/admin?discord=invalid#discord-pings`)
  await setPlayerDiscordUserId(parsed.playerId, parsed.id)
  redirect('/admin?discord=saved#discord-pings')
}
```

`page.tsx`: load `listDiscordPingRows(defaultTitleId)` (resolve the default title the way the nav's roster menu does — reuse its helper; if unclear, `listAllGameTitles()` → `isDefault`); add a `<section id="discord-pings">` `AdminSection` titled "Discord pings" with the description "A new card (tier up, mythic) pings its player in Discord. The sign-in ID is used when the player has signed in; otherwise enter their Discord user ID (Developer Mode → right-click → Copy User ID)." One row per player: gamertag; if `signInId`, show it with "from sign-in"; else a small form (`hidden playerId`, text input `discordUserId` with `defaultValue={manualId ?? ''}`, `inputMode="numeric"`, `pattern="[0-9]{17,20}"`, Save button). Show a one-line notice for `?discord=saved|invalid`.

`load-unlock.ts`: after `describeUnlock`, `const discordUserId = d.kind === 'tier' || d.kind === 'mythic' ? await getPlayerDiscordUserId(ev.playerId) : null`, and add `discordUserId` to `data`.

- [ ] **Step 3:** `pnpm --filter @eanhl/db build && cd apps/web && node --test src/lib/discord-id-form.test.ts && cd ../.. && pnpm --filter web typecheck && pnpm --filter web test:unit` → PASS. Commit `feat(web): Discord pings admin section; unlock data carries the ping ID`.

---

### Task 4: Docs, review, deploy, IDs, live check

- [ ] Journal + handoff (in place). Commit.
- [ ] Final whole-branch review (fresh reviewer) + fix pass.
- [ ] Operator go-ahead → merge (ff) + push → HE: rollback tags, build web + discord, dump, apply 0070, restart **web first**, check `/admin` loads and `/internal/discord/unlock/<id>/data` carries `discordUserId`, then restart discord.
- [ ] Enter the operator's IDs on live (one `UPDATE players SET discord_user_id = … WHERE id = …` per player from the private list, in one transaction; never committed) or on `/admin`. Check with `select id, gamertag, discord_user_id from players where discord_user_id is not null`.
- [ ] Live ping check: the operator awards and clears a mythic for a player of their choice; the post pings that player.
