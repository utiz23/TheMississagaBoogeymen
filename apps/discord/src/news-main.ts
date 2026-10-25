/**
 * News desk entry point (container `news`). Same shape as index.ts, but a
 * separate process: a news error can never stop or delay the game-result and
 * unlock posts of the `discord` service. Non-overlapping loop (async wait).
 * Reads match data only through the web app's internal news routes and
 * writes only its news_* tables. Bad config ⇒ log once and idle (no restart
 * loop, no posts, no Claude calls).
 *
 * Env: DATABASE_URL, NEWS_WEBHOOK_URL, DISCORD_INTERNAL_TOKEN, WEB_INTERNAL_URL,
 * DISCORD_SITE_URL, NEWS_DRY_RUN, NEWS_OUT_DIR, NEWS_POLL_INTERVAL_MS,
 * NEWS_MODEL, NEWS_MONTHLY_LIMIT_USD, ANTHROPIC_API_KEY.
 */
import { loadNewsConfig } from './news/config.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const log = (m: string) => console.log(`[news] ${m}`)

async function main(): Promise<void> {
  const loaded = loadNewsConfig(process.env)
  if (!loaded.ok) {
    log(`not writing: ${loaded.problems.join('; ')}`)
    for (;;) await sleep(3_600_000)
  }
  const config = loaded.config
  // Imported after the config check so a misconfigured host never opens a DB pool.
  const { deleteTestNewsItems } = await import('@eanhl/db/queries')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { newsDbStore } = await import('./news/store.ts')
  const { runNewsCycle, createNewsCycleState } = await import('./news/cycle.ts')
  const { fetchNewsFacts } = await import('./news/web-client.ts')
  const { anthropicModelCall } = await import('./news/writer.ts')
  const { sendWebhook, deleteWebhookMessage } = await import('./webhook.ts')
  const { writeDryRunFiles } = await import('./dry-run.ts')

  if (!config.dryRun) {
    // Release step: nothing written in test mode is ever published (jobs are kept, R8).
    const removed = await deleteTestNewsItems()
    log(`live mode: removed ${String(removed)} test item(s)`)
  }
  log(
    `started (${config.dryRun ? 'DRY RUN' : 'live'}), model ${config.model}, limit ${String(config.monthlyLimitUsd)} USD/month, every ${String(config.pollIntervalMs)}ms`,
  )

  // Reads ANTHROPIC_API_KEY from the environment; the key is never logged.
  const writer = anthropicModelCall(new Anthropic(), config.model)
  const web = { webBaseUrl: config.webBaseUrl, token: config.internalToken }
  const state = createNewsCycleState()
  const webhook = () => {
    if (config.webhookUrl === null) throw new Error('no news webhook configured')
    return config.webhookUrl
  }

  for (;;) {
    const start = Date.now()
    try {
      const s = await runNewsCycle(
        {
          store: newsDbStore,
          fetchFacts: (kind, key) => fetchNewsFacts({ ...web, kind, key }),
          writer,
          send: (payload) => sendWebhook(webhook(), payload, null),
          remove: (messageId) => deleteWebhookMessage(webhook(), messageId),
          writeDryRun: async (key, payload) => {
            log(`dry run → ${await writeDryRunFiles(config.outDir, key, payload, null)}`)
          },
          pause: sleep,
          log,
          now: () => new Date(),
        },
        {
          dryRun: config.dryRun,
          siteUrl: config.siteUrl,
          monthlyLimitUsd: config.monthlyLimitUsd,
          state,
        },
      )
      if (Object.values(s).some((n) => n > 0)) log(`cycle: ${JSON.stringify(s)}`)
    } catch (err: unknown) {
      log(`cycle error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(Math.max(0, config.pollIntervalMs - (Date.now() - start)))
  }
}

main().catch((err: unknown) => {
  console.error('[news] fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
