# Member logins — Step C: Admin tools

## Context

Step 1 (Discord login, Card Locker EQUIP, Discord picture) and step B (profile self-edit) are live
(plan: [`2026-10-09-member-logins-step-1.md`](2026-10-09-member-logins-step-1.md)). The operator (Silky,
the one admin) still changes several things by hand — a server command for mythic cards, a code edit +
redeploy for trophies, SQL for roster pins and title settings. Step C moves the routine ones into the
browser behind `requireAdmin`.

### Operator decisions (2026-10-09)
- In scope: **admin hub + switches**, **mythic card awards**, **trophy case editor**, **game-title view
  (read-only)**.
- Out: showing club role (decide separately), OCR review tools (OCR on hold), recompute buttons (the
  worker recomputes every cycle), content seasons (feature doesn't exist).
- Game titles stay **read-only** in the browser: a wrong click could restart NHL 26 collection (forbidden —
  club 19224 belongs to another club) or break ingestion (`ea_club_name`). Changes stay a written
  procedure.

### Patterns reused
`/admin/accounts` (server page + `requireAdmin` in the page **and** in every Server Action, form state in a
non-`'use server'` module), `lib/auth.ts` (`requireAdmin`, `getViewer`), the profile/equip actions
(validate → db function → `revalidatePath`), hand-written idempotent migrations (0065 pattern).

## Release C1 — Admin hub, switches, titles view (web only, no schema change)

- `/admin` (new): links to Accounts, Cards, Awards, Titles; `/account`'s admin button points here.
- **Pin to roster** (`/admin` section): list pinned players with Unpin; Pin form picks any non-AI-goalie
  player not already a member. Pinning makes a player a team member (player page, roster, carousel —
  `MEMBER_CONDITION` in `queries/club-members.ts`). New db function `setPlayerPinned(playerId, pinned)`;
  refuses AI goalies. Revalidates the whole site.
- **Sign everyone out**: button with a confirm step; deletes all sessions except the admin's current one
  (`revokeAllSessionsExcept(sessionId)`), so the admin stays in.
- `/admin/titles` (read-only): each title's name, slug, collecting (is_active), default, order, club name,
  match count; a note linking the SQL procedure in `DEPLOY.md`/`HANDOFF.md` and the NHL 26 warning.
- Tests: db function unit/integration (pin refuses AI goalie), action auth via `requireAdmin`, HTTP: every
  `/admin/*` redirects signed-out visitors.

## Release C2 — Mythic card awards (web + worker refactor, no schema change)

- Move the award/clear logic out of `apps/worker/src/card-mythic-cli.ts` into `@eanhl/db`:
  `loadCardTitles`, `loadSeasonTotals` (from `apps/worker/src/card-progression.ts`) and new
  `awardMythic({ playerId, gameTitleId, theme })` / `clearMythic({ playerId, gameTitleId })` — same single
  transaction, same `player_card_events` rows, clear recomputes the stats standing. The CLI keeps working
  on top of them (unchanged arguments).
- `/admin/cards`: card titles (default first); table of current mythics (player, title, theme, since);
  **Award** form (member, title, mythic theme from `MYTHIC_THEMES` with names) and **Clear** per row with a
  confirm. Validation in the action: member exists, title has cards, theme is a mythic.
- Interaction with EQUIP: awarding makes that mythic equippable for the player (rule already in
  `isThemeEquippable`); clearing returns them to AUTO automatically where the pick no longer fits.
- Tests: moved functions keep the CLI's integration test green; new integration test award → T6 + event →
  clear → stats standing + event; worker's recompute still skips manual rows.

## Release C3 — Trophy case editor (migration 0066)

- **Migration 0066** (hand-written, idempotent):
  - `club_awards (id serial PK, kind text check in ('trophy','banner'), trophy text null check in
    ('mvp','defense','rookie'), mode text null check in ('3s','arcade'), game_title_id int FK →
    game_titles, source text null check in ('vote','stats'), reason text null, created_at, updated_at)`
    with a check that a trophy has `trophy`+`source` and a banner has `mode`.
  - `club_award_players (award_id FK → club_awards ON DELETE CASCADE, player_id FK → players, position
    smallint, PK (award_id, player_id))` — real foreign keys, so a typo can't point at a missing player.
  - Seed the 11 current entries from `club-awards.ts` (titles resolved by name; idempotent by checking
    `NOT EXISTS`).
- `getClubAwards()` returns the existing `ClubAward` shape (title name joined), so `awards-model.ts` is
  unchanged; the roster page reads the database instead of the `CLUB_AWARDS` constant (constant removed,
  its comments move into the migration header).
- `/admin/awards`: awards grouped by title; **Add** (trophy or banner; title select; player picker for
  members; for a trophy: vote/stats and, for stats, a reason ≤ 280); **Edit** and **Delete** (confirm).
  Actions revalidate player pages.
- Deploy order: apply 0066 to test/preview/live first (old code ignores the tables), then web.
- Tests: migration seed count = 11 matching the constant; `getClubAwards` output equals the old
  `CLUB_AWARDS` (so every trophy case renders identically); action validation unit tests; HTTP check that
  `/roster/<id>` still shows the same awards.

## Verification (each release)
- `pnpm --filter @eanhl/db build`, web/worker typecheck, web unit, worker tests on a test clone, built-app
  HTTP suites (in the scratch worktree — the operator's dev server on :3100 shares `apps/web/.next`).
- Operator tries it on localhost (preview DB, admin + plain member), then deploy web (C2: + worker),
  rollback image tags, live smoke checks, handoff/journal update.

## Risks
- Pin-to-roster turns a guest into a member everywhere (player page appears) — intended; Unpin reverses.
- Sign-everyone-out also signs out other admins (only one exists) — keeps the caller's session.
- Mythic logic move touches the worker: the CLI and worker recompute must stay green (tests).
- Trophy migration must reproduce today's awards exactly — the equality test guards it.
