# Task: Panel scrums (3 reporters) and in-depth interviews

- **State:** Proposed (operator feedback 2026-11-13 after the first trial scrum: "This was good so far")
- **Lane:** Discord (`apps/discord/src/press/`), Queries/Database if the interview needs new rows,
  Web (interview article on `/news`)
- **Risk:** medium (changes what players see in Discord and on the site; no new secrets)
- **Slug:** press-panel-interviews
- **Operator approval:** pending (scope below is the operator's answers; details marked "Lead")
- **Operator gate before merge:** yes
- **Needs a deploy:** yes: `press`, `news`, `web`; maybe a migration (interview rows)

## Goal and visible result

1. **Panel scrum:** a scrum has questions from **3 different reporters**, one question each, not one
   reporter asking everything. Follow-ups make the total 3–6 questions, middle value 5.
2. **In-depth interview:** a separate, longer format: **one reporter, about 7 questions**, in a Discord
   thread, then a **Q&A article on the News page**.

## Operator answers (2026-11-13)

- Scrum: "There should be a low possibility of both extremes, 3 single questions or 3 questions with
  follow ups. Let's say the median is 5 total."
- Interview start: all three: a **GM command**, **automatic**, and **a player asks**.
- Interview: **one reporter**. Output: **thread + site article**.

3. **GM shapes questions** (operator 2026-11-13, during the first live test): the GM can set an exact
   question (or a topic) for a player and which reporter asks it, e.g. "Pettibone asks Erb: why are
   you so pissy?". Today a GM note only gives a topic, in the scrum reporter's own words, and one
   reporter asks everyone in a scrum.

4. **Typed answers in the thread** (operator 2026-11-13: "the ability for people to just send messages
   to the thread would be better"): a player's message in the scrum thread, while they have an open
   question, counts as the answer; the Answer button stays as a backup. Needs the Message Content
   intent on one bot (Wade Barlow; a portal switch, no review under 100 servers). The code reads only
   scrum threads and stores only the asked player's reply; the privacy text already covers answers.
5. **Fixes from the first live scrum (game 3439):** the accept window (5 min) is too short on a game
   night (Stick Menace expired) → Lead: 15 min; old Answer buttons say "Too late" after the next
   question posts (typed answers remove this); the answer judge is too strict (Silky's "This is the
   norm Gord. I got 3 points playing D." was marked unusable) → tune with the 11-13 answers as cases.

## Design (Lead, for the operator to check)

- **Scrum count:** per scrum, draw a target total: 3 (10%), 4 (25%), 5 (50%), 6 (15%). The 3 reporters
  each ask once; follow-ups (at most 1 per reporter) fill the gap to the target, given to the answers
  with the most to chase. If an answer is unusable, that reporter moves on (no follow-up). Volunteers
  keep a shorter round (Lead: 2 reporters, no follow-up) unless the operator wants the full panel.
- **Reporter order:** the heat, rotation and takes rules pick the 3; Father Rink stays out of scrums.
  Each line is posted by that reporter's own bot in the same thread.
- **Interview start rules (Lead):** `/gm interview @player`; `/interview` by a player for their latest
  night (at most one per player per week); automatic offer after a milestone or a "Historic" game (at
  most one a week for the club; the player must Accept within 30 minutes, ignoring = no). Never for
  "Leave me out" players; "Go easy" players get no criticism.
- **Interview flow:** 7 questions (one follow-up may replace a planned question), same pop-up answers,
  30 minutes per answer, the reporter closes politely if the player stops. Unusable answers are never
  quoted.
- **Article:** a Q&A piece by that reporter: short intro, the usable questions and answers (edited only
  for length, never new content), checked by the same quote rules as the recaps. Test interviews stay
  test.
- **Cost (estimate):** a panel scrum about $0.30–0.45; an interview about $0.60–1.00 with its article.
  Inside the $100 cap (scrums and interviews stop at 80%).

## Paths

- **May edit:** `apps/discord/src/press/`, `apps/discord/src/news/` (article kind), `packages/db/src/`
  (queries, schema, one hand-written migration if needed), `apps/web/src/` (interview article view),
  the press runbook, this task file.

## Done when

- **Done when:** on a trial night, a scrum shows 3 reporters in its thread with a total of 3–6
  questions, and one interview (GM-started) runs 7 questions and appears as a Q&A article on `/news`
  (test items only in trial).

## Log

- 2026-11-13 Lead: written from the operator's feedback after the first trial scrum (game 3437,
  Pettibone: 2 questions + 1 follow-up; answers 2 usable, 1 unusable insult, as designed).
- 2026-11-13 operator: add GM question shaping (item 3). First live test: Lead set the OT game's scrum reporter to Pettibone and added a GM note for Erb by hand in the database.
- 2026-11-13 Lead: first LIVE scrum (game 3439, `PRESS_MODE=live` since ~03:10 UTC, `.env` backup
  `.env.bak-2026-11-13-pre-press-live`): reporter Pettibone (set by hand), 4 GM pings at 03:22 UTC;
  Silky done (2 q + 1 follow-up), Erb and Ordinary_Samich answering, Stick Menace expired (no accept in
  5 min). 6 answers: 1 usable, 1 joke, 4 unusable (2 of those were fair answers → judge too strict).
  Operator: "This is a big hit with the team". Requests 4 and 5 added.
