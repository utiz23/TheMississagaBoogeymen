import type { DiscordUnlock, DiscordUnlockSkip } from '@eanhl/db/discord'
import type { CycleOptions, CycleSummary } from './cycle.ts'
import { buildUnlockPayload, type MessagePayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

export const UNLOCK_LIMIT = 20
/** Discord allows ~30 webhook messages a minute per channel. */
export const UNLOCK_GAP_MS = 2100

export interface UnlockStore {
  candidates(since: Date, limit: number): Promise<number[]>
  claim(eventId: number): Promise<boolean>
  markPosted(eventId: number, messageId: string | null): Promise<void>
  markFailed(eventId: number, error: string): Promise<void>
  markSkipped(eventId: number, reason: string): Promise<void>
}

export interface UnlockDeps {
  store: UnlockStore
  fetchUnlock(eventId: number): Promise<DiscordUnlock | DiscordUnlockSkip>
  render(eventId: number, graphic: 'badge' | 'card'): Promise<Uint8Array>
  send(payload: MessagePayload, image: Uint8Array | null): Promise<string | null>
  writeDryRun(key: string, payload: MessagePayload, image: Uint8Array | null): Promise<void>
  pause(ms: number): Promise<void>
  log(message: string): void
  now(): Date
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
/** Discord's rate limit: stop this pass instead of sending into it. */
const rateLimited = (err: unknown) => /HTTP 429\b/.test(message(err))

/**
 * One pass over unlocks, one Discord message each, in candidate order and
 * UNLOCK_GAP_MS apart. Same rules as the game pass: fetch before claiming (any
 * error, 404 included ⇒ retry later; an explicit { skip } ⇒ claim, skip, log),
 * render (failure ⇒ text only),
 * send; once a send succeeded or might have, the row is never marked failed.
 * Each unlock is its own row, so a crash mid-run never re-sends earlier ones.
 */
export async function runUnlockCycle(deps: UnlockDeps, opts: CycleOptions): Promise<CycleSummary> {
  const summary: CycleSummary = { posted: 0, failed: 0, dryRun: 0 }
  const since = new Date(deps.now().getTime() - opts.windowMs)
  let sentBefore = false
  for (const id of await deps.store.candidates(since, opts.batchLimit)) {
    const tag = `unlock ${String(id)}`
    let fetched: DiscordUnlock | DiscordUnlockSkip
    try {
      fetched = await deps.fetchUnlock(id)
    } catch (err: unknown) {
      // Any error, a 404 included (old web image, bad token), is a retry.
      deps.log(`${tag}: data unavailable, will retry (${message(err)})`)
      continue
    }
    if ('skip' in fetched) {
      if (await deps.store.claim(id)) {
        await deps.store.markSkipped(id, fetched.skip)
        deps.log(`${tag}: skipped (${fetched.skip})`)
      }
      continue
    }
    const u = fetched
    if (!(await deps.store.claim(id))) continue
    let image: Uint8Array | null = null
    if (u.graphic !== 'none') {
      try {
        image = await deps.render(id, u.graphic)
      } catch (err: unknown) {
        deps.log(`${tag}: render failed, posting text only (${message(err)})`)
      }
    }
    const payload = buildUnlockPayload(u, { siteUrl: opts.siteUrl, hasImage: image !== null })
    if (opts.dryRun) {
      await deps.writeDryRun(`unlock-${String(id)}`, payload, image)
      await deps.store.markSkipped(id, 'dry run')
      summary.dryRun++
      continue
    }
    if (sentBefore) await deps.pause(UNLOCK_GAP_MS)
    let messageId: string | null
    try {
      messageId = await deps.send(payload, image)
    } catch (err: unknown) {
      sentBefore = true
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
      if (rateLimited(err)) {
        deps.log('Discord rate limit — unlock pass stopped until the next cycle')
        break
      }
      continue
    }
    sentBefore = true
    summary.posted++
    try {
      await deps.store.markPosted(id, messageId)
    } catch (err: unknown) {
      deps.log(`${tag}: posted but not recorded — left pending, not retried (${message(err)})`)
    }
  }
  return summary
}
