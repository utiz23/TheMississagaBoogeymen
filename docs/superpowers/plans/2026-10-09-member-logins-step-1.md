# Member logins — Step 1: Discord login + Card Locker EQUIP

## Context

boogeymen.app is live and read-only. The operator (Silky = `silkyjoker85`, player id 2, webmaster) wants
member logins to unlock: (A) players customizing their own card, (B) players editing their own profile,
(C) admin tools in the browser. Work is split into three separately-shipped steps; **this plan is Step 1
only**: Discord login (invite-only) + a working EQUIP button in the Card Locker. B and C get their own plans.

A full email/password login system was built pre-launch and parked in `apps/web/src/deferred/auth/`
(Better Auth 1.6.33, invites pre-bound to a player, user/admin roles). Its tables already exist on the live DB
(0 users). Guard tests currently *enforce* that it's off. The Card Locker was designed to wait for logins
(spec `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md` D1/D10: EQUIP shown but disabled).

### Operator decisions (2026-10-09)
- Log in **with Discord only**; no passwords. **Invite-only** — nobody can self-register.
- Ask Discord for **`identify` only — no email**. Store only Discord id + display name. No Discord tokens,
  no avatar, no IP/user-agent on sessions.
- **One admin: Silky** (player 2), bootstrapped by a one-time server command that prints an admin invite link.
- EQUIP: a player can equip their **own** card; **admin can equip anyone's**.
- **One choice for all game titles**; if the theme isn't unlocked on a given title's card, that card shows AUTO.
- **Mythics: only the awarded one** is equippable; other mythics stay locked previews.
- **A pick sticks through tier-ups** until the player switches back to AUTO.

## How it works (plain version)
1. Silky runs one command on Hotel-Echo → gets a private link → opens it → "Sign in with Discord" → he's
   admin, linked to silkyjoker85.
2. On `/admin/accounts` he picks a teammate's player → gets a one-time invite link (24h or 7d) → sends it on Discord.
3. Teammate opens link → Discord → lands on `/account`, linked to their player. Later visits: "LOG IN" in nav → one click.
4. On their own player page, EDIT → Card Locker → EQUIP any theme they've unlocked, or AUTO.

## Key technical decisions (verified against installed Better Auth source)
- Discord provider: `disableImplicitSignUp: true`, `disableDefaultScope: true, scope: ['identify']`,
  `mapProfileToUser` → email `discord-<id>@users.invalid` (keeps `users.email NOT NULL UNIQUE` untouched;
  never deliverable). Returning members sign in without sign-up; invite acceptance passes
  `requestSignUp: true, additionalData: { inviteToken }` (carried in Better Auth's server-side OAuth state).
- **Security gate = `databaseHooks.user.create.before`**: re-validates the invite from `getOAuthState()`; any
  user creation without a valid invite is rejected (fails closed). `user.create.after` runs one Drizzle
  transaction: lock invite, insert player claim, set role, mark accepted; on failure delete the user and throw.
- `session.create.before` refuses a session if user missing, disabled, or has **no player claim** — so a
  half-created user can never sign in. Strips IP/user-agent.
- `account.create.before` nulls Discord access/refresh/id tokens.
- Auth instance built lazily (`getAuth()`); in production it throws on missing/short secret, non-https
  `BETTER_AUTH_URL`, or missing Discord creds → only auth routes fail, rest of site unaffected. Removes the
  parked hardcoded dev-secret fallback.
- `disabledPaths` closes every email/password/reset/link/update/delete endpoint. Built-in rate limit, keyed on
  `cf-connecting-ip`. Secure cookies; `serverActions.allowedOrigins: ['boogeymen.app']` (first Server Actions
  behind the tunnel).
- Card prefs in a **separate table `player_card_prefs`** (worker overwrites `player_card_progress`; spec
  already planned this). `theme NULL` = AUTO.
- Nav sign-in control is a small client component fetching `/api/auth/get-session`, so the layout never reads
  `headers()`.

## Commits (on branch `feat/member-logins`; two deploys)

**1. `feat(db): Discord invites + card prefs schema (migration 0065)`**
- `packages/db/migrations/0065_discord_invites_card_prefs.sql` (hand-written, idempotent, 0064 pattern):
  `account_invites.email` and `invited_by_user_id` DROP NOT NULL (bootstrap invite has no inviter);
  `CREATE TABLE player_card_prefs (player_id PK→players ON DELETE CASCADE, theme text NULL,
  updated_by_user_id →users ON DELETE SET NULL, updated_at)`.
- Mirror in `packages/db/src/schema/accounts.ts`; new `schema/card-prefs.ts`.
- `packages/db/src/queries/accounts.ts`: `createAccountInvite` (no email; revokes other pending invites for
  that player), pure `evaluateInvite()` → `ok|expired|revoked|accepted|player_claimed|not_found`,
  `acceptInviteForNewUser({token,userId})` (one tx, `FOR UPDATE`), `deleteAccountUser`, `revokeUserSessions`,
  `hasAdminUser`. Reuse existing `hashAccountInviteToken`, `getAccountInviteByToken`, `listAccountUsers`,
  `listAccountInvites`, `revokeAccountInvite`, `setAccountDisabled`, `getAccountUserById`.
- Verify: db unit tests for `evaluateInvite`; integration on `eanhl_test`; apply migration to `eanhl_test`,
  `eanhl_preview`, then **live** (only relaxes/adds — old code unaffected; will ask before touching live).

**2. `feat(web): enable Better Auth — Discord-only, invite-gated`**
- New `apps/web/src/lib/auth.ts` (rewritten from `deferred/auth/better-auth.ts`): `getAuth()`,
  `getCurrentUser`, `requireUser`, `requireAdmin`, cached `getViewer()`; config per decisions above.
- `apps/web/src/app/api/auth/[...all]/route.ts` → real handler.
- Delete tombstones + `src/deferred/auth/` + disabled-contract tests (`account-system-disabled.test.ts`,
  `test/auth-routes-disabled.test.ts`, stub if unused). Add `src/lib/auth-contract.test.ts` asserting the
  *enabled* contract (no email/password, scope exactly `identify`, implicit sign-up off, disabledPaths, no
  secret fallback, prod env check throws).
- Remove obsolete password queries (`createInvitedAccount`, `createInitialAdmin`, `getUserByEmail`,
  `markInviteAcceptedAndAssignPlayer`).
- `.env.example`, `docker-compose.yml` web env: add `DISCORD_CLIENT_ID/SECRET`.

**3. `feat(web): /login, /invite/[token], /account + nav LOG IN`**
- `src/app/auth-actions.ts` (`startDiscordSignIn`, `startInviteSignIn`, `signOut`).
- Pages: `/login` (one Discord button; errors mapped from a fixed dictionary), `/invite/[token]` (shows player +
  role or why it's unusable), `/account` (Discord name, linked player link, role, sign out, admin link).
- `src/components/nav/nav-account.tsx` in `top-nav.tsx` + `nav-drawer.tsx`.
- `test/disabled-routes-http.test.ts` → `test/auth-http.test.ts`: email endpoints 404, get-session 200/null,
  `/login` has no password field, `/account` & `/admin/accounts` redirect when signed out, bad invite renders
  (not 500), **all existing security-header checks kept**. Legal tests unchanged (legal pages still don't link
  to /login).

**4. `feat(worker): one-time admin invite CLI`**
- `apps/worker/src/init-admin-cli.ts`: `--player-id`, `--hours`, `--base-url`, `--dry-run`; refuses if an
  admin exists; prints `<base>/invite/<token>` once (only the hash is stored). Delete
  `apps/worker/src/deferred-auth/`; rewrite `init-admin-cli.test.ts`; update `DEPLOY.md`.

**5. `feat(web): /admin/accounts for Discord invites`**
- Create invite (unclaimed player, role, 24h/7d; link shown once with copy button), revoke invite, disable
  user (not yourself; also kills their sessions). Users + invites lists. No claim reassignment (Step 3).

**6. `docs(legal): member sign-in via Discord`** — must ship in the same image as 2–5.
- `apps/web/src/content/legal/data-collection.tsx` §7, `privacy.tsx` (~107-121, cookies), `terms.tsx` (:56,
  :278): invite-only accounts, Discord `identify` only, what's stored, session cookie, deletion on request.
  Operator reads the final wording.

→ **Deploy A** (logins live, Locker still read-only).

**7. `feat(db): equipped card theme resolution`**
- `packages/db/src/cards/card-theme.ts`: `isThemeEquippable(theme, tier, mythic)` (normal themes:
  `themeTier ≤ tier`; mythic: only `tier 6 && theme === awarded mythic`) and
  `resolveEquippedTheme(tier, mythic, pref)` (pref if equippable, else existing `resolveCardTheme`). Tests:
  non-awarded mythic locked, pick survives tier-up, older title falls back to AUTO.
- `packages/db/src/queries/cards.ts`: left-join `player_card_prefs` in `getPlayerCardProgress` and
  `getCardProgressForPlayers` (:193); add `setPlayerCardPref`.
- `apps/web/src/components/cards/card-adapters.ts:194` uses `resolveEquippedTheme`. With no prefs rows every
  surface renders exactly as today.

**8. `feat(web): Card Locker EQUIP for own card (+admin)`**
- `locker-model.ts`: `LockerInput` gains `mythicTheme`, `pref`, `canEdit`; `LockerView` gains `auto`,
  `canEdit`; `buildThemes` uses `isThemeEquippable`, `EQUIPPED (AUTO)` only when pref is null.
- `apps/web/src/app/roster/[id]/page.tsx:241`: `canEdit = admin || viewer.playerId === id`.
- New `apps/web/src/app/roster/[id]/card-actions.ts` `equipCardTheme(playerId, theme|null)`: requireUser →
  own-or-admin check → theme valid & equippable on newest card → `setPlayerCardPref` → `revalidatePath` for
  `/roster/[id]`, `/roster`, `/`.
- `locker-theme-tab.tsx` (`LockerThemeFooter` :151-180, caption :86-88): enable AUTO pill + EQUIP when
  `canEdit`; `useTransition` + `router.refresh()`. Others see "Sign in as this player to equip."
- Close D1/D10 and locker-plan deviations #5/#6/#9 in the spec docs.

→ **Deploy B** (web only).

**9. `docs(handoff)`** + journal entry; save memory that the operator is Silky / admin.

## Operator setup (Silky, before Deploy A — ~10 min, I'll walk you through it)
1. Discord Developer Portal → create two apps: "Boogeymen" (redirect
   `https://boogeymen.app/api/auth/callback/discord`) and "Boogeymen Dev" (redirect
   `http://localhost:3000/api/auth/callback/discord`). No bot.
2. On Hotel-Echo `.env`: `BETTER_AUTH_SECRET` (random 32+ bytes), `BETTER_AUTH_URL` and `APP_BASE_URL` =
   `https://boogeymen.app`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (prod app). Dev values go in local `.env`.

## Deploy A order
1. Migration 0065 on live (done in commit 1). 2. Hotel-Echo: `git pull`, edit `.env`. 3. Tag rollback images
for web + worker. 4. Rebuild + `up -d --no-deps web worker` (docker-redeploy skill). 5. Smoke: get-session 200
with security headers, `POST /api/auth/sign-up/email` 404, `/login` renders. 6.
`docker compose exec worker node dist/init-admin-cli.js --player-id 2` → Silky opens link → admin. 7. Invite
one teammate as a live test.
Rollback: retag rollback images, `up -d`. Migration can stay (additive). Emergency: `DELETE FROM sessions;`.

## Verification
- Each commit: `pnpm --filter @eanhl/db build`, db tests, `pnpm --filter web typecheck`, `pnpm --filter web test`,
  `pnpm --filter worker test`, prettier. (`pnpm lint` is pre-existing red — not a gate.)
- Local end-to-end with the Dev Discord app at exactly `localhost:3000` (note: don't `next build` while a dev
  server is running): admin bootstrap → second Discord account without invite is refused → used / expired invite
  refused → disabled user refused → DB check: no tokens, no IP stored.
- Locker: equip lower theme → hero, home carousel, roster depth chart all show it; AUTO restores; other player's
  card disabled; admin can edit others; forged action call for someone else's player refused.
- Before Deploy A: security review of the auth diff (`/security-review`; Codex second opinion optional) since
  this is the site's first write surface.

## Risks
- `getOAuthState()` inside `user.create.after` must survive Better Auth's queued hooks; if not, design fails
  closed (user deleted, error shown) — proven or disproven by the first local end-to-end run.
- No real DB transaction around Better Auth's user+account insert; covered by compensating delete + "no claim
  → no session".
- First Server Actions behind Cloudflare tunnel — `allowedOrigins` + smoke test.
- Other viewers see someone's new card theme within ~5 min (router cache); the equipper sees it immediately.
- In-memory rate limit resets on restart — fine at ~18 users.
