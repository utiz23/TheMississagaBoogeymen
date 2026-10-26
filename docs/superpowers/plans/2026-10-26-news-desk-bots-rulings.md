# News desk bots release 1 — build rulings and deferred items

**Status:** record of the subagent-driven build of `2026-10-26-news-desk-bots.md` (branch `feat/news-desk-bots`, finished 2026-10-26).
Each ruling is a decision Claude made during the build, with its reason and what it costs if wrong. The operator can reverse any of them.
Superseded: ruling 39 (notes matched by name) is replaced by ruling 41 (by player id); ruling 43 (rules version stays .4) was later bumped to 2026-10-26.5 in the final fix wave.

## Rulings (in the order they were made)

1. Ruling: T10 wires gateway without the reaction handler (sets barlow's GuildMessageReactions intent + partials only); T12 adds the messageReactionAdd → onReaction route in gateway.ts — the plan's T12 file list already modifies gateway.ts, and T10 cannot import a T12 module that does not exist yet — cost if wrong: one extra small edit in T12.
2. Ruling: T1 step 6 (apply 0072 to the verification DB) is skipped — no Docker on the main PC since 2026-10-21; migration correctness is covered by SQL-shape tests and the release checklist applies it on live — cost if wrong: a migration typo surfaces at release, not now.
3. Ruling: Task 7 adds query `setScrumThread(scrumId, threadId)` (and any other scrum-row update it needs) in packages/db/src/queries/news-press.ts — Task 1's brief listed no scrum update query — cost if wrong: none, a small addition in Task 7.
4. Ruling: `countAutoPingsTonight` counts test and live scrums together — trial and live do not overlap in normal use (one night at most at the switch) — cost if wrong: one fewer automatic ping on the switch night.
5. Ruling: subagent commits carry their own model's Co-Authored-By line (Sonnet) — truthful attribution — cost if wrong: cosmetic.
6. Ruling: `docker compose config` checks (Task 3, Task 10 step 5) are replaced by a YAML parse of docker-compose.yml (e.g. `node -e` with the yaml package if present, else a careful read) — Docker is not installed on the main PC since 2026-10-21 — cost if wrong: a compose typo surfaces at deploy on Hotel-Echo, where `docker compose config` runs first in the release checklist.
7. Ruling: Task 4's bot send adapter rethrows sendBotMessage's "no message id" error as WebhookOutcomeUnknownError — the message probably exists, and the cycle must not retry it (Task 2 deferred minor) — cost if wrong: one post marked skipped/unknown that actually failed.
8. Ruling: deleting a bot message while PRESS_MODE is not live (e.g. after a rollback) logs one line and resolves, like the webhook-without-URL case — never retried forever — cost if wrong: that Discord message stays and the operator deletes it by hand.
9. Ruling: followUpAllowed = followupsAsked < questionsAsked && followupsAsked < questionLimit(role) — Global Constraints fix 1 follow-up per question; the per-scrum-total version lets Q1 take both follow-ups — cost if wrong: none, both totals stay ≤ 2.
10. Ruling: judgeAnswer's fallback usability is 'unusable' (fail closed), overriding the plan's 'usable' — the spec allows quotes only from usable/joke answers and real-life/abusive text must never be stored as quotable — cost if wrong: a good answer is occasionally not quoted after an AI failure.
11. Ruling: AskContext.history entries gain `usability: 'usable' | 'joke'` (answer null = unusable) so earlier joke answers keep the JOKE marker in later reviews — cost if wrong: one more field for Task 7/8 to pass.
12. Ruling: offeredTakes returns [] for pressLevel 'easy' and the review gets a "this player gets no criticism" line — Global Constraints: easy = no criticism at all — cost if wrong: Go-easy players never get a reporter take in a scrum (intended).
13. Ruling: GM warning on the 2nd GM-requested ping of a night stays in Task 9 (the /gm note reply "(2nd ping tonight)") — the plan puts it there — cost if wrong: none.
14. Ruling: a crash between a mirror send and insertMirror may duplicate one test-channel post (trial only; message_id NOT NULL prevents claim-first) — accepted — cost if wrong: one duplicate test post.
15. Ruling: only one press process runs (compose service, restart unless-stopped); multi-process races on consumeNextHeat accepted — cost if wrong: a 'next' heat applied to the wrong scrum.
16. Ruling: question/follow-up messages in a thread mention the person (`<@id>`, allowed_mentions.users=[id]; trial: the GM) so they get a notification — the player is not a thread member until they post — cost if wrong: one extra notification per question.
17. Ruling: any HTTP 400 from thread creation counts as "thread exists" (bot-rest does not expose Discord code 160004) — a wrong guess only makes the next post into thread messageId fail and log — cost if wrong: one lost question, logged.
18. Ruling: split startScrumQuestion, scrumMention, threadLine out of pass.ts into press/question.ts now (pass.ts 541 lines; Task 8 imports these) — part of fix round 1 — cost if wrong: none.
19. parked — consumeNextHeat throwing after insertScrum skips that scrum's first ping (pass.ts:894) — Ruling: single DB call window, rare; the button still works — cost if wrong: one missed automatic ping.
20. parked — facts failure falls back to a public question naming the person even if they switched to Leave me out after the ping (question.ts:1441-1453) — Ruling: the person accepted or volunteered themselves (consent), and it needs a facts failure plus a press-level change in minutes — cost if wrong: one scrum question naming a player who just opted out.
21. Ruling: Task 8 — when the extras budget is out at answer time, the answer is stored 'unusable' (not quoted), FALLBACK_CLOSING is posted and the person's scrum ends — fail closed, no AI call — cost if wrong: answers given after 80% spend are never quoted.
22. Ruling: Task 8 — a second submit for the same question gets ephemeral "Already answered." and no state change (conditional update on the current counters) — cost if wrong: none.
23. Ruling: replace the tightened follow-up rule (followupsAsked === questionsAsked - 1) with a stored flag: add `asking_followup boolean not null default false` to news_scrum_people in 0072 (edited in place — 0072 is not applied anywhere yet) and allow a follow-up only when the open item is a question and followUpAllowed() holds — spec: at most 1 follow-up per question, each question may get one — cost if wrong: one more column.
24. Ruling: the answer modal custom id becomes `press:modal:<personId>:<questionsAsked>:<followupsAsked>` and the claim compares those counters — deviates from the brief's fixed id so a stale second pop-up cannot pair an answer with the wrong question (answers become quotes) — cost if wrong: Task 10's router must parse the longer id.
25. Ruling: `/scrum @self` behaves like `/scrum` (volunteer, no command slot used) — a user should not use the picked path on themselves — cost if wrong: none.
26. Ruling: interactions.ts stays at 467 lines (no split) — no later task adds to it (GM commands go to gm.ts, reactions to reactions.ts) — cost if wrong: a later split.
27. Ruling: Task 9 — GM note text goes to the AI fenced as data; the model's playerName is trusted only when it matches a roster player — cost if wrong: none.
28. Ruling: Task 9 — with the extras budget out, /gm note skips the AI call and resolves by alias/name only (asks/critical/theme false) and says so — cost if wrong: notes after 80% spend never ping or count as critical.
29. Ruling: with the extras budget out, a /gm note about a Go easy player is stored 'refused' ("needs the AI check") — fail closed, since criticality is unknown — cost if wrong: a positive note about a Go easy player is lost in the last 20% of the month.
30. Ruling: GM-requested pings wait 60 s after the person row is created (pass step 4), and a correction or cancel inside that window expires the wrongly added person (conditional on not yet pinged) — prevents pinging the wrong player — cost if wrong: GM-asked pings arrive ~1 minute later.
31. Ruling: news_gm_notes.theme stays text (holds the note text when the AI flags a theme) — later parts read it as "is a theme" when non-null — cost if wrong: none.
32. Ruling: the "no analysis ⇒ Go easy note refused" rule covers both budget-out and any failed AI parse — cost if wrong: same as the budget ruling.
33. Ruling: aliases are saved on correction only if the nickname is ≥ 2 chars, appears as a word in the note, is not a stop word (him, he, his, her, she, they, them, the, our, a, an, it, d, guy), is not another player's alias, profile name or gamertag; the model's nickname is used for resolution only when it appears in the note — cost if wrong: the GM types a nickname more than once before it sticks.
34. Ruling: a correction that moves a note to a Go easy player stores it 'refused' (reply "<name> is on Go easy — a corrected note is not used.") — whether the note was analysed is not stored, so fail closed — cost if wrong: positive notes about Go easy players that needed a correction are lost.
35. Ruling: expiry on cancel matches scrum + player + GM (two notes asking the same player share one ping) — accepted — cost if wrong: cancelling one of two notes about the same player within 60 s also stops the ping.
36. Ruling: the 60 s delay also applies to GM persons the pass creates from a note — literal reading accepted — cost if wrong: ~1 minute later ping.
37. Ruling: Task 11 — player answers in the night recap PRESS ROOM block are fenced as data with ANSWERS_ARE_DATA / fencedAnswer (same as the scrum prompts) — they are untrusted player text — cost if wrong: none.
38. Ruling: Task 11 — GM notes reach the recap only for players on the sheet's people; critical notes about easy players are dropped (PressNote.critical) — Global Constraints — cost if wrong: none.
39. Ruling: GM notes are matched to sheet players by display name (both sides use coalesce(player_profiles.player_name, gamertag)) — cost if wrong: a note about a sheet player is silently dropped from the recap.
40. Ruling: each declared quote removes exactly one span, which must sit inside quotation marks (" " or “ ”) in the body, and a quote needs at least 2 words — cost if wrong: a one-word quote ("Never.") must be paraphrased instead.
41. Ruling: PressNote gains playerId and the recap matches notes to sheet people by playerId (replaces the display-name ruling above) — cost if wrong: none.
42. Ruling: closing punctuation is allowed between a quote's words and the closing mark ("…outworked," he said) — normal quoting style — cost if wrong: none.
43. Ruling: NEWS_RULES_VERSION stays 2026-10-26.4 (set by this unreleased task) — cost if wrong: none.
44. Ruling: a declared quote must equal the whole quoted string in the body (not a mid-string part) and only double quote marks count — safe direction; the failure message tells the writer — cost if wrong: an occasional rewrite.
45. Ruling: Task 12 — one vote per (item, user) regardless of emoji; reaction removal does not undo a vote; no follow-up to corrections, to follow-ups, or to items older than 24 h; trial with a live desk only DMs the GM — cost if wrong: a follow-up after someone un-reacts.
46. Ruling: weekly pieces get no fan follow-up; a trigger counts against the item's night; the 24 h limit is checked at vote time; the trial GM DM is deduplicated in memory only — cost if wrong: a rare late follow-up or one repeated test DM after a restart.
47. Ruling: command pings (random/@player) count toward the per-player nightly ping limit with the automatic ones — spec §4.5 overrides the plan's "automatic" wording — cost if wrong: fewer command pings on busy nights.
48. Ruling: after the 80% budget stop no person is pinged and Talk/Accept/command reply "The press is off until next month." — spec §10 "scrums stop" overrides the plan's "button works with fallbacks" — cost if wrong: no scrums in the last fifth of a month.
49. Ruling: an answer naming a forbidden person is unusable without an AI call, and the public echo is posted only after judgement and never for unusable answers (with SUPPRESS_EMBEDS) — cost if wrong: players do not see their unusable answer echoed.
50. parked — rules-version floor test still '.4' while NEWS_RULES_VERSION is '.5' — Ruling: the version is bumped; the test is a floor only — cost if wrong: a revert of the bump would not fail a test.

## Deferred minor findings (not fixed; triaged "can wait" by the final review)

- Task 0: minor (deferred): runbook says "about one hour" (l.22) vs "30 minutes of quiet" (l.63) — make consistent
- Task 0: minor (deferred): "Requires OAuth2 Code Grant" is a Bot-tab toggle — reword l.213-215
- Task 0: minor (deferred): unused "4 games each" in cost header; GuildMessageReactions jargon (l.44, l.117)
- Task 1: minor (deferred): 13 trivial queries + listAliasesSql have no pinned builder; setMirrorFrom's "where mirror_from_item_id is null" guard unpinned (news-press.ts:537)
- Task 1: minor (deferred): CTE named `old` in consumeNextHeat (news-press.ts:528) is reserved on PG18 — rename to `prev`
- Task 1: minor (deferred): nightHasActiveScrumSql hard-codes 5 minutes (news-press.ts:305) vs PRESS_ACCEPT_WINDOW_MS
- Task 1: minor (deferred): newsReactionVotes primaryKey unnamed in Drizzle vs Postgres news_reaction_votes_pkey (schema/news-press.ts:229)
- Task 1: minor (deferred): updateScrumPerson throws on empty patch (news-press.ts:249)
- Task 2: minor (deferred): sendBotMessage malformed 2xx body throws plain Error "no message id" (bot-rest.ts:285) — a retrying caller could duplicate; webhook.ts returns null instead
- Task 2: minor (deferred): no Retry-After handling; buttons typed unknown; edit/delete ECONNREFUSED untested
- Task 3: minor (deferred): redundant `!discord.ok ||` guard (press/config.ts:496); local DISCORD_ID_RE copy can drift (documented)
- Task 4: minor (deferred): delivery.ts:47-50 via 'bot' + null channelId with bots configured logs the wrong reason ("bots not configured")
- Task 4: minor (deferred): no cycle-level test for bot-mode "no message id" → unknown outcome (parts covered)
- Task 5: minor (deferred): AI-goalie candidate test near-vacuous (rules.test.ts:111-121); redundant `seed >>> 0` (rules.ts:410)
- Task 7: minor (deferred): two simultaneous startScrumQuestion calls both run the model (cost only); budget-log key per deps object — Task 10 must reuse one deps object
- Task 8: minor (deferred): /scrum nightly limit count+insert not atomic (interactions.ts:967-995); answer claim does not re-check the 15-min window in SQL; Leave-me-out player pressing Talk gets "This scrum is for players of this game."; URL embeds in the echo not suppressed
- Task 8: minor (deferred): askNow's "will be right with you" also used for off-sheet / lost claim; interactions.ts 467 lines (ruled)
- Task 9: minor (deferred): outPlayerNamed may over-match a common-word name (fails closed)
- Task 9: minor (deferred): correcting A→B→A inside 60 s leaves A expired (unique scrum/player) so A is never pinged; "current night" = newest game within 6 h, so a late correct/cancel says "earlier night"
- Task 10: minor (deferred): press loop starts only after the first login try of all nine clients (comment overstates); no uncaughtException logger; failed command registration not retried until restart; modal uses the older action-row text input
- Task 11: minor (deferred): rule 6 change reaches every piece type (brief-mandated); rules-version test checks only a floor; no prompt tells articles/features quotes must be []
- Task 12: minor (deferred): a trigger whose sheet fetch always fails retries forever and 5 such block newer triggers (cycle.ts:1144-1186); dry run: live triggers can fill the 5 SQL slots (filter is_test in SQL); trial DM marked sent before it goes out
- Task 13: minor (deferred): saveAlias check-then-upsert race (single GM)
- Task 13: minor (deferred): runbook step 0 says "step 3" for the web build (it is step 4); list starting at "0."; no instruction if the pg_dump file is empty (stop)

## Pre-flight scan

| Pair / task  | Produces vs consumes                                                                     | Finding                                                |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| T1↔T4        | markNewsItemPosted(id,msgId,via,channelId), listDiscordDeletions{via,channelId,reporter} | consistent; T1 patches call sites with 'webhook', null |
| T1↔T7        | listRecapItemsWithoutScrum({since,mode,limit})                                           | consistent after plan fix                              |
| T1↔T11       | nightHasActiveScrum, nightPressMaterial, nightCriticized+GM notes                        | consistent                                             |
| T1↔T9/T13    | listPressRoster, upsertAlias/deleteAlias/listAliases                                     | consistent                                             |
| T1↔T12       | reaction tables, job kind 'reaction'                                                     | consistent                                             |
| T2↔T4/T7     | sendBotMessage/delete/edit/startThread/dm, talk/accept/answer buttons                    | consistent                                             |
| T3↔T4/T7/T10 | NewsConfig.bots: PressDiscord                                                            | null; PressConfig                                      | consistent |
| T5↔T7/T8/T9  | rules + constants                                                                        | consistent                                             |
| T6↔T11       | TrustedMaterial in news/prompts.ts; writeChecked maxWrites/trusted                       | consistent after plan fix                              |
| T7↔T8        | startScrumQuestion, PressDeps                                                            | consistent                                             |
| T8↔T9        | Reply type (T8) used by T9 GmNoteResult                                                  | consistent (T9 after T8)                               |
| T10↔T12      | T10 "consumes … 12 handlers" but T12 runs after T10                                      | CONFLICT → Ruling 1                                    |
| T0           | docs + cost estimate; stop if > $20                                                      | self-consistent                                        |
| T1           | step 6 applies to verify DB "if available"                                               | no Docker on main PC → skip; self-consistent           |
| T2–T13       | tests vs code specified                                                                  | self-consistent                                        |
