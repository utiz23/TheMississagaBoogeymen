# Task: Rename the public "Press Room" pages to "News Desk"

- **State:** Running (since 2026-11-14 14:05; task agent of `Lead2`)
- **Lane:** Web
- **Risk:** low (visible text only)
- **Slug:** news-desk-rename (branch `work/news-desk-rename`, worktree `.claude/worktrees/news-desk-rename`)
- **Operator approval:** 2026-11-14 14:05 ("rename Press Room https://boogeymen.app/news To News Desk")
- **Operator gate before merge:** no (screenshot shown with the report)
- **Needs a deploy:** yes: `web` (with the next web deploy; operator's OK)
- **Helper model:** Sonnet

## Goal and visible result

Every visible "Press Room" / "press room" on the public news pages at `/news` reads "News Desk" / "news
desk" (keep the sentence case of each place; headings in the same case style as today). Places found by
the Lead (`git grep -i "press room" -- apps/web`):

- `apps/web/src/app/news/page.tsx`: page title, heading, "The press room opens after the next game
  night.", "How to read the Press Room" link.
- `apps/web/src/app/news/[slug]/page.tsx`: titles and the "← Press Room" back link.
- `apps/web/src/app/news/guide/page.tsx`: title, back link, heading "How to read the Press Room".
- `apps/web/src/app/news/reporters/[reporter]/page.tsx`: title and back link.

Also check the guide page's body text and any web unit test that asserts the old text. **Do not**
change `apps/discord/` (the AI writer's internal "PRESS ROOM" prompt block is not visible and stays),
the URL `/news`, or the admin page `/admin/news`.

## Paths

- **May edit:** `apps/web/src/app/news/`, web unit tests that assert the old text, this task file.
- **Must not touch:** everything else.

## Checks

- `pnpm --filter web typecheck`; `pnpm --filter web test:unit`; prettier on changed files;
  `git grep -i "press room" -- apps/web` shows no hits afterwards.
- **Evidence:** a screenshot of `/news` from the dev server on the live database through the read-only
  tunnel (`?default_transaction_read_only=on`), saved under
  `/tmp/claude-1000/-home-michal-projects-eanhl-team-website/a2a7873b-2807-4e71-85a1-f9e79d57ba31/scratchpad/shots-rename/`.
  Never `pnpm --filter web build` beside a dev server. If a background server or tunnel is denied, say
  so and skip the screenshot.

## Done when (written before the work starts)

- **Done when:** checks pass and no "Press Room" text is left on the public news pages; reason: the
  operator renamed the page.
- **Not done if:** anything outside `apps/web/src/app/news/` and its tests changed.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 14:05 Lead2: written from the operator's request.
- 2026-11-14 14:07 task agent: branch and worktree made, deps installed. Blocked: `git grep -i "press room" -- apps/web` also hits 2 files outside "May edit": `apps/web/src/lib/news/guide.ts` (line 1 comment; line 18 visible guide text "The Press Room has nine reporters...") and `apps/web/src/components/news/press-guide-note.tsx` (line 33 visible heading "How to read the Press Room", shown on every reporter page). No edit made yet. Lead must add these two files to "May edit" (or say to leave them).

Resume: Lead adds `apps/web/src/lib/news/guide.ts` and `apps/web/src/components/news/press-guide-note.tsx` to "May edit"; then rename all hits (7 in app/news pages + 2 files), run checks, screenshot.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):**
- **How it was checked (commands, numbers):**
- **Not done:**
- **Git state:** branch, last commit, rebased on `main` at <hash>, checks pass/fail
