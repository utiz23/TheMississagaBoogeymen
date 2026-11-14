/**
 * Press entry point (container `press`): the nine reporter bots. Its own
 * process, so a gateway outage or a reconnect loop never stops or delays the
 * `discord` and `news` services. The timer pass (press/pass.ts) runs in a
 * non-overlapping loop (async wait) every PRESS_POLL_INTERVAL_MS (15 s); the
 * gateway clients (press/gateway.ts) receive the buttons, pop-ups and slash
 * commands, and Barlow's client the fan reactions. Bad config ⇒ log once and
 * idle (no restart loop, no Discord login, no Claude calls).
 *
 * Env: DATABASE_URL, DISCORD_INTERNAL_TOKEN, WEB_INTERNAL_URL, DISCORD_SITE_URL,
 * NEWS_MODEL, NEWS_MONTHLY_LIMIT_USD, ANTHROPIC_API_KEY, PRESS_MODE,
 * PRESS_TOKEN_*, PRESS_GUILD_ID, PRESS_TEST_CHANNEL_ID, PRESS_LIVE_CHANNEL_ID,
 * PRESS_GM_USER_ID, PRESS_POLL_INTERVAL_MS, PRESS_TYPED_ANSWERS (1 = typed answers in
 * scrum threads; needs the Message Content intent on for Wade Barlow).
 */
import { loadPressConfig } from './press/config.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
// The press modules put `[press]` in their own lines.
const log = (m: string) => console.log(m)
const debug = (m: string) => console.debug(m)
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function main(): Promise<void> {
  const loaded = loadPressConfig(process.env)
  if (!loaded.ok) {
    log(`[press] not running: ${loaded.problems.join('; ')}`)
    for (;;) await sleep(3_600_000)
  }
  const config = loaded.config
  // Imported after the config check so a misconfigured host never opens a DB pool.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { pressDbStore } = await import('./press/store.ts')
  const { runPressPass } = await import('./press/pass.ts')
  const {
    attachMessages,
    attachReactions,
    attachRouter,
    createMessageRouter,
    createReactionRouter,
    createRouter,
    registerCommands,
    restDiscordOps,
    startClients,
  } = await import('./press/gateway.ts')
  const { fetchNewsFacts } = await import('./news/web-client.ts')
  const { anthropicModelCall } = await import('./news/writer.ts')

  process.on('unhandledRejection', (err: unknown) => {
    log(`[press] unhandled rejection: ${reason(err)}`)
  })

  // One deps object for the process: the pass and every interaction share it
  // (some once-per-item logs are keyed on it). The API key is read from the
  // environment and never logged.
  const web = { webBaseUrl: config.webBaseUrl, token: config.internalToken }
  const deps = {
    store: pressDbStore,
    discord: restDiscordOps(config.tokens),
    fetchFacts: (kind: 'game' | 'night', key: string) => fetchNewsFacts({ ...web, kind, key }),
    call: anthropicModelCall(new Anthropic(), config.model),
    log,
    now: () => new Date(),
  }

  const route = createRouter({ deps, config, log, debug })
  const clients = await startClients(config, log)
  for (const client of clients.values()) attachRouter(client, route)
  const barlow = clients.get('barlow')
  if (barlow !== undefined) {
    registerCommands(barlow, config.guildId, log)
    attachReactions(barlow, createReactionRouter({ deps, config, log }), log)
    if (config.typedAnswers) attachMessages(barlow, createMessageRouter({ deps, config, log }))
  }

  log(
    `[press] started (${config.mode}) in ${config.mode === 'live' ? 'the live channel' : 'the test channel'}, ${String(clients.size)} bots, typed answers ${config.typedAnswers ? 'on' : 'off'}`,
  )

  for (;;) {
    const start = Date.now()
    try {
      const s = await runPressPass(deps, config)
      // A failed step is logged by the pass itself; this line is for activity.
      if (Object.values(s).some((n) => typeof n === 'number' && n > 0)) {
        log(`[press] pass: ${JSON.stringify(s)}`)
      }
    } catch (err: unknown) {
      log(`[press] pass error: ${reason(err)}`)
    }
    await sleep(Math.max(0, config.pollIntervalMs - (Date.now() - start)))
  }
}

main().catch((err: unknown) => {
  console.error('[press] fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
