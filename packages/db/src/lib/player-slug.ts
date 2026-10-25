/**
 * Player page URLs: `/roster/<gamertag slug>` (operator, 2026-10-24), e.g.
 * "Stick Menace" -> `/roster/stick-menace`. Pure and client-safe: the web app's
 * links, its page resolver and any other surface share this one rule.
 *
 * The old numeric URLs (`/roster/2`, still in Discord posts) and a member's
 * earlier gamertags resolve too — the page redirects them to the current slug.
 */

/**
 * Lower-case ASCII letters and digits, every other run of characters one "-",
 * no "-" at either end. Null when nothing is left, or when only digits are left:
 * an all-digit segment is read as a player id, so such a gamertag keeps the
 * numeric URL.
 */
export function playerSlug(gamertag: string): string | null {
  const slug = gamertag
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '' || /^\d+$/.test(slug)) return null
  return slug
}

/** The player page path: the gamertag slug, or the id when there is none. */
export function playerPath(player: { id: number; gamertag: string }): string {
  return `/roster/${playerSlug(player.gamertag) ?? String(player.id)}`
}
