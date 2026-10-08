import { MYTHIC_THEMES, type MythicThemeKey } from '@eanhl/db/cards'

/** `title`: game title slug of the season card, or null for the default title. */
export type MythicCommand =
  | { player: string; title: string | null; action: 'award'; theme: MythicThemeKey }
  | { player: string; title: string | null; action: 'clear' }

export const MYTHIC_USAGE =
  'usage: card-mythic --player "<gamertag>" [--title <slug>] (--theme <' +
  MYTHIC_THEMES.join('|') +
  '> | --clear)'

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

export function parseMythicArgs(argv: readonly string[]): MythicCommand {
  const player = flag(argv, 'player')
  if (player === undefined || player.trim() === '')
    throw new Error(`--player is required\n${MYTHIC_USAGE}`)
  const titleFlag = flag(argv, 'title')
  if (
    argv.includes('--title') &&
    (titleFlag === undefined || titleFlag.trim() === '' || titleFlag.startsWith('--'))
  )
    throw new Error(`--title needs a game title slug\n${MYTHIC_USAGE}`)
  const title = titleFlag ?? null
  const theme = flag(argv, 'theme')
  const clear = argv.includes('--clear')
  if ((theme === undefined) === !clear)
    throw new Error(`pass exactly one of --theme or --clear\n${MYTHIC_USAGE}`)
  if (clear) return { player, title, action: 'clear' }
  if (!(MYTHIC_THEMES as readonly string[]).includes(theme ?? '')) {
    throw new Error(`theme must be one of ${MYTHIC_THEMES.join(', ')}\n${MYTHIC_USAGE}`)
  }
  return { player, title, action: 'award', theme: theme as MythicThemeKey }
}
