# News Desk Bots (release 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nine reporters become Discord bots; after each game a player can do a short post-game scrum; the answers become quotes in the night recap; the GM steers it with private notes and a heat level; posts with many reactions get a follow-up.

**Architecture:** Two containers from the existing `apps/discord` image. The existing `news` container keeps writing and now sends through the reporters' bot accounts over Discord REST (no gateway) when `PRESS_MODE=live`. A new `press` container (`--profile press`) holds the long-lived gateway connections (discord.js, one client per reporter) and runs everything interactive: buttons, the answer pop-up, slash commands, reactions and a timer loop for scrums. The two share only database tables and pure modules; a `press` crash can never stop `news`, `discord` or the worker.

**Tech Stack:** TypeScript (strict, Node `--experimental-strip-types` style `.ts` imports as in `apps/discord`), discord.js 14 (newest 14.x released at least two weeks before install), Drizzle + hand-written SQL migration, `node:test`, Anthropic SDK through the existing `ModelCall`.

**Spec:** `docs/superpowers/specs/2026-10-25-news-desk-bots-design.md` (approved 2026-10-26). Builds on the merged news desk (`apps/discord/src/news/`, `packages/db/src/news/`, migration 0071).

## Global Constraints

- Everything public goes to `#chel` (`PRESS_LIVE_CHANNEL_ID`); the trial runs in the bot test channel (`PRESS_TEST_CHANNEL_ID`). `#press-room` is no longer used.
- Fail closed: anything but `PRESS_MODE=live` is trial. In trial the bots act only in the test channel, every ping goes to the GM (`PRESS_GM_USER_ID`), text `test — would ping <player>`, and only the GM can accept, volunteer or use `/scrum`.
- Never read, store or send to the AI any Discord message text. Answers arrive only through the bots' own pop-up (modal) — no Message Content intent.
- Pings: only after a buzz level `big` | `huge` | `historic` game, or a GM note that asks for the player. Accept window 5 min; no reminder, no second ping.
- Never picked or pinged: press level `out`, guests, AI goalies, players without a Discord link (`getPlayerDiscordUserId` = null).
- "Go easy" (`easy`) = no criticism at all: no critical GM note is used, heat never Hot.
- Quotes: shortened or reworded, never added to; only from stored answers marked `usable` or `joke`; a joke is never stated as fact.
- The GM is never named or hinted as a source ("I'm told", "a source") of a note.
- Hockey only; never real life, looks, work or health.
- Money: scrum calls and reaction follow-ups stop when the month's spend reaches 80% of `NEWS_MONTHLY_LIMIT_USD` (20); posts and recaps keep the existing stop at limit − 0.50.
- Migrations: hand-written idempotent SQL `packages/db/migrations/0072_news_press.sql`, header with apply command and ROLLBACK, applied with psql; journal stays frozen.
- Containers run in UTC; any date shown to people is America/Edmonton.
- Secrets (nine bot tokens) only in the server `.env`; errors and logs name a status or a reporter, never a token.
- Green gates: `pnpm --filter @eanhl/discord typecheck`, `pnpm --filter @eanhl/discord test`, `pnpm --filter @eanhl/db build` then the db test files run explicitly, `pnpm --filter web typecheck`, `pnpm format`. `pnpm lint` is red repo-wide; do not chase it.
- Fixed values: `PRESS_ACCEPT_MS = 300_000`, `PRESS_ANSWER_MS = 900_000`, `PRESS_OPEN_MS = 3_600_000`, `PRESS_NIGHT_WAIT_MS = 1_800_000`, `PRESS_PING_LIMIT = 2` (automatic pings per player per night), `PRESS_COMMAND_LIMIT = 2` (`/scrum random` + `/scrum @player` per user per night), picked player 2 questions, volunteer 1 question, at most 1 follow-up per question, `REACTION_MIN_PEOPLE = 3`, `REACTION_NIGHT_LIMIT = 2`, `EXTRAS_BUDGET_SHARE = 0.8`, `ANSWER_MAX_CHARS = 500`, `QUESTION_MAX_CHARS = 280`.

## Review Focus

1. **A button pressed by the wrong person or too late** (someone else's Accept, an Accept after 5 min, "Talk to the press" after 60 min, an Answer button of a finished scrum) → a private (ephemeral) refusal, no state change, no AI call. Tests in Task 8.
2. **`press` restarts in the middle of a scrum** → all scrum state is in the database; the timer pass rebuilds from timestamps; no second ping, no repeated question. Test in Task 7 (pass run twice over the same rows sends once).
3. **An answer with `@everyone`, `<@id>`, markdown or 2,000 characters** → the echo is escaped, mentions are blocked (`allowed_mentions: { parse: [] }`), the modal limits input to 500 characters. Test in Task 8.
4. **The same game seen twice** (two passes, or `news` posts while `press` creates the scrum) → one scrum per recap item (unique `recap_item_id`), claims before sends. Test in Task 7.
5. **A night recap with a quote that names a "Leave me out" teammate or adds a number the player did not say** → the code check rejects it (offered answers only; numbers inside a quote must be in that answer). Test in Task 11.

---

## File map

- `packages/db/migrations/0072_news_press.sql` — new tables and columns (Task 1).
- `packages/db/src/schema/news-press.ts` — Drizzle tables; `schema/news.ts` gains 3 columns and job kind `reaction` (Task 1).
- `packages/db/src/queries/news-press.ts` + `queries/__tests__/news-press.test.ts` — all press queries (Task 1).
- `apps/discord/src/bot-rest.ts` — Discord REST as a bot (Task 2).
- `apps/discord/src/press/config.ts` — `PRESS_*` env and the nine tokens; `news/config.ts` reads the same helper (Task 3).
- `apps/discord/src/news/cycle.ts`, `news-main.ts`, `news/messages.ts`, `news/store.ts` — delivery through bots (Task 4), night wait + press material (Task 11), reaction pass (Task 12).
- `apps/discord/src/press/rules.ts` — pure scrum rules (Task 5).
- `apps/discord/src/press/asker.ts` — questions and follow-ups with checks (Task 6).
- `apps/discord/src/press/store.ts`, `press/pass.ts` — DB adapter and the timer pass (Task 7).
- `apps/discord/src/press/interactions.ts` — buttons, modal, `/scrum` (Task 8).
- `apps/discord/src/press/gm.ts` — `/gm note`, `/gm heat` (Task 9).
- `apps/discord/src/press-main.ts`, `press/gateway.ts`, `docker-compose.yml` — the process (Task 10).
- `apps/discord/src/news/prompts.ts`, `outputs.ts`, `fact-check.ts`, `writer.ts` — quotes and notes (Task 11).
- `apps/discord/src/press/reactions.ts` — votes and triggers (Task 12).
- `apps/web/src/app/admin/news/aliases-section.tsx`, `actions.ts`, `apps/web/src/content/legal/privacy.tsx`, `data-collection.tsx`, `.env.example`, `docs/operations/runbooks/news-desk-bots-setup.md` (Tasks 0 and 13).

---

### Task 0: Cost estimate and the Discord setup runbook

**Files:**

- Create: `docs/operations/runbooks/news-desk-bots-setup.md`

- [ ] **Step 1: Estimate the cost.** With the prices in `apps/discord/src/news/cost.ts` (`claude-opus-5-5`), estimate one scrum (picked player: 2 questions + 2 follow-ups; each = 1 write + 1 review at `effort: 'low'`, about 6k input / 300 output tokens per call with the fact sheet), one GM note parse (1 call), one reaction follow-up (as one game post job). Monthly: 8 game nights × 4 games, assume 1 scrum per night and 2 GM notes per night, 4 reaction follow-ups a month. Write the numbers in the runbook's "Cost" section. Stop and report to the operator if scrums + reactions + the existing ~$8–10 exceed $20.
- [ ] **Step 2: Write the runbook** for the operator, plain language (ASD-STE100 style, short steps): create 9 applications in the Discord developer portal named exactly as `REPORTERS[id].name`; upload each picture from `https://boogeymen.app/news/avatar/<id>`; Bot tab: create token, no privileged intents except **none** for 8 bots and **Server Members: off, Message Content: off** for all (reactions need only the non-privileged `GuildMessageReactions`); invite each with scopes `bot applications.commands` and permissions Send Messages, Send Messages in Threads, Create Public Threads, Read Message History, Add Reactions, Embed Links, View Channel; put tokens in the server `.env` as `PRESS_TOKEN_BARLOW` … `PRESS_TOKEN_BERGSTROM`; set `PRESS_GUILD_ID`, `PRESS_TEST_CHANNEL_ID`, `PRESS_LIVE_CHANNEL_ID`, `PRESS_GM_USER_ID` (how to copy IDs with Developer Mode). Final number of applications: **nine**; the slash commands live on Wade Barlow's application.
- [ ] **Step 3: Commit**

```bash
git add docs/operations/runbooks/news-desk-bots-setup.md
git commit -m "docs(runbooks): news desk bots setup and cost estimate"
```

---

### Task 1: Migration 0072, schema and queries

**Files:**

- Create: `packages/db/migrations/0072_news_press.sql`, `packages/db/src/schema/news-press.ts`, `packages/db/src/queries/news-press.ts`, `packages/db/src/queries/__tests__/news-press.test.ts`
- Modify: `packages/db/src/schema/news.ts` (job kinds, 3 item columns), `packages/db/src/schema/index.ts`, `packages/db/src/queries/index.ts`, `packages/db/src/queries/news.ts` (`markNewsItemPosted`, `listDiscordDeletions`, `nightCriticized`)

**Interfaces:**

- Produces (schema): `NEWS_JOB_KINDS` += `'reaction'` (job_key = original item id). `news_items` += `is_game_recap boolean not null default false`, `discord_via text not null default 'webhook'` (CHECK `webhook|bot`), `discord_channel_id text`.
- Produces (tables, all `is_test boolean not null default false` where marked \*):
  - `news_scrums`(id, match_id → matches set null, night date not null, recap_item_id → news_items cascade **unique**, channel_id, message_id, thread_id null, reporter (reporter CHECK), heat CHECK `cool|normal|hot`, buzz_level text, open_until timestamptz, is_test\*, created_at)
  - `news_scrum_people`(id, scrum_id → cascade, player_id → players, discord_user_id text, role CHECK `picked|volunteer`, requested_by CHECK `auto|gm|command|self`, requested_by_user_id text null, status CHECK `pinged|asking|done|expired`, ping_message_id, pinged_at, questions_asked int 0, followups_asked int 0, current_question text, last_asked_at, created_at; **unique (scrum_id, player_id)**)
  - `news_scrum_answers`(id, person_id → cascade, scrum_id → cascade, player_id, night, question, answer, usability CHECK `usable|joke|unusable`, is_test\*, created_at)
  - `news_gm_notes`(id, match_id null, night, player_id null, nickname null, note, asks_player, critical, theme, status CHECK `active|refused|cancelled`, refusal null, is_test\*, created_at)
  - `news_player_aliases`(alias text PK lowercase, player_id → cascade, created_at)
  - `news_press_settings`(id = 1 CHECK, heat CHECK default `normal`, heat_scope CHECK `next|night` default `night`, heat_night date null, mirror_from_item_id bigint null, updated_at)
  - `news_press_mirrors`(item_id PK → news_items cascade, channel_id, message_id, deleted_at null)
  - `news_reaction_votes`(item_id → cascade, user_id, created_at, PK (item_id, user_id))
  - `news_reaction_triggers`(item_id PK → cascade, night, is_test\*, created_at)
- Produces (queries, each async with a `…Sql`/`…Query` builder pinned by a test): `insertScrum`, `scrumByRecapItem(itemId)`, `listRecapItemsWithoutScrum({ since, mode, limit })` (live: `is_game_recap`, `discord_via = 'bot'`, posted; trial: `is_game_recap` with a mirror row, test items included), `insertScrumPerson` (returns null on the unique conflict), `claimPing(personId): boolean` (sets `pinged_at` only when null), `listExpiredPings(now)`, `listExpiredQuestions(now)`, `updateScrumPerson`, `insertScrumAnswer`, `countAutoPingsTonight(playerId, night)`, `countCommandUsesTonight(userId, night)`, `nightHasActiveScrum(night, includeTest): boolean` (any person `pinged` within 5 min or `asking`), `nightPressMaterial(night, includeTest)` → `{ quotes: PressQuote[]; gmNotes: PressNote[] }`, `insertGmNote`, `listPressRoster()` → `{ playerId, name, gamertag, pressLevel, aliases }[]` (members, no AI goalies; `name` = `coalesce(player_profiles.player_name, players.gamertag)`), `upsertAlias`, `deleteAlias`, `listAliases`, `getPressSettings`, `setHeat`, `consumeNextHeat`, `setMirrorFrom`, `listItemsToMirror`, `insertMirror`, `listMirrorDeletions`, `markMirrorDeleted`, `insertReactionVote` (on conflict do nothing), `countReactionPeople(itemId)`, `insertReactionTrigger` (null on conflict), `countReactionTriggersTonight(night)`, `listReactionTriggersWithoutJob(includeTest, limit)`.
- Changes: `markNewsItemPosted(id, messageId, via, channelId)`; `listDiscordDeletions` returns `{ id, messageId, via, channelId, reporter }`; `nightCriticized` also returns the display names of players with an `active`, `critical` GM note that night (same `is_test` rule).

```ts
export interface PressQuote {
  answerId: number
  playerId: number
  name: string
  question: string
  answer: string
  usability: 'usable' | 'joke'
}
export interface PressNote {
  id: number
  playerName: string | null
  note: string
  matchId: number | null
}
```

- [ ] **Step 1: Write the failing tests** in `news-press.test.ts` (same style as `__tests__/news.test.ts`, no database): `getTableConfig(newsScrums)` has a unique on `recap_item_id`; `newsScrumPeople` unique `(scrum_id, player_id)`; `claimPingQuery(7)` SQL contains `pinged_at is null`; `nightHasActiveScrumSql('2026-10-25', false)` contains `'asking'` and `is_test = false`; `nightPressMaterialSql` excludes `usability = 'unusable'` and players whose `press_level = 'out'`; `nightCriticizedSql` contains `news_gm_notes` and `critical`; `NEWS_JOB_KINDS` includes `'reaction'`.
- [ ] **Step 2: Run** `pnpm --filter @eanhl/db build && node --test packages/db/dist/queries/__tests__/news-press.test.js packages/db/dist/queries/__tests__/news.test.js` — Expected: FAIL (missing exports).
- [ ] **Step 3: Write the migration** in the 0071 header form (purpose, spec, plan, HOW TO APPLY with `lock_timeout`, idempotent `create table if not exists` / `add column if not exists`, drop-and-add the `news_jobs_kind_check` and the new checks by name, ROLLBACK block that drops the new tables and columns and restores the old kind check). No back-fill.
- [ ] **Step 4: Implement the schema and queries** listed above.
- [ ] **Step 5: Run** the command from Step 2, then `pnpm --filter @eanhl/discord typecheck` (callers of `markNewsItemPosted`/`listDiscordDeletions` fail until Task 4 — fix the call sites minimally now: pass `'webhook', null`). Expected: PASS.
- [ ] **Step 6: Apply to the verification database only if it is available on the machine** (`~/.config/eanhl/verify.env`); never to live in this task.
- [ ] **Step 7: Commit** `feat(db): news press tables, item delivery columns, reaction jobs (0072)`.

---

### Task 2: Discord REST as a bot

**Files:**

- Create: `apps/discord/src/bot-rest.ts`, `apps/discord/src/bot-rest.test.ts`

**Interfaces:**

- Produces:

```ts
export interface BotMessage {
  content: string
  allowed_mentions: { parse: never[]; users?: string[] }
  components?: unknown[]
  message_reference?: { message_id: string; fail_if_not_exists: false }
}
export function sendBotMessage(
  token: string,
  channelId: string,
  msg: BotMessage,
  fetchImpl?: typeof fetch,
): Promise<string>
export function editBotMessage(
  token: string,
  channelId: string,
  messageId: string,
  msg: Partial<BotMessage>,
  fetchImpl?: typeof fetch,
): Promise<void>
export function deleteBotMessage(
  token: string,
  channelId: string,
  messageId: string,
  fetchImpl?: typeof fetch,
): Promise<void>
export function startThread(
  token: string,
  channelId: string,
  messageId: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<string>
export function sendDirectMessage(
  token: string,
  userId: string,
  content: string,
  fetchImpl?: typeof fetch,
): Promise<void>
export function talkButton(itemId: number): unknown // custom_id `press:talk:<itemId>`, label "Talk to the press"
export function acceptButton(personId: number): unknown // `press:accept:<personId>`, label "Accept"
export function answerButton(personId: number): unknown // `press:answer:<personId>`, label "Answer"
```

Base URL `https://discord.com/api/v10`, header `Authorization: Bot <token>`, 15 s timeout. Same error contract as `webhook.ts`: HTTP error → `Error('Discord bot HTTP <status>')` (so the existing `/HTTP 429\b/` rate-limit test works); refused connection before sending → plain `Error`; any other network failure on a send → `WebhookOutcomeUnknownError` (reuse the class). Delete: 204/404 = done. Thread name ≤ 100 characters.

- [ ] **Step 1: Write the failing tests** with a fake `fetch`: `sendBotMessage` POSTs `/channels/123/messages` with `Authorization: Bot t` and returns the `id`; HTTP 429 → message matches `/HTTP 429\b/`; a token never appears in any thrown message (`assert.doesNotMatch(err.message, /secret-token/)`); timeout → `WebhookOutcomeUnknownError`; delete 404 resolves; `startThread` POSTs `/channels/123/messages/456/threads`; `talkButton(9)` has `custom_id: 'press:talk:9'`.
- [ ] **Step 2: Run** `pnpm --filter @eanhl/discord test` — Expected: FAIL.
- [ ] **Step 3: Implement** `bot-rest.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(discord): bot REST client for the reporter bots`.

---

### Task 3: Press configuration

**Files:**

- Create: `apps/discord/src/press/config.ts`, `apps/discord/src/press/config.test.ts`
- Modify: `apps/discord/src/news/config.ts` + test, `.env.example`, `docker-compose.yml` (`news` gets the `PRESS_*` vars)

**Interfaces:**

- Produces:

```ts
export type PressMode = 'trial' | 'live'
export interface PressDiscord {
  mode: PressMode
  tokens: Record<ReporterId, string>
  guildId: string
  channelId: string /* test channel in trial, #chel in live */
  gmUserId: string
}
export function loadPressDiscord(
  env: Record<string, string | undefined>,
): { ok: true; value: PressDiscord } | { ok: false; problems: string[] }
export interface PressConfig extends PressDiscord {
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  model: string
  monthlyLimitUsd: number
  pollIntervalMs: number /* default 15000 */
}
export function loadPressConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: PressConfig } | { ok: false; problems: string[] }
```

- `PRESS_MODE`: `live` only when exactly `live`; else `trial`. Token vars `PRESS_TOKEN_<REPORTER ID UPPERCASE>`; IDs must match `DISCORD_USER_ID_RE`. Problems name the variable, never a value.
- `NewsConfig` gains `bots: PressDiscord | null`: when `PRESS_MODE=live`, `loadPressDiscord` must be ok (its problems are news problems) and `NEWS_WEBHOOK_URL` is no longer required; otherwise `bots` is null and the old webhook rules stay.

- [ ] **Step 1: Write the failing tests:** no `PRESS_MODE` → `trial`, `channelId` = `PRESS_TEST_CHANNEL_ID`; `PRESS_MODE=LIVE` → trial (exact match only); live → `channelId` = `PRESS_LIVE_CHANNEL_ID`; a missing `PRESS_TOKEN_RINK` gives problem `PRESS_TOKEN_RINK is unset` and the problem list never contains the other tokens' values; news config with `PRESS_MODE=live`, no webhook, all press vars → ok with `bots.mode === 'live'`.
- [ ] **Step 2: Run** `pnpm --filter @eanhl/discord test` — FAIL.
- [ ] **Step 3: Implement**; add the vars to `.env.example` (empty, with a comment that anything but `live` is trial) and to the `news` service environment.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(discord): press configuration (trial is the default)`.

---

### Task 4: News delivery through the bots

**Files:**

- Modify: `apps/discord/src/news/cycle.ts` (+ `cycle.test.ts`), `apps/discord/src/news/messages.ts` (+ test), `apps/discord/src/news/store.ts`, `apps/discord/src/news-main.ts`

**Interfaces:**

- Consumes: Task 2 `sendBotMessage`, `deleteBotMessage`, `talkButton`; Task 3 `NewsConfig.bots`; Task 1 columns.
- Produces (replaces `NewsDeps.send`/`remove`):

```ts
export interface NewsOutgoing { itemId: number; reporter: ReporterId; payload: NewsWebhookPayload; isGameRecap: boolean }
export interface NewsSent { messageId: string | null; via: 'webhook' | 'bot'; channelId: string | null }
send(msg: NewsOutgoing): Promise<NewsSent>
remove(d: { messageId: string; via: 'webhook' | 'bot'; channelId: string | null; reporter: ReporterId }): Promise<void>
```

- `messages.ts`: `toBotMessage(payload: NewsWebhookPayload, talkItemId: number | null): BotMessage` — same `content` and `allowed_mentions`, plus `components: [{ type: 1, components: [talkButton(id)] }]` when `talkItemId` is set.
- `writeGame` inserts the first post (`i === 0`) with `isGameRecap: true`. `deliver` passes `isGameRecap` from the stored row.
- `news-main.ts`: `bots === null` → webhook adapter returns `{ messageId, via: 'webhook', channelId: null }`; else bot adapter sends with `tokens[reporter]` to `bots.channelId`, talk button only when `isGameRecap`. `remove`: `via === 'bot'` → `deleteBotMessage(tokens[reporter], channelId, id)`; `via === 'webhook'` with no webhook URL → log once per item and mark it deleted (old `#press-room` message stays).

- [ ] **Step 1: Write the failing tests** in `cycle.test.ts` with the existing fakes: the recap post of a game is sent with `isGameRecap: true` and the reply post with `false`; `markNewsItemPosted` receives `via` and `channelId` from `send`; a deletion with `via: 'bot'` calls `remove` with the reporter. In `messages.test.ts`: `toBotMessage(p, 5)` has a button with `custom_id: 'press:talk:5'`; `toBotMessage(p, null)` has no `components`.
- [ ] **Step 2: Run** `pnpm --filter @eanhl/discord test` — FAIL.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** tests and `pnpm --filter @eanhl/discord typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(news): send through the reporter bots when PRESS_MODE=live`.

---

### Task 5: Scrum rules (pure)

**Files:**

- Create: `apps/discord/src/press/rules.ts`, `apps/discord/src/press/rules.test.ts`

**Interfaces:**

- Produces:

```ts
export const PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_OPEN_MS,
  PRESS_NIGHT_WAIT_MS,
  PRESS_PING_LIMIT,
  PRESS_COMMAND_LIMIT,
  EXTRAS_BUDGET_SHARE // Global Constraints values
export type Heat = 'cool' | 'normal' | 'hot'
export interface Candidate {
  playerId: number
  name: string
  pressLevel: 'full' | 'easy'
  discordUserId: string | null
  star: 1 | 2 | 3 | null
  points: number
}
export function scrumCandidates(
  game: NewsGameFacts,
  facts: NewsFacts,
  discordIds: ReadonlyMap<number, string>,
): Candidate[]
export function pickScrumPlayer(
  candidates: Candidate[],
  topFacts: NewsTopFact[],
  gmAsked: number | null,
): Candidate | null
export function shouldPing(level: BuzzLevel, gmAsked: boolean): boolean
export function effectiveHeat(
  heat: Heat,
  pressLevel: 'full' | 'easy',
): { heat: Heat; lowered: boolean }
export function chooseScrumReporter(args: {
  heat: Heat
  seed: number
  disabled: readonly ReporterId[]
  lastScrumReporter: ReporterId | null
  takeReporters: readonly ReporterId[]
}): ReporterId
export function questionLimit(role: 'picked' | 'volunteer'): number // 2 | 1
export function followUpAllowed(p: {
  questionsAsked: number
  followupsAsked: number
  role: 'picked' | 'volunteer'
}): boolean
export function extrasBudgetLeft(spent: number, limitUsd: number): boolean // spent < limit * 0.8
```

- `scrumCandidates`: the game's `players` whose `playerId` is in `facts.people` (so `out` and guests are gone), with a Discord ID, never an AI goalie.
- `pickScrumPlayer` order: `gmAsked` candidate if present; else the first `topFacts` entry (already sorted by weight) whose `subject` equals a candidate's `name`; else the lowest `star`; else most `points`; ties by lower `playerId`.
- `shouldPing`: `gmAsked || level ∈ {big, huge, historic}`.
- `effectiveHeat`: `easy` + `hot` → `normal`, `lowered: true`.
- `chooseScrumReporter`: never `rink`, never disabled, never `lastScrumReporter` unless it is the only one left. Weights: base 1; Cool → voss, barlow, bergstrom × 3; Hot → mercer, pettibone, vale × 3; each reporter in `takeReporters` × 2. Seeded draw: reuse the seeded random helper `assign.ts` already uses for buzz/post counts.

- [ ] **Step 1: Write the failing tests:** the topFact subject wins over star 1; `gmAsked` wins over everything; an `easy` player is a candidate but `effectiveHeat('hot','easy')` is `{ heat: 'normal', lowered: true }`; a player with no Discord ID is not a candidate; `shouldPing('normal', false) === false`, `shouldPing('big', false) === true`; `chooseScrumReporter` over 200 seeds never returns `rink` or a disabled reporter, and with heat `hot` returns one of mercer/pettibone/vale more than half the time; `followUpAllowed` is false after 1 follow-up for a volunteer and after 2 for a picked player; `extrasBudgetLeft(16, 20) === false`, `extrasBudgetLeft(15.99, 20) === true`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(press): scrum pick, ping, heat and reporter rules`.

---

### Task 6: The asker — questions and follow-ups

**Files:**

- Create: `apps/discord/src/press/asker.ts`, `apps/discord/src/press/asker.test.ts`
- Modify: `apps/discord/src/news/writer.ts` (`writeChecked` gains `maxWrites?: number` and `trusted?: TrustedMaterial`, passed to `buildReviewPrompt`), `apps/discord/src/news/prompts.ts` (defines and exports `TrustedMaterial`, so `news/` never imports from `press/`; `buildReviewPrompt` prints `trusted`)

**Interfaces:**

- Consumes: `writeChecked`, `ModelCall`, `allowedNumbers`, `numberTokens`, `REPORTERS`, Task 5 `Heat`.
- Produces:

```ts
export interface TrustedMaterial {
  gmNotes: readonly string[]
  answers: readonly {
    player: string
    question: string
    answer: string
    usability: 'usable' | 'joke'
  }[]
}
export interface AskContext {
  facts: NewsFacts
  forbiddenNames: string[]
  reporter: ReporterId
  heat: Heat
  player: { name: string; pressLevel: 'full' | 'easy' }
  gmNotes: string[]
  takes: NewsTake[]
  history: { question: string; answer: string | null }[]
  questionNumber: number
}
export function askQuestion(call: ModelCall, ctx: AskContext, record: Recorder): Promise<string>
export function judgeAnswer(
  call: ModelCall,
  ctx: AskContext & { answer: string; followUpAllowed: boolean },
  record: Recorder,
): Promise<{ usability: 'usable' | 'joke' | 'unusable'; followUp: string | null; closing: string }>
export const FALLBACK_QUESTION: (name: string) => string // "Walk me through that one, <name>."
export const FALLBACK_CLOSING = 'Fair enough — next game.'
type Recorder = (purpose: 'write' | 'review', model: string, usage: Usage) => Promise<void>
```

- Both use `writeChecked` with `maxWrites: 2`, `effort` as the writer sets it, review included. Code check: ≤ 280 characters, numbers ⊆ `allowedNumbers(facts)` ∪ numbers in `gmNotes` ∪ (for `judgeAnswer`) numbers in the answer, no `forbiddenNames`, no other teammate named. On `{ ok: false }` or a thrown error: `askQuestion` returns `FALLBACK_QUESTION(name)`, `judgeAnswer` returns `{ usability: 'usable', followUp: null, closing: FALLBACK_CLOSING }`; never throw to the caller (a stop/retryable error is logged by the caller through `record`).
- Prompt rules (new constants in `asker.ts`): the reporter's voice; one question; about this game's sheet or a GM note; Hot = name the bad moment directly and be pointed, Cool = start from what went well; `easy` player = no criticism at any heat; never say where a note came from; hockey only; a joke answer → react in character (Mercer/Pettibone annoyed, Vale plays along, others dry), classify `joke`; real life/abuse/another teammate's private matters/empty → `unusable`, move on without repeating it; `followUp` empty when `followUpAllowed` is false.
- `buildReviewPrompt` with `trusted`: lists the notes as "true events the desk saw" and the answers; adds problem 14 "the text says or hints that a note came from a tip, a source or the GM", and changes problem 1 to "a teammate quote not backed by the listed answers, or one that adds to or changes an answer's meaning; a joke answer stated as fact".

- [ ] **Step 1: Write the failing tests** with a fake `ModelCall`: a first write with a number not on the sheet is rewritten; two bad writes → `FALLBACK_QUESTION('Raz')`; a GM note "goal of the year" lets the question mention it and the review prompt contains "true events"; `judgeAnswer` with `followUpAllowed: false` and a model `followUp` returns `followUp: null`; `buildReviewPrompt({ …, trusted })` contains problem 14; a `NewsStopError` from the call → fallback, no throw.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** all discord tests (existing `writeChecked` callers unchanged) — PASS.
- [ ] **Step 5: Commit** `feat(press): reporter questions and follow-ups through the checked writer`.

---

### Task 7: Press store and the timer pass

**Files:**

- Create: `apps/discord/src/press/store.ts`, `apps/discord/src/press/pass.ts`, `apps/discord/src/press/pass.test.ts`

**Interfaces:**

- Consumes: Task 1 queries, Task 2 REST, Task 5 rules, Task 6 asker, `fetchNewsFacts`, `planBuzz`, `getPlayerDiscordUserId`.
- Produces:

```ts
export interface PressStore { /* the Task 1 queries the press uses, plus monthNewsSpendUsd, listDisabledReporters, recordNewsUsage, getNewsItem(id), getPlayerDiscordUserId */ }
export interface PressDiscordOps { send(reporter: ReporterId, channelId: string, msg: BotMessage): Promise<string>; edit(...): Promise<void>; remove(reporter: ReporterId, channelId: string, messageId: string): Promise<void>; thread(reporter: ReporterId, channelId: string, messageId: string, name: string): Promise<string>; dm(userId: string, content: string): Promise<void> }
export interface PressDeps { store: PressStore; discord: PressDiscordOps; fetchFacts: (kind: 'game' | 'night', key: string) => Promise<NewsFactsResponse>; call: ModelCall; log: (m: string) => void; now: () => Date }
export function runPressPass(deps: PressDeps, config: PressConfig): Promise<PressPassSummary>
// Loads the game sheet, the person's line and press level, the match's active GM notes, the player's takes and
// the scrum's earlier Q&A; creates the thread on the scrum message when thread_id is null (name `<Reporter> — <player>`);
// posts the question with answerButton; sets asking, current_question, last_asked_at, questions_asked + 1.
export function startScrumQuestion(deps: PressDeps, config: PressConfig, personId: number): Promise<void>  // used by Task 8 too
```

`runPressPass`, in this order, each step isolated with its own try/catch:

1. **Mirror (trial only):** on the first pass, if `mirror_from_item_id` is null, set it to the newest item id (history is never mirrored). Then for each item with a larger id and no mirror row, not deleted: send it as its reporter to the test channel (`toBotMessage`, talk button when `is_game_recap`), insert the mirror row.
2. **Mirror deletions:** a mirrored item that is now deleted → delete the mirror message, mark it.
3. **New scrums:** `listRecapItemsWithoutScrum({ since: now − 6 h, mode, limit: 5 })`. Fetch the game sheet, `planBuzz`, pick (GM ask from an active note on that match with `asks_player`), heat from settings (`consumeNextHeat` when scope `next`), `effectiveHeat`, reporter. `insertScrum` with `open_until = item time + PRESS_OPEN_MS`; on the unique conflict skip. If `shouldPing`: insert the picked person (`requested_by` `gm` or `auto`); skip an `auto` ping when `countAutoPingsTonight ≥ 2`.
4. **Pings:** for each person `pinged` with `pinged_at` null: `claimPing` first, then send the reply under the scrum message: live `<@id> — <Reporter> has a question for you about tonight's game.` with `allowed_mentions.users = [id]`; trial the same to the GM, prefixed `test — would ping <name>: `. Accept button. Heat lowered → DM the GM `Heat for <name>'s scrum lowered to Normal (Go easy).`
5. **Expired accepts:** `pinged` and `pinged_at + PRESS_ACCEPT_MS < now` → `expired` (edit the ping message to remove the button; ignore edit errors).
6. **Expired answers:** `asking` and `last_asked_at + PRESS_ANSWER_MS < now` → post `FALLBACK_CLOSING` in the thread → `done`.

- No AI call when `extrasBudgetLeft` is false: new scrums are still created (the button works) but questions use the fallbacks — log once per month.

- [ ] **Step 1: Write the failing tests** with an in-memory fake store and fake Discord: a big game creates one scrum and one ping; running the pass twice sends one ping (claim); a normal game creates a scrum without a ping; trial pings go to the GM with `test — would ping`; the third automatic ping of a night for the same player is not sent; an accept older than 5 min becomes `expired`; an unanswered question older than 15 min posts `Fair enough — next game.`; on the first trial pass nothing older than the newest item is mirrored; a failing mirror send does not stop step 3.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(press): scrum timer pass (mirror, scrums, pings, timeouts)`.

---

### Task 8: Interactions — buttons, answer pop-up, `/scrum`

**Files:**

- Create: `apps/discord/src/press/interactions.ts`, `apps/discord/src/press/interactions.test.ts`

**Interfaces:**

- Consumes: Task 7 `PressDeps`, `startScrumQuestion`; Task 6 `judgeAnswer`; Task 5 rules.
- Produces (pure handlers; the gateway adapter in Task 10 turns the result into discord.js calls):

```ts
export type Reply =
  | { kind: 'ephemeral'; text: string }
  | { kind: 'modal'; customId: string; title: string; label: string; maxLength: 500 }
  | { kind: 'ack' }
export function onTalk(
  deps: PressDeps,
  config: PressConfig,
  itemId: number,
  userId: string,
): Promise<Reply>
export function onAccept(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply>
export function onAnswerButton(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply>
export function onAnswerSubmit(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
  text: string,
): Promise<Reply>
export function onScrumCommand(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  opts: { player: string | null; random: boolean },
): Promise<Reply>
```

Rules and exact refusal texts (all ephemeral):

- Trial and user ≠ GM: `The press bots are on trial.`
- Unlinked user: `Link your Discord on boogeymen.app (sign in) to talk to the press.`
- `onTalk` after `open_until`: `The press has left. Catch them after the next game.`; user's player not in the game: `This scrum is for players of this game.`; already in it: `You're already in this scrum.`; in trial the GM acts as the scrum's pick. Success → insert volunteer (`requested_by: 'self'`, status `asking`) → `startScrumQuestion` → `ack`.
- `onAccept` by another user: `This one is for <name>.`; after the window: `Too late — the reporter moved on.`
- `onAnswerButton`: only the person's own user (trial: the GM), only while `asking` → the modal `press:modal:<personId>`, title `<Reporter> asks` (≤ 45 characters), label = the current question cut to 45 characters, max 500.
- `onAnswerSubmit`: trim; empty → ephemeral `No answer saved.`; post the echo in the thread as the reporter: `**<name>:** <escapeMarkdown(text)>`, `allowed_mentions: { parse: [] }`; store the answer with the `judgeAnswer` usability; then follow-up (if returned and allowed) / next question (if `questions_asked < questionLimit`) / `closing` → `done`.
- `/scrum` (no options) = `onTalk` for the latest recap item of a game the user's player played within 6 h; `random` or `player`: count `countCommandUsesTonight(userId) < 2` else `You've used that twice tonight.`; target must be a candidate of that game (Task 5) else `<name> can't be asked about this game.`; insert picked person `requested_by: 'command'`; the pass pings them.

- [ ] **Step 1: Write the failing tests** for every refusal text above, plus: an answer `@everyone <@123> **x**` is echoed escaped with `parse: []`; a 600-character submission is cut to 500 before storing; a volunteer after one question and one follow-up gets the closing; a picked player gets question 2 after question 1; an `unusable` answer is stored as `unusable`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(press): scrum buttons, answer pop-up and /scrum`.

---

### Task 9: GM controls — `/gm note` and `/gm heat`

**Files:**

- Create: `apps/discord/src/press/gm.ts`, `apps/discord/src/press/gm.test.ts`

**Interfaces:**

- Produces:

```ts
export const GM_NOTE_SCHEMA: object // { nickname: string, playerName: string, gameNumber: integer ≥ 0 (0 = latest), asksPlayer, critical, theme: boolean }
export function onGmNote(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  text: string,
  gameNumber: number | null,
): Promise<GmNoteResult>
export function onGmNoteCorrect(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  noteId: number,
  playerId: number,
): Promise<Reply>
export function onGmNoteCancel(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  noteId: number,
): Promise<Reply>
export function onGmHeat(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  heat: Heat,
  scope: 'next' | 'night',
): Promise<Reply>
export type GmNoteResult = Reply & {
  noteId?: number
  choices?: { playerId: number; name: string }[]
}
```

- Any user ≠ `gmUserId` → `Only the GM can do that.` (the command is also registered with `default_member_permissions: '0'`, Task 10).
- Night = night of the newest counted match within 6 h (night facts via `fetchFacts('night', …)`); none → `No game tonight to attach a note to.`
- One AI call (`effort: 'low'`, recorded) with the note, the roster from `listPressRoster` (names, gamertags, aliases) and tonight's games as "game 1 vs X …". Resolve: alias exact (lowercase) → gamertag/profile name → model's `playerName`. Unknown player → note stored with `player_id` null.
- Fairness: `out` → status `refused`, reply `<name> is on Leave me out — note not used.`; `easy` and `critical` → `refused`, `<name> is on Go easy — a critical note is not used.`
- Success reply: `Got it: <name> — game <n> vs <opponent>. Ask: yes|no.` with a player select (tonight's candidates, `press:gmfix:<noteId>`) and a Cancel button (`press:gmcancel:<noteId>`). A correction updates the note and `upsertAlias(nickname, playerId)` when `nickname` is non-empty. A second GM ask for the same player tonight adds `(2nd ping tonight)` to the reply.
- `asksPlayer` with an existing scrum for that game → insert a picked person `requested_by: 'gm'` (the pass pings). No scrum yet → the pass reads the note when it creates the scrum (Task 7 step 3).
- `/gm heat` → `setHeat(heat, scope, night)`; reply `Heat: <Heat> for the next scrum|tonight.`

- [ ] **Step 1: Write the failing tests:** a non-GM is refused; alias `beav` resolves without the model's `playerName`; an `out` player → `refused` and the exact text; `easy` + critical → refused, `easy` + positive → active; a correction saves the alias in lowercase; `asksPlayer` with an existing scrum inserts a `gm` person; `/gm heat hot night` stores scope `night`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(press): GM notes, nickname list and heat`.

---

### Task 10: The `press` process and container

**Files:**

- Create: `apps/discord/src/press-main.ts`, `apps/discord/src/press/gateway.ts`
- Modify: `apps/discord/package.json` (`discord.js` exact version), `docker-compose.yml` (`press` service), `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Tasks 3, 7, 8, 9, 12 handlers.
- `gateway.ts`: `startClients(config): Promise<Map<ReporterId, Client>>` — one `Client` per reporter, intents `Guilds` (all) + `GuildMessageReactions` (barlow only), partials `Message`, `Reaction`, `User` on barlow. `registerCommands(barlow, guildId)`: guild commands `/scrum` (options `player`: user, `random`: boolean) and `/gm` with subcommands `note` (`text` required, `game` integer ≥ 1) and `heat` (`level` choice cool/normal/hot, `scope` choice next/night), `/gm` with `default_member_permissions: '0'`. Route `interactionCreate` on every client by `custom_id` prefix `press:talk|accept|answer|modal|gmfix|gmcancel` and command name to the Task 8/9 handlers; map `Reply` to `reply({ ephemeral })`, `showModal`, or `deferUpdate`. Long work (AI) after `deferReply({ ephemeral: true })` so Discord's 3-second limit is met.
- `press-main.ts`: same shape as `news-main.ts` — bad config → log once and idle; imports after the config check; `runPressPass` in a non-overlapping loop every `pollIntervalMs` (15 s); a client error or disconnect is logged, discord.js reconnects; an unhandled rejection is logged, never exits the loop.
- Compose: service `press`, `profiles: ['press']`, same build as `news`, `command: ['node', 'dist/press-main.js']`, `restart: unless-stopped`, `mem_limit: 512m`, `init: true`, env `DATABASE_URL`, `DISCORD_INTERNAL_TOKEN`, `WEB_INTERNAL_URL`, `DISCORD_SITE_URL`, `NEWS_MODEL`, `NEWS_MONTHLY_LIMIT_USD`, `ANTHROPIC_API_KEY`, all `PRESS_*`.

- [ ] **Step 1: Add discord.js** to `apps/discord` (exact version, newest 14.x at least two weeks old); `pnpm install`.
- [ ] **Step 2: Write `gateway.test.ts`** for the pure router: `routeCustomId('press:accept:12')` → `{ kind: 'accept', id: 12 }`; an unknown prefix → `null`; `commandDefinitions()` has `/gm` with `default_member_permissions: '0'`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** `gateway.ts`, `press-main.ts`, compose service.
- [ ] **Step 5: Run** tests, typecheck, `pnpm --filter @eanhl/discord build`, and `docker compose config --profiles press` (renders without error). Expected: PASS.
- [ ] **Step 6: Commit** `feat(press): press container with the nine reporter bots`.

---

### Task 11: Quotes and GM notes in the night recap

**Files:**

- Modify: `apps/discord/src/news/cycle.ts` (+ test), `news/store.ts`, `news/prompts.ts` (+ test), `news/outputs.ts` (+ test), `news/fact-check.ts` (+ test)

**Interfaces:**

- Consumes: Task 1 `nightPressMaterial`, `nightHasActiveScrum`, `nightCriticized` (now with GM notes); `TrustedMaterial` (Task 6, in `news/prompts.ts`).
- Produces:
  - `NewsStore` += `nightHasActiveScrum(night, includeTest)`, `nightPressMaterial(night, includeTest)`.
  - `NewsCycleState` += `nightWaitSince: Map<string, number>`.
  - `DeskContext` += `press?: { quotes: PressQuote[]; gmNotes: PressNote[] }`; `buildArticleUserPrompt` prints a `PRESS ROOM` block: the notes as true events ("describe them as seen; never say where they came from") and the answers with ids ("quote only these; shorten or reword, never add; a joke stays a joke; list each quote in "quotes" with its answerId").
  - `ARTICLE_SCHEMA` += required `quotes: { answerId: integer, text: string }[]`; `Article.quotes?: …` (parse defaults to `[]`, so the backfill and old rows are unchanged).
  - `checkArticleFacts(article, facts, forbidden, criticized, opts & { press?: { quotes: PressQuote[]; gmNotes: string[] } })`: every `quotes[].answerId` is offered; each `quotes[].text` appears in the paragraphs; quotes must be `[]` when nothing is offered; numbers in a quote must appear in that answer; numbers in the rest of the text may also come from `gmNotes`; quote spans are removed before the name check, and the quoted player's name must be on the sheet.
  - Rule 6 of the system prompt: "No invented quotes. Teammate quotes only from the PRESS ROOM answers, as described there."
- `nightPass`: if `nightHasActiveScrum` → remember the first wait time; skip the night until the scrum ends or `PRESS_NIGHT_WAIT_MS` (30 min) has passed. Then load the press material, filter quotes to players on the sheet's `people`, pass it in `ctx.press`, to the check, and as `trusted` to `writeChecked`.

- [ ] **Step 1: Write the failing tests:** a night with an active scrum is not written on this pass and is written 30 min later even if still active; the night prompt contains `PRESS ROOM` and the answer id; an article quoting an answer id not offered fails; a quote with "3 goals" when the answer says "two goals" fails; a quote of a player not in `people` is not offered at all; `parseArticle` without `quotes` returns `quotes: []`; the review prompt of a night with a GM note contains "true events".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** all discord tests (backfill tests stay green) — PASS.
- [ ] **Step 5: Bump `NEWS_RULES_VERSION`** (rules changed) in `rules-version.ts` and its test.
- [ ] **Step 6: Commit** `feat(news): scrum quotes and GM notes in the night recap`.

---

### Task 12: Fan reactions

**Files:**

- Create: `apps/discord/src/press/reactions.ts`, `apps/discord/src/press/reactions.test.ts`
- Modify: `apps/discord/src/news/cycle.ts` (+ test), `news/prompts.ts`, `news/store.ts`, `apps/discord/src/press/gateway.ts`

**Interfaces:**

- Produces:

```ts
export function onReaction(
  deps: PressDeps,
  config: PressConfig,
  args: { channelId: string; messageId: string; userId: string; userIsBot: boolean },
): Promise<void>
```

- Ignore bots, other channels, messages that are not a news item (live: `news_items.discord_message_id`; trial: `news_press_mirrors.message_id`). Insert the vote; when `countReactionPeople ≥ 3` and `countReactionTriggersTonight(night) < 2` and `extrasBudgetLeft` → `insertReactionTrigger`. In trial with the news desk live (item `is_test` false), do not insert; DM the GM `Test: <item> would get a fan follow-up.`
- News cycle `reactionPass()` after `nightPass`, before `weekPass`, only when `extrasBudgetLeft`: for each trigger without a job (`includeTest = dryRun`): `claimNewsJob('reaction', String(itemId))`; refetch the sheet (game item → `game/<matchId>`, else `night/<night>`); reporter = weighted by `pairWeight(candidate, original, recent)` over enabled reporters except the original and `rink`, filtered by `isAllowed`; prompt `buildReactionUserPrompt({ facts, original: { reporter, text }, reporter })` — one reply post "the fans reacted to this; add one new point from the sheet"; `GAME_POSTS_SCHEMA` with one post, `checkGamePosts` with `replies: [true]`; insert with `replyTo` = original item, then `deliver`.
- `gateway.ts`: barlow's `messageReactionAdd` → `onReaction` (fetch partials first).

- [ ] **Step 1: Write the failing tests:** the third distinct person triggers once, a fourth does not trigger again; the same person twice counts once; a bot's reaction is ignored; the third trigger of a night is not created; the reaction pass writes one reply post with `replyTo` set and never by the original reporter or `rink`; at 80% spend the pass does nothing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(press): fan reactions get a follow-up from another reporter`.

---

### Task 13: Admin nickname list, privacy text, release checklist

**Files:**

- Create: `apps/web/src/app/admin/news/aliases-section.tsx`
- Modify: `apps/web/src/app/admin/news/page.tsx`, `apps/web/src/app/admin/news/actions.ts`, `apps/web/src/content/legal/privacy.tsx`, `apps/web/src/content/legal/data-collection.tsx`, `docs/operations/runbooks/news-desk-bots-setup.md`

- [ ] **Step 1: Aliases section** on `/admin/news` (Server Component list + small Client form, same pattern as `takes-section.tsx`): table nickname → player, add (nickname, player select from `listPressRoster`), delete. Server actions `addAliasAction`, `deleteAliasAction` with the existing admin check; nickname lowercased, 1–30 characters.
- [ ] **Step 2: Privacy draft** (do not publish without the operator): add to both pages, next to the existing AI sentence: "If you answer a reporter's questions in Discord, we store your answers and send them to Claude AI (Anthropic) to write the questions and the stories. Answering is optional." Mark the change in the commit message as needing operator approval.
- [ ] **Step 3: Run** `pnpm --filter web typecheck` and the admin news tests if present — PASS.
- [ ] **Step 4: Release checklist** in the runbook: (1) apply 0072 on live (`docker exec -i … psql … < 0072_news_press.sql`), (2) rebuild `news` and `press` images (docker-redeploy skill; tag `:rollback-he-<date>-pre-press` first), (3) start `press` with `PRESS_MODE` unset (trial) — one game night in the test channel, only the GM pinged, (4) operator reads the trial on `/admin/news` and in the test channel, (5) operator sets `PRESS_MODE=live`, restarts `news` and `press`, (6) rollback: `docker compose stop press`, unset `PRESS_MODE`, restart `news` (webhook path returns).
- [ ] **Step 5: Commit** `feat(admin): news nickname list; docs: privacy draft and press release steps (privacy text awaits operator approval)`.

---

## Not in this plan (spec §11)

Advanced scrums with OCR, interviews, dossiers, the joke-filter approval list, storylines, relationship scores, anytime conversations, intermission scrums. `theme` GM notes are only stored (`news_gm_notes.theme = true`) for those parts. Quotes in weekly features: the schema field exists everywhere, but only the night recap is offered quotes in this release.
