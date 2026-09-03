/**
 * Visibility gate for the OCR provenance/confidence footers.
 *
 * Those panels ("Captured · Sources · Confidence High · 1.00" over a row of
 * Identity/Build/Bio/X-Factor/Tier/Attributes percentages) are operator
 * diagnostics — they describe how well the OCR pipeline read a match, which is
 * a question about our ingest, not about the game. Hidden from ordinary
 * visitors.
 *
 * NO AUTH CHECK, deliberately. This used to call `isCurrentUserAdmin()`, which
 * constructed Better Auth and read a session — on `/games/[id]`, a public page.
 * Authentication is disabled before launch: nobody can sign in, so that check
 * could only ever answer false, and keeping it would have left the one active
 * route that still initialised Better Auth on every request.
 *
 * `OCR_DIAGNOSTICS=1` is now the only way to see the panels. It is an operator
 * switch on the deployment host, not an auth mechanism, and it enables no
 * account, login, or session surface. Deliberately NOT prefixed
 * `NEXT_PUBLIC_`, so it stays server-only and can never be read — or set — from
 * the browser.
 *
 * Restoring the admin branch belongs with the post-launch account feature; see
 * src/deferred/auth/README.md.
 */
export function showOcrDiagnostics(): Promise<boolean> {
  return Promise.resolve(process.env.OCR_DIAGNOSTICS === '1')
}
