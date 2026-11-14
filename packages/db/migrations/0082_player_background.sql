-- Migration: Player background: question bank and facts (Press Box dossier "Background"), release B1
-- Task: docs/tasks/2026-11-14-web-background-b1.md
--
-- What it adds (all hand-written, all idempotent):
--   1. news_background_questions: the question bank. One generic list (player_id NULL: asked of
--      everyone, written with {name} where the person's name goes) and a few questions that belong
--      to one member (player_id set). `part` is one of the 9 parts of the old worksheets
--      (docs/specs/player-dossiers/). `about_teammate` marks a question that asks about another
--      player (relationships, who understands whose game, partners that make a player worse).
--      `active` lets the admin retire a question. The bank is SEEDED here, once, from the
--      worksheets' QUESTIONS only: no answer from a worksheet and no header fact (jersey,
--      nationality, position, team role) is copied as a fact.
--   2. news_background_facts: one fact about one person (a member: player_id, or a bench person or
--      the coach: discord_user_id + display_name). It may name a second member (subject_player_id)
--      when it is about a teammate; the page then lists it under the subject as "what teammates
--      said". status is proposed | confirmed | rejected. source is `admin` (typed on the page) or
--      `answer` (made from one scrum or interview answer: source_scrum_answer_id or
--      source_interview_answer_id). Only a confirmed fact is ever read by a writer. A fact cannot
--      be confirmed without a reviewer name and time (check constraint).
--   Audit lines go in news_press_box_audit (0080) with new kinds background_add, background_confirm,
--   background_edit, background_reject and background_delete. That table has no kind check, so
--   this migration does not touch it.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0081):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0082_player_background.sql
-- Needs 0072 (players), 0073 (news_scrum_answers) and 0074 (news_interview_answers).
-- Needs players 1,2,3,5,6,8,10,11,12,13 for the player-specific questions; a missing player only
-- skips that player's rows.
-- DEPLOY ORDER: apply this migration, then deploy the press service (profile writer), THEN the web
-- app. The web page reads these tables with a fallback, so an early web deploy only shows an empty
-- Background section; the press service reads them for the profile and needs the tables first.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops every stored background fact and the bank):
--   BEGIN;
--   DROP TABLE IF EXISTS "news_background_facts";
--   DROP TABLE IF EXISTS "news_background_questions";
--   COMMIT;
-- Audit lines with kind background_* stay in news_press_box_audit (harmless history).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. The question bank.
CREATE TABLE IF NOT EXISTS "news_background_questions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "part" text NOT NULL,
  "question" text NOT NULL,
  "player_id" integer REFERENCES "players"("id") ON DELETE CASCADE,
  "about_teammate" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_background_questions" DROP CONSTRAINT IF EXISTS "news_background_questions_part_check";
  ALTER TABLE "news_background_questions" ADD CONSTRAINT "news_background_questions_part_check"
    CHECK ("part" IN ('identity', 'career', 'hockey', 'mentality', 'room', 'media', 'pressure', 'story', 'flavor'));
END $$;

-- No exact duplicates: one generic question per text, one per player per text.
CREATE UNIQUE INDEX IF NOT EXISTS "news_background_questions_generic_uniq"
  ON "news_background_questions" ("question") WHERE "player_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "news_background_questions_player_uniq"
  ON "news_background_questions" ("player_id", "question") WHERE "player_id" IS NOT NULL;

-- 2. Facts.
CREATE TABLE IF NOT EXISTS "news_background_facts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" integer REFERENCES "players"("id") ON DELETE CASCADE,
  "discord_user_id" text,
  "display_name" text,
  "subject_player_id" integer REFERENCES "players"("id") ON DELETE CASCADE,
  "question_id" bigint REFERENCES "news_background_questions"("id") ON DELETE SET NULL,
  "part" text NOT NULL,
  "text" text NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "source" text NOT NULL,
  "source_scrum_answer_id" bigint REFERENCES "news_scrum_answers"("id") ON DELETE SET NULL,
  "source_interview_answer_id" bigint REFERENCES "news_interview_answers"("id") ON DELETE SET NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "edited_by" text,
  "edited_at" timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_person_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_person_check"
    CHECK ("player_id" IS NOT NULL OR ("discord_user_id" IS NOT NULL AND "display_name" IS NOT NULL));
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_part_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_part_check"
    CHECK ("part" IN ('identity', 'career', 'hockey', 'mentality', 'room', 'media', 'pressure', 'story', 'flavor'));
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_status_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_status_check"
    CHECK ("status" IN ('proposed', 'confirmed', 'rejected'));
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_source_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_source_check"
    CHECK ("source" IN ('admin', 'answer')
      AND ("source" = 'answer' OR ("source_scrum_answer_id" IS NULL AND "source_interview_answer_id" IS NULL))
      AND ("source_scrum_answer_id" IS NULL OR "source_interview_answer_id" IS NULL));
  -- A fact is not confirmed unless a named reviewer confirmed it at a time.
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_review_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_review_check"
    CHECK ("status" <> 'confirmed' OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL));
  -- A fact never names its own person as the second player.
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_subject_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_subject_check"
    CHECK ("subject_player_id" IS NULL OR "player_id" IS NULL OR "subject_player_id" <> "player_id");
  ALTER TABLE "news_background_facts" DROP CONSTRAINT IF EXISTS "news_background_facts_text_check";
  ALTER TABLE "news_background_facts" ADD CONSTRAINT "news_background_facts_text_check"
    CHECK (char_length(btrim("text")) BETWEEN 1 AND 400);
END $$;

CREATE INDEX IF NOT EXISTS "news_background_facts_player_idx"
  ON "news_background_facts" ("player_id", "status");
CREATE INDEX IF NOT EXISTS "news_background_facts_user_idx"
  ON "news_background_facts" ("discord_user_id", "status") WHERE "player_id" IS NULL;
CREATE INDEX IF NOT EXISTS "news_background_facts_subject_idx"
  ON "news_background_facts" ("subject_player_id", "status") WHERE "subject_player_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "news_background_facts_proposed_idx"
  ON "news_background_facts" ("created_at") WHERE "status" = 'proposed';

-- 3. Seed: the generic questions (no player), then each member's own questions. Re-running adds
--    nothing (the unique indexes above skip a question that is already there).
INSERT INTO "news_background_questions" ("part", "question", "about_teammate", "sort_order")
VALUES
  ('identity', 'Does {name}''s jersey number mean anything, or is it just the number {name} landed on?', false, 10),
  ('identity', 'Is the nickname people use for {name} the real room nickname, or just the obvious public shorthand?', false, 11),
  ('identity', 'Is there a real-name / gamertag / nickname split that matters?', false, 12),
  ('identity', 'Is there a room nickname people use that should be captured here?', false, 13),
  ('identity', 'What are the three words most teammates would use to describe {name}?', false, 14),
  ('identity', 'What is the one wrong assumption outsiders would make about {name}?', false, 15),
  ('identity', 'What is the simplest fan-facing summary of {name}''s role on the team?', false, 16),
  ('identity', 'What one-sentence description best captures {name} as a player?', false, 17),
  ('identity', 'What should reporters call {name} on first reference?', false, 18),
  ('identity', 'What should teammates call {name} in copy and quotes?', false, 19),
  ('career', 'Has {name} ever left and come back, or nearly left?', false, 20),
  ('career', 'Has {name}''s role changed since {name} first arrived?', false, 21),
  ('career', 'Is {name} best described as a founder, early-core piece, mid-cycle addition, or newer pickup?', false, 22),
  ('career', 'Was there a turning-point season, title, or stretch where {name} became more important?', false, 23),
  ('career', 'Was {name} part of an earlier version of the club or roster core?', false, 24),
  ('career', 'Was {name} recruited, inherited, or brought in by a specific teammate?', true, 25),
  ('career', 'What old line combo or era is most associated with {name}?', true, 26),
  ('career', 'What old reputation still follows {name} even if it is outdated?', false, 27),
  ('career', 'What part of {name}''s career arc do newer teammates not know?', false, 28),
  ('career', 'What position did {name} originally play when {name} joined?', false, 29),
  ('career', 'What relationship history matters for understanding {name} on this roster?', true, 30),
  ('career', 'What slump, position change, chemistry shift, or role adjustment matters most to {name}''s story?', false, 31),
  ('career', 'What would teammates say {name}''s growth arc has been?', false, 32),
  ('career', 'What would {name} say {name}''s own career arc has been?', false, 33),
  ('career', 'When did {name} first join the team?', false, 34),
  ('hockey', 'How much defensive detail can you trust from {name} in a tight game?', false, 35),
  ('hockey', 'How reliable is {name} away from the puck?', false, 36),
  ('hockey', 'What does a classic bad {name} game look like shift to shift?', false, 37),
  ('hockey', 'What does a classic good {name} game look like shift to shift?', false, 38),
  ('hockey', 'What is the biggest thing {name} does that does not show up in the box score?', false, 39),
  ('hockey', 'What is the biggest thing {name} fails to do when {name}''s game goes cold?', false, 40),
  ('hockey', 'What special-teams role actually fits {name}?', false, 41),
  ('mentality', 'Does {name} laugh off errors, brood on them, or try to erase them immediately?', false, 42),
  ('mentality', 'Does {name} stabilize the room, or spike the room''s energy up and down?', false, 43),
  ('mentality', 'How does {name} handle mistakes?', false, 44),
  ('mentality', 'Is {name} naturally loud, quiet, chirpy, intense, loose, or moody?', false, 45),
  ('mentality', 'Is {name} someone the room feeds off emotionally?', false, 46),
  ('mentality', 'What does frustration look like on the bench?', false, 47),
  ('mentality', 'What does joy look like on the bench?', false, 48),
  ('mentality', 'What happens to {name}''s game when that confidence disappears?', false, 49),
  ('mentality', 'What is one personality trait teammates love about {name}?', false, 50),
  ('mentality', 'What is one personality trait that occasionally drives them nuts?', false, 51),
  ('mentality', 'What is {name}''s actual locker-room personality?', false, 52),
  ('mentality', 'What is {name}''s default public personality?', false, 53),
  ('mentality', 'What kind of confidence does {name} play with when {name} feels good?', false, 54),
  ('room', 'Does {name} respond better to hard coaching or casual coaching?', false, 55),
  ('room', 'Is {name} more respected for skill, effort, competitiveness, personality, or something else?', false, 56),
  ('room', 'What role does {name} play in the room besides {name}''s official team role?', false, 57),
  ('room', 'Which teammate seems to understand {name}''s game immediately?', true, 58),
  ('room', 'Which teammate style clashes with {name}''s instincts?', true, 59),
  ('room', 'Who does {name} naturally sit with, skate with, or talk with most?', true, 60),
  ('room', 'Who on the team calms {name} down best?', true, 61),
  ('room', 'Who on the team hypes {name} up best?', true, 62),
  ('media', 'Does {name} answer better after wins or after losses?', false, 63),
  ('media', 'Does {name} speak in hockey cliches, quick emotional blurts, or actual detail?', false, 64),
  ('media', 'Does {name} take accountability easily, or does {name} redirect to team language?', false, 65),
  ('media', 'If {name} had one signature line after a big game, what would it sound like?', false, 66),
  ('media', 'Is {name} a good interview?', false, 67),
  ('media', 'Is {name} better one-on-one or in a scrum?', false, 68),
  ('media', 'Is {name} naturally articulate, blunt, funny, guarded, or repetitive?', false, 69),
  ('media', 'What kind of question annoys {name}?', false, 70),
  ('media', 'What kind of question gets {name} talking?', false, 71),
  ('media', 'What phrases does {name} tend to repeat?', false, 72),
  ('media', 'What topics get {name}''s most honest answers?', false, 73),
  ('media', 'What topics make {name} shut down?', false, 74),
  ('media', 'Which fictional reporter would get the best material out of {name}?', false, 75),
  ('media', 'Which fictional reporter would get the worst version of {name}?', false, 76),
  ('pressure', 'Does {name} get better in messy games or cleaner games?', false, 77),
  ('pressure', 'Does {name} rise in rivalry games?', false, 78),
  ('pressure', 'Does {name} want the puck more when the team is down?', false, 79),
  ('pressure', 'How does {name} react when opponents chirp {name}?', false, 80),
  ('pressure', 'How does {name} react when referees frustrate {name}?', false, 81),
  ('pressure', 'What does {name} look like after a bad turnover?', false, 82),
  ('pressure', 'What happens to {name} in close games?', false, 83),
  ('pressure', 'What is the most likely way {name}''s night unravels?', false, 84),
  ('pressure', 'What is {name}''s ceiling in a big game?', false, 85),
  ('pressure', 'What is {name}''s floor in a big game?', false, 86),
  ('story', 'What criticism from fans is fair?', false, 87),
  ('story', 'What criticism from fans is lazy or wrong?', false, 88),
  ('story', 'What headline does {name} create after a frustrating loss?', false, 89),
  ('story', 'What internal tension makes {name} interesting as a character?', false, 90),
  ('story', 'What is the better, more accurate narrative?', false, 91),
  ('story', 'What is the easiest lazy narrative writers would give {name}?', false, 92),
  ('story', 'What long-form feature angle would actually be worth writing?', false, 93),
  ('story', 'What recurring storyline follows {name} all season?', false, 94),
  ('story', 'What teammate relationship could become a useful sub-plot?', true, 95),
  ('story', 'What type of game exposes {name}?', false, 96),
  ('story', 'What type of game makes {name} look like a star?', false, 97),
  ('story', 'What would a coach praise first about {name}?', false, 98),
  ('story', 'What would a coach privately want more of from {name}?', false, 99),
  ('flavor', 'Does {name} get louder or quieter as puck drop gets closer?', false, 100),
  ('flavor', 'Does {name} have any harmless quirks the team always notices?', false, 101),
  ('flavor', 'Does {name} have any visible bench habits?', false, 102),
  ('flavor', 'If fans latched onto one detail about {name}, what would it be?', false, 103),
  ('flavor', 'Is {name} naturally meme-able? Why?', false, 104),
  ('flavor', 'What is the funniest thing {name} does without realizing it?', false, 105),
  ('flavor', 'What is {name}''s pregame routine?', false, 106),
  ('flavor', 'What kind of humor does {name} bring to the room?', false, 107),
  ('flavor', 'What should writers never invent about {name} unless someone confirms it?', false, 108),
  ('flavor', 'What song / energy / vibe fits {name} without becoming too on-the-nose?', false, 109)
ON CONFLICT DO NOTHING;

-- Player-specific questions: each joins players on the id AND the gamertag, so a row never lands
-- on the wrong person. A player that is missing here is skipped.
INSERT INTO "news_background_questions" ("part", "question", "player_id", "about_teammate", "sort_order")
SELECT v."part", v."question", p."id", v."about_teammate", v."sort_order"
FROM (VALUES
  ('career', 'What old pair, line combo, or era is most associated with {name}?', 1, 'HenryTheBobJr', true, 1000),
  ('hockey', 'Does {name} prefer quick breakouts or more patient regrouping?', 1, 'HenryTheBobJr', false, 1001),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or both?', 1, 'HenryTheBobJr', false, 1002),
  ('hockey', 'Is {name} a player coaches protect, unleash, or match hard?', 1, 'HenryTheBobJr', false, 1003),
  ('hockey', 'Is {name} better closing rushes, defending the cycle, or moving the first pass?', 1, 'HenryTheBobJr', false, 1004),
  ('hockey', 'Is {name} more of a puck mover, stopper, rover, gap-killer, or stabilizer?', 1, 'HenryTheBobJr', false, 1005),
  ('hockey', 'What is {name}''s best offensive habit from the back end?', 1, 'HenryTheBobJr', false, 1006),
  ('hockey', 'What is {name}''s most frustrating habit with the puck?', 1, 'HenryTheBobJr', false, 1007),
  ('hockey', 'What kind of defenseman is {name} at {name}''s best?', 1, 'HenryTheBobJr', false, 1008),
  ('hockey', 'What kind of partner brings out the best in {name}?', 1, 'HenryTheBobJr', true, 1009),
  ('hockey', 'What kind of partner makes {name} worse?', 1, 'HenryTheBobJr', true, 1010),
  ('hockey', 'Which side is {name} most comfortable on?', 1, 'HenryTheBobJr', false, 1011),
  ('room', 'Is {name} a momentum guy, standards guy, chirp guy, music guy, comic relief guy, or something else?', 1, 'HenryTheBobJr', false, 1012),
  ('room', 'Is {name} a vocal leader, calm leader, or example-first leader?', 1, 'HenryTheBobJr', false, 1013),
  ('room', 'When the team is flat, does {name} usually wake it up or settle it down?', 1, 'HenryTheBobJr', false, 1014),
  ('pressure', 'Does {name} get impatient when the team gets hemmed in?', 1, 'HenryTheBobJr', false, 1015),
  ('pressure', 'What does {name} look like after getting beat defensively?', 1, 'HenryTheBobJr', false, 1016),
  ('pressure', 'What does {name} look like after making a huge stop or breakup?', 1, 'HenryTheBobJr', false, 1017),
  ('pressure', 'What is the most likely way {name} takes over a period without scoring?', 1, 'HenryTheBobJr', false, 1018),
  ('story', 'Is {name} a tone-setter, security blanket, backbone player, or matchup specialist?', 1, 'HenryTheBobJr', false, 1019),
  ('story', 'What headline does {name} create after a dominant shutdown night?', 1, 'HenryTheBobJr', false, 1020),
  ('flavor', 'Does {name} talk constantly, draw on the board, tap {name}''s stick, pace, or stew?', 1, 'HenryTheBobJr', false, 1021),
  ('flavor', 'What does {name}''s big defensive play celebration feel like?', 1, 'HenryTheBobJr', false, 1022),
  ('career', 'How did the goalie-to-winger-to-center progression actually happen?', 2, 'silkyjoker85', false, 1023),
  ('career', 'Was the position change forced by need, talent, preference, or some mix of all three?', 2, 'silkyjoker85', false, 1024),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 2, 'silkyjoker85', false, 1025),
  ('hockey', 'How much of the former-goalie / winger background still shows up in {name}''s game?', 2, 'silkyjoker85', false, 1026),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 2, 'silkyjoker85', false, 1027),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 2, 'silkyjoker85', false, 1028),
  ('hockey', 'Is {name} better carrying into the zone, distributing off the cycle, or arriving late as support?', 2, 'silkyjoker85', false, 1029),
  ('hockey', 'Is {name} more of a playmaker, transporter, matchup center, forechecker, or connector?', 2, 'silkyjoker85', false, 1030),
  ('hockey', 'What is {name}''s best offensive habit?', 2, 'silkyjoker85', false, 1031),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 2, 'silkyjoker85', false, 1032),
  ('hockey', 'What kind of center is {name} at {name}''s best?', 2, 'silkyjoker85', false, 1033),
  ('hockey', 'What kind of linemates make {name} worse?', 2, 'silkyjoker85', true, 1034),
  ('hockey', 'What kind of wingers bring out the best in {name}?', 2, 'silkyjoker85', true, 1035),
  ('hockey', 'Where does {name} naturally drive play from on the ice?', 2, 'silkyjoker85', false, 1036),
  ('room', 'Is {name} a momentum guy, standards guy, chirp guy, music guy, comic relief guy, or something else?', 2, 'silkyjoker85', false, 1037),
  ('room', 'Is {name} a vocal leader, calm leader, or example-first leader?', 2, 'silkyjoker85', false, 1038),
  ('room', 'When the team is flat, does {name} usually wake it up or settle it down?', 2, 'silkyjoker85', false, 1039),
  ('pressure', 'Does {name} get impatient when a game slows down?', 2, 'silkyjoker85', false, 1040),
  ('pressure', 'What does {name} look like after missing a huge chance?', 2, 'silkyjoker85', false, 1041),
  ('pressure', 'What does {name} look like after winning or losing a key draw?', 2, 'silkyjoker85', false, 1042),
  ('pressure', 'What is the most likely way {name} takes over a period?', 2, 'silkyjoker85', false, 1043),
  ('story', 'Is {name} a conversion-story player, confidence player, line-driver, or matchup-dependent player?', 2, 'silkyjoker85', false, 1044),
  ('story', 'What headline does {name} create after a multi-point night?', 2, 'silkyjoker85', false, 1045),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 2, 'silkyjoker85', false, 1046),
  ('flavor', 'What does {name}''s goal celebration feel like?', 2, 'silkyjoker85', false, 1047),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 3, 'Stick Menace', false, 1048),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 3, 'Stick Menace', false, 1049),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 3, 'Stick Menace', false, 1050),
  ('hockey', 'Is {name} better off the cycle, off the rush, or arriving late into space?', 3, 'Stick Menace', false, 1051),
  ('hockey', 'Is {name} more of a shooter, finisher, transporter, forechecker, or chaos creator?', 3, 'Stick Menace', false, 1052),
  ('hockey', 'What is {name}''s best offensive habit?', 3, 'Stick Menace', false, 1053),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 3, 'Stick Menace', false, 1054),
  ('hockey', 'What kind of center brings out the best in {name}?', 3, 'Stick Menace', true, 1055),
  ('hockey', 'What kind of linemate makes {name} worse?', 3, 'Stick Menace', true, 1056),
  ('hockey', 'What kind of winger is {name} at {name}''s best?', 3, 'Stick Menace', false, 1057),
  ('hockey', 'Where does {name} naturally attack from on the ice?', 3, 'Stick Menace', false, 1058),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 3, 'Stick Menace', false, 1059),
  ('room', 'Is {name} a vocal leader, calm leader, or example-first leader?', 3, 'Stick Menace', false, 1060),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 3, 'Stick Menace', false, 1061),
  ('pressure', 'Does {name} get impatient when a game slows down?', 3, 'Stick Menace', false, 1062),
  ('pressure', 'What does {name} look like after missing a huge chance?', 3, 'Stick Menace', false, 1063),
  ('pressure', 'What does {name} look like after scoring?', 3, 'Stick Menace', false, 1064),
  ('pressure', 'What is the most likely way {name} takes over a period?', 3, 'Stick Menace', false, 1065),
  ('story', 'Is {name} a streak player, confidence player, finisher, heartbeat player, or matchup-dependent player?', 3, 'Stick Menace', false, 1066),
  ('story', 'What headline does {name} create after a two-goal night?', 3, 'Stick Menace', false, 1067),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 3, 'Stick Menace', false, 1068),
  ('flavor', 'What does {name}''s goal celebration feel like?', 3, 'Stick Menace', false, 1069),
  ('career', 'How much does the old center history still matter to the way teammates see {name}?', 5, 'JoeyFlopfish', false, 1070),
  ('career', 'What old pair, line combo, or era is most associated with {name}?', 5, 'JoeyFlopfish', true, 1071),
  ('hockey', 'Does {name} prefer quick breakouts or more patient regrouping?', 5, 'JoeyFlopfish', false, 1072),
  ('hockey', 'How much of {name}''s old center background still shows up in {name}''s game?', 5, 'JoeyFlopfish', false, 1073),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or both?', 5, 'JoeyFlopfish', false, 1074),
  ('hockey', 'Is {name} a player coaches protect, unleash, or match hard?', 5, 'JoeyFlopfish', false, 1075),
  ('hockey', 'Is {name} better closing rushes, defending the cycle, or moving the first pass?', 5, 'JoeyFlopfish', false, 1076),
  ('hockey', 'Is {name} more of a puck mover, stopper, rover, gap-killer, or stabilizer?', 5, 'JoeyFlopfish', false, 1077),
  ('hockey', 'What is {name}''s best offensive habit from the back end?', 5, 'JoeyFlopfish', false, 1078),
  ('hockey', 'What is {name}''s most frustrating habit with the puck?', 5, 'JoeyFlopfish', false, 1079),
  ('hockey', 'What kind of defenseman is {name} at {name}''s best?', 5, 'JoeyFlopfish', false, 1080),
  ('hockey', 'What kind of partner brings out the best in {name}?', 5, 'JoeyFlopfish', true, 1081),
  ('hockey', 'What kind of partner makes {name} worse?', 5, 'JoeyFlopfish', true, 1082),
  ('hockey', 'Which side is {name} most comfortable on?', 5, 'JoeyFlopfish', false, 1083),
  ('room', 'Is {name} a captain-adjacent voice or more of an energy piece?', 5, 'JoeyFlopfish', false, 1084),
  ('room', 'Is {name} a momentum guy, standards guy, chirp guy, music guy, comic relief guy, or something else?', 5, 'JoeyFlopfish', false, 1085),
  ('room', 'When the team is flat, does {name} usually wake it up or settle it down?', 5, 'JoeyFlopfish', false, 1086),
  ('pressure', 'Does {name} get impatient when the team gets hemmed in?', 5, 'JoeyFlopfish', false, 1087),
  ('pressure', 'What does {name} look like after getting beat defensively?', 5, 'JoeyFlopfish', false, 1088),
  ('pressure', 'What does {name} look like after making a huge stop or breakout pass?', 5, 'JoeyFlopfish', false, 1089),
  ('pressure', 'What is the most likely way {name} takes over a period without scoring?', 5, 'JoeyFlopfish', false, 1090),
  ('story', 'Is {name} a tone-setter, security blanket, backbone player, or conversion-story player?', 5, 'JoeyFlopfish', false, 1091),
  ('story', 'What headline does {name} create after a dominant shutdown night?', 5, 'JoeyFlopfish', false, 1092),
  ('flavor', 'Does {name} talk constantly, draw on the board, tap {name}''s stick, pace, or stew?', 5, 'JoeyFlopfish', false, 1093),
  ('flavor', 'What does {name}''s big defensive play celebration feel like?', 5, 'JoeyFlopfish', false, 1094),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 6, 'camrazz', false, 1095),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 6, 'camrazz', false, 1096),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 6, 'camrazz', false, 1097),
  ('hockey', 'Is {name} better off the cycle, off the rush, or arriving late into space?', 6, 'camrazz', false, 1098),
  ('hockey', 'Is {name} more of a shooter, finisher, transporter, forechecker, or chaos creator?', 6, 'camrazz', false, 1099),
  ('hockey', 'What is {name}''s best offensive habit?', 6, 'camrazz', false, 1100),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 6, 'camrazz', false, 1101),
  ('hockey', 'What kind of center brings out the best in {name}?', 6, 'camrazz', true, 1102),
  ('hockey', 'What kind of linemate makes {name} worse?', 6, 'camrazz', true, 1103),
  ('hockey', 'What kind of winger is {name} at {name}''s best?', 6, 'camrazz', false, 1104),
  ('hockey', 'Where does {name} naturally attack from on the ice?', 6, 'camrazz', false, 1105),
  ('room', 'Is {name} a captain-adjacent voice or more of an energy piece?', 6, 'camrazz', false, 1106),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 6, 'camrazz', false, 1107),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 6, 'camrazz', false, 1108),
  ('pressure', 'Does {name} get impatient when a game slows down?', 6, 'camrazz', false, 1109),
  ('pressure', 'What does {name} look like after missing a huge chance?', 6, 'camrazz', false, 1110),
  ('pressure', 'What does {name} look like after scoring?', 6, 'camrazz', false, 1111),
  ('pressure', 'What is the most likely way {name} takes over a period?', 6, 'camrazz', false, 1112),
  ('story', 'Is {name} a streak player, confidence player, heartbeat player, or matchup-dependent player?', 6, 'camrazz', false, 1113),
  ('story', 'What headline does {name} create after a two-goal night?', 6, 'camrazz', false, 1114),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 6, 'camrazz', false, 1115),
  ('flavor', 'What does {name}''s goal celebration feel like?', 6, 'camrazz', false, 1116),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 8, 'Ordinary_Samich', false, 1117),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 8, 'Ordinary_Samich', false, 1118),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 8, 'Ordinary_Samich', false, 1119),
  ('hockey', 'Is {name} better off the cycle, off the rush, or arriving late into space?', 8, 'Ordinary_Samich', false, 1120),
  ('hockey', 'Is {name} more of a shooter, finisher, transporter, forechecker, or chaos creator?', 8, 'Ordinary_Samich', false, 1121),
  ('hockey', 'What is {name}''s best offensive habit?', 8, 'Ordinary_Samich', false, 1122),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 8, 'Ordinary_Samich', false, 1123),
  ('hockey', 'What kind of center brings out the best in {name}?', 8, 'Ordinary_Samich', true, 1124),
  ('hockey', 'What kind of linemate makes {name} worse?', 8, 'Ordinary_Samich', true, 1125),
  ('hockey', 'What kind of winger is {name} at {name}''s best?', 8, 'Ordinary_Samich', false, 1126),
  ('hockey', 'Where does {name} naturally attack from on the ice?', 8, 'Ordinary_Samich', false, 1127),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 8, 'Ordinary_Samich', false, 1128),
  ('room', 'Is {name} still more learner than voice, or does {name} already carry some room presence?', 8, 'Ordinary_Samich', false, 1129),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 8, 'Ordinary_Samich', false, 1130),
  ('pressure', 'Does {name} get impatient when a game slows down?', 8, 'Ordinary_Samich', false, 1131),
  ('pressure', 'What does {name} look like after missing a huge chance?', 8, 'Ordinary_Samich', false, 1132),
  ('pressure', 'What does {name} look like after scoring?', 8, 'Ordinary_Samich', false, 1133),
  ('pressure', 'What is the most likely way {name} takes over a period?', 8, 'Ordinary_Samich', false, 1134),
  ('story', 'Is {name} a rookie-growth player, confidence player, energy player, or matchup-dependent player?', 8, 'Ordinary_Samich', false, 1135),
  ('story', 'What headline does {name} create after a two-goal night?', 8, 'Ordinary_Samich', false, 1136),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 8, 'Ordinary_Samich', false, 1137),
  ('flavor', 'What does {name}''s goal celebration feel like?', 8, 'Ordinary_Samich', false, 1138),
  ('career', 'How much does the right-wing to tracked-center tension matter to {name}''s story?', 10, 'SCOOT BOY 42', false, 1139),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 10, 'SCOOT BOY 42', false, 1140),
  ('hockey', 'How much does {name}''s current tracked center usage change the way {name} should be described?', 10, 'SCOOT BOY 42', false, 1141),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 10, 'SCOOT BOY 42', false, 1142),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 10, 'SCOOT BOY 42', false, 1143),
  ('hockey', 'Is {name} better off the cycle, off the rush, or arriving late into space?', 10, 'SCOOT BOY 42', false, 1144),
  ('hockey', 'Is {name} more of a shooter, finisher, transporter, forechecker, or chaos creator?', 10, 'SCOOT BOY 42', false, 1145),
  ('hockey', 'What is {name}''s best offensive habit?', 10, 'SCOOT BOY 42', false, 1146),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 10, 'SCOOT BOY 42', false, 1147),
  ('hockey', 'What kind of center brings out the best in {name}?', 10, 'SCOOT BOY 42', true, 1148),
  ('hockey', 'What kind of linemate makes {name} worse?', 10, 'SCOOT BOY 42', true, 1149),
  ('hockey', 'What kind of winger is {name} at {name}''s best?', 10, 'SCOOT BOY 42', false, 1150),
  ('hockey', 'Where does {name} naturally attack from on the ice?', 10, 'SCOOT BOY 42', false, 1151),
  ('room', 'Is {name} a captain-adjacent voice or more of an energy piece?', 10, 'SCOOT BOY 42', false, 1152),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 10, 'SCOOT BOY 42', false, 1153),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 10, 'SCOOT BOY 42', false, 1154),
  ('pressure', 'Does {name} get impatient when a game slows down?', 10, 'SCOOT BOY 42', false, 1155),
  ('pressure', 'What does {name} look like after missing a huge chance?', 10, 'SCOOT BOY 42', false, 1156),
  ('pressure', 'What does {name} look like after scoring?', 10, 'SCOOT BOY 42', false, 1157),
  ('pressure', 'What is the most likely way {name} takes over a period?', 10, 'SCOOT BOY 42', false, 1158),
  ('story', 'Is {name} a utility-forward player, confidence player, energy player, or matchup-dependent player?', 10, 'SCOOT BOY 42', false, 1159),
  ('story', 'What headline does {name} create after a two-goal night?', 10, 'SCOOT BOY 42', false, 1160),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 10, 'SCOOT BOY 42', false, 1161),
  ('flavor', 'What does {name}''s goal celebration feel like?', 10, 'SCOOT BOY 42', false, 1162),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 11, 'MrHomiecide', false, 1163),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 11, 'MrHomiecide', false, 1164),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 11, 'MrHomiecide', false, 1165),
  ('hockey', 'Is {name} better carrying into the zone, distributing off the cycle, or arriving late as support?', 11, 'MrHomiecide', false, 1166),
  ('hockey', 'Is {name} more of a playmaker, transporter, matchup center, forechecker, or connector?', 11, 'MrHomiecide', false, 1167),
  ('hockey', 'What is {name}''s best offensive habit?', 11, 'MrHomiecide', false, 1168),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 11, 'MrHomiecide', false, 1169),
  ('hockey', 'What kind of center is {name} at {name}''s best?', 11, 'MrHomiecide', false, 1170),
  ('hockey', 'What kind of linemates make {name} worse?', 11, 'MrHomiecide', true, 1171),
  ('hockey', 'What kind of wingers bring out the best in {name}?', 11, 'MrHomiecide', true, 1172),
  ('hockey', 'Where does {name} naturally drive play from on the ice?', 11, 'MrHomiecide', false, 1173),
  ('room', 'Is {name} a captain-adjacent voice or more of an energy piece?', 11, 'MrHomiecide', false, 1174),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 11, 'MrHomiecide', false, 1175),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 11, 'MrHomiecide', false, 1176),
  ('pressure', 'Does {name} get impatient when a game slows down?', 11, 'MrHomiecide', false, 1177),
  ('pressure', 'What does {name} look like after missing a huge chance?', 11, 'MrHomiecide', false, 1178),
  ('pressure', 'What does {name} look like after winning or losing a key draw?', 11, 'MrHomiecide', false, 1179),
  ('pressure', 'What is the most likely way {name} takes over a period?', 11, 'MrHomiecide', false, 1180),
  ('story', 'Is {name} a confidence player, utility player, line-glue player, or matchup-dependent player?', 11, 'MrHomiecide', false, 1181),
  ('story', 'What headline does {name} create after a multi-point night?', 11, 'MrHomiecide', false, 1182),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 11, 'MrHomiecide', false, 1183),
  ('flavor', 'What does {name}''s goal celebration feel like?', 11, 'MrHomiecide', false, 1184),
  ('identity', 'What one-sentence description best captures {name} as a goalie?', 12, 'Pratt2016', false, 1185),
  ('career', 'What old goalie tandem, defensive group, or era is most associated with {name}?', 12, 'Pratt2016', false, 1186),
  ('career', 'What slump, style adjustment, chemistry shift, or role adjustment matters most to {name}''s story?', 12, 'Pratt2016', false, 1187),
  ('hockey', 'Does {name} play better behind structured defense or shot-trading chaos?', 12, 'Pratt2016', false, 1188),
  ('hockey', 'How much mental reset does {name} need after a bad goal?', 12, 'Pratt2016', false, 1189),
  ('hockey', 'How reliable is {name}''s puck handling?', 12, 'Pratt2016', false, 1190),
  ('hockey', 'How reliable is {name}''s rebound control?', 12, 'Pratt2016', false, 1191),
  ('hockey', 'Is {name} a goalie coaches ride, protect, rotate, or calm down?', 12, 'Pratt2016', false, 1192),
  ('hockey', 'Is {name} more reactive, positional, aggressive, scrambly, calm, or athletic?', 12, 'Pratt2016', false, 1193),
  ('hockey', 'What changes in {name}''s game when protecting a one-goal lead?', 12, 'Pratt2016', false, 1194),
  ('hockey', 'What changes in {name}''s game when the team is chasing and trading chances?', 12, 'Pratt2016', false, 1195),
  ('hockey', 'What does a classic bad {name} game look like sequence to sequence?', 12, 'Pratt2016', false, 1196),
  ('hockey', 'What does a classic good {name} game look like sequence to sequence?', 12, 'Pratt2016', false, 1197),
  ('hockey', 'What is the biggest thing that slips when {name}''s game goes cold?', 12, 'Pratt2016', false, 1198),
  ('hockey', 'What is the biggest thing {name} does that does not show up in the raw save total?', 12, 'Pratt2016', false, 1199),
  ('hockey', 'What is {name}''s best technical habit?', 12, 'Pratt2016', false, 1200),
  ('hockey', 'What is {name}''s most frustrating habit?', 12, 'Pratt2016', false, 1201),
  ('hockey', 'What kind of goalie is {name} at {name}''s best?', 12, 'Pratt2016', false, 1202),
  ('hockey', 'What kinds of chances does {name} read best?', 12, 'Pratt2016', false, 1203),
  ('hockey', 'What special-teams or game-state pressure reveals the most about {name}?', 12, 'Pratt2016', false, 1204),
  ('hockey', 'What types of attacks make {name} uncomfortable?', 12, 'Pratt2016', false, 1205),
  ('mentality', 'What does frustration look like in the crease or on the bench?', 12, 'Pratt2016', false, 1206),
  ('mentality', 'What does joy look like after a huge save or a win?', 12, 'Pratt2016', false, 1207),
  ('room', 'Is {name} a momentum guy, calm guy, chirp guy, music guy, comic relief guy, or something else?', 12, 'Pratt2016', false, 1208),
  ('room', 'Is {name} a vocal presence, quiet presence, or weird goalie presence?', 12, 'Pratt2016', false, 1209),
  ('room', 'Is {name} more respected for composure, compete level, personality, athleticism, or resilience?', 12, 'Pratt2016', false, 1210),
  ('room', 'What role does {name} play in the room besides being the goalie?', 12, 'Pratt2016', false, 1211),
  ('room', 'When the team is flat, does {name} usually cover for it or get dragged down with it?', 12, 'Pratt2016', false, 1212),
  ('room', 'Which defenseman seems to understand {name}''s game immediately?', 12, 'Pratt2016', true, 1213),
  ('room', 'Which team habits make life easiest for {name}?', 12, 'Pratt2016', false, 1214),
  ('room', 'Which team habits make life hardest for {name}?', 12, 'Pratt2016', false, 1215),
  ('media', 'If {name} had one signature line after stealing a game, what would it sound like?', 12, 'Pratt2016', false, 1216),
  ('pressure', 'Does {name} get sharper as shot volume rises, or does {name} need structure?', 12, 'Pratt2016', false, 1217),
  ('pressure', 'How does {name} react when opponents crash the crease or chirp {name}?', 12, 'Pratt2016', false, 1218),
  ('pressure', 'What does bounce-back behavior look like from {name}?', 12, 'Pratt2016', false, 1219),
  ('pressure', 'What does {name} look like after a huge save?', 12, 'Pratt2016', false, 1220),
  ('pressure', 'What does {name} look like after allowing a bad goal?', 12, 'Pratt2016', false, 1221),
  ('pressure', 'What does {name} look like after the defense hangs {name} out to dry?', 12, 'Pratt2016', false, 1222),
  ('pressure', 'What is the most likely way {name} steals a period?', 12, 'Pratt2016', false, 1223),
  ('story', 'Is {name} a rhythm goalie, battler, backbone player, confidence goalie, or chaos-survivor?', 12, 'Pratt2016', false, 1224),
  ('story', 'What headline does {name} create after a 35-save win?', 12, 'Pratt2016', false, 1225),
  ('story', 'What headline does {name} create after a rough night?', 12, 'Pratt2016', false, 1226),
  ('flavor', 'Does {name} have any visible crease or bench habits?', 12, 'Pratt2016', false, 1227),
  ('flavor', 'Does {name} reset {name}''s posts, talk to themselves, tap the crossbar, pace, or stew?', 12, 'Pratt2016', false, 1228),
  ('flavor', 'What does {name}''s big-save reaction feel like?', 12, 'Pratt2016', false, 1229),
  ('hockey', 'Does {name} prefer rush offense or set-zone offense?', 13, 'joseph4577', false, 1230),
  ('hockey', 'Is {name} a late-game player when protecting a lead, when chasing a goal, or only one of those?', 13, 'joseph4577', false, 1231),
  ('hockey', 'Is {name} a player coaches protect, unleash, or balance?', 13, 'joseph4577', false, 1232),
  ('hockey', 'Is {name} better off the cycle, off the rush, or arriving late into space?', 13, 'joseph4577', false, 1233),
  ('hockey', 'Is {name} more of a shooter, finisher, transporter, forechecker, or chaos creator?', 13, 'joseph4577', false, 1234),
  ('hockey', 'What is {name}''s best offensive habit?', 13, 'joseph4577', false, 1235),
  ('hockey', 'What is {name}''s most frustrating offensive habit?', 13, 'joseph4577', false, 1236),
  ('hockey', 'What kind of center brings out the best in {name}?', 13, 'joseph4577', true, 1237),
  ('hockey', 'What kind of linemate makes {name} worse?', 13, 'joseph4577', true, 1238),
  ('hockey', 'What kind of winger is {name} at {name}''s best?', 13, 'joseph4577', false, 1239),
  ('hockey', 'Where does {name} naturally attack from on the ice?', 13, 'joseph4577', false, 1240),
  ('room', 'Is {name} a captain-adjacent voice or more of an energy piece?', 13, 'joseph4577', false, 1241),
  ('room', 'Is {name} a momentum guy, mood guy, chirp guy, music guy, comic relief guy, or something else?', 13, 'joseph4577', false, 1242),
  ('room', 'When the team is flat, does {name} usually wake it up or disappear with it?', 13, 'joseph4577', false, 1243),
  ('pressure', 'Does {name} get impatient when a game slows down?', 13, 'joseph4577', false, 1244),
  ('pressure', 'What does {name} look like after missing a huge chance?', 13, 'joseph4577', false, 1245),
  ('pressure', 'What does {name} look like after scoring?', 13, 'joseph4577', false, 1246),
  ('pressure', 'What is the most likely way {name} takes over a period?', 13, 'joseph4577', false, 1247),
  ('story', 'Is {name} a streak player, confidence player, heartbeat player, agitator, or matchup-dependent player?', 13, 'joseph4577', false, 1248),
  ('story', 'What headline does {name} create after a two-goal night?', 13, 'joseph4577', false, 1249),
  ('flavor', 'Does {name} reenact plays, chirp constantly, tap {name}''s stick, pace, or stew?', 13, 'joseph4577', false, 1250),
  ('flavor', 'What does {name}''s goal celebration feel like?', 13, 'joseph4577', false, 1251)
) AS v("part", "question", "player_id", "gamertag", "about_teammate", "sort_order")
JOIN "players" p ON p."id" = v."player_id" AND lower(p."gamertag") = lower(v."gamertag")
ON CONFLICT DO NOTHING;

COMMIT;
