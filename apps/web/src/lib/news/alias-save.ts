/** Longest nickname the GM can save. */
export const ALIAS_MAX_CHARS = 30

export type AliasState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string }

export const GENERIC_ALIAS_ERROR = 'The nickname could not be saved. Try again later.'

export type AliasInputResult =
  | { ok: true; alias: string; playerId: number }
  | { ok: false; reason: string }

/** Reads and checks the add form. A nickname is trimmed and lowercased (the database wants lowercase). */
export function parseAliasInput(form: FormData): AliasInputResult {
  const raw = form.get('alias')
  const alias = (typeof raw === 'string' ? raw : '').trim().toLowerCase()
  if (alias.length < 1 || alias.length > ALIAS_MAX_CHARS) {
    return { ok: false, reason: `A nickname needs 1 to ${String(ALIAS_MAX_CHARS)} characters.` }
  }
  const rawPlayer = form.get('playerId')
  const playerId = Number(typeof rawPlayer === 'string' ? rawPlayer : '')
  if (!Number.isInteger(playerId) || playerId < 1) {
    return { ok: false, reason: 'Choose a player.' }
  }
  return { ok: true, alias, playerId }
}

export interface SaveAliasDeps {
  /** The press roster: the players a nickname may point to. */
  roster(): Promise<{ playerId: number }[]>
  /** Every saved nickname with the display name of its player. */
  aliases(): Promise<{ alias: string; playerId: number; name: string }[]>
  upsert(alias: string, playerId: number): Promise<void>
  log(message: string): void
}

/**
 * Validates and saves one nickname. A nickname that already belongs to another
 * player is refused with that player's name; it is never moved silently.
 */
export async function saveAlias(form: FormData, deps: SaveAliasDeps): Promise<AliasState> {
  const parsed = parseAliasInput(form)
  if (!parsed.ok) return { status: 'error', message: parsed.reason }
  try {
    const roster = await deps.roster()
    if (!roster.some((p) => p.playerId === parsed.playerId)) {
      return { status: 'error', message: 'Choose a player from the list.' }
    }
    const owner = (await deps.aliases()).find((a) => a.alias === parsed.alias)
    if (owner !== undefined && owner.playerId !== parsed.playerId) {
      return { status: 'error', message: `Already a nickname of ${owner.name}.` }
    }
    if (owner === undefined) await deps.upsert(parsed.alias, parsed.playerId)
    return { status: 'ok', message: `Saved "${parsed.alias}".` }
  } catch (err: unknown) {
    const code = (err as { code?: unknown } | null)?.code
    deps.log(
      `saving a nickname failed (${typeof code === 'string' ? code : err instanceof Error ? err.name : 'error'})`,
    )
    return { status: 'error', message: GENERIC_ALIAS_ERROR }
  }
}
