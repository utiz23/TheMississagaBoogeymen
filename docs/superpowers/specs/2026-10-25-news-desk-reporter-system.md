# The Boogeymen News Desk — reporter system (consolidated spec for review)

**Status:** review copy, 2026-10-25. It collects every decision made so far in one
place. The detailed design history stays in
`docs/superpowers/specs/2026-10-24-news-desk-design.md` (§1–§11 = version 1,
§12 = revision 2). Where the two disagree, this document shows the current
decision. Marks: **[built]** done and reviewed · **[building]** in progress ·
**[planned]** agreed, not started · **[later]** bot project · **[suggested]**
Claude's new suggestion, not agreed yet.

---

## 1. What it is

Nine fictional sports reporters cover the Boogeymen as if they were a pro team.
They post short takes ("tweets") in The Wire, write a recap after each game
night and one longer feature each week. Everything is posted automatically to
the `#press-room` Discord channel and kept on the site's News pages.

The point is fun and identity: the stats pages already give the numbers; the
desk turns them into stories the team recognises — including the complaining
everybody does in the call.

Readers: the teammates. Taking part is optional; the channel can be muted.

## 2. The cast (9 reporters)

All reporters are fictional. The two newest are inspired by Canadian hockey-media
styles but never use or imitate real people's names or catchphrases.

| Reporter           | Outlet                | Personality                                                                                                                  | Main work                                          |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Wade Barlow**    | Boogeymen Beat        | The beat reporter. Relentless, never impressed, practical; notices line changes and structure. Short paragraphs, hard verbs. | Game recaps, night recaps                          |
| **Talia Voss**     | North Line Features   | Feature writer. Human, observant: trust, nerves, belief, identity. Reflective, never cheesy.                                 | Player spotlights, emotional nights                |
| **Dex Mercer**     | Glass & Static        | Columnist who stirs the pot. Asks the uncomfortable question; quotable; built to always find something to complain about.    | Takes after losses, replies; limited (see §5)      |
| **June Halberd**   | The Tape Delay        | Systems analyst. Calm, precise, low drama; explains the game from what the numbers show.                                     | Swing / close nights, number breakdowns            |
| **Rico Vale**      | After the Horn        | Hot-mic personality. Loud, theatrical, all momentum.                                                                         | Overtime, wild swings, big nights, reactions       |
| **Mara Quill**     | Ledger Sports         | Numbers columnist. Dry, sceptical, data first — the cold shower after an emotional result.                                   | Trend column, counter-voice                        |
| **Father Rink**    | Midnight Sports Radio | Mythic late-night host. Strange, poetic, weirdly wise. Rare on purpose.                                                      | Very big or very bad nights, an occasional feature |
| **Gord Pettibone** | The Daily Slapshot    | Big-market tabloid columnist. Blunt, polarising, never apologises, loves a list; built to complain.                          | Notes column, hot takes                            |
| **Lyle Bergstrom** | Big Country Hockey    | Senior writer who has seen it all. Plain-spoken, old-school (compete, character), fair, long view.                           | Big-picture column, verdicts after big nights      |

**Relationships** (they drive replies, §5.3): Barlow thinks Mercer is a fraud
with good timing, Mercer thinks Barlow is jealous of the clicks; Voss finds
Mercer exhausting but admits he asks what everyone avoids; Halberd respects
Quill; Vale enjoys annoying Halberd; Quill thinks Vale is noise but admits he
understands momentum; Rink treats everyone as temporary caretakers of a larger
myth; Pettibone mocks Quill's spreadsheets and Quill fact-checks him; Pettibone
and Mercer compete for outrage; Bergstrom respects Barlow and has no patience for
Vale's theatrics. Every other pair gets a generic attitude (rival, sparring
partner, …).

**Voices:** each reporter has a way of writing and a set of typical words and
phrases (about twice as many as in the original character bible), used one or
two at a time and varied **[planned]**.

**Pictures:** coloured letter badges for now (dark initials on all nine colours)
**[built]**; real drawn pictures can replace them at any time **[later]**.

## 3. What gets written

### 3.1 The Wire (short posts, ≤ 280 characters)

- After every counted game, the **recap post**: result, score, who scored, one
  key number (timeline facts when available) **[built]**.
- **Buzz decides how many reporters post** about a game **[planned]**:

| Level    | Share of games (target) | Posts             | Example                                 |
| -------- | ----------------------- | ----------------- | --------------------------------------- |
| Quiet    | ~50%                    | 1 (the recap)     | routine win                             |
| Normal   | ~30%                    | 2                 | close game, an upset                    |
| Big      | ~15%                    | 3–5, with replies | an 11-2, a 5-point night, a career high |
| Huge     | ~4%                     | 6–8               | a milestone night, an overtime comeback |
| Historic | ~1%                     | all 9             | a new club record                       |

Mean ≈ 2.1 posts per game. The exact count within a level is a seeded random
draw. Every extra post takes a different angle (a player, a number, a reply, a
joke, the big picture), using a different top fact (§4.4).

- **Big games also get articles**, fewer than posts **[planned]**: Big → 1 game
  story; Huge → 1 game story + 1 spotlight or column; Historic → 2–3 pieces plus
  the night recap.
- **6s games weigh more than 3s** in the buzz; reporters have opinions about the
  modes (Bergstrom: 6s is real hockey, 3s is shinny; Vale loves 3s chaos;
  Pettibone mocks 3s; Quill does not care) **[planned]**.
- **Replies** between reporters: weighted random, not fixed pairs (§5.3).
- Posts of a Big or Historic game are **spaced a few minutes apart** in Discord
  **[planned]**.
- Games that **ended early** get one neutral line, no stats **[built: detection;
  planned: writing rule]**.
- DNF games get no posts.

### 3.2 Night recap (article, after each game night)

- Written about 90 minutes after the night's last game **[built]**.
- 250–450 words; a one-game night gets 120–200 words **[planned]**.
- It sees the night's posts and reuses their numbers only to draw a new
  conclusion **[planned]**.
- Discord gets the headline, a one-line summary and a link **[built]**.

### 3.3 Weekly feature (article, Mondays from 12:00, if the week had a game)

- 600–900 words **[built]**. Kinds rotate **[built]**:
  - **Trend column** — Mara Quill: numbers over the last 4 weeks.
  - **Player spotlight** — Talia Voss: a player with a milestone or the best week.
  - **Notes column** — Gord Pettibone: 10–15 short items.
  - **Big-picture column** — Lyle Bergstrom.
  - **Father Rink** now and then.
- Every feature ends with one **prediction** (no numbers). The next feature
  says whether it came true (**receipt**, restating the prediction) **[built;
  restating planned]**.
- **Prediction scorecards** per reporter ("Quill is 4 for 7") **[planned]**.

### 3.4 Not built yet

- Monthly awards, dry-spell posts, season previews/reviews — discussed, not
  chosen for now.
- Interviews, scrums and GM storylines — the bot project (§10).

## 4. The fact system

The reporters may use only facts from a **fact sheet** the program builds for
each game, night or week. The sheet uses the same data and calculations as the
match pages, so a story never disagrees with the site.

### 4.1 Raw facts **[built]**

- Score, result, overtime, opponent club; team stats (shots, hits, time on
  attack, passing, power play); each named player's line (goals, assists,
  points, shots, hits, position F/D/G); the three stars.
- **Goal timeline** where reviewed data exists: period, clock (elapsed, 20-minute
  periods incl. overtime), who scored and assisted for the club; opponents'
  goals without names.
- **AI goalie line** (Matteo Lehmann, Jonas Wagner): saves, shots against, goals
  against, save %. They are not teammates; praise and blame allowed.
- Title record, current streak, recent nights, card unlocks, round-number
  milestones (points every 100, goals and assists every 50, games at
  100/250/500/…; at most 3 per sheet).
- **Club lore:** "The Boogeymen's farm team is the Oregon Outlaws." Nothing may
  be invented around a lore fact.
- **Ended early** flag (score not explained by the credited goals, or under
  about 240 s of attack time, or under about 10 total shots): team stats removed.
- Plus-minus and game score are **not** on the writer's sheet (game score still
  ranks the stars).

### 4.2 Expectations: "compared with what?"

Every number is compared with the club's or the player's own normal — over the
**title so far** and the **last 10 games** — and always **within the same game
mode (3s or 6s)**.

- **Team norms [built; per-mode planned]:** averages and how often the club leads
  for hits, shots, time on attack, passing and power play; per game "typical /
  unusually high / unusually low", and patterns held or broken ("the Boogeymen
  were out-hit for the 4th game in a row"). From the 10th game of a title.
- **Team context [planned]:**
  - Result label: rolling, blip, slide, **panic**, turnaround, normal.
  - Streak before and after; last-10 record.
  - Margin label (close / comfortable / blowout) against the club's usual margin.
  - Surprise label (expected / upset / big upset) from the club's win rate.
  - The night so far ("3rd loss of the night", "swept the night").
  - Team milestones and season bests ("100th win of the title", "longest win
    streak of the season").
- **Player norms [planned]:** per-game averages (title and last 10); labels
  "typical for him / big for him / quiet for him"; season and career highs;
  form (heating up / cooling off); firsts ("first goal of the season"); coming
  milestones ("2 goals from 100"). Position always counts (a defenceman's
  0 shots is not news).
- **Streaks and slumps [planned]:** points or goals in N straight games; no goal
  in N games; a run ending.
- **Rivalries [planned]:** head-to-head record and the last meeting.
- **Debuts and returns [planned]:** first game for the club or in a title; back
  after 30+ days.
- **Club records [planned]:** single-season records across all titles; a new
  record makes a game Historic. Boogeymen games only (operator decision
  2026-10-25): a title with stored games (NHL 26 and later) counts those games;
  NHL 22–25 count the club archive that the Stats page shows. Player-card
  totals from other clubs and EA's member totals are not used.
- **Line chemistry [planned]:** records of pairs who played together ("Silky and
  Erb together: 12-3").

### 4.3 Labels are binding

A reporter may call something a "career high", "slump", "upset", "panic",
"first … of the season" or "record" only when the sheet's label says so. Drama
that the labels do not support is rejected like an invented number.

### 4.4 Fact ranking **[planned]**

Every fact gets an importance score from its labels. Each piece gets its top 5
facts as "the story" and the rest as background. Extra posts on a big game take
different top facts. This keeps pieces focused and prompts short.

### 4.5 Open threads and reporter stances **[planned]**

A label that persists over several nights (power play broken, a player's slump,
losing to the same rival, a long streak) opens a **thread**. Reporters follow it
and take **stances** (Quill: "the scoring rate cannot last"; Bergstrom: "it can").
When the data changes, the thread closes with a story — and reporters may say
"I told you so" or "I was wrong". Threads come from data only; GM storylines come
with the bot project.

## 5. Who writes what

### 5.1 Rotation **[built]**

The reporter who wrote last moves to the end of the queue — separately for
recap posts, night recaps and features — among the reporters that fit the
situation. Nobody writes two night recaps in a row. Father Rink is kept for
nights and features, not game posts **[planned]**.

### 5.2 Limits **[built]**

- Dex Mercer: at most once a night and 3 times in 7 days.
- Father Rink: at most once in 14 days.
- Limits are waived for a Historic game (all nine post) **[planned]**.

### 5.3 Interactions **[planned]**

Any reporter can reply to any other. Pairs with a written relationship are about
3× as likely; a pair used recently is less likely; whether a game gets replies is
a weighted chance (higher after overtime, blowouts and swings). Replies must
argue with a number from the sheet — no remarks about the other reporter's
motives, clicks or career.

## 6. Writing rules

### 6.1 Facts and quotes

- Numbers, names and clubs only from the sheet **[built]**.
- No invented events, plays, moods or off-ice scenes (crowds, group chats, the
  locker room) **[built]**.
- No invented quotes from **teammates**. Reporters may quote each other, also
  second-hand ("Quill called it variance"); this is optional, not the standard
  ending **[built; optional planned]**.

### 6.2 Tone

- **Winning fixes almost everything.** After a win the pieces read like a win;
  a big individual night (3+ goals or 5+ points, or "big for him") is credited
  first and never called luck. "Not repeatable" only about the team, once a
  night. Dex Mercer and Gord Pettibone keep their caveats **[planned]**.
- The result label sets the mood: a blip gets a shrug, panic gets panic
  **[planned]**.
- Typical patterns are not news; they appear now and then as team identity
  **[planned]**.
- Criticism is about hockey only — never real life, looks, work or health
  **[built]**.

### 6.3 Fairness to teammates **[planned unless marked]**

- Press levels on EDIT PROFILE: Full press (everyone's start), Go easy, Leave me
  out **[built]**.
- Pile-on limit: at most one harsh piece about the same player per night
  **[built]**.
- Zero call-outs ("0 shots"): never for defencemen or goalies, at most one per
  night, never the same player two nights in a row.
- Penalty minutes only from 10 minutes, once a night.
- Unnamed teammates ("Leave me out") are never named, hinted at or singled out
  **[built]**.
- **Reporter takes on players** (a running beef, a favourite, a target):
  written by you as GM; **internal lore — never in git, never shown to players**,
  only visible through the coverage. Each take has critics and a defender and a
  data angle; press levels apply ("Go easy" = mild, "Leave me out" = none); at
  most about once a week per player; takes soften or harden with the data, and
  later with interview answers (relationship score, bot project). Stored in the
  database, edited on `/admin/news` **[planned]**.
- **Language:** mild swearing ("hell", "damn", "crap") only for Mercer, Pettibone
  and Vale, mostly in The Wire; articles cleaner; never slurs, never swearing at a
  person **[planned]**.

### 6.4 Craft **[planned]**

- At most 3 numbers per sentence; no lists of more than 3 values; at most 2 clock
  times per article.
- Articles never open with the date and record.
- Headlines name the night's one story; the record goes in the summary line,
  once; sentence case; the summary line never repeats the headline.
- Milestones each in their own sentence, never a roll call.
- No format labels ("The tactical point is…"); at most one "not X, Y" contrast
  per piece; posts make one point.
- Each reporter sees their own last 5 pieces and avoids repeating them.
- Signature words: at most 1 per post, 3 per article.

### 6.5 Style **[planned]**

- Reporters are outside media: never "we", "us", "our".
- Scores winner first ("beat … 4-2", "lost to … 6-2"); percentages "83.1%";
  records "40-11-5"; dates as "Friday, May 8", never "2026-05-08".

## 7. Safety: how a piece gets published

1. The program builds the fact sheet (names only for team members who are not on
   "Leave me out"; guests, opponents' players and opted-out members never named).
2. Claude writes the piece as structured data **[built]**.
3. **Code checks** (numbers, names, clubs, clocks, lengths, labels, pile-on,
   style and craft rules) **[built; new checks planned]**.
4. A **second Claude call reviews** it for invented quotes, events, unfair or
   personal criticism, unsupported drama **[built]**.
5. A failed piece is rewritten with the problems listed — up to 3 writes; then it
   is skipped and nothing is posted **[built]**.
6. Stored, posted to Discord, shown on the site **[built]**. The admin can delete
   any item; it disappears from the site and Discord **[built]**.

## 8. Where it appears

- **Discord `#press-room`:** each post as its reporter (name and picture);
  articles as headline + summary + link **[built]**.
- **Site `/news` "Press Room":** lead article, "More stories" (loads more as you
  scroll), The Wire (10 posts, "Show older posts"), article pages, reporter
  pages, a "News" link in the menu; note "The reporters are made up…" **[built]**.
- **Admin `/admin/news`:** on/off switch, month's spend, recent items with
  delete, a page to read any item in full (also test items), press levels
  **[built]**.

## 9. Running it

- **Model:** Claude Opus 5.5 through the Anthropic API, paid from the Max plan's
  included API credits ($100 each billing cycle, no card, unused credits expire),
  in its own Console workspace. Limit raised to **$20/month** (resets on the 1st;
  the program stops at $19.50) **[planned]**. Expected about $8–10 a month with
  the buzz posts and big-game articles.
- **Test mode:** writes everything, posts nothing, shows test items only on the
  admin page; trial on one real game night before going live **[built]**.
- **Isolation:** its own container; never touches data collection or the game
  result poster **[built]**.
- **Backfill:** the 18 NHL 26 nights with timeline data (and ~7 weekly features)
  are written without the API, through the same checks, and imported before the
  desk goes live (site only, never Discord) **[built tool; rerun planned]**.
- **Privacy:** both policy pages explain what goes to Anthropic's Claude AI
  service (approved), including \"short notes written by the site's admin for the fictional coverage\" (approved 2026-10-25) **[built]**.

## 10. Later: the bot project

See `docs/planning/2026-10-25-news-desk-bots-notes.md`: the nine reporters as
Discord bots; post-game scrums and interview requests (`/scrum` — the person who
typed it, `random`, or a named target); answers become quotes and dossier facts
(joke answers filtered, reporters react in character); GM storylines (Scoot on
LTIR, Joey's "rehab in China", Joseph semi-retired, Benson); GM controls ("ask
about this play", heat up or down); dossiers that fill themselves; fan reactions
that drive buzz.

## 11. Additions suggested by Claude — **all accepted 2026-10-25 [planned]**

1. **Quality dashboard on `/admin/news`.** The audit we ran by hand, as numbers
   that update themselves: share of win posts with a "but", signature-word use
   per reporter, how often each player is named, zero call-outs per player,
   reporter mix. You see drift before teammates do.
2. **Prompt version on every item.** Each stored piece records which version of
   the rules wrote it, so after a change we can compare before and after — and
   undo a change that made things worse.
3. **Per-reporter on/off switch.** If one voice gets on people's nerves, you
   can bench that reporter without touching the rest (a storyline in itself:
   "Mercer suspended").
4. **Spacing big-game posts in Discord.** On a Big or Historic game, send the
   posts a few minutes apart instead of in one burst, so the channel feels live
   rather than flooded.
5. **Language level.** A clear rule on swearing (e.g. mild words like "soft",
   "brutal" allowed; no slurs, no profanity aimed at a person), enforced by the
   review step. Mercer and Pettibone are the ones who will test it.
6. **Correction note.** If an item is deleted because a fact was wrong, an
   optional one-line "correction" post from the same reporter — the way real
   outlets handle it — instead of a silent disappearance.
7. **A short "how to read the Press Room" note** on the reporter pages: who the
   nine are, that they are fictional, and how to set your press level — helpful
   for teammates who join later.
