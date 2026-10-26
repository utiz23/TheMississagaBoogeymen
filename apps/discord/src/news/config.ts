import { amountOr, intOr, trimSlash } from '../env-parse.ts'
import { loadPressDiscord, type PressDiscord } from '../press/config.ts'

export interface NewsConfig {
  webhookUrl: string | null
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  dryRun: boolean
  outDir: string
  pollIntervalMs: number
  model: string
  monthlyLimitUsd: number
  apiKeyPresent: boolean
  /** Set only when PRESS_MODE=live: the reporters post as bots, not by webhook. */
  bots: PressDiscord | null
}

export type NewsConfigResult = { ok: true; config: NewsConfig } | { ok: false; problems: string[] }

const WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/',
]

/**
 * Reads the news desk's environment. Problems name the variable, never its
 * value (the webhook URL and the API key are secrets). Not ok ⇒ the service
 * idles: it writes nothing and posts nothing. Test mode is fail-closed:
 * anything but an explicit NEWS_DRY_RUN=0 is a dry run. The API key is
 * needed in both modes (a dry run still writes with Claude). With
 * PRESS_MODE=live the reporters post as bots: `bots` is set, and no webhook
 * is needed.
 */
export function loadNewsConfig(env: Record<string, string | undefined>): NewsConfigResult {
  const problems: string[] = []
  const dryRun = env['NEWS_DRY_RUN']?.trim() !== '0'
  const webhook = env['NEWS_WEBHOOK_URL']?.trim() || null
  const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
  const web = env['WEB_INTERNAL_URL']?.trim() ?? ''
  const apiKeyPresent = (env['ANTHROPIC_API_KEY']?.trim() ?? '') !== ''

  // Live press mode: the reporters post as bots, so no webhook is needed and
  // the PRESS_* problems are news problems. Any other mode ignores PRESS_*.
  let bots: PressDiscord | null = null
  if (env['PRESS_MODE'] === 'live') {
    const press = loadPressDiscord(env)
    if (press.ok) bots = press.value
    else problems.push(...press.problems)
  }

  if (webhook === null && !dryRun && env['PRESS_MODE'] !== 'live')
    problems.push('NEWS_WEBHOOK_URL is unset and NEWS_DRY_RUN is 0')
  if (webhook !== null && !WEBHOOK_PREFIXES.some((p) => webhook.startsWith(p))) {
    problems.push('NEWS_WEBHOOK_URL is not a Discord webhook URL')
  }
  if (!apiKeyPresent) problems.push('ANTHROPIC_API_KEY is unset')
  if (token.length < 16)
    problems.push('DISCORD_INTERNAL_TOKEN is unset or shorter than 16 characters')
  if (web === '') problems.push('WEB_INTERNAL_URL is unset')

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    config: {
      webhookUrl: webhook,
      internalToken: token,
      webBaseUrl: trimSlash(web),
      siteUrl: trimSlash(env['DISCORD_SITE_URL']?.trim() || 'https://boogeymen.app'),
      dryRun,
      outDir: env['NEWS_OUT_DIR']?.trim() || '/tmp/news-out',
      pollIntervalMs: intOr(env['NEWS_POLL_INTERVAL_MS'], 60000),
      model: env['NEWS_MODEL']?.trim() || 'claude-opus-5-5',
      monthlyLimitUsd: amountOr(env['NEWS_MONTHLY_LIMIT_USD'], 20),
      apiKeyPresent,
      bots,
    },
  }
}
