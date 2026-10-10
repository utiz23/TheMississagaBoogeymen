import type { DiscordGameResult } from '@eanhl/db/discord'
import { buildGameResultPayload, type WebhookPayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

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
 * One pass over eligible games. Per game, in this order:
 *  1. fetch the game data — read-only; if web is down, skip WITHOUT claiming,
 *     so a web restart only delays the post (retried next cycle, inside the
 *     24 h window) and never burns an attempt;
 *  2. claim the row (pending);
 *  3. render the cards — a failure degrades to a text-only post;
 *  4. send (or dry-run). A definite send failure marks the row failed for a
 *     retry. Once the send succeeded — or might have (WebhookOutcomeUnknownError)
 *     — the row is never marked failed: it is posted, or it stays pending,
 *     which is never re-picked. That is the no-double-post guarantee.
 * Never throws for a single game.
 */
export async function runPosterCycle(deps: PosterDeps, opts: CycleOptions): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  const ids = await deps.store.candidates(since, opts.batchLimit)

  for (const matchId of ids) {
    const game = `game ${String(matchId)}`
    let result: DiscordGameResult
    try {
      result = await deps.fetchGameResult(matchId)
    } catch (err: unknown) {
      deps.log(`${game}: game data unavailable, will retry (${message(err)})`)
      continue
    }
    if (!(await deps.store.claim(matchId))) continue

    let payload: WebhookPayload
    let image: Uint8Array | null = null
    try {
      if (result.lineupCardCount > 0) {
        try {
          image = await deps.renderCards(matchId)
        } catch (err: unknown) {
          deps.log(`${game}: card render failed, posting text only (${message(err)})`)
        }
      }
      payload = buildGameResultPayload(result, { siteUrl: opts.siteUrl, hasImage: image !== null })
      if (opts.dryRun) {
        await deps.writeDryRun(matchId, payload, image)
        await deps.store.markSkipped(matchId, 'dry run')
        summary.dryRun++
        continue
      }
    } catch (err: unknown) {
      await fail(deps, matchId, err)
      summary.failed++
      continue
    }

    let messageId: string | null
    try {
      messageId = await deps.send(payload, image)
    } catch (err: unknown) {
      if (err instanceof WebhookOutcomeUnknownError) {
        deps.log(`${game}: ${err.message} — left pending, not retried; check the channel`)
      } else {
        await fail(deps, matchId, err)
      }
      summary.failed++
      continue
    }
    summary.posted++
    try {
      await deps.store.markPosted(matchId, messageId)
    } catch (err: unknown) {
      deps.log(`${game}: posted but not recorded — left pending, not retried (${message(err)})`)
    }
  }
  return summary
}

async function fail(deps: PosterDeps, matchId: number, err: unknown): Promise<void> {
  deps.log(`game ${String(matchId)}: failed (${message(err)})`)
  try {
    await deps.store.markFailed(matchId, message(err))
  } catch (markErr: unknown) {
    deps.log(
      `game ${String(matchId)}: could not record the failure — left pending (${message(markErr)})`,
    )
  }
}
