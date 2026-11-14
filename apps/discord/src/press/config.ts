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
  /**
   * T8: the bot test channel (`PRESS_TEST_CHANNEL_ID`). `/gm testscrum` posts only here, also in
   * live mode. In trial it is the press channel itself. Optional: live without it has no test scrum.
   */
  testChannelId?: string
}

export interface PressConfig extends PressDiscord {
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  model: string
  monthlyLimitUsd: number
  pollIntervalMs: number
  /**
   * Typed answers in scrum threads (`PRESS_TYPED_ANSWERS=1`). Needs the Message
   * Content intent switched on for Wade Barlow in the Discord portal: the
   * intents are requested only when this is on. Fail-closed default: off.
   */
  typedAnswers: boolean
  /**
   * T4: a reporter may answer a member's Discord Reply to its post in the
   * press channel (`PRESS_WIRE_REPLIES=1`). Needs `typedAnswers` (the same
   * intents). Fail-closed default: off. Optional so older fakes stay valid.
   */
  wireReplies?: boolean
  /**
   * T7: Discord user ids of the coach (`PRESS_COACH_USER_IDS`, a comma list). A coach is named
   * "Coach <server nickname>" and asked as the coach. Empty = no coach. Optional so older fakes
   * stay valid.
   */
  coachUserIds?: string[]
  /** T7: the role a bench person needs (the "Chel" role; default `CHEL_ROLE_ID`). */
  benchRoleId?: string
}

/** The 🏒 Chel role of the guild (the people who may be on the bench). */
export const CHEL_ROLE_ID = '1423500221148696659'

/**
 * The coach ids of a comma list. A value that is not a Discord ID is dropped (never a guess); the
 * names only the problems use, never an ID in a log.
 */
export function parseUserIdList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => DISCORD_ID_RE.test(v))
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
  // T8: the test channel for `/gm testscrum`. Live does not need it (a bad value is dropped).
  const testRaw = env['PRESS_TEST_CHANNEL_ID']?.trim() ?? ''
  const testChannelId = mode === 'trial' ? channelId : DISCORD_ID_RE.test(testRaw) ? testRaw : ''
  return {
    ok: true,
    value: {
      mode,
      tokens,
      guildId,
      channelId,
      gmUserId,
      ...(testChannelId === '' ? {} : { testChannelId }),
    },
  }
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
      // On only for exactly `1`: anything else keeps the extra intents off.
      typedAnswers: env['PRESS_TYPED_ANSWERS']?.trim() === '1',
      // On only for exactly `1`, and only with typed answers (Barlow must read messages).
      wireReplies:
        env['PRESS_TYPED_ANSWERS']?.trim() === '1' && env['PRESS_WIRE_REPLIES']?.trim() === '1',
      coachUserIds: parseUserIdList(env['PRESS_COACH_USER_IDS']),
      benchRoleId: DISCORD_ID_RE.test(env['PRESS_BENCH_ROLE_ID']?.trim() ?? '')
        ? env['PRESS_BENCH_ROLE_ID']!.trim()
        : CHEL_ROLE_ID,
    },
  }
}
