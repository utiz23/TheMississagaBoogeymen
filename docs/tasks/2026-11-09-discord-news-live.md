# Task: News desk live on the site and in #chel, in time order

- **State:** Deployed 2026-11-09 (news desk live; watch the first game night)
- **Lane:** Queries + Web (order), then Ops (switch-over)
- **Risk:** high for the switch-over (posts to the team channel, AI text goes public); low for the order fix
- **Slug:** news-live
- **Operator approval:** 2026-11-09 (order fix and pre-live check; switch-over still D3)
- **Operator gate before merge:** yes
- **Needs a deploy:** yes: `web`, then `news` env change (`NEWS_DRY_RUN=0`, `NEWS_WEBHOOK_URL`)

## Goal and visible result

Operator request 2026-11-09 (3). New stories appear on `/news` and in the #chel channel after each game
night, and the feed reads newest game first.

## State found (Lead, 2026-11-09)

- `/news` is in the nav and live. It shows 51 articles and 179 wire posts: the backfill (May–June
  games). New stories since then are `is_test = true` (8 articles, 39 posts) and are hidden.
- The `news` service runs on Hotel-Echo in test mode: `NEWS_DRY_RUN=1`, copies to the bot test channel,
  `NEWS_WEBHOOK_URL` is not set.
- **Not in time order:** the feed sorts by row id (insert order), not by game date. The lead story today
  is a 2026-05-22 game, above June stories.
- Release 1 of the bots (scrums, quotes, GM notes; branch `feat/news-desk-bots`, 30 commits, privacy text
  waits for the operator) is not merged. This task does not need it.

## Plan

1. **Order fix (low):** sort the feed by the story's game time (`night` / `week_start` / match
   `played_at`), then id. Same for paging (the cursor must follow the new order) and the reporter page.
2. **Pre-live check:** list what posts where (site, #chel, test channel); read the last 10 test stories
   for anything private or wrong; check the cost cap (`NEWS_MONTHLY_LIMIT_USD`, workspace $10 limit).
3. **Channels (operator question 2026-11-09):** today ONE webhook carries both the wire posts
   ("tweets") and the article teasers, so both go to #chel. Separate channels = a small code change.
4. **Decide old test stories:** keep hidden, or publish the good ones.
5. **Switch-over (high, operator steps):** the operator makes a #chel webhook; the Lead gives the exact
   `.env` lines; restart `news`; watch the first game night; rollback = `NEWS_DRY_RUN=1` + restart.

## Done when

- **Done when:** `/news` lists stories newest game first (test on the live data copy), and after the
  first live game night the story is on `/news` and in #chel, once each.

## Log

- 2026-11-09 Lead: state found (above).
- 2026-11-09 Lead: order fix on `work/news-order`. `created_at` holds the story time (the backfill
  kept each game night), so the feed and the reporter page sort by `created_at desc, id desc`; the
  "more" cursor stays an item id and continues below that item's `(created_at, id)`. Checked on live
  (read-only): page 1 = 227 (week of 06-15), 220, 219 (06-21), 211 (06-20), 207; page 2 after 211 =
  207, 202, 196, 192, 190. Was: a 05-22 story first. db news tests 57/57, db + web typecheck pass.
  Not changed: the writer's own "recent pieces" queries (internal, still by id).
- 2026-11-09 Lead: order fix merged (`6f66f492`), not deployed (goes with the next `web` deploy).
- 2026-11-09 Lead, pre-live check: (a) where: one webhook for wire posts and article teasers (#chel when
  set), the site shows every non-test item, the test channel gets copies only in test mode. (b) read
  the 14 newest test items: club names only, nothing private seen. (c) **cost:** November $12.40 of
  the $20 app cap in 9 days (Opus 5.5: write $10.70, review $1.71); last two nights $4.32 and $5.38.
  At this pace the cap stops the desk within a few game nights: raise the cap (and the Anthropic
  workspace limit) or use a cheaper model before going live.
- 2026-11-09 Lead, switch-over (operator sent the webhook): Hotel-Echo `.env` backed up to
  `.env.bak-2026-11-09-pre-news-live`; `NEWS_WEBHOOK_URL` set (same channel as the game poster,
  main server; webhook name "News Desk"); `NEWS_DRY_RUN=0`; `news` restarted: "started (live)".
  The start step deleted the 49 test items by design (jobs kept, ruling R8): the covered games are
  never written again; the test stories stay in the bot test channel; older ones are in the 11-09
  backup. Nothing old is resent: the 230 public items are `discord_status = skipped`.
- 2026-11-09 Lead: `web` deployed at `48a03828` (rollback `:rollback-he-2026-11-09-pre-news-order`):
  `/news` leads with the week of 06-15, then 06-21. First #chel posts come with the next game.
- **Rollback:** `NEWS_DRY_RUN=1` in `.env`, `docker compose up -d --no-deps news`.
