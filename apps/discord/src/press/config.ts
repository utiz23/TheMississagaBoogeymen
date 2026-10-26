import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { amountOr, intOr, trimSlash } from '../env-parse.ts'

export type PressMode = 'trial' | 'live'

export interface PressDiscord {
  mode: PressMode
  tokens: Record<ReporterId, string>
  guildId: string
  /** The test channel in trial, #chel in live. */
  channelId: string
  gmUserId: string
}

export interface PressConfig extends PressDiscord {
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  model: string
  monthlyLimitUsd: number
  pollIntervalMs: number
}

type Env = Record<string, string | undefined>

/**
 * A Discord ID (snowflake): 17–20 digits. Copy of DISCORD_USER_ID_RE in
 * packages/db/src/queries/discord-ids.ts: that module opens the DB pool when
 * imported, and the config check must run before any DB code loads.
 */
const DISCORD_ID_RE = /^[0-9]{17,20}$/

/** Live only on exactly `live`. Anything else is trial (fail-closed). */
function pressMode(env: Env): PressMode {
  return env['PRESS_MODE'] === 'live' ? 'live' : 'trial'
}

/**
 * Reads the Discord side of the press: mode, the nine bot tokens, guild,
 * channel and GM. Problems name the variable, never its value (tokens are
 * secrets). Trial needs the test channel, live needs the live channel.
 */
export function loadPressDiscord(
  env: Env,
): { ok: true; value: PressDiscord } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const mode = pressMode(env)

  const tokens = {} as Record<ReporterId, string>
  for (const id of REPORTER_IDS) {
    const name = `PRESS_TOKEN_${id.toUpperCase()}`
    const token = env[name]?.trim() ?? ''
    if (token === '') problems.push(`${name} is unset`)
    else tokens[id] = token
  }

  const snowflake = (name: string): string => {
    const v = env[name]?.trim() ?? ''
    if (!DISCORD_ID_RE.test(v)) {
      problems.push(`${name} is unset or not a Discord ID`)
      return ''
    }
    return v
  }
  const guildId = snowflake('PRESS_GUILD_ID')
  const gmUserId = snowflake('PRESS_GM_USER_ID')
  const channelId = snowflake(mode === 'live' ? 'PRESS_LIVE_CHANNEL_ID' : 'PRESS_TEST_CHANNEL_ID')

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { mode, tokens, guildId, channelId, gmUserId } }
}

/**
 * Reads the press process's whole environment. The API key is checked for
 * presence only and is never stored in the config.
 */
export function loadPressConfig(
  env: Env,
): { ok: true; config: PressConfig } | { ok: false; problems: string[] } {
  const discord = loadPressDiscord(env)
  const problems = discord.ok ? [] : [...discord.problems]
  const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
  const web = env['WEB_INTERNAL_URL']?.trim() ?? ''

  if ((env['ANTHROPIC_API_KEY']?.trim() ?? '') === '') problems.push('ANTHROPIC_API_KEY is unset')
  if (token.length < 16)
    problems.push('DISCORD_INTERNAL_TOKEN is unset or shorter than 16 characters')
  if (web === '') problems.push('WEB_INTERNAL_URL is unset')

  if (!discord.ok || problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    config: {
      ...discord.value,
      internalToken: token,
      webBaseUrl: trimSlash(web),
      siteUrl: trimSlash(env['DISCORD_SITE_URL']?.trim() || 'https://boogeymen.app'),
      model: env['NEWS_MODEL']?.trim() || 'claude-opus-5-5',
      monthlyLimitUsd: amountOr(env['NEWS_MONTHLY_LIMIT_USD'], 20),
      pollIntervalMs: intOr(env['PRESS_POLL_INTERVAL_MS'], 15000),
    },
  }
}
