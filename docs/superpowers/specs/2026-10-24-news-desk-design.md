# News Desk — Design (project 1: posts, articles, news page)

**Status:** design approved in conversation 2026-10-24; awaiting operator review of this spec.
**Scope:** project 1 of the news desk. Projects 2–4 (reporter bots, scrums,
conversations) are in §10 as notes only and get their own designs later.
**Characters:** [`docs/specs/news-personalities.md`](../../specs/news-personalities.md)
is the source for the seven reporters, their voices, the assignment matrix and the
content rules. This design does not repeat it.

## 1. Intent

The Discord game-result poster now works. The operator wants a fictional media
world around the Boogeymen on top of it: seven reporters who write about the
team in their own voices. Teammates see new items in Discord, and the site keeps
all of it on a news page.

The point is fun and identity, not information. The stats pages already give the
numbers. The news desk turns the numbers into stories, so that the team feels
like a team with its own press.

Readers: the handful of teammates in the team Discord, and anyone with the site
link (the site is unlisted). Taking part is optional. Players who do not care can
mute the news channel.

## 2. Goals, non-goals, anti-goals

**Goals**

- After each game: 1–2 short posts from reporters, a few minutes after the game result.
- After each game night: one article about the whole night.
- At most one extra piece each week.
- A news page on the site with all articles and posts.
- The reporters sound different from each other, as the character spec says.
- Fully automatic. No operator approval step (operator decision).

**Non-goals (project 1)**

- No pictures, voice or audio. Text only. (Reporter avatars are the only images.)
- No Discord bots and no reading of Discord messages (that is project 2).
- No interviews, no conversations.
- No articles for past games. The desk starts empty and writes about the first
  game night after launch.
- No editing of posted items. Items can only be deleted.

**Anti-goals: a failure even if it technically works**

- **Invented facts.** A wrong score, a goal nobody scored, a player who did not play.
- **Hurting a teammate.** Criticism about the person and not the hockey, harsh
  text about a player set to "Go easy", or any mention of a player set to
  "Leave me out".
- **Any risk to data collection or to the game-result posts.** The news desk must
  never slow, block or break ingestion, the game-result cycle or the unlock cycle.
- **Spam.** More than the agreed amount.
- **Every piece sounds the same.**
- **Cost that runs away.**

## 3. Decisions

| Decision                 | Choice                                                                                              | By                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Discord channel          | New channel, own webhook. Name suggestion `#press-room`                                             | operator                                            |
| After each game          | 1–2 microblog posts; sometimes a second reporter replies                                            | operator (agreed amount)                            |
| End of night             | One article. "Night ends" = about 90 min with no new game                                           | operator (agreed)                                   |
| Between nights           | At most one weekly piece (for example Mara Quill's numbers column)                                  | operator (agreed)                                   |
| Text writer              | Claude API, paid from the Max plan's included API credits                                           | operator approved cost; Claude API is Claude's call |
| Posting                  | Fully automatic, no approval step                                                                   | operator                                            |
| Facts                    | Style is free, facts come only from real data                                                       | operator (agreed)                                   |
| Site layout              | Layout B "front page" — see §6 and the approved wireframe                                           | operator                                            |
| More stories             | Wide rows, newest first, load more on scroll until all are shown                                    | operator                                            |
| The Wire                 | Newest 20 posts + "Show older posts" button                                                         | Claude's call                                       |
| Roast limits             | Three levels per player; **all players start at "Full press"** (§7.3)                               | levels Claude's call; start level operator          |
| Player names             | The **profile name** (`player_profiles.player_name`); the gamertag only when no profile name is set | operator; fallback Claude's call                    |
| Quotes                   | No invented quotes from teammates; reporters may quote each other (§5.1)                            | Claude's suggestion, not objected to                |
| Monthly limit            | **$10 a month**, as the spend limit of its own Console workspace                                    | operator                                            |
| Delete                   | Admin can delete any item; it goes from the site and from Discord                                   | Claude's call                                       |
| Fact check               | Automatic check before posting; one retry; else skip (§7.1)                                         | Claude's call                                       |
| Cost cap                 | Monthly spending limit; desk pauses when reached (§7.5)                                             | Claude's call                                       |
| Controls                 | On/off switch on `/admin`; test mode like `DISCORD_DRY_RUN`                                         | Claude's call                                       |
| Reporter look in Discord | Each message shows the reporter's name and picture (webhook per-message `username` / `avatar_url`)  | Claude's call                                       |

## 4. Content

### 4.1 After each game (microblog posts)

- Trigger: the game's result post is done (posted, failed or skipped) in
  `discord_posts`. News posts must come after the game result, never before.
- 1 or 2 posts, each at most 280 characters. Sometimes a second post is a reply
  from another reporter (use the relationship map in the character spec).
- Reporter choice: the assignment matrix in the character spec, by game situation
  (routine win, overtime win, blowout loss, and so on).
- DNF games: at most one short post, or none. Builder's call.
- Discord has no "reply" for webhook messages. A reply is a normal message whose
  text starts with a reply marker (for example `↪ to Dex Mercer:`). On the site it
  shows indented under the post it answers, as in the wireframe.

### 4.2 End of night (article)

- A "night" is one evening of games, as counted on 2026-10-24: games after
  midnight count with the evening before. Average is 4.2 games over about 2 hours;
  most nights have 3–5 games.
- Trigger: no new game for about 90 minutes after the last game of the night.
- One article about the whole night, by the reporter who fits the night (for
  example Dex Mercer after a 1–4 night). Length about 250–450 words. Each reporter
  uses their article format from the character spec.
- Discord gets a short message: headline, one-line summary, reporter, link to the
  full article on the site.

### 4.3 Weekly piece

- At most one per week, and only in a week that had games.
- Suggested default: Mara Quill's numbers column. Other reporters can rotate in.
  The day and the rotation are the builder's call.

### 4.4 Content rules (from the character spec, kept)

- Wins do not always get praise; losses do not always get doom.
- Dex Mercer appears only sometimes. Father Rink appears rarely. The builder sets
  simple frequency limits so these rules hold over weeks, not only per item.
- Intermission and scrum voices are out of scope here.

## 5. Facts and memory

### 5.1 The fact sheet

The AI gets a fact sheet built from the database, and nothing else about the
games. Typical content: scores, shots, hits, other team stats the match page
shows, per-player points and stats, the three stars, streaks, records, card
unlocks, milestones, and the night's totals.

Rules for the fact sheet:

- Use the same numbers the site shows (same queries, or the same internal-route
  pattern the Discord poster uses). A story must never disagree with the match page.
- **Names:** only team members are named. A member is named by their **profile
  name** (`player_profiles.player_name`, set on EDIT PROFILE); a member without one
  is named by their gamertag. No other nicknames. Each member has exactly one
  allowed name, and the fact check accepts only that name. Players with "Leave me
  out" (§7.3) are not on the sheet by name. Guests and opponent players are not
  named. Opponent **club** names are allowed.
- **Quotes:** reporters never invent a quote from a teammate (real quotes come
  with the scrums in project 2). Reporters may quote each other, because they are
  fictional. Where a reporter's article format in the character spec asks for a
  player quote, use a quote from another reporter or leave it out.
- **Opinion vs. events:** opinion is allowed when it follows from the stats
  ("29 shots against says the defence was under siege"). Invented events are not
  (a shot off the post, a save, a pass, a line change, a mood in the room).
- AI goalies (Lehmann, Wagner) are not human players. Do not treat them as
  teammates in praise or criticism.
- Matches excluded from the site (for example the quarantined NHL 26 matches)
  are never on the sheet.
- There is no play-by-play data. The reporters must not invent plays, passes or
  tactics. June Halberd's "film room" voice works from what the stats show
  (shots, possession time, passing, faceoffs, period scores where the site has
  them), not from invented video analysis.

### 5.2 Reporter memory

Before writing, a reporter also gets:

- recent results (the last few nights), streaks, milestones, card unlocks;
- short summaries of their own last few pieces, so they can refer back.

Store a short summary with each article when it is written. The number of
nights and pieces is the builder's call.

## 6. The news page on the site

Approved wireframe: `apps/web/src/app/preview/news/page.tsx` (throwaway; build
the real page new from this design, do not ship the preview).

- **`/news`** — "Press Room".
  - Top: the newest article, big (kicker, headline, one-line summary, reporter,
    the night's scores with links to the games, the opening paragraphs, "Read the
    full story").
  - Below: "More stories" — one wide row per article (reporter picture, type,
    headline, one-line summary, date and reporter). Newest first. More rows load
    as the reader scrolls, until all articles are shown.
  - Side column "The Wire": the newest 20 microblog posts, replies indented under
    the post they answer, and a "Show older posts" button.
  - Phones: The Wire moves below the stories.
- **`/news/[article]`** — one article: reporter and outlet, date, the night's
  scores with links to the games, full text. Player names use `PlayerLink`
  (members link, guests plain text).
- **`/news/reporters/[reporter]`** — short bio from the character spec and a list
  of the reporter's articles.
- **Top menu:** a "News" link.
- Look: the site's dark theme and red accent, as in the wireframe.
- Follow the site's link prefetch convention for every link to a data page.
- Same visibility as the rest of the site (anyone with the link; `noindex`).
- Empty state for the time before the first article.

Reporter pictures: start with the coloured letter boxes from the wireframe. The
operator can supply real pictures later. Discord needs a public URL for each
picture, so the site serves them.

## 7. Safety

### 7.1 Fact check before posting

Before an item is posted, the program checks it against the fact sheet:

- every number in the text is on the fact sheet;
- every person's name in the text is an allowed name (members not opted out),
  and every club name is a real club from the sheet.

If the check fails, the AI writes the item again one time with the reason. If it
fails again, the item is skipped and logged. Numbers written as words, dates and
times need handling; the method is the builder's call, but the intent is that no
invented stat gets through.

Invented quotes and invented events (§5.1) are not caught by a number-and-name
check. The prompt rules are the first defence. Whether a second, AI-based check
for these is worth its cost under the $10 limit is the builder's call; report the
choice to the operator.

### 7.2 Rules for everyone

Criticism is about hockey only. No comments about real life, looks, or the
person. These rules go in every prompt, whatever the reporter or the roast level.

### 7.3 Roast limits

Each player chooses one level. Members set their own on EDIT PROFILE on their
player page; the admin can set it for any player.

| Level                    | Meaning                                          |
| ------------------------ | ------------------------------------------------ |
| Full press (start level) | Reporters can be harsh about the player's games. |
| Go easy                  | Criticism of the player stays mild.              |
| Leave me out             | Reporters do not name the player at all.         |

All players start at Full press (operator, 2026-10-24: "for now"). The admin can
set any level for any player; the admin page shows who set each level. The rules
in §7.2 apply at every level.

### 7.4 Delete

On `/admin`, the admin sees the recent news items and can delete any of them.
A deleted item goes away from the site and from Discord (a webhook can delete its
own messages). No editing.

### 7.5 Cost

- **$10 a month** (operator). Two layers: the spend limit of the news desk's own
  Claude Console workspace (`boogeymen-news-desk`), and a limit in the program.
  Record the usage of each AI call. When the program's limit is reached, the desk
  stops writing until the next month and logs it once.
- Payment: the operator's Max 5x plan includes $100 a month of API credits,
  linked to the Console organization. No card and no auto-reload on the Console,
  so when the credits run out, requests stop and nothing is charged. The API
  answers then with a "credit balance too low" error; treat it like the limit
  being reached (stop for the month, log once).
- The operator creates the key in the `boogeymen-news-desk` workspace. The key
  goes in the server `.env` only; it is never pasted into chat or committed.
- First build step: check the current prices and choose the model. Report the
  expected monthly cost to the operator (about two game nights a week, about
  eight a month). Continue building unless the estimate is above the limit.

### 7.6 Controls

- On/off switch on `/admin`.
- Test mode (Claude's call): write everything, store it, write the Discord
  messages to files, but send nothing. It has its **own** setting, separate from
  `DISCORD_DRY_RUN`, so the game-result posts and the news can go live separately.
  Fail closed: anything but an explicit `0` is test mode.
  - Test items are **not** shown on the public news pages. Only the admin sees
    them, in the news list on `/admin`.
  - Release (Claude's call): run test mode for at least one real game night, the
    operator reads the output on `/admin`, then the operator switches to live.
    Test items are deleted at that switch; nothing from test mode is published.
- An API failure or a timeout skips that item after limited retries. It never
  blocks the next cycle.

### 7.7 Privacy text

The site's privacy and data-collection pages must say that profile names,
gamertags and game stats are sent to an AI service to write the news, and that
the news is shown on the site and in Discord. The builder drafts the text;
the operator approves it.

## 8. Constraints from the existing system

- **Do not put the news desk in the worker.** Data collection must stay as it is.
- **Isolation from the existing Discord cycles.** The `discord` service runs the
  game-result and unlock cycles. If the news desk runs in the same service
  (Claude's suggestion: it already has the loop, the test mode, the webhook code
  and the internal-route pattern), a news error must never stop or delay those
  cycles. A separate service is also acceptable. Builder's call, with this rule.
- The existing pattern: the `discord` service reads data through the web app's
  internal routes (secret header) and writes only its own tables.
- **Migrations are hand-written idempotent SQL**, applied with psql (the
  0067–0070 pattern), with rollback steps in the header. The drizzle journal is
  frozen. The verification database needs each new migration too.
- Production is Hotel-Echo. Deploy and roll back as the earlier Discord releases
  did (rollback image tags). The worker container runs in UTC; show dates in
  America/Edmonton.
- New secrets (AI API key, news webhook URL) go in the server `.env`, never in git.
- Repo checks: typecheck, tests and prettier are the green gates; `pnpm lint` is
  already red repo-wide.

## 9. Success

- After a normal 4-game night, `#press-room` has about 6–8 short posts and one
  article, and the news page shows them.
- Every number in the news agrees with the match pages.
- Nobody is named against their roast level, and nobody is hurt by it.
- The game-result posts and data collection work exactly as before.
- The monthly cost stays under the limit.

## 10. Later projects (notes only — each gets its own design)

2. **Post-game scrum.** Seven reporter bots in Discord, one per reporter (each with
   its own name, picture and place in the member list; one program runs all
   seven). After a game, reporters ask questions in text; players answer in text;
   the answers become quotes in posts and articles. When the bots exist, the
   microblog posts move from the webhook to the bots, so each reporter looks the
   same everywhere.
3. **Intermission scrum.** Needs the score during the game, so it waits for the
   live engine (sister repo), or a player starts it by hand.
4. **Anytime conversations.** Players can talk to a reporter at any time.

Text only for all of them; no voice.

## 11. Left to the builder

- Where exactly the news desk runs (inside the `discord` service or its own),
  within §8's isolation rule.
- Table design, including roast level storage, usage records and summaries.
- How the night-end trigger and the weekly day work in detail.
- How reporters are chosen when more than one fits, and the frequency limits.
- Prompt design, model choice (after the price check), article length within
  the stated range.
- The fact-check method.
- Page sizes for infinite scroll and older posts.

## 12. Revision 2 — content lineup (operator, 2026-10-25)

Supersedes §4 where they differ. Decided in conversation after the trial content
and the NHL 26 backfill preview.

### 12.1 Content types

| Type                      | Where                | When                                       | Length           | Notes                                                                                              |
| ------------------------- | -------------------- | ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| Game recap post           | The Wire (+ Discord) | after each counted game                    | ≤ 280 characters | One per game: result, score, who scored, one key number. Written by the reporter whose turn it is. |
| Reaction / reply post     | The Wire (+ Discord) | sometimes, after a recap post              | ≤ 280 characters | A second reporter reacts or replies (relationship map). Not every game.                            |
| Night recap (trend)       | Article              | when the night ends (90 min)               | 250–450 words    | As before.                                                                                         |
| Weekly feature (in depth) | Article              | Mondays from 12:00, if the week had a game | 600–900 words    | Replaces the weekly piece. Kinds rotate (§12.3).                                                   |

Goal timeline facts (period, clock, scorer, assists) may be used in every type
when the sheet has them (§ backfill brief B1).

### 12.2 Reporters — two new characters

The cast grows to nine. The two new reporters are fictional characters inspired
by Canadian hockey-media styles; they never use or imitate real people's names
or catchphrases.

- **Gord Pettibone — The Daily Slapshot.** Big-market tabloid columnist; blunt,
  polarising, never apologises, loves a list. Signature: the notes column, 10–15
  short separate items, one always a jab. Words: frankly, overrated, the truth
  is, soft, embarrassing. Byline: "Notes by Gord Pettibone, The Daily Slapshot".
- **Lyle Bergstrom — Big Country Hockey.** Senior writer who has seen it all;
  plain-spoken, old-school (compete, character, playoff-style hockey), suspicious
  of fancy numbers but fair, takes the long view. Signature: big picture → the
  night's numbers as evidence → a firm verdict. Words: compete, honest, the room,
  this time of year, in my experience. Byline: "Lyle Bergstrom, Big Country
  Hockey".
- Relationships: Pettibone mocks Quill's spreadsheets and Quill fact-checks him;
  Pettibone and Mercer compete for outrage; Bergstrom respects Barlow and has no
  patience for Vale's theatrics.
- Same rules as everyone (§5.1, §7.2): hockey-only criticism, facts from the sheet.

### 12.3 Weekly feature kinds (rotation)

1. **Trend column — Mara Quill:** the numbers across the last 4 weeks (per-week
   history added to the week sheet).
2. **Player spotlight — Talia Voss:** one named player with a milestone or the
   best week (that player's week and title numbers on the sheet).
3. **Notes column — Gord Pettibone:** 10–15 items about the week.
4. **Big-picture column — Lyle Bergstrom.**
5. **Father Rink**, now and then (his 14-day limit still applies).

### 12.4 Reporter mixing

The reporter who wrote last moves to the end of the queue — separately for game
recap posts and for night recaps — within the reporters that fit the situation.
Nobody writes two night recaps in a row. Mercer and Rink keep their limits.

### 12.5 Pile-on limit (operator)

At most one harsh piece about the same player per night. Each item records the
players it criticises harshly; later pieces that night get that list and must
take another angle on those players. The review step checks it.

### 12.6 Predictions and receipts (operator)

Every weekly feature ends with one short prediction about the next week, with no
numbers in it. The next weekly feature (any reporter) gets last week's
prediction and the new week's facts, and says in one or two sentences whether it
came true — only from the sheet. Predictions are stored with the feature.

### 12.7 Smaller decisions

- The Wire shows 10 posts at a time (was 20) — Claude's call, so it is closer to
  the stories column; easy to change.
- Fact-sheet fixes: game scores rounded as the site shows them; goals not
  accounted for by player rows count as unnamed goals; when milestones are capped,
  round numbers (100s, then 50s) and points first.
- The NHL 26 backfill is redone in this format, without the Claude API.

### 12.8 AI goalie coverage (operator, 2026-10-25)

Reporters may write about the AI goalies' performance — "what we are all
complaining about in the call". Supersedes the earlier rule that AI goalies get
no praise or blame.

- The AI goalies are named by their in-game names: **Matteo Lehmann** and
  **Jonas Wagner** (Claude's call: names over "the AI goalie").
- The game sheet gets the AI goalie's line when one played for the club: name,
  saves, shots against, goals against, save percentage. The week sheet gets the
  AI goalies' week totals.
- Praise and blame are allowed; facts only from the sheet. They are not
  teammates or members and are never called that.
- Press levels and the pile-on limit do not apply to them (not real people).
- The NHL 26 backfill uses this rule.

### 12.9 Less repetition of signature words (operator, 2026-10-25)

Reporters over-use their favourite words. Tone it down a bit:

- Each reporter's word list roughly doubles (typical words and phrases), and the
  voice text says to use one or two at most per piece and vary them.
- Code check: a post may use at most one of its reporter's signature words, an
  article at most three; above that the item goes back for a rewrite ("lean less
  on your signature words"). Limits are Claude's call.

### 12.10 Team norms (operator, 2026-10-25)

Repeated patterns must read as normal, not as news. Data check on 2026-10-25
(non-DNF games): the club is out-hit in about 62–65% of games, out-shoots
opponents in about 72–74%, and has more time on attack in about 77–80%.

- Every fact sheet gets a **norms** section for the current title, computed from
  the games before this one (game sheet) or before this night/week: the club's
  average and the opponents' average for hits, shots, time on attack, pass % and
  power play, and how often the club leads each one.
- Each game's numbers get a label against the club's own games: typical,
  unusually high or unusually low (Claude's call: outside the club's 20th–80th
  percentile = unusual); usual patterns are marked as held or broken (e.g.
  "out-shot for the first time in 6 games").
- Norms appear only from the 10th counted game of a title.
- Writing rule: typical patterns are not news. Mention them now and then as team
  identity; focus on what was different.
- A wider stored fact system (storylines, dossiers, GM facts) belongs to the bot
  project (see docs/planning/2026-10-25-news-desk-bots-notes.md).

### 12.11 Varied reporter interactions (operator, 2026-10-25)

The same reply pairs repeat. Make it weighted random:

- Any reporter may reply to any other. Pairs with a relationship in the
  character bible weigh about 3× the others; every other pair gets a short
  generic attitude so the reply has something to work from.
- A pair used recently weighs less for the next few replies (no repeats in a row).
- Whether a game gets a reply at all is a weighted chance: higher after overtime
  games, blowouts and big swings, lower after routine wins; about the agreed
  amount overall.
- Seeded from the game (and night), so reruns and tests are reproducible.
- Weights and the generic attitudes are Claude's call.

### 12.12 Content-quality rules from the backfill audit (operator, 2026-10-25)

An editor audit of all 138 backfill items found recurring problems. Operator
decisions:

1. **Colleague quotes are allowed** as second-hand talk; they need not match a
   published post. They are optional, not the standard ending (at most about one
   article in three ends that way).
2. **Winning fixes almost everything.** After a win, pieces read like a win; a
   player's big night (3+ goals or 5+ points) is credited first and never called
   luck, variance or unrepeatable. "Not repeatable" only about the team, at most
   once a night. Exception: Dex Mercer and Gord Pettibone are built to find
   something to complain about and keep their caveats.
3. **Games that ended early** (score not accounted for by credited goals, or
   time on attack under about 240 s, or under about 10 total shots) are marked
   `endedEarly`; pieces give them one neutral line with no shot, attack-time or
   conversion numbers.
4. **Plus-minus and game score** are not on the sheet for the writer and are
   never cited (game score still ranks the stars).
5. **Zero call-outs:** none for defencemen or goalies; at most one per night; never
   the same player on two nights in a row; penalty minutes only from 10 minutes,
   once a night. Each player's position per game goes on the sheet.
6. **Replies** argue with a number from the sheet; no remarks about the other
   reporter's motives, clicks or career (the bible jabs are blocked in replies).
7. **Number density:** at most 3 numbers per sentence, no lists of more than 3
   values, at most 2 clock times per article; an article does not open with the
   date and record; a one-game night gets 120–200 words; the night article sees
   that night's posts and reuses their numbers only to draw a new conclusion.
8. **No templates:** format labels ("The tactical point is…") are blocked; at most
   one "not X … Y" contrast per piece; posts make one point (the 4-part formats
   are for articles); each reporter sees their own last 5 pieces; Vale writes
   about more than overtime games.
9. **Headlines** name the night's one story; the record goes in the dek or body,
   once; the dek never repeats the headline; sentence case.
10. **Milestones:** tiered thresholds (points every 100, goals and assists every
    50, games at 100/250/500/…) and at most 3 per night, each in its own sentence,
    never a list.
11. **Style:** reporters are outside media and never write "we", "us", "our";
    scores winner first ("beat … 4-2", "lost to … 6-2"); one style for
    percentages ("83.1%") and for the record ("40-11-5").

What works and must stay: facts are accurate; guests/unnamed handled safely;
two reporters on one game pick different numbers; Quill's counter-voice; short
quotable lines that argue from one number.

### 12.13 Club lore (operator, 2026-10-25)

A short list of world facts every fact sheet carries, edited by asking Claude for
now (moves to the GM page with the bot project). First entry: **the Boogeymen's
farm team is the Oregon Outlaws.** Reporters may use a lore fact when it fits and
invent nothing around it (no Outlaws games, scores, call-ups or players). The
player storylines (Scoot, JoeyFlopfish, Joseph, Benson) wait for the storyline
system of the bot project (Claude's call; operator may override).

### 12.14 Buzz: how many reporters post about a game (operator, 2026-10-25)

Not all games are equal. A buzz score per game decides how many posts it gets
(supersedes §12.1's "one recap + sometimes a reaction" and §12.11's reply chance
for the number of posts; §12.11 still decides who replies to whom).

- Raises buzz: big margin / many goals; overtime, a comeback or late winner in the
  timeline; hat tricks and 5+ point nights; milestones; a long win/loss streak
  starting or ending; an AI goalie meltdown; a shutout; a club record.
- Lowers buzz: routine result; a game that ended early; patterns that are normal
  for the club (§12.10).
- Levels (operator approved the distribution; mean ≈ 2.1 posts per game):

| Level                    | Share of games (target) | Posts             |
| ------------------------ | ----------------------- | ----------------- |
| Quiet                    | ~50%                    | 1 (the recap)     |
| Normal                   | ~30%                    | 2                 |
| Big                      | ~15%                    | 3–5, with replies |
| Huge                     | ~4%                     | 6–8               |
| Historic (a club record) | ~1%                     | all 9 reporters   |

- The count within a level is a seeded weighted random draw (reproducible).
- Every extra post takes a different angle (recap, a player, a number, a reply,
  a joke); pile-on, zero call-out and signature-word rules still apply.
- Records: the sheet carries the club's season records (goals, assists, points
  per player per title, from all titles incl. historical stats) so "new club
  record" is detected from data.
- Score weights and level cut-offs are Claude's call, tuned so the NHL 26 and
  NHL 27 games land near the target shares.

### 12.15 More data-driven news hooks (operator, 2026-10-25)

1. **Player streaks and slumps:** points in N straight games, goals in N
   straight, no goal in N games (N ≥ 3 for runs, ≥ 8 for slumps — Claude's call).
   They go on the sheet and raise the buzz (§12.14).
2. **Rivalries and revenge games:** when the opponent has been played before in
   this title, the sheet carries the head-to-head record and the last meeting's
   score; reporters may frame a rematch.
3. **Debuts and returns:** a member's first game, a member's first game in a new
   title, or a return after 30+ days without a game is flagged on the sheet and
   gets a mention.
4. **Prediction scorecards:** each reporter's running record of judged
   predictions (hit / miss, decided by the receipt) is kept and may be quoted
   ("Quill is 4 for 7 this season").

Fan reactions driving buzz (operator's item 7) need the Discord bot and belong to
the bot project.

### 12.16 Expectation-based fact system (operator, 2026-10-25)

Every number on the sheet comes with "compared with what". Three layers: raw
facts (exist) → expectations (title so far AND last 10 games) → labels the
program computes; reporters get the labels ready-made and may only claim what a
label says (e.g. "career high", "slump", "upset").

- **Team:** result context label (rolling: win extending a win streak to 5+;
  blip: loss ending a win streak of 5+; slide: 3rd loss in a row; panic: 5th+
  loss in a row or 2-8 or worse in the last 10; turnaround: win ending a losing
  streak of 3+; normal); streak before and after; last-10 record; margin label
  against the club's usual margin (close / comfortable / blowout); surprise label
  from the club's win rate (expected / upset / big upset); the night's running
  context ("3rd loss of the night", "swept the night"); team milestones and
  season records (e.g. 100th win of the title, longest win streak of the season).
- **Players:** per-game averages in the title and the last 10 (from the 10th
  game), labels against the player's own normal (typical for him / big for him /
  quiet for him); season and career highs; form (last 5 vs season: heating up /
  cooling off); firsts (first goal of the season, first hat trick); coming
  milestones ("2 goals from 100") so reporters can build them up; position is
  always part of the comparison.
- **Use:** labels set the tone (the result label sets the mood; Mercer and
  Pettibone still complain), feed the buzz (§12.14), give extra posts their
  angles, and are enforced by the fact check (no drama a label does not support).
- Thresholds are Claude's call, tuned on the NHL 26 and NHL 27 data.

### 12.17 More fact-system parts (operator, 2026-10-25)

1. **Norms per game mode:** every norm, average and label (team and player) is
   computed within the same mode (3s or 6s).
2. **Fact ranking:** each fact gets an importance score from its labels; each
   piece gets its top 5 facts as "the story" and the rest as background; extra
   posts in a big game get different top facts.
3. **Open threads with reporter stances:** a label that persists over several
   nights (e.g. power play broken, a player's slump, losing to the same rival)
   opens a thread; reporters follow it and the thread closes with a story when
   the data changes. Reporters take stances on open threads; later pieces may
   say "I told you so" / "I was wrong". Stored, data-only (GM storylines come
   with the bot project).
4. **Line chemistry:** pair records from the site's existing pair/chemistry data
   ("with Silky and Erb together, 12-3") on the sheet for named players.

Dropped by the operator: division race, time-of-night patterns.

### 12.18 Review decisions on the consolidated spec (operator, 2026-10-25)

1. **Big games get articles too**, fewer than posts: Big → 1 game story; Huge →
   1 game story + 1 feature-style piece (spotlight or column); Historic → 2–3
   pieces (game story, spotlight, a column) plus the night recap. Quiet/Normal →
   none (the night recap covers them).
2. **6s matter more than 3s:** a 6s game gets a higher buzz weight; reporters hold
   opinions about the modes (e.g. Bergstrom: 6s is real hockey, 3s is shinny;
   Vale loves 3s chaos; Pettibone mocks 3s; Quill indifferent). Norms stay per
   mode (§12.17-1).
3. **Money:** plan for **$20 a month** (Console workspace limit and
   `NEWS_MONTHLY_LIMIT_USD`), from the Max plan's $100 monthly API credits; no
   card. Program stops at limit − $0.50.
4. **Reporter–player relationships ("beef", favourites, targets):** a reporter may
   hold a running take on a player. Pairings are chosen by the operator (pending),
   kept in a code list until the GM page exists (bot project). Fairness rules
   still apply (press levels, pile-on limit, hockey only).
5. **Language levels:** mild swearing ("hell", "damn", "crap") allowed for
   Mercer, Pettibone and Vale, mostly in The Wire; articles cleaner; the others
   clean; never slurs, never swearing aimed at a person; enforced by the review.
6. **All of Claude's suggestions accepted:** quality dashboard on /admin/news;
   rules version stored on every item; per-reporter on/off switch; big-game
   posts spaced a few minutes apart in Discord; language levels (above);
   correction posts after a deletion for a wrong fact (optional, same reporter);
   a short "how to read the Press Room" note on the reporter pages.

### 12.19 Reporter takes on players — GM-only lore (operator, 2026-10-25)

Reporters may hold running takes on players (a beef, a favourite, a target). The
operator wrote the first set. **The content is internal lore: never in git, never
on a public page or in Discord as a list, never visible to players.** Only the
coverage shows it, the way a columnist's grudge shows.

- Storage: database table `news_reporter_takes` (reporter, player, take text,
  spread: some / a few / most, critics, defender, data angle, active), readable by
  the news service and the admin only; edited on `/admin/news` (first piece of the
  GM page). Seeded by Claude at release from a private, git-ignored file.
- Each take has critics and a defender (a debate, not bullying), and a data angle
  the reporters use as evidence.
- Fairness: press levels apply ("Go easy" = mild, "Leave me out" = never used);
  each take at most about once a week per player; never two "weaker player" takes
  in one piece; pile-on limit and hockey-only rule apply; the review checks it.
- Takes soften or harden with the data over time (threads and stances, §12.17).
  With the bot project, a relationship score per reporter–player pair moves with
  interview answers and attitude.
- Privacy (operator-approved 2026-10-25): both policy pages say "We also send
  short notes written by the site's admin for the fictional coverage." No take
  is revealed. GM storylines of the bot project fall under the same sentence.
