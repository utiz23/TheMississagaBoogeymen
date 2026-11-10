# Task: News desk live on the site and in #chel, in time order

- **State:** Proposed (plan only)
- **Lane:** Queries + Web (order), then Ops (switch-over)
- **Risk:** high for the switch-over (posts to the team channel, AI text goes public); low for the order fix
- **Slug:** news-live
- **Operator approval:** pending
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
