import type { PressConfig } from './config.ts'
import type { PressDeps, PressStore } from './pass.ts'
import { onGmTestScrum } from './test-scrum.ts'

/**
 * Press Box (the admin page /admin/press-box, migration 0080): requests from the page.
 *
 * The page cannot post to Discord (the bot tokens live here), so a button on the page writes one
 * request row. Every pass this service takes the oldest pending request and does it, then writes
 * a short private result back for the page to show. Today the only kind is `testscrum`: the same
 * code as `/gm testscrum` (`onGmTestScrum`), run as the GM with the defaults (the latest game, the
 * GM as the only person asked). It makes no model call.
 *
 * Every pass also reports this service's mode and the time, so the page can show the mode
 * (read only) and whether the press service is running.
 *
 * Not part of `PressStore` (the same pattern as `TestScrumStore`): the methods ride on
 * `pressDbStore` and are found by `boxRequestStoreOf`. A store without them has no requests.
 */
export interface BoxRequestStore {
  claimPressBoxRequest(): Promise<{ id: number; kind: 'testscrum'; requestedBy: string } | null>
  finishPressBoxRequest(
    id: number,
    status: 'done' | 'failed',
    result: string,
    at: Date,
  ): Promise<void>
  failStuckPressBoxRequests(before: Date): Promise<number>
  reportPressMode(mode: 'trial' | 'live', at: Date): Promise<void>
}

const METHODS: readonly (keyof BoxRequestStore)[] = [
  'claimPressBoxRequest',
  'finishPressBoxRequest',
  'failStuckPressBoxRequests',
  'reportPressMode',
]

export function boxRequestStoreOf(store: PressStore): (PressStore & BoxRequestStore) | null {
  const s = store as PressStore & Partial<Record<keyof BoxRequestStore, unknown>>
  return METHODS.every((m) => typeof s[m] === 'function')
    ? (store as PressStore & BoxRequestStore)
    : null
}

/** A request left `running` this long ago was cut off (a restart): it is marked failed, never retried. */
export const BOX_REQUEST_STUCK_MS = 10 * 60_000
/** At most this many requests per pass. */
const PER_PASS = 3

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The part of the press timer pass for the Press Box: report the mode, then do waiting requests. Returns how many ran. */
export async function runBoxRequests(deps: PressDeps, config: PressConfig): Promise<number> {
  const store = boxRequestStoreOf(deps.store)
  if (store === null) return 0
  const now = deps.now()
  await store.reportPressMode(config.mode, now)
  await store.failStuckPressBoxRequests(new Date(now.getTime() - BOX_REQUEST_STUCK_MS))
  let ran = 0
  for (let i = 0; i < PER_PASS; i++) {
    const request = await store.claimPressBoxRequest()
    if (request === null) break
    ran++
    try {
      const reply = await onGmTestScrum(deps, config, config.gmUserId, {
        inGuild: true,
        game: null,
        players: [],
        bench: null,
      })
      await store.finishPressBoxRequest(
        request.id,
        'done',
        reply.kind === 'ephemeral' ? reply.text : 'Done.',
        deps.now(),
      )
    } catch (err: unknown) {
      deps.log(`[press] box request ${String(request.id)}: ${reason(err)}`)
      await store.finishPressBoxRequest(
        request.id,
        'failed',
        'The test scrum could not be made.',
        deps.now(),
      )
    }
  }
  return ran
}
