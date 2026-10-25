/** The admin "Discord pings" form: a player and a 17–20 digit ID, or empty to clear. Pure. */
export function parseDiscordIdForm(
  formData: FormData,
): { playerId: number; id: string | null } | { error: string } {
  const playerId = Number(formData.get('playerId'))
  if (!Number.isInteger(playerId) || playerId <= 0) return { error: 'Unknown player.' }
  const raw = String(formData.get('discordUserId') ?? '').trim()
  if (raw === '') return { playerId, id: null }
  if (!/^[0-9]{17,20}$/.test(raw)) return { error: 'A Discord user ID is 17–20 digits.' }
  return { playerId, id: raw }
}
