import { isCurrentUserAdmin } from '@/lib/auth'

/**
 * Visibility gate for the OCR provenance/confidence footers.
 *
 * Those panels ("Captured · Sources · Confidence High · 1.00" over a row of
 * Identity/Build/Bio/X-Factor/Tier/Attributes percentages) are operator
 * diagnostics — they describe how well the OCR pipeline read a match, which is
 * a question about our ingest, not about the game. Hidden from ordinary
 * visitors, shown to admins.
 *
 * Today that resolves to "hidden from everyone": no accounts exist, so
 * `isCurrentUserAdmin()` is false on every request. The check is real rather
 * than a hardcoded `false` so the panels light up the moment an admin account
 * exists, with no further wiring.
 *
 * `OCR_DIAGNOSTICS=1` is the manual override, for seeing them without an
 * account. Deliberately NOT prefixed `NEXT_PUBLIC_`, so it stays server-only
 * and can never be read — or set — from the browser.
 */
export async function showOcrDiagnostics(): Promise<boolean> {
  if (process.env.OCR_DIAGNOSTICS === '1') return true
  return await isCurrentUserAdmin()
}
