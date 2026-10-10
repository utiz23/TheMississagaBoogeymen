import type { DiscordGameResult } from '@eanhl/db/discord'
import { buildGameResultPayload, type WebhookPayload } from './message.ts'

export const WINDOW_MS = 86_400_000
export const BATCH_LIMIT = 5

export interface PosterStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(matchId: number): Promise<boolean>
  markPosted(matchId: number, messageId: string | null): Promise<void>
  markFailed(matchId: number, error: string): Promise<void>
  markSkipped(matchId: number, reason: string): Promise<void>
}

export interface PosterDeps {
  store: PosterStore
  fetchGameResult(matchId: number): Promise<DiscordGameResult>
  renderCards(matchId: number): Promise<Uint8Array>
  send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(matchId: number, payload: WebhookPayload, image: Uint8Array | null): Promise<void>
  log(message: string): void
  now(): Date
}

export interface CycleOptions {
  dryRun: boolean
  siteUrl: string
  windowMs: number
  batchLimit: number
}

export interface CycleSummary {
  posted: number
  failed: number
  dryRun: number
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * One pass: claim each eligible game, build its post, send (or dry-run), and
 * record the outcome. A card render failure degrades to a text-only post; any
 * other failure marks the row failed for a later retry. Never throws for a
 * single game.
 */
export async function runPosterCycle(deps: PosterDeps, opts: CycleOptions): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  const ids = await deps.store.candidates(since, opts.batchLimit)

  for (const matchId of ids) {
    if (!(await deps.store.claim(matchId))) continue
    try {
      const result = await deps.fetchGameResult(matchId)
      let image: Uint8Array | null = null
      if (result.cardPlayerIds.length > 0) {
        try {
          image = await deps.renderCards(matchId)
        } catch (err: unknown) {
          deps.log(
            `game ${String(matchId)}: card render failed, posting text only (${message(err)})`,
          )
        }
      }
      const payload = buildGameResultPayload(result, {
        siteUrl: opts.siteUrl,
        hasImage: image !== null,
      })
      if (opts.dryRun) {
        await deps.writeDryRun(matchId, payload, image)
        await deps.store.markSkipped(matchId, 'dry run')
        summary.dryRun++
      } else {
        const messageId = await deps.send(payload, image)
        await deps.store.markPosted(matchId, messageId)
        summary.posted++
      }
    } catch (err: unknown) {
      deps.log(`game ${String(matchId)}: failed (${message(err)})`)
      await deps.store.markFailed(matchId, message(err))
      summary.failed++
    }
  }
  return summary
}
