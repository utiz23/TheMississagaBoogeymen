# Discord Unlock Posts — Design

**Status:** design approved in conversation 2026-10-24; awaiting operator review of this spec.
**Replaces:** the batch post of [`2026-10-24-discord-card-updates-design.md`](./2026-10-24-discord-card-updates-design.md)
(live since `ab031e7`: one "CARD UPDATES" embed per batch). Everything else in the
earlier Discord specs stays: webhook, opt-in `discord` service, claim and
no-double-post rules, games before cards, dry run, 24 h window.

## 1. Goal

Post one Discord message per card unlock — a badge level, a card level, a new
card tier, a mythic card — with one clean graphic: the badge, or the card.

Success: every unlock of a real teammate on the active title posts exactly once,
in a fixed order, after the game post of the same worker cycle, and the text and
graphic match what the site shows.

## 2. Decisions (operator, 2026-10-24)

| Decision           | Choice                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Grouping           | **One message per unlock.**                                                                 |
| Badge changes      | **Every level up** (1–30). Every level has its own look on the badge board.                 |
| Badge name         | **The badge board's name:** `<Family> · <Theme> <I/II/III>`, e.g. `Shots · Carbon-Fiber I`. |
| Text               | Plain Discord message text (bold, link), no embed box.                                      |
| Badge graphic      | The badge as the badge board draws it, **~120 px**, **transparent PNG**.                    |
| Card graphic       | The **full card**, cropped to its edges, **transparent PNG**, rendered at **3×**.           |
| AI goalies, guests | No posts. Cleared mythics: no post.                                                         |
| Replaces           | The "CARD UPDATES" batch post.                                                              |

Samples the operator approved in `#bot-test`: "**UTIZ** has unlocked **Goals · Away I**!"
(transparent 120 px badge) and "**UTIZ** has unlocked the **STUD** card!" (transparent
full card).

## 3. Facts the design rests on

- Badge `level` 1–30. The badge board names a level `themeLabel(level)`:
  theme = `CARD_THEME_ORDER[ceil(level/3) − 1]`, frame = I/II/III by
  `(level − 1) % 3` (`badge-board.ts`). The board draws it with
  `Badge(theme, frame)`. (The small card-footer badge uses a different I–VI
  numbering; posts follow the board.)
- `tier_up` events carry tiers 1–5; each stats tier has one theme
  (`TIER_THEME`: Prospect = Away … Franchise = Hardlight). Tier 6 only comes
  from a mythic award.
- `mythic_awarded` events do not carry the theme; `player_card_progress.mythic_theme`
  holds the current one.
- Card events also happen without games (EA season stats).

## 4. The messages

`NAME` = the player's card name in capitals (as the card prints it), bold, linked
to their page without a link preview: `**[NAME](<https://boogeymen.app/roster/ID>)**`.

| Event                       | Text                                      | Graphic                              |
| --------------------------- | ----------------------------------------- | ------------------------------------ |
| `badge_level_up`, to > from | `NAME has unlocked **Shots · Home II**!`  | the badge at level `to`              |
| `level_up`                  | `NAME has reached **card level 5**!`      | the player's card as it looks now    |
| `tier_up`                   | `NAME has unlocked the **STUD** card!`    | the card in the new tier's theme     |
| `mythic_awarded`            | `NAME has unlocked the **INFERNO** card!` | the card in the awarded mythic theme |
| `mythic_cleared`            | — (never)                                 | —                                    |

A badge jump inside one event (e.g. 3 → 5) posts once, for the level reached.
If the mythic was cleared before posting (no `mythic_theme` now), the unlock is
skipped with `nothing to show`.

Text is escaped for Discord markdown; mentions are off (`allowed_mentions: none`).

## 5. Design

### 5.1 Unlock record (migration `0069_discord_unlock_posts.sql`)

Hand-written, idempotent, same header form as 0068.

- `discord_unlock_posts`: `event_id bigint PK → player_card_events(id) ON DELETE
CASCADE`, `status` (`pending|posted|failed|skipped`), `attempts`,
  `last_error`, `discord_message_id`, `created_at`, `updated_at`, `posted_at`.
  One row per event, so deleting an event can never re-post another one.
- Back-fill: a `skipped` row (`'before launch'`) for every existing event.
- `discord_card_posts` (0068) stays in place, unused; dropping it is a later
  clean-up.

### 5.2 Candidates and order

An event is a candidate when:

- its title is active and `occurred_at` is within the last 24 h;
- it has no row, or a `failed` row with `attempts < 3` (`pending` never re-picked);
- settled: every match type has an `ingestion_log` row for that title with
  `started_at > occurred_at` (same rule as 0068);
- it counts: `badge_level_up` with `to_value > from_value`, or `level_up`,
  `tier_up`, `mythic_awarded`; for a member (`MEMBER_CONDITION`), not an AI
  goalie.

Order: `occurred_at`, then the player's first event id in that batch, then kind
(badge → card level → tier → mythic), then event id. At most 20 per poster cycle.

### 5.3 Web: one JSON route and one graphic page per unlock

Both token-guarded (404 otherwise), keyed by event id:

- `GET /internal/discord/unlock/[eventId]/data` → `DiscordUnlock`
  (shared contract): `{ eventId, playerId, name, text, graphic: 'badge' | 'card' }`,
  or 404 when the event doesn't count any more (then the poster skips it).
- `GET /internal/discord/unlock/[eventId]` → `#discord-unlock` on a transparent
  page (site chrome hidden): the badge (`Badge`, 120 px, board theme + frame) or
  the full `PlayerCard` (list context; theme/tier per §4).
- A pure `unlockMessage(event, context)` builds the text and picks the graphic;
  unit-tested.

### 5.4 Poster

Each cycle: games first, then unlocks (this pass replaces the card-batch pass).
Per unlock: fetch the JSON (web down ⇒ skip without claiming) → claim → render
the graphic (`omitBackground`, scale 2 for badges, 3 for cards, cropped to the
element; failure ⇒ text-only) → send as message `content` with the PNG attached
→ mark. Same no-double-post rules as the game posts. About 2 s between messages;
a 429 is a definite failure, retried next cycle.

The old batch code (card-updates route/page, `showcaseChanges`,
`DiscordCardUpdates`, `runCardUpdatesCycle`) is removed.

## 6. Error handling

As the earlier specs. Additionally: an unlock that no longer counts when fetched
(membership ended, mythic cleared) is claimed and marked `skipped` with
`nothing to show`.

## 7. Testing

- **Unit:** `unlockMessage` — every kind, badge naming at levels 1, 3, 4, 30,
  a jump (3 → 5), tier and mythic names, capitals, escaping, link form;
  contract parser; poster unlock pass (order kept, games first, web-down skip,
  nothing-to-show skip, no re-post after a send).
- **SQL:** `toSQL()` pins for candidates (counting, settle, order, limit) and
  claim; live checks only inside rolled-back transactions.
- **Visual + end-to-end test run** (operator): after deploy, insert one test
  event per kind for Utiz23 (player 28), let the poster send them to
  `#bot-test`, then delete the test events (their rows go with them).
- Gates: typecheck, unit tests, prettier.

## 8. Rollout

1. Dump; apply 0069 right before the restart (back-fills `skipped`).
2. Redeploy `web` and `discord` (rollback tags, `--no-deps`).
3. Test run (§7), then clean-up.

Known data issue: Utiz23's stored name is "-,Utiz", so his posts read
"-,UTIZ" until his profile name is fixed.

## 9. Out of scope

Grouped or batch posts; embeds for unlocks; transparent images for game posts;
dropping `discord_card_posts`; a separate channel.
