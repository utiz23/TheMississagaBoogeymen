# Discord Unlock Pings — Design

**Status:** design approved in conversation 2026-10-24; awaiting operator review of this spec.
**Builds on:** [`2026-10-24-discord-unlock-posts-design.md`](./2026-10-24-discord-unlock-posts-design.md)
(live since `c41b915`, posting to the real channel since 2026-10-24). Everything
there stays; this adds one ping.

## 1. Goal

When a teammate unlocks a **new card** — a tier up or a mythic award — the post
pings that teammate in Discord. Nothing else pings.

## 2. Decisions (operator, 2026-10-24)

| Decision                        | Choice                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What pings                      | **Only new cards:** `tier` and `mythic` unlocks.                                                                      |
| What never pings                | Badge unlocks, card level ups, game result posts, roles, `@everyone`.                                                 |
| Who is pinged                   | Only the player the unlock is about.                                                                                  |
| Where the Discord ID comes from | **The site's Discord sign-in** (automatic); otherwise a **manual ID** the admin enters. Sign-in wins when both exist. |

## 3. Facts

- Sign-in links: `accounts` (`provider_id = 'discord'`, `account_id` = the
  Discord user ID) → `users` → `user_player_claims` (`player_id`). Linked today:
  silkyjoker85 and camrazz.
- A Discord user ID is a 17–20 digit number (Developer Mode → right-click the
  member → Copy User ID). It is not secret.
- A mention pings only when the message's `allowed_mentions` lists that user.
  The poster sends `{ parse: [] }` today, so nothing can ping.

## 4. Design

### 4.1 Manual ID (migration `0070_player_discord_user_id.sql`)

- `players.discord_user_id text NULL`, with a CHECK `discord_user_id ~ '^[0-9]{17,20}$'`.
  Hand-written, idempotent, adds only.

### 4.2 Admin page

A new **Discord pings** section on `/admin` (admins only, like the other
sections): one row per current team member (the same list as the nav's roster
menu, `listRosterMenuMembers`), showing the gamertag and:

- **Signed in** — the sign-in ID, read-only, with the note "from Discord sign-in";
- otherwise a text field for the manual ID, **Save** and **Clear**.

The server action checks the admin role, accepts only 17–20 digits (or empty to
clear), and writes `players.discord_user_id`.

### 4.3 Who to ping

`getPlayerDiscordUserId(playerId)`: the sign-in ID (`accounts.account_id` via
`user_player_claims`), else `players.discord_user_id`, else none.

### 4.4 The post

- The unlock data (`DiscordUnlock`) gains `discordUserId: string | null`, set
  **only** for `tier` and `mythic` unlocks (null for every other kind).
- With an ID: `**[NAME](<url>)** <@ID> has unlocked the **STUD** card!` and
  `allowed_mentions: { parse: [], users: ['ID'] }`.
- Without an ID: unchanged (`allowed_mentions: { parse: [] }`).
- The contract parser accepts only 17–20 digit IDs; anything else is rejected
  (the unlock retries, as for any bad data).

## 5. Testing

- **Unit:** message builder — tier/mythic with an ID ping only that user;
  without an ID no ping; badge and card level never ping even if an ID were
  present; contract parser rejects a malformed ID. ID lookup: sign-in beats
  manual; manual used when no sign-in; none → null (SQL pinned with `toSQL`).
  Admin action: rejects non-digits, wrong length, non-admins; empty clears.
- **Visual:** the admin section on localhost (read-only tunnel: the page loads;
  saving is checked after deploy).
- **Live check after deploy:** you enter an ID for a test player, award and clear
  a mythic for a player of your choice (as in the last test run), and confirm the
  ping arrives.
- Gates: typecheck, unit tests, prettier.

## 6. Rollout

Dump; apply 0070; redeploy `web` first, then `discord` (rollback tags, `--no-deps`).

## 7. Out of scope

Pinging roles or several people; pings for badges, card levels or games; letting
members enter their own ID (they can sign in instead).
