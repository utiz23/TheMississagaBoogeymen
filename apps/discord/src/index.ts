/**
 * Discord poster entry point. Non-overlapping loop (async wait, like the
 * worker). Reads match data only through the web app's internal routes and
 * writes only discord_posts. Bad config ⇒ log once and idle (no restart loop,
 * no posts).
 *
 * Env: DATABASE_URL, DISCORD_WEBHOOK_URL, DISCORD_INTERNAL_TOKEN,
 * WEB_INTERNAL_URL, DISCORD_DRY_RUN, DISCORD_SITE_URL, DISCORD_OUT_DIR,
 * DISCORD_POLL_INTERVAL_MS, DISCORD_RENDER_TIMEOUT_MS.
 */
import { loadConfig } from './config.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const log = (m: string) => console.log(`[discord] ${m}`)

async function main(): Promise<void> {
  const loaded = loadConfig(process.env)
  if (!loaded.ok) {
    log(`not posting: ${loaded.problems.join('; ')}`)
    for (;;) await sleep(3_600_000)
  }
  const config = loaded.config
  // Imported after the config check so a misconfigured host never opens a DB pool.
  const { listStuckDiscordPosts } = await import('@eanhl/db/queries')
  const { dbStore } = await import('./store.ts')
  const { runPosterCycle, WINDOW_MS, BATCH_LIMIT } = await import('./cycle.ts')
  const { fetchGameResult } = await import('./web-client.ts')
  const { renderStarCards } = await import('./render.ts')
  const { sendWebhook } = await import('./webhook.ts')
  const { writeDryRunFiles } = await import('./dry-run.ts')

  const stuck = await listStuckDiscordPosts(new Date(Date.now() - 10 * 60_000))
  if (stuck.length > 0) log(`left pending by an earlier crash (not retried): ${stuck.join(', ')}`)
  log(`started (${config.dryRun ? 'DRY RUN' : 'live'}), every ${String(config.pollIntervalMs)}ms`)

  const web = { webBaseUrl: config.webBaseUrl, token: config.internalToken }
  for (;;) {
    const start = Date.now()
    try {
      const s = await runPosterCycle(
        {
          store: dbStore,
          fetchGameResult: (matchId) => fetchGameResult({ ...web, matchId }),
          renderCards: (matchId) =>
            renderStarCards({ ...web, matchId, timeoutMs: config.renderTimeoutMs }),
          send: (payload, image) => {
            if (config.webhookUrl === null) throw new Error('no webhook configured')
            return sendWebhook(config.webhookUrl, payload, image)
          },
          writeDryRun: async (matchId, payload, image) => {
            log(`dry run → ${await writeDryRunFiles(config.outDir, matchId, payload, image)}`)
          },
          log,
          now: () => new Date(),
        },
        {
          dryRun: config.dryRun,
          siteUrl: config.siteUrl,
          windowMs: WINDOW_MS,
          batchLimit: BATCH_LIMIT,
        },
      )
      if (s.posted + s.failed + s.dryRun > 0) log(`cycle: ${JSON.stringify(s)}`)
    } catch (err: unknown) {
      log(`cycle error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(Math.max(0, config.pollIntervalMs - (Date.now() - start)))
  }
}

main().catch((err: unknown) => {
  console.error('[discord] fatal:', err)
  process.exit(1)
})
