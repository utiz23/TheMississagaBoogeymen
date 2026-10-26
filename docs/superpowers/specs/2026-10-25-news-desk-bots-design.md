# News Desk bots — Design (release 1: reporter bots, post-game scrums, quotes)

**Status:** approved by the operator 2026-10-26. Build plan after `feat/news-desk` merges to `main` (§9).
**Scope:** release 1 of the bot project (news desk design §10). Later parts are in
§11 as notes only; each gets its own design.
**Builds on** (these files are on branch `feat/news-desk` until it merges):

- `docs/superpowers/specs/2026-10-25-news-desk-reporter-system.md` — the
  reporter system as built (cast, fact sheet, buzz, safety pipeline). This design
  does not repeat it.
- `docs/superpowers/specs/2026-10-24-news-desk-design.md` §10, §12.19.
- `docs/planning/2026-10-25-news-desk-bots-notes.md` — the earlier bot notes.
  Where they disagree with this document, this document is the current decision.

Marks: **operator** = decided by the operator · **Claude's call** = decided by
Claude, the operator can change it · **builder** = left to the builder.

## 1. Intent

The news desk writes about the Boogeymen as if they were a pro team. Release 1
lets the players **take part**: after a game, a reporter asks a player one or two
questions in Discord, the player answers, and the answers appear as quotes in the
night recap. The operator, as **GM**, steers it from behind the scenes: they can
tell the reporters about a play the stats cannot show and make the questions
bolder or softer.

Why: the stats pages give the numbers and the desk already turns them into
stories. Quotes from the players themselves make the stories the team's own.
The GM notes put real plays (a giveaway, a goal of the year) into the coverage,
which EA data cannot do.

Readers and players: a handful of teammates. **Few players will take part**
(operator). The design must work well when nobody answers.

## 2. Goals, non-goals, anti-goals

**Goals (release 1)**

1. The nine reporters are real Discord bots (own name, picture, place in the
   member list). All news desk posts come from the bots, not from the webhook.
2. After each game, players can do a short **scrum** (1–2 questions plus
   follow-ups) with a reporter.
3. Answers become **quotes** in the night recap.
4. **GM notes:** the GM types a short private note about a play; reporters ask
   about it and write about it.
5. **Heat:** the GM can make the questions bolder or softer.
6. **Fan reactions:** a post that gets many reactions gets a follow-up post from
   another reporter (operator: in release 1).

**Non-goals (release 1)**

- No OCR data. Questions use only what the EA data and the fact sheet show
  (operator: "the basic one with just EA data, then advanced").
- No in-depth interviews, no dossiers in the database, no joke filter for
  dossier facts, no GM storylines, no relationship scores (§11).
- No anytime conversations with reporters.
- No intermission scrums.
- No voice. Text only.

**Anti-goals: a failure even if it technically works**

- **Unwanted pings.** A player who gets pinged after every game, or more than
  once a night without a reason. Only big games and GM notes ping (§4.2).
- **Reading the team's chat.** The bots process only messages in their own
  scrum threads. They never store, read for content, or send to the AI any other
  message.
- **A scrum that blocks anything.** Ingestion, the game-result posts, the unlock
  posts and the news desk's normal posts never wait on a scrum. Only the night
  recap waits, and only for a limited time (§5.3).
- **Invented or twisted quotes.** A quote that says more than the player said,
  or the opposite.
- **The GM is exposed.** A reporter says or hints that a tip came from the GM.
- **Hurting a teammate.** Questions or follow-ups about real life, looks, work
  or health; criticism of a "Go easy" player; any mention of a "Leave me out"
  player.
- **Cost that runs away.** Conversations are many small AI calls.

## 3. Decisions

| Decision              | Choice                                                                                                             | By                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Order                 | Bots first, then scrums, then quotes                                                                               | operator                             |
| Channel               | Everything in `#chel` (the website channel); tested first in the bot test channel; `#press-room` is no longer used | operator                             |
| Scrum trigger         | A scrum is open after every game; a player is **pinged** only after a big game or a GM note                        | operator                             |
| Who is picked         | One player, from game score and story importance; others can volunteer                                             | operator                             |
| Consent               | A scrum happens only if the player accepts; ignoring = no                                                          | operator                             |
| Accept window         | About 5 minutes; no accept = no scrum                                                                              | operator                             |
| Questions             | 1–2 questions plus follow-ups, by a reporter the system picks                                                      | operator                             |
| Quotes                | Paraphrase allowed                                                                                                 | operator                             |
| Quote withdrawal      | Not needed (operator does not care); the admin can still delete any item                                           | operator                             |
| Night recap           | Waits for the night's scrums                                                                                       | operator                             |
| Data                  | EA data only in release 1                                                                                          | operator                             |
| GM workplace          | Setup on `/admin/news`; live controls as private Discord commands                                                  | operator                             |
| Budget                | Stay inside the news desk's $20 a month                                                                            | operator                             |
| Anytime conversations | Later                                                                                                              | operator                             |
| Open scrum = button   | A "Talk to the press" button on the game's recap post, not a separate message                                      | Claude's call                        |
| Paraphrase limit      | A quote may be shortened or reworded, never added to                                                               | Claude's call                        |
| Heat                  | Three levels: Cool / Normal / Hot (§6.2)                                                                           | Claude's call (operator agreed idea) |
| One program           | One program runs all nine bots, on Hotel-Echo                                                                      | Claude's call                        |

## 4. The scrum

### 4.1 Flow (operator)

game ends → game processed → one player picked (game score + story importance) →
other players can volunteer → the picked player accepts within ~5 minutes → the
system picks a reporter → 1–2 questions and follow-ups → end → quotes go into the
night recap.

### 4.2 The open scrum and the ping

- Every game's recap post (the first Wire post about the game) has a
  **"Talk to the press"** button (Claude's call). On a quiet game, nobody is
  pinged. Anyone who played in the game can press the button and volunteer.
- **A ping** goes to one player only when (operator):
  - the game is **Big, Huge or Historic** on the buzz scale (reporter system
    §3.1), or
  - the GM asks for that player in a GM note ("ask him about it", §6.1).
- The ping is a short reply under the recap post, from the reporter who will ask:
  "@Raz — Dex Mercer has a question about that goal." It has an **Accept**
  button. Wording: builder, in the reporter's voice.
- **Accept window:** about 5 minutes (operator). After that, the button stops
  working for the pinged player and nothing more happens. No reminder, no second
  ping.
- **Open button closes (Claude's call):** the "Talk to the press" button works
  for 60 minutes after the recap post. The night ends 90 minutes after the last
  game, so a late volunteer rarely makes the night recap wait.
- **Ping limit (Claude's call):** at most 2 pings per player per night from big
  games. GM notes are not limited, but the GM gets a private warning after the
  second ping of the night for the same player.
- **Never picked or pinged:** players on "Leave me out"; guests (non-members);
  the AI goalies; players without a linked Discord account (§8.3).

### 4.3 Who gets picked

- On a big game: the player with the strongest story — the top player fact on
  the fact sheet (fact ranking, reporter system §4.4), with game score as the
  tie-break (operator: "game score and story significance").
- A GM note that asks for a player wins over the automatic pick.
- **builder:** the exact scoring, within these rules.

### 4.4 The conversation

- The scrum runs in a **thread under the recap post** (Claude's call), so
  players can answer from a phone between games.
- The picked player gets **1–2 questions**. After each answer the reporter can
  ask **one follow-up** (Claude's call: at most 2 follow-ups per player per
  scrum). Volunteers get 1 question and at most 1 follow-up.
- **Answer window (Claude's call):** about 15 minutes for each question. No
  answer = the reporter closes politely ("Fair enough — next game.") and the
  scrum ends for that player. The next game starting does not end a scrum.
- Questions use the game's fact sheet, the GM notes and the reporter's voice and
  takes. They follow all writing rules of the reporter system (§6), including
  "hockey only".
- **Joke answers:** the reporter reacts in character (some play along, some get
  annoyed) — from the earlier notes (operator). A joke answer may be quoted as
  a joke, never stated as a fact ("says they were 'saving energy for the
  playoffs'", not "they were saving energy").
- **Answers that cannot be used** (about real life, abusive, about a "Leave me
  out" teammate, or empty): the reporter moves on without repeating them; they
  are not quoted. **builder:** how to detect them.
- **Answer input — builder:** thread replies or a pop-up text box. Rules: it must
  work on a phone; only answers inside the scrum count.
- **One reporter per scrum.** The system picks the reporter from the heat
  (§6.2), the rotation and limits of the reporter system (§5), and any active
  reporter take on that player (§12.19). Father Rink does not do scrums
  (Claude's call: he is rare on purpose).

### 4.5 The `/scrum` command

From the earlier notes (operator), fitted to this flow (Claude's call):

- `/scrum` — the player volunteers for the latest game they played in (same as
  the button).
- `/scrum random` — the system picks a teammate who played in the latest game and
  pings them (same rules as §4.2: accept window, never "Leave me out").
- `/scrum @player` — pings that teammate. Ignoring it = no (operator).
- `random` and `@player` count toward the ping limit. A player cannot use them
  more than twice a night (Claude's call), so the command does not become a way
  to spam a teammate.

## 5. Quotes

### 5.1 Storage

Each answer is stored with: the scrum, the game, the player, the question, the
answer text, and a usability flag (usable / joke / not usable). Answers are kept
like the other news desk records. **builder:** table design, within the
hand-written migration rule (§9).

### 5.2 Use

- Quotes go into the **night recap**. Later pieces of the same week (features)
  may use them too (Claude's call).
- **Paraphrase** is allowed (operator); a quote may be shortened or reworded but
  never get new content (Claude's call). The quote is marked as the player's
  words in the story ("said", "told Dex Mercer").
- **Checks:** the code checks that every quote in a piece points to a stored,
  usable answer of that player. The review step (reporter system §7, step 4)
  compares each quote with the real answer and fails the piece if the quote adds
  to it or changes its meaning.
- This replaces the old rule "no quotes from teammates" with: "**quotes from
  teammates only from their stored scrum answers**". Invented teammate quotes
  stay forbidden.

### 5.3 The night recap waits

- The night ends about 90 minutes after the last game (as built). Scrums of the
  last game end long before that in normal cases.
- If a scrum is still open when the recap is due, the recap waits until it ends,
  **at most 30 minutes** (Claude's call). Then it is written with the quotes it
  has.

## 6. GM controls

### 6.1 GM notes ("ask about this play")

Examples from the operator:

- "beav had a really bad give away right up the middle, ask him about it"
- "Raz had a goal of the year candidate"
- "homiecide was forced to play defense again (he does not want to)"

Rules (playback confirmed by the operator):

- The GM types a **free-text note** in a private Discord command (only the GM
  can use it and see the reply). No forms.
- The system **finds the player** from the nickname. The private reply shows
  which player and which game it found; the GM can correct it. The note goes to
  the latest game unless the GM names another one.
- **Alias list (Claude's call):** nicknames are kept in a GM-only list (for
  example "beav", "raz", "homiecide"). When the GM corrects a match, the
  nickname is saved for next time. The list is editable on `/admin/news`.
- A note is a **trusted fact** — the only way real plays enter the coverage.
  Reporters may use it in the scrum, the night recap and later features
  (Claude's call). Not in the game's own Wire posts: those are written within a
  few minutes of the game, before a note from the lobby arrives, and the Wire
  cycle does not wait for notes.
- A note that asks to ask a player ("ask him about it") pings that player (§4.2)
  and makes that player the pick for that game's scrum.
- A note that describes a running theme ("forced to play defense again") is also
  offered to the GM as a candidate for a later storyline or dossier fact. In
  release 1 it is only saved for later (§11).
- **The source stays hidden.** Reporters write as if they saw the play. Never
  "I'm told", never the GM's name as the source.
- **Fairness:** a note about a "Leave me out" player is not used; the GM is told.
  A **critical** note about a "Go easy" player is not used, because "Go easy"
  means no criticism (as built); the GM is told. A positive note is used. The
  pile-on limit counts GM notes too.
- GM notes are sent to the AI service. The privacy pages already cover "short
  notes written by the site's admin for the fictional coverage" (approved
  2026-10-25).

### 6.2 Heat (Claude's call)

The operator wants "a little more bold in the questioning". Three levels:

- **Cool:** friendly questions, start from what went well. Voss, Barlow and
  Bergstrom are more likely to ask.
- **Normal:** the default.
- **Hot:** bolder questions. The reporter names the bad moment directly ("That
  giveaway up the middle — what happened?") and asks a pointed follow-up. Mercer,
  Pettibone and Vale are more likely to ask.

The GM sets the heat in a private command (or inside a note: "hot") for the next
scrum or for the whole night. Hot is bolder, not meaner: "hockey only" and
"never the person" stay. Press levels win: a "Go easy" player never gets Hot,
and the GM is told.

### 6.3 Who is the GM

The GM is one Discord account set in the configuration (the operator, Silky).
Only that account can use the GM commands. The GM also plays, so they can be
picked for a scrum like any player.

## 7. Fan reactions (operator: release 1)

- When a reporter post or article in `#chel` gets reactions from **at least 3
  different people** (Claude's call; any emoji), another reporter posts a
  follow-up reply about the same game or piece.
- At most one follow-up per post and at most 2 per night (Claude's call). It
  goes through the same writing and safety pipeline as every post.
- Reactions on the bot test channel count only in test mode.

## 8. The bots

### 8.1 Accounts and program

- Nine reporter bots, one Discord application each (decided in news desk §10).
  The operator creates them in the Discord developer portal; the builder writes
  the step-by-step instructions (create, name, picture, permissions, intents,
  invite, token).
- **builder:** whether slash commands and buttons live on one of the nine bots or
  on a tenth "desk" bot. The operator instructions must name the final number.
- One program runs all bots (Claude's call), on Hotel-Echo. Bot tokens go in the
  server `.env` only, never in git or chat.

### 8.2 Moving from the webhook to the bots

- All news desk posts (Wire posts, night recap and feature links, correction
  posts) are sent by the reporter's own bot instead of the webhook.
- Delete from `/admin/news` must work for both: old webhook messages and new bot
  messages.
- Items already posted in `#press-room` stay there; nothing is moved.
- **Game-result and unlock posts:** they are not news desk posts and keep their
  own webhook. If their channel is not `#chel` today, moving them is only a
  webhook setting (operator step).

### 8.3 Discord accounts of players

The site already links players to Discord: through the Discord sign-in, or a
Discord ID entered on `/admin` (`players.discord_user_id`, used by the unlock
pings). The bots use the same link. A player without a link cannot be pinged;
when they press the button, the bot can still recognise them if their sign-in is
linked. **builder:** what to tell an unlinked player who presses the button.

### 8.4 Test mode

- The bots first run in the **bot test channel** (operator). Every action is
  real in Discord (buttons, threads, pings), but only in that channel.
- **During the trial the news desk stays as it is (Claude's call).** If it is
  live through the webhook by then, it keeps posting there. The bots post a
  **copy** of the same items in the bot test channel, with the scrum buttons.
  No second set of AI writing calls; only the scrums cost extra. The test/live
  setting splits in two: "news desk live" (as built) and "bots live" (where the
  bots post, and whether the webhook stops).
- **Who is pinged in the trial (operator, 2026-10-26):** only the operator is
  in the bot test channel, and every trial ping goes to the operator, whatever
  player the system picked. No teammate is pinged before the switch to `#chel`.
- **During the trial the bots ping only the GM** (operator). The pick runs as in
  live. If it picks another player, the ping goes to the GM, marked "test —
  would ping <player>", and the GM answers in that player's place. Only the GM
  can accept, volunteer or use `/scrum` in the trial.
- Scrum answers and GM notes from the trial are marked test. They are not used
  in public pieces.
- Switching to `#chel` is a setting, done by the operator after a trial night.
- The existing rule stays: anything but an explicit "live" setting means test
  mode (fail closed).

## 9. Constraints from the existing system

- The news desk lives in `apps/discord/src/news/` (branch `feat/news-desk`).
  This project builds on it after it merges to `main`. Do not start building
  before that. Write the build plan against the merged `main`, not against the
  branch while it still changes (Claude's call).
- **Isolation:** a bot crash, a Discord gateway outage or a reconnect loop must
  never stop or delay ingestion, the game-result cycle, the unlock cycle or the
  news desk's normal writing. **builder:** own container or not, with this rule.
  Claude's suggestion: own container, because a long-lived gateway connection
  fails differently from the poll loops.
- **Migrations:** hand-written idempotent SQL, applied with psql, rollback steps
  in the header; the verification database needs each new migration too.
- Production is Hotel-Echo; deploy and roll back with image tags as earlier
  Discord releases. The containers run in UTC; show dates in America/Edmonton.
- Repo checks: typecheck, tests and prettier are the green gates; `pnpm lint` is
  already red repo-wide.
- **Message content:** if answers are thread replies, the bots need Discord's
  message content permission. They must still ignore every message outside their
  own open scrum threads (anti-goal "reading the team's chat").

## 10. Safety, privacy and cost

- **Every question and follow-up** follows the reporter system's writing rules
  and fact rules. **builder:** how much of the full check pipeline a live
  question goes through (a 3-write retry is too slow for a conversation). The
  rule: no invented numbers, events or quotes; hockey only; press levels.
- **Privacy text (needs operator approval):** the policy pages must add that
  answers players type in a scrum are stored and sent to the AI service to
  write questions and stories. The builder drafts it; the operator approves it
  before release.
- **Cost:** scrums share the $20 a month (operator). Claude's call: when the
  month's spend reaches 80% of the limit, scrums and fan-reaction follow-ups stop
  first, so the posts and night recaps continue. **builder:** first step is a
  cost estimate per scrum and per month (about 8 game nights a month); report it
  to the operator.

## 11. Later parts (notes only — each gets its own design)

Order and content from the operator:

1. **Advanced scrums** with OCR detail (needs the sister repo's live engine).
2. **Interviews:** longer, in-depth, one reporter and one player, accepted or
   ignored; their purpose is to fill the dossier.
3. **Dossiers:** facts about players, past and present; **GM only** (players never
   see their own); filled by the GM and by interviews. Builds on
   `docs/specs/player-dossiers/`.
4. **Joke filter:** facts from answers go to a GM approval list (approve /
   reject / joke) before they enter a dossier.
5. **GM storylines:** real life as hockey drama ("LTIR", "rehab in China",
   "semi-retired"). The player does **not** need to know (operator). Claude's
   guards (operator may remove): always told in hockey terms, never a hint at the
   real reason; no storyline for "Leave me out" players.
6. **Relationship scores** per reporter–player pair, moved by answers.
7. **Anytime conversations** and **intermission scrums**.

GM notes saved in release 1 as "running theme" candidates are the first input
for parts 3 and 5.

## 12. Left to the builder

- Program structure, container, and how the bots share the news desk code.
- Table design for scrums, answers, GM notes, aliases, heat and reactions.
- Pick scoring (§4.3), answer input (§4.4), unusable-answer detection (§4.4).
- Slash commands on one bot or a tenth bot (§8.1).
- How much of the check pipeline live questions go through (§10).
- Exact message wording, in the reporters' voices.

## 13. Success

- On a normal game night, at least one scrum happens when a player wants one,
  and the night recap has a real quote.
- Nobody gets pinged more than the rules allow; nobody is pinged on a quiet game
  without a GM note.
- No quote says more than the player said.
- The GM can put a play into the coverage in under a minute from the lobby.
- Game-result posts, unlock posts and data collection work exactly as before.
- The month stays under $20.
