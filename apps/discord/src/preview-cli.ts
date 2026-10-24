/**
 * Render one game's post, or one unlock message, to disk without touching the
 * database or Discord:
 *   DISCORD_INTERNAL_TOKEN=… WEB_INTERNAL_URL=http://localhost:3000 \
 *     pnpm --filter @eanhl/discord preview --match-id 1234 [--out ./discord-preview]
 *     pnpm --filter @eanhl/discord preview --unlock 5678 [--out ./discord-preview]
 */
import { buildGameResultPayload, buildUnlockPayload } from './message.ts'
import { fetchGameResult, fetchUnlock } from './web-client.ts'
import { renderLineup, renderUnlock } from './render.ts'
import { writeDryRunFiles } from './dry-run.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const matchId = Number.parseInt(arg('--match-id') ?? '', 10)
const unlockId = Number.parseInt(arg('--unlock') ?? '', 10)
const outDir = arg('--out') ?? './discord-preview'
const token = process.env['DISCORD_INTERNAL_TOKEN'] ?? ''
const webBaseUrl = (process.env['WEB_INTERNAL_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
const siteUrl = (process.env['DISCORD_SITE_URL'] ?? 'https://boogeymen.app').replace(/\/+$/, '')
const valid = (n: number) => Number.isSafeInteger(n) && n > 0

if ((!valid(matchId) && !valid(unlockId)) || token.length < 16) {
  console.error('usage: DISCORD_INTERNAL_TOKEN=… preview (--match-id N | --unlock N) [--out DIR]')
  process.exit(2)
}

if (valid(unlockId)) {
  const u = await fetchUnlock({ webBaseUrl, token, eventId: unlockId })
  const image =
    u.graphic === 'none'
      ? null
      : await renderUnlock({
          webBaseUrl,
          token,
          eventId: unlockId,
          graphic: u.graphic,
          timeoutMs: 30_000,
        })
  const payload = buildUnlockPayload(u, { siteUrl, hasImage: image !== null })
  console.log(
    `wrote ${await writeDryRunFiles(outDir, `unlock-${String(unlockId)}`, payload, image)}`,
  )
} else {
  const result = await fetchGameResult({ webBaseUrl, token, matchId })
  const image =
    result.lineupCardCount > 0
      ? await renderLineup({ webBaseUrl, token, matchId, timeoutMs: 30_000 })
      : null
  const payload = buildGameResultPayload(result, { siteUrl, hasImage: image !== null })
  console.log(`wrote ${await writeDryRunFiles(outDir, matchId, payload, image)}`)
}
