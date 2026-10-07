import { MYTHIC_THEMES, type MythicThemeKey } from '@eanhl/db/cards'

export type MythicCommand =
  | { player: string; action: 'award'; theme: MythicThemeKey }
  | { player: string; action: 'clear' }

export const MYTHIC_USAGE =
  'usage: card-mythic --player "<gamertag>" (--theme <' + MYTHIC_THEMES.join('|') + '> | --clear)'

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

export function parseMythicArgs(argv: readonly string[]): MythicCommand {
  const player = flag(argv, 'player')
  if (player === undefined || player.trim() === '')
    throw new Error(`--player is required\n${MYTHIC_USAGE}`)
  const theme = flag(argv, 'theme')
  const clear = argv.includes('--clear')
  if ((theme === undefined) === !clear)
    throw new Error(`pass exactly one of --theme or --clear\n${MYTHIC_USAGE}`)
  if (clear) return { player, action: 'clear' }
  if (!(MYTHIC_THEMES as readonly string[]).includes(theme ?? '')) {
    throw new Error(`theme must be one of ${MYTHIC_THEMES.join(', ')}\n${MYTHIC_USAGE}`)
  }
  return { player, action: 'award', theme: theme as MythicThemeKey }
}
