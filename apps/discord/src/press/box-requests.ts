import type { PressConfig } from './config.ts'
import {
  runInterviewRequest,
  runProfileRequest,
  type ClaimedRequest,
  type ProfileStoreMethods,
} from './box-requests-profile.ts'
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
 * Release L2 (migration 0081) adds two kinds, `profile` (write or refresh a person's AI profile) and
 * `interview` (offer a person an interview as the GM); see box-requests-profile.ts. An old fake
 * store without the profile methods fails a profile request with a fixed line.
 *
 * Not part of `PressStore` (the same pattern as `TestScrumStore`): the methods ride on
 * `pressDbStore` and are found by `boxRequestStoreOf`. A store without them has no requests.
 */
export interface BoxRequestStore {
  claimPressBoxRequest(): Promise<ClaimedRequest | null>
  finishPressBoxRequest(
    id: number,
    status: 'done' | 'failed',
    result: string,
    at: Date,
  ): Promise<void>
  failStuckPressBoxRequests(before: Date): Promise<number>
  reportPressMode(mode: 'trial' | 'live', at: Date): Promise<void>
}

/** The profile methods are optional on a store: a request for a profile fails closed without them. */
export type BoxRequestStoreWithProfiles = BoxRequestStore & Partial<ProfileStoreMethods>

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

async function runOne(
  deps: PressDeps,
  config: PressConfig,
  store: BoxRequestStoreWithProfiles,
  request: ClaimedRequest,
): Promise<{ status: 'done' | 'failed'; result: string }> {
  if (request.kind === 'profile') {
    if (
      typeof store.getProfileMaterial !== 'function' ||
      typeof store.savePlayerProfile !== 'function'
    ) {
      return { status: 'failed', result: 'Profiles are off in this press service.' }
    }
    return runProfileRequest(deps, config, store as ProfileStoreMethods, request)
  }
  if (request.kind === 'interview') return runInterviewRequest(deps, config, request)
  try {
    const reply = await onGmTestScrum(deps, config, config.gmUserId, {
      inGuild: true,
      game: null,
      players: [],
      bench: null,
    })
    return { status: 'done', result: reply.kind === 'ephemeral' ? reply.text : 'Done.' }
  } catch (err: unknown) {
    deps.log(`[press] box request ${String(request.id)}: ${reason(err)}`)
    return { status: 'failed', result: 'The test scrum could not be made.' }
  }
}

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
    const outcome = await runOne(
      deps,
      config,
      store as unknown as BoxRequestStoreWithProfiles,
      request,
    )
    await store.finishPressBoxRequest(request.id, outcome.status, outcome.result, deps.now())
  }
  return ran
}
