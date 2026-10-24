# Discord Card-Update Posts — Design

**Status:** design approved in conversation 2026-10-24; awaiting operator review of this spec.
**Builds on:** [`2026-10-10-discord-game-results-design.md`](./2026-10-10-discord-game-results-design.md)
and [`2026-10-10-discord-lineup-image-design.md`](./2026-10-10-discord-lineup-image-design.md)
(live since 2026-10-10, `38a9d06`: webhook, opt-in `discord` service, claim and
no-double-post rules, compact cards, image under the embed).

## 1. Goal

When a teammate's card changes in a way people can see, post it to the team's
Discord channel: one "Card updates" post per batch of changes, with the
players' current compact cards.

Success: every visible change for a real teammate on the active title is posted
exactly once, after the game post of the same worker cycle, and the post matches
what the site shows.

## 2. Decisions (operator, 2026-10-24)

| Decision        | Choice                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| What posts      | New badge, badge upgrade, card level up, tier up, mythic awarded.                          |
| Badge changes   | **Visible only:** a new Roman numeral (I…VI). Internal steps inside a numeral do not post. |
| Grouping        | **One post per batch** (one card recalculation, or one mythic award).                      |
| Image           | Compact medium cards (176×252), each player's current card, a caption of their changes.    |
| AI goalies      | **No posts.** Guests: no posts.                                                            |
| Cleared mythics | No post.                                                                                   |
| Channel         | The same webhook as the game posts.                                                        |
| History         | Not posted: every batch that exists at launch is marked `skipped`.                         |

## 3. Facts the design rests on

- `player_card_events` is append-only. A card recalculation inserts all its
  events in one transaction with one `occurred_at`; `awardMythic` inserts one
  event. So a **batch** = the events with the same `(game_title_id,
occurred_at)`.
- Events also happen **without games**: card values follow EA's season stats.
  So card posts are separate from game posts.
- Badge `level` is an internal step 1–30. The site shows the Roman numeral
  `ceil(level / 5)` (`card-badge.tsx`). Step 0 = no badge.
- Card `level` (1–10) is shown on the card back ("LEVEL n / 10") and in the
  card locker. Tier labels: Prospect, Rookie, Stud, Elite, Franchise, Legend.

## 4. What counts as a showcase change

An event counts when all of these are true:

- its title is active (`game_titles.is_active`);
- its player is a club member (`getClubMemberIds()`) and not an AI goalie
  (`players.ai_goalie_side IS NULL`);
- its kind and values match one row:

| Kind             | Counts when                                | Text                                        |
| ---------------- | ------------------------------------------ | ------------------------------------------- |
| `badge_level_up` | `ceil(to/5) > ceil(from/5)` and `from = 0` | `New badge: Hat Tricks I` (numeral of `to`) |
| `badge_level_up` | `ceil(to/5) > ceil(from/5)` and `from > 0` | `Goals II → III`                            |
| `level_up`       | always                                     | `Card level 4 → 5`                          |
| `tier_up`        | always                                     | `⬆ Tier: Rookie → Stud`                     |
| `mythic_awarded` | always                                     | `Mythic card awarded`                       |
| `mythic_cleared` | never                                      | —                                           |

Badge names come from the badge catalog (`BADGE_FAMILIES[].name`). One player
with several changes in a batch gets one line with the texts joined by `·`,
badge changes first, then level, then tier, then mythic.

A batch posts only if at least one event in it counts.

## 5. Design

### 5.1 Batch record (migration `0068_discord_card_posts.sql`)

Hand-written, idempotent, same header form as 0067.

- `discord_card_posts`: `batch_event_id bigint PK` (the smallest
  `player_card_events.id` in the batch — it names the batch), `game_title_id`,
  `occurred_at`, `status` (`pending|posted|failed|skipped`), `attempts`,
  `last_error`, `discord_message_id`, `created_at`, `updated_at`, `posted_at`.
- Back-fill: one `skipped` row (`last_error = 'before launch'`) per existing
  batch.

### 5.2 Candidates

A batch is a candidate when:

- its title is active and `occurred_at` is within the last 24 h;
- it has no row, or a `failed` row with `attempts < 3` (`pending` is never
  re-picked — no double post, same as the game posts);
- **settled:** an `ingestion_log` row for that title has `started_at >
occurred_at` (the worker's next cycle began, so a mythic award also waits at
  most one worker cycle);
- at least one of its events counts (§4). The SQL applies the title, member,
  AI-goalie and kind/numeral rules; the member list is the same condition
  `getClubMemberIds()` uses.

Claim, mark-posted, mark-failed and mark-skipped work exactly like
`discord_posts`.

### 5.3 Web: one JSON route and one hidden page

Both guarded by `DISCORD_INTERNAL_TOKEN` (404 otherwise), both keyed by the
batch event id:

- `GET /internal/discord/card-updates/[batchEventId]/data` → `DiscordCardUpdates`
  (shared contract in `@eanhl/db/discord`):
  `{ batchEventId, gameTitleName, players: [{ playerId, name, changes: string[] }], cardCount }`.
  `players` is ordered by the first counted event's id.
- `GET /internal/discord/card-updates/[batchEventId]` → `#discord-card-updates`:
  up to 9 compact medium cards, 3 per row, each the player's current card
  (built as the site builds it: EA roster + carry-overs row, card progression,
  equipped theme), with the player's changes joined by `·` as a caption.
- A pure function `showcaseChanges(events, members, familyNames)` does §4 and
  is unit-tested; the loader only fetches.

### 5.4 Poster

Each cycle: games first (unchanged), then card batches. For each card batch:
fetch the JSON (web down ⇒ skip without claiming, retry next cycle) → claim →
render the page (failure ⇒ text-only post) → send → mark. Same no-double-post
rules as the game posts (a send that succeeded or may have succeeded is never
marked failed).

**Message:** embed title `CARD UPDATES` (red stripe `0xe84131`), linking to the
site; one line per player: `[Name](…/roster/id) — Goals II → III · Card level 4 → 5`
(markdown-escaped, no mentions). Players beyond 9: text line only. The image is
a plain attachment under the embed.

## 6. Error handling

Same table as the game posts (spec §5 of the first design). A batch whose
events no longer count (e.g. the player stopped being a member) when fetched
is marked `skipped` with `last_error = 'nothing to show'`.

## 7. Testing

- **Unit:** `showcaseChanges` — numeral boundary (5→6 counts, 13→14 doesn't,
  0→1 new badge, 0→6 jumps straight to II), level/tier/mythic texts, mythic
  cleared ignored, AI goalie and guest filtered, per-player ordering and
  joining; message builder; contract parser; poster cycle with card batches
  (games first, web-down skip, no re-post after send).
- **SQL:** `toSQL()` pins for the candidate query and claim; then the claim
  and candidate rules run against the **live** DB inside transactions that are
  always rolled back (operator OK asked before this step — the main PC has no
  local database since 2026-10-21).
- **Visual:** previews of real batches through the read-only SSH tunnel to the
  live DB (`?default_transaction_read_only=on`); operator approves the look
  before deploy.
- Gates: typecheck, unit tests, prettier.

## 8. Rollout

1. Apply 0068 to live (back-fills `skipped`). Pre-migration dump first.
2. Redeploy `web` and `discord` (docker-redeploy skill, rollback tags,
   `--no-deps`).
3. The next counted batch posts to the current channel (`#bot-test` or the
   real one — whichever webhook is set).

Off switch: unchanged (`docker compose stop discord`).

## 9. Out of scope

Posts for internal badge steps, AI goalies or guests; a separate channel or
webhook; editing posts; season-card (new title) unlock posts.
