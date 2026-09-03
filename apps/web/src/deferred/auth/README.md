# Deferred: the account / authentication system

**Status: DORMANT. Nothing in this directory is imported by the app.**

Authentication is deliberately disabled for the pre-launch site. The pre-launch
product is public and read-only: there is no login, no account, no invitation,
no session, no administration, and no initial-admin bootstrap. The
implementation was not deleted — it is parked here so the post-launch account
feature can be reviewed and re-enabled on its own merits rather than rewritten
from scratch.

## Why this directory, and not `src/app/`

Next.js App Router derives routes from `page.tsx` / `route.ts` files under
`src/app/`. Files here are outside that tree, so **no path in this directory is
routable**, whatever it is named. `account-actions.ts` additionally has its
`'use server'` directive removed: that directive is what mints POST-able Server
Action ids, and a dormant module must mint none.

## What is live instead

| Path                                           | Live behaviour                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/login`, `/account`, `/me`, `/admin/accounts` | **no module exists** — Next's own 404, exactly like any URL this site never had           |
| `/api/auth/*`                                  | a tombstone route handler that imports nothing; every exported method returns 404         |
| `src/app/account-actions.ts`                   | same export names, every one throws before any auth call, query, hash, redirect, or write |

The pages are deleted rather than turned into 404-returning tombstones, and
that was forced by measurement rather than taste. This app has a root
`src/app/loading.tsx`, so every page renders inside a Suspense boundary whose
shell is flushed before the page component runs; a `notFound()` thrown after
that cannot change a status already sent, and tombstone pages served **200**
with 404 content. `export const dynamic = 'force-dynamic'` did not help. With
no module, the router 404s the request before any rendering — which is both
correct and the stronger statement.

Nothing that is still live imports this directory, and nothing live imports
`better-auth`. A disabled request must not initialise Better Auth merely to
produce a 404, and it does not: the `/api/auth/*` handler and the
`account-actions.ts` stubs have **no imports at all**.

## Re-enabling this, after launch

There is deliberately **no environment variable** that turns authentication back
on. A runtime switch is exactly the failure mode to avoid — an env var set by
accident on the deployment host would republish the whole account surface with
no review. Re-enabling requires a source change:

1. Move these modules back to their route paths (`login-page.tsx` →
   `src/app/login/page.tsx`, and so on), restoring their `@/lib/auth` and
   `@/app/account-actions` imports, and replace the `/api/auth/*` tombstone
   with `auth-api-route.ts`.
2. Restore `'use server'` at the top of `account-actions.ts`.
3. Restore the auth CTA in `src/components/nav/top-nav.tsx` and
   `src/components/nav/nav-drawer.tsx`.
4. Restore the operator CLI in `apps/worker/src/deferred-auth/init-admin-cli.ts`
   and repoint the `init-admin` package script at it.
5. Delete `src/lib/account-system-disabled.test.ts`,
   `test/auth-routes-disabled.test.ts` and `test/disabled-routes-http.test.ts`,
   which assert the disabled contract and are supposed to fail the moment it
   stops holding.

That is a reviewed change, on purpose.

## What was NOT touched

Account tables, migrations, and any existing account data are intact, as are the
account query functions in `@eanhl/db/queries`. `better-auth` stays a
dependency: removing it would be churn that the post-launch feature only has to
undo.

Disabling authentication closes no other gate. Privacy, legal, backup,
MFA/recovery, and public-exposure work are all still open — see `HANDOFF.md`.
