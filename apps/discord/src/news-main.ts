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
 * NEWS_MODEL, NEWS_MONTHLY_LIMIT_USD, ANTHROPIC_API_KEY, NEWS_TEST_WEBHOOK_URL
 * (test mode only: a copy of each message goes to that channel). With
 * PRESS_MODE=live the posts go out as the reporters' bots (PRESS_TOKEN_*,
 * PRESS_* channel IDs) instead of the webhook (news/delivery.ts).
 */
import { loadNewsConfig } from './news/config.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const log = (m: string) => console.log(`[news] ${m}`)
/** Test-channel copies are spaced out (Discord webhooks allow about 5 per 2 s). */
const TEST_SEND_GAP_MS = 1500

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
  const { newsDelivery } = await import('./news/delivery.ts')
  const { sendWebhook } = await import('./webhook.ts')
  const { writeDryRunFiles } = await import('./dry-run.ts')
  const { testModePayload } = await import('./news/messages.ts')

  if (!config.dryRun) {
    // Release step: nothing written in test mode is ever published (jobs are kept, R8).
    const removed = await deleteTestNewsItems()
    log(`live mode: removed ${String(removed)} test item(s)`)
  }
  log(
    `started (${config.dryRun ? 'DRY RUN' : 'live'}, ${config.bots === null ? 'webhook' : 'reporter bots'}), model ${config.model}, limit ${String(config.monthlyLimitUsd)} USD/month, every ${String(config.pollIntervalMs)}ms`,
  )

  // Reads ANTHROPIC_API_KEY from the environment; the key is never logged.
  const writer = anthropicModelCall(new Anthropic(), config.model)
  const web = { webBaseUrl: config.webBaseUrl, token: config.internalToken }
  const state = createNewsCycleState()
  const { send, remove } = newsDelivery({ webhookUrl: config.webhookUrl, bots: config.bots, log })

  for (;;) {
    const start = Date.now()
    try {
      const s = await runNewsCycle(
        {
          store: newsDbStore,
          fetchFacts: (kind, key) => fetchNewsFacts({ ...web, kind, key }),
          writer,
          send,
          remove,
          writeDryRun: async (key, payload) => {
            log(`dry run → ${await writeDryRunFiles(config.outDir, key, payload, null)}`)
            if (config.testWebhookUrl === null) return
            // Test mode: a copy goes to the bot test channel. A failed send is
            // only logged, so the item is still settled and never sent twice.
            try {
              await sendWebhook(config.testWebhookUrl, testModePayload(payload), null)
            } catch (err: unknown) {
              log(`test channel: not sent (${err instanceof Error ? err.message : String(err)})`)
            }
            await sleep(TEST_SEND_GAP_MS)
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
