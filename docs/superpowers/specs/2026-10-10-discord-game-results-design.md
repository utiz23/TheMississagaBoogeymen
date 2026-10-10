# Discord Game-Result Posts — Design

**Status:** design approved in conversation 2026-10-10; awaiting operator review of this spec.
**Scope:** sub-project 1 of the Discord integration — the shared posting base,
the game-result post, and the three-star player-card image. Milestone posts and
session recaps are later sub-projects with their own designs (see §9).

## 1. Goal

When a game finishes, the team's Discord channel gets a post with the result,
the three stars and their game scores, and the **real player cards** of the
members among those stars. Teammates see the result where they already are and
click through to the site.

Success: every new completed game on the active title is posted exactly once,
within a few minutes of ingestion, with the same stars and scores the match page
shows — and ingestion is never slowed, blocked, or put at risk by any of it.

## 2. Decisions (operator, 2026-10-09/10)

| Decision        | Choice                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| Delivery        | Discord **webhook** into the team's existing server. No bot, no slash commands.    |
| Card fidelity   | **Exactly the site card**, in each player's equipped theme (`player_card_prefs`).  |
| Motion          | **Off.** Render with `prefers-reduced-motion: reduce` → the card's static variant. |
| Card order      | Left → right **1st, 2nd, 3rd** (not podium order).                                 |
| Where it runs   | **New, separate `discord` service** (own container). Worker untouched.             |
| Which stars     | **Same as the match page** (`buildTopPerformers`, opponents included).             |
| Who gets a card | Members only. Guests and opponents → text line, no card, no link.                  |
| DNF             | Short grey post: score-at-end + link. No stars, no cards.                          |
| Edits           | Posted once, **never edited** even if OCR later changes scores.                    |

## 3. Architecture

```
 worker (unchanged) ──saves match──▶ PostgreSQL
                                        │
 discord service ◀──poll ~60s───────────┘  unposted games?
    ├─ GET http://web:3000/internal/discord/stars/[matchId]   (secret header)
    ├─ headless Chromium, reduced motion → screenshot → cards.png
    ├─ build embed JSON (pure function)
    ├─ POST webhook (multipart: payload_json + cards.png)
    └─ record outcome in discord_posts
```

### 3.1 Units

1. **`discord_posts` table** (hand-written migration `0067_discord_posts.sql`,
   0065 pattern: idempotent, hand-applied via psql, rollback in header).
   - `match_id bigint PK → matches(id) ON DELETE CASCADE`
   - `kind text NOT NULL DEFAULT 'game_result'` (room for later post kinds)
   - `status text NOT NULL` — CHECK in `('pending','posted','failed','skipped')`
   - `attempts integer NOT NULL DEFAULT 0`, `last_error text`,
     `discord_message_id text`, `created_at`, `updated_at`, `posted_at`
   - Migration back-fills a `skipped` row for **every existing match**, so
     launch never floods the channel with history.
   - Drizzle schema in `packages/db/src/schema/`, queries in
     `packages/db/src/queries/discord-posts.ts`.

2. **Hidden card page** — `apps/web/src/app/internal/discord/stars/[matchId]/`.
   - Renders only the member stars' cards side by side, transparent/dark
     background, no nav or site chrome, fixed width so the screenshot is stable.
   - Reuses `buildTopPerformers` (same inputs as `/games/[id]`) and the existing
     card components/adapters — no duplicated formula or card markup.
   - **Access:** requires header `x-internal-token` equal to
     `DISCORD_INTERNAL_TOKEN`; anything else → `notFound()`. Missing/empty env
     → always 404. Excluded from `robots`, sitemap, and nav. (The tunnel exposes
     every web route publicly, so the token is the real guard.)

3. **`apps/discord` service** — Node + TypeScript workspace app, Playwright
   Chromium only.
   - Non-overlapping loop (async wait, like the worker), `DISCORD_POLL_INTERVAL_MS`
     default 60000.
   - **Eligible game:** title `is_active`, no `discord_posts` row (or `failed`
     with attempts < 3), and `played_at` within the last **24 h** (safety net:
     a long outage or a reprocess can never post old games).
   - Claims a row as `pending` before work; on success → `posted` with message id;
     on error → `failed`, attempts+1, `last_error`; after 3 attempts it stays
     `failed` and is logged, never retried automatically.
   - Opens a fresh browser per render and always closes it (`finally`).
   - Read-only on all match data; writes **only** `discord_posts`.

4. **Message builder** — pure function `buildGameResultMessage(match, stars,
memberCardCount)` → Discord payload JSON. No I/O; fully unit-tested.

### 3.2 Configuration (Hotel-Echo secrets, never committed)

| Var                        | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL`      | Target channel. Unset → service idles and logs once.                          |
| `DISCORD_INTERNAL_TOKEN`   | Shared by `web` and `discord` for the hidden page.                            |
| `DISCORD_DRY_RUN`          | `1` → write `cards.png` + `payload.json` to an output dir instead of posting. |
| `WEB_INTERNAL_URL`         | `http://web:3000` inside Compose.                                             |
| `DISCORD_POLL_INTERVAL_MS` | Default 60000.                                                                |
| `DATABASE_URL`             | Same DB, same role as web.                                                    |

Compose: new `discord` service, `depends_on` db + web, `restart: unless-stopped`,
**memory limit** (start at 1 GB), no published ports.

## 4. The message

**Embed**

- Title: `BGM 4 – 2 <opponent_name>`, linking to `https://boogeymen.app/games/[id]`.
- Result label: `WIN` / `LOSS` / `OT LOSS` / `DNF`; a win that went to overtime
  shows `WIN (OT)` using the existing `wentToOvertime` rule.
- Stripe colour matches `lib/result-colors.ts`: WIN green `#10b981`, LOSS red
  `#e84131`, OTL amber `#f59e0b`, DNF grey `#3a3839`.
- Sub-line: `NHL 26 · <game mode> · <t:unix:f>` — Discord timestamp markup, so
  each viewer sees their own timezone; time is `played_at` (game end).
- Three star lines, same order, scores and `statLine` as the match page:
  - member: `⭐ 1st  [Gamertag](…/roster/[id])  8.4  2G 1A +2`
  - opponent: `⭐ 2nd  Gamertag (OPP)  6.1  1G 1A` — no link
  - guest (BGM, non-member): `⭐ 3rd  Gamertag  5.3  1A 4 HITS` — no link
  - "member" uses the same rule as `PlayerLink` (present + past members).
- Image: `attachment://cards.png` when ≥1 star is a member; omitted otherwise.
- Footer link: `Full box score →`.

**DNF:** grey stripe, title, sub-line, link. No stars, no image.

**Failure fallback:** if the screenshot step fails, post the embed without the
image (counts as `posted`; error logged). The result always reaches Discord.

## 5. Error handling summary

| Failure                     | Behaviour                                                |
| --------------------------- | -------------------------------------------------------- |
| Webhook URL unset           | Idle, log once. No rows claimed.                         |
| Web/hidden page unreachable | Post text-only embed.                                    |
| Chromium crash/hang         | Render timeout (30 s) → text-only embed; browser killed. |
| Discord 429 / 5xx           | Row `failed`, retried next cycle, max 3 attempts.        |
| Discord 4xx (bad webhook)   | Row `failed`; loud log.                                  |
| Service down for hours      | Games stay unposted; on restart only the last 24 h post. |

Nothing in this list touches the worker, raw payloads, or match data.

## 6. Testing

- **Unit (message builder):** WIN, LOSS, OTL, OT win, DNF; star mixes —
  3 members, member + opponent + guest, no members (no image), fewer than 3 stars.
- **Unit (claim logic):** never double-posts; 3-attempt cap; 24 h window;
  skipped history rows are never picked.
- **Web route test:** hidden page returns 404 without the token, with a wrong
  token, and when the env var is empty; 200 with the right token.
- **Preview CLI:** `pnpm --filter discord preview --match-id N` renders one game
  to the dry-run output dir (no DB writes) — used to eyeball W/L/DNF/guest cases
  against the local preview DB (`eanhl_preview`).
- Green gates: typecheck, unit tests, prettier (repo lint is pre-existing-red).

## 7. Rollout (Hotel-Echo)

1. Apply `0067` to live DB (back-fills `skipped` rows); apply to `eanhl_preview`
   and the verify seed too.
2. Deploy web with the hidden page + token (docker-redeploy skill).
3. Deploy `discord` with `DISCORD_DRY_RUN=1`; inspect output for the next real game.
4. Operator creates a private `#bot-test` channel + webhook → point the service at it.
5. Operator approves → swap to the real channel's webhook.

**Off switch:** `docker compose stop discord` (or unset the webhook). Games
during downtime are not back-posted beyond the 24 h window.

## 8. Out of scope (YAGNI)

Editing posts, slash commands/bot, per-player DMs, posting opponent cards,
animated images, multi-channel routing, historical back-posting.

## 9. Later sub-projects (separate designs)

1. **Milestone posts** — career/season thresholds from the badge catalog and
   Awards data; likely reuse the card render for the player hitting it.
2. **Session recap** — needs a "session" definition first (e.g. games separated
   by < ~2 h); record, top performers across the night.
3. **Ops alerts** to a private channel (roadmap §3): worker stale, transform errors.
