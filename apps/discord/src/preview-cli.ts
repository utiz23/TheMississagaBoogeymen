/**
 * Render one game's post to disk without touching the database or Discord:
 *   DISCORD_INTERNAL_TOKEN=… WEB_INTERNAL_URL=http://localhost:3000 \
 *     pnpm --filter @eanhl/discord preview --match-id 1234 [--out ./discord-preview]
 */
import { buildGameResultPayload } from './message.ts'
import { fetchGameResult } from './web-client.ts'
import { renderLineup } from './render.ts'
import { writeDryRunFiles } from './dry-run.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const matchId = Number.parseInt(arg('--match-id') ?? '', 10)
const outDir = arg('--out') ?? './discord-preview'
const token = process.env['DISCORD_INTERNAL_TOKEN'] ?? ''
const webBaseUrl = (process.env['WEB_INTERNAL_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
const siteUrl = (process.env['DISCORD_SITE_URL'] ?? 'https://boogeymen.app').replace(/\/+$/, '')

if (!Number.isSafeInteger(matchId) || matchId <= 0 || token.length < 16) {
  console.error('usage: DISCORD_INTERNAL_TOKEN=… preview --match-id N [--out DIR]')
  process.exit(2)
}

const result = await fetchGameResult({ webBaseUrl, token, matchId })
const image =
  result.lineupCardCount > 0
    ? await renderLineup({ webBaseUrl, token, matchId, timeoutMs: 30_000 })
    : null
const payload = buildGameResultPayload(result, { siteUrl, hasImage: image !== null })
console.log(`wrote ${await writeDryRunFiles(outDir, matchId, payload, image)}`)
