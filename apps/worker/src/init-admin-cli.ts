/**
 * `pnpm --filter worker init-admin` — DISABLED. This command fails closed.
 *
 * Authentication is deferred until after launch. The pre-launch site is public
 * and has no login, account, invitation, session, or administration surface, so
 * there is no initial admin to create and nothing for one to do.
 *
 * FAILS CLOSED, AND IN THAT ORDER
 * -------------------------------
 * This module imports NOTHING — not `@eanhl/db`, not `@eanhl/db/queries`, not
 * `better-auth/crypto`. There is therefore no import-time database client, no
 * connection, no `users` query, and no password prompt anywhere on this path:
 * the refusal below is the first and only thing that runs, and it runs
 * identically whether or not `DATABASE_URL` is set and whether or not stdin is
 * a terminal. Nothing is read from stdin, so a piped password is never
 * consumed.
 *
 * It exits non-zero on every invocation, with every combination of arguments —
 * including `--help`, `--list-players`, and `--dry-run`. There is no argument
 * and no environment variable that turns it back on; a runtime switch is
 * exactly the accident this is written to prevent.
 *
 * The implementation is parked, dormant and self-executing-tail removed, in
 * ./deferred-auth/init-admin-cli.ts. Restoring it is a reviewed source change
 * after launch — see apps/web/src/deferred/auth/README.md.
 *
 * Covered by ./__tests__/init-admin-cli.test.ts.
 */

console.error(
  '[init-admin] refusing: the account system is disabled before launch. ' +
    'Authentication is deferred until after launch, so there is no initial ' +
    'admin to create and no page to sign in on. Nothing was read, connected ' +
    'to, or written. Re-enabling requires a reviewed source change — see ' +
    'apps/web/src/deferred/auth/README.md.',
)
process.exit(1)
