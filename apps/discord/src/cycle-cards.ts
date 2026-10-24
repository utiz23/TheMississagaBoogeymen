import type { DiscordCardUpdates } from '@eanhl/db/discord'
import type { CycleOptions, CycleSummary } from './cycle.ts'
import { buildCardUpdatesPayload, type WebhookPayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

export interface CardPostStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(batchEventId: number): Promise<boolean>
  markPosted(batchEventId: number, messageId: string | null): Promise<void>
  markFailed(batchEventId: number, error: string): Promise<void>
  markSkipped(batchEventId: number, reason: string): Promise<void>
}

export interface CardPosterDeps {
  store: CardPostStore
  fetchCardUpdates(batchEventId: number): Promise<DiscordCardUpdates>
  renderCards(batchEventId: number): Promise<Uint8Array>
  send(payload: WebhookPayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(key: string, payload: WebhookPayload, image: Uint8Array | null): Promise<void>
  log(message: string): void
  now(): Date
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * One pass over card batches — the same order and no-double-post rules as the
 * game pass (cycle.ts): fetch before claiming (web down ⇒ retry later), claim,
 * render (failure ⇒ text only), send; once a send succeeded or might have, the
 * row is never marked failed. A batch with nothing left to show is skipped.
 */
export async function runCardUpdatesCycle(
  deps: CardPosterDeps,
  opts: CycleOptions,
): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  for (const id of await deps.store.candidates(since, opts.batchLimit)) {
    const tag = `card batch ${String(id)}`
    let data: DiscordCardUpdates
    try {
      data = await deps.fetchCardUpdates(id)
    } catch (err: unknown) {
      deps.log(`${tag}: data unavailable, will retry (${message(err)})`)
      continue
    }
    if (!(await deps.store.claim(id))) continue
    if (data.players.length === 0) {
      await deps.store.markSkipped(id, 'nothing to show')
      continue
    }
    let image: Uint8Array | null = null
    if (data.cardCount > 0) {
      try {
        image = await deps.renderCards(id)
      } catch (err: unknown) {
        deps.log(`${tag}: card render failed, posting text only (${message(err)})`)
      }
    }
    const payload = buildCardUpdatesPayload(data, {
      siteUrl: opts.siteUrl,
      hasImage: image !== null,
    })
    if (opts.dryRun) {
      await deps.writeDryRun(`card-${String(id)}`, payload, image)
      await deps.store.markSkipped(id, 'dry run')
      summary.dryRun++
      continue
    }
    let messageId: string | null
    try {
      messageId = await deps.send(payload, image)
    } catch (err: unknown) {
      if (err instanceof WebhookOutcomeUnknownError) {
        deps.log(`${tag}: ${err.message} — left pending, not retried; check the channel`)
      } else {
        deps.log(`${tag}: failed (${message(err)})`)
        try {
          await deps.store.markFailed(id, message(err))
        } catch (markErr: unknown) {
          deps.log(`${tag}: could not record the failure — left pending (${message(markErr)})`)
        }
      }
      summary.failed++
      continue
    }
    summary.posted++
    try {
      await deps.store.markPosted(id, messageId)
    } catch (err: unknown) {
      deps.log(`${tag}: posted but not recorded — left pending, not retried (${message(err)})`)
    }
  }
  return summary
}
