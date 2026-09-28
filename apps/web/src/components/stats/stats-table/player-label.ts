export interface PlayerMeta {
  jerseyNumber: number | null
  preferredPosition: string | null
  position: string | null
  lastSeenIso: string | null
}

const POSITION_ABBR: Record<string, string> = {
  center: 'C',
  leftWing: 'LW',
  rightWing: 'RW',
  defenseMen: 'D',
  leftDefenseMen: 'LD',
  rightDefenseMen: 'RD',
  goalie: 'G',
}

/** Map a stored position to its abbreviation; unknown values pass through, blank → null. */
export function abbreviatePosition(pos: string | null | undefined): string | null {
  if (pos === null || pos === undefined || pos === '') return null
  return POSITION_ABBR[pos] ?? pos
}

/** Jersey (`#85`) and position for the second line under the name. Prefers preferredPosition. */
export function playerSubline(
  meta: PlayerMeta | undefined,
  fallbackPosition: string | null,
): { jersey: string | null; pos: string | null } {
  const jersey = meta?.jerseyNumber != null ? `#${meta.jerseyNumber.toString()}` : null
  const pos = abbreviatePosition(meta?.preferredPosition ?? meta?.position ?? fallbackPosition)
  return { jersey, pos }
}

/** Accessible title text: name, jersey, last-known position, last local capture. */
export function playerTooltip(
  meta: PlayerMeta | undefined,
  gamertag: string,
  fallbackPosition: string | null,
): string {
  const { jersey, pos } = playerSubline(meta, fallbackPosition)
  const parts: string[] = [gamertag]
  if (jersey !== null) parts.push(jersey)
  if (pos !== null) parts.push(`${pos} (last known position)`)
  if (meta?.lastSeenIso != null) parts.push(`Last locally captured ${meta.lastSeenIso}`)
  return parts.join(' · ')
}
