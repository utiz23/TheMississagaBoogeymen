# Task: Rename the public "Press Room" pages to "News Desk"

- **State:** Merged 2026-11-14 14:14 (`fd50d4a3`); `web` deploy waits for the operator's OK (D6)
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

Added by the operator (2026-11-14 ~14:10: "make press room a option in the admin navbar pfp dropdown"): in
`apps/web/src/components/nav/nav-account.tsx`, admins get a "Press Box" item (`/admin/press-box`) right
after "Admin tools" in the account dropdown. Non-admins see no change.

## Paths

- **May edit:** `apps/web/src/app/news/`, web unit tests that assert the old text, this task file; added by Lead2 2026-11-14: `apps/web/src/lib/news/guide.ts`, `apps/web/src/components/news/press-guide-note.tsx`, `apps/web/src/components/nav/nav-account.tsx`.
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
- **Not done if:** anything outside the "May edit" paths changed.

## Stop conditions

Stop and write "Blocked" in the Log when: a path outside "May edit" is needed; the "done when" rule
is unclear; an operator decision is needed; a live write, deploy or anything irreversible comes next.

## Log

- 2026-11-14 14:05 Lead2: written from the operator's request.
- 2026-11-14 14:09 task agent: worktree made. Found 2 more hits outside "May edit" (guide.ts, press-guide-note.tsx). Was blocked.
- 2026-11-14 14:09 Lead2: OK, same Web lane: added `guide.ts`, `press-guide-note.tsx`, `nav-account.tsx` to "May edit". Blocked note cleared.
- 2026-11-14 14:09 operator added: Press Box in the admin dropdown (nav-account.tsx, admins only, after "Admin tools").
- 2026-11-14 14:09 task agent: renamed all hits; `git grep -i "press room" -- apps/web` = 0 hits. Nav item added; `isActive` would light both "Admin tools" and "Press Box" on /admin/press-box, so a one-line `&&` condition keeps "Admin tools" off there only. Checks pass. Screenshot skipped: the read-only tunnel needs Hotel-Echo's DB password and reading it was denied by auto mode; tunnel and server stopped, nothing running.

- 2026-11-14 14:14 Lead2: reviewed the diff; rebased; web typecheck clean, 701/701, prettier clean, 0
  hits. Merged `--ff-only`.

Resume: operator's OK for a `web` deploy (D6); then the Lead checks `/news` live.

## Report (task agent fills when state = Verify)

- **What changed (visible effect):** every "Press Room" on `/news`, `/news/[slug]`, `/news/guide`, `/news/reporters/[reporter]` now reads "News Desk" (page titles, heading, back links "← News Desk", "How to read the News Desk" link and heading and reporter note, "The news desk opens after the next game night.", guide step 1 "The News Desk has nine reporters..."). Admin account dropdown: new "Press Box" item after "Admin tools" (admins only); on /admin/press-box only "Press Box" is active.
- **How it was checked (commands, numbers):** `pnpm --filter web typecheck` clean; `pnpm --filter web test:unit` 701 pass, 0 fail; prettier check on the 7 changed files clean; `git grep -i "press room" -- apps/web` 0 hits. `apps/discord` untouched; `/news` and `/admin/news` unchanged.
- **Not done:** no screenshot (see Log: HE password read denied; no dropdown picture either, and login 500s in read-only preview anyway). No test for the dropdown item.
- **Git state:** branch `work/news-desk-rename`, rebased on `main`, checks pass.
