/**
 * Who may equip a card theme (member logins step 1; operator 2026-10-09):
 * the member linked to that player, or an admin for any player.
 */
export function canEditPlayerCard(
  viewer: { role: string; playerId: number | null } | null,
  playerId: number,
): boolean {
  if (viewer === null) return false
  return viewer.role === 'admin' || viewer.playerId === playerId
}
