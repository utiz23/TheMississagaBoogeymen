import { VoiceTracker, createBenchPort, type BenchPort, type MemberInfo } from './bench.ts'
import { CHEL_ROLE_ID } from './config.ts'

/**
 * Test fakes for the bench (T7): a real `VoiceTracker` filled from a list of stays, and a member
 * lookup from a table. Nothing here touches a database or Discord.
 */

/** Discord ids used by the bench tests (snowflake-shaped). */
export const JOEY = '200000000000000005'
export const COACH = '200000000000000010'
export const WATCHER = '200000000000000011'
export const LURKER = '200000000000000012'
export const BOT = '200000000000000013'
export const OUTLIER = '200000000000000014'

export const CALL = 'voice-1'
export const OTHER_CALL = 'voice-2'

export interface Stay {
  userId: string
  channelId: string
  /** Default: before the game. */
  since?: Date
  /** Default: still there. */
  until?: Date | null
}

export const member = (over: Partial<MemberInfo> = {}): MemberInfo => ({
  nick: null,
  globalName: null,
  username: 'someone',
  roles: [CHEL_ROLE_ID],
  bot: false,
  ...over,
})

/**
 * A bench port: `stays` is who was in which channel; `members` the guild members by user id (a
 * missing one is not on the server). `available: false` = no voice data yet.
 */
export function benchPort(opts: {
  stays?: Stay[]
  members?: Record<string, MemberInfo>
  available?: boolean
  before?: Date
}): BenchPort & { tracker: VoiceTracker; lookups: string[] } {
  const tracker = new VoiceTracker()
  const before = opts.before ?? new Date('2026-10-13T01:00:00.000Z')
  if (opts.available !== false) {
    tracker.snapshot([], new Date(0))
    for (const s of opts.stays ?? []) {
      tracker.update(s.userId, s.channelId, s.since ?? before)
      if (s.until !== undefined && s.until !== null) tracker.update(s.userId, null, s.until)
    }
  }
  const lookups: string[] = []
  const port = createBenchPort(tracker, (userId) => {
    lookups.push(userId)
    return Promise.resolve(opts.members?.[userId] ?? null)
  })
  return Object.assign(port, { tracker, lookups })
}
