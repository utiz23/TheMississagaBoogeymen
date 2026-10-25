# News desk — bots, GM and dossiers: notes for the later design

**Status:** brainstorm notes from 2026-10-25, not a design. The operator wants the
bot design done later, after news desk revision 2 ships. Marked: **operator** =
said by the operator; **guess** = Claude's guess, to confirm.

## Goal (operator)

An interactive experience that players take part in, with behind-the-scenes
control by a GM (the admin, the operator).

## GM storylines (operator)

- The GM sets storylines that turn real life into hockey drama: a player busy
  with life is "injured"; a work trip is "rehab". Examples given:
  - Scoot: on LTIR until at least the new year.
  - JoeyFlopfish: injured again (a running "injury" storyline over the last
    couple of years), currently in China for rehab.
  - Joseph: semi-retired; unknown if he returns.
  - Benson: has not played a game this season.
- Who mentions them: any reporter, anywhere, where relevant.
- When: a lot when the news breaks, again near and at the return, now and then
  in between — like a real injury. Not in game recaps.
- Significant events get their own article.
- **guess:** storylines are in-world facts: reporters may state them, never guess
  the real reason. Each has a start, an expected end ("until the new year",
  "unknown") and an ending the GM sets ("returned", "retired").

## Player information — dossiers (operator)

- Builds on `docs/specs/player-dossiers/` (one 9-part worksheet per player).
- Keeps facts about players, past and present.
- Filled partly by the GM, and over time by the interview system ("they fill
  themselves out through interviews").
- Joke answers must be filtered out of the dossiers.
- **guess:** facts from answers go to a short GM approval list (approve / reject /
  mark as joke); a dossier field can be "GM only" (never sent to the AI or shown).

## Interviews (operator)

- Post-game scrums after games / nights.
- Interview requests now and then (one reporter, one player).
- Answers become quotes in the stories and facts for the dossiers.
- Reporters react to joke answers in character (some play along, some get
  annoyed).
- **guess:** scrums run in a thread under the night's post in `#press-room` and
  close after a while (e.g. the next morning); an interview request can be
  accepted or ignored.

## The `/scrum` command (operator)

- `/scrum` starts an interview. By default the person who typed the command
  gets it; options: `random` (the bot picks a player) or a named target.

## GM controls during scrums and interviews (operator)

- "Ask about this play": the GM describes a memorable moment the stats cannot
  show (a nice play, a big hit, a bad giveaway); a reporter asks about it.
  **guess:** GM-entered moments count as trusted facts (the one way real plays
  enter the stories).
- Turn the heat up or down. **guess:** this changes which reporters ask (Voss /
  Barlow friendly; Mercer / Pettibone spicy) and their wording; pile-on limit and
  press levels still apply.

## Already decided in the news desk design (§10)

- Seven (now nine) reporters as separate Discord bots, one program running all.
- Text only, no voice.
- Intermission scrums wait for the live engine (sister repo) or a manual start.
- Anytime conversations with reporters are a later step.

## Open for the bot design

Where the GM works (site admin page, Discord commands, or both); how long scrums
stay open; how often interview requests come; how quotes are attributed and
whether a player can withdraw a quote; dossier field list and visibility; how
storylines are scheduled into coverage; cost of bot conversations.

## Fan reactions drive buzz (operator, 2026-10-25)

A post that gets many reactions in Discord (e.g. 🔥) gets a follow-up from
another reporter. Needs the bot (webhooks cannot read reactions).
