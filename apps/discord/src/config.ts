export interface PosterConfig {
  webhookUrl: string | null
  internalToken: string
  webBaseUrl: string
  siteUrl: string
  dryRun: boolean
  outDir: string
  pollIntervalMs: number
  renderTimeoutMs: number
}

export type ConfigResult = { ok: true; config: PosterConfig } | { ok: false; problems: string[] }

const WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/',
]

const trimSlash = (s: string) => s.replace(/\/+$/, '')

function intOr(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

/**
 * Reads the poster's environment. Problems never echo a secret's value.
 * Not dry-run and no webhook ⇒ not ok: the service idles and posts nothing.
 */
export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = []
  const dryRun = env['DISCORD_DRY_RUN'] === '1'
  const webhook = env['DISCORD_WEBHOOK_URL']?.trim() || null
  const token = env['DISCORD_INTERNAL_TOKEN'] ?? ''
  const web = env['WEB_INTERNAL_URL']?.trim() ?? ''

  if (webhook === null && !dryRun)
    problems.push('DISCORD_WEBHOOK_URL is unset and DISCORD_DRY_RUN is not 1')
  if (webhook !== null && !WEBHOOK_PREFIXES.some((p) => webhook.startsWith(p))) {
    problems.push('DISCORD_WEBHOOK_URL is not a Discord webhook URL')
  }
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
      outDir: env['DISCORD_OUT_DIR']?.trim() || '/tmp/discord-out',
      pollIntervalMs: intOr(env['DISCORD_POLL_INTERVAL_MS'], 60000),
      renderTimeoutMs: intOr(env['DISCORD_RENDER_TIMEOUT_MS'], 30000),
    },
  }
}
