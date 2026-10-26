# News Desk Bots — Discord Setup Runbook

## Purpose

Each news desk reporter becomes a Discord bot. This runbook shows how to create
the bot accounts, invite them to the server, and give the program their tokens.
Spec: `docs/superpowers/specs/2026-10-25-news-desk-bots-design.md`, section 8.

You do this one time, before the first trial night. It takes about 30 minutes.

## Cost

Prices come from `apps/discord/src/news/cost.ts` (model `claude-opus-5-5`):
input $4 per million tokens, output $20 per million tokens.

One call (6,000 input tokens, 300 output tokens, with the fact sheet):

- Input: 6,000 x $4 / 1,000,000 = $0.024
- Output: 300 x $20 / 1,000,000 = $0.006
- **One call = $0.030**

| Item                                                        | Calls     | Cost  |
| ----------------------------------------------------------- | --------- | ----- |
| One scrum (2 questions + 2 follow-ups, each write + review) | 4 x 2 = 8 | $0.24 |
| One GM note parse                                           | 1         | $0.03 |
| One reaction follow-up (one game post job: write + review)  | 2         | $0.06 |

Monthly (8 game nights):

- Scrums: 1 per night x 8 nights x $0.24 = **$1.92**
- GM notes: 2 per night x 8 nights x $0.03 = **$0.48**
- Reaction follow-ups: 4 per month x $0.06 = **$0.24**
- **New cost: about $2.64 per month**

The existing news desk costs about $8 to $10 per month. The total is about
**$10.60 to $12.60 per month**. The limit is $20 per month.

Check against a bad case: if every call costs double (long answers, retries),
the new cost is about $5.30 and the total is about $13.30 to $15.30. This is
still under $20.

The 80% rule (spec section 10): when the month's spend reaches $16, scrums and
reaction follow-ups stop first. Posts and night recaps continue.

## What you need

- A Discord account with "Manage Server" on the team server.
- The server `.env` on Hotel-Echo (`~/eanhl-team-website/.env`).
- 30 minutes of quiet. Do not paste tokens in chat or in git.

## The nine applications

Create **nine** applications. The name of each application must match exactly:

| Reporter id | Application name |
| ----------- | ---------------- |
| barlow      | Wade Barlow      |
| voss        | Talia Voss       |
| mercer      | Dex Mercer       |
| halberd     | June Halberd     |
| vale        | Rico Vale        |
| quill       | Mara Quill       |
| rink        | Father Rink      |
| pettibone   | Gord Pettibone   |
| bergstrom   | Lyle Bergstrom   |

There is no tenth "desk" bot. The slash commands (`/scrum` and the others) live
on the Wade Barlow application. The other eight applications have no commands.

## Step 1: Create the application (do this for each of the nine)

1. Open `https://discord.com/developers/applications`.
2. Click **New Application**.
3. Type the name from the table. Copy it exactly.
4. Accept the terms. Click **Create**.
5. On the **General Information** tab, click the app icon.
6. Upload the picture for this reporter. Download it first from
   `https://boogeymen.app/news/avatar/<id>`. Use the reporter id from the table.
   Example: `https://boogeymen.app/news/avatar/barlow`. Each picture is a
   256 x 256 PNG.
7. Click **Save Changes**.

## Step 2: Set up the bot (each application)

1. Open the **Bot** tab.
2. Check that the bot username is the reporter name. If not, change it.
3. Upload the same picture as the bot avatar. Click **Save Changes**.
4. Turn **Public Bot** off. Only you invite these bots.
5. Find **Privileged Gateway Intents**. Make sure all three are **off**:
   - **Presence Intent**: off
   - **Server Members Intent**: off
   - **Message Content Intent**: off

   This is true for all nine bots. The bots do not read chat. Players answer
   through a pop-up (modal), not in chat.

6. Click **Reset Token**. Click **Copy**. Put the token in a safe place for
   Step 4. Discord shows it one time only. If you lose it, click Reset Token
   again.

Reactions need reaction events. There is no switch for them in the portal. The
program turns on reaction events for Wade Barlow's bot itself. You do nothing.

## Step 3: Invite each bot to the server

1. Open the **OAuth2** tab. Click **URL Generator**.
2. Under **Scopes**, tick `bot` and `applications.commands`.
3. Under **Bot Permissions**, tick these seven:
   - View Channel
   - Send Messages
   - Send Messages in Threads
   - Create Public Threads
   - Read Message History
   - Add Reactions
   - Embed Links
4. Copy the **Generated URL** at the bottom. Open it in your browser.
5. Choose the team server. Click **Authorize**.

Shortcut: you can build the URL yourself. Replace `<APPLICATION_ID>` with the
**Application ID** on the General Information tab:

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=309237730368
```

The number `309237730368` is the sum of the seven permissions above. If the URL
generator shows a different number, use the one the generator shows.

After you invite all nine, the server member list shows nine new bots.

## Step 4: Put the tokens in the server `.env`

Connect to Hotel-Echo: `ssh hotel-echo`. Open `~/eanhl-team-website/.env`.
Add one line for each bot. The variable name is `PRESS_TOKEN_` plus the
reporter id in capital letters:

```
PRESS_TOKEN_BARLOW=
PRESS_TOKEN_VOSS=
PRESS_TOKEN_MERCER=
PRESS_TOKEN_HALBERD=
PRESS_TOKEN_VALE=
PRESS_TOKEN_QUILL=
PRESS_TOKEN_RINK=
PRESS_TOKEN_PETTIBONE=
PRESS_TOKEN_BERGSTROM=
```

Paste each token after the `=`. No quotes. No spaces. Do not commit this file.
Do not send a token in chat. If a token leaks, click **Reset Token** in the
portal and put the new token in the `.env`.

## Step 5: Copy the Discord IDs

1. In Discord, open **User Settings**, then **Advanced**.
2. Turn **Developer Mode** on.
3. Right-click the item below. Click **Copy ID** (or **Copy Server ID**,
   **Copy Channel ID**, **Copy User ID**).

| Variable                | What to right-click                               |
| ----------------------- | ------------------------------------------------- |
| `PRESS_GUILD_ID`        | The team server icon in the left bar              |
| `PRESS_TEST_CHANNEL_ID` | The bot test channel (only you are in it)         |
| `PRESS_LIVE_CHANNEL_ID` | `#chel`                                           |
| `PRESS_GM_USER_ID`      | Your own name in the member list (you are the GM) |

Add them to the same `.env`:

```
PRESS_GUILD_ID=
PRESS_TEST_CHANNEL_ID=
PRESS_LIVE_CHANNEL_ID=
PRESS_GM_USER_ID=
PRESS_MODE=trial
```

`PRESS_MODE` decides where the bots post. Only the exact value `live` makes the
bots post in `#chel`. Any other value, or no value, is trial mode: the bots post
in the bot test channel only, and every ping goes to the GM. Keep `trial` until
a trial night goes well. You change it to `live` yourself.

## Step 6: Check

- The server shows nine bots. They look offline until the program starts.
- Each bot has the right name and picture.
- In the portal, every bot shows all three privileged intents **off**.
- The `.env` has nine `PRESS_TOKEN_*` lines, four ID lines, and `PRESS_MODE`.
- The bot test channel lets all nine bots view it and send messages. Check the
  channel permissions if a bot cannot see it.

Do not start the bots yet. Follow the release checklist below.

## Problems

- **Invite link says "Integration requires code grant"**: on the **Bot** tab,
  turn **Requires OAuth2 Code Grant** off.
- **A bot cannot post in a channel**: open the channel settings. Give the bot's
  role View Channel, Send Messages, and Create Public Threads.
- **Token lost or leaked**: Bot tab, Reset Token, update the `.env`.

## Release checklist

Do these steps in order. Run all commands on Hotel-Echo (`ssh hotel-echo`, then
`cd ~/eanhl-team-website`). Docker is not on the main PC. Do the steps above
(nine bots, tokens, IDs) first.

Deploy from `main`, after the `feat/news-desk-bots` branch is merged. Do not
deploy from the feature branch. Run `git pull` on `main` first.

Replace `<date>` in the commands with today's date (`YYYY-MM-DD`).

0. **Approve the privacy text.** The new sentence about scrum answers is in
   `apps/web/src/content/legal/privacy.tsx` and `data-collection.tsx` (section
   "News posts written by an AI service"). It is a **draft**. Read it. Approve
   it, or change the words. Do this **before** you build the `web` image in
   step 3: the text goes to the site with that image. If you change the words
   later, rebuild and restart `web` again:

   ```
   docker compose build web
   docker compose up -d --no-deps web
   ```

1. **Check the compose file.** Run:

   ```
   docker compose --profile press config --services
   ```

   The list must include `press`. If it does not, stop: the compose file is not
   the new one.

2. **Take a fresh database backup.** Do this before the migration.

   ```
   docker exec eanhl-team-website-db-1 pg_dump -U eanhl -d eanhl -Fc > ~/eanhl-pre-press-<date>.dump
   ```

   Check that the file is not empty: `ls -l ~/eanhl-pre-press-<date>.dump`. The
   normal backup procedure is in `docs/operations/backup-producer.md`.

3. **Apply migration 0072 on the live database.** Do this before the new code
   runs. The command is in the header of the file. It is safe to run twice.

   ```
   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
     eanhl-team-website-db-1 psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
     < packages/db/migrations/0072_news_press.sql
   ```

4. **Rebuild the images.** Tag a rollback image first. Rebuild `web` as well:
   it holds the nickname list and the privacy text. `docker compose up -d`
   alone reuses the old image, so always build.

   ```
   docker tag eanhl-team-website-web:latest eanhl-team-website-web:rollback-he-<date>-pre-press
   docker tag eanhl-team-website-news:latest eanhl-team-website-news:rollback-he-<date>-pre-press
   docker compose --profile news --profile press build web news press
   docker compose --profile news --profile press up -d --no-deps web news press
   ```

   The `press` image is new, so it has no old version to tag. Check the logs:

   ```
   docker logs eanhl-team-website-web-1 --tail 20
   docker logs eanhl-team-website-news-1 --tail 20
   docker logs eanhl-team-website-press-1 --tail 20
   ```

5. **Trial night.** Leave `PRESS_MODE` unset (or `trial`) in `.env`. Play one
   game night. The bots post in the bot test channel only. Only you (the GM)
   are pinged.
6. **Read the trial.** Read the trial posts in the test channel and on
   `/admin/news`. Check the scrum questions, the answers, the nicknames and the
   spending. Delete anything wrong.
7. **Go live.** Check that the approved privacy text is on the site (the
   `web` image from step 4, or a later rebuild). Then set `PRESS_MODE=live` in
   `.env` and restart the two services:

   ```
   docker compose --profile news --profile press up -d --no-deps news press
   ```

   The bots now post in `#chel`.

## Rollback

If something goes wrong:

1. Stop the press bots:

   ```
   docker compose stop press
   ```

2. Remove `PRESS_MODE` from `.env` (or set it to `trial`).
3. Put the old images back and restart `web` and `news`. The news desk posts
   through the webhook again:

   ```
   docker tag eanhl-team-website-web:rollback-he-<date>-pre-press eanhl-team-website-web:latest
   docker tag eanhl-team-website-news:rollback-he-<date>-pre-press eanhl-team-website-news:latest
   docker compose --profile news up -d --no-deps web news
   ```

The migration stays. It does no harm. To undo it, use the rollback SQL in the
header of `packages/db/migrations/0072_news_press.sql`.
